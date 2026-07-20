/**
 * apply -- execute one operation against a document.
 *
 * This is the smallest grain of meaning in the whole system: Phase 3 defined
 * what an `Op` *is* (data on the wire); this defines what it *does*. Everything
 * harder is built on top of it -- most importantly transform() in Phases 13-15,
 * whose very correctness is *defined* in terms of apply:
 *
 *     transform is correct  iff  applying the transformed ops in either order
 *                                yields byte-identical documents.
 *
 * So apply is both the foundation and the test oracle for the hardest code in
 * the project. That is why it comes first, and why it is pure: data in, data
 * out, no clock, no randomness, no I/O -- so its tests run thousands of
 * randomized cases per second with no server running.
 *
 * STRICT ON PURPOSE
 * -----------------
 * apply THROWS on an operation whose coordinates do not exist in `content`
 * (insert past the end, delete past the end, negative or non-integer offsets).
 * It does not clamp and it does not silently no-op. The reason is not taste, it
 * is a decision already made in Phase 3: `OpRejectMessage` carries
 * `reason: "invalid-op"`. That field only has a job if apply *detects* invalid
 * ops. Clamping would turn a stale, should-have-been-rejected edit into silent
 * document corruption -- convergence dying with no error -- and would make that
 * protocol case dead code.
 *
 * Throwing does not break purity: apply is still a total, deterministic mapping
 * from (content, op) to a defined outcome. The same inputs always produce the
 * same result-or-error.
 *
 * WHAT apply DOES NOT DO
 * ---------------------
 * It does not check that `text` is a string or `length` is a number -- the
 * TypeScript types guarantee that for typed callers. Guarding against malformed
 * *wire* data (a client sending `{ position: "3" }`) is the boundary's job when
 * messages are decoded, not the core's. apply validates *semantics* -- do these
 * coordinates address real positions in this document -- not *shape*.
 */

import type { DeleteOp, InsertOp, Op } from "@syncforge/shared";

/**
 * Thrown when an operation's coordinates do not fit `content`.
 *
 * A named type, not a bare `Error`, so the imperative shell can `catch` exactly
 * this and translate it into an `OpRejectMessage` with `reason: "invalid-op"`,
 * without also swallowing unrelated bugs (a `TypeError`, say) that should crash
 * loudly instead of being reported to the client as a rejected edit.
 */
export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}

/**
 * Insert `text` at `position`.
 *
 * Valid range is `0 .. content.length` INCLUSIVE -- inserting *at* length means
 * appending, which is a legitimate and common edit. An empty `text` is allowed
 * and is a well-defined no-op; rejecting it would buy nothing.
 */
function applyInsert(content: string, op: InsertOp): string {
  if (!Number.isInteger(op.position)) {
    throw new InvalidOperationError(
      `insert position must be an integer, got ${op.position}`,
    );
  }
  if (op.position < 0 || op.position > content.length) {
    throw new InvalidOperationError(
      `insert position ${op.position} out of range 0..${content.length}`,
    );
  }
  return content.slice(0, op.position) + op.text + content.slice(op.position);
}

/**
 * Delete `length` characters starting at `position`.
 *
 * The bounds rule is DIFFERENT from insert, and the difference is the classic
 * off-by-one trap. Insert only needs its single position to land in
 * `0..length`. Delete addresses a *range*: the whole span `[position,
 * position + length)` must sit inside the document, so the test is
 * `position + length <= content.length`. A zero or negative `length` is a
 * malformed op, not a no-op, so it is rejected rather than quietly ignored.
 */
function applyDelete(content: string, op: DeleteOp): string {
  if (!Number.isInteger(op.position) || !Number.isInteger(op.length)) {
    throw new InvalidOperationError(
      `delete position and length must be integers, got ${op.position}, ${op.length}`,
    );
  }
  if (op.length <= 0) {
    throw new InvalidOperationError(
      `delete length must be positive, got ${op.length}`,
    );
  }
  if (op.position < 0 || op.position + op.length > content.length) {
    throw new InvalidOperationError(
      `delete range [${op.position}, ${op.position + op.length}) out of bounds for length ${content.length}`,
    );
  }
  return content.slice(0, op.position) + content.slice(op.position + op.length);
}

/**
 * Apply one operation to a document, returning the new document.
 *
 * `content` is never mutated (strings are immutable in JS, and apply is written
 * to depend on nothing else). The switch is exhaustive over the `Op` union;
 * `noFallthroughCasesInSwitch` plus the discriminated union means a future
 * third op type breaks this function at compile time rather than silently
 * skipping a case.
 */
export function apply(content: string, op: Op): string {
  switch (op.type) {
    case "insert":
      return applyInsert(content, op);
    case "delete":
      return applyDelete(content, op);
  }
}
