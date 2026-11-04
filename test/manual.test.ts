/**
 * THE MANUAL (H1, 2026-11-03): `docs/manual.md`, opened by `recall`'s handle
 * `manual`. Three things are held here:
 *
 *   1. TRUTH. Every code span in the manual is a name the code serves: a
 *      `counterparts <command>` in the console's dispatch table with every
 *      `--flag` declared for it, a tool some host serves, a tool field (and a
 *      `field: value` in that field's enum), or a recall handle. Lines marked
 *      [hosted] name only what claude.ai's server serves, and no console
 *      command. A span that is none of these fails, so a renamed command, a
 *      dropped flag or a tool that left can't sit in the manual unnoticed.
 *      The checker's own positive control plants stale names and expects each.
 *   2. SHIPPING. The file rides in all four ways the code ships: the npm
 *      package's `files`, the plugin bundle (by `packagePath`'s literal), the
 *      plugin's single binary (`embeddedFiles`) and the hosted image.
 *   3. THE DOOR. Through the real servers: the stdio memory server a Claude
 *      Code install launches, and claude.ai's HTTP door; the index, a section
 *      by name and by number, an unknown section, and under observer.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS, COMMAND_FLAGS, COMMON_FLAGS } from "../src/adapters/cli/commands.js";
import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { MANUAL_HANDLE, MANUAL_PATH, findSection, installedManual, manualAsk, parseManual } from "../src/adapters/mcp/manual.js";
import type { Manual } from "../src/adapters/mcp/manual.js";
import { LAST_NIGHT_HANDLES } from "../src/adapters/mcp/nights.js";
import { CLAUDE_AI_INSTRUCTIONS, DESKTOP_INSTRUCTIONS } from "../src/adapters/mcp/server-words.js";
import { toolListFor } from "../src/adapters/mcp/tools.js";
import type { ToolSpec } from "../src/adapters/mcp/tools.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { PLUGIN_UPDATE_STEP, npmUpdateCommand } from "../src/adapters/update-words.js";
import { COMING_UP_HANDLE, ELSEWHERE_HANDLE, HANDOFFS_HANDLE } from "../src/core/counterpart-wake-shape.js";
import { HANDOFFS_HERE_HANDLE } from "../src/core/handoff/index.js";
import { LAST_EXCHANGE_HANDLE } from "../src/core/handoff/last-exchange.js";
import { TOLD_TITLE_PREFIX } from "../src/core/told.js";
import { STILL_OPEN_HANDLE } from "../src/core/self/index.js";
import { planBundle, bundlePaths } from "../tools/plugin-bundle/build.js";
import { embeddedFiles } from "../tools/single-binary/build.js";

const REPO = join(import.meta.dir, "..");
const MANUAL_FILE = join(REPO, MANUAL_PATH);
const manualText = (): string => readFileSync(MANUAL_FILE, "utf8");

// ── what the code serves ─────────────────────────────────────────────────────

interface Field {
  readonly enum?: readonly string[];
  readonly boolean: boolean;
}

/** Every tool a host serves, with its fields, and every field's enum. */
function served(specs: readonly ToolSpec[]): { tools: Set<string>; fields: Map<string, Field[]> } {
  const tools = new Set<string>();
  const fields = new Map<string, Field[]>();
  const walk = (props: Record<string, unknown> | undefined): void => {
    for (const [name, raw] of Object.entries(props ?? {})) {
      const p = raw as { enum?: string[]; type?: string | string[]; properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> } };
      const types = Array.isArray(p.type) ? p.type : [p.type];
      fields.set(name, [...(fields.get(name) ?? []), { ...(p.enum === undefined ? {} : { enum: p.enum }), boolean: types.includes("boolean") }]);
      walk(p.properties);
      walk(p.items?.properties);
    }
  };
  for (const s of specs) {
    tools.add(s.name);
    walk((s.inputSchema as { properties?: Record<string, unknown> }).properties);
  }
  return { tools, fields };
}

