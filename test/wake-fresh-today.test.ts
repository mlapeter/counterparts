/**
 * THE WAKE IS FRESH AT SESSION START, AND SAYS WHAT HAPPENED ELSEWHERE TODAY
 * (2026-10-10; Mike approved the two options that day, details b2's and
 * random-f8's, lightly held).
 *
 * A. The published bundle is composed at a turn-end — the evening before, for
 *    a morning's first sessions. Now "Still open", "Coming up:", the Yesterday
 *    line and the self page are read at session start, for the session's own
 *    date, and composed by the published rules (`ROOM_ORDER`, the page's
 *    ladder) around what the bundle showed of the stateful lanes. Reads only.
 * B. "Today, elsewhere": the other directories worked in today — when, live or
 *    ended, the chapter there (the "About me" line's gate), how many memories,
 *    and since 2026-10-20 (Mike's go, an experiment) the newest work title or
 *    two there. Never a span's words or a handoff from there; never this
 *    session's own directory.
 *
 * Pinned here:
 *   - a session started before any turn-end today gets today's Yesterday,
 *     Arriving, Still open and page, while the published bundle has none of
 *     them — and the delivery writes no state;
 *   - "Today, elsewhere" names another directory's live session, its gated
 *     chapter title, its memory count and a work memory's title (not its
 *     body), and never a work chapter, span text or a handoff body from it;
 *     its own directory, a directory whose scope is off, and the nightly
 *     run's directory are skipped;
 *   - the wake stays within its byte budget with the page's top and end
 *     lines intact;
 *   - the line gives way after "Nearby" and before anything else, and dated
 *     items still come before it (the composition, directly).
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { stampWords } from "../src/core/handoff/last-here.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
import { TODAY_ELSEWHERE_MAX_BYTES, chaptersOn, placeWords, todayElsewhereLines, yesterdayLine, yesterdayShorter } from "../src/core/handoff/last-here.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import {
  BRIEFING_KEY,
  FRAMING,
  PAGE_END_LINES,
  RENDERED_PREFIX,
  ROOM_ORDER,
  SELF_TUNABLES,
  THREADS_SHOWN_KEY,
  WAKE_SHOWN_KEY,
  readSentinel,
  render,
  wakeShown,
} from "../src/core/self/index.js";
import type { Ranked, Resolve } from "../src/core/self/index.js";
import { readableDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const BUDGET = 9_000;
/** The evening the last turn-end ran, and the morning after. */
const D1 = "2026-10-09";
const D2 = "2026-10-10";
const day = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`);
const at = (ymd: string, h: number, m = 0): number => day(ymd) + h * HOUR + m * MIN;

const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const B = "b5b6b7b8-0000-4000-8000-00000000000b";
const C = "c9cacbcc-0000-4000-8000-00000000000c";
const E = "e1e2e3e4-0000-4000-8000-00000000000e";
const F = "f1f2f3f4-0000-4000-8000-00000000000f";
const G = "a7a7a7a7-0000-4000-8000-000000000007";

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
let YON: string;
let FAR: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  // A short root (macOS's own temp path is ~50 bytes): the line names
  // directories by path, within `TODAY_ELSEWHERE_MAX_BYTES`.
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-wake-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  YON = join(root, "orchard");
  FAR = join(root, "ledger");
  for (const d of [HERE, THERE, YON, FAR]) mkdirSync(d, { recursive: true });
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

function store(start: number): { c: Counterpart; set(t: number): void } {
  let now = start;
  const c = Counterpart.open({ dir: storeDir, owner: true, budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  return {
    c,
    set(t: number): void {
      now = t;
    },
  };
}

/** An episode as the journal writes it, with a dated heading, put straight in. */
function episode(c: Counterpart, opts: { session: string; scope: string; title: string; date: string; text: string }): string {
  return c.store.put({
    type: "episode",
    kind: "self",
    title: opts.title,
    body: `## chapter 1 — ${readableDate(opts.date)} · lived day 1\n\n${opts.text}\n`,
    meta: { sessionId: opts.session, chapters: 1 },
    source: "episode",
    origin: { session: opts.session, scope: opts.scope },
  });
}

/** A chapter's memory copy, as ingestion mints it, with an `about` mark. */
function copy(c: Counterpart, epi: string, session: string, scope: string, about: "me" | "work" | null, body: string): string {
  return c.store.put({
    type: "memory",
    kind: "self",
    body,
    source: "episode",
    origin: { session, scope, ref: epi },
    ...(about === null ? {} : { about }),
  });
}

