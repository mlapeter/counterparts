/**
 * FD1 step 2 (2026-11-07): every growing table has a named exit and a Growth
 * line, and the per-turn event rows keep `SHORT_RETENTION_DAYS` lived days,
 * rolled into one latched row a day before they go. Hermetic: a temp store per
 * test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import {
  EVENTS_ROLLED_EVENT,
  SHORT_RETENTION_DAYS,
  SHORT_RETENTION_NAMES,
  Store,
} from "../src/core/store/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { pace } from "../src/adapters/claude-code/doctor-growth.js";
import type { Finding } from "../src/adapters/claude-code/index.js";
import { run } from "../src/adapters/cli/index.js";
import { firedReport } from "../src/adapters/fired.js";
import { sourceOf } from "../src/adapters/dashboard/source.js";
import { memoryDetail } from "../src/adapters/dashboard/web/views/memory.js";
import { activityView } from "../src/adapters/dashboard/web/views/activity.js";
import { flowView } from "../src/adapters/dashboard/web/views/flow-view.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";
import { ROLLED_POSITIVE } from "../src/core/event-rollup.js";

let root: string;
let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-fd1-growth-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const o of opened.splice(0)) {
    try {
      o.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  opened.push(s);
  return s;
}

/** Calendar date `i` days after 2026-01-01. */
function date(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
}

function by(findings: readonly Finding[], key: string): Finding {
  const f = findings.find((x) => x.key === key);
  if (f === undefined) throw new Error(`no finding '${key}' in ${findings.map((x) => x.key).join(", ")}`);
  return f;
}

describe("the per-turn rows keep the short window (store)", () => {
  test("the three per-turn names are the list, at 30 lived days", () => {
    expect(SHORT_RETENTION_DAYS).toBe(30);
    expect([...SHORT_RETENTION_NAMES].sort()).toEqual(["recall.credit", "recall.decision", "recall.rated"]);
  });

  test("past 30 lived days a per-turn row goes and a rare one stays; the day is rolled up first, latched", () => {
    const s = store();
    for (let i = 0; i < 3; i++) s.appendEvent({ name: "recall.decision", day: 0 });
    s.appendEvent({ name: "recall.rated", day: 0 });
    s.appendEvent({ name: "dream.begun", day: 0 }); // rare: keeps 90
    s.appendEvent({ name: "recall.decision", day: 2 }); // inside the short window at day 31
    for (let i = 1; i <= SHORT_RETENTION_DAYS + 1; i++) s.advanceClock(date(i));
    expect(s.livedDay()).toBe(SHORT_RETENTION_DAYS + 1);

    const census = s.eventLogCensus();
    expect(census.shortRetentionDays).toBe(30);
    expect(census.shortCutoffDay).toBe(1);
    expect(census.eligible).toBe(4);

    const report = s.pruneEvents();
    expect(report.pruned).toBe(4);
    expect(report.rolled).toBe(1);
    expect(s.eventLog({ name: "recall.decision" }).map((r) => r.day)).toEqual([2]);
    expect(s.eventLog({ name: "recall.rated" })).toEqual([]);
    expect(s.eventLog({ name: "dream.begun" }).length).toBe(1);

    const rolled = s.eventLog({ name: EVENTS_ROLLED_EVENT });
    expect(rolled.length).toBe(1);
    expect(rolled[0]?.day).toBe(0);
    expect(rolled[0]?.dedup_key).toBe(`${EVENTS_ROLLED_EVENT}.0`);
    const p = JSON.parse(rolled[0]?.payload ?? "{}") as { day: number; counts: Record<string, number> };
    expect(p.day).toBe(0);
    expect(p.counts).toEqual({ "recall.decision": 3, "recall.rated": 1 });

    // A second pass writes no second roll-up, and the roll-up itself is never swept.
    expect(s.pruneEvents().rolled).toBe(0);
    for (let i = SHORT_RETENTION_DAYS + 2; i <= 100; i++) s.advanceClock(date(i));
    s.pruneEvents();
    expect(s.eventLog({ name: EVENTS_ROLLED_EVENT }).length).toBe(2); // day 0, and day 2's later
    expect(s.eventLog({ name: "dream.begun" })).toEqual([]); // past 90 now
  });

  test("a cap smaller than one day's rows still rolls up the WHOLE day before the first delete", () => {
    const s = store();
    for (let i = 0; i < 7; i++) s.appendEvent({ name: "recall.credit", day: 0 });
    for (let i = 1; i <= SHORT_RETENTION_DAYS + 1; i++) s.advanceClock(date(i));

    const first = s.pruneEvents({ limit: 3 });
    expect(first.pruned).toBe(3);
    expect(first.remaining).toBe(4);
    expect(first.rolled).toBe(1);
    const second = s.pruneEvents({ limit: 3 });
    expect(second.rolled).toBe(0); // the latch: no smaller count over the half-swept day
    const rolled = s.eventLog({ name: EVENTS_ROLLED_EVENT });
    expect(rolled.length).toBe(1);
    expect((JSON.parse(rolled[0]?.payload ?? "{}") as { counts: Record<string, number> }).counts).toEqual({ "recall.credit": 7 });
  });

  test("the short window is never longer than the store's own", () => {
    const s = store({ retentionDays: 10 });
    expect(s.eventLogCensus().shortRetentionDays).toBe(10);
  });

  test("an observer's cycle reads the census and writes no roll-up", () => {
    const w = store();
    for (let i = 0; i < 2; i++) w.appendEvent({ name: "recall.decision", day: 0 });
    for (let i = 1; i <= SHORT_RETENTION_DAYS + 1; i++) w.advanceClock(date(i));
    w.close();
    const obs = store({ observer: true });
    runCycle({ store: obs, date: date(SHORT_RETENTION_DAYS + 2) });
    expect(obs.eventLog({ name: EVENTS_ROLLED_EVENT })).toEqual([]);
    expect(obs.eventLog({ name: "recall.decision" }).length).toBe(2);
  });
});

