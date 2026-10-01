/**
 * CONTINUITY, ROUND 2 (2026-10-01) — what a waking session reads first.
 *
 * An inside view of 0.3.10 found the first thing a returning session reads
 * out of date in several ways: a handoff that did not know it was stale, a
 * handoff whose provenance named the wrong date, a "Last here" line pairing an
 * episode's title with a later chapter's words, Nearby lines the page already
 * said, an answered question shown alone as open, and the same memory under
 * Arriving and Nearby. This file holds each fix to what it promises.
 *
 * Every fixture is invented (a garden, a bakery). Hermetic: every test makes
 * its own temp directory and removes it. The clock is pinned and the zone is
 * UTC.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { settle } from "../src/core/contradictions.js";
import { staleWords, versionOlder } from "../src/core/handoff/index.js";
import { LAST_HERE_NOROOM_EVENT, chapterFor, chaptersBySession, chaptersOn, firstChapter } from "../src/core/handoff/last-here.js";
import { rankLanes, scanActive, settledOver } from "../src/core/self/index.js";
import type { Ranked, Scanned } from "../src/core/self/index.js";
import { coveredByPage, wordsOf } from "../src/core/self/covered.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";
import { Store } from "../src/core/store/index.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";

const MIN = 60_000;
const ZONE = "UTC";
const DAY0 = Date.UTC(2026, 8, 30);
const at = (h: number, m: number): number => DAY0 + h * 60 * MIN + m * MIN;

const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const B = "b5b6b7b8-0000-4000-8000-00000000000b";
const C = "c9cacbcc-0000-4000-8000-00000000000c";

let root: string;
let storeDir: string;
let HERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-continuity2-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  mkdirSync(HERE, { recursive: true });
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

function afternoon(opts: { owner?: boolean } = {}): {
  c: Counterpart;
  set(t: number): void;
  server(session: string, scope?: string): McpServer;
  talk(session: string, t: number, scope?: string): void;
} {
  let now = at(15, 0);
  const c = Counterpart.open({ dir: storeDir, owner: opts.owner ?? true, now: () => now, timeZone: ZONE });
  open.push(c);
  const turns = new Map<string, { role: "user" | "assistant"; text: string }[]>();
  return {
    c,
    set(t: number): void {
      now = t;
    },
    server(session: string, scope = HERE): McpServer {
      return new McpServer({ counterpart: c, session, scope, owner: true, registryDir: storeDir, now: () => now });
    },
    talk(session: string, t: number, scope = HERE): void {
      now = t;
      const held = turns.get(session) ?? [];
      held.push({ role: "user", text: `(${session.slice(0, 4)} at ${String(t)}) the next bed, and what goes in it, talked over.` });
      held.push({ role: "assistant", text: `(${session.slice(0, 4)}) understood, and here is the plan for it.` });
      turns.set(session, held);
      c.captureSpans({ session, scope, turns: [...held] });
      c.boundary({ session, scope, kind: "stop" });
    },
  };
}

function wake(c: Counterpart, session: string, budget = 9_000, scope = HERE, exportsFrom?: (s: string) => boolean): string {
  return c.wake(budget, { date: "2026-09-30" }, { scope, session, ...(exportsFrom === undefined ? {} : { exportsFrom }) }).text;
}

type Row = { id: string; from?: string; excerpt?: string; recent?: boolean };
function rows(r: { structuredContent?: unknown }): Row[] {
  return ((r.structuredContent as Record<string, unknown>)["memories"] as Row[]) ?? [];
}

/** An episode as the journal writes it, with dated headings, put straight in. */
function episode(
  c: Counterpart,
  opts: { session: string; scope: string; title: string; chapters: readonly { date: string; text: string }[]; confidential?: boolean },
): string {
  const body = opts.chapters.map((ch, i) => `## chapter ${String(i + 1)} — ${ch.date} · lived day 0\n\n${ch.text}\n`).join("\n");
  return c.store.put({
    type: "episode",
    kind: "self",
    title: opts.title,
    body,
    meta: { sessionId: opts.session, chapters: opts.chapters.length, ...(opts.confidential === true ? { confidential: true } : {}) },
    source: "episode",
    origin: { session: opts.session, scope: opts.scope },
  });
}

