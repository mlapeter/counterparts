/**
 * BUILD B (2026-09-28): fitting what a mechanism has into the room it has —
 * a line for everything, the whole text for the most important, ids and a
 * named, batchable lookup for the rest, a count of what waits, carried over.
 * The fitter itself; the dream's queue, detail by importance, chapters as
 * slices and parts; the begin result at the host's real limit, measured the
 * way the MCP server sends it; and the lookup measured.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called:
 * the dreamer is the test, calling the modules and the MCP tools.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lookupFindings } from "../src/adapters/claude-code/doctor.js";
import { McpServer, RECALL_MAX_IDS } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, REFLECT_TUNABLES } from "../src/core/dream/index.js";
import type { DreamBundle, DreamItem } from "../src/core/dream/index.js";
import { chapterEntries } from "../src/core/dream/slices.js";
import { clipBytes, derivedFrom, fit, lineOf, packParts, readIndex, wireChars } from "../src/core/fit/index.js";
import { chapterHeading } from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
let offsetMs = 0;
const SESSION = "s-fit";

beforeEach(() => {
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-fit-"));
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
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, now: () => Date.now() + offsetMs });
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

function server(c: Counterpart): McpServer {
  recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
  return new McpServer({ counterpart: c, scope: "/proj", owner: true, registryDir: dir, now: () => Date.now() + offsetMs });
}

function textOf(res: { content?: readonly { text?: string }[] }): string {
  return res.content?.[0]?.text ?? "";
}

function days(c: Counterpart, from = 10, to = 20): void {
  for (let d = from; d <= to; d += 1) c.store.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
}

// ---------------------------------------------------------------------------
// the fitter
// ---------------------------------------------------------------------------

describe("the fitter: a line for everything, whole for the most important, what does not fit waits", () => {
  const cand = (id: string, priority: number, whole: string, line = whole.slice(0, 20)): { id: string; priority: number; line: string; whole: string } => ({ id, priority, whole, line });

  test("breadth first: every candidate gets its line before any gets its whole text; whole goes by priority", () => {
    const long = "x".repeat(500);
    const out = fit([cand("a", 1, long), cand("b", 3, long), cand("c", 2, long)], { room: 3 * (10 + 20) + 480 + 10, excerptChars: 1_000, overhead: 10 });
    expect(out.placed.map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(out.placed.map((p) => p.fidelity)).toEqual(["whole", "line", "line"]);
    for (const p of out.placed) expect(p.chars).toBe(500);
    expect(out.report).toMatchObject({ candidates: 3, whole: 1, lined: 2, waiting: 0 });
  });

  test("an item longer than the detail cap is an excerpt that says its whole length", () => {
    const out = fit([cand("a", 1, "y".repeat(5_000))], { room: 10_000, excerptChars: 1_000, overhead: 10 });
    const [p] = out.placed;
    expect(p?.fidelity).toBe("excerpt");
    expect(p?.text.length).toBeLessThanOrEqual(1_000);
    expect(p?.text.length).toBeGreaterThan(990);
    expect(p?.text.endsWith("…")).toBe(true);
    expect(p?.chars).toBe(5_000);
  });

  test("what cannot have even its least waits, counted, in priority order; ids are the least by default", () => {
    const out = fit([cand("a", 1, "a text"), cand("b", 2, "b text"), cand("c", 3, "c text")], { room: 25, excerptChars: 100, overhead: 10 });
    expect(out.placed.map((p) => p.id)).toEqual(["c", "b"]);
    expect(out.waiting).toEqual(["a"]);
    expect(out.report.waiting).toBe(1);
    const lines = fit([cand("a", 1, "a".repeat(50)), cand("b", 2, "b".repeat(50))], { room: 50, excerptChars: 100, overhead: 10, least: "line" });
    expect(lines.placed.map((p) => p.id)).toEqual(["b"]);
    expect(lines.waiting).toEqual(["a"]);
  });

  test("a short memory's line is its whole text: shown whole at a line's cost", () => {
    const out = fit([cand("a", 1, "short")], { room: 100, excerptChars: 100, overhead: 10 });
    expect(out.placed[0]).toEqual({ id: "a", fidelity: "whole", text: "short", chars: 5 });
  });

  test("lineOf: the title when there is one, else the first substantive line — never a chapter heading — kept to its bytes and said", () => {
    expect(lineOf({ title: " A title ", body: "the body" })).toBe("A title");
    expect(lineOf({ body: `${chapterHeading(1, 3, "2026-09-23")}\n\n## \n- Mike opened the session with the release.` })).toBe("Mike opened the session with the release.");
    const cut = lineOf({ body: "é".repeat(200) }, 20);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(20);
    expect(cut.endsWith("…")).toBe(true);
    expect(clipBytes("short", 20)).toBe("short");
  });

  test("derivedFrom: one reader for the nine keys that say what a row was made from", () => {
    const meta = { mergedFrom: ["m1", "m2"], sources: ["s1"], revisedFrom: "r1", groundedIn: ["g1"], episodeId: "epi_1", unrelated: "x" };
    expect(derivedFrom({ meta: JSON.stringify(meta) })).toEqual([
      { id: "m1", how: "merged-from" },
      { id: "m2", how: "merged-from" },
      { id: "s1", how: "gist-of" },
      { id: "g1", how: "grounded-in" },
      { id: "r1", how: "revised-from" },
      { id: "epi_1", how: "episode" },
    ]);
    expect(derivedFrom({ meta: "not json" })).toEqual([]);
  });

  test("packParts: the first part to its room, each later to its own; a piece too big stands alone", () => {
    const parts = packParts([{ size: 5 }, { size: 5 }, { size: 5 }, { size: 30 }, { size: 5 }], 10, 12);
    expect(parts.map((p) => p.map((x) => x.size))).toEqual([[5, 5], [5], [30], [5]]);
    expect(packParts([{ size: 1 }], 10, 10)).toHaveLength(1);
  });

  test("an episode's entries, cut at its chapter headings — stacked headings stay one entry", () => {
    const body = `${chapterHeading(1, 2)}\n\nThe first chapter.\n\n${chapterHeading(2, 3, "2026-09-24")}\n## chapter 2\n\nThe second.\n\n${chapterHeading(3, 5)}\n\nThe third.\n`;
    const entries = chapterEntries(body);
    expect(entries.map((e) => [e.index, e.chapter, e.day, e.text])).toEqual([
      [0, 1, 2, "The first chapter."],
      [1, 2, 3, "The second."],
      [2, 3, 5, "The third."],
    ]);
  });
});

// ---------------------------------------------------------------------------
// the dream's queue
// ---------------------------------------------------------------------------

describe("the dream's new memories are a queue: ranked by label, what does not fit waits and is carried over", () => {
  test("a night too full: tonight's room takes the most important, the rest wait — counted in the bundle, the gate and the hand-back — and come as new the next night", () => {
    const c = brain();
    days(c);
    // Plenty of new memories, each long enough that their lines fill
    // tonight's share for the new. The first one written is the most salient.
    const salient = mem(c, `The release broke the owner's trust — ${"a charged detail. ".repeat(30)}`, { salience: { relevance: 1, emotional: 1, predictive: 1 } });
    const ids: string[] = [];
    for (let i = 0; i < 220; i += 1) ids.push(mem(c, `Plain note ${String(i)} — ${"something ordinary about the build pipeline and its caches, ".repeat(6)}`, { salience: { relevance: 0.2, emotional: 0, predictive: 0.2 } }));
    expect(c.dreams.previewAsk({ at: "2026-09-20" }).newSince).toBe(221);
    // The per-prompt gate stops at what it needs, and says so.
    const before = c.dreams.status("2026-09-20");
    expect(before.newSince).toBe(DREAM_TUNABLES.MIN_NEW);
    expect(before.newSinceAtLeast).toBe(true);
    const d = c.dreams.begin({ session: SESSION, at: "2026-09-20" });
    if (!d.ok) throw new Error(d.reason);
    const q = d.bundle.queue;
    expect(q.new).toBe(221);
    expect(q.tonight + q.waiting).toBe(221);
    expect(q.waiting).toBeGreaterThan(0);
    expect(q.windowDays).toBe(DREAM_TUNABLES.QUEUE_DAYS);
    // By label, not by position: the most salient is first although it was written first.
    expect(d.bundle.fresh[0]?.id).toBe(salient);
    const shown = new Set(JSON.parse(c.store.dream(d.bundle.dream)?.shown ?? "[]") as string[]);
    const waiting = ids.filter((id) => !shown.has(id));
    expect(waiting.length).toBe(q.waiting);
    const j = c.dreams.journal({ dream: d.bundle.dream, session: SESSION, text: "A crowded night." });
    if (!j.ok) throw new Error(String(j.reason));
    expect(j.handBack).toContain(`${String(q.waiting)} new memories wait for the next night`);
    // The next night: what waited is the queue, and the gate counts it.
    days(c, 21, 21);
    expect(c.dreams.previewAsk({ at: "2026-09-21" }).newSince).toBe(q.waiting);
    const next = c.dreams.begin({ session: SESSION, at: "2026-09-21" });
    if (!next.ok) throw new Error(next.reason);
    const nextFresh = new Set(next.bundle.fresh.map((f) => f.id));
    for (const id of waiting.slice(0, 20)) expect(nextFresh.has(id) || next.bundle.queue.waiting > 0).toBe(true);
    expect(next.bundle.fresh.some((f) => waiting.includes(f.id))).toBe(true);
    const sawBefore = [...shown].filter((id) => nextFresh.has(id));
    expect(sawBefore).toEqual([]);
  }, 60_000);

  test("past the window a never-dreamed memory leaves the queue, and the count of those that aged out is said", () => {
    const c = brain();
    days(c);
    mem(c, "An early memory, dreamed tonight.");
    const d = c.dreams.begin({ session: SESSION, at: "2026-09-20" });
    if (!d.ok) throw new Error(d.reason);
    c.dreams.journal({ dream: d.bundle.dream, session: SESSION, text: "One." });
    // Made after the dream began, then left: never shown to a dream.
    days(c, 21, 21);
    const missed = [mem(c, "A memory no dream got to."), mem(c, "Another no dream got to.")];
    days(c, 22, 30);
    mem(c, "Something new, nine days on.");
    const q = c.dreams.begin({ session: SESSION, at: "2026-09-30" });
    if (!q.ok) throw new Error(q.reason);
    expect(q.bundle.queue.agedOut).toBe(missed.length);
    expect(q.bundle.fresh.map((f) => f.id).some((id) => missed.includes(id))).toBe(false);
  });

  test("every memory shown says why it is here, what it is about, its strongest feeling and its whole length; detail by importance, never a flat 400", () => {
    const c = brain();
    days(c);
    const long = mem(c, `A long, important memory. ${"It goes on in detail about what mattered. ".repeat(40)}`, { salience: { relevance: 1, emotional: 0.9, predictive: 1 }, about: "us" });
    c.store.addFeelings(long, [{ whose: "self", core: "happy", emotion: "proud", strength: 0.8, carriedBy: "we shipped it" }]);
    mem(c, "A short one.");
    mem(c, "Another short one.");
    const d = c.dreams.begin({ session: SESSION, at: "2026-09-20" });
    if (!d.ok) throw new Error(d.reason);
    const item = d.bundle.memories[long] as DreamItem;
    expect(item.why).toBe("new");
    expect(item.fidelity).toBe("whole");
    expect(item.text.length).toBeGreaterThan(400);
    expect(item.chars).toBe(item.text.length);
    expect(item.about).toBe("us");
    expect(item.feeling).toBe("proud");
    expect(d.bundle.lookup).toContain("recall");
  });
});

// ---------------------------------------------------------------------------
// chapters as slices
// ---------------------------------------------------------------------------

describe("chapters as slices: the new entries since the last dream, a line each, whole by importance", () => {
  test("a grown episode sends only the entries added since the last dream — the new chapter is never the one cut", () => {
    const c = brain();
    days(c, 10, 12);
    const first = `${chapterHeading(1, c.store.livedDay())}\n\nMike and I started the release checklist.\n\n${chapterHeading(2, c.store.livedDay())}\n\nWe found the migration bug.\n`;
    const epi = c.store.put({ type: "episode", kind: "self", body: first, source: "episode" });
    mem(c, "The migration step must run first.");
    mem(c, "Mike wants the checklist in the repo.");
    mem(c, "I noticed I rush the end of a task.");
    const d1 = c.dreams.begin({ session: SESSION, at: "2026-09-12" });
    if (!d1.ok) throw new Error(d1.reason);
    const ch1 = d1.bundle.chapters.find((x) => x.id === epi);
    expect(ch1?.entries.map((e) => e.chapter)).toEqual([1, 2]);
    c.dreams.journal({ dream: d1.bundle.dream, session: SESSION, text: "One." });
    days(c, 13, 14);
    offsetMs += 1_000;
    const grown = `${first}\n${chapterHeading(3, c.store.livedDay())}\n\nI decided to slow down and felt proud when the release went out clean.\n`;
    c.store.revise(epi, { body: grown });
    mem(c, "The release went out clean.");
    mem(c, "Slowing down helped.");
    mem(c, "Mike said thank you.");
    const d2 = c.dreams.begin({ session: SESSION, at: "2026-09-14" });
    if (!d2.ok) throw new Error(d2.reason);
    const ch2 = d2.bundle.chapters.find((x) => x.id === epi);
    expect(ch2?.entries.map((e) => e.chapter)).toEqual([3]);
    expect(ch2?.earlier).toBe(2);
    expect(ch2?.entries[0]?.text).toContain("felt proud");
  });
});

// ---------------------------------------------------------------------------
// the begin result at the real limit
// ---------------------------------------------------------------------------

describe("the dream's begin result at the REAL limit, measured as the MCP server sends it", () => {
  test("a busy night: begin under RESULT_CHARS, every part under PART_CHARS, every shown memory in exactly one part, and the lookup named", async () => {
    const c = brain();
    c.store.advanceClock("2026-09-10");
    const long = "\"said\" \"so\" \"plainly\" ".repeat(20);
    for (let i = 0; i < 120; i += 1) mem(c, `Older memory ${String(i)} of a busy week: ${long}`, { kind: "fact" });
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    for (let i = 0; i < 90; i += 1) {
      mem(c, `Memory ${String(i)} of a busy day: ${long}${"and more said at length. ".repeat(i % 7 === 0 ? 300 : 1)}`, { kind: i % 3 === 0 ? "person" : i % 3 === 1 ? "self" : "fact", about: i % 2 === 0 ? "us" : "me" });
    }
    const page = `## Core\n\n${"\"A\" \"quoted\" \"page\". ".repeat(700)}`;
    expect(c.revisePage(page, { reason: "a long page", by: "owner" }).written).toBe(true);
    const s = server(c);
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    expect(textOf(begin).length).toBeLessThanOrEqual(DREAM_TUNABLES.RESULT_CHARS);
    const dreamId = begin.structuredContent["dream"] as string;
    const how = begin.structuredContent["how"] as string;
    expect(how).toContain(`up to ${String(RECALL_MAX_IDS)} at once`);
    const parts = begin.structuredContent["parts"] as { of: number } | undefined;
    expect(parts?.of ?? 1).toBeGreaterThan(1);
    const bundle = JSON.parse(((JSON.parse(textOf(begin)) as { bundle: string }).bundle).split("\n").slice(1).join("\n")) as DreamBundle;
    const seen = new Set(Object.keys(bundle.memories));
    for (let k = 2; k <= (parts?.of ?? 1); k += 1) {
      const p = await s.call("dream", { phase: "part", session: SESSION, dream: dreamId, part: k });
      expect(p.isError ?? false).toBe(false);
      expect(textOf(p).length).toBeLessThanOrEqual(DREAM_TUNABLES.PART_CHARS);
      const body = JSON.parse(((JSON.parse(textOf(p)) as { bundle: string }).bundle).split("\n").slice(1).join("\n")) as { memories: Record<string, unknown> };
      for (const id of Object.keys(body.memories)) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    const shown = JSON.parse(c.store.dream(dreamId)?.shown ?? "[]") as string[];
    expect([...seen].sort()).toEqual([...shown].sort());
    // Nothing whole-cut silently: every item says its whole length.
    for (const item of Object.values(bundle.memories)) expect(item.chars).toBeGreaterThanOrEqual(item.text.replace(/…$/, "").length);
    const none = await s.call("dream", { phase: "part", session: SESSION, dream: dreamId, part: (parts?.of ?? 1) + 1 });
    expect(none.isError).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// the reflection: the whole core, the lists fitted
// ---------------------------------------------------------------------------

describe("the reflection is handed the whole core — a line each at least, the most felt whole", () => {
  test("thirty core memories are all in the core list (was the 20 most felt); every one carries its fidelity and its whole length", () => {
    const c = brain();
    days(c);
    const core: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      core.push(mem(c, `Core memory ${String(i)}: who I am, said at some length. ${"More of it. ".repeat(30)}`, { kind: "self", about: "me", physics: { birthDay: 0, lastUsedDay: 0, promotedIdentity: true } }));
    }
    mem(c, "Something lived today.");
    const r = c.reflections.begin({ session: SESSION });
    if (!r.ok) throw new Error(r.reason);
    expect([...r.bundle.core].sort()).toEqual([...core].sort());
    for (const id of core) {
      const item = r.bundle.memories[id];
      expect(item).toBeDefined();
      expect(["whole", "excerpt", "line", "id"]).toContain(item?.fidelity as string);
      expect(item?.chars).toBeGreaterThan(0);
    }
    expect(r.bundle.shownAs.notShown).toBe(0);
    expect(r.bundle.lookup).toContain("recall");
  });
});

// ---------------------------------------------------------------------------
// review of build B: what the first pass missed
// ---------------------------------------------------------------------------

describe("review of build B (#277)", () => {
  test("journal entries the room did not take come the next night, though the episode did not grow — 160 entries over two nights, none lost", () => {
    const c = brain();
    days(c, 10, 12);
    const day = c.store.livedDay();
    const body = Array.from({ length: 160 }, (_, i) => `${chapterHeading(i + 1, day)}\n\nEntry ${String(i + 1)}: ${"what happened, told plainly and at some length. ".repeat(5)}`).join("\n\n");
    const epi = c.store.put({ type: "episode", kind: "self", body, source: "episode" });
    for (let i = 0; i < 3; i += 1) mem(c, `Night one memory ${String(i)}.`);
    const seen = new Set<number>();
    const d1 = c.dreams.begin({ session: SESSION, at: "2026-09-12" });
    if (!d1.ok) throw new Error(d1.reason);
    const ch1 = d1.bundle.chapters.find((x) => x.id === epi);
    for (const e of ch1?.entries ?? []) seen.add(e.chapter ?? -1);
    expect(ch1?.notShown ?? 0).toBeGreaterThan(0);
    c.dreams.journal({ dream: d1.bundle.dream, session: SESSION, text: "One." });
    days(c, 13, 13);
    offsetMs += 1_000;
    for (let i = 0; i < 3; i += 1) mem(c, `Night two memory ${String(i)}.`);
    const d2 = c.dreams.begin({ session: SESSION, at: "2026-09-13" });
    if (!d2.ok) throw new Error(d2.reason);
    const ch2 = d2.bundle.chapters.find((x) => x.id === epi);
    for (const e of ch2?.entries ?? []) seen.add(e.chapter ?? -1);
    expect(ch2?.notShown ?? 0).toBe(0);
    expect(seen.size).toBe(160);
  }, 60_000);

  test("a lookup counts as the index's only while its run is open (plus a short grace), not an ordinary session's later", async () => {
    const c = brain();
    days(c);
    const big = mem(c, `The long one. ${"Every detail, step by step. ".repeat(200)}`, { salience: { relevance: 1, emotional: 0.5, predictive: 1 } });
    mem(c, "Two.");
    mem(c, "Three.");
    const s = server(c);
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    const dreamId = begin.structuredContent["dream"] as string;
    await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "Done." });
    offsetMs += 60 * 60_000;
    await s.call("recall", { ids: [big] });
    const row = c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
    expect(JSON.parse(row?.payload ?? "{}").fromIndex).toBeUndefined();
  });

  test("the hand-back's waiting count leaves out what was made during the night; the gate counts only as far as MIN_NEW", () => {
    const c = brain();
    days(c);
    for (let i = 0; i < 4; i += 1) mem(c, `Before the night ${String(i)}.`);
    const d = c.dreams.begin({ session: SESSION, at: "2026-09-20" });
    if (!d.ok) throw new Error(d.reason);
    offsetMs += 1_000;
    for (let i = 0; i < 5; i += 1) mem(c, `Made during the night ${String(i)}.`);
    const j = c.dreams.journal({ dream: d.bundle.dream, session: SESSION, text: "Night." });
    if (!j.ok) throw new Error(String(j.reason));
    expect(j.handBack).not.toContain("wait for the next night");
  });

  test("CJK at the real limits: dream begin, its parts and the reflection's begin stay under the ceilings by what they cost, not by characters", async () => {
    const c = brain();
    c.store.advanceClock("2026-09-10");
    const zh = "我们今天讨论了发布流程和迁移步骤，决定先运行迁移再启动容器。".repeat(8);
    for (let i = 0; i < 120; i += 1) mem(c, `旧的记忆 ${String(i)}：${zh}`, { kind: "fact" });
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    for (let i = 0; i < 90; i += 1) mem(c, `今天的记忆 ${String(i)}：${zh}${i % 9 === 0 ? zh.repeat(20) : ""}`, { kind: i % 2 === 0 ? "person" : "self", about: i % 2 === 0 ? "us" : "me" });
    expect(c.revisePage(`## Core\n\n${"我是谁，我如何工作。".repeat(500)}`, { reason: "a long page", by: "owner" }).written).toBe(true);
    const s = server(c);
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    expect(wireChars(textOf(begin))).toBeLessThanOrEqual(DREAM_TUNABLES.RESULT_CHARS);
    const dreamId = begin.structuredContent["dream"] as string;
    const parts = (begin.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1;
    expect(parts).toBeGreaterThan(1);
    for (let k = 2; k <= parts; k += 1) {
      const p = await s.call("dream", { phase: "part", session: SESSION, dream: dreamId, part: k });
      expect(wireChars(textOf(p))).toBeLessThanOrEqual(DREAM_TUNABLES.PART_CHARS);
    }
    // The bundle rides in the structured copy too — it is what Claude Code hands
    // the model (2026-09-29) — and that copy, serialized, is under the ceiling as well.
    expect(typeof begin.structuredContent["bundle"]).toBe("string");
    expect(wireChars(JSON.stringify(begin.structuredContent))).toBeLessThanOrEqual(DREAM_TUNABLES.RESULT_CHARS);
    await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "梦。" });
    const r = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
    expect(r.isError ?? false).toBe(false);
    expect(wireChars(textOf(r))).toBeLessThanOrEqual(REFLECT_TUNABLES.RESULT_CHARS);
    const rid = r.structuredContent["reflection"] as string;
    const rparts = (r.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1;
    for (let k = 2; k <= rparts; k += 1) {
      const p = await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: k });
      expect(wireChars(textOf(p))).toBeLessThanOrEqual(REFLECT_TUNABLES.PART_CHARS);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// the lookup, measured
// ---------------------------------------------------------------------------

describe("the lookup is measured: an expansion of what an index offered in part is counted, per mechanism", () => {
  test("recall by id of an excerpt the dream was shown: counted on the recall row, marked fetched, and a merge from it records whole fidelity", async () => {
    const c = brain();
    days(c);
    const big = mem(c, `The long one. ${"Every detail of the migration, step by step. ".repeat(150)}`, { salience: { relevance: 1, emotional: 0.5, predictive: 1 } });
    const twin = mem(c, "The long one, in short: the migration, step by step.");
    mem(c, "A third, unrelated.");
    const s = server(c);
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    const dreamId = begin.structuredContent["dream"] as string;
    const index = readIndex(c.store, "dream");
    expect(index?.ref).toBe(dreamId);
    expect(index?.offered.excerpt).toContain(big);
    const r = await s.call("recall", { ids: [big, twin] });
    expect(r.isError ?? false).toBe(false);
    const row = c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
    const payload = JSON.parse(row?.payload ?? "{}") as { fromIndex?: Record<string, number> };
    expect(payload.fromIndex).toEqual({ dream: 1 });
    expect(readIndex(c.store, "dream")?.looked).toContain(big);
    const m = c.dreams.propose({ dream: dreamId, session: SESSION, changes: [{ action: "merge", ids: [big, twin], text: "The migration, step by step, in one memory." }] });
    if (!m.ok) throw new Error(m.reason);
    expect(m.results[0]?.ok).toBe(true);
    const change = c.store.dreamChanges(dreamId).find((x) => x.action === "merge");
    expect(JSON.parse(change?.detail ?? "{}")).toMatchObject({ fidelity: { [big]: "whole", [twin]: "whole" } });
    const begun = c.store.eventLog({ name: "dream.begun", order: "desc", limit: 1 })[0];
    expect(JSON.parse(begun?.payload ?? "{}")).toMatchObject({ offered: 1, excerpt: 1 });
    // Surfaced in doctor.
    const [f] = lookupFindings(c.store);
    expect(f?.title).toBe("Lookups");
    expect(f?.detail).toContain("dream: 1 looked up of 1 offered in part, over 1 night");
    expect(f?.data).toMatchObject({ dreamOffered: 1, dreamLooked: 1, dreamNights: 1 });
  });

  test("a lookup of what an index showed whole, or of an old index, is not counted; doctor says when nothing was looked up", async () => {
    const c = brain();
    days(c);
    const a = mem(c, "Short and whole.");
    mem(c, "Another.");
    mem(c, `Long. ${"detail ".repeat(1_000)}`);
    const s = server(c);
    await s.call("dream", { phase: "begin", session: SESSION });
    await s.call("recall", { ids: [a] });
    const row = c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
    expect(JSON.parse(row?.payload ?? "{}").fromIndex).toBeUndefined();
    expect(lookupFindings(c.store)[0]?.detail).toContain("None looked up yet");
  });

  test("the reflection's index is measured the same way, and its fit is on its row", async () => {
    const c = brain();
    days(c);
    const big = mem(c, `Mike and I, a long one. ${"what happened between us, in detail. ".repeat(200)}`, { kind: "person", about: "us", salience: { relevance: 1, emotional: 0.9, predictive: 1 } });
    mem(c, "A small thing.");
    mem(c, "Another small thing.");
    const s = server(c);
    const begin = await s.call("reflect", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    expect(begin.structuredContent["how"] as string).toContain(`up to ${String(RECALL_MAX_IDS)} at once`);
    const rid = begin.structuredContent["reflection"] as string;
    expect(JSON.parse(c.store.reflection(rid)?.detail ?? "{}").fit).toMatchObject({ excerpt: 1 });
    await s.call("recall", { ids: [big] });
    const row = c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
    expect(JSON.parse(row?.payload ?? "{}").fromIndex).toEqual({ reflection: 1 });
    expect(lookupFindings(c.store)[0]?.detail).toContain("reflection: 1 looked up of");
  });
});

// ---------------------------------------------------------------------------
// bundles are read as a guest (review of #318)
// ---------------------------------------------------------------------------

describe("a dream's and a reflection's bundles are read as a guest, on an owner's server too (review of #318)", () => {
  test("dream begin and reflect begin leave a confidential memory out; the owner's recall still shows it", async () => {
    const c = brain();
    days(c);
    const secret = mem(c, "The surgery date is something only Mike and I keep, the fourteenth.", { kind: "person", about: "us", meta: { confidential: true }, salience: { relevance: 1, emotional: 0.9, predictive: 1 } });
    mem(c, "The bench needs a new vise before the cabinet doors go on.");
    mem(c, "The migration runs before the container starts.");
    const s = server(c);
    expect(s.owner).toBe(true);
    const dream = await s.call("dream", { phase: "begin", session: SESSION });
    expect(dream.isError ?? false).toBe(false);
    const seen = JSON.stringify(dream.structuredContent);
    expect(seen).toContain("a new vise");
    expect(seen).not.toContain("surgery date");
    expect(seen).not.toContain(secret);
    const reflect = await s.call("reflect", { phase: "begin", session: SESSION });
    expect(reflect.isError ?? false).toBe(false);
    expect(JSON.stringify(reflect.structuredContent)).not.toContain("surgery date");
    // The session itself is the owner's: its recall says it.
    const recalled = await s.call("recall", { ids: [secret] });
    expect(JSON.stringify(recalled.structuredContent)).toContain("surgery date");
  });
});
