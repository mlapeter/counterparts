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

import type { UpdateNoticeDoors, deliverTurn as DeliverTurn } from "../src/adapters/claude-code/index.js";
import type { PlainReminder } from "../src/core/counterpart.js";

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

/**
 * THE TWO SEAMS A SECOND HOST WAS STILL MISSING (2026-10-22, lane L; closed in
 * `src/adapters/claude-code/INTERFACE-GAPS.md` §19): what a hook prints and
 * claims on a turn (`deliverTurn`, with `hostDelivery` and its doors), and the
 * recall ids a turn's transcript expands (`expansionIdsOf`) — through the
 * package's `./claude-code` export, the door a host outside this repo has.
 */
test("deliverTurn and expansionIdsOf are public seams, through the package's own export", async () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { exports: Record<string, string> };
  const door = pkg.exports["./claude-code"];
  expect(door).toBeDefined();
  const m = (await import(resolve(REPO, door as string))) as Record<string, unknown>;
  for (const name of ["deliverTurn", "hostDelivery", "expansionIdsOf"]) expect(typeof m[name]).toBe("function");
  const expansionIdsOf = m["expansionIdsOf"] as (input: unknown) => string[];
  expect(expansionIdsOf({ handle: "h1", ids: ["mem_a", 7, "mem_b"] })).toEqual(["h1", "mem_a", "mem_b"]);
  expect(expansionIdsOf(null)).toEqual([]);
  // A turn delivered through it: a plain reminder is shown only once claimed, and the claim is made.
  const deliverTurn = m["deliverTurn"] as typeof DeliverTurn;
  const claimed: PlainReminder[][] = [];
  const doors: UpdateNoticeDoors = {
    updateNotice: () => null,
    markUpdateNotice: () => false,
    claimPlain: (_i, due) => {
      claimed.push([...due]);
      return due;
    },
  };
  const due: PlainReminder = { memoryId: "mem_r", windowKey: "w", eventDate: "2026-10-22", precision: "day", beat: "day", firstDay: "2026-10-22", lastDay: "2026-10-22", what: "call the plumber" };
  const d = deliverTurn("user-prompt-submit", { injection: "the recall", ask: null, plain: [due] }, {}, null, doors, { sessionId: "s", scope: "/x" });
  expect(claimed).toHaveLength(1);
  expect(d.dropped).toBeNull();
  const out = JSON.parse(d.stdout) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
  expect(out.hookSpecificOutput.additionalContext).toContain("the recall");
  expect(out.systemMessage).toContain("call the plumber");
});

test("the public entry never imports the hook's entry script", () => {
  // `bin/hook.ts` does work at load (its config path, its sibling scripts) and
  // imports the public entry itself; the seams live in `envelope.ts` for that.
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of importsOf(file)) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec).replace(/\.js$/, ".ts");
      if (target.endsWith(".ts")) walk(target);
    }
  };
  walk(join(REPO, "src", "adapters", "claude-code", "index.ts"));
  expect([...seen].filter((f) => relative(REPO, f).includes("/bin/")).map((f) => relative(REPO, f))).toEqual([]);
});

test("the harness is not in the published package", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { files?: string[] };
  const files = pkg.files ?? [];
  expect(files.some((f) => f === "tools" || f.startsWith("tools/harness"))).toBe(false);
});
