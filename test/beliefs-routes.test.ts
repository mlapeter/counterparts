/**
 * BELIEFS' OTHER ROUTES (wave 2 lane C3, 2026-10-21): the dream proposes, the
 * reflection adopts or lets go; a session writes one in the moment, rarely;
 * and the owner's correction settles one at once.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is
 * called: the dreamer, the reflecting mind and the session are the test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { TUNABLES as PHYSICS, sal } from "../src/core/physics/index.js";
import { TUNABLES as SCHEMAS } from "../src/core/schemas/tunables.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";
import type { PutInput } from "../src/core/store/index.js";
import { readProseWalking } from "../src/core/store/walk-seam.js";
import { REFLECT_TUNABLES } from "../src/core/dream/reflect.js";

let dir: string;
const open: Counterpart[] = [];
const SESSION = "s-routes";
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-belief-routes-"));
});

afterEach(() => {
  (SCHEMAS as { BELIEFS_BIRTH: boolean }).BELIEFS_BIRTH = true;
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
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => Date.UTC(2026, 8, 1, 12) + dateN * 86_400_000 });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10));
  return c.store.livedDay();
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { session: `sess-${String(day)}`, scope: "/work" },
    ...over,
  });
}

/** A night: a few memories, a dream that proposes `changes`, its journal. */
function dream(c: Counterpart, changes: (ids: { a: string; b: string; c: string }) => Record<string, unknown>[]) {
  nextDay(c);
  for (let i = 0; i < 3; i += 1) nextDay(c);
  const a = mem(c, "Mike: our late-night talks are where the real decisions get made.", { saidBy: "owner", about: "us" });
  const b = mem(c, "We settled the naming question at midnight, both laughing.", { about: "us" });
  const cc = mem(c, "Another late session where the plan finally clicked.", { about: "us" });
  const begun = c.dreams.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`dream refused: ${begun.reason}`);
  const p = c.dreams.propose({ dream: begun.bundle.dream, session: SESSION, changes: changes({ a, b, c: cc }) as never });
  if (!p.ok) throw new Error("propose refused");
  const j = c.dreams.journal({ dream: begun.bundle.dream, session: SESSION, title: "late nights", text: "I dreamed of a lamp left on." });
  if (!j.ok) throw new Error("journal refused");
  return { dream: begun.bundle.dream, results: p.results, a, b, c: cc };
}

