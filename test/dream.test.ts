/**
 * Dreaming (2026-09-26, `core/dream/`): the ask, the bundle, every change a
 * dream may make and the ones it may not, the journal, undo — and the hazard:
 * a dream must not become a lived memory by the back door.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called:
 * the "dreamer" here is the test, calling the module the way the MCP tool does.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { deliverTurn } from "../src/adapters/claude-code/bin/hook.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_MARK, DREAM_TUNABLES, dreamOpener } from "../src/core/dream/index.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { TUNABLES as REMEMBER_TUNABLES, enters } from "../src/core/remember/index.js";
import type { SweepChunk } from "../src/core/remember/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
let offsetMs = 0;

beforeEach(() => {
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-dream-"));
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

function brain(opts: { owner?: boolean; observer?: boolean } = {}): Counterpart {
  const c = Counterpart.open({
    dir,
    owner: opts.owner ?? true,
    ...(opts.observer === true ? { observer: true } : { identity: { name: "Mike" } }),
    now: () => Date.now() + offsetMs,
  });
  open.push(c);
  return c;
}

function goQuiet(): void {
  offsetMs += REMEMBER_TUNABLES.CRASH_STALE_MS + 60_000;
}

const SESSION = "s-dream";

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    ...over,
  });
}

/** A store with a lived day behind it and a few new memories today. */
function lived(c: Counterpart): { a: string; b: string; old: string; person: string; self: string } {
  c.store.advanceClock("2026-09-10");
  const old = mem(c, "The deploy script needs the migration step before the container starts.", {
    physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() },
  });
  // Ten lived days pass: the old memory is well outside a first dream's week.
  for (let d = 11; d <= 26; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  const day = c.store.livedDay();
  const at = { physics: { birthDay: day, lastUsedDay: day } };
  const a = mem(c, "The migration step must run before the container boots, or it boots empty.", at);
  const b = mem(c, "Run the migration before starting the container, otherwise the container starts empty.", at);
  const person = mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { ...at, kind: "person" });
  const self = mem(c, "I say what I do not know before I guess.", { ...at, kind: "self" });
  return { a, b, old, person, self };
}

function begin(c: Counterpart): { id: string; shown: string[] } {
  const out = c.dreams.begin({ session: SESSION, scope: "/proj" });
  if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
  return { id: out.bundle.dream, shown: Object.keys(out.bundle.memories) };
}

// ---------------------------------------------------------------------------
// begin — the bundle, through recall's gates
// ---------------------------------------------------------------------------

describe("begin: the bundle", () => {
  test("new memories since the last dream, each with older neighbours; recall's gates hold", () => {
    const c = brain({ owner: false });
    const m = lived(c);
    const day = c.store.livedDay();
    const secret = mem(c, "A confidential note about the deploy migration container.", {
      meta: { confidential: true },
      physics: { birthDay: day, lastUsedDay: day },
    });
    const guarded = mem(c, "A protected note about the deploy migration container.", {
      physics: { birthDay: day, lastUsedDay: day, protected: true },
    });
    const out = c.dreams.begin({ session: SESSION });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const b = out.bundle;
    const fresh = b.fresh.map((f) => f.id);
    expect(fresh).toContain(m.a);
    expect(fresh).toContain(m.b);
    expect(fresh).not.toContain(m.old);
    // The older memory arrives as a neighbour, not as new.
    expect(b.fresh.flatMap((f) => f.neighbours)).toContain(m.old);
    // Not the owner's session: confidential stays out; protected always does.
    expect(Object.keys(b.memories)).not.toContain(secret);
    expect(Object.keys(b.memories)).not.toContain(guarded);
    // The text carries the mark, so it can never be captured as lived.
    expect(out.text.startsWith(dreamOpener(b.dream))).toBe(true);
    // The shown ids are recorded on the dream.
    expect(JSON.parse(c.store.dream(b.dream)?.shown ?? "[]")).toEqual(Object.keys(b.memories));
  });

  test("refuses under observer, with nothing new, and a second time the same lived day", () => {
    brain().close();
    open.splice(0);
    const o = brain({ observer: true });
    expect(o.dreams.begin({ session: SESSION })).toEqual({ ok: false, reason: "observer" });
    o.close();
    open.splice(0);

    const c = brain();
    expect(c.dreams.begin({ session: SESSION })).toEqual({ ok: false, reason: "nothing-new" });
    lived(c);
    const { id } = begin(c);
    expect(c.dreams.journal({ dream: id, session: SESSION, text: "I dreamed of containers booting empty." }).ok).toBe(true);
    expect(c.dreams.begin({ session: SESSION })).toEqual({ ok: false, reason: "dreamed-today" });
  });
});

