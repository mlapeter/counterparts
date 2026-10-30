/**
 * THE NIGHT DOESN'T READ A FOLDER THAT DOESN'T EXPORT (2026-10-30, `core/dream/slices.ts`).
 * Day's end, the dream, the reflection and the tagging write what every session
 * reads, so a folder set off, paused or to observe, and anything under one, is
 * closed to them: not in what they're handed, not from their recall however the
 * question is put, not in a merge or a gist. Stored rows stay stored, and an
 * ordinary session's recall is not this file's business.
 *
 * Every case goes through the tool doors, with the folder setting set before the
 * night runs. Hermetic: a temp dir made and removed here; every word invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nightHeldFindings } from "../src/adapters/claude-code/doctor-write-ups.js";
import { runNight } from "../src/adapters/claude-code/night-run.js";
import type { NightAnswer } from "../src/adapters/claude-code/night-run.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { scopesPath, setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat } from "../src/core/counterpart.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";

const HOUR = 3_600_000;
const BUDGET = 9_000;
const D0 = "2026-10-22";
const D1 = "2026-10-23";
const D2 = "2026-10-24";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;
const WRITER = "a7a7a7a7-0000-4000-8000-000000000002";
const NIGHT = "b8b8b8b8-0000-4000-8000-0000000000aa";

// The question never says these words, so an answer that does was told them.
const SECRET_WORDS = "closed at a loss";
const SECRET = `The quarter ${SECRET_WORDS} from the van repair.`;
const ASKED = "quarter van repair";
const OPEN_WORDS = "netted against the pigeons";
const OPENED = `The broad beans went in by the fence, ${OPEN_WORDS}.`;
const CHAPTER_WORDS = "checked against the statements";
const CHAPTER = `We spent the morning on the figures: two rows of numbers, ${CHAPTER_WORDS}, the spare copies kept dry for a second look in three weeks.`;
const CHAPTER_TITLE = "The autumn figures";

let root: string;
let storeDir: string;
let scopesFile: string;
let HERE: string;
let SHUT: string;
let clock = at(D1, 7);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-fence-")));
  storeDir = join(root, "store");
  scopesFile = join(root, "scopes.json");
  HERE = join(root, "garden");
  SHUT = join(root, "bakery");
  for (const d of [HERE, join(SHUT, "sub")]) mkdirSync(d, { recursive: true });
  clock = at(D1, 7);
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), budgetBytes: BUDGET, now: () => clock, timeZone: "UTC" });
  open.push(c);
  return c;
}

function setting(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: D1 });
  if (reg !== null) writeScopes(scopesFile, reg);
}

function worked(c: Counterpart, scope: string, body: string, date = D1): string {
  clock = at(date, 10);
  c.store.advanceClock(date);
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, about: "work", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, origin: { session: WRITER, scope } });
}

async function chapterIn(c: Counterpart, scope: string): Promise<string> {
  clock = at(D1, 11);
  const s = new McpServer({ counterpart: c, session: WRITER, scope, registryDir: join(root, "registry"), now: () => clock });
  const out = (await s.call("chapter", { text: CHAPTER, title: CHAPTER_TITLE, summary: `${CHAPTER_TITLE}, done.` })).structuredContent;
  return String(out["episodeId"]);
}

function child(c: Counterpart, kind: string | null, opts: { scopes?: string | null } = {}): McpServer {
  const file = opts.scopes === undefined ? scopesFile : opts.scopes;
  return new McpServer({
    counterpart: c,
    session: NIGHT,
    scope: HERE,
    registryDir: join(root, "registry"),
    now: () => clock,
    env: kind === null ? {} : { COUNTERPARTS_NIGHT_CHILD: kind, COUNTERPARTS_NIGHT_RUN: "1" },
    ...(file === null ? {} : { scopesFile: file }),
  });
}

const says = (x: unknown, words: string): boolean => JSON.stringify(x ?? null).includes(words);
function night(): void {
  clock = at(D2, 3);
}

/** Every way of asking, by a child at its door: nothing of the closed folder comes back. */
async function asksEveryWay(s: McpServer, ids: { secret: string; chapter: string }): Promise<void> {
  const ways: [string, Record<string, unknown>, string][] = [
    ["facts", { question: ASKED, mode: "facts" }, SECRET_WORDS],
    ["meaning", { question: ASKED, mode: "meaning" }, SECRET_WORDS],
    ["ids", { ids: [ids.secret] }, SECRET_WORDS],
    ["handle", { handle: ids.secret }, SECRET_WORDS],
    ["a chapter, by facts", { question: "morning figures rows numbers", mode: "facts" }, CHAPTER_WORDS],
    ["a chapter, by meaning", { question: "morning figures rows numbers", mode: "meaning" }, CHAPTER_WORDS],
    ["a chapter, by id", { handle: ids.chapter }, CHAPTER_WORDS],
    ["a chapter, by address", { handle: `${ids.chapter}#1` }, CHAPTER_WORDS],
    ["a chapter, by title", { handle: CHAPTER_TITLE }, CHAPTER_WORDS],
  ];
  for (const [way, args, words] of ways) {
    const got = await s.call("recall", args);
    expect(`${way}: ${String(says(got.structuredContent, words))}`).toBe(`${way}: false`);
  }
}

