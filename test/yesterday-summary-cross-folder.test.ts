/**
 * YESTERDAY'S DAY SUMMARY MAY MENTION OTHER FOLDERS' WORK (2026-10-25, Y2;
 * Mike's go, lightly held). Day's end tells the WHOLE day, so for someone who
 * works across folders its summary cites work from several. Until Y2 the
 * Yesterday gate (`Counterpart#daySummaryShown`) let a cite cross folders
 * only when it was marked about me, us or the owner: on the 10-25 snapshot,
 * 10-24 fell back in ~/counterparts because day's end cited one ~/motelier
 * memory marked `work`. Now a cite crosses on its folder alone, by the same
 * rule as the day's chapters and memories: this folder, or one whose scope
 * setting is on.
 *
 * Still blocked, and the wake falls back to the chapter list: a cite (or a
 * chapter, or a memory, that day) from a folder the owner turned off or
 * paused; a denied cite; a cite with no folder; and anything from another
 * folder when there is no way to read the scope setting.
 *
 * Every case runs through the real door: the `chapter` tool writes the
 * chapters, the host's scopes file says which folders are off, and the wake
 * is the one `ClaudeCodeAdapter#sessionStart` hands the session.
 *
 * Hermetic: every store is a temp dir made and removed here; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode, ScopeVerdict } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { YESTERDAY_SUMMARY_WORDS } from "../src/core/handoff/last-here.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";

const HOUR = 3_600_000;
const BUDGET = 9_000;
const DA = "2026-10-20";
const DB = "2026-10-21";
const D0 = "2026-10-22";
const D1 = "2026-10-23";
const D2 = "2026-10-24";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;

const S1 = "a7a7a7a7-0000-4000-8000-000000000001";
const S2 = "a7a7a7a7-0000-4000-8000-000000000002";
const S3 = "a7a7a7a7-0000-4000-8000-000000000003";
const S4 = "a7a7a7a7-0000-4000-8000-000000000004";
const READER = "b8b8b8b8-0000-4000-8000-00000000000f";
const NIGHT = "b8b8b8b8-0000-4000-8000-0000000000aa";

const S = SELF_TUNABLES as { YESTERDAY_FROM_SUMMARY: boolean };
const was = S.YESTERDAY_FROM_SUMMARY;

const CHAPTER =
  "We spent the morning on the broad beans: two rows by the fence, netted against the pigeons, the spare seed kept dry in the shed for a second sowing in three weeks.";
const TOLD = "A full day: the broad beans went in by the fence, and the bakery's oven schedule was worked out for the winter.";

let root: string;
let storeDir: string;
let config: string;
/** The reader's folder. */
let HERE: string;
/** Another folder whose work day's end cites. */
let BAKERY: string;
let clock = at(D1, 7);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-y2-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  BAKERY = join(root, "bakery");
  for (const d of [HERE, BAKERY]) mkdirSync(d, { recursive: true });
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

function brain(selfTunables?: { HINTS_IN_WAKE: boolean }): Counterpart {
  const c = Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), budgetBytes: BUDGET, now: () => clock, timeZone: "UTC", ...(selfTunables === undefined ? {} : { selfTunables }) });
  open.push(c);
  return c;
}

/** A chapter written through the real `chapter` tool in `scope`; its id. */
async function chapterVia(o: { session: string; scope: string; date: string; hour: number; title: string }): Promise<string> {
  clock = at(o.date, o.hour);
  const c = brain();
  const s = new McpServer({ counterpart: c, session: o.session, scope: o.scope, registryDir: join(root, "registry"), now: () => clock });
  const out = (await s.call("chapter", { text: CHAPTER, title: o.title, summary: `${o.title}, done.` })).structuredContent;
  c.close();
  open.splice(open.indexOf(c), 1);
  return String(out["episodeId"]);
}

/** A memory as `remember` files it: in `scope`, at `hour` on `date`. */
function memory(c: Counterpart, o: { scope: string; session: string; date: string; hour: number; body: string; about?: "me" | "work" }): string {
  clock = at(o.date, o.hour);
  return c.store.put({ type: "memory", kind: "fact", body: o.body, origin: { session: o.session, scope: o.scope }, ...(o.about === undefined ? {} : { about: o.about }) });
}

/** Day's end's summary of `about`, as the night's closing call records it. */
function told(c: Counterpart, about: string, cites: readonly string[]): void {
  c.recordPageWriterRun({ about, mode: "session", outcome: "nothing-to-say", summary: TOLD, summaryCites: cites, session: NIGHT, run: "run-y2" });
}

