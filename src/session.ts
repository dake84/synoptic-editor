/**
 * Session: one document, one timeline, many views (SPEC.md § 3, § 7.3, § 11, § 12).
 */

import { EditorSelection, EditorState, Transaction, type ChangeSet, type Extension, type Text } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import { undo as cmUndo, redo as cmRedo, undoDepth } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import { DirtyState } from "./core/dirty.js";
import { invertChangeSet, makeChangeSet } from "./core/document.js";
import { planFieldWrite, wouldBreakYamlValue } from "./core/frontmatter.js";
import {
  findInDocument,
  planReplaceAll,
  type SearchHit,
  type SearchHitClass,
} from "./core/search.js";
import { planStructureAction, type StructureAction } from "./core/structure.js";
import { createTimeline, type Timeline as TimelineImpl } from "./core/timeline.js";
import {
  createTrackedPositionRegistry,
  type TrackedPositionId,
  type TrackedPositionRegistry,
} from "./core/tracked-position.js";
import { getNode, nodeAtPosition, projectTree } from "./core/tree.js";
import type { Range, StructureSchema, Tree } from "./core/types.js";
import { createSync, type SyncEngine, type ViewId } from "./sync/index.js";
import {
  findHighlightField,
  findQueryField,
  findStepFacet,
  findStepKeymap,
  setFindHighlights,
  setFindQuery,
} from "./view/find-decorations.js";
import { headingUnitGuards } from "./view/guards/heading-units.js";
import { parkSelectionInState } from "./view/guards/park-selection.js";
import { frontmatterLockFilter, wysiwygGuards } from "./view/guards/wysiwyg.js";
import {
  headingStampField,
  hideOutsideField,
  wysiwygAtomField,
  wysiwygDecorationField,
  type IncludeMode,
  type Presentation,
} from "./view/presentation.js";
import { pluginsToExtensionBags, type PluginContribution } from "./view/plugin-registry.js";
import { coordsRelativeToScrollPort, readingLinePos, scrollCause, scrollToPos, visibleNodeFromView } from "./view/scroll.js";
import {
  createScopeRangeField,
  rangeRelation,
  scopeCopyHandler,
  scopeFence,
  setScopeRange,
  viewRange,
  type ScopeRange,
} from "./view/scope.js";
import { chipAtomField, chipDecorationField } from "./view/widgets/chips.js";
import {
  frontmatterAtomField,
  frontmatterField,
  frontmatterWriteFacet,
} from "./view/widgets/form.js";
import { pillField } from "./view/widgets/pills.js";
import type {
  CreateSessionOptions,
  CreateViewOptions,
  Policy,
  Session as PublicSession,
  SessionEvent,
} from "./api.js";
import type { InlineRefStyle } from "./core/chips.js";
import type { ViewHandle, ViewScope } from "./view-handle.js";

export type { CreateSessionOptions, CreateViewOptions, Policy, SessionEvent };

export interface ResolvedPolicy {
  structureEditingInWysiwyg: "locked" | "allowed";
  headingEditingInWysiwyg: "inline" | "locked";
  frontmatterInWysiwyg: "form" | "hidden";
  pillFields: string[];
  inlineRefStyle: InlineRefStyle;
}

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
  showNodeHeading: boolean;
  visibleNode: string | null;
  lastScrollCause: string | null;
  caretAt: TrackedPositionId;
  scrollAt: TrackedPositionId;
  handedOut: boolean;
  lostNotified: boolean;
  ancestry: string[];
  findHits: SearchHit[];
  findQuery: string;
  findMode: "view" | "document";
  findMatch: { caseSensitive: boolean; regex: boolean };
  findActive: number;
  rangeField: ReturnType<typeof createScopeRangeField>;
  compartment: Compartment;
  hostExtensions: Extension[];
  presentationExtensions: Partial<Record<Presentation, Extension[]>>;
  handle: ViewHandle;
  scrollFrozen: boolean;
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

