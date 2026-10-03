/**
 * MEANING MODE (Release B, 2026-10-03) — `mcp/meaning.ts#meaningRecall` and
 * `renderMeaning`, called directly against a seeded store (the tool's
 * dispatch is B-facts' half). Covered:
 *
 *   - a card's arc: chapters that hold it, in time order, with their moments,
 *     feelings side by side by whose, a session with no chapter, faded lines,
 *     earlier readings (a gist linked to it, a reflection citing it), what is
 *     still open (a thread, a dated reminder), recurring subjects and feelings,
 *     and the other subjects named as one-liners;
 *   - "us", a feeling question (word, core, whose), a feeling with a card,
 *     the no-card words channel, and a question nothing answers;
 *   - paging a long arc (start, end and turns first; folds; stable pages; a
 *     page past the end), thin evidence said, confidentiality silent for a
 *     non-owner, the 12,000-character ceiling on a big arc, `shown` equal to
 *     what is printed, and a search that writes nothing;
 *   - the chapter-address helpers (`chapterTimesOf`, `chapterAt`) and the
 *     store's `about` filter.
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MEANING_CHAPTERS_SHOWN,
  MEANING_RESULT_CHARS,
  meaningRecall,
  renderMeaning,
} from "../src/adapters/mcp/meaning.js";
import type { MeaningContext, MeaningEntry, MeaningResult } from "../src/adapters/mcp/meaning.js";
import { Counterpart } from "../src/core/counterpart.js";
import { wireChars } from "../src/core/fit/index.js";
import { CHAPTER_MOMENT_GRACE_MS, chapterAt, chapterTimesOf, resolveChapter } from "../src/core/self/index.js";

let root: string;
let dir: string;
const open: { close(): void }[] = [];
const DAY = 86_400_000;
let clock = Date.parse("2026-09-21T10:00:00Z");
let turns = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-meaning-"));
  dir = join(root, "store");
  clock = Date.parse("2026-09-21T10:00:00Z");
  turns = 0;
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
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), owner: true, now: () => clock, timeZone: "UTC", identity: { name: "Mike" } });
  open.push(c);
  return c;
}

function card(c: Counterpart, name: string, aliases: string[] = []): string {
  const out = c.schemas.mention({ name, kind: "person", source: `${name} ${aliases.join(" ")}`, chunkRef: `card-${name}`, aliases, day: c.store.livedDay() });
  if (!out.ok || out.id === null) throw new Error(`no card for ${name}: ${out.reason}`);
  return out.id;
}

interface MomentOpts {
  title?: string;
  about?: "me" | "us" | "owner" | "work" | "world";
  meta?: Record<string, unknown>;
  eventDate?: string;
  source?: "authored" | "dreamed" | "reflection";
  faded?: boolean;
  feel?: { whose: "self" | "owner"; emotion: string; strength: number }[];
}

/** A memory written by `session` now, a minute on the clock after the last. */
function moment(c: Counterpart, session: string, body: string, o: MomentOpts = {}): string {
  clock += 60_000;
  const id = c.store.put({
    type: "memory",
    kind: "fact",
    body,
    ...(o.title === undefined ? {} : { title: o.title }),
    origin: { session, scope: "/proj/one" },
    ...(o.about === undefined ? {} : { about: o.about }),
    ...(o.meta === undefined ? {} : { meta: o.meta }),
    ...(o.eventDate === undefined ? {} : { eventDate: o.eventDate }),
    ...(o.source === undefined ? {} : { source: o.source }),
    ...(o.faded === true ? { salience: { novelty: null, relevance: 0.1, emotional: 0, predictive: 0.1 }, physics: { birthDay: -900, lastUsedDay: -900 } } : {}),
  });
  if (o.feel !== undefined) c.store.addFeelings(id, o.feel.map((f) => ({ whose: f.whose, emotion: f.emotion, strength: f.strength })));
  return id;
}

/** A chapter of `session`'s episode, written now. */
function chapter(c: Counterpart, session: string, text: string, title?: string): { episodeId: string; chapter: number } {
  clock += 60_000;
  turns += 20;
  c.episodeAsk(session, { turns, bytes: turns * 1_000 });
  const out = c.appendEpisode(session, text, title === undefined ? {} : { title });
  if (out.episodeId === null) throw new Error(`no chapter: ${String(out.reason)}`);
  return { episodeId: out.episodeId, chapter: out.chapter };
}

