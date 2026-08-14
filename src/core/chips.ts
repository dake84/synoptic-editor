/**
 * Reference chips (SPEC.md § 8.3). Pure string scan — no CM6 (I8).
 * One style per session (W6): `attribute-block` or `html-ref`.
 */

export type InlineRefStyle = "attribute-block" | "html-ref";

export interface ChipSpan {
  /** Whole chip including chrome. */
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  attrsFrom: number;
  attrsTo: number;
  label: string;
  attrs: string;
}

const ATTR_BLOCK_RE = /\[([^\]]+)\]\{([^}]*)\}/g;
/** Opening tag: `<{type}-ref …>` — type is an opaque token (W6). */
const HTML_OPEN_RE = /<([A-Za-z][\w.-]*)-ref(\s[^>]*)?>/g;

export function findChips(
  doc: string,
  from = 0,
  to = doc.length,
  style: InlineRefStyle = "attribute-block",
): ChipSpan[] {
  return style === "html-ref" ? findHtmlRefChips(doc, from, to) : findAttributeBlockChips(doc, from, to);
}

function findAttributeBlockChips(doc: string, from: number, to: number): ChipSpan[] {
  const slice = doc.slice(from, to);
  const out: ChipSpan[] = [];
  ATTR_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_BLOCK_RE.exec(slice))) {
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

function findHtmlRefChips(doc: string, from: number, to: number): ChipSpan[] {
  const slice = doc.slice(from, to);
  const out: ChipSpan[] = [];
  HTML_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_OPEN_RE.exec(slice))) {
    const open = m[0];
    if (/\/\s*>$/.test(open)) continue; // self-closing — not a chip (W6/T121)
    const type = m[1]!;
    const start = from + m.index;
    const openEnd = start + open.length;
    const closeNeedle = `</${type}-ref>`;
    const closeRel = slice.indexOf(closeNeedle, m.index + open.length);
    if (closeRel < 0) continue;
    const closeStart = from + closeRel;
    if (closeStart + closeNeedle.length > to) continue;
    const labelFrom = openEnd;
    const labelTo = closeStart;
    const label = doc.slice(labelFrom, labelTo);
    if (label.length === 0 || label.includes("<")) continue;
    const tagName = `${type}-ref`;
    const afterName = start + 1 + tagName.length;
    const gt = openEnd - 1;
    out.push({
      from: start,
      to: closeStart + closeNeedle.length,
      labelFrom,
      labelTo,
      attrsFrom: afterName,
      attrsTo: gt,
      label,
      attrs: doc.slice(afterName, gt).trim(),
    });
    HTML_OPEN_RE.lastIndex = closeRel + closeNeedle.length;
  }
  return out;
}
