/**
 * `sleep/` — the shapes the cycle is made of.
 *
 * Two rules govern everything here:
 *
 *   1. **Every outcome names its reason.** "Did not run", "ran and found nothing",
 *      and "failed" are three different records, never one falsy value
 *      (CONTRACT §5 G6, scar §2.4). A bare count in a report is not a monitor.
 *   2. **Records are content-by-reference.** Ids, counts, kinds, days, verdicts.
 *      Never a body, and — for prune records specifically — never a content hash
 *      either (§5 G8, scar §2.20).
 *
 * The store is typed as a STRUCTURAL interface, not as the concrete `Store` class:
 * sleep uses eleven methods, a test needs to fault-inject one of them, and a
 * narrow seam is the difference between "prove the guarantee" and "fight the
 * class". The real `Store` satisfies it structurally, unchanged.
 */

import type { Band, Kind, MemoryPhysics } from "../types.js";
import type {
  MemoryRow,
  PruneReport as VersionPruneReport,
  ProseType,
  StoredMemory,
  VersionRow,
} from "../store/index.js";
import type {
  PromotionCrossing,
  PromotionReason,
  PruneRecord,
  PruneReason,
  SymmetryCheck,
} from "../physics/index.js";

// ---------------------------------------------------------------------------
// The store seam
// ---------------------------------------------------------------------------

/**
 * Exactly what the cycle needs from `store/`, and nothing else. Note what is
 * ABSENT and cannot be added: there is no delete, no unlink, no remove. The
 * floor prune is archival because there is no other verb to reach for.
 */
export interface SleepStore {
  readonly dir: string;
  readonly observer: boolean;

  // reads
  livedDay(): number;
  getMeta(key: string): string | undefined;
  list(filter?: {
    type?: ProseType;
    kind?: Kind;
    band?: Band;
    archived?: boolean;
  }): string[];
  row(id: string): MemoryRow | undefined;
  read(id: string): StoredMemory;
  versions(id: string): VersionRow[];
  deniedIds(): string[];

