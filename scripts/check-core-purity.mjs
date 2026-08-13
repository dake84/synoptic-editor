#!/usr/bin/env node
// Enforces I8 (SPEC.md §5): src/core/** is headless — no @codemirror/view, no other UI
// framework, no DOM globals. One place enforces this rule (I6); nothing else may.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CORE_DIR = "src/core";
const FORBIDDEN_IMPORT_PATTERNS = [
  /@codemirror\/view/,
  /\breact\b/,
  /\bvue\b/,
  /\bsvelte\b/,
];
const FORBIDDEN_GLOBALS = [/\bdocument\./, /\bwindow\./, /\bHTMLElement\b/];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

if (!existsSync(CORE_DIR)) {
  console.log(`check-core-purity: ${CORE_DIR} noch nicht angelegt — nichts zu prüfen.`);
  process.exit(0);
}

const violations = [];
for (const file of walk(CORE_DIR)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const pattern of [...FORBIDDEN_IMPORT_PATTERNS, ...FORBIDDEN_GLOBALS]) {
      if (pattern.test(line)) {
        violations.push(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error("check-core-purity: Verstoß gegen I8 (kein DOM/UI-Framework in src/core):");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("check-core-purity: ok.");
