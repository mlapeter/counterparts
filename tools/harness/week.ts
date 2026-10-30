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
 * TIER 0 (2026-10-26, `seat: "scripted"`): the same host with no model in the
 * seat. Each line gets the script's reply and its scripted tool calls, made
 * through the memory's own server in-process; the nights run `runNight` with
 * a seat that answers the catch-up (through the real write-up door) and the
 * dream (an empty journal) by a script, and refuses the rest
 * (`scriptedNightSeat`). Every model child of
 * either seat goes through one starter, counted in `modelCalls`.
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

import { ClaudeCodeAdapter, doctorFindings, NIGHT_CHILD_ENV, NIGHT_DENIED_TOOLS, NIGHT_KIND_ENV, NIGHT_RUN_ENV, catchUpOf, expansionIdsOf, openEmbedder, planCatchUp, planNightChild, readKind, runNight, startChild } from "../../src/adapters/claude-code/index.js";
import type { ChildPlan, ChildResult, HookInput, NightAnswer, NightStarter, SpawnPlan } from "../../src/adapters/claude-code/index.js";
import { coverageReading } from "../../src/adapters/cli/commands.js";
import type { CoverageRow } from "../../src/adapters/cli/commands.js";
import type { TurnExpansion } from "../../src/adapters/lifecycle.js";
import { McpServer } from "../../src/adapters/mcp/index.js";
import { lookupScope, readScopes, scopesPath, setScope, writeScopes } from "../../src/adapters/scopes.js";
import { readSession } from "../../src/adapters/sessions.js";
import { ADAPTER_ASK_EVENT, Counterpart, coreFromBeliefs } from "../../src/core/counterpart.js";
import type { PlainReminder, Seat, SeatAsk } from "../../src/core/counterpart.js";

import { childInit, modelSeat, SERVE_AT_SCRIPT } from "./model-seat.js";
import type { ChildInit } from "./model-seat.js";
import { OWNER_NAME, OWNER_WEEK, SCRIPTED_GAP_MIN, SCRIPTED_REPLY, turnOf } from "./owner-week.js";
import type { ScriptedDay } from "./owner-week.js";
import { SERVE_AT_ENV } from "./serve-at.js";
import { pageReading } from "./page.js";
import type { PageReading } from "./page.js";
import { SETTINGS_ENV, appliedSettings, runningBuild, settingsForChild, tunableNow } from "./settings.js";
import type { Setting } from "./settings.js";
import { settledOf } from "./settled.js";
import type { SettledReading } from "../../src/adapters/cli/commands.js";
import { recordUsage, totalTokens, usageByAct, usageTally } from "./usage.js";
import type { UsageTally } from "./usage.js";
import { underLiveRoot } from "./source.js";

/** The memory tools a person's session has, as the host names them. Not the night's dream or reflection. */
export const SESSION_TOOLS: readonly string[] = ["recall", "remember", "session_end", "chapter", "self_page", "meet", "status", "scope"].map((t) => `mcp__counterparts__${t}`);

const MIN = 60_000;
const HOUR = 60 * MIN;

/** When a day's sessions start, in the store's zone's hours: the first at 10, then 15, 19, 21. */
const SESSION_HOURS = [10, 15, 19, 21] as const;

/** The day's dream line as a hook result carries it (`hooks.ts#DreamTold`, not among the public names). */
type DreamTold = NonNullable<ReturnType<ClaudeCodeAdapter["sessionStart"]>["dream"]>;

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
  /** The script's name, for the record (default "plain"). */
  readonly scriptName?: string;
  /** The scripted person's name, for the record (default Dana). */
  readonly owner?: string;
  /**
   * Who sits in the counterpart's seat (default `"model"`). `"scripted"`
   * (tier 0, 2026-10-26): NO model. Each line gets the script's canned reply
   * and its scripted tool calls, through the memory's own server in-process;
   * a Stop ask is answered as the script says; the nights run `runNight` with
   * a seat that records each ask and starts nothing.
   */
  readonly seat?: "model" | "scripted";
  /** Where to write the self page's words at the week's end (`page.ts`); never into the record. */
  readonly pageOut?: string;
  /** How many of the script's days to run (default all). */
  readonly days?: number;
  /** The calendar date of day one. */
  readonly startDate?: string;
  readonly timeZone?: string;
  readonly budgetBytes?: number;
  readonly model?: string;
  /** Run the nights (default true). */
  readonly nights?: boolean;
  /**
   * Begin as a new install does (default true): the meeting offered, dreaming
   * on. `"without-meeting"`: dreaming on, the meeting not offered (an owner
   * who skipped it; the night's gate waits while a meeting is pending).
   * `false`: a bare store.
   */
  readonly install?: boolean | "without-meeting";
  readonly workRoot?: string;
  /** Where to write the week's store as one file, for `cli.ts replay`. */
  readonly out?: string;
  readonly keep?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** TESTS ONLY: the starter for every child, in place of a real `claude -p`. */
  readonly start?: NightStarter;
  readonly onProgress?: (line: string) => void;
}

/**
 * ONE SESSION AS THE COVERAGE LEDGER JUDGED IT once it ended (2026-10-26,
 * `cli/coverage.ts#coverageReading`, the reading `counterparts coverage`
 * prints). Counts and minutes only.
 */
