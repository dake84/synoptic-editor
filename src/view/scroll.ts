/**
 * Scroll owner (I4): every programmatic scroll carries a required cause.
 * visibleNode is derived from scroll geometry, never from selection (T9).
 * Layout is not read during EditorView.update (T13, SPEC § 11.1.6).
 */

import { Annotation, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { nodeAtPosition } from "../core/tree.js";
import type { Tree } from "../core/types.js";

export const scrollCause = Annotation.define<string>();

export function scrollToPos(view: EditorView, pos: number, cause: string): void {
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: "start" }),
    annotations: [scrollCause.of(cause), Transaction.addToHistory.of(false)],
  });
}

/** Document position on the reading line. Never a pixel value (V3). */
export function readingLinePos(view: EditorView): number {
  return view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
}

/**
 * Pure visibleNode resolution (SETUP.md § 3): geometry is injected.
 */
export function visibleNodeFromGeometry(
  tree: Tree,
  scrollTop: number,
  lineAtHeight: (y: number) => { from: number },
): string | null {
  const block = lineAtHeight(scrollTop);
  return nodeAtPosition(tree, block.from)?.id ?? null;
}

export function visibleNodeFromView(view: EditorView, tree: Tree): string | null {
  return visibleNodeFromGeometry(tree, view.scrollDOM.scrollTop, (y) => view.lineBlockAtHeight(y));
}
