/**
 * CONTRADICTIONS as a mechanism (2026-09-29) — `core/contradictions.ts`, the
 * ordinary-memory arm of `core/revision.ts`, schema v10's `contradictions` and
 * `contradiction_settles`, and the MCP doors that reach them.
 *
 * The three kinds end to end (changed fades once and stays recallable,
 * corrected archives and stays readable by id, open keeps both); settling a
 * pair that already exists; undo; the trail. Hermetic: a fresh temp data dir
 * per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contradictionFindings, upgradeV10Findings } from "../src/adapters/claude-code/doctor.js";
import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { mechanismEvidence } from "../src/adapters/mechanism-evidence.js";
import type { Verdict } from "../src/adapters/mechanism-evidence.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Recall, render } from "../src/core/recall/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  CONTRADICTION_SETTLED_EVENT,
  CORRECTED_REASON,
  NEIGHBOURS_HINT,
  flag,
  settle,
  undo,
  writeNeighbours,
} from "../src/core/contradictions.js";
import { changedFade, creditUse, strength, unfade } from "../src/core/physics/index.js";
import { applyRevision } from "../src/core/revision.js";
import { Store, V10_UPGRADE_KEY } from "../src/core/store/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const SESSION = "sess_contradictions";

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-contradictions-"));
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

function server(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", owner: true, ...opts });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** A store a few lived days in, so a new memory is not born on day 0. */
function aged(store: Store): number {
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
  return store.livedDay();
}

function put(store: Store, body: string, extra: Partial<Parameters<Store["put"]>[0]> = {}): string {
  const day = store.livedDay();
  return store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...extra,
  });
}

function strengthOf(store: Store, id: string): number {
  return strength(store.physicsOf(id), store.livedDay());
}

