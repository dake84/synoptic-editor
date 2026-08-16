/**
 * Viewport range padding (SPEC.md G8). Pure, no CM6 (I8).
 */

export const VIEWPORT_PAD = 500;

export interface DocRange {
  from: number;
  to: number;
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
