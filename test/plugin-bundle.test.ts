/**
 * THE PLUGIN BUNDLE (tools/plugin-bundle/build.ts): the Claude Code plugin as a
 * folder of its own, for a repository whose root is the plugin and for
 * Anthropic's plugin directory. These hold the file set the generator traces,
 * what it must never carry, the directory's 512-file limit, and that the
 * bundle's version is this repository's. `tools/plugin-loop/run.sh --bundle`
 * installs a generated bundle as a real plugin in a throwaway home.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUNDLE_LOCKFILE,
  INVISIBLE,
  DIRECTORY_DROPPED,
  DIRECTORY_ENTRIES,
  DASHBOARD_WEB,
  DIRECTORY_SHEBANG,
  EXTRA_KEYWORDS,
  FIRST_SPLIT_RELEASE,
  JOINED_SHEET_FLAVORS,
  JOINED_SHEET_URL,
  LISTING,
  MAX_FILES,
  MAX_INSPECTED_BYTES,
  MODEL_PACKAGE,
  REPO,
  bundleManifest,
  bundlePaths,
  directoryModules,
  driftLines,
  escapeInvisible,
  joinSheets,
  largeFiles,
  mirrorProblems,
  planBundle,
  sheetProblems,
  traceFiles,
  transpileSource,
  transpiledPath,
  versionAtLeast,
  writeBundle,
} from "../tools/plugin-bundle/build.js";
import { embeddedFiles } from "../tools/single-binary/build.js";
import { resolveStatic } from "../src/adapters/dashboard/web/static.js";

const repoJson = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(REPO, rel), "utf8")) as Record<string, unknown>;

const plan = planBundle();
const paths = bundlePaths(plan);

/** The margin each flavor keeps under the directory's MAX_FILES, so a merge
 *  that adds files fails here before a release fails the directory.
 *  510 for full and directory (2026-10-21): full was 503 before wave 2, 509
 *  after. Both still carry the sidebar: full is the one plugin before the split
 *  (the tripwire refuses it from FIRST_SPLIT_RELEASE on, and its margin binds
 *  only below that version), directory the held
 *  submission. From the split (#547, 0.3.32) our marketplace ships core and
 *  sidebar instead: core was 451 and sidebar 63 on 2026-10-22. Core keeps 480,
 *  room for a wave or two of new modules (wave 2 added ~7) that still leaves
 *  it 32 under the limit should it become what the directory gets; sidebar
 *  keeps 100, its own bundle and nowhere near the limit, so it only catches a
 *  trace that suddenly pulls in far more than hooks/sidebar/. Directory was
 *  back at 510 on 2026-10-29; joining the dashboard's stylesheets (2026-10-30)
 *  took it to 487. */
const FILE_MARGIN = 510;
const MARGINS: Record<string, number> = { full: FILE_MARGIN, directory: FILE_MARGIN, core: 480, sidebar: 100 };
const withinMargin = (flavor: string, count: number): void => {
  const margin = MARGINS[flavor] ?? FILE_MARGIN;
  if (count > margin) {
    throw new Error(`the ${flavor} flavor holds ${count} files, over its ${margin} margin (limit ${MAX_FILES})`);
  }
};

