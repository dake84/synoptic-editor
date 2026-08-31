// @vitest-environment happy-dom

/**
 *
 * Enter must not punch blank lines through FM or headings (SPEC.md L4, FM2).
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { createSession } from "../../../src/session.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

Body paragraph.

---
id: child
---

## Child

Child body.
`;

describe("wysiwyg structure newline (L4, FM2)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mountWysiwyg(doc = DOC) {
    const session = createSession({
      doc,
      schema: FIXTURE_SCHEMA,
      policy: { frontmatterInWysiwyg: "hidden", structureEditingInWysiwyg: "locked" },
    });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "wysiwyg",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);
    return { session, view, host };
  }

  /** @covers L4 */
  it("four Enters at heading col 0 do not grow the document", () => {
    const { session, view } = mountWysiwyg();
    const heading = session.document.indexOf("# Root");
    const ev = view.editorView()!;
    ev.dispatch({ selection: EditorSelection.cursor(heading) });
    const before = session.document;
    for (let i = 0; i < 4; i++) {
      ev.dispatch({
        changes: { from: ev.state.selection.main.head, insert: "\n" },
        userEvent: "input.type",
      });
    }
    expect(session.document).toBe(before);
    view.destroy();
  });

  /** @covers FM2 */
  it("Enter on the blank between FM and heading does not insert", () => {
    const { session, view } = mountWysiwyg();
    const heading = session.document.indexOf("# Root");
    const blank = heading - 1;
    const ev = view.editorView()!;
    ev.dispatch({ selection: EditorSelection.cursor(blank) });
    const before = session.document;
    ev.dispatch({
      changes: { from: ev.state.selection.main.head, insert: "\n" },
      userEvent: "input.type",
    });
    expect(session.document).toBe(before);
    view.destroy();
  });

  /** @covers L4 */
  it("title characters remain editable", () => {
    const { session, view } = mountWysiwyg();
    const title = session.document.indexOf("Root");
    const ev = view.editorView()!;
    ev.dispatch({ selection: EditorSelection.cursor(title) });
    ev.dispatch({
      changes: { from: title, insert: "X" },
      userEvent: "input.type",
    });
    expect(session.document).toContain("XRoot");
    view.destroy();
  });

  /** @covers L4 */
  it("Enter in prose still inserts a newline", () => {
    const { session, view } = mountWysiwyg();
    const prose = session.document.indexOf("Body paragraph.");
    const ev = view.editorView()!;
    ev.dispatch({ selection: EditorSelection.cursor(prose + "Body paragraph.".length) });
    ev.dispatch({
      changes: { from: ev.state.selection.main.head, insert: "\n" },
      userEvent: "input.type",
    });
    expect(session.document).toContain("Body paragraph.\n");
    view.destroy();
  });
});
