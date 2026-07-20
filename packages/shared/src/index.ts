/**
 * @syncforge/shared
 *
 * The client/server contract. Anything that crosses the wire is defined here
 * and imported by BOTH sides, so a protocol mismatch is a compile error rather
 * than a runtime mystery.
 *
 * Rule: this package has no dependencies. Not on core, not on server, not on
 * any runtime library. It is types and constants only.
 *
 * The real protocol (operations, room state, socket events) is Phase 3.
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
