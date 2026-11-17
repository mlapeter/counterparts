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
 * has no cycles today (a cycle cannot be split this way, and one that blocks
 * a split is named in the refusal; the largest single module is ~180 KB), and
 * the choice is the metafile's, tie broken by path, so the same sources make
 * the same files.
 *
 * CHUNK NAMES FROM MEMBERSHIP. Bun names a chunk by a hash of its content;
 * each is renamed `chunk-<hash of its sorted module paths>.js`
 * (`chunkName`), so an edit inside a module leaves every name alone and a
 * release's diff on the directory's branch shows the files that changed.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
            const rel = posix.relative(repo.split("\\").join("/"), args.path.split("\\").join("/"));
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

/**
 * The largest set of modules in `inside` that import each other round in a
 * cycle (a strongly connected component of more than one), sorted, or null.
 * Splitting cannot cut a cycle: every module in one reaches all the others.
 * Pure.
 */
export function cycleIn(inside: readonly string[], imports: Readonly<Record<string, readonly string[]>>): string[] | null {
  const within = new Set(inside);
  let best: string[] | null = null;
  const reach = new Map(inside.map((m) => [m, closure(m, imports)] as const));
  const seen = new Set<string>();
  for (const m of [...inside].sort()) {
    if (seen.has(m)) continue;
    const scc = inside.filter((x) => reach.get(m)!.has(x) && reach.get(x)!.has(m) && within.has(x)).sort();
    for (const x of scc) seen.add(x);
    if (scc.length > 1 && (best === null || scc.length > best.length)) best = scc;
  }
  return best;
}

/** What to say of an output over `TARGET` that will not split. Pure. */
function unsplittable(out: string, bytes: number, inside: readonly string[], imports: Readonly<Record<string, readonly string[]>>): string {
  const cycle = cycleIn(inside, imports);
  return cycle === null
    ? `${out} is ${bytes} bytes and no module in it splits it`
    : `${out} is ${bytes} bytes and its modules import each other in a cycle, which splitting cannot cut: ${cycle.join(", ")}`;
}

/**
 * A chunk's name from the modules it holds, not their bytes: `chunk-` and the
 * first 8 hex of the SHA-256 of its sorted module paths. Bun names a chunk by
 * its content, so one changed constant renamed most of them (55 of 71,
 * 2026-11-17) and every release's diff was near-total for a reviewer of the
 * directory's branch; this way a name changes only when what is in it does.
 * Pure.
 */
export function chunkName(modules: readonly string[]): string {
  const h = new Bun.CryptoHasher("sha256").update([...modules].sort().join("\n")).digest("hex").slice(0, 8);
  return `${CHUNK_DIR}/chunk-${h}.js`;
}

/**
 * Every chunk renamed by `chunkName`, and every import of one rewritten to
 * match. Bun's names are `chunk-` and 8 base-36 characters, unique strings
 * in the output, so each is replaced wherever it stands. Pure.
 */
export function renameChunks(outputs: Readonly<Record<string, string>>, membership: Readonly<Record<string, readonly string[]>>, problems: string[]): Record<string, string> {
  const rename = new Map<string, string>();
  for (const path of Object.keys(outputs)) {
    if (!path.startsWith(`${CHUNK_DIR}/`)) continue;
    const modules = membership[path];
    if (modules === undefined) {
      problems.push(`${path}: the metafile names no modules for it`);
      continue;
    }
    // A chunk of no module holds Bun's own helpers (`__export`, `__require`):
    // named by those bytes, which change only with the Bun version, less any
    // other chunk's name it imports (Bun's, which follow content).
    const own = outputs[path]!.replace(/chunk-[0-9a-z]{8}\.js/g, "chunk.js");
    rename.set(path, chunkName(modules.length > 0 ? modules : [`bun-runtime:${own}`]));
  }
  const names = [...rename.values()];
  if (new Set(names).size !== names.length) problems.push("two chunks would take one name");
  // Through placeholders, so a new name that happens to be another chunk's old
  // one is never renamed twice.
  const pairs = [...rename].map(([from, to], i) => [posix.basename(from), `\u0000chunk${i}\u0000`, posix.basename(to)] as const);
  const out: Record<string, string> = {};
  for (const [path, js] of Object.entries(outputs)) {
    let text = js;
    for (const [from, hold] of pairs) text = text.split(from).join(hold);
    for (const [, hold, to] of pairs) text = text.split(hold).join(to);
    out[rename.get(path) ?? path] = text;
  }
  return out;
}

export async function bundle(req: BundleRequest): Promise<BundleResult> {
  const problems: string[] = [];
  // The real path: a repository reached through a symlink would name its
  // sources one way to the bundler and another way in the metafile.
  const repo = realpathSync(req.repo);
  const entries = new Set(req.entries);
  for (let round = 0; ; round++) {
    const built = await buildOnce(repo, [...entries].sort(), problems);
    if (built === null) return { outputs: {}, inputs: [], entries: [...entries].sort(), problems };
    const imports = staticImports(repo, built.meta);
    const promote: string[] = [];
    const stuck: string[] = [];
    const over: [string, Meta["outputs"][string]][] = Object.entries(built.meta.outputs)
      .filter(([, o]) => o.bytes > TARGET)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [out, o] of over) {
      const sizes = Object.fromEntries(Object.entries(o.inputs).map(([m, v]) => [m, v.bytesInOutput]));
      const m = splitPoint(sizes, imports);
      if (m !== null && !entries.has(m)) promote.push(m);
      else if (Object.keys(sizes).length > 1) stuck.push(unsplittable(out, o.bytes, Object.keys(sizes), imports));
    }
    if (promote.length === 0 || round >= MAX_ROUNDS) {
      problems.push(...stuck);
      if (promote.length > 0) {
        problems.push(`still chunks over ${TARGET} bytes after ${MAX_ROUNDS} rounds`);
        for (const [out, o] of over) problems.push(unsplittable(out, o.bytes, Object.keys(o.inputs), imports));
      }
      const membership: Record<string, string[]> = {};
      for (const [k, o] of Object.entries(built.meta.outputs)) membership[posix.normalize(k.replace(/^\.\//, ""))] = Object.keys(o.inputs);
      const outputs: Record<string, string> = {};
      for (const [path, js] of Object.entries(renameChunks(built.outputs, membership, problems))) {
        const out = resolveMarks(path, js);
        if (out.includes(MARK)) problems.push(`${path} still holds a module-URL mark the build did not resolve`);
        outputs[path] = out;
      }
      for (const e of entries) if (outputs[e.replace(/\.ts$/, ".js")] === undefined) problems.push(`the entry ${e} came out at no ${e.replace(/\.ts$/, ".js")}`);
      // A bundled module the marks do not cover (a `.js` the server shares with
      // the browser, `dashboard/web/shared/dates.js`) must not read its own URL.
      for (const i of Object.keys(built.meta.inputs)) {
        if (!/\.ts$/.test(i) && /\bimport\.meta\b/.test(readFileSync(join(repo, i), "utf8"))) {
          problems.push(`${i} reads import.meta, and only .ts sources keep their own URL in the bundle`);
        }
      }
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
