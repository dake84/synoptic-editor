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
 * Whether `open`/`close` sit immediately outside `[from, to)` without being
 * part of a longer run of the same character (so `*` does not peel `**`).
 */
function hasOuterWrap(doc: string, from: number, to: number, open: string, close: string): boolean {
  if (from < open.length || to + close.length > doc.length) return false;
  if (doc.slice(from - open.length, from) !== open) return false;
  if (doc.slice(to, to + close.length) !== close) return false;
  const oc = open[0];
  if (oc !== undefined && [...open].every((c) => c === oc)) {
    if (from > open.length && doc[from - open.length - 1] === oc) return false;
  }
  const cc = close[0];
  if (cc !== undefined && [...close].every((c) => c === cc)) {
    if (to + close.length < doc.length && doc[to + close.length] === cc) return false;
  }
  return true;
}

/**
 * Whether `text` itself begins and ends with `open`/`close` as a single wrap
 * layer (one-char markers must not be the edge of a longer run).
 */
function isSelfWrapped(text: string, open: string, close: string): boolean {
  if (text.length < open.length + close.length) return false;
  if (!text.startsWith(open) || !text.endsWith(close)) return false;
  const oc = open[0];
  if (oc !== undefined && open.length === 1 && text[open.length] === oc) return false;
  const cc = close[0];
  if (cc !== undefined && close.length === 1 && text[text.length - close.length - 1] === cc) {
    return false;
  }
  return true;
}

/**
 * Strip every occurrence of the wrap markers from `text` (word-like normalize).
 */
function stripWrapMarkers(text: string, open: string, close: string): string {
  let next = text.split(open).join("");
  if (close !== open) next = next.split(close).join("");
  return next;
}

/**
 * C3: word-like toggle wrap — unwrap when already wrapped, otherwise normalize
 * inner markers of this kind and wrap once. Empty caret expands to the word.
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
  const doc = view.state.doc.toString();

  if (hasOuterWrap(doc, from, to, open, close)) {
    view.dispatch({
      changes: [
        { from: to, to: to + close.length, insert: "" },
        { from: from - open.length, to: from, insert: "" },
      ],
      selection: EditorSelection.range(from - open.length, to - open.length),
      annotations: formatCommandAnnotation.of(true),
    });
    view.focus();
    return;
  }

  const selected = doc.slice(from, to);
  if (isSelfWrapped(selected, open, close)) {
    const inner = selected.slice(open.length, selected.length - close.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: EditorSelection.range(from, from + inner.length),
      annotations: formatCommandAnnotation.of(true),
    });
    view.focus();
    return;
  }

  const stripped = stripWrapMarkers(selected, open, close);
  view.dispatch({
    changes: { from, to, insert: `${open}${stripped}${close}` },
    selection: EditorSelection.range(from + open.length, from + open.length + stripped.length),
    annotations: formatCommandAnnotation.of(true),
  });
  view.focus();
}
