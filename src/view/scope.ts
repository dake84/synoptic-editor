/**
 * Sticky excerpt (SPEC.md § 3.6, EX1–EX5, I6).
 * Hide, fence, copy, and select-all read this one field.
 */

import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syncAnnotation } from "../sync/engine.js";
import type { Range } from "../core/types.js";
import { namedChangeFilter, namedTransactionFilter } from "./guards/filter-trace.js";

export interface ScopeRange {
  from: number;
  to: number;
  lost: boolean;
}

export const setScopeRange = StateEffect.define<ScopeRange>();

export const scopeRangeFacet = Facet.define<ScopeRange, ScopeRange>({
  combine: (values) => values[0] ?? { from: 0, to: 0, lost: true },
});

export function viewRange(state: EditorState): ScopeRange {
  return state.facet(scopeRangeFacet);
}

/**
 * `from` assoc −1: inserts at `from` stay inside.
 * `to` assoc −1 when the excerpt has width (inserts at exclusive `to` stay outside).
 * `to` assoc +1 when empty (EX3: insert at the point expands the excerpt).
 */
export function mapScopeRange(range: ScopeRange, changes: ChangeSet, docLen: number): ScopeRange {
  const from = Math.max(0, Math.min(changes.mapPos(range.from, -1), docLen));
  const toAssoc = range.to > range.from ? -1 : 1;
  const to = Math.max(from, Math.min(changes.mapPos(range.to, toAssoc), docLen));
  return { from, to, lost: range.lost };
}

export function createScopeRangeField(initial: ScopeRange): StateField<ScopeRange> {
  return StateField.define<ScopeRange>({
    create() {
      return initial;
    },
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setScopeRange)) return e.value;
      }
      if (!tr.docChanged) return value;
      const mapped = mapScopeRange(value, tr.changes, tr.newDoc.length);
      if (value.lost) return { ...mapped, lost: true };
      const foreignEmpty =
        !!tr.annotation(syncAnnotation) && value.to > value.from && mapped.to <= mapped.from;
      return { ...mapped, lost: foreignEmpty };
    },
    provide: (field) => scopeRangeFacet.from(field),
  });
}

export function nextHeadingStaysAtBol(tr: Transaction, to: number): boolean {
  if (to >= tr.startState.doc.length) return true;
  if (tr.startState.doc.sliceString(to, to + 1) !== "#") return true;
  const mapped = tr.changes.mapPos(to, 1);
  if (mapped < 0 || mapped > tr.newDoc.length) return true;
  const stillHash = mapped < tr.newDoc.length && tr.newDoc.sliceString(mapped, mapped + 1) === "#";
  if (!stillHash) return false;
  return mapped === 0 || tr.newDoc.sliceString(mapped - 1, mapped) === "\n";
}

export function clipSelection(
  sel: EditorSelection,
  from: number,
  to: number,
  docLen: number,
  firstCaret = from,
): EditorSelection {
  const min = Math.min(Math.max(firstCaret, 0), docLen);
  const maxRange = Math.min(Math.max(to, min), docLen);
  const maxEmpty = maxRange < docLen && maxRange > min ? maxRange - 1 : maxRange;
  const ranges = sel.ranges.map((r) => {
    if (r.empty) {
      const p = Math.min(Math.max(r.head, min), maxEmpty);
      return EditorSelection.cursor(p, 1);
    }
    const a = Math.min(Math.max(r.anchor, min), maxRange);
    const h = Math.min(Math.max(r.head, min), maxRange);
    return EditorSelection.range(a, h);
  });
  return EditorSelection.create(ranges, sel.mainIndex);
}

function suppressOutside(range: ScopeRange, docLen: number): number[] | true {
  const suppress: number[] = [];
  if (range.from > 0) suppress.push(0, range.from);
  if (range.to < docLen) {
    const start = range.from < range.to ? range.to : range.to + 1;
    if (start < docLen) suppress.push(start, docLen);
  }
  return suppress.length > 0 ? suppress : true;
}

function editsNeighbour(tr: Transaction, to: number): boolean {
  let bad = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (toA > to && fromA >= to) bad = true;
    if (fromA < to && toA > to) bad = true;
  });
  return bad;
}

/**
 * Isolation (not hide). Sync-annotated transactions skip so the star can forward.
 */
export function scopeFence(rangeField: StateField<ScopeRange>): Extension {
  return [
    namedChangeFilter("scopeFence.change", (tr) => {
      if (!tr.docChanged || tr.annotation(syncAnnotation)) return true;
      const range = tr.startState.field(rangeField);
      if (range.lost) return [0, tr.startState.doc.length];
      return suppressOutside(range, tr.startState.doc.length);
    }),
    namedTransactionFilter("scopeFence", (tr) => {
      if (tr.annotation(syncAnnotation)) return tr;
      const range = tr.startState.field(rangeField);
      if (range.lost) return tr.docChanged ? { changes: [], filter: false } : tr;
      if (tr.docChanged && editsNeighbour(tr, range.to)) {
        return { changes: [], filter: false };
      }
      if (tr.docChanged && !nextHeadingStaysAtBol(tr, range.to)) {
        return { changes: [], filter: false };
      }
      if (!tr.selection) return tr;
      const mapped = tr.docChanged ? mapScopeRange(range, tr.changes, tr.newDoc.length) : range;
      const docLen = tr.docChanged ? tr.newDoc.length : tr.startState.doc.length;
      const clipped = clipSelection(tr.selection, mapped.from, mapped.to, docLen, mapped.from);
      if (clipped.eq(tr.selection)) return tr;
      if (!tr.docChanged) return { selection: clipped };
      return { changes: tr.changes, selection: clipped };
    }),
    Prec.highest(
      keymap.of([
        {
          key: "Mod-a",
          run(view) {
            const range = view.state.field(rangeField);
            if (range.lost) return true;
            view.dispatch({
              selection: EditorSelection.single(range.from, range.to),
            });
            return true;
          },
        },
      ]),
    ),
  ];
}

export function scopeCopyHandler(rangeField: StateField<ScopeRange>): Extension {
  return EditorView.domEventHandlers({
    copy(event, view) {
      const range = view.state.field(rangeField);
      if (range.lost || !event.clipboardData) return false;
      const sel = view.state.selection.main;
      const text = clippedCopy(view.state.doc.toString(), sel.from, sel.to, range);
      if (!text) return false;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      return true;
    },
  });
}

export function clippedCopy(
  doc: string,
  selFrom: number,
  selTo: number,
  range: ScopeRange,
): string {
  if (range.lost) return "";
  const from = Math.max(selFrom, range.from);
  const to = Math.min(selTo, range.to);
  return to > from ? doc.slice(from, to) : "";
}

export function rangeRelation(a: Range, b: Range): "identical" | "containing" | "disjoint" {
  if (a.from === b.from && a.to === b.to) return "identical";
  if (a.from <= b.from && a.to >= b.to && (a.from < b.from || a.to > b.to)) return "containing";
  if (b.from <= a.from && b.to >= a.to && (b.from < a.from || b.to > a.to)) return "containing";
  return "disjoint";
}
