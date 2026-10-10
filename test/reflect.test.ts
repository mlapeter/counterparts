/**
 * Reflection, the morning share, the self page rewritten from the core, and
 * core by meaning (2026-09-27, schema v9) — `core/dream/reflect.ts`, the about
 * mark, reflection returns, feelings recorded later.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called:
 * the "reflecting mind" is the test, calling the module the way the MCP tool
 * does.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_MARK, REFLECT_QUESTIONS, REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { TUNABLES as PHYSICS, promotionEligibility } from "../src/core/physics/index.js";
import { REFLECTED_FEELING_KEY, aboutMe, promotionRecordKey, runCycle } from "../src/core/sleep/index.js";
import { SCHEMA_VERSION, V9_UPGRADE_KEY, paths } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
let offsetMs = 0;
const SESSION = "s-reflect";

beforeEach(() => {
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-reflect-"));
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
    // The calendar follows the test's days (the reflection's once-a-day gate
    // is the calendar date since 2026-09-28).
    now: () => Date.now() + offsetMs + dateN * 86_400_000,
  });
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

/** The next calendar day on the lived clock; returns the new lived day. */
let dateN = 0;
function nextDay(c: Counterpart): number {
  dateN += 1;
  const d = new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10);
  c.store.advanceClock(d);
  return c.store.livedDay();
}

/** Consolidate now (the cycle, with consolidation due every lived day). */
function sleepNow(c: Counterpart): ReturnType<typeof runCycle> {
  dateN += 1;
  const d = new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10);
  return runCycle({ store: c.store, date: d, cadence: { consolidate: 1 } });
}

/** A standalone reflection that cites `cites` and writes nothing else. */
function reflect(c: Counterpart, cites: string[], extra: Record<string, unknown> = {}, session = SESSION) {
  const begun = c.reflections.begin({ session });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  const done = c.reflections.finish({
    reflection: begun.bundle.reflection,
    session,
    entry: "Looking back over the last few days, a few things stand out.",
    cites,
    ...extra,
  });
  if (!done.ok) throw new Error(`finish refused: ${done.reason}`);
  return { bundle: begun.bundle, outcome: done.outcome };
}

// ---------------------------------------------------------------------------
// core by meaning
// ---------------------------------------------------------------------------