  // writes
  advanceClock(date: string): number;
  setMeta(key: string, value: string): void;
  archive(id: string, reason: string): void;
  updatePhysics(id: string, patch: Partial<MemoryPhysics>): void;
  setBand(id: string, band: Band, day: number): void;
  pruneSupersededVersions(): VersionPruneReport;
  /**
   * The durable event log (SEAMS item K), OPTIONAL so this port stays satisfiable
   * by any store-shaped object. Where it exists, each prune / promotion / merge
   * record is appended beside its meta row, which is what makes the three
   * queryable (INTERFACE-GAPS.md §3) without disturbing §5 G8's ordering: the
   * meta row is still written FIRST and still gates the move.
   *
   * `dedupKey` carries the same per-id record key, so a replayed day appends
   * nothing a second time (§5 G3) — the log is append-only and idempotent at once.
   */
  appendEvent?(input: {
    name: string;
    day: number;
    ref?: string | null;
    dedupKey?: string | null;
    payload?: Record<string, unknown> | null;
  }): number;
  /**
   * READING that same log, OPTIONAL for the same reason. The symmetry counter
   * (physics guarantee 12) is a question about the WHOLE history, not about one
   * cycle: `SYMMETRY_MIN_SAMPLE` is 20 moves, and a quiet day produces a
   * handful. So the verdict is recomputed at every cycle end from the durable
   * band-transition rows rather than from a counter somebody has to remember to
   * increment — the log is the counter. A port without it gets no verdict and
   * says so, which is `never-asked`, not health.
   */
  eventLog?(filter?: {
    name?: string;
    ref?: string;
    sinceDay?: number;
    limit?: number;
  }): { name: string; day: number; ref: string | null; payload: string | null }[];
  /**
   * Box 3's ranking table (SEAMS item J), OPTIONAL for the same reason as
   * `appendEvent`. Where the port provides it, the decay tick materializes
   * strength/band THROUGH THE STORE instead of into `strength-cache.ts`'s side
   * file — which is what gave box 3 two owners and one rebuild story
   * (INTERFACE-GAPS.md §1). `rebuildCache()` drops the table with the rest.
   */
  setRanking?(rows: readonly { id: string; strength: number; band: Band; day: number }[]): void;
  rankingAll?(): Map<string, { id: string; strength: number; band: Band; day: number }>;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * Phase order is BEHAVIOR, not implementation (CONTRACT §3 G5). The three
 * consequences that must survive, in this list's own terms:
 *
 *   - `decay` runs after the boundary's own writes — the cycle is spawned at a
 *     session end, so a same-lived-day reinforcement is already persisted when
 *     the strength cache is materialized.
 *   - revision-dependent work (`prune`, `dedup`, `versions`) runs after
 *     `consolidate`, so it sees this boundary's own supersedes and promotions.
 *   - `briefing` is LAST — the cycle's final content write.
 */
export const PHASES = [
  "clock",
  "decay",
  "consolidate",
  "prune",
  "dedup",
  "versions",
  "briefing",
] as const;

export type Phase = (typeof PHASES)[number];

/** Three outcomes that a boolean cannot tell apart, plus the failure arm. */
export type PhaseStatus = "ran" | "ran-nothing-found" | "did-not-run" | "failed";

export type PhaseReason =
  | "completed"
  | "nothing-to-do"
  | "already-done-today"
  | "not-due-this-cadence"
  | "observer-report"
  | "no-render-fn"
  | "failed";

export interface PhaseReport {
  readonly phase: Phase;
  readonly status: PhaseStatus;
  /** Always present. A phase that reports no reason is a phase nobody can debug. */
  readonly reason: PhaseReason;
  /** How many items the phase looked at. */
  readonly examined: number;
  /**
   * How many items it acted on. Under observer this is the count it WOULD have
   * acted on — `status` stays `did-not-run` so the two can never be confused.
   */
  readonly changed: number;
  /** Skips, categorized. Each category is its own number (§3, v1 §11 G5). */
  readonly skipped: Readonly<Record<string, number>>;
  /** The work budget this phase was given. */
  readonly budget: number;
  /** True when the budget stopped the phase before its candidates ran out. */
  readonly budgetExhausted: boolean;
  /**
   * Items left undone because the budget ran out. A BUDGET IS NOT A DEBT
   * (§3, v1 §5 G4): this number is reported, and it is never carried forward as
   * arrears — the marker still advances, and tomorrow starts fresh.
   */
  readonly skippedForBudget: number;
  readonly markerBefore: number;
  readonly markerAfter: number;
  /** Machine-readable failure code. Present only when `status === "failed"`. */
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Crash injection — how the mid-cycle kill is proven
// ---------------------------------------------------------------------------

export type StepStage = "start" | "item" | "work-done" | "marked";

export interface CycleStep {
  readonly phase: Phase;
  readonly stage: StepStage;
  /** Item index within the phase, for `stage === "item"`. */
  readonly index?: number;
  readonly id?: string;
}

/**
 * The one error class `runCycle` does NOT degrade. Degrade-don't-abort (§5 G6)
 * means a phase failure logs and the cycle continues — but a process kill is not
 * a phase failure, and a test that could not tell them apart would prove nothing
 * about crash resumption. Throwing this from `onStep` simulates the watchdog's
 * hard kill: it propagates out of the cycle untouched, leaving markers exactly
 * where the completed work left them.
 */
export class CycleKilled extends Error {
  readonly phase: Phase;
  readonly stage: StepStage;
  readonly index: number | undefined;