// ---------------------------------------------------------------------------
// propose — every change, within limits, and what a dream cannot do
// ---------------------------------------------------------------------------

describe("propose: what a dream may change", () => {
  test("merge: one memory in better words; the originals kept, archived with a forwarding address", () => {
    const c = brain();
    const m = lived(c);
    c.store.addFeelings(m.a, [{ whose: "owner", core: "fear", emotion: "anxious", strength: 0.7, carriedBy: "the empty boot" }]);
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [{ action: "merge", ids: [m.a, m.b], text: "Run the migration before the container boots, or it boots empty." }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const merged = out.results[0]?.id as string;
    expect(out.results[0]).toMatchObject({ ok: true, reason: "merged" });
    for (const orig of [m.a, m.b]) {
      const row = c.store.row(orig);
      expect(row?.archived).toBe(1);
      expect(row?.archived_reason).toBe("dream-merge");
      expect(row?.superseded_by).toBe(merged);
      expect(c.store.versions(orig).at(-1)?.successor_id).toBe(merged);
      expect(c.store.readVersion(orig, c.store.versions(orig).at(-1)?.seq ?? 0).body.length).toBeGreaterThan(0);
    }
    // At least as strong as what it was made from: the feeling travelled.
    expect(c.store.feelingsFor(merged).length).toBe(1);
    expect(c.store.readProse(merged).meta["dream"]).toBe(id);
  });

  test("link, replay, gist, contradiction, feeling-now, nominate — each recorded", () => {
    const c = brain();
    const m = lived(c);
    // A memory with a strong feeling to soften, made a few days before.
    c.store.addFeelings(m.old, [{ whose: "self", core: "fear", emotion: "anxious", strength: 0.5, carriedBy: "x" }]);
    // v9: something awake already said this one is the craft, not about me.
    c.store.setAbout(m.a, "work", { by: "writer" });
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "link", a: m.a, b: m.old },
        { action: "replayed", id: m.old },
        { action: "gist", text: "Container boot order keeps biting: migrations first.", sources: [m.a, m.old] },
        { action: "contradiction", a: m.a, b: m.b },
        { action: "feeling-now", id: m.old, core: "fear", emotion: "anxious", strength: 0.9, carried_by: "less now" },
        { action: "nominate-core", id: m.self, why: "It is how I work." },
        { action: "nominate-core", id: m.a, why: "not about me" },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.results;
    expect(r.map((x) => [x.action, x.ok])).toEqual([
      ["link", true],
      ["replayed", true],
      ["gist", true],
      ["contradiction", true],
      ["feeling-now", true],
      ["nominate-core", true],
      ["nominate-core", true],
    ]);
    // link: both ways.
    expect(c.store.edgesFrom(m.a).some((e) => e.dst === m.old)).toBe(true);
    expect(c.store.edgesFrom(m.old).some((e) => e.dst === m.a)).toBe(true);
    // replay: a return at half weight, never a use.
    const p = c.store.physicsOf(m.old);
    expect(p.uses).toBe(0);
    expect(p.returns).toBeGreaterThan(0);
    expect(p.returns).toBeLessThanOrEqual(PHYSICS.DREAM_RETURN_WEIGHT);
    expect(p.returnDays).toBe(0);
    // gist: dreamed, starting low.
    const gist = r[2]?.id as string;
    expect(c.store.row(gist)?.source).toBe("dreamed");
    expect(c.store.readProse(gist).title?.startsWith("Dreamed: ")).toBe(true);
    expect(c.store.physicsOf(gist).salience.claimed).toBe(PHYSICS.DREAMED_CLAIM_CEILING);
    // feeling-now: capped at how strongly it was ever felt.
    expect(r[4]?.reason).toBe("recorded-capped-at-peak");
    expect(Math.max(...c.store.feelingsFor(m.old).map((f) => f.strength))).toBe(0.5);
    // nominate: recorded, not promoted.
    expect(c.store.coreEvents({ memoryId: m.self, action: "nominated" }).length).toBe(1);
    expect(c.store.physicsOf(m.self).promotedIdentity).toBe(false);
    // Marked work by something awake: nominated all the same since 2026-09-28
    // (was refused `not-about-me`) — a nomination promotes nothing.
    expect(r[6]?.reason).toBe("nominated");
    expect(r[6]?.note).toContain("marked work");
  });

  test("links go through the edge module: about one co-activation, from the DECAYED weight, and counted on the row", () => {
    const c = brain();
    const m = lived(c);
    const day = c.store.livedDay();
    // An old strong a–old edge, long faded: a re-link must not bring it back.
    c.store.linkMany([
      { src: m.a, dst: m.old, weight: 0.9, day: day - 120 },
      { src: m.old, dst: m.a, weight: 0.9, day: day - 120 },
    ]);
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "link", a: m.a, b: m.old },
        { action: "link", a: m.a, b: m.b },
        { action: "gist", text: "Migrations before boot, every time.", sources: [m.a, m.b, m.old] },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(DREAM_TUNABLES.LINK_WEIGHT).toBeCloseTo(c.associate.tunables.HEBB_RATE, 10);
    // Raised to the proposal from the DECAYED weight, not the stored 0.9.
    expect(c.associate.weightAt(m.a, m.old, day)).toBeCloseTo(DREAM_TUNABLES.LINK_WEIGHT, 10);
    expect(c.associate.weightAt(m.a, m.b, day)).toBeCloseTo(DREAM_TUNABLES.LINK_WEIGHT, 10);
    const gist = out.results[2]?.id as string;
    expect(c.associate.weightAt(gist, m.old, day)).toBeCloseTo(DREAM_TUNABLES.LINK_WEIGHT, 10);
    const row = c.store.eventLog({ name: "dream.changed", order: "desc", limit: 1 })[0];
    const payload = JSON.parse(String(row?.payload ?? "{}")) as Record<string, unknown>;
    expect(payload["gistLinks"]).toBe(3);
  });

  test("a proposal lands only where there is room: a full memory gets no-room, and learned links stay", () => {
    const c = brain();
    const m = lived(c);
    const day = c.store.livedDay();
    // `old` is full: 32 learned links at 0.1 (sum 3.2, at the count cap).
    const others = Array.from({ length: 32 }, (_, i) => mem(c, `unrelated filler memory number ${String(i)} about gardening`));
    c.store.linkMany(others.flatMap((o) => [{ src: m.old, dst: o, weight: 0.1, day }]));
    const learned = c.store.edgesFrom(m.old).map((e) => [e.dst, e.weight]);
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "link", a: m.a, b: m.old },
        { action: "gist", text: "Migrations before boot, every time.", sources: [m.a, m.old, m.b] },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results[0]?.ok).toBe(false);
    expect(out.results[0]?.reason).toBe("no-room");
    expect(out.results[1]?.ok).toBe(true);
    expect(out.results[1]?.note).toContain("linked to 2 of 3 sources");
    // Nothing waking use learned was evicted or scaled.
    expect(c.store.edgesFrom(m.old).map((e) => [e.dst, e.weight])).toEqual(learned);
    const gist = out.results[1]?.id as string;
    const change = c.store.dreamChanges(id).find((x) => x.action === "gist");
    expect(JSON.parse(String(change?.detail))["linked"]).toEqual([m.a, m.b]);
    expect(JSON.parse(String(change?.detail))["noRoom"]).toBe(1);
    expect(c.store.edgesFrom(gist).map((e) => e.dst).sort()).toEqual([m.a, m.b].sort());
    const row = c.store.eventLog({ name: "dream.changed", order: "desc", limit: 1 })[0];
    const payload = JSON.parse(String(row?.payload ?? "{}")) as Record<string, unknown>;
    expect(payload["gistLinks"]).toBe(2);
    expect(payload["linkNoRoom"]).toBe(2);
    expect(payload["linkFrozen"]).toBe(0);
    expect(payload["linkFailed"]).toBe(0);
  });

  test("a memory pinned after it was shown gets no link: its edges are frozen", () => {
    const c = brain();
    const m = lived(c);
    const { id } = begin(c);
    // Pinned mid-dream: the bundle's own gate refuses it first (a dream never
    // sees a pinned memory), and the edge module's freeze stands behind that.
    c.store.updatePhysics(m.b, { protected: true });
    const out = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "link", a: m.a, b: m.b }] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results[0]?.ok).toBe(false);
    expect(c.store.edgesFrom(m.a).some((e) => e.dst === m.b)).toBe(false);
    expect(c.associate.propose([{ a: m.a, b: m.b }]).frozen).toBe(1);
  });

  test("a dream cannot strengthen what a dream wrote: its gist rises only awake", () => {
    const c = brain();
    const m = lived(c);
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [{ action: "gist", text: "Boot order again.", sources: [m.a] }],
    });
    if (!out.ok) throw new Error("refused");
    const gist = out.results[0]?.id as string;
    const again = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "replayed", id: gist },
        { action: "merge", ids: [gist, m.b], text: "Merged with a dream." },
      ],
    });
    if (!again.ok) throw new Error("refused");
    expect(again.results.map((r) => r.reason)).toEqual(["dreamed-rises-only-awake", "dreamed-rises-only-awake"]);
    expect(c.store.physicsOf(gist).returns).toBe(0);
  });

  test("an undone dream does not count: the ask and begin agree", () => {
    const c = brain();
    lived(c);
    const { id } = begin(c);
    const shown = JSON.parse(c.store.dream(id)?.shown ?? "[]") as string[];
    c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "link", a: shown[0] as string, b: shown[1] as string }] });
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    // The CALENDAR day (2026-09-28): the dream is dated the store's today.
    expect(c.dreams.status(c.store.today()).reason).toBe("dreamed-today");
    c.dreams.undo(id);
    expect(c.dreams.lastDream()).toBeNull();
    expect(c.dreams.status("2026-09-27").reason).toBe("due");
    expect(c.dreams.begin({ session: SESSION }).ok).toBe(true);
  });

  test("a dream touches only what it was shown, never core, never past its limits", () => {
    const c = brain();
    const m = lived(c);
    const { id } = begin(c);
    const later = mem(c, "Written after the dream began.", { physics: { birthDay: 9, lastUsedDay: 9 } });
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "link", a: m.a, b: later },
        { action: "delete", id: m.a },
        ...Array.from({ length: DREAM_TUNABLES.LIMITS.link + 1 }, () => ({ action: "link", a: m.a, b: m.b })),
      ],
    });
    if (!out.ok) throw new Error("refused");
    expect(out.results[0]?.reason).toBe("not-shown-or-gone");
    expect(out.results[1]?.reason).toBe("unknown-action");
    expect(out.results.at(-1)?.reason).toBe("limit-reached");
    expect(c.store.row(m.a)?.archived).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// journal, and undo
