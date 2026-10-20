/**
 * A SCRIPTED OWNER'S FIRST WEEK (2026-10-20, lane 1 step 4): a fresh store,
 * a fixed week of sessions (`owner-week.ts`), the product's own hook logic,
 * and a model in the seat for the counterpart's turns and its nights.
 *
 * The harness is the host. It builds Claude Code's own adapter
 * (`ClaudeCodeAdapter`, the code the hooks run) in-process on the harness's
 * clock, with a spawner that starts nothing, and calls its handlers in the
 * order Claude Code does: `sessionStart`, then per scripted line
 * `userPromptSubmit` and, after the model's reply, `stop` (an ask it returns
 * is put to the model as the conversation's next message, as the host's
 * additionalContext is); at the end `sessionEnd`, and the boundary the worker
 * would run. Each turn is one `claude -p` (`--session-id` first, `--resume`
 * after) whose memory tools come from the harness's server on the same store
 * and clock, as the owner. Each morning after the first, the night runs
 * (`runNight` with the model seat).
 *
 * One shape differs from a live session, said here and in `docs/seat.md`: a
 * hook's injection arrives in the prompt, wrapped as a system reminder, not
 * as the host's own attachment.
 *
 * The store, a snapshot of it at the week's end (a single file, for
 * `cli.ts replay`), and the run record are the output. The record holds counts
 * and states only.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { ClaudeCodeAdapter, openEmbedder, planNightChild, runNight, startChild } from "../../src/adapters/claude-code/index.js";
import type { ChildPlan, ChildResult, HookInput, NightStarter } from "../../src/adapters/claude-code/index.js";
import { recordSession } from "../../src/adapters/sessions.js";
import { Counterpart } from "../../src/core/counterpart.js";

import { childInit, modelSeat, SERVE_AT_SCRIPT } from "./model-seat.js";
import type { ChildInit } from "./model-seat.js";
import { OWNER_NAME, OWNER_WEEK } from "./owner-week.js";
import type { ScriptedDay } from "./owner-week.js";
import { SERVE_AT_ENV } from "./serve-at.js";
import { underLiveRoot } from "./source.js";

/** The memory tools a person's session has, as the host names them. Not the night's dream or reflection. */
export const SESSION_TOOLS: readonly string[] = ["recall", "remember", "session_end", "chapter", "self_page", "meet", "status"].map((t) => `mcp__counterparts__${t}`);

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * WHAT A NEW INSTALL WRITES before the first session (`core/onboarding.ts#
 * beginNewInstall`, run by `counterparts install`): the meeting not yet
 * started, dreaming on. Not in the package's public seams, so mirrored here;
 * `test/harness-week.test.ts` holds the two to the same keys and values.
 */
export const NEW_INSTALL_META: readonly (readonly [string, string])[] = [
  ["onboarding.meet", "not_started"],
  ["dream.setting", "auto"],
  ["dream.setting.headless-reset", "chosen"],
];

export interface WeekOptions {
  readonly script?: readonly ScriptedDay[];
  /** How many of the script's days to run (default all). */
  readonly days?: number;
  /** The calendar date of day one. */
  readonly startDate?: string;
  readonly timeZone?: string;
  readonly budgetBytes?: number;
  readonly model?: string;
  /** Run the nights (default true). */
  readonly nights?: boolean;
  /** Begin as a new install does, so the first session offers the meeting (default true). */
  readonly install?: boolean;
  readonly workRoot?: string;
  /** Where to write the week's store as one file, for `cli.ts replay`. */
  readonly out?: string;
  readonly keep?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** TESTS ONLY: the starter for every child, in place of a real `claude -p`. */
  readonly start?: NightStarter;
  readonly onProgress?: (line: string) => void;
}

export interface SessionLine {
  readonly day: number;
  readonly scope: string;
  readonly turns: number;
  /** Footnotes the turns' recall showed, in all. */
  readonly footnotes: number;
  /** Stop asks the session got, and how many the model answered. */
  readonly asks: number;
  readonly memoriesAfter: number;
  readonly failedTurns: number;
  readonly init: ChildInit | null;
}

