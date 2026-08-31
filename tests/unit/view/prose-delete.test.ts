// @vitest-environment happy-dom

/**
 * Plain-prose delete under Host Lab policy (dogfood A02 / A03 / A05).
 * Guards must not leave sticky remnants in ordinary body text.
 */
import { deleteCharBackward } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";

import { createSession } from "../../../src/session.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

Hello line.

Second line here.
`;

describe("prose delete under host-lab policy (dogfood A)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mount() {
    const session = createSession({
      doc: DOC,
      schema: FIXTURE_SCHEMA,
      policy: {
        frontmatterInWysiwyg: "hidden",
        headingEditingInWysiwyg: "inline",
        structureEditingInWysiwyg: "allowed",
      },
    });
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "wysiwyg",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);
    return { session, view, editor: view.editorView()! };
  }

  /** @covers L5 */
  it("A02: Backspace clears a prose line including the last character", () => {
    const { session, view, editor } = mount();
    const hello = session.document.indexOf("Hello line.");
    expect(hello).toBeGreaterThanOrEqual(0);
    editor.dispatch({
      selection: EditorSelection.cursor(hello + "Hello line.".length),
    });
    for (let i = 0; i < "Hello line.".length; i++) {
      deleteCharBackward(editor);
    }
    expect(session.document).not.toContain("Hello");
    expect(session.document).toContain("Second line here.");
    expect(session.document).toContain("# Root");
    view.destroy();
  });

  /** @covers L5 */
  it("A03: deleting a selected prose paragraph leaves no sticky remnant", () => {
    const { session, view, editor } = mount();
    const hello = session.document.indexOf("Hello line.");
    editor.dispatch({
      selection: EditorSelection.range(hello, hello + "Hello line.".length),
    });
    editor.dispatch({
      changes: {
        from: editor.state.selection.main.from,
        to: editor.state.selection.main.to,
        insert: "",
      },
      userEvent: "delete.selection",
    });
    expect(session.document).not.toContain("Hello");
    expect(session.document).toContain("Second line here.");
    view.destroy();
  });

  /** @covers L5 */
  it("A05: multi-line select replace clears both lines", () => {
    const { session, view, editor } = mount();
    const from = session.document.indexOf("Hello line.");
    const to = session.document.indexOf("Second line here.") + "Second line here.".length;
    editor.dispatch({ selection: EditorSelection.range(from, to) });
    editor.dispatch({
      changes: {
        from: editor.state.selection.main.from,
        to: editor.state.selection.main.to,
        insert: "Replaced.",
      },
      userEvent: "input.type",
    });
    expect(session.document).toContain("Replaced.");
    expect(session.document).not.toContain("Hello line.");
    expect(session.document).not.toContain("Second line here.");
    expect(session.document).toContain("# Root");
    view.destroy();
  });
});