function tilde(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** The lines under a lane heading, up to the blank line that ends it. */
function lane(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.lastIndexOf(heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return out;
}

/** Every durable thing a delivery must not move. */
function stateOf(c: Counterpart): string {
  const s = c.store;
  return JSON.stringify({
    briefing: s.getMeta(BRIEFING_KEY),
    shown: s.getMeta(WAKE_SHOWN_KEY),
    threads: s.getMeta(THREADS_SHOWN_KEY),
    rendered: [...s.metaWithPrefix(RENDERED_PREFIX)],
    displays: [...s.wakeDisplays()],
    rows: s.countMemories({}),
    events: s.eventLog({ limit: 100_000 }).length,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// A. The morning's first session
// ═══════════════════════════════════════════════════════════════════════════

describe("a session started before any turn-end today reads today's lanes", () => {
  test("Yesterday, Arriving, Still open and the page are today's — the published bundle has none of them, and the delivery writes nothing", () => {
    const k = store(at(D1, 18));
    const { c } = k;
    c.revisePage("## Core\n\nI keep the garden's ledger and say what I do not know. Page version one.", { by: "owner", reason: "seed" });
    // Written in this session's own directory, so the gate on another
    // directory's titles (2026-10-11) names it here. Two of them since
    // 2026-10-20: the newer is "Last here"'s, and Yesterday names the other.
    k.set(at(D1, 10));
    episode(c, { session: C, scope: HERE, title: "Seedlings potted on", date: D1, text: "We potted on the seedlings." });
    k.set(at(D1, 18));
    episode(c, { session: A, scope: HERE, title: "Bread for the market stall", date: D1, text: "We baked for the stall and wrote down the timings." });
    // The evening's turn-end: the bundle a morning used to read.
    const rendered = c.rebrief({ budgetBytes: BUDGET, at: D1 });
    expect(rendered.published).toBe(true);
    expect(wakeShown(c.store)?.ceiling).toBe(BUDGET);
    // Later that evening, with no turn-end after them: an open question, a
    // reminder for tomorrow, and the page rewritten.
    k.set(at(D1, 21));
    const question = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Whether the north bed needs a second load of compost before the frost.",
      meta: { unresolved: true },
      salience: { relevance: 0.7, emotional: 0.4, predictive: 0.6 },
    });
    c.store.put({
      type: "memory",
      kind: "person",
      body: "The seed order goes out the morning of the tenth; the list is in the green folder.",
      eventDate: D2,
      salience: { relevance: 0.8, emotional: 0.8, predictive: 0.8 },
    });
    c.revisePage("## Core\n\nI keep the garden's ledger and say what I do not know. Page version two, written last night.", { by: "owner", reason: "revised" });
    const published = c.store.getMeta(BRIEFING_KEY) ?? "";
    for (const absent of ["north bed", "seed order", "Page version two", `Yesterday, ${stampWords(D1.slice(5))}`]) expect(published).not.toContain(absent);

    // The next morning, before any turn-end.
    k.set(at(D2, 8));
    const before = stateOf(c);
    const woke = c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B });
    expect(stateOf(c)).toBe(before);
    const text = woke.text;
    expect(woke.ok).toBe(true);
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    // Assembled at session start: no "composed at the last boundary" (2026-10-16).
    expect(text).not.toContain("composed at the last boundary");
    // Yesterday is the session's yesterday — said without its date at a
    // session start (2026-10-16); the published bundle's, below, is dated.
    expect(text).toContain("Yesterday: ");
    expect(text.split("\n").find((l) => l.startsWith("Yesterday: "))).toContain("Seedlings potted on");
    expect(text.split("\n").find((l) => l.startsWith("Last here: "))).toContain("Bread for the market stall");
    expect(text.split("Bread for the market stall").length - 1).toBe(1);
    // Still open and Arriving, as of now.
    expect(lane(text, FRAMING.threads).some((l) => l.endsWith("Whether the north bed needs a second load of compost before the frost."))).toBe(true);
    expect(lane(text, FRAMING.horizon).some((l) => l.includes("The seed order goes out the morning of the tenth"))).toBe(true);
    // The page as it is now, with its top and end lines.
    expect(text).toContain("Page version two, written last night.");
    expect(text).not.toContain("Page version one.");
    expect(text).toContain(PAGE_END_LINES.whole);
    expect(text).toContain("(My page, ");
    // The ring says what it cost.
    expect(c.events("counterpart.wake.assembled").length).toBe(1);
    // A read that is not a delivery still gets the published bundle, byte for byte.
    expect(c.wake(BUDGET).text).toBe(published);
    // The "since" line's "already in Still open" is THIS wake's list.
    expect(text.split("\n").filter((l) => l.includes(question)).length).toBeLessThanOrEqual(1);
  });

  test("no record of what the bundle showed, another ceiling, or no date: the published bundle, as before", () => {
    const k = store(at(D1, 18));
    const { c } = k;
    c.store.put({ type: "memory", kind: "fact", body: "A question left open overnight about the hedge.", meta: { unresolved: true } });
    c.rebrief({ budgetBytes: BUDGET, at: D1 });
    k.set(at(D1, 22));
    c.store.put({ type: "memory", kind: "fact", body: "A second question, about the gate latch.", meta: { unresolved: true } });
    k.set(at(D2, 8));
    // Another ceiling than the one the bundle was composed under.
    expect(c.wake(BUDGET + 500, { date: D2 }, { scope: HERE, session: B }).text).not.toContain("gate latch");
    // No date: nothing to assemble for.
    expect(c.wake(BUDGET, {}, { scope: HERE, session: B }).text).not.toContain("gate latch");
    // A record written beside another bundle than the one published now.
    const record = JSON.parse(c.store.getMeta(WAKE_SHOWN_KEY) ?? "{}") as Record<string, unknown>;
    expect(c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B }).text).toContain("gate latch");
    c.store.setMeta(WAKE_SHOWN_KEY, JSON.stringify({ ...record, hash: "0000000000000000" }));
    expect(c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B }).text).not.toContain("gate latch");
    // A bundle an older build published (no record).
    c.store.setMeta(WAKE_SHOWN_KEY, "");
    expect(c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B }).text).not.toContain("gate latch");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2. The Yesterday line's gate (2026-10-11)
