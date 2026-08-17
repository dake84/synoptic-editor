/**
 * Per-line frontmatter hide (FM1/FM9).
 *
 * A single `Decoration.replace({ block: true })` over a zone ending at the next
 * heading steals that heading's line decorations (stamps). Hide each line with
 * an inline replace plus a collapsed line class instead.
 */

import {
  RangeSetBuilder,
  StateField,
  type EditorState as EditorStateType,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { hiddenFrontmatterRanges } from "../core/tree.js";
import type { Range, StructureSchema } from "../core/types.js";
import {
  frontmatterLockFilter,
  type FrontmatterLockOpts,
  type FrontmatterSchemaArg,
} from "./guards/wysiwyg.js";

export type { FrontmatterSchemaArg };

export function resolveFrontmatterSchema(
  schema: FrontmatterSchemaArg,
  state: EditorStateType,
): StructureSchema {
  return typeof schema === "function" ? schema(state) : schema;
}

const hiddenLineDeco = Decoration.line({
  class: "syn-fm-hidden-line",
  attributes: { "aria-hidden": "true" },
});

const fmAtomMark = Decoration.mark({});

/** Clip hidden FM zones to `[clipFrom, clipTo)` and drop empties. */
export function clipFrontmatterZones(
  zones: readonly Range[],
  clipFrom: number,
  clipTo: number,
): Range[] {
  const out: Range[] = [];
  for (const zone of zones) {
    const from = Math.max(zone.from, clipFrom);
    const to = Math.min(zone.to, clipTo);
    if (to > from) out.push({ from, to });
  }
  return out;
}

/**
 * Collapse hidden FM zones to zero-height lines without a block widget.
 */
export function buildHiddenFrontmatterDecorations(
  state: EditorStateType,
  zones: readonly Range[],
): DecorationSet {
  if (zones.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const zone of zones) {
    let pos = zone.from;
    while (pos < zone.to) {
      const line = state.doc.lineAt(Math.min(pos, state.doc.length));
      const contentFrom = Math.max(line.from, zone.from);
      const contentTo = Math.min(line.to, zone.to);
      const lineStartsInZone = line.from >= zone.from && line.from < zone.to;

      if (lineStartsInZone) {
        builder.add(line.from, line.from, hiddenLineDeco);
      }
      if (contentTo > contentFrom) {
        builder.add(contentFrom, contentTo, Decoration.replace({}));
      }

      if (line.number >= state.doc.lines) break;
      const nextFrom = state.doc.line(line.number + 1).from;
      if (nextFrom <= pos) break;
      pos = nextFrom;
    }
  }
  return builder.finish();
}

function hiddenZones(state: EditorStateType, schema: FrontmatterSchemaArg): Range[] {
  return hiddenFrontmatterRanges(state.doc.toString(), resolveFrontmatterSchema(schema, state));
}

function hiddenDecoField(schema: FrontmatterSchemaArg): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildHiddenFrontmatterDecorations(state, hiddenZones(state, schema));
    },
    update(_value, tr) {
      return buildHiddenFrontmatterDecorations(tr.state, hiddenZones(tr.state, schema));
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function hiddenAtomField(schema: FrontmatterSchemaArg): StateField<DecorationSet> {
  const build = (state: EditorStateType): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const zone of hiddenZones(state, schema)) {
      if (zone.to > zone.from) builder.add(zone.from, zone.to, fmAtomMark);
    }
    return builder.finish();
  };
  return StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (!tr.docChanged) return value;
      return build(tr.state);
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

/**
 * Isolated wysiwyg mount: hide + atomic + edit lock (FM1/FM2).
 * Selection parking stays with the host when it owns a typeable park-blank
 * inside a padded zone (empty section after a heading).
 * Session chrome already composes hide/atom/lock; do not mount this on top of it.
 */
export function hiddenFrontmatterGuards(
  schema: FrontmatterSchemaArg,
  opts?: FrontmatterLockOpts,
): Extension {
  return [hiddenDecoField(schema), hiddenAtomField(schema), frontmatterLockFilter(schema, opts)];
}