describe("the three kinds, written as a new memory with updates + how", () => {
  test("changed: the old memory takes one strength cut through physics, stays live and recallable; the pair and the trail say who", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const old = put(store, "I build every frontend in React, it is my default framework.");
    const before = strengthOf(store, old);
    const lastUsed = store.physicsOf(old).lastUsedDay;
    const r = payload(
      await s.call("note", {
        text: "I used to build everything in React; now Vue is my default framework for frontends.",
        updates: old,
        how: "changed",
      }),
    );
    expect(r["stored"]).toBe(true);
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled["ok"]).toBe(true);
    expect(settled["how"]).toBe("changed");
    expect(settled["over"]).toBe(old);
    // One cut, half, through physics: a multiplier on strength. The last use
    // (and so the prune's dwell and the history) is untouched (review of #284, B1).
    const after = strengthOf(store, old);
    expect(after).toBeCloseTo(before * 0.5, 6);
    expect(store.physicsOf(old).fade).toBe(0.5);
    expect(store.physicsOf(old).lastUsedDay).toBe(lastUsed);
    // Still live, still indexed.
    const row = store.row(old);
    expect(row?.archived).toBe(0);
    expect(row?.superseded_by).toBeNull();
    expect(store.search("React default framework", 5).map((h) => h.id)).toContain(old);
    // The pair and the trail.
    const pair = store.contradiction(String(settled["pair"]));
    expect(pair?.state).toBe("settled");
    expect(pair?.how).toBe("changed");
    expect(pair?.holds).toBe(String(r["id"]));
    expect(pair?.over).toBe(old);
    expect(pair?.source).toBe("write");
    const trail = store.contradictionSettles({ pairId: pair?.id as string });
    expect(trail).toHaveLength(1);
    expect(trail[0]?.actor).toBe("session");
    expect(trail[0]?.actor_id).toBe(SESSION);
    expect(trail[0]?.how).toBe("changed");
    // A durable event, ids only.
    expect(store.eventLog({ name: CONTRADICTION_SETTLED_EVENT }).length).toBe(1);
  });

  test("changed is the default when `how` is left out", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const old = put(store, "The team standup happens at nine every morning.");
    const r = payload(await s.call("note", { text: "The team standup moved from nine to ten in the morning.", updates: old }));
    expect((r["settled"] as Record<string, unknown>)["how"]).toBe("changed");
    expect(store.contradictionBetween(old, String(r["id"]))?.how).toBe("changed");
  });

  test("corrected: the wrong one is archived `corrected` — out of recall and search, readable by its own id, never deleted", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const old = put(store, "Dana works at Google on the search team.");
    const r = payload(
      await s.call("note", { text: "Dana works at Meta, not Google — I had it wrong.", updates: old, how: "corrected" }),
    );
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled["how"]).toBe("corrected");
    expect(settled["archived"]).toBe(old);
    const row = store.row(old);
    expect(row?.archived).toBe(1);
    expect(row?.archived_reason).toBe(CORRECTED_REASON);
    expect(row?.superseded_by).toBeNull();
    expect(row?.body).toContain("Google");
    expect(store.search("Dana Google search team", 5).map((h) => h.id)).not.toContain(old);
    // Readable by id: the handle path shows THAT memory, with who corrected it.
    const got = payload(await s.call("recall", { handle: old }));
    const memories = got["memories"] as Record<string, unknown>[];
    expect(memories[0]?.["id"]).toBe(old);
    expect(String(memories[0]?.["excerpt"])).toContain("Google");
    expect(String(memories[0]?.["standing"])).toContain(`corrected by ${String(r["id"])}`);
  });

  test("open: both stay live, and the pair is recorded open", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const old = put(store, "Tabs are the right indentation for this codebase.");
    const before = strengthOf(store, old);
    const r = payload(
      await s.call("note", { text: "Spaces are the right indentation for this codebase; we still disagree.", updates: old, how: "open" }),
    );
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled["how"]).toBe("open");
    expect(settled["with"]).toBe(old);
    expect(store.row(old)?.archived).toBe(0);
    expect(strengthOf(store, old)).toBeCloseTo(before, 6);
    const pair = store.contradictionBetween(old, String(r["id"]));
    expect(pair?.how).toBe("open");
    expect(pair?.holds).toBeNull();
    expect(pair?.over).toBeNull();
  });

  test("an unknown how is refused by name, and nothing is stored", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const old = put(store, "The deploy runs on Fridays.");
    const r = payload(await s.call("note", { text: "The deploy runs on Tuesdays now.", updates: old, how: "sideways" }));
    expect(r["stored"]).toBe(false);
    expect(r["reason"]).toBe("malformed");
  });

  test("session_end entries settle the same way, each on its own", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const a = put(store, "The office is on the third floor of the Pine building.");
    const b = put(store, "The build takes eight minutes on the old runners.");
    const r = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "The office moved from the third floor to the fifth floor of the Pine building.", updates: a, how: "changed" },
          { content: "The build takes eleven minutes, not eight — I misread the old logs.", updates: b, how: "corrected" },
        ],
      }),
    );
    const outcomes = r["outcomes"] as Record<string, unknown>[];
    expect((outcomes[0]?.["settled"] as Record<string, unknown>)["how"]).toBe("changed");
    expect((outcomes[1]?.["settled"] as Record<string, unknown>)["how"]).toBe("corrected");
    expect(store.row(b)?.archived_reason).toBe(CORRECTED_REASON);
    expect(store.row(a)?.archived).toBe(0);
  });

  test("a protected memory keeps its own path; a sent how says it was not applied", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const guarded = put(store, "The owner's birthday is in March.");
    store.updatePhysics(guarded, { protected: true });
    const r = payload(await s.call("note", { text: "The owner's birthday is in April.", updates: guarded, how: "corrected" }));
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled["applied"]).toBe(false);
    expect(String(settled["detail"])).toContain("protected");
    expect(store.row(guarded)?.archived).toBe(0);
    expect(store.contradictions()).toHaveLength(0);
  });

  test("a swept declaration (no how) stays a link, as before", () => {
    const c = Counterpart.open({ dir, owner: true });
    open.push(c);
    const store = c.store;
    aged(store);
    const old = put(store, "The cat is called Miso.");
    const neu = put(store, "The cat is called Mochi.");
    const out = applyRevision(store, c.schemas, { updates: old, challengerId: neu, day: store.livedDay(), method: "id" });
    expect(out.path).toBe("link-only");
    expect(store.contradictions()).toHaveLength(0);
  });
});

