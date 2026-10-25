/**
 * "TODAY SO FAR" AND YESTERDAY FROM DAY'S END'S SUMMARY (2026-10-24, lane W1;
 * Mike's go 17:45, lightly held — docs/decisions.d/feat-today-so-far.md).
 * Through the delivery a SessionStart hook makes (`Counterpart#wake` with a
 * date and a `here`, which assembles the wake for the moment): today's
 * earlier chapters in this folder get a line of their own, and the Yesterday
 * line leads with day's end's summary when the privacy gate lets it through.
 *
 * Hermetic: every store is a temp dir made and removed here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TODAY_SO_FAR_HEAD, YESTERDAY_SUMMARY_WORDS } from "../src/core/handoff/last-here.js";
import { readSentinel, withTodaySoFar } from "../src/core/self/index.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";
import { readableDate } from "../src/core/time.js";

const HOUR = 3_600_000;
const BUDGET = 9_000;
const D1 = "2026-10-23";
const D2 = "2026-10-24";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;

const S1 = "c1c2c3c4-0000-4000-8000-000000000001";
const S2 = "c1c2c3c4-0000-4000-8000-000000000002";
const S3 = "c1c2c3c4-0000-4000-8000-000000000003";
const S4 = "c1c2c3c4-0000-4000-8000-000000000004";
const S5 = "c1c2c3c4-0000-4000-8000-000000000005";
const READER = "d5d6d7d8-0000-4000-8000-00000000000d";

const S = SELF_TUNABLES as { TODAY_SO_FAR: boolean; YESTERDAY_FROM_SUMMARY: boolean };
const was = { today: S.TODAY_SO_FAR, summary: S.YESTERDAY_FROM_SUMMARY };

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
let PRIVATE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-today-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  THERE = join(root, "site");
  PRIVATE = join(root, "ledger");
  for (const d of [HERE, THERE, PRIVATE]) mkdirSync(d, { recursive: true });
  S.TODAY_SO_FAR = true;
  S.YESTERDAY_FROM_SUMMARY = true;
});

afterEach(() => {
  S.TODAY_SO_FAR = was.today;
  S.YESTERDAY_FROM_SUMMARY = was.summary;
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

type K = { c: Counterpart; set(t: number): void };

function store(start: number, budget = BUDGET): K {
  let now = start;
  const c = Counterpart.open({ dir: storeDir, budgetBytes: budget, now: () => now, timeZone: "UTC" });
  open.push(c);
  return {
    c,
    set(t: number): void {
      now = t;
    },
  };
}

/** A one-chapter episode written at `hour` on `date`, with its session-written summary unless `summary` is null. */
function episode(k: K, o: { session: string; scope: string; title: string; date: string; hour: number; aboutMe?: boolean; summary?: string | null }): string {
  k.set(at(o.date, o.hour));
  const id = k.c.store.put({
    type: "episode",
    kind: "self",
    title: o.title,
    body: `## chapter 1 — ${readableDate(o.date)} · lived day 1\n\nWhat happened in ${o.title}.\n`,
    meta: { sessionId: o.session, chapters: 1 },
    source: "episode",
    origin: { session: o.session, scope: o.scope },
  });
  if (o.summary !== null) {
    k.c.store.put({
      type: "memory",
      kind: "self",
      body: o.summary ?? `I worked on ${o.title.toLowerCase()} and decided the next step.`,
      meta: { episodeId: id, chapter: 1, chapterSummary: "written" },
      source: "episode",
      origin: { session: o.session, scope: o.scope, ref: id },
      ...(o.aboutMe === true ? { about: "me" as const } : {}),
    });
  }
  return id;
}

/** A plain memory written in `scope` at `hour` on `date`. */
function memory(k: K, o: { scope: string; session: string; date: string; hour: number; body: string; about?: "me" | "work" }): string {
  k.set(at(o.date, o.hour));
  return k.c.store.put({ type: "memory", kind: "fact", body: o.body, origin: { session: o.session, scope: o.scope }, ...(o.about === undefined ? {} : { about: o.about }) });
}

