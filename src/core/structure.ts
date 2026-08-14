/**
 * Structure-change planning (SPEC.md § 7.3 steps 2–3, R6, R7).
 * Returns one ChangeSet or a full rejection — never a partial plan.
 */

import { ChangeSet } from "@codemirror/state";
import { applyChangeSet, makeChangeSet } from "./document.js";
import { getNode, projectTree } from "./tree.js";
import type { StructureSchema, Tree } from "./types.js";

export type StructureAction =
  | { type: "deleteNode"; nodeId: string }
  | {
      type: "changeHeadingDepth";
      nodeId: string;
      /** New ATX depth (# count). Must map to a schema rank. */
      headingDepth: number;
    }
  | {
      type: "moveNode";
      nodeId: string;
      /** Destination parent, or `null` for a document root. */
      parentId: string | null;
      /** Final index among the destination parent's children (or roots). */
      index: number;
    }
  | { type: "renameNode"; nodeId: string; title: string };

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

  if (action.type === "renameNode") {
    const node = getNode(tree, action.nodeId);
    if (!node) return { ok: false, reason: "not_found" };
    const headingText = doc.slice(node.heading.from, node.heading.to);
    const m = /^(#{1,6}[ \t]+)(.*)$/.exec(headingText);
    if (!m) return { ok: false, reason: "unsupported" };
    if (m[2] === action.title) return { ok: false, reason: "unsupported" };
    const insert = m[1]! + action.title;
    const changes = makeChangeSet(doc.length, {
      from: node.heading.from,
      to: node.heading.to,
      insert,
    });
    return { ok: true, changes, targetNodeId: action.nodeId };
  }

  if (action.type === "moveNode") {
    return planMoveNode(doc, tree, schema, action);
  }

  return { ok: false, reason: "unsupported" };
}

function isDescendant(tree: Tree, ancestorId: string, nodeId: string): boolean {
  let id: string | null = nodeId;
  while (id) {
    if (id === ancestorId) return true;
    id = getNode(tree, id)?.parentId ?? null;
  }
  return false;
}

function clampIndex(index: number, length: number): number {
  if (index < 0) return 0;
  if (index > length) return length;
  return index;
}

/**
 * Splice a node's subtree so tree projection yields the requested parent + index.
 * Verified by applying to a copy (R7) — heading ranks, not parentId, are truth.
 */
function planMoveNode(
  doc: string,
  tree: Tree,
  schema: StructureSchema,
  action: { type: "moveNode"; nodeId: string; parentId: string | null; index: number },
): StructurePlan {
  const node = getNode(tree, action.nodeId);
  if (!node) return { ok: false, reason: "not_found" };
  if (action.parentId === action.nodeId) return { ok: false, reason: "r7" };
  if (action.parentId && !getNode(tree, action.parentId)) {
    return { ok: false, reason: "not_found" };
  }
  if (action.parentId && isDescendant(tree, action.nodeId, action.parentId)) {
    return { ok: false, reason: "r7" };
  }
  if (action.parentId) {
    const parent = getNode(tree, action.parentId)!;
    if (node.rank <= parent.rank) return { ok: false, reason: "r7" };
  }

  const destIds = action.parentId
    ? [...(getNode(tree, action.parentId)?.childIds ?? [])]
    : [...tree.roots];
  const without = destIds.filter((id) => id !== action.nodeId);
  const index = clampIndex(action.index, without.length);

  let insertPos: number;
  if (without.length === 0) {
    if (action.parentId) {
      insertPos = getNode(tree, action.parentId)!.ownRange.to;
    } else {
      insertPos = 0;
    }
  } else if (index < without.length) {
    insertPos = getNode(tree, without[index]!)!.subtreeRange.from;
  } else {
    insertPos = getNode(tree, without[without.length - 1]!)!.subtreeRange.to;
  }

  const from = node.subtreeRange.from;
  const to = node.subtreeRange.to;
  if (insertPos > from && insertPos < to) return { ok: false, reason: "r7" };
  if (insertPos === from) return { ok: false, reason: "unsupported" };

  let block = doc.slice(from, to);
  if (block.length === 0) return { ok: false, reason: "unsupported" };
  if (!block.endsWith("\n") && to < doc.length && insertPos !== doc.length) {
    block += "\n";
  }

  const specs =
    insertPos <= from
      ? [
          { from: insertPos, to: insertPos, insert: block },
          { from, to, insert: "" },
        ]
      : [
          { from, to, insert: "" },
          { from: insertPos, to: insertPos, insert: block },
        ];
  const changes = makeChangeSet(doc.length, specs);
  const next = applyChangeSet(doc, changes);
  const tree2 = projectTree(next, schema);
  const moved = getNode(tree2, action.nodeId);
  if (!moved) return { ok: false, reason: "r7" };
  if (moved.parentId !== action.parentId) return { ok: false, reason: "r7" };
  const siblings = moved.parentId
    ? (getNode(tree2, moved.parentId)?.childIds ?? [])
    : tree2.roots;
  if (siblings.indexOf(action.nodeId) !== index) return { ok: false, reason: "r7" };
  return { ok: true, changes, targetNodeId: action.nodeId };
}
