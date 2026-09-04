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

import { Store } from "../src/core/store/index.js";
import type { PutInput, StoreEvent } from "../src/core/store/index.js";
import { TUNABLES as PHYSICS, band, promotionEligibility, strength } from "../src/core/physics/index.js";
import { rowToPhysics } from "../src/core/store/operational.js";
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
  runCycle,
  runDecay,
  runDedup,
  runPrune,
  shouldSpawn,
  sqliteStrengthCache,
  strengthCachePath,
  validateWatchdog,
} from "../src/core/sleep/index.js";
import type {
  CycleStep,
  DedupPair,
  Phase,
  PhaseCtx,
  RenderFn,
  SleepEvent,
  SleepStore,
} from "../src/core/sleep/index.js";

const SLEEP_SRC = fileURLToPath(new URL("../src/core/sleep/", import.meta.url));
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
    expect(report.order[report.order.length - 1]).toBe("briefing");
    expect(phaseReport(report, "briefing").status).toBe("ran");

    // Render-last is behavior, not implementation: the LAST content write in the
    // whole cycle is the briefing's. Marker rows are written after it, and are
    // deliberately not content (§3 G5, self/ §5 G1).
    const contentWrites = events.filter((e) => CONTENT_WRITES.includes(e.name));
    expect(contentWrites.length).toBeGreaterThan(0);
    expect(contentWrites[contentWrites.length - 1]?.ref).toBe(briefingId);
  });

  test("every phase that ran advanced its marker to the cycle's day, and only forward", () => {
    const s = store();
    put(s);
    const report = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 1 }) });

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
    // no step to apply and nothing to write back.
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
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the floor prune — archival, never deletion", () => {
  test("a pruned memory is ARCHIVED with reason 'pruned': the file stays, the id resolves", () => {
    const s = store();
    const id = prunable(s);
    const prosePath = s.row(id)?.prose_path as string;

    const report = runCycle({ store: s, date: "2026-01-02" });

    expect(report.pruned.length).toBe(1);
    const stored = s.read(id);
    expect(stored.archived).toBe(true);
    expect(stored.archivedReason).toBe(PRUNE_ARCHIVE_REASON);
    // Fading is not deletion: the prose is where it was and the id still resolves.
    expect(existsSync(prosePath)).toBe(true);
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

  test("the default candidate source pairs by the INTERPRETATION, not by the prose document", () => {
    const s = store();
    const a = put(s, { body: BODY, title: "Starter", physics: { birthDay: 0 } });
    const b = put(s, { body: BODY, title: "Different title", physics: { birthDay: 1 } });
    // The two prose documents differ (id, title), so their content hashes differ.
    expect(s.row(a)?.content_hash).not.toBe(s.row(b)?.content_hash);
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

    const first = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 64 }) });
    expect(first.pruned.length).toBe(1);
    expect(first.merged.length).toBe(1);

    const before = snapshot(dir);
    const second = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 64 }) });
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
      "dedup",
      "versions",
      "briefing",
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
    for (const phase of ["decay", "prune", "consolidate"] as const) {
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
