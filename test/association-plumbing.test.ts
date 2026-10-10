/**
 * ASSOCIATION PLUMBING (2026-10-09) — two fixes the association diagnosis of
 * 10-02 named, neither of which changes what recall ranks or shows:
 *
 *   (a) a regrown chapter copy inherits the links its archived copy learned
 *       (they were stranded: an archived row conducts nothing), and a store
 *       that has such copies has them carried once, at its next open;
 *   (b) the boundary's credit pass scores what recall showed — each ambient
 *       showing once, used (expanded or quoted) or not, by lane — on the
 *       `recall.credit` row, and the OQ4 probe reads the hit rate off it.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, RECALL_CREDIT_EVENT, REGROWN_RELINK_META } from "../src/core/counterpart.js";
import { Associate } from "../src/core/associate/index.js";
import type { FlushReport } from "../src/core/associate/index.js";
import {
  JUDGED_KIND,
  freshGateState,
  judgedThrough,
  loadGateState,
  saveGateState,
} from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { probeOQ4, renderProbe } from "../src/core/recall/probe.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter, HookInput } from "../src/adapters/claude-code/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-association-plumbing-"));
  process.env[ENV] = dir;
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
  rmSync(dir, { recursive: true, force: true });
});

function brain(opts: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
  const c = Counterpart.open({ dir, owner: true, ...opts });
  open.push(c);
  return c;
}

/** A chapter for session `s1` and its first copy. */
function chapterWithCopy(c: Counterpart): { episodeId: string; copyId: string } {
  c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
  const written = c.appendEpisode("s1", "The morning the orchard ladder finally came back from the repair shop.");
  const out = c.ingestEpisode({ sessionId: "s1" });
  expect(out.ingested).toBe(true);
  return { episodeId: written.episodeId as string, copyId: out.memoryId as string };
}

/** The chapter grows, and the next ingestion regrows its copy. */
function regrow(c: Counterpart): { newCopy: string; archived: readonly string[] } {
  c.episodeAsk("s1", { turns: 40, bytes: 40_000 });
  c.appendEpisode("s1", "And the evening, when the ladder held and the high branches were picked at last.");
  const out = c.ingestEpisode({ sessionId: "s1" });
  expect(out.reason).toBe("regrown");
  return { newCopy: out.memoryId as string, archived: out.archived };
}

function neighbour(c: Counterpart): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body: "The repair shop on the river road sharpens tools and mends ladders.",
    physics: { birthDay: 0, lastUsedDay: 0 },
  });
}

/** A learned link, the way waking use makes one: co-use, then the flush. */
function coUse(c: Counterpart, a: string, b: string, times: number): void {
  for (let i = 0; i < times; i += 1) {
    c.associate.coactivate([
      { id: a, tier: "referenced" },
      { id: b, tier: "referenced" },
    ]);
    c.associate.flush();
  }
}

