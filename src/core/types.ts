/** Shared core types (SPEC.md § 3–4). No domain-specific identifiers. */

/** One structural level in a {@link StructureSchema} (SPEC.md § 4). */
export interface StructureLevel {
  /** Nesting rank; `0` is the outermost level. */
  rank: number;
  /** Opaque level id supplied by the host. */
  id: string;
  /** ATX heading depth for this level (gapless from 1 in a valid schema). */
  headingDepth: number;
}

/** Host-supplied structure of the document (SPEC.md § 4). */
export interface StructureSchema {
  /** Levels in rank order. */
  levels: StructureLevel[];
  /** Frontmatter key that holds the node id. */
  idField: string;
}

/** Half-open document range `[from, to)`. */
export interface Range {
  /** Inclusive start offset. */
  from: number;
  /** Exclusive end offset. */
  to: number;
}

/** One node in the projected structure {@link Tree}. */
export interface TreeNode {
  /** Node id from frontmatter / schema `idField`. */
  id: string;
  /** Schema rank. */
  rank: number;
  /** Heading text without markers. */
  title: string;
  /** Parent node id, or `null` for a root. */
  parentId: string | null;
  /** Child ids in document order. */
  childIds: string[];
  /** Frontmatter block including fences, or null. */
  frontmatter: Range | null;
  /** ATX heading line without trailing newline (from '#' through end of title). */
  heading: Range;
  /** ownRange: frontmatter (if any) + heading + body until first child heading. */
  ownRange: Range;
  /** subtreeRange: ownRange including all descendants. */
  subtreeRange: Range;
}

/** Projected document tree. */
export interface Tree {
  /** Roots in document order. */
  roots: string[];
  /** Nodes keyed by id. */
  nodes: Map<string, TreeNode>;
}
