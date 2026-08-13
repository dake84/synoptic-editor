/**
 * Per-view presentation and grain chrome (SPEC.md § 3.3, A7, I9).
 * Decorations never rewrite the document. Hide reads ScopeRange (EX2).
 */

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { headingMarkers, maskBackslashRanges, maskPairs, snapOutOfHeadingMarkers } from "./guards/wysiwyg.js";
import { type ScopeRange } from "./scope.js";
import type { StructureSchema } from "../core/types.js";

export type Presentation = "source" | "wysiwyg";
export type IncludeMode = "own" | "subtree";

const hideRange = Decoration.replace({
  inclusiveStart: false,
  inclusiveEnd: false,
});
const hideMarker = Decoration.replace({});
const hideMask = Decoration.replace({});
const atomMark = Decoration.mark({});
const grainMark = (rank: number) =>
  Decoration.line({ class: `syn-grain syn-rank-${rank}`, attributes: { "data-rank": String(rank) } });

function hideOutside(doc: string, from: number, to: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (from > 0) builder.add(0, from, hideRange);
  if (to < doc.length) builder.add(to, doc.length, hideRange);
  return builder.finish();
}

function hideAll(doc: string): DecorationSet {
  if (doc.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(0, doc.length, hideRange);
  return builder.finish();
}

function buildWysiwygDecorations(doc: string, from: number, to: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (from > 0) builder.add(0, from, hideRange);
  const inlines: { from: number; to: number; deco: Decoration }[] = [];
  for (const r of headingMarkers(doc)) {
    if (r.from < from || r.to > to) continue;
    if (r.to > r.from) inlines.push({ from: r.from, to: r.to, deco: hideMarker });
  }
  for (const r of maskBackslashRanges(doc, from, to)) {
    inlines.push({ from: r.from, to: r.to, deco: hideMask });
  }
  inlines.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const r of inlines) builder.add(r.from, r.to, r.deco);
  if (to < doc.length) builder.add(to, doc.length, hideRange);
  return builder.finish();
}

function buildWysiwygAtoms(doc: string, r: ScopeRange): DecorationSet {
  if (r.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = [
    ...headingMarkers(doc).filter((mk) => mk.from >= r.from && mk.to <= r.to && mk.to > mk.from),
    ...maskPairs(doc, r.from, r.to),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const p of ranges) builder.add(p.from, p.to, atomMark);
  return builder.finish();
}

function headingLineStarts(doc: string, schema: StructureSchema): { pos: number; rank: number }[] {
  const depthToRank = new Map(schema.levels.map((l) => [l.headingDepth, l.rank]));
  const out: { pos: number; rank: number }[] = [];
  const re = /^(#{1,6})[ \t]+.+$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const rank = depthToRank.get(m[1]!.length);
    if (rank !== undefined) out.push({ pos: m.index, rank });
  }
  return out;
}

export function hideOutsideField(rangeField: StateField<ScopeRange>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      const doc = state.doc.toString();
      const r = state.field(rangeField);
      return r.lost ? hideAll(doc) : hideOutside(doc, r.from, r.to);
    },
    update(_value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return _value;
      const doc = tr.state.doc.toString();
      return r.lost ? hideAll(doc) : hideOutside(doc, r.from, r.to);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function wysiwygDecorationField(rangeField: StateField<ScopeRange>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      const doc = state.doc.toString();
      const r = state.field(rangeField);
      return r.lost ? hideAll(doc) : buildWysiwygDecorations(doc, r.from, r.to);
    },
    update(_value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return _value;
      const doc = tr.state.doc.toString();
      return r.lost ? hideAll(doc) : buildWysiwygDecorations(doc, r.from, r.to);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function wysiwygAtomField(rangeField: StateField<ScopeRange>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildWysiwygAtoms(state.doc.toString(), state.field(rangeField));
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildWysiwygAtoms(tr.state.doc.toString(), r);
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

export function grainField(
  rangeField: StateField<ScopeRange>,
  schema: StructureSchema,
  grain: number,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildGrain(state.doc.toString(), state.field(rangeField), schema, grain);
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildGrain(tr.state.doc.toString(), r, schema, grain);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildGrain(doc: string, r: ScopeRange, schema: StructureSchema, grain: number): DecorationSet {
  if (r.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const h of headingLineStarts(doc, schema)) {
    if (h.pos < r.from || h.pos >= r.to) continue;
    if (h.rank <= grain) builder.add(h.pos, h.pos, grainMark(h.rank));
  }
  return builder.finish();
}

export { snapOutOfHeadingMarkers };
