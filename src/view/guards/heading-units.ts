/**
 * Heading units (SPEC.md LH1–LH4).
 * Schema heading + its YAML fence, if any, is one range (I6).
 * `'locked'`: lock / atom / sticky-select. `'inline'`: empty title removes the unit.
 */

import {
  EditorSelection,
  Facet,
  Prec,
  RangeSetBuilder,
  StateField,
  Transaction,
  type EditorState as EditorStateType,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, keymap, type Command, type DecorationSet } from "@codemirror/view";
import { headingUnitRanges, projectTree } from "../../core/tree.js";
import type { Range, StructureSchema } from "../../core/types.js";
import { syncAnnotation } from "../../sync/engine.js";
import { extraLockedRanges, hostWriteAnnotation } from "./locked-ranges.js";
import { namedChangeFilter, namedTransactionFilter } from "./filter-trace.js";
import { frontmatterWriteAnnotation } from "./wysiwyg.js";

const headingUnitSchema = Facet.define<StructureSchema, StructureSchema | undefined>({
  combine(inputs) {
    return inputs[0];
  },
});

function unitsOf(state: EditorStateType): Range[] {
  const schema = state.facet(headingUnitSchema);
  if (!schema) return [];
  return headingUnitRanges(state.doc.toString(), schema);
}

export function headingUnitAtBoundary(
  doc: string,
  schema: StructureSchema,
  head: number,
  dir: "backward" | "forward",
): Range | undefined {
  const units = headingUnitRanges(doc, schema);
  if (dir === "backward") {
    return units.find((unit) => head === unit.to);
  }
  return units.find(
    (unit) => head === unit.from || (head === unit.from - 1 && head >= 0 && doc[head] === "\n"),
  );
}

function overlapsUnit(fromA: number, toA: number, unit: Range): boolean {
  if (fromA === toA) return fromA >= unit.from && fromA < unit.to;
  return fromA < unit.to && toA > unit.from;
}

function coversUnit(fromA: number, toA: number, unit: Range): boolean {
  return fromA <= unit.from && toA >= unit.to;
}

function headingUnitEditFilter(): Extension {
  return namedChangeFilter("headingUnitEditFilter", (tr) => {
    if (!tr.docChanged) return true;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;
    if (tr.annotation(syncAnnotation)) return true;
    if (tr.annotation(hostWriteAnnotation)) return true;
    if (tr.annotation(frontmatterWriteAnnotation)) return true;
    const units = unitsOf(tr.startState);
    if (units.length === 0) return true;
    let blocked = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (blocked) return;
      const deletion = inserted.length === 0 && toA > fromA;
      for (const unit of units) {
        if (!overlapsUnit(fromA, toA, unit)) continue;
        if (!(deletion && coversUnit(fromA, toA, unit))) {
          blocked = true;
          return;
        }
      }
    });
    return !blocked;
  });
}

const unitAtomMark = Decoration.mark({});

function buildUnitAtoms(state: EditorStateType): DecorationSet {
  const units = unitsOf(state).filter((r) => r.to > r.from);
  if (units.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const unit of units) builder.add(unit.from, unit.to, unitAtomMark);
  return builder.finish();
}

const headingUnitAtomField = StateField.define<DecorationSet>({
  create: buildUnitAtoms,
  update(value, tr) {
    if (!tr.docChanged) return value;
    return buildUnitAtoms(tr.state);
  },
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
});

function selectUnitCommand(dir: "backward" | "forward"): Command {
  return (view) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const schema = view.state.facet(headingUnitSchema);
    if (!schema) return false;
    const unit = headingUnitAtBoundary(view.state.doc.toString(), schema, sel.head, dir);
    if (!unit) return false;
    view.dispatch({
      selection: EditorSelection.range(unit.from, unit.to),
      userEvent: "select",
    });
    return true;
  };
}

/** LH2: first Backspace/Delete at the unit edge selects it. */
export const selectHeadingUnitBackward = selectUnitCommand("backward");
export const selectHeadingUnitForward = selectUnitCommand("forward");

function headingUnitKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "Backspace", run: selectHeadingUnitBackward },
      { key: "Delete", run: selectHeadingUnitForward },
    ]),
  );
}

function overlapsExtraLock(state: EditorStateType, from: number, to: number): boolean {
  for (const span of state.facet(extraLockedRanges)) {
    if (from < span.to && to > span.from) return true;
    if (from === to && from >= span.from && from < span.to) return true;
  }
  return false;
}

function unitForEmptyTitleAt(doc: string, schema: StructureSchema, pos: number): Range | undefined {
  for (const node of projectTree(doc, schema).nodes.values()) {
    if (node.title.trim() !== "") continue;
    if (pos < node.heading.from || pos > node.heading.to) continue;
    const from = node.frontmatter?.from ?? node.heading.from;
    let to = node.heading.to;
    if (to < doc.length && doc[to] === "\n") to += 1;
    if (to > from) return { from, to };
  }
  return undefined;
}

