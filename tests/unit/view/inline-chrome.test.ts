/**
 * @vitest-environment happy-dom
 *
 * Wysiwyg inline chrome DOM (SPEC.md § 8.6).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/index.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

See *italic* and **bold** and ***both*** here.
Also ~~strike~~ and \`code\` plus \\*literal\\* end.
`;

describe("wysiwyg inline chrome", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers IM1, I9, T129, T131, T132 */
  it("hides delimiters, marks interior, keeps markers in the document", () => {
    const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
    const view = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "wysiwyg",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view.mount(host);

    expect(session.document).toContain("*italic*");
    expect(session.document).toContain("**bold**");
    expect(session.document).toContain("***both***");
    expect(session.document).toContain("~~strike~~");
    expect(session.document).toContain("`code`");
    expect(session.document).toContain("\\*literal\\*");

    const root = host.querySelector(".cm-editor");
    expect(root).not.toBeNull();
    expect(root!.querySelectorAll(".syn-em").length).toBeGreaterThan(0);
    expect(root!.querySelectorAll(".syn-strong").length).toBeGreaterThan(0);
    expect(root!.querySelector(".syn-strike")?.textContent).toContain("strike");
    expect(root!.querySelector(".syn-code")?.textContent).toContain("code");

    // Escaped literal stars remain visible as text (backslash hidden by L2)
    expect(root!.textContent ?? "").toContain("*literal*");
  });
});
