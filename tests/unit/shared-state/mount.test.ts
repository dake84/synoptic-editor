/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { createSession } from "../../../src/session.js";

const DOC = `---
id: root
---

# Root

Root body line.

---
id: child
---

## Child

Child body.
`;

describe("CM6 source mount (shared-state)", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  /** @covers I1, S1 */
  it("mounts two views on one document and keeps them in sync", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const a = session.createView({ scopeNodeId: "root", presentation: "source" });
    const b = session.createView({ scopeNodeId: "child", presentation: "source" });

    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    a.mount(elA);
    b.mount(elB);
    cleanups.push(() => {
      a.destroy();
      b.destroy();
      elA.remove();
      elB.remove();
    });

    expect(a._editor).toBeTruthy();
    expect(b._editor).toBeTruthy();
    expect(a._editor!.state.doc.toString()).toBe(b._editor!.state.doc.toString());

    session.apply({ type: "deleteNode", nodeId: "child" });
    expect(session.document).not.toContain("## Child");
    expect(a._editor!.state.doc.toString()).toBe(session.document);
    expect(b._editor!.state.doc.toString()).toBe(session.document);
  });

  /** @covers I4 */
  it("scrollToNode records a named cause", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({ scopeNodeId: "root", include: "subtree" });
    const el = document.createElement("div");
    document.body.append(el);
    view.mount(el);
    cleanups.push(() => {
      view.destroy();
      el.remove();
    });

    view.scrollToNode("child", "test-scroll");
    expect(view.lastScrollCause()).toBe("test-scroll");
    expect(view.visibleNode).toBe("child");
  });

  /** @covers T-V2 */
  it("after focus, shared selection lies in that view's render range", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const a = session.createView({ scopeNodeId: "root", include: "own", presentation: "source" });
    const b = session.createView({ scopeNodeId: "child", include: "subtree", presentation: "source" });
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    a.mount(elA);
    b.mount(elB);
    cleanups.push(() => {
      a.destroy();
      b.destroy();
      elA.remove();
      elB.remove();
    });

    // B's mount left the shared caret in child's range — A's visible lines hide it.
    a.focus();
    const head = a._editor!.state.selection.main.head;
    expect(a.selectionInRenderRange(head)).toBe(true);
    expect(session.caretTrace.latest()?.cause).toBeTruthy();
  });

  /** @covers T-V2 */
  it("clamps a selection that lands outside the originating view's render range", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const a = session.createView({ scopeNodeId: "root", include: "own", presentation: "source" });
    const b = session.createView({ scopeNodeId: "child", include: "subtree", presentation: "source" });
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    a.mount(elA);
    b.mount(elB);
    cleanups.push(() => {
      a.destroy();
      b.destroy();
      elA.remove();
      elB.remove();
    });

    a.focus();
    const child = session.tree.nodes.get("child")!;
    a._editor!.dispatch({
      selection: { anchor: child.heading.from },
    });
    const head = a._editor!.state.selection.main.head;
    expect(a.selectionInRenderRange(head)).toBe(true);
    expect(session.caretTrace.all().some((e) => e.cause === "selection.outside-render-range")).toBe(
      true,
    );
  });

  /** @covers G3 */
  it("applies a pointer selection to both views from the same transactions", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA, selectionMitigation: true });
    const a = session.createView({ scopeNodeId: "root", include: "own", presentation: "source" });
    const b = session.createView({ scopeNodeId: "child", include: "subtree", presentation: "source" });
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    a.mount(elA);
    b.mount(elB);
    cleanups.push(() => {
      a.destroy();
      b.destroy();
      elA.remove();
      elB.remove();
    });

    b.focus();
    const own = session.tree.nodes.get("root")!.ownRange;
    const pos = own.from + 1;
    a._editor!.dispatch({
      selection: { anchor: pos },
      userEvent: "select.pointer",
    });

    expect(a._editor!.state.selection.main.head).toBe(pos);
    expect(b._editor!.state.selection.main.head).toBe(pos);
  });

  /** @covers G3 */
  it("clamps a pointer click past the painted height into the origin keep range", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA, selectionMitigation: true });
    const a = session.createView({ scopeNodeId: "root", include: "own", presentation: "source" });
    const b = session.createView({ scopeNodeId: "other", include: "subtree", presentation: "source" });
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    a.mount(elA);
    b.mount(elB);
    cleanups.push(() => {
      a.destroy();
      b.destroy();
      elA.remove();
      elB.remove();
    });

    a._editor!.dispatch({
      selection: { anchor: session.document.length },
      userEvent: "select.pointer",
    });
    const head = a._editor!.state.selection.main.head;
    expect(head).toBeLessThan(session.document.length);
    expect(a.selectionInRenderRange(head)).toBe(true);
  });
});
