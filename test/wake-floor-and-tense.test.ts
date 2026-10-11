/**
 * TWO WAKE LINES THE OWNER READ ON 2026-10-09, through the real wake path.
 *
 * 1. "Still open:" over no item at all, then "(20 more still open; recall ids
 *    (the first 5): …)". The page is furniture the trim cannot pop, and so is
 *    the Yesterday line; the trim order takes "Still open" before Arriving, so
 *    beside a long page the lane gave up its last item while Arriving kept
 *    every line. The PAGE IS NOT WHAT GIVES WAY (review of #350): it prints
 *    whole under its cap. "Still open" keeps its first item and its count out
 *    of, in order, the room held for "Work here", Arriving beyond its first
 *    line and the Yesterday line's titles (`self/briefing.ts#keepFirstOpen`),
 *    and a lane that still lists nothing is ONE line with its heading inside
 *    it (`collapsedLine`) — never a heading over a count.
 *
 * 2. "Arriving: … (due 2026-10-08)" read on 10-09. By design: a one-off stays
 *    in the horizon lane for its grace days, and the wake composed at the
 *    10-08 evening boundary is read on the morning of the 9th. The date was
 *    true; the line read as still to come. Now the render says `(was due …)`
 *    for a date already behind the day it was composed for, and the DELIVERY
 *    — which alone knows the morning — says `(was due yesterday, 2026-10-08)`
 *    (`arrivingTense`), inside the preface's reserve.
 *
 * In Denver (UTC−6) and Kiritimati (UTC+14): the clock is frozen at instants
 * whose UTC date differs from the local one, so a comparison made on the
 * wrong calendar fails here. The runner renders (`runOnce`, the turn-end
 * worker), the hook delivers (`toHookInput` → `sessionStart`).
 *
 * Hermetic: a fresh temp data dir per test, removed afterwards. Every memory
 * is invented for the test.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { deliverTurn, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { wakeLanes, wakeParts } from "../src/adapters/dashboard/web/views/mind.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import { yesterdayLine, yesterdayShorter } from "../src/core/handoff/last-here.js";
import {
  BRIEFING_KEY,
  COLLAPSED_WORDS,
  FRAMING,
  PAGE_END_LINES,
  PAGE_ROOM_BYTES,
  PREFACE_RESERVE_BYTES,
  SELF_TUNABLES,
  arrivingTense,
  collapsedLane,
  collapsedLine,
  compose,
  moreLine,
  prefaceLine,
  pageTooLargeLine,
  pageTopLine,
  readSentinel,
  render,
  WAKE_SYSTEM,
} from "../src/core/self/index.js";
import type { Lanes, Ranked, Resolve } from "../src/core/self/index.js";
import { readableDate, startOfLocalDay } from "../src/core/time.js";

const BUDGET = 9_000;
const SCOPE = "/work/studio";
const ZONES = ["America/Denver", "Pacific/Kiritimati"] as const;

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-wake-floor-tense-"));
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

function config(zone: string, budget = BUDGET): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: budget, owner: true, timeZone: zone };
}

/** `hour` o'clock on `ymd`, in `zone`, as the frozen clock. */
function clock(zone: string, ymd: string, hour: number): void {
  setSystemTime(new Date(startOfLocalDay(ymd, zone) + hour * 3_600_000));
}

function adapter(zone: string, budget = BUDGET): ReturnType<typeof openAdapter> {
  const a = openAdapter(config(zone, budget), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

/** The turn-end worker, on the frozen clock: the cycle and the wake's catch-up. */
async function worker(zone: string, budget = BUDGET): Promise<void> {
  const out = await runOnce({ config: config(zone, budget), embedder: null });
  expect(out.ran).toBe(true);
}

/** SessionStart, as the hook builds its input: the person's date in `zone`. */
function sessionStart(a: ReturnType<typeof openAdapter>, zone: string, session: string): { text: string; result: ReturnType<ReturnType<typeof openAdapter>["sessionStart"]> } {
  const input = toHookInput({ session_id: session, hook_event_name: "SessionStart", cwd: SCOPE }, { scope: SCOPE, timeZone: zone, env: {} });
  const result = a.sessionStart(input);
  const text = result.injection ?? "";
  const open = text.indexOf("<!-- counterparts:wake ");
  return { text: open < 0 ? text : text.slice(open), result };
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

const SALIENT = { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 };

/** Twenty-five open questions, each about 250 bytes on its line, as the owner's run. */
function openQuestions(a: ReturnType<typeof openAdapter>, n = 25): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    let body = `Open question ${String(i)}: whether kiln shelf ${String(i)} needs a second coat of wash before the next firing`;
    while (body.length < 220) body += ", or whether the thin coat holds for one more round";
    ids.push(a.counterpart.store.put({ type: "memory", kind: "fact", body: `${body}.`, salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 }, meta: { unresolved: true } }));
  }
  return ids;
}

