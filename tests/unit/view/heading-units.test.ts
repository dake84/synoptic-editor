/**
 * @vitest-environment happy-dom
 *
 * Heading units (LH1–LH4).
 */
import { deleteCharBackward } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  extraLockedGuards,
  extraLockedRanges,
  headingUnitGuards,
  headingUnitRanges,
  hiddenFrontmatterGuards,
  hostWriteAnnotation,
} from "../../../src/index.js";
import { headingUnitAtBoundary, selectHeadingUnitBackward } from "../../../src/view/guards/heading-units.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

Body.
`;

const CHILD = `---
id: n0
---
# Root

---
id: n1
---
## Child

Prose.
`;

function mount(doc = DOC, editing: "locked" | "inline" = "locked") {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        headingUnitGuards(FIXTURE_SCHEMA, { editing }),
        ...(editing === "inline" ? [hiddenFrontmatterGuards(FIXTURE_SCHEMA)] : []),
      ],
    }),
    parent,
  });
  return { view, parent };
}

describe("headingUnitGuards", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers LH1, T136 */
  it("rejects a point insert in the title", () => {
    const { view } = mount();
    const titleAt = DOC.indexOf("Root");
    const before = view.state.doc.toString();
    view.dispatch({ changes: { from: titleAt, to: titleAt, insert: "X" } });
    expect(view.state.doc.toString()).toBe(before);
  });

  /** @covers LH1, L5 */
  it("allows a host write through the unit", () => {
    const { view } = mount();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "# Root\n\nBody.\n" },
      annotations: [hostWriteAnnotation.of(true)],
    });
    expect(view.state.doc.toString()).toBe("# Root\n\nBody.\n");
  });

  /** @covers LH2, T137 */
  it("selects the unit on Backspace at the trailing boundary", () => {
    const { view } = mount();
    const [unit] = headingUnitRanges(DOC, FIXTURE_SCHEMA);
    expect(unit).toBeTruthy();
    expect(headingUnitAtBoundary(DOC, FIXTURE_SCHEMA, unit!.to, "backward")).toEqual(unit);
    view.dispatch({ selection: EditorSelection.cursor(unit!.to) });
    expect(selectHeadingUnitBackward(view)).toBe(true);
    const sel = view.state.selection.main;
    expect(sel.from).toBe(unit!.from);
    expect(sel.to).toBe(unit!.to);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  /** @covers LH3, T138 */
  it("deletes a fully covered unit and rejects a partial title delete", () => {
    const { view } = mount();
    const [unit] = headingUnitRanges(DOC, FIXTURE_SCHEMA);
    const before = view.state.doc.toString();
    const titleAt = DOC.indexOf("Root");
    view.dispatch({ changes: { from: titleAt, to: titleAt + 1, insert: "" } });
    expect(view.state.doc.toString()).toBe(before);

    view.dispatch({ changes: { from: unit!.from, to: unit!.to, insert: "" } });
    expect(view.state.doc.toString()).toBe("\nBody.\n");
  });

  /** @covers LH3, T138 */
  it("allows select-all deletion", () => {
    const { view } = mount();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    expect(view.state.doc.toString()).toBe("");
  });
});

describe("headingUnitGuards inline", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers LH4, T143 */
  it("removing the last title character deletes YAML and the ATX line", () => {
    const { view } = mount(CHILD, "inline");
    const titleAt = CHILD.indexOf("Child");
    view.dispatch({ selection: EditorSelection.cursor(titleAt + "Child".length) });
    for (let i = 0; i < "Child".length; i++) {
      deleteCharBackward(view);
    }
    const doc = view.state.doc.toString();
    expect(doc).not.toContain("id: n1");
    expect(doc).not.toContain("##");
    expect(doc).toContain("id: n0");
    expect(doc).toContain("Prose.");
  });

  /** @covers LH4, T143 */
  it("Backspace on an already-empty ATX line deletes the unit", () => {
    const empty = CHILD.replace("## Child", "## ");
    const { view } = mount(empty, "inline");
    const at = empty.indexOf("## ");
    view.dispatch({ selection: EditorSelection.cursor(at) });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
    );
    const doc = view.state.doc.toString();
    expect(doc).not.toContain("id: n1");
    expect(doc).toContain("Prose.");
  });

  /** @covers LH4, T143 */
  it("Enter in the title does not delete the unit", () => {
    const { view } = mount(CHILD, "inline");
    const titleAt = CHILD.indexOf("Child");
    view.dispatch({
      changes: { from: titleAt, to: titleAt, insert: "\n" },
      selection: { anchor: titleAt + 1 },
      userEvent: "input",
    });
    const doc = view.state.doc.toString();
    expect(doc).toContain("id: n1");
    expect(doc).toContain("Child");
    expect(doc).toContain("Prose.");
  });

  /** @covers LH4, T143 */
  it("does not delete an extra-locked heading unit", () => {
    const empty = CHILD.replace("# Root", "# ");
    const [unit] = headingUnitRanges(empty, FIXTURE_SCHEMA);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: empty,
        extensions: [
          headingUnitGuards(FIXTURE_SCHEMA, { editing: "inline" }),
          hiddenFrontmatterGuards(FIXTURE_SCHEMA),
          extraLockedGuards(),
          extraLockedRanges.of([unit!]),
        ],
      }),
      parent,
    });
    view.dispatch({ selection: EditorSelection.cursor(unit!.from) });
    const before = view.state.doc.toString();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });
});
