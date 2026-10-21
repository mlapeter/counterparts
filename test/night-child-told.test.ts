/**
 * A SESSION NO PERSON STARTED IS TOLD NOTHING AT ITS START (2026-10-12).
 *
 * The night run's own children (`claude -p`, `night-run.ts#planNightChild`)
 * start at 00:19 on the owner's machine, the minute the run is launched. A
 * plain reminder due that day and a morning share nobody has read yet are
 * waiting. The child's SessionStart and first prompt run through the real
 * hook input (`toHookInput`, its environment shaped exactly like the launch:
 * the plan's own env plus what the host adds, measured on 2.1.296 —
 * `CLAUDE_CODE_ENTRYPOINT=sdk-cli`, `CLAUDE_CODE_SESSION_ATTENDED=0`) and the
 * real delivery: nothing is said, nothing is claimed. The 08:00 session a
 * person opens gets the reminder in its wake and both lines on the first
 * prompt they type.
 *
 * And a compaction (`source: "compact"`), which fires mid-turn — after a
 * hand-back nobody read, or inside an Agent-tool subagent — is not where a
 * reminder is said either; the next typed prompt says it.
 *
 * Hermetic: a fresh temp data dir per test, removed after; the clock frozen.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { deliverTurn, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { watchedAtStart } from "../src/adapters/claude-code/hooks.js";
import { planNightChild } from "../src/adapters/claude-code/night-run.js";
import { recordSession } from "../src/adapters/sessions.js";
import { CUE_MODE_META, PROSPECTIVE_FIRE_EVENT, PROSPECTIVE_PLAIN_EVENT } from "../src/core/prospective/index.js";
import { startOfLocalDay } from "../src/core/time.js";

const ZONE = "America/Denver";
const DAY = "2026-10-12";
const SCOPE = "/work/studio";
const REFLECTOR = "s-night-reflector";
const RUN = "nrn_test0019";
const REMINDER = "Remind him today to call the kiln supplier before noon about the cracked element.";
const QUIET = "The glaze order from the supplier arrives today, two boxes of celadon.";
const SHARE = "ZQSHARE Last night I dreamed the studio was a window.";

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-night-child-told-"));
});

afterEach(() => {
  setSystemTime();
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function at(hour: number, ymd = DAY): void {
  setSystemTime(new Date(startOfLocalDay(ymd, ZONE) + hour * 3_600_000));
}

function config(): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE };
}

type Adapter = ReturnType<typeof openAdapter>;

function adapter(): Adapter {
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

/** A plain reminder due DAY, and a morning share whose reflecting session has ended, unread. */
function waiting(a: Adapter): string {
  at(20, "2026-10-11");
  const c = a.counterpart;
  const day = c.store.livedDay();
  const felt = c.store.put({
    type: "memory",
    kind: "self",
    about: "me",
    body: "I felt proud when the kiln log finally read like a person's notebook.",
    salience: { relevance: 0.8, emotional: 0.8, predictive: 0.5 },
    physics: { birthDay: day, lastUsedDay: day },
  });
  const id = c.store.put({
    type: "memory",
    kind: "person",
    body: REMINDER,
    learnedOn: "2026-10-11",
    eventDate: DAY,
    salience: { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 },
    meta: { [CUE_MODE_META]: "plain" },
  });
  // A quiet one too: a cue, never said, whose fire is the person's.
  c.store.put({
    type: "memory",
    kind: "fact",
    body: QUIET,
    learnedOn: "2026-10-11",
    eventDate: DAY,
    salience: { novelty: null, relevance: 0.8, emotional: 0.6, predictive: 0.8 },
  });
  recordSession(dir, { sessionId: REFLECTOR, scope: SCOPE, phase: "start" });
  const begun = c.reflections.begin({ session: REFLECTOR });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  const done = c.reflections.finish({
    reflection: begun.bundle.reflection,
    session: REFLECTOR,
    entry: "Looking back over the last few days, the kiln stands out.",
    cites: [felt],
    share: { text: SHARE, cites: [felt] },
  });
  if (!done.ok) throw new Error(`finish refused: ${done.reason}`);
  recordSession(dir, { sessionId: REFLECTOR, scope: SCOPE, phase: "end" });
  return id;
}

/** The night child's environment, as the launch builds it and the host then adds to it. */
function childEnv(host: Record<string, string>): Record<string, string> {
  const plan = planNightChild({
    config: config(),
    run: RUN,
    prompt: "dream",
    scope: SCOPE,
    session: "s-launcher",
    child: "dream",
    // The launching hook's own environment: a person's terminal session.
    baseEnv: { PATH: "/usr/bin", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDECODE: "1" },
  });
  expect(plan.ok).toBe(true);
  return { ...plan.env, ...host };
}

function hook(event: "SessionStart" | "UserPromptSubmit", session: string, env: Record<string, string>, extra: Record<string, unknown> = {}) {
  return toHookInput({ session_id: session, hook_event_name: event, cwd: SCOPE, ...extra }, { scope: SCOPE, timeZone: ZONE, env, dataDir: dir });
}

/** SessionStart then the first prompt, each through the real delivery; what the person and the model were handed. */
function session(a: Adapter, id: string, env: Record<string, string>, prompt: string, source = "startup") {
  recordSession(dir, { sessionId: id, scope: SCOPE, phase: "start" });
  const startIn = hook("SessionStart", id, env, { source });
  const start = a.sessionStart(startIn);
  const startOut = deliverTurn("session-start", start, {}, start.notices ?? null, a, startIn);
  const promptIn = hook("UserPromptSubmit", id, env, { prompt });
  const turn = a.userPromptSubmit(promptIn);
  const turnOut = deliverTurn("user-prompt-submit", turn, {}, null, a, promptIn);
  return { start, startOut, turn, turnOut };
}

