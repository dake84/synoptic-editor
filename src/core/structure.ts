/**
 * Structure-change planning (SPEC.md § 7.3 steps 2–3, R6, R7).
 * Returns one ChangeSet or a full rejection — never a partial plan.
 */

import { ChangeSet } from "@codemirror/state";
import { makeChangeSet } from "./document.js";
import { getNode } from "./tree.js";
import type { StructureSchema, Tree } from "./types.js";

export type StructureAction =
  | { type: "deleteNode"; nodeId: string }
  | {
      type: "changeHeadingDepth";
      nodeId: string;
      /** New ATX depth (# count). Must map to a schema rank. */
      headingDepth: number;
    };

export type StructurePlan =
  | { ok: true; changes: ChangeSet; targetNodeId: string }
  | { ok: false; reason: "r7" | "not_found" | "unsupported" };

function depthForRank(schema: StructureSchema, rank: number): number | undefined {
  return schema.levels.find((l) => l.rank === rank)?.headingDepth;
}

function rankForDepth(schema: StructureSchema, depth: number): number | undefined {
  return schema.levels.find((l) => l.headingDepth === depth)?.rank;
}

/**
 * Plan a structure action against the current tree + schema.
 * R7: schema-violating cascades are rejected entirely (no ChangeSet).
 * R6: success always yields exactly one ChangeSet.
 */
export function planStructureAction(
  doc: string,
  tree: Tree,
  schema: StructureSchema,
  action: StructureAction,
): StructurePlan {
  if (action.type === "deleteNode") {
    const node = getNode(tree, action.nodeId);
    if (!node) return { ok: false, reason: "not_found" };
    const { from, to } = node.subtreeRange;
    const changes = makeChangeSet(doc.length, { from, to, insert: "" });
    return { ok: true, changes, targetNodeId: action.nodeId };
  }

  if (action.type === "changeHeadingDepth") {
    const node = getNode(tree, action.nodeId);
    if (!node) return { ok: false, reason: "not_found" };

    const newRank = rankForDepth(schema, action.headingDepth);
    if (newRank === undefined) {
      return { ok: false, reason: "r7" };
    }

    // Cascade: children keep relative rank deltas; reject if any fall outside schema.
    const delta = newRank - node.rank;
    const affected: { id: string; newRank: number }[] = [{ id: node.id, newRank }];
    const queue = [...node.childIds];
    while (queue.length > 0) {
      const cid = queue.shift()!;
      const child = getNode(tree, cid)!;
      const childNew = child.rank + delta;
      if (depthForRank(schema, childNew) === undefined) {
        return { ok: false, reason: "r7" };
      }
      affected.push({ id: cid, newRank: childNew });
      queue.push(...child.childIds);
    }

    // Also reject if newRank would be >= parent's rank ordering illegally —
    // parent must stay strictly lower rank (outer). If parent exists and newRank <= parent.rank, R7.
    if (node.parentId) {
      const parent = getNode(tree, node.parentId)!;
      if (newRank <= parent.rank) return { ok: false, reason: "r7" };
    }

    // Build one ChangeSet: rewrite each affected heading's '#' run (R6).
    // Apply from end to start so offsets stay valid in a single set of specs.
    const specs: { from: number; to: number; insert: string }[] = [];
    for (const a of affected) {
      const n = getNode(tree, a.id)!;
      const depth = depthForRank(schema, a.newRank)!;
      const headingText = doc.slice(n.heading.from, n.heading.to);
      const m = /^(#{1,6})([ \t]+.*)$/.exec(headingText);
      if (!m) return { ok: false, reason: "unsupported" };
      const insert = "#".repeat(depth) + m[2]!;
      specs.push({ from: n.heading.from, to: n.heading.to, insert });
    }
    specs.sort((x, y) => y.from - x.from);
    const changes = makeChangeSet(doc.length, specs);
    return { ok: true, changes, targetNodeId: action.nodeId };
  }

  return { ok: false, reason: "unsupported" };
}
