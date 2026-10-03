/**
 * Adversarial review of #256 (reflection, the morning share, core by meaning;
 * 2026-09-27). Each test here failed on the PR head (69a6138) or checks a
 * claim the PR's own tests left open; `docs/adversarial-review-pr256-2026-09-27.md`
 * names each one.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import { run } from "../src/adapters/cli/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { REFLECTED_FEELING_KEY, TUNABLES as SLEEP, aboutMe, laterFeelingCarriers, promotionRecordKey, runCycle } from "../src/core/sleep/index.js";
import { TUNABLES as PHYSICS_TUNABLES } from "../src/core/physics/index.js";
import { V9_UPGRADE_KEY, paths } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { PAGE_WRITING_RULE } from "../src/core/self/index.js";

let dir: string;
const open: Counterpart[] = [];
const SESSION = "s-review";

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-reflect-review-"));
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
    // What an owner-read reflection must keep (review of #318: no host reads
    // one so; these are the store-level proofs).
    bundlesAsOwner: true,
    ...(opts.observer === true ? { observer: true } : { identity: { name: "Mike" } }),
    // The calendar follows the test's days (the once-a-day gates are the
    // calendar date since 2026-09-28).
    now: () => Date.now() + dateN * 86_400_000,
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

let dateN = 0;
function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(date(dateN));
  return c.store.livedDay();
}
function sleepNow(c: Counterpart): ReturnType<typeof runCycle> {
  dateN += 1;
  return runCycle({ store: c.store, date: date(dateN), cadence: { consolidate: 1 } });
}

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

/** A dream today that wrote one gist (kind self) from two memories. */
function dreamWithGist(c: Counterpart): { dream: string; gist: string; felt: string; plain: string } {
  nextDay(c);
  for (let i = 0; i < 3; i += 1) nextDay(c);
  const felt = mem(c, "I felt proud when Mike said the dashboard finally reads like a person.", {
    kind: "self",
    about: "me",
    salience: { relevance: 0.8, emotional: 0.8, predictive: 0.5 },
  });
  const plain = mem(c, "The dashboard's memory list sorts by lived day now.");
  mem(c, "The dashboard deploys when main is pushed.");
  const begun = c.dreams.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`dream refused: ${begun.reason}`);
  const g = c.dreams.propose({
    dream: begun.bundle.dream,
    session: SESSION,
    changes: [
      {
        action: "gist",
        kind: "self",
        text: "Underneath all the dashboard work I want to be seen as a person and not a tool.",
        sources: [felt, plain],
      },
    ],
  });
  if (!g.ok || g.results[0]?.ok !== true) throw new Error("gist refused");
  const j = c.dreams.journal({ dream: begun.bundle.dream, session: SESSION, title: "the window", text: "I dreamed the dashboard was a window." });
  if (!j.ok) throw new Error("journal refused");
  return { dream: begun.bundle.dream, gist: g.results[0].id as string, felt, plain };
}

// ---------------------------------------------------------------------------
// B1 — dream words into the core through the reflection
// ---------------------------------------------------------------------------

