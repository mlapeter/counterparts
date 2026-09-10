/**
 * `tools/replay/driver.ts` — the pipeline driver.
 *
 * Feeds a corpus of v1 raw spans through Counterparts DAY BY DAY on the lived-day
 * clock (scar E8: days actually lived, never calendar days), into a store the
 * driver creates and owns.
 *
 * WHICH PATH IT DRIVES, AND WHY. v1 interpreted spans with a sweep; v2's primary
 * path is the experiencer writing its own memories, and that path has no v1
 * counterpart to replay against (CONTRACT §7 OQ2). What the corpus CAN validate
 * is the crash-fallback composition — `Counterpart.sweepFallback` with an
 * injected `InterpretFn` — and everything downstream of it: the chunk gate,
 * minting, the boundary cycle, decay, banding, briefing. That is what this
 * drives, through `Counterpart`'s own methods in the order a host calls them
 * (capture → boundary → sessionEnd), never by reaching into modules and
 * threading state a production caller never has (guarantee 6).
 *
 * ISOLATION, MECHANIZED (guarantee 1, scar §2.13):
 *   - `assertNoPresetDataDir()` ERRORS when `COUNTERPARTS_DATA_DIR` is set,
 *     rather than honoring it. v1's own harness silently honored an exported
 *     variable while its header claimed a throwaway directory.
 *   - the store dir is `mkdtemp`ed unconditionally, run through the store's own
 *     `assertSafeDataDir`, and checked against the corpus dir in BOTH directions
 *     with realpaths.
 *   - `cleanup()` removes ONLY the directory this driver created.
 *
 * NOT OBSERVER, deliberately. Guarantee 3 says the harness leaves the stores it
 * READS as it found them — which the corpus reader guarantees structurally, by
 * having no write path at all. The replay store is the instrument's own bench:
 * under observer, `sweep()` stands down and `gateSweepChunk` moves nothing, so an
 * observer brain would replay exactly nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, resolve } from "node:path";

import { Counterpart } from "../../src/core/counterpart.js";
import type { CounterpartEvent, LiveVectors } from "../../src/core/counterpart.js";
import { band as liveBand } from "../../src/core/physics/index.js";
import type { InterpretFn, Turn } from "../../src/core/remember/index.js";
import type { IdentityCoreSpec } from "../../src/core/self/index.js";
import { DATA_DIR_ENV, DEFAULT_RETENTION_DAYS, assertSafeDataDir } from "../../src/core/store/index.js";
import type { Embedder } from "../../src/core/store/index.js";
import type { CycleReport } from "../../src/core/sleep/index.js";

import { Corpus } from "./corpus.js";
import type { CorpusSpan } from "./corpus.js";
import type {
  BandTransitionSummary,
  ChunkSummary,
  CycleSummary,
  DaySummary,
  DepositRecordSummary,
  GateRecordSummary,
  ObservedEvent,
  ReplayObservation,
  RunRecord,
  StoreCensus,
  SweepSummary,
  SymmetryVerdictSummary,
} from "./types.js";

export const HARNESS_VERSION = "replay/2";

/** High enough that a replay's whole durable log is read, never a window: a
 *  truncated read would understate a rate and look like a result. */
const LOG_LIMIT = 1_000_000;

