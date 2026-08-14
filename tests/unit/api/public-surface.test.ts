import { describe, expect, it } from "vitest";
import { createSession, createTimeline } from "../../../src/index.js";

const SCHEMA = {
  levels: [
    { rank: 0, id: "level-0", headingDepth: 1 },
    { rank: 1, id: "level-1", headingDepth: 2 },
  ],
  idField: "id",
};

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
`;

describe("public API (SPEC § 12)", () => {
  /** @covers I3, U1, U12 */
  it("creates a session from the package root and undoes through session.undo", () => {
    const timeline = createTimeline();
    let foreign = 0;
    timeline.pushForeign({
      apply: () => {
        foreign += 1;
      },
      revert: () => {
        foreign -= 1;
      },
    });
    const session = createSession({ doc: DOC, schema: SCHEMA, timeline });
    const view = session.createView({ scope: { nodeId: "n0", include: "subtree" } });
    expect(session.document).toContain("Root body");
    expect(session.tree.nodes.get("n1")?.title).toBe("Child");
    expect(session.readNodes(["n1"])[0]?.title).toBe("Child");
    expect(session.view(view.id)?.id).toBe(view.id);
    expect(session.timelineDepth).toBe(1);
    session.undo();
    expect(foreign).toBe(-1);
    expect(session.timelineDepth).toBe(0);
    session.redo();
    expect(foreign).toBe(0);
  });

  /** @covers TP1, TP5, TP7 */
  it("tracks a position and resolves it after a structure apply", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA });
    const at = session.document.indexOf("Child body");
    const id = session.createTrackedPosition({ from: at, to: at + 5 });
    expect(session.resolve(id)?.valid).toBe(true);
    expect(session.apply({ type: "deleteNode", nodeId: "n1" })).toBe(true);
    expect(session.tree.nodes.has("n1")).toBe(false);
    session.release(id);
    expect(session.resolve(id)).toBeUndefined();
  });

  /** @covers F1, F2, I7 */
  it("searches through a view handle and reports dirty from the document", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "source",
    });
    const hits = view.find("Child", { mode: "document" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.class).toBe("prose");
    expect(session.isDirty("n0")).toBe(false);
    session.subscribe(() => undefined);
    view.focus();
    expect(session.focusedViewId).toBe(view.id);
  });
});
