/**
 * Phase 0 risk-gate spike (SPEC.md § 16.1 G1–G3).
 * Throwaway evidence — not production code; do not lift into src/.
 *
 * Construction: one EditorState per view; forward document ChangeSets only
 * (https://codemirror.net/examples/split/). Selection is not shared.
 */

import {
  Annotation,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo } from "@codemirror/commands";

export type Presentation = "source" | "wysiwyg";

/** Marks a transaction that was forwarded from another view (do not re-forward). */
export const syncAnnotation = Annotation.define<boolean>();

/** L5: programmatic / undo paths may bypass wysiwyg guards. */
export const bypassGuards = Annotation.define<boolean>();

export const SPIKE_DOC = `# Node-A

Body of node A with plain text.

# Node-B

Body of node B with plain text.
`;

const MARKER_CHARS = new Set(["#", "*", "_", ">", "-", "`", "\\", "<"]);

export interface BranchRange {
  id: string;
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
}

export function parseBranches(doc: string): BranchRange[] {
  const lines = doc.split("\n");
  const headings: { id: string; lineStart: number; markerLen: number }[] = [];
  let offset = 0;
  for (const line of lines) {
    const m = /^(#{1,6}) (\S.*)$/.exec(line);
    if (m) {
      headings.push({
        id: m[2]!.trim(),
        lineStart: offset,
        markerLen: m[1]!.length + 1,
      });
    }
    offset += line.length + 1;
  }
  const branches: BranchRange[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const next = headings[i + 1];
    const to = next ? next.lineStart : doc.length;
    branches.push({
      id: h.id,
      from: h.lineStart,
      to,
      markerFrom: h.lineStart,
      markerTo: h.lineStart + h.markerLen,
    });
  }
  return branches;
}

const viewPresentation = new WeakMap<EditorView, Presentation>();
const viewIds = new WeakMap<EditorView, string>();

export function presentationOf(view: EditorView): Presentation | undefined {
  return viewPresentation.get(view);
}

const hideReplace = Decoration.replace({});
const hideLine = Decoration.line({ class: "cm-scope-hidden" });

function branchForView(viewId: string, doc: string): BranchRange {
  const want = viewId === "a" ? "Node-A" : "Node-B";
  const b = parseBranches(doc).find((x) => x.id === want);
  if (!b) throw new Error(`${want} branch missing`);
  return b;
}

function tryBranchForView(viewId: string, doc: string): BranchRange | null {
  try {
    return branchForView(viewId, doc);
  } catch {
    return null;
  }
}

function buildDecorations(
  view: EditorView,
  presentation: Presentation,
  viewId: string,
): DecorationSet {
  const doc = view.state.doc;
  const docStr = doc.toString();
  const own = tryBranchForView(viewId, docStr);
  const ranges: { from: number; to: number; value: Decoration }[] = [];

  if (!own) return Decoration.none;

  for (const b of parseBranches(docStr)) {
    if (b.id === own.id) continue;
    let pos = b.from;
    while (pos < b.to) {
      const line = doc.lineAt(pos);
      ranges.push(hideLine.range(line.from));
      pos = line.to + 1;
    }
  }

  if (presentation === "wysiwyg" && own.markerTo > own.markerFrom) {
    ranges.push(hideReplace.range(own.markerFrom, own.markerTo));
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges, true);
}

function atomicRangesFor(
  view: EditorView,
  presentation: Presentation,
  viewId: string,
): DecorationSet {
  if (presentation !== "wysiwyg") return Decoration.none;
  const own = tryBranchForView(viewId, view.state.doc.toString());
  if (!own || own.markerTo <= own.markerFrom) return Decoration.none;
  return Decoration.set([hideReplace.range(own.markerFrom, own.markerTo)]);
}

function presentationPlugin(presentation: Presentation, viewId: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, presentation, viewId);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, presentation, viewId);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => {
          const value = view.plugin(plugin);
          if (!value) return Decoration.none;
          return atomicRangesFor(view, presentation, viewId);
        }),
    },
  );
}

function maskText(text: string): string {
  let out = "";
  for (const ch of text) {
    out += MARKER_CHARS.has(ch) ? `\\${ch}` : ch;
  }
  return out;
}

export function maskTextForTest(text: string): string {
  return maskText(text);
}

function markerRangesIn(doc: string): { from: number; to: number }[] {
  return parseBranches(doc).map((b) => ({ from: b.markerFrom, to: b.markerTo }));
}

