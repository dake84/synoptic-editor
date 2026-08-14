import { expect, test } from "@playwright/test";

type Harness = {
  inspect: () => {
    document: string;
    timelineDepth: number;
    views: { id: string; excerpt: string; scope: { nodeId: string } }[];
  };
  typeIn: (id: string, text: string) => void;
  setPresentation: (id: string, p: "source" | "wysiwyg") => void;
  openView: (opts: {
    nodeId?: string;
    include?: "own" | "subtree";
    presentation?: "source" | "wysiwyg";
  }) => string;
  find?: (id: string, query: string, mode: "view" | "document") => { id: string; class: string }[];
  replaceAll?: (id: string, text: string, classes?: string[]) => { prose: number; metadata: number };
  writeFrontmatter?: (blockFrom: number, key: string, value: string | null) => boolean;
  session: {
    writeFrontmatterField: (blockFrom: number, key: string, value: string | null) => boolean;
    view: (id: string) => {
      find: (q: string, opts: { mode: "view" | "document" }) => { id: string; class: string; from: number; to: number }[];
      replaceAll: (text: string, opts?: { classes?: string[] }) => { prose: number; metadata: number; rejected?: number };
    } | undefined;
    tree: { nodes: Map<string, { frontmatter: { from: number } | null }> };
    document: string;
    undo: () => void;
  };
};

test.describe("phase 3 harness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/");
  });

  /** @covers T65, FM3 */
  test("form click focuses input and commits on change", async ({ page }) => {
    const viewId = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      return h.inspect().views.find((v) => v.scope.nodeId === "n2")!.id;
    });
    const input = page.locator(`[data-view-id="${viewId}"] .syn-fm-form input[data-key="note"]`);
    await input.click();
    await expect(input).toBeFocused();
    await input.fill("from-ui");
    await input.blur();
    const doc = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      return h.inspect().document;
    });
    expect(doc).toContain("note: from-ui");
  });

  /** @covers T114, T40, L2 */
  test("T40 live: wysiwyg masks typed hash", async ({ page }) => {
    const doc = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const id = h.openView({ nodeId: "n2", presentation: "wysiwyg" });
      h.typeIn(id, "#");
      return h.inspect().document;
    });
    expect(doc).toContain("\\#");
  });

  /** @covers T68, F7 */
  test("find marks prose hits in the DOM and scrolls", async ({ page }) => {
    const n0Wys = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      return h.inspect().views.find((v) => v.scope.nodeId === "n0")!.id;
    });
    await page.evaluate((id) => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      h.session.view(id)!.find("Alpha", { mode: "view" });
    }, n0Wys);
    const marks = page.locator(`[data-view-id="${n0Wys}"] .syn-find-hit`);
    await expect(marks.first()).toBeVisible();
    await expect(marks.first()).toContainText("Alpha");
  });

  /** @covers T48 */
  test("find view reports hits in find-out", async ({ page }) => {
    await page.locator('[name="find-q"]').fill("Alpha");
    await page.locator('[data-cmd="find"][data-mode="view"]').click();
    await expect(page.locator("#find-out")).toContainText(/via .+/);
    await expect(page.locator("#find-out")).not.toHaveText("—");
    const text = await page.locator("#find-out").textContent();
    expect(text).toMatch(/^[1-9]\d*\/[1-9]\d*/);
  });

  /** @covers T117, F10 */
  test("F3 next advances the active hit in find-out", async ({ page }) => {
    await page.locator('[name="find-q"]').fill("e");
    await page.locator('[data-cmd="find"][data-mode="view"]').click();
    await expect(page.locator("#find-out")).toContainText(/^1\//);
    await page.locator('[data-cmd="find-next"]').click();
    await expect(page.locator("#find-out")).toContainText(/^2\//);
  });

  /** @covers T48, T75, F5, F9 */
  test("T48: source and wysiwyg hit counts differ for hash query", async ({ page }) => {
    const counts = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const src = h.openView({ nodeId: "n0", include: "subtree", presentation: "source" });
      const wys = h.openView({ nodeId: "n0", include: "subtree", presentation: "wysiwyg" });
      const a = h.session.view(src)!.find("#", { mode: "view" });
      const b = h.session.view(wys)!.find("#", { mode: "view" });
      return { src: a.length, wys: b.length, classes: b.map((x) => x.class) };
    });
    expect(counts.src).toBeGreaterThan(counts.wys);
  });

  /** @covers T76, RP2 */
  test("T76: replaceAll is one timeline step", async ({ page }) => {
    const snap = await page.evaluate(() => {
      const h = (window as unknown as { __harness: Harness }).__harness;
      const id = h.openView({ nodeId: "n2", presentation: "source" });
      const before = h.inspect().timelineDepth;
      h.session.view(id)!.find("Other", { mode: "view" });
      h.session.view(id)!.replaceAll("Alt");
      const mid = h.inspect();
      h.session.undo();
      return { before, after: mid.timelineDepth, doc: h.inspect().document, midDoc: mid.document };
    });
    expect(snap.after).toBe(snap.before + 1);
    expect(snap.midDoc).toContain("Alt");
    expect(snap.doc).toContain("Other");
  });
});
