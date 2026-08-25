/**
 * The consolidation cycle — the librarian's whole run.
 *
 * Five properties live in this file, and every one of them is a test:
 *
 * 1. **Phase order is behavior** (§5 G5). `PHASES` is the order; the report
 *    echoes the order actually executed so an assertion can compare them.
 * 2. **Completion markers make a crash resumable** (§5 G4). A marker advances
 *    only after the work AND its persist succeed, and only forward. A cycle
 *    killed mid-phase leaves earlier markers advanced and the killed phase's
 *    marker where it was, so the rerun neither redoes nor skips.
 * 3. **A budget is not a debt** (§3, v1 §5 G4). Per-phase budgets cap effort;
 *    the marker still advances when a budget truncates a phase, and
 *    `skippedForBudget` is reported rather than carried as arrears.
 * 4. **Degrade, don't abort** (§5 G6). A phase that throws is caught, recorded
 *    as `failed` with its code, and the cycle continues — with its marker NOT
 *    advanced, so the work is retried on the next lived day. The one exception
 *    is `CycleKilled`, which is a process kill wearing an exception's clothes
 *    and must not be papered over.
 * 5. **An observer runs the whole cycle as a read-only report** (§5 G10, scar
 *    E7). Every phase computes; `ctx.apply` is false, so not one `WRITE_METHOD`
 *    is called — the report is produced without a single stand-down, because
 *    nothing was ever attempted. The spawner's own answer is separate and
 *    blunter: `shouldSpawn()` says no.
 *
 * ZERO GENERATIVE MODEL CALLS. There is no client, no fetch, no network import
 * anywhere in this module, and a test scans the source to say so.
 */

import type { Kind } from "../types.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import { runBriefing } from "./briefing.js";
import type { RenderFn } from "./briefing.js";
import { runConsolidate } from "./consolidate.js";
import { runDecay } from "./decay.js";
import { runDedup } from "./dedup.js";
import type { DedupCandidateSource } from "./dedup.js";
import { advanceMarker, budgetFor, cadenceFor, markerDue, readMarker } from "./markers.js";
import { runPrune } from "./prune.js";
import { sqliteStrengthCache, storeRankingCache, supportsRanking } from "./strength-cache.js";
import type { StrengthCache } from "./strength-cache.js";
import { shouldSpawn } from "./tunables.js";
import type {
  CycleReport,
  CycleStep,
  KindCensus,
  MergeRecord,
  Phase,
  PhaseCtx,
  PhaseOutcome,
  PhaseReason,
  PhaseReport,
  PromotionRecord,
  PrunedRecord,
  SleepEvent,
  SleepStore,
  StepStage,
} from "./types.js";
import { CycleKilled, PHASES, emptyOutcome } from "./types.js";

export interface SleepOptions {
  store: SleepStore;
  /** The calendar date this cycle belongs to. Defaults to today, UTC-dated. */
  date?: string;
  /** `self/`'s briefing render. Absent ⇒ the phase reports `no-render-fn`. */
  render?: RenderFn;
  /**
   * The host's reported injection ceiling, passed to the renderer untouched
   * (SEAMS item G). It joins the cycle options rather than being closed over at
   * the call site so that a wrong number is a visible ARGUMENT, not a constant
   * hidden in a lambda between a host's real cliff and the render (scar §2.18).
   */
  budgetBytes?: number;
  /** Injected ranking cache. Absent ⇒ the box-3 SQLite one, opened lazily. */
  strengthCache?: StrengthCache;
  /** Extra dedup candidates (embeddings). Isolated: a throw degrades to lexical. */
  candidates?: DedupCandidateSource;
  budgets?: Partial<Record<Phase, number>>;
  cadence?: Partial<Record<Phase, number>>;
  onEvent?: (event: SleepEvent) => void;
  /**
   * Per-step telemetry, and the crash seam. Throwing `CycleKilled` from here
   * simulates the watchdog's hard kill at a chosen point in a chosen phase.
   */
  onStep?: (step: CycleStep) => void;
}

const EVENT_RING = 500;

