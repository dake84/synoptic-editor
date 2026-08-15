import { describe, expect, it } from "vitest";
import {
  assertSafeHostPlugin,
  mergePlugins,
  pluginsToExtensionBags,
  type PluginContribution,
} from "../../../src/view/plugin-registry.js";

describe("plugin-registry", () => {
  it("merges by id (last wins)", () => {
    const a: PluginContribution = { id: "folio.refs", slot: "autocomplete", extension: [] };
    const b: PluginContribution = { id: "folio.refs", slot: "autocomplete", extension: [1 as never] };
    const merged = mergePlugins([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.extension).toEqual([1]);
  });

  it("splits host vs presentation slots", () => {
    const bags = pluginsToExtensionBags([
      { id: "m.md", slot: "markdown", extension: "md" as never },
      { id: "m.ac", slot: "autocomplete", extension: "ac" as never },
      { id: "m.lint", slot: "lint", extension: "lint" as never },
      { id: "m.src", slot: "source", extension: "src" as never },
      { id: "m.wy", slot: "wysiwyg", extension: "wy" as never },
    ]);
    expect(bags.host).toEqual(["md", "ac"]);
    expect(bags.presentation.source).toEqual(["lint", "src"]);
    expect(bags.presentation.wysiwyg).toEqual(["wy"]);
  });

  it("rejects empty id", () => {
    expect(() =>
      assertSafeHostPlugin({ id: "  ", slot: "lint", extension: [] }),
    ).toThrow(/id/);
  });
});
