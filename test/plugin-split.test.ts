/**
 * TWO PLUGINS (2026-10-20, the split; tools/plugin-bundle/build.ts, "TWO
 * PLUGINS"): `--flavor core` is the full flavor less the sidebar, still named
 * `counterparts`; `--flavor sidebar` is the mod as `counterparts-sidebar`,
 * rooted at hooks/sidebar/, with core as its dependency and every `$.state`
 * owner written under its own name. The proof that Claude Code installs them,
 * the dependency included, is `tools/plugin-loop/split.sh`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CORE_PLUGIN,
  FIRST_SPLIT_RELEASE,
  REPO,
  SIDEBAR_DIR,
  SIDEBAR_PLUGIN,
  bundlePaths,
  bundleReadme,
  checkoutBranch,
  planBundle,
  sidebarLeftover,
  sidebarText,
  splitTripwire,
  versionAtLeast,
  writeBundle,
  type Plan,
} from "../tools/plugin-bundle/build.js";
import { sidebarBeside } from "../src/adapters/host-wiring.js";

const repoJson = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(REPO, rel), "utf8")) as Record<string, unknown>;
const json = (p: Plan, f: string): Record<string, unknown> => JSON.parse(p.generated[f]!) as Record<string, unknown>;

// Planned when a test first asks, not at load: a plan that throws (a version
// out of step after a bump, say) fails the tests that need it, not the file.
const once = <T>(make: () => T): (() => T) => {
  let made: { value: T } | null = null;
  return () => (made ??= { value: make() }).value;
};
const plans = {
  core: once(() => planBundle(REPO, "core")),
  sidebar: once(() => planBundle(REPO, "sidebar")),
  fullPaths: once(() => bundlePaths(planBundle(REPO, "full"))),
};
let core: Plan;
let corePaths: string[] = [];
let sidebar: Plan;
let sidebarPaths: string[] = [];
beforeEach(() => {
  // Each test names what it uses; these are the shorthands.
  try {
    core = plans.core();
    corePaths = bundlePaths(core);
  } catch {
    /* the tests that use core fail on their own */
  }
  try {
    sidebar = plans.sidebar();
    sidebarPaths = bundlePaths(sidebar);
  } catch {
    /* likewise */
  }
});

describe("core", () => {
  test("is the full flavor less the sidebar: same name, no module, no contract, nothing of hooks/sidebar/", () => {
    expect(corePaths).toEqual(plans.fullPaths().filter((p) => !p.startsWith(`${SIDEBAR_DIR}/`)));
    const m = json(core, ".claude-plugin/plugin.json");
    expect(m["name"]).toBe(CORE_PLUGIN);
    expect(m["types"]).toBeUndefined();
    expect(m["mcpServers"]).toEqual(repoJson(".claude-plugin/plugin.json")["mcpServers"]);
    expect(m["keywords"]).not.toContain("sidebar");
    const hooks = json(core, "hooks/hooks.json");
    expect(hooks["modules"]).toBeUndefined();
    expect(hooks["hooks"]).toEqual(repoJson("hooks/hooks.json")["hooks"]);
    expect(core.copied).not.toContain("hooks/hooks.json");
  });

  test("its README points at the sidebar plugin and keeps what the plugin fetches", () => {
    const readme = core.generated["README.md"]!;
    expect(readme).toContain("counterparts-sidebar@counterparts");
    expect(readme).not.toContain("What the sidebar does");
    expect(readme).not.toContain("hooks/sidebar/");
    expect(readme).not.toContain("fox");
    expect(readme).toContain("COUNTERPARTS_BINARY_DOWNLOAD=off");
    expect(readme).not.toMatch(/<!--|flavor:/);
  });
});