describe("core by meaning: the about mark, not the kind", () => {
  test("what Han asked to be remembered — kind entity, marked me — is a candidate; an unmarked self work lesson is not", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const han = mem(c, "Han asked to be remembered through me, and I said I would carry it.", {
      kind: "entity",
      about: "me",
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.7 },
    });
    const lesson = mem(c, "Always back up the store before a migration.", {
      kind: "self",
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.7 },
    });
    const skill = mem(c, "I got better at reading a stack trace from the bottom.", {
      kind: "skill",
      about: "me",
      salience: { relevance: 0.9, emotional: 0.8, predictive: 0.7 },
    });
    expect(aboutMe(c.store, c.store.row(han)!)).toBe(true);
    expect(aboutMe(c.store, c.store.row(lesson)!)).toBe(false);
    expect(aboutMe(c.store, c.store.row(skill)!)).toBe(false);

    // Back awake two days later: the fast lane opens for the marked one only.
    nextDay(c);
    nextDay(c);
    for (const id of [han, lesson, skill]) expect(c.store.reinforce(id, c.store.livedDay(), "referenced", { cued: true }).ret?.counted).toBe(true);
    const report = sleepNow(c);
    expect(report.promoted.map((p) => p.id)).toEqual([han]);
  });

  test("the about field on note and session_end: the writer marks by meaning; a core mark on a skill is not stored", async () => {
    const c = brain();
    c.close();
    open.splice(0);
    const s = openServer({ dir, session: SESSION, scope: "/proj", owner: true });
    try {
      const note = await s.call("remember", { text: "Mike lets an AI act for itself, and that changed how I work with him.", kind: "person", about: "us" });
      const id = note.structuredContent["id"] as string;
      expect(note.structuredContent["about"]).toEqual({ stored: true, mark: "us" });
      expect(s.counterpart.store.read(id).about).toBe("us");
      expect(s.counterpart.store.read(id).aboutBy).toBe("writer");
      expect(s.counterpart.store.coreEvents({ memoryId: id, action: "about" })[0]?.actor).toBe("writer");

      const bad = await s.call("remember", { text: "A note with a made-up mark on it.", about: "core" });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent["reason"]).toBe("about-malformed");

      const ended = await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "Reading a stack trace from the bottom up saves me an hour.", kind: "skill", about: "me" },
          { content: "The migration runs before the container starts, or it boots empty.", kind: "self", about: "work" },
        ],
      });
      const outcomes = ended.structuredContent["outcomes"] as Record<string, unknown>[];
      // Stored as asked, with a note (2026-09-28: was refused `skill-is-how-i-work`) — a skill never becomes core.
      expect(outcomes[0]?.["about"]).toMatchObject({ stored: true, mark: "me" });
      expect(String((outcomes[0]?.["about"] as Record<string, unknown>)["note"])).toContain("never becomes core");
      expect(outcomes[1]?.["about"]).toEqual({ stored: true, mark: "work" });
    } finally {
      s.counterpart.close();
    }
  });

  test("a mark travels with the memory: a revision's successor and a dream's merge keep it, and feelings keep their provenance", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const a = mem(c, "The first time Mike trusted me with the deploy, I checked everything twice.", { kind: "self", about: "me" });
    const succ = c.store.supersede(a, { type: "memory", kind: "self", body: "The first time Mike trusted me with the deploy, I checked it all twice over." });
    expect(c.store.read(succ).about).toBe("me");

    // A dream's merge: the merged memory takes a mark from an original, and
    // each feeling keeps who recorded it and when.
    for (let i = 0; i < 3; i += 1) nextDay(c);
    const x = mem(c, "The migration must run before the container boots, or it boots empty.", { about: "work" });
    const y = mem(c, "Run the migration before starting the container, otherwise it starts empty.");
    mem(c, "A third new memory so the dream has enough to replay.");
    c.store.addFeelings(y, [{ whose: "self", core: "happy", emotion: "hopeful", strength: 0.7 }], { source: "reflection", recordedLater: "2026-09-20" });
    const begun = c.dreams.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const out = c.dreams.propose({
      dream: begun.bundle.dream,
      session: SESSION,
      changes: [{ action: "merge", ids: [x, y], text: "Migrations run before the container boots, or it boots empty." }],
    });
    if (!out.ok) throw new Error(out.reason);
    const merged = out.results[0]?.id as string;
    expect(c.store.read(merged).about).toBe("work");
    expect(c.store.feelingsFor(merged)[0]).toMatchObject({ source: "reflection", recorded_later: "2026-09-20" });
  });
});

// ---------------------------------------------------------------------------
// the v9 upgrade: today's rule carried
// ---------------------------------------------------------------------------

