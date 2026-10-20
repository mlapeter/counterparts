/**
 * "SINCE YOU STARTED" (2026-10-11; option C of the fresh-wake brief, which
 * Mike approved 2026-10-10; details the builder's, lightly held).
 *
 * A session that is already open never reads a wake again, so it did not
 * learn that another folder ended a session or wrote a chapter an hour ago.
 * Now the per-prompt hook carries at most one line, for the model:
 *
 *   Since you started (10:40): ~/bakery ended 11:05, chapter "…" (epi_…),
 *   3 memories; ~/orchard open since 10:52, 1 memory.
 *
 * Pinned here, through the real hooks (`ClaudeCodeAdapter`):
 *   - shown once after a change, not at the first prompt after a wake, and
 *     not again within the hour — then again after it, counting from the line;
 *   - no change, no line (time passing in an open session is not a change);
 *   - the gates are "Today, elsewhere"'s: a span's words, a handoff, a
 *     confidential chapter, an off, paused or observer folder, this folder
 *     and the nightly run's are never named; a work memory's title is, since
 *     2026-10-20 (Mike's go, an experiment), and only once;
 *   - with no room left in recall's budget the line waits, and the next
 *     prompt with room says it — the hour not spent;
 *   - under observer, nothing;
 *   - no store write: the line reads, and only the session's registry record
 *     moves.
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { TUNABLES as RECALL_TUNABLES } from "../src/core/recall/tunables.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { readSession, recordSession } from "../src/adapters/sessions.js";
import { TODAY_ELSEWHERE_MAX_BYTES, sinceElsewhereLines } from "../src/core/handoff/last-here.js";
import { readableDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const D = "2026-10-11";
const at = (h: number, m = 0): number => Date.parse(`${D}T00:00:00Z`) + h * HOUR + m * MIN;

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
const open: { close(): void }[] = [];

beforeEach(() => {
  // A short root: the line names directories by path, within its bytes.
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-since-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  YON = join(root, "orchard");
  for (const d of [HERE, THERE, YON]) mkdirSync(d, { recursive: true });
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

interface World {
  c: Counterpart;
  hooks(opts?: { budget?: number; observer?: boolean }): ClaudeCodeAdapter;
  set(t: number): void;
  now(): number;
}

/** A store on the test's clock, and hooks over it on the same clock. */
function world(start: number, opts: { observer?: boolean } = {}): World {
  let now = start;
  // An observer reads a store that exists; it makes none.
  if (opts.observer === true) Counterpart.open({ dir: storeDir, timeZone: ZONE }).close();
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => now, timeZone: ZONE, ...(opts.observer === true ? { observer: true } : {}) });
  open.push(c);
  writeScopes(join(root, "scopes.json"), setScope(null, join(root, "nothing-here"), "off", { at: D }));
  const verdict: ScopeVerdict = { mode: opts.observer === true ? "observer" : "on", matched: HERE, entry: null } as ScopeVerdict;
  return {
    c,
    hooks(o = {}) {
      return new ClaudeCodeAdapter({
        counterpart: c,
        config: { dataDir: storeDir, owner: true, ...(o.budget === undefined ? {} : { injectionBudgetBytes: o.budget }) },
        configPath: config,
        now: () => now,
        scope: verdict,
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 4242 }),
      });
    },
    set(t: number) {
      now = t;
    },
    now: () => now,
  };
}

function input(prompt = "where were we with the north bed?"): HookInput {
  return { sessionId: S, scope: HERE, at: D, prompt } as HookInput;
}

/** This session opens in HERE at `t`: the registry record and the wake. */
function wake(w: World, t: number): void {
  w.set(t);
  w.hooks().sessionStart({ sessionId: S, scope: HERE, at: D } as HookInput);
}

function lineOf(text: string): string | undefined {
  return text.split("\n").find((l) => l.startsWith("Since "));
}

function prompt(w: World, t: number, opts: { budget?: number } = {}): string | undefined {
  w.set(t);
  return lineOf(w.hooks(opts).userPromptSubmit(input()).injection);
}