describe("the sidebar", () => {
  test("its own name, core as its dependency, its contract, and nothing that serves memory", () => {
    const m = json(sidebar, ".claude-plugin/plugin.json");
    expect(m["name"]).toBe(SIDEBAR_PLUGIN);
    expect(m["version"]).toBe(String(repoJson("package.json")["version"]));
    expect(m["dependencies"]).toEqual([{ name: CORE_PLUGIN, version: `>=${FIRST_SPLIT_RELEASE}` }]);
    expect(m["types"]).toBe("./types/index.d.ts");
    for (const k of ["mcpServers", "hooks", "commands", "userConfig"]) expect(m[k]).toBeUndefined();
    expect(sidebarPaths.filter((p) => /^(src|commands|node_modules)\/|^(package\.json|package-lock\.json|bun\.lock)$/.test(p))).toEqual([]);
    expect(JSON.parse(readFileSync(join(REPO, sidebar.placed["hooks/hooks.json"]!), "utf8"))).toEqual({ modules: ["./full.tsx"] });
    for (const f of ["hooks/full.tsx", "hooks/register.tsx", "hooks/speak-first.tsx", "hooks/actions.tsx", "types/index.d.ts", "README.md", "LICENSE", "icon.png"]) {
      expect(sidebarPaths).toContain(f);
    }
    const pngs = readdirSync(join(REPO, SIDEBAR_DIR, "art/fox")).filter((n) => n.endsWith(".png"));
    expect(pngs.length).toBeGreaterThan(0);
    for (const n of pngs) expect(sidebarPaths).toContain(`art/fox/${n}`);
  });

  test("every $.state owner and the contract are the sidebar plugin's; command names, the pane and core's commands stay", () => {
    const shipped = Object.entries(sidebar.generated).filter(([f]) => /\.tsx?$/.test(f));
    expect(shipped.length).toBeGreaterThan(10);
    for (const [f, text] of shipped) {
      expect(sidebarLeftover(text)).toBeNull();
      expect(text).toBe(sidebarText(readFileSync(join(REPO, SIDEBAR_DIR, f), "utf8")).text);
    }
    expect(sidebar.generated["types/index.d.ts"]).toContain(`interface PluginState {\n    '${SIDEBAR_PLUGIN}': {`);
    const register = sidebar.generated["hooks/register.tsx"]!;
    expect(register).toContain(`atom({ plugin: '${SIDEBAR_PLUGIN}', key: 'pulse' }`);
    expect(register).toContain("const PANE = 'counterparts'");
    expect(register).toContain("on('command.run', { command: 'counterparts' }");
    expect(sidebar.generated["hooks/speak-first.tsx"]).toContain(`e.origin.name === '${SIDEBAR_PLUGIN}'`);
    expect(sidebar.generated["hooks/words.ts"]).toContain("/counterparts:meet");
  });

  test("its dependency's floor is past every release that drew the sidebar itself (0.3.27 the last released)", () => {
    // A release at or past the floor that still drew the sidebar would meet the
    // range and give two panes: if the split slips a release, raise the floor.
    const [a, b, c] = FIRST_SPLIT_RELEASE.split(".").map(Number) as [number, number, number];
    expect(a * 1e6 + b * 1e3 + c).toBeGreaterThan(3 * 1e3 + 27);
  });

  test("its README says how to install it and that it brings counterparts", () => {
    const readme = sidebar.generated["README.md"]!;
    expect(readme).toContain("/plugin install counterparts-sidebar@counterparts");
    expect(readme).toContain("dependencies");
    expect(readme).toContain("sidebar.json");
    // The turn hooks (#549) are said, as the full flavor's README says them.
    expect(readme).toContain("takes a step and ends, so the fox is at work while a turn runs");
    expect(sidebar.generated["hooks/register.tsx"]).toContain("on('turn.start'");
    expect(readme).not.toMatch(/<!--|flavor:/);
  });
});

describe("sidebarText", () => {
  test("rewrites the owner of a $.state key, the speak-first's own prompt and the contract's key, counted; nothing else", () => {
    const src = [
      "const a = atom({ plugin: 'counterparts', key: 'x' } as const, 1)",
      'const b = { plugin: "counterparts", key: "y" }',
      "if (e.origin.name === 'counterparts') go()",
      "declare module 'claude-code' {\n  interface PluginState {\n    counterparts: {\n      x: number\n    }\n  }\n}",
      "on('command.run', { command: 'counterparts' }, h); const s = ['counterparts', 'plugin_counterparts_counterparts']",
      "{ plugin: 'counterparts-other', key: 'z' }",
    ].join("\n");
    const out = sidebarText(src);
    expect(out.renamed).toBe(4);
    expect(out.text).toContain(`atom({ plugin: '${SIDEBAR_PLUGIN}', key: 'x' }`);
    expect(out.text).toContain(`{ plugin: "${SIDEBAR_PLUGIN}", key: "y" }`);
    expect(out.text).toContain(`e.origin.name === '${SIDEBAR_PLUGIN}'`);
    expect(out.text).toContain(`interface PluginState {\n    '${SIDEBAR_PLUGIN}': {`);
    expect(out.text).toContain("on('command.run', { command: 'counterparts' }, h); const s = ['counterparts', 'plugin_counterparts_counterparts']");
    expect(out.text).toContain("{ plugin: 'counterparts-other', key: 'z' }");
    expect(sidebarLeftover(out.text)).toBeNull();
    expect(sidebarLeftover("x\n{ plugin: 'counterparts', key: 'late' }")).toBe("2");
  });
});