const LOCAL = served([...toolListFor("claude-code"), ...toolListFor(true)]);
const HOSTED = served(toolListFor(CLAUDE_AI_HOST));
const HANDLES = new Set<string>([
  STILL_OPEN_HANDLE,
  COMING_UP_HANDLE,
  ELSEWHERE_HANDLE,
  HANDOFFS_HANDLE,
  HANDOFFS_HERE_HANDLE,
  LAST_EXCHANGE_HANDLE,
  ...LAST_NIGHT_HANDLES,
  MANUAL_HANDLE,
]);
/** The two update commands the manual may print, as `update-words.ts` says them. */
const UPDATE_COMMANDS = new Set([npmUpdateCommand("node"), npmUpdateCommand("bun")]);

type Surface = "local" | "hosted" | "both";

/**
 * EVERY STALE NAME IN A MANUAL'S TEXT: one line per problem, empty when every
 * code span is something the code serves. The surface a line is read against:
 * its own [local]/[hosted] mark, else the paragraph mark above it in its
 * section, else the section's (a heading with "Hosted" is hosted), else both.
 */
function staleNames(text: string): string[] {
  const manual = parseManual(text);
  const out: string[] = [];
  const blocks = [{ heading: "(intro)", body: manual.intro }, ...manual.sections.map((s) => ({ heading: s.heading, body: s.text }))];
  for (const { heading, body } of blocks) {
    const sectionSurface: Surface = /hosted/i.test(heading) ? "hosted" : "both";
    let paragraph: Surface = sectionSurface;
    for (const line of body.split("\n")) {
      const own: Surface | null = line.includes("[hosted]") && !line.includes("[local]") ? "hosted" : line.includes("[local]") && !line.includes("[hosted]") ? "local" : null;
      const bullet = /^\s*- /.test(line);
      if (!bullet && line.trim() !== "" && own !== null) paragraph = own;
      if (/^## /.test(line)) paragraph = sectionSurface;
      const surface: Surface = own ?? paragraph;
      const where = `${heading}: ${line.trim().slice(0, 60)}`;
      // A mark that sends a line to the other surface opens a clause: `[local]` inside a hosted bullet.
      const clauses = line.split(/(?=\[(?:local|hosted)\])/);
      for (const clause of clauses) {
        const clauseSurface: Surface = clause.startsWith("[local]") ? "local" : clause.startsWith("[hosted]") ? "hosted" : surface;
        let command: string | null = null;
        // A span right after the word "handle" is a handle.
        for (const m of clause.matchAll(/(handle\s+)?`([^`]+)`/g)) {
          const asHandle = m[1] !== undefined;
          const span = m[2]!.trim();
          const problem = spanProblem(span, asHandle, clauseSurface, manual, command);
          if (span.startsWith("counterparts ")) command = span.split(/\s+/)[1] ?? null;
          if (problem !== null) out.push(`${where} — \`${span}\`: ${problem}`);
        }
        // Plugin commands (`/counterparts:doctor`) must be ones the plugin ships.
        for (const m of clause.matchAll(/\/counterparts:([a-z-]+)/g)) {
          try {
            readFileSync(join(REPO, "commands", `${m[1]!}.md`));
          } catch {
            out.push(`${where} — /counterparts:${m[1]!}: the plugin has no such command`);
          }
        }
      }
    }
  }
  return out;
}