function changeTouchesMarkerPartially(
  from: number,
  to: number,
  markers: { from: number; to: number }[],
): { from: number; to: number } | null {
  for (const m of markers) {
    const overlaps = from < m.to && to > m.from;
    if (!overlaps) continue;
    const coversFully = from <= m.from && to >= m.to;
    if (!coversFully) return m;
  }
  return null;
}

/**
 * L1–L3 in one filter (I6). Installed only on the wysiwyg state — source has
 * no copy, so view identity needs no annotation.
 */
const wysiwygGuardFilter: Extension = EditorState.transactionFilter.of((tr) => {
  if (tr.annotation(bypassGuards)) return tr;
  if (tr.annotation(syncAnnotation)) return tr;
  if (!tr.docChanged) return tr;

  const startDoc = tr.startState.doc.toString();
  const markers = markerRangesIn(startDoc);

  const pieces: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    pieces.push({ from: fromA, to: toA, insert: inserted.toString() });
  });

  let rewritten = false;
  const next: { from: number; to: number; insert: string }[] = [];

  for (const piece of pieces) {
    let { from, to, insert } = piece;

    const partial = changeTouchesMarkerPartially(from, to, markers);
    if (partial && insert.length === 0) {
      from = Math.min(from, partial.from);
      to = Math.max(to, partial.to);
      rewritten = true;
    }

    if (insert.length > 0) {
      const masked = maskText(insert);
      if (masked !== insert) {
        insert = masked;
        rewritten = true;
      }
    }

    next.push({ from, to, insert });
  }

  if (!rewritten) return tr;

  let sel: TransactionSpec["selection"] = tr.selection;
  if (sel) {
    const only = next.length === 1 ? next[0] : null;
    if (only && only.insert.length > 0) {
      sel = EditorSelection.cursor(only.from + only.insert.length);
    }
  }

  return {
    changes: next,
    selection: sel,
    annotations: [bypassGuards.of(true)],
    userEvent: tr.annotation(Transaction.userEvent),
  } satisfies TransactionSpec;
});

function wysiwygInputHandler(view: EditorView, from: number, to: number, text: string): boolean {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent: "input.type",
  });
  return true;
}

function deleteCommand(forward: boolean) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    let from = sel.from;
    let to = sel.to;
    if (from === to) {
      if (forward) {
        if (to >= view.state.doc.length) return false;
        to += 1;
      } else {
        if (from === 0) return false;
        from -= 1;
      }
    }
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: EditorSelection.cursor(from),
      userEvent: forward ? "delete.forward" : "delete.backward",
    });
    return true;
  };
}

const wysiwygKeymap = keymap.of([
  { key: "Backspace", run: deleteCommand(false) },
  { key: "Delete", run: deleteCommand(true) },
  ...historyKeymap,
  ...defaultKeymap,
]);

const sourceKeymap = keymap.of([...historyKeymap, ...defaultKeymap]);

function extensionsFor(cfg: SpikeViewConfig): Extension[] {
  const common: Extension[] = [
    history(),
    presentationPlugin(cfg.presentation, cfg.id),
    cfg.presentation === "wysiwyg" ? wysiwygKeymap : sourceKeymap,
    EditorView.theme({
      "&": { fontSize: "14px" },
      ".cm-content": { fontFamily: "ui-monospace, monospace" },
    }),
  ];
  if (cfg.presentation !== "wysiwyg") return common;
  return [
    ...common,
    wysiwygGuardFilter,
    EditorView.inputHandler.of(wysiwygInputHandler),
    EditorView.domEventHandlers({
      paste(event, view) {
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return false;
        event.preventDefault();
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: EditorSelection.cursor(sel.from + text.length),
          userEvent: "input.paste",
        });
        return true;
      },
    }),
  ];
}

export interface SpikeViewConfig {
  id: string;
  parent: HTMLElement;
  presentation: Presentation;
  initialCaret: number;
}

export interface ViewSnapshot {
  viewId: string;
  presentation: Presentation;
  doc: string;
  selection: { anchor: number; head: number };
  visibleText: string;
  markerVisibleInDom: boolean;
  focused: boolean;
  ownBranch: BranchRange;
  selectionInOwnBranch: boolean;
  docsInSync: boolean;
}

