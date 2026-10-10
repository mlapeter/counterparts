/**
 * The adversarial review of PR #284 (2026-09-29,
 * `docs/adversarial-review-pr284-2026-09-29.md`), as regression tests — the
 * reviewer's probes, turned into assertions of the fixed behaviour. Hermetic:
 * a fresh temp data dir per test, removed after it.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { mechanismEvidence } from "../src/adapters/mechanism-evidence.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { CONTRADICTION_TUNABLES, flag, settle, undo } from "../src/core/contradictions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { MIND_SEEN_PREFIX, mindRanked } from "../src/core/dream/mind.js";
import { TUNABLES, pruneVerdict, strength } from "../src/core/physics/index.js";
import { Self, hintReading } from "../src/core/self/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { SCHEMA_VERSION, Store, paths } from "../src/core/store/index.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";
import { stripV13 } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let root: string;
let dir: string;
let prior: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  prior = process.env[ENV];
  root = mkdtempSync(join(tmpdir(), "counterparts-review284-"));
  dir = join(root, "store");
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* closed */
    }
  }
  if (prior === undefined) delete process.env[ENV];
  else process.env[ENV] = prior;
  rmSync(root, { recursive: true, force: true });
});

function days(store: Store, n: number, start = "2026-09-01"): void {
  const d0 = new Date(`${start}T12:00:00Z`).getTime();
  for (let i = 0; i < n; i++) store.advanceClock(new Date(d0 + i * 86_400_000).toISOString().slice(0, 10));
}