/** Day's end's summary about `about`, as the night's closing call records it. */
function summary(k: K, about: string, text: string, cites: readonly string[]): void {
  k.c.recordPageWriterRun({ about, mode: "session", outcome: "nothing-to-say", summary: text, summaryCites: cites, session: S5, run: "run-test" });
}

function wakeFor(k: K, scope: string, opts: { budget?: number; exportsFrom?: (s: string) => boolean; hour?: number } = {}): { text: string; bytes: number } {
  k.set(at(D2, opts.hour ?? 15));
  const budget = opts.budget ?? BUDGET;
  k.c.rebrief({ budgetBytes: budget, at: D2 });
  const w = k.c.wake(budget, { date: D2 }, { scope, session: READER, exportsFrom: opts.exportsFrom ?? (() => true) });
  return { text: w.text, bytes: w.bytes };
}

const count = (text: string, id: string): number => text.split(id).length - 1;
const lineStarting = (text: string, head: string): string | undefined => text.split("\n").find((l) => l.startsWith(head));

describe("Today so far here", () => {
  test("1. three chapters today here and one elsewhere: the two older ones here, 'Last here' the newest, 'Today, elsewhere' the other folder — each named once", () => {
    const k = store(at(D2, 7));
    const morning = episode(k, { session: S1, scope: HERE, title: "Potting on the tomatoes", date: D2, hour: 9, summary: "I potted on the tomatoes and chose the deeper pots. Then more." });
    const noon = episode(k, { session: S2, scope: HERE, title: "The irrigation timer", date: D2, hour: 11 });
    const newest = episode(k, { session: S3, scope: HERE, title: "Netting the brassicas", date: D2, hour: 14 });
    const away = episode(k, { session: S4, scope: THERE, title: "The site's front page", date: D2, hour: 10 });
    memory(k, { scope: THERE, session: S4, date: D2, hour: 10, body: "The front page hero shows the castle drawing.", about: "work" });
    const { text, bytes } = wakeFor(k, HERE);
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes).toBeLessThanOrEqual(BUDGET);
    const today = lineStarting(text, `${TODAY_SO_FAR_HEAD} `) ?? "";
    // The two older ones, oldest first, with time, title, id and summary.
    expect(today).toContain(`09:00 "Potting on the tomatoes" (${morning}) — I potted on the tomatoes and chose the deeper pots`);
    expect(today).toContain(`11:00 "The irrigation timer" (${noon}) — I worked on the irrigation timer and decided the next step`);
    expect(today.indexOf(morning)).toBeLessThan(today.indexOf(noon));
    expect(today).not.toContain(newest);
    expect(today).not.toContain(away);
    // "Last here" names the newest, and its block repeats none of the others.
    expect(lineStarting(text, "Last here: ")).toContain(`(${newest})`);
    expect(text).not.toMatch(/^Before it: /m);
    expect(text).not.toMatch(/^\+\d+ more here on /m);
    // "Today, elsewhere" says the other folder; its chapter, not about me, is not named.
    expect(lineStarting(text, "Today, elsewhere: ")).toContain("site");
    for (const id of [morning, noon, newest]) expect(count(text, id)).toBe(1);
    expect(count(text, away)).toBe(0);
    // It sits under the framing, after the Yesterday line's place.
    const lines = text.split("\n");
    expect(lines.findIndex((l) => l.startsWith(TODAY_SO_FAR_HEAD))).toBe(3);
  });

  test("2. no chapters today, or only the one 'Last here' names: no line", () => {
    const k = store(at(D1, 7));
    episode(k, { session: S1, scope: HERE, title: "Yesterday's sowing", date: D1, hour: 9 });
    expect(wakeFor(k, HERE).text).not.toContain(TODAY_SO_FAR_HEAD);
    const only = episode(k, { session: S2, scope: HERE, title: "This morning's sowing", date: D2, hour: 9 });
    const { text } = wakeFor(k, HERE);
    expect(text).not.toContain(TODAY_SO_FAR_HEAD);
    expect(lineStarting(text, "Last here: ")).toContain(`(${only})`);
  });

  test("3. another folder's chapter is never this line's; not nameable, it is not named, and its folder is said only where 'Today, elsewhere' may say it", () => {
    const k = store(at(D2, 7));
    episode(k, { session: S1, scope: HERE, title: "Potting on the tomatoes", date: D2, hour: 9 });
    episode(k, { session: S2, scope: HERE, title: "The irrigation timer", date: D2, hour: 11 });
    const secret = episode(k, { session: S3, scope: PRIVATE, title: "The quarterly figures", date: D2, hour: 10, summary: "I reconciled the quarter's figures." });
    memory(k, { scope: PRIVATE, session: S3, date: D2, hour: 10, body: "The quarter closed at a loss on the seed account." });
    const shared = episode(k, { session: S4, scope: THERE, title: "The site's front page", date: D2, hour: 12 });
    memory(k, { scope: THERE, session: S4, date: D2, hour: 12, body: "The site's hero image is the castle.", about: "work" });
    const exportsFrom = (s: string): boolean => s !== PRIVATE;
    const { text } = wakeFor(k, HERE, { exportsFrom });
    const today = lineStarting(text, `${TODAY_SO_FAR_HEAD} `) ?? "";
    expect(today.length).toBeGreaterThan(0);
    for (const id of [secret, shared]) expect(today).not.toContain(id);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("quarterly");
    expect(text).not.toContain("ledger");
    // The exporting folder is said by "Today, elsewhere", by folder; its chapter, not about me, is not named.
    expect(lineStarting(text, "Today, elsewhere: ")).toContain("site");
    expect(text).not.toContain(shared);
    // With no way to ask the scope setting, nothing of another folder is said.
    k.set(at(D2, 15));
    const blind = k.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: READER }).text;
    expect(blind).not.toContain("ledger");
    expect(blind).not.toContain(secret);
  });

  test("the reader's own session's chapter (a resumed session) is not listed back to it", () => {
    const k = store(at(D2, 7));
    const mine = episode(k, { session: READER, scope: HERE, title: "My own morning", date: D2, hour: 8 });
    const other = episode(k, { session: S1, scope: HERE, title: "Potting on the tomatoes", date: D2, hour: 9 });
    episode(k, { session: S2, scope: HERE, title: "The irrigation timer", date: D2, hour: 11 });
    const today = lineStarting(wakeFor(k, HERE).text, `${TODAY_SO_FAR_HEAD} `) ?? "";
    expect(today).toContain(other);
    expect(today).not.toContain(mine);
  });
});