function spanProblem(span: string, asHandle: boolean, surface: Surface, manual: Manual, lastCommand: string | null): string | null {
  const serves = surface === "hosted" ? [HOSTED] : surface === "local" ? [LOCAL] : [LOCAL, HOSTED];
  const where = surface === "both" ? "both surfaces" : surface;
  if (asHandle) {
    const ask = manualAsk(span);
    if (ask?.kind === "section") return findSection(manual, ask.asked) === null ? "no manual section by that name" : null;
    return HANDLES.has(span) ? null : "not a recall handle";
  }
  if (HANDLES.has(span)) return null;
  if (UPDATE_COMMANDS.has(span)) return surface === "hosted" ? "a console command on a hosted line" : null;
  if (span.startsWith("counterparts ")) {
    if (surface === "hosted") return "a console command on a hosted line";
    const words = span.split(/\s+/);
    const cmd = words[1]!;
    if (!(COMMANDS as readonly string[]).includes(cmd)) return `"${cmd}" is not in the console's dispatch table`;
    return flagsProblem(cmd, words.slice(2));
  }
  if (/^--[a-z-]+$/.test(span)) {
    if (lastCommand === null) return "a flag with no command before it on the line";
    return flagsProblem(lastCommand, [span]);
  }
  const pair = /^([A-Za-z_]+): (?:"([^"]+)"|(true|false))$/.exec(span);
  if (pair !== null) {
    const [, name, value, bool] = pair;
    const fields = serves.flatMap((s) => s.fields.get(name!) ?? []);
    if (fields.length === 0) return `no tool on ${where} has a field "${name!}"`;
    if (bool !== undefined) return fields.some((f) => f.boolean) ? null : `"${name!}" is not a true/false field`;
    return fields.some((f) => f.enum?.includes(value!) === true) ? null : `"${value!}" is not one of "${name!}"'s values`;
  }
  if (/^[a-z_]+$/i.test(span)) {
    if (serves.every((s) => s.tools.has(span))) return null;
    if (serves.every((s) => s.fields.has(span) || [...s.fields.values()].some((fs) => fs.some((f) => f.enum?.includes(span) === true)))) return null;
    return `not a tool, field or field value served on ${where}`;
  }
  return "not a name this test can check: write it as a command, tool, field or handle, or out of backticks";
}

function flagsProblem(cmd: string, words: readonly string[]): string | null {
  const allowed = [...COMMON_FLAGS, ...(COMMAND_FLAGS[cmd as keyof typeof COMMAND_FLAGS] ?? [])];
  for (const w of words) {
    if (!w.startsWith("--")) continue;
    const flag = w.slice(2).split("=")[0]!;
    if (!allowed.includes(flag)) return `"${cmd}" takes no --${flag}`;
  }
  return null;
}

// ── 1. truth ────────────────────────────────────────────────────────────────

describe("the manual names only what the code serves", () => {
  test("every code span is a command, flag, tool, field, value or handle the code has, on the surface its line is for", () => {
    expect(staleNames(manualText())).toEqual([]);
  });

  test("the checker catches a stale name of every kind (the positive control)", () => {
    const planted = [
      "# T",
      "",
      "Intro.",
      "",
      "## One",
      "",
      "First sentence.",
      "",
      "- `counterparts frobnicate` does nothing.",
      "- `counterparts export --sparkle` exports.",
      "- `counterparts backup --out <dir>` then `--glitter`.",
      "- The `teleport` tool moves you.",
      "- `how: \"maybe\"` settles nothing.",
      "- `colour: \"plain\"` is no field.",
      "- The handle `still closed` lists nothing.",
      "- The handle `manual nowhere` opens nothing.",
      "- /counterparts:fly runs nothing.",
      "- [hosted] The `meet` tool, and `counterparts doctor` on a hosted line.",
      "",
      "## Hosted",
      "",
      "Hosted things.",
      "",
      "- `npm install -g counterparts@latest` on hosted.",
    ].join("\n");
    const found = staleNames(planted).join("\n");
    for (const name of ["frobnicate", "--sparkle", "--glitter", "teleport", "maybe", "colour", "still closed", "manual nowhere", "counterparts:fly", "counterparts doctor", "npm install"]) {
      expect(found).toContain(name);
    }
    // And what the planted text says rightly is not flagged.
    expect(found).not.toContain("— `counterparts backup --out <dir>`:");
    expect(found).not.toContain("— `meet`:");
  });

  test("the plugin's update step is the one update-words.ts prints, word for word", () => {
    expect(manualText()).toContain(PLUGIN_UPDATE_STEP.replace(/^in Claude Code, /, ""));
  });

  test("its shape: a title, an intro, and sections that each open with a plain sentence", () => {
    const m = parseManual(manualText());
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.intro.length).toBeGreaterThan(0);
    expect(m.sections.length).toBeGreaterThanOrEqual(8);
    for (const s of m.sections) {
      expect(s.line).toMatch(/[.!?]$/);
      expect(s.line.length).toBeLessThan(220);
    }
    expect(new Set(m.sections.map((s) => s.handle)).size).toBe(m.sections.length);
  });
});

