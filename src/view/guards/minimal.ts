/**
 * Minimal wysiwyg guards L1–L3 via transaction annotations (SPEC § 8.1, I6/L6).
 * Source presentation is a no-op. Keymap/input only attach context; rules live here.
 */

import {
  Annotation,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import type { Presentation } from "../../view-handle.js";

export interface GuardContext {
  viewId: string;
  presentation: Presentation;
}

export const guardContext = Annotation.define<GuardContext>();
export const bypassGuards = Annotation.define<boolean>();

const MARKER_CHARS = new Set(["#", "*", "_", ">", "-", "`", "\\", "<"]);

function maskText(text: string): string {
  let out = "";
  for (const ch of text) out += MARKER_CHARS.has(ch) ? `\\${ch}` : ch;
  return out;
}

/** Heading marker ranges "#"+ for ATX lines — used by L1. */
function markerRanges(doc: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const lines = doc.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^(#{1,6})[ \t]+/.exec(line);
    if (m) out.push({ from: offset, to: offset + m[1]!.length + 1 });
    offset += line.length + (i < lines.length - 1 ? 1 : 0);
  }
  return out;
}

function partialMarkerDelete(
  from: number,
  to: number,
  markers: { from: number; to: number }[],
): { from: number; to: number } | null {
  for (const m of markers) {
    const overlaps = from < m.to && to > m.from;
    if (!overlaps) continue;
    if (!(from <= m.from && to >= m.to)) return m;
  }
  return null;
}

export const minimalGuardFilter: Extension = EditorState.transactionFilter.of((tr) => {
  if (tr.annotation(bypassGuards)) return tr;
  const ctx = tr.annotation(guardContext);
  if (!ctx || ctx.presentation !== "wysiwyg") return tr;
  if (!tr.docChanged) return tr;

  const startDoc = tr.startState.doc.toString();
  const markers = markerRanges(startDoc);
  const pieces: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
    pieces.push({ from: fromA, to: toA, insert: inserted.toString() });
  });

  let rewritten = false;
  const next: { from: number; to: number; insert: string }[] = [];
  for (const piece of pieces) {
    let { from, to, insert } = piece;
    const partial = partialMarkerDelete(from, to, markers);
    if (partial && insert.length === 0) {
      from = Math.min(from, partial.from);
      to = Math.max(to, partial.to);
      rewritten = true;
    }
    if (insert.length > 0) {
      const masked = maskText(insert);
      if (masked !== insert) {
        insert = masked;
        rewritten = true;
      }
    }
    next.push({ from, to, insert });
  }
  if (!rewritten) return tr;

  let sel: TransactionSpec["selection"] = tr.selection;
  const only = next.length === 1 ? next[0] : null;
  if (only && only.insert.length > 0) {
    sel = EditorSelection.cursor(only.from + only.insert.length);
  }

  return {
    changes: next,
    selection: sel,
    annotations: [guardContext.of(ctx), bypassGuards.of(true)],
    userEvent: tr.annotation(Transaction.userEvent),
  } satisfies TransactionSpec;
});

export function annotateGuard(
  viewId: string,
  presentation: Presentation,
  spec: TransactionSpec,
): TransactionSpec {
  const existing = spec.annotations
    ? Array.isArray(spec.annotations)
      ? spec.annotations
      : [spec.annotations]
    : [];
  return {
    ...spec,
    annotations: [...existing, guardContext.of({ viewId, presentation })],
  };
}
