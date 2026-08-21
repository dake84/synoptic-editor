/**
 * Search projection (SPEC.md § 10). One place (I6): source vs wysiwyg, prose vs metadata.
 */

import { findChips, type InlineRefStyle } from "./chips.js";
import { fieldByKey, parseFrontmatterBlock } from "./frontmatter.js";
import { findHtmlComments } from "./html-comments.js";
import { findInlineMarks, inlineDelimiterRanges } from "./inline-markers.js";
import { projectTree } from "./tree.js";
import type { Range, StructureSchema, Tree } from "./types.js";

export type SearchHitClass = "prose" | "metadata";

export interface SearchHit {
  id: string;
  from: number;
  to: number;
  class: SearchHitClass;
}

export type SearchPresentation = "source" | "wysiwyg";

/** How the query matches inside a projected segment (F12/F13). */
export type FindMatchOptions = {
  /** Default `false`: "ARIA" matches "aria". */
  caseSensitive?: boolean;
  /** Default `false`: query is literal. `true`: JS regex; invalid pattern → no hits. */
  regex?: boolean;
};

export interface SearchOptions extends FindMatchOptions {
  query: string;
  /** Document range to search (view mode clips to ScopeRange). */
  range: Range;
  presentation: SearchPresentation;
  schema: StructureSchema;
  /** YAML keys rendered as pills — only these are searchable as metadata in wysiwyg (P5). */
  pillFields: readonly string[];
  /** Chip syntax for this session (W6). Default `attribute-block`. */
  inlineRefStyle?: InlineRefStyle;
  tree?: Tree;
  /** Scope node whose heading is hidden in wysiwyg (SNH4) — exclude its title from prose hits. */
  hideHeadingNodeId?: string;
}

interface Segment {
  from: number;
  to: number;
  class: SearchHitClass;
  /** W7 synthetic label — not a document slice (F6). */
  display?: string;
}