// ── 2. shipping ─────────────────────────────────────────────────────────────

describe("the manual ships with every install", () => {
  test("npm package, plugin bundle, single binary, hosted image", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain(MANUAL_PATH);
    expect(bundlePaths(planBundle())).toContain(MANUAL_PATH);
    expect(embeddedFiles()).toContain(MANUAL_PATH);
    const docker = readFileSync(join(REPO, "hosted", "Dockerfile"), "utf8");
    expect(docker).toContain(`COPY ${MANUAL_PATH} ${MANUAL_PATH}`);
    const ignore = readFileSync(join(REPO, "hosted", "Dockerfile.dockerignore"), "utf8").split("\n");
    expect(ignore).toContain(`!${MANUAL_PATH}`);
    // The plugin bundle finds it by `packagePath`'s literal: the two must agree.
    expect(readFileSync(join(REPO, "src", "adapters", "mcp", "manual.ts"), "utf8")).toContain(`packagePath("${MANUAL_PATH}")`);
  });

  test("the installed manual is the repository's file", () => {
    const m = installedManual();
    expect(m).not.toBeNull();
    expect(m?.sections.map((s) => s.heading)).toEqual(parseManual(manualText()).sections.map((s) => s.heading));
  });

  test("the pointer: the recall handle's description and both chat hosts' instructions name it", () => {
    for (const host of ["claude-code", true, CLAUDE_AI_HOST] as const) {
      const recall = toolListFor(host).find((t) => t.name === "recall")!;
      const handle = (recall.inputSchema as { properties: { handle: { description: string } } }).properties.handle.description;
      expect(handle).toContain(`"${MANUAL_HANDLE}"`);
    }
    expect(DESKTOP_INSTRUCTIONS).toContain(`"${MANUAL_HANDLE}"`);
    expect(CLAUDE_AI_INSTRUCTIONS).toContain(`"${MANUAL_HANDLE}"`);
  });
});

// ── 3. the door, through the real servers ───────────────────────────────────