export interface SessionCoverage {
  /** Pieces captured (the person's lines and jots), and how many are written up. */
  readonly pieces: number;
  readonly written: number;
  readonly unwritten: number;
  /** The unwritten stretch, first piece to last, in minutes; null when nothing is unwritten. */
  readonly spanMin: number | null;
  readonly state: string;
  readonly overFloor: boolean;
  /** Owed a write-up, and a person's session (the catch-up's own filter). */
  readonly owed: boolean;
  /**
   * Why it is not owed, or null when it is: `written` (nothing unwritten),
   * `active`, `lapsed`, `under-floor:pieces` / `under-floor:span` (named
   * against `coverage.OWED_PIECES` / `OWED_SPAN_MS` as set for the run),
   * `not-a-person`.
   */
  readonly whyNot: string | null;
}

export interface SessionLine {
  readonly day: number;
  /** `d<day>s<n>`: how the record names this session elsewhere (the catch-up plan, the wakes). */
  readonly label: string;
  readonly scope: string;
  readonly turns: number;
  /** Footnotes the turns' recall showed, in all. */
  readonly footnotes: number;
  /** Stop asks the session got. */
  readonly asks: number;
  /** Stops at a turn's end (not the re-fired ones): each either asked or was paced. */
  readonly stops: number;
  /** Stops that asked nothing: `stops - asks`. */
  readonly paced: number;
  /** The pacer's own word on each Stop (`adapter.ask` rows), counted as `outcome:reason` ("paced:not-enough-substance", "asked:…"). */
  readonly stopReasons: Readonly<Record<string, number>>;
  /** A scripted seat's: asks answered with `session_end`, and left unanswered. Null for a model, which decides itself. */
  readonly asksAnswered: number | null;
  readonly asksIgnored: number | null;
  /** A scripted seat's `remember` calls that landed, and that the server refused. Null for a model. */
  readonly remembers: number | null;
  readonly remembersRefused: number | null;
  /** A scripted seat's `chapter` calls that landed, and that the server refused. Null for a model. */
  readonly chapters: number | null;
  readonly chaptersRefused: number | null;
  readonly memoriesAfter: number;
  readonly failedTurns: number;
  readonly init: ChildInit | null;
  /** The ledger's word on it right after its end; null when it captured nothing the ledger holds. */
  readonly coverage: SessionCoverage | null;
}

/** What a night's catch-up would write up, planned before the night runs (`planCatchUp`, nothing written). */
export interface NightCatchUp {
  /** Sessions owing a write-up the catch-up could take. */
  readonly owed: number;
  /** The first batch's sessions, by label (`?` for one not from this week), with the parts it would read of each. */
  readonly planned: readonly { readonly session: string; readonly parts: number; readonly of: number }[];
  /** The run's own row afterwards (`night.write-up`), or null when it wrote none (nothing owed). */
  readonly ran: { readonly state: string; readonly granted: number; readonly written: number; readonly left: number; readonly partsLeft: number | null } | null;
}

/** One SessionStart's wake, read for its furniture: which session "Last here" names, and the lines around it, by kind. */
export interface WakeLine {
  readonly day: number;
  /** The session it opened, by label. */
  readonly label: string;
  /** The day's first session: the morning's wake. */
  readonly morning: boolean;
  /** "Last here": the chapter it names and the session that wrote it (by label; `?` when not this week's) — or, for a later session with no chapter (S2), that session and no episode — or null when the wake has none. */
  readonly lastHere: { readonly episode: string | null; readonly session: string } | null;
  /** "Last said here": the session it quotes (by label), or null. */
  readonly lastSaid: string | null;
  /** The dream's gate as the session's first prompt finds it (`Dreams#status`): its reason, and the new memories it counted (a floor at `MIN_NEW`). */
  readonly gate: { readonly reason: string; readonly newSince: number };
  /** The furniture lines it carried, by their opening words ("Last here", "Yesterday", "Handoff", ...), never their text. */
  readonly lines: readonly string[];
  readonly bytes: number;
  /** A morning's `doctor` Catch-up line, read through the real doctor at the session start, before the first prompt launches the night (S2c, 2026-10-26); null on a later session. */
  readonly doctor: { readonly severity: string; readonly detail: string } | null;
}

