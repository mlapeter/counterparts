/**
 * THE WAKE POLISH OF 2026-10-25 (the wake-polish builder, from random-5b's
 * wake on 0.3.35; Mike's go, lightly held). Each through the real
 * SessionStart render (`ClaudeCodeAdapter#sessionStart`) on a fixture:
 *
 *   1. "Still open"'s tail is one calm count with no ids and no age count:
 *      `(N more open, kept quietly; recall finds one by what it's about)` —
 *      that the door it names works is `wake-more.test.ts`'s;
 *   2. a session open in another folder with no turn for `ELSEWHERE_QUIET_MS`
 *      reads "open since …, quiet since HH:MM", not "(live)";
 *   3. "Last night:" says what the night did, that it was quiet, that none
 *      ran yet, that the run is under way — or nothing, for a store that has
 *      never had a night — and is the last of the day furniture to give way;
 *   4. a handoff's staleness reads in two clauses (`continuity-round2`'s).
 *
 * Hermetic: every store is a temp dir made and removed here; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { NIGHT_LINE_HEAD, nightLine } from "../src/core/dream/index.js";
import type { NightFacts, NightRun } from "../src/core/dream/index.js";
import { ELSEWHERE_QUIET_MS, YESTERDAY_SUMMARY_WORDS, todayElsewhereLines } from "../src/core/handoff/last-here.js";
import { FRAMING, OPEN_TAIL_WORDS, SELF_TUNABLES, countedLanes, withNightLine } from "../src/core/self/index.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const BUDGET = 9_000;
const D1 = "2026-10-24";
const D2 = "2026-10-25";
const at = (ymd: string, h: number, m = 0): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR + m * MIN;

/** This session, in HERE; another, in THERE. */
const S = "5e550000-0000-4000-8000-000000000001";
const A = "a1b2c3d4-0000-4000-8000-00000000000a";

