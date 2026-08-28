/**
 * Named host plugin slots (SPEC § 12).
 * Synoptic does not implement autocomplete/lint — it mounts host contributions.
 */

import type { Extension } from "@codemirror/state";
import type { Presentation } from "./presentation.js";

export type PluginSlot =
  | "markdown"
  | "autocomplete"
  | "lint"
  | "keymap"
  | "source"
  | "wysiwyg";

export interface PluginContribution {
  /** Stable id (feature-prefixed); later registration with same id replaces. */
  id: string;
  slot: PluginSlot;
  extension: Extension;
}

const HOST_SLOTS: readonly PluginSlot[] = ["markdown", "autocomplete", "keymap"];

/** Flatten nested Extension arrays for inspection. */
export function flattenExtensions(ext: Extension): Extension[] {
  if (Array.isArray(ext)) {
    return ext.flatMap((e) => flattenExtensions(e as Extension));
  }
  return [ext];
}

/**
 * Best-effort guard (I1/I3/I4): reject contributions whose string form mentions
 * forbidden host patterns. Real CM6 objects rarely stringify usefully — hosts
 * must still honour the contract; this catches accidental `history` keymaps
 * passed as plain objects in tests and documented misuse.
 */
export function assertSafeHostPlugin(plugin: PluginContribution): void {
  if (!plugin.id.trim()) {
    throw new Error("synoptic plugin: id must be non-empty");
  }
  if (!plugin.slot) {
    throw new Error("synoptic plugin: slot required");
  }
  const flat = flattenExtensions(plugin.extension);
  for (const piece of flat) {
    const label =
      typeof piece === "object" && piece !== null && "constructor" in piece
        ? (piece as { constructor?: { name?: string } }).constructor?.name ?? ""
        : String(piece);
    if (/^history$/i.test(label) || label.includes("historyKeymap")) {
      throw new Error(
        `synoptic plugin "${plugin.id}": history()/undo on the view is forbidden (I3); use session.undo`,
      );
    }
  }
}

export function mergePlugins(plugins: readonly PluginContribution[]): PluginContribution[] {
  const byId = new Map<string, PluginContribution>();
  for (const p of plugins) {
    assertSafeHostPlugin(p);
    byId.set(p.id, p);
  }
  return [...byId.values()];
}

export function pluginsToExtensionBags(plugins: readonly PluginContribution[]): {
  host: Extension[];
  presentation: Partial<Record<Presentation, Extension[]>>;
} {
  const merged = mergePlugins(plugins);
  const host: Extension[] = [];
  const source: Extension[] = [];
  const wysiwyg: Extension[] = [];

  for (const slot of HOST_SLOTS) {
    for (const p of merged) {
      if (p.slot === slot) host.push(p.extension);
    }
  }
  for (const p of merged) {
    // Lint is source-presentation only (no gutter chrome in wysiwyg prose).
    if (p.slot === "lint" || p.slot === "source") source.push(p.extension);
    if (p.slot === "wysiwyg") wysiwyg.push(p.extension);
  }

  return {
    host,
    presentation: {
      ...(source.length > 0 ? { source } : {}),
      ...(wysiwyg.length > 0 ? { wysiwyg } : {}),
    },
  };
}
