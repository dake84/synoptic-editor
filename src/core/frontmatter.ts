/**
 * Frontmatter YAML helpers (SPEC.md § 8.2, FM3/FM5, RP6).
 * Uses eemeli/yaml for ranges and validity — no CM6, no DOM (I8).
 */

import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";
import type { Range } from "./types.js";

export interface FrontmatterField {
  key: string;
  /** Absolute document offsets of the scalar value (exclusive end). */
  valueRange: Range;
  value: string;
  /** Absolute offsets of the whole `key: value` line content inside the block body. */
  pairRange: Range;
}

export interface FrontmatterBlock {
  /** Full block including both `---` fences. */
  blockRange: Range;
  /** YAML body between fences (no fence lines). */
  bodyRange: Range;
  fields: FrontmatterField[];
  valid: boolean;
}

function fenceBounds(doc: string, block: Range): { bodyFrom: number; bodyTo: number } | null {
  const slice = doc.slice(block.from, block.to);
  if (!slice.startsWith("---")) return null;
  const afterOpen = block.from + 3 + (doc[block.from + 3] === "\n" ? 1 : doc[block.from + 3] === "\r" ? 2 : 0);
  // Find closing --- at line start within the block
  const close = slice.lastIndexOf("\n---");
  if (close < 0) {
    // empty / malformed
    const endFence = slice.indexOf("---", 3);
    if (endFence < 0) return null;
    return { bodyFrom: afterOpen, bodyTo: block.from + endFence };
  }
  return { bodyFrom: afterOpen, bodyTo: block.from + close + 1 };
}

/**
 * Parse a frontmatter block already located by the tree (including fences).
 */
export function parseFrontmatterBlock(doc: string, block: Range): FrontmatterBlock {
  const bounds = fenceBounds(doc, block);
  if (!bounds) {
    return { blockRange: block, bodyRange: { from: block.from, to: block.from }, fields: [], valid: false };
  }
  const body = doc.slice(bounds.bodyFrom, bounds.bodyTo);
  const yamlDoc = parseDocument(body, { strict: false });
  const fields: FrontmatterField[] = [];
  const contents = yamlDoc.contents;
  if (isMap(contents)) {
    for (const item of (contents as YAMLMap).items) {
      if (!isScalar(item.key) || !isScalar(item.value)) continue;
      const key = String(item.key.value ?? "");
      const value = item.value.value == null ? "" : String(item.value.value);
      const kr = item.key.range;
      const vr = item.value.range;
      if (!kr || !vr) continue;
      // yaml range: [start, end, nodeEnd] — value content is [start, end)
      const valueFrom = bounds.bodyFrom + vr[0];
      const valueTo = bounds.bodyFrom + vr[1];
      const pairFrom = bounds.bodyFrom + kr[0];
      const pairTo = bounds.bodyFrom + (vr[2] ?? vr[1]);
      fields.push({
        key,
        value,
        valueRange: { from: valueFrom, to: valueTo },
        pairRange: { from: pairFrom, to: pairTo },
      });
    }
  }
  return {
    blockRange: block,
    bodyRange: { from: bounds.bodyFrom, to: bounds.bodyTo },
    fields,
    valid: yamlDoc.errors.length === 0,
  };
}

export function fieldByKey(block: FrontmatterBlock, key: string): FrontmatterField | undefined {
  return block.fields.find((f) => f.key === key);
}

/** True if writing `text` as an unquoted YAML scalar would break the block (RP6). */
export function wouldBreakYamlValue(text: string): boolean {
  if (text.includes("\n") || text.includes("\r")) return true;
  const probe = parseDocument(`k: ${text}\n`);
  if (probe.errors.length > 0) return true;
  // Reject if the value was re-parsed as a nested map / non-scalar
  if (!isMap(probe.contents)) return true;
  const item = probe.contents.items[0];
  if (!item || !isScalar(item.value)) return true;
  return String(item.value.value ?? "") !== text && text !== "";
}

/**
 * Build a replacement for the whole frontmatter block when setting/clearing a key (FM3/FM5).
 * Returns the new block text including fences, or null if the key is missing and value is empty.
 */
export function rewriteFrontmatterBlock(
  doc: string,
  block: Range,
  key: string,
  value: string | null,
): { from: number; to: number; insert: string } | null {
  const parsed = parseFrontmatterBlock(doc, block);
  const map = new Map(parsed.fields.map((f) => [f.key, f.value]));
  if (value === null || value === "") {
    map.delete(key);
  } else {
    map.set(key, value);
  }
  const lines: string[] = [];
  for (const [k, v] of map) {
    lines.push(formatYamlLine(k, v));
  }
  const body = lines.length ? lines.join("\n") + "\n" : "";
  const insert = `---\n${body}---\n`;
  return { from: block.from, to: block.to, insert };
}

function formatYamlLine(key: string, value: string): string {
  if (value === "") return `${key}:`;
  if (wouldBreakYamlValue(value)) {
    // Quote when needed (RP6 path for form write — still produce valid YAML)
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${key}: "${escaped}"`;
  }
  return `${key}: ${value}`;
}

/**
 * Replace only the value scalar in-place when the new text stays valid (preferred for RP1).
 * Falls back to full block rewrite.
 */
export function planFieldWrite(
  doc: string,
  block: Range,
  key: string,
  value: string | null,
): { from: number; to: number; insert: string } | null {
  const parsed = parseFrontmatterBlock(doc, block);
  const field = fieldByKey(parsed, key);
  if (value === null || value === "") {
    return rewriteFrontmatterBlock(doc, block, key, null);
  }
  if (field && !wouldBreakYamlValue(value) && !/[:"'\\]/.test(value)) {
    return { from: field.valueRange.from, to: field.valueRange.to, insert: value };
  }
  return rewriteFrontmatterBlock(doc, block, key, value);
}
