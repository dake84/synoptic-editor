import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { DirtyState } from "../../../src/core/dirty.js";
import { applyChangeSet, invertChangeSet, makeChangeSet } from "../../../src/core/document.js";
import { projectTree } from "../../../src/core/tree.js";

const DOC = `---
id: parent
---

# Parent

Parent body.

---
id: kid
---

## Kid

Kid body.
`;

describe("DirtyState", () => {
  /** @covers D1, D2, I7 */
  it("child edit dirties child and subtree of parent, not parent ownRange", () => {
    const dirty = new DirtyState();
    let doc = DOC;
    let tree = projectTree(doc, FIXTURE_SCHEMA);
    dirty.markPersisted(doc, tree);

    expect(dirty.isDirty(doc, tree, "parent")).toBe(false);
    expect(dirty.isDirty(doc, tree, "kid")).toBe(false);
    expect(dirty.isSubtreeDirty(doc, tree, "parent")).toBe(false);

    const kid = tree.nodes.get("kid")!;
    const insertAt = kid.heading.to + 1;
    const cs = makeChangeSet(doc.length, { from: insertAt, to: insertAt, insert: "X" });
    doc = applyChangeSet(doc, cs);
    tree = projectTree(doc, FIXTURE_SCHEMA);

    expect(dirty.isDirty(doc, tree, "kid")).toBe(true);
    expect(dirty.isDirty(doc, tree, "parent")).toBe(false);
    expect(dirty.isSubtreeDirty(doc, tree, "parent")).toBe(true);
  });

  /** @covers D4, D5 */
  it("markPersisted clears dirty; undo back to baseline clears dirty", () => {
    const dirty = new DirtyState();
    let doc = DOC;
    let tree = projectTree(doc, FIXTURE_SCHEMA);
    dirty.markPersisted(doc, tree);

    const parent = tree.nodes.get("parent")!;
    const at = parent.heading.to + 1;
    const forward = makeChangeSet(doc.length, { from: at, to: at, insert: "Z" });
    const inverse = invertChangeSet(doc, forward);
    doc = applyChangeSet(doc, forward);
    tree = projectTree(doc, FIXTURE_SCHEMA);
    expect(dirty.isDirty(doc, tree, "parent")).toBe(true);

    dirty.markPersisted(doc, tree, "parent");
    expect(dirty.isDirty(doc, tree, "parent")).toBe(false);

    // Further edit then undo to the persisted baseline
    const forward2 = makeChangeSet(doc.length, { from: at + 1, to: at + 1, insert: "Y" });
    const before = doc;
    doc = applyChangeSet(doc, forward2);
    tree = projectTree(doc, FIXTURE_SCHEMA);
    expect(dirty.isDirty(doc, tree, "parent")).toBe(true);

    doc = applyChangeSet(doc, invertChangeSet(before, forward2));
    tree = projectTree(doc, FIXTURE_SCHEMA);
    expect(dirty.isDirty(doc, tree, "parent")).toBe(false);

    // Also: undo first edit after full-document persist of original
    dirty.markPersisted(DOC, projectTree(DOC, FIXTURE_SCHEMA));
    doc = applyChangeSet(DOC, forward);
    tree = projectTree(doc, FIXTURE_SCHEMA);
    expect(dirty.isDirty(doc, tree, "parent")).toBe(true);
    doc = applyChangeSet(doc, inverse);
    tree = projectTree(doc, FIXTURE_SCHEMA);
    expect(dirty.isDirty(doc, tree, "parent")).toBe(false);
  });

  /** @covers D3 */
  it("structure-like delete dirties only nodes whose ownRange text changed", () => {
    const dirty = new DirtyState();
    let doc = DOC;
    let tree = projectTree(doc, FIXTURE_SCHEMA);
    dirty.markPersisted(doc, tree);

    const kid = tree.nodes.get("kid")!;
    doc = applyChangeSet(
      doc,
      makeChangeSet(doc.length, { from: kid.subtreeRange.from, to: kid.subtreeRange.to, insert: "" }),
    );
    tree = projectTree(doc, FIXTURE_SCHEMA);

    expect(tree.nodes.has("kid")).toBe(false);
    // Parent ownRange previously ended at the child — its text is unchanged (D3).
    expect(dirty.isDirty(doc, tree, "parent")).toBe(false);
    // Subtree no longer contains the child body — subtree baseline differs.
    expect(dirty.isSubtreeDirty(doc, tree, "parent")).toBe(true);
  });
});
