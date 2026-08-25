/**
 * associate/ — Hebbian linking and spreading activation.
 *
 * Hermetic by construction (CLAUDE.md): every store-backed test makes a fresh temp
 * data dir in `beforeEach` and removes ONLY that path in `afterEach`. Nothing here
 * can reach a real store; the pure-arithmetic and pure-traversal tests need no
 * store at all, which is most of the file.
 *
 * Assertions name the REASON — `CoactivateReason`, `MemberReason`, `FlushReason`,
 * `SpreadStop`, `Eviction.reason`. "The edge did not strengthen" is not a result:
 * an edge that did not strengthen because the tier was ignorable, because an
 * endpoint was frozen, because the flush was contended, and because a crash
 * dropped the batch are four different systems, and a test that cannot tell them
 * apart is the test v1 shipped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";
import type { EdgeInput, PutInput } from "../src/core/store/index.js";
import {
  Associate,
  DeltaBuffer,
  TUNABLES,
  conducts,
  edgeWeightAt,
  homeostasis,
  pairCredit,
  pairKey,
  planFlush,
  spread,
  strengthen,
  tierFactor,
  withTunables,
} from "../src/core/associate/index.js";
import type {
  AssociateStore,
  Credited,
  EdgeState,
  MemberReason,
} from "../src/core/associate/index.js";

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-associate-"));
  process.env["COUNTERPARTS_DATA_DIR"] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
  else process.env["COUNTERPARTS_DATA_DIR"] = priorEnv;
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

function mem(body: string, extra: Partial<PutInput> = {}): PutInput {
  return { type: "memory", kind: "fact", body, ...extra };
}

/** n real memories, so the edge table's foreign keys have something to point at. */
function memories(s: Store, n: number): string[] {
  return Array.from({ length: n }, (_, i) => s.put(mem(`memory number ${i} of the fixture`)));
}

function ref(id: string): Credited {
  return { id, tier: "referenced" };
}

function assoc(s: AssociateStore, tunables: Parameters<typeof withTunables>[0] = {}): Associate {
  return new Associate({ store: s, tunables });
}

/** A store seam wrapper — the crash points live here, not in production code. */
function wrap(s: Store, over: Partial<AssociateStore>): AssociateStore {
  const base: AssociateStore = {
    observer: s.observer,
    livedDay: () => s.livedDay(),
    row: (id) => s.row(id),
    deniedIds: () => s.deniedIds(),
    edgesFrom: (id) => s.edgesFrom(id),
    linkMany: (edges) => s.linkMany(edges),
  };
  return { ...base, ...over };
}

function reasons(verdicts: readonly { id: string; reason: MemberReason }[]): MemberReason[] {
  return verdicts.map((v) => v.reason);
}

/** A pure edge fixture: symmetric rows at day 0, for the traversal tests. */
function graph(pairs: readonly [string, string, number][]): (id: string) => EdgeState[] {
  const byNode = new Map<string, EdgeState[]>();
  const push = (src: string, dst: string, weight: number) => {
    const have = byNode.get(src) ?? [];
    have.push({ src, dst, weight, lastDay: 0 });
    byNode.set(src, have);
  };
  for (const [a, b, w] of pairs) {
    push(a, b, w);
    push(b, a, w);
  }
  return (id: string) => byNode.get(id) ?? [];
}

const ALL_CONDUCT = () => true;

// ───────────────────────────────────────────────────────────────────────────
// Co-activation: the Hebbian update
// ───────────────────────────────────────────────────────────────────────────

