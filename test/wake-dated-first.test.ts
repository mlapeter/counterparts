/**
 * DATED ITEMS COME BEFORE THE FURNITURE (2026-10-10, `self/briefing.ts#
 * ROOM_ORDER`).
 *
 * The owner's wake on lived day 19 was 8,922 bytes and read "Arriving: 1 — no
 * room to list them in this wake". The item left out was his tax reminder,
 * while the same wake still printed yesterday's chapter titles and four
 * handoffs: the handoff pointer and "Last here" are spliced at delivery into
 * room the composition never competed for, and the Yesterday line is
 * furniture the trim cannot pop. Now the delivery's rooms are LENT, and every
 * lane takes room only from the lanes below it in one declared list: "Work
 * here", the Yesterday line's titles (pointers instead of titles), "Last
 * here" and the handoffs (fewer in full, the rest by id) give way before a
 * dated item is left unlisted — and a plain reminder due the day the wake is
 * read outranks even the self page's borrowing.
 *
 * Proved here at the 9,000-byte ceiling with an over-room self page that
 * borrows, four handoffs, yesterday's titles and one to three dated items —
 * through Claude Code's SessionStart in Denver (UTC−6) and Kiritimati
 * (UTC+14) on a frozen clock, and at the composition with three — and for a
 * due-day plain reminder under the widest delivery reserves, the tightest
 * room the wake has at that ceiling. Doctor's Wake line turns amber when a
 * dated item still went unlisted.
 *
 * Hermetic: a fresh temp data dir per test, removed afterwards; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { wakeArrivalFindings } from "../src/adapters/claude-code/doctor.js";
import { SELF_BRIEFING_EVENT } from "../src/core/counterpart.js";
import { episodeGate } from "../src/core/bridge.js";
import { HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE } from "../src/core/handoff/index.js";
import { yesterdayLine, yesterdayShorter } from "../src/core/handoff/last-here.js";
import { CUE_MODE_META, plainDueOn } from "../src/core/prospective/index.js";
import {
  BRIEFING_KEY,
  COLLAPSED_WORDS,
  FRAMING,
  PAGE_END_LINES,
  PAGE_FLOOR_RESERVE_BYTES,
  PAGE_HOST_BUDGET_BYTES,
  PAGE_ROOM_BYTES,
  PREFACE_RESERVE_BYTES,
  ROOM_ORDER,
  SELF_TUNABLES,
  Self,
  TRIM_ORDER,
  WORK_HERE_HEADING,
  arrivingHead,
  collapsedLane,
  deliveryReserveBound,
  pageBlockBytes,
  pageTopLine,
  readSentinel,
  rotateWork,
  settledOver,
  workHere,
  workHereBytes,
} from "../src/core/self/index.js";
import type { HorizonItem } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";
import { readableDate, startOfLocalDay } from "../src/core/time.js";

const BUDGET = PAGE_HOST_BUDGET_BYTES;
const SCOPE = "/work/studio";
const ZONES = ["America/Denver", "Pacific/Kiritimati"] as const;
/** What each share-ruled reserve takes at its widest at 9,000: ⌊9,000/8⌋. */
const SHARE = Math.floor(BUDGET / HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE);
/** The block that reserves exactly that. */
const WIDEST_BLOCK = SHARE - HANDOFF_RESERVE_MARGIN_BYTES;
/** The composition at 9,000 under the widest reserves. */
const COMPOSE = BUDGET - deliveryReserveBound(BUDGET);
const SALIENT = { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 };

const dirs: string[] = [];
const closers: { close(): void }[] = [];

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "counterparts-dated-first-"));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  freshDir();
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
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function config(dataDir: string, zone: string, budget = BUDGET): AdapterConfig {
  return { dataDir, injectionBudgetBytes: budget, owner: true, timeZone: zone };
}

function clock(zone: string, ymd: string, hour: number): void {
  setSystemTime(new Date(startOfLocalDay(ymd, zone) + hour * 3_600_000));
}

type Adapter = ReturnType<typeof openAdapter>;

