/**
 * Block-start offsets for presentation scroll (SPEC.md V11). Pure string, no CM6 (I8).
 */

import { findHtmlComments } from "./html-comments.js";

const ATX = /^#{1,6}(?:[ \t]|$)/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>/;
const UL = /^\s*[-*+]\s/;
const OL = /^\s*\d+[.)]\s/;

function lineStarts(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    out.push({ start: offset, text: line });
    offset += line.length + 1;
  }
  return out;
}

function skipHeadingAndFrontmatter(text: string): number {
  const lines = lineStarts(text);
  let i = 0;
  if (lines[0] && ATX.test(lines[0].text)) i = 1;
  while (i < lines.length && lines[i]!.text.trim() === "") i += 1;
  if (i < lines.length && lines[i]!.text.trim() === "---") {
    i += 1;
    while (i < lines.length && lines[i]!.text.trim() !== "---") i += 1;
    if (i < lines.length) i += 1;
  }
  return i < lines.length ? lines[i]!.start : text.length;
}

function lineCovered(start: number, end: number, comments: { from: number; to: number }[]): boolean {
  return comments.some((c) => c.from <= start && end <= c.to);
}

function openerKind(line: string): "fence" | "quote" | "ul" | "ol" | "para" | null {
  if (line.trim() === "") return null;
  if (FENCE.test(line)) return "fence";
  if (QUOTE.test(line)) return "quote";
  if (UL.test(line)) return "ul";
  if (OL.test(line)) return "ol";
  return "para";
}

/** Start offsets of visible body blocks after heading + adjacent frontmatter. */
export function bodyBlockStarts(text: string): number[] {
  const bodyFrom = skipHeadingAndFrontmatter(text);
  const comments = findHtmlComments(text, bodyFrom);
  const lines = lineStarts(text).filter((l) => l.start >= bodyFrom);
  const starts: number[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const end = line.start + line.text.length;
    if (lineCovered(line.start, end, comments) || line.text.trim() === "") {
      i += 1;
      continue;
    }
    const kind = openerKind(line.text);
    if (!kind) {
      i += 1;
      continue;
    }
    starts.push(line.start);
    if (kind === "fence") {
      const marker = FENCE.exec(line.text)?.[1] ?? "```";
      i += 1;
      while (i < lines.length && lines[i]!.text.trim() !== marker) i += 1;
      if (i < lines.length) i += 1;
      continue;
    }
    if (kind === "quote" || kind === "ul" || kind === "ol") {
      const same = kind;
      i += 1;
      while (i < lines.length && openerKind(lines[i]!.text) === same) i += 1;
      continue;
    }
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      const nextEnd = next.start + next.text.length;
      if (next.text.trim() === "" || lineCovered(next.start, nextEnd, comments)) break;
      if (openerKind(next.text) !== "para") break;
      i += 1;
    }
  }
  return starts;
}

/** Index of the last start at or before `pos`, or -1 when `pos` precedes the first. */
export function blockIndexAtOffset(starts: readonly number[], pos: number): number {
  let index = -1;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= pos) index = i;
    else break;
  }
  return index;
}