describe("co-activation", () => {
  test("a referenced pair strengthens SYMMETRICALLY, and the report says why", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);

    const co = g.coactivate([ref(a), ref(b)]);
    expect(co.reason).toBe("buffered");
    expect(co.pairs).toBe(1);
    expect(reasons(co.members)).toEqual(["eligible", "eligible"]);
    // Nothing durable yet — the buffer IS the declared exemption.
    expect(g.pending).toBe(1);
    expect(s.edgesFrom(a)).toHaveLength(0);

    const report = g.flush(0);
    expect(report.reason).toBe("flushed");
    expect(report.pairs).toBe(1);
    expect(report.rows).toBe(2);
    expect(g.weightAt(a, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
    expect(g.weightAt(b, a, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
    expect(g.linked(a, b, 0)).toBe(true);
  });

  test("repetition accumulates and stops at EDGE_CAP — the per-edge half of homeostasis", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    for (let i = 0; i < 3; i++) {
      g.coactivate([ref(a), ref(b)]);
      g.flush(0);
    }
    expect(g.weightAt(a, b, 0)).toBeCloseTo(3 * TUNABLES.HEBB_RATE, 10);

    for (let i = 0; i < 40; i++) {
      g.coactivate([ref(a), ref(b)]);
      g.flush(0);
    }
    expect(g.weightAt(a, b, 0)).toBe(TUNABLES.EDGE_CAP);
  });

  test("three credited memories mint three pairs", () => {
    const s = store();
    const [a, b, c] = memories(s, 3) as [string, string, string];
    const g = assoc(s);
    expect(g.coactivate([ref(a), ref(b), ref(c)]).pairs).toBe(3);
    const report = g.flush(0);
    expect(report.reason).toBe("flushed");
    expect(report.rows).toBe(6);
    expect(report.nodesTouched).toBe(3);
  });

  test("FOOTNOTES NEVER TRAIN, in both directions — reason 'ignorable-tier'", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    const co = g.coactivate([ref(a), { id: b, tier: "footnoted" }]);
    expect(reasons(co.members)).toEqual(["eligible", "ignorable-tier"]);
    expect(co.reason).toBe("too-few-members");
    expect(co.pairs).toBe(0);
    expect(g.pending).toBe(0);
    expect(g.flush(0).reason).toBe("nothing-buffered");
    // And the tier weight itself is zero, whatever the partner did.
    expect(tierFactor("footnoted", TUNABLES)).toBe(0);
    expect(pairCredit("referenced", "footnoted", TUNABLES)).toBe(0);
    expect(pairCredit("footnoted", "footnoted", TUNABLES)).toBe(0);
  });

  test("WEAK credit ships DISABLED (contract §4) — and turning it on is a visible knob", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    expect(TUNABLES.EDGE_WEAK_CREDIT).toBe(0);

    const shipped = assoc(s);
    const co = shipped.coactivate([
      { id: a, tier: "surfaced" },
      { id: b, tier: "surfaced" },
    ]);
    expect(reasons(co.members)).toEqual(["ignorable-tier", "ignorable-tier"]);
    expect(shipped.pending).toBe(0);

    const calibrated = assoc(s, { EDGE_WEAK_CREDIT: 0.25 });
    expect(calibrated.coactivate([{ id: a, tier: "surfaced" }, ref(b)]).pairs).toBe(1);
    calibrated.flush(0);
    expect(calibrated.weightAt(a, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE * 0.25, 10);
  });

  test("a PROTECTED endpoint is frozen in both directions — reason 'frozen-protected'", () => {
    const s = store();
    const a = s.put(mem("an ordinary working memory"));
    const pinned = s.put(mem("a pinned memory under audit", { physics: { protected: true } }));
    const g = assoc(s);
    const co = g.coactivate([ref(a), ref(pinned)]);
    expect(reasons(co.members)).toEqual(["eligible", "frozen-protected"]);
    expect(g.pending).toBe(0);
    expect(g.linked(a, pinned, 0)).toBe(false);
  });

  test("every non-live endpoint is excluded BY NAME, never silently", () => {
    const s = store();
    const live = s.put(mem("the live memory that does the crediting"));
    const gone = s.put(mem("the memory that gets archived"));
    s.archive(gone, "test");
    const old = s.put(mem("the memory that gets superseded"));
    s.supersede(old, mem("the successor memory"));
    const dark = s.put(mem("the memory a removal takes dark"));
    s.appendRemovalRecord({ memoryId: dark, stage: "dark", actor: "owner" });

    const g = assoc(s);
    const co = g.coactivate([
      ref(live),
      ref(gone),
      ref(old),
      ref(dark),
      ref("mem_0000000000000000"),
    ]);
    expect(reasons(co.members)).toEqual([
      "eligible",
      "archived",
      "superseded",
      "removed",
      "unknown-id",
    ]);
    expect(co.reason).toBe("too-few-members");
    expect(g.pending).toBe(0);
  });

  test("a memory does not link to itself, however many times it is credited", () => {
    const s = store();
    const [a] = memories(s, 1) as [string];
    const g = assoc(s);
    const co = g.coactivate([ref(a), ref(a)]);
    expect(co.reason).toBe("too-few-members");
    expect(co.members).toHaveLength(1);
    expect(g.pending).toBe(0);
  });

  test("an endpoint PINNED between the turn and the boundary is frozen at flush too", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(b)]);
    s.updatePhysics(b, { protected: true }); // the arc goes under audit mid-session
    const report = g.flush(0);
    expect(report.reason).toBe("flushed");
    expect(report.blocked).toBe(1);
    expect(g.linked(a, b, 0)).toBe(false);
  });

  test("an endpoint archived BETWEEN the turn and the boundary is blocked at flush", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(b)]);
    s.archive(b, "changed my mind");
    const report = g.flush(0);
    expect(report.reason).toBe("flushed");
    expect(report.blocked).toBe(1);
    expect(report.rows).toBe(0);
    expect(s.edgesFrom(a)).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// At most once — and the direction of the failure is CHOSEN
