/**
 * THE UPDATE GUARD (2026-10-09) — a `changed` or `corrected` declared by id
 * at a memory that looks unrelated is held: the new memory lands, the old one
 * is not settled and not linked, the writer is shown it and asked to settle
 * it itself if it meant to, and the hold is recorded. `Counterpart#guardUpdate`
 * decides when it applies; `contradictions.ts#updateRelatedness` reads the
 * pair, by meaning through the embedder and by words without one.
 *
 * The meaning cases run on a small fake embedder (topic buckets), so they run
 * everywhere; the brief's own two examples run once more on the real table
 * where it is installed. Hermetic: a fresh temp data dir per test, removed
 * after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  CONTRADICTION_HELD_EVENT,
  CONTRADICTION_SETTLED_EVENT,
  CONTRADICTION_TUNABLES,
  CORRECTED_REASON,
  HELD_HINT,
  contentWords,
  heldCorrections,
  updateRelatedness,
} from "../src/core/contradictions.js";
import { resolveStaticWeights } from "../src/core/embed/static.js";
import { UPDATES_META_KEY } from "../src/core/mint.js";
import { Store } from "../src/core/store/index.js";
import type { Embedder } from "../src/core/store/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const SESSION = "sess_update_guard";
const WEIGHTS = resolveStaticWeights({ env: {} });

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-update-guard-"));
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

/**
 * A FAKE EMBEDDER: one dimension per topic, a word adds to its topic's, and a
 * small constant keeps every vector non-zero. Texts on one topic read as close
 * in meaning whatever their words; texts on two read as far apart.
 */
const TOPIC: Record<string, number> = {
  austin: 0, texas: 0, denver: 0, colorado: 0, home: 0, lives: 0, moved: 0, house: 0,
  mole: 1, dermatologist: 1, biopsy: 1, removed: 1, skin: 1,
  passport: 2, wedding: 2, married: 2, name: 2,
  database: 3, cache: 3, redis: 3, postgres: 3,
};
const fakeEmbed: Embedder = (text: string): number[] | null => {
  const v = [0, 0, 0, 0, 0, 0, 0, 0.05];
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    const d = TOPIC[w];
    if (d !== undefined) v[d] = (v[d] ?? 0) + 1;
  }
  return v;
};

