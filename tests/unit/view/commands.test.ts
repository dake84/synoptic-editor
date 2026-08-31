/**
 * @vitest-environment happy-dom
 *
 * Markdown source commands (SPEC.md C1–C3).
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  insertListPrefix,
  setHeadingLevel,
  toggleWrapSelection,
} from "../../../src/view/commands.js";
import { wysiwygGuards } from "../../../src/view/guards/wysiwyg.js";

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

function guardedMount(doc: string, anchor = 0, structureLocked = false): EditorView {
  const parent = document.createElement("div");
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(anchor),
      extensions: [wysiwygGuards({ structureLocked })],
    }),
  });
}

function typeChar(view: EditorView, ch: string): void {
  const at = view.state.selection.main.head;
  view.dispatch({
    changes: { from: at, insert: ch },
    selection: EditorSelection.cursor(at + 1),
    userEvent: "input.type",
  });
}

describe("format commands under wysiwyg L2 (C4)", () => {
  /** @covers C4 */
  it("inserts real markers for list, italic, and nested bold — no mask backslashes", () => {
    const view = guardedMount("Hallo", 2);

    insertListPrefix(view, "-");
    expect(view.state.doc.toString()).toBe("- Hallo");

    toggleWrapSelection(view, "*");
    expect(view.state.doc.toString()).toBe("- *Hallo*");

    toggleWrapSelection(view, "**");
    expect(view.state.doc.toString()).toBe("- ***Hallo***");
    expect(view.state.doc.toString()).not.toContain("\\");
    view.destroy();
  });

  /** @covers C4 */
  it("wraps an existing real marker run without adding backslashes", () => {
    const view = guardedMount("*Hallo*", 3);
    toggleWrapSelection(view, "**");
    expect(view.state.doc.toString()).toBe("***Hallo***");
    view.destroy();
  });

  /** @covers C4 */
  it("setHeadingLevel writes a real ATX marker where structure editing is allowed, but stays under the lock", () => {
    const open = guardedMount("Hallo", 2, false);
    setHeadingLevel(open, 3);
    expect(open.state.doc.toString()).toBe("### Hallo");
    open.destroy();

    const locked = guardedMount("Hallo", 2, true);
    setHeadingLevel(locked, 3);
    expect(locked.state.doc.toString()).toBe("Hallo");
    locked.destroy();
  });

  /** @covers C4, L1 */
  it("does not add backslashes to an existing real marker run when wrapping an adjacent word", () => {
    const view = guardedMount("x **y**", 0, false);
    toggleWrapSelection(view, "*");
    expect(view.state.doc.toString()).toBe("*x* **y**");
    view.destroy();
  });

  /** @covers C4, IM3 */
  it("still masks typed and pasted meta with the guards mounted", () => {
    const typed = guardedMount("", 0);
    typeChar(typed, "*");
    expect(typed.state.doc.toString()).toBe("\\*");
    typed.destroy();

    const pasted = guardedMount("", 0);
    pasted.dispatch({
      changes: { from: 0, insert: "*hi*" },
      userEvent: "input.paste",
    });
    expect(pasted.state.doc.toString()).toBe("\\*hi\\*");
    pasted.destroy();
  });
});