function headingMarkerEnd(doc: string, headingFrom: number): number {
  const lineEnd = doc.indexOf("\n", headingFrom);
  const line = doc.slice(headingFrom, lineEnd < 0 ? doc.length : lineEnd);
  const m = /^(#{1,6}[ \t])/.exec(line);
  return m ? headingFrom + m[1]!.length : headingFrom;
}

const MASK_META = new Set(["#", "*", "_", ">", "`", "<", "\\", "-"]);

/** Hide the backslash of a mask pair (L2) — the escaped char stays searchable. */
function maskBackslashHoles(doc: string, from: number, to: number): Range[] {
  const out: Range[] = [];
  for (let i = from; i < to; i++) {
    if (doc[i] !== "\\") continue;
    const next = doc[i + 1];
    if (next !== undefined && MASK_META.has(next) && i + 2 <= to) {
      out.push({ from: i, to: i + 1 });
      i++;
    }
  }
  return out;
}

/**
 * Build searchable document segments for the given presentation (F4–F9).
 */
export function searchSegments(doc: string, opts: SearchOptions): Segment[] {
  const { from, to } = opts.range;
  if (opts.query === "" || from >= to) return [];

  if (opts.presentation === "source") {
    return [{ from, to, class: "prose" }];
  }

  const tree = opts.tree ?? projectTree(doc, opts.schema);
  // wysiwyg: reader-visible projection
  const segments: Segment[] = [];
  const nodes = [...tree.nodes.values()].sort((a, b) => a.ownRange.from - b.ownRange.from);

  for (const node of nodes) {
    const ownFrom = Math.max(node.ownRange.from, from);
    const ownTo = Math.min(node.ownRange.to, to);
    if (ownFrom >= ownTo) continue;

    // Pill values (metadata) — YAML offsets, not form (FM7/P5)
    if (node.frontmatter && opts.pillFields.length) {
      const block = parseFrontmatterBlock(doc, node.frontmatter);
      for (const key of opts.pillFields) {
        const field = fieldByKey(block, key);
        if (!field) continue;
        const vf = Math.max(field.valueRange.from, from);
        const vt = Math.min(field.valueRange.to, to);
        if (vf < vt) segments.push({ from: vf, to: vt, class: "metadata" });
      }
    }

    // Heading title (no markers) + body until ownRange end, skipping FM, comments, chip chrome
    const titleFrom = Math.max(headingMarkerEnd(doc, node.heading.from), from);
    const titleTo = Math.min(node.heading.to, to);
    let bodyFrom = Math.max(node.heading.to, from);
    while (bodyFrom < ownTo && (doc[bodyFrom] === "\n" || doc[bodyFrom] === "\r")) bodyFrom += 1;
    // Skip past frontmatter if somehow overlapping (ownRange usually starts at FM)
    const proseStart = Math.max(titleFrom, node.frontmatter ? node.frontmatter.to : titleFrom);
    const comments = findHtmlComments(doc, ownFrom, ownTo);
    const hideScopeTitle = opts.hideHeadingNodeId !== undefined && node.id === opts.hideHeadingNodeId;
    if (!hideScopeTitle && titleFrom < titleTo) {
      const titleHoles: Range[] = [
        ...comments,
        ...inlineDelimiterRanges(findInlineMarks(doc, titleFrom, titleTo)),
        ...maskBackslashHoles(doc, titleFrom, titleTo),
      ];
      segments.push(...proseMinusHoles(titleFrom, titleTo, titleHoles, "prose"));
    }

    const bodyStart = Math.max(bodyFrom, proseStart, from);
    if (bodyStart >= ownTo) continue;

    const style = opts.inlineRefStyle ?? "attribute-block";
    const chips = findChips(doc, bodyStart, ownTo, style).filter(
      (c) => !comments.some((com) => com.from <= c.from && com.to >= c.to),
    );
    const holes: Range[] = comments.map((c) => ({ from: c.from, to: c.to }));
    const synthetic: Segment[] = [];
    for (const chip of chips) {
      if (!chip.textNode) {
        holes.push({ from: chip.from, to: chip.to });
        if (chip.label) {
          synthetic.push({ from: chip.from, to: chip.to, class: "prose", display: chip.label });
        }
        continue;
      }
      if (chip.from < chip.labelFrom) holes.push({ from: chip.from, to: chip.labelFrom });
      if (chip.labelTo < chip.to) holes.push({ from: chip.labelTo, to: chip.to });
    }
    // Inline delimiter chrome is not reader-visible (IM4/F4); interior stays searchable.
    for (const d of inlineDelimiterRanges(findInlineMarks(doc, bodyStart, ownTo))) {
      holes.push(d);
    }
    holes.push(...maskBackslashHoles(doc, bodyStart, ownTo));
    segments.push(...proseMinusHoles(bodyStart, ownTo, holes, "prose"));
    segments.push(...synthetic);
  }

  return mergeAdjacent(segments.filter((s) => s.from < s.to));
}

/** Punch `holes` out of `[from, to)` and emit the leftover as segments (H1/W2). */
function proseMinusHoles(
  from: number,
  to: number,
  holes: readonly Range[],
  hitClass: SearchHitClass,
): Segment[] {
  const clipped = holes
    .map((h) => ({ from: Math.max(h.from, from), to: Math.min(h.to, to) }))
    .filter((h) => h.from < h.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Range[] = [];
  for (const h of clipped) {
    const prev = merged[merged.length - 1];
    if (prev && h.from <= prev.to) prev.to = Math.max(prev.to, h.to);
    else merged.push({ ...h });
  }
  const out: Segment[] = [];
  let cursor = from;
  for (const h of merged) {
    if (cursor < h.from) out.push({ from: cursor, to: h.from, class: hitClass });
    cursor = Math.max(cursor, h.to);
  }
  if (cursor < to) out.push({ from: cursor, to, class: hitClass });
  return out;
}

function mergeAdjacent(segments: Segment[]): Segment[] {
  if (segments.length === 0) return segments;
  const sorted = [...segments].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Segment[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = sorted[i]!;
    if (prev.display !== undefined || cur.display !== undefined) {
      out.push({ ...cur });
      continue;
    }
    if (cur.class === prev.class && cur.from <= prev.to) {
      prev.to = Math.max(prev.to, cur.to);
    } else if (cur.from < prev.to && cur.class !== prev.class) {
      // Prefer metadata over overlapping prose
      if (cur.class === "metadata") {
        prev.to = cur.from;
        out.push({ ...cur });
      }
    } else {
      out.push({ ...cur });
    }
  }
  return out.filter((s) => s.from < s.to || (s.display !== undefined && s.display.length > 0));
}

let hitSeq = 0;

type CompiledQuery =
  | { kind: "literal"; needle: string; caseSensitive: boolean }
  | { kind: "regex"; re: RegExp };

function compileQuery(query: string, opts: FindMatchOptions): CompiledQuery | null {
  if (opts.regex) {
    try {
      const flags = opts.caseSensitive ? "gu" : "giu";
      return { kind: "regex", re: new RegExp(query, flags) };
    } catch {
      return null;
    }
  }
  return {
    kind: "literal",
    needle: opts.caseSensitive ? query : query.toLowerCase(),
    caseSensitive: Boolean(opts.caseSensitive),
  };
}

function matchInText(text: string, compiled: CompiledQuery): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (compiled.kind === "regex") {
    compiled.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = compiled.re.exec(text)) !== null) {
      if (match[0].length === 0) {
        compiled.re.lastIndex += 1;
        continue;
      }
      out.push({ from: match.index, to: match.index + match[0].length });
    }
    return out;
  }
  const hay = compiled.caseSensitive ? text : text.toLowerCase();
  const needle = compiled.needle;
  if (!needle) return out;
  let start = 0;
  while (start <= hay.length) {
    const idx = hay.indexOf(needle, start);
    if (idx < 0) break;
    out.push({ from: idx, to: idx + needle.length });
    start = idx + Math.max(1, needle.length);
  }
  return out;
}

