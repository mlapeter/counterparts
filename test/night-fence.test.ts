/**
 * THE NIGHT DOESN'T READ A FOLDER THAT DOESN'T EXPORT (2026-10-30, `core/dream/fence.ts`).
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

import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";

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

  test("a setting file that won't read closes every folder to the night", async () => {
    const c = brain();
    const secret = worked(c, HERE, SECRET);
    writeFileSync(scopesFile, "{ not json");
    night();
    const s = child(c, "dream");
    expect(says(await s.call("recall", { ids: [secret] }), SECRET_WORDS)).toBe(false);
    expect(says(await s.call("recall", { question: ASKED, mode: "facts" }), SECRET_WORDS)).toBe(false);
  });
});