describe("settling a pair that already exists", () => {
  test("note with settle and no text: a flagged pair settles, rewrites no body, and the trail keeps the why", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const a = put(store, "Tiny Castles upkeep is 8 food a day per spearman.");
    const b = put(store, "Tiny Castles upkeep is 16 food a day per spearman.");
    const flagged = flag(store, { x: b, y: a, source: "dream" });
    expect(flagged.ok).toBe(true);
    const pairId = flagged.ok ? flagged.pair : "";
    expect(store.contradiction(pairId)?.a).toBe(a);
    const bodyA = store.row(a)?.body;
    const bodyB = store.row(b)?.body;
    const r = payload(
      await s.call("note", { settle: { pair: pairId, holds: b, how: "corrected", why: "The patch notes say 16." } }),
    );
    expect(r["reason"]).toBe("settle-only");
    const out = r["settle"] as Record<string, unknown>;
    expect(out["ok"]).toBe(true);
    expect(out["archived"]).toBe(a);
    expect(store.row(a)?.body).toBe(bodyA as string);
    expect(store.row(b)?.body).toBe(bodyB as string);
    expect(store.row(b)?.superseded_by).toBeNull();
    const trail = store.contradictionSettles({ pairId });
    expect(trail[0]?.why).toBe("The patch notes say 16.");
    expect(trail[0]?.actor_id).toBe(SESSION);
    // Settled once; a second settle is refused and says how to undo.
    const again = payload(await s.call("note", { settle: { pair: pairId, holds: b, how: "changed" } }));
    expect((again["settle"] as Record<string, unknown>)["reason"]).toBe("already-settled");
  });

  test("two memories by holds and over, with no pair yet: a settled pair is written", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    const a = put(store, "Lunch is at noon.");
    const b = put(store, "Lunch is at one.");
    const out = settle(store, { holds: b, over: a, how: "changed", why: "moved", actor: "owner" });
    expect(out.ok).toBe(true);
    const pair = store.contradictionBetween(a, b);
    expect(pair?.state).toBe("settled");
    expect(pair?.source).toBe("settle");
  });

  test("refusals: a protected memory cannot be changed or corrected, a core one takes pressure, and both can be open", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    const a = put(store, "I prefer mornings for deep work.");
    const b = put(store, "I prefer evenings for deep work.");
    store.updatePhysics(a, { protected: true });
    const p = settle(store, { holds: b, over: a, how: "corrected", actor: "owner" });
    expect(p.ok ? "ok" : p.reason).toBe("protected");
    const c = put(store, "I say what I do not know before I guess.", { kind: "self" });
    const d = put(store, "I guess first and check later.", { kind: "self" });
    store.updatePhysics(c, { promotedIdentity: true });
    const q = settle(store, { holds: d, over: c, how: "changed", actor: "owner" });
    expect(q.ok ? "ok" : q.reason).toBe("core-takes-pressure");
    const o = settle(store, { holds: d, over: c, how: "open", actor: "owner" });
    expect(o.ok).toBe(true);
  });

  test("an observer writes nothing, and the refusal says so", () => {
    const w = Store.open({ dir });
    aged(w);
    const a = put(w, "Alpha is the codename.");
    const b = put(w, "Beta is the codename.");
    w.close();
    const obs = Store.open({ dir, observer: true });
    open.push(obs);
    const out = settle(obs, { holds: b, over: a, how: "changed", actor: "owner" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("observer");
      expect(out.detail).toContain("Nothing was settled");
    }
  });
});