let root: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-manual-")));
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** The stdio memory server a Claude Code install launches, fed these JSON-RPC lines; its answers by id. */
function stdio(lines: readonly Record<string, unknown>[], extraEnv: Record<string, string> = {}): Map<number, Record<string, unknown>> {
  const dir = join(root, "store");
  const config = join(root, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: dir }), "utf8");
  const init = Bun.spawnSync([process.execPath, "run", join(REPO, "src", "adapters", "cli", "bin", "counterparts.ts"), "init", "--dir", dir, "--name", "Wren"], {
    env: { PATH: "/usr/bin:/bin", HOME: root, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr.toString()}`);
  // The folder the server runs in is set on, as a person's answer to the first-launch question sets it.
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  const on = Bun.spawnSync([process.execPath, "run", join(REPO, "src", "adapters", "cli", "bin", "counterparts.ts"), "scope", project, "--on", "--config", config], {
    env: { PATH: "/usr/bin:/bin", HOME: root, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (on.exitCode !== 0) throw new Error(`scope failed: ${on.stderr.toString()}${on.stdout.toString()}`);
  const serve = join(REPO, "src", "adapters", "mcp", "bin", "serve.ts");
  const out = Bun.spawnSync([process.execPath, "run", serve], {
    env: { PATH: "/usr/bin:/bin", HOME: root, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_CONFIG: config, COUNTERPARTS_DATA_DIR: dir, ...extraEnv },
    cwd: project,
    stdin: Buffer.from(lines.map((l) => JSON.stringify({ jsonrpc: "2.0", ...l })).join("\n") + "\n"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const answers = new Map<number, Record<string, unknown>>();
  for (const line of out.stdout.toString().split("\n")) {
    if (line.trim() === "") continue;
    const msg = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
    if (typeof msg.id === "number" && msg.result !== undefined) answers.set(msg.id, msg.result);
  }
  if (answers.size === 0) throw new Error(`no answers from the stdio server: ${out.stderr.toString().slice(0, 2000)}`);
  return answers;
}

const INIT = { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.0" } } };
const call = (id: number, args: Record<string, unknown>): Record<string, unknown> => ({ id, method: "tools/call", params: { name: "recall", arguments: args } });
const structured = (r: Record<string, unknown> | undefined): Record<string, unknown> => (r?.["structuredContent"] ?? {}) as Record<string, unknown>;

describe("recall opens the manual", () => {
  test("Claude Code's stdio server: the index, a section by name and by number, an unknown one", () => {
    const m = parseManual(manualText());
    const folders = m.sections.find((s) => /folders/i.test(s.heading))!;
    const answers = stdio([
      INIT,
      { method: "notifications/initialized" },
      call(2, { handle: "manual" }),
      call(3, { handle: folders.handle }),
      call(4, { handle: "Manual 1" }),
      call(5, { handle: "manual nowhere" }),
      call(6, { question: "the garden", mode: "facts" }),
    ]);
    const index = structured(answers.get(2));
    expect(index["reason"]).toBe("manual");
    expect(index["sections"]).toBe(m.sections.length);
    for (const s of m.sections) expect(String(index["text"])).toContain(`"${s.handle}": ${s.line}`);
    const section = structured(answers.get(3));
    expect(section["handle"]).toBe(folders.handle);
    expect(String(section["text"])).toContain("`counterparts scope .`");
    expect(String(structured(answers.get(4))["text"])).toStartWith(`## ${m.sections[0]!.heading}`);
    const unknown = structured(answers.get(5));
    expect(unknown["reason"]).toBe("manual-section-unknown");
    expect(unknown["sections"]).toContain(folders.handle);
    expect(answers.get(5)?.["isError"]).toBe(true);
    // Not an observer here: an ordinary recall answers rather than standing down.
    expect(structured(answers.get(6))["reason"]).toBe("nothing-came");
  }, 30_000);

  test("the index names what is inside: every line carries a concrete thing from its own section, and the index stays small", () => {
    const m = parseManual(manualText());
    const answers = stdio([INIT, call(2, { handle: "manual" })]);
    const text = String(structured(answers.get(2))["text"]);
    expect(Buffer.byteLength(text)).toBeLessThan(2200);
    const norm = (x: string): string => x.toLowerCase().replace(/[’]/g, "'");
    // A concrete thing: a code span, a quoted phrase, or a file name.
    const concrete = (line: string): string[] =>
      [...line.matchAll(/`([^`]+)`|"([^"]+)"|\b([A-Z]+\.md)\b/g)].map((x) => (x[1] ?? x[2] ?? x[3])!);
    // The control: the old generic lines name nothing.
    expect(concrete("These are things a person can say.")).toEqual([]);
    expect(concrete("These make the memory work better.")).toEqual([]);
    for (const s of m.sections) {
      expect(text).toContain(`"${s.handle}": ${s.line}`);
      const things = concrete(s.line);
      expect(things.length).toBeGreaterThan(0);
      const body = norm(s.text);
      // Every thing the line names is in its own section (a file name counts when the section only points to it).
      const rest = norm(s.text.replace(s.line, ""));
      expect(things.some((t) => (/\.md$/.test(t) ? false : rest.includes(norm(t))) || (/\.md$/.test(t) && body.includes(norm(t))))).toBe(true);
      for (const t of things) expect(body).toContain(norm(t));
    }
  }, 30_000);

  test("under observer it still opens: it reads no memory", () => {
    const answers = stdio([INIT, call(2, { handle: "manual" }), call(3, { question: "anything", mode: "facts" })], { COUNTERPARTS_OBSERVER: "1" });
    expect(structured(answers.get(2))["reason"]).toBe("manual");
    expect(String(structured(answers.get(3))["reason"])).toContain("observer");
  }, 30_000);

  test("claude.ai's HTTP door: the hosted section opens, and the tools list names the handle", async () => {
    const s: McpServer = openServer({
      dir: join(root, "store-claude-ai"),
      host: CLAUDE_AI_HOST,
      env: {},
      lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
      manifestVersion: () => null,
    });
    closers.push(() => s.counterpart.close());
    const http = await serveHttp({ server: s });
    closers.push(() => http.close());
    let id = 1;
    const rpc = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await fetch(http.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, ...(params === undefined ? {} : { params }) }) });
      return (await res.json()) as Record<string, unknown>;
    };
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } });
    expect(String((init["result"] as Record<string, unknown>)["instructions"])).toContain('"manual"');
    const list = (await rpc("tools/list"))["result"] as { tools: { name: string; inputSchema: { properties: { handle?: { description: string } } } }[] };
    expect(list.tools.find((t) => t.name === "recall")?.inputSchema.properties.handle?.description).toContain('"manual"');
    const session = String(structured((await rpc("tools/call", { name: "wake", arguments: {} }))["result"] as Record<string, unknown>)["session"]);
    const hosted = structured((await rpc("tools/call", { name: "recall", arguments: { session, handle: "manual hosted" } }))["result"] as Record<string, unknown>);
    expect(hosted["reason"]).toBe("manual");
    expect(String(hosted["text"])).toContain("custom connector");
  });

  // Review of #730: "manual <words>" is a family of handles, and a memory's exact title is a handle too.
  test("a memory titled \"Manual …\" still opens by its title; words nothing answers get the section list", async () => {
    const s: McpServer = openServer({
      dir: join(root, "store-titles"),
      host: CLAUDE_AI_HOST,
      env: {},
      lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
      manifestVersion: () => null,
    });
    closers.push(() => s.counterpart.close());
    const http = await serveHttp({ server: s });
    closers.push(() => http.close());
    let id = 1;
    const post = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await fetch(http.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) });
      return ((await res.json()) as { result: Record<string, unknown> }).result;
    };
    const tool = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => structured(await post("tools/call", { name, arguments: args }));
    await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } });
    const session = String((await tool("wake", {}))["session"]);
    await tool("remember", { session, title: "Manual for the boiler", text: "The boiler's manual is in the hall cupboard, second shelf, under the fuse box spares." });
    const byTitle = await tool("recall", { session, handle: "Manual for the boiler" });
    expect(byTitle["reason"]).toBe("expanded");
    expect(JSON.stringify(byTitle["memories"])).toContain("hall cupboard");
    const unknown = await tool("recall", { session, handle: "manual nowhere" });
    expect(unknown["reason"]).toBe("manual-section-unknown");
    // A question sent as `query` (recall's alias for `question`) is not read as the manual's door.
    expect((await tool("recall", { session, handle: "manual", query: "the boiler" }))["reason"]).not.toBe("manual");
  });
});

test("the manual names starter notes by the title prefix the store gives them", () => {
  const text = readFileSync(join(import.meta.dir, "..", "docs", "manual.md"), "utf8");
  expect(text).toContain(`"${TOLD_TITLE_PREFIX}…"`);
});