let root: string;
let storeDir: string;
let config: string;
let HERE: string;
let THERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-polish-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  for (const d of [HERE, THERE]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

interface World {
  c: Counterpart;
  set(t: number): void;
  now(): number;
}

/** A store on the test's clock, with a bundle published the evening before. */
function world(start: number, budget = BUDGET): World {
  let now = at(D1, 18);
  const c = Counterpart.open({ dir: storeDir, budgetBytes: budget, now: () => now, timeZone: ZONE });
  open.push(c);
  c.rebrief({ budgetBytes: budget, at: D1 });
  now = start;
  return { c, set: (t) => void (now = t), now: () => now };
}

/** The wake SessionStart delivers to a session in HERE, now. */
function wake(w: World, budget = BUDGET): string {
  const verdict = { mode: "on", matched: HERE, entry: null } as ScopeVerdict;
  const a = new ClaudeCodeAdapter({
    counterpart: w.c,
    config: { dataDir: storeDir, injectionBudgetBytes: budget },
    configPath: config,
    now: () => w.now(),
    scope: verdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
  const text = a.sessionStart({ sessionId: S, scope: HERE, at: D2, source: "startup" } as HookInput).injection;
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(budget + 200);
  return text;
}

const lineOf = (text: string, head: string): string | undefined => text.split("\n").find((l) => l.startsWith(head));

/** The lines under a lane heading, up to the blank line that ends it. */
function lane(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("1. Still open's tail: one calm count, no ids", () => {
  test("a large open tail reads as one line with no id and no age count; the dashboard's reader still counts it", () => {
    const w = world(at(D2, 9));
    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      ids.push(w.c.store.put({ type: "memory", kind: "fact", body: `Whether bed ${String(i)} wants lime before the frost.`, meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } }));
    }
    const text = wake(w);
    const still = lane(text, FRAMING.threads);
    const listed = still.filter((l) => l.startsWith("- ")).length;
    expect(listed).toBeGreaterThan(0);
    const tail = still[still.length - 1] ?? "";
    expect(tail).toBe(`(${String(40 - listed)} more open, ${OPEN_TAIL_WORDS})`);
    expect(tail).not.toContain("mem_");
    expect(tail).not.toContain("untouched");
    expect(countedLanes(still.join("\n")).threads).toBe(40 - listed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2. an open session with no turn for two hours is quiet, not live", () => {
  test("live at 09:00; open since 08:00, quiet since 08:30 at 10:31; a closed span once the registry lets it go", () => {
    expect(ELSEWHERE_QUIET_MS).toBe(2 * HOUR);
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8) });
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "boundary", at: at(D2, 8, 30) });
    w.set(at(D2, 9));
    expect(lineOf(wake(w), "Today, elsewhere: ")).toMatch(/bakery open since 08:00 \(live\)\.$/);
    // One minute short of two hours since its last turn: still live.
    w.set(at(D2, 10, 29));
    expect(lineOf(wake(w), "Today, elsewhere: ")).toContain("open since 08:00 (live)");
    // Two hours: quiet, and since when.
    w.set(at(D2, 10, 31));
    const quiet = lineOf(wake(w), "Today, elsewhere: ") ?? "";
    expect(quiet).toContain("open since 08:00, quiet since 08:30");
    expect(quiet).not.toContain("(live)");
    // Past the registry's four hours it is no longer open at all: a span.
    w.set(at(D2, 12, 31));
    expect(lineOf(wake(w), "Today, elsewhere: ")).toContain(" 08:00–08:30");
    // A turn there again: live again.
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "boundary", at: at(D2, 12, 40) });
    w.set(at(D2, 12, 45));
    expect(lineOf(wake(w), "Today, elsewhere: ")).toContain("open since 08:00 (live)");
  });

  test("a session quiet since before midnight says the day of its last turn (review of #623)", () => {
    const here = [{ session: A, model: null, startedAt: at(D1, 20), lastAt: at(D1, 22, 30), titles: [] }];
    const line = todayElsewhereLines([], ZONE, here, at(D2, 1))?.line ?? "";
    expect(line).toContain(", quiet since 10-24 22:30");
    // The same day: the clock alone.
    expect(todayElsewhereLines([], ZONE, [{ session: A, model: null, startedAt: at(D2, 6), lastAt: at(D2, 7), titles: [] }], at(D2, 9, 1))?.line ?? "").toContain("since 06:00, quiet since 07:00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("3. Last night", () => {
  /** A dream on `date`, journaled, with these changes. */
  function dream(w: World, id: string, date: string, changes: Record<string, number>, state: "journaled" | "begun" = "journaled"): void {
    w.c.store.openDream({ id, day: w.c.store.livedDay(), date });
    for (const [action, n] of Object.entries(changes)) for (let i = 0; i < n; i += 1) w.c.store.recordDreamChange(id, { action });
    if (state === "journaled") w.c.store.updateDream(id, { state: "journaled", title: "PRIVATE dream title", journal: "PRIVATE dream journal words." });
  }
  /** A reflection on `date`, reflected: rewrote the page, wrote an entry, or neither. */
  function reflection(w: World, id: string, date: string, did: "page" | "entry" | "nothing", dreamId: string | null = null): void {
    w.c.store.openReflection({ id, dreamId, day: w.c.store.livedDay(), date, questions: [], shown: [] });
    w.c.store.updateReflection(id, { state: "reflected", entry: did === "nothing" ? null : "PRIVATE reflection words.", ...(did === "page" ? { pageVersion: 3 } : {}), ...(did === "entry" ? { entryId: "mem_000000000abc" } : {}) });
  }

  test("a store that has never had a night says nothing of one", () => {
    const w = world(at(D2, 9));
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBeUndefined();
  });

  test("a night that did something: the dream's changes by id and in a few words, then the reflection's — never the journal", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a001", D2, { link: 3, fold: 1, replayed: 7 });
    reflection(w, "rfl_00000000b001", D2, "page", "drm_00000000a001");
    const text = wake(w);
    expect(lineOf(text, NIGHT_LINE_HEAD)).toBe("Last night: dream drm_00000000a001 made 3 links and 1 fold; reflection rfl_00000000b001 rewrote the page.");
    expect(text).not.toContain("PRIVATE");
  });

  test("a quiet night says so: a dream that only replayed and a reflection with nothing much", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a002", D2, { replayed: 4 });
    reflection(w, "rfl_00000000b002", D2, "nothing", "drm_00000000a002");
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe(
      "Last night: a quiet night — dream drm_00000000a002 changed nothing; reflection rfl_00000000b002 had nothing much to add.",
    );
  });

  test("a quiet night the dream was skipped for: too little new", () => {
    const w = world(at(D2, 9));
    const run: NightRun = {
      run: "nrn_00000000c001",
      date: D2,
      state: "done",
      kind: "night",
      session: S,
      startedAt: at(D2, 6),
      endedAt: at(D2, 6, 5),
      reason: null,
      detail: null,
      code: 0,
      dream: null,
      reflection: null,
      children: [{ child: "dream", code: null, ms: 0, skipped: "too-little-new" }],
    };
    w.c.dreams.recordNightRun(run);
    // The words come from the dream module's own (`dreamSkippedWords`).
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe("Last night: a quiet night — too little new to dream on.");
  });

  test("none yet today, the last one yesterday; an older one says no night ran, and says when dreaming is off", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a003", D1, { link: 2 });
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe("Last night: none yet today (last: Oct 24).");
    const v = world(at(D2, 9));
    v.c.store.openDream({ id: "drm_00000000a004", day: 1, date: "2026-10-20" });
    v.c.store.updateDream("drm_00000000a004", { state: "journaled" });
    expect(v.c.dreams.setSetting("off", { by: "owner" }).ok).toBe(true);
    expect(lineOf(wake(v), NIGHT_LINE_HEAD)).toBe("Last night: no night ran (last: Oct 20); dreaming is off.");
  });

  test("a run under way says so, whatever it has begun", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a005", D2, {}, "begun");
    w.c.dreams.recordNightRun({
      run: "nrn_00000000c002",
      date: D2,
      state: "started",
      kind: "night",
      session: S,
      startedAt: at(D2, 8, 55),
      endedAt: null,
      reason: null,
      detail: null,
      code: null,
      dream: null,
      reflection: null,
      timeoutMs: HOUR,
    });
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe("Last night: the nightly run is under way.");
  });

  test("the switch off: no line, the wake as before", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a006", D2, { link: 1 });
    const was = SELF_TUNABLES.NIGHT_LINE;
    (SELF_TUNABLES as { NIGHT_LINE: boolean }).NIGHT_LINE = false;
    try {
      expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBeUndefined();
    } finally {
      (SELF_TUNABLES as { NIGHT_LINE: boolean }).NIGHT_LINE = was;
    }
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe("Last night: dream drm_00000000a006 made 1 link.");
  });

  test("in the day furniture: after the Yesterday line, before Today so far, in every form, and the last to give way", () => {
    const N = "Last night: dream drm_00000000a007 made 1 link.";
    const Y = 'Yesterday: "Bed one turned" (epi_000000000001); "Bed two turned" (epi_000000000002).';
    const Ys = "Yesterday: 2 sessions.";
    const T = "Today so far here: 08:10 \"Seeds sorted\" (epi_000000000003) — the summary of it.";
    const Tt = 'Today so far here: 08:10 "Seeds sorted" (epi_000000000003).';
    const day = { yesterday: `${Y}\n${T}`, yesterdayShorter: [`${Y}\n${Tt}`, Y, Ys], todaySoFarSummaries: [`${Y}\n${T}`] };
    const out = withNightLine(day, N);
    const forms = [out.yesterday ?? "", ...(out.yesterdayShorter ?? [])];
    expect(forms).toEqual([`${Y}\n${N}\n${T}`, `${Y}\n${N}\n${Tt}`, `${Y}\n${N}`, `${Ys}\n${N}`, N]);
    for (let i = 1; i < forms.length; i += 1) expect(Buffer.byteLength(forms[i] ?? "")).toBeLessThan(Buffer.byteLength(forms[i - 1] ?? ""));
    expect(out.todaySoFarSummaries).toEqual([`${Y}\n${N}\n${T}`]);
    // The summary-led Yesterday (W1, `yesterdaySummaryForms`) is one line that opens "Yesterday, …": the same place.
    const lead = `Yesterday, ${YESTERDAY_SUMMARY_WORDS} The beds were turned. Chapters: "Bed one turned" (epi_000000000001).`;
    expect(withNightLine({ yesterday: `${lead}\n${Tt}`, yesterdayShorter: [lead] }, N).yesterday).toBe(`${lead}\n${N}\n${Tt}`);
    // No Yesterday line: the night line first, over "Today so far".
    expect(withNightLine({ yesterday: T }, N).yesterday).toBe(`${N}\n${T}`);
    // No furniture at all: the line alone. No line: untouched.
    expect(withNightLine({}, N)).toEqual({ yesterday: N });
    expect(withNightLine(day, null)).toEqual(day);
  });

  test("a tight day: the line stays, and what gives way for it is Still open's later items and Nearby — never a thing due today, Still open's first item or the page", () => {
    // Measured: at 2,550 the line costs Still open's first item its whole words (it prints as its line);
    // at 2,300 two Nearby items, counted. Nothing due today, no first item, no page.
    const TIGHT = 2_300;
    const long = (head: string): string => `${head} ${"The detail goes on, as a real memory's first paragraph does, with the steps and the reasons. ".repeat(3)}`;
    const build = (night: boolean): string => {
      rmSync(storeDir, { recursive: true, force: true });
      const w = world(at(D2, 9), TIGHT);
      const page = ["## Core", "", long("I keep the garden's ledger."), "", "## Lately", "", long("The beans are in.")].join("\n");
      expect(w.c.revisePage(page, { by: "owner", reason: "a page" }).written).toBe(true);
      const SAL = { relevance: 0.9, emotional: 0.8, predictive: 0.8 } as const;
      for (let i = 0; i < 50; i += 1) w.c.store.put({ type: "memory", kind: "fact", title: `Does bed ${String(i)} want lime?`, body: long(`Open ${String(i)}: whether bed ${String(i)} wants lime.`), meta: { unresolved: true }, salience: SAL });
      for (let i = 0; i < 8; i += 1) w.c.store.put({ type: "memory", kind: "fact", title: `Compost heap ${String(i)} runs warm`, body: long(`Warm ${String(i)}.`), salience: SAL });
      w.c.store.put({ type: "memory", kind: "person", title: "DUETODAY the seed order closes at noon", body: "DUETODAY the seed order closes at noon; the list is in the green folder.", learnedOn: "2026-10-20", eventDate: D2, salience: SAL });
      if (night) {
        dream(w, "drm_00000000a008", D2, { link: 4, merge: 1 });
        reflection(w, "rfl_00000000b008", D2, "entry", "drm_00000000a008");
      }
      w.c.rebrief({ budgetBytes: TIGHT, at: D1 });
      return wake(w, TIGHT);
    };
    const without = build(false);
    const withNight = build(true);
    expect(lineOf(without, NIGHT_LINE_HEAD)).toBeUndefined();
    expect(lineOf(withNight, NIGHT_LINE_HEAD)).toBe("Last night: dream drm_00000000a008 made 4 links and 1 merge; reflection rfl_00000000b008 wrote an entry.");
    for (const text of [without, withNight]) {
      // The dated item due today, Still open's first item, the page whole.
      expect(text).toContain("DUETODAY the seed order closes at noon");
      expect(lane(text, FRAMING.threads)[0]).toStartWith("- ");
      expect(text).toContain("I keep the garden's ledger.");
      expect(text).toContain("The beans are in.");
    }
    // What gave way: items further down Still open, or Nearby — counted, not lost.
    const listed = (text: string, heading: string): number => lane(text, heading).filter((l) => l.startsWith("- ")).length;
    const room = (text: string): number => listed(text, FRAMING.threads) + listed(text, FRAMING.hints);
    expect(room(withNight)).toBeLessThan(room(without));
    expect(countedLanes(lane(withNight, FRAMING.threads).join("\n")).threads ?? 0).toBe(50 - listed(withNight, FRAMING.threads));
  });

  test("tighter still, with no Yesterday line: the night line itself gives way before a thing due today or Still open's first item (review of #623)", () => {
    // Measured at review: at these budgets the night line was the furniture's
    // only form, and the wake folded the item due today and every open one into
    // "More than this wake lists" to keep it.
    const long = (head: string): string => `${head} ${"The detail goes on, as a real memory's first paragraph does, with the steps and the reasons. ".repeat(3)}`;
    const build = (budget: number, opens: number): string => {
      rmSync(storeDir, { recursive: true, force: true });
      const w = world(at(D2, 9), budget);
      const page = ["## Core", "", long("I keep the garden's ledger."), "", "## Lately", "", long("The beans are in.")].join("\n");
      expect(w.c.revisePage(page, { by: "owner", reason: "a page" }).written).toBe(true);
      const SAL = { relevance: 0.9, emotional: 0.8, predictive: 0.8 } as const;
      for (let i = 0; i < opens; i += 1) w.c.store.put({ type: "memory", kind: "fact", title: `Does bed ${String(i)} want lime?`, body: long(`Open ${String(i)}: whether bed ${String(i)} wants lime.`), meta: { unresolved: true }, salience: SAL });
      w.c.store.put({ type: "memory", kind: "person", title: "DUETODAY the seed order closes at noon", body: "DUETODAY the seed order closes at noon; the list is in the green folder.", learnedOn: "2026-10-20", eventDate: D2, salience: SAL });
      dream(w, "drm_00000000a009", D2, { link: 4, merge: 1, fold: 2, gist: 1, "feeling-now": 3 });
      reflection(w, "rfl_00000000b009", D2, "entry", "drm_00000000a009");
      w.c.rebrief({ budgetBytes: budget, at: D1 });
      return wake(w, budget);
    };
    for (const [budget, opens] of [[1_600, 1], [1_600, 50], [1_700, 50]] as const) {
      const text = build(budget, opens);
      expect(lineOf(text, "Yesterday")).toBeUndefined();
      expect(text).toContain("DUETODAY the seed order closes at noon");
      expect(lane(text, FRAMING.threads)[0]).toStartWith("- ");
      expect(text).toContain("I keep the garden's ledger.");
      expect(text).toContain("The beans are in.");
    }
    // With the room, the line is there.
    expect(lineOf(build(2_300, 50), NIGHT_LINE_HEAD)).toStartWith("Last night: dream drm_00000000a009 made ");
  });

  test("the words, pure: counts ranked and capped, an undone dream, a reflection alone", () => {
    const base: NightFacts = { today: D2, now: at(D2, 9), dream: null, reflection: null, run: null, setting: "auto" };
    const d = (counts: Record<string, number>, state = "journaled"): NightFacts["dream"] => ({ id: "drm_x", date: D2, state, counts });
    expect(nightLine({ ...base, dream: d({ link: 11, "feeling-now": 1, fold: 1, merge: 2, replayed: 18 }) })).toBe("Last night: dream drm_x made 11 links, 2 merges, 1 feeling and 1 more kind.");
    expect(nightLine({ ...base, dream: d({ link: 1 }, "undone") })).toBe("Last night: dream drm_x was undone.");
    expect(nightLine({ ...base, reflection: { id: "rfl_y", date: D2, state: "reflected", entry_id: "mem_1", page_version: null } })).toBe("Last night: reflection rfl_y wrote an entry.");
    expect(nightLine(base)).toBeNull();
    // Review of #623: a run started today and lost past its watchdog did not finish — not "none yet";
    // and with dreaming off, none is to come, so not "yet" either.
    const lost: NightRun = { run: "nrn_lost", date: D2, state: "started", kind: "night", session: S, startedAt: at(D2, 1), endedAt: null, reason: null, detail: null, code: null, dream: null, reflection: null, timeoutMs: HOUR };
    const prior: NightFacts["dream"] = { id: "drm_x", date: D1, state: "journaled", counts: { link: 1 } };
    expect(nightLine({ ...base, dream: prior, run: lost })).toBe("Last night: the nightly run did not finish (no word from it).");
    expect(nightLine({ ...base, dream: prior, run: { ...lost, startedAt: at(D2, 8, 50) } })).toBe("Last night: the nightly run is under way.");
    expect(nightLine({ ...base, dream: prior })).toBe("Last night: none yet today (last: Oct 24).");
    expect(nightLine({ ...base, dream: prior, setting: "off" })).toBe("Last night: no night ran (last: Oct 24); dreaming is off.");
  });
});
