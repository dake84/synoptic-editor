/**
 * @vitest-environment happy-dom
 *
 * Selection re-park on presentation change (SPEC.md L7).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";
import { readingLinePos } from "../../../src/view/scroll.js";
import { synopticLockedRanges } from "../../../src/view/guards/locked-ranges.js";
import { parkSelection } from "../../../src/view/guards/park-selection.js";
import {
  extraLockedGuards,
  extraLockedRanges,
  headingUnitRanges,
  hiddenFrontmatterGuards,
} from "../../../src/index.js";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
  it("parks a caret on lock.from to lock.to (insert hole before the atom)", () => {
    const doc = "# Title\nbody\n";
    const hashes = { from: 0, to: 2 };
    const parked = parkSelection(EditorSelection.single(0), [hashes], doc);
    expect(parked.main.head).toBe(2);
    expect(parked.main.anchor).toBe(2);
  });

  /** @covers L7 */
  it("moves both anchor and head to the nearest outside without scrolling", () => {
    const doc = "# Title\nbody\n";
    const hashes = { from: 0, to: 2 };
    const parked = parkSelection(EditorSelection.single(1), [hashes], doc);
    expect(parked.main.anchor).toBe(2);
    expect(parked.main.head).toBe(2);
  });

  /** @covers L7, V11 */
  it("keeps the reading-line offset across source↔wysiwyg (#150)", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "source",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);
    const ev = view.editorView()!;
    const bodyAt = DOC.indexOf("Body with");
    ev.dispatch({ selection: EditorSelection.single(bodyAt) });
    const before = readingLinePos(ev);
    let restored: number | null = null;
    const dispatch = ev.dispatch.bind(ev);
    ev.dispatch = ((...args: Parameters<EditorView["dispatch"]>) => {
      const spec = args[0] as { effects?: unknown };
      if (spec && typeof spec === "object" && spec.effects) {
        const list = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
        for (const effect of list) {
          const range = (effect as { value?: { range?: { from?: number } } }).value?.range;
          if (typeof range?.from === "number") restored = range.from;
        }
      }
      return dispatch(...args);
    }) as EditorView["dispatch"];
    view.setPresentation("wysiwyg");
    ev.dispatch = dispatch;
    expect(restored).toBe(before);
  });

  /** @covers L7, T142 */
  it("appends a park newline when a block lock ends at EOF", () => {
    const doc = "# Title";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [extraLockedRanges.of([{ from: 0, to: doc.length }]), extraLockedGuards()],
      }),
      parent: document.body,
    });
    view.dispatch({ selection: { anchor: doc.length } });
    expect(view.state.doc.toString()).toBe("# Title\n");
    expect(view.state.selection.main.head).toBe(doc.length + 1);
    view.destroy();
  });

  /** @covers L7, T144 */
  it("inserts a park newline between abutting heading units instead of jumping into the next", () => {
    const doc = `---
id: a
---
# A
---
id: b
---
## B
`;
    const units = headingUnitRanges(doc, FIXTURE_SCHEMA);
    const join = units[0]!.to;
    expect(units[1]?.from).toBe(join);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [extraLockedRanges.of(units), extraLockedGuards()],
      }),
      parent: document.body,
    });
    view.dispatch({ selection: EditorSelection.cursor(join) });
    const after = view.state.doc.toString();
    expect(after.slice(join, join + 4)).toBe("\n---");
    expect(view.state.selection.main.head).toBe(join);
    expect(view.state.doc.lineAt(join).text.trim()).toBe("");
    expect(after).toContain("# A\n\n---\nid: b");
    view.destroy();
  });

  /** @covers L7, FM9 */
  it("parks a caret inside hidden FM onto the bound heading without splitting YAML from ATX", () => {
    const doc = `---
id: n0
---
# Root

body
`;
    const heading = doc.indexOf("# Root");
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          hiddenFrontmatterGuards(FIXTURE_SCHEMA),
          extraLockedRanges.of([{ from: heading, to: doc.indexOf("\n", heading) + 1 }]),
          extraLockedGuards(),
        ],
      }),
      parent: document.body,
    });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(doc.indexOf("\n", heading) + 1);
    view.destroy();
  });

  /** @covers L7, T144 */
  it("inserts a park newline between a heading extra-lock and the next hidden FM", () => {
    const doc = `# A
---
id: b
---
## B
`;
    const headingA = doc.indexOf("# A");
    const extraTo = doc.indexOf("\n", headingA) + 1;
    expect(doc.slice(extraTo, extraTo + 3)).toBe("---");
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          hiddenFrontmatterGuards(FIXTURE_SCHEMA),
          extraLockedRanges.of([{ from: headingA, to: extraTo }]),
          extraLockedGuards(),
        ],
      }),
      parent: document.body,
    });
    view.dispatch({ selection: EditorSelection.cursor(headingA) });
    const after = view.state.doc.toString();
    expect(after.slice(extraTo, extraTo + 4)).toBe("\n---");
    expect(view.state.selection.main.head).toBe(extraTo);
    expect(view.state.doc.lineAt(extraTo).text.trim()).toBe("");
    expect(after).toContain("# A\n\n---\nid: b");
    view.destroy();
  });

  /** @covers L7, FM1 */
  it("parks out of hidden FM on an isolated mount without extra locks", () => {
    const doc = `---
id: n0
---
# Root
`;
    const heading = doc.indexOf("# Root");
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [hiddenFrontmatterGuards(FIXTURE_SCHEMA)],
      }),
      parent: document.body,
    });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(view.state.selection.main.head).toBe(heading);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });
});
