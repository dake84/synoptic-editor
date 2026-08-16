/**
 * @vitest-environment happy-dom
 *
 * Generic protected-range widget building blocks (src/view/widgets/protected.ts).
 * Non-editable, non-deletable widgets; recipe: spikes/heading-widgets/protected-heading.ts.
 */
import { EditorSelection, EditorState, StateField } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  protectedAtomicField,
  protectedWidgetExtension,
  preventProtectedDeletionFilter,
  setProtectedActiveMatch,
  type ProtectedRange,
} from "../../../src/view/widgets/protected.js";

const DOC = "before\n## Heading One\nmiddle\n## Heading Two\nafter";

function headingRanges(doc: string): ProtectedRange[] {
  const out: ProtectedRange[] = [];
  const re = /^##[^\n]*/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) out.push({ from: m.index, to: m.index + m[0].length });
  return out;
}

function rangesField(): StateField<ProtectedRange[]> {
  return StateField.define<ProtectedRange[]>({
    create: (state) => headingRanges(state.doc.toString()),
    update: (value, tr) => (tr.docChanged ? headingRanges(tr.state.doc.toString()) : value),
  });
}

class RecordingWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly activeMatch: ProtectedRange | null,
  ) {
    super();
  }
  eq(other: RecordingWidget): boolean {
    return (
      this.text === other.text &&
      this.activeMatch?.from === other.activeMatch?.from &&
      this.activeMatch?.to === other.activeMatch?.to
    );
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.textContent = this.text;
    if (this.activeMatch) el.dataset.activeFrom = String(this.activeMatch.from);
    return el;
  }
}

function makeView(): { view: EditorView; ranges: StateField<ProtectedRange[]> } {
  const ranges = rangesField();
  const state = EditorState.create({
    doc: DOC,
    extensions: [
      ranges,
      protectedWidgetExtension(ranges, (doc, range, activeMatch) => {
        const local = activeMatch ? { from: activeMatch.from - range.from, to: activeMatch.to - range.from } : null;
        return new RecordingWidget(doc.slice(range.from, range.to), local);
      }),
    ],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  return { view, ranges };
}

describe("preventProtectedDeletionFilter", () => {
  it("blocks a pure deletion (Backspace/Delete) that touches a protected range", () => {
    const ranges = rangesField();
    const state = EditorState.create({ doc: DOC, extensions: [ranges, preventProtectedDeletionFilter(ranges)] });
    const headingFrom = headingRanges(DOC)[0]!.from;
    const tr = state.update({ changes: { from: headingFrom, to: headingFrom + 1, insert: "" } });
    expect(tr.state.doc.toString()).toBe(DOC); // rejected — doc unchanged
  });

  it("allows an edit that inserts replacement text (typing over selection, Find & Replace)", () => {
    const ranges = rangesField();
    const state = EditorState.create({ doc: DOC, extensions: [ranges, preventProtectedDeletionFilter(ranges)] });
    const h = headingRanges(DOC)[0]!;
    const tr = state.update({ changes: { from: h.from, to: h.to, insert: "## Renamed" } });
    expect(tr.state.doc.toString()).toContain("## Renamed");
  });

  it("leaves edits outside any protected range untouched", () => {
    const ranges = rangesField();
    const state = EditorState.create({ doc: DOC, extensions: [ranges, preventProtectedDeletionFilter(ranges)] });
    const tr = state.update({ changes: { from: 0, to: 6, insert: "" } }); // "before"
    expect(tr.state.doc.toString().startsWith("\n## Heading One")).toBe(true);
  });
});

describe("protectedAtomicField", () => {
  it("covers each protected range with exactly one atomic mark", () => {
    const ranges = rangesField();
    const atomicField = protectedAtomicField(ranges);
    const state = EditorState.create({ doc: DOC, extensions: [ranges, atomicField] });
    const set = state.field(atomicField);
    const spans: ProtectedRange[] = [];
    set.between(0, DOC.length, (from, to) => {
      spans.push({ from, to });
    });
    expect(spans).toEqual(headingRanges(DOC));
  });

  it("recomputes when the document changes so offsets stay in sync", () => {
    const ranges = rangesField();
    const atomicField = protectedAtomicField(ranges);
    const state = EditorState.create({ doc: DOC, extensions: [ranges, atomicField] });
    const tr = state.update({ changes: { from: 0, to: 0, insert: "XX" } });
    const spans: ProtectedRange[] = [];
    tr.state.field(atomicField).between(0, tr.state.doc.length, (from, to) => {
      spans.push({ from, to });
    });
    expect(spans).toEqual(headingRanges(tr.state.doc.toString()));
  });
});

describe("protected widget find/replace integration", () => {
  it("passes the active match sub-range (widget-local offsets) into the widget factory", () => {
    const { view, ranges } = makeView();
    const h = headingRanges(DOC).find((r) => DOC.slice(r.from, r.to).includes("Heading One"))!;
    // "Heading" starts 3 chars into "## Heading One"
    const hit = { from: h.from + 3, to: h.from + 10 };
    view.dispatch({ effects: setProtectedActiveMatch.of(hit) });

    const dom = view.dom.querySelector("[data-active-from]");
    expect(dom).not.toBeNull();
    expect(dom!.getAttribute("data-active-from")).toBe(String(hit.from - h.from));
    void ranges;
  });

  it("clears the widget highlight when the active match moves outside any protected range", () => {
    const { view } = makeView();
    const h = headingRanges(DOC).find((r) => DOC.slice(r.from, r.to).includes("Heading One"))!;
    const hit = { from: h.from + 3, to: h.from + 10 };
    view.dispatch({ effects: setProtectedActiveMatch.of(hit) });
    expect(view.dom.querySelector("[data-active-from]")).not.toBeNull();

    view.dispatch({ effects: setProtectedActiveMatch.of(null) });
    expect(view.dom.querySelector("[data-active-from]")).toBeNull();
  });

  it("moves the highlight when the active match switches to a different protected range", () => {
    const { view } = makeView();
    const one = headingRanges(DOC).find((r) => DOC.slice(r.from, r.to).includes("Heading One"))!;
    const two = headingRanges(DOC).find((r) => DOC.slice(r.from, r.to).includes("Heading Two"))!;
    view.dispatch({ effects: setProtectedActiveMatch.of({ from: one.from + 3, to: one.from + 10 }) });
    view.dispatch({ effects: setProtectedActiveMatch.of({ from: two.from + 3, to: two.from + 10 }) });

    const marks = view.dom.querySelectorAll("[data-active-from]");
    expect(marks.length).toBe(1);
    expect(marks[0]!.getAttribute("data-active-from")).toBe(String(two.from + 3 - two.from));
  });

  it("does not touch protected widgets on an unrelated selection-only transaction", () => {
    const { view } = makeView();
    const h = headingRanges(DOC).find((r) => DOC.slice(r.from, r.to).includes("Heading One"))!;
    view.dispatch({ effects: setProtectedActiveMatch.of({ from: h.from + 3, to: h.from + 10 }) });
    const before = view.dom.innerHTML;
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(view.dom.innerHTML).toBe(before);
  });

  it("keeps Backspace at a protected range boundary a no-op end to end", () => {
    const { view } = makeView();
    const h = headingRanges(DOC)[0]!;
    view.dispatch({
      changes: { from: h.to - 1, to: h.to, insert: "" },
      userEvent: "delete.backward",
    });
    expect(view.state.doc.toString()).toBe(DOC);
  });
});
