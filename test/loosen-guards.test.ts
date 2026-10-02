/**
 * Loosening the dream and reflection guards (owner direction 2026-09-28: err
 * on the side of removing guards; accept and repair beats refuse; a refusal
 * names what tripped it and can be sent again).
 *
 * The morning's three failures, each turned round: a page refused for words a
 * gist also quoted (the check is gone — reflect-review S1), a second `finish`
 * refused `reflection-closed`, and a dream's feeling refused `FEELING_INVALID`
 * with no reason because `emotion` held a phrase. And the doubled "steadied".
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { TOOLS } from "../src/adapters/mcp/tools.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { CARRIED_BY_MAX_CHARS, OTHER_WORD_MAX_CHARS, checkFeelings, repairEmotion } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: { close: () => void }[] = [];
const SESSION = "s-loosen";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-loosen-"));
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
  // The calendar follows the test's days (the once-a-day gates are the calendar date since 2026-09-28).
  const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" }, now: () => Date.now() + dateN * 86_400_000 });
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
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10));
  return c.store.livedDay();
}

/** A store with a few lived days and three new memories: `guard` is felt, the others plain. */
function lived(c: Counterpart): { guard: string; a: string; b: string } {
  dateN = 0;
  for (let i = 0; i < 4; i += 1) nextDay(c);
  const guard = mem(c, "The guard held when I was tested on the release night.", { kind: "self", about: "me", salience: { relevance: 0.7, emotional: 0.6, predictive: 0.5 } });
  const a = mem(c, "The migration step must run before the container boots.");
  const b = mem(c, "Run the migration before starting the container.");
  return { guard, a, b };
}

function dreamOpen(c: Counterpart): string {
  const begun = c.dreams.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`dream refused: ${begun.reason}`);
  return begun.bundle.dream;
}

// ---------------------------------------------------------------------------
// feelings: accept and repair
// ---------------------------------------------------------------------------

describe("feelings: an emotion that carries a phrase is split, never refused for length", () => {
  test("the head is the emotion and the rest goes to carried_by (set when empty, else appended)", () => {
    expect(repairEmotion("steadied: the guard has held every time since", "")).toEqual({
      emotion: "steadied",
      carriedBy: "the guard has held every time since",
      tail: "the guard has held every time since",
    });
    expect(repairEmotion("steadied — it held", "on the release night")?.carriedBy).toBe("on the release night; it held");
    expect(repairEmotion("wistful; missing the old build", "")?.emotion).toBe("wistful");
    // A plain word, and a short phrase of the writer's own, are left alone.
    expect(repairEmotion("hopeful", "")).toBe(null);
    expect(repairEmotion("quietly proud", "")).toBe(null);
    // Over-long with no strong break: a comma cuts it, else the first word.
    const long = `relieved, because ${"the long night finally ended and ".repeat(4)}`;
    expect(repairEmotion(long, "")?.emotion).toBe("relieved");
    // No break at all: cut at the last word boundary within the cap, never
    // down to its first word; the rest goes to carried_by (review of #268).
    const words = "a deep and abiding sense of gratitude for everything he did through the long release night";
    const fit = repairEmotion(words, "");
    expect(fit?.emotion).toBe("a deep and abiding sense of gratitude for everything he did through the long");
    expect(fit?.carriedBy).toBe("release night");
    expect(repairEmotion("a deep and abiding sense of gratitude", "")).toBe(null);
    // One giant token keeps its head, and the rest is not dropped.
    const giant = repairEmotion("x".repeat(200), "");
    expect(giant?.emotion.length).toBe(OTHER_WORD_MAX_CHARS);
    expect(giant?.carriedBy.length).toBe(200 - OTHER_WORD_MAX_CHARS);
    // Punctuation alone is kept to the cap too.
    expect(repairEmotion(":".repeat(200), "")?.emotion.length).toBe(OTHER_WORD_MAX_CHARS);
    expect(checkFeelings([{ whose: "self", core: "happy", emotion: "—;:".repeat(60), strength: 0.5 }]).rows[0]?.otherWord?.length).toBeLessThanOrEqual(OTHER_WORD_MAX_CHARS);
  });

  test("checkFeelings repairs instead of refusing: emotion, other_word and an over-long carried_by", () => {
    const out = checkFeelings([
      { whose: "self", core: "happy", emotion: "steadied: the guard has held every time since the first test", strength: 0.6 },
      { whose: "self", core: "happy", emotion: "other", otherWord: "settled — like a keel in water", strength: 0.4, carriedBy: "after the release" },
      { whose: "owner", core: "happy", emotion: "hopeful", strength: 0.5, carriedBy: "y".repeat(CARRIED_BY_MAX_CHARS + 50) },
    ]);
    expect(out.rows[0]).toMatchObject({ emotion: "steadied", otherWord: null, carriedBy: "the guard has held every time since the first test" });
    expect(out.rows[1]).toMatchObject({ emotion: "other", otherWord: "settled", carriedBy: "after the release; like a keel in water" });
    expect(out.rows[2]?.carriedBy.length).toBe(CARRIED_BY_MAX_CHARS);
    expect(out.repairs.map((r) => [r.index, r.field])).toEqual([
      [0, "emotion"],
      [1, "other_word"],
      [2, "carried_by"],
    ]);
    expect(out.repairs[0]?.note).toContain("emotion is one word, carried_by holds the nuance");
    expect(OTHER_WORD_MAX_CHARS).toBeGreaterThanOrEqual(80);
    expect(CARRIED_BY_MAX_CHARS).toBeGreaterThanOrEqual(1_000);
  });

  test("the note door stores a phrased emotion, split, and says so", async () => {
    const s = openServer({ dir, scope: "/tmp/loosen-project", owner: true, bundlesAsOwner: true });
    open.push({ close: () => s.counterpart.close() });
    const r = await s.call("note", {
      text: "The release went out clean after the long night.",
      feelings: [{ whose: "self", core: "happy", emotion: "relieved: the long night is over and it held", strength: 0.6 }],
    });
    const out = (r.structuredContent ?? {}) as Record<string, unknown>;
    expect(out["stored"]).toBe(true);
    const feelings = out["feelings"] as { stored: number; repaired?: { field: string; now: string }[] };
    expect(feelings.stored).toBe(1);
    expect(feelings.repaired?.[0]).toMatchObject({ field: "emotion", now: "relieved" });
    const [row] = s.counterpart.store.feelingsFor(out["id"] as string);
    expect(row).toMatchObject({ emotion: "relieved", carried_by: "the long night is over and it held" });
  });
});