describe("the dream proposes; the reflection adopts or lets go", () => {
  test("a candidate is recorded, never minted; the reflection adopts it as a belief born weak, route dream, its lived sources its support", () => {
    const c = brain();
    const before = c.store.list({ type: "schema" }).length;
    const d = dream(c, ({ a, b, c: cc }) => [{ action: "belief-candidate", subject: "us", text: "We decide best late at night.", sources: [a, b, cc] }]);
    expect(d.results[0]).toMatchObject({ ok: true, reason: "proposed" });
    // Never minted by the dream (the self subject is made by the reflection's begin, below).
    expect(c.store.list({ type: "schema" }).length).toBe(before);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const cand = begun.bundle.beliefs?.candidates?.[0];
    expect(cand).toMatchObject({ subject: "us", statement: "We decide best late at night." });
    expect(begun.instructions).toContain("a dream suggests, you decide");
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Late nights.", cites: [], beliefs: { adopt: [{ candidate: cand?.id as string }] } });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.beliefs.adopt[0]).toMatchObject({ ok: true, reason: "adopted" });
    const id = done.outcome.beliefs.births.find((x) => x.reason === "adopted-from-dream")?.id as string;
    const row = c.store.row(id);
    expect(row?.birth_route).toBe("dream");
    expect(row?.about).toBe("us");
    expect(sal(c.store.physicsOf(id).salience)).toBeLessThanOrEqual(PHYSICS.BELIEF_BIRTH_CEILING + 1e-9);
    expect(c.store.supportOf(id).map((r) => r.memoryId).sort()).toEqual([d.a, d.b, d.c].sort());
    expect(c.store.supportOf(id).find((r) => r.memoryId === d.a)?.route).toBe("testimony");
    expect(readProseWalking(c.store, id).meta["fromCandidate"]).toBe(cand?.id);
  });

  test("one candidate, one belief: not again in a second finish, nor in a later reflection of the same dream; untouched ones are let go", () => {
    const c = brain();
    const d = dream(c, ({ a, b, c: cc }) => [
      { action: "belief-candidate", subject: "us", text: "We decide best late at night.", sources: [a, b] },
      { action: "belief-candidate", subject: "me", text: "I think best when it is quiet.", sources: [cc] },
    ]);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const [first, second] = begun.bundle.beliefs?.candidates ?? [];
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Late nights.", cites: [], beliefs: { adopt: [{ candidate: first?.id as string }, { candidate: first?.id as string, statement: "Our best calls come after dark." }] } });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.beliefs.adopt.map((x) => x.reason)).toEqual(["adopted", "already-adopted"]);
    const bid = done.outcome.beliefs.births[0]?.id as string;
    // The finish closed: the first adopted (as its belief), the second, untouched, let go.
    expect(c.store.reflection(begun.bundle.reflection)?.detail).toContain(JSON.stringify([[first?.id, bid], [second?.id, "let-go"]]));
    const again = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, beliefs: { adopt: [{ candidate: first?.id as string, statement: "Our best calls come after dark." }, { candidate: second?.id as string }] } });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.beliefs.adopt.map((x) => x.reason)).toEqual(["already-adopted", "let-go"]);
    // A later reflection of the same dream is not shown them, and cannot adopt them.
    nextDay(c);
    const later = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!later.ok) throw new Error(later.reason);
    expect(later.bundle.beliefs?.candidates ?? []).toEqual([]);
    const tried = c.reflections.finish({ reflection: later.bundle.reflection, session: SESSION, entry: "Again.", cites: [], beliefs: { adopt: [{ candidate: first?.id as string, statement: "Our best calls come after dark." }] } });
    if (!tried.ok) throw new Error(tried.reason);
    expect(tried.outcome.beliefs.adopt[0]?.ok).toBe(false);
    expect(c.store.list({ type: "schema" }).filter((id) => c.store.row(id)?.birth_route === "dream")).toEqual([bid]);
  });

  test("a finish that sent no beliefs lets nothing go: the next finish may still adopt", () => {
    const c = brain();
    const d = dream(c, ({ a, b }) => [{ action: "belief-candidate", subject: "us", text: "We decide best late at night.", sources: [a, b] }]);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const cid = begun.bundle.beliefs?.candidates?.[0]?.id as string;
    const first = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Late nights.", cites: [] });
    if (!first.ok) throw new Error(first.reason);
    expect(c.store.reflection(begun.bundle.reflection)?.detail ?? "").not.toContain("candidatesDecided");
    const again = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, beliefs: { adopt: [{ candidate: cid }] } });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.beliefs.adopt[0]?.reason).toBe("adopted");
  });

  test("a refused adoption stays open for the next finish to say better", () => {
    const c = brain();
    const d = dream(c, ({ a }) => [{ action: "belief-candidate", subject: "us", text: "We decide best late at night.", sources: [a] }]);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const cid = begun.bundle.beliefs?.candidates?.[0]?.id as string;
    const owner = c.store.row(d.a)?.body as string;
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Late nights.", cites: [], beliefs: { adopt: [{ candidate: cid, statement: owner }] } });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.beliefs.adopt[0]?.reason).toBe("pasted-from-memory");
    const again = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, beliefs: { adopt: [{ candidate: cid }] } });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.beliefs.adopt[0]?.reason).toBe("adopted");
  });

  test("refused: past the night's ceiling, a dream's own words as a source, and everything when beliefs are off; undone with its dream", () => {
    const c = brain();
    const d = dream(c, ({ a, b, c: cc }) => [
      { action: "belief-candidate", subject: "us", text: "We decide best late at night.", sources: [a] },
      { action: "belief-candidate", subject: "me", text: "I think best when it is quiet.", sources: [b] },
      { action: "belief-candidate", subject: "us", text: "We laugh more after midnight.", sources: [cc] },
      { action: "belief-candidate", subject: "us", text: "", sources: [a] },
    ]);
    expect(d.results.map((r) => r.reason)).toEqual(["proposed", "proposed", "limit-reached", "limit-reached"]);
    expect(DREAM_TUNABLES.BELIEF_CANDIDATES).toBe(2);
    const undone = c.dreams.undo(d.dream);
    expect(undone.ok).toBe(true);
    expect(c.store.dreamChanges(d.dream).filter((x) => x.action === "belief-candidate").every((x) => x.undone === 1)).toBe(true);
  });

  test("off (schemas.BELIEFS_BIRTH = false): the dream is not asked and a candidate is refused", () => {
    const c = brain();
    (SCHEMAS as { BELIEFS_BIRTH: boolean }).BELIEFS_BIRTH = false;
    expect(c.dreams.launchPrompt({ session: SESSION })).not.toContain("belief-candidate");
    const d = dream(c, ({ a }) => [{ action: "belief-candidate", subject: "us", text: "We decide best late at night.", sources: [a] }]);
    expect(d.results[0]?.reason).toBe("beliefs-off");
  });
});