function adapter(dataDir: string, zone: string, budget = BUDGET): Adapter {
  const a = openAdapter(config(dataDir, zone, budget), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

/** The turn-end worker, on the frozen clock: the boundary, in its own process's shape. */
async function worker(dataDir: string, zone: string, budget = BUDGET): Promise<void> {
  const out = await runOnce({ config: config(dataDir, zone, budget), embedder: null });
  expect(out.ran).toBe(true);
}

/** SessionStart, as the hook builds its input: the wake block, and the whole result. */
function sessionStart(a: Adapter, zone: string, session: string): { text: string; result: ReturnType<Adapter["sessionStart"]> } {
  const input = toHookInput({ session_id: session, hook_event_name: "SessionStart", cwd: SCOPE }, { scope: SCOPE, timeZone: zone, env: {} });
  const result = a.sessionStart(input);
  const injection = result.injection ?? "";
  const open = injection.indexOf("<!-- counterparts:wake ");
  return { text: open < 0 ? injection : injection.slice(open), result };
}

/** The lines under a lane heading, up to the blank line that ends it. */
function lane(text: string, heading: string): string[] | null {
  const lines = text.split("\n");
  const at = lines.lastIndexOf(heading);
  if (at < 0) return null;
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return out;
}

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** The newest durable `self.briefing` row's payload. */
function lastBriefing(a: Adapter): Record<string, unknown> {
  const row = a.counterpart.store.eventLog({ name: SELF_BRIEFING_EVENT, order: "desc", limit: 1 })[0];
  return JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
}

/** A page of exactly `size` bytes in two headed sections; `short` is written with it. */
function pageOfSize(size: number): string {
  const para = "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess.";
  let page = "## Core\n\n";
  while (bytes(page) + bytes(para) + 2 <= size - 40) page += `${para}\n\n`;
  page += `## Lately\n\n${"x".repeat(size - bytes(page) - bytes("## Lately\n\n") - 1)}.`;
  expect(bytes(page)).toBe(size);
  return page;
}
const SHORT = "## Core\n\nI keep a careful account of the studio, and I say what I do not know before I guess.";

/** Four chapters written on `ymd`, so the next day's wake carries a Yesterday line with four titles. */
function chapters(a: Adapter, ymd: string): void {
  for (let i = 0; i < 4; i += 1) {
    a.counterpart.store.put({
      type: "episode",
      kind: "self",
      title: `Seating the relief valves on kiln number ${String(i)} before the firing`,
      body: `## chapter 1 — ${readableDate(ymd)} · lived day 2\n\nWe seated the valves and wrote down what held.`,
    });
  }
}

/** Open questions, each about 250 bytes on its line, as the owner's run. */
function openQuestions(a: Adapter, n = 25): void {
  for (let i = 0; i < n; i += 1) {
    let body = `Open question ${String(i)}: whether kiln shelf ${String(i)} needs a second coat of wash before the next firing`;
    while (body.length < 220) body += ", or whether the thin coat holds for one more round";
    a.counterpart.store.put({ type: "memory", kind: "fact", body: `${body}.`, salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 }, meta: { unresolved: true } });
  }
}

/** The widest rung of this directory's handoff ladder, as the boundary sizes it. */
function widestHandoff(a: Adapter): number {
  return Math.max(0, ...(a.counterpart.handoffs.liveBlockBytesByScope().get(SCOPE) ?? []));
}

/** This directory's "Work here" block, as the boundary sizes it. */
function workBlock(a: Adapter): number {
  const store = a.counterpart.store;
  const t = SELF_TUNABLES;
  const day = store.livedDay();
  const lines = workHere(store, SCOPE, { day, max: t.WORK_HERE_MAX, pool: t.WORK_HERE_POOL, excerpt: t.WORK_HERE_EXCERPT, skip: settledOver(store) });
  return workHereBytes(rotateWork(lines, t.WORK_HERE_MAX, day));
}

/**
 * FOUR HANDOFFS AND THIS DIRECTORY'S WORK. `widest`: tuned so the handoff
 * block and the work block are each exactly `WIDEST_BLOCK` bytes, so each
 * share-ruled reserve is exactly ⌊9,000/8⌋ — the tightest room the wake has
 * at this ceiling (`page-never-cut.test.ts`'s engineering, with four).
 */
function work(a: Adapter, widest = false): void {
  const c = a.counterpart;
  const sentence = (i: number, extra: number): string =>
    `Handoff ${String(i)}: the glaze tiles dry on rack two${"x".repeat(extra)}. Then the kiln log needs the cone readings.`;
  // Long session names, so the three shown in full reach the share without
  // any first sentence passing the excerpt's cap.
  const session = (i: number): string => `kiln-and-glaze-studio-session-${String(i)}`;
  for (let i = 0; i < 4; i += 1) c.writeHandoff(sentence(i, 0), { scope: SCOPE, session: session(i) });
  c.captureSpans({
    session: "h9",
    scope: SCOPE,
    turns: [
      { role: "user", text: "We fired the test kiln and logged the cones for the record today." },
      { role: "assistant", text: "Logged; the cone readings are in the kiln book." },
    ],
  });
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    ids.push(
      c.store.put({
        type: "memory",
        kind: "skill",
        title: `Kiln ramp ${String(i)}`,
        body: `Work fact ${String(i)}: the kiln controller wants the ramp entered in degrees per hour, not per minute, and the offset separately.`,
        salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
        origin: { scope: SCOPE },
      }),
    );
  }
  if (!widest) return;
  // Rewritten in the same order, so the newest stays the newest; the three
  // newest are the ones shown in full, and their first sentences grow — the
  // widest the block gets without passing the share, found by search (an
  // excerpt is cut at its own cap, so growth is not one byte per byte).
  const grown = (extras: readonly number[]): number => {
    extras.forEach((extra, i) => c.writeHandoff(sentence(i, extra), { scope: SCOPE, session: session(i) }));
    return widestHandoff(a);
  };
  let lo = 0;
  let hi = 240;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (grown([0, mid, mid, mid]) <= WIDEST_BLOCK) lo = mid;
    else hi = mid - 1;
  }
  let top = lo;
  while (top < lo + 240 && grown([0, lo, lo, top + 1]) <= WIDEST_BLOCK) top += 1;
  expect(grown([0, lo, lo, top])).toBeLessThanOrEqual(WIDEST_BLOCK);
  expect(widestHandoff(a)).toBeGreaterThan(WIDEST_BLOCK - 64);
  const grow = WIDEST_BLOCK - workBlock(a);
  expect(grow).toBeGreaterThan(0);
  const first = ids[0] ?? "";
  c.store.revise(first, { title: `Kiln ramp 0${"r".repeat(grow)}`, reason: "a longer title" });
  expect(workBlock(a)).toBe(WIDEST_BLOCK);
}

