// @vitest-environment happy-dom

/**
 *
 * Host extra locks: edit filter (L5) and optional atomic ranges (L6).
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  extraAtomicRanges,
  extraLockedGuards,
  extraLockedRanges,
  hostWriteAnnotation,
} from "../../../src/index.js";

const DOC = "# Title\n\nBody.\n";
const TITLE = { from: 0, to: DOC.indexOf("\n") };

function mount(opts: { lock?: boolean; atomic?: boolean } = {}) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        opts.lock === false ? [] : extraLockedRanges.of([TITLE]),
        opts.atomic ? extraAtomicRanges.of([TITLE]) : [],
        extraLockedGuards(),
      ],
    }),
    parent,
  });
  return { view, parent };
}

describe("extraLockedGuards", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("blocks a raw insert inside an extra-locked range", () => {
    const { view } = mount();
    view.dispatch({ changes: { from: 2, to: 2, insert: "x" } });
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("allows a host write annotated as L5", () => {
    const { view } = mount();
    view.dispatch({
      changes: { from: 2, to: 7, insert: "Next" },
      annotations: [hostWriteAnnotation.of(true)],
    });
    expect(view.state.doc.toString()).toBe("# Next\n\nBody.\n");
  });

  it("allows undo through extra locks", () => {
    const { view } = mount();
    view.dispatch({
      changes: { from: 2, to: 7, insert: "Next" },
      annotations: [hostWriteAnnotation.of(true)],
    });
    view.dispatch({
      changes: { from: 2, to: 6, insert: "Title" },
      userEvent: "undo",
    });
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("marks extraAtomicRanges as atomic without locking edits", () => {
    const { view } = mount({ lock: false, atomic: true });
    view.dispatch({ changes: { from: 2, to: 2, insert: "x" } });
    expect(view.state.doc.toString()).toBe("# xTitle\n\nBody.\n");

    let atomic = false;
    for (const fn of view.state.facet(EditorView.atomicRanges)) {
      fn(view).between(TITLE.from, TITLE.to, () => {
        atomic = true;
      });
    }
    expect(atomic).toBe(true);
  });
});