describe("Yesterday from day's end's summary", () => {
  function yesterdayStore(): { k: K; ids: { a: string; b: string; newest: string }; own: string; aboutMeThere: string; workThere: string; secret: string } {
    const k = store(at(D1, 7));
    const a = episode(k, { session: S1, scope: HERE, title: "Sowing the broad beans", date: D1, hour: 9 });
    const b = episode(k, { session: S2, scope: HERE, title: "Mending the cold frame", date: D1, hour: 11 });
    const newest = episode(k, { session: S3, scope: HERE, title: "Ordering the seed potatoes", date: D1, hour: 14 });
    const own = memory(k, { scope: HERE, session: S1, date: D1, hour: 9, body: "Broad beans go in by the fence this year." });
    const aboutMeThere = memory(k, { scope: THERE, session: S4, date: D1, hour: 10, body: "I like writing the site's copy more than I expected.", about: "me" });
    const workThere = memory(k, { scope: THERE, session: S4, date: D1, hour: 10, body: "The site's footer links the directory.", about: "work" });
    return { k, ids: { a, b, newest }, own, aboutMeThere, workThere, secret: "" };
  }
  const TOLD = "A garden day: I sowed the broad beans, mended the cold frame and ordered the seed potatoes; the frost decides the rest.";
  const plainYesterday = (k: K, opts: { exportsFrom?: (s: string) => boolean } = {}): string => {
    S.YESTERDAY_FROM_SUMMARY = false;
    try {
      return lineStarting(wakeFor(k, HERE, opts).text, "Yesterday") ?? "";
    } finally {
      S.YESTERDAY_FROM_SUMMARY = true;
    }
  };

  test("4. a summary whose cites are all nameable leads the line, labelled, with the chapters after it; without one the line is byte-identical to the old", () => {
    const { k, ids, own, aboutMeThere } = yesterdayStore();
    const before = plainYesterday(k);
    expect(before).toStartWith("Yesterday: ");
    // No summary yet: the same line with the switch on.
    expect(lineStarting(wakeFor(k, HERE).text, "Yesterday")).toBe(before);
    summary(k, D1, TOLD, [own, aboutMeThere]);
    const { text, bytes } = wakeFor(k, HERE);
    expect(bytes).toBeLessThanOrEqual(BUDGET);
    const line = lineStarting(text, "Yesterday") ?? "";
    expect(line).toStartWith(`Yesterday, ${YESTERDAY_SUMMARY_WORDS} ${TOLD} Chapters: `);
    expect(line).toContain(`"Sowing the broad beans" (${ids.a})`);
    expect(line).toContain(`"Mending the cold frame" (${ids.b})`);
    // Each episode once: the newest is "Last here"'s.
    expect(line).not.toContain(ids.newest);
    expect(count(text, ids.newest)).toBe(1);
    // Switched off, the old line again.
    expect(plainYesterday(k)).toBe(before);
  });

  test("5. a work cite from another folder leads the line while that folder's scope setting is on (Y2); with it off, the chapter list", () => {
    const { k, own, workThere } = yesterdayStore();
    const offThere = (s: string): boolean => s !== THERE;
    const before = plainYesterday(k, { exportsFrom: offThere });
    // A work memory from another folder, not about me: its folder exports, so it crosses
    // (until Y2, 2026-10-25, only an about-me cite did).
    summary(k, D1, TOLD, [own, workThere]);
    expect(lineStarting(wakeFor(k, HERE).text, "Yesterday")).toStartWith(`Yesterday, ${YESTERDAY_SUMMARY_WORDS} ${TOLD}`);
    expect(lineStarting(wakeFor(k, HERE, { exportsFrom: offThere }).text, "Yesterday")).toBe(before);
  });

  test("5b. a cite from a folder whose scope setting is off, or one that no longer reads, falls back", () => {
    const { k, own } = yesterdayStore();
    const before = plainYesterday(k, { exportsFrom: (s) => s !== PRIVATE });
    const secret = memory(k, { scope: PRIVATE, session: S5, date: D1, hour: 12, body: "I feel uneasy about the quarter's numbers.", about: "me" });
    summary(k, D1, TOLD, [own, secret]);
    const exportsFrom = (s: string): boolean => s !== PRIVATE;
    expect(lineStarting(wakeFor(k, HERE, { exportsFrom }).text, "Yesterday")).toBe(before);
    expect(wakeFor(k, HERE, { exportsFrom }).text).not.toContain(TOLD);
    // A cite that does not read (a made-up id) fails it too.
    summary(k, D1, TOLD, [own, "mem_000000000000"]);
    expect(wakeFor(k, HERE).text).not.toContain(TOLD);
  });

  test("5c. nothing cited from a private folder, but that folder wrote that day: falls back — the prose may carry it uncited", () => {
    const { k, own } = yesterdayStore();
    const exportsFrom = (s: string): boolean => s !== PRIVATE;
    summary(k, D1, TOLD, [own]);
    // Shown while every folder of the day may be read here.
    expect(wakeFor(k, HERE, { exportsFrom }).text).toContain(TOLD);
    // A memory written in the private folder that day: no longer.
    memory(k, { scope: PRIVATE, session: S5, date: D1, hour: 16, body: "The quarter closed at a loss." });
    expect(wakeFor(k, HERE, { exportsFrom }).text).not.toContain(TOLD);
  });

  test("5d. a chapter that day from a private folder, nothing cited: falls back; a wake with no way to ask the scope setting shows it only when the day was all this folder's", () => {
    const { k } = yesterdayStore();
    summary(k, D1, TOLD, []);
    const exportsFrom = (s: string): boolean => s !== PRIVATE;
    // THERE wrote memories that day and exports: shown.
    expect(wakeFor(k, HERE, { exportsFrom }).text).toContain(TOLD);
    // No way to ask: THERE's memories that day keep it out.
    k.set(at(D2, 15));
    expect(k.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: READER }).text).not.toContain(TOLD);
    episode(k, { session: S5, scope: PRIVATE, title: "The quarterly figures", date: D1, hour: 17, summary: null });
    expect(wakeFor(k, HERE, { exportsFrom }).text).not.toContain(TOLD);
  });

  test("a summary about another day, or one in a store-wide render no session reads, is not used", () => {
    const { k, own } = yesterdayStore();
    summary(k, "2026-10-22", TOLD, [own]);
    expect(wakeFor(k, HERE).text).not.toContain(TOLD);
    summary(k, D1, TOLD, [own]);
    k.set(at(D2, 15));
    k.c.rebrief({ budgetBytes: BUDGET, at: D2 });
    expect(k.c.wake(BUDGET).text).not.toContain(TOLD);
  });

  // ── the gate's awkward states (review of #614) ─────────────────────────────
  // The summary is told at the night from the whole day; the wake reads the
  // store as the night LEFT it. What the night's dream archived or merged,
  // what was written up second-hand the next morning, and what was written
  // with no folder all reached day's end, and each must keep the summary out
  // of a wake that may not name where it came from.
  const offPrivate = (s: string): boolean => s !== PRIVATE;
  test("review: a scope-off folder's only memory that day, archived by that night's dream, still keeps the summary out", () => {
    const { k, own } = yesterdayStore();
    const secret = memory(k, { scope: PRIVATE, session: S5, date: D1, hour: 16, body: "The quarter closed at a loss." });
    summary(k, D1, TOLD, [own]);
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
    k.set(at(D2, 2));
    k.c.store.archive(secret, "dream: faded");
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
  });
  test("review: a scope-off folder's memories merged by that night's dream (the merge filed under the dreaming folder) still keep the summary out", () => {
    const { k, own } = yesterdayStore();
    const one = memory(k, { scope: PRIVATE, session: S5, date: D1, hour: 16, body: "The quarter closed at a loss." });
    const two = memory(k, { scope: PRIVATE, session: S5, date: D1, hour: 17, body: "The loss was the van repair." });
    summary(k, D1, TOLD, [own]);
    k.set(at(D2, 2));
    // The dream's merge (`dream/index.ts`): a new row stamped the night, in
    // the dreaming session's folder, the originals superseded.
    const merged = k.c.store.put({
      type: "memory",
      kind: "fact",
      body: "The quarter closed at a loss, from the van repair.",
      source: "dreamed",
      meta: { dream: "dream_test", mergedFrom: [one, two] },
      origin: { session: S5, scope: HERE, ref: "dream:dream_test" },
    });
    k.c.store.supersedeInto(one, merged, "merge");
    k.c.store.supersedeInto(two, merged, "merge");
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
  });
  test("review: a memory of that day written up second-hand the next morning, before a late day's end, keeps the summary out", () => {
    const { k, own } = yesterdayStore();
    // Written on D2 at 06:00 about D1 (the catch-up): day's end, run late,
    // reads it as D1's (`writer.ts#isOfDay`, `types.ts#livedOn`).
    k.set(at(D2, 6));
    k.c.store.put({ type: "memory", kind: "fact", body: "The quarter closed at a loss.", happenedOn: D1, meta: { secondHand: true }, origin: { session: S5, scope: PRIVATE } });
    summary(k, D1, TOLD, [own]);
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
  });
  test("review: a memory written that day with no folder recorded keeps the summary out — nothing says where it may be shown", () => {
    const { k, own } = yesterdayStore();
    k.set(at(D1, 18));
    k.c.store.put({ type: "memory", kind: "fact", body: "The quarter closed at a loss.", origin: { session: S5 } });
    summary(k, D1, TOLD, [own]);
    expect(wakeFor(k, HERE).text).not.toContain(TOLD);
  });
  test("review: a backdated memory (written that day, learned on an earlier date) from a scope-off folder keeps the summary out", () => {
    const { k, own } = yesterdayStore();
    k.set(at(D1, 18));
    k.c.store.put({ type: "memory", kind: "fact", body: "The quarter closed at a loss.", learnedOn: "2026-10-01", origin: { session: S5, scope: PRIVATE } });
    summary(k, D1, TOLD, [own]);
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
  });
  test("review: a scope-off folder's chapter that day, archived after the night, keeps the summary out", () => {
    const { k, own } = yesterdayStore();
    const ch = episode(k, { session: S5, scope: PRIVATE, title: "The quarterly figures", date: D1, hour: 17, summary: null });
    summary(k, D1, TOLD, [own]);
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
    k.set(at(D2, 2));
    k.c.store.archive(ch, "dream: faded");
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).not.toContain(TOLD);
  });
  test("review: zero cites on a multi-folder day shows only while every folder of the day may be read here", () => {
    const { k } = yesterdayStore();
    summary(k, D1, TOLD, []);
    expect(wakeFor(k, HERE).text).toContain(TOLD);
    expect(wakeFor(k, HERE, { exportsFrom: (s) => s !== THERE }).text).not.toContain(TOLD);
  });
  test("review: a folder under this one (a joined project folder) whose scope setting is off is not this folder", () => {
    const { k, own } = yesterdayStore();
    const sub = join(HERE, "notes");
    mkdirSync(sub, { recursive: true });
    memory(k, { scope: sub, session: S5, date: D1, hour: 16, body: "Notes kept in the sub-folder." });
    summary(k, D1, TOLD, [own]);
    expect(wakeFor(k, HERE, { exportsFrom: (s) => s !== sub }).text).not.toContain(TOLD);
    expect(wakeFor(k, HERE).text).toContain(TOLD);
  });
  test("review: the night's own rows (a merge filed under another folder) do not by themselves keep an all-here day's summary out", () => {
    const { k, own } = yesterdayStore();
    const one = memory(k, { scope: HERE, session: S1, date: D1, hour: 16, body: "The beans want netting." });
    summary(k, D1, TOLD, [own]);
    k.set(at(D2, 2));
    const merged = k.c.store.put({
      type: "memory",
      kind: "fact",
      body: "The beans want netting by the fence.",
      source: "dreamed",
      meta: { dream: "dream_test", mergedFrom: [one] },
      origin: { session: S5, scope: PRIVATE, ref: "dream:dream_test" },
    });
    k.c.store.supersedeInto(one, merged, "merge");
    expect(wakeFor(k, HERE, { exportsFrom: offPrivate }).text).toContain(TOLD);
  });
});