/** Past the grace, so the next memory is the next chapter's. */
function later(minutes = 30): void {
  clock += CHAPTER_MOMENT_GRACE_MS + minutes * 60_000;
}

function ctx(c: Counterpart, over: Partial<MeaningContext> = {}): MeaningContext {
  return { counterpart: c, sessionId: "sess_asker", owner: true, ...over };
}

function entries(r: MeaningResult): MeaningEntry[] {
  return r.arc.filter((l): l is { fold: false; entry: MeaningEntry } => !l.fold).map((l) => l.entry);
}

/** The rich fixture: Han over four days, with Oskar, Mike's and my feelings, readings and open items. */
function seed(c: Counterpart) {
  const han = card(c, "Han", ["Han Seo"]);
  const oskar = card(c, "Oskar");
  // An old, faded mention, from a session that wrote no chapter.
  clock = Date.parse("2026-08-01T09:00:00Z");
  const faded = moment(c, "sess_old", "Han mentioned a sailing trip once, long ago.", { faded: true });

  clock = Date.parse("2026-09-21T10:00:00Z");
  const m1 = moment(c, "sess_a", "Han joined the harbour project as the new designer.", { feel: [{ whose: "self", emotion: "curious", strength: 0.6 }] });
  const m2 = moment(c, "sess_a", "Han and Oskar argued about the release checklist.", {
    feel: [
      { whose: "self", emotion: "uneasy", strength: 0.7 },
      { whose: "owner", emotion: "frustrated", strength: 0.5 },
    ],
  });
  const a1 = chapter(c, "sess_a", "Met Han today. Han is quiet but sharp. Oskar pushed back on the checklist and it got tense.", "First week with Han");

  clock = Date.parse("2026-09-24T10:00:00Z");
  const m3 = moment(c, "sess_b", "Han rewrote the onboarding flow and it reads beautifully now.", {
    feel: [
      { whose: "self", emotion: "happy", strength: 0.8 },
      { whose: "owner", emotion: "proud", strength: 0.6 },
    ],
  });
  const m4 = moment(c, "sess_b", "Han asked whether we can keep Fridays free of meetings.", { meta: { unresolved: true } });
  const words = moment(c, "sess_b", "The harbour budget review moved to Thursday.");
  const b1 = chapter(c, "sess_b", "The onboarding rewrite landed. Han's care shows in every screen.");
  later();
  const m5 = moment(c, "sess_b", "Oskar reviewed the flow Han built and approved it.", { feel: [{ whose: "owner", emotion: "proud", strength: 0.7 }] });
  const b2 = chapter(c, "sess_b", "Oskar approved Han's work, which settled the argument from Monday.");

  clock = Date.parse("2026-09-28T10:00:00Z");
  const m6 = moment(c, "sess_c", "Han was frustrated by the deadline slip and went quiet.", {
    feel: [
      { whose: "self", emotion: "sad", strength: 0.5 },
      { whose: "self", emotion: "uneasy", strength: 0.6 },
    ],
  });
  const secret = moment(c, "sess_c", "The salary Han earns is something only Mike should see.", { meta: { confidential: true } });
  const c1 = chapter(c, "sess_c", "A hard day. Oskar and Han both felt the slip, and I was uneasy watching it.");

  clock = Date.parse("2026-10-01T10:00:00Z");
  const m7 = moment(c, "sess_d", "The birthday of Han is on 10-12; remember to say happy birthday.", { eventDate: "2026-10-12" });
  const gist = moment(c, "sess_dream", "Han carries tension whenever a deadline slips.", { title: "Dreamed: Han and deadlines", source: "dreamed", meta: { dream: "drm_1", dreamed: true, sources: [m2, m6] } });
  const reflection = moment(c, "sess_reflect", "The craft in that rewrite is the thing I keep coming back to.", { title: "Reflected: the rewrite", source: "reflection", meta: { reflection: "rfl_1", cites: [m3] } });
  const us1 = moment(c, "sess_d", "Mike and I agreed to keep the memory work honest, even when it is slow.", { about: "us", feel: [{ whose: "self", emotion: "warm", strength: 0.7 }] });
  const us2 = moment(c, "sess_d", "We laughed about the dashboard naming for ten minutes.", { about: "us" });
  return { han, oskar, faded, m1, m2, m3, m4, m5, m6, m7, words, secret, gist, reflection, us1, us2, a1, b1, b2, c1 };
}

