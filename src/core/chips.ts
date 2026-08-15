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
  /**
   * True when the document holds a real label text node (selectable, F7).
   * False for W7: self-closing, empty, or comment-only body — synthetic label.
   */
  textNode: boolean;
}

const ATTR_BLOCK_RE = /\[([^\]]+)\]\{([^}]*)\}/g;
/**
 * Opening tag: `<{type}-ref …>` — type is an opaque token (W6).
 * Attrs stay on one line (`[^>\n]*`) so an incomplete open while typing cannot
 * swallow the next complete tag across a newline. Optional `/` before `>` is
 * captured separately (W7 self-closing).
 */
const HTML_OPEN_RE = /<([A-Za-z][\w.-]*)-ref\b([^>\n]*?)\s*(\/?)\s*>/g;

/** CommonMark: odd run of `\` immediately before `index` escapes that character. */
function isMarkdownEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes += 1;
  return slashes % 2 === 1;
}

/** W7 visible label: `id` | `type` attr | type token | `ref`. */
function syntheticLabel(attrs: string, typeToken: string): string {
  const id = /\bid\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
  if (id) return id;
  const typeAttr = /\btype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
  if (typeAttr) return typeAttr;
  if (typeToken.length > 0) return typeToken;
  return "ref";
}

/**
 * Body between open and close (exclusive of tags).
 * Nested markup (`<` outside comments) → not a chip (T121).
 * Empty / whitespace / comment-only → W7 (no text node).
 */
function analyzeHtmlBody(raw: string): { textNode: boolean; label: string } | "reject" {
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, "");
  if (/</.test(withoutComments)) return "reject";
  const trimmed = withoutComments.trim();
  if (trimmed.length === 0) return { textNode: false, label: "" };
  return { textNode: true, label: trimmed };
}

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
    if (isMarkdownEscaped(doc, start)) continue;
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
      textNode: true,
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
    const type = m[1]!;
    const start = from + m.index;
    if (isMarkdownEscaped(doc, start)) continue;

    const tagName = `${type}-ref`;
    const afterName = start + 1 + tagName.length;
    const openEnd = start + open.length;
    const gt = openEnd - 1;
    const attrs = (m[2] ?? "").trim();
    const selfClosingOpen = m[3] === "/";

    if (selfClosingOpen) {
      out.push({
        from: start,
        to: openEnd,
        labelFrom: openEnd,
        labelTo: openEnd,
        attrsFrom: afterName,
        attrsTo: gt,
        label: syntheticLabel(attrs, type),
        attrs,
        textNode: false,
      });
      continue;
    }

    const closeNeedle = `</${type}-ref>`;
    const closeRel = slice.indexOf(closeNeedle, m.index + open.length);
    if (closeRel < 0) continue;
    const closeStart = from + closeRel;
    const closeEnd = closeStart + closeNeedle.length;
    if (closeEnd > to) continue;

    const rawBody = doc.slice(openEnd, closeStart);
    const analyzed = analyzeHtmlBody(rawBody);
    if (analyzed === "reject") continue;

    if (!analyzed.textNode) {
      out.push({
        from: start,
        to: closeEnd,
        labelFrom: openEnd,
        labelTo: openEnd,
        attrsFrom: afterName,
        attrsTo: gt,
        label: syntheticLabel(attrs, type),
        attrs,
        textNode: false,
      });
    } else {
      out.push({
        from: start,
        to: closeEnd,
        labelFrom: openEnd,
        labelTo: closeStart,
        attrsFrom: afterName,
        attrsTo: gt,
        label: analyzed.label,
        attrs,
        textNode: true,
      });
    }
    HTML_OPEN_RE.lastIndex = closeRel + closeNeedle.length;
  }
  return out;
}
