/**
 * A scripted owner's week (`tools/harness/week.ts`), with a stub in place of
 * `claude -p`: the product's own adapter runs in-process on the harness's
 * clock, each scripted line becomes one child turn on the harness's server as
 * the owner (the first by `--session-id`, the rest by `--resume`), the hook's
 * words ride in front of the line as a system reminder, the nights run with
 * the model seat, and the week's store comes out as one file. No real model;
 * no text of the store in the record.
 *
 * Hermetic: a temp root and a fake HOME, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { beginNewInstall } from "../src/core/onboarding.js";
import { Store } from "../src/core/store/index.js";
import { runningBuild } from "../src/core/store/operational.js";
import { NEW_INSTALL_META, planTurn, recalledIds, replyOf, runWeek } from "../tools/harness/week.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { ScriptedDay } from "../tools/harness/owner-week.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-week-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const SCRIPT: readonly ScriptedDay[] = [
  { sessions: [{ scope: "shop", turns: ["hello, I make mugs ZEBRA-WORDS", "the glaze is called Oat Milk", "I ship within the country"] }] },
  { sessions: [{ scope: "notes", turns: ["my dog had surgery today", "she is resting", "the vet was kind"] }] },
  { sessions: [{ scope: "shop", turns: ["launch is saturday", "16 pieces now", "8 held back"] }] },
];

const result = (text: string): string => [
  JSON.stringify({ type: "system", subtype: "init", plugins: [], mcp_servers: [{ name: "counterparts", status: "connected" }] }),
  JSON.stringify({ type: "result", result: text }),
].join("\n");

test("the week drives the product's adapter on its clock, one child per turn, and hands back its store as one file", async () => {
  const plans: ChildPlan[] = [];
  // A turn's child writes a memory into the copy its server names, as a model calling `remember` would.
  const start = (p: ChildPlan): Promise<ChildResult> => {
    plans.push(p);
    const allowed = p.args[p.args.indexOf("--allowedTools") + 1] ?? "";
    if (allowed.includes("mcp__counterparts__remember")) {
      const e = (JSON.parse(p.args[p.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } }).mcpServers.counterparts.env;
      const at0 = Number(e["HARNESS_NOW"]);
      const c = Counterpart.open({ dir: e["COUNTERPARTS_DATA_DIR"]!, budgetBytes: 9_000, now: () => at0, timeZone: "UTC" });
      c.store.put({ type: "memory", kind: "fact", body: `A thing Dana said at ${String(at0)}.`, salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.6 } });
      c.close();
    }
    return Promise.resolve({ code: 0, timedOut: false, error: null, output: result("Noted.") });
  };
  const out = join(root, "week.sqlite");
  // Without the meeting: the night's gate waits while one is pending, and a stub never holds one.
  const r = await runWeek({ script: SCRIPT, start, install: "without-meeting", workRoot: join(root, "work"), out, env: { HOME: join(root, "home"), PATH: process.env["PATH"] ?? "" } });
  expect(r.days).toBe(3);
  // The build the run ran, beside its settings (2026-10-22).
  expect(r.build).toBe(runningBuild());
  expect(r.sessions.map((x) => [x.day, x.scope, x.turns, x.failedTurns])).toEqual([
    [1, "shop", 3, 0],
    [2, "notes", 3, 0],
    [3, "shop", 3, 0],
  ]);
  expect(r.sessions[0]!.init).toEqual({ plugins: [], servers: [{ name: "counterparts", status: "connected" }] });
  // Nights: launched by the product's own gate at a morning's first session, never on day 1.
  expect(r.nights.length).toBeGreaterThan(0);
  expect(r.nights.every((n) => n.day >= 2 && n.kind.length > 0)).toBe(true);
  // The last scripted day is dreamed too: the extra morning's first prompt launches its night.
  expect(r.nights.map((n) => n.day)).toContain(4);
  // The worker the product asked for at each Stop and session end, run by the harness.
  expect(r.boundaries).toBeGreaterThanOrEqual(3);

  // The turns: the session's own tools, its folder, --session-id then --resume, as the owner.
  // A person's turns are the children granted `remember`; the night's never are.
  const turns = plans.filter((p) => (p.args[p.args.indexOf("--allowedTools") + 1] ?? "").includes("mcp__counterparts__remember"));
  const first = turns[0]!;
  const sid = first.args[first.args.indexOf("--session-id") + 1]!;
  expect(turns[1]!.args[turns[1]!.args.indexOf("--resume") + 1]).toBe(sid);
  // A person's session is kept, so it can be resumed: the night child's flag is dropped (2026-10-21).
  for (const t of turns) expect(t.args).not.toContain("--no-session-persistence");
  expect(first.args[first.args.indexOf("--allowedTools") + 1]).toContain("mcp__counterparts__session_end");
  expect(first.args[first.args.indexOf("--allowedTools") + 1]).not.toContain("mcp__counterparts__dream");
  const server = (JSON.parse(first.args[first.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } }).mcpServers.counterparts.env;
  expect(server["HARNESS_OWNER"]).toBeUndefined();
  expect(Number(server["HARNESS_NOW"])).toBe(Date.parse("2026-03-02T10:00:00Z"));
  expect(first.cwd?.endsWith("/shop")).toBe(true);
  expect(first.stdin).toContain("hello, I make mugs");
  expect(first.stdin).toContain("<system-reminder>");
  expect(first.env["COUNTERPARTS_NIGHT_RUN"]).toBeUndefined();

  // The store as one file, out of WAL; the work folder gone; nothing of the store's words in the record.
  expect(existsSync(out)).toBe(true);
  const db = new Database(out, { readonly: true });
  expect((db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("delete");
  // The copy holds the week: every turn's memory is in it.
  expect((db.query("SELECT COUNT(*) AS n FROM memories WHERE type = 'memory'").get() as { n: number }).n).toBeGreaterThanOrEqual(3);
  // Each night ENDS on the lived day of the morning it ran on: the Stop's boundary moved the day
  // first. (Its `started` row is written by the hook at launch, before any boundary, as live's is.)
  const dayOf = new Map((db.query("SELECT json_extract(payload, '$.date') AS date, MAX(day) AS day FROM events WHERE name = 'sleep.cycle' GROUP BY 1").all() as { date: string; day: number }[]).map((x) => [x.date, x.day]));
  const nightRows = db.query("SELECT day, json_extract(payload, '$.date') AS date FROM events WHERE name = 'dream.night' AND json_extract(payload, '$.state') <> 'started'").all() as { day: number; date: string }[];
  expect(nightRows.length).toBeGreaterThan(0);
  for (const n of nightRows) expect(n.day).toBe(dayOf.get(n.date)!);
  db.close();
  expect(readdirSync(join(root, "work"))).toEqual([]);
  expect(JSON.stringify(r)).not.toContain("ZEBRA-WORDS");
});

test("a reply is read from the child's result line; nothing when it said none", () => {
  expect(replyOf(result("the reply"))).toBe("the reply");
  expect(replyOf("")).toBe("");
  expect(replyOf("not json\n")).toBe("");
});

test("a turn's plan keeps the night's lockdown and drops what would reach the live store", () => {
  const plan = planTurn(
    { env: { PATH: "/usr/bin", HOME: "/h", COUNTERPARTS_DATA_DIR: "/h/.counterparts/store", CLAUDE_PROJECT_DIR: "/p", ANTHROPIC_API_KEY: "k" } },
    { dir: join(root, "store"), configPath: join(root, "c.json"), session: "s", scope: join(root, "shop"), now: Date.parse("2026-03-02T10:00:00Z"), first: true, prompt: "hi" },
  );
  expect(plan.ok).toBe(true);
  expect(plan.args).toContain("--disallowedTools");
  expect(plan.args[plan.args.indexOf("--disallowedTools") + 1]).toContain("Bash");
  // A person's session is not the slim night child: the host's own prompt and built-in set.
  expect(plan.args).not.toContain("--tools");
  expect(plan.args).not.toContain("--system-prompt");
  expect(plan.args).not.toContain("");
  expect(plan.env["COUNTERPARTS_DATA_DIR"]).toBe(join(root, "store"));
  expect(plan.env["CLAUDE_PROJECT_DIR"]).toBeUndefined();
  expect(plan.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  expect(plan.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"]).toBe("1");
});

test("the week begins as a new install does: exactly the meta beginNewInstall writes, no more, no less", () => {
  const metaOf = (dir: string): Map<string, string> => {
    const db = new Database(join(dir, "counterparts.sqlite"), { readonly: true });
    const rows = db.query("SELECT key, value FROM meta").all() as { key: string; value: string }[];
    db.close();
    return new Map(rows.map((r) => [r.key, r.value]));
  };
  const plain = Store.open({ dir: join(root, "plain") });
  plain.close();
  const installed = Store.open({ dir: join(root, "install") });
  beginNewInstall(installed);
  installed.close();
  const before = metaOf(join(root, "plain"));
  const added = [...metaOf(join(root, "install"))].filter(([k, v]) => before.get(k) !== v && !/created|livedDay|schemaVersion|lastActive|claims\.era|confidential\.retired/.test(k));
  expect(new Map(added)).toEqual(new Map(NEW_INSTALL_META));
});

test("the model's recall calls are read from its output as expansions", () => {
  const out = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__counterparts__recall", input: { ids: ["mem_aaaaaaaaaaaa", "nonsense"] } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__counterparts__recall", input: { handle: "epi_bbbbbbbbbbbb" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__counterparts__remember", input: { ids: ["mem_cccccccccccc"] } }] } }),
  ].join("\n");
  // As live reads them: every string, unfiltered (a handle or title resolves at the boundary).
  expect(recalledIds(out)).toEqual(["mem_aaaaaaaaaaaa", "nonsense", "epi_bbbbbbbbbbbb"]);
});

test("a work root or an output under the owner's live root is refused before anything runs", async () => {
  const home = join(root, "home");
  const env = { HOME: home, PATH: process.env["PATH"] ?? "" };
  await expect(runWeek({ script: SCRIPT, workRoot: join(home, ".counterparts", "w"), env })).rejects.toThrow(/TARGET_IS_LIVE/);
  await expect(runWeek({ script: SCRIPT, workRoot: join(root, "w"), out: join(home, ".counterparts", "x.sqlite"), env })).rejects.toThrow(/TARGET_IS_LIVE/);
  expect(existsSync(join(home, ".counterparts", "w"))).toBe(false);
});

test("--no-nights runs no night, whatever the product asks for", async () => {
  const start = (p: ChildPlan): Promise<ChildResult> => {
    const allowed = p.args[p.args.indexOf("--allowedTools") + 1] ?? "";
    if (allowed.includes("mcp__counterparts__remember")) {
      const e = (JSON.parse(p.args[p.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } }).mcpServers.counterparts.env;
      const at0 = Number(e["HARNESS_NOW"]);
      const c = Counterpart.open({ dir: e["COUNTERPARTS_DATA_DIR"]!, budgetBytes: 9_000, now: () => at0, timeZone: "UTC" });
      c.store.put({ type: "memory", kind: "fact", body: `A thing at ${String(at0)}.`, salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.6 } });
      c.close();
    }
    return Promise.resolve({ code: 0, timedOut: false, error: null, output: result("ok") });
  };
  const r = await runWeek({ script: SCRIPT, start, install: "without-meeting", nights: false, workRoot: join(root, "w"), env: { HOME: join(root, "home"), PATH: process.env["PATH"] ?? "" } });
  expect(r.nights).toEqual([]);
  expect(r.boundaries).toBeGreaterThan(0);
});