const REMINDERS = [
  "Remind him on the 12th unless he has confirmed the quarterly tax is paid; it is due on the 15th.",
  "Rosa's surgery is on the tenth; send a note the evening before.",
  "The kiln inspector comes on the eleventh; the gate code is in the blue folder.",
] as const;

/** When each is due: the morning the wake is read, and the two days after. */
const DUES = ["2026-10-09", "2026-10-10", "2026-10-11"] as const;

/** The same, each longer than the slack the furniture's reserve leaves beside a page at its room. */
const LONG = REMINDERS.map((r) => `${r} ${"It matters, and the details are written down in the studio notebook on the shelf by the door. ".repeat(4).trim()}`);

function reminder(a: Adapter, due: string, body: string, mode?: "plain"): string {
  return a.counterpart.store.put({
    type: "memory",
    kind: "person",
    body,
    learnedOn: "2026-10-01",
    eventDate: due,
    salience: SALIENT,
    ...(mode === undefined ? {} : { meta: { [CUE_MODE_META]: mode } }),
  });
}

interface Morning {
  readonly a: Adapter;
  readonly text: string;
  readonly result: ReturnType<Adapter["sessionStart"]>;
  readonly row: Record<string, unknown>;
}

/**
 * THE OWNER'S MORNING, REBUILT: yesterday's four chapters, 25 open
 * questions, a self page of `pageBytes`, four handoffs and this directory's
 * work, and `dated` reminders arriving (the first plain and due the morning
 * the wake is read when `plain`), at the 9,000-byte default. The boundary
 * runs the evening of 10-08; the session starts the morning of 10-09.
 */
