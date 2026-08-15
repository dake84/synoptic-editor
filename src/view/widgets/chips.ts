/**
 * Inline reference chips (SPEC.md § 8.3): label stays text; chrome hidden (W1/W2).
 */

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findChips, type InlineRefStyle } from "../../core/chips.js";
import { findHtmlComments, overlapsAny } from "../../core/html-comments.js";
import type { ScopeRange } from "../scope.js";

const hideAttrs = Decoration.replace({});
const atomMark = Decoration.mark({});
/** Host-stylable hook on the visible label (SPEC § 8.3). No default look. */
const chipLabelMark = Decoration.mark({ class: "syn-chip" });

export function chipDecorationField(
  rangeField: StateField<ScopeRange>,
  style: InlineRefStyle,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildChipHide(state.doc.toString(), state.field(rangeField), style);
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildChipHide(tr.state.doc.toString(), r, style);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function chipAtomField(
  rangeField: StateField<ScopeRange>,
  style: InlineRefStyle,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildChipAtoms(state.doc.toString(), state.field(rangeField), style);
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildChipAtoms(tr.state.doc.toString(), r, style);
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

function visibleChips(doc: string, r: ScopeRange, style: InlineRefStyle) {
  if (r.lost) return [];
  const comments = findHtmlComments(doc, r.from, r.to);
  // W7 synthetic chips (no text node): host/widget replace comes later — hide only
  // chrome around real label text so self-closing tags are not wiped invisible.
  return findChips(doc, r.from, r.to, style).filter(
    (c) => c.textNode && !overlapsAny(c, comments),
  );
}

function hideRangeSlices(doc: string, from: number, to: number, builder: RangeSetBuilder<Decoration>): void {
  let pos = from;
  while (pos < to) {
    const nl = doc.indexOf("\n", pos);
    const end = nl < 0 || nl + 1 > to ? to : nl + 1;
    if (end > pos) builder.add(pos, end, hideAttrs);
    pos = end;
  }
}

function buildChipHide(doc: string, r: ScopeRange, style: InlineRefStyle): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const chip of visibleChips(doc, r, style)) {
    // Hide chrome — keep label text (O9/F7). Split on lines so replace stays inline.
    if (chip.from < chip.labelFrom) hideRangeSlices(doc, chip.from, chip.labelFrom, builder);
    if (chip.labelFrom < chip.labelTo) builder.add(chip.labelFrom, chip.labelTo, chipLabelMark);
    if (chip.labelTo < chip.to) hideRangeSlices(doc, chip.labelTo, chip.to, builder);
  }
  return builder.finish();
}

function buildChipAtoms(doc: string, r: ScopeRange, style: InlineRefStyle): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const chip of visibleChips(doc, r, style)) {
    if (chip.from < chip.to) builder.add(chip.from, chip.to, atomMark);
  }
  return builder.finish();
}
