/**
 * View handle registered on a Session (SPEC.md § 3.1, § 12 View).
 */

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Session } from "./session.js";

export type Presentation = "source" | "wysiwyg";
export type IncludeMode = "own" | "subtree";

export interface ViewOptions {
  scopeNodeId?: string;
  include?: IncludeMode;
  presentation?: Presentation;
  grain?: number;
}

export interface ViewRestoreState {
  scopeNodeId: string | null;
  include: IncludeMode;
  presentation: Presentation;
  grain: number | null;
  scrollAt: string | null;
  caretAt: string | null;
}

let viewSeq = 1;

export class ViewHandle {
  readonly id: string;
  private session: Session;
  scopeNodeId: string | null;
  include: IncludeMode;
  presentation: Presentation;
  grain: number | null;
  visibleNodeId: string | null = null;
  private scopeAncestors: string[] = [];
  private scrollAt: string | null = null;
  private caretAt: string | null = null;
  private destroyed = false;
  /** @internal mounted CM6 view */
  _editor: EditorView | null = null;

  constructor(session: Session, opts: ViewOptions = {}) {
    this.id = `view-${viewSeq++}`;
    this.session = session;
    this.scopeNodeId = opts.scopeNodeId ?? session.tree.roots[0] ?? null;
    this.include = opts.include ?? "subtree";
    this.presentation = opts.presentation ?? "source";
    this.grain = opts.grain ?? null;
    this.visibleNodeId = this.scopeNodeId;
    this.rememberAncestors();
  }

  get visibleNode(): string | null {
    return this.visibleNodeId;
  }

  /** Rendered document range for this view's scope + include (SPEC § 3.1). */
  renderRange(): { from: number; to: number } | null {
    if (!this.scopeNodeId) return null;
    const scope = this.session.tree.nodes.get(this.scopeNodeId);
    if (!scope) return null;
    return this.include === "own" ? scope.ownRange : scope.subtreeRange;
  }

  selectionInRenderRange(pos: number): boolean {
    const range = this.renderRange();
    if (!range) return true;
    return pos >= range.from && pos < range.to;
  }

  hasDomFocus(): boolean {
    return this._editor?.hasFocus ?? false;
  }

  mount(el: HTMLElement): void {
    this.assertAlive();
    if (this._editor) return;
    const sync = this.session.sharedSync();
    if (!sync) throw new Error("mount requires shared-state sync");

    const scope = this.scopeNodeId ? this.session.tree.nodes.get(this.scopeNodeId) : undefined;
    const initialCaret = scope ? scope.heading.to + 1 : 0;

    this._editor = sync.mountEditor({
      parent: el,
      viewId: this.id,
      presentation: this.presentation,
      include: this.include,
      scopeNodeId: this.scopeNodeId,
      getTree: () => this.session.tree,
      selectionMitigation: this.session.selectionMitigation.isEnabled(),
      initialCaret,
      onFocus: () => {
        this.session._setFocusedView(this.id);
      },
    });
    this.session.selectionMitigation.remember(
      this.id,
      this._editor.state.selection.main.head,
    );
    this.session._traceCaret("mount", this);
  }

  destroy(): void {
    if (this.destroyed) return;
    if (this._editor) {
      this.session.sharedSync()?.unmountEditor(this._editor);
      this._editor = null;
    }
    if (this.scrollAt) this.session.release(this.scrollAt);
    if (this.caretAt) this.session.release(this.caretAt);
    this.scrollAt = null;
    this.caretAt = null;
    this.destroyed = true;
    this.session._unregisterView(this);
  }

  getState(): ViewRestoreState {
    this.assertAlive();
    return {
      scopeNodeId: this.scopeNodeId,
      include: this.include,
      presentation: this.presentation,
      grain: this.grain,
      scrollAt: this.scrollAt,
      caretAt: this.caretAt,
    };
  }

  setScope(nodeId: string, opts?: { include?: IncludeMode }): void {
    this.assertAlive();
    this.scopeNodeId = nodeId;
    if (opts?.include) this.include = opts.include;
    this.rememberAncestors();
    this._refreshEditor();
    this.session._notify();
  }

  setPresentation(p: Presentation): void {
    this.assertAlive();
    this.presentation = p;
    this._refreshEditor();
    this.session._notify();
  }

  setGrain(rank: number): void {
    this.assertAlive();
    this.grain = rank;
    this.session._notify();
  }

