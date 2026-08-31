/**
 * Per-view presentation chrome (SPEC.md § 3.3, I9, § 8.6).
 * Decorations never rewrite the document. Hide reads ScopeRange (EX2).
 * Inline chrome: string pair-scan, rebuild on doc/scope only — never on scroll.
 */

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findHtmlComments, overlapsAny } from "../core/html-comments.js";
import { coveredByFence, fencedCodeRanges } from "../core/fences.js";
import {
  findInlineMarks,
  inlineDelimiterRanges,
  type InlineMarkKind,
  type InlineMarkSpan,
} from "../core/inline-markers.js";
import { projectTree } from "../core/tree.js";
import type { StructureSchema } from "../core/types.js";
import {
  headingMarkers,
  maskBackslashRanges,
  maskPairs,
  snapOutOfHeadingMarkers,
} from "./guards/wysiwyg.js";
import { coveredByHostBlockReplace, hostBlockReplaceRanges } from "./host-block-replace.js";
import { type ScopeRange } from "./scope.js";

/** View presentation: raw markdown vs rendered chrome. */
export type Presentation = "source" | "wysiwyg";
/** How much of the scoped node a view shows. */
export type IncludeMode = "own" | "subtree";

const hideRange = Decoration.replace({
  inclusiveStart: false,
  inclusiveEnd: false,
});
const hideMarker = Decoration.replace({});
const hideMask = Decoration.replace({});
const atomMark = Decoration.mark({});

function relClassName(rel: number): string {
  return rel < 0 ? `syn-rel--${-rel}` : `syn-rel-${rel}`;
}

function headingLineDeco(depth: number, rank: number, rel: number): Decoration {
  return Decoration.line({
    class: `syn-depth-${depth} syn-rank-${rank} ${relClassName(rel)}`,
    attributes: {
      "data-heading-depth": String(depth),
      "data-rank": String(rank),
      "data-rel": String(rel),
    },
  });
}

function sectionOpenDeco(depth: number, rank: number, rel: number): Decoration {
  return Decoration.line({
    class: "syn-section-open",
    attributes: {
      "data-heading-depth": String(depth),
      "data-rank": String(rank),
      "data-rel": String(rel),
    },
  });
}

const INLINE_MARK: Record<InlineMarkKind, Decoration> = {
  em: Decoration.mark({ class: "syn-em" }),
  strong: Decoration.mark({ class: "syn-strong" }),
  strike: Decoration.mark({ class: "syn-strike" }),
  code: Decoration.mark({ class: "syn-code" }),
};

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

function lineSlices(doc: string, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let pos = from;
  while (pos < to) {
    const nl = doc.indexOf("\n", pos);
    const end = nl < 0 || nl + 1 > to ? to : nl + 1;
    if (end > pos) out.push({ from: pos, to: end });
    pos = end;
  }
  return out;
}

function scopedInlineMarks(doc: string, from: number, to: number): InlineMarkSpan[] {
  const comments = findHtmlComments(doc, from, to);
  return findInlineMarks(doc, from, to).filter(
    (s) => !overlapsAny({ from: s.openFrom, to: s.closeTo }, comments),
  );
}

function buildWysiwygDecorations(
  doc: string,
  from: number,
  to: number,
  hideHeading?: { from: number; to: number } | null,
  hostOwned: readonly { from: number; to: number }[] = [],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (from > 0) builder.add(0, from, hideRange);
  const comments = findHtmlComments(doc, from, to);
  const inlines: { from: number; to: number; deco: Decoration }[] = [];
  const hideFrom = hideHeading && hideHeading.to > hideHeading.from ? hideHeading.from : -1;
  const hideTo = hideHeading && hideHeading.to > hideHeading.from ? hideHeading.to : -1;
  if (hideFrom >= 0 && hideTo > hideFrom && hideFrom < to && hideTo > from) {
    const hf = Math.max(hideFrom, from);
    const ht = Math.min(hideTo, to);
    if (ht > hf && !coveredByHostBlockReplace({ from: hf, to: ht }, hostOwned)) {
      inlines.push({ from: hf, to: ht, deco: hideMarker });
    }
  }
  for (const r of headingMarkers(doc)) {
    if (r.from < from || r.to > to) continue;
    if (hideFrom >= 0 && r.from >= hideFrom && r.to <= hideTo) continue;
    if (coveredByHostBlockReplace(r, hostOwned)) continue;
    if (overlapsAny(r, comments)) continue;
    if (r.to > r.from) inlines.push({ from: r.from, to: r.to, deco: hideMarker });
  }
  for (const r of maskBackslashRanges(doc, from, to)) {
    if (hideFrom >= 0 && r.from >= hideFrom && r.to <= hideTo) continue;
    if (overlapsAny(r, comments)) continue;
    inlines.push({ from: r.from, to: r.to, deco: hideMask });
  }
  for (const c of comments) {
    for (const slice of lineSlices(doc, c.from, c.to)) {
      if (slice.to > slice.from) inlines.push({ from: slice.from, to: slice.to, deco: hideMarker });
    }
  }
  for (const span of scopedInlineMarks(doc, from, to)) {
    if (hideFrom >= 0 && span.openFrom >= hideFrom && span.closeTo <= hideTo) continue;
    if (span.openTo > span.openFrom)
      inlines.push({ from: span.openFrom, to: span.openTo, deco: hideMarker });
    if (span.closeTo > span.closeFrom)
      inlines.push({ from: span.closeFrom, to: span.closeTo, deco: hideMarker });
    if (span.openTo < span.closeFrom) {
      inlines.push({ from: span.openTo, to: span.closeFrom, deco: INLINE_MARK[span.kind] });
    }
  }
  inlines.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const r of inlines) builder.add(r.from, r.to, r.deco);
  if (to < doc.length) builder.add(to, doc.length, hideRange);
  return builder.finish();
}

