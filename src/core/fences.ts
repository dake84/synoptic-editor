/**
 * Fenced code blocks (triple-backtick or `~~~`). CommonMark-shaped: indent 0–3,
 * marker length ≥ 3, close with the same character and at least that length.
 * Unclosed fences run to EOF. Pure string scan — no CM6 (I8).
 */

export interface FenceRange {
  from: number;
  to: number;
}

const OPEN = /^( {0,3})(`{3,}|~{3,})/;
const CLOSE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/;

function openOf(line: string): { char: string; len: number } | null {
  const m = OPEN.exec(line);
  if (!m) return null;
  const marker = m[2]!;
  return { char: marker[0]!, len: marker.length };
}

function closes(line: string, open: { char: string; len: number }): boolean {
  const m = CLOSE.exec(line);
  if (!m) return false;
  const marker = m[2]!;
  return marker[0] === open.char && marker.length >= open.len;
}

/** Inclusive ranges covering opener, content, and closer (or EOF). */
export function fencedCodeRanges(doc: string): FenceRange[] {
  const out: FenceRange[] = [];
  let offset = 0;
  let open: { char: string; len: number; from: number } | null = null;

  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineLen = line.length;
    const next = offset + lineLen + (i < lines.length - 1 ? 1 : 0);

    if (open) {
      if (closes(line, open)) {
        out.push({ from: open.from, to: next });
        open = null;
      }
      offset = next;
      continue;
    }

    const found = openOf(line);
    if (found) {
      open = { ...found, from: offset };
    }
    offset = next;
  }

  if (open) {
    out.push({ from: open.from, to: doc.length });
  }
  return out;
}

export function coveredByFence(pos: number, fences: readonly FenceRange[]): boolean {
  return fences.some((f) => pos >= f.from && pos < f.to);
}
