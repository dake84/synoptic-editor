/**
 * Markdown source commands (SPEC.md C1–C3). No schema, no ranks.
 */

import { Annotation, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * C4: marks a transaction as an authoritative C1–C3 format-command insert so the
 * wysiwyg L2 filter leaves its Markdown markers unmasked (typed/pasted meta is
 * unaffected). Same targeted bypass as L5.
 */
export const formatCommandAnnotation = Annotation.define<boolean>();

const ATX_PREFIX = /^#{1,6}[ \t]+/;
const LIST_PREFIX = /^(\s*)(?:-|\d+\.)[ \t]+/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function wordRangeInLine(lineText: string, local: number): { from: number; to: number } {
  let from = local;
  let to = local;
  while (from > 0 && WORD_CHAR.test(lineText[from - 1]!)) from -= 1;
  while (to < lineText.length && WORD_CHAR.test(lineText[to]!)) to += 1;
  return { from, to };
}

/**
 * C1: replace the current line's ATX prefix with `depth` hashes plus one space.
 *
 * @param view - Focused editor view
 * @param depth - Heading depth 1–6
 */
export function setHeadingLevel(view: EditorView, depth: number): void {
  const n = Math.min(6, Math.max(1, Math.floor(depth)));
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const existing = ATX_PREFIX.exec(line.text)?.[0] ?? "";
  const prefix = `${"#".repeat(n)} `;
  const bodyLen = line.text.length - existing.length;
  view.dispatch({
    changes: { from: line.from, to: line.from + existing.length, insert: prefix },
    selection: EditorSelection.cursor(line.from + prefix.length + bodyLen),
    annotations: formatCommandAnnotation.of(true),
  });
  view.focus();
}

/**
 * C2: add, switch, or strip a list marker on the current line.
 *
 * @param view - Focused editor view
 * @param marker - Bullet (`-`) or ordered (`1.`) marker
 */
export function insertListPrefix(view: EditorView, marker: "-" | "1."): void {
  const sel = view.state.selection.main.from;
  const line = view.state.doc.lineAt(sel);
  const match = LIST_PREFIX.exec(line.text);
  const indent = match?.[1] ?? "";
  const markerText = `${marker} `;

  if (match) {
    const existing = match[0].slice(indent.length);
    const same = existing === markerText || (marker === "1." && /^\d+\.[ \t]+$/.test(existing));
    if (same) {
      const next = `${indent}${line.text.slice(match[0].length)}`;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: next },
        selection: EditorSelection.cursor(
          Math.min(sel - (match[0].length - indent.length), line.from + next.length),
        ),
        annotations: formatCommandAnnotation.of(true),
      });
      view.focus();
      return;
    }
    const next = `${indent}${markerText}${line.text.slice(match[0].length)}`;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: next },
      selection: EditorSelection.cursor(line.from + indent.length + markerText.length),
      annotations: formatCommandAnnotation.of(true),
    });
    view.focus();
    return;
  }

  view.dispatch({
    changes: { from: line.from, insert: markerText },
    selection: EditorSelection.cursor(sel + markerText.length),
    annotations: formatCommandAnnotation.of(true),
  });
  view.focus();
}

/**
 * C3: wrap the selection; empty caret expands to the word on the line.
 *
 * @param view - Focused editor view
 * @param open - Opening marker (e.g. `**`)
 * @param close - Closing marker; defaults to `open`
 */
export function toggleWrapSelection(view: EditorView, open: string, close = open): void {
  let { from, to } = view.state.selection.main;
  if (from === to) {
    const line = view.state.doc.lineAt(from);
    const local = wordRangeInLine(line.text, from - line.from);
    from = line.from + local.from;
    to = line.from + local.to;
  }
  const selected = view.state.doc.sliceString(from, to);
  view.dispatch({
    changes: { from, to, insert: `${open}${selected}${close}` },
    selection: EditorSelection.range(from + open.length, from + open.length + selected.length),
    annotations: formatCommandAnnotation.of(true),
  });
  view.focus();
}
