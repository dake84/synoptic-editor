/**
 * @vitest-environment happy-dom
 *
 * Scope heading visibility (SPEC.md § 3.3 SNH1–SNH4, T133).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/index.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

Root body.

---
id: n1
---

## Child

Child body.
`;

function hitsOverlapHeading(
  hits: { from: number; to: number }[],
  heading: { from: number; to: number },
): boolean {
  return hits.some((h) => h.from < heading.to && h.to > heading.from);
}

describe("showNodeHeading (SNH / T133)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers SNH2, SNH4, T133 */
  it("hides the scope heading in wysiwyg but keeps child titles and the document ATX", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "wysiwyg",
      showNodeHeading: false,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    expect(session.document).toContain("# Root");
    expect(session.document).toContain("## Child");

    const text = host.querySelector(".cm-editor")?.textContent ?? "";
    expect(text).toContain("Root body");
    expect(text).toContain("Child");
    expect(text).toContain("Child body");
    expect(text.indexOf("Child")).toBeLessThan(text.indexOf("Child body"));

    const rootHeading = session.tree.nodes.get("n0")!.heading;
    const rootHits = view.find("Root", { mode: "view", activate: false });
    expect(hitsOverlapHeading(rootHits, rootHeading)).toBe(false);
    expect(view.find("Root body", { mode: "view", activate: false }).length).toBeGreaterThan(0);
  });

  /** @covers SNH3, T133 */
  it("setScope retargets the hidden heading to the new scope node", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "wysiwyg",
      showNodeHeading: false,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    view.setScope("n1", { include: "own" });
    const text = host.querySelector(".cm-editor")?.textContent ?? "";
    expect(text).toContain("Child body");
    expect(text).not.toContain("Root body");
    const childHeading = session.tree.nodes.get("n1")!.heading;
    expect(
      hitsOverlapHeading(view.find("Child", { mode: "view", activate: false }), childHeading),
    ).toBe(false);
  });

  /** @covers SNH1, SNH2, T133 */
  it("source keeps the scope ATX; default true leaves the title visible in wysiwyg", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const source = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "source",
      showNodeHeading: false,
    });
    const sourceHost = document.createElement("div");
    document.body.appendChild(sourceHost);
    source.mount(sourceHost);
    expect(sourceHost.querySelector(".cm-editor")?.textContent ?? "").toContain("# Root");

    const wysiwyg = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "wysiwyg",
    });
    const wysiwygHost = document.createElement("div");
    document.body.appendChild(wysiwygHost);
    wysiwyg.mount(wysiwygHost);
    const rootHeading = session.tree.nodes.get("n0")!.heading;
    expect(
      hitsOverlapHeading(wysiwyg.find("Root", { mode: "view", activate: false }), rootHeading),
    ).toBe(true);
  });

  /** @covers SNH3, SNH4, T133 */
  it("setShowNodeHeading toggles without remount and restores findability", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "wysiwyg",
      showNodeHeading: false,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);
    const rootHeading = session.tree.nodes.get("n0")!.heading;
    expect(
      hitsOverlapHeading(view.find("Root", { mode: "view", activate: false }), rootHeading),
    ).toBe(false);

    view.setShowNodeHeading(true);
    expect(
      hitsOverlapHeading(view.find("Root", { mode: "view", activate: false }), rootHeading),
    ).toBe(true);

    const state = view.getState();
    expect(state.showNodeHeading).toBe(true);
  });
});
