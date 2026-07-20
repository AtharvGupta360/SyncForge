/**
 * The client session -- the browser's brain, and the mirror image of the
 * server's RoomRegistry.
 *
 * Same discipline as the server side: this class knows nothing about sockets. It
 * takes protocol messages in and RETURNS the `ClientMessage`s that should be
 * sent, so every rule below is unit-testable with no editor and no network. The
 * DOM/Monaco/socket.io shell (next phase) just pumps messages through it.
 *
 * THE PENDING + BUFFER MODEL
 * --------------------------
 * A local keystroke is applied to the visible document IMMEDIATELY -- optimistic
 * update, no round-trip wait. But the server stamps a strict version sequence
 * and will only accept an op whose `baseVersion` matches, so the client keeps at
 * most ONE op in flight:
 *
 *   pending  the single op sent and awaiting its ack.
 *   buffer   local ops applied to `doc` but not yet sent, because `pending` has
 *            not been acked. On ack, the head of the buffer becomes the next
 *            pending op.
 *
 * Consequently the visible `doc` runs AHEAD of `version` (the server's state) by
 * exactly the pending + buffered edits. That gap is the whole reason client-side
 * transform exists: a remote edit arrives expressed against `version`, but our
 * doc has moved past it.
 */

import { apply } from "@syncforge/core";
import type {
  ClientMessage,
  DocumentVersion,
  Op,
  OpAckMessage,
  OpBroadcastMessage,
  OpId,
  OpRejectMessage,
  RoomId,
  RoomSnapshotMessage,
} from "@syncforge/shared";

interface LocalOp {
  readonly id: OpId;
  readonly op: Op;
}

export class ClientSession {
  /** The document the user sees: server state + all local edits applied. */
  private doc = "";
  /** The highest server version this client has reconciled to. */
  private serverVersion: DocumentVersion = 0;
  /** The one op sent and awaiting ack, or null when nothing is in flight. */
  private pending: LocalOp | null = null;
  /** Local edits applied to `doc` but not yet sent (waiting on `pending`). */
  private readonly buffer: LocalOp[] = [];

  constructor(private readonly roomId: RoomId) {}

  /* ---- read side (for the view layer and for tests) ---- */

  get document(): string {
    return this.doc;
  }
  get version(): DocumentVersion {
    return this.serverVersion;
  }
  get inFlight(): boolean {
    return this.pending !== null;
  }
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /* ---- outbound: things the user/UI initiates ---- */

  /** Ask to join the room. The reply is a snapshot fed to `onSnapshot`. */
  join(): ClientMessage[] {
    return [{ kind: "room:join", roomId: this.roomId }];
  }

  /**
   * A local edit. Applied to the visible doc at once; sent immediately if
   * nothing is in flight, otherwise buffered behind the pending op.
   *
   * `op` is assumed valid against the current doc -- it comes from the Monaco
   * boundary, which derives it from the very document being edited, so an
   * invalid local op would be a bug worth throwing on rather than swallowing.
   */
  localEdit(id: OpId, op: Op): ClientMessage[] {
    this.doc = apply(this.doc, op);

    if (this.pending === null) {
      this.pending = { id, op };
      return [this.submit(id, op, this.serverVersion)];
    }

    this.buffer.push({ id, op });
    return [];
  }

  /* ---- inbound: things the server tells us ---- */

  /** Replace local state with the server's snapshot (also the resync landing). */
  onSnapshot(message: RoomSnapshotMessage): void {
    this.doc = message.content;
    this.serverVersion = message.version;
    this.pending = null;
    this.buffer.length = 0;
  }

  /**
   * Our in-flight op was accepted. Advance to the server's version and, if edits
   * were buffered while we waited, promote the next one and send it -- keeping
   * the one-in-flight invariant.
   */
  onAck(message: OpAckMessage): ClientMessage[] {
    if (this.pending === null || this.pending.id !== message.id) {
      // Not our current in-flight op (a duplicate or late ack); ignore.
      return [];
    }

    this.serverVersion = message.sequence;

    const next = this.buffer.shift();
    if (next) {
      this.pending = next;
      return [this.submit(next.id, next.op, this.serverVersion)];
    }

    this.pending = null;
    return [];
  }

  /**
   * A peer's accepted edit. Trivial to apply only when we have no local edits
   * outstanding -- then our doc IS at `version` and the op fits as written.
   */
  onBroadcast(message: OpBroadcastMessage): ClientMessage[] {
    if (this.pending === null && this.buffer.length === 0) {
      this.doc = apply(this.doc, message.op);
      this.serverVersion = message.sequence;
      return [];
    }

    // >>> TRANSFORM SEAM (P13-16). Our doc has moved past `version` by the
    // pending + buffered edits, so `message.op`'s coordinates are stale relative
    // to it. Correct handling is to transform the incoming op against our
    // outstanding ops (and them against it). Until that exists, the only safe
    // move is to throw away local state and resync -- correct, just lossy.
    return this.resync();
  }

  /**
   * The server refused our op. We have proven our view of history is wrong, so
   * the only safe recovery is to discard local state and re-sync from scratch.
   */
  onReject(_message: OpRejectMessage): ClientMessage[] {
    return this.resync();
  }

  /* ---- helpers ---- */

  private resync(): ClientMessage[] {
    this.pending = null;
    this.buffer.length = 0;
    return this.join();
  }

  private submit(
    id: OpId,
    op: Op,
    baseVersion: DocumentVersion,
  ): ClientMessage {
    return { kind: "op:submit", roomId: this.roomId, id, op, baseVersion };
  }
}