// ---------------------------------------------------------------------------
// the dream's feeling-now
// ---------------------------------------------------------------------------

describe("dream feeling-now: repaired, reasons surfaced, never doubled", () => {
  test("this morning's phrase is recorded as steadied + carried_by, with a note", () => {
    const c = brain();
    const m = lived(c);
    const id = dreamOpen(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [{ action: "feeling-now", id: m.guard, core: "happy", emotion: "steadied: the guard has held every time since the first test", strength: 0.5 }],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.results[0]).toMatchObject({ ok: true, reason: "recorded" });
    expect(out.results[0]?.note).toContain('"steadied" was kept as the emotion');
    const dreamt = c.store.feelingsFor(m.guard).filter((f) => f.source === "dream");
    expect(dreamt).toHaveLength(1);
    expect(dreamt[0]).toMatchObject({ emotion: "steadied", other_word: null });
    expect(dreamt[0]?.carried_by).toContain("the guard has held every time since the first test");
  });

  test("a feeling-now with no strength gets a session's default (the word's, capped below the fast lane), not 0 (review of #301, m2)", () => {
    const c = brain();
    const m = lived(c);
    const id = dreamOpen(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "feeling-now", id: m.guard, core: "calm", emotion: "relieved" },
        { action: "feeling-now", id: m.a, core: "uneasy", emotion: "terrified" },
      ],
    });
    if (!out.ok) throw new Error(out.reason);
    const dreamt = (id2: string) => c.store.feelingsFor(id2).filter((f) => f.source === "dream")[0];
    expect(dreamt(m.guard)?.strength).toBe(0.35);
    // Terrified's 0.9 is capped at 0.55, then at the memory's own peak, as any feeling-now is.
    expect(dreamt(m.a)?.strength).toBeLessThanOrEqual(0.55);
  });

  test("a feeling that still will not store names its reason; it writes nothing, and a resend of one that landed is not doubled", () => {
    const c = brain();
    const m = lived(c);
    const id = dreamOpen(c);
    const first = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "feeling-now", id: m.guard, core: "happy", emotion: "steadied", strength: 0.5, carried_by: "it held" },
        { action: "feeling-now", id: m.a, core: "boredom", emotion: "flat", strength: 0.2 },
      ],
    });
    if (!first.ok) throw new Error(first.reason);
    expect(first.results[1]?.ok).toBe(false);
    expect(first.results[1]?.reason).toStartWith("feeling-invalid:core-unknown");
    expect(first.results[1]?.reason).toContain("one of happy");
    expect(c.store.feelingsFor(m.a)).toEqual([]);
    // The dreamer resends the whole batch with the refused one fixed.
    const again = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "feeling-now", id: m.guard, core: "happy", emotion: "steadied", strength: 0.5, carried_by: "it held" },
        { action: "feeling-now", id: m.a, core: "sad", emotion: "bored", strength: 0.2 },
      ],
    });
    if (!again.ok) throw new Error(again.reason);
    expect(again.results[0]).toMatchObject({ ok: true, reason: "already-recorded" });
    expect(again.results[1]?.ok).toBe(true);
    expect(c.store.feelingsFor(m.guard).filter((f) => f.source === "dream")).toHaveLength(1);
    expect(c.dreams.show(id)?.changes.filter((ch) => ch.action === "feeling-now")).toHaveLength(2);
  });

  test("THE DOUBLED 'steadied': a feeling from the time and the dream's, capped at that same peak, were two records that read as one twice — the bundle now says who recorded each", () => {
    const c = brain();
    const m = lived(c);
    // Felt at the time, in the session.
    c.store.addFeelings(m.guard, [{ whose: "self", core: "happy", emotion: "steadied", strength: 0.7, carriedBy: "on the release night" }]);
    const id = dreamOpen(c);
    // The dream feels it again, stronger — and is capped at the peak: 0.7.
    const p = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "feeling-now", id: m.guard, core: "happy", emotion: "steadied", strength: 0.9, carried_by: "it still holds" }] });
    if (!p.ok) throw new Error(p.reason);
    expect(p.results[0]?.reason).toBe("recorded-capped-at-peak");
    expect(c.dreams.show(id)?.changes.filter((ch) => ch.action === "feeling-now")).toHaveLength(1);
    const j = c.dreams.journal({ dream: id, session: SESSION, text: "I dreamed the guard held." });
    if (!j.ok) throw new Error(j.reason);
    const begun = c.reflections.begin({ session: SESSION, dream: id });
    if (!begun.ok) throw new Error(begun.reason);
    const shown = begun.bundle.memories[m.guard]?.feelings ?? [];
    // Two rows, one write each — not a double write, not a join.
    expect(c.store.feelingsFor(m.guard)).toHaveLength(2);
    expect(shown).toHaveLength(2);
    // Same word, same strength, both felt-at-the-time as far as `later` goes:
    // before 2026-09-28 that was all the bundle said, and they read as one twice.
    expect(shown.map((f) => [f.emotion, f.strength, f.later])).toEqual([
      ["steadied", 0.7, null],
      ["steadied", 0.7, null],
    ]);
    // Now each says who recorded it, and what carried it.
    expect(shown.map((f) => f.by).sort()).toEqual(["dream", "session"]);
    expect(shown.find((f) => f.by === "dream")?.carried_by).toContain("it still holds");
  });
});

