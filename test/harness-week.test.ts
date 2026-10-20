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
import { planTurn, replyOf, runWeek } from "../tools/harness/week.js";
import type { ScriptedDay } from "../tools/harness/owner-week.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-week-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const SCRIPT: readonly ScriptedDay[] = [
  { sessions: [{ scope: "shop", turns: ["hello, I make mugs ZEBRA-WORDS", "the glaze is called Oat Milk"] }] },
  { sessions: [{ scope: "notes", turns: ["my dog had surgery today"] }] },
];

const result = (text: string): string => [
  JSON.stringify({ type: "system", subtype: "init", plugins: [], mcp_servers: [{ name: "counterparts", status: "connected" }] }),
  JSON.stringify({ type: "result", result: text }),
].join("\n");

test("the week drives the product's adapter on its clock, one child per turn, and hands back its store as one file", async () => {
  const plans: ChildPlan[] = [];
  const start = (p: ChildPlan): Promise<ChildResult> => {
    plans.push(p);
    return Promise.resolve({ code: 0, timedOut: false, error: null, output: result("Noted.") });
  };
  const out = join(root, "week.sqlite");
  const r = await runWeek({ script: SCRIPT, start, workRoot: join(root, "work"), out, env: { HOME: join(root, "home"), PATH: process.env["PATH"] ?? "" } });
  expect(r.days).toBe(2);
  expect(r.sessions.map((x) => [x.day, x.scope, x.turns, x.failedTurns])).toEqual([
    [1, "shop", 2, 0],
    [2, "notes", 1, 0],
  ]);
  expect(r.sessions[0]!.init).toEqual({ plugins: [], servers: [{ name: "counterparts", status: "connected" }] });
  // Nights: the morning of day 2 and after the last day.
  expect(r.nights.map((n) => n.day)).toEqual([2, 3]);

  // The turns: the session's own tools, its folder, --session-id then --resume, as the owner.
  const turns = plans.filter((p) => p.args.includes("--setting-sources") && (p.args.includes("--resume") || p.args.includes("--session-id")) && !p.args.includes("mcp__counterparts__dream"));
  const first = turns[0]!;
  const sid = first.args[first.args.indexOf("--session-id") + 1]!;
  expect(turns[1]!.args[turns[1]!.args.indexOf("--resume") + 1]).toBe(sid);
  expect(first.args[first.args.indexOf("--allowedTools") + 1]).toContain("mcp__counterparts__session_end");
  expect(first.args[first.args.indexOf("--allowedTools") + 1]).not.toContain("mcp__counterparts__dream");
  const server = (JSON.parse(first.args[first.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } }).mcpServers.counterparts.env;
  expect(server["HARNESS_OWNER"]).toBe("1");
  expect(Number(server["HARNESS_NOW"])).toBe(Date.parse("2026-03-02T10:00:00Z"));
  expect(first.cwd?.endsWith("/shop")).toBe(true);
  expect(first.stdin).toContain("hello, I make mugs");
  expect(first.stdin).toContain("<system-reminder>");
  expect(first.env["COUNTERPARTS_NIGHT_RUN"]).toBeUndefined();

  // The store as one file, out of WAL; the work folder gone; nothing of the store's words in the record.
  expect(existsSync(out)).toBe(true);
  const db = new Database(out, { readonly: true });
  expect((db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("delete");
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
  expect(plan.env["COUNTERPARTS_DATA_DIR"]).toBe(join(root, "store"));
  expect(plan.env["CLAUDE_PROJECT_DIR"]).toBeUndefined();
  expect(plan.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  expect(plan.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"]).toBe("1");
});
