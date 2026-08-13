/**
 * TrackedPosition registry (SPEC.md § 3.4, TP1–TP5, TP7–TP8).
 * Headless: maps through ChangeSet; invalid ≠ released.
 */

import type { ChangeSet } from "@codemirror/state";
import { nodeAtPosition } from "./tree.js";
import type { Range, Tree } from "./types.js";

export type TrackedPositionId = string;

export interface TrackedPositionRecord {
  id: TrackedPositionId;
  from: number;
  to: number;
  valid: boolean;
}

export interface ResolvedTrackedPosition {
  nodeId: string | null;
  offset: number;
  from: number;
  to: number;
  valid: boolean;
}

export type InvalidationListener = (id: TrackedPositionId) => void;

let nextId = 1;

export class TrackedPositionRegistry {
  private positions = new Map<TrackedPositionId, TrackedPositionRecord>();
  private listeners = new Set<InvalidationListener>();

  onInvalidate(listener: InvalidationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(range: Range): TrackedPositionId {
    const id = `tp-${nextId++}`;
    this.positions.set(id, {
      id,
      from: range.from,
      to: range.to,
      valid: true,
    });
    return id;
  }

  /** TP5: explicit release only. */
  release(id: TrackedPositionId): void {
    this.positions.delete(id);
  }

  get(id: TrackedPositionId): TrackedPositionRecord | undefined {
    return this.positions.get(id);
  }

  /** TP7: simple data snapshot for persistence. */
  resolve(id: TrackedPositionId, tree: Tree): ResolvedTrackedPosition | undefined {
    const p = this.positions.get(id);
    if (!p) return undefined;
    const node = nodeAtPosition(tree, p.from);
    return {
      nodeId: node?.id ?? null,
      offset: node ? p.from - node.subtreeRange.from : p.from,
      from: p.from,
      to: p.to,
      valid: p.valid,
    };
  }

  /**
   * TP1: map all positions through a document change.
   * TP2: fully deleted range → invalid (still present until release).
   * TP3: inverse mapping can revive an invalid position when content returns.
   */
  mapThrough(changes: ChangeSet): void {
    if (changes.empty) return;
    for (const p of this.positions.values()) {
      const prevFrom = p.from;
      const prevTo = p.to;
      const wasValid = p.valid;
      const hadWidth = prevTo > prevFrom;

      // Assocs chosen so inserts at the boundary expand a collapsed mark on undo.
      const newFrom = changes.mapPos(prevFrom, wasValid ? 1 : -1);
      const newTo = changes.mapPos(prevTo, wasValid ? -1 : 1);

      const collapsed = newTo <= newFrom;
      const fullyDeleted =
        wasValid && hadWidth && changes.touchesRange(prevFrom, prevTo) && collapsed;

      if (fullyDeleted) {
        p.from = newFrom;
        p.to = newFrom;
        p.valid = false;
        this.emitInvalid(p.id);
        continue;
      }

      p.from = Math.min(newFrom, newTo);
      p.to = Math.max(newFrom, newTo);

      if (!wasValid && p.to > p.from) {
        p.valid = true;
      }
    }
  }

  /** TP8 / U7: all invalid, none removed. */
  invalidateAll(): void {
    for (const p of this.positions.values()) {
      if (p.valid) {
        p.valid = false;
        this.emitInvalid(p.id);
      }
    }
  }

  /** Living count (including invalid) — for leak tests later. */
  size(): number {
    return this.positions.size;
  }

  private emitInvalid(id: TrackedPositionId): void {
    for (const l of this.listeners) l(id);
  }
}

export function createTrackedPositionRegistry(): TrackedPositionRegistry {
  return new TrackedPositionRegistry();
}