describe("a session's rare birth", () => {
  test("the owner's words about us: born weak on the self subject, route session, that memory its testimony", () => {
    const c = brain();
    nextDay(c);
    const said = mem(c, "Mike: you and I are at our best when we argue it out.", { saidBy: "owner", about: "us" });
    const out = c.sessionBelief({ memoryId: said, statement: "We are at our best when we argue it out.", about: "us" });
    expect(out).toMatchObject({ ok: true, reason: "born" });
    const row = c.store.row(out.id as string);
    expect(row?.birth_route).toBe("session");
    expect(row?.about).toBe("us");
    expect(c.store.supportOf(out.id as string)[0]?.route).toBe("testimony");
  });

  test("only testimony, a choice or a vivid moment; a repeat is refused and files nothing; at most a few a day; off when switched off", () => {
    const c = brain();
    nextDay(c);
    const pasted = mem(c, "Mike: we always ship on Fridays together.", { saidBy: "owner" });
    expect(c.sessionBelief({ memoryId: pasted, statement: "Mike: we always ship on Fridays\n together." }).reason).toBe("pasted-from-memory");
    const plain = mem(c, "The deploy ran at noon.");
    expect(c.sessionBelief({ memoryId: plain, statement: "Deploys are dull." }).reason).toBe("not-testimony-choice-or-vivid");
    // Vivid is what was FELT (its recorded feelings), not the caller's own emotional score.
    const vivid = mem(c, "The launch went out and I was elated.", { salience: { relevance: 0.6, emotional: 0.9, predictive: 0.6 } });
    expect(c.sessionBelief({ memoryId: vivid, statement: "Launching things lights me up." }).reason).toBe("not-testimony-choice-or-vivid");
    c.store.addFeelings(vivid, [{ whose: "self", core: "happy", emotion: "excited", strength: 0.8 }]);
    const born = c.sessionBelief({ memoryId: vivid, statement: "Launching things lights me up." });
    expect(born.reason).toBe("born");
    const chose = mem(c, "I chose to ship it small.", { saidBy: "self" });
    const again = c.sessionBelief({ memoryId: chose, statement: "Launching things lights me up." });
    expect(again).toMatchObject({ ok: false, reason: "near-duplicate", id: born.id });
    expect(c.store.supportOf(born.id as string).map((r) => r.memoryId)).toEqual([vivid]);
    const c2 = mem(c, "I chose the quieter name.", { saidBy: "self" });
    expect(c.sessionBelief({ memoryId: c2, statement: "I prefer quiet names." }).reason).toBe("born");
    const c3 = mem(c, "I chose to wait a day.", { saidBy: "self" });
    expect(c.sessionBelief({ memoryId: c3, statement: "I let things settle before deciding." }).reason).toBe("limit-reached");
    (SCHEMAS as { BELIEFS_BIRTH: boolean }).BELIEFS_BIRTH = false;
    expect(c.sessionBelief({ memoryId: c3, statement: "Something else entirely." }).reason).toBe("beliefs-off");
  });
});

