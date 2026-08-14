import { describe, expect, it } from "vitest";
import { findChips } from "../../../src/core/chips.js";
import {
  parseFrontmatterBlock,
  planFieldWrite,
  wouldBreakYamlValue,
} from "../../../src/core/frontmatter.js";
import { findInDocument, planReplaceAll } from "../../../src/core/search.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
note: hello
extra: world
---

# Root

See [Alpha]{id=a type=ref} and more.

---
id: n1
---

## Child

Child body.
`;

describe("frontmatter", () => {
  /** @covers FM3, FM5 */
  it("parses field value ranges and clears a key without leaving a YAML fragment", () => {
    const treeFrom = DOC.indexOf("---");
    const treeTo = DOC.indexOf("# Root");
    // block ends after second ---
    const close = DOC.indexOf("---", 3);
    const end = DOC.indexOf("\n", close + 3) + 1;
    const block = { from: treeFrom, to: end };
    const parsed = parseFrontmatterBlock(DOC, block);
    expect(parsed.valid).toBe(true);
    expect(parsed.fields.map((f) => f.key).sort()).toEqual(["extra", "id", "note"]);
    const note = parsed.fields.find((f) => f.key === "note")!;
    expect(DOC.slice(note.valueRange.from, note.valueRange.to)).toBe("hello");

    const cleared = planFieldWrite(DOC, block, "note", null)!;
    const next = DOC.slice(0, cleared.from) + cleared.insert + DOC.slice(cleared.to);
    expect(next).not.toContain("note:");
    expect(next).toContain("id: n0");
    expect(next).toContain("---\n");
  });

  /** @covers RP6 */
  it("detects YAML-breaking replacement values", () => {
    expect(wouldBreakYamlValue("a: b")).toBe(true);
    expect(wouldBreakYamlValue("ok")).toBe(false);
    expect(wouldBreakYamlValue("line\nbreak")).toBe(true);
  });
});

describe("chips", () => {
  /** @covers W1, W2 */
  it("splits label from attribute block", () => {
    const chips = findChips("See [Alpha]{id=a type=ref} x");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label).toBe("Alpha");
    expect(chips[0]!.attrs).toBe("id=a type=ref");
  });
});

describe("search projection", () => {
  /** @covers F4, F5, F8, P5, T45, T46, T47, T72 */
  it("wysiwyg finds pill values and chip labels, not keys, attrs, or markers", () => {
    const range = { from: 0, to: DOC.length };
    const wys = findInDocument(DOC, {
      query: "hello",
      range,
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: ["note"],
    });
    expect(wys).toHaveLength(1);
    expect(wys[0]!.class).toBe("metadata");

    const noPill = findInDocument(DOC, {
      query: "world",
      range,
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: ["note"],
    });
    expect(noPill).toHaveLength(0);

    const srcWorld = findInDocument(DOC, {
      query: "world",
      range,
      presentation: "source",
      schema: FIXTURE_SCHEMA,
      pillFields: ["note"],
    });
    expect(srcWorld.length).toBeGreaterThan(0);

    const label = findInDocument(DOC, {
      query: "Alpha",
      range,
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    });
    expect(label).toHaveLength(1);
    expect(label[0]!.class).toBe("prose");

    const attr = findInDocument(DOC, {
      query: "type=ref",
      range,
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    });
    expect(attr).toHaveLength(0);

    const hash = findInDocument(DOC, {
      query: "#",
      range,
      presentation: "wysiwyg",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    });
    expect(hash).toHaveLength(0);
  });

  /** @covers F1, T50, RP2, RP5 */
  it("view range clips hits; replaceAll defaults to prose only", () => {
    const childFrom = DOC.indexOf("## Child");
    const hits = findInDocument(DOC, {
      query: "Child",
      range: { from: childFrom, to: DOC.length },
      presentation: "source",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    });
    expect(hits.every((h) => h.from >= childFrom)).toBe(true);

    const all = findInDocument(DOC, {
      query: "e",
      range: { from: 0, to: DOC.length },
      presentation: "source",
      schema: FIXTURE_SCHEMA,
      pillFields: [],
    });
    const plan = planReplaceAll(DOC, all.slice(0, 3).map((h, i) => ({
      ...h,
      class: i === 0 ? "metadata" : "prose",
    })), "X");
    expect(plan.prose).toBe(2);
    expect(plan.metadata).toBe(0);
  });
});
