/**
 * THE NIGHT'S TWO HOLES (2026-11-01, NT1). That morning a night started from a `claude -p`
 * session in a lid-closed dark wake; its catch-up child got about 15 s awake, the laptop
 * slept 853 s, and the 10-minute watchdog fired on wake.
 *
 *   1. A watchdog doesn't charge sleep to a run (`awake.ts`, and `child.ts` over it).
 *   2. A headless session doesn't start the night; the next session a person starts does.
 *
 * What sleep itself does can only be read live. Here: the arithmetic on a stubbed clock, in
 * both shapes a runtime's timer takes across a sleep; and a real waiter stopped with SIGSTOP,
 * which proves the gap is told from the watchdog in a real process, and not that a laptop's
 * sleep looks like SIGSTOP (the child keeps running through a stop, and clocks all run on).
 *
 * The real path is real hook and CLI processes on a temp store, with a stub `claude` first
 * on PATH. Nothing calls a model. Hermetic: every test makes its own temp directory.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { armAwake, awakeMeter } from "../src/adapters/claude-code/awake.js";
import { nightRowTimeoutMs, openNightCounterpart, runNight } from "../src/adapters/claude-code/night-run.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, nightRunLost } from "../src/core/dream/index.js";
import type { NightRun } from "../src/core/dream/index.js";
import { addDays, localDate } from "../src/core/time.js";

const ROOT = resolve(import.meta.dir, "..");
const HOOK = join(ROOT, "src/adapters/claude-code/bin/hook.ts");
const CLI = join(ROOT, "src/adapters/cli/bin/counterparts.ts");
const AWAKE_CHILD = join(ROOT, "test/fixtures/awake-child.ts");
const MIN = 60_000;
const HOUR = 60 * MIN;

/** A clock and a timer queue a test drives by hand. */
function stubbed(start = 1_000_000): {
  now: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
  /** Time passes awake: every timer due in `ms` fires on time. */
  awake: (ms: number) => void;
  /** A sleep whose timers fire on wake (macOS: the clock under them ran on). */
  sleepFiringOnWake: (ms: number) => void;
  /** A suspend whose timers stop with the clock under them (Linux). */
  sleepThenTimersResume: (ms: number) => void;
} {
  let t = start;
  let timers: { at: number; fn: () => void }[] = [];
  const runDue = (): void => {
    for (;;) {
      const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) return;
      timers = timers.filter((x) => x !== due);
      due.fn();
    }
  };
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const entry = { at: t + ms, fn };
      timers.push(entry);
      return () => {
        timers = timers.filter((x) => x !== entry);
      };
    },
    awake(ms) {
      const end = t + ms;
      for (;;) {
        const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        t = Math.max(t, next.at);
        runDue();
      }
      t = end;
    },
    sleepFiringOnWake(ms) {
      t += ms;
      runDue();
    },
    sleepThenTimersResume(ms) {
      t += ms;
      timers = timers.map((x) => ({ ...x, at: x.at + ms }));
    },
  };
}

