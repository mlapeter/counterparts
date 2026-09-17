/**
 * `src/core/counterpart.ts` — the composition root, exercised as one brain.
 *
 * The seam suite proves each pair of modules meets correctly. This suite proves
 * the whole thing runs: a fresh data dir wakes with nothing, lives a session,
 * writes what it learned, retrieves it on the next turn, credits the use, sleeps,
 * and wakes carrying it. That arc is the product; every test below is a slice of
 * it or a property of the wiring that carries it.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Counterpart,
  SELF_BRIEFING_EVENT,
  SLEEP_CYCLE_EVENT,
  SWEEP_GATE_EVENT,
  surfaceSetFields,
} from "../src/core/counterpart.js";
import { TUNABLES as ASSOCIATE } from "../src/core/associate/index.js";
import { SWEEP_REASONS, TUNABLES as REMEMBER_TUNABLES } from "../src/core/remember/index.js";
import type { InterpretFn, SweepChunk } from "../src/core/remember/index.js";
import { BOOTSTRAP, LANE_ORDER, PREFACE_RESERVE_BYTES } from "../src/core/self/index.js";
import { CycleKilled, PHASES } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";

/** The HOST's reported injection ceiling. It lives in the test because it lives
 *  in the host: nothing in `src/` may invent one (scar §2.18). */
const BUDGET_BYTES = 9000;
const SMALL_BUDGET_BYTES = 400;

let dir: string;
let priorEnv: string | undefined;
const open: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-root-"));
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

/**
 * THE TEST CLOCK, an OFFSET on the real one. The crash fallback's eligibility is
 * a fact about time — a session is crashed when it has gone silent past
 * `CRASH_STALE_MS` with no `session-end` boundary — so a test that wants a sweep
 * makes its session GO QUIET. Setting the window to zero instead would delete the
 * gate the fixture exists to exercise.
 */
let offsetMs = 0;

/** The session stopped and nobody ever came back: this host's only crash signal. */
function goQuiet(): void {
  offsetMs += REMEMBER_TUNABLES.CRASH_STALE_MS + 60_000;
}

function brain(opts: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
  const c = Counterpart.open({ dir, owner: true, now: () => Date.now() + offsetMs, ...opts });
  open.push(c);
  return c;
}

/**
 * Ordinary background. Recall is rarity-weighted (§9 G4): in a store of one, every
 * token is in 100% of documents and therefore cues nothing. A store with a life in
 * it is the honest fixture for any retrieval assertion.
 */
const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "The neighbour's cat sits on the fence every evening.",
  "The sourdough starter needs feeding twice a week.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
];