/** A page of exactly `bytes` bytes, in paragraphs of about 420. */
function pageOf(bytes: number): string {
  const para = "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess. ".repeat(4).trim();
  const paras: string[] = [];
  let total = 0;
  while (total + (paras.length === 0 ? 0 : 2) + Buffer.byteLength(para) <= bytes) {
    total += (paras.length === 0 ? 0 : 2) + Buffer.byteLength(para);
    paras.push(para);
  }
  let page = paras.join("\n\n");
  const short = bytes - Buffer.byteLength(page);
  if (short > 3) page += `\n\n${"And one more thing I keep. ".repeat(Math.ceil(short / 27)).slice(0, short - 3)}.`;
  expect(Buffer.byteLength(page)).toBe(bytes);
  return page;
}

/**
 * Write a page of `bytes` bytes; returns it, as the store holds it. Past the
 * room it is kept as it is (2026-10-10): only the 16 KB ceiling refuses.
 */
function longPage(a: ReturnType<typeof openAdapter>, bytes: number): string {
  const page = pageOf(bytes);
  expect(a.counterpart.revisePage(page, { by: "owner", reason: "a long page" }).written).toBe(true);
  return page;
}

/** The page whole as "Who I am" prints it: its top line, then the page. */
function whole(page: string): string {
  return `${FRAMING.identity}\n${pageTopLine("whole", Buffer.byteLength(page)) ?? ""}\n${page}\n`;
}

/** Chapters written on `ymd`, so the wake carries a Yesterday line the next day. */
function chapters(a: ReturnType<typeof openAdapter>, ymd: string): void {
  for (let i = 0; i < 4; i += 1) {
    a.counterpart.store.put({
      type: "episode",
      kind: "self",
      title: `Seating the relief valves on kiln number ${String(i)} before the firing`,
      body: `## chapter 1 — ${readableDate(ymd)} · lived day 2\n\nWe seated the valves and wrote down what held.`,
    });
  }
}

/**
 * Work in the session's directory — handoffs, a captured turn, work lines — so
 * the delivery reserves (handoff, "Last here", "Work here") are in play, as
 * they are on the owner's store: they bring the 9,000-byte host to a compose
 * budget near 7.2 KB.
 */
function work(a: ReturnType<typeof openAdapter>): void {
  for (let i = 0; i < 3; i += 1) {
    a.counterpart.writeHandoff(
      `Handoff ${String(i)}: the glaze test tiles are drying on the second rack and the kiln log needs the cone readings copied over before anyone fires again.`,
      { scope: SCOPE, session: `h${String(i)}` },
    );
  }
  a.counterpart.captureSpans({
    session: "h9",
    scope: SCOPE,
    turns: [
      { role: "user", text: "We fired the test kiln and logged the cones for the record today." },
      { role: "assistant", text: "Logged; the cone readings are in the kiln book." },
    ],
  });
  for (let i = 0; i < 4; i += 1) {
    a.counterpart.store.put({
      type: "memory",
      kind: "skill",
      body: `Work fact ${String(i)}: the kiln controller wants the ramp entered in degrees per hour, not per minute, and the offset separately.`,
      salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
      origin: { scope: SCOPE },
    });
  }
}

