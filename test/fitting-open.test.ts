/**
 * BUILD B, part 2 (2026-09-28): the sleep scans resume where they stopped, and
 * small "open" lists are read by open state rather than through a window of
 * the newest N — a flagged pair past the newest ten dreams, an offered share
 * past the newest five reflections, a cite past the night's returns.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, RECALL_BODY_CHARS, RECALL_ID_RESULT_CHARS } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { MIND_SEEN_PREFIX, mindRanked, noteMindShown } from "../src/core/dream/mind.js";
import { flag } from "../src/core/reconsolidation.js";
import { readIndex, wireChars } from "../src/core/fit/index.js";
import { onMyMind } from "../src/core/dream/index.js";
import { readCursor, runDecay, runPrune } from "../src/core/sleep/index.js";
import type { PhaseCtx } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-fit-open-"));
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
  const c = Counterpart.open({ dir, identity: { name: "Mike" } });
  open.push(c);
  return c;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, ...over });
}

function ctx(c: Counterpart, budget: number): PhaseCtx {
  return { store: c.store as never, day: c.store.livedDay(), apply: true, budget, step: () => {}, event: () => {} };
}

describe("prune and decay resume where they stopped (the audit's #4)", () => {
  test("a prune budget smaller than the store reaches the tail on a later night — a cursor, wrapping", () => {
    const c = brain();
    for (const d of ["2026-09-01", "2026-09-02"]) c.store.advanceClock(d);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(mem(c, `A live memory, number ${String(i)}.`));
    const sorted = c.store.list().filter((id) => ids.includes(id)).sort();
    expect(sorted.length).toBe(6);
    // Budget 2: each night examines the next two, not the same first two.
    runPrune(ctx(c, 2));
    const first = readCursor(c.store, "prune");
    runPrune(ctx(c, 2));
    const second = readCursor(c.store, "prune");
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect((second ?? "") > (first ?? "")).toBe(true);
    // An observer's read-only pass does not move it.
    runPrune({ ...ctx(c, 2), apply: false });
    expect(readCursor(c.store, "prune")).toBe(second);
  });

  test("decay keeps its own cursor the same way", () => {
    const c = brain();
    for (let i = 0; i < 5; i += 1) mem(c, `Memory ${String(i)}.`);
    runDecay(ctx(c, 2), null);
    const a = readCursor(c.store, "decay");
    runDecay(ctx(c, 2), null);
    const b = readCursor(c.store, "decay");
    expect(a).not.toBeNull();
    expect(b).not.toBe(a);
  });
});

describe("open lists read by open state, not through the newest N", () => {
  function dreamRow(c: Counterpart, id: string, date: string, i: number): void {
    c.store.openDream({ id, session: "s", day: c.store.livedDay(), date, shown: [] });
    c.store.updateDream(id, { state: "journaled", startedAt: 1_000 + i });
  }

  test("a pair flagged eleven dreams ago is still raised awake, and still on my mind", () => {
    const c = brain();
    c.store.advanceClock("2026-09-01");
    const a = mem(c, "The deploy runs the migration first.");
    const b = mem(c, "The deploy runs the migration last.");
    dreamRow(c, "drm_old", "2026-09-01", 0);
    c.store.recordDreamChange("drm_old", { action: "contradiction", ref: a, ref2: b, detail: {} });
    // v10: the flag is a pair; what raises and what "my mind" reads.
    flag(c.store, { x: a, y: b, source: "dream", dreamId: "drm_old" });
    for (let i = 1; i <= 11; i += 1) dreamRow(c, `drm_${String(i).padStart(3, "0")}`, "2026-09-02", i);
    expect(c.store.dreams({ limit: 10 }).some((d) => d.id === "drm_old")).toBe(false);
    const mind = onMyMind(c.store, { today: "2026-09-12", day: c.store.livedDay(), showable: () => true });
    expect(mind.some((m) => m.kind === "unsettled" && m.ids.includes(a))).toBe(true);
    const lines = c.dreams.raiseLines({ session: "s-now" });
    expect(lines.some((l) => l.includes(a) && l.includes(b))).toBe(true);
    // Raised once.
    expect(c.dreams.raiseLines({ session: "s-now" })).toEqual([]);
  });

  test("an offered share older than the newest five reflections is still carried", () => {
    const c = brain();
    c.store.openReflection({ id: "rfl_old", session: "s-old", day: 1, date: "2026-09-01", questions: [], shown: [] });
    c.store.updateReflection("rfl_old", { state: "reflected", entry: "e", share: "Last night I dreamed of the release.", shareState: "offered" });
    for (let i = 0; i < 6; i += 1) {
      c.store.openReflection({ id: `rfl_${String(i)}`, session: "s-old", day: 2 + i, date: `2026-09-0${String(2 + i)}`, questions: [], shown: [] });
      c.store.updateReflection(`rfl_${String(i)}`, { state: "reflected", entry: "e" });
    }
    const row = c.reflections.pendingShare({ session: "s-new" });
    expect(row?.id).toBe("rfl_old");
  });

  test("cites past the night's returns are listed with why, not left out", () => {
    const c = brain();
    for (const d of ["2026-09-01", "2026-09-02"]) c.store.advanceClock(d);
    const ids: string[] = [];
    for (let i = 0; i < 14; i += 1) ids.push(mem(c, `A thing lived today, number ${String(i)}.`, { physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() } }));
    const r = c.reflections.begin({ session: "s-r" });
    if (!r.ok) throw new Error(r.reason);
    const o = c.reflections.finish({ reflection: r.bundle.reflection, session: "s-r", entry: "A full day.", cites: ids });
    if (!o.ok) throw new Error(o.reason);
    expect(o.outcome.returned.length).toBe(14);
    expect(o.outcome.returned.slice(12).map((x) => x.reason)).toEqual(["returns-limit-reached", "returns-limit-reached"]);
  });
});

// ---------------------------------------------------------------------------
// review of #278
// ---------------------------------------------------------------------------

function mcp(c: Counterpart): McpServer {
  recordSession(dir, { sessionId: "s-open", scope: "/proj", phase: "start" });
  return new McpServer({ counterpart: c, scope: "/proj", registryDir: dir });
}

function lived(c: Counterpart): void {
  for (let d = 10; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
}

function fromIndexOf(c: Counterpart): unknown {
  const row = c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
  return (JSON.parse(row?.payload ?? "{}") as { fromIndex?: unknown }).fromIndex;
}

describe("review of #278: the lookup is counted from what was delivered, once per index", () => {
  test("asked for 10, delivered 5: only the delivered count; the waiting ones count when they come", async () => {
    const c = brain();
    lived(c);
    const page = "x".repeat(RECALL_BODY_CHARS);
    const ids: string[] = [];
    // Big enough to be offered as excerpts, and to fill a by-id result a few at a time.
    for (let i = 0; i < 10; i += 1) ids.push(mem(c, `${page} ${String(i)}`, { physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() } }));
    const s = mcp(c);
    const begin = await s.call("dream", { phase: "begin", session: "s-open" });
    expect(begin.isError ?? false).toBe(false);
    const offered = readIndex(c.store, "dream");
    const inPart = new Set([...(offered?.offered.excerpt ?? []), ...(offered?.offered.line ?? [])]);
    expect(ids.every((id) => inPart.has(id))).toBe(true);
    const r = await s.call("recall", { ids });
    const delivered = (r.structuredContent["memories"] as { id: string }[]).map((m) => m.id);
    const waiting = r.structuredContent["waiting"] as string[];
    expect(delivered.length).toBeLessThan(10);
    expect(waiting.length).toBe(10 - delivered.length);
    expect(fromIndexOf(c)).toEqual({ dream: delivered.length });
    // The rest, when they come; the first ones asked again count nothing.
    await s.call("recall", { ids: [...delivered.slice(0, 1), ...waiting.slice(0, 2)] });
    expect(fromIndexOf(c)).toEqual({ dream: 2 });
  });

  test("parts 1, 2 and 3 of one id: one lookup; fetched whole only when the last part went out", async () => {
    const c = brain();
    lived(c);
    const body = Array.from({ length: 2_400 }, (_, i) => `Word${String(i)}`).join(" ");
    const id = mem(c, body, { physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() } });
    mem(c, "Two.");
    mem(c, "Three.");
    const s = mcp(c);
    await s.call("dream", { phase: "begin", session: "s-open" });
    const first = await s.call("recall", { ids: [id] });
    const parts = (first.structuredContent["memories"] as { parts: number }[])[0]?.parts ?? 1;
    expect(parts).toBe(3);
    expect(fromIndexOf(c)).toEqual({ dream: 1 });
    expect(readIndex(c.store, "dream")?.looked ?? []).not.toContain(id);
    await s.call("recall", { ids: [id], part: 2 });
    expect(fromIndexOf(c)).toBeUndefined();
    expect(readIndex(c.store, "dream")?.looked ?? []).not.toContain(id);
    await s.call("recall", { ids: [id], part: 3 });
    expect(fromIndexOf(c)).toBeUndefined();
    expect(readIndex(c.store, "dream")?.looked ?? []).toContain(id);
  });

  test("CJK recall by id at the real limit: the serialised result, both copies, stays under its room; nothing is cut, the rest waits", async () => {
    const c = brain();
    const zh = "我们今天讨论了发布流程和迁移步骤。".repeat(600);
    const ids = Array.from({ length: 5 }, (_, i) => mem(c, `${zh}${String(i)}`));
    const s = mcp(c);
    const r = await s.call("recall", { ids });
    const text = r.content[0]?.text ?? "";
    const both = wireChars(text) + wireChars(JSON.stringify(r.structuredContent));
    expect(both).toBeLessThanOrEqual(RECALL_ID_RESULT_CHARS + 8_000);
    const got = (r.structuredContent["memories"] as { id: string }[]).map((m) => m.id);
    expect([...got, ...((r.structuredContent["waiting"] as string[] | undefined) ?? [])]).toEqual(ids);
  });
});

describe("review of #278: a flagged pair habituates on my mind, and rises again when touched", () => {
  test("each showing halves it; a use of either memory brings it back", () => {
    const c = brain();
    c.store.advanceClock("2026-09-01");
    const a = mem(c, "The deploy runs the migration first.");
    const b = mem(c, "The deploy runs the migration last.");
    c.store.openDream({ id: "drm_flag", session: "s", day: c.store.livedDay(), date: "2026-09-01", shown: [] });
    c.store.updateDream("drm_flag", { state: "journaled" });
    c.store.recordDreamChange("drm_flag", { action: "contradiction", ref: a, ref2: b, detail: {} });
    const flagged = flag(c.store, { x: a, y: b, source: "dream", dreamId: "drm_flag" });
    const pairId = flagged.ok ? flagged.pair : "";
    const input = { today: "2026-09-02", day: c.store.livedDay(), showable: () => true };
    const score = (): number => {
      const items = mindRanked(c.store, input).items;
      return items.findIndex((m) => m.kind === "unsettled");
    };
    expect(score()).toBe(0);
    const [item] = mindRanked(c.store, input).items;
    noteMindShown(c.store, item === undefined ? [] : [item], c.store.livedDay());
    const seen = JSON.parse(c.store.getMeta(`${MIND_SEEN_PREFIX}${pairId}`) ?? "{}") as { times: number };
    expect(seen.times).toBe(1);
    // Still listed (no hide, no hard limit), at half the weight.
    expect(mindRanked(c.store, input).items.some((m) => m.kind === "unsettled")).toBe(true);
    // Touched: used since it was shown — its count starts again.
    c.store.advanceClock("2026-09-02");
    c.store.updatePhysics(a, { ...c.store.physicsOf(a), lastUsedDay: c.store.livedDay() });
    noteMindShown(c.store, item === undefined ? [] : [item], c.store.livedDay());
    expect((JSON.parse(c.store.getMeta(`${MIND_SEEN_PREFIX}${pairId}`) ?? "{}") as { times: number }).times).toBe(1);
  });

  test("same-millisecond dreams are ordered by when they were written, not by their random ids", () => {
    const c = brain();
    const a = mem(c, "One.");
    const b = mem(c, "Two.");
    for (const id of ["drm_zz", "drm_aa"]) {
      c.store.openDream({ id, session: "s", day: 1, date: "2026-09-01", shown: [] });
      c.store.updateDream(id, { state: "journaled", startedAt: 5_000 });
      c.store.recordDreamChange(id, { action: "contradiction", ref: a, ref2: b, detail: {} });
    }
    expect(c.store.openDreamChanges("contradiction").map((x) => x.dream_id)).toEqual(["drm_aa", "drm_zz"]);
  });
});
