/**
 * Metadata pills under headings (SPEC.md § 8.4, P1–P5).
 */

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { fieldByKey, parseFrontmatterBlock } from "../../core/frontmatter.js";
import { projectTree } from "../../core/tree.js";
import type { StructureSchema } from "../../core/types.js";
import { findQueryOf } from "../find-decorations.js";
import type { ScopeRange } from "../scope.js";

class PillWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly value: string,
    readonly highlight: string | null,
  ) {
    super();
  }

  eq(other: PillWidget): boolean {
    return this.key === other.key && this.value === other.value && this.highlight === other.highlight;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "syn-pill";
    el.setAttribute("contenteditable", "false");
    el.dataset.key = this.key;
    if (this.highlight && this.value.includes(this.highlight)) {
      const i = this.value.indexOf(this.highlight);
      if (i > 0) el.append(document.createTextNode(this.value.slice(0, i)));
      const mark = document.createElement("mark");
      mark.className = "syn-pill-hit";
      mark.textContent = this.highlight;
      el.append(mark);
      const rest = this.value.slice(i + this.highlight.length);
      if (rest) el.append(document.createTextNode(rest));
    } else {
      el.textContent = `${this.key}: ${this.value}`;
    }
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function pillField(
  rangeField: StateField<ScopeRange>,
  schema: StructureSchema,
  pillFields: readonly string[],
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildPills(
        state.doc.toString(),
        state.field(rangeField),
        schema,
        pillFields,
        findQueryOf(state) || null,
      );
    },
    update(_value, tr) {
      const r = tr.state.field(rangeField);
      return buildPills(
        tr.state.doc.toString(),
        r,
        schema,
        pillFields,
        findQueryOf(tr.state) || null,
      );
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildPills(
  doc: string,
  range: ScopeRange,
  schema: StructureSchema,
  pillFields: readonly string[],
  highlight: string | null,
): DecorationSet {
  if (range.lost || pillFields.length === 0) return Decoration.none;
  const tree = projectTree(doc, schema);
  const builder = new RangeSetBuilder<Decoration>();
  const nodes = [...tree.nodes.values()].sort((a, b) => a.heading.to - b.heading.to);
  for (const node of nodes) {
    if (!node.frontmatter) continue;
    if (node.heading.to < range.from || node.heading.to > range.to) continue;
    const parsed = parseFrontmatterBlock(doc, node.frontmatter);
    for (const key of pillFields) {
      const field = fieldByKey(parsed, key);
      if (!field || field.value === "") continue;
      const hit =
        highlight && field.value.includes(highlight) ? highlight : null;
      builder.add(
        node.heading.to,
        node.heading.to,
        Decoration.widget({
          widget: new PillWidget(key, field.value, hit),
          side: 1,
          block: true,
        }),
      );
    }
  }
  return builder.finish();
}
