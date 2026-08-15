/**
 * Inline marker scanner (SPEC.md § 8.6).
 */
import { describe, expect, it } from "vitest";
import {
  findInlineMarks,
  inlineDelimiterRanges,
  isEscapedMeta,
} from "../../../src/core/inline-markers.js";
import { findInDocument } from "../../../src/core/search.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

function kinds(doc: string) {
  return findInlineMarks(doc).map((s) => ({
    kind: s.kind,
    open: doc.slice(s.openFrom, s.openTo),
    close: doc.slice(s.closeFrom, s.closeTo),
    inner: doc.slice(s.openTo, s.closeFrom),
  }));
}

describe("inline-markers scanner", () => {
  /** @covers IM1, T129 */
  it("pairs emphasis and strong with * / **", () => {
    expect(kinds("*em*")).toEqual([{ kind: "em", open: "*", close: "*", inner: "em" }]);
    expect(kinds("**strong**")).toEqual([{ kind: "strong", open: "**", close: "**", inner: "strong" }]);
    const both = kinds("***both***");
    expect(both).toHaveLength(2);
    expect(both.map((b) => b.kind).sort()).toEqual(["em", "strong"]);
    const strong = both.find((b) => b.kind === "strong")!;
    const em = both.find((b) => b.kind === "em")!;
    expect(strong.inner).toBe("both");
    // em may wrap strong delimiters; visible text still carries both classes
    expect(em.inner).toContain("both");
  });

  /** @covers IM1 */
  it("pairs underscore emphasis and strong", () => {
    expect(kinds("_em_")).toEqual([{ kind: "em", open: "_", close: "_", inner: "em" }]);
    expect(kinds("__strong__")).toEqual([{ kind: "strong", open: "__", close: "__", inner: "strong" }]);
    expect(kinds("foo_bar_baz")).toEqual([]);
  });

  /** @covers IM1, IM2, T131 */
  it("pairs strike and code; code breaks emphasis", () => {
    expect(kinds("~~x~~")).toEqual([{ kind: "strike", open: "~~", close: "~~", inner: "x" }]);
    expect(kinds("`code`")).toEqual([{ kind: "code", open: "`", close: "`", inner: "code" }]);
    const nested = kinds("*a `b` c*");
    expect(nested.some((s) => s.kind === "em" && s.inner === "a `b` c")).toBe(true);
    expect(nested.some((s) => s.kind === "code" && s.inner === "b")).toBe(true);
    // asterisks inside code are not emphasis
    expect(kinds("`*x*`")).toEqual([{ kind: "code", open: "`", close: "`", inner: "*x*" }]);
  });

  /** @covers IM3, T132, L2 */
  it("escaped meta is not a delimiter", () => {
    expect(isEscapedMeta("\\*", 1)).toBe(true);
    expect(kinds("\\*lit\\*")).toEqual([]);
    expect(kinds("a \\* b *c*")).toEqual([{ kind: "em", open: "*", close: "*", inner: "c" }]);
  });

  /** @covers IM2 */
  it("skips HTML comments as holes", () => {
    expect(kinds("a <!-- *x* --> b *y*")).toEqual([{ kind: "em", open: "*", close: "*", inner: "y" }]);
  });

  /** @covers IM1, L1 */
  it("exposes delimiter ranges for atoms", () => {
    const spans = findInlineMarks("**ab**");
    expect(inlineDelimiterRanges(spans)).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
    ]);
  });
});

describe("inline markers in search projection", () => {
  const DOC = `---
id: n0
---

# Root

See *italic* and **bold** plus \`code\` and ~~z~~ end.
`;

  /** @covers IM4, F4, F5, T130, T131 */
  it("wysiwyg find skips delimiters and hits interior", () => {
    const range = { from: 0, to: DOC.length };
    const base = { range, schema: FIXTURE_SCHEMA, pillFields: [] as string[] };

    expect(findInDocument(DOC, { ...base, query: "italic", presentation: "wysiwyg" })).toHaveLength(1);
    expect(findInDocument(DOC, { ...base, query: "bold", presentation: "wysiwyg" })).toHaveLength(1);
    expect(findInDocument(DOC, { ...base, query: "code", presentation: "wysiwyg" })).toHaveLength(1);
    expect(findInDocument(DOC, { ...base, query: "z", presentation: "wysiwyg" })).toHaveLength(1);

    // Delimiter characters are not in the wysiwyg projection
    expect(findInDocument(DOC, { ...base, query: "*", presentation: "wysiwyg" })).toHaveLength(0);
    expect(findInDocument(DOC, { ...base, query: "**", presentation: "wysiwyg" })).toHaveLength(0);
    expect(findInDocument(DOC, { ...base, query: "~~", presentation: "wysiwyg" })).toHaveLength(0);
    expect(findInDocument(DOC, { ...base, query: "`", presentation: "wysiwyg" })).toHaveLength(0);

    expect(findInDocument(DOC, { ...base, query: "*", presentation: "source" }).length).toBeGreaterThan(0);
    expect(findInDocument(DOC, { ...base, query: "`", presentation: "source" }).length).toBeGreaterThan(0);
  });
});
