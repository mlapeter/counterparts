/**
 * BUILD THE PLUGIN BUNDLE — the Claude Code plugin as a folder of its own, for
 * a repository whose root is the plugin (planned: counterparts-ai/counterparts-plugin)
 * and for Anthropic's plugin directory.
 *
 *   ~/.bun/bin/bun tools/plugin-bundle/build.ts [--flavor full|directory|core|sidebar] <out-dir>     write the bundle
 *   ~/.bun/bin/bun tools/plugin-bundle/build.ts [--flavor full|directory|core|sidebar] --list        print the file set, write nothing
 *   ~/.bun/bin/bun tools/plugin-bundle/build.ts [--flavor full|directory|core|sidebar] --check <dir> rebuild and compare with <dir>
 *
 * Why a bundle: the directory reads the plugin folder, and today that folder is
 * this whole repository (tests, docs, dev tools: 800+ files against a limit of
 * 512, and this repository's own package.json and bun.lock). People who install
 * a plugin get only its folder, so the bundle has to hold everything the plugin
 * runs and nothing else.
 *
 * TWO FLAVORS, one file set (2026-10-14):
 *
 *   - `full` (the default): the TypeScript sources as they are, started through
 *     `src/adapters/plugin-run.sh`, which finds Bun or Node or downloads the
 *     single binary. What our own marketplace installs.
 *   - `directory`: the same sources TRANSPILED one for one (`src/x.ts` →
 *     `src/x.js`, types and comments stripped by Bun's transpiler, same tree),
 *     because the directory's validator times out on ~7 MB of commented
 *     TypeScript. No launcher, no binary: Claude Code runs the three entries
 *     (hook, server, console) BY THEIR OWN PATH, each starting with
 *     `DIRECTORY_SHEBANG` and written executable — the validator holds a
 *     manifest whose command is `bun`, a package manager to it, and passes one
 *     that names the entry file. Requires Bun 1.3+ on the PATH Claude Code
 *     starts with. The code knows which tree it runs in from its own URL
 *     (`src/adapters/runtime.ts#entryScript`).
 *
 * TWO PLUGINS, for our own marketplace (2026-10-20, the split; lightly held):
 *
 *   - `core`: the `full` flavor less the sidebar — memory alone (hooks, MCP
 *     server, commands), still named `counterparts`, so every install of it
 *     keeps its name. hooks.json is generated without `modules`, plugin.json
 *     without `types`, and nothing under `hooks/sidebar/` ships.
 *   - `sidebar`: the mod as a plugin of its own, `counterparts-sidebar`
 *     (`SIDEBAR_PLUGIN`), rooted at `hooks/sidebar/` (its `art/fox` and
 *     `types/` sit where the dev folder already has them), with plugin.json
 *     `dependencies` naming `counterparts`, so installing it installs memory
 *     too. No MCP server, no command hooks, no commands, nothing to install:
 *     it can never offer a memory tool, so beside an npm install only core's
 *     stand-down matters. The engine lets only a value's owner write it, so
 *     every `$.state` key the sources write as `{ plugin: 'counterparts' }`
 *     is written out under `counterparts-sidebar` (`sidebarText`); the
 *     sources keep `counterparts`, so the repository root as a plugin (the
 *     dev rig, `claude --plugin-dir`) and the `full`/`directory` flavors run
 *     the sidebar as before.
 *
 * Each writes one plugin at the root of its folder, like the two flavors
 * above: core for `counterparts-ai/counterparts-plugin`, the sidebar for a
 * repository of its own (docs/plugin.md, "Two plugins").
 *
 * THE FILE SET IS TRACED, NOT LISTED. The roots are what Claude Code reads:
 * `.claude-plugin/plugin.json` (the MCP server's command, the mod's `types`),
 * `hooks/hooks.json` (the five hooks' command, the sidebar mod's `modules`)
 * and `commands/*.md`. Every `${CLAUDE_PLUGIN_ROOT}/<path>` they name is
 * followed: into the launcher (`plugin-run.sh`, whose `$here/<path>` names the
 * three entries — hook.mjs, serve.mjs, counterparts.mjs — and the empty
 * bunfig), and from each module through every import (TypeScript's own
 * pre-processor: static, type-only and string-literal dynamic imports), every
 * `new URL("./x", import.meta.url)` (the scripts a process spawns: runner,
 * nightly, the night run's server) and every `packagePath("…")` (files read
 * from the install). The dashboard's page is followed the way a browser would:
 * from `app.html` through `src`/`href`, module imports and CSS `url()`, plus
 * the licence texts that sit beside a vendored file or font. The directory
 * flavor's roots name the `.js` entries, traced from their `.ts` sources.
 *
 * GENERATED, not copied: `.claude-plugin/plugin.json` (this repository's, with
 * `version` = package.json's and the directory listing fields), a minimal
 * `package.json` and npm `package-lock.json` naming only the embedding table (Claude Code
 * installs that at plugin install: docs/plugin.md), and README.md
 * (tools/plugin-bundle/bundle-readme.md, its blocks for the flavor). The
 * directory flavor also generates `hooks/hooks.json`, `commands/*.md` (each
 * launcher line as the entry's own path) and every transpiled `.js`.
 *
 * It refuses, rather than writes, a bundle that breaks a directory rule it can
 * check here: a symlink, a test or module doc, a macOS/Windows system file, a
 * file over 5 MiB, more than 512 files, or versions that disagree; for the
 * directory flavor also any file over 256 KiB (2026-10-14: three.js, the one
 * there was, is left out with the dashboard's brain picture), a launcher left
 * in a root it generated, and a tree that does not mirror the sources one for
 * one.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, posix, relative, resolve, sep } from "node:path";
import ts from "typescript";

export const REPO = resolve(import.meta.dir, "../..");
const HERE = import.meta.dir;

/** The bundles one file set makes (header): the one plugin in two flavors,
 *  and the two plugins of the split. */
export const FLAVORS = ["full", "directory", "core", "sidebar"] as const;
export type Flavor = (typeof FLAVORS)[number];

/** The sidebar as a plugin of its own (header, "TWO PLUGINS"). Never rename
 *  `counterparts` itself: every install of it would break. */
export const CORE_PLUGIN = "counterparts";
export const SIDEBAR_PLUGIN = "counterparts-sidebar";
/** Where the sidebar's sources are, and so its plugin's root. */
export const SIDEBAR_DIR = "hooks/sidebar";
/**
 * The first release whose `counterparts` is memory alone. Every earlier one
 * draws the sidebar itself, so the sidebar plugin's dependency asks for this
 * or later: beside an older `counterparts` the install is refused, with
 * Claude Code's own "run `claude plugin update counterparts@counterparts`",
 * instead of drawing two panes (measured, tools/plugin-loop/split.sh 4b). If
 * the split misses this release, raise it to the one it ships in: `build.ts
 * --flavor full` refuses at this version or later (a tripwire, so a release
 * cut without the split raises it first), and test/plugin.test.ts wants the
 * marketplace's sidebar entry exactly from this version on.
 */
export const FIRST_SPLIT_RELEASE = "0.3.32";

/** The `full` flavor at the split's release or later: the refusal, else null. Pure. */
export function splitTripwire(version: string, flavor: Flavor): string | null {
  if (flavor !== "full" || !versionAtLeast(version, FIRST_SPLIT_RELEASE)) return null;
  return (
    `${version} is the split release or later (FIRST_SPLIT_RELEASE ${FIRST_SPLIT_RELEASE}): our marketplace takes --flavor core and --flavor sidebar now. ` +
    "Cutting this release without the split? Raise FIRST_SPLIT_RELEASE first (docs/RELEASING.md)."
  );
}

