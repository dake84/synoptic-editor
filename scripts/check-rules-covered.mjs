#!/usr/bin/env node
// Ties SPEC.md rule ids to tests (SETUP.md §2). Reads every rule id and test-case id (T1–T106,
// T-V1/T-V2) out of SPEC.md, every `@covers` annotation out of tests/**, and reports:
//   - a rule with zero covering tests           -> error
//   - an @covers referencing an unknown id      -> error (typo or a deleted rule)
//   - a T-id from the test matrix with no test  -> error
// "Ist die Spec umgesetzt" wird damit eine Zahl, keine Einschätzung.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SPEC_FILE = "SPEC.md";
const TESTS_DIR = "tests";

// Longest prefix first so "TP"/"FM"/"RP" aren't swallowed by "T"/"F"/"R".
const RULE_PREFIXES = ["TP", "FM", "RP", "I", "V", "S", "R", "U", "D", "L", "W", "P", "F", "B", "G"];

function extractRuleIds(text) {
  const ids = new Set();
  for (const prefix of RULE_PREFIXES) {
    const re = new RegExp(`\\b${prefix}(\\d{1,3})\\b`, "g");
    for (const m of text.matchAll(re)) ids.add(`${prefix}${m[1]}`);
  }
  return ids;
}

function extractTestCaseIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bT-V[12]\b/g)) ids.add(m[0]);
  for (const m of text.matchAll(/\bT(\d{1,3})\b/g)) ids.add(`T${m[1]}`);
  // Ranges like "T28–T30" collapse a row of individually-tested cases; expand them so the
  // ids in between (e.g. T29) aren't silently dropped from coverage checking.
  for (const m of text.matchAll(/\bT(\d{1,3})\s*[–-]\s*T?(\d{1,3})\b/g)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    for (let n = from; n <= to; n++) ids.add(`T${n}`);
  }
  return ids;
}

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

function extractCovers(testFiles) {
  // id -> list of files that cover it
  const coveredBy = new Map();
  for (const file of testFiles) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/@covers\s+([^\n*]+)/g)) {
      const ids = m[1].split(/[\s,]+/).filter(Boolean);
      for (const id of ids) {
        if (!coveredBy.has(id)) coveredBy.set(id, []);
        coveredBy.get(id).push(file);
      }
    }
  }
  return coveredBy;
}

if (!existsSync(SPEC_FILE)) {
  console.error(`check-rules-covered: ${SPEC_FILE} fehlt.`);
  process.exit(1);
}

const specText = readFileSync(SPEC_FILE, "utf8");
const ruleIds = extractRuleIds(specText);
const testCaseIds = extractTestCaseIds(specText);
const knownIds = new Set([...ruleIds, ...testCaseIds]);

const testFiles = existsSync(TESTS_DIR) ? walk(TESTS_DIR) : [];
const coveredBy = extractCovers(testFiles);

let hasError = false;

const uncoveredRules = [...ruleIds].filter((id) => !coveredBy.has(id)).sort();
const uncoveredTestCases = [...testCaseIds].filter((id) => !coveredBy.has(id)).sort();
const unknownCovers = [...coveredBy.keys()].filter((id) => !knownIds.has(id)).sort();

console.log(`check-rules-covered: ${ruleIds.size} Regel-Ids, ${testCaseIds.size} Testfall-Ids in ${SPEC_FILE} gefunden.`);
console.log(`check-rules-covered: ${testFiles.length} Testdateien durchsucht, ${coveredBy.size} referenzierte Ids in @covers.`);

if (uncoveredRules.length > 0) {
  hasError = true;
  console.error(`\nRegel ohne Test (${uncoveredRules.length}):`);
  console.error(`  ${uncoveredRules.join(", ")}`);
}

if (uncoveredTestCases.length > 0) {
  hasError = true;
  console.error(`\nTestfall-Id ohne Test (${uncoveredTestCases.length}):`);
  console.error(`  ${uncoveredTestCases.join(", ")}`);
}

if (unknownCovers.length > 0) {
  hasError = true;
  console.error(`\n@covers auf unbekannte Id (${unknownCovers.length}):`);
  for (const id of unknownCovers) {
    console.error(`  ${id} in ${coveredBy.get(id).join(", ")}`);
  }
}

if (hasError) {
  console.error("\ncheck-rules-covered: nicht bestanden.");
  process.exit(1);
}

console.log("check-rules-covered: ok.");