export interface SpikeSession {
  views: Record<string, EditorView>;
  getDoc(): string;
  focusView(id: string): void;
  setSelection(id: string, anchor: number, head?: number): void;
  typeText(id: string, text: string): void;
  pasteText(id: string, text: string): void;
  deleteBackward(id: string): void;
  undo(id: string): boolean;
  getSnapshot(id: string): ViewSnapshot;
  destroy(): void;
}

function syncDispatch(views: EditorView[], trs: readonly Transaction[], origin: EditorView) {
  origin.update(trs);
  for (const tr of trs) {
    if (tr.changes.empty || tr.annotation(syncAnnotation)) continue;
    const userEvent = tr.annotation(Transaction.userEvent);
    const annotations = userEvent
      ? [syncAnnotation.of(true), Transaction.addToHistory.of(false), Transaction.userEvent.of(userEvent)]
      : [syncAnnotation.of(true), Transaction.addToHistory.of(false)];
    for (const other of views) {
      if (other === origin) continue;
      other.dispatch({ changes: tr.changes, annotations });
    }
  }
}

export function createSpikeSession(configs: SpikeViewConfig[]): SpikeSession {
  const views: EditorView[] = [];
  const byId: Record<string, EditorView> = {};
  let focusedViewId: string | null = null;

  for (const cfg of configs) {
    const state = EditorState.create({
      doc: SPIKE_DOC,
      extensions: extensionsFor(cfg),
      selection: EditorSelection.cursor(cfg.initialCaret),
    });
    const view = new EditorView({
      state,
      parent: cfg.parent,
      dispatchTransactions: (trs, v) => syncDispatch(views, trs, v),
    });
    viewIds.set(view, cfg.id);
    viewPresentation.set(view, cfg.presentation);
    views.push(view);
    byId[cfg.id] = view;
  }

  const docsInSync = () => {
    const first = views[0]!.state.doc.toString();
    return views.every((v) => v.state.doc.toString() === first);
  };

  return {
    views: byId,
    getDoc: () => views[0]!.state.doc.toString(),
    focusView(id: string) {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      focusedViewId = id;
      v.focus();
    },
    setSelection(id: string, anchor: number, head = anchor) {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      focusedViewId = id;
      v.dispatch({
        selection: EditorSelection.single(anchor, head),
        annotations: [bypassGuards.of(true)],
      });
    },
    typeText(id: string, text: string) {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      focusedViewId = id;
      const sel = v.state.selection.main;
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: EditorSelection.cursor(sel.from + text.length),
        userEvent: "input.type",
      });
    },
    pasteText(id: string, text: string) {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      focusedViewId = id;
      const sel = v.state.selection.main;
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: EditorSelection.cursor(sel.from + text.length),
        userEvent: "input.paste",
      });
    },
    deleteBackward(id: string) {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      focusedViewId = id;
      deleteCommand(false)(v);
    },
    undo(id: string) {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      return undo(v);
    },
    getSnapshot(id: string): ViewSnapshot {
      const v = byId[id];
      if (!v) throw new Error(`unknown view ${id}`);
      const presentation = viewPresentation.get(v)!;
      const doc = v.state.doc.toString();
      const own =
        tryBranchForView(id, doc) ??
        ({ id: "missing", from: 0, to: 0, markerFrom: 0, markerTo: 0 } satisfies BranchRange);
      const head = v.state.selection.main.head;
      const visibleText = Array.from(v.contentDOM.querySelectorAll(".cm-line"))
        .filter((el) => !el.classList.contains("cm-scope-hidden"))
        .map((el) => el.textContent ?? "")
        .join("\n");
      return {
        viewId: id,
        presentation,
        doc,
        selection: { anchor: v.state.selection.main.anchor, head },
        visibleText,
        markerVisibleInDom: /(?:^|\n)# /.test(visibleText) || visibleText.startsWith("# "),
        focused: focusedViewId === id,
        ownBranch: own,
        selectionInOwnBranch: own.id !== "missing" && head >= own.from && head <= own.to,
        docsInSync: docsInSync(),
      };
    },
    destroy() {
      for (const v of views) v.destroy();
    },
  };
}

/** Initial caret positions inside each branch body (after heading line). */
export function defaultCarets(doc: string = SPIKE_DOC): { a: number; b: number } {
  const branches = parseBranches(doc);
  const a = branches.find((x) => x.id === "Node-A")!;
  const b = branches.find((x) => x.id === "Node-B")!;
  return { a: a.markerTo + a.id.length + 2, b: b.markerTo + b.id.length + 2 };
}
