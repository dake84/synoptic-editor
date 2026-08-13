import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { annotateGuard, minimalGuardFilter } from "../../../src/view/guards/minimal.js";

describe("minimalGuardFilter", () => {
  /** @covers L2 */
  it("masks markdown syntax in wysiwyg via annotations", () => {
    const state = EditorState.create({
      doc: "Hello",
      extensions: [minimalGuardFilter],
    });
    const tr = state.update(
      annotateGuard("v1", "wysiwyg", {
        changes: { from: 5, to: 5, insert: "#" },
      }),
    );
    expect(tr.newDoc.toString()).toBe("Hello\\#");
  });

  /** @covers L1 */
  it("expands partial marker deletes in wysiwyg", () => {
    const state = EditorState.create({
      doc: "# Title\n\nBody",
      extensions: [minimalGuardFilter],
    });
    // Delete only the space after '#'
    const tr = state.update(
      annotateGuard("v1", "wysiwyg", {
        changes: { from: 1, to: 2, insert: "" },
      }),
    );
    expect(tr.newDoc.toString().startsWith("#")).toBe(false);
    expect(tr.newDoc.toString()).toContain("Title");
  });

  it("does not mask in source presentation", () => {
    const state = EditorState.create({
      doc: "Hello",
      extensions: [minimalGuardFilter],
    });
    const tr = state.update(
      annotateGuard("v1", "source", {
        changes: { from: 5, to: 5, insert: "#" },
      }),
    );
    expect(tr.newDoc.toString()).toBe("Hello#");
  });
});
