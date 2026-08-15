import { describe, expect, it } from "vitest";
import { findChips } from "../../../src/core/chips.js";
import { findHtmlComments } from "../../../src/core/html-comments.js";
import { findInDocument, planReplaceAll } from "../../../src/core/search.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const HTML_DOC = `---
id: n0
---

# Root

See <item-ref id="a">Alpha</item-ref> and more.
`;

describe("html-ref chips", () => {
  /** @covers W6, T121 */
  it("splits label from tags; rejects mismatched close and nested markup", () => {
    const scan = (s: string) => findChips(s, 0, s.length, "html-ref");
    const chips = scan('See <item-ref id="a">Alpha</item-ref> x');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label).toBe("Alpha");
    expect(chips[0]!.attrs).toContain('id="a"');
    expect(chips[0]!.textNode).toBe(true);

    expect(scan('<item-ref id="a">Alpha</node-ref>')).toHaveLength(0);
    expect(scan('<item-ref id="a"><x>Alpha</x></item-ref>')).toHaveLength(0);

    const nested = scan('<node-x-ref id="n">Q</node-x-ref>');
    expect(nested).toHaveLength(1);
    expect(nested[0]!.label).toBe("Q");
  });

  /** @covers W7, T125 */
  it("treats self-closing and empty bodies as synthetic-label chips", () => {
    const scan = (s: string) => findChips(s, 0, s.length, "html-ref");

    const self = scan('<item-ref id="solo"/>');
    expect(self).toHaveLength(1);
    expect(self[0]!.textNode).toBe(false);
    expect(self[0]!.label).toBe("solo");
    expect(self[0]!.labelFrom).toBe(self[0]!.labelTo);

    const spaced = scan('<item-ref id="solo" />');
    expect(spaced).toHaveLength(1);
    expect(spaced[0]!.textNode).toBe(false);
    expect(spaced[0]!.label).toBe("solo");

    const empty = scan('<item-ref id="empty"></item-ref>');
    expect(empty).toHaveLength(1);
    expect(empty[0]!.textNode).toBe(false);
    expect(empty[0]!.label).toBe("empty");

    const commentOnly = scan('<item-ref id="c"><!-- note --></item-ref>');
    expect(commentOnly).toHaveLength(1);
    expect(commentOnly[0]!.textNode).toBe(false);
    expect(commentOnly[0]!.label).toBe("c");
  });

  /** @covers W6 */
  it("ignores markdown-escaped opens and incomplete opens across newlines", () => {
    const scan = (s: string) => findChips(s, 0, s.length, "html-ref");
    expect(scan('\\<item-ref id="a">Alpha</item-ref>')).toHaveLength(0);

    const complete = '<item-ref id="loc">label</item-ref>';
    const glued = `<item-ref\n${complete}\nAfter`;
    const chips = scan(glued);
    expect(chips).toHaveLength(1);
    expect(glued.slice(chips[0]!.from, chips[0]!.to)).toBe(complete);
    expect(chips[0]!.label).toBe("label");
  });

  /** @covers W6, T124 */
  it("does not parse the other style as a chip", () => {
    const html = '<item-ref id="a">Alpha</item-ref>';
    const block = "[Alpha]{id=a type=ref}";
    expect(findChips(html, 0, html.length, "attribute-block")).toHaveLength(0);
    expect(findChips(block, 0, block.length, "html-ref")).toHaveLength(0);
    expect(findChips(block, 0, block.length, "attribute-block")).toHaveLength(1);
    expect(findChips(block, 0, block.length, "attribute-block")[0]!.textNode).toBe(true);
  });
});

describe("html comments", () => {
  /** @covers H1 */
  it("finds complete comments and ignores unterminated ones", () => {
    const doc = "a <!-- secret --> b <!-- open";
    const spans = findHtmlComments(doc);
    expect(spans).toHaveLength(1);
    expect(doc.slice(spans[0]!.from, spans[0]!.to)).toBe("<!-- secret -->");
  });
});

describe("search projection html-ref and comments", () => {
  /** @covers T119, W1, W2, W6 */
  it("wysiwyg finds html-ref labels, not tags or ids", () => {
    const range = { from: 0, to: HTML_DOC.length };
    const opts = {
      range,
      presentation: "wysiwyg" as const,
      schema: FIXTURE_SCHEMA,
      pillFields: [] as string[],
      inlineRefStyle: "html-ref" as const,
    };
    const label = findInDocument(HTML_DOC, { ...opts, query: "Alpha" });
    expect(label).toHaveLength(1);
    expect(label[0]!.class).toBe("prose");
    expect(HTML_DOC.slice(label[0]!.from, label[0]!.to)).toBe("Alpha");

    expect(findInDocument(HTML_DOC, { ...opts, query: "item-ref" })).toHaveLength(0);
    expect(findInDocument(HTML_DOC, { ...opts, query: "id=" })).toHaveLength(0);
    expect(findInDocument(HTML_DOC, { ...opts, query: 'id="a"' })).toHaveLength(0);

    const src = findInDocument(HTML_DOC, { ...opts, query: "item-ref", presentation: "source" });
    expect(src.length).toBeGreaterThan(0);
  });

  /** @covers T120, RP1, W6 */
  it("replace of an html-ref label writes only the text node", () => {
    const range = { from: 0, to: HTML_DOC.length };
    const hits = findInDocument(HTML_DOC, {
      query: "Alpha",
      range,
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
      inlineRefStyle: "html-ref",
    });
    const plan = planReplaceAll(HTML_DOC, hits, "Beta");
    expect(plan.prose).toBe(1);
    const next =
      HTML_DOC.slice(0, plan.changes[0]!.from) + plan.changes[0]!.insert + HTML_DOC.slice(plan.changes[0]!.to);
    expect(next).toContain('<item-ref id="a">Beta</item-ref>');
    expect(next).not.toContain(">Alpha<");
  });

  /** @covers T122, H1, F4, F5 */
  it("comment text is not found in wysiwyg and is found in source", () => {
    const doc = `---
id: n0
---

# Root

Visible <!-- hidden-token --> after.
`;
    const range = { from: 0, to: doc.length };
    const base = { range, schema: FIXTURE_SCHEMA, pillFields: [] as string[] };
    expect(
      findInDocument(doc, { ...base, query: "hidden-token", presentation: "wysiwyg" }),
    ).toHaveLength(0);
    expect(
      findInDocument(doc, { ...base, query: "Visible", presentation: "wysiwyg" }),
    ).toHaveLength(1);
    expect(
      findInDocument(doc, { ...base, query: "hidden-token", presentation: "source" }).length,
    ).toBeGreaterThan(0);
  });

  /** @covers T123, H1 */
  it("chip label inside a comment is not found in wysiwyg", () => {
    const doc = `---
id: n0
---

# Root

Outside <!-- <item-ref id="a">Alpha</item-ref> --> after.
`;
    const hits = findInDocument(doc, {
      query: "Alpha",
      range: { from: 0, to: doc.length },
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
      inlineRefStyle: "html-ref",
    });
    expect(hits).toHaveLength(0);
  });
});