/** Whether the directory's MAX_FILES binds a flavor's build. From the split on,
 *  full ships nowhere (only split.sh builds it, as the one plugin it upgrades
 *  from), so the limit is core's and the directory flavor's. Pure. */
export function fileLimitApplies(flavor: Flavor, version: string): boolean {
  return !(flavor === "full" && versionAtLeast(version, FIRST_SPLIT_RELEASE));
}

/** a >= b, for x.y.z versions. Pure. */
export function versionAtLeast(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split(/[.-]/).slice(0, 3).map(Number)) as [number[], number[]];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return true;
}
/**
 * The sidebar plugin's `dependencies`: core, from the same marketplace, at
 * the split or later. A range resolves against `counterparts--v<version>` tags
 * on core's repository (code.claude.com/docs/en/plugins/dependencies), so each
 * release tags core's commit that way too, beside `v<version>`: without one
 * the sidebar does not install ("has no git tag satisfying"). Lightly held:
 * a bare `"counterparts"` needs no such tag, and then an older counterparts
 * meets it and both draw a pane (docs/plugin.md, "Two plugins").
 */
export const SIDEBAR_DEPENDENCIES: readonly (string | { name: string; version: string })[] = [
  { name: CORE_PLUGIN, version: `>=${FIRST_SPLIT_RELEASE}` },
];
/** hooks.json's description for core, which carries no module. */
export const CORE_HOOKS_DESCRIPTION =
  "Counterparts: memory hooks on five Claude Code events (session start, each prompt, each reply, session end, before compaction), started from the plugin folder. The sidebar is the counterparts-sidebar plugin.";

/** The plugin directory's limits (claude.com/docs/plugins/pre-submission-checklist). */
export const MAX_FILES = 512;
/** Where the directory flavor warns: the last validated test counted 505. */
export const WARN_FILES = 490;
export const MAX_INSPECTED_BYTES = 256 * 1024; // larger, not an image or font: held for a reviewer
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // larger: validation stops


/** The only package the bundle installs: the embedding table, ~30 MB, too big to ship. */
export const MODEL_PACKAGE = "counterparts-model-potion";

/** The listing icon: this repository's `.claude-plugin/icon.png`, at the
 *  bundle's root (manifest paths are from the plugin root). */
export const ICON_SOURCE = ".claude-plugin/icon.png";
export const ICON_PATH = "icon.png";

/** Directory listing fields and keywords the generated manifest adds
 *  (code.claude.com/docs/en/plugins/manifest-reference#directory-listing-fields).
 *  privacyPolicyUrl is a PLACEHOLDER until counterparts.ai/privacy exists. */
export const LISTING = {
  icon: `./${ICON_PATH}`,
  documentationUrl: "https://github.com/mlapeter/counterparts#readme",
  supportUrl: "https://github.com/mlapeter/counterparts/issues",
  privacyPolicyUrl: "https://counterparts.ai/privacy",
} as const;
export const EXTRA_KEYWORDS = ["long-term memory", "recall", "context", "local", "sidebar", "sessions", "privacy"] as const;

/** The full flavor's launcher, as plugin.json, hooks.json and the commands name it. */
export const LAUNCHER = "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh";

/** The directory flavor's entries, by the launcher's mode: what Claude Code
 *  runs by path in place of `sh plugin-run.sh <mode>`. */
export const DIRECTORY_ENTRIES = {
  hook: "src/adapters/claude-code/bin/hook.js",
  mcp: "src/adapters/mcp/bin/serve.js",
  cli: "src/adapters/cli/bin/counterparts.js",
} as const;

/** The directory flavor's entries' first line. Bun from PATH; `--no-env-file`
 *  and `--config=/dev/null` keep the project's `.env` and `bunfig.toml`
 *  (whose `preload` would run inside us) out, and `--no-install` stands for
 *  the empty bunfig's `[install] auto = "disable"` — what plugin-run.sh passes
 *  as `--config=<empty-bunfig.toml>`, which a shebang cannot name by a
 *  relative path (adapters/runtime.ts). The processes these start get the
 *  empty bunfig as usual (`scriptArgs`). */
export const DIRECTORY_SHEBANG = "#!/usr/bin/env -S bun --no-env-file --config=/dev/null --no-install";

/** What the directory flavor leaves out although the trace reaches it: Node's
 *  loader, named by runtime.ts for a `node` command, which this bundle never
 *  writes (it runs under Bun alone); and the dashboard's brain picture — its
 *  module, the vendored three.js (~670 KiB, the bundle's one file over the
 *  directory's 256 KiB review line) and three's licence (2026-10-14). The
 *  dashboard reads the library's absence off the disk and draws the home tab
 *  without the picture (`dashboard/web/server.ts#BRAIN_LIBRARY`). */
export const DIRECTORY_DROPPED: readonly string[] = [
  "src/adapters/node-hooks.mjs",
  "src/adapters/dashboard/web/pages/home/brain.js",
  "src/adapters/dashboard/web/shared/vendor/three.module.min.js",
  "src/adapters/dashboard/web/shared/vendor/MIT-three.txt",
];

/** Bare imports a module may make: the runtimes' built-ins, and the engine a
 *  hooks module (the sidebar) runs inside. Anything else would need an
 *  installed package the bundle does not have. */
const BARE_OK = /^(node:|bun:|bun$|claude-code$)/;

