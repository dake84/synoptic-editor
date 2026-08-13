/**
 * Per-view scope + presentation decorations (ViewPlugin, not StateField).
 *
 * Out-of-scope lines stay in the DOM at measured height 0. `display:none` is
 * not used: CM6 then skips measurement and estimates a full line height, so
 * `posAtCoords` maps clicks onto those phantom lines (SPEC § 11.2).
 * Block replacements cannot come from a ViewPlugin (CM6: "Block decorations
 * may not be specified via plugins") — G1 forbids putting them in the shared
 * state either.
 */

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { bindingOf, takePendingBinding, type ViewBinding } from "../pending.js";

const hideLine = Decoration.line({ class: "cm-synoptic-scope-hidden" });
const hideMarker = Decoration.replace({});

function buildDecos(view: EditorView, binding: ViewBinding): DecorationSet {
  const tree = binding.getTree();
  const doc = view.state.doc;
  const ranges: { from: number; to: number; value: Decoration }[] = [];

  const scope = binding.scopeNodeId ? tree.nodes.get(binding.scopeNodeId) : undefined;
  if (scope) {
    const keep = binding.include === "own" ? scope.ownRange : scope.subtreeRange;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.to <= keep.from || line.from >= keep.to) {
        ranges.push(hideLine.range(line.from));
      }
    }

    if (binding.presentation === "wysiwyg") {
      const h = scope.heading;
      const text = doc.sliceString(h.from, h.to);
      const m = /^(#{1,6})[ \t]+/.exec(text);
      if (m) {
        ranges.push(hideMarker.range(h.from, h.from + m[0].length));
      }
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges, true);
}

export const scopePresentationPlugin = ViewPlugin.fromClass(
  class {
    binding: ViewBinding;
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.binding = takePendingBinding(view);
      this.decorations = buildDecos(view, this.binding);
    }

    update(update: ViewUpdate) {
      const b = bindingOf(update.view);
      const bindingChanged = Boolean(b && b !== this.binding);
      if (b) this.binding = b;
      if (update.docChanged || update.viewportChanged || bindingChanged) {
        this.decorations = buildDecos(update.view, this.binding);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        const value = view.plugin(plugin);
        if (!value || value.binding.presentation !== "wysiwyg") return Decoration.none;
        const tree = value.binding.getTree();
        const scope = value.binding.scopeNodeId
          ? tree.nodes.get(value.binding.scopeNodeId)
          : undefined;
        if (!scope) return Decoration.none;
        const text = view.state.doc.sliceString(scope.heading.from, scope.heading.to);
        const m = /^(#{1,6})[ \t]+/.exec(text);
        if (!m) return Decoration.none;
        return Decoration.set([
          hideMarker.range(scope.heading.from, scope.heading.from + m[0].length),
        ]);
      }),
  },
);

export const synopticTheme = EditorView.theme({
  ".cm-line.cm-synoptic-scope-hidden": {
    display: "block",
    visibility: "hidden",
    height: "0",
    minHeight: "0",
    maxHeight: "0",
    lineHeight: "0",
    fontSize: "0",
    padding: "0",
    margin: "0",
    border: "none",
    overflow: "hidden",
  },
  ".cm-synoptic-passive-caret": {
    borderLeft: "2px solid #888",
    marginLeft: "-1px",
    pointerEvents: "none",
  },
});