/** A chapter's memory copy, as ingestion mints it, with an `about` mark. */
function copy(c: Counterpart, epi: string, session: string, scope: string, about: "me" | "work" | null, confidential = false): string {
  return c.store.put({
    type: "memory",
    kind: "self",
    body: "I chose the names for the seven garden beds, for how each one feels to walk through.",
    source: "episode",
    origin: { session, scope, ref: epi },
    ...(about === null ? {} : { about }),
    ...(confidential ? { meta: { confidential: true } } : {}),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
describe("a handoff's provenance is its writer's (item 2)", () => {
  test("recalled by id, a handoff says the session that wrote it, the directory and when — not 'an earlier session'", async () => {
    const k = afternoon();
    k.set(at(15, 19));
    const w = k.c.writeHandoff("The seed order is drafted; it goes out on Friday.", { scope: HERE, session: C });
    expect(w.written).toBe(true);
    k.set(at(18, 45));
    k.c.writeHandoff("The seed order went out; next is the cold frame lid.", { scope: HERE, session: C });
    k.talk(B, at(19, 0));
    const got = rows(await k.server(B).call("recall", { ids: [w.id as string] }));
    expect(got[0]?.from).toBe(`session c9cacbcc, ${HERE}, 09-30 18:45`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("'Last here' pairs the title with the chapter it names (item 3)", () => {
  const TITLE = "Planning the autumn beds";

  test("the line shows the FIRST chapter's first sentence under the episode's title, and how many chapters it holds", () => {
    const k = afternoon();
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    for (const m of [1, 20, 40]) k.talk(A, at(16, m));
    k.set(at(17, 0));
    const epi = episode(k.c, {
      session: A,
      scope: HERE,
      title: TITLE,
      chapters: [
        { date: "Wed 30 Sep 2026", text: "We planned the autumn beds: garlic first, broad beans after." },
        { date: "Wed 30 Sep 2026", text: "Later we checked that a new session could find the plan." },
      ],
    });
    const line = wake(k.c, B).split("\n").find((l) => l.startsWith("Last here:"));
    expect(line).toContain(`— "${TITLE}" (${epi}, 2 chapters). We planned the autumn beds: garlic first, broad beans after.`);
    expect(line).not.toContain("Later we checked");
  });

  test("firstChapter reads the engine's headings only; chapterFor picks the first chapter inside a window", () => {
    const body =
      "## chapter 1 — Tue 29 Sep 2026 · lived day 8\n\nFirst.\n\n## Chapter two of the book\n\nstill first\n\n## chapter 2 — Wed 30 Sep 2026 · lived day 9\n\nSecond.\n\n## chapter 3 — Wed 30 Sep 2026 · lived day 9\n\nThird.\n";
    expect(firstChapter(body)).toEqual({ text: "\n\nFirst.\n\n## Chapter two of the book\n\nstill first\n\n", count: 3 });
    expect(firstChapter("No heading.")).toEqual({ text: "No heading.", count: 1 });
    expect(chapterFor(body, null)).toMatchObject({ index: 0, count: 3 });
    expect(chapterFor(body, { from: "2026-09-30 00:00", to: "2026-09-30 23:59" })).toMatchObject({ index: 1, text: "\n\nSecond.\n\n" });
    expect(chapterFor(body, { from: "2026-10-05 00:00", to: "2026-10-05 23:59" })).toMatchObject({ index: 0 });
  });

  test("recall's time lead for a session that ran across days excerpts the chapter inside the window asked about", async () => {
    const k = afternoon();
    for (const m of [1, 20]) k.talk(A, at(-8, m));
    for (const m of [1, 20]) k.talk(A, at(10, m));
    k.set(at(10, 30));
    const epi = episode(k.c, {
      session: A,
      scope: HERE,
      title: "Two days in the garden",
      chapters: [
        { date: "Tue 29 Sep 2026", text: "On the first day we cleared the north bed of bindweed." },
        { date: "Wed 30 Sep 2026", text: "On the second day we sowed the broad beans in the cleared bed." },
      ],
    });
    k.set(at(14, 0));
    k.talk(B, at(14, 0));
    const got = rows(await k.server(B).call("recall", { question: "what did we do yesterday?" }));
    const lead = got.find((r) => r.id === epi);
    expect(lead?.excerpt).toBe(`(Chapter 1 of 2; recall ${epi} for every chapter.) On the first day we cleared the north bed of bindweed.`);
    const today = rows(await k.server(B).call("recall", { question: "what did we do this morning?" })).find((r) => r.id === epi);
    expect(today?.excerpt).toBe(`(Chapter 2 of 2; recall ${epi} for every chapter.) On the second day we sowed the broad beans in the cleared bed.`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the lanes: an answered question is not shown alone, and nothing shows twice (items 5 and 8)", () => {
  let dir: string;
  const stores: Store[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "counterparts-lanes2-"));
  });
  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const hint = (s: Store, body: string): string =>
    s.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.95, emotional: 0.9, predictive: 0.9 } });
  const horizonOf = (id: string): Ranked => ({ id, lane: "horizon", kind: "fact", band: "episodic", strength: 1, protected: false, bornDay: 0, personScoped: false, lastRendered: -1 });
  const shownBy = (s: Store, horizon: Ranked[] = []): string[] => {
    const lanes = rankLanes(scanActive(s, s.livedDay()), horizon, SELF_TUNABLES, { settledOver: settledOver(s) });
    return [...lanes.hints, ...lanes.threads, ...lanes.craft, ...lanes.horizon].map((r) => r.id);
  };
  const changed = (s: Store, holds: string, over: string): void => {
    expect(settle(s, { holds, over, how: "changed", actor: "owner", why: "settled in a test" }).ok).toBe(true);
  };

  test("a memory a later one settled over (changed or corrected) leaves Nearby and Arriving; the later one stays", () => {
    const s = Store.open({ dir });
    stores.push(s);
    const asked = hint(s, "Open: whether the bakery moves its opening to seven.");
    const answered = hint(s, "The bakery opens at seven from now on; the question is closed.");
    const other = hint(s, "The rye starter wants feeding twice a day in the warm weeks.");
    changed(s, answered, asked);
    expect([...settledOver(s)]).toEqual([asked]);
    const shown = shownBy(s, [horizonOf(asked)]);
    expect(shown).not.toContain(asked);
    expect(shown).toContain(answered);
    expect(shown).toContain(other);
  });

  test("a chain A → B → C: A and B leave while C is live; with C archived, B is back and A stays out", () => {
    const s = Store.open({ dir });
    stores.push(s);
    const a = hint(s, "The bakery opens at eight on weekdays, as it always has.");
    const b = hint(s, "The bakery opens at seven on weekdays from October.");
    const c = hint(s, "The bakery opens at half past six on weekdays from November.");
    changed(s, b, a);
    changed(s, c, b);
    expect(new Set(settledOver(s))).toEqual(new Set([a, b]));
    s.archive(c, "removed-by-test");
    expect(new Set(settledOver(s))).toEqual(new Set([a]));
    expect(shownBy(s)).toContain(b);
  });

  test("a holds that is gone hides nothing; a memory re-affirmed by a newer pair is not hidden by the older one", () => {
    const s = Store.open({ dir });
    stores.push(s);
    const x = hint(s, "The delivery van goes out on Tuesdays and Fridays.");
    const y = hint(s, "The delivery van goes out on Mondays only, for now.");
    changed(s, y, x);
    expect([...settledOver(s)]).toEqual([x]);
    s.archive(y, "removed-by-test");
    expect([...settledOver(s)]).toEqual([]);
    expect(shownBy(s)).toContain(x);

    const p = hint(s, "The ovens are cleaned on Sunday evening.");
    const q = hint(s, "The ovens are cleaned on Saturday evening.");
    const r = hint(s, "The ovens are cleaned whenever the week is quiet.");
    changed(s, q, p);
    expect(settledOver(s).has(p)).toBe(true);
    // Later p is re-affirmed: a newer pair has it HOLD over another.
    changed(s, p, r);
    const over = settledOver(s);
    expect(over.has(p)).toBe(false);
    expect(over.has(r)).toBe(true);
    expect(shownBy(s)).toContain(p);
  });

  test("a memory arriving is shown under Arriving only, not under Nearby too", () => {
    const s = Store.open({ dir });
    stores.push(s);
    const due = hint(s, "Pay the flour supplier before the fifteenth.");
    const plain = hint(s, "The cold frame lid needs a new hinge.");
    const lanes = rankLanes(scanActive(s, s.livedDay()), [horizonOf(due)], SELF_TUNABLES);
    expect(lanes.horizon.map((r) => r.id)).toEqual([due]);
    expect(lanes.hints.map((r) => r.id)).toEqual([plain]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a 'Last here' line dropped for room leaves a durable row (item 9)", () => {
  test("too small a ceiling: no line, and one row per chapter per lived day naming the chapter", async () => {
    const k = afternoon();
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0) });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    for (const m of [1, 20]) k.talk(A, at(16, m));
    k.set(at(16, 30));
    const ch = await k.server(A).call("chapter", { session: A, title: "Autumn beds", text: "We planned the autumn beds and wrote the plan down here." });
    const epi = (ch.structuredContent as Record<string, unknown>)["episodeId"] as string;
    const tight = new TextEncoder().encode(k.c.wake(9_000).text).length;
    for (let i = 0; i < 2; i++) expect(wake(k.c, B, tight)).not.toContain("Last here:");
    const logged = k.c.store.eventLog({ name: LAST_HERE_NOROOM_EVENT });
    expect(logged.length).toBe(1);
    expect(logged[0]?.ref).toBe(epi);
    expect(wake(k.c, B)).toContain("Last here:");
    expect(k.c.store.eventLog({ name: LAST_HERE_NOROOM_EVENT }).length).toBe(1);
  });

  test("only the about-me line dropped: no row (it names no chapter here)", () => {
    const k = afternoon();
    const THERE = join(root, "bakery");
    mkdirSync(THERE, { recursive: true });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    for (const m of [1, 20]) k.talk(A, at(16, m), THERE);
    const epi = episode(k.c, { session: A, scope: THERE, title: "Naming the beds", chapters: [{ date: "Wed 30 Sep 2026", text: "We named the beds." }] });
    copy(k.c, epi, A, THERE, "me");
    const tight = new TextEncoder().encode(k.c.wake(9_000).text).length;
    expect(wake(k.c, B, tight, HERE, () => true)).not.toContain("About me");
    expect(k.c.store.eventLog({ name: LAST_HERE_NOROOM_EVENT }).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a chapter about me reaches a wake in another directory, and only what may (item 7)", () => {
  function bakery(k: ReturnType<typeof afternoon>, about: "me" | "work" | null, opts: { confidential?: "episode" | "copy" } = {}): { epi: string; THERE: string } {
    const THERE = join(root, "bakery");
    mkdirSync(THERE, { recursive: true });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    for (const m of [1, 20]) k.talk(A, at(16, m), THERE);
    k.set(at(16, 30));
    const epi = episode(k.c, {
      session: A,
      scope: THERE,
      title: "Naming the garden beds",
      chapters: [{ date: "Wed 30 Sep 2026", text: "I chose the names for the seven beds, for how each feels to walk through." }],
      confidential: opts.confidential === "episode",
    });
    copy(k.c, epi, A, THERE, about, opts.confidential === "copy");
    return { epi, THERE };
  }
  const tilde = (p: string): string => p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");

  test("marked about me, from a directory that is on: one line, by title, id and where it was written", () => {
    const k = afternoon();
    const { epi, THERE } = bakery(k, "me");
    const line = wake(k.c, B, 9_000, HERE, () => true).split("\n").find((l) => l.startsWith("About me, from another directory:"));
    expect(line).toBe(`About me, from another directory: session a1b2c3d4, 09-30 in ${tilde(THERE)} — "Naming the garden beds" (${epi}).`);
    const there = wake(k.c, B, 9_000, THERE, () => true);
    expect(there).toContain("Last here: session a1b2c3d4");
    expect(there).not.toContain("About me, from another directory");
  });

  test("nothing crosses without a way to ask, from a directory that is not on, or marked work or unmarked", () => {
    for (const [about, exportsFrom] of [
      ["me", undefined],
      ["me", (): boolean => false],
      ["work", (): boolean => true],
      [null, (): boolean => true],
    ] as const) {
      const k = afternoon();
      bakery(k, about);
      expect(wake(k.c, B, 9_000, HERE, exportsFrom)).not.toContain("About me, from another directory");
      k.c.close();
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  test("a confidential chapter (the episode or its copy) never crosses, not even for the owner; Last here names it to the owner only", () => {
    for (const where of ["episode", "copy"] as const) {
      const owner = afternoon();
      const { THERE } = bakery(owner, "me", { confidential: where });
      expect(wake(owner.c, B, 9_000, HERE, () => true)).not.toContain("Naming the garden beds");
      expect(wake(owner.c, B, 9_000, THERE, () => true)).toContain("Last here:");
      owner.c.close();
      // The same store, read by a session that is not the owner's.
      const guest = Counterpart.open({ dir: storeDir, owner: false, now: () => at(17, 0), timeZone: ZONE });
      open.push(guest);
      for (const scope of [HERE, THERE, "claude-desktop:"]) expect(wake(guest, B, 9_000, scope, () => true)).not.toContain("Naming the garden beds");
      guest.close();
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  test("the host's scope setting decides: on exports, off and observer do not", () => {
    const k = afternoon();
    const { THERE } = bakery(k, "me");
    const config = join(root, "claude-code.json");
    const lc = new Lifecycle({ counterpart: k.c, config: { dataDir: storeDir }, configPath: config });
    const said = (): string => lc.composeWake({ sessionId: B, scope: HERE, at: "2026-09-30" }, 9_000).text;
    // No setting written: unset reads as on.
    expect(said()).toContain("About me, from another directory");
    for (const mode of ["off", "observer"] as const) {
      writeScopes(join(root, "scopes.json"), setScope(null, THERE, mode, { at: "2026-09-30" }));
      expect(said()).not.toContain("About me, from another directory");
    }
    writeScopes(join(root, "scopes.json"), setScope(null, THERE, "on", { at: "2026-09-30" }));
    expect(said()).toContain("About me, from another directory");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a handoff says when it may be out of date (item 1)", () => {
  function pointer(text: string): string | undefined {
    return text.split("\n").find((l) => l.startsWith("Where I left off in this directory"));
  }
  const here = (installed: string | null, openedWith?: (s: string) => string | null): Parameters<Counterpart["wake"]>[2] => ({
    scope: HERE,
    session: B,
    installed,
    ...(openedWith === undefined ? {} : { openedWith }),
  });

  test("written by an older release than the one installed: 'before 0.3.10 was installed'", () => {
    const k = afternoon();
    k.set(at(18, 45));
    k.c.writeHandoff("Waiting on the irrigation fix: when it is released, test the timer again.", { scope: HERE, session: C, build: "0.3.9" });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    const stale = pointer(k.c.wake(9_000, { date: "2026-09-30" }, here("0.3.10")).text);
    expect(stale).toContain("(written 09-30 18:45 by session c9cacbcc, before 0.3.10 was installed): Waiting on the irrigation fix");
    expect(pointer(k.c.wake(9_000, { date: "2026-09-30" }, here("0.3.9")).text)).not.toContain("was installed");
    expect(pointer(k.c.wake(9_000, { date: "2026-09-30" }, here(null)).text)).not.toContain("was installed");
  });

  test("a row from before the stamp falls back to the release its session opened with", () => {
    const k = afternoon();
    k.set(at(18, 45));
    k.c.writeHandoff("Waiting on the release.", { scope: HERE, session: C });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    const text = k.c.wake(9_000, { date: "2026-09-30" }, here("0.3.10", (s) => (s === C ? "0.3.9" : null))).text;
    expect(pointer(text)).toContain("by session c9cacbcc, before 0.3.10 was installed");
  });

  test("another session wrote a chapter here after it: 'a newer chapter here since'; the writer's own does not count", async () => {
    const k = afternoon();
    k.set(at(15, 19));
    k.c.writeHandoff("The seed order is drafted; it goes out on Friday.", { scope: HERE, session: C });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    k.talk(C, at(15, 20));
    k.set(at(15, 25));
    const own = await k.server(C).call("chapter", { session: C, title: "Drafting the seed order", text: "The seed order was drafted, priced, and left ready to send on Friday." });
    expect(own.isError).not.toBe(true);
    expect(k.c.chaptersHereFor(HERE, null).map((c) => c.chapter.session)).toEqual([C]);
    expect(pointer(wake(k.c, B))).not.toContain("a newer chapter here since");
    for (const m of [1, 20]) k.talk(A, at(16, m));
    k.set(at(16, 30));
    const r = await k.server(A).call("chapter", { session: A, title: "Autumn beds", text: "We planned the autumn beds: garlic first, broad beans after, and the frost dates." });
    expect(r.isError).not.toBe(true);
    expect(pointer(wake(k.c, B))).toContain("(written 09-30 15:19 by session c9cacbcc, a newer chapter here since");
  });

  test("versions compare by number, a pre-release before its release", () => {
    expect(versionOlder("0.3.9", "0.3.10")).toBe(true);
    expect(versionOlder("0.3.10", "0.3.9")).toBe(false);
    expect(versionOlder("0.3.10-rc.1", "0.3.10")).toBe(true);
    expect(versionOlder("0.3.10", "0.3.10")).toBe(false);
    expect(versionOlder(null, "0.3.10")).toBe(false);
    expect(versionOlder("not a version", "0.3.10")).toBe(false);
    expect(staleWords({ writtenWith: "0.3.9", installed: "0.3.10", newerChapter: true })).toBe(
      "before 0.3.10 was installed, and a newer chapter here since",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Nearby leaves out what the page already says (item 6)", () => {
  const PAGE =
    "## Core\n\nI keep the bakery's books with Ida. The rye starter came from her grandmother's kitchen in Tartu, and I tend it as a promise kept for her family.\n\n## How I work\n\nOne item at a time, shown rather than described.";
  const doc = (id: string, body: string): Scanned => ({ id, doc: { body } }) as unknown as Scanned;
  const filler = Array.from({ length: 20 }, (_, i) => doc(`mem_${String(i)}`, `Ordinary filler memory number ${String(i)} about gardens, frost dates, broad beans and garlic planting.`));

  test("a near restatement of one page sentence is covered; a cited one is covered; a new fact on a subject the page mentions is not", () => {
    const scanned = [
      doc("mem_restated", "The rye starter came from Ida's grandmother's kitchen in Tartu; I tend it as a promise kept for her family."),
      doc("mem_new", "Ida says the rye starter rose slowly this week because the bakery's kitchen was cold overnight, so we moved it near the oven."),
      doc("mem_cited", "A line the reflection drew the page from, in other words entirely, about something else again."),
      ...filler,
    ];
    const covered = coveredByPage(PAGE, scanned, new Set(["mem_cited"]));
    expect(covered.has("mem_restated")).toBe(true);
    expect(covered.has("mem_cited")).toBe(true);
    expect(covered.has("mem_new")).toBe(false);
    expect(covered.has("mem_3")).toBe(false);
    expect(coveredByPage(null, scanned).size).toBe(0);
  });

  test("three-letter names count; sentence furniture does not", () => {
    expect(wordsOf("Ida and Sam met The baker").has("ida")).toBe(true);
    expect(wordsOf("Ida and Sam met The baker").has("sam")).toBe(true);
    expect(wordsOf("Ida and Sam met The baker").has("the")).toBe(false);
    expect(wordsOf("ida in lower case is not a name").has("ida")).toBe(false);
  });

  test("the lanes leave a covered hint out of Nearby only", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-covered-"));
    const s = Store.open({ dir });
    try {
      const put = (body: string): string => s.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.95, emotional: 0.9, predictive: 0.9 } });
      const a = put("The rye starter came from a family kitchen and is kept as a promise.");
      const b = put("The cold frame lid needs a new hinge before the frost.");
      const lanes = rankLanes(scanActive(s, s.livedDay()), [], SELF_TUNABLES, { coveredByPage: new Set([a]) });
      expect(lanes.hints.map((r) => r.id)).toEqual([b]);
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("confidential titles stay out of the stored Yesterday line, and the walks stay fast (review of #311)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "counterparts-round2-perf-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (s: Store, title: string, meta: Record<string, unknown> = {}, session = A): string =>
    s.put({
      type: "episode",
      kind: "self",
      title,
      body: "## chapter 1 — Tue 29 Sep 2026 · lived day 0\n\nThe beds were weeded and the paths raked.\n",
      meta: { sessionId: session, chapters: 1, ...meta },
      source: "episode",
      origin: { session, scope: "/tmp/garden" },
    });

  test("Yesterday lists neither a confidential episode nor one with a confidential copy", () => {
    const s = Store.open({ dir });
    try {
      const plain = put(s, "Weeding the beds");
      const secret = put(s, "A private matter", { confidential: true });
      const viaCopy = put(s, "Another private matter");
      s.put({ type: "memory", kind: "fact", body: "A private detail from that chapter.", source: "episode", origin: { session: A, ref: viaCopy }, meta: { confidential: true } });
      const ids = chaptersOn(s, "2026-09-29").map((d) => d.id);
      expect(ids).toEqual([plain]);
      expect(ids).not.toContain(secret);
    } finally {
      s.close();
    }
  });

  test("one grouped read: 300 episodes among 15,000 memories walk well inside 200 ms", () => {
    const s = Store.open({ dir });
    try {
      const episodes: string[] = [];
      for (let i = 0; i < 300; i++) episodes.push(put(s, `Garden day ${String(i)}`, {}, `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`));
      for (let i = 0; i < 14_700; i++) {
        s.put({
          type: "memory",
          kind: "fact",
          body: `Garden note ${String(i)}: the bed by the fence wants mulch before the frost comes.`,
          ...(i % 50 === 0 ? { source: "episode", origin: { session: A, ref: episodes[i % 300] as string }, about: "me" as const } : {}),
        });
      }
      const t0 = performance.now();
      const all = chaptersBySession(s, { fromDay: 0 });
      const ms = performance.now() - t0;
      expect(all.size).toBe(300);
      expect([...all.values()].some((c) => c.aboutMe === true)).toBe(true);
      expect(ms).toBeLessThan(200);
    } finally {
      s.close();
    }
  }, 300_000);

  test("a 400-settle chain is read once per memory, not once per link", () => {
    const s = Store.open({ dir });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 401; i++) ids.push(s.put({ type: "memory", kind: "fact", body: `The bakery opens at ${String(i)} minutes past six from week ${String(i)}.` }));
      for (let i = 1; i < ids.length; i++) {
        expect(settle(s, { holds: ids[i] as string, over: ids[i - 1] as string, how: "changed", actor: "owner", why: "chain" }).ok).toBe(true);
      }
      const t0 = performance.now();
      const over = settledOver(s);
      const ms = performance.now() - t0;
      expect(over.size).toBe(400);
      expect(over.has(ids[400] as string)).toBe(false);
      expect(ms).toBeLessThan(500);
    } finally {
      s.close();
    }
  }, 300_000);
});
