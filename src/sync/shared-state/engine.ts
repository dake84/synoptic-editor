/**
 * V-S sync: one EditorState, N EditorViews (SPEC § 11.2, I1).
 */

import {
  EditorSelection,
  EditorState,
  type ChangeSet,
  type Transaction,
} from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { minimalGuardFilter } from "../../view/guards/minimal.js";
import { beginViewBind, endViewBind, updateBinding } from "../../view/pending.js";
import {
  scopePresentationPlugin,
  synopticTheme,
} from "../../view/presentation/scope-plugin.js";
import type {
  EditorTransactionHandler,
  MountEditorOptions,
  SharedStateSyncEngine,
  SyncListener,
  SyncVariant,
} from "../types.js";

export function createSharedStateSync(initialDoc: string): SharedStateSyncEngine {
  let applying = false;
  let handler: EditorTransactionHandler | null = null;
  const listeners = new Set<SyncListener>();
  const views: EditorView[] = [];
  /** Per-view focus callback, set at mount. */
  const focusHandlers = new WeakMap<EditorView, () => void>();

  const extensions = [
    drawSelection(),
    minimalGuardFilter,
    scopePresentationPlugin,
    synopticTheme,
    keymap.of(defaultKeymap),
    EditorView.domEventHandlers({
      focus(_event, view) {
        focusHandlers.get(view)?.();
        return false;
      },
    }),
  ];

  let state = EditorState.create({
    doc: initialDoc,
    extensions,
  });

  function notifyDoc(): void {
    const doc = state.doc.toString();
    for (const l of listeners) l(doc);
  }

  /** Origin first (https://codemirror.net/examples/split/). Pointer: siblings setState. */
  function syncViews(trs: readonly Transaction[], origin?: EditorView): void {
    if (origin) {
      origin.update(trs);
      const pointer = trs.some((t) => t.isUserEvent("select.pointer"));
      for (const v of views) {
        if (v === origin) continue;
        if (pointer) v.setState(origin.state);
        else v.update(trs);
      }
      state = origin.state;
      return;
    }
    for (const v of views) v.update(trs);
    if (trs.length > 0) state = trs[trs.length - 1]!.state;
  }

  const engine: SharedStateSyncEngine = {
    variant: "shared-state" satisfies SyncVariant,

    getDoc: () => state.doc.toString(),

    applyChanges(changes: ChangeSet): string {
      if (changes.empty) return state.doc.toString();
      applying = true;
      try {
        const tr = state.update({ changes, filter: false });
        if (views.length === 0) {
          state = tr.state;
        } else {
          syncViews([tr]);
        }
        notifyDoc();
        return state.doc.toString();
      } finally {
        applying = false;
      }
    },

    replaceDoc(next: string): void {
      applying = true;
      try {
        state = EditorState.create({
          doc: next,
          extensions,
          selection: EditorSelection.cursor(0),
        });
        for (const v of views) {
          // Remount state onto each view
          v.setState(state);
        }
        notifyDoc();
      } finally {
        applying = false;
      }
    },

    subscribe(listener: SyncListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setTransactionHandler(h: EditorTransactionHandler | null): void {
      handler = h;
    },

    mountEditor(opts: MountEditorOptions): EditorView {
      beginViewBind({
        viewId: opts.viewId,
        presentation: opts.presentation,
        include: opts.include,
        scopeNodeId: opts.scopeNodeId,
        getTree: opts.getTree,
        selectionMitigation: opts.selectionMitigation,
      });
      let view: EditorView;
      try {
        view = new EditorView({
          state,
          parent: opts.parent,
          dispatchTransactions: (trs, origin) => {
            syncViews(trs, origin);
            if (!applying && handler) handler(trs, origin);
            if (!applying && trs.some((t) => t.docChanged)) notifyDoc();
          },
        });
      } finally {
        endViewBind();
      }
      views.push(view);
      if (opts.onFocus) focusHandlers.set(view, opts.onFocus);
      if (opts.initialCaret != null) {
        const pos = Math.min(opts.initialCaret, state.doc.length);
        applying = true;
        try {
          const tr = state.update({
            selection: EditorSelection.cursor(pos),
            filter: false,
          });
          syncViews([tr]);
        } finally {
          applying = false;
        }
      }
      return view;
    },

    unmountEditor(view: EditorView): void {
      const i = views.indexOf(view);
      if (i >= 0) views.splice(i, 1);
      focusHandlers.delete(view);
      view.destroy();
    },

    refreshView(view: EditorView, patch: Partial<MountEditorOptions>): void {
      updateBinding(view, {
        presentation: patch.presentation,
        include: patch.include,
        scopeNodeId: patch.scopeNodeId,
        selectionMitigation: patch.selectionMitigation,
        getTree: patch.getTree,
      });
      applying = true;
      try {
        view.dispatch({});
      } finally {
        applying = false;
      }
    },
  };

  return engine;
}
