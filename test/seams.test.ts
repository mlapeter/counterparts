/**
 * The wave-3 seam pass — cross-module wiring proofs (docs/SEAMS.md items A–N).
 *
 * Every test here composes modules that may not import each other, and proves
 * the wiring the gap files specify. A seam without a test in this file is not
 * closed: the whole point of the registry is that a guarantee enforced on one
 * side and starved on the other reads as working (scar §2.6).
 *
 * Hermetic by construction (CLAUDE.md): fresh temp data dir per test, removed in
 * `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Store, WRITE_METHODS } from "../src/core/store/index.js";
import { TUNABLES as PHYSICS_TUNABLES, consolidationEligibility } from "../src/core/physics/index.js";
import { MEMORY_SOURCES } from "../src/core/types.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { SpanBuffer, WRITE_SITES, submitProposal, sweep } from "../src/core/remember/index.js";
import type { InterpretFn, Proposal, Span, SweepChunk } from "../src/core/remember/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { applyRevision } from "../src/core/revision.js";
import { Dashboard, stripAnsi } from "../src/adapters/dashboard/index.js";
import { batteryGate, episodeGate } from "../src/core/bridge.js";
import { UPDATES_META_KEY, directionOf, mintProposal } from "../src/core/mint.js";
import { SCALAR_REF, loadGateState, saveGateState } from "../src/core/recall/index.js";
import { Associate } from "../src/core/associate/index.js";
import { Prospective } from "../src/core/prospective/index.js";
import { Recall, TUNABLES as RECALL_TUNABLES, freshGateState, gate } from "../src/core/recall/index.js";
import type { Candidate as RecallCandidate } from "../src/core/recall/index.js";
import { composeTurn, recallTurn } from "../src/core/retrieval.js";
import { Schemas } from "../src/core/schemas/index.js";
import { BRIEFING_KEY, Self } from "../src/core/self/index.js";
import { selfRenderer } from "../src/core/briefing.js";
import {
  declaredUpdates,
  phaseReport,
  runCycle,
  runConsolidate,
  runDedup,
  runPrune,
  strengthCachePath,
} from "../src/core/sleep/index.js";
import type { PhaseCtx, SleepStore } from "../src/core/sleep/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-seams-"));
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

/** A span that never entered a buffer — enough to reach `noteFailures()`' seam. */
function fakeSpan(scope: string): Span {
  return {
    hash: "h0",
    session: "s1",
    scope,
    kind: "conversation",
    text: "x",
    at: 0,
    day: 0,
    from: 0,
    to: 1,
  };
}

function wrap(s: Store): SleepStore {
  return {
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
    appendEvent: (input) => s.appendEvent(input),
  };
}

function phaseCtx(s: SleepStore, day: number, over: Partial<PhaseCtx> = {}): PhaseCtx {
  return { store: s, day, apply: true, budget: 1000, step: () => {}, event: () => {}, ...over };
}

/** A gate-shaped candidate with everything but the numbers under test defaulted. */
function unitCandidate(spec: {
  id: string;
  cue: number;
  temporal: number;
  semantic: number;
  arrival: number;
  sal: number;
  maxTier: RecallCandidate["maxTier"];
  kind?: RecallCandidate["kind"];
}): RecallCandidate {
  const activation = spec.cue + spec.semantic + spec.arrival;
  return {
    id: spec.id,
    kind: spec.kind ?? "fact",
    doc: {
      id: spec.id,
      type: "memory",
      learnedOn: "2026-08-25",
      bornDay: 0,
      meta: {},
      body: `body of ${spec.id} with its own distinctive tokens`,
    },
    physics: {
      kind: spec.kind ?? "fact",
      salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed: null },
      birthDay: 0,
      uses: 0,
      lastUsedDay: 0,
      reinforcedDays: 0,
      consolidated: false,
      promotedIdentity: false,
      protected: false,
      pressure: 0,
      lastChallengedDay: null,
    },
    strength: 0,
    sal: spec.sal,
    cue: spec.cue,
    temporal: spec.temporal,
    semantic: spec.semantic,
    arrival: spec.arrival,
    hops: 0,
    activation,
    cueFraction: activation > 0 ? (spec.cue + spec.semantic) / activation : 0,
    matched: 1,
    trains: true,
    maxTier: spec.maxTier,
    confidential: false,
  };
}

/** Author one proposal through the REAL path: intake → the encode battery → mint. */
async function authored(
  buffer: SpanBuffer,
  raw: Record<string, unknown>,
  resolve?: (declared: string) => string | null,
  scope = "seams",
  /** How the matcher found it. `declared` = the author addressed the id;
   *  `content` = the engine matched a restatement. SEAMS N reads the claim's
   *  direction off exactly this. */
  method: "declared" | "content" = "declared",
): Promise<Proposal> {
  const result = await submitProposal(buffer, raw, {
    session: scope,
    scope,
    source: "session-end",
    gate: batteryGate(),
    ...(resolve === undefined
      ? {}
      : {
          resolveUpdates: (declared: string) => ({
            resolved: resolve(declared),
            method,
            reason:
              resolve(declared) === null
                ? ("BELOW_FLOOR" as const)
                : method === "declared"
                  ? ("DECLARED_RESOLVED" as const)
                  : ("MATCHED" as const),
            score: null,
            margin: null,
            declared,
            hintUsed: false,
            floor: 0.35,
            marginBar: 0.1,
          }),
        }),
  });
  if (!result.accepted || result.proposal === null) {
    throw new Error(`proposal refused: ${result.reason} / ${result.gate ?? ""}`);
  }
  return result.proposal;
}

