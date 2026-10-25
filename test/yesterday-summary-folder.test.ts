/**
 * THE YESTERDAY SUMMARY'S FOLDER GAP (2026-10-25, Y1). Day's end's summary of
 * yesterday leads the Yesterday line only past a privacy gate
 * (`Counterpart#daySummaryShown`) that refuses any of the day's memories with
 * no folder recorded. A chapter's summary memory (`source: episode`,
 * `origin_ref` its chapter) was born with none — the chapter itself always
 * had one — so on every day with a chapter, which is every day, the gate
 * refused. Now:
 *
 *   1. WRITE SIDE: a chapter's summary records its chapter's folder, through
 *      the real doors — the `chapter` tool (a written summary) and the
 *      boundary's `ingestEpisode` (an automatic one);
 *   2. READ SIDE: a row written before that (no folder, `origin_ref` naming a
 *      chapter) is read as written in its chapter's folder — no migration —
 *      and still fails when the chapter has none either.
 *
 * Hermetic: every store is a temp dir made and removed here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { YESTERDAY_SUMMARY_WORDS } from "../src/core/handoff/last-here.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";
import { readableDate } from "../src/core/time.js";

const HOUR = 3_600_000;
const BUDGET = 9_000;
const D0 = "2026-10-22";
const D1 = "2026-10-23";
const D2 = "2026-10-24";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;

const S1 = "e1e2e3e4-0000-4000-8000-000000000001";
const S2 = "e1e2e3e4-0000-4000-8000-000000000002";
const S3 = "e1e2e3e4-0000-4000-8000-000000000003";
const READER = "f5f6f7f8-0000-4000-8000-00000000000f";
const NIGHT = "f5f6f7f8-0000-4000-8000-0000000000aa";

const S = SELF_TUNABLES as { YESTERDAY_FROM_SUMMARY: boolean };
const was = S.YESTERDAY_FROM_SUMMARY;

const CHAPTER =
  "We spent the morning on the broad beans with Mira: two rows by the fence, netted against the pigeons, the spare seed kept dry in the shed for a second sowing in three weeks.";
const SUMMARY = "Sowed two rows of broad beans by the fence with Mira, netted them, and kept spare seed for a second sowing.";
const TOLD = "A garden day: the broad beans went in by the fence, netted, with seed kept back for a second sowing.";

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
let PRIVATE: string;
let clock = at(D1, 7);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-y1-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  THERE = join(root, "site");
  PRIVATE = join(root, "ledger");
  for (const d of [HERE, THERE, PRIVATE]) mkdirSync(d, { recursive: true });
  clock = at(D1, 7);
  S.YESTERDAY_FROM_SUMMARY = true;
});

afterEach(() => {
  S.YESTERDAY_FROM_SUMMARY = was;
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** The MCP server a session in `scope` talks to — the real `chapter` door. */
function server(session: string, scope: string): McpServer {
  return new McpServer({ counterpart: brain(), session, scope, registryDir: join(root, "registry"), now: () => clock });
}

function brain(): Counterpart {
  const c = Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), now: () => clock, timeZone: "UTC" });
  open.push(c);
  return c;
}

/** A chapter written through the `chapter` tool in `scope` at `hour` on `date`; the summary memory's id (or null). */
async function chapterVia(o: { session: string; scope: string; date: string; hour: number; title: string; summary?: string }): Promise<{ episode: string; summary: string | null }> {
  clock = at(o.date, o.hour);
  const s = server(o.session, o.scope);
  const out = (await s.call("chapter", { text: CHAPTER, title: o.title, ...(o.summary === undefined ? {} : { summary: o.summary }) })).structuredContent;
  const episode = String(out["episodeId"]);
  const summaryId = s.counterpart.store.list({ type: "memory", source: "episode", originRef: episode, archived: false })[0] ?? null;
  s.counterpart.close();
  open.splice(open.indexOf(s.counterpart), 1);
  return { episode, summary: summaryId };
}

/** Day's end's summary about `about`, as the night's closing call records it. */
function told(c: Counterpart, about: string, cites: readonly string[]): void {
  c.recordPageWriterRun({ about, mode: "session", outcome: "nothing-to-say", summary: TOLD, summaryCites: cites, session: NIGHT, run: "run-y1" });
}

function wakeIn(c: Counterpart, scope: string, exportsFrom: (s: string) => boolean = () => true): string {
  clock = at(D2, 15);
  c.rebrief({ budgetBytes: BUDGET, at: D2 });
  return c.wake(BUDGET, { date: D2 }, { scope, session: READER, exportsFrom }).text;
}

const shown = (text: string): boolean => text.split("\n").some((l) => l.startsWith(`Yesterday, ${YESTERDAY_SUMMARY_WORDS} ${TOLD}`));

