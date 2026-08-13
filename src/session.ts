/**
 * Session: one document, one timeline, many views (SPEC.md § 3, § 7.3, § 11, § 12).
 */

import { ChangeSet, EditorSelection, Transaction } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import { undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
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
import { getNode, nodeAtPosition, projectTree } from "./core/tree.js";
import type { Range, StructureSchema, Tree } from "./core/types.js";
import { createSync, type SyncEngine, type ViewId } from "./sync/index.js";
import { wysiwygGuards } from "./view/guards/wysiwyg.js";
import {
  grainField,
  hideOutsideField,
  wysiwygAtomField,
  wysiwygDecorationField,
  type IncludeMode,
  type Presentation,
} from "./view/presentation.js";
import { readingLinePos, scrollCause, scrollToPos, visibleNodeFromView } from "./view/scroll.js";
import {
  createScopeRangeField,
  rangeRelation,
  scopeCopyHandler,
  scopeFence,
  setScopeRange,
  viewRange,
  type ScopeRange,
} from "./view/scope.js";
import type { ViewHandle, ViewRestoreState, ViewScope } from "./view-handle.js";

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
}

export interface CreateViewOptions {
  scope?: { nodeId: string; include?: IncludeMode };
  presentation?: Presentation;
  grain?: number;
  state?: ViewRestoreState;
}

export type SessionEvent =
  | { type: "document" }
  | { type: "tree" }
  | { type: "views" }
  | { type: "focus" }
  | { type: "tracked"; id: TrackedPositionId }
  | { type: "scopeLost"; viewId: string };

export type RelationKind = "identical" | "containing" | "disjoint";

export interface ViewRelation {
  a: string;
  b: string;
  kind: RelationKind;
  outer?: string;
  inner?: string;
}

interface ViewSlot {
  id: string;
  scope: ViewScope;
  presentation: Presentation;
  grain: number;
  visibleNode: string | null;
  lastScrollCause: string | null;
  caretAt: TrackedPositionId;
  scrollAt: TrackedPositionId;
  handedOut: boolean;
  lostNotified: boolean;
  ancestry: string[];
  rangeField: ReturnType<typeof createScopeRangeField>;
  compartment: Compartment;
  handle: ViewHandle;
}

function renderRangeOf(tree: Tree, scope: ViewScope): Range | null {
  const n = tree.nodes.get(scope.nodeId);
  if (!n) return null;
  return scope.include === "own" ? n.ownRange : n.subtreeRange;
}

function firstProse(doc: string, range: Range, tree: Tree, nodeId: string): number {
  const n = tree.nodes.get(nodeId);
  let p = range.from;
  if (n) p = n.heading.to;
  while (p < range.to && (doc[p] === "\n" || doc[p] === "\r")) p += 1;
  const max = range.to < doc.length && range.to > range.from ? range.to - 1 : range.to;
  return Math.min(Math.max(p, range.from), max);
}

function ancestryOf(tree: Tree, nodeId: string): string[] {
  const out: string[] = [];
  let id: string | null = tree.nodes.get(nodeId)?.parentId ?? null;
  while (id) {
    out.push(id);
    id = tree.nodes.get(id)?.parentId ?? null;
  }
  return out;
}

function survivingAncestor(tree: Tree, nodeId: string, ancestry: string[]): string | null {
  for (const id of [nodeId, ...ancestry]) {
    if (tree.nodes.has(id)) return id;
  }
  return tree.roots[0] ?? null;
}

export class Session {
  readonly schema: StructureSchema;
  readonly policy: Required<Policy>;
  private readonly sync: SyncEngine;
  private readonly timeline: Timeline;
  private readonly tracked: TrackedPositionRegistry;
  private readonly dirty = new DirtyState();
  private treeState: Tree;
  private readonly views = new Map<ViewId, ViewSlot>();
  private focused: ViewId | null = null;
  private nextView = 1;
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  private hushTimeline = false;
  private measurePending = false;
  private measuring = false;
  layoutDuringUpdate = 0;