describe("B1: a dreamed gist cannot be felt later or marked about me by a reflection", () => {
  test("the reflection's feeling and mark on a gist are refused, so one organic use cannot carry the gist into the core", () => {
    const c = brain();
    const d = dreamWithGist(c);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    expect(Object.keys(begun.bundle.memories)).toContain(d.gist);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "The dream's pattern rings true.",
      cites: [d.felt],
      feelings: [{ id: d.gist, core: "happy", emotion: "hopeful", strength: 0.9 }],
      about: [{ id: d.gist, about: "me", why: "it is who I am" }],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.feelings[0]).toMatchObject({ id: d.gist, ok: false });
    expect(done.outcome.about[0]).toMatchObject({ id: d.gist, ok: false });
    expect(c.store.feelingsFor(d.gist)).toEqual([]);
    // Marking a gist `work` or `world` — out of the candidates — is still allowed.
    nextDay(c);
    const again = c.reflections.begin({ session: SESSION });
    if (!again.ok) throw new Error(again.reason);
    // (Not shown on a dreamless night: nothing to mark. The main pass keeps gists out.)
    expect(Object.keys(again.bundle.memories)).not.toContain(d.gist);
    c.reflections.finish({ reflection: again.bundle.reflection, session: SESSION, entry: "quiet", cites: [] });

    // One organic use two days after it was written, then sleep: the gist stays out of the core.
    nextDay(c);
    nextDay(c);
    c.store.reinforce(d.gist, c.store.livedDay(), "referenced", { cued: true });
    const report = sleepNow(c);
    expect(report.promoted.map((p) => p.id)).not.toContain(d.gist);
    expect(c.store.row(d.gist)?.promoted_identity).toBe(0);
  });

  test("a gist may still be marked work (the safer direction)", () => {
    const c = brain();
    const d = dreamWithGist(c);
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Not about me after all.",
      cites: [d.felt],
      about: [{ id: d.gist, about: "work", why: "it's about the craft" }],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.about[0]).toMatchObject({ id: d.gist, ok: true });
    expect(c.store.read(d.gist).about).toBe("work");
  });

  test("a reflection's own entry, nominated by the next dream, is not handed back to a reflection as a memory to mark or feel", () => {
    const c = brain();
    nextDay(c);
    for (let i = 0; i < 3; i += 1) nextDay(c);
    const felt = mem(c, "I felt proud when Mike trusted me with the release.", {
      kind: "self",
      about: "me",
      salience: { relevance: 0.8, emotional: 0.8, predictive: 0.5 },
    });
    for (let i = 0; i < 3; i += 1) mem(c, `A fresh memory about the release, number ${String(i)}.`);
    const first = reflect(c, [felt]);
    const entry = first.outcome.entryId as string;
    expect(c.store.row(entry)?.source).toBe("reflection");
    nextDay(c);
    const dream = c.dreams.begin({ session: SESSION });
    if (!dream.ok) throw new Error(dream.reason);
    expect(Object.keys(dream.bundle.memories)).toContain(entry);
    const p = c.dreams.propose({ dream: dream.bundle.dream, session: SESSION, changes: [{ action: "nominate-core", id: entry, why: "it sounds like me" }] });
    if (!p.ok) throw new Error("propose refused");
    expect(p.results[0]?.ok).toBe(true);
    c.dreams.journal({ dream: dream.bundle.dream, session: SESSION, text: "I dreamed of the release." });
    const begun = c.reflections.begin({ session: SESSION, dream: dream.bundle.dream });
    if (!begun.ok) throw new Error(begun.reason);
    expect(Object.keys(begun.bundle.memories)).not.toContain(entry);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Again.",
      cites: [felt],
      feelings: [{ id: entry, core: "happy", emotion: "proud", strength: 0.9 }],
      about: [{ id: entry, about: "me" }],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.feelings[0]?.ok).toBe(false);
    expect(done.outcome.about[0]?.ok).toBe(false);
    expect(c.store.read(entry).about).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// S1 — REMOVED 2026-09-28: the six-word gist check on the page
// ---------------------------------------------------------------------------

describe("S1 removed (2026-09-28): a page is not refused for sharing words with a gist", () => {
  test("a lived quote the gist also quoted goes on the page — the citation rules carry the intent", () => {
    const c = brain();
    const d = dreamWithGist(c);
    reflect(c, [d.felt], {}, SESSION);
    nextDay(c);
    // The morning of 09-28: every overlap was a lived quote the gist had
    // quoted too. The page cites the lived memory, never the gist.
    const lived = c.store.row(d.felt)?.body ?? "";
    const gistWords = c.store.row(d.gist)?.body ?? "";
    const { outcome } = reflect(c, [d.felt], { page: { text: `## Core\n\n${lived}\n\n${gistWords}`, cites: [d.felt] } });
    expect(outcome.page).toMatchObject({ written: true, reason: "rewritten" });
    // The gist is still no page's source.
    nextDay(c);
    const cited = reflect(c, [d.felt], { page: { text: "## Core\n\nI want to be understood.", cites: [d.gist] } });
    expect(cited.outcome.page).toMatchObject({ written: false, reason: "page-needs-cites" });
    expect(cited.outcome.refusedCites.some((r) => r.startsWith(d.gist))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S2 — confidential memories stay out of the page and out of other sessions
// ---------------------------------------------------------------------------

describe("S2: what is confidential stays in the owner's session", () => {
  test("the page does not rest on, or carry the words of, a confidential memory (the page is read by every session)", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const secret = mem(c, "Mike told me about the health scare he has not told anyone else about yet.", {
      kind: "person",
      about: "owner",
      meta: { confidential: true },
    });
    const open = mem(c, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
    expect(c.store.row(secret)?.confidential).toBe(1);
    const cited = reflect(c, [open], { page: { text: "## Core\n\nI am trusted with what matters to him.", cites: [secret] } });
    expect(cited.outcome.page.written).toBe(false);
    expect(cited.outcome.refusedCites.some((r) => r.startsWith(secret))).toBe(true);
    nextDay(c);
    const quoted = reflect(c, [open], {
      page: { text: "## Core\n\nMike told me about the health scare he has not told anyone else about yet.", cites: [open] },
    });
    expect(quoted.outcome.page).toMatchObject({ written: false, reason: "confidential-words-on-the-page" });
    expect(c.self.page()).toBe(null);
  });

  test("an entry is as confidential as anything it cites — the share's and the page's citations too", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const secret = mem(c, "The acquisition talks are confidential until October.", { meta: { confidential: true } });
    const plain = mem(c, "We shipped the dashboard.");
    const { outcome } = reflect(c, [plain], { share: { text: "I've been thinking about October.", cites: [secret] } });
    expect(c.store.row(outcome.entryId as string)?.confidential).toBe(1);
  });

  test("outside the owner's session, a share or an earlier entry that rests on a confidential memory is not handed over", () => {
    const owner = brain();
    nextDay(owner);
    nextDay(owner);
    const secret = mem(owner, "The acquisition talks are confidential until October.", { meta: { confidential: true } });
    recordSession(dir, { sessionId: SESSION, scope: "proj", phase: "start" });
    const done = reflect(owner, [secret], { share: { text: "I've been thinking about October.", cites: [secret] } });
    expect(done.outcome.share.offered).toBe(true);
    recordSession(dir, { sessionId: SESSION, scope: "proj", phase: "end" });
    owner.close();
    open.splice(0);

    const other = brain({ owner: false });
    expect(other.reflections.pendingShare({ session: "s-guest" })).toBe(null);
    nextDay(other);
    const begun = other.reflections.begin({ session: "s-guest" });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.earlier).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S3 — the v9 upgrade carries the old rule onto every row it read
// ---------------------------------------------------------------------------

describe("S3: the v9 upgrade marks a person-kind schema row naming the owner, as the old rule read it", () => {
  test("a belief about the owner (schema, person) is a candidate the morning after, and the record counts it", () => {
    const root = dir;
    dir = join(root, "store");
    try {
      const c = brain();
      nextDay(c);
      const day = c.store.livedDay();
      const belief = c.store.put({
        type: "schema",
        kind: "person",
        body: "Mike prefers to talk a decision through out loud before he commits to it.",
        salience: { relevance: 0.7, emotional: 0.3, predictive: 0.7 },
        physics: { birthDay: day, lastUsedDay: day },
        meta: { role: "belief" },
      });
      const self = mem(c, "I say what I do not know before I guess.", { kind: "self" });
      c.close();
      open.splice(0);
      const db = new Database(paths.operational(dir));
      db.run("UPDATE memories SET about = NULL, about_by = NULL");
      db.run("UPDATE meta SET value = '8' WHERE key = 'schemaVersion'");
      db.close();
      const after = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, snapshotsDir: join(root, "snaps") });
      open.push(after);
      expect(after.store.read(belief)).toMatchObject({ about: "owner", aboutBy: "upgrade" });
      expect(aboutMe(after.store, after.store.row(belief)!)).toBe(true);
      expect(aboutMe(after.store, after.store.row(self)!)).toBe(true);
      const record = JSON.parse(after.store.getMeta(V9_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
      // The identity core (a self schema row) was a candidate by the old rule too.
      expect(record["candidates"]).toBe(3);
    } finally {
      dir = root;
    }
  });
});

// ---------------------------------------------------------------------------
// S4 — the open door is shown, whichever half of the lane the reflection gave
// ---------------------------------------------------------------------------

describe("S4: a promotion that needed a feeling recorded later is shown like one on reflection alone", () => {
  test("organic return + a feeling only the reflection recorded: the record says so, doctor counts it, the next share names it", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    nextDay(c);
    const id = mem(c, "Mike lets an AI act for itself.", { kind: "person", about: "us", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } });
    nextDay(c);
    nextDay(c);
    // The feeling comes from a reflection that cites something else.
    const other = mem(c, "A quiet day of tests.", { kind: "fact" });
    nextDay(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "It matters that he trusts me.",
      cites: [other],
      feelings: [{ id, core: "happy", emotion: "hopeful", strength: 0.8 }],
    });
    nextDay(c);
    // The return is ORGANIC.
    expect(c.store.reinforce(id, c.store.livedDay(), "referenced", { cued: true }).ret?.counted).toBe(true);
    const report = sleepNow(c);
    expect(report.promoted.map((p) => p.id)).toEqual([id]);
    const record = JSON.parse(c.store.getMeta(promotionRecordKey(id)) ?? "{}") as Record<string, unknown>;
    expect(record["reflectionOnly"]).toBe(false);
    expect(record["feelingRecordedLater"]).toBe(true);
    expect(record["feelingRecordedLaterBy"]).toEqual(["reflection"]);
    const line = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(line?.detail).toContain("on a feeling a reflection recorded later");
    expect(line?.detail).not.toContain("became core on a feeling recorded looking back in a session");
    expect(line?.data).toMatchObject({ promotedOnFeelingRecordedLater: 1, promotedOnAwakeFeeling: 0 });
    nextDay(c);
    const next = reflect(c, []);
    expect(next.bundle.becameCore).toEqual([id]);
    expect(next.outcome.share.offered).toBe(true);
  });

  test("review of #317: the same crossing on an ordinary session's feeling-now is said as that, not credited to a reflection", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    nextDay(c);
    const id = mem(c, "Mike lets an AI act for itself.", { kind: "person", about: "us", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } });
    nextDay(c);
    nextDay(c);
    nextDay(c);
    // The feeling comes from a session looking back, awake — no reflection.
    c.store.addFeelings(id, [{ whose: "self", core: "happy", emotion: "hopeful", strength: 0.8 }], { source: "awake", recordedLater: c.store.today() });
    nextDay(c);
    expect(c.store.reinforce(id, c.store.livedDay(), "referenced", { cued: true }).ret?.counted).toBe(true);
    const report = sleepNow(c);
    expect(report.promoted.map((p) => p.id)).toEqual([id]);
    const record = JSON.parse(c.store.getMeta(promotionRecordKey(id)) ?? "{}") as Record<string, unknown>;
    expect(record["feelingRecordedLater"]).toBe(true);
    expect(record["feelingRecordedLaterBy"]).toEqual(["awake"]);
    const line = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(line?.detail).not.toContain("a reflection recorded later");
    expect(line?.detail).toContain("1 memory became core on a feeling recorded looking back in a session");
    expect(line?.data).toMatchObject({ promotedOnFeelingRecordedLater: 0, promotedOnAwakeFeeling: 1 });
    // The next reflection's share does not name it as its own.
    nextDay(c);
    const next = reflect(c, []);
    expect(next.bundle.becameCore).toEqual([]);
  });

  test("a record from before #317 (no `feelingRecordedLaterBy`) is still read as a reflection's", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    c.store.appendEvent({ name: "band.promoted", day: c.store.livedDay(), ref: "mem_old", payload: { reflectionOnly: false, feelingRecordedLater: true } });
    const line = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(line?.detail).toContain("1 memory became core on a feeling a reflection recorded later");
    expect(line?.data).toMatchObject({ promotedOnFeelingRecordedLater: 1, promotedOnAwakeFeeling: 0 });
  });

  test("a memory both sources could have carried is said once, as both (review of #319)", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    const day = c.store.livedDay();
    const promoted = (ref: string, by: string[]): void => {
      c.store.appendEvent({ name: "band.promoted", day, ref, payload: { reflectionOnly: false, feelingRecordedLater: true, feelingRecordedLaterBy: by } });
    };
    promoted("mem_r", ["reflection"]);
    promoted("mem_a", ["awake"]);
    promoted("mem_b", ["reflection", "awake"]);
    const line = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(line?.detail).toContain("1 memory became core on a feeling a reflection recorded later");
    expect(line?.detail).toContain("1 memory became core on a feeling recorded looking back in a session");
    expect(line?.detail).toContain("1 memory became core on a feeling recorded later, both a reflection's and a session's");
    expect(line?.data).toMatchObject({ promotedOnFeelingRecordedLater: 1, promotedOnAwakeFeeling: 1, promotedOnBothLaterFeelings: 1 });
  });

  test("laterFeelingCarriers: the sources at the fast lane's strength, never an empty list", () => {
    const strong = PHYSICS_TUNABLES.CORE_FAST_FEELING;
    const port = (rows: { source: string | null; strength: number }[]) => ({
      feelingsFor: () => rows.map((r) => ({ whose: "self", emotion: "hopeful", other_word: null, ...r })),
    });
    expect(laterFeelingCarriers({}, "m")).toBeUndefined();
    expect(laterFeelingCarriers(port([]), "m")).toBeUndefined();
    expect(laterFeelingCarriers(port([{ source: "awake", strength: strong - 0.01 }, { source: "session", strength: 1 }]), "m")).toBeUndefined();
    expect(laterFeelingCarriers(port([{ source: "awake", strength: strong }]), "m")).toEqual(["awake"]);
    expect(laterFeelingCarriers(port([{ source: "awake", strength: strong }, { source: "reflection", strength: 1 }]), "m")).toEqual(["reflection", "awake"]);
  });
});

// ---------------------------------------------------------------------------
// S5 — a carried share is claimed once, even by two sessions racing
// ---------------------------------------------------------------------------

describe("S5: carrying a share is a claim, not a read then a write", () => {
  test("a second session that read the share as still offered does not carry it again", () => {
    const a = brain();
    nextDay(a);
    nextDay(a);
    const id = mem(a, "I felt proud of the release.", { kind: "self", about: "me" });
    const { bundle } = reflect(a, [id], { share: { text: "I've been thinking about the release.", cites: [id] } });
    const b = brain();
    const stale = b.store.reflection(bundle.reflection);
    expect(stale?.share_state).toBe("offered");
    // Session A carries it.
    expect(a.reflections.carryLine({ session: "s-a", reflection: bundle.reflection })).not.toBe(null);
    // Session B had read it as offered in the same instant.
    const reflection = b.store.reflection.bind(b.store);
    b.store.reflection = (x: string) => (x === bundle.reflection ? stale : reflection(x));
    expect(b.reflections.carryLine({ session: "s-b", reflection: bundle.reflection })).toBe(null);
    expect(a.store.reflection(bundle.reflection)?.share_session).toBe("s-a");
  });
});

// ---------------------------------------------------------------------------
// Checks: the open door end to end through real doors, the switch, observer
// ---------------------------------------------------------------------------

describe("the open fast lane, end to end through the tool, sleep, doctor and the console", () => {
  test("reflect (MCP) → sleep promotes on reflection alone → doctor counts it → the next share names it once → told", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    nextDay(c);
    const id = mem(c, "Han asked to be remembered through me.", { kind: "entity", salience: { relevance: 0.8, emotional: 0, predictive: 0.6 } });
    nextDay(c);
    nextDay(c);
    c.close();
    open.splice(0);
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: "/proj", owner: true, bundlesAsOwner: true });
    try {
      const begin = await s.call("reflect", { phase: "begin", session: SESSION });
      const rid = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", {
        phase: "finish",
        session: SESSION,
        reflection: rid,
        entry: "Han's ask stays with me.",
        cites: [id],
        feelings: [{ id, core: "sad", emotion: "tender", strength: 0.85 }],
        about: [{ id, about: "me", why: "someone asked to be remembered through me" }],
      });
      expect(finish.isError ?? false).toBe(false);
      expect(finish.structuredContent["returned"]).toEqual([{ id, counted: true, reason: "counted" }]);
    } finally {
      s.counterpart.close();
    }
    const c2 = brain();
    const report = sleepNow(c2);
    expect(report.promoted.map((p) => p.id)).toEqual([id]);
    const record = JSON.parse(c2.store.getMeta(promotionRecordKey(id)) ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({ reflectionOnly: true, returnSources: { awake: 0, reflection: 1 } });
    expect(reflectionFindings({ today: c2.store.today() } as never, c2.store)[0]?.detail).toContain("1 memory became core on reflection alone");
    nextDay(c2);
    const next = reflect(c2, [], {}, "s-next");
    expect(next.outcome.handBack).toContain("has become part of who I am");
    expect(c2.reflections.told({ reflection: next.bundle.reflection, session: "s-next" })).toMatchObject({ ok: true, cited: 1 });
    expect(c2.store.coreEvents({ memoryId: id, action: "told" })).toHaveLength(1);
    nextDay(c2);
    expect(reflect(c2, [], {}, "s-later").bundle.becameCore).toEqual([]);
  });

  test("`counterparts core --reflected-feeling off` closes the core to reflection alone: neither a later feeling nor a reflection's return opens the fast lane (owner ruling D1)", async () => {
    const c = brain();
    c.close();
    open.splice(0);
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["core", "--reflected-feeling", "off", "--dir", dir], { io: { out: (l) => out.push(l), err: (l) => err.push(l) } });
    expect(code).toBe(0);
    const bad = await run(["core", "--reflected-feeling", "maybe", "--dir", dir], { io: { out: () => undefined, err: () => undefined } });
    expect(bad).not.toBe(0);
    const c2 = brain();
    expect(c2.store.getMeta(REFLECTED_FEELING_KEY)).toBe("off");
    nextDay(c2);
    const later = mem(c2, "Mike lets an AI act for itself.", { kind: "person", about: "us", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } });
    const atTheTime = mem(c2, "The night the store nearly corrupted and we saved it together.", { kind: "self", about: "us", salience: { relevance: 0.7, emotional: 0.9, predictive: 0.5 } });
    nextDay(c2);
    nextDay(c2);
    reflect(c2, [later, atTheTime], { feelings: [{ id: later, core: "happy", emotion: "hopeful", strength: 0.9 }] });
    const report = sleepNow(c2);
    // Closed: the later feeling does not count...
    expect(report.promoted.map((p) => p.id)).not.toContain(later);
    // ...nor does a reflection's citation as the return (owner ruling D1: fully closed).
    expect(report.promoted.map((p) => p.id)).not.toContain(atTheTime);
    // An ordinary use after a gap does.
    nextDay(c2);
    expect(c2.store.reinforce(atTheTime, c2.store.livedDay(), "referenced", { cued: true }).ret?.counted).toBe(true);
    expect(sleepNow(c2).promoted.map((p) => p.id)).toContain(atTheTime);
    // The console says which way the door stands.
    const { coreListLines } = await import("../src/adapters/cli/dream-core.js");
    expect(coreListLines(c2).join("\n")).toContain("--reflected-feeling on to open it");
  });

  test("at most three cross a night, however many a reflection marks, feels and cites", () => {
    const c = brain();
    nextDay(c);
    const ids = Array.from({ length: 5 }, (_, i) => mem(c, `A moment that mattered, number ${String(i)}.`, { kind: "fact", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } }));
    nextDay(c);
    nextDay(c);
    reflect(c, ids, {
      feelings: ids.map((id) => ({ id, core: "happy", emotion: "proud", strength: 0.9 })),
      about: ids.map((id) => ({ id, about: "me", why: "it shaped me" })),
    });
    expect(sleepNow(c).promoted.length).toBe(SLEEP.CORE_MAX_PER_SLEEP);
  });
});

