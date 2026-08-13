/**
 * View handle (SPEC.md § 12).
 */

import type { EditorView } from "@codemirror/view";
import type { TrackedPositionId } from "./core/tracked-position.js";
import type { IncludeMode, Presentation } from "./view/presentation.js";

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
  find(query: string, opts: { mode: "view" | "document" }): unknown[];
  replace(hitId: string, text: string): void;
  replaceAll(text: string, opts?: { classes?: string[] }): unknown;
  focus(): void;
  editorView(): EditorView | null;
}