describe("README blocks", () => {
  test("one block for several flavors, and blocks inside blocks", () => {
    const t = ["a", "<!-- flavor:full core -->", "b", "<!-- flavor:full -->", "c", "<!-- /flavor:full -->", "<!-- /flavor:full core -->", "<!-- flavor:sidebar -->", "d", "<!-- /flavor:sidebar -->", "e", ""].join("\n");
    expect(bundleReadme(t, "full")).toBe("a\nb\nc\ne\n");
    expect(bundleReadme(t, "core")).toBe("a\nb\ne\n");
    expect(bundleReadme(t, "sidebar")).toBe("a\nd\ne\n");
    expect(bundleReadme(t, "directory")).toBe("a\ne\n");
  });
});

describe("written", () => {
  let work = "";
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-split-")));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  test("each writes over its own previous bundle", () => {
    const out = join(work, "sidebar");
    writeBundle(sidebar, out);
    writeFileSync(join(out, "stale.txt"), "older");
    writeBundle(sidebar, out);
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
    expect(JSON.parse(readFileSync(join(out, ".claude-plugin/plugin.json"), "utf8")).name).toBe(SIDEBAR_PLUGIN);
    expect(existsSync(join(out, "art/fox/idle.png"))).toBe(true);
    const coreOut = join(work, "core");
    writeBundle(core, coreOut);
    expect(existsSync(join(coreOut, "hooks/sidebar"))).toBe(false);
    expect(existsSync(join(coreOut, "src/adapters/plugin-run.sh"))).toBe(true);
    // Never one plugin's bundle into the other's clone; core over a full bundle (the same name) is fine.
    expect(() => writeBundle(sidebar, coreOut)).toThrow(/holds the counterparts plugin/);
    expect(() => writeBundle(core, out)).toThrow(/holds the counterparts-sidebar plugin/);
    expect(existsSync(join(coreOut, "src/adapters/plugin-run.sh"))).toBe(true);
    // The first meeting's close names /counterparts beside a sidebar only
    // (host-wiring.ts#sidebarBeside): none in core, the full flavor's own.
    const noRecord = { CLAUDE_CONFIG_DIR: join(work, "claude-config") };
    expect(sidebarBeside({ home: work, env: noRecord, pluginRoot: coreOut })).toBe(false);
    writeBundle(planBundle(REPO, "full"), coreOut);
    expect(sidebarBeside({ home: work, env: noRecord, pluginRoot: coreOut })).toBe(true);
    writeBundle(core, coreOut);
    expect(sidebarBeside({ home: work, env: noRecord, pluginRoot: coreOut })).toBe(false);
    expect(existsSync(join(coreOut, "hooks/sidebar"))).toBe(false);
  });

  test("a checkout on the directory branch takes the directory flavor alone, and that flavor goes nowhere else", () => {
    const checkout = (name: string, branch: string, worktree = false): string => {
      const dir = join(work, name);
      mkdirSync(dir, { recursive: true });
      if (worktree) {
        // A linked worktree: `.git` is a file naming the real git dir.
        const gitDir = join(work, `${name}-gitdir`);
        mkdirSync(gitDir, { recursive: true });
        writeFileSync(join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
        writeFileSync(join(dir, ".git"), `gitdir: ${gitDir}\n`);
      } else {
        mkdirSync(join(dir, ".git"));
        writeFileSync(join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
      }
      return dir;
    };
    const dirBranch = checkout("bundle-directory", "directory");
    expect(checkoutBranch(dirBranch)).toBe("directory");
    for (const p of [core, sidebar]) expect(() => writeBundle(p, dirBranch)).toThrow(/on the directory branch/);
    expect(() => writeBundle(planBundle(REPO, "full"), dirBranch)).toThrow(/on the directory branch/);
    expect(() => writeBundle(core, checkout("linked", "directory", true))).toThrow(/on the directory branch/);
    expect(readdirSync(dirBranch)).toEqual([".git"]);
    const main = checkout("bundle-main", "main");
    expect(() => writeBundle(planBundle(REPO, "directory"), main)).toThrow(/on main, not the directory branch/);
    writeBundle(core, main);
    expect(existsSync(join(main, ".claude-plugin/plugin.json"))).toBe(true);
    expect(checkoutBranch(join(work, "nowhere"))).toBeNull();
  }, 60_000);

  test("the tripwire fires from the command: build.ts --flavor full, in a tree at FIRST_SPLIT_RELEASE, refuses before planning", () => {
    // A tree of its own: this build.ts, a package.json at the split's version,
    // and the repository's node_modules (for `typescript`). The command reads
    // the version and refuses before it reads anything else.
    const tree = join(work, "tree");
    mkdirSync(join(tree, "tools", "plugin-bundle"), { recursive: true });
    writeFileSync(join(tree, "tools", "plugin-bundle", "build.ts"), readFileSync(join(REPO, "tools", "plugin-bundle", "build.ts")));
    writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "counterparts", version: FIRST_SPLIT_RELEASE }));
    // Wherever this checkout finds `typescript` (a worktree finds its parent's).
    symlinkSync(dirname(dirname(Bun.resolveSync("typescript/package.json", REPO))), join(tree, "node_modules"));
    const run = (args: string[]): { status: number | null; said: string } => {
      const r = spawnSync(process.execPath, ["--no-install", join(tree, "tools", "plugin-bundle", "build.ts"), ...args], { encoding: "utf8", timeout: 60_000, cwd: work });
      return { status: r.status, said: `${r.stdout}${r.stderr}` };
    };
    const full = run(["--flavor", "full", "--list"]);
    expect(full.status).toBe(1);
    expect(full.said).toContain("plugin bundle refused:");
    expect(full.said).toContain("Raise FIRST_SPLIT_RELEASE first");
    // The other flavors pass the tripwire (and then fail here on the missing
    // tree, which is not the tripwire's line).
    const coreRun = run(["--flavor", "core", "--list"]);
    expect(coreRun.said).not.toContain("Raise FIRST_SPLIT_RELEASE first");
  }, 120_000);

  test("the full flavor's tripwire: refused from FIRST_SPLIT_RELEASE on, and only the full flavor", () => {
    expect(versionAtLeast("0.3.29", "0.3.29")).toBe(true);
    expect(versionAtLeast("0.4.0", "0.3.29")).toBe(true);
    expect(versionAtLeast("0.3.28", "0.3.29")).toBe(false);
    expect(versionAtLeast("0.3.29-27ea8989eea9", "0.3.29")).toBe(true);
    expect(splitTripwire(FIRST_SPLIT_RELEASE, "full")).toContain("Raise FIRST_SPLIT_RELEASE first");
    expect(splitTripwire("0.3.27", "full")).toBeNull();
    for (const f of ["core", "sidebar", "directory"] as const) expect(splitTripwire(FIRST_SPLIT_RELEASE, f)).toBeNull();
    // Today: the version is before the split, so the full flavor still builds.
    const version = String(repoJson("package.json")["version"]);
    const listed = (repoJson(".claude-plugin/marketplace.json")["plugins"] as { name: string }[]).some((p) => p.name === SIDEBAR_PLUGIN);
    // Tied together: the sidebar's entry exactly from the split on (test/plugin.test.ts holds the same).
    expect(listed).toBe(versionAtLeast(version, FIRST_SPLIT_RELEASE));
  });

  // What ships is what is tested: the sidebar's sources AND its tests, renamed
  // by the same function, as Claude Code checks and runs a mod. Needs `claude`
  // on PATH; HOME is the test's own. The dependency is left out of this copy's
  // manifest (validate would look for an installed counterparts).
  const claudeBin = Bun.which("claude");
  test.skipIf(claudeBin === null)("the renamed sources and tests validate and pass `claude plugin test` as counterparts-sidebar", () => {
    const dir = join(work, "sidebar-src");
    const copy = (rel: string): void => {
      const from = join(REPO, SIDEBAR_DIR, rel);
      if (lstatSync(from).isDirectory()) {
        for (const n of readdirSync(from)) if (!(rel === ".claude-plugin" && n === "types")) copy(rel === "" ? n : `${rel}/${n}`);
        return;
      }
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      const bytes = readFileSync(from);
      writeFileSync(join(dir, rel), /\.tsx?$/.test(rel) ? sidebarText(bytes.toString("utf8")).text : bytes);
    };
    copy("");
    const manifest = json(sidebar, ".claude-plugin/plugin.json");
    delete manifest["dependencies"];
    writeFileSync(join(dir, ".claude-plugin/plugin.json"), JSON.stringify(manifest, null, 2));
    const home = join(work, "home");
    mkdirSync(home);
    // Nothing of a real Claude Code configuration reaches the child.
    const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home };
    for (const k of ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_DIRS", "CLAUDE_CODE_PLUGIN_CACHE_DIR"]) delete env[k];
    const validate = spawnSync(claudeBin!, ["plugin", "validate", dir], { encoding: "utf8", timeout: 120_000, env });
    expect(`${validate.stdout}${validate.stderr}`).toContain("Validation passed");
    const run = spawnSync(claudeBin!, ["plugin", "test", dir], { encoding: "utf8", timeout: 300_000, env });
    const said = `${run.stdout}${run.stderr}`;
    expect(said).toMatch(/\b0 fail\b/);
    expect(said).toMatch(/\b[1-9]\d* pass\b/);
  }, 420_000);
});
