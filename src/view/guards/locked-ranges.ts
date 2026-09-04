/**
 * Locked ranges for wysiwyg (SPEC.md L1/L5/L6/L7). One set: scanners plus host extras.
 */

import {
  Annotation,
  Facet,
  RangeSetBuilder,
  StateField,
  type EditorState as EditorStateType,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findChips, type InlineRefStyle } from "../../core/chips.js";
import { findHtmlComments } from "../../core/html-comments.js";
import { findInlineMarks, inlineDelimiterRanges } from "../../core/inline-markers.js";
import { hiddenFrontmatterRanges, headingUnitRanges } from "../../core/tree.js";
import type { Range, StructureSchema } from "../../core/types.js";
import { syncAnnotation } from "../../sync/engine.js";
import { headingMarkers, maskPairs } from "./markers.js";
import { namedChangeFilter } from "./filter-trace.js";

/** Host-contributed locks (replaced or hidden lines). Combined with scanner locks (L6). */
export const extraLockedRanges = Facet.define<readonly Range[], readonly Range[]>({
  combine(inputs) {
    return inputs.flat();
  },
});

/**
 * Host ranges the caret must skip (atomic). Independent of {@link extraLockedRanges}:
 * a replaced heading line may be locked for edits without being atomic.
 */
export const extraAtomicRanges = Facet.define<readonly Range[], readonly Range[]>({
  combine(inputs) {
    return inputs.flat();
  },
});

/** L5 — host programmatic writes (heading-edit, structure commit) bypass extra locks. */
export const hostWriteAnnotation = Annotation.define<boolean>();

export type LockedRangeOpts = {
  inlineRefStyle?: InlineRefStyle;
  schema?: StructureSchema;
  /** When true, schema headings + YAML fences join into LH1 units. */
  headingEditingLocked?: boolean;
};

function chipLocks(doc: string, style: InlineRefStyle): Range[] {
  const out: Range[] = [];
  for (const chip of findChips(doc, 0, doc.length, style)) {
    if (!chip.textNode) {
      if (chip.to > chip.from) out.push({ from: chip.from, to: chip.to });
      continue;
    }
    if (chip.labelFrom > chip.from) out.push({ from: chip.from, to: chip.labelFrom });
    if (chip.to > chip.labelTo) out.push({ from: chip.labelTo, to: chip.to });
  }
  return out;
}

function frontmatterLocks(doc: string, schema: StructureSchema | undefined): Range[] {
  if (!schema) return [];
  return hiddenFrontmatterRanges(doc, schema);
}

function coveredByUnit(range: Range, units: readonly Range[]): boolean {
  return units.some((unit) => range.from >= unit.from && range.to <= unit.to);
}

/** Scanner-owned wysiwyg locks (not host widgets). */
export function synopticLockedRanges(doc: string, opts: LockedRangeOpts = {}): Range[] {
  const style = opts.inlineRefStyle ?? "attribute-block";
  const units = opts.headingEditingLocked && opts.schema ? headingUnitRanges(doc, opts.schema) : [];
  return [
    ...units,
    ...headingMarkers(doc).filter((r) => !coveredByUnit(r, units)),
    ...maskPairs(doc, 0, doc.length),
    ...findHtmlComments(doc),
    ...inlineDelimiterRanges(findInlineMarks(doc)),
    ...chipLocks(doc, style),
    ...frontmatterLocks(doc, opts.schema).filter((r) => !coveredByUnit(r, units)),
  ].filter((r) => r.to > r.from);
}

export function lockedRangesFromState(state: EditorStateType, opts: LockedRangeOpts = {}): Range[] {
  return [...synopticLockedRanges(state.doc.toString(), opts), ...state.facet(extraLockedRanges)];
}

function extraLockIntersects(fromA: number, toA: number, span: Range): boolean {
  if (fromA === toA) return fromA >= span.from && fromA < span.to;
  if (fromA < span.to && toA > span.from) return true;
  // Backspace at `from` would join the locked line with the preceding prose.
  if (toA === span.from && fromA < span.from && fromA >= span.from - 1) return true;
  return false;
}

/** Block raw edits that touch {@link extraLockedRanges}. L5 writes use {@link hostWriteAnnotation}. */
export function extraLockedEditFilter(): Extension {
  return namedChangeFilter("extraLockedEditFilter", (tr) => {
    if (!tr.docChanged) return true;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;
    if (tr.annotation(syncAnnotation)) return true;
    if (tr.annotation(hostWriteAnnotation)) return true;
    const spans = tr.startState.facet(extraLockedRanges);
    if (spans.length === 0) return true;
    let blocked = false;
    tr.changes.iterChanges((fromA, toA) => {
      if (blocked) return;
      for (const span of spans) {
        if (extraLockIntersects(fromA, toA, span)) {
          blocked = true;
          return;
        }
      }
    });
    return !blocked;
  });
}

const extraAtomMark = Decoration.mark({});

function extraAtomicEqual(a: readonly Range[], b: readonly Range[]): boolean {
  return a.length === b.length && a.every((r, i) => r.from === b[i]!.from && r.to === b[i]!.to);
}

function buildExtraAtomic(state: EditorStateType): DecorationSet {
  const ranges = [...state.facet(extraAtomicRanges)]
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (ranges.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.to, extraAtomMark);
  return builder.finish();
}

const extraAtomicField = StateField.define<DecorationSet>({
  create: buildExtraAtomic,
  update(value, tr) {
    if (
      !tr.docChanged &&
      extraAtomicEqual(tr.startState.facet(extraAtomicRanges), tr.state.facet(extraAtomicRanges))
    ) {
      return value;
    }
    return buildExtraAtomic(tr.state);
  },
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
});

/** Atomic caret skip for {@link extraAtomicRanges} plus edit lock for {@link extraLockedRanges}. */
export function extraLockedGuards(): Extension {
  return [extraAtomicField, extraLockedEditFilter()];
}
