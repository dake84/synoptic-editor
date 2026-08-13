import { describe, expect, it } from "vitest";
import {
  clippedCopy,
  createPresentationSession,
  createScopeSession,
  escapeMarkdown,
  maskBackslashRanges,
  proveG1Backspace,
  proveG1Boundary,
  proveG1DocumentEnd,
  proveG1EnterAtFrom,
  proveG1NoPrepend,
  proveG1ScopeLost,
  proveG1StayMounted,
  proveG1Presentation,
  proveG1Scope,
  proveG1SelectAllDelete,
  proveG1SourceMarkerChars,
  proveG1TitleCaret,
  proveG2,
  proveG2TitleSpaces,
  proveG2WysiwygAdjacentMarker,
  proveG2WysiwygDeleteNewline,
  proveG2WysiwygHeadingAtom,
  proveG2DeleteMask,
  proveG2NoDoubleEscape,
  proveG3,
  renderRange,
  sectionsOf,
  SPIKE_DOC,
} from "../../../spikes/phase-0/spike.js";

describe("phase-0 spike against installed CM6", () => {
  it("ownRange of A ends at A1; subtreeRange of A covers A1 and A2", () => {
    const all = sectionsOf(SPIKE_DOC);
    const a = all.find((s) => s.id === "A")!;
    const a1 = all.find((s) => s.id === "A1")!;
    const a2 = all.find((s) => s.id === "A2")!;
    expect(SPIKE_DOC.slice(a.from, a.ownTo)).toContain("A body");
    expect(SPIKE_DOC.slice(a.from, a.ownTo)).not.toContain("## A1");
    expect(SPIKE_DOC.slice(a.from, a.subtreeTo)).toContain("A1 body");
    expect(SPIKE_DOC.slice(a.from, a.subtreeTo)).toContain("A2 body");
    expect(SPIKE_DOC.slice(a1.from, a1.ownTo)).toContain("A1 body");
    expect(SPIKE_DOC.slice(a1.from, a1.ownTo)).not.toContain("A2 body");
    expect(a1.ownTo).toBe(a2.from);
    expect(a.subtreeTo).toBe(SPIKE_DOC.length);
  });

  /** @covers G1, I1 */
  it("G1 presentation: same document in source and wysiwyg; markers stay in the string", () => {
    const result = proveG1Presentation(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1 scope: insert in A1 is visible in parent A, not in A2", () => {
    const result = proveG1Scope(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1e: insert at the end of A1 stays in A1, not in A2", () => {
    const result = proveG1Boundary(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1h: backspace at A1's exclusive end does not join A2 onto A1", () => {
    const result = proveG1Backspace(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1i: deleting A1's range does not make the A1 view show A2", () => {
    const result = proveG1SelectAllDelete(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1k: typing at A1.from stays in the A1 excerpt", () => {
    const result = proveG1NoPrepend(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1n: enter at A1.from stays in A1 and does not leak a line into A only", () => {
    const result = proveG1EnterAtFrom(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1o: A1 stays mounted on its excerpt after ## A1 is gone", () => {
    const result = proveG1StayMounted(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1p: A emptying the subtree emits scopeLost; typing in A does not reattach A1/A2", () => {
    const result = proveG1ScopeLost(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1l: source caret may sit on ##; the marker is not an atom", () => {
    const result = proveG1TitleCaret(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1m: source can delete one # of ## A1", () => {
    const result = proveG1SourceMarkerChars(createScopeSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1j: a heading at document end stays visible in document-scoped views", () => {
    const result = proveG1DocumentEnd(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L2 */
  it("G2 display: wysiwyg hides the L2 mask backslash so \\# reads as #", () => {
    expect(maskBackslashRanges("x\\#y", 0, 4)).toEqual([{ from: 1, to: 2 }]);
    expect(maskBackslashRanges("\\#\\#", 0, 4)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
  });

  /** @covers G2, L1, L2, L3, I6 */
  it("G2: wysiwyg L1–L3 guards run only on the wysiwyg state, with no view-identity annotation", () => {
    const result = proveG2(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L1, L4 */
  it("G2d: wysiwyg heading marker is an atom; caret sits on the title", () => {
    const result = proveG2WysiwygHeadingAtom(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L1, L4 */
  it("G2g: spaces typed at a wysiwyg title stay in the title, not in the ## atom", () => {
    const result = proveG2TitleSpaces(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L1 */
  it("G2e: Backspace/Delete immediately before ## remove the atom, not a neighbour line", () => {
    const result = proveG2WysiwygAdjacentMarker(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L1 */
  it("G2f: Delete at the end of a wysiwyg heading line removes the newline", () => {
    const result = proveG2WysiwygDeleteNewline(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L2 */
  it("G2c: deleting the visible # of \\# removes the mask backslash", () => {
    const result = proveG2DeleteMask(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G2, L2 */
  it("G2b: four successive '#' inserts mask once each, never double-escape the backslash", () => {
    expect(escapeMarkdown("####")).toBe("\\#\\#\\#\\#");
    const result = proveG2NoDoubleEscape(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G3 */
  it("G3: selection is not forwarded; the other caret is mapped, never copied", () => {
    const result = proveG3(createPresentationSession());
    expect(result.passed, result.detail).toBe(true);
  });

  /** @covers G1 */
  it("G1g: select-all copy from A1 is clipped to A1, not A2 body", () => {
    const session = createScopeSession();
    const a1 = session.views.find((v) => v.id === "A1")!;
    const doc = a1.state.doc.toString();
    const range = renderRange(doc, a1.scopeId, a1.scopeIndex, a1.include)!;
    const text = clippedCopy(doc, 0, doc.length, range.from, range.to);
    expect(text).toContain("A1 body");
    expect(text).not.toContain("A2 body");
    expect(text).not.toContain("A body");
  });
});