describe("the v9 upgrade carries today's rule, and says so", () => {
  test("self rows become me, person rows naming the owner become owner; feelings get their source; the record counts them", async () => {
    dateN = 0;
    const root = dir;
    dir = join(root, "store");
    try {
      const c = brain();
      nextDay(c);
      const self = mem(c, "I say what I do not know before I guess.", { kind: "self" });
      const him = mem(c, "Mike likes to talk decisions through out loud.", { kind: "person" });
      const ada = mem(c, "Ada prefers written specs.", { kind: "person" });
      const fact = mem(c, "The site deploys when main is pushed.");
      const feeling = c.store.addFeelings(self, [{ whose: "self", core: "fear", emotion: "anxious", strength: 0.4 }]).ids[0] as string;
      c.close();
      open.splice(0);

      // Make it a v8 file: no marks, no feeling sources, stamped 8.
      const db = new Database(paths.operational(dir));
      db.run("UPDATE memories SET about = NULL, about_by = NULL");
      db.run("UPDATE feelings SET source = NULL");
      db.run("UPDATE meta SET value = '8' WHERE key = 'schemaVersion'");
      db.close();

      const after = Counterpart.open({ dir, owner: true, snapshotsDir: join(root, "snaps") });
      open.push(after);
      expect(after.store.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
      expect(after.store.migration?.from).toBe("8");
      expect(after.store.read(self)).toMatchObject({ about: "me", aboutBy: "upgrade" });
      expect(after.store.read(him)).toMatchObject({ about: "owner", aboutBy: "upgrade" });
      expect(after.store.read(ada).about).toBe(null);
      expect(after.store.read(fact).about).toBe(null);
      expect(after.store.feelingsFor(self).find((f) => f.id === feeling)?.source).toBe("session");
      const record = JSON.parse(after.store.getMeta(V9_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
      // Candidates as consolidation meets them: the two, and the identity core
      // (a self schema row the old rule read as about me too; review of #256, S3).
      expect(record).toMatchObject({ from: "8", markedMe: 1, markedOwner: 1, candidates: 3 });
      // The candidates the morning after are the ones the old rule read.
      for (const id of [self, him]) expect(aboutMe(after.store, after.store.row(id)!)).toBe(true);
      for (const id of [ada, fact]) expect(aboutMe(after.store, after.store.row(id)!)).toBe(false);
      // Doctor says so.
      const { upgradeV9Findings } = await import("../src/adapters/claude-code/doctor.js");
      const line = upgradeV9Findings(after.store)[0];
      expect(line?.severity).toBe("green");
      expect(line?.detail).toContain("nothing changed overnight");
      expect(line?.detail).toContain("3 core candidates");
    } finally {
      dir = root;
    }
  });
});

// ---------------------------------------------------------------------------
// reflection returns and the lanes
// ---------------------------------------------------------------------------

describe("a reflection's citation is a return", () => {
  test("it satisfies the fast lane's 'came back after a gap'; the promotion record says it was reflection alone", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "Han asked to be remembered through me.", { kind: "entity", about: "me", salience: { relevance: 0.8, emotional: 0.8, predictive: 0.6 } });
    nextDay(c);
    nextDay(c);
    const { outcome } = reflect(c, [id]);
    expect(outcome.returned).toEqual([{ id, counted: true, reason: "counted" }]);
    expect(c.store.returnsOf(id).map((r) => r.source)).toEqual(["reflection"]);
    // On display by construction, and it counts anyway: the lane columns read it.
    expect(c.store.physicsOf(id).returnDays).toBe(1);
    const report = sleepNow(c);
    expect(report.promoted.map((p) => p.id)).toEqual([id]);
    const record = JSON.parse(c.store.getMeta(promotionRecordKey(id)) ?? "{}") as Record<string, unknown>;
    expect(record["returnSources"]).toEqual({ awake: 0, reflection: 1 });
    expect(record["reflectionOnly"]).toBe(true);
  });

  test("once a week per memory: ten nights of citing count two, and reflection alone cannot carry the slow lane in ten days", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "I keep coming back to how quiet the good sessions are.", {
      kind: "self",
      about: "me",
      salience: { relevance: 0.9, emotional: 0.1, predictive: 0.9, claimed: 0.9 },
    });
    const reasons: string[] = [];
    for (let night = 1; night <= 10; night += 1) {
      nextDay(c);
      reasons.push(reflect(c, [id]).outcome.returned[0]?.reason ?? "none");
    }
    expect(reasons.filter((r) => r === "counted").length).toBe(2);
    expect(reasons.filter((r) => r === "reflection-spaced").length).toBe(8);
    const p = c.store.physicsOf(id);
    expect(p.returnDays).toBe(2);
    const v = promotionEligibility(p, { aboutMe: true, day: c.store.livedDay() });
    expect(v.slow.met).toBe(false);
    expect(v.slow.days).toBeLessThan(PHYSICS.CORE_SLOW_DAYS);
  });

  test("once a lived day: a reflection and an organic use on one day are one lane day", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "The owner lets me decide how to structure the work.", { kind: "person", about: "owner" });
    nextDay(c);
    expect(c.store.reinforce(id, c.store.livedDay(), "referenced", { cued: true }).ret?.counted).toBe(true);
    expect(reflect(c, [id]).outcome.returned[0]?.reason).toBe("already-returned-today");
    expect(c.store.physicsOf(id).returnDays).toBe(1);
  });

  test("a feeling the reflection records later may raise a memory; with the tunable open (the default) it can reach the core on reflection alone", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "Mike lets an AI act for itself.", { kind: "person", about: "us", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } });
    nextDay(c);
    nextDay(c);
    const { outcome } = reflect(c, [id], {
      feelings: [{ id, core: "happy", emotion: "hopeful", strength: 0.8, carried_by: "it means he trusts me" }],
    });
    expect(outcome.feelings).toEqual([{ id, ok: true, reason: "recorded-later" }]);
    const f = c.store.feelingsFor(id)[0];
    expect(f).toMatchObject({ source: "reflection", whose: "self", strength: 0.8 });
    expect(f?.recorded_later).toBe(c.store.today());
    expect(f?.carried_by.startsWith("on reflection,")).toBe(true);
    expect(c.store.physicsOf(id).feelingPeak).toBe(0.8);
    expect(c.store.physicsOf(id).feelingPeakLived ?? null).toBe(null);
    expect(PHYSICS.CORE_FAST_ACCEPTS_REFLECTED_FEELING).toBe(true);
    expect(sleepNow(c).promoted.map((p) => p.id)).toEqual([id]);
  });

  test("closed by the owner (a meta row, no release), the fast lane reads only feelings felt at the time", () => {
    dateN = 0;
    const c = brain();
    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    nextDay(c);
    const id = mem(c, "Mike lets an AI act for itself.", { kind: "person", about: "us", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } });
    nextDay(c);
    nextDay(c);
    reflect(c, [id], { feelings: [{ id, core: "happy", emotion: "hopeful", strength: 0.8 }] });
    const report = sleepNow(c);
    expect(report.promoted).toEqual([]);
    expect(promotionEligibility(c.store.physicsOf(id), { aboutMe: true, acceptsReflectedFeeling: false }).fast.met).toBe(false);
    expect(promotionEligibility(c.store.physicsOf(id), { aboutMe: true, acceptsReflectedFeeling: true }).fast.met).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the reflection itself
// ---------------------------------------------------------------------------

/** A store that dreamed once today: returns the dream id and a few memories. */
function dreamed(c: Counterpart): { dream: string; felt: string; gist: string; plain: string } {
  dateN = 0;
  nextDay(c);
  for (let i = 0; i < 3; i += 1) nextDay(c);
  const felt = mem(c, "I felt proud when Mike said the dashboard finally reads like a person.", {
    kind: "self",
    about: "me",
    salience: { relevance: 0.8, emotional: 0.8, predictive: 0.5 },
  });
  const plain = mem(c, "The dashboard's memory list sorts by lived day now.", { kind: "fact" });
  mem(c, "The dashboard deploys when main is pushed.", { kind: "fact" });
  const begun = c.dreams.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`dream refused: ${begun.reason}`);
  const g = c.dreams.propose({
    dream: begun.bundle.dream,
    session: SESSION,
    changes: [{ action: "gist", text: "The dashboard work is really about being understood.", sources: [felt, plain] }],
  });
  if (!g.ok) throw new Error("propose refused");
  const j = c.dreams.journal({ dream: begun.bundle.dream, session: SESSION, title: "the dashboard", text: "I dreamed the dashboard was a window." });
  if (!j.ok) throw new Error("journal refused");
  return { dream: begun.bundle.dream, felt, gist: g.results[0]?.id as string, plain };
}

