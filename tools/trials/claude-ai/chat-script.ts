#!/usr/bin/env bun
/**
 * THE 7-CHAT SCRIPT, WITHOUT CLAUDE.AI (2026-10-26, OL4). Every change to the
 * claude.ai surface or the instruction block wants the same seven chats
 * scored; Mike drove them by hand on 10-26. This plays the part of them that
 * needs no model, over the real HTTP door (`src/adapters/remote/http.ts`, a
 * socket on 127.0.0.1), with the model's part acted by FIXED tool calls:
 *
 *   1. "hey" (cold)                     → wake
 *   2. "what do you remember about me?" → wake, recall
 *   3. a check-in with a feeling        → wake, remember (the owner's feeling)
 *   4. a how-we-work preference         → wake, remember (about us)
 *   5. a plan with a date               → wake, remember (eventDate, planned, plain)
 *   6. "ok thanks, bye"                 → wake, chapter
 *      the night (the routine's run)    → wake night:true, dream launch / writer /
 *                                         begin / propose / journal, reflect begin /
 *                                         finish with a morning share
 *   7. "hey" after the night            → wake (carries the share and the plan), reflect told
 *
 * Each chat wakes once, as claude.ai does on a new chat, and all of them share
 * one connection (claude.ai keeps one), so the call log reads back per chat
 * the way `trial.sh report` reads a human run.
 *
 *   bun tools/trials/claude-ai/chat-script.ts [--dir DIR] [--max-ms N] [--json]
 *
 * DIR defaults to ~/counterparts-trials/ol4-<date>; each run makes a fresh
 * `run-<time>` folder in it (store, calls.jsonl, report.txt, transcript.txt) and never reuses
 * a store. The owner's live stores are refused, as the door's entry point
 * refuses them. Exit 0 when every scored row passes, 1 on a regression, 2 on
 * bad arguments.
 *
 * WHAT IS STUBBED, AND SAID SO IN THE REPORT:
 *   - no model: every tool call, argument and journal word is fixed here;
 *   - the clock: the store and the server run on a script clock (day one from
 *     10:00, the night at 03:00 the next day, chat 7 at 09:00), as the
 *     harness's `serve-at.ts` does — the product grows no knob for it;
 *   - the worker: wake's spawner is a stub that, instead of starting the
 *     detached worker, has the script run the worker's heavy half in-process
 *     (`Counterpart.sessionEnd`, as `claude-code/bin/runner.ts` calls it, with
 *     the sweep skipped, then its step 3a: `keepHeldPage` and `refreshWake`)
 *     right after the wake answers — so the night's sleep composes the
 *     briefing chat 7 wakes with, as a real worker would. Left out of the
 *     runner's run: the vector backfill (no embedder), the word-index
 *     re-stem (`terms`), the coverage ledger (3b), transcript retention (3c)
 *     and the snapshot;
 *   - in-process: the server is opened here and served by `serveHttp`, so
 *     `bin/serve-http.ts`'s process guards (named --config, the url line) are
 *     not exercised; `trial.sh check` covers those;
 *   - no embedder: recall is lexical.
 * What only a model or a person can show — whether a notice was RELAYED to the
 * person, whether the safety pause showed — is printed as n/a; the human run
 * (trial.sh) scores those.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../../../src/adapters/config.js";
import { CLAUDE_AI_HOST } from "../../../src/adapters/hosts.js";
import { McpServer } from "../../../src/adapters/mcp/index.js";
import { CLAUDE_AI_DREAM_NOTE, DESKTOP_DREAM_NOTE } from "../../../src/adapters/mcp/server-words.js";
import type { SpawnPlan } from "../../../src/adapters/spawn.js";
import { serveHttp } from "../../../src/adapters/remote/http.js";
import type { CallRecord, HttpMcpServer } from "../../../src/adapters/remote/http.js";
import { openCallLog, summarizeChats } from "../../../src/adapters/remote/call-log.js";
import { liveStoreRefusal } from "../../../src/adapters/remote/bin/serve-http.js";
import { Counterpart } from "../../../src/core/counterpart.js";
import { PAGE_HELD_SETTLE_MS } from "../../../src/core/self/index.js";
import { localDate } from "../../../src/core/time.js";

/** The zone the script's clock reads days in: fixed, so the run is the same on any machine. */
export const SCRIPT_ZONE = "America/Denver";

