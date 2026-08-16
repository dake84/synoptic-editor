/**
 * @vitest-environment happy-dom
 *
 * Chip atom delete (SPEC.md W3).
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { chipAtomForDelete, isExactChipDelete } from "../../../src/view/guards/chips.js";
import { wysiwygGuards } from "../../../src/view/guards/wysiwyg.js";

const CHIP = "[Ada]{id=a type=item}";
const HTML_CHIP = '<item-ref id="a">Ada</item-ref>';

function stateWith(doc: string, style: "attribute-block" | "html-ref" = "attribute-block") {
  return EditorState.create({
    doc,
    extensions: [wysiwygGuards({ structureLocked: true, inlineRefStyle: style })],
  });
}

describe("chip atom delete (W3)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers W3, L1 */
  it("treats the chip as one unit at both caret sides", () => {
    const doc = `See ${CHIP} here.`;
    const from = doc.indexOf("[");
    const to = from + CHIP.length;
    expect(chipAtomForDelete(doc, to, "backward")).toEqual({ from, to });
    expect(chipAtomForDelete(doc, from, "forward")).toEqual({ from, to });
    expect(chipAtomForDelete(doc, from + 2, "backward")).toEqual({ from, to });
    expect(chipAtomForDelete(doc, 0, "backward")).toBeUndefined();
  });

  /** @covers W3 */
  it("recognises a contiguous run of whole chips and rejects a husk", () => {
    const doc = `${CHIP}${CHIP}`;
    expect(isExactChipDelete(doc, 0, doc.length)).toBe(true);
    expect(isExactChipDelete(doc, 0, CHIP.length)).toBe(true);
    expect(isExactChipDelete(doc, 1, CHIP.length)).toBe(false);
    expect(isExactChipDelete(doc, 0, 0)).toBe(false);
  });

  /** @covers W3, L1 */
  it("expands a partial label delete to the whole chip", () => {
    const doc = `See ${CHIP} here.`;
    const from = doc.indexOf("[");
    const labelFrom = from + 1;
    const state = stateWith(doc);
    const tr = state.update({
      changes: { from: labelFrom, to: labelFrom + 3, insert: "" },
      userEvent: "delete.selection",
    });
    expect(tr.state.doc.toString()).toBe("See  here.");
    expect(tr.state.doc.toString()).not.toContain("id=a");
  });

  /** @covers W3 */
  it("Backspace immediately after a chip removes the whole unit", () => {
    const doc = `See ${CHIP} here.`;
    const to = doc.indexOf("[") + CHIP.length;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(to),
        extensions: [wysiwygGuards({ inlineRefStyle: "attribute-block" })],
      }),
      parent,
    });
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(view.state.doc.toString()).toBe("See  here.");
    view.destroy();
  });

  /** @covers W3 */
  it("deletes an html-ref chip as one unit, including when the label is emptied", () => {
    const doc = `See ${HTML_CHIP} here.`;
    const openEnd = doc.indexOf(">") + 1;
    const closeStart = doc.indexOf("</item-ref>");
    expect(isExactChipDelete(doc, doc.indexOf("<"), doc.indexOf("<") + HTML_CHIP.length, "html-ref")).toBe(
      true,
    );
    const state = stateWith(doc, "html-ref");
    const tr = state.update({
      changes: { from: openEnd, to: closeStart, insert: "" },
      userEvent: "delete.selection",
    });
    expect(tr.state.doc.toString()).toBe("See  here.");
    expect(tr.state.doc.toString()).not.toContain("item-ref");
  });
});