/** The host's scopes file: each named folder set to its mode. */
function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: D1 });
  if (reg !== null) writeScopes(join(root, "scopes.json"), reg);
}

/** The wake SessionStart hands a session opening in HERE on D2; `configPath` null for a host with no scope setting to read. */
function sessionStart(c: Counterpart, o: { configPath?: string | null } = {}): string {
  clock = at(D2, 8);
  c.rebrief({ budgetBytes: BUDGET, at: D2 });
  clock = at(D2, 9);
  const adapter = new ClaudeCodeAdapter({
    counterpart: c,
    config: { dataDir: storeDir, injectionBudgetBytes: BUDGET },
    ...(o.configPath === null ? {} : { configPath: o.configPath ?? config }),
    now: () => clock,
    scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
  const out = adapter.sessionStart({ sessionId: READER, scope: HERE, at: D2 } as HookInput);
  expect(out.ok).toBe(true);
  return out.injection;
}

const yesterday = (wake: string): string => wake.split("\n").find((l) => l.startsWith("Yesterday")) ?? "";
const summaryLed = (wake: string): boolean => yesterday(wake).startsWith(`Yesterday, ${YESTERDAY_SUMMARY_WORDS} ${TOLD}`);

/**
 * The 10-24 shape: two chapters here on D1 (the newer is "Last here"'s, so
 * the Yesterday line lists the older), and day's end citing one plus a
 * BAKERY memory marked `work` written on D0 — so the cite is the ONLY thing
 * from BAKERY the gate sees (no BAKERY chapter or memory on D1): what holds
 * the summary back, if anything does, is the cite check.
 */
async function citeOnly(): Promise<{ c: Counterpart; here: string; work: string }> {
  const here = await chapterVia({ session: S4, scope: HERE, date: D1, hour: 8, title: "Sowing the broad beans" });
  await chapterVia({ session: S1, scope: HERE, date: D1, hour: 10, title: "Mending the cold frame" });
  const c = brain();
  const work = memory(c, { scope: BAKERY, session: S2, date: D0, hour: 14, body: "The oven schedule for the winter: two bakes a day, the second at four.", about: "work" });
  const own = c.store.list({ type: "memory", source: "episode", originRef: here, archived: false })[0] as string;
  told(c, D1, [own, work]);
  return { c, here, work };
}

describe("a work cite from another folder no longer holds the summary back", () => {
  test("the bakery's scope setting unset (on by default): SessionStart's wake opens with day's end's words", async () => {
    const { c, here } = await citeOnly();
    scopes({ [HERE]: "on" });
    const wake = sessionStart(c);
    expect(summaryLed(wake)).toBe(true);
    // The chapter list still follows the summary.
    expect(yesterday(wake)).toContain(`"Sowing the broad beans" (${here})`);
  });

  test("the bakery set on explicitly: shown too; the cite's id is not printed (only the summary's prose crosses)", async () => {
    const { c, work } = await citeOnly();
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    const wake = sessionStart(c);
    expect(summaryLed(wake)).toBe(true);
    expect(wake).not.toContain(work);
  });

  test("the bakery wrote a chapter and memories that day too, all on: shown — the whole day of open folders", async () => {
    await citeOnly();
    await chapterVia({ session: S3, scope: BAKERY, date: D1, hour: 13, title: "The winter oven schedule" });
    const c = brain();
    memory(c, { scope: BAKERY, session: S3, date: D1, hour: 13, body: "The second bake moves to four from November.", about: "work" });
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
  });
});

describe("a folder the owner excluded still holds it back: the chapter-list form", () => {
  for (const mode of ["off", "paused"] as const) {
    test(`the cited work's folder ${mode}: the cite alone falls back to the chapter list`, async () => {
      const { c, here } = await citeOnly();
      scopes({ [HERE]: "on", [BAKERY]: mode });
      const wake = sessionStart(c);
      expect(summaryLed(wake)).toBe(false);
      expect(wake).not.toContain(TOLD);
      // The chapter-list form, as before Y1/Y2.
      expect(yesterday(wake)).toStartWith("Yesterday: ");
      expect(yesterday(wake)).toContain(`"Sowing the broad beans" (${here})`);
    });
  }

  test("the bakery excluded entirely — off, and it wrote a chapter that day: falls back, and none of it is named", async () => {
    const { here } = await citeOnly();
    const theirs = await chapterVia({ session: S3, scope: BAKERY, date: D1, hour: 13, title: "The winter oven schedule" });
    const c = brain();
    scopes({ [HERE]: "on", [BAKERY]: "off" });
    const wake = sessionStart(c);
    expect(summaryLed(wake)).toBe(false);
    expect(yesterday(wake)).toStartWith("Yesterday: ");
    expect(yesterday(wake)).toContain(here);
    expect(wake).not.toContain(theirs);
    expect(wake).not.toContain(TOLD);
    expect(wake).not.toContain("bakery");
    expect(yesterday(wake)).not.toContain("oven");
    // Nor its chapter's summary under "Might be relevant" (review of Y2).
    expect(wake).not.toContain("The winter oven schedule");
  });

  test("off, the bakery's chapter that day, and NOTHING of it cited: still falls back — the prose may carry it uncited", async () => {
    const here = await chapterVia({ session: S4, scope: HERE, date: D1, hour: 8, title: "Sowing the broad beans" });
    await chapterVia({ session: S1, scope: HERE, date: D1, hour: 10, title: "Mending the cold frame" });
    await chapterVia({ session: S3, scope: BAKERY, date: D1, hour: 13, title: "The winter oven schedule" });
    const c = brain();
    const own = c.store.list({ type: "memory", source: "episode", originRef: here, archived: false })[0] as string;
    told(c, D1, [own]);
    scopes({ [HERE]: "on", [BAKERY]: "off" });
    expect(summaryLed(sessionStart(c))).toBe(false);
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
  });

  test("no scope setting to read (no config): nothing from another folder crosses, so the work cite falls back", async () => {
    const { c } = await citeOnly();
    const wake = sessionStart(c, { configPath: null });
    expect(summaryLed(wake)).toBe(false);
    expect(yesterday(wake)).toStartWith("Yesterday: ");
  });

  test("a denied cite, or a cite whose memory recorded no folder, still falls back with every folder on", async () => {
    const { c, here, work } = await citeOnly();
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
    const own = c.store.list({ type: "memory", source: "episode", originRef: here, archived: false })[0] as string;
    clock = at(D0, 15);
    const nowhere = c.store.put({ type: "memory", kind: "fact", body: "The flour order comes on Tuesdays.", origin: { session: S2 }, about: "work" });
    told(c, D1, [own, nowhere]);
    expect(summaryLed(sessionStart(c))).toBe(false);
    // The bakery's work cite, then denied (an owner's removal gone dark): out.
    told(c, D1, [own, work]);
    expect(summaryLed(sessionStart(c))).toBe(true);
    c.store.appendRemovalRecord({ memoryId: work, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: work, stage: "dark", actor: "owner", reason: "test" });
    expect(summaryLed(sessionStart(c))).toBe(false);
  });
});

/**
 * "MIGHT BE RELEVANT" KEEPS A SCOPE-OFF FOLDER'S CHAPTER SUMMARY OUT (review
 * of Y2). The published bundle chooses its hints store-wide, for no reader,
 * so until this review a chapter's summary from a folder set off was listed
 * in every other folder's SessionStart wake (Y1, which gave summaries their
 * chapter's folder, changed nothing here: before and after, it was listed).
 * The session-start assembly now leaves out a chapter's summary from another
 * folder whose scope setting is not on.
 */
// The lane is off the wake by default since WK1 (2026-10-30); these tests are of the lane, so it is on.
describe("Nearby at session start: another folder's chapter summary by that folder's scope setting", () => {
  const nearby = (wake: string): string => {
    const i = wake.indexOf("Might be relevant:");
    return i < 0 ? "" : wake.slice(i, wake.indexOf("\n\n", i) < 0 ? undefined : wake.indexOf("\n\n", i));
  };

  test("off, paused or observer: left out; on: listed; this folder's own: always listed", async () => {
    await chapterVia({ session: S4, scope: HERE, date: D1, hour: 8, title: "Sowing the broad beans" });
    await chapterVia({ session: S3, scope: BAKERY, date: D1, hour: 13, title: "The winter oven schedule" });
    const c = brain({ HINTS_IN_WAKE: true });
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    const open = sessionStart(c);
    expect(nearby(open)).toContain("The winter oven schedule, done.");
    expect(nearby(open)).toContain("Sowing the broad beans, done.");
    for (const mode of ["off", "paused", "observer"] as const) {
      scopes({ [HERE]: "on", [BAKERY]: mode });
      const wake = sessionStart(c);
      expect(wake).not.toContain("The winter oven schedule");
      expect(nearby(wake)).toContain("Sowing the broad beans, done.");
    }
  });

  test("no scope setting to read: another folder's chapter summary is left out", async () => {
    await chapterVia({ session: S4, scope: HERE, date: D1, hour: 8, title: "Sowing the broad beans" });
    await chapterVia({ session: S3, scope: BAKERY, date: D1, hour: 13, title: "The winter oven schedule" });
    const c = brain({ HINTS_IN_WAKE: true });
    const wake = sessionStart(c, { configPath: null });
    expect(wake).not.toContain("The winter oven schedule");
    expect(nearby(wake)).toContain("Sowing the broad beans, done.");
  });
});

/**
 * A NIGHT ROW IS READ BY ITS ORIGINALS' FOLDERS (review of Y2): a dream's
 * merge or gist is filed under the folder the dream ran in (HERE below),
 * whatever folders its originals came from. Cited by day's end — or made
 * early in the day, which day's end reads as the day's — it would pass the
 * folder check as HERE's while its words are BAKERY's. Every row here is
 * written through the real `dream` tool.
 */
describe("a dream's merge or gist is read by its originals' folders", () => {
  /** The `dream` tool, run by the night from HERE at `hour` on `date`: one change; the made row's id. */
  async function dreamed(c: Counterpart, o: { date: string; hour: number; change: Record<string, unknown> }): Promise<string> {
    clock = at(o.date, o.hour);
    c.store.advanceClock(o.date);
    const s = new McpServer({ counterpart: c, session: NIGHT, scope: HERE, registryDir: join(root, "registry"), now: () => clock });
    const b = await s.call("dream", { phase: "begin", session: NIGHT });
    const dream = String(b.structuredContent["dream"]);
    const p = await s.call("dream", { phase: "propose", session: NIGHT, dream, changes: [o.change] });
    if (p.isError === true) throw new Error(`refused: ${JSON.stringify(b.structuredContent).slice(0, 300)} / ${JSON.stringify(p.structuredContent)}`);
    const made = (p.structuredContent["made"] as { id?: string }[] | undefined)?.[0]?.id;
    if (made === undefined) throw new Error(`nothing made: ${JSON.stringify(p.structuredContent)}`);
    await s.call("dream", { phase: "journal", session: NIGHT, dream, title: "A night", text: "A short dream." });
    return made;
  }

  /** A memory strong enough for a dream's queue, in `scope` (none: no folder recorded), lived on `date`. */
  function worked(c: Counterpart, o: { scope: string | null; date: string; body: string }): string {
    clock = at(o.date, 10);
    c.store.advanceClock(o.date);
    const day = c.store.livedDay();
    return c.store.put({
      type: "memory",
      kind: "fact",
      body: o.body,
      about: "work",
      salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
      physics: { birthDay: day, lastUsedDay: day },
      origin: { session: S2, ...(o.scope === null ? {} : { scope: o.scope }) },
    });
  }

  /** Two near-copies of BAKERY's work, lived two days before the summary's day. */
  function bakeryTwins(c: Counterpart): [string, string] {
    return [
      worked(c, { scope: BAKERY, date: DA, body: "The oven schedule for the winter: two bakes a day, the second at four." }),
      worked(c, { scope: BAKERY, date: DA, body: "Winter oven schedule: bake twice a day, the second bake at four." }),
    ];
  }

  /** HERE's two chapters on D1; the older one's summary memory. */
  async function hereDay(): Promise<string> {
    const here = await chapterVia({ session: S4, scope: HERE, date: D1, hour: 8, title: "Sowing the broad beans" });
    await chapterVia({ session: S1, scope: HERE, date: D1, hour: 10, title: "Mending the cold frame" });
    return here;
  }

  const ownSummary = (c: Counterpart, here: string): string => c.store.list({ type: "memory", source: "episode", originRef: here, archived: false })[0] as string;

  test("a merge of BAKERY's memories, made on D0 in HERE and cited: BAKERY off falls back; on, it shows", async () => {
    const here = await hereDay();
    const c = brain();
    const [a, b] = bakeryTwins(c);
    const merged = await dreamed(c, { date: D0, hour: 22, change: { action: "merge", ids: [a, b], text: "The winter oven schedule: two bakes a day, the second at four." } });
    // The merge is filed under the folder the dream ran in.
    expect(c.store.row(merged)?.origin_scope).toBe(HERE);
    expect(c.store.row(merged)?.origin_ref ?? "").toStartWith("dream:");
    told(c, D1, [ownSummary(c, here), merged]);
    scopes({ [HERE]: "on", [BAKERY]: "off" });
    const wake = sessionStart(c);
    expect(summaryLed(wake)).toBe(false);
    expect(wake).not.toContain(TOLD);
    expect(yesterday(wake)).toStartWith("Yesterday: ");
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
  });

  test("a merge of a merge: followed to the first originals", async () => {
    const here = await hereDay();
    const c = brain();
    const [a, b] = bakeryTwins(c);
    const first = await dreamed(c, { date: DB, hour: 22, change: { action: "merge", ids: [a, b], text: "The winter oven schedule: two bakes a day, the second at four." } });
    const mine = worked(c, { scope: HERE, date: D0, body: "Winter baking schedule, as I noted it: two bakes, the second at four." });
    const second = await dreamed(c, { date: D0, hour: 22, change: { action: "merge", ids: [first, mine], text: "Winter: two bakes a day, the second at four." } });
    expect(JSON.parse(c.store.row(second)?.meta ?? "{}")["mergedFrom"]).toContain(first);
    told(c, D1, [ownSummary(c, here), second]);
    scopes({ [HERE]: "on", [BAKERY]: "paused" });
    expect(summaryLed(sessionStart(c))).toBe(false);
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
  });

  test("a gist drawn from BAKERY's memories and cited: off falls back; an original with no folder fails closed", async () => {
    const here = await hereDay();
    const c = brain();
    const [a, b] = bakeryTwins(c);
    const gist = await dreamed(c, { date: DB, hour: 22, change: { action: "gist", text: "Winter means two bakes a day.", sources: [a, b] } });
    expect(c.store.row(gist)?.source).toBe("dreamed");
    const own = ownSummary(c, here);
    told(c, D1, [own, gist]);
    scopes({ [HERE]: "on", [BAKERY]: "off" });
    expect(summaryLed(sessionStart(c))).toBe(false);
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
    // One original records no folder: it cannot be told, so it fails.
    const nowhere = worked(c, { scope: null, date: D0, body: "Flour arrives on Tuesdays, two sacks of it." });
    const gist2 = await dreamed(c, { date: D0, hour: 22, change: { action: "gist", text: "Tuesdays set the week's baking.", sources: [nowhere] } });
    told(c, D1, [own, gist2]);
    expect(summaryLed(sessionStart(c))).toBe(false);
  });

  test("a reflection's entry citing BAKERY's memory, written in HERE and cited: off falls back; on, it shows", async () => {
    const here = await hereDay();
    const c = brain();
    const [a] = bakeryTwins(c);
    clock = at(DB, 23);
    c.store.advanceClock(DB);
    const r = c.reflections.begin({ session: NIGHT, scope: HERE });
    if (!r.ok) throw new Error(String(r.reason));
    const done = c.reflections.finish({ reflection: r.bundle.reflection, session: NIGHT, entry: "Looking back, winter baking has a shape now.", cites: [a] });
    if (!done.ok) throw new Error(String(done.reason));
    const entry = c.store.list({ type: "memory", source: "reflection" })[0];
    if (entry === undefined) throw new Error(`no entry: ${JSON.stringify(done.outcome)}`);
    expect(c.store.row(entry)?.origin_scope).toBe(HERE);
    told(c, D1, [ownSummary(c, here), entry]);
    scopes({ [HERE]: "on", [BAKERY]: "off" });
    expect(summaryLed(sessionStart(c))).toBe(false);
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
  });

  test("uncited: a merge the night made EARLY in the day (day's end reads it as the day's) of a folder now off still falls back", async () => {
    const here = await hereDay();
    const c = brain();
    const [a, b] = bakeryTwins(c);
    await dreamed(c, { date: D1, hour: 2, change: { action: "merge", ids: [a, b], text: "The winter oven schedule: two bakes a day, the second at four." } });
    told(c, D1, [ownSummary(c, here)]);
    scopes({ [HERE]: "on", [BAKERY]: "off" });
    expect(summaryLed(sessionStart(c))).toBe(false);
    scopes({ [HERE]: "on", [BAKERY]: "on" });
    expect(summaryLed(sessionStart(c))).toBe(true);
  });
});