// ───────────────────────────────────────────────────────────────────────────

describe("at-most-once flush", () => {
  test("crash BEFORE the publish DROPS the batch — and a re-flush applies nothing", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(b)]);
    expect(g.pending).toBe(1);

    // The crash: the buffer was drained and the process died before publishing.
    const lost = g.drain();
    expect(lost).toHaveLength(1);
    expect(g.pending).toBe(0);

    const retry = g.flush(0);
    expect(retry.reason).toBe("nothing-buffered");
    expect(g.weightAt(a, b, 0)).toBe(0);
    // A publish that never landed emits no success telemetry (G6).
    expect(g.events("associate.flush.done")).toHaveLength(0);
  });

  test("crash AFTER the publish does NOT double — the re-flush finds nothing to re-apply", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    // The nastiest ordering: the write LANDS and the process dies before the
    // caller learns it did. A buffer restored here would double-apply on retry.
    let crashed = false;
    const flaky = wrap(s, {
      linkMany: (edges: readonly EdgeInput[]) => {
        s.linkMany(edges);
        if (!crashed) {
          crashed = true;
          throw new Error("crash after the write landed");
        }
      },
    });
    const g = assoc(flaky);
    g.coactivate([ref(a), ref(b)]);

    const first = g.flush(0);
    expect(first.reason).toBe("failed");
    expect(first.dropped).toBe(1);
    expect(first.rows).toBe(0);
    expect(g.events("associate.flush.done")).toHaveLength(0);
    expect(g.events("associate.flush.failed")).toHaveLength(1);
    // The write DID land — exactly once.
    expect(g.weightAt(a, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);

    const second = g.flush(0);
    expect(second.reason).toBe("nothing-buffered");
    expect(g.weightAt(a, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10); // not 0.2
  });

  test("a publish that throws BEFORE writing loses the batch and says so", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const dead = wrap(s, {
      linkMany: () => {
        throw new Error("box 2 is unavailable");
      },
    });
    const g = assoc(dead);
    g.coactivate([ref(a), ref(b)]);
    const report = g.flush(0);
    expect(report.reason).toBe("failed");
    expect(report.dropped).toBe(1);
    expect(report.error).toContain("box 2");
    expect(g.pending).toBe(0); // NOT restored: bounded loss is the chosen direction
    expect(g.weightAt(a, b, 0)).toBe(0);
    expect(g.events("associate.flush.done")).toHaveLength(0);
  });

  test("a CONTENDED flush skips and stays buffered, and the drain is bounded to what it read", () => {
    const s = store();
    const [a, b, c, d] = memories(s, 4) as [string, string, string, string];
    let inner: ReturnType<Associate["flush"]> | undefined;
    const reentrant = wrap(s, {
      linkMany: (edges: readonly EdgeInput[]) => {
        // A second arrival lands DURING the publish: it must survive.
        g.coactivate([ref(c), ref(d)]);
        inner = g.flush(0);
        s.linkMany(edges);
      },
    });
    const g = assoc(reentrant);
    g.coactivate([ref(a), ref(b)]);

    const outer = g.flush(0);
    expect(outer.reason).toBe("flushed");
    expect(inner?.reason).toBe("busy");
    expect(g.events("associate.flush.busy")).toHaveLength(1);
    // The concurrent arrival was never deleted unflushed (§10 G5).
    expect(g.pending).toBe(1);
    expect(g.weightAt(a, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
    expect(g.weightAt(c, d, 0)).toBe(0);
    expect(g.flush(0).reason).toBe("flushed");
    expect(g.weightAt(c, d, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
  });

  test("flushing an empty buffer is a no-op, repeatable, and writes nothing", () => {
    const s = store();
    memories(s, 2);
    const g = assoc(s);
    expect(g.flush(0).reason).toBe("nothing-buffered");
    expect(g.flush(0).reason).toBe("nothing-buffered");
    expect(s.events("store.link")).toHaveLength(0);
  });

  test("the buffer drains by SWAP: what comes back is closed, what arrives next is separate", () => {
    const b = new DeltaBuffer();
    b.add("a", "b", 0.1);
    b.add("b", "a", 0.1); // same unordered pair, one slot
    expect(b.size).toBe(1);
    const taken = b.drain();
    expect(taken).toEqual([{ a: "a", b: "b", delta: 0.2 }]);
    expect(b.size).toBe(0);
    b.add("a", "c", 0.1);
    expect(b.drain()).toHaveLength(1);
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });

  test("the buffer refuses self-pairs and non-positive deltas at the door", () => {
    const b = new DeltaBuffer();
    b.add("a", "a", 0.5);
    b.add("a", "b", 0);
    b.add("a", "b", -1);
    expect(b.size).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Edge decay — a physics-family curve on LIVED days, own constants
// ───────────────────────────────────────────────────────────────────────────

describe("edge decay", () => {
  test("an unused edge fades by lived days, and falls below the floor eventually", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    for (let i = 0; i < 5; i++) {
      g.coactivate([ref(a), ref(b)]);
      g.flush(0);
    }
    const w0 = g.weightAt(a, b, 0);
    expect(w0).toBeCloseTo(0.5, 10);

    expect(g.weightAt(a, b, TUNABLES.S_EDGE)).toBeCloseTo(w0 * Math.exp(-1), 10);
    expect(g.linked(a, b, TUNABLES.S_EDGE)).toBe(true);

    const faded = g.weightAt(a, b, TUNABLES.S_EDGE * 5);
    expect(faded).toBeLessThan(TUNABLES.EDGE_FLOOR);
    expect(g.linked(a, b, TUNABLES.S_EDGE * 5)).toBe(false);
  });

  test("decay is REALIZED at flush, and realizing it equals leaving it lazy", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(b)]);
    g.flush(0);
    const decayed = g.weightAt(a, b, TUNABLES.S_EDGE);

    g.coactivate([ref(a), ref(b)]);
    g.flush(TUNABLES.S_EDGE);
    // The stored weight at the flush day is the decayed weight plus the delta —
    // and a further lived day decays from THERE, exactly as a lazy read would.
    expect(g.weightAt(a, b, TUNABLES.S_EDGE)).toBeCloseTo(decayed + TUNABLES.HEBB_RATE, 10);
    expect(g.weightAt(a, b, TUNABLES.S_EDGE * 2)).toBeCloseTo(
      (decayed + TUNABLES.HEBB_RATE) * Math.exp(-1),
      10,
    );
  });

  test("decay never runs backwards: asking about an earlier day returns the stored weight", () => {
    const e: EdgeState = { src: "a", dst: "b", weight: 0.4, lastDay: 10 };
    expect(edgeWeightAt(e, 10, TUNABLES)).toBe(0.4);
    expect(edgeWeightAt(e, 3, TUNABLES)).toBe(0.4);
    expect(edgeWeightAt(e, 40, TUNABLES)).toBeCloseTo(0.4 * Math.exp(-1), 10);
  });

  test("the floor is where an association stops being one", () => {
    expect(conducts(TUNABLES.EDGE_FLOOR, TUNABLES)).toBe(false);
    expect(conducts(TUNABLES.EDGE_FLOOR + 1e-6, TUNABLES)).toBe(true);
    expect(strengthen(0.95, 0.2, TUNABLES)).toBe(TUNABLES.EDGE_CAP);
    expect(strengthen(0.1, -5, TUNABLES)).toBe(0.1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Homeostasis — structural, not patched after (§10 G2)
// ───────────────────────────────────────────────────────────────────────────

describe("homeostasis", () => {
  test("the per-node edge count is capped and the eviction is REPORTED, with its weight", () => {
    const s = store();
    const [hub, n1, n2, n3] = memories(s, 4) as [string, string, string, string];
    const g = assoc(s, { MAX_EDGES_PER_NODE: 2 });
    for (let i = 0; i < 3; i++) {
      g.coactivate([ref(hub), ref(n1)]);
      g.flush(0);
    }
    for (let i = 0; i < 2; i++) {
      g.coactivate([ref(hub), ref(n2)]);
      g.flush(0);
    }
    g.coactivate([ref(hub), ref(n3)]);
    const report = g.flush(0);

    expect(report.reason).toBe("flushed");
    expect(report.evictions).toHaveLength(1);
    const evicted = report.evictions[0];
    expect(evicted?.src).toBe(hub);
    expect(evicted?.dst).toBe(n3);
    expect(evicted?.reason).toBe("count-cap");
    expect(evicted?.priorWeight).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
    expect(g.events("associate.edge.evicted")).toHaveLength(1);

    expect(g.linked(hub, n3, 0)).toBe(false);
    expect(g.linked(hub, n1, 0)).toBe(true);
    expect(g.linked(hub, n2, 0)).toBe(true);
  });

  test("total outgoing weight is bounded by PROPORTIONAL renormalization, order preserved", () => {
    const weights = new Map([
      ["x", 0.4],
      ["y", 0.2],
      ["z", 0.005], // below the floor: dead, and not in the bound
    ]);
    const out = homeostasis("hub", weights, withTunables({ MAX_OUT_WEIGHT: 0.3 }));
    expect(out.renormalized).toBe(true);
    expect(out.evictions).toHaveLength(0);
    expect(out.next.get("x")).toBeCloseTo(0.2, 10);
    expect(out.next.get("y")).toBeCloseTo(0.1, 10);
    expect(out.next.get("x")! / out.next.get("y")!).toBeCloseTo(2, 10);
    expect(out.next.get("z")).toBe(0.005);
  });

  test("eviction happens BEFORE scaling, so survivors are not paid for the departed", () => {
    const weights = new Map([
      ["x", 0.5],
      ["y", 0.4],
      ["z", 0.3],
    ]);
    const t = withTunables({ MAX_EDGES_PER_NODE: 2, MAX_OUT_WEIGHT: 0.9 });
    const out = homeostasis("hub", weights, t);
    expect(out.evictions.map((e) => e.dst)).toEqual(["z"]);
    expect(out.next.get("z")).toBe(0);
    expect(out.next.get("x")).toBeCloseTo(0.5, 10);
    expect(out.next.get("y")).toBeCloseTo(0.4, 10);
    expect(out.renormalized).toBe(false);
  });

  test("planFlush returns ABSOLUTE rows, symmetric, and rewrites nothing unchanged", () => {
    const plan = planFlush([{ a: "b", b: "a", delta: 0.1 }], 4, () => [], TUNABLES);
    expect(plan.rows).toEqual([
      { src: "a", dst: "b", weight: 0.1, lastDay: 4 },
      { src: "b", dst: "a", weight: 0.1, lastDay: 4 },
    ]);
    // Same day, same weights, no deltas ⇒ nothing to write.
    const idle = planFlush([], 4, (id) =>
      id === "a" ? [{ src: "a", dst: "b", weight: 0.1, lastDay: 4 }] : [], TUNABLES);
    expect(idle.rows).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spreading activation — bounded, and it cannot resurrect anything
// ───────────────────────────────────────────────────────────────────────────

describe("spreading activation", () => {
  test("contributions are bounded by DEPTH — the fourth node is out of reach", () => {
    const edgesFrom = graph([
      ["a", "b", 0.5],
      ["b", "c", 0.5],
      ["c", "d", 0.5],
    ]);
    const out = spread(
      { seeds: [{ id: "a", activation: 1 }], day: 0, edgesFrom, conducts: ALL_CONDUCT },
      TUNABLES,
    );
    const ids = out.contributions.map((c) => c.id);
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(ids).not.toContain("d");
    expect(out.stop).toBe("hop-limit");
    expect(out.contributions.find((c) => c.id === "b")?.depth).toBe(1);
    expect(out.contributions.find((c) => c.id === "c")?.depth).toBe(2);
  });

  test("hop decay and fan normalization: a hub shares its activation, it does not flood", () => {
    const single = spread(
      {
        seeds: [{ id: "a", activation: 1 }],
        day: 0,
        edgesFrom: graph([["a", "b", 0.4]]),
        conducts: ALL_CONDUCT,
      },
      withTunables({ HOPS: 1 }),
    );
    expect(single.contributions[0]?.activation).toBeCloseTo(TUNABLES.HOP_DECAY, 10);

    const hub = spread(
      {
        seeds: [{ id: "a", activation: 1 }],
        day: 0,
        edgesFrom: graph([
          ["a", "b", 0.4],
          ["a", "c", 0.4],
        ]),
        conducts: ALL_CONDUCT,
      },
      withTunables({ HOPS: 1 }),
    );
    expect(hub.contributions).toHaveLength(2);
    for (const c of hub.contributions) expect(c.activation).toBeCloseTo(0.25, 10);
    const total = hub.contributions.reduce((sum, c) => sum + c.activation, 0);
    expect(total).toBeCloseTo(TUNABLES.HOP_DECAY, 10);
  });

  test("contributions SUM across paths and keep the shallowest depth", () => {
    const out = spread(
      {
        seeds: [
          { id: "a", activation: 1 },
          { id: "b", activation: 1 },
        ],
        day: 0,
        edgesFrom: graph([
          ["a", "t", 0.5],
          ["b", "t", 0.5],
        ]),
        conducts: ALL_CONDUCT,
      },
      withTunables({ HOPS: 1 }),
    );
    const t = out.contributions.find((c) => c.id === "t");
    expect(t?.paths).toBe(2);
    expect(t?.depth).toBe(1);
    expect(t?.activation).toBeCloseTo(1.0, 10);
  });

  test("a faded edge conducts nothing — decay applies inside the traversal too", () => {
    const edgesFrom = graph([["a", "b", 0.1]]);
    const fresh = spread(
      { seeds: [{ id: "a", activation: 1 }], day: 0, edgesFrom, conducts: ALL_CONDUCT },
      TUNABLES,
    );
    expect(fresh.contributions.map((c) => c.id)).toEqual(["b"]);
    const stale = spread(
      {
        seeds: [{ id: "a", activation: 1 }],
        day: TUNABLES.S_EDGE * 6,
        edgesFrom,
        conducts: ALL_CONDUCT,
      },
      TUNABLES,
    );
    expect(stale.contributions).toHaveLength(0);
    expect(stale.stop).toBe("exhausted");
  });

  test("the node budget stops the traversal and SAYS it stopped", () => {
    const out = spread(
      {
        seeds: [{ id: "a", activation: 1 }],
        day: 0,
        edgesFrom: graph([
          ["a", "b", 0.5],
          ["b", "c", 0.5],
        ]),
        conducts: ALL_CONDUCT,
      },
      withTunables({ MAX_SPREAD_NODES: 1 }),
    );
    expect(out.stop).toBe("node-limit");
    expect(out.expanded).toBe(1);
    expect(out.contributions.map((c) => c.id)).toEqual(["b"]);
  });

  test("a non-conducting SEED is blocked, and the count says so", () => {
    const out = spread(
      {
        seeds: [{ id: "a", activation: 1 }],
        day: 0,
        edgesFrom: graph([["a", "b", 0.5]]),
        conducts: (id) => id !== "a",
      },
      TUNABLES,
    );
    expect(out.contributions).toHaveLength(0);
    expect(out.blocked).toBe(1);
    expect(out.expanded).toBe(0);
  });

  test("archived memories are never resurrected — not as a destination, not as a bridge", () => {
    const s = store();
    const [a, x, b] = memories(s, 3) as [string, string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(x)]);
    g.coactivate([ref(x), ref(b)]);
    g.flush(0);
    expect(g.spreadFrom([{ id: a, activation: 1 }], 0).contributions.map((c) => c.id)).toEqual([
      x,
      b,
    ]);

    s.archive(x, "consolidated away");
    const after = g.spreadFrom([{ id: a, activation: 1 }], 0);
    expect(after.contributions).toHaveLength(0);
    expect(after.blocked).toBeGreaterThan(0);
    expect(g.linked(a, x, 0)).toBe(false);
    // The row is still there: archival is a state, not a deletion.
    expect(s.edgesFrom(a)).toHaveLength(1);
  });

  test("an ERASED id stops conducting, and a cache rebuild cannot resurrect it (contract G8)", () => {
    const s = store();
    const [a, x, b] = memories(s, 3) as [string, string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(x)]);
    g.coactivate([ref(x), ref(b)]);
    g.flush(0);
    expect(g.spreadFrom([{ id: a, activation: 1 }], 0).contributions.map((c) => c.id)).toContain(b);

    s.appendRemovalRecord({ memoryId: x, stage: "dark", actor: "owner", reason: "owner erase" });
    s.rebuildCache(); // v1's resurrection step: the sidecar reloaded wholesale
    const after = g.spreadFrom([{ id: a, activation: 1 }], 0);
    expect(after.contributions).toHaveLength(0);
    expect(g.linked(a, x, 0)).toBe(false);
    expect(g.linked(x, b, 0)).toBe(false);
    // The association fingerprint no longer outlives the content.
    const direct = g.spreadFrom([{ id: b, activation: 1 }], 0);
    expect(direct.contributions.map((c) => c.id)).not.toContain(a);
  });

  test("a superseded head stops conducting, and retargeting keeps the successor warm", () => {
    const s = store();
    const [a, b] = memories(s, 2) as [string, string];
    const g = assoc(s);
    g.coactivate([ref(a), ref(b)]);
    g.flush(0);
    const successor = s.supersede(a, mem("the revised version of the first memory"));

    expect(g.linked(a, b, 0)).toBe(false);
    expect(g.linked(successor, b, 0)).toBe(false); // starts cold — scar §2.2

    const report = g.retargetOnSupersede(a, successor, 0);
    expect(report.reason).toBe("flushed");
    expect(g.linked(successor, b, 0)).toBe(true);
    expect(g.weightAt(successor, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
    expect(g.weightAt(b, successor, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
    // Idempotent: inherit is `max`, not `+`, so a re-run cannot inflate.
    g.retargetOnSupersede(a, successor, 0);
    expect(g.weightAt(successor, b, 0)).toBeCloseTo(TUNABLES.HEBB_RATE, 10);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Observer — trains nothing, checked FIRST (contract G7, scar E7)
// ───────────────────────────────────────────────────────────────────────────

describe("observer", () => {
  test("an observer accumulates NOTHING and never reaches the store seam", () => {
    const writer = store();
    const [a, b] = memories(writer, 2) as [string, string];
    const probe = store({ observer: true });
    const g = assoc(probe);

    const co = g.coactivate([ref(a), ref(b)]);
    expect(co.reason).toBe("observer");
    expect(co.members).toHaveLength(0);
    expect(g.pending).toBe(0);

    const report = g.flush(0);
    expect(report.reason).toBe("observer");
    expect(g.events("associate.observer.skip")).toHaveLength(2);
    expect(g.events("associate.observer.skip")[0]?.data?.["site"]).toBe("coactivate");
    // Checked BEFORE any other work: the store's own stand-down never fired,
    // because the store was never asked (the refusal is not a caught exception).
    expect(probe.events("store.observer.standdown")).toHaveLength(0);
    expect(probe.edgesFrom(a)).toHaveLength(0);
    // A stood-down instrument is distinguishable from a broken hook.
    expect(g.events()).not.toHaveLength(0);
  });

  test("an observer may still SPREAD — instruments surface, they just don't train", () => {
    const writer = store();
    const [a, b] = memories(writer, 2) as [string, string];
    const g = assoc(writer);
    g.coactivate([ref(a), ref(b)]);
    g.flush(0);

    const probe = store({ observer: true });
    const instrument = assoc(probe);
    const out = instrument.spreadFrom([{ id: a, activation: 1 }], 0);
    expect(out.contributions.map((c) => c.id)).toEqual([b]);
    expect(instrument.pending).toBe(0);
    expect(instrument.observer).toBe(true);
  });

  test("an observer refuses to retarget too", () => {
    const probe = store({ observer: true });
    const g = assoc(probe);
    expect(g.retargetOnSupersede("mem_a", "mem_b", 0).reason).toBe("observer");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The module's own shape
// ───────────────────────────────────────────────────────────────────────────

describe("module shape", () => {
  test("associate exports no delete/remove/unlink/rm — learned structure is not destroyed either", async () => {
    const mod = (await import("../src/core/associate/index.js")) as Record<string, unknown>;
    const forbidden = Object.keys(mod).filter((k) => /^(delete|remove|unlink|rm|drop)/i.test(k));
    expect(forbidden).toEqual([]);
  });

  test("the tier table is the ignorable tier's only home, and it is zero", () => {
    expect(tierFactor("referenced", TUNABLES)).toBe(1);
    expect(tierFactor("footnoted", TUNABLES)).toBe(0);
    // Disabling the rate cannot make a footnote train, and raising weak credit
    // cannot either.
    expect(pairCredit("footnoted", "referenced", withTunables({ EDGE_WEAK_CREDIT: 1 }))).toBe(0);
  });
});
