/**
 * THE WAKE KEEPS UP WITH THE DAY (2026-09-30).
 *
 * The wake bundle was rendered once per lived day, by the sleep cycle, at the
 * day's first worker run — so a page written after it, a write-up that landed,
 * or the nightly run's page reached no wake until the next lived day. Measured
 * on the owner's store that morning: the first session woke with the page one
 * version back, and 9 `self.briefing` rows stood for 9 lived days.
 *
 * Now those writes mark the wake behind (`self/behind.ts`) and the next process
 * holding the host's budget re-renders it: the turn-end worker (`runOnce`) and
 * the nightly process (`runNight`, after the child returns). These tests pin:
 *
 *   - a page write is in the wake after the next worker run;
 *   - a write-up is in the wake after the RE-FIRED Stop's worker;
 *   - the nightly run's page is in the wake after the run ends, including when
 *     the day's first worker rendered first (the morning under `auto`);
 *   - same-day re-renders are STABLE: N of them with no store change publish
 *     the same Nearby and add no load; one after new memories may change it
 *     and the display rows say what was published; identity rotates once a day;
 *   - a session that woke before a rebuild still passes its delivery check;
 *   - no budget, no render — `rebrief` and the refresh both refuse;
 *   - the page writer's "yesterday" does not move with the lived day;
 *   - a wake another build published is re-rendered at the next worker
 *     (`version`, 2026-10-02), once, and stamped with the new build.
 *
 * Hermetic: every test opens a fresh temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter, openNightCounterpart, runNight } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput, SpawnPlan } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { readSession, recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import {
  BRIEFING_KEY,
  RENDERED_PREFIX,
  Self,
  WAKE_BEHIND_KEY,
  WAKE_BUILD_KEY,
  markWakeBehind,
  noteWakeCaught,
  pageWriterNight,
  wakeBehind,
} from "../src/core/self/index.js";
import type { SelfTunables } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";
import type { WakeDisplayRow } from "../src/core/store/index.js";

const BUDGET = 9_000;

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-wake-keeps-up-"));
});

afterEach(() => {
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function config(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: BUDGET, owner: true, ...over };
}

function counterpart(over: { budget?: number | null } = {}): Counterpart {
  const budget = over.budget === undefined ? BUDGET : over.budget;
  const c = Counterpart.open({ dir, ...(budget === null ? {} : { budgetBytes: budget }) });
  closers.push(c);
  return c;
}

/** A warm fact, strong enough for Nearby. */
function warm(s: Store, body: string, relevance = 0.8, day = s.livedDay()): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance, emotional: 0.8, predictive: 0.8 },
    physics: { birthDay: day, lastUsedDay: day },
  });
}

function identity(s: Store, body: string, relevance = 0.8): string {
  return s.put({
    type: "memory",
    kind: "self",
    body,
    band: "identity",
    salience: { relevance, emotional: 0.5, predictive: 0.5 },
    physics: { promotedIdentity: true },
  });
}

/** The published bundle, read in a process of its own. */
function published(): string {
  const s = Store.open({ dir, observer: true });
  try {
    return s.getMeta(BRIEFING_KEY) ?? "";
  } finally {
    s.close();
  }
}

