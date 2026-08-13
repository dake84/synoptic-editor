/**
 * Harness instrumentation (SPEC.md § 13.3) — observe, don't mirror state.
 */

import { nodeAtPosition } from "../src/core/tree.js";
import type { Session } from "../src/session.js";
import type { ViewHandle } from "../src/view-handle.js";
import type { CaretTraceEvent } from "../src/view/caret-trace.js";

export interface InspectorSnapshot {
  variant: string;
  documentLength: number;
  timelineDepth: number;
  activeNode: string | null;
  visibleNode: string | null;
  /** Shared selection head + which node owns it. */
  caret: {
    head: number | null;
    nodeId: string | null;
    sessionFocusedViewId: string | null;
  };
  dirty: string[];
  subtreeDirty: string[];
  views: Array<{
    id: string;
    scopeNodeId: string | null;
    include: string;
    presentation: string;
    visibleNode: string | null;
    lastScrollCause: string | undefined;
    selectionHead: number | null;
    renderRange: { from: number; to: number } | null;
    headInRenderRange: boolean;
    cmHasFocus: boolean;
  }>;
  caretTrace: readonly CaretTraceEvent[];
  roots: string[];
}

export function inspect(session: Session, views: Map<string, ViewHandle>): InspectorSnapshot {
  const dirty: string[] = [];
  const subtreeDirty: string[] = [];
  for (const id of session.tree.nodes.keys()) {
    if (session.isDirty(id)) dirty.push(id);
    if (session.isSubtreeDirty(id)) subtreeDirty.push(id);
  }

  const firstEditor = [...views.values()].find((v) => v._editor)?._editor;
  const head = firstEditor?.state.selection.main.head ?? null;

  return {
    variant: session.variant,
    documentLength: session.document.length,
    timelineDepth: session.timelineDepth,
    activeNode: session.activeNode,
    visibleNode: session.visibleNode,
    caret: {
      head,
      nodeId: head == null ? null : (nodeAtPosition(session.tree, head)?.id ?? null),
      sessionFocusedViewId: session.selectionMitigation.focused(),
    },
    dirty,
    subtreeDirty,
    roots: [...session.tree.roots],
    caretTrace: session.caretTrace.all(),
    views: [...views.values()].map((v) => {
      const h = v._editor?.state.selection.main.head ?? null;
      return {
        id: v.id,
        scopeNodeId: v.scopeNodeId,
        include: v.include,
        presentation: v.presentation,
        visibleNode: v.visibleNode,
        lastScrollCause: v.lastScrollCause(),
        selectionHead: h,
        renderRange: v.renderRange(),
        headInRenderRange: h == null ? false : v.selectionInRenderRange(h),
        cmHasFocus: v.hasDomFocus(),
      };
    }),
  };
}