describe("a watchdog counts time awake", () => {
  const TICK = 1_000;
  const GAP = 30_000;
  const BUDGET = 10 * MIN;

  test("a child stuck awake is stopped on schedule", () => {
    const c = stubbed();
    let fired = 0;
    armAwake(() => (fired += 1), BUDGET, { now: c.now, schedule: c.schedule, tickMs: TICK, gapMs: GAP });
    c.awake(BUDGET - 1);
    expect(fired).toBe(0);
    c.awake(1);
    expect(fired).toBe(1);
    c.awake(BUDGET);
    expect(fired).toBe(1);
  });

  for (const [shape, sleep] of [
    ["fires on wake (macOS)", "sleepFiringOnWake"],
    ["stops through the suspend (Linux)", "sleepThenTimersResume"],
  ] as const) {
    test(`the night of 11-01: 15 s awake, 853 s asleep, and the rest of its ten minutes, when a timer ${shape}`, () => {
      const c = stubbed();
      let fired = 0;
      const slept: number[] = [];
      armAwake(() => (fired += 1), BUDGET, { now: c.now, schedule: c.schedule, tickMs: TICK, gapMs: GAP, onSlept: (ms) => slept.push(ms) });
      c.awake(15_000);
      c[sleep](853_000);
      c.awake(0);
      expect(fired).toBe(0);
      // Past the point the plain timer fired (868 s of wall clock), with most of the budget left.
      c.awake(BUDGET - 15_000 - 2 * TICK);
      expect(fired).toBe(0);
      c.awake(3 * TICK);
      expect(fired).toBe(1);
      expect(slept).toHaveLength(1);
      expect(slept[0] as number).toBeGreaterThanOrEqual(853_000 - TICK);
      expect(slept[0] as number).toBeLessThanOrEqual(853_000 + TICK);
    });
  }

  test("several sleeps, each short of the budget in total awake: each is told, none is charged", () => {
    const c = stubbed();
    let fired = 0;
    const slept: number[] = [];
    armAwake(() => (fired += 1), BUDGET, { now: c.now, schedule: c.schedule, tickMs: TICK, gapMs: GAP, onSlept: (ms) => slept.push(ms) });
    for (let i = 0; i < 5; i += 1) {
      c.awake(MIN);
      c.sleepFiringOnWake(2 * HOUR);
    }
    expect(fired).toBe(0);
    expect(slept).toHaveLength(5);
    c.awake(5 * MIN);
    expect(fired).toBe(1);
  });

  test("a sleep under the gap is charged: a busy machine's stall is never read as sleep", () => {
    const c = stubbed();
    let fired = 0;
    const slept: number[] = [];
    armAwake(() => (fired += 1), MIN, { now: c.now, schedule: c.schedule, tickMs: TICK, gapMs: GAP, onSlept: (ms) => slept.push(ms) });
    c.sleepFiringOnWake(GAP - 1);
    expect(slept).toEqual([]);
    c.awake(MIN - GAP + 1);
    expect(fired).toBe(1);
  });

  test("a wall clock stepped back never stretches the budget by more than a tick", () => {
    let t = 10 * HOUR;
    const timers: (() => void)[] = [];
    let fired = 0;
    armAwake(() => (fired += 1), 5 * TICK, {
      now: () => t,
      schedule: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
      tickMs: TICK,
      gapMs: GAP,
    });
    let ticks = 0;
    while (fired === 0 && ticks < 20) {
      t += ticks === 1 ? -HOUR : TICK;
      (timers.shift() as () => void)();
      ticks += 1;
    }
    expect(fired).toBe(1);
    expect(ticks).toBeLessThanOrEqual(6);
  });

  test("cancelled, it stays quiet", () => {
    const c = stubbed();
    let fired = 0;
    const cancel = armAwake(() => (fired += 1), MIN, { now: c.now, schedule: c.schedule, tickMs: TICK, gapMs: GAP });
    c.awake(TICK * 2);
    cancel();
    c.awake(HOUR);
    expect(fired).toBe(0);
  });

  test("the meter counts what a wait slept, and sees it when read, before its next tick", () => {
    const c = stubbed();
    const told: number[] = [];
    const meter = awakeMeter({ now: c.now, schedule: c.schedule, tickMs: TICK, gapMs: GAP, onSlept: (ms) => told.push(ms) });
    c.awake(10 * TICK);
    expect(meter.asleepMs()).toBe(0);
    // Linux's shape: the wait ends on wake, a tick before the timer would have come.
    c.sleepThenTimersResume(3 * HOUR);
    const read = meter.asleepMs();
    expect(read).toBeGreaterThanOrEqual(3 * HOUR - TICK);
    expect(told).toEqual([read]);
    c.awake(5 * TICK);
    expect(meter.asleepMs()).toBe(read);
    meter.stop();
  });

  test("a throw from whoever is told never reaches the watchdog", () => {
    const c = stubbed();
    let fired = 0;
    armAwake(() => (fired += 1), MIN, {
      now: c.now,
      schedule: c.schedule,
      tickMs: TICK,
      gapMs: GAP,
      onSlept: () => {
        throw new Error("the store would not open");
      },
    });
    c.sleepFiringOnWake(HOUR);
    c.awake(MIN);
    expect(fired).toBe(1);
  });
});

// ── a real waiter, stopped and continued ────────────────────────────────────

/** Runs the fixture; `stop` freezes the waiter for that long once it has started. */
async function realWaiter(watchdog: number, stop: number | null): Promise<{ ms: number; timedOut: boolean; error: string | null }> {
  const child = spawn(process.execPath, ["run", AWAKE_CHILD, String(watchdog), "50", "500"], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  const ready = new Promise<void>((done) => {
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString("utf8");
      if (out.includes("ready")) done();
    });
  });
  const closed = new Promise<void>((done) => child.on("close", () => done()));
  await ready;
  if (stop !== null) {
    await Bun.sleep(150);
    child.kill("SIGSTOP");
    await Bun.sleep(stop);
    child.kill("SIGCONT");
  }
  await closed;
  const last = out.trim().split("\n").at(-1) ?? "{}";
  return JSON.parse(last) as { ms: number; timedOut: boolean; error: string | null };
}

