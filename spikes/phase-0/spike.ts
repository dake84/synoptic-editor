/**
 * Fresh Phase-0 spike (SPEC.md § 16.1 / G1–G3).
 *
 * Split-view concept, star wiring — not the split-example A↔B net:
 *   - one SessionEditorState (EditorState, no EditorView)
 *   - one EditorState per view, same Text as the session
 *   - document ChangeSets go session → every view
 *   - selection is never forwarded
 *
 * Two scenes:
 *   1. identical range: source | wysiwyg on the whole document
 *   2. nested scopes: A subtree | A1 own | A2 own
 */

import {
  Annotation,
  ChangeSet,
  EditorState,
  EditorSelection,
  Facet,
  Prec,
  RangeSetBuilder,
  StateField,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";

/** Nested sample document: one parent, two children. */
export const SPIKE_DOC = `# A

A body

## A1

A1 body

## A2

A2 body
`;

/**
 * Session-owned CM6 EditorState with no EditorView.
 * This is the one text truth; views project it, they do not hold a shorter buffer.
 */
export type SessionEditorState = EditorState;

export type Include = "own" | "subtree" | "document";
export type Presentation = "source" | "wysiwyg";

export const syncAnnotation = Annotation.define<boolean>();

/** ATX atom/hide: hashes plus exactly one separator. Extra spaces are title (L4). */
const HEADING_MARKER = /^(#{1,6}[ \t])/gm;

export interface Section {
  id: string;
  rank: number;
  from: number;
  ownTo: number;
  subtreeTo: number;
  markerFrom: number;
  markerTo: number;
}

export function sectionsOf(doc: string): Section[] {
  const heading = /^(#{1,6})[ \t]+(.+)$/gm;
  const found: { id: string; rank: number; from: number; markerTo: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = heading.exec(doc))) {
    const marks = m[1]!;
    found.push({
      id: m[2]!.trim(),
      rank: marks.length,
      from: m.index,
      markerTo: m.index + marks.length + 1,
    });
  }
  return found.map((h, i) => {
    let ownTo = doc.length;
    let subtreeTo = doc.length;
    for (let j = i + 1; j < found.length; j++) {
      const n = found[j]!;
      if (n.rank > h.rank) {
        if (ownTo === doc.length) ownTo = n.from;
        continue;
      }
      if (ownTo === doc.length) ownTo = n.from;
      subtreeTo = n.from;
      break;
    }
    return {
      id: h.id,
      rank: h.rank,
      from: h.from,
      ownTo,
      subtreeTo,
      markerFrom: h.from,
      markerTo: h.markerTo,
    };
  });
}

export function rangeTo(section: Section, include: Include): number {
  return include === "subtree" ? section.subtreeTo : section.ownTo;
}

/** Resolve by title. No sibling fallback — a missing scope must not adopt a neighbour. */
export function resolveSection(doc: string, scopeId: string, _scopeIndex?: number): Section | undefined {
  return sectionsOf(doc).find((s) => s.id === scopeId);
}

export function renderRange(
  doc: string,
  scopeId: string,
  scopeIndex: number,
  include: Include,
): { from: number; to: number } | undefined {
  if (include === "document") return { from: 0, to: doc.length };
  const section = resolveSection(doc, scopeId, scopeIndex);
  if (!section) return undefined;
  return { from: section.from, to: rangeTo(section, include) };
}

/** Live excerpt of a view. Mapped through changes — not re-resolved by title (I6). */
export interface ScopeRange {
  from: number;
  to: number;
  /** True after a foreign change emptied this excerpt. Host may close the tab. */
  lost: boolean;
}

export interface ScopeLostEvent {
  viewId: string;
}

export const scopeRangeFacet = Facet.define<ScopeRange | null, ScopeRange | null>({
  combine: (values) => values[0] ?? null,
});

export function viewRange(state: EditorState): ScopeRange | null {
  return state.facet(scopeRangeFacet);
}

/** Inserts at `from` stay inside (assoc -1); inserts at exclusive `to` stay outside (assoc 1). */
export function mapScopeRange(range: ScopeRange, changes: ChangeSet, docLen: number): ScopeRange {
  const from = Math.max(0, Math.min(changes.mapPos(range.from, -1), docLen));
  const to = Math.max(from, Math.min(changes.mapPos(range.to, 1), docLen));
  return { from, to, lost: range.lost };
}

function scopeRangeField(scopeId: string, scopeIndex: number, include: Include): StateField<ScopeRange | null> {
  return StateField.define<ScopeRange | null>({
    create(state) {
      if (include === "document") return { from: 0, to: state.doc.length, lost: false };
      const r = renderRange(state.doc.toString(), scopeId, scopeIndex, include);
      return r ? { ...r, lost: false } : null;
    },
    update(value, tr) {
      if (include === "document") return { from: 0, to: tr.state.doc.length, lost: false };
      if (!value) return value;
      if (!tr.docChanged) return value;
      const mapped = mapScopeRange(value, tr.changes, tr.newDoc.length);
      if (value.lost) return { ...mapped, lost: true };
      const foreignEmpty =
        !!tr.annotation(syncAnnotation) && value.to > value.from && mapped.to <= mapped.from;
      return { ...mapped, lost: foreignEmpty };
    },
    provide: (field) => scopeRangeFacet.from(field),
  });
}

function headingMarkers(doc: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const re = new RegExp(HEADING_MARKER.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    out.push({ from: m.index, to: m.index + m[1]!.length });
  }
  return out;
}

/**
 * Hide neighbour text with an inline replace — not `block: true`.
 * A block widget before the first visible line drew an empty first line in A1/A2.
 * inclusiveStart/End false: a caret on the boundary types into the visible section.
 */
const hideRange = Decoration.replace({
  inclusiveStart: false,
  inclusiveEnd: false,
});
const hideMarker = Decoration.replace({});
const hideMask = Decoration.replace({});

const META = new Set(["#", "*", "_", ">", "`", "<", "\\", "-"]);

/** Positions of L2 mask backslashes inside [from, to). Wysiwyg hides them so `\#` reads as `#`. */
export function maskBackslashRanges(doc: string, from: number, to: number): { from: number; to: number }[] {
  return maskPairs(doc, from, to).map((p) => ({ from: p.from, to: p.from + 1 }));
}

/** Whole `\#` pairs — one visible character in wysiwyg. */
export function maskPairs(doc: string, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let i = from; i < to; i++) {
    if (doc[i] !== "\\") continue;
    const next = doc[i + 1];
    if (next !== undefined && META.has(next) && i + 2 <= to) {
      out.push({ from: i, to: i + 2 });
      i++;
    }
  }
  return out;
}

function buildWysiwygDecorations(doc: string, from: number, to: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (from > 0) builder.add(0, from, hideRange);
  const inlines: { from: number; to: number; deco: Decoration }[] = [];
  for (const r of headingMarkers(doc)) {
    if (r.from < from || r.to > to) continue;
    if (r.to > r.from) inlines.push({ from: r.from, to: r.to, deco: hideMarker });
  }
  for (const r of maskBackslashRanges(doc, from, to)) {
    inlines.push({ from: r.from, to: r.to, deco: hideMask });
  }
  inlines.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const r of inlines) builder.add(r.from, r.to, r.deco);
  if (to < doc.length) builder.add(to, doc.length, hideRange);
  return builder.finish();
}