describe("the file set", () => {
  test("holds what Claude Code reads and what the launcher, hooks, server, console, sidebar and dashboard run", () => {
    for (const f of [
      ".claude-plugin/plugin.json",
      ".claude-plugin/binaries.json",
      "hooks/hooks.json",
      "commands/doctor.md",
      "src/adapters/plugin-run.sh",
      "src/adapters/empty-bunfig.toml",
      "src/adapters/launch.mjs",
      "src/adapters/node-hooks.mjs",
      "src/adapters/claude-code/bin/hook.mjs",
      "src/adapters/claude-code/bin/hook.ts",
      "src/adapters/claude-code/bin/runner.ts",
      "src/adapters/claude-code/bin/nightly.ts",
      "src/adapters/mcp/bin/serve.mjs",
      "src/adapters/mcp/bin/serve.ts",
      "src/adapters/cli/bin/counterparts.mjs",
      "src/adapters/cli/bin/counterparts.ts",
      "src/core/counterpart.ts",
      "hooks/sidebar/hooks/register.tsx",
      "hooks/sidebar/hooks/body.tsx",
      "hooks/sidebar/types/index.d.ts",
      "src/adapters/dashboard/web/server.ts",
      "src/adapters/dashboard/web/app.html",
      "src/adapters/dashboard/web/app.js",
      "LICENSE",
      "README.md",
      "package.json",
      "package-lock.json",
    ]) {
      expect(paths).toContain(f);
    }
  });

  test("the dashboard's page carries every static file the single binary embeds", () => {
    // Two independent ways of naming the files the code reads from its install:
    // the binary's directory rule and the bundle's trace from app.html.
    const embedded = embeddedFiles().filter((f) => f !== "package.json" && !f.startsWith("node_modules/"));
    expect(embedded.length).toBeGreaterThan(50);
    for (const f of embedded) expect(paths).toContain(f);
  });

  test("the trace finds no import it cannot resolve and no package the bundle does not install", () => {
    expect(traceFiles().problems).toEqual([]);
  });

  test("no tests, no module docs, no dev tooling, no system files, no package-manager config", () => {
    const bad = paths.filter((p) =>
      /(^|\/)(NOTES|CONTRACT|INTERFACE-GAPS|CLAUDE)\.md$|\.test\.[cm]?[jt]sx?$|(^|\/)tests?\/|^(test|tools|docs|changelog\.d|\.github)\/|\.DS_Store$|(^|\/)(bunfig\.toml|\.npmrc|tsconfig\.json)$|^bin\//.test(p),
    );
    expect(bad).toEqual([]);
    // The sidebar's own plugin folder (its checks) stays in the repository;
    // only its fox frames ride with the modules and types.
    expect(paths.filter((p) => p.startsWith("hooks/sidebar/") && !/^hooks\/sidebar\/(hooks|types)\/|^hooks\/sidebar\/art\/fox\/[^/]+\.png$/.test(p))).toEqual([]);
  });

  test("the sidebar's fox frames (read by path, not imported) ride in the bundle", () => {
    const frames = readdirSync(join(REPO, "hooks/sidebar/art/fox")).filter((n) => n.endsWith(".png"));
    expect(frames.length).toBeGreaterThan(30);
    for (const f of frames) expect(paths).toContain(`hooks/sidebar/art/fox/${f}`);
  });

  test(`stays within the ${FILE_MARGIN}-file margin under the directory's ${MAX_FILES}, while it is what ships`, () => {
    // From the split on nothing ships the full flavor (build.ts refuses it; the
    // directory flavor and core are measured on their own), so neither its
    // margin nor the limit binds it then: it is the set core is cut from.
    if (!versionAtLeast(plan.version, FIRST_SPLIT_RELEASE)) {
      withinMargin("full", paths.length);
      expect(paths.length).toBeLessThanOrEqual(MAX_FILES);
    }
    // The builder says, without refusing, when the full flavor nears the limit; nothing else.
    expect(plan.warnings.filter((w) => !/^\d+ files, near the directory's \d+$/.test(w))).toEqual([]);
    expect(paths.length).toBeGreaterThan(100);
  });

  test("the split's two plugins, core and sidebar, stay within their margins", () => {
    for (const flavor of ["core", "sidebar"] as const) {
      const p = planBundle(REPO, flavor);
      const count = bundlePaths(p).length;
      withinMargin(flavor, count);
      expect(count).toBeLessThanOrEqual(MAX_FILES);
      expect(p.warnings.filter((w) => !/^\d+ files, near the directory's \d+$/.test(w))).toEqual([]);
    }
  });
});

describe("the generated files", () => {
  const manifest = JSON.parse(plan.generated[".claude-plugin/plugin.json"]!) as Record<string, unknown>;
  const pkg = JSON.parse(plan.generated["package.json"]!) as { version: string; type: string; dependencies: Record<string, string> };

  test("the version is this repository's: package.json, plugin.json and binaries.json agree", () => {
    const version = repoJson("package.json")["version"];
    expect(plan.version).toBe(version as string);
    expect(manifest["version"]).toBe(version);
    expect(pkg.version).toBe(version as string);
    expect(repoJson(".claude-plugin/binaries.json")["version"]).toBe(version);
  });

  test("the manifest follows whatever version it is given (a release regenerates it)", () => {
    const next = JSON.parse(bundleManifest(REPO, "9.8.7")) as Record<string, unknown>;
    expect(next["version"]).toBe("9.8.7");
  });

  test("the manifest keeps the repository's components and adds the directory listing fields", () => {
    const repo = repoJson(".claude-plugin/plugin.json");
    for (const k of ["name", "displayName", "description", "author", "license", "homepage", "repository", "types", "mcpServers"]) {
      expect(manifest[k]).toEqual(repo[k]);
    }
    for (const [k, v] of Object.entries(LISTING)) {
      expect(manifest[k]).toBe(v);
      if (k !== "icon") expect(v.startsWith("https://")).toBe(true);
    }
    // The icon: an image inside the plugin, by its path from the plugin root.
    expect(manifest["icon"]).toBe("./icon.png");
    expect(paths).toContain("icon.png");
    expect(plan.placed["icon.png"]).toBe(".claude-plugin/icon.png");
    expect(readFileSync(join(REPO, ".claude-plugin/icon.png")).subarray(1, 4).toString()).toBe("PNG");
    const keywords = manifest["keywords"] as string[];
    for (const k of [...(repo["keywords"] as string[]), ...EXTRA_KEYWORDS]) expect(keywords).toContain(k);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  test("package.json names only the embedding table, at an exact version, and one npm lockfile pins the same", () => {
    expect(Object.keys(pkg.dependencies)).toEqual([MODEL_PACKAGE]);
    const pinned = pkg.dependencies[MODEL_PACKAGE]!;
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.type).toBe("module");
    // One lockfile: Claude Code uses the first of bun.lock, npm-shrinkwrap.json,
    // package-lock.json and never falls back, so a second would decide instead.
    expect(BUNDLE_LOCKFILE).toBe("package-lock.json");
    expect(paths.filter((p) => /^(bun\.lockb?|npm-shrinkwrap\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p))).toEqual([BUNDLE_LOCKFILE]);
    const lock = JSON.parse(plan.generated[BUNDLE_LOCKFILE]!) as {
      lockfileVersion: number;
      version: string;
      packages: Record<string, { version?: string; resolved?: string; integrity?: string; dependencies?: Record<string, string> }>;
    };
    // npm 7+ format (Claude Code reads lockfileVersion 2 or 3), same dependencies as package.json.
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.version).toBe(plan.version);
    expect(lock.packages[""]!.dependencies).toEqual(pkg.dependencies);
    expect(Object.keys(lock.packages).sort()).toEqual(["", `node_modules/${MODEL_PACKAGE}`]);
    const entry = lock.packages[`node_modules/${MODEL_PACKAGE}`]!;
    expect(entry.version).toBe(pinned);
    // A registry package over https, pinned by integrity — the integrity this
    // repository's own bun.lock pins.
    expect(entry.resolved).toBe(`https://registry.npmjs.org/${MODEL_PACKAGE}/-/${MODEL_PACKAGE}-${pinned}.tgz`);
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/=]+$/);
    expect(readFileSync(join(REPO, "bun.lock"), "utf8")).toContain(entry.integrity!);
  });

  test("the README is long enough for the directory and discloses what the plugin fetches", () => {
    const readme = plan.generated["README.md"]!;
    const words = readme.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(40);
    expect(readme).toContain(MODEL_PACKAGE);
    expect(readme).toContain("COUNTERPARTS_BINARY_DOWNLOAD=off");
  });
});

describe("writing it", () => {
  let work = "";
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-bundle-")));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  const walk = (dir: string, base = ""): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const rel = base === "" ? e.name : `${base}/${e.name}`;
      return e.isDirectory() ? walk(join(dir, e.name), rel) : [rel];
    });

  test("writes exactly the planned files, as regular files, and names the large ones", () => {
    const out = join(work, "bundle");
    writeBundle(plan, out);
    const written = walk(out).sort();
    expect(written).toEqual(paths);
    for (const f of written) expect(lstatSync(join(out, f)).isFile()).toBe(true);
    expect(JSON.parse(readFileSync(join(out, ".claude-plugin/plugin.json"), "utf8")).version).toBe(plan.version);
    // Listed for the report; splitting them is another lane's.
    for (const big of largeFiles(out, written)) expect(big.bytes).toBeGreaterThan(256 * 1024);
  });

  test("regenerates over a previous bundle and keeps its .git", () => {
    const out = join(work, "bundle");
    writeBundle(plan, out);
    mkdirSync(join(out, ".git"));
    writeFileSync(join(out, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(out, "stale.txt"), "from an older bundle");
    writeBundle(plan, out);
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
    expect(readFileSync(join(out, ".git", "HEAD"), "utf8")).toContain("main");
    expect(existsSync(join(out, ".claude-plugin/plugin.json"))).toBe(true);
  });

  test("refuses a folder that holds something else, and this repository itself", () => {
    const other = join(work, "other");
    mkdirSync(other);
    writeFileSync(join(other, "keep.txt"), "not a bundle");
    expect(() => writeBundle(plan, other)).toThrow(/not empty and not a previous bundle/);
    expect(readFileSync(join(other, "keep.txt"), "utf8")).toBe("not a bundle");
    expect(() => writeBundle(plan, REPO)).toThrow(/inside this repository/);
    expect(() => writeBundle(plan, join(REPO, "dist", "bundle"))).toThrow(/inside this repository/);
  });
});

/**
 * THE DIRECTORY FLAVOR (`--flavor directory`): the same file set, its
 * TypeScript under `src/` transpiled one for one, the three entries Claude
 * Code runs started by their own shebang, no launcher and no binary. The
 * proof that Claude Code starts them from an installed copy is
 * `tools/plugin-loop/run.sh --bundle=directory`.
 */
describe("the directory flavor", () => {
  const dir = planBundle(REPO, "directory");
  const dirPaths = bundlePaths(dir);
  const full = new Set(paths);

  test("mirrors the full flavor's tree: each src/ .ts as its .js at the same path, everything else as it is", () => {
    const expected = new Set(
      paths
        .filter((p) => !/^src\/adapters\/(plugin-run\.sh|launch\.mjs|node-hooks\.mjs)$|\/bin\/[a-z-]+\.mjs$|^\.claude-plugin\/binaries\.json$/.test(p))
        // The directory's hooks module is the sidebar alone: no speak-first, no actions (2026-10-16), and no full.tsx joining them.
        .filter((p) => !/^hooks\/sidebar\/hooks\/(full|speak-first|actions)\.tsx$/.test(p))
        // The dashboard's brain picture and its three.js stay out (DIRECTORY_DROPPED).
        .filter((p) => !DIRECTORY_DROPPED.includes(p))
        // The dashboard's sheets ride as one (joinSheets, "one stylesheet" below).
        .filter((p) => !(p.startsWith(`${DASHBOARD_WEB}/`) && p.endsWith(".css")))
        .map((p) => (p.startsWith("src/") && p.endsWith(".ts") && !p.endsWith(".d.ts") ? transpiledPath(p) : p)),
    );
    expected.add(`${DASHBOARD_WEB}${JOINED_SHEET_URL}`);
    expect(dirPaths).toEqual([...expected].sort());
    expect(paths).toContain("hooks/sidebar/hooks/speak-first.tsx");
    expect(dirPaths).not.toContain("hooks/sidebar/hooks/speak-first.tsx");
    expect(dirPaths.filter((p) => p.startsWith("src/") && /\.tsx?$/.test(p))).toEqual([]);
    // The dashboard's server-side modules are transpiled; its browser files ride as they are.
    expect(dirPaths).toContain("src/adapters/dashboard/web/server.js");
    expect(dirPaths).toContain("src/adapters/dashboard/web/views/memories.js");
    expect(dir.copied).toContain("src/adapters/dashboard/web/app.js");
    // The sidebar stays TypeScript: Claude Code compiles a hooks module itself.
    expect(dir.copied).toContain("hooks/sidebar/hooks/register.tsx");
    expect(full.has("hooks/sidebar/hooks/register.tsx")).toBe(true);
    // The empty bunfig is still carried: the processes the entries start name it.
    expect(dirPaths).toContain("src/adapters/empty-bunfig.toml");
  });

  test("no launcher, no binary checksums, no Node loader, no .mjs shims", () => {
    for (const gone of ["src/adapters/plugin-run.sh", ".claude-plugin/binaries.json", "src/adapters/node-hooks.mjs", "src/adapters/launch.mjs"]) {
      expect(dirPaths).not.toContain(gone);
    }
    expect(dirPaths.filter((p) => p.endsWith(".mjs"))).toEqual([]);
    // The roots Claude Code reads name no launcher (the code still knows one, for the full flavor).
    for (const [f, text] of Object.entries(dir.generated)) if (!f.startsWith("src/")) expect(text).not.toContain("plugin-run.sh");
  });

  test("the three entries start with the shebang and are written executable; nothing else is", () => {
    expect(dir.executable).toEqual(Object.values(DIRECTORY_ENTRIES).sort());
    expect(DIRECTORY_SHEBANG).toBe("#!/usr/bin/env -S bun --no-env-file --config=/dev/null --no-install");
    for (const entry of Object.values(DIRECTORY_ENTRIES)) {
      expect(dir.generated[entry]!.split("\n")[0]).toBe(DIRECTORY_SHEBANG);
      // Transpiled: the main-script guard kept, no type left.
      expect(dir.generated[entry]).toContain("isEntryPoint(process.argv[1], import.meta.url)");
      expect(dir.generated[entry]).not.toMatch(/import type /);
    }
  });

  test("plugin.json, hooks.json and the commands run the entries by path", () => {
    const manifest = JSON.parse(dir.generated[".claude-plugin/plugin.json"]!) as { mcpServers: Record<string, unknown>; icon: string };
    expect(manifest.mcpServers["counterparts"]).toEqual({ command: "${CLAUDE_PLUGIN_ROOT}/src/adapters/mcp/bin/serve.js", args: [] });
    expect(manifest.icon).toBe("./icon.png");
    const hooks = JSON.parse(dir.generated["hooks/hooks.json"]!) as { hooks: Record<string, { hooks: unknown[] }[]>; modules: string[] };
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"]);
    for (const groups of Object.values(hooks.hooks)) {
      for (const h of groups.flatMap((g) => g.hooks)) {
        expect(h).toEqual({ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/src/adapters/claude-code/bin/hook.js", args: [] });
      }
    }
    expect(hooks.modules).toEqual(["./sidebar/hooks/register.tsx"]);
    const cli = '"${CLAUDE_PLUGIN_ROOT}/src/adapters/cli/bin/counterparts.js"';
    expect(dir.generated["commands/doctor.md"]).toContain(`Bash(${cli} doctor)`);
    expect(dir.generated["commands/dashboard.md"]).toContain(`${cli} dashboard`);
    expect(dir.generated["commands/uninstall.md"]).toContain(`${cli} uninstall --keep-memories --json`);
    // Step 4 builds the terminal line from the console's path, not `sh` and a launcher.
    expect(dir.generated["commands/uninstall.md"]).toContain('"/full/path/to/src/adapters/cli/bin/counterparts.js" "uninstall" "--config"');
    expect(dir.generated["commands/uninstall.md"]).not.toMatch(/`sh`|launcher/);
    expect(dir.generated["commands/meet.md"]).toBe(readFileSync(join(REPO, "commands/meet.md"), "utf8"));
  });

  test("hooks modules: the directory flavor carries the sidebar alone; the full flavor every module hooks.json lists", () => {
    // As data, so it holds before and after hooks.json names `full.tsx` (register + speak-first).
    expect(directoryModules(["./sidebar/hooks/full.tsx"])).toEqual(["./sidebar/hooks/register.tsx"]);
    expect(directoryModules(["./sidebar/hooks/register.tsx"])).toEqual(["./sidebar/hooks/register.tsx"]);
    expect(directoryModules([])).toEqual([]);
    const hooks = JSON.parse(dir.generated["hooks/hooks.json"]!) as { modules: string[] };
    expect(hooks.modules).toEqual(["./sidebar/hooks/register.tsx"]);
    expect(dirPaths.filter((p) => /speak-first|sidebar\/hooks\/full\.tsx/.test(p))).toEqual([]);
    expect(dirPaths.filter((p) => p.startsWith("hooks/sidebar/art/fox/")).length).toBeGreaterThan(30);
    // The full flavor copies hooks.json as it is, and traces every module it lists.
    const repoModules = (JSON.parse(readFileSync(join(REPO, "hooks/hooks.json"), "utf8")) as { modules: string[] }).modules;
    expect(plan.copied).toContain("hooks/hooks.json");
    for (const m of repoModules) expect(paths).toContain(join("hooks", m));
  });

  test("once hooks.json names full.tsx (register + speak-first): the full flavor traces all three, the directory flavor register alone", () => {
    const mini = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-modules-")));
    try {
      const put = (rel: string, text: string): void => {
        mkdirSync(join(mini, rel, ".."), { recursive: true });
        writeFileSync(join(mini, rel), text);
      };
      put(".claude-plugin/plugin.json", JSON.stringify({ name: "counterparts" }));
      put("hooks/hooks.json", JSON.stringify({ hooks: {}, modules: ["./sidebar/hooks/full.tsx"] }));
      mkdirSync(join(mini, "commands"));
      put("hooks/sidebar/hooks/full.tsx", 'import register from "./register";\nimport speakFirst from "./speak-first";\nexport default [register, speakFirst];\n');
      put("hooks/sidebar/hooks/register.tsx", "export default 1;\n");
      put("hooks/sidebar/hooks/speak-first.tsx", "export default 2;\n");
      put("hooks/sidebar/art/fox/idle-0.png", "png");
      const sidebar = (files: string[]): string[] => files.filter((f) => f.startsWith("hooks/sidebar/"));
      expect(sidebar(traceFiles(mini, "full").files)).toEqual([
        "hooks/sidebar/art/fox/idle-0.png",
        "hooks/sidebar/hooks/full.tsx",
        "hooks/sidebar/hooks/register.tsx",
        "hooks/sidebar/hooks/speak-first.tsx",
      ]);
      expect(sidebar(traceFiles(mini, "directory").files)).toEqual(["hooks/sidebar/art/fox/idle-0.png", "hooks/sidebar/hooks/register.tsx"]);
    } finally {
      rmSync(mini, { recursive: true, force: true });
    }
  });

  test("the README says Bun 1.3+ near the top, and nothing of the launcher or the binary", () => {
    const readme = dir.generated["README.md"]!;
    expect(readme.indexOf("Requires Bun 1.3+")).toBeGreaterThan(0);
    expect(readme.indexOf("Requires Bun 1.3+")).toBeLessThan(readme.indexOf("## Install"));
    expect(readme).toContain("Install it from [bun.sh](https://bun.sh)");
    // No download-and-run command (the validator warns on one): no piped install, in either flavor.
    for (const r of [readme, plan.generated["README.md"]!]) expect(r).not.toMatch(/\b(curl|wget)\b[^\n]*\|\s*(ba|z)?sh\b/);
    expect(readme).toContain("Claude Code only (the terminal and the Desktop app's Code tab)");
    expect(readme).toContain(MODEL_PACKAGE);
    expect(readme).not.toMatch(/plugin-run\.sh|binaries\.json|COUNTERPARTS_BINARY_DOWNLOAD|<!--/);
    // The full flavor's README: the binary and the launcher, no Bun requirement, no template notes.
    const fullReadme = plan.generated["README.md"]!;
    expect(fullReadme).toContain("plugin-run.sh");
    expect(fullReadme).toContain("Claude Code only (the terminal and the Desktop app's Code tab)");
    expect(fullReadme).not.toMatch(/Requires Bun 1\.3\+|<!--/);
  });

  test("within the directory's limits: file count, and no file over 256 KiB at all", () => {
    withinMargin("directory", dirPaths.length);
    expect(dirPaths.length).toBeLessThanOrEqual(MAX_FILES);
    // The "near 512" line is build output, not a failure; any other warning is.
    expect(dir.warnings.filter((w) => !/^\d+ files, near the directory's \d+$/.test(w))).toEqual([]);
    const sizes = [
      ...Object.entries(dir.generated).map(([f, text]) => [f, Buffer.byteLength(text)] as const),
      ...dir.copied.map((f) => [f, lstatSync(join(REPO, f)).size] as const),
      ...Object.entries(dir.placed).map(([f, from]) => [f, lstatSync(join(REPO, from)).size] as const),
    ];
    expect(sizes.length).toBe(dirPaths.length);
    expect(sizes.filter(([, bytes]) => bytes > MAX_INSPECTED_BYTES)).toEqual([]);
  });

  test("no three.js and no brain picture: the dashboard draws its home tab without them", () => {
    expect(dirPaths.filter((p) => /three|pages\/home\/brain\.js$/i.test(p))).toEqual([]);
    for (const f of DIRECTORY_DROPPED.filter((d) => d.includes("/dashboard/"))) expect(paths).toContain(f);
    // The page module that loads the picture rides, and loads it only when the server says it is there.
    expect(dirPaths).toContain("src/adapters/dashboard/web/pages/home/sections/brain.js");
    const section = readFileSync(join(REPO, "src/adapters/dashboard/web/pages/home/sections/brain.js"), "utf8");
    expect(section).not.toMatch(/^import[^\n]*["']\.\.\/brain\.js["']/m);
    expect(section).toContain('import("../brain.js")');
  });

  test("no invisible or control character in any .js the directory flavor carries (the validator holds one)", () => {
    const js = dirPaths.filter((p) => p.endsWith(".js"));
    expect(js.length).toBeGreaterThan(300);
    const found = js.filter((p) => (dir.generated[p] ?? readFileSync(join(REPO, p), "utf8")).search(INVISIBLE) >= 0);
    expect(found).toEqual([]);
    // The one that set it off: cli/ui.ts's DEL, escaped in the source, cooked by the transpiler, escaped again.
    expect(dir.generated["src/adapters/cli/ui.js"]).toContain('const DEL = "\\u007F"');
  });

  test("invisible characters come out as \\uXXXX, meaning the same in strings and templates; regexes and String.raw as written", () => {
    const source = [
      'const a: string = "x\\x7f\\u200b\\u00ad\\ufeff";',
      "const b = `t\\x7f${1}\\u2060`;",
      "const c = /\\x7f[\\u2060-\\u2064]/;",
      "const d = String.raw`\\x7f`;",
      "const e = '\\\\x7f';",
    ].join("\n");
    const out = transpileSource(source);
    expect(out.search(INVISIBLE)).toBe(-1);
    const run = (code: string): unknown[] => new Function(`${code}\nreturn [a, b, c.source, c.test("\\x7f"), d, e];`)() as unknown[];
    expect(run(out)).toEqual(run(new Bun.Transpiler({ loader: "ts" }).transformSync(source)));
    expect(run(out)[0]).toBe("x\u007f​­﻿");
    expect(escapeInvisible('"a\u007fb"')).toBe('"a\\u007Fb"');
    expect(() => escapeInvisible('"a\\\u007fb"')).toThrow(/backslash before an invisible character/);
  });

  describe("one stylesheet", () => {
    const sheetLinks = (html: string): string[] => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]!);
    const source = readFileSync(join(REPO, `${DASHBOARD_WEB}/app.html`), "utf8");
    const urls = sheetLinks(source);
    const page = dir.generated[`${DASHBOARD_WEB}/app.html`]!;
    const css = dir.generated[`${DASHBOARD_WEB}${JOINED_SHEET_URL}`]!;
    const sheet = (url: string): string => readFileSync(join(REPO, DASHBOARD_WEB, url), "utf8");

    test("the page links exactly that one sheet, and everything else in it is as it was", () => {
      expect(urls.length).toBeGreaterThan(1);
      expect(sheetLinks(page)).toEqual([JOINED_SHEET_URL]);
      expect(page.match(/rel=["']?stylesheet/g)).toHaveLength(1);
      // Back again: put the links where the one stands, and it is the source's page.
      const links = urls.map((u) => `<link rel="stylesheet" href="${u}">\n`).join("");
      expect(page.replace(`<link rel="stylesheet" href="${JOINED_SHEET_URL}">\n`, links)).toBe(source);
      // What the server replaces by exact text, and the font's preload, are still there.
      expect(page).toContain(`<meta name="counterparts-brain" content="on">`);
      expect(page).toContain(`<meta name="counterparts-action-token" content="">`);
      expect(page).toContain(`<link rel="preload" href="/shared/fonts/outfit-latin-wght.woff2"`);
    });

    test("the sheet holds every source sheet, whole, in the page's order, and nothing else but the names", () => {
      let at = 0;
      let bytes = css.indexOf("/* /shared/");
      expect(bytes).toBeGreaterThan(0);
      for (const url of urls) {
        const piece = `/* ${url} */\n${sheet(url)}`;
        const found = css.indexOf(piece, at);
        expect(found).toBeGreaterThanOrEqual(at);
        at = found + piece.length;
        bytes += piece.length + (sheet(url).endsWith("\n") ? 0 : 1);
      }
      expect(css.length).toBe(bytes);
    });

    test("the sheet is where the server hands it out; the separate sheets are gone from the flavor, not from any other", () => {
      expect(resolveStatic(JOINED_SHEET_URL, "/web")?.contentType).toBe("text/css; charset=utf-8");
      expect(existsSync(join(REPO, DASHBOARD_WEB, JOINED_SHEET_URL))).toBe(false);
      expect(dirPaths.filter((p) => p.startsWith(`${DASHBOARD_WEB}/`) && p.endsWith(".css"))).toEqual([`${DASHBOARD_WEB}${JOINED_SHEET_URL}`]);
      for (const url of urls) expect(paths).toContain(`${DASHBOARD_WEB}${url}`);
      expect(plan.generated[`${DASHBOARD_WEB}${JOINED_SHEET_URL}`]).toBeUndefined();
      // The fonts come from the sheets' url()s, so the trace had to read the sheets first.
      expect(dirPaths.filter((p) => p.endsWith(".woff2"))).toHaveLength(3);
      expect(dirPaths.filter((p) => /shared\/fonts\/OFL-/.test(p))).toHaveLength(2);
    });

    test("written: the file is on disk, and the page links it", () => {
      const work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-sheet-")));
      try {
        const out = join(work, "bundle");
        writeBundle(dir, out);
        expect(sheetLinks(readFileSync(join(out, DASHBOARD_WEB, "app.html"), "utf8"))).toEqual([JOINED_SHEET_URL]);
        expect(readFileSync(join(out, DASHBOARD_WEB, JOINED_SHEET_URL), "utf8")).toBe(css);
        expect(existsSync(join(out, DASHBOARD_WEB, "shared/tokens.css"))).toBe(false);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });

    test("a sheet that would mean something else beside others is named", () => {
      expect(sheetProblems("a", ".a{color:red}\n/* note */\n")).toEqual([]);
      expect(sheetProblems("a", '.a{content:"}/*"}\n@font-face{src:url("/f.woff2")}\n.b{background:url(data:image/png;base64,AA)}\n')).toEqual([]);
      expect(sheetProblems("a", ".a{color:red}\n/* open")).toEqual(["a leaves a comment open"]);
      expect(sheetProblems("a", ".a{color:red")).toEqual(["a has unbalanced braces", "a has text after its last rule: .a{color:red"]);
      expect(sheetProblems("a", '.a{content:"x}\n')).toEqual(["a leaves a string open", "a has unbalanced braces", "a has text after its last rule: .a{content:"]);
      expect(sheetProblems("a", ".a{color:red}\n.b")).toEqual(["a has text after its last rule: .b"]);
      expect(sheetProblems("a", '@import "x.css";\n')).toEqual(['a has text after its last rule: @import "x.css";', "a uses @import"]);
      expect(sheetProblems("a", '@charset "utf-8";\n.a{}')).toEqual(["a uses @charset"]);
      expect(sheetProblems("a", ".a{background:url(./x.png)}")).toEqual(["a has a relative url(): ./x.png"]);
      expect(sheetProblems("a", ".a{background:url('fonts/x.woff2')}")).toEqual(["a has a relative url(): fonts/x.woff2"]);
      // An opener left open eats the next sheet's rules in a real parser, braces balanced or not.
      expect(sheetProblems("a", ".a{width:calc(1px}\n")).toEqual(["a leaves a ( open"]);
      expect(sheetProblems("a", ".a{background:url(/x.png}\n")).toEqual(["a leaves a ( open"]);
      expect(sheetProblems("a", ".a[x{color:red}\n")).toEqual(["a leaves a [ open"]);
      expect(sheetProblems("a", ".a[x]{width:calc((1px + 2px) * 2)}\n")).toEqual([]);
      expect(sheetProblems("a", "﻿.a{}")).toEqual(["a holds an invisible character"]);
      // Only comments mention these, so nothing is wrong.
      expect(sheetProblems("a", "/* @import url(x) */ .a{}")).toEqual([]);
    });

    test("joining names what it cannot do, and is the same bytes every time", () => {
      const read = (u: string): string | null => (u === "/a.css" ? ".a{}\n" : u === "/b.css" ? ".b{}" : null);
      const html = '<link rel="preload" href="/f" as="font">\n<script></script>\n<link rel="stylesheet" href="/b.css">\n<link href="/a.css" rel="stylesheet">\n<p></p>\n';
      const one = joinSheets(html, read);
      expect(one.problems).toEqual([]);
      expect(one.urls).toEqual(["/b.css", "/a.css"]);
      expect(one.page).toBe(`<link rel="preload" href="/f" as="font">\n<script></script>\n<link rel="stylesheet" href="${JOINED_SHEET_URL}">\n<p></p>\n`);
      expect(one.css.endsWith("/* /b.css */\n.b{}\n/* /a.css */\n.a{}\n")).toBe(true);
      expect(joinSheets(html, read)).toEqual(one);
      expect(joinSheets("<p>no sheets</p>\n", read).problems).toEqual(["app.html links no stylesheet to join"]);
      expect(joinSheets('<link rel="stylesheet" href="/gone.css">\n', read).problems).toEqual(["app.html links /gone.css, which is not a file"]);
      // On one line with something else: not recognised, and refused rather than left as a second sheet.
      expect(joinSheets('<link rel="stylesheet" href="/a.css">\n<p><link rel="stylesheet" href="/b.css"></p>\n', read).problems).toEqual([
        "app.html would link 2 stylesheets after the join: a link this did not recognise",
      ]);
      // What the join would lose, or move a sheet across.
      expect(joinSheets('<link rel="stylesheet" href="/a.css" media="print">\n', read).problems).toEqual(['app.html\'s link to /a.css also says media="print", which the join would lose']);
      expect(joinSheets('<link id="t" rel="stylesheet" href="/a.css" disabled>\n', read).problems).toEqual(['app.html\'s link to /a.css also says id="t" disabled, which the join would lose']);
      expect(joinSheets('<link rel="stylesheet" href="/a.css">\n<style>.x{}</style>\n<link rel="stylesheet" href="/b.css">\n', read).problems).toEqual([
        "app.html has something between its stylesheet links: <style>.x{}</style>",
      ]);
      expect(joinSheets('<link rel="stylesheet" href="/a.css">\n<!--\n<link rel="stylesheet" href="/b.css">\n-->\n', read).problems).toEqual([
        "app.html has something between its stylesheet links: <!--",
      ]);
    });

    test("only the directory flavor joins, for now; core stays the full flavor less the sidebar", () => {
      expect(JOINED_SHEET_FLAVORS).toEqual(["directory"]);
      expect(planBundle(REPO, "core").copied).toContain(`${DASHBOARD_WEB}/app.html`);
    });
  });

  test("the mirror check names what breaks it", () => {
    expect(mirrorProblems(["src/a.ts"], [], {})).toEqual(["src/a.ts has no src/a.js"]);
    expect(mirrorProblems(["src/a.ts"], ["src/a.js"], { "src/a.js": "" })).toEqual(["src/a.js is both a transpiled source and a file carried as it is"]);
    expect(mirrorProblems([], ["src/b.ts"], {})).toEqual(["src/b.ts is TypeScript left in the transpiled tree"]);
    expect(mirrorProblems([], [], { "src/c.js": "" })).toEqual(["src/c.js is generated under src/ from no source"]);
  });

  describe("written", () => {
    let work = "";
    beforeEach(() => {
      work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-directory-")));
    });
    afterEach(() => {
      rmSync(work, { recursive: true, force: true });
    });

    test("the entries are executable, other files are not; the drift check passes, then names a change", () => {
      const out = join(work, "bundle");
      writeBundle(dir, out);
      for (const entry of Object.values(DIRECTORY_ENTRIES)) expect(lstatSync(join(out, entry)).mode & 0o111).toBe(0o111);
      expect(lstatSync(join(out, "src/adapters/claude-code/bin/runner.js")).mode & 0o111).toBe(0);
      expect(lstatSync(join(out, "README.md")).mode & 0o111).toBe(0);
      expect(driftLines(dir, out)).toEqual([]);
      writeFileSync(join(out, "src/core/types.js"), "// changed\n");
      writeFileSync(join(out, "stale.txt"), "x");
      rmSync(join(out, "icon.png"));
      expect(driftLines(dir, out).sort()).toEqual(["differs  src/core/types.js", "extra    stale.txt", "missing  icon.png"]);
    });

    // THE OWNER'S DECISION (2026-10-14): the directory's build never opens
    // ~/.claude.json. Here that file is a FIFO with no writer, which any read
    // would block on forever; the written tree's readers of it must all return.
    test("the written tree never opens ~/.claude.json: every reader of it returns past a FIFO no read could get past", () => {
      const out = join(work, "bundle");
      writeBundle(dir, out);
      const home = join(work, "home");
      const project = join(home, "project");
      mkdirSync(join(home, ".claude"), { recursive: true });
      mkdirSync(project, { recursive: true });
      const hook = `"${process.execPath}" run "${join(out, "src/adapters/claude-code/bin/hook.js")}"`;
      writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: hook }] }] } }));
      expect(spawnSync("mkfifo", [join(home, ".claude.json")]).status).toBe(0);
      // The npm install's marker (`npm-live.ts`): what this build stands down by instead.
      const serve = join(out, "src/adapters/mcp/bin/serve.js");
      mkdirSync(join(home, ".counterparts"), { recursive: true });
      writeFileSync(join(home, ".counterparts", "claude-code.json"), "{}");
      const marker = {
        version: 1,
        build: "0.3.25",
        claudeConfigDir: null,
        writtenAt: Date.now(),
        hooks: { file: join(home, ".claude", "settings.json"), command: hook },
        server: { file: join(home, ".claude.json"), scope: "user", exe: process.execPath, script: serve, command: `${process.execPath} run ${serve}` },
      };
      writeFileSync(join(home, ".counterparts", "npm-live.json"), JSON.stringify(marker));
      const probe = join(work, "probe.mjs");
      writeFileSync(
        probe,
        [
          "const [root, home, project] = process.argv.slice(2);",
          "const env = { PATH: process.env.PATH };",
          'const rt = await import(`${root}/src/adapters/runtime.js`);',
          'const hw = await import(`${root}/src/adapters/host-wiring.js`);',
          'const inst = await import(`${root}/src/adapters/cli/install.js`);',
          'const desk = await import(`${root}/src/adapters/cli/desktop.js`);',
          'const wire = await import(`${root}/src/adapters/cli/wire.js`);',
          'const nl = await import(`${root}/src/adapters/npm-live.js`);',
          'const pl = await import(`${root}/src/adapters/plugin.js`);',
          "console.log(JSON.stringify({",
          "  reads: rt.readsHostUserConfig(),",
          "  wiring: hw.npmWiring({ home, env, cwd: project }),",
          "  host: inst.readHost(home, project, env).mcpRead,",
          "  codeTab: desk.readDesktop(home, env).codeTab,",
          '  notRead: wire.readMcp(home, env, "", undefined, process.execPath).notRead,',
          '  gate: nl.npmWiringForGate({ home, env, cwd: project, configPath: `${home}/.counterparts/claude-code.json` }),',
          '  writes: nl.noteNpmLive({ configPath: `${home}/.counterparts/claude-code.json`, home, env, build: "x", force: true }),',
          '  stands: [pl.hookGate(nl.npmWiringForGate({ home, env, cwd: project, configPath: `${home}/.counterparts/claude-code.json` }), home).standDown,',
          '    pl.mcpGate(nl.npmWiringForGate({ home, env, cwd: project, configPath: `${home}/.counterparts/claude-code.json` }), home).standDown],',
          "}));",
        ].join("\n"),
      );
      const r = spawnSync(process.execPath, ["--no-install", probe, out, home, project], { encoding: "utf8", timeout: 30_000, cwd: work });
      expect(r.signal).toBeNull();
      expect(r.stderr).toBe("");
      expect(JSON.parse(r.stdout)).toEqual({
        reads: false,
        wiring: { hooks: [], mcp: [] },
        host: false,
        codeTab: false,
        notRead: true,
        gate: {
          hooks: [{ file: marker.hooks.file, event: "*", command: hook, live: true }],
          mcp: [{ file: marker.server.file, scope: "user", command: marker.server.command, live: true, exe: process.execPath, script: serve }],
        },
        stands: [true, true],
        writes: "skipped",
      });
    }, 60_000);
  });
});
