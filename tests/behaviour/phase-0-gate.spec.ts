import { test, expect, type Page } from "@playwright/test";

/** @covers G1, G2, G3 */

interface ViewSnapshot {
  viewId: string;
  presentation: string;
  doc: string;
  selection: { anchor: number; head: number };
  visibleText: string;
  markerVisibleInDom: boolean;
  focused: boolean;
  ownBranch: { id: string; from: number; to: number; markerFrom: number; markerTo: number };
  selectionInOwnBranch: boolean;
  docsInSync: boolean;
}

interface SpikeApi {
  getDoc(): string;
  focusView(id: string): void;
  setSelection(id: string, anchor: number, head?: number): void;
  typeText(id: string, text: string): void;
  pasteText(id: string, text: string): void;
  deleteBackward(id: string): void;
  undo(id: string): boolean;
  getSnapshot(id: string): ViewSnapshot;
  getCarets(): { a: number; b: number };
}

declare global {
  interface Window {
    __spike: SpikeApi;
  }
}

async function openSpike(page: Page): Promise<void> {
  await page.goto("http://127.0.0.1:4174/");
  await page.waitForFunction(() => window.__spike != null);
}

test.describe("Phase 0 risk gate", () => {
  test("G1: same document text, per-view presentation without storing it in the document", async ({
    page,
  }) => {
    await openSpike(page);

    const snapA = await page.evaluate(() => window.__spike.getSnapshot("a"));
    const snapB = await page.evaluate(() => window.__spike.getSnapshot("b"));

    expect(snapA.docsInSync).toBe(true);
    expect(snapB.docsInSync).toBe(true);
    expect(snapA.doc).toBe(snapB.doc);
    expect(snapA.presentation).toBe("source");
    expect(snapB.presentation).toBe("wysiwyg");

    expect(snapA.markerVisibleInDom).toBe(true);
    expect(snapB.markerVisibleInDom).toBe(false);

    expect(snapA.visibleText).toContain("Node-A");
    expect(snapA.visibleText).not.toContain("Node-B");
    expect(snapB.visibleText).toContain("Node-B");
    expect(snapB.visibleText).not.toContain("Node-A");

    const before = snapA.doc;
    await page.evaluate(() => {
      window.__spike.focusView("a");
      window.__spike.typeText("a", "Z");
    });
    const afterA = await page.evaluate(() => window.__spike.getSnapshot("a"));
    const afterB = await page.evaluate(() => window.__spike.getSnapshot("b"));
    expect(afterA.doc).not.toBe(before);
    expect(afterA.doc).toBe(afterB.doc);
    expect(afterA.docsInSync).toBe(true);
    expect(afterA.doc).toContain("Z");
  });

  test("G2: L1–L3 in one wysiwyg filter; source unmasked", async ({ page }) => {
    await openSpike(page);

    await page.evaluate(() => {
      const c = window.__spike.getCarets();
      window.__spike.focusView("a");
      window.__spike.setSelection("a", c.a);
      window.__spike.typeText("a", "#");
    });
    let     doc = await page.evaluate(() => window.__spike.getDoc());
    expect(doc).toContain("#Body of node A with plain text.");
    expect(doc).not.toContain("\\#Body");

    await page.evaluate(() => {
      const c = window.__spike.getCarets();
      window.__spike.focusView("b");
      window.__spike.setSelection("b", c.b);
      window.__spike.typeText("b", "#");
    });
    doc = await page.evaluate(() => window.__spike.getDoc());
    expect(doc).toContain("\\#");

    await page.evaluate(() => {
      const c = window.__spike.getCarets();
      window.__spike.setSelection("b", c.b);
      window.__spike.pasteText("b", "## line\n*star*");
    });
    doc = await page.evaluate(() => window.__spike.getDoc());
    expect(doc).toContain("\\#\\# line");
    expect(doc).toContain("\\*star\\*");

    const beforeUndo = doc;
    await page.evaluate(() => window.__spike.undo("b"));
    const afterUndo = await page.evaluate(() => window.__spike.getDoc());
    expect(afterUndo).not.toBe(beforeUndo);
    expect(afterUndo).not.toContain("\\#\\# line");

    await page.evaluate(() => {
      const b = window.__spike.getSnapshot("b").ownBranch;
      window.__spike.focusView("b");
      window.__spike.setSelection("b", b.markerFrom + 1, b.markerTo);
      window.__spike.deleteBackward("b");
    });
    doc = await page.evaluate(() => window.__spike.getDoc());
    expect(/^# Node-B/m.test(doc)).toBe(false);
  });

  test("G3: selection is not forwarded; document is", async ({ page }) => {
    await openSpike(page);

    const initialB = await page.evaluate(() => {
      const c = window.__spike.getCarets();
      window.__spike.focusView("a");
      window.__spike.setSelection("a", c.a);
      return window.__spike.getSnapshot("b").selection.head;
    });

    let snapA = await page.evaluate(() => window.__spike.getSnapshot("a"));
    let snapB = await page.evaluate(() => window.__spike.getSnapshot("b"));
    expect(snapA.selection.head).not.toBe(snapB.selection.head);
    expect(snapB.selection.head).toBe(initialB);
    expect(snapA.selectionInOwnBranch).toBe(true);
    expect(snapB.selectionInOwnBranch).toBe(true);
    expect(snapA.docsInSync).toBe(true);

    await page.evaluate(() => {
      window.__spike.typeText("a", "Z");
    });
    snapA = await page.evaluate(() => window.__spike.getSnapshot("a"));
    snapB = await page.evaluate(() => window.__spike.getSnapshot("b"));
    expect(snapA.doc).toBe(snapB.doc);
    expect(snapA.doc).toContain("Z");
    expect(snapA.docsInSync).toBe(true);
    expect(snapA.selection.head).not.toBe(snapB.selection.head);
    expect(snapB.selectionInOwnBranch).toBe(true);
    expect(snapB.selection.head).toBe(initialB + 1);

    const bHead = snapB.selection.head;
    await page.evaluate(() => {
      const c = window.__spike.getCarets();
      window.__spike.focusView("b");
      window.__spike.setSelection("b", c.b);
      window.__spike.typeText("b", "Q");
    });
    snapA = await page.evaluate(() => window.__spike.getSnapshot("a"));
    snapB = await page.evaluate(() => window.__spike.getSnapshot("b"));
    expect(snapB.doc).toContain("Q");
    expect(snapA.doc).toBe(snapB.doc);
    expect(snapB.selectionInOwnBranch).toBe(true);
    expect(snapA.selection.head).not.toBe(snapB.selection.head);
    expect(snapA.selectionInOwnBranch).toBe(true);
    expect(bHead).toBeGreaterThan(0);
  });
});
