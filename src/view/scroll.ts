/**
 * Scroll owner (I4): every programmatic scroll carries a required cause.
 * visibleNode is derived from scroll geometry, never from selection (T9).
 * Layout is not read during EditorView.update (T13, SPEC § 11.1.6).
 */

import { Annotation, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { nodeAtPosition } from "../core/tree.js";
import type { Range, Tree } from "../core/types.js";

export const scrollCause = Annotation.define<string>();

export function scrollToPos(view: EditorView, pos: number, cause: string): void {
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: "start" }),
    annotations: [scrollCause.of(cause), Transaction.addToHistory.of(false)],
  });
}

export function clipPosToRange(pos: number, range: Range): number {
  if (range.to <= range.from) return range.from;
  return Math.min(Math.max(pos, range.from), range.to - 1);
}

/** Document position on the reading line. Never a pixel value (V3). */
export function readingLinePos(view: EditorView, range?: Range): number {
  const pos = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
  return range ? clipPosToRange(pos, range) : pos;
}

/**
 * Pure visibleNode resolution (SETUP.md § 3): geometry is injected.
 * `range` is renderRange(view) — a Hide-replace at offset 0 must not report a
 * node outside the excerpt (T118).
 */
export function visibleNodeFromGeometry(
  tree: Tree,
  scrollTop: number,
  lineAtHeight: (y: number) => { from: number },
  range?: Range,
): string | null {
  const block = lineAtHeight(scrollTop);
  const pos = range ? clipPosToRange(block.from, range) : block.from;
  return nodeAtPosition(tree, pos)?.id ?? null;
}

export function visibleNodeFromView(view: EditorView, tree: Tree, range?: Range): string | null {
  return visibleNodeFromGeometry(
    tree,
    view.scrollDOM.scrollTop,
    (y) => view.lineBlockAtHeight(y),
    range,
  );
}