export interface WeekRecord {
  readonly harness: "owner-week";
  readonly owner: string;
  readonly ranAt: string;
  readonly elapsedMs: number;
  readonly days: number;
  readonly sessions: readonly SessionLine[];
  readonly nights: readonly { readonly day: number; readonly state: string; readonly parts: readonly string[] }[];
  /** Live memories at the end of each day, and the core's size. */
  readonly daily: readonly { readonly day: number; readonly date: string; readonly alive: number; readonly core: number }[];
  /** The week's store as one file, when `out` asked. */
  readonly out: string | null;
  readonly keptAt: string | null;
}

function dateAt(start: string, days: number): string {
  return new Date(Date.parse(`${start}T12:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
}

/** A local hour on a date, as an instant (the store's zone is the harness's, UTC by default). */
function at(date: string, hour: number): number {
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
}

/** The reply's text from a child's stream-json output (its `result` line), or "". */
export function replyOf(output: string | undefined): string {
  for (const line of (output ?? "").split("\n").reverse()) {
    if (!line.includes('"result"')) continue;
    try {
      const o = JSON.parse(line) as { type?: string; result?: unknown };
      if (o.type === "result" && typeof o.result === "string") return o.result;
    } catch {
      continue;
    }
  }
  return "";
}

/** A hook's words as the model sees them in a live session: beside its turn, as a system reminder. */
function reminded(injection: string, text: string): string {
  return injection.trim().length === 0 ? text : `<system-reminder>\n${injection.trim()}\n</system-reminder>\n\n${text}`;
}

interface TurnChild {
  readonly dir: string;
  readonly configPath: string;
  readonly session: string;
  readonly scope: string;
  readonly now: number;
  readonly first: boolean;
  readonly prompt: string;
}

/** One turn of a person's session, planned as the night's child is locked down, but with the session's tools, its folder, and `--resume`. */
export function planTurn(opts: WeekOptions, t: TurnChild): ChildPlan & { ok: boolean; reason: string } {
  const plan = planNightChild({
    config: { dataDir: t.dir, owner: true, injectionBudgetBytes: opts.budgetBytes ?? 9_000, ...(opts.model === undefined ? {} : { dreaming: { model: opts.model } }) },
    run: "owner-week",
    prompt: t.prompt,
    scope: t.scope,
    session: t.session,
    tools: [...SESSION_TOOLS],
    configPath: t.configPath,
    baseEnv: Object.fromEntries(
      Object.entries(opts.env ?? process.env).filter(([k]) => !k.startsWith("COUNTERPARTS_") && !k.startsWith("CLAUDE_") && !k.startsWith("ANTHROPIC_") && !k.startsWith("HARNESS_") && k !== "CLAUDECODE"),
    ),
    maxTurns: 20,
    timeoutMs: 10 * MIN,
    readOutput: true,
  });
  const parent = opts.env ?? process.env;
  const server = {
    type: "stdio",
    command: process.execPath,
    args: [SERVE_AT_SCRIPT],
    env: {
      ...(parent["PATH"] === undefined ? {} : { PATH: parent["PATH"] }),
      ...(parent["HOME"] === undefined ? {} : { HOME: parent["HOME"] }),
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      [SERVE_AT_ENV.dir]: t.dir,
      [SERVE_AT_ENV.now]: String(t.now),
      [SERVE_AT_ENV.budget]: String(opts.budgetBytes ?? 9_000),
      [SERVE_AT_ENV.session]: t.session,
      [SERVE_AT_ENV.scope]: t.scope,
      [SERVE_AT_ENV.owner]: "1",
      ...(opts.timeZone === undefined ? {} : { [SERVE_AT_ENV.timeZone]: opts.timeZone }),
    },
  };
  const args = [...plan.args];
  const mcp = args.indexOf("--mcp-config");
  args[mcp + 1] = JSON.stringify({ mcpServers: { counterparts: server } });
  args.push("--setting-sources", "project", ...(t.first ? ["--session-id", t.session] : ["--resume", t.session]));
  const env = { ...plan.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
  delete (env as Record<string, string>)["COUNTERPARTS_NIGHT_RUN"];
  return { ...plan, args, env, cwd: t.scope };
}

/** Run the scripted week. */
export async function runWeek(opts: WeekOptions = {}): Promise<WeekRecord> {
  const started = Date.now();
  const env = opts.env ?? process.env;
  const preset = env["COUNTERPARTS_DATA_DIR"];
  if (preset !== undefined && preset.trim().length > 0) throw new Error("DATA_DIR_PRESET: the harness makes its own store");
  const script = (opts.script ?? OWNER_WEEK).slice(0, opts.days ?? (opts.script ?? OWNER_WEEK).length);
  const startDate = opts.startDate ?? "2026-03-02";
  const timeZone = opts.timeZone ?? "UTC";
  const root = resolve(opts.workRoot ?? tmpdir());
  if (underLiveRoot(root, env)) throw new Error(`TARGET_IS_LIVE: ${root}`);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const work = mkdtempSync(join(realpathSync(root), "counterparts-week-"));
  const dir = join(work, "store");
  mkdirSync(dir);
  const configPath = join(work, "harness-config.json");
  const budget = opts.budgetBytes ?? 9_000;
  const config = { dataDir: dir, owner: true, injectionBudgetBytes: budget, timeZone };
  writeFileSync(configPath, JSON.stringify(config));
  const start = opts.start ?? ((p: ChildPlan): Promise<ChildResult> => startChild(p));
  const say = (line: string): void => opts.onProgress?.(line);

  let clock = at(startDate, 9);
  const now = (): number => clock;
  const embedder = openEmbedder({ embedder: { enabled: true } });
  const open = (): Counterpart => Counterpart.open({ dir, owner: true, budgetBytes: budget, now, timeZone, ...(embedder === null ? {} : { embed: embedder.embed }) });
  const counterpart = open();
  // AS A NEW INSTALL BEGINS: the meeting waits for the first session, dreaming is on.
  if (opts.install !== false) counterpart.store.setMetaMany(NEW_INSTALL_META);
  const adapter = new ClaudeCodeAdapter({ counterpart, config, now, command: "/bin/true", args: ["harness-no-worker"], spawner: () => ({ pid: 0 }) });

  const sessions: SessionLine[] = [];
  const nights: { day: number; state: string; parts: string[] }[] = [];
  const daily: { day: number; date: string; alive: number; core: number }[] = [];
  const projects: string[] = [];
  let last: { session: string; scope: string } | null = null;
  try {
    for (const [d, day] of script.entries()) {
      const date = dateAt(startDate, d);
      // THE NIGHT, the morning after a day that had sessions, as live runs it at the day's first session.
      if (d > 0 && opts.nights !== false && last !== null) {
        clock = at(date, 6);
        say(`day ${String(d + 1)} ${date}: night`);
        const run = await runNight({
          open,
          config,
          run: `nrn_week_${String(d)}`,
          session: last.session,
          scope: last.scope,
          kind: { kind: "night" },
          seat: modelSeat({ dir, configPath, now, timeZone, budgetBytes: budget, env, ...(opts.model === undefined ? {} : { model: opts.model }), ...(opts.start === undefined ? {} : { start: opts.start }) }),
          now,
        });
        nights.push({ day: d + 1, state: run.state, parts: [...(run.parts ?? [])] });
      }
      for (const [k, s] of day.sessions.entries()) {
        clock = at(date, 10 + k * 9);
        const sessionId = randomUUID();
        const scope = join(work, s.scope);
        mkdirSync(scope, { recursive: true });
        projects.push(scope);
        const base = (): HookInput => ({ sessionId, scope, at: date, turns: [...log] });
        const log: { role: "user" | "assistant"; text: string }[] = [];
        recordSession(dir, { sessionId, scope, phase: "start", at: clock });
        say(`day ${String(d + 1)} ${date}: session ${String(k + 1)} (${s.scope}), ${String(s.turns.length)} turns`);
        const woke = adapter.sessionStart({ ...base(), source: "startup" });
        let pending = [woke.injection, woke.ask ?? ""].filter((x) => x.length > 0).join("\n\n");
        let first = true;
        let footnotes = 0;
        let asks = 0;
        let failed = 0;
        let init: ChildInit | null = null;
        const turn = async (prompt: string): Promise<string> => {
          const plan = planTurn(opts, { dir, configPath, session: sessionId, scope, now: clock, first, prompt });
          first = false;
          const result = await start(plan);
          if (init === null) init = childInit(result.output);
          if (result.code !== 0) failed += 1;
          clock += 3 * MIN;
          return replyOf(result.output);
        };
        for (const text of s.turns) {
          const said = adapter.userPromptSubmit({ ...base(), prompt: text });
          footnotes += said.footnotes.length;
          const context = [pending, said.injection, said.ask ?? ""].filter((x) => x.length > 0).join("\n\n");
          pending = "";
          log.push({ role: "user", text });
          const reply = await turn(reminded(context, text));
          log.push({ role: "assistant", text: reply });
          // THE STOP, and its ask: put to the model as the conversation's next message.
          const stopped = adapter.stop({ ...base() });
          if (stopped.ask !== null && stopped.ask.length > 0) {
            asks += 1;
            const answer = await turn(reminded(stopped.ask, "(Stop hook feedback)"));
            log.push({ role: "assistant", text: answer });
            adapter.stop({ ...base(), reFired: true });
          }
        }
        adapter.sessionEnd({ ...base() });
        recordSession(dir, { sessionId, scope, phase: "end", at: clock });
        // THE BOUNDARY the worker would run, on the harness's clock.
        await counterpart.sessionEnd({ date, sweep: { skipped: "not-opted-in" } });
        last = { session: sessionId, scope };
        sessions.push({ day: d + 1, scope: s.scope, turns: s.turns.length, footnotes, asks, memoriesAfter: count(dir, "SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND type = 'memory'"), failedTurns: failed, init });
      }
      daily.push({
        day: d + 1,
        date,
        alive: count(dir, "SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND type = 'memory'"),
        core: count(dir, "SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND band = 'identity'"),
      });
    }
    // The last day's night, so its memories are consolidated as the next morning would.
    if (opts.nights !== false && last !== null) {
      const date = dateAt(startDate, script.length);
      clock = at(date, 6);
      say(`day ${String(script.length + 1)} ${date}: night`);
      const run = await runNight({
        open,
        config,
        run: `nrn_week_${String(script.length)}`,
        session: last.session,
        scope: last.scope,
        kind: { kind: "night" },
        seat: modelSeat({ dir, configPath, now, timeZone, budgetBytes: budget, env, ...(opts.model === undefined ? {} : { model: opts.model }), ...(opts.start === undefined ? {} : { start: opts.start }) }),
        now,
      });
      nights.push({ day: script.length + 1, state: run.state, parts: [...(run.parts ?? [])] });
      await counterpart.sessionEnd({ date, sweep: { skipped: "not-opted-in" } });
    }
  } finally {
    counterpart.close();
  }
  let out: string | null = null;
  if (opts.out !== undefined) {
    if (underLiveRoot(opts.out, env)) throw new Error("TARGET_IS_LIVE: out");
    copyFileSync(join(dir, "counterparts.sqlite"), opts.out);
    const db = new Database(opts.out);
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    db.run("PRAGMA journal_mode = DELETE");
    db.close();
    out = opts.out;
  }
  if (opts.keep !== true) {
    rmSync(work, { recursive: true, force: true });
    // Each child's transcript, under ~/.claude/projects, named after its folder.
    for (const p of [...new Set([dir, ...projects])]) {
      const slug = p.replace(/[^A-Za-z0-9-]/g, "-");
      const folder = join(env["HOME"] ?? homedir(), ".claude", "projects", slug);
      if (slug.includes("counterparts-week-") && existsSync(folder)) rmSync(folder, { recursive: true, force: true });
    }
  }
  return {
    harness: "owner-week",
    owner: OWNER_NAME,
    ranAt: new Date(started).toISOString(),
    elapsedMs: Date.now() - started,
    days: script.length,
    sessions,
    nights,
    daily,
    out,
    keptAt: opts.keep === true ? work : null,
  };
}

function count(dir: string, sql: string): number {
  const db = new Database(join(dir, "counterparts.sqlite"), { readonly: true });
  try {
    return Number((db.query(sql).get() as { n: number } | null)?.n ?? 0);
  } finally {
    db.close();
  }
}