export class DriverError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, string | number | boolean>>;
  constructor(code: string, detail: Record<string, string | number | boolean> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "DriverError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Guarantee 1's first half. An exported data-directory variable is an ERROR
 * here, never an instruction: the harness makes its own directory or does not
 * run at all.
 */
export function assertNoPresetDataDir(env: NodeJS.ProcessEnv = process.env): void {
  const preset = env[DATA_DIR_ENV];
  if (preset !== undefined && preset.trim().length > 0) {
    throw new DriverError("DATA_DIR_PRESET", { variable: DATA_DIR_ENV });
  }
}

function within(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface DriverOptions {
  readonly corpus: Corpus;
  /** The model call. A deterministic fake for tests; the real interpreter for a
   *  real run (streaming, headroom, detachment are ITS problem — scar E2/E3). */
  readonly interpret: InterpretFn;
  /** The acting model seat, recorded in the run record (guarantee 8). */
  readonly seat: string;
  /** The pinned vector generation, or "none" (guarantee 7). */
  readonly vectors: string;
  /** The host's reported injection ceiling. No default lives in `src/` (§2.18);
   *  the harness IS the host here, so it reports one explicitly. */
  readonly budgetBytes: number;
  /** Parent for the temp store dir. Defaults to the OS temp dir. */
  readonly workRoot?: string;
  readonly minBytes?: number;
  readonly chunkBytes?: number;
  /**
   * The session's wall clock (§I7). ABSENT IS NOT `Date.now` HERE: a replay that
   * dated a 2025 corpus with today's date would write a store whose every row
   * claims to have been learned on the day the harness ran, which is the exact
   * finding this option closes. The default is THE CORPUS DAY — 12:00 UTC on the
   * date currently being replayed — so `learnedOn`, event `at` and the version
   * rows all land on the day whose transcripts produced them. Pass a function to
   * override; the corpus day is still what the driver moves under it.
   */
  readonly now?: () => number;
  readonly identity?: IdentityCoreSpec;
  /** Both halves of a live embedder, when the run wires one (--embed): the
   *  sync face box 3 indexes through and the live face the novelty seam and
   *  the cards' semantic channel use. Absent = a lexical-only run, and the
   *  report says which. (`vectors` above is the PINNED GENERATION NAME on the
   *  run record — a different thing, hence the distinct field name here.) */
  readonly embed?: Embedder;
  readonly liveVectors?: LiveVectors;
  readonly onDay?: (date: string, index: number, total: number) => void;
}

export interface ReplayRun {
  readonly record: RunRecord;
  readonly observation: ReplayObservation;
  readonly counterpart: Counterpart;
  readonly storeDir: string;
  /** Closes the brain and removes ONLY the directory this run created. */
  cleanup(): void;
}

/**
 * A corpus date → the instant the replay's provenance clock reads on that day.
 *
 * Midday UTC. The corpus records a DAY, not a time, and every date this codebase
 * writes is `toISOString().slice(0, 10)` — so an instant in the middle of the day
 * round-trips to the same date under any of them.
 */
export function corpusInstant(date: string): number {
  const at = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(at) ? 0 : at;
}

/** Spans → turns. One span is one turn (see NOTES §2 — v1's `from`/`to` cursor
 *  span can cover several, and the harness does not synthesize the missing ones). */
function turnOf(span: CorpusSpan): Turn {
  return { role: span.kind === "assistant" ? "assistant" : "user", text: span.text };
}

export async function runReplay(opts: DriverOptions): Promise<ReplayRun> {
  if (opts.seat.trim().length === 0) throw new DriverError("SEAT_REQUIRED");
  if (opts.vectors.trim().length === 0) throw new DriverError("VECTORS_REQUIRED");
  if (!Number.isFinite(opts.budgetBytes) || opts.budgetBytes <= 0) {
    throw new DriverError("BUDGET_REQUIRED", { budgetBytes: String(opts.budgetBytes) });
  }
  assertNoPresetDataDir();

  const root = opts.workRoot ?? tmpdir();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const storeDir = mkdtempSync(join(realpathSync(root), "counterparts-replay-"));
  assertSafeDataDir(storeDir);

  const corpusDir = realpathSync(opts.corpus.dir);
  if (within(corpusDir, storeDir) || within(storeDir, corpusDir)) {
    throw new DriverError("STORE_INSIDE_CORPUS", { storeDir, corpusDir });
  }

  const events: ObservedEvent[] = [];

  // THE CORPUS CLOCK. `replayAt` is moved to the day being replayed at the top of
  // the day loop below, before anything that day writes. Midday UTC, deliberately:
  // a corpus date is a DAY, and putting the instant in the middle of it keeps the
  // date stable under `dateOf`'s UTC slice no matter which hour a span carried.
  let replayAt = corpusInstant(opts.corpus.days()[0] ?? "1970-01-01");
  const now = opts.now ?? ((): number => replayAt);

  const brain = Counterpart.open({
    dir: storeDir,
    owner: true,
    budgetBytes: opts.budgetBytes,
    // THE SCORER READS THE WHOLE RUN AT ITS END, and sleep's `log` phase runs
    // DURING the run (`sessionEnd` → `runCycle`, in-process): on the default
    // 90-lived-day window, a corpus with more than 90 active days would have its
    // first days' unlatched rows — `gate.deposit` above all — swept out from
    // under `depositRecordsOf` before it read them. So the replay store's window
    // is the corpus itself plus the default as slack: nothing read at run end can
    // age out mid-run, whatever the corpus's length, and a corpus shorter than
    // the default behaves exactly as before (the cutoff never reaches a row).
    // `gate.deposit` stays UNLATCHED on purpose — `sleep/NOTES.md` §15.
    retentionDays: opts.corpus.days().length + DEFAULT_RETENTION_DAYS,
    ...(opts.identity === undefined ? {} : { identity: opts.identity }),
    ...(opts.embed === undefined ? {} : { embed: opts.embed }),
    ...(opts.liveVectors === undefined ? {} : { vectors: opts.liveVectors }),
    now,
    onEvent: (e: CounterpartEvent) => {
      events.push({ name: e.name, data: { ...(e.data ?? {}) } });
    },
  });

  const days: DaySummary[] = [];
  const cycles: CycleSummary[] = [];
  const cycleReports: CycleReport[] = [];
  const sweeps: SweepSummary[] = [];
  const chunks: ChunkSummary[] = [];

  const dates = opts.corpus.days();

  // Cumulative turns per (scope, session), held for the WHOLE replay: a real
  // host calls capture at every turn boundary with the session's full turns
  // array, and the buffer's cursor slices what is new. The first build fed
  // each day's slice in one call — which replayed yesterday's cursor against
  // today's shorter array (silently dropping 13.2% of the corpus, review F2)
  // and let capture coalesce a whole session-day into one mega-span (F4).
  // One call per turn, cumulative array, is what production does (the
  // claude-code hooks capture at every turn boundary).
  const cumulative = new Map<string, Turn[]>();

  let index = 0;
  for (const date of dates) {
    index += 1;
    // The clock moves FIRST, before this day writes anything — the same order
    // `tools/demo/seed.ts` uses, and for the same reason: a row written before
    // the move would carry yesterday's date.
    replayAt = corpusInstant(date);
    opts.onDay?.(date, index, dates.length);
    const spans = opts.corpus.spans(date);

    // ── capture: per turn, per session, in the order a host makes them ──────
    const bySession = new Map<string, CorpusSpan[]>();
    for (const span of spans) {
      const key = `${span.scope}\u0000${span.session}`;
      const bucket = bySession.get(key);
      if (bucket === undefined) bySession.set(key, [span]);
      else bucket.push(span);
    }

    let offered = 0;
    let captured = 0;
    let jots = 0;
    let deduped = 0;
    let excluded = 0;
    let boundaries = 0;

    for (const key of [...bySession.keys()].sort()) {
      const bucket = bySession.get(key) ?? [];
      const first = bucket[0];
      if (first === undefined) continue;
      const { scope, session } = first;
      for (const span of bucket) {
        offered += 1;
        if (span.kind === "jot") {
          const jot = brain.captureJot({ session, scope, text: span.text });
          if (jot.captured) {
            jots += 1;
            captured += jot.spans.length;
          }
          deduped += jot.deduped;
          continue;
        }
        const turns = cumulative.get(key) ?? [];
        turns.push(turnOf(span));
        cumulative.set(key, turns);
        const result = brain.captureSpans({ session, scope, turns });
        captured += result.spans.length;
        deduped += result.deduped;
        excluded += result.excluded;
      }
      // Every session-ending path is a boundary, and the sweep only looks at
      // spans past one: without this, every day reports NO_CRASHED_SESSION.
      // `stop`, never `session-end` — a corpus session that ended normally
      // would be excluded from the sweep by the crash gate (see `crashStaleMs`
      // below), and this harness's whole job is to drive the sweep path.
      brain.boundary({ session, scope, kind: "stop" });
      boundaries += 1;
    }

    // ── the boundary: sweep first, then the cycle (order is behaviour) ──────
    const mark = events.length;
    const report = await brain.sessionEnd({
      date,
      sweep: {
        interpret: opts.interpret,
        // THE ONE LEGITIMATE OVERRIDE of the crash gate (2026-09-04). Live, a
        // session must go silent for `CRASH_STALE_MS` before the fallback may
        // read it; in a replay every session in the corpus died months ago and
        // no author is coming back for it, so the window is zero here and
        // NOWHERE else. The other two clauses still hold: a corpus session that
        // recorded a `session-end` boundary is still never swept.
        crashStaleMs: 0,
        ...(opts.minBytes === undefined ? {} : { minBytes: opts.minBytes }),
        ...(opts.chunkBytes === undefined ? {} : { chunkBytes: opts.chunkBytes }),
      },
    });

    collectSweeps(date, report.sweeps, sweeps);
    collectChunks(date, report.sweeps, events.slice(mark), chunks);
    cycles.push(cycleSummary(date, report.cycle, report.budgetBytes));
    cycleReports.push(report.cycle);

    days.push({
      date,
      livedDay: brain.store.livedDay(),
      sessions: bySession.size,
      spansOffered: offered,
      spansCaptured: captured,
      jots,
      deduped,
      excluded,
      boundaries,
    });
  }

  const corpusSummary = opts.corpus.summary();
  const record: RunRecord = {
    runId: `run_${corpusSummary.digest.slice(0, 12)}`,
    at: now(),
    seat: opts.seat,
    vectors: opts.vectors,
    corpusDir,
    corpusDigest: corpusSummary.digest,
    budgetBytes: opts.budgetBytes,
    storeDir,
    harnessVersion: HARNESS_VERSION,
    readOnlyProof: opts.corpus.probeWriteRefused(),
  };

  const observation: ReplayObservation = {
    activeDays: days.length,
    days,
    cycles,
    sweeps,
    chunks,
    // READ BACK FROM THE STORE, not from the event ring: these three surfaces
    // grade what a replayed store actually holds, which is the only form the
    // parallel run's evidence ever takes.
    gateRecords: gateRecordsOf(brain),
    depositRecords: depositRecordsOf(brain),
    bandTransitions: bandTransitionsOf(brain),
    symmetry: symmetryOf(cycleReports),
    events,
    store: census(brain),
    corpus: corpusSummary,
    seat: opts.seat,
    vectors: opts.vectors,
  };

  return {
    record,
    observation,
    counterpart: brain,
    storeDir,
    cleanup(): void {
      try {
        brain.close();
      } catch {
        /* already closed */
      }
      rmSync(storeDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Reducers — all counts, no text
// ---------------------------------------------------------------------------

function collectSweeps(
  date: string,
  reports: readonly {
    scope: string;
    ran: boolean;
    reason: string;
    chunks: readonly unknown[];
    proposals: number;
    spansSwept: number;
    spansRestored: number;
    consumed: boolean;
  }[],
  out: SweepSummary[],
): void {
  for (const r of reports) {
    out.push({
      date,
      scope: r.scope,
      ran: r.ran,
      reason: r.reason,
      chunks: r.chunks.length,
      proposals: r.proposals,
      spansSwept: r.spansSwept,
      spansRestored: r.spansRestored,
      consumed: r.consumed,
    });
  }
}

/** The only chunk outcomes whose path calls `apply`, and so the only ones that
 *  can have a gate record (`fallback.ts` `runChunk`: an interpreter returning
 *  nothing short-circuits to EMPTY *before* apply). */
const GATED_REASONS: ReadonlySet<string> = new Set(["APPLIED", "APPLY_FAILED"]);

/**
 * Chunk outcomes come back on the sweep report; the gate's own verdict for the
 * same chunk (accepted / refused / fullyGated / blind) arrives as a relayed
 * event. `sweepAll` runs scopes sequentially in sorted order and awaits each, so
 * the event stream for one `sessionEnd` is the chunk records in order.
 *
 * ZIPPING BY POSITION ALONE IS WRONG, and quietly. A chunk whose interpreter
 * returned nothing is `ok: true` with reason `EMPTY` and emits NO gate event
 * (v1's zero-yield rate was 16.4%, so this is the common case, not the corner);
 * a naive cursor would hand that chunk its neighbour's verdict and shift every
 * chunk after it — silently corrupting the blind rate, which is the headline
 * number. So consumption requires BOTH that the outcome is one that reached
 * `apply` AND that the event's own chunk index matches. Anything unmatched is
 * recorded `gated: false` rather than given a borrowed number.
 *
 * Mints are counted by position within a chunk: every `counterpart.sweep.minted`
 * belongs to the most recent `counterpart.sweep.chunk`.
 */
function collectChunks(
  date: string,
  reports: readonly {
    scope: string;
    chunks: readonly { index: number; ok: boolean; reason: string; spans: number; bytes: number; proposals: number }[];
  }[],
  slice: readonly ObservedEvent[],
  out: ChunkSummary[],
): void {
  interface GateRecord {
    index: number;
    accepted: number;
    refused: number;
    fullyGated: boolean;
    blind: boolean;
    minted: number;
  }
  const gates: GateRecord[] = [];
  for (const ev of slice) {
    if (ev.name === "counterpart.sweep.chunk") {
      gates.push({
        index: numOf(ev.data["chunk"]),
        accepted: numOf(ev.data["accepted"]),
        refused: numOf(ev.data["refused"]),
        fullyGated: ev.data["fullyGated"] === true,
        blind: ev.data["blind"] === true,
        minted: 0,
      });
    } else if (ev.name === "counterpart.sweep.minted") {
      const last = gates[gates.length - 1];
      if (last !== undefined) last.minted += 1;
    }
  }

  let cursor = 0;
  for (const report of reports) {
    for (const chunk of report.chunks) {
      const candidate = gates[cursor];
      const matched =
        GATED_REASONS.has(chunk.reason) &&
        candidate !== undefined &&
        candidate.index === chunk.index;
      if (matched) cursor += 1;
      const gate = matched ? candidate : undefined;
      out.push({
        date,
        scope: report.scope,
        index: chunk.index,
        ok: chunk.ok,
        reason: chunk.reason,
        spans: chunk.spans,
        bytes: chunk.bytes,
        proposals: chunk.proposals,
        gated: matched,
        accepted: gate?.accepted ?? 0,
        refused: gate?.refused ?? 0,
        fullyGated: gate?.fullyGated ?? false,
        blind: gate?.blind ?? false,
        minted: gate?.minted ?? 0,
      });
    }
  }
}

function numOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function cycleSummary(date: string, cycle: CycleReport, budgetBytes: number | null): CycleSummary {
  const decay = cycle.phases.find((p) => p.phase === "decay");
  let briefingBytes: number | null = null;
  for (const ev of cycle.events) {
    if (ev.name === "sleep.briefing.rendered") {
      const bytes = ev.data?.["bytes"];
      if (typeof bytes === "number") briefingBytes = bytes;
    }
  }
  return {
    date,
    day: cycle.day,
    phasesRan: cycle.phases.filter((p) => p.status === "ran" || p.status === "ran-nothing-found").length,
    phasesFailed: cycle.phases.filter((p) => p.status === "failed").length,
    decayRan: decay !== undefined && decay.status !== "did-not-run",
    decayExamined: decay?.examined ?? 0,
    decayChanged: decay?.changed ?? 0,
    promoted: cycle.promoted.length,
    pruned: cycle.pruned.length,
    merged: cycle.merged.length,
    bandUp: cycle.bandTransitions.filter((t) => t.direction === "up").length,
    bandDown: cycle.bandTransitions.filter((t) => t.direction === "down").length,
    briefingBytes,
    budgetBytes,
  };
}

/** Every JSON payload field the reducers below read, or `{}` for a torn row. */
function payloadOf(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function countsOf(v: unknown): Record<string, number> {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(o)) if (typeof n === "number") out[k] = n;
  return out;
}

function strOf(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * The chunk gate's records, out of the DURABLE log. Before `gate.chunk` existed
 * these three numbers — the per-gate refusal mix, the mean schemas shown, the
 * channel attribution — could not be recovered from a replayed store at all
 * (INTERFACE-GAPS §1); the composition root emitted five counts and dropped the
 * `EncodeResult` that carried the rest.
 */
function gateRecordsOf(brain: Counterpart): GateRecordSummary[] {
  const out: GateRecordSummary[] = [];
  for (const row of brain.store.eventLog({ name: "gate.chunk", limit: LOG_LIMIT })) {
    const p = payloadOf(row.payload);
    out.push({
      chunkKey: strOf(p["chunkKey"], row.ref ?? ""),
      day: row.day,
      scope: strOf(p["scope"]),
      proposals: numOf(p["proposals"]),
      accepted: numOf(p["accepted"]),
      refused: numOf(p["refused"]),
      fullyGated: p["fullyGated"] === true,
      blind: p["blind"] === true,
      shown: numOf(p["shown"]),
      candidates: numOf(p["candidates"]),
      shownLexicalOnly: numOf(p["shownLexicalOnly"]),
      shownSemanticOnly: numOf(p["shownSemanticOnly"]),
      shownBoth: numOf(p["shownBoth"]),
      semanticState: strOf(p["semanticState"], "unknown"),
      fires: countsOf(p["fires"]),
      refusalsByReason: countsOf(p["refusalsByReason"]),
    });
  }
  return out;
}

/**
 * The AUTHORED door's gate records, out of the same durable log.
 *
 * Until `gate.deposit` existed, `remember/`'s verdict seam flattened a refusal
 * to a first reason and a gate name before anything could write it down, so the
 * refusal mix could be computed over the crash-sweep path ONLY — half a
 * distribution, presented as the whole one (INTERFACE-GAPS §2a).
 */
function depositRecordsOf(brain: Counterpart): DepositRecordSummary[] {
  const out: DepositRecordSummary[] = [];
  for (const row of brain.store.eventLog({ name: "gate.deposit", limit: LOG_LIMIT })) {
    const p = payloadOf(row.payload);
    const statuses: Record<string, string> = {};
    const gates = Array.isArray(p["gates"]) ? (p["gates"] as unknown[]) : [];
    for (const g of gates) {
      if (typeof g !== "object" || g === null) continue;
      const rec = g as Record<string, unknown>;
      const name = strOf(rec["gate"]);
      if (name !== "") statuses[name] = strOf(rec["status"], "unknown");
    }
    out.push({
      contentHash: strOf(p["contentHash"], row.ref ?? ""),
      day: row.day,
      scope: strOf(p["scope"]),
      source: strOf(p["source"], "unknown"),
      accepted: numOf(p["accepted"]) === 1,
      kind: strOf(p["kind"], "unknown"),
      fires: countsOf(p["fires"]),
      refusalsByReason: countsOf(p["refusalsByReason"]),
      blockedBy: Array.isArray(p["blockedBy"]) ? (p["blockedBy"] as unknown[]).map((v) => String(v)) : [],
      statuses,
    });
  }
  return out;
}

/** Band crossings by direction, from the same log (physics guarantee 12). */
function bandTransitionsOf(brain: Counterpart): BandTransitionSummary[] {
  const out: BandTransitionSummary[] = [];
  for (const row of brain.store.eventLog({ name: "band.transition", limit: LOG_LIMIT })) {
    const p = payloadOf(row.payload);
    out.push({
      day: row.day,
      kind: strOf(p["kind"], "unknown"),
      from: strOf(p["from"], "unknown"),
      to: strOf(p["to"], "unknown"),
      direction: strOf(p["direction"], "unknown"),
      site: strOf(p["site"], "unknown"),
    });
  }
  return out;
}

/**
 * The verdicts the cycles rendered. Deliberately NOT read from the store: the
 * verdict is arithmetic over the durable transition rows, recomputed at every
 * cycle end, so persisting it would be a second copy that can go stale.
 * `reason` travels because `never-asked` carries `ok: true` (scar §2.4).
 */
function symmetryOf(reports: readonly CycleReport[]): SymmetryVerdictSummary[] {
  const out: SymmetryVerdictSummary[] = [];
  for (const cycle of reports) {
    for (const v of cycle.symmetry) {
      out.push({ day: cycle.day, kind: v.kind, ok: v.ok, reason: v.reason, up: v.up, down: v.down });
    }
  }
  return out;
}

function census(brain: Counterpart): StoreCensus {
  const store = brain.store;
  const day = store.livedDay();
  const ids = store.list({ type: "memory" });
  const byKind: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  let archived = 0;
  let superseded = 0;
  for (const id of ids) {
    const row = store.row(id);
    if (row === undefined) continue;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    // The stored band column is a birth fossil — episodic at mint, identity at
    // promotion, never "semantic" (review F6). The LIVE band is arithmetic;
    // census what the engine computes, not what mint wrote. `physicsOf` throws
    // REMOVED for a deny-listed row `row()` still returns — a census must not
    // abort a finished paid run over one dark row (PR-1 review should-fix 1).
    let b = row.band;
    try {
      b = liveBand(store.physicsOf(id), day);
    } catch {
      /* the recorded band is the honest fallback for an unreadable row */
    }
    byBand[b] = (byBand[b] ?? 0) + 1;
    if (row.archived === 1) archived += 1;
    if (row.superseded_by !== null) superseded += 1;
  }
  return {
    memories: ids.length,
    archived,
    episodes: store.list({ type: "episode" }).length,
    schemas: store.list({ type: "schema" }).length,
    byKind,
    byBand,
    superseded,
    livedDay: store.livedDay(),
  };
}
