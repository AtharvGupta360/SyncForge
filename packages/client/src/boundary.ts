/**
 * The Monaco anti-corruption boundary.
 *
 * Monaco is a third-party system with its own model of the world: it speaks in
 * line/column ranges, multi-cursor change batches, and editor-specific event
 * objects. None of that is allowed past this file. Everything downstream -- the
 * wire protocol, the pure core, its tests -- knows only about `Op`s over flat
 * character offsets. This module is the single seam that translates between the
 * two, so if Monaco's API ever shifts, exactly one file changes.
 *
 * Note what is NOT imported here: `monaco-editor`. An anti-corruption layer
 * defines its OWN input shape (`EditorChange` below) that happens to match the
 * fields we consume, rather than depending on the foreign library's types. That
 * is what keeps this file pure and unit-testable with no browser -- the actual
 * `editor.onDidChangeModelContent` wiring is the client shell's job, in the UI
 * phase, and its only responsibility is to hand us objects of this shape.
 */

import type { Op } from "@syncforge/shared";

/**
 * The subset of a Monaco content change we actually consume.
 *
 * Monaco's real `IModelContentChange` also carries a line/column `range`; we
 * deliberately drop it. It hands us `rangeOffset` (a flat character offset)
 * directly, which is exactly why ops.ts chose offsets over line/column -- the
 * translation stays arithmetic instead of newline-counting.
 *
 *   - `rangeOffset` flat offset where the replaced span begins
 *   - `rangeLength` how many characters the edit replaced (0 for a pure insert)
 *   - `text`        the replacement text ("" for a pure delete)
 */
export interface EditorChange {
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

/**
 * Translate one editor change event (possibly several simultaneous changes,
 * e.g. multi-cursor) into a flat list of `Op`s that is safe to apply in order.
 *
 * WHY DECOMPOSE. Monaco models every edit as "replace this range with this
 * text". Our primitives are only insert and delete, so a replace becomes a
 * delete followed by an insert at the same offset. Pure inserts and pure
 * deletes fall out as the degenerate cases (one of the two pieces is empty).
 *
 * WHY DELETE BEFORE INSERT (within one change). Both act at `rangeOffset`.
 * Delete first removes the old span; inserting the new text at that same offset
 * then lands it exactly where the old span was. Reverse the order and the
 * insert's coordinate would be inside the text about to be deleted.
 *
 * WHY HIGHEST OFFSET FIRST (across changes). Every change's `rangeOffset` is
 * measured against the document *before* this event. Apply a low-offset op
 * first and it shifts every character after it, invalidating the higher offsets
 * that were computed against the un-shifted document. Applying highest-offset
 * first means each op runs before anything below it can move it. We re-sort here
 * rather than trusting Monaco's ordering -- re-establishing the invariant we
 * depend on is the boundary's job, not an assumption about the source.
 *
 * (This is operational transform's core problem -- earlier edits invalidating
 * later coordinates -- in its simplest possible form. The real transform in
 * Phases 13-16 handles it across *clients* and *time*; here it is one event.)
 */
export function changesToOps(changes: readonly EditorChange[]): Op[] {
  const ordered = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);

  const ops: Op[] = [];
  for (const change of ordered) {
    if (change.rangeLength > 0) {
      ops.push({
        type: "delete",
        position: change.rangeOffset,
        length: change.rangeLength,
      });
    }
    if (change.text.length > 0) {
      ops.push({
        type: "insert",
        position: change.rangeOffset,
        text: change.text,
      });
    }
  }
  return ops;
}
