/**
 * The in-memory room registry -- the server's stateful bookkeeping over the
 * pure `accept` reducer.
 *
 * Deliberately knows NOTHING about Socket.IO. Its methods take plain data and
 * *return* the messages that should be sent; they never emit. That inversion is
 * the whole reason this file can be unit-tested with no server running, and it
 * keeps the socket layer (server.ts) down to "decode event, call registry, emit
 * what it hands back".
 *
 * State here is ephemeral -- a `Map` in process memory. A restart loses every
 * room. That is fine until the persistence phase, where Postgres becomes the
 * source of truth and this Map becomes a cache in front of it.
 */

import { accept, emptyDocument, type DocumentState } from "@syncforge/core";
import type {
  ClientId,
  OpAckMessage,
  OpBroadcastMessage,
  OpRejectMessage,
  RoomId,
  RoomSnapshotMessage,
  SubmitOpMessage,
} from "@syncforge/shared";

interface Room {
  state: DocumentState;
  /** Who is currently connected. Feeds the snapshot's `members`; presence gets
   *  fleshed out in Phase 17. */
  readonly members: Set<ClientId>;
}

/**
 * What a submission produced, described as data for the socket layer to send.
 *
 * `accepted` yields two messages with different audiences: an `ack` back to the
 * submitter and a `broadcast` to everyone else. `rejected` yields one reject to
 * the submitter. Making the audience split explicit here means server.ts cannot
 * accidentally broadcast a private ack or ack a rejection.
 */
export type SubmitOutcome =
  | {
      readonly kind: "accepted";
      readonly ack: OpAckMessage;
      readonly broadcast: OpBroadcastMessage;
    }
  | {
      readonly kind: "rejected";
      readonly reject: OpRejectMessage;
    };

export class RoomRegistry {
  private readonly rooms = new Map<RoomId, Room>();

  /**
   * Join (creating the room on first arrival) and return the snapshot the new
   * client needs -- content plus the version it reflects, so the client's first
   * edit has an honest `baseVersion` to claim.
   */
  join(roomId: RoomId, clientId: ClientId): RoomSnapshotMessage {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { state: emptyDocument(), members: new Set() };
      this.rooms.set(roomId, room);
    }
    room.members.add(clientId);

    return {
      kind: "room:snapshot",
      roomId,
      content: room.state.content,
      version: room.state.version,
      members: [...room.members],
    };
  }

  /** Remove a client from every room it was in (on disconnect). */
  leave(clientId: ClientId): void {
    for (const room of this.rooms.values()) {
      room.members.delete(clientId);
    }
  }

  /**
   * Run a submission through the reducer and describe what to send back.
   *
   * Submitting to a room that was never joined is `unknown-room`: there is no
   * document to write against. Otherwise `accept` decides, and we advance the
   * stored state only on acceptance -- a rejected op leaves history untouched.
   */
  submit(clientId: ClientId, message: SubmitOpMessage): SubmitOutcome {
    const room = this.rooms.get(message.roomId);
    if (!room) {
      return {
        kind: "rejected",
        reject: { kind: "op:reject", id: message.id, reason: "unknown-room" },
      };
    }

    const result = accept(room.state, message.op, message.baseVersion);
    if (result.status === "rejected") {
      return {
        kind: "rejected",
        reject: { kind: "op:reject", id: message.id, reason: result.reason },
      };
    }

    room.state = result.state;
    return {
      kind: "accepted",
      ack: { kind: "op:ack", id: message.id, sequence: result.sequence },
      broadcast: {
        kind: "op:broadcast",
        roomId: message.roomId,
        // `accept` now rebases and returns the effective op(s) in `result.ops`.
        // The wire still carries a single op, and this stays correct only because
        // current clients never submit stale (they resync on concurrency), so
        // `result.ops` is always exactly `[message.op]`.
        //
        // >>> Next phase: broadcast `result.ops` as a list so a rebased/split op
        // reaches peers intact, and add client-side transform so a client with
        // local edits can accept a broadcast instead of resyncing.
        op: message.op,
        authorId: clientId,
        sequence: result.sequence,
      },
    };
  }
}
