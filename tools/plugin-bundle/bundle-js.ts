/**
 * THE DIRECTORY FLAVOR'S JAVASCRIPT, BUNDLED (2026-11-17, for file room).
 *
 * The directory flavor used to carry every server-side source transpiled one
 * for one (~360 files of a 512 limit). This bundles them instead, with
 * `Bun.build`, into the entries plus a few dozen shared chunks, each under
 * the directory's 256 KiB review line. `build.ts` runs this file as a child
 * process (`bundleDirectoryJs`), because `Bun.build` is asynchronous and the
 * plan is not:
 *
 *   bun tools/plugin-bundle/bundle-js.ts <request.json> <result.json>
 *
 * request: `{ repo, entries, maxBytes }` — `entries` repository-relative `.ts`
 * paths; result: `{ outputs: {path: text}, inputs: [...], entries: [...],
 * problems: [...] }`, every path repository-relative.
 *
 * WHERE THINGS LAND. Every entry, and every module promoted to one (below),
 * is written at its source's own path as `.js` (`src/x/y.ts` → `src/x/y.js`),
 * the path the transpiled tree had, so the commands Claude Code runs and the
 * scripts a process spawns are where they always were. Shared code lands in
 * `CHUNK_DIR`.
 *
 * `import.meta.url` STAYS EACH MODULE'S OWN. Bundled, every module in a file
 * would share that file's URL, and the code reads its own URL to find what
 * sits beside it: the scripts it spawns (`runtime.ts#entryScript`), the empty
 * bunfig, the package root (`packagePath`, `PACKAGE_ROOT`, `runningBuild`),
 * whether it is the transpiled tree (`MODULE_EXT`), whether it is the main
 * script (`isEntryPoint`). So, before bundling, each module's
 * `import.meta.url` becomes `MARK("<its path as .js>")`, and after, each mark
 * becomes `new URL("<that path, relative to the file it landed in>",
 * import.meta.url).href`: the URL the module had in the transpiled tree,
 * whatever file now holds it. Any other `import.meta` property is refused (no
 * source uses one; each would need the same treatment).
 *
 * CHUNKS UNDER THE LINE. Bun splits shared code by which entries reach it and
 * has no size cap, so the biggest shared chunk came out at 1.3 MB. A module
 * made an entry of its own splits the chunk it sat in: what it reaches from
 * there gets a chunk of its own. So: build, and for every output over
 * `TARGET` with more than one module, promote the module whose reach within it
 * comes closest to half; build again; until none is over. The import graph
 * has no cycles today (a cycle cannot be split this way; the largest single
 * module is ~180 KB), and the choice is the metafile's, tie broken by path, so
 * the same sources make the same files.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

/** Where the shared chunks land, from the plugin root. */
export const CHUNK_DIR = "src/chunks";

/** What a module's `import.meta.url` becomes before bundling. An unbound
 *  global's call: the bundler keeps it, and a survivor is refused. */
export const MARK = "__COUNTERPARTS_MODULE_URL__";

/** The size an output with more than one module is split under. The
 *  directory's line, 256 KiB, is the plan's to refuse; the 16 KiB between
 *  covers what is added after the metafile measures (the marks resolved, the
 *  entries' shebang, escaped invisible characters). A single module is never
 *  split (the largest, 2026-11-17, is ~180 KB). */
export const TARGET = 240 * 1024;

/** Rounds of splitting before giving up (2026-11-17: five). */
const MAX_ROUNDS = 32;

export interface BundleRequest {
  readonly repo: string;
  readonly entries: readonly string[];
}

export interface BundleResult {
  /** Bundle path → JavaScript, marks resolved. */
  readonly outputs: Record<string, string>;
  /** The sources the bundle holds, repository-relative. */
  readonly inputs: string[];
  /** The entries it was built with, the given ones and those it promoted, sorted. */
  readonly entries: string[];
  readonly problems: string[];
}