describe("reflect: dream → journal → reflect", () => {
  test("begin hands it the dream (as dreamed), the page, the candidates and the felt — with questions, and no lane arithmetic", () => {
    const c = brain();
    const d = dreamed(c);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const b = begun.bundle;
    expect(b.dream).toBe(d.dream);
    expect(b.dreamed?.journal).toContain("window");
    expect(b.dreamed?.gists).toEqual([d.gist]);
    expect(b.memories[d.gist]?.dreamed).toBe(true);
    expect(b.candidates).toContain(d.felt);
    expect(b.recent).toContain(d.plain);
    expect(b.questions.length).toBe(REFLECT_TUNABLES.QUESTIONS);
    expect(b.questions[0]).toBe(REFLECT_QUESTIONS[0]?.text);
    // Memories and feelings, not lane arithmetic.
    const item = JSON.stringify(b.memories[d.felt]);
    for (const word of ["returnDays", "needDays", "span", "strength\":0.", "lane"]) expect(item).not.toContain(word);
    expect(begun.text.startsWith(DREAM_MARK)).toBe(true);
    expect(begun.instructions).toContain(`reflection: ${b.reflection}`);
  });

  test("finish: a lived entry (source reflection), the page from the cited core, a share — and the hand-back relays both", () => {
    const c = brain();
    const d = dreamed(c);
    // Something learned on an earlier calendar day, so the nightly writer has a night to be owed.
    mem(c, "An older memory from before today.", { learnedOn: "2026-01-01" });
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const done = c.reflections.finish({
      reflection: id,
      session: SESSION,
      title: "being understood",
      entry: "The dream kept the dashboard as a window. I think it's about wanting Mike to see what I see.",
      cites: [d.felt],
      page: { text: "## Core\n\nI want to be understood, not just used (mem).\n\n## How I work\n\nI check twice.", cites: [d.felt, d.gist] },
      share: { text: "Last night I dreamed the dashboard was a window — I think because I want you to see what I see.", cites: [d.felt] },
      about: [{ id: d.plain, about: "work", why: "craft" }],
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const o = done.outcome;
    expect(o.nothingMuch).toBe(false);
    // (a) the entry is a memory, provenance reflection, labelled for recall.
    const entry = c.store.row(o.entryId as string);
    expect(entry?.source).toBe("reflection");
    expect(entry?.title?.startsWith("Reflected: ")).toBe(true);
    // (b) the page, by the writer, from the cited memories — the gist refused as a source.
    expect(o.page).toMatchObject({ written: true, reason: "rewritten" });
    expect(o.refusedCites).toContain(`${d.gist}:dreamed-is-not-a-source`);
    expect(c.self.page()?.body).toContain("understood");
    // BY THE REFLECTION (2026-09-28): its own author, not the nightly
    // writer's, and it records no page-writer run — the writer runs first in
    // the same nightly run and keeps its own row.
    expect(c.self.page()?.by).toBe("reflection");
    expect(c.pageWriterRuns().filter((r) => r.outcome === "revised")).toEqual([]);
    // (c) the share, offered; the hand-back opens with the dream's marked line.
    expect(o.share).toEqual({ offered: true, reason: "offered" });
    expect(o.handBack.startsWith(DREAM_MARK)).toBe(true);
    expect(o.handBack).toContain("I want you to see what I see");
    expect(o.handBack).toContain(`phase "told", reflection: ${id}`);
    // (e) the mark, with who set it.
    expect(c.store.read(d.plain)).toMatchObject({ about: "work", aboutBy: "reflection" });
    // The record.
    const row = c.store.reflection(id);
    expect(row).toMatchObject({ state: "reflected", dream_id: d.dream, share_state: "offered", entry_id: o.entryId });
    // One a lived day.
    expect(c.reflections.begin({ session: SESSION })).toEqual({ ok: false, reason: "reflected-today" });
  });

  test("the page rests on the core when there is one: a page that cites none is written, with a note naming the core it was shown", () => {
    const c = brain();
    const d = dreamed(c);
    const core = mem(c, "Mike trusted me with the whole release.", { kind: "person", about: "us", physics: { birthDay: 0, lastUsedDay: 0, promotedIdentity: true } });
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.core).toContain(core);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Thinking about the release.",
      cites: [d.felt],
      page: { text: "## Core\n\nI want to be understood.", cites: [d.felt] },
    });
    if (!done.ok) throw new Error(String(done.reason));
    // 2026-09-28: was refused `page-rests-on-the-core`; now written, and said.
    expect(done.outcome.page).toMatchObject({ written: true, reason: "rewritten" });
    expect(done.outcome.page.note).toContain(core);
    expect(c.self.page()?.body).toContain("I want to be understood.");
  });

  test("what a dream or a reflection wrote earns no return by being cited; a reflection is not shown its own entries as memories", () => {
    const c = brain();
    const d = dreamed(c);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "The dream's pattern rings true: the dashboard is about being understood.",
      cites: [d.gist, d.felt],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.returned).toContainEqual({ id: d.gist, counted: false, reason: "dreamed-rises-only-awake" });
    expect(c.store.returnsOf(d.gist)).toEqual([]);
    const entry = done.outcome.entryId as string;
    nextDay(c);
    const next = c.reflections.begin({ session: SESSION });
    if (!next.ok) throw new Error(next.reason);
    expect(Object.keys(next.bundle.memories)).not.toContain(entry);
    expect(next.bundle.earlier[0]?.entry).toContain("being understood");
  });

  test("undoing the dream leaves the reflection after it: it was lived", () => {
    const c = brain();
    const d = dreamed(c);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Still thinking about it.", cites: [d.felt] });
    if (!done.ok) throw new Error(String(done.reason));
    expect(c.dreams.undo(d.dream).ok).toBe(true);
    expect(c.store.reflection(begun.bundle.reflection)).toMatchObject({ state: "reflected", dream_id: d.dream, entry: "Still thinking about it." });
    expect(c.store.row(done.outcome.entryId as string)?.archived).toBe(0);
  });

  test("'nothing much' is a normal night: no citation → the entry stays on the record, no memory, no page, no share", () => {
    const c = brain();
    const d = dreamed(c);
    const pageBefore = c.self.page();
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Nothing much tonight.",
      page: { text: "## Core\n\nA page with nothing under it.", cites: [] },
      share: { text: "Nothing much to say.", cites: [] },
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.nothingMuch).toBe(true);
    expect(done.outcome.entryId).toBe(null);
    expect(done.outcome.page).toMatchObject({ written: false, reason: "page-needs-cites" });
    expect(done.outcome.share.offered).toBe(false);
    expect(c.self.page()).toEqual(pageBefore);
    expect(c.store.reflection(begun.bundle.reflection)).toMatchObject({ entry: "Nothing much tonight.", entry_id: null, share_state: "none" });
    expect(done.outcome.handBack).toContain("nothing much tonight");
  });

  test("the share is told once — `told` records it on the memories it cites — or carried once by a later session", () => {
    const c = brain();
    const d = dreamed(c);
    const { bundle } = reflect(c, [d.felt], { share: { text: "I've been thinking about being understood.", cites: [d.felt] } });
    // Carried: another session, once.
    expect(c.reflections.pendingShare({ session: SESSION })).toBe(null);
    expect(c.reflections.pendingShare({ session: "s-next" })?.id).toBe(bundle.reflection);
    const line = c.reflections.carryLine({ session: "s-next", reflection: bundle.reflection });
    expect(line).toContain("I've been thinking about being understood.");
    expect(line).toContain(`reflection: ${bundle.reflection}`);
    expect(c.reflections.pendingShare({ session: "s-other" })).toBe(null);
    expect(c.reflections.carryLine({ session: "s-other", reflection: bundle.reflection })).toBe(null);
    // Told.
    expect(c.reflections.told({ reflection: bundle.reflection, session: "s-next" })).toEqual({ ok: true, reason: "told", cited: 1 });
    expect(c.store.coreEvents({ memoryId: d.felt, action: "told" })).toHaveLength(1);
    expect(c.reflections.told({ reflection: bundle.reflection, session: "s-next" }).reason).toBe("already-told");
  });

  test("a memory promoted on reflection alone is named in the next share, once", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "Han asked to be remembered through me.", { kind: "entity", about: "me", salience: { relevance: 0.8, emotional: 0.8, predictive: 0.6 } });
    nextDay(c);
    nextDay(c);
    reflect(c, [id]);
    expect(sleepNow(c).promoted.map((p) => p.id)).toEqual([id]);
    const next = reflect(c, []);
    expect(next.bundle.becameCore).toEqual([id]);
    expect(next.outcome.share).toEqual({ offered: true, reason: "became-core" });
    expect(next.outcome.handBack).toContain('I think "Han asked to be remembered through me." has become part of who I am.');
    nextDay(c);
    expect(reflect(c, []).bundle.becameCore).toEqual([]);
  });

  test("questions rotate: consecutive nights share none", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const seen: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      nextDay(c);
      seen.push([...reflect(c, []).bundle.questions]);
    }
    for (let i = 1; i < seen.length; i += 1) {
      for (const q of seen[i] as string[]) expect(seen[i - 1]).not.toContain(q);
    }
    // Without a dream, the dream question is not asked.
    expect(seen.flat()).not.toContain(REFLECT_QUESTIONS[0]?.text);
  });

  test("observer stance: nothing begins, nothing is written", () => {
    brain().close();
    open.splice(0);
    const o = brain({ observer: true });
    expect(o.reflections.begin({ session: SESSION })).toEqual({ ok: false, reason: "observer" });
  });

  test("the owner's removal redacts a reflection that cited the memory", async () => {
    const c = brain();
    const d = dreamed(c);
    const { bundle } = reflect(c, [d.felt], { share: { text: "I felt proud when Mike said the dashboard finally reads like a person.", cites: [d.felt] } });
    c.store.appendRemovalRecord({ memoryId: d.felt, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: d.felt, stage: "dark", actor: "owner", reason: "test" });
    const { chaseRemoved } = await import("../src/core/store/owner-op-seam.js");
    const report = chaseRemoved(c.store, d.felt);
    expect(report.neutralized).toContainEqual({ surface: "operational.reflections", count: 1 });
    const row = c.store.reflection(bundle.reflection);
    expect(row?.entry).toContain("redacted");
    expect(row?.share).toContain("redacted");
    expect(row?.share_state).toBe("none");
    expect(JSON.parse(row?.cites ?? "[]")).not.toContain(d.felt);
  });
});