/** A server on the test's store — or on a second one beside it (`sub`). */
function server(opts: { embed?: Embedder; sub?: string } = {}): McpServer {
  const at = opts.sub === undefined ? dir : join(dir, opts.sub);
  const s = openServer({ dir: at, session: SESSION, scope: "/scope/one", owner: true, ...(opts.embed === undefined ? {} : { embed: opts.embed }) });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** A store a few lived days in, so a new memory is not born on day 0. */
function aged(store: Store): void {
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
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

const PASSPORT = "The user changed her last name on her passport after the wedding; the new passport arrived in May.";
const MOLE = "The user had a mole removed from her back at the dermatologist; the biopsy was benign.";

/** Read as a pair alone, under the fake embedder, the two look unrelated. */
function wouldHold(over: string, text: string): boolean {
  return !updateRelatedness({ over, text, overVec: fakeEmbed(over), textVec: fakeEmbed(text) }).related;
}

/** The old memory is exactly as it was: live, unfaded, in no pair. */
function untouched(store: Store, id: string): void {
  const row = store.row(id);
  expect(row?.archived).toBe(0);
  expect(row?.superseded_by).toBeNull();
  expect(store.physicsOf(id).fade ?? 1).toBe(1);
  expect(store.contradictionsOf([id]).get(id) ?? []).toEqual([]);
}

describe("an unrelated pair is held", () => {
  test("corrected, read by meaning: the new memory lands unlinked, the old one is untouched, the writer is shown it, and the hold is recorded", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const passport = put(store, PASSPORT, { title: "Passport name change" });
    const r = payload(await s.call("note", { text: MOLE, updates: passport, how: "corrected" }));
    expect(r["stored"]).toBe(true);
    const id = String(r["id"]);

    untouched(store, passport);
    expect(store.read(id).doc.meta[UPDATES_META_KEY]).toBeUndefined();
    expect(store.eventLog({ name: CONTRADICTION_SETTLED_EVENT })).toHaveLength(0);

    // The reply: one more case of the neighbours' ask, with the old memory's own words.
    const settled = r["settled"] as Record<string, unknown>;
    expect(settled).toMatchObject({ ok: false, held: true, reason: "looks-unrelated", how: "corrected", holds: id, over: passport, title: "Passport name change", detail: HELD_HINT });
    expect(String(settled["text"])).toContain("new passport arrived in May");
    expect(HELD_HINT).toContain("note with settle {holds, over, how, why}");
    // Not shown twice: the held memory is not also a neighbour.
    expect(((r["neighbours"] ?? []) as { id: string }[]).map((n) => n.id)).not.toContain(passport);

    // The record: ids and the reading, no text.
    const rows = store.eventLog({ name: CONTRADICTION_HELD_EVENT });
    expect(rows).toHaveLength(1);
    const p = JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(p).toMatchObject({ holds: id, over: passport, how: "corrected", by: "meaning", source: "jot", writeUp: false, actorId: SESSION });
    expect(Number(p["cosine"])).toBeLessThan(CONTRADICTION_TUNABLES.UPDATE_COSINE);
    expect(JSON.stringify(p)).not.toContain("passport arrived");
    expect(heldCorrections(store)).toEqual({ held: 1, settledAfter: 0, byMeaning: 1, byWords: 0 });
  });

  test("the default how (changed) is held too, and with no embedder the words decide", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const passport = put(store, PASSPORT);
    const r = payload(await s.call("note", { text: MOLE, updates: passport }));
    expect(r["stored"]).toBe(true);
    untouched(store, passport);
    expect(r["settled"]).toMatchObject({ held: true, how: "changed", over: passport });
    const p = JSON.parse(store.eventLog({ name: CONTRADICTION_HELD_EVENT })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(p).toMatchObject({ by: "words", cosine: null, shared: 0, how: "changed" });
  });

  test("a date sent at a memory that holds none dates the NEW memory: no redate, so the pair is read", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const passport = put(store, PASSPORT);
    const r = payload(await s.call("note", { text: `Mole check at the dermatologist. ${MOLE}`, updates: passport, eventDate: "2027-03-03" }));
    expect(r["settled"]).toMatchObject({ held: true, over: passport });
    untouched(store, passport);
    // Its own date, not one carried from the memory it named.
    expect(store.row(String(r["id"]))?.event_date).toBe("2027-03-03");
  });
});

describe("a related correction worded differently passes", () => {
  test("by words: the two share a content word", async () => {
    const s = server();
    const store = s.counterpart.store;
    aged(store);
    const nurse = put(store, "Ana works as a nurse at St. David's hospital.");
    const r = payload(await s.call("note", { text: "Ana quit nursing and started law school in the fall.", updates: nurse, how: "changed" }));
    expect(r["settled"]).toMatchObject({ ok: true, how: "changed", over: nurse });
    expect(store.physicsOf(nurse).fade).toBe(0.5);
    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });

  test("by meaning, sharing no word — the same pair without an embedder is held", async () => {
    const OLD = "Mike lives in Austin, Texas, in a rented house.";
    const NEW = "Moved to Denver last month; Colorado is home now.";
    expect([...contentWords(OLD)].filter((w) => contentWords(NEW).has(w))).toEqual([]);

    const withMeaning = server({ embed: fakeEmbed });
    aged(withMeaning.counterpart.store);
    const austin = put(withMeaning.counterpart.store, OLD);
    const r = payload(await withMeaning.call("note", { text: NEW, updates: austin, how: "corrected" }));
    expect(r["settled"]).toMatchObject({ ok: true, how: "corrected", over: austin });
    expect(withMeaning.counterpart.store.row(austin)?.archived_reason).toBe(CORRECTED_REASON);

    const wordsOnly = server({ sub: "no-embedder" });
    aged(wordsOnly.counterpart.store);
    const austin2 = put(wordsOnly.counterpart.store, OLD);
    const held = payload(await wordsOnly.call("note", { text: NEW, updates: austin2, how: "corrected" }));
    expect(held["settled"]).toMatchObject({ held: true, over: austin2 });
    untouched(wordsOnly.counterpart.store, austin2);
  });

  test("how: open is unchanged — an unrelated pair kept open settles as it did", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const passport = put(store, PASSPORT);
    const r = payload(await s.call("note", { text: MOLE, updates: passport, how: "open" }));
    expect(r["settled"]).toMatchObject({ ok: true, how: "open", with: passport });
    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });
});

