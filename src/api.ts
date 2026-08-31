/**
 * Public API types (SPEC.md § 12). Hosts import these from the package root.
 * Runtime extras on the Session class are not part of this contract.
 */

import type { Extension } from "@codemirror/state";
import type { InlineRefStyle } from "./core/chips.js";
import type { SearchHit, SearchHitClass, FindMatchOptions } from "./core/search.js";
import type { StructureAction } from "./core/structure.js";
import type { ForeignTimelineCommand } from "./core/timeline.js";
import type { ResolvedTrackedPosition, TrackedPositionId } from "./core/tracked-position.js";
import type { Range, StructureSchema, Tree } from "./core/types.js";
import type { PluginContribution } from "./view/plugin-registry.js";
import type { IncludeMode, Presentation } from "./view/presentation.js";

export type { Range, StructureLevel, StructureSchema, Tree, TreeNode } from "./core/types.js";
export type { SearchHit, SearchHitClass, FindMatchOptions } from "./core/search.js";
export type { StructureAction } from "./core/structure.js";
export type { TrackedPositionId, ResolvedTrackedPosition } from "./core/tracked-position.js";
export type { IncludeMode, Presentation } from "./view/presentation.js";
export type { ForeignTimelineCommand } from "./core/timeline.js";
export type { InlineRefStyle } from "./core/chips.js";
export type { PluginContribution, PluginSlot } from "./view/plugin-registry.js";

/** Session policy for structure, headings, frontmatter, and chips (SPEC § 12). */
export interface Policy {
  /**
   * Whether structure edits are allowed in wysiwyg.
   *
   * @defaultValue "locked"
   */
  structureEditingInWysiwyg?: "locked" | "allowed";
  /**
   * `inline` (default): heading title stays editable (L4).
   * `locked`: schema heading + YAML fence are one atomic unit (LH1–LH3).
   *
   * @defaultValue "inline"
   */
  headingEditingInWysiwyg?: "inline" | "locked";
  /**
   * How YAML is shown in wysiwyg (`form` widgets vs fully hidden).
   *
   * @defaultValue "form"
   */
  frontmatterInWysiwyg?: "form" | "hidden";
  /** YAML keys rendered as pills and searchable as metadata in wysiwyg (P5). */
  pillFields?: string[];
  /** Chip syntax for inline refs (W6). */
  inlineRefStyle?: InlineRefStyle;
}

/** Host-facing timeline (U9–U13). Text undo goes through `session.undo` (I3). */
export interface Timeline {
  /** Number of undoable foreign commands currently on the stack. */
  readonly depth: number;
  /**
   * Push a host command onto the shared timeline.
   *
   * @param command - Undo/redo pair supplied by the host
   */
  pushForeign(command: ForeignTimelineCommand): void;
}

/** Options for {@link createSession}. */
export interface CreateSessionOptions {
  /** Full markdown document. */
  doc: string;
  /** Host structure schema. */
  schema: StructureSchema;
  /** Optional editing policy. */
  policy?: Policy;
  /** Shared project timeline; created internally when omitted. */
  timeline?: Timeline;
  /** Optional UI string overrides. */
  strings?: Record<string, string>;
  /**
   * Idle delay in milliseconds before adjacent typing starts a new undo group.
   * Passed through to CM6 `history({ newGroupDelay })`. Default 500.
   * The timeline follows that grouping (U15/U17) — hosts do not keep a second clock.
   *
   * @defaultValue 500
   */
  newGroupDelay?: number;
}

/** Scope of a view onto the document tree. */
export interface ViewScope {
  /** Node the view is pinned to. */
  nodeId: string;
  /** Own range vs full subtree. */
  include: IncludeMode;
}

/** Serializable view state for remount / restore. */
export interface ViewRestoreState {
  /** Current scope. */
  scope: ViewScope;
  /** source vs wysiwyg. */
  presentation: Presentation;
  /** Whether the scope node's ATX heading is reader-visible in wysiwyg (SNH1). */
  showNodeHeading: boolean;
  /** Tracked reading-line position. */
  scrollAt: TrackedPositionId;
  /** Tracked caret position. */
  caretAt: TrackedPositionId;
  /** Opaque find-panel state. */
  findState: unknown;
}

/** Options for {@link Session.createView}. */
export interface CreateViewOptions {
  /** Initial scope; defaults to the first tree root. */
  scope?: { nodeId: string; include?: IncludeMode };
  /**
   * Initial presentation.
   *
   * @defaultValue "source"
   */
  presentation?: Presentation;
  /**
   * When false in wysiwyg, hide the scope node's ATX heading (host pin owns the
   * title). Default true. No effect in source (SNH1–SNH4).
   */
  showNodeHeading?: boolean;
  state?: ViewRestoreState;
  /**
   * Named host plugins (SPEC § 12). Slots: markdown, autocomplete, lint, keymap,
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

/** Node payload returned by {@link Session.readNodes}. */
export interface ReadNode {
  /** Node id. */
  id: string;
  /** Heading title. */
  title: string;
  /** Body text for that node. */
  text: string;
}

/** Counts from {@link ViewHandle.replaceAll}. */
export interface ReplaceAllResult {
  /** Replacements in prose. */
  prose: number;
  /** Replacements in metadata. */
  metadata: number;
  /** Hits skipped (e.g. protected). */
  rejected?: number;
}

/** Session change notifications for {@link Session.subscribe}. */
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
  /** Top edge, CSS pixels. */
  top: number;
  /** Left edge, CSS pixels. */
  left: number;
  /** Bottom edge, CSS pixels. */
  bottom: number;
  /** Right edge, CSS pixels. */
  right: number;
};

