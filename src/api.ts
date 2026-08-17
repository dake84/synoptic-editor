/**
 * Public API types (SPEC.md § 12). Hosts import these from the package root.
 * Runtime extras on the Session class are not part of this contract.
 */

import type { Extension } from "@codemirror/state";
import type { InlineRefStyle } from "./core/chips.js";
import type { SearchHit, SearchHitClass } from "./core/search.js";
import type { StructureAction } from "./core/structure.js";
import type { ForeignTimelineCommand } from "./core/timeline.js";
import type { ResolvedTrackedPosition, TrackedPositionId } from "./core/tracked-position.js";
import type { Range, StructureSchema, Tree } from "./core/types.js";
import type { PluginContribution } from "./view/plugin-registry.js";
import type { IncludeMode, Presentation } from "./view/presentation.js";

export type { Range, StructureLevel, StructureSchema, Tree, TreeNode } from "./core/types.js";
export type { SearchHit, SearchHitClass } from "./core/search.js";
export type { StructureAction } from "./core/structure.js";
export type { TrackedPositionId, ResolvedTrackedPosition } from "./core/tracked-position.js";
export type { IncludeMode, Presentation } from "./view/presentation.js";
export type { ForeignTimelineCommand } from "./core/timeline.js";
export type { InlineRefStyle } from "./core/chips.js";
export type { PluginContribution, PluginSlot } from "./view/plugin-registry.js";

export interface Policy {
  structureEditingInWysiwyg?: "locked" | "allowed";
  /**
   * `inline` (default): heading title stays editable (L4).
   * `locked`: schema heading + YAML fence are one atomic unit (LH1–LH3).
   */
  headingEditingInWysiwyg?: "inline" | "locked";
  frontmatterInWysiwyg?: "form" | "hidden";
  pillFields?: string[];
  inlineRefStyle?: InlineRefStyle;
}

/** Host-facing timeline (U9–U13). Text undo goes through `session.undo` (I3). */
export interface Timeline {
  readonly depth: number;
  pushForeign(command: ForeignTimelineCommand): void;
}

export interface CreateSessionOptions {
  doc: string;
  schema: StructureSchema;
  policy?: Policy;
  timeline?: Timeline;
  strings?: Record<string, string>;
}

export interface ViewScope {
  nodeId: string;
  include: IncludeMode;
}

export interface ViewRestoreState {
  scope: ViewScope;
  presentation: Presentation;
  grain: number;
  /** Whether the scope node's ATX heading is reader-visible in wysiwyg (SNH1). */
  showNodeHeading: boolean;
  scrollAt: TrackedPositionId;
  caretAt: TrackedPositionId;
  findState: unknown;
}

export interface CreateViewOptions {
  scope?: { nodeId: string; include?: IncludeMode };
  presentation?: Presentation;
  grain?: number;
  /**
   * When false in wysiwyg, hide the scope node's ATX heading (host pin owns the
   * title). Default true. No effect in source (SNH1–SNH4).
   */
  showNodeHeading?: boolean;
  state?: ViewRestoreState;
  /**
   * Named host plugins (ADR 0015). Slots: markdown, autocomplete, lint, keymap,
   * source, wysiwyg. Must not add `history()` or bind undo/redo to the view
   * state; must not use `scrollIntoView` as navigation (I1, I3, I4).
   */
  plugins?: PluginContribution[];
  /**
   * @deprecated Prefer `plugins`. Raw bags kept during host migration only.
   */
  extensions?: Extension[];
  /** @deprecated Prefer `plugins` with slot source/wysiwyg. */
  presentationExtensions?: Partial<Record<Presentation, Extension[]>>;
}

export interface ReadNode {
  id: string;
  title: string;
  text: string;
}

export interface ReplaceAllResult {
  prose: number;
  metadata: number;
  rejected?: number;
}

export type SessionEvent =
  | { type: "document" }
  | { type: "tree" }
  | { type: "views" }
  | { type: "focus"; viewId: string }
  | { type: "visible" }
  | { type: "tracked"; id: TrackedPositionId }
  | { type: "scopeLost"; viewId: string };

/** Box relative to `scrollPort`, including scroll offset (SPEC § 12.1 G4). */
export type CoordRect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export interface ViewHandle {
  readonly id: string;
  mount(el: HTMLElement): void;
  destroy(): void;
  getState(): ViewRestoreState;
  setScope(nodeId: string, opts?: { include?: IncludeMode }): void;
  setPresentation(p: Presentation): void;
  setGrain(rank: number): void;
  /** Toggle scope-heading visibility in wysiwyg (SNH3). No remount. */
  setShowNodeHeading(show: boolean): void;
  navigateTo(nodeId: string): void;
  scrollToNode(nodeId: string, cause: string): void;
  /** Scroll a document range into view. `cause` is required (I4). */
  reveal(from: number, to: number, cause: string): void;
  /**
   * Replace named host plugins (same rules as `createView`). Reconfigures
   * chrome; does not remount or clear history (I3/U8).
   */
  setPlugins(plugins: PluginContribution[]): void;
  /**
   * @deprecated Prefer `setPlugins`.
   */
  setExtensions(
    extensions: Extension[],
    presentationExtensions?: Partial<Record<Presentation, Extension[]>>,
  ): void;
  /**
   * Range box relative to `scrollPort` (SPEC G4). Null when unmounted or layout
   * unavailable (G6). Do not call during EditorView.update (G7 / T13).
   */
  coords(from: number, to: number): CoordRect | null;
  /** Scroll owner element (I4), or null when unmounted (G5 / G6). */
  readonly scrollPort: HTMLElement | null;
  readonly visibleNode: string | null;
  find(query: string, opts: { mode: "view" | "document"; activate?: boolean }): SearchHit[];
  findNext(): SearchHit | null;
  findPrev(): SearchHit | null;
  replace(hitId: string, text: string): void;
  replaceAll(text: string, opts?: { classes?: SearchHitClass[] }): ReplaceAllResult;
  focus(): void;
}

/** Session contract (SPEC.md § 12). */
export interface Session {
  readonly document: string;
  readonly tree: Tree;
  readNodes(ids: string[]): ReadNode[];
  createTrackedPosition(range: Range): TrackedPositionId;
  release(id: TrackedPositionId): void;
  resolve(id: TrackedPositionId): ResolvedTrackedPosition | undefined;
  readonly activeNode: string | null;
  readonly visibleNode: string | null;
  readonly focusedViewId: string | null;
  readonly timelineDepth: number;
  readonly redoDepth: number;
  view(id: string): ViewHandle | undefined;
  isDirty(nodeId: string): boolean;
  isSubtreeDirty(nodeId: string): boolean;
  undo(): void;
  redo(): void;
  apply(action: StructureAction): boolean;
  markPersisted(nodeId?: string): void;
  replaceDocument(doc: string): void;
  subscribe(fn: (e: SessionEvent) => void): () => void;
  createView(opts?: CreateViewOptions): ViewHandle;
}
