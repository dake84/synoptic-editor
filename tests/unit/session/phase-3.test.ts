import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";
import { headingMarkers } from "../../../src/view/guards/wysiwyg.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
note: hello
extra: world
---

# Root

Root body [Alpha]{id=a type=ref} end.

---
id: n1
---

## Child

Child body.
`;

function session(policy?: {
  structureEditingInWysiwyg?: "locked" | "allowed";
  frontmatterInWysiwyg?: "form" | "hidden";
  pillFields?: string[];
}) {
  return createSession({
    doc: DOC,
    schema: FIXTURE_SCHEMA,
    policy: {
      structureEditingInWysiwyg: "locked",
      frontmatterInWysiwyg: "form",
      pillFields: ["note"],
      ...policy,
    },
  });
}

describe("phase 3 frontmatter and locks", () => {
  /** @covers T38, T39, T64, FM1, FM2 */
  it("rejects caret edits that would enter or split frontmatter in wysiwyg", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    const fm = s.tree.nodes.get("n0")!.frontmatter!;
    // 50 deletes at the FM start must not corrupt fences
    for (let i = 0; i < 50; i++) {
      s.dispatch(v.id, [{ changes: { from: fm.from, to: fm.from + 1, insert: "" } }]);
    }
    expect(s.document.slice(fm.from, fm.from + 3)).toBe("---");
    expect(s.document).toContain("id: n0");
    expect(s.document).toContain("note: hello");
    // Insert at FM interior rejected
    s.dispatch(v.id, [{ changes: { from: fm.from + 4, insert: "Z" } }]);
    expect(s.document).not.toContain("Zid:");
  });

  /** @covers T51, T52, T53, T55, FM3, FM4, FM5, D1 */
  it("form field write is one timeline entry, dirty only on that node, clear removes key", () => {
    const s = session();
    const parent = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    const child = s.createView({ scope: { nodeId: "n1", include: "own" }, presentation: "source" });
    const fm = s.tree.nodes.get("n0")!.frontmatter!;
    const depth = s.timelineDepth;
    expect(s.writeFrontmatterField(fm.from, "note", "bye")).toBe(true);
    expect(s.document).toContain("note: bye");
    expect(s.excerpt(child.id)).not.toContain("bye"); // child source is different node
    expect(s.timelineDepth).toBe(depth + 1);
    expect(s.isDirty("n0")).toBe(true);
    expect(s.isDirty("n1")).toBe(false);
    s.undo();
    expect(s.document).toContain("note: hello");
    expect(s.writeFrontmatterField(fm.from, "note", null)).toBe(true);
    expect(s.document).not.toContain("note:");
    expect(s.document).toContain("id: n0");
    void parent;
  });

  /** @covers T43, L4, R5 */
  it("locked structure rejects marker edits; allowed permits them; title stays editable", () => {
    const locked = session({ structureEditingInWysiwyg: "locked" });
    const lv = locked.createView({ scope: { nodeId: "n0" }, presentation: "wysiwyg" });
    const markers = headingMarkers(locked.document);
    const mk = markers[0]!;
    const before = locked.document;
    locked.dispatch(lv.id, [{ changes: { from: mk.from, to: mk.to, insert: "" } }]);
    expect(locked.document).toBe(before);
    // Title edit after marker
    locked.dispatch(lv.id, [{ changes: { from: mk.to, insert: "X" } }]);
    expect(locked.document).toContain("XRoot");

    const allowed = session({ structureEditingInWysiwyg: "allowed" });
    const av = allowed.createView({ scope: { nodeId: "n1" }, presentation: "wysiwyg" });
    const m1 = headingMarkers(allowed.document).find((m) => allowed.document.slice(m.from, m.to).startsWith("##"))!;
    allowed.dispatch(av.id, [{ changes: { from: m1.from, to: m1.to, insert: "" } }]);
    expect(allowed.document).not.toContain("## Child");
  });

  /** @covers T44, U6, L5 */
  it("undo may restore structure even when wysiwyg is locked", () => {
    const s = session({ structureEditingInWysiwyg: "locked" });
    s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "source" });
    expect(s.apply({ type: "deleteNode", nodeId: "n1" })).toBe(true);
    expect(s.document).not.toContain("## Child");
    s.undo();
    expect(s.document).toContain("## Child");
  });

  /** @covers T40, T41, L2, L3 */
  it("typed and multi-line inserts mask once as a single undo step", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "own" }, presentation: "wysiwyg" });
    const at = s.document.indexOf("Root body");
    const depth = s.timelineDepth;
    s.dispatch(v.id, [{ changes: { from: at, insert: "#*\n_" } }]);
    expect(s.document).toContain("\\#\\*");
    expect(s.document).toContain("\\_");
    expect(s.document).not.toContain("\\\\#");
    expect(s.timelineDepth).toBe(depth + 1);
    s.undo();
    expect(s.document).toContain("Root body [Alpha]");
  });
});

describe("phase 3 chips pills search replace", () => {
  /** @covers T54, T56, W4, W5 */
  it("widgets survive presentation grain and scope changes", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    v.setGrain(0);
    v.setScope("n0", { include: "own" });
    v.setPresentation("source");
    v.setPresentation("wysiwyg");
    expect(s.document).toContain("[Alpha]{id=a type=ref}");
    expect(s.writeFrontmatterField(s.tree.nodes.get("n0")!.frontmatter!.from, "note", "ok")).toBe(true);
  });

  /** @covers T45, T46, T47, T48, T68, T69, T71, T72, T75, F4, F5, F6, F9, P4, P5, W1, W2 */
  it("find projection differs by presentation and hit class", () => {
    const s = session();
    const wys = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    const src = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "source" });
    const hashW = wys.find("#", { mode: "view" });
    const hashS = src.find("#", { mode: "view" });
    expect(hashW.length).toBe(0);
    expect(hashS.length).toBeGreaterThan(0);

    const noteW = wys.find("hello", { mode: "view" });
    expect(noteW).toHaveLength(1);
    expect(noteW[0]!.class).toBe("metadata");
    const extraW = wys.find("world", { mode: "view" });
    expect(extraW).toHaveLength(0);
    const extraS = src.find("world", { mode: "view" });
    expect(extraS.length).toBeGreaterThan(0);

    const label = wys.find("Alpha", { mode: "view" });
    expect(label).toHaveLength(1);
    expect(label[0]!.class).toBe("prose");
    expect(wys.find("type=ref", { mode: "view" })).toHaveLength(0);
    expect(wys.find("id=a", { mode: "view" })).toHaveLength(0);

    const title = wys.find("Root", { mode: "view" });
    expect(title.some((h) => h.class === "prose")).toBe(true);
  });

  /** @covers T49, T50, F1, F2, F3 */
  it("view find stays in range; document find reaches outside and reveals via U5", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n1", include: "own" }, presentation: "source" });
    const scopeBefore = s.scopeOf(v.id).nodeId;
    const activeBefore = s.activeNode;
    const local = v.find("Root", { mode: "view" });
    expect(local).toHaveLength(0);
    expect(s.scopeOf(v.id).nodeId).toBe(scopeBefore);
    expect(s.activeNode).toBe(activeBefore);
    const global = v.find("Root", { mode: "document" });
    expect(global.length).toBeGreaterThan(0);
    expect(s.scopeOf(v.id).nodeId).toBe("n0");
  });

  /** @covers T68, T69, F7 — prose hits are marked and selected as substring */
  it("find highlights and selects prose hits; metadata does not move caret into yaml", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    const hits = v.find("Alpha", { mode: "view" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.class).toBe("prose");
    expect(s.selectionHead(v.id)).toBe(hits[0]!.to);
    expect(s.document.slice(hits[0]!.from, hits[0]!.to)).toBe("Alpha");
    expect(s.lastScrollCause(v.id)).toBe("find");

    const meta = v.find("hello", { mode: "view" });
    expect(meta[0]!.class).toBe("metadata");
    // metadata: caret must not land inside the YAML value (P3)
    const head = s.selectionHead(v.id);
    expect(head < meta[0]!.from || head > meta[0]!.to).toBe(true);
  });

  /** @covers T70 */
  it("two views can search different modes independently", () => {
    const s = session();
    const a = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "source" });
    const b = s.createView({ scope: { nodeId: "n1", include: "own" }, presentation: "source" });
    const ha = a.find("Root", { mode: "document" });
    const hb = b.find("Child", { mode: "view" });
    expect(ha.length).toBeGreaterThan(0);
    expect(hb.length).toBeGreaterThan(0);
  });

  /** @covers T76, T77, T78, T79, T80, T81, T82, RP2, RP3, RP5, RP6, RP7, D1 */
  it("replaceAll is one undo step, respects mode classes and yaml guard", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    v.find("e", { mode: "view" });
    const depth = s.timelineDepth;
    const result = v.replaceAll("X", { classes: ["prose"] });
    expect(result.prose).toBeGreaterThan(0);
    expect(result.metadata ?? 0).toBe(0);
    expect(s.timelineDepth).toBe(depth + 1);
    s.undo();
    expect(s.document).toContain("Root body");

    const src = s.createView({ scope: { nodeId: "n1", include: "own" }, presentation: "source" });
    src.find("Child", { mode: "view" });
    src.replaceAll("Kid");
    expect(s.document).toContain("Kid");
    expect(s.document).toContain("Root body");
    expect(s.isDirty("n1")).toBe(true);
    expect(s.isDirty("n0")).toBe(false);

    const w = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    w.find("hello", { mode: "view" });
    const bad = w.replaceAll("a: b", { classes: ["metadata"] });
    expect(bad.rejected).toBeGreaterThan(0);
    expect(s.document).toContain("note: hello");

    w.find("hello", { mode: "view" });
    const ok = w.replaceAll("hi", { classes: ["metadata"] });
    expect(ok.metadata).toBe(1);
    expect(s.document).toContain("note: hi");

    // Chip attribute not findable → cannot replace (T81)
    expect(w.find("type=ref", { mode: "view" })).toHaveLength(0);
  });

  /** @covers T73, T74, P2, P3, W3 */
  it("chip is atomic; deleting beside a pill/fm does not remove pill source field", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "own" }, presentation: "wysiwyg" });
    const chip = s.document.indexOf("[Alpha]");
    // Partial delete inside chip attrs should expand or no-op via atoms — delete whole unit from start
    s.dispatch(v.id, [{ changes: { from: chip, to: chip + 1, insert: "" } }]);
    // After atomic expand, either chip gone entirely or still intact
    const still = s.document.includes("[Alpha]{id=a type=ref}");
    const gone = !s.document.includes("[Alpha]") && !s.document.includes("type=ref");
    expect(still || gone).toBe(true);

    const beforeNote = s.document.includes("note: hello") || s.document.includes("note: hi") || s.document.includes("note:");
    const body = s.document.indexOf("Root body");
    if (body >= 0) s.dispatch(v.id, [{ changes: { from: body, to: body + 1, insert: "" } }]);
    expect(s.document.includes("note:")).toBe(beforeNote || s.document.includes("note:"));
  });

  /** @covers T62, FM4 */
  it("frontmatter field change of a child dirties only the child", () => {
    const childDoc = `---
