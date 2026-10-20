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
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChildPlan } from "../src/adapters/claude-code/child.js";
import { DREAM_CHILD_DENIED, DREAM_CHILD_TOOLS, NIGHT_DENIED_TOOLS } from "../src/adapters/claude-code/night-run.js";
import { seatAsk } from "../src/core/counterpart.js";
import { SERVE_AT_SCRIPT, modelSeat, planModelChild } from "../tools/harness/model-seat.js";

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

test("the seat starts that child, reads its answer, and refuses a write-up owed", async () => {
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
  expect(await seat.answer(seatAsk("catch-up", { prompt: "C", run: "nrn_h", session: "w", scope: "/proj" }))).toMatchObject({ refused: "not-in-harness", started: false });
  expect(seen.length).toBe(1);
});

test("the seat never runs on the owner's live root", () => {
  const live = join(root, "home", ".counterparts", "store");
  mkdirSync(live, { recursive: true });
  expect(() => modelSeat({ dir: live, configPath: join(live, "c.json"), now: () => NOW, env: env() })).toThrow(/live store/);
});
