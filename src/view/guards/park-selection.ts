/**
 * Park selection out of locked ranges (SPEC.md L7).
 * One step, no history, no scroll — callers must not add those.
 */

import { Annotation, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import type { Range } from "../../core/types.js";
import { lockedRangesFromState, type LockedRangeOpts } from "./locked-ranges.js";

const parkFollowUp = Annotation.define<boolean>();

function parkPos(pos: number, ranges: readonly Range[], docLen: number): number {
  let p = Math.max(0, Math.min(pos, docLen));
  for (let n = 0; n < ranges.length + 1; n++) {
    const hit = ranges.find((r) => p > r.from && p < r.to);
    if (!hit) return p;
    p = p - hit.from <= hit.to - p ? hit.from : Math.min(hit.to, docLen);
  }
  return p;
}

/** Move anchor and head to the nearest position outside any lock. */
export function parkSelection(
  sel: EditorSelection,
  ranges: readonly Range[],
  docLen: number,
): EditorSelection {
  if (ranges.length === 0) return sel;
  const next = sel.ranges.map((r) => {
    const anchor = parkPos(r.anchor, ranges, docLen);
    const head = parkPos(r.head, ranges, docLen);
    if (anchor === r.anchor && head === r.head) return r;
    return EditorSelection.range(anchor, head, r.goalColumn);
  });
  return EditorSelection.create(next, sel.mainIndex);
}

export function parkSelectionInState(state: EditorState, opts: LockedRangeOpts = {}): EditorSelection {
  return parkSelection(state.selection, lockedRangesFromState(state, opts), state.doc.length);
}

/** After doc/selection changes, rewrite a selection that landed in a lock (L7). */
export function selectionParkFilter(opts: LockedRangeOpts = {}): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (tr.annotation(parkFollowUp)) return tr;
    const sel = tr.selection ?? tr.startState.selection.map(tr.changes);
    const parked = parkSelection(
      sel,
      lockedRangesFromState(tr.state, opts),
      tr.state.doc.length,
    );
    if (parked.eq(sel)) return tr;
    return [
      tr,
      {
        selection: parked,
        sequential: true,
        filter: false,
        annotations: [Transaction.addToHistory.of(false), parkFollowUp.of(true)],
      },
    ];
  });
}