/** A module's source with `import.meta.url` as its mark. Pure. */
export function markModuleUrl(rel: string, text: string): { text: string; problems: string[] } {
  const problems: string[] = [];
  for (const m of text.matchAll(/\bimport\.meta\.(\w+)/g)) {
    if (m[1] !== "url") problems.push(`${rel} reads import.meta.${m[1]}, which the bundle does not keep per module`);
  }
  const js = rel.replace(/\.ts$/, ".js");
  return { text: text.replace(/\bimport\.meta\.url\b/g, `${MARK}(${JSON.stringify(js)})`), problems };
}

/** One output's marks as URLs from that output's own. Pure. */
export function resolveMarks(outPath: string, js: string): string {
  return js.replace(new RegExp(`${MARK}\\((["'])([^"']+)\\1\\)`, "g"), (_m, _q: string, target: string) => {
    let rel = posix.relative(posix.dirname(outPath), target);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `new URL(${JSON.stringify(rel)}, import.meta.url).href`;
  });
}

interface Meta {
  inputs: Record<string, { bytes: number; imports: { path: string; kind: string; original?: string; external?: boolean }[] }>;
  outputs: Record<string, { bytes: number; entryPoint?: string; inputs: Record<string, { bytesInOutput: number }> }>;
}

/**
 * Each bundled module's static imports, as the bundled modules they name.
 * Bun's metafile (1.3.10) writes an import's path three ways — absolute, the
 * specifier as written, or the specifier as written marked `external` though
 * it was bundled — so every relative or absolute one is resolved here, the
 * NodeNext way (`./x.js` → `./x.ts`), and kept when it is a bundled module.
 */
export function staticImports(repo: string, meta: Meta): Record<string, string[]> {
  const bundled = new Set(Object.keys(meta.inputs));
  const out: Record<string, string[]> = {};
  for (const [m, v] of Object.entries(meta.inputs)) {
    const to = new Set<string>();
    for (const i of v.imports) {
      if (i.kind !== "import-statement") continue;
      const spec = i.path.startsWith("/") ? i.path : (i.original ?? i.path);
      let rel: string;
      if (spec.startsWith("/")) rel = posix.relative(repo.split("\\").join("/"), spec);
      else if (spec.startsWith(".")) rel = posix.normalize(posix.join(posix.dirname(m), spec));
      else continue;
      for (const c of [rel, rel.replace(/\.js$/, ".ts"), rel.replace(/\.js$/, ".tsx")]) {
        if (bundled.has(c)) {
          to.add(c);
          break;
        }
      }
    }
    out[m] = [...to].sort();
  }
  return out;
}

