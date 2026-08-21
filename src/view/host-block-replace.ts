/**
 * Host-owned block-replace ranges (e.g. host FM+ATX protected chrome).
 *
 * When a host `Decoration.replace({ block: true })` covers a heading unit,
 * Synoptic must not also replace overlapping spans (FM hide/form, ATX marker
 * hide) — overlapping replaces are a CM6 error and a dual-occupancy breach.
 */

import { Facet } from "@codemirror/state";
import type { Range } from "../core/types.js";

/** Ranges the host already displays as a block replace. Session chrome skips them. */
export const hostBlockReplaceRanges = Facet.define<Range[], readonly Range[]>({
  combine: (values) => (values.length === 0 ? [] : values.flat()),
});

export function overlapsHostBlockReplace(
  span: { from: number; to: number },
  hosts: readonly Range[],
): boolean {
  for (const h of hosts) {
    if (span.from < h.to && span.to > h.from) return true;
  }
  return false;
}

/** True when `span` lies entirely inside some host block range. */
export function coveredByHostBlockReplace(
  span: { from: number; to: number },
  hosts: readonly Range[],
): boolean {
  for (const h of hosts) {
    if (span.from >= h.from && span.to <= h.to) return true;
  }
  return false;
}