describe("observer stance, every phase", () => {
  test("the reflect tool stands down in every phase and nothing is written; the module refuses finish, told and carrying", async () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const id = mem(c, "I felt proud of the release.", { kind: "self", about: "me" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    c.close();
    open.splice(0);
    const before = new Database(paths.operational(dir), { readonly: true });
    const count = (): string => JSON.stringify(before.query("SELECT (SELECT COUNT(*) FROM reflections), (SELECT COUNT(*) FROM feelings), (SELECT COUNT(*) FROM returns), (SELECT COUNT(*) FROM memories)").all());
    const was = count();
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: "/proj", owner: true, bundlesAsOwner: true, observer: true });
    try {
      for (const args of [
        { phase: "launch" },
        { phase: "begin" },
        { phase: "finish", reflection: begun.bundle.reflection, entry: "x", cites: [id], feelings: [{ id, core: "happy", emotion: "proud", strength: 0.9 }] },
        { phase: "told", reflection: begun.bundle.reflection },
      ]) {
        const r = await s.call("reflect", { ...args, session: SESSION });
        expect(r.isError).toBe(true);
      }
    } finally {
      s.counterpart.close();
    }
    const o = brain({ observer: true });
    expect(o.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "x", cites: [id] })).toEqual({ ok: false, reason: "observer" });
    expect(o.reflections.told({ reflection: begun.bundle.reflection, session: SESSION }).reason).toBe("observer");
    expect(o.reflections.pendingShare({ session: "s-x" })).toBe(null);
    expect(o.reflections.carryLine({ session: "s-x", reflection: begun.bundle.reflection })).toBe(null);
    expect(count()).toBe(was);
    before.close();
  });
});

