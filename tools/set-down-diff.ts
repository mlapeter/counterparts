/**
 * THE SET-DOWN DIFF, BY HAND (PG1, 2026-11-09; dev-only, never shipped): for
 * a reviewer checking "folded vs gone" on real pages. Reads two page texts
 * from files and prints every sentence gone word for word with its verdict
 * (`reworded` / `folded` kept; `named` / `unnamed` set down), the share of its
 * words found and the new sentence(s) it was matched to — exactly
 * `core/self/set-down.ts#diffSetDowns`, which the nightly door runs.
 *
 *   bun tools/set-down-diff.ts <before.md> <after.md> [named.json]
 *
 * `named.json`: what a writer named, `[{"line": "...", "why": "..."}]`.
 * Without it every set-down reads `unnamed` (the engine's floor), and a
 * line the writer would call folded reads as set down unless it is reworded
 * past `NEAR_SHARE`. Opens no store.
 */
import { readFileSync } from "node:fs";

import { diffSetDowns, type SetDownNamed } from "../src/core/self/set-down.js";
import { SET_DOWN_LIMITS } from "../src/core/self/tunables.js";

const [beforePath, afterPath, namedPath] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) {
  console.error("usage: bun tools/set-down-diff.ts <before.md> <after.md> [named.json]");
  process.exit(2);
}
const named = namedPath === undefined ? [] : (JSON.parse(readFileSync(namedPath, "utf8")) as SetDownNamed[]);
const diff = diffSetDowns(readFileSync(beforePath, "utf8"), readFileSync(afterPath, "utf8"), named);
console.log(`limits: near ${String(SET_DOWN_LIMITS.NEAR_SHARE)} over ${String(SET_DOWN_LIMITS.NEAR_WINDOW)} sentences, fold ${String(SET_DOWN_LIMITS.FOLD_SHARE)} over ${String(SET_DOWN_LIMITS.FOLD_WINDOW)}`);
for (const v of diff.verdicts) {
  console.log(`\n[${v.outcome}] ${v.share.toFixed(2)} ${v.section.length === 0 ? "" : `(${v.section}) `}${v.line}`);
  if (v.outcome === "named" || v.outcome === "folded") console.log(`  why: ${v.why}`);
  if (v.match !== null) console.log(`  best match: ${v.match}`);
}
if (diff.unmatchedNamed.length > 0) console.log(`\nnamed but not gone: ${diff.unmatchedNamed.map((n) => n.line).join(" | ")}`);