function hideOutside(doc: string, from: number, to: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (from > 0) builder.add(0, from, hideRange);
  if (to < doc.length) builder.add(to, doc.length, hideRange);
  return builder.finish();
}

function hideAll(doc: string): DecorationSet {
  if (doc.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(0, doc.length, hideRange);
  return builder.finish();
}

function hideOutsideField(rangeField: StateField<ScopeRange | null>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      const doc = state.doc.toString();
      const r = state.field(rangeField);
      return r && !r.lost ? hideOutside(doc, r.from, r.to) : hideAll(doc);
    },
    update(_value, tr) {
      if (!tr.docChanged) return _value;
      const doc = tr.state.doc.toString();
      const r = tr.state.field(rangeField);
      return r && !r.lost ? hideOutside(doc, r.from, r.to) : hideAll(doc);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function wysiwygDecorationField(rangeField: StateField<ScopeRange | null>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      const doc = state.doc.toString();
      const r = state.field(rangeField);
      return r && !r.lost ? buildWysiwygDecorations(doc, r.from, r.to) : hideAll(doc);
    },
    update(_value, tr) {
      if (!tr.docChanged) return _value;
      const doc = tr.state.doc.toString();
      const r = tr.state.field(rangeField);
      return r && !r.lost ? buildWysiwygDecorations(doc, r.from, r.to) : hideAll(doc);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const atomMark = Decoration.mark({});

/** Wysiwyg atoms (L1): heading markers (`## `) and `\#` pairs. Source has neither. */
function wysiwygAtomField(rangeField: StateField<ScopeRange | null>): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildWysiwygAtoms(state.doc.toString(), state.field(rangeField));
    },
    update(value, tr) {
      if (!tr.docChanged) return value;
      return buildWysiwygAtoms(tr.state.doc.toString(), tr.state.field(rangeField));
    },
    provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
  });
}

function buildWysiwygAtoms(doc: string, r: ScopeRange | null): DecorationSet {
  if (!r || r.lost) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = [
    ...headingMarkers(doc).filter((mk) => mk.from >= r.from && mk.to <= r.to && mk.to > mk.from),
    ...maskPairs(doc, r.from, r.to),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const p of ranges) builder.add(p.from, p.to, atomMark);
  return builder.finish();
}

/**
 * L2: mask typed markdown meta in one pass over the *original* insert.
 * Backslash is masked only when the user typed it — never when it is the
 * mask character we just inserted (that was the \\\\#### bug).
 */
export function escapeMarkdown(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === "-" && next !== undefined && /\s/.test(next)) {
      out += "\\-";
      continue;
    }
    if (ch === "#" || ch === "*" || ch === "_" || ch === ">" || ch === "`" || ch === "<" || ch === "\\") {
      out += `\\${ch}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Wysiwyg L1: Backspace/Delete immediately before a heading marker delete the
 * whole `## ` atom. Native editing is a no-op there — the marker is a
 * zero-width replace, and skipAtomic does not run without a keymap.
 */
export function headingAtomForDelete(
  doc: string,
  head: number,
  dir: "backward" | "forward",
): { from: number; to: number } | undefined {
  const markers = headingMarkers(doc);
  if (dir === "backward") {
    return markers.find((mk) => head === mk.to || (head >= mk.from && head < mk.to));
  }
  return markers.find(
    (mk) =>
      (head >= mk.from && head < mk.to) ||
      head === mk.from ||
      (head === mk.from - 1 && head >= 0 && doc[head] === "\n"),
  );
}

/** Forward delete in wysiwyg: heading atom first, else the newline after a heading line. */
export function wysiwygForwardDelete(doc: string, head: number): { from: number; to: number } | undefined {
  const atom = headingAtomForDelete(doc, head, "forward");
  if (atom) return atom;
  if (head < doc.length && doc[head] === "\n") return { from: head, to: head + 1 };
  return undefined;
}

export function wysiwygGuards(): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: "Backspace",
          run(view) {
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const mk = headingAtomForDelete(view.state.doc.toString(), sel.head, "backward");
            if (!mk) return false;
            view.dispatch({
              changes: { from: mk.from, to: mk.to, insert: "" },
              selection: EditorSelection.cursor(mk.from),
              userEvent: "delete.backward",
            });
            return true;
          },
        },
        {
          key: "Delete",
          run(view) {
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const range = wysiwygForwardDelete(view.state.doc.toString(), sel.head);
            if (!range) return false;
            view.dispatch({
              changes: { from: range.from, to: range.to, insert: "" },
              selection: EditorSelection.cursor(range.from),
              userEvent: "delete.forward",
            });
            return true;
          },
        },
      ]),
    ),
    EditorView.inputHandler.of((view, from, to, text) => {
      const escaped = escapeMarkdown(text);
      if (escaped === text) return false;
      view.dispatch({
        changes: { from, to, insert: escaped },
        selection: { anchor: from + escaped.length },
        filter: false,
        userEvent: "input.type",
      });
      return true;
    }),
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      if (tr.annotation(syncAnnotation)) return tr;

      const startDoc = tr.startState.doc.toString();
      const markers = headingMarkers(startDoc);
      const pairs = maskPairs(startDoc, 0, startDoc.length);
      let rewritten = false;
      const pieces: { from: number; to: number; insert: string }[] = [];

      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        let from = fromA;
        let to = toA;
        for (const mk of [...markers, ...pairs]) {
          const overlaps = from < mk.to && to > mk.from;
          const covers = from <= mk.from && to >= mk.to;
          if (overlaps && !covers) {
            from = Math.min(from, mk.from);
            to = Math.max(to, mk.to);
            rewritten = true;
          }
        }
        const raw = inserted.toString();
        const insert = escapeMarkdown(raw);
        if (insert !== raw) rewritten = true;
        pieces.push({ from, to, insert });
      });

      if (!rewritten) return tr;
      const userEvent = tr.annotation(Transaction.userEvent);
      return {
        changes: pieces,
        selection: tr.selection,
        filter: false,
        annotations: userEvent ? [Transaction.userEvent.of(userEvent)] : undefined,
      };
    }),
  ];
}

