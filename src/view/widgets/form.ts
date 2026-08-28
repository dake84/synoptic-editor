/**
 * Frontmatter form / hide widgets (SPEC.md § 8.2, FM1–FM8).
 */

import { Facet, RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { hiddenFrontmatterRanges, projectTree } from "../../core/tree.js";
import type { StructureSchema } from "../../core/types.js";
import type { ScopeRange } from "../scope.js";
import {
  buildHiddenFrontmatterDecorations,
  clipFrontmatterZones,
} from "../frontmatter-hide.js";
import { hostBlockReplaceRanges, overlapsHostBlockReplace } from "../host-block-replace.js";

export type FrontmatterMode = "form" | "hidden";

export interface FrontmatterWrite {
  /** Apply a field write as a document transaction (FM3). */
  write(blockFrom: number, key: string, value: string | null): void;
}

export const frontmatterWriteFacet = Facet.define<FrontmatterWrite, FrontmatterWrite | null>({
  combine: (v) => v[0] ?? null,
});

/** Row height inside `.syn-fm-form` (label + input). */
const FM_ROW_HEIGHT = 28;
/** Vertical padding 6+6 + border 1+1 (border-box). */
const FM_CHROME = 14;
/** Gap between rows. */
const FM_GAP = 4;

/** End height for a form with `fieldCount` rows (FM8). */
export function formBlockHeight(fieldCount: number): number {
  const n = Math.max(0, fieldCount);
  if (n === 0) return FM_CHROME;
  return FM_CHROME + n * FM_ROW_HEIGHT + Math.max(0, n - 1) * FM_GAP;
}

export class FrontmatterFormWidget extends WidgetType {
  constructor(
    readonly blockFrom: number,
    readonly fields: { key: string; value: string }[],
  ) {
    super();
  }

  override eq(other: FrontmatterFormWidget): boolean {
    return (
      this.blockFrom === other.blockFrom &&
      this.fields.length === other.fields.length &&
      this.fields.every((f, i) => f.key === other.fields[i]!.key && f.value === other.fields[i]!.value)
    );
  }

  override get estimatedHeight(): number {
    return formBlockHeight(this.fields.length);
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "syn-fm-form";
    root.setAttribute("contenteditable", "false");
    root.dataset.blockFrom = String(this.blockFrom);
    const h = formBlockHeight(this.fields.length);
    root.style.height = `${h}px`;
    root.style.boxSizing = "border-box";
    root.style.overflow = "hidden";
    for (const field of this.fields) {
      const row = document.createElement("label");
      row.className = "syn-fm-row";
      row.style.height = `${FM_ROW_HEIGHT}px`;
      row.style.boxSizing = "border-box";
      const name = document.createElement("span");
      name.textContent = field.key;
      const input = document.createElement("input");
      input.type = "text";
      input.value = field.value;
      input.dataset.key = field.key;
      input.addEventListener("change", () => {
        const writer = view.state.facet(frontmatterWriteFacet);
        const next = input.value;
        const blockFrom = Number(root.dataset.blockFrom);
        writer?.write(blockFrom, field.key, next === "" ? null : next);
      });
      row.append(name, input);
      root.appendChild(row);
    }
    return root;
  }

  /**
   * true = editor ignores the event (default). false made clicks set the caret
   * past the atomic FM range instead of focusing the inputs.
   */
  override ignoreEvent(): boolean {
    return true;
  }

  override updateDOM(dom: HTMLElement): boolean {
    dom.dataset.blockFrom = String(this.blockFrom);
    const h = formBlockHeight(this.fields.length);
    dom.style.height = `${h}px`;
    for (const field of this.fields) {
      const input = dom.querySelector(`input[data-key="${cssEscape(field.key)}"]`) as HTMLInputElement | null;
      if (!input) return false;
      if (document.activeElement !== input) input.value = field.value;
    }
    return this.fields.length === dom.querySelectorAll("input[data-key]").length;
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFrontmatterDecos(
  state: EditorState,
  range: ScopeRange,
  schema: StructureSchema,
  mode: FrontmatterMode,
): DecorationSet {
  if (range.lost) return Decoration.none;
  const doc = state.doc.toString();
  const hostOwned = state.facet(hostBlockReplaceRanges);
  if (mode === "hidden") {
    const zones = clipFrontmatterZones(hiddenFrontmatterRanges(doc, schema), range.from, range.to).filter(
      (z) => !overlapsHostBlockReplace(z, hostOwned),
    );
    return buildHiddenFrontmatterDecorations(state, zones);
  }
  const tree = projectTree(doc, schema);
  const builder = new RangeSetBuilder<Decoration>();
  const nodes = [...tree.nodes.values()]
    .filter((n) => n.frontmatter)
    .sort((a, b) => a.frontmatter!.from - b.frontmatter!.from);
  for (const node of nodes) {
    const fm = node.frontmatter!;
    if (fm.to <= range.from || fm.from >= range.to) continue;
    if (overlapsHostBlockReplace(fm, hostOwned)) continue;
    const from = Math.max(fm.from, range.from);
    const to = Math.min(fm.to, range.to);
    if (from >= to) continue;
    const parsed = parseFrontmatterBlock(doc, fm);
    const fields = parsed.fields.map((f) => ({ key: f.key, value: f.value }));
    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new FrontmatterFormWidget(fm.from, fields),
        block: true,
      }),
    );
  }
  return builder.finish();
}

export function frontmatterField(
  rangeField: StateField<ScopeRange>,
  schema: StructureSchema,
  mode: FrontmatterMode,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildFrontmatterDecos(state, state.field(rangeField), schema, mode);
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      const hostChanged =
        tr.state.facet(hostBlockReplaceRanges) !== tr.startState.facet(hostBlockReplaceRanges);
      if (
        !tr.docChanged &&
        r.from === prev.from &&
        r.to === prev.to &&
        r.lost === prev.lost &&
        !hostChanged
      ) {
        return value;
      }
      return buildFrontmatterDecos(tr.state, r, schema, mode);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

/** Atomic ranges covering frontmatter so caret cannot enter raw YAML (FM1/FM2). */
export function frontmatterAtomField(
  rangeField: StateField<ScopeRange>,
  schema: StructureSchema,
): StateField<DecorationSet> {
  const atom = Decoration.mark({});
  return StateField.define<DecorationSet>({
    create(state) {
      return buildFmAtoms(state.doc.toString(), state.field(rangeField), schema, atom);
    },
    update(value, tr) {
      const r = tr.state.field(rangeField);
      const prev = tr.startState.field(rangeField);
      if (!tr.docChanged && r.from === prev.from && r.to === prev.to && r.lost === prev.lost) return value;
      return buildFmAtoms(tr.state.doc.toString(), r, schema, atom);
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

function buildFmAtoms(
  doc: string,
  range: ScopeRange,
  schema: StructureSchema,
  atom: Decoration,
): DecorationSet {
  if (range.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const zone of hiddenFrontmatterRanges(doc, schema)) {
    if (zone.to <= range.from || zone.from >= range.to) continue;
    const from = Math.max(zone.from, range.from);
    const to = Math.min(zone.to, range.to);
    if (from < to) builder.add(from, to, atom);
  }
  return builder.finish();
}
