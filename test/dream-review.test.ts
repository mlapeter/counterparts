/**
 * The adversarial review of #251 (2026-09-26, `docs/adversarial-review-pr251-2026-09-26.md`):
 * the holes it found in dreaming, each closed and held here — confidentiality
 * travels with a dream's words, dated reminders and demoted memories are not
 * merged, a dream left open is closed by the next, undo is safe after the
 * merged memory moved on, a dream's merges are not "new", and a dream's replay
 * does not take the lane day of an organic return the same day.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { V8_CENSUS_KEY, runCycle, v7WouldPromote } from "../src/core/sleep/index.js";
import type { UpgradeCensus } from "../src/core/sleep/index.js";
import { Store, V8_UPGRADE_KEY } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { stripToV7 } from "./v7-fixture.js";

let dir: string;
const open: Counterpart[] = [];
let offsetMs = 0;

beforeEach(() => {
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-dream-review-"));
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

function brain(owner = true): Counterpart {
  const c = Counterpart.open({ dir, owner, bundlesAsOwner: true, identity: { name: "Mike" }, now: () => Date.now() + offsetMs });
  open.push(c);
  return c;
}

const SESSION = "s-dream";

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

function lived(c: Counterpart): { a: string; b: string; old: string; person: string; self: string } {
  c.store.advanceClock("2026-09-10");
  const old = mem(c, "The deploy script needs the migration step before the container starts.");
  for (let d = 11; d <= 26; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  const a = mem(c, "The migration step must run before the container boots, or it boots empty.");
  const b = mem(c, "Run the migration before starting the container, otherwise the container starts empty.");
  const person = mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { kind: "person" });
  const self = mem(c, "I say what I do not know before I guess.", { kind: "self" });
  return { a, b, old, person, self };
}

function begin(c: Counterpart): string {
  const out = c.dreams.begin({ session: SESSION, scope: "/proj" });
  if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
  return out.bundle.dream;
}

describe("review of #251: what a dream's changes must keep", () => {
  test("a merge or a gist made from a confidential memory is confidential too", () => {
    const c = brain();
    const m = lived(c);
    const secret = mem(c, "The acquisition talks with the other company are not public until October.", {
      meta: { confidential: true },
    });
    const secret2 = mem(c, "Acquisition talks: not public until October, keep it quiet.", {
      meta: { confidentiality: "business" },
    });
    const id = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [secret, secret2], text: "The acquisition talks stay private until October." },
        { action: "gist", text: "Timing is everything with announcements.", sources: [m.a, secret2] },
      ],
    });
    if (!out.ok) throw new Error("refused");
    expect(out.results.map((r) => r.reason)).toEqual(["merged", "not-shown-or-gone"]);
    const merged = out.results[0]?.id as string;
    expect(c.store.row(merged)?.confidential).toBe(1);
    expect(c.store.readProse(merged).meta["confidentiality"]).toBe("business");
    // secret2 is merged away now; a gist drawn from the merged memory keeps the mark.
    const gist = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [{ action: "gist", text: "Timing is everything with announcements.", sources: [m.a, merged] }],
    });
    if (!gist.ok) throw new Error("refused");
    expect(gist.results[0]?.ok).toBe(true);
    expect(c.store.row(gist.results[0]?.id as string)?.confidential).toBe(1);
    // And a plain merge stays plain.
    const plain = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [{ action: "merge", ids: [m.a, m.b], text: "Migrations before the container boots." }],
    });
    if (!plain.ok) throw new Error("refused");
    expect(c.store.row(plain.results[0]?.id as string)?.confidential).toBe(0);
  });

  test("a dated reminder and a memory the owner demoted are not merged", () => {
    const c = brain();
    const m = lived(c);
    const dated = mem(c, "Renew the TLS certificate on the staging box before it lapses.", { eventDate: "2026-10-03" });
    const dated2 = mem(c, "The staging TLS certificate needs renewing before it lapses.");
    const self2 = mem(c, "I say plainly what I do not know before I guess at it.", { kind: "self" });
    c.store.updatePhysics(m.self, { promotedIdentity: true });
    expect(c.demoteCore(m.self, { reason: "not me" }).ok).toBe(true);
    const id = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [dated, dated2], text: "Renew the staging TLS certificate." },
        { action: "merge", ids: [m.self, self2], text: "I say what I do not know first." },
      ],
    });
    if (!out.ok) throw new Error("refused");
    expect(out.results.map((r) => r.reason)).toEqual(["dated-is-not-merged", "demoted-is-not-merged"]);
    expect(c.store.row(dated)?.archived).toBe(0);
    expect(c.store.row(m.self)?.archived).toBe(0);
  });

  test("a dream left open is closed by the next one: its old id takes no more changes", () => {
    const c = brain();
    const m = lived(c);
    const first = begin(c);
    expect(c.dreams.propose({ dream: first, session: SESSION, changes: [{ action: "link", a: m.a, b: m.old }] }).ok).toBe(true);
    // Never journaled. Three calendar days later — past resuming (today's or
    // yesterday's dream left behind is RESUMED since 2026-09-28) — with new
    // memories, a new dream begins.
    c.store.advanceClock("2026-09-27");
    offsetMs += 3 * 86_400_000;
    for (const body of [
      "The nightly backup job moved to two in the morning to miss the batch window.",
      "The batch window now ends at one thirty, so backups start after it.",
      "Backups and batch jobs share the same disk, so they must not overlap.",
    ]) {
      mem(c, body);
    }
    const second = begin(c);
    expect(second).not.toBe(first);
    expect(c.dreams.propose({ dream: first, session: SESSION, changes: [{ action: "link", a: m.b, b: m.old }] })).toEqual({
      ok: false,
      reason: "dream-closed",
    });
    expect(c.dreams.journal({ dream: first, session: SESSION, text: "late" })).toEqual({ ok: false, reason: "dream-closed" });
  });

  test("undo leaves a merge alone when the merged memory has moved on since — no duplicates", () => {
    const c = brain();
    const m = lived(c);
    const id = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [m.a, m.b], text: "Migrations before the container boots." },
        { action: "link", a: m.person, b: m.old },
      ],
    });
    if (!out.ok) throw new Error("refused");
    const merged = out.results[0]?.id as string;
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    // Awake, later: the merged memory is corrected into a successor.
    const successor = c.store.supersede(
      merged,
      { type: "memory", kind: "fact", body: "Migrations run in the entrypoint, before the server starts." },
      "revise",
    );
    const undone = c.dreams.undo(id);
    expect(undone).toMatchObject({ ok: true, reason: "undone-except-moved-on", reversed: 1, kept: 1 });
    // The originals stay folded in; the awake correction stands alone.
    for (const orig of [m.a, m.b]) expect(c.store.row(orig)?.archived).toBe(1);
    expect(c.store.row(successor)?.archived).toBe(0);
    // The rest of the dream is reversed.
    expect(c.store.edgesFrom(m.person).some((e) => e.dst === m.old)).toBe(false);
  });

  test("a dream's merges and gists are not new memories for the next day's ask", () => {
    const c = brain();
    const m = lived(c);
    const id = begin(c);
    // The dream's changes land a moment after it began, as they do for real.
    offsetMs += 2_000;
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [m.a, m.b], text: "Migrations before the container boots." },
        { action: "gist", text: "Order matters at boot.", sources: [m.old] },
      ],
    });
    if (!out.ok) throw new Error("refused");
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    c.store.advanceClock("2026-09-27");
    const s = c.dreams.status("2026-09-27");
    expect(s.newSince).toBe(0);
    expect(s.reason).toBe("too-little-new");
  });

  test("a dream's replay earlier in the day does not take the lane day of an organic return", () => {
    const c = brain();
    const m = lived(c);
    const id = begin(c);
    const out = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "replayed", id: m.old }] });
    if (!out.ok) throw new Error("refused");
    expect(out.results[0]?.reason).toBe("replayed");
    const before = c.store.physicsOf(m.old).returns ?? 0;
    // The owner keeps working the same lived day and the memory comes back, cued.
    const r = c.store.reinforce(m.old, c.store.livedDay(), "referenced", { cued: true });
    expect(r.credited).toBe(true);
    expect(r.ret).toMatchObject({ counted: true, weight: 0 });
    const p = c.store.physicsOf(m.old);
    expect(p.returnDays).toBe(1);
    expect(p.returns).toBeCloseTo(before, 10);
    // A second awake use the same day is still not a second lane day.
    expect(c.store.reinforce(m.old, c.store.livedDay(), "referenced", { cued: true }).ret?.counted ?? false).toBe(false);
  });
});

describe("review of #251: the upgrade says what it found truthfully", () => {
  // The `<base>/store` layout, so the copy before migrating has a home.
  const storeDir = (): string => join(dir, "store");

  test("the v8 upgrade record counts live memories — not chapters, schema rows or archived rows", () => {
    const s = Store.open({ dir: storeDir() });
    const live = s.put({ type: "memory", kind: "fact", body: "A live memory that stays." });
    s.put({ type: "memory", kind: "fact", body: "Another live memory that stays too." });
    const gone = s.put({ type: "memory", kind: "fact", body: "An archived memory." });
    s.archive(gone, "test");
    s.put({ type: "episode", kind: "self", body: "A chapter of my own." });
    s.put({ type: "schema", kind: "person", body: "Card: Sarah", meta: { role: "entity", name: "Sarah" } });
    s.close();
    stripToV7(storeDir());
    const again = Store.open({ dir: storeDir() });
    try {
      const upgrade = JSON.parse(again.getMeta(V8_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
      expect(upgrade["rows"]).toBe(2);
      // …while every row the upgrade found keeps the old path.
      expect(again.row(gone)?.legacy).toBe(1);
      expect(again.row(live)?.legacy).toBe(1);
    } finally {
      again.close();
    }
  });

  test("the census sees the rows the old rules were about to make core, which the lanes will not", () => {
    const s = Store.open({ dir: storeDir() });
    s.advanceClock("2026-09-01");
    // A fact the pre-v8 rule would promote at its next consolidation: claimed
    // 0.95 (+0.2 consolidated) and reinforced on three lived days.
    const road = s.put({
      type: "memory",
      kind: "fact",
      body: "The release train leaves every other Thursday at noon.",
      salience: { relevance: 0.9, emotional: 0.2, predictive: 0.9, claimed: 0.95 },
      physics: { birthDay: 0, lastUsedDay: 0, uses: 3, reinforcedDays: 3, consolidated: true },
    });
    // One that is not on the road: two days only.
    s.put({
      type: "memory",
      kind: "fact",
      body: "The staging box is rebuilt every Monday morning.",
      salience: { relevance: 0.9, emotional: 0.2, predictive: 0.9, claimed: 0.95 },
      physics: { birthDay: 0, lastUsedDay: 0, uses: 2, reinforcedDays: 2, consolidated: true },
    });
    s.advanceClock("2026-09-02");
    s.close();
    stripToV7(storeDir());
    const again = Store.open({ dir: storeDir() });
    try {
      runCycle({ store: again, date: "2026-09-03" });
      const census = JSON.parse(again.getMeta(V8_CENSUS_KEY) ?? "null") as UpgradeCensus | null;
      expect(census).toMatchObject({ bandDown: 0, weaker: 0, pruneSooner: 0, v7WouldPromote: 1 });
      expect(v7WouldPromote(again.physicsOf(road), again.livedDay())).toBe(true);
      // The lanes do not take it: a fact is not about me.
      expect(again.physicsOf(road).promotedIdentity).toBe(false);
    } finally {
      again.close();
    }
  });
});