describe("undo", () => {
  test("changed: the fade is divided back out; a pair nobody flagged is WITHDRAWN, not left as a question (S5)", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    const a = put(store, "The API rate limit is 100 per minute.");
    const b = put(store, "The API rate limit is 300 per minute.");
    const before = store.physicsOf(a).lastUsedDay;
    const out = settle(store, { holds: b, over: a, how: "changed", actor: "session", actorId: "s1" });
    expect(out.ok).toBe(true);
    expect(store.physicsOf(a).fade).toBe(0.5);
    const u = undo(store, { pair: out.ok ? out.pair : "", actor: "owner", why: "not a change" });
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.restored).toBe(a);
      expect(u.state).toBe("withdrawn");
    }
    expect(store.physicsOf(a).fade).toBe(1);
    expect(store.physicsOf(a).lastUsedDay).toBe(before);
    const pairId = out.ok ? out.pair : "";
    const pair = store.contradiction(pairId);
    expect(pair?.state).toBe("withdrawn");
    expect(store.contradictionBetween(a, b)).toBeUndefined();
    const trail = store.contradictionSettles({ pairId });
    expect(trail.map((t) => t.action)).toEqual(["settle", "undo"]);
    expect(trail[0]?.undone).toBe(1);
    expect(trail[1]?.actor).toBe("owner");
  });

  test("changed, then used: a use resets decay and leaves the fade alone; an undo divides the fade out and keeps the use", () => {
    const store = Store.open({ dir });
    open.push(store);
    const day0 = aged(store);
    const a = put(store, "The staging database is Postgres 14.");
    const b = put(store, "The staging database is Postgres 16.");
    const out = settle(store, { holds: b, over: a, how: "changed", actor: "owner" });
    expect(out.ok).toBe(true);
    store.advanceClock("2026-09-05");
    const d = store.livedDay();
    expect(d).toBeGreaterThan(day0);
    const cut = strength(store.physicsOf(a), d);
    const credit = creditUse(store.physicsOf(a), d, "referenced");
    expect(credit.credited).toBe(true);
    store.updatePhysics(a, credit.next);
    expect(strength(store.physicsOf(a), d)).toBeGreaterThanOrEqual(cut);
    expect(store.physicsOf(a).fade).toBe(0.5);
    const u = undo(store, { pair: out.ok ? out.pair : "", actor: "owner" });
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.restored).toBe(a);
    expect(store.physicsOf(a).fade).toBe(1);
    expect(store.physicsOf(a).lastUsedDay).toBe(d);
  });

  test("corrected: the memory comes back into recall", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    const a = put(store, "The capital of the project is Lisbon office.");
    const b = put(store, "The project's main office is in Porto.");
    const out = settle(store, { holds: b, over: a, how: "corrected", actor: "owner" });
    expect(store.row(a)?.archived).toBe(1);
    const u = undo(store, { pair: out.ok ? out.pair : "", actor: "owner" });
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.unarchived).toBe(a);
    expect(store.row(a)?.archived).toBe(0);
    expect(store.search("Lisbon office", 5).map((h) => h.id)).toContain(a);
  });

  test("a write-time settle closes the flagged pair through itself; undoing it reopens that flag", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const a = put(store, "The launch date is October 3.");
    const b = put(store, "The launch date is October 10.");
    const f = flag(store, { x: a, y: b, source: "dream" });
    const flagId = f.ok ? f.pair : "";
    const r = payload(
      await s.call("note", { text: "The launch date moved from October 3 to October 10.", updates: a, how: "changed" }),
    );
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled["closedFlags"]).toEqual([flagId]);
    const closed = store.contradiction(flagId);
    expect(closed?.state).toBe("settled");
    expect(closed?.via).toBe(String(settled["pair"]));
    // Undo through the flag is refused by name; undo through the pair reopens it.
    const viaUndo = undo(store, { pair: flagId, actor: "owner" });
    expect(viaUndo.ok ? "ok" : viaUndo.reason).toBe("closed-through");
    const u = undo(store, { pair: String(settled["pair"]), actor: "owner" });
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.reopened).toEqual([flagId]);
    expect(store.contradiction(flagId)?.state).toBe("unsettled");
  });
});