/**
 * After a change, the heading that currently starts at range.to must stay at
 * column 0 (or be gone only because the whole prefix including that heading was
 * replaced — not because a backspace joined it onto the previous line).
 */
export function nextHeadingStaysAtBol(tr: Transaction, to: number): boolean {
  if (to >= tr.startState.doc.length) return true;
  if (tr.startState.doc.sliceString(to, to + 1) !== "#") return true;
  const mapped = tr.changes.mapPos(to, 1);
  if (mapped < 0 || mapped > tr.newDoc.length) return true;
  const stillHash = mapped < tr.newDoc.length && tr.newDoc.sliceString(mapped, mapped + 1) === "#";
  if (!stillHash) return false;
  return mapped === 0 || tr.newDoc.sliceString(mapped - 1, mapped) === "\n";
}

/** Keep the caret inside the visible range. Cursor at exclusive `to` types into the neighbour. */
export function clipSelection(
  sel: EditorSelection,
  from: number,
  to: number,
  docLen: number,
  firstCaret = from,
): EditorSelection {
  const min = Math.min(Math.max(firstCaret, 0), docLen);
  const maxRange = Math.min(Math.max(to, min), docLen);
  const maxEmpty = maxRange < docLen && maxRange > min ? maxRange - 1 : maxRange;
  const ranges = sel.ranges.map((r) => {
    if (r.empty) {
      const p = Math.min(Math.max(r.head, min), maxEmpty);
      return EditorSelection.cursor(p, 1);
    }
    const a = Math.min(Math.max(r.anchor, min), maxRange);
    const h = Math.min(Math.max(r.head, min), maxRange);
    return EditorSelection.range(a, h);
  });
  return EditorSelection.create(ranges, sel.mainIndex);
}

/** Wysiwyg: an empty caret inside `## ` sits on the title, not inside the hidden atom. */
export function snapOutOfHeadingMarkers(
  sel: EditorSelection,
  doc: string,
  from: number,
  to: number,
): EditorSelection {
  const markers = headingMarkers(doc).filter((mk) => mk.from >= from && mk.to <= to);
  if (markers.length === 0) return sel;
  const ranges = sel.ranges.map((r) => {
    if (!r.empty) return r;
    for (const mk of markers) {
      if (r.head >= mk.from && r.head < mk.to) return EditorSelection.cursor(mk.to, 1);
    }
    return r;
  });
  return EditorSelection.create(ranges, sel.mainIndex);
}

function suppressOutside(range: ScopeRange, docLen: number): number[] | true {
  const suppress: number[] = [];
  if (range.from > 0) suppress.push(0, range.from);
  if (range.to < docLen) {
    const start = range.from < range.to ? range.to : range.to + 1;
    if (start < docLen) suppress.push(start, docLen);
  }
  return suppress.length > 0 ? suppress : true;
}

/** True if a change edits the neighbour past exclusive `to` (empty excerpt still cannot delete A2). */
function editsNeighbour(tr: Transaction, to: number): boolean {
  let bad = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (toA > to && fromA >= to) bad = true;
    if (fromA < to && toA > to) bad = true;
  });
  return bad;
}

/**
 * Scope fence (one place, I6): hide is visual; this keeps a neighbour uneditable
 * from this view. Sync-annotated transactions skip it so the star can still forward.
 * The excerpt is the sticky `rangeField`, not a title lookup.
 */
export function scopeFence(
  rangeField: StateField<ScopeRange | null>,
  caretAt: "from" | "title" = "from",
): Extension {
  return [
    EditorState.changeFilter.of((tr) => {
      if (!tr.docChanged || tr.annotation(syncAnnotation)) return true;
      const range = tr.startState.field(rangeField);
      if (!range || range.lost) return [0, tr.startState.doc.length];
      return suppressOutside(range, tr.startState.doc.length);
    }),
    EditorState.transactionFilter.of((tr) => {
      if (tr.annotation(syncAnnotation)) return tr;
      const range = tr.startState.field(rangeField);
      if (!range || range.lost) return tr.docChanged ? { changes: [], filter: false } : tr;
      if (tr.docChanged && editsNeighbour(tr, range.to)) {
        return { changes: [], filter: false };
      }
      if (tr.docChanged && !nextHeadingStaysAtBol(tr, range.to)) {
        return { changes: [], filter: false };
      }
      if (!tr.selection) return tr;
      const mapped = tr.docChanged ? mapScopeRange(range, tr.changes, tr.newDoc.length) : range;
      const docLen = tr.docChanged ? tr.newDoc.length : tr.startState.doc.length;
      const liveDoc = tr.docChanged ? tr.newDoc.toString() : tr.startState.doc.toString();
      const titleCaret =
        caretAt === "title"
          ? (headingMarkers(liveDoc).find((mk) => mk.from === mapped.from)?.to ?? mapped.from)
          : mapped.from;
      const clipped = clipSelection(tr.selection, mapped.from, mapped.to, docLen, titleCaret);
      const snapped = caretAt === "title" ? snapOutOfHeadingMarkers(clipped, liveDoc, mapped.from, mapped.to) : clipped;
      if (snapped.eq(tr.selection)) return tr;
      if (!tr.docChanged) return { selection: snapped };
      return { changes: tr.changes, selection: snapped };
    }),
    Prec.highest(
      keymap.of([
        {
          key: "Mod-a",
          run(view) {
            const range = view.state.field(rangeField);
            if (!range || range.lost) return true;
            view.dispatch({
              selection: EditorSelection.single(range.from, range.to),
            });
            return true;
          },
        },
      ]),
    ),
  ];
}

/** Copy/select-all is clipped to the view's current render range. Hide is visual; clipboard is not. */
export function clippedCopy(doc: string, selFrom: number, selTo: number, from: number, to: number): string {
  const start = Math.max(Math.min(selFrom, selTo), from);
  const end = Math.min(Math.max(selFrom, selTo), to);
  if (start >= end) return "";
  return doc.slice(start, end);
}

function scopeCopyHandler(rangeField: StateField<ScopeRange | null>): Extension {
  return EditorView.domEventHandlers({
    copy(event, view) {
      const range = view.state.field(rangeField);
      if (!range || range.lost || !event.clipboardData) return false;
      const sel = view.state.selection.main;
      event.clipboardData.setData(
        "text/plain",
        clippedCopy(view.state.doc.toString(), sel.from, sel.to, range.from, range.to),
      );
      event.preventDefault();
      return true;
    },
  });
}

