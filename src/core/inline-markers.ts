/**
 * Inline chrome pairs for wysiwyg (SPEC.md § 8.6, IM1–IM4).
 * Pure string scan — no CM6, no Lezer (I8). Rebuild caller: docChanged only.
 */

import { findHtmlComments, overlapsAny } from "./html-comments.js";
import type { Range } from "./types.js";

export type InlineMarkKind = "em" | "strong" | "code" | "strike";

export interface InlineMarkSpan {
  kind: InlineMarkKind;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

const WS = /^[\p{Zs}\t\r\n\f]/u;
const PUNCT = /^[\p{P}\p{S}]/u;

function isWs(ch: string): boolean {
  return WS.test(ch);
}

function isPunct(ch: string): boolean {
  return PUNCT.test(ch);
}

/** True when `pos` is a meta char escaped by a single preceding backslash (L2 / IM3). */
export function isEscapedMeta(doc: string, pos: number): boolean {
  if (pos <= 0 || doc[pos - 1] !== "\\") return false;
  // Odd run of backslashes immediately before pos → escaped
  let i = pos - 1;
  let n = 0;
  while (i >= 0 && doc[i] === "\\") {
    n++;
    i--;
  }
  return n % 2 === 1;
}

function inHole(pos: number, holes: readonly Range[]): boolean {
  return holes.some((h) => pos >= h.from && pos < h.to);
}

/**
 * CommonMark code spans: opening backtick run of length n, closing run of length n.
 * Content may contain backticks of other lengths and newlines.
 */
function findCodeSpans(doc: string, from: number, to: number, holes: readonly Range[]): InlineMarkSpan[] {
  const out: InlineMarkSpan[] = [];
  let i = from;
  while (i < to) {
    if (inHole(i, holes) || doc[i] !== "`" || isEscapedMeta(doc, i)) {
      i++;
      continue;
    }
    let openLen = 0;
    while (i + openLen < to && doc[i + openLen] === "`") openLen++;
    const openFrom = i;
    const openTo = i + openLen;
    // Closing run of the same length, not part of a longer run
    let j = openTo;
    let found = -1;
    while (j < to) {
      if (inHole(j, holes)) {
        j++;
        continue;
      }
      if (doc[j] !== "`" || isEscapedMeta(doc, j)) {
        j++;
        continue;
      }
      let closeLen = 0;
      while (j + closeLen < to && doc[j + closeLen] === "`") closeLen++;
      if (closeLen === openLen) {
        found = j;
        break;
      }
      j += closeLen;
    }
    if (found < 0 || found === openTo) {
      i = openTo;
      continue;
    }
    out.push({
      kind: "code",
      openFrom,
      openTo,
      closeFrom: found,
      closeTo: found + openLen,
    });
    i = found + openLen;
  }
  return out;
}

/** GFM strikethrough: paired `~~` … `~~`, not nested, outside holes. */
function findStrikes(doc: string, from: number, to: number, holes: readonly Range[]): InlineMarkSpan[] {
  const out: InlineMarkSpan[] = [];
  let i = from;
  while (i < to - 1) {
    if (inHole(i, holes) || doc[i] !== "~" || doc[i + 1] !== "~" || isEscapedMeta(doc, i)) {
      i++;
      continue;
    }
    // Don't start a longer run of tildes as strike opener
    if (i + 2 < to && doc[i + 2] === "~") {
      i++;
      continue;
    }
    const openFrom = i;
    const openTo = i + 2;
    let j = openTo;
    let close = -1;
    while (j < to - 1) {
      if (inHole(j, holes)) {
        j++;
        continue;
      }
      if (doc[j] === "~" && doc[j + 1] === "~" && !isEscapedMeta(doc, j)) {
        if (j + 2 < to && doc[j + 2] === "~") {
          j++;
          continue;
        }
        close = j;
        break;
      }
      j++;
    }
    if (close < 0 || close === openTo) {
      i = openTo;
      continue;
    }
    out.push({
      kind: "strike",
      openFrom,
      openTo,
      closeFrom: close,
      closeTo: close + 2,
    });
    i = close + 2;
  }
  return out;
}

interface DelimRun {
  pos: number;
  length: number;
  char: "*" | "_";
  canOpen: boolean;
  canClose: boolean;
  /** Remaining unused length while matching. */
  used: number;
}

function charBefore(doc: string, pos: number): string {
  return pos <= 0 ? "\n" : doc[pos - 1]!;
}

function charAfter(doc: string, pos: number): string {
  return pos >= doc.length ? "\n" : doc[pos]!;
}

function scanDelimRuns(doc: string, from: number, to: number, holes: readonly Range[]): DelimRun[] {
  const runs: DelimRun[] = [];
  let i = from;
  while (i < to) {
    if (inHole(i, holes)) {
      i++;
      continue;
    }
    const ch = doc[i];
    if ((ch !== "*" && ch !== "_") || isEscapedMeta(doc, i)) {
      i++;
      continue;
    }
    let len = 0;
    while (i + len < to && doc[i + len] === ch && !isEscapedMeta(doc, i + len)) len++;
    const before = charBefore(doc, i);
    const after = charAfter(doc, i + len);
    const leftFlanking = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before));
    const rightFlanking = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after));
    let canOpen = false;
    let canClose = false;
    if (ch === "*") {
      canOpen = leftFlanking;
      canClose = rightFlanking;
    } else {
      canOpen = leftFlanking && (!rightFlanking || isPunct(before));
      canClose = rightFlanking && (!leftFlanking || isPunct(after));
    }
    if (canOpen || canClose) {
      runs.push({ pos: i, length: len, char: ch, canOpen, canClose, used: 0 });
    }
    i += len;
  }
  return runs;
}

