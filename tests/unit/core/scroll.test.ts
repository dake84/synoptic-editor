import { describe, expect, it } from "vitest";
import { ScrollOwnerLog } from "../../../src/view/scroll.js";

describe("ScrollOwnerLog", () => {
  /** @covers I4 */
  it("records named cause per view", () => {
    const log = new ScrollOwnerLog();
    log.record("v1", "navigateTo", 10);
    expect(log.lastFor("v1")?.cause).toBe("navigateTo");
    expect(log.latest()?.viewId).toBe("v1");
  });

  /** @covers I4 */
  it("rejects empty cause", () => {
    const log = new ScrollOwnerLog();
    expect(() => log.record("v1", "")).toThrow(/cause/);
  });
});
