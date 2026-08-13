import { expect, test } from "@playwright/test";

type CaretWhere =
  | "A body"
  | "A1 body"
  | "A2 body"
  | "A1 title"
  | "A2 title"
  | "A1 line-end"
  | "A1 from"
  | "A2 from"
  | "end-of-scope"
  | "fence";

type SpikeApi = {
  inspect: () => {
    presentation: {
      session: string;
      src: string;
      wys: string;
      srcVisible: string;
      wysVisible: string;
      srcHead: number;
      wysHead: number;
      srcDom: string;
      wysDom: string;
    };
    scope: {
      session: string;
      A: string;
      A1: string;
      A2: string;
      aVisible: string;
      a1Visible: string;
      a2Visible: string;
      aHead: number;
      a1Head: number;
      a2Head: number;
      aDom: string;
      a1Dom: string;
      a2Dom: string;
      scopeLost: { viewId: string }[];
    };
  };
  placeCaret: (id: string, where: CaretWhere) => void;
  selectAll: (id: string) => void;
  clippedCopy: (id: string) => string;
  typeIn: (id: string, text: string) => void;
};

async function inspect(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { __spike: SpikeApi }).__spike.inspect());
}

test.describe("phase-0 gate (G1–G3 against live CM6 views)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://127.0.0.1:4174/");
  });

  /** @covers G1a */
  test("G1c: source shows heading markers, wysiwyg hides them, documents stay equal", async ({ page }) => {
    const snap = (await inspect(page)).presentation;
    expect(snap.src).toBe(snap.session);
    expect(snap.wys).toBe(snap.session);
    expect(snap.session).toContain("# A");
    expect(snap.session).toContain("## A1");
    expect(snap.srcDom).toContain("#");
    expect(snap.srcDom).toContain("A");
    expect(snap.wysDom).toContain("A");
    expect(snap.wysDom).not.toContain("#");
  });

  /** @covers G1b */
  test("G1e: typing at the end of A1 stays in A1 and does not appear in A2", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("A1", "end-of-scope");
    });
    await page.locator("#pane-a1 .cm-content").focus();
    await page.keyboard.type("Q");
    const snap = (await inspect(page)).scope;
    expect(snap.A).toBe(snap.A1);
    expect(snap.A1).toBe(snap.A2);
    expect(snap.a1Visible).toContain("Q");
    expect(snap.a2Visible).not.toContain("Q");
    expect(snap.a1Dom).toContain("Q");
    expect(snap.a2Dom).not.toContain("Q");
  });

  /** @covers G1b */
  test("G1k: typing at A1.from stays in A1, not only in A", async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as { __spike: SpikeApi }).__spike;
      s.placeCaret("A1", "A1 from");
      s.typeIn("A1", "X");
    });
    const snap = (await inspect(page)).scope;
    expect(snap.a1Visible.startsWith("X")).toBe(true);
    expect(snap.aVisible).toContain("X");
    expect(snap.a2Visible).not.toContain("X");
    expect(snap.a1Dom).toContain("X");
  });

  /** @covers G1b */
  test("G1n: enter at A1.from stays in A1 and does not leak a line into A only", async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as { __spike: SpikeApi }).__spike;
      s.placeCaret("A1", "A1 from");
      s.typeIn("A1", "\n");
    });
    const snap = (await inspect(page)).scope;
    expect(snap.a1Visible.startsWith("\n")).toBe(true);
    expect(snap.aVisible).toContain(snap.a1Visible);
    expect(snap.a2Visible.startsWith("## A2")).toBe(true);
  });

  /** @covers G1b */
  test("G1p: emptying A emits scopeLost; typing in A does not reappear in A1/A2", async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as { __spike: SpikeApi }).__spike;
      s.selectAll("A");
    });
    await page.locator("#pane-a .cm-content").focus();
    await page.keyboard.press("Backspace");
    const afterDelete = (await inspect(page)).scope;
    expect(afterDelete.scopeLost.map((e) => e.viewId).sort()).toEqual(["A1", "A2"]);
    await page.keyboard.type("Z");
    const snap = (await inspect(page)).scope;
    expect(snap.aVisible).toContain("Z");
    expect(snap.a1Visible).toBe("");
    expect(snap.a2Visible).toBe("");
    expect(snap.session).toContain("Z");
  });

  /** @covers G1b */
  test("G1f: typing in A2 is visible in parent A, not in A1", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("A2", "A2 body");
    });
    await page.locator("#pane-a2 .cm-content").focus();
    await page.keyboard.type("W");
    const snap = (await inspect(page)).scope;
    expect(snap.A).toBe(snap.A2);
    expect(snap.a2Visible).toContain("W");
    expect(snap.aVisible).toContain("W");
    expect(snap.a1Visible).not.toContain("W");
  });

  /** @covers G1b */
  test("G1g: select-all copy from A1 is clipped to A1, not A2 body", async ({ page }) => {
    const text = await page.evaluate(() => {
      const s = (window as unknown as { __spike: SpikeApi }).__spike;
      s.selectAll("A1");
      return s.clippedCopy("A1");
    });
    expect(text).toContain("A1 body");
    expect(text).not.toContain("A2 body");
    expect(text).not.toContain("A body");
  });

  /** @covers G1b */
  test("G1h: backspace at A1's fence does not reveal A2 in A1", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("A1", "fence");
    });
    await page.locator("#pane-a1 .cm-content").focus();
    await page.keyboard.press("Backspace");
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("A1", "fence");
    });
    await page.locator("#pane-a1 .cm-content").focus();
    await page.keyboard.press("Backspace");
    const snap = (await inspect(page)).scope;
    expect(snap.session).toContain("## A2");
    expect(snap.a2Visible.startsWith("## A2")).toBe(true);
    expect(snap.a1Visible).not.toContain("A2 body");
    expect(snap.a1Dom).not.toContain("A2 body");
  });

  /** @covers G1b */
  test("G1i: select-all + delete in A1 does not pull A2 into A1", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.selectAll("A1");
    });
    await page.locator("#pane-a1 .cm-content").focus();
    await page.keyboard.press("Delete");
    const snap = (await inspect(page)).scope;
    expect(snap.session).toContain("## A2");
    expect(snap.a2Visible).toContain("A2 body");
    expect(snap.a1Visible).not.toContain("A2 body");
    expect(snap.a1Dom).not.toContain("A2 body");
  });

  /** @covers G1a */
  test("G1j: typing a heading at the end of source stays visible", async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as { __spike: SpikeApi }).__spike;
      s.placeCaret("src", "end-of-scope");
    });
    await page.locator("#pane-src .cm-content").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("# Z");
    const snap = (await inspect(page)).presentation;
    expect(snap.srcVisible).toContain("# Z");
    expect(snap.wysVisible).toContain("# Z");
    expect(snap.srcDom).toContain("# Z");
  });

  /** @covers G2, L2 */
  test("G2b: four live '#' keystrokes in wysiwyg mask once, never \\\\ #", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("wys", "A body");
    });
    await page.locator("#pane-wys .cm-content").focus();
    await page.keyboard.type("####");
    const snap = (await inspect(page)).presentation;
    expect(snap.session).toContain("\\#\\#\\#\\#");
    expect(snap.session).not.toContain("\\\\#");
    expect(snap.wysDom).toContain("#");
    expect(snap.wysDom).not.toContain("\\#");
  });

  /** @covers G2, L2 */
  test("G2c: backspace after a typed # in wysiwyg leaves no dangling backslash", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("wys", "A body");
    });
    await page.locator("#pane-wys .cm-content").focus();
    await page.keyboard.type("#");
    await page.keyboard.press("Backspace");
    const snap = (await inspect(page)).presentation;
    expect(snap.session).not.toContain("\\#");
    expect(snap.wysDom).not.toContain("\\");
  });

  /** @covers G2, L1 */
  test("G2e: live Backspace at the A1 title removes ##, not a neighbour line", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("wys", "A1 title");
    });
    await page.locator("#pane-wys .cm-content").focus();
    await page.keyboard.press("Backspace");
    const snap = (await inspect(page)).presentation;
    expect(snap.session).not.toContain("## A1");
    expect(snap.session).toContain("A1");
    expect(snap.session).toContain("A body");
    expect(snap.session).toContain("## A2");
  });

  /** @covers G2, L1 */
  test("G2f: live Delete at the end of wysiwyg ## A1 removes the following newline", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("wys", "A1 line-end");
    });
    await page.locator("#pane-wys .cm-content").focus();
    await page.keyboard.press("Delete");
    const snap = (await inspect(page)).presentation;
    expect(snap.session).toContain("## A1\nA1 body");
    expect(snap.session).not.toContain("## A1\n\n");
    expect(snap.session).toContain("## A2");
  });

  /** @covers G2, L4 */
  test("G2g: live spaces before A2 stay visible in source; Backspace does not strip ##", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __spike: SpikeApi }).__spike.placeCaret("wys", "A2 title");
    });
    await page.locator("#pane-wys .cm-content").focus();
    await page.keyboard.type("   ");
    const typed = (await inspect(page)).presentation;
    expect(typed.session).toContain("##    A2");
    expect(typed.wysDom).toMatch(/\s+A2/);
    await page.keyboard.press("Backspace");
    const snap = (await inspect(page)).presentation;
    expect(snap.session).toContain("##   A2");
    expect(snap.session).toMatch(/##\s+A2/);
    expect(snap.session).not.toMatch(/(^|\n)A2\n/);
  });

  /** @covers G3 */
  test("G3c: live typing in source does not copy the caret onto wysiwyg", async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as { __spike: SpikeApi }).__spike;
      s.placeCaret("wys", "A1 body");
      s.placeCaret("src", "A body");
    });
    const wysBefore = (await inspect(page)).presentation.wysHead;
    await page.locator("#pane-src .cm-content").focus();
    await page.keyboard.type("Z");
    const after = (await inspect(page)).presentation;
    expect(after.src).toBe(after.wys);
    expect(after.srcHead).not.toBe(after.wysHead);
    expect(after.wysHead).toBeGreaterThanOrEqual(wysBefore);
    expect(after.wysVisible).toContain("A1 body");
  });
});
