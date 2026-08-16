/**
 * Recipe: protected (non-editable, non-deletable) heading widget.
 *
 * Presentation-layer code — deliberately lives outside `synoptic-editor`'s
 * published `src/`; see recipes/README.md. Wraps the generic mechanics in
 * src/view/widgets/protected.ts (atomicity + deletion filter, which stay in
 * `src/` because they must interoperate with the session's own transaction
 * guards) with host-owned DOM. Wired into spikes/heading-widgets/main.ts.
 */

import { StateField, type Extension } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import { protectedWidgetExtension, type ProtectedRange } from "../src/view/widgets/protected.js";
import { projectTree } from "../src/core/tree.js";
import type { StructureSchema } from "../src/core/types.js";

class ProtectedHeadingWidget extends WidgetType {
  constructor(
    readonly text: string,
    /** Sub-range of `text` (widget-local offsets) that is the active find hit. */
    readonly activeMatch: { from: number; to: number } | null,
  ) {
    super();
  }

  override eq(other: ProtectedHeadingWidget): boolean {
    return (
      this.text === other.text &&
      this.activeMatch?.from === other.activeMatch?.from &&
      this.activeMatch?.to === other.activeMatch?.to
    );
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "spike-protected-heading";
    el.setAttribute("contenteditable", "false");
    const m = this.activeMatch;
    if (m && m.to > m.from) {
      el.append(
        document.createTextNode(this.text.slice(0, m.from)),
        Object.assign(document.createElement("mark"), {
          className: "spike-protected-hit",
          textContent: this.text.slice(m.from, m.to),
        }),
        document.createTextNode(this.text.slice(m.to)),
      );
    } else {
      el.textContent = this.text;
    }
    return el;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function headingRanges(doc: string, schema: StructureSchema): ProtectedRange[] {
  const tree = projectTree(doc, schema);
  return [...tree.nodes.values()]
    .filter((n) => n.id !== "root" && n.heading.to > n.heading.from)
    .map((n) => ({ from: n.heading.from, to: n.heading.to }));
}

export function protectedHeadingRangesField(schema: StructureSchema): StateField<ProtectedRange[]> {
  return StateField.define<ProtectedRange[]>({
    create(state) {
      return headingRanges(state.doc.toString(), schema);
    },
    update(value, tr) {
      if (!tr.docChanged) return value;
      return headingRanges(tr.state.doc.toString(), schema);
    },
  });
}

/**
 * Returns the extension plus the `rangesField` instance it installed — callers
 * that need to read current protected ranges back out of `EditorState` (e.g. to
 * decide whether a find hit needs widget-side highlighting) must reuse this
 * exact field reference; `StateField.define` mints a new identity on every call.
 */
export function protectedHeadingExtension(schema: StructureSchema): {
  extension: Extension;
  rangesField: StateField<ProtectedRange[]>;
} {
  const rangesField = protectedHeadingRangesField(schema);
  const extension = [
    rangesField,
    protectedWidgetExtension(rangesField, (doc, range, activeMatch) => {
      const text = doc.slice(range.from, range.to);
      const local = activeMatch ? { from: activeMatch.from - range.from, to: activeMatch.to - range.from } : null;
      return new ProtectedHeadingWidget(text, local);
    }),
  ];
  return { extension, rangesField };
}