/** Every `self.briefing` row's payload, oldest first. */
function briefingRows(): Record<string, unknown>[] {
  const s = Store.open({ dir, observer: true });
  try {
    return s.eventLog({ name: "self.briefing", order: "asc", limit: 1_000 }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
  } finally {
    s.close();
  }
}

/** The worker a Stop spawns, run in this process. */
async function worker(date: string): Promise<void> {
  const report = await runOnce({ config: config(), date, embedder: null });
  expect(report.ran).toBe(true);
}

function writePage(body: string, by: "session" | "owner" = "session"): void {
  const c = Counterpart.open({ dir });
  try {
    const out = c.revisePage(body, { by, reason: "a test's page" });
    expect(out.written).toBe(true);
  } finally {
    c.close();
  }
}

// ---------------------------------------------------------------------------
// the mark
// ---------------------------------------------------------------------------

describe("the mark: set by the writes, caught by a render that read it first", () => {
  test("a page write and a write-up each mark the wake behind; the triggers gather until a render", async () => {
    const c = counterpart();
    expect(wakeBehind(c.store)).toBe(null);
    c.revisePage("The page, first version.", { by: "owner", reason: "first" });
    expect(wakeBehind(c.store)?.triggers).toEqual(["page"]);
    const dep = await c.submitSessionEnd({ content: "A write-up memory about the build this afternoon." }, { session: "s1", scope: "proj" });
    expect(dep.deposited).toBe(true);
    expect(wakeBehind(c.store)?.triggers).toEqual(["page", "write-up"]);

    const out = c.refreshWake({ at: "2026-09-30" });
    expect(out).toMatchObject({ reason: "rendered", triggers: ["page", "write-up"] });
    expect(wakeBehind(c.store)).toBe(null);
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["page", "write-up"] });
    // Caught up: nothing to do, and no row.
    expect(c.refreshWake({ at: "2026-09-30" }).reason).toBe("current");
    expect(briefingRows().length).toBe(1);
  });

  test("a mark set AFTER a render read the old one is not swallowed by that render's catch-up", () => {
    const c = counterpart();
    markWakeBehind(c.store, "page");
    const read = wakeBehind(c.store);
    markWakeBehind(c.store, "write-up"); // lands while the render composes
    noteWakeCaught(c.store, read?.raw ?? "");
    expect(wakeBehind(c.store)?.triggers).toEqual(["page", "write-up"]);
  });

  test("two marks never read alike, even under a clock that stands still", () => {
    const c = Counterpart.open({ dir, budgetBytes: BUDGET, now: () => 1_000 });
    closers.push(c);
    markWakeBehind(c.store, "page");
    noteWakeCaught(c.store, wakeBehind(c.store)?.raw ?? "");
    expect(wakeBehind(c.store)).toBe(null);
    markWakeBehind(c.store, "page");
    expect(wakeBehind(c.store)?.triggers).toEqual(["page"]);
  });

  test("the cycle's own render catches up to a mark set before it: the first worker of a day renders once", async () => {
    const c = counterpart();
    warm(c.store, "Something warm enough to render.");
    c.revisePage("The page before the day's first worker.", { by: "owner", reason: "first" });
    c.close();
    await worker("2026-09-29");
    expect(published()).toContain("The page before the day's first worker.");
    const rows = briefingRows();
    expect(rows.map((r) => r["reason"])).toEqual(["rendered"]);
    const s = Store.open({ dir, observer: true });
    closers.push(s);
    expect(wakeBehind(s)).toBe(null);
  });

  test("no budget, no render: `rebrief` and the refresh refuse, and the mark stays for a process that has one", () => {
    const blind = counterpart({ budget: null });
    blind.revisePage("A page nobody can render yet.", { by: "owner", reason: "first" });
    expect(blind.rebrief().reason).toBe("no-budget");
    expect(blind.refreshWake({ at: "2026-09-30" })).toMatchObject({ reason: "no-budget", triggers: ["page"] });
    expect(wakeBehind(blind.store)?.triggers).toEqual(["page"]);
    expect(briefingRows()).toEqual([]);
    expect(blind.store.getMeta(BRIEFING_KEY)).toBeUndefined();
  });

  test("an observer marks nothing and publishes nothing", () => {
    counterpart().close();
    const watcher = Counterpart.open({ dir, observer: true, budgetBytes: BUDGET });
    closers.push(watcher);
    expect(watcher.revisePage("An observer's page.", { by: "owner", reason: "x" }).written).toBe(false);
    expect(watcher.store.getMeta(WAKE_BEHIND_KEY)).toBeUndefined();
    expect(watcher.refreshWake({ at: "2026-09-30", trigger: "run-end" }).reason).toBe("observer");
    expect(watcher.store.getMeta(BRIEFING_KEY)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// the three triggers, end to end
// ---------------------------------------------------------------------------

describe("the wake keeps up: page, write-up, run end", () => {
  test("a page write is in the wake after the next worker run — the same lived day", async () => {
    const c = counterpart();
    warm(c.store, "Something warm enough to render.");
    c.close();
    await worker("2026-09-29");
    expect(briefingRows().length).toBe(1);

    writePage("A page written mid-afternoon, after the morning's render.");
    expect(published()).not.toContain("mid-afternoon");
    await worker("2026-09-29");
    expect(published()).toContain("A page written mid-afternoon, after the morning's render.");
    // The row carries the run's one date, not the wall clock's.
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["page"], date: "2026-09-29" });

    // Nothing new: the next worker renders nothing.
    await worker("2026-09-29");
    expect(briefingRows().length).toBe(2);
  });

  test("a write-up is in the wake after the RE-FIRED Stop's worker", async () => {
    await worker("2026-09-29");
    const calls: SpawnPlan[] = [];
    const a = openAdapter(config(), {
      command: "/bin/true",
      args: ["runner"],
      spawner: (p) => {
        calls.push(p);
        return { pid: 4242 };
      },
    });
    closers.push(a.counterpart);
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    const mcp = openServer({ dir, session: "s1", scope: "proj", owner: true });
    closers.push(mcp.counterpart);

    // The session answers the Stop ask through `session_end`...
    const answer = await mcp.call("session_end", {
      session: "s1",
      // Marked `world` so it is in the stored bundle's Nearby: an unmarked fact
      // written in a directory is that directory's work since lane 8, delivered there.
      memories: [{ content: "The wake re-renders at the worker after a write-up lands.", relevance: 0.9, emotional: 0.8, predictive: 0.9, about: "world" }],
    });
    expect((answer.structuredContent["outcomes"] as { stored: boolean }[])[0]?.stored).toBe(true);
    expect(published()).not.toContain("after a write-up lands");

    // ...the host re-fires Stop: no second ask, and the worker still spawns.
    const input: HookInput = { sessionId: "s1", scope: "proj", turns: [], at: "2026-09-29", reFired: true };
    const refire = a.stop(input);
    expect(refire.ask).toBe(null);
    expect(refire.spawn?.started).toBe(true);
    expect(calls.length).toBe(1);

    // That worker, run here, catches the wake up.
    await worker("2026-09-29");
    expect(published()).toContain("The wake re-renders at the worker after a write-up lands.");
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["write-up"] });
  });

  test("the morning under `auto`: the day's first worker renders BEFORE the run writes the page, and the run's end puts the page in the wake", async () => {
    // Yesterday, lived and rendered.
    const c = counterpart();
    warm(c.store, "Something warm enough to render.");
    c.revisePage("Yesterday's page, as the night before left it.", { by: "owner", reason: "first" });
    c.close();
    await worker("2026-09-28");
    expect(published()).toContain("Yesterday's page, as the night before left it.");

    // The day's first prompt starts the run; a minute later the first turn-end
    // runs the day's cycle while the run is still going; then the run's writer
    // writes the page; then the child returns.
    let beforeWrite = "";
    const run = await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_test",
      session: "s1",
      scope: dir,
      kind: { kind: "night" },
      date: "2026-09-29",
      baseEnv: { PATH: "/usr/bin:/bin" },
      start: async () => {
        await worker("2026-09-29");
        beforeWrite = published();
        writePage("This morning's page, written by the nightly run.");
        return { code: 0, timedOut: false, error: null };
      },
    });
    expect(run.endedAt).not.toBe(null);
    // Phase 7 rendered first, with yesterday's page...
    expect(beforeWrite).toContain("Yesterday's page, as the night before left it.");
    expect(beforeWrite).not.toContain("This morning's page");
    // ...and the run's end caught the wake up.
    expect(published()).toContain("This morning's page, written by the nightly run.");
    const rows = briefingRows();
    expect(rows.map((r) => r["reason"])).toEqual(["rendered", "rendered", "refresh"]);
    expect(rows.at(-1)).toMatchObject({ triggers: ["page", "run-end"] });
  });

  test("the run's end renders whatever state the run ended in — here, one that did nothing", async () => {
    const c = counterpart();
    warm(c.store, "Something warm enough to render.");
    c.close();
    await worker("2026-09-29");
    const run = await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_test",
      session: "s1",
      scope: dir,
      kind: { kind: "night" },
      date: "2026-09-29",
      baseEnv: { PATH: "/usr/bin:/bin" },
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    expect(run.state).toBe("could-not-start");
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["run-end"] });
  });
});