// ---------------------------------------------------------------------------

describe("journal and undo", () => {
  test("the journal is kept as a dream — never a memory — and the hand-back carries the mark", () => {
    const c = brain();
    lived(c);
    const before = c.store.countMemories();
    const { id } = begin(c);
    const out = c.dreams.journal({ dream: id, session: SESSION, title: "Boot order", text: "ZQDREAMJOURNAL I dreamed the container kept booting empty." });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.handBack.startsWith(dreamOpener(id))).toBe(true);
    expect(c.store.dream(id)).toMatchObject({ state: "journaled", title: "Boot order" });
    expect(c.store.countMemories()).toBe(before);
    for (const mid of c.store.list()) expect(c.store.row(mid)?.body ?? "").not.toContain("ZQDREAMJOURNAL");
    // Closed: no more changes.
    expect(c.dreams.propose({ dream: id, session: SESSION, changes: [] })).toEqual({ ok: false, reason: "dream-closed" });
  });

  test("short words are fine; a credential in a dream's words is redacted before anything is stored", () => {
    const c = brain();
    const m = lived(c);
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [m.a, m.b], text: "Migrate first. Key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
        { action: "nominate-core", id: m.self, why: "It is how I work." },
      ],
    });
    if (!out.ok) throw new Error("refused");
    const merged = out.results[0]?.id as string;
    expect(c.store.readProse(merged).body).toContain("Migrate first.");
    expect(c.store.readProse(merged).body).not.toContain("sk-ant-api03");
    expect(c.store.coreEvents({ memoryId: m.self, action: "nominated" })[0]?.reason).toBe("It is how I work.");
    expect(c.dreams.journal({ dream: id, session: SESSION, text: "Short dream." }).ok).toBe(true);
  });

  test("undo reverses the whole batch", () => {
    const c = brain();
    const m = lived(c);
    c.store.addFeelings(m.old, [{ whose: "self", core: "fear", emotion: "anxious", strength: 0.5, carriedBy: "x" }]);
    const { id } = begin(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [m.a, m.b], text: "Migrations before the container boots." },
        { action: "link", a: m.person, b: m.old },
        { action: "replayed", id: m.old },
        { action: "gist", text: "Order matters at boot.", sources: [m.old] },
        { action: "feeling-now", id: m.old, core: "fear", emotion: "anxious", strength: 0.2 },
        { action: "nominate-core", id: m.self, why: "mine" },
      ],
    });
    if (!out.ok) throw new Error("refused");
    const merged = out.results[0]?.id as string;
    const gist = out.results[3]?.id as string;
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });

    const undone = c.dreams.undo(id);
    expect(undone).toMatchObject({ ok: true, reversed: 6 });
    for (const orig of [m.a, m.b]) {
      expect(c.store.row(orig)).toMatchObject({ archived: 0, superseded_by: null });
    }
    expect(c.store.row(merged)?.archived).toBe(1);
    expect(c.store.row(gist)?.archived).toBe(1);
    expect(c.store.edgesFrom(m.person).some((e) => e.dst === m.old)).toBe(false);
    expect(c.store.physicsOf(m.old)).toMatchObject({ returns: 0, lastDreamDay: null });
    expect(c.store.feelingsFor(m.old).length).toBe(1);
    expect(c.store.coreEvents({ memoryId: m.self }).length).toBe(0);
    expect(c.store.dream(id)?.state).toBe("undone");
    // Idempotent.
    expect(c.dreams.undo(id).reversed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// the ask
// ---------------------------------------------------------------------------

describe("the ask: once a day, snoozed by a no", () => {
  test("due with enough new memory; once per calendar day; a decline snoozes it (setting ask)", () => {
    const c = brain();
    lived(c);
    expect(c.dreams.setSetting("ask", { by: "owner" }).ok).toBe(true);
    const line = c.dreams.askLine({ at: "2026-09-26", session: SESSION });
    expect(line).not.toBeNull();
    expect(line).toContain('Say "dream" to start, or "dream on your own" to let me do it each day.');
    expect(line).toContain('phase "launch"');
    // Once a day, across sessions.
    expect(c.dreams.askLine({ at: "2026-09-26", session: "s-other" })).toBeNull();
    c.dreams.decline({ at: "2026-09-27", session: SESSION });
    expect(c.dreams.status("2026-09-27").reason).toBe("declined-today");
    expect(c.dreams.askLine({ at: "2026-09-27", session: SESSION })).toBeNull();
  });

  test("not due after a dream this lived day, nor with too little new", () => {
    const c = brain();
    // A first lived day has no night behind it; later, with nothing new, still no ask.
    expect(c.dreams.status("2026-09-26").reason).toBe("first-day");
    c.store.advanceClock("2026-09-01");
    c.store.advanceClock("2026-09-02");
    expect(c.dreams.status("2026-09-26").reason).toBe("too-little-new");
    lived(c);
    const { id } = begin(c);
    c.dreams.journal({ dream: id, session: SESSION, text: "A dream." });
    const today = c.store.today();
    expect(c.dreams.askLine({ at: today, session: SESSION })).toBeNull();
    expect(c.dreams.status(today).reason).toBe("dreamed-today");
  });

  // Kept from test/dream-preview.test.ts (removed with `previewAsk`, 2026-10-09):
  // what it pinned of the gate itself, asked through `status` and `askLine`.
  const AT = "2026-09-26";
  const days = (c: Counterpart): number => {
    for (let d = 10; d <= 26; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    return c.store.livedDay();
  };
  const fresh = (c: Counterpart, day: number, n: number, over: Partial<PutInput> = {}): void => {
    for (let i = 0; i < n; i += 1) {
      mem(c, `A new memory, number ${String(i)}, about the migration that runs before the container boots.`, { physics: { birthDay: day, lastUsedDay: day }, ...over });
    }
  };

  test("confidential memories count only toward the owner's own gate, and the line names the count", () => {
    // Two plain and three confidential new memories: a guest's gate sees two
    // (too little), the owner's sees five (due).
    const guest = brain({ owner: false });
    const day = days(guest);
    fresh(guest, day, 2);
    fresh(guest, day, 3, { meta: { confidential: true } });
    expect(guest.dreams.status(AT)).toMatchObject({ due: false, reason: "too-little-new", newSince: 2 });
    expect(guest.dreams.askLine({ at: AT, session: SESSION })).toBeNull();
    guest.close();
    open.splice(0);

    const owner = brain({ owner: true });
    expect(owner.dreams.status(AT)).toMatchObject({ due: true, reason: "due" });
    expect(owner.dreams.askLine({ at: AT, session: SESSION })).toContain("(5 new memories)");
  });

  test("the line counts the whole queue, past what one night takes; once raised, the day is asked", () => {
    const c = brain();
    fresh(c, days(c), 45);
    expect(c.dreams.status(AT).reason).toBe("due");
    expect(c.dreams.askLine({ at: AT, session: "s-first" })).toContain("(45 new memories)");
    expect(c.dreams.status(AT).reason).toBe("asked-today");
    expect(c.dreams.askLine({ at: AT, session: SESSION })).toBeNull();
  });

  test("a flagged contradiction is raised once, awake, the next session", () => {
    const c = brain();
    const m = lived(c);
    const { id } = begin(c);
    c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "contradiction", a: m.a, b: m.person }] });
    const lines = c.dreams.raiseLines({ session: "s-next" });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(m.a);
    expect(lines[0]).toContain("raise it with Mike");
    expect(lines[0]).not.toMatch(/\b(he|him|his|himself)\b/i);
    expect(c.dreams.raiseLines({ session: "s-next" })).toEqual([]);
  });

  test("the launch prompt names the session, wakes the dreamer to reflect, and asks for the finish call's text unchanged", () => {
    const c = brain();
    const prompt = c.dreams.launchPrompt({ session: SESSION });
    expect(prompt.startsWith(DREAM_MARK)).toBe(true);
    expect(prompt).toContain(`session: ${SESSION}`);
    // v9: dream → journal → reflect, as distinct acts; 2026-09-28: the page
    // writer FIRST, in the one nightly run (the owner's order).
    expect(prompt.indexOf('phase "writer"')).toBeLessThan(prompt.indexOf('phase "begin"'));
    expect(prompt.indexOf('phase "begin"')).toBeLessThan(prompt.indexOf('phase "journal"'));
    expect(prompt.indexOf('phase "journal"')).toBeLessThan(prompt.indexOf("reflect tool"));
    expect(prompt).toContain("exactly the text the reflection's finish call returns");
  });
});

