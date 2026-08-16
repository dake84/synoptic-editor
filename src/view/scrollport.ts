/**
 * Scrollport visibility (SPEC.md G9). DOM helper over the pure interval test.
 */

import { intervalsOverlap, type VerticalInterval } from "../core/viewport.js";

export { intervalsOverlap, type VerticalInterval };

const DEFAULT_SCROLL: ScrollIntoViewOptions = { block: "nearest", inline: "nearest" };

/**
 * Scroll `element` into view only when it does not already overlap `scrollport`
 * vertically. Without a port, treat as not visible and scroll. Returns whether
 * a scroll was performed.
 */
export function scrollElementIntoViewIfNeeded(
  element: HTMLElement,
  options: ScrollIntoViewOptions = DEFAULT_SCROLL,
  scrollport?: HTMLElement | null,
): boolean {
  if (
    scrollport &&
    intervalsOverlap(element.getBoundingClientRect(), scrollport.getBoundingClientRect())
  ) {
    return false;
  }
  if (typeof element.scrollIntoView !== "function") {
    return false;
  }
  element.scrollIntoView(options);
  return true;
}
