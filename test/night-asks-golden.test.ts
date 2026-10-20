/**
 * THE NIGHT'S COMPOSED ASKS, PINNED (2026-10-20, the seat refactor's guard).
 *
 * Every child the headless night starts — the catch-up's, the dream's, the
 * reflection's, and the `catch-up` command's — is recorded here as the
 * starter receives it (command, argv, the prompt on stdin, the environment,
 * the working directory, the watchdog), with the row the run ends on, across
 * the states a night can end in. The golden was written from master BEFORE
 * the seat interface existed; the refactor must reproduce it byte for byte.
 * A deliberate change to what the night asks updates the golden in the same
 * PR, said in its body: `UPDATE_GOLDEN=1 bun test test/night-asks-golden.test.ts`.
 *
 * Deterministic: the system clock is pinned, the store's zone is UTC, every
 * path, runtime, UUID and minted id is normalized. Hermetic: one temp root,
 * removed after.
 */
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { AdapterConfig } from "../src/adapters/config.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { runNight } from "../src/adapters/claude-code/night-run.js";
import type { NightKind } from "../src/adapters/claude-code/night-run.js";
import { catchUpCommand } from "../src/adapters/cli/catch-up.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";

const GOLDEN = join(import.meta.dir, "fixtures", "night-asks.golden.json");
const REPO = resolve(import.meta.dir, "..");
const NOW = Date.parse("2026-03-10T15:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const BASE_ENV = { PATH: "/usr/bin:/bin", HOME: "/home/someone", CLAUDE_PROJECT_DIR: "/somewhere", COUNTERPARTS_OBSERVER: "0" };

let root: string;
let dir: string;
let launch: string;

beforeEach(() => {
  setSystemTime(new Date(NOW));
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-night-asks-")));
  dir = join(root, "store");
  launch = join(root, "launch");
  for (const d of [dir, launch, join(root, "proj")]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  setSystemTime();
  rmSync(root, { recursive: true, force: true });
});

const config = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({ dataDir: dir, owner: true, injectionBudgetBytes: 9_000, timeZone: "UTC", ...over });

/** A session that lived yesterday and ended unwritten: the catch-up owes it. */
function lived(id: string, scope: string): void {
  let at = NOW - 20 * HOUR;
  const c = Counterpart.open({ dir, owner: true, now: () => at, timeZone: "UTC" });
  try {
    recordSession(dir, { sessionId: id, scope, phase: "start", at });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (let i = 0; i < 4; i++) {
      at += 8 * MIN;
      turns.push({ role: "user", text: `${id} #${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs.` });
      turns.push({ role: "assistant", text: `(${id} #${String(i)}) Understood: seat the valve on loop ${String(i)} first.` });
      c.captureSpans({ session: id, scope, turns: [...turns] });
    }
    c.boundary({ session: id, scope, kind: "stop" });
    recordSession(dir, { sessionId: id, scope, phase: "boundary", at });
    c.boundary({ session: id, scope, kind: "session-end" });
    recordSession(dir, { sessionId: id, scope, phase: "end", at: at + 1 });
  } finally {
    c.close();
  }
}

/** Paths, the runtime, UUIDs and minted ids out; what is left is what the night decided. */
function normalize(s: string): string {
  return s
    .split(root)
    .join("<root>")
    .split(REPO)
    .join("<repo>")
    .split(process.execPath)
    .join("<runtime>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\b(drm|rfl|mem|epi|sch|ctr|fel|cup|ses)_[0-9a-f]{6,16}\b/g, "$1_<id>");
}

interface Seen {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: Record<string, string>;
  readonly cwd: string | null;
  readonly timeoutMs: number;
  readonly captureOutput: boolean;
}

function seen(plan: ChildPlan): Seen {
  const env: Record<string, string> = {};
  for (const k of Object.keys(plan.env).sort()) env[k] = normalize(plan.env[k]!);
  return {
    command: plan.command,
    args: plan.args.map(normalize),
    stdin: normalize(plan.stdin),
    env,
    cwd: plan.cwd === undefined ? null : normalize(plan.cwd),
    timeoutMs: plan.timeoutMs,
    captureOutput: plan.captureOutput === true,
  };
}

/** A starter that records each plan and answers from a script, then exit 0. */
function starter(log: Seen[], script: Partial<ChildResult>[] = []): (plan: ChildPlan) => Promise<ChildResult> {
  let n = 0;
  return (plan) => {
    log.push(seen(plan));
    const r = script[n] ?? {};
    n += 1;
    return Promise.resolve({ code: 0, timedOut: false, error: null, output: "", ...r });
  };
}

function row(r: Record<string, unknown>): Record<string, unknown> {
  const keep = ["state", "kind", "reason", "detail", "code", "parts", "children", "transcript", "spills", "requeued", "dream", "reflection", "date", "timeoutMs"];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (r[k] !== undefined) out[k] = JSON.parse(normalize(JSON.stringify(r[k])));
  return out;
}

async function night(kind: NightKind, script: Partial<ChildResult>[] = [], over: Partial<AdapterConfig> = {}): Promise<{ plans: Seen[]; row: Record<string, unknown> }> {
  const plans: Seen[] = [];
  // The catch-up's children always exit clean; the script is the night's own children's.
  const start = starter(plans, script);
  const startCatchUp = starter(plans);
  let clock = NOW;
  const out = await runNight({
    open: () => Counterpart.open({ dir, owner: true, budgetBytes: 9_000, timeZone: "UTC", now: () => clock }),
    config: config(over),
    run: "nrn_golden",
    session: "ses-launching",
    scope: launch,
    kind,
    configPath: join(root, "claude-code.json"),
    baseEnv: BASE_ENV,
    start,
    startCatchUp,
    now: () => (clock += 1_000),
  });
  return { plans, row: row(out as unknown as Record<string, unknown>) };
}

test("the night's composed asks match the golden written before the seat existed", async () => {
  const scenarios: Record<string, unknown> = {};

  // A whole night with a write-up owed: catch-up, then dream, then reflection.
  lived("owed-one", join(root, "proj"));
  scenarios["night"] = await night({ kind: "night" });

  // The catch-up alone: the dream skipped as too little new.
  lived("owed-two", join(root, "proj"));
  scenarios["catch-up-only"] = await night({ kind: "night", dreamSkipped: "too-little-new" });

  // The reflection alone, on a dream id.
  scenarios["reflection"] = await night({ kind: "reflection", dream: "drm_0123456789ab" });

  // The dream's child stopped by its watchdog (a cut-off night); the reflection still follows.
  scenarios["dream-timed-out"] = await night({ kind: "night" }, [{ code: null, timedOut: true, error: "watchdog" }]);

  // No `claude` on the machine: the first child never starts.
  scenarios["no-claude"] = await night({ kind: "night" }, [{ code: null, timedOut: false, error: "spawn ENOENT", spawnCode: "ENOENT" }]);

  // The dream exits at once, non-zero, having begun nothing: retried plain once, then no reflection.
  scenarios["quick-exit"] = await night({ kind: "night" }, [{ code: 1 }, { code: 1 }]);

  // The second child (the reflection) cannot start.
  scenarios["reflection-never-starts"] = await night({ kind: "night" }, [{ code: 0 }, { code: null, timedOut: false, error: "spawn EACCES", spawnCode: "EACCES" }]);

  // An observer's config: refused before any child.
  scenarios["observer"] = await night({ kind: "night" }, [], { observer: true });

  // The `catch-up` command's own children.
  lived("owed-three", join(root, "proj"));
  const plans: Seen[] = [];
  const lines: string[] = [];
  const code = await catchUpCommand({
    config: { ...config(), dataDir: dir },
    configPath: join(root, "claude-code.json"),
    env: BASE_ENV,
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
    now: () => Date.now(),
    start: starter(plans),
  });
  scenarios["catch-up-command"] = { plans, code, lines: lines.map(normalize) };

  const got = JSON.stringify(scenarios, null, 2) + "\n";
  if (process.env["UPDATE_GOLDEN"] === "1" || !existsSync(GOLDEN)) {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, got);
  }
  expect(got).toBe(readFileSync(GOLDEN, "utf8"));
});
