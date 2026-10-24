/**
 * R2 (2026-10-24): use credit refuses the WRITING SESSION, not the birth day.
 *
 * The scar [v1 §10 G9] was the writing session's boundary seeing its new
 * memory's words in the reply it just produced. Since `OWN_WRITE_GATE` the
 * session that wrote a memory never credits it (`own-write`); another session
 * may on its birth day, once, as on any lived day. A memory with no origin
 * session, or a credit with no session, keeps the old `birth-day` refusal.
 *
 * Through the real doors: the `remember` MCP tool bound to a session writes
 * the memory, and the session boundary (`creditReferences`, `creditDrewOn`,
 * `rateShown`) credits it.
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TUNABLES, USE_TIER_WEIGHT, creditReturn, creditUse } from "../src/core/physics/index.js";
import { UNBOUND_SESSION } from "../src/core/types.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import type { Counterpart } from "../src/core/counterpart.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const A = "sess_ownwrite_A";
const B = "sess_ownwrite_B";
const C = "sess_ownwrite_C";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];
const gate = (TUNABLES as Record<string, unknown>).OWN_WRITE_GATE as boolean;

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-ownwrite-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  (TUNABLES as { OWN_WRITE_GATE: boolean }).OWN_WRITE_GATE = gate;
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

function server(session: string): McpServer {
  const s = openServer({ dir, session, scope: "/scope/ownwrite" });
  open.push(s.counterpart);
  return s;
}

const PING = "When someone says ping, the answer is pong, and the footnote says so.";

/** Session `session` writes one memory through the `remember` tool; its id. */
async function write(s: McpServer, text: string, extra: Record<string, unknown> = {}): Promise<string> {
  const out = (await s.call("remember", { text, ...extra })).structuredContent;
  const id = (out["memoryId"] ?? out["id"]) as string | undefined;
  if (typeof id !== "string") throw new Error(`remember gave no id: ${JSON.stringify(out)}`);
  return id;
}

