/**
 * The document-state reducer -- the server's authority over ordering, as a pure
 * function.
 *
 * Phase 4's apply() gave one operation behaviour but knew nothing about *order*,
 * *versions*, or *who decides what happened first*. This file is the object the
 * whole protocol keeps promising exists: a `DocumentState` that owns the
 * content and its version, plus `accept()`, which decides whether a submitted
 * edit becomes a fact and, if so, stamps it with the authoritative sequence
 * number.
 *
 * It stays a PURE function in core on purpose. "The server is the sole authority
 * on ordering" (repeated all over protocol.ts) is a claim about *logic*, not
 * about sockets. Keeping that logic here means we can test total-ordering and
 * version rules with no server running -- and it lets the Socket.IO handler in
 * Phase 7 stay the boring shell it is supposed to be: decode bytes, call
 * accept(), send bytes.
 *
 * VERSION vs SEQUENCE -- why two names for numbers that are equal here
 * -------------------------------------------------------------------
 * `version`  labels a STATE: how many operations this document has absorbed.
 * `sequence` labels an EVENT: this operation's slot in the room's total order.
 *
 * For a single linear document they are numerically identical -- the op that
 * takes the document from version N to N+1 *is* the (N+1)th event -- and this
 * model keeps them so. They are not merged into one field because they answer
 * different questions, and the wire protocol already commits to both:
 * `RoomSnapshotMessage.version` is a state label a client will later quote back
 * as its `baseVersion`, while `OpBroadcastMessage.sequence` is the ordinal a
 * reconnecting client uses to say "replay me everything after 41". Honest note:
 * this is a conceptual distinction, not a numeric one -- do not expect them to
 * diverge in this single-document design.
 */

import type {
  DocumentVersion,
  Op,
  OpRejectMessage,
  Sequence,
} from "@syncforge/shared";

import { apply, InvalidOperationError } from "./apply.js";

/**
 * A document and the version it reflects. Immutable: `accept` returns a new one
 * rather than mutating, so a caller holding an old state still sees the old
 * document -- the same purity contract as apply, and what makes replay reasoning
 * sound when reconnect is built in Phase 20.
 */
export interface DocumentState {
  readonly content: string;
  readonly version: DocumentVersion;
}

/** The starting point for a fresh room: empty text at version 0. */
export function emptyDocument(): DocumentState {
  return { content: "", version: 0 };
}

/**
 * The outcome of submitting an operation.
 *
 * A discriminated union on `status`, so callers must handle both arms and the
 * shell can map an `accepted` result to `op:ack` + `op:broadcast` and a
 * `rejected` result to `op:reject` without guessing. `reason` reuses the exact
 * union from `OpRejectMessage`, so the set of refusals stays defined in one
 * place -- the wire protocol.
 */
export type AcceptResult =
  | {
      readonly status: "accepted";
      /** The new document state after applying the op. */
      readonly state: DocumentState;
      /** This op's authoritative slot in the total order (== state.version). */
      readonly sequence: Sequence;
    }
  | {
      readonly status: "rejected";
      readonly reason: OpRejectMessage["reason"];
    };

/**
 * Decide whether `op` -- submitted as written against `baseVersion` -- may join
 * the document's history, and if so produce the next state.
 *
 * Two gates, in order:
 *
 *   1. CAUSALITY. `baseVersion` must equal the current version. If it is behind,
 *      the client edited against a document the server has since moved past, so
 *      the op's coordinates may be stale -- reconciling that is operational
 *      transform, which arrives in Phases 13-16. Until then the only safe answer
 *      is a `stale-version` reject, and the client re-syncs from a snapshot. A
 *      `baseVersion` *ahead* of the server names a version that was never issued;
 *      it is impossible rather than merely stale, and is refused the same way.
 *
 *      >>> Deferred, not forgotten: when transform lands, the `baseVersion <
 *      version` branch stops being a reject and becomes "transform the op
 *      against operations version..current, then accept the transformed op."
 *
 *   2. VALIDITY. Even against the right version, the op's coordinates must fit
 *      the document. apply() is the authority on that; if it throws
 *      InvalidOperationError we translate to an `invalid-op` reject. Any other
 *      throw is a real bug and is intentionally left to propagate and crash.
 */
export function accept(
  state: DocumentState,
  op: Op,
  baseVersion: DocumentVersion,
): AcceptResult {
  if (baseVersion !== state.version) {
    return { status: "rejected", reason: "stale-version" };
  }

  let content: string;
  try {
    content = apply(state.content, op);
  } catch (error) {
    if (error instanceof InvalidOperationError) {
      return { status: "rejected", reason: "invalid-op" };
    }
    throw error;
  }

  const version = state.version + 1;
  return {
    status: "accepted",
    state: { content, version },
    // Equal to the new version by construction; see the header note on why the
    // two names are kept distinct even though the numbers coincide.
    sequence: version,
  };
}
