/**
 * `rated` (2026-10-14; Mike's call, TRACKING ONLY, lightly held) — the session
 * scores the memories it was shown, 0–3, on `session_end`, so every footnote
 * gets a feedback signal. One `recall.rated` row per call and nothing else:
 * no strength, ranking, credit, decay or link moves.
 *
 * Hermetic: every store is a fresh temp dir, removed after; an unnamed store
 * refuses (`COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, RECALL_RATED_EVENT } from "../src/core/counterpart.js";
import { RATING_ANCHORS, freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { probeRatings, renderRatings } from "../src/core/recall/probe.js";
import type { ProbeRow } from "../src/core/recall/probe.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { RATE_ASK_CLAUSE, desktopWriteUpAsk } from "../src/adapters/mcp/server-words.js";
import { RATE_CLAUSE, stopAsk } from "../src/adapters/claude-code/hooks.js";
import { TOOLS } from "../src/adapters/mcp/tools.js";
import { probeCommand } from "../src/adapters/cli/commands-readings.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const EXPLICIT = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
let dir: string;
let priorEnv: string | undefined;
let priorExplicit: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorExplicit = process.env[EXPLICIT];
  dir = mkdtempSync(join(tmpdir(), "counterparts-rated-"));
  process.env[ENV] = dir;
  process.env[EXPLICIT] = "1";
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  if (priorExplicit === undefined) delete process.env[EXPLICIT];
  else process.env[EXPLICIT] = priorExplicit;
  rmSync(dir, { recursive: true, force: true });
});

function brain(opts: { observer?: boolean } = {}): Counterpart {
  const c = Counterpart.open({ dir, owner: true, ...(opts.observer === true ? { observer: true } : {}) });
  open.push(c);
  return c;
}

function fact(c: Counterpart, title: string): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    title,
    body: `${title}, in more words.`,
    salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
  });
}

type Showing = { id: string; tier?: "surfaced" | "footnoted"; via?: "link" };

/** Record showings to `sessionId` on `turn`, as recall's own save would. */
function shown(c: Counterpart, sessionId: string, turn: number, list: readonly (string | Showing)[]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const s of list) {
    const e = typeof s === "string" ? { id: s } : s;
    surfaced[e.id] = { turn, tier: e.tier ?? "footnoted", trains: true, ...(e.via === undefined ? {} : { via: e.via }) };
  }
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

function setup(n = 3): { c: Counterpart; ids: string[] } {
  const c = brain();
  c.store.advanceClock("2026-08-25");
  const ids = Array.from({ length: n }, (_, i) => fact(c, `Orchard note ${String(i)}: the ladder and the rung`));
  c.store.advanceClock("2026-08-26");
  return { c, ids };
}

