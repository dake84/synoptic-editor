// @vitest-environment happy-dom

/**
 *
 * Prose must not join schema headings or bound YAML (SPEC.md L8).
 */
import { deleteCharBackward, deleteCharForward } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { extraLockedGuards, extraLockedRanges, structureJoinFilter } from "../../../src/index.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [structureJoinFilter(FIXTURE_SCHEMA)],
    }),
    parent,
  });
  return { view };
}

describe("structureJoinFilter", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers L8, T141 */
  it("blocks backspace that would join prose into the schema heading above", () => {
    const doc = ["# Root", "body line", ""].join("\n");
    const { view } = mount(doc);
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  /** @covers L8, T141 */
  it("blocks delete that would join prose into the schema heading below", () => {
    const doc = ["# Root", "body line", "## Child", "child", ""].join("\n");
    const { view } = mount(doc);
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
    deleteCharForward(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  /** @covers L8, T141 */
  it("blocks delete that would join prose into the bound YAML fence below", () => {
    const doc = ["# Root", "body line", "---", "id: child", "---", "## Child", "x", ""].join("\n");
    const { view } = mount(doc);
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
    deleteCharForward(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  /** @covers L8 */
  it("blocks backspace at extraLockedRanges.from (host chrome unglue)", () => {
    const doc = ["plain above", "chrome line", "prose below", ""].join("\n");
    const chromeLine = { from: doc.indexOf("chrome line"), to: doc.indexOf("prose below") - 1 };
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [extraLockedRanges.of([chromeLine]), extraLockedGuards()],
      }),
      parent,
    });
    view.dispatch({ selection: { anchor: chromeLine.from } });
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