// ═══════════════════════════════════════════════════════════════════════════

describe("the Yesterday line names another directory's titles on the About-me gate", () => {
  /**
   * Yesterday's chapters in five places: this directory (a work chapter), an
   * `on` directory about me, an `on` directory about work, an `off` directory
   * about me, and a confidential one about me in the `on` directory.
   */
  function yesterday(): { c: Counterpart; lc: Lifecycle; ids: Record<string, string> } {
    const k = store(at(D1, 9));
    const { c } = k;
    writeScopes(join(root, "scopes.json"), setScope(null, FAR, "off", { at: D1 }));
    const ids: Record<string, string> = {};
    const put = (key: string, session: string, scope: string, about: "me" | "work", hour: number, confidential = false): void => {
      k.set(at(D1, hour));
      const epi = c.store.put({
        type: "episode",
        kind: "self",
        title: `${key.toUpperCase()}TITLE chapter`,
        body: `## chapter 1 — ${readableDate(D1)} · lived day 1\n\nA placeholder chapter.\n`,
        meta: { sessionId: session, chapters: 1, ...(confidential ? { confidential: true } : {}) },
        source: "episode",
        origin: { session, scope },
      });
      copy(c, epi, session, scope, about, "A placeholder copy.");
      ids[key] = epi;
    };
    put("own", E, HERE, "work", 10);
    put("work", G, YON, "work", 11);
    put("aboutme", A, THERE, "me", 12);
    put("off", F, FAR, "me", 13);
    put("secret", C, THERE, "me", 14, true);
    // The evening's turn-end published the line store-wide; the morning's
    // session start reads it for THIS session.
    k.set(at(D2, 7));
    expect(c.rebrief({ budgetBytes: BUDGET, at: D2 }).published).toBe(true);
    k.set(at(D2, 8));
    const lc = new Lifecycle({ counterpart: c, config: { dataDir: storeDir }, configPath: join(root, "claude-code.json"), now: () => at(D2, 8) });
    return { c, lc, ids };
  }

  function lineOf(text: string): string | undefined {
    // At a session start the line is "Yesterday:" — the date is the `Now:`
    // line's (2026-10-16); the published bundle keeps it (below).
    return text.split("\n").find((l) => l.startsWith("Yesterday: "));
  }

  // The rest BY FOLDER since 2026-10-18 (the wake-polish builder; a bare
  // "and 2 more" / "N sessions in other projects" before): only a folder the
  // "Today, elsewhere" line may name, and the rest not said at all.
  test("its own directory's title, and another's only when about me with its scope on; the rest by folder where it may be named, never by id", () => {
    const y = yesterday();
    const text = y.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    // Assembled at session start: no "composed at the last boundary" (2026-10-16).
    expect(text).not.toContain("composed at the last boundary");
    // The work chapter's folder is `on`: named. The `off` one is not said.
    // This directory's own chapter is "Last here"'s since 2026-10-20 (each
    // episode once): named there, and not again here. The about-me chapter is
    // this line's, so the about-me line below leaves it out.
    expect(lineOf(text)).toBe(`Yesterday: "ABOUTMETITLE chapter" (${y.ids["aboutme"]}); and a session in ${placeWords(YON)}.`);
    expect(text.split("\n").find((l) => l.startsWith("Last here: "))).toContain(`(${y.ids["own"]})`);
    for (const once of [y.ids["own"] ?? "?", y.ids["aboutme"] ?? "?"]) expect(text.split(once).length - 1).toBe(1);
    expect(lineOf(text)).not.toContain(placeWords(FAR));
    for (const never of ["WORKTITLE", "OFFTITLE", "SECRETTITLE", y.ids["work"] ?? "?", y.ids["off"] ?? "?", y.ids["secret"] ?? "?"]) {
      expect(text).not.toContain(never);
    }
    expect(readSentinel(text).intact).toBe(true);
  });

  test("with no way to ask the scope setting only this directory's title is named; from a directory with none, there is no line", () => {
    const y = yesterday();
    // The Counterpart alone, with no host to ask: nothing crosses.
    const alone = y.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B }).text;
    // This directory's own title is "Last here"'s (2026-10-20), so with nothing
    // else nameable there is no Yesterday line; the chapter is named once.
    expect(lineOf(alone)).toBeUndefined();
    expect(alone.split("\n").find((l) => l.startsWith("Last here: "))).toContain(`"OWNTITLE chapter" (${y.ids["own"]})`);
    expect(alone.split(y.ids["own"] ?? "?").length - 1).toBe(1);
    // Somewhere that wrote nothing yesterday, with every directory closed.
    const NONE = join(root, "shed");
    const none = y.c.wake(BUDGET, { date: D2 }, { scope: NONE, session: B, exportsFrom: () => false }).text;
    expect(lineOf(none)).toBeUndefined();
    for (const never of ["TITLE chapter", "epi_", "other projects"]) expect(none).not.toContain(never);
    // With every directory open: the about-me chapters by title, the work
    // chapters by folder only.
    const open = y.c.wake(BUDGET, { date: D2 }, { scope: NONE, session: B, exportsFrom: () => true }).text;
    const folders = lineOf(open) ?? "";
    expect(folders).toBe(
      `Yesterday: "ABOUTMETITLE chapter" (${y.ids["aboutme"]}); "OFFTITLE chapter" (${y.ids["off"]}); and 2 sessions in ${placeWords(HERE)}, ${placeWords(YON)}.`,
    );
    for (const never of ["OWNTITLE", "WORKTITLE", "SECRETTITLE", y.ids["own"] ?? "?", y.ids["work"] ?? "?"]) expect(folders).not.toContain(never);
  });

  test("the published bundle, which no one session reads, keeps the store-wide line; the shorter forms never surface a hidden id", () => {
    const y = yesterday();
    // A read that is not a delivery: the turn-end's render, as it was (the
    // gate is the reader's, and the published bundle has none —
    // INTERFACE-GAPS self §14).
    const published = y.c.wake(BUDGET).text;
    for (const shown of ["OWNTITLE", "WORKTITLE", "ABOUTMETITLE", "OFFTITLE"]) expect(published).toContain(shown);
    expect(published).not.toContain("SECRETTITLE");
    // The shorter forms over the named two, with two counted.
    const named = chaptersOn(y.c.store, D1).filter((c) => c.id === y.ids["own"] || c.id === y.ids["aboutme"]);
    const shorter = yesterdayShorter(named, D1, [{ scope: YON, sessions: 2 }]);
    expect(shorter.length).toBeGreaterThan(0);
    for (const line of shorter) {
      // A title given up joins the count (2026-10-20), never left as a bare id.
      expect(line).toEndWith(`; and 1 more; 2 sessions in ${placeWords(YON)}.`);
      for (const hidden of [y.ids["work"], y.ids["off"], y.ids["secret"]]) expect(line).not.toContain(hidden ?? "?");
    }
    expect(yesterdayLine([], D1, undefined, [{ scope: YON, sessions: 1 }])).toBe(`Yesterday, ${stampWords(D1.slice(5))}: a session in ${placeWords(YON)}.`);
    // At a session start, without the date (2026-10-16).
    expect(yesterdayLine([], D1, undefined, [{ scope: YON, sessions: 1 }], false)).toBe(`Yesterday: a session in ${placeWords(YON)}.`);
    // Several folders: the most sessions first, each folder's count when more than one.
    expect(yesterdayLine([], D1, undefined, [{ scope: YON, sessions: 1 }, { scope: FAR, sessions: 2 }], false)).toBe(
      `Yesterday: 3 sessions in ${placeWords(FAR)} (2), ${placeWords(YON)}.`,
    );
    expect(yesterdayLine([], D1)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Today, elsewhere
// ═══════════════════════════════════════════════════════════════════════════

describe("Today, elsewhere", () => {
  /** The morning: sessions in four directories and the store's own, through the host's registry. */
  function morning(): { c: Counterpart; lc: Lifecycle; set(t: number): void; ids: Record<string, string> } {
    const k = store(at(D1, 18));
    const { c } = k;
    c.rebrief({ budgetBytes: BUDGET, at: D1 });
    const config = join(root, "claude-code.json");
    let now = at(D2, 10);
    const lc = new Lifecycle({ counterpart: c, config: { dataDir: storeDir }, configPath: config, now: () => now });
    writeScopes(join(root, "scopes.json"), setScope(null, FAR, "off", { at: D2 }));
    // THERE: a live session since 08:02, a chapter about me, a work memory, a
    // captured span and a handoff.
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8, 2) });
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "boundary", at: at(D2, 9, 50) });
    k.set(at(D2, 8, 30));
    const named = episode(c, { session: A, scope: THERE, title: "Why I bake before dawn", date: D2, text: "I like the bakery quiet." });
    copy(c, named, A, THERE, "me", "I bake before dawn because the quiet is mine.");
    // A newer chapter there, by another session, marked work: never named.
    k.set(at(D2, 9));
    const work = episode(c, { session: G, scope: THERE, title: "Oven seven calibration log", date: D2, text: "We calibrated oven seven." });
    copy(c, work, G, THERE, "work", "Oven seven runs eleven degrees hot; the offset is on the dial plate.");
    const worktitle = c.store.put({
      type: "memory",
      kind: "fact",
      title: "WORKTITLE-oven-seven-offset",
      body: "The proofing cabinet timer is set in minutes, not seconds.",
      about: "work",
      origin: { session: A, scope: THERE },
    });
    c.captureSpans({
      session: A,
      scope: THERE,
      turns: [
        { role: "user", text: "SPANWORDS the rye starter smells of apples this morning, is that fine?" },
        { role: "assistant", text: "SPANWORDS it is fine; that is the yeast." },
      ],
    });
    c.writeHandoff("HANDOFFBODY: the rye loaves need scoring before the second proof.", { scope: THERE, session: A });
    // YON: ended at 09:40, and the newest chapter about me — the "About me" line's.
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(D2, 8, 5) });
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "end", at: at(D2, 9, 40) });
    k.set(at(D2, 9, 30));
    const newest = episode(c, { session: C, scope: YON, title: "Pruning the old pear", date: D2, text: "I pruned the pear and felt calm." });
    copy(c, newest, C, YON, "me", "Pruning the old pear tree calms me.");
    // HERE: another session, live, and a memory — this session's own directory.
    recordSession(storeDir, { sessionId: E, scope: HERE, phase: "start", at: at(D2, 7, 30) });
    c.store.put({ type: "memory", kind: "fact", body: "The garden hose has a slow leak at the tap.", origin: { session: E, scope: HERE } });
    // FAR: scope off. The store's own directory: the nightly run.
    recordSession(storeDir, { sessionId: F, scope: FAR, phase: "start", at: at(D2, 8) });
    c.store.put({ type: "memory", kind: "fact", body: "LEDGERWORDS the quarter's receipts are filed.", origin: { session: F, scope: FAR } });
    recordSession(storeDir, { sessionId: "night-run-0000-4000-8000-000000000000", scope: storeDir, phase: "start", at: at(D2, 3) });
    // Yesterday's session elsewhere is not today's.
    recordSession(storeDir, { sessionId: "d0d0d0d0-0000-4000-8000-00000000000d", scope: YON, phase: "start", at: at(D1, 15) });
    k.set(at(D2, 10));
    return {
      c,
      lc,
      set(t: number): void {
        now = t;
        k.set(t);
      },
      ids: { named, work, newest, worktitle },
    };
  }

  function lineOf(text: string): string | undefined {
    return text.split("\n").find((l) => l.startsWith("Today, elsewhere: "));
  }

  test("another directory's live session, its gated chapter title, its memory count and its work title — never a work chapter, a body, a span's words or a handoff", () => {
    const m = morning();
    const text = m.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    const line = lineOf(text);
    expect(line).toBe(
      `Today, elsewhere: ${tilde(THERE)} open since 08:02 (live) — "Why I bake before dawn" (${m.ids["named"]}), 3 memories: "WORKTITLE-oven-seven-offset" (${m.ids["worktitle"]}); ` +
        `${tilde(YON)} 08:05–09:40, 1 memory.`,
    );
    // The newest chapter about me is the "About me" line's, and not named twice.
    expect(text).toContain(`A chapter about me from ${tilde(YON)}: session c9cacbcc, Oct 10 — "Pruning the old pear"`);
    expect(text.split("\n").filter((l) => l.includes("Pruning the old pear"))).toHaveLength(1);
    // What stays where it was made, anywhere in the wake.
    expect(text.split("\n").filter((l) => l.includes("WORKTITLE"))).toEqual([line as string]);
    for (const never of ["Oven seven calibration log", "SPANWORDS", "HANDOFFBODY", "LEDGERWORDS", "proofing cabinet"]) {
      expect(text).not.toContain(never);
    }
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    // It sits above "Nearby" when there is one, and after every lane above it.
    const lines = text.split("\n");
    const nearby = lines.indexOf(FRAMING.hints);
    if (nearby >= 0) expect(lines.indexOf(line as string)).toBeLessThan(nearby);
  });

  test("when this directory holds the newest chapter about me, the About-me line names the next, and the line does not name it again", () => {
    const m = morning();
    m.set(at(D2, 9, 45));
    const mine = episode(m.c, { session: E, scope: HERE, title: "Weeding the herb bed", date: D2, text: "I weeded the herb bed slowly." });
    copy(m.c, mine, E, HERE, "me", "Weeding the herb bed slowly is how I think.");
    m.set(at(D2, 10));
    const text = m.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    expect(text).toContain(`A chapter about me from ${tilde(YON)}: session c9cacbcc, Oct 10 — "Pruning the old pear"`);
    expect(text.split("\n").filter((l) => l.includes("Pruning the old pear"))).toHaveLength(1);
    expect(lineOf(text)).toContain(`${tilde(YON)} 08:05–09:40, 1 memory`);
    expect(lineOf(text)).not.toContain("Weeding the herb bed");
  });

  test("its own directory, a directory whose scope is off, the nightly run's, and yesterday's sessions are skipped", () => {
    const m = morning();
    const line = lineOf(m.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text) ?? "";
    expect(line).not.toContain(tilde(HERE));
    expect(line).not.toContain(tilde(FAR));
    expect(line).not.toContain(tilde(storeDir));
    // From THERE, THERE is skipped and HERE is named — and its own session is not.
    const there = lineOf(m.lc.composeWake({ sessionId: A, scope: THERE, at: D2 }, BUDGET).text) ?? "";
    expect(there).not.toContain(tilde(THERE));
    expect(there).toContain(`${tilde(HERE)} open since 07:30 (live), 1 memory`);
  });

  test("an observer folder, a paused one and a folder under an off one are not named; a confidential chapter's title stays home (review of #376)", () => {
    const k = store(at(D1, 18));
    const { c } = k;
    c.rebrief({ budgetBytes: BUDGET, at: D1 });
    const WATCH = join(root, "greenhouse");
    const REST = join(root, "cellar");
    const UNDER = join(FAR, "drawer");
    for (const d of [WATCH, REST, UNDER]) mkdirSync(d, { recursive: true });
    let reg = setScope(null, FAR, "off", { at: D2 });
    reg = setScope(reg, WATCH, "observer", { at: D2 });
    reg = setScope(reg, REST, "paused", { at: D2 });
    writeScopes(join(root, "scopes.json"), reg);
    const places: [string, string][] = [
      [WATCH, "a7a7a7a1"],
      [REST, "a7a7a7a2"],
      [UNDER, "a7a7a7a3"],
      [THERE, "a7a7a7a4"],
    ];
    k.set(at(D2, 8, 30));
    let thereMemory = "";
    for (const [scope, head] of places) {
      const session = `${head}-0000-4000-8000-000000000001`;
      recordSession(storeDir, { sessionId: session, scope, phase: "start", at: at(D2, 8) });
      // THERE's chapter is confidential; the others' are not, but their folders are not on.
      const epi = c.store.put({
        type: "episode",
        kind: "self",
        title: `KEPTHOME chapter in ${head}`,
        body: `## chapter 1 — ${readableDate(D2)} · lived day 1\n\nA placeholder chapter.\n`,
        meta: { sessionId: session, chapters: 1, ...(scope === THERE ? { confidential: true } : {}) },
        source: "episode",
        origin: { session, scope },
      });
      copy(c, epi, session, scope, "me", "A placeholder copy about me.");
      const id = c.store.put({ type: "memory", kind: "fact", body: "A placeholder memory.", origin: { session, scope } });
      if (scope === THERE) thereMemory = id;
    }
    k.set(at(D2, 10));
    const lc = new Lifecycle({ counterpart: c, config: { dataDir: storeDir }, configPath: join(root, "claude-code.json"), now: () => at(D2, 10) });
    const text = lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    const line = lineOf(text) ?? "";
    for (const kept of [WATCH, REST, FAR]) expect(line).not.toContain(tilde(kept));
    expect(text).not.toContain("KEPTHOME");
    expect(line).toBe(`Today, elsewhere: ${tilde(THERE)} open since 08:00 (live), 2 memories: "A placeholder memory." (${thereMemory}).`);
  });

  test("with no way to ask the scope setting, or every directory closed, nothing crosses", () => {
    const m = morning();
    // The Counterpart alone, with no host to ask: no line.
    expect(lineOf(m.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B }).text)).toBeUndefined();
    // Asked, but every directory is closed: no line.
    expect(lineOf(m.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B, exportsFrom: () => false }).text)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The budget, the page's lines, and who gives way
