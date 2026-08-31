// @vitest-environment happy-dom

/**
 *
 * Presentation scroll freeze (SPEC.md V11, T147, T148).
 * happy-dom does not apply CM6 scrollIntoView — assert the dispatched offset.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorView, lineNumbers } from "@codemirror/view";
import { createSession } from "../../../src/session.js";
import { readingLinePos } from "../../../src/view/scroll.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

${"Body line with enough words to wrap and stack.\n".repeat(40)}
`;

function mountSource() {
  const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
  const view = session.createView({
    scope: { nodeId: "n0", include: "own" },
    presentation: "source",
  });
  const host = document.createElement("div");
  host.style.height = "160px";
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  view.mount(host);
  const ev = view.editorView()!;
  ev.scrollDOM.style.height = "160px";
  ev.scrollDOM.style.overflow = "auto";
  return { session, view, host, ev };
}

function dispatchedScrollFrom(ev: EditorView, run: () => void): number | null {
  let from: number | null = null;
  const dispatch = ev.dispatch.bind(ev);
  ev.dispatch = ((...args: Parameters<EditorView["dispatch"]>) => {
    const spec = args[0] as { effects?: unknown };
    if (spec && typeof spec === "object" && spec.effects) {
      const list = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
      for (const effect of list) {
        const range = (effect as { value?: { range?: { from?: number } } }).value?.range;
        if (typeof range?.from === "number") from = range.from;
      }
    }
    return dispatch(...args);
  }) as EditorView["dispatch"];
  try {
    run();
  } finally {
    ev.dispatch = dispatch;
  }
  return from;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("presentation scroll (V11)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers V11 T147 */
  it("setPresentation without freeze restores the reading line from just before chrome", () => {
    const { view, ev, host } = mountSource();
    ev.scrollDOM.scrollTop = 64;
    const before = readingLinePos(ev);
    const restored = dispatchedScrollFrom(ev, () => view.setPresentation("wysiwyg"));
    expect(restored).toBe(before);
    host.remove();
  });

  /** @covers V11 T147 */
  it("freezeScrollAnchor restores the frozen offset after the viewport jumps", () => {
    const { view, ev, host } = mountSource();
    ev.scrollDOM.scrollTop = 96;
    const frozen = readingLinePos(ev);
    view.freezeScrollAnchor();
    ev.scrollDOM.scrollTop = 0;
    const restored = dispatchedScrollFrom(ev, () => view.setPresentation("wysiwyg"));
    expect(restored).toBe(frozen);
    host.remove();
  });

  /** @covers V11 T147 */
  it("measure does not overwrite scrollAt while frozen", async () => {
    const { session, view, ev, host } = mountSource();
    ev.scrollDOM.scrollTop = 96;
    const line = readingLinePos(ev);
    view.freezeScrollAnchor();
    const frozen = session.resolve(view.getState().scrollAt)?.from;
    expect(frozen).toBe(line);
    ev.scrollDOM.scrollTop = 0;
    ev.scrollDOM.dispatchEvent(new Event("scroll"));
    await nextFrame();
    expect(session.resolve(view.getState().scrollAt)?.from).toBe(frozen);
    host.remove();
  });

  /** @covers V11 T148 */
  it("setPlugins while frozen does not paint chrome until setPresentation", () => {
    const { view, ev, host } = mountSource();
    ev.scrollDOM.scrollTop = 48;
    view.freezeScrollAnchor();
    view.setPlugins([{ id: "test.source.lineNumbers", slot: "source", extension: lineNumbers() }]);
    expect(ev.dom.querySelector(".cm-gutters")).toBeNull();
    view.setPresentation("source");
    expect(ev.dom.querySelector(".cm-gutters")).toBeTruthy();
    host.remove();
  });

  /** @covers V11 T148 */
  it("setPlugins without freeze paints chrome immediately", () => {
    const { view, ev, host } = mountSource();
    view.setPlugins([{ id: "test.source.lineNumbers", slot: "source", extension: lineNumbers() }]);
    expect(ev.dom.querySelector(".cm-gutters")).toBeTruthy();
    host.remove();
  });
});