/** Record `ids` as footnoted to `session` on `turn`, as recall's own save would. */
function footnoted(c: Counterpart, session: string, turn: number, ids: readonly string[]): void {
  const prior = loadGateState(c.store, session).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn, tier: "footnoted", trains: true };
  saveGateState(c.store, { ...freshGateState(session), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

/** A boundary that quotes the memory's words (an answered question showed it) and opens it. */
function quoteAndOpen(c: Counterpart, session: string, id: string) {
  c.noteAsked(session, [id]);
  return c.creditReferences(session, { assistantTurns: [c.store.readProse(id).body], expansions: [id] });
}

describe("R2 — credit refuses the writing session, not the birth day", () => {
  test("1. the writing session's own boundary quoting and opening its new memory is refused own-write; uses 0", async () => {
    const s = server(A);
    const c = s.counterpart;
    const id = await write(s, PING);
    expect(c.store.row(id)?.origin_session).toBe(A);
    const out = quoteAndOpen(c, A, id);
    expect(out.credited).toBe(0);
    expect(out.refused["own-write"]).toBeGreaterThan(0);
    expect(out.refused["birth-day"]).toBeUndefined();
    expect(c.store.row(id)?.uses).toBe(0);
    expect(c.store.returnsOf(id)).toEqual([]);
    // On a later lived day the writing session credits it, as before (a session can run for days).
    c.store.advanceClock("2099-01-02");
    footnoted(c, A, 5, []);
    const later = quoteAndOpen(c, A, id);
    expect(later.credited).toBe(1);
    expect(c.store.row(id)?.uses).toBe(USE_TIER_WEIGHT.referenced);
  });

  test("2. another session, the same lived day, footnoted it and opens it: credited, once", async () => {
    const s = server(A);
    const c = s.counterpart;
    const id = await write(s, PING);
    const day = c.store.livedDay();
    expect(c.store.row(id)?.birth_day).toBe(day);
    footnoted(c, B, 1, [id]);
    const out = c.creditReferences(B, { assistantTurns: [], expansions: [id] });
    expect(out.credited).toBe(1);
    expect(out.ids).toEqual([id]);
    const row = c.store.row(id);
    expect(row?.uses).toBe(USE_TIER_WEIGHT.referenced);
    expect(row?.reinforced_days).toBe(1);
    expect(row?.last_used_day).toBe(day);
    // A return is a coming back: no gap from birth, so none today (spacing, unchanged).
    expect(c.store.returnsOf(id).filter((r) => r.weight > 0)).toEqual([]);
    expect(row?.return_days).toBe(0);
    // Once a lived day still holds, across sessions.
    footnoted(c, C, 1, [id]);
    const third = c.creditReferences(C, { assistantTurns: [], expansions: [id] });
    expect(third.credited).toBe(0);
    expect(third.refused["already-credited-today"]).toBe(1);
    expect(c.store.row(id)?.uses).toBe(USE_TIER_WEIGHT.referenced);
  });

  test("3. another session's drewOn and its 3-rating on the birth day: credited, once a day", async () => {
    const s = server(A);
    const c = s.counterpart;
    const id = await write(s, PING);
    footnoted(c, B, 1, [id]);
    const drew = c.creditDrewOn(B, [id]);
    expect(drew.credited).toEqual([id]);
    expect(c.store.row(id)?.uses).toBe(USE_TIER_WEIGHT.engaged);

    // A rating of 3 in a third session the same day: the day is already credited
    // at or above (drewOn is a full use since 2026-10-19), or lifted to referenced.
    const id2 = await write(s, "The orchard ladder has eleven rungs and the top one is cracked.");
    footnoted(c, C, 1, [id2]);
    const rated = c.rateShown(C, [{ id: id2, score: 3 }]);
    expect(rated.rated.map((r) => r.id)).toEqual([id2]);
    expect(c.store.row(id2)?.uses).toBe(USE_TIER_WEIGHT.referenced);
    expect(c.store.row(id2)?.reinforced_days).toBe(1);
    // The writing session rating its own memory: refused, nothing credited.
    footnoted(c, A, 2, [id2]);
    c.rateShown(A, [{ id: id2, score: 3 }]);
    expect(c.store.row(id2)?.uses).toBe(USE_TIER_WEIGHT.referenced);
    // drewOn again in B the same day: once a day.
    footnoted(c, B, 2, [id]);
    expect(c.creditDrewOn(B, [id]).credited).toEqual([]);
    expect(c.store.row(id)?.uses).toBe(USE_TIER_WEIGHT.engaged);
  });

  test("4. a memory with no origin session keeps the birth-day refusal", async () => {
    const s = server(A);
    const c = s.counterpart;
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      title: "A note with no session behind it",
      body: "A note with no session behind it, in more words.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
    });
    expect(c.store.row(id)?.origin_session ?? null).toBe(null);
    footnoted(c, B, 1, [id]);
    const out = c.creditReferences(B, { assistantTurns: [], expansions: [id] });
    expect(out.credited).toBe(0);
    expect(out.refused["birth-day"]).toBe(1);
    expect(c.store.row(id)?.uses).toBe(0);
    // A credit with no session at all (a reminder's occurrence, a schemas mention) on a
    // session-written memory: the birth-day rule too.
    const mine = await write(s, PING);
    expect(c.store.reinforce(mine, c.store.livedDay(), "surfaced").reason).toBe("birth-day");
  });

  test("5. switch off: everyone is refused birth-day on the birth day, exactly as before", async () => {
    (TUNABLES as { OWN_WRITE_GATE: boolean }).OWN_WRITE_GATE = false;
    const s = server(A);
    const c = s.counterpart;
    const id = await write(s, PING);
    const own = quoteAndOpen(c, A, id);
    expect(Object.keys(own.refused)).toEqual(["birth-day"]);
    footnoted(c, B, 1, [id]);
    const other = c.creditReferences(B, { assistantTurns: [], expansions: [id] });
    expect(other.credited).toBe(0);
    expect(other.refused).toEqual({ "birth-day": 1 });
    expect(c.store.row(id)?.uses).toBe(0);
    // And the writing session credits it the next lived day, as before.
    c.store.advanceClock("2099-01-02");
    footnoted(c, A, 5, [id]);
    expect(c.creditReferences(A, { assistantTurns: [], expansions: [id] }).credited).toBe(1);
  });

  test("a revision written in session B of A's memory is B's: A may credit it the same day, B may not", async () => {
    const sa = server(A);
    const c = sa.counterpart;
    const original = await write(sa, PING);
    sa.counterpart.close();
    open.splice(0);
    const sb = server(B);
    const cb = sb.counterpart;
    const revision = await write(sb, "When someone says ping, the answer is pong, twice now: the rule changed.", { updates: original });
    expect(revision).not.toBe(original);
    const row = cb.store.row(revision);
    expect(row?.origin_session).toBe(B);
    // B wrote it: B's boundary is refused.
    const own = quoteAndOpen(cb, B, revision);
    expect(own.refused["own-write"]).toBeGreaterThan(0);
    expect(cb.store.row(revision)?.uses).toBe(0);
    // A did not write the revision (it wrote what the revision replaced): A credits it.
    footnoted(cb, A, 3, [revision]);
    const byA = cb.creditReferences(A, { assistantTurns: [], expansions: [revision] });
    expect(byA.credited).toBe(1);
    expect(cb.store.row(revision)?.uses).toBe(USE_TIER_WEIGHT.referenced);
  });
});