describe("a real waiter (SIGSTOP, not sleep: see the header)", () => {
  test("a stuck child is killed on schedule", async () => {
    const r = await realWaiter(800, null);
    expect(r.timedOut).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(750);
    expect(r.ms).toBeLessThan(3_000);
  }, 15_000);

  test("stopped past its watchdog, it gets the rest of its time on waking, then the child is killed", async () => {
    const r = await realWaiter(800, 2_000);
    expect(r.timedOut).toBe(true);
    // A plain timer fires as it's continued, about 2,150 ms in. This one has its 800 awake first.
    expect(r.ms).toBeGreaterThanOrEqual(2_700);
  }, 15_000);
});

// ── the real hook on a temp store ───────────────────────────────────────────

let work: string;
let store: string;
let cfg: string;
let home: string;
let bin: string;
let stubLog: string;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-night-holes-")));
  store = join(work, "store");
  cfg = join(work, "claude-code.json");
  home = join(work, "home");
  bin = join(work, "bin");
  stubLog = join(work, "stub-claude.log");
  for (const d of [home, bin]) mkdirSync(d, { recursive: true });
  writeFileSync(cfg, `${JSON.stringify({ dataDir: store, injectionBudgetBytes: 9000 })}\n`);
  // The night's children: the stub says it was called, reads its stdin, and exits.
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho called >> "${stubLog}"\ncat > /dev/null\nexit 0\n`);
  chmodSync(join(bin, "claude"), 0o755);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const CLAUDE_P = { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDECODE: "1" };
const AGENT_SDK = { CLAUDE_CODE_ENTRYPOINT: "sdk-ts", CLAUDECODE: "1" };
const PERSON = { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDECODE: "1" };

function envOf(host: Record<string, string>): Record<string, string> {
  return {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    USERPROFILE: home,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    ...host,
  };
}

const today = (): string => localDate(Date.now());

/** Lived days behind it, enough new memory that the day's night is due, and the setting. */
function dueStore(setting: "auto" | "ask" = "auto"): void {
  const c = Counterpart.open({ dir: store, identity: { name: "Dana" } });
  try {
    for (let d = 10; d >= 1; d -= 1) c.store.advanceClock(addDays(today(), -d));
    const day = c.store.livedDay();
    for (const body of [
      "The kiln needs an hour to cool before the shelves come out.",
      "Glaze runs if the coat is thicker than a fingernail.",
      "Dana likes to see a test tile before committing a whole batch.",
      "I say what I do not know before I guess.",
    ]) {
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
    }
    expect(c.dreams.setSetting(setting, { by: "owner" }).ok).toBe(true);
  } finally {
    c.close();
  }
}

/** One real `UserPromptSubmit` hook process. */
function promptHook(session: string, host: Record<string, string>): { code: number | null; stdout: string } {
  const res = spawnSync(process.execPath, ["run", HOOK, "--config", cfg], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: session, cwd: work, prompt: "good morning", prompt_id: `p-${session}` }),
    env: envOf(host),
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: res.status, stdout: res.stdout };
}

function cli(args: string[], host: Record<string, string>): { code: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, ["run", CLI, ...args], { env: envOf(host), encoding: "utf8", timeout: 60_000 });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function read<T>(fn: (c: Counterpart) => T): T {
  const c = Counterpart.open({ dir: store });
  try {
    return fn(c);
  } finally {
    c.close();
  }
}

const stubCalls = (): number => (existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n").length : 0);

function logRows(name: string): Record<string, unknown>[] {
  const dir = join(store, "sessions", "log");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n"))
    .filter((l) => l.includes(`"name":"${name}"`))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** The night's real process has ended: its row left `started`. */
async function nightEnded(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (read((c) => c.dreams.nightRun()?.state) !== "started") return;
    await Bun.sleep(100);
  }
  throw new Error("the night's process never ended");
}

describe("a headless session leaves the night; the next person's session takes it", () => {
  test("`claude -p`, then the Agent SDK, pass and spend nothing; a person's prompt starts the one night", async () => {
    dueStore();

    for (const [session, shape] of [
      ["print-1", CLAUDE_P],
      ["sdk-1", AGENT_SDK],
      ["print-2", CLAUDE_P],
    ] as const) {
      const out = promptHook(session, shape);
      expect(out.code).toBe(0);
      expect(out.stdout).not.toContain("dreaming");
    }
    expect(read((c) => c.dreams.nightRun())).toBeNull();
    expect(read((c) => c.store.dreamAsk(today()))).toBeUndefined();
    expect(stubCalls()).toBe(0);
    // Each said so in the log, and it's still due for the next session.
    expect(logRows("adapter.night.started")).toEqual([]);
    const passed = logRows("adapter.dream.unwatched").map((r) => r["data"]);
    expect(passed).toEqual([
      { started: false, passed: "headless", entrypoint: "sdk-cli" },
      { started: false, passed: "headless", entrypoint: "sdk-ts" },
      { started: false, passed: "headless", entrypoint: "sdk-cli" },
    ]);
    expect(read((c) => c.dreams.offer({ at: today(), session: "x" })?.headless)).toBe(true);

    const person = promptHook("person-1", PERSON);
    expect(person.code).toBe(0);
    expect((JSON.parse(person.stdout) as { systemMessage?: string }).systemMessage).toContain("dreaming in the background");
    expect(read((c) => c.dreams.nightRun())).toMatchObject({ session: "person-1", date: today() });
    expect(read((c) => c.store.dreamAsk(today())?.state)).toBe("launched");
    expect(logRows("adapter.night.started")).toHaveLength(1);

    // The real nightly process reached its stub children.
    await nightEnded();
    expect(stubCalls()).toBeGreaterThan(0);

    // Headless again, later: nothing moves.
    const row = read((c) => c.dreams.nightRun());
    expect(promptHook("print-3", CLAUDE_P).code).toBe(0);
    expect(read((c) => c.dreams.nightRun())).toEqual(row);
    expect(logRows("adapter.night.started")).toHaveLength(1);
  }, 60_000);

  test("a person's session first starts it as it always did; a headless one after it changes nothing", async () => {
    dueStore();
    expect(promptHook("person-1", PERSON).code).toBe(0);
    expect(read((c) => c.dreams.nightRun()?.session)).toBe("person-1");
    expect(promptHook("print-1", CLAUDE_P).code).toBe(0);
    expect(logRows("adapter.night.started")).toHaveLength(1);
    await nightEnded();
  }, 60_000);

  test("under `ask` a headless session still claims nothing, says nothing, and logs no pass", () => {
    dueStore("ask");
    expect(promptHook("print-1", CLAUDE_P).stdout).not.toContain("dream");
    expect(read((c) => c.store.dreamAsk(today()))).toBeUndefined();
    expect(logRows("adapter.dream.unwatched")).toEqual([]);
  }, 30_000);
});

describe("a night row doesn't read as lost while its run sleeps", () => {
  const config = (): AdapterConfig => ({ dataDir: store, injectionBudgetBytes: 9000 });

  /** The row as the hook starts it, and `runNight` over it with a child that sleeps `ms` halfway. */
  async function nightSleeping(ms: number, clock: { t: number }): Promise<{ during: NightRun | null; underWay: boolean; second: unknown; end: NightRun }> {
    dueStore();
    const c = Counterpart.open({ dir: store });
    const offer = c.dreams.offer({ at: today(), session: "person-1" });
    if (offer === null || !c.dreams.claimOffer(offer)) throw new Error("no offer");
    const started: NightRun = { run: "nrn_sleeper", date: today(), kind: "night", session: "person-1", state: "started", startedAt: clock.t, timeoutMs: nightRowTimeoutMs(config(), "night"), endedAt: null, reason: null, detail: null, code: null, dream: null, reflection: null };
    c.dreams.recordNightRun(started);
    c.close();

    let tell: ((n: number) => void) | null = null;
    let total = 0;
    let during: NightRun | null = null;
    let underWay = false;
    let second: unknown = "unread";
    const end = await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_sleeper",
      session: "person-1",
      scope: work,
      kind: { kind: "night" },
      date: today(),
      startCatchUp: async () => ({ code: 0, timedOut: false, error: null }),
      start: async () => {
        if (during === null) {
          clock.t += ms;
          total += ms;
          (tell as unknown as (n: number) => void)(ms);
          const now = clock.t;
          const o = Counterpart.open({ dir: store, now: () => now });
          try {
            during = o.dreams.nightRun();
            underWay = o.dreams.nightRunUnderWay();
            second = o.dreams.offer({ at: today(), session: "person-2" });
          } finally {
            o.close();
          }
        }
        return { code: 0, timedOut: false, error: null };
      },
      now: () => clock.t,
      awake: (onSlept) => {
        tell = onSlept;
        return { asleepMs: () => total, stop: () => undefined };
      },
    });
    return { during, underWay, second, end };
  }

  test("twelve hours asleep: the row carries it, the run is still under way, and nothing offers a second one", async () => {
    const clock = { t: Date.now() };
    const { during, underWay, second, end } = await nightSleeping(12 * HOUR, clock);
    expect(during?.sleptMs).toBe(12 * HOUR);
    expect(underWay).toBe(true);
    expect(second).toBeNull();
    // It ended; the end row says how much of its time the machine slept.
    expect(end.sleptMs).toBe(12 * HOUR);
    const row = read((c) => c.store.eventLog({ name: "dream.night" }).at(-1));
    expect(JSON.parse(row?.payload ?? "{}").sleptMs).toBe(12 * HOUR);
  }, 30_000);

  test("past its watchdog with no sleep written, a run is lost, as before: a process that has really gone stops adding", () => {
    const at = 1_800_000_000_000;
    const row = { state: "started", startedAt: at, timeoutMs: HOUR } as const;
    const grace = DREAM_TUNABLES.NIGHT_LOST_GRACE_MS;
    expect(nightRunLost(row, at + HOUR + grace + 1)).toBe(true);
    expect(nightRunLost({ ...row, sleptMs: 5 * HOUR }, at + HOUR + grace + 1)).toBe(false);
    expect(nightRunLost({ ...row, sleptMs: 5 * HOUR }, at + 6 * HOUR + grace + 1)).toBe(true);
  });
});

describe("what a person runs by hand is unaffected, even from a headless shell", () => {
  /** A session that talked yesterday and ended, owing its write-up. */
  function owed(id: string): void {
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    let at = yesterday.getTime() - 14 * HOUR;
    const c = Counterpart.open({ dir: store, now: () => at });
    try {
      recordSession(store, { sessionId: id, scope: work, phase: "start", at, entrypoint: "cli" });
      const turns: { role: "user" | "assistant"; text: string }[] = [];
      for (let i = 0; i < 6; i += 1) {
        at += 8 * MIN;
        turns.push({ role: "user", text: `${id} #${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs.` });
        turns.push({ role: "assistant", text: `(${id} #${String(i)}) Understood, the valve on loop ${String(i)} first.` });
        c.captureSpans({ session: id, scope: work, turns: [...turns] });
      }
      c.boundary({ session: id, scope: work, kind: "session-end" });
      recordSession(store, { sessionId: id, scope: work, phase: "end", at: at + 1 });
    } finally {
      c.close();
    }
  }

  test("`counterparts catch-up` starts its child, and `counterparts dream` answers; neither touches the day's night", () => {
    dueStore();
    owed("day1-a");
    const caught = cli(["catch-up", "--config", cfg], CLAUDE_P);
    expect(stubCalls()).toBeGreaterThan(0);
    expect(caught.stdout).toContain("Catching up");
    expect(read((c) => c.store.eventLog({ name: "adapter.night.writeup" }).length)).toBe(1);

    const dream = cli(["dream", "--dir", store], CLAUDE_P);
    expect(dream.code).toBe(0);

    expect(read((c) => c.dreams.nightRun())).toBeNull();
    expect(read((c) => c.store.dreamAsk(today()))).toBeUndefined();
    expect(read((c) => c.dreams.offer({ at: today(), session: "x" })?.headless)).toBe(true);
  }, 90_000);
});

