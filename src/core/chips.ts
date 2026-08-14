/**
 * Reference chips `[label]{attrs}` (SPEC.md § 8.3).
 * Pure string scan — no CM6 (I8).
 */

export interface ChipSpan {
  /** Whole chip including attributes. */
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  attrsFrom: number;
  attrsTo: number;
  label: string;
  attrs: string;
}

const CHIP_RE = /\[([^\]]+)\]\{([^}]*)\}/g;

export function findChips(doc: string, from = 0, to = doc.length): ChipSpan[] {
  const slice = doc.slice(from, to);
  const out: ChipSpan[] = [];
  CHIP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHIP_RE.exec(slice))) {
    const start = from + m.index;
    const label = m[1]!;
    const attrs = m[2]!;
    const labelFrom = start + 1;
    const labelTo = labelFrom + label.length;
    const attrsFrom = labelTo + 1; // after ']'
    const attrsTo = start + m[0].length;
    out.push({
      from: start,
      to: attrsTo,
      labelFrom,
      labelTo,
      attrsFrom,
      attrsTo,
      label,
      attrs,
    });
  }
  return out;
}
