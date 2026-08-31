// @vitest-environment happy-dom

/**
 *
 * Wysiwyg input escape (SPEC.md L2, L3).
 */
import { deleteCharBackward } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { escapeMarkdown, wysiwygGuards } from "../../../src/view/guards/wysiwyg.js";

function guarded(doc = "", locked = true) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [wysiwygGuards({ structureLocked: locked })],
  });
}

function typeInto(state: EditorState, text: string): EditorState {
  let next = state;
  for (const ch of text) {
    const at = next.selection.main.head;
    next = next.update({
      changes: { from: at, insert: ch },
      selection: EditorSelection.cursor(at + 1),
      userEvent: "input.type",
    }).state;
  }
  return next;
}

describe("wysiwyg input escape (L2)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers L2, T114 */
  it("masks typed meta in one pass; four hashes are not double-escaped", () => {
    expect(escapeMarkdown("#")).toBe("\\#");
    expect(escapeMarkdown("####")).toBe("\\#\\#\\#\\#");
    const after = typeInto(guarded(), "####");
    expect(after.doc.toString()).toBe("\\#\\#\\#\\#");
    expect(after.doc.toString()).not.toContain("\\\\#");
  });

  /** @covers L2, L3 */
  it("masks a multiline paste in one step", () => {
    const state = guarded("", false);
    const tr = state.update({
      changes: { from: 0, insert: "*hi*\n- item\n" },
      userEvent: "input.paste",
    });
    expect(tr.state.doc.toString()).toBe("\\*hi\\*\n\\- item\n");
  });

  /** @covers L2 */
  it("masks backslash, angles, and a list dash before whitespace", () => {
    expect(typeInto(guarded(), "C:\\x").doc.toString()).toBe("C:\\\\x");
    expect(typeInto(guarded(), "<tag").doc.toString()).toBe("\\<tag");
    const dash = guarded().update({
      changes: { from: 0, insert: "- x" },
      userEvent: "input.type",
    });
    expect(dash.state.doc.toString()).toBe("\\- x");
  });

  /** @covers L2, T116 */
  it("hides the mask backslash in wysiwyg and deletes it with the visible character", () => {
    const session = createSession({
      doc: `---
id: n0
---

# Root

\\#
`,
      schema: FIXTURE_SCHEMA,
    });
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "wysiwyg",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    expect(session.document).toContain("\\#");
    expect(host.textContent ?? "").toContain("#");

    const ev = view.editorView();
    expect(ev).not.toBeNull();
    const at = session.document.lastIndexOf("\\#");
    ev!.dispatch({
      changes: { from: at + 1, to: at + 2, insert: "" },
      userEvent: "delete.backward",
    });
    expect(session.document).not.toContain("\\#");

    view.destroy();
  });

  /** @covers L2 */
  it("maps the caret through an expanded mask-pair Backspace", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "\\#",
        selection: EditorSelection.cursor(2),
        extensions: [wysiwygGuards({ structureLocked: false })],
      }),
    });
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("");
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });
});
