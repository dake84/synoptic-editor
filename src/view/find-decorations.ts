/**
 * Find hit highlights (SPEC.md § 10, F7 / P4). Prose marks in the doc;
 * metadata in wysiwyg is highlighted via pills (findQueryField).
 */

import { RangeSetBuilder, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SearchHit } from "../core/search.js";
import type { Presentation } from "./presentation.js";

export const setFindQuery = StateEffect.define<string>();

export interface FindHighlightSpec {
  hits: readonly SearchHit[];
  active: number;
  presentation: Presentation;
}

export const setFindHighlights = StateEffect.define<FindHighlightSpec>();

export const findQueryField = StateField.define<string>({
  create: () => "",
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFindQuery)) return e.value;
    }
    return value;
  },
});

const hitMark = Decoration.mark({ class: "syn-find-hit" });
const activeMark = Decoration.mark({ class: "syn-find-hit syn-find-hit-active" });

function buildMarks(spec: FindHighlightSpec): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...spec.hits].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const hit of sorted) {
    // In wysiwyg, metadata lives in replaced FM — pills paint those hits (P4).
    if (spec.presentation === "wysiwyg" && hit.class === "metadata") continue;
    if (hit.from >= hit.to) continue;
    const active = spec.active >= 0 && spec.hits[spec.active] === hit;
    builder.add(hit.from, hit.to, active ? activeMark : hitMark);
  }
  return builder.finish();
}

export const findHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFindHighlights)) return buildMarks(e.value);
    }
    if (tr.docChanged) return value.map(tr.changes);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function findQueryOf(state: EditorState): string {
  return state.field(findQueryField);
}
