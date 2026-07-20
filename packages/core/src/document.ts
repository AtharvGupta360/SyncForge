/**
 * The document-state reducer -- the server's authority over ordering, now with
 * concurrency support via history-based rebasing.
 *
 * Phase 5 made this the sole authority on ordering but rejected any op whose
 * `baseVersion` was behind the server. Phase 12 lifts that restriction: a stale
 * op is REBASED -- transformed against the operations it missed -- and then
 * accepted. That is what lets two clients edit the same version concurrently and
 * still converge.
 *
 * WHY A HISTORY
 * -------------
 * To transform an incoming op against what it missed, the server must still HAVE
 * those ops. So state carries `history` -- every accepted op, in order -- with
 * the invariant `version === history.length`. A submission written against
 * `baseVersion = N` missed exactly `history[N..]`.
 *
 * Crucially the history stores ops AS APPLIED (each already rebased when it was
 * accepted), so every entry is written against the version just before it. The
 * rebase fold relies on that: transforming the incoming op against `history[N]`,
 * then that result against `history[N+1]`, and so on, keeps both operands
 * written against the same version at every step.
 *
 * VERSION vs SEQUENCE
 * -------------------
 * `version` labels a state (ops absorbed); `sequence` labels the resulting
 * position in the total order. For a single document they still coincide -- both
 * equal `history.length` -- but note one submission can add MORE than one op:
 * a rebased delete can split around a concurrent insert, so `version` may jump by
 * two. A fully-redundant op (deleting what was already deleted) rebases to
 * nothing and advances neither.
 */

import type {
  DocumentVersion,
  Op,
  OpRejectMessage,
  Sequence,
} from "@syncforge/shared";

import { apply, InvalidOperationError } from "./apply.js";
import { transform } from "./transform.js";

export interface DocumentState {
  readonly content: string;
  readonly version: DocumentVersion;
  /** Every accepted op, in order. `version === history.length`, always. */
  readonly history: readonly Op[];
}

/** A fresh room: empty text, version 0, no history. */
export function emptyDocument(): DocumentState {
  return { content: "", version: 0, history: [] };
}

export type AcceptResult =
  | {
      readonly status: "accepted";
      readonly state: DocumentState;
      /** The room's version after this submission (== new history length). */
      readonly sequence: Sequence;
      /** The effective op(s) actually applied -- rebased, possibly split, maybe
       *  empty. These, not the raw submission, are what peers must receive. */
      readonly ops: readonly Op[];
    }
  | {
      readonly status: "rejected";
      readonly reason: OpRejectMessage["reason"];
    };

/**
 * Transform `op` forward across the ops it missed, returning the effective op(s)
 * in the current coordinate system. `op` is always the newer, "right" side.
 */
function rebase(op: Op, missed: readonly Op[]): Op[] {
  let ops: Op[] = [op];
  for (const historic of missed) {
    ops = ops.flatMap((o) => transform(o, historic, "right"));
  }
  return ops;
}

/**
 * Admit `op` (written against `baseVersion`) into the document's history and
 * produce the next state.
 *
 *   - `baseVersion` outside `[0, version]` is impossible -> `stale-version`.
 *   - otherwise rebase against `history[baseVersion..]`, then apply. If any
 *     rebased piece does not fit the document, the op is `invalid-op`.
 */
export function accept(
  state: DocumentState,
  op: Op,
  baseVersion: DocumentVersion,
): AcceptResult {
  if (
    !Number.isInteger(baseVersion) ||
    baseVersion < 0 ||
    baseVersion > state.version
  ) {
    return { status: "rejected", reason: "stale-version" };
  }

  const missed = state.history.slice(baseVersion);
  const effective = rebase(op, missed);

  let content = state.content;
  try {
    for (const piece of effective) {
      content = apply(content, piece);
    }
  } catch (error) {
    if (error instanceof InvalidOperationError) {
      return { status: "rejected", reason: "invalid-op" };
    }
    throw error;
  }

  const history = [...state.history, ...effective];
  return {
    status: "accepted",
    state: { content, version: history.length, history },
    sequence: history.length,
    ops: effective,
  };
}
