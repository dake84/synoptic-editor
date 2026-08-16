/**
 * @vitest-environment happy-dom
 *
 * Golden visual-line map (Wave 2 / TASK-0026.02). Pins line-block offsets and
 * locked ranges for a representative wysiwyg document so a caret/height-map
 * regression fails on the map, not on a later movement test.
 *
 * Heights are rounded to integers. happy-dom has no font metrics — height is
 * recorded so a real layout (Playwright) can tighten the same shape later;
 * offset identity is the contract this file enforces today.
 */
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../../src/session.js";
import { synopticLockedRanges } from "../../../src/view/guards/locked-ranges.js";
import { FIXTURE_SCHEMA } from "../../fixtures/corpus.js";

const DOC = `---
id: n0
---

# Root

First paragraph with *em* and \\# escaped.

\`\`\`
# hash in fence
\`\`\`

See [chip]{id=a type=ref} here.
`;

type LineMapRow = {
  from: number;
  to: number;
  height: number;
  classes: string[];
};

function visualLineMap(ev: EditorView): LineMapRow[] {
  const rows: LineMapRow[] = [];
  const len = ev.state.doc.length;
  let pos = 0;
  while (pos <= len) {
    const block = ev.lineBlockAt(pos);
    const last = rows[rows.length - 1];
    if (!last || last.from !== block.from || last.to !== block.to) {
      const lineDom = ev.domAtPos(Math.min(block.from, len)).node;
      const el =
        lineDom instanceof HTMLElement
          ? lineDom.closest(".cm-line")
          : lineDom.parentElement?.closest(".cm-line");
      const classes =
        el instanceof HTMLElement ? Array.from(el.classList).filter((c) => c !== "cm-line").sort() : [];
      rows.push({
        from: block.from,
        to: block.to,
        height: Math.round(block.height),
        classes,
      });
    }
    if (block.to <= pos) pos += 1;
    else pos = block.to;
    if (pos > len) break;
    if (block.to >= len && last && last.to === block.to) break;
  }
  return rows;
}

describe("visual line map golden fixture", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  /** @covers L1, V11 */
  it("pins line-block offsets for the representative wysiwyg document", () => {
    const session = createSession({
      doc: DOC,
      schema: FIXTURE_SCHEMA,
      policy: { inlineRefStyle: "attribute-block" },
    });
    const handle = session.createView({
      scope: { nodeId: "n0", include: "own" },
      presentation: "wysiwyg",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    handle.mount(host);
    const ev = handle.editorView();
    expect(ev).not.toBeNull();
    const map = visualLineMap(ev!);
    expect(map.map((r) => ({ from: r.from, to: r.to }))).toMatchInlineSnapshot(`
      [
        {
          "from": 0,
          "to": 15,
        },
        {
          "from": 16,
          "to": 22,
        },
        {
          "from": 23,
          "to": 23,
        },
        {
          "from": 24,
          "to": 65,
        },
        {
          "from": 66,
          "to": 66,
        },
        {
          "from": 67,
          "to": 70,
        },
        {
          "from": 71,
          "to": 124,
        },
      ]
    `);
    expect(
      synopticLockedRanges(DOC, { schema: FIXTURE_SCHEMA, inlineRefStyle: "attribute-block" }).map(
        (r) => ({ from: r.from, to: r.to, text: DOC.slice(r.from, r.to) }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "from": 16,
          "text": "# ",
          "to": 18,
        },
        {
          "from": 71,
          "text": "# ",
          "to": 73,
        },
        {
          "from": 54,
          "text": "\\#",
          "to": 56,
        },
        {
          "from": 45,
          "text": "*",
          "to": 46,
        },
        {
          "from": 48,
          "text": "*",
          "to": 49,
        },
        {
          "from": 67,
          "text": "\`\`\`",
          "to": 70,
        },
        {
          "from": 87,
          "text": "\`\`\`",
          "to": 90,
        },
        {
          "from": 96,
          "text": "[",
          "to": 97,
        },
        {
          "from": 101,
          "text": "]{id=a type=ref}",
          "to": 117,
        },
        {
          "from": 0,
          "text": "---
      id: n0
      ---
      ",
          "to": 15,
        },
      ]
    `);
  });
});