describe("a session's statement and the repeats it cannot pump", () => {
  test("eight repeats from eight memories: one belief, its support its first memory alone", () => {
    const c = brain();
    nextDay(c);
    const first = mem(c, "Mike: you and I are at our best when we argue it out.", { saidBy: "owner", about: "us" });
    const out = c.sessionBelief({ memoryId: first, statement: "We are at our best when we argue it out.", about: "us" });
    for (let i = 0; i < 8; i += 1) {
      const m = mem(c, `Mike: arguing it out helped again, take ${String(i)}.`, { saidBy: "owner", about: "us" });
      expect(c.sessionBelief({ memoryId: m, statement: "We are at our best when we argue it out.", about: "us" }).reason).toBe("near-duplicate");
    }
    expect(c.store.supportOf(out.id as string)).toHaveLength(1);
  });

  test("a statement past the belief's length is kept to it, and says so", () => {
    const c = brain();
    nextDay(c);
    const said = mem(c, "Mike: you and I are at our best when we argue it out.", { saidBy: "owner", about: "us" });
    const long = `We are at our best when we argue it out, ${"and then we keep going ".repeat(40)}`;
    const out = c.sessionBelief({ memoryId: said, statement: long, about: "us" });
    expect(out.reason).toBe("born");
    expect((c.store.row(out.id as string)?.body ?? "").length).toBeLessThanOrEqual(REFLECT_TUNABLES.MAX_BELIEF_CHARS);
    expect(out.note).toContain("kept to its first");
  });
});

describe("two processes on one store", () => {
  test("a belief born in one is corrected, and not repeated, in the other, opened before it was born", async () => {
    const a = brain();
    const b = brain();
    nextDay(a);
    const me = a.schemas.ensureSelfSubject();
    b.schemas.ensureSelfSubject();
    const day = a.store.livedDay();
    const bid = a.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    // B built its index before the belief was born.
    const said = mem(b, "Mike: we really do work best at dawn, you know.", { saidBy: "owner", about: "us" });
    expect(b.sessionBelief({ memoryId: said, statement: "We work best at dawn.", about: "us" })).toMatchObject({ reason: "near-duplicate", id: bid });
    const out = await b.correctBelief({ beliefId: bid, text: "That's wrong.", session: SESSION, scope: "/work" });
    expect(out.deposited).toBe(true);
    expect(b.store.row(bid)?.archived).toBe(1);
  });

  test("corrected in the other before it read any belief at all", async () => {
    const a = brain();
    const b = brain();
    nextDay(a);
    const me = a.schemas.ensureSelfSubject();
    const bid = a.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day: a.store.livedDay(), birthRoute: "reflection", about: "us" }).id as string;
    const out = await b.correctBelief({ beliefId: bid, text: "That's wrong.", session: SESSION, scope: "/work" });
    expect(out.deposited).toBe(true);
    expect(b.store.row(bid)?.archived).toBe(1);
  });
});

describe("through the remember tool", () => {
  test("a note with a belief: born beside it when it is the owner's words; said why not when it is not", async () => {
    const s = openServer({ dir, session: SESSION, scope: "/work" });
    try {
      const yes = await s.call("remember", { text: "Mike: you and I are at our best when we argue it out.", saidBy: "owner", about: "us", belief: { statement: "We are at our best when we argue it out.", about: "us" } });
      expect(yes.structuredContent["stored"]).toBe(true);
      expect(yes.structuredContent["belief"]).toMatchObject({ stored: true, reason: "born" });
      const no = await s.call("remember", { text: "The deploy ran at noon and nothing broke.", belief: { statement: "Deploys are calm." } });
      expect(no.structuredContent["stored"]).toBe(true);
      expect(no.structuredContent["belief"]).toMatchObject({ stored: false, reason: "not-testimony-choice-or-vivid" });
      const bad = await s.call("remember", { text: "Another note entirely about lunch.", belief: "We like lunch." });
      expect(bad.structuredContent["belief"]).toMatchObject({ stored: false, reason: "belief-malformed" });
    } finally {
      s.counterpart.close();
    }
  });
});