// ---------------------------------------------------------------------------
// same-day re-renders are stable
// ---------------------------------------------------------------------------

function selfOn(s: Store, over: Partial<SelfTunables> = {}): Self {
  return new Self({ store: s, tunables: over });
}

function displays(s: Store): Record<string, Pick<WakeDisplayRow, "first_day" | "shown_day" | "closed_day" | "load">> {
  const out: Record<string, Pick<WakeDisplayRow, "first_day" | "shown_day" | "closed_day" | "load">> = {};
  for (const [id, r] of s.wakeDisplays()) out[id] = { first_day: r.first_day, shown_day: r.shown_day, closed_day: r.closed_day, load: r.load };
  return out;
}

describe("a same-day re-render is stable", () => {
  test("N re-renders with no store change publish the same Nearby, the same bundle, and add no load", () => {
    const s = Store.open({ dir });
    closers.push(s);
    const strong = warm(s, "The strongest warm thing in this store.", 0.95, 0);
    const next = warm(s, "A slightly less strong warm thing.", 0.75, 0);
    const me = selfOn(s, { HINTS_MAX: 1 });
    expect(me.boundary({ budgetBytes: BUDGET, day: 1 }).briefing.kept.hints).toEqual([strong]);
    // Day 2: the strong one yields to the other — the rotation working.
    expect(me.boundary({ budgetBytes: BUDGET, day: 2 }).briefing.kept.hints).toEqual([next]);
    const bundle = s.getMeta(BRIEFING_KEY);
    const rows = displays(s);
    // Before 2026-09-30 the next render today scored `next` at its stepped
    // load — half — and handed the lane back to `strong`.
    for (let i = 0; i < 4; i += 1) {
      expect(me.boundary({ budgetBytes: BUDGET, day: 2 }).briefing.kept.hints).toEqual([next]);
      expect(s.getMeta(BRIEFING_KEY)).toBe(bundle);
      expect(displays(s)).toEqual(rows);
    }
    // Tomorrow rotates as it always did.
    expect(me.boundary({ budgetBytes: BUDGET, day: 3 }).briefing.kept.hints).toEqual([strong]);
  });

  test("through the Counterpart: the worker's refreshes after the day's render publish the day's bundle byte for byte", async () => {
    const c = counterpart();
    for (let i = 0; i < 14; i += 1) warm(c.store, `A warm memory, number ${String(i)}, about something the day held.`, 0.5 + i * 0.03);
    await c.sessionEnd({ date: "2026-09-28", at: "2026-09-28" });
    await c.sessionEnd({ date: "2026-09-29", at: "2026-09-29" });
    const bundle = c.store.getMeta(BRIEFING_KEY);
    const rows = displays(c.store);
    for (let i = 0; i < 3; i += 1) {
      expect(c.refreshWake({ at: "2026-09-29", trigger: "run-end" }).reason).toBe("rendered");
      expect(c.store.getMeta(BRIEFING_KEY)).toBe(bundle);
      expect(displays(c.store)).toEqual(rows);
    }
  });

  test("a re-render after new memories may change Nearby, and the display rows say exactly what was published", () => {
    const s = Store.open({ dir });
    closers.push(s);
    warm(s, "A warm thing the morning showed.", 0.8, 0);
    warm(s, "Another warm thing the morning showed.", 0.7, 0);
    warm(s, "A third, below the lane's cut on the first day.", 0.4, 0);
    const me = selfOn(s, { HINTS_MAX: 2 });
    me.boundary({ budgetBytes: BUDGET, day: 1 });
    const morning = me.boundary({ budgetBytes: BUDGET, day: 2 }).briefing.kept.hints;
    const before = displays(s);

    const fresh = warm(s, "Learned this afternoon, and stronger than anything the morning showed.", 1.0, 2);
    const kept = me.boundary({ budgetBytes: BUDGET, day: 2 }).briefing.kept.hints;
    expect(kept).toContain(fresh);
    expect(kept.length).toBe(2);
    const dropped = morning.filter((id) => !kept.includes(id));
    expect(dropped.length).toBe(1);

    const after = displays(s);
    const open = Object.entries(after).filter(([, r]) => r.closed_day === null).map(([id]) => id).sort();
    expect(open).toEqual([...kept].sort());
    // The new one opened today with one step; the one it pushed out closed
    // today with its load as it was; the one that stayed took no second step.
    expect(after[fresh]).toMatchObject({ first_day: 2, shown_day: 2, closed_day: null, load: 1 });
    const out = dropped[0] as string;
    expect(after[out]).toMatchObject({ closed_day: 2, load: before[out]?.load });
    for (const id of kept.filter((k) => k !== fresh)) expect(after[id]).toEqual(before[id]);
  });

  test("after new memories, a second refresh with no change publishes identical bytes (review of #287)", async () => {
    const c = counterpart();
    for (let i = 0; i < 12; i += 1) warm(c.store, `A warm memory, number ${String(i)}, about the morning.`, 0.5 + i * 0.03);
    await c.sessionEnd({ date: "2026-09-28", at: "2026-09-28" });
    await c.sessionEnd({ date: "2026-09-29", at: "2026-09-29" });
    for (let i = 0; i < 4; i += 1) warm(c.store, `Fresh this afternoon, strong, number ${String(i)}.`, 1.0);
    await c.submitSessionEnd({ content: "A write-up memory about the afternoon's build, strongly worded." }, { session: "s1", scope: "proj" });
    expect(c.refreshWake({ at: "2026-09-29" }).reason).toBe("rendered");
    // The open display rows are exactly what the render kept.
    const rendered = c.self.events("self.briefing.rendered").pop();
    const bundle = c.store.getMeta(BRIEFING_KEY) ?? "";
    const open = [...c.store.wakeDisplays().values()].filter((r) => r.closed_day === null).map((r) => r.memory_id);
    expect(open.length).toBe(Number(rendered?.data?.["hints"] ?? -1));
    for (const id of open) expect(bundle).toContain(c.store.readProse(id).body.slice(0, 30));
    // Hints the afternoon's render dropped are closed today and carry today's
    // step; a second refresh with nothing new must not reorder them.
    markWakeBehind(c.store, "page");
    const before = displays(c.store);
    expect(c.refreshWake({ at: "2026-09-29" }).reason).toBe("rendered");
    expect(c.store.getMeta(BRIEFING_KEY)).toBe(bundle);
    expect(displays(c.store)).toEqual(before);
  });

  test("identity rotates once a day however often the wake is rebuilt", () => {
    const s = Store.open({ dir });
    closers.push(s);
    const ids = ["I say what I do not know.", "I finish what I start.", "I ask before I guess.", "I keep the owner's words.", "I write things down."].map((b, i) => identity(s, b, 0.9 - i * 0.05));
    const me = selfOn(s, { IDENTITY_MAX: 2 });
    const first = me.boundary({ budgetBytes: BUDGET, day: 1 }).briefing.kept.identity;
    expect(first.length).toBe(2);
    const stamps = (): Record<string, string> => Object.fromEntries(s.metaWithPrefix(RENDERED_PREFIX));
    const stamped = stamps();
    for (let i = 0; i < 3; i += 1) {
      expect([...me.boundary({ budgetBytes: BUDGET, day: 1 }).briefing.kept.identity].sort()).toEqual([...first].sort());
      expect(stamps()).toEqual(stamped);
    }
    // The next lived day moves on to elements the first day did not show.
    const second = me.boundary({ budgetBytes: BUDGET, day: 2 }).briefing.kept.identity;
    expect(second.some((id) => first.includes(id))).toBe(false);
    expect(ids).toEqual(expect.arrayContaining([...first, ...second]));
  });
});

