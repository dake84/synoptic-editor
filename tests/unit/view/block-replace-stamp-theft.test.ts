// @vitest-environment happy-dom

/**
 *
 * Empirical check of the project lore about `block: true` vs next-heading
 * line decorations (stamps). Documents what CM6 actually does today.
 *
 * Lore sources: `frontmatter-hide.ts`, `AGENTS.md` (heading chrome), SPEC § 11.1.
 *
 * @covers FM9, HS1, I6
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

import {
  protectedWidgetExtension,
  type ProtectedRange,
} from "../../../src/view/widgets/protected.js";

const DOC = ["## Alpha", "alpha body", "## Beta", "beta body"].join("\n");

/** Doc with FM between headings — the frontmatter-hide lore scenario. */
const DOC_FM = ["## Alpha", "", "---", "id: beta", "---", "", "## Beta", "beta body"].join("\n");

function headingLines(doc: string): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  let pos = 0;
  for (const text of doc.split("\n")) {
    if (/^#{1,6}[ \t]/.test(text)) {
      out.push({ from: pos, to: pos + text.length, text });
    }
    pos += text.length + 1;
  }
  return out;
}

function stampField(): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      const builder = new RangeSetBuilder<Decoration>();
      headingLines(state.doc.toString()).forEach((h, i) => {
        builder.add(
          h.from,
          h.from,
          Decoration.line({
            class: `probe-stamp probe-stamp-${i}`,
            attributes: { "data-probe-stamp": String(i) },
          }),
        );
      });
      return builder.finish();
    },
    update(value, tr) {
      return tr.docChanged ? this.create!(tr.state) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

class ProbeWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(other: ProbeWidget): boolean {
    return other.label === this.label;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "probe-widget";
    el.textContent = this.label;
    return el;
  }
}

function inlineTitleReplaceField(): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      const first = headingLines(state.doc.toString())[0];
      if (!first) return Decoration.none;
      const mark = /^(#{1,6}[ \t])/.exec(first.text);
      const titleFrom = first.from + (mark?.[1]?.length ?? 0);
      const builder = new RangeSetBuilder<Decoration>();
      builder.add(
        titleFrom,
        first.to,
        Decoration.replace({ widget: new ProbeWidget("inline-alpha") }),
      );
      return builder.finish();
    },
    update(value, tr) {
      return tr.docChanged ? this.create!(tr.state) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function blockRangeField(from: number, to: number, label: string): Extension {
  return StateField.define<DecorationSet>({
    create() {
      const builder = new RangeSetBuilder<Decoration>();
      builder.add(from, to, Decoration.replace({ widget: new ProbeWidget(label), block: true }));
      return builder.finish();
    },
    update(value) {
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function protectedRange(from: number, to: number): Extension {
  const ranges = StateField.define<ProtectedRange[]>({
    create: () => [{ from, to }],
    update: (value) => value,
  });
  return [ranges, protectedWidgetExtension(ranges, () => new ProbeWidget("protected"))];
}

function mount(doc: string, extra: Extension): { parent: HTMLElement; view: EditorView } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [stampField(), extra],
    }),
  });
  return { parent, view };
}

function observeBeta(parent: HTMLElement) {
  const stamp1 = parent.querySelector(".cm-line.probe-stamp-1");
  const betaLine = [...parent.querySelectorAll(".cm-line")].find((el) =>
    (el.textContent ?? "").includes("Beta"),
  );
  return {
    hasProbeStamp1: stamp1 != null,
    betaLineHasStamp: betaLine?.classList.contains("probe-stamp-1") ?? false,
    betaTextVisible: (parent.textContent ?? "").includes("Beta"),
    lines: [...parent.querySelectorAll(".cm-line")].map((el) => ({
      text: (el.textContent ?? "").slice(0, 40),
      classes: el.className,
    })),
  };
}

describe("block replace vs next-heading stamps (empirical)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("baseline: both ATX lines carry probe-stamp classes", () => {
    const { parent, view } = mount(DOC, []);
    expect(observeBeta(parent).hasProbeStamp1).toBe(true);
    view.destroy();
  });

  it("inline title replace (host title chrome): Beta keeps probe-stamp-1", () => {
    const { parent, view } = mount(DOC, inlineTitleReplaceField());
    expect(observeBeta(parent).hasProbeStamp1).toBe(true);
    view.destroy();
  });

  it("block:true on first heading line only (no trailing \\n): Beta keeps stamp", () => {
    const alpha = headingLines(DOC)[0]!;
    const { parent, view } = mount(DOC, blockRangeField(alpha.from, alpha.to, "block"));
    expect(observeBeta(parent).hasProbeStamp1).toBe(true);
    view.destroy();
  });

  it("block:true on first heading including trailing \\n: Beta keeps stamp", () => {
    const alpha = headingLines(DOC)[0]!;
    const { parent, view } = mount(DOC, blockRangeField(alpha.from, alpha.to + 1, "block+nl"));
    // Observed 2026-08-20: AGENTS "steals next ATX" lore does NOT hold for this range.
    expect(observeBeta(parent).hasProbeStamp1).toBe(true);
    view.destroy();
  });

  it("protectedWidgetExtension on first heading+\\n: Beta keeps stamp", () => {
    const alpha = headingLines(DOC)[0]!;
    const { parent, view } = mount(DOC, protectedRange(alpha.from, alpha.to + 1));
    expect(observeBeta(parent).hasProbeStamp1).toBe(true);
    view.destroy();
  });

  /**
   * The frontmatter-hide comment: one block replace over a zone *ending at*
   * the next heading steals that heading's stamps.
   */
  it("block:true zone ending at Beta.from: documents stamp fate on Beta", () => {
    const heads = headingLines(DOC_FM);
    const alpha = heads[0]!;
    const beta = heads[1]!;
    const from = alpha.to + 1;
    const to = beta.from;
    const { parent, view } = mount(DOC_FM, blockRangeField(from, to, "fm-zone"));
    const obs = observeBeta(parent);
    // Capture observed behaviour; assert the decisive bit once known.
    expect(obs.hasProbeStamp1, JSON.stringify(obs, null, 2)).toBe(false);
    view.destroy();
  });

  it("same FM zone but per-line inline hide (current Synoptic): Beta keeps stamp", () => {
    const heads = headingLines(DOC_FM);
    const alpha = heads[0]!;
    const beta = heads[1]!;
    const from = alpha.to + 1;
    const to = beta.from;
    const perLine = StateField.define<DecorationSet>({
      create(state) {
        const builder = new RangeSetBuilder<Decoration>();
        const hide = Decoration.replace({});
        let pos = from;
        while (pos < to) {
          const line = state.doc.lineAt(pos);
          const end = Math.min(line.to, to);
          if (end > line.from) builder.add(line.from, end, hide);
          pos = line.to + 1;
        }
        return builder.finish();
      },
      update(value) {
        return value;
      },
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mount(DOC_FM, perLine);
    expect(observeBeta(parent).hasProbeStamp1).toBe(true);
    view.destroy();
  });
});