export class Session implements PublicSession {
  readonly schema: StructureSchema;
  readonly policy: ResolvedPolicy;
  private readonly sync: SyncEngine;
  private readonly timeline: TimelineImpl;
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
      headingEditingInWysiwyg: opts.policy?.headingEditingInWysiwyg ?? "inline",
      frontmatterInWysiwyg: opts.policy?.frontmatterInWysiwyg ?? "form",
      pillFields: opts.policy?.pillFields ?? [],
      inlineRefStyle: opts.policy?.inlineRefStyle ?? "attribute-block",
    };
    this.sync = createSync(opts.doc, { newGroupDelay: opts.newGroupDelay });
    this.timeline = createTimeline(opts.timeline as TimelineImpl | undefined);
    this.tracked = createTrackedPositionRegistry();
    this.treeState = projectTree(opts.doc, opts.schema);
    this.dirty.markPersisted(opts.doc, this.treeState);
    if (process.env.NODE_ENV !== "production") {
      Object.defineProperty(this, Symbol.for("synoptic.debug.inspectDirty"), {
        enumerable: false,
        value: () => this.dirty.inspect(this.document, this.treeState),
      });
    }
    this.tracked.onInvalidate((id) => this.emit({ type: "tracked", id }));
    this.sync.afterDocument = (changes, originId, docBefore, tr) => {
      this.tracked.mapThrough(changes);
      this.treeState = projectTree(this.sync.document, this.schema);
      if (
        !this.hushTimeline &&
        originId &&
        tr.annotation(Transaction.addToHistory) !== false
      ) {
        this.recordOriginText(changes, docBefore);
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

  get redoDepth(): number {
    return this.timeline.redoDepth;
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

  applyDocumentPatch(nextDoc: string, targetNodeId?: string): boolean {
    const before = this.document;
    if (before === nextDoc) return false;
    const changes = makeChangeSet(before.length, { from: 0, to: before.length, insert: nextDoc });
    this.hushTimeline = true;
    this.sync.applySession({
      changes,
      filter: false,
    });
    this.hushTimeline = false;
    this.timeline.pushText(changes, invertChangeSet(before, changes), {
      targetNodeId: targetNodeId ?? this.treeState.roots[0],
    });
    return true;
  }

  /** Origin typing: follow CM6 grouping so timeline text entries stay 1:1 with history (U15/U17). */
  private recordOriginText(changes: ChangeSet, docBefore: Text): void {
    const inverse = invertChangeSet(docBefore.toString(), changes);
    const last = this.timeline.peek();
    if (undoDepth(this.sync.state) === this.timeline.textDepth && last?.kind === "text") {
      this.timeline.composeLastText(changes, inverse);
      return;
    }
    let from = 0;
    let seen = false;
    changes.iterChanges((fromA) => {
      if (!seen) {
        from = fromA;
        seen = true;
      }
    });
    const target = nodeAtPosition(projectTree(docBefore.toString(), this.schema), from);
    this.timeline.pushText(changes, inverse, { targetNodeId: target?.id });
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
      if (!ok) {
        this.sync.applySession({
          changes: result.changes,
          filter: false,
          annotations: [Transaction.addToHistory.of(false)],
        });
      }
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
      if (!ok) {
        this.sync.applySession({
          changes: result.changes,
          filter: false,
          annotations: [Transaction.addToHistory.of(false)],
        });
      }
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
    let showNodeHeading = opts.showNodeHeading ?? true;
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
      showNodeHeading = opts.state.showNodeHeading ?? true;
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

    const fromPlugins = opts.plugins ? pluginsToExtensionBags(opts.plugins) : null;
    const slot: ViewSlot = {
      id,
      scope,
      presentation,
      showNodeHeading,
      visibleNode: scope.nodeId || null,
      lastScrollCause: null,
      caretAt,
      scrollAt,
      handedOut,
      lostNotified: false,
      ancestry,
      findHits: [],
      findQuery: "",
      findMode: "view",
      findMatch: { caseSensitive: false, regex: false },
      findActive: -1,
      rangeField: createScopeRangeField({ from: 0, to: 0, lost: false }),
      compartment: new Compartment(),
      hostExtensions: fromPlugins?.host ?? opts.extensions ?? [],
      presentationExtensions: fromPlugins?.presentation ?? opts.presentationExtensions ?? {},
      handle: this.makeHandle(id),
      scrollFrozen: false,
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
    const locked = this.policy.structureEditingInWysiwyg === "locked";
    const headingLocked = this.policy.headingEditingInWysiwyg === "locked";
    const host =
      slot.presentation === "wysiwyg"
        ? [...slot.hostExtensions, ...(slot.presentationExtensions.wysiwyg ?? [])]
        : [...slot.hostExtensions, ...(slot.presentationExtensions.source ?? [])];
    if (slot.presentation === "wysiwyg") {
      const hideOpts = {
        showNodeHeading: slot.showNodeHeading,
        scopeNodeId: slot.scope.nodeId,
        schema: this.schema,
      };
      return [
        wysiwygDecorationField(slot.rangeField, hideOpts),
        wysiwygAtomField(slot.rangeField, hideOpts),
        chipDecorationField(slot.rangeField, this.policy.inlineRefStyle),
        chipAtomField(slot.rangeField, this.policy.inlineRefStyle),
        frontmatterField(slot.rangeField, this.schema, this.policy.frontmatterInWysiwyg),
        frontmatterAtomField(slot.rangeField, this.schema),
        frontmatterLockFilter(this.schema, { headingEditingLocked: headingLocked }),
        pillField(slot.rangeField, this.schema, this.policy.pillFields),
        frontmatterWriteFacet.of({
          write: (blockFrom, key, value) => this.writeFrontmatterField(blockFrom, key, value),
        }),
        headingLocked
          ? headingUnitGuards(this.schema)
          : headingUnitGuards(this.schema, { editing: "inline" }),
        wysiwygGuards({
          structureLocked: locked,
          inlineRefStyle: this.policy.inlineRefStyle,
          schema: this.schema,
          headingEditingLocked: headingLocked,
        }),
        headingStampField(
          slot.rangeField,
          this.schema,
          this.treeState.nodes.get(slot.scope.nodeId)?.rank ?? 0,
          hideOpts,
        ),
        ...host,
      ];
    }
    return [
      hideOutsideField(slot.rangeField),
      headingStampField(
        slot.rangeField,
        this.schema,
        this.treeState.nodes.get(slot.scope.nodeId)?.rank ?? 0,
      ),
      ...host,
    ];
  }

  /** Form / API path (L5): writes YAML via one ChangeSet (FM3). */
  writeFrontmatterField(blockFrom: number, key: string, value: string | null): boolean {
    const node = [...this.treeState.nodes.values()].find((n) => n.frontmatter?.from === blockFrom);
    if (!node?.frontmatter) return false;
    const plan = planFieldWrite(this.document, node.frontmatter, key, value);
    if (!plan) return false;
    this.hushTimeline = true;
    const before = this.document;
    const changes = this.sync.applySession({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      filter: false,
    });
    this.hushTimeline = false;
    if (!changes.empty) {
      this.timeline.pushText(changes, invertChangeSet(before, changes), { targetNodeId: node.id });
    }
    // Decorations (form/pills) follow docChanged — no chrome reconfigure (keeps form focus).
    return true;
  }

  private installView(slot: ViewSlot, selection?: EditorSelection): void {
    const range = renderRangeOf(this.treeState, slot.scope) ?? { from: 0, to: this.document.length };
    slot.rangeField = createScopeRangeField({ from: range.from, to: range.to, lost: false });
    slot.compartment = new Compartment();
    const extensions = [
      slot.rangeField,
      scopeFence(slot.rangeField),
      scopeCopyHandler(slot.rangeField),
      findQueryField,
      findHighlightField,
      findStepKeymap(),
      findStepFacet.of({
        next: () => this.stepFind(slot.id, 1) != null,
        prev: () => this.stepFind(slot.id, -1) != null,
      }),
      keymap.of([
        {
          key: "Mod-z",
          preventDefault: true,
          run: () => {
            this.undo();
            return true;
          },
        },
        {
          key: "Mod-y",
          preventDefault: true,
          run: () => {
            this.redo();
            return true;
          },
        },
        {
          key: "Mod-Shift-z",
          preventDefault: true,
          run: () => {
            this.redo();
            return true;
          },
        },
      ]),
      slot.compartment.of(this.chrome(slot)),
    ];
    this.sync.addView(slot.id, extensions, slot.compartment, selection);
  }

  private rebindScope(slot: ViewSlot, scope: ViewScope): void {
    const sameBinding =
      slot.scope.nodeId === scope.nodeId && slot.scope.include === scope.include;
    slot.scope = scope;
    slot.ancestry = ancestryOf(this.treeState, scope.nodeId);
    slot.lostNotified = false;
    if (!sameBinding) {
      const range = renderRangeOf(this.treeState, scope) ?? { from: 0, to: this.document.length };
      this.sync.dispatchSpecs(slot.id, [
        {
          effects: setScopeRange.of({ from: range.from, to: range.to, lost: false }),
          filter: false,
          annotations: [Transaction.addToHistory.of(false)],
        },
      ]);
    }
    // Scope heading hide targets the new node (SNH3). Same-node rebind keeps
    // the sticky ScopeRange (EX6) instead of shrinking to a fresh subtreeRange.
    this.refreshChrome(slot);
  }

  private refreshChrome(slot: ViewSlot): void {
    const park =
      slot.presentation === "wysiwyg"
        ? (state: EditorState) =>
            parkSelectionInState(state, {
              inlineRefStyle: this.policy.inlineRefStyle,
              schema: this.schema,
            })
        : undefined;
    this.sync.reconfigure(slot.id, this.chrome(slot), park);
  }

  private makeHandle(id: string): ViewHandle {
    return Session.viewHandle(this, id);
  }

  /** Handle closes over Session; method `this` would be the handle (no-this-alias). */
  private static viewHandle(session: Session, id: string): ViewHandle {
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
        ev.scrollDOM.addEventListener("scroll", () => session.scheduleMeasure());
        // Editor / form focus updates session focus (T22); find/replace use focused view (F1).
        ev.dom.addEventListener("focusin", () => {
          if (session.focused === id) return;
          session.focused = id;
          session.emit({ type: "focus", viewId: id });
        });
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
          showNodeHeading: slot.showNodeHeading,
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
        const ev = session.sync.editorView(id);
        const presentationChanged = slot.presentation !== p;
        const pos = slot.scrollFrozen
          ? session.tracked.get(slot.scrollAt)?.from
          : ev
            ? readingLinePos(ev, viewRange(ev.state))
            : session.tracked.get(slot.scrollAt)?.from;
        if (ev && !slot.scrollFrozen) session.captureScroll(slot, ev);
        slot.presentation = p;
        if (slot.scrollFrozen || presentationChanged) {
          session.refreshChrome(slot);
        }
        const again = session.sync.editorView(id);
        if (again && pos != null && (slot.scrollFrozen || presentationChanged)) {
          slot.lastScrollCause = "presentation";
          scrollToPos(again, pos, "presentation");
        }
        slot.scrollFrozen = false;
        session.emit({ type: "views" });
      },
      freezeScrollAnchor() {
        const slot = session.requireSlot(id);
        const ev = session.sync.editorView(id);
        if (ev) session.captureScroll(slot, ev);
        slot.scrollFrozen = true;
      },
      setShowNodeHeading(show: boolean) {
        const slot = session.requireSlot(id);
        if (slot.showNodeHeading === show) return;
        slot.showNodeHeading = show;
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
      reveal(from: number, to: number, cause: string) {
        const slot = session.requireSlot(id);
        slot.lastScrollCause = cause;
        const node = nodeAtPosition(session.treeState, from);
        if (node) {
          const range = viewRange(session.sync.getState(id));
          const inside = node.subtreeRange.from >= range.from && node.subtreeRange.to <= range.to;
          if (!inside) {
            this.setScope(node.id, { include: slot.scope.include });
          }
        }
        const ev = session.sync.editorView(id);
        if (!ev) return;
        const head = Math.max(0, Math.min(from, ev.state.doc.length));
        const anchor = Math.max(head, Math.min(to, ev.state.doc.length));
        ev.dispatch({
          effects: EditorView.scrollIntoView(EditorSelection.range(head, anchor), { y: "nearest" }),
          annotations: [scrollCause.of(cause), Transaction.addToHistory.of(false)],
        });
        session.scheduleMeasure();
      },
      setPlugins(plugins: PluginContribution[]) {
        const bags = pluginsToExtensionBags(plugins);
        const slot = session.requireSlot(id);
        slot.hostExtensions = bags.host;
        slot.presentationExtensions = bags.presentation;
        if (!slot.scrollFrozen) session.refreshChrome(slot);
      },
      setExtensions(extensions, presentationExtensions) {
        const slot = session.requireSlot(id);
        slot.hostExtensions = extensions;
        if (presentationExtensions) slot.presentationExtensions = presentationExtensions;
        if (!slot.scrollFrozen) session.refreshChrome(slot);
      },
      coords(from: number, to: number) {
        const ev = session.sync.editorView(id);
        if (!ev) return null;
        return coordsRelativeToScrollPort(ev, from, to);
      },
      get scrollPort() {
        return session.sync.editorView(id)?.scrollDOM ?? null;
      },
      get visibleNode() {
        return session.views.get(id)?.visibleNode ?? null;
      },
      find(query: string, opts: { mode: "view" | "document"; activate?: boolean; caseSensitive?: boolean; regex?: boolean }) {
        const slot = session.requireSlot(id);
        const range =
          opts.mode === "view"
            ? viewRange(session.sync.getState(id))
            : { from: 0, to: session.document.length, lost: false };
        const caseSensitive = Boolean(opts.caseSensitive);
        const regex = Boolean(opts.regex);
        const hits = findInDocument(session.document, {
          query,
          range: { from: range.from, to: range.to },
          presentation: slot.presentation,
          schema: session.schema,
          pillFields: session.policy.pillFields,
          inlineRefStyle: session.policy.inlineRefStyle,
          tree: session.treeState,
          hideHeadingNodeId:
            slot.presentation === "wysiwyg" && !slot.showNodeHeading ? slot.scope.nodeId : undefined,
          caseSensitive,
          regex,
        });
        slot.findHits = hits;
        slot.findQuery = query;
        slot.findMode = opts.mode;
        slot.findMatch = { caseSensitive, regex };
        const activate = opts.activate !== false;
        slot.findActive = hits.length > 0 && activate ? 0 : -1;
        if (activate) {
          session.activateFindHit(id);
        } else {
          session.paintFindHits(id);
        }
        return hits;
      },
      findNext() {
        return session.stepFind(id, 1);
      },
      findPrev() {
        return session.stepFind(id, -1);
      },
      get findIndex() {
        return session.views.get(id)?.findActive ?? -1;
      },
      get findCount() {
        return session.views.get(id)?.findHits.length ?? 0;
      },
      replace(hitId: string, text: string) {
        const slot = session.requireSlot(id);
        const hit = slot.findHits.find((h) => h.id === hitId);
        if (!hit) return;
        if (hit.class === "metadata" && wouldBreakYamlValue(text)) return;
        session.hushTimeline = true;
        const before = session.document;
        const changes = session.sync.applySession({
          changes: { from: hit.from, to: hit.to, insert: text },
          filter: false,
        });
        session.hushTimeline = false;
        if (!changes.empty) {
          const target = nodeAtPosition(projectTree(before, session.schema), hit.from);
          session.timeline.pushText(changes, invertChangeSet(before, changes), {
            targetNodeId: target?.id,
          });
        }
        slot.findHits = slot.findHits.filter((h) => h.id !== hitId);
        if (slot.findActive >= slot.findHits.length) slot.findActive = slot.findHits.length - 1;
      },
      replaceAll(text: string, opts?: { classes?: string[] }) {
        const slot = session.requireSlot(id);
        const classes = (opts?.classes ?? ["prose"]) as SearchHitClass[];
        const plan = planReplaceAll(session.document, slot.findHits, text, classes, (hit, replacement) => {
          if (hit.class !== "metadata") return true;
          return !wouldBreakYamlValue(replacement);
        });
        if (plan.changes.length === 0) {
          return { prose: plan.prose, metadata: plan.metadata, rejected: plan.rejected };
        }
        session.hushTimeline = true;
        const before = session.document;
        const changes = session.sync.applySession({
          changes: plan.changes,
          filter: false,
        });
        session.hushTimeline = false;
        if (!changes.empty) {
          let from = 0;
          let seen = false;
          changes.iterChanges((fromA) => {
            if (!seen) {
              from = fromA;
              seen = true;
            }
          });
          const target = nodeAtPosition(projectTree(before, session.schema), from);
          session.timeline.pushText(changes, invertChangeSet(before, changes), {
            targetNodeId: target?.id,
          });
        }
        slot.findHits = [];
        slot.findActive = -1;
        return { prose: plan.prose, metadata: plan.metadata, rejected: plan.rejected };
      },
      focus(opts?: { preventScroll?: boolean }) {
        session.focused = id;
        const ev = session.sync.editorView(id);
        if (opts?.preventScroll) ev?.contentDOM.focus({ preventScroll: true });
        else ev?.focus();
        session.emit({ type: "focus", viewId: id });
      },
      /** Test/harness only — not on the public ViewHandle (SPEC § 12). */
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

  /** Paint find marks without scrolling or moving the caret (host find bar while typing). */
  private paintFindHits(viewId: string): void {
    const slot = this.requireSlot(viewId);
    this.sync.dispatchSpecs(viewId, [
      {
        effects: [
          setFindQuery.of(slot.findQuery),
          setFindHighlights.of({
            hits: slot.findHits,
            active: slot.findActive,
            presentation: slot.presentation,
          }),
        ],
        annotations: [Transaction.addToHistory.of(false)],
      },
    ]);
  }

  /** F10: step active hit; wrap; reveal per the list's mode. */
  private stepFind(viewId: string, delta: 1 | -1): SearchHit | null {
    const slot = this.requireSlot(viewId);
    const n = slot.findHits.length;
    if (n === 0) return null;
    slot.findActive = slot.findActive < 0 ? 0 : (slot.findActive + delta + n) % n;
    this.activateFindHit(viewId);
    return slot.findHits[slot.findActive] ?? null;
  }

  private activateFindHit(viewId: string): void {
    const slot = this.requireSlot(viewId);
    const active = slot.findActive;
    const hits = slot.findHits;
    const activeHit = active >= 0 ? hits[active] ?? null : null;
    if (slot.findMode === "document" && activeHit) this.revealFindHit(viewId, activeHit);
    const effects = [
      setFindQuery.of(slot.findQuery),
      setFindHighlights.of({ hits, active, presentation: slot.presentation }),
    ];
    if (activeHit?.class === "prose") {
      const sel = EditorSelection.range(activeHit.from, activeHit.to);
      this.sync.dispatchSpecs(viewId, [
        {
          selection: sel,
          effects: [...effects, EditorView.scrollIntoView(sel, { y: "nearest" })],
          annotations: [scrollCause.of("find"), Transaction.addToHistory.of(false)],
        },
      ]);
    } else {
      this.sync.dispatchSpecs(viewId, [
        {
          effects,
          annotations: [scrollCause.of("find"), Transaction.addToHistory.of(false)],
        },
      ]);
      if (activeHit?.class === "metadata") this.scrollToMetadataHit(viewId, activeHit);
    }
    this.emit({ type: "views" });
  }

  /** Document-mode find: open the hit's node in this view when outside ScopeRange (F2/U5/T49). */
  private revealFindHit(viewId: string, hit: SearchHit): void {
    const node = nodeAtPosition(this.treeState, hit.from);
    if (!node) return;
    const range = viewRange(this.sync.getState(viewId));
    const inside = hit.from >= range.from && hit.to <= range.to;
    if (inside) return;
    const slot = this.views.get(viewId);
    slot?.handle.setScope(node.id, { include: slot.scope.include });
  }

  /** Metadata hits are painted on pills under the heading — scroll there, do not select YAML (P3). */
  private scrollToMetadataHit(viewId: string, hit: SearchHit): void {
    const node = [...this.treeState.nodes.values()].find(
      (n) => n.frontmatter && hit.from >= n.frontmatter.from && hit.to <= n.frontmatter.to,
    );
    const ev = this.sync.editorView(viewId);
    if (!node || !ev) return;
    scrollToPos(ev, node.heading.to, "find");
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
    if (slot.scrollFrozen) return;
    const rec = this.tracked.get(slot.scrollAt);
    if (!rec) return;
    const pos = readingLinePos(ev, viewRange(ev.state));
    rec.from = pos;
    rec.to = pos;
  }

  private measureVisible(): void {
    if (this.sync.isApplying) this.layoutDuringUpdate += 1;
    this.measuring = true;
    let changed = false;
    try {
      for (const slot of this.views.values()) {
        const ev = this.sync.editorView(slot.id);
        if (!ev) continue;
        const next = visibleNodeFromView(ev, this.treeState, viewRange(ev.state));
        if (next !== slot.visibleNode) changed = true;
        slot.visibleNode = next;
        this.captureScroll(slot, ev);
      }
    } finally {
      this.measuring = false;
    }
    if (changed) this.emit({ type: "visible" });
  }

  private emit(e: SessionEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}

export function createSession(opts: CreateSessionOptions): Session {
  return new Session(opts);
}