describe("physics: the changed cut", () => {
  test("a multiplier: exactly the factor today and every later day, whatever the curve; stacks; none for a core memory", () => {
    const m = {
      kind: "fact" as const,
      salience: { novelty: null, relevance: 0.6, emotional: 0.2, predictive: 0.6, claimed: 0.6 },
      birthDay: 10,
      uses: 2,
      lastUsedDay: 20,
      reinforcedDays: 1,
      consolidated: false,
      promotedIdentity: false,
      protected: false,
      pressure: 0,
      lastChallengedDay: null,
    };
    for (const shape of ["exponential", "power-law", "flat"] as const) {
      const out = changedFade(m, 25, 0.5, shape);
      expect(out).not.toBeNull();
      if (out === null) continue;
      expect(out.fade).toBe(0.5);
      expect(out.after / out.before).toBeCloseTo(0.5, 9);
      for (const later of [30, 60, 120]) {
        expect(strength({ ...m, fade: out.fade }, later, shape) / strength(m, later, shape)).toBeCloseTo(0.5, 9);
      }
    }
    const twice = changedFade({ ...m, fade: 0.5 }, 25);
    expect(twice?.fade).toBe(0.25);
    expect(unfade(unfade(0.25, 0.5), 0.5)).toBe(1);
    expect(changedFade({ ...m, promotedIdentity: true }, 25)).toBeNull();
  });
});

describe("noticing at write time", () => {
  test("a stored note comes back with its closest existing memories, in structuredContent, minus the one it updates", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const x = put(store, "The Pine building office has a rooftop garden and a small library.");
    const y = put(store, "The Pine building office rooftop garden is closed in winter.");
    put(store, "Bought hiking boots that finally fit properly.");
    const r = await s.call("note", { text: "The Pine building office rooftop garden now opens in winter too.", updates: y });
    const body = payload(r);
    const neighbours = body["neighbours"] as Record<string, unknown>[];
    expect(Array.isArray(neighbours)).toBe(true);
    expect(neighbours.map((n) => n["id"])).toContain(x);
    expect(neighbours.map((n) => n["id"])).not.toContain(y);
    expect(neighbours.length).toBeLessThanOrEqual(3);
    expect(typeof neighbours[0]?.["excerpt"]).toBe("string");
    expect(body["neighboursHint"]).toBe(NEIGHBOURS_HINT);
    // What Claude Code hands the model is the structured copy, serialized (#282).
    expect(JSON.stringify(r.structuredContent)).toContain(x);
  });

  test("nothing close, nothing listed; journal chapters, archived rows and a confidential memory outside the owner's session are left out", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    const secret = put(store, "The Pine building office door code changes monthly.", { meta: { confidential: true } });
    const archived = put(store, "The Pine building office door code is on the fridge.");
    store.archive(archived, "test");
    const id = put(store, "The Pine building office door code changed this month.");
    expect(writeNeighbours(store, { id, owner: false }).map((n) => n.id)).not.toContain(secret);
    expect(writeNeighbours(store, { id, owner: true }).map((n) => n.id)).toContain(secret);
    expect(writeNeighbours(store, { id, owner: true }).map((n) => n.id)).not.toContain(archived);
    const lone = put(store, "Quantum chromodynamics describes the strong interaction.");
    expect(writeNeighbours(store, { id: lone, owner: true })).toEqual([]);
  });
});