describe("pace", () => {
  test("says which is faster, and by how much", () => {
    expect(pace(10, 4)).toBe("growing faster than it leaves (+6)");
    expect(pace(4, 10)).toBe("leaving faster than it grows (−6)");
    expect(pace(3, 3)).toBe("steady");
  });
});

describe("the Growth lines (doctor)", () => {
  test("memories, the log, cue pairs and the dream queue each get a line; the Association line counts new edges", () => {
    const s = store();
    // The window's start is read off the log: a row on the first lived day opens it.
    s.appendEvent({ name: "adapter.recall", day: 0 });
    const ids = ["one", "two", "three"].map((w) => s.put({ type: "memory", kind: "fact", body: `growth memory ${w}` }));
    const day = s.livedDay();
    s.linkMany([{ src: ids[0] as string, dst: ids[1] as string, weight: 0.4, day }]);
    s.appendEvent({ name: "dream.begun", ref: "drm_a", day, payload: { queue: 40, shown: 10, waiting: 30, agedOut: 0 } });
    s.advanceClock(date(1));
    const d1 = s.livedDay();
    s.appendEvent({ name: "dream.begun", ref: "drm_b", day: d1, payload: { queue: 45, shown: 10, waiting: 35, agedOut: 2 } });
    s.appendEvent({ name: "associate.flush", day: d1, payload: { reason: "flushed", swept: 3, cueSwept: 2 } });
    s.appendEvent({ name: "sleep.log.swept", day: d1, payload: { count: 12, remaining: 0, rolled: 1 } });
    s.appendEvent({
      name: "sleep.cycle",
      day: d1,
      payload: { pruned: 2, merged: 1, faded: 0, phases: [{ phase: "prune", status: "ran", budgetExhausted: true, skippedForBudget: 2_500 }] },
    });
    const input = {
      configPath: join(root, "none.json"),
      configReason: "loaded" as const,
      config: { dataDir: dir, embedder: { enabled: false } },
      dir,
      store: s,
      today: date(1),
      refusals: {},
    };
    const f = doctorFindings(input);

    const mem = by(f, "growth-memories");
    expect(mem.severity).toBe("green");
    expect(mem.data["live"]).toBe(3);
    expect(mem.data["born"]).toBe(3);
    expect(mem.data["pruned"]).toBe(2);
    expect(mem.data["merged"]).toBe(1);
    expect(mem.data["pruneLapNights"]).toBe(4); // (1,000 + 2,500) / 1,000, up
    expect(mem.detail).toContain("one lap of the store takes ~4 nights");
    expect(mem.detail).toContain("journal 0 (no exit, by contract)");

    const ev = by(f, "growth-events");
    expect(ev.data["swept"]).toBe(12);
    expect(ev.data["shortRetentionDays"]).toBe(30);
    expect(ev.data["count:recall.decision"]).toBeUndefined();
    expect(ev.detail).toContain("keep 30 lived days");
    expect(typeof ev.data["bytes"]).toBe("number");

    const cues = by(f, "growth-cues");
    expect(cues.data["swept"]).toBe(2);

    const q = by(f, "growth-queue");
    expect(q.data["queue"]).toBe(45);
    expect(q.data["nights"]).toBe(2);
    // Between the two: night a's 10 shown and night b's 2 aged out left; 45 − 40 + 12 came in.
    expect(q.data["cameIn"]).toBe(17);
    expect(q.detail).toContain("growing faster than it leaves (+5)");

    const assoc = by(f, "association");
    expect(assoc.data["edgesRecent"]).toBe(1);
    expect(assoc.data["edgesSwept"]).toBe(3);
  });

  test("not in the session-start reading (a budget): the memories line walks every row", () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "a memory" });
    const f = doctorFindings({
      configPath: join(root, "none.json"),
      configReason: "loaded",
      config: { dataDir: dir, embedder: { enabled: false } },
      dir,
      store: s,
      today: date(0),
      refusals: {},
      budgetMs: 60_000,
    });
    expect(f.some((x) => x.key.startsWith("growth-"))).toBe(false);
  });
});

