/**
 * Sync engine contract — variant-specific implementations live under shared-state / per-view-state.
 */

import type { ChangeSet, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { IncludeMode, Presentation } from "../view-handle.js";
import type { Tree } from "../core/types.js";

export type SyncVariant = "shared-state" | "per-view-state";

export type SyncListener = (doc: string) => void;

export type EditorTransactionHandler = (
  trs: readonly Transaction[],
  origin: EditorView,
) => void;

export interface MountEditorOptions {
  parent: HTMLElement;
  viewId: string;
  presentation: Presentation;
  include: IncludeMode;
  scopeNodeId: string | null;
  getTree: () => Tree;
  selectionMitigation: boolean;
  initialCaret?: number;
  /** DOM focus entered this editor — wire session focus / mitigation. */
  onFocus?: () => void;
}

export interface SyncEngine {
  readonly variant: SyncVariant;
  getDoc(): string;
  applyChanges(changes: ChangeSet): string;
  replaceDoc(doc: string): void;
  subscribe(listener: SyncListener): () => void;
}

/** V-S engine with CM6 views. */
export interface SharedStateSyncEngine extends SyncEngine {
  setTransactionHandler(handler: EditorTransactionHandler | null): void;
  mountEditor(opts: MountEditorOptions): EditorView;
  unmountEditor(view: EditorView): void;
  refreshView(view: EditorView, patch: Partial<MountEditorOptions>): void;
}

export function isSharedStateSync(engine: SyncEngine): engine is SharedStateSyncEngine {
  return engine.variant === "shared-state" && "mountEditor" in engine;
}