  constructor(opts: CreateSessionOptions) {
    this.schema = opts.schema;
    this.policy = {
      structureEditingInWysiwyg: opts.policy?.structureEditingInWysiwyg ?? "locked",
      frontmatterInWysiwyg: opts.policy?.frontmatterInWysiwyg ?? "form",
    };
    this.sync = createSync(opts.doc);
    this.timeline = createTimeline(opts.timeline);
    this.tracked = createTrackedPositionRegistry();
    this.treeState = projectTree(opts.doc, opts.schema);
    this.dirty.markPersisted(opts.doc, this.treeState);
    this.tracked.onInvalidate((id) => this.emit({ type: "tracked", id }));
    this.sync.afterDocument = (changes, originId, docBefore) => {
      this.tracked.mapThrough(changes);
      this.treeState = projectTree(this.sync.document, this.schema);
      if (!this.hushTimeline && originId) {
        let from = 0;
        let seen = false;
        changes.iterChanges((fromA) => {
          if (!seen) {
            from = fromA;
            seen = true;
          }
        });
        const target = nodeAtPosition(projectTree(docBefore.toString(), this.schema), from);
        this.timeline.pushText(changes, invertChangeSet(docBefore.toString(), changes), {
          targetNodeId: target?.id,
        });
      }
      this.emitScopeLost();
      this.emit({ type: "document" });
      this.emit({ type: "tree" });
      this.scheduleMeasure();
    };
    this.sync.afterLocal = (id, trs) => {
      const slot = this.views.get(id);
      if (!slot) return;
      for (const tr of trs) {
        const cause = tr.annotation(scrollCause);
        if (cause) slot.lastScrollCause = cause;
      }
      this.scheduleMeasure();
    };
  }

  get document(): string {
    return this.sync.document;
  }

  get tree(): Tree {
    return this.treeState;
  }

  get timelineDepth(): number {
    return this.timeline.depth;
  }

  get activeNode(): string | null {
    if (!this.focused) return null;
    return this.views.get(this.focused)?.scope.nodeId ?? null;
  }

  get visibleNode(): string | null {
    if (!this.focused) return null;
    return this.views.get(this.focused)?.visibleNode ?? null;
  }

  get focusedViewId(): string | null {
    return this.focused;
  }

  viewIds(): string[] {
    return this.sync.viewIds();
  }

  view(id: string): ViewHandle | undefined {
    return this.views.get(id)?.handle;
  }

  isDirty(nodeId: string): boolean {
    return this.dirty.isDirty(this.document, this.treeState, nodeId);
  }

  isSubtreeDirty(nodeId: string): boolean {
    return this.dirty.isSubtreeDirty(this.document, this.treeState, nodeId);
  }

  readNodes(ids: string[]): { id: string; title: string; text: string }[] {
    const doc = this.document;
    return ids.flatMap((id) => {
      const n = this.treeState.nodes.get(id);
      if (!n) return [];
      return [{ id, title: n.title, text: doc.slice(n.ownRange.from, n.ownRange.to) }];
    });
  }

  createTrackedPosition(range: Range): TrackedPositionId {
    return this.tracked.create(range);
  }

  release(id: TrackedPositionId): void {
    this.tracked.release(id);
  }

  resolve(id: TrackedPositionId) {
    return this.tracked.resolve(id, this.treeState);
  }

  trackedCount(): number {
    return this.tracked.size();
  }

  trackedRecord(id: TrackedPositionId) {
    return this.tracked.get(id);
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  markPersisted(nodeId?: string): void {
    this.dirty.markPersisted(this.document, this.treeState, nodeId);
    this.emit({ type: "document" });
  }

  relations(): ViewRelation[] {
    const ids = this.viewIds();
    const out: ViewRelation[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const ra = viewRange(this.sync.getState(a));
        const rb = viewRange(this.sync.getState(b));
        const kind = rangeRelation(ra, rb);
        const rel: ViewRelation = { a, b, kind };
        if (kind === "containing") {
          const aOuter = ra.from <= rb.from && ra.to >= rb.to && (ra.from < rb.from || ra.to > rb.to);
          rel.outer = aOuter ? a : b;
          rel.inner = aOuter ? b : a;
        }
        out.push(rel);
      }
    }
    return out;
  }

  apply(action: StructureAction): boolean {
    const plan = planStructureAction(this.document, this.treeState, this.schema, action);
    if (!plan.ok) return false;
    const before = this.document;
    this.hushTimeline = true;
    this.sync.applySession({
      changes: plan.changes,
      filter: false,
    });
    this.hushTimeline = false;
    this.timeline.pushText(plan.changes, invertChangeSet(before, plan.changes), {
      targetNodeId: plan.targetNodeId,
    });
    return true;
  }

  undo(): void {
    const entry = this.timeline.peek();
    const result = this.timeline.undo();
    if (!result) return;
    if (result.kind === "text") {
      this.hushTimeline = true;
      const ok = cmUndo({
        state: this.sync.state,
        dispatch: (tr) => this.sync.acceptSession(tr),
      });
      if (!ok) this.sync.applySession({ changes: result.changes, filter: false });
      this.hushTimeline = false;
      this.reveal(entry && entry.kind === "text" ? entry.targetNodeId : undefined);
    } else if (entry && entry.kind === "foreign") {
      entry.command.reveal?.();
    }
  }