/**
 * Match emphasis/strong from delimiter runs (CommonMark-ish: `***` → strong+em).
 * Consume 2 (strong) before 1 (em) from each matched pair of runs.
 */
function matchEmphasis(runs: DelimRun[]): InlineMarkSpan[] {
  const out: InlineMarkSpan[] = [];
  const openers: DelimRun[] = [];

  for (let closerIdx = 0; closerIdx < runs.length; closerIdx++) {
    const closer = runs[closerIdx]!;
    if (!closer.canClose) {
      if (closer.canOpen) openers.push(closer);
      continue;
    }

    let found = -1;
    for (let oi = openers.length - 1; oi >= 0; oi--) {
      const cand = openers[oi]!;
      if (cand.char === closer.char && cand.canOpen && cand.used < cand.length) {
        found = oi;
        break;
      }
    }

    if (found < 0) {
      if (closer.canOpen) openers.push(closer);
      continue;
    }

    const opener = openers[found]!;
    const unusedOpen = opener.length - opener.used;
    const unusedClose = closer.length - closer.used;
    if (unusedOpen <= 0 || unusedClose <= 0) {
      if (closer.canOpen) openers.push(closer);
      continue;
    }

    // CM multiple-of-3 rule when a delimiter can both open and close.
    const bothCan = opener.canClose || closer.canOpen;
    if (
      bothCan &&
      (opener.length + closer.length) % 3 === 0 &&
      opener.length % 3 !== 0 &&
      closer.length % 3 !== 0
    ) {
      if (closer.canOpen) openers.push(closer);
      continue;
    }

    // Prefer strong (2) so `***x***` yields em wrapping strong, both on the same interior text.
    const take = unusedOpen >= 2 && unusedClose >= 2 ? 2 : 1;
    const openFrom = opener.pos + (opener.length - opener.used - take);
    const openTo = openFrom + take;
    const closeFrom = closer.pos + closer.used;
    const closeTo = closeFrom + take;
    opener.used += take;
    closer.used += take;

    out.push({
      kind: take === 2 ? "strong" : "em",
      openFrom,
      openTo,
      closeFrom,
      closeTo,
    });

    if (opener.used >= opener.length) {
      openers.splice(found, openers.length - found);
    } else {
      openers.splice(found + 1, openers.length - found - 1);
    }

    if (closer.used < closer.length) closerIdx--;
  }

  out.sort((a, b) => a.openFrom - b.openFrom || a.closeTo - b.closeTo);
  return out;
}

/**
 * All closed inline mark spans in `[from, to)`. Optional extra holes (e.g. frontmatter).
 */
export function findInlineMarks(
  doc: string,
  from = 0,
  to = doc.length,
  extraHoles: readonly Range[] = [],
): InlineMarkSpan[] {
  if (from >= to) return [];
  const comments = findHtmlComments(doc, from, to);
  const baseHoles = [...comments, ...extraHoles];

  const codes = findCodeSpans(doc, from, to, baseHoles);
  const codeHoles: Range[] = [
    ...baseHoles,
    ...codes.map((c) => ({ from: c.openFrom, to: c.closeTo })),
  ];

  const strikes = findStrikes(doc, from, to, codeHoles);
  const strikeHoles: Range[] = [
    ...codeHoles,
    ...strikes.map((s) => ({ from: s.openFrom, to: s.closeTo })),
  ];

  const runs = scanDelimRuns(doc, from, to, strikeHoles);
  const emphasis = matchEmphasis(runs);

  return [...codes, ...strikes, ...emphasis].sort(
    (a, b) => a.openFrom - b.openFrom || a.closeFrom - b.closeFrom,
  );
}

/** Delimiter ranges only (hide + atom + search holes). */
export function inlineDelimiterRanges(spans: readonly InlineMarkSpan[]): Range[] {
  const out: Range[] = [];
  for (const s of spans) {
    if (s.openTo > s.openFrom) out.push({ from: s.openFrom, to: s.openTo });
    if (s.closeTo > s.closeFrom) out.push({ from: s.closeFrom, to: s.closeTo });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** True when range overlaps any inline delimiter of the given spans. */
export function overlapsInlineDelimiter(
  inner: Range,
  spans: readonly InlineMarkSpan[],
): boolean {
  return overlapsAny(inner, inlineDelimiterRanges(spans));
}