/** UTC calendar date. The lived-day mapping is the store's, not this module's. */
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function runCycle(opts: SleepOptions): CycleReport {
  const { store } = opts;
  const observer = store.observer;
  const apply = !observer;
  const date = opts.date ?? todayDate();

  const events: SleepEvent[] = [];
  const emit = (
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void => {
    const event: SleepEvent = {
      at: Date.now(),
      name,
      ...(ref !== undefined ? { ref } : {}),
      ...(data !== undefined ? { data } : {}),
    };
    events.push(event);
    if (events.length > EVENT_RING) events.shift();
    opts.onEvent?.(event);
  };

  const step = (phase: Phase, stage: StepStage, detail?: { index?: number; id?: string }): void => {
    opts.onStep?.({ phase, stage, ...detail });
  };

  const reports: PhaseReport[] = [];
  const order: Phase[] = [];
  const promoted: PromotionRecord[] = [];
  const pruned: PrunedRecord[] = [];
  const merged: MergeRecord[] = [];

  // The ranking cache is opened LAZILY by the decay phase, and never at all
  // under observer: a created file is a mutation.
  const injectedCache = opts.strengthCache;
  // SEAMS item J: box 3's own `ranking` table, through the store's connection, is
  // the default wherever the port implements it; the side file remains only for a
  // store-shaped port that does not.
  const cache: StrengthCache | null = observer
    ? null
    : (injectedCache ?? (supportsRanking(store) ? storeRankingCache(store) : sqliteStrengthCache(store.dir)));

  emit("sleep.cycle.start", undefined, { date, observer, spawn: shouldSpawn(store).reason });

  try {
    // ── phase 1: the clock ────────────────────────────────────────────────
    const day = runClock();

    const ctxFor = (phase: Phase, budget: number): PhaseCtx => ({
      store,
      day,
      apply,
      budget,
      step: (stage, detail) => step(phase, stage, detail),
      event: emit,
    });

    /**
     * One phase, with its marker gate, its budget, its degrade-don't-abort
     * wrapper, and its three-way outcome vocabulary.
     */
    const runPhase = <T extends PhaseOutcome>(
      phase: Phase,
      body: (ctx: PhaseCtx) => T,
      collect?: (result: T) => void,
      precheck?: () => PhaseReason | null,
    ): void => {
      const before = readMarker(store, phase);
      if (before.health === "torn") {
        // A torn marker is LOUD (§3, v1 §11 G9) and repairs forward only.
        emit("sleep.marker.torn", undefined, { phase, raw: before.raw ?? "" });
      }
      const budget = budgetFor(phase, opts.budgets);
      const skeleton = { phase, budget, markerBefore: before.day, markerAfter: before.day };
      const idle = (reason: PhaseReason): PhaseReport => ({
        ...skeleton,
        status: "did-not-run",
        reason,
        examined: 0,
        changed: 0,
        skipped: {},
        budgetExhausted: false,
        skippedForBudget: 0,
      });

      order.push(phase);
      step(phase, "start");

      const blocked = precheck?.() ?? null;
      if (blocked !== null) {
        reports.push(idle(blocked));
        return;
      }
      if (!observer) {
        const due = markerDue(before.day, day, cadenceFor(phase, opts.cadence));
        if (due !== "due") {
          reports.push(idle(due));
          return;
        }
      }

      let result: T;
      try {
        result = body(ctxFor(phase, budget));
      } catch (err) {
        if (err instanceof CycleKilled) throw err;
        // Degrade, don't abort. The marker stays put, so the next lived day
        // retries this phase rather than skipping it forever.
        const code = errorCode(err);
        emit("sleep.phase.failed", undefined, { phase, error: code });
        reports.push({
          ...skeleton,
          status: "failed",
          reason: "failed",
          examined: 0,
          changed: 0,
          skipped: {},
          budgetExhausted: false,
          skippedForBudget: 0,
          error: code,
        });
        return;
      }
      collect?.(result);

      const shape = {
        examined: result.examined,
        changed: result.changed,
        skipped: result.skipped,
        budgetExhausted: result.budgetExhausted,
        skippedForBudget: result.skippedForBudget,
      };

      if (observer) {
        // Nothing ran and nothing advanced; `changed` is the count that WOULD
        // have changed, and `status` keeps that from being misread as work.
        reports.push({ ...skeleton, status: "did-not-run", reason: "observer-report", ...shape });
        emit("sleep.observer.report", undefined, { phase, would: result.changed });
        return;
      }

      step(phase, "work-done");
      // The marker advances AFTER the work and its persist, both of which are
      // complete by the time `body` returns — every phase persists as it goes.
      // A budget-truncated phase still advances: a budget is not a debt.
      const after = advanceMarker(store, phase, day);
      step(phase, "marked");
      reports.push({
        ...skeleton,
        markerAfter: after,
        status: result.changed > 0 ? "ran" : "ran-nothing-found",
        reason: result.changed > 0 ? "completed" : "nothing-to-do",
        ...shape,
      });
    };

    // ── phase 2: the decay tick ───────────────────────────────────────────
    runPhase("decay", (ctx) => runDecay(ctx, cache));

    // ── phase 3: consolidation marking + the identity crossing ────────────
    runPhase(
      "consolidate",
      (ctx) => runConsolidate(ctx),
      (r) => {
        promoted.push(...r.promoted);
      },
    );

    // ── phase 4: the floor prune (archival) ───────────────────────────────
    runPhase(
      "prune",
      (ctx) => runPrune(ctx),
      (r) => {
        pruned.push(...r.pruned);
      },
    );

    // ── phase 5: dedup ────────────────────────────────────────────────────
    runPhase(
      "dedup",
      (ctx) => runDedup(ctx, opts.candidates),
      (r) => {
        merged.push(...r.merged);
      },
    );

    // ── phase 6: version retention past H ─────────────────────────────────
    runPhase("versions", (ctx) => {
      const out = emptyOutcome();
      if (!ctx.apply) {
        out.skipped["observer-report"] = 1;
        return out;
      }
      const report = store.pruneSupersededVersions();
      out.examined = report.pruned;
      out.changed = report.pruned;
      emit("sleep.versions.pruned", undefined, {
        count: report.pruned,
        cutoffDay: report.cutoffDay,
        retentionDays: report.retentionDays,
      });
      return out;
    });

    // ── phase 7: the wake briefing — the LAST content write ───────────────
    runPhase(
      "briefing",
      (ctx) => runBriefing(ctx, opts.render, opts.budgetBytes),
      undefined,
      () => (opts.render === undefined ? "no-render-fn" : null),
    );

    const report: CycleReport = {
      day,
      date,
      observer,
      order,
      phases: reports,
      promoted,
      pruned,
      merged,
      census: census(store, day, pruned, merged),
      events,
    };
    emit("sleep.cycle.done", undefined, {
      day,
      phases: reports.length,
      promoted: promoted.length,
      pruned: pruned.length,
      merged: merged.length,
      failed: reports.filter((p) => p.status === "failed").length,
    });
    return report;
  } finally {
    // Only a cache this cycle created is this cycle's to close.
    if (injectedCache === undefined) cache?.close();
  }

  // ── the clock phase, inline: it produces the day everything else gates on ──
  function runClock(): number {
    const phase: Phase = "clock";
    const before = readMarker(store, phase);
    const budget = budgetFor(phase, opts.budgets);
    const skeleton = { phase, budget, markerBefore: before.day, markerAfter: before.day };
    order.push(phase);
    step(phase, "start");

    if (observer) {
      reports.push({
        ...skeleton,
        status: "did-not-run",
        reason: "observer-report",
        examined: 0,
        changed: 0,
        skipped: { "observer-report": 1 },
        budgetExhausted: false,
        skippedForBudget: 0,
      });
      return store.livedDay();
    }

    const wasDay = store.livedDay();
    let day: number;
    try {
      day = store.advanceClock(date);
    } catch (err) {
      if (err instanceof CycleKilled) throw err;
      // A torn clock is LOUD and repair moves FORWARD ONLY: a backwards date is
      // refused by the store, and the cycle continues on the day the store
      // already believes in rather than retro-running history.
      const code = errorCode(err);
      emit("sleep.clock.failed", undefined, { date, error: code });
      reports.push({
        ...skeleton,
        status: "failed",
        reason: "failed",
        examined: 0,
        changed: 0,
        skipped: {},
        budgetExhausted: false,
        skippedForBudget: 0,
        error: code,
      });
      return wasDay;
    }
    step(phase, "work-done");
    const after = advanceMarker(store, phase, day);
    step(phase, "marked");
    const advanced = day > wasDay;
    reports.push({
      ...skeleton,
      markerAfter: after,
      status: advanced ? "ran" : "ran-nothing-found",
      reason: advanced ? "completed" : "nothing-to-do",
      examined: 1,
      changed: advanced ? 1 : 0,
      skipped: advanced ? {} : { "same-lived-day": 1 },
      budgetExhausted: false,
      skippedForBudget: 0,
    });
    return day;
  }
}

/**
 * §5 G13 / scar §2.17 — created versus exited, per kind, every cycle. A kind
 * with a zero exit count after the bake-in window is a defect to investigate:
 * a curation path that never fires is indistinguishable from one that is broken.
 */
export function census(
  store: SleepStore,
  day: number,
  pruned: readonly PrunedRecord[],
  merged: readonly MergeRecord[],
): Record<Kind, KindCensus> {
  const kinds = Object.keys(PHYSICS.KINDS) as Kind[];
  const created = new Map<Kind, number>();
  const exited = new Map<Kind, number>();
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined) continue;
    if (row.birth_day === day) created.set(row.kind, (created.get(row.kind) ?? 0) + 1);
  }
  for (const p of pruned) exited.set(p.record.kind, (exited.get(p.record.kind) ?? 0) + 1);
  for (const m of merged) {
    const row = store.row(m.candidateId);
    if (row === undefined) continue;
    exited.set(row.kind, (exited.get(row.kind) ?? 0) + 1);
  }
  const out = {} as Record<Kind, KindCensus>;
  for (const kind of kinds) {
    out[kind] = { created: created.get(kind) ?? 0, exited: exited.get(kind) ?? 0 };
  }
  return out;
}

function errorCode(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}

export { PHASES };
export type { Phase, PhaseReport, CycleReport };
