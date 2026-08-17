/**
 * @vitest-environment happy-dom
 *
 * Source `#` demote of a child heading must not collapse the parent excerpt
 * (SPEC EX1/EX6) and must undo (I3/T113).
 */
import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: root
---

# Root

Root body.

---
id: child
---

## Child

Child body.
`;

function mountRootSource() {
  const session = createSession({ doc: DOC, schema: FIXTURE_SCHEMA });
  const view = session.createView({
    scope: { nodeId: "root", include: "subtree" },
    presentation: "source",
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  view.mount(host);
  return { session, view };
}

function deleteFirstHashOfChild(
  session: ReturnType<typeof createSession>,
  view: ReturnType<ReturnType<typeof createSession>["createView"]>,
) {
  const pos = session.document.indexOf("## Child");
  view.editorView()!.dispatch({
    changes: { from: pos, to: pos + 1 },
    selection: EditorSelection.cursor(pos),
  });
}

describe("source hash sibling scope (#200)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers EX1, EX6, T134 */
  it("H200: setScope on the same root keeps the child after ## → #", () => {
    const { session, view } = mountRootSource();
    expect(session.excerpt(view.id)).toContain("Child body");

    deleteFirstHashOfChild(session, view);
    expect(session.document).toMatch(/^# Child$/m);
    expect(session.tree.nodes.has("child")).toBe(true);

    view.setScope("root", { include: "subtree" });
    expect(session.excerpt(view.id)).toContain("Child body");
    expect(session.excerpt(view.id)).toContain("# Child");
  });

  /** @covers T113, I3 */
  it("H200: undo restores ## Child after a source hash delete", () => {
    const { session, view } = mountRootSource();
    deleteFirstHashOfChild(session, view);
    expect(session.timelineDepth).toBeGreaterThan(0);
    session.undo();
    expect(session.document).toMatch(/^## Child$/m);
    expect(session.tree.nodes.get("child")?.parentId).toBe("root");
  });
});
