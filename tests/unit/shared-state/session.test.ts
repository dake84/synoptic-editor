import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { makeChangeSet } from "../../../src/core/document.js";
import { createSession } from "../../../src/session.js";
import { createSync } from "../../../src/sync/index.js";

const DOC = `---
id: root
---

# Root

Root body.

---
id: child
---

## Child

Child body.
`;

describe("createSync", () => {
  /** @covers I1 */
  it("shared-state applies one ChangeSet to the single document", () => {
    const sync = createSync("shared-state", "ab");
    const next = sync.applyChanges(makeChangeSet(2, { from: 1, to: 1, insert: "X" }));
    expect(next).toBe("aXb");
    expect(sync.getDoc()).toBe("aXb");
  });

  it("refuses per-view-state until B3", () => {
    expect(() => createSync("per-view-state", "")).toThrow(/per-view-state/);
  });
});

describe("createSession", () => {
  /** @covers I1, I2, I3 */
  it("projects tree, applies structure, undoes on one timeline", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    expect(session.tree.nodes.has("child")).toBe(true);
    expect(session.variant).toBe("shared-state");

    const ok = session.apply({ type: "deleteNode", nodeId: "child" });
    expect(ok).toBe(true);
    expect(session.tree.nodes.has("child")).toBe(false);
    expect(session.document).not.toContain("## Child");

    expect(session.undo()).toBe(true);
    expect(session.tree.nodes.has("child")).toBe(true);
    expect(session.document).toContain("## Child");
  });

  /** @covers R7 */
  it("leaves document unchanged when structure plan is rejected", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const before = session.document;
    const ok = session.apply({
      type: "changeHeadingDepth",
      nodeId: "root",
      headingDepth: 6,
    });
    expect(ok).toBe(false);
    expect(session.document).toBe(before);
    expect(session.timelineDepth).toBe(0);
  });

  /** @covers D1, D5 */
  it("exposes derived dirty after text change", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    expect(session.isDirty("root")).toBe(false);
    const root = session.tree.nodes.get("root")!;
    const at = root.heading.to + 1;
    session.applyTextChange(makeChangeSet(session.document.length, { from: at, to: at, insert: "!" }));
    expect(session.isDirty("root")).toBe(true);
    expect(session.isDirty("child")).toBe(false);
    session.markPersisted("root");
    expect(session.isDirty("root")).toBe(false);
  });

  /** @covers U7, TP8 */
  it("replaceDocument clears timeline and invalidates tracked positions", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const id = session.createTrackedPosition({ from: 0, to: 1 });
    session.applyTextChange(makeChangeSet(session.document.length, { from: 0, to: 0, insert: "Z" }));
    expect(session.timelineDepth).toBe(1);

    session.replaceDocument(DOC);
    expect(session.timelineDepth).toBe(0);
    expect(session.document).toBe(DOC);
    expect(session.resolve(id)?.valid).toBe(false);
  });

  /** @covers I3 */
  it("subscribe fires on changes", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    let n = 0;
    session.subscribe(() => {
      n += 1;
    });
    session.apply({ type: "deleteNode", nodeId: "child" });
    expect(n).toBeGreaterThan(0);
  });
});

describe("Session views", () => {
  /** @covers R2 */
  it("falls scope back to ancestor when scope node is deleted", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({ scopeNodeId: "child" });
    view.focus();
    expect(session.activeNode).toBe("child");

    session.apply({ type: "deleteNode", nodeId: "child" });
    expect(view.scopeNodeId).toBe("root");
    expect(session.activeNode).toBe("root");
  });

  /** @covers I4 */
  it("navigateTo inside scope scrolls; outside sets scope", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({ scopeNodeId: "root", include: "subtree" });
    view.navigateTo("child");
    expect(view.scopeNodeId).toBe("root");
    expect(view.visibleNode).toBe("child");

    view.navigateTo("root");
    // same scope → scroll to start
    expect(view.scopeNodeId).toBe("root");

    // sibling-like: only one root with child; create second root via doc replace is heavy —
    // set scope to child then navigate to root (ancestor outside own-only? root is outside child's range)
    view.setScope("child", { include: "own" });
    view.navigateTo("root");
    expect(view.scopeNodeId).toBe("root");
  });

  it("destroy removes view; closing does not clear timeline", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    session.applyTextChange(makeChangeSet(session.document.length, { from: 0, to: 0, insert: "Q" }));
    const depth = session.timelineDepth;
    const view = session.createView();
    view.destroy();
    expect(session.timelineDepth).toBe(depth);
  });
});