/** What a module reaches through static imports, itself included. Pure. */
function closure(m: string, imports: Readonly<Record<string, readonly string[]>>): Set<string> {
  const seen = new Set<string>([m]);
  const queue = [m];
  while (queue.length > 0) {
    for (const next of imports[queue.shift()!] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * The module to promote to an entry so `output` (module → bytes) splits:
 * the one whose reach within it comes closest to half; ties by path. Null when
 * none splits it (one module, or one module reaching all the rest). Pure.
 */
export function splitPoint(output: Readonly<Record<string, number>>, imports: Readonly<Record<string, readonly string[]>>): string | null {
  const inside = Object.keys(output).sort();
  const total = inside.reduce((n, m) => n + output[m]!, 0);
  let best: string | null = null;
  let bestEven = 0;
  for (const m of inside) {
    const seen = closure(m, imports);
    const reached = inside.filter((x) => seen.has(x)).reduce((n, x) => n + output[x]!, 0);
    const even = Math.min(reached, total - reached);
    if (even > bestEven) [best, bestEven] = [m, even];
  }
  return best;
}

async function buildOnce(repo: string, entries: readonly string[], problems: string[]): Promise<{ outputs: Record<string, string>; meta: Meta } | null> {
  const seenProblems = new Set<string>();
  const r = await Bun.build({
    entrypoints: entries.map((e) => join(repo, e)),
    root: repo,
    target: "bun",
    format: "esm",
    splitting: true,
    minify: false,
    sourcemap: "none",
    metafile: true,
    naming: { entry: "[dir]/[name].[ext]", chunk: `${CHUNK_DIR}/chunk-[hash].[ext]`, asset: `${CHUNK_DIR}/[name]-[hash].[ext]` },
    plugins: [
      {
        name: "module-url",
        setup(b) {
          b.onLoad({ filter: /\.ts$/ }, (args) => {
            const rel = posix.relative(repo, args.path.split("\\").join("/"));
            const marked = markModuleUrl(rel, readFileSync(args.path, "utf8"));
            for (const p of marked.problems) {
              if (seenProblems.has(p)) continue;
              seenProblems.add(p);
              problems.push(p);
            }
            return { contents: marked.text, loader: "ts" };
          });
        },
      },
    ],
  } as Parameters<typeof Bun.build>[0] & { metafile: boolean });
  if (!r.success) {
    problems.push(...r.logs.map((l) => `Bun.build: ${String(l)}`));
    return null;
  }
  const outputs: Record<string, string> = {};
  for (const o of r.outputs) {
    const rel = posix.normalize(o.path.replace(/^\.\//, ""));
    outputs[rel] = await o.text();
  }
  return { outputs, meta: (r as unknown as { metafile: Meta }).metafile };
}

export async function bundle(req: BundleRequest): Promise<BundleResult> {
  const problems: string[] = [];
  const entries = new Set(req.entries);
  for (let round = 0; ; round++) {
    const built = await buildOnce(req.repo, [...entries].sort(), problems);
    if (built === null) return { outputs: {}, inputs: [], entries: [...entries].sort(), problems };
    const imports = staticImports(req.repo, built.meta);
    const promote: string[] = [];
    for (const [out, o] of Object.entries(built.meta.outputs).sort(([a], [b]) => a.localeCompare(b))) {
      if (o.bytes <= TARGET) continue;
      const sizes = Object.fromEntries(Object.entries(o.inputs).map(([m, v]) => [m, v.bytesInOutput]));
      const m = splitPoint(sizes, imports);
      if (m !== null && !entries.has(m)) promote.push(m);
      else if (Object.keys(sizes).length > 1) problems.push(`${out} is ${o.bytes} bytes and no module in it splits it`);
    }
    if (promote.length === 0 || round >= MAX_ROUNDS) {
      if (promote.length > 0) problems.push(`still chunks over ${TARGET} bytes after ${MAX_ROUNDS} rounds`);
      const outputs: Record<string, string> = {};
      for (const [path, js] of Object.entries(built.outputs)) {
        const out = resolveMarks(path, js);
        if (out.includes(MARK)) problems.push(`${path} still holds a module-URL mark the build did not resolve`);
        outputs[path] = out;
      }
      for (const e of entries) if (outputs[e.replace(/\.ts$/, ".js")] === undefined) problems.push(`the entry ${e} came out at no ${e.replace(/\.ts$/, ".js")}`);
      return { outputs, inputs: Object.keys(built.meta.inputs).sort(), entries: [...entries].sort(), problems };
    }
    for (const m of promote) entries.add(m);
  }
}

if (import.meta.main) {
  const [reqPath, outPath] = process.argv.slice(2);
  if (reqPath === undefined || outPath === undefined) {
    console.error("usage: bun tools/plugin-bundle/bundle-js.ts <request.json> <result.json>");
    process.exit(2);
  }
  const result = await bundle(JSON.parse(readFileSync(reqPath, "utf8")) as BundleRequest);
  writeFileSync(outPath, JSON.stringify(result));
}

/** Run `bundle` in a child Bun (the plan is synchronous), through a temporary folder. */
export function bundleSync(req: BundleRequest, bun: string = process.execPath): BundleResult {
  const tmp = mkdtempSync(join(tmpdir(), "counterparts-bundle-js-"));
  try {
    const reqPath = join(tmp, "request.json");
    const outPath = join(tmp, "result.json");
    writeFileSync(reqPath, JSON.stringify(req));
    const r = Bun.spawnSync([bun, join(import.meta.dir, "bundle-js.ts"), reqPath, outPath], { cwd: req.repo, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) {
      return { outputs: {}, inputs: [], entries: [...req.entries], problems: [`bundle-js.ts failed (${r.exitCode}): ${r.stderr.toString().trim().slice(0, 2000)}`] };
    }
    return JSON.parse(readFileSync(outPath, "utf8")) as BundleResult;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