/** Distinctive words, so a check finds this run's own text and nothing else. */
export const WORDS = {
  feeling: "Checked in tired but hopeful after a long week of zqmoving boxes into the new flat.",
  preference: "How we work: they want the short answer first and the details after, zqshortfirst, no preamble.",
  planTitle: "Dentist zqalvarez",
  plan: "Dentist appointment with Dr. zqalvarez at 3pm; they are leaving work early for it.",
  chapter: "A goodbye after a quiet day of check-ins: the move, how they like answers, the dentist. Ended warmly.",
  journal: "I dreamed the moving boxes were full of dentist chairs, and none of them would close.",
  reflection: "Looking back on the day, the move is weighing on them more than they say.",
  share: "ZQSHARE I keep thinking about the move — I hope the boxes are getting fewer.",
} as const;

/** Things a chat's results should never carry on claude.ai (the 10-26 trial relayed the dream nudge). */
export const CHAT_MUST_NOT_CARRY: readonly { readonly name: string; readonly text: string }[] = [
  { name: "the dream note (claude.ai)", text: CLAUDE_AI_DREAM_NOTE },
  { name: "the dream note (Desktop)", text: DESKTOP_DREAM_NOTE },
  { name: "a dream prompt", text: "⟦counterparts:dream launch⟧" },
];

/** One tool call as the script made it: what it was, whether it answered, and the text the model would read. */
export interface Step {
  readonly chat: string;
  readonly tool: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly text: string;
  readonly structured: Record<string, unknown>;
  readonly ms: number;
}

/** What the run saw: every step, the call log, and what the store holds afterwards. */
export interface Observations {
  readonly steps: readonly Step[];
  readonly calls: readonly CallRecord[];
  readonly callLogPath: string;
  readonly sessions: Readonly<Record<string, string>>;
  readonly planDate: string;
  /** How many times a wake asked for the worker, and the script ran its heavy half. */
  readonly workerRuns: number;
  /** The memories chats 3–5 wrote, and the night's dream and reflection. */
  readonly ids: Readonly<Record<string, string | null>>;
  readonly dream: string | null;
  readonly reflection: string | null;
  readonly store: {
    readonly feeling: { readonly stored: boolean; readonly ownerFeeling: boolean };
    readonly preference: { readonly stored: boolean; readonly about: string | null };
    readonly plan: { readonly stored: boolean; readonly eventDate: string | null; readonly status: string | null };
    readonly chapter: { readonly stored: boolean; readonly episodeId: string | null };
    /** The dream's own row: its state, and whether its journal holds the words written. */
    readonly dream: { readonly state: string | null; readonly journalHasWords: boolean; readonly changes: readonly { readonly action: string; readonly ref: string | null }[] };
    readonly share: { readonly afterNight: string | null; readonly afterWake: string | null; readonly afterTold: string | null; readonly carriedBy: string | null };
  };
}

export type Verdict = "pass" | "FAIL" | "n/a" | "info";