id: n0
---

# Root

---
id: n1
note: x
---

## Child

Body.
`;
    const s = createSession({
      doc: childDoc,
      schema: FIXTURE_SCHEMA,
      policy: { pillFields: ["note"] },
    });
    s.createView({ scope: { nodeId: "n1" }, presentation: "wysiwyg" });
    const fm = s.tree.nodes.get("n1")!.frontmatter!;
    s.writeFrontmatterField(fm.from, "note", "y");
    expect(s.isDirty("n1")).toBe(true);
    expect(s.isDirty("n0")).toBe(false);
    expect(s.isSubtreeDirty("n0")).toBe(true);
  });

  /** @covers T65, T66, T67, FM6 */
  it("scope node frontmatter is rewritten even when it sits before the heading", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "own" }, presentation: "wysiwyg" });
    const fm = s.tree.nodes.get("n0")!.frontmatter!;
    expect(fm.to).toBeLessThanOrEqual(s.tree.nodes.get("n0")!.heading.from);
    s.writeFrontmatterField(fm.from, "extra", "");
    expect(s.document).not.toContain("extra:");
    expect(s.excerpt(v.id)).toContain("# Root");
  });

  /** @covers F7, FM7, P1, RP1, RP4 */
  it("covers projection edges: form excluded, pill widget position, replace writes doc", () => {
    const s = session();
    const v = s.createView({ scope: { nodeId: "n0", include: "subtree" }, presentation: "wysiwyg" });
    expect(v.find("extra", { mode: "view" })).toHaveLength(0);
    expect(v.find("hello", { mode: "view" })[0]?.class).toBe("metadata");
    expect(s.document.indexOf("note: hello")).toBeLessThan(s.document.indexOf("# Root"));
    const titleHits = v.find("Roo", { mode: "view" });
    expect(titleHits.some((h) => h.class === "prose")).toBe(true);
    v.find("end", { mode: "view" });
    v.replaceAll("END");
    expect(s.document).toContain("END");
  });
});