function ratedRows(c: Counterpart): Record<string, unknown>[] {
  return c.store.eventLog({ name: RECALL_RATED_EVENT, limit: 50 }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

/** Everything a credit, a decay or a link could have moved, for each id. */
function snapshot(c: Counterpart, sessionId: string, ids: readonly string[]): string {
  return JSON.stringify({
    rows: ids.map((id) => c.store.row(id)),
    returns: ids.map((id) => c.store.returnsOf(id)),
    edges: ids.map((id) => c.store.edgesFrom(id)),
    credited: loadGateState(c.store, sessionId).state.credited,
  });
}

// ── the core seam ────────────────────────────────────────────────────────────

describe("Counterpart#rateShown — tracking only", () => {
  test("the anchors are the agreed four", () => {
    expect(RATING_ANCHORS).toEqual({
      0: "noise (unrelated)",
      1: "on topic but I didn't need it",
      2: "useful background",
      3: "changed what I did or said",
    });
  });

  test("valid ratings are stored with their lanes and the drewOn flag, and one row says so", () => {
    const { c, ids } = setup(5);
    const [foot, loud, ptr, asked, opened] = ids as [string, string, string, string, string];
    shown(c, "s1", 1, [foot, { id: loud, tier: "surfaced" }, { id: ptr, via: "link" }]);
    c.noteAsked("s1", [asked]);
    const r = c.rateShown(
      "s1",
      [
        { id: foot, score: 3 },
        { id: loud, score: 0 },
        { id: ptr, score: 1 },
        { id: asked, score: 2 },
        { id: opened, score: 2 },
      ],
      { opened: [opened], drewOn: [foot], at: "2026-08-26" },
    );
    expect(r.refused).toEqual([]);
    expect(r.recorded).toBe(true);
    expect(r.rated).toEqual([
      { id: foot, score: 3, lane: "footnotes", drewOn: true },
      { id: loud, score: 0, lane: "loud", drewOn: false },
      { id: ptr, score: 1, lane: "pointers", drewOn: false },
      { id: asked, score: 2, lane: "asked", drewOn: false },
      { id: opened, score: 2, lane: "opened", drewOn: false },
    ]);
    const rows = ratedRows(c);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      session: "s1",
      date: "2026-08-26",
      day: c.store.livedDay(),
      turn: 1,
      since: 0,
      ratingsTotal: 5,
      refused: {},
      // Loud lines show no id: rateable, not counted in coverage (review of #492).
      coverage: { shown: { footnotes: 1, pointers: 1 }, rated: { footnotes: 1, pointers: 1 } },
      drewOnNamed: 1,
      drewOnUnrated: [],
    });
    expect((rows[0]?.["ratings"] as unknown[]).length).toBe(5);
    // The row is filed under the session.
    expect(c.store.eventLog({ name: RECALL_RATED_EVENT, ref: "s1" }).length).toBe(1);
  });

  test("an id shown in two ways is filed under the ambient lane first", () => {
    const { c, ids } = setup(1);
    const [a] = ids as [string];
    shown(c, "s1", 1, [a]);
    c.noteAsked("s1", [a]);
    expect(c.rateShown("s1", [{ id: a, score: 2 }], { opened: [a] }).rated[0]?.lane).toBe("footnotes");
  });

  test("an id this session was not shown is refused not-shown; bad scores and missing ids are refused by name; siblings count", () => {
    const { c, ids } = setup(3);
    const [a, b, other] = ids as [string, string, string];
    shown(c, "s1", 1, [a, b]);
    // Shown to ANOTHER session is not shown to this one.
    shown(c, "s2", 1, [other]);
    const r = c.rateShown("s1", [
      { id: other, score: 2 },
      { id: a, score: 4 },
      { id: a, score: -1 },
      { id: a, score: 1.5 },
      { id: a, score: "3" },
      { score: 2 },
      "not an object",
      { id: b, score: 2 },
    ]);
    expect(r.rated).toEqual([{ id: b, score: 2, lane: "footnotes", drewOn: false }]);
    expect(r.refused).toEqual([
      { id: other, index: 0, reason: "not-shown" },
      { id: a, index: 1, reason: "score-out-of-range" },
      { id: a, index: 2, reason: "score-out-of-range" },
      { id: a, index: 3, reason: "score-not-an-integer" },
      { id: a, index: 4, reason: "score-not-an-integer" },
      { id: "", index: 5, reason: "id-not-a-string" },
      { id: "", index: 6, reason: "id-not-a-string" },
    ]);
    expect(ratedRows(c)[0]?.["refused"]).toEqual({ "not-shown": 1, "score-out-of-range": 2, "score-not-an-integer": 2, "id-not-a-string": 2 });
  });

  test("rated twice in one call: the last valid score counts, kept where it was first given", () => {
    const { c, ids } = setup(2);
    const [a, b] = ids as [string, string];
    shown(c, "s1", 1, [a, b]);
    const r = c.rateShown("s1", [
      { id: a, score: 1 },
      { id: b, score: 0 },
      { id: a, score: 3 },
      { id: a, score: 9 },
    ]);
    expect(r.rated.map((x) => [x.id, x.score])).toEqual([
      [a, 3],
      [b, 0],
    ]);
    expect(r.replaced).toEqual([a]);
    expect(r.refused).toEqual([{ id: a, index: 3, reason: "score-out-of-range" }]);
  });

  test("a rating changes nothing about the memory: strength, uses, returns, links and credit stay put", () => {
    const { c, ids } = setup(3);
    shown(c, "s1", 1, ids);
    const before = snapshot(c, "s1", ids);
    const r = c.rateShown(
      "s1",
      ids.map((id) => ({ id, score: 3 })),
      { drewOn: ids },
    );
    expect(r.rated.length).toBe(3);
    expect(snapshot(c, "s1", ids)).toBe(before);
    for (const id of ids) {
      expect(c.store.row(id)?.uses).toBe(0);
      expect(c.store.returnsOf(id)).toEqual([]);
    }
  });

  test("an id credited as drawn on at this boundary (by `chapter`) is flagged even when this call did not name it", () => {
    const { c, ids } = setup(2);
    const [a, b] = ids as [string, string];
    shown(c, "s1", 1, [a, b]);
    expect(c.creditDrewOn("s1", [a]).credited).toEqual([a]);
    const r = c.rateShown("s1", [
      { id: a, score: 3 },
      { id: b, score: 1 },
    ]);
    expect(r.rated.map((x) => x.drewOn)).toEqual([true, false]);
    // Named in drewOn and not rated is recorded too.
    const r2 = c.rateShown("s1", [{ id: b, score: 1 }], { drewOn: [a] });
    expect(r2.drewOnUnrated).toEqual([a]);
    expect(ratedRows(c)[1]?.["drewOnUnrated"]).toEqual([a]);
  });

  test("coverage counts the ambient showings since the session's previous rating", () => {
    const { c, ids } = setup(5);
    const [a, b, d, e, f] = ids as [string, string, string, string, string];
    shown(c, "s1", 1, [a, b]);
    shown(c, "s1", 2, [d]);
    c.noteAsked("s1", [f]);
    const first = c.rateShown("s1", [
      { id: a, score: 2 },
      { id: f, score: 1 },
    ]);
    // Three ambient showings since the start; one rated. The asked one is rateable, not counted.
    expect(first.coverage).toEqual({ shown: 3, rated: 1 });
    shown(c, "s1", 3, [e]);
    const second = c.rateShown("s1", [
      { id: e, score: 0 },
      { id: b, score: 1 },
    ]);
    // Only the turn-3 showing is new since the first rating; the late rating of b counts as rated, not as covered.
    expect(second.coverage).toEqual({ shown: 1, rated: 1 });
    expect(ratedRows(c)[1]).toMatchObject({ since: 2, turn: 3 });
  });

  test("review of #492: a call whose every entry is refused writes no row and moves no coverage window", () => {
    const { c, ids } = setup(2);
    const [a, b] = ids as [string, string];
    shown(c, "s1", 1, [a]);
    const none = c.rateShown("s1", [{ id: "mem_000000000000", score: 2 }, { id: a, score: 5 }]);
    expect(none.rated).toEqual([]);
    expect(none.recorded).toBe(false);
    expect(ratedRows(c)).toEqual([]);
    shown(c, "s1", 2, [b]);
    // Both showings still count: the refused call did not advance the floor.
    expect(c.rateShown("s1", [{ id: a, score: 1 }]).coverage).toEqual({ shown: 2, rated: 1 });
    expect(ratedRows(c)[0]).toMatchObject({ since: 0, turn: 2 });
  });

  test("under observer stance nothing is written and every entry is refused `observer`", () => {
    const { c, ids } = setup(1);
    const [a] = ids as [string];
    shown(c, "s1", 1, [a]);
    c.close();
    open.splice(0);
    const watcher = brain({ observer: true });
    const r = watcher.rateShown("s1", [{ id: a, score: 2 }, { score: 1 }]);
    expect(r.rated).toEqual([]);
    expect(r.refused).toEqual([
      { id: a, index: 0, reason: "observer" },
      { id: "", index: 1, reason: "observer" },
    ]);
    expect(r.recorded).toBe(false);
    expect(ratedRows(watcher)).toEqual([]);
  });
});