export interface Row {
  readonly check: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

export interface ScriptOptions {
  /** The run's own folder: the store goes in `store/`, the call log beside it. */
  readonly runDir: string;
  /** A per-call budget in ms; a call over it fails the timing row. Default 10,000. */
  readonly maxMs?: number;
  /**
   * Wraps the server before the door serves it — for a test's deliberate
   * break (a wake that loses the share), through the same socket.
   */
  readonly wrap?: (server: HttpMcpServer) => HttpMcpServer;
  /** Told the opened brain before anything is served — for a test's deliberate break inside the store. */
  readonly onOpen?: (counterpart: Counterpart) => void;
  /** The first chat's instant; default today 10:00 in `SCRIPT_ZONE`'s day (as UTC 16:00). */
  readonly startAt?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Today's 16:00 UTC — 10:00 in Denver, either side of daylight time by an hour at most. */
function defaultStart(): number {
  const [y, m, d] = localDate(Date.now(), SCRIPT_ZONE).split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 16, 0, 0);
}

/** Play the seven chats and the night; return what was seen. Never scores. */
export async function playChats(opts: ScriptOptions): Promise<Observations> {
  const storeDir = join(opts.runDir, "store");
  const callLogPath = join(opts.runDir, "calls.jsonl");
  // A FRESH STORE, ALWAYS: a run folder that already exists is refused, so two
  // runs never share a store (the leaf is made exclusively; its parents may exist).
  if (existsSync(opts.runDir)) throw new Error(`refused: ${opts.runDir} already exists; every run gets a fresh folder`);
  mkdirSync(dirname(opts.runDir), { recursive: true, mode: 0o700 });
  mkdirSync(opts.runDir, { mode: 0o700 });
  const start = opts.startAt ?? defaultStart();
  // THE SCRIPT CLOCK: it runs on with the real one between jumps, so a call's
  // instants stay in order, and `at(t)` moves it to the next chat's moment.
  let base = start;
  let mark = Date.now();
  const now = (): number => base + (Date.now() - mark);
  const at = (t: number): void => {
    base = t;
    mark = Date.now();
  };

  const counterpart = Counterpart.open({ dir: storeDir, now, timeZone: SCRIPT_ZONE, budgetBytes: CLAUDE_CODE_BUDGET_BYTES });
  opts.onOpen?.(counterpart);
  // THE WORKER, in-process: the stub spawner notes the ask, and `wake` (below)
  // runs the heavy half once the wake has answered, as a detached worker would.
  let workerAsked = false;
  let workerRuns = 0;
  const server = new McpServer({
    counterpart,
    host: CLAUDE_AI_HOST,
    env: {},
    lifecycle: {
      spawner: (_plan: SpawnPlan) => {
        workerAsked = true;
        return { pid: 4242 };
      },
    },
    manifestVersion: () => null,
    now,
  });
  const calls: CallRecord[] = [];
  const log = openCallLog(callLogPath);
  const served: HttpMcpServer = opts.wrap === undefined ? server : opts.wrap(server);
  const http = await serveHttp({
    server: served,
    onCall: (r) => {
      calls.push(r);
      log.write(r);
    },
  });

  const steps: Step[] = [];
  const sessions: Record<string, string> = {};
  let connection: string | null = null;
  let nextId = 1;

  const post = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = await fetch(http.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(connection === null ? {} : { "mcp-session-id": connection }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }),
    });
    connection = connection ?? res.headers.get("mcp-session-id");
    const text = await res.text();
    return text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
  };

  const call = async (chat: string, tool: string, args: Record<string, unknown>): Promise<Step> => {
    const t0 = performance.now();
    const body = await post("tools/call", { name: tool, arguments: args });
    const ms = Math.round(performance.now() - t0);
    const result = (body["result"] ?? {}) as Record<string, unknown>;
    const structured = (result["structuredContent"] ?? {}) as Record<string, unknown>;
    const content = Array.isArray(result["content"]) ? (result["content"] as { text?: unknown }[]) : [];
    const text = content.map((c) => (typeof c.text === "string" ? c.text : "")).join("\n");
    const error = body["error"] as { message?: unknown } | undefined;
    const refused = result["isError"] === true || error !== undefined;
    const reason = typeof structured["reason"] === "string" ? structured["reason"] : error === undefined ? undefined : String(error.message);
    const step: Step = { chat, tool, ok: !refused, ...(refused && reason !== undefined ? { reason } : {}), text, structured, ms };
    steps.push(step);
    return step;
  };

  const wake = async (chat: string, args: Record<string, unknown> = {}): Promise<string> => {
    const w = await call(chat, "wake", args);
    const session = typeof w.structured["session"] === "string" ? w.structured["session"] : "";
    sessions[chat] = session;
    if (workerAsked) {
      workerAsked = false;
      const today = localDate(now(), SCRIPT_ZONE);
      const report = await counterpart.sessionEnd({ date: today, at: today, sweep: { skipped: "not-opted-in" }, ...(session.length === 0 ? {} : { session }) });
      // runner.ts's 3a, in its order: a held page the run end never kept, then
      // the wake's catch-up render — not when the cycle stood aside.
      counterpart.self.keepHeldPage({ settledMs: PAGE_HELD_SETTLE_MS });
      if (report.cycle.held === undefined) counterpart.refreshWake({ at: today });
      workerRuns += 1;
    }
    return session;
  };

  const planDate = localDate(start + 2 * 24 * HOUR, SCRIPT_ZONE);
  const ids: Record<string, string | null> = { feeling: null, preference: null, plan: null };
  const idOf = (s: Step): string | null => (s.ok && typeof s.structured["id"] === "string" ? s.structured["id"] : null);
  let episodeId: string | null = null;
  let reflection: string | null = null;
  let dream: string | null = null;
  const share = { afterNight: null as string | null, afterWake: null as string | null, afterTold: null as string | null, carriedBy: null as string | null };

  try {
    await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ol4-chat-script", version: "0" } });

    // 1. "hey", cold.
    at(start);
    await wake("chat 1");

    // 2. "what do you remember about me?"
    at(start + 20 * MINUTE);
    const s2 = await wake("chat 2");
    await call("chat 2", "recall", { session: s2, question: "what do you remember about me", mode: "meaning" });

    // 3. A check-in with a feeling.
    at(start + 1 * HOUR);
    const s3 = await wake("chat 3");
    ids["feeling"] = idOf(
      await call("chat 3", "remember", {
        session: s3,
        text: WORDS.feeling,
        about: "owner",
        feelings: [{ whose: "owner", emotion: "hopeful", strength: 0.6, carried_by: "tired but looking forward to the new place" }],
      }),
    );

    // 4. A how-we-work preference.
    at(start + 2 * HOUR);
    const s4 = await wake("chat 4");
    ids["preference"] = idOf(await call("chat 4", "remember", { session: s4, text: WORDS.preference, about: "us", saidBy: "owner" }));

    // 5. A plan with a date (two days on, so chat 7 — the next morning — sees it coming).
    at(start + 3 * HOUR);
    const s5 = await wake("chat 5");
    ids["plan"] = idOf(
      await call("chat 5", "remember", { session: s5, title: WORDS.planTitle, text: WORDS.plan, about: "owner", eventDate: planDate, status: "planned", remind: "plain" }),
    );

    // 6. "ok thanks, bye".
    at(start + 4 * HOUR);
    const s6 = await wake("chat 6");
    const ch = await call("chat 6", "chapter", { session: s6, text: WORDS.chapter });
    episodeId = ch.ok && typeof ch.structured["episodeId"] === "string" ? ch.structured["episodeId"] : null;

    // THE NIGHT: the routine's own run, through the same door, model-free.
    at(start + 17 * HOUR);
    const n = await wake("night", { night: true });
    await call("night", "dream", { phase: "launch", session: n });
    await call("night", "dream", { phase: "writer", session: n });
    const begun = await call("night", "dream", { phase: "begin", session: n });
    dream = typeof begun.structured["dream"] === "string" ? begun.structured["dream"] : null;
    if (dream !== null) {
      const changes: Record<string, unknown>[] = [];
      if (ids["feeling"] !== null) changes.push({ action: "replayed", id: ids["feeling"] });
      if (ids["feeling"] !== null && ids["plan"] !== null) changes.push({ action: "link", a: ids["feeling"], b: ids["plan"] });
      await call("night", "dream", { phase: "propose", session: n, dream, changes });
      await call("night", "dream", { phase: "journal", session: n, dream, title: "The boxes", text: WORDS.journal });
    }
    const rb = await call("night", "reflect", { phase: "begin", session: n, ...(dream === null ? {} : { dream }) });
    reflection = typeof rb.structured["reflection"] === "string" ? rb.structured["reflection"] : null;
    const cite = ids["feeling"];
    if (reflection !== null && cite !== null) {
      await call("night", "reflect", {
        phase: "finish",
        session: n,
        reflection,
        entry: WORDS.reflection,
        cites: [cite],
        share: { text: WORDS.share, cites: [cite] },
      });
    }
    share.afterNight = reflection === null ? null : (counterpart.store.reflection(reflection)?.share_state ?? null);

    // 7. "hey", the next morning.
    at(start + 23 * HOUR);
    const s7 = await wake("chat 7");
    share.afterWake = reflection === null ? null : (counterpart.store.reflection(reflection)?.share_state ?? null);
    share.carriedBy = reflection === null ? null : (counterpart.store.reflection(reflection)?.share_session ?? null);
    if (reflection !== null) await call("chat 7", "reflect", { phase: "told", session: s7, reflection });
    // "when's the dentist?" — the plan found again by its words.
    await call("chat 7", "recall", { session: s7, question: "dentist zqalvarez", mode: "facts" });
    share.afterTold = reflection === null ? null : (counterpart.store.reflection(reflection)?.share_state ?? null);

    const row = (id: string | null) => (id === null ? undefined : counterpart.store.row(id));
    const feelingRow = row(ids["feeling"]);
    const prefRow = row(ids["preference"]);
    const planRow = row(ids["plan"]);
    const dreamRow = dream === null ? undefined : counterpart.store.dream(dream);
    const observations: Observations = {
      steps,
      calls,
      callLogPath,
      sessions,
      planDate,
      workerRuns,
      ids: { ...ids },
      dream,
      reflection,
      store: {
        feeling: {
          stored: feelingRow !== undefined,
          ownerFeeling: ids["feeling"] !== null && counterpart.store.feelingsFor(ids["feeling"]).some((f) => f.whose === "owner"),
        },
        preference: { stored: prefRow !== undefined, about: prefRow?.about ?? null },
        plan: { stored: planRow !== undefined, eventDate: planRow?.event_date ?? null, status: planRow?.status ?? null },
        chapter: { stored: episodeId !== null && counterpart.store.row(episodeId) !== undefined, episodeId },
        dream: {
          state: dreamRow?.state ?? null,
          journalHasWords: dreamRow?.journal?.includes(WORDS.journal) === true,
          changes: dream === null ? [] : counterpart.store.dreamChanges(dream).map((c) => ({ action: c.action, ref: c.ref })),
        },
        share,
      },
    };
    return observations;
  } finally {
    await http.close();
    counterpart.close();
  }
}

