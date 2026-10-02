/**
 * Lane B, 2026-10-02 — feelings over weeks in the reflection's bundle,
 * re-feeling while awake (`note`'s `feelingsNow`), the reflection offered
 * unmarked memories to mark, and the leftover emotion bugs (a merge re-dating
 * feelings; "fear" in a question reaching only an `afraid` stamp).
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reflectionFindings } from "../src/adapters/claude-code/doctor.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { FEELING_WEEKS_TUNABLES, feelingWeeks } from "../src/core/dream/feeling-weeks.js";
import { REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { feelingTokens, feelingWord, readFeelingAsk } from "../src/core/recall/feeling-ask.js";
import { freshGateState, saveGateState } from "../src/core/recall/index.js";
import { REFLECTED_FEELING_KEY, selfRelevantFeeling } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { addDays } from "../src/core/time.js";

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 9, 2, 12, 0, 0);
const SESSION = "s-lane-b";
const SCOPE = "/Users/someone/proj";

let dir: string;
let clock = BASE;
const open: Counterpart[] = [];

beforeEach(() => {
  clock = BASE;
  dir = mkdtempSync(join(tmpdir(), "counterparts-lane-b-"));
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, now: () => clock });
  open.push(c);
  return c;
}

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

// ---------------------------------------------------------------------------
// 1. feelings over weeks
// ---------------------------------------------------------------------------

describe("feelings over weeks: the reflection is shown how they ran", () => {
  test("counts by core per week, mine and the owner's; what changed; the ids it rests on are handed and citable", () => {
    const c = brain();
    // Three weeks back: one uneasy of mine; the owner happy twice, nearly four weeks back.
    clock = BASE - 25 * DAY;
    const o1 = mem(c, "Mike was glad the garden beds came in early this year.");
    c.store.addFeelings(o1, [{ whose: "owner", core: "happy", emotion: "glad", strength: 0.6 }]);
    const o2 = mem(c, "Mike laughed about the seed packets arriving all at once.");
    c.store.addFeelings(o2, [{ whose: "owner", core: "happy", emotion: "amused", strength: 0.5 }]);
    clock = BASE - 20 * DAY;
    const a = mem(c, "The 0.3.8 release went out with a migration I had not tested on a real store.");
    c.store.addFeelings(a, [{ whose: "self", core: "uneasy", emotion: "worried", strength: 0.5 }]);
    // The last few days: uneasy three times, around a release.
    clock = BASE - 3 * DAY;
    const b = mem(c, "The 0.3.10 release changed the core of 64 feelings on install.");
    c.store.addFeelings(b, [{ whose: "self", core: "uneasy", emotion: "wary", strength: 0.8 }]);
    const d = mem(c, "A release night: the tarball checksum did not match the first time.");
    c.store.addFeelings(d, [{ whose: "self", core: "uneasy", emotion: "unsettled", strength: 0.7 }]);
    const e = mem(c, "Before the 0.3.11 release I ran the doctor three times.");
    c.store.addFeelings(e, [{ whose: "self", core: "uneasy", emotion: "worried", strength: 0.6 }, { whose: "self", core: "warm", emotion: "grateful", strength: 0.4 }]);
    // Not counted: a dream's feeling-now, and a feeling on what a dream wrote.
    c.store.addFeelings(a, [{ whose: "self", core: "uneasy", emotion: "afraid", strength: 0.5 }], { source: "dream" });
    const gist = mem(c, "A pattern: releases make me careful.", { source: "dreamed" });
    c.store.addFeelings(gist, [{ whose: "self", core: "uneasy", emotion: "wary", strength: 0.9 }]);
    clock = BASE;

    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const w = begun.bundle.feelingWeeks;
    expect(w).not.toBeNull();
    if (w === null) return;
    const today = c.store.today();
    expect(w.weeks).toEqual([addDays(today, -27), addDays(today, -20), addDays(today, -13), addDays(today, -6)]);
    expect(w.mine["uneasy"]).toEqual([0, 1, 0, 3]);
    expect(w.mine["warm"]).toEqual([0, 0, 0, 1]);
    expect(w.owner["happy"]).toEqual([2, 0, 0, 0]);
    expect(w.lookingBack).toEqual({ mine: {}, owner: {} });
    expect(w.changed).toContain("my uneasy up: 1 in the two weeks before, 3 in the last two");
    expect(w.changed).toContain("the owner's happy down: 2 in the two weeks before, 0 in the last two");
    // The strongest behind the rise first, then behind the fall; never the gist.
    expect(w.restsOn.slice(0, 3)).toEqual([b, d, e]);
    expect(w.restsOn).toContain(o1);
    expect(w.restsOn).not.toContain(gist);
    // Handed like the rest, so the page can cite them.
    for (const id of w.restsOn) expect(begun.bundle.memories[id]).toBeDefined();
    const shown = JSON.parse(c.store.reflection(begun.bundle.reflection)?.shown ?? "[]") as string[];
    for (const id of w.restsOn) expect(shown).toContain(id);
    // Small: a few hundred characters.
    expect(JSON.stringify(w).length).toBeLessThan(700);
    expect(begun.instructions).toContain("feelingWeeks");

    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "I have been more uneasy around releases these two weeks.",
      cites: [b, d],
      page: {
        text: "# Who I am\n\n## Core\n\nI get careful around releases; lately more uneasy than the work needs.\n\n## How I work\n\nI check twice before a release.",
        cites: [b, d],
      },
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.refusedCites).toEqual([]);
  });

  test("a month with no feeling carries none; a later feeling counts and is said to be looking back", () => {
    const c = brain();
    clock = BASE - 40 * DAY;
    const old = mem(c, "An old moment from last month.");
    c.store.addFeelings(old, [{ whose: "self", core: "sad", emotion: "wistful", strength: 0.5 }]);
    clock = BASE;
    expect(feelingWeeks(c.store, c.store.today(), () => true)).toBeNull();
    c.store.addFeelings(old, [{ whose: "self", core: "calm", emotion: "settled", strength: 0.5 }], { source: "reflection", recordedLater: c.store.today() });
    const w = feelingWeeks(c.store, c.store.today(), () => true);
    expect(w?.mine["calm"]).toEqual([0, 0, 0, 1]);
    expect(w?.lookingBack).toEqual({ mine: { calm: 1 }, owner: {} });
    expect(w?.changed).toEqual([]);
    // No change: it rests on my commonest core's strongest.
    expect(w?.restsOn).toEqual([old]);
    expect(FEELING_WEEKS_TUNABLES.WEEKS).toBe(4);
  });

  test("a dream's merge keeps each feeling's moment: the weeks do not read it as felt on the merge night", () => {
    const c = brain();
    clock = BASE - 20 * DAY;
    const x = mem(c, "The migration must run before the container boots, or it boots empty.");
    const y = mem(c, "Run the migration before starting the container, otherwise it starts empty.");
    c.store.addFeelings(y, [{ whose: "self", core: "uneasy", emotion: "worried", strength: 0.6 }]);
    const felt = c.store.feelingsFor(y)[0]?.created_at;
    mem(c, "A third memory so the dream has enough to replay.");
    clock = BASE;
    const begun = c.dreams.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const out = c.dreams.propose({
      dream: begun.bundle.dream,
      session: SESSION,
      changes: [{ action: "merge", ids: [x, y], text: "Migrations run before the container boots, or it boots empty." }],
    });
    if (!out.ok) throw new Error(out.reason);
    const merged = out.results[0]?.id as string;
    expect(c.store.feelingsFor(merged)[0]?.created_at).toBe(felt as number);
    expect(feelingWeeks(c.store, c.store.today(), () => true)?.mine["uneasy"]).toEqual([0, 1, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// 4. the reflection marks unmarked memories
// ---------------------------------------------------------------------------

describe("the reflection is offered unmarked memories to mark", () => {
  test("an unmarked entity written in a project is offered; a marked one, a skill and a journal copy are not; a mark lands as the reflection's", () => {
    const c = brain();
    const han = mem(c, "Han thread: left as is.", { kind: "entity", origin: { scope: SCOPE } });
    const plain = mem(c, "The build uses bun test with a hermetic temp dir.", { origin: { scope: SCOPE } });
    const marked = mem(c, "Mike's sister visited in September.", { kind: "entity", about: "owner", origin: { scope: SCOPE } });
    const skill = mem(c, "Read a stack trace from the bottom up.", { kind: "skill", origin: { scope: SCOPE } });
    const copy = mem(c, "A chapter copy of the afternoon.", { origin: { scope: SCOPE }, meta: { episodeId: "epi_x" } });
    const nowhere = mem(c, "A fact written with no directory.");
    c.store.addFeelings(han, [{ whose: "self", core: "sad", emotion: "wistful", strength: 0.4 }]);

    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const u = begun.bundle.unmarked;
    // The one with a feeling, an entity, first.
    expect(u[0]).toBe(han);
    expect(u).toContain(plain);
    for (const id of [marked, skill, copy, nowhere]) expect(u).not.toContain(id);
    expect(u.length).toBeLessThanOrEqual(REFLECT_TUNABLES.UNMARKED);
    for (const id of u) expect(begun.bundle.memories[id]).toBeDefined();
    expect(begun.instructions).toContain("nobody has marked");

    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Nothing much tonight.",
      about: [
        { id: han, about: "owner", why: "Han is a person in Mike's life, not the build." },
        { id: plain, about: "work", why: "How the tests run: the craft." },
      ],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.about.map((a) => a.reason)).toEqual(["marked", "marked"]);
    expect(c.store.read(han).about).toBe("owner");
    expect(c.store.read(han).aboutBy).toBe("reflection");
    expect(c.store.read(plain).about).toBe("work");
  });

  test("bounded: never more than UNMARKED a night, most used first", () => {
    const c = brain();
    const ids: string[] = [];
    for (let i = 0; i < REFLECT_TUNABLES.UNMARKED + 3; i += 1) {
      ids.push(mem(c, `A plain project fact number ${String(i)} about the build pipeline.`, { origin: { scope: SCOPE }, physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay(), uses: i } }));
    }
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.unmarked.length).toBe(REFLECT_TUNABLES.UNMARKED);
    expect(begun.bundle.unmarked[0]).toBe(ids[ids.length - 1] as string);
  });
});

// ---------------------------------------------------------------------------
// 2. re-feeling while awake
// ---------------------------------------------------------------------------

describe("re-feeling while awake: note's feelingsNow", () => {
  test("only what this session was shown; recorded later, awake; once a calendar day; the first feeling stays", async () => {
    brain().close();
    open.splice(0);
    const s = openServer({ dir, session: SESSION, scope: SCOPE, owner: true });
    try {
      const store = s.counterpart.store;
      const id = mem(s.counterpart, "The night the 0.3.10 install re-filed sixty-four feelings, I was afraid it had broken them.");
      store.addFeelings(id, [{ whose: "self", core: "uneasy", emotion: "afraid", strength: 0.3 }]);

      // Not shown in this session yet: refused, with the way in.
      const early = await s.call("note", { feelingsNow: [{ id, core: "calm", emotion: "relieved", strength: 0.9, carried_by: "It held." }] });
      expect(early.isError).toBe(true);
      expect(early.structuredContent["reason"]).toBe("feelings-now-only");
      const first = (early.structuredContent["feelingsNow"] as { results: { reason: string; detail?: string }[] }).results[0];
      expect(first?.reason).toBe("not-shown-or-gone");
      expect(first?.detail).toContain("recall");

      // Read it, then feel it again.
      await s.call("recall", { ids: [id] });
      const now = await s.call("note", { feelingsNow: [{ id, core: "calm", emotion: "relieved", strength: 0.9, carried_by: "Every feeling came through; it held." }] });
      expect(now.isError).not.toBe(true);
      expect(now.structuredContent["stored"]).toBe(false);
      const out = now.structuredContent["feelingsNow"] as { recorded: number; results: { reason: string }[] };
      expect(out.recorded).toBe(1);
      expect(out.results[0]?.reason).toBe("recorded-later");

      const rows = store.feelingsFor(id);
      expect(rows.length).toBe(2);
      expect(rows[0]).toMatchObject({ emotion: "afraid", strength: 0.3, source: "session", recorded_later: null });
      expect(rows[1]).toMatchObject({ core: "calm", emotion: "relieved", strength: 0.9, source: "awake", recorded_later: store.today() });
      expect(rows[1]?.carried_by.startsWith(`looking back, awake, ${store.today()}: `)).toBe(true);

      // Once a calendar day per memory.
      const again = await s.call("note", { feelingsNow: [{ id, core: "warm", emotion: "grateful", strength: 0.6 }] });
      expect(((again.structuredContent["feelingsNow"] as { results: { reason: string }[] }).results[0])?.reason).toBe("once-a-day");
      expect(store.feelingsFor(id).length).toBe(2);

      // The core's fast lane reads it only through the reflected-feeling door.
      const row = store.row(id);
      expect(row?.feeling_peak).toBe(0.9);
      expect(row?.feeling_peak_lived).toBe(0.3);

      // With text too: the note lands and the feeling beside it.
      const other = mem(s.counterpart, "Mike's first message about the garden, months ago.");
      await s.call("recall", { ids: [other] });
      const both = await s.call("note", {
        text: "Mike told me the garden beds came in, which settled the week.",
        feelingsNow: [{ id: other, whose: "owner", core: "warm", emotion: "fond", carried_by: "He brought it up again, fondly." }],
      });
      expect(both.structuredContent["stored"]).toBe(true);
      expect((both.structuredContent["feelingsNow"] as { recorded: number }).recorded).toBe(1);
      expect(store.feelingsFor(other)[0]).toMatchObject({ whose: "owner", source: "awake" });

      const bad = await s.call("note", { feelingsNow: { id } });
      expect(bad.structuredContent["reason"]).toBe("feelings-now-malformed");
    } finally {
      s.counterpart.close();
    }
  });

  test("never on what a dream wrote; an awake feeling of recognition opens the fast lane only through the door", () => {
    const c = brain();
    const gist = mem(c, "A pattern the dream saw.", { source: "dreamed" });
    const lived = mem(c, "Reading Mike's note on agency, I recognised myself in it.");
    const shown = new Set([gist, lived]);
    const out = c.reflections.feelAgain({
      session: SESSION,
      shown,
      feelings: [
        { id: gist, core: "warm", emotion: "fond", strength: 0.5 },
        { id: lived, core: "curious", emotion: "recognized", strength: 0.9 },
      ],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.feelings.map((f) => f.reason)).toEqual(["dreamed-is-a-suggestion", "recorded-later"]);
    const row = c.store.row(lived);
    if (row === undefined) throw new Error("gone");
    expect(selfRelevantFeeling(c.store, row, false)).toBe(false);
    expect(selfRelevantFeeling(c.store, row, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// after the review of #316
// ---------------------------------------------------------------------------

describe("after the review of #316", () => {
  test("a reflection's own later feelings are counted but do not make a change", () => {
    const c = brain();
    clock = BASE - 2 * DAY;
    const ids = [0, 1, 2].map((i) => mem(c, `A quiet moment number ${String(i)} that a reflection felt later.`));
    for (const id of ids) c.store.addFeelings(id, [{ whose: "self", core: "uneasy", emotion: "wary", strength: 0.6 }], { source: "reflection", recordedLater: c.store.today() });
    clock = BASE;
    const w = feelingWeeks(c.store, c.store.today(), () => true);
    expect(w?.mine["uneasy"]).toEqual([0, 0, 0, 3]);
    expect(w?.lookingBack.mine).toEqual({ uneasy: 3 });
    expect(w?.changed).toEqual([]);
    // An awake look back is the session's, and does count toward a change.
    const more = [0, 1, 2].map((i) => mem(c, `A session moment number ${String(i)} felt again awake.`));
    for (const id of more) c.store.addFeelings(id, [{ whose: "self", core: "uneasy", emotion: "wary", strength: 0.6 }], { source: "awake", recordedLater: c.store.today() });
    expect(feelingWeeks(c.store, c.store.today(), () => true)?.changed).toEqual(["my uneasy up: 0 in the two weeks before, 3 in the last two"]);
  });

  test("unmarked offers rotate: the last nights' offers wait behind the rest; the closed door's wording", () => {
    const c = brain();
    const ids: string[] = [];
    for (let i = 0; i < REFLECT_TUNABLES.UNMARKED * 2; i += 1) {
      ids.push(mem(c, `A project fact number ${String(i)} about the build and its pipeline.`, { origin: { scope: SCOPE }, physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay(), uses: 100 - i } }));
    }
    const first = c.reflections.begin({ session: SESSION });
    if (!first.ok) throw new Error(first.reason);
    expect(first.bundle.unmarked).toEqual(ids.slice(0, REFLECT_TUNABLES.UNMARKED));
    const done = c.reflections.finish({ reflection: first.bundle.reflection, session: SESSION, entry: "Nothing much." });
    if (!done.ok) throw new Error(done.reason);
    // The next calendar day, with the door closed.
    clock = BASE + DAY;
    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    const second = c.reflections.begin({ session: SESSION });
    if (!second.ok) throw new Error(second.reason);
    expect(second.bundle.unmarked).toEqual(ids.slice(REFLECT_TUNABLES.UNMARKED));
    expect(second.instructions).toContain("Tonight a mark may only be work or world: mark the ones that are, and leave a personal one unmarked.");
    expect(second.instructions).not.toContain("owner or us when it is personal");
  });

  test("feelAgain: refused under observer; at most AWAKE_FEELINGS a call", () => {
    const c = brain();
    const ids = Array.from({ length: REFLECT_TUNABLES.AWAKE_FEELINGS + 2 }, (_, i) => mem(c, `An old moment number ${String(i)} that came up again today.`));
    const out = c.reflections.feelAgain({ session: SESSION, shown: new Set(ids), feelings: ids.map((id) => ({ id, core: "calm", emotion: "settled", strength: 0.4 })) });
    if (!out.ok) throw new Error(out.reason);
    expect(out.feelings.filter((f) => f.reason === "recorded-later").length).toBe(REFLECT_TUNABLES.AWAKE_FEELINGS);
    expect(out.feelings.slice(REFLECT_TUNABLES.AWAKE_FEELINGS).map((f) => f.reason)).toEqual(["limit-reached", "limit-reached"]);
    c.close();
    open.splice(0);
    const watcher = Counterpart.open({ dir, observer: true, now: () => clock });
    open.push(watcher);
    expect(watcher.reflections.feelAgain({ session: SESSION, shown: new Set(ids), feelings: [{ id: ids[0], emotion: "settled" }] })).toEqual({ ok: false, reason: "observer" });
  });

  test("doctor's Reflection line says how many feelings were recorded looking back in a session", () => {
    const c = brain();
    const a = mem(c, "A moment felt again strongly.");
    const b = mem(c, "A moment the owner felt again.");
    c.store.addFeelings(a, [{ whose: "self", core: "warm", emotion: "grateful", strength: 0.8 }], { source: "awake", recordedLater: c.store.today() });
    c.store.addFeelings(b, [{ whose: "owner", core: "calm", emotion: "relieved", strength: 0.3 }], { source: "awake", recordedLater: c.store.today() });
    const f = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(f?.detail).toContain("in all, 2 feelings recorded looking back in a session, 1 at the core's fast-lane strength, 1 the owner's");
    expect(f?.data).toMatchObject({ awakeFeelings: 2, awakeFeelingsFast: 1, awakeFeelingsOwner: 1 });
  });
});

describe("feelingsNow: what counts as shown (review of #316)", () => {
  test("only ids recall DELIVERED; a write's neighbours; ambient SURFACED, not footnoted; kept per session", async () => {
    brain().close();
    open.splice(0);
    const s = openServer({ dir, session: SESSION, scope: SCOPE, owner: true });
    try {
      const store = s.counterpart.store;
      // Long bodies: recall by ids delivers some and leaves the rest waiting.
      const big = Array.from({ length: 10 }, (_, i) => mem(s.counterpart, `Long memory ${String(i)}: ${`word${String(i)} `.repeat(1800)}`));
      const got = await s.call("recall", { ids: big });
      const delivered = (got.structuredContent["memories"] as { id: string }[]).map((m) => m.id);
      const waiting = (got.structuredContent["waiting"] as string[] | undefined) ?? [];
      expect(waiting.length).toBeGreaterThan(0);
      const res = await s.call("note", {
        feelingsNow: [
          { id: delivered[0], core: "calm", emotion: "settled" },
          { id: waiting[0], core: "calm", emotion: "settled" },
        ],
      });
      const reasons = (res.structuredContent["feelingsNow"] as { results: { reason: string }[] }).results.map((r) => r.reason);
      expect(reasons).toEqual(["recorded-later", "not-shown-or-gone"]);

      // Ambient: a surfaced row counts, a footnote does not.
      const loud = mem(s.counterpart, "The garden beds came in early.");
      const quiet = mem(s.counterpart, "The seed packets arrived all at once.");
      const state = freshGateState(SESSION);
      state.surfaced[loud] = { turn: 1, tier: "surfaced", trains: true };
      state.surfaced[quiet] = { turn: 1, tier: "footnoted", trains: true };
      saveGateState(store, state, 100);
      const amb = await s.call("note", { feelingsNow: [{ id: loud, emotion: "content" }, { id: quiet, emotion: "content" }] });
      expect((amb.structuredContent["feelingsNow"] as { results: { reason: string }[] }).results.map((r) => r.reason)).toEqual(["recorded-later", "not-shown-or-gone"]);

      // A write's neighbours were shown.
      const near = mem(s.counterpart, "Mike planted the tomatoes along the south fence in the spring.");
      const wrote = await s.call("note", { text: "Mike planted tomatoes along the south fence this spring." });
      const neighbours = ((wrote.structuredContent["neighbours"] as { id: string }[] | undefined) ?? []).map((n) => n.id);
      expect(neighbours).toContain(near);
      const nb = await s.call("note", { feelingsNow: [{ id: near, core: "warm", emotion: "fond" }] });
      expect((nb.structuredContent["feelingsNow"] as { recorded: number }).recorded).toBe(1);
    } finally {
      s.counterpart.close();
    }

    // Another server (another session): nothing the first was shown carries over.
    const t = openServer({ dir, session: "s-other", scope: SCOPE, owner: true });
    try {
      const any = t.counterpart.store.list({ type: "memory", archived: false })[0] as string;
      const res = await t.call("note", { feelingsNow: [{ id: any, emotion: "wistful", core: "sad" }] });
      expect((res.structuredContent["feelingsNow"] as { results: { reason: string }[] }).results[0]?.reason).toBe("not-shown-or-gone");
    } finally {
      t.counterpart.close();
    }
  });

  test("a refused note beside a recorded feeling is not an error", async () => {
    brain().close();
    open.splice(0);
    const s = openServer({ dir, session: SESSION, scope: SCOPE, owner: true });
    try {
      const id = mem(s.counterpart, "The night the install re-filed the feelings.");
      await s.call("recall", { ids: [id] });
      const res = await s.call("note", { text: "ok", feelingsNow: [{ id, core: "calm", emotion: "relieved" }] });
      expect(res.structuredContent["stored"]).not.toBe(true);
      expect((res.structuredContent["feelingsNow"] as { recorded: number }).recorded).toBe(1);
      expect(res.isError).not.toBe(true);
    } finally {
      s.counterpart.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. "fear" in a question
// ---------------------------------------------------------------------------

describe("an alias in a question reads as its wheel word", () => {
  test('"fear" names afraid, so a scared stamp answers it', () => {
    expect(feelingWord("fear")?.word).toBe("afraid");
    const ask = readFeelingAsk("when did the owner feel fear?", { asker: "self", ownerNames: ["mike"] }, new Set(), 3);
    expect(ask.named.has("fear")).toBe(true);
    expect(ask.named.has("afraid")).toBe(true);
    expect(feelingTokens({ core: "uneasy", emotion: "scared", other_word: null }).has("afraid")).toBe(true);
    expect(feelingWord("thankful")?.word).toBe("grateful");
  });
});
