/**
 * Event reads keep the NEWEST rows (2026-09-28, brain-principle audit #1).
 *
 * `store.eventLog` is `ORDER BY seq ASC LIMIT ?` unless asked for `order:
 * "desc"`. Once a name held more rows than a caller's limit, an ascending read
 * handed back the OLDEST rows and the caller presented them as the latest:
 * the feed showed last month as "lately", `lastSeq` froze so the pulse stopped
 * seeing new rows, a memory's days of use lost this week, the heatmap's right
 * edge read empty. Each test below puts more rows than the caller's limit in
 * the log, with the ones that matter NEWEST, and proves they are the ones read.
 *
 * Hermetic: every store lives in a fresh temp dir removed afterwards.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { episodeGate } from "../src/core/bridge.js";
import { RETENTION_EVENT, lastRetentionRun } from "../src/core/remember/owes.js";
import { Schemas } from "../src/core/schemas/index.js";
import { JOURNAL_COPY_FAILED_EVENT, JOURNAL_COPY_WRITTEN_EVENT, standingJournalFailures } from "../src/core/self/journal-file.js";
import { SELF_PAGE_REVISED_EVENT, Self } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { renderActivity } from "../src/adapters/dashboard/activity.js";
import { contestedBeliefs } from "../src/adapters/dashboard/stories.js";
import { eventsOfNode } from "../src/adapters/dashboard/web/flow.js";
import { activityView, eventDetail } from "../src/adapters/dashboard/web/views/activity.js";
import { nodeDetail } from "../src/adapters/dashboard/web/views/flow-view.js";
import { healthView } from "../src/adapters/dashboard/web/views/health.js";
import { memoryDetail } from "../src/adapters/dashboard/web/views/memory.js";
import { pulse } from "../src/adapters/dashboard/web/views/pulse.js";
import { LOG_CEILING } from "../src/adapters/dashboard/web/views/shared.js";
import { PROMOTED_ROWS, reflectionFindings } from "../src/adapters/claude-code/doctor.js";
import {
  CONTRADICTION_HELD_EVENT,
  CONTRADICTION_SETTLED_EVENT,
  CONTRADICTION_TUNABLES,
  heldCorrections,
  heldPairs,
} from "../src/core/contradictions.js";
import { LOG_LIMIT as PAGE_LOG_LIMIT, mindView } from "../src/adapters/dashboard/web/views/mind.js";

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function memory(s: Store, body: string, day: number): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { novelty: null, relevance: 0.5, emotional: 0.2, predictive: 0.4 },
    physics: { birthDay: day, lastUsedDay: day },
  });
}

// ── the dashboard: one store with more `recall.credit` rows than LOG_CEILING ──

describe("the dashboard reads the newest rows past its ceiling", () => {
  const NEW = 3;
  let dir = "";
  let used = "";
  let today = 0;
  let newest: number[] = [];

  beforeAll(() => {
    dir = tempDir("counterparts-newest-dash-");
    const s = Store.open({ dir });
    try {
      s.advanceClock("2026-09-01");
      s.advanceClock("2026-09-02");
      today = s.livedDay();
      used = memory(s, "The harbour office keeps the tide tables.", today);
      // LOG_CEILING old rows on day 0 about some other memory, then NEW rows
      // today crediting `used`: an ascending read sees only the old ones.
      for (let i = 0; i < LOG_CEILING; i++) {
        s.appendEvent({ name: "recall.credit", day: 0, payload: { day: 0, ids: ["mem_elsewhere"] } });
      }
      for (let i = 0; i < NEW; i++) {
        newest.push(s.appendEvent({ name: "recall.credit", day: today, payload: { day: today, ids: [used] } }));
      }
    } finally {
      s.close();
    }
    expect(today).toBeGreaterThan(0);
  }, 120_000);

  function withSource<T>(fn: (src: Dashboard["source"]) => T): T {
    const dash = Dashboard.open({ dir });
    try {
      return fn(dash.source);
    } finally {
      dash.close();
    }
  }

  test("the feed lists the newest rows, its lastSeq is the newest seq, and its total is counted, not capped", () => {
    withSource((src) => {
      const v = activityView(src, { name: "recall.credit", limit: NEW });
      expect(v.events.map((e) => e.seq)).toEqual([...newest].reverse());
      expect(v.lastSeq).toBe(newest[NEW - 1]!);
      expect(v.total).toBe(LOG_CEILING + NEW);
      // The pulse polls with `sinceSeq`; a frozen lastSeq never saw a new row.
      expect(activityView(src, { sinceSeq: newest[0]! }).events.map((e) => e.seq)).toEqual(newest.slice(1));
      const p = pulse(src);
      expect(p.lastSeq).toBe(src.store.eventLog({ order: "desc", limit: 1 })[0]!.seq);
      expect(p.events).toBe(src.store.eventCounts().reduce((n, c) => n + c.count, 0));
      expect(p.events).toBeGreaterThan(LOG_CEILING);
    });
  });

  test("a newest event opens from the feed", () => {
    withSource((src) => {
      expect(eventDetail(src, newest[NEW - 1]!).found).toBe(true);
    });
  });

  test("a memory's days of use include today's", () => {
    withSource((src) => {
      expect(memoryDetail(src, used).useDays).toEqual([today]);
    });
  });

  test("the health heatmap counts today's rows", () => {
    withSource((src) => {
      const cell = healthView(src).heatmap.cells.find((c) => c.name === "recall.credit" && c.day === today);
      expect(cell?.count).toBe(NEW);
    });
  });

  test("the flow node lists the newest rows and counts them all", () => {
    withSource((src) => {
      const d = nodeDetail(src, "recall", NEW);
      const counts = new Map(src.store.eventCounts().map((c) => [c.name, c.count]));
      const all = eventsOfNode("recall").reduce((n, name) => n + (counts.get(name) ?? 0), 0);
      expect(d.recent[0]?.seq).toBe(newest[NEW - 1]!);
      expect(d.state).toBe(`${all} recorded`);
    });
  });

  test("the terminal feed prints the newest rows, of every row held", () => {
    withSource((src) => {
      const out = renderActivity(src, { name: "recall.credit", limit: NEW });
      expect(out).toContain(`day ${today}`);
      expect(out).not.toMatch(/^\s*day 0\b/m);
      expect(out).toContain(`Showing ${NEW} of ${LOG_CEILING + NEW} events I hold.`);
    });
  });
});

// ── core and doctor: cheaper, one caller each ─────────────────────────────────

describe("core and doctor reads keep the newest rows", () => {
  let dir = "";
  let s: Store;
  afterEach(() => {
    s?.close();
  });
  function fresh(prefix: string): Store {
    dir = tempDir(prefix);
    s = Store.open({ dir });
    return s;
  }

  test("page versions keep the reason of a write that came after 500 other rows", () => {
    const store = fresh("counterparts-newest-page-");
    const me = new Self({ store, gate: episodeGate() });
    const PAGE = "## Core\n\nCore: placeholder.\n\n## Lately\n\nLately: placeholder.";
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const pageId = me.page()!.id;
    for (let i = 0; i < 500; i++) store.appendEvent({ name: SELF_PAGE_REVISED_EVENT, ref: pageId, day: 0, payload: { version: 999 } });
    me.revisePage(`${PAGE}\n\nTwo.`, { reason: "second", by: "session" });
    me.revisePage(`${PAGE}\n\nThree.`, { reason: "third", by: "owner" });
    expect(me.pageVersions().map((v) => v.reason)).toEqual(["second", "first"]);
  });

  test("a belief's story keeps a challenge made after 1,000 others in the log", () => {
    const store = fresh("counterparts-newest-story-");
    const schemas = Schemas.open({ store });
    const entityId = schemas.mention({ name: "Ada", kind: "person", source: "Ada prefers async review", chunkRef: "c1", day: 0 }).id as string;
    const beliefId = schemas.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    for (let i = 0; i < 1000; i++) store.appendEvent({ name: "revision.pressure", ref: "sch_elsewhere", day: 0, payload: { targetId: "sch_elsewhere" } });
    const challenger = store.put({
      type: "memory",
      kind: "person",
      body: "Ada asked for a live walkthrough instead",
      salience: { novelty: null, relevance: 0.45, emotional: 0.45, predictive: 0.45 },
      physics: { birthDay: 1, lastUsedDay: 1 },
    });
    expect(schemas.challengeBelief({ updates: beliefId, challengerId: challenger, day: 1 }).credited).toBe(true);
    // A fresh instance has no in-memory ring: the story is the log's alone.
    expect(Schemas.open({ store }).story(beliefId).increments.length).toBe(1);
    // And the console's list of contested beliefs finds it too.
    const dash = Dashboard.open({ dir });
    try {
      expect(contestedBeliefs(dash.source).flat()).toContain(beliefId);
    } finally {
      dash.close();
    }
  });

  test("a journal copy written after 5,000 other rows mends its failure", () => {
    const store = fresh("counterparts-newest-journal-");
    store.appendEvent({ name: JOURNAL_COPY_FAILED_EVENT, ref: "epi_mended", day: 0 });
    for (let i = 0; i < 5000; i++) store.appendEvent({ name: JOURNAL_COPY_WRITTEN_EVENT, ref: `epi_${i}`, day: 0 });
    store.appendEvent({ name: JOURNAL_COPY_WRITTEN_EVENT, ref: "epi_mended", day: 0 });
    expect(standingJournalFailures(store).has("epi_mended")).toBe(false);
  });

  test("the last retention run is the newest, past 5,000 rows", () => {
    const store = fresh("counterparts-newest-retention-");
    for (let i = 0; i < 5000; i++) store.appendEvent({ name: RETENTION_EVENT, day: 0, payload: { date: "2026-01-01", reason: "PRUNED" } });
    store.appendEvent({ name: RETENTION_EVENT, day: 0, payload: { date: "2026-09-28", reason: "PRUNED" } });
    expect(lastRetentionRun(store)?.date).toBe("2026-09-28");
  });

  test("doctor counts the newest promotions, and says unknown when it could not read them all", () => {
    const store = fresh("counterparts-newest-doctor-");
    for (let i = 0; i < 500; i++) store.appendEvent({ name: "band.promoted", ref: `mem_${i}`, day: 0, payload: {} });
    store.appendEvent({ name: "band.promoted", ref: "mem_new", day: 0, payload: { reflectionOnly: true } });
    const input = { today: store.today() } as never;
    const [f] = reflectionFindings(input, store);
    expect(f?.detail).toContain("1 memory became core on reflection alone");
    expect((f?.data as Record<string, unknown>)["promotedOnReflectionAlone"]).toBe(1);

    for (let i = 0; i < PROMOTED_ROWS; i++) store.appendEvent({ name: "band.promoted", ref: `mem_more_${i}`, day: 0, payload: {} });
    const [g] = reflectionFindings(input, store);
    expect(g?.detail).toContain("how many became core on reflection alone is unknown");
    expect(g?.detail).not.toContain("became core on reflection alone;");
    expect((g?.data as Record<string, unknown>)["promotedOnReflectionAlone"]).toBeNull();
  }, 60_000);

  // 2026-10-09: the settles were read oldest first, so past the limit the
  // newest hold read as never settled.
  test("a hold settled after 5,000 other settles reads as settled; under the limit nothing changes", () => {
    const store = fresh("counterparts-newest-held-");
    const hold = (holds: string, over: string, by: string): number =>
      store.appendEvent({ name: CONTRADICTION_HELD_EVENT, ref: holds, day: 0, payload: { holds, over, how: "updates", by } });
    const settle = (holds: string, over: string): number =>
      store.appendEvent({ name: CONTRADICTION_SETTLED_EVENT, day: 0, payload: { holds, over, how: "corrected" } });
    // Under the limit: one settled after its hold, one settled BEFORE its
    // hold (not "after"), one never settled.
    settle("mem_b", "mem_b0");
    hold("mem_a", "mem_a0", "meaning");
    hold("mem_b", "mem_b0", "words");
    hold("mem_c", "mem_c0", "meaning");
    settle("mem_a", "mem_a0");
    const small = heldPairs(store).map((h) => [h.holds, h.settledAfter]);
    expect(small).toEqual([
      ["mem_c", false],
      ["mem_b", false],
      ["mem_a", true],
    ]);
    expect(heldCorrections(store)).toEqual({ held: 3, settledAfter: 1, byMeaning: 2, byWords: 1 });
    // Past it: the newest hold's settle comes after a full window of others.
    // (It is the oldest settles that fall outside the window now, as the
    // oldest holds do: mem_a's is one of them.)
    hold("mem_new", "mem_old", "meaning");
    for (let i = 0; i < CONTRADICTION_TUNABLES.HELD_READ_ROWS; i++) settle(`mem_x${i}`, `mem_y${i}`);
    settle("mem_new", "mem_old");
    expect(heldPairs(store)[0]).toMatchObject({ holds: "mem_new", over: "mem_old", settledAfter: true });
  }, 60_000);
});

// ── the self tab: the page's history past its read limit (2026-10-09) ────────

describe("the page's history dates its newest versions past the read limit", () => {
  test("the versions written after a full window of older rows keep their dates", () => {
    const dir = tempDir("counterparts-newest-history-");
    const store = Store.open({ dir });
    try {
      const me = new Self({ store, gate: episodeGate() });
      const PAGE = "## Core\n\nCore: placeholder.\n\n## Lately\n\nLately: placeholder.";
      me.revisePage(PAGE, { reason: "first", by: "owner" });
      const pageId = me.page()!.id;
      for (let i = 0; i < PAGE_LOG_LIMIT; i++) store.appendEvent({ name: SELF_PAGE_REVISED_EVENT, ref: pageId, day: 0, payload: { version: 999 } });
      me.revisePage(`${PAGE}\n\nTwo.`, { reason: "second", by: "session" });
      me.revisePage(`${PAGE}\n\nThree.`, { reason: "third", by: "owner" });
    } finally {
      store.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const history = mindView(dash.source).pageHistory;
      expect(history.map((s) => s.reason)).toEqual(["first", "second", "third"]);
      // "second" lost its date to the ascending read. The oldest version is the
      // one past the window now ("third" is the standing page, dated by it).
      expect(history.map((s) => [s.reason, s.date !== null])).toEqual([
        ["first", false],
        ["second", true],
        ["third", true],
      ]);
    } finally {
      dash.close();
    }
  }, 60_000);
});