async function morning(zone: string, opts: { pageBytes: number; dated: number; plain?: boolean; widest?: boolean; short?: boolean }): Promise<Morning> {
  const dataDir = freshDir();
  clock(zone, "2026-10-07", 20);
  const a = adapter(dataDir, zone);
  chapters(a, "2026-10-07");
  await worker(dataDir, zone);
  clock(zone, "2026-10-08", 21);
  openQuestions(a);
  const written = a.counterpart.revisePage(pageOfSize(opts.pageBytes), { by: "owner", reason: "a long page", ...(opts.short === true ? { short: SHORT } : {}) });
  expect(written.written).toBe(true);
  work(a, opts.widest === true);
  for (let i = 0; i < opts.dated; i += 1) reminder(a, DUES[i] ?? "2026-10-11", REMINDERS[i] ?? "", i === 0 && opts.plain === true ? "plain" : undefined);
  await worker(dataDir, zone);
  const row = lastBriefing(a);
  clock(zone, "2026-10-09", 8);
  const { text, result } = sessionStart(a, zone, "s-morning");
  return { a, text, result, row };
}

/** The Arriving lane's listed items, and whether any line of the wake is its collapsed line. */
function arriving(text: string): { listed: string[]; collapsed: boolean } {
  return {
    listed: (lane(text, FRAMING.horizon) ?? []).filter((l) => l.startsWith("- ")),
    collapsed: text.split("\n").some((l) => collapsedLane(l) === "horizon"),
  };
}

