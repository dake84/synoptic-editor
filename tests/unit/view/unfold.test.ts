/**
 * @vitest-environment happy-dom
 *
 * Unfold overlapping folds before reveal (SPEC.md F11).
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeFolding, foldEffect, foldState } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { unfoldOverlappingFolds } from "../../../src/view/unfold.js";

describe("unfold overlapping folds (F11)", () => {
  /** @covers F11 */
  it("opens folds that overlap the range and is a no-op when none remain", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "aaaa\nbbbb\ncccc\ndddd\n",
        extensions: [codeFolding()],
      }),
      parent,
    });
    view.dispatch({ effects: foldEffect.of({ from: 0, to: 10 }) });
    expect(view.state.field(foldState, false)?.size).toBeGreaterThan(0);
    expect(unfoldOverlappingFolds(view, 2, 4)).toBe(true);
    expect(unfoldOverlappingFolds(view, 2, 4)).toBe(false);
    view.destroy();
  });
});