export function sourceExtensions(scopeId: string, scopeIndex: number, include: Include): Extension {
  const rangeField = scopeRangeField(scopeId, scopeIndex, include);
  return [
    rangeField,
    hideOutsideField(rangeField),
    scopeFence(rangeField, "from"),
    scopeCopyHandler(rangeField),
  ];
}

export function wysiwygExtensions(scopeId: string, scopeIndex: number, include: Include): Extension {
  const rangeField = scopeRangeField(scopeId, scopeIndex, include);
  return [
    rangeField,
    wysiwygDecorationField(rangeField),
    wysiwygAtomField(rangeField),
    scopeFence(rangeField, "title"),
    wysiwygGuards(),
    scopeCopyHandler(rangeField),
  ];
}

export interface SpikeView {
  id: string;
  scopeId: string;
  scopeIndex: number;
  include: Include;
  presentation: Presentation;
  state: EditorState;
  view: EditorView | null;
  lostNotified: boolean;
}

export interface SpikeSession {
  sessionState: SessionEditorState;
  views: SpikeView[];
  /** Dispatcher surface: each view emits once when a foreign change empties its excerpt. */
  scopeLost: ScopeLostEvent[];
}

export interface ViewSpec {
  id: string;
  scopeId: string;
  scopeIndex: number;
  include: Include;
  presentation: Presentation;
  parent?: Element;
}

function composeChanges(trs: readonly Transaction[]): ChangeSet {
  let changes = trs[0]!.changes;
  for (let i = 1; i < trs.length; i++) changes = changes.compose(trs[i]!.changes);
  return changes;
}

function forwardFromSession(session: SpikeSession, originId: string, changes: ChangeSet): void {
  session.sessionState = session.sessionState.update({ changes, filter: false }).state;
  for (const slot of session.views) {
    if (slot.id === originId) continue;
    const fwd = slot.state.update({
      changes,
      annotations: [syncAnnotation.of(true)],
      filter: false,
    });
    if (slot.view) {
      slot.view.update([fwd]);
      slot.state = slot.view.state;
    } else {
      slot.state = fwd.state;
    }
  }
}

export function commitTransactions(session: SpikeSession, originId: string, trs: readonly Transaction[]): void {
  const origin = session.views.find((v) => v.id === originId);
  if (!origin) throw new Error(`unknown view ${originId}`);
  const changed = trs.some((tr) => tr.docChanged);
  if (!changed) {
    if (origin.view) {
      origin.view.update(trs);
      origin.state = origin.view.state;
    } else {
      origin.state = trs[trs.length - 1]!.state;
    }
    return;
  }
  const changes = composeChanges(trs);
  forwardFromSession(session, originId, changes);
  if (origin.view) {
    origin.view.update(trs);
    origin.state = origin.view.state;
  } else {
    origin.state = trs[trs.length - 1]!.state;
  }
  dispatchScopeLost(session);
}

function dispatchScopeLost(session: SpikeSession): void {
  for (const slot of session.views) {
    const range = viewRange(slot.state);
    if (!range?.lost || slot.lostNotified) continue;
    slot.lostNotified = true;
    session.scopeLost.push({ viewId: slot.id });
  }
}

export function applyOrigin(session: SpikeSession, originId: string, specs: TransactionSpec[]): void {
  const origin = session.views.find((v) => v.id === originId);
  if (!origin) throw new Error(`unknown view ${originId}`);
  const prepared = origin.state.update(...specs);
  commitTransactions(session, originId, [prepared]);
}

export function visibleSlice(session: SpikeSession, viewId: string): string {
  const slot = session.views.find((v) => v.id === viewId);
  if (!slot) return "";
  const doc = slot.state.doc.toString();
  const range = viewRange(slot.state);
  if (!range || range.lost) return "";
  return doc.slice(range.from, range.to);
}

export type CaretWhere =
  | "A body"
  | "A1 body"
  | "A2 body"
  | "A1 title"
  | "A2 title"
  | "A1 line-end"
  | "A1 from"
  | "A2 from"
  | "end-of-scope"
  | "fence";

export function placeCaret(session: SpikeSession, viewId: string, where: CaretWhere): void {
  const slot = session.views.find((v) => v.id === viewId);
  if (!slot) throw new Error(`unknown view ${viewId}`);
  const doc = slot.state.doc.toString();
  const range = viewRange(slot.state);
  if (!range || range.lost) return;
  let pos = range.from;
  if (where === "end-of-scope") {
    pos = range.to > range.from ? range.to - 1 : range.from;
  } else if (where === "fence") {
    pos = range.to;
  } else if (where === "A1 from" || where === "A2 from") {
    pos = range.from;
  } else if (where === "A1 line-end") {
    const section = resolveSection(doc, "A1");
    pos = section ? doc.indexOf("\n", section.from) : range.from;
  } else if (where === "A1 title" || where === "A2 title") {
    const section = resolveSection(doc, where === "A1 title" ? "A1" : "A2");
    pos = section?.markerTo ?? range.from;
  } else {
    const at = doc.indexOf(where);
    pos = at >= 0 ? at : range.from;
  }
  applyOrigin(session, viewId, [{ selection: EditorSelection.single(pos) }]);
}

function attachView(session: SpikeSession, slot: SpikeView, parent: Element): void {
  slot.view = new EditorView({
    state: slot.state,
    parent,
    dispatchTransactions: (trs) => {
      if (trs.every((tr) => tr.annotation(syncAnnotation))) {
        slot.view!.update(trs);
        slot.state = slot.view!.state;
        return;
      }
      commitTransactions(session, slot.id, trs);
    },
  });
  slot.state = slot.view.state;
}

export function createSession(specs: ViewSpec[], doc = SPIKE_DOC): SpikeSession {
  const sessionState: SessionEditorState = EditorState.create({ doc });
  const views: SpikeView[] = specs.map((spec) => {
    const section = resolveSection(doc, spec.scopeId, spec.scopeIndex);
    const caret =
      spec.include === "document"
        ? 0
        : spec.presentation === "wysiwyg"
          ? (section?.markerTo ?? 0)
          : (section?.from ?? 0);
    const extensions =
      spec.presentation === "wysiwyg"
        ? wysiwygExtensions(spec.scopeId, spec.scopeIndex, spec.include)
        : sourceExtensions(spec.scopeId, spec.scopeIndex, spec.include);
    const state = EditorState.create({
      doc: sessionState.doc,
      selection: EditorSelection.single(caret),
      extensions,
    });
    return {
      id: spec.id,
      scopeId: spec.scopeId,
      scopeIndex: spec.scopeIndex,
      include: spec.include,
      presentation: spec.presentation,
      state,
      view: null,
      lostNotified: false,
    };
  });
  const session: SpikeSession = { sessionState, views, scopeLost: [] };
  for (let i = 0; i < specs.length; i++) {
    const parent = specs[i]!.parent;
    if (parent) attachView(session, views[i]!, parent);
  }
  return session;
}