// ═══════════════════════════════════════════════════════════════════════════
// I — the `updates:` minting seam (scar §2.6 shape; first priority)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS I — minting reaches doc.meta, so downstream rules stop being starved", () => {
  test("a resolved `updates:` declaration lands in doc.meta and sleep's dedup REFUSES the merge", async () => {
    const s = store();
    const buffer = new SpanBuffer({ dir });

    const shared = "The storage split keeps canonical prose in markdown files on disk.";
    const original = await authored(buffer, { content: shared, kind: "fact" });
    const originalId = mintProposal(s, original).id;

    // The revision says the SAME thing (an identical body is exactly the dedup
    // candidate the exclusion has to survive), is born LATER (so the dedup pass
    // deterministically picks the original as the original), and declares it.
    const buffer2 = new SpanBuffer({ dir, day: () => 2 });
    const revision = await authored(
      buffer2,
      { content: shared, kind: "fact", updates: originalId },
      () => originalId,
      "seams-later",
    );
    const revisionId = mintProposal(s, revision).id;

    // 1. The seam wrote the RESOLVED id into canonical prose.
    expect(s.read(revisionId).doc.meta[UPDATES_META_KEY]).toBe(originalId);
    // 2. The downstream reader — which never knew about `remember/` — sees it.
    expect(declaredUpdates(wrap(s), revisionId)).toBe(originalId);
    // 3. And the physics refusal actually fires on the composed pair.
    const dedup = runDedup(phaseCtx(wrap(s), 1));
    expect(dedup.merged).toEqual([]);
    expect(dedup.leftAlone["declared-revision-never-merged"]).toBe(1);
    expect(s.row(revisionId)?.archived).toBe(0);
  });

  test("an UNRESOLVED declaration writes no key — a dangling address is not a merge exclusion", async () => {
    const s = store();
    const buffer = new SpanBuffer({ dir });
    const shared = "The storage split keeps canonical prose in markdown files on disk.";

    const original = await authored(buffer, { content: shared, kind: "fact" });
    mintProposal(s, original);

    const buffer2 = new SpanBuffer({ dir, day: () => 2 });
    const dangling = await authored(
      buffer2,
      { content: shared, kind: "fact", updates: "mem_deadbeefdead" },
      () => null,
      "seams-later",
    );
    const danglingId = mintProposal(s, dangling).id;

    expect(s.read(danglingId).doc.meta[UPDATES_META_KEY]).toBeUndefined();
    expect(declaredUpdates(wrap(s), danglingId)).toBe(null);
    const dedup = runDedup(phaseCtx(wrap(s), 1));
    expect(dedup.merged.length).toBe(1);
  });

  test("the salience floor is clamped AT this seam and the lift is emitted (queued item 8)", async () => {
    const s = store();
    const buffer = new SpanBuffer({ dir });
    const events: string[] = [];
    const proposal = await authored(buffer, {
      content: "Mike decided the identity core's name is the owner's to supply, never a default.",
      kind: "fact",
      claimed: 0.9,
      salience: { relevance: 0.1, emotional: 0.1, predictive: 0.1 },
    });
    const result = mintProposal(s, proposal, { onEvent: (n) => events.push(n) });

    expect(result.lifted).toBe(true);
    expect(events).toContain("salience.lifted");
    // The dimensions are NEVER rewritten to satisfy the claim (types.ts, §5.1).
    expect(s.physicsOf(result.id).salience.claimed).toBe(0.9);
    expect(s.physicsOf(result.id).salience.relevance).toBe(0.1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A — the observer hoist: ONE predicate, and one cross-module totality test
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS A — the observer predicate is hoisted, and stand-down totality is cross-module", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));

  function tsFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) out.push(...tsFiles(full));
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  test("exactly ONE definition of the predicate exists, at the hoisted path, importing nothing (observer-mode G1/G2)", () => {
    const definers = tsFiles(SRC).filter((f) =>
      /export function isObserver\b/.test(readFileSync(f, "utf8")),
    );
    expect(definers.map((f) => f.slice(SRC.length))).toEqual(["core/observer.ts"]);

    // G2: structurally read-only — a dashboard or probe can report the same truth
    // without acquiring the ability to change anything.
    const src = readFileSync(join(SRC, "core/observer.ts"), "utf8");
    expect(/^\s*import\s/m.test(src)).toBe(false);

    // Every consumer reaches the hoisted file, and nobody reaches into store/'s
    // subdirectory for it any more (the old home is gone).
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (!/\bisObserver\b/.test(text) || file.endsWith("core/observer.ts")) continue;
      expect({ file: file.slice(SRC.length), ok: /from "\.{1,2}\/(\.\.\/)*observer\.js"/.test(text) }).toEqual({
        file: file.slice(SRC.length),
        ok: true,
      });
    }
    expect(existsSync(join(SRC, "core/store/observer.ts"))).toBe(false);
  });

  test("the store's public surface still carries the predicate (consumers change import paths only)", async () => {
    const storeModule = (await import("../src/core/store/index.js")) as unknown as {
      isObserver?: (s: unknown) => boolean;
    };
    const hoisted = (await import("../src/core/observer.js")).isObserver;
    expect(storeModule.isObserver).toBe(hoisted);
  });

  test("stand-down totality spans BOTH consumers: every site in WRITE_METHODS ∪ WRITE_SITES emits", async () => {
    // Half one: the store seam.
    const writer = store();
    const seedId = writer.put({ type: "memory", kind: "fact", body: "A seeded memory body." });
    writer.close();
    open.length = 0;

    const s = store({ observer: true });
    const args: Record<string, unknown[]> = {
      put: [{ type: "memory", kind: "fact", body: "x" }],
      putMany: [[{ type: "memory", kind: "fact", body: "x" }]],
      revise: [seedId, { body: "y" }],
      supersede: [seedId, { type: "memory", kind: "fact", body: "y" }],
      archive: [seedId, "reason"],
      updatePhysics: [seedId, { uses: 1 }],
      reinforce: [seedId, 1],
      setBand: [seedId, "semantic", 1],
      link: [{ src: seedId, dst: seedId, weight: 1, day: 0 }],
      linkMany: [[{ src: seedId, dst: seedId, weight: 1, day: 0 }]],
      setProspective: [
        { memoryId: seedId, windowKey: "w", eventDate: "2026-09", precision: "month", state: "armed" },
      ],
      advanceClock: ["2026-08-26"],
      setMeta: ["k", "v"],
      setGateRecords: [[{ sessionId: "s1", kind: "surfaced", ref: seedId, turn: 1, lastDay: 0 }]],
      pruneGateSessions: [],
      appendEvent: [{ name: "probe", day: 0 }],
      pruneEvents: [],
      setRanking: [[{ id: seedId, strength: 0.5, band: "episodic", day: 0 }]],
      pruneSupersededVersions: [],
      appendRemovalRecord: [{ memoryId: seedId, stage: "requested", actor: "owner" }],
      rebuildCache: [],
    };
    for (const method of WRITE_METHODS) {
      const fn = (s as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[
        method
      ];
      expect(typeof fn).toBe("function");
      try {
        (fn as (...a: unknown[]) => unknown).call(s, ...(args[method] as unknown[]));
        throw new Error(`${method} did not refuse`);
      } catch (err) {
        expect((err as { code?: string }).code).toBe("OBSERVER_REFUSED");
      }
    }
    const storeSites = new Set(s.events("store.observer.standdown").map((e) => String(e.data?.site)));

    // Half two: remember's write sites, from the SAME predicate.
    const o = new SpanBuffer({ dir, observer: true, minClaimBytes: 0, staleClaimMs: 0 });
    o.capture({ session: "s1", scope: "seams", turns: [{ role: "user", text: "x" }] });
    o.jot({ session: "s1", scope: "seams", text: "x" });
    o.boundary({ session: "s1", scope: "seams", kind: "stop" });
    o.claim("seams");
    o.claimCoverage({ scope: "seams", session: "s1", proposalId: "prp_x" });
    o.recordProposal("seams", {});
    const fake = { id: "clm_x", scope: "seams", path: join(dir, "nope"), spans: [], bytes: 0, mergedOrphans: [] };
    o.consume(fake);
    o.restore(fake);
    o.noteFailures("seams", [fakeSpan("seams")], "THREW");
    await sweep(o, { scope: "seams", interpret: async () => ({ proposals: [] }) });
    const rememberSites = new Set(
      o.events("remember.observer.standdown").map((e) => String(e.data?.site)),
    );

    // The totality, as ONE list: the hoist is what makes this a single test.
    const observed = [
      ...[...storeSites].map((x) => `store:${x}`),
      ...[...rememberSites].map((x) => `remember:${x}`),
    ].sort();
    const enumerated = [
      ...WRITE_METHODS.map((m) => `store:${m}`),
      ...WRITE_SITES.map((m) => `remember:${m}`),
    ].sort();
    expect(observed).toEqual(enumerated);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — the `gate_session` table (scar §2.1: two writers, one session)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS B — per-session gate state is a table, so two writers cannot drop each other", () => {
  test("the interleaved load→mutate→save race that the meta row lost now loses nothing", () => {
    const a = store();
    const b = Store.open({ dir });
    open.push(b);

    // Both writers read the same starting state — a turn's recall() in one
    // process and a late resolveUse() from the boundary in another.
    const first = loadGateState(a, "s1").state;
    const second = loadGateState(b, "s1").state;
    expect(first.turn).toBe(0);

    first.turn = 1;
    first.lastDay = 3;
    first.surfaced["mem_aaaaaaaaaaaa"] = { turn: 1, tier: "surfaced", trains: true };
    saveGateState(a, first, 200);

    // ... and only now does the second writer save ITS record, from the state it
    // read before the first one landed. Under the JSON meta row this save was the
    // one that dropped the other's records (scar §2.1).
    second.turn = 1;
    second.lastDay = 3;
    second.credited["mem_bbbbbbbbbbbb"] = { turn: 1, tier: "referenced" };
    saveGateState(b, second, 200);

    const reloaded = loadGateState(a, "s1");
    expect(reloaded.status).toBe("loaded");
    expect(Object.keys(reloaded.state.surfaced)).toEqual(["mem_aaaaaaaaaaaa"]);
    expect(Object.keys(reloaded.state.credited)).toEqual(["mem_bbbbbbbbbbbb"]);
    expect(reloaded.state.surfaced["mem_aaaaaaaaaaaa"]?.trains).toBe(true);
  });

  test("the keyspace has a real lifetime: pruneGateSessions sweeps on the active-day clock", () => {
    const s = store({ retentionDays: 2 });
    const stale = loadGateState(s, "old").state;
    stale.turn = 1;
    stale.lastDay = 0;
    stale.surfaced["mem_cccccccccccc"] = { turn: 1, tier: "footnoted", trains: false };
    saveGateState(s, stale, 200);

    for (const d of ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]) s.advanceClock(d);
    const report = s.pruneGateSessions();
    expect(report.pruned).toBeGreaterThan(0);
    expect(s.gateRecords("old")).toEqual([]);
    expect(loadGateState(s, "old").status).toBe("absent");
  });

  test("an unreadable scalar row resets, and says so — never a silent fresh start", () => {
    const s = store();
    s.setGateRecords([
      { sessionId: "bad", kind: "scalar", ref: SCALAR_REF, turn: 4, lastDay: 1, value: "{{{" },
    ]);
    expect(loadGateState(s, "bad").status).toBe("unreadable");
    expect(loadGateState(s, "bad").state.turn).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// K — the durable events table (schemas' story survives a restart; sleep's
//     records become queryable without losing replay idempotence)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS K — the box-2 events table replaces the in-memory rings that mattered", () => {
  function challenger(s: Store, day: number, body: string): string {
    return s.put({
      type: "memory",
      kind: "person",
      body,
      salience: { novelty: null, relevance: 0.45, emotional: 0.45, predictive: 0.45 },
      physics: { birthDay: day, lastUsedDay: day },
    });
  }

  test("a revision story survives a RESTART: the increments are durable, not ringed", () => {
    const s = store();
    const schemas = Schemas.open({ store: s });
    const entityId = schemas.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = schemas.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    const out = schemas.challengeBelief({
      updates: beliefId,
      challengerId: challenger(s, 1, "Ada asked for a live walkthrough instead"),
      day: 1,
    });
    expect(out.credited).toBe(true);
    expect(schemas.story(beliefId).increments.length).toBe(1);
    s.close();
    open.length = 0;

    // A fresh process, a fresh index, a fresh ring — and the story is still there.
    const reopened = store();
    const after = Schemas.open({ store: reopened }).story(beliefId);
    expect(after.increments.length).toBe(1);
    expect(after.increments[0]?.challengerId.length).toBeGreaterThan(0);
    expect(after.pressure).toBeGreaterThan(0);
  });

  test("the dedup latch makes an append-only log idempotent under replay (sleep §5 G3)", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "A memory that will be pruned." });
    const first = s.appendEvent({
      name: "memory.pruned",
      day: 4,
      ref: id,
      dedupKey: `sleep.pruned.${id}`,
      payload: { uses: 0 },
    });
    const replayed = s.appendEvent({
      name: "memory.pruned",
      day: 4,
      ref: id,
      dedupKey: `sleep.pruned.${id}`,
      payload: { uses: 0 },
    });
    expect(first).toBeGreaterThan(0);
    expect(replayed).toBe(0);
    expect(s.eventLog({ name: "memory.pruned" }).length).toBe(1);

    // Telemetry without a latch still accumulates — the two are different records.
    s.appendEvent({ name: "sleep.merged", day: 4, ref: id });
    s.appendEvent({ name: "sleep.merged", day: 4, ref: id });
    expect(s.eventLog({ name: "sleep.merged" }).length).toBe(2);
  });

  test("sleep's prune record reaches the durable log beside its meta row, and a replay adds nothing", () => {
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory nobody has used in a hundred lived days.",
      physics: { birthDay: -120, lastUsedDay: -100, uses: 0 },
    });
    const first = runPrune(phaseCtx(wrap(s), 1));
    expect(first.changed).toBe(1);
    expect(s.eventLog({ name: "memory.pruned" }).length).toBe(1);
    expect(s.eventLog({ name: "memory.pruned" })[0]?.ref).toBe(id);

    // The record is keyed by id, so a replayed day is a no-op on BOTH surfaces.
    runPrune(phaseCtx(wrap(s), 1));
    expect(s.eventLog({ name: "memory.pruned" }).length).toBe(1);
  });

  test("the log has bounded retention, and a latched record is never swept", () => {
    const s = store({ retentionDays: 2 });
    s.appendEvent({ name: "telemetry", day: 0 });
    s.appendEvent({ name: "memory.pruned", day: 0, dedupKey: "sleep.pruned.mem_x" });
    for (const d of ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]) s.advanceClock(d);
    const report = s.pruneEvents();
    expect(report.pruned).toBe(1);
    expect(s.eventLog({ name: "telemetry" })).toEqual([]);
    expect(s.eventLog({ name: "memory.pruned" }).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J — the box-3 ranking table (one owner, one rebuild story)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS J — the decay tick materializes ranking through the STORE, not a side file", () => {
  test("a real cycle writes box 3's ranking table and opens no second sqlite file", () => {
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory with enough substance to be worth ranking at all.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
    });

    runCycle({ store: s, date: "2026-01-02" });

    const row = s.ranking(id);
    expect(row).toBeDefined();
    expect(row?.strength).toBeGreaterThan(0);
    expect(row?.band).toBe(s.row(id)?.band ?? "episodic");
    // The workaround's side file is never created: box 3 has ONE owner again.
    expect(existsSync(strengthCachePath(dir))).toBe(false);
  });

  test("the ranking table is a CACHE: rebuildCache drops it, and the next tick restores it", () => {
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory with enough substance to be worth ranking at all.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
    });
    runCycle({ store: s, date: "2026-01-02" });
    expect(s.ranking(id)).toBeDefined();

    s.rebuildCache();
    expect(s.ranking(id)).toBeUndefined();
    // Nothing canonical was lost — strength is a pure function, so the next tick
    // re-materializes the same number from the same state.
    runCycle({ store: s, date: "2026-01-03" });
    expect(s.ranking(id)).toBeDefined();
  });

  test("an observer cycle materializes nothing at all (the instrument writes no cache)", () => {
    const writer = store();
    writer.put({ type: "memory", kind: "fact", body: "A memory that exists before the probe." });
    writer.close();
    open.length = 0;

    const obs = store({ observer: true });
    const report = runCycle({ store: obs, date: "2026-01-02" });
    expect(report.observer).toBe(true);
    expect(obs.rankingAll().size).toBe(0);
    expect(existsSync(strengthCachePath(dir))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — the alias map stops being borrowed (recall gap §2 / schemas gap §3)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS C — recall's alias map comes from schemas, and the safety half is reachable", () => {
  const FILLER = [
    "The garage door opener needs a new battery soon.",
    "Rebasing keeps the history readable for reviewers.",
    "The library closes early on Sundays now.",
    "The kitchen tap drips when the pressure is high.",
    "The bus route changed and adds ten minutes.",
    "Planted three tomato seedlings in the planter.",
  ];

  /**
   * A genuinely ambiguous handle. `schemas/` refuses to MINT one through a single
   * instance (`alias-resolves-elsewhere`), so the honest fixture is the one its
   * own INTERFACE-GAPS.md §2 declares: two instances over one store do not see
   * each other's writes, so two concurrent births can each claim the handle, and
   * the next open reads both. That is exactly the case recall's §9 G5 exists for.
   */
  function ambiguous(): { s: Store; schemas: Schemas; ids: string[] } {
    const s = store();
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const first = Schemas.open({ store: s });
    const second = Schemas.open({ store: s });
    const one = first.mention({
      name: "Robin Fielding",
      kind: "person",
      source: "Robin Fielding runs the Tuesday climbing session",
      chunkRef: "c1",
      day: 0,
      aliases: ["Robin"],
    }).id as string;
    const two = second.mention({
      name: "Robin Chen",
      kind: "person",
      source: "Robin Chen handles the quarterly invoices",
      chunkRef: "c2",
      day: 0,
      aliases: ["Robin"],
    }).id as string;
    // One handle, two live people: "a name pointing at two people retrieves
    // neither well and must not teach the graph either" (recall §9 G5).
    return { s, schemas: Schemas.open({ store: s }), ids: [one, two] };
  }

  test("schemas.aliasMap() reports the ambiguity that recall's gate needs", () => {
    const { schemas, ids } = ambiguous();
    expect([...(schemas.aliasMap().get("robin") ?? [])].sort()).toEqual([...ids].sort());
    expect(schemas.aliasIndex().ambiguous()).toContain("robin");
  });

  test("composed, an ambiguous handle sets trains:false and resolveUse REFUSES the credit", () => {
    const { s, schemas } = ambiguous();
    const r = new Recall({ store: s, owner: true });

    const out = recallTurn(r, { sessionId: "s1", text: "robin robin robin" }, { schemas });
    const surfacedIds = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(surfacedIds.length).toBeGreaterThan(0);
    expect(out.decision.ambiguousCueCount).toBe(1);
    expect(out.decision.verdicts.find((v) => v.id === surfacedIds[0])?.trains).toBe(false);

    s.advanceClock("2026-08-26");
    const credit = r.resolveUse("s1", surfacedIds[0] ?? "", "referenced");
    expect(credit.credited).toBe(false);
    expect(credit.reason).toBe("ambiguous-handle-trains-nothing");
    // The store seam was never reached: no consumer, no training.
    expect(s.events("store.reinforce").length).toBe(0);
  });

  test("WITHOUT the wiring the same turn trains — which is the gap this seam closes", () => {
    const { s } = ambiguous();
    const r = new Recall({ store: s, owner: true });
    // A caller that forgets the map (the borrowed-map failure mode, scar §2.6).
    const out = r.recall({ sessionId: "s2", text: "robin robin robin" });
    const surfacedIds = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(out.decision.ambiguousCueCount).toBe(0);
    expect(out.decision.verdicts.find((v) => v.id === surfacedIds[0])?.trains).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D — temporal cues into recall (and the "arrival" name collision)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS D — a temporal window is one more CUE, capped at the footnote tier", () => {
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

  /** Shares no indexable token with anything in the store: the ONLY cue is the
   *  calendar, which is what "cue-only-temporal" has to mean for the proof. */
  const TURN_TEXT = "zygomorphic vellichor quixotry";

  function dated(): { s: Store; prospective: Prospective; id: string } {
    const s = store();
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const id = s.put({
      type: "memory",
      // A kind whose loud-tier floor a temporal cue CAN clear, so the ceiling is
      // the only thing standing between this candidate and the loud tier.
      kind: "person",
      body: "The Portland move lands on the fourth and the truck is booked.",
      learnedOn: "2026-08-25",
      meta: { eventDate: "2026-09-04" },
      salience: { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 },
    });
    return { s, prospective: new Prospective({ store: s }), id };
  }

  test("the cue reaches recall through the CUE channel and is counted as cue by cueFraction", () => {
    const { s, prospective, id } = dated();
    const r = new Recall({ store: s, owner: true });

    // Turn text that touches NOTHING: the only cue is the calendar.
    const out = recallTurn(
      r,
      { sessionId: "s1", text: TURN_TEXT },
      { prospective, at: "2026-09-04" },
    );

    const v = out.decision.verdicts.find((x) => x.id === id);
    expect(v).toBeDefined();
    expect(v?.temporal).toBeGreaterThan(0);
    expect(v?.cue).toBe(v?.temporal as number);
    // Counted as CUE, not as arrival — or hard gate (c) silently changes meaning.
    expect(v?.cueFraction).toBeGreaterThan(0);
    expect(v?.cueFraction).toBe((v?.cue as number) / (v?.activation as number));
  });

  test("there is NO second injection path: recall's `arrival` is still pure recency", () => {
    const { s, prospective, id } = dated();
    const r = new Recall({ store: s, owner: true });
    const out = recallTurn(
      r,
      { sessionId: "s1", text: TURN_TEXT },
      { prospective, at: "2026-09-04" },
    );
    const v = out.decision.verdicts.find((x) => x.id === id);
    // `arrival` = ARRIVAL_WEIGHT x strength, untouched by the temporal weight.
    expect(v?.arrival).toBeCloseTo(RECALL_TUNABLES.ARRIVAL_WEIGHT * (v?.strength as number), 10);
    // And the source says so: the temporal fold never mentions ARRIVAL_WEIGHT.
    const src = readFileSync(
      fileURLToPath(new URL("../src/core/recall/activate.ts", import.meta.url)),
      "utf8",
    );
    const fold = src.slice(src.indexOf("const temporalScore"), src.indexOf("// ── the embedding"));
    expect(fold.includes("ARRIVAL_WEIGHT")).toBe(false);
  });

  test("a cue-only-temporal candidate is FOOTNOTED, and the record names the ceiling", () => {
    const { s, prospective, id } = dated();
    const r = new Recall({ store: s, owner: true });
    const out = recallTurn(
      r,
      { sessionId: "s1", text: TURN_TEXT },
      { prospective, at: "2026-09-04" },
    );
    expect(out.decision.footnotes).toContain(id);
    expect(out.decision.surfaced).not.toContain(id);
    const v = out.decision.verdicts.find((x) => x.id === id);
    expect(v?.verdict).toBe("footnoted");
    expect(v?.loudBlockedBy).toBe("cue-only-temporal");
  });

  test("the CEILING is what stops it: the identical candidate goes loud without the cap", () => {
    // Same numbers, twice, through the gate itself — so the proof is the ceiling
    // and not some other rule that would have blocked the loud tier anyway.
    const base = {
      cue: 0.7,
      temporal: 0.7,
      semantic: 0,
      arrival: 0.05,
      sal: 0.5,
      kind: "person" as const,
    };
    const capped = gate(
      {
        candidates: [unitCandidate({ ...base, id: "mem_capped", maxTier: "footnoted" })],
        state: freshGateState("u"),
        storeSize: 100,
        owner: true,
        affectStated: false,
        turn: 1,
      },
      RECALL_TUNABLES,
    );
    const uncapped = gate(
      {
        candidates: [unitCandidate({ ...base, id: "mem_uncapped", maxTier: "surfaced" })],
        state: freshGateState("u"),
        storeSize: 100,
        owner: true,
        affectStated: false,
        turn: 1,
      },
      RECALL_TUNABLES,
    );
    expect(uncapped.surfaced.map((c) => c.id)).toEqual(["mem_uncapped"]);
    expect(capped.surfaced).toEqual([]);
    expect(capped.footnotes.map((c) => c.id)).toEqual(["mem_capped"]);
    expect(capped.verdicts.find((v) => v.id === "mem_capped")?.loudBlockedBy).toBe(
      "cue-only-temporal",
    );
  });

  test("a temporal cue TRAINS — it is id-addressed, so nothing about it is ambiguous", () => {
    const { s, prospective, id } = dated();
    const r = new Recall({ store: s, owner: true });
    const out = recallTurn(
      r,
      { sessionId: "s1", text: TURN_TEXT },
      { prospective, at: "2026-09-04" },
    );
    expect(out.decision.verdicts.find((x) => x.id === id)?.trains).toBe(true);
    s.advanceClock("2026-09-04");
    const credit = r.resolveUse("s1", id, "referenced");
    expect(credit.reason).not.toBe("ambiguous-handle-trains-nothing");
    expect(credit.credited).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E — retargetOnSupersede gets its caller (scar §2.2, live until wired)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS E — a supersede retargets the edges, so the successor is not born cold", () => {
  function fixture(retarget?: (o: string, n: string, d: number) => void): {
    s: Store;
    schemas: Schemas;
    beliefId: string;
    neighbour: string;
  } {
    const s = store();
    const schemas = Schemas.open({
      store: s,
      ...(retarget === undefined ? {} : { retarget }),
    });
    const entityId = schemas.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = schemas.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const neighbour = s.put({
      type: "memory",
      kind: "fact",
      body: "The review rota is posted on Mondays in the team channel.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    return { s, schemas, beliefId, neighbour };
  }

  function warm(a: Associate, beliefId: string, neighbour: string): void {
    for (let i = 0; i < 4; i++) {
      a.coactivate([
        { id: beliefId, tier: "referenced" },
        { id: neighbour, tier: "referenced" },
      ]);
      a.flush();
    }
  }

  function revise(s: Store, schemas: Schemas, beliefId: string): string {
    let successorId: string | null = null;
    for (const day of [1, 2, 3]) {
      const cid = s.put({
        type: "memory",
        kind: "person",
        body: "Ada asked for a live walkthrough instead",
        salience: { novelty: null, relevance: 0.45, emotional: 0.45, predictive: 0.45 },
        physics: { birthDay: day, lastUsedDay: day },
      });
      successorId = schemas.challengeBelief({ updates: beliefId, challengerId: cid, day }).successorId;
      if (successorId !== null) break;
    }
    return successorId as string;
  }

  test("wired, the successor inherits the old head's live edges IN THE SAME FLOW", () => {
    const inner = fixtureWithAssociate();
    const successorId = revise(inner.s, inner.schemas, inner.beliefId);
    expect(successorId).not.toBe(null);
    // The scar: "v1's gist.merge set merged_into and nothing re-pointed the
    // edges, so successors started cold."
    expect(inner.associate.linked(successorId, inner.neighbour)).toBe(true);
    expect(inner.associate.linked(inner.neighbour, successorId)).toBe(true);
    // And the old rows stay put — nothing is destroyed, they just stop mattering.
    expect(inner.associate.weightAt(inner.beliefId, inner.neighbour)).toBeGreaterThan(0);
  });

  function fixtureWithAssociate(): {
    s: Store;
    schemas: Schemas;
    beliefId: string;
    neighbour: string;
    associate: Associate;
  } {
    const s = store();
    let associate: Associate | null = null;
    const schemas = Schemas.open({
      store: s,
      // The one line the gap file asks for, at the layer that composes them.
      retarget: (oldId, newId, day) => {
        associate?.retargetOnSupersede(oldId, newId, day);
      },
    });
    associate = new Associate({ store: s });
    const entityId = schemas.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = schemas.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const neighbour = s.put({
      type: "memory",
      kind: "fact",
      body: "The review rota is posted on Mondays in the team channel.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    warm(associate, beliefId, neighbour);
    return { s, schemas, beliefId, neighbour, associate };
  }

  test("UNWIRED, the same revision leaves the successor cold — the scar, live", () => {
    const { s, schemas, beliefId, neighbour } = fixture();
    const associate = new Associate({ store: s });
    warm(associate, beliefId, neighbour);
    const successorId = revise(s, schemas, beliefId);
    expect(successorId).not.toBe(null);
    expect(associate.linked(successorId, neighbour)).toBe(false);
  });

  test("a retarget that THROWS does not undo a revision that already landed", () => {
    const { s, schemas, beliefId } = fixture(() => {
      throw new Error("edge store unavailable");
    });
    const successorId = revise(s, schemas, beliefId);
    expect(successorId).not.toBe(null);
    expect(s.row(beliefId)?.superseded_by).toBe(successorId);
    expect(
      schemas.events("schema.edges.retarget.failed").length,
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F — the schemas↔self seam: the identity core, and the RIGHT refusal
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS F — the identity core self mints is the row schemas indexes", () => {
  test("status-on-identity refuses with its OWN reason, never `entity-unknown`", () => {
    const s = store();
    // Minted BEFORE the index is built: schemas scans once at open (its gap §2),
    // so the order is part of the wiring, not an accident of this test.
    const core = new Self({ store: s }).ensureIdentityCore({
      name: "Mike",
      aliases: ["mike"],
    });
    expect(core.reason).toBe("created");
    const schemas = Schemas.open({ store: s });

    const placement = schemas.addCurrentState({
      entityId: core.id as string,
      statement: "currently rebuilding the memory layer",
      day: 1,
    });
    expect(placement.ok).toBe(false);
    // The ~72 KB lesson: a status belongs on a person, a place, a project — never
    // on the self. `entity-unknown` would be a refusal under the wrong name, and
    // a silent weakening of the guarantee that matters most here.
    expect(placement.reason).toBe("status-on-identity-refused");
    expect(placement.reason).not.toBe("entity-unknown");
    expect(placement.belongsOn).not.toBe(null);
  });

  test("schemas actually INDEXES the core — the refusal is not an accident of a missing row", () => {
    const s = store();
    const core = new Self({ store: s }).ensureIdentityCore({ name: "Mike", aliases: ["mike"] });
    const schemas = Schemas.open({ store: s });

    // `meta.role: "entity"` is the whole obligation self adopted (schemas gap §5):
    // without it the row is not indexed and the refusal degrades to the wrong one.
    const entity = schemas.entities().find((e) => e.id === core.id);
    expect(entity?.kind).toBe("self");
    expect(entity?.name).toBe("Mike");
    // The name and its aliases resolve, which is what makes the second layer
    // ("a name resolving to the identity core is not a birth site") reachable.
    expect(schemas.aliasMap().get("mike")).toContain(core.id as string);
  });

  test("a name that resolves to the identity core is not a birth site", () => {
    const s = store();
    new Self({ store: s }).ensureIdentityCore({ name: "Mike", aliases: ["mike"] });
    const schemas = Schemas.open({ store: s });
    const out = schemas.mention({
      name: "Mike",
      kind: "person",
      source: "Mike decided the storage split",
      chunkRef: "c1",
      day: 0,
    });
    // Refused, and by NAME: the self is one place and it is never minted twice.
    expect(out.ok).toBe(false);
    expect(out.id).toBe(null);
    expect(out.reason).toBe("second-self-refused");
  });

  test("the core is idempotent — a second core is a category error", () => {
    const s = store();
    const self = new Self({ store: s });
    const first = self.ensureIdentityCore({ name: "Mike", aliases: [] });
    const second = self.ensureIdentityCore({ name: "Mike", aliases: [] });
    expect(second.id).toBe(first.id);
    expect(second.reason).toBe("exists");
    expect(s.list({ type: "schema", kind: "self" }).length).toBe(1);
  });

  test("a blank name mints NOTHING — the core's name is the owner's, and there is no default", () => {
    const empty = new Self({ store: store() }).ensureIdentityCore({ name: "   ", aliases: [] });
    expect(empty.id).toBe(null);
    expect(empty.reason).toBe("no-name");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G — sleep's re-render IS self's boundary, with the host's ceiling
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS G — the cycle's last content write is self.boundary(), budget and all", () => {
  function seeded(): Store {
    const s = store();
    for (let i = 0; i < 6; i++) {
      s.put({
        type: "memory",
        kind: "fact",
        body: `A memory the briefing might carry, number ${i}, with its own words.`,
        salience: { novelty: null, relevance: 0.7, emotional: 0.5, predictive: 0.6 },
        physics: { birthDay: 0, lastUsedDay: 0, uses: 3 },
      });
    }
    return s;
  }

  test("the wired cycle publishes a briefing the wake can read back", () => {
    const s = seeded();
    const self = new Self({ store: s });
    const report = runCycle({
      store: s,
      date: "2026-01-02",
      budgetBytes: 9000,
      render: selfRenderer(self),
    });

    expect(phaseReport(report, "briefing").status).toBe("ran");
    expect(s.getMeta(BRIEFING_KEY)).toBeDefined();
    expect(self.wake().ok).toBe(true);
  });

  test("the ceiling reaches the renderer: a smaller budget publishes a smaller briefing", () => {
    const s = seeded();
    const self = new Self({ store: s });

    runCycle({ store: s, date: "2026-01-02", budgetBytes: 9000, render: selfRenderer(self) });
    const roomy = (s.getMeta(BRIEFING_KEY) ?? "").length;

    // The same store, the same content, one lived day later — only the HOST's
    // reported ceiling changed, and the published bundle follows it.
    runCycle({ store: s, date: "2026-01-03", budgetBytes: 400, render: selfRenderer(self) });
    const cramped = (s.getMeta(BRIEFING_KEY) ?? "").length;

    expect(roomy).toBeGreaterThan(0);
    expect(cramped).toBeLessThan(roomy);
  });

  test("NO reported ceiling means NO render — an invented one is scar §2.18", () => {
    const s = seeded();
    const events: string[] = [];
    const report = runCycle({
      store: s,
      date: "2026-01-02",
      // budgetBytes deliberately absent: the host reported no ceiling.
      render: selfRenderer(new Self({ store: s }), { onEvent: (n) => events.push(n) }),
    });
    expect(events).toContain("briefing.no-budget");
    expect(s.getMeta(BRIEFING_KEY)).toBeUndefined();
    // The phase still RAN — "ran and found nothing" is not "did not run" (§5 G6).
    expect(phaseReport(report, "briefing").status).toBe("ran");
  });

  test("the horizon lane's source is prospective, and an observer renders nothing", () => {
    const s = seeded();
    const prospective = new Prospective({ store: s });
    const renderer = selfRenderer(new Self({ store: s }), { prospective, at: "2026-09-04" });
    runCycle({ store: s, date: "2026-01-02", budgetBytes: 9000, render: renderer });
    expect(s.getMeta(BRIEFING_KEY)).toBeDefined();
    s.close();
    open.length = 0;

    const obs = store({ observer: true });
    const report = runCycle({
      store: obs,
      date: "2026-01-03",
      budgetBytes: 9000,
      render: () => {
        throw new Error("an observer must never invoke the renderer");
      },
    });
    expect(report.observer).toBe(true);
    expect(phaseReport(report, "briefing").status).not.toBe("failed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H — the episode gate at the composition root (scar §2.7)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS H — episodes route through the REAL battery, so the refusing default is unreachable", () => {
  function written(self: Self, text: string): void {
    self.openChapter("s1", { turns: 12, bytes: 9_000 });
    self.appendChapter("s1", text);
  }

  test("UNWIRED, self's default refuses everything — an absent gate is not an open one", () => {
    const s = store();
    // Chapters are themselves gated now — author through the real battery, then
    // ingest through an UNGATED instance to prove the default refuses.
    const author = new Self({ store: s, gate: episodeGate() });
    written(author, "We shipped the seam pass and it held together all day.");
    const self = new Self({ store: s });
    const out = self.ingestEpisode({ sessionId: "s1" });
    expect(out.ingested).toBe(false);
    expect(out.reason).toBe("gate-refused");
    expect(out.gate?.reason).toBe("NO_GATE_INJECTED");
  });

  test("wired, an ordinary episode ingests through the battery", () => {
    const s = store();
    const self = new Self({ store: s, gate: episodeGate() });
    written(self, "We shipped the seam pass and it held together all day.");
    const out = self.ingestEpisode({ sessionId: "s1" });
    expect(out.ingested).toBe(true);
    expect(out.memoryId).not.toBe(null);
    // The telemetry distinguishes "the real gate refused" from "nobody wired one".
    expect(self.events().filter((e) => e.name === "self.episode.ingest.refused")).toEqual([]);
  });

  test("a credential in an episode body is REDACTED, and the redacted text is what lands", () => {
    const s = store();
    const self = new Self({ store: s, gate: episodeGate() });
    written(
      self,
      "I finally rotated the deploy key AKIAIOSFODNN7EXAMPLE and the relief was real.",
    );
    const out = self.ingestEpisode({ sessionId: "s1" });
    expect(out.ingested).toBe(true);
    const body = s.readProse(out.memoryId as string).body;
    // Never durably encoded — not even in a first-person reflection (§13 G8).
    expect(body.includes("AKIAIOSFODNN7EXAMPLE")).toBe(false);
    expect(body.includes("relief")).toBe(true);
  });

  test("a credential in a HANDLE refuses the whole ingestion (the ops rule)", () => {
    const s = store();
    const self = new Self({ store: s, gate: episodeGate() });
    written(self, "A long enough reflection about the day and what it taught me.");
    const out = self.ingestEpisode({
      sessionId: "s1",
      handles: ["AKIAIOSFODNN7EXAMPLE"],
    });
    expect(out.ingested).toBe(false);
    expect(out.reason).toBe("gate-refused");
    // A named refusal from the REAL battery, not the placeholder.
    expect(out.gate?.reason).not.toBe("NO_GATE_INJECTED");
    expect((out.gate?.reason ?? "").length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L — spread() into recall: MODULATE ONLY (SEAMS L's conservative default)
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS L — hops raise a candidate the conversation reached, and mint nothing", () => {
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
    "Replaced the smoke alarm batteries in the hall.",
    "Booked the dentist for a routine cleaning.",
    "The sourdough starter needs feeding twice a week.",
  ];

  function linked(): { s: Store; associate: Associate; cued: string; dark: string } {
    const s = store();
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const cued = s.put({
      type: "memory",
      kind: "fact",
      body: "The sourdough starter died after two weeks of neglect.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const dark = s.put({
      type: "memory",
      kind: "fact",
      body: "Vellichor quixotry zygomorphic — nothing in any turn will ever cue this.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const associate = new Associate({ store: s });
    for (let i = 0; i < 4; i++) {
      associate.coactivate([
        { id: cued, tier: "referenced" },
        { id: dark, tier: "referenced" },
      ]);
      associate.flush();
    }
    return { s, associate, cued, dark };
  }

  test("a hop NEVER mints a candidate — an uncued memory stays dark (hard gate (a))", () => {
    const { s, associate, cued, dark } = linked();
    expect(associate.linked(cued, dark)).toBe(true);

    const r = new Recall({ store: s, owner: true });
    const out = recallTurn(r, { sessionId: "s1", text: "my sourdough starter died" }, { associate });

    expect(out.decision.verdicts.some((v) => v.id === cued)).toBe(true);
    // The hop reached it and it is still not a candidate at all: gate (a) stays
    // STRUCTURAL — the memory was never fetched, so no salience arithmetic ran.
    expect(out.decision.verdicts.some((v) => v.id === dark)).toBe(false);
    expect(out.decision.surfaced).not.toContain(dark);
    expect(out.decision.footnotes).not.toContain(dark);
  });

  test("a hop RAISES a candidate the OTHER channels reached (a semantic hit)", () => {
    // Two channels, deliberately: the seeds are the CUED candidates, and a seed
    // receives no contribution of its own, so what the graph can raise is a
    // candidate the conversation's own WORDS did not reach.
    const embed = (text: string): number[] =>
      text.toLowerCase().includes("vellichor") ? [1, 0] : [0, 1];
    const s = store({ embed });
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const cued = s.put({
      type: "memory",
      kind: "fact",
      body: "The sourdough starter died after two weeks of neglect.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const semantic = s.put({
      type: "memory",
      kind: "fact",
      body: "Vellichor marks the strange wistfulness of second-hand bookshops.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const associate = new Associate({ store: s });
    for (let i = 0; i < 4; i++) {
      associate.coactivate([
        { id: cued, tier: "referenced" },
        { id: semantic, tier: "referenced" },
      ]);
      associate.flush();
    }

    const turn = { sessionId: "a", text: "my sourdough starter died", vector: [1, 0] };
    const withHops = new Recall({ store: s, owner: true }).recall(
      composeTurn(turn, { associate }),
    );
    const without = new Recall({ store: s, owner: true }).recall({ ...turn, sessionId: "b" });

    const a = withHops.decision.verdicts.find((v) => v.id === semantic);
    const b = without.decision.verdicts.find((v) => v.id === semantic);
    expect(b?.hops).toBe(0);
    expect(a?.hops).toBeGreaterThan(0);
    expect(a?.activation).toBeGreaterThan(b?.activation as number);
    // And the cue fraction went DOWN, never up: the graph cannot buy loudness.
    expect(a?.cueFraction).toBeLessThan(b?.cueFraction as number);
  });

  test("hops are excluded from cueFraction's NUMERATOR, so they push AWAY from loud", () => {
    // Unit-level, where the arithmetic is visible: identical cue and semantic,
    // one with hop weight. The hop can only lower the cue fraction.
    const withoutHops = unitCandidate({
      id: "mem_plain",
      cue: 0.7,
      temporal: 0,
      semantic: 0,
      arrival: 0.05,
      sal: 0.5,
      maxTier: "surfaced",
    });
    const g = gate(
      {
        candidates: [withoutHops],
        state: freshGateState("u"),
        storeSize: 100,
        owner: true,
        affectStated: false,
        turn: 1,
      },
      RECALL_TUNABLES,
    );
    const v = g.verdicts.find((x) => x.id === "mem_plain");
    expect(v?.cueFraction).toBeCloseTo(0.7 / 0.75, 10);
    // Adding hop weight raises `activation` and lowers `cueFraction` — hard gate
    // (c) therefore gets STRICTER, never looser, when the graph contributes.
    const hopped = { ...withoutHops, hops: 0.6, activation: 1.35, cueFraction: 0.7 / 1.35 };
    expect(hopped.cueFraction).toBeLessThan(v?.cueFraction as number);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M — physics.consolidationEligibility(): sleep executes, physics decides
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS M — the consolidation criterion lives in physics, where the arithmetic is", () => {
  function phys(over: Partial<MemoryPhysics> = {}): MemoryPhysics {
    return {
      kind: "fact",
      salience: { novelty: null, relevance: 0.9, emotional: 0.9, predictive: 0.9, claimed: null },
      birthDay: 0,
      uses: 0,
      lastUsedDay: 0,
      reinforcedDays: 0,
      consolidated: false,
      promotedIdentity: false,
      protected: false,
      pressure: 0,
      lastChallengedDay: null,
      ...over,
    };
  }

  test("it mirrors promotionEligibility: eligible, first reason, and EVERY blocking reason", () => {
    const ok = consolidationEligibility(phys(), 1);
    expect(ok.eligible).toBe(true);
    expect(ok.reason).toBe("eligible");
    expect(ok.blockedBy).toEqual([]);

    // Two blockers at once: all of them are named, not just the first (scar §2.4).
    const both = consolidationEligibility(phys({ consolidated: true }), 0);
    expect(both.eligible).toBe(false);
    expect(both.reason).toBe("already-consolidated");
    expect(both.blockedBy).toContain("born-today");
    expect(consolidationEligibility(phys(), 1, { archived: true }).reason).toBe("archived");
  });

  test("NOTHING consolidates on the day it was encoded, whatever it claims for itself", () => {
    expect(consolidationEligibility(phys({ birthDay: 4 }), 4).reason).toBe("born-today");
    expect(consolidationEligibility(phys({ birthDay: 4 }), 5).eligible).toBe(true);
  });

  test("a formative ONE-SHOT consolidates without repetition — there is no reinforcement gate", () => {
    const oneShot = phys({ uses: 0, reinforcedDays: 0 });
    expect(oneShot.uses).toBe(0);
    expect(consolidationEligibility(oneShot, 1).eligible).toBe(true);
  });

  test("a faded memory is below the semantic floor and does not consolidate", () => {
    const faded = phys({
      salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed: null },
      birthDay: -200,
      lastUsedDay: -200,
    });
    const v = consolidationEligibility(faded, 1);
    expect(v.eligible).toBe(false);
    expect(v.blockedBy).toContain("below-semantic-floor");
    expect(v.band).not.toBe("semantic");
  });

  test("sleep now EXECUTES that verdict — the phase's skip reasons are physics' reasons", () => {
    const s = store();
    const fresh = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory born today, which nothing consolidates.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.9, predictive: 0.9 },
      physics: { birthDay: 1, lastUsedDay: 1 },
    });
    const ripe = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory from yesterday, sitting well above the semantic floor.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.9, predictive: 0.9 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });

    const out = runConsolidate(phaseCtx(wrap(s), 1));
    expect(out.consolidated).toContain(ripe);
    expect(out.consolidated).not.toContain(fresh);
    expect(out.skipped["born-today"]).toBe(1);
    // The store agrees, and physics' own verdict agrees with the store.
    expect(s.physicsOf(ripe).consolidated).toBe(true);
    expect(consolidationEligibility(s.physicsOf(ripe), 1).reason).toBe("already-consolidated");
  });

  test("a source scan: sleep no longer states the criterion itself", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/core/sleep/consolidate.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code.includes("consolidationEligibility")).toBe(true);
    // The old inline test — band(p, day) !== "semantic" — is gone from the phase.
    expect(/band\(\s*p\s*,/.test(code)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// N — the freeze seam gets a caller: counted, not trained, end to end
// ═══════════════════════════════════════════════════════════════════════════
describe("SEAMS N — a self-claim repeat routes through the freeze at the minting seam", () => {
  /** A RESTATEMENT: nobody addressed an id, the engine matched the content. That
   *  is what a transcript sweep produces, and it is a confirmation. */
  async function restates(
    s: Store,
    targetId: string,
    channel: "authored" | "fallback",
    self: Self,
    scope = `claim-${channel}`,
  ): Promise<ReturnType<typeof mintProposal>> {
    const buffer = new SpanBuffer({ dir, day: () => 2 });
    const proposal = await authored(
      buffer,
      {
        content: "I hold the seam discipline steadily, and it showed again today.",
        kind: "self",
        updates: targetId,
      },
      () => targetId,
      scope,
      "content",
    );
    return mintProposal(s, proposal, { self, channel });
  }

  function selfElement(s: Store): string {
    return s.put({
      type: "memory",
      kind: "self",
      body: "I hold the seam discipline steadily.",
      salience: { novelty: null, relevance: 0.8, emotional: 0.6, predictive: 0.6 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
  }

  test("a FALLBACK confirmation against the self is COUNTED and NOT trained", async () => {
    const s = store();
    const self = new Self({ store: s });
    const target = selfElement(s);
    const before = s.physicsOf(target).uses;

    const result = await restates(s, target, "fallback", self);

    expect(result.claim?.frozen).toBe(true);
    expect(result.claim?.reason).toBe("frozen-self-claim-repeat");
    expect(result.claim?.reinforced).toBe(false);
    // Withheld movement: the element did not move one step.
    expect(s.physicsOf(target).uses).toBe(before);
    // Kept measurement: the occasion is on the record either way (§14.2 G4).
    const repeats = self.events().filter((e) => e.name === "self.claim.repeat");
    expect(repeats.length).toBe(1);
    expect(repeats[0]?.data?.frozen).toBe(true);
    expect(s.getMeta("self.claims.self.frozen")).toBe("1");
  });

  test("the SAME claim from the authored front door DOES train — the doctrine's own input", async () => {
    const s = store();
    const self = new Self({ store: s });
    const target = selfElement(s);
    const before = s.physicsOf(target).uses;
    s.advanceClock("2026-08-26");
    s.advanceClock("2026-08-27");

    const result = await restates(s, target, "authored", self);

    expect(result.claim?.frozen).toBe(false);
    expect(result.claim?.reason).toBe("live-lived-salience");
    expect(result.claim?.reinforced).toBe(true);
    expect(s.physicsOf(target).uses).toBeGreaterThan(before);
    expect(s.getMeta("self.claims.self.live")).toBe("1");
  });

  test("a DECLARED `updates:` is a softening — a refutation never credits the belief it refutes", async () => {
    const s = store();
    const self = new Self({ store: s });
    const target = selfElement(s);
    s.advanceClock("2026-08-26");
    s.advanceClock("2026-08-27");
    const before = s.physicsOf(target).uses;

    // The author ADDRESSED the element in order to revise it. Direction is read
    // off the matcher's own verdict (`method: "declared"`), not guessed.
    const buffer = new SpanBuffer({ dir, day: () => 2 });
    const proposal = await authored(
      buffer,
      {
        content: "The seam discipline slipped today and the shortcut cost an hour.",
        kind: "self",
        updates: target,
      },
      () => target,
      "claim-declared",
    );
    const result = mintProposal(s, proposal, { self, channel: "authored" });

    expect(result.claim?.reason).toBe("live-softening");
    // Scar §2.10's one-way ratchet, refused here exactly as `dedupVerdict`
    // refuses it for the merge case: the two rules must not disagree.
    expect(result.claim?.reinforced).toBe(false);
    expect(s.physicsOf(target).uses).toBe(before);
  });

  test("the DIRECTION is read off the matcher's verdict, never defaulted", () => {
    expect(directionOf("declared")).toBe("soften");
    expect(directionOf("content")).toBe("confirm");
    expect(directionOf("content+hint")).toBe("confirm");
    expect(directionOf(undefined)).toBe("soften");
  });

  test("the channel is ENGINE-SET: no author field can turn a sweep into authorship", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/core/mint.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // The source comes from the mint OPTIONS (the engine) — via the `channel`
    // const derived from them — never from the proposal, which is the
    // interpreter's output. Since the mint-source doctrine, the same const is
    // also what gets PERSISTED as the row's `source`, so this scan now guards
    // the stored provenance too.
    expect(/const channel = opts\.channel \?\? "authored"/.test(code)).toBe(true);
    expect(/source:\s*channel/.test(code)).toBe(true);
    expect(/source:\s*proposal\./.test(code)).toBe(false);
    expect(/channel:\s*proposal\./.test(code)).toBe(false);

    // The SAME guard for the schemas path (PR-2 review should-fix 3): the
    // element seam's channel flows only from the input's own `channel` field —
    // never from a statement, a claim, or any parsed author content — and the
    // PERSISTED source only from `spec.channel`, never a default: an unstated
    // channel must record nothing (the review's blocker was a `?? "authored"`
    // persistence default stamping migrated beliefs as authored-in-v2).
    const schemasSrc = readFileSync(
      fileURLToPath(new URL("../src/core/schemas/index.ts", import.meta.url)),
      "utf8",
    );
    const schemasCode = schemasSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(/channel:\s*input\.channel\b/.test(schemasCode)).toBe(true);
    expect(/source:\s*spec\.channel\b/.test(schemasCode)).toBe(true);
    expect(/source:\s*(?:channel\b|"authored")/.test(schemasCode)).toBe(false);
    expect(
      /channel:\s*(?:input|spec)\.(?:statement|claimedSalience|dimensions)/.test(schemasCode),
    ).toBe(false);
  });

  test("a claim against an ORDINARY memory is not self-narration and moves normally", async () => {
    const s = store();
    const self = new Self({ store: s });
    const target = s.put({
      type: "memory",
      kind: "fact",
      body: "The storage split keeps canonical prose in markdown files.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.2, predictive: 0.4 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    s.advanceClock("2026-08-26");
    s.advanceClock("2026-08-27");
    const before = s.physicsOf(target).uses;

    const result = await restates(s, target, "fallback", self);
    expect(result.claim?.frozen).toBe(false);
    expect(result.claim?.reason).toBe("live-other-kind");
    expect(s.physicsOf(target).uses).toBeGreaterThan(before);
  });

  test("no freeze seam wired means no claim is routed — and nothing is trained either", async () => {
    const s = store();
    const target = selfElement(s);
    const before = s.physicsOf(target).uses;
    const buffer = new SpanBuffer({ dir, day: () => 2 });
    const proposal = await authored(
      buffer,
      { content: "I hold the seam discipline steadily, and it showed again today.", kind: "self", updates: target },
      () => target,
      "claim-unwired",
    );
    const result = mintProposal(s, proposal);
    expect(result.claim).toBe(null);
    expect(s.physicsOf(target).uses).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The mint-source doctrine (owner ruling 2026-08-29) — source, provenance,
// and the reteller's cap, end to end through the REAL path.
// ═══════════════════════════════════════════════════════════════════════════
describe("MemorySource is TOTAL — every member has a live writer that lands it on a row", () => {
  test("all five members, each through its own writer, asserted on the written row", async () => {
    // The PR-2 review's argument for this test: of the doctrine's five source
    // values, two shipped without any row-level assertion behind them — one
    // ("accommodation") without any writer at all at first. A member added to
    // MEMORY_SOURCES without a writer, or a writer that stops stamping, fails
    // here. Every assertion below reads a WRITTEN ROW's source — never a
    // literal in source text (the vacuity the review caught twice).
    const s = store();
    const buffer = new SpanBuffer({ dir });
    const seen = new Map<string, string>();

    // authored + fallback: the mint seam's two channels.
    const pa = await authored(buffer, {
      content: "The storage split keeps canonical prose in markdown files on disk.",
      kind: "fact",
    });
    seen.set("authored", mintProposal(s, pa).id);
    const pf = await authored(buffer, {
      content: "A crashed session's fragment still taught one modest thing.",
      kind: "fact",
    });
    seen.set("fallback", mintProposal(s, pf, { channel: "fallback" }).id);

    // episode: the experiencer's journal, ingested through the real gate path.
    const self = new Self({ store: s, gate: (i) => ({ ok: true, text: i.text }) });
    self.openChapter("s-tot", { turns: 9, bytes: 6_000 });
    self.appendChapter("s-tot", "I learned that totality tests earn their keep the day they fail.");
    const ing = self.ingestEpisode({ sessionId: "s-tot" });
    expect(ing.ingested).toBe(true);
    seen.set("episode", ing.memoryId ?? "missing");

    // accommodation: a belief revised under real pressure (three lived days of
    // challenge on a slow kind), read off the successor row.
    const sch = Schemas.open({ store: s });
    const ent = sch.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review over meetings",
      chunkRef: "c-tot",
      day: 0,
    }).id as string;
    const belief = sch.addBelief({
      entityId: ent,
      statement: "Ada prefers async review over meetings",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    let successor: string | null = null;
    for (const day of [1, 2, 3]) {
      const cid = s.put({
        type: "memory",
        kind: "person",
        body: `On day ${day} Ada asked for a live walkthrough instead, again.`,
        salience: { novelty: null, relevance: 0.45, emotional: 0.45, predictive: 0.45 },
        physics: { birthDay: day, lastUsedDay: day },
      });
      const out = sch.challengeBelief({ updates: belief, challengerId: cid, day });
      if (out.successorId !== null) successor = out.successorId;
    }
    expect(successor).not.toBeNull();
    seen.set("accommodation", successor as string);

    // migrated: the seam-level half — the store persists the member. The REAL
    // writer (the migrate tool's writeDoc/writeElement) is asserted end-to-end
    // in test/schemas.test.ts ("the ONLY live belief-placement caller stamps
    // 'migrated'"), on a fixture that provably drives the element path.
    seen.set(
      "migrated",
      s.put({
        type: "memory",
        kind: "fact",
        body: "A v1 row that crossed the cutover with its lived salience intact.",
        source: "migrated",
      }),
    );

    for (const member of MEMORY_SOURCES) {
      const id = seen.get(member);
      expect({ member, hasWriter: typeof id === "string" }).toEqual({ member, hasWriter: true });
      expect({ member, source: s.row(id as string)?.source }).toEqual({ member, source: member });
    }
  });
});

describe("mint-source doctrine — who wrote it is recorded, and a reteller's claim is capped", () => {
  test("an AUTHORED deposit keeps the full claim floor and records its provenance", async () => {
    const s = store();
    const buffer = new SpanBuffer({ dir });
    const p = await authored(buffer, {
      content: "The storage split keeps canonical prose in markdown files on disk.",
      kind: "fact",
      claimed: 0.9,
    });
    const events: Record<string, unknown>[] = [];
    const minted = mintProposal(s, p, {
      onEvent: (name, data) => events.push({ name, ...data }),
    });
    const row = s.row(minted.id);
    expect({
      source: row?.source,
      session: row?.origin_session,
      scope: row?.origin_scope,
      ref: row?.origin_ref,
      claimed: row?.claimed,
    }).toEqual({ source: "authored", session: "seams", scope: "seams", ref: p.id, claimed: 0.9 });
    // The prose document is canonical and self-describing: the same facts live
    // in its meta, so provenance survives any cache rebuild.
    const doc = s.readProse(minted.id);
    expect(doc.meta["source"]).toBe("authored");
    expect((doc.meta["origin"] as { ref?: string }).ref).toBe(p.id);
    expect(doc.meta["claimedRaw"]).toBeUndefined();
    const lift = events.find((e) => e["name"] === "salience.lifted");
    expect({ capped: lift?.["capped"], ceiling: lift?.["ceiling"] }).toEqual({
      capped: false,
      ceiling: 1,
    });
  });

  test("a FALLBACK mint's claim is CUT to the ceiling — the raw testimony survives in meta and telemetry", async () => {
    const s = store();
    const buffer = new SpanBuffer({ dir });
    const p = await authored(buffer, {
      content: "A crashed session's summarizer thought this mattered enormously.",
      kind: "fact",
      claimed: 0.95,
    });
    const events: Record<string, unknown>[] = [];
    const minted = mintProposal(s, p, {
      channel: "fallback",
      onEvent: (name, data) => events.push({ name, ...data }),
    });
    const row = s.row(minted.id);
    expect({ source: row?.source, claimed: row?.claimed }).toEqual({
      source: "fallback",
      claimed: PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING,
    });
    const doc = s.readProse(minted.id);
    expect(doc.meta["claimedRaw"]).toBe(0.95);
    const lift = events.find((e) => e["name"] === "salience.lifted");
    expect({
      claimed: lift?.["claimed"],
      applied: lift?.["applied"],
      ceiling: lift?.["ceiling"],
      capped: lift?.["capped"],
    }).toEqual({
      claimed: 0.95,
      applied: PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING,
      ceiling: PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING,
      capped: true,
    });
  });

  test("a fallback claim UNDER the ceiling passes untouched — the cap is a ceiling, not a tax", async () => {
    const s = store();
    const buffer = new SpanBuffer({ dir });
    const p = await authored(buffer, {
      content: "A modest observation from a crashed session, modestly claimed.",
      kind: "fact",
      claimed: 0.5,
    });
    const minted = mintProposal(s, p, { channel: "fallback" });
    const row = s.row(minted.id);
    expect(row?.claimed).toBe(0.5);
    expect(s.readProse(minted.id).meta["claimedRaw"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O. THE REVISION SEAM HAS A CALLER — a declared `updates:` lands, by target
//
// The gap, measured 2026-09-04 on the live store: the surprise pipeline
// dissented and the dissent went nowhere. The sweep declared a revision against
// a shown card; `remember/` resolved it; `mint.ts` wrote `doc.meta["updates"]`
// and routed the claim through the freeze seam — and then nothing. Store-wide,
// for the store's whole life: zero rows with pressure, zero
// `last_challenged_day`, zero `superseded_by`, zero `versions` rows, zero
// `revision.pressure` events. `self/freeze.ts` called the revision path "the
// caller's next stop"; the caller did not exist. `src/core/revision.ts` is it,
// and every mint door calls it.
// ═══════════════════════════════════════════════════════════════════════════
describe("O. a declared updates: reaches the engine — by door, and by target kind", () => {
  const brains: Counterpart[] = [];

  afterEach(() => {
    for (const c of brains.splice(0)) {
      try {
        c.close();
      } catch {
        /* already closed */
      }
    }
  });

  function brain(opts: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
    const c = Counterpart.open({ dir, owner: true, ...opts });
    brains.push(c);
    return c;
  }

  /** Spans are identified by CONTENT hash, so a second day of the same words is
   *  a span the buffer has already consumed. The nonce is what makes a
   *  multi-day fixture a multi-day fixture. */
  function turns(nonce: string): { role: "user" | "assistant"; text: string }[] {
    return [
      {
        role: "user",
        text: `We went through the review habit on ${nonce} and it did not match what I had written down about how she likes to work.`,
      },
      {
        role: "assistant",
        text: `Noted — the standing note says async review, and ${nonce} was the opposite of that in every detail.`,
      },
      {
        role: "user",
        text: `Right. Write down what actually happened on ${nonce} rather than what the old note claims, because the old note is the thing being corrected.`,
      },
    ];
  }

  function interpreter(proposals: readonly unknown[]): InterpretFn {
    return async (_chunk: SweepChunk) => ({ proposals, stopReason: "end_turn" });
  }

  /** One boundary and one swept chunk, on the store's current lived day. */
  async function sweptChunk(c: Counterpart, proposals: readonly unknown[]): Promise<void> {
    const session = `s${c.store.livedDay()}`;
    c.captureSpans({ session, scope: "proj", turns: turns(session) });
    c.boundary({ session, scope: "proj", kind: "stop" });
    await c.sweepFallback({ interpret: interpreter(proposals) });
  }

  /** A person entity with one belief on it — `person` inertia is 0.8, so the
   *  slow-kind daily force cap makes "~3 lived days" a bound, not a hope. */
  function personBelief(c: Counterpart): { entityId: string; beliefId: string } {
    const entityId = c.schemas.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "seed",
      day: c.store.livedDay(),
    }).id as string;
    const beliefId = c.schemas.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: c.store.livedDay(),
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    return { entityId, beliefId };
  }

  const CHALLENGE =
    "Ada booked a live screen share and talked the whole change through instead of leaving review comments.";

  /**
   * A challenger with real salience. Force is `strength(challenger) x
   * sal(challenger)` (physics §5.6), so a draft with no dimensions and no claim
   * pushes with EXACTLY ZERO — a credited challenge that moves the pressure
   * field by nothing. The fixture states its salience for that reason.
   */
  function challenge(updates: string, content: string = CHALLENGE): Record<string, unknown> {
    return {
      content,
      kind: "person",
      updates,
      claimed: 1,
      salience: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    };
  }

  function revisions(c: Counterpart): Record<string, unknown>[] {
    return c.events("counterpart.revision").map((e) => (e.data ?? {}) as Record<string, unknown>);
  }

  // ── the belief path, through the sweep ───────────────────────────────────
  test("a SWEPT declaration adds pressure to a belief — the increment is durable", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    const day = c.store.livedDay();

    await sweptChunk(c, [challenge(beliefId)]);

    const p = c.store.physicsOf(beliefId);
    expect(p.pressure).toBeGreaterThan(0);
    expect(p.lastChallengedDay).toBe(day);
    // Durable, not ringed: the number and the story of how it got there both
    // survive the process (constitution 16, SEAMS K).
    const log = c.store.eventLog({ name: "revision.pressure" });
    expect(log).toHaveLength(1);
    expect(log[0]?.ref).toBe(beliefId);
    expect(revisions(c)).toEqual([
      expect.objectContaining({
        door: "sweep",
        path: "belief",
        reason: "below-bar",
        credited: true,
      }),
    ]);
  });

  test("the LINK alone is what the gap looked like — meta.updates without a mover", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    // The mint door's OTHER half still runs and always did: the resolved id is
    // written to prose meta, exactly as it was on the night the store recorded
    // zero pressure. That is what made the gap invisible — the link looked like
    // an effect. It is not one; only the applier moves anything.
    await sweptChunk(c, [challenge(beliefId)]);
    const minted = c.events("counterpart.sweep.minted")[0]?.ref as string;
    expect(c.store.readProse(minted).meta[UPDATES_META_KEY]).toBe(beliefId);

    const bare = store();
    const only = bare.put({
      type: "memory",
      kind: "person",
      body: CHALLENGE,
      meta: { [UPDATES_META_KEY]: "sch_whatever" },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    expect(bare.physicsOf(only).pressure).toBe(0);
  });

  test("one credited challenge per target per lived day, whatever the chunk says", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    await sweptChunk(c, [
      challenge(beliefId),
      challenge(
        beliefId,
        "Ada asked for the walkthrough a second time in the same afternoon, which is not how the note reads.",
      ),
    ]);

    // Two declarations, two applies — and only one of them may move the row.
    const applied = revisions(c);
    expect(applied).toHaveLength(2);
    expect(applied.map((r) => r["reason"])).toEqual(["below-bar", "already-challenged-today"]);
    expect(c.store.eventLog({ name: "revision.pressure" })).toHaveLength(1);
  });

  test("pressure crosses the bar and the belief is SUPERSEDED, with lineage", async () => {
    const c = brain();
    const { entityId, beliefId } = personBelief(c);
    for (const date of ["2026-08-02", "2026-08-03", "2026-08-04"]) {
      c.store.advanceClock(date);
      await sweptChunk(c, [challenge(beliefId, `${CHALLENGE} (${date})`)]);
      if (c.store.row(beliefId)?.superseded_by !== null) break;
    }

    const successorId = c.store.row(beliefId)?.superseded_by as string;
    expect(typeof successorId).toBe("string");
    expect(c.store.resolve(beliefId)).toBe(successorId);
    expect(c.store.versions(beliefId).map((v) => v.reason)).toContain("revised-by-pressure");
    // The successor stays attached to its schema — miss that and the revised
    // belief silently detaches and nothing else fails.
    expect(c.schemas.element(successorId)?.entityId).toBe(entityId);
    expect(c.schemas.beliefs(entityId).map((b) => b.id)).toEqual([successorId]);
    expect(revisions(c).some((r) => r["verdict"] === "revise")).toBe(true);
  });

  // ── the doors differ, through the PHYSICS and not a second weighting ──────
  test("an AUTHORED declaration carries more force than a SWEPT one on the same belief", async () => {
    const c = brain();
    // An `entity`-kind belief: iota 0.5 is below the slow-kind threshold, so the
    // daily force cap does not flatten the two channels into one number.
    const entityId = c.schemas.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the live instance",
      chunkRef: "seed",
      day: c.store.livedDay(),
    }).id as string;
    const beliefId = c.schemas.addBelief({
      entityId,
      statement: "Bansai is the live instance and stays primary",
      day: c.store.livedDay(),
      dimensions: { relevance: 0.9, emotional: 0.9, predictive: 0.9 },
    }).id as string;

    const dims = { relevance: 0.3, emotional: 0.3, predictive: 0.3 };
    const body =
      "Counterparts took over as primary this evening and bansai is muted for the parallel run.";
    await sweptChunk(c, [
      { content: body, kind: "fact", updates: beliefId, claimed: 1, salience: dims },
    ]);
    c.store.advanceClock("2026-08-02");
    await c.submitSessionEnd(
      {
        content: `${body} Confirmed again the next morning, with the hooks answering.`,
        kind: "fact",
        updates: beliefId,
        claimed: 1,
        salience: dims,
      },
      { session: "s2", scope: "proj" },
    );

    const forces = c.store
      .eventLog({ name: "revision.pressure" })
      .map((row) => JSON.parse(row.payload ?? "{}") as { force: number; challengerId: string });
    expect(forces).toHaveLength(2);
    const swept = forces[0] as { force: number; challengerId: string };
    const authored = forces[1] as { force: number; challengerId: string };
    expect(authored.force).toBeGreaterThan(swept.force);
    // And the reason is the one that ALREADY existed: the reteller's claim was
    // cut at the minting seam, so a sweep pushes less hard arithmetically.
    // Nothing in the revision path re-weights a channel (owner ruling).
    expect(c.store.row(swept.challengerId)?.claimed).toBe(PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING);
    expect(c.store.row(authored.challengerId)?.claimed).toBe(1);
  });

  test("the NOTE door applies a declaration too — every door, not just the sweep", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    const out = await c.submitJot(
      challenge(beliefId),
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    expect(c.store.physicsOf(beliefId).pressure).toBeGreaterThan(0);
    expect(revisions(c)).toEqual([
      expect.objectContaining({ door: "jot", path: "belief", credited: true }),
    ]);
  });

  // ── the identity path: same arithmetic, no schema ─────────────────────────
  test("an IDENTITY element takes pressure on the same arithmetic and the same event", async () => {
    const c = brain();
    // The store's own notion of identity — the band column and the promotion
    // flag, both written by the counted crossing in `sleep/consolidate.ts`.
    const identityId = c.store.put({
      type: "memory",
      kind: "self",
      body: "I work best by writing the plan down before touching anything.",
      salience: { novelty: null, relevance: 0.2, emotional: 0.2, predictive: 0.2 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    c.store.updatePhysics(identityId, { promotedIdentity: true });
    c.store.setBand(identityId, "identity", 0);

    await c.submitSessionEnd(
      {
        content:
          "I skipped the written plan today and worked straight through the change, and it went better than planning would have.",
        kind: "self",
        updates: identityId,
        claimed: 1,
      },
      { session: "s1", scope: "proj" },
    );

    expect(revisions(c)).toEqual([
      expect.objectContaining({ path: "identity", credited: true, verdict: "revise" }),
    ]);
    // The SAME durable event shape, so the dashboard's story reads it unchanged.
    const log = c.store.eventLog({ name: "revision.pressure" });
    expect(log).toHaveLength(1);
    expect(log[0]?.ref).toBe(identityId);
    expect(Object.keys(JSON.parse(log[0]?.payload as string)).sort()).toEqual([
      "bar",
      "challengerId",
      "day",
      "force",
      "pressureAfter",
      "targetId",
    ]);

    const successorId = c.store.row(identityId)?.superseded_by as string;
    expect(typeof successorId).toBe("string");
    expect(c.store.versions(identityId).map((v) => v.reason)).toContain("revised-by-pressure");
    // Identity is entered by INHERITING it through a declared revision, and the
    // successor is a memory — no entity, no role, no schema it was never part of.
    expect(c.store.row(successorId)?.type).toBe("memory");
    expect(c.store.row(successorId)?.band).toBe("identity");
    expect(c.store.physicsOf(successorId).promotedIdentity).toBe(true);
    expect(c.store.readProse(successorId).meta["entityId"]).toBeUndefined();
    expect(c.store.readProse(successorId).meta["role"]).toBeUndefined();
    expect(c.schemas.element(successorId)).toBeUndefined();
  });

  test("the increment reaches the DASHBOARD's story view, unchanged", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    await sweptChunk(c, [challenge(beliefId)]);
    c.close();
    brains.length = 0;

    const d = Dashboard.open({ dir });
    try {
      const text = stripAnsi(d.stories({ id: beliefId }));
      expect(text).toContain("Every credited challenge, in the order it landed");
      expect(text).toContain("challenged by");
      expect(text).toContain("held");
    } finally {
      d.close();
    }
  });

  // ── the fast half: a "now" fact flips on one clear correction ─────────────
  test("a CURRENT-STATE row is REPLACED immediately, with a versions row and no pressure", async () => {
    const c = brain();
    const entityId = c.schemas.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the live instance",
      chunkRef: "seed",
      day: c.store.livedDay(),
    }).id as string;
    const stateId = c.schemas.addCurrentState({
      entityId,
      statement: "Bansai is running as the live instance",
      day: c.store.livedDay(),
    }).id as string;

    await c.submitSessionEnd(
      {
        content: "Bansai is muted from tonight and counterparts answers the hooks instead.",
        kind: "entity",
        updates: stateId,
      },
      { session: "s1", scope: "proj" },
    );

    expect(revisions(c)).toEqual([
      expect.objectContaining({ path: "current-state", reason: "replaced", verdict: "replace" }),
    ]);
    const successorId = c.store.row(stateId)?.superseded_by as string;
    expect(typeof successorId).toBe("string");
    expect(c.store.versions(stateId).map((v) => v.reason)).toEqual(["replaced-by-declaration"]);
    expect(c.schemas.currentState(entityId).map((s) => s.id)).toEqual([successorId]);
    // No bar was climbed, because a stale "now" fact has no reason to climb one.
    expect(c.store.physicsOf(stateId).pressure).toBe(0);
    expect(c.store.eventLog({ name: "revision.pressure" })).toEqual([]);
  });

  // ── everything else: the link IS the effect ───────────────────────────────
  test("an ORDINARY memory is LINKED and nothing else — no supersede, no pressure", async () => {
    const c = brain();
    const targetId = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The cache is rebuildable, so it never enters the backup set.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.5, predictive: 0.5 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const out = await c.submitSessionEnd(
      {
        content:
          "The cache is rebuildable from the canonical files, which is why the backup set stays small.",
        kind: "fact",
        updates: targetId,
      },
      { session: "s1", scope: "proj" },
    );

    expect(revisions(c)).toEqual([
      expect.objectContaining({ path: "link-only", reason: "linked-only" }),
    ]);
    // The link already exists, and it is the whole effect (owner ruling).
    expect(c.store.readProse(out.memoryId as string).meta[UPDATES_META_KEY]).toBe(targetId);
    expect(c.store.row(targetId)?.superseded_by).toBeNull();
    expect(c.store.physicsOf(targetId).pressure).toBe(0);
  });

  test("an ENTITY is not a claim: a declaration against one links and stops", async () => {
    const c = brain();
    const { entityId } = personBelief(c);
    await c.submitSessionEnd(
      challenge(entityId),
      { session: "s1", scope: "proj" },
    );
    expect(revisions(c)).toEqual([
      expect.objectContaining({ path: "link-only", reason: "target-is-an-entity" }),
    ]);
    // No model, on any path, can kill or rewrite an entity (schemas §5 G7).
    expect(c.store.row(entityId)?.superseded_by).toBeNull();
    expect(c.store.physicsOf(entityId).pressure).toBe(0);
  });

  test("a PROTECTED element refuses the declaration, from every door", async () => {
    const c = brain();
    const { entityId } = personBelief(c);
    const protectedId = c.schemas.addBelief({
      entityId,
      statement: "Ada is the owner of this store, and that never gets revised away",
      day: c.store.livedDay(),
      protected: true,
      dimensions: { relevance: 0.9, emotional: 0.9, predictive: 0.9 },
    }).id as string;

    await c.submitSessionEnd(
      challenge(protectedId),
      { session: "s1", scope: "proj" },
    );
    await sweptChunk(c, [challenge(protectedId)]);

    expect(revisions(c).map((r) => r["reason"])).toEqual([
      "protected-refuses-revision",
      "protected-refuses-revision",
    ]);
    // Checked BEFORE the arithmetic: permanence that quietly accumulates a case
    // against itself is a different, worse guarantee (schemas NOTES §10).
    expect(c.store.physicsOf(protectedId).pressure).toBe(0);
    expect(c.store.physicsOf(protectedId).lastChallengedDay).toBeNull();
    expect(c.store.row(protectedId)?.superseded_by).toBeNull();
  });

  // ── the effect list and the applies agree ────────────────────────────────
  test("one apply per DECLARATION — an address that resolves to nothing is counted, not silent", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    await sweptChunk(c, [
      challenge(beliefId),
      {
        // A confabulated address, and content that resembles nothing this store
        // holds — so the content fallback finds no candidate either.
        content:
          "The garage door opener needs a fresh battery before winter, and the receipt is in the envelope.",
        kind: "fact",
        updates: "mem_deadbeefdead",
        claimed: 1,
        salience: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
      },
    ]);
    // encode emits ONE `revision.challenge` effect per accepted proposal whose
    // declaration was non-null, BEFORE resolution — so the applies stand one for
    // one with the effects, whatever the declaration turned out to name.
    expect(c.events("remember.updates.resolved")).toHaveLength(2);
    expect(revisions(c)).toHaveLength(2);
    expect(revisions(c)[0]?.["path"]).toBe("belief");
    expect(revisions(c)[1]?.["reason"]).toBe("target-unresolvable");
  });

  test("a FULLY GATED chunk moves nothing — no effect, and therefore no apply", async () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    await sweptChunk(c, [
      { content: "placeholder", kind: "fact", updates: beliefId },
      { content: "TBD", kind: "fact", updates: beliefId },
    ]);
    expect(c.events("counterpart.sweep.chunk")[0]?.data?.["fullyGated"]).toBe(true);
    expect(revisions(c)).toEqual([]);
    expect(c.store.physicsOf(beliefId).pressure).toBe(0);
    expect(c.store.eventLog({ name: "revision.pressure" })).toEqual([]);
  });

  test("an OBSERVER moves nothing, at the door and at the applier itself", async () => {
    const live = brain();
    const { beliefId } = personBelief(live);
    const challengerId = live.store.put({
      type: "memory",
      kind: "person",
      body: CHALLENGE,
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    live.close();
    brains.length = 0;

    const c = brain({ observer: true });
    await c.submitSessionEnd(
      challenge(beliefId),
      { session: "s1", scope: "proj" },
    );
    await sweptChunk(c, [challenge(beliefId)]);
    expect(revisions(c)).toEqual([]);

    // The second lock, on its own terms: an instrument that somehow reached the
    // applier still leaves the world as it found it, and SAYS so rather than
    // letting the store's write guard throw inside a deposit (scar E7).
    const out = applyRevision(
      c.store,
      c.schemas,
      { updates: beliefId, challengerId, day: c.store.livedDay(), method: "declared" },
      {},
    );
    expect({ path: out.path, reason: out.reason, moved: out.moved }).toEqual({
      path: "none",
      reason: "observer",
      moved: false,
    });
    expect(c.store.physicsOf(beliefId).pressure).toBe(0);
  });

  test("a CONFIRMATION is not a challenge — a matched restatement adds no pressure", () => {
    const c = brain();
    const { beliefId } = personBelief(c);
    const challengerId = c.store.put({
      type: "memory",
      kind: "person",
      body: "Ada prefers async review, still.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.9, predictive: 0.9 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });

    // The direction is READ OFF the matcher's own verdict, through the same
    // function the freeze seam uses — the two must not disagree (SEAMS N).
    for (const method of ["content", "content+hint"]) {
      expect(directionOf(method)).toBe("confirm");
      const out = applyRevision(
        c.store,
        c.schemas,
        { updates: beliefId, challengerId, day: c.store.livedDay(), method },
        {},
      );
      expect(out.reason).toBe("confirmation-not-a-challenge");
    }
    expect(directionOf("declared")).toBe("soften");
    // Saying the same thing again must never push a belief toward being
    // superseded by its own paraphrase (scar §2.10).
    expect(c.store.physicsOf(beliefId).pressure).toBe(0);
    expect(c.store.row(beliefId)?.superseded_by).toBeNull();
  });
});
