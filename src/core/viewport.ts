/**
 * Viewport range padding (SPEC.md G8) and vertical overlap (G9). Pure, no CM6 (I8).
 */

export const VIEWPORT_PAD = 500;

export interface DocRange {
  from: number;
  to: number;
}

export interface VerticalInterval {
  top: number;
  bottom: number;
}

/** True iff the vertical intervals overlap strictly (G9). Touching an edge is not overlap. */
export function intervalsOverlap(a: VerticalInterval, b: VerticalInterval): boolean {
  return a.bottom > b.top && a.top < b.bottom;
}

/** Expand each range by `pad` and clamp to `[0, length]`. */
export function padDocRanges(
  ranges: readonly DocRange[],
  length: number,
  pad = VIEWPORT_PAD,
): DocRange[] {
  return ranges.map(({ from, to }) => ({
    from: Math.max(0, from - pad),
    to: Math.min(length, to + pad),
  }));
}