describe("closed to day's end, the dream and the reflection", () => {
  for (const [mode, under] of [["off", ""], ["observer", ""], ["paused", ""], ["off", "sub"]] as const) {
    test(`a folder set ${mode}${under === "" ? "" : ", a subfolder of it"}: in nobody's hands, from nobody's recall`, async () => {
      const c = brain();
      const scope = under === "" ? SHUT : join(SHUT, under);
      const secret = worked(c, scope, SECRET);
      worked(c, HERE, OPENED);
      const chapter = await chapterIn(c, scope);
      setting({ [HERE]: "on", [SHUT]: mode });
      night();

      const writer = child(c, "writer");
      const block = await writer.call("dream", { phase: "writer", session: NIGHT });
      expect(says(block.structuredContent, OPEN_WORDS)).toBe(true);
      expect(says(block.structuredContent, SECRET_WORDS)).toBe(false);
      expect(says(block.structuredContent, CHAPTER_TITLE)).toBe(false);
      await asksEveryWay(writer, { secret, chapter });

      const dreamer = child(c, "dream");
      const began = await dreamer.call("dream", { phase: "begin", session: NIGHT });
      expect(says(began.structuredContent, OPEN_WORDS)).toBe(true);
      expect(says(began.structuredContent, SECRET_WORDS)).toBe(false);
      expect(says(began.structuredContent, CHAPTER_TITLE)).toBe(false);
      await asksEveryWay(dreamer, { secret, chapter });
      const dream = String(began.structuredContent["dream"]);
      await dreamer.call("dream", { phase: "journal", session: NIGHT, dream, title: "A night", text: "A short dream." });

      clock = at(D2, 4);
      const reflector = child(c, "reflection");
      const reflected = await reflector.call("reflect", { phase: "begin", session: NIGHT, dream });
      expect(says(reflected.structuredContent, SECRET_WORDS)).toBe(false);
      expect(says(reflected.structuredContent, CHAPTER_TITLE)).toBe(false);
      await asksEveryWay(reflector, { secret, chapter });

      // A stored row stays stored.
      expect(c.store.row(secret)?.body).toBe(SECRET);
    });
  }

  test("the tagging child isn't asked to read one, and it doesn't hold a place in the ask", async () => {
    const c = brain();
    worked(c, SHUT, SECRET);
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const asked = await child(c, "tags").call("dream", { phase: "tags", session: NIGHT });
    expect(says(asked.structuredContent, SECRET_WORDS)).toBe(false);
    expect(says(asked.structuredContent, OPEN_WORDS)).toBe(true);
  });

  test("the nightly run starts no tagging child when all that's left untagged is closed", async () => {
    const c = brain();
    worked(c, SHUT, SECRET);
    night();
    c.close();
    open.splice(open.indexOf(c), 1);
    const config = join(root, "claude-code.json");
    const seen: string[] = [];
    const seat: Seat<NightAnswer> = {
      name: "test",
      answer: async (ask) => {
        seen.push(ask.act);
        return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
      },
    };
    const go = (run: string): ReturnType<typeof runNight> =>
      runNight({ open: () => brain(), config: { dataDir: storeDir, injectionBudgetBytes: BUDGET }, configPath: config, run, session: NIGHT, scope: HERE, kind: { kind: "night" }, seat });
    await go("nrn_open");
    expect(seen).toContain("tags");
    seen.length = 0;
    setting({ [HERE]: "on", [SHUT]: "off" });
    await go("nrn_closed");
    expect(seen).not.toContain("tags");
  });

  test("a merge or a gist can't be made from a closed row, whatever id the dream sends", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    const own = worked(c, HERE, OPENED);
    worked(c, HERE, "A second row of the garden, staked and tied.");
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, "dream");
    const dream = String((await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent["dream"]);
    const merge = await s.call("dream", { phase: "propose", session: NIGHT, dream, changes: [{ action: "merge", ids: [secret, own], text: `Both: ${SECRET}`, why: "one thing" }] });
    expect((merge.structuredContent["refused"] as { reason: string }[])[0]?.reason).toBe("not-shown-or-gone");
    const gist = await s.call("dream", { phase: "propose", session: NIGHT, dream, changes: [{ action: "gist", sources: [secret, own], text: `Gist: ${SECRET}`, why: "the gist" }] });
    expect((gist.structuredContent["refused"] as { reason: string }[])[0]?.reason).toBe("not-shown-or-gone");
    expect(c.store.list({ type: "memory", source: "dreamed" })).toEqual([]);
  });

  test("set off between begin and the merge: the merge is still refused", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    const own = worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "on" });
    night();
    const s = child(c, "dream");
    const began = await s.call("dream", { phase: "begin", session: NIGHT });
    expect(says(began.structuredContent, SECRET_WORDS)).toBe(true);
    setting({ [HERE]: "on", [SHUT]: "off" });
    const merge = await s.call("dream", { phase: "propose", session: NIGHT, dream: String(began.structuredContent["dream"]), changes: [{ action: "merge", ids: [secret, own], text: `Both: ${SECRET}`, why: "one thing" }] });
    expect((merge.structuredContent["refused"] as { reason: string }[])[0]?.reason).toBe("not-shown-or-gone");
  });

  test("a merge already stored from a closed row: not read by the night, and not changed", async () => {
    const c = brain();
    const old = worked(c, SHUT, SECRET, D0);
    clock = at(D0, 12);
    const merged = c.store.put({ type: "memory", kind: "fact", body: `Merged: ${SECRET}`, source: "dreamed", about: "work", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, meta: { dream: "d", mergedFrom: [old] }, origin: { session: NIGHT, scope: HERE, ref: "dream:d" } });
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, "dream");
    expect(says((await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent, SECRET_WORDS)).toBe(false);
    const asked = await s.call("recall", { ids: [merged] });
    expect(says(asked.structuredContent, SECRET_WORDS)).toBe(false);
    expect(asked.structuredContent["reason"]).toBe("closed-to-the-night");
    expect(c.store.row(merged)?.archived).toBe(0);
    expect(c.store.row(merged)?.body).toBe(`Merged: ${SECRET}`);
  });

  test("the published wake, composed for no reader, isn't handed to a dream on a night it names a closed row", async () => {
    const c = brain();
    worked(c, SHUT, SECRET);
    worked(c, HERE, OPENED);
    await chapterIn(c, SHUT);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    c.rebrief({ budgetBytes: BUDGET, at: D2 });
    expect(c.store.getMeta("self.briefing") ?? "").toContain(CHAPTER_TITLE);
    const began = await child(c, "dream").call("dream", { phase: "begin", session: NIGHT });
    expect(says(began.structuredContent, CHAPTER_TITLE)).toBe(false);
  });

  test("recall's other asks: a personal thing still open, ids asked together with an open one, a title a closed row shares", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    const own = worked(c, HERE, OPENED);
    clock = at(D1, 12);
    c.store.put({ type: "memory", kind: "fact", body: `An open question: has the quarter ${SECRET_WORDS}?`, about: "owner", title: `Has the quarter ${SECRET_WORDS}?`, meta: { unresolved: true }, origin: { session: WRITER, scope: SHUT } });
    c.store.put({ type: "memory", kind: "fact", body: `Plain words that ${SECRET_WORDS}.`, title: "A shared title", origin: { session: WRITER, scope: SHUT } });
    c.store.put({ type: "memory", kind: "fact", body: `Plain words ${OPEN_WORDS}.`, title: "A shared title", origin: { session: WRITER, scope: HERE } });
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, "dream");
    const both = await s.call("recall", { ids: [secret, own] });
    expect(says(both.structuredContent, SECRET_WORDS)).toBe(false);
    expect(says(both.structuredContent, OPEN_WORDS)).toBe(true);
    expect(says(await child(c, null).call("recall", { handle: "still open" }), SECRET_WORDS)).toBe(true);
    expect(says(await s.call("recall", { handle: "still open" }), SECRET_WORDS)).toBe(false);
    // The title is the open row's alone, to a night: not ambiguous, and read.
    const titled = await s.call("recall", { handle: "A shared title" });
    expect(titled.structuredContent["reason"]).toBe("expanded");
    expect(says(titled.structuredContent, OPEN_WORDS)).toBe(true);
  });

  test("something coming up, written in a closed folder, isn't in the night's still open", async () => {
    const c = brain();
    clock = at(D1, 10);
    const left = new McpServer({ counterpart: c, session: WRITER, scope: SHUT, registryDir: join(root, "registry"), now: () => clock });
    await left.call("remember", { text: `Open: the rota where the quarter ${SECRET_WORDS}.`, unresolved: true, eventDate: "2026-10-25", recurring: "weekly", about: "owner" });
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    expect(says(await child(c, null).call("recall", { handle: "still open" }), SECRET_WORDS)).toBe(true);
    expect(says(await child(c, "dream").call("recall", { handle: "still open" }), SECRET_WORDS)).toBe(false);
  });

  test("a memory written from a closed chapter, with no folder of its own, reads as the chapter's", async () => {
    const c = brain();
    const chapter = await chapterIn(c, SHUT);
    clock = at(D1, 12);
    const own = c.store.put({ type: "memory", kind: "fact", body: SECRET, about: "work", origin: { session: WRITER, ref: chapter } });
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    expect(says(await child(c, "dream").call("recall", { ids: [own] }), SECRET_WORDS)).toBe(false);
  });

  test("a session holding day's end's claim and nothing else reads as the night", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, null);
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(true);
    expect((await s.call("dream", { phase: "writer", session: NIGHT })).structuredContent["writer"]).toBe(true);
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
  });

  test("each night door reads the setting as it stands: set off after the dream, before the reflection, in a child of its own", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "on" });
    night();
    const s = child(c, "dream");
    const dream = String((await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent["dream"]);
    await s.call("dream", { phase: "journal", session: NIGHT, dream, title: "A night", text: "A short dream." });
    setting({ [HERE]: "on", [SHUT]: "off" });
    clock = at(D2, 4);
    c.close();
    open.splice(open.indexOf(c), 1);
    const reflected = await child(brain(), "reflection").call("reflect", { phase: "begin", session: NIGHT, dream });
    expect(says(reflected.structuredContent, SECRET_WORDS)).toBe(false);
    expect(secret.length).toBeGreaterThan(0);
  });

  test("the tagging ask: a closed row isn't under a card, a card only it names isn't listed, its tags aren't offered", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    const own = worked(c, HERE, OPENED);
    clock = at(D1, 12);
    const day = c.store.livedDay();
    const both = c.schemas.mention({ name: "Quillon", kind: "entity", source: "Quillon", chunkRef: "t:1", day }).id as string;
    const theirs = c.schemas.mention({ name: "Sparhawk", kind: "entity", source: "Sparhawk", chunkRef: "t:2", day }).id as string;
    c.store.linkSubjects([{ memoryId: secret, subjectId: both }, { memoryId: own, subjectId: both }, { memoryId: secret, subjectId: theirs }], "birth");
    for (const body of ["One shut row.", "Two shut rows."]) worked(c, SHUT, body);
    c.store.put({ type: "memory", kind: "fact", body: "A third shut row.", tags: ["bread crust ledger"], origin: { session: WRITER, scope: SHUT } });
    c.store.put({ type: "memory", kind: "fact", body: "A fourth shut row.", tags: ["bread crust ledger", "bread crust"], origin: { session: WRITER, scope: SHUT } });
    c.store.put({ type: "memory", kind: "fact", body: "A garden row.", tags: ["bean row"], origin: { session: WRITER, scope: HERE } });
    c.store.put({ type: "memory", kind: "fact", body: "Another garden row.", tags: ["bean row", "bean"], origin: { session: WRITER, scope: HERE } });
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const read = String((await child(c, "tags").call("dream", { phase: "tags", session: NIGHT })).structuredContent["read"]);
    expect(read).toContain("Quillon");
    expect(read).toContain(OPEN_WORDS);
    expect(read).not.toContain(SECRET_WORDS);
    expect(read).not.toContain("Sparhawk");
    expect(read).not.toContain("bread crust");
    expect(read).toContain("bean row");
    // No setting: the ask is as it was.
    const all = String((await child(c, "tags", { scopes: null }).call("dream", { phase: "tags", session: NIGHT })).structuredContent["read"]);
    expect(all).toContain("Sparhawk");
    expect(all).toContain("TAGS THAT LOOK ALIKE");
    expect(all).toContain("bread crust ledger");
  });

  test("a past day's summary resting on a closed row isn't in the reflection's timeline", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET, D0);
    const told = worked(c, HERE, OPENED, D1);
    clock = at(D1, 12);
    c.recordPageWriterRun({ about: D0, mode: "session", outcome: "nothing-to-say", summary: `A day that ${SECRET_WORDS}.`, summaryCites: [secret], session: NIGHT, run: "old" });
    c.recordPageWriterRun({ about: D1, mode: "session", outcome: "nothing-to-say", summary: `A day ${OPEN_WORDS}.`, summaryCites: [told], session: NIGHT, run: "old" });
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, "dream");
    const dream = String((await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent["dream"]);
    await s.call("dream", { phase: "journal", session: NIGHT, dream, title: "A night", text: "A short dream." });
    clock = at(D2, 4);
    const reflected = await child(c, "reflection").call("reflect", { phase: "begin", session: NIGHT, dream });
    expect(says(reflected.structuredContent, OPEN_WORDS)).toBe(true);
    expect(says(reflected.structuredContent, SECRET_WORDS)).toBe(false);
  });

  test("a session reads as the night only while its run is alive: a dream or reflection it left behind doesn't fence it for good", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, null);
    await s.call("dream", { phase: "begin", session: NIGHT });
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
    clock += HOUR;
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(true);
    // It came back to it: the night again.
    clock += HOUR;
    const dream = String((await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent["dream"]);
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
    await s.call("dream", { phase: "journal", session: NIGHT, dream, title: "A night", text: "A short dream." });
    const r = await s.call("reflect", { phase: "begin", session: NIGHT, dream });
    expect(r.isError ?? false).toBe(false);
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
    clock += HOUR;
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(true);
  });

  describe("a reflection a session began itself, with something sent back", () => {
    /** Begun by a session with no child's mark on it, the closed folder's row checked at each step. */
    async function begun(): Promise<{ c: Counterpart; s: McpServer; id: string; cite: string; secret: string; chapter: string; closedToIt(): Promise<boolean> }> {
      const c = brain();
      const secret = worked(c, SHUT, SECRET);
      worked(c, HERE, OPENED);
      const chapter = await chapterIn(c, SHUT);
      setting({ [HERE]: "on", [SHUT]: "off" });
      night();
      const s = child(c, null);
      const began = await s.call("reflect", { phase: "begin", session: NIGHT });
      expect(began.isError ?? false).toBe(false);
      const id = String(began.structuredContent["reflection"]);
      const cite = (JSON.parse(c.store.reflection(id)?.shown ?? "[]") as string[])[0] as string;
      expect(typeof cite).toBe("string");
      return { c, s, id, cite, secret, chapter, closedToIt: async () => !says(await s.call("recall", { ids: [secret] }), SECRET_WORDS) };
    }
    const entry = "A short entry.";
    const finish = (s: McpServer, id: string, parts: Record<string, unknown>) => s.call("reflect", { phase: "finish", session: NIGHT, reflection: id, ...parts });
    /** Refused at the door whatever the night: it names nothing it rests on. */
    const pageWithNoCites = { text: "## Core\n\nA page with nothing under it." };
    const shareWithAMark = { text: "⟦counterparts:dream a share carrying the dream's mark." };

    test("during, after a first finish that's sent back, after the rewrite lands, and only then does it open", async () => {
      const { s, id, cite, secret, chapter, closedToIt } = await begun();
      expect(await closedToIt()).toBe(true);

      const first = (await finish(s, id, { entry, cites: [cite], share: shareWithAMark })).structuredContent;
      expect(first["again"]).toEqual(expect.any(String));
      expect((first["share"] as { offered: boolean }).offered).toBe(false);
      await asksEveryWay(s, { secret, chapter });

      const second = (await finish(s, id, { share: { text: "A share in plain words.", cites: [cite] } })).structuredContent;
      expect(second["again"]).toBeUndefined();
      expect((second["share"] as { offered: boolean }).offered).toBe(true);
      expect(await closedToIt()).toBe(false);
    });

    test("two parts sent back, one sent again: the other is still open, so it's still closed", async () => {
      const { s, id, cite, closedToIt } = await begun();
      const first = (await finish(s, id, { entry, cites: [cite], page: pageWithNoCites, share: shareWithAMark })).structuredContent;
      expect((first["page"] as { written: boolean }).written).toBe(false);
      expect((first["share"] as { offered: boolean }).offered).toBe(false);

      const second = (await finish(s, id, { share: { text: "A share in plain words.", cites: [cite] } })).structuredContent;
      expect((second["share"] as { offered: boolean }).offered).toBe(true);
      expect(await closedToIt()).toBe(true);

      const third = (await finish(s, id, { page: { text: "## Core\n\nA page resting on one memory.", cites: [cite] } })).structuredContent;
      expect((third["page"] as { written: boolean }).written).toBe(true);
      expect(await closedToIt()).toBe(false);
    });

    for (const [part, refused, blank] of [
      ["page", pageWithNoCites, { text: "   " }],
      ["share", shareWithAMark, { cites: ["any"] }],
    ] as const) {
      test(`a ${part} sent again with no words: nothing landed and nothing is said, so it's still closed`, async () => {
        const { s, id, cite, closedToIt } = await begun();
        await finish(s, id, { entry, cites: [cite], [part]: refused });
        const again = (await finish(s, id, { [part]: blank })).structuredContent;
        expect(again["again"]).toBeUndefined();
        expect(await closedToIt()).toBe(true);
      });
    }

    test("each part sent back goes on the row by name, with none of what was sent or why", async () => {
      const { c, s, id, cite } = await begun();
      const sent = "WORDS-IT-SENT";
      const first = (
        await finish(s, id, {
          entry,
          cites: [cite],
          page: pageWithNoCites,
          share: shareWithAMark,
          close: ["no-such-thread"],
          feelings: [{ id: "no-such-1", feeling: sent }],
          about: [{ id: "no-such-2", about: sent }],
          core: [{ id: "no-such-3", decision: "keep", why: sent }],
          traits: [{ id: "no-such-4", axis: sent, toward: sent, strength: 1, carried_by: sent }],
          beliefs: { filings: [{ id: "no-such-5" }] },
        })
      ).structuredContent;
      expect(String(first["again"])).toContain(sent);
      const detail = JSON.parse(c.store.reflection(id)?.detail ?? "{}") as Record<string, unknown>;
      expect(detail["sentBack"]).toEqual(["page", "share", "close", "feelings", "about", "core", "traits", "beliefs"]);
      expect(JSON.stringify(detail)).not.toContain(sent);
      expect(JSON.stringify(detail)).not.toContain("no-such-thread");
    });

    test("nothing sent back: the session has its recall back at once", async () => {
      const { s, id, cite, closedToIt } = await begun();
      const first = (await finish(s, id, { entry, cites: [cite] })).structuredContent;
      expect(first["again"]).toBeUndefined();
      expect(await closedToIt()).toBe(false);
    });

    test("it never sends the part again: quiet past the half hour, it has moved on, and coming back closes it again", async () => {
      const { s, id, cite, closedToIt } = await begun();
      await finish(s, id, { entry, cites: [cite], share: shareWithAMark });
      expect(await closedToIt()).toBe(true);
      clock += DREAM_TUNABLES.ABANDONED_AFTER_MS - 60_000;
      expect(await closedToIt()).toBe(true);
      clock += 2 * 60_000;
      expect(await closedToIt()).toBe(false);
      // The door still takes a finish today, and another refusal asks for the part again.
      await finish(s, id, { share: shareWithAMark });
      expect(await closedToIt()).toBe(true);
    });

    test("the day over before the half hour's up: the door has shut, so nothing can be rewritten", async () => {
      const { s, id, cite, closedToIt } = await begun();
      clock = at(D2, 23) + 55 * 60_000;
      await finish(s, id, { entry, cites: [cite], share: shareWithAMark });
      expect(await closedToIt()).toBe(true);
      clock = at(D2, 24) + 5 * 60_000;
      expect(await closedToIt()).toBe(false);
    });

    test("a child of the nightly run stays closed past its finish, sent back or not", async () => {
      const c = brain();
      const secret = worked(c, SHUT, SECRET);
      worked(c, HERE, OPENED);
      setting({ [HERE]: "on", [SHUT]: "off" });
      night();
      const s = child(c, "reflection");
      const id = String((await s.call("reflect", { phase: "begin", session: NIGHT })).structuredContent["reflection"]);
      await finish(s, id, { entry });
      expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
    });
  });

  test("the published wake quoting a closed row with no title and, since the wake has no bare ids, no id: the dream goes without it", async () => {
    const c = brain();
    clock = at(D1, 10);
    c.store.put({ type: "memory", kind: "fact", body: `Has the quarter ${SECRET_WORDS}? Nobody has said.`, about: "owner", meta: { unresolved: true }, origin: { session: WRITER, scope: SHUT } });
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    c.rebrief({ budgetBytes: BUDGET, at: D2 });
    expect(c.store.getMeta("self.briefing") ?? "").toContain(SECRET_WORDS);
    const began = await child(c, "dream").call("dream", { phase: "begin", session: NIGHT });
    expect(says(began.structuredContent, OPEN_WORDS)).toBe(true);
    expect(says(began.structuredContent, SECRET_WORDS)).toBe(false);
  });

  test("a handoff left in a closed folder isn't on the dream's or the reflection's mind; an open folder's is", async () => {
    const c = brain();
    clock = at(D1, 10);
    const left = new McpServer({ counterpart: c, session: WRITER, scope: SHUT, registryDir: join(root, "registry"), now: () => clock });
    await left.call("session_end", { session: WRITER, handoff: `Next: the figures ${SECRET_WORDS} want a second look.`, memories: [] });
    const here = new McpServer({ counterpart: c, session: "a7a7a7a7-0000-4000-8000-000000000003", scope: HERE, registryDir: join(root, "registry"), now: () => clock });
    await here.call("session_end", { session: "a7a7a7a7-0000-4000-8000-000000000003", handoff: `Next: the beans ${OPEN_WORDS} want staking.`, memories: [] });
    worked(c, HERE, OPENED);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, "dream");
    const began = await s.call("dream", { phase: "begin", session: NIGHT });
    expect(says(began.structuredContent, "the beans")).toBe(true);
    expect(says(began.structuredContent, SECRET_WORDS)).toBe(false);
    const dream = String(began.structuredContent["dream"]);
    await s.call("dream", { phase: "journal", session: NIGHT, dream, title: "A night", text: "A short dream." });
    clock = at(D2, 4);
    const reflected = await child(c, "reflection").call("reflect", { phase: "begin", session: NIGHT, dream });
    expect(says(reflected.structuredContent, "the beans")).toBe(true);
    expect(says(reflected.structuredContent, SECRET_WORDS)).toBe(false);
  });

  test("a session with a dream begun, no child's mark on it, reads the same", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    worked(c, HERE, OPENED);
    const chapter = await chapterIn(c, SHUT);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, null);
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(true);
    const began = await s.call("dream", { phase: "begin", session: NIGHT });
    expect(says(began.structuredContent, SECRET_WORDS)).toBe(false);
    await asksEveryWay(s, { secret, chapter });
  });
});

