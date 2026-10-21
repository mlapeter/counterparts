/**
 * THE ELSEWHERE LINES NAME WHAT WAS WRITTEN, NOT ONLY HOW MUCH (2026-10-20,
 * Mike's go, lightly held, an experiment). Two sessions in two folders did
 * the same wake check that morning because neither knew what the other had
 * done: "Today, elsewhere" and "Since you started" said "3 memories". Now
 * each folder they name carries its newest piece of work or two by title and
 * id, work in progress first:
 *
 *   Today, elsewhere: ~/bakery open since 08:02 (live), 3 memories: "Wake
 *   check from the bakery" (mem_…), "Oven seven offset" (mem_…).
 *
 * Pinned here:
 *   - the titles appear with their ids, a `status` mark (planned, done…)
 *     before a work memory, a work memory before the rest, newest first;
 *   - the gates: a folder that is off or paused, a confidential memory (even
 *     to the owner, who still counts it), one marked about me, us or the
 *     owner, one that is not work (`isWorkMemory`) and has no status mark,
 *     this session's own, the nightly run's, a chapter's copy, and one
 *     "Still open" lists in this wake are never named by title;
 *   - the room: long titles are cut, every form stays within
 *     `TODAY_ELSEWHERE_MAX_BYTES`, titles give way before folders do;
 *   - "Since you started" names only what was written since this session
 *     last heard, so the wake's titles and a line's are not named again;
 *     nothing new, no line;
 *   - a folder with no titles reads exactly as before.
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
import {
  ELSEWHERE_TITLE_BYTES,
  TODAY_ELSEWHERE_MAX_BYTES,
  sinceElsewhereLines,
  todayElsewhereLines,
} from "../src/core/handoff/last-here.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const BUDGET = 9_000;
const D1 = "2026-10-19";
const D2 = "2026-10-20";
const at = (ymd: string, h: number, m = 0): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR + m * MIN;

/** This session, in HERE. */
const S = "5e550000-0000-4000-8000-000000000001";
const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const C = "c9cacbcc-0000-4000-8000-00000000000c";