  redo(): void {
    const result = this.timeline.redo();
    if (!result) return;
    if (result.kind === "text") {
      this.hushTimeline = true;
      const ok = cmRedo({
        state: this.sync.state,
        dispatch: (tr) => this.sync.acceptSession(tr),
      });
      if (!ok) this.sync.applySession({ changes: result.changes, filter: false });
      this.hushTimeline = false;
    }
  }

  replaceDocument(doc: string): void {
    const mounted = new Map<string, HTMLElement>();
    for (const slot of this.views.values()) {
      const ev = this.sync.editorView(slot.id);
      if (ev?.dom.parentElement) mounted.set(slot.id, ev.dom.parentElement);
      this.sync.unmount(slot.id);
      this.sync.removeView(slot.id);
    }
    this.sync.replaceDocument(doc);
    this.treeState = projectTree(doc, this.schema);
    this.timeline.clear();
    this.tracked.invalidateAll();
    this.dirty.clear();
    this.dirty.markPersisted(doc, this.treeState);
    for (const slot of this.views.values()) {
      slot.lostNotified = false;
      this.installView(slot, this.restoreRange(slot.scope, slot.id === this.focused));
      const parent = mounted.get(slot.id);
      if (parent) this.sync.mount(slot.id, parent);
    }
    this.emit({ type: "document" });
    this.emit({ type: "tree" });
  }

  createView(opts: CreateViewOptions = {}): ViewHandle {
    const id = `view-${this.nextView++}`;
    let scope: ViewScope;
    let presentation: Presentation = opts.presentation ?? "source";
    let grain = opts.grain ?? this.defaultGrain();
    let caretAt: TrackedPositionId;
    let scrollAt: TrackedPositionId;
    let handedOut = false;

    let ancestry: string[] = [];
    if (opts.state) {
      const saved = (opts.state.findState ?? {}) as { ancestry?: string[] };
      ancestry = saved.ancestry ?? [];
      const restored = this.restoreClosedScope(opts.state.scope, ancestry);
      scope = restored.scope;
      ancestry = ancestryOf(this.treeState, scope.nodeId);
      presentation = opts.state.presentation;
      grain = opts.state.grain;
      caretAt = opts.state.caretAt;
      scrollAt = opts.state.scrollAt;
      handedOut = true;
    } else {
      const nodeId = opts.scope?.nodeId ?? this.treeState.roots[0] ?? "";
      scope = { nodeId, include: opts.scope?.include ?? "subtree" };
      const range = renderRangeOf(this.treeState, scope) ?? { from: 0, to: this.document.length };
      caretAt = this.tracked.create({
        from: firstProse(this.document, range, this.treeState, scope.nodeId),
        to: firstProse(this.document, range, this.treeState, scope.nodeId),
      });
      scrollAt = this.tracked.create({ from: range.from, to: range.from });
      ancestry = ancestryOf(this.treeState, scope.nodeId);
    }

    const slot: ViewSlot = {
      id,
      scope,
      presentation,
      grain,
      visibleNode: scope.nodeId || null,
      lastScrollCause: null,
      caretAt,
      scrollAt,
      handedOut,
      lostNotified: false,
      ancestry,
      rangeField: createScopeRangeField({ from: 0, to: 0, lost: false }),
      compartment: new Compartment(),
      handle: this.makeHandle(id),
    };
    this.views.set(id, slot);
    const caret = this.caretForOpen(slot);
    this.installView(slot, caret);
    if (!this.focused) this.focused = id;
    this.emit({ type: "views" });
    return slot.handle;
  }

  dispatch(id: string, specs: Parameters<SyncEngine["dispatchSpecs"]>[1]): void {
    this.sync.dispatchSpecs(id, specs);
  }

  lastScrollCause(id: string): string | null {
    return this.views.get(id)?.lastScrollCause ?? null;
  }

  excerpt(id: string): string {
    const state = this.sync.getState(id);
    const r = viewRange(state);
    if (r.lost) return "";
    return state.doc.sliceString(r.from, r.to);
  }

  scopeRangeOf(id: string): ScopeRange {
    return viewRange(this.sync.getState(id));
  }

  selectionHead(id: string): number {
    return this.sync.getState(id).selection.main.head;
  }

  scopeOf(id: string): ViewScope {
    return { ...this.requireSlot(id).scope };
  }

