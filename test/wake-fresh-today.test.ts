/**
 * THE WAKE IS FRESH AT SESSION START, AND SAYS WHAT HAPPENED ELSEWHERE TODAY
 * (2026-10-10; Mike approved the two options that day, details b2's and
 * random-f8's, lightly held).
 *
 * A. The published bundle is composed at a turn-end — the evening before, for
 *    a morning's first sessions. Now "Still open", "Arriving:", the Yesterday
 *    line and the self page are read at session start, for the session's own
 *    date, and composed by the published rules (`ROOM_ORDER`, the page's
 *    ladder) around what the bundle showed of the stateful lanes. Reads only.
 * B. "Today, elsewhere": the other directories worked in today — when, live or
 *    ended, the chapter there (the "About me" line's gate), and how many
 *    memories, as counts. Never a span's words, a work memory's title, or a
 *    handoff from there; never this session's own directory.
 *
 * Pinned here:
 *   - a session started before any turn-end today gets today's Yesterday,
 *     Arriving, Still open and page, while the published bundle has none of
 *     them — and the delivery writes no state;
 *   - "Today, elsewhere" names another directory's live session, its gated
 *     chapter title and its memory count, and never a work memory's title,
 *     span text or a handoff body from it; its own directory, a directory
 *     whose scope is off, and the nightly run's directory are skipped;
 *   - the wake stays within its byte budget with the page's top and end
 *     lines intact;
 *   - the line gives way after "Nearby" and before anything else, and dated
 *     items still come before it (the composition, directly).
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-wake-fresh-")));
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
    episode(c, { session: A, scope: THERE, title: "Bread for the market stall", date: D1, text: "We baked for the stall and wrote down the timings." });
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
    for (const absent of ["north bed", "seed order", "Page version two", `Yesterday, ${D1.slice(5)}`]) expect(published).not.toContain(absent);

    // The next morning, before any turn-end.
    k.set(at(D2, 8));
    const before = stateOf(c);
    const woke = c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B });
    expect(stateOf(c)).toBe(before);
    const text = woke.text;
    expect(woke.ok).toBe(true);
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    expect(text).toContain("assembled at session start");
    // Yesterday is the session's yesterday.
    expect(text).toContain(`Yesterday, ${D1.slice(5)}: `);
    expect(text).toContain("Bread for the market stall");
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
    // A bundle an older build published (no record).
    c.store.setMeta(WAKE_SHOWN_KEY, "");
    expect(c.wake(BUDGET, { date: D2 }, { scope: HERE, session: B }).text).not.toContain("gate latch");
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
    c.store.put({
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
      ids: { named, work, newest },
    };
  }

  function lineOf(text: string): string | undefined {
    return text.split("\n").find((l) => l.startsWith("Today, elsewhere: "));
  }

  test("another directory's live session, its gated chapter title and its memory count — never a work title, a span's words or a handoff", () => {
    const m = morning();
    const text = m.lc.composeWake({ sessionId: B, scope: HERE, at: D2 }, BUDGET).text;
    const line = lineOf(text);
    expect(line).toBe(
      `Today, elsewhere: ${tilde(THERE)} open since 08:02 (live) — "Why I bake before dawn" (${m.ids["named"]}), 3 memories; ` +
        `${tilde(YON)} 08:05–09:40, 1 memory.`,
    );
    // The newest chapter about me is the "About me" line's, and not named twice.
    expect(text).toContain(`About me, from another directory: session c9cacbcc, 10-10 in ${tilde(YON)} — "Pruning the old pear"`);
    expect(text.split("\n").filter((l) => l.includes("Pruning the old pear"))).toHaveLength(1);
    // What stays where it was made, anywhere in the wake.
    for (const never of ["WORKTITLE", "Oven seven calibration log", "SPANWORDS", "HANDOFFBODY", "LEDGERWORDS", "proofing cabinet"]) {
      expect(text).not.toContain(never);
    }
    expect(readSentinel(text).intact).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    // It sits above "Nearby" when there is one, and after every lane above it.
    const lines = text.split("\n");
    const nearby = lines.indexOf(FRAMING.hints);
    if (nearby >= 0) expect(lines.indexOf(line as string)).toBeLessThan(nearby);
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
    expect(text).toContain("assembled at session start");
    const lines = text.split("\n");
    const top = lines.findIndex((l) => l.startsWith("(My page, "));
    expect(top).toBeGreaterThan(-1);
    expect(lines).toContain(PAGE_END_LINES.whole);
    expect(lines.indexOf(PAGE_END_LINES.whole)).toBeGreaterThan(top);
    // Still open keeps its first item beside the page.
    expect(lane(text, FRAMING.threads)[0]).toStartWith("- ");
    const line = lines.find((l) => l.startsWith("Today, elsewhere: "));
    if (line !== undefined) expect(line).toContain("1 more directory");
  });

  test("ROOM_ORDER: the line gives way after Nearby and before every other lane; a dated item before it", () => {
    expect(ROOM_ORDER.indexOf("elsewhere")).toBe(ROOM_ORDER.indexOf("hints") + 1);
    const ranked = (id: string, lane: Ranked["lane"]): Ranked => ({
      id,
      lane,
      kind: "fact",
      band: "semantic",
      strength: 0.5,
      protected: false,
      bornDay: 1,
      personScoped: false,
      lastRendered: -1,
    });
    const words = (id: string): string => `${id}: ${"a plain line of placeholder words about the garden and its beds ".repeat(2).trim()}.`;
    const resolve: Resolve = (id) => ({ statement: words(id), learnedOn: "2026-10-09" });
    const lanes = {
      identity: [],
      craft: [],
      threads: ["t1", "t2", "t3"].map((id) => ranked(id, "threads")),
      hints: ["h1", "h2", "h3"].map((id) => ranked(id, "hints")),
      horizon: [ranked("d1", "horizon")],
    };
    const away = `Today, elsewhere: ~/bakery open since 08:02 (live) — "${"A chapter title of some length ".repeat(3).trim()}" (epi_0123456789ab), 3 memories.`;
    const bare = "Today, elsewhere: ~/bakery open since 08:02 (live), 3 memories.";
    const without = render(lanes, { budgetBytes: 100_000, day: 2 }, resolve, SELF_TUNABLES);
    const full = render(lanes, { budgetBytes: 100_000, day: 2, elsewhere: away, elsewhereShorter: [bare] }, resolve, SELF_TUNABLES);
    expect(full.elsewhere).toBe(away);
    expect(full.text.indexOf(away)).toBeLessThan(full.text.indexOf(FRAMING.hints));
    // Down a sweep of budgets: threads and the dated item are never cut while
    // the line or a hint still prints; hints go before the line's titles,
    // the titles before the line.
    let sawBare = false;
    let sawNone = false;
    for (let budget = without.bytes + bytes(away); budget > without.bytes - 600; budget -= 7) {
      const r = render(lanes, { budgetBytes: budget, day: 2, elsewhere: away, elsewhereShorter: [bare] }, resolve, SELF_TUNABLES);
      expect(r.bytes).toBeLessThanOrEqual(budget);
      const hints = r.kept.hints.length;
      if (r.elsewhere !== undefined) {
        expect(r.kept.threads.length).toBe(3);
        expect(r.kept.horizon.length).toBe(1);
      }
      if (r.elsewhere === bare) {
        sawBare = true;
        expect(hints).toBe(0);
      }
      if (r.elsewhere === undefined) sawNone = true;
      if (r.kept.threads.length < 3) expect(r.elsewhere).toBeUndefined();
      if (r.elsewhere === away && hints < 3) expect(r.kept.threads.length).toBe(3);
    }
    expect(sawBare).toBe(true);
    expect(sawNone).toBe(true);
  });
});
