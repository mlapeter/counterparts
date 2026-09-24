/**
 * sleep/ — the consolidation cycle.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir in
 * beforeEach and removes ONLY that path in afterEach. Nothing here can reach a
 * real store, and nothing here can reach `~/.bansai` or `~/.claude-engram` —
 * `store/paths.ts` refuses those roots and its own suite proves it.
 *
 * Assertions name the REASON. `PhaseReason`, `PruneReason`, `PromotionReason`,
 * `DedupReason`, `MarkerHealth`, `WatchdogReason` — a phase that did not run, a
 * phase that ran and found nothing, and a phase that failed are three different
 * records (CONTRACT §5 G6, scar §2.4), and a test that cannot tell them apart is
 * the test v1 shipped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_RETENTION_DAYS, Store } from "../src/core/store/index.js";
import type { PutInput, StoreEvent } from "../src/core/store/index.js";
import { TUNABLES as PHYSICS, band, promotionEligibility, strength } from "../src/core/physics/index.js";
import { rowToPhysics } from "../src/core/store/operational.js";
import { bodyOf } from "./store-fixture.js";
import { Schemas, TUNABLES as SCHEMA_TUNABLES } from "../src/core/schemas/index.js";
import { applyRevision } from "../src/core/revision.js";
import {
  CycleKilled,
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  PHASES,
  PRUNE_ARCHIVE_REASON,
  PRUNE_RECORD_PREFIX,
  contentHashCandidates,
  emptyOutcome,
  initializeMarkers,
  markerDue,
  markerKey,
  memoryStrengthCache,
  mergeRecordKey,
  phaseReport,
  promotionRecordKey,
  pruneRecordKey,
  readCursor,
  resumeIndex,
  runConsolidate,
  runCycle,
  runDecay,
  runDedup,
  runPrune,
  shouldSpawn,
  sqliteStrengthCache,
  strengthCachePath,
  validateWatchdog,
  writeCursor,
} from "../src/core/sleep/index.js";
import type {
  CycleStep,
  DedupPair,
  Phase,
  PhaseCtx,
  RenderFn,
  FadeFn,
  SleepEvent,
  SleepStore,
} from "../src/core/sleep/index.js";

const SLEEP_SRC = fileURLToPath(new URL("../src/core/sleep/", import.meta.url));

/** A fade sweep that finds nothing — for the tests about the cycle's shape, not the fade. */
const NO_FADE: FadeFn = () => ({ examined: 0, faded: [], blocked: {}, anchored: 0, skippedForLimit: 0 });
const ENV = "COUNTERPARTS_DATA_DIR";

/** Store write events that move CONTENT. Meta/marker rows are bookkeeping. */
const CONTENT_WRITES = ["store.put", "store.revise", "store.supersede", "store.archive"];

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-sleep-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `mem_${String(seq).padStart(12, "0")}`;
}

/** Distinct bodies by default — two memories that say the same thing are a
 *  DEDUP CANDIDATE, and a fixture that accidentally mints one is a fixture that
 *  quietly changes what the other phases see. */
function put(s: Store, over: Partial<PutInput> = {}): string {
  const id = over.id ?? nextId();
  return s.put({
    id,
    type: "memory",
    kind: "fact",
    body: `A memory body that says something specific about ${id}.`,
    ...over,
  });
}

/** Zero salience, zero uses, untouched for 100+ lived days: prunable by physics. */
function prunable(s: Store, over: Partial<PutInput> = {}): string {
  return put(s, {
    physics: { birthDay: -120, lastUsedDay: -100, uses: 0, ...over.physics },
    ...over,
  });
}

/** Wraps a real Store as the structural `SleepStore`, so one method can fault. */
function wrap(s: Store, over: Partial<SleepStore> = {}): SleepStore {
  const base: SleepStore = {
    dir: s.dir,
    observer: s.observer,
    livedDay: () => s.livedDay(),
    getMeta: (k) => s.getMeta(k),
    list: (f) => s.list(f),
    row: (id) => s.row(id),
    read: (id) => s.read(id),
    versions: (id) => s.versions(id),
    deniedIds: () => s.deniedIds(),
    advanceClock: (d) => s.advanceClock(d),
    setMeta: (k, v) => s.setMeta(k, v),
    archive: (id, r) => s.archive(id, r),
    updatePhysics: (id, p) => s.updatePhysics(id, p),
    setBand: (id, b, d) => s.setBand(id, b, d),
    pruneSupersededVersions: () => s.pruneSupersededVersions(),
  };
  return { ...base, ...over };
}

function ctx(s: SleepStore, day: number, over: Partial<PhaseCtx> = {}): PhaseCtx {
  return {
    store: s,
    day,
    apply: true,
    budget: 1000,
    step: () => {},
    event: () => {},
    ...over,
  };
}

