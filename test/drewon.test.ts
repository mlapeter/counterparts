/**
 * `drewOn` (2026-10-11) — the session SAYS which memories it was shown that
 * shaped what it did or said, on `session_end` or `chapter`, and each earns the
 * engaged tier: half a use, a half-weight `engaged` return, no core-lane day.
 * Since 2026-10-19 an experiment (Mike, the feedback loop) tries it as a FULL
 * use (`W_ENGAGED` 1.0, an awake return); these tests read the tier's weight
 * and hold in either regime, so setting it back to 0.5 passes them too.
 * The successor to #371's matcher (parked 2026-10-10); its tier code is reused
 * here, its matcher is not.
 *
 * Built by the drewOn builder, 2026-10-11, from Mike's 10-10 direction,
 * lightly held.
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart, DREW_ON_MAX_PER_BOUNDARY, RECALL_CREDIT_EVENT } from "../src/core/counterpart.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { TUNABLES, USE_TIER_WEIGHT, creditReturn, creditUse, partialSourceOf, rep } from "../src/core/physics/index.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { DESKTOP_HOST } from "../src/adapters/hosts.js";
import { curveSignature } from "../src/core/sleep/decay.js";

// ── physics: the engaged tier (ported from #371) ─────────────────────────────

function physics(over: Partial<MemoryPhysics> = {}): MemoryPhysics {
  return {
    kind: "fact",
    salience: { novelty: null, relevance: 0.5, emotional: 0.3, predictive: 0.4 },
    uses: 0,
    lastUsedDay: 0,
    birthDay: 0,
    consolidated: false,
    protected: false,
    ...over,
  } as MemoryPhysics;
}

/** Whether drewOn is a full use with an awake return (the 2026-10-19 experiment) or the half regime. */
const FULL = partialSourceOf("engaged") === null;
const W = USE_TIER_WEIGHT.engaged;

describe("physics — the engaged tier", () => {
  test("an engaged use is worth its tier's weight, once a day, never on the birth day", () => {
    expect(W).toBe(TUNABLES.W_ENGAGED);
    expect(FULL).toBe(W >= TUNABLES.AWAKE_RETURN_MIN_WEIGHT);
    const m = physics({ birthDay: 1, lastUsedDay: 1 });
    const r = creditUse(m, 3, "engaged");
    expect(r.credited).toBe(true);
    expect(r.next.uses).toBe(W);
    expect(creditUse({ ...m, ...r.next }, 3, "engaged").reason).toBe("already-credited-today");
    expect(creditUse(physics({ birthDay: 3, lastUsedDay: 3 }), 3, "engaged").reason).toBe("birth-day");
  });

  test("a full use the same day LIFTS an engaged one: the difference, no second reinforced day", () => {
    const after = creditUse(physics({ birthDay: 1, lastUsedDay: 1 }), 3, "engaged").next;
    const m = physics({ birthDay: 1, ...after });
    expect(creditUse(m, 3, "referenced").reason).toBe("already-credited-today");
    const lifted = creditUse(m, 3, "referenced", { upgradeFrom: "engaged" });
    // At full weight there is nothing to lift (the 2026-10-19 experiment).
    expect(lifted.credited).toBe(W < USE_TIER_WEIGHT.referenced);
    expect(lifted.next.uses).toBe(1);
    expect(lifted.next.reinforcedDays).toBe(after.reinforcedDays);
    // Never downward.
    expect(creditUse(m, 3, "surfaced", { upgradeFrom: "engaged" }).credited).toBe(false);
  });

  test("an engaged return is half weight, spaced, and buys no lane day", () => {
    const m = physics({ birthDay: 1, lastUsedDay: 1 });
    const r = creditReturn(m, 8, { source: "engaged" });
    expect(r.counted).toBe(true);
    expect(r.weight).toBeCloseTo(TUNABLES.ENGAGED_RETURN_WEIGHT * (1 - Math.exp(-7 / TUNABLES.RETURN_SPACING_DAYS)), 10);
    expect(r.next.returnDays).toBe(0);
    expect(r.next.lastReturnDay).toBe(null);
    expect(creditReturn({ ...m, lastDreamDay: 8 }, 8, { source: "engaged" }).reason).toBe("already-returned-today");
  });

  test("the repetition arm saturates: 0.5·(1 − e^(−uses/3)), each use adding less", () => {
    expect(rep({ uses: 0 })).toBe(0);
    expect(rep({ uses: 1 })).toBeCloseTo(0.5 * (1 - Math.exp(-1 / 3)), 10);
    expect(rep({ uses: 5 })).toBeCloseTo(0.4055, 3);
    const gain = (n: number): number => rep({ uses: n }) - rep({ uses: n - 1 });
    expect(gain(5)).toBeLessThan(gain(1) / 2);
    expect(rep({ uses: 100 })).toBeLessThanOrEqual(TUNABLES.REP_CAP);
  });

  test("the recurrence hook is half weight, and nothing reads it yet", () => {
    expect(TUNABLES.ENGAGED_RECURRENCE_WEIGHT).toBe(0.5);
  });
});