// ---------------------------------------------------------------------------
// the hazard: the dream never becomes lived memory by the back door
// ---------------------------------------------------------------------------

describe("a dream never becomes a lived memory through the sweep", () => {
  const typed = (text: string): Record<string, unknown> => ({
    type: "user",
    origin: { kind: "human" },
    promptSource: "typed",
    message: { role: "user", content: text },
  });
  /** The subagent's hand-back, as the host writes it into the PARENT's transcript. */
  const handback = (text: string): Record<string, unknown> => ({
    type: "user",
    isMeta: true,
    origin: { kind: "peer", from: "a0000000000000001" },
    promptSource: "system",
    message: {
      role: "user",
      content: [
        "Another Claude session sent a message:",
        '<agent-message from="a0000000000000001">',
        "[Subagent hand-back] The text below is the final report of a subagent this session delegated to.",
        text,
        "</agent-message>",
      ].join("\n"),
    },
  });
  const assistant = (text: string): Record<string, unknown> => ({
    type: "assistant",
    message: { role: "assistant", model: "claude-test", content: [{ type: "text", text }] },
  });

  test("seed, dream, run the sweep: zero rows minted from the dream's words", async () => {
    const c = brain();
    lived(c);
    const { id } = begin(c);
    const journal = c.dreams.journal({ dream: id, session: SESSION, text: "ZQDREAMWORDS the container dreamed it booted twice." });
    if (!journal.ok) throw new Error("journal refused");
    const handBack = `${journal.handBack} ZQDREAMWORDS`;

    const raw = [
      typed(
        "Let's look at why the staging container keeps booting without its tables. It happened again this morning after the deploy, and the logs show the app starting before the schema exists, which is the third time this week.",
      ),
      handback(handBack),
      assistant(
        "The migration step runs after the container starts; that ordering is the bug. Moving the migration into the entrypoint before the server process fixes it, and a health check that fails without tables would have caught it days ago.",
      ),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    const read = parseTranscript(raw);
    const handbackTurn = read.turns.find((t) => t.text.includes("ZQDREAMWORDS"));
    expect(handbackTurn?.source).toBe("dream");
    expect(enters({ role: "user", text: handBack, source: "conversation" })).toBe(false);

    c.captureSpans({ session: "s-lived", scope: "/proj", turns: read.turns });
    c.boundary({ session: "s-lived", scope: "/proj", kind: "stop" });
    goQuiet();
    const prompts: string[] = [];
    await c.sweepFallback({
      interpret: async (chunk: SweepChunk) => {
        prompts.push(chunk.prompt);
        // An interpreter that would mint the dream's words if it were shown them.
        const content = chunk.prompt.includes("ZQDREAMWORDS")
          ? "ZQDREAMWORDS: the container booted twice last night."
          : "The staging container boots before its migration runs, so it starts without tables.";
        return { proposals: [{ content, kind: "fact" }], stopReason: "end_turn" };
      },
    });
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.join("\n")).not.toContain("ZQDREAMWORDS");
    for (const mid of c.store.list()) expect(c.store.row(mid)?.body ?? "").not.toContain("ZQDREAMWORDS");
  });
});

