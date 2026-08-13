import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { applyChangeSet } from "../../../src/core/document.js";
import { planStructureAction } from "../../../src/core/structure.js";
import { projectTree } from "../../../src/core/tree.js";

const DOC = `---
id: root
---

# Root

Body.

---
id: child
---

## Child

Child body.

---
id: leaf
---

### Leaf

Leaf body.
`;

describe("planStructureAction", () => {
  /** @covers R6 */
  it("deleteNode yields a single ChangeSet removing the subtree", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    const plan = planStructureAction(DOC, tree, FIXTURE_SCHEMA, {
      type: "deleteNode",
      nodeId: "child",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const next = applyChangeSet(DOC, plan.changes);
    const tree2 = projectTree(next, FIXTURE_SCHEMA);
    expect(tree2.nodes.has("child")).toBe(false);
    expect(tree2.nodes.has("leaf")).toBe(false);
    expect(tree2.nodes.has("root")).toBe(true);
  });

  /** @covers R6 */
  it("changeHeadingDepth rewrites cascaded headings in one ChangeSet", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    // Demote child (## → ###): leaf ### → ####. Both ranks stay in schema.
    const plan = planStructureAction(DOC, tree, FIXTURE_SCHEMA, {
      type: "changeHeadingDepth",
      nodeId: "child",
      headingDepth: 3,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const next = applyChangeSet(DOC, plan.changes);
    const tree2 = projectTree(next, FIXTURE_SCHEMA);
    expect(tree2.nodes.get("child")?.rank).toBe(2);
    expect(tree2.nodes.get("leaf")?.rank).toBe(3);
  });

  /** @covers R7 */
  it("rejects a cascade that would leave the schema", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    // Demote root (#) toward something that pushes leaf past max rank.
    // root rank 0 → try headingDepth 3 (rank 2): delta +2; leaf 2+2=4 not in schema (0..3 actually has rank 3).
    // FIXTURE has ranks 0..3. leaf 2+2=4 → not in schema → R7.
    const plan = planStructureAction(DOC, tree, FIXTURE_SCHEMA, {
      type: "changeHeadingDepth",
      nodeId: "root",
      headingDepth: 3,
    });
    expect(plan).toEqual({ ok: false, reason: "r7" });
    // Document unchanged by planner (caller must not apply).
    expect(projectTree(DOC, FIXTURE_SCHEMA).nodes.size).toBe(3);
  });

  /** @covers R7 */
  it("rejects depth not in schema", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    const plan = planStructureAction(DOC, tree, FIXTURE_SCHEMA, {
      type: "changeHeadingDepth",
      nodeId: "root",
      headingDepth: 6,
    });
    expect(plan).toEqual({ ok: false, reason: "r7" });
  });
});