export interface WeekRecord {
  readonly harness: "owner-week";
  readonly owner: string;
  /** Which script ran ("plain" unless named). */
  readonly script: string;
  /** The build that ran (`package.json#version`, or "unknown"). */
  readonly build: string;
  /** Tunables this run set from outside (`settings.ts`); empty for the build as it is. */
  readonly settings: readonly Setting[];
  /** The model children's tokens, all turns and nights. */
  readonly usage: UsageTally;
  /** The night children's tokens by act (`catch-up`, `writer`, `dream`, ...); empty with the scripted seat. */
  readonly usageByAct?: Readonly<Record<string, UsageTally>>;
  /** The self page at the week's end, by numbers. */
  readonly page: PageReading | { readonly error: string } | null;
  readonly ranAt: string;
  readonly elapsedMs: number;
  readonly days: number;
  /** Who sat in the seat: "model" or "scripted" (tier 0, no model). */
  readonly seat: "model" | "scripted";
  /**
   * How the store began (`WeekOptions.install` as it took effect): `"new"`, a
   * new install with the meeting offered; `"without-meeting"`, an owner who
   * skipped it (a scripted seat's default: no model is there to hold it, and
   * the gate waits while one is pending); `"bare"`, no install meta. A
   * harness choice, not the product's new-install path.
   */
  readonly install: "new" | "without-meeting" | "bare";
  /** Model children started, turns and nights: every call to the starter. 0 for a scripted seat, by construction and by count. */
  readonly modelCalls: number;
  readonly sessions: readonly SessionLine[];
  /**
   * The nights the product launched (its gate decided), by the morning they
   * ran on. `asked`: the acts the night put to its seat, in order (a
   * scripted seat refuses each, so a refused dream ends the run before its
   * reflection and tags are reached). `catchUp`: what it would write up (null for a reflection run, which has none).
   */
  readonly nights: readonly { readonly day: number; readonly launchedIn: string; readonly state: string; readonly kind: string; readonly parts: readonly string[]; readonly asked: readonly { readonly act: string; readonly promptBytes: number; readonly tokens?: number | null }[]; readonly catchUp: NightCatchUp | null }[];
  /** Every SessionStart's wake, read for "Last here" and its neighbours. */
  readonly wakes: readonly WakeLine[];
  /** Sessions owed a write-up at the week's end, by label (the ledger's word then). */
  readonly owedAtEnd: readonly string[];
  /** Worker boundaries the product asked for (each Stop and session end), run by the harness. */
  readonly boundaries: number;
  /**
   * Live memories at the end of each day, and the core's size: the lanes'
   * (`band = 'identity'`), and lane F's from beliefs — beliefs about me and
   * us passing `self`'s floors as set for the run (`self/measures.ts#coreFromBeliefs`),
   * counted whether or not `self.CORE_FROM_BELIEFS` is on, of `beliefs` on the self subject.
   */
  readonly daily: readonly { readonly day: number; readonly date: string; readonly alive: number; readonly core: number; readonly beliefCore: number; readonly beliefs: number }[];
  /** The week's store as one file, when `out` asked. */
  readonly out: string | null;
  /** Settled things repeated, re-raised, shown, over the week's whole record (`settled.ts`). */
  readonly settled: SettledReading | null;
  readonly keptAt: string | null;
}

