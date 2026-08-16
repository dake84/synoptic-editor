/**
 * @vitest-environment happy-dom
 *
 * Selection re-park on presentation change (SPEC.md L7).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";
import { bodyBlockStarts, blockIndexAtOffset } from "../../../src/core/block-offsets.js";
import { readingLinePos } from "../../../src/view/scroll.js";
import { synopticLockedRanges } from "../../../src/view/guards/locked-ranges.js";
import { parkSelection } from "../../../src/view/guards/park-selection.js";
import { EditorSelection } from "@codemirror/state";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

Body with *em* here.
`;

describe("selection park (L7)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers L7 */
  it("parks a source caret that sits on the ATX hashes when switching to wysiwyg", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const heading = DOC.indexOf("# Root");
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "source",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);
    view.editorView()!.dispatch({ selection: EditorSelection.cursor(heading + 1) });
    expect(view.editorView()!.state.selection.main.head).toBe(heading + 1);

    const depthBefore = session.timelineDepth;
    view.setPresentation("wysiwyg");
    const head = view.editorView()!.state.selection.main.head;
    const locks = synopticLockedRanges(DOC, { schema: FIXTURE_SCHEMA });
    expect(locks.some((r) => head > r.from && head < r.to)).toBe(false);
    expect(session.timelineDepth).toBe(depthBefore);
  });

  /** @covers L7 */
  it("moves both anchor and head to the nearest outside without scrolling", () => {
    const doc = "# Title\nbody\n";
    const hashes = { from: 0, to: 2 };
    const parked = parkSelection(EditorSelection.single(1), [hashes], doc.length);
    expect(parked.main.anchor === 0 || parked.main.anchor === 2).toBe(true);
    expect(parked.main.head).toBe(parked.main.anchor);
  });

  /** @covers L7, V11 */
  it("keeps the block-start scroll anchor across source↔wysiwyg (#150)", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "source",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);
    const bodyAt = DOC.indexOf("Body with");
    view.editorView()!.dispatch({ selection: EditorSelection.single(bodyAt) });
    const before = readingLinePos(view.editorView()!);
    const starts = bodyBlockStarts(DOC);
    const blockBefore = blockIndexAtOffset(starts, before);
    view.setPresentation("wysiwyg");
    const after = readingLinePos(view.editorView()!);
    expect(blockIndexAtOffset(starts, after)).toBe(blockBefore);
  });
});
