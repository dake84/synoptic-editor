/**
 * @vitest-environment happy-dom
 *
 * Hidden frontmatter (FM9): leading blank after the previous heading stays visible.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { hiddenFrontmatterGuards } from "../../../src/index.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = ["# Root", "", "---", "id: child", "---", "", "## Child", "body", ""].join("\n");

function mount(doc = DOC) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [hiddenFrontmatterGuards(FIXTURE_SCHEMA)],
    }),
    parent,
  });
  return { view, parent };
}

describe("hiddenFrontmatterGuards", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers FM9, T139 */
  it("keeps the blank after the previous heading visible and hides the YAML fence", () => {
    const { parent } = mount();
    const lines = [...parent.querySelectorAll(".cm-line")];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]!.textContent).toContain("Root");
    expect((lines[1]!.textContent ?? "").trim()).toBe("");
    expect(lines[1]!.classList.contains("syn-fm-hidden-line")).toBe(false);

    const hidden = [...parent.querySelectorAll(".syn-fm-hidden-line")];
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.some((el) => (el.textContent ?? "").includes("---"))).toBe(false);
    expect(parent.textContent ?? "").not.toContain("id: child");
    expect(parent.textContent ?? "").toContain("Root");
    expect(parent.textContent ?? "").toContain("Child");
  });

  /** @covers FM9, T140 */
  it("allows typing on the blank after the previous heading", () => {
    const { view } = mount();
    const blank = view.state.doc.line(2);
    expect(blank.text).toBe("");
    view.dispatch({ selection: { anchor: blank.from } });
    expect(view.state.selection.main.head).toBe(blank.from);
    view.dispatch({ changes: { from: blank.from, to: blank.from, insert: "note" } });
    expect(view.state.doc.line(2).text).toBe("note");
    expect(view.state.doc.toString()).toContain("---\nid: child");
  });

  /** @covers FM2, T140 */
  it("rejects Backspace that would join a heading line with the fence", () => {
    const tight = ["# Root", "---", "id: child", "---", "", "## Child", "body", ""].join("\n");
    const { view } = mount(tight);
    const fence = tight.indexOf("---\nid: child");
    const before = view.state.doc.toString();
    view.dispatch({ changes: { from: fence - 1, to: fence, insert: "" } });
    expect(view.state.doc.toString()).toBe(before);
  });
});
