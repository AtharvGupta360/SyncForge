/**
 * transform -- operational transform, the convergent-editing core.
 *
 * This is the hardest code in the project, and the reason apply() and the flat
 * offset model were built first: everything here is defined against them.
 *
 * THE PROBLEM
 * -----------
 * Two clients hold the same document at the same version and edit it
 * concurrently -- `a` and `b`, each written against that shared base. One is
 * applied first, say `a`; now `b` addresses coordinates that no longer exist.
 * `transform` rewrites `b` into `b'` -- "`b`, as if written after `a`" -- and
 * symmetrically `a` into `a'`, so the two orders reconverge:
 *
 *     applyAll(apply(doc, a), b')  ===  applyAll(apply(doc, b), a')     (TP1)
 *
 * TP1 (convergence) is the definition of correctness, and apply is the oracle
 * that checks it -- see transform.test.ts, which throws random concurrent edits
 * at it and asserts both orders yield byte-identical docs.
 *
 * WHY THE RETURN TYPE IS Op[]
 * ---------------------------
 * A delete can SPLIT. If a concurrent insert lands strictly inside a delete's
 * range, the deleter never meant to remove that inserted text, so the one delete
 * becomes two -- around the insert. No single Op can express that, so transform
 * returns a list (length 0, 1, or 2). The other cases just return one element.
 *
 * THE TIE-BREAK
 * -------------
 * Only insert/insert is ambiguous: two inserts at the same offset need an agreed
 * order or the two sides diverge ("AB" vs "BA"). `side` imposes it -- "left" is
 * earlier, "right" shifts past. Every other case has a determinate answer and
 * ignores `side`.
 */

import type { DeleteOp, InsertOp, Op } from "@syncforge/shared";

/** Breaks insert/insert ties. "left" is earlier (stays put); "right" shifts. */
export type Side = "left" | "right";

/**
 * Rewrite `op` to apply correctly after `against`, given both were written
 * against the same base document. Returns 0-2 ops (see the split, above).
 */
export function transform(op: Op, against: Op, side: Side): Op[] {
  if (op.type === "insert") {
    return against.type === "insert"
      ? [transformInsertInsert(op, against, side)]
      : [transformInsertDelete(op, against)];
  }
  return against.type === "insert"
    ? transformDeleteInsert(op, against)
    : transformDeleteDelete(op, against);
}

/**
 * insert vs insert. `against` shifts `op` right by its length exactly when it
 * lands strictly before `op`, or at the same offset while winning the tie.
 */
function transformInsertInsert(
  op: InsertOp,
  against: InsertOp,
  side: Side,
): InsertOp {
  const before =
    against.position < op.position ||
    (against.position === op.position && side === "right");
  return before
    ? { ...op, position: op.position + against.text.length }
    : op;
}

/**
 * insert vs delete. The delete removed `[dStart, dEnd)`; move the insert into
 * the post-delete coordinate system. If the insert's anchor was inside the
 * deleted range, it collapses to the start of the hole.
 */
function transformInsertDelete(op: InsertOp, against: DeleteOp): InsertOp {
  const dStart = against.position;
  const dEnd = against.position + against.length;

  if (dEnd <= op.position) {
    return { ...op, position: op.position - against.length };
  }
  if (dStart >= op.position) {
    return op;
  }
  return { ...op, position: dStart };
}

/**
 * delete vs insert -- the splitting case. The insert of length `L` at `i`:
 *   - at/before the delete -> the whole delete shifts right by `L`.
 *   - at/after the delete  -> unchanged.
 *   - strictly inside      -> split around the inserted text, which survives.
 * The two pieces are returned highest-offset-first so applying them in sequence
 * keeps each one's coordinates valid (the same rule as the Monaco boundary).
 */
function transformDeleteInsert(op: DeleteOp, against: InsertOp): Op[] {
  const i = against.position;
  const L = against.text.length;
  const dStart = op.position;
  const dEnd = op.position + op.length;

  if (i <= dStart) {
    return [{ ...op, position: dStart + L }];
  }
  if (i >= dEnd) {
    return [op];
  }

  const before: DeleteOp = { type: "delete", position: dStart, length: i - dStart };
  const after: DeleteOp = { type: "delete", position: i + L, length: dEnd - i };
  return [after, before];
}

/**
 * delete vs delete. Whatever `against` already removed must not be removed
 * again, so the survivor deletes `length - overlap`, positioned back by however
 * much of `against` fell before it. Fully subsumed -> nothing left to do.
 */
function transformDeleteDelete(op: DeleteOp, against: DeleteOp): Op[] {
  const aStart = op.position;
  const aEnd = op.position + op.length;
  const bStart = against.position;
  const bEnd = against.position + against.length;

  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const length = op.length - overlap;
  if (length <= 0) {
    return [];
  }

  const removedBefore = Math.max(0, Math.min(bEnd, aStart) - bStart);
  return [{ type: "delete", position: aStart - removedBefore, length }];
}
