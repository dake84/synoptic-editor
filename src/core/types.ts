/** Shared core types (SPEC.md § 3–4). No domain-specific identifiers. */

export interface StructureLevel {
  rank: number;
  id: string;
  headingDepth: number;
}

export interface StructureSchema {
  levels: StructureLevel[];
  idField: string;
}

export interface Range {
  from: number;
  to: number;
}

export interface TreeNode {
  id: string;
  rank: number;
  /** Heading text without markers. */
  title: string;
  parentId: string | null;
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

export interface Tree {
  /** Roots in document order. */
  roots: string[];
  nodes: Map<string, TreeNode>;
}