// ---------------------------------------------------------------------------
// the dream's other refusals, classified
// ---------------------------------------------------------------------------

describe("dream: refusals that protected nothing on the keep list became notes", () => {
  test("kinds that differ merge under the strongest's kind; more than three merge; already-core is fine; a skill may be nominated", () => {
    const c = brain();
    const m = lived(c);
    const day = c.store.livedDay();
    const at = { physics: { birthDay: day, lastUsedDay: day } };
    const c1 = mem(c, "Migrations first, then the container.", at);
    const person = mem(c, "Mike runs the migration before the container, always.", { ...at, kind: "person" });
    const skill = mem(c, "I read a stack trace from the bottom up.", { ...at, kind: "skill" });
    const core = mem(c, "Mike trusted me with the release.", { ...at, kind: "person", about: "us", physics: { birthDay: day, lastUsedDay: day, promotedIdentity: true } });
    const id = dreamOpen(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "merge", ids: [m.a, m.b, c1, person], text: "Run the migration before the container boots, or it boots empty." },
        { action: "nominate-core", id: core, why: "it is who I am" },
        { action: "nominate-core", id: skill, why: "how I work" },
        { action: "link", a: m.guard, b: "mem_never_shown" },
      ],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.results[0]).toMatchObject({ ok: true, reason: "merged" });
    expect(out.results[0]?.note).toContain("kinds differ");
    expect(out.results[1]).toMatchObject({ ok: true, reason: "already-core" });
    expect(out.results[2]).toMatchObject({ ok: true, reason: "nominated" });
    expect(out.results[2]?.note).toContain("skill");
    // A refusal kept names what tripped it.
    expect(out.results[3]).toMatchObject({ ok: false, reason: "not-shown-or-gone" });
    expect(out.results[3]?.detail).toContain("mem_never_shown was not in the bundle");
  });

  test("the launch prompt lists the fields and says 'usually far fewer; none is fine'", () => {
    const c = brain();
    const prompt = c.dreams.launchPrompt({ session: SESSION });
    expect(prompt).toContain("Usually far fewer than the ceilings");
    expect(prompt).toContain("none is fine");
    expect(prompt).toContain("feeling-now {id, core: happy|warm|calm|curious|sad|uneasy|angry, emotion, strength, carried_by}");
    expect(prompt).toContain("`emotion` is ONE word");
    expect(prompt).not.toContain("at most");
  });

  test("every schema a model writes a feeling through says emotion is one word and carried_by the nuance", () => {
    const text = JSON.stringify(TOOLS.filter((t) => ["note", "session_end", "dream", "reflect"].includes(t.name)).map((t) => t.inputSchema));
    const oneWord = text.match(/ONE word/g) ?? [];
    expect(oneWord.length).toBeGreaterThanOrEqual(5);
    expect(text).toContain("The nuance, in your own words");
  });

  test("text caps were raised, and a text over one is kept to it with a note — never cut without a word", () => {
    expect(DREAM_TUNABLES.MAX_TEXT_CHARS).toBeGreaterThanOrEqual(8_000);
    expect(DREAM_TUNABLES.MAX_JOURNAL_CHARS).toBeGreaterThanOrEqual(30_000);
    const c = brain();
    const m = lived(c);
    const id = dreamOpen(c);
    const long = "The migration step runs first. ".repeat(200); // ~6,200 chars: whole
    const out = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "gist", text: long, sources: [m.a, m.b] }] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.results[0]?.note).toBeUndefined();
    expect(c.store.row(out.results[0]?.id as string)?.body).toBe(long.trim());
    const j = c.dreams.journal({ dream: id, session: SESSION, text: "d".repeat(DREAM_TUNABLES.MAX_JOURNAL_CHARS + 10) });
    if (!j.ok) throw new Error(j.reason);
    expect(j.note).toContain("kept to its first");
  });
});

