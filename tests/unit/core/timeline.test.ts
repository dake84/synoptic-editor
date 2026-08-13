import { describe, expect, it } from "vitest";
import { applyChangeSet, invertChangeSet, makeChangeSet } from "../../../src/core/document.js";
import { createTimeline } from "../../../src/core/timeline.js";

describe("Timeline", () => {
  /** @covers I3, U1 */
  it("undoes text entries in reverse order through one entry point", () => {
    const tl = createTimeline();
    let doc = "abc";

    const f1 = makeChangeSet(doc.length, { from: 3, to: 3, insert: "1" });
    const i1 = invertChangeSet(doc, f1);
    doc = applyChangeSet(doc, f1);
    tl.pushText(f1, i1);

    const f2 = makeChangeSet(doc.length, { from: 4, to: 4, insert: "2" });
    const i2 = invertChangeSet(doc, f2);
    doc = applyChangeSet(doc, f2);
    tl.pushText(f2, i2);

    expect(doc).toBe("abc12");
    expect(tl.depth).toBe(2);

    const u1 = tl.undo()!;
    expect(u1.kind).toBe("text");
    if (u1.kind === "text") doc = applyChangeSet(doc, u1.changes);
    expect(doc).toBe("abc1");

    const u2 = tl.undo()!;
    if (u2.kind === "text") doc = applyChangeSet(doc, u2.changes);
    expect(doc).toBe("abc");

    const r1 = tl.redo()!;
    if (r1.kind === "text") doc = applyChangeSet(doc, r1.changes);
    expect(doc).toBe("abc1");
  });

  /** @covers U9, U10, I3 */
  it("interleaves foreign commands without putting them in the document", () => {
    const tl = createTimeline();
    let doc = "x";
    let foreign = 0;

    const f = makeChangeSet(doc.length, { from: 1, to: 1, insert: "y" });
    const inv = invertChangeSet(doc, f);
    doc = applyChangeSet(doc, f);
    tl.pushText(f, inv);

    tl.pushForeign({
      apply: () => {
        foreign += 1;
      },
      revert: () => {
        foreign -= 1;
      },
      label: "host-op",
    });
    // apply already conceptually done by host before push — simulate:
    foreign = 1;

    expect(doc).toBe("xy");

    const u = tl.undo()!;
    expect(u.kind).toBe("foreign");
    expect(foreign).toBe(0);
    expect(doc).toBe("xy"); // document untouched by foreign undo

    const u2 = tl.undo()!;
    if (u2.kind === "text") doc = applyChangeSet(doc, u2.changes);
    expect(doc).toBe("x");
  });

  /** @covers U1 */
  it("clear empties history (replaceDocument path)", () => {
    const tl = createTimeline();
    let doc = "";
    const f = makeChangeSet(doc.length, { from: 0, to: 0, insert: "a" });
    const inv = invertChangeSet(doc, f);
    tl.pushText(f, inv);
    expect(tl.depth).toBe(1);
    tl.clear();
    expect(tl.depth).toBe(0);
    expect(tl.undo()).toBeNull();
  });
});
