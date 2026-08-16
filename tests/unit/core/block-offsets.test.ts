import { describe, expect, it } from "vitest";
import { blockIndexAtOffset, bodyBlockStarts } from "../../../src/core/block-offsets.js";

describe("body block starts (V11)", () => {
  /** @covers V11 */
  it("skips heading and adjacent frontmatter, then lists paragraph starts", () => {
    const text = "## Heading\n\n---\npov: Aria\n---\n\nFirst para.\n\nSecond para.";
    const starts = bodyBlockStarts(text);
    expect(starts).toHaveLength(2);
    expect(text.slice(starts[0]!)).toMatch(/^First para\./);
    expect(text.slice(starts[1]!)).toMatch(/^Second para\./);
  });

  /** @covers V11 */
  it("returns no starts for a heading without body", () => {
    expect(bodyBlockStarts("## Empty")).toEqual([]);
  });

  /** @covers V11 */
  it("does not treat HTML comments as blocks", () => {
    const text = [
      "## Heading",
      "",
      "Before.",
      "",
      "<!-- note",
      "spans lines -->",
      "",
      "After.",
    ].join("\n");
    const starts = bodyBlockStarts(text);
    expect(starts).toHaveLength(2);
    expect(text.slice(starts[0]!)).toMatch(/^Before\./);
    expect(text.slice(starts[1]!)).toMatch(/^After\./);
  });

  /** @covers V11 */
  it("maps a position onto the last start at or before it", () => {
    const text = "## Heading\n\nFirst para.\n\nSecond para.\n\nThird para.";
    const starts = bodyBlockStarts(text);
    expect(blockIndexAtOffset(starts, starts[1]! + 3)).toBe(1);
    expect(blockIndexAtOffset(starts, 10_000)).toBe(starts.length - 1);
    expect(blockIndexAtOffset(starts, 0)).toBe(-1);
    starts.forEach((from, index) => {
      expect(blockIndexAtOffset(starts, from)).toBe(index);
    });
  });
});