// ---------------------------------------------------------------------------
// the delivery check
// ---------------------------------------------------------------------------

describe("the delivery check reads each session's own sentinel", () => {
  test("a session that woke before a rebuild still passes its delivery check", async () => {
    const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    closers.push(a.counterpart);
    warm(a.counterpart.store, "The storage split put canonical prose on disk.", 0.9);
    await a.counterpart.sessionEnd({ date: "2026-09-29" });
    const input = (sessionId: string, over: Partial<HookInput> = {}): HookInput => ({ sessionId, scope: "proj", turns: [], at: "2026-09-29", ...over });
    const woke = a.sessionStart(input("s1"));
    expect(woke.sentinel).not.toBe(null);

    // Mid-day: the page is written and the wake rebuilt under the session.
    a.counterpart.revisePage("A page written after s1 woke.", { by: "owner", reason: "mid-day" });
    expect(a.counterpart.refreshWake({ at: "2026-09-29" }).reason).toBe("rendered");
    expect(a.counterpart.store.getMeta(BRIEFING_KEY)).toContain("A page written after s1 woke.");

    // s1's first prompt checks what s1 was handed, against s1's own sentinel.
    const transcript = join(dir, "t1.jsonl");
    const attachment = {
      type: "attachment",
      uuid: "att-1",
      attachment: {
        type: "hook_success",
        hookEvent: "SessionStart",
        hookName: "counterparts",
        command: "bun run /repo/src/adapters/claude-code/bin/hook.ts",
        stdout: woke.injection,
        content: woke.injection,
        stderr: "",
        exitCode: 0,
        durationMs: 37,
        toolUseID: "hook-abc",
      },
    };
    writeFileSync(transcript, `${JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", uuid: "sys-1" })}\n${JSON.stringify(attachment)}\n`, "utf8");
    a.userPromptSubmit(input("s1", { prompt: "hello", transcriptPath: transcript }));
    const rows = a.events("adapter.wake.delivered");
    expect(rows.length).toBe(1);
    expect(rows[0]?.data?.["outcome"]).toBe("delivered");
    expect(readSession(dir, "s1")?.wakeSentinel).toBe(woke.sentinel as string);

    // And a session that starts now wakes to the rebuilt bundle.
    expect(a.sessionStart(input("s2")).injection).toContain("A page written after s1 woke.");
  });
});