// ── the tool ─────────────────────────────────────────────────────────────────

const SESSION = "sess_rated_1";

function server(opts: { observer?: boolean } = {}): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/rated", owner: true, ...(opts.observer === true ? { observer: true } : {}) });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

function seeded(s: McpServer, n = 3): string[] {
  const c = s.counterpart;
  c.store.advanceClock("2026-08-25");
  const ids = Array.from({ length: n }, (_, i) => fact(c, `Fruit tree ${String(i)} by the gate`));
  c.store.advanceClock("2026-08-26");
  return ids;
}

describe("the rated field on session_end", () => {
  test("rides out beside the answer; a memory opened by id through recall can be rated", async () => {
    const s = server();
    const [foot, openedId, never] = seeded(s) as [string, string, string];
    shown(s.counterpart, SESSION, 1, [foot]);
    // Opened by id: not a footnote, not asked — the server handed it over.
    const got = payload(await s.call("recall", { ids: [openedId] }));
    expect((got["memories"] as { id: string }[]).map((m) => m.id)).toEqual([openedId]);
    const before = snapshot(s.counterpart, SESSION, [foot, openedId]);
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [],
        drewOn: [foot],
        rated: [
          { id: foot, score: 3 },
          { id: openedId, score: 1 },
          { id: never, score: 2 },
        ],
      }),
    );
    expect(out["reason"]).toBe("nothing-new");
    const rated = out["rated"] as Record<string, unknown>;
    expect(rated["rated"]).toBe(2);
    expect(rated["refused"]).toEqual([{ id: never, reason: "not-shown" }]);
    expect(rated["coverage"]).toBe("1 of 1 footnotes shown since you last rated");
    const row = ratedRows(s.counterpart)[0];
    expect(row?.["ratings"]).toEqual([
      { id: foot, score: 3, lane: "footnotes", drewOn: true },
      { id: openedId, score: 1, lane: "opened", drewOn: false },
    ]);
    // drewOn still credited (its own rules); the ratings added nothing on top.
    expect((out["drewOn"] as Record<string, unknown>)["credited"]).toEqual([foot]);
    expect(s.counterpart.store.row(foot)?.uses).toBe(0.5);
    expect(s.counterpart.store.row(openedId)?.uses).toBe(JSON.parse(before).rows[1].uses);
    // The reader's `opened` lane rests on the row the recall tool wrote: tie the two halves.
    const lookups = s.counterpart.store.eventLog({ name: "mcp.recall" }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(lookups).toEqual([expect.objectContaining({ session: SESSION, path: "handle", ids: [openedId] })]);
    s.counterpart.close();
    open.splice(0);
    const lines: string[] = [];
    expect(probeCommand(dir, { out: (l) => lines.push(l), err: () => {} }, true)).toBe(0);
    expect(lines.some((l) => /^total\s+opened\s+1\s+1\s+100\.0%/.test(l))).toBe(true);
  });

  test("with memories, a refused rating never fails the deposit", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    shown(s.counterpart, SESSION, 1, [a]);
    const result = await s.call("session_end", {
      session: SESSION,
      memories: [{ content: "The fruit tree by the gate needs netting before the birds find it." }],
      rated: [{ id: a, score: 7 }],
    });
    const out = payload(result);
    expect(out["deposited"]).toBe(1);
    expect(result.isError === true).toBe(false);
    expect((out["rated"] as Record<string, unknown>)["refused"]).toEqual([{ id: a, reason: "score-out-of-range" }]);
  });

  test("not a list: rates nothing and says so; left out or empty: no field and no row", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    shown(s.counterpart, SESSION, 1, [a]);
    const bad = payload(await s.call("session_end", { session: SESSION, memories: [], rated: { id: a, score: 2 } }));
    expect((bad["rated"] as Record<string, unknown>)["reason"]).toBe("rated-malformed");
    const none = payload(await s.call("session_end", { session: SESSION, memories: [] }));
    expect(none["rated"]).toBeUndefined();
    const empty = payload(await s.call("session_end", { session: SESSION, memories: [], rated: [] }));
    expect(empty["rated"]).toBeUndefined();
    expect(ratedRows(s.counterpart)).toEqual([]);
  });

  test("under observer stance the tool stands down and nothing is recorded", async () => {
    const owner = server();
    const [a] = seeded(owner) as [string];
    shown(owner.counterpart, SESSION, 1, [a]);
    const watcher = server({ observer: true });
    await watcher.call("session_end", { session: SESSION, memories: [], rated: [{ id: a, score: 2 }] });
    expect(ratedRows(owner.counterpart)).toEqual([]);
  });

  test("review of #492: only a drewOn id CREDITED at this boundary marks a rating; a refused id or a malformed field marks nothing", async () => {
    const s = server();
    const [foot, openedId] = seeded(s) as [string, string];
    shown(s.counterpart, SESSION, 1, [foot]);
    await s.call("recall", { ids: [openedId] });
    // drewOn refuses an id opened by id (`not-shown`), so naming it there marks nothing.
    const refused = payload(
      await s.call("session_end", { session: SESSION, memories: [], drewOn: [openedId], rated: [{ id: openedId, score: 3 }] }),
    );
    expect(((refused["drewOn"] as Record<string, unknown>)["refused"] as { reason: string }[])[0]?.reason).toBe("not-shown");
    expect(ratedRows(s.counterpart)[0]?.["ratings"]).toEqual([{ id: openedId, score: 3, lane: "opened", drewOn: false }]);
    expect(ratedRows(s.counterpart)[0]?.["drewOnUnrated"]).toEqual([]);
    // A malformed drewOn field marks nothing either.
    await s.call("session_end", { session: SESSION, memories: [], drewOn: foot, rated: [{ id: foot, score: 2 }] });
    expect(ratedRows(s.counterpart)[1]?.["ratings"]).toEqual([{ id: foot, score: 2, lane: "footnotes", drewOn: false }]);
  });

  test("review of #492: if rating throws, session_end still lands and says so", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    shown(s.counterpart, SESSION, 1, [a]);
    (s.counterpart as unknown as { rateShown: () => never }).rateShown = () => {
      throw new Error("rating store unavailable");
    };
    const result = await s.call("session_end", {
      session: SESSION,
      memories: [{ content: "The gate's fruit tree is a quince, not a pear." }],
      rated: [{ id: a, score: 2 }],
    });
    const out = payload(result);
    expect(result.isError === true).toBe(false);
    expect(out["deposited"]).toBe(1);
    expect(out["rated"]).toEqual({ rated: 0, reason: "threw", detail: "rating store unavailable" });
    // And with nothing new, the answer is still recorded.
    const empty = payload(await s.call("session_end", { session: SESSION, memories: [], rated: [{ id: a, score: 2 }] }));
    expect(empty["reason"]).toBe("nothing-new");
    expect((empty["rated"] as Record<string, unknown>)["reason"]).toBe("threw");
  });

  test("the field is served with its anchors", () => {
    const spec = TOOLS.find((t) => t.name === "session_end");
    const props = (spec?.inputSchema as { properties: Record<string, { description?: string; items?: unknown }> }).properties;
    const d = props["rated"]?.description ?? "";
    for (const words of Object.values(RATING_ANCHORS)) expect(d).toContain(words);
    expect(d).toContain("the last score counts");
    expect(d).toContain("Tracking only");
  });
});

