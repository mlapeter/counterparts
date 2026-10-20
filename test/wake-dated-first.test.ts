/**
 * DATED ITEMS COME BEFORE THE FURNITURE (2026-10-10, `self/briefing.ts#
 * ROOM_ORDER`).
 *
 * The owner's wake on lived day 19 was 8,922 bytes and read "Coming up: 1 — no
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
import { deliverTurn, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { wakeArrivalFindings } from "../src/adapters/claude-code/doctor.js";
import { SELF_BRIEFING_EVENT } from "../src/core/counterpart.js";
import { episodeGate } from "../src/core/bridge.js";
import { HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE } from "../src/core/handoff/index.js";
import { yesterdayLine, yesterdayShorter } from "../src/core/handoff/last-here.js";
import { CUE_MODE_META, PROSPECTIVE_PLAIN_EVENT, plainDueOn } from "../src/core/prospective/index.js";
import {
  ARRIVING_NEAR_DAYS,
  BRIEFING_KEY,
  COLLAPSED_WORDS,
  NONE_TODAY_WORDS,
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
  arrivingNear,
  nearDue,
  collapsedLane,
  countedLanes,
  isFoldedLine,
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
import type { SelfTunables } from "../src/core/self/tunables.js";
import { Store } from "../src/core/store/index.js";
import { readableDate, startOfLocalDay, yearOf } from "../src/core/time.js";

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
      // Written HERE, so a session start here names them by title (since
      // 2026-10-18 a chapter from no recorded directory is not counted there).
      origin: { scope: SCOPE },
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
  const lines = workHere(store, SCOPE, { day, max: t.WORK_HERE_MAX, pool: t.WORK_HERE_POOL, excerpt: t.WORK_HERE_EXCERPT, skip: settledOver(store), year: yearOf(store.today()) });
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

/**
 * When each is due: all three the morning the wake is read — what "Coming
 * up" lists since 2026-10-16 (`COMING_UP_TODAY_ONLY`: due today; the overdue
 * are counted since the review of #511). Until then the two days after; the
 * composition tests below (section 4) still exercise other dates, with the
 * switch off.
 */
const DUES = ["2026-10-09", "2026-10-09", "2026-10-09"] as const;

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
async function morning(
  zone: string,
  opts: {
    pageBytes: number;
    dated: number;
    plain?: boolean;
    widest?: boolean;
    short?: boolean;
    bodies?: readonly string[];
    /** Run after the evening's boundary, before the morning's session start. */
    overnight?: (a: Adapter, ids: readonly string[], dataDir: string) => Promise<void>;
  },
): Promise<Morning> {
  const dataDir = freshDir();
  clock(zone, "2026-10-07", 20);
  const a = adapter(dataDir, zone);
  // Dated the day before the morning the wake is read: the Yesterday line is
  // assembled at session start for that morning's date (2026-10-10).
  chapters(a, "2026-10-08");
  await worker(dataDir, zone);
  clock(zone, "2026-10-08", 21);
  openQuestions(a);
  const written = a.counterpart.revisePage(pageOfSize(opts.pageBytes), { by: "owner", reason: "a long page", ...(opts.short === true ? { short: SHORT } : {}) });
  expect(written.written).toBe(true);
  work(a, opts.widest === true);
  const bodies = opts.bodies ?? REMINDERS;
  const ids: string[] = [];
  for (let i = 0; i < opts.dated; i += 1) ids.push(reminder(a, DUES[i] ?? "2026-10-11", bodies[i] ?? "", i === 0 && opts.plain === true ? "plain" : undefined));
  await worker(dataDir, zone);
  await opts.overnight?.(a, ids, dataDir);
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
    yesterday: lines.find((l) => l.startsWith("Yesterday")) ?? null,
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
    // The newest handoff's own room is kept from every ordinary line and lent
    // to a due-day plain reminder alone (review of #367).
    expect(at("handoffs")).toBeLessThan(at("handoffsKept"));
    expect(at("arrivingFirst")).toBeLessThan(at("handoffsKept"));
    expect(at("handoffsKept")).toBeLessThan(at("due"));
    expect(at("due")).toBeLessThan(at("page"));
    // The trim loop's lanes are the bottom of the same list, in the same order.
    expect(ROOM_ORDER.slice(0, 3)).toEqual(TRIM_ORDER.slice(0, 3) as never);
    // The "Today, elsewhere" line ranks above the handoffs' room and below
    // every dated item and the page's borrowing (review of #380).
    expect(at("handoffs")).toBeLessThan(at("elsewhere"));
    expect(at("elsewhere")).toBeLessThan(at("arriving"));
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
          expect(m.text).not.toContain(`Coming up: ${String(dated)} — ${COLLAPSED_WORDS}`);
          expect(readSentinel(m.text).intact).toBe(true);
          expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
          // Through the wake assembled at session start (2026-10-10).
          // Assembled at session start: the preface says no "composed at the last boundary".
          expect(m.text).not.toContain("composed at the last boundary");
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
          // Fewer in full, the rest by id — never none: the room lent stops at
          // the newest handoff's own block (review of #367).
          expect(now.handoffs).toBeGreaterThan(0);
          expect(m.text).toMatch(/\+\d+ older here: sch_[0-9a-f]+/);
          // The Yesterday line, if it gave titles, still names every chapter it named, by id.
          expect(was.yesterday).not.toBeNull();
          expect((now.yesterday ?? "").match(/epi_[0-9a-f]+/g)?.length).toBe((was.yesterday ?? "").match(/epi_[0-9a-f]+/g)?.length);
          // Doctor has nothing to say about dated items.
          expect(wakeArrivalFindings(m.a.counterpart.store).map((f) => f.detail).join(" ")).not.toContain("Coming up:");
        }
        expect(gaveWay).toBeGreaterThan(0);
      }, 60_000);
    }
  }
});