describe("a setting file that won't read holds the night", () => {
  const PAGE = "## Core\n\nI keep a garden.\n\n## Lately\n\nThe beans.\n\n## How I work\n\nSteadily.";

  async function brokenDay(c: Counterpart): Promise<void> {
    worked(c, HERE, OPENED);
    worked(c, HERE, "A second row of the garden, staked and tied.");
    worked(c, HERE, "A third row of the garden, watered at dusk.");
    const seed = new McpServer({ counterpart: c, session: WRITER, scope: HERE, registryDir: join(root, "registry"), now: () => clock });
    expect((await seed.call("self_page", { body: PAGE, reason: "the first" })).structuredContent["stored"]).toBe(true);
    night();
  }

  for (const [name, content] of [["junk", "{ not json"], ["empty", ""], ["the wrong shape", "[]"]] as const) {
    test(`${name}: every door that would begin something refuses by name, nothing is claimed, begun or rewritten`, async () => {
      const c = brain();
      await brokenDay(c);
      writeFileSync(scopesFile, content);
      const asks: [string, string, string | null, Record<string, unknown>][] = [
        ["dream", "writer", "writer", {}],
        ["dream", "begin", "dream", {}],
        ["dream", "launch", null, {}],
        ["dream", "tags", "tags", {}],
        ["reflect", "begin", "reflection", {}],
        ["reflect", "launch", null, {}],
      ];
      for (const [tool, phase, kind, args] of asks) {
        const got = await child(c, kind).call(tool, { phase, session: NIGHT, ...args });
        expect(`${tool} ${phase}: ${String(got.structuredContent["reason"])}`).toBe(`${tool} ${phase}: folder-setting-unreadable`);
        expect(got.isError).toBe(true);
        expect(String(got.structuredContent["detail"])).toContain(scopesFile);
      }
      expect(c.nightClaimFor(NIGHT)).toBeNull();
      expect(c.dreams.lastDream()).toBeNull();
      expect(c.store.reflections({ limit: 5 })).toEqual([]);
      expect(c.selfPage()?.body).toBe(PAGE);
    });
  }

  test("an empty object names nothing: the night isn't held over `{}`", async () => {
    const c = brain();
    await brokenDay(c);
    writeFileSync(scopesFile, "{}");
    const got = await child(c, "dream").call("dream", { phase: "begin", session: NIGHT });
    expect(got.structuredContent["reason"]).not.toBe("folder-setting-unreadable");
    expect(got.isError).not.toBe(true);
  });

  test("the nightly run asks nobody, its row says why, and doctor is red until the file is fixed", async () => {
    const c = brain();
    await brokenDay(c);
    c.close();
    open.splice(open.indexOf(c), 1);
    const config = join(root, "claude-code.json");
    const seen: string[] = [];
    const seat: Seat<NightAnswer> = {
      name: "test",
      answer: async (ask) => {
        seen.push(ask.act);
        return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
      },
    };
    const go = (run: string): ReturnType<typeof runNight> =>
      runNight({ open: () => brain(), config: { dataDir: storeDir, injectionBudgetBytes: BUDGET }, configPath: config, run, session: NIGHT, scope: HERE, kind: { kind: "night" }, seat });
    writeFileSync(scopesPath(config), "{ not json");
    expect(nightHeldFindings(config)[0]?.severity).toBe("red");
    const held = await go("nrn_held");
    expect(held.state).toBe("could-not-start");
    expect(held.reason).toBe("folder-setting");
    expect(seen.filter((a) => a !== "catch-up")).toEqual([]);
    const after = brain();
    expect(after.dreams.nightRun()?.reason).toBe("folder-setting");
    expect(after.selfPage()?.body).toBe(PAGE);
    expect(after.dreams.lastDream()).toBeNull();

    // Fixed: nothing red, and the night goes on to ask.
    rmSync(scopesPath(config));
    expect(nightHeldFindings(config)).toEqual([]);
    const ran = await go("nrn_after");
    expect(ran.reason).not.toBe("folder-setting");
    expect(seen.length).toBeGreaterThan(0);
  });

  test("the ask after a held night says to fix the file first: its door refuses \"dream\" until then", async () => {
    const c = brain();
    await brokenDay(c);
    for (let i = 0; i < 8; i++) worked(c, HERE, `Row ${String(i)} of the garden, staked and tied and watered at dusk.`);
    c.store.setMeta("dream.setting", "auto");
    clock = at(D2, 8);
    c.store.advanceClock(D2);
    const first = c.dreams.offer({ at: D2, session: WRITER });
    expect(first?.headless).toBe(true);
    expect(c.dreams.claimOffer(first as NonNullable<typeof first>)).toBe(true);
    c.dreams.recordNightRun({ run: "nrn_held", date: D2, kind: "night", session: NIGHT, startedAt: clock, endedAt: clock, timeoutMs: 1, state: "could-not-start", reason: "folder-setting", detail: null, code: null, dream: null, reflection: null });
    const ask = c.dreams.offer({ at: D2, session: WRITER });
    expect(ask?.fallback).toBe(true);
    expect(ask?.notice).toContain("which file to fix or remove");
    expect(ask?.notice).not.toContain("to do it here");
  });

  test("a single bad entry doesn't hold it: the file read", async () => {
    const c = brain();
    await brokenDay(c);
    writeFileSync(scopesFile, JSON.stringify({ version: 1, scopes: { [HERE]: { mode: "on", at: D1 }, [SHUT]: { mode: "sideways", at: D1 } } }));
    const got = await child(c, "writer").call("dream", { phase: "writer", session: NIGHT });
    expect(got.structuredContent["reason"]).not.toBe("folder-setting-unreadable");
  });
});

