import { Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";

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

Root body.
`;

function typeAt(
  session: ReturnType<typeof createSession>,
  viewId: string,
  from: number,
  text: string,
  time: number,
): number {
  session.dispatch(viewId, [
    {
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
      annotations: [Transaction.time.of(time)],
    },
  ]);
  return from + text.length;
}

describe("timeline typing groups (SPEC U17)", () => {
  /** @covers U17, T149 */
  it("merges adjacent input.type within newGroupDelay into one undo step", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA, newGroupDelay: 200 });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "source",
    });
    const at = session.document.indexOf("Root body.");
    const pos = typeAt(session, view.id, at + "Root body.".length, "a", 1_000);
    typeAt(session, view.id, pos, "b", 1_050);
    expect(session.timelineDepth).toBe(1);
    expect(session.document).toContain("Root body.ab");
    session.undo();
    expect(session.document).toContain("Root body.");
    expect(session.document).not.toContain("Root body.ab");
    expect(session.timelineDepth).toBe(0);
  });

  /** @covers U17, T149 */
  it("starts a new undo step after a gap of at least newGroupDelay", () => {
    const session = createSession({ doc: DOC, schema: SCHEMA, newGroupDelay: 200 });
    const view = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "source",
    });
    const at = session.document.indexOf("Root body.");
    const pos = typeAt(session, view.id, at + "Root body.".length, "a", 1_000);
    typeAt(session, view.id, pos, "b", 1_250);
    expect(session.timelineDepth).toBe(2);
    session.undo();
    expect(session.document).toContain("Root body.a");
    expect(session.document).not.toContain("Root body.ab");
    session.undo();
    expect(session.document).not.toContain("Root body.a");
  });
});
