#!/usr/bin/env node
// Enforces the export-surface contract (SPEC.md §12, SETUP.md §3): src/index.ts exports
// exactly the names in SPEC.md §12 — nothing more. Accidentally exported internals become
// contract the moment someone depends on them.
//
// The expected set lives in scripts/expected-exports.json, hand-maintained against §12 —
// parsing the markdown API table automatically would be fragile for a handful of names.
// Update the manifest whenever §12 changes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const INDEX_FILE = "src/index.ts";
const MANIFEST_FILE = "scripts/expected-exports.json";

function extractExports(text) {
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]+)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

if (!existsSync(INDEX_FILE)) {
  console.log(`check-export-surface: ${INDEX_FILE} noch nicht angelegt — nichts zu prüfen.`);
  process.exit(0);
}

if (!existsSync(MANIFEST_FILE)) {
  console.error(`check-export-surface: ${MANIFEST_FILE} fehlt.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
const expected = new Set(manifest.exports ?? []);
const actual = extractExports(readFileSync(INDEX_FILE, "utf8"));

const unexpected = [...actual].filter((n) => !expected.has(n)).sort();
const missing = [...expected].filter((n) => !actual.has(n)).sort();

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) {
    console.error(`check-export-surface: unerwartete Exporte aus ${INDEX_FILE} (nicht in SPEC §12 / ${MANIFEST_FILE}):`);
    console.error(`  ${unexpected.join(", ")}`);
  }
  if (missing.length > 0) {
    console.error(`check-export-surface: erwartete Exporte fehlen in ${INDEX_FILE}:`);
    console.error(`  ${missing.join(", ")}`);
  }
  process.exit(1);
}

console.log(`check-export-surface: ok (${actual.size} Exporte, deckungsgleich mit SPEC §12).`);

// Example host may import the package root only — not session.ts or deeper (Phase 4).
const EXAMPLE_DIR = "examples";
if (existsSync(EXAMPLE_DIR)) {
  const bad = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js)$/.test(name) && !full.includes("/dist/")) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
          const spec = m[1];
          if (spec.includes("/src/") && !spec.endsWith("/src/index.js") && !spec.endsWith("/src/index.ts")) {
            bad.push(`${full}: ${spec}`);
          }
        }
      }
    }
  };
  walk(EXAMPLE_DIR);
  if (bad.length > 0) {
    console.error("check-export-surface: example host imports internals (only src/index.js is public):");
    for (const line of bad) console.error(`  ${line}`);
    process.exit(1);
  }
}
