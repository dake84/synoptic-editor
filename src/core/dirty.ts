/**
 * Dirty derived from baseline vs current ownRange / subtreeRange (SPEC.md I7, D1–D5).
 * Never stored as a separate mutable flag per edit path.
 */

import { sliceRange } from "./tree.js";
import type { Range, Tree } from "./types.js";

/** Debug snapshot of one node (D1/D2). Not a production API. */
export type DirtyInspectNode = {
  id: string;
  rank: number;
  title: string;
  parentId: string | null;
  childIds: string[];
  ownRange: Range;
  subtreeRange: Range;
  ownDirty: boolean;
  subtreeDirty: boolean;
  ownBaseline: string | undefined;
  ownCurrent: string;
  subtreeBaseline: string | undefined;
  subtreeCurrent: string;
};

export class DirtyState {
  /** nodeId → baseline text of ownRange at last markPersisted for that node. */
  private ownBaseline = new Map<string, string>();
  /** nodeId → baseline text of subtreeRange. */
  private subtreeBaseline = new Map<string, string>();

  /**
   * D5: set baseline for one node or the entire document (all current nodes).
   */
  markPersisted(doc: string, tree: Tree, nodeId?: string): void {
    if (nodeId !== undefined) {
      const n = tree.nodes.get(nodeId);
      if (!n) return;
      this.ownBaseline.set(nodeId, sliceRange(doc, n.ownRange));
      this.subtreeBaseline.set(nodeId, sliceRange(doc, n.subtreeRange));
      return;
    }
    this.ownBaseline.clear();
    this.subtreeBaseline.clear();
    for (const n of tree.nodes.values()) {
      this.ownBaseline.set(n.id, sliceRange(doc, n.ownRange));
      this.subtreeBaseline.set(n.id, sliceRange(doc, n.subtreeRange));
    }
  }

  /** D1: ownRange text ≠ baseline. Missing baseline ⇒ dirty. */
  isDirty(doc: string, tree: Tree, nodeId: string): boolean {
    const n = tree.nodes.get(nodeId);
    if (!n) return false;
    const base = this.ownBaseline.get(nodeId);
    if (base === undefined) return true;
    return sliceRange(doc, n.ownRange) !== base;
  }

  /** D2: subtreeRange text ≠ baseline. */
  isSubtreeDirty(doc: string, tree: Tree, nodeId: string): boolean {
    const n = tree.nodes.get(nodeId);
    if (!n) return false;
    const base = this.subtreeBaseline.get(nodeId);
    if (base === undefined) return true;
    return sliceRange(doc, n.subtreeRange) !== base;
  }

  /** After replaceDocument (U7): clear all baselines so everything is dirty until markPersisted. */
  clear(): void {
    this.ownBaseline.clear();
    this.subtreeBaseline.clear();
  }

  /** Baseline ownRange text from last markPersisted; undefined if never persisted. */
  ownBaselineOf(nodeId: string): string | undefined {
    return this.ownBaseline.get(nodeId);
  }

  /** Baseline subtreeRange text from last markPersisted; undefined if never persisted. */
  subtreeBaselineOf(nodeId: string): string | undefined {
    return this.subtreeBaseline.get(nodeId);
  }

  /** Full baseline-vs-current snapshot. Debug hosts only (`synoptic-editor/debug`). */
  inspect(doc: string, tree: Tree): DirtyInspectNode[] {
    const out: DirtyInspectNode[] = [];
    for (const n of tree.nodes.values()) {
      out.push({
        id: n.id,
        rank: n.rank,
        title: n.title,
        parentId: n.parentId,
        childIds: [...n.childIds],
        ownRange: { from: n.ownRange.from, to: n.ownRange.to },
        subtreeRange: { from: n.subtreeRange.from, to: n.subtreeRange.to },
        ownDirty: this.isDirty(doc, tree, n.id),
        subtreeDirty: this.isSubtreeDirty(doc, tree, n.id),
        ownBaseline: this.ownBaseline.get(n.id),
        ownCurrent: sliceRange(doc, n.ownRange),
        subtreeBaseline: this.subtreeBaseline.get(n.id),
        subtreeCurrent: sliceRange(doc, n.subtreeRange),
      });
    }
    return out;
  }
}
