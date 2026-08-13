/**
 * Per-view binding slots read by ViewPlugins during EditorView construction.
 * Presentation/scope must not live in EditorState (SPEC § 11.1 / G1).
 */

import type { EditorView } from "@codemirror/view";
import type { IncludeMode, Presentation } from "../view-handle.js";
import type { Tree } from "../core/types.js";

export interface ViewBinding {
  viewId: string;
  presentation: Presentation;
  include: IncludeMode;
  scopeNodeId: string | null;
  /** Live tree getter — always current projection. */
  getTree: () => Tree;
  selectionMitigation: boolean;
}

let pending: ViewBinding | null = null;
const bindings = new WeakMap<EditorView, ViewBinding>();

export function beginViewBind(binding: ViewBinding): void {
  pending = binding;
}

export function endViewBind(): void {
  pending = null;
}

export function takePendingBinding(view: EditorView): ViewBinding {
  if (pending) {
    bindings.set(view, pending);
    const b = pending;
    pending = null;
    return b;
  }
  const existing = bindings.get(view);
  if (existing) return existing;
  throw new Error("ViewPlugin constructed without beginViewBind (G1 slot)");
}

export function bindingOf(view: EditorView): ViewBinding | undefined {
  return bindings.get(view);
}

export function updateBinding(view: EditorView, patch: Partial<ViewBinding>): void {
  const cur = bindings.get(view);
  if (!cur) return;
  bindings.set(view, { ...cur, ...patch });
}
