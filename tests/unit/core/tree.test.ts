import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { applyChangeSet, makeChangeSet } from "../../../src/core/document.js";
import { ownRangeOf, projectTree, sliceRange, subtreeRangeOf } from "../../../src/core/tree.js";

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

---
id: other
---

# Other

Other body.
`;

describe("projectTree", () => {
  /** @covers I2, I8 */
  it("projects nodes from headings + frontmatter and reprojects after edits", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    expect(tree.roots).toEqual(["root", "other"]);
    expect(tree.nodes.get("root")?.childIds).toEqual(["child"]);
    expect(tree.nodes.get("child")?.parentId).toBe("root");
    expect(tree.nodes.get("root")?.rank).toBe(0);
    expect(tree.nodes.get("child")?.rank).toBe(1);

    const edited = DOC.replace("Root body.", "Root body changed.");
    const tree2 = projectTree(edited, FIXTURE_SCHEMA);
    expect(tree2.nodes.get("root")?.id).toBe("root");
    expect(sliceRange(edited, tree2.nodes.get("root")!.ownRange)).toContain("Root body changed.");
    // New projection object — not a mutated first tree (I2: projection, not second store).
    expect(tree2).not.toBe(tree);
  });

  /** @covers I2 */
  it("ownRange excludes children; subtreeRange includes them", () => {
    const tree = projectTree(DOC, FIXTURE_SCHEMA);
    const own = ownRangeOf(tree, "root")!;
    const sub = subtreeRangeOf(tree, "root")!;
    const ownText = sliceRange(DOC, own);
    const subText = sliceRange(DOC, sub);

    expect(ownText).toContain("Root body");
    expect(ownText).not.toContain("## Child");
    expect(subText).toContain("## Child");
    expect(subText).toContain("Child body");
    expect(own.to).toBeLessThan(sub.to);
  });

  /** @covers I2 */
  it("ignores headings whose depth is outside the schema", () => {
    const doc = `# Keep

##### NotANode

Body.
`;
    const schema = {
      levels: [{ rank: 0, id: "level-0", headingDepth: 1 }],
      idField: "id",
    };
    const tree = projectTree(doc, schema);
    expect(tree.roots).toHaveLength(1);
    expect([...tree.nodes.values()][0]!.title).toBe("Keep");
    expect(sliceRange(doc, [...tree.nodes.values()][0]!.ownRange)).toContain("##### NotANode");
  });
});

describe("document applyChangeSet", () => {
  /** @covers I1 */
  it("applies a ChangeSet to the single document string", () => {
    const doc = "abcd";
    const cs = makeChangeSet(doc.length, { from: 1, to: 3, insert: "X" });
    expect(applyChangeSet(doc, cs)).toBe("aXd");
  });
});
