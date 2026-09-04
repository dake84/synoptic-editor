/**
 * Optional named wrappers around CM6 change/transaction filters.
 * When no {@link filterTraceSink} is installed, behaviour is unchanged (I6: still one filter).
 * Host Lab / debug probes install a sink to attribute rejects and rewrites.
 */

import {
  EditorState,
  Facet,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";

/** One filter decision for the interaction recorder / debug probe. */
export type FilterTrace = {
  /** Stable filter id (e.g. `frontmatterLockFilter`). */
  filter: string;
  /** `reject` = change dropped; `rewrite` = selection/changes altered. */
  phase: "reject" | "rewrite";
  docChanged: boolean;
  sel: { from: number; to: number };
  /** First change in start-doc coords, when the transaction had doc edits. */
  change?: { from: number; to: number; insertLen: number };
};

/** Receives filter decisions; last registered sink wins. */
export type FilterTraceSink = (trace: FilterTrace) => void;

/** Install via host/debug probe extension; omit in production mounts. */
export const filterTraceSink = Facet.define<FilterTraceSink, FilterTraceSink | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

type FilterResult = Transaction | TransactionSpec | readonly (Transaction | TransactionSpec)[];

function firstChange(tr: Transaction): FilterTrace["change"] | undefined {
  if (!tr.docChanged) return undefined;
  let found: FilterTrace["change"] | undefined;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!found) found = { from: fromA, to: toA, insertLen: inserted.length };
  });
  return found;
}

function selOf(tr: Transaction): { from: number; to: number } {
  const main = (tr.selection ?? tr.startState.selection).main;
  return { from: main.from, to: main.to };
}

function emit(
  tr: Transaction,
  partial: Pick<FilterTrace, "filter" | "phase"> & Partial<FilterTrace>,
): void {
  const sink = tr.startState.facet(filterTraceSink);
  if (!sink) return;
  const change = partial.change ?? firstChange(tr);
  const trace: FilterTrace = {
    filter: partial.filter,
    phase: partial.phase,
    docChanged: partial.docChanged ?? tr.docChanged,
    sel: partial.sel ?? selOf(tr),
  };
  if (change) trace.change = change;
  sink(trace);
}

function isEmptyChangesSpec(spec: TransactionSpec): boolean {
  const ch = spec.changes;
  if (ch === undefined) return false;
  if (Array.isArray(ch)) return ch.length === 0;
  return false;
}

function isResultArray(out: FilterResult): out is readonly (Transaction | TransactionSpec)[] {
  return Array.isArray(out);
}

function isSpec(out: FilterResult): out is TransactionSpec {
  return !isResultArray(out) && !(out instanceof Transaction);
}

function classifyTransactionFilterResult(
  tr: Transaction,
  out: FilterResult,
): "passthrough" | "reject" | "rewrite" {
  if (isResultArray(out)) {
    if (out.length === 0) return "reject";
    if (out.length === 1 && out[0] === tr) return "passthrough";
    return "rewrite";
  }
  if (out === tr) return "passthrough";
  if (out instanceof Transaction) return "rewrite";
  if (tr.docChanged && isEmptyChangesSpec(out) && out.filter === false) return "reject";
  if (tr.docChanged && isEmptyChangesSpec(out)) return "reject";
  return "rewrite";
}

function readSelMain(sel: unknown): { from: number; to: number } | null {
  if (!sel || typeof sel !== "object") return null;
  if ("main" in sel) {
    const main = (sel as { main?: { from: number; to: number } }).main;
    if (main && typeof main.from === "number") return { from: main.from, to: main.to };
  }
  if ("anchor" in sel && "head" in sel) {
    const anchor = (sel as { anchor: number; head: number }).anchor;
    const head = (sel as { anchor: number; head: number }).head;
    return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
  }
  if ("from" in sel && "to" in sel) {
    const from = (sel as { from: number; to: number }).from;
    const to = (sel as { from: number; to: number }).to;
    if (typeof from === "number" && typeof to === "number") return { from, to };
  }
  return null;
}

/**
 * Like {@link EditorState.transactionFilter}, but reports reject/rewrite to {@link filterTraceSink}.
 */
export function namedTransactionFilter(
  name: string,
  filter: (tr: Transaction) => FilterResult,
): Extension {
  return EditorState.transactionFilter.of((tr) => {
    const out = filter(tr);
    const kind = classifyTransactionFilterResult(tr, out);
    if (kind === "reject") emit(tr, { filter: name, phase: "reject" });
    else if (kind === "rewrite") {
      let sel = selOf(tr);
      if (isResultArray(out)) {
        const last = out[out.length - 1];
        if (last instanceof Transaction) {
          sel = readSelMain(last.selection) ?? sel;
        } else if (last && typeof last === "object" && "selection" in last) {
          sel = readSelMain((last as TransactionSpec).selection) ?? sel;
        }
      } else if (isSpec(out)) {
        sel = readSelMain(out.selection) ?? sel;
      }
      emit(tr, { filter: name, phase: "rewrite", sel });
    }
    return out;
  });
}

/**
 * Like {@link EditorState.changeFilter}, but reports full rejects (`false`) to the sink.
 * Partial suppress ranges (`number[]`) are reported as `rewrite`.
 */
export function namedChangeFilter(
  name: string,
  filter: (tr: Transaction) => boolean | readonly number[],
): Extension {
  return EditorState.changeFilter.of((tr) => {
    const out = filter(tr);
    if (out === false) emit(tr, { filter: name, phase: "reject" });
    else if (Array.isArray(out)) emit(tr, { filter: name, phase: "rewrite" });
    return out;
  });
}
