/**
 * TWO BRIEFS OF 2026-10-25 (roadmap 10-25, lightly held), through the real
 * doors — the MCP `recall` tool and the SessionStart render
 * (`ClaudeCodeAdapter#sessionStart`):
 *
 *   O1. `recall({ handle: "still open" })` lists everything the wake's
 *       "Still open" carries — the same candidates (the carry rule of #592,
 *       the core memories being reconsidered) in the same order — with ids,
 *       titles and lived days since touched, paged; the facts questions that
 *       ask for exactly that list are answered by it; it writes nothing, so
 *       listing cannot keep a thread carried. The wake's tail names it:
 *       `(N more open, kept quietly; recall "still open" lists them)`.
 *   L1. Before the day's run, the night line names the latest FINISHED night
 *       by the day it read — `The night of Oct 23: …` — instead of "none yet
 *       today"; older than `NIGHT_LINE_STALE_DAYS`, `… was the last to run`.
 *       Under way, did not finish, dreaming off and never dreamed stand as
 *       #623 left them. A tight wake still never loses the item due today or
 *       Still open's first item to it (the review of #623's rescue).
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
import { McpServer } from "../src/adapters/mcp/index.js";
import { STILL_OPEN_PAGE, asksStillOpen } from "../src/adapters/mcp/server.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { ownerRemoval } from "../src/adapters/cli/removal.js";
import { Counterpart } from "../src/core/counterpart.js";
import { NIGHT_LINE_HEAD, NIGHT_LINE_STALE_DAYS, NIGHT_OF_HEAD, nightLine, nightOf } from "../src/core/dream/index.js";
import type { NightFacts, NightRun } from "../src/core/dream/index.js";
import { FRAMING, OPEN_TAIL_WORDS, OPEN_TAIL_WORDS_BEFORE, SELF_TUNABLES, STILL_OPEN_HANDLE, countedLanes, isNightLine, openCarry } from "../src/core/self/index.js";
import { withoutNightLine } from "../src/core/self/briefing-room.js";
import { addDays } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ZONE = "UTC";
const BUDGET = 9_000;
const D1 = "2026-10-24";
const D2 = "2026-10-25";
const at = (ymd: string, h: number, m = 0): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR + m * MIN;

/** This session. */
const S = "5e550000-0000-4000-8000-000000000001";

let root: string;
/** The newest world's store: each `world()` opens a fresh one. */
let storeDir: string;
let config: string;
let HERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-open-night-")));
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  mkdirSync(HERE, { recursive: true });
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
  /** The calendar date the clock reads. */
  today(): string;
}

/** A store on the test's clock, with a bundle published the evening before `start`. */
let worlds = 0;
function world(start: number, budget = BUDGET): World {
  storeDir = join(root, `store-${String((worlds += 1))}`);
  let now = start - 15 * HOUR;
  const c = Counterpart.open({ dir: storeDir, budgetBytes: budget, now: () => now, timeZone: ZONE });
  open.push(c);
  c.rebrief({ budgetBytes: budget, at: new Date(now).toISOString().slice(0, 10) });
  now = start;
  return { c, set: (t) => void (now = t), now: () => now, today: () => new Date(now).toISOString().slice(0, 10) };
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
  const text = a.sessionStart({ sessionId: S, scope: HERE, at: w.today(), source: "startup" } as HookInput).injection;
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(budget + 200);
  return text;
}

/** The recall tool over the same store and clock, bound to this session in HERE. */
function tools(w: World, opts: { observer?: boolean } = {}): McpServer {
  return new McpServer({ counterpart: w.c, session: S, scope: HERE, now: () => w.now(), ...(opts.observer === true ? { launchObserver: true } : {}) });
}

/** On a calendar day at a time, to lived day `n`. */
function toDay(w: World, n: number): void {
  while (w.c.store.livedDay() < n) {
    w.set(w.now() + DAY);
    w.c.store.advanceClock(w.today());
  }
  expect(w.c.store.livedDay()).toBe(n);
}