const NO_RETARGET: FlushReport = {
  reason: "nothing-buffered",
  day: 0,
  pairs: 0,
  rows: 0,
  evictions: [],
  renormalized: 0,
  nodesTouched: 0,
  blocked: 0,
  dropped: 0,
  swept: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// (a) the links go with the words
// ═══════════════════════════════════════════════════════════════════════════

describe("(a) a regrown chapter copy keeps the links its archived copy learned", () => {
  test("the new copy inherits each live link, both ways, at the weight it stands at; the old copy conducts nothing", () => {
    const c = brain();
    const { copyId } = chapterWithCopy(c);
    const n = neighbour(c);
    coUse(c, copyId, n, 3);
    expect(c.associate.linked(copyId, n)).toBe(true);
    const learned = c.associate.weightAt(copyId, n);

    const { newCopy, archived } = regrow(c);
    expect(archived).toEqual([copyId]);
    expect(c.store.row(copyId)?.archived_reason).toBe("episode-regrown");
    // The old copy is archived, so its rows stop conducting (contract G8)…
    expect(c.associate.linked(copyId, n)).toBe(false);
    // …and the new one carries what it had: the same lived day, the same weight.
    expect(c.associate.linked(newCopy, n)).toBe(true);
    expect(c.associate.linked(n, newCopy)).toBe(true);
    expect(c.associate.weightAt(newCopy, n)).toBeCloseTo(learned, 9);
    expect(c.associate.events("associate.retarget").at(-1)?.data?.["successor"]).toBe(newCopy);
  });

  test("a second regrowth carries the links on again, so a chapter's links follow it through every copy", () => {
    const c = brain();
    const { copyId } = chapterWithCopy(c);
    const n = neighbour(c);
    coUse(c, copyId, n, 2);
    const second = regrow(c).newCopy;
    c.episodeAsk("s1", { turns: 80, bytes: 80_000 });
    c.appendEpisode("s1", "And the night after, writing it all down while it was still warm.");
    const third = c.ingestEpisode({ sessionId: "s1" });
    expect(third.archived).toEqual([second]);
    expect(c.associate.linked(third.memoryId as string, n)).toBe(true);
    expect(c.associate.linked(second, n)).toBe(false);
  });

  test("a retarget that THROWS costs the links, never the copy", () => {
    const c = brain();
    const { copyId } = chapterWithCopy(c);
    const n = neighbour(c);
    coUse(c, copyId, n, 2);
    c.associate.retargetOnSupersede = () => {
      throw new Error("edge table locked");
    };
    const { newCopy, archived } = regrow(c);
    expect(archived).toEqual([copyId]);
    expect(c.store.row(newCopy)?.archived).toBe(0);
    expect(c.self.events("self.episode.relink.failed").at(-1)?.data?.["failed"]).toBe(1);
  });
});

describe("(a) the links a regrown copy was left holding before this are carried once, at the next open", () => {
  /** The store as a build before this one left it: the copy regrown, its links stranded. */
  function stranded(): { copyId: string; newCopy: string; n: string } {
    const c = brain();
    const { copyId } = chapterWithCopy(c);
    const n = neighbour(c);
    coUse(c, copyId, n, 3);
    c.associate.retargetOnSupersede = () => NO_RETARGET;
    const { newCopy } = regrow(c);
    expect(c.associate.linked(newCopy, n)).toBe(false);
    // The latch is gone, as on a store no build with the repair has opened.
    c.store.updateMeta(REGROWN_RELINK_META, () => null);
    c.close();
    return { copyId, newCopy, n };
  }

  test("the chapter's live copy inherits them; the record says what was carried; a later open does not run it again", () => {
    const { copyId, newCopy, n } = stranded();
    const c = brain();
    expect(c.associate.linked(newCopy, n)).toBe(true);
    expect(c.associate.linked(n, newCopy)).toBe(true);
    expect(c.associate.linked(copyId, n)).toBe(false);
    const record = JSON.parse(c.store.getMeta(REGROWN_RELINK_META) ?? "{}") as Record<string, number>;
    expect(record["copies"]).toBe(1);
    expect(record["edges"]).toBe(1);
    expect(record["noLiveCopy"]).toBe(0);
    expect(c.events("counterpart.regrown.relink").length).toBe(1);
    c.close();

    const again = brain();
    expect(again.events("counterpart.regrown.relink").length).toBe(0);
    expect(again.store.getMeta(REGROWN_RELINK_META)).toBe(JSON.stringify(record));
  });

  test("a copy whose chapter has no live copy any more is counted, and its links go nowhere", () => {
    const { newCopy, n } = stranded();
    const before = brain();
    // The same store a moment before the repair: put the latch back off and
    // take the live copy out, so the stranded copy has nowhere to go.
    before.store.updateMeta(REGROWN_RELINK_META, () => null);
    before.store.archive(newCopy, "pruned");
    before.close();
    const c = brain();
    const record = JSON.parse(c.store.getMeta(REGROWN_RELINK_META) ?? "{}") as Record<string, number>;
    expect(record["copies"]).toBe(0);
    expect(record["noLiveCopy"]).toBe(1);
    expect(c.associate.linked(newCopy, n)).toBe(false);
  });

  test("a carry whose write FAILED is not latched, so the next open tries again", () => {
    const { newCopy, n } = stranded();
    // The edge module answers a failed write (a locked store) without throwing.
    const proto = Associate.prototype;
    const real = proto.retargetOnSupersede;
    proto.retargetOnSupersede = () => ({ ...NO_RETARGET, reason: "failed" });
    try {
      const c = brain();
      expect(c.store.getMeta(REGROWN_RELINK_META)).toBe(undefined);
      expect(c.events("counterpart.regrown.relink").at(-1)?.data?.["failed"]).toBe(1);
      expect(c.associate.linked(newCopy, n)).toBe(false);
      c.close();
    } finally {
      proto.retargetOnSupersede = real;
    }
    const retry = brain();
    expect(retry.associate.linked(newCopy, n)).toBe(true);
    expect(JSON.parse(retry.store.getMeta(REGROWN_RELINK_META) ?? "{}")["copies"]).toBe(1);
  });

  test("review of #329: a copy taken dark by a removal (edges not yet chased) carries nothing", () => {
    const before = brain();
    const { copyId } = chapterWithCopy(before);
    const n = neighbour(before);
    coUse(before, copyId, n, 3);
    before.associate.retargetOnSupersede = () => NO_RETARGET;
    const { newCopy } = regrow(before);
    before.store.appendRemovalRecord({ memoryId: copyId, stage: "dark", actor: "owner" });
    // Dark, not chased: its edge rows are still in the table.
    expect(before.store.edgesFrom(copyId).length).toBeGreaterThan(0);
    before.store.updateMeta(REGROWN_RELINK_META, () => null);
    before.close();
    const c = brain();
    expect(c.associate.weightAt(newCopy, n)).toBe(0);
    expect(c.associate.weightAt(n, newCopy)).toBe(0);
    const record = JSON.parse(c.store.getMeta(REGROWN_RELINK_META) ?? "{}") as Record<string, number>;
    expect(record["copies"]).toBe(0);
    expect(record["removed"]).toBe(1);
  });

  test("review of #329: two archived copies of one chapter carry by max, never by sum, and a tie between them is not carried", () => {
    const c = brain();
    const { copyId: first } = chapterWithCopy(c);
    const n = neighbour(c);
    coUse(c, first, n, 2);
    c.associate.retargetOnSupersede = () => NO_RETARGET;
    const second = regrow(c).newCopy;
    coUse(c, second, n, 4);
    coUse(c, first, second, 1);
    c.episodeAsk("s1", { turns: 80, bytes: 80_000 });
    c.appendEpisode("s1", "And the night after, writing it all down while it was still warm.");
    const third = c.ingestEpisode({ sessionId: "s1" }).memoryId as string;
    const strongest = Math.max(c.associate.weightAt(first, n), c.associate.weightAt(second, n));
    c.store.updateMeta(REGROWN_RELINK_META, () => null);
    c.close();

    const after = brain();
    expect(after.associate.weightAt(third, n)).toBeCloseTo(strongest, 9);
    expect(after.associate.weightAt(n, third)).toBeCloseTo(strongest, 9);
    // The stale copies' tie to each other went nowhere: both ends are archived.
    expect(after.associate.weightAt(third, third)).toBe(0);
    expect(after.associate.linked(first, second)).toBe(false);
    const record = JSON.parse(after.store.getMeta(REGROWN_RELINK_META) ?? "{}") as Record<string, number>;
    expect(record["copies"]).toBe(2);
  });

  test("an observer's open carries nothing and writes no latch", () => {
    stranded();
    const c = brain({ observer: true });
    expect(c.store.getMeta(REGROWN_RELINK_META)).toBe(undefined);
    expect(c.events("counterpart.regrown.relink").length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) shown, and not used
// ═══════════════════════════════════════════════════════════════════════════

const LOUD_BODY =
  "The storage split keeps canonical prose in markdown files, operational state in one small database, and a rebuildable cache that nobody backs up.";

function fact(c: Counterpart, body: string): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
    physics: { birthDay: 0, lastUsedDay: 0 },
  });
}

/** What a session was SHOWN, written as recall's own save writes it — so the
 *  fixture does not depend on ranking. */
function shown(c: Counterpart, sessionId: string, turn: number, records: GateState["surfaced"]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const state: GateState = {
    ...freshGateState(sessionId),
    ...prior,
    turn,
    lastDay: c.store.livedDay(),
    surfaced: { ...prior.surfaced, ...records },
  };
  saveGateState(c.store, state, 200);
}

describe("(b) the credit pass scores each ambient showing once, at the first boundary after it", () => {
  test("by lane: a quoted loud one and an expanded footnote are used; the pointer nobody opened is listed", () => {
    const c = brain();
    const loud = fact(c, LOUD_BODY);
    const foot = fact(c, "Rebasing before review keeps the history readable for everyone involved.");
    const pointer = fact(c, "The backup drive lives in the hall cupboard behind the paint tins.");
    shown(c, "s1", 1, {
      [loud]: { turn: 1, tier: "surfaced", trains: true },
      [foot]: { turn: 1, tier: "footnoted", trains: true },
      [pointer]: { turn: 1, tier: "footnoted", trains: true, via: "link" },
    });
    const summary = c.creditReferences("s1", {
      assistantTurns: [
        "As I said before, the storage split keeps canonical prose in markdown files, operational state in one small database.",
      ],
      expansions: [foot],
    });
    expect(summary.shown).toEqual({ loud: 1, footnotes: 1, pointers: 1 });
    expect(summary.unused).toEqual({ loud: 0, footnotes: 0, pointers: 1 });
    expect(summary.shownNotUsed).toEqual([pointer]);
    expect(summary.judgedThrough).toBe(1);
    expect(judgedThrough(c.store, "s1")).toBe(1);

    // The next boundary, with no turn in between, has nothing new to score.
    const again = c.creditReferences("s1", { assistantTurns: ["Nothing else to add."], expansions: [] });
    expect(again.shown).toEqual({ loud: 0, footnotes: 0, pointers: 0 });
    expect(again.shownNotUsed).toEqual([]);
  });

  test("a later turn's showings are the next boundary's alone; one opened late counts as missed then used", () => {
    const c = brain();
    const first = fact(c, "The tide tables for the estuary are pinned inside the boathouse door.");
    const second = fact(c, "The ferry stops running an hour earlier once the clocks change.");
    shown(c, "s1", 1, { [first]: { turn: 1, tier: "footnoted", trains: true } });
    expect(c.creditReferences("s1", { assistantTurns: ["Okay."], expansions: [] }).shownNotUsed).toEqual([first]);

    shown(c, "s1", 2, { [second]: { turn: 2, tier: "footnoted", trains: true } });
    const later = c.creditReferences("s1", { assistantTurns: ["Let me look."], expansions: [first] });
    // Only turn 2's showing is scored here; turn 1's was scored at its own boundary.
    expect(later.shown).toEqual({ loud: 0, footnotes: 1, pointers: 0 });
    expect(later.shownNotUsed).toEqual([second]);
    expect(later.expandedIds).toEqual([first]);
    expect(later.judgedThrough).toBe(2);
  });

  test("recall's own save never drops the mark, and the mark is not gate state", () => {
    const c = brain();
    const m = fact(c, "The tide tables for the estuary are pinned inside the boathouse door.");
    shown(c, "s1", 1, { [m]: { turn: 1, tier: "footnoted", trains: true } });
    c.creditReferences("s1", { assistantTurns: ["Okay."], expansions: [] });
    expect(judgedThrough(c.store, "s1")).toBe(1);
    // A real turn loads and saves the whole gate state.
    c.recallForTurn({ sessionId: "s1", text: "what time does the ferry stop running" });
    expect(judgedThrough(c.store, "s1")).toBe(1);
    expect(loadGateState(c.store, "s1").status).toBe("loaded");
    // A session whose only row is the mark has no gate state yet.
    c.store.setGateRecords([{ sessionId: "s2", kind: JUDGED_KIND, ref: "credit", turn: 3, lastDay: 0 }]);
    expect(loadGateState(c.store, "s2").status).toBe("absent");
  });

  test("measurement only: scoring a miss changes no strength and writes no edge", () => {
    const c = brain();
    const m = fact(c, "The tide tables for the estuary are pinned inside the boathouse door.");
    const before = c.store.physicsOf(m);
    const edges = c.store.allEdges().length;
    shown(c, "s1", 1, { [m]: { turn: 1, tier: "surfaced", trains: true } });
    const summary = c.creditReferences("s1", { assistantTurns: ["Something else entirely."], expansions: [] });
    expect(summary.shownNotUsed).toEqual([m]);
    expect(c.store.physicsOf(m)).toEqual(before);
    expect(c.store.allEdges().length).toBe(edges);
  });

  test("review of #329, the real path: what recall's own turn showed is what the boundary scores", () => {
    const c = brain();
    for (const body of [
      "The quarterly review moved to the second Tuesday of the month.",
      "The office plants get watered on Mondays by whoever arrives first.",
      "The printer on the third floor jams when the paper tray is overfilled.",
      "Lunch orders for the team offsite go through the shared spreadsheet.",
    ]) {
      fact(c, body);
    }
    const target = c.store.put({
      type: "memory",
      kind: "skill",
      title: "Compost tumbler",
      body: "The rotary compost tumbler jammed after the winter freeze; a mallet on the drum frees it.",
      salience: { novelty: null, relevance: 0.8, emotional: 0.5, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const out = c.recallForTurn({ sessionId: "s1", text: "the rotary compost tumbler jammed again" });
    const reached = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(reached).toContain(target);
    const summary = c.creditReferences("s1", { assistantTurns: ["Try warming it first."], expansions: [] });
    expect(summary.shown.loud).toBe(out.decision.surfaced.length);
    expect(summary.shown.footnotes + summary.shown.pointers).toBe(out.decision.footnotes.length);
    expect([...summary.shownNotUsed].sort()).toEqual([...reached].sort());
    expect(summary.judgedThrough).toBe(out.decision.turn);
    expect(judgedThrough(c.store, "s1")).toBe(out.decision.turn);
  });

  test("review of #329: a boundary that read no reply judges nothing, and the next one that does scores the showing", () => {
    const c = brain();
    const loud = fact(c, LOUD_BODY);
    shown(c, "s1", 1, { [loud]: { turn: 1, tier: "surfaced", trains: true } });
    // No reply in the slice (a capture that failed, or nothing new): no verdict.
    const empty = c.creditReferences("s1", { assistantTurns: [], expansions: [] });
    expect(empty.shown).toEqual({ loud: 0, footnotes: 0, pointers: 0 });
    expect(empty.shownNotUsed).toEqual([]);
    expect(judgedThrough(c.store, "s1")).toBe(0);
    // The reply arrives at the next boundary, and it quoted the memory.
    const next = c.creditReferences("s1", {
      assistantTurns: [
        "As I said before, the storage split keeps canonical prose in markdown files, operational state in one small database.",
      ],
      expansions: [],
    });
    expect(next.shown).toEqual({ loud: 1, footnotes: 0, pointers: 0 });
    expect(next.unused).toEqual({ loud: 0, footnotes: 0, pointers: 0 });
    expect(judgedThrough(c.store, "s1")).toBe(1);
  });

  test("an observer scores, and writes no mark", () => {
    const writer = brain();
    const m = fact(writer, "The tide tables for the estuary are pinned inside the boathouse door.");
    shown(writer, "s1", 1, { [m]: { turn: 1, tier: "footnoted", trains: true } });
    writer.close();
    const c = brain({ observer: true });
    const summary = c.creditReferences("s1", { assistantTurns: ["Okay."], expansions: [] });
    expect(summary.shownNotUsed).toEqual([m]);
    expect(judgedThrough(c.store, "s1")).toBe(0);
  });
});

describe("(b) the boundary's row carries the score, and the probe reads the hit rate", () => {
  function adapter(): ClaudeCodeAdapter {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000, owner: true },
      { command: "/bin/true", args: ["runner"], spawner: (_p: SpawnPlan) => ({ pid: 4242 }) },
    );
    open.push(a.counterpart);
    return a;
  }

  function input(over: Partial<HookInput> = {}): HookInput {
    const hook: HookInput = {
      sessionId: "s1",
      scope: "proj",
      at: "2026-01-02",
      turns: [
        { role: "user", text: "Where did we land on the storage split?" },
        { role: "assistant", text: "Canonical prose on disk, one small database, and a cache nobody backs up." },
      ],
      ...over,
    };
    recordSession(dir, { sessionId: hook.sessionId, scope: hook.scope, phase: "start" });
    return hook;
  }

  test("a Stop writes the lanes, the ids and the mark onto recall.credit; the probe sums the rows that carry them", () => {
    const a = adapter();
    const c = a.counterpart;
    const loud = fact(c, LOUD_BODY);
    const foot = fact(c, "Rebasing before review keeps the history readable for everyone involved.");
    shown(c, "s1", 1, {
      [loud]: { turn: 1, tier: "surfaced", trains: true },
      [foot]: { turn: 1, tier: "footnoted", trains: true },
    });
    // The reply OPENS the footnote and does not draw on the loud memory's
    // words: since the engaged door (2026-10-10, G1b), a reply restating the
    // loud memory's rare words would count it used.
    a.stop(
      input({
        turns: [
          { role: "user", text: "Where did we land on the storage split?" },
          { role: "assistant", text: "Let me open the one I need first." },
        ],
        expansions: [{ atTurn: 2, ids: [foot] }],
      }),
    );
    const payload = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["shownLoud"]).toBe(1);
    expect(payload["shownFootnotes"]).toBe(1);
    expect(payload["shownPointers"]).toBe(0);
    expect(payload["unusedLoud"]).toBe(1);
    expect(payload["unusedFootnotes"]).toBe(0);
    expect(payload["unusedPointers"]).toBe(0);
    expect(payload["shownNotUsed"]).toEqual([loud]);
    expect(payload["shownNotUsedTotal"]).toBe(1);
    expect(payload["judgedThrough"]).toBe(1);

    // A row from before the score (no lanes) is read and left out of the rate.
    const rows = [
      ...c.store.eventLog({ name: RECALL_CREDIT_EVENT }),
      { name: RECALL_CREDIT_EVENT, day: 0, payload: JSON.stringify({ session: "old", expandedIds: [] }) },
    ].map((r) => ({ name: r.name, day: r.day, payload: r.payload }));
    const report = probeOQ4(rows);
    expect(report.hits.boundaries).toBe(1);
    expect(report.hits.shown).toEqual({ loud: 1, footnotes: 1, pointers: 0 });
    expect(report.hits.unused).toEqual({ loud: 1, footnotes: 0, pointers: 0 });
    const text = renderProbe(report).join("\n");
    expect(text).toContain("hit rate, over 1 boundary that scored what recall showed: loud 0 of 1 used (0.0%), footnotes 1 of 1 used (100.0%), pointers 0 of 0 used");
  });

  test("review of #329, through the hooks: a prompt's real recall, then a Stop whose slice is empty, then one with the reply", () => {
    const a = adapter();
    const c = a.counterpart;
    const loud = fact(c, LOUD_BODY);
    for (const body of [
      "The quarterly review moved to the second Tuesday of the month.",
      "The office plants get watered on Mondays by whoever arrives first.",
      "The printer on the third floor jams when the paper tray is overfilled.",
    ]) {
      fact(c, body);
    }
    a.userPromptSubmit(input({ prompt: "where did we land on the storage split, canonical prose and the small database" }));
    const decision = JSON.parse(c.store.eventLog({ name: "recall.decision" }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    const reachedCount = Number(decision["surfacedCount"] ?? 0) + Number(decision["footnoteCount"] ?? 0);
    expect(reachedCount).toBeGreaterThan(0);

    // A Stop whose slice holds no reply judges nothing and leaves the mark.
    a.stop(input({ turns: [] }));
    const first = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    expect(first["shownLoud"] as number + (first["shownFootnotes"] as number) + (first["shownPointers"] as number)).toBe(0);
    expect(judgedThrough(c.store, "s1")).toBe(0);

    a.stop(input());
    const second = JSON.parse(c.store.eventLog({ name: RECALL_CREDIT_EVENT }).at(-1)?.payload ?? "{}") as Record<string, unknown>;
    expect(second["shownLoud"] as number + (second["shownFootnotes"] as number) + (second["shownPointers"] as number)).toBe(reachedCount);
    expect(second["judgedThrough"]).toBe(1);
    expect(loud.length).toBeGreaterThan(0);
  });

  test("with no row that scores, the probe says unknown, not zero", () => {
    const report = probeOQ4([
      { name: RECALL_CREDIT_EVENT, day: 0, payload: JSON.stringify({ session: "old", expandedIds: [] }) },
    ]);
    expect(report.hits.boundaries).toBe(0);
    expect(renderProbe(report).join("\n")).toContain("hit rate: - (no recall.credit row scores what recall showed yet)");
  });
});
