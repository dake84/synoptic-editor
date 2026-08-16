/**
 * Generic protected-range widget building blocks.
 *
 * Hosts supply the range computation (a `StateField<ProtectedRange[]>`, e.g. derived
 * from heading positions) and a `WidgetType` factory; this module wires up display
 * (replace decoration, `contenteditable="false"` is the widget's own job), atomicity
 * (cursor cannot land inside), and deletion protection (Backspace/Delete/cut do
 * nothing; Find & Replace or any edit that inserts replacement text is allowed
 * through so the widget's underlying text — e.g. a heading title — can change).
 */

import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState as EditorStateType,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, type WidgetType } from "@codemirror/view";
import { extraLockedRanges } from "../guards/locked-ranges.js";

export interface ProtectedRange {
  from: number;
  to: number;
}

/**
 * A find hit cannot be shown as a native browser selection/mark inside a
 * protected range — the range is DOM-replaced by the widget, there is no text
 * node to select. Hosts dispatch `setProtectedActiveMatch` with the hit's
 * document offsets when it falls inside a protected range; the widget factory
 * receives it (already clipped to widget-local offsets) and is responsible for
 * rendering its own highlight (see spikes/heading-widgets/protected-heading.ts).
 */
export const setProtectedActiveMatch = StateEffect.define<ProtectedRange | null>();

export const protectedActiveMatchField = StateField.define<ProtectedRange | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setProtectedActiveMatch)) return e.value;
    return value;
  },
});

export type ProtectedWidgetFactory = (
  doc: string,
  range: ProtectedRange,
  /** Sub-range of `range` that is the active find hit, or null. Same coordinate space as `range`. */
  activeMatch: ProtectedRange | null,
) => WidgetType;

function sortedRanges(state: EditorStateType, rangesField: StateField<ProtectedRange[]>): ProtectedRange[] {
  return [...state.field(rangesField)].filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
}

/** Block-replace decoration per range, rendered via the host's widget factory. */
export function protectedDecorationField(
  rangesField: StateField<ProtectedRange[]>,
  widgetFor: ProtectedWidgetFactory,
): StateField<DecorationSet> {
  const build = (state: EditorStateType): DecorationSet => {
    const doc = state.doc.toString();
    const active = state.field(protectedActiveMatchField);
    const builder = new RangeSetBuilder<Decoration>();
    for (const r of sortedRanges(state, rangesField)) {
      const sub = active && active.from >= r.from && active.to <= r.to ? active : null;
      builder.add(r.from, r.to, Decoration.replace({ widget: widgetFor(doc, r, sub), block: true }));
    }
    return builder.finish();
  };
  return StateField.define<DecorationSet>({
    create: (state) => build(state),
    update(value, tr) {
      const rangesChanged = tr.state.field(rangesField) !== tr.startState.field(rangesField);
      const activeChanged = tr.state.field(protectedActiveMatchField) !== tr.startState.field(protectedActiveMatchField);
      if (!tr.docChanged && !rangesChanged && !activeChanged) return value;
      return build(tr.state);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const atom = Decoration.mark({});

/** Atomic ranges so the caret cannot be placed inside a protected range. */
export function protectedAtomicField(rangesField: StateField<ProtectedRange[]>): StateField<DecorationSet> {
  const build = (state: EditorStateType): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const r of sortedRanges(state, rangesField)) builder.add(r.from, r.to, atom);
    return builder.finish();
  };
  return StateField.define<DecorationSet>({
    create: (state) => build(state),
    update(value, tr) {
      if (!tr.docChanged && tr.state.field(rangesField) === tr.startState.field(rangesField)) return value;
      return build(tr.state);
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

/**
 * Blocks pure deletions (Backspace, Delete, cut) that touch a protected range —
 * they become a no-op instead of removing the marker/widget. Changes that insert
 * replacement text (typing over a selection, Find & Replace) go through unchanged,
 * so a protected heading's title can still be edited via replace.
 */
export function preventProtectedDeletionFilter(rangesField: StateField<ProtectedRange[]>): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const ranges = tr.startState.field(rangesField).filter((r) => r.to > r.from);
    if (ranges.length === 0) return tr;
    let blocked = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (blocked || inserted.length > 0) return;
      for (const r of ranges) {
        if (fromA < r.to && toA > r.from) {
          blocked = true;
          return;
        }
      }
    });
    return blocked ? [] : tr;
  });
}

/** Combines display, atomicity, and deletion protection for a set of protected ranges. */
export function protectedWidgetExtension(
  rangesField: StateField<ProtectedRange[]>,
  widgetFor: ProtectedWidgetFactory,
): Extension {
  return [
    protectedActiveMatchField,
    protectedDecorationField(rangesField, widgetFor),
    protectedAtomicField(rangesField),
    preventProtectedDeletionFilter(rangesField),
    extraLockedRanges.compute([rangesField], (state) => state.field(rangesField)),
  ];
}