/** Scene 1: same text, two presentations. */
export function createPresentationSession(opts?: {
  parentSrc?: Element;
  parentWys?: Element;
}): SpikeSession {
  return createSession([
    { id: "src", scopeId: "A", scopeIndex: 0, include: "document", presentation: "source", parent: opts?.parentSrc },
    { id: "wys", scopeId: "A", scopeIndex: 0, include: "document", presentation: "wysiwyg", parent: opts?.parentWys },
  ]);
}

/** Scene 2: parent subtree + two child own-ranges. */
export function createScopeSession(opts?: {
  parentA?: Element;
  parentA1?: Element;
  parentA2?: Element;
}): SpikeSession {
  return createSession([
    { id: "A", scopeId: "A", scopeIndex: 0, include: "subtree", presentation: "source", parent: opts?.parentA },
    { id: "A1", scopeId: "A1", scopeIndex: 1, include: "own", presentation: "source", parent: opts?.parentA1 },
    { id: "A2", scopeId: "A2", scopeIndex: 2, include: "own", presentation: "source", parent: opts?.parentA2 },
  ]);
}

export interface GateResult {
  id: "G1" | "G2" | "G3";
  passed: boolean;
  detail: string;
}

function docsEqual(session: SpikeSession): boolean {
  const truth = session.sessionState.doc.toString();
  return session.views.every((v) => v.state.doc.toString() === truth);
}

/** Scene 1: one document, two presentations, identical range; markers stay in the string. */
export function proveG1Presentation(session: SpikeSession): GateResult {
  if (!docsEqual(session)) {
    return { id: "G1", passed: false, detail: "View documents already diverge from SessionEditorState." };
  }
  const before = session.sessionState.doc.toString();
  if (!before.includes("# A") || !before.includes("## A1") || !before.includes("## A2")) {
    return { id: "G1", passed: false, detail: "Presentation leaked: heading markers missing from the document." };
  }

  const insertAt = before.indexOf("A body");
  applyOrigin(session, "src", [{ changes: { from: insertAt, to: insertAt, insert: "X" } }]);

  const after = session.sessionState.doc.toString();
  const same = docsEqual(session) && after.includes("# A") && after.includes("X");
  const srcSlice = visibleSlice(session, "src");
  const wysSlice = visibleSlice(session, "wys");
  const identical = srcSlice.includes("X") && wysSlice.includes("X");

  return {
    id: "G1",
    passed: same && identical,
    detail:
      same && identical
        ? "SessionEditorState and both views share one document string; heading markers remain; the insert is visible in source and wysiwyg (identical range)."
        : `same=${same} src=${JSON.stringify(srcSlice)} wys=${JSON.stringify(wysSlice)}`,
  };
}

/** Scene 2: insert in A1 is visible in parent A (containing), not in A2 (disjoint). */
export function proveG1Scope(session: SpikeSession): GateResult {
  if (!docsEqual(session)) {
    return { id: "G1", passed: false, detail: "View documents already diverge from SessionEditorState." };
  }
  const at = session.sessionState.doc.toString().indexOf("A1 body");
  applyOrigin(session, "A1", [{ changes: { from: at, to: at, insert: "X" } }]);
  const a = visibleSlice(session, "A");
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  const passed = docsEqual(session) && a.includes("X") && a1.includes("X") && !a2.includes("X");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "Insert in A1 appears in parent A (containing) and not in A2 (disjoint); all buffers stay equal."
      : `a=${JSON.stringify(a)} a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
  };
}

/** Insert at the last position of A1 must stay in A1, not become A2's first character. */
export function proveG1Boundary(session: SpikeSession): GateResult {
  const range = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  const at = range.to > range.from ? range.to - 1 : range.from;
  applyOrigin(session, "A1", [{ changes: { from: at, to: at, insert: "Q" } }]);
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  const passed =
    a1.includes("Q") &&
    !a2.includes("Q") &&
    a2.startsWith("## A2") &&
    session.sessionState.doc.toString().includes("## A2");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "Insert at A1's exclusive end stays in A1; A2 still starts with its heading."
      : `a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
  };
}

function eatExclusiveEnd(session: SpikeSession): void {
  const range = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  const at = range.to > range.from ? range.to - 1 : range.from;
  applyOrigin(session, "A1", [{ changes: { from: at, to: at + 1, insert: "" } }]);
}

/** Backspace at A1's exclusive end must not join `## A2` onto A1's last line. */
export function proveG1Backspace(session: SpikeSession): GateResult {
  eatExclusiveEnd(session);
  const afterBlank = session.sessionState.doc.toString();
  if (!/\n## A2/.test(afterBlank)) {
    return {
      id: "G1",
      passed: false,
      detail: `Collapsing the blank line already joined A2: ${JSON.stringify(afterBlank)}`,
    };
  }

  const beforeJoin = afterBlank;
  eatExclusiveEnd(session);
  const after = session.sessionState.doc.toString();
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  const passed = after === beforeJoin && a2.startsWith("## A2") && !a1.includes("A2 body");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "A blank line before A2 may collapse; the last newline is fenced so `## A2` stays at column 0."
      : `beforeJoin=${JSON.stringify(beforeJoin)} after=${JSON.stringify(after)} a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
  };
}

/** Ctrl+A + delete in A1 must not adopt A2 as the A1 view. */
export function proveG1SelectAllDelete(session: SpikeSession): GateResult {
  const range = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  applyOrigin(session, "A1", [{ changes: { from: range.from, to: range.to, insert: "" } }]);
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  const passed =
    a1 === "" &&
    a2.startsWith("## A2") &&
    !a1.includes("A2 body") &&
    session.sessionState.doc.toString().includes("## A2") &&
    viewRange(session.views.find((v) => v.id === "A1")!.state)?.lost !== true &&
    session.scopeLost.length === 0;
  return {
    id: "G1",
    passed,
    detail: passed
      ? "Deleting A1's range leaves A2 in place; the A1 view does not fall back to A2."
      : `a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
  };
}

