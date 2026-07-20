/**
 * The operation model -- what one edit looks like on the wire.
 *
 * WHY OPERATIONS AND NOT DOCUMENT SNAPSHOTS
 * -----------------------------------------
 * The naive design sends the whole document on every keystroke. It fails, and
 * not because of bandwidth:
 *
 *   doc = "hello", two clients
 *   A appends  "!" -> sends "hello!"
 *   B prepends "?" -> sends "?hello"
 *
 * Both arrive, the server stores one, and the other person's work is gone. This
 * is the lost-update problem, and ordering does not fix it -- whichever write
 * lands second wins completely.
 *
 * The root cause: a snapshot does not record what CHANGED. Sending state
 * instead of change throws away intent, and no merge can recover it. So we send
 * the change.
 *
 * WHY OUR OWN FORMAT AND NOT MONACO'S CHANGE EVENTS
 * -------------------------------------------------
 * Monaco already emits precise change events, but forwarding them raw is wrong:
 *
 *   1. Monaco uses line/column coordinates. Transform math over line/col has to
 *      reason about newlines shifting every line number below them; over flat
 *      character offsets it is arithmetic. This choice alone roughly halves the
 *      difficulty of the transform work.
 *   2. It would couple the wire protocol -- and the pure core, and its unit
 *      tests -- to the shape of a browser editor library.
 *   3. The events carry no author and no version.
 *
 * Instead we translate at the boundary (Phase 6): Monaco events in, these
 * operations out. A standard anti-corruption layer.
 */

/**
 * How many operations have been applied to a document.
 *
 * Starts at 0 for an empty room and increments by one per accepted operation.
 * A version identifies a specific document state, which is what makes it usable
 * as the causality marker on a submission (see `baseVersion` in protocol.ts).
 */
export type DocumentVersion = number;

/**
 * Client-generated unique id for one operation.
 *
 * Distinct from the server's `Sequence`, and the two do different jobs:
 *   - `OpId`     is for CORRELATION -- it lets a client match an acknowledgement
 *                back to the specific pending operation it submitted.
 *   - `Sequence` is for ORDERING    -- assigned by the server, which is the sole
 *                authority on what order edits happened in.
 *
 * A client cannot assign sequence numbers (it does not know what other clients
 * are doing), and the server cannot assign correlation ids (the client needs
 * one before it sends). Hence both.
 */
export type OpId = string;

/**
 * Insert `text` at `position`.
 *
 * `position` is a flat character offset into the document, NOT line/column.
 * Valid range is 0..document.length inclusive -- inserting at length means
 * appending.
 */
export interface InsertOp {
  readonly type: "insert";
  readonly position: number;
  readonly text: string;
}

/**
 * Delete `length` characters starting at `position`.
 *
 * NOTE: this does not carry the deleted text. Length alone is enough to
 * transform against, and omitting the content keeps operations small.
 *
 * The tradeoff is real though: carrying the deleted text would make undo and
 * post-mortem debugging dramatically easier, because an operation log would be
 * independently reversible without replaying from the beginning. If undo gets
 * built later, this is the decision to revisit first.
 */
export interface DeleteOp {
  readonly type: "delete";
  readonly position: number;
  readonly length: number;
}

/**
 * Every edit is one of exactly two primitives.
 *
 * This is not a simplification -- everything a text editor does decomposes into
 * them. A paste is an insert. Typing over a selection is a delete plus an
 * insert. Keeping the set this small is what makes the transform function
 * tractable: two operation types means four transform cases, and that is the
 * entire surface area of the hardest code in the project.
 *
 * A discriminated union on `type`, so TypeScript narrows it in a switch and
 * `noFallthroughCasesInSwitch` catches an unhandled case at compile time.
 */
export type Op = InsertOp | DeleteOp;

/**
 * An operation plus the metadata that makes it meaningful to someone else.
 *
 * An `Op` on its own is not enough to act on -- see `baseVersion` in
 * protocol.ts for why the version is load-bearing rather than bookkeeping.
 */
export interface AuthoredOp {
  readonly id: OpId;
  readonly op: Op;
  readonly authorId: string;
}
