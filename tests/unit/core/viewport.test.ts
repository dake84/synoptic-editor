import { describe, expect, it } from "vitest";
import { padDocRanges } from "../../../src/core/viewport.js";

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
