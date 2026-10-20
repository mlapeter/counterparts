/**
 * The harness (`tools/harness/`) is a host built on the PUBLIC seams only: the
 * files the package's `exports` map points at. Pinned here so the harness
 * keeps proving those seams are enough to be a host, and so it never grows a
 * reach into the core's internals that a real second host could not have.
 * (It stays out of the package: `files` publishes `src/` and only
 * `tools/install-loop/`.)
 */
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const HARNESS = join(REPO, "tools", "harness");

function exportTargets(): Set<string> {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { exports: Record<string, string> };
  return new Set(Object.values(pkg.exports).map((p) => resolve(REPO, p)));
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

test("the harness imports only the package's public seams from src/", () => {
  const allowed = exportTargets();
  const files = readdirSync(HARNESS).filter((f) => f.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);
  const offending: string[] = [];
  for (const f of files) {
    for (const spec of importsOf(join(HARNESS, f))) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(join(HARNESS, f)), spec).replace(/\.js$/, ".ts");
      if (!relative(REPO, target).startsWith("src/")) continue;
      if (!allowed.has(target)) offending.push(`${f} → ${relative(REPO, target)}`);
    }
  }
  expect(offending).toEqual([]);
});

test("the harness is not in the published package", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { files?: string[] };
  const files = pkg.files ?? [];
  expect(files.some((f) => f === "tools" || f.startsWith("tools/harness"))).toBe(false);
});
