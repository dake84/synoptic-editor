/**
 * Chip atom delete (SPEC.md W3 / L1). Same family as headingAtomForDelete
 * and inlineAtomForDelete: the whole widget unit, or nothing.
 */

import { findChips, type InlineRefStyle } from "../../core/chips.js";

export function chipAtomForDelete(
  doc: string,
  head: number,
  dir: "backward" | "forward",
  style: InlineRefStyle = "attribute-block",
): { from: number; to: number } | undefined {
  const chips = findChips(doc, 0, doc.length, style);
  if (dir === "backward") {
    const hit = chips.find((c) => head === c.to || (head > c.from && head <= c.to));
    return hit ? { from: hit.from, to: hit.to } : undefined;
  }
  const hit = chips.find((c) => (head >= c.from && head < c.to) || head === c.from);
  return hit ? { from: hit.from, to: hit.to } : undefined;
}

/** True when [from, to) is a contiguous run of whole chips — nothing else. */
export function isExactChipDelete(
  doc: string,
  from: number,
  to: number,
  style: InlineRefStyle = "attribute-block",
): boolean {
  if (to <= from) return false;
  const chips = findChips(doc, from, to, style)
    .filter((c) => c.from >= from && c.to <= to)
    .sort((a, b) => a.from - b.from);
  if (chips.length === 0) return false;
  let cursor = from;
  for (const chip of chips) {
    if (chip.from !== cursor) return false;
    cursor = chip.to;
  }
  return cursor === to;
}