/** Host handle for one mounted view. */
export interface ViewHandle {
  /** Stable view id. */
  readonly id: string;
  /**
   * Mount the editor into `el`.
   *
   * @param el - Host element
   */
  mount(el: HTMLElement): void;
  /** Tear down the view and release listeners. */
  destroy(): void;
  /**
   * Snapshot restore state.
   *
   * @returns Serializable view state
   */
  getState(): ViewRestoreState;
  /**
   * Pin the view to a node.
   *
   * @param nodeId - Target node
   * @param opts - Include mode; defaults to current / subtree
   */
  setScope(nodeId: string, opts?: { include?: IncludeMode }): void;
  /**
   * Switch source vs wysiwyg.
   *
   * @param p - Presentation
   */
  setPresentation(p: Presentation): void;
  /**
   * Capture the reading-line document offset into `scrollAt` and freeze it
   * until the next `setPresentation` (V11). Host CSS/plugin layout must not
   * run before this call.
   */
  freezeScrollAnchor(): void;
  /** Toggle scope-heading visibility in wysiwyg (SNH3). No remount. */
  setShowNodeHeading(show: boolean): void;
  /**
   * Navigate the view to a node (scope + scroll).
   *
   * @param nodeId - Target node
   */
  navigateTo(nodeId: string): void;
  /**
   * Scroll a node's heading into view.
   *
   * @param nodeId - Target node
   * @param cause - Named scroll cause (I4)
   */
  scrollToNode(nodeId: string, cause: string): void;
  /** Scroll a document range into view. `cause` is required (I4). */
  reveal(from: number, to: number, cause: string): void;
  /**
   * Replace named host plugins (same rules as `createView`). Reconfigures
   * chrome unless `scrollAt` is frozen pending `setPresentation` (V11).
   * Does not remount or clear history (I3/U8).
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
  /** Node currently at the reading line, or `null`. */
  readonly visibleNode: string | null;
  /**
   * Search in the view or the full document.
   *
   * @param query - Find query
   * @param opts - Mode, match flags, and whether to activate the first hit
   */
  find(
    query: string,
    opts: { mode: "view" | "document"; activate?: boolean } & FindMatchOptions,
  ): SearchHit[];
  /** Advance to the next find hit. */
  findNext(): SearchHit | null;
  /** Move to the previous find hit. */
  findPrev(): SearchHit | null;
  /**
   * Replace one hit.
   *
   * @param hitId - Hit from {@link ViewHandle.find}
   * @param text - Replacement
   */
  replace(hitId: string, text: string): void;
  /**
   * Replace all matching hits.
   *
   * @param text - Replacement
   * @param opts - Optional class filter
   */
  replaceAll(text: string, opts?: { classes?: SearchHitClass[] }): ReplaceAllResult;
  /**
   * Focus the view.
   *
   * @param opts - Pass `{ preventScroll: true }` to keep the scroll position
   */
  focus(opts?: { preventScroll?: boolean }): void;
}

/** Session contract (SPEC.md § 12). */
export interface Session {
  /** Current markdown document. */
  readonly document: string;
  /** Projected structure tree. */
  readonly tree: Tree;
  /**
   * Read title + body for the given ids.
   *
   * @param ids - Node ids
   */
  readNodes(ids: string[]): ReadNode[];
  /**
   * Track a document range across edits.
   *
   * @param range - Range to track
   */
  createTrackedPosition(range: Range): TrackedPositionId;
  /**
   * Drop a tracked position.
   *
   * @param id - Id from {@link Session.createTrackedPosition}
   */
  release(id: TrackedPositionId): void;
  /**
   * Resolve a tracked position to current offsets.
   *
   * @param id - Tracked position id
   */
  resolve(id: TrackedPositionId): ResolvedTrackedPosition | undefined;
  /** Node that currently owns the caret, or `null`. */
  readonly activeNode: string | null;
  /** Node at the reading line of the focused view, or `null`. */
  readonly visibleNode: string | null;
  /** Focused view id, or `null`. */
  readonly focusedViewId: string | null;
  /** Undo depth of the session timeline. */
  readonly timelineDepth: number;
  /** Redo depth of the session timeline. */
  readonly redoDepth: number;
  /**
   * Look up a view by id.
   *
   * @param id - View id
   */
  view(id: string): ViewHandle | undefined;
  /**
   * Whether a node has unsaved edits.
   *
   * @param nodeId - Node id
   */
  isDirty(nodeId: string): boolean;
  /**
   * Whether a node or any descendant has unsaved edits.
   *
   * @param nodeId - Node id
   */
  isSubtreeDirty(nodeId: string): boolean;
  /** Undo the last session/timeline group. */
  undo(): void;
  /** Redo the last undone group. */
  redo(): void;
  /**
   * Apply a structure action (rename, move, …).
   *
   * @param action - Structure mutation
   * @returns Whether the action applied
   */
  apply(action: StructureAction): boolean;
  /**
   * Replace session document in one undoable step (unlike {@link Session.replaceDocument}).
   *
   * @param nextDoc - Next markdown
   * @param targetNodeId - Optional node to keep in view
   * @returns Whether the patch applied
   */
  applyDocumentPatch(nextDoc: string, targetNodeId?: string): boolean;
  /**
   * Mark a node (or the whole document) as persisted.
   *
   * @param nodeId - Optional node; omitted means all
   */
  markPersisted(nodeId?: string): void;
  /**
   * Replace the document without an undo step.
   *
   * @param doc - Next markdown
   */
  replaceDocument(doc: string): void;
  /**
   * Subscribe to session events.
   *
   * @param fn - Listener
   * @returns Unsubscribe function
   */
  subscribe(fn: (e: SessionEvent) => void): () => void;
  /**
   * Create and optionally mount a view.
   *
   * @param opts - Scope, presentation, plugins
   */
  createView(opts?: CreateViewOptions): ViewHandle;
}
