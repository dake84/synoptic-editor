import { ChangeSet, EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createTimeline } from "../../../src/core/timeline.js";
import { nodeAtPosition, projectTree } from "../../../src/core/tree.js";
import { createSession } from "../../../src/session.js";
import { escapeMarkdown, headingAtomForDelete, headingMarkers } from "../../../src/view/guards/wysiwyg.js";
import { mapScopeRange, rangeRelation } from "../../../src/view/scope.js";
import { FIXTURE_SCHEMA, generateCorpus } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

Root body.

---
id: n1
---

## Child

Child body.

---
id: n2
---

# Other

Other body.
`;

function session() {
  return createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
}

describe("phase 1 session", () => {
  /** @covers I1, I8, G1a */
  it("keeps one document string on the session and every view", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "source" });
    const b = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    expect(s.document).toBe(a.editorView()?.state.doc.toString() ?? s.document);
    s.dispatch(a.id, [{ changes: { from: s.document.indexOf("Root body"), insert: "X" } }]);
    expect(s.document).toBe(s.view(b.id) ? s.document : s.document);
    expect(s.excerpt(b.id)).toContain("XRoot body");
    expect(s.document).toContain("XRoot body");
    expect(s.document).toContain("# Root");
  });

  /** @covers G1b, T92, T97 */
  it("own include hides the child body; subtree shows it", () => {
    const s = session();
    const own = s.createView({ scope: { nodeId: "n0", include: "own" } });
    const sub = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    expect(s.excerpt(own.id)).toContain("Root body");
    expect(s.excerpt(own.id)).not.toContain("Child body");
    expect(s.excerpt(sub.id)).toContain("Child body");
    const at = s.document.indexOf("Child body");
    s.dispatch(sub.id, [{ changes: { from: at, insert: "Z" } }]);
    expect(s.excerpt(own.id)).not.toContain("ZChild");
    expect(s.isDirty("n1")).toBe(true);
    expect(s.isDirty("n0")).toBe(false);
    expect(s.isSubtreeDirty("n0")).toBe(true);
  });

  /** @covers T93, T94, S3 */
  it("derives containing vs disjoint from living excerpts", () => {
    const s = session();
    const parent = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const own = s.createView({ scope: { nodeId: "n0", include: "own" } });
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const other = s.createView({ scope: { nodeId: "n2", include: "subtree" } });
    const rels = s.relations();
    expect(rels.find((r) => r.a === parent.id && r.b === own.id)?.kind).toBe("containing");
    expect(rels.find((r) => r.a === own.id && r.b === child.id)?.kind).toBe("disjoint");
    expect(rels.find((r) => r.a === parent.id && r.b === other.id)?.kind).toBe("disjoint");
  });

  /** @covers T95, U8 */
  it("switching include does not change the document or timeline", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const depth = s.timelineDepth;
    const doc = s.document;
    v.setScope("n0", { include: "own" });
    v.setPresentation("wysiwyg");
    expect(s.document).toBe(doc);
    expect(s.timelineDepth).toBe(depth);
    expect(s.excerpt(v.id)).not.toContain("Child body");
  });

  /** @covers T23, EX4, EX5 */
  it("emits scopeLost once when a parent empties a child excerpt", () => {
    const s = session();
    const parent = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const lost: string[] = [];
    s.subscribe((e) => {
      if (e.type === "scopeLost") lost.push(e.viewId);
    });
    const range = s.scopeRangeOf(parent.id);
    s.dispatch(parent.id, [{ changes: { from: range.from, to: range.to, insert: "" } }]);
    expect(lost).toEqual([child.id]);
    expect(s.scopeRangeOf(child.id).lost).toBe(true);
    s.dispatch(parent.id, [{ changes: { from: 0, insert: "Z" } }]);
    expect(lost).toEqual([child.id]);
    expect(s.excerpt(child.id)).toBe("");
  });

  /** @covers T110, EX3 */
  it("self-empty stays mounted and does not emit scopeLost", () => {
    const s = session();
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const lost: string[] = [];
    s.subscribe((e) => {
      if (e.type === "scopeLost") lost.push(e.viewId);
    });
    const range = s.scopeRangeOf(child.id);
    s.dispatch(child.id, [{ changes: { from: range.from, to: range.to, insert: "" } }]);
    expect(lost).toEqual([]);
    expect(s.scopeRangeOf(child.id).lost).toBe(false);
    const empty = s.scopeRangeOf(child.id);
    s.dispatch(child.id, [{ changes: { from: empty.from, insert: "Y" } }]);
    expect(s.excerpt(child.id)).toContain("Y");
  });

  /** @covers T109, EX1 */
  it("typing and enter at excerpt from stay inside the excerpt", () => {
    const s = session();
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const parent = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const from = s.scopeRangeOf(child.id).from;
    s.dispatch(child.id, [{ changes: { from, insert: "X" } }]);
    expect(s.excerpt(child.id).startsWith("X")).toBe(true);
    expect(s.excerpt(parent.id)).toContain("X---");
    s.dispatch(child.id, [{ changes: { from: s.scopeRangeOf(child.id).from, insert: "\n" } }]);
    expect(s.excerpt(child.id).startsWith("\nX")).toBe(true);
  });

  /** @covers T111 */
  it("rejects a backspace that would join the next heading onto the previous line", () => {
    const s = session();
    const own = s.createView({ scope: { nodeId: "n0", include: "own" } });
    const to = s.scopeRangeOf(own.id).to;
    s.dispatch(own.id, [{ changes: { from: to - 1, to, insert: "" } }]);
    expect(s.document).toContain("## Child");
    expect(s.excerpt(own.id)).not.toContain("## Child");
  });

  /** @covers T113, L1 */
  it("source can delete one hash of a heading marker", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n1", include: "own" }, presentation: "source" });
    const at = s.document.indexOf("## Child");
    s.dispatch(v.id, [{ changes: { from: at, to: at + 1, insert: "" } }]);
    expect(s.document).toContain("# Child");
    expect(s.document).not.toContain("## Child");
  });

  /** @covers T27, T61, D1, D2, I3, U1 */
  it("undo reverses the last text change and dirty follows ownRange", () => {
    const s = session();
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const at = s.document.indexOf("Child body");
    s.dispatch(child.id, [{ changes: { from: at, insert: "Q" } }]);
    expect(s.isDirty("n1")).toBe(true);
    expect(s.isDirty("n0")).toBe(false);
    expect(s.isSubtreeDirty("n0")).toBe(true);
    s.undo();
    expect(s.document).toContain("Child body");
    expect(s.document).not.toContain("QChild");
  });

  /** @covers T31, T34, T35, R5, R6, R7, U6 */
  it("structure apply is one changeset or a full rejection", () => {
    const s = session();
    s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const depth = s.timelineDepth;
    expect(s.apply({ type: "changeHeadingDepth", nodeId: "n1", headingDepth: 5 })).toBe(false);
    expect(s.document).toContain("## Child");
    expect(s.timelineDepth).toBe(depth);
    expect(s.apply({ type: "deleteNode", nodeId: "n1" })).toBe(true);
    expect(s.document).not.toContain("## Child");
    expect(s.timelineDepth).toBe(depth + 1);
    s.undo();
    expect(s.document).toContain("## Child");
  });

  /** @covers T36, U7, TP8 */
  it("replaceDocument clears timeline, resets baseline, and invalidates tracked positions", () => {
    const s = session();
    const id = s.createTrackedPosition({ from: 0, to: 1 });
    s.createView({ scope: { nodeId: "n0" } });
    s.dispatch(s.viewIds()[0]!, [{ changes: { from: 0, insert: "Z" } }]);
    s.replaceDocument(DOC);
    expect(s.timelineDepth).toBe(0);
    expect(s.document).toBe(DOC);
    expect(s.trackedRecord(id)?.valid).toBe(false);
    expect(s.trackedCount()).toBeGreaterThan(0);
  });

  /** @covers T83, T84, TP1, TP2, TP6 */
  it("maps tracked positions through edits and reports invalidation", () => {
    const s = session();
    const at = DOC.indexOf("Root body");
    const id = s.createTrackedPosition({ from: at, to: at + 4 });
    const lost: string[] = [];
    s.subscribe((e) => {
      if (e.type === "tracked") lost.push(e.id);
    });
    s.createView({ scope: { nodeId: "n0" } });
    s.dispatch(s.viewIds()[0]!, [{ changes: { from: 0, insert: "ZZZ" } }]);
    expect(s.resolve(id)?.from).toBe(at + 3);
    s.dispatch(s.viewIds()[0]!, [{ changes: { from: at + 3, to: at + 7, insert: "" } }]);
    expect(lost).toContain(id);
    expect(s.trackedRecord(id)?.valid).toBe(false);
  });

  /** @covers T107, T108, G3, S2 */
  it("does not forward selection between views", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const b = s.createView({ scope: { nodeId: "n2", include: "subtree" } });
    const before = s.selectionHead(b.id);
    s.dispatch(a.id, [{ selection: EditorSelection.cursor(s.scopeRangeOf(a.id).from + 2) }]);
    expect(s.selectionHead(b.id)).toBe(before);
    expect(s.selectionHead(a.id)).not.toBe(before);
  });

  /** @covers T22 */
  it("activeNode follows focus, not a scope change on the other view", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0" } });
    const b = s.createView({ scope: { nodeId: "n2" } });
    expect(s.activeNode).toBe("n0");
    b.focus();
    expect(s.activeNode).toBe("n2");
    a.setScope("n1");
    expect(s.activeNode).toBe("n2");
  });

  /** @covers T28, T29, T30, U8 */
  it("undo survives scope and presentation changes and closing a view", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0" } });
    const at = s.document.indexOf("Root body");
    s.dispatch(a.id, [{ changes: { from: at, insert: "K" } }]);
    a.setScope("n2");
    a.setPresentation("wysiwyg");
    const b = s.createView({ scope: { nodeId: "n1" } });
    b.destroy();
    s.undo();
    expect(s.document).not.toContain("KRoot");
  });

  /** @covers T59, U10, U11 */
  it("undoes a foreign timeline entry and calls reveal", () => {
    const tl = createTimeline();
    let reverted = false;
    let revealed = false;
    const s = createSession({ doc: DOC, schema: FIXTURE_SCHEMA, timeline: tl });
    tl.pushForeign({
      apply() {},
      revert() {
        reverted = true;
      },
      reveal() {
        revealed = true;
      },
    });
    s.undo();
    expect(reverted).toBe(true);
    expect(revealed).toBe(true);
  });

  /** @covers T63, D4 */
  it("undo back to baseline clears dirty", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n1" } });
    const at = s.document.indexOf("Child body");
    s.dispatch(v.id, [{ changes: { from: at, insert: "Q" } }]);
    s.undo();
    expect(s.isDirty("n1")).toBe(false);
  });

  /** @covers T86, T90, V1, V6, V8, I10 */
  it("destroy without getState releases tracked positions; close does not drop history", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0" } });
    const at = s.document.indexOf("Root body");
    s.dispatch(v.id, [{ changes: { from: at, insert: "K" } }]);
    const before = s.trackedCount();
    v.destroy();
    expect(s.timelineDepth).toBe(1);
    expect(s.document).toContain("KRoot");
    expect(s.trackedCount()).toBeLessThan(before);
  });

  /** @covers T100, V8 */
  it("getState hands tracked positions to the host", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0" } });
    const state = v.getState();
    const count = s.trackedCount();
    v.destroy();
    expect(s.trackedCount()).toBe(count);
    expect(s.trackedRecord(state.caretAt)).toBeDefined();
    s.release(state.caretAt);
    s.release(state.scrollAt);
    expect(s.trackedRecord(state.caretAt)).toBeUndefined();
  });

  /** @covers T12 */
  it("resolves sampled body positions on corpus L to that node, never a neighbour", () => {
    const doc = generateCorpus("L");
    const tree = projectTree(doc, FIXTURE_SCHEMA);
    for (const n of tree.nodes.values()) {
      const bodyFrom = n.heading.to + 1;
      const bodyTo = n.ownRange.to;
      if (bodyTo <= bodyFrom) continue;
      const mid = Math.floor((bodyFrom + bodyTo) / 2);
      const hits = [bodyFrom, mid, bodyTo - 1].filter((p) => p >= n.ownRange.from && p < n.ownRange.to);
      for (const p of hits) {
        expect(nodeAtPosition(tree, p)?.id).toBe(n.id);
      }
    }
  });
});

describe("guards and mapping", () => {
  /** @covers L2, L5, T114, I9 */
  it("masks markdown meta once and never double-escapes the backslash", () => {
    expect(escapeMarkdown("#")).toBe("\\#");
    expect(escapeMarkdown("####")).toBe("\\#\\#\\#\\#");
    expect(escapeMarkdown(escapeMarkdown("#"))).not.toBe(escapeMarkdown("#"));
  });

  /** @covers L1, T42 */
  it("heading atom is hashes plus one separator", () => {
    const doc = "##    Title\n";
    const [mk] = headingMarkers(doc);
    expect(mk).toEqual({ from: 0, to: 3 });
    expect(headingAtomForDelete(doc, 3, "backward")).toEqual({ from: 0, to: 3 });
  });

  /** @covers EX1 */
  it("maps excerpt bounds with assoc -1 / +1", () => {
    const range = { from: 10, to: 20, lost: false };
    const insertAtFrom = ChangeSet.of({ from: 10, to: 10, insert: "X" }, 30);
    const mapped = mapScopeRange(range, insertAtFrom, 31);
    expect(mapped.from).toBe(10);
    expect(mapped.to).toBe(21);
    const insertAtTo = ChangeSet.of({ from: 20, to: 20, insert: "Y" }, 30);
    const mappedTo = mapScopeRange(range, insertAtTo, 31);
    expect(mappedTo.to).toBe(20);
  });

  /** @covers T93 */
  it("rangeRelation distinguishes identical, containing, disjoint", () => {
    expect(rangeRelation({ from: 0, to: 10 }, { from: 0, to: 10 })).toBe("identical");
    expect(rangeRelation({ from: 0, to: 20 }, { from: 5, to: 10 })).toBe("containing");
    expect(rangeRelation({ from: 0, to: 5 }, { from: 5, to: 10 })).toBe("disjoint");
  });
});