describe("the real path: nights through Counterpart.sessionEnd, then `counterparts doctor --json`", () => {
  test("a month of nights sweeps the per-turn rows, rolls them up, and the doctor says so", async () => {
    const c = Counterpart.open({ dir });
    opened.push(c);
    c.store.appendEvent({ name: "recall.decision", day: 0, payload: { n: 1 } });
    c.store.appendEvent({ name: "recall.decision", day: 0, payload: { n: 2 } });
    c.store.appendEvent({ name: "recall.rated", day: 0, payload: { rating: 2 } });
    c.store.appendEvent({ name: "adapter.recall", day: 0 }); // not a short name: stays
    for (let i = 1; i <= SHORT_RETENTION_DAYS + 2; i++) await c.sessionEnd({ date: date(i) });
    expect(c.store.livedDay()).toBeGreaterThan(SHORT_RETENTION_DAYS);

    expect(c.store.eventLog({ name: "recall.decision", sinceDay: 0 }).filter((r) => r.day === 0)).toEqual([]);
    expect(c.store.eventLog({ name: "recall.rated" }).filter((r) => r.day === 0)).toEqual([]);
    expect(c.store.eventLog({ name: "adapter.recall" }).filter((r) => r.day === 0).length).toBe(1);
    const rolled = c.store.eventLog({ name: EVENTS_ROLLED_EVENT }).find((r) => r.day === 0);
    expect(rolled).toBeDefined();
    expect((JSON.parse(rolled?.payload ?? "{}") as { counts: Record<string, number> }).counts).toEqual({
      "recall.decision": 2,
      "recall.rated": 1,
    });
    // The sweep left a durable record of itself.
    const swept = c.store.eventLog({ name: "sleep.log.swept" });
    expect(swept.length).toBeGreaterThan(0);
    expect(swept.some((r) => (JSON.parse(r.payload ?? "{}") as { rolled?: number }).rolled === 1)).toBe(true);
    c.close();

    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, embedder: { enabled: false } }));
    chmodSync(configPath, 0o600);
    const out: string[] = [];
    await run(["doctor", `--config=${configPath}`, "--json"], {
      io: { out: (l) => out.push(l), err: () => {} },
      env: {},
      home: root,
    });
    const json = JSON.parse(out.join("\n")) as { findings: { key: string; data: Record<string, unknown> }[] };
    const ev = json.findings.find((x) => x.key === "growth-events");
    expect(ev).toBeDefined();
    expect(ev?.data[`count:${EVENTS_ROLLED_EVENT}`]).toBeGreaterThanOrEqual(1);
    expect(ev?.data["shortRetentionDays"]).toBe(30);
    expect(json.findings.some((x) => x.key === "growth-memories")).toBe(true);
  }, 60_000);
});

