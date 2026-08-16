/**
 * Locked ranges for wysiwyg (SPEC.md L1/L6/L7). One set: scanners plus host extras.
 */

import { Facet, type EditorState } from "@codemirror/state";
import { findChips, type InlineRefStyle } from "../../core/chips.js";
import { findHtmlComments } from "../../core/html-comments.js";
import { findInlineMarks, inlineDelimiterRanges } from "../../core/inline-markers.js";
import { projectTree } from "../../core/tree.js";
import type { Range, StructureSchema } from "../../core/types.js";
import { headingMarkers, maskPairs } from "./markers.js";

/** Host-contributed locks (protected widgets). Combined with scanner locks (L6). */
export const extraLockedRanges = Facet.define<readonly Range[], readonly Range[]>({
  combine(inputs) {
    return inputs.flat();
  },
});

export type LockedRangeOpts = {
  inlineRefStyle?: InlineRefStyle;
  schema?: StructureSchema;
};

function chipLocks(doc: string, style: InlineRefStyle): Range[] {
  const out: Range[] = [];
  for (const chip of findChips(doc, 0, doc.length, style)) {
    if (!chip.textNode) {
      if (chip.to > chip.from) out.push({ from: chip.from, to: chip.to });
      continue;
    }
    if (chip.labelFrom > chip.from) out.push({ from: chip.from, to: chip.labelFrom });
    if (chip.to > chip.labelTo) out.push({ from: chip.labelTo, to: chip.to });
  }
  return out;
}

function frontmatterLocks(doc: string, schema: StructureSchema | undefined): Range[] {
  if (!schema) return [];
  const out: Range[] = [];
  for (const node of projectTree(doc, schema).nodes.values()) {
    const fm = node.frontmatter;
    if (fm && fm.to > fm.from) out.push(fm);
  }
  return out;
}

/** Scanner-owned wysiwyg locks (not host widgets). */
export function synopticLockedRanges(doc: string, opts: LockedRangeOpts = {}): Range[] {
  const style = opts.inlineRefStyle ?? "attribute-block";
  return [
    ...headingMarkers(doc),
    ...maskPairs(doc, 0, doc.length),
    ...findHtmlComments(doc),
    ...inlineDelimiterRanges(findInlineMarks(doc)),
    ...chipLocks(doc, style),
    ...frontmatterLocks(doc, opts.schema),
  ].filter((r) => r.to > r.from);
}

export function lockedRangesFromState(state: EditorState, opts: LockedRangeOpts = {}): Range[] {
  return [...synopticLockedRanges(state.doc.toString(), opts), ...state.facet(extraLockedRanges)];
}