/** What each memory this test wrote says, by id. */
const words = new Map<string, string>();

async function remember(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const r = await s.call("remember", args);
  expect(r.isError ?? false).toBe(false);
  const id = r.structuredContent["id"];
  expect(typeof id).toBe("string");
  if (typeof args["text"] === "string") words.set(id as string, args["text"]);
  return id as string;
}

async function stillOpen(s: McpServer, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const r = await s.call("recall", { handle: "still open", ...args });
  return r.structuredContent;
}

type Item = { id: string; title: string; touched: string; reconsidering?: string; date?: string };
const itemsOf = (r: Record<string, unknown>): Item[] => r["items"] as Item[];

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

const listed = (text: string): string[] => lane(text, FRAMING.threads).filter((l) => l.startsWith("- "));

// ═══════════════════════════════════════════════════════════════════════════
describe("O1. recall \"still open\" lists what Still open carries", () => {
  test("the wake lists the first of them in the same order, its tail counts the rest and names the handle; the handle lists all", async () => {
    const w = world(at(D2, 9));
    const s = tools(w);
    toDay(w, 2);
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(await remember(s, { text: `Open: does bed ${String(i)} want lime before the frost, or after the beans come out?`, unresolved: true }));
      if (i % 4 === 3) toDay(w, w.c.store.livedDay() + 1);
    }
    toDay(w, w.c.store.livedDay() + 1);
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
    const text = wake(w);
    const shown = listed(text);
    expect(shown.length).toBeGreaterThan(0);
    const tail = lane(text, FRAMING.threads).at(-1) ?? "";
    const counted = countedLanes(tail).threads ?? 0;
    expect(tail).toBe(`(${String(counted)} more open, kept quietly; recall "still open" lists them)`);
    expect(OPEN_TAIL_WORDS).toBe(`kept quietly; recall "${STILL_OPEN_HANDLE}" lists them`);

    const got = await stillOpen(s);
    expect(got).toMatchObject({ path: "handle", reason: "still-open", handle: "still open", total: 12, page: 1, pages: 1 });
    const items = itemsOf(got);
    expect(items.map((i) => i.id).sort()).toEqual([...ids].sort());
    // The same count: what the wake lists and what its tail counts.
    expect(shown.length + counted).toBe(items.length);
    // The same order: the wake's listed lines are the handle's first items.
    shown.forEach((line, k) => expect(line).toContain(`bed ${(words.get(items[k]?.id ?? "") ?? "?").split("bed ")[1]?.split(" ")[0] ?? "?"} `));
    // Newest touched first, with the age in lived days.
    expect(items[0]?.touched).toBe("2 lived days ago");
    expect(items.at(-1)?.touched).toBe("4 lived days ago");
    expect(items[0]?.title).toStartWith("Open: does bed ");
    expect(String(got["note"])).toContain("in the wake's order");
    // Case and spaces do not matter.
    expect((await stillOpen(s, { handle: "  Still Open " }))["reason"]).toBe("still-open");
  });

  test("a core memory being reconsidered is listed too, as it is under Still open; a dated thread is listed with its date", async () => {
    const w = world(at(D2, 9));
    const s = tools(w);
    toDay(w, 2);
    const plain = await remember(s, { text: "Open: should the compost move to the north corner?", unresolved: true });
    const dated = await remember(s, { text: "Open: ask the seed shop about the order on the first of December.", unresolved: true, eventDate: "2026-12-01" });
    const core = await remember(s, { text: "I keep the garden ledger by hand, one page a week." });
    const day = w.c.store.livedDay();
    w.c.store.updatePhysics(core, { promotedIdentity: true });
    w.c.store.setBand(core, "identity", day);
    w.c.store.appendCoreEvent({ memoryId: core, action: "promoted", day, lane: "fast", actor: "sleep" });
    w.c.store.appendCoreEvent({ memoryId: core, action: "reconsidering", day, reason: "not-about-me-or-us", actor: "sleep" });
    const items = itemsOf(await stillOpen(s));
    expect(items.map((i) => i.id).sort()).toEqual([plain, dated, core].sort());
    expect(items.find((i) => i.id === core)?.reconsidering).toContain("keep or retire");
    expect(items.find((i) => i.id === dated)?.date).toBe("2026-12-01");
    expect(items.find((i) => i.id === plain)).not.toHaveProperty("date");
  });

  test("a thread the carry let go is counted, not listed; listing it is not a touch; a touch lists it again", async () => {
    const w = world(at(D2, 9));
    const s = tools(w);
    toDay(w, 1);
    const old = await remember(s, { text: "Open: did the hose bib on the shed get its winter cap?", unresolved: true });
    toDay(w, 1 + SELF_TUNABLES.OPEN_CARRY_DAYS);
    const fresh = await remember(s, { text: "Open: which week do the garlic cloves go in?", unresolved: true });
    const store = w.c.store;
    const before = {
      touches: store.openThreadTouches(),
      carry: [...openCarry(store, store.livedDay(), SELF_TUNABLES.OPEN_CARRY_DAYS).notCarried.entries()],
      rows: store.countMemories({}),
      events: store.eventLog({ limit: 100_000 }).length,
    };
    for (let k = 0; k < 3; k += 1) {
      const got = await stillOpen(s);
      expect(itemsOf(got).map((i) => i.id)).toEqual([fresh]);
      expect(got["notCarried"]).toBe(1);
      expect(String(got["note"])).toContain(`Not listed: 1 open thread untouched for ${String(SELF_TUNABLES.OPEN_CARRY_DAYS)}+ lived days`);
    }
    // Asked three times: nothing written, nothing touched, the carry the same.
    expect({
      touches: store.openThreadTouches(),
      carry: [...openCarry(store, store.livedDay(), SELF_TUNABLES.OPEN_CARRY_DAYS).notCarried.entries()],
      rows: store.countMemories({}),
      events: store.eventLog({ limit: 100_000 }).length,
    }).toEqual(before);
    // Found by what it is about, then drawn on — a touch — it is carried again, and listed.
    const found = await s.call("recall", { question: "the hose bib on the shed and its winter cap", mode: "facts" });
    expect(found.structuredContent["ids"]).toContain(old);
    const drew = await s.call("session_end", { session: S, memories: [], drewOn: [old] });
    expect(drew.structuredContent["drewOn"]).toEqual({ credited: [old] });
    const again = await stillOpen(s);
    expect(itemsOf(again).map((i) => i.id).sort()).toEqual([old, fresh].sort());
    expect(again).not.toHaveProperty("notCarried");
  });

  test("paged: STILL_OPEN_PAGE to a page, the last page clamps, a bad page is refused", async () => {
    const w = world(at(D2, 9));
    const s = tools(w);
    toDay(w, 2);
    const n = STILL_OPEN_PAGE * 2 + 5;
    for (let i = 0; i < n; i += 1) await remember(s, { text: `Open: row ${String(i)} of the seed tray needs a label?`, unresolved: true });
    const one = await stillOpen(s);
    expect(one).toMatchObject({ total: n, page: 1, pages: 3 });
    expect(itemsOf(one).length).toBe(STILL_OPEN_PAGE);
    expect(String(one["note"])).toContain("More on page 2 (page: 2).");
    const three = await stillOpen(s, { page: 3 });
    expect(itemsOf(three).length).toBe(5);
    expect(String(three["note"])).not.toContain("More on page");
    expect((await stillOpen(s, { page: 9 }))["page"]).toBe(3);
    const all = [...itemsOf(one), ...itemsOf(await stillOpen(s, { page: 2 })), ...itemsOf(three)].map((i) => i.id);
    expect(new Set(all).size).toBe(n);
    const bad = await s.call("recall", { handle: "still open", page: 0 });
    expect(bad.isError).toBe(true);
  });

  test("a facts question asking for exactly the list is answered by it; a question about a thing, or in meaning mode, is not", async () => {
    const w = world(at(D2, 9));
    const s = tools(w);
    toDay(w, 2);
    const id = await remember(s, { text: "Open: is the glaze order still open with the second supplier?", unresolved: true });
    for (const q of ["What's still open?", "what is still open", "Open threads", "  What are my open threads? "]) {
      expect(asksStillOpen(q)).toBe(true);
      const got = (await s.call("recall", { question: q, mode: "facts" })).structuredContent;
      expect(got["reason"]).toBe("still-open");
      expect(got["routed"]).toBeDefined();
      expect(itemsOf(got).map((i) => i.id)).toEqual([id]);
    }
    expect(asksStillOpen("Is the glaze order still open?")).toBe(false);
    const thing = (await s.call("recall", { question: "Is the glaze order still open?", mode: "facts" })).structuredContent;
    expect(thing["reason"]).not.toBe("still-open");
    const meaning = (await s.call("recall", { question: "What's still open?", mode: "meaning" })).structuredContent;
    expect(meaning["reason"]).not.toBe("still-open");
  });

  test("under observer it stands down like the rest of recall, and writes nothing", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    await remember(tools(w), { text: "Open: is the rain barrel overflow pointed away from the beds?", unresolved: true });
    const events = w.c.store.eventLog({ limit: 100_000 }).length;
    const res = await tools(w, { observer: true }).call("recall", { handle: "still open" });
    expect(res.structuredContent["stoodDown"]).toBe(true);
    expect(JSON.stringify(res)).not.toContain("rain barrel");
    expect(w.c.store.eventLog({ limit: 100_000 }).length).toBe(events);
  });

  test("the dashboard's reader counts the new tail and #623's", () => {
    expect(countedLanes(`(7 more open, ${OPEN_TAIL_WORDS})`).threads).toBe(7);
    expect(countedLanes(`(7 more open, ${OPEN_TAIL_WORDS_BEFORE})`).threads).toBe(7);
    // Shorter than the words it replaces.
    expect(Buffer.byteLength(OPEN_TAIL_WORDS)).toBeLessThan(Buffer.byteLength(OPEN_TAIL_WORDS_BEFORE));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("L1. the night line names the latest finished night, dated", () => {
  /** A dream stamped `date`, journaled or left begun, with these changes. */
  function dream(w: World, id: string, date: string, changes: Record<string, number>, state: "journaled" | "begun" = "journaled"): void {
    w.c.store.openDream({ id, day: w.c.store.livedDay(), date });
    for (const [action, n] of Object.entries(changes)) for (let i = 0; i < n; i += 1) w.c.store.recordDreamChange(id, { action });
    if (state === "journaled") w.c.store.updateDream(id, { state: "journaled", title: "PRIVATE dream title", journal: "PRIVATE dream journal words." });
  }
  /** A reflection stamped `date`, reflected. */
  function reflection(w: World, id: string, date: string, did: "page" | "entry" | "nothing", dreamId: string | null = null): void {
    w.c.store.openReflection({ id, dreamId, day: w.c.store.livedDay(), date, questions: [], shown: [] });
    w.c.store.updateReflection(id, { state: "reflected", entry: did === "nothing" ? null : "PRIVATE reflection words.", ...(did === "page" ? { pageVersion: 3 } : {}), ...(did === "entry" ? { entryId: "mem_000000000abc" } : {}) });
  }
  const run = (date: string, state: NightRun["state"], extra: Partial<NightRun> = {}): NightRun => ({
    run: `nrn_${date.replace(/-/g, "")}`,
    date,
    state,
    kind: "night",
    session: S,
    startedAt: at(date, 6),
    endedAt: state === "started" ? null : at(date, 6, 5),
    reason: null,
    detail: null,
    code: state === "started" ? null : 0,
    dream: null,
    reflection: null,
    ...extra,
  });

  test("the first wake of a day, before its run: the night before, by the day it read — never 'none yet today'", () => {
    const w = world(at(D2, 7));
    dream(w, "drm_00000000a101", D1, { link: 4, merge: 1, replayed: 9 });
    reflection(w, "rfl_00000000b101", D1, "entry", "drm_00000000a101");
    w.c.dreams.recordNightRun(run(D1, "done"));
    const text = wake(w);
    expect(lineOf(text, NIGHT_OF_HEAD)).toBe("The night of Oct 23: dream drm_00000000a101 made 4 links and 1 merge; reflection rfl_00000000b101 wrote an entry.");
    expect(text).not.toContain("none yet today");
    expect(text).not.toContain("PRIVATE");
  });

  test("a wake after today's run: today's, as before", () => {
    const w = world(at(D2, 11));
    dream(w, "drm_00000000a102", D1, { link: 4 });
    dream(w, "drm_00000000a103", D2, { link: 2, fold: 1 });
    reflection(w, "rfl_00000000b103", D2, "page", "drm_00000000a103");
    w.c.dreams.recordNightRun(run(D2, "done"));
    const text = wake(w);
    expect(lineOf(text, NIGHT_LINE_HEAD)).toBe("Last night: dream drm_00000000a103 made 2 links and 1 fold; reflection rfl_00000000b103 rewrote the page.");
    expect(lineOf(text, NIGHT_OF_HEAD)).toBeUndefined();
  });

  test("dreaming off, and a run under way: as #623 left them", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a104", D1, { link: 4 });
    expect(w.c.dreams.setSetting("off", { by: "owner" }).ok).toBe(true);
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe("Last night: no night ran (last: Oct 24); dreaming is off.");
    expect(w.c.dreams.setSetting("auto", { by: "owner" }).ok).toBe(true);
    w.c.dreams.recordNightRun({ ...run(D2, "started"), startedAt: at(D2, 8, 55), timeoutMs: HOUR });
    expect(lineOf(wake(w), NIGHT_LINE_HEAD)).toBe("Last night: the nightly run is under way.");
  });

  test("older than NIGHT_LINE_STALE_DAYS: it says it was the last to run", () => {
    const w = world(at(D2, 9));
    // Stamped Oct 22: read Oct 21, four days back.
    dream(w, "drm_00000000a105", "2026-10-22", { link: 1 });
    expect(lineOf(wake(w), NIGHT_OF_HEAD)).toBe("The night of Oct 21 was the last to run: dream drm_00000000a105 made 1 link.");
    // Stamped Oct 23: read Oct 22, three days back — not yet.
    const v = world(at(D2, 9));
    dream(v, "drm_00000000a106", "2026-10-23", { link: 1 });
    expect(lineOf(wake(v), NIGHT_OF_HEAD)).toBe("The night of Oct 22: dream drm_00000000a106 made 1 link.");
    expect(NIGHT_LINE_STALE_DAYS).toBe(3);
  });

  test("an abandoned dream in front of it, a quiet run, a run that failed: the latest FINISHED night", () => {
    // A dream left begun yesterday sits in front of the night before's.
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a107", "2026-10-23", { link: 3 });
    reflection(w, "rfl_00000000b107", "2026-10-23", "nothing", "drm_00000000a107");
    dream(w, "drm_00000000a108", D1, { link: 1 }, "begun");
    w.c.dreams.recordNightRun(run(D1, "failed", { reason: "exit" }));
    expect(lineOf(wake(w), NIGHT_OF_HEAD)).toBe("The night of Oct 22: dream drm_00000000a107 made 3 links; reflection rfl_00000000b107 had nothing much to add.");
    // Yesterday's run finished with nothing new to dream on: a quiet night.
    const q = world(at(D2, 9));
    dream(q, "drm_00000000a109", "2026-10-22", { link: 1 });
    q.c.dreams.recordNightRun(run(D1, "done", { children: [{ child: "dream", code: null, ms: 0, skipped: "too-little-new" }] }));
    expect(lineOf(wake(q), NIGHT_OF_HEAD)).toBe("The night of Oct 23: a quiet night — too little new to dream on.");
    // Nothing finished among what is read: #623's words.
    const f = world(at(D2, 9));
    dream(f, "drm_00000000a110", D1, {}, "begun");
    expect(lineOf(wake(f), NIGHT_LINE_HEAD)).toBe("Last night: none yet today (last: Oct 24).");
  });

  test("review of #626: today's run done with no dream, no reflection and no skip is today's quiet night, not the night before", () => {
    const w = world(at(D2, 11));
    dream(w, "drm_00000000a111", D1, { link: 4 });
    reflection(w, "rfl_00000000b111", D1, "entry", "drm_00000000a111");
    w.c.dreams.recordNightRun(run(D2, "done"));
    const text = wake(w);
    expect(lineOf(text, NIGHT_LINE_HEAD)).toBe("Last night: a quiet night — the nightly run finished with no dream and no reflection.");
    expect(lineOf(text, NIGHT_OF_HEAD)).toBeUndefined();
  });

  test("review of #626: a retry that journaled is the night's dream, not the abandoned one beside it on the same date", () => {
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a112", D1, { link: 5 });
    dream(w, "drm_00000000a113", D1, { link: 1 }, "begun");
    expect(lineOf(wake(w), NIGHT_OF_HEAD)).toBe("The night of Oct 23: dream drm_00000000a112 made 5 links.");
  });

  test("review of #626: after a gap of several days, the last run is named by the day before its stamp and called the last", () => {
    // Run stamped Oct 20 after a week away (it read Oct 13–19); today Oct 25.
    const w = world(at(D2, 9));
    dream(w, "drm_00000000a114", "2026-10-20", { link: 6 });
    expect(lineOf(wake(w), NIGHT_OF_HEAD)).toBe("The night of Oct 19 was the last to run: dream drm_00000000a114 made 6 links.");
  });

  test("review of #626: a session start counts the changes of the dream it names, not of every dream it reads", () => {
    const w = world(at(D2, 9));
    for (let k = 0; k < 7; k += 1) dream(w, `drm_00000000a2${String(k).padStart(2, "0")}`, addDays(D1, -6 + k), { link: k + 1 });
    let counted = 0;
    const real = w.c.dreams.counts.bind(w.c.dreams);
    w.c.dreams.counts = (id: string): Record<string, number> => {
      counted += 1;
      return real(id);
    };
    expect(lineOf(wake(w), NIGHT_OF_HEAD)).toBe("The night of Oct 23: dream drm_00000000a206 made 7 links.");
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThanOrEqual(2);
  });

  test("pure: the date a night is named by, and both heads read as the night line", () => {
    expect(nightOf("2026-10-24")).toBe("2026-10-23");
    expect(nightOf("2026-03-01")).toBe("2026-02-28");
    const base: NightFacts = { today: D2, now: at(D2, 9), dream: null, reflection: null, run: null, setting: "auto" };
    const d = { id: "drm_x", date: D1, state: "journaled", counts: { link: 2 } };
    expect(nightLine({ ...base, dream: d })).toBe("The night of Oct 23: dream drm_x made 2 links.");
    // The rows read beyond the newest: an abandoned dream in front of a finished one.
    const begun = { id: "drm_y", date: D1, state: "begun", counts: {} };
    const older = { id: "drm_z", date: addDays(D1, -1), state: "journaled", counts: { fold: 1 } };
    expect(nightLine({ ...base, dream: begun, dreams: [begun, older] })).toBe("The night of Oct 22: dream drm_z made 1 fold.");
    for (const l of ["Last night: x.", "The night of Oct 23: x."]) expect(isNightLine(l)).toBe(true);
    expect(withoutNightLine("Yesterday: 2 sessions.\nThe night of Oct 23: dream drm_x made 2 links.")).toBe("Yesterday: 2 sessions.");
    expect(withoutNightLine("The night of Oct 23: dream drm_x made 2 links.")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the tight-budget sweep: the item due today and Still open's first item are never lost to the night line", () => {
  const long = (head: string): string => `${head} ${"The detail goes on, as a real memory's first paragraph does, with the steps and the reasons. ".repeat(3)}`;
  /** The fixture of the review of #623, with the night before (L1's longer line) or today's. */
  function build(budget: number, opens: number, night: "before" | "today"): string {
    // Each build a fresh store (`world`); the last one closed.
    for (const c of open.splice(0)) c.close();
    const w = world(at(D2, 9), budget);
    const page = ["## Core", "", long("I keep the garden's ledger."), "", "## Lately", "", long("The beans are in.")].join("\n");
    expect(w.c.revisePage(page, { by: "owner", reason: "a page" }).written).toBe(true);
    const SAL = { relevance: 0.9, emotional: 0.8, predictive: 0.8 } as const;
    for (let i = 0; i < opens; i += 1) w.c.store.put({ type: "memory", kind: "fact", title: `Does bed ${String(i)} want lime?`, body: long(`Open ${String(i)}: whether bed ${String(i)} wants lime.`), meta: { unresolved: true }, salience: SAL });
    w.c.store.put({ type: "memory", kind: "person", title: "DUETODAY the seed order closes at noon", body: "DUETODAY the seed order closes at noon; the list is in the green folder.", learnedOn: "2026-10-20", eventDate: D2, salience: SAL });
    const date = night === "before" ? D1 : D2;
    w.c.store.openDream({ id: "drm_00000000a201", day: w.c.store.livedDay(), date });
    for (const [action, n] of Object.entries({ link: 4, merge: 1, fold: 2, gist: 1, "feeling-now": 3 })) for (let i = 0; i < n; i += 1) w.c.store.recordDreamChange("drm_00000000a201", { action });
    w.c.store.updateDream("drm_00000000a201", { state: "journaled" });
    w.c.store.openReflection({ id: "rfl_00000000b201", dreamId: "drm_00000000a201", day: w.c.store.livedDay(), date, questions: [], shown: [] });
    w.c.store.updateReflection("rfl_00000000b201", { state: "reflected", entry: "words", entryId: "mem_000000000abc" });
    w.c.rebrief({ budgetBytes: budget, at: D1 });
    return wake(w, budget);
  }

  test("1,600 to 3,000 bytes, one open item and fifty, the night before and today's", () => {
    let withLine = 0;
    for (const night of ["before", "today"] as const) {
      for (const opens of [1, 50]) {
        for (let budget = 1_600; budget <= 3_000; budget += 100) {
          const text = build(budget, opens, night);
          const where = `${night}, ${String(opens)} open, ${String(budget)} B`;
          expect(text, where).toContain("DUETODAY the seed order closes at noon");
          expect(lane(text, FRAMING.threads)[0], where).toStartWith("- ");
          expect(text, where).toContain("I keep the garden's ledger.");
          expect(text, where).toContain("The beans are in.");
          const line = text.split("\n").find(isNightLine);
          if (line !== undefined) {
            withLine += 1;
            expect(line, where).toStartWith(night === "before" ? "The night of Oct 23: dream drm_00000000a201 made " : "Last night: dream drm_00000000a201 made ");
          }
        }
      }
    }
    // The line is not simply gone: with the room, it is there.
    expect(withLine).toBeGreaterThan(0);
    expect(build(3_000, 50, "before").split("\n").find(isNightLine)).toStartWith("The night of Oct 23: ");
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe("review of #626: the handle lists what the wake in this folder may show, and nothing else", () => {
  /** An open thread written in `folder`, marked `about`. */
  function openIn(w: World, folder: string, title: string, about: "work" | "owner" = "work"): string {
    return w.c.store.put({ type: "memory", kind: "fact", title, body: `${title} The detail of it.`, meta: { unresolved: true }, about, origin: { scope: folder }, salience: { relevance: 0.9, emotional: 0.6, predictive: 0.7 } });
  }

  test("another folder's work-marked thread: the wake here carries it, so the handle lists it — the same exposure, not more", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    const THERE = join(root, "workshop");
    mkdirSync(THERE, { recursive: true });
    const theirs = openIn(w, THERE, "THERE-WORK does the lathe belt need a spare?");
    const ours = openIn(w, HERE, "HERE-WORK does the trellis need another post?");
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
    const text = wake(w);
    // The wake's Still open is store-wide for open threads (`rankLanes`: an
    // open work memory is a thread wherever the session wakes).
    expect(text).toContain("THERE-WORK");
    expect(text).toContain("HERE-WORK");
    const items = itemsOf(await stillOpen(tools(w)));
    expect(items.map((i) => i.id).sort()).toEqual([theirs, ours].sort());
  });

  test("a folder set off or paused: the handle and the routed question are refused and say nothing", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    openIn(w, HERE, "SECRET-OFF is the gate latch fixed?");
    const file = join(root, "scopes.json");
    for (const mode of ["off", "paused"] as const) {
      writeScopes(file, setScope(null, HERE, mode, { at: D2 }));
      const s = new McpServer({ counterpart: w.c, session: S, scope: HERE, now: () => w.now(), scopesFile: file });
      for (const args of [{ handle: "still open" }, { question: "what's still open?", mode: "facts" }]) {
        const r = await s.call("recall", args);
        expect(r.isError, `${mode} ${JSON.stringify(args)}`).toBe(true);
        expect(JSON.stringify(r)).not.toContain("SECRET-OFF");
      }
    }
    // (Observer is fixed at launch from the same registry — `bin/serve.ts` —
    // and covered above through `launchObserver`.)
  });

  test("a removed open thread is in neither the wake nor the handle — taken dark only (a removal cut off before its chase) as well as completed", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    const kept = openIn(w, HERE, "KEPT is the rain gauge level?", "owner");
    const gone = openIn(w, HERE, "GONE-WHOLE did the neighbour return the ladder?", "owner");
    const dark = openIn(w, HERE, "GONE-DARK did the vet call back about the cat?", "owner");
    ownerRemoval(w.c.store, { targetId: gone, actor: "owner", reason: "review test", requestedAt: w.now() }, { now: () => w.now() });
    w.c.store.appendRemovalRecord({ memoryId: dark, stage: "requested", actor: "owner", reason: "review test" });
    w.c.store.appendRemovalRecord({ memoryId: dark, stage: "dark", actor: "owner", reason: "review test" });
    expect(w.c.store.deniedIds()).toEqual(expect.arrayContaining([gone, dark]));
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
    const text = wake(w);
    expect(text).toContain("KEPT is the rain gauge");
    expect(text).not.toContain("GONE-");
    const got = await stillOpen(tools(w));
    expect(itemsOf(got).map((i) => i.id)).toEqual([kept]);
    expect(JSON.stringify(got)).not.toContain("GONE-");
  });

  test("a session with no folder: the same list (the wake's Still open reads no folder either)", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    const a = openIn(w, HERE, "NOFOLDER-A is the shed roof sealed?");
    const s = new McpServer({ counterpart: w.c, session: S, now: () => w.now() });
    expect(itemsOf(await stillOpen(s)).map((i) => i.id)).toEqual([a]);
  });

  test("near-misses reach the ordinary facts answer, not the list", async () => {
    const w = world(at(D2, 9));
    const s = tools(w);
    toDay(w, 2);
    await remember(s, { text: "Open: is the hardware store still open on Sundays in winter?", unresolved: true });
    for (const q of [
      "is the hardware store still open?",
      "what's still open at the hardware store",
      "which open threads mention the hardware store",
      "still open on sundays",
      "what's open on Sunday",
      "open",
      "threads",
    ]) {
      expect(asksStillOpen(q), q).toBe(false);
      const got = (await s.call("recall", { question: q, mode: "facts" })).structuredContent;
      expect(got["reason"], q).not.toBe("still-open");
    }
  });
});