// ---------------------------------------------------------------------------
// the page writer's "yesterday"
// ---------------------------------------------------------------------------

describe("the page writer's night does not move with the lived day", () => {
  test("a run started before the day's first worker is about the calendar yesterday, and so is one started after", () => {
    const now = Date.parse("2026-09-29T16:00:00Z");
    const c = Counterpart.open({ dir, budgetBytes: BUDGET, timeZone: "UTC", now: () => now });
    closers.push(c);
    c.store.advanceClock("2026-09-27");
    c.store.advanceClock("2026-09-28");
    c.store.put({
      type: "memory",
      kind: "fact",
      body: "Something that happened on the 28th.",
      salience: { relevance: 0.7, emotional: 0.5, predictive: 0.6 },
      learnedOn: "2026-09-28",
    });
    const lived = c.store.livedDay();
    // The morning under `auto`: the run starts at the first prompt, before the
    // first turn-end has advanced the lived day for the 29th.
    expect(pageWriterNight(c.store)).toEqual({ today: "2026-09-29", about: "2026-09-28" });
    expect(c.self.pageWriterDue({ mode: "session" })).toMatchObject({ due: true, about: "2026-09-28" });
    // The first worker advances the lived day; the night is the same night.
    c.store.advanceClock("2026-09-29");
    expect(c.store.livedDay()).toBe(lived + 1);
    expect(pageWriterNight(c.store)).toEqual({ today: "2026-09-29", about: "2026-09-28" });
    expect(c.self.pageWriterDue({ mode: "session" })).toMatchObject({ due: true, about: "2026-09-28" });
  });
});

