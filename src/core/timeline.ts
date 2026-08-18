/**
 * Single timeline per session (SPEC.md I3, U1–U4, U9–U17).
 * View reveal (U5) is out of scope for the headless core — callers handle document apply.
 */

import type { ChangeSet } from "@codemirror/state";
import type { Range } from "./types.js";

export interface ForeignTimelineCommand {
  apply: () => void;
  revert: () => void;
  reveal?: () => void;
  label?: string;
}

export type TimelineEntry =
  | {
      kind: "text";
      /** Forward change (already applied when pushed). */
      forward: ChangeSet;
      /** Inverse against the document *before* forward. */
      inverse: ChangeSet;
      targetRange?: Range;
      targetNodeId?: string;
      label?: string;
    }
  | {
      kind: "foreign";
      command: ForeignTimelineCommand;
    };

export type UndoResult =
  | { kind: "text"; changes: ChangeSet }
  | { kind: "foreign"; run: "revert" | "apply" };

/**
 * One entry point for undo/redo (U1). Text and foreign entries share the same stack (U3, U13).
 * Foreign entries are opaque (U9–U10).
 */
export class Timeline {
  private entries: TimelineEntry[] = [];
  /** Index of the next push slot; undo decrements, redo increments. */
  private next = 0;

  get length(): number {
    return this.next;
  }

  get depth(): number {
    return this.next;
  }

  get redoDepth(): number {
    return this.entries.length - this.next;
  }

  /** Count of text entries in the done portion (U15/U17). */
  get textDepth(): number {
    let n = 0;
    for (let i = 0; i < this.next; i++) {
      if (this.entries[i]!.kind === "text") n += 1;
    }
    return n;
  }

  peek(): TimelineEntry | undefined {
    return this.next > 0 ? this.entries[this.next - 1] : undefined;
  }

  push(entry: TimelineEntry): void {
    this.entries = this.entries.slice(0, this.next);
    this.entries.push(entry);
    this.next = this.entries.length;
  }

  pushText(
    forward: ChangeSet,
    inverse: ChangeSet,
    meta?: { targetRange?: Range; targetNodeId?: string; label?: string },
  ): void {
    this.push({
      kind: "text",
      forward,
      inverse,
      targetRange: meta?.targetRange,
      targetNodeId: meta?.targetNodeId,
      label: meta?.label,
    });
  }

  pushForeign(command: ForeignTimelineCommand): void {
    this.push({ kind: "foreign", command });
  }

  /**
   * Fold a CM6-merged change into the last done text entry (U17).
   * Inverse is against the document *after* this step, composed onto the group's inverse.
   */
  composeLastText(forward: ChangeSet, inverse: ChangeSet): void {
    const last = this.peek();
    if (!last || last.kind !== "text") {
      throw new Error("composeLastText requires a text tip");
    }
    this.entries = this.entries.slice(0, this.next);
    last.forward = last.forward.compose(forward);
    last.inverse = inverse.compose(last.inverse);
  }

  /** Undo last entry. Caller applies returned text ChangeSet to the document. */
  undo(): UndoResult | null {
    if (this.next === 0) return null;
    this.next -= 1;
    const entry = this.entries[this.next]!;
    if (entry.kind === "text") {
      return { kind: "text", changes: entry.inverse };
    }
    entry.command.revert();
    return { kind: "foreign", run: "revert" };
  }

  /** Redo. Caller applies returned text ChangeSet. */
  redo(): UndoResult | null {
    if (this.next >= this.entries.length) return null;
    const entry = this.entries[this.next]!;
    this.next += 1;
    if (entry.kind === "text") {
      return { kind: "text", changes: entry.forward };
    }
    entry.command.apply();
    return { kind: "foreign", run: "apply" };
  }

  /** U7: replaceDocument clears history. */
  clear(): void {
    this.entries = [];
    this.next = 0;
  }
}

/** Create a timeline; inject a shared instance for multi-session hosts (U12). */
export function createTimeline(existing?: Timeline): Timeline {
  return existing ?? new Timeline();
}
