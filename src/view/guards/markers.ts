/**
 * ATX heading markers and mask pairs (SPEC.md L1, L2). Pure string scan.
 */

/** ATX atom: hashes plus exactly one separator. Extra spaces are title (L4). */
const HEADING_MARKER = /^(#{1,6}[ \t])/gm;

export function headingMarkers(doc: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const re = new RegExp(HEADING_MARKER.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    out.push({ from: m.index, to: m.index + m[1]!.length });
  }
  return out;
}

const META = new Set(["#", "*", "_", ">", "`", "<", "\\", "-"]);

export function maskPairs(doc: string, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let i = from; i < to; i++) {
    if (doc[i] !== "\\") continue;
    const next = doc[i + 1];
    if (next !== undefined && META.has(next) && i + 2 <= to) {
      out.push({ from: i, to: i + 2 });
      i++;
    }
  }
  return out;
}

export function maskBackslashRanges(doc: string, from: number, to: number): { from: number; to: number }[] {
  return maskPairs(doc, from, to).map((p) => ({ from: p.from, to: p.from + 1 }));
}
