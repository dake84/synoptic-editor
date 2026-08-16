/**
 * Wave 2 I6 probe: Lezer (the host's old mark/escape derivation) vs Synoptic string scanners.
 * Disagreements are the deliverable — this file records them, it does not pick a winner.
 */
import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { findInlineMarks, inlineDelimiterRanges } from "../../../src/core/inline-markers.js";
import { projectTree } from "../../../src/core/tree.js";
import { headingMarkers, maskPairs } from "../../../src/view/guards/wysiwyg.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const LEZER_MARK_NODES = new Set([
  "EmphasisMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
  "SubscriptMark",
  "SuperscriptMark",
]);

type Span = { from: number; to: number; origin: string };

function keyOf(s: Span): string {
  return `${s.from}:${s.to}:${s.origin}`;
}

function lezerMarksAndEscapes(doc: string): { marks: Span[]; escapes: Span[] } {
  const tree = markdownLanguage.parser.parse(doc);
  const marks: Span[] = [];
  const escapes: Span[] = [];
  tree.iterate({
    enter(node) {
      if (LEZER_MARK_NODES.has(node.name)) {
        let to = node.to;
        if (
          node.name === "HeaderMark" &&
          doc[node.from] === "#" &&
          (doc[to] === " " || doc[to] === "\t")
        ) {
          to += 1;
        }
        marks.push({ from: node.from, to, origin: node.name });
        return;
      }
      if (node.name === "Escape" && node.to > node.from) {
        escapes.push({ from: node.from, to: node.to, origin: "Escape" });
      }
    },
  });
  return { marks, escapes };
}

function synopticMarks(doc: string): Span[] {
  const heading = headingMarkers(doc).map((r) => ({ ...r, origin: "headingMarkers" }));
  const inline = inlineDelimiterRanges(findInlineMarks(doc)).map((r) => ({
    ...r,
    origin: "inlineDelimiter",
  }));
  return [...heading, ...inline];
}

function synopticEscapes(doc: string): Span[] {
  return maskPairs(doc, 0, doc.length).map((r) => ({ ...r, origin: "maskPairs" }));
}

function extraIn(
  left: Span[],
  right: Span[],
): { from: number; to: number; text: string; origin: string }[] {
  const rightKeys = new Set(right.map((s) => `${s.from}:${s.to}`));
  return left
    .filter((s) => !rightKeys.has(`${s.from}:${s.to}`))
    .map((s) => ({ from: s.from, to: s.to, origin: s.origin, text: "" }));
}

function withText(doc: string, spans: ReturnType<typeof extraIn>) {
  return spans.map((s) => ({ ...s, text: JSON.stringify(doc.slice(s.from, s.to)) }));
}

const CASES: { name: string; doc: string }[] = [
  {
    name: "escaped hash",
    doc: "\\# not a heading\n# Real title\n",
  },
  {
    name: "hash inside a fenced code block",
    doc: ["# Title", "", "```", "# not a heading", "```", ""].join("\n"),
  },
  {
    name: "setext heading",
    doc: "Setext title\n============\n\n# Atx title\n",
  },
  {
    name: "inline marks and escapes",
    doc: "real *em* vs \\*literal\\* and **strong**\n",
  },
  {
    name: "list quote link code",
    doc: ["> quote", "- list", "`code`", "[link](https://example.com)", ""].join("\n"),
  },
];

describe("Lezer vs Synoptic span derivation (I6 probe)", () => {
  /** @covers L6, IM2 */
  it("records mark/escape disagreements per edge case without resolving them", () => {
    const report: Record<string, unknown> = {};
    for (const c of CASES) {
      const lezer = lezerMarksAndEscapes(c.doc);
      const synMarks = synopticMarks(c.doc);
      const synEsc = synopticEscapes(c.doc);
      const lezerOnlyMarks = withText(c.doc, extraIn(lezer.marks, synMarks));
      const synOnlyMarks = withText(c.doc, extraIn(synMarks, lezer.marks));
      const lezerOnlyEsc = withText(c.doc, extraIn(lezer.escapes, synEsc));
      const synOnlyEsc = withText(c.doc, extraIn(synEsc, lezer.escapes));
      report[c.name] = {
        lezerOnlyMarks,
        synOnlyMarks,
        lezerOnlyEscapes: lezerOnlyEsc,
        synOnlyEscapes: synOnlyEsc,
      };
    }
    // Snapshot is the finding. Do not "fix" the scanners to make this empty.
    expect(report).toMatchInlineSnapshot(`
      {
        "escaped hash": {
          "lezerOnlyEscapes": [],
          "lezerOnlyMarks": [],
          "synOnlyEscapes": [],
          "synOnlyMarks": [],
        },
        "hash inside a fenced code block": {
          "lezerOnlyEscapes": [],
          "lezerOnlyMarks": [],
          "synOnlyEscapes": [],
          "synOnlyMarks": [
            {
              "from": 13,
              "origin": "headingMarkers",
              "text": ""# "",
              "to": 15,
            },
          ],
        },
        "inline marks and escapes": {
          "lezerOnlyEscapes": [],
          "lezerOnlyMarks": [],
          "synOnlyEscapes": [],
          "synOnlyMarks": [],
        },
        "list quote link code": {
          "lezerOnlyEscapes": [],
          "lezerOnlyMarks": [
            {
              "from": 0,
              "origin": "QuoteMark",
              "text": "">"",
              "to": 1,
            },
            {
              "from": 8,
              "origin": "ListMark",
              "text": ""-"",
              "to": 9,
            },
            {
              "from": 22,
              "origin": "LinkMark",
              "text": ""["",
              "to": 23,
            },
            {
              "from": 27,
              "origin": "LinkMark",
              "text": ""]"",
              "to": 28,
            },
            {
              "from": 28,
              "origin": "LinkMark",
              "text": ""("",
              "to": 29,
            },
            {
              "from": 48,
              "origin": "LinkMark",
              "text": "")"",
              "to": 49,
            },
          ],
          "synOnlyEscapes": [],
          "synOnlyMarks": [],
        },
        "setext heading": {
          "lezerOnlyEscapes": [],
          "lezerOnlyMarks": [
            {
              "from": 13,
              "origin": "HeaderMark",
              "text": ""============"",
              "to": 25,
            },
          ],
          "synOnlyEscapes": [],
          "synOnlyMarks": [],
        },
      }
    `);
  });

  it("exposes helper keys so a failing snapshot still names the span", () => {
    const doc = "\\# x\n";
    const lezer = lezerMarksAndEscapes(doc);
    expect(lezer.escapes.map(keyOf).join("|")).toContain(":");
  });
});