describe("the room", () => {
  test("6. a tight room: 'Today so far' steps down and drops before the Yesterday line gives up a title, and the wake stays under its cap", () => {
    const k = store(at(D1, 7));
    k.c.revisePage(`## Core\n\n${"I keep the garden's ledger and say what I do not know. ".repeat(30)}`, { by: "owner", reason: "seed" });
    for (let i = 0; i < 30; i++) {
      memory(k, { scope: HERE, session: S1, date: D1, hour: 8, body: `Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn, given the rain.` });
    }
    for (const [i, t] of ["Sowing the broad beans", "Mending the cold frame", "Ordering the seed potatoes", "Turning the compost"].entries()) {
      episode(k, { session: `e1e2e3e4-0000-4000-8000-00000000000${String(i)}`, scope: HERE, title: t, date: D1, hour: 9 + i });
    }
    for (const [i, t] of ["Potting on the tomatoes", "The irrigation timer", "Pricking out the leeks", "Netting the brassicas"].entries()) {
      episode(k, { session: `f1f2f3f4-0000-4000-8000-00000000000${String(i)}`, scope: HERE, title: t, date: D2, hour: 8 + i });
    }
    const roomy = wakeFor(k, HERE);
    const widestYesterday = lineStarting(roomy.text, "Yesterday") ?? "";
    expect(widestYesterday.length).toBeGreaterThan(0);
    expect(roomy.text).toContain(TODAY_SO_FAR_HEAD);
    let stepped = 0;
    let dropped = 0;
    for (let budget = 4_000; budget >= 1_400; budget -= 40) {
      const { text, bytes } = wakeFor(k, HERE, { budget });
      if (!readSentinel(text).intact) continue;
      expect(bytes).toBeLessThanOrEqual(budget);
      const y = lineStarting(text, "Yesterday");
      const t = lineStarting(text, TODAY_SO_FAR_HEAD);
      // While the Yesterday line has given anything up, "Today so far" is gone.
      if (y !== undefined && y !== widestYesterday) expect(t).toBeUndefined();
      if (y === undefined) expect(t).toBeUndefined();
      if (t !== undefined && y === widestYesterday) stepped += 1;
      if (t === undefined && y === widestYesterday) dropped += 1;
    }
    expect(stepped).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  });

  test("7. both switches off: no new line, the Yesterday line and 'Last here' as before (the corpus replay in the PR proves byte identity with master)", () => {
    const k = store(at(D1, 7));
    episode(k, { session: S1, scope: HERE, title: "Sowing the broad beans", date: D1, hour: 9 });
    const own = memory(k, { scope: HERE, session: S1, date: D1, hour: 9, body: "Broad beans go in by the fence." });
    const morning = episode(k, { session: S2, scope: HERE, title: "Potting on the tomatoes", date: D2, hour: 9 });
    const newest = episode(k, { session: S3, scope: HERE, title: "Netting the brassicas", date: D2, hour: 11 });
    summary(k, D1, "A garden day.", [own]);
    S.TODAY_SO_FAR = false;
    S.YESTERDAY_FROM_SUMMARY = false;
    const off = wakeFor(k, HERE).text;
    expect(off).not.toContain(TODAY_SO_FAR_HEAD);
    expect(off).not.toContain(YESTERDAY_SUMMARY_WORDS);
    expect(lineStarting(off, "Yesterday: ")).toContain("Sowing the broad beans");
    // "Last here" names the newest and, as before, the one before it.
    expect(lineStarting(off, "Last here: ")).toContain(newest);
    expect(lineStarting(off, "Before it: ")).toContain(morning);
    // The same store, switched on, moves the earlier chapter to its own line.
    S.TODAY_SO_FAR = true;
    S.YESTERDAY_FROM_SUMMARY = true;
    const on = wakeFor(k, HERE).text;
    expect(lineStarting(on, `${TODAY_SO_FAR_HEAD} `)).toContain(morning);
    expect(on).not.toMatch(/^Before it: /m);
    expect(lineStarting(on, "Yesterday")).toStartWith(`Yesterday, ${YESTERDAY_SUMMARY_WORDS} A garden day.`);
  });

  test("withTodaySoFar: no line hands the Yesterday line back untouched; with one, its forms step down first, then the Yesterday line's", () => {
    const y = { yesterday: "Yesterday: A; B.", yesterdayShorter: ["Yesterday: A."] };
    expect(withTodaySoFar(y, [])).toEqual(y);
    expect(withTodaySoFar({}, [])).toEqual({});
    const got = withTodaySoFar(y, ["Today so far here: x — long; y — long.", "Today so far here: x; y."]);
    expect(got.yesterday).toBe("Yesterday: A; B.\nToday so far here: x — long; y — long.");
    expect(got.yesterdayShorter).toEqual(["Yesterday: A; B.\nToday so far here: x; y.", "Yesterday: A; B.", "Yesterday: A."]);
    expect(withTodaySoFar({}, ["Today so far here: x."])).toEqual({ yesterday: "Today so far here: x." });
  });
});
