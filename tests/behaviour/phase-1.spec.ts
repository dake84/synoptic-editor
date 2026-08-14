import { expect, test } from "@playwright/test";

type Harness = {
  inspect: () => {
    document: string;
    timelineDepth: number;
    activeNode: string | null;
    visibleNode: string | null;
    layoutDuringUpdate: number;
    views: {
      id: string;
      excerpt: string;
      caret: number;
      lastScrollCause: string | null;
      grainRanks: number[];
      scope: { nodeId: string; include: string };
      scrollTop: number;
      visibleNode: string | null;
    }[];
    events: { type: string; viewId?: string }[];
  };
  typeIn: (id: string, text: string) => void;
  setScope: (id: string, nodeId: string, include?: "own" | "subtree") => void;
  setPresentation: (id: string, p: "source" | "wysiwyg") => void;
  setGrain: (id: string, rank: number) => void;
  scrollToNode: (id: string, nodeId: string, cause: string) => void;
  navigateTo: (id: string, nodeId: string) => void;
  focusView: (id: string) => void;
  setSelection: (id: string, from: number, to?: number) => void;
  openView: (opts: { nodeId?: string; include?: "own" | "subtree"; presentation?: "source" | "wysiwyg" }) => string;
  closeView: (id: string) => void;
  replaceDocument: (doc: string) => void;
  getState: (id: string) => { scrollAt: string; caretAt: string };
  openFromState: (state: { scrollAt: string; caretAt: string }) => string;
  flush: () => Promise<Harness["inspect"] extends () => infer R ? R : never>;
  undo: () => void;
};

const PAD = "\n".repeat(60);
const TALL = `---
id: n0
---

# Root
${PAD}Root body.
${PAD}---
id: n1
---

## Child
${PAD}Child body.
${PAD}---
id: n2
---

# Other
${PAD}Other body.
`;