/** Host YAML fence scan (Marli `listYamlFmBlockRanges`) — not the tree. */
function hostYamlFmRanges(markdown: string): { from: number; to: number }[] {
  const lines = markdown.split("\n");
  const offsets: number[] = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1]! + line.length + 1);
  const fence = /^---\s*$/;
  const atx = /^#{1,6}\s+/;
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!fence.test(lines[i]!)) continue;
    if (i > 0) {
      const prev = lines[i - 1] ?? "";
      if (prev.trim() !== "" && !atx.test(prev)) continue;
    }
    let closer = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (fence.test(lines[j]!)) {
        closer = j;
        break;
      }
    }
    if (closer < 0) continue;
    out.push({
      from: offsets[i]!,
      to: Math.min(markdown.length, offsets[closer + 1] ?? markdown.length),
    });
    i = closer;
  }
  return out;
}

function treeFmRanges(doc: string): { from: number; to: number }[] {
  return [...projectTree(doc, FIXTURE_SCHEMA).nodes.values()]
    .map((n) => n.frontmatter)
    .filter((r): r is { from: number; to: number } => r != null)
    .sort((a, b) => a.from - b.from);
}

const FM_CASES: { name: string; doc: string }[] = [
  {
    name: "bound block before schema ATX",
    doc: ["---", "id: n0", "---", "", "# Root", "body", ""].join("\n"),
  },
  {
    name: "orphan fences with no heading",
    doc: ["---", "orphan: true", "---", "", "plain prose", ""].join("\n"),
  },
  {
    name: "hr-looking fence in body",
    doc: ["# Root", "", "---", "", "after the rule", ""].join("\n"),
  },
  {
    name: "trailing spaces on fences",
    doc: ["---  ", "id: n0", "---  ", "", "# Root", ""].join("\n"),
  },
];

describe("YAML-scan vs tree frontmatter ranges (I6 probe)", () => {
  /** @covers FM1, L6 */
  it("records frontmatter-boundary disagreements without resolving them", () => {
    const report: Record<string, unknown> = {};
    for (const c of FM_CASES) {
      const yaml = hostYamlFmRanges(c.doc);
      const tree = treeFmRanges(c.doc);
      const decorate = (rows: { from: number; to: number }[]) =>
        rows.map((r) => ({ ...r, text: JSON.stringify(c.doc.slice(r.from, r.to)) }));
      report[c.name] = {
        yamlOnly: decorate(extraIn(
          yaml.map((r) => ({ ...r, origin: "yaml" })),
          tree.map((r) => ({ ...r, origin: "tree" })),
        )),
        treeOnly: decorate(extraIn(
          tree.map((r) => ({ ...r, origin: "tree" })),
          yaml.map((r) => ({ ...r, origin: "yaml" })),
        )),
      };
    }
    expect(report).toMatchInlineSnapshot(`
      {
        "bound block before schema ATX": {
          "treeOnly": [],
          "yamlOnly": [],
        },
        "hr-looking fence in body": {
          "treeOnly": [],
          "yamlOnly": [],
        },
        "orphan fences with no heading": {
          "treeOnly": [],
          "yamlOnly": [
            {
              "from": 0,
              "origin": "yaml",
              "text": ""---\\norphan: true\\n---\\n"",
              "to": 21,
            },
          ],
        },
        "trailing spaces on fences": {
          "treeOnly": [],
          "yamlOnly": [
            {
              "from": 0,
              "origin": "yaml",
              "text": ""---  \\nid: n0\\n---  \\n"",
              "to": 19,
            },
          ],
        },
      }
    `);
  });
});