// ── the core seam ────────────────────────────────────────────────────────────

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-drewon-"));
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

function brain(opts: { observer?: boolean } = {}): Counterpart {
  const c = Counterpart.open({ dir, ...(opts.observer === true ? { observer: true } : {}) });
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

/** Record `ids` as footnoted to `sessionId` on `turn`, as recall's own save would. */
function shown(c: Counterpart, sessionId: string, turn: number, ids: readonly string[]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn, tier: "footnoted", trains: true };
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

/** Memories born on one day, the clock then moved on (credit is never on a birth day). */
function setup(n = 2): { c: Counterpart; ids: string[] } {
  const c = brain();
  c.store.advanceClock("2026-08-25");
  const ids = Array.from({ length: n }, (_, i) => fact(c, `Orchard note ${String(i)}: the ladder and the rung`));
  c.store.advanceClock("2026-08-26");
  return { c, ids };
}

describe("Counterpart#creditDrewOn — the engaged tier, by the session's own word", () => {
  test("a shown id is credited at the tier's weight, with its return (engaged at half, awake at full) — once a day", () => {
    const { c, ids } = setup();
    const [a, b] = ids as [string, string];
    shown(c, "s1", 1, [a, b]);
    const r = c.creditDrewOn("s1", [a]);
    expect(r.credited).toEqual([a]);
    expect(r.refused).toEqual([]);
    const row = c.store.row(a);
    expect(row?.uses).toBe(W);
    expect(row?.last_used_day).toBe(c.store.livedDay());
    expect(c.store.returnsOf(a).map((x) => x.source)).toEqual([FULL ? "awake" : "engaged"]);
    expect(row?.return_days).toBe(FULL ? 1 : 0);
    // Shown and not named: nothing.
    expect(c.store.row(b)?.uses).toBe(0);
    // Named again the same day: refused by name, nothing more.
    const again = c.creditDrewOn("s1", [a]);
    expect(again.credited).toEqual([]);
    expect(again.refused).toEqual([{ id: a, reason: "already-credited-at-or-above" }]);
    expect(c.store.row(a)?.uses).toBe(W);
    // The next lived day it counts again.
    c.store.advanceClock("2026-08-28");
    shown(c, "s1", 2, []);
    expect(c.creditDrewOn("s1", [a]).credited).toEqual([a]);
    expect(c.store.row(a)?.uses).toBe(2 * W);
  });

  test("an id this session was never shown is refused by name and nothing is credited", () => {
    const { c, ids } = setup();
    const [a, b] = ids as [string, string];
    shown(c, "s1", 1, [a]);
    // Shown to ANOTHER session is not shown to this one.
    shown(c, "s2", 1, [b]);
    const r = c.creditDrewOn("s1", [b, "mem_000000000000"]);
    expect(r.credited).toEqual([]);
    expect(r.refused).toEqual([
      { id: b, reason: "not-shown" },
      { id: "mem_000000000000", reason: "not-shown" },
    ]);
    expect(c.store.row(b)?.uses).toBe(0);
  });

  test("what a deliberate question's answer showed counts as shown", () => {
    const { c, ids } = setup();
    const [a] = ids as [string];
    c.noteAsked("s1", [a]);
    expect(c.creditDrewOn("s1", [a]).credited).toEqual([a]);
  });

  test(`at most ${String(DREW_ON_MAX_PER_BOUNDARY)} per boundary, the first named; the 4th comes back capped — across both tools`, () => {
    const { c, ids } = setup(6);
    shown(c, "s1", 1, ids);
    const first = c.creditDrewOn("s1", ids.slice(0, 4));
    expect(first.credited).toEqual(ids.slice(0, 3));
    expect(first.capped).toEqual([ids[3]!]);
    expect(c.store.row(ids[3]!)?.uses).toBe(0);
    // The other tool's answer to the same ask shares the cap.
    const second = c.creditDrewOn("s1", [ids[4]!]);
    expect(second.credited).toEqual([]);
    expect(second.capped).toEqual([ids[4]!]);
    // A new turn is a new boundary.
    shown(c, "s1", 2, []);
    expect(c.creditDrewOn("s1", [ids[4]!]).credited).toEqual([ids[4]!]);
  });

  test("a refused id does not use a slot; duplicates are named once", () => {
    const { c, ids } = setup(4);
    shown(c, "s1", 1, ids);
    const r = c.creditDrewOn("s1", ["mem_000000000000", ids[0]!, ids[0]!, ids[1]!, ids[2]!]);
    expect(r.named).toBe(4);
    expect(r.credited).toEqual(ids.slice(0, 3));
    expect(r.capped).toEqual([]);
  });

  test("never a superseded memory, nor one faded under a newer one: refused by name", () => {
    const { c, ids } = setup(3);
    const [a, b, d] = ids as [string, string, string];
    c.store.updatePhysics(b, { fade: 0.5 });
    shown(c, "s1", 1, [a, b, d]);
    const head = c.store.supersede(d, {
      type: "memory",
      kind: "fact",
      title: "Orchard note: the ladder has two new rungs",
      body: "Two, after all.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
    });
    expect(c.store.row(d)?.superseded_by).toBe(head);
    const r = c.creditDrewOn("s1", [a, b, d]);
    expect(r.credited).toEqual([a]);
    expect(r.refused.find((x) => x.id === b)?.reason).toBe("faded-under-newer");
    // A superseded row is archived in this store, so that lock is the first
    // to hold; `superseded` is the second, for a row that stays live.
    expect(["archived", "superseded"]).toContain(r.refused.find((x) => x.id === d)?.reason ?? "");
    expect(c.store.row(b)?.uses).toBe(0);
    expect(c.store.row(d)?.uses).toBe(0);
  });

  test("an open later the same day makes it one full use, with one awake return", () => {
    const { c, ids } = setup();
    const [a] = ids as [string];
    shown(c, "s1", 1, [a]);
    c.creditDrewOn("s1", [a]);
    expect(c.store.row(a)?.uses).toBe(W);
    const s = c.creditReferences("s1", { assistantTurns: [], expansions: [a] });
    // Half: the open lifts it. Full (2026-10-19): already credited at that weight.
    expect(s.credited).toBe(FULL ? 0 : 1);
    if (!FULL) expect(s.how).toEqual(["expanded"]);
    const row = c.store.row(a);
    expect(row?.uses).toBe(1);
    expect(row?.reinforced_days).toBe(1);
    expect(c.store.returnsOf(a).map((x) => x.source)).toEqual(["awake"]);
    expect(row?.return_days).toBe(1);
  });

  test("an open in ANOTHER session the same day lifts it too (read off its return row)", () => {
    const { c, ids } = setup();
    const [a] = ids as [string];
    shown(c, "s1", 1, [a]);
    c.creditDrewOn("s1", [a]);
    const s = c.creditReferences("s2", { assistantTurns: [], expansions: [a] });
    expect(s.credited).toBe(FULL ? 0 : 1);
    expect(c.store.row(a)?.uses).toBe(1);
    expect(c.store.returnsOf(a).map((x) => x.source)).toEqual(["awake"]);
  });

  test("opened first, then named: already credited above this tier", () => {
    const { c, ids } = setup();
    const [a] = ids as [string];
    shown(c, "s1", 1, [a]);
    c.creditReferences("s1", { assistantTurns: [], expansions: [a] });
    const r = c.creditDrewOn("s1", [a]);
    expect(r.refused).toEqual([{ id: a, reason: "already-credited-at-or-above" }]);
    expect(c.store.row(a)?.uses).toBe(1);
  });

  test("the observer stance writes nothing", () => {
    const { c, ids } = setup();
    const [a] = ids as [string];
    shown(c, "s1", 1, [a]);
    c.close();
    open.splice(0);
    const watcher = brain({ observer: true });
    const r = watcher.creditDrewOn("s1", [a]);
    expect(r.credited).toEqual([]);
    expect(r.refused).toEqual([{ id: a, reason: "observer" }]);
    expect(watcher.store.row(a)?.uses).toBe(0);
    expect(watcher.store.returnsOf(a)).toEqual([]);
  });
});

// ── the tools ────────────────────────────────────────────────────────────────

const SESSION = "sess_drewon_1";

function server(opts: { observer?: boolean } = {}): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/drewon", ...(opts.observer === true ? { observer: true } : {}) });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** Two memories, footnoted to the bound session, the day moved on. */
function seeded(s: McpServer): string[] {
  const c = s.counterpart;
  c.store.advanceClock("2026-08-25");
  const ids = [fact(c, "The quince tree in the north corner"), fact(c, "The medlar tree by the gate")];
  c.store.advanceClock("2026-08-26");
  shown(c, SESSION, 1, ids);
  return ids;
}

function drewOnRows(s: McpServer): Record<string, unknown>[] {
  return s.counterpart.store
    .eventLog({ name: RECALL_CREDIT_EVENT, limit: 50 })
    .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>)
    .filter((p) => p["source"] === "drewOn");
}