// ═══════════════════════════════════════════════════════════════════════════

describe("a card's arc", () => {
  test("the chapters that hold it, in time order, with moments, feelings by whose, readings, open items, faded and recurring", () => {
    const c = brain();
    const s = seed(c);
    clock = Date.parse("2026-10-03T09:00:00Z");
    const r = meaningRecall(ctx(c), "What has Han been to me, and how does Oskar fit in?");
    const text = renderMeaning(r);
    if (process.env["MEANING_SAMPLE"] === "1") console.log(text);

    expect(r.mode).toBe("meaning");
    expect(r.reason).toBe("answered");
    expect(r.lens).toEqual({ kind: "card", id: s.han, name: "Han" });
    // Oskar is named too, and holds fewer: a one-liner to ask for.
    expect(r.others.map((o) => o.name)).toEqual(["Oskar"]);

    const shown = entries(r);
    // Time order: sess_a#1, sess_b#1, sess_b#2, sess_c#1, then sess_d's moments (no chapter).
    expect(shown.map((e) => e.address)).toEqual([`${s.a1.episodeId}#1`, `${s.b1.episodeId}#1`, `${s.b1.episodeId}#2`, `${s.c1.episodeId}#1`, "session sess_d"]);
    expect(shown.map((e) => e.date)).toEqual(["2026-09-21", "2026-09-24", "2026-09-24", "2026-09-28", "2026-10-01"]);
    expect(r.counts).toMatchObject({ chapters: 4, sessions: 1, faded: 1, readings: 2, open: 2 });
    // Moments under their chapters — the ones written in the chapter's span.
    expect(shown[0]?.moments.map((m) => m.id)).toEqual([s.m1, s.m2]);
    expect(shown[1]?.moments.map((m) => m.id)).toContain(s.m3);
    expect(shown[1]?.moments.map((m) => m.id)).toContain(s.m4);
    expect(shown[2]?.moments.map((m) => m.id)).toEqual([s.m5]);
    expect(shown[4]?.kind).toBe("session");
    expect(shown[4]?.moments.map((m) => m.id)).toEqual([s.m7]);
    // The line: the chapter's first sentence naming Han.
    expect(shown[0]?.line).toBe("Met Han today.");
    expect(shown[0]?.title).toBe("First week with Han");
    // Feelings side by side, never merged: mine and Mike's.
    expect(shown[0]?.feelings.self.map((f) => f.word)).toEqual(["uneasy", "curious"]);
    expect(shown[0]?.feelings.owner.map((f) => f.word)).toEqual(["frustrated"]);
    expect(text).toContain("feelings — mine: uneasy .7, curious .6 | Mike's: frustrated .5");

    // Faded: listed after the arc, never in its slots.
    expect(r.faded.map((m) => m.id)).toEqual([s.faded]);
    expect(shown.flatMap((e) => e.moments.map((m) => m.id))).not.toContain(s.faded);
    // Earlier readings: the gist names Han; the reflection cites a Han memory.
    expect(r.readings.map((g) => [g.by, g.id])).toEqual([
      ["dreamed", s.gist],
      ["reflected", s.reflection],
    ]);
    // Readings are not moments.
    expect(shown.flatMap((e) => e.moments.map((m) => m.id))).not.toContain(s.gist);
    // Still open: the dated reminder first, then the thread.
    expect(r.open.map((o) => [o.why, o.id])).toEqual([
      ["dated", s.m7],
      ["open", s.m4],
    ]);
    // Recurring: Oskar in several entries; my unease in two.
    expect(r.patterns.subjects).toEqual([{ label: "Oskar", entries: 2, of: 5 }]);
    expect(r.patterns.feelings.map((p) => p.label)).toContain("mine uneasy");

    // The header, and the sections, as labelled lines.
    expect(text.split("\n")[0]).toBe("Han · 4 chapters · 1 session with no chapter · 8 moments (+1 faded)");
    expect(text).toContain("also named: Oskar");
    for (const h of ["ARC (time order", "FADED (1", "EARLIER READINGS (2", "STILL OPEN (2", "RECURRING"]) expect(text).toContain(h);
    // Fits the room, and says exactly what it showed.
    expect(r.chars).toBeLessThanOrEqual(MEANING_RESULT_CHARS);
    expect(r.trimmed).toBe(false);
    const printed = new Set(text.match(/\b(?:mem|epi)_[a-z0-9]+/g) ?? []);
    expect(new Set(r.shown)).toEqual(printed);
  });

  test("a confidential memory is left out of a non-owner's answer, silently; the owner sees it", () => {
    const c = brain();
    const s = seed(c);
    const guest = meaningRecall(ctx(c, { owner: false }), "Tell me about Han");
    const all = (r: MeaningResult) => entries(r).flatMap((e) => e.moments.map((m) => m.id));
    expect(all(guest)).not.toContain(s.secret);
    expect(renderMeaning(guest)).not.toContain("salary");
    const owner = meaningRecall(ctx(c), "Tell me about Han");
    expect(owner.counts.moments).toBe(guest.counts.moments + 1);
    // The answer says nothing about the one left out.
    expect(renderMeaning(guest)).not.toMatch(/confidential|withheld/i);
  });

  test("a search writes nothing: no use, no physics, no rows", () => {
    const c = brain();
    const s = seed(c);
    const before = { uses: c.store.row(s.m1)?.uses, last: c.store.row(s.m1)?.last_used_day, live: c.store.list({}).length };
    meaningRecall(ctx(c), "What has Han been to me?");
    expect({ uses: c.store.row(s.m1)?.uses, last: c.store.row(s.m1)?.last_used_day, live: c.store.list({}).length }).toEqual(before);
  });
});

