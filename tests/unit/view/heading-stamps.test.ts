// @vitest-environment happy-dom

/**
 *
 * Heading stamps (SPEC.md § 8.7 HS1–HS3, T134).
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

describe("heading stamps (HS / T134)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers HS1, HS2, HS3, T134 */
  it("stamps child heading rel=1 and section-open on following prose", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "wysiwyg",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    const childLine = host.querySelector(".cm-line.syn-rel-1");
    expect(childLine).not.toBeNull();
    expect(childLine?.getAttribute("data-rel")).toBe("1");
    expect(childLine?.getAttribute("data-rank")).toBe("1");
    expect(childLine?.getAttribute("data-heading-depth")).toBe("2");
    expect(childLine?.classList.contains("syn-depth-2")).toBe(true);
    expect(childLine?.classList.contains("syn-rank-1")).toBe(true);

    const childOpen = host.querySelector(".syn-section-open[data-rel='1']");
    expect(childOpen?.textContent).toContain("Child body");
  });

  /** @covers HS1, HS3, T134 */
  it("SNH2 skips scope heading stamp but still opens the first prose", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "wysiwyg",
      showNodeHeading: false,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    expect(host.querySelector(".cm-line.syn-rel-0")).toBeNull();
    const rootOpen = host.querySelector(".syn-section-open[data-rel='0']");
    expect(rootOpen?.textContent).toContain("Root body");
    expect(host.querySelector(".cm-line.syn-rel-1")).not.toBeNull();
  });
});