describe("the drewOn field on session_end and chapter", () => {
  test("session_end credits it beside its memories, and the credit row says how", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "The quince needs netting before the birds find it." }],
        drewOn: [a, "mem_000000000000"],
      }),
    );
    expect(out["deposited"]).toBe(1);
    expect(out["drewOn"]).toEqual({ credited: [a], refused: [{ id: "mem_000000000000", reason: "not-shown" }] });
    expect(s.counterpart.store.row(a)?.uses).toBe(USE_TIER_WEIGHT.engaged);
    const rows = drewOnRows(s);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ via: "session_end", reason: "credited", credited: 1, considered: 2, ids: [a], how: ["drewOn"], refused: { "not-shown": 1 } });
  });

  test("an empty `memories` answer still carries it", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    const out = payload(await s.call("session_end", { session: SESSION, memories: [], drewOn: [a] }));
    expect(out["reason"]).toBe("nothing-new");
    expect(out["drewOn"]).toEqual({ credited: [a] });
  });

  test("chapter credits it too, and shares the boundary's cap", async () => {
    const s = server();
    const c = s.counterpart;
    c.store.advanceClock("2026-08-25");
    const ids = Array.from({ length: 4 }, (_, i) => fact(c, `Fruit tree ${String(i)} in the orchard`));
    c.store.advanceClock("2026-08-26");
    shown(c, SESSION, 1, ids);
    const end = payload(await s.call("session_end", { session: SESSION, memories: [], drewOn: ids.slice(0, 2) }));
    expect((end["drewOn"] as Record<string, unknown>)["credited"]).toEqual(ids.slice(0, 2));
    const ch = payload(
      await s.call("chapter", { session: SESSION, text: "We walked the orchard and counted what survived the frost.", drewOn: ids.slice(2) }),
    );
    expect(ch["stored"]).toBe(true);
    const d = ch["drewOn"] as Record<string, unknown>;
    expect(d["credited"]).toEqual([ids[2]]);
    expect(d["capped"]).toEqual([ids[3]]);
    expect(typeof d["cap"]).toBe("string");
    expect(drewOnRows(s).map((r) => r["via"]).sort()).toEqual(["chapter", "session_end"]);
  });

  test("a value that is not a list of ids credits nothing and says so", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    const out = payload(await s.call("chapter", { session: SESSION, text: "A short true chapter.", drewOn: a }));
    expect((out["drewOn"] as Record<string, unknown>)["reason"]).toBe("drewOn-malformed");
    expect(s.counterpart.store.row(a)?.uses).toBe(0);
  });

  test("left out, nothing changes and no row is written", async () => {
    const s = server();
    seeded(s);
    const out = payload(await s.call("session_end", { session: SESSION, memories: [] }));
    expect(out["drewOn"]).toBeUndefined();
    expect(drewOnRows(s)).toEqual([]);
  });

  test("under observer stance both tools stand down and nothing is credited", async () => {
    const owner = server();
    const [a] = seeded(owner) as [string];
    const watcher = server({ observer: true });
    await watcher.call("session_end", { session: SESSION, memories: [], drewOn: [a] });
    await watcher.call("chapter", { session: SESSION, text: "Watching only.", drewOn: [a] });
    expect(owner.counterpart.store.row(a)?.uses).toBe(0);
    expect(drewOnRows(owner)).toEqual([]);
  });

  test("review of #385: sent with a `writeUp`, it is credited against this session and rides out on the answer", async () => {
    const s = server();
    const [a] = seeded(s) as [string];
    // A write-up of a session nobody recorded: the write-up refuses, the field still counts.
    const out = payload(await s.call("session_end", { session: SESSION, writeUp: "sess_nobody_recorded", drewOn: [a] }));
    expect(out["drewOn"]).toEqual({ credited: [a] });
    expect(s.counterpart.store.row(a)?.uses).toBe(USE_TIER_WEIGHT.engaged);
    expect(drewOnRows(s).map((r) => r["via"])).toEqual(["session_end"]);
  });

  test("review of #385: a Desktop call that names no session credits nothing — it may be another chat's", async () => {
    const s = openServer({ dir, host: DESKTOP_HOST, lifecycle: { spawner: () => ({ pid: 4242 }) }, manifestVersion: () => null });
    open.push(s.counterpart);
    const c = s.counterpart;
    c.store.advanceClock("2026-08-25");
    const a = fact(c, "The fig against the south wall");
    c.store.advanceClock("2026-08-26");
    const chat = payload(await s.call("wake", {}))["session"] as string;
    shown(c, chat, 1, [a]);
    for (const [tool, args] of [
      ["session_end", { memories: [], drewOn: [a] }],
      ["chapter", { text: "A chapter that forgot to name its chat.", drewOn: [a] }],
    ] as const) {
      const out = payload(await s.call(tool, args));
      expect(out["boundBy"]).toBe("most-recent");
      const d = out["drewOn"] as Record<string, unknown>;
      expect(d["reason"]).toBe("session-unnamed");
      expect(d["credited"]).toEqual([]);
    }
    expect(c.store.row(a)?.uses).toBe(0);
    // Named, the same chat's credit lands.
    const named = payload(await s.call("session_end", { session: chat, memories: [], drewOn: [a] }));
    expect(named["drewOn"]).toEqual({ credited: [a] });
  });

  test("review of #385: the saturating arm is in the curve's signature, so a store signed under the linear arm re-curves once", () => {
    expect(JSON.parse(curveSignature())["repScale"]).toBe(TUNABLES.REP_SCALE_USES);
  });
});

