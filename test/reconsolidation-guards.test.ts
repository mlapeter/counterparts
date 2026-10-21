/**
 * THE GUARDS ON "THIS REPLACES THAT" (2026-10-11, Group 2; reviews 04, 07 and
 * 10 C3/C5): a reading or world memory is not faded by a work or owner fact
 * (it comes back `open`); a pending dated memory is never buried (a settle
 * carries the reminder or, onto a dated holder, refuses; the write that
 * `updates` it carries it too — `reconsolidation-door.test.ts`); the core
 * survives a settle; the update guard's bar is the store's own. Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  CONTRADICTION_TUNABLES,
  GUARD_BAR_META,
  guardBar,
  measureGuardBar,
  settle,
  updateRelatedness,
} from "../src/core/reconsolidation.js";
import { Store } from "../src/core/store/index.js";
import type { Embedder } from "../src/core/store/index.js";

const SESSION = "sess_guards";
let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-guards-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(opts: { embed?: Embedder } = {}): Store {
  const s = Store.open({ dir, ...(opts.embed === undefined ? {} : { embed: opts.embed }) });
  open.push(s);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) s.advanceClock(d);
  return s;
}

function put(s: Store, body: string, extra: Partial<Parameters<Store["put"]>[0]> = {}): string {
  const day = s.livedDay();
  return s.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...extra });
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

describe("a reading or a world memory", () => {
  test("is not faded by a fact about the owner: the settle comes back open, and says why", () => {
    const s = store();
    const reading = put(s, "Reading: a field guide to river otters, how they hunt in pairs.", { title: "Reading: a field guide to river otters", about: "world" });
    const fact = put(s, "Ada keeps a sketchbook of the river otters she sees.", { about: "owner" });
    const out = settle(s, { holds: fact, over: reading, how: "changed", actor: "session", why: "same topic" });
    expect(out.ok && out.how).toBe("open");
    expect(out.ok && out.note).toContain("not faded");
    expect(s.row(reading)?.fade).toBe(1);
    const trail = s.contradictionSettles({ pairId: out.ok ? out.pair : "" });
    expect(JSON.parse(trail[0]?.detail ?? "{}")["asked"]).toBe("changed");
  });

  test("a reading over a reading, and the owner's own settle, go as asked", () => {
    const s = store();
    const a = put(s, "Reading: chapter two, the bean field.", { about: "world" });
    const b = put(s, "Reading: chapter two again, the bean field, a corrected note.", { about: "world" });
    expect(settle(s, { holds: b, over: a, how: "changed", actor: "dream", why: "re-read" })).toMatchObject({ ok: true, how: "changed" });
    const c = put(s, "Reading: chapter three, solitude.", { about: "world" });
    const d = put(s, "Work: the reading list moved to a new file.", { about: "work" });
    expect(settle(s, { holds: d, over: c, how: "changed", actor: "owner" })).toMatchObject({ ok: true, how: "changed" });
  });
});

describe("a pending dated memory", () => {
  test("is never buried by a settle; the write that updates it carries the reminder and settles it", async () => {
    const srv = openServer({ dir, session: SESSION, scope: "/scope/one" });
    open.push(srv.counterpart);
    const s = srv.counterpart.store;
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) s.advanceClock(d);
    const dated = String(payload(await srv.call("remember", { text: "Renew the boat licence before the deadline.", eventDate: "2099-10-15" }))["id"]);
    expect(s.physicsOf(dated).hold?.state).toBe("pending");
    // A holder with a date of its own cannot take the reminder: refused (Group 2b).
    const datedToo = put(s, "The harbour office reopens for licences in the spring.");
    s.revise(datedToo, { eventDate: "2099-03-01" });
    const refused = settle(s, { holds: datedToo, over: dated, how: "changed", actor: "session" });
    expect(refused).toMatchObject({ ok: false, reason: "pending-date" });
    expect(s.row(dated)?.fade).toBe(1);
    const other = put(s, "The harbour office is still processing the boat licence.");
    // Open moves nothing, so it may.
    expect(settle(s, { holds: other, over: dated, how: "open", actor: "session" }).ok).toBe(true);
    // The write that updates it: the reminder moves, then the old one is settled.
    const r = payload(await srv.call("remember", { text: "Renew the boat licence before the deadline; the harbour office is nearly done.", updates: dated, how: "changed" }));
    expect((r["settled"] as Record<string, unknown>)["ok"]).toBe(true);
    expect(s.row(String(r["id"]))?.event_date).toBe("2099-10-15");
    expect(s.row(dated)?.event_date).toBeNull();
  });
});

describe("the core", () => {
  test("survives a settle: refused, nothing cut (never-fade class)", () => {
    const s = store();
    const core = put(s, "Ada loves the sea more than anything.", { about: "owner" });
    s.updatePhysics(core, { promotedIdentity: true });
    const newer = put(s, "Ada loves the sea, and the river too.", { about: "owner" });
    expect(settle(s, { holds: newer, over: core, how: "changed", actor: "dream", why: "x" })).toMatchObject({ ok: false, reason: "core-takes-pressure" });
    expect(s.row(core)?.fade).toBe(1);
  });
});

describe("the store's own guard bar", () => {
  // Every text on one of two topics: random pairs are close half the time.
  const TOPIC: Record<string, number> = { garden: 0, tomato: 0, deploy: 1, release: 1 };
  const embed: Embedder = (text: string): number[] | null => {
    const v = [0.2, 0.2, 0.05];
    for (const w of text.toLowerCase().split(/[^a-z]+/)) {
      const d = TOPIC[w];
      if (d !== undefined) v[d] = (v[d] ?? 0) + 1;
    }
    return v;
  };

  test("is the store's random-pair quantile, kept in meta for the day, never under UPDATE_COSINE", () => {
    const s = store({ embed });
    for (let i = 0; i < 80; i += 1) put(s, i % 2 === 0 ? `Garden note ${String(i)}: tomato rows.` : `Deploy note ${String(i)}: release steps.`);
    const m = measureGuardBar(s, s.livedDay());
    expect(m.vectors).toBeGreaterThanOrEqual(CONTRADICTION_TUNABLES.GUARD_BAR_MIN_VECTORS);
    expect(m.bar).toBeGreaterThan(CONTRADICTION_TUNABLES.UPDATE_COSINE);
    const bar = guardBar(s);
    expect(bar).toBe(m.bar);
    expect(JSON.parse(s.getMeta(GUARD_BAR_META) ?? "{}")).toMatchObject({ day: s.livedDay(), bar });
    // A pair at 0.35 passes the demo bar and is held by this store's.
    const x = [1, 0];
    const y = [0.35, Math.sqrt(1 - 0.35 * 0.35)];
    expect(updateRelatedness({ over: "a", text: "b", overVec: x, textVec: y }).related).toBe(true);
    expect(updateRelatedness({ over: "a", text: "b", overVec: x, textVec: y, bar }).related).toBe(false);
  });

  test("a small store is held to UPDATE_COSINE", () => {
    const s = store({ embed });
    for (let i = 0; i < 5; i += 1) put(s, `Garden note ${String(i)}: tomato rows.`);
    expect(guardBar(s)).toBe(CONTRADICTION_TUNABLES.UPDATE_COSINE);
  });
});
