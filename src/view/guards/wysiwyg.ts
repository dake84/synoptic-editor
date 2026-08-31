/**
 * Wysiwyg guards L1–L3 (SPEC.md § 8.1, § 8.6, § 11.1.9–10).
 * Installed only on wysiwyg view states — source does not get this extension.
 */

import { Annotation, ChangeSet, EditorSelection, EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { findChips, type InlineRefStyle } from "../../core/chips.js";
import { findHtmlComments } from "../../core/html-comments.js";
import { findInlineMarks, inlineDelimiterRanges } from "../../core/inline-markers.js";
import { headingUnitRanges, hiddenFrontmatterRanges } from "../../core/tree.js";
import type { StructureSchema } from "../../core/types.js";
import { syncAnnotation } from "../../sync/engine.js";
import { hostWriteAnnotation } from "./locked-ranges.js";
import { formatCommandAnnotation } from "../commands.js";
import { chipAtomForDelete } from "./chips.js";
import { headingMarkers, maskPairs } from "./markers.js";
import { selectionParkFilter } from "./park-selection.js";
import { structureJoinFilter } from "./structure-join.js";

export { chipAtomForDelete, isExactChipDelete } from "./chips.js";
export { headingMarkers, maskBackslashRanges, maskPairs } from "./markers.js";

export const frontmatterWriteAnnotation = Annotation.define<boolean>();

export type FrontmatterSchemaArg = StructureSchema | ((state: EditorState) => StructureSchema);

function resolveFrontmatterSchema(schema: FrontmatterSchemaArg, state: EditorState): StructureSchema {
  return typeof schema === "function" ? schema(state) : schema;
}

function lineTextContaining(doc: string, pos: number): string {
  const from = pos <= 0 ? 0 : doc.lastIndexOf("\n", pos - 1) + 1;
  const nl = doc.indexOf("\n", from);
  const to = nl < 0 ? doc.length : nl;
  return doc.slice(from, to);
}

function changeTouchesRange(
  doc: string,
  fromA: number,
  toA: number,
  range: { from: number; to: number },
): boolean {
  if (fromA < range.to && toA > range.from) return true;
  // Point insert at `from` prepends into the fence (FM2).
  if (fromA === toA && fromA >= range.from && fromA < range.to) return true;
  // Backspace at `from` unglues only when the previous line is non-empty (FM9).
  if (toA === range.from && fromA < range.from && fromA >= range.from - 1) {
    return lineTextContaining(doc, range.from - 1).trim().length > 0;
  }
  return false;
}

export type FrontmatterLockOpts = {
  /** Host-owned holes (e.g. a typeable blank after an empty heading). */
  allowChange?: (from: number, to: number, state: EditorState) => boolean;
  /** LH3/LH4: a deletion that covers a heading unit may also take its YAML. */
  headingEditingLocked?: boolean;
};

/** Block raw edits to hidden frontmatter in wysiwyg (FM1/FM2/FM9); L5 writes via session applySession. */
export function frontmatterLockFilter(
  schema: FrontmatterSchemaArg,
  opts?: FrontmatterLockOpts,
): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
    if (tr.annotation(syncAnnotation)) return tr;
    if (tr.annotation(frontmatterWriteAnnotation)) return tr;
    if (tr.annotation(hostWriteAnnotation)) return tr;
    const resolved = resolveFrontmatterSchema(schema, tr.startState);
    const startDoc = tr.startState.doc.toString();
    const zones = hiddenFrontmatterRanges(startDoc, resolved);
    const units = headingUnitRanges(startDoc, resolved);
    let blocked = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (opts?.allowChange?.(fromA, toA, tr.startState)) return;
      const deletion = inserted.length === 0 && toA > fromA;
      if (deletion && units.some((unit) => fromA <= unit.from && toA >= unit.to)) return;
      for (const zone of zones) {
        if (changeTouchesRange(startDoc, fromA, toA, zone)) blocked = true;
      }
    });
    return blocked ? [] : tr;
  });
}

function lineBounds(doc: string, pos: number): { from: number; to: number } {
  const from = pos <= 0 ? 0 : doc.lastIndexOf("\n", pos - 1) + 1;
  const nl = doc.indexOf("\n", pos);
  return { from, to: nl < 0 ? doc.length : nl };
}