describe("the dream: a flag is a pair; a dream may settle with a reason; its undo takes back only what it did", () => {
  function lived(c: Counterpart): { a: string; b: string; c2: string } {
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    const at = { physics: { birthDay: day, lastUsedDay: day } };
    const mk = (body: string): string =>
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, ...at });
    return {
      a: mk("Tiny Castles upkeep is 8 food a day per spearman."),
      b: mk("Tiny Castles upkeep is 16 food a day per spearman."),
      c2: mk("The migration step must run before the container boots."),
    };
  }

  test("contradiction {a, b} writes an unsettled pair; it is raised once awake, by pair id; undoing the dream withdraws it", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    open.push(c);
    const m = lived(c);
    const begun = c.dreams.begin({ session: SESSION, scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.dream;
    const p = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "contradiction", a: m.b, b: m.a }] });
    expect(p.ok).toBe(true);
    const pair = c.store.contradictionBetween(m.a, m.b);
    expect(pair?.state).toBe("unsettled");
    expect(pair?.source).toBe("dream");
    expect(pair?.dream_id).toBe(id);
    const lines = c.dreams.raiseLines({ session: "s-next" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(pair?.id as string);
    expect(lines[0]).toContain("settle");
    expect(c.dreams.raiseLines({ session: "s-next" })).toEqual([]);
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    c.dreams.undo(id);
    expect(c.store.contradiction(pair?.id as string)?.state).toBe("withdrawn");
  });

  test("settle {holds, over, how, why}: the trail names the dream; without a why it is refused; an undo of the dream takes it back as dream-undo", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    open.push(c);
    const m = lived(c);
    const begun = c.dreams.begin({ session: SESSION, scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.dream;
    const bare = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "settle", holds: m.b, over: m.a, how: "corrected" }] });
    expect(bare.ok && bare.results[0]?.reason).toBe("why-required");
    const p = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [{ action: "settle", holds: m.b, over: m.a, how: "corrected", why: "The later patch note doubled it." }],
    });
    expect(p.ok && p.results[0]?.ok).toBe(true);
    const pair = c.store.contradictionBetween(m.a, m.b);
    expect(pair?.how).toBe("corrected");
    const trail = c.store.contradictionSettles({ pairId: pair?.id as string });
    expect(trail[0]?.actor).toBe("dream");
    expect(trail[0]?.actor_id).toBe(id);
    expect(c.store.row(m.a)?.archived_reason).toBe(CORRECTED_REASON);
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    c.dreams.undo(id);
    // Nobody had flagged the pair: the undo withdraws it rather than leaving a question (S5).
    expect(c.store.contradiction(pair?.id as string)?.state).toBe("withdrawn");
    expect(c.store.row(m.a)?.archived).toBe(0);
    // The trail says a dream's undo did it (M4).
    const undoRow = c.store.contradictionSettles({ pairId: pair?.id as string }).find((t) => t.action === "undo");
    expect(undoRow?.actor).toBe("dream-undo");
    expect(undoRow?.actor_id).toBe(id);
  });
});