// ═══════════════════════════════════════════════════════════════════════════

describe("the assembled wake keeps its budget and its order", () => {
  test("a long page, many open questions and the elsewhere line: within budget, the page's top and end lines intact", () => {
    const k = store(at(D1, 18));
    const { c } = k;
    const para = "I keep the garden's ledger, I name what I do not know before I guess, and I write down what held.";
    let page = "## Core\n\n";
    while (bytes(page) < 5_600) page += `${para}\n\n`;
    expect(c.revisePage(page.trim(), { by: "owner", reason: "a long page" }).written).toBe(true);
    for (let i = 0; i < 20; i += 1) {
      c.store.put({ type: "memory", kind: "fact", body: `Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn, or whether the soil test says it can wait.`, meta: { unresolved: true } });
    }
    c.rebrief({ budgetBytes: BUDGET, at: D1 });
    k.set(at(D2, 9));
    let now = at(D2, 9);
    const lc = new Lifecycle({ counterpart: c, config: { dataDir: storeDir }, configPath: join(root, "claude-code.json"), now: () => now });
    for (let i = 0; i < 6; i += 1) {
      const scope = join(root, `plot-${String(i)}`);
      recordSession(storeDir, { sessionId: `a1b2c3d${String(i)}-0000-4000-8000-00000000000a`, scope, phase: "start", at: at(D2, 7, i) });
      c.store.put({ type: "memory", kind: "fact", body: `Plot ${String(i)} was weeded this morning.`, origin: { session: A, scope } });
    }
    now = at(D2, 9, 5);
    const text = lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    // Assembled at session start: no "composed at the last boundary" (2026-10-16).
    expect(text).not.toContain("composed at the last boundary");
    const lines = text.split("\n");
    const top = lines.findIndex((l) => l.startsWith("(My page, "));
    expect(top).toBeGreaterThan(-1);
    expect(lines).toContain(PAGE_END_LINES.whole);
    expect(lines.indexOf(PAGE_END_LINES.whole)).toBeGreaterThan(top);
    // Still open keeps its first item beside the page.
    expect(lane(text, FRAMING.threads)[0]).toStartWith("- ");
    // The line prints beside it, within its cap, the folders past it counted.
    const line = lines.find((l) => l.startsWith("Today, elsewhere: "));
    expect(line).toBeDefined();
    expect(bytes(line ?? "")).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    expect(line).toMatch(/; \+\d+ more\.$/);
  });

  test("ROOM_ORDER: the line ranks above Nearby, Still open past its first item and the delivery's rooms, and below every dated item; they trim around it, and it steps down for what outranks it (review of #380)", () => {
    expect(ROOM_ORDER.indexOf("elsewhere")).toBeGreaterThan(ROOM_ORDER.indexOf("handoffs"));
    expect(ROOM_ORDER.indexOf("elsewhere")).toBeLessThan(ROOM_ORDER.indexOf("arriving"));
    const ranked = (id: string, lane: Ranked["lane"], due = false): Ranked => ({
      id,
      lane,
      kind: "fact",
      band: "semantic",
      strength: 0.5,
      protected: false,
      bornDay: 1,
      personScoped: false,
      lastRendered: -1,
      ...(due ? { due: true } : {}),
    });
    const words = (id: string): string => `${id}: ${"a plain line of placeholder words about the garden and its beds ".repeat(2).trim()}.`;
    const resolve: Resolve = (id) => ({ statement: words(id), learnedOn: "2026-10-09" });
    const lanes = {
      identity: [],
      craft: [],
      threads: ["t1", "t2", "t3"].map((id) => ranked(id, "threads")),
      hints: ["h1", "h2", "h3"].map((id) => ranked(id, "hints")),
      horizon: [ranked("d1", "horizon", true)],
    };
    const away = `Today, elsewhere: ~/bakery open since 08:02 (live) — "${"A chapter title of some length ".repeat(3).trim()}" (epi_0123456789ab), 3 memories.`;
    const bare = "Today, elsewhere: ~/bakery open since 08:02 (live), 3 memories.";
    const without = render(lanes, { budgetBytes: 100_000, day: 2 }, resolve, SELF_TUNABLES);
    const full = render(lanes, { budgetBytes: 100_000, day: 2, elsewhere: away, elsewhereShorter: [bare] }, resolve, SELF_TUNABLES);
    expect(full.elsewhere).toBe(away);
    expect(full.text.indexOf(away)).toBeLessThan(full.text.indexOf(FRAMING.hints));
    // A form past the cap is never printed.
    const long = `Today, elsewhere: ${"~/a-long-folder-name; ".repeat(20)}.`;
    expect(render(lanes, { budgetBytes: 100_000, day: 2, elsewhere: long, elsewhereShorter: [bare] }, resolve, SELF_TUNABLES).elsewhere).toBe(bare);
    // Down a sweep of budgets: the line keeps its widest form while Nearby
    // and Still open past its first item give way around it; it steps down
    // only for what outranks it — the due-day reminder, Still open's first
    // item — and neither is left unlisted for it.
    let sawLanesTrimmed = false;
    let sawStepped = false;
    for (let budget = without.bytes + bytes(away); budget > 300; budget -= 7) {
      const r = render(lanes, { budgetBytes: budget, day: 2, elsewhere: away, elsewhereShorter: [bare] }, resolve, SELF_TUNABLES);
      expect(r.bytes).toBeLessThanOrEqual(budget);
      const alone = render(lanes, { budgetBytes: budget, day: 2 }, resolve, SELF_TUNABLES);
      // The reminder and Still open's first item are never unlisted for the
      // line: when the line prints and one of them does not, it would not
      // fit without the line either.
      if (r.elsewhere !== undefined && r.kept.horizon.length === 0) expect(alone.kept.horizon).toEqual([]);
      if (r.elsewhere !== undefined && r.kept.threads.length === 0) expect(alone.kept.threads).toEqual([]);
      // Narrower than its widest only once Nearby is gone and Still open is
      // down to its first item.
      if (r.elsewhere !== away) {
        expect(r.kept.hints.length).toBe(0);
        expect(r.kept.threads.length).toBeLessThanOrEqual(1);
      }
      const lanesShort = r.kept.threads.length < 3 || r.kept.hints.length < 3;
      if (lanesShort && r.elsewhere === away && (r.kept.threads.length > 1 || r.kept.hints.length > 0)) sawLanesTrimmed = true;
      // Stepped down for what outranks it: a narrower line, or none, with the reminder listed.
      if (r.elsewhere !== away && r.kept.horizon.length === 1) sawStepped = true;
    }
    expect(sawLanesTrimmed).toBe(true);
    expect(sawStepped).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Its own room (b2 + random-f8, 2026-10-10, lightly held)
// ═══════════════════════════════════════════════════════════════════════════

describe("the line has a small room of its own, and the page keeps its own", () => {
  /**
   * THE OWNER'S MORNING, AS THE TEST-BUILD REHEARSAL MET IT: a ~5.9 KB page,
   * 25 open questions, four handoffs here, a plain reminder due today, at
   * 9,000 bytes — where the line used to be the first thing cut after Nearby.
   */
  function ownerMorning(): { c: Counterpart; lc: Lifecycle } {
    const k = store(at(D1, 18));
    const { c } = k;
    const para = "I keep the garden's ledger, I name what I do not know before I guess, and I write down what held.";
    let page = "## Core\n\n";
    while (bytes(page) < 5_900) page += `${para}\n\n`;
    expect(c.revisePage(page.trim(), { by: "owner", reason: "a long page" }).written).toBe(true);
    // Lanes that fill the room: ~250-byte open questions, craft and Nearby.
    const long = (s: string): string => {
      let body = s;
      while (body.length < 230) body += ", or whether the thin coat holds for one more round";
      return `${body}.`;
    };
    for (let i = 0; i < 25; i += 1) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: long(`Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn`),
        salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
        meta: { unresolved: true },
      });
    }
    for (let i = 0; i < 12; i += 1) {
      c.store.put({ type: "memory", kind: "skill", body: long(`Craft ${String(i)}: the hose wants draining before a frost`), salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 } });
      c.store.put({ type: "memory", kind: "fact", body: long(`Nearby ${String(i)}: the compost heap by the shed runs warm`), salience: { relevance: 0.6, emotional: 0.4, predictive: 0.4 } });
    }
    for (let i = 0; i < 4; i += 1) {
      c.writeHandoff(`Handoff ${String(i)}: the seed trays on bench two need thinning. Then the watering log wants today's readings.`, {
        scope: HERE,
        session: `garden-bench-session-${String(i)}`,
      });
    }
    c.store.put({
      type: "memory",
      kind: "person",
      body: "Remind him today that the seed order closes at noon; the list is in the green folder.",
      learnedOn: D1,
      eventDate: D2,
      salience: { relevance: 0.8, emotional: 0.8, predictive: 0.8 },
      meta: { [CUE_MODE_META]: "plain" },
    });
    c.rebrief({ budgetBytes: BUDGET, at: D1 });
    k.set(at(D2, 9));
    const lc = new Lifecycle({ counterpart: c, config: { dataDir: storeDir }, configPath: join(root, "claude-code.json"), now: () => at(D2, 9, 5) });
    return { c, lc };
  }

  /** The page's block in a wake: its top line through its end line. */
  function pageBytes(text: string): number {
    const ls = text.split("\n");
    const from = ls.findIndex((l) => l.startsWith("(My page, "));
    const to = ls.indexOf(PAGE_END_LINES.whole);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return bytes(ls.slice(from, to + 1).join("\n"));
  }

  test("at 9,000 with a ~5.9 KB page, four handoffs and another active folder, the line prints within its cap — the page's lines and the due reminder intact", () => {
    const m = ownerMorning();
    // No other folder yet: no line, and nothing reserved — the wake is
    // exactly what it is with no host to ask.
    const quiet = m.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET);
    const alone = m.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B });
    expect(quiet.text.split("\n").some((l) => l.startsWith("Today, elsewhere: "))).toBe(false);
    expect(quiet.text).toBe(alone.text);
    // Another folder at work this morning.
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8, 2) });
    const flour = m.c.store.put({ type: "memory", kind: "fact", body: "The bakery's flour arrived.", origin: { session: A, scope: THERE } });
    const text = m.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    const line = text.split("\n").find((l) => l.startsWith("Today, elsewhere: "));
    expect(line).toBe(`Today, elsewhere: ${tilde(THERE)} open since 08:02 (live), 1 memory: "The bakery's flour arrived." (${flour}).`);
    expect(bytes(line ?? "")).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    // The page keeps its top and end lines and gives none of its room: it
    // and its borrowing outrank the line (review of #380).
    expect(pageBytes(text)).toBe(pageBytes(quiet.text));
    // Still open keeps its first item beside it.
    expect(lane(text, FRAMING.threads)[0]).toStartWith("- ");
    // The due-day plain reminder is still listed, and the handoffs still point the way.
    expect(lane(text, FRAMING.horizon).some((l) => l.includes("the seed order closes at noon"))).toBe(true);
    expect(text).toContain("garden-b");
  });

  test("a session that started yesterday and is active today says its start with the day", () => {
    const dirs = [
      { scope: "/home/someone/overnight", firstAt: at(D1, 9, 8), lastAt: at(D2, 8, 40), live: true, chapter: null, memories: 0 },
      { scope: "/home/someone/finished", firstAt: at(D1, 22, 15), lastAt: at(D2, 1, 5), live: false, chapter: null, memories: 0 },
      { scope: "/home/someone/today", firstAt: at(D2, 7, 30), lastAt: at(D2, 8, 0), live: false, chapter: null, memories: 0 },
    ];
    const line = todayElsewhereLines(dirs, ZONE)?.line ?? "";
    expect(line).toContain("~/overnight open since 10-09 09:08 (live)");
    expect(line).toContain("~/finished 10-09 22:15–01:05");
    expect(line).toContain("~/today 07:30–08:00");
  });

  test("many folders: the line stays within its cap, the rest as \"+N more\"", () => {
    const dirs = Array.from({ length: 9 }, (_, i) => ({
      scope: `/home/someone/projects/a-rather-long-folder-name-${String(i)}`,
      firstAt: at(D2, 7, i),
      lastAt: at(D2, 8, i),
      live: i % 2 === 0,
      chapter: null,
      memories: i + 1,
    }));
    const lines = todayElsewhereLines(dirs, ZONE);
    expect(lines).not.toBeNull();
    const all = [lines?.line ?? "", ...(lines?.shorter ?? [])];
    for (const form of all) expect(bytes(form)).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    expect(lines?.line).toMatch(/; \+\d+ more\.$/);
    // The named and the counted add up to every folder.
    const named = (lines?.line ?? "").split("; ").filter((p) => p.includes("a-rather-long-folder-name-")).length;
    const more = Number(/\+(\d+) more\.$/.exec(lines?.line ?? "")?.[1] ?? "0");
    expect(named).toBeGreaterThan(0);
    expect(named + more).toBe(9);
    // Each shorter form is narrower than the one before; the last is the count alone.
    for (let i = 1; i < all.length; i += 1) expect(bytes(all[i] ?? "")).toBeLessThan(bytes(all[i - 1] ?? ""));
    expect(all[all.length - 1]).toBe("Today, elsewhere: 9 other projects.");
  });
});