describe("settling after a hold", () => {
  test("the writer that meant it settles with note settle {holds, over, how, why}; the reader counts it", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const passport = put(store, PASSPORT);
    const r = payload(await s.call("note", { text: MOLE, updates: passport, how: "corrected" }));
    const settled = r["settled"] as Record<string, unknown>;
    const again = payload(
      await s.call("note", { settle: { holds: settled["holds"], over: settled["over"], how: "corrected", why: "I did mean it: the old one was wrong." } }),
    );
    expect(again["settle"]).toMatchObject({ ok: true, how: "corrected", holds: String(r["id"]), over: passport, archived: passport });
    expect(store.row(passport)?.archived_reason).toBe(CORRECTED_REASON);
    expect(store.contradictionBetween(String(r["id"]), passport)?.source).toBe("settle");
    expect(heldCorrections(store)).toMatchObject({ held: 1, settledAfter: 1 });
  });
});

describe("a close or a redate goes straight through", () => {
  test("a terse thread-closing update still closes: a short \"done\" with unresolved: false", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const QUESTION = "Open question: which database should the cache layer use?";
    const DONE = "Done, moved on from it.";
    const opened = payload(await s.call("note", { text: QUESTION, unresolved: true }));
    const thread = String(opened["id"]);
    expect(store.readProse(thread).meta["unresolved"]).toBe(true);
    // Read as a pair, the "done" is nowhere near the question.
    expect(wouldHold(QUESTION, DONE)).toBe(true);

    const done = payload(await s.call("note", { text: DONE, updates: thread, unresolved: false }));
    expect(done["stored"]).toBe(true);
    expect(done["thread"]).toEqual({ closed: thread });
    expect(store.readProse(thread).meta["unresolved"]).toBe(false);
    expect(done["settled"]).toMatchObject({ ok: true, how: "changed", over: thread });
    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });

  test("an open thread closed the other documented way — how: changed and the answer — passes too", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const QUESTION = "Open question: which store should the session layer sit on?";
    const ANSWER = "Going with Redis, decided this morning.";
    expect(wouldHold(QUESTION, ANSWER)).toBe(true);
    const thread = put(store, QUESTION, { meta: { unresolved: true } });
    const r = payload(await s.call("note", { text: ANSWER, updates: thread, how: "changed" }));
    expect(r["settled"]).toMatchObject({ ok: true, how: "changed", over: thread });
    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });

  test("a redate: a reminder field at a dated memory moves its date, whatever the words — and drops it", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const APPOINTMENT = "Dentist appointment for a cleaning.";
    const MOVED = "Moved to the 21st instead.";
    expect(wouldHold(APPOINTMENT, MOVED)).toBe(true);
    const first = payload(await s.call("note", { text: APPOINTMENT, eventDate: "2027-03-14" }));
    const dentist = String(first["id"]);
    const r = payload(await s.call("note", { text: MOVED, updates: dentist, eventDate: "2027-03-21" }));
    expect(r["settled"]).toMatchObject({ ok: true, over: dentist });
    expect(store.row(String(r["id"]))?.event_date).toBe("2027-03-21");
    expect(store.row(dentist)?.event_date).toBeNull();
    // And "done": the date dropped.
    expect(wouldHold(MOVED, "Went, all clean, nothing to fix.")).toBe(true);
    const later = payload(await s.call("note", { text: "Went, all clean, nothing to fix.", updates: String(r["id"]), eventDate: null }));
    expect(later["settled"]).toMatchObject({ ok: true });
    expect(later["reminder"]).toMatchObject({ cleared: true });
    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });

  test("a status change: planned, now done", async () => {
    const s = server({ embed: fakeEmbed });
    const store = s.counterpart.store;
    aged(store);
    const PLAN = "Plan: write the quarterly letter to the investors.";
    const SENT = "Moved it out the door this morning.";
    expect(wouldHold(PLAN, SENT)).toBe(true);
    const plan = payload(await s.call("note", { text: PLAN, status: "planned" }));
    const r = payload(await s.call("note", { text: SENT, updates: String(plan["id"]), status: "done" }));
    expect(r["settled"]).toMatchObject({ ok: true, over: String(plan["id"]) });
    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });
});

