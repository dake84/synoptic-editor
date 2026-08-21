import { describe, expect, it } from "vitest";
import { coveredByFence, fencedCodeRanges } from "../../../src/core/fences.js";

describe("fencedCodeRanges", () => {
  /** @covers L1, I8 */
  it("covers opener, body, and closer", () => {
    const doc = ["# Title", "", "```", "# not a heading", "```", ""].join("\n");
    const [fence] = fencedCodeRanges(doc);
    expect(doc.slice(fence!.from, fence!.to)).toBe("```\n# not a heading\n```\n");
    expect(coveredByFence(doc.indexOf("# not"), [fence!])).toBe(true);
    expect(coveredByFence(0, [fence!])).toBe(false);
  });

  /** @covers L1 */
  it("supports tilde fences and unclosed blocks to EOF", () => {
    const closed = "~~~\nbody\n~~~\n";
    expect(fencedCodeRanges(closed)).toHaveLength(1);
    const open = "~~~\nno closer\n";
    const [fence] = fencedCodeRanges(open);
    expect(fence!.to).toBe(open.length);
  });
});
