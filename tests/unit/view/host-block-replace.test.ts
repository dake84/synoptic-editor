// @vitest-environment happy-dom

/**
 *
 * Host block-replace ranges suppress Synoptic FM hide / marker hide on the
 * same span (no overlapping Decoration.replace).
 *
 * @covers FM9, I6
 */
import { afterEach, describe, expect, it } from "vitest";
import { StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { createSession, createTimeline } from "../../../src/index.js";
import { hostBlockReplaceRanges } from "../../../src/view/host-block-replace.js";
import { headingUnitRanges, projectTree } from "../../../src/core/tree.js";
import type { Range, StructureSchema } from "../../../src/core/types.js";

const SCHEMA: StructureSchema = {
  idField: "id",
  levels: [
    { rank: 0, id: "level-0", headingDepth: 2 },
    { rank: 1, id: "level-1", headingDepth: 3 },
  ],
};

const DOC = [
  "---",
  "id: n0",
  "---",
  "## Alpha",
  "body one",
  "",
  "---",
  "id: n1",
  "---",
  "### Beta",
  "body two",
].join("\n");

describe("hostBlockReplaceRanges vs Synoptic FM hide", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it("skips FM hide on units the host already block-replaces", () => {
    const units = headingUnitRanges(DOC, SCHEMA);
    const child = [...projectTree(DOC, SCHEMA).nodes.values()].find((n) => n.id === "n1");
    expect(child?.frontmatter).toBeTruthy();
    const hostUnit = units.find((u) => u.from === child!.frontmatter!.from);
    expect(hostUnit).toBeTruthy();

    const rangesField = StateField.define<Range[]>({
      create: () => [hostUnit!],
      update: (v) => v,
    });

    const session = createSession({
      doc: DOC,
      schema: SCHEMA,
      timeline: createTimeline(),
      policy: {
        structureEditingInWysiwyg: "locked",
        headingEditingInWysiwyg: "locked",
        frontmatterInWysiwyg: "hidden",
      },
    });
    const handle = session.createView({
      scope: { nodeId: "n0", include: "subtree" },
      presentation: "wysiwyg",
      showNodeHeading: true,
      plugins: [
        {
          id: "test.host-block",
          slot: "wysiwyg",
          extension: [
            rangesField,
            hostBlockReplaceRanges.compute([rangesField], (state) => state.field(rangesField)),
          ],
        },
      ],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    handle.mount(host);
    view = EditorView.findFromDOM(host);
    expect(view).toBeTruthy();

    // Child FM must not appear as syn-fm-hidden-line — host owns the unit.
    const hidden = host.querySelectorAll(".syn-fm-hidden-line");
    const childFmText = DOC.slice(child!.frontmatter!.from, child!.heading.from);
    for (const el of hidden) {
      expect(el.textContent ?? "").not.toContain("id: n1");
    }
    // The host-owned FM text is still present in the document.
    expect(childFmText).toContain("id: n1");
  });
});
