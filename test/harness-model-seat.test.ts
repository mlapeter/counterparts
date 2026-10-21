/**
 * A model in the harness's seat (`tools/harness/model-seat.ts`): the child
 * Claude Code's own seat would plan, moved onto the harness's server and away
 * from the owner's settings. Held here: the lockdown is Claude Code's own (the
 * same tools granted and denied), the memory server is the harness's on the
 * temp copy and the harness's clock, no user settings load, nothing of the
 * parent's Counterparts or Claude environment reaches the child, and the
 * owner's live root is refused. No real `claude` is started: a stub starter
 * records the plan.
 *
 * Hermetic: a temp dir and a fake HOME, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChildPlan } from "../src/adapters/claude-code/child.js";
import { DREAM_CHILD_DENIED, DREAM_CHILD_TOOLS, NIGHT_DENIED_TOOLS } from "../src/adapters/claude-code/night-run.js";
import { seatAsk } from "../src/core/counterpart.js";
import { Database } from "bun:sqlite";

import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { SERVE_AT_SCRIPT, childInit, modelSeat, planModelChild } from "../tools/harness/model-seat.js";
import { replayNight } from "../tools/harness/night.js";

let root: string;
let dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-model-seat-")));
  dir = join(root, "store");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const env = (): NodeJS.ProcessEnv => ({
  PATH: "/usr/bin:/bin",
  HOME: join(root, "home"),
  CLAUDE_PROJECT_DIR: "/somewhere",
  CLAUDECODE: "1",
  COUNTERPARTS_DATA_DIR: "/Users/someone/.counterparts/store",
  COUNTERPARTS_CONFIG: "/Users/someone/.counterparts/claude-code.json",
});

const NOW = Date.parse("2026-10-19T13:16:40.000Z");

test("the dream's child: Claude Code's own lockdown, the harness's server on the copy and its clock, no user settings", () => {
  const ask = seatAsk("dream", { prompt: "THE PROMPT", run: "nrn_h", session: "ses-1", scope: "/proj", limits: { turns: 60, ms: 1_200_000 } });
  const plan = planModelChild({ dir, configPath: join(dir, "harness-config.json"), now: () => NOW, timeZone: "America/Denver", env: env() }, ask, "00000000-0000-4000-8000-000000000000");
  expect(plan.ok).toBe(true);
  const arg = (name: string): string => plan.args[plan.args.indexOf(name) + 1]!;
  expect(arg("--allowedTools")).toBe(DREAM_CHILD_TOOLS.join(","));
  expect(arg("--disallowedTools")).toBe([...NIGHT_DENIED_TOOLS, ...DREAM_CHILD_DENIED].join(","));
  expect(arg("--setting-sources")).toBe("project");
  expect(plan.args).toContain("--strict-mcp-config");
  expect(arg("--session-id")).toBe("00000000-0000-4000-8000-000000000000");
  const server = (JSON.parse(arg("--mcp-config")) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }).mcpServers["counterparts"]!;
  expect(server.args).toEqual([SERVE_AT_SCRIPT]);
  expect(server.env["COUNTERPARTS_DATA_DIR"]).toBe(dir);
  expect(server.env["HARNESS_NOW"]).toBe(String(NOW));
  expect(server.env["HARNESS_TIME_ZONE"]).toBe("America/Denver");
  expect(server.env["COUNTERPARTS_NIGHT_CHILD"]).toBe("dream");
  expect(server.env["COUNTERPARTS_SESSION"]).toBe("ses-1");
  // The child: the copy, its temp config, the quiet flag; nothing of the parent's Counterparts or Claude Code session.
  expect(plan.cwd).toBe(dir);
  expect(plan.stdin).toBe("THE PROMPT");
  expect(plan.env["COUNTERPARTS_DATA_DIR"]).toBe(dir);
  expect(plan.env["COUNTERPARTS_CONFIG"]).toBe(join(dir, "harness-config.json"));
  expect(plan.env["COUNTERPARTS_NIGHT_RUN"]).toBe("nrn_h");
  expect(plan.env["CLAUDE_PROJECT_DIR"]).toBeUndefined();
  expect(plan.env["CLAUDECODE"]).toBeUndefined();
  expect(JSON.stringify(plan.env)).not.toContain(".counterparts");
});

test("the seat starts that child, reads its answer, and answers a write-up owed too", async () => {
  const seen: ChildPlan[] = [];
  const seat = modelSeat({
    dir,
    configPath: join(dir, "harness-config.json"),
    now: () => NOW,
    env: env(),
    start: (p) => {
      seen.push(p);
      return Promise.resolve({ code: 0, timedOut: false, error: null, output: "" });
    },
  });
  const answer = await seat.answer(seatAsk("reflection", { prompt: "R", run: "nrn_h", session: "ses-1", scope: "/proj" }));
  expect(answer).toMatchObject({ refused: null, started: true, code: 0, timedOut: false });
  expect(answer.spill?.reason).toBe("absent");
  expect(seen.length).toBe(1);
  expect(await seat.answer(seatAsk("catch-up", { prompt: "C", run: "nrn_h", session: "w", scope: "/proj" }))).toMatchObject({ refused: null, started: true });
  expect(seen.length).toBe(2);
  // A write-up's child names no night act to its server, and gets only session_end.
  const config = JSON.parse(seen[1]!.args[seen[1]!.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } };
  expect(config.mcpServers.counterparts.env["COUNTERPARTS_NIGHT_CHILD"]).toBeUndefined();
  expect(seen[1]!.args[seen[1]!.args.indexOf("--allowedTools") + 1]).toBe("mcp__counterparts__session_end");
});

test("the seat never runs on the owner's live root", () => {
  const live = join(root, "home", ".counterparts", "store");
  mkdirSync(live, { recursive: true });
  expect(() => modelSeat({ dir: live, configPath: join(live, "c.json"), now: () => NOW, env: env() })).toThrow(/live store/);
});

/** Run the harness's server with an environment and some protocol lines; its exit code and answers. */
async function serveAt(env: Record<string, string>, lines: unknown[]): Promise<{ code: number; answers: Record<string, unknown>[] }> {
  const p = Bun.spawn([process.execPath, SERVE_AT_SCRIPT], { env: { PATH: process.env["PATH"] ?? "", ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  await p.stdin.end();
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  return { code, answers: out.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Record<string, unknown>) };
}

test("the harness's server: refuses the live root and an instant in seconds, serves on its clock, exits when its input ends", async () => {
  const home = join(root, "home");
  const live = join(home, ".counterparts", "store");
  mkdirSync(live, { recursive: true });
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
  expect((await serveAt({ HOME: home, COUNTERPARTS_DATA_DIR: live, HARNESS_NOW: String(NOW) }, [init])).code).toBe(1);
  expect((await serveAt({ HOME: home, COUNTERPARTS_DATA_DIR: dir, HARNESS_NOW: "1760879800" }, [init])).code).toBe(1);
  const ok = await serveAt({ HOME: home, COUNTERPARTS_DATA_DIR: dir, HARNESS_NOW: String(NOW), HARNESS_EMBED: "0", HARNESS_TIME_ZONE: "UTC" }, [
    init,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]);
  expect(ok.code).toBe(0);
  expect(((ok.answers[1]!["result"] as { tools: { name: string }[] }).tools.map((t) => t.name)).sort()).toContain("dream");
  // The store it made is dated by its clock, not today's.
  const db = new Database(join(dir, "counterparts.sqlite"), { readonly: true });
  expect((db.query("SELECT value FROM meta WHERE key = 'store.created'").get() as { value: string }).value).toBe("2026-10-19");
  db.close();
});

test("a child's init line says what it loaded", () => {
  const out = [
    JSON.stringify({ type: "system", subtype: "init", plugins: [{ name: "p1" }], mcp_servers: [{ name: "counterparts", status: "connected" }] }),
    JSON.stringify({ type: "assistant", message: { content: [] } }),
  ].join("\n");
  expect(childInit(out)).toEqual({ plugins: ["p1"], servers: [{ name: "counterparts", status: "connected" }] });
  expect(childInit("")).toBeNull();
});

test("night --model end to end: the night runs with the model's seat on the copy and its clock, the record says what the child loaded", async () => {
  // A store, and a recorded night on it (begun and journaled through the server), as night.ts needs one to compare.
  let clock = NOW;
  const open = (owner: boolean): Counterpart => Counterpart.open({ dir, now: () => clock, timeZone: "UTC" });
  const c = open(true);
  for (const body of ["The relief valve is seated before the pump runs.", "Loop two loses pressure when the valve is late."]) {
    c.store.put({ type: "memory", kind: "fact", body, salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.6 } });
  }
  c.close();
  const snapshot = (to: string): void => {
    copyFileSync(join(dir, "counterparts.sqlite"), to);
    const db = new Database(to);
    db.run("PRAGMA journal_mode = DELETE");
    db.close();
  };
  const source = join(root, "pre.sqlite");
  snapshot(source);
  const live = open(false);
  const s = new McpServer({ counterpart: live, session: "ses-n", scope: root, env: { COUNTERPARTS_NIGHT_CHILD: "dream" }, now: () => clock });
  clock += 1_000;
  const begun = (await s.call("dream", { phase: "begin", session: "ses-n" })).structuredContent;
  clock += 1_000;
  await s.call("dream", { phase: "journal", dream: begun["dream"], session: "ses-n", title: "T", text: "The night." });
  live.close();
  const outcome = join(root, "after.sqlite");
  snapshot(outcome);
  const transcript = join(root, "dream.jsonl");
  const at = new Date(NOW + 1_000).toISOString();
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", timestamp: new Date(NOW).toISOString(), message: { role: "user", content: "P" } }),
      JSON.stringify({ type: "assistant", timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id: "a", name: "mcp__counterparts__dream", input: { phase: "begin", session: "ses-n" } }] } }),
      JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: JSON.stringify(begun) }] } }),
    ].join("\n"),
  );
  const empty = join(root, "reflection.jsonl");
  writeFileSync(empty, "");

  // THE MODEL, stubbed: on the dream's ask it begins and journals a dream on the copy its server names, at its server's clock.
  const asked: string[] = [];
  const start = async (plan: ChildPlan): Promise<{ code: number; timedOut: boolean; error: null; output: string }> => {
    const config = JSON.parse(plan.args[plan.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } };
    const e = config.mcpServers.counterparts.env;
    asked.push(e["COUNTERPARTS_NIGHT_CHILD"] ?? "?");
    expect(plan.args).toContain("--setting-sources");
    if (e["COUNTERPARTS_NIGHT_CHILD"] === "dream") {
      const at0 = Number(e["HARNESS_NOW"]);
      const copy = Counterpart.open({ dir: e["COUNTERPARTS_DATA_DIR"]!, budgetBytes: 9_000, now: () => at0, timeZone: "UTC" });
      const server = new McpServer({ counterpart: copy, session: e["COUNTERPARTS_SESSION"]!, scope: root, env: { COUNTERPARTS_NIGHT_CHILD: "dream" }, now: () => at0 });
      const b = (await server.call("dream", { phase: "begin", session: e["COUNTERPARTS_SESSION"] })).structuredContent;
      await server.call("dream", { phase: "journal", dream: b["dream"], session: e["COUNTERPARTS_SESSION"], title: "T", text: "A dream." });
      copy.close();
    }
    return { code: 0, timedOut: false, error: null, output: JSON.stringify({ type: "system", subtype: "init", plugins: [], mcp_servers: [{ name: "counterparts", status: "connected" }] }) };
  };
  const work = join(root, "work");
  const r = await replayNight({ source, outcome, dreamTranscript: transcript, reflectionTranscript: empty, seat: "model", start, workRoot: work, timeZone: "UTC", embed: false, env: { HOME: join(root, "home"), PATH: process.env["PATH"] ?? "" } });
  expect(asked).toEqual(["dream", "reflection"]);
  expect(r.seat).toBe("harness:model");
  expect(r.dream?.state.same).toBe(true);
  expect(r.dream?.titleSame).toBe(true);
  expect(r.childInits?.["dream"]).toEqual({ plugins: [], servers: [{ name: "counterparts", status: "connected" }] });
  expect(readdirSync(work)).toEqual([]);
});
