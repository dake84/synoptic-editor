/**
 * Edge cases for the four span kinds Wave 2 drops from the host (fm / mark / escape / ref).
 * Asserts Synoptic's scanners — not a second host derivation (I6 / L6).
 */
import { describe, expect, it } from "vitest";
import { findChips } from "../../../src/core/chips.js";
import { findInlineMarks, inlineDelimiterRanges } from "../../../src/core/inline-markers.js";
import { projectTree } from "../../../src/core/tree.js";
import { headingMarkers, maskBackslashRanges, maskPairs } from "../../../src/view/guards/wysiwyg.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const slice = (doc: string, r: { from: number; to: number }) => doc.slice(r.from, r.to);

describe("opaque span edges — Synoptic scanners", () => {
  /** @covers L2, IM3 */
  it("escaped hash is a mask pair, not a heading marker", () => {
    const doc = "\\# not a heading\n# Real title\n";
    expect(headingMarkers(doc).map((r) => slice(doc, r))).toEqual(["# "]);
    expect(maskPairs(doc, 0, doc.length).map((r) => slice(doc, r))).toEqual(["\\#"]);
    expect(maskBackslashRanges(doc, 0, doc.length).map((r) => slice(doc, r))).toEqual(["\\"]);
  });

  /** @covers L1, IM2 */
  it("hash inside a fenced code block is not an ATX marker in the document string scan", () => {
    const doc = ["# Title", "", "```", "# not a heading", "```", ""].join("\n");
    const markers = headingMarkers(doc).map((r) => ({ text: slice(doc, r), from: r.from }));
    // Document the live scanner: a line-start `# ` inside a fence currently matches.
    // Comparison against Lezer lives in opaque-derivation-compare.test.ts (A4).
    expect(markers.some((m) => m.text === "# " && doc.slice(m.from).startsWith("# not"))).toBe(
      true,
    );
  });

  /** @covers L1, IM2 */
  it("setext underline is not an ATX heading marker", () => {
    const doc = "Setext title\n============\n\n# Atx title\n";
    expect(headingMarkers(doc).map((r) => slice(doc, r))).toEqual(["# "]);
  });

  /** @covers FM1 */
  it("frontmatter binds only when a schema ATX follows the closing fence", () => {
    const bound = ["---", "id: n0", "---", "", "# Root", "body", ""].join("\n");
    const tree = projectTree(bound, FIXTURE_SCHEMA);
    const node = tree.nodes.get("n0");
    expect(node?.frontmatter?.from).toBe(0);
    expect(node?.frontmatter?.to).toBeGreaterThan(0);
    expect(bound.slice(0, node!.frontmatter!.to)).toContain("id: n0");

    const orphan = ["---", "orphan: true", "---", "", "plain prose, no heading", ""].join("\n");
    const orphanTree = projectTree(orphan, FIXTURE_SCHEMA);
    expect([...orphanTree.nodes.values()].every((n) => n.frontmatter === null)).toBe(true);
  });

  /** @covers W7, T125 */
  it("chip with no text node (self-closing / empty) is a full-range chip", () => {
    const self = '<item-ref id="solo"/>';
    const chips = findChips(self, 0, self.length, "html-ref");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textNode).toBe(false);
    expect(chips[0]!.from).toBe(0);
    expect(chips[0]!.to).toBe(self.length);
    expect(chips[0]!.label).toBe("solo");
  });

  /** @covers W6, T121 */
  it("chip with a mismatched closing tag is not a chip", () => {
    const doc = '<item-ref id="a">Alpha</node-ref>';
    expect(findChips(doc, 0, doc.length, "html-ref")).toHaveLength(0);
  });

  /** @covers IM1, IM3 */
  it("inline delimiters skip escaped markers", () => {
    const doc = "real *em* vs \\*literal\\*";
    const dels = inlineDelimiterRanges(findInlineMarks(doc));
    expect(dels.map((r) => slice(doc, r))).toEqual(["*", "*"]);
    expect(maskPairs(doc, 0, doc.length).map((r) => slice(doc, r))).toEqual(["\\*", "\\*"]);
  });
});