function headingLineStarts(doc: string): ReadonlySet<number> {
  return new Set(headingMarkers(doc).map((mk) => mk.from));
}

/** Enter on an ATX line would split the heading (L4). Blanks beside it stay prose. */
function blocksWysiwygNewline(doc: string, pos: number): boolean {
  const starts = headingLineStarts(doc);
  return starts.has(lineBounds(doc, pos).from);
}

/** L2: one pass over the original insert. The mask backslash is never masked again. */
export function escapeMarkdown(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === "-" && next !== undefined && /\s/.test(next)) {
      out += "\\-";
      continue;
    }
    if (ch === "#" || ch === "*" || ch === "_" || ch === ">" || ch === "`" || ch === "<" || ch === "\\") {
      out += `\\${ch}`;
      continue;
    }
    out += ch;
  }
  return out;
}

export function headingAtomForDelete(
  doc: string,
  head: number,
  dir: "backward" | "forward",
): { from: number; to: number } | undefined {
  const markers = headingMarkers(doc);
  if (dir === "backward") {
    return markers.find((mk) => head === mk.to || (head >= mk.from && head < mk.to));
  }
  return markers.find(
    (mk) =>
      (head >= mk.from && head < mk.to) ||
      head === mk.from ||
      (head === mk.from - 1 && head >= 0 && doc[head] === "\n"),
  );
}

/** Inline delimiter atom (IM1/L1): whole run or nothing. */
export function inlineAtomForDelete(
  doc: string,
  head: number,
  dir: "backward" | "forward",
): { from: number; to: number } | undefined {
  const dels = inlineDelimiterRanges(findInlineMarks(doc));
  if (dir === "backward") {
    return dels.find((mk) => head === mk.to || (head >= mk.from && head < mk.to));
  }
  return dels.find((mk) => (head >= mk.from && head < mk.to) || head === mk.from);
}

export function wysiwygForwardDelete(
  doc: string,
  head: number,
  style: InlineRefStyle = "attribute-block",
): { from: number; to: number } | undefined {
  const atom = headingAtomForDelete(doc, head, "forward");
  if (atom) return atom;
  const chip = chipAtomForDelete(doc, head, "forward", style);
  if (chip) return chip;
  const inline = inlineAtomForDelete(doc, head, "forward");
  if (inline) return inline;
  if (head < doc.length && doc[head] === "\n") return { from: head, to: head + 1 };
  return undefined;
}

export function snapOutOfHeadingMarkers(sel: EditorSelection, doc: string): EditorSelection {
  const markers = headingMarkers(doc);
  if (markers.length === 0) return sel;
  const ranges = sel.ranges.map((r) => {
    if (!r.empty) return r;
    for (const mk of markers) {
      if (r.head >= mk.from && r.head < mk.to) return EditorSelection.cursor(mk.to, 1);
    }
    return r;
  });
  return EditorSelection.create(ranges, sel.mainIndex);
}