// ---------------------------------------------------------------------------
// the ask, through the real hook
// ---------------------------------------------------------------------------

describe("the ask reaches a session through user-prompt-submit, once a day — the person sees it (2026-09-29)", () => {
  test("the model's context and the person's terminal carry it once; a second session that day does not; the page writer never does", () => {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9_000, owner: true },
      { command: "/bin/true", args: ["runner"], spawner: (_p: SpawnPlan) => ({ pid: 4242 }) },
    );
    open.push(a.counterpart);
    lived(a.counterpart);
    const input = (over: Partial<HookInput>): HookInput => {
      const hook: HookInput = { sessionId: "s1", scope: "proj", turns: [], at: "2026-09-26", prompt: "good morning", ...over };
      recordSession(dir, { sessionId: hook.sessionId, scope: hook.scope, phase: "start" });
      return hook;
    };
    // The headless nightly run's child is told nothing, and claims nothing.
    expect(a.userPromptSubmit(input({ sessionId: "pw", nightRun: true })).injection).not.toContain("dream");
    const first = a.userPromptSubmit(input({ sessionId: "s1" }));
    // The default setting, `ask` (2026-09-29): the model is told what each
    // answer means, and the PERSON is shown the question.
    expect(first.injection).toContain('phase "launch"');
    expect(first.dream?.notice).toContain('Say "dream" to start, or "dream on your own"');
    // Nothing claimed until the delivery carries the person's line.
    expect(a.counterpart.store.dreamAsk("2026-09-26")).toBeUndefined();
    const doors = { updateNotice: () => null, markUpdateNotice: () => false, claimDream: a.claimDream.bind(a) };
    const out = deliverTurn("user-prompt-submit", first, {}, null, doors, input({ sessionId: "s1" }));
    expect((JSON.parse(out.stdout) as { systemMessage: string }).systemMessage).toBe(first.dream?.notice ?? "-");
    expect(a.counterpart.store.dreamAsk("2026-09-26")?.state).toBe("offered");
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dream).toBeUndefined();
    expect(a.userPromptSubmit(input({ sessionId: "s1" })).injection).not.toContain('Say "dream"');
  });
});