describe("R2 — the review's awkward states (review of #610)", () => {
  /** Session `session` writes a memory that `updates` an id that resolves to nothing: a content re-encounter, a confirm. */
  async function confirm(s: McpServer, text: string): Promise<void> {
    await write(s, text, { updates: "mem_000000000000" });
  }

  test("the confirm path [v1 §10 G9]: another session's re-encounter credits the newborn once; the writer's is refused own-write", async () => {
    const sa = server(A);
    const original = await write(sa, PING);
    sa.counterpart.close();
    open.splice(0);
    const sb = server(B);
    await confirm(sb, "When someone says ping the answer is pong; the footnote says so, again.");
    expect(sb.counterpart.store.row(original)).toMatchObject({ uses: USE_TIER_WEIGHT.referenced, reinforced_days: 1 });
    // A second re-encounter the same day: once a lived day.
    await confirm(sb, "Ping gets pong as the answer, and the footnote says so, once more.");
    expect(sb.counterpart.store.row(original)?.uses).toBe(USE_TIER_WEIGHT.referenced);
    sb.counterpart.close();
    open.splice(0);

    // The writing session re-encountering its own newborn memory: refused, by name.
    const sa2 = server(A);
    const mine = await write(sa2, "The orchard ladder has eleven rungs and the top one is cracked.");
    await confirm(sa2, "The orchard ladder has eleven rungs; its top rung is cracked, still.");
    expect(sa2.counterpart.store.row(mine)?.uses).toBe(0);
    // The confirm resolved to it and reached the store, which refused it by name.
    const asked = sa2.counterpart.store.events("store.reinforce").filter((e) => e.ref === mine);
    expect(asked.map((e) => e.data?.["reason"])).toEqual(["own-write"]);
  });

  test("a write-up's writer (meta writtenUpBy) and its lived session are both refused own-write on the birth day; a third session credits it", async () => {
    const s = server(C);
    const c = s.counterpart;
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      title: "A written-up stretch",
      body: "The relief valve on the boiler was replaced, written up afterwards.",
      salience: { novelty: null, relevance: 0.6, emotional: 0.4, predictive: 0.5 },
      origin: { session: A },
      meta: { secondHand: true, writtenUpBy: B },
    });
    const day = c.store.livedDay();
    expect(c.store.reinforce(id, day, "referenced", { session: B }).reason).toBe("own-write");
    expect(c.store.reinforce(id, day, "referenced", { session: A }).reason).toBe("own-write");
    footnoted(c, C, 1, [id]);
    expect(c.creditReferences(C, { assistantTurns: [], expansions: [id] }).credited).toBe(1);
    expect(c.store.row(id)?.uses).toBe(USE_TIER_WEIGHT.referenced);
  });

  test("the unbound server's shared id names no session: a memory it wrote, or a credit it sends, keeps the birth-day rule", async () => {
    const unbound = openServer({ dir, scope: "/scope/ownwrite" });
    open.push(unbound.counterpart);
    const c = unbound.counterpart;
    const id = await write(unbound, PING);
    expect(c.store.row(id)?.origin_session).toBe(UNBOUND_SESSION);
    // The same conversation's hooks know its real id: that boundary may be the writer's own.
    const out = quoteAndOpen(c, A, id);
    expect(out.credited).toBe(0);
    expect(out.refused["birth-day"]).toBeGreaterThan(0);
    expect(c.store.row(id)?.uses).toBe(0);
    // And a credit sent under the shared id, on a memory a bound session wrote.
    const sa = server(A);
    const mine = await write(sa, "The orchard ladder has eleven rungs and the top one is cracked.");
    expect(sa.counterpart.store.reinforce(mine, sa.counterpart.store.livedDay(), "referenced", { session: UNBOUND_SESSION }).reason).toBe("birth-day");
  });
});

describe("R2 — physics takes the caller's fact", () => {
  const born = {
    kind: "fact",
    salience: { novelty: null, relevance: 0.5, emotional: 0.3, predictive: 0.4 },
    uses: 0,
    lastUsedDay: 4,
    birthDay: 4,
    consolidated: false,
    protected: false,
  } as MemoryPhysics;

  test("ownWrite true refuses on the birth day only; false credits the birth day once; left out keeps birth-day", () => {
    expect(creditUse(born, 4, "referenced", { ownWrite: true }).reason).toBe("own-write");
    expect(creditUse(born, 9, "referenced", { ownWrite: true }).credited).toBe(true);
    expect(creditUse(born, 4, "referenced").reason).toBe("birth-day");
    const first = creditUse(born, 4, "shown", { ownWrite: false });
    expect(first).toMatchObject({ credited: true, next: { uses: USE_TIER_WEIGHT.shown, lastUsedDay: 4, reinforcedDays: 1 } });
    const after = { ...born, ...first.next };
    expect(creditUse(after, 4, "shown", { ownWrite: false }).reason).toBe("already-credited-today");
    // The tier still only goes up within the day.
    const lifted = creditUse(after, 4, "referenced", { ownWrite: false, upgradeFrom: "shown" });
    expect(lifted.next).toEqual({ uses: 1, lastUsedDay: 4, reinforcedDays: 1 });
    // Returns: the writer is refused by name; anyone else on the birth day still has no gap.
    expect(creditReturn(born, 4, { source: "awake", ownWrite: true }).reason).toBe("own-write");
    expect(creditReturn(born, 4, { source: "awake", ownWrite: false }).reason).toBe("birth-day");
  });

  test("switch off: the opt is ignored", () => {
    (TUNABLES as { OWN_WRITE_GATE: boolean }).OWN_WRITE_GATE = false;
    expect(creditUse(born, 4, "referenced", { ownWrite: false }).reason).toBe("birth-day");
    expect(creditUse(born, 9, "referenced", { ownWrite: true }).credited).toBe(true);
    expect(creditReturn(born, 4, { source: "awake", ownWrite: true }).reason).toBe("birth-day");
  });
});