/** An episode as the journal writes it, with a dated heading, put straight in. */
function chapter(c: Counterpart, o: { session: string; scope: string; title: string; about: "me" | "work"; confidential?: boolean }): string {
  const epi = c.store.put({
    type: "episode",
    kind: "self",
    title: o.title,
    body: `## chapter 1 — ${readableDate(D)} · lived day 1\n\nA placeholder chapter.\n`,
    meta: { sessionId: o.session, chapters: 1, ...(o.confidential === true ? { confidential: true } : {}) },
    source: "episode",
    origin: { session: o.session, scope: o.scope },
  });
  c.store.put({ type: "memory", kind: "self", body: `A placeholder copy for ${o.title}.`, source: "episode", origin: { session: o.session, scope: o.scope, ref: epi }, about: o.about });
  return epi;
}

function tilde(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

describe("Since you started", () => {
  test("shown once after a change — never at the first prompt after the wake, not again within the hour, and again after it", () => {
    const w = world(at(10, 30));
    // THERE was already open before this session began.
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(10, 0) });
    wake(w, at(10, 40));
    expect(readSession(storeDir, S)?.sinceSeen).toEqual({ at: at(10, 40), state: "woke" });
    // Something changes at once — but the first prompt after a wake says nothing.
    w.set(at(10, 45));
    const rye = w.c.store.put({ type: "memory", kind: "fact", body: "The rye starter was fed twice.", origin: { session: A, scope: THERE } });
    expect(prompt(w, at(10, 46))).toBeUndefined();
    expect(readSession(storeDir, S)?.sinceSeen?.state).toBe("armed");
    // THERE ends; a chapter there; YON opens.
    w.set(at(11, 0));
    const epi = chapter(w.c, { session: A, scope: THERE, title: "Why I bake before dawn", about: "me" });
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "end", at: at(11, 5) });
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 52) });
    w.set(at(10, 53));
    const pear = w.c.store.put({ type: "memory", kind: "fact", body: "The pear wants pruning in February.", origin: { session: C, scope: YON } });
    const first = prompt(w, at(11, 10));
    // Both folders with their newest memory by title, and the chapter given
    // up first when they do not all fit (the temp paths are long).
    expect(first).toBe(
      `Since you started (10:40): ${tilde(THERE)} ended 11:05, 2 memories: "The rye starter was fed twice." (${rye}); ` +
        `${tilde(YON)} open since 10:52, 1 memory: "The pear wants pruning in February." (${pear}).`,
    );
    expect(epi).toStartWith("epi_");
    expect(Buffer.byteLength(first ?? "", "utf8")).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    expect(readSession(storeDir, S)?.sinceSeen).toEqual({ at: at(11, 10), state: "shown" });
    // Within the hour: nothing, whatever changes.
    w.set(at(11, 20));
    const gate = w.c.store.put({ type: "memory", kind: "fact", body: "The orchard gate sticks in the rain.", origin: { session: C, scope: YON } });
    expect(prompt(w, at(11, 30))).toBeUndefined();
    expect(prompt(w, at(12, 9))).toBeUndefined();
    // An hour after the line: what changed since IT, not since the start.
    // The titles the first line named are not named again: only the new one.
    expect(prompt(w, at(12, 11))).toBe(`Since 11:10: ${tilde(YON)} open, 1 memory: "The orchard gate sticks in the rain." (${gate}).`);
  });

  test("no change, no line — and an open session elsewhere that only kept working is not a change", () => {
    const w = world(at(9));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(9) });
    w.c.store.put({ type: "memory", kind: "fact", body: "A memory from before this session.", origin: { session: A, scope: THERE } });
    wake(w, at(10));
    expect(prompt(w, at(10, 5))).toBeUndefined();
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "boundary", at: at(10, 30) });
    expect(prompt(w, at(10, 40))).toBeUndefined();
    expect(prompt(w, at(13))).toBeUndefined();
    expect(readSession(storeDir, S)?.sinceSeen).toEqual({ at: at(10), state: "armed" });
  });

  test("the gates are Today-elsewhere's: a work title but no span, handoff or confidential chapter; off, paused and observer folders, this one and the nightly run's are not named", () => {
    const w = world(at(9));
    const WATCH = join(root, "greenhouse");
    const REST = join(root, "cellar");
    const FAR = join(root, "ledger");
    for (const d of [WATCH, REST, FAR]) mkdirSync(d, { recursive: true });
    let reg = setScope(null, FAR, "off", { at: D });
    reg = setScope(reg, WATCH, "observer", { at: D });
    reg = setScope(reg, REST, "paused", { at: D });
    wake(w, at(10));
    writeScopes(join(root, "scopes.json"), reg);
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 20));
    // THERE: a work chapter, a work memory with a title, a confidential chapter, a span, a handoff.
    chapter(w.c, { session: A, scope: THERE, title: "WORKCHAPTER oven seven calibration", about: "work" });
    chapter(w.c, { session: "a1b2c3d5-0000-4000-8000-00000000000a", scope: THERE, title: "KEPTHOME a confidential chapter", about: "me", confidential: true });
    const worktitle = w.c.store.put({ type: "memory", kind: "fact", title: "WORKTITLE-oven-offset", body: "The proofing timer counts minutes.", about: "work", origin: { session: A, scope: THERE } });
    w.c.captureSpans({ session: A, scope: THERE, turns: [{ role: "user", text: "SPANWORDS the starter smells of apples" }, { role: "assistant", text: "SPANWORDS that is the yeast." }] });
    w.c.writeHandoff("HANDOFFBODY: score the loaves before the second proof.", { scope: THERE, session: A });
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(10, 10) });
    // Closed folders, this folder, and the store's own: sessions and memories, never named.
    for (const [i, scope] of [WATCH, REST, FAR, HERE, storeDir].entries()) {
      const session = `b0b0b0b${String(i)}-0000-4000-8000-00000000000b`;
      recordSession(storeDir, { sessionId: session, scope, phase: "start", at: at(10, 15) });
      chapter(w.c, { session, scope, title: `NOTNAMED chapter ${String(i)}`, about: "me" });
    }
    const line = prompt(w, at(10, 30)) ?? "";
    // This folder is not named by path; its other open session is (2026-10-20),
    // without its chapter's copy.
    expect(line).toBe(
      `Since you started (10:00): ${tilde(THERE)} open since 10:10, 3 memories: "WORKTITLE-oven-offset" (${worktitle}). ` +
        "Here, also open: session b0b0b0b3 open since 10:15.",
    );
    for (const never of ["WORKCHAPTER", "KEPTHOME", "proofing timer", "SPANWORDS", "HANDOFFBODY", "NOTNAMED", tilde(WATCH), tilde(REST), tilde(FAR), tilde(HERE) + " ", tilde(storeDir)]) {
      expect(line).not.toContain(never);
    }
  });

  test("with no room left in recall's budget the line waits; the next prompt with room says it, the hour not spent", () => {
    const w = world(at(9));
    wake(w, at(10));
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 10));
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 10) });
    const pear = w.c.store.put({ type: "memory", kind: "fact", body: "The pear wants pruning in February.", origin: { session: C, scope: YON } });
    // A budget smaller than any form of the line.
    w.set(at(10, 20));
    const tight = w.hooks({ budget: 24 });
    expect(lineOf(tight.userPromptSubmit(input()).injection)).toBeUndefined();
    expect(tight.events("adapter.since.deferred")).toHaveLength(1);
    expect(readSession(storeDir, S)?.sinceSeen).toEqual({ at: at(10), state: "armed" });
    // The next prompt has room, and it says it.
    expect(prompt(w, at(10, 25))).toBe(`Since you started (10:00): ${tilde(YON)} open since 10:10, 1 memory: "The pear wants pruning in February." (${pear}).`);
  });

  test("it rides as context for the model, above the recall note, and gives way to recall: it takes only what recall left of its budget", () => {
    const w = world(at(9));
    wake(w, at(10));
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 10));
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 10) });
    const expected = `Since you started (10:00): ${tilde(YON)} open since 10:10.`;
    const need = Buffer.byteLength(`${expected}\n`, "utf8");
    const head = "<!-- counterparts:recall -->\n";
    /** Hooks whose recall prints a note of exactly `size` bytes. */
    const recalling = (size: number): ClaudeCodeAdapter => {
      const a = w.hooks();
      const note = `${head}${"r".repeat(size - Buffer.byteLength(head, "utf8"))}`;
      (a as unknown as { recallTurn: () => unknown }).recallTurn = () => ({
        injection: note,
        decision: { reason: "surfaced", bytes: size, sentinel: null, surfaced: [], footnotes: [] },
      });
      return a;
    };
    const counted = "Since you started (10:00): 1 other project.";
    const least = Buffer.byteLength(`${counted}\n`, "utf8");
    // Recall's default budget, all but one byte too few for even the shortest form: it waits.
    w.set(at(10, 20));
    const full = recalling(RECALL_TUNABLES.BUDGET_BYTES - least + 1).userPromptSubmit(input());
    expect(lineOf(full.injection)).toBeUndefined();
    expect(full.injection).toContain(head);
    expect(readSession(storeDir, S)?.sinceSeen?.state).toBe("armed");
    // Room for the shortest form but not the widest: the shortest goes (and the hour starts).
    const narrow = recalling(RECALL_TUNABLES.BUDGET_BYTES - need + 1).userPromptSubmit(input());
    expect(lineOf(narrow.injection)).toBe(counted);
    // Exactly room, an hour on and with something new: the widest rides,
    // above the note and outside it; nothing for the person's terminal.
    w.set(at(11, 20));
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "end", at: at(11, 0) });
    recordSession(storeDir, { sessionId: "c9cacbcd-0000-4000-8000-00000000000c", scope: YON, phase: "start", at: at(11, 10) });
    w.set(at(11, 25));
    const fits = recalling(RECALL_TUNABLES.BUDGET_BYTES - Buffer.byteLength(`Since 10:20: ${tilde(YON)} open since 11:10.\n`, "utf8")).userPromptSubmit(input());
    expect(lineOf(fits.injection)).toBe(`Since 10:20: ${tilde(YON)} open since 11:10.`);
    expect(fits.injection.indexOf("Since 10:20: ")).toBeLessThan(fits.injection.indexOf(head));
    expect(fits.injection.endsWith("r")).toBe(true);
    expect(fits.notices ?? []).toHaveLength(0);
  });

  test("under observer: nothing, and no state", () => {
    const w = world(at(9), { observer: true });
    wake(w, at(10));
    recordSession(storeDir, { sessionId: S, scope: HERE, phase: "start", at: at(10) });
    expect(prompt(w, at(10, 1))).toBeUndefined();
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 10) });
    expect(prompt(w, at(10, 20))).toBeUndefined();
    expect(prompt(w, at(11, 30))).toBeUndefined();
    expect(readSession(storeDir, S)?.sinceSeen).toBeUndefined();
  });

  test("reads only: the line writes nothing to the store", () => {
    const w = world(at(9));
    wake(w, at(10));
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 10));
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 10) });
    const pear = w.c.store.put({ type: "memory", kind: "fact", body: "The pear wants pruning in February.", origin: { session: C, scope: YON } });
    /** Every durable thing the line must not move. */
    const state = (): string => {
      const s = w.c.store;
      return JSON.stringify({
        rows: s.countMemories({}),
        events: s.eventLog({ limit: 100_000 }).length,
        displays: [...s.wakeDisplays()],
        meta: [...s.metaWithPrefix("")],
      });
    };
    const before = state();
    w.set(at(10, 20));
    const since = w.hooks().sinceLine({ sessionId: S, scope: HERE, at: D }, 1_000);
    expect(since).toBe(`Since you started (10:00): ${tilde(YON)} open since 10:10, 1 memory: "The pear wants pruning in February." (${pear}).`);
    expect(state()).toBe(before);
  });

  test("the forms: every one within the line's bytes, the folders past it counted", () => {
    const dirs = Array.from({ length: 9 }, (_, i) => ({
      scope: `/srv/a-rather-long-folder-name-number-${String(i)}`,
      startedAt: at(10, i),
      live: true,
      endedAt: null,
      chapter: null,
      memories: i + 1,
    }));
    const lines = sinceElsewhereLines(dirs, { at: at(9), started: true, now: at(11) }, ZONE);
    expect(lines).not.toBeNull();
    for (const l of [lines?.line ?? "", ...(lines?.shorter ?? [])]) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(TODAY_ELSEWHERE_MAX_BYTES);
    expect(lines?.line).toMatch(/^Since you started \(09:00\): .*; \+\d+ more\.$/);
    expect(lines?.shorter.at(-1)).toBe("Since you started (09:00): 9 other projects.");
    // Nothing changed anywhere: no line.
    expect(sinceElsewhereLines([{ scope: "/srv/x", startedAt: null, live: true, endedAt: null, chapter: null, memories: 0 }], { at: at(9), started: true, now: at(11) }, ZONE)).toBeNull();
  });
});