function seed(c: Counterpart): void {
  for (const body of FILLER) {
    c.store.put({
      type: "memory",
      kind: "fact",
      body,
      salience: { novelty: null, relevance: 0.6, emotional: 0.5, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
  }
}

/** Enough conversational substance that a claim clears `MIN_CLAIM_BYTES`. */
const TURNS = [
  { role: "user" as const, text: "We settled the storage split today: canonical prose on disk, one small operational database, and a cache nobody backs up." },
  { role: "assistant" as const, text: "Recorded. The cache being rebuildable is what makes the backup set small enough to be honest about." },
  { role: "user" as const, text: "Right, and the reason it matters is that a backup you cannot verify is a backup you do not have." },
];

// ═══════════════════════════════════════════════════════════════════════════
// The wiring's own property: this file states no rule
// ═══════════════════════════════════════════════════════════════════════════
describe("the composition root is WIRING — it defines no threshold of its own", () => {
  test("no numeric literal other than 0 or 1 appears in counterpart.ts", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/core/counterpart.ts", import.meta.url)),
      "utf8",
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      // Template literals: keep the `${…}` EXPRESSIONS (they are code, and a
      // threshold could hide in one) and drop only the literal text around them.
      .replace(/`(?:\\.|[^`\\])*`/g, (lit) =>
        [...lit.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join(";"),
      )
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, '""');
    const numbers = [...code.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0]);
    // A budget, a floor, a chunk size or a candidate limit written HERE would be
    // a number with no home, no CAL marking and no test (scar §2.8/§2.18).
    expect(numbers.filter((n) => n !== "0" && n !== "1")).toEqual([]);
  });

  test("every number the root uses arrives as an argument or an import", () => {
    // The two that actually govern behaviour, checked from the outside: the
    // host's ceiling is reported in, and there is no fallback when it is not.
    const c = brain();
    expect(c.budgetBytes()).toBe(null);
    c.wake();
    expect(c.events("counterpart.budget.unreported").length).toBe(1);
    c.wake(BUDGET_BYTES);
    expect(c.budgetBytes()).toBe(BUDGET_BYTES);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The full pipeline: one lived session, end to end
// ═══════════════════════════════════════════════════════════════════════════
describe("the full pipeline — wake, live, write, retrieve, credit, sleep, wake", () => {
  test("a fresh store wakes with the honest bootstrap line, not an error", () => {
    const c = brain({ identity: { name: "Mike", aliases: ["mike"] } });
    const woke = c.wake(BUDGET_BYTES);
    expect(woke.ok).toBe(false);
    expect(woke.reason).toBe("absent");
    expect(woke.text).toBe(BOOTSTRAP);
    expect(woke.budgetBytes).toBe(BUDGET_BYTES);
  });

  test("an EMPTY store publishes a floor briefing at its first boundary, and the next wake reads it back", async () => {
    const c = brain();
    c.wake(BUDGET_BYTES);
    const report = await c.sessionEnd({ date: "2026-01-02" });
    expect(report.cycle.observer).toBe(false);
    expect(report.budgetBytes).toBe(BUDGET_BYTES);

    const woke = c.wake(BUDGET_BYTES);
    // Furniture and a sentinel, zero statements — a floor briefing is still a
    // briefing, and it verifies against its own stated byte count.
    expect(woke.ok).toBe(true);
    expect(woke.reason).toBe("delivered");
    expect(woke.sentinel).not.toBe(null);
  });

  test("the whole arc: spans → authored dump → mint → recall → credit → sleep → the next wake carries it", async () => {
    const c = brain({ identity: { name: "Mike", aliases: ["mike"] } });
    seed(c);
    expect(c.wake(BUDGET_BYTES).ok).toBe(false);

    // ── the turn boundary: an appender, microseconds, no model call ──────────
    const captured = c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    expect(captured.captured).toBe(true);
    expect(captured.spans.length).toBeGreaterThan(0);
    expect(captured.cursorAfter).toBe(TURNS.length);

    // ── the experiencer writes its own memory, with a feeling it may claim ──
    const deposit = await c.submitSessionEnd(
      {
        content:
          "The storage split keeps canonical prose in markdown, operational state in one small database, and a rebuildable cache nobody backs up.",
        kind: "fact",
        title: "storage split",
        claimed: 0.8,
        salience: { relevance: 0.8, emotional: 0.6, predictive: 0.7 },
        feeling: { feeling: "relief", quote: "", subject: "self" },
      },
      { session: "s1", scope: "proj" },
    );
    expect(deposit.deposited).toBe(true);
    expect(deposit.reason).toBe("minted");
    const memoryId = deposit.memoryId as string;
    expect(memoryId.length).toBeGreaterThan(0);
    // The ENGINE claimed coverage, so the sweep will not re-encode these spans.
    expect(deposit.covers.length).toBeGreaterThan(0);
    // The emotion exemption reached the battery: a self-authored feeling with no
    // quote survives, where an ordinary one would come back `quote-missing`.
    expect(c.store.readProse(memoryId).meta["feeling"]).toBe("relief");
    // The author's floor was clamped AT the minting seam, and the lift is on record.
    expect(deposit.mint?.lifted).toBe(true);
    expect(c.events("salience.lifted").length).toBe(1);

    // ── the next turn: recall composes all three borrowed channels ───────────
    const turn = c.recallForTurn(
      { sessionId: "s2", text: "remind me how the storage split works" },
      { at: "2026-01-02" },
    );
    const reached = [...turn.decision.surfaced, ...turn.decision.footnotes];
    expect(reached).toContain(memoryId);

    // ── the reply used it: the credit reaches physics through the store seam ─
    // Nothing credits on its birth day (§5.5) — the day has to turn first, which
    // is what the active-day clock is for.
    c.store.advanceClock("2026-01-02");
    const before = c.store.physicsOf(memoryId).uses;
    const credit = c.resolveUse("s2", memoryId, "referenced");
    expect(credit.credited).toBe(true);
    expect(c.store.physicsOf(memoryId).uses).toBeGreaterThan(before);

    // ── every session-ending path is a boundary ─────────────────────────────
    const record = c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    expect(record.askRaised).toBe(true);

    // ── sleep: the cycle's LAST content write is the briefing ────────────────
    const report = await c.sessionEnd({ date: "2026-01-03", at: "2026-01-03" });
    const briefing = report.cycle.phases.find((p) => p.phase === "briefing");
    expect(briefing?.status).toBe("ran");

    // ── and the next wake carries what the session learned ───────────────────
    const woke = c.wake(BUDGET_BYTES);
    expect(woke.ok).toBe(true);
    expect(woke.text).toContain("storage split");
  });

  test("a session-end dump that declares `updates:` reaches canonical prose as a RESOLVED id", async () => {
    const c = brain();
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });

    const first = await c.submitSessionEnd(
      {
        content: "Backups cover canonical prose and the operational database, and deliberately skip the cache.",
        kind: "fact",
      },
      { session: "s1", scope: "proj" },
    );
    const originalId = first.memoryId as string;

    const second = await c.submitSessionEnd(
      {
        content:
          "Backups cover canonical prose, the operational database and the span buffer; the cache is still skipped because it rebuilds.",
        kind: "fact",
        updates: originalId,
      },
      { session: "s1", scope: "proj" },
    );
    expect(second.deposited).toBe(true);
    // The RESOLVED id, never the declared string — and only when it resolved.
    expect(second.mint?.updates).toBe(originalId);
    expect(c.store.readProse(second.memoryId as string).meta["updates"]).toBe(originalId);
  });

  test("a dangling `updates:` declaration writes no key — a bad address is not a merge exclusion", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    const out = await c.submitSessionEnd(
      {
        content: "The span buffer holds lived experience until judgment can happen later, without the host waiting.",
        kind: "fact",
        updates: "mem_deadbeefdead",
      },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    expect(out.mint?.updates).toBe(null);
    expect(c.store.readProse(out.memoryId as string).meta["updates"]).toBeUndefined();
  });

  test("a jot is a deposit too, and the battery still refuses a credential in it", async () => {
    const c = brain();
    const ok = await c.submitJot(
      { content: "Bun lives at a non-default path here, so every script names it explicitly.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(ok.deposited).toBe(true);

    const refused = await c.submitJot(
      { content: "The deploy key AKIAIOSFODNN7EXAMPLE is the one to rotate.", kind: "fact", title: "AKIAIOSFODNN7EXAMPLE" },
      { session: "s1", scope: "proj" },
    );
    // A credential in a HANDLE refuses the whole operation (the ops rule).
    expect(refused.deposited).toBe(false);
    expect(refused.reason).toBe("gate-rejected");
  });

  test("the briefing follows the HOST's ceiling, and refuses outright when none was reported", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    await c.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown files, which any editor can read.",
        kind: "fact",
        salience: { relevance: 0.9, emotional: 0.7, predictive: 0.8 },
      },
      { session: "s1", scope: "proj" },
    );
    await c.sessionEnd({ date: "2026-01-02" });
    const roomy = c.wake(BUDGET_BYTES).bytes;
    // The lanes have real content in them, so a smaller ceiling has to trim.
    expect(roomy).toBeGreaterThan(SMALL_BUDGET_BYTES);

    await c.sessionEnd({ date: "2026-01-03", budgetBytes: SMALL_BUDGET_BYTES });
    const cramped = c.wake(SMALL_BUDGET_BYTES).bytes;
    expect(roomy).toBeGreaterThan(0);
    expect(cramped).toBeLessThan(roomy);

    // A brain that was never told a ceiling refuses to render one, loudly.
    const blind = brain({ dir });
    const report = await blind.sessionEnd({ date: "2026-01-04" });
    expect(blind.events("briefing.no-budget").length).toBeGreaterThan(0);
    expect(report.budgetBytes).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The seams, reached through the root rather than assembled by the caller
// ═══════════════════════════════════════════════════════════════════════════
describe("the root binds the seams a caller would otherwise have to remember", () => {
  test("episodes route through the REAL battery — self's refusing default is unreachable here", () => {
    const c = brain();
    c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
    c.appendEpisode("s1", "We shipped the composition root and it held together all day.");
    const out = c.ingestEpisode({ sessionId: "s1" });
    expect(out.ingested).toBe(true);
    expect(out.gate).toBe(null);
  });

  test("THE BOUNDARY INGESTS THE JOURNAL — the scheduled reconciler §5 G12 asks for", async () => {
    // Measured 2026-09-04: `ingestEpisode` had no caller outside its own tests,
    // so an episode was a file that never became a memory. "Every derived
    // surface owes a scheduled reconciler — a script the owner runs
    // occasionally is not one", and every identity surface owes an answer to
    // *which door reaches this?* This is the door: the boundary.
    const c = brain();
    c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
    const written = c.appendEpisode("s1", "The day I found the door that was never built.");
    expect(written.appended).toBe(true);

    const report = await c.sessionEnd({ date: "2026-01-02" });
    expect(report.episodes.considered).toBe(1);
    expect(report.episodes.ingested).toBe(1);
    const minted = c.store
      .list({ type: "memory", archived: false })
      .map((id) => c.store.readProse(id))
      .filter((d) => d.meta["episodeId"] === written.episodeId);
    expect(minted.length).toBe(1);
    // Ordinary self-kind memory, not an "episode" kind (§13 G6).
    expect(c.store.physicsOf(c.store.list({ type: "memory", archived: false })[0] ?? "").kind).toBe("self");

    // The SECOND boundary ingests nothing new, and does not scan for it either:
    // the skip is a state read plus a hash.
    const again = await c.sessionEnd({ date: "2026-01-03" });
    expect(again.episodes.ingested).toBe(0);
    expect(again.episodes.skipped).toBe(1);

    // A chapter appended AFTER the first ingest regrows it, add-first, at the
    // next boundary — the open journal is why the window exists at all.
    c.episodeAsk("s1", { turns: 40, bytes: 40_000 });
    c.appendEpisode("s1", "And the evening, which is the half that mattered.");
    const grown = await c.sessionEnd({ date: "2026-01-04" });
    expect(grown.episodes.regrown).toBe(1);
    const live = c.store
      .list({ type: "memory", archived: false })
      .map((id) => c.store.readProse(id))
      .filter((d) => d.meta["episodeId"] === written.episodeId);
    expect(live.length).toBe(1);
    expect(live[0]?.body).toContain("the half that mattered");
  });

  test("a credential in an episode body is REDACTED, and the redacted text is what lands", () => {
    const c = brain();
    c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
    c.appendEpisode("s1", "I rotated the deploy key AKIAIOSFODNN7EXAMPLE and the relief was real.");
    const out = c.ingestEpisode({ sessionId: "s1" });
    expect(out.ingested).toBe(true);
    const body = c.store.readProse(out.memoryId as string).body;
    expect(body.includes("AKIAIOSFODNN7EXAMPLE")).toBe(false);
    expect(body.includes("relief")).toBe(true);
  });

  test("a supersede retargets the edge graph, so a successor is not born cold (SEAMS E)", () => {
    const c = brain();
    const entityId = c.schemas.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = c.schemas.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const neighbour = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The review rota is posted on Mondays in the team channel.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    for (let i = 0; i < 4; i += 1) {
      c.associate.coactivate([
        { id: beliefId, tier: "referenced" },
        { id: neighbour, tier: "referenced" },
      ]);
      c.associate.flush();
    }

    let successorId: string | null = null;
    for (const day of [1, 2, 3]) {
      const challengerId = c.store.put({
        type: "memory",
        kind: "person",
        body: "Ada asked for a live walkthrough instead",
        salience: { novelty: null, relevance: 0.45, emotional: 0.45, predictive: 0.45 },
        physics: { birthDay: day, lastUsedDay: day },
      });
      successorId = c.schemas.challengeBelief({ updates: beliefId, challengerId, day }).successorId;
      if (successorId !== null) break;
    }
    expect(successorId).not.toBe(null);
    expect(c.associate.linked(successorId as string, neighbour)).toBe(true);
  });

  test("an ambiguous handle trains nothing, all the way through resolveUse (SEAMS C)", () => {
    const c = brain();
    for (const body of [
      "The garage door opener needs a new battery soon.",
      "Rebasing keeps the history readable for reviewers.",
      "The library closes early on Sundays now.",
      "The kitchen tap drips when the pressure is high.",
      "The bus route changed and adds ten minutes.",
      "Planted three tomato seedlings in the planter.",
    ]) {
      c.store.put({ type: "memory", kind: "fact", body });
    }
    // Two concurrent births can each claim one handle; the next open reads both.
    const first = c.schemas;
    const second = brain().schemas;
    first.mention({
      name: "Robin Fielding",
      kind: "person",
      source: "Robin Fielding runs the Tuesday climbing session",
      chunkRef: "c1",
      day: 0,
      aliases: ["Robin"],
    });
    second.mention({
      name: "Robin Chen",
      kind: "person",
      source: "Robin Chen handles the quarterly invoices",
      chunkRef: "c2",
      day: 0,
      aliases: ["Robin"],
    });

    const fresh = brain();
    const out = fresh.recallForTurn({ sessionId: "s1", text: "robin robin robin" });
    const reached = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(out.decision.ambiguousCueCount).toBe(1);
    fresh.store.advanceClock("2026-08-26");
    const credit = fresh.resolveUse("s1", reached[0] ?? "", "referenced");
    expect(credit.credited).toBe(false);
    expect(credit.reason).toBe("ambiguous-handle-trains-nothing");
  });

  test("resolveUses credits each use and buffers the co-activation the boundary flushes", async () => {
    const c = brain();
    const a = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The operational database is canonical, transactional, and small on purpose.",
      salience: { novelty: null, relevance: 0.7, emotional: 0.4, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const b = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The cache is never backed up because losing it costs a re-index and nothing else.",
      salience: { novelty: null, relevance: 0.7, emotional: 0.4, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    c.store.advanceClock("2026-08-26");
    c.recallForTurn({ sessionId: "s1", text: "the operational database and the cache" });

    const results = c.resolveUses("s1", [
      { memoryId: a, tier: "referenced" },
      { memoryId: b, tier: "referenced" },
    ]);
    expect(results.every((r) => r.credited)).toBe(true);
    expect(c.associate.pendingDeltas().length).toBeGreaterThan(0);

    await c.sessionEnd({ date: "2026-08-27", budgetBytes: BUDGET_BYTES });
    expect(c.associate.pendingDeltas()).toEqual([]);
    expect(c.associate.linked(a, b)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The credit pass PUBLISHES what it buffered — the process split that made
// learned association a no-op for the whole parallel run
// ═══════════════════════════════════════════════════════════════════════════
describe("co-activation is flushed in the process that buffered it", () => {
  /** N memories a credit pass can address by id. Bodies are unique across the
   *  whole suite — an identical body is an identical content hash, and two
   *  fixtures that quietly become one id make a pair that cannot be linked. */
  let minted = 0;
  function memories(c: Counterpart, n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      minted += 1;
      ids.push(
        c.store.put({
          type: "memory",
          kind: "fact",
          body: `Association fixture number ${minted}: a fact with enough body to be an ordinary memory and nothing more.`,
          salience: { novelty: null, relevance: 0.7, emotional: 0.4, predictive: 0.6 },
          physics: { birthDay: 0, lastUsedDay: 0 },
        }),
      );
    }
    return ids;
  }

  /** The one row the flush leaves, or `undefined` if it left none. */
  function flushRow(c: Counterpart): Record<string, unknown> | undefined {
    const rows = c.store.eventLog({ name: "associate.flush" });
    const last = rows[rows.length - 1];
    return last === undefined ? undefined : (JSON.parse(last.payload ?? "{}") as Record<string, unknown>);
  }

  test("a pass that credits two memories leaves edge rows IN THE SAME PROCESS, dated today", () => {
    const c = brain();
    const [a, b] = memories(c, 2) as [string, string];
    c.store.advanceClock("2026-08-26");
    const today = c.store.livedDay();

    const summary = c.creditReferences("s1", { assistantTurns: [], expansions: [a, b] });

    expect(summary.credited).toBe(2);
    // No `sessionEnd`, no worker, no second process: the rows are already here.
    expect(c.associate.pendingDeltas()).toEqual([]);
    expect(c.associate.linked(a, b)).toBe(true);
    const edge = c.store.edgesFrom(a).find((e) => e.dst === b);
    expect(edge?.last_day).toBe(today);
    expect(c.store.edgesFrom(b).find((e) => e.dst === a)?.last_day).toBe(today);
  });

  test("the pass leaves its own row: counts, reasons, and never an id", () => {
    const c = brain();
    const [a, b, d] = memories(c, 3) as [string, string, string];
    c.store.advanceClock("2026-08-26");

    c.creditReferences("s1", { assistantTurns: [], expansions: [a, b, d] });

    const row = flushRow(c);
    expect(row?.["reason"]).toBe("flushed");
    expect(row?.["members"]).toBe(3);
    expect(row?.["eligible"]).toBe(3);
    expect(row?.["pairs"]).toBe(3); // three memories, three pairs
    expect(row?.["rows"]).toBe(6); // symmetry is written, not read backwards
    expect(row?.["dropped"]).toBe(0);
    expect(row?.["evicted"]).toBe(0);
    expect(row?.["day"]).toBe(c.store.livedDay());
    // Content-by-reference: the row carries counts, and the ids live in the
    // edge rows where they ARE the record.
    const text = JSON.stringify(row);
    for (const id of [a, b, d]) expect(text).not.toContain(id);
  });

  test("a single-memory pass wires nothing AND SAYS WHY", () => {
    const c = brain();
    const [a] = memories(c, 1) as [string];
    c.store.advanceClock("2026-08-26");

    const summary = c.creditReferences("s1", { assistantTurns: [], expansions: [a] });

    expect(summary.credited).toBe(1);
    expect(c.store.edgesFrom(a)).toEqual([]);
    const row = flushRow(c);
    // `nothing-buffered` alone cannot tell "one memory" from "several, all
    // frozen": the pair of counts beside it is what settles that (scar §2.4).
    expect(row?.["reason"]).toBe("nothing-buffered");
    expect(row?.["members"]).toBe(1);
    expect(row?.["eligible"]).toBe(1);
    expect(row?.["buffered"]).toBe(0);
    expect(row?.["rows"]).toBe(0);
  });

  test("an observer wires nothing and writes no row", () => {
    const writer = brain();
    const [a, b] = memories(writer, 2) as [string, string];
    writer.store.advanceClock("2026-08-26");
    writer.close();

    const watcher = brain({ observer: true });
    const summary = watcher.creditReferences("s1", { assistantTurns: [], expansions: [a, b] });

    // The stand-down is upstream of the graph: `resolveUse` credits nothing
    // under an observer, so there is no credited set to wire in the first place
    // — and the flush's own refusal (`associate/` G7) never has to fire.
    expect(summary.credited).toBe(0);
    expect(watcher.associate.pendingDeltas()).toEqual([]);
    expect(watcher.store.edgesFrom(a)).toEqual([]);
    expect(watcher.store.edgesFrom(b)).toEqual([]);
    expect(watcher.store.eventLog({ name: "associate.flush" })).toEqual([]);
  });

  test("a publish that fails costs the links, not the credit — and leaves the reason", () => {
    const c = brain();
    const [a, b] = memories(c, 2) as [string, string];
    c.store.advanceClock("2026-08-26");
    const store = c.store as unknown as { linkMany: (rows: readonly unknown[]) => void };
    store.linkMany = () => {
      throw new Error("box 2 is unavailable");
    };

    const summary = c.creditReferences("s1", { assistantTurns: [], expansions: [a, b] });

    // The hook does not fail the host, and physics credit already landed.
    expect(summary.reason).toBe("credited");
    expect(summary.credited).toBe(2);
    expect(c.store.physicsOf(a).uses).toBe(1);
    const row = flushRow(c);
    expect(row?.["reason"]).toBe("failed");
    expect(row?.["dropped"]).toBe(1);
    expect(row?.["rows"]).toBe(0);
    expect(row?.["error"]).toBe("Error");
    // Not restored: bounded loss is the chosen direction (contract G4).
    expect(c.associate.pendingDeltas()).toEqual([]);
  });

  test("a throw from the PLAN — outside the publish's own guard — is contained too", () => {
    const c = brain();
    const [a, b] = memories(c, 2) as [string, string];
    c.store.advanceClock("2026-08-26");
    // `planFlush` reads the graph before `linkMany` is ever reached, and that
    // read is outside `flush()`'s inner try: uncontained, it would climb into
    // the adapter and mark a boundary `failed` whose credit had landed.
    const store = c.store as unknown as { edgesFrom: (id: string) => unknown[] };
    store.edgesFrom = () => {
      throw new Error("the cache is gone");
    };

    const summary = c.creditReferences("s1", { assistantTurns: [], expansions: [a, b] });

    expect(summary.reason).toBe("credited");
    const row = flushRow(c);
    expect(row?.["reason"]).toBe("threw");
    expect(row?.["error"]).toBe("Error");
    // The drain happens BEFORE anything that can throw this far, so the pair is
    // gone. Reporting zeros here would hide the one number the contract asks to
    // be counted (G4) — and the log would read like a failure that cost nothing.
    expect(row?.["pairs"]).toBe(1);
    expect(row?.["dropped"]).toBe(1);
    expect(c.associate.pendingDeltas()).toEqual([]);
  });

  test("THE SHAPE OF THE BUG: the edges survive the process that made them", () => {
    const first = brain();
    const [a, b] = memories(first, 2) as [string, string];
    first.store.advanceClock("2026-08-26");
    const summary = first.creditReferences("s1", { assistantTurns: [], expansions: [a, b] });
    expect(summary.credited).toBe(2);
    // The hook exits. Everything in the delta buffer dies with it.
    first.close();

    const next = brain();
    expect(next.associate.linked(a, b)).toBe(true);
    expect(next.store.edgesFrom(a).map((e) => e.dst)).toContain(b);
  });

  test("what the flush costs a Stop: ten memories credited together, and the eviction path", () => {
    const c = brain();
    const ids = memories(c, 10);
    c.store.advanceClock("2026-08-26");

    const started = performance.now();
    const summary = c.creditReferences("s1", { assistantTurns: [], expansions: ids });
    const elapsed = performance.now() - started;

    expect(summary.credited).toBe(10);
    expect(flushRow(c)?.["pairs"]).toBe(45); // 10 choose 2
    expect(flushRow(c)?.["rows"]).toBe(90);
    // A budget, not a benchmark: this runs inside a Stop hook, which shares
    // 1.5 s with every other hook on that event. Loose enough not to flake on
    // a loaded machine, tight enough to catch an order-of-magnitude change.
    expect(elapsed).toBeLessThan(750);

    // THE EVICTION PATH, on the same store: a node already past its live-edge
    // cap takes one more partner, so the plan has to evict as well as write.
    // A NEW DAY, because physics credits a memory once per lived day and a hub
    // that cannot be credited again cannot be co-activated again either.
    c.store.advanceClock("2026-08-27");
    const hub = ids[0] as string;
    const spokes = memories(c, ASSOCIATE.MAX_EDGES_PER_NODE);
    c.store.linkMany(
      spokes.map((dst) => ({ src: hub, dst, weight: 0.5, day: c.store.livedDay() })),
    );
    const newcomer = (memories(c, 1) as [string])[0];
    const evictStarted = performance.now();
    c.creditReferences("s2", { assistantTurns: [], expansions: [hub, newcomer] });
    const evictElapsed = performance.now() - evictStarted;

    expect((flushRow(c)?.["evicted"] as number) > 0).toBe(true);
    expect(evictElapsed).toBeLessThan(750);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The per-turn surfacing decision, PERSISTED — §17.3's richest comparison
// surface, taken out of the in-process ring (replay INTERFACE-GAPS §7)
// ═══════════════════════════════════════════════════════════════════════════
describe("the surfacing decision is DURABLE — one row per turn, content-by-reference", () => {
  /** Planted in the memory body. A log containing it is a log carrying content. */
  const BODY_MARKER = "ZQDECISIONBODYMARKER";
  /** Planted in the turn text. A cue token is a word the user typed (§5 G14). */
  const CUE_MARKER = "zqdecisioncuemarker";

  const CUE_TURN = "the rotary compost tumbler jammed again";

  /** A store with a life in it, plus one memory the turn below actually reaches. */
  function surfaceable(c: Counterpart): string {
    seed(c);
    return c.store.put({
      type: "memory",
      kind: "skill",
      title: "Compost tumbler",
      body: `The rotary compost tumbler jammed after the winter freeze. ${BODY_MARKER}`,
      salience: { novelty: null, relevance: 0.8, emotional: 0.5, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
  }

  function rows(
    c: Counterpart,
  ): { day: number; ref: string | null; payload: Record<string, unknown> }[] {
    return c.store
      .eventLog({ name: "recall.decision", limit: 100 })
      .map((row) => ({
        day: row.day,
        ref: row.ref,
        payload: JSON.parse(row.payload ?? "{}") as Record<string, unknown>,
      }));
  }

  test("two turns leave two rows, and each row's key set IS the exported surface set", () => {
    const c = brain();
    surfaceable(c);
    c.recallForTurn({ sessionId: "s1", text: CUE_TURN }, { at: "2026-01-02" });
    // A QUIET turn is a decision too: recording only the loud ones would grade
    // surfacing by the turns that surfaced.
    c.recallForTurn(
      { sessionId: "s1", text: "what time does the tram to the airport leave" },
      { at: "2026-01-02" },
    );

    const log = rows(c);
    expect(log.length).toBe(2);
    for (const row of log) {
      // The field NAMES are the schema `tools/parallel` hashes (§5 G12): a record
      // that grew or lost a field is a different surface set and must say so.
      expect(Object.keys(row.payload)).toEqual([...surfaceSetFields()]);
      expect(row.ref).toBe("s1");
      expect(row.payload["session"]).toBe("s1");
      expect(row.payload["date"]).toBe("2026-01-02");
      expect(row.payload["observer"]).toBe(false);
      expect(row.payload["aborted"]).toBe(false);
      expect(typeof row.payload["reason"]).toBe("string");
    }
    expect(log[0]?.payload["turn"]).toBe(1);
    expect(log[1]?.payload["turn"]).toBe(2);
  });

  test("the ids and the salience numbers in the row are the decision's own", () => {
    const c = brain();
    const id = surfaceable(c);
    const out = c.recallForTurn({ sessionId: "s1", text: CUE_TURN });
    const reached = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(reached).toContain(id);

    const payload = rows(c)[0]?.payload ?? {};
    const surfaced = payload["surfaced"] as { id: string; sal: number | null }[];
    const footnotes = payload["footnotes"] as { id: string; sal: number | null }[];
    expect(surfaced.map((r) => r.id)).toEqual(out.decision.surfaced);
    expect(footnotes.map((r) => r.id)).toEqual(out.decision.footnotes);
    expect(payload["surfacedCount"]).toBe(out.decision.surfaced.length);
    expect(payload["footnoteCount"]).toBe(out.decision.footnotes.length);
    expect(payload["bytes"]).toBe(out.decision.bytes);
    expect(payload["budgetBytes"]).toBe(out.decision.budgetBytes);
    expect(payload["reason"]).toBe(out.decision.reason);
    expect(payload["affectFlag"]).toBe(out.decision.affectFlag);
    expect(payload["affectReason"]).toBe(out.decision.affectReason);
    // Whether a sentinel was RENDERED — never the sentinel's own text.
    expect(payload["sentinelRendered"]).toBe(out.decision.sentinel !== null);
    expect(payload["elapsedMs"]).toBe(out.decision.elapsedMs);
    // The salience is the gate's own number, copied, not re-derived here.
    const row = [...surfaced, ...footnotes].find((r) => r.id === id);
    expect(row?.sal).toBe(out.decision.verdicts.find((v) => v.id === id)?.sal ?? null);
  });

  test("NO memory body and NO cue text reaches the durable log, anywhere", () => {
    const c = brain();
    surfaceable(c);
    const out = c.recallForTurn({ sessionId: "s1", text: `${CUE_MARKER} ${CUE_TURN}` });
    // Not vacuous: something was actually reached, and a row was actually written.
    expect([...out.decision.surfaced, ...out.decision.footnotes].length).toBeGreaterThan(0);
    expect(rows(c).length).toBe(1);

    const whole = JSON.stringify(c.store.eventLog({ limit: 1000 }));
    expect(whole).not.toContain(BODY_MARKER);
    expect(whole).not.toContain(CUE_MARKER);
  });

  test("under observer NO row is written, and the stand-down is counted", () => {
    const writable = brain();
    surfaceable(writable);
    // One ordinary turn first, so "the count did not move" is a count that had
    // somewhere to move FROM.
    writable.recallForTurn({ sessionId: "s1", text: CUE_TURN });
    writable.close();

    const probe = brain({ observer: true });
    const before = probe.store.eventLog({ name: "recall.decision", limit: 100 }).length;
    expect(before).toBe(1);
    const out = probe.recallForTurn({ sessionId: "s2", text: CUE_TURN });
    // An instrument still SEES — it just leaves no trace at the store seam.
    expect(out.decision.observer).toBe(true);
    expect(probe.store.eventLog({ name: "recall.decision", limit: 100 }).length).toBe(before);

    const evt = probe.events("counterpart.recall.decision").at(-1);
    expect(evt?.data?.["durable"]).toBe(false);
    expect(evt?.data?.["standdown"]).toBe("observer");
  });

  test("a latency abort writes NOTHING — not a row, not an event (recall §5 G2)", () => {
    // A clock that jumps a whole minute between reads: the build loses its race.
    let t = 0;
    const c = brain({ now: () => (t += 60_000) });
    surfaceable(c);
    const out = c.recallForTurn({ sessionId: "s1", text: CUE_TURN });
    expect(out.decision.aborted).toBe(true);
    expect(out.decision.reason).toBe("latency-abort");
    // Nothing injected, nothing buffered, nothing LOGGED — durably or otherwise.
    expect(rows(c)).toEqual([]);
    expect(c.events("counterpart.recall.decision")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The crash fallback, through the root: chunk-level gating and the ENGINE-SET
// channel that keeps a sweep from calling itself authorship
// ═══════════════════════════════════════════════════════════════════════════
describe("the crash fallback — an injected InterpretFn, gated a chunk at a time", () => {
  function interpreter(proposals: readonly unknown[], stopReason = "end_turn"): InterpretFn {
    return async (_chunk: SweepChunk) => ({ proposals, stopReason });
  }

  test("a sweep mints what the interpreter proposed, and consumes the spans it read", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "pre-compaction" });
    goQuiet();

    const reports = await c.sweepFallback({
      interpret: interpreter([
        {
          content: "The cache is rebuildable from canonical files, which is why it never enters the backup set.",
          kind: "fact",
        },
      ]),
    });
    const swept = reports.find((r) => r.ran);
    expect(swept?.reason).toBe("SWEPT");
    expect(swept?.proposals).toBe(1);
    expect(swept?.consumed).toBe(true);
    expect(c.events("counterpart.sweep.minted").length).toBe(1);
    expect(c.store.list({ type: "memory" }).length).toBe(1);
  });

  test("a FULLY GATED chunk moves no durable state at all (SEAMS item 1, scar §7b)", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();

    await c.sweepFallback({
      // Every proposal is a stub: the content floor refuses all of them.
      interpret: interpreter([{ content: "placeholder", kind: "fact" }, { content: "TBD", kind: "fact" }]),
    });
    const chunk = c.events("counterpart.sweep.chunk")[0];
    expect(chunk?.data?.fullyGated).toBe(true);
    expect(c.events("counterpart.sweep.minted")).toEqual([]);
    expect(c.store.list({ type: "memory" })).toEqual([]);
  });

  test("a TRUNCATED response is a failure, not data — and its spans come back (scar E2/E1)", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();

    const reports = await c.sweepFallback({
      interpret: interpreter([{ content: "A perfectly good memory that arrived inside a truncated response.", kind: "fact" }], "max_tokens"),
    });
    const swept = reports.find((r) => r.chunks.length > 0);
    expect(swept?.chunks[0]?.reason).toBe("TRUNCATED");
    expect(c.store.list({ type: "memory" })).toEqual([]);
    // Restored, not lost: the same spans are claimable at the next boundary.
    expect(c.spans.spans("proj").length).toBeGreaterThan(0);
  });

  test("the CHANNEL is engine-set: a self-claim arriving from a sweep is counted and NOT trained (SEAMS N)", async () => {
    const c = brain();
    seed(c);
    const element = c.store.put({
      type: "memory",
      kind: "self",
      body: "I hold the seam discipline steadily.",
      salience: { novelty: null, relevance: 0.8, emotional: 0.6, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    c.store.advanceClock("2026-08-26");
    c.store.advanceClock("2026-08-27");
    const before = c.store.physicsOf(element).uses;

    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();
    await c.sweepFallback({
      interpret: interpreter([
        {
          // The confabulated address — v1's own incident shape: a plausible id
          // that resolves to nothing. The ENGINE then matches the RESTATEMENT by
          // content, and saying the same thing again IS a confirmation.
          content: "I hold the seam discipline steadily in this work.",
          kind: "self",
          updates: "mem_deadbeefdead",
        },
      ]),
    });

    // Withheld movement, kept measurement — the doctrine's own scenario.
    expect(c.store.physicsOf(element).uses).toBe(before);
    const repeats = c.self.events().filter((e) => e.name === "self.claim.repeat");
    expect(repeats.length).toBe(1);
    expect(repeats[0]?.ref).toBe(element);
    expect(repeats[0]?.data?.frozen).toBe(true);
    expect(repeats[0]?.data?.source).toBe("fallback");
    expect(c.store.getMeta("self.claims.self.frozen")).toBe("1");
  });

  test("the SAME restatement through the authored front door DOES train", async () => {
    const c = brain();
    seed(c);
    const element = c.store.put({
      type: "memory",
      kind: "self",
      body: "I hold the seam discipline steadily.",
      salience: { novelty: null, relevance: 0.8, emotional: 0.6, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    c.store.advanceClock("2026-08-26");
    c.store.advanceClock("2026-08-27");
    const before = c.store.physicsOf(element).uses;

    const out = await c.submitSessionEnd(
      { content: "I hold the seam discipline steadily in this work.", kind: "self", updates: "mem_deadbeefdead" },
      { session: "s1", scope: "proj" },
    );
    expect(out.mint?.claim?.reason).toBe("live-lived-salience");
    expect(c.store.physicsOf(element).uses).toBeGreaterThan(before);
  });

  test("sessionEnd runs the sweep BEFORE the cycle, so what it recovers is inside the boundary", async () => {
    const c = brain();
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();

    const report = await c.sessionEnd({
      date: "2026-01-02",
      sweep: {
        interpret: interpreter([
          {
            content: "Canonical prose stays readable in any editor, which is the portability promise in one line.",
            kind: "fact",
            salience: { relevance: 0.9, emotional: 0.7, predictive: 0.8 },
          },
        ]),
      },
    });
    expect(report.sweeps.some((s) => s.ran)).toBe(true);
    // The cycle saw it: the memory exists and the briefing rendered after it.
    expect(c.store.list({ type: "memory" }).length).toBe(1);
    expect(c.wake(BUDGET_BYTES).text).toContain("any editor");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE CRASH GATE — the sweep is a fallback, never the primary mechanism
// (owner ruling 2026-09-04). A session is crashed when it holds uncovered spans,
// has recorded NO `session-end` boundary, and has had no boundary activity for
// CRASH_STALE_MS. Nothing else is ever read by a model.
// ═══════════════════════════════════════════════════════════════════════════
describe("the crash gate — only a crashed session's transcript is ever read", () => {
  /** Counts model calls, because the whole point of the gate is not making them. */
  function counting(calls: { n: number }): InterpretFn {
    return async (_chunk: SweepChunk) => {
      calls.n += 1;
      return {
        proposals: [
          {
            content: "The cache is rebuildable from canonical files, which is why it never enters the backup set.",
            kind: "fact",
          },
        ],
        stopReason: "end_turn",
      };
    };
  }

  function gateRows(c: Counterpart): Record<string, unknown>[] {
    return c.store
      .eventLog({ name: SWEEP_GATE_EVENT, limit: 100 })
      .map((row) => JSON.parse(row.payload ?? "{}") as Record<string, unknown>);
  }

  test("STOP with uncovered spans sweeps NOTHING — the author still has the pen", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });

    const calls = { n: 0 };
    const reports = await c.sweepFallback({ interpret: counting(calls) });
    expect(reports.map((r) => ({ ran: r.ran, reason: r.reason }))).toEqual([
      { ran: false, reason: "NO_CRASHED_SESSION" },
    ]);
    expect(calls.n).toBe(0);
    expect(c.store.list({ type: "memory" })).toEqual([]);
    // The spans are still there: withheld from the sweep, never dropped.
    expect(c.spans.spans("proj").length).toBeGreaterThan(0);
  });

  test("SESSION-END captures, and sweeps nothing — now or ever (the named cost)", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    const captured = c.spans.spans("proj").length;
    c.boundary({ session: "s1", scope: "proj", kind: "session-end" });
    expect(captured).toBeGreaterThan(0);

    const calls = { n: 0 };
    expect((await c.sweepFallback({ interpret: counting(calls) }))[0]?.reason).toBe("NO_CRASHED_SESSION");
    // And still not after the session goes quiet: a session that reached the
    // host's own end-of-session path GOT the pen. What it chose not to write is
    // forgotten by design (constitution 3), not recovered by a paraphrase.
    goQuiet();
    expect((await c.sweepFallback({ interpret: counting(calls) }))[0]?.reason).toBe("NO_CRASHED_SESSION");
    expect(calls.n).toBe(0);
    expect(c.spans.spans("proj").length).toBe(captured);
  });

  test("PRE-COMPACTION captures and sweeps nothing — the backstop is the capture, not the call", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "pre-compaction" });
    const calls = { n: 0 };
    expect((await c.sweepFallback({ interpret: counting(calls) }))[0]?.reason).toBe("NO_CRASHED_SESSION");
    expect(calls.n).toBe(0);

    // A compaction is NOT a session end, though: if the session never comes back,
    // the silence makes it crashed and the spans are recovered.
    goQuiet();
    const after = await c.sweepFallback({ interpret: counting(calls) });
    expect({ ran: after[0]?.ran, reason: after[0]?.reason }).toEqual({ ran: true, reason: "SWEPT" });
    expect(calls.n).toBe(1);
  });

  test("a session quiet past the window with no session-end is swept ONCE, and then covered", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();

    const calls = { n: 0 };
    const first = await c.sweepFallback({ interpret: counting(calls) });
    expect({ ran: first[0]?.ran, reason: first[0]?.reason, proposals: first[0]?.proposals }).toEqual({
      ran: true,
      reason: "SWEPT",
      proposals: 1,
    });
    expect(c.store.list({ type: "memory" }).length).toBe(1);

    // ONCE. The spans were consumed, so the next worker run — same crashed
    // session, same boundary record — spends nothing.
    const second = await c.sweepFallback({ interpret: counting(calls) });
    expect(second.map((r) => r.reason)).toEqual(["NOTHING_TO_SWEEP"]);
    expect(calls.n).toBe(1);
    expect(c.store.list({ type: "memory" }).length).toBe(1);
  });

  test("a session that ended NORMALLY is never swept, even with uncovered trailing spans", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "session-end" });
    // The trailing stretch: turns after the session-end boundary, uncovered.
    c.captureSpans({
      session: "s1",
      scope: "proj",
      turns: [
        ...TURNS,
        { role: "user", text: "One more thought after the ritual: the backup set is the honest part." },
      ],
    });
    const trailing = c.spans.coverageReport("proj");
    expect(trailing.uncovered).toBeGreaterThan(0);

    goQuiet();
    const calls = { n: 0 };
    const reports = await c.sweepFallback({ interpret: counting(calls) });
    expect(reports.map((r) => r.reason)).toEqual(["NO_CRASHED_SESSION"]);
    expect(calls.n).toBe(0);
    // The KNOWN COST, asserted rather than assumed: those turns are never
    // encoded by anyone. They are still readable in the buffer.
    expect(c.spans.coverageReport("proj").uncovered).toBe(trailing.uncovered);
  });

  test("the SKIP is a durable, countable record — silence that says it is silence", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });

    const calls = { n: 0 };
    await c.sweepFallback({ interpret: counting(calls) });
    const quiet = gateRows(c);
    expect(quiet.length).toBe(1);
    expect({ scopes: quiet[0]?.["scopes"], ran: quiet[0]?.["ran"], skipped: quiet[0]?.["skippedNotCrashed"] }).toEqual({
      scopes: 1,
      ran: 0,
      skipped: 1,
    });
    expect(quiet[0]?.["crashStaleMs"]).toBe(REMEMBER_TUNABLES.CRASH_STALE_MS);
    // The ring carries the same reading, per scope, with its own reason.
    expect(c.events("remember.sweep.skipped")[0]?.data?.reason).toBe("NO_CRASHED_SESSION");

    // And a run that DID sweep is a different row — "silent" and "worked" are
    // never the same record (constitution 16, scar §2.4).
    goQuiet();
    await c.sweepFallback({ interpret: counting(calls) });
    const rows = gateRows(c);
    expect(rows.length).toBe(2);
    expect({ ran: rows[1]?.["ran"], skipped: rows[1]?.["skippedNotCrashed"], minted: rows[1]?.["minted"] }).toEqual({
      ran: 1,
      skipped: 0,
      minted: 1,
    });
  });

  test("the row is TOTAL BY REASON: every SweepReason counted, zeros included (G48)", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    const calls = { n: 0 };
    await c.sweepFallback({ interpret: counting(calls) });

    const row = gateRows(c)[0] as Record<string, unknown>;
    const refusals = row["refusals"] as Record<string, number>;
    // EVERY reason is a key, even at zero: "did not happen" and "this reader
    // cannot tell" are different facts (scar section 2.4).
    expect(Object.keys(refusals).sort()).toEqual([...SWEEP_REASONS].sort());
    // TOTAL over the reports — the map accounts for the whole run, refusals and
    // sweeps alike, so `scopes` can be re-derived from it.
    expect(Object.values(refusals).reduce((a, b) => a + b, 0)).toBe(row["scopes"] as number);
    expect(refusals["NO_CRASHED_SESSION"]).toBe(1);
    expect(refusals["SWEPT"]).toBe(0);
    // The quiet day the live run kept mistaking for a busy one: the old
    // `otherRefusals` counter said nothing, and `noisyRefusals` says zero.
    expect(row["noisyRefusals"]).toBe(0);
    // KEPT for the readers and the rows already written (never removed).
    expect(row["otherRefusals"]).toBe(0);

    // A scope that DID sweep lands under `SWEPT`, not among the refusals.
    goQuiet();
    await c.sweepFallback({ interpret: counting(calls) });
    const swept = gateRows(c)[1] as Record<string, unknown>;
    expect((swept["refusals"] as Record<string, number>)["SWEPT"]).toBe(1);
    expect(swept["noisyRefusals"]).toBe(0);
  });

  test("a BELOW_MIN_CLAIM refusal is a CHRONIC CANDIDATE, counted apart from the alarm", async () => {
    const c = brain();
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();
    const calls = { n: 0 };
    // A minimum no buffer of this size can reach: the claim is refused before a
    // model is ever asked, which is the chronic case G48 wants visible.
    await c.sweepFallback({ interpret: counting(calls), minBytes: 10_000_000 });
    expect(calls.n).toBe(0);

    const row = gateRows(c)[0] as Record<string, unknown>;
    const refusals = row["refusals"] as Record<string, number>;
    expect(refusals["BELOW_MIN_CLAIM"]).toBe(1);
    // NOT the alarm. The leftover is restored to the buffer and the session is
    // never forgotten, so this scope answers BELOW_MIN_CLAIM on every run from
    // now on — and a reader that ambered on the first one would amber forever.
    expect(row["noisyRefusals"]).toBe(0);
    expect(row["chronicCandidates"]).toBe(1);
    // The number the comment used to call a bad day counts this one the same as
    // a retired crashed session — which is why it is no longer the reading.
    expect(row["otherRefusals"]).toBe(1);

    // AND IT REPEATS, which is the whole argument: the same scope, the same
    // refusal, with nothing new having crashed.
    await c.sweepFallback({ interpret: counting(calls), minBytes: 10_000_000 });
    const again = gateRows(c)[1] as Record<string, unknown>;
    expect((again["refusals"] as Record<string, number>)["BELOW_MIN_CLAIM"]).toBe(1);
    expect(again["noisyRefusals"]).toBe(0);
    expect(again["chronicCandidates"]).toBe(1);
  });

  test("an OBSERVER writes no gate row at all", async () => {
    // A store that already exists, and a crashed session inside it, so "no row"
    // is a stand-down rather than an empty store with nothing to record.
    const writable = brain();
    writable.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    writable.boundary({ session: "s1", scope: "proj", kind: "stop" });
    goQuiet();
    writable.close();

    const probe = brain({ observer: true });
    const calls = { n: 0 };
    const reports = await probe.sweepFallback({ interpret: counting(calls) });
    expect(reports.every((r) => !r.ran)).toBe(true);
    expect(gateRows(probe)).toEqual([]);
    expect(calls.n).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Observer stance, end to end: the instrument leaves the store as it found it
// ═══════════════════════════════════════════════════════════════════════════
describe("observer stance — a full lifecycle leaves canonical state byte-identical", () => {
  /** Every canonical byte under the data dir, hashed per relative path. Box 3
   *  (`cache/`) is excluded BY NAME: it is declared rebuildable, never backed up,
   *  and observer-mode's open question 2 is about exactly its residue. */
  function canonicalSnapshot(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (abs: string, rel: string): void => {
      for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (rel === "" && (entry.name === "cache" || entry.name === "tmp")) continue;
        const nextAbs = join(abs, entry.name);
        const nextRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(nextAbs, nextRel);
        else out[nextRel] = createHash("sha256").update(readFileSync(nextAbs)).digest("hex");
      }
    };
    walk(root, "");
    return out;
  }

  /** Populate a store the ordinary way, then close it. */
  async function populated(): Promise<void> {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike", aliases: ["mike"] } });
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    await c.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown, so the owner can read their own memory in any editor.",
        kind: "fact",
        salience: { relevance: 0.8, emotional: 0.6, predictive: 0.7 },
      },
      { session: "s1", scope: "proj" },
    );
    c.boundary({ session: "s1", scope: "proj", kind: "stop" });
    await c.sessionEnd({ date: "2026-01-02", at: "2026-01-02" });
    c.close();
  }

  test("a probe runs the WHOLE lifecycle and changes not one canonical byte (scar E7)", async () => {
    await populated();
    const before = canonicalSnapshot(dir);

    const probe = Counterpart.open({ dir, observer: true, owner: true });
    // The wake is DELIVERED to an observer: observation is a read (§1 G8).
    const woke = probe.wake(BUDGET_BYTES);
    expect(woke.ok).toBe(true);
    // Everything else stands down — and every stand-down is on the record.
    expect(probe.captureSpans({ session: "s2", scope: "proj", turns: TURNS }).reason).toBe("OBSERVER");
    expect(probe.captureJot({ session: "s2", scope: "proj", text: "a jot from an instrument" }).reason).toBe("OBSERVER");
    expect((await probe.submitSessionEnd({ content: "An instrument's memory, which must never land.", kind: "fact" }, { session: "s2", scope: "proj" })).reason).toBe("observer");
    probe.boundary({ session: "s2", scope: "proj", kind: "stop" });
    probe.episodeAsk("s2", { turns: 12, bytes: 9_000 });
    probe.appendEpisode("s2", "An instrument's reflection, which must never land either.");
    expect(probe.ingestEpisode({ sessionId: "s2" }).reason).toBe("observer");
    // Reading still works: an observer still sees, it just leaves no trace.
    const turn = probe.recallForTurn({ sessionId: "s2", text: "how does the storage split work" });
    expect(turn.decision.observer).toBe(true);
    expect(probe.resolveUse("s2", probe.store.list({ type: "memory" })[0] ?? "", "referenced").reason).toBe("observer");
    const report = await probe.sessionEnd({ date: "2026-01-03", at: "2026-01-03" });
    expect(report.cycle.observer).toBe(true);
    probe.close();

    expect(canonicalSnapshot(dir)).toEqual(before);
  });

  test("the boundary appends no span and the cycle materializes nothing", async () => {
    await populated();
    const probe = Counterpart.open({ dir, observer: true });
    const spansBefore = probe.spans.spans("proj").length;
    probe.boundary({ session: "s2", scope: "proj", kind: "pre-compaction" });
    expect(probe.spans.spans("proj").length).toBe(spansBefore);
    expect(probe.spans.events("remember.observer.standdown").length).toBeGreaterThan(0);

    const rankingBefore = probe.store.rankingAll().size;
    await probe.sessionEnd({ date: "2026-01-03", budgetBytes: BUDGET_BYTES });
    // The instrument writes no cache either: whatever the last real cycle
    // materialized is exactly what is still there.
    expect(probe.store.rankingAll().size).toBe(rankingBefore);
    probe.close();
  });

  /**
   * FOUND LIVE, writing this file: `dataDir()` asserts the guard for the
   * environment-resolved path, but an EXPLICIT `dir` reached `Store.open`
   * unchecked — so this very test created a directory under `~/.bansai` before
   * the root asserted it. Scar §2.13 in its own miniature: the guard existed,
   * and the entrance nobody guarded is the one a caller uses.
   */
  test("an explicit data dir aimed at v1's live store is refused BEFORE anything is created", () => {
    const aimed = join(homedir(), ".bansai", "counterparts-guard-probe");
    expect(() => Counterpart.open({ dir: aimed })).toThrow();
    expect(() => Counterpart.open({ dir: join(homedir(), ".claude-engram") })).toThrow();
    expect(() => Counterpart.open({ dir: join(homedir(), ".bansai", "..", ".bansai", "x") })).toThrow();
    // The refusal is BEFORE creation: nothing was made on the way to throwing.
    expect(existsSync(aimed)).toBe(false);
  });

  /**
   * LAUNCH-STATUS I21, in the exact shape of the incident: a caller passed the
   * WRONG OPTION NAME, so `dir` was undefined, the default answered, and on the
   * owner's machine the default is his live memory. `.counterparts` cannot join
   * `FORBIDDEN_ROOT_NAMES` (the store must open its own default), so the guard
   * is `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` — armed for this whole suite by
   * `test/preload.ts` — and it refuses the FALLBACK by name, never a named dir.
   */
  test("with the explicit-dir guard armed, a caller who named no dir — or misnamed the option — is refused before anything opens (I21)", () => {
    const codeOf = (f: () => unknown): string | undefined => {
      try {
        f();
        return undefined;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    delete process.env[ENV];
    try {
      // The incident: `dataDir` is not an option `Counterpart.open` takes.
      const misnamed = { dataDir: dir } as unknown as Parameters<typeof Counterpart.open>[0];
      expect(codeOf(() => Counterpart.open(misnamed))).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      expect(codeOf(() => Counterpart.open({}))).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      expect(codeOf(() => Counterpart.open({ observer: true }))).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      // Refused on path arithmetic alone: the default's parent was never made.
      expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);
      // A NAMED dir opens with the guard armed and the variable unset: the guard
      // is about the fallback, not about callers who said which store they meant.
      const named = Counterpart.open({ dir });
      open.push(named);
      expect(named.store.dir).toBe(dir);
    } finally {
      process.env[ENV] = dir;
    }
    // And `COUNTERPARTS_DATA_DIR` names it too.
    const viaEnv = Counterpart.open({});
    open.push(viaEnv);
    expect(viaEnv.store.dir).toBe(dir);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The rebuild contract, reached through the root (store §5, scar §2.12)
// ═══════════════════════════════════════════════════════════════════════════
describe("the DB is a cache — everything indexed is reconstructible from canonical files", () => {
  test("a rebuilt cache recalls the same memory the original did", async () => {
    const c = brain();
    seed(c);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    const deposit = await c.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown files that any editor can open.",
        kind: "fact",
        salience: { relevance: 0.8, emotional: 0.6, predictive: 0.7 },
      },
      { session: "s1", scope: "proj" },
    );
    const memoryId = deposit.memoryId as string;
    const before = c.recallForTurn({ sessionId: "s1", text: "canonical prose in markdown files" });
    expect([...before.decision.surfaced, ...before.decision.footnotes]).toContain(memoryId);

    c.store.rebuildCache();
    const after = c.recallForTurn({ sessionId: "s3", text: "canonical prose in markdown files" });
    expect([...after.decision.surfaced, ...after.decision.footnotes]).toContain(memoryId);
  });

  test("the store the root opens is the store the seams tests open (no second layout)", () => {
    const c = brain();
    expect(() => c.store.assertLayout()).not.toThrow();
    expect(c.store.backupSet()).toContain("spans");
    // And a second handle over the same dir sees the same canonical files.
    const other = Store.open({ dir });
    expect(other.list()).toEqual(c.store.list());
    other.close();
  });
});

describe("birth by mention is AMBIENT through the composition (cli gaps §8 closed)", () => {
  test("a titled entity dump births a stub the moment the memory lands", async () => {
    const c = brain();
    const deposit = await c.submitSessionEnd(
      {
        content:
          "Met the team behind Huckleberry Syrup today; Huckleberry Syrup supplies the lodge kitchens.",
        kind: "entity",
        title: "Huckleberry Syrup",
      },
      { session: "s1", scope: "proj" },
    );
    expect(deposit.deposited).toBe(true);
    // The mention reached schemas with no tool, no chore, no separate call.
    const mentions = c.events("counterpart.mention");
    expect(mentions.length).toBe(1);
    expect(mentions[0]?.data?.["reason"]).toBe("born");
    const entities = c.schemas.slices().filter((sl) => sl.name === "Huckleberry Syrup");
    expect(entities.length).toBe(1);
    c.close();
  });

  test("a fact dump with a title births nothing, and no title means no mention", async () => {
    const c = brain();
    const fact = await c.submitSessionEnd(
      { content: "The lodge kitchen orders syrup on Tuesdays, per the calendar.", kind: "fact", title: "syrup schedule" },
      { session: "s1", scope: "proj" },
    );
    expect(fact.deposited).toBe(true);
    const untitled = await c.submitSessionEnd(
      { content: "A second plain observation about kitchens, without any naming.", kind: "entity" },
      { session: "s1", scope: "proj" },
    );
    expect(untitled.deposited).toBe(true);
    expect(c.events("counterpart.mention").length).toBe(0);
    c.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE TWO U9 ROWS — the cycle and the wake render, durable
//
// `sleep/cycle.ts` emits `sleep.cycle.start`, `sleep.cycle.done` and
// `sleep.phase.failed` into an in-process ring that dies with the worker, and
// `self/` emits `self.briefing.trim` into another one. From the store nobody
// could answer "did the cycle run today, did every phase succeed, what did the
// wake trim" (IMPROVEMENTS U9). These are the rows that answer it, in the shape
// `sweep.gate` already has: one row per run, `reason` always present, ids-only
// payloads, an append that fails costing the ROW and never the caller.
// ═══════════════════════════════════════════════════════════════════════════
describe("the sleep cycle and the wake render each leave one durable row", () => {
  function rowsOf(c: Counterpart, name: string): Record<string, unknown>[] {
    return c.store
      .eventLog({ name, limit: 100 })
      .map((row) => JSON.parse(row.payload ?? "{}") as Record<string, unknown>);
  }

  interface PhaseLine {
    phase: string;
    status: string;
    reason: string;
    code?: string;
    reconciled?: number;
  }
  const phasesOf = (payload: Record<string, unknown>): PhaseLine[] =>
    payload["phases"] as PhaseLine[];

  test("ONE sleep.cycle row per boundary, naming every phase in the cycle's order, none failed", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });

    const rows = rowsOf(c, SLEEP_CYCLE_EVENT);
    expect(rows.length).toBe(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("ran");
    expect(row["date"]).toBe("2026-01-02");
    expect(typeof row["day"]).toBe("number");
    // EVERY phase, by name, in the order the cycle ran them — that is the whole
    // question the row exists to answer, and a count would not answer it.
    expect(phasesOf(row).map((p) => p.phase)).toEqual([...PHASES]);
    // `ok` is not a status this codebase has: the report's vocabulary is
    // ran / ran-nothing-found / did-not-run / failed, copied verbatim.
    expect(phasesOf(row).filter((p) => p.status === "failed")).toEqual([]);
    expect(row["failed"]).toBe(0);
    expect(row["code"]).toBe(null);
    for (const count of ["promoted", "pruned", "merged", "bandUp", "bandDown", "trimmed"]) {
      expect(typeof row[count]).toBe("number");
    }
  });

  test("a phase that THROWS is named `failed` in the row with its code, and the cycle still completes", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    // The `versions` phase calls exactly this, and nothing else does.
    const boom = Object.assign(new Error("no"), { code: "VERSIONS_BOOM" });
    (c.store as unknown as { pruneSupersededVersions: () => never }).pruneSupersededVersions =
      () => {
        throw boom;
      };

    const report = await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    // Degrade, don't abort: the boundary returned, and the phases after the
    // failed one still ran.
    expect(report.cycle.phases.length).toBe(PHASES.length);

    const row = rowsOf(c, SLEEP_CYCLE_EVENT)[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("ran");
    expect(row["failed"]).toBe(1);
    const versions = phasesOf(row).find((p) => p.phase === "versions");
    expect(versions?.status).toBe("failed");
    // `reason` for a failure is the literal word "failed"; the WHY is the code.
    expect(versions?.reason).toBe("failed");
    expect(versions?.code).toBe("VERSIONS_BOOM");
    // The briefing ran after it, so the wake row is there too.
    expect(rowsOf(c, SELF_BRIEFING_EVENT).length).toBe(1);
  });

  test("a decay pass that ONLY reconciled the band column says `ran` and says how many (U8)", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    // Night one brings the ranking cache and the band column to physics.
    await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const night1 = rowsOf(c, SLEEP_CYCLE_EVENT).find((r) => r["date"] === "2026-01-02");
    const first = phasesOf(night1!).find((p) => p.phase === "decay");
    expect(typeof first?.reconciled).toBe("number");

    // Now the exact U8 shape: the CACHE stays right and the COLUMN is put
    // wrong, so `moved` is false for every row and the pass's only work is the
    // reconciliation. Before this fix it issued one UPDATE per row and then
    // filed itself as `ran-nothing-found` / `nothing-to-do`.
    const ids = c.store.list({ type: "memory", archived: false });
    expect(ids.length).toBeGreaterThan(0);
    const settled = new Map(ids.map((id) => [id, c.store.row(id)!.band]));
    for (const [id, was] of settled) {
      c.store.setBand(id, was === "semantic" ? "episodic" : "semantic", c.store.livedDay());
    }

    c.wake(BUDGET_BYTES);
    await c.sessionEnd({ date: "2026-01-03", budgetBytes: BUDGET_BYTES });
    const night2 = rowsOf(c, SLEEP_CYCLE_EVENT).find((r) => r["date"] === "2026-01-03");
    const decay = phasesOf(night2!).find((p) => p.phase === "decay");
    expect(decay?.status).toBe("ran");
    expect(decay?.reason).toBe("completed");
    // THE NUMBER, on the durable row — the count that reached nothing before.
    expect(decay?.reconciled).toBe(ids.length);
    // And the table agrees with the arithmetic again.
    for (const [id, was] of settled) expect(c.store.row(id)?.band).toBe(was);
  });

  test("a CLOCK that will not advance leaves the row with reason `clock-failed` and its code", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    (c.store as unknown as { advanceClock: () => never }).advanceClock = () => {
      throw Object.assign(new Error("torn"), { code: "CLOCK_TORN" });
    };

    await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const row = rowsOf(c, SLEEP_CYCLE_EVENT)[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("clock-failed");
    expect(row["code"]).toBe("CLOCK_TORN");
    // The cycle continued on the day the store already believed in: the other
    // phases are still in the row, by name.
    expect(phasesOf(row).map((p) => p.phase)).toEqual([...PHASES]);
    expect(phasesOf(row).find((p) => p.phase === "clock")?.status).toBe("failed");
  });

  test("a cycle that THREW leaves a row saying so — and the throw still reaches the caller", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    // `CycleKilled` is the watchdog's hard kill wearing an exception's clothes:
    // `sleep/` deliberately does not paper over it, and neither does this row.
    (c.store as unknown as { advanceClock: () => never }).advanceClock = () => {
      throw new CycleKilled({ phase: "clock", stage: "start" });
    };

    await expect(c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES })).rejects.toThrow(
      CycleKilled,
    );
    const row = rowsOf(c, SLEEP_CYCLE_EVENT)[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("threw");
    expect(typeof row["code"]).toBe("string");
    // No report existed to read phases out of, and the row says that by being
    // empty rather than by naming phases nobody observed.
    expect(row["phases"]).toEqual([]);
    expect(row["date"]).toBe("2026-01-02");
    // The render never happened, so there is no wake row to write.
    expect(rowsOf(c, SELF_BRIEFING_EVENT).length).toBe(0);
  });

  test("a cycle that dies AFTER seven phases says so — the row never reads as a quiet clean night", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    await c.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown files, which any editor can read.",
        kind: "fact",
        salience: { relevance: 0.9, emotional: 0.7, predictive: 0.8 },
      },
      { session: "s1", scope: "proj" },
    );
    // The LAST phase's marker advance, which runs outside the phase body's own
    // degrade-don't-abort wrapper: seven phases have finished and the briefing
    // has trimmed by the time this throws.
    const realSetMeta = c.store.setMeta.bind(c.store);
    (c.store as unknown as { setMeta: typeof realSetMeta }).setMeta = (key, value) => {
      if (key === "sleep.marker.log") throw Object.assign(new Error("gone"), { code: "DISK_FULL" });
      realSetMeta(key, value);
    };

    await expect(
      c.sessionEnd({ date: "2026-01-02", budgetBytes: SMALL_BUDGET_BYTES }),
    ).rejects.toThrow();

    const row = rowsOf(c, SLEEP_CYCLE_EVENT)[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("threw");
    expect(row["code"]).toBe("DISK_FULL");
    // The work it DID do, by name — the whole point. Not an empty list.
    expect(phasesOf(row).map((p) => p.phase)).toEqual(PHASES.slice(0, PHASES.length - 1));
    // And how many it had entered, so the phase that died is the difference.
    expect(row["started"]).toBe(PHASES.length);
    // NULL, not 0: this cycle never finished counting these, and a zero would
    // read a week later as "nothing was promoted, nothing was pruned".
    for (const count of ["promoted", "pruned", "merged", "bandUp", "bandDown"]) {
      expect(row[count]).toBe(null);
    }
    // What IS known stays known: the briefing ran, and its trim is real.
    expect(row["trimmed"]).toBe(c.events("self.briefing.trim").length);
    expect(row["trimmed"]).toBeGreaterThan(0);
    expect(rowsOf(c, SELF_BRIEFING_EVENT).length).toBe(1);
  });

  test("a CycleKilled names where the kill landed — the phase and the stage", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    const realSetMeta = c.store.setMeta.bind(c.store);
    (c.store as unknown as { setMeta: typeof realSetMeta }).setMeta = (key, value) => {
      if (key === "sleep.marker.dedup") throw new CycleKilled({ phase: "dedup", stage: "marked" });
      realSetMeta(key, value);
    };

    await expect(c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES })).rejects.toThrow(
      CycleKilled,
    );
    const row = rowsOf(c, SLEEP_CYCLE_EVENT)[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("threw");
    expect(row["failedPhase"]).toBe("dedup");
    expect(row["stage"]).toBe("marked");
  });

  test("an OBSERVER writes NEITHER row — an instrument leaves the world as it found it", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    c.close();

    const watcher = brain({ dir, observer: true });
    const before = {
      cycle: rowsOf(watcher, SLEEP_CYCLE_EVENT).length,
      briefing: rowsOf(watcher, SELF_BRIEFING_EVENT).length,
    };
    await watcher.sessionEnd({ date: "2026-01-03", budgetBytes: BUDGET_BYTES });
    expect(rowsOf(watcher, SLEEP_CYCLE_EVENT).length).toBe(before.cycle);
    expect(rowsOf(watcher, SELF_BRIEFING_EVENT).length).toBe(before.briefing);
  });

  test("the self.briefing row's lane counts and trimmed ids ARE the render's own — not a second count", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    await c.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown files, which any editor can read.",
        kind: "fact",
        salience: { relevance: 0.9, emotional: 0.7, predictive: 0.8 },
      },
      { session: "s1", scope: "proj" },
    );
    // A ceiling small enough that the trim order has to act.
    await c.sessionEnd({ date: "2026-01-02", budgetBytes: SMALL_BUDGET_BYTES });

    const rows = rowsOf(c, SELF_BRIEFING_EVENT);
    expect(rows.length).toBe(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row["reason"]).toBe("rendered");
    expect(row["date"]).toBe("2026-01-02");
    expect(row["budget"]).toBe(SMALL_BUDGET_BYTES - PREFACE_RESERVE_BYTES);

    // The render's own summary, in this process's ring, is the reference: the
    // row must restate it rather than recount the lanes a second time.
    const rendered = c.events("self.briefing.rendered").pop();
    expect(rendered).toBeDefined();
    expect(row["bytes"]).toBe(rendered?.data?.["bytes"]);
    const counts = row["counts"] as Record<string, number>;
    expect(Object.keys(counts)).toEqual([...LANE_ORDER]);
    for (const lane of LANE_ORDER) {
      expect(counts[lane]).toBe(rendered?.data?.[lane] as number);
    }

    const trims = c.events("self.briefing.trim");
    expect(trims.length).toBeGreaterThan(0);
    expect(row["trimmedTotal"]).toBe(trims.length);
    expect(row["trimmed"]).toEqual(
      trims.map((e) => ({ id: e.ref ?? null, lane: e.data?.["lane"] ?? null })),
    );
    // And the cycle row's `trimmed` count is the same reading.
    expect((rowsOf(c, SLEEP_CYCLE_EVENT)[0] as Record<string, unknown>)["trimmed"]).toBe(
      trims.length,
    );
  });

  test("REBRIEF publishes a new bundle, so it leaves its own row — reason `rebrief`", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    await c.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown files, which any editor can read.",
        kind: "fact",
        salience: { relevance: 0.9, emotional: 0.7, predictive: 0.8 },
      },
      { session: "s1", scope: "proj" },
    );
    await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    expect(rowsOf(c, SELF_BRIEFING_EVENT).length).toBe(1);

    // The owner pulls the lever at a tighter ceiling: this RENDERS, TRIMS and
    // PUBLISHES, so without a row the last one in the store would describe a
    // bundle nobody is reading any more.
    const report = c.rebrief({ budgetBytes: SMALL_BUDGET_BYTES });
    expect(report.published).toBe(true);

    const rows = rowsOf(c, SELF_BRIEFING_EVENT);
    expect(rows.length).toBe(2);
    const row = rows[1] as Record<string, unknown>;
    // Named apart from the boundary's row: one is the DAY's record, this is the
    // owner mid-day, and a reader counting wake renders must tell them apart.
    expect(row["reason"]).toBe("rebrief");
    expect(row["bytes"]).toBe(report.bytes);
    expect(row["budget"]).toBe(SMALL_BUDGET_BYTES - PREFACE_RESERVE_BYTES);
    expect((row["counts"] as Record<string, number>)["identity"]).toBe(
      report.counts["identity"] ?? 0,
    );
    expect(typeof row["trimmedTotal"]).toBe("number");
  });

  test("a rebrief that REFUSES for want of a ceiling renders nothing and leaves no row", () => {
    const blind = brain();
    seed(blind);
    expect(blind.rebrief().rendered).toBe(false);
    expect(rowsOf(blind, SELF_BRIEFING_EVENT).length).toBe(0);
  });

  test("a failed appendEvent costs the ROW, never the boundary", async () => {
    const c = brain();
    seed(c);
    c.wake(BUDGET_BYTES);
    const real = c.store.appendEvent.bind(c.store);
    (c.store as unknown as { appendEvent: typeof real }).appendEvent = (input) => {
      if (input.name === SLEEP_CYCLE_EVENT || input.name === SELF_BRIEFING_EVENT) {
        throw Object.assign(new Error("locked"), { code: "SQLITE_BUSY" });
      }
      return real(input);
    };

    // The boundary RETURNS — that is the guarantee.
    const report = await c.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    expect(report.cycle.phases.length).toBe(PHASES.length);
    expect(c.events("counterpart.sleep.cycle.failed")[0]?.data?.["code"]).toBe("SQLITE_BUSY");
    expect(c.events("counterpart.self.briefing.failed")[0]?.data?.["code"]).toBe("SQLITE_BUSY");
    // And the ring event says the row did not land, rather than implying it did.
    expect(c.events("counterpart.sleep.cycle")[0]?.data?.["durable"]).toBe(false);
    expect(c.events("counterpart.self.briefing")[0]?.data?.["durable"]).toBe(false);
  });
});