  private defaultGrain(): number {
    return Math.max(0, ...this.schema.levels.map((l) => l.rank));
  }

  private restoreClosedScope(scope: ViewScope, ancestry: string[]): { scope: ViewScope; fallback: boolean } {
    if (this.treeState.nodes.has(scope.nodeId)) return { scope, fallback: false };
    const ancestor = survivingAncestor(this.treeState, scope.nodeId, ancestry);
    return {
      scope: { nodeId: ancestor ?? scope.nodeId, include: scope.include },
      fallback: true,
    };
  }

  private restoreRange(scope: ViewScope, v5: boolean): EditorSelection | undefined {
    const range = renderRangeOf(this.treeState, scope) ?? { from: 0, to: this.document.length };
    const pos = v5 ? firstProse(this.document, range, this.treeState, scope.nodeId) : range.from;
    return EditorSelection.single(pos);
  }

  private caretForOpen(slot: ViewSlot): EditorSelection {
    const rec = this.tracked.get(slot.caretAt);
    const range = renderRangeOf(this.treeState, slot.scope) ?? { from: 0, to: this.document.length };
    if (rec?.valid) {
      const p = Math.min(Math.max(rec.from, range.from), range.to > range.from ? range.to - 1 : range.to);
      return EditorSelection.single(p);
    }
    return EditorSelection.single(firstProse(this.document, range, this.treeState, slot.scope.nodeId));
  }

  private chrome(slot: ViewSlot) {
    const hide =
      slot.presentation === "wysiwyg"
        ? [wysiwygDecorationField(slot.rangeField), wysiwygAtomField(slot.rangeField), wysiwygGuards()]
        : [hideOutsideField(slot.rangeField)];
    return [...hide, grainField(slot.rangeField, this.schema, slot.grain)];
  }

  private installView(slot: ViewSlot, selection?: EditorSelection): void {
    const range = renderRangeOf(this.treeState, slot.scope) ?? { from: 0, to: this.document.length };
    slot.rangeField = createScopeRangeField({ from: range.from, to: range.to, lost: false });
    slot.compartment = new Compartment();
    const extensions = [
      slot.rangeField,
      scopeFence(slot.rangeField),
      scopeCopyHandler(slot.rangeField),
      slot.compartment.of(this.chrome(slot)),
    ];
    this.sync.addView(slot.id, extensions, slot.compartment, selection);
  }

  private rebindScope(slot: ViewSlot, scope: ViewScope): void {
    slot.scope = scope;
    slot.ancestry = ancestryOf(this.treeState, scope.nodeId);
    slot.lostNotified = false;
    const range = renderRangeOf(this.treeState, scope) ?? { from: 0, to: this.document.length };
    this.sync.dispatchSpecs(slot.id, [
      {
        effects: setScopeRange.of({ from: range.from, to: range.to, lost: false }),
        filter: false,
        annotations: [Transaction.addToHistory.of(false)],
      },
    ]);
  }

  private refreshChrome(slot: ViewSlot): void {
    this.sync.reconfigure(slot.id, this.chrome(slot));
  }