// ---------------------------------------------------------------------------
// a new build (2026-10-02)
// ---------------------------------------------------------------------------

describe("a wake another build published is re-rendered at the next worker", () => {
  function stamp(): string | undefined {
    const s = Store.open({ dir, observer: true });
    try {
      return s.getMeta(WAKE_BUILD_KEY);
    } finally {
      s.close();
    }
  }

  test("after an install, the first worker re-renders under `version`, stamps the new build, and the next renders nothing", async () => {
    const c = counterpart();
    warm(c.store, "Something warm enough to render.");
    c.close();
    // The old version renders the day's wake.
    expect((await runOnce({ config: config(), date: "2026-09-29", embedder: null, build: "0.3.10" })).ran).toBe(true);
    expect(stamp()).toBe("0.3.10");
    expect(briefingRows().map((r) => r["reason"])).toEqual(["rendered"]);
    // Same build, nothing marked: nothing rendered.
    await runOnce({ config: config(), date: "2026-09-29", embedder: null, build: "0.3.10" });
    expect(briefingRows().length).toBe(1);

    // The install: same lived day, a new build.
    const events: string[] = [];
    await runOnce({
      config: config(),
      date: "2026-09-29",
      embedder: null,
      build: "0.3.11",
      onEvent: (n, d) => events.push(`${n}:${String(d["triggers"] ?? "")}`),
    });
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["version"], date: "2026-09-29" });
    expect(stamp()).toBe("0.3.11");
    expect(events).toContain("runner.wake:version");
    await runOnce({ config: config(), date: "2026-09-29", embedder: null, build: "0.3.11" });
    expect(briefingRows().length).toBe(2);
  });

  test("a bundle published before the stamp existed is another build's; a pending mark and `version` render once together", async () => {
    const c = counterpart();
    warm(c.store, "Something warm enough to render.");
    c.close();
    // The day's first worker, from a build that stamped nothing.
    await runOnce({ config: config(), date: "2026-09-29", embedder: null, build: null });
    expect(stamp()).toBeUndefined();
    writePage("A page written before the install.", "owner");
    await runOnce({ config: config(), date: "2026-09-29", embedder: null, build: "0.3.11" });
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["page", "version"] });
    expect(published()).toContain("A page written before the install.");
    expect(stamp()).toBe("0.3.11");
  });

  test("an unknown build compares nothing and stamps nothing; no bundle yet is the cycle's to render", () => {
    const blind = Counterpart.open({ dir, budgetBytes: BUDGET, build: null });
    closers.push(blind);
    warm(blind.store, "Something warm enough to render.");
    expect(blind.rebrief({ at: "2026-09-29" }).published).toBe(true);
    expect(blind.refreshWake({ at: "2026-09-29" }).reason).toBe("current");
    expect(blind.store.getMeta(WAKE_BUILD_KEY)).toBeUndefined();
    const fresh = Counterpart.open({ dir: mkdtempSync(join(dir, "empty-")), budgetBytes: BUDGET, build: "0.3.11" });
    closers.push(fresh);
    expect(fresh.refreshWake({ at: "2026-09-29" }).reason).toBe("current");
  });
});
