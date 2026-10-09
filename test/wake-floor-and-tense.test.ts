/**
 * TWO WAKE LINES THE OWNER READ ON 2026-10-09, through the real wake path.
 *
 * 1. "Still open:" over no item at all, then "(20 more still open; recall ids
 *    (the first 5): …)". The page is furniture the trim cannot pop, and it was
 *    cut to leave room for the wake's other furniture and nothing else; the
 *    Yesterday line and Arriving (which trims after "Still open") took what was
 *    left, and the room that remained held the lane's "more" line but not one
 *    open item. Now a long page leaves room for the lines beside it
 *    (`self/briefing.ts#besidePageBytes`, `THREADS_FLOOR_BYTES`), and a lane
 *    that still lists nothing is ONE line with its heading inside it
 *    (`collapsedLine`) — never a heading over a count.
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
import {
  BRIEFING_KEY,
  COLLAPSED_WORDS,
  FRAMING,
  PREFACE_RESERVE_BYTES,
  SELF_TUNABLES,
  arrivingTense,
  collapsedLane,
  collapsedLine,
  prefaceLine,
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

/** A long page, about 7 KB — longer than the wake's page cap at 9,000. */
function longPage(a: ReturnType<typeof openAdapter>): void {
  const para = "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess. ";
  let page = "";
  while (Buffer.byteLength(page) < 7_000) page += `${para.repeat(4)}\n\n`;
  expect(a.counterpart.revisePage(page, { by: "owner", reason: "a long page" }).written).toBe(true);
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

describe("Still open keeps its first lines beside a long page (2026-10-09)", () => {
  for (const zone of ZONES) {
    test(`${zone}: 25 open items, a 7 KB page, Yesterday, two Arriving lines and this directory's work, at the 9,000-byte default — open items listed, never a heading over a count`, async () => {
      clock(zone, "2026-10-07", 20);
      const a = adapter(zone);
      chapters(a, "2026-10-07");
      await worker(zone);
      clock(zone, "2026-10-08", 21);
      const ids = openQuestions(a);
      longPage(a);
      work(a);
      reminder(a, "2026-10-08", "The dentist appointment is at nine and the forms are in the blue folder.");
      reminder(a, "2026-10-10", "Rosa's surgery is on the tenth; send a note the evening before.");
      await worker(zone);

      clock(zone, "2026-10-09", 8);
      const { text } = sessionStart(a, zone, "s-morning");
      expect(readSentinel(text).intact).toBe(true);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(BUDGET);
      // The squeeze is real: the delivery reserves took ~1.8 KB of the 9,000,
      // the page was cut, the Yesterday line and both Arriving lines are there,
      // and this directory's work and handoffs rode at the foot. Before the fix
      // this wake read "Still open:" over "(25 more still open; …)" alone.
      const rows = a.counterpart.store.eventLog({ name: "self.briefing" });
      const composed = JSON.parse(rows[rows.length - 1]?.payload ?? "{}") as { budget?: number };
      expect(composed.budget).toBeLessThan(7_400);
      expect(text).toContain("the wake shows the first");
      expect(text).toContain("Yesterday, 10-07: ");
      expect(lane(text, FRAMING.horizon)?.length).toBe(2);
      expect(text).toContain("Work here, if it helps:");
      expect(text).toContain("Where the work in this directory was left off");
      // AND STILL OPEN LISTS ITEMS: at least two of the 25, and a count, when
      // there is room for one, says how many more.
      const open = lane(text, FRAMING.threads) ?? [];
      const listed = open.filter((l) => l.startsWith("- "));
      expect(listed.length).toBeGreaterThanOrEqual(2);
      expect(open[0]?.startsWith("- ")).toBe(true);
      const bodies = ids.map((id) => a.counterpart.store.readProse(id).body);
      for (const line of listed) expect(bodies).toContain(line.slice(line.indexOf(" · ") + 3));
      const rest = open.find((l) => l.startsWith("("));
      if (rest !== undefined) expect(rest).toStartWith(`(${String(25 - listed.length)} more still open; `);
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