// ── Group 4 item 1 (2026-10-11): what was drawn on together is linked ────────

describe("drewOn deposits a link (Group 4 item 1, review 06 C1)", () => {
  test("two named memories enter one pair set at the referenced tier: one HEBB_RATE deposit, landed by the boundary", async () => {
    const { c, ids } = setup(3);
    const [a, b, z] = ids as [string, string, string];
    shown(c, "s1", 1, [a, b, z]);
    const r = c.creditDrewOn("s1", [a, b]);
    expect(r.credited).toEqual([a, b]);
    expect(r.linked).toBe(1);
    // Written to the pending file, not the table: the worker lands it.
    expect(c.store.edgesFrom(a)).toEqual([]);
    await c.sessionEnd({ date: "2026-08-26", budgetBytes: 9000 });
    const day = c.store.edgesFrom(a)[0]?.last_day ?? -1;
    expect(c.associate.weightAt(a, b, day)).toBeCloseTo(c.associate.tunables.HEBB_RATE, 10);
    expect(c.associate.weightAt(b, a, day)).toBeCloseTo(c.associate.tunables.HEBB_RATE, 10);
    // Shown and not named: no link.
    expect(c.associate.weightAt(a, z)).toBe(0);
  });

  test("one named memory has no pair; a memory opened earlier today still joins the pair set (the credit pass's own rule)", async () => {
    const { c, ids } = setup(3);
    const [a, b, z] = ids as [string, string, string];
    shown(c, "s1", 1, [a, b, z]);
    expect(c.creditDrewOn("s1", [a]).linked).toBe(0);
    // Opened first: credited above the engaged tier, so refused here — and still drawn on with z.
    expect(c.resolveUse("s1", b, "referenced").credited).toBe(true);
    const r = c.creditDrewOn("s1", [b, z]);
    expect(r.credited).toEqual([z]);
    expect(r.refused.map((x) => x.reason)).toEqual(["already-credited-at-or-above"]);
    expect(r.linked).toBe(1);
    await c.sessionEnd({ date: "2026-08-26", budgetBytes: 9000 });
    expect(c.associate.linked(b, z)).toBe(true);
    expect(c.associate.linked(a, b)).toBe(false);
  });

  test("naming twenty memories it had already opened sends at most DREW_ON_MAX_PER_BOUNDARY members' pairs, not 190", () => {
    const { c, ids } = setup(20);
    shown(c, "s1", 1, ids);
    for (const id of ids) expect(c.resolveUse("s1", id, "referenced").credited).toBe(true);
    const r = c.creditDrewOn("s1", ids);
    // None credited (each was opened first), so no slot was spent — and still a bounded pair set.
    expect(r.credited).toEqual([]);
    expect(r.linked).toBe(3);
  });

  test("a refused id (never shown) joins nothing, and the observer deposits nothing", () => {
    const { c, ids } = setup(3);
    const [a, b, z] = ids as [string, string, string];
    shown(c, "s1", 1, [a]);
    expect(c.creditDrewOn("s1", [a, b]).linked).toBe(0);
    c.close();
    open.splice(0);
    const watcher = brain({ observer: true });
    expect(watcher.creditDrewOn("s1", [a, z]).linked).toBe(0);
  });

  test("the drewOn credit row says how many pairs it sent", async () => {
    const s = server();
    const ids = seeded(s);
    await s.call("session_end", { memories: [], drewOn: ids });
    const [row] = drewOnRows(s);
    expect(row?.["linked"]).toBe(1);
  });
});
