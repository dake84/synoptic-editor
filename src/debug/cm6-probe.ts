/**
 * Host Lab / debug: listen to CM6 keydown aftermath, view updates, and filter traces.
 * Import only from `synoptic-editor/debug` (not the package root).
 */

import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { filterTraceSink, type FilterTrace } from "../view/guards/filter-trace.js";

/** Events emitted by {@link createCm6ProbeBridge}. */
export type Cm6ProbeEvent =
  | {
      type: "keydown";
      key: string;
      code: string;
      prevented: boolean;
      focus: boolean;
      head: number;
      docLen: number;
    }
  | {
      type: "update";
      docChanged: boolean;
      selectionSet: boolean;
      transactions: number;
      head: number;
      docLen: number;
    }
  | ({ type: "filter" } & FilterTrace);

export type Cm6ProbeHandler = (event: Cm6ProbeEvent) => void;

/**
 * Mutable bridge: mount `extension` on every Host Lab view; call `setHandler`
 * when the interaction recorder starts/stops.
 */
export function createCm6ProbeBridge(): {
  extension: Extension;
  setHandler: (handler: Cm6ProbeHandler | null) => void;
} {
  let handler: Cm6ProbeHandler | null = null;

  const extension: Extension = [
    filterTraceSink.of((trace) => {
      handler?.({ type: "filter", ...trace });
    }),
    EditorView.updateListener.of((update) => {
      if (!handler) return;
      if (!update.docChanged && !update.selectionSet && update.transactions.length === 0) {
        return;
      }
      const main = update.state.selection.main;
      handler({
        type: "update",
        docChanged: update.docChanged,
        selectionSet: update.selectionSet,
        transactions: update.transactions.length,
        head: main.head,
        docLen: update.state.doc.length,
      });
    }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (!handler || event.repeat) return false;
        const key = event.key;
        const code = event.code;
        // After CM keymap / other handlers: defaultPrevented + focus.
        queueMicrotask(() => {
          if (!handler) return;
          const main = view.state.selection.main;
          handler({
            type: "keydown",
            key,
            code,
            prevented: event.defaultPrevented,
            focus: view.hasFocus,
            head: main.head,
            docLen: view.state.doc.length,
          });
        });
        return false;
      },
    }),
  ];

  return {
    extension,
    setHandler: (next) => {
      handler = next;
    },
  };
}

/** Format a probe event as interaction-recorder `life` payload (no trailing view tokens). */
export function formatCm6ProbePayload(event: Cm6ProbeEvent): { kind: string; payload: string } {
  switch (event.type) {
    case "keydown":
      return {
        kind: "cm6.keydown",
        payload: `${event.key} prevented:${event.prevented} focus:${event.focus} head:${event.head} docLen:${event.docLen}`,
      };
    case "update":
      return {
        kind: "cm6.update",
        payload: `doc:${event.docChanged ? 1 : 0} sel:${event.selectionSet ? 1 : 0} tr:${event.transactions} head:${event.head} docLen:${event.docLen}`,
      };
    case "filter": {
      const ch = event.change
        ? ` change:${event.change.from}-${event.change.to}/${event.change.insertLen}`
        : "";
      const sel =
        event.sel.from === event.sel.to
          ? `sel:${event.sel.from}`
          : `sel:${event.sel.from}-${event.sel.to}`;
      return {
        kind: "cm6.filter",
        payload: `${event.phase}:${event.filter} ${sel} docChanged:${event.docChanged ? 1 : 0}${ch}`,
      };
    }
  }
}