let root: string;
let storeDir: string;
let config: string;
let HERE: string;
let THERE: string;
let YON: string;
let FAR: string;
let REST: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  // A short root: the line names directories by path, within its bytes.
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-titles-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  YON = join(root, "orchard");
  FAR = join(root, "ledger");
  REST = join(root, "cellar");
  for (const d of [HERE, THERE, YON, FAR, REST]) mkdirSync(d, { recursive: true });
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

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function tilde(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

interface World {
  c: Counterpart;
  set(t: number): void;
  now(): number;
}

/** A store on the test's clock, a published bundle from the evening before, FAR off and REST paused. */
function world(start: number): World {
  let now = at(D1, 18);
  const c = Counterpart.open({ dir: storeDir, owner: true, budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  c.rebrief({ budgetBytes: BUDGET, at: D1 });
  let reg = setScope(null, FAR, "off", { at: D2 });
  reg = setScope(reg, REST, "paused", { at: D2 });
  writeScopes(join(root, "scopes.json"), reg);
  now = start;
  return {
    c,
    set(t: number): void {
      now = t;
    },
    now: () => now,
  };
}

function wakeLine(w: World): string | undefined {
  const lc = new Lifecycle({ counterpart: w.c, config: { dataDir: storeDir }, configPath: config, now: () => w.now() });
  const text = lc.composeWake({ sessionId: S, scope: HERE, at: D2 }, BUDGET).text;
  expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
  return text.split("\n").find((l) => l.startsWith("Today, elsewhere: "));
}

function memory(
  w: World,
  t: number,
  o: { session: string; scope: string; title?: string; body: string; about?: "me" | "us" | "owner" | "work" | "world"; status?: "planned" | "done"; meta?: Record<string, unknown>; source?: "episode" | "dreamed" },
): string {
  w.set(t);
  return w.c.store.put({
    type: "memory",
    kind: "fact",
    body: o.body,
    ...(o.title === undefined ? {} : { title: o.title }),
    ...(o.about === undefined ? {} : { about: o.about }),
    ...(o.status === undefined ? {} : { status: o.status }),
    ...(o.meta === undefined ? {} : { meta: o.meta }),
    ...(o.source === undefined ? {} : { source: o.source }),
    origin: { session: o.session, scope: o.scope },
  });
}

describe("Today, elsewhere names titles", () => {
  test("the newest work in progress first, by title and id: a status mark, then a work memory, then the rest", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8, 2) });
    const planned = memory(w, at(D2, 8, 10), { session: A, scope: THERE, title: "Wake check from the bakery", body: "Checking the wake.", about: "work", status: "planned" });
    const work = memory(w, at(D2, 8, 20), { session: A, scope: THERE, title: "Oven seven offset", body: "Eleven degrees hot.", about: "work" });
    memory(w, at(D2, 8, 30), { session: A, scope: THERE, title: "CHITCHAT the weather turned", body: "It rained.", about: "world" });
    w.set(at(D2, 9));
    expect(wakeLine(w)).toBe(
      `Today, elsewhere: ${tilde(THERE)} open since 08:02 (live), 3 memories: "Wake check from the bakery" (${planned}), "Oven seven offset" (${work}).`,
    );
  });

  test("gated: a folder that is off or paused, one about me, us or the owner, chit-chat, this session's own, the nightly run's and a chapter's copy are never named by title", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8) });
    recordSession(storeDir, { sessionId: C, scope: FAR, phase: "start", at: at(D2, 8) });
    recordSession(storeDir, { sessionId: "c9cacbcd-0000-4000-8000-00000000000c", scope: REST, phase: "start", at: at(D2, 8) });
    memory(w, at(D2, 8, 5), { session: C, scope: FAR, title: "OFFFOLDER ledger totals", body: "Totals.", about: "work", status: "planned" });
    memory(w, at(D2, 8, 5), { session: "c9cacbcd-0000-4000-8000-00000000000c", scope: REST, title: "PAUSEDFOLDER cellar stock", body: "Stock.", about: "work" });
    memory(w, at(D2, 8, 11), { session: A, scope: THERE, title: "OWNERMARK how Mike likes his bread", body: "Crusty.", about: "owner", status: "done" });
    memory(w, at(D2, 8, 12), { session: A, scope: THERE, title: "USMARK what we laughed about", body: "Flour.", about: "us" });
    memory(w, at(D2, 8, 13), { session: A, scope: THERE, title: "MEMARK why I like dawn", body: "Quiet.", about: "me" });
    memory(w, at(D2, 8, 14), { session: A, scope: THERE, title: "NIGHTLY a dream's gist", body: "Gist.", about: "work", source: "dreamed" });
    memory(w, at(D2, 8, 15), { session: A, scope: THERE, title: "COPY a chapter's copy", body: "Copy.", about: "work", source: "episode" });
    memory(w, at(D2, 8, 17), { session: A, scope: THERE, title: "CHITCHAT the weather turned", body: "It rained.", about: "world" });
    // A reminder: "Coming up" names it, not this line.
    w.c.store.put({ type: "memory", kind: "fact", title: "DATED order flour by Friday", body: "Order flour.", about: "work", status: "planned", eventDate: "2026-10-23", origin: { session: A, scope: THERE } });
    memory(w, at(D2, 8, 18), { session: A, scope: THERE, title: "JOURNALCOPY a summary's copy", body: "Copy.", about: "work", meta: { episodeId: "epi_000000000000" } });
    // This session's own memory, filed under another folder (it walked there).
    memory(w, at(D2, 8, 16), { session: S, scope: THERE, title: "OWNSESSION my own note", body: "Mine.", about: "work", status: "planned" });
    const ok = memory(w, at(D2, 8, 20), { session: A, scope: THERE, title: "The one that may cross", body: "Fine.", about: "work" });
    w.set(at(D2, 9));
    const line = wakeLine(w) ?? "";
    expect(line).toContain(`"The one that may cross" (${ok})`);
    for (const never of ["OFFFOLDER", "PAUSEDFOLDER", "OWNERMARK", "USMARK", "MEMARK", "NIGHTLY", "COPY", "CHITCHAT", "DATED", "OWNSESSION", tilde(FAR), tilde(REST)]) {
      expect(line).not.toContain(never);
    }
    // The count is every memory written there today; the titles left out stay home.
    expect(line).toMatch(/, \d+ memories: "The one that may cross"/);
  });

  test("what \"Still open\" lists in this wake is that lane's to name", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8) });
    memory(w, at(D2, 8, 10), { session: A, scope: THERE, title: "OPENTHREAD whether the rye needs more salt", body: "Whether the rye needs more salt.", about: "work", meta: { unresolved: true } });
    const done = memory(w, at(D2, 8, 5), { session: A, scope: THERE, title: "Scored the loaves", body: "Scored.", about: "work", status: "done" });
    w.set(at(D2, 9));
    const line = wakeLine(w) ?? "";
    expect(line).not.toContain("OPENTHREAD");
    expect(line).toContain(`"Scored the loaves" (${done})`);
  });

  test("a long title is cut, and with many folders every form stays within its bytes, titles giving way first", () => {
    const long = "A very long title about calibrating the seventh oven in the bakery before the morning rush begins";
    const dirs = Array.from({ length: 6 }, (_, i) => ({
      scope: `/home/someone/folder-${String(i)}`,
      firstAt: at(D2, 7, i),
      lastAt: at(D2, 8, i),
      live: i === 0,
      chapter: null,
      memories: 4,
      titles: [
        { id: `mem_00000000000${String(i)}`, title: `${long} ${String(i)}`, at: at(D2, 8, i) },
        { id: `mem_10000000000${String(i)}`, title: `Second ${long}`, at: at(D2, 7, i) },
      ],
    }));
    const lines = todayElsewhereLines(dirs, ZONE);
    expect(lines).not.toBeNull();
    const all = [lines?.line ?? "", ...(lines?.shorter ?? [])];
    for (const form of all) expect(bytes(form)).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    for (let i = 1; i < all.length; i += 1) expect(bytes(all[i] ?? "")).toBeLessThan(bytes(all[i - 1] ?? ""));
    // A title is cut to its bytes, with its whole id beside it.
    const quoted = /"([^"]*)" \(mem_0+0\)/.exec(all.join("\n"))?.[1] ?? "";
    expect(quoted.length).toBeGreaterThan(0);
    expect(bytes(quoted)).toBeLessThanOrEqual(ELSEWHERE_TITLE_BYTES);
    expect(quoted.endsWith("…")).toBe(true);
    // Some form names a folder's title; the last is the count alone.
    expect(all.some((f) => f.includes("(mem_"))).toBe(true);
    expect(all[all.length - 1]).toBe("Today, elsewhere: 6 other projects.");
  });

  test("a folder with no titles reads exactly as before", () => {
    const base = { scope: "/home/someone/bakery", firstAt: at(D2, 8, 2), lastAt: at(D2, 9), live: true, chapter: null, memories: 3 };
    expect(todayElsewhereLines([base], ZONE)?.line).toBe("Today, elsewhere: ~/bakery open since 08:02 (live), 3 memories.");
    expect(todayElsewhereLines([{ ...base, titles: [] }], ZONE)?.line).toBe("Today, elsewhere: ~/bakery open since 08:02 (live), 3 memories.");
    const since = { scope: "/home/someone/bakery", startedAt: null, live: true, endedAt: at(D2, 9), chapter: null, memories: 0 };
    const window = { at: at(D2, 8), started: true, now: at(D2, 10) };
    expect(sinceElsewhereLines([since], window, ZONE)?.line).toBe("Since you started (08:00): ~/bakery open.");
    expect(sinceElsewhereLines([{ ...since, endedAt: null }], window, ZONE)).toBeNull();
  });
});

