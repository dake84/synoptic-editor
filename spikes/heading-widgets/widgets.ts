/**
 * Spike heading-slot widgets — height contract only (not host chrome).
 *
 * Modes:
 *   broken  — estimatedHeight always 48; toDOM paints full expanded chrome
 *   correct — estimatedHeight matches synchronous toDOM height (C)
 *   late    — like broken, then queueMicrotask stretches + requestMeasure
 */

import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { projectTree } from "../../src/core/tree.js";
import type { StructureSchema } from "../../src/core/types.js";

/** Collapsed: padding 8+8 + title 24 = 40. Expanded adds meta 56 + gap 8 = 104 → 40+64 = 104. */
export const SLOT_COLLAPSED = 40;
export const SLOT_EXPANDED = 104;
/** Host-bug fallback estimate (too short). */
export const SLOT_BROKEN_ESTIMATE = 48;

export type SlotMode = "broken" | "correct" | "late";

export const toggleSlotEffect = StateEffect.define<{ nodeId: string }>();

export const slotExpandedField = StateField.define<ReadonlyMap<string, boolean>>({
  create: () => new Map(),
  update(value, tr) {
    let next: Map<string, boolean> | null = null;
    for (const e of tr.effects) {
      if (!e.is(toggleSlotEffect)) continue;
      if (!next) next = new Map(value);
      const cur = next.get(e.value.nodeId) ?? true; // default expanded (large)
      next.set(e.value.nodeId, !cur);
    }
    return next ?? value;
  },
});

export class CollapsibleHeadingWidget extends WidgetType {
  constructor(
    readonly nodeId: string,
    readonly title: string,
    readonly expanded: boolean,
    readonly mode: SlotMode,
  ) {
    super();
  }

  override eq(other: CollapsibleHeadingWidget): boolean {
    return (
      this.nodeId === other.nodeId &&
      this.title === other.title &&
      this.expanded === other.expanded &&
      this.mode === other.mode
    );
  }

  override get estimatedHeight(): number {
    if (this.mode === "broken" || this.mode === "late") return SLOT_BROKEN_ESTIMATE;
    return this.expanded ? SLOT_EXPANDED : SLOT_COLLAPSED;
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "spike-heading-slot";
    root.dataset.nodeId = this.nodeId;
    root.dataset.mode = this.mode;
    root.dataset.expanded = this.expanded ? "true" : "false";
    root.setAttribute("contenteditable", "false");

    const title = document.createElement("div");
    title.className = "spike-heading-title";
    const caret = document.createElement("span");
    caret.className = "spike-heading-caret";
    caret.textContent = this.expanded ? "▾" : "▸";
    const label = document.createElement("span");
    label.textContent = this.title;
    title.append(caret, label);

    const meta = document.createElement("div");
    meta.className = "spike-heading-meta";
    for (const text of [`id=${this.nodeId}`, "status=open", "owner=spike"]) {
      const pill = document.createElement("span");
      pill.className = "spike-pill-dummy";
      pill.textContent = text;
      meta.appendChild(pill);
    }
    if (!this.expanded) meta.hidden = true;

    const applyHeight = (px: number) => {
      root.style.height = `${px}px`;
      root.dataset.paintedHeight = String(px);
    };

    const finalH = this.expanded ? SLOT_EXPANDED : SLOT_COLLAPSED;

    if (this.mode === "correct") {
      applyHeight(finalH);
    } else if (this.mode === "broken") {
      // Wrong estimate (48); paint full natural height immediately — jump when virtualized in.
      applyHeight(finalH);
    } else {
      // late: short fallback, then microtask stretch + measure (host bug)
      applyHeight(SLOT_BROKEN_ESTIMATE);
      queueMicrotask(() => {
        applyHeight(finalH);
        view.requestMeasure();
      });
    }

    const toggle = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      view.dispatch({ effects: toggleSlotEffect.of({ nodeId: this.nodeId }) });
    };
    title.addEventListener("mousedown", toggle);
    caret.addEventListener("mousedown", toggle);

    root.append(title, meta);
    return root;
  }

  override ignoreEvent(event: Event): boolean {
    return !(event.type === "mousedown" || event.type === "click");
  }
}

function buildSlotDecos(
  doc: string,
  schema: StructureSchema,
  expanded: ReadonlyMap<string, boolean>,
  mode: SlotMode,
): DecorationSet {
  const tree = projectTree(doc, schema);
  const builder = new RangeSetBuilder<Decoration>();
  const nodes = [...tree.nodes.values()].sort((a, b) => a.heading.to - b.heading.to);
  for (const node of nodes) {
    // Skip the document root chrome slot — sections under root are the scroll targets.
    if (node.id === "root") continue;
    const isExpanded = expanded.get(node.id) ?? true;
    builder.add(
      node.heading.to,
      node.heading.to,
      Decoration.widget({
        widget: new CollapsibleHeadingWidget(node.id, node.title, isExpanded, mode),
        side: 1,
        block: true,
      }),
    );
  }
  return builder.finish();
}

export function collapsibleHeadingExtension(schema: StructureSchema, mode: SlotMode): Extension {
  const decoField = StateField.define<DecorationSet>({
    create(state) {
      return buildSlotDecos(state.doc.toString(), schema, state.field(slotExpandedField), mode);
    },
    update(_value, tr) {
      return buildSlotDecos(tr.state.doc.toString(), schema, tr.state.field(slotExpandedField), mode);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [slotExpandedField, decoField];
}