/** Typing at A1.from stays in the A1 excerpt (and in parent A), not in A2. */
export function proveG1NoPrepend(session: SpikeSession): GateResult {
  const range = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  applyOrigin(session, "A1", [{ changes: { from: range.from, to: range.from, insert: "X" } }]);
  const a = visibleSlice(session, "A");
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  const passed = a1.startsWith("X") && a.includes("X") && !a2.includes("X") && a2.startsWith("## A2");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "Typing at A1.from stays in the A1 excerpt; A2 is untouched."
      : `a=${JSON.stringify(a)} a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
  };
}

/** Enter at A1.from must stay in A1 — it must not leak a line into A only. */
export function proveG1EnterAtFrom(session: SpikeSession): GateResult {
  const range = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  applyOrigin(session, "A1", [{ changes: { from: range.from, to: range.from, insert: "\n" } }]);
  const a = visibleSlice(session, "A");
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  const leaked = a.includes("\n## A1") && !a1.startsWith("\n");
  const passed = a1.startsWith("\n") && a.includes(a1) && !leaked && a2.startsWith("## A2");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "Enter at A1.from stays in the A1 excerpt; it does not become a line only in A."
      : `a=${JSON.stringify(a)} a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)} leaked=${leaked}`,
  };
}

/** After `## A1` is gone, the A1 view stays on the leftover excerpt. */
export function proveG1StayMounted(session: SpikeSession): GateResult {
  const range = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  const doc = session.sessionState.doc.toString();
  const lineEnd = doc.indexOf("\n", range.from);
  applyOrigin(session, "A1", [{ changes: { from: range.from, to: lineEnd < 0 ? range.to : lineEnd, insert: "" } }]);
  if (resolveSection(session.sessionState.doc.toString(), "A1")) {
    return { id: "G1", passed: false, detail: "A1 heading is still resolvable by title." };
  }
  const a1 = visibleSlice(session, "A1");
  const a2 = visibleSlice(session, "A2");
  if (!a1.includes("A1 body") || a1.includes("A2 body") || !a2.startsWith("## A2")) {
    return {
      id: "G1",
      passed: false,
      detail: `excerpt lost after heading delete: a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
    };
  }
  const still = viewRange(session.views.find((v) => v.id === "A1")!.state)!;
  if (still.lost || session.scopeLost.length > 0) {
    return { id: "G1", passed: false, detail: "Self-edit of the heading must not emit scopeLost." };
  }
  applyOrigin(session, "A1", [{ changes: { from: still.from, to: still.from, insert: "Y" } }]);
  const after = visibleSlice(session, "A1");
  const passed = after.startsWith("Y") && after.includes("A1 body") && !after.includes("A2 body");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "A1 stays mounted on its excerpt after `## A1` is gone; typing still lands in A1."
      : `after=${JSON.stringify(after)}`,
  };
}

/** A emptying the subtree emits scopeLost for A1/A2; later typing in A does not reattach them. */
export function proveG1ScopeLost(session: SpikeSession): GateResult {
  const a = viewRange(session.views.find((v) => v.id === "A")!.state)!;
  applyOrigin(session, "A", [{ changes: { from: a.from, to: a.to, insert: "" } }]);
  const ids = session.scopeLost.map((e) => e.viewId).slice().sort();
  const a1 = viewRange(session.views.find((v) => v.id === "A1")!.state);
  const a2 = viewRange(session.views.find((v) => v.id === "A2")!.state);
  if (ids.join(",") !== "A1,A2" || !a1?.lost || !a2?.lost) {
    return {
      id: "G1",
      passed: false,
      detail: `scopeLost=${JSON.stringify(session.scopeLost)} a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`,
    };
  }
  if (session.scopeLost.some((e) => e.viewId === "A")) {
    return { id: "G1", passed: false, detail: "Parent A must not emit scopeLost when it empties itself." };
  }
  const stillA = viewRange(session.views.find((v) => v.id === "A")!.state)!;
  applyOrigin(session, "A", [{ changes: { from: stillA.from, to: stillA.from, insert: "Z" } }]);
  const aVis = visibleSlice(session, "A");
  const a1Vis = visibleSlice(session, "A1");
  const a2Vis = visibleSlice(session, "A2");
  const passed =
    aVis.includes("Z") &&
    a1Vis === "" &&
    a2Vis === "" &&
    session.sessionState.doc.toString().includes("Z") &&
    session.scopeLost.length === 2;
  return {
    id: "G1",
    passed,
    detail: passed
      ? "A emptying the subtree emits scopeLost for A1 and A2; typing in A does not reattach them."
      : `a=${JSON.stringify(aVis)} a1=${JSON.stringify(a1Vis)} a2=${JSON.stringify(a2Vis)} events=${session.scopeLost.length}`,
  };
}

/** Source: caret may sit on `##` (two characters), not jump to the title. */
export function proveG1TitleCaret(session: SpikeSession): GateResult {
  const doc = session.sessionState.doc.toString();
  const section = resolveSection(doc, "A1", 1)!;
  applyOrigin(session, "A1", [{ selection: EditorSelection.single(section.from) }]);
  const head = session.views.find((v) => v.id === "A1")!.state.selection.main.head;
  const passed = head === section.from;
  return {
    id: "G1",
    passed,
    detail: passed
      ? `Source caret stays on \`##\` at ${section.from}; the marker is not an atom.`
      : `head=${head} from=${section.from} markerTo=${section.markerTo}`,
  };
}

/** Source: deleting one `#` of `## A1` leaves `# A1` — the marker is two characters. */
export function proveG1SourceMarkerChars(session: SpikeSession): GateResult {
  const section = resolveSection(session.sessionState.doc.toString(), "A1", 1)!;
  applyOrigin(session, "A1", [{ changes: { from: section.from, to: section.from + 1, insert: "" } }]);
  const a1 = visibleSlice(session, "A1");
  const passed = a1.startsWith("# A1") && !a1.startsWith("##");
  return {
    id: "G1",
    passed,
    detail: passed
      ? "Source treats `##` as two characters; deleting one leaves `# A1`."
      : `a1=${JSON.stringify(a1)}`,
  };
}

/** A new heading at document end stays visible in scene 1 (document scope, not A's subtree). */
export function proveG1DocumentEnd(session: SpikeSession): GateResult {
  const at = session.sessionState.doc.length;
  applyOrigin(session, "src", [{ changes: { from: at, to: at, insert: "# Z\n" } }]);
  const src = visibleSlice(session, "src");
  const wys = visibleSlice(session, "wys");
  const passed = src.includes("# Z") && wys.includes("# Z") && docsEqual(session);
  return {
    id: "G1",
    passed,
    detail: passed
      ? "A heading typed at document end stays in the document-scoped source and wysiwyg slices."
      : `src=${JSON.stringify(src)} wys=${JSON.stringify(wys)}`,
  };
}

export function proveG2(session: SpikeSession): GateResult {
  const src = session.views.find((v) => v.id === "src")!;
  const wys = session.views.find((v) => v.id === "wys")!;
  const hashAt = (state: EditorState, pos: number) =>
    state.update({ changes: { from: pos, to: pos, insert: "#" } });

  const sourcePos = src.state.selection.main.head;
  const sourceTr = hashAt(src.state, sourcePos);
  if (sourceTr.newDoc.sliceString(sourcePos, sourcePos + 1) !== "#") {
    return { id: "G2", passed: false, detail: "Source state escaped '#' — guards leaked onto the source configuration." };
  }

  const wysPos = wys.state.selection.main.head;
  const wysTr = hashAt(wys.state, wysPos);
  const inserted = wysTr.newDoc.sliceString(wysPos, wysPos + 2);
  if (inserted !== "\\#") {
    return {
      id: "G2",
      passed: false,
      detail: `Wysiwyg did not mask typed '#': got ${JSON.stringify(inserted)} (L2).`,
    };
  }

  const multi = wys.state.update({
    changes: { from: wysPos, to: wysPos, insert: "# *\n_" },
  });
  const multiInserted = multi.newDoc.sliceString(wysPos, wysPos + 8);
  if (multiInserted !== "\\# \\*\n\\_") {
    return {
      id: "G2",
      passed: false,
      detail: `L3: multiline insert was not masked in one transaction (got ${JSON.stringify(multiInserted)}).`,
    };
  }

  const headingA = sectionsOf(wys.state.doc.toString()).find((s) => s.id === "A")!;
  const partial = wys.state.update({
    changes: { from: headingA.markerFrom + 1, to: headingA.markerTo, insert: "" },
  });
  const headingLine = partial.newDoc.sliceString(headingA.from, headingA.from + 8);
  const splitMarker = headingLine.startsWith("#A") || headingLine.startsWith("# A");

  return {
    id: "G2",
    passed: !splitMarker,
    detail: splitMarker
      ? `L1 left a split heading marker: ${JSON.stringify(headingLine)}`
      : "Guards sit in a transactionFilter on the wysiwyg extensions only. Source has no such filter. L2/L3 mask in one transaction; L1 captures the whole marker.",
  };
}

/** Wysiwyg: caret cannot sit inside `## `; a partial marker delete removes the whole atom (L1). */
export function proveG2WysiwygHeadingAtom(session: SpikeSession): GateResult {
  const section = resolveSection(session.sessionState.doc.toString(), "A1")!;
  applyOrigin(session, "wys", [{ selection: EditorSelection.single(section.from) }]);
  const head = session.views.find((v) => v.id === "wys")!.state.selection.main.head;
  if (head !== section.markerTo) {
    return {
      id: "G2",
      passed: false,
      detail: `Wysiwyg caret at heading from sat at ${head}, expected title ${section.markerTo}.`,
    };
  }
  applyOrigin(session, "wys", [
    { changes: { from: section.markerFrom + 1, to: section.markerFrom + 2, insert: "" } },
  ]);
  const after = session.sessionState.doc.toString();
  const line = after.slice(section.from, after.indexOf("\n", section.from));
  const split = /^#{1,6}/.test(line);
  const passed = !split && line.startsWith("A1");
  return {
    id: "G2",
    passed,
    detail: passed
      ? "Wysiwyg treats `## ` as one atom: caret sits on the title; a partial delete removes the whole marker."
      : `head=${head} line=${JSON.stringify(line)} after=${JSON.stringify(after)}`,
  };
}

/** Backspace at the title and Delete on the preceding newline both remove `## `, not a neighbour line. */
export function proveG2WysiwygAdjacentMarker(session: SpikeSession): GateResult {
  const doc = session.sessionState.doc.toString();
  const section = resolveSection(doc, "A1")!;
  const back = headingAtomForDelete(doc, section.markerTo, "backward");
  const delAt = headingAtomForDelete(doc, section.from, "forward");
  const delNl = headingAtomForDelete(doc, section.from - 1, "forward");
  const delTitle = headingAtomForDelete(doc, section.markerTo, "forward");
  const body = doc.indexOf("A body");
  const delBody = headingAtomForDelete(doc, body, "forward");
  if (!back || back.from !== section.markerFrom || back.to !== section.markerTo) {
    return { id: "G2", passed: false, detail: `Backspace at title did not target \`## \`: ${JSON.stringify(back)}` };
  }
  if (!delAt || delAt.from !== section.markerFrom) {
    return { id: "G2", passed: false, detail: `Delete at marker from did not target \`## \`: ${JSON.stringify(delAt)}` };
  }
  if (!delNl || delNl.from !== section.markerFrom) {
    return { id: "G2", passed: false, detail: `Delete on the newline before \`## \` did not target the atom: ${JSON.stringify(delNl)}` };
  }
  if (delTitle || delBody !== undefined) {
    return { id: "G2", passed: false, detail: "Delete at the title or in the body must not steal the heading atom." };
  }
  applyOrigin(session, "wys", [{ changes: { from: back.from, to: back.to, insert: "" } }]);
  const after = session.sessionState.doc.toString();
  const passed = !after.includes("## A1") && after.includes("A1") && after.includes("A body") && after.includes("## A2");
  return {
    id: "G2",
    passed,
    detail: passed
      ? "Backspace/Delete immediately before `## ` remove the atom; Delete on the title or two lines earlier does not."
      : `after=${JSON.stringify(after)}`,
  };
}

/** Spaces typed at a wysiwyg title stay in the title — not absorbed into `## `. */
export function proveG2TitleSpaces(session: SpikeSession): GateResult {
  const section = resolveSection(session.sessionState.doc.toString(), "A2")!;
  applyOrigin(session, "wys", [{ selection: EditorSelection.single(section.markerTo) }]);
  applyOrigin(session, "wys", [{ changes: { from: section.markerTo, to: section.markerTo, insert: "   " } }]);
  const afterType = session.sessionState.doc.toString();
  if (!afterType.includes("##    A2")) {
    return { id: "G2", passed: false, detail: `typed spaces were not kept before A2: ${JSON.stringify(afterType)}` };
  }
  applyOrigin(session, "wys", [
    { changes: { from: section.markerTo + 2, to: section.markerTo + 3, insert: "" } },
  ]);
  const afterBack = session.sessionState.doc.toString();
  const passed = afterBack.includes("##   A2") && !/(^|\n)A2(\n|$)/.test(afterBack);
  return {
    id: "G2",
    passed,
    detail: passed
      ? "Spaces before A2 stay in the title (`##    A2`); one Backspace removes one space, not the marker."
      : `afterType=${JSON.stringify(afterType)} afterBack=${JSON.stringify(afterBack)}`,
  };
}

/** Delete after `## A1` (end of the heading line) removes the following newline, not the marker. */
export function proveG2WysiwygDeleteNewline(session: SpikeSession): GateResult {
  const doc = session.sessionState.doc.toString();
  const section = resolveSection(doc, "A1")!;
  const lineEnd = doc.indexOf("\n", section.from);
  if (lineEnd < 0) {
    return { id: "G2", passed: false, detail: "A1 heading line has no newline." };
  }
  const atTitle = wysiwygForwardDelete(doc, section.markerTo);
  if (atTitle !== undefined) {
    return {
      id: "G2",
      passed: false,
      detail: `Delete at the title must leave the title character to native delete, got ${JSON.stringify(atTitle)}`,
    };
  }
  const atEnd = wysiwygForwardDelete(doc, lineEnd);
  if (!atEnd || atEnd.from !== lineEnd || atEnd.to !== lineEnd + 1) {
    return { id: "G2", passed: false, detail: `Delete at heading line-end did not target the newline: ${JSON.stringify(atEnd)}` };
  }
  applyOrigin(session, "wys", [{ changes: { from: atEnd.from, to: atEnd.to, insert: "" } }]);
  const after = session.sessionState.doc.toString();
  const passed = after.includes("## A1\nA1 body") && after.includes("## A2") && !after.includes("## A1\n\n");
  return {
    id: "G2",
    passed,
    detail: passed
      ? "Delete behind `## A1` removes the following newline; the marker and A2 stay."
      : `after=${JSON.stringify(after)}`,
  };
}

/** Deleting the visible `#` of `\#` must remove the mask backslash too. */
export function proveG2DeleteMask(session: SpikeSession): GateResult {
  placeCaret(session, "wys", "A body");
  const pos = session.views.find((v) => v.id === "wys")!.state.selection.main.head;
  applyOrigin(session, "wys", [{ changes: { from: pos, to: pos, insert: "#" } }]);
  const afterInsert = session.sessionState.doc.toString();
  const pair = afterInsert.indexOf("\\#");
  if (pair < 0) {
    return { id: "G2", passed: false, detail: `expected \\# after insert: ${JSON.stringify(afterInsert)}` };
  }
  applyOrigin(session, "wys", [{ changes: { from: pair + 1, to: pair + 2, insert: "" } }]);
  const after = session.sessionState.doc.toString();
  const passed = !after.includes("\\#") && after[pair] !== "\\";
  return {
    id: "G2",
    passed,
    detail: passed
      ? "Deleting the `#` of `\\#` removes the mask pair; no dangling backslash."
      : `after=${JSON.stringify(after)}`,
  };
}

/** Four successive '#' inserts must produce four times \# — never \\# (double mask). */
export function proveG2NoDoubleEscape(session: SpikeSession): GateResult {
  placeCaret(session, "wys", "A body");
  for (let i = 0; i < 4; i++) {
    const pos = session.views.find((v) => v.id === "wys")!.state.selection.main.head;
    applyOrigin(session, "wys", [{ changes: { from: pos, to: pos, insert: "#" } }]);
  }
  const doc = session.sessionState.doc.toString();
  const passed = doc.includes("\\#\\#\\#\\#") && !doc.includes("\\\\#");
  return {
    id: "G2",
    passed,
    detail: passed
      ? "Four typed '#' become \\#\\#\\#\\#; the mask backslash is not re-escaped."
      : `document=${JSON.stringify(doc)}`,
  };
}

export function proveG3(session: SpikeSession): GateResult {
  placeCaret(session, "src", "A body");
  placeCaret(session, "wys", "A1 body");
  const src = session.views.find((v) => v.id === "src")!;
  const wys = session.views.find((v) => v.id === "wys")!;
  const wysHeadBefore = wys.state.selection.main.head;
  const srcHeadBefore = src.state.selection.main.head;

  applyOrigin(session, "src", [{ selection: EditorSelection.single(srcHeadBefore + 1) }]);
  if (wys.state.selection.main.head !== wysHeadBefore) {
    return {
      id: "G3",
      passed: false,
      detail: `Selection-only transaction in source moved wysiwyg caret ${wysHeadBefore}→${wys.state.selection.main.head}.`,
    };
  }
  if (src.state.selection.main.head === wys.state.selection.main.head) {
    return { id: "G3", passed: false, detail: "Source and wysiwyg share a selection after a local caret move." };
  }

  const wysBeforeType = wys.state.selection.main.head;
  const srcBeforeType = src.state.selection.main.head;
  const lenBefore = wys.state.doc.length;
  applyOrigin(session, "src", [
    {
      changes: { from: srcBeforeType, to: srcBeforeType, insert: "Z" },
      selection: EditorSelection.single(srcBeforeType + 1),
    },
  ]);

  const expectedWys = EditorSelection.single(wysBeforeType).map(
    ChangeSet.of({ from: srcBeforeType, to: srcBeforeType, insert: "Z" }, lenBefore),
  );
  const wysHeadAfter = wys.state.selection.main.head;
  const srcHeadAfter = src.state.selection.main.head;
  const match = docsEqual(session);
  const wysMapped = wysHeadAfter === expectedWys.main.head;
  const notCopied = srcHeadAfter !== wysHeadAfter;

  return {
    id: "G3",
    passed: match && wysMapped && notCopied,
    detail:
      match && wysMapped && notCopied
        ? `Selection is not forwarded. Typing in source updates the wysiwyg document; the wysiwyg caret is mapped through the ChangeSet (${wysBeforeType}→${wysHeadAfter}), never replaced by source (${srcHeadAfter}).`
        : `docsEqual=${match} wys ${wysBeforeType}→${wysHeadAfter} (expected ${expectedWys.main.head}) src→${srcHeadAfter}`,
  };
}

export function runAllProofs(): GateResult[] {
  return [
    proveG1Presentation(createPresentationSession()),
    proveG1Scope(createScopeSession()),
    proveG1Boundary(createScopeSession()),
    proveG1Backspace(createScopeSession()),
    proveG1SelectAllDelete(createScopeSession()),
    proveG1NoPrepend(createScopeSession()),
    proveG1EnterAtFrom(createScopeSession()),
    proveG1StayMounted(createScopeSession()),
    proveG1ScopeLost(createScopeSession()),
    proveG1TitleCaret(createScopeSession()),
    proveG1SourceMarkerChars(createScopeSession()),
    proveG1DocumentEnd(createPresentationSession()),
    proveG2(createPresentationSession()),
    proveG2WysiwygHeadingAtom(createPresentationSession()),
    proveG2WysiwygAdjacentMarker(createPresentationSession()),
    proveG2TitleSpaces(createPresentationSession()),
    proveG2WysiwygDeleteNewline(createPresentationSession()),
    proveG2DeleteMask(createPresentationSession()),
    proveG2NoDoubleEscape(createPresentationSession()),
    proveG3(createPresentationSession()),
  ];
}
