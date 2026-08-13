/**
 * Star sync kernel (SPEC.md § 11.2).
 *
 * SessionEditorState has no view. Each view has its own EditorState.
 * Document ChangeSets travel session → every view. Selection is never forwarded.
 */

import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Transaction,
  Compartment,
  type Extension,
  type TransactionSpec,
  type Text,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, isolateHistory } from "@codemirror/commands";

export const syncAnnotation = Annotation.define<boolean>();

export type SessionEditorState = EditorState;
export type ViewId = string;

interface Slot {
  state: EditorState;
  view: EditorView | null;
  compartment: Compartment;
}

function composeChanges(trs: readonly Transaction[]): ChangeSet {
  let changes = trs[0]!.changes;
  for (let i = 1; i < trs.length; i++) changes = changes.compose(trs[i]!.changes);
  return changes;
}

export class SyncEngine {
  private sessionState: SessionEditorState;
  private readonly slots = new Map<ViewId, Slot>();
  private applying = false;

  constructor(doc: string) {
    this.sessionState = EditorState.create({
      doc,
      extensions: [history()],
    });
  }

  get state(): SessionEditorState {
    return this.sessionState;
  }

  get document(): string {
    return this.sessionState.doc.toString();
  }

  get docText(): Text {
    return this.sessionState.doc;
  }

  get isApplying(): boolean {
    return this.applying;
  }

  addView(id: ViewId, extensions: Extension, compartment: Compartment, selection?: EditorSelection): void {
    const state = EditorState.create({
      doc: this.sessionState.doc,
      selection,
      extensions,
    });
    this.slots.set(id, { state, view: null, compartment });
  }

  removeView(id: ViewId): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.view?.destroy();
    this.slots.delete(id);
  }

  hasView(id: ViewId): boolean {
    return this.slots.has(id);
  }

  viewIds(): ViewId[] {
    return [...this.slots.keys()];
  }

  getState(id: ViewId): EditorState {
    return this.require(id).state;
  }

  mount(id: ViewId, parent: Element): EditorView {
    const slot = this.require(id);
    if (slot.view) return slot.view;
    const view = new EditorView({
      state: slot.state,
      parent,
      dispatchTransactions: (trs) => this.onViewTransactions(id, trs),
    });
    slot.view = view;
    slot.state = view.state;
    return view;
  }

  unmount(id: ViewId): void {
    const slot = this.slots.get(id);
    if (!slot?.view) return;
    slot.state = slot.view.state;
    slot.view.destroy();
    slot.view = null;
  }

  editorView(id: ViewId): EditorView | null {
    return this.slots.get(id)?.view ?? null;
  }

  /**
   * Origin path: filters already ran. Session first, origin keeps its selection,
   * every other view receives the ChangeSet only. Never dispatch (not reentrant).
   */
  onViewTransactions(id: ViewId, trs: readonly Transaction[]): void {
    if (this.applying) {
      throw new Error("reentrant view update");
    }
    const slot = this.require(id);
    if (trs.every((tr) => tr.annotation(syncAnnotation))) {
      this.applying = true;
      try {
        slot.view?.update(trs);
        slot.state = slot.view?.state ?? trs[trs.length - 1]!.state;
      } finally {
        this.applying = false;
      }
      return;
    }
    const changed = trs.some((tr) => tr.docChanged);
    if (!changed) {
      this.applying = true;
      try {
        if (slot.view) {
          slot.view.update(trs);
          slot.state = slot.view.state;
        } else {
          slot.state = trs[trs.length - 1]!.state;
        }
      } finally {
        this.applying = false;
      }
      this.afterLocal?.(id, trs);
      return;
    }
    const changes = composeChanges(trs);
    const docBefore = this.sessionState.doc;
    this.applying = true;
    try {
      this.sessionState = this.sessionState.update({
        changes,
        filter: false,
        annotations: [isolateHistory.of("full")],
      }).state;
      this.forward(changes, id);
      if (slot.view) {
        slot.view.update(trs);
        slot.state = slot.view.state;
      } else {
        slot.state = trs[trs.length - 1]!.state;
      }
    } finally {
      this.applying = false;
    }
    this.afterDocument?.(changes, id, docBefore);
  }

  dispatchSpecs(id: ViewId, specs: TransactionSpec[]): void {
    const slot = this.require(id);
    const tr = slot.state.update(...specs);
    this.onViewTransactions(id, [tr]);
  }

  /** Programmatic document change with no origin view (structure, undo, replace). */
  applySession(spec: TransactionSpec): ChangeSet {
    if (this.applying) throw new Error("reentrant session apply");
    this.applying = true;
    let changes: ChangeSet;
    const docBefore = this.sessionState.doc;
    try {
      const tr = this.sessionState.update(spec);
      changes = tr.changes;
      this.sessionState = tr.state;
      if (!changes.empty) this.forward(changes, null);
    } finally {
      this.applying = false;
    }
    if (!changes.empty) this.afterDocument?.(changes, null, docBefore);
    return changes;
  }

  acceptSession(tr: Transaction): void {
    if (this.applying) throw new Error("reentrant session accept");
    const docBefore = this.sessionState.doc;
    this.applying = true;
    try {
      this.sessionState = tr.state;
      if (tr.docChanged) this.forward(tr.changes, null);
    } finally {
      this.applying = false;
    }
    if (tr.docChanged) this.afterDocument?.(tr.changes, null, docBefore);
  }

  reconfigure(id: ViewId, chrome: Extension): void {
    const slot = this.require(id);
    const tr = slot.state.update({
      effects: slot.compartment.reconfigure(chrome),
      filter: false,
      annotations: [Transaction.addToHistory.of(false)],
    });
    if (slot.view) {
      slot.view.update([tr]);
      slot.state = slot.view.state;
    } else {
      slot.state = tr.state;
    }
  }

  replaceDocument(doc: string): void {
    this.sessionState = EditorState.create({
      doc,
      extensions: [history()],
    });
  }

  afterDocument?: (changes: ChangeSet, originId: ViewId | null, docBefore: Text) => void;
  afterLocal?: (id: ViewId, trs: readonly Transaction[]) => void;

  private forward(changes: ChangeSet, originId: ViewId | null): void {
    for (const [id, slot] of this.slots) {
      if (id === originId) continue;
      const tr = slot.state.update({
        changes,
        annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)],
        filter: false,
      });
      if (slot.view) {
        slot.view.update([tr]);
        slot.state = slot.view.state;
      } else {
        slot.state = tr.state;
      }
    }
  }

  private require(id: ViewId): Slot {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`unknown view ${id}`);
    return slot;
  }
}

export function createSync(doc: string): SyncEngine {
  return new SyncEngine(doc);
}
