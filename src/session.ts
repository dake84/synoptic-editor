/**
 * Session — orchestrates document, tree, timeline, dirty, tracked positions, views (SPEC § 12).
 */

import type { ChangeSet, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { DirtyState } from "./core/dirty.js";
import { invertChangeSet } from "./core/document.js";
import { planStructureAction, type StructureAction } from "./core/structure.js";
import { createTimeline, type Timeline } from "./core/timeline.js";
import {
  createTrackedPositionRegistry,
  type TrackedPositionId,
  type TrackedPositionRegistry,
} from "./core/tracked-position.js";
import { projectTree, sliceRange } from "./core/tree.js";
import type { Range, StructureSchema, Tree, TreeNode } from "./core/types.js";
import {
  createSync,
  isSharedStateSync,
  type SharedStateSyncEngine,
  type SyncEngine,
  type SyncVariant,
} from "./sync/index.js";
import { CaretTrace } from "./view/caret-trace.js";
import { ScrollOwnerLog } from "./view/scroll.js";
import { SelectionMitigation } from "./view/selection-mitigation.js";
import { ViewHandle, type ViewOptions } from "./view-handle.js";

export interface Policy {
  structureEditingInWysiwyg?: "locked" | "allowed";
  frontmatterInWysiwyg?: "form" | "hidden";
}

export interface CreateSessionOptions {
  doc: string;
  schema: StructureSchema;
  policy?: Policy;
  timeline?: Timeline;
  strings?: Record<string, string>;
  variant?: SyncVariant;
  /** SPEC § 11.2 / O7 — default on after Phase 0 G3. */
  selectionMitigation?: boolean;
}

export type SessionListener = () => void;

export class Session {
  readonly schema: StructureSchema;
  readonly policy: Policy;
  readonly strings: Record<string, string>;
  readonly scrollLog = new ScrollOwnerLog();
  readonly caretTrace = new CaretTrace();
  readonly selectionMitigation: SelectionMitigation;

  private sync: SyncEngine;
  private timeline: Timeline;
  private dirty: DirtyState;
  private tracked: TrackedPositionRegistry;
  private treeCache: Tree;
  private views = new Map<string, ViewHandle>();
  private focusedViewId: string | null = null;
  private listeners = new Set<SessionListener>();
  private clampingSelection = false;

  constructor(opts: CreateSessionOptions) {
    this.schema = opts.schema;
    this.policy = {
      structureEditingInWysiwyg: opts.policy?.structureEditingInWysiwyg ?? "locked",
      frontmatterInWysiwyg: opts.policy?.frontmatterInWysiwyg ?? "form",
    };
    this.strings = opts.strings ?? {};
    this.selectionMitigation = new SelectionMitigation(opts.selectionMitigation ?? true);
    this.sync = createSync(opts.variant ?? "shared-state", opts.doc);
    this.timeline = createTimeline(opts.timeline);
    this.dirty = new DirtyState();
    this.tracked = createTrackedPositionRegistry();
    this.treeCache = projectTree(opts.doc, opts.schema);
    this.dirty.markPersisted(opts.doc, this.treeCache);

    if (isSharedStateSync(this.sync)) {
      this.sync.setTransactionHandler((trs, origin) => this.onEditorTransactions(trs, origin));
    }
  }

  get document(): string {
    return this.sync.getDoc();
  }

  get tree(): Tree {
    return this.treeCache;
  }

  get variant(): SyncVariant {
    return this.sync.variant;
  }

  /** @internal */
  get _sync(): SyncEngine {
    return this.sync;
  }

  get activeNode(): string | null {
    const v = this.focusedView();
    return v?.scopeNodeId ?? null;
  }

  get visibleNode(): string | null {
    const v = this.focusedView();
    return v?.visibleNode ?? null;
  }

  readNodes(ids: string[]): TreeNode[] {
    const out: TreeNode[] = [];
    for (const id of ids) {
      const n = this.treeCache.nodes.get(id);
      if (n) out.push(n);
    }
    return out;
  }

  readNodeText(ids: string[]): string[] {
    const doc = this.document;
    return this.readNodes(ids).map((n) => sliceRange(doc, n.subtreeRange));
  }

  createTrackedPosition(range: Range): TrackedPositionId {
    return this.tracked.create(range);
  }

  release(id: TrackedPositionId): void {
    this.tracked.release(id);
  }

  resolve(id: TrackedPositionId) {
    return this.tracked.resolve(id, this.treeCache);
  }

  isDirty(nodeId: string): boolean {
    return this.dirty.isDirty(this.document, this.treeCache, nodeId);
  }

  isSubtreeDirty(nodeId: string): boolean {
    return this.dirty.isSubtreeDirty(this.document, this.treeCache, nodeId);
  }

  markPersisted(nodeId?: string): void {
    this.dirty.markPersisted(this.document, this.treeCache, nodeId);
    this.notify();
  }

  subscribe(fn: SessionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(action: StructureAction): boolean {
    const doc = this.document;
    const plan = planStructureAction(doc, this.treeCache, this.schema, action);
    if (!plan.ok) return false;

    const inverse = invertChangeSet(doc, plan.changes);
    this.commitTextChange(plan.changes, inverse, {
      targetNodeId: plan.targetNodeId,
      label: action.type,
    });
    return true;
  }

  applyTextChange(
    changes: ChangeSet,
    meta?: { targetNodeId?: string; targetRange?: Range; label?: string },
  ): void {
    if (changes.empty) return;
    const inverse = invertChangeSet(this.document, changes);
    this.commitTextChange(changes, inverse, meta);
  }

  undo(): boolean {
    const result = this.timeline.undo();
    if (!result) return false;
    if (result.kind === "text") {
      this.applyChangesNoTimeline(result.changes);
    }
    this.notify();
    return true;
  }

  redo(): boolean {
    const result = this.timeline.redo();
    if (!result) return false;
    if (result.kind === "text") {
      this.applyChangesNoTimeline(result.changes);
    }
    this.notify();
    return true;
  }

  replaceDocument(doc: string): void {
    this.sync.replaceDoc(doc);
    this.treeCache = projectTree(doc, this.schema);
    this.timeline.clear();
    this.dirty.clear();
    this.dirty.markPersisted(doc, this.treeCache);
    this.tracked.invalidateAll();
    for (const v of this.views.values()) {
      v._validateScope();
      v._refreshEditor();
    }
    this.notify();
  }

  createView(opts?: ViewOptions): ViewHandle {
    const view = new ViewHandle(this, opts);
    this.views.set(view.id, view);
    if (!this.focusedViewId) {
      this.focusedViewId = view.id;
      this.selectionMitigation.setFocused(view.id);
    }
    this.notify();
    return view;
  }

  _unregisterView(view: ViewHandle): void {
    this.views.delete(view.id);
    if (this.focusedViewId === view.id) {
      this.focusedViewId = this.views.keys().next().value ?? null;
      if (this.focusedViewId) this.selectionMitigation.setFocused(this.focusedViewId);
    }
    this.notify();
  }

  _setFocusedView(id: string): void {
    if (!this.views.has(id)) return;
    this.focusedViewId = id;
    this.selectionMitigation.setFocused(id);
    const view = this.views.get(id);
    if (view) this._traceCaret("focus", view);
    if (view && this.selectionMitigation.isEnabled()) {
      view._restoreMitigatedCaret();
    }
    this.notify();
  }

  /** @internal */
  _traceCaret(cause: string, view: ViewHandle): void {
    const head = view._editor?.state.selection.main.head ?? -1;
    this.caretTrace.record({
      cause,
      viewId: view.id,
      head,
      inRenderRange: head < 0 ? false : view.selectionInRenderRange(head),
      cmHasFocus: view.hasDomFocus(),
      nodeId: view.scopeNodeId,
    });
  }

  _notify(): void {
    this.notify();
  }

  get timelineDepth(): number {
    return this.timeline.depth;
  }

  sharedSync(): SharedStateSyncEngine | null {
    return isSharedStateSync(this.sync) ? this.sync : null;
  }

  private focusedView(): ViewHandle | undefined {
    return this.focusedViewId ? this.views.get(this.focusedViewId) : undefined;
  }

  private onEditorTransactions(trs: readonly Transaction[], origin: EditorView): void {
    const view = [...this.views.values()].find((v) => v._editor === origin);
    const selectionSet = trs.some((t) => t.selection);

    if (view && selectionSet) {
      const head = origin.state.selection.main.head;
      const inRange = view.selectionInRenderRange(head);
      this._traceCaret(inRange ? "selection.in-range" : "selection.outside-render-range", view);
      if (inRange) {
        this.selectionMitigation.remember(view.id, head);
      } else if (this.selectionMitigation.isEnabled() && !this.clampingSelection) {
        this.clampingSelection = true;
        try {
          view._restoreMitigatedCaret();
        } finally {
          this.clampingSelection = false;
        }
      }
    }

    const docTrs = trs.filter((t) => t.docChanged);
    if (docTrs.length === 0) {
      this.notify();
      return;
    }

    // One timeline entry per dispatch batch (U15 intent for typing).
    let startDoc = docTrs[0]!.startState.doc.toString();
    let combined = docTrs[0]!.changes;
    for (let i = 1; i < docTrs.length; i++) {
      combined = combined.compose(docTrs[i]!.changes);
    }
    // Inverse against document before first change in the batch.
    const inverse = invertChangeSet(startDoc, combined);

    this.tracked.mapThrough(combined);
    this.treeCache = projectTree(this.document, this.schema);
    for (const v of this.views.values()) {
      v._validateScope();
      v._refreshEditor();
    }
    this.timeline.pushText(combined, inverse, { label: "input" });
    this.notify();
  }

  private commitTextChange(
    forward: ChangeSet,
    inverse: ChangeSet,
    meta?: { targetNodeId?: string; targetRange?: Range; label?: string },
  ): void {
    this.applyChangesNoTimeline(forward);
    this.timeline.pushText(forward, inverse, meta);
    this.notify();
  }

  private applyChangesNoTimeline(changes: ChangeSet): void {
    this.sync.applyChanges(changes);
    this.tracked.mapThrough(changes);
    this.treeCache = projectTree(this.document, this.schema);
    for (const v of this.views.values()) {
      v._validateScope();
      v._refreshEditor();
    }
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export function createSession(opts: CreateSessionOptions): Session {
  return new Session(opts);
}
