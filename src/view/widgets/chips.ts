/**
 * Inline reference chips (SPEC.md § 8.3): label stays text; attrs hidden (W1/W2).
 */

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findChips } from "../../core/chips.js";
import type { ScopeRange } from "../scope.js";

const hideAttrs = Decoration.replace({});
const atomMark = Decoration.mark({});

export function chipDecorationField(rangeField: StateField<ScopeRange>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildChipHide(state.doc.toString(), state.field(rangeField));
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildChipHide(tr.state.doc.toString(), r);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function chipAtomField(rangeField: StateField<ScopeRange>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildChipAtoms(state.doc.toString(), state.field(rangeField));
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildChipAtoms(tr.state.doc.toString(), r);
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

function buildChipHide(doc: string, r: ScopeRange): DecorationSet {
  if (r.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const chip of findChips(doc, r.from, r.to)) {
    // Hide `[` `]` and `{attrs}` — keep label text (O9/F7)
    if (chip.from < chip.labelFrom) builder.add(chip.from, chip.labelFrom, hideAttrs);
    if (chip.labelTo < chip.to) builder.add(chip.labelTo, chip.to, hideAttrs);
  }
  return builder.finish();
}

function buildChipAtoms(doc: string, r: ScopeRange): DecorationSet {
  if (r.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const chip of findChips(doc, r.from, r.to)) {
    if (chip.from < chip.to) builder.add(chip.from, chip.to, atomMark);
  }
  return builder.finish();
}