describe("other lenses", () => {
  test("a question naming the card by its possessive reaches the card's arc", () => {
    const c = brain();
    const s = seed(c);
    const r = meaningRecall(ctx(c), "How has Han's work gone?");
    expect(r.lens).toEqual({ kind: "card", id: s.han, name: "Han" });
    // "Han's birthday" in a memory links it to Han now, so it is a moment.
    const bday = moment(c, "sess_e", "Han's birthday cake order went in.");
    expect(c.store.subjectsOf(bday)).toEqual([s.han]);
    const again = meaningRecall(ctx(c), "How has Han's work gone?");
    expect(entries(again).flatMap((e) => e.moments.map((m) => m.id))).toContain(bday);
  });

  test('"us" is the memories marked about: us', () => {
    const c = brain();
    const s = seed(c);
    const r = meaningRecall(ctx(c), "How have things been between us lately?");
    expect(r.lens).toEqual({ kind: "us", name: "us (Mike and me)" });
    const ids = entries(r).flatMap((e) => e.moments.map((m) => m.id));
    expect(ids.sort()).toEqual([s.us1, s.us2].sort());
  });

  test("a feeling question: the stamps that match its word, and whose", () => {
    const c = brain();
    const s = seed(c);
    const mine = meaningRecall(ctx(c), "When was I uneasy?");
    expect(mine.lens?.kind).toBe("feeling");
    expect(mine.feeling).toEqual({ words: ["uneasy"], whose: "mine" });
    const ids = entries(mine).flatMap((e) => e.moments.map((m) => m.id));
    expect(ids).toContain(s.m2);
    expect(ids).toContain(s.m6);
    // Mike's pride is not my unease.
    expect(ids).not.toContain(s.m5);

    const his = meaningRecall(ctx(c), "When was Mike proud?");
    expect(his.feeling?.whose).toBe("Mike's");
    const hisIds = entries(his).flatMap((e) => e.moments.map((m) => m.id));
    expect(hisIds.sort()).toEqual([s.m3, s.m5].sort());
  });

  test("a feeling with a card keeps the card's chapters that carry it", () => {
    const c = brain();
    const s = seed(c);
    const r = meaningRecall(ctx(c), "When was I uneasy about Han?");
    expect(r.lens).toMatchObject({ kind: "card", name: "Han" });
    expect(entries(r).map((e) => e.address)).toEqual([`${s.a1.episodeId}#1`, `${s.c1.episodeId}#1`]);
  });

  test("no card and no feeling: the question's rarer words, said so", () => {
    const c = brain();
    const s = seed(c);
    const r = meaningRecall(ctx(c), "What happened with the harbour budget?");
    expect(r.lens?.kind).toBe("words");
    expect(entries(r).flatMap((e) => e.moments.map((m) => m.id))).toContain(s.words);
    expect(r.notes.join(" ")).toContain("no card names it");
    expect(r.notes.join(" ")).toContain("meaning search off: embedder-off");
  });

  test("a question nothing answers says so", () => {
    const c = brain();
    seed(c);
    const r = meaningRecall(ctx(c), "xyzzy plugh?");
    expect(r.reason).toBe("nothing-came");
    expect(r.shown).toEqual([]);
    expect(renderMeaning(r)).toContain("Nothing");
  });
});

