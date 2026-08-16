import { describe, expect, it } from "vitest";
import { intervalsOverlap, padDocRanges } from "../../../src/core/viewport.js";

describe("padded viewport ranges (G8)", () => {
  /** @covers G8 */
  it("expands ranges by the pad and clamps to the document", () => {
    expect(padDocRanges([{ from: 0, to: 10 }], 10, 500)).toEqual([{ from: 0, to: 10 }]);
    expect(padDocRanges([{ from: 20, to: 30 }], 100, 5)).toEqual([{ from: 15, to: 35 }]);
    expect(padDocRanges([{ from: 0, to: 4 }, { from: 90, to: 100 }], 100, 10)).toEqual([
      { from: 0, to: 14 },
      { from: 80, to: 100 },
    ]);
  });
});

describe("vertical interval overlap (G9)", () => {
  const port = { top: 100, bottom: 500 };

  /** @covers G9 */
  it("treats strict vertical overlap as visible and ignores the horizontal axis", () => {
    expect(intervalsOverlap({ top: 200, bottom: 250 }, port)).toBe(true);
    expect(intervalsOverlap({ top: 50, bottom: 90 }, port)).toBe(false);
    expect(intervalsOverlap({ top: 520, bottom: 600 }, port)).toBe(false);
    expect(intervalsOverlap({ top: 90, bottom: 110 }, port)).toBe(true);
    expect(intervalsOverlap({ top: 490, bottom: 510 }, port)).toBe(true);
  });

  /** @covers G9 */
  it("does not count touching an edge as overlap", () => {
    expect(intervalsOverlap({ top: 50, bottom: 100 }, port)).toBe(false);
    expect(intervalsOverlap({ top: 500, bottom: 560 }, port)).toBe(false);
  });
});