describe("a store only headless sessions use", () => {
  function sessionsOld(entries: readonly (readonly [string, string])[]): void {
    const at = Date.now() - 3 * 24 * HOUR;
    for (const [id, entrypoint] of entries) recordSession(store, { sessionId: id, scope: work, phase: "start", at, entrypoint });
  }

  test("doctor says why no night comes, through the real command", () => {
    dueStore();
    sessionsOld([
      ["print-1", "sdk-cli"],
      ["sdk-1", "sdk-ts"],
    ]);
    const out = cli(["doctor", "--config", cfg], {});
    expect(out.stdout).toContain("only headless sessions here this week");
  }, 60_000);

  test("one session a person started keeps it quiet", () => {
    dueStore();
    sessionsOld([
      ["print-1", "sdk-cli"],
      ["person-1", "cli"],
    ]);
    expect(cli(["doctor", "--config", cfg], {}).stdout).not.toContain("only headless sessions");
  }, 60_000);

  test("nor does it speak under `ask`, or while the headless sessions are new", () => {
    dueStore("ask");
    sessionsOld([["print-1", "sdk-cli"]]);
    expect(cli(["doctor", "--config", cfg], {}).stdout).not.toContain("only headless sessions");
    rmSync(store, { recursive: true, force: true });
    dueStore();
    recordSession(store, { sessionId: "print-2", scope: work, phase: "start", at: Date.now() - HOUR, entrypoint: "sdk-cli" });
    expect(cli(["doctor", "--config", cfg], {}).stdout).not.toContain("only headless sessions");
  }, 90_000);
});