  constructor(step: CycleStep) {
    super(`CYCLE_KILLED ${step.phase}/${step.stage}`);
    this.name = "CycleKilled";
    this.phase = step.phase;
    this.stage = step.stage;
    this.index = step.index;
  }
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/** Ids, counts, kinds, days, reasons. Never body text (§5 G8, scar §2.20). */
export interface SleepEvent {
  readonly at: number;
  readonly name: string;
  readonly ref?: string;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

// ---------------------------------------------------------------------------
// Per-phase records
// ---------------------------------------------------------------------------

/** The §5.3 crossing record, plus the id physics does not carry. */
export interface PromotionRecord extends PromotionCrossing {
  readonly id: string;
}

/** A prune record as persisted: physics' record, plus the id it belongs to. */
export interface PrunedRecord {
  readonly id: string;
  readonly record: PruneRecord;
}

export interface MergeRecord {
  readonly event: "memory.merged";
  readonly day: number;
  readonly candidateId: string;
  readonly originalId: string;
  readonly reason: string;
  readonly usesDelta: number;
}

/**
 * ONE BAND CROSSING, WITH ITS DIRECTION — guarantee 12's missing input.
 *
 * Before this existed the decay pass reported rows CHANGED and nothing said
 * which way they went, so `physics.symmetryCheck` — the tripwire written
 * because v1 ran 279 up-moves against zero down-moves for three days and
 * nothing fired — was enforced in one place and consumed by nobody. A counter
 * nobody feeds is a tripwire that cannot trip (scar §2.10).
 *
 * `site` says which pass moved it, because the two are different facts: the
 * decay materialization reads a band off the arithmetic, while the identity
 * crossing is an explicit decision with a persisted record.
 */
export interface BandTransition {
  readonly id: string;
  readonly kind: Kind;
  readonly from: Band;
  readonly to: Band;
  readonly direction: "up" | "down";
  readonly site: "decay" | "consolidate";
  readonly day: number;
}

export const BAND_TRANSITION_EVENT = "band.transition";
/** The transition row's payload fields, in order — a G12 surface-set component
 *  (parallel-run CONTRACT §5 G12), pinned by `satisfies` at the append site. */
export const BAND_TRANSITION_FIELDS = ["kind", "from", "to", "direction", "site"] as const;
export type BandTransitionField = (typeof BAND_TRANSITION_FIELDS)[number];

/** The per-id, per-day latch: a replayed day re-appends nothing (§5 G3). */
export function bandTransitionKey(t: BandTransition): string {
  return `${BAND_TRANSITION_EVENT}:${t.id}:${t.day}:${t.from}:${t.to}`;
}

/**
 * Records one crossing in the durable log, beside the phase's own telemetry.
 * `ctx.apply` guards it: an observer counts crossings and writes none.
 */
export function recordBandTransition(ctx: PhaseCtx, t: BandTransition): void {
  ctx.event("sleep.band.moved", t.id, {
    kind: t.kind,
    from: t.from,
    to: t.to,
    direction: t.direction,
    site: t.site,
    day: t.day,
  });
  if (!ctx.apply) return;
  ctx.store.appendEvent?.({
    name: BAND_TRANSITION_EVENT,
    day: t.day,
    ref: t.id,
    dedupKey: bandTransitionKey(t),
    payload: { kind: t.kind, from: t.from, to: t.to, direction: t.direction, site: t.site } satisfies Record<
      BandTransitionField,
      unknown
    >,
  });
}

/** Created-versus-exited, per kind, every cycle (§5 G13, scar §2.17). */
export interface KindCensus {
  readonly created: number;
  readonly exited: number;
}

// ---------------------------------------------------------------------------
// The cycle report
// ---------------------------------------------------------------------------

export interface CycleReport {
  readonly day: number;
  readonly date: string;
  readonly observer: boolean;
  /** The phase order actually executed — asserted, never assumed (§5 G5). */
  readonly order: readonly Phase[];
  readonly phases: readonly PhaseReport[];
  readonly promoted: readonly PromotionRecord[];
  readonly pruned: readonly PrunedRecord[];
  readonly merged: readonly MergeRecord[];
  /** Band crossings THIS cycle, by direction (guarantee 12's input). */
  readonly bandTransitions: readonly BandTransition[];
  /**
   * The symmetry verdict per kind, computed at cycle end over the WHOLE durable
   * transition history. Read `reason`, never `ok` alone: below
   * `SYMMETRY_MIN_SAMPLE` the verdict is `never-asked` with `ok: true`, and
   * "was never asked" is not "is healthy" (scar §2.4).
   */
  readonly symmetry: readonly SymmetryCheck[];
  /** A kind with a zero exit count after bake-in is a defect (§5 G13). */
  readonly census: Readonly<Record<Kind, KindCensus>>;
  readonly events: readonly SleepEvent[];
}

export function phaseReport(report: CycleReport, phase: Phase): PhaseReport {
  const found = report.phases.find((p) => p.phase === phase);
  if (found === undefined) throw new Error(`no report for phase ${phase}`);
  return found;
}

// ---------------------------------------------------------------------------
// What one phase is handed, and what it hands back
// ---------------------------------------------------------------------------

export interface PhaseCtx {
  readonly store: SleepStore;
  readonly day: number;
  /**
   * FALSE under observer. Every write in every phase is guarded by it, so the
   * read-only report walks the identical code path and computes the identical
   * verdicts — it simply never reaches a `WRITE_METHOD`. An observer that
   * *attempted* a write and caught the refusal would be relying on the store's
   * stand-down instead of proving its own (observer-mode.md G4).
   */
  readonly apply: boolean;
  readonly budget: number;
  /** Telemetry + the crash seam. Throwing `CycleKilled` from here kills the run. */
  step(stage: StepStage, detail?: { index?: number; id?: string }): void;
  event(name: string, ref?: string, data?: Record<string, string | number | boolean | null>): void;
}

export interface PhaseOutcome {
  examined: number;
  changed: number;
  skipped: Record<string, number>;
  budgetExhausted: boolean;
  skippedForBudget: number;
}

export function emptyOutcome(): PhaseOutcome {
  return { examined: 0, changed: 0, skipped: {}, budgetExhausted: false, skippedForBudget: 0 };
}

/** Counts a named skip reason. Reasons are enumerated, never summed into one. */
/**
 * THE JOURNAL IS NOT SUBJECT TO FORGETTING, and this is the one predicate that
 * says so — read by every phase rather than re-spelled in four.
 *
 * An episode is the owner's first-person account and the SOURCE of memories:
 * "context and source, in that order, ingested ONCE as an ordinary memory"
 * (`self/episodes.ts`). Forgetting applies to what was minted FROM an episode,
 * never to the episode itself — the memory decays, consolidates, is merged and
 * is eventually pruned like anything else, and the account it came from stays
 * readable in the owner's own directory (constitution 6: the owner owns the
 * data, in prose readable in any editor; 7: memory changes like human memory,
 * which is a claim about MEMORIES).
 *
 * Measured 2026-09-04 on the live store: all 224 migrated episodes sit in the
 * episodic band with zero on every salience dimension, so the prune pass would
 * have archived the entire journal at the floor — and an archived episode stops
 * reconciling, so the memories it had not yet minted would never exist. The
 * same shape as the dedup finding a day earlier: phases that walk "every row"
 * were written when every row was a memory.
 */
export function isJournal(row: MemoryRow): boolean {
  return row.type === "episode";
}

export function countSkip(out: PhaseOutcome, reason: string, n = 1): void {
  out.skipped[reason] = (out.skipped[reason] ?? 0) + n;
}

// ---------------------------------------------------------------------------
// Re-exports the callers of this module need
// ---------------------------------------------------------------------------

export type { PromotionCrossing, PromotionReason, PruneRecord, PruneReason, SymmetryCheck };
export type { MemoryRow, StoredMemory, VersionPruneReport };