describe("updateRelatedness — the reading itself", () => {
  test("meaning decides when there are two vectors of one width; the words do not vote", () => {
    const shared = updateRelatedness({ over: "the relief valve", text: "the relief valve, again", overVec: [1, 0], textVec: [0, 1] });
    expect(shared).toMatchObject({ related: false, by: "meaning", cosine: 0 });
    expect(shared.shared.length).toBeGreaterThan(0);
    const bar = CONTRADICTION_TUNABLES.UPDATE_COSINE;
    const at = updateRelatedness({ over: "a", text: "b", overVec: [1, 0], textVec: [bar, Math.sqrt(1 - bar * bar)] });
    expect(at.related).toBe(true);
  });

  test("words decide without vectors, or when the widths differ; the owner's names are not shared words", () => {
    expect(updateRelatedness({ over: "Mike's son plays soccer.", text: "Mike's passport was renewed." }).related).toBe(true);
    expect(updateRelatedness({ over: "Mike's son plays soccer.", text: "Mike's passport was renewed.", ignoreNames: ["Mike Lapeter"] }).related).toBe(false);
    expect(updateRelatedness({ over: PASSPORT, text: MOLE, overVec: [1, 0, 0], textVec: [1, 0] })).toMatchObject({ by: "words", related: false });
    // A memory with no content word to share cannot be judged by words: it passes.
    expect(updateRelatedness({ over: "It is.", text: MOLE }).related).toBe(true);
  });
});

describe.skipIf(WEIGHTS === null)("the real table (potion-base-8M)", () => {
  test("the brief's two: Denver to Colorado passes, the mole and the passport are held", async () => {
    const table = openStaticEmbedder({ env: {} });
    const s = server({ embed: table.embed });
    const store = s.counterpart.store;
    aged(store);
    const denver = put(store, "Mike moved to Denver.");
    const ok = payload(await s.call("note", { text: "Mike lives in Colorado now.", updates: denver, how: "changed" }));
    expect(ok["settled"]).toMatchObject({ ok: true, over: denver });
    const passport = put(store, PASSPORT);
    const held = payload(await s.call("note", { text: MOLE, updates: passport, how: "corrected" }));
    expect(held["settled"]).toMatchObject({ held: true, over: passport });
    untouched(store, passport);
    const p = JSON.parse(store.eventLog({ name: CONTRADICTION_HELD_EVENT })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(p["by"]).toBe("meaning");
    expect(Number(p["cosine"])).toBeLessThan(CONTRADICTION_TUNABLES.UPDATE_COSINE);
  });

  // Review of #340: the fake embedder above stands in for meaning; the real
  // table must agree that a terse "done" is nowhere near its question (so the
  // guard WOULD hold it) and that the thread closes anyway, through both doors.
  test("review of #340: a terse \"done\" closes an open thread on the real table — through note and through session_end", async () => {
    const table = openStaticEmbedder({ env: {} });
    const s = server({ embed: table.embed });
    const store = s.counterpart.store;
    aged(store);
    const QUESTION = "Open: should the nightly catch-up get its own budget, or share the dream's?";
    // As terse as a write can be: the content floor refuses under 20 characters.
    const DONE = "Done. Decided and shipped it.";
    const DONE_AGAIN = "Done. Settled it this morning.";
    for (const text of [DONE, DONE_AGAIN]) {
      expect(updateRelatedness({ over: QUESTION, text, overVec: table.embed(QUESTION), textVec: table.embed(text) }).related).toBe(false);
    }

    const viaNote = String(payload(await s.call("note", { text: QUESTION, unresolved: true }))["id"]);
    const closed = payload(await s.call("note", { text: DONE, updates: viaNote, unresolved: false }));
    expect(closed["thread"]).toEqual({ closed: viaNote });
    expect(store.readProse(viaNote).meta["unresolved"]).toBe(false);

    const viaEnd = String(payload(await s.call("note", { text: QUESTION.replace("budget", "time limit"), unresolved: true }))["id"]);
    const out = payload(await s.call("session_end", { session: SESSION, memories: [{ content: DONE_AGAIN, updates: viaEnd, unresolved: false }] }));
    const outcome = (out["outcomes"] as Record<string, unknown>[])[0] ?? {};
    expect(outcome["stored"]).toBe(true);
    expect(outcome["thread"]).toEqual({ closed: viaEnd });
    expect(store.readProse(viaEnd).meta["unresolved"]).toBe(false);

    expect(store.eventLog({ name: CONTRADICTION_HELD_EVENT })).toHaveLength(0);
  });
});