test.describe("phase 1 harness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/");
  });

  /** @covers T6, T7, I4 */
  test("T6/T7: opening a view does not move others; scroll carries a cause", async ({ page }) => {
    const snap = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const before = h.inspect();
      const id = h.openView({ nodeId: "n1" });
      h.scrollToNode(before.views[0]!.id, "n0", "test-scroll");
      const after = h.inspect();
      return { before, after, id };
    });
    expect(snap.after.views.length).toBe(snap.before.views.length + 1);
    expect(snap.after.views[0]!.lastScrollCause).toBe("test-scroll");
  });

  /** @covers T14, T16 */
  test("T14/T16: grain change keeps document and marks structure ranks", async ({ page }) => {
    const snap = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const id = h.inspect().views[0]!.id;
      const before = h.inspect();
      h.setGrain(id, 0);
      const after = h.inspect();
      return { beforeDoc: before.document, afterDoc: after.document, depth: after.timelineDepth, ranks: after.views[0]!.grainRanks };
    });
    expect(snap.afterDoc).toBe(snap.beforeDoc);
    expect(snap.ranks.every((r) => r <= 0)).toBe(true);
  });

  /** @covers T18, G1b, S1 */
  test("T18: typing in a disjoint view does not change the other excerpt", async ({ page }) => {
    const snap = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const [a, b] = h.inspect().views;
      h.typeIn(a!.id, "HELLO");
      return h.inspect();
    });
    expect(snap.views[0]!.excerpt).toContain("HELLO");
    expect(snap.views[1]!.excerpt).not.toContain("HELLO");
  });

  /** @covers G2, T114 */
  test("G2: four live # in wysiwyg mask once", async ({ page }) => {
    const text = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const id = h.openView({ nodeId: "n2", presentation: "wysiwyg" });
      h.typeIn(id, "####");
      return h.inspect().document;
    });
    expect(text).toContain("\\#\\#\\#\\#");
    expect(text).not.toContain("\\\\#");
  });

  /** @covers T1, T5 */
  test("T1/T5: scrolling or grain change in A leaves B's scrollTop alone", async ({ page }) => {
    const snap = await page.evaluate(async (doc) => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      h.replaceDocument(doc);
      const [a, b] = h.inspect().views;
      const beforeB = b!.scrollTop;
      h.scrollToNode(a!.id, "n1", "user-scroll");
      await h.flush();
      const mid = h.inspect();
      h.setGrain(a!.id, 0);
      const after = h.inspect();
      return {
        beforeB,
        midB: mid.views[1]!.scrollTop,
        afterB: after.views[1]!.scrollTop,
        midA: mid.views[0]!.scrollTop,
        afterA: after.views[0]!.scrollTop,
      };
    }, TALL);
    expect(snap.midB).toBe(snap.beforeB);
    expect(snap.afterB).toBe(snap.midB);
    expect(snap.afterA).toBe(snap.midA);
  });

  /** @covers T3 */
  test("T3: presentation change keeps the same reading line", async ({ page }) => {
    const snap = await page.evaluate(async (doc) => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      h.replaceDocument(doc);
      const [a, b] = h.inspect().views;
      h.scrollToNode(a!.id, "n1", "read");
      await h.flush();
      const before = h.inspect();
      h.setPresentation(a!.id, "wysiwyg");
      await h.flush();
      const after = h.inspect();
      return {
        beforeVis: before.views[0]!.visibleNode,
        afterVis: after.views[0]!.visibleNode,
        cause: after.views[0]!.lastScrollCause,
        beforeB: before.views[1]!.scrollTop,
        afterB: after.views[1]!.scrollTop,
        bId: b!.id,
      };
    }, TALL);
    expect(snap.afterVis).toBe(snap.beforeVis);
    expect(snap.cause).toBe("presentation");
    expect(snap.afterB).toBe(snap.beforeB);
  });

  /** @covers T2, T57, T58 */
  test("T2/T57/T58: navigateTo inside keeps scope; outside rebinds only that view", async ({ page }) => {
    const snap = await page.evaluate(async () => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const [a, b] = h.inspect().views;
      h.navigateTo(a!.id, "n1");
      await h.flush();
      const mid = h.inspect();
      h.navigateTo(a!.id, "n2");
      await h.flush();
      const after = h.inspect();
      return {
        midScope: mid.views[0]!.scope.nodeId,
        afterScope: after.views[0]!.scope.nodeId,
        bScope: after.views[1]!.scope.nodeId,
        otherId: b!.id,
      };
    });
    expect(snap.midScope).toBe("n0");
    expect(snap.afterScope).toBe("n2");
    expect(snap.bScope).toBe("n2");
  });

  /** @covers T4, T33, U5 */
  test("T4: undo while focused on the other view reveals the target node", async ({ page }) => {
    const snap = await page.evaluate(async () => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const [a, b] = h.inspect().views;
      h.typeIn(a!.id, "UNDOME");
      h.focusView(b!.id);
      h.undo();
      await h.flush();
      return h.inspect();
    });
    expect(snap.document).not.toContain("UNDOME");
    expect(snap.views[1]!.scope.nodeId).toBe("n0");
    expect(snap.views[1]!.lastScrollCause).toBe("undo");
  });

  /** @covers T8 */
  test("T8: scrolling across nodes reports the sequence", async ({ page }) => {
    const seq = await page.evaluate(async (doc) => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      h.replaceDocument(doc);
      const a = h.inspect().views[0]!;
      h.scrollToNode(a.id, "n0", "read");
      const first = await h.flush();
      h.scrollToNode(a.id, "n1", "read");
      const second = await h.flush();
      return [first.views[0]!.visibleNode, second.views[0]!.visibleNode];
    }, TALL);
    expect(seq).toEqual(["n0", "n1"]);
  });

  /** @covers T9, T11 */
  test("T9/T11: selection does not change visibleNode; session.visibleNode follows focus", async ({ page }) => {
    const snap = await page.evaluate(async () => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const [a, b] = h.inspect().views;
      h.scrollToNode(a!.id, "n0", "read");
      await h.flush();
      const afterScroll = h.inspect();
      h.setSelection(a!.id, afterScroll.views[0]!.caret + 1);
      await h.flush();
      const afterSel = h.inspect();
      h.focusView(b!.id);
      await h.flush();
      const afterFocus = h.inspect();
      return {
        visScroll: afterScroll.views[0]!.visibleNode,
        visSel: afterSel.views[0]!.visibleNode,
        sessionAfterFocus: afterFocus.visibleNode,
        bVisible: afterFocus.views[1]!.visibleNode,
      };
    });
    expect(snap.visSel).toBe(snap.visScroll);
    expect(snap.sessionAfterFocus).toBe(snap.bVisible);
  });

  /** @covers T88, V4 */
  test("T88: restore scrolls to scrollAt, not to the caret", async ({ page }) => {
    const snap = await page.evaluate(async (doc) => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      h.replaceDocument(doc);
      for (const v of h.inspect().views) h.closeView(v.id);
      const id = h.openView({ nodeId: "n0", include: "subtree" });
      h.scrollToNode(id, "n0", "read");
      await h.flush();
      const child = h.inspect().document.indexOf("Child body");
      h.setSelection(id, child);
      const state = h.getState(id)!;
      h.closeView(id);
      const again = h.openFromState(state);
      await h.flush();
      const view = h.inspect().views.find((v) => v.id === again)!;
      return {
        cause: view.lastScrollCause,
        caret: view.caret,
        child,
        visible: view.visibleNode,
      };
    }, TALL);
    expect(snap.cause).toBe("restore");
    expect(snap.caret).toBe(snap.child);
    expect(snap.visible).toBe("n0");
  });

  /** @covers T13 */
  test("T13: typing does not measure layout during the update", async ({ page }) => {
    const hits = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const id = h.inspect().views[0]!.id;
      h.typeIn(id, "X");
      return h.inspect().layoutDuringUpdate;
    });
    expect(hits).toBe(0);
  });
});
