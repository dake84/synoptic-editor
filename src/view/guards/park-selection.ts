/**
 * Park selection out of locked ranges (SPEC.md L7).
 * One step, no history, no scroll — callers must not add those.
 */

import { Annotation, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import type { Range } from "../../core/types.js";
import { extraLockedRanges, lockedRangesFromState, type LockedRangeOpts } from "./locked-ranges.js";

const parkFollowUp = Annotation.define<boolean>();

function isBlockInsertHole(doc: string, from: number): boolean {
  if (from <= 0) return true;
  return doc[from - 1] === "\n" || doc[from] === "\n";
}

function parkPos(pos: number, ranges: readonly Range[], doc: string): number {
  const docLen = doc.length;
  let p = Math.max(0, Math.min(pos, docLen));
  for (let n = 0; n < ranges.length + 1; n++) {
    const interior = ranges.find((r) => p > r.from && p < r.to);
    if (interior) {
      p = Math.min(interior.to, docLen);
      continue;
    }
    const atFrom = ranges.find((r) => p === r.from && r.to > r.from);
    if (atFrom && isBlockInsertHole(doc, atFrom.from)) {
      p = Math.min(atFrom.to, docLen);
      continue;
    }
    return p;
  }
  return p;
}

/** Move anchor and head to the nearest position outside any lock. */
export function parkSelection(
  sel: EditorSelection,
  ranges: readonly Range[],
  doc: string,
): EditorSelection {
  if (ranges.length === 0) return sel;
  const next = sel.ranges.map((r) => {
    const anchor = parkPos(r.anchor, ranges, doc);
    const head = parkPos(r.head, ranges, doc);
    if (anchor === r.anchor && head === r.head) return r;
    return EditorSelection.range(anchor, head, r.goalColumn);
  });
  return EditorSelection.create(next, sel.mainIndex);
}

export function parkSelectionInState(state: EditorState, opts: LockedRangeOpts = {}): EditorSelection {
  return parkSelection(state.selection, lockedRangesFromState(state, opts), state.doc.toString());
}

/** Last block lock ends at EOF with no following line — caret would sit on the locked line. */
function needsEofParkNewline(doc: string, ranges: readonly Range[], sel: EditorSelection): boolean {
  if (doc.length === 0) return false;
  if (doc[doc.length - 1] === "\n") return false;
  const atEof = sel.ranges.some((r) => r.head === doc.length || r.anchor === doc.length);
  if (!atEof) return false;
  return ranges.some(
    (r) => r.to === doc.length && r.to > r.from && isBlockInsertHole(doc, r.from),
  );
}

function isLineBlockLock(doc: string, range: Range): boolean {
  if (range.to <= range.from) return false;
  return doc.slice(range.from, Math.min(range.to, doc.length)).includes("\n");
}

/** Shared boundary of two abutting line-block locks (`a.to === b.from`). */
function adjacentBlockJoin(doc: string, ranges: readonly Range[]): { join: number; first: Range } | null {
  const blocks = ranges.filter((r) => isLineBlockLock(doc, r));
  for (const a of blocks) {
    for (const b of blocks) {
      if (a.from === b.from && a.to === b.to) continue;
      if (a.to === b.from) return { join: a.to, first: a };
    }
  }
  return null;
}

function caretAtJoin(sel: EditorSelection, parked: EditorSelection, join: number): boolean {
  const atJoin = (r: { head: number; anchor: number }) => r.head === join || r.anchor === join;
  return sel.ranges.some(atJoin) || parked.ranges.some(atJoin);
}

function selInsideLock(sel: EditorSelection, lock: Range): boolean {
  return sel.ranges.some(
    (r) =>
      (r.head > lock.from && r.head < lock.to) || (r.anchor > lock.from && r.anchor < lock.to),
  );
}

function parkFollowUpOf(tr: Transaction, ranges: readonly Range[]) {
  const doc = tr.state.doc.toString();
  const sel = tr.selection ?? tr.startState.selection.map(tr.changes);
  const parked = parkSelection(sel, ranges, doc);
  if (!tr.docChanged) {
    if (needsEofParkNewline(doc, ranges, parked)) {
      return {
        changes: { from: doc.length, insert: "\n" },
        selection: EditorSelection.cursor(doc.length + 1),
      };
    }
    const abut = adjacentBlockJoin(doc, ranges);
    if (
      abut &&
      (caretAtJoin(sel, parked, abut.join) || selInsideLock(sel, abut.first))
    ) {
      return {
        changes: { from: abut.join, insert: "\n" },
        selection: EditorSelection.cursor(abut.join + 1),
      };
    }
  }
  if (parked.eq(sel)) return null;
  return { selection: parked };
}

function parkFilter(rangesOf: (tr: Transaction) => readonly Range[]): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (tr.annotation(parkFollowUp)) return tr;
    const follow = parkFollowUpOf(tr, rangesOf(tr));
    if (!follow) return tr;
    return [
      tr,
      {
        ...follow,
        sequential: true,
        filter: false,
        annotations: [Transaction.addToHistory.of(false), parkFollowUp.of(true)],
      },
    ];
  });
}

/** After doc/selection changes, rewrite a selection that landed in a lock (L7). */
export function selectionParkFilter(opts: LockedRangeOpts = {}): Extension {
  return parkFilter((tr) => lockedRangesFromState(tr.state, opts));
}

/** L7 for host extra locks only (isolated mounts without wysiwygGuards). */
export function extraLockedParkFilter(): Extension {
  return parkFilter((tr) => tr.state.facet(extraLockedRanges));
}