test("the room lent stops at the newest handoff: dated items a few lines long never empty the handoffs (review of #367)", async () => {
  // About 280 bytes each: the original lend took every byte of the handoffs'
  // room for the second Arriving line and "Still open"'s first item, and all
  // four handoffs went unshown while doctor stayed green.
  const MEDIUM = REMINDERS.map((r) => `${r} ${"It matters, and the details are written down in the studio notebook on the shelf by the door. ".repeat(2).trim()}`);
  for (const zone of ZONES) {
    for (const pageBytes of [6_400, 6_767]) {
      const m = await morning(zone, { pageBytes, dated: 3, plain: true, bodies: MEDIUM });
      expect({ pageBytes, handoffs: lower(m.text).handoffs > 0 }).toEqual({ pageBytes, handoffs: true });
      expect(m.text).toMatch(/\+\d+ older here: sch_[0-9a-f]+/);
      const { listed } = arriving(m.text);
      expect(listed[0]).toEndWith(MEDIUM[0] ?? "");
      // Every dated item is listed or named by id.
      for (const id of m.a.counterpart.prospective.horizon({ at: "2026-10-08" }).more.map((i) => i.memoryId)) expect(m.text).toContain(id);
      expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
    }
  }
}, 60_000);

// ═══════════════════════════════════════════════════════════════════════════
// 3. A due-day plain reminder, at the tightest reserves
// ═══════════════════════════════════════════════════════════════════════════

