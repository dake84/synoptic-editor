/**
 * Unfold overlapping folds before a reveal (SPEC.md F11).
 */

import { foldState, unfoldEffect } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

/** Unfold every fold that overlaps `[from, to)`. Returns true when a fold was opened. */
export function unfoldOverlappingFolds(view: EditorView, from: number, to: number): boolean {
  const folded = view.state.field(foldState, false);
  if (!folded) return false;
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  folded.between(0, view.state.doc.length, (foldFrom, foldTo) => {
    if (foldFrom < to && foldTo > from) {
      effects.push(unfoldEffect.of({ from: foldFrom, to: foldTo }));
    }
  });
  if (effects.length === 0) return false;
  view.dispatch({ effects });
  return true;
}
