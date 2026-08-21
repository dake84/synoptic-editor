import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/index.js";
import { inspectDirty } from "../../../src/debug.js";

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

describe("synoptic-editor/debug (not SPEC § 12)", () => {
  /** @covers D1, D2, D5 */
  it("inspectDirty returns baseline vs current for a child edit", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA });
    const before = inspectDirty(session);
    const child = before.nodes.find((node) => node.id === "n1");
    expect(child?.ownDirty).toBe(false);
    expect(child?.ownBaseline).toBe(child?.ownCurrent);

    const insertAt = session.document.indexOf("Child body.");
    expect(insertAt).toBeGreaterThanOrEqual(0);
    session.apply({ type: "renameNode", nodeId: "n1", title: "Kid" });

    const after = inspectDirty(session);
    const dirtyChild = after.nodes.find((node) => node.id === "n1");
    expect(dirtyChild?.ownDirty).toBe(true);
    expect(dirtyChild?.ownBaseline).not.toBe(dirtyChild?.ownCurrent);
    expect(after.nodes.find((node) => node.id === "n0")?.ownDirty).toBe(false);
  });
});