describe("the owner's correction", () => {
  test("his words that a belief is wrong settle it corrected at once, whatever its support; its history kept", async () => {
    const c = brain();
    const day = nextDay(c);
    const me = c.schemas.ensureSelfSubject();
    const b = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    for (let i = 0; i < 3; i += 1) {
      c.schemas.fileSupport({ beliefId: b, memoryId: mem(c, `Dawn went well, ${String(i)}.`, { saidBy: "owner" }), stance: "support", day });
    }
    const out = await c.correctBelief({ beliefId: b, text: "That's wrong — we are night people.", session: SESSION, scope: "/work" });
    expect(out.deposited).toBe(true);
    expect(c.store.row(b)?.archived).toBe(1);
    expect(c.store.row(b)?.body).toBe("We work best at dawn.");
    expect(c.store.supportOf(b)).toHaveLength(3);
    expect(c.store.row(out.memoryId as string)?.said_by).toBe("owner");
    // Recorded as the owner's settle.
    expect(c.store.contradictionSettles({}).filter((x) => x.action === "settle").pop()?.actor).toBe("owner");
  });

  test("his bare \"That's wrong.\" is enough; the self subject or a memory is not a belief to correct", async () => {
    const c = brain();
    const day = nextDay(c);
    const me = c.schemas.ensureSelfSubject();
    const b = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    const out = await c.correctBelief({ beliefId: b, text: "That's wrong.", session: SESSION, scope: "/work" });
    expect(out.deposited).toBe(true);
    expect(c.store.row(b)?.archived).toBe(1);
    expect(c.store.row(out.memoryId as string)?.body).toContain("We work best at dawn.");
    expect(await c.correctBelief({ beliefId: me, text: "That's wrong.", session: SESSION, scope: "/work" })).toMatchObject({ deposited: false, reason: "not-a-belief" });
    const plain = mem(c, "The deploy ran at noon.");
    expect(await c.correctBelief({ beliefId: plain, text: "That's wrong.", session: SESSION, scope: "/work" })).toMatchObject({ deposited: false, reason: "not-a-belief" });
    expect(c.store.row(plain)?.archived).toBe(0);
  });

  test("the nightly run's own writing never corrects a belief at once, the owner's words or not", async () => {
    const c = brain();
    const day = nextDay(c);
    const me = c.schemas.ensureSelfSubject();
    const b = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    c.close();
    open.splice(open.indexOf(c), 1);
    const night = openServer({ dir, session: SESSION, scope: "/work", env: { COUNTERPARTS_NIGHT_RUN: "nrn_test" } });
    try {
      const r = await night.call("remember", { text: "Mike said we don't work best at dawn after all.", saidBy: "owner", updates: b });
      expect(r.structuredContent["stored"]).toBe(true);
      expect(night.counterpart.store.row(b)?.archived).toBe(0);
    } finally {
      night.counterpart.close();
    }
  });

  test("a session's own update of a belief (not the owner's words) is pressure, not a correction", async () => {
    const c = brain();
    const day = nextDay(c);
    const me = c.schemas.ensureSelfSubject();
    const b = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    for (let i = 0; i < 3; i += 1) {
      c.schemas.fileSupport({ beliefId: b, memoryId: mem(c, `Dawn went well, ${String(i)}.`, { saidBy: "owner" }), stance: "support", day });
    }
    nextDay(c);
    const out = await c.submitJot({ content: "Tonight's late session went better than dawn ever has.", updates: b }, { session: SESSION, scope: "/work" });
    expect(out.deposited).toBe(true);
    expect(c.store.row(b)?.archived).toBe(0);
    expect(c.store.physicsOf(b).pressure).toBeGreaterThan(0);
  });
});

/**
 * B1 (2026-10-24, lineage #583 → B1): an awake belief that says what one
 * already says still answers `near-duplicate` with that belief's id, and its
 * memory now counts for that belief — at most once per belief per session
 * (the memory's own session; unbound: once a lived day). Through the
 * `remember` tool's `belief` field, the path a session uses.
 */
