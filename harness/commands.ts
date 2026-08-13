/**
 * Command interface for behaviour tests (SPEC.md § 13.4).
 * No pointer gestures — tests drive state here (I5).
 */

import type { Session } from "../src/session.js";
import type { ViewHandle } from "../src/view-handle.js";
import type { StructureAction } from "../src/core/structure.js";

export interface HarnessCommands {
  setScope(viewId: string, nodeId: string, include?: "own" | "subtree"): void;
  navigateTo(viewId: string, nodeId: string): void;
  scrollToNode(viewId: string, nodeId: string, cause: string): void;
  undo(): boolean;
  redo(): boolean;
  find(_viewId: string, _query: string, _mode: "view" | "document"): never;
  applyStructure(action: StructureAction): boolean;
  setVariant(_variant: string): never;
  focusView(viewId: string): void;
  openView(scope: string, presentation: "source" | "wysiwyg"): string;
  closeView(viewId: string): void;
  typeInView(viewId: string, text: string): void;
}

export function createCommands(
  session: Session,
  views: Map<string, ViewHandle>,
): HarnessCommands {
  const requireView = (id: string): ViewHandle => {
    const v = views.get(id);
    if (!v) throw new Error(`unknown view ${id}`);
    return v;
  };

  return {
    setScope(viewId, nodeId, include) {
      requireView(viewId).setScope(nodeId, include ? { include } : undefined);
    },
    navigateTo(viewId, nodeId) {
      requireView(viewId).navigateTo(nodeId);
    },
    scrollToNode(viewId, nodeId, cause) {
      requireView(viewId).scrollToNode(nodeId, cause);
    },
    undo: () => session.undo(),
    redo: () => session.redo(),
    find() {
      throw new Error("find not implemented yet");
    },
    applyStructure(action) {
      return session.apply(action);
    },
    setVariant() {
      throw new Error("setVariant: only shared-state is built");
    },
    focusView(viewId) {
      requireView(viewId).focus();
    },
    openView(scope, presentation) {
      const v = session.createView({ scopeNodeId: scope, presentation });
      views.set(v.id, v);
      return v.id;
    },
    closeView(viewId) {
      requireView(viewId).destroy();
      views.delete(viewId);
    },
    typeInView(viewId, text) {
      const v = requireView(viewId);
      const ed = v._editor;
      if (!ed) throw new Error(`view ${viewId} is not mounted`);
      const sel = ed.state.selection.main;
      ed.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      });
    },
  };
}