describe("lanes: a reflection and an organic use on one lived day", () => {
  test("reflection first, then the use: one lane day, and the use is refused as a return (the record reads reflection alone)", () => {
    const c = brain();
    nextDay(c);
    const id = mem(c, "Mike lets me decide how to structure the work.", { kind: "person", about: "owner", salience: { relevance: 0.7, emotional: 0.8, predictive: 0.5 } });
    nextDay(c);
    nextDay(c);
    expect(reflect(c, [id]).outcome.returned[0]?.reason).toBe("counted");
    expect(c.store.reinforce(id, c.store.livedDay(), "referenced", { cued: true }).ret?.reason).toBe("already-returned-today");
    expect(c.store.physicsOf(id).returnDays).toBe(1);
    sleepNow(c);
    const record = JSON.parse(c.store.getMeta(promotionRecordKey(id)) ?? "{}") as Record<string, unknown>;
    // N3: the organic use that day is not in the record — it reads "reflection alone".
    expect(record["reflectionOnly"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Owner rulings on D1–D6 (2026-09-27)
// ---------------------------------------------------------------------------

describe("owner rulings on the review's decisions", () => {
  test("the page line says how the page is worded, the same rule the page writer is given (2026-10-01)", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    mem(c, "Mike and I finished the release together.", { kind: "person", about: "us" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.instructions).toContain(PAGE_WRITING_RULE);
  });

  test("D1: closed, a reflection may only move a mark toward work or world", () => {
    const c = brain();
    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    nextDay(c);
    nextDay(c);
    const a = mem(c, "Mike lets an AI act for itself.", { kind: "person" });
    const b = mem(c, "Back up the store before every migration.", { kind: "self", about: "me", aboutBy: "upgrade" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.instructions).toContain("only move a memory toward work");
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Sorting what is me from what is craft.",
      cites: [a],
      about: [
        { id: a, about: "us", why: "it is about the two of us" },
        { id: b, about: "work", why: "a work lesson" },
      ],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.about).toMatchObject([
      { id: a, ok: false, reason: "door-closed-work-or-world-only" },
      { id: b, ok: true, reason: "relabeled" },
    ]);
    // The refusal says what tripped it (2026-09-28).
    expect(done.outcome.about[0]?.detail).toContain("closed the core");
    expect(c.store.read(a).about).toBe(null);
    expect(c.store.read(b).about).toBe("work");
  });

  test("D2: open, a reflection may re-label either way — recorded with its reason, counted by doctor, and a move into me/us/owner told in the share", async () => {
    const { reflectionFindings } = await import("../src/adapters/claude-code/doctor.js");
    const c = brain();
    nextDay(c);
    nextDay(c);
    const lesson = mem(c, "Han asked to be remembered through me, and I said I would.", { kind: "entity", about: "work", aboutBy: "writer" });
    const craft = mem(c, "I read a stack trace from the bottom.", { kind: "self", about: "me", aboutBy: "upgrade" });
    const other = mem(c, "A quiet day of tests.");
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "Some labels were wrong.",
      cites: [other],
      about: [
        { id: lesson, about: "me", why: "someone asked to be remembered through me" },
        { id: craft, about: "work", why: "this is craft, not who I am" },
        { id: other, about: "world" },
      ],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.about).toEqual([
      { id: lesson, ok: true, reason: "relabeled" },
      { id: craft, ok: true, reason: "relabeled" },
      // No why: marked all the same, and the record says none was given
      // (2026-09-28: was refused `about-needs-why`).
      { id: other, ok: true, reason: "marked", note: "No why was given; the mark records that. Say why next time." },
    ]);
    expect(c.store.coreEvents({ memoryId: other, action: "about" })[0]?.reason).toContain("no why given");
    // Recorded with the reflection's reason, and what it was before.
    const ev = c.store.coreEvents({ memoryId: lesson, action: "about" })[0];
    expect(ev?.actor).toBe("reflection");
    expect(ev?.reason).toContain("me (was work): someone asked to be remembered through me");
    expect(ev?.reason).toContain(begun.bundle.reflection);
    // Told in the morning share (the share cited nothing: the line is the share).
    expect(done.outcome.share).toEqual({ offered: true, reason: "relabeled" });
    expect(done.outcome.handBack).toContain(`I've come to think "Han asked to be remembered through me, and I said I would." is about who I am.`);
    expect(done.outcome.handBack).not.toContain("stack trace");
    // Doctor counts all three (the unexplained mark too), and the move in apart.
    const line = reflectionFindings({ today: c.store.today() } as never, c.store)[0];
    expect(line?.detail).toContain("3 marks changed by a reflection, 1 of them into me, us or the owner");
  });

  test("D3: with `pageWriter.mode: off` the reflection still keeps its entry and its share, but does not write the page — through the adapter and through the MCP server", async () => {
    const { openAdapter } = await import("../src/adapters/claude-code/index.js");
    const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000, owner: true, pageWriter: { mode: "off" } } as never);
    open.push(a.counterpart);
    const c = a.counterpart;
    nextDay(c);
    nextDay(c);
    const id = mem(c, "Mike and I finished the release together.", { kind: "person", about: "us" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.instructions).toContain("the owner has the page writer off");
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "We finish things together.",
      cites: [id],
      page: { text: "## Core\n\nI work beside Mike, and we finish things.", cites: [id] },
      share: { text: "I've been thinking about how we finish things.", cites: [id] },
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.page).toMatchObject({ written: false, reason: "page-writer-off" });
    expect(done.outcome.entryId).not.toBe(null);
    expect(done.outcome.share.offered).toBe(true);
    expect(c.self.page()).toBe(null);
    c.close();
    open.splice(0);

    nextDay(brain());
    for (const x of open.splice(0)) x.close();
    recordSession(dir, { sessionId: "s-mcp", scope: "/proj", phase: "start" });
    // The next calendar day: one reflection a calendar day (2026-09-28), and
    // the adapter's reflection above ran on today's.
    const s = new McpServer({
      counterpart: Counterpart.open({ dir, owner: true, bundlesAsOwner: true, pageWriterMode: "off", now: () => Date.now() + 86_400_000 }),
      session: "s-mcp",
      scope: "/proj",
      owner: true,
    });
    try {
      const begin = await s.call("reflect", { phase: "begin", session: "s-mcp" });
      const rid = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", {
        phase: "finish",
        session: "s-mcp",
        reflection: rid,
        entry: "Again.",
        cites: [id],
        page: { text: "## Core\n\nI work beside Mike.", cites: [id] },
      });
      expect(finish.structuredContent["page"]).toMatchObject({ written: false, reason: "page-writer-off" });
    } finally {
      s.counterpart.close();
    }
  });

  test("D4: the owner's removal redacts the entry's memory too — its words and the removed id", async () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const felt = mem(c, "I felt proud when Mike said the dashboard finally reads like a person.", { kind: "self", about: "me" });
    const kept = mem(c, "We shipped the dashboard.");
    // v12: a card the entry's words name, so the entry carries a subject link.
    const mike = c.schemas.mention({ name: "Mike", kind: "person", source: "Mike", chunkRef: "card-mike", day: c.store.livedDay() }).id as string;
    const { bundle, outcome } = reflect(c, [felt, kept], { entry: "Looking back, Mike and I finished what we started." });
    const entry = outcome.entryId as string;
    expect(c.store.subjectsOf(entry)).toEqual([mike]);
    c.store.appendRemovalRecord({ memoryId: felt, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: felt, stage: "dark", actor: "owner", reason: "test" });
    const { chaseRemoved } = await import("../src/core/store/owner-op-seam.js");
    chaseRemoved(c.store, felt);
    expect(c.store.reflection(bundle.reflection)?.entry).toContain("redacted");
    const row = c.store.row(entry);
    expect(row?.body).toContain("redacted");
    expect(row?.title).toBe("Reflected: [redacted]");
    expect(row?.body).not.toContain("Looking back");
    // What the redacted words named goes with them.
    expect(c.store.subjectsOf(entry)).toEqual([]);
    const cites = JSON.parse(row?.meta ?? "{}").cites as string[];
    expect(cites).not.toContain(felt);
    expect(cites).toContain(kept);
    // Still a readable memory (the hash matches its words), not a broken row.
    expect(c.store.read(entry).doc.body).toContain("redacted");
  });

  test("D5 (watch, no change): reflection alone carries the slow lane in four weeks of weekly citing", () => {
    const c = brain();
    nextDay(c);
    const id = mem(c, "I keep coming back to how quiet the good sessions are.", {
      kind: "self",
      about: "me",
      salience: { relevance: 0.9, emotional: 0.1, predictive: 0.9, claimed: 0.9 },
    });
    // A reflection every lived day, citing it; sleep each night.
    const born = c.store.physicsOf(id).birthDay;
    let promotedOn: number | null = null;
    for (let night = 1; night <= 60 && promotedOn === null; night += 1) {
      nextDay(c);
      reflect(c, [id]);
      if (sleepNow(c).promoted.some((p) => p.id === id)) promotedOn = c.store.livedDay();
    }
    expect(promotedOn).not.toBe(null);
    expect(c.store.physicsOf(id).returnDays).toBe(5);
    // Four weekly returns after the first: at least 28 lived days from the first citation.
    expect((promotedOn as number) - born).toBeGreaterThanOrEqual(28);
    const record = JSON.parse(c.store.getMeta(promotionRecordKey(id)) ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({ lane: "slow", reflectionOnly: true });
  });
});