function personSaw(out: { stdout: string }): string {
  if (out.stdout.length === 0) return "";
  try {
    return String((JSON.parse(out.stdout) as Record<string, unknown>)["systemMessage"] ?? "");
  } catch {
    return "";
  }
}

const PERSON = { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" };

describe("the night run's child, at 00:19, is told nothing; the 08:00 session a person opens is told both", () => {
  const shapes: [string, Record<string, string>][] = [
    // As measured: `claude -p` sets both in its hooks' environment.
    ["as the host launches it (sdk-cli, attended 0)", { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "0" }],
    // The run's own marker alone holds, whatever a later host says.
    ["with only the run's marker (the host saying cli, attended 1)", PERSON],
  ];
  for (const [name, host] of shapes) {
    test(name, () => {
      const a = adapter();
      waiting(a);
      at(19 / 60);
      const env = childEnv(host);
      for (const child of ["s-night-dream", "s-night-reflection"]) {
        const { start, startOut, turn, turnOut } = session(a, child, env, "Run tonight's dream.");
        expect(start.notices ?? []).toEqual([]);
        expect(start.injection ?? "").not.toContain("call the kiln supplier");
        expect(personSaw(startOut)).toBe("");
        expect(turn.notices ?? []).toEqual([]);
        expect(turn.injection ?? "").not.toContain("call the kiln supplier");
        expect(turn.injection ?? "").not.toContain("ZQSHARE");
        expect(personSaw(turnOut)).toBe("");
        expect(turn.injection ?? "").not.toContain("celadon");
      }
      expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toEqual([]);
      // No cue handed to the run, so no fire of the person's day spent there.
      expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_FIRE_EVENT })).toEqual([]);
      expect(a.counterpart.reflections.pendingShare({ session: "s-morning" })).not.toBeNull();

      at(8);
      const morning = session(a, "s-morning", PERSON, "morning, what's on today?");
      // The wake lists it; its first typed prompt says it once.
      expect(morning.start.injection ?? "").toContain("call the kiln supplier");
      const said = `${personSaw(morning.startOut)}\n${personSaw(morning.turnOut)}`;
      expect(said).toContain("Remind him today to call the kiln supplier");
      expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(1);
      expect(morning.turn.injection ?? "").toContain("ZQSHARE");
      expect(morning.turn.injection ?? "").toContain("celadon");
      expect(a.counterpart.reflections.pendingShare({ session: "s-later" })).toBeNull();
    }, 30_000);
  }
});

describe("a compaction is not where a reminder is said", () => {
  test("SessionStart from a compaction at 00:19 says nothing; the next prompt a person types says it", () => {
    const a = adapter();
    waiting(a);
    at(19 / 60);
    recordSession(dir, { sessionId: "s-coordinator", scope: SCOPE, phase: "start" });
    const startIn = hook("SessionStart", "s-coordinator", PERSON, { source: "compact" });
    const start = a.sessionStart(startIn);
    const out = deliverTurn("session-start", start, {}, start.notices ?? null, a, startIn);
    expect(start.notices ?? []).toEqual([]);
    expect(personSaw(out)).toBe("");
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toEqual([]);
    // The person's next typed prompt, in the same session, says it.
    const promptIn = hook("UserPromptSubmit", "s-coordinator", PERSON, { prompt: "where were we?" });
    const turn = a.userPromptSubmit(promptIn);
    expect(personSaw(deliverTurn("user-prompt-submit", turn, {}, null, a, promptIn))).toContain("Remind him today to call the kiln supplier");
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(1);
  }, 30_000);

  test("who is watched at a session start: startup, clear and resume are a person's; compact and the night run are not", () => {
    for (const source of ["startup", "clear", "resume", undefined]) {
      expect(watchedAtStart({ entrypoint: "cli", attended: true, ...(source === undefined ? {} : { source }) })).toBe(true);
    }
    expect(watchedAtStart({ entrypoint: "cli", attended: true, source: "compact" })).toBe(false);
    expect(watchedAtStart({ entrypoint: "cli", attended: true, nightRun: true, source: "startup" })).toBe(false);
    expect(watchedAtStart({ entrypoint: "sdk-cli", source: "startup" })).toBe(false);
    expect(watchedAtStart({ entrypoint: "cli", attended: false, source: "startup" })).toBe(false);
  });
});

describe("a turn no person started spends no quiet cue (review of #453)", () => {
  test("a hand-back in a person's session hands no temporal cue and fires nothing; the next typed prompt says the reminder", () => {
    const a = adapter();
    waiting(a);
    at(10);
    recordSession(dir, { sessionId: "s-person", scope: SCOPE, phase: "start" });
    const back = hook("UserPromptSubmit", "s-person", PERSON, {
      prompt: 'Another Claude session sent a message:\n<agent-message from="agent-x">Done with the refactor.</agent-message>',
    });
    const handBack = a.userPromptSubmit(back);
    deliverTurn("user-prompt-submit", handBack, {}, null, a, back);
    // The quiet one may still surface by another channel; what matters is that
    // no temporal cue was handed, so no fire of the day was spent here.
    expect(handBack.injection ?? "").not.toContain("call the kiln supplier");
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_FIRE_EVENT })).toEqual([]);
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toEqual([]);

    const typed = hook("UserPromptSubmit", "s-person", PERSON, { prompt: "what's on today?" });
    const turn = a.userPromptSubmit(typed);
    const out = deliverTurn("user-prompt-submit", turn, {}, null, a, typed);
    expect(personSaw(out)).toContain("Remind him today to call the kiln supplier");
    expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(1);
  }, 30_000);
});