/** A chapter row in `scope` (or none) and a memory in the shape every chapter summary had before Y1: no folder, `origin_ref` the chapter. */
function legacy(c: Counterpart, o: { session: string; scope: string | null; date: string; hour: number; title: string; summaryOn?: { date: string; hour: number }; about?: "me" }): { episode: string; summary: string } {
  clock = at(o.date, o.hour);
  const episode = c.store.put({
    type: "episode",
    kind: "self",
    title: o.title,
    body: `## chapter 1 — ${readableDate(o.date)} · lived day 1\n\n${CHAPTER}\n`,
    meta: { sessionId: o.session, chapters: 1 },
    source: "episode",
    origin: { session: o.session, ...(o.scope === null ? {} : { scope: o.scope }) },
  });
  if (o.summaryOn !== undefined) clock = at(o.summaryOn.date, o.summaryOn.hour);
  const summary = c.store.put({
    type: "memory",
    kind: "self",
    body: SUMMARY,
    meta: { episodeId: episode, sessionId: o.session, chapter: 1, chapterSummary: "automatic" },
    source: "episode",
    origin: { session: o.session, ref: episode },
    ...(o.about === undefined ? {} : { about: o.about }),
  });
  return { episode, summary };
}

describe("write side: a chapter's summary records its chapter's folder", () => {
  test("through the `chapter` tool (a written summary): the memory carries the folder, and a wake there opens with day's end's words", async () => {
    const one = await chapterVia({ session: S1, scope: HERE, date: D1, hour: 9, title: "Sowing the broad beans", summary: SUMMARY });
    expect(one.summary).not.toBeNull();
    const c = brain();
    expect(c.store.row(one.summary as string)?.origin_scope).toBe(HERE);
    expect(c.store.row(one.episode)?.origin_scope).toBe(HERE);
    told(c, D1, [one.summary as string]);
    expect(shown(wakeIn(c, HERE))).toBe(true);
    // Switched off: the chapter list, as before.
    S.YESTERDAY_FROM_SUMMARY = false;
    expect(shown(wakeIn(c, HERE))).toBe(false);
  });

  test("through the boundary (an automatic summary, `ingestEpisode`): the memory carries the folder too", async () => {
    const one = await chapterVia({ session: S1, scope: HERE, date: D1, hour: 9, title: "Sowing the broad beans" });
    expect(one.summary).toBeNull();
    clock = at(D1, 10);
    const c = brain();
    const ingested = c.ingestEpisode({ sessionId: S1 });
    expect(ingested.summaries.length).toBe(1);
    const auto = ingested.summaries[0] as string;
    expect(c.store.readProse(auto).meta["chapterSummary"]).toBe("automatic");
    expect(c.store.row(auto)?.origin_scope).toBe(HERE);
    told(c, D1, []);
    expect(shown(wakeIn(c, HERE))).toBe(true);
  });

  test("a chapter written from a private folder still keeps the summary out of a wake elsewhere — now by its memory's folder as well as the chapter's", async () => {
    const own = await chapterVia({ session: S1, scope: HERE, date: D1, hour: 9, title: "Sowing the broad beans", summary: SUMMARY });
    const secret = await chapterVia({ session: S2, scope: PRIVATE, date: D1, hour: 11, title: "The quarterly figures", summary: "The quarter closed at a loss; the van repair did it." });
    const c = brain();
    expect(c.store.row(secret.summary as string)?.origin_scope).toBe(PRIVATE);
    told(c, D1, [own.summary as string]);
    expect(shown(wakeIn(c, HERE, (s) => s !== PRIVATE))).toBe(false);
    expect(shown(wakeIn(c, HERE))).toBe(true);
  });
});

describe("read side: a summary written before Y1 reads its chapter's folder", () => {
  test("a legacy row (no folder, origin_ref → a chapter in X) passes in X; in Y it passes only while X's scope setting is on", () => {
    const c = brain();
    const row = legacy(c, { session: S1, scope: HERE, date: D1, hour: 9, title: "Sowing the broad beans", about: "me" });
    expect(c.store.row(row.summary)?.origin_scope).toBeNull();
    told(c, D1, [row.summary]);
    expect(shown(wakeIn(c, HERE))).toBe(true);
    // In another folder: the summary cites an about-me memory from X, nameable there while X's scope setting is on.
    expect(shown(wakeIn(c, THERE))).toBe(true);
    expect(shown(wakeIn(c, THERE, (s) => s !== HERE))).toBe(false);
  });

  test("a legacy row whose chapter was written on an earlier day in a private folder (its summary written that day) keeps the summary out by the memory alone", () => {
    const c = brain();
    const own = legacy(c, { session: S1, scope: HERE, date: D1, hour: 9, title: "Sowing the broad beans" });
    // The chapter is D0's, so the gate's chapter check does not see it; its
    // automatic summary was written at a D1 boundary.
    legacy(c, { session: S3, scope: PRIVATE, date: D0, hour: 20, title: "The quarterly figures", summaryOn: { date: D1, hour: 8 } });
    told(c, D1, [own.summary]);
    expect(shown(wakeIn(c, HERE, (s) => s !== PRIVATE))).toBe(false);
    expect(shown(wakeIn(c, HERE))).toBe(true);
  });

  test("a legacy row whose chapter recorded no folder either still fails, as before", () => {
    const c = brain();
    const own = legacy(c, { session: S1, scope: HERE, date: D1, hour: 9, title: "Sowing the broad beans" });
    legacy(c, { session: S3, scope: null, date: D0, hour: 20, title: "An old chapter", summaryOn: { date: D1, hour: 8 } });
    told(c, D1, [own.summary]);
    expect(shown(wakeIn(c, HERE))).toBe(false);
  });
});
