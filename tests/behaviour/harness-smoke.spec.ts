import { test, expect, type Page } from "@playwright/test";

/** @covers T1, T7, I4 */

interface HarnessApi {
  commands: {
    scrollToNode(viewId: string, nodeId: string, cause: string): void;
    focusView(viewId: string): void;
    applyStructure(action: { type: "deleteNode"; nodeId: string }): boolean;
    undo(): boolean;
  };
  inspect(): {
    views: Array<{ id: string; visibleNode: string | null; lastScrollCause?: string }>;
    timelineDepth: number;
  };
  getDoc(): string;
}

declare global {
  interface Window {
    __harness: HarnessApi;
    __viewIds: { a: string; b: string };
  }
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__harness != null);
}

test.describe("Harness smoke", () => {
  test("T7/I4: scrollToNode records named cause; other view untouched", async ({ page }) => {
    await openHarness(page);

    const before = await page.evaluate(() => {
      const ids = window.__viewIds;
      const snap = window.__harness.inspect();
      const b = snap.views.find((v) => v.id === ids.b)!;
      return { bVisible: b.visibleNode, ids };
    });

    await page.evaluate(() => {
      const { a } = window.__viewIds;
      window.__harness.commands.scrollToNode(a, "child-a", "test-t7");
    });

    const after = await page.evaluate(() => {
      const ids = window.__viewIds;
      const snap = window.__harness.inspect();
      const a = snap.views.find((v) => v.id === ids.a)!;
      const b = snap.views.find((v) => v.id === ids.b)!;
      return {
        aCause: a.lastScrollCause,
        aVisible: a.visibleNode,
        bVisible: b.visibleNode,
      };
    });

    expect(after.aCause).toBe("test-t7");
    expect(after.aVisible).toBe("child-a");
    // T1-ish: B's visible node unchanged by A's scroll command
    expect(after.bVisible).toBe(before.bVisible);
  });

  test("structure delete + undo via commands", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      window.__harness.commands.applyStructure({ type: "deleteNode", nodeId: "child-b" });
    });
    let doc = await page.evaluate(() => window.__harness.getDoc());
    expect(doc).not.toContain("## Child B");

    await page.evaluate(() => window.__harness.commands.undo());
    doc = await page.evaluate(() => window.__harness.getDoc());
    expect(doc).toContain("## Child B");
  });
});