describe("recall shows a memory's standing", () => {
  const FILLER = [
    "Ran the morning loop around the reservoir before breakfast.",
    "The tax filing deadline moved to October this year.",
    "Prefers dense espresso over filter coffee at home.",
    "The garage door opener needs a new battery soon.",
    "Rebasing keeps the history readable for reviewers.",
    "The neighbour's cat sits on the fence every evening.",
    "Bought hiking boots that finally fit properly.",
    "The library closes early on Sundays now.",
    "Wrote a short letter to an old teacher.",
    "The kitchen tap drips when the pressure is high.",
    "Set up a standing desk in the spare bedroom.",
    "The bus route changed and adds ten minutes.",
    "Started keeping receipts in one envelope.",
    "The printer jams on heavy paper stock.",
    "Planted three tomato seedlings in the planter.",
    "Fixed the wobbling chair leg with a shim.",
  ];

  test("render: the qualifier goes in front, outside the clip; the pointer after", () => {
    const out = render(
      { turn: 1, affectFlag: false, surfaced: ["mem_a"], footnotes: ["mem_b"], budgetBytes: 4_000, gistBytes: 20, titleBytes: 20, pressureRatio: 0.9 },
      (id) =>
        id === "mem_a"
          ? { title: "A", gist: "The upkeep is eight food a day per spearman in the castle.", standing: { prefix: "Unsettled — may be out of date, see [mem_b]: ", suffix: "" } }
          : { title: "The upkeep is sixteen", gist: "x", standing: { prefix: "", suffix: " (disagrees with [mem_c])" } },
    );
    expect(out.text).toContain("- Unsettled — may be out of date, see [mem_b]: The upkeep is");
    expect(out.text).toContain("[mem_b] (disagrees with [mem_c])");
  });

  test("ambient: the OLDER of an unsettled pair surfaces labelled unsettled; settled changed, it reads earlier", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    for (const body of FILLER) put(store, body);
    const older = put(store, "The zygomorphic orchid needs watering twice a week.");
    const newer = put(store, "The zygomorphic orchid needs watering once a week in autumn.");
    const f = flag(store, { x: older, y: newer, source: "dream" });
    const turn = "how often should the zygomorphic orchid get watering";
    const first = new Recall({ store, owner: true }).build({ sessionId: "r1", text: turn });
    expect(first.injection).toContain(`Unsettled — may be out of date, see [${newer}]`);
    const out = settle(store, { pair: f.ok ? f.pair : "", holds: newer, how: "changed", actor: "owner" });
    expect(out.ok).toBe(true);
    const second = new Recall({ store, owner: true }).build({ sessionId: "r2", text: turn });
    expect(second.injection).not.toContain("Unsettled");
    const says = second.injection;
    expect(says.includes(`Earlier (now [${newer}])`) || says.includes(`(earlier: [${older}])`)).toBe(true);
  });

  test("the question path carries the standing as a field; open pairs say who each disagrees with", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    for (const body of FILLER) put(store, body);
    const a = put(store, "Tabs are the right indentation for the quokka codebase.");
    const b = put(store, "Spaces are the right indentation for the quokka codebase.");
    settle(store, { holds: b, over: a, how: "open", actor: "owner" });
    // Facts mode (2026-10-03): the standing rides on the result's learned line.
    const got = payload(await s.call("recall", { question: "quokka codebase indentation", mode: "facts" }));
    const blocks = String(got["answer"]).split("\n\n");
    const blockOf = (id: string): string => blocks.find((x) => x.includes(` · ${id} · `)) ?? "";
    expect(blockOf(a)).toContain(`disagrees with ${b}`);
    expect(blockOf(b)).toContain(`disagrees with ${a}`);
    // Both still stand: each is CURRENT, neither folded under the other.
    expect(blockOf(a)).toContain("CURRENT");
    expect(blockOf(b)).toContain("CURRENT");
  });

  test("by id, a superseded row shows ITSELF, with replaced by — store.resolve still forwards", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const old = put(store, "The office wifi is called Harbor.");
    const next = store.supersede(old, { type: "memory", kind: "fact", body: "The office wifi is called Lighthouse." });
    expect(store.resolve(old)).toBe(next);
    const got = payload(await s.call("recall", { handle: old }));
    const memories = got["memories"] as Record<string, unknown>[];
    expect(memories[0]?.["id"]).toBe(old);
    expect(String(memories[0]?.["excerpt"])).toContain("Harbor");
    expect(String(memories[0]?.["standing"])).toContain(`replaced by ${next}`);
    const both = payload(await s.call("recall", { ids: [old, next] }));
    expect((both["memories"] as Record<string, unknown>[]).map((m) => m["id"])).toEqual([old, next]);
  });
});

