// @vitest-environment happy-dom

import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

/**
 * @covers debug filter-trace / cm6 probe (Host Lab instrumentation)
 */
import {
  createCm6ProbeBridge,
  filterTraceSink,
  formatCm6ProbePayload,
  namedChangeFilter,
  namedTransactionFilter,
} from "../../../src/debug.js";

describe("named filter traces", () => {
  it("reports transactionFilter reject to the sink", () => {
    const sink = vi.fn();
    const state = EditorState.create({
      doc: "abc",
      extensions: [
        filterTraceSink.of(sink),
        namedTransactionFilter("testReject", (tr) => (tr.docChanged ? [] : tr)),
      ],
    });
    const view = new EditorView({ state });
    view.dispatch({ changes: { from: 1, to: 2, insert: "" } });
    expect(view.state.doc.toString()).toBe("abc");
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "testReject",
        phase: "reject",
        docChanged: true,
      }),
    );
    view.destroy();
  });

  it("reports changeFilter false as reject", () => {
    const sink = vi.fn();
    const state = EditorState.create({
      doc: "abc",
      extensions: [filterTraceSink.of(sink), namedChangeFilter("testChange", () => false)],
    });
    const view = new EditorView({ state });
    view.dispatch({ changes: { from: 0, to: 1, insert: "" } });
    expect(view.state.doc.toString()).toBe("abc");
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "testChange", phase: "reject" }),
    );
    view.destroy();
  });

  it("reports selection park-style rewrite", () => {
    const sink = vi.fn();
    const state = EditorState.create({
      doc: "abc",
      selection: EditorSelection.cursor(1),
      extensions: [
        filterTraceSink.of(sink),
        namedTransactionFilter("testRewrite", (tr) => {
          if (!tr.selection) return tr;
          return { selection: EditorSelection.cursor(0) };
        }),
      ],
    });
    const view = new EditorView({ state });
    view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(view.state.selection.main.head).toBe(0);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "testRewrite", phase: "rewrite" }),
    );
    view.destroy();
  });

  it("is silent without a sink", () => {
    const state = EditorState.create({
      doc: "ab",
      extensions: [namedChangeFilter("noop", () => false)],
    });
    const view = new EditorView({ state });
    expect(() => view.dispatch({ changes: { from: 0, to: 1, insert: "" } })).not.toThrow();
    expect(view.state.doc.toString()).toBe("ab");
    view.destroy();
  });
});

describe("cm6 probe bridge", () => {
  it("formats filter payloads for the recorder", () => {
    expect(
      formatCm6ProbePayload({
        type: "filter",
        filter: "scopeFence",
        phase: "reject",
        docChanged: true,
        sel: { from: 0, to: 0 },
        change: { from: 0, to: 1, insertLen: 0 },
      }),
    ).toEqual({
      kind: "cm6.filter",
      payload: "reject:scopeFence sel:0 docChanged:1 change:0-1/0",
    });
  });

  it("emits update and filter through setHandler", () => {
    const bridge = createCm6ProbeBridge();
    const seen: string[] = [];
    bridge.setHandler((ev) => {
      seen.push(ev.type);
    });
    const state = EditorState.create({
      doc: "x",
      extensions: [
        bridge.extension,
        namedTransactionFilter("block", (tr) => (tr.docChanged ? [] : tr)),
      ],
    });
    const view = new EditorView({ state, parent: document.body });
    view.dispatch({ changes: { from: 0, to: 1, insert: "" } });
    expect(seen).toContain("filter");
    bridge.setHandler(null);
    view.destroy();
  });
});
