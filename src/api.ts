/**
 * Public API types (SPEC.md § 12). Hosts import these from the package root.
 * Runtime extras on the Session class are not part of this contract.
 */

import type { SearchHit, SearchHitClass } from "./core/search.js";
import type { StructureAction } from "./core/structure.js";
import type { ForeignTimelineCommand } from "./core/timeline.js";
import type { ResolvedTrackedPosition, TrackedPositionId } from "./core/tracked-position.js";
import type { Range, StructureSchema, Tree } from "./core/types.js";
import type { IncludeMode, Presentation } from "./view/presentation.js";

export type { Range, StructureLevel, StructureSchema, Tree, TreeNode } from "./core/types.js";
export type { SearchHit, SearchHitClass } from "./core/search.js";
export type { StructureAction } from "./core/structure.js";
export type { TrackedPositionId, ResolvedTrackedPosition } from "./core/tracked-position.js";
export type { IncludeMode, Presentation } from "./view/presentation.js";
export type { ForeignTimelineCommand } from "./core/timeline.js";

export interface Policy {
  structureEditingInWysiwyg?: "locked" | "allowed";
  frontmatterInWysiwyg?: "form" | "hidden";
  pillFields?: string[];
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
  scrollAt: TrackedPositionId;
  caretAt: TrackedPositionId;
  findState: unknown;
}

export interface CreateViewOptions {
  scope?: { nodeId: string; include?: IncludeMode };
  presentation?: Presentation;
  grain?: number;
  state?: ViewRestoreState;
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

export interface ViewHandle {
  readonly id: string;
  mount(el: HTMLElement): void;
  destroy(): void;
  getState(): ViewRestoreState;
  setScope(nodeId: string, opts?: { include?: IncludeMode }): void;
  setPresentation(p: Presentation): void;
  setGrain(rank: number): void;
  navigateTo(nodeId: string): void;
  scrollToNode(nodeId: string, cause: string): void;
  readonly visibleNode: string | null;
  find(query: string, opts: { mode: "view" | "document" }): SearchHit[];
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