describe("an awake repeat counts, once a session (B1)", () => {
  const STATEMENT = "We are at our best when we argue it out.";
  const OLD_NOTE = (id: string) => `It says what ${id} says. The memory stands; tonight's reflection may count it for that belief.`;

  afterEach(() => {
    (SCHEMAS as { AWAKE_SUPPORT_ON_DUPLICATE: boolean }).AWAKE_SUPPORT_ON_DUPLICATE = true;
  });

  /** A belief the reflection wrote (no support yet), on the self subject. */
  function existingBelief(c: Counterpart): string {
    const me = c.schemas.ensureSelfSubject();
    const made = c.schemas.addBelief({ entityId: me, statement: STATEMENT, day: c.store.livedDay(), birthRoute: "reflection", about: "us" });
    if (made.id === null) throw new Error(made.reason);
    return made.id;
  }

  const said = (n: string) => ({
    text: `Mike: arguing it out worked again today, on the ${n} question, and we both said so.`,
    saidBy: "owner",
    about: "us",
    emotional: 0,
    belief: { statement: STATEMENT, about: "us" },
  });

  test("a testimony repeat: refused near-duplicate, and one support row filed (testimony, physics' weight), schema.support.filed emitted", async () => {
    const s = openServer({ dir, session: "s-one", scope: "/work" });
    try {
      const bid = existingBelief(s.counterpart);
      const r = await s.call("remember", said("naming"));
      expect(r.structuredContent["stored"]).toBe(true);
      const b = r.structuredContent["belief"] as Record<string, unknown>;
      expect(b).toMatchObject({ stored: false, reason: "near-duplicate", id: bid, support: { filed: true, route: "testimony" } });
      expect(b["note"]).toContain("now counts for it (testimony");
      const rows = s.counterpart.store.supportOf(bid);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ memoryId: r.structuredContent["id"], route: "testimony", stance: "support" });
      expect(rows[0]?.weight).toBeCloseTo(PHYSICS.SUPPORT_TESTIMONY * 1, 6);
      expect((b["support"] as { weight: number }).weight).toBeCloseTo(rows[0]?.weight ?? -1, 9);
      const ev = s.counterpart.events("schema.support.filed");
      expect(ev).toHaveLength(1);
      expect(ev[0]?.data?.["via"]).toBe("awake-duplicate");
    } finally {
      s.counterpart.close();
    }
  });

  test("the #583 scenario: eight near-duplicates from eight memories in one session file exactly once; the other seven say already counted from this session", async () => {
    const s = openServer({ dir, session: "s-eight", scope: "/work" });
    try {
      const bid = existingBelief(s.counterpart);
      const words = ["naming", "pricing", "schema", "release", "dashboard", "license", "storage", "roadmap"];
      const replies: Record<string, unknown>[] = [];
      for (const w of words) {
        const r = await s.call("remember", said(w));
        expect(r.structuredContent["stored"]).toBe(true);
        replies.push(r.structuredContent["belief"] as Record<string, unknown>);
      }
      expect(replies.every((b) => b["reason"] === "near-duplicate" && b["id"] === bid && b["stored"] === false)).toBe(true);
      expect(replies.filter((b) => (b["support"] as { filed: boolean }).filed)).toHaveLength(1);
      const rest = replies.slice(1);
      expect(rest.every((b) => (b["support"] as { reason?: string }).reason === "counted-this-session")).toBe(true);
      expect(rest.every((b) => String(b["note"]).includes("already counted from this session"))).toBe(true);
      expect(s.counterpart.store.supportOf(bid)).toHaveLength(1);
      expect(s.counterpart.events("schema.support.filed")).toHaveLength(1);
      // The durable record the check after reads: one filed, seven held, all naming this session.
      const kept = s.counterpart.store.eventLog({ name: "belief.support.awake", ref: bid }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
      expect(kept).toHaveLength(8);
      expect(kept.filter((p) => p["filed"] === true)).toHaveLength(1);
      expect(kept.filter((p) => p["reason"] === "counted-this-session")).toHaveLength(7);
      expect(kept.every((p) => p["session"] === "s-eight")).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("a second session the same day files a second time, at the same-day discount", async () => {
    const a = openServer({ dir, session: "s-morning", scope: "/work" });
    let bid: string;
    try {
      bid = existingBelief(a.counterpart);
      await a.call("remember", said("naming"));
    } finally {
      a.counterpart.close();
    }
    const b = openServer({ dir, session: "s-afternoon", scope: "/other" });
    try {
      const r = await b.call("remember", said("pricing"));
      expect(r.structuredContent["belief"]).toMatchObject({ reason: "near-duplicate", id: bid, support: { filed: true, route: "testimony" } });
      const rows = b.counterpart.store.supportOf(bid);
      expect(rows).toHaveLength(2);
      const second = rows.find((x) => x.memoryId === r.structuredContent["id"]);
      expect(second?.session).toBe("s-afternoon");
      expect(second?.weight).toBeCloseTo(PHYSICS.SUPPORT_TESTIMONY * PHYSICS.SUPPORT_SAME_DAY, 6);
    } finally {
      b.counterpart.close();
    }
  });

  test("a memory already filed for that belief: already counted, nothing new", async () => {
    const s = openServer({ dir, session: "s-filed", scope: "/work" });
    try {
      const c = s.counterpart;
      const bid = existingBelief(c);
      const r = await s.call("remember", { text: "Mike: arguing it out is how we got the naming right.", saidBy: "owner", about: "us" });
      const mid = r.structuredContent["id"] as string;
      // The reflection counted it first (no awake door has a way to hand it the same memory twice).
      expect(c.schemas.fileSupport({ beliefId: bid, memoryId: mid, stance: "support", day: c.store.livedDay() }).ok).toBe(true);
      const before = c.events("schema.support.filed").length;
      const out = c.sessionBelief({ memoryId: mid, statement: STATEMENT, about: "us" });
      expect(out).toMatchObject({ ok: false, reason: "near-duplicate", id: bid, support: { filed: false, reason: "already-counted" } });
      expect(out.note).toContain("already counts for it");
      expect(c.store.supportOf(bid)).toHaveLength(1);
      expect(c.events("schema.support.filed").length).toBe(before);
    } finally {
      s.counterpart.close();
    }
  });

  test("not testimony, a choice or vivid: refused before the near-duplicate check, nothing filed", async () => {
    const s = openServer({ dir, session: "s-plain", scope: "/work" });
    try {
      const bid = existingBelief(s.counterpart);
      const r = await s.call("remember", { text: "We argued out the naming question again and it went fine.", about: "us", emotional: 0, belief: { statement: STATEMENT, about: "us" } });
      expect(r.structuredContent["belief"]).toMatchObject({ stored: false, reason: "not-testimony-choice-or-vivid" });
      expect((r.structuredContent["belief"] as Record<string, unknown>)["support"]).toBeUndefined();
      expect(s.counterpart.store.supportOf(bid)).toHaveLength(0);
    } finally {
      s.counterpart.close();
    }
  });

  test("switched off (schemas.AWAKE_SUPPORT_ON_DUPLICATE = false): exactly as before — the old note, no support key, nothing filed", async () => {
    (SCHEMAS as { AWAKE_SUPPORT_ON_DUPLICATE: boolean }).AWAKE_SUPPORT_ON_DUPLICATE = false;
    const s = openServer({ dir, session: "s-off", scope: "/work" });
    try {
      const bid = existingBelief(s.counterpart);
      const r = await s.call("remember", said("naming"));
      expect(r.structuredContent["belief"]).toEqual({ stored: false, reason: "near-duplicate", id: bid, note: OLD_NOTE(bid) });
      expect(s.counterpart.store.supportOf(bid)).toHaveLength(0);
      expect(s.counterpart.events("schema.support.filed")).toHaveLength(0);
      expect(s.counterpart.events("schema.support.refused")).toHaveLength(0);
      expect(s.counterpart.store.eventLog({ name: "belief.support.awake" })).toHaveLength(0);
    } finally {
      s.counterpart.close();
    }
  });

  test("an unbound session (mcp): once per belief per lived day", () => {
    const c = brain();
    nextDay(c);
    const bid = existingBelief(c);
    const one = mem(c, "Mike: arguing it out fixed the naming question.", { saidBy: "owner", about: "us", origin: { session: "mcp", scope: "/a" } });
    const two = mem(c, "Mike: arguing it out fixed the pricing question too.", { saidBy: "owner", about: "us", origin: { session: "mcp", scope: "/b" } });
    expect(c.sessionBelief({ memoryId: one, statement: STATEMENT, about: "us" }).support).toMatchObject({ filed: true });
    const again = c.sessionBelief({ memoryId: two, statement: STATEMENT, about: "us" });
    expect(again.support).toEqual({ filed: false, reason: "counted-today" });
    expect(again.note).toContain("once a day");
    nextDay(c);
    const three = mem(c, "Mike: arguing it out fixed the license question as well.", { saidBy: "owner", about: "us", origin: { session: "mcp", scope: "/c" } });
    expect(c.sessionBelief({ memoryId: three, statement: STATEMENT, about: "us" }).support).toMatchObject({ filed: true });
    expect(c.store.supportOf(bid)).toHaveLength(2);
  });
});
