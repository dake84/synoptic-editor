/**
 * Search projection (SPEC.md § 10). One place (I6): source vs wysiwyg, prose vs metadata.
 */

import { findChips, type InlineRefStyle } from "./chips.js";
import { fieldByKey, parseFrontmatterBlock } from "./frontmatter.js";
import { findHtmlComments, overlapsAny } from "./html-comments.js";
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

export interface SearchOptions {
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
}

interface Segment {
  from: number;
  to: number;
  class: SearchHitClass;
}

function headingMarkerEnd(doc: string, headingFrom: number): number {
  const lineEnd = doc.indexOf("\n", headingFrom);
  const line = doc.slice(headingFrom, lineEnd < 0 ? doc.length : lineEnd);
  const m = /^(#{1,6}[ \t])/.exec(line);
  return m ? headingFrom + m[1]!.length : headingFrom;
}

/**
 * Build searchable document segments for the given presentation (F4–F9).
 */
export function searchSegments(doc: string, opts: SearchOptions): Segment[] {
  const tree = opts.tree ?? projectTree(doc, opts.schema);
  const { from, to } = opts.range;
  if (opts.query === "" || from >= to) return [];

  if (opts.presentation === "source") {
    return [{ from, to, class: "prose" }];
  }

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
    if (titleFrom < titleTo) {
      segments.push(...proseMinusHoles(titleFrom, titleTo, comments, "prose"));
    }

    const bodyStart = Math.max(bodyFrom, proseStart, from);
    if (bodyStart >= ownTo) continue;

    const style = opts.inlineRefStyle ?? "attribute-block";
    const chips = findChips(doc, bodyStart, ownTo, style).filter((c) => !overlapsAny(c, comments));
    const holes: Range[] = comments.map((c) => ({ from: c.from, to: c.to }));
    for (const chip of chips) {
      if (chip.from < chip.labelFrom) holes.push({ from: chip.from, to: chip.labelFrom });
      if (chip.labelTo < chip.to) holes.push({ from: chip.labelTo, to: chip.to });
    }
    segments.push(...proseMinusHoles(bodyStart, ownTo, holes, "prose"));
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
  return out.filter((s) => s.from < s.to);
}

let hitSeq = 0;

export function findInDocument(doc: string, opts: SearchOptions): SearchHit[] {
  const q = opts.query;
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const seg of searchSegments(doc, opts)) {
    const text = doc.slice(seg.from, seg.to);
    let start = 0;
    while (start <= text.length) {
      const idx = text.indexOf(q, start);
      if (idx < 0) break;
      hits.push({
        id: `hit-${++hitSeq}`,
        from: seg.from + idx,
        to: seg.from + idx + q.length,
        class: seg.class,
      });
      start = idx + Math.max(1, q.length);
    }
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
