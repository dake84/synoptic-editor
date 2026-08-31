// @vitest-environment happy-dom

/**
 *
 * Block widget height contract (SPEC.md FM8, P6).
 * No time-waiting: estimatedHeight must equal the height toDOM sets synchronously.
 */
import { describe, expect, it } from "vitest";
import { formBlockHeight, FrontmatterFormWidget } from "../../../src/view/widgets/form.js";
import { PILL_BLOCK_HEIGHT, PillWidget } from "../../../src/view/widgets/pills.js";

describe("heading-near block widget heights", () => {
  /** @covers P6 */
  it("pill estimatedHeight matches synchronous toDOM height", () => {
    const w = new PillWidget("note", "hello", null);
    expect(w.estimatedHeight).toBe(PILL_BLOCK_HEIGHT);
    expect(w.estimatedHeight).toBeGreaterThan(0);
    const dom = w.toDOM();
    expect(dom.style.height).toBe(`${w.estimatedHeight}px`);
    expect(dom.className).toBe("syn-pill");
  });

  /** @covers P6 */
  it("pill eq ignores unrelated instances with same payload", () => {
    const a = new PillWidget("note", "hello", "ell");
    const b = new PillWidget("note", "hello", "ell");
    const c = new PillWidget("note", "hello", null);
    expect(a.eq(b)).toBe(true);
    expect(a.eq(c)).toBe(false);
    expect(a.estimatedHeight).toBe(b.estimatedHeight);
  });

  /** @covers FM8 */
  it("form estimatedHeight scales with field count and matches toDOM", () => {
    expect(formBlockHeight(0)).toBeGreaterThan(0);
    expect(formBlockHeight(2)).toBeGreaterThan(formBlockHeight(1));
    expect(formBlockHeight(3)).toBeGreaterThan(formBlockHeight(2));

    const fields = [
      { key: "id", value: "n0" },
      { key: "note", value: "x" },
    ];
    const w = new FrontmatterFormWidget(0, fields);
    expect(w.estimatedHeight).toBe(formBlockHeight(2));
    // toDOM needs an EditorView for the change listener facet; height is set before that matters.
    const fakeView = { state: { facet: () => null } } as never;
    const dom = w.toDOM(fakeView);
    expect(dom.style.height).toBe(`${w.estimatedHeight}px`);
    expect(dom.querySelectorAll("input")).toHaveLength(2);
  });

  /** @covers FM8 */
  it("form updateDOM refreshes height when field count is unchanged", () => {
    const w = new FrontmatterFormWidget(10, [{ key: "a", value: "1" }]);
    const fakeView = { state: { facet: () => null } } as never;
    const dom = w.toDOM(fakeView);
    const w2 = new FrontmatterFormWidget(12, [{ key: "a", value: "2" }]);
    expect(w2.updateDOM(dom)).toBe(true);
    expect(dom.style.height).toBe(`${w2.estimatedHeight}px`);
    expect(dom.dataset.blockFrom).toBe("12");
  });
});