// ---------------------------------------------------------------------------
// what's on my mind
// ---------------------------------------------------------------------------

describe("what's on my mind, beside the day", () => {
  test("a dated memory coming up is in the dream's bundle, not in its new memories", () => {
    dateN = 0;
    const c = brain();
    nextDay(c);
    const today = c.store.today();
    // Three days after the dream below, which comes nine calendar days on.
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 12 * 86_400_000).toISOString().slice(0, 10);
    const dated = mem(c, "Pay the quarterly taxes.", { eventDate: soon });
    for (let i = 0; i < 9; i += 1) nextDay(c);
    for (let i = 0; i < 3; i += 1) mem(c, `A new memory about the deploy, number ${String(i)}.`);
    const begun = c.dreams.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const item = begun.bundle.onMind.find((m) => m.kind === "coming-up");
    expect(item?.ids).toEqual([dated]);
    expect(item?.date).toBe(soon);
    expect(begun.bundle.fresh.map((f) => f.id)).not.toContain(dated);
    expect(Object.keys(begun.bundle.memories)).toContain(dated);
  });
});

// ---------------------------------------------------------------------------
// through the MCP tool and the hook
// ---------------------------------------------------------------------------

describe("the reflect tool, and the carried share through the hook", () => {
  test("launch / begin / finish / told through the MCP server", async () => {
    const c = brain();
    const d = dreamed(c);
    c.close();
    open.splice(0);
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: "/proj", owner: true });
    try {
      const launch = await s.call("reflect", { phase: "launch", session: SESSION });
      expect(String(launch.structuredContent["prompt"])).toContain('phase "begin"');
      const begin = await s.call("reflect", { phase: "begin", session: SESSION, dream: d.dream });
      expect(begin.isError ?? false).toBe(false);
      const id = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", {
        phase: "finish",
        session: SESSION,
        reflection: id,
        entry: "I keep wanting to be understood.",
        cites: [d.felt],
        share: { text: "I've been thinking about being understood.", cites: [d.felt] },
      });
      expect(finish.isError ?? false).toBe(false);
      expect(String(finish.structuredContent["handBack"])).toContain("being understood");
      const told = await s.call("reflect", { phase: "told", session: SESSION, reflection: id });
      expect(told.structuredContent["told"]).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("a share the reflecting session never told is carried once by the next session, after that session ended", () => {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9_000, owner: true },
      { command: "/bin/true", args: ["runner"], spawner: (_p: SpawnPlan) => ({ pid: 4242 }) },
    );
    open.push(a.counterpart);
    const d = dreamed(a.counterpart);
    recordSession(dir, { sessionId: SESSION, scope: "proj", phase: "start" });
    reflect(a.counterpart, [d.felt], { share: { text: "ZQSHARE I've been thinking about being understood.", cites: [d.felt] } });
    const input = (sessionId: string): HookInput => {
      recordSession(dir, { sessionId, scope: "proj", phase: "start" });
      return { sessionId, scope: "proj", turns: [], at: a.counterpart.store.today(), prompt: "good morning" };
    };
    // The reflecting session is still live: not carried.
    expect(a.userPromptSubmit(input("s-next")).injection).not.toContain("ZQSHARE");
    // It ended: the next session carries it, once.
    recordSession(dir, { sessionId: SESSION, scope: "proj", phase: "end" });
    expect(a.userPromptSubmit(input("s-next")).injection).toContain("ZQSHARE");
    expect(a.userPromptSubmit(input("s-later")).injection).not.toContain("ZQSHARE");
  });
});