describe("a long arc", () => {
  /** Twelve sessions, one chapter each, every one naming Ada; feelings flip at the seventh. */
  function longArc(c: Counterpart, n = 12, words = 1): { address: string }[] {
    card(c, "Ada");
    const out: { address: string }[] = [];
    for (let i = 0; i < n; i++) {
      clock = Date.parse("2026-09-01T10:00:00Z") + i * DAY;
      const session = `sess_long_${String(i).padStart(2, "0")}`;
      const extra = i === 4 ? " Ada again, and Ada once more." : "";
      for (let k = 0; k < words; k++) {
        moment(c, session, `Ada worked on part ${String(i)}.${k > 0 ? ` Note ${String(k)}: ${"a long stretch of words about the work ".repeat(4)}` : ""}`, {
          feel: [{ whose: "self", emotion: i < 6 ? "happy" : "sad", strength: 0.6 }],
        });
      }
      const ch = chapter(c, session, `Day ${String(i)} with Ada.${extra} ${"More of the day went by in small steps. ".repeat(words > 1 ? 8 : 1)}`);
      out.push({ address: `${ch.episodeId}#${String(ch.chapter)}` });
    }
    return out;
  }

  test("page 1 keeps the start, the end and the turn; the rest fold; page 2 has the others; past the end says so", () => {
    const c = brain();
    const arc = longArc(c);
    const one = meaningRecall(ctx(c), "What has Ada been to me?");
    expect(one.pages).toBe(2);
    const shown = entries(one);
    expect(shown).toHaveLength(MEANING_CHAPTERS_SHOWN);
    expect(shown[0]?.address).toBe(arc[0]?.address);
    expect(shown[0]?.marks).toContain("start");
    expect(shown[shown.length - 1]?.address).toBe(arc[11]?.address);
    expect(shown[shown.length - 1]?.marks).toContain("end");
    const turn = shown.find((e) => e.marks.includes("turn"));
    expect(turn?.address).toBe(arc[6]?.address);
    // The chapter that names Ada most is kept.
    expect(shown.map((e) => e.address)).toContain(arc[4]?.address as string);
    // Time order on the page, and folds for what is not on it.
    expect(one.arc.some((l) => l.fold)).toBe(true);
    const text = renderMeaning(one);
    expect(text).toContain("12 entries · page 1 of 2, showing 8 → page 2");
    expect(text).toMatch(/quieter entr(y|ies) not shown here/);

    const two = meaningRecall(ctx(c), "What has Ada been to me?", { page: 2 });
    const second = entries(two).map((e) => e.address);
    expect(second).toHaveLength(4);
    // Every entry on exactly one page.
    expect(new Set([...shown.map((e) => e.address), ...second]).size).toBe(12);
    // Stable: asked again, the same page.
    expect(entries(meaningRecall(ctx(c), "What has Ada been to me?", { page: 2 })).map((e) => e.address)).toEqual(second);

    const three = meaningRecall(ctx(c), "What has Ada been to me?", { page: 3 });
    expect(entries(three)).toHaveLength(0);
    expect(three.notes.join(" ")).toContain("page 3 is past the end");
  });

  test("a big arc stays under the 12,000-character room, and shown is what was printed", () => {
    const c = brain();
    longArc(c, 30, 6);
    const r = meaningRecall(ctx(c), "What has Ada been to me?");
    const text = renderMeaning(r);
    expect(wireChars(text)).toBeLessThanOrEqual(MEANING_RESULT_CHARS);
    expect(r.chars).toBe(wireChars(text));
    const printed = new Set(text.match(/\b(?:mem|epi)_[a-z0-9]+/g) ?? []);
    expect(new Set(r.shown)).toEqual(printed);
  });

  test("the fit trims to a smaller room: fewer moments, then entries folded; the arc's total is kept", () => {
    const c = brain();
    longArc(c, 30, 6);
    const full = meaningRecall(ctx(c), "What has Ada been to me?");
    expect(full.trimmed).toBe(false);
    const total = (r: MeaningResult) => r.arc.reduce((n, l) => n + (l.fold ? l.count : 1), 0);
    for (const room of [3_000, 1_800, 900]) {
      const r = meaningRecall(ctx(c), "What has Ada been to me?", { roomChars: room });
      const text = renderMeaning(r);
      expect(r.trimmed).toBe(true);
      expect(wireChars(text)).toBeLessThanOrEqual(room);
      expect(r.chars).toBe(wireChars(text));
      // Every entry is still on the arc, shown or folded.
      expect(total(r)).toBe(total(full));
      // Two folds never sit side by side.
      expect(r.arc.some((l, i) => l.fold && r.arc[i + 1]?.fold === true)).toBe(false);
      const printed = new Set(text.match(/\b(?:mem|epi)_[a-z0-9]+/g) ?? []);
      expect(new Set(r.shown)).toEqual(printed);
    }
    // The smallest room had to fold entries off the page.
    expect(entries(meaningRecall(ctx(c), "What has Ada been to me?", { roomChars: 900 })).length).toBeLessThan(entries(full).length);
  });
});

