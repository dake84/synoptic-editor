/**
 * Wysiwyg guards L1–L3 (SPEC.md § 8.1, § 8.6, § 11.1.9–10).
 * Installed only on wysiwyg view states — source does not get this extension.
 */

import { Annotation, EditorSelection, EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { findChips, type InlineRefStyle } from "../../core/chips.js";
import { findHtmlComments } from "../../core/html-comments.js";
import { findInlineMarks, inlineDelimiterRanges } from "../../core/inline-markers.js";
import { projectTree } from "../../core/tree.js";
import type { StructureSchema } from "../../core/types.js";
import { syncAnnotation } from "../../sync/engine.js";
import { chipAtomForDelete } from "./chips.js";

export { chipAtomForDelete, isExactChipDelete } from "./chips.js";

export const frontmatterWriteAnnotation = Annotation.define<boolean>();

/** Block raw edits to frontmatter ranges in wysiwyg (FM1/FM2); L5 writes via session applySession. */
export function frontmatterLockFilter(schema: StructureSchema): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (tr.annotation(syncAnnotation)) return tr;
    if (tr.annotation(frontmatterWriteAnnotation)) return tr;
    const doc = tr.startState.doc.toString();
    const tree = projectTree(doc, schema);
    let blocked = false;
    tr.changes.iterChanges((fromA, toA) => {
      for (const node of tree.nodes.values()) {
        const fm = node.frontmatter;
        if (!fm) continue;
        if (fromA < fm.to && toA > fm.from) blocked = true;
      }
    });
    return blocked ? [] : tr;
  });
}

/** ATX atom: hashes plus exactly one separator. Extra spaces are title (L4). */
const HEADING_MARKER = /^(#{1,6}[ \t])/gm;

export function headingMarkers(doc: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const re = new RegExp(HEADING_MARKER.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    out.push({ from: m.index, to: m.index + m[1]!.length });
  }
  return out;
}

const META = new Set(["#", "*", "_", ">", "`", "<", "\\", "-"]);

export function maskPairs(doc: string, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let i = from; i < to; i++) {
    if (doc[i] !== "\\") continue;
    const next = doc[i + 1];
    if (next !== undefined && META.has(next) && i + 2 <= to) {
      out.push({ from: i, to: i + 2 });
      i++;
    }
  }
  return out;
}

export function maskBackslashRanges(doc: string, from: number, to: number): { from: number; to: number }[] {
  return maskPairs(doc, from, to).map((p) => ({ from: p.from, to: p.from + 1 }));
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

function shiftSelection(
  sel: EditorSelection | undefined,
  deltas: { at: number; delta: number }[],
): EditorSelection | undefined {
  if (!sel || deltas.length === 0) return sel;
  const shift = (pos: number) =>
    pos + deltas.reduce((sum, d) => (d.at <= pos ? sum + d.delta : sum), 0);
  return EditorSelection.create(
    sel.ranges.map((r) => EditorSelection.range(shift(r.anchor), shift(r.head))),
    sel.mainIndex,
  );
}

export function wysiwygGuards(opts?: { structureLocked?: boolean; inlineRefStyle?: InlineRefStyle }): Extension {
  const structureLocked = opts?.structureLocked ?? true;
  const inlineRefStyle = opts?.inlineRefStyle ?? "attribute-block";
  return [
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
        });
        if (blocked) return [];
      }

      const startDoc = tr.startState.doc.toString();
      const markers = headingMarkers(startDoc);
      const pairs = maskPairs(startDoc, 0, startDoc.length);
      const comments = findHtmlComments(startDoc);
      const chips = findChips(startDoc, 0, startDoc.length, inlineRefStyle).map((c) => ({ from: c.from, to: c.to }));
      const inlineDels = inlineDelimiterRanges(findInlineMarks(startDoc));
      let rewritten = false;
      const pieces: { from: number; to: number; insert: string }[] = [];
      const deltas: { at: number; delta: number }[] = [];

      tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
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
        const insert = escapeMarkdown(raw);
        if (insert !== raw) rewritten = true;
        if (from === fromA && to === toA && insert.length !== raw.length) {
          deltas.push({ at: toB, delta: insert.length - raw.length });
        }
        pieces.push({ from, to, insert });
      });

      if (!rewritten) return tr;
      const userEvent = tr.annotation(Transaction.userEvent);
      return {
        changes: pieces,
        selection: shiftSelection(tr.selection, deltas),
        filter: false,
        annotations: userEvent ? [Transaction.userEvent.of(userEvent)] : undefined,
      };
    }),
  ];
}