export function wysiwygGuards(opts?: {
  structureLocked?: boolean;
  inlineRefStyle?: InlineRefStyle;
  schema?: StructureSchema;
  headingEditingLocked?: boolean;
}): Extension {
  const structureLocked = opts?.structureLocked ?? true;
  const inlineRefStyle = opts?.inlineRefStyle ?? "attribute-block";
  return [
    selectionParkFilter({
      inlineRefStyle,
      schema: opts?.schema,
      headingEditingLocked: opts?.headingEditingLocked,
    }),
    opts?.schema ? structureJoinFilter(opts.schema) : [],
    Prec.highest(
      keymap.of([
        {
          key: "Backspace",
          run(view) {
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const doc = view.state.doc.toString();
            const mk = headingAtomForDelete(doc, sel.head, "backward");
            if (mk) {
              if (structureLocked) return true; // consume, do not delete marker (L4/T43)
              view.dispatch({
                changes: { from: mk.from, to: mk.to, insert: "" },
                selection: EditorSelection.cursor(mk.from),
                userEvent: "delete.backward",
              });
              return true;
            }
            const chip = chipAtomForDelete(doc, sel.head, "backward", inlineRefStyle);
            if (chip) {
              view.dispatch({
                changes: { from: chip.from, to: chip.to, insert: "" },
                selection: EditorSelection.cursor(chip.from),
                userEvent: "delete.backward",
              });
              return true;
            }
            const inline = inlineAtomForDelete(doc, sel.head, "backward");
            if (!inline) return false;
            view.dispatch({
              changes: { from: inline.from, to: inline.to, insert: "" },
              selection: EditorSelection.cursor(inline.from),
              userEvent: "delete.backward",
            });
            return true;
          },
        },
        {
          key: "Delete",
          run(view) {
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const doc = view.state.doc.toString();
            const range = wysiwygForwardDelete(doc, sel.head, inlineRefStyle);
            if (!range) return false;
            const markers = headingMarkers(doc);
            const isMarker = markers.some((mk) => mk.from === range.from && mk.to === range.to);
            if (structureLocked && isMarker) return true;
            view.dispatch({
              changes: { from: range.from, to: range.to, insert: "" },
              selection: EditorSelection.cursor(range.from),
              userEvent: "delete.forward",
            });
            return true;
          },
        },
        {
          key: "Enter",
          run(view) {
            if (!structureLocked) return false;
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            return blocksWysiwygNewline(view.state.doc.toString(), sel.head);
          },
        },
      ]),
    ),
    EditorView.inputHandler.of((view, from, to, text) => {
      const escaped = escapeMarkdown(text);
      if (escaped === text) return false;
      view.dispatch({
        changes: { from, to, insert: escaped },
        selection: { anchor: from + escaped.length },
        filter: false,
        userEvent: "input.type",
      });
      return true;
    }),
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      if (tr.annotation(syncAnnotation)) return tr;

      if (structureLocked) {
        const startDoc = tr.startState.doc.toString();
        const markers = headingMarkers(startDoc);
        let blocked = false;
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          for (const mk of markers) {
            if (fromA < mk.to && toA > mk.from) blocked = true;
          }
          const ins = inserted.toString();
          if (/(^|\n)#{1,6}[ \t]/.test(ins)) blocked = true;
          if (ins.includes("\n") && blocksWysiwygNewline(startDoc, fromA)) blocked = true;
        });
        if (blocked) return [];
      }

      // C4: C1–C3 format commands insert authoritative Markdown markers, so the L2
      // masking below is skipped for them. The atom/overlap expansion still runs —
      // a format command must not split an existing marker run (L1).
      const formatCommand = tr.annotation(formatCommandAnnotation) === true;

      const startDoc = tr.startState.doc.toString();
      const markers = headingMarkers(startDoc);
      const pairs = maskPairs(startDoc, 0, startDoc.length);
      const comments = findHtmlComments(startDoc);
      const chips = findChips(startDoc, 0, startDoc.length, inlineRefStyle).map((c) => ({ from: c.from, to: c.to }));
      const inlineDels = inlineDelimiterRanges(findInlineMarks(startDoc));
      let rewritten = false;
      const pieces: { from: number; to: number; insert: string }[] = [];

      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        let from = fromA;
        let to = toA;
        for (const mk of [...markers, ...pairs, ...comments, ...chips, ...inlineDels]) {
          const overlaps = from < mk.to && to > mk.from;
          const covers = from <= mk.from && to >= mk.to;
          if (overlaps && !covers) {
            from = Math.min(from, mk.from);
            to = Math.max(to, mk.to);
            rewritten = true;
          }
        }
        const raw = inserted.toString();
        const insert = formatCommand ? raw : escapeMarkdown(raw);
        if (insert !== raw) rewritten = true;
        pieces.push({ from, to, insert });
      });

      if (!rewritten) return tr;
      const userEvent = tr.annotation(Transaction.userEvent);
      const mapped = tr.startState.selection.map(
        ChangeSet.of(pieces, tr.startState.doc.length),
        1,
      );
      return {
        changes: pieces,
        selection: mapped,
        filter: false,
        annotations: userEvent ? [Transaction.userEvent.of(userEvent)] : undefined,
      };
    }),
  ];
}