// ── the asks ─────────────────────────────────────────────────────────────────

describe("the asks carry one short clause", () => {
  test("the Stop ask and the Desktop write-up ask say the same words; no ids listed", () => {
    expect(RATE_CLAUSE).toBe(RATE_ASK_CLAUSE);
    expect(stopAsk("s1", 2)).toContain(RATE_CLAUSE);
    expect(desktopWriteUpAsk("s1")).toContain(RATE_ASK_CLAUSE);
    expect(stopAsk("s1", 2)).not.toContain("mem_");
    expect(RATE_CLAUSE.length).toBeLessThanOrEqual(80);
  });
});

// ── the reader ───────────────────────────────────────────────────────────────

function row(name: string, p: Record<string, unknown>): ProbeRow {
  return { name, day: 0, payload: JSON.stringify(p) };
}

describe("probeRatings (pure)", () => {
  test("per day and lane: shown, rated, coverage, scores, drewOn and used agreement", () => {
    const rows: ProbeRow[] = [
      row("recall.decision", { session: "s1", date: "2026-10-14", turn: 1, surfaced: ["mem_loud"], footnotes: [{ id: "mem_f1" }, { id: "mem_f2" }, { id: "mem_p", via: "link" }] }),
      row("mcp.recall", { session: "s1", path: "question", ids: ["mem_q"] }),
      row("mcp.recall", { session: "s1", path: "handle", ids: ["mem_o"] }),
      row("recall.credit", { session: "s1", date: "2026-10-14", judgedThrough: 1, shownNotUsed: ["mem_f2", "mem_p", "mem_loud"] }),
      row("recall.rated", {
        session: "s1",
        date: "2026-10-14",
        ratings: [
          { id: "mem_f1", score: 3, lane: "footnotes", drewOn: true },
          { id: "mem_f2", score: 0, lane: "footnotes", drewOn: false },
          { id: "mem_loud", score: 2, lane: "loud", drewOn: false },
          { id: "mem_o", score: 1, lane: "opened", drewOn: true },
        ],
        coverage: { shown: { footnotes: 2, pointers: 1 }, rated: { footnotes: 2, pointers: 0 } },
        drewOnUnrated: ["mem_x"],
      }),
      // A second session the same day that rated nothing: its footnote is shown, unrated.
      row("recall.decision", { session: "s2", date: "2026-10-14", turn: 1, footnotes: [{ id: "mem_f9" }] }),
      // A later rating of the same memory in s1: the last score counts.
      row("recall.rated", { session: "s1", date: "2026-10-14", ratings: [{ id: "mem_f2", score: 1, lane: "footnotes", drewOn: false }] }),
      { name: "recall.rated", day: 0, payload: "{not json" },
    ];
    const r = probeRatings(rows);
    expect(r.rows).toBe(2);
    expect(r.unparseable).toBe(1);
    expect(r.days.map((d) => [d.date, d.sessions])).toEqual([["2026-10-14", 2]]);
    const t = r.totals;
    expect(t.footnotes).toMatchObject({ shown: 3, rated: 2, scores: [0, 1, 0, 1], drewOn: { rated: 1, high: 1 } });
    expect(t.footnotes.coverage).toBeCloseTo(2 / 3, 10);
    expect(t.loud).toMatchObject({ shown: 1, rated: 1, scores: [0, 0, 1, 0], coverage: null });
    expect(t.pointers).toMatchObject({ shown: 1, rated: 0, coverage: 0 });
    expect(t.asked).toMatchObject({ shown: 1, rated: 0 });
    expect(t.opened).toMatchObject({ shown: 1, rated: 1, scores: [0, 1, 0, 0], drewOn: { rated: 1, high: 0 } });
    expect(r.drewOnUnrated).toBe(1);
    // Judged ambient showings rated: f1 used & 3 (agree), f2 ignored & 1 (agree), loud ignored & 2 (disagree).
    expect(r.usage).toEqual({ used: [0, 0, 0, 1], ignored: [0, 1, 1, 0], agree: 2, of: 3 });
    expect(r.boundaries).toEqual({ shown: 3, rated: 2 });
    const text = renderRatings(r).join("\n");
    expect(text).toContain("2026-10-14  footnotes     3      2   66.7%");
    expect(text).toContain("drewOn: 2 rated, 1 of them 2–3 (50.0%); 1 named and not rated");
    expect(text).toContain("agree 2 (66.7%");
    expect(text).toContain("at the asks: 2 of 3");
  });

  test("review of #492: sessions from before ratings began are left out of coverage, and counted", () => {
    const r = probeRatings([
      row("recall.decision", { session: "s0", date: "2026-10-01", turn: 1, footnotes: [{ id: "mem_old1" }, { id: "mem_old2" }] }),
      row("recall.decision", { session: "sx", turn: 1, footnotes: [{ id: "mem_undated" }] }),
      row("recall.decision", { session: "s1", date: "2026-10-14", turn: 1, footnotes: [{ id: "mem_a" }] }),
      row("recall.rated", { session: "s1", date: "2026-10-14", ratings: [{ id: "mem_a", score: 2, lane: "footnotes", drewOn: false }] }),
      // After ratings began, a session that rated nothing still counts as shown and unrated.
      row("recall.decision", { session: "s2", date: "2026-10-15", turn: 1, footnotes: [{ id: "mem_b" }] }),
    ]);
    expect(r.before).toBe(2);
    expect(r.days.map((d) => d.date)).toEqual(["2026-10-14", "2026-10-15"]);
    expect(r.totals.footnotes).toMatchObject({ shown: 2, rated: 1, coverage: 0.5 });
    expect(renderRatings(r).join("\n")).toContain("2 session(s) from before ratings began left out");
  });

  test("no rating row yet reads unknown, not zero", () => {
    const r = probeRatings([row("recall.decision", { session: "s1", date: "2026-10-14", turn: 1, footnotes: [{ id: "mem_a" }] })]);
    expect(r.rows).toBe(0);
    expect(renderRatings(r).join("\n")).toContain("ratings: - (no recall.rated row yet)");
  });
});

describe("counterparts probe-oq4 prints the ratings", () => {
  test("after the hit rate, read-only", () => {
    const { c, ids } = setup(2);
    const [a, b] = ids as [string, string];
    shown(c, "s1", 1, [a, b]);
    c.rateShown("s1", [{ id: a, score: 2 }], { at: "2026-08-26" });
    c.close();
    open.splice(0);
    const out: string[] = [];
    const err: string[] = [];
    expect(probeCommand(dir, { out: (l) => out.push(l), err: (l) => err.push(l) }, true)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Ratings — what sessions scored");
    expect(text).toContain("rows: 1 recall.rated");
  });
});