  navigateTo(nodeId: string): void {
    this.assertAlive();
    const tree = this.session.tree;
    const target = tree.nodes.get(nodeId);
    if (!target) return;

    if (this.scopeNodeId === nodeId) {
      this.scrollToNode(nodeId, "navigateTo");
      return;
    }

    const scope = this.scopeNodeId ? tree.nodes.get(this.scopeNodeId) : undefined;
    if (scope) {
      const range = this.include === "own" ? scope.ownRange : scope.subtreeRange;
      const inside =
        target.subtreeRange.from >= range.from && target.subtreeRange.to <= range.to;
      if (inside) {
        this.scrollToNode(nodeId, "navigateTo");
        return;
      }
    }
    this.setScope(nodeId);
  }

  scrollToNode(nodeId: string, cause: string): void {
    this.assertAlive();
    if (!cause) throw new Error("scrollToNode requires a named cause (I4)");
    const node = this.session.tree.nodes.get(nodeId);
    const pos = node ? node.heading.from : null;
    this.session.scrollLog.record(this.id, cause, pos);
    this.visibleNodeId = nodeId;

    if (this._editor && pos != null) {
      this._editor.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
    }
    this.session._notify();
  }

  focus(): void {
    this.assertAlive();
    this._editor?.focus();
    this.session._setFocusedView(this.id);
  }

  find(_query: string, _opts: { mode: "view" | "document" }): never {
    throw new Error("view.find is not implemented yet");
  }

  replace(_hitId: string, _text: string): never {
    throw new Error("view.replace is not implemented yet");
  }

  replaceAll(_text: string, _opts?: { classes?: string[] }): never {
    throw new Error("view.replaceAll is not implemented yet");
  }

  /** Last scroll cause for this view (I4 / harness). */
  lastScrollCause(): string | undefined {
    return this.session.scrollLog.lastFor(this.id)?.cause;
  }

  _validateScope(): void {
    if (!this.scopeNodeId) return;
    const tree = this.session.tree;
    if (tree.nodes.has(this.scopeNodeId)) {
      this.rememberAncestors();
      return;
    }
    for (const id of this.scopeAncestors) {
      if (tree.nodes.has(id)) {
        this.scopeNodeId = id;
        this.visibleNodeId = id;
        this.rememberAncestors();
        return;
      }
    }
    this.scopeNodeId = tree.roots[0] ?? null;
    this.visibleNodeId = this.scopeNodeId;
    this.rememberAncestors();
  }

  _refreshEditor(): void {
    if (!this._editor) return;
    this.session.sharedSync()?.refreshView(this._editor, {
      presentation: this.presentation,
      include: this.include,
      scopeNodeId: this.scopeNodeId,
      selectionMitigation: this.session.selectionMitigation.isEnabled(),
      getTree: () => this.session.tree,
    });
  }

  /**
   * Bring shared selection into this view's render range when it lies outside
   * (V-S mitigation). Keeps an in-range click selection intact.
   */
  _restoreMitigatedCaret(): void {
    if (!this._editor || !this.session.selectionMitigation.isEnabled()) return;
    const head = this._editor.state.selection.main.head;
    if (this.selectionInRenderRange(head)) {
      this.session.selectionMitigation.remember(this.id, head);
      return;
    }
    const remembered = this.session.selectionMitigation.last(this.id);
    const scope = this.scopeNodeId ? this.session.tree.nodes.get(this.scopeNodeId) : undefined;
    const fallback = scope ? scope.heading.to + 1 : 0;
    const pos = Math.min(
      remembered != null && this.selectionInRenderRange(remembered) ? remembered : fallback,
      this._editor.state.doc.length,
    );
    if (pos === head) return;
    this._editor.dispatch({
      selection: EditorSelection.cursor(pos),
    });
    this.session.selectionMitigation.remember(this.id, pos);
    this.session._traceCaret("mitigation.clamp-to-render-range", this);
  }

  private rememberAncestors(): void {
    this.scopeAncestors = [];
    if (!this.scopeNodeId) return;
    let cur = this.session.tree.nodes.get(this.scopeNodeId);
    while (cur?.parentId) {
      this.scopeAncestors.push(cur.parentId);
      cur = this.session.tree.nodes.get(cur.parentId);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error(`View ${this.id} is destroyed`);
  }
}
