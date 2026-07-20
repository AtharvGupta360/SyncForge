/**
 * @syncforge/shared
 *
 * The client/server contract. Anything that crosses the wire is defined here
 * and imported by BOTH sides, so a protocol mismatch is a compile error rather
 * than a runtime mystery.
 *
 * Rule: this package has no dependencies. Not on core, not on server, not on
 * any runtime library. Types and constants only -- no logic, so there is
 * nothing here that could disagree with itself at runtime.
 */

/** Identifies a collaboration room. */
export type RoomId = string;

/** Identifies one connected client within a room. */
export type ClientId = string;

/**
 * Monotonic per-room sequence number assigned by the server.
 *
 * The server is the sole authority on ordering: it stamps every operation it
 * accepts. Clients track the highest sequence they have seen, which is what
 * makes reconnect-and-catch-up possible in Phase 20.
 */
export type Sequence = number;

export type {
  AuthoredOp,
  DeleteOp,
  DocumentVersion,
  InsertOp,
  Op,
  OpId,
} from "./ops.js";

export type {
  ClientMessage,
  JoinRoomMessage,
  OpAckMessage,
  OpBroadcastMessage,
  OpRejectMessage,
  RoomSnapshotMessage,
  ServerMessage,
  SubmitOpMessage,
} from "./protocol.js";
