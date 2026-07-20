/**
 * transform -- operational transform, the convergent-editing core.
 *
 * This is the hardest code in the project, and the reason apply() and the flat
 * offset model were built first: everything here is defined against them.
 *
 * THE PROBLEM
 * -----------
 * Two clients hold the same document at the same version and edit it
 * concurrently -- `a` and `b`, each written against that shared base. The server
 * (or a client) applies one first, say `a`. Now `b` addresses coordinates that
 * no longer exist: `a` may have shifted everything after it. `transform` rewrites
 * `b` into `b'` -- "`b`, as if it had been written after `a`" -- and symmetrically
 * `a` into `a'`, so that the two orders reconverge:
 *
 *     apply(apply(doc, a), b')  ===  apply(apply(doc, b), a')          (TP1)
 *
 * TP1 (convergence / "transform property 1") is the definition of correctness.
 * apply is the oracle that checks it -- see transform.test.ts, which generates
 * random concurrent edits and asserts both orders yield byte-identical docs.
 *
 * THE TIE-BREAK
 * -------------
 * When both ops insert at the SAME position, someone must go first, and both
 * machines must independently agree who -- otherwise one produces "AB", the
 * other "BA", and they never reconverge. There is no natural winner, so we
 * impose a total order with `side`: the "left" op is treated as earlier, so a
 * "right" insert at the same offset shifts past it. The caller assigns sides
 * consistently (one op left, the other right); at the integration point that
 * mapping comes from the server's sequence order.
 *
 * SCOPE (this phase)
 * ------------------
 * Only insert/insert is implemented. The delete-involving cases throw, on
 * purpose -- delete-vs-interior-insert can force one delete to split into two,
 * which the single-op return type here cannot express, and that machinery is its
 * own phase.
 */

import type { InsertOp, Op } from "@syncforge/shared";

/**
 * Breaks insert/insert ties. "left" is treated as the earlier op, so it keeps
 * its position; "right" shifts past a same-position concurrent insert.
 */
export type Side = "left" | "right";

/**
 * Rewrite `op` so it applies correctly to a document that has already had
 * `against` applied, given both were written against the same base.
 */
export function transform(op: Op, against: Op, side: Side): Op {
  if (op.type === "insert" && against.type === "insert") {
    return transformInsertInsert(op, against, side);
  }

  // >>> Next phases: insert/delete, delete/insert, delete/delete. The last two
  // must cope with overlapping ranges, and a delete meeting an insert inside its
  // range needs to split -- which is why `transform` will grow to return Op[].
  throw new Error(
    `transform: ${op.type} vs ${against.type} not implemented yet`,
  );
}

/**
 * Both insert. `against` shifts `op` right by its text length exactly when it
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

  if (before) {
    return { ...op, position: op.position + against.text.length };
  }
  return op;
}