function reminder(a: ReturnType<typeof openAdapter>, due: string, body: string, mode?: "plain"): string {
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

// ═══════════════════════════════════════════════════════════════════════════
// 1. "Still open:" lists what it can, or says so in one line
// ═══════════════════════════════════════════════════════════════════════════

describe("Still open keeps its first item beside a long page, and the page is never cut for it (2026-10-09)", () => {
  /**
   * The owner's wake that morning, rebuilt: 25 open items, a long page, a
   * Yesterday line naming four chapters, two Arriving lines and this
   * directory's handoffs and work, at the 9,000-byte default — the delivery
   * reserves bring the composition to ~7.2 KB.
   */
  async function morning(zone: string, pageBytes: number): Promise<{ a: ReturnType<typeof openAdapter>; ids: string[]; page: string; text: string; stored: string }> {
    clock(zone, "2026-10-07", 20);
    const a = adapter(zone);
    // Dated the day before the morning the wake is read: the Yesterday line is
    // assembled at session start for that morning's date (2026-10-10).
    chapters(a, "2026-10-08");
    await worker(zone);
    clock(zone, "2026-10-08", 21);
    const ids = openQuestions(a);
    const page = longPage(a, pageBytes);
    work(a);
    reminder(a, "2026-10-08", "The dentist appointment is at nine and the forms are in the blue folder.");
    reminder(a, "2026-10-10", "Rosa's surgery is on the tenth; send a note the evening before.");
    await worker(zone);
    clock(zone, "2026-10-09", 8);
    const { text } = sessionStart(a, zone, "s-morning");
    return { a, ids, page, text, stored: a.counterpart.store.getMeta(BRIEFING_KEY) ?? "" };
  }

  for (const zone of ZONES) {
    // The owner's page was 5,845 bytes (version 16) and is 5,904 (version 17);
    // `PAGE_ROOM_BYTES` is the room its writer aims under (2026-10-10), past
    // the room the lanes beside it had. At 5,904 the trim keeps one item
    // and no room for its count; the count is paid for out of "Work here"
    // (review of #358), so the lane never reads as if one thing were open.
    for (const bytes of [5_845, 5_904, PAGE_ROOM_BYTES]) {
      test(`${zone}: a ${String(bytes)}-byte page is printed whole, byte for byte, and "Still open" still lists its first item and its count`, async () => {
        const { a, ids, page, text, stored } = await morning(zone, bytes);
        expect(readSentinel(text).intact).toBe(true);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(BUDGET);
        // THE PAGE, WHOLE: in the stored bundle and in what the session got.
        expect(stored).toContain(whole(page));
        expect(text).toContain(whole(page));
        expect(stored).not.toContain("the wake shows the first");
        // STILL OPEN: an item first, then how many more — never a heading over a count.
        const open = lane(text, FRAMING.threads) ?? [];
        const listed = open.filter((l) => l.startsWith("- "));
        expect(listed.length).toBeGreaterThanOrEqual(1);
        expect(open[0]?.startsWith("- ")).toBe(true);
        const bodies = ids.map((id) => a.counterpart.store.readProse(id).body);
        for (const line of listed) expect(bodies).toContain(line.slice(line.indexOf(" · ") + 3));
        expect(open[open.length - 1]).toStartWith(`(${String(25 - listed.length)} more still open; `);
        // And what gave way was "Work here" (fewer lines), not the reminders or
        // yesterday's chapters: both Arriving lines, all four titles.
        expect(lane(text, FRAMING.horizon)?.filter((l) => l.startsWith("- ")).length).toBe(2);
        expect(text).toContain("Yesterday, 10-08: ");
        expect(text.split("\n").find((l) => l.startsWith("Yesterday, 10-08: "))).not.toContain(" more.");
        expect(text).toContain("Where the work in this directory was left off");
      });
    }

    test(`${zone}: a page past its room borrows "Work here" and prints whole — Arriving keeps its first line, and the wake fits`, async () => {
      // 6,850 bytes: past this composition's room (its budget less the
      // furniture), within it once "Work here" lends (review of #358).
      const { text, stored, page } = await morning(zone, 6_850);
      expect(stored).toContain(whole(page));
      expect(text).toContain(whole(page));
      expect(text).not.toContain("My page is");
      expect(readSentinel(text).intact).toBe(true);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(BUDGET);
      expect(lane(text, FRAMING.horizon)?.[0]).toStartWith("- ");
      expect(text).toContain("Where the work in this directory was left off");
    });

    test(`${zone}: a page past even the borrowed room is never cut — with no short version, its outline stands for it, and the lanes beside it take nothing from it`, async () => {
      const { text, stored, page } = await morning(zone, 8_400);
      // This page has no headings: its outline is its first whole sentence.
      const outline = `${FRAMING.identity}\n${pageTopLine("outline", 8_400) ?? ""}\nI keep a careful account of the studio and the people in it, and I say what I do not know before I guess.\n`;
      expect(stored).toContain(outline);
      expect(text).toContain(outline);
      expect(text).toContain(`\n${PAGE_END_LINES.outline}\n`);
      expect(text).not.toContain(page.slice(0, 200));
      expect(text).not.toContain("the wake shows the first");
      expect(text).not.toContain(pageTooLargeLine(8_400));
      const open = lane(text, FRAMING.threads) ?? [];
      expect(open[0]?.startsWith("- ")).toBe(true);
      expect(readSentinel(text).intact).toBe(true);
    });
  }

  test("without a page the identity share already leaves the lane its room: 25 open items at 9,000 list items", async () => {
    clock("America/Denver", "2026-10-08", 21);
    const a = adapter("America/Denver");
    openQuestions(a);
    await worker("America/Denver");
    clock("America/Denver", "2026-10-09", 8);
    const open = lane(sessionStart(a, "America/Denver", "s1").text, FRAMING.threads) ?? [];
    expect(open.filter((l) => l.startsWith("- ")).length).toBe(SELF_TUNABLES.THREADS_MAX);
    expect(open[open.length - 1]).toStartWith(`(${String(25 - SELF_TUNABLES.THREADS_MAX)} more still open; `);
  });

  test("a short page is not cut for the lanes beside it", async () => {
    clock("America/Denver", "2026-10-08", 21);
    const a = adapter("America/Denver");
    openQuestions(a);
    const page = "I keep a careful account of the studio.\n\nI say what I do not know before I guess.";
    a.counterpart.revisePage(page, { by: "owner", reason: "short" });
    await worker("America/Denver");
    const stored = a.counterpart.store.getMeta(BRIEFING_KEY) ?? "";
    expect(stored).toContain(page);
    expect(stored).not.toContain("the wake shows the first");
  });
});

describe("a lane that lists nothing is one line, its heading inside it", () => {
  function thread(id: string): Ranked {
    return { id, lane: "threads", kind: "fact", band: "semantic", strength: 0.9, protected: false, bornDay: 0, personScoped: false, lastRendered: -1 };
  }
  const long: Resolve = (id) => ({ statement: `The open question ${id}. ${"It has a great many words in it. ".repeat(12)}`, learnedOn: "2026-10-01" });
  function lanes(n: number): Lanes {
    const ids = Array.from({ length: n }, (_, i) => `mem_t${String(i).padStart(2, "0")}`);
    return {
      identity: [],
      craft: [],
      threads: ids.slice(0, 5).map(thread),
      hints: [],
      horizon: [],
      overflow: { identity: [], craft: [], threads: ids.slice(5), hints: [], horizon: [] },
    };
  }

  test("the room for the count but not one item: one line, no heading, the whole count — 'more' than none is not a count", () => {
    // Every budget from the floor to well past one item: never a heading over a count.
    const floor = render(lanes(20), { budgetBytes: 100, day: 3 }, long, SELF_TUNABLES).bytes;
    let collapsed = 0;
    for (let budget = floor; budget <= floor + 900; budget += 7) {
      const out = render(lanes(20), { budgetBytes: budget, day: 3 }, long, SELF_TUNABLES);
      const lines = out.text.split("\n");
      const at = lines.indexOf(FRAMING.threads);
      if (at >= 0) expect(lines[at + 1]?.startsWith("- "), String(budget)).toBe(true);
      const one = lines.find((l) => collapsedLane(l) === "threads");
      if (one !== undefined) {
        collapsed += 1;
        expect(at).toBe(-1);
        expect(out.counts.threads).toBe(0);
        expect(one).toBe(collapsedLine("threads", lanes(20).threads.map((r) => r.id).concat(lanes(20).overflow?.threads ?? [])));
        expect(one).toStartWith(`Still open: 20 — ${COLLAPSED_WORDS}; recall ids (the first 5): mem_t00, `);
        expect(out.more).toEqual({ threads: 20 });
      }
      expect(out.bytes).toBeLessThanOrEqual(budget);
      expect(readSentinel(out.text).intact).toBe(true);
    }
    expect(collapsed).toBeGreaterThan(0);
  });

  test("the dashboard files the one line under its own lane, not the one above it", () => {
    const line = collapsedLine("threads", ["mem_a", "mem_b"]);
    const text = ["<!-- counterparts:wake day=3 elements=0 bytes=1 -->", FRAMING.context, "", FRAMING.identity, "The page.", "", line, "", "<!-- counterparts:wake/end -->"].join("\n");
    const split = wakeLanes(text);
    expect(split.map((l) => l.lane)).toEqual([null, "identity", "threads"]);
    expect(split[2]?.heading).toBe(FRAMING.threads);
    expect(split[2]?.items).toEqual([line.slice(FRAMING.threads.length + 1)]);
    const parts = wakeParts(text, true);
    expect(parts.find((p) => p.key === "threads")?.bytes).toBe(Buffer.byteLength(`${line}\n\n`));
    expect(parts.find((p) => p.key === "page")?.bytes).toBe(Buffer.byteLength("The page.\n\n"));
    // A page line that merely opens with the words is not one.
    expect(collapsedLane("Still open: two questions about the kiln.")).toBe(null);
  });
});

describe("what gives way for Still open's first item, in order — never the page (review of #350)", () => {
  const ranked = (id: string, lane: "threads" | "horizon"): Ranked => ({ id, lane, kind: "fact", band: "semantic", strength: 0.9, protected: false, bornDay: 0, personScoped: false, lastRendered: -1 });
  const resolve: Resolve = (id) => ({
    statement: id.startsWith("mem_t")
      ? `The open question ${id}: whether the kiln shelf needs a second coat of wash before the next firing.`
      : `Arriving ${id}: the appointment is at nine and the forms are in the blue folder.`,
    learnedOn: "2026-10-01",
  });
  const body = pageOf(3_000);
  const page = { text: body, top: null, dateline: null, end: null, rung: "whole" as const, truncated: false, wholeBytes: 3_000 };
  const title = (i: number): string => `"Seating the relief valves on kiln number ${String(i)}" (epi_${String(i)})`;
  const full = `Yesterday, 10-07: ${[0, 1, 2, 3].map(title).join("; ")}.`;
  const shorter = [3, 2, 1].map((n) => `Yesterday, 10-07: ${[0, 1, 2].slice(0, n).map(title).join("; ")}; and ${String(4 - n)} more.`);
  const shortest = shorter[shorter.length - 1] ?? "";
  function lanes(horizon = 3): Lanes {
    return {
      identity: [],
      craft: [],
      hints: [],
      threads: Array.from({ length: 5 }, (_, i) => ranked(`mem_t${String(i)}`, "threads")),
      horizon: Array.from({ length: horizon }, (_, i) => ranked(`mem_h${String(i)}`, "horizon")),
      overflow: { identity: [], craft: [], threads: Array.from({ length: 15 }, (_, i) => `mem_t${String(i + 5)}`), hints: [], horizon: [] },
    };
  }
  const req = (budgetBytes: number, opts: { lend?: number; yesterday?: string; shorter?: readonly string[] } = {}) => ({
    budgetBytes,
    day: 3,
    page,
    pageExists: true,
    yesterday: opts.yesterday ?? full,
    yesterdayShorter: opts.shorter ?? shorter,
    ...(opts.lend === undefined ? {} : { lendBytes: opts.lend }),
  });
  const floor = render(lanes(), req(100), resolve, SELF_TUNABLES).bytes;
  /** The smallest the rescue can make it: one open item and its count, one Arriving line, the shortest Yesterday. */
  function tightest(): ReturnType<typeof compose> {
    const all = lanes();
    const rest = [...all.threads.slice(1).map((r) => r.id), ...(all.overflow?.threads ?? [])];
    const kept = { identity: [], craft: [], hints: [], threads: all.threads.slice(0, 1), horizon: all.horizon.slice(0, 1) };
    return compose(kept, 3, resolve, undefined, { page, forming: null }, { threads: moreLine("threads", rest) }, shortest);
  }
  /** Arriving whole when "Still open" has nothing to list: the trim loop's own room for it. */
  const arrivingWhole = (b: number): boolean =>
    render({ ...lanes(), threads: [], overflow: { identity: [], craft: [], threads: [], hints: [], horizon: [] } }, req(b), resolve, SELF_TUNABLES).counts.horizon === 3;

  /**
   * The render with one more Arriving line than `out` listed, at its least:
   * no count for Arriving, Still open as it was with its count, and the
   * shortest Yesterday — what the rescue of that line had to beat.
   */
  function oneMoreArriving(out: ReturnType<typeof render>): ReturnType<typeof compose> {
    const all = lanes();
    const threads = all.threads.filter((r) => out.kept.threads.includes(r.id));
    const rest = [...all.threads.filter((r) => !out.kept.threads.includes(r.id)).map((r) => r.id), ...(all.overflow?.threads ?? [])];
    const kept = { identity: [], craft: [], hints: [], threads, horizon: all.horizon.slice(0, out.counts.horizon + 1) };
    return compose(kept, 3, resolve, undefined, { page, forming: null }, threads.length === 0 ? {} : { threads: moreLine("threads", rest) }, shortest);
  }

  test("down every budget (2026-10-10, ROOM_ORDER): the Yesterday line gives up its titles before Arriving gives up a line, and Arriving's later lines go only for Still open's first item", () => {
    const seen = { arriving: 0, yesterday: 0 };
    for (let b = floor; b <= floor + 1_500; b += 3) {
      const out = render(lanes(), req(b), resolve, SELF_TUNABLES);
      expect(out.bytes).toBeLessThanOrEqual(b);
      expect(out.budgetBytes).toBe(b);
      expect(readSentinel(out.text).intact).toBe(true);
      // The page is the caller's block, printed as given at every budget.
      expect(out.text).toContain(`${FRAMING.identity}\n${body}\n`);
      const open = lane(out.text, FRAMING.threads);
      const y = out.text.split("\n").find((l) => l.startsWith("Yesterday, "));
      if (out.counts.threads === 0) {
        // Nothing listed — and the first item and its count would not have
        // fit had the Yesterday line and Arriving's later lines given all they
        // could: all or nothing. (Arriving's first line outranks it.)
        expect(open).toBe(null);
        if (out.counts.horizon > 0) expect(tightest().bytes).toBeGreaterThan(b);
      } else {
        expect(open?.[0]).toStartWith("- ");
      }
      if (out.counts.horizon < 3) {
        // Arriving listed fewer: only where one more line would not fit even
        // with the Yesterday line at its shortest.
        seen.arriving += 1;
        expect(oneMoreArriving(out).bytes).toBeGreaterThan(b);
        if (out.counts.threads > 0) {
          expect(out.counts.threads).toBe(1);
          expect(open?.[1]).toStartWith("(19 more still open; ");
        }
      }
      if (y !== undefined && y !== full) {
        // Yesterday gave titles: only for what ranks above it — Arriving, and
        // Still open's first item — never beside more of Still open.
        seen.yesterday += 1;
        expect(out.counts.threads).toBeLessThanOrEqual(1);
        expect(shorter).toContain(y);
      }
    }
    expect(seen.arriving).toBeGreaterThan(0);
    expect(seen.yesterday).toBeGreaterThan(0);
  });

  test("the Yesterday line's shorter forms give a title at a time to its id — pointers instead of titles — widest first, every chapter still named and the rest counted", () => {
    const day = [0, 1, 2, 3, 4].map((i) => ({ id: `epi_${String(i)}`, title: `Seating the valves on kiln ${String(i)}`, chapters: i === 0 ? 2 : 1, createdAt: i }));
    expect(yesterdayLine(day, "2026-10-07")).toEndWith('"Seating the valves on kiln 3" (epi_3); and 1 more.');
    const forms = yesterdayShorter(day, "2026-10-07");
    expect(forms.length).toBe(4);
    forms.forEach((line, i) => {
      const titles = 3 - i;
      expect(line).toStartWith(
        titles > 0 ? 'Yesterday, 10-07: "Seating the valves on kiln 0" (epi_0, 2 chapters)' : "Yesterday, 10-07: epi_0 (2 chapters); epi_1; ",
      );
      // Every chapter the whole line names is still named, by its id, and the one past them counted.
      for (const id of ["epi_0", "epi_1", "epi_2", "epi_3"]) expect(line).toContain(id);
      expect(line).toEndWith("; and 1 more.");
      expect(line.split('"').length - 1).toBe(2 * titles);
    });
    expect(forms[forms.length - 1]).toBe("Yesterday, 10-07: epi_0 (2 chapters); epi_1; epi_2; epi_3; and 1 more.");
    const sizes = forms.map((l) => Buffer.byteLength(l));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(yesterdayShorter(day.slice(0, 1), "2026-10-07")).toEqual(["Yesterday, 10-07: epi_0 (2 chapters)."]);
  });

  test("the room held for 'Work here' is lent first: Arriving and Yesterday stay whole, and only Still open's first item and its count ride on it", () => {
    // A budget where, without the lend, Arriving gives up a line it had room for.
    let b = floor;
    while (b < floor + 1_500) {
      const out = render(lanes(), req(b), resolve, SELF_TUNABLES);
      if (out.counts.threads === 1 && out.counts.horizon < 3 && arrivingWhole(b)) break;
      b += 1;
    }
    expect(b).toBeLessThan(floor + 1_500);
    const lent = render(lanes(), req(b, { lend: 2_000 }), resolve, SELF_TUNABLES);
    expect(lent.counts.horizon).toBe(3);
    expect(lent.counts.threads).toBe(1);
    expect(lane(lent.text, FRAMING.threads)?.[1]).toStartWith("(19 more still open; ");
    expect(lent.text).toContain(`\n${full}\n`);
    expect(lent.text).toContain(`${FRAMING.identity}\n${body}\n`);
    // It ran past the budget by what it borrowed, and says what it was composed to.
    expect(lent.bytes).toBeGreaterThan(b);
    expect(lent.budgetBytes).toBe(lent.bytes);
    expect(lent.overBudget).toBe(false);
    expect(readSentinel(lent.text).intact).toBe(true);
    // Nothing else rides on borrowed bytes: no "more arriving" line, no second item.
    expect(lent.text).not.toContain("more arriving");
    // A wake with room for everything borrows nothing.
    const roomy = render(lanes(), req(floor + 5_000, { lend: 2_000 }), resolve, SELF_TUNABLES);
    expect(roomy.budgetBytes).toBe(floor + 5_000);
    expect(roomy.counts.threads).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. An Arriving line past its date says so
// ═══════════════════════════════════════════════════════════════════════════

describe("an Arriving line past its date says it WAS due (2026-10-09)", () => {
  for (const zone of ZONES) {
    test(`${zone}: composed the evening it is due, read the next morning — "was due yesterday"; the one still to come is unchanged`, async () => {
      clock(zone, "2026-10-08", 21);
      const a = adapter(zone);
      reminder(a, "2026-10-08", "The dentist appointment is at nine and the forms are in the blue folder.");
      reminder(a, "2026-10-10", "Rosa's surgery is on the tenth; send a note the evening before.");
      await worker(zone);
      // Composed for the 8th, in the person's zone: due TODAY, said plainly.
      const stored = lane(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "", FRAMING.horizon);
      expect(stored).toEqual([
        "- 2026-10-01 (due 2026-10-08) · The dentist appointment is at nine and the forms are in the blue folder.",
        "- 2026-10-01 (due 2026-10-10) · Rosa's surgery is on the tenth; send a note the evening before.",
      ]);
      // The same evening it is still today's.
      expect(lane(sessionStart(a, zone, "s-evening").text, FRAMING.horizon)?.[0]).toContain("(due 2026-10-08)");

      // The next morning, before any worker has run on the 9th.
      clock(zone, "2026-10-09", 8);
      const { text } = sessionStart(a, zone, "s-morning");
      expect(lane(text, FRAMING.horizon)).toEqual([
        "- 2026-10-01 (was due yesterday, 2026-10-08) · The dentist appointment is at nine and the forms are in the blue folder.",
        "- 2026-10-01 (due 2026-10-10) · Rosa's surgery is on the tenth; send a note the evening before.",
      ]);
      expect(text).toContain("(2026-10-09)");
      expect(readSentinel(text).intact).toBe(true);
      // The stored bundle is untouched: the tense is the delivery's.
      expect(a.counterpart.store.getMeta(BRIEFING_KEY)).toContain("(due 2026-10-08)");
    });

    test(`${zone}: in its grace days the render says "was due"; read days later, the date alone`, async () => {
      clock(zone, "2026-10-09", 9);
      const a = adapter(zone);
      reminder(a, "2026-10-08", "The dentist appointment is at nine and the forms are in the blue folder.");
      await worker(zone);
      const stored = lane(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "", FRAMING.horizon);
      expect(stored).toEqual(["- 2026-10-01 (was due 2026-10-08) · The dentist appointment is at nine and the forms are in the blue folder."]);
      expect(lane(sessionStart(a, zone, "s1").text, FRAMING.horizon)?.[0]).toBe(
        "- 2026-10-01 (was due yesterday, 2026-10-08) · The dentist appointment is at nine and the forms are in the blue folder.",
      );
      // Three days on, with no render in between (nobody worked): a date, no "yesterday".
      clock(zone, "2026-10-11", 9);
      expect(lane(sessionStart(a, zone, "s2").text, FRAMING.horizon)?.[0]).toBe(
        "- 2026-10-01 (was due 2026-10-08) · The dentist appointment is at nine and the forms are in the blue folder.",
      );
    });
  }

  test("due on the day it was learned: the one date is named as the due date, and turns past the morning after", async () => {
    clock("America/Denver", "2026-10-08", 9);
    const a = adapter("America/Denver");
    a.counterpart.store.put({ type: "memory", kind: "person", body: "Call the plumber back about the boiler.", learnedOn: "2026-10-08", eventDate: "2026-10-08", salience: SALIENT });
    await worker("America/Denver");
    expect(lane(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "", FRAMING.horizon)).toEqual(["- due 2026-10-08 · Call the plumber back about the boiler."]);
    clock("America/Denver", "2026-10-09", 8);
    expect(lane(sessionStart(a, "America/Denver", "s1").text, FRAMING.horizon)).toEqual(["- was due yesterday, 2026-10-08 · Call the plumber back about the boiler."]);
  });

  test("TOLD PLAINLY ON ITS DAY, it is not in the next morning's wake", async () => {
    const zone = "America/Denver";
    clock(zone, "2026-10-07", 21);
    const a = adapter(zone);
    const id = reminder(a, "2026-10-08", "Pay the quarterly estimated tax before the bank closes.", "plain");
    await worker(zone);
    expect(lane(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "", FRAMING.horizon)?.[0]).toContain("(due 2026-10-08)");
    // A late session's turn ends after midnight: the 8th's render, before anyone was told.
    clock(zone, "2026-10-08", 0.2);
    await worker(zone);
    expect(lane(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "", FRAMING.horizon)?.[0]).toContain("(due 2026-10-08)");
    // The morning: told at SessionStart, claimed once the envelope carries it.
    clock(zone, "2026-10-08", 8);
    const morning = sessionStart(a, zone, "s-told");
    expect(morning.result.notices?.[0]).toContain("quarterly estimated tax");
    deliverTurn(
      "session-start",
      morning.result,
      { hook_event_name: "SessionStart" },
      [null, null],
      { updateNotice: () => null, markUpdateNotice: () => false, claimPlain: (i, due) => a.claimPlain(i, due) },
      toHookInput({ session_id: "s-told", hook_event_name: "SessionStart", cwd: SCOPE }, { scope: SCOPE, timeZone: zone, env: {} }),
    );
    expect(a.counterpart.prospective.horizon({ at: "2026-10-08" }).items.map((i) => i.memoryId)).not.toContain(id);
    // That session's turn ends.
    clock(zone, "2026-10-08", 8.5);
    await worker(zone);
    // The turn-end after the telling re-rendered it: the telling marked the
    // wake behind (`told`), so the 8th's own wake no longer lists it either.
    expect(lane(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "", FRAMING.horizon)).toBe(null);
    // The next morning, before the 9th's first worker: not under Arriving. (It
    // is still a memory, and warm: recall finds it, and Nearby may carry it
    // dated as any memory is — not as something still to come.)
    clock(zone, "2026-10-09", 8);
    const next = sessionStart(a, zone, "s-next").text;
    expect(lane(next, FRAMING.horizon)).toBe(null);
    expect(next).not.toContain("due 2026-10-08");
  });

  test("a bundle the preface splice will not take is delivered exactly as found — untensed, its byte counts still true (review2 of #350)", () => {
    clock("America/Denver", "2026-10-09", 8);
    const a = adapter("America/Denver");
    const arriving: Ranked = { id: "mem_h0", lane: "horizon", kind: "fact", band: "semantic", strength: 0.9, protected: false, bornDay: 0, personScoped: false, lastRendered: -1 };
    const kept = { identity: [], craft: [], threads: [], hints: [], horizon: [arriving] };
    const resolve: Resolve = () => ({ statement: "The dentist appointment is at nine.", learnedOn: "2026-10-01", due: "2026-10-08" });
    const whole = compose(kept, 3, resolve).text;
    // The same bytes, an opening line the splice does not recognise: the
    // sentinel still matches, so it is read as delivered, and the preface is
    // not applied.
    const damaged = whole.replace(/^(<!-- counterparts:wake .*)elements=/, "$1elementz=");
    expect(Buffer.byteLength(damaged)).toBe(Buffer.byteLength(whole));
    expect(readSentinel(damaged).intact).toBe(true);
    a.counterpart.store.setMeta(BRIEFING_KEY, damaged);
    const woke = a.counterpart.wake(BUDGET, { date: "2026-10-09" });
    expect(woke.preface).toBe(null);
    expect(woke.text).toBe(damaged);
    expect(readSentinel(woke.text).intact).toBe(true);
    expect(woke.text).toContain("(due 2026-10-08)");
  });
});

describe("the tense, as a function", () => {
  const body = (lines: string[]): string =>
    ["<!-- counterparts:wake day=3 elements=2 bytes=1 -->", FRAMING.context, "", FRAMING.threads, "- 2026-10-01 · (due 2026-10-01) is in this statement.", "", FRAMING.horizon, ...lines, "", "<!-- counterparts:wake/end day=3 elements=2 bytes=1 -->"].join("\n");

  test("only the Arriving lane's date prefix, only a date already behind today", () => {
    const text = body([
      "- 2026-10-01 (due 2026-10-08) · Past, yesterday.",
      "- by 2026-09-03 (due 2026-10-02, every Friday) · Past, a week ago, repeating.",
      "- due 2026-10-07 · Learned and due the same day.",
      "- 2026-10-01 (due 2026-10-09) · Today: unchanged.",
      "- 2026-10-01 · No due date: unchanged, even dated in the past.",
      "- 2026-10-01 (was due 2026-10-08) · Past when composed: gains yesterday.",
      "(1 more arriving; recall ids: mem_x)",
    ]);
    const out = arrivingTense(text, "2026-10-09", 1_000);
    expect(lane(out, FRAMING.horizon)).toEqual([
      "- 2026-10-01 (was due yesterday, 2026-10-08) · Past, yesterday.",
      "- by 2026-09-03 (was due 2026-10-02, every Friday) · Past, a week ago, repeating.",
      "- was due 2026-10-07 · Learned and due the same day.",
      "- 2026-10-01 (due 2026-10-09) · Today: unchanged.",
      "- 2026-10-01 · No due date: unchanged, even dated in the past.",
      "- 2026-10-01 (was due yesterday, 2026-10-08) · Past when composed: gains yesterday.",
      "(1 more arriving; recall ids: mem_x)",
    ]);
    // Another lane's line that reads like one is not touched.
    expect(out).toContain("- 2026-10-01 · (due 2026-10-01) is in this statement.");
  });

  test("inside its room: 'was' on every line first, then 'yesterday' while room is left; none at all with no room or no date", () => {
    const text = body(["- 2026-10-01 (due 2026-10-08) · One.", "- 2026-10-01 (due 2026-10-08) · Two."]);
    expect(lane(arrivingTense(text, "2026-10-09", 8 + 11), FRAMING.horizon)).toEqual([
      "- 2026-10-01 (was due yesterday, 2026-10-08) · One.",
      "- 2026-10-01 (was due 2026-10-08) · Two.",
    ]);
    expect(lane(arrivingTense(text, "2026-10-09", 4), FRAMING.horizon)).toEqual([
      "- 2026-10-01 (was due 2026-10-08) · One.",
      "- 2026-10-01 (due 2026-10-08) · Two.",
    ]);
    expect(arrivingTense(text, "2026-10-09", 0)).toBe(text);
    expect(arrivingTense(text, "not a date", 1_000)).toBe(text);
  });

  test("the widest preface and every Arriving line turned past still fit the preface's reserve", () => {
    const worst = prefaceLine({ system: WAKE_SYSTEM, day: 999_999, date: "2026-09-04", memories: 999_999_999, liveRows: 999_999_999 });
    // The line, its newline, a digit more in each byte count, and "was " on
    // every Arriving line the lane can hold.
    const was = Buffer.byteLength("was ");
    expect(Buffer.byteLength(worst) + 1 + 2 + was * SELF_TUNABLES.HORIZON_MAX).toBeLessThanOrEqual(PREFACE_RESERVE_BYTES);
  });
});
