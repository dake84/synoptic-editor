/**
 * HTML comments `<!-- … -->` (SPEC.md § 8.5, H1). Pure string scan — no CM6 (I8).
 */

export interface HtmlCommentSpan {
  from: number;
  to: number;
}

const COMMENT_RE = /<!--[\s\S]*?-->/g;

export function findHtmlComments(doc: string, from = 0, to = doc.length): HtmlCommentSpan[] {
  const slice = doc.slice(from, to);
  const out: HtmlCommentSpan[] = [];
  COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT_RE.exec(slice))) {
    out.push({ from: from + m.index, to: from + m.index + m[0].length });
  }
  return out;
}

export function rangesOverlap(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && a.to > b.from;
}

/** True when `inner` overlaps any span in `outers`. */
export function overlapsAny(
  inner: { from: number; to: number },
  outers: readonly { from: number; to: number }[],
): boolean {
  return outers.some((o) => rangesOverlap(inner, o));
}
