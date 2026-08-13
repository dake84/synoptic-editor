/**
 * Document text truth (SPEC.md I1).
 * Changes are applied via CodeMirror ChangeSet — no DOM / no view.
 */

import { ChangeSet, Text, type ChangeSpec } from "@codemirror/state";

export function toText(doc: string): Text {
  return Text.of(doc.split("\n"));
}

export function fromText(text: Text): string {
  return text.toString();
}

/** Build a ChangeSet against a document of the given length. */
export function makeChangeSet(docLength: number, changes: ChangeSpec | ChangeSpec[]): ChangeSet {
  return ChangeSet.of(changes, docLength);
}

/** Apply a ChangeSet to a markdown string; returns the new string. */
export function applyChangeSet(doc: string, changes: ChangeSet): string {
  if (changes.empty) return doc;
  return fromText(changes.apply(toText(doc)));
}

/** Invert a ChangeSet for undo (requires the document *before* the forward change). */
export function invertChangeSet(docBefore: string, forward: ChangeSet): ChangeSet {
  return forward.invert(toText(docBefore));
}