/** What the lower lanes printed: handoffs shown in full, "Work here" lines, the Yesterday line. */
function lower(text: string): { handoffs: number; work: number; yesterday: string | null } {
  const lines = text.split("\n");
  return {
    handoffs: lines.filter((l) => /^\d\) From session /.test(l)).length,
    work: (lane(text, WORK_HERE_HEADING) ?? []).filter((l) => l.startsWith("- ")).length,
    yesterday: lines.find((l) => l.startsWith("Yesterday, ")) ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. One list, declared
// ═══════════════════════════════════════════════════════════════════════════

describe("one ordered list of who gives way to whom", () => {
  test("dated items sit above the furniture, below the page in its own room — and a due-day plain reminder above the page's borrowing", () => {
    const at = (l: (typeof ROOM_ORDER)[number]): number => ROOM_ORDER.indexOf(l);
    for (const below of ["work", "yesterday", "lastHere", "handoffs"] as const) {
      expect(at(below)).toBeLessThan(at("arriving"));
      expect(at(below)).toBeLessThan(at("arrivingFirst"));
    }
    // #350's rule stands inside it: Arriving's first line, then Still open's first item, then Arriving's later lines.
    expect(at("arriving")).toBeLessThan(at("openFirst"));
    expect(at("openFirst")).toBeLessThan(at("arrivingFirst"));
    // The page's borrowing outranks an ordinary dated line; a due-day plain reminder outranks the borrowing; the page in its own room outranks all.
    expect(at("arrivingFirst")).toBeLessThan(at("pageBorrow"));
    expect(at("pageBorrow")).toBeLessThan(at("due"));
    expect(at("due")).toBeLessThan(at("page"));
    // The trim loop's lanes are the bottom of the same list, in the same order.
    expect(ROOM_ORDER.slice(0, 3)).toEqual(TRIM_ORDER.slice(0, 3) as never);
    // The head of Arriving: its due-day plain reminders, or else its first line.
    expect(arrivingHead([])).toBe(0);
    expect(arrivingHead([{}, {}])).toBe(1);
    expect(arrivingHead([{ due: true }, { due: true }, {}])).toBe(2);
  });

  test("a plain reminder is due the day the wake is read: its date is the day the wake is composed for, or the next", () => {
    expect(plainDueOn({ mode: "plain", eventDate: "2026-10-09" }, "2026-10-08")).toBe(true);
    expect(plainDueOn({ mode: "plain", eventDate: "2026-10-08" }, "2026-10-08")).toBe(true);
    expect(plainDueOn({ mode: "plain", eventDate: "2026-10-10" }, "2026-10-08")).toBe(false);
    expect(plainDueOn({ mode: "plain", eventDate: "2026-10-07" }, "2026-10-08")).toBe(false);
    expect(plainDueOn({ mode: "quiet", eventDate: "2026-10-09" }, "2026-10-08")).toBe(false);
    expect(plainDueOn({ mode: "plain", eventDate: "2026-10" }, "2026-10-08")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. At 9,000, through SessionStart: every dated item listed, the lower lanes give way
// ═══════════════════════════════════════════════════════════════════════════

describe("at 9,000, an over-room page, four handoffs, yesterday's titles — every dated item is listed", () => {
  for (const zone of ZONES) {
    for (const dated of [1, 2]) {
      test(`${zone}: ${String(dated)} dated ${dated === 1 ? "item" : "items"} — listed down a sweep of page sizes, the page never stepped down for them, and the lower lanes give way with their counts and ids`, async () => {
        let gaveWay = 0;
        for (const pageBytes of [PAGE_ROOM_BYTES, 6_400, 6_767, 7_100]) {
          const twin = await morning(zone, { pageBytes, dated: 0 });
          const m = await morning(zone, { pageBytes, dated });
          const { listed, collapsed } = arriving(m.text);
          expect({ pageBytes, listed: listed.length, collapsed }).toEqual({ pageBytes, listed: dated, collapsed: false });
          for (const body of REMINDERS.slice(0, dated)) expect(listed.some((l) => l.endsWith(body))).toBe(true);
          expect(m.text).not.toContain(`Arriving: ${String(dated)} — ${COLLAPSED_WORDS}`);
          expect(readSentinel(m.text).intact).toBe(true);
          expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
          // The page is borrowing past its room, and an ordinary dated line
          // never pushes it down a rung: it prints on the rung it prints on without them.
          expect((m.row["page"] as Record<string, unknown>)["rung"]).toBe((twin.row["page"] as Record<string, unknown>)["rung"]);
          expect(m.row["trimmedLanes"]).not.toHaveProperty("horizon");
          // What gave way is below them, with its count and its ids.
          const was = lower(twin.text);
          const now = lower(m.text);
          expect(now.handoffs).toBeLessThanOrEqual(was.handoffs);
          expect(now.work).toBeLessThanOrEqual(was.work);
          if (now.handoffs < was.handoffs || now.work < was.work || now.yesterday !== was.yesterday) gaveWay += 1;
          if (now.handoffs > 0) expect(m.text).toMatch(/\+\d+ older here: sch_[0-9a-f]+/);
          // The Yesterday line, if it gave titles, still names every chapter it named, by id.
          expect(was.yesterday).not.toBeNull();
          expect((now.yesterday ?? "").match(/epi_[0-9a-f]+/g)?.length).toBe((was.yesterday ?? "").match(/epi_[0-9a-f]+/g)?.length);
          // Doctor has nothing to say about dated items.
          expect(wakeArrivalFindings(m.a.counterpart.store).map((f) => f.detail).join(" ")).not.toContain("Arriving:");
        }
        expect(gaveWay).toBeGreaterThan(0);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A due-day plain reminder, at the tightest reserves
// ═══════════════════════════════════════════════════════════════════════════

describe("a plain reminder due the morning the wake is read, under the widest delivery reserves", () => {
  for (const zone of ZONES) {
    test(`${zone}: it leads "Arriving:", listed whole beside a borrowing page, four handoffs and yesterday's titles — and is said plainly beside the wake, outside it`, async () => {
      for (const pageBytes of [PAGE_ROOM_BYTES, 6_400, 6_767]) {
        const m = await morning(zone, { pageBytes, dated: 2, plain: true, widest: true });
        // The reserves landed at their widest: the boundary composed at 9,000 − (preface + 1,125 + 1,125), and lent past it.
        expect(Number(m.row["budget"])).toBeGreaterThanOrEqual(COMPOSE);
        const { listed, collapsed } = arriving(m.text);
        expect(collapsed).toBe(false);
        expect(listed.length).toBe(2);
        expect(listed[0]).toEndWith(REMINDERS[0]);
        expect(listed[0]).toContain("(due 2026-10-09)");
        expect(readSentinel(m.text).intact).toBe(true);
        expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
        expect(m.row["trimmedLanes"]).not.toHaveProperty("horizon");
        // SAID PLAINLY ON ITS DAY, outside the wake block: to the model above
        // the wake's opening comment, to the person as a notice — the wake's
        // own budget cannot crowd it out (it is deferred to the first prompt
        // when the envelope has no room, never dropped).
        const injection = m.result.injection ?? "";
        const said = injection.indexOf("Plain reminder (they asked to be told) — Today: ");
        expect(said).toBeGreaterThanOrEqual(0);
        expect(said).toBeLessThan(injection.indexOf("<!-- counterparts:wake "));
        expect(m.result.notices?.some((n) => n.startsWith("Today: Remind him on the 12th"))).toBe(true);
        // And the reserves were the tightest this store can make: within the
        // few dozen bytes the handoffs' excerpt cap leaves under the share.
        const composeBudget = m.a.counterpart.rebrief({ budgetBytes: BUDGET }).composeBudget ?? 0;
        expect(composeBudget).toBeGreaterThanOrEqual(COMPOSE);
        expect(composeBudget).toBeLessThan(COMPOSE + 64);
      }
    });
  }

  test("it leads the horizon ahead of warmer arrivals, so the count cannot leave it out", async () => {
    const dataDir = freshDir();
    clock("America/Denver", "2026-10-08", 21);
    const a = adapter(dataDir, "America/Denver");
    reminder(a, "2026-10-10", REMINDERS[1]);
    reminder(a, "2026-10-11", REMINDERS[2]);
    const plain = a.counterpart.store.put({
      type: "memory",
      kind: "person",
      body: REMINDERS[0],
      learnedOn: "2026-10-01",
      eventDate: "2026-10-09",
      salience: { novelty: null, relevance: 0.1, emotional: 0.1, predictive: 0.1 },
      meta: { [CUE_MODE_META]: "plain" },
    });
    const items = a.counterpart.prospective.horizon({ at: "2026-10-08" }).items;
    expect(items.length).toBe(2);
    expect(items[0]?.memoryId).toBe(plain);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. At the composition: three dated items, and the page's borrowing
// ═══════════════════════════════════════════════════════════════════════════

describe("at the composition: three dated items, and who gives the room", () => {
  const ZONE = "America/Denver";
  function selfWith(page: string, short?: string, bodies: readonly string[] = REMINDERS): { me: Self; store: Store; ids: string[] } {
    const store = Store.open({ dir: freshDir() });
    closers.push(store);
    const me = new Self({ store, gate: episodeGate() });
    const w = me.revisePage(page, { by: "owner", reason: "a long page", ...(short === undefined ? {} : { short }) });
    expect(w.written).toBe(true);
    const ids = bodies.map((body, i) =>
      store.put({ type: "memory", kind: "person", body, learnedOn: "2026-10-01", eventDate: DUES[i] ?? "2026-10-11", salience: SALIENT }),
    );
    return { me, store, ids };
  }
  /** What a page of `n` bytes costs printed whole: its top line, its text, its end line. */
  const wholeCost = (n: number): number => pageBlockBytes({ top: pageTopLine("whole", n), text: "x".repeat(n), end: PAGE_END_LINES.whole });
  const day = [0, 1, 2, 3].map((i) => ({ id: `epi_${String(i).padStart(12, "0")}`, title: `Seating the relief valves on kiln number ${String(i)} before the firing`, chapters: 1, createdAt: i }));
  const full = yesterdayLine(day, "2026-10-07") ?? "";
  const shorter = yesterdayShorter(day, "2026-10-07");

  test("at 9,000 under the widest reserves, a borrowing page and the Yesterday line's titles: 1, 2 and 3 dated items all listed — Work here gives first, then the titles, then the handoffs' room", () => {
    clock(ZONE, "2026-10-08", 21);
    let handoffsGave = 0;
    for (const pageBytes of [PAGE_ROOM_BYTES, 6_400, 6_767]) {
      const { me, ids } = selfWith(pageOfSize(pageBytes));
      for (const dated of [1, 2, 3]) {
        const horizon: HorizonItem[] = ids.slice(0, dated).map((id, i) => ({ id, due: DUES[i] ?? "2026-10-11" }));
        const req = { budgetBytes: COMPOSE, day: 2, horizon, yesterday: full, yesterdayShorter: shorter, lendBytes: SHARE, handoffLendBytes: SHARE };
        const out = me.build(req);
        expect({ pageBytes, dated, listed: out.counts.horizon }).toEqual({ pageBytes, dated, listed: dated });
        expect(out.page?.rung).toBe("whole");
        expect(out.bytes).toBeLessThanOrEqual(out.budgetBytes);
        expect(out.budgetBytes).toBeLessThanOrEqual(COMPOSE + 2 * SHARE);
        expect(readSentinel(out.text).intact).toBe(true);
        // In order: the handoffs' room is lent only once "Work here"'s is
        // gone and the Yesterday line has given every title to its id — and
        // that line is never dropped while it can say its pointers.
        const y = out.text.split("\n").find((l) => l.startsWith("Yesterday, ")) ?? "";
        expect([full, ...shorter]).toContain(y);
        if (out.budgetBytes > COMPOSE + SHARE) {
          handoffsGave += 1;
          expect(y).toBe(shorter[shorter.length - 1] ?? "");
        }
      }
    }
    // The handoffs' room was needed, and lent — the room the composition
    // never competed for before.
    expect(handoffsGave).toBeGreaterThan(0);
  });

  test("a plain reminder due the day the wake is read takes back the page's borrowing — the page steps down to its short version; an ordinary dated item does not", () => {
    // A page that needs every byte "Work here" lends, and no other room to
    // lend; reminders longer than the furniture's slack.
    const lend = wholeCost(7_012) - (COMPOSE - PAGE_FLOOR_RESERVE_BYTES);
    expect(lend).toBeGreaterThan(0);
    const { me, ids } = selfWith(pageOfSize(7_012), SHORT, LONG);
    const first = ids[0] ?? "";
    const base = { budgetBytes: COMPOSE, day: 2, lendBytes: lend };
    // Nothing dated: whole, on borrowed room.
    expect(me.build(base).page?.rung).toBe("whole");
    // An ordinary dated item: the page's borrowing outranks it, so the page stays whole and the item says so in one line.
    const quiet = me.build({ ...base, horizon: [{ id: first, due: "2026-10-09" }] });
    expect(quiet.page?.rung).toBe("whole");
    expect(quiet.counts.horizon).toBe(0);
    expect(quiet.text.split("\n").some((l) => collapsedLane(l) === "horizon")).toBe(true);
    // Due the day the wake is read, plain: the page steps down — whole text, its short version — and the reminder is listed.
    const due = me.build({ ...base, horizon: [{ id: first, due: "2026-10-09", plainDue: true }] });
    expect(due.page?.rung).toBe("short");
    expect(due.counts.horizon).toBe(1);
    expect(lane(due.text, FRAMING.horizon)?.[0]).toEndWith(LONG[0] ?? "");
    expect(due.text).toContain(SHORT);
    expect(readSentinel(due.text).intact).toBe(true);
    // And it leads the lane, ahead of the order it was supplied in.
    const two = me.build({ ...base, horizon: [{ id: ids[1] ?? "", due: "2026-10-10" }, { id: first, due: "2026-10-09", plainDue: true }] });
    expect(two.kept.horizon[0]).toBe(first);
  });

  test("the page within its own room outranks even a due-day reminder: no borrowing to give back, no step down", () => {
    const { me, ids } = selfWith(pageOfSize(6_000), SHORT, LONG);
    // The tightest budget at which the page prints whole without borrowing.
    const b = wholeCost(6_000) + PAGE_FLOOR_RESERVE_BYTES;
    expect(me.build({ budgetBytes: b, day: 2 }).page?.rung).toBe("whole");
    expect(me.build({ budgetBytes: b - 1, day: 2 }).page?.rung).toBe("short");
    const out = me.build({ budgetBytes: b, day: 2, horizon: [{ id: ids[0] ?? "", due: "2026-10-09", plainDue: true }] });
    expect(out.page?.rung).toBe("whole");
    expect(out.counts.horizon).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Doctor: a dated item left unlisted is amber
// ═══════════════════════════════════════════════════════════════════════════

describe("doctor's Wake line says so, in amber, when a dated item went unlisted", () => {
  test("a ceiling with no room for the reminder beside a page at its room: amber, with the date of the wake and what to do", async () => {
    const zone = "America/Denver";
    const small = 3_000;
    const dataDir = freshDir();
    clock(zone, "2026-10-08", 21);
    const a = adapter(dataDir, zone, small);
    const store = a.counterpart.store;
    // A page that fills exactly the room this ceiling has — no handoff, no
    // work, so nothing to lend — and a reminder longer than the furniture's slack.
    const room = small - PREFACE_RESERVE_BYTES - PAGE_FLOOR_RESERVE_BYTES;
    let size = room - 400;
    const cost = (n: number): number => pageBlockBytes({ top: pageTopLine("whole", n), text: "x".repeat(n), end: PAGE_END_LINES.whole });
    while (cost(size + 1) <= room) size += 1;
    a.counterpart.revisePage(pageOfSize(size), { by: "owner", reason: "at the room" });
    reminder(a, "2026-10-10", LONG[1] ?? "");
    await worker(dataDir, zone, small);
    expect((lastBriefing(a)["page"] as Record<string, unknown>)["rung"]).toBe("whole");
    expect(lastBriefing(a)["trimmedLanes"]).toEqual({ horizon: 1 });
    const f = wakeArrivalFindings(store).find((x) => x.key === "wake");
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain('a dated item under "Arriving:" was not listed for want of room in 1 wake (newest 2026-10-08)');
    expect(f?.fix).toContain("short version");
    expect(f?.fix).toContain("injectionBudgetBytes");
    expect(f?.data["datedUnlisted"]).toBe(1);
  });

  test("every dated item listed: no such clause, and nothing amber for it", async () => {
    const m = await morning("America/Denver", { pageBytes: 6_400, dated: 2 });
    const f = wakeArrivalFindings(m.a.counterpart.store).find((x) => x.key === "wake");
    expect(f?.detail ?? "").not.toContain("Arriving:");
    expect(f?.data["datedUnlisted"] ?? 0).toBe(0);
  });

  test("an older row with no per-lane count is read by its trimmed list", async () => {
    const zone = "America/Denver";
    const dataDir = freshDir();
    clock(zone, "2026-10-08", 21);
    const a = adapter(dataDir, zone);
    a.counterpart.store.appendEvent({
      name: SELF_BRIEFING_EVENT,
      day: a.counterpart.store.livedDay(),
      payload: { reason: "rendered", date: "2026-10-07", bytes: 8_900, budget: 9_000, counts: {}, trimmed: [{ id: "mem_x", lane: "horizon" }], trimmedTotal: 1 },
    });
    const f = wakeArrivalFindings(a.counterpart.store).find((x) => x.key === "wake");
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("(newest 2026-10-07)");
  });
});

// The store read in section 2 is the published bundle, not the live one.
test("the stored bundle and the delivered one agree on what Arriving lists", async () => {
  const m = await morning("Pacific/Kiritimati", { pageBytes: 6_767, dated: 2 });
  const stored = m.a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
  expect(arriving(stored).listed.length).toBe(2);
  expect(arriving(m.text).listed.length).toBe(2);
});