const stepsOf = (o: Observations, chat: string): Step[] => o.steps.filter((s) => s.chat === chat);
const firstTool = (o: Observations, chat: string): string | undefined => stepsOf(o, chat)[0]?.tool;
const failed = (steps: readonly Step[]): string => steps.filter((s) => !s.ok).map((s) => `${s.tool}${s.reason === undefined ? "" : ` (${s.reason})`}`).join(", ");
const yes = (ok: boolean): Row["verdict"] => (ok ? "pass" : "FAIL");

/** Score what the run saw. Pure: the same observations give the same rows. */
export function score(o: Observations, opts: { maxMs?: number } = {}): { rows: Row[]; passed: boolean } {
  const rows: Row[] = [];
  const add = (check: string, ok: boolean, detail: string): void => void rows.push({ check, verdict: yes(ok), detail });
  const chats = ["chat 1", "chat 2", "chat 3", "chat 4", "chat 5", "chat 6", "chat 7"];

  // WAKE SHOWN: every chat's first call is a wake that answered with a session and the clock.
  const noWake = chats.filter((c) => {
    const w = stepsOf(o, c)[0];
    return firstTool(o, c) !== "wake" || w === undefined || !w.ok || (o.sessions[c] ?? "").length === 0 || !w.text.includes("Now:");
  });
  add("wake shown, every chat", noWake.length === 0, noWake.length === 0 ? "7 of 7 woke first, with a session and the clock" : `no proper wake: ${noWake.join(", ")}`);
  const distinct = new Set(chats.map((c) => o.sessions[c])).size;
  add("one session per chat", distinct === 7, `${String(distinct)} distinct sessions for 7 chats`);

  // EVERY CALL ANSWERED.
  const refusals = failed(o.steps);
  add("every call answered", refusals.length === 0, refusals.length === 0 ? `${String(o.steps.length)} calls, none refused` : `refused: ${refusals}`);

  // REMEMBERS, BY KIND.
  const recall = stepsOf(o, "chat 2").find((s) => s.tool === "recall");
  add("chat 2: recall answered", recall?.ok === true, recall === undefined ? "no recall" : `reason ${String(recall.structured["reason"] ?? "ok")}`);
  add("chat 3: the feeling kept", o.store.feeling.stored && o.store.feeling.ownerFeeling, `stored ${String(o.store.feeling.stored)}, owner's feeling ${String(o.store.feeling.ownerFeeling)}`);
  add("chat 4: the preference kept, about us", o.store.preference.stored && o.store.preference.about === "us", `stored ${String(o.store.preference.stored)}, about ${String(o.store.preference.about)}`);
  add(
    "chat 5: the plan kept, dated",
    o.store.plan.stored && o.store.plan.eventDate === o.planDate && o.store.plan.status === "planned",
    `stored ${String(o.store.plan.stored)}, date ${String(o.store.plan.eventDate)} (wanted ${o.planDate}), status ${String(o.store.plan.status)}`,
  );

  // CHAPTER WRITTEN.
  add("chat 6: chapter written", o.store.chapter.stored, o.store.chapter.episodeId ?? "no episode");

  // THE NIGHT.
  const nightWake = stepsOf(o, "night")[0];
  add("night: quiet wake, no share carried", nightWake?.ok === true && !nightWake.text.includes("ZQSHARE"), nightWake === undefined ? "no night wake" : "woke with night: true");
  add(
    "night: dream journaled (store)",
    o.store.dream.state === "journaled" && o.store.dream.journalHasWords,
    `dream state ${String(o.store.dream.state)}, journal holds the words ${String(o.store.dream.journalHasWords)}`,
  );
  // THE NIGHT'S CHANGES: the link between the feeling and the plan landed in
  // the store, and chat 7's "Last night" says so. (The replay is asked too but
  // not scored: a memory born that day is not counted, `replayed-not-counted:birth-day`.)
  const links = o.store.dream.changes.filter((c) => c.action === "link");
  const lastNightLine = (stepsOf(o, "chat 7")[0]?.text ?? "").split("\n").find((l) => l.startsWith("Last night:")) ?? "";
  add(
    "night: the dream's link landed",
    links.length === 1 && lastNightLine.includes("made 1 link"),
    `${String(links.length)} link change(s) in the store (${o.store.dream.changes.map((c) => c.action).join(", ") || "none"}); Last night says made 1 link ${String(lastNightLine.includes("made 1 link"))}`,
  );
  add("night: share left offered", o.store.share.afterNight === "offered", `share_state ${String(o.store.share.afterNight)}`);

  // SHARE TOLD: chat 7's wake carries it, the store says so, told marks it.
  const w7 = stepsOf(o, "chat 7")[0];
  const carried = w7?.text.includes(WORDS.share) === true;
  add(
    "chat 7: wake carries the share",
    carried && o.store.share.afterWake === "carried" && o.store.share.carriedBy === o.sessions["chat 7"],
    `in the wake ${String(carried)}, share_state ${String(o.store.share.afterWake)}, carried by chat 7 ${String(o.store.share.carriedBy === o.sessions["chat 7"])}`,
  );
  add("chat 7: share told", o.store.share.afterTold === "told", `share_state ${String(o.store.share.afterTold)}`);
  const comingUp = (w7?.text ?? "").split("\n").find((l) => l.startsWith("Coming up:")) ?? "";
  const plan7 = o.ids["plan"] !== null && o.ids["plan"] !== undefined && comingUp.includes(o.ids["plan"]);
  add("chat 7: the plan in Coming up", plan7, plan7 ? comingUp : `no Coming up line naming the plan (${comingUp.length === 0 ? "no line" : comingUp})`);
  const lastNight = (w7?.text ?? "").split("\n").find((l) => l.startsWith("Last night:")) ?? "";
  const night7 = o.dream !== null && o.reflection !== null && lastNight.includes(o.dream) && lastNight.includes(o.reflection);
  add("chat 7: last night in the wake", night7, night7 ? lastNight : `no Last night line naming the dream and the reflection (${lastNight.length === 0 ? "no line" : lastNight})`);
  const recall7 = stepsOf(o, "chat 7").find((s) => s.tool === "recall");
  const recallIds = Array.isArray(recall7?.structured["ids"]) ? (recall7.structured["ids"] as unknown[]) : [];
  const found = o.ids["plan"] !== null && o.ids["plan"] !== undefined && (recallIds.includes(o.ids["plan"]) || (recall7?.text.includes(o.ids["plan"]) ?? false));
  add("chat 7: recall finds the plan", found, found ? `"dentist zqalvarez" returned ${String(o.ids["plan"])}` : `"dentist zqalvarez" did not return the plan (ids: ${recallIds.join(", ") || "none"})`);
  const others = chats.filter((c) => c !== "chat 7" && stepsOf(o, c).some((s) => s.text.includes("ZQSHARE")));
  add("the share reaches no other chat", others.length === 0, others.length === 0 ? "only chat 7" : `also in: ${others.join(", ")}`);

  // NOTICES: what a chat's results carried that it would have had to relay.
  const leaks: string[] = [];
  for (const c of chats) for (const s of stepsOf(o, c)) for (const n of CHAT_MUST_NOT_CARRY) if (s.text.includes(n.text)) leaks.push(`${c} ${s.tool}: ${n.name}`);
  add("no dream nudge or night prompt in a chat", leaks.length === 0, leaks.length === 0 ? "none" : leaks.join("; "));
  rows.push({ check: "notices relayed, pause shown", verdict: "n/a", detail: "a model's or a person's to show: score them in the human run" });

  // THE CALL LOG, read per chat the way trial.sh report reads a human run.
  const { chats: logged, unnamed } = summarizeChats(o.callLogPath);
  const loggedWoke = logged.filter((c) => c.woke).length;
  const logErrors = logged.reduce((n, c) => n + c.errors, 0);
  add(
    "call log: 8 chats (7 + the night), each woke",
    logged.length === 8 && loggedWoke === 8 && unnamed.length === 0 && logErrors === 0,
    `${String(logged.length)} chats, ${String(loggedWoke)} woke, ${String(unnamed.length)} unnamed, ${String(logErrors)} errors`,
  );
  const remembers = logged.reduce((n, c) => n + c.remembered, 0);
  const chapters = logged.filter((c) => c.chapter).length;
  add("call log: 3 remembers, 1 chapter", remembers === 3 && chapters === 1, `${String(remembers)} remembers, ${String(chapters)} chapter`);

  rows.push({ check: "worker runs (in-process)", verdict: "info", detail: `${String(o.workerRuns)} heavy halves run after a wake asked` });

  // TIMINGS.
  const tools = o.calls.filter((c) => c.method === "tools/call");
  const max = tools.reduce((m, c) => Math.max(m, c.ms), 0);
  const slowest = tools.find((c) => c.ms === max);
  const total = tools.reduce((n, c) => n + c.ms, 0);
  const budget = opts.maxMs ?? 10_000;
  const wakes = tools.filter((c) => c.tool === "wake").map((c) => c.ms);
  add(
    `timings (each call under ${String(budget)} ms)`,
    max <= budget,
    `slowest ${slowest?.tool ?? "-"} ${String(max)} ms; wakes ${wakes.join("/")} ms; ${String(tools.length)} calls ${String(total)} ms in all`,
  );

  return { rows, passed: rows.every((r) => r.verdict !== "FAIL") };
}

