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
export type SyncOptions = { newGroupDelay?: number };

function annotationList(spec: TransactionSpec): Annotation<unknown>[] {
  const a = spec.annotations;
  if (!a) return [];
  return (Array.isArray(a) ? a : [a]) as Annotation<unknown>[];
}

/** Copy grouping clocks from the origin view onto the session history (U17). */
function sessionHistoryAnnotations(trs: readonly Transaction[]): Annotation<unknown>[] {
  const last = trs[trs.length - 1]!;
  const out: Annotation<unknown>[] = [];
  const time = last.annotation(Transaction.time);
  if (time != null) out.push(Transaction.time.of(time));
  const userEvent = last.annotation(Transaction.userEvent);
  if (userEvent) out.push(Transaction.userEvent.of(userEvent));
  const isolate = last.annotation(isolateHistory);
  if (isolate) out.push(isolateHistory.of(isolate));
  const add = last.annotation(Transaction.addToHistory);
  if (add === false) out.push(Transaction.addToHistory.of(false));
  return out;
}

function historyExtension(opts?: SyncOptions): Extension {
  return opts?.newGroupDelay == null ? history() : history({ newGroupDelay: opts.newGroupDelay });
}

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
  private readonly historyExt: Extension;

  constructor(doc: string, opts?: SyncOptions) {
    this.historyExt = historyExtension(opts);
    this.sessionState = EditorState.create({
      doc,
      extensions: [this.historyExt],
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
    let sessionTr: Transaction | undefined;
    try {
      sessionTr = this.sessionState.update({
        changes,
        filter: false,
        annotations: sessionHistoryAnnotations(trs),
      });
      this.sessionState = sessionTr.state;
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
    if (sessionTr) this.afterDocument?.(changes, id, docBefore, sessionTr);
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
    let changes: ChangeSet | undefined;
    const docBefore = this.sessionState.doc;
    let tr: Transaction | undefined;
    try {
      tr = this.sessionState.update({
        ...spec,
        annotations: [isolateHistory.of("full"), ...annotationList(spec)],
      });
      changes = tr.changes;
      this.sessionState = tr.state;
      if (!changes.empty) this.forward(changes, null);
    } finally {
      this.applying = false;
    }
    if (tr && changes && !changes.empty) this.afterDocument?.(changes, null, docBefore, tr);
    return changes ?? ChangeSet.empty(docBefore.length);
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
    if (tr.docChanged) this.afterDocument?.(tr.changes, null, docBefore, tr);
  }

  reconfigure(id: ViewId, chrome: Extension, park?: (state: EditorState) => EditorSelection): void {
    const slot = this.require(id);
    const tr = slot.state.update({
      effects: slot.compartment.reconfigure(chrome),
      filter: false,
      annotations: [Transaction.addToHistory.of(false)],
    });
    const parked = park?.(tr.state);
    const parkTr =
      parked && !parked.eq(tr.state.selection)
        ? tr.state.update({
            selection: parked,
            filter: false,
            annotations: [Transaction.addToHistory.of(false)],
          })
        : null;
    const trs = parkTr ? [tr, parkTr] : [tr];
    if (slot.view) {
      slot.view.update(trs);
      slot.state = slot.view.state;
    } else {
      slot.state = parkTr ? parkTr.state : tr.state;
    }
  }

  replaceDocument(doc: string): void {
    this.sessionState = EditorState.create({
      doc,
      extensions: [this.historyExt],
    });
  }

  afterDocument?: (
    changes: ChangeSet,
    originId: ViewId | null,
    docBefore: Text,
    tr: Transaction,
  ) => void;
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

export function createSync(doc: string, opts?: SyncOptions): SyncEngine {
  return new SyncEngine(doc, opts);
}