export type ScopeHeadingHideOpts = {
  showNodeHeading: boolean;
  scopeNodeId: string;
  schema: StructureSchema;
};

/** Heading line plus trailing newline — no leftover empty cm-line (SNH2). */
export function scopeHeadingHideRange(
  doc: string,
  heading: { from: number; to: number } | null | undefined,
): { from: number; to: number } | null {
  if (!heading || heading.to <= heading.from) return null;
  let to = heading.to;
  if (to < doc.length && (doc[to] === "\n" || doc[to] === "\r")) {
    to += 1;
    if (doc[to - 1] === "\r" && to < doc.length && doc[to] === "\n") to += 1;
  }
  return { from: heading.from, to };
}

function resolveScopeHeadingHide(
  doc: string,
  opts: ScopeHeadingHideOpts | null | undefined,
): { from: number; to: number } | null {
  if (!opts || opts.showNodeHeading || !opts.scopeNodeId) return null;
  const node = projectTree(doc, opts.schema).nodes.get(opts.scopeNodeId);
  return scopeHeadingHideRange(doc, node?.heading);
}

function buildWysiwygAtoms(
  doc: string,
  r: ScopeRange,
  hideHeading?: { from: number; to: number } | null,
): DecorationSet {
  if (r.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const comments = findHtmlComments(doc, r.from, r.to);
  const inlineAtoms = inlineDelimiterRanges(scopedInlineMarks(doc, r.from, r.to));
  const hideFrom = hideHeading && hideHeading.to > hideHeading.from ? hideHeading.from : -1;
  const hideTo = hideHeading && hideHeading.to > hideHeading.from ? hideHeading.to : -1;
  const ranges = [
    ...(hideFrom >= 0 && hideTo > hideFrom ? [{ from: hideFrom, to: hideTo }] : []),
    ...headingMarkers(doc).filter(
      (mk) =>
        mk.from >= r.from &&
        mk.to <= r.to &&
        mk.to > mk.from &&
        !overlapsAny(mk, comments) &&
        !(hideFrom >= 0 && mk.from >= hideFrom && mk.to <= hideTo),
    ),
    ...maskPairs(doc, r.from, r.to).filter(
      (p) => !overlapsAny(p, comments) && !(hideFrom >= 0 && p.from >= hideFrom && p.to <= hideTo),
    ),
    ...comments.filter((c) => c.to > c.from),
    ...inlineAtoms.filter(
      (p) =>
        p.to > p.from &&
        !overlapsAny(p, comments) &&
        !(hideFrom >= 0 && p.from >= hideFrom && p.to <= hideTo),
    ),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const p of ranges) builder.add(p.from, p.to, atomMark);
  return builder.finish();
}

function headingLineStarts(
  doc: string,
  schema: StructureSchema,
): { pos: number; rank: number; headingDepth: number }[] {
  const depthToRank = new Map(schema.levels.map((l) => [l.headingDepth, l.rank]));
  const fences = fencedCodeRanges(doc);
  const out: { pos: number; rank: number; headingDepth: number }[] = [];
  const re = /^(#{1,6})[ \t]+.+$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    if (coveredByFence(m.index, fences)) continue;
    const headingDepth = m[1]!.length;
    const rank = depthToRank.get(headingDepth);
    if (rank !== undefined) out.push({ pos: m.index, rank, headingDepth });
  }
  return out;
}

function nextLineFrom(doc: string, pos: number): number | null {
  const nl = doc.indexOf("\n", pos);
  if (nl < 0 || nl + 1 >= doc.length) return null;
  return nl + 1;
}

function lineEnd(doc: string, from: number): number {
  const nl = doc.indexOf("\n", from);
  return nl < 0 ? doc.length : nl;
}

function firstProseAfterHeading(
  doc: string,
  headingPos: number,
  rangeTo: number,
  schemaHeadings: ReadonlySet<number>,
  fm: readonly { from: number; to: number }[],
): number | null {
  let pos = nextLineFrom(doc, headingPos);
  while (pos !== null && pos < rangeTo) {
    const inFm = fm.some((b) => pos! >= b.from && pos! < b.to);
    if (inFm) {
      pos = nextLineFrom(doc, pos);
      continue;
    }
    if (schemaHeadings.has(pos)) return null;
    const end = lineEnd(doc, pos);
    if (doc.slice(pos, end).trim() !== "") return pos;
    pos = nextLineFrom(doc, pos);
  }
  return null;
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
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost)
        return _value;
      const doc = tr.state.doc.toString();
      return r.lost ? hideAll(doc) : hideOutside(doc, r.from, r.to);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function wysiwygDecorationField(
  rangeField: StateField<ScopeRange>,
  hideOpts?: ScopeHeadingHideOpts | null,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      const doc = state.doc.toString();
      const r = state.field(rangeField);
      return r.lost
        ? hideAll(doc)
        : buildWysiwygDecorations(
            doc,
            r.from,
            r.to,
            resolveScopeHeadingHide(doc, hideOpts),
            state.facet(hostBlockReplaceRanges),
          );
    },
    update(_value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      const hostChanged =
        tr.state.facet(hostBlockReplaceRanges) !== tr.startState.facet(hostBlockReplaceRanges);
      if (
        !tr.docChanged &&
        r.from === prev.from &&
        r.to === prev.to &&
        r.lost === prev.lost &&
        !hostChanged
      ) {
        return _value;
      }
      const doc = tr.state.doc.toString();
      return r.lost
        ? hideAll(doc)
        : buildWysiwygDecorations(
            doc,
            r.from,
            r.to,
            resolveScopeHeadingHide(doc, hideOpts),
            tr.state.facet(hostBlockReplaceRanges),
          );
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function wysiwygAtomField(
  rangeField: StateField<ScopeRange>,
  hideOpts?: ScopeHeadingHideOpts | null,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      const doc = state.doc.toString();
      return buildWysiwygAtoms(
        doc,
        state.field(rangeField),
        resolveScopeHeadingHide(doc, hideOpts),
      );
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost)
        return value;
      const doc = tr.state.doc.toString();
      return buildWysiwygAtoms(doc, r, resolveScopeHeadingHide(doc, hideOpts));
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

export function headingStampField(
  rangeField: StateField<ScopeRange>,
  schema: StructureSchema,
  scopeRank: number,
  hideOpts?: ScopeHeadingHideOpts | null,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildHeadingStamps(
        state.doc.toString(),
        state.field(rangeField),
        schema,
        scopeRank,
        resolveScopeHeadingHide(state.doc.toString(), hideOpts),
      );
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost)
        return value;
      const doc = tr.state.doc.toString();
      return buildHeadingStamps(doc, r, schema, scopeRank, resolveScopeHeadingHide(doc, hideOpts));
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildHeadingStamps(
  doc: string,
  r: ScopeRange,
  schema: StructureSchema,
  scopeRank: number,
  hideHeading: { from: number; to: number } | null,
): DecorationSet {
  if (r.lost) return Decoration.none;
  const headings = headingLineStarts(doc, schema).filter((h) => h.pos >= r.from && h.pos < r.to);
  const schemaPos = new Set(headings.map((h) => h.pos));
  const fm = [...projectTree(doc, schema).nodes.values()]
    .map((n) => n.frontmatter)
    .filter((b): b is { from: number; to: number } => b != null && b.to > b.from);
  const hideFrom = hideHeading && hideHeading.to > hideHeading.from ? hideHeading.from : -1;
  const hideTo = hideHeading && hideHeading.to > hideHeading.from ? hideHeading.to : -1;
  const marks: { from: number; deco: Decoration }[] = [];
  const openUsed = new Set<number>();
  for (const h of headings) {
    const rel = h.rank - scopeRank;
    const hidden = hideFrom >= 0 && h.pos >= hideFrom && h.pos < hideTo;
    if (!hidden) marks.push({ from: h.pos, deco: headingLineDeco(h.headingDepth, h.rank, rel) });
    const open = firstProseAfterHeading(doc, h.pos, r.to, schemaPos, fm);
    if (open != null && !openUsed.has(open)) {
      openUsed.add(open);
      marks.push({ from: open, deco: sectionOpenDeco(h.headingDepth, h.rank, rel) });
    }
  }
  marks.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of marks) builder.add(m.from, m.from, m.deco);
  return builder.finish();
}

export { snapOutOfHeadingMarkers };
