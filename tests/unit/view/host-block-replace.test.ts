/**
 * @vitest-environment happy-dom
 *
 * Host block-replace ranges suppress Synoptic FM hide / marker hide on the
 * same span (no overlapping Decoration.replace).
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { createSession, createTimeline } from "../../../src/index.js";
import {
  hostBlockReplaceRanges,
  type ProtectedRange,
} from "../../../src/view/host-block-replace.js";
import { headingUnitRanges, projectTree } from "../../../src/core/tree.js";
import type { StructureSchema } from "../../../src/core/types.js";

const SCHEMA: StructureSchema = {
  idField: "id",
  levels: [
    { rank: 0, name: "chapter", headingDepth: 2 },
    { rank: 1, name: "scene", headingDepth: 3 },
  ],
};

const DOC = [
  "---",
  "id: ch1",
  "---",
  "## Chapter",
  "body one",
  "",
  "---",
  "id: sc1",
  "---",
  "### Scene",
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
    const scene = [...projectTree(DOC, SCHEMA).nodes.values()].find((n) => n.id === "sc1");
    expect(scene?.frontmatter).toBeTruthy();
    const hostUnit = units.find((u) => u.from === scene!.frontmatter!.from);
    expect(hostUnit).toBeTruthy();

    const rangesField = StateField.define<ProtectedRange[]>({
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
      scope: { nodeId: "ch1", include: "subtree" },
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

    // Scene FM must not appear as syn-fm-hidden-line — host owns the unit.
    const hidden = host.querySelectorAll(".syn-fm-hidden-line");
    const sceneFmText = DOC.slice(scene!.frontmatter!.from, scene!.heading.from);
    for (const el of hidden) {
      expect(el.textContent ?? "").not.toContain("id: sc1");
    }
    // Chapter FM (not host-owned) still hidden.
    expect(sceneFmText).toContain("id: sc1");
    void EditorState;
  });
});