describe("thin evidence", () => {
  test("one chapter, and no feelings recorded, are said", () => {
    const c = brain();
    card(c, "Rua");
    moment(c, "sess_t", "Rua sent the contract back unsigned.");
    chapter(c, "sess_t", "Rua sent the contract back today, unsigned, with a note asking for two more weeks.");
    const r = meaningRecall(ctx(c), "What has Rua been to me?");
    expect(r.notes).toContain("one chapter");
    expect(r.notes).toContain("no feelings recorded");
  });

  test("two chapters inside one week are said; moments with no chapter are said", () => {
    const c = brain();
    card(c, "Rua");
    moment(c, "sess_t1", "Rua sent the contract back unsigned.");
    chapter(c, "sess_t1", "Rua sent the contract back today, unsigned, with a note asking for two more weeks.");
    clock += 2 * DAY;
    moment(c, "sess_t2", "Rua signed it after all.");
    chapter(c, "sess_t2", "Rua signed the contract after all, and the project can start on Monday as planned.");
    expect(meaningRecall(ctx(c), "What has Rua been to me?").notes).toContain("2 chapters, all from one week");

    const d = Counterpart.open({ dir: join(root, "other"), snapshotsDir: join(root, "snaps2"), owner: true, now: () => clock });
    open.push(d);
    card(d, "Rua");
    moment(d, "sess_x", "Rua called about the invoice.");
    const r = meaningRecall(ctx(d), "What has Rua been to me?");
    expect(r.notes.join(" ")).toContain("no chapter holds it: 1 moment from sessions that wrote none");
  });
});

describe("the helpers", () => {
  test("chapterTimesOf and chapterAt place a memory by resolveChapter's own span rule", () => {
    const c = brain();
    const m1 = moment(c, "sess_h", "First stretch note.");
    const one = chapter(c, "sess_h", "The first stretch of the session: we set up the store and read the old notes together.");
    clock += 60_000;
    const dump = moment(c, "sess_h", "Written just after chapter one, inside the grace.");
    later();
    const m2 = moment(c, "sess_h", "Second stretch note.");
    chapter(c, "sess_h", "The second stretch: the tests went green and we wrote down what the store still owes.");
    later();
    const after = moment(c, "sess_h", "A write-up after the last chapter.");
    const t = chapterTimesOf(c.store, one.episodeId);
    expect(t?.of).toBe(2);
    expect(t?.from).toBe("stored");
    if (t === null) return;
    const at = (id: string) => c.store.row(id)?.created_at as number;
    expect(chapterAt(t, at(m1))).toBe(1);
    expect(chapterAt(t, at(dump))).toBe(1);
    expect(chapterAt(t, at(m2))).toBe(2);
    expect(chapterAt(t, at(after))).toBeNull();
    // The same answer resolveChapter gives.
    const r1 = resolveChapter(c.store, `${one.episodeId}#1`);
    const r2 = resolveChapter(c.store, `${one.episodeId}#2`);
    expect(r1.ok && r1.chapter.moments).toEqual([m1, dump]);
    expect(r2.ok && r2.chapter.moments).toEqual([m2]);
    expect(chapterTimesOf(c.store, m1)).toBeNull();
  });

  test("the store lists memories by their about mark", () => {
    const c = brain();
    const us = moment(c, "sess_m", "Ours.", { about: "us" });
    moment(c, "sess_m", "Mine.", { about: "me" });
    moment(c, "sess_m", "Unmarked.");
    expect(c.store.list({ type: "memory", about: "us" })).toEqual([us]);
  });
});