describe("visible: the owner's settle, doctor's line, the mechanism's evidence", () => {
  function io(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
  }

  test("counterparts settle: lists what is unsettled, settles as the owner, undoes; an observer changes nothing", async () => {
    const w = Store.open({ dir });
    aged(w);
    const a = put(w, "The deploy freeze starts on the 20th.");
    const b = put(w, "The deploy freeze starts on the 22nd.");
    const f = flag(w, { x: a, y: b, source: "dream" });
    const pairId = f.ok ? f.pair : "";
    w.close();

    const list = io();
    expect(await run(["settle", "--dir", dir], { io: list.io })).toBe(0);
    expect(list.out.join("\n")).toContain(pairId);
    expect(list.out.join("\n")).toContain("1 unsettled");

    const obs = io();
    expect(await run(["settle", "--pair", pairId, "--holds", b, "--how", "changed", "--observer", "--dir", dir], { io: obs.io })).not.toBe(0);
    expect(obs.err.join("\n")).toContain("Nothing was settled");

    const done = io();
    expect(await run(["settle", "--pair", pairId, "--holds", b, "--how", "changed", "--why", "the calendar moved it", "--dir", dir], { io: done.io })).toBe(0);
    expect(done.out.join("\n")).toContain(`Settled ${pairId}: changed`);
    const r1 = Store.open({ dir, observer: true });
    expect(r1.contradiction(pairId)?.state).toBe("settled");
    expect(r1.contradictionSettles({ pairId })[0]?.actor).toBe("owner");
    expect(r1.contradictionSettles({ pairId })[0]?.why).toBe("the calendar moved it");
    r1.close();

    const back = io();
    expect(await run(["settle", "--undo", pairId, "--dir", dir], { io: back.io })).toBe(0);
    expect(back.out.join("\n")).toContain("unsettled again");
    const r2 = Store.open({ dir, observer: true });
    expect(r2.contradiction(pairId)?.state).toBe("unsettled");
    r2.close();
  });

  test("doctor's Contradictions line: the week's flags and settles by kind and by whom, and what is standing; reads fine on a store with none", () => {
    const store = Store.open({ dir });
    open.push(store);
    aged(store);
    const empty = contradictionFindings(store);
    expect(empty).toHaveLength(1);
    expect(empty[0]?.title).toBe("Contradictions");
    expect(empty[0]?.detail).toContain("0 flagged, 0 settled");
    const a = put(store, "Standup is at nine.");
    const b = put(store, "Standup is at ten.");
    const c = put(store, "Retro is on Fridays.");
    const d = put(store, "Retro is on Thursdays.");
    const e = put(store, "Lunch is catered on Mondays.");
    const g = put(store, "Lunch is catered on Tuesdays.");
    flag(store, { x: a, y: b, source: "dream" });
    settle(store, { holds: d, over: c, how: "corrected", actor: "owner", why: "checked" });
    settle(store, { holds: g, over: e, how: "open", actor: "session", actorId: "s1" });
    const [line] = contradictionFindings(store);
    expect(line?.detail).toContain("1 flagged, 2 settled (0 changed, 1 corrected, 1 open)");
    expect(line?.detail).toContain("standing: 1 open, 1 unsettled");
    expect(line?.data["byOwner"]).toBe(1);
    expect(line?.data["bySession"]).toBe(1);
  });

  test("doctor's Upgrade line says what v10 carried, and is silent on a store born at v10", () => {
    const store = Store.open({ dir });
    open.push(store);
    expect(upgradeV10Findings(store)).toEqual([]);
    store.setMeta(V10_UPGRADE_KEY, JSON.stringify({ from: "9", flags: 3, pairs: 2, raised: 1, standing: 2 }));
    const [line] = upgradeV10Findings(store);
    expect(line?.detail).toContain("3 dream flags carried as 2 unsettled pairs");
  });

  test("the mechanism: a settle lights reconsolidation with durable evidence; an undo takes it back", () => {
    const store = Store.open({ dir });
    open.push(store);
    const day = aged(store);
    const a = put(store, "The router is in the hall.");
    const b = put(store, "The router is in the study.");
    const out = settle(store, { holds: b, over: a, how: "changed", actor: "owner" });
    const verdict = (): Verdict | undefined => mechanismEvidence(store, { sinceDay: day - 6, today: day }).verdicts.find((v) => v.id === "reconsolidation");
    expect(verdict()?.fired).toBe(true);
    expect(verdict()?.parts.find((p) => p.key === "settled")?.count).toBe(1);
    undo(store, { pair: out.ok ? out.pair : "", actor: "owner" });
    expect(verdict()?.parts.find((p) => p.key === "settled")?.count ?? 0).toBe(0);
  });

  test("the reflection may settle two memories it was shown, with a plain reason; the trail names it", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    open.push(c);
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    const mk = (body: string): string =>
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.7, emotional: 0.5, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
    const a = mk("Tiny Castles upkeep is 8 food a day per spearman.");
    const b = mk("Tiny Castles upkeep is 16 food a day per spearman.");
    flag(c.store, { x: a, y: b, source: "dream" });
    const begun = c.reflections.begin({ session: SESSION, scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.instructions).toContain('phase "settle"');
    const id = begun.bundle.reflection;
    const bare = c.reflections.settle({ reflection: id, session: SESSION, holds: b, over: a, how: "corrected", why: "" });
    expect(bare.ok).toBe(false);
    const out = c.reflections.settle({ reflection: id, session: SESSION, holds: b, over: a, how: "corrected", why: "The later patch doubled it." });
    expect(out.ok).toBe(true);
    const pair = c.store.contradictionBetween(a, b);
    const last = c.store.contradictionSettles({ pairId: pair?.id as string }).pop();
    expect(last?.actor).toBe("reflection");
    expect(last?.actor_id).toBe(id);
  });
});
