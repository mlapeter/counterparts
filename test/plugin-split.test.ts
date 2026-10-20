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
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  planBundle,
  sidebarLeftover,
  sidebarText,
  writeBundle,
  type Plan,
} from "../tools/plugin-bundle/build.js";

const repoJson = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(REPO, rel), "utf8")) as Record<string, unknown>;
const json = (p: Plan, f: string): Record<string, unknown> => JSON.parse(p.generated[f]!) as Record<string, unknown>;

const fullPaths = bundlePaths(planBundle(REPO, "full"));
const core = planBundle(REPO, "core");
const corePaths = bundlePaths(core);
const sidebar = planBundle(REPO, "sidebar");
const sidebarPaths = bundlePaths(sidebar);

describe("core", () => {
  test("is the full flavor less the sidebar: same name, no module, no contract, nothing of hooks/sidebar/", () => {
    expect(corePaths).toEqual(fullPaths.filter((p) => !p.startsWith(`${SIDEBAR_DIR}/`)));
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
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const validate = spawnSync(claudeBin!, ["plugin", "validate", dir], { encoding: "utf8", timeout: 120_000, env });
    expect(`${validate.stdout}${validate.stderr}`).toContain("Validation passed");
    const run = spawnSync(claudeBin!, ["plugin", "test", dir], { encoding: "utf8", timeout: 300_000, env });
    const said = `${run.stdout}${run.stderr}`;
    expect(said).toMatch(/\b0 fail\b/);
    expect(said).toMatch(/\b[1-9]\d* pass\b/);
  }, 420_000);
});