describe("all-time counts don't shrink when the sweep lets the per-turn rows go (roadmap ruling R2)", () => {
  test("dashboard counts, mechanisms' total and last fired, probe-oq4, days used and sessions seen: the same before, half-way and after", async () => {
    const c = Counterpart.open({ dir });
    opened.push(c);
    const mem = c.store.put({ type: "memory", kind: "fact", body: "a memory credited for use" });
    // Five early lived days of per-turn rows, each with its calendar date and session.
    for (let d = 0; d < 5; d++) {
      const on = date(d);
      const session = `sess-${String(d)}`;
      for (let t = 0; t < 3; t++) {
        c.store.appendEvent({
          name: "recall.decision",
          day: d,
          ref: session,
          payload: { session, date: on, footnotes: [{ id: mem }], surfaced: [], ...(t === 0 ? { moodMatched: 1 } : {}) },
        });
      }
      c.store.appendEvent({
        name: "recall.credit",
        day: d,
        ref: session,
        payload: { session, date: on, day: d, ids: d % 2 === 0 ? [mem] : [], expandedIds: d % 2 === 0 ? [mem] : [] },
      });
      c.store.appendEvent({ name: "recall.rated", day: d, ref: session, payload: { session, date: on, ratings: [{ id: mem, score: 2, lane: "footnotes" }] } });
      if (d < 4) c.store.advanceClock(date(d + 1));
    }
    for (let i = 5; i <= SHORT_RETENTION_DAYS + 6; i++) c.store.advanceClock(date(i));
    expect(c.store.livedDay()).toBeGreaterThan(SHORT_RETENTION_DAYS + 4);

    const today = date(SHORT_RETENTION_DAYS + 6);
    const ids = ["recall-decision", "credit", "rated", "mood-match"];
    // Every reading through an observer, as the dashboard and the console open the store.
    const reading = async (): Promise<unknown> => {
      const o = Counterpart.open({ dir, observer: true });
      try {
        const src = sourceOf(o);
        const counts = Object.fromEntries(
          o.store.eventCountsAllTime().filter((x) => SHORT_RETENTION_NAMES.includes(x.name)).map((x) => [x.name, x.count]),
        );
        const fired = firedReport(o.store, today).rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.total, r.lastFired]);
        const out: string[] = [];
        await run(["probe-oq4", "--dir", dir], { io: { out: (l) => out.push(l), err: () => {} }, env: {} });
        const useDays = memoryDetail(src, mem).useDays;
        const vocabulary = activityView(src).vocabulary.filter((v) => SHORT_RETENTION_NAMES.includes(v.name)).map((v) => [v.name, v.count]);
        const sessionsSeen = flowView(src).nodes.find((n) => n.key === "session")?.state;
        return { counts, fired, probe: out, useDays, vocabulary, sessionsSeen };
      } finally {
        o.close();
      }
    };
    const before = (await reading()) as { counts: Record<string, number>; useDays: number[]; fired: unknown[][] };
    expect(before.counts).toEqual({ "recall.credit": 5, "recall.decision": 15, "recall.rated": 5 });
    expect(before.useDays).toEqual([0, 2, 4]);
    expect(before.fired.find((f) => f[0] === "mood-match")?.[1]).toBe(5);
    expect((before as unknown as { probe: string[] }).probe.join("\n")).toContain("rows: 15 recall.decision, 5 recall.credit");
    expect((before as unknown as { sessionsSeen: string }).sessionsSeen).toBe("5 sessions seen");

    // Half-way: a cap smaller than the backlog leaves rolled days partly held.
    const half = c.store.pruneEvents({ limit: 7 });
    expect(half.rolled).toBe(5);
    expect(half.remaining).toBeGreaterThan(0);
    expect(await reading()).toEqual(before);

    c.store.pruneEvents();
    expect(c.store.eventLog({ name: "recall.decision" })).toEqual([]);
    expect(await reading()).toEqual(before);
  }, 60_000);

  test("the summary's filtered fields cover the filtered mechanisms (fired.ts `positive`)", () => {
    // `mood-match` is the one filtered mechanism on a per-turn name today.
    expect(ROLLED_POSITIVE["recall.decision"]).toContain("moodMatched");
  });

  test("the owner's removal takes a removed memory's id out of the daily summaries", () => {
    const s = store();
    const mem = s.put({ type: "memory", kind: "fact", body: "a memory the owner removes" });
    s.appendEvent({ name: "recall.credit", day: 0, payload: { session: "s", ids: [mem] } });
    for (let i = 1; i <= SHORT_RETENTION_DAYS + 1; i++) s.advanceClock(date(i));
    s.pruneEvents();
    expect(s.eventLog({ name: EVENTS_ROLLED_EVENT })[0]?.payload ?? "").toContain(mem);
    s.appendRemovalRecord({ memoryId: mem, stage: "requested", actor: "owner", reason: "test" });
    s.appendRemovalRecord({ memoryId: mem, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(s, mem);
    const after = s.eventLog({ name: EVENTS_ROLLED_EVENT })[0]?.payload ?? "";
    expect(after).not.toContain(mem);
    expect((JSON.parse(after) as { counts: Record<string, number> }).counts).toEqual({ "recall.credit": 1 });
  });
});

describe("recall_turns has an exit (roadmap ruling R1)", () => {
  test("turns older than the short window go with the night's log sweep; recent ones stay", () => {
    const s = store();
    s.recordRecallTurn({ sessionId: "old", turn: 1, day: 0, candidates: 10, shown: ["mem_a"] });
    for (let i = 1; i <= SHORT_RETENTION_DAYS + 1; i++) s.advanceClock(date(i));
    s.recordRecallTurn({ sessionId: "new", turn: 1, day: s.livedDay(), candidates: 4, shown: [] });
    runCycle({ store: s, date: date(SHORT_RETENTION_DAYS + 2) });
    expect(s.recallTurns().map((t) => t.session_id)).toEqual(["new"]);
    const swept = s.eventLog({ name: "sleep.log.swept" }).map((r) => JSON.parse(r.payload ?? "{}") as { recallTurns?: number });
    expect(swept.some((p) => p.recallTurns === 1)).toBe(true);
  });
});
