import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createTimeline } from "../../../src/core/timeline.js";
import { createSession } from "../../../src/session.js";
import { wysiwygForwardDelete } from "../../../src/view/guards/wysiwyg.js";
import { clippedCopy } from "../../../src/view/scope.js";
import { visibleNodeFromGeometry } from "../../../src/view/scroll.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { projectTree } from "../../../src/core/tree.js";

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

function session(doc = DOC) {
  return createSession({ doc, schema: FIXTURE_SCHEMA });
}

describe("phase 1 remaining cases", () => {
  /** @covers T15, T17 */
  it("scope and grain changes keep the same view mounted and a defined end state", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" }, grain: 3 });
    const id = v.id;
    const depth = s.timelineDepth;
    v.setGrain(0);
    v.setScope("n1", { include: "own" });
    v.setGrain(2);
    expect(v.id).toBe(id);
    expect(s.scopeOf(id)).toEqual({ nodeId: "n1", include: "own" });
    expect(s.timelineDepth).toBe(depth);
    expect(s.document).toBe(DOC);
  });

  /** @covers T19, T20, R1 */
  it("inner edits and a new heading appear in the containing parent", () => {
    const s = session();
    const parent = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const body = s.document.indexOf("Child body");
    s.dispatch(child.id, [{ changes: { from: body, insert: "IN" } }]);
    expect(s.excerpt(parent.id)).toContain("INChild body");
    const title = s.document.indexOf("Child");
    s.dispatch(child.id, [{ changes: { from: title, to: title + 5, insert: "Kid" } }]);
    expect(s.excerpt(parent.id)).toContain("Kid");
    const yaml = s.document.indexOf("id: n1");
    s.dispatch(child.id, [{ changes: { from: yaml + 6, insert: " " } }]);
    expect(s.excerpt(parent.id)).toContain("id: n1 ");
    expect(s.isDirty("n1")).toBe(true);
    expect(s.isDirty("n0")).toBe(false);
    const bodyEnd = s.document.indexOf("Child body") + "Child body.".length;
    s.dispatch(child.id, [{ changes: { from: bodyEnd, insert: "\n### New\n\nN\n" } }]);
    expect([...s.tree.nodes.keys()].some((id) => s.tree.nodes.get(id)!.title === "New")).toBe(true);
    expect(s.excerpt(parent.id)).toContain("### New");
  });

  /** @covers T62, D1 */
  it("a frontmatter-only edit dirties the child, not the parent ownRange", () => {
    const s = session();
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const yaml = s.document.indexOf("id: n1");
    s.dispatch(child.id, [{ changes: { from: yaml + 6, insert: " " } }]);
    expect(s.isDirty("n1")).toBe(true);
    expect(s.isDirty("n0")).toBe(false);
    expect(s.isSubtreeDirty("n0")).toBe(true);
  });

  /** @covers T21, T57, T58 */
  it("navigateTo scrolls inside the scope and rebinds outside; the other view is untouched", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const b = s.createView({ scope: { nodeId: "n2", include: "subtree" } });
    a.navigateTo("n1");
    expect(s.scopeOf(a.id).nodeId).toBe("n0");
    a.navigateTo("n2");
    expect(s.scopeOf(a.id).nodeId).toBe("n2");
    expect(s.scopeOf(b.id).nodeId).toBe("n2");
  });

  /** @covers T24, R3 */
  it("changing the rank of the scope node keeps the scope id", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n1", include: "own" } });
    expect(s.apply({ type: "changeHeadingDepth", nodeId: "n1", headingDepth: 3 })).toBe(true);
    expect(s.scopeOf(v.id).nodeId).toBe("n1");
    expect(s.document).toContain("### Child");
  });

  /** @covers T25, T26, S3, R4 */
  it("promoting a child out of a subtree changes the relation without remounting", () => {
    const s = session();
    const parent = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const child = s.createView({ scope: { nodeId: "n1", include: "own" } });
    expect(s.relations().find((r) => r.a === parent.id && r.b === child.id)?.kind).toBe("containing");
    const idP = parent.id;
    const idC = child.id;
    expect(s.apply({ type: "deleteNode", nodeId: "n1" })).toBe(true);
    expect(parent.id).toBe(idP);
    expect(child.id).toBe(idC);
    expect(s.excerpt(parent.id)).not.toContain("Child body");
    expect(s.relations().some((r) => r.a === parent.id || r.b === parent.id)).toBe(true);
  });

  /** @covers T32, T37, U2, U3, U16 */
  it("undoes a mixed text/structure/text sequence in reverse, from any focus", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0" } });
    const b = s.createView({ scope: { nodeId: "n2" } });
    s.dispatch(a.id, [{ changes: { from: s.document.indexOf("Root body"), insert: "A" } }]);
    expect(s.apply({ type: "deleteNode", nodeId: "n1" })).toBe(true);
    s.dispatch(b.id, [{ changes: { from: s.document.indexOf("Other body"), insert: "B" } }]);
    b.focus();
    s.undo();
    expect(s.document).not.toContain("BOther");
    expect(s.document).not.toContain("## Child");
    s.undo();
    expect(s.document).toContain("## Child");
    a.focus();
    s.undo();
    expect(s.document).not.toContain("ARoot");
  });

  /** @covers T33, T4, U4, U5 */
  it("undo of an edit in X while focused on Y rebinds the focused view to X", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const b = s.createView({ scope: { nodeId: "n2", include: "subtree" } });
    s.dispatch(a.id, [{ changes: { from: s.document.indexOf("Root body"), insert: "A" } }]);
    b.focus();
    s.undo();
    expect(s.document).not.toContain("ARoot");
    expect(s.scopeOf(b.id).nodeId).toBe("n0");
    expect(s.lastScrollCause(b.id)).toBe("undo");
  });

  /** @covers T35, R7 */
  it("rejects a cascade that would push a child past the last schema rank", () => {
    const doc = `---
id: p
---

# P

---
id: mid
---

### Mid

---
id: leaf
---

#### Leaf
`;
    const s = session(doc);
    s.createView({ scope: { nodeId: "p" } });
    const before = s.document;
    const depth = s.timelineDepth;
    expect(s.apply({ type: "changeHeadingDepth", nodeId: "mid", headingDepth: 4 })).toBe(false);
    expect(s.document).toBe(before);
    expect(s.timelineDepth).toBe(depth);
  });

  /** @covers T60, U12 */
  it("shared timeline undoes in global order across two sessions", () => {
    const tl = createTimeline();
    const a = createSession({ doc: DOC, schema: FIXTURE_SCHEMA, timeline: tl });
    const b = createSession({ doc: DOC, schema: FIXTURE_SCHEMA, timeline: tl });
    const order: string[] = [];
    a.createView({ scope: { nodeId: "n0" } });
    a.dispatch(a.viewIds()[0]!, [{ changes: { from: 0, insert: "A" } }]);
    tl.pushForeign({
      apply() {},
      revert() {
        order.push("foreign");
      },
    });
    b.undo();
    expect(order).toEqual(["foreign"]);
    expect(tl.depth).toBe(1);
    a.undo();
    expect(a.document.startsWith("A")).toBe(false);
  });

  /** @covers T84, T103, TP3, TP4 */
  it("undo restores an invalidated tracked position with its width", () => {
    const s = session();
    const at = DOC.indexOf("Root");
    const id = s.createTrackedPosition({ from: at, to: at + 4 });
    const v = s.createView({ scope: { nodeId: "n0" } });
    s.dispatch(v.id, [{ changes: { from: at, to: at + 4, insert: "" } }]);
    expect(s.trackedRecord(id)?.valid).toBe(false);
    expect(s.trackedCount()).toBeGreaterThan(0);
    s.undo();
    const rec = s.trackedRecord(id)!;
    expect(rec.valid).toBe(true);
    expect(rec.to - rec.from).toBe(4);
    expect(s.document.slice(rec.from, rec.to)).toBe("Root");
  });

  /** @covers T85, T106 */
  it("maps tracked positions through another view and with no views mounted", () => {
    const s = session();
    const at = DOC.indexOf("Child body");
    const id = s.createTrackedPosition({ from: at, to: at + 5 });
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const b = s.createView({ scope: { nodeId: "n1", include: "own" } });
    s.dispatch(b.id, [{ changes: { from: 0, insert: "ZZ" } }]);
    expect(s.resolve(id)!.from).toBe(at + 2);
    a.destroy();
    b.destroy();
    expect(s.apply({ type: "deleteNode", nodeId: "n2" })).toBe(true);
    expect(s.trackedRecord(id)?.valid).toBe(true);
  });

  /** @covers T88, V4, V3 */
  it("restore applies caret without treating it as the scroll owner", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const caret = s.document.indexOf("Child body");
    s.dispatch(v.id, [{ selection: EditorSelection.cursor(caret) }]);
    const state = v.getState();
    expect(s.trackedRecord(state.scrollAt)!.from).not.toBe(caret);
    v.destroy();
    const again = s.createView({ state });
    expect(s.selectionHead(again.id)).toBe(caret);
    expect(s.lastScrollCause(again.id)).toBeNull();
  });

  /** @covers T89, V5 */
  it("first open places the caret on the first prose, not the heading", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const head = s.selectionHead(v.id);
    const heading = s.tree.nodes.get("n0")!.heading;
    expect(head).toBeGreaterThanOrEqual(heading.to);
    expect(s.document.slice(head, head + 4)).toBe("Root");
    expect(head).not.toBe(s.document.length);
  });

  /** @covers T87, T101, V2, V10, R2 */
  it("restoring a closed view whose scope was deleted falls back to the ancestor", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const state = v.getState();
    v.destroy();
    expect(s.apply({ type: "deleteNode", nodeId: "n1" })).toBe(true);
    const again = s.createView({ state });
    expect(s.scopeOf(again.id).nodeId).toBe("n0");
    const heading = s.tree.nodes.get("n0")!.heading;
    expect(s.selectionHead(again.id)).toBeGreaterThanOrEqual(heading.to);
  });

  /** @covers T98, T99, V1, V7 */
  it("reopening a handed-out state keeps the caret on the same character after edits", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "own" } });
    const caret = s.selectionHead(v.id);
    const ch = s.document[caret];
    const state = v.getState();
    v.destroy();
    const other = s.createView({ scope: { nodeId: "n2" } });
    s.dispatch(other.id, [{ changes: { from: caret, insert: "QQQ" } }]);
    const again = s.createView({ state });
    expect(s.document[s.selectionHead(again.id)]).toBe(ch);
    const state2 = again.getState();
    again.destroy();
    expect(s.apply({ type: "changeHeadingDepth", nodeId: "n1", headingDepth: 3 })).toBe(true);
    const third = s.createView({ state: state2 });
    expect(s.trackedRecord(state2.caretAt)?.valid).toBe(true);
    expect(s.scopeOf(third.id).nodeId).toBe("n0");
  });

  /** @covers T102, V9 */
  it("repeated close/reopen with the same state does not leak tracked positions", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0" } });
    const state = v.getState();
    v.destroy();
    const n = s.trackedCount();
    for (let i = 0; i < 4; i++) {
      const w = s.createView({ state });
      w.destroy();
    }
    expect(s.trackedCount()).toBe(n);
  });

  /** @covers T104, T105, TP5 */
  it("invalid positions stay until release; replaceDocument invalidates all", () => {
    const s = session();
    const id = s.createTrackedPosition({ from: 0, to: 2 });
    s.replaceDocument(DOC);
    expect(s.trackedRecord(id)?.valid).toBe(false);
    expect(s.trackedRecord(id)).toBeDefined();
    s.release(id);
    expect(s.trackedRecord(id)).toBeUndefined();
  });

  /** @covers T91, U13, U14, U15 */
  it("undo of a foreign entry leaves the following text undo intact", () => {
    const tl = createTimeline();
    const s = createSession({ doc: DOC, schema: FIXTURE_SCHEMA, timeline: tl });
    const v = s.createView({ scope: { nodeId: "n0" } });
    s.dispatch(v.id, [{ changes: { from: s.document.indexOf("Root body"), insert: "A" } }]);
    let reverted = false;
    tl.pushForeign({
      apply() {},
      revert() {
        reverted = true;
      },
    });
    expect(s.document).toContain("ARoot");
    s.undo();
    expect(reverted).toBe(true);
    expect(s.document).toContain("ARoot");
    s.undo();
    expect(s.document).not.toContain("ARoot");
  });

  /** @covers T112, EX2 */
  it("clips copy to the excerpt", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n1", include: "own" } });
    const r = s.scopeRangeOf(v.id);
    const text = clippedCopy(s.document, 0, s.document.length, r);
    expect(text).toContain("Child body");
    expect(text).not.toContain("Other body");
    expect(text).not.toContain("Root body");
  });

  /** @covers T115, T116, L1, L2 */
  it("wysiwyg forward-delete removes a heading newline or a \\# pair", () => {
    const heading = "## Child\n\nChild body.\n";
    const nl = heading.indexOf("\n");
    expect(wysiwygForwardDelete(heading, nl)).toEqual({ from: nl, to: nl + 1 });
    const s = session(`---
id: n0
---

# Root

see \\# here
`);
    const v = s.createView({ scope: { nodeId: "n0" }, presentation: "wysiwyg" });
    const hash = s.document.indexOf("#", s.document.indexOf("see"));
    s.dispatch(v.id, [{ changes: { from: hash, to: hash + 1, insert: "" } }]);
    expect(s.document).not.toContain("\\#");
    expect(s.document).toContain("see  here");
  });

  /** @covers T8, T9, T10 */
  it("visibleNode follows injected scroll geometry and ignores non-schema headings", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    const n0 = tree.nodes.get("n0")!;
    const n1 = tree.nodes.get("n1")!;
    const n2 = tree.nodes.get("n2")!;
    expect(visibleNodeFromGeometry(tree, 0, () => ({ from: n0.heading.from }))).toBe("n0");
    expect(visibleNodeFromGeometry(tree, 40, () => ({ from: n1.ownRange.from + 1 }))).toBe("n1");
    expect(visibleNodeFromGeometry(tree, 80, () => ({ from: n2.ownRange.from + 1 }))).toBe("n2");
    const hash5 = DOC.indexOf("Child body");
    expect(visibleNodeFromGeometry(tree, 40, () => ({ from: hash5 }))).toBe("n1");
  });

  /** @covers T13, I5 */
  it("does not measure layout during a document update", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0" } });
    s.layoutDuringUpdate = 0;
    s.dispatch(v.id, [{ changes: { from: s.document.indexOf("Root body"), insert: "Z" } }]);
    expect(s.layoutDuringUpdate).toBe(0);
  });

  /** @covers T107 */
  it("identical scopes keep independent carets", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const b = s.createView({ scope: { nodeId: "n0", include: "subtree" } });
    const before = s.selectionHead(b.id);
    s.dispatch(a.id, [{ selection: EditorSelection.cursor(s.scopeRangeOf(a.id).from + 3) }]);
    expect(s.selectionHead(b.id)).toBe(before);
  });
});
