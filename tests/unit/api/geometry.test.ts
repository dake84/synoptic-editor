// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../../../src/index.js";

const SCHEMA = {
  levels: [
    { rank: 0, id: "level-0", headingDepth: 1 },
    { rank: 1, id: "level-1", headingDepth: 2 },
  ],
  idField: "id",
};

const DOC = `---
id: n0
---

# Root

Root body line one.
Root body line two.
Root body line three.

---
id: n1
---

## Child

Child body with more lines for scroll geometry.
`;

describe("view geometry (SPEC § 12.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @covers T126, G4, G5, G6, G7 */
  it("exposes scrollPort and coords only after mount", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "source",
    });
    expect(view.scrollPort).toBeNull();
    expect(view.coords(0, 1)).toBeNull();

    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    const port = view.scrollPort;
    expect(port).toBeInstanceOf(HTMLElement);

    vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation((pos: number) => ({
      left: 10,
      right: 50,
      top: 20 + pos * 0.01,
      bottom: 36 + pos * 0.01,
    }));
    vi.spyOn(port!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 200,
      right: 400,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    });

    const at = session.document.indexOf("Root body");
    const box = view.coords(at, at + 4);
    expect(box).not.toBeNull();
    if (box) {
      expect(box.bottom).toBeGreaterThanOrEqual(box.top);
      expect(box.right).toBeGreaterThanOrEqual(box.left);
      expect(box.left).toBe(10);
      expect(box.right).toBe(50);
    }

    const tracked = session.createTrackedPosition({ from: at, to: at + 4 });
    const resolved = session.resolve(tracked);
    expect(resolved?.valid).toBe(true);
    if (resolved?.valid) {
      expect(view.coords(resolved.from, resolved.to)).not.toBeNull();
    }
    session.release(tracked);

    view.destroy();
    expect(view.scrollPort).toBeNull();
    expect(view.coords(0, 1)).toBeNull();
    host.remove();
  });

  /** @covers T127, G4, V3 */
  it("includes scrollTop in coords so overlays share the scroll axis", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "source",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    const port = view.scrollPort!;
    Object.defineProperty(port, "scrollTop", { configurable: true, value: 0, writable: true });

    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      left: 8,
      right: 40,
      top: 100,
      bottom: 116,
    });
    vi.spyOn(port, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 120,
      right: 320,
      width: 320,
      height: 120,
      toJSON: () => ({}),
    });

    const at = session.document.indexOf("Child body");
    const before = view.coords(at, at + 5);
    expect(before).toEqual({ top: 100, left: 8, bottom: 116, right: 40 });

    (port as { scrollTop: number }).scrollTop = 40;
    const after = view.coords(at, at + 5);
    expect(after).toEqual({ top: 140, left: 8, bottom: 156, right: 40 });

    view.destroy();
    host.remove();
  });
});
