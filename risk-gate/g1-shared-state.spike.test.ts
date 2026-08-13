// @vitest-environment jsdom
//
// SPEC.md §16.1, G1: "Liefert ein ViewPlugin auf einem geteilten State je View
// unterschiedliche Dekorationen und atomare Bereiche?"
//
// This is deliberately stricter than CodeMirror's own "Split View" example
// (https://codemirror.net/examples/split/), which uses TWO EditorState objects kept in sync
// by forwarding ChangeSets — structurally SPEC.md §11.3's V-M, not V-S. That example's own
// first sentence: "it is possible to create multiple views from a single editor state, [but]
// those views will not, by themselves, stay in sync." V-S's bet is that a single shared
// EditorState *object* (not just equal content) can be kept across N views via one funneled
// dispatchTransactions handler, with only the ViewPlugin instance differing per view.
//
// This spike is throwaway Phase-0 risk-gate code, not the hardened Phase 1 implementation —
// see risk-gate/README (once written) and SETUP.md §9 step 5.

import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

describe("G1: ViewPlugin differentiation on a literally shared EditorState", () => {
  it("keeps N EditorViews on the exact same state object in sync via one funneled dispatch, with per-view decorations", () => {
    const viewMode = new WeakMap<EditorView, "source" | "wysiwyg">();

    const modeAwarePlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = this.build(view);
        }
        update(update: ViewUpdate) {
          this.decorations = this.build(update.view);
        }
        build(view: EditorView): DecorationSet {
          if (viewMode.get(view) !== "wysiwyg") return Decoration.set([]);
          const end = Math.min(5, view.state.doc.length);
          return Decoration.set([Decoration.mark({ class: "cm-wysiwyg-marker" }).range(0, end)]);
        }
      },
      { decorations: (p) => p.decorations },
    );

    const shared = EditorState.create({ doc: "hello world", extensions: [modeAwarePlugin] });

    const views: EditorView[] = [];
    function fanOut(trs: readonly Transaction[]) {
      for (const v of views) v.update(trs);
    }

    const viewA = new EditorView({ state: shared, parent: document.body, dispatchTransactions: fanOut });
    const viewB = new EditorView({ state: shared, parent: document.body, dispatchTransactions: fanOut });
    viewMode.set(viewA, "source");
    viewMode.set(viewB, "wysiwyg");
    views.push(viewA, viewB);

    // Force a rebuild now that modes are assigned (constructors ran before viewMode was set).
    viewA.dispatch(viewA.state.update({}));

    expect(viewA.state).toBe(viewB.state);
    expect(viewA.dom.querySelector(".cm-wysiwyg-marker")).toBeNull();
    expect(viewB.dom.querySelector(".cm-wysiwyg-marker")).not.toBeNull();

    viewA.dispatch(viewA.state.update({ changes: { from: 0, insert: "X" } }));

    expect(viewA.state).toBe(viewB.state);
    expect(viewB.state.doc.toString()).toBe("Xhello world");
    expect(viewA.dom.querySelector(".cm-wysiwyg-marker")).toBeNull();
    expect(viewB.dom.querySelector(".cm-wysiwyg-marker")).not.toBeNull();

    viewA.destroy();
    viewB.destroy();
  });
});
