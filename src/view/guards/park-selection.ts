/**
 * Park selection out of locked ranges (SPEC.md L7).
 * One step, no history, no scroll — callers must not add those.
 */

import {
  Annotation,
  EditorSelection,
  EditorState,
  Facet,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { hiddenFrontmatterRanges } from "../../core/tree.js";
import type { Range, StructureSchema } from "../../core/types.js";
import { extraLockedRanges, lockedRangesFromState, type LockedRangeOpts } from "./locked-ranges.js";
import { namedTransactionFilter } from "./filter-trace.js";

type FrontmatterSchemaArg = StructureSchema | ((state: EditorState) => StructureSchema);

/** Present when isolated hidden-FM guards own L7 for extra locks ∪ FM (not L1 markers). */
const hiddenFrontmatterParkSchema = Facet.define<StructureSchema, StructureSchema | undefined>({
  combine(inputs) {
    return inputs[0];
  },
});

const hiddenFrontmatterOwnsPark = Facet.define<boolean, boolean>({
  combine(inputs) {
    return inputs.some(Boolean);
  },
});

function resolveSchema(schema: FrontmatterSchemaArg, state: EditorState): StructureSchema {
  return typeof schema === "function" ? schema(state) : schema;
}

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

export function parkSelectionInState(
  state: EditorState,
  opts: LockedRangeOpts = {},
): EditorSelection {
  return parkSelection(state.selection, lockedRangesFromState(state, opts), state.doc.toString());
}

/** Last block lock ends at EOF with no following line — caret would sit on the locked line. */
function needsEofParkNewline(doc: string, ranges: readonly Range[], sel: EditorSelection): boolean {
  if (doc.length === 0) return false;
  if (doc[doc.length - 1] === "\n") return false;
  const atEof = sel.ranges.some((r) => r.head === doc.length || r.anchor === doc.length);
  if (!atEof) return false;
  return ranges.some((r) => r.to === doc.length && r.to > r.from && isBlockInsertHole(doc, r.from));
}

function isLineBlockLock(doc: string, range: Range): boolean {
  if (range.to <= range.from) return false;
  return doc.slice(range.from, Math.min(range.to, doc.length)).includes("\n");
}

function lineStartsWithFence(doc: string, pos: number): boolean {
  if (doc.slice(pos, pos + 3) !== "---") return false;
  const after = doc[pos + 3];
  return after === undefined || after === "\n";
}

function lineStartsWithAtx(doc: string, pos: number): boolean {
  return /^#{1,6}(?:[ \t]|$)/.test(doc.slice(pos, Math.min(doc.length, pos + 8)));
}

/** Shared boundary of two abutting line-block locks (`a.to === b.from`). */
function adjacentBlockJoin(
  doc: string,
  ranges: readonly Range[],
): { join: number; first: Range } | null {
  const blocks = ranges.filter((r) => isLineBlockLock(doc, r));
  for (const a of blocks) {
    for (const b of blocks) {
      if (a.from === b.from && a.to === b.to) continue;
      if (a.to !== b.from) continue;
      // Same-node FM.to === heading.from — glue, not an empty-section seam (FM9).
      if (lineStartsWithFence(doc, a.from) && lineStartsWithAtx(doc, b.from)) continue;
      return { join: a.to, first: a };
    }
  }
  return null;
}

function caretAtJoin(sel: EditorSelection, parked: EditorSelection, join: number): boolean {
  const atJoin = (r: { head: number; anchor: number }) => r.head === join || r.anchor === join;
  return sel.ranges.some(atJoin) || parked.ranges.some(atJoin);
}

function selTouchesBlockLock(sel: EditorSelection, lock: Range, doc: string): boolean {
  const atFrom = lock.to > lock.from && isBlockInsertHole(doc, lock.from);
  return sel.ranges.some((r) => {
    const hit = (p: number) => (p > lock.from && p < lock.to) || (atFrom && p === lock.from);
    return hit(r.head) || hit(r.anchor);
  });
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
      (caretAtJoin(sel, parked, abut.join) || selTouchesBlockLock(sel, abut.first, doc))
    ) {
      return {
        changes: { from: abut.join, insert: "\n" },
        selection: EditorSelection.cursor(
          abut.join > 0 && doc[abut.join - 1] === "\n" ? abut.join : abut.join + 1,
        ),
      };
    }
  }
  if (parked.eq(sel)) return null;
  return { selection: parked };
}

function parkFilter(rangesOf: (tr: Transaction) => readonly Range[]): Extension {
  return namedTransactionFilter("selectionParkFilter", (tr) => {
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

/** L7 for host extra locks only (isolated mounts without hidden FM). */
export function extraLockedParkFilter(): Extension {
  return parkFilter((tr) => {
    if (
      tr.startState.facet(hiddenFrontmatterOwnsPark) ||
      tr.state.facet(hiddenFrontmatterOwnsPark)
    ) {
      return [];
    }
    return tr.state.facet(extraLockedRanges);
  });
}

/**
 * Isolated wysiwyg: L7 on extra locks ∪ hidden FM, without L1 heading markers.
 * Owns extra-lock parking while mounted so extraLockedParkFilter does not double up (I6).
 */
export function hiddenFrontmatterParkFilter(schema: FrontmatterSchemaArg): Extension {
  const schemaExt =
    typeof schema === "function"
      ? hiddenFrontmatterParkSchema.compute([], (state) => schema(state))
      : hiddenFrontmatterParkSchema.of(schema);
  return [
    hiddenFrontmatterOwnsPark.of(true),
    schemaExt,
    parkFilter((tr) => {
      const resolved =
        tr.state.facet(hiddenFrontmatterParkSchema) ?? resolveSchema(schema, tr.state);
      const fm = hiddenFrontmatterRanges(tr.state.doc.toString(), resolved);
      return [...tr.state.facet(extraLockedRanges), ...fm];
    }),
  ];
}