/** Content hash of every file under `root`, keyed by relative path. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(abs, entry.name);
      const key = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, key);
      else out.set(key, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root, "");
  return out;
}

function diff(a: Map<string, string>, b: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [k, v] of b) if (a.get(k) !== v) changed.push(k);
  for (const k of a.keys()) if (!b.has(k)) changed.push(`${k} (vanished)`);
  return changed.sort();
}

// ═══════════════════════════════════════════════════════════════════════════
describe("phase order and completion markers", () => {
  test("the phases run in contract order, and the briefing is the LAST content write", () => {
    const events: StoreEvent[] = [];
    const s = store({ onEvent: (e) => events.push(e) });
    put(s);
    let briefingId = "";
    const render: RenderFn = (c) => {
      briefingId = (c.store as unknown as Store).livedDay() >= 0 ? put(s, { title: "wake" }) : "";
      return { bytes: 512, elements: 3 };
    };

    const report = runCycle({ store: s, date: "2026-01-02", render });

    expect(report.order).toEqual([...PHASES]);
    // The log sweep is the final PHASE (§5 G16); the briefing is the final
    // CONTENT write. Both are asserted, because they are different claims.
    expect(report.order[report.order.length - 1]).toBe("log");
    expect(report.order[report.order.length - 2]).toBe("briefing");
    expect(phaseReport(report, "briefing").status).toBe("ran");

    // Render-last is behavior, not implementation: the LAST content write in the
    // whole cycle is the briefing's. Marker rows are written after it, and are
    // deliberately not content (§3 G5, self/ §5 G1) — and neither is the log
    // sweep, which deletes telemetry rows and puts nothing in the store.
    const contentWrites = events.filter((e) => CONTENT_WRITES.includes(e.name));
    expect(contentWrites.length).toBeGreaterThan(0);
    expect(contentWrites[contentWrites.length - 1]?.ref).toBe(briefingId);
    const lastContent = events.lastIndexOf(contentWrites[contentWrites.length - 1] as StoreEvent);
    const sweep = events.findIndex((e) => e.name === "store.events.pruned");
    expect(sweep).toBeGreaterThan(lastContent);
    expect(phaseReport(report, "log").status).toBe("ran-nothing-found");
  });

  test("every phase that ran advanced its marker to the cycle's day, and only forward", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 1 }), fade: NO_FADE });

    for (const phase of PHASES) {
      const pr = phaseReport(report, phase);
      expect(pr.markerAfter).toBe(report.day);
      expect(s.getMeta(markerKey(phase))).toBe(String(report.day));
    }
    // Forward-only: a marker never moves backwards.
    expect(markerDue(report.day, report.day - 1)).toBe("already-done-today");
    expect(markerDue(MARKER_UNSET, 0)).toBe("due");
  });

  test("a phase failure logs, keeps its marker where it was, and the cycle CONTINUES", () => {
    const s = store();
    put(s);
    const faulted = wrap(s, {
      pruneSupersededVersions: () => {
        const err = new Error("disk on fire") as Error & { code: string };
        err.code = "VERSIONS_EXPLODED";
        throw err;
      },
    });
    const report = runCycle({ store: faulted, date: "2026-01-02", render: () => ({ bytes: 1 }) });

    const versions = phaseReport(report, "versions");
    expect(versions.status).toBe("failed");
    expect(versions.reason).toBe("failed");
    expect(versions.error).toBe("VERSIONS_EXPLODED");
    // Marker NOT advanced — the next lived day retries rather than skipping.
    expect(versions.markerAfter).toBe(MARKER_UNSET);
    expect(s.getMeta(markerKey("versions"))).toBeUndefined();
    // ...and the cycle carried on to the phase after it.
    expect(phaseReport(report, "briefing").status).toBe("ran");
    expect(report.events.some((e) => e.name === "sleep.phase.failed")).toBe(true);
  });

  test("a mid-phase KILL: earlier markers stand, the killed phase's does not, and the rerun neither redoes nor skips", () => {
    const s = store();
    const ids = [prunable(s), prunable(s), prunable(s)];

    // Kill after the SECOND prune has been recorded and archived.
    let items = 0;
    const onStep = (step: CycleStep): void => {
      if (step.phase === "prune" && step.stage === "item") {
        items += 1;
        if (items === 2) throw new CycleKilled(step);
      }
    };

    let caught: unknown;
    try {
      runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 1 }), onStep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CycleKilled);
    expect((caught as CycleKilled).phase).toBe("prune");
    expect((caught as CycleKilled).stage).toBe("item");

    // Phases before the kill: marked. The killed phase and everything after: not.
    expect(s.getMeta(markerKey("clock"))).toBe("1");
    expect(s.getMeta(markerKey("decay"))).toBe("1");
    expect(s.getMeta(markerKey("consolidate"))).toBe("1");
    expect(s.getMeta(markerKey("prune"))).toBeUndefined();
    expect(s.getMeta(markerKey("dedup"))).toBeUndefined();
    expect(s.getMeta(markerKey("briefing"))).toBeUndefined();

    // Two memories crossed; the third is untouched.
    expect(s.read(ids[0] as string).archived).toBe(true);
    expect(s.read(ids[1] as string).archived).toBe(true);
    expect(s.read(ids[2] as string).archived).toBe(false);

    // ── the resume ────────────────────────────────────────────────────────
    const events: StoreEvent[] = [];
    const s2 = store({ onEvent: (e) => events.push(e) });
    const report = runCycle({ store: s2, date: "2026-01-02", render: () => ({ bytes: 1 }) });

    // Nothing before the kill is REDONE.
    expect(phaseReport(report, "decay").reason).toBe("already-done-today");
    expect(phaseReport(report, "consolidate").reason).toBe("already-done-today");
    expect(phaseReport(report, "clock").reason).toBe("nothing-to-do");
    // Nothing at or after the kill is SKIPPED.
    const prune = phaseReport(report, "prune");
    expect(prune.status).toBe("ran");
    expect(prune.changed).toBe(1);
    expect(prune.examined).toBe(1);
    expect(prune.skipped["archived"]).toBe(2);
    expect(phaseReport(report, "briefing").status).toBe("ran");

    // And the two already-crossed memories were not archived a second time.
    const rearchived = events.filter(
      (e) => e.name === "store.archive" && (e.ref === ids[0] || e.ref === ids[1]),
    );
    expect(rearchived.length).toBe(0);
    for (const id of ids) expect(s2.getMeta(pruneRecordKey(id))).toBeDefined();
  });

  test("a budget is NOT a debt: the marker advances, the skips are reported, no arrears accrue", () => {
    const s = store();
    prunable(s);
    prunable(s);
    prunable(s);

    const first = runCycle({ store: s, date: "2026-01-02", budgets: { prune: 1 } });
    const p1 = phaseReport(first, "prune");
    expect(p1.status).toBe("ran");
    expect(p1.changed).toBe(1);
    expect(p1.budgetExhausted).toBe(true);
    expect(p1.skippedForBudget).toBe(2);
    expect(p1.markerAfter).toBe(first.day);

    // Same lived day: no arrears to make up. The unspent work is simply not owed.
    const same = runCycle({ store: s, date: "2026-01-02", budgets: { prune: 1 } });
    expect(phaseReport(same, "prune").reason).toBe("already-done-today");
    expect(phaseReport(same, "prune").changed).toBe(0);
    expect(s.list({ archived: true }).length).toBe(1);

    // A new lived day picks up where it is, not where it "should" have been.
    const next = runCycle({ store: s, date: "2026-01-03", budgets: { prune: 1 } });
    expect(phaseReport(next, "prune").changed).toBe(1);
    expect(s.list({ archived: true }).length).toBe(2);
  });

  test("markers: torn values are loud and resolve forward; an upgrade initializes to the present", () => {
    const s = store();
    s.setMeta(markerKey("decay"), "not-a-day");
    put(s);
    const report = runCycle({ store: s, date: "2026-01-02" });
    expect(report.events.some((e) => e.name === "sleep.marker.torn")).toBe(true);
    // Forward, never backward: a torn marker reads as "due today", never as a
    // past day to retro-run.
    expect(phaseReport(report, "decay").markerBefore).toBe(MARKER_UNSET);
    expect(phaseReport(report, "decay").markerAfter).toBe(report.day);
  });

  test("an upgraded store initializes its markers to the present, and never backwards", () => {
    const s = store();
    const touched = initializeMarkers(s, 42);
    expect(touched.length).toBe(PHASES.length);
    expect(s.getMeta(markerKey("prune"))).toBe("42");
    // An existing marker is never moved backwards to satisfy an upgrade: we
    // record completion, so an upgrade must not retro-run.
    expect(initializeMarkers(s, 7)).toEqual([]);
    expect(s.getMeta(markerKey("prune"))).toBe("42");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the decay tick", () => {
  test("materializes strength into the ranking cache and leaves CANONICAL state untouched", () => {
    const s = store();
    const id = put(s, { salience: { relevance: 0.6 } });
    const before = JSON.stringify(s.row(id));

    const cache = memoryStrengthCache();
    const result = runDecay(ctx(wrap(s), 5), cache);

    expect(result.changed).toBe(1);
    const row = cache.rows.get(id);
    const p = rowToPhysics(s.row(id)!);
    expect(row?.strength).toBeCloseTo(strength(p, 5), 12);
    expect(row?.band).toBe(band(p, 5));
    expect(row?.day).toBe(5);
    // Not one canonical field moved: strength is a pure function, so there is
    // no step to apply and nothing to write back. The `band` COLUMN is the one
    // exception the pass may touch (U8, tested below) — this row's column and
    // its arithmetic already agree, so there is nothing to reconcile either.
    expect(JSON.stringify(s.row(id))).toBe(before);
  });

  test("a replayed day is a no-op BY CONSTRUCTION, not by a per-item stamp", () => {
    const s = store();
    put(s, { salience: { relevance: 0.6 } });
    put(s, { salience: { relevance: 0.2 } });
    const cache = memoryStrengthCache();

    const first = runDecay(ctx(wrap(s), 5), cache);
    expect(first.changed).toBe(2);
    const second = runDecay(ctx(wrap(s), 5), cache);
    expect(second.changed).toBe(0);
    expect(second.examined).toBe(2);
    expect(second.skipped["unchanged"]).toBe(2);
    expect(cache.writes).toBe(2);
  });

  test("the skip list is behavior: each category is counted SEPARATELY", () => {
    const s = store();
    const archived = put(s);
    s.archive(archived, "test");
    put(s, { physics: { promotedIdentity: true }, salience: { claimed: 0.9 } });
    put(s, { physics: { lastUsedDay: 5 }, salience: { relevance: 0.6 } });
    prunable(s);

    const result = runDecay(ctx(wrap(s), 5), memoryStrengthCache());
    expect(result.skipped["archived"]).toBe(1);
    expect(result.skipped["identity-band"]).toBe(1);
    expect(result.skipped["reinforced-today"]).toBe(1);
    expect(result.skipped["at-floor"]).toBe(1);
    // Enumerated-but-never-fired is a different record from absent (scar §2.4).
    expect(result.skipped["under-audit"]).toBe(0);
    expect(result.examined).toBe(3);
  });

  test("calm by default: a sub-quantum drift writes nothing", () => {
    const s = store();
    put(s, { salience: { relevance: 0.6 }, physics: { lastUsedDay: -400 } });
    const cache = memoryStrengthCache();
    runDecay(ctx(wrap(s), 5), cache);
    const after = runDecay(ctx(wrap(s), 6), cache);
    // One lived day of exponential decay on an already-sunk memory moves it by
    // far less than DECAY_QUANTUM, so the row is left alone.
    expect(after.changed).toBe(0);
    expect(after.skipped["unchanged"]).toBe(1);
  });

  // ── the band of record (IMPROVEMENTS U8) ──────────────────────────────────
  test("the box-2 band column FOLLOWS PHYSICS: the pass writes back what it reads", () => {
    const events: StoreEvent[] = [];
    const s = store({ onEvent: (e) => events.push(e) });
    // Strong enough to be semantic on day 5, and minted `episodic` like every
    // row: exactly the 869-row shape the live store was found in (U8).
    const id = put(s, {
      salience: { relevance: 1, emotional: 1, predictive: 1 },
      physics: { lastUsedDay: 5, uses: 3 },
    });
    expect(s.row(id)?.band).toBe("episodic");
    expect(band(rowToPhysics(s.row(id)!), 5)).toBe("semantic");

    const cache = memoryStrengthCache();
    const first = runDecay(ctx(wrap(s), 5), cache);

    expect(first.bandsReconciled).toBe(1);
    expect(s.row(id)?.band).toBe("semantic");
    // `band_day` is the day the column was brought to physics, not a crossing.
    expect(s.row(id)?.band_day).toBe(5);
    // The cache and the table now say the same thing — the U8 invariant.
    expect(cache.rows.get(id)?.band).toBe("semantic");

    // A REPLAYED DAY WRITES NOTHING: same state, same day, same answer, and the
    // column already agrees, so there is no second UPDATE.
    const before = events.filter((e) => e.name === "store.band").length;
    const second = runDecay(ctx(wrap(s), 5), cache);
    expect(second.bandsReconciled).toBe(0);
    expect(events.filter((e) => e.name === "store.band").length).toBe(before);
  });

  test("a DEMOTION reaches the table too, and the table agrees with the transition it emits", () => {
    const s = store();
    const id = put(s, {
      salience: { relevance: 1, emotional: 1, predictive: 1 },
      physics: { lastUsedDay: 5, uses: 3 },
    });
    const cache = memoryStrengthCache();
    runDecay(ctx(wrap(s), 5), cache);
    expect(s.row(id)?.band).toBe("semantic");

    // Three hundred lived days later the same row is under THETA_SEM, which is
    // the only way a semantic→episodic move ever happens (nobody decides it).
    const later = runDecay(ctx(wrap(s), 305), cache);
    const moved = later.transitions.filter((t) => t.id === id);
    expect(moved.length).toBe(1);
    expect(moved[0]?.from).toBe("semantic");
    expect(moved[0]?.to).toBe("episodic");
    expect(moved[0]?.direction).toBe("down");
    // THE POINT: the column says what the transition says. Before U8 the pass
    // emitted the row and left the table denying it.
    expect(s.row(id)?.band).toBe(moved[0]?.to);
    expect(s.row(id)?.band_day).toBe(305);
    expect(later.bandsReconciled).toBe(1);
  });

  test("an OBSERVER pass counts the disagreement and writes no column", () => {
    const s = store();
    const id = put(s, {
      salience: { relevance: 1, emotional: 1, predictive: 1 },
      physics: { lastUsedDay: 5, uses: 3 },
    });
    const observed = runDecay(ctx(wrap(s), 5, { apply: false }), memoryStrengthCache());
    // THE COUNT IS THE POINT. `PhaseCtx.apply` promises the read-only path
    // computes the identical verdicts and only skips the write, and
    // `sleep.observer.report`'s `would` rides on that — an instrument that
    // reported 0 disagreements on a store full of them would be worse than none.
    expect(observed.bandsReconciled).toBe(1);
    expect(observed.reconciled).toBe(1);
    // And not one column moved.
    expect(s.row(id)?.band).toBe("episodic");
    expect(s.row(id)?.band_day).toBe(0);
  });

  test("a pass that ONLY reconciles is `ran`, says how many, and leaves a ring event", () => {
    // The exact U8 shape: the ranking cache already right, the column wrong, so
    // `moved` is false for every row and the old pass filed 869 UPDATEs as
    // `ran-nothing-found` / `nothing-to-do`. Three rows here; the live store's
    // number was 869.
    const s = store();
    const ids = [0, 1, 2].map(() =>
      put(s, {
        salience: { relevance: 1, emotional: 1, predictive: 1 },
        physics: { lastUsedDay: 5, uses: 3 },
      }),
    );
    const cache = memoryStrengthCache();
    // Pass one brings both boxes to physics.
    runDecay(ctx(wrap(s), 5), cache);
    for (const id of ids) expect(s.row(id)?.band).toBe("semantic");
    // Now put the COLUMN back where U8 found it, leaving the cache correct.
    for (const id of ids) s.setBand(id, "episodic", 5);

    const ring: string[] = [];
    const again = runDecay(
      ctx(wrap(s), 5, { event: (name) => ring.push(name) }),
      cache,
    );
    expect(again.bandsReconciled).toBe(3);
    expect(again.written.length).toBe(0);
    // `changed` is rows ACTED ON, so the phase can no longer report a pass that
    // rewrote every column as a pass that found nothing.
    expect(again.changed).toBe(3);
    expect(again.reconciled).toBe(3);
    // Counted once, in the category that is true: not also `unchanged`.
    expect(again.skipped["unchanged"] ?? 0).toBe(0);
    // The ring event the old `written.length === 0` guard skipped.
    expect(ring).toContain("sleep.decay.materialized");
    for (const id of ids) expect(s.row(id)?.band).toBe("semantic");
  });

  test("the shipped ranking cache is box 3 and is opened LAZILY", () => {
    const s = store();
    put(s);
    const cache = sqliteStrengthCache(dir);
    expect(existsSync(strengthCachePath(dir))).toBe(false);
    runDecay(ctx(wrap(s), 3), cache);
    expect(existsSync(strengthCachePath(dir))).toBe(true);
    expect(strengthCachePath(dir).startsWith(join(dir, "cache"))).toBe(true);
    cache.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("consolidation and the identity crossing", () => {
  test("identity promotion is an EXPLICIT, COUNTED crossing with a persisted record", () => {
    const s = store();
    const id = put(s, {
      kind: "self",
      salience: { claimed: 0.9, relevance: 0.9 },
      physics: { consolidated: true, reinforcedDays: 3, uses: 3 },
    });
    const report = runCycle({ store: s, date: "2026-01-02" });

    expect(report.promoted.length).toBe(1);
    const crossing = report.promoted[0]!;
    expect(crossing.event).toBe("band.promoted");
    expect(crossing.id).toBe(id);
    expect(crossing.kind).toBe("self");
    expect(crossing.reinforcedDays).toBe(3);
    expect(crossing.base).toBeGreaterThanOrEqual(PHYSICS.THETA_ID);
    expect(crossing.day).toBe(report.day);

    // The flag, the band, the persisted §5.3 record, and the event — all four.
    expect(s.physicsOf(id).promotedIdentity).toBe(true);
    expect(s.row(id)?.band).toBe("identity");
    expect(JSON.parse(s.getMeta(promotionRecordKey(id)) ?? "null")).toEqual(crossing);
    expect(report.events.some((e) => e.name === "sleep.promoted" && e.ref === id)).toBe(true);
  });

  test("promotion does NOT fire below N distinct reinforced days, and says why", () => {
    const s = store();
    const id = put(s, {
      kind: "self",
      salience: { claimed: 0.9, relevance: 0.9 },
      physics: { consolidated: true, reinforcedDays: PHYSICS.N_PROMOTION_DAYS - 1, uses: 2 },
    });
    const report = runCycle({ store: s, date: "2026-01-02" });

    expect(report.promoted).toEqual([]);
    expect(s.physicsOf(id).promotedIdentity).toBe(false);
    expect(s.row(id)?.band).not.toBe("identity");
    expect(s.getMeta(promotionRecordKey(id))).toBeUndefined();

    // The REASON, named — not merely "it didn't happen".
    const cons = phaseReport(report, "consolidate");
    expect(cons.skipped["promotion:insufficient-distinct-days"]).toBe(1);
    expect(cons.skipped["promotion:base-below-identity-threshold"]).toBeUndefined();
    const verdict = promotionEligibility(s.physicsOf(id));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("insufficient-distinct-days");
  });

  test("nothing is born into identity, however loudly it claims salience", () => {
    const s = store();
    const id = put(s, {
      kind: "self",
      salience: { claimed: 1, relevance: 1, emotional: 1, predictive: 1 },
      physics: { reinforcedDays: 0 },
    });
    const report = runCycle({ store: s, date: "2026-01-02" });
    expect(report.promoted).toEqual([]);
    expect(s.physicsOf(id).promotedIdentity).toBe(false);
  });

  test("consolidation marking: the semantic floor sets the flag; nothing consolidates on its birth day", () => {
    const s = store();
    const grown = put(s, {
      salience: { claimed: 0.8 },
      physics: { birthDay: -3, lastUsedDay: 0 },
    });
    // Born ON the cycle's own lived day — sleep consolidates yesterday's
    // experience, never the day it is looking at.
    const newborn = put(s, { salience: { claimed: 0.8 }, physics: { birthDay: 1 } });
    const faded = prunable(s);

    const report = runCycle({ store: s, date: "2026-01-02" });
    const cons = phaseReport(report, "consolidate");

    expect(s.physicsOf(grown).consolidated).toBe(true);
    expect(s.physicsOf(newborn).consolidated).toBe(false);
    expect(s.physicsOf(faded).consolidated).toBe(false);
    expect(cons.skipped["born-today"]).toBe(1);
    expect(cons.skipped["below-semantic-floor"]).toBe(1);
    expect(report.events.some((e) => e.name === "sleep.consolidated" && e.ref === grown)).toBe(true);
  });

  test("consolidation runs on its own cadence and reports 'not-due-this-cadence' in between", () => {
    const s = store();
    put(s, { salience: { claimed: 0.8 }, physics: { birthDay: -3, lastUsedDay: 0 } });
    runCycle({ store: s, date: "2026-01-02" });
    const second = runCycle({ store: s, date: "2026-01-03" });
    expect(phaseReport(second, "consolidate").reason).toBe("not-due-this-cadence");
    expect(phaseReport(second, "decay").reason).not.toBe("not-due-this-cadence");
  });

  /**
   * THE RESUME CURSOR (2026-09-18). Measured on the live store the day before
   * (`docs/promotion-diagnosis-2026-09-17.md`): 15,292 rows against a budget of
   * 5,000, started from the same place every night, so 10,000+ memories had never
   * once been asked whether they consolidate or belong to who the owner is. A
   * budget is still not a debt — only the STARTING PLACE moved.
   */
  describe("the pass resumes where it stopped", () => {
    /** Every id the phase looked at, in order, however it then judged it. */
    function visitedIds(s: Store, budget: number): string[] {
      const seen: string[] = [];
      const wrapped = wrap(s, {
        row: (id) => {
          seen.push(id);
          return s.row(id);
        },
      });
      runConsolidate(ctx(wrapped, 1, { budget }));
      return seen;
    }

    test("a store larger than the budget is fully covered across successive runs, each row once per run", () => {
      const s = store();
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        ids.push(put(s, { salience: { claimed: 0.8 }, physics: { birthDay: -3, lastUsedDay: 0 } }));
      }
      // ceil(7 / 3) = 3 runs to reach every row at least once.
      const runs = [visitedIds(s, 3), visitedIds(s, 3), visitedIds(s, 3)];
      for (const run of runs) {
        expect(run.length).toBe(3);
        // Never the same row twice inside ONE run, even once the rotation wraps.
        expect(new Set(run).size).toBe(run.length);
      }
      const reached = new Set(runs.flat());
      for (const id of ids) expect(reached.has(id)).toBe(true);
      // ...and it is the FIRST three that the second run stopped re-reading.
      expect(runs[0]).toEqual(ids.slice(0, 3));
      expect(runs[1]).toEqual(ids.slice(3, 6));
      // Run three takes the last one and wraps to the head.
      expect(runs[2]).toEqual([ids[6] as string, ids[0] as string, ids[1] as string]);
      // The proof that matters: every row got the question, not just the visit.
      for (const id of ids) expect(s.physicsOf(id).consolidated).toBe(true);
    });

    test("a store smaller than the budget makes ONE full pass and flies no exhaustion flag", () => {
      const s = store();
      for (let i = 0; i < 3; i += 1) {
        put(s, { salience: { claimed: 0.8 }, physics: { birthDay: -3, lastUsedDay: 0 } });
      }
      const out = runConsolidate(ctx(wrap(s), 1, { budget: 10 }));
      expect(out.examined).toBe(3);
      expect(out.budgetExhausted).toBe(false);
      expect(out.skippedForBudget).toBe(0);
    });

    test("an empty store leaves the cursor alone rather than writing a place that is not there", () => {
      const s = store();
      const out = runConsolidate(ctx(wrap(s), 1, { budget: 10 }));
      expect(out.examined).toBe(0);
      expect(readCursor(s, "consolidate")).toBeNull();
    });

    test("a cursor whose row is gone resumes at the next row that IS there", () => {
      const s = store();
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        ids.push(put(s, { salience: { claimed: 0.8 }, physics: { birthDay: -3, lastUsedDay: 0 } }));
      }
      // A cursor that sorts between rows 2 and 3 — what is left behind when the
      // row the last run stopped on has since been removed from the list.
      writeCursor(s, "consolidate", `${ids[1] as string}zz`);
      expect(visitedIds(s, 1)).toEqual([ids[2] as string]);
    });

    test("an observer moves no cursor: the read-only report may not move the store's place", () => {
      const s = store();
      for (let i = 0; i < 3; i += 1) {
        put(s, { salience: { claimed: 0.8 }, physics: { birthDay: -3, lastUsedDay: 0 } });
      }
      runConsolidate(ctx(wrap(s), 1, { budget: 1, apply: false }));
      expect(readCursor(s, "consolidate")).toBeNull();
    });

    test("resumeIndex: strictly after the cursor, wrapping at the end, and 0 for nothing to go on", () => {
      const ids = ["a", "c", "e"];
      expect(resumeIndex(ids, null)).toBe(0);
      expect(resumeIndex([], "c")).toBe(0);
      // Strictly after: the row the last run stopped ON is not re-examined.
      expect(resumeIndex(ids, "a")).toBe(1);
      expect(resumeIndex(ids, "c")).toBe(2);
      // A cursor whose row is gone lands on the next one that is still there.
      expect(resumeIndex(ids, "b")).toBe(1);
      // Past the end wraps to the head.
      expect(resumeIndex(ids, "e")).toBe(0);
      expect(resumeIndex(ids, "z")).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the floor prune — archival, never deletion", () => {
  test("a pruned memory is ARCHIVED with reason 'pruned': the file stays, the id resolves", () => {
    const s = store();
    const id = prunable(s);
    const bodyBefore = bodyOf(s, id);

    const report = runCycle({ store: s, date: "2026-01-02" });

    expect(report.pruned.length).toBe(1);
    const stored = s.read(id);
    expect(stored.archived).toBe(true);
    expect(stored.archivedReason).toBe(PRUNE_ARCHIVE_REASON);
    // Fading is not deletion: the prose is where it was and the id still resolves.
    expect(bodyOf(s, id)).toBe(bodyBefore);
    expect(s.resolve(id)).toBe(id);
    expect(stored.doc.body.length).toBeGreaterThan(0);
  });

  test("the prune record is counts, kind and dates — never a body, NEVER a content hash", () => {
    const s = store();
    const secret = "zygomorphic vestibule";
    const id = prunable(s, { body: `A memory about the ${secret} on a Tuesday.` });
    const hash = s.row(id)?.content_hash as string;

    const report = runCycle({ store: s, date: "2026-01-02" });
    const record = report.pruned[0]?.record;
    expect(report.pruned[0]?.id).toBe(id);

    expect(Object.keys(record ?? {}).sort()).toEqual([
      "band",
      "birthDay",
      "day",
      "event",
      "kind",
      "lastUsedDay",
      "strength",
      "uses",
    ]);
    expect(record?.event).toBe("memory.pruned");
    expect(record?.kind).toBe("fact");
    expect(record?.band).toBe("episodic");

    // Persisted verbatim, and free of both the body and the content hash
    // (scar §2.20: hashing low-entropy content leaks it).
    const persisted = s.getMeta(pruneRecordKey(id)) ?? "";
    expect(JSON.parse(persisted)).toEqual(record);
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain(hash);
    for (const e of report.events) expect(JSON.stringify(e)).not.toContain(secret);
  });

  test("a FAILED record append means nothing moves", () => {
    const s = store();
    const id = prunable(s);
    const faulted = wrap(s, {
      setMeta: (k, v) => {
        if (k.startsWith(PRUNE_RECORD_PREFIX)) {
          const err = new Error("no room") as Error & { code: string };
          err.code = "META_FULL";
          throw err;
        }
        s.setMeta(k, v);
      },
    });

    const report = runCycle({ store: faulted, date: "2026-01-02" });
    const prune = phaseReport(report, "prune");

    expect(report.pruned).toEqual([]);
    expect(s.read(id).archived).toBe(false);
    expect(prune.skipped["record-append-failed"]).toBe(1);
    expect(report.events.some((e) => e.name === "sleep.prune.record-failed")).toBe(true);
    // The phase itself did not fail — the cycle degrades, it does not abort.
    expect(prune.status).toBe("ran-nothing-found");
  });

  test("every blocking gate is named, and all of them are counted — not just the first", () => {
    const s = store();
    prunable(s, { physics: { protected: true } });
    prunable(s, { salience: { relevance: 1, emotional: 1, predictive: 1 } });
    put(s);
    prunable(s, { physics: { promotedIdentity: true }, salience: { claimed: 0.9 } });

    const report = runCycle({ store: s, date: "2026-01-02" });
    const prune = phaseReport(report, "prune");

    expect(prune.skipped["blocked:protected"]).toBe(1);
    expect(prune.skipped["blocked:above-floor"]).toBeGreaterThanOrEqual(2);
    expect(prune.skipped["blocked:dwell-too-short"]).toBeGreaterThanOrEqual(1);
    expect(prune.skipped["blocked:band-not-episodic"]).toBeGreaterThanOrEqual(1);
    expect(report.pruned).toEqual([]);
  });

  test("nothing in a LIVE revision chain is pruned", () => {
    const s = store();
    const challenged = prunable(s, { physics: { pressure: 0.4, lastChallengedDay: -1 } });
    const superseded = prunable(s);
    s.supersede(superseded, { id: nextId(), type: "memory", kind: "fact", body: "The corrected version." });

    const report = runCycle({ store: s, date: "2026-01-02" });
    expect(report.pruned).toEqual([]);
    expect(phaseReport(report, "prune").skipped["blocked:in-live-revision-chain"]).toBe(1);
    expect(s.read(challenged).archivedReason).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("dedup", () => {
  const BODY = "The sourdough starter died after two weeks of neglect.";

  test("identical interpretations merge: uses credited on the ORIGINAL, duplicate archived", () => {
    const s = store();
    const original = put(s, { body: BODY, physics: { birthDay: 0, lastUsedDay: 0, uses: 2 } });
    const dup = put(s, { body: BODY, physics: { birthDay: 1, lastUsedDay: 0 } });

    const report = runCycle({ store: s, date: "2026-01-02" });

    expect(report.merged.length).toBe(1);
    const record = report.merged[0]!;
    expect(record.event).toBe("memory.merged");
    expect(record.originalId).toBe(original);
    expect(record.candidateId).toBe(dup);
    expect(record.reason).toBe("identical-content-hash");
    expect(record.usesDelta).toBe(1);

    // The whole effect of a merge: uses(orig) += 1. Never a rewrite, never a blend.
    expect(s.physicsOf(original).uses).toBe(3);
    expect(s.read(dup).archived).toBe(true);
    expect(s.read(dup).archivedReason).toBe(MERGE_ARCHIVE_REASON);
    expect(JSON.parse(s.getMeta(mergeRecordKey(dup)) ?? "null")).toEqual(record);
  });

  test("a merge is idempotent under replay: the second cycle finds nothing to credit", () => {
    const s = store();
    const original = put(s, { body: BODY, physics: { birthDay: 0, lastUsedDay: 0 } });
    put(s, { body: BODY, physics: { birthDay: 1, lastUsedDay: 0 } });

    runCycle({ store: s, date: "2026-01-02" });
    expect(s.physicsOf(original).uses).toBe(1);
    const second = runCycle({ store: s, date: "2026-01-03" });
    expect(second.merged).toEqual([]);
    // No uses ratchet: the duplicate exited, so the pair is never found again.
    expect(s.physicsOf(original).uses).toBe(1);
  });

  test("a declared `updates:` is NEVER merged into its target", () => {
    const s = store();
    const original = put(s, { body: BODY, physics: { birthDay: 0, lastUsedDay: 0, uses: 2 } });
    const refutation = put(s, {
      body: BODY,
      meta: { updates: original },
      physics: { birthDay: 1, lastUsedDay: 0 },
    });

    const report = runCycle({ store: s, date: "2026-01-02" });

    expect(report.merged).toEqual([]);
    // The reason is the one that matters: otherwise a refutation reinforces the
    // belief it refutes (scar §2.10's ratchet, rebuilt by accident).
    expect(phaseReport(report, "dedup").skipped["left-alone:declared-revision-never-merged"]).toBe(1);
    expect(s.physicsOf(original).uses).toBe(2);
    expect(s.read(refutation).archived).toBe(false);
  });

  test("without a similarity source, near-duplicates are left alone and SAY so", () => {
    const s = store();
    const a = put(s, { body: BODY, physics: { lastUsedDay: 0 } });
    const b = put(s, { body: "The sourdough starter finally died last week.", physics: { lastUsedDay: 0 } });
    const source = (): DedupPair[] => [{ candidateId: b, originalId: a, cosine: null }];

    const report = runCycle({ store: s, date: "2026-01-02", candidates: source });
    expect(report.merged).toEqual([]);
    expect(phaseReport(report, "dedup").skipped["left-alone:no-similarity-supplied"]).toBe(1);
  });

  test("an injected similarity source above tau merges; below tau is left alone", () => {
    const s = store();
    const a = put(s, { body: BODY, physics: { lastUsedDay: 0 } });
    const b = put(s, { body: "The starter died after two weeks.", physics: { lastUsedDay: 0 } });
    const c = put(s, { body: "Rye flour goes in the freezer.", physics: { lastUsedDay: 0 } });

    const report = runCycle({
      store: s,
      date: "2026-01-02",
      candidates: (): DedupPair[] => [
        { candidateId: b, originalId: a, cosine: PHYSICS.TAU_DUP },
        { candidateId: c, originalId: a, cosine: 0.4 },
      ],
    });
    expect(report.merged.map((m) => m.candidateId)).toEqual([b]);
    expect(report.merged[0]?.reason).toBe("cosine-at-or-above-tau");
    expect(phaseReport(report, "dedup").skipped["left-alone:below-tau"]).toBe(1);
    expect(s.read(c).archived).toBe(false);
  });

  test("an embedding source that THROWS degrades to lexical and is logged, never fatal", () => {
    const s = store();
    put(s, { body: BODY, physics: { birthDay: 0, lastUsedDay: 0 } });
    put(s, { body: BODY, physics: { birthDay: 1, lastUsedDay: 0 } });

    const report = runCycle({
      store: s,
      date: "2026-01-02",
      candidates: () => {
        throw new Error("embedder unavailable");
      },
    });
    // The lexical pair still merged; the cycle did not fail.
    expect(phaseReport(report, "dedup").status).toBe("ran");
    expect(report.merged.length).toBe(1);
    expect(report.events.some((e) => e.name === "sleep.dedup.degraded")).toBe(true);
  });

  test("review B, MINOR-3: a TITLE is not part of the duplicate question — a decision, not an accident", () => {
    // Two memories with identical bodies and DIFFERENT titles naming different
    // people are proposed as a dedup pair. This is unchanged from master —
    // `contentHashCandidates` has always hashed the body — but F5 makes
    // `memories.content_hash` agree with that choice, which removes the one
    // column a future reviewer could have used to tell the two apart. So the
    // behaviour is pinned as a DECISION here rather than left as an accident of
    // which hash was handy.
    //
    // Why the body and not the title: the title is a handle the writer chose
    // and the body is the interpretation, and `store/prose.ts` says which one
    // IS the memory. Two notes that say the same thing under different headings
    // are the same thing said twice.
    const s = store();
    const body = "The north gate is padlocked and the key hangs in the tack room.";
    const a = put(s, { body, title: "Alice's rule", physics: { birthDay: 0 } });
    const b = put(s, { body, title: "Bob's rule", physics: { birthDay: 1 } });
    expect(s.row(a)?.title).not.toBe(s.row(b)?.title as string);
    expect(s.row(a)?.content_hash).toBe(s.row(b)?.content_hash as string);

    const pairs = contentHashCandidates({ store: wrap(s), day: 1, liveIds: [a, b] });
    expect(pairs).toEqual([{ candidateId: b, originalId: a, sameContentHash: true }]);

    // AND THE OTHER HALF OF THE DECISION: different bodies under the SAME title
    // are NOT a pair. The title is not consulted in either direction.
    const c = put(s, { body: "One thing that is true.", title: "same heading", physics: { birthDay: 2 } });
    const d = put(s, { body: "A different thing, also true.", title: "same heading", physics: { birthDay: 3 } });
    expect(s.row(c)?.title).toBe(s.row(d)?.title as string);
    expect(contentHashCandidates({ store: wrap(s), day: 1, liveIds: [c, d] })).toEqual([]);
  });

  test("the default candidate source pairs by the INTERPRETATION, not by the prose document", () => {
    const s = store();
    const a = put(s, { body: BODY, title: "Starter", physics: { birthDay: 0 } });
    const b = put(s, { body: BODY, title: "Different title", physics: { birthDay: 1 } });
    // SINCE THE FLOOR the content hash addresses the BODY — one definition,
    // both tables — so these two, which differ only in title, now hash the SAME.
    // That makes the claim below sharper rather than weaker: dedup pairs by the
    // interpretation, and here the interpretation is literally identical while
    // the documents are not. `dedup.ts` still does not read this column; it
    // compares tokenized bodies, which is what catches a near-duplicate too.
    expect(s.row(a)?.content_hash).toBe(s.row(b)?.content_hash as string);
    expect(s.row(a)?.title).not.toBe(s.row(b)?.title as string);
    const pairs = contentHashCandidates({ store: wrap(s), day: 1, liveIds: [a, b] });
    expect(pairs).toEqual([{ candidateId: b, originalId: a, sameContentHash: true }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("version retention past H", () => {
  test("superseded-version rows past the horizon are dropped, and the count is reported", () => {
    const s = store({ retentionDays: 0 });
    const old = put(s);
    s.supersede(old, { id: nextId(), type: "memory", kind: "fact", body: "The corrected version." });
    expect(s.versions(old).length).toBe(1);

    const report = runCycle({ store: s, date: "2026-01-02" });
    const versions = phaseReport(report, "versions");
    expect(versions.status).toBe("ran");
    expect(versions.changed).toBe(1);
    expect(s.versions(old).length).toBe(0);
    // The archived prose file itself is untouched — the ROW expires, not the file.
    expect(report.events.some((e) => e.name === "sleep.versions.pruned")).toBe(true);
  });

  test("a store with nothing to expire reports 'ran and found nothing', not 'did not run'", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: s, date: "2026-01-02" });
    const versions = phaseReport(report, "versions");
    expect(versions.status).toBe("ran-nothing-found");
    expect(versions.reason).toBe("nothing-to-do");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the briefing seam", () => {
  test("no renderer is 'did-not-run / no-render-fn' — not a failure, not 'found nothing'", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: s, date: "2026-01-02" });
    const briefing = phaseReport(report, "briefing");
    expect(briefing.status).toBe("did-not-run");
    expect(briefing.reason).toBe("no-render-fn");
    expect(briefing.error).toBeUndefined();
    // A phase that did not run does not claim a completed day.
    expect(s.getMeta(markerKey("briefing"))).toBeUndefined();
  });

  test("the renderer sees the cycle's own supersedes, prunes and promotions", () => {
    const s = store();
    const doomed = prunable(s);
    const seen: { archivedAtRender: boolean | null } = { archivedAtRender: null };
    const render: RenderFn = (c) => {
      seen.archivedAtRender = (c.store.row(doomed)?.archived ?? 0) === 1;
      return { bytes: 128, elements: 1 };
    };
    const report = runCycle({ store: s, date: "2026-01-02", render });
    expect(report.pruned.length).toBe(1);
    expect(seen.archivedAtRender).toBe(true);
    expect(phaseReport(report, "briefing").changed).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("observer mode", () => {
  test("the cycle runs as a READ-ONLY REPORT: the data dir is byte-identical afterwards", () => {
    const seed = store();
    prunable(seed);
    put(seed, { body: "A second memory, kept.", salience: { relevance: 0.6 } });
    seed.close();
    open.splice(open.indexOf(seed), 1);

    const obs = store({ observer: true });
    const before = snapshot(dir);
    const report = runCycle({
      store: obs,
      date: "2026-01-02",
      render: () => {
        throw new Error("an observer must never invoke the renderer");
      },
    });
    const after = snapshot(dir);

    expect(diff(before, after)).toEqual([]);
    expect(existsSync(strengthCachePath(dir))).toBe(false);
    expect(report.observer).toBe(true);
    expect(report.day).toBe(obs.livedDay());
  });

  test("it does not ATTEMPT a write either: zero store stand-downs, and the report is still real", () => {
    const seed = store();
    prunable(seed);
    seed.close();
    open.splice(open.indexOf(seed), 1);

    const obs = store({ observer: true });
    const report = runCycle({
      store: obs,
      date: "2026-01-02",
      render: () => {
        throw new Error("an observer must never invoke the renderer");
      },
      fade: (f) => {
        if (f.apply) throw new Error("an observer's fade must be a dry run");
        return NO_FADE(f);
      },
    });

    // An instrument that attempted and caught a refusal would be relying on the
    // store's stand-down instead of proving its own (observer-mode.md G4).
    expect(obs.events("store.observer.standdown").length).toBe(0);
    for (const phase of PHASES) {
      const pr = phaseReport(report, phase);
      expect(pr.status).toBe("did-not-run");
      expect(pr.reason).toBe("observer-report");
      expect(pr.markerAfter).toBe(pr.markerBefore);
    }
    // But it IS a report: the prune it would have done is counted.
    expect(phaseReport(report, "prune").changed).toBe(1);
    expect(report.pruned.length).toBe(1);
    expect(obs.getMeta(markerKey("prune"))).toBeUndefined();
  });

  test("an observer session SPAWNS no cycle at all", () => {
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7).
    Store.open({ dir }).close();
    const s = store({ observer: true });
    expect(shouldSpawn(s)).toEqual({ spawn: false, reason: "observer" });
    expect(shouldSpawn(store())).toEqual({ spawn: true, reason: "spawn" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("idempotence under replay", () => {
  test("the whole cycle replayed on the same lived day changes not one byte", () => {
    const s = store();
    prunable(s);
    put(s, { salience: { claimed: 0.8 }, physics: { birthDay: -3, lastUsedDay: 0 } });
    put(s, { body: "twinned", physics: { birthDay: 0, lastUsedDay: 0 } });
    put(s, { body: "twinned", physics: { birthDay: 1, lastUsedDay: 0 } });

    const first = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 64 }), fade: NO_FADE });
    expect(first.pruned.length).toBe(1);
    expect(first.merged.length).toBe(1);

    const before = snapshot(dir);
    const second = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 64 }), fade: NO_FADE });
    const after = snapshot(dir);

    expect(diff(before, after)).toEqual([]);
    expect(phaseReport(second, "clock").reason).toBe("nothing-to-do");
    for (const phase of PHASES.filter((p) => p !== "clock")) {
      expect(phaseReport(second, phase).reason).toBe("already-done-today");
    }
    expect(second.pruned).toEqual([]);
    expect(second.merged).toEqual([]);
  });

  test("created-versus-exited is reported per kind every cycle", () => {
    const s = store();
    prunable(s, { kind: "place" });
    put(s, { kind: "skill", body: "New today.", physics: { birthDay: 1 } });

    const report = runCycle({ store: s, date: "2026-01-02" });
    expect(report.census.place.exited).toBe(1);
    expect(report.census.skill.created).toBe(1);
    expect(report.census.person.exited).toBe(0);
    expect(Object.keys(report.census).sort()).toEqual(
      Object.keys(PHYSICS.KINDS).sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("structural guarantees", () => {
  test("ZERO generative model calls — enumerated over the source, not asserted in prose", () => {
    const files = readdirSync(SLEEP_SRC).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(join(SLEEP_SRC, f), "utf8");
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/https?:\/\//);
      expect(src).not.toMatch(/anthropic|openai|node:https?\b/i);
      expect(src).not.toMatch(/\bXMLHttpRequest\b|\bWebSocket\b/);
      expect(src).not.toMatch(/messages\s*\.\s*create|completions\s*\.\s*create/);
      expect(src).not.toMatch(/\bmodel\s*:\s*["'`]/);
    }
  });

  test("sleep imports only types, physics and store — and NOTHING from self/", () => {
    const files = readdirSync(SLEEP_SRC).filter((f) => f.endsWith(".ts"));
    const allowed = /^(node:(fs|path)|\.\.\/types\.js|\.\.\/physics\/[\w.-]+\.js|\.\.\/store\/[\w.-]+\.js|\.\/[\w.-]+\.js)$/;
    const seen: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(SLEEP_SRC, f), "utf8");
      for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1] as string;
        seen.push(spec);
        expect(spec).toMatch(allowed);
      }
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.some((s) => s.includes("/self/"))).toBe(false);
  });

  test("the watchdog/lease invariant REFUSES a wedged runner that could outlive its lock", () => {
    expect(validateWatchdog(60_000, 120_000, 300_000)).toEqual({ ok: true, reason: "OK" });
    expect(validateWatchdog(60_000, 300_000, 300_000).reason).toBe(
      "HARD_KILL_AFTER_LEASE_RECLAIMABLE",
    );
    expect(validateWatchdog(60_000, 400_000, 300_000).ok).toBe(false);
    expect(validateWatchdog(120_000, 60_000, 300_000).reason).toBe("SOFT_NOT_BEFORE_HARD");
    expect(validateWatchdog(0, 10, 20).reason).toBe("SOFT_NOT_FINITE");
    expect(validateWatchdog(1, Number.NaN, 20).reason).toBe("HARD_NOT_FINITE");
    expect(validateWatchdog(1, 2, -1).reason).toBe("LEASE_NOT_FINITE");
  });

  test("every phase report carries a named reason, always", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: s, date: "2026-01-02" });
    expect(report.phases.length).toBe(PHASES.length);
    for (const pr of report.phases) {
      expect(typeof pr.reason).toBe("string");
      expect(pr.reason.length).toBeGreaterThan(0);
      expect(["ran", "ran-nothing-found", "did-not-run", "failed"]).toContain(pr.status);
    }
  });

  test("cycle telemetry is content-by-reference: ids, counts and reasons, never bodies", () => {
    const s = store();
    prunable(s, { body: "A memory containing the distinctive word zygomorphic." });
    const report = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 1 }) });
    const serialized = JSON.stringify({ events: report.events, phases: report.phases });
    expect(serialized).not.toContain("zygomorphic");
    expect(report.events.length).toBeGreaterThan(0);
  });

  test("the phase helpers start empty and count skips by name", () => {
    const out = emptyOutcome();
    expect(out).toEqual({
      examined: 0,
      changed: 0,
      skipped: {},
      budgetExhausted: false,
      skippedForBudget: 0,
    });
    const s = store();
    const id = prunable(s);
    const result = runPrune(ctx(wrap(s), 1, { apply: false }));
    // A dry run computes the verdict and writes nothing.
    expect(result.pruned.length).toBe(1);
    expect(s.read(id).archived).toBe(false);
    const dedup = runDedup(ctx(wrap(s), 1, { apply: false }));
    expect(dedup.merged).toEqual([]);
    expect(dedup.degradedToLexical).toBe(false);
  });

  test("sleep events never carry a payload that is not a scalar", () => {
    const s = store();
    prunable(s);
    const events: SleepEvent[] = [];
    runCycle({ store: s, date: "2026-01-02", onEvent: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(2);
    for (const e of events) {
      for (const value of Object.values(e.data ?? {})) {
        expect(["string", "number", "boolean", "object"]).toContain(typeof value);
        if (typeof value === "object") expect(value).toBeNull();
      }
    }
  });

  test("the phase list is the contract's order and nothing may quietly reorder it", () => {
    const expected: Phase[] = [
      "clock",
      "decay",
      "consolidate",
      "prune",
      "fade",
      "dedup",
      "versions",
      "briefing",
      "log",
    ];
    expect([...PHASES]).toEqual(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G12 — band moves counted BY DIRECTION, and the ratchet tripwire consuming
// them. v1 ran 279 up-moves against zero down-moves for three days and nothing
// fired (scar §2.10); `physics.symmetryCheck` existed here from the start and
// was enforced in one place and consumed by nobody. This is the counter.
// ═══════════════════════════════════════════════════════════════════════════
describe("band transitions, counted by direction (guarantee 12)", () => {
  const date = (i: number): string => new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);

  /** Advance the LIVED-day clock without running cycles — days actually lived
   *  (scar E8), which is the clock decay reads. */
  function live(s: Store, from: number, to: number): void {
    for (let i = from; i <= to; i += 1) s.advanceClock(date(i));
  }

  function transitions(s: Store): Record<string, unknown>[] {
    return s
      .eventLog({ name: "band.transition", limit: 1000 })
      .map((row) => JSON.parse(row.payload ?? "{}") as Record<string, unknown>);
  }

  test("a DEMOTION is counted, durably, with its direction and its site", () => {
    const s = store();
    const id = put(s, {
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
      physics: { birthDay: 0, lastUsedDay: 0, uses: 2 },
    });

    // Tick one materializes the band for the first time. A first reading is NOT
    // a crossing — counting it would hand the tripwire fabricated up-moves on
    // exactly the days (fresh store, post-`rebuildCache`) it can least tell.
    const first = runCycle({ store: s, date: date(1) });
    expect(first.bandTransitions).toEqual([]);

    // A hundred lived days later the same memory has fallen under THETA_SEM.
    live(s, 2, 100);
    const report = runCycle({ store: s, date: date(101) });

    expect(report.bandTransitions.length).toBe(1);
    const move = report.bandTransitions[0]!;
    expect(move.id).toBe(id);
    expect(move.from).toBe("semantic");
    expect(move.to).toBe("episodic");
    expect(move.direction).toBe("down");
    // The decay materialization is the ONE site: a demotion is not a decision
    // anybody makes, it is a number falling back under the line.
    expect(move.site).toBe("decay");
    expect(move.kind).toBe("fact");

    // And it is DURABLE — the parallel run's only evidence is a store.
    const durable = transitions(s);
    expect(durable.length).toBe(1);
    expect(durable[0]?.["direction"]).toBe("down");
  });

  test("the same demotion is recorded ONCE, however many times the day is replayed", () => {
    const s = store();
    put(s, {
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
      physics: { birthDay: 0, lastUsedDay: 0, uses: 2 },
    });
    runCycle({ store: s, date: date(1) });
    live(s, 2, 100);
    runCycle({ store: s, date: date(101) });
    expect(transitions(s).length).toBe(1);

    // The same lived day, run again: the latch holds (§5 G3).
    runCycle({ store: s, date: date(101) });
    expect(transitions(s).length).toBe(1);
  });

  test("an identity crossing becomes an UP-move on the next tick, and only once", () => {
    const s = store();
    const id = put(s, {
      kind: "self",
      salience: { claimed: 0.9, relevance: 0.9, emotional: 0.9, predictive: 0.9 },
      physics: { consolidated: true, reinforcedDays: 3, uses: 3 },
    });
    const crossing = runCycle({ store: s, date: date(1) });
    expect(crossing.promoted.length).toBe(1);
    // Not double-counted at the promotion site: the cache diff has no way to
    // know a move was already recorded, and a double-counted up-move is a
    // ratchet tripwire lying in the ratchet's own direction.
    expect(crossing.bandTransitions).toEqual([]);

    const next = runCycle({ store: s, date: date(2) });
    expect(next.bandTransitions.length).toBe(1);
    expect(next.bandTransitions[0]?.id).toBe(id);
    expect(next.bandTransitions[0]?.to).toBe("identity");
    expect(next.bandTransitions[0]?.direction).toBe("up");

    // Once. The band does not keep re-crossing on every quiet day after.
    runCycle({ store: s, date: date(3) });
    expect(transitions(s).length).toBe(1);
  });

  test("an OBSERVER records no transition — it materializes no cache to diff against", () => {
    const s = store();
    put(s, {
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
      physics: { birthDay: 0, lastUsedDay: 0, uses: 2 },
    });
    runCycle({ store: s, date: date(1) });
    live(s, 2, 100);

    const instrument = store({ observer: true });
    const report = runCycle({ store: instrument, date: date(101) });
    expect(report.observer).toBe(true);
    // Not "it computed the move and declined to write it": an observer opens no
    // ranking cache at all (a created file is a mutation), so there is no prior
    // reading to diff against — the same stand-down, one layer earlier.
    expect(report.bandTransitions).toEqual([]);
    expect(transitions(s)).toEqual([]);
    // It still renders the verdict, because reading is what an instrument is
    // for — and on a log with nothing in it the verdict is `never-asked`.
    expect(report.symmetry.length).toBe(Object.keys(PHYSICS.KINDS).length);
    expect(report.symmetry.every((v) => v.reason === "never-asked")).toBe(true);

    // …and the real store, run afterwards, still catches the demotion, so the
    // instrument cost the counter nothing.
    const after = runCycle({ store: s, date: date(101) });
    expect(after.bandTransitions.length).toBe(1);
    expect(after.bandTransitions[0]?.direction).toBe("down");
  });
});

describe("the ratchet tripwire renders a verdict every cycle (guarantee 12)", () => {
  const date = (i: number): string => new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);

  /** Plants N moves of one direction in the durable log, as the decay pass
   *  would have written them. The verdict is arithmetic over these rows. */
  function plant(s: Store, kind: string, direction: "up" | "down", n: number): void {
    for (let i = 0; i < n; i += 1) {
      s.appendEvent({
        name: "band.transition",
        day: 1,
        ref: `mem_planted${direction}${i}`,
        dedupKey: `band.transition:mem_planted${direction}${i}:1`,
        payload: { kind, from: "episodic", to: "semantic", direction, site: "decay" },
      });
    }
  }

  test("every kind gets a verdict, and an untouched store reads NEVER-ASKED", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: s, date: date(2) });

    expect(report.symmetry.length).toBe(Object.keys(PHYSICS.KINDS).length);
    for (const verdict of report.symmetry) {
      // `ok: true` with reason `never-asked`. A consumer reading `ok` alone
      // reads a starved counter as health — which is the whole scar.
      expect(verdict.reason).toBe("never-asked");
      expect(verdict.up + verdict.down).toBe(0);
      expect(verdict.reason).not.toBe("within-expectation");
    }
  });

  test("below the minimum sample it stays NEVER-ASKED — a small clean sample is not health", () => {
    const s = store();
    put(s);
    plant(s, "fact", "up", PHYSICS.SYMMETRY_MIN_SAMPLE - 1);
    const report = runCycle({ store: s, date: date(2) });
    const fact = report.symmetry.find((v) => v.kind === "fact");
    expect(fact?.up).toBe(PHYSICS.SYMMETRY_MIN_SAMPLE - 1);
    expect(fact?.reason).toBe("never-asked");
    expect(fact?.ratio).toBe(Infinity);
  });

  test("a RATCHET trips: up-moves with no down-moves, over the sample, is not ok", () => {
    const s = store();
    put(s);
    plant(s, "fact", "up", PHYSICS.SYMMETRY_MIN_SAMPLE);
    const events: SleepEvent[] = [];
    const report = runCycle({ store: s, date: date(2), onEvent: (e) => events.push(e) });

    const fact = report.symmetry.find((v) => v.kind === "fact");
    expect(fact?.ok).toBe(false);
    expect(fact?.reason).toBe("ratchet-suspected");
    // Loud, by its own event, not only by a field on a report.
    const tripped = events.filter((e) => e.name === "sleep.symmetry.tripped");
    expect(tripped.length).toBe(1);
    expect(tripped[0]?.data?.kind).toBe("fact");
    expect(tripped[0]?.data?.reason).toBe("ratchet-suspected");

    // Infinity is not JSON, and a null that means Infinity is a lie in a log:
    // the ratio is reported only when finite.
    const asked = events.filter((e) => e.name === "sleep.symmetry" && e.data?.kind === "fact");
    expect(asked.length).toBe(1);
    expect(asked[0]?.data?.ratio).toBe(null);
    expect(asked[0]?.data?.up).toBe(PHYSICS.SYMMETRY_MIN_SAMPLE);
  });

  test("a healthy mix reads WITHIN-EXPECTATION, so the tripwire is not simply always red", () => {
    const s = store();
    put(s);
    plant(s, "fact", "up", PHYSICS.SYMMETRY_MIN_SAMPLE);
    plant(s, "fact", "down", PHYSICS.SYMMETRY_MIN_SAMPLE);
    const report = runCycle({ store: s, date: date(2) });
    const fact = report.symmetry.find((v) => v.kind === "fact");
    expect(fact?.ok).toBe(true);
    expect(fact?.reason).toBe("within-expectation");
    expect(fact?.ratio).toBe(1);
  });

  test("a store with NO durable log gets no verdict at all, and says so", () => {
    const s = store();
    put(s);
    const events: SleepEvent[] = [];
    // `wrap()` carries neither `appendEvent` nor `eventLog`: a port that cannot
    // be asked has not answered. Six `never-asked` rows would claim a counter
    // was consulted when none exists (scar §2.4, from the other side).
    const report = runCycle({ store: wrap(s), date: date(2), onEvent: (e) => events.push(e) });
    expect(report.symmetry).toEqual([]);
    expect(events.filter((e) => e.name === "sleep.symmetry.unavailable").length).toBe(1);
  });

  test("a torn transition row is counted as unreadable, never silently as a move", () => {
    const s = store();
    put(s);
    s.appendEvent({
      name: "band.transition",
      day: 1,
      ref: "mem_torn",
      dedupKey: "band.transition:mem_torn:1",
      payload: { kind: "fact", from: "episodic", to: "semantic", direction: "sideways" },
    });
    const events: SleepEvent[] = [];
    const report = runCycle({ store: s, date: date(2), onEvent: (e) => events.push(e) });
    const fact = report.symmetry.find((v) => v.kind === "fact");
    expect(fact?.up).toBe(0);
    expect(fact?.down).toBe(0);
    expect(events.filter((e) => e.name === "sleep.symmetry.unreadable").length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("dedup leaves the journal alone", () => {
  test("an episode and the memory ingested from it are not duplicates of each other", () => {
    // Found 2026-09-04, the first time anything actually ingested an episode.
    // The memory carries the episode's own prose, so the two share a content
    // hash BY CONSTRUCTION — and dedup merged the fresh memory into the journal
    // at the same boundary that minted it. The episode was then left with no
    // live memory, and its idempotency key pointed at an archived row, so no
    // later boundary would mint another. "Episode is not a memory kind."
    const s = Store.open({ dir });
    open.push(s);
    const body = "## chapter 1 — lived day 0\n\nI learned that I stall when the spec is ambiguous.\n";
    const episodeId = s.put({ type: "episode", kind: "self", body, source: "episode" });
    const memoryId = s.put({ type: "memory", kind: "self", body, source: "episode" });
    const out = runDedup(ctx(wrap(s), 0));
    expect(out.merged.length).toBe(0);
    expect(s.row(memoryId)?.archived).toBe(0);
    expect(s.row(episodeId)?.archived).toBe(0);
    // Two ordinary memories with the same body still merge: the rule is about
    // the JOURNAL, not a hole in dedup.
    const twin = s.put({ type: "memory", kind: "self", body, source: "authored" });
    const again = runDedup(ctx(wrap(s), 0));
    expect(again.merged.length).toBe(1);
    expect([s.row(memoryId)?.archived, s.row(twin)?.archived]).toContain(1);
    expect(s.row(episodeId)?.archived).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * DEDUP LEAVES A REVISION'S SUCCESSOR ALONE.
 *
 * Found 2026-09-04 by the demo seeder, the first store that ever crossed the
 * pressure bar. A revision mints the successor with the CHALLENGER'S WORDS —
 * that is the design (`schemas/` §5.6: the new belief is the statement that
 * won), so the two bodies are byte-identical BY CONSTRUCTION. Dedup then saw
 * one content-hash group of two live rows, and the tie-break — birth day, then
 * id, and `mem_` sorts before `sch_` — always made the successor the duplicate.
 * `declared-revision-never-merged` cannot catch it: that declaration names the
 * PREDECESSOR, and the successor has a fresh id. The `stories` view ended
 * "REVISED, becoming ... [archived: merged]" and the revised belief left the
 * store as a belief the same evening it was formed — constitution 7, "revisions
 * keep their history; nothing bulk-wipes silently".
 */
describe("dedup leaves a revision's successor alone", () => {
  /** The salience the schemas suite uses to get below-bar, below-bar, revised. */
  const FORCE = 0.45;

  function challengerFor(s: Store, opts: { day: number; body: string; updates: string }): string {
    return s.put({
      type: "memory",
      kind: "person",
      body: opts.body,
      // Faithful to the minting seam: `mint.ts` writes the declaration into the
      // challenger's prose meta. It names the PREDECESSOR, which is exactly why
      // the existing guard misses the pair the revision then creates.
      meta: { updates: opts.updates },
      salience: { novelty: null, relevance: FORCE, emotional: FORCE, predictive: FORCE },
      physics: { birthDay: opts.day, lastUsedDay: opts.day },
    });
  }

  test("a belief revised under pressure keeps a LIVE successor through the same day's dedup", () => {
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = sc.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    // Three credited challenges on three lived days, each through the `updates:`
    // door. Distinct bodies, so the challengers are not each other's duplicates
    // and only the LAST one shares its words with the successor it makes.
    const bodies = [
      "Ada asked for a live walkthrough on Tuesday",
      "Ada booked a second synchronous review slot",
      "Ada asked for a live walkthrough instead",
    ];
    const reasons: string[] = [];
    let challengerId = "";
    let successorId: string | null = null;
    for (const [i, body] of bodies.entries()) {
      const day = i + 1;
      challengerId = challengerFor(s, { day, body, updates: beliefId });
      const out = applyRevision(
        s,
        sc,
        { updates: beliefId, challengerId, day, method: "declared" },
        {},
      );
      reasons.push(out.reason);
      successorId = out.successorId ?? successorId;
    }
    expect(reasons).toEqual(["below-bar", "below-bar", "revised"]);
    expect(successorId).not.toBeNull();
    const successor = successorId as string;

    // The bug's precondition, asserted rather than assumed: the successor and
    // the challenger that carried the crossing say the SAME WORDS.
    expect(s.read(successor).doc.body).toBe(s.read(challengerId).doc.body);

    const out = runDedup(ctx(wrap(s), 3));

    // Nothing merged, and the pass NAMES the refusal.
    //
    // 2026-09-05: the name MOVED, and the invariant did not. This successor is
    // a `sch_` row (`schemas/index.ts` mints element successors as
    // `type: "schema"`), so the wider rule below — a schema row is not a dedup
    // candidate at all — now stands it down before a pair is ever formed, and
    // `revision-successor-never-merged` no longer has anything to fire on
    // here. G9b is not dead: `revision.ts`'s identity arm mints a `mem_`
    // successor, and the test at the end of this block is the one that keeps
    // G9b honest.
    expect(out.merged).toEqual([]);
    expect(out.leftAlone["revision-successor-never-merged"]).toBeUndefined();
    expect(out.skipped["schema"]).toBeGreaterThan(0);
    expect(s.row(successor)?.archived).toBe(0);
    expect(s.row(challengerId)?.archived).toBe(0);

    // The revision's history is intact and readable: predecessor archived with
    // its reason, successor live, the link between them resolvable.
    expect(s.read(beliefId).archivedReason).toBe(SCHEMA_TUNABLES.REVISED_REASON);
    expect(s.read(beliefId).supersededBy).toBe(successor);
    expect(s.resolve(beliefId)).toBe(successor);

    // ... and the successor is still a BELIEF: it reads out of the entity, and
    // the story ends REVISED with a live successor rather than a merged one.
    expect(sc.beliefs(entityId).map((b) => b.id)).toEqual([successor]);
    const story = sc.story(beliefId);
    expect(story.headId).toBe(successor);
    expect(story.increments).toHaveLength(3);
    expect(story.lineage.find((l) => l.reason === SCHEMA_TUNABLES.REVISED_REASON)?.successorId).toBe(
      successor,
    );

    // Replay: a second pass over the same live pair finds the same refusal and
    // still credits nothing (§5 G3).
    const usesBefore = s.physicsOf(challengerId).uses;
    const again = runDedup(ctx(wrap(s), 4));
    expect(again.merged).toEqual([]);
    expect(again.skipped["schema"]).toBe(out.skipped["schema"]);
    expect(s.physicsOf(challengerId).uses).toBe(usesBefore);
  });

  test("the current-state arm too: a replaced now-fact keeps its live successor", () => {
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the v1 instance",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const stateId = sc.addCurrentState({
      entityId,
      statement: "Bansai is running as the live instance",
      day: 0,
      statedOn: "2026-08-01",
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    // A now-fact flips on ONE clear correction — no bar to climb, so the
    // identical-bodies pair exists from the first challenge.
    const challengerId = challengerFor(s, {
      day: 1,
      body: "Bansai is muted; counterparts is primary",
      updates: stateId,
    });
    const applied = applyRevision(
      s,
      sc,
      { updates: stateId, challengerId, day: 1, method: "declared" },
      {},
    );
    expect(applied.reason).toBe("replaced");
    const successor = applied.successorId as string;
    expect(s.read(successor).doc.body).toBe(s.read(challengerId).doc.body);

    const out = runDedup(ctx(wrap(s), 1));
    expect(out.merged).toEqual([]);
    // Also a `sch_` successor, so also stood down by the schema rule (see the
    // note in the first test of this block). The invariant is unchanged.
    expect(out.skipped["schema"]).toBeGreaterThan(0);
    expect(s.row(successor)?.archived).toBe(0);
    expect(s.read(stateId).archivedReason).toBe(SCHEMA_TUNABLES.REPLACED_REASON);
    expect(s.read(stateId).supersededBy).toBe(successor);
    expect(sc.currentState(entityId).map((e) => e.id)).toEqual([successor]);
  });

  test("the guard is NARROW: two ordinary memories with one body still merge", () => {
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const stateId = sc.addCurrentState({
      entityId,
      statement: "Ada is reviewing asynchronously this quarter",
      day: 0,
      statedOn: "2026-08-01",
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const BODY = "Ada is reviewing live for the rest of the quarter";
    const challengerId = challengerFor(s, { day: 1, body: BODY, updates: stateId });
    const successor = applyRevision(
      s,
      sc,
      { updates: stateId, challengerId, day: 1, method: "declared" },
      {},
    ).successorId as string;

    // A third, ordinary memory saying exactly what the challenger said. It is
    // nobody's revision successor, so it is an ordinary duplicate and merges —
    // uses credited on the ORIGINAL, the duplicate archived (§5.7).
    // An id that sorts LAST among the group's memories, so the tie-break's
    // choice of original is the challenger and this test is not a coin flip.
    const twin = put(s, { id: "mem_ffffffffffff", body: BODY, physics: { birthDay: 1, lastUsedDay: 1 } });
    const usesBefore = s.physicsOf(challengerId).uses;
    const daysBefore = s.physicsOf(challengerId).reinforcedDays ?? 0;
    const lastUsedBefore = s.physicsOf(challengerId).lastUsedDay;

    const out = runDedup(ctx(wrap(s), 2));
    expect(out.merged.map((m) => m.candidateId)).toEqual([twin]);
    expect(out.merged[0]?.originalId).toBe(challengerId);
    expect(out.merged[0]?.reason).toBe("identical-content-hash");
    expect(out.merged[0]?.usesDelta).toBe(1);
    expect(out.merged[0]?.credit).toBe("uses-only");
    expect(s.physicsOf(challengerId).uses).toBe(usesBefore + 1);
    // Owner ruling 2026-09-14 (R1): a merge is a re-encounter on the record,
    // NOT engagement — no reinforced day, no last-used day. Promotion stays
    // gated on the assistant expanding or quoting a memory (recall §9.2).
    expect(s.physicsOf(challengerId).reinforcedDays ?? 0).toBe(daysBefore);
    expect(s.physicsOf(challengerId).lastUsedDay).toBe(lastUsedBefore);
    expect(s.row(twin)?.archived).toBe(1);
    // The successor is a `sch_` row and never joins the group at all now; the
    // ordinary pair it used to sit beside merges exactly as before, which is
    // the whole point of this test.
    expect(out.skipped["schema"]).toBeGreaterThan(0);
    expect(s.row(successor)?.archived).toBe(0);
  });

  test("a twin born EARLIER takes the original's seat — the successor still survives", () => {
    // The pair relation alone is not enough. If an ordinary memory already says
    // what the challenger is about to say, and was born first, the tie-break
    // makes THAT row the group's original: the challenger and the successor both
    // pair against the twin, the relation reads false against it, and both
    // archive. The element is then left with NO live version at all — worse than
    // the finding this suite opened with. The trigger is ordinary: the same
    // sentence noted twice.
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the v1 instance",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const stateId = sc.addCurrentState({
      entityId,
      statement: "Bansai is running as the live instance",
      day: 0,
      statedOn: "2026-08-01",
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    const BODY = "Bansai is muted; counterparts is primary";
    // Born a day BEFORE the challenger, so it is unambiguously the original.
    const twin = put(s, { body: BODY, physics: { birthDay: 0, lastUsedDay: 0 } });
    const challengerId = challengerFor(s, { day: 1, body: BODY, updates: stateId });
    const successor = applyRevision(
      s,
      sc,
      { updates: stateId, challengerId, day: 1, method: "declared" },
      {},
    ).successorId as string;

    const out = runDedup(ctx(wrap(s), 1));

    // The SUCCESSOR is what the revision produced, and it survives: an
    // accommodation row can never be the losing candidate of a same-hash merge.
    expect(s.row(successor)?.archived).toBe(0);
    expect(sc.currentState(entityId).map((e) => e.id)).toEqual([successor]);
    expect(out.skipped["schema"]).toBeGreaterThan(0);

    // The CHALLENGER is a different question, and it is deliberately left to the
    // ordinary rule: it is a plain memory that says what a plain memory already
    // said, so it merges into the twin and credits it. Nothing about the
    // revision is lost by that — the successor holds the words, the element
    // holds the successor, and `origin_ref` still names the merged challenger,
    // whose prose and id survive the archive.
    expect(out.merged.map((m) => m.candidateId)).toEqual([challengerId]);
    expect(out.merged[0]?.originalId).toBe(twin);
    expect(s.row(challengerId)?.archived).toBe(1);
    expect(s.row(challengerId)?.archived_reason).toBe(MERGE_ARCHIVE_REASON);
  });

  test("two challengers with ONE body revise two elements — both successors live", () => {
    // The second door of the same edge. `sb` (b's successor) pairs against `ca`
    // (a's challenger), not against its own `cb`, so the pair relation is false
    // and — before the wider clause — `cb` and `sb` both archived: element b
    // silently lost its revision while element a kept its own.
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the v1 instance",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const mk = (statement: string): string =>
      sc.addCurrentState({
        entityId,
        statement,
        day: 0,
        statedOn: "2026-08-01",
        dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
      }).id as string;
    const a = mk("Bansai runs the morning batch");
    const b = mk("Bansai runs the evening batch");

    // One sentence, noted twice on the same day, against two different rows.
    const BODY = "Bansai runs nothing; the batches moved to counterparts";
    const ca = challengerFor(s, { day: 1, body: BODY, updates: a });
    const cb = challengerFor(s, { day: 1, body: BODY, updates: b });
    const sa = applyRevision(s, sc, { updates: a, challengerId: ca, day: 1, method: "declared" }, {})
      .successorId as string;
    const sb = applyRevision(s, sc, { updates: b, challengerId: cb, day: 1, method: "declared" }, {})
      .successorId as string;

    runDedup(ctx(wrap(s), 1));

    expect(s.row(sa)?.archived).toBe(0);
    expect(s.row(sb)?.archived).toBe(0);
    expect(sc.currentState(entityId).map((e) => e.id).sort()).toEqual([sa, sb].sort());
  });

  test("G9b is still load-bearing: the IDENTITY arm's successor is a mem_ row", () => {
    // `schemas/index.ts` mints element successors as `type: "schema"`, so the
    // schema exclusion below covers those. `revision.ts#identityChallenge`
    // mints its successor as `type: "memory"` (line ~387) — an ORDINARY row
    // with `source: "accommodation"` — and the exclusion does not reach it.
    // G9b is the only thing standing between that successor and the challenger
    // whose words it carries, so this test is the reason G9b stays.
    const s = store();
    const sc = Schemas.open({ store: s });
    const target = put(s, {
      body: "I answer in the shortest form that is still true",
      band: "identity",
      salience: { novelty: null, relevance: 0.6, emotional: 0.6, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    expect(s.row(target)?.band).toBe("identity");

    // Identity does not flip on one sentence: three lived days of pressure.
    const bodies = [
      "I wrote a long answer because the short one was wrong",
      "I wrote a second long answer on purpose",
      "I answer at whatever length the question needs",
    ];
    let challengerId = "";
    let successorId: string | null = null;
    for (const [i, body] of bodies.entries()) {
      const day = i + 1;
      challengerId = challengerFor(s, { day, body, updates: target });
      const out = applyRevision(
        s,
        sc,
        { updates: target, challengerId, day, method: "declared" },
        {},
      );
      successorId = out.successorId ?? successorId;
    }
    expect(successorId).not.toBeNull();
    const successor = successorId as string;
    // The precondition: a MEMORY row, not a schema row, carrying the
    // challenger's own words.
    expect(s.row(successor)?.type).toBe("memory");
    expect(s.row(successor)?.source).toBe("accommodation");
    expect(s.read(successor).doc.body).toBe(s.read(challengerId).doc.body);

    const out = runDedup(ctx(wrap(s), 3));
    expect(out.merged).toEqual([]);
    expect(out.leftAlone["revision-successor-never-merged"]).toBe(1);
    expect(s.row(successor)?.archived).toBe(0);
    expect(s.row(challengerId)?.archived).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * A BELIEF IS NOT A DUPLICATE OF A MEMORY.
 *
 * Probe H, filed by the adversarial review on 2026-09-04 (NOTES §12) and left
 * open there: an element and an ordinary memory can carry the same words with
 * NO revision anywhere — an `addBelief` whose statement is X and a memory whose
 * body is X. G9b does not apply (no accommodation row is involved), the
 * tie-break puts `mem_` before `sch_`, and the belief is archived `merged` into
 * the memory. `beliefs(entity)` then reads empty and the store has quietly
 * stopped believing something nobody retracted.
 *
 * On the live store the pair is not exotic but LIKELY: `tools/migrate/apply.ts`
 * minted every migrated element at the import day while migrated memories kept
 * their v1 birth day, so on every such collision the memory is strictly older
 * and the element loses without even needing the id tie-break.
 *
 * The rule: a `type: "schema"` row is not a dedup candidate at all. Beliefs
 * have their own revision machinery (`schemas/` §5.6, "beliefs never blend";
 * §5 G4, "near collisions refuse loudly rather than merging"), and duplicates
 * among beliefs are that module's question, not this phase's.
 */
describe("dedup never compares a belief with a memory", () => {
  test("a belief and a memory with the SAME body, born the same day: both stay live", () => {
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const STATEMENT = "Ada prefers async review";
    const beliefId = sc.addBelief({
      entityId,
      statement: STATEMENT,
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    // No revision anywhere: an ordinary memory that happens to say the same
    // sentence on the same day.
    const memoryId = put(s, { body: STATEMENT, physics: { birthDay: 0, lastUsedDay: 0 } });
    expect(s.read(beliefId).doc.body).toBe(s.read(memoryId).doc.body);

    const usesBefore = s.physicsOf(memoryId).uses;
    const out = runDedup(ctx(wrap(s), 0));

    expect(out.merged).toEqual([]);
    expect(s.row(beliefId)?.archived).toBe(0);
    expect(s.row(memoryId)?.archived).toBe(0);
    // Nothing was credited either: a merge that did not happen credits no use.
    expect(s.physicsOf(memoryId).uses).toBe(usesBefore);
    // And the belief is still a belief.
    expect(sc.beliefs(entityId).map((b) => b.id)).toEqual([beliefId]);
    // Named, not silent (§5 G6): the phase says it stood the schema rows down.
    // TWO of them — the belief and the ENTITY it hangs off, which is a
    // `type: "schema"` row as well (`schemas/index.ts#mention`).
    expect(out.skipped["schema"]).toBe(2);
  });

  test("the migration's shape: an element born LATER than the memory still survives", () => {
    // `migrate/apply.ts` mints elements at the import day; migrated memories
    // keep their v1 birth day. So the memory is older on every such pair and
    // wins the tie-break outright, with no id comparison needed.
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the v1 instance",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const STATEMENT = "Bansai is the v1 instance and keeps running";
    const memoryId = put(s, { body: STATEMENT, physics: { birthDay: 0, lastUsedDay: 0 } });
    const stateId = sc.addCurrentState({
      entityId,
      statement: STATEMENT,
      day: 40,
      statedOn: "2026-09-03",
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    const out = runDedup(ctx(wrap(s), 40));

    expect(out.merged).toEqual([]);
    expect(s.row(stateId)?.archived).toBe(0);
    expect(s.row(memoryId)?.archived).toBe(0);
    expect(sc.currentState(entityId).map((e) => e.id)).toEqual([stateId]);
  });

  test("the COSINE path too: a near-duplicate belief and memory both stay live", () => {
    // The injected source is the other door into this phase, and a source that
    // reads `liveIds` never sees a schema id once they are out of the live set.
    // This one hands the pair over anyway — the belt-and-braces case — and the
    // phase must still refuse it rather than merging at 0.99.
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = sc.addBelief({
      entityId,
      statement: "Ada prefers asynchronous review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const memoryId = put(s, {
      body: "Ada prefers async review",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });

    // Distinct bodies, so the hash path finds nothing and this test is only
    // about cosine.
    expect(s.read(beliefId).doc.body).not.toBe(s.read(memoryId).doc.body);

    const source = (): DedupPair[] => [
      { candidateId: beliefId, originalId: memoryId, cosine: 0.99 },
      // And the other direction, because which row an embedding source calls
      // the original is not this phase's choice either.
      { candidateId: memoryId, originalId: beliefId, cosine: 0.99 },
    ];
    const out = runDedup(ctx(wrap(s), 0), source);

    expect(out.merged).toEqual([]);
    expect(s.row(beliefId)?.archived).toBe(0);
    expect(s.row(memoryId)?.archived).toBe(0);
    expect(sc.beliefs(entityId).map((b) => b.id)).toEqual([beliefId]);
    // Two rows stood down when the live set was built (the entity and the
    // belief), plus the two pairs the injected source handed over anyway —
    // and those two are named `schema` rather than `already-archived`, which
    // is what the belt-and-braces arm exists for.
    expect(out.skipped["schema"]).toBe(4);
  });

  test("two ordinary memories with one body still merge — the exclusion is NARROW", () => {
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const BODY = "Ada asked for the review notes in writing";
    // A belief saying the SAME thing sits right beside them and is untouched.
    const beliefId = sc.addBelief({
      entityId,
      statement: BODY,
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const first = put(s, { id: "mem_aaaaaaaaaaaa", body: BODY, physics: { birthDay: 0, lastUsedDay: 0 } });
    const second = put(s, { id: "mem_ffffffffffff", body: BODY, physics: { birthDay: 1, lastUsedDay: 1 } });
    const usesBefore = s.physicsOf(first).uses;

    const out = runDedup(ctx(wrap(s), 1));

    expect(out.merged.map((m) => m.candidateId)).toEqual([second]);
    expect(out.merged[0]?.originalId).toBe(first);
    expect(out.merged[0]?.reason).toBe("identical-content-hash");
    expect(s.physicsOf(first).uses).toBe(usesBefore + 1);
    expect(s.row(second)?.archived).toBe(1);
    expect(s.row(beliefId)?.archived).toBe(0);
    expect(sc.beliefs(entityId).map((b) => b.id)).toEqual([beliefId]);
  });

  test("two beliefs with one body are left to `schemas/`, not merged here", () => {
    // The alternative rule — "compare schema rows only with schema rows on the
    // same entity" — would have merged this pair. It is deliberately not the
    // rule: `schemas/` §5 G4 refuses near collisions LOUDLY rather than
    // merging, and a belief archived by a sleep phase carries no reason anyone
    // can argue with.
    const s = store();
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const STATEMENT = "Ada prefers async review";
    const a = sc.addBelief({
      entityId,
      statement: STATEMENT,
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const b = sc.addBelief({
      entityId,
      statement: STATEMENT,
      day: 1,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    const out = runDedup(ctx(wrap(s), 1));

    expect(out.merged).toEqual([]);
    expect(sc.beliefs(entityId).map((e) => e.id).sort()).toEqual([a, b].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G16 — the log sweep. `Store.pruneEvents()` documented a 90-lived-day window
// and had NO caller (NOTES §13): the window was a number the log was eligible
// for and never subject to. The `log` phase is the caller, and it is last.
// ═══════════════════════════════════════════════════════════════════════════
describe("the log sweep — bounded retention on the durable event log (G16)", () => {
  const date = (i: number): string => new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);

  /** One of each RECORD kind the store latches — what a reader must still find. */
  function latchedRecords(s: Store, day: number): void {
    s.appendEvent({
      name: "memory.merged",
      day,
      ref: "sch_000000000001",
      dedupKey: "sleep.merged.sch_000000000001",
      payload: { candidateId: "sch_000000000001", originalId: "mem_000000000009", usesDelta: 1 },
    });
    s.appendEvent({ name: "memory.pruned", day, ref: "mem_000000000002", dedupKey: "sleep.pruned.mem_000000000002" });
    s.appendEvent({ name: "band.promoted", day, ref: "mem_000000000003", dedupKey: "sleep.promoted.mem_000000000003" });
    s.appendEvent({
      name: "band.transition",
      day,
      ref: "mem_000000000004",
      dedupKey: `band.transition:mem_000000000004:${day}:episodic:semantic`,
      payload: { kind: "fact", from: "episodic", to: "semantic", direction: "up", site: "decay" },
    });
    s.appendEvent({
      name: "revision.pressure",
      day,
      ref: "sch_000000000005",
      dedupKey: `revision.pressure:sch_000000000005:${day}:mem_000000000006`,
    });
    s.appendEvent({ name: "gate.chunk", day, ref: "chunk-1", dedupKey: `gate.chunk:chunk-1:${day}` });
    s.appendEvent({ name: "memory.unmerged", day, ref: "sch_000000000001", dedupKey: "memory.unmerged:sch_000000000001" });
  }
  const LATCHED_KINDS = [
    "memory.merged",
    "memory.pruned",
    "band.promoted",
    "band.transition",
    "revision.pressure",
    "gate.chunk",
    "memory.unmerged",
  ];

  test("unlatched rows past the window go; newer rows and EVERY latched record stay, and the kept are counted", () => {
    const s = store({ retentionDays: 2 });
    // Day 0: the telemetry a live day writes, plus one of every record kind.
    s.appendEvent({ name: "recall.decision", day: 0, ref: "session-old", payload: { surfaced: 2 } });
    s.appendEvent({ name: "adapter.boundary", day: 0, payload: { hook: "session-end" } });
    s.appendEvent({ name: "gate.deposit", day: 0, ref: "hash-old" });
    latchedRecords(s, 0);
    // Two lived days pass; day 2 writes its own telemetry.
    s.advanceClock(date(1));
    s.advanceClock(date(2));
    s.appendEvent({ name: "recall.decision", day: 2, ref: "session-new" });

    const events: SleepEvent[] = [];
    // The cycle's clock lands on day 3: cutoff = 3 - 2 = 1, so day-0 rows are
    // past the window and day-2 rows are inside it.
    const report = runCycle({ store: s, date: date(3), onEvent: (e) => events.push(e) });
    const log = phaseReport(report, "log");

    expect(log.status).toBe("ran");
    expect(log.reason).toBe("completed");
    expect(log.changed).toBe(3);
    expect(log.examined).toBe(3 + LATCHED_KINDS.length);
    expect(log.skipped["latched"]).toBe(LATCHED_KINDS.length);
    expect(log.budgetExhausted).toBe(false);
    expect(log.skippedForBudget).toBe(0);

    // What went, and what did not.
    expect(s.eventLog({ name: "adapter.boundary" })).toEqual([]);
    expect(s.eventLog({ name: "gate.deposit" })).toEqual([]);
    expect(s.eventLog({ name: "recall.decision" }).map((r) => r.ref)).toEqual(["session-new"]);
    for (const name of LATCHED_KINDS) {
      expect(s.eventLog({ name }).length, `${name} must survive at any age`).toBe(1);
    }
    // The owner's read-only check and `repair-merged-beliefs` both read this
    // exact query; it must answer the same after the sweep as before.
    const merged = s.eventLog({ name: "memory.merged" });
    expect(merged[0]?.ref?.startsWith("sch_")).toBe(true);

    // Reported the way the other phases report — counts, never contents.
    const swept = events.find((e) => e.name === "sleep.log.swept");
    expect(swept?.data).toEqual({
      day: 3,
      count: 3,
      eligible: 3,
      remaining: 0,
      keptLatched: LATCHED_KINDS.length,
      budget: 5_000,
      cutoffDay: 1,
      retentionDays: 2,
    });
  });

  test("the per-pass cap holds: the OLDEST rows go first, the rest are reported, and tomorrow takes the next cap's worth", () => {
    const s = store({ retentionDays: 0 });
    const seqs: number[] = [];
    for (let i = 0; i < 10; i++) seqs.push(s.appendEvent({ name: "recall.decision", day: 0, ref: `s${i}` }));

    // Day 1, cutoff 1: all ten day-0 rows are eligible; the cap is three.
    const first = runCycle({ store: s, date: date(1), budgets: { log: 3 } });
    const log = phaseReport(first, "log");
    expect(log.status).toBe("ran");
    expect(log.changed).toBe(3);
    expect(log.examined).toBe(10);
    expect(log.budgetExhausted).toBe(true);
    expect(log.skippedForBudget).toBe(7);
    expect(log.budget).toBe(3);
    // Oldest first, by seq — a cap that took arbitrary rows would leave the
    // feed with holes in the middle of its history.
    expect(s.eventLog({ name: "recall.decision" }).map((r) => r.seq)).toEqual(seqs.slice(3));
    // A budget is not a debt: the marker advanced, and nothing is owed.
    expect(log.markerAfter).toBe(first.day);

    // The same lived day again: nothing more goes.
    const replay = runCycle({ store: s, date: date(1), budgets: { log: 3 } });
    expect(phaseReport(replay, "log").reason).toBe("already-done-today");
    expect(s.eventLog({ name: "recall.decision" }).length).toBe(7);

    // Tomorrow takes the next three.
    const second = runCycle({ store: s, date: date(2), budgets: { log: 3 } });
    expect(phaseReport(second, "log").changed).toBe(3);
    expect(phaseReport(second, "log").skippedForBudget).toBe(4);
    expect(s.eventLog({ name: "recall.decision" }).map((r) => r.seq)).toEqual(seqs.slice(6));

    // A zero cap is a cap: the phase ran, counted, and deleted nothing.
    const held = runCycle({ store: s, date: date(3), budgets: { log: 0 } });
    expect(phaseReport(held, "log").status).toBe("ran-nothing-found");
    expect(phaseReport(held, "log").skippedForBudget).toBe(4);
    expect(s.eventLog({ name: "recall.decision" }).length).toBe(4);
  });

  test("idempotent: a clean window is a no-op on the phase AND on the raw store method", () => {
    const s = store({ retentionDays: 1 });
    for (let i = 0; i < 5; i++) s.appendEvent({ name: "adapter.recall", day: 0 });
    s.advanceClock(date(1));

    const first = runCycle({ store: s, date: date(2) }); // day 2, cutoff 1
    expect(phaseReport(first, "log").changed).toBe(5);
    const held = s.eventLogCensus().rows;

    expect(s.pruneEvents({ limit: 5_000 })).toEqual({
      pruned: 0,
      eligible: 0,
      remaining: 0,
      limit: 5_000,
      cutoffDay: 1,
      retentionDays: 1,
    });
    expect(s.pruneEvents().pruned).toBe(0);
    expect(s.eventLogCensus().rows).toBe(held);

    const next = runCycle({ store: s, date: date(3) }); // day 3, cutoff 2: nothing left below it
    expect(phaseReport(next, "log").status).toBe("ran-nothing-found");
    expect(phaseReport(next, "log").reason).toBe("nothing-to-do");
    expect(s.eventLogCensus().rows).toBe(held);
  });

  test("under observer the phase reports what WOULD go, attempts nothing, and the data dir is byte-identical", () => {
    const seed = store({ retentionDays: 0 });
    for (let i = 0; i < 7; i++) seed.appendEvent({ name: "recall.decision", day: 0, ref: `s${i}` });
    seed.appendEvent({ name: "memory.pruned", day: 0, ref: "mem_000000000001", dedupKey: "sleep.pruned.mem_000000000001" });
    seed.advanceClock(date(1)); // day 1, cutoff 1: seven eligible, one latched past the cutoff
    seed.close();
    open.splice(open.indexOf(seed), 1);

    const obs = store({ observer: true, retentionDays: 0 });
    const before = snapshot(dir);
    const report = runCycle({ store: obs, date: date(1), budgets: { log: 5 } });
    const after = snapshot(dir);

    const log = phaseReport(report, "log");
    expect(log.status).toBe("did-not-run");
    expect(log.reason).toBe("observer-report");
    expect(log.changed).toBe(5);
    expect(log.examined).toBe(8);
    expect(log.skippedForBudget).toBe(2);
    expect(log.budgetExhausted).toBe(true);
    expect(log.skipped["latched"]).toBe(1);
    expect(obs.events("store.observer.standdown").length).toBe(0);
    expect(diff(before, after)).toEqual([]);
    expect(obs.eventLogCensus().rows).toBe(8);
  });

  test("a port with no durable log reports `no-durable-event-log` — not a run, not a failure", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: wrap(s), date: date(2) });
    const log = phaseReport(report, "log");
    expect(log.status).toBe("did-not-run");
    expect(log.reason).toBe("no-durable-event-log");
    expect(log.markerAfter).toBe(log.markerBefore);
  });

  test("the default window is 90 lived days — longer than the parallel run — and a row leaves on the 91st, not the 90th", () => {
    // The run needs its own record: ≥ 7 active days plus review slack, every
    // one of them read off this table by `tools/parallel/readers.ts`. A default
    // shorter than that would destroy the run's evidence from under it.
    expect(DEFAULT_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
    const s = store();
    expect(s.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    s.appendEvent({ name: "recall.decision", day: 0, ref: "born-day-0" });
    for (let i = 1; i <= DEFAULT_RETENTION_DAYS - 1; i++) s.advanceClock(date(i));
    expect(s.livedDay()).toBe(DEFAULT_RETENTION_DAYS - 1);

    // The cycle lands on lived day 90: cutoff 0, and `day < 0` matches nothing.
    const ninety = runCycle({ store: s, date: date(DEFAULT_RETENTION_DAYS) });
    expect(phaseReport(ninety, "log").status).toBe("ran-nothing-found");
    expect(s.eventLog({ name: "recall.decision" }).length).toBe(1);

    // Lived day 91: cutoff 1, and the day-0 row is past the window.
    const ninetyOne = runCycle({ store: s, date: date(DEFAULT_RETENTION_DAYS + 1) });
    expect(phaseReport(ninetyOne, "log").changed).toBe(1);
    expect(s.eventLog({ name: "recall.decision" })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * THE JOURNAL IS OUTSIDE FORGETTING. Every phase was written when every row was
 * a memory; episodes only became real on 2026-09-04, and on the live store all
 * 224 migrated ones sit in the episodic band at zero on every dimension — so
 * the prune pass would have archived the whole journal at the floor, and an
 * archived episode stops reconciling, so the memories it had not yet minted
 * would never exist. Forgetting applies to what was minted FROM an episode.
 */
describe("sleep leaves the journal alone", () => {
  test("an episode at zero salience survives a full cycle unarchived and unmoved; its twin does not", () => {
    const s = store();
    // Three subjects, identical physics: the journal, an ordinary memory, and
    // the memory ingested FROM a journal (which is ordinary, and says so).
    // The store mints the episode's own id prefix, so this one does not go
    // through `put()`'s `mem_` naming.
    const episode = s.put({
      type: "episode",
      kind: "self",
      body: "## chapter 1 — lived day 0\n\nThe account of a day nobody has re-read since.\n",
      source: "episode",
      meta: { sessionId: "s-old" },
      physics: { birthDay: -120, lastUsedDay: -100, uses: 0 },
    });
    const twin = prunable(s, { kind: "self", body: "An ordinary memory with exactly the journal's physics." });
    const ingested = prunable(s, {
      kind: "self",
      body: "What that day taught, which is a different thing from the account of it.",
      source: "episode",
      meta: { episodeId: episode },
    });
    const bandBefore = s.row(episode)?.band;
    const revisionBefore = s.row(episode)?.revision;

    const report = runCycle({ store: s, date: "2026-01-02" });

    // The journal: untouched. Not archived, not moved, still readable.
    expect(s.row(episode)?.archived).toBe(0);
    expect(s.row(episode)?.band).toBe(bandBefore);
    expect(s.row(episode)?.revision).toBe(revisionBefore);
    expect(s.read(episode).doc.body).toContain("nobody has re-read");
    expect(report.pruned.map((p) => p.id)).not.toContain(episode);

    // Its twin, same physics, no journal: pruned at the floor.
    expect(report.pruned.map((p) => p.id)).toContain(twin);
    expect(s.row(twin)?.archived).toBe(1);
    // And the memory made FROM an episode is an ordinary memory: it forgets.
    expect(report.pruned.map((p) => p.id)).toContain(ingested);

    // Every phase counted the skip rather than passing over it in silence.
    // DEDUP included since 2026-09-05: G15 says "a named skip in each phase",
    // and until then dedup was the one arm that excluded the journal silently.
    for (const phase of ["decay", "prune", "consolidate", "dedup"] as const) {
      expect(phaseReport(report, phase).skipped["journal"]).toBe(1);
    }
  });

  test("the journal writes no strength row and crosses no band, however long it sits", () => {
    const s = store();
    const episode = s.put({
      type: "episode",
      kind: "self",
      body: "## chapter 1 — lived day 0\n\nA day, written down.\n",
      source: "episode",
      physics: { birthDay: -120, lastUsedDay: -100, uses: 0 },
    });
    const decay = runDecay(ctx(wrap(s), 200), memoryStrengthCache());
    expect(decay.written.map((r) => r.id)).not.toContain(episode);
    expect(decay.transitions.length).toBe(0);
    expect(decay.skipped["journal"]).toBe(1);
    expect(decay.examined).toBe(0);
  });

  test("the created-versus-exited counter counts MEMORIES: a chapter is not a birth", () => {
    // A journal entry counted as born-today would give its kind a permanent
    // created-without-exit imbalance — the exact signal G13 exists to raise.
    const s = store();
    s.put({
      type: "episode",
      kind: "self",
      body: "## chapter 1 — lived day 0\n\nWritten today.\n",
      source: "episode",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const report = runCycle({ store: s, date: "2026-01-02" });
    expect(report.census.self.created).toBe(0);
  });
});