function textAfterChange(
  doc: string,
  from: number,
  to: number,
  fromA: number,
  toA: number,
  insert: string,
): string {
  const text = doc.slice(from, to);
  if (toA <= from || fromA >= to) return text;
  const a = Math.max(0, fromA - from);
  const b = Math.min(text.length, toA - from);
  const ins = fromA >= from && toA <= to ? insert : "";
  return text.slice(0, a) + ins + text.slice(b);
}

function startUnitIfTitleCleared(
  startDoc: string,
  schema: StructureSchema,
  fromA: number,
  toA: number,
  insert: string,
): Range | undefined {
  for (const node of projectTree(startDoc, schema).nodes.values()) {
    if (toA <= node.heading.from || fromA >= node.heading.to) continue;
    const titleFrom = node.heading.to - node.title.length;
    const newTitle = textAfterChange(startDoc, titleFrom, node.heading.to, fromA, toA, insert);
    if (newTitle.trim() !== "") continue;
    const from = node.frontmatter?.from ?? node.heading.from;
    let to = node.heading.to;
    if (to < startDoc.length && startDoc[to] === "\n") to += 1;
    if (to > from) return { from, to };
  }
  return undefined;
}

function isHuskTrigger(tr: Transaction): boolean {
  return tr.isUserEvent("delete") || tr.isUserEvent("input");
}

/** LH4: clearing a title removes the heading unit. Extra-locked host chrome is skipped. */
function emptyHeadingUnitGuards(schema: StructureSchema): Extension {
  const filter = namedTransactionFilter("emptyHeadingUnitGuards", (tr) => {
    if (!tr.docChanged) return tr;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
    if (tr.annotation(syncAnnotation)) return tr;
    if (tr.annotation(hostWriteAnnotation)) return tr;
    if (!isHuskTrigger(tr)) return tr;

    const startDoc = tr.startState.doc.toString();
    let expanded = false;
    const pending: { from: number; to: number; insert: string }[] = [];

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const insert = inserted.toString();
      if (fromA === toA && insert.length > 0) {
        pending.push({ from: fromA, to: toA, insert });
        return;
      }
      if (overlapsExtraLock(tr.startState, fromA, toA)) {
        pending.push({ from: fromA, to: toA, insert });
        return;
      }
      const unit = startUnitIfTitleCleared(startDoc, schema, fromA, toA, insert);
      if (unit && (unit.from !== fromA || unit.to !== toA || insert !== "")) {
        expanded = true;
        pending.push({ from: unit.from, to: unit.to, insert: "" });
        return;
      }
      pending.push({ from: fromA, to: toA, insert });
    });

    if (!expanded) return tr;

    const changes = pending.sort((a, b) => a.from - b.from);
    const sole = changes.length === 1 ? changes[0]! : null;
    return {
      changes,
      selection: EditorSelection.create(
        sole && sole.insert === ""
          ? [EditorSelection.cursor(sole.from)]
          : tr.newSelection.ranges.map((range) => EditorSelection.range(range.anchor, range.head)),
        0,
      ),
      effects: tr.effects,
      scrollIntoView: tr.scrollIntoView,
      annotations: [
        Transaction.userEvent.of(tr.annotation(Transaction.userEvent) ?? "delete"),
        Transaction.time.of(tr.annotation(Transaction.time) ?? Date.now()),
        hostWriteAnnotation.of(true),
      ],
    };
  });

  const backspace = Prec.highest(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          const { head, empty } = view.state.selection.main;
          if (!empty) return false;
          const unit = unitForEmptyTitleAt(view.state.doc.toString(), schema, head);
          if (!unit) return false;
          if (overlapsExtraLock(view.state, unit.from, unit.to)) return false;
          view.dispatch({
            changes: { from: unit.from, to: unit.to, insert: "" },
            selection: { anchor: unit.from },
            userEvent: "delete.backward",
            annotations: [hostWriteAnnotation.of(true)],
          });
          return true;
        },
      },
    ]),
  );

  return [filter, backspace];
}

/** Lock/atom/select (`'locked'`, LH1–LH3) or empty-title removal (`'inline'`, LH4). */
export function headingUnitGuards(
  schema: StructureSchema,
  opts?: { editing?: "locked" | "inline" },
): Extension {
  if ((opts?.editing ?? "locked") === "inline") {
    return emptyHeadingUnitGuards(schema);
  }
  return [
    headingUnitSchema.of(schema),
    headingUnitAtomField,
    headingUnitEditFilter(),
    headingUnitKeymap(),
  ];
}
