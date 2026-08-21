import { describe, expect, it } from "vitest";
import { findInDocument } from "../../../src/core/search.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = "see aria here\n";
const RANGE = { from: 0, to: DOC.length };

function search(query: string, extra: { caseSensitive?: boolean; regex?: boolean } = {}) {
  return findInDocument(DOC, {
    query,
    range: RANGE,
    presentation: "source",
    schema: FIXTURE_SCHEMA,
    pillFields: [],
    ...extra,
  });
}

describe("find match options", () => {
  /** @covers F12, T145 */
  it("matches case-insensitively by default; caseSensitive is exact", () => {
    expect(search("ARIA")).toHaveLength(1);
    expect(search("ARIA", { caseSensitive: true })).toHaveLength(0);
    expect(search("aria", { caseSensitive: true })).toHaveLength(1);
  });

  /** @covers F13, T146 */
  it("regex is opt-in; invalid pattern yields no hits", () => {
    expect(search("a.ia")).toHaveLength(0);
    expect(search("a.ia", { regex: true })).toHaveLength(1);
    expect(search("[", { regex: true })).toHaveLength(0);
  });

  /** @covers F4, L2, T132 */
  it("wysiwyg matches escaped markup as visible text, not the backslash", () => {
    const doc = `---
id: n0
---
# Root

see \\*star\\* here
`;
    const hits = findInDocument(doc, {
      query: "*star*",
      range: { from: 0, to: doc.length },
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    });
    expect(hits).toHaveLength(1);
    expect(findInDocument(doc, {
      query: "\\*",
      range: { from: 0, to: doc.length },
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    })).toHaveLength(0);
  });
});
