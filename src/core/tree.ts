/**
 * Tree projection from markdown headings + frontmatter (SPEC.md I2, § 3.1, § 4).
 * Pure function of document + schema — never mutated in place as a second truth.
 */

import type { Range, StructureSchema, Tree, TreeNode } from "./types.js";

interface RawHeading {
  id: string;
  rank: number;
  title: string;
  /** Start of frontmatter (or heading if none). */
  start: number;
  frontmatter: Range | null;
  heading: Range;
  /** Index of first char after heading line's newline (body start). */
  afterHeading: number;
}

function depthToRank(schema: StructureSchema): Map<number, number> {
  const m = new Map<number, number>();
  for (const level of schema.levels) m.set(level.headingDepth, level.rank);
  return m;
}

function parseYamlId(block: string, idField: string): string | null {
  const re = new RegExp(`^${escapeRegExp(idField)}:\\s*(.+)$`, "m");
  const m = re.exec(block);
  if (!m) return null;
  return m[1]!.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan document for schema-ranked ATX headings with optional preceding frontmatter.
 * Headings whose depth is not in the schema are ignored (body text, not nodes).
 */
function scanHeadings(doc: string, schema: StructureSchema): RawHeading[] {
  const rankOf = depthToRank(schema);
  const lines = doc.split("\n");
  const out: RawHeading[] = [];
  let offset = 0;
  let i = 0;
  let autoId = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const lineStart = offset;
    const lineLen = line.length;
    const nextOffset = offset + lineLen + (i < lines.length - 1 ? 1 : 0);

    // Frontmatter fence
    if (line === "---") {
      let j = i + 1;
      let inner = "";
      let endOffset = nextOffset;
      let found = false;
      while (j < lines.length) {
        const l = lines[j]!;
        const lStart = endOffset;
        if (l === "---") {
          found = true;
          endOffset = lStart + l.length + (j < lines.length - 1 ? 1 : 0);
          j += 1;
          break;
        }
        inner += (inner ? "\n" : "") + l;
        endOffset = lStart + l.length + (j < lines.length - 1 ? 1 : 0);
        j += 1;
      }
      if (found) {
        // Skip blank lines between frontmatter and heading
        let k = j;
        let look = endOffset;
        while (k < lines.length && lines[k] === "") {
          look += lines[k]!.length + (k < lines.length - 1 ? 1 : 0);
          k += 1;
        }
        if (k < lines.length) {
          const hLine = lines[k]!;
          const hm = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(hLine);
          if (hm) {
            const depth = hm[1]!.length;
            const rank = rankOf.get(depth);
            if (rank !== undefined) {
              const headingFrom = look;
              const headingTo = look + hLine.length;
              const afterHeading = headingTo + (k < lines.length - 1 ? 1 : 0);
              const id = parseYamlId(inner, schema.idField) ?? `auto-${++autoId}`;
              out.push({
                id,
                rank,
                title: hm[2]!,
                start: lineStart,
                frontmatter: { from: lineStart, to: endOffset },
                heading: { from: headingFrom, to: headingTo },
                afterHeading,
              });
              // Advance past heading
              offset = afterHeading;
              i = k + 1;
              continue;
            }
          }
        }
      }
      offset = nextOffset;
      i += 1;
      continue;
    }

    const hm = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (hm) {
      const depth = hm[1]!.length;
      const rank = rankOf.get(depth);
      if (rank !== undefined) {
        const headingFrom = lineStart;
        const headingTo = lineStart + lineLen;
        const afterHeading = nextOffset;
        out.push({
          id: `auto-${++autoId}`,
          rank,
          title: hm[2]!,
          start: headingFrom,
          frontmatter: null,
          heading: { from: headingFrom, to: headingTo },
          afterHeading,
        });
        offset = afterHeading;
        i += 1;
        continue;
      }
    }

    offset = nextOffset;
    i += 1;
  }

  return out;
}

/**
 * Project a Tree from document text + schema (I2).
 * Call again after every document change — do not mutate the previous tree.
 */
export function projectTree(doc: string, schema: StructureSchema): Tree {
  const headings = scanHeadings(doc, schema);
  const nodes = new Map<string, TreeNode>();
  const roots: string[] = [];
  const stack: RawHeading[] = [];

  // Parent assignment via rank stack
  const parents: (string | null)[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    while (stack.length > 0 && stack[stack.length - 1]!.rank >= h.rank) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]! : null;
    parents.push(parent ? parent.id : null);
    if (!parent) roots.push(h.id);
    stack.push(h);
  }

  // Child lists
  const childIds = new Map<string, string[]>();
  for (const h of headings) childIds.set(h.id, []);
  for (let i = 0; i < headings.length; i++) {
    const p = parents[i];
    if (p) childIds.get(p)!.push(headings[i]!.id);
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const children = childIds.get(h.id)!;
    let ownTo: number;
    if (children.length > 0) {
      const firstChild = headings.find((x) => x.id === children[0])!;
      ownTo = firstChild.start;
    } else {
      ownTo = i + 1 < headings.length ? headings[i + 1]!.start : doc.length;
    }

    const ownFrom = h.start;
    const ownRange: Range = { from: ownFrom, to: ownTo };

    nodes.set(h.id, {
      id: h.id,
      rank: h.rank,
      title: h.title,
      parentId: parents[i]!,
      childIds: children,
      frontmatter: h.frontmatter,
      heading: h.heading,
      ownRange,
      // subtree filled in second pass
      subtreeRange: { from: ownFrom, to: ownTo },
    });
  }

  // subtreeRange: from node start to end of last descendant's ownRange (or ownTo)
  function subtreeTo(id: string): number {
    const n = nodes.get(id)!;
    if (n.childIds.length === 0) return n.ownRange.to;
    let max = n.ownRange.to;
    for (const c of n.childIds) {
      max = Math.max(max, subtreeTo(c));
    }
    return max;
  }

  for (const id of nodes.keys()) {
    const n = nodes.get(id)!;
    n.subtreeRange = { from: n.ownRange.from, to: subtreeTo(id) };
  }

  return { roots, nodes };
}

export function getNode(tree: Tree, id: string): TreeNode | undefined {
  return tree.nodes.get(id);
}

export function ownRangeOf(tree: Tree, id: string): Range | undefined {
  return tree.nodes.get(id)?.ownRange;
}

export function subtreeRangeOf(tree: Tree, id: string): Range | undefined {
  return tree.nodes.get(id)?.subtreeRange;
}

/** Slice document text for a range. */
export function sliceRange(doc: string, range: Range): string {
  return doc.slice(range.from, range.to);
}

/**
 * Resolve which node owns a document position (for TrackedPosition.resolve).
 * Prefers the deepest node whose subtreeRange contains pos.
 */
export function nodeAtPosition(tree: Tree, pos: number): TreeNode | undefined {
  let best: TreeNode | undefined;
  for (const n of tree.nodes.values()) {
    if (pos >= n.subtreeRange.from && pos < n.subtreeRange.to) {
      if (!best || n.rank > best.rank) best = n;
      // Also prefer tighter subtree
      if (best && n.subtreeRange.to - n.subtreeRange.from < best.subtreeRange.to - best.subtreeRange.from) {
        best = n;
      }
    }
  }
  // Include position at end of doc belonging to last node
  if (!best) {
    for (const n of tree.nodes.values()) {
      if (pos >= n.subtreeRange.from && pos <= n.subtreeRange.to) {
        if (!best || n.rank > best.rank) best = n;
      }
    }
  }
  return best;
}