function put(store: Store, body: string, sal = { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, extra: Record<string, unknown> = {}): string {
  const day = store.livedDay();
  return store.put({ type: "memory", kind: "fact", body, salience: sal, physics: { birthDay: day, lastUsedDay: day }, ...extra } as never);
}

function server(session: string): McpServer {
  const s = openServer({ dir, session, scope: "/scope/one", owner: true, snapshotsDir: join(root, "snaps") } as never);
  open.push(s.counterpart);
  return s;
}

function storeOnly(): Store {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps") });
  open.push(s);
  return s;
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

describe("B1: the changed cut is a strength multiplier", () => {
  test("P-A: read by id, write a changed note, the Stop credits the read — the memory ends WEAKER than before, still faded", async () => {
    const s = server("sessA");
    const store = s.counterpart.store;
    days(store, 4);
    const old = put(store, "I build every frontend in React, it is my default framework.");
    days(store, 3, "2026-09-10");
    const d = store.livedDay();
    const s0 = strength(store.physicsOf(old), d);
    await s.call("recall", { ids: [old] });
    await s.call("note", { text: "I used to build everything in React; now Vue is my default.", updates: old, how: "changed" });
    s.counterpart.creditReferences("sessA", { assistantTurns: ["ok, Vue now."], expansions: [old] });
    const p2 = store.physicsOf(old);
    expect(p2.fade).toBe(0.5);
    expect(strength(p2, d)).toBeLessThan(s0);
  });

  test("P-A2: one credited occasion per memory per lived day still holds across a settle", () => {
    const c = Counterpart.open({ dir, owner: true });
    open.push(c);
    const store = c.store;
    days(store, 4);
    const old = put(store, "The staging database is Postgres 14 on the old cluster.");
    const neu = put(store, "The staging database is Postgres 16 on the new cluster.");
    days(store, 2, "2026-09-10");
    c.creditReferences("sessB1", { assistantTurns: [], expansions: [old] });
    const p0 = store.physicsOf(old);
    settle(store, { holds: neu, over: old, how: "changed", actor: "session", actorId: "sessB1" });
    c.creditReferences("sessB2", { assistantTurns: [], expansions: [old] });
    const p2 = store.physicsOf(old);
    expect(p2.reinforcedDays).toBe(p0.reinforcedDays);
    expect(p2.uses).toBe(p0.uses);
    expect(p2.lastUsedDay).toBe(p0.lastUsedDay);
  });

  test("S1 (P-B2): an old weak memory settled changed is not archived the next night — the dwell is the real one", () => {
    const store = storeOnly();
    days(store, 2);
    const old = put(store, "The office printer on floor two jams on duplex.", { relevance: 0.1, emotional: 0, predictive: 0.1 }, { claimed: 0.1 });
    // Ten lived days: inside the 14-day dwell (2026-10-10; it was 60 inside 90).
    days(store, 10, "2026-09-10");
    const d = store.livedDay();
    const lastUsed = store.physicsOf(old).lastUsedDay;
    const neu = put(store, "The floor-two printer was replaced; duplex works now.");
    expect(settle(store, { holds: neu, over: old, how: "changed", actor: "session" }).ok).toBe(true);
    const po = store.physicsOf(old);
    expect(po.lastUsedDay).toBe(lastUsed);
    expect(d - po.lastUsedDay).toBeLessThan(TUNABLES.D_FLOOR_DAYS);
    expect(pruneVerdict(po, d + 1, { inLiveRevisionChain: false }).prune).toBe(false);
    runCycle({ store, date: "2026-11-10" });
    expect(store.row(old)?.archived).toBe(0);
  });

  test("S2: no impossible history — the last use stays at or after birth, never negative", () => {
    const store = storeOnly();
    days(store, 8);
    const old = put(store, "Mike's standup is at 9am.", { relevance: 0.9, emotional: 0.3, predictive: 0.9 });
    const neu = put(store, "Mike's standup moved to 10am.");
    settle(store, { holds: neu, over: old, how: "changed", actor: "session" });
    const p = store.physicsOf(old);
    expect(p.lastUsedDay).toBeGreaterThanOrEqual(p.birthDay);
    expect(p.lastUsedDay).toBeGreaterThanOrEqual(0);
  });

  test("the v10 upgrade adds the column, 1 on every row, and a fresh store and a migrated one have the same columns", () => {
    const s = storeOnly();
    const id = put(s, "A memory the upgrade finds.");
    s.close();
    open.splice(0);
    const db = new Database(paths.operational(dir));
    db.run("DROP TABLE contradictions");
    db.run("DROP TABLE contradiction_settles");
    // v12's columns came after `fade`; a real v9 file has neither, so they go too
    // — and v13's (2026-10-10).
    stripV13(db);
    for (const c of ["status", "said_by", "occurred_on"]) db.run(`ALTER TABLE memories DROP COLUMN ${c}`);
    db.run("ALTER TABLE memories DROP COLUMN fade");
    db.run("UPDATE meta SET value = '9' WHERE key = 'schemaVersion'");
    db.close();
    const after = storeOnly();
    expect(after.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(after.physicsOf(id).fade).toBe(1);
    after.close();
    open.splice(0);
    const migrated = new Database(paths.operational(dir), { readonly: true });
    const cols = (d: Database): string => JSON.stringify(d.query("PRAGMA table_info(memories)").all());
    const migratedCols = cols(migrated);
    migrated.close();
    const freshDir = join(root, "fresh");
    const fresh = Store.open({ dir: freshDir, snapshotsDir: join(root, "snaps2") });
    fresh.close();
    const f = new Database(paths.operational(freshDir), { readonly: true });
    expect(cols(f)).toBe(migratedCols);
    f.close();
  });
});

describe("S3: the wake's lanes show a memory's standing, and the hints ranking sees the fade", () => {
  test("hintReading's organic score carries the fade even for a memory shown before", () => {
    const store = storeOnly();
    days(store, 8);
    const d = store.livedDay();
    const old = put(store, "Mike's standup is at 9am.", { relevance: 0.9, emotional: 0.3, predictive: 0.9 });
    const neu = put(store, "Mike's standup moved to 10am.");
    const before = store.physicsOf(old);
    settle(store, { holds: neu, over: old, how: "changed", actor: "session" });
    const display = { lane: "hints", load: 0, shown_day: d, closed_day: d, ever_uses: 0, ever_last_used: d } as never;
    const t = { HINT_STEP: 1, HINT_RECOVERY_DAYS: 7, HINT_HABITUATION: 1 };
    const withCut = hintReading(store.physicsOf(old), display, d + 1, t);
    const noCut = hintReading(before, display, d + 1, t);
    expect(withCut.organic).toBeCloseTo(noCut.organic * 0.5, 6);
  });

  test("threads and identity lines carry the label: Unsettled on the older of a flagged pair, disagrees-with on a core memory held open", () => {
    const store = storeOnly();
    days(store, 3);
    const older = put(store, "Open loop: the deploy freeze starts on the 20th.", { relevance: 0.8, emotional: 0.4, predictive: 0.8 }, { meta: { unresolved: true } });
    const newer = put(store, "The deploy freeze starts on the 22nd.");
    flag(store, { x: older, y: newer, source: "dream" });
    const core = put(store, "I say what I do not know before I guess.", { relevance: 0.9, emotional: 0.6, predictive: 0.9 }, { kind: "self" });
    store.updatePhysics(core, { promotedIdentity: true });
    store.setBand(core, "identity", store.livedDay());
    const other = put(store, "I guess first and check later.", { relevance: 0.5, emotional: 0.2, predictive: 0.5 }, { kind: "self" });
    expect(settle(store, { holds: other, over: core, how: "open", actor: "owner" }).ok).toBe(true);
    const me = new Self({ store });
    const text = me.boundary({ budgetBytes: 9_000, day: store.livedDay() }).briefing.text;
    expect(text).toContain(`Unsettled — may be out of date, see [${newer}]: `);
    expect(text).toContain(`(disagrees with [${other}])`);
  });
});

describe("S4: undo is exact when one memory is changed twice, in any order", () => {
  for (const order of ["first-then-second", "second-then-first"] as const) {
    test(order, () => {
      const store = storeOnly();
      days(store, 4);
      const x = put(store, "The launch is in October.");
      const y = put(store, "The launch is in November.");
      const z = put(store, "The launch is in December.");
      const s1 = settle(store, { holds: y, over: x, how: "changed", actor: "owner" });
      const s2 = settle(store, { holds: z, over: x, how: "changed", actor: "owner" });
      expect(store.physicsOf(x).fade).toBe(0.25);
      const ids = [s1.ok ? s1.pair : "", s2.ok ? s2.pair : ""];
      const seq = order === "first-then-second" ? ids : [...ids].reverse();
      expect(undo(store, { pair: seq[0] as string, actor: "owner" }).ok).toBe(true);
      expect(store.physicsOf(x).fade).toBe(0.5);
      expect(undo(store, { pair: seq[1] as string, actor: "owner" }).ok).toBe(true);
      expect(store.physicsOf(x).fade).toBe(1);
    });
  }
});

describe("S5: undoing a settle nobody flagged withdraws the pair", () => {
  test("P-D2: an undone write-time settle leaves no label, no raise and nothing on my mind", async () => {
    const s = server("sessD");
    const store = s.counterpart.store;
    days(store, 4);
    const old = put(store, "My editor is VS Code.");
    const r = payload(await s.call("note", { text: "I switched my editor to Zed.", updates: old, how: "changed" }));
    const pairId = String((r["settled"] as Record<string, unknown>)["pair"]);
    const u = undo(store, { pair: pairId, actor: "owner", why: "not a change, just more detail" });
    expect(u.ok && u.state).toBe("withdrawn");
    expect(store.contradiction(pairId)?.state).toBe("withdrawn");
    const rec = payload(await s.call("recall", { ids: [old] }));
    expect((rec["memories"] as Record<string, unknown>[])[0]?.["standing"]).toBeUndefined();
    expect(s.counterpart.dreams.raiseLines({ session: "next" })).toEqual([]);
    const mind = mindRanked(store, { today: store.today(), day: store.livedDay(), showable: () => true, owner: true });
    expect(mind.items.some((i) => i.kind === "unsettled")).toBe(false);
  });

  test("M5: a flag reopened by an undo starts fresh on my mind", () => {
    const store = storeOnly();
    days(store, 4);
    const a = put(store, "Standup is at nine.");
    const b = put(store, "Standup is at ten.");
    const f = flag(store, { x: a, y: b, source: "dream" });
    const pairId = f.ok ? f.pair : "";
    store.setMeta(`${MIND_SEEN_PREFIX}${pairId}`, JSON.stringify({ times: 3, day: store.livedDay() }));
    const out = settle(store, { pair: pairId, holds: b, how: "changed", actor: "owner" });
    expect(out.ok).toBe(true);
    const u = undo(store, { pair: pairId, actor: "owner" });
    expect(u.ok && u.state).toBe("unsettled");
    expect((JSON.parse(store.getMeta(`${MIND_SEEN_PREFIX}${pairId}`) ?? "{}") as { times: number }).times).toBe(0);
  });
});

describe("S6: removing the correcting memory does not strand the corrected one", () => {
  function remove(store: Store, id: string): void {
    store.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "test" });
    store.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(store, id);
  }

  test("corrected: the survivor comes back into recall; changed: its fade comes back; a flag the settle closed is a question again", () => {
    const store = storeOnly();
    days(store, 4);
    const wrong = put(store, "The capital office is in Lisbon.");
    const right = put(store, "The capital office is in Porto.");
    const c = settle(store, { holds: right, over: wrong, how: "corrected", actor: "owner" });
    expect(c.ok).toBe(true);
    const earlier = put(store, "The build takes eight minutes.");
    const later = put(store, "The build takes eleven minutes.");
    const f = flag(store, { x: earlier, y: later, source: "dream" });
    const flagId = f.ok ? f.pair : "";
    const third = put(store, "The build takes eleven minutes now, up from eight.");
    const ch = settle(store, { holds: third, over: earlier, how: "changed", actor: "session", actorId: "s1" }, { closeFlags: true });
    expect(ch.ok && ch.closed).toEqual([flagId]);
    remove(store, right);
    remove(store, third);
    expect(store.row(wrong)?.archived).toBe(0);
    expect(store.search("capital office Lisbon", 5).map((h) => h.id)).toContain(wrong);
    expect(store.physicsOf(earlier).fade).toBe(1);
    const reopened = store.contradiction(flagId);
    expect(reopened?.state).toBe("unsettled");
    expect(reopened?.via).toBeNull();
  });
});

describe("the minors", () => {
  test("M1: a session_end entry never lists a sibling from the same call, and one call's neighbours are capped", async () => {
    const s = server("sessF");
    const store = s.counterpart.store;
    days(store, 4);
    const r = payload(
      await s.call("session_end", {
        session: "sessF",
        memories: [
          { content: "The Pine building office moved its rooftop garden hours to 7am-7pm." },
          { content: "The Pine building office rooftop garden now has a greenhouse too." },
        ],
      }),
    );
    const outcomes = r["outcomes"] as Record<string, unknown>[];
    const firstId = outcomes[0]?.["id"];
    const listed = (outcomes[1]?.["neighbours"] as Record<string, unknown>[] | undefined) ?? [];
    expect(listed.map((n) => n["id"])).not.toContain(firstId);
    expect(CONTRADICTION_TUNABLES.NEIGHBOURS_PER_CALL).toBeGreaterThan(0);
  });

  test("M1: a long dump shares the cap", async () => {
    const s = server("sessCap");
    const store = s.counterpart.store;
    days(store, 4);
    for (let i = 0; i < 6; i += 1) put(store, `The orchid greenhouse note number ${String(i)} about watering the zygomorphic orchids weekly.`);
    const memories = Array.from({ length: 8 }, (_, i) => ({ content: `Zygomorphic orchid watering: greenhouse observation ${String(i)} says weekly watering suits them.` }));
    const r = payload(await s.call("session_end", { session: "sessCap", memories }));
    const total = (r["outcomes"] as Record<string, unknown>[]).reduce((n, o) => n + ((o["neighbours"] as unknown[] | undefined)?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(CONTRADICTION_TUNABLES.NEIGHBOURS_PER_CALL);
  });

  test("M2: a refused note beside a settle that landed is not an error", async () => {
    const s = server("sessM2");
    const store = s.counterpart.store;
    days(store, 4);
    const a = put(store, "Retro is on Fridays.");
    const b = put(store, "Retro is on Thursdays.");
    const text = "Retro moved from Fridays to Thursdays this sprint.";
    await s.call("note", { text });
    const dup = await s.call("note", { text, settle: { holds: b, over: a, how: "changed", why: "moved" } });
    expect(payload(dup)["stored"]).toBe(false);
    expect((payload(dup)["settle"] as Record<string, unknown>)["ok"]).toBe(true);
    expect(dup.isError ?? false).toBe(false);
  });

  test("M3: a session told a pair is already settled is pointed at the owner, not at a console it cannot run", () => {
    const store = storeOnly();
    days(store, 4);
    const a = put(store, "Lunch is at noon.");
    const b = put(store, "Lunch is at one.");
    expect(settle(store, { holds: b, over: a, how: "changed", actor: "owner" }).ok).toBe(true);
    const again = settle(store, { holds: b, over: a, how: "corrected", actor: "session", actorId: "s1" });
    expect(again.ok ? "" : again.detail).toContain("tell the owner");
    const owner = settle(store, { holds: b, over: a, how: "corrected", actor: "owner" });
    expect(owner.ok ? "" : owner.detail).toContain("Undo it first");
  });

  test("M6: the v10 carry counts a pair raised when a LATER flag of it was raised", () => {
    const s = storeOnly();
    days(s, 4);
    const a = put(s, "Upkeep is 8 food.");
    const b = put(s, "Upkeep is 16 food.");
    for (const id of ["drm_one", "drm_two"]) {
      s.openDream({ id, day: s.livedDay(), date: "2026-09-04" });
      s.recordDreamChange(id, { action: "contradiction", ref: a, ref2: b });
      s.updateDream(id, { state: "journaled" });
    }
    s.setMeta("dream.raised.drm_two.1", "4");
    s.close();
    open.splice(0);
    const db = new Database(paths.operational(dir));
    db.run("DROP TABLE contradictions");
    db.run("DROP TABLE contradiction_settles");
    // v12's columns came after `fade`; a real v9 file has neither, so they go too
    // — and v13's (2026-10-10).
    stripV13(db);
    for (const c of ["status", "said_by", "occurred_on"]) db.run(`ALTER TABLE memories DROP COLUMN ${c}`);
    db.run("ALTER TABLE memories DROP COLUMN fade");
    db.run("UPDATE meta SET value = '9' WHERE key = 'schemaVersion'");
    db.close();
    const after = storeOnly();
    expect(after.contradictions()).toHaveLength(1);
    expect(after.contradictionBetween(a, b)?.raised_day).toBe(4);
  });

  test("M9: a how sent at a core memory records the pair unsettled while pressure builds, and recall labels it", async () => {
    const s = server("sessM9");
    const store = s.counterpart.store;
    days(store, 4);
    const core = put(store, "Mike works at Google.", { relevance: 0.9, emotional: 0.5, predictive: 0.9 }, { kind: "person" });
    store.updatePhysics(core, { promotedIdentity: true });
    store.setBand(core, "identity", store.livedDay());
    const r = payload(await s.call("note", { text: "Mike works at Meta; I had Google wrong.", updates: core, how: "corrected" }));
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled["applied"]).toBe(false);
    expect(String(settled["detail"])).toContain("recorded unsettled");
    expect(store.row(core)?.archived).toBe(0);
    const pair = store.contradictionBetween(core, String(r["id"]));
    expect(pair?.state).toBe("unsettled");
    expect(pair?.source).toBe("pressure");
    expect(pair?.raised_day).not.toBeNull();
    const rec = payload(await s.call("recall", { ids: [core] }));
    expect(String((rec["memories"] as Record<string, unknown>[])[0]?.["standing"])).toContain("unsettled");
  });
});

describe("the mechanism table", () => {
  function io(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
  }

  test("reconsolidation is built; interference is partly built, and a changed settle lights it", async () => {
    const store = storeOnly();
    days(store, 4);
    const day = store.livedDay();
    const a = put(store, "The router is in the hall.");
    const b = put(store, "The router is in the study.");
    settle(store, { holds: b, over: a, how: "changed", actor: "owner" });
    const v = mechanismEvidence(store, { sinceDay: day - 6, today: day }).verdicts;
    expect(v.find((x) => x.id === "reconsolidation")?.build).toBe("built");
    const inter = v.find((x) => x.id === "interference");
    expect(inter?.build).toBe("partly");
    expect(inter?.fired).toBe(true);
    expect(inter?.parts.find((p) => p.key === "faded")?.count).toBe(1);
    store.close();
    open.splice(0);
    const said = io();
    await run(["mechanisms", "--dir", dir], { io: said.io });
    const line = said.out.find((l) => l.includes("Interference")) ?? "";
    expect(line).toContain("partly built");
    expect(line).not.toContain("not built");
  });
});