describe("a plain reminder due the morning the wake is read, under the widest delivery reserves", () => {
  for (const zone of ZONES) {
    test(`${zone}: it leads "Coming up:", listed whole beside a borrowing page, four handoffs and yesterday's titles — and is said plainly beside the wake, outside it`, async () => {
      for (const pageBytes of [PAGE_ROOM_BYTES, 6_400, 6_767]) {
        const m = await morning(zone, { pageBytes, dated: 2, plain: true, widest: true });
        // The reserves landed at their widest: the boundary composed at 9,000 − (preface + 1,125 + 1,125), and lent past it.
        expect(Number(m.row["budget"])).toBeGreaterThanOrEqual(COMPOSE);
        const { listed, collapsed } = arriving(m.text);
        expect(collapsed).toBe(false);
        expect(listed.length).toBe(2);
        expect(listed[0]).toEndWith(REMINDERS[0]);
        expect(listed[0]).toContain("(due Oct 9)");
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
    }, 60_000);
  }

  test("beside a page whole in its own room, one handoff and no work lines: it takes the room kept for the newest handoff — an ordinary dated item does not (review of #367)", async () => {
    // Measured on 62c8c7cd, which kept the newest handoff's room from every
    // lane: a page of 7,300-7,450 bytes printed whole without borrowing, one
    // handoff (so none of its room was lent) and no "Work here" (none to
    // lend) — the due-day reminder was in no line of the wake while the
    // handoff printed.
    const body = (k: number): string => `${REMINDERS[0]} ${"The details are in the studio notebook on the shelf by the door. ".repeat(k).trim()}`;
    expect([bytes(body(2)), bytes(body(5))]).toEqual([226, 421]);
    const one = async (zone: string, pageBytes: number, said: string, mode: "plain" | undefined) => {
      const dataDir = freshDir();
      clock(zone, "2026-10-07", 20);
      const a = adapter(dataDir, zone);
      chapters(a, "2026-10-07");
      await worker(dataDir, zone);
      clock(zone, "2026-10-08", 21);
      openQuestions(a);
      a.counterpart.writeHandoff("Handoff 0: the glaze tiles dry on rack two. Then the kiln log needs the cone readings.", { scope: SCOPE, session: "kiln-and-glaze-studio-session-0" });
      reminder(a, mode === "plain" ? "2026-10-09" : "2026-10-10", said, mode);
      expect(a.counterpart.revisePage(pageOfSize(pageBytes), { by: "owner", reason: "a long page" }).written).toBe(true);
      await worker(dataDir, zone);
      const row = lastBriefing(a);
      clock(zone, "2026-10-09", 8);
      const { text } = sessionStart(a, zone, "s-morning");
      return { a, row, text };
    };
    for (const zone of ZONES) {
      // 75 bytes more than measured on 62c8c7cd (2026-10-18): the handoff's
      // reserve is sized to its new, shorter staleness sentence (the work-since
      // words left the line), so the room is as tight as it was at these sizes.
      for (const pageBytes of [7_375, 7_475, 7_525]) {
        for (const said of [body(2), body(5)]) {
          const { a, row, text } = await one(zone, pageBytes, said, "plain");
          expect((row["page"] as Record<string, unknown>)["rung"]).toBe("whole");
          const { listed } = arriving(text);
          expect({ zone, pageBytes, listed: listed.length }).toEqual({ zone, pageBytes, listed: 1 });
          expect(listed[0]).toEndWith(said);
          expect(listed[0]).toContain("(due Oct 9)");
          expect(row["trimmedLanes"]).not.toHaveProperty("horizon");
          // The room it took is past the composition's budget: with no work
          // lines and one handoff, only the room kept for that handoff.
          expect(Number(row["budget"])).toBeGreaterThan(a.counterpart.rebrief({ budgetBytes: BUDGET }).composeBudget ?? 0);
          expect(readSentinel(text).intact).toBe(true);
          expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
        }
      }
    }
    // The same line, not plain and not due that morning: an ordinary dated
    // item, which the newest handoff's room is kept from — at session start
    // too, near as it is (its floor, review of #445).
    // Since 2026-10-16 ("Coming up" = today) it is not due that morning, so
    // it is counted as a later date — not a line the room took — and the
    // count says why.
    const { row, text } = await one("America/Denver", 7_400, body(2), undefined);
    expect(arriving(text).listed.length).toBe(0);
    expect(row["trimmedLanes"] ?? {}).not.toHaveProperty("horizon");
    expect(countedLanes(text).horizon).toBe(1);
    expect(text).toContain("Handoff 0: the glaze tiles dry on rack two.");
  }, 60_000);

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
  function selfWith(page: string, short?: string, bodies: readonly string[] = REMINDERS, tunables?: Partial<SelfTunables>): { me: Self; store: Store; ids: string[] } {
    const store = Store.open({ dir: freshDir() });
    closers.push(store);
    // The lane as it was before "Coming up" = today (2026-10-16): these tests
    // are about who gives the room to several dated lines, whatever their date.
    const me = new Self({ store, gate: episodeGate(), tunables: { COMING_UP_TODAY_ONLY: false, ...tunables } });
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
        const y = out.text.split("\n").find((l) => l.startsWith("Yesterday")) ?? "";
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

  test("past prospective's count, named by id under the lane — never silently gone (review of #367)", () => {
    clock(ZONE, "2026-10-08", 21);
    const bodies = [...REMINDERS, "The clay order arrives; check the invoice against the slip.", "The glaze supplier calls back about the cobalt."];
    for (const pageBytes of [PAGE_ROOM_BYTES, 6_767]) {
      const { me, ids } = selfWith(pageOfSize(pageBytes), undefined, bodies);
      const horizon: HorizonItem[] = ids.slice(0, 2).map((id, i) => ({ id, due: DUES[i] ?? "2026-10-11" }));
      const out = me.build({ budgetBytes: COMPOSE, day: 2, horizon, horizonMore: ids.slice(2), yesterday: full, yesterdayShorter: shorter, lendBytes: SHARE, handoffLendBytes: SHARE });
      expect(out.counts.horizon).toBe(2);
      expect(out.text).toContain(`(3 more coming up; recall ids: ${ids.slice(2).join(", ")})`);
      expect(out.bytes).toBeLessThanOrEqual(out.budgetBytes);
    }
  });

  test("prospective offers two and names the rest, due-day plain first", async () => {
    const dataDir = freshDir();
    clock(ZONE, "2026-10-08", 21);
    const a = adapter(dataDir, ZONE);
    const ids = REMINDERS.map((body, i) => reminder(a, DUES[i] ?? "2026-10-11", body));
    const h = a.counterpart.prospective.horizon({ at: "2026-10-08" });
    expect(h.items.length).toBe(2);
    expect([...h.items, ...h.more].map((i) => i.memoryId).sort()).toEqual([...ids].sort());
    expect(h.more.length).toBe(1);
  });

  test("a plain reminder due the day the wake is read takes back the page's borrowing — the page steps down to its short version; an ordinary dated item does not", () => {
    // A page that needs every byte "Work here" lends, and no other room to
    // lend; reminders longer than the furniture's slack.
    const lend = wholeCost(7_012) - (COMPOSE - PAGE_FLOOR_RESERVE_BYTES);
    expect(lend).toBeGreaterThan(0);
    // The 10-10 ladder, whole first even with a short version (`PAGE_SHORT_PAST_ROOM` off, 2026-10-20): this is about the borrowing.
    const { me, ids } = selfWith(pageOfSize(7_012), SHORT, LONG, { WAKE_LINE_BYTES: Number.POSITIVE_INFINITY, PAGE_SHORT_PAST_ROOM: false });
    const first = ids[0] ?? "";
    const base = { budgetBytes: COMPOSE, day: 2, lendBytes: lend };
    // Nothing dated: whole, on borrowed room.
    expect(me.build(base).page?.rung).toBe("whole");
    // An ordinary dated item: the page's borrowing outranks it, so the page stays whole and the item says so in one line.
    const quiet = me.build({ ...base, horizon: [{ id: first, due: "2026-10-09" }] });
    // (Whole items, below: as a line the reminder fits the furniture's slack.)
    expect(quiet.page?.rung).toBe("whole");
    expect(quiet.counts.horizon).toBe(0);
    // Counted, in its own line or folded with the others (2026-10-12).
    expect(countedLanes(quiet.text).horizon).toBe(1);
    expect(quiet.untold).toEqual({});
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

  test("the \"Today, elsewhere\" line takes no room from the page or its borrowing: \"Work here\" and the handoffs' room are lent to it, and a due-day reminder outranks it (b2 + random-f8; its rank since the review of #380)", () => {
    const away = `Today, elsewhere: ~/bakery open since 08:02 (live) — "${"A chapter title of some length ".repeat(3).trim()}" (epi_0123456789ab), 3 memories.`;
    const bare = "Today, elsewhere: ~/bakery open since 08:02 (live), 3 memories.";
    const line = { elsewhere: away, elsewhereShorter: [bare] };
    // `extra`: how much "Work here" lends past what the whole page needs —
    // none, more than the line, enough for a long reminder and Nearby's count (reserved since 2026-10-12) but not for those
    // and the line, and enough for all. (440, not 500, since the shorter
    // furniture and dates of 2026-10-16 left the line ~30 bytes more slack.)
    for (const extra of [0, 200, 440, 1_200]) {
      const lend = wholeCost(7_012) - (COMPOSE - PAGE_FLOOR_RESERVE_BYTES) + extra;
      const { me, ids } = selfWith(pageOfSize(7_012), SHORT, LONG, { PAGE_SHORT_PAST_ROOM: false });
      const first = ids[0] ?? "";
      const base = { budgetBytes: COMPOSE, day: 2, lendBytes: lend };
      // The page whole on borrowed room, with the line or without it.
      expect(me.build(base).page?.rung).toBe("whole");
      const withLine = me.build({ ...base, ...line });
      expect(withLine.page?.rung).toBe("whole");
      expect(withLine.text.split("\n")).toContain(pageTopLine("whole", 7_012) ?? "");
      expect(withLine.text.split("\n")).toContain(PAGE_END_LINES.whole);
      expect([away, bare, undefined]).toContain(withLine.elsewhere);
      expect(withLine.bytes).toBeLessThanOrEqual(withLine.budgetBytes);
      expect(readSentinel(withLine.text).intact).toBe(true);
      // What "Work here" lends past the page is the line's.
      if (extra > 0) expect(withLine.elsewhere).toBe(away);
      // And the handoffs' room, below it in `ROOM_ORDER`, is lent to it too.
      const lent = me.build({ ...base, ...line, handoffLendBytes: 400 });
      expect(lent.page?.rung).toBe("whole");
      expect(lent.elsewhere).toBe(away);
      expect(lent.bytes).toBeLessThanOrEqual(lent.budgetBytes);
      // A due-day plain reminder: listed, and the page on the rung it takes
      // without the line — the line gives way first, never the page for it.
      const horizon = [{ id: first, due: "2026-10-09", plainDue: true }];
      const due = me.build({ ...base, ...line, horizon });
      const alone = me.build({ ...base, horizon });
      expect(due.counts.horizon).toBe(1);
      expect(due.page?.rung).toBe(alone.page?.rung);
      expect(due.bytes).toBeLessThanOrEqual(due.budgetBytes);
      if (extra === 440) {
        expect(due.page?.rung).toBe("whole");
        expect(due.elsewhere).not.toBe(away);
      }
      if (extra === 1_200) expect(due.elsewhere).toBe(away);
    }
  });

  test("when no dated line fits, the lane still says how many, on room from the lanes below it (2026-10-12)", () => {
    // The owner's 10-12 bundle: a page whole on borrowed room, the Yesterday
    // line with its titles, seven dated items and not one word under
    // "Coming up:" — the count line had no rescue when the lane listed nothing.
    const lens = [486, 1270, 263, 415, 134, 288, 483];
    const bodies = lens.map((n, i) => `${`Item ${String(i)} ${"word ".repeat(400)}`.slice(0, n - 1)}.`);
    // Whole items (no line form, #489 C): the case is a lane with no room for even one line.
    const { me, ids } = selfWith(pageOfSize(6_472), undefined, bodies, { WAKE_LINE_BYTES: Number.POSITIVE_INFINITY });
    const dues = ["2026-10-14", "2026-10-14", "2026-10-14", "2026-10-15", "2026-10-15", "2026-10-11", "2026-10-15"];
    const horizon = ids.map((id, i) => ({ id, due: dues[i] ?? "" }));
    const out = me.build({ budgetBytes: 6_637, day: 2, horizon, lendBytes: 952, handoffKeepBytes: 673, yesterday: full, yesterdayShorter: shorter });
    expect(out.page?.rung).toBe("whole");
    expect(out.counts.horizon).toBe(0);
    // Counted, in its own line or folded with the others (2026-10-12), its first id named.
    expect(countedLanes(out.text).horizon).toBe(ids.length);
    expect(out.untold).toEqual({});
    const line = out.text.split("\n").find((l) => collapsedLane(l) === "horizon" || isFoldedLine(l));
    expect(line).toContain(ids[0]);
    expect(out.bytes).toBeLessThanOrEqual(out.budgetBytes);
    expect(out.budgetBytes).toBeLessThanOrEqual(6_637 + 952);
    expect(readSentinel(out.text).intact).toBe(true);
  });

  test("the room kept for the newest handoff is lent to a due-day plain reminder, and to nothing else (review of #367)", () => {
    // Whole items: as a line the ordinary one fits the furniture's slack.
    const { me, ids } = selfWith(pageOfSize(6_000), undefined, LONG, { WAKE_LINE_BYTES: Number.POSITIVE_INFINITY });
    const first = ids[0] ?? "";
    // The page whole with nothing to spare, nothing else to lend.
    const b = wholeCost(6_000) + PAGE_FLOOR_RESERVE_BYTES;
    const keep = 600;
    const due = me.build({ budgetBytes: b, day: 2, horizon: [{ id: first, due: "2026-10-09", plainDue: true }], handoffKeepBytes: keep });
    expect(due.page?.rung).toBe("whole");
    expect(due.counts.horizon).toBe(1);
    expect(due.budgetBytes).toBeGreaterThan(b);
    expect(due.budgetBytes).toBeLessThanOrEqual(b + keep);
    expect(due.bytes).toBeLessThanOrEqual(due.budgetBytes);
    const ordinary = me.build({ budgetBytes: b, day: 2, horizon: [{ id: first, due: "2026-10-09" }], handoffKeepBytes: keep });
    expect(ordinary.page?.rung).toBe("whole");
    expect(ordinary.counts.horizon).toBe(0);
    expect(ordinary.budgetBytes).toBe(b);
  });

  test("an id past the count is named beside the due-day lines: its count is reserved, and the lanes below give way for it (2026-10-12; review of #367)", () => {
    clock(ZONE, "2026-10-08", 21);
    const bodies = [...LONG.slice(0, 2), REMINDERS[2], "The clay order arrives; check the invoice against the slip.", "The glaze supplier calls back about the cobalt."];
    const { me, ids } = selfWith(pageOfSize(4_000), undefined, bodies);
    const past = ids.slice(2);
    // Two due-day plain reminders are the lane's head: no rescue pops either
    // to pay for the count.
    const horizon: HorizonItem[] = ids.slice(0, 2).map((id) => ({ id, due: "2026-10-09", plainDue: true }));
    const both = me.build({ budgetBytes: COMPOSE, day: 2, horizon });
    expect(both.counts.horizon).toBe(2);
    expect(both.page?.rung).toBe("whole");
    // The tightest budget that lists both without the count: the count was
    // dropped without a word here until 2026-10-12 (only a trim row said so).
    // Now its room is reserved, and "Nearby" gives up items to pay for it.
    const out = me.build({ budgetBytes: both.bytes, day: 2, horizon, horizonMore: past });
    expect(out.counts.horizon).toBe(2);
    expect(out.page?.rung).toBe("whole");
    expect(out.text).toContain("(3 more coming up; recall ids: ");
    expect(out.untold).toEqual({});
    expect(out.counts.hints).toBeLessThan(both.counts.hints);
    expect(out.trimmed.filter((e) => e.lane === "horizon")).toEqual([]);
    expect(out.bytes).toBeLessThanOrEqual(out.budgetBytes);
    // With room for the count, it names them, and no row is written for them.
    const roomy = me.build({ budgetBytes: COMPOSE, day: 2, horizon, horizonMore: past });
    expect(roomy.text).toContain(`(3 more coming up; recall ids: ${past.join(", ")})`);
    expect(roomy.trimmed).toEqual([]);
  });

  test("the page within its own room outranks even a due-day reminder: no borrowing to give back, no step down", () => {
    const { me, ids } = selfWith(pageOfSize(6_000), SHORT, LONG, { PAGE_SHORT_PAST_ROOM: false });
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
// 4b. Cued and told before anyone read it: still listed on its day (2026-10-12)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE OWNER'S 10-12 MORNING. A plain tax reminder due that day had been cued
 * twice in its lead days — its fire budget spent — and told plainly at 12:19
 * am to a coordinator session's turn that an agent's message started, nobody
 * reading. Both took it off "Coming up:" (the cue path's brakes, and the told
 * latch), so his 08:00 wake, over-room page, four handoffs and Yesterday line
 * and all, had no Arriving line at all.
 */
async function spentAndToldOvernight(a: Adapter, ids: readonly string[], dataDir: string): Promise<void> {
  const zone = "America/Denver";
  const id = ids[0] ?? "";
  const p = a.counterpart.prospective;
  const day = a.counterpart.store.livedDay();
  // Cued on two lead days: the window's fire budget is spent.
  expect(p.fire({ memoryId: id, windowKey: "d:2026-10-09", at: "2026-10-07", day: day - 1 }).reason).toBe("fired");
  expect(p.fire({ memoryId: id, windowKey: "d:2026-10-09", at: "2026-10-08", day }).reason).toBe("fired");
  expect(a.counterpart.store.prospectiveFor(id)[0]?.fires).toBe(2);
  // A chapter here from the session before: the wake's "Last here" line.
  a.counterpart.store.put({
    type: "episode",
    kind: "self",
    title: "Glazing the test tiles and logging the cone readings for the record",
    body: `## chapter 1 — ${readableDate("2026-10-08")} · lived day 2\n\nWe glazed the tiles and logged the cones.`,
    origin: { scope: SCOPE, session: "kiln-and-glaze-studio-session-9" },
  });
  // 12:19 am: another session's turn is told it plainly, and its turn ends.
  clock(zone, "2026-10-09", 0.3);
  const due = p.plainDue({ at: "2026-10-09" }).find((d) => d.memoryId === id);
  expect(due).toBeDefined();
  if (due !== undefined) expect(p.claimPlain(due, { at: "2026-10-09", session: "s-agent-message" })).toBe(true);
  await worker(dataDir, zone);
}

describe("a plain reminder due today, cued out and told overnight, still reaches the morning wake", () => {
  test("over its room: the reminder is listed — on the room the lower lanes lend, or with the page on its short version", async () => {
    for (const pageBytes of [6_472, 6_950, 7_100]) {
      const m = await morning("America/Denver", { pageBytes, dated: 1, plain: true, short: true, overnight: spentAndToldOvernight });
      const { listed, collapsed } = arriving(m.text);
      // The whole wake, around it: the Yesterday line, "Last here" (where it
      // fits), "Last said here", the handoffs — what gives way is below it.
      const lines = m.text.split("\n");
      expect(lines.some((l) => l.startsWith("Yesterday"))).toBe(true);
      expect(lower(m.text).handoffs).toBeGreaterThanOrEqual(1);
      if (pageBytes !== 6_950) {
        expect(lines.some((l) => l.startsWith("Last here: "))).toBe(true);
        expect(lines.some((l) => l.startsWith("Last said here, "))).toBe(true);
      }
      // Past its room with a short version: the short version (2026-10-20,
      // `PAGE_SHORT_PAST_ROOM`; until then whole on what "Work here" lends,
      // or — past that — its short version).
      expect(m.text).toContain(SHORT);
      expect(listed.length).toBe(1);
      expect(listed[0]).toEndWith(REMINDERS[0]);
      expect(collapsed).toBe(false);
      expect(readSentinel(m.text).intact).toBe(true);
      expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
      // The bundle the overnight turn-end published lists it too.
      expect(arriving(m.a.counterpart.store.getMeta(BRIEFING_KEY) ?? "").listed.length).toBe(1);
    }
  });

  test("a page that fits: listed, and the page whole", async () => {
    const m = await morning("America/Denver", { pageBytes: 4_000, dated: 1, plain: true, short: true, overnight: spentAndToldOvernight });
    const { listed } = arriving(m.text);
    expect(listed.length).toBe(1);
    expect(listed[0]).toEndWith(REMINDERS[0]);
    expect(m.text.split("\n")).toContain(PAGE_END_LINES.whole);
    expect(readSentinel(m.text).intact).toBe(true);
    expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
  });

  test("the next morning it has left the lane: told, and its day behind", async () => {
    const m = await morning("America/Denver", { pageBytes: 4_000, dated: 1, plain: true, overnight: spentAndToldOvernight });
    expect(m.a.counterpart.prospective.horizon({ at: "2026-10-10" }).items.map((i) => i.memoryId)).toEqual([]);
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
    // Due the day of the render: "Coming up" lists them (2026-10-16), as
    // far as they fit: one line alone would, in the furniture's slack, but
    // not beside the second and the lane's count, so both are counted.
    // (Until then one reminder two days out, which the shorter furniture and
    // dates of 2026-10-16 now leave room for.)
    reminder(a, "2026-10-08", LONG[1] ?? "");
    reminder(a, "2026-10-08", LONG[2] ?? "");
    await worker(dataDir, zone, small);
    expect((lastBriefing(a)["page"] as Record<string, unknown>)["rung"]).toBe("whole");
    expect(lastBriefing(a)["trimmedLanes"]).toEqual({ horizon: 2 });
    // Counted, never gone without a word (2026-10-12): a step-down, not red.
    expect(lastBriefing(a)["counted"]).toBe(2);
    expect(lastBriefing(a)["untold"]).toBe(0);
    const f = wakeArrivalFindings(store).find((x) => x.key === "wake");
    expect(f?.severity).toBe("amber");
    expect(f?.data["untold"]).toBe(0);
    expect(f?.data["steppedDown"]).toBe(1);
    expect(f?.detail).toContain('a dated item under "Coming up:" was counted, not listed, for want of room in 1 render of the wake (newest 2026-10-08)');
    expect(f?.fix).toContain("short version");
    expect(f?.fix).toContain("injectionBudgetBytes");
    expect(f?.data["datedUnlisted"]).toBe(1);
  });

  test("every dated item listed: no such clause, and nothing amber for it", async () => {
    const m = await morning("America/Denver", { pageBytes: 6_400, dated: 2 });
    const f = wakeArrivalFindings(m.a.counterpart.store).find((x) => x.key === "wake");
    expect(f?.detail ?? "").not.toContain("Coming up:");
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
// Since 2026-10-16 ("Coming up" = today) each lists what is due by its own
// date: the evening's bundle counts the two due the next morning; the
// morning's wake lists both.
test("the stored bundle and the delivered one each list what is due by their own date", async () => {
  const m = await morning("Pacific/Kiritimati", { pageBytes: 6_767, dated: 2 });
  const stored = m.a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
  expect(arriving(stored).listed.length).toBe(0);
  expect(countedLanes(stored).horizon).toBe(2);
  expect(arriving(m.text).listed.length).toBe(2);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. A turn no person started is not told a plain reminder (2026-10-12)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE OWNER'S 10-12, AS IT HAPPENED to mem_346077c3e78c: a plain reminder due
 * D, raised as a cue on D-1, then, at 00:19 on D, "told" to a coordinator
 * session's turn that a subagent's hand-back had started, nobody reading. Here
 * that turn, and three more no person started, run the real prompt hook and
 * the real delivery. The reminder is neither said nor marked told there; it is
 * listed in D's morning wake beside an over-room page, four handoffs and the
 * Yesterday line; and the first prompt a person types says it.
 */
const HAND_BACK_BODY =
  "Remind him on the 9th to call the kiln supplier before noon about the cracked element; the replacement ships only if ordered that morning.";

describe("at session start, dated items due within the next few days have first claim on the room (2026-10-12, RANDOM's ruling)", () => {
  // Built first (2026-10-12) the near lines could take the newest handoff's
  // own room too: on this fixture the wake listed both dated lines and no
  // handoff at all, not even by id. The newest handoff keeps a floor (review
  // of #445, COUNTERPARTS' call): the second line would need its room.
  test("two long dated lines beside a borrowing page and four handoffs: the newest handoff keeps its own block", async () => {
    for (const zone of ZONES) {
      const m = await morning(zone, { pageBytes: 6_472, dated: 3, widest: true, short: true, bodies: LONG });
      const stored = m.a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
      // Two since #489 C: each long line is its title or first line and id.
      // The evening's: none, all three due the next morning and counted;
      // the morning's all three ("Coming up" = today, 2026-10-16).
      expect(arriving(stored).listed.length).toBe(0);
      expect(countedLanes(stored).horizon).toBe(3);
      const { listed, collapsed } = arriving(m.text);
      expect(collapsed).toBe(false);
      expect(listed.length).toBe(3);
      expect(listed[0]).toContain("(due Oct 9)");
      expect(lower(m.text).handoffs).toBeGreaterThanOrEqual(1);
      // The newest, in full (listed first).
      expect(m.text).toMatch(/^1\) From session [^\n]*: Handoff \d: the glaze tiles dry on rack two/m);
      expect(lower(m.text).yesterday).not.toBeNull();
      expect(readSentinel(m.text).intact).toBe(true);
      expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
    }
  }, 60_000);

  test("a dated item is near when due from the session's date through three days on, not in its grace days; the head counts, a far line stops the run", () => {
    expect(ARRIVING_NEAR_DAYS).toBe(3);
    expect(nearDue("2026-10-09", "2026-10-09")).toBe(true);
    expect(nearDue("2026-10-12", "2026-10-09")).toBe(true);
    expect(nearDue("2026-10-13", "2026-10-09")).toBe(false);
    // A "was due" line (RANDOM's ruling at the review of #445).
    expect(nearDue("2026-10-08", "2026-10-09")).toBe(false);
    expect(nearDue(undefined, "2026-10-09")).toBe(false);
    expect(arrivingNear([{ due: true }, { near: true }, {}, { near: true }])).toBe(2);
    expect(arrivingNear([{}, { near: true }])).toBe(0);
    expect(arrivingNear([{ due: true }, {}])).toBe(0);
    expect(arrivingNear([{ near: true }, { near: true }])).toBe(2);
  });
});

describe("a plain reminder is never told to a turn no person started", () => {
  test("a hand-back at 00:19, a task notification, a peer message: nothing said or claimed; the morning wake lists it; a typed prompt says it", async () => {
    const zone = "America/Denver";
    const hostTurns = [
      "[Subagent hand-back]\nPR #442 opened; head 9543950d. 2,077 pass, 0 fail.",
      "<task-notification>\n<task-id>b7</task-id>\n<status>completed</status>\n</task-notification>",
      'Another Claude session sent a message:\n<agent-message from="counterparts-b2">merged</agent-message>',
      '<cross-session-message from-name="random-06" from-session="s-r06">the bench run finished</cross-session-message>',
    ];
    const prompt = (session: string, text: string): ReturnType<typeof toHookInput> =>
      toHookInput({ session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text }, { scope: SCOPE, timeZone: zone, env: {} });
    const deliver = (a: Adapter, input: ReturnType<typeof toHookInput>) => {
      const turn = a.userPromptSubmit(input);
      const out = deliverTurn("user-prompt-submit", turn, {}, null, { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i, due) => a.claimPlain(i, due) }, input);
      return { turn, out };
    };
    const m = await morning(zone, {
      // 7,100 since 2026-10-18 (6,950 before): the handoffs' smaller reserve let a 6,950 page fit whole on the rungs where the newest handoff is the short one, and the room this test is about went with it.
      pageBytes: 7_100,
      dated: 1,
      plain: true,
      widest: true,
      short: true,
      bodies: [HAND_BACK_BODY],
      overnight: async (a, ids, dataDir) => {
        const id = ids[0] ?? "";
        // Raised on D-1, as a cue in that evening's turn.
        expect(a.counterpart.prospective.fire({ memoryId: id, windowKey: "d:2026-10-09", at: "2026-10-08", day: a.counterpart.store.livedDay() }).reason).toBe("fired");
        a.counterpart.store.put({
          type: "episode",
          kind: "self",
          title: "Glazing the test tiles and logging the cone readings for the record",
          body: `## chapter 1 — ${readableDate("2026-10-08")} · lived day 2\n\nWe glazed the tiles and logged the cones.`,
          origin: { scope: SCOPE, session: "kiln-and-glaze-studio-session-9" },
        });
        // 00:19 on D: the coordinator session's turns, none of them typed.
        clock(zone, "2026-10-09", 19 / 60);
        for (const text of hostTurns) {
          const { turn } = deliver(a, prompt("s-coordinator", text));
          expect(turn.notices ?? []).toEqual([]);
          expect(turn.injection ?? "").not.toContain("call the kiln supplier");
        }
        expect(a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toEqual([]);
        await worker(dataDir, zone);
      },
    });
    // D's morning wake: listed whole, beside everything else the wake carries.
    const { listed, collapsed } = arriving(m.text);
    expect(collapsed).toBe(false);
    expect(listed.length).toBe(1);
    expect(listed[0]).toEndWith(HAND_BACK_BODY);
    expect(listed[0]).toContain("(due Oct 9)");
    expect(m.text.split("\n").some((l) => l.startsWith("Yesterday"))).toBe(true);
    expect(m.text.split("\n").some((l) => l.startsWith("Last here: "))).toBe(true);
    expect(m.text).toContain(SHORT);
    expect(lower(m.text).handoffs).toBeGreaterThanOrEqual(1);
    expect(readSentinel(m.text).intact).toBe(true);
    expect(bytes(m.text)).toBeLessThanOrEqual(BUDGET);
    expect(m.result.notices?.some((n) => n.startsWith("Today: Remind him on the 9th"))).toBe(true);
    // The first prompt a person types says it, and only then is it told.
    const { out } = deliver(m.a, prompt("s-typed", "morning, what's on today?"));
    expect(String((JSON.parse(out.stdout) as Record<string, unknown>)["systemMessage"])).toStartWith("Today: Remind him on the 9th to call the kiln supplier");
    expect(m.a.counterpart.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT })).toHaveLength(1);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Nothing the wake chose goes unmentioned (2026-10-12, Mike's principle)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE OWNER'S 10-12 MORNING, ALL OF IT: a page over its room, four handoffs,
 * seven dated items (two offered, five past prospective's count), 25 open
 * questions, personal facts under "Nearby", the Yesterday line — at 9,000,
 * through the wake assembled at session start. Every lane the wake chose is
 * whole, shortened (some items and its count) or counted (one line), and the
 * furniture keeps its own pointers. `WAKE_SHAPE=1` prints the shape.
 */
describe("the owner's 10-12 morning: nothing the wake chose goes unmentioned", () => {
  const SEVEN = [
    "The quarterly tax is due on the 15th; the forms are in the green folder.",
    "Rosa's surgery is on the tenth; send a note the evening before.",
    "The kiln inspector comes on the eleventh; the gate code is in the blue folder.",
    "The clay order arrives; check the invoice against the slip.",
    "The glaze supplier calls back about the cobalt.",
    "The studio rent renews; ask about the second bay.",
    "Pick up the repaired wheel from Marco's shop.",
  ];
  const FACTS = [
    "He takes his coffee black and early, before the studio opens.",
    "His sister Ana lives in Valencia and calls on Sundays.",
    "He prefers plain answers over hedged ones, even when the news is bad.",
    "The dog is called Pico and is afraid of the kiln's fan.",
    "He learned to throw on a kick wheel and still prefers one.",
    "He keeps a paper notebook for every firing.",
  ];
  for (const zone of ZONES) {
    test(`${zone}: every lane whole, shortened or counted, the handoffs and Yesterday by pointer, within 9,000`, async () => {
      const m = await morning(zone, {
        pageBytes: 6_767,
        dated: 7,
        bodies: SEVEN,
        overnight: async (a, _ids, dataDir) => {
          for (const body of FACTS) a.counterpart.store.put({ type: "memory", kind: "fact", body, learnedOn: "2026-10-05", salience: SALIENT });
          // Re-rendered so they are in the published bundle: a turn-end
          // worker renders only when something marked it behind, and these
          // were put straight into the store. (Until 2026-10-16 "Nearby" here
          // was filled by the dated items past prospective's count, listed
          // there too; a later date counted under "Coming up" is in no other
          // lane now.)
          await worker(dataDir, zone);
          a.counterpart.rebrief({ budgetBytes: BUDGET, at: "2026-10-08" });
        },
      });
      const text = m.text;
      const counted = countedLanes(text);
      const listed = (heading: string): number => (lane(text, heading) ?? []).filter((l) => l.startsWith("- ")).length;
      const shape = {
        arriving: { listed: listed(FRAMING.horizon), counted: counted.horizon ?? 0 },
        open: { listed: listed(FRAMING.threads), counted: counted.threads ?? 0 },
        nearby: { listed: listed(FRAMING.hints), counted: counted.hints ?? 0 },
        handoffs: lower(text).handoffs,
        older: /\+(\d+) older here: sch_/.exec(text)?.[1] ?? "0",
        yesterday: text.split("\n").find((l) => l.startsWith("Yesterday")) ?? null,
        page: (m.row["page"] as Record<string, unknown> | undefined)?.["rung"],
        folded: text.split("\n").some(isFoldedLine),
        quiet: m.a.counterpart.events("counterpart.wake.assembled").at(-1)?.data?.["quiet"] ?? 0,
        bytes: bytes(text),
      };
      if (process.env["WAKE_SHAPE"] === "1") console.log(zone, JSON.stringify(shape));
      // Seven dated items, every one listed or counted.
      expect(shape.arriving.listed + shape.arriving.counted).toBe(SEVEN.length);
      expect(shape.arriving.listed).toBeGreaterThan(0);
      // Twenty-five open questions, every one listed or counted.
      expect(shape.open.listed + shape.open.counted).toBe(25);
      // Arriving and Still open list items, so each keeps its own count line under it (never the fold).
      expect(text).toContain(`(${String(shape.arriving.counted)} more coming up; recall ids`);
      expect(text).toContain(`(${String(shape.open.counted)} more still open; recall ids`);
      // "Nearby": listed, counted, or — the least of the lanes, in room
      // nothing else wants — left quiet, a step-down the session start's own
      // event records (decided by COUNTERPARTS, 2026-10-12).
      const assembled = m.a.counterpart.events("counterpart.wake.assembled").at(-1)?.data ?? {};
      expect(assembled["untold"]).toBe(0);
      expect(shape.nearby.listed + shape.nearby.counted + Number(assembled["quiet"] ?? 0)).toBeGreaterThan(0);
      // Four handoffs: in full, the rest by id.
      expect(shape.handoffs).toBeGreaterThan(0);
      expect(shape.handoffs + Number(shape.older)).toBe(4);
      // The Yesterday line, its pointers at least; the page, on a rung that says where the rest is.
      expect(shape.yesterday).not.toBeNull();
      expect(shape.page).toBeDefined();
      expect(readSentinel(text).intact).toBe(true);
      expect(shape.bytes).toBeLessThanOrEqual(BUDGET);
      // The published bundle said nothing was left unsaid, and doctor agrees.
      expect(m.row["untold"]).toBe(0);
      const f = wakeArrivalFindings(m.a.counterpart.store).find((x) => x.key === "wake");
      expect(f?.severity ?? "green").not.toBe("red");
    }, 60_000);
  }
});
