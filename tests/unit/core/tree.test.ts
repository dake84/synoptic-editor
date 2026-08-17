import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { applyChangeSet, makeChangeSet } from "../../../src/core/document.js";
import { headingUnitRanges, ownRangeOf, paddedFrontmatterRanges, hiddenFrontmatterRanges, projectTree, sliceRange, subtreeRangeOf } from "../../../src/core/tree.js";

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

  /** @covers I2, L1 */
  it("does not treat ATX inside a fenced code block as a structure node", () => {
    const doc = ["# Root", "", "```", "# not a node", "```", ""].join("\n");
    const tree = projectTree(doc, FIXTURE_SCHEMA);
    expect(tree.roots).toEqual(["auto-1"]);
    expect([...tree.nodes.values()]).toHaveLength(1);
    expect(tree.nodes.get("auto-1")?.title).toBe("Root");
  });
});

describe("paddedFrontmatterRanges", () => {
  /** @covers FM2 */
  it("includes blanks between the closing fence and the bound heading", () => {
    const doc = ["---", "id: n0", "---", "", "# Root", "body", ""].join("\n");
    const [zone] = paddedFrontmatterRanges(doc, FIXTURE_SCHEMA);
    expect(zone).toBeTruthy();
    expect(doc.slice(zone!.from, zone!.to)).toContain("id: n0");
    expect(zone!.to).toBe(doc.indexOf("# Root"));
  });

  /** @covers FM2 */
  it("includes the break after the preceding non-empty line", () => {
    const doc = ["# Root", "", "---", "id: child", "---", "", "## Child", "body", ""].join("\n");
    const zones = paddedFrontmatterRanges(doc, FIXTURE_SCHEMA);
    const child = zones.find((z) => doc.slice(z.from, z.to).includes("id: child"));
    expect(child).toBeTruthy();
    const heading = doc.indexOf("# Root");
    const rootLineEnd = doc.indexOf("\n", heading);
    expect(child!.from).toBe(rootLineEnd);
    expect(child!.to).toBe(doc.indexOf("## Child"));
  });
});

describe("hiddenFrontmatterRanges", () => {
  /** @covers FM9 */
  it("starts at the opening fence, not the blank after the previous heading", () => {
    const doc = ["# Root", "", "---", "id: child", "---", "", "## Child", "body", ""].join("\n");
    const zones = hiddenFrontmatterRanges(doc, FIXTURE_SCHEMA);
    const child = zones.find((z) => doc.slice(z.from, z.to).includes("id: child"));
    expect(child).toBeTruthy();
    expect(child!.from).toBe(doc.indexOf("---\nid: child"));
    expect(child!.to).toBe(doc.indexOf("## Child"));
    expect(doc.slice(0, child!.from)).toContain("\n\n");
    expect(doc.slice(child!.from, child!.to)).not.toMatch(/^\n/);
  });
});

describe("headingUnitRanges", () => {
  /** @covers LH1 */
  it("joins the YAML fence with the bound ATX line", () => {
    const doc = ["---", "id: n0", "---", "", "# Root", "body", ""].join("\n");
    const [unit] = headingUnitRanges(doc, FIXTURE_SCHEMA);
    expect(unit).toBeTruthy();
    expect(doc.slice(unit!.from, unit!.to)).toContain("id: n0");
    expect(doc.slice(unit!.from, unit!.to)).toContain("# Root");
    expect(doc.slice(unit!.from, unit!.to)).not.toContain("body");
    expect(unit!.from).toBe(0);
    expect(unit!.to).toBe(doc.indexOf("body"));
  });

  /** @covers LH1 */
  it("starts at the heading when there is no YAML", () => {
    const doc = "# Root\n\nbody\n";
    const [unit] = headingUnitRanges(doc, FIXTURE_SCHEMA);
    expect(doc.slice(unit!.from, unit!.to)).toBe("# Root\n");
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
