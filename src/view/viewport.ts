/**
 * Viewport padding over CM6 visibleRanges (SPEC.md G8).
 */

import type { EditorView } from "@codemirror/view";
import { padDocRanges, VIEWPORT_PAD, type DocRange } from "../core/viewport.js";

export { padDocRanges, VIEWPORT_PAD, type DocRange };

export function paddedVisibleRanges(view: EditorView, pad = VIEWPORT_PAD): DocRange[] {
  return padDocRanges(view.visibleRanges, view.state.doc.length, pad);
}