describe("what stays as it was", () => {
  test("an ordinary session's recall isn't fenced", async () => {
    const c = brain();
    const secret = worked(c, SHUT, SECRET);
    const chapter = await chapterIn(c, SHUT);
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    const s = child(c, null);
    expect(says(await s.call("recall", { question: ASKED, mode: "facts" }), SECRET_WORDS)).toBe(true);
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(true);
    expect(says(await s.call("recall", { handle: chapter }), CHAPTER_WORDS)).toBe(true);
  });

  test("a folder that's on, a subfolder of one, a folder with no entry, and no setting file at all: the night reads them", async () => {
    for (const [scope, file] of [[SHUT, "on"], [join(SHUT, "sub"), "on"], [SHUT, "unlisted"], [SHUT, "none"]] as const) {
      const c = brain();
      const secret = worked(c, scope, SECRET);
      worked(c, HERE, OPENED);
      if (file === "on") setting({ [HERE]: "on", [SHUT]: "on" });
      if (file === "unlisted") setting({ [HERE]: "on" });
      night();
      const s = child(c, "dream", file === "none" ? { scopes: null } : {});
      expect(says((await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent, SECRET_WORDS)).toBe(true);
      expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(true);
      c.close();
      open.splice(open.indexOf(c), 1);
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(scopesFile, { force: true });
    }
  });

  test("a memory with no folder recorded stays readable: there's no folder to refuse", async () => {
    const c = brain();
    clock = at(D1, 10);
    c.store.advanceClock(D1);
    const day = c.store.livedDay();
    const foldless = c.store.put({ type: "memory", kind: "fact", body: SECRET, about: "work", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, origin: { session: WRITER } });
    setting({ [HERE]: "on", [SHUT]: "off" });
    night();
    expect(says(await child(c, "dream").call("recall", { ids: [foldless] }), SECRET_WORDS)).toBe(true);
  });

  test("a setting file that won't read closes every folder to a reader already at work", async () => {
    const c = brain();
    const secret = worked(c, HERE, SECRET);
    writeFileSync(scopesFile, "{ not json");
    night();
    const s = child(c, "dream");
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
    expect(says(await s.call("recall", { question: ASKED, mode: "facts" }), SECRET_WORDS)).toBe(false);
  });
});