  private makeHandle(id: string): ViewHandle {
    const session = this;
    return {
      get id() {
        return id;
      },
      mount(el: HTMLElement) {
        const ev = session.sync.mount(id, el);
        const slot = session.requireSlot(id);
        const scroll = session.tracked.get(slot.scrollAt);
        if (scroll?.valid) {
          slot.lastScrollCause = "restore";
          scrollToPos(ev, scroll.from, "restore");
        }
        session.scheduleMeasure();
      },
      destroy() {
        const slot = session.views.get(id);
        if (!slot) return;
        session.sync.unmount(id);
        session.sync.removeView(id);
        if (!slot.handedOut) {
          session.tracked.release(slot.caretAt);
          session.tracked.release(slot.scrollAt);
        }
        session.views.delete(id);
        if (session.focused === id) session.focused = session.viewIds()[0] ?? null;
        session.emit({ type: "views" });
      },
      getState() {
        const slot = session.requireSlot(id);
        slot.handedOut = true;
        const state = session.sync.getState(id);
        const sel = state.selection.main.head;
        const rec = session.tracked.get(slot.caretAt);
        if (rec) {
          rec.from = sel;
          rec.to = sel;
        }
        const ev = session.sync.editorView(id);
        if (ev) session.captureScroll(slot, ev);
        return {
          scope: { ...slot.scope },
          presentation: slot.presentation,
          grain: slot.grain,
          scrollAt: slot.scrollAt,
          caretAt: slot.caretAt,
          findState: { ancestry: slot.ancestry },
        };
      },
      setScope(nodeId: string, opts?: { include?: IncludeMode }) {
        const slot = session.requireSlot(id);
        session.rebindScope(slot, { nodeId, include: opts?.include ?? slot.scope.include });
        session.emit({ type: "views" });
      },
      setPresentation(p: Presentation) {
        const slot = session.requireSlot(id);
        slot.presentation = p;
        const ev = session.sync.editorView(id);
        const pos = ev ? readingLinePos(ev) : session.tracked.get(slot.scrollAt)?.from;
        if (ev) session.captureScroll(slot, ev);
        session.refreshChrome(slot);
        const again = session.sync.editorView(id);
        if (again && pos != null) {
          slot.lastScrollCause = "presentation";
          scrollToPos(again, pos, "presentation");
        }
        session.emit({ type: "views" });
      },
      setGrain(rank: number) {
        const slot = session.requireSlot(id);
        slot.grain = rank;
        session.refreshChrome(slot);
        session.emit({ type: "views" });
      },
      navigateTo(nodeId: string) {
        const slot = session.requireSlot(id);
        const range = viewRange(session.sync.getState(id));
        const node = getNode(session.treeState, nodeId);
        if (!node) return;
        const inside = node.subtreeRange.from >= range.from && node.subtreeRange.to <= range.to;
        if (nodeId === slot.scope.nodeId || inside) {
          this.scrollToNode(nodeId, "navigate");
          return;
        }
        this.setScope(nodeId, { include: slot.scope.include });
        this.scrollToNode(nodeId, "navigate");
      },
      scrollToNode(nodeId: string, cause: string) {
        const node = getNode(session.treeState, nodeId);
        if (!node) return;
        const slot = session.requireSlot(id);
        slot.lastScrollCause = cause;
        const ev = session.sync.editorView(id);
        if (!ev) return;
        scrollToPos(ev, node.subtreeRange.from, cause);
        session.scheduleMeasure();
      },
      get visibleNode() {
        return session.views.get(id)?.visibleNode ?? null;
      },
      find() {
        return [];
      },
      replace() {},
      replaceAll() {
        return { prose: 0, metadata: 0 };
      },
      focus() {
        session.focused = id;
        session.sync.editorView(id)?.focus();
        session.emit({ type: "focus" });
      },
      editorView() {
        return session.sync.editorView(id);
      },
    };
  }

  private requireSlot(id: string): ViewSlot {
    const slot = this.views.get(id);
    if (!slot) throw new Error(`unknown view ${id}`);
    return slot;
  }

  private reveal(nodeId?: string): void {
    if (!nodeId || !this.focused) return;
    const handle = this.views.get(this.focused)?.handle;
    const node = getNode(this.treeState, nodeId);
    if (!handle || !node) return;
    const range = viewRange(this.sync.getState(this.focused));
    const inside = node.subtreeRange.from >= range.from && node.subtreeRange.to <= range.to;
    if (!inside) handle.setScope(nodeId);
    handle.scrollToNode(nodeId, "undo");
  }

  private emitScopeLost(): void {
    for (const slot of this.views.values()) {
      const range = viewRange(this.sync.getState(slot.id));
      if (!range.lost || slot.lostNotified) continue;
      slot.lostNotified = true;
      this.emit({ type: "scopeLost", viewId: slot.id });
    }
  }

  private scheduleMeasure(): void {
    if (this.measurePending || this.measuring) return;
    if (typeof requestAnimationFrame !== "function") {
      this.measureVisible();
      return;
    }
    this.measurePending = true;
    requestAnimationFrame(() => {
      this.measurePending = false;
      this.measureVisible();
    });
  }

  private captureScroll(slot: ViewSlot, ev: EditorView): void {
    const rec = this.tracked.get(slot.scrollAt);
    if (!rec) return;
    const pos = readingLinePos(ev);
    rec.from = pos;
    rec.to = pos;
  }

  private measureVisible(): void {
    if (this.sync.isApplying) this.layoutDuringUpdate += 1;
    this.measuring = true;
    try {
      for (const slot of this.views.values()) {
        const ev = this.sync.editorView(slot.id);
        if (!ev) continue;
        slot.visibleNode = visibleNodeFromView(ev, this.treeState);
        this.captureScroll(slot, ev);
      }
    } finally {
      this.measuring = false;
    }
  }

  private emit(e: SessionEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}

export function createSession(opts: CreateSessionOptions): Session {
  return new Session(opts);
}

export { nodeAtPosition };
