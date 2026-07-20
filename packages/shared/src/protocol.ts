/**
 * The wire protocol: every message that crosses between client and server.
 *
 * THE CENTRAL ASYMMETRY
 * ---------------------
 * The two directions are not mirror images, and the difference is load-bearing:
 *
 *   client -> server  is a PROPOSAL. "Here is my edit, written against version
 *                     N." The server may transform it before accepting, and it
 *                     has no place in history yet.
 *
 *   server -> client  is a FACT. Already transformed, stamped with a sequence
 *                     number. The server is the sole authority on ordering.
 *
 * Because ordering has exactly one authority, a reconnecting client can say "I
 * have through sequence 41" and be replayed 42 onward. Reconnect works as a
 * consequence of this shape, not as a feature bolted on later.
 */

import type { ClientId, RoomId, Sequence } from "./index.js";
import type { DocumentVersion, Op, OpId } from "./ops.js";

/* ------------------------------------------------------------------ *
 * Client -> server
 * ------------------------------------------------------------------ */

/** Ask to join a room. The server replies with `RoomSnapshotMessage`. */
export interface JoinRoomMessage {
  readonly kind: "room:join";
  readonly roomId: RoomId;
}

/**
 * Submit a local edit for acceptance.
 *
 * WHY `baseVersion` EXISTS -- the single most important field in this file.
 *
 * Without it, convergence is not merely hard, it is undecidable. Worked example:
 *
 *   doc = "abc", both clients have it
 *   A inserts "X" at 0  -> A sees "Xabc"
 *   B inserts "Y" at 3  -> B sees "abcY"   (3 was the end of "abc")
 *
 * The server applies A's first, so the document is "Xabc". Now it applies B's
 * operation exactly as written -- insert "Y" at position 3:
 *
 *     X a b c        B's op says "insert at 3"
 *     0 1 2 3
 *           ^
 *     result: "XabYc"     <- wrong
 *     intent: "XabcY"
 *
 * A's insert shifted every coordinate after position 0 by one, so B's position
 * is stale -- it addresses a coordinate system that no longer exists. The fix
 * is to shift B's position from 3 to 4 before applying. That shift IS
 * operational transform.
 *
 * But to know a shift is needed at all, the server must answer: had B seen A's
 * edit yet? Compare:
 *
 *   B had NOT seen A's edit -> "3" means "end of abc"        -> transform to 4
 *   B HAD seen A's edit     -> "3" means "before c in Xabc"  -> apply as-is
 *
 * Byte-identical operations, opposite correct handling. Nothing inside the `Op`
 * distinguishes them. `baseVersion` is what does: the gap between it and the
 * server's current version names exactly which concurrent operations this edit
 * has not yet accounted for, and therefore what it must be transformed against.
 */
export interface SubmitOpMessage {
  readonly kind: "op:submit";
  readonly roomId: RoomId;
  /** Client-generated, echoed back in the ack so the client can correlate. */
  readonly id: OpId;
  readonly op: Op;
  /** The document version this edit was written against. See above. */
  readonly baseVersion: DocumentVersion;
}

export type ClientMessage = JoinRoomMessage | SubmitOpMessage;

/* ------------------------------------------------------------------ *
 * Server -> client
 * ------------------------------------------------------------------ */

/**
 * Full room state, sent on join.
 *
 * A new client needs a starting point, and it must be a point with a version
 * attached -- otherwise its first edit has no honest `baseVersion` to claim.
 */
export interface RoomSnapshotMessage {
  readonly kind: "room:snapshot";
  readonly roomId: RoomId;
  readonly content: string;
  /** The version `content` reflects. The client's edits start from here. */
  readonly version: DocumentVersion;
  /** Who else is in the room. Presence gets fleshed out in Phase 17. */
  readonly members: readonly ClientId[];
}

/**
 * An accepted edit, relayed to everyone else in the room.
 *
 * The `op` here is post-transform: it is expressed in the coordinate system of
 * the document at `sequence`, so a recipient that is up to date can apply it
 * directly. A recipient with pending local edits still has work to do -- that
 * is client-side transform, and it is why the client needs its own copy of the
 * transform function rather than trusting the server blindly.
 */
export interface OpBroadcastMessage {
  readonly kind: "op:broadcast";
  readonly roomId: RoomId;
  readonly op: Op;
  readonly authorId: ClientId;
  /** Server-assigned position in the room's total order. */
  readonly sequence: Sequence;
}

/**
 * Confirmation that a submitted edit was accepted.
 *
 * The client holds every unacknowledged edit in a pending buffer; this is what
 * lets it retire one. `id` correlates to the submission, `sequence` says where
 * it landed in the total order.
 */
export interface OpAckMessage {
  readonly kind: "op:ack";
  readonly id: OpId;
  readonly sequence: Sequence;
}

/**
 * A submission the server refused.
 *
 * Mostly a stale or impossible `baseVersion` -- e.g. a client claiming a
 * version the server has never issued. The client's only safe recovery is to
 * discard local state and re-sync from a fresh snapshot, because it has proven
 * its view of history is wrong.
 */
export interface OpRejectMessage {
  readonly kind: "op:reject";
  readonly id: OpId;
  readonly reason: "stale-version" | "invalid-op" | "unknown-room";
}

export type ServerMessage =
  | RoomSnapshotMessage
  | OpBroadcastMessage
  | OpAckMessage
  | OpRejectMessage;
