/**
 * The harness (`tools/harness/`) is a host built on the PUBLIC seams only: the
 * files the package's `exports` map points at. Pinned here so the harness
 * keeps proving those seams are enough to be a host, and so it never grows a
 * reach into the core's internals that a real second host could not have.
 * (It stays out of the package: `files` publishes `src/` and only
 * `tools/install-loop/`.)
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const HARNESS = join(REPO, "tools", "harness");

function exportTargets(): Set<string> {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { exports: Record<string, string> };
  return new Set(Object.values(pkg.exports).map((p) => resolve(REPO, p)));
}

/**
 * Every module specifier in a file: `from "x"` (import, import type, export …
 * from, over any number of lines), a bare `import "x"`, `import("x")` and
 * `require("x")`. Wide on purpose: a string that merely looks like one is
 * checked too, and a false alarm costs a rename, a miss costs the pin.
 */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*["']([^"']+)["']/g)) out.push(m[1]!);
  return out;
}

/** A computed specifier cannot be pinned: refused outright. */
function computedImports(file: string): number {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/\b(?:import|require)\s*\(\s*(?!["'][^"']*["']\s*\))[^)]/g)].length;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|mts|js|mjs|cjs)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/**
 * THE ONE EXCEPTION (2026-10-21): `settings.ts` sets a module's tunables for a
 * run (`harness compare --set`). That is the experimenter's hand on the rules,
 * not the host's reach, so it alone may import the tunables, and only those.
 */
const SETTINGS = join(HARNESS, "settings.ts");
const TUNABLES_FILE = /^src\/core\/(?:[a-z]+\/tunables|physics\/index)\.ts$/;

test("the harness imports only the package's public seams from src/", () => {
  const allowed = exportTargets();
  const files = sources(HARNESS);
  expect(files.length).toBeGreaterThan(0);
  const offending: string[] = [];
  for (const f of files) {
    if (computedImports(f) > 0) offending.push(`${relative(REPO, f)}: a computed import`);
    for (const spec of importsOf(f)) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(f), spec).replace(/\.js$/, ".ts");
      if (!relative(REPO, target).startsWith("src/")) continue;
      if (f === SETTINGS && TUNABLES_FILE.test(relative(REPO, target))) continue;
      if (!allowed.has(target)) offending.push(`${relative(REPO, f)} → ${relative(REPO, target)}`);
    }
  }
  expect(offending).toEqual([]);
});

test("the specifier scan catches the forms it claims to", () => {
  const dir = mkdtempSync(join(tmpdir(), "counterparts-imports-probe-"));
  const probe = join(dir, "probe.ts");
  const text = [
    'import { a } from "./one.js";',
    "import type {",
    "  B,",
    '} from "./two.js";',
    'export * from "./three.js";',
    'import "./four.js";',
    'const x = 1; import("./five.js");',
    'require("./six.js");',
    "import(`./${name}.js`);",
  ].join("\n");
  writeFileSync(probe, text);
  try {
    expect(importsOf(probe)).toEqual(["./one.js", "./two.js", "./three.js", "./four.js", "./five.js", "./six.js"]);
    expect(computedImports(probe)).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the harness is not in the published package", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { files?: string[] };
  const files = pkg.files ?? [];
  expect(files.some((f) => f === "tools" || f.startsWith("tools/harness"))).toBe(false);
});
