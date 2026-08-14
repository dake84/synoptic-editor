// Reproducible test/benchmark corpus generator (SPEC.md §15.1). Same seed -> byte-identical
// output, always. No domain-specific identifiers in schema or content (SPEC.md §1,
// Domänenfreiheit).
//
// Inline chips use SPEC.md § 8.3 syntax `[label]{id=… type=…}`. The generator still
// omits them until Phase-2 corpus density is needed; Phase-3 tests inject chips explicitly.

export interface StructureLevel {
  rank: number;
  id: string;
  headingDepth: number;
}

export interface StructureSchema {
  levels: StructureLevel[];
  idField: string;
}

/** Generic 4-rank schema, same rank span SPEC.md §14/T35 uses in its own example. */
export const FIXTURE_SCHEMA: StructureSchema = {
  levels: [
    { rank: 0, id: "level-0", headingDepth: 1 },
    { rank: 1, id: "level-1", headingDepth: 2 },
    { rank: 2, id: "level-2", headingDepth: 3 },
    { rank: 3, id: "level-3", headingDepth: 4 },
  ],
  idField: "id",
};

export const FIXED_SEED = 1337;

export const CORPUS_NODE_TARGETS = { S: 50, M: 500, L: 5000 } as const;
export type CorpusSize = keyof typeof CORPUS_NODE_TARGETS;

/** mulberry32 — small, seedable, deterministic. No dependency needed for this. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILLER_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do",
  "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "enim",
  "ad", "minim", "veniam", "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi",
  "aliquip", "ex", "ea", "commodo", "consequat", "duis", "aute", "irure", "in", "reprehenderit",
  "voluptate", "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur", "excepteur",
  "sint", "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia",
  "deserunt", "mollit", "anim", "id", "est", "laborum",
];

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function sentence(rng: () => number): string {
  const wordCount = 6 + Math.floor(rng() * 9);
  const words = Array.from({ length: wordCount }, () => pick(rng, FILLER_WORDS));
  words[0] = (words[0] as string).replace(/^./, (c) => c.toUpperCase());
  return `${words.join(" ")}.`;
}

function body(rng: () => number): string {
  const sentenceCount = 2 + Math.floor(rng() * 4);
  return Array.from({ length: sentenceCount }, () => sentence(rng)).join(" ");
}

interface TreeNode {
  rank: number;
  id: string;
  children: TreeNode[];
}

/**
 * Breadth-weighted random tree: every new node attaches under a random still-open parent
 * (rank below the deepest schema rank), retiring parents once they've picked up a handful of
 * children so the tree fans out across all ranks instead of piling under one root.
 */
function buildTree(rng: () => number, targetCount: number, schema: StructureSchema): TreeNode[] {
  const maxRank = schema.levels.length - 1;
  const roots: TreeNode[] = [];
  const openParents: TreeNode[] = [];
  let idCounter = 0;
  let count = 0;

  function makeNode(rank: number): TreeNode {
    idCounter += 1;
    return { rank, id: `n-${idCounter}`, children: [] };
  }

  const firstRoot = makeNode(0);
  roots.push(firstRoot);
  openParents.push(firstRoot);
  count = 1;

  while (count < targetCount) {
    if (openParents.length === 0) {
      const newRoot = makeNode(0);
      roots.push(newRoot);
      openParents.push(newRoot);
      count += 1;
      continue;
    }
    const parentIndex = Math.floor(rng() * openParents.length);
    const parent = openParents[parentIndex] as TreeNode;
    const child = makeNode(parent.rank + 1);
    parent.children.push(child);
    count += 1;
    if (child.rank < maxRank) openParents.push(child);

    const retireAfter = 3 + Math.floor(rng() * 4);
    if (parent.children.length >= retireAfter) openParents.splice(parentIndex, 1);
  }

  return roots;
}

function renderNode(node: TreeNode, schema: StructureSchema, rng: () => number, lines: string[]): void {
  const level = schema.levels[node.rank] as StructureLevel;
  lines.push("---", `${schema.idField}: ${node.id}`, "---", "");
  lines.push(`${"#".repeat(level.headingDepth)} Node ${node.id}`, "");
  lines.push(body(rng), "");
  for (const child of node.children) renderNode(child, schema, rng, lines);
}

export function generateCorpus(
  size: CorpusSize,
  schema: StructureSchema = FIXTURE_SCHEMA,
  seed: number = FIXED_SEED,
): string {
  const rng = mulberry32(seed);
  const roots = buildTree(rng, CORPUS_NODE_TARGETS[size], schema);
  const lines: string[] = [];
  for (const root of roots) renderNode(root, schema, rng, lines);
  return `${lines.join("\n").trimEnd()}\n`;
}