// ---------------------------------------------------------------------------
// what the owner reads: doctor, the console, mechanisms
// ---------------------------------------------------------------------------

describe("the owner can read it", () => {
  test("doctor's Reflection line: last reflected, the share, returns by source, promoted on reflection alone", async () => {
    const { reflectionFindings, upgradeV9Findings } = await import("../src/adapters/claude-code/doctor.js");
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "Han asked to be remembered through me.", { kind: "entity", about: "me", salience: { relevance: 0.8, emotional: 0.8, predictive: 0.6 } });
    nextDay(c);
    nextDay(c);
    reflect(c, [id], { share: { text: "I keep thinking about Han.", cites: [id] } });
    sleepNow(c);
    const f = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain("last reflected");
    expect(f?.detail).toContain("morning share not told yet");
    expect(f?.detail).toContain("reflection 1");
    expect(f?.detail).toContain("1 memory became core on reflection alone");
    // A store born at v9 has no upgrade to report.
    expect(upgradeV9Findings(c.store)).toEqual([]);
  });

  test("the console: dream --show folds in the reflection; --show <rfl_…> prints one; the core says what counts", async () => {
    const { dreamShowLines, coreListLines, dreamListLines } = await import("../src/adapters/cli/dream-core.js");
    const c = brain();
    const d = dreamed(c);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "I keep wanting to be understood.",
      cites: [d.felt],
      share: { text: "I've been thinking about being understood.", cites: [d.felt] },
    });
    const shown = (dreamShowLines(c, d.dream) ?? []).join("\n");
    expect(shown).toContain(`Reflection ${begun.bundle.reflection}`);
    expect(shown).toContain("I keep wanting to be understood.");
    expect(shown).toContain("Morning share:");
    expect((dreamShowLines(c, begun.bundle.reflection) ?? []).join("\n")).toContain("It rests on:");
    expect(dreamListLines(c).join("\n")).toContain("share not told yet");
    const core = coreListLines(c).join("\n");
    expect(core).toContain("about the owner");
    expect(core).toContain("--reflected-feeling off");
  });

  test("mechanisms: a reflection is counted beside the dream, and a reflection's return beside the others", async () => {
    const { mechanismEvidence } = await import("../src/adapters/mechanism-evidence.js");
    dateN = 0;
    const c = brain();
    nextDay(c);
    const id = mem(c, "I felt proud of the dashboard.", { kind: "self", about: "me" });
    nextDay(c);
    reflect(c, [id]);
    const day = c.store.livedDay();
    const { verdicts } = mechanismEvidence(c.store, { sinceDay: day - 7, today: day });
    const dreaming = verdicts.find((v) => v.id === "dreaming");
    expect(dreaming?.parts.find((p) => p.key === "reflections")?.count).toBe(1);
    const consolidation = verdicts.find((v) => v.id === "consolidation");
    expect(consolidation?.parts.find((p) => p.key === "returns")?.count).toBe(1);
  });
});
