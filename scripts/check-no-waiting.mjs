#!/usr/bin/env node
// Enforces I5 (SPEC.md §5): no retry, no timeout, no best-effort in scroll/focus/selection
// paths. A test that only turns green by waiting on time counts as failed.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TESTS_DIR = "tests";
const FORBIDDEN_PATTERNS = [
  /\bsetTimeout\s*\(/,
  /\bwaitForTimeout\s*\(/,
  /\bsleep\s*\(/,
  /\bretry\s*\(/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

if (!existsSync(TESTS_DIR) || walk(TESTS_DIR).length === 0) {
  console.log("check-no-waiting: keine Tests vorhanden — nichts zu prüfen.");
  process.exit(0);
}

const violations = [];
for (const file of walk(TESTS_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error("check-no-waiting: Verstoß gegen I5 (Warten auf Zeit in Tests):");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("check-no-waiting: ok.");
