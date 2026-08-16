/**
 * @vitest-environment happy-dom
 *
 * Skip-scroll when the target already overlaps the port (SPEC.md G9).
 */
import { describe, expect, it } from "vitest";
import { scrollElementIntoViewIfNeeded } from "../../../src/view/scrollport.js";

function mockRect(
  el: HTMLElement,
  rect: { top: number; bottom: number; left?: number; right?: number },
): void {
  el.getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: rect.top,
    width: (rect.right ?? 800) - (rect.left ?? 0),
    height: rect.bottom - rect.top,
    top: rect.top,
    right: rect.right ?? 800,
    bottom: rect.bottom,
    left: rect.left ?? 0,
    toJSON: () => ({}),
  });
}

describe("scrollElementIntoViewIfNeeded (G9)", () => {
  /** @covers G9 */
  it("skips scrollIntoView when the element already intersects the scrollport", () => {
    const scrollport = document.createElement("div");
    document.body.appendChild(scrollport);
    mockRect(scrollport, { top: 0, bottom: 400, left: 0, right: 600 });

    const target = document.createElement("span");
    scrollport.appendChild(target);
    mockRect(target, { top: 120, bottom: 140, left: 10, right: 80 });

    let scrolled = 0;
    target.scrollIntoView = () => {
      scrolled += 1;
    };

    expect(scrollElementIntoViewIfNeeded(target, undefined, scrollport)).toBe(false);
    expect(scrolled).toBe(0);

    mockRect(target, { top: 500, bottom: 520, left: 10, right: 80 });
    expect(scrollElementIntoViewIfNeeded(target, undefined, scrollport)).toBe(true);
    expect(scrolled).toBe(1);

    scrollport.remove();
  });
});