/** What never belongs in the bundle, whatever names it. */
const FORBIDDEN: readonly [RegExp, string][] = [
  [/(^|\/)(NOTES|CONTRACT|INTERFACE-GAPS)\.md$/, "a module doc"],
  [/\.test\.[cm]?[jt]sx?$/, "a test"],
  [/(^|\/)tests?\//, "a test folder"],
  [/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|(^|\/)__MACOSX(\/|$)/i, "a macOS or Windows system file"],
  [/(^|\/)(bunfig\.toml|\.npmrc|\.yarnrc(\.yml)?|uv\.toml)$/, "a package-manager configuration file"],
  [/(^|\/)CLAUDE\.md$/, "a CLAUDE.md (not loaded from a plugin; validate warns)"],
  [/^bin\//, "a top-level bin/ (chat and Cowork refuse a plugin with one)"],
];

export interface Plan {
  readonly flavor: Flavor;
  /** Repository-relative paths copied as they are, sorted. */
  readonly copied: readonly string[];
  /** Bundle-relative path → repository-relative path, copied to another place (the icon). */
  readonly placed: Readonly<Record<string, string>>;
  /** Bundle-relative path → content, written fresh. */
  readonly generated: Readonly<Record<string, string>>;
  /** Bundle-relative paths written executable (the directory flavor's entries). */
  readonly executable: readonly string[];
  /** Said, not refused (the directory flavor nearing the file limit). */
  readonly warnings: readonly string[];
  readonly version: string;
}

// ── the roots Claude Code reads ────────────────────────────────────────────

/** The texts the trace starts from: the manifest, the hooks file and each command. */
export interface Roots {
  readonly manifest: string;
  readonly hooks: string;
  /** `commands/<name>.md` → its text. */
  readonly commands: Readonly<Record<string, string>>;
}

function repoRoots(repo: string): Roots {
  const commands: Record<string, string> = {};
  for (const name of readdirSync(join(repo, "commands")).sort()) {
    if (name.endsWith(".md")) commands[`commands/${name}`] = readFileSync(join(repo, "commands", name), "utf8");
  }
  return {
    manifest: readFileSync(join(repo, ".claude-plugin/plugin.json"), "utf8"),
    hooks: readFileSync(join(repo, "hooks/hooks.json"), "utf8"),
    commands,
  };
}

interface Command {
  command: string;
  args?: string[];
  [k: string]: unknown;
}

/** `sh <launcher> <mode> …rest` as the entry run by its own path:
 *  `${CLAUDE_PLUGIN_ROOT}/<entry>.js …rest`. Anything else is left as it is. */
export function shebangCommand<T extends Command>(c: T, problems: string[], where: string): T {
  const args = c.args ?? [];
  if (c.command !== "sh" || args[0] !== LAUNCHER) return c;
  const mode = args[1] as keyof typeof DIRECTORY_ENTRIES;
  if (!(mode in DIRECTORY_ENTRIES)) {
    problems.push(`${where} runs the launcher in a mode with no entry: ${String(args[1])}`);
    return c;
  }
  return { ...c, command: `\${CLAUDE_PLUGIN_ROOT}/${DIRECTORY_ENTRIES[mode]}`, args: args.slice(2) };
}

/** The hooks module the directory flavor carries: the sidebar alone (owner,
 *  2026-10-14), whatever hooks.json names — `register.tsx` itself, or
 *  `full.tsx`, which loads it and the speak-first module (the engine allows one
 *  module per plugin). The full flavor takes hooks.json's `modules` as they
 *  are; since the trace follows `modules` and their imports, `full.tsx` and
 *  `speak-first.tsx` ship there and fall out of the directory bundle. */
export const DIRECTORY_MODULES: readonly string[] = ["./sidebar/hooks/register.tsx"];

/** hooks.json's `modules`, as the directory flavor lists them: the sidebar
 *  alone when hooks.json names any module, else none. Pure. */
export function directoryModules(modules: readonly string[]): string[] {
  return modules.length === 0 ? [] : [...DIRECTORY_MODULES];
}

/** Files a hooks module reads at run time by path, not by import, carried in
 *  both flavors: the sidebar's fox frames (drawn by `Image {file}` relative to
 *  the plugin root, read by `$.fs.read` on the desktop). Every `*.png` in each
 *  folder that exists. */
export const SIDEBAR_ASSET_DIRS: readonly string[] = ["hooks/sidebar/art/fox"];

/** A command file's launcher lines as the console's own entry. The uninstall
 *  command's step 4 builds a terminal line from the launcher in words, so
 *  those words are rewritten too; whatever still names the launcher after
 *  this is refused (`directoryRoots`). */
const COMMAND_REWRITES: readonly [string, string][] = [
  ["`sh`, then the launcher's full path, then `cli`, then every item", "the console's full path, then every item"],
  ["The launcher's full path is", "The console's full path is"],
  ["`src/adapters/plugin-run.sh`", `\`${DIRECTORY_ENTRIES.cli}\``],
  ['sh "/full/path/to/src/adapters/plugin-run.sh" cli ', `"/full/path/to/${DIRECTORY_ENTRIES.cli}" `],
  [`sh "${LAUNCHER}" cli`, `"\${CLAUDE_PLUGIN_ROOT}/${DIRECTORY_ENTRIES.cli}"`],
];

export function directoryCommandText(text: string): string {
  let out = text;
  for (const [from, to] of COMMAND_REWRITES) out = out.split(from).join(to);
  return out;
}

/** The directory flavor's roots, from this repository's: every launcher
 *  command as its entry's own path. */
export function directoryRoots(repo: string, problems: string[] = []): Roots {
  const r = repoRoots(repo);
  const manifest = JSON.parse(r.manifest) as { mcpServers?: Record<string, Command> } & Record<string, unknown>;
  for (const [name, server] of Object.entries(manifest.mcpServers ?? {})) {
    manifest.mcpServers![name] = shebangCommand(server, problems, `plugin.json mcpServers.${name}`);
  }
  const hooks = JSON.parse(r.hooks) as { hooks?: Record<string, { hooks?: Command[] }[]> } & Record<string, unknown>;
  for (const [event, groups] of Object.entries(hooks.hooks ?? {})) {
    for (const g of groups) g.hooks = (g.hooks ?? []).map((h) => shebangCommand(h, problems, `hooks.json ${event}`));
  }
  if (Array.isArray(hooks["modules"])) hooks["modules"] = directoryModules(hooks["modules"] as string[]);
  const commands: Record<string, string> = {};
  for (const [path, text] of Object.entries(r.commands)) commands[path] = directoryCommandText(text);
  const roots: Roots = {
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
    hooks: `${JSON.stringify(hooks, null, 2)}\n`,
    commands,
  };
  for (const [path, text] of [[".claude-plugin/plugin.json", roots.manifest], ["hooks/hooks.json", roots.hooks], ...Object.entries(commands)] as const) {
    if (/plugin-run|`sh`|\blauncher\b/.test(text)) problems.push(`${path} still names the launcher, which the directory flavor does not carry`);
  }
  return roots;
}

/** Core's roots, from this repository's: plugin.json without the sidebar's
 *  `types`, hooks.json without its `modules`, the commands as they are. */
export function coreRoots(repo: string): Roots {
  const r = repoRoots(repo);
  const manifest = JSON.parse(r.manifest) as Record<string, unknown>;
  delete manifest["types"];
  const hooks = JSON.parse(r.hooks) as Record<string, unknown>;
  delete hooks["modules"];
  hooks["description"] = CORE_HOOKS_DESCRIPTION;
  return {
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
    hooks: `${JSON.stringify(hooks, null, 2)}\n`,
    commands: r.commands,
  };
}

// ── tracing ────────────────────────────────────────────────────────────────

function isFile(repo: string, rel: string): boolean {
  const abs = join(repo, rel);
  return existsSync(abs) && statSync(abs).isFile();
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** A relative module specifier from `from`, resolved the way the runtimes do
 *  here: as written, `./x.js` → `./x.ts`/`.tsx` (the NodeNext convention,
 *  adapters/node-hooks.mjs), and the extensionless forms a hooks module uses. */
function resolveModule(repo: string, from: string, spec: string): string | null {
  const base = toPosix(normalize(join(dirname(from), spec)));
  const tries = [base];
  if (/\.js$/.test(base)) tries.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  tries.push(`${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.d.ts`);
  for (const t of tries) if (isFile(repo, t)) return t;
  return null;
}

/** Every `${CLAUDE_PLUGIN_ROOT}/<path>` a manifest, hooks file or command names. */
function pluginRootPaths(text: string): string[] {
  return [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1]!);
}

/** The bundle's file set, traced from what Claude Code reads. For the
 *  directory flavor, a root naming `src/…/x.js` is traced from `src/…/x.ts`,
 *  and the roots themselves are generated (not in the set). */
export function traceFiles(repo: string = REPO, flavor: Flavor = "full", roots?: Roots): { files: string[]; problems: string[] } {
  const files = new Set<string>();
  const problems: string[] = [];
  const queue: string[] = [];
  const add = (rel: string, why: string): void => {
    let r = toPosix(normalize(rel));
    if (r.startsWith("..") || r.startsWith("/")) {
      problems.push(`${why} names ${rel}, outside the plugin`);
      return;
    }
    if (flavor === "directory" && r.startsWith("src/") && r.endsWith(".js") && !isFile(repo, r) && isFile(repo, r.replace(/\.js$/, ".ts"))) {
      r = r.replace(/\.js$/, ".ts");
    }
    if (!isFile(repo, r)) {
      problems.push(`${why} names ${rel}, which is not a file`);
      return;
    }
    if (!files.has(r)) {
      files.add(r);
      queue.push(r);
    }
  };
  if (flavor === "sidebar") throw new Error("the sidebar plugin is traced by planSidebar, from its own root");
  const root = roots ?? (flavor === "directory" ? directoryRoots(repo, problems) : flavor === "core" ? coreRoots(repo) : repoRoots(repo));
  // In the full flavor the roots are this repository's files, carried as they
  // are; core carries the commands as they are and generates hooks.json.
  const carry = (rel: string, why: string): void => {
    if (flavor === "full" || (flavor === "core" && rel !== "hooks/hooks.json")) add(rel, why);
  };

  // The roots Claude Code reads.
  for (const p of pluginRootPaths(root.manifest)) add(p, "plugin.json");
  const types = (JSON.parse(root.manifest) as { types?: string }).types;
  if (typeof types === "string") add(types, "plugin.json `types`");
  if (flavor === "full" || flavor === "core") add(".claude-plugin/binaries.json", "plugin-run.sh (the single binary's checksums)");

  carry("hooks/hooks.json", "Claude Code (hooks/hooks.json)");
  for (const p of pluginRootPaths(root.hooks)) add(p, "hooks/hooks.json");
  const modules = (JSON.parse(root.hooks) as { modules?: string[] }).modules ?? [];
  for (const m of modules) add(join("hooks", m), "hooks/hooks.json `modules`");
  // What the sidebar reads by path (its fox frames), whenever a module is carried.
  if (modules.length > 0) {
    for (const d of SIDEBAR_ASSET_DIRS) {
      if (!existsSync(join(repo, d))) continue;
      for (const name of readdirSync(join(repo, d)).sort()) if (name.endsWith(".png")) add(`${d}/${name}`, "the sidebar (read by path)");
    }
  }

  for (const [path, text] of Object.entries(root.commands).sort(([a], [b]) => a.localeCompare(b))) {
    carry(path, "Claude Code (commands/)");
    for (const p of pluginRootPaths(text)) add(p, path);
  }

  // The dashboard's server, which `plugin-run.sh cli dashboard` starts in the
  // console's process (the CLI imports it, so this only says so out loud).
  add("src/adapters/dashboard/web/server.ts", "the dashboard (`counterparts dashboard`)");

  // Follow every file.
  while (queue.length > 0) {
    const f = queue.shift()!;
    const text = readFileSync(join(repo, f), "utf8");
    if (f.endsWith(".sh")) {
      // `$here` is the script's own directory (plugin-run.sh); `$here/../..`,
      // the plugin root, is a directory and not a file to carry.
      for (const m of text.matchAll(/\$here\/([A-Za-z0-9_./-]+)/g)) {
        const rel = join(dirname(f), m[1]!);
        if (!(existsSync(join(repo, rel)) && statSync(join(repo, rel)).isDirectory())) add(rel, f);
      }
      continue;
    }
    if (!/\.(m?[jt]sx?)$/.test(f) || f.endsWith(".d.ts")) {
      if (f.endsWith(".d.ts")) followModule(repo, f, text, add, problems);
      continue;
    }
    followModule(repo, f, text, add, problems);
  }

  // The dashboard's page: served from a directory the server names by
  // `packagePath`, so the browser's references are followed from app.html.
  const web = "src/adapters/dashboard/web";
  if (files.has(`${web}/server.ts`)) {
    for (const w of traceWeb(repo, web, problems)) add(w, "the dashboard's page");
  }

  const out = [...files].filter((f) => flavor !== "directory" || !DIRECTORY_DROPPED.includes(f));
  return { files: out.sort(), problems };
}

function followModule(
  repo: string,
  f: string,
  text: string,
  add: (rel: string, why: string) => void,
  problems: string[],
): void {
  const src = text.replace(/^#!.*\n/, "\n");
  const specs = ts.preProcessFile(src, true, true).importedFiles.map((i) => i.fileName);
  for (const spec of specs) {
    if (spec.startsWith(".")) {
      const r = resolveModule(repo, f, spec);
      if (r === null) problems.push(`${f} imports ${spec}, which resolves to no file`);
      else add(r, f);
    } else if (!BARE_OK.test(spec)) {
      problems.push(`${f} imports the package ${spec}, which the bundle does not install`);
    }
  }
  // Scripts a process starts or a launcher runs, by URL from the module.
  for (const m of src.matchAll(/new URL\(\s*["'`](\.{1,2}\/[^"'`$]*[^/"'`$])["'`]\s*,\s*import\.meta\.url\s*\)/g)) {
    add(join(dirname(f), m[1]!), f);
  }
  // Files read from the install by their path from the package root. A
  // directory (the dashboard's web root, `src` for log trimming) is not a file
  // list; package.json is generated.
  for (const m of src.matchAll(/packagePath\(\s*["'`]([^"'`$]+)["'`]/g)) {
    const rel = m[1]!;
    if (rel === "package.json" || rel.startsWith("node_modules/")) continue;
    if (existsSync(join(repo, rel)) && statSync(join(repo, rel)).isDirectory()) continue;
    add(rel, f);
  }
}

/** The dashboard page's static files, followed from app.html as a browser
 *  would: `src=`/`href=`, ES module imports, CSS `url()`/`@import`. Absolute
 *  URLs are from the web root; a licence text beside a referenced file rides
 *  with it. */
export function traceWeb(repo: string, web: string, problems: string[] = []): string[] {
  const out = new Set<string>();
  const queue: string[] = [];
  const at = (from: string, url: string): void => {
    if (/^(https?:|data:|#|mailto:)/.test(url)) return;
    const clean = url.replace(/[?#].*$/, "");
    const rel = clean.startsWith("/") ? posix.join(web, clean) : posix.join(posix.dirname(from), clean);
    if (!isFile(repo, rel)) {
      problems.push(`${from} references ${url}, which is not a file`);
      return;
    }
    if (!out.has(rel)) {
      out.add(rel);
      queue.push(rel);
    }
  };
  at(`${web}/app.html`, "/app.html");
  while (queue.length > 0) {
    const f = queue.shift()!;
    const text = readFileSync(join(repo, f), "utf8");
    if (f.endsWith(".html")) {
      for (const m of text.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)) at(f, m[1]!);
      for (const m of text.matchAll(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)) {
        for (const i of ts.preProcessFile(m[1]!, true, true).importedFiles) at(f, i.fileName);
      }
    } else if (f.endsWith(".js")) {
      for (const i of ts.preProcessFile(text, true, true).importedFiles) at(f, i.fileName);
    } else if (f.endsWith(".css")) {
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) at(f, m[1]!);
      for (const m of text.matchAll(/@import\s+["']([^"']+)["']/g)) at(f, m[1]!);
    }
  }
  // Licence texts beside vendored code and fonts (OFL, MIT: they travel with the files).
  for (const dir of new Set([...out].map((f) => posix.dirname(f)))) {
    for (const name of readdirSync(join(repo, dir))) {
      if (/^(OFL|MIT|LICENSE)[^/]*\.txt$/i.test(name)) out.add(`${dir}/${name}`);
    }
  }
  return [...out].sort();
}

// ── transpiling (the directory flavor) ─────────────────────────────────────

/** Is this a source the directory flavor transpiles? The TypeScript under
 *  `src/` — every one a server-side module, the dashboard's included (the
 *  browser is served `.js`, `.css` and `.html` only). The sidebar's `.ts(x)`
 *  under `hooks/` stay as they are: Claude Code compiles a hooks module itself. */
export function isTranspiled(rel: string): boolean {
  return rel.startsWith("src/") && /\.ts$/.test(rel) && !rel.endsWith(".d.ts");
}

/** `src/x.ts` → `src/x.js`: the transpiled tree mirrors the sources. */
export function transpiledPath(rel: string): string {
  return rel.replace(/\.ts$/, ".js");
}

let transpiler: InstanceType<typeof Bun.Transpiler> | null = null;

/** One TypeScript source as the JavaScript the directory flavor ships: types
 *  and comments stripped, imports as written (`./x.js`, the transpiled
 *  sibling). The sources keep `verbatimModuleSyntax` (tsconfig.json), so every
 *  type-only import says so and nothing else is dropped. The output depends on
 *  the Bun version, which `--check` names. */
export function transpileSource(text: string): string {
  transpiler ??= new Bun.Transpiler({
    loader: "ts",
    target: "node",
    tsconfig: { compilerOptions: { verbatimModuleSyntax: true } } as unknown as string,
  });
  return escapeInvisible(transpiler.transformSync(text));
}

/**
 * The invisible and control characters the directory's validator holds ("Invisible
 * characters in a string or comment"): C0 controls but tab, newline and return; DEL
 * and the C1 controls; the soft hyphen; zero-width and direction marks; the line and
 * paragraph separators; word joiner and invisible operators; the byte-order mark.
 * Built from a string, not a regex literal: Bun's own transpiler, which runs this
 * file, turns ` ` inside a regex literal into the character itself (measured
 * 2026-10-14, a syntax error).
 */
export const INVISIBLE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u2060-\\u2064\\uFEFF]",
  "g",
);

/**
 * Transpiled code with every `INVISIBLE` character written as its `\uXXXX`
 * escape. Bun's transpiler COOKS a string's or an untagged template's escapes
 * (the source's `"\x7f"` came out as a literal DEL in cli/ui.js, 2026-10-14)
 * and keeps regex literals and `String.raw` as written; with comments
 * stripped, a literal character can only sit in a string or untagged
 * template, where `\uXXXX` is the same character. One after an odd run of
 * backslashes would change meaning, so it is refused rather than guessed.
 */
export function escapeInvisible(js: string): string {
  return js.replace(INVISIBLE, (ch: string, at: number) => {
    let slashes = 0;
    while (at - slashes - 1 >= 0 && js[at - slashes - 1] === "\\") slashes += 1;
    const code = `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    if (slashes % 2 === 1) throw new Error(`a backslash before an invisible character (${code}): escape it in the source`);
    return code;
  });
}

// ── generated files ────────────────────────────────────────────────────────

function readJson<T>(repo: string, rel: string): T {
  return JSON.parse(readFileSync(join(repo, rel), "utf8")) as T;
}

/** The exact version and integrity bun.lock pins for one package. */
export function lockedPackage(repo: string, name: string): { version: string; integrity: string } {
  const lock = readFileSync(join(repo, "bun.lock"), "utf8");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`"${esc}": \\["${esc}@([^"]+)", "[^"]*", \\{[^}]*\\}, "(sha512-[^"]+)"\\]`).exec(lock);
  if (m === null) throw new Error(`bun.lock pins no ${name}`);
  return { version: m[1]!, integrity: m[2]! };
}

/** The bundle's manifest: `manifestText` (this repository's, or the directory
 *  flavor's rewrite of it) with the version set and the listing fields added. */
export function bundleManifest(
  repo: string,
  version: string,
  manifestText: string = readFileSync(join(repo, ".claude-plugin/plugin.json"), "utf8"),
  extraKeywords: readonly string[] = EXTRA_KEYWORDS,
): string {
  const m = JSON.parse(manifestText) as Record<string, unknown>;
  const keywords = [...new Set([...((m["keywords"] as string[] | undefined) ?? []), ...extraKeywords])];
  const out: Record<string, unknown> = {};
  // The repository's fields in their order, with the version set and the
  // listing fields after the links they sit beside.
  for (const [k, v] of Object.entries(m)) {
    if (k === "version") out[k] = version;
    else if (k === "keywords") out[k] = keywords;
    else out[k] = v;
    if (k === "repository") Object.assign(out, LISTING);
  }
  if (!("documentationUrl" in out)) Object.assign(out, LISTING);
  if (!("keywords" in out)) out["keywords"] = keywords;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function bundlePackageJson(version: string, model: { version: string }): string {
  const pkg = {
    name: "counterparts",
    version,
    private: true,
    description: "The Counterparts Claude Code plugin. Generated from github.com/mlapeter/counterparts by tools/plugin-bundle/build.ts.",
    license: "MIT",
    type: "module",
    dependencies: { [MODEL_PACKAGE]: model.version },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** The lockfile the bundle ships. Claude Code runs the package manager its
 *  lockfile names, from the user's PATH, and tries no other
 *  (code.claude.com/docs/en/plugins/loading#node-js-package-dependencies), so
 *  this decides who gets the embedding table at install. npm: Node users
 *  without Bun far outnumber Bun users without npm, and the docs recommend it
 *  for reach. Whichever runtime the launcher then picks reads the same
 *  node_modules; a computer with neither runs the single binary, which carries
 *  its own table (runtime.ts#bundledModelDir). */
export const BUNDLE_LOCKFILE = "package-lock.json";

/** An npm lockfile (lockfileVersion 3, as npm 7+ writes) with the one package,
 *  at the version and integrity this repository's own bun.lock pins: no
 *  network, same bytes every run, and what `npm install --package-lock-only`
 *  writes for the same package.json. */
export function bundleLock(version: string, model: { version: string; integrity: string }): string {
  const lock = {
    name: "counterparts",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "counterparts", version, license: "MIT", dependencies: { [MODEL_PACKAGE]: model.version } },
      [`node_modules/${MODEL_PACKAGE}`]: {
        version: model.version,
        resolved: `https://registry.npmjs.org/${MODEL_PACKAGE}/-/${MODEL_PACKAGE}-${model.version}.tgz`,
        integrity: model.integrity,
      },
    },
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** The README for one flavor, from tools/plugin-bundle/bundle-readme.md (the
 *  sidebar plugin's from sidebar-readme.md): `<!-- flavor:<names> -->` …
 *  `<!-- /flavor:<names> -->` blocks, `<names>` one flavor or several split by
 *  spaces, are kept for those flavors and dropped for the others (a block may
 *  hold blocks of other names), and every line that is only an HTML comment
 *  (those markers, and notes for whoever edits the template) is removed. */
export function bundleReadme(template: string, flavor: Flavor): string {
  let kept = template;
  for (let prev = ""; prev !== kept; ) {
    prev = kept;
    kept = kept.replace(/^<!-- flavor:([\w ]+) -->\n([\s\S]*?)^<!-- \/flavor:\1 -->\n/gm, (_m, f: string, body: string) =>
      f.split(" ").includes(flavor) ? body : "",
    );
  }
  return kept.replace(/^<!--[^\n]*-->\n/gm, "").replace(/\n{3,}/g, "\n\n");
}

// ── the plan, checked ──────────────────────────────────────────────────────

const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i;

export function planBundle(repo: string = REPO, flavor: Flavor = "full"): Plan {
  if (flavor === "sidebar") return planSidebar(repo);
  const problems: string[] = [];
  const warnings: string[] = [];
  const version = readJson<{ version: string }>(repo, "package.json").version;
  const pluginVersion = readJson<{ version?: string }>(repo, ".claude-plugin/plugin.json").version;
  if (pluginVersion !== version) problems.push(`.claude-plugin/plugin.json is ${pluginVersion}, package.json ${version}`);
  if (flavor === "full" || flavor === "core") {
    // plugin-run.sh will not download a binary whose checksums name another version.
    const binVersion = readJson<{ version?: string }>(repo, ".claude-plugin/binaries.json").version;
    if (binVersion !== version) problems.push(`.claude-plugin/binaries.json is ${binVersion}, package.json ${version} (run tools/single-binary/build.ts --release first)`);
  }
  if (!isFile(repo, ICON_SOURCE)) problems.push(`${ICON_SOURCE} (the listing icon) is missing`);

  const roots = flavor === "directory" ? directoryRoots(repo, problems) : flavor === "core" ? coreRoots(repo) : repoRoots(repo);
  const traced = traceFiles(repo, flavor, roots);
  problems.push(...traced.problems);

  const model = lockedPackage(repo, MODEL_PACKAGE);
  const template = readFileSync(join(HERE, "bundle-readme.md"), "utf8");
  const generated: Record<string, string> = {
    ".claude-plugin/plugin.json": bundleManifest(repo, version, roots.manifest, flavor === "core" ? EXTRA_KEYWORDS.filter((k) => k !== "sidebar") : EXTRA_KEYWORDS),
    "package.json": bundlePackageJson(version, model),
    [BUNDLE_LOCKFILE]: bundleLock(version, model),
    "README.md": bundleReadme(template, flavor),
  };
  const placed: Record<string, string> = { [ICON_PATH]: ICON_SOURCE };
  const executable: string[] = [];
  let copied = [...traced.files.filter((f) => f !== ".claude-plugin/plugin.json"), "LICENSE"].sort();

  if (flavor === "core") {
    generated["hooks/hooks.json"] = roots.hooks;
    // Memory alone: nothing of the sidebar, whatever names it.
    for (const f of copied) if (f.startsWith(`${SIDEBAR_DIR}/`)) problems.push(`${f} is the sidebar's, which core does not carry`);
  }

  if (flavor === "directory") {
    generated["hooks/hooks.json"] = roots.hooks;
    Object.assign(generated, roots.commands);
    const sources = copied.filter(isTranspiled);
    copied = copied.filter((f) => !isTranspiled(f));
    for (const s of sources) generated[transpiledPath(s)] = transpileSource(readFileSync(join(repo, s), "utf8"));
    for (const entry of Object.values(DIRECTORY_ENTRIES)) {
      const js = generated[entry];
      if (js === undefined) {
        problems.push(`${entry} (an entry Claude Code runs) was not transpiled: its source is not in the file set`);
        continue;
      }
      generated[entry] = `${DIRECTORY_SHEBANG}\n${js}`;
      executable.push(entry);
    }
    problems.push(...mirrorProblems(sources, copied, generated));
    // No invisible character in any .js the bundle carries, transpiled or as it is.
    const scripts: [string, string][] = [
      ...Object.entries(generated).filter(([f]) => f.endsWith(".js")),
      ...copied.filter((f) => f.endsWith(".js")).map((f): [string, string] => [f, readFileSync(join(repo, f), "utf8")]),
    ];
    for (const [f, text] of scripts) {
      const at = text.search(INVISIBLE);
      if (at >= 0) problems.push(`${f} holds an invisible character (U+${text.charCodeAt(at).toString(16).toUpperCase().padStart(4, "0")}) at line ${text.slice(0, at).split("\n").length}`);
    }
  }

  return finishPlan(repo, { flavor, copied, placed, generated, executable: executable.sort(), warnings, version }, problems);
}

/** The checks every flavor's plan passes (header: what it refuses), then the plan. */
function finishPlan(repo: string, plan: Plan, problems: string[]): Plan {
  const { flavor, copied, placed, generated } = plan;
  const warnings = [...plan.warnings];
  const all = [...copied, ...Object.keys(placed), ...Object.keys(generated)];
  for (const f of all) {
    for (const [re, what] of FORBIDDEN) if (re.test(f)) problems.push(`${f} is ${what}`);
  }
  const sizes: [string, number][] = Object.entries(generated).map(([f, text]) => [f, Buffer.byteLength(text)]);
  for (const [to, from] of [...copied.map((f) => [f, f]), ...Object.entries(placed)]) {
    const st = lstatSync(join(repo, from!));
    if (st.isSymbolicLink()) problems.push(`${from} is a symlink`);
    else sizes.push([to!, st.size]);
  }
  for (const [f, bytes] of sizes) {
    if (bytes >= MAX_FILE_BYTES) problems.push(`${f} is ${bytes} bytes, over the 5 MiB limit`);
    else if (flavor === "directory" && bytes > MAX_INSPECTED_BYTES) {
      problems.push(`${f} is ${bytes} bytes, over 256 KiB (the directory holds it for a reviewer)`);
    }
  }
  const count = new Set(all).size;
  if (count > MAX_FILES && fileLimitApplies(flavor, plan.version)) problems.push(`${count} files, over the directory's ${MAX_FILES}`);
  else if (flavor === "directory" && count >= WARN_FILES) warnings.push(`${count} files, near the directory's ${MAX_FILES}`);

  if (problems.length > 0) throw new Error(`plugin bundle refused:\n  ${problems.join("\n  ")}`);
  return { ...plan, warnings };
}

// ── the sidebar as a plugin of its own (header, "TWO PLUGINS") ─────────────

/**
 * What `sidebarText` writes out under the sidebar plugin's name: the owner of
 * every `$.state` key (`{ plugin: 'counterparts', key }`), the speak-first's
 * check that a prompt is its own (`e.origin.name === 'counterparts'`) and the
 * contract's `PluginState` key. The last two are for a copy of the sidebar's
 * tests (`test/plugin-bundle.test.ts` runs them against the renamed sources);
 * no test ships. Commands (`/counterparts`, `/counterparts:meet`), the pane's
 * id and the MCP server's spellings are core's or the pane's, not the
 * plugin's name, and stay.
 */
export const SIDEBAR_RENAMES: readonly (readonly [RegExp, string])[] = [
  [/(\bplugin:\s*)(['"])counterparts\2/g, `$1$2${SIDEBAR_PLUGIN}$2`],
  [/(\.origin\.name\s*===\s*)(['"])counterparts\2/g, `$1$2${SIDEBAR_PLUGIN}$2`],
  [/(\binterface PluginState \{\s*\n\s*)counterparts:/g, `$1'${SIDEBAR_PLUGIN}':`],
  [/(\bexport const PLUGIN\s*=\s*)(['"])counterparts\2/g, `$1$2${SIDEBAR_PLUGIN}$2`],
  [/(\bkind:\s*'plugin',\s*name:\s*)(['"])counterparts\2/g, `$1$2${SIDEBAR_PLUGIN}$2`],
];

/** What must not be left in a renamed file: any of the patterns above still naming `counterparts`. */
const SIDEBAR_LEFT = [
  /\bplugin:\s*['"]counterparts['"]/,
  /\.origin\.name\s*===\s*['"]counterparts['"]/,
  /\binterface PluginState \{\s*\n\s*counterparts:/,
  /\bkind:\s*'plugin',\s*name:\s*['"]counterparts['"]/,
];

/** One sidebar source as the sidebar plugin carries it, and how many names it rewrote. Pure. */
export function sidebarText(text: string): { text: string; renamed: number } {
  let out = text;
  let renamed = 0;
  for (const [re, to] of SIDEBAR_RENAMES) {
    renamed += (out.match(re) ?? []).length;
    out = out.replace(re, to);
  }
  return { text: out, renamed };
}

/** A renamed file still naming `counterparts` where only the sidebar plugin's name may stand: the first such line, or null. */
export function sidebarLeftover(text: string): string | null {
  for (const re of SIDEBAR_LEFT) {
    const m = re.exec(text);
    if (m !== null) return text.slice(0, m.index).split("\n").length.toString();
  }
  return null;
}

/** The sidebar plugin's manifest: its own name, the same version as core, and core as its dependency. */
export function sidebarManifest(repo: string, version: string): string {
  const core = readJson<Record<string, unknown>>(repo, ".claude-plugin/plugin.json");
  const out: Record<string, unknown> = {
    name: SIDEBAR_PLUGIN,
    displayName: "Counterparts Sidebar",
    version,
    description:
      "The Counterparts sidebar: a pane beside the chat that shows what your counterpart's memory is doing (what came to mind, what was saved, the day's mechanisms, the last dream), with a fox. Installs Counterparts, the memory, with it.",
    author: core["author"],
    homepage: core["homepage"],
    repository: core["repository"],
    ...LISTING,
    license: core["license"],
    keywords: ["memory", "sidebar", "counterparts", "pane", "mod"],
    types: "./types/index.d.ts",
    dependencies: SIDEBAR_DEPENDENCIES,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * The sidebar plugin: `hooks/sidebar/` as the plugin's root. Traced from its
 * own hooks.json (`modules`) through every import, plus its contract and the
 * fox's PNG frames; every source written out by `sidebarText`. Nothing
 * outside `hooks/sidebar/` may be reached but the licence and the icon.
 */
export function planSidebar(repo: string = REPO): Plan {
  const problems: string[] = [];
  const version = readJson<{ version: string }>(repo, "package.json").version;
  const hooksFile = `${SIDEBAR_DIR}/hooks/hooks.json`;
  const modules = readJson<{ modules?: string[] }>(repo, hooksFile).modules ?? [];
  if (modules.length === 0) problems.push(`${hooksFile} names no hooks module`);
  const types = readJson<{ types?: string }>(repo, `${SIDEBAR_DIR}/.claude-plugin/plugin.json`).types ?? "./types/index.d.ts";

  const files = new Set<string>();
  const queue: string[] = [];
  const add = (rel: string, why: string): void => {
    const r = toPosix(normalize(rel));
    if (!r.startsWith(`${SIDEBAR_DIR}/`)) {
      problems.push(`${why} names ${rel}, outside ${SIDEBAR_DIR}/ (the sidebar plugin's root)`);
      return;
    }
    if (!isFile(repo, r)) {
      problems.push(`${why} names ${rel}, which is not a file`);
      return;
    }
    if (!files.has(r)) {
      files.add(r);
      queue.push(r);
    }
  };
  for (const m of modules) add(join(SIDEBAR_DIR, "hooks", m), `${hooksFile} \`modules\``);
  add(join(SIDEBAR_DIR, types), "the sidebar's plugin.json `types`");
  while (queue.length > 0) {
    const f = queue.shift()!;
    followModule(repo, f, readFileSync(join(repo, f), "utf8"), add, problems);
  }

  const inRoot = (rel: string): string => rel.slice(SIDEBAR_DIR.length + 1);
  const generated: Record<string, string> = {
    ".claude-plugin/plugin.json": sidebarManifest(repo, version),
    "README.md": bundleReadme(readFileSync(join(HERE, "sidebar-readme.md"), "utf8"), "sidebar"),
  };
  let renamed = 0;
  for (const f of [...files].sort()) {
    const out = sidebarText(readFileSync(join(repo, f), "utf8"));
    renamed += out.renamed;
    const left = sidebarLeftover(out.text);
    if (left !== null) problems.push(`${f} still names counterparts as a $.state owner or a prompt's plugin, at line ${left}`);
    generated[inRoot(f)] = out.text;
  }
  if (renamed === 0) problems.push("no $.state owner was renamed: the sidebar's sources no longer look the way sidebarText expects");

  const placed: Record<string, string> = { [ICON_PATH]: ICON_SOURCE, "hooks/hooks.json": hooksFile };
  for (const d of SIDEBAR_ASSET_DIRS) {
    if (!existsSync(join(repo, d))) continue;
    for (const name of readdirSync(join(repo, d)).sort()) if (name.endsWith(".png")) placed[inRoot(`${d}/${name}`)] = `${d}/${name}`;
  }
  if (!isFile(repo, ICON_SOURCE)) problems.push(`${ICON_SOURCE} (the listing icon) is missing`);
  return finishPlan(repo, { flavor: "sidebar", copied: ["LICENSE"], placed, generated, executable: [], warnings: [], version }, problems);
}

/** The directory flavor's tree must mirror the sources one for one: every
 *  transpiled source as its `.js` at the same path, no TypeScript left under
 *  `src/`, no `.js` there that is neither a transpiled source nor a file
 *  carried as it is (the dashboard's browser files), and no two landing on
 *  one path. */
export function mirrorProblems(sources: readonly string[], copied: readonly string[], generated: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const fromSource = new Set(sources.map(transpiledPath));
  for (const s of sources) {
    if (generated[transpiledPath(s)] === undefined) problems.push(`${s} has no ${transpiledPath(s)}`);
  }
  for (const f of copied) {
    if (fromSource.has(f)) problems.push(`${f} is both a transpiled source and a file carried as it is`);
    if (f.startsWith("src/") && /\.(ts|tsx|mts|cts)$/.test(f)) problems.push(`${f} is TypeScript left in the transpiled tree`);
  }
  for (const f of Object.keys(generated)) {
    if (f.startsWith("src/") && f.endsWith(".js") && !fromSource.has(f)) problems.push(`${f} is generated under src/ from no source`);
  }
  return problems;
}

/** Every bundle path, copied, placed and generated, sorted. */
export function bundlePaths(plan: Plan): string[] {
  return [...new Set([...plan.copied, ...Object.keys(plan.placed), ...Object.keys(plan.generated)])].sort();
}

// ── writing ────────────────────────────────────────────────────────────────

/** The branch a git checkout at `dir` is on (its HEAD; a worktree's `.git`
 *  file followed), or null: not a checkout, or a detached HEAD. Reads only. */
export function checkoutBranch(dir: string): string | null {
  try {
    const dotGit = join(dir, ".git");
    if (!existsSync(dotGit)) return null;
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
      if (m === null) return null;
      gitDir = resolve(dir, m[1]!.trim());
    }
    const head = /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(join(gitDir, "HEAD"), "utf8"));
    return head === null ? null : head[1]!.trim();
  } catch {
    return null;
  }
}

/** Write the bundle into `out`. A folder that already holds a bundle (or a
 *  clone of the bundle repository) is emptied first, `.git` kept; any other
 *  non-empty folder is refused. */
export function writeBundle(plan: Plan, out: string, repo: string = REPO): void {
  const target = resolve(out);
  const rel = relative(repo, target);
  if (rel === "" || !rel.startsWith("..") || relative(target, repo) === "" || !relative(target, repo).startsWith("..")) {
    throw new Error(`refusing to write the bundle at ${target}: inside this repository, or one of its parents`);
  }
  // The bundle repository's `directory` branch (under review) takes the
  // directory flavor and nothing else, and that flavor goes nowhere else: a
  // cheap backstop for never pushing the wrong tree there.
  const branch = checkoutBranch(target);
  if (branch === "directory" && plan.flavor !== "directory") {
    throw new Error(`refusing to write the ${plan.flavor} bundle at ${target}: that checkout is on the directory branch`);
  }
  if (branch !== null && branch !== "directory" && plan.flavor === "directory") {
    throw new Error(`refusing to write the directory bundle at ${target}: that checkout is on ${branch}, not the directory branch`);
  }
  if (existsSync(target)) {
    const entries = readdirSync(target).filter((n) => n !== ".git");
    if (entries.length > 0) {
      const mf = join(target, ".claude-plugin/plugin.json");
      const name = existsSync(mf) ? (JSON.parse(readFileSync(mf, "utf8")) as { name?: string }).name : undefined;
      const ours = name === CORE_PLUGIN || name === SIDEBAR_PLUGIN;
      if (!ours) throw new Error(`refusing to write the bundle at ${target}: not empty and not a previous bundle`);
      // One plugin's clone never takes the other's bundle (core's main is not the sidebar's).
      const writing = (JSON.parse(plan.generated[".claude-plugin/plugin.json"] ?? "{}") as { name?: string }).name;
      if (writing !== name) throw new Error(`refusing to write the ${writing} bundle at ${target}: it holds the ${name} plugin`);
      for (const n of entries) rmSync(join(target, n), { recursive: true, force: true });
    }
  }
  for (const f of plan.copied) {
    mkdirSync(dirname(join(target, f)), { recursive: true });
    copyFileSync(join(repo, f), join(target, f));
  }
  for (const [to, from] of Object.entries(plan.placed)) {
    mkdirSync(dirname(join(target, to)), { recursive: true });
    copyFileSync(join(repo, from), join(target, to));
  }
  for (const [f, text] of Object.entries(plan.generated)) {
    mkdirSync(dirname(join(target, f)), { recursive: true });
    writeFileSync(join(target, f), text);
    chmodSync(join(target, f), plan.executable.includes(f) ? 0o755 : 0o644);
  }
}

/** Files at or over 256 KiB that are not images or fonts: held for a reviewer. */
export function largeFiles(dir: string, paths: readonly string[]): { path: string; bytes: number }[] {
  return paths
    .filter((p) => !IMAGE_OR_FONT.test(p))
    .map((p) => ({ path: p, bytes: statSync(join(dir, p)).size }))
    .filter((f) => f.bytes > MAX_INSPECTED_BYTES)
    .sort((a, b) => b.bytes - a.bytes);
}

// ── the drift check ────────────────────────────────────────────────────────

/** Every file under `dir`, `.git` and `node_modules` aside, sorted. */
function walkFiles(dir: string, base = ""): string[] {
  return readdirSync(join(dir, base), { withFileTypes: true })
    .flatMap((e) => {
      const rel = base === "" ? e.name : `${base}/${e.name}`;
      if (base === "" && (e.name === ".git" || e.name === "node_modules")) return [];
      return e.isDirectory() ? walkFiles(dir, rel) : [rel];
    })
    .sort();
}

/**
 * Rebuild the plan into a temporary folder and compare it with `dir` (a
 * previous bundle, or a clone of the bundle repository): the same paths, the
 * same bytes, the same exec bit. The differences, one line each; empty when
 * `dir` is what this build makes. The transpiled files depend on the Bun
 * version, so a difference names it (`--check`).
 */
export function driftLines(plan: Plan, dir: string, repo: string = REPO): string[] {
  const tmp = mkdtempSync(join(tmpdir(), "counterparts-plugin-check-"));
  try {
    const fresh = join(tmp, "bundle");
    writeBundle(plan, fresh, repo);
    const want = walkFiles(fresh);
    const have = new Set(walkFiles(dir));
    const lines: string[] = [];
    for (const f of want) {
      if (!have.has(f)) {
        lines.push(`missing  ${f}`);
        continue;
      }
      have.delete(f);
      if (!readFileSync(join(fresh, f)).equals(readFileSync(join(dir, f)))) lines.push(`differs  ${f}`);
      const exec = (p: string): boolean => (statSync(p).mode & 0o111) !== 0;
      if (exec(join(fresh, f)) !== exec(join(dir, f))) lines.push(`mode     ${f} (${exec(join(fresh, f)) ? "should be" : "should not be"} executable)`);
    }
    for (const f of have) lines.push(`extra    ${f}`);
    return lines;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let flavor: Flavor = "full";
  const at = args.findIndex((a) => a === "--flavor" || a.startsWith("--flavor="));
  if (at >= 0) {
    const value = args[at]!.includes("=") ? args[at]!.slice("--flavor=".length) : args[at + 1];
    args.splice(at, args[at]!.includes("=") ? 1 : 2);
    if (!(FLAVORS as readonly string[]).includes(value ?? "")) {
      console.error(`--flavor takes ${FLAVORS.join(" or ")}`);
      process.exit(2);
    }
    flavor = value as Flavor;
  }
  const usage = (): never => {
    console.error("usage: bun tools/plugin-bundle/build.ts [--flavor full|directory|core|sidebar] <out-dir> | --list | --check <dir>");
    process.exit(2);
  };
  // The tripwire is the command's, not planBundle's: the tests keep checking
  // the full flavor's file set (core is built from it) at any version.
  const tripped = splitTripwire(readJson<{ version: string }>(REPO, "package.json").version, flavor);
  if (tripped !== null) {
    console.error(`plugin bundle refused: ${tripped}`);
    process.exit(1);
  }
  const plan = planBundle(REPO, flavor);
  const paths = bundlePaths(plan);
  for (const w of plan.warnings) console.error(`warning: ${w}`);
  if (args[0] === "--list") {
    console.log(paths.join("\n"));
    console.log(`${paths.length} files (limit ${MAX_FILES}), version ${plan.version}, flavor ${flavor}`);
  } else if (args[0] === "--check") {
    if (args.length !== 2) usage();
    const lines = driftLines(plan, args[1]!);
    if (lines.length > 0) {
      console.error(`${resolve(args[1]!)} is not what this build makes (flavor ${flavor}, Bun ${Bun.version}; the transpiled files depend on the Bun version):`);
      console.error(lines.map((l) => `  ${l}`).join("\n"));
      process.exit(1);
    }
    console.log(`${resolve(args[1]!)} matches this build: ${paths.length} files, flavor ${flavor}, version ${plan.version}, Bun ${Bun.version}`);
  } else if (args.length !== 1 || args[0]!.startsWith("-")) {
    usage();
  } else {
    writeBundle(plan, args[0]!);
    const big = largeFiles(args[0]!, paths);
    const bytes = paths.reduce((n, p) => n + statSync(join(args[0]!, p)).size, 0);
    console.log(`wrote ${paths.length} files (limit ${MAX_FILES}), ${(bytes / 1e6).toFixed(2)} MB, to ${resolve(args[0]!)}, version ${plan.version}, flavor ${flavor}`);
    console.log(big.length === 0 ? "no file over 256 KiB" : `over 256 KiB (held for a reviewer):\n${big.map((b) => `  ${b.path}  ${(b.bytes / 1024).toFixed(0)} KiB`).join("\n")}`);
  }
}