export function findInDocument(doc: string, opts: SearchOptions): SearchHit[] {
  const q = opts.query;
  if (!q) return [];
  const compiled = compileQuery(q, opts);
  if (!compiled) return [];
  const segs = searchSegments(doc, opts);
  if (segs.length === 0) return [];

  let haystack = "";
  const map: {
    projFrom: number;
    projTo: number;
    sourceFrom: number;
    sourceTo: number;
    class: SearchHitClass;
    replace: boolean;
  }[] = [];
  for (const seg of segs) {
    const text = seg.display ?? doc.slice(seg.from, seg.to);
    const projFrom = haystack.length;
    haystack += text;
    map.push({
      projFrom,
      projTo: haystack.length,
      sourceFrom: seg.from,
      sourceTo: seg.to,
      class: seg.class,
      replace: seg.display !== undefined,
    });
  }

  const toSource = (proj: number, preferEnd: boolean): { offset: number; class: SearchHitClass } => {
    for (let i = 0; i < map.length; i++) {
      const seg = map[i]!;
      if (proj < seg.projFrom || proj > seg.projTo) continue;
      if (!preferEnd && proj === seg.projTo && proj === map[i + 1]?.projFrom) continue;
      if (seg.replace) {
        return { offset: preferEnd ? seg.sourceTo : seg.sourceFrom, class: seg.class };
      }
      const offset = seg.sourceFrom + (proj - seg.projFrom);
      return { offset: Math.min(offset, seg.sourceTo), class: seg.class };
    }
    const last = map[map.length - 1]!;
    if (proj >= last.projTo) return { offset: last.sourceTo, class: last.class };
    return { offset: map[0]!.sourceFrom, class: map[0]!.class };
  };

  const hits: SearchHit[] = [];
  for (const span of matchInText(haystack, compiled)) {
    const start = toSource(span.from, false);
    const end = toSource(span.to, true);
    let from = start.offset;
    let to = end.offset;
    if (to < from) [from, to] = [to, from];
    hits.push({
      id: `hit-${++hitSeq}`,
      from,
      to,
      class: start.class,
    });
  }
  return hits;
}

export interface ReplaceAllPlan {
  changes: { from: number; to: number; insert: string }[];
  prose: number;
  metadata: number;
  rejected: number;
}

/**
 * Plan replace-all on already-found hits (RP2–RP7). Caller applies one ChangeSet.
 * `classes` defaults to prose only (RP5). Metadata hits that would break YAML are rejected (RP6).
 */
export function planReplaceAll(
  doc: string,
  hits: SearchHit[],
  replacement: string,
  classes: SearchHitClass[] = ["prose"],
  yamlGuard?: (hit: SearchHit, text: string) => boolean,
): ReplaceAllPlan {
  const allow = new Set(classes);
  const accepted: SearchHit[] = [];
  let prose = 0;
  let metadata = 0;
  let rejected = 0;
  for (const hit of hits) {
    if (!allow.has(hit.class)) continue;
    if (hit.class === "metadata" && yamlGuard && !yamlGuard(hit, replacement)) {
      rejected += 1;
      continue;
    }
    accepted.push(hit);
    if (hit.class === "prose") prose += 1;
    else metadata += 1;
  }
  // Apply from the end so offsets stay valid
  accepted.sort((a, b) => b.from - a.from);
  return {
    changes: accepted.map((h) => ({ from: h.from, to: h.to, insert: replacement })),
    prose,
    metadata,
    rejected,
  };
}