function dateAt(start: string, days: number): string {
  return new Date(Date.parse(`${start}T12:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
}

/** An hour on a date, as an instant, in UTC (the store's zone defaults to UTC; with another zone the hours are UTC's). */
function at(date: string, hour: number): number {
  return Date.parse(`${date}T00:00:00Z`) + Math.min(Math.max(hour, 0), 23) * HOUR;
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

/**
 * THE NIGHT'S SEAT WITH NO MODEL (tier 0, 2026-10-26). With no `script` it
 * refuses every ask, so nothing starts (the week records each ask by act and
 * size), and `runNight` still runs everything that needs no model: the gate
 * that launched it, the catch-up's plan, grant and release, the run's row. A
 * refused dream ends the run, so the reflection and the tags are never asked.
 *
 * WITH `script` (S2, 2026-10-26; what `runWeek` passes) two acts are answered
 * by a script, through the memory's own server in-process, bound as that
 * child's server is — and the rest (the writer, the reflection, the tags) are
 * still refused:
 *   - THE CATCH-UP, through the real write-up door (`mcp/write-up.ts`): every
 *     session the runner was granted is fetched part by part and each part
 *     answered with one canned second-hand memory. So a night clears what it
 *     was granted and the next night plans only what is new — a refusing one
 *     re-planned everything owed so far each night;
 *   - THE DREAM, as the smallest real dream: `begin`, then `journal` with a
 *     canned line, changing nothing. So the dream's queue drains each night as
 *     a real dream's does, and the next morning's gate counts only what is new
 *     since — a refused dream never journaled, and the gate read the whole
 *     week's memories as new every morning.
 * No model: every word it writes says it is the harness's.
 */
export function scriptedNightSeat(script?: { readonly open: () => Counterpart; readonly now: () => number }): Seat<NightAnswer> {
  const refused: NightAnswer = { refused: "harness:scripted", started: false, code: null, timedOut: false, error: null, ms: 0 };
  const done: NightAnswer = { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 0 };
  return {
    name: "harness:scripted",
    async answer(ask: SeatAsk): Promise<NightAnswer> {
      if (script === undefined || (ask.act !== "catch-up" && ask.act !== "dream")) return refused;
      const c = script.open();
      try {
        const server = new McpServer({ counterpart: c, session: ask.session, scope: ask.scope, now: script.now, env: ask.act === "dream" ? { [NIGHT_CHILD_ENV]: "dream" } : {} });
        if (ask.act === "dream") {
          const begun = (await server.call("dream", { phase: "begin", session: ask.session })).structuredContent;
          if (typeof begun["dream"] === "string") {
            await server.call("dream", { phase: "journal", dream: begun["dream"], session: ask.session, title: "A scripted night", text: "A scripted dream that changed nothing (harness tier 0, no model)." });
          }
          return done;
        }
        const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => (await server.call("session_end", { session: ask.session, ...args })).structuredContent;
        for (const subject of readSession(c.store.dir, ask.session)?.mayWriteUp ?? []) {
          // At most the parts the door says there are, and a guard against a door that loops.
          for (let guard = 0; guard < 64; guard++) {
            const part = await call({ writeUp: subject });
            if (part["reason"] !== "part") break;
            const n = Number(part["part"]);
            const of = Number(part["of"]);
            const lived = typeof part["endedOn"] === "string" ? part["endedOn"] : "an earlier day";
            const back = await call({
              writeUp: subject,
              part: n,
              memories: [{ content: `A scripted second-hand write-up of session ${subject.slice(0, 8)}, part ${String(n)} of ${String(of)}, lived ${lived} (harness tier 0, no model).` }],
            });
            if (back["reason"] !== "part-written") break;
          }
        }
        return done;
      } finally {
        c.close();
      }
    },
  };
}

/** Why a ledger row is not owed, against the floor as set for this run; null when it is owed. Pure. */
export function whyNotOwed(e: CoverageRow, floor: { pieces: number; spanMs: number } = coverageFloor()): string | null {
  if (e.owed && e.person) return null;
  if (e.stretch === null) return "written";
  if (e.state === "active") return "active";
  if (e.lapsed) return "lapsed";
  if (!e.overFloor) return e.stretch.pieces < floor.pieces ? "under-floor:pieces" : e.stretch.lastAt - e.stretch.firstAt < floor.spanMs ? "under-floor:span" : "under-floor";
  if (!e.person) return "not-a-person";
  return "not-owed";
}

/** The floor a stretch must pass to be owed, as set for this run (`--set coverage.OWED_PIECES=…` moves it). */
function coverageFloor(): { pieces: number; spanMs: number } {
  const pieces = tunableNow("coverage", "OWED_PIECES");
  const spanMs = tunableNow("coverage", "OWED_SPAN_MS");
  return { pieces: typeof pieces === "number" ? pieces : 3, spanMs: typeof spanMs === "number" ? spanMs : 15 * MIN };
}

/** A ledger row as the record keeps it: counts and minutes. Pure. */
export function sessionCoverage(e: CoverageRow): SessionCoverage {
  const unwritten = e.stretch?.pieces ?? 0;
  return {
    pieces: e.pieces,
    written: e.written,
    unwritten,
    spanMin: e.stretch === null ? null : e.stretch.minutes,
    state: e.state,
    overFloor: e.overFloor,
    owed: e.owed && e.person,
    whyNot: whyNotOwed(e),
  };
}

/**
 * THE WAKE'S FURNITURE, by kind (the lines spliced around the bundle: "Last
 * here", "Before it", "Last said here", "Yesterday", the handoff pointer…).
 * Matched by their opening words; the record keeps the kinds, never a line.
 */
const FURNITURE: readonly (readonly [RegExp, string])[] = [
  // One block since WK1 (2026-10-30, `core/handoff/index.ts`): a session's chapter, last
  // words and handoff on one line, read below as the kinds they were.
  [/^Where this folder stands:/, "Last here"],
  [/^Before that:/, "Before it"],
  [/^Yesterday\b/, "Yesterday"],
  [/^Today so far\b/, "Today so far"],
  [/^Today, elsewhere\b/, "Today, elsewhere"],
  [/^Since you started\b/, "Since you started"],
  [/^About me, from another directory\b/, "About me, elsewhere"],
  // The other handoffs and the "since" line, as the wake prints them (`test/continuity.test.ts`).
  [/^Other handoffs here\b/, "Handoff"],
  [/^Since (?:this handoff|the newest handoff here):/, "Since this handoff"],
  [/^Still open\b/, "Still open"],
];

/** One wake read for "Last here" and its neighbours. `sessionOf` maps an episode to the session that wrote it; `label` a session id (or its first 8 characters) to its label. */
export function readWake(injection: string, sessionOf: (episode: string) => string | null, label: (session: string) => string): Pick<WakeLine, "lastHere" | "lastSaid" | "lines" | "bytes"> {
  const lines: string[] = [];
  let lastHere: WakeLine["lastHere"] = null;
  let lastSaid: string | null = null;
  for (const raw of injection.split("\n")) {
    const line = raw.trim();
    const kind = FURNITURE.find(([re]) => re.test(line))?.[1];
    if (kind === undefined) continue;
    lines.push(kind);
    // Who a line of the block names, and what it carries.
    const who = /^(?:Where this folder stands|Before that): (?:a handoff from )?session ([^,\s]+)/.exec(line)?.[1];
    if (/\(sch_[0-9a-f]+\)/.test(line)) lines.push("Handoff");
    if (/\b[Ll]ast said /.test(line)) {
      lines.push("Last said here");
      if (lastSaid === null && who !== undefined) lastSaid = label(who);
    }
    if (kind === "Last here" && lastHere === null) {
      const episode = /\bepi_[A-Za-z0-9_-]+/.exec(line)?.[0] ?? null;
      if (episode !== null) {
        const s = sessionOf(episode);
        lastHere = { episode, session: s === null ? "?" : label(s) };
      } else {
        // A LATER SESSION WITH NO CHAPTER (S2): the line names the session itself.
        if (who !== undefined && !/^Where this folder stands: a handoff from /.test(line)) lastHere = { episode: null, session: label(who) };
      }
    }
  }
  return { lastHere, lastSaid, lines, bytes: Buffer.byteLength(injection, "utf8") };
}

/** The ids and handles the model opened with the recall tool in one turn, read from its stream-json as live reads a transcript. */
export function recalledIds(output: string | undefined): string[] {
  const out: string[] = [];
  for (const line of (output ?? "").split("\n")) {
    if (!line.includes("mcp__counterparts__recall")) continue;
    try {
      const o = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      if (o.type !== "assistant" || !Array.isArray(o.message?.content)) continue;
      for (const b of o.message.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (b.type !== "tool_use" || b.name !== "mcp__counterparts__recall") continue;
        // As live reads them, through the same public seam: the handle, then every id, unfiltered;
        // a handle or title is resolved at the boundary through the server's resolution log.
        out.push(...expansionIdsOf(b.input));
      }
    } catch {
      continue;
    }
  }
  return [...new Set(out)];
}

interface TurnChild {
  readonly dir: string;
  readonly configPath: string;
  readonly session: string;
  readonly scope: string;
  readonly now: number;
  readonly first: boolean;
  readonly prompt: string;
  /** The folder registry the session's server reads (the meeting's "where", the scope tool). */
  readonly scopesFile?: string;
}

/** One turn of a person's session, planned as the night's child is locked down, but with the session's tools, its folder, and `--resume`. */
export function planTurn(opts: WeekOptions, t: TurnChild): ChildPlan & { ok: boolean; reason: string } {
  const plan = planNightChild({
    config: { dataDir: t.dir, injectionBudgetBytes: opts.budgetBytes ?? 9_000, ...(opts.model === undefined ? {} : { dreaming: { model: opts.model } }) },
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
      ...(t.scopesFile === undefined ? {} : { [SERVE_AT_ENV.scopes]: t.scopesFile }),
      ...(opts.timeZone === undefined ? {} : { [SERVE_AT_ENV.timeZone]: opts.timeZone }),
      ...(settingsForChild() === "" ? {} : { [SETTINGS_ENV]: settingsForChild() }),
    },
  };
  // A PERSON'S SESSION IS KEPT (2026-10-21): the night child's
  // `--no-session-persistence` is dropped, because a turn after the first
  // `--resume`s this session and its hooks read its transcript.
  // Nor is it slim (2026-10-23): a person's session has the host's own
  // system prompt and its built-in set (still fenced by `--disallowedTools`),
  // so `--tools ""` and the night's `--system-prompt` go, each with its value,
  // and its deny list is the built-ins alone: a real session is offered every
  // tool of ours, granted or not (the night denies the ones it does not grant).
  const args = plan.args.filter((a) => a !== "--no-session-persistence");
  for (const flag of ["--tools", "--system-prompt"]) {
    const at = args.indexOf(flag);
    if (at >= 0) args.splice(at, 2);
  }
  args[args.indexOf("--disallowedTools") + 1] = NIGHT_DENIED_TOOLS.join(",");
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
  if (opts.out !== undefined && underLiveRoot(opts.out, env)) throw new Error("TARGET_IS_LIVE: out");
  const script = (opts.script ?? OWNER_WEEK).slice(0, opts.days ?? (opts.script ?? OWNER_WEEK).length);
  const startDate = opts.startDate ?? "2026-03-02";
  const timeZone = opts.timeZone ?? "UTC";
  const root = resolve(opts.workRoot ?? tmpdir());
  if (underLiveRoot(root, env)) throw new Error(`TARGET_IS_LIVE: ${root}`);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const work = mkdtempSync(join(realpathSync(root), "counterparts-week-"));
  const dir = join(work, "store");
  mkdirSync(dir);
  const projects: string[] = [];
  try {
    return await weekIn(opts, { work, dir, script, startDate, timeZone, env, started, projects });
  } finally {
    if (opts.keep !== true) {
      rmSync(work, { recursive: true, force: true });
      // Each child's transcript, under ~/.claude/projects, named after its folder.
      for (const p of [...new Set([dir, ...projects])]) {
        const slug = p.replace(/[^A-Za-z0-9-]/g, "-");
        const folder = join(env["HOME"] ?? homedir(), ".claude", "projects", slug);
        if (slug.includes("counterparts-week-") && existsSync(folder)) rmSync(folder, { recursive: true, force: true });
      }
    }
  }
}

interface WeekRun {
  readonly work: string;
  readonly dir: string;
  readonly script: readonly ScriptedDay[];
  readonly startDate: string;
  readonly timeZone: string;
  readonly env: NodeJS.ProcessEnv;
  readonly started: number;
  readonly projects: string[];
}

async function weekIn(opts: WeekOptions, w: WeekRun): Promise<WeekRecord> {
  const { work, dir, script, startDate, timeZone, env } = w;
  const configPath = join(work, "harness-config.json");
  const budget = opts.budgetBytes ?? 9_000;
  const config = { dataDir: dir, injectionBudgetBytes: budget, timeZone };
  writeFileSync(configPath, JSON.stringify(config));
  // THE FOLDERS, settled as a person who said "on" everywhere here: the
  // registry beside the config (`scopes.ts#scopesPath`), so no first-launch
  // question rides every wake and the meeting has its answer.
  const scopesFile = scopesPath(configPath);
  const registry = setScope(null, work, "on", { at: startDate });
  writeScopes(scopesFile, registry);
  // EVERY MODEL CHILD GOES THROUGH HERE, turns and nights alike, and is
  // counted: a scripted seat's record says 0 because nothing called it.
  let modelCalls = 0;
  const start = (p: ChildPlan): Promise<ChildResult> => {
    modelCalls += 1;
    return (opts.start ?? ((q: ChildPlan): Promise<ChildResult> => startChild(q)))(p);
  };
  const scripted = opts.seat === "scripted";
  const say = (line: string): void => opts.onProgress?.(line);
  const turnOpts: WeekOptions = { ...opts, timeZone };
  // HOW THE RECORD NAMES A SESSION: `d<day>s<n>`, from its id or the id's first 8 characters (a wake line's spelling).
  const labels = new Map<string, string>();
  const labelOf = (session: string): string => {
    const exact = labels.get(session);
    if (exact !== undefined) return exact;
    for (const [id, l] of labels) if (session.length >= 8 && id.startsWith(session)) return l;
    return "?";
  };

  let clock = at(startDate, 0);
  const now = (): number => clock;
  const embedder = openEmbedder({ embedder: { enabled: true } });
  const open = (): Counterpart => Counterpart.open({ dir, budgetBytes: budget, now, timeZone, ...(embedder === null ? {} : { embed: embedder.embed }) });
  const counterpart = open();
  // AS A NEW INSTALL BEGINS: the meeting waits for the first session, dreaming is on.
  // A SCRIPTED SEAT BEGINS WITHOUT THE MEETING by default: the night's gate waits while one is pending, and no model is there to hold it.
  const install = opts.install ?? (scripted ? "without-meeting" : true);
  if (install !== false) counterpart.store.setMetaMany(install === "without-meeting" ? NEW_INSTALL_META.filter(([k]) => k !== "onboarding.meet") : NEW_INSTALL_META);

  // THE PRODUCT DECIDES WHAT RUNS: its spawner is asked for the night (at a
  // morning's first prompt, when the gate says so) and for the worker (at each
  // boundary). The harness records each ask and runs it after the hook call:
  // the night through `runNight` with the model seat, the worker as the
  // boundary it runs (`sessionEnd`).
  const asked: SpawnPlan[] = [];
  const spawner = (plan: SpawnPlan): { pid: number } => {
    asked.push(plan);
    return { pid: 0 };
  };
  const nights: WeekRecord["nights"][number][] = [];
  let boundaries = 0;
  // WHAT THE NIGHT'S CATCH-UP WOULD TAKE, read just before it runs, as its first batch will plan it.
  const catchUpPlan = (run: string): Omit<NightCatchUp, "ran"> => {
    const c = open();
    try {
      const plan = planCatchUp(c, { run, now: clock });
      return { owed: plan.owed, planned: plan.subjects.map((s) => ({ session: labelOf(s.session), parts: s.served, of: s.of })) };
    } finally {
      c.close();
    }
  };
  const catchUpRan = (run: string): NightCatchUp["ran"] => {
    const r = catchUpOf(counterpart.store, run);
    return r === null ? null : { state: r.state, granted: r.granted, written: r.written, left: r.left, partsLeft: r.partsLeft };
  };
  const drain = async (date: string, day: number, label: string): Promise<void> => {
    // THE WORKER FIRST: live's starts within seconds of its Stop, and its
    // boundary moves the lived day before a night it launched has done
    // anything. A night's returns then land on the day they belong to.
    const plans = asked.splice(0);
    const nightsAsked = plans.filter((p) => p.env[NIGHT_KIND_ENV] !== undefined && p.env[NIGHT_RUN_ENV] !== undefined);
    if (plans.length > nightsAsked.length) {
      boundaries += 1;
      await counterpart.sessionEnd({ date, sweep: { skipped: "not-opted-in" } });
    }
    for (const plan of nightsAsked) {
      if (opts.nights === false) continue;
      const kind = plan.env[NIGHT_KIND_ENV]!;
      const run = plan.env[NIGHT_RUN_ENV]!;
      say(`  night (${kind})`);
      const nightKind = readKind(kind);
      // A reflection run has no catch-up (`night-run.ts`: only a night kind runs one), so it plans none here either.
      const planned = nightKind.kind === "night" ? catchUpPlan(run) : null;
      // Each ask the night puts to its seat, by act and size, whoever answers.
      // With the model in the seat, each ask's child tokens too (its act's tally, before and after; asks run one at a
      // time), so a night's catch-up can be read apart from the week's total (L2, S2 tier 2 finding 6). Null when no
      // child said its usage (the scripted seat, or a crash).
      const acts: { act: string; promptBytes: number; tokens: number | null }[] = [];
      const inner: Seat<NightAnswer> = scripted ? scriptedNightSeat({ open, now }) : modelSeat({ dir, configPath, now, timeZone, budgetBytes: budget, env, ...(opts.model === undefined ? {} : { model: opts.model }), start });
      const seat: Seat<NightAnswer> = {
        name: inner.name,
        answer: async (ask) => {
          const entry = { act: ask.act, promptBytes: Buffer.byteLength(ask.prompt, "utf8"), tokens: null as number | null };
          acts.push(entry);
          const was = usageByAct()[ask.act];
          try {
            return await inner.answer(ask);
          } finally {
            const now = usageByAct()[ask.act];
            if (now !== undefined && now.calls > (was?.calls ?? 0)) entry.tokens = totalTokens(now) - (was === undefined ? 0 : totalTokens(was));
          }
        },
      };
      const night = await runNight({
        open,
        config,
        run,
        session: plan.env["COUNTERPARTS_SESSION"] ?? "",
        scope: plan.env["COUNTERPARTS_SCOPE"] ?? work,
        kind: nightKind,
        seat,
        now,
      });
      nights.push({ day, launchedIn: label, state: night.state, kind, parts: [...(night.parts ?? [])], asked: acts, catchUp: planned === null ? null : { ...planned, ran: catchUpRan(run) } });
    }
  };
  const adapterFor = (scope: string): ClaudeCodeAdapter =>
    new ClaudeCodeAdapter({
      counterpart,
      config,
      configPath,
      now,
      command: process.execPath,
      args: ["harness-worker"],
      nightArgs: ["harness-night"],
      spawner,
      // Read again per session: a scope the model set through the tool counts from the next session on.
      scope: lookupScope(readScopes(scopesFile).registry ?? registry, scope),
    });
  // WHAT `bin/hook.ts#deliverTurn` CLAIMS when a hook's words go out: the plain
  // reminders shown, the day's dream line (or a held one), its note. Without
  // the claims they would ride every prompt.
  const claim = (adapter: ClaudeCodeAdapter, input: HookInput, r: { plain?: readonly PlainReminder[]; dream?: DreamTold; dreamNote?: unknown }): void => {
    if (r.plain !== undefined && r.plain.length > 0) adapter.claimPlain(input, r.plain);
    const told = r.dream;
    if (told !== undefined) {
      if (told.held !== undefined) adapter.claimHeld(input, told.held);
      else if (told.offer !== null) adapter.claimDream(input, told.offer);
    }
    if (r.dreamNote !== undefined && r.dreamNote !== null) adapter.claimDreamNote(input);
  };

  const sessions: SessionLine[] = [];
  const wakes: WakeLine[] = [];
  const owedAtEnd: string[] = [];
  const daily: { day: number; date: string; alive: number; core: number; beliefCore: number; beliefs: number }[] = [];
  const sessionOf = (episode: string): string | null => {
    const db = new Database(join(dir, "counterparts.sqlite"), { readonly: true });
    try {
      return (db.query("SELECT origin_session AS s FROM memories WHERE id = ?").get(episode) as { s: string | null } | null)?.s ?? null;
    } finally {
      db.close();
    }
  };
  const ledgerOf = (session: string): SessionCoverage | null => {
    const row = coverageReading(counterpart.store).find((e) => e.session === session);
    return row === undefined ? null : sessionCoverage(row);
  };
  // THE MORNING'S DOCTOR (S2c): the full reading, as `counterparts doctor` takes it, never the budgeted session-start one (which skips what is owed).
  const catchUpLine = (date: string): WakeLine["doctor"] => {
    const f = doctorFindings({ configPath, configReason: "loaded", config, dir, store: counterpart.store, today: date, refusals: {} }).find((x) => x.key === "crash-write-up");
    return f === undefined ? null : { severity: f.severity, detail: f.detail };
  };
  const stopReasonsOf = (session: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of counterpart.store.eventLog({ name: ADAPTER_ASK_EVENT })) {
      let p: { session?: unknown; outcome?: unknown; reason?: unknown };
      try {
        p = JSON.parse(r.payload ?? "{}") as typeof p;
      } catch {
        continue;
      }
      if (p.session !== session) continue;
      const key = `${String(p.outcome ?? "?")}:${String(p.reason ?? "?")}`;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };
  try {
    // The script's days, then one more morning: its first session start is where the last night runs.
    for (let d = 0; d <= script.length; d++) {
      const date = dateAt(startDate, d);
      const day = script[d] ?? { sessions: [{ scope: script[script.length - 1]?.sessions[0]?.scope ?? "notes", turns: [] }] };
      for (const [k, s] of day.sessions.entries()) {
        clock = at(date, SESSION_HOURS[k] ?? 21);
        const sessionId = randomUUID();
        const label = `d${String(d + 1)}s${String(k + 1)}`;
        labels.set(sessionId, label);
        const scope = join(work, s.scope);
        mkdirSync(scope, { recursive: true });
        w.projects.push(scope);
        const adapter = adapterFor(scope);
        const log: { role: "user" | "assistant"; text: string }[] = [];
        const expansions: TurnExpansion[] = [];
        const base = (): HookInput => ({ sessionId, scope, at: date, turns: [...log], expansions: [...expansions] });
        say(`day ${String(d + 1)} ${date}: session ${String(k + 1)} (${s.scope}), ${String(s.turns.length)} turns`);
        const woke = adapter.sessionStart({ ...base(), source: "startup" });
        claim(adapter, base(), woke);
        await drain(date, d + 1, label);
        const gate = counterpart.dreams.status(date);
        wakes.push({ day: d + 1, label, morning: k === 0, ...readWake(woke.injection, sessionOf, labelOf), gate: { reason: gate.reason, newSince: gate.newSince }, doctor: k === 0 ? catchUpLine(date) : null });
        if (s.turns.length === 0) {
          // THE EXTRA MORNING: the product launches the night from the first
          // prompt (`hooks.ts#dreamLines`), never from the session start, so
          // the morning has one, empty.
          const said = adapter.userPromptSubmit({ ...base(), prompt: "" });
          claim(adapter, base(), said);
          // The day's first boundary, as a live session's first Stop gives it
          // within seconds, before the night it launched has begun its dream.
          boundaries += 1;
          await counterpart.sessionEnd({ date, sweep: { skipped: "not-opted-in" } });
          await drain(date, d + 1, label);
          adapter.sessionEnd({ ...base() });
          await drain(date, d + 1, label);
          continue;
        }
        let pending = [woke.injection, woke.ask ?? ""].filter((x) => x.length > 0).join("\n\n");
        let first = true;
        let footnotes = 0;
        let asks = 0;
        let stops = 0;
        let answered = 0;
        let ignored = 0;
        let remembered = 0;
        let refusedRemembers = 0;
        let chapters = 0;
        let refusedChapters = 0;
        let failed = 0;
        let init: ChildInit | null = null;
        // A SCRIPTED SEAT'S TOOLS: the memory's own server, in-process, bound
        // to this session and folder as the session's server is (`serve-at.ts`).
        const server = scripted
          ? new McpServer({ counterpart, session: sessionId, scope, now, scopesFile, env: {}, ...(embedder === null ? {} : { embedder }) })
          : null;
        const tool = async (name: string, args: Record<string, unknown>): Promise<boolean> => {
          const out = await (server as McpServer).call(name, { session: sessionId, ...args });
          return out.isError !== true && out.structuredContent["ok"] !== false;
        };
        const turn = async (prompt: string): Promise<string> => {
          const plan = planTurn(turnOpts, { dir, configPath, session: sessionId, scope, now: clock, first, prompt, scopesFile });
          first = false;
          const result = await start(plan);
          if (init === null) init = childInit(result.output);
          recordUsage(result.output);
          if (result.code !== 0) failed += 1;
          clock += 3 * MIN;
          // THE MODEL'S RECALL CALLS, positioned at its turn, as the host's transcript gives them.
          const ids = recalledIds(result.output);
          if (ids.length > 0) expansions.push({ atTurn: log.length, ids });
          return replyOf(result.output);
        };
        for (const [i, line] of s.turns.map(turnOf).entries()) {
          const text = line.say;
          // HUMAN PACING (scripted): the line is typed `after` minutes past the last Stop.
          if (scripted && i > 0) clock += (line.after ?? SCRIPTED_GAP_MIN) * MIN;
          const said = adapter.userPromptSubmit({ ...base(), prompt: text });
          claim(adapter, base(), said);
          footnotes += said.footnotes.length;
          const context = [pending, said.injection, said.ask ?? ""].filter((x) => x.length > 0).join("\n\n");
          pending = "";
          log.push({ role: "user", text });
          let reply: string;
          if (scripted) {
            // The turn's tool calls first, as a model makes them before its reply ends the turn.
            for (const memory of line.remember ?? []) {
              if (await tool("remember", { text: memory })) remembered += 1;
              else refusedRemembers += 1;
            }
            if (line.chapter !== undefined) {
              if (await tool("chapter", { title: line.chapter.title, text: line.chapter.text })) chapters += 1;
              else refusedChapters += 1;
            }
            reply = line.reply ?? SCRIPTED_REPLY;
            clock += MIN / 2;
          } else reply = await turn(reminded(context, text));
          log.push({ role: "assistant", text: reply });
          // THE STOP, its boundary (the worker it asks for), and its ask: put to the model as the conversation's next message.
          const stopped = adapter.stop({ ...base() });
          stops += 1;
          await drain(date, d + 1, label);
          if (stopped.ask !== null && stopped.ask.length > 0) {
            asks += 1;
            let answer: string;
            if (scripted) {
              // As the script says: a `session_end` with its memories, or carry on without the tool.
              const onAsk = s.onAsk ?? { memories: [] };
              if (onAsk === "ignore") {
                ignored += 1;
                answer = SCRIPTED_REPLY;
              } else {
                if (await tool("session_end", { memories: onAsk.memories.map((content) => ({ content })), ...(onAsk.handoff === undefined ? {} : { handoff: onAsk.handoff }) })) answered += 1;
                else ignored += 1;
                answer = "Noted for next time.";
              }
              clock += MIN / 2;
            } else answer = await turn(reminded(stopped.ask, "(Stop hook feedback)"));
            log.push({ role: "assistant", text: answer });
            adapter.stop({ ...base(), reFired: true });
            await drain(date, d + 1, label);
          }
        }
        adapter.sessionEnd({ ...base() });
        await drain(date, d + 1, label);
        sessions.push({
          day: d + 1,
          label,
          scope: s.scope,
          turns: s.turns.length,
          footnotes,
          asks,
          stops,
          paced: stops - asks,
          stopReasons: stopReasonsOf(sessionId),
          asksAnswered: scripted ? answered : null,
          asksIgnored: scripted ? ignored : null,
          remembers: scripted ? remembered : null,
          remembersRefused: scripted ? refusedRemembers : null,
          chapters: scripted ? chapters : null,
          chaptersRefused: scripted ? refusedChapters : null,
          memoriesAfter: count(dir, "SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND type = 'memory'"),
          failedTurns: failed,
          init,
          coverage: ledgerOf(sessionId),
        });
      }
      if (d < script.length) {
        daily.push({
          day: d + 1,
          date,
          alive: count(dir, "SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND type = 'memory'"),
          core: count(dir, "SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND band = 'identity'"),
          ...beliefCoreNow(counterpart),
        });
      }
    }
    for (const e of coverageReading(counterpart.store)) if (e.owed && e.person) owedAtEnd.push(labelOf(e.session));
  } finally {
    counterpart.close();
  }
  const page = pageReading(dir, opts.pageOut);
  let out: string | null = null;
  if (opts.out !== undefined) {
    // ONE FILE, folded: `VACUUM INTO` writes the whole store, whatever a log still held.
    for (const f of [opts.out, `${opts.out}-wal`, `${opts.out}-shm`]) rmSync(f, { force: true });
    const db = new Database(join(dir, "counterparts.sqlite"), { readonly: true });
    db.run(`VACUUM INTO '${opts.out.replace(/'/g, "''")}'`);
    db.close();
    out = opts.out;
  }
  return {
    harness: "owner-week",
    owner: opts.owner ?? OWNER_NAME,
    script: opts.scriptName ?? "plain",
    build: runningBuild(),
    settings: appliedSettings(),
    usage: usageTally(),
    usageByAct: usageByAct(),
    page,
    ranAt: new Date(w.started).toISOString(),
    elapsedMs: Date.now() - w.started,
    days: script.length,
    seat: scripted ? "scripted" : "model",
    install: install === false ? "bare" : install === "without-meeting" ? "without-meeting" : "new",
    modelCalls,
    sessions,
    nights,
    wakes,
    owedAtEnd,
    boundaries,
    daily,
    out,
    settled: settledOf(dir),
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

/** Lane F's core from beliefs on the store now, and the self subject's beliefs it read. */
function beliefCoreNow(c: Counterpart): { beliefCore: number; beliefs: number } {
  const r = coreFromBeliefs(c.store, c.store.livedDay());
  return { beliefCore: r.elements.length, beliefs: r.considered };
}
