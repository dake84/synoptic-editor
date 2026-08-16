/**
 * @vitest-environment happy-dom
 *
 * Markdown source commands (SPEC.md C1–C3).
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  insertListPrefix,
  setHeadingLevel,
  toggleWrapSelection,
} from "../../../src/view/commands.js";

function mount(doc: string, anchor = 0): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    parent,
    selection: EditorSelection.cursor(anchor),
  });
  return view;
}

describe("markdown commands (C1–C3)", () => {
  /** @covers C1 */
  it("replaces or inserts an ATX prefix without schema knowledge", () => {
    const view = mount("Title", 0);
    setHeadingLevel(view, 2);
    expect(view.state.doc.toString()).toBe("## Title");
    setHeadingLevel(view, 1);
    expect(view.state.doc.toString()).toBe("# Title");
    view.destroy();
  });

  /** @covers C2 */
  it("adds, switches, and unwraps a list marker on the current line", () => {
    const view = mount("A paragraph.", 2);
    insertListPrefix(view, "-");
    expect(view.state.doc.toString()).toBe("- A paragraph.");
    insertListPrefix(view, "1.");
    expect(view.state.doc.toString()).toBe("1. A paragraph.");
    insertListPrefix(view, "1.");
    expect(view.state.doc.toString()).toBe("A paragraph.");
    view.destroy();
  });

  /** @covers C3 */
  it("expands an empty caret to the word, then wraps it", () => {
    const view = mount("Hello world.", 1);
    toggleWrapSelection(view, "**");
    expect(view.state.doc.toString()).toBe("**Hello** world.");
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(7);
    view.destroy();
  });
});