describe("Since you started — review of #387", () => {
  test("an off folder's child and a paused folder: their sessions ending, their chapters and memories are not named; a sibling sharing only a prefix is", () => {
    const w = world(at(9));
    const FAR = join(root, "ledger");
    const CHILD = join(FAR, "inner");
    const SIB = join(root, "ledger-public");
    const REST = join(root, "cellar");
    for (const d of [CHILD, SIB, REST]) mkdirSync(d, { recursive: true });
    let reg = setScope(null, FAR, "off", { at: D });
    reg = setScope(reg, REST, "paused", { at: D });
    writeScopes(join(root, "scopes.json"), reg);
    const IN = "d0d0d0d1-0000-4000-8000-00000000000d";
    const RS = "d0d0d0d2-0000-4000-8000-00000000000d";
    // Both open before this session woke; both end after it.
    recordSession(storeDir, { sessionId: IN, scope: CHILD, phase: "start", at: at(9, 30) });
    recordSession(storeDir, { sessionId: RS, scope: REST, phase: "start", at: at(9, 30) });
    wake(w, at(10));
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 10));
    chapter(w.c, { session: IN, scope: CHILD, title: "INNERCHAPTER about me", about: "me" });
    chapter(w.c, { session: RS, scope: REST, title: "RESTCHAPTER about me", about: "me" });
    w.c.store.put({ type: "memory", kind: "fact", body: "INNERMEMORY", origin: { session: IN, scope: CHILD } });
    recordSession(storeDir, { sessionId: IN, scope: CHILD, phase: "end", at: at(10, 12) });
    recordSession(storeDir, { sessionId: RS, scope: REST, phase: "end", at: at(10, 13) });
    // Nothing that may be named changed: no line at all.
    expect(prompt(w, at(10, 20))).toBeUndefined();
    recordSession(storeDir, { sessionId: "d0d0d0d3-0000-4000-8000-00000000000d", scope: SIB, phase: "start", at: at(10, 25) });
    const line = prompt(w, at(10, 30)) ?? "";
    expect(line).toBe(`Since you started (10:00): ${tilde(SIB)} open since 10:25.`);
    for (const never of ["INNER", "RESTCHAPTER", tilde(CHILD), tilde(REST), "ended"]) expect(line).not.toContain(never);
  });

  test("a scope file that cannot be read names nothing (fail closed); the nightly run's prompt says nothing and moves nothing", () => {
    const w = world(at(9));
    wake(w, at(10));
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 10));
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 10) });
    chapter(w.c, { session: C, scope: YON, title: "Why the pears ripen late", about: "me" });
    w.set(at(10, 20));
    expect(w.hooks().sinceLine({ sessionId: S, scope: HERE, at: D, nightRun: true } as HookInput & { nightRun: boolean }, 1_000)).toBe("");
    expect(readSession(storeDir, S)?.sinceSeen?.state).toBe("armed");
    writeFileSync(join(root, "scopes.json"), "{ not json");
    expect(prompt(w, at(10, 25))).toBeUndefined();
    expect(readSession(storeDir, S)?.sinceSeen?.state).toBe("armed");
  });

  test("a Stop's whole-record rewrite carries the state, so the hour holds across turns", () => {
    const w = world(at(9));
    wake(w, at(10));
    expect(prompt(w, at(10, 1))).toBeUndefined();
    w.set(at(10, 10));
    recordSession(storeDir, { sessionId: C, scope: YON, phase: "start", at: at(10, 10) });
    expect(prompt(w, at(10, 20))).toBe(`Since you started (10:00): ${tilde(YON)} open since 10:10.`);
    w.set(at(10, 21));
    w.hooks().stop({ sessionId: S, scope: HERE, at: D } as HookInput);
    expect(readSession(storeDir, S)?.sinceSeen).toEqual({ at: at(10, 20), state: "shown" });
    w.set(at(10, 30));
    recordSession(storeDir, { sessionId: "c9cacbce-0000-4000-8000-00000000000c", scope: THERE, phase: "start", at: at(10, 30) });
    expect(prompt(w, at(10, 40))).toBeUndefined();
  });
});
