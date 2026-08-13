/**
 * Dirty derived from baseline vs current ownRange / subtreeRange (SPEC.md I7, D1–D5).
 * Never stored as a separate mutable flag per edit path.
 */

import { sliceRange } from "./tree.js";
import type { Tree } from "./types.js";

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
}
