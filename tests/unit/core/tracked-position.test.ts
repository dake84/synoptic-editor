import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";
import { applyChangeSet, invertChangeSet, makeChangeSet } from "../../../src/core/document.js";
import { projectTree } from "../../../src/core/tree.js";
import { createTrackedPositionRegistry } from "../../../src/core/tracked-position.js";

describe("TrackedPositionRegistry", () => {
  /** @covers TP1 */
  it("maps positions through inserts before the mark", () => {
    const reg = createTrackedPositionRegistry();
    let doc = "abcdefgh";
    const id = reg.create({ from: 3, to: 5 }); // "de"
    const cs = makeChangeSet(doc.length, { from: 0, to: 0, insert: "XX" });
    doc = applyChangeSet(doc, cs);
    reg.mapThrough(cs);
    const p = reg.get(id)!;
    expect(p.valid).toBe(true);
    expect(doc.slice(p.from, p.to)).toBe("de");
  });

  /** @covers TP2, TP4, TP5 */
  it("marks fully deleted ranges invalid but keeps them until release", () => {
    const reg = createTrackedPositionRegistry();
    const invalidated: string[] = [];
    reg.onInvalidate((id) => invalidated.push(id));

    let doc = "abcdefgh";
    const id = reg.create({ from: 2, to: 5 }); // "cde"
    const cs = makeChangeSet(doc.length, { from: 2, to: 5, insert: "" });
    const inv = invertChangeSet(doc, cs);
    doc = applyChangeSet(doc, cs);
    reg.mapThrough(cs);

    expect(reg.get(id)!.valid).toBe(false);
    expect(invalidated).toEqual([id]);
    expect(reg.size()).toBe(1);

    // TP3: undo restore
    doc = applyChangeSet(doc, inv);
    reg.mapThrough(inv);
    expect(reg.get(id)!.valid).toBe(true);
    expect(doc.slice(reg.get(id)!.from, reg.get(id)!.to)).toBe("cde");

    reg.release(id);
    expect(reg.get(id)).toBeUndefined();
    expect(reg.size()).toBe(0);
  });

  /** @covers TP8 */
  it("invalidateAll marks every position invalid without removing", () => {
    const reg = createTrackedPositionRegistry();
    const a = reg.create({ from: 0, to: 1 });
    const b = reg.create({ from: 2, to: 3 });
    reg.invalidateAll();
    expect(reg.get(a)!.valid).toBe(false);
    expect(reg.get(b)!.valid).toBe(false);
    expect(reg.size()).toBe(2);
  });

  /** @covers TP7 */
  it("resolve returns nodeId and offset against the tree", () => {
    const doc = `---
id: n1
---

# Title

Hello.
`;
    const tree = projectTree(doc, FIXTURE_SCHEMA);
    const reg = createTrackedPositionRegistry();
    const node = tree.nodes.get("n1")!;
    const pos = node.heading.to + 1;
    const id = reg.create({ from: pos, to: pos });
    const resolved = reg.resolve(id, tree)!;
    expect(resolved.nodeId).toBe("n1");
    expect(resolved.valid).toBe(true);
  });
});