describe("Since you started names only what is new", () => {
  function hooks(w: World): ClaudeCodeAdapter {
    const verdict = { mode: "on", matched: HERE, entry: null } as ScopeVerdict;
    return new ClaudeCodeAdapter({
      counterpart: w.c,
      config: { dataDir: storeDir, owner: true },
      configPath: config,
      now: () => w.now(),
      scope: verdict,
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    });
  }
  const input = (): HookInput => ({ sessionId: S, scope: HERE, at: D2, prompt: "where were we with the north bed?" }) as HookInput;
  function prompt(w: World, t: number): string | undefined {
    w.set(t);
    return hooks(w).userPromptSubmit(input()).injection.split("\n").find((l) => l.startsWith("Since "));
  }

  test("the wake's titles are not named again; a line's titles are not named by the next; nothing new, no line", () => {
    const w = world(at(D2, 9));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 9) });
    const before = memory(w, at(D2, 9, 10), { session: A, scope: THERE, title: "TOLDATWAKE the starter was fed", body: "Fed.", about: "work" });
    // The session starts: its wake names the memory already written.
    w.set(at(D2, 10));
    hooks(w).sessionStart({ sessionId: S, scope: HERE, at: D2 } as HookInput);
    expect(wakeLine(w)).toContain(`"TOLDATWAKE the starter was fed" (${before})`);
    expect(prompt(w, at(D2, 10, 1))).toBeUndefined(); // arms
    // Nothing new: no line, however long.
    expect(prompt(w, at(D2, 10, 30))).toBeUndefined();
    // Something new: named, and only it.
    const fresh = memory(w, at(D2, 10, 40), { session: A, scope: THERE, title: "Scored the loaves", body: "Scored.", about: "work", status: "done" });
    const first = prompt(w, at(D2, 10, 45)) ?? "";
    expect(first).toBe(`Since you started (10:00): ${tilde(THERE)} open, 1 memory: "Scored the loaves" (${fresh}).`);
    expect(first).not.toContain("TOLDATWAKE");
    // An hour on: only what came after that line.
    const later = memory(w, at(D2, 11, 0), { session: A, scope: THERE, title: "Second proof started", body: "Proofing.", about: "work" });
    const second = prompt(w, at(D2, 11, 50)) ?? "";
    expect(second).toBe(`Since 10:45: ${tilde(THERE)} open, 1 memory: "Second proof started" (${later}).`);
    expect(second).not.toContain("Scored the loaves");
    // And nothing new after it: nothing.
    expect(prompt(w, at(D2, 13))).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Another session open in this same folder (2026-10-20, the coordinator's
// addition: the commoner case — several sessions in ~/counterparts at once)
// ═══════════════════════════════════════════════════════════════════════════

describe("Here, also open: the other sessions in this folder", () => {
  /** Two more sessions: P beside S in HERE, Q in HERE too. */
  const P = "25e12e7d-0000-4000-8000-000000000025";
  const Q = "3c3c3c3c-0000-4000-8000-00000000003c";

  function wakeOf(w: World, session: string): string {
    const lc = new Lifecycle({ counterpart: w.c, config: { dataDir: storeDir }, configPath: config, now: () => w.now() });
    const text = lc.composeWake({ sessionId: session, scope: HERE, at: D2 }, BUDGET).text;
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    return text;
  }
  const hereLine = (text: string): string | undefined =>
    text.split("\n").find((l) => l.startsWith("Here, also open: ") || l.startsWith("Today, elsewhere: "));

  test("two live sessions in one folder each see the other's work by title, named as Last here names a session — and never their own", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: S, scope: HERE, phase: "start", at: at(D2, 8, 5), model: "claude-opus-5-5" });
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "start", at: at(D2, 8, 10), model: "claude-fable-5" });
    const mine = memory(w, at(D2, 8, 20), { session: S, scope: HERE, title: "Reading the wake check", body: "Reading.", about: "work", status: "planned" });
    const theirs = memory(w, at(D2, 8, 30), { session: P, scope: HERE, title: "Roadmap: the notes module", body: "Notes.", about: "work", status: "planned" });
    const theirs2 = memory(w, at(D2, 8, 25), { session: P, scope: HERE, title: "Dream throughput numbers", body: "Numbers.", about: "work" });
    w.set(at(D2, 9));
    const forS = hereLine(wakeOf(w, S)) ?? "";
    expect(forS).toBe(`Here, also open: session 25e12e7d on Fable 5 since 08:10: "Roadmap: the notes module" (${theirs}), "Dream throughput numbers" (${theirs2}).`);
    expect(forS).not.toContain(mine);
    const forP = hereLine(wakeOf(w, P)) ?? "";
    expect(forP).toBe(`Here, also open: session 5e550000 on Opus 5.5 since 08:05: "Reading the wake check" (${mine}).`);
    expect(forP).not.toContain(theirs);
    // With another folder too, the clause follows the folders, and is kept longest.
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8, 40) });
    memory(w, at(D2, 8, 45), { session: A, scope: THERE, title: "Bakery work", body: "Work.", about: "work" });
    w.set(at(D2, 9, 5));
    const both = hereLine(wakeOf(w, S)) ?? "";
    expect(both).toStartWith(`Today, elsewhere: ${tilde(THERE)} open since 08:40 (live)`);
    expect(both).toContain(`. Here, also open: session 25e12e7d on Fable 5 since 08:10: "Roadmap: the notes module" (${theirs})`);
  });

  test("the same title gates: no me/us/owner, dated, open-thread, nightly or chit-chat title; an ended session, or one in another folder, is not here", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: S, scope: HERE, phase: "start", at: at(D2, 8) });
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "start", at: at(D2, 8, 10) });
    recordSession(storeDir, { sessionId: Q, scope: HERE, phase: "start", at: at(D2, 8, 12) });
    recordSession(storeDir, { sessionId: Q, scope: HERE, phase: "end", at: at(D2, 8, 50) });
    memory(w, at(D2, 8, 21), { session: P, scope: HERE, title: "OWNERMARK how he likes it", body: "So.", about: "owner", status: "done" });
    memory(w, at(D2, 8, 22), { session: P, scope: HERE, title: "USMARK our joke", body: "Ha.", about: "us" });
    memory(w, at(D2, 8, 23), { session: P, scope: HERE, title: "CHITCHAT rain", body: "Rain.", about: "world" });
    memory(w, at(D2, 8, 24), { session: P, scope: HERE, title: "OPENTHREAD whether to ship", body: "Whether to ship.", about: "work", meta: { unresolved: true } });
    memory(w, at(D2, 8, 25), { session: P, scope: HERE, title: "NIGHTLY gist", body: "Gist.", about: "work", source: "dreamed" });
    w.set(at(D2, 8, 26));
    w.c.store.put({ type: "memory", kind: "fact", title: "DATED ship by Friday", body: "Ship.", about: "work", status: "planned", eventDate: "2026-10-23", origin: { session: P, scope: HERE } });
    memory(w, at(D2, 8, 30), { session: Q, scope: HERE, title: "ENDEDSESSION its work", body: "Work.", about: "work" });
    const ok = memory(w, at(D2, 8, 40), { session: P, scope: HERE, title: "The one that may show", body: "Fine.", about: "work" });
    w.set(at(D2, 9));
    const line = hereLine(wakeOf(w, S)) ?? "";
    expect(line).toBe(`Here, also open: session 25e12e7d since 08:10: "The one that may show" (${ok}).`);
    for (const never of ["OWNERMARK", "USMARK", "CHITCHAT", "OPENTHREAD", "NIGHTLY", "DATED", "ENDEDSESSION", "3c3c3c3c"]) {
      expect(line).not.toContain(never);
    }
  });

  test("Work here leaves a memory the clause names to it, and keeps one the clause gave up", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: S, scope: HERE, phase: "start", at: at(D2, 8) });
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "start", at: at(D2, 8, 10) });
    const named = memory(w, at(D2, 8, 30), { session: P, scope: HERE, title: "Roadmap: the notes module", body: "The notes module comes after the wake polish.", about: "work" });
    w.set(at(D2, 9));
    const text = wakeOf(w, S);
    expect(hereLine(text)).toContain(named);
    expect(text.split("\n").filter((l) => l.includes(named))).toHaveLength(1);
  });

  test("the room: a live session here and other folders share the 300 bytes, this folder's sessions kept longest", () => {
    const long = "A very long title about calibrating the seventh oven before the morning rush";
    const dirs = Array.from({ length: 4 }, (_, i) => ({
      scope: `/home/someone/folder-${String(i)}`,
      firstAt: at(D2, 7, i),
      lastAt: at(D2, 8, i),
      live: true,
      chapter: null,
      memories: 3,
      titles: [{ id: `mem_00000000000${String(i)}`, title: `${long} ${String(i)}`, at: at(D2, 8, i) }],
    }));
    const here = [
      { session: P, model: "claude-fable-5", startedAt: at(D2, 8, 10), titles: [{ id: "mem_aaaaaaaaaaaa", title: long, at: at(D2, 8, 30) }, { id: "mem_bbbbbbbbbbbb", title: `Second ${long}`, at: at(D2, 8, 20) }] },
    ];
    const lines = todayElsewhereLines(dirs, ZONE, here);
    const all = [lines?.line ?? "", ...(lines?.shorter ?? [])];
    for (const form of all) expect(bytes(form)).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    for (let i = 1; i < all.length; i += 1) expect(bytes(all[i] ?? "")).toBeLessThan(bytes(all[i - 1] ?? ""));
    // Every form but the last names the session here; the last counts both.
    for (const form of all.slice(0, -1)) expect(form).toContain("session 25e12e7d");
    expect(all[all.length - 1]).toBe("Today, elsewhere: 4 other projects. Here, also open: 1 other session.");
  });

  test("Since you started names a session here only for what is new in it; nothing new, no line", () => {
    const w = world(at(D2, 9));
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "start", at: at(D2, 9) });
    const before = memory(w, at(D2, 9, 10), { session: P, scope: HERE, title: "TOLDATWAKE roadmap draft", body: "Draft.", about: "work" });
    const hooks = (): ClaudeCodeAdapter =>
      new ClaudeCodeAdapter({
        counterpart: w.c,
        config: { dataDir: storeDir, owner: true },
        configPath: config,
        now: () => w.now(),
        scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 4242 }),
      });
    const prompt = (t: number): string | undefined => {
      w.set(t);
      return hooks()
        .userPromptSubmit({ sessionId: S, scope: HERE, at: D2, prompt: "where were we?" } as HookInput)
        .injection.split("\n")
        .find((l) => l.startsWith("Since "));
    };
    w.set(at(D2, 10));
    const woke = hooks().sessionStart({ sessionId: S, scope: HERE, at: D2 } as HookInput).injection;
    expect(woke).toContain(`Here, also open: session 25e12e7d since 09:00: "TOLDATWAKE roadmap draft" (${before}).`);
    expect(prompt(at(D2, 10, 1))).toBeUndefined(); // arms
    // P is still open and busy with nothing new: no line.
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "boundary", at: at(D2, 10, 20) });
    expect(prompt(at(D2, 10, 30))).toBeUndefined();
    // P writes something: named, and only it.
    const fresh = memory(w, at(D2, 10, 40), { session: P, scope: HERE, title: "Roadmap: notes module first", body: "Notes first.", about: "work", status: "planned" });
    const first = prompt(at(D2, 10, 45)) ?? "";
    expect(first).toBe(`Since you started (10:00): here, also open: session 25e12e7d: "Roadmap: notes module first" (${fresh}).`);
    expect(first).not.toContain("TOLDATWAKE");
    // A new session opens here: said with its start, an hour on.
    recordSession(storeDir, { sessionId: Q, scope: HERE, phase: "start", at: at(D2, 11, 0) });
    const second = prompt(at(D2, 11, 50)) ?? "";
    expect(second).toBe("Since 10:45: here, also open: session 3c3c3c3c open since 11:00.");
    expect(prompt(at(D2, 13))).toBeUndefined();
  });
});