// ---------------------------------------------------------------------------
// reflect: finish may be called again
// ---------------------------------------------------------------------------

describe("reflect: a second finish supplies what the first did not write", () => {
  function setup(c: Counterpart): { secret: string; open: string; reflection: string } {
    dateN = 0;
    for (let i = 0; i < 3; i += 1) nextDay(c);
    const secret = mem(c, "Mike told me about the health scare he has not told anyone else about yet.", { kind: "person", about: "owner", meta: { confidential: true } });
    const openId = mem(c, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    return { secret, open: openId, reflection: begun.bundle.reflection };
  }

  test("a refused page names the matching words and says it can be sent again; the second finish writes it without re-minting the entry, and replaces the untold share", () => {
    const c = brain();
    const s = setup(c);
    const first = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      entry: "The release, and being trusted.",
      cites: [s.open],
      page: { text: "## Core\n\nMike told me about the health scare he has not told anyone else about yet.", cites: [s.open] },
      share: { text: "I rewrote my page about being trusted.", cites: [s.open] },
    });
    if (!first.ok) throw new Error(String(first.reason));
    const o = first.outcome;
    expect(o.page).toMatchObject({ written: false, reason: "confidential-words-on-the-page" });
    expect(o.page.detail).toContain(s.secret);
    expect(o.page.detail).toContain("mike told me about the health");
    expect(o.retry).toContain("page — confidential-words-on-the-page");
    expect(o.retry).toContain(`finish again with reflection ${s.reflection}`);
    const entryId = o.entryId as string;
    expect(entryId).not.toBe(null);

    const second = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      page: { text: "## Core\n\nI am trusted with what matters, and I keep it.", cites: [s.open] },
      share: { text: "I've been thinking about being trusted with the release.", cites: [s.open] },
    });
    if (!second.ok) throw new Error(String(second.reason));
    const t = second.outcome;
    expect(t.again).toBe(true);
    expect(t.page).toMatchObject({ written: true, reason: "rewritten" });
    expect(t.share).toMatchObject({ offered: true, reason: "replaced" });
    expect(t.retry).toBe(null);
    expect(t.entryId).toBe(entryId);
    expect(t.handBack).toContain("I rewrote my self page.");
    expect(t.handBack).toContain("being trusted with the release");
    // One entry memory, one reflection row, the new share on it.
    expect(c.store.list({ type: "memory" }).filter((mid) => c.store.row(mid)?.source === "reflection")).toEqual([entryId]);
    expect(c.store.reflection(s.reflection)).toMatchObject({ state: "reflected", entry_id: entryId, share: "I've been thinking about being trusted with the release.", share_state: "offered" });
    expect(c.self.page()?.body).toContain("I keep it");
  });

  test("a told share is not replaced, and says so; limits count across both finishes; an older reflection stays closed", () => {
    const c = brain();
    const s = setup(c);
    const words = ["grateful", "proud", "hopeful", "relieved", "peaceful", "content"];
    const f = (n: number) => ({ id: s.open, core: "happy", emotion: words[n - 1] ?? "happy", strength: 0.5 + n / 100 });
    const first = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      entry: "Grateful.",
      cites: [s.open],
      share: { text: "Thank you for the release.", cites: [s.open] },
      feelings: [f(1), f(2), f(3)],
    });
    if (!first.ok) throw new Error(String(first.reason));
    expect(c.reflections.told({ reflection: s.reflection, session: SESSION }).ok).toBe(true);
    const second = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      share: { text: "Something else entirely.", cites: [s.open] },
      feelings: [f(4), f(5), f(6)],
    });
    if (!second.ok) throw new Error(String(second.reason));
    expect(second.outcome.share).toMatchObject({ offered: false, reason: "share-already-told" });
    expect(c.store.reflection(s.reflection)).toMatchObject({ share: "Thank you for the release.", share_state: "told" });
    expect(second.outcome.feelings.map((x) => x.ok)).toEqual([true, true, false]);
    expect(second.outcome.feelings[2]).toMatchObject({ reason: "limit-reached" });
    expect(second.outcome.feelings[2]?.detail).toContain("counting the earlier finish");
    expect(REFLECT_TUNABLES.LIMITS.feelings).toBe(5);
    // The next lived day, yesterday's reflection is closed.
    nextDay(c);
    expect(c.reflections.finish({ reflection: s.reflection, session: SESSION, entry: "late" })).toMatchObject({ ok: false, reason: "reflection-closed" });
  });

  test("a page written on the first finish may be rewritten on the second (the night's run record is keyed once; the page write still lands)", () => {
    const c = brain();
    const s = setup(c);
    const first = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      entry: "The release.",
      cites: [s.open],
      page: { text: "## Core\n\nI finished the release with Mike.", cites: [s.open] },
    });
    if (!first.ok) throw new Error(String(first.reason));
    expect(first.outcome.page).toMatchObject({ written: true, reason: "rewritten" });
    const v1 = first.outcome.page.version as number;
    const second = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      page: { text: "## Core\n\nI finished the release with Mike, and he thanked me.", cites: [s.open] },
    });
    if (!second.ok) throw new Error(String(second.reason));
    expect(second.outcome.page).toMatchObject({ written: true, reason: "rewritten" });
    expect(second.outcome.page.version).toBeGreaterThan(v1);
    expect(c.self.page()?.body).toContain("he thanked me");
    expect(c.store.reflection(s.reflection)?.page_version).toBe(second.outcome.page.version);
    // A third finish with no page leaves the page as it stands, and says so.
    const third = c.reflections.finish({ reflection: s.reflection, session: SESSION });
    if (!third.ok) throw new Error(String(third.reason));
    expect(third.outcome.page).toMatchObject({ written: true, reason: "written-earlier", version: second.outcome.page.version });
    expect(third.outcome.handBack).toContain("I rewrote my self page.");
  });

  test("a reflection's phrased feeling is split; one that will not store says why", () => {
    const c = brain();
    const s = setup(c);
    const done = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      entry: "Looking back.",
      cites: [s.open],
      feelings: [
        { id: s.open, core: "happy", emotion: "grateful: he said thank you and meant it", strength: 0.6 },
        { id: s.open, core: "happy", emotion: "furious", strength: 0.6 },
        // No strength: the word's default, as at the session doors — not 0 (review of #301, m2).
        { id: s.open, core: "calm", emotion: "relieved" },
      ],
    });
    expect(c.store.feelingsFor(s.open).find((x) => x.emotion === "relieved")?.strength).toBe(0.35);
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.feelings[0]).toMatchObject({ ok: true, reason: "recorded-later" });
    expect(done.outcome.feelings[0]?.note).toContain('"grateful" was kept as the emotion');
    const row = c.store.feelingsFor(s.open).find((x) => x.source === "reflection");
    expect(row).toMatchObject({ emotion: "grateful" });
    expect(row?.carried_by).toContain("he said thank you and meant it");
    // A wheel word under another core is stored under the writer's core, with
    // no note of a move (owner, 2026-09-30; it was moved 2026-09-28).
    expect(done.outcome.feelings[1]).toMatchObject({ ok: true, reason: "recorded-later" });
    expect(done.outcome.feelings[1]?.note).toBeUndefined();
    expect(c.store.feelingsFor(s.open).some((x) => x.core === "happy" && x.emotion === "furious")).toBe(true);
    // One that still will not store says why.
    const bad = c.reflections.finish({ reflection: s.reflection, session: SESSION, feelings: [{ id: s.open, core: "boredom", emotion: "flat", strength: 0.2 }] });
    if (!bad.ok) throw new Error(String(bad.reason));
    expect(bad.outcome.feelings[0]?.reason).toStartWith("feeling-invalid:core-unknown");
    expect(bad.outcome.retry).toContain("feelings[0]");
  });

  test("text caps: a long share and entry are kept whole", () => {
    expect(REFLECT_TUNABLES.MAX_SHARE_CHARS).toBeGreaterThanOrEqual(3_000);
    expect(REFLECT_TUNABLES.MAX_ENTRY_CHARS).toBeGreaterThanOrEqual(20_000);
    const c = brain();
    const s = setup(c);
    const entry = "I keep coming back to the release. ".repeat(400).trim(); // ~14,000
    const share = "I've been thinking about the release and what it meant. ".repeat(40).trim(); // ~2,300
    const done = c.reflections.finish({ reflection: s.reflection, session: SESSION, entry, cites: [s.open], share: { text: share, cites: [s.open] } });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.entry.note).toBeUndefined();
    expect(c.store.row(done.outcome.entryId as string)?.body).toBe(entry);
    expect(c.store.reflection(s.reflection)?.share).toBe(share);
  });

  test("through the MCP door: a second finish may leave out the entry, and the result says what was not written", async () => {
    recordSession(dir, { sessionId: "s-mcp", scope: "/proj", phase: "start" });
    const srv = openServer({ dir, session: "s-mcp", scope: "/proj", owner: true, bundlesAsOwner: true });
    open.push({ close: () => srv.counterpart.close() });
    const c = srv.counterpart;
    dateN = 0;
    for (let i = 0; i < 3; i += 1) nextDay(c);
    const m = mem(c, "Mike and I finished the release together.", { kind: "person", about: "us" });
    const begin = (await srv.call("reflect", { phase: "begin", session: "s-mcp" })).structuredContent as Record<string, unknown>;
    const reflection = begin["reflection"] as string;
    const first = (await srv.call("reflect", {
      phase: "finish",
      session: "s-mcp",
      reflection,
      entry: "The release.",
      cites: [m],
      page: { text: "## Core\n\nI finished the release with Mike.", cites: ["mem_not_shown"] },
    })).structuredContent as Record<string, unknown>;
    expect((first["page"] as { reason: string }).reason).toBe("page-needs-cites");
    expect(String(first["again"])).toContain("mem_not_shown:not-shown");
    expect(String(first["say"])).toContain("call finish again");
    const second = (await srv.call("reflect", {
      phase: "finish",
      session: "s-mcp",
      reflection,
      page: { text: "## Core\n\nI finished the release with Mike.", cites: [m] },
    })).structuredContent as Record<string, unknown>;
    expect(second["page"]).toMatchObject({ written: true, reason: "rewritten" });
    expect(second["again"]).toBeUndefined();
    expect(String(second["handBack"])).toContain("I rewrote my self page.");
  });
});