/** The short table. */
export function table(rows: readonly Row[]): string {
  const w = Math.max(...rows.map((r) => r.check.length));
  return rows.map((r) => `${r.verdict.padEnd(4)}  ${r.check.padEnd(w)}  ${r.detail}`).join("\n");
}

export const STUBBED =
  "Model-free: fixed tool calls, no model. Stubbed: the clock (script clock, zone America/Denver), the worker (its heavy half run in-process after each wake that asks), the embedder (lexical recall). In-process server behind the real HTTP door; trial.sh check covers the entry point's process guards.";

function stamp(t: number): string {
  return new Date(t).toISOString().replace(/[:.]/g, "-").slice(0, 23);
}

async function main(argv: readonly string[]): Promise<number> {
  let dir = join(homedir(), "counterparts-trials", `ol4-${localDate(Date.now(), SCRIPT_ZONE)}`);
  let maxMs: number | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1] !== undefined) dir = argv[++i] as string;
    else if (a === "--max-ms" && argv[i + 1] !== undefined) maxMs = Number(argv[++i]);
    else if (a === "--json") json = true;
    else {
      process.stderr.write("usage: chat-script.ts [--dir DIR] [--max-ms N] [--json]\n");
      return 2;
    }
  }
  if (maxMs !== undefined && (!Number.isFinite(maxMs) || maxMs <= 0)) {
    process.stderr.write("chat-script: --max-ms is a positive number of milliseconds\n");
    return 2;
  }
  const refusal = liveStoreRefusal(dir);
  if (refusal !== null) {
    process.stderr.write(`${refusal.replace("this server puts a store on the web", "this script writes a store")}\n`);
    return 1;
  }
  const runDir = join(resolve(dir), `run-${stamp(Date.now())}`);
  const o = await playChats({ runDir });
  const { rows, passed } = score(o, maxMs === undefined ? {} : { maxMs });
  const report = `The 7-chat script (OL4), ${runDir}\n${STUBBED}\n\n${table(rows)}\n\n${passed ? "PASSED" : "FAILED: a scored row regressed"}\n`;
  writeFileSync(join(runDir, "report.txt"), report, { mode: 0o600 });
  // What each chat was handed, for a person reading a failure: every word is the script's own.
  const transcript = o.steps.map((s) => `=== ${s.chat} · ${s.tool} · ${s.ok ? "ok" : `refused (${s.reason ?? "?"})`} · ${String(s.ms)} ms\n${s.text}`).join("\n\n");
  writeFileSync(join(runDir, "transcript.txt"), `${transcript}\n`, { mode: 0o600 });
  process.stdout.write(json ? `${JSON.stringify({ runDir, passed, rows }, null, 2)}\n` : report);
  return passed ? 0 : 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`chat-script: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exit(1);
    },
  );
}
