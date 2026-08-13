/**
 * Wysiwyg guards L1–L3 (SPEC.md § 8.1, § 11.1.9–10).
 * Installed only on wysiwyg view states — source does not get this extension.
 */

import { EditorSelection, EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syncAnnotation } from "../../sync/engine.js";

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

export function wysiwygForwardDelete(doc: string, head: number): { from: number; to: number } | undefined {
  const atom = headingAtomForDelete(doc, head, "forward");
  if (atom) return atom;
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

export function wysiwygGuards(): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: "Backspace",
          run(view) {
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const mk = headingAtomForDelete(view.state.doc.toString(), sel.head, "backward");
            if (!mk) return false;
            view.dispatch({
              changes: { from: mk.from, to: mk.to, insert: "" },
              selection: EditorSelection.cursor(mk.from),
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
            const range = wysiwygForwardDelete(view.state.doc.toString(), sel.head);
            if (!range) return false;
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

      const startDoc = tr.startState.doc.toString();
      const markers = headingMarkers(startDoc);
      const pairs = maskPairs(startDoc, 0, startDoc.length);
      let rewritten = false;
      const pieces: { from: number; to: number; insert: string }[] = [];

      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        let from = fromA;
        let to = toA;
        for (const mk of [...markers, ...pairs]) {
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
        pieces.push({ from, to, insert });
      });

      if (!rewritten) return tr;
      const userEvent = tr.annotation(Transaction.userEvent);
      return {
        changes: pieces,
        selection: tr.selection,
        filter: false,
        annotations: userEvent ? [Transaction.userEvent.of(userEvent)] : undefined,
      };
    }),
  ];
}
