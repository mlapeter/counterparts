/**
 * THE HOST'S CEILING ON ONE TOOL RESULT (2026-10-02). The night of 10-02 the
 * dream's begin (51.5 KB) and its part 2 (51,306 characters) and the
 * reflection's begin (51.7 KB) went past Claude Code's line — 50,000
 * characters, 25,000 tokens — and were saved to a file the headless run cannot
 * open; doctor stayed green. This file holds the fix to what it promises:
 *
 *   - every cap derives from one ceiling (`fit/TOOL_RESULT_CEILING`);
 *   - a busy night's results all come in under it WITHOUT the server's net
 *     firing — the caps, not the cut, keep them there;
 *   - the nightly writer's block fits beside a page carried whole;
 *   - the net: a result over the ceiling is cut to it with a note and one
 *     durable `mcp.result.oversize` row, never shipped to be spilled;
 *   - doctor's Tool results line: amber on an oversize row, amber on a run
 *     that finished without a part it was handed, green otherwise.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resultFindings } from "../src/adapters/claude-code/doctor.js";
import { McpServer, RECALL_ID_RESULT_CHARS } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/server.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart, MCP_OVERSIZE_EVENT, MCP_PART_EVENT } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { TOOL_RESULT_CEILING, wireChars } from "../src/core/fit/index.js";
import { pageWriterNight } from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: Counterpart[] = [];
const SESSION = "s-ceiling";
const CEILING = TOOL_RESULT_CEILING.CHARS;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-ceiling-"));
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
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
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

function server(c: Counterpart, opts: { resultCeilingChars?: number } = {}): McpServer {
  recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
  return new McpServer({ counterpart: c, scope: "/proj", owner: true, registryDir: dir, ...opts });
}

/** What Claude Code hands the model: `structuredContent`, serialized — by wire cost. */
function wire(res: ToolResult): number {
  return wireChars(JSON.stringify(res.structuredContent));
}

/** Within the ceiling, by the caps alone: no `cut`, so the net never had to act. */
function underByTheCaps(res: ToolResult): void {
  expect(res.isError ?? false).toBe(false);
  expect(wire(res)).toBeLessThanOrEqual(CEILING);
  expect(res.structuredContent["cut"]).toBeUndefined();
}

function rows(c: Counterpart, name: string): Record<string, unknown>[] {
  return c.store.eventLog({ name, limit: 1_000 }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

/** A busy night: many memories, quote-heavy (every quote escapes twice on the wire) or CJK, and a long page. */
function busyNight(c: Counterpart, script: "quoted" | "cjk"): void {
  c.store.advanceClock("2026-09-10");
  const said = script === "quoted" ? "\"said\" \"so\" \"plainly\" ".repeat(20) : "我们今天讨论了发布流程和迁移步骤，决定先运行迁移再启动容器。".repeat(8);
  for (let i = 0; i < 120; i += 1) mem(c, `Older memory ${String(i)} of a busy week: ${said}`);
  for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  for (let i = 0; i < 90; i += 1) {
    mem(c, `Memory ${String(i)} of a busy day: ${said}${(script === "quoted" ? "and more said at length. " : said).repeat(i % 7 === 0 ? (script === "quoted" ? 300 : 20) : 1)}`, {
      kind: i % 3 === 0 ? "person" : i % 3 === 1 ? "self" : "fact",
      about: i % 2 === 0 ? "us" : "me",
    });
  }
  const page = script === "quoted" ? `## Core\n\n${"\"A\" \"quoted\" \"page\". ".repeat(700)}` : `## Core\n\n${"我是谁，我如何工作。".repeat(500)}`;
  expect(c.revisePage(page, { reason: "a long page", by: "owner" }).written).toBe(true);
}

describe("one ceiling: every cap derives from it", () => {
  test("the dream's and the reflection's rooms sit at or under it; it sits 20% under the host's 50,000", () => {
    expect(TOOL_RESULT_CEILING.HOST_CHARS).toBe(50_000);
    expect(CEILING).toBeLessThanOrEqual(TOOL_RESULT_CEILING.HOST_CHARS * 0.8);
    expect(DREAM_TUNABLES.RESULT_CHARS).toBeLessThanOrEqual(CEILING);
    expect(DREAM_TUNABLES.PART_CHARS).toBeLessThanOrEqual(CEILING);
    expect(REFLECT_TUNABLES.RESULT_CHARS).toBeLessThanOrEqual(CEILING);
    expect(REFLECT_TUNABLES.PART_CHARS).toBeLessThanOrEqual(CEILING);
    // The by-id room is counted twice (text and structured copy), so one copy is half of it.
    expect(RECALL_ID_RESULT_CHARS / 2).toBeLessThanOrEqual(CEILING);
  });
});

describe("a busy night reaches the model whole: under the ceiling by the caps, the net never fires, every part logged", () => {
  for (const script of ["quoted", "cjk"] as const) {
    test(`${script}: dream begin and parts, reflection begin and parts — each under the ceiling, no cut, no oversize row; doctor green`, async () => {
      const c = brain();
      busyNight(c, script);
      const s = server(c);
      const begin = await s.call("dream", { phase: "begin", session: SESSION });
      underByTheCaps(begin);
      const dreamId = begin.structuredContent["dream"] as string;
      const of = (begin.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1;
      expect(of).toBeGreaterThan(1);
      for (let k = 2; k <= of; k += 1) underByTheCaps(await s.call("dream", { phase: "part", session: SESSION, dream: dreamId, part: k }));
      await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "A dream, read whole." });
      const r = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
      underByTheCaps(r);
      const rid = r.structuredContent["reflection"] as string;
      const rof = (r.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1;
      for (let k = 2; k <= rof; k += 1) underByTheCaps(await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: k }));
      expect(rows(c, MCP_OVERSIZE_EVENT)).toEqual([]);
      // Every part handed is on the record, part 1 (the begin) included.
      const parts = rows(c, MCP_PART_EVENT);
      expect(parts.filter((p) => p["ref"] === dreamId).map((p) => p["part"])).toEqual(Array.from({ length: of }, (_, i) => i + 1));
      expect(parts.filter((p) => p["ref"] === rid).map((p) => p["part"])).toEqual(Array.from({ length: rof }, (_, i) => i + 1));
      for (const p of parts) expect(p["chars"] as number).toBeLessThanOrEqual(CEILING);
      const [f] = resultFindings(c.store);
      expect(f?.severity).toBe("green");
      expect(f?.detail).toContain("every part read");
    }, 90_000);
  }
});

describe("the nightly writer's block fits beside a page carried whole", () => {
  test("a near-full page and a day far past the room: the writer result is under the ceiling by the caps, and what did not fit is counted", async () => {
    const c = brain();
    const about = pageWriterNight(c.store).about;
    // About 15 KB of page, quote-heavy, and ~90 KB of the day in 300 memories.
    expect(c.revisePage(`## Core\n\n${"\"I\" say \"so\".\n".repeat(1_100)}`, { reason: "a full page", by: "owner" }).written).toBe(true);
    for (let i = 0; i < 300; i += 1) {
      c.store.put({ type: "memory", kind: "fact", body: `Noticed ${String(i)}: "a thing" said "plainly", at some length. ${"More of it. ".repeat(20)}`, learnedOn: about });
    }
    const s = server(c);
    const w = await s.call("dream", { phase: "writer", session: SESSION });
    expect(w.structuredContent["writer"]).toBe(true);
    underByTheCaps(w);
    const read = w.structuredContent["read"] as string;
    expect(read).toContain("I\" say");
    expect(rows(c, MCP_OVERSIZE_EVENT)).toEqual([]);
  });
});

describe("the net: a result over the ceiling is cut to it, said, and recorded — never shipped to be spilled", () => {
  test("a page read past a small ceiling comes back cut with a note; one oversize row; doctor amber", async () => {
    const c = brain();
    c.store.advanceClock("2026-09-10");
    expect(c.revisePage(`## Core\n\n${"The page goes on. ".repeat(300)}`, { reason: "a long page", by: "owner" }).written).toBe(true);
    const s = server(c, { resultCeilingChars: 2_000 });
    const res = await s.call("self_page", {});
    expect(res.isError ?? false).toBe(false);
    expect(wire(res)).toBeLessThanOrEqual(2_000);
    expect(typeof res.structuredContent["cut"]).toBe("string");
    expect(res.structuredContent["cut"] as string).toContain("the rest did not reach you");
    // The text copy is the same cut payload.
    expect(JSON.parse(res.content[0]?.text ?? "{}")).toEqual(res.structuredContent);
    const over = rows(c, MCP_OVERSIZE_EVENT);
    expect(over.length).toBe(1);
    expect(over[0]).toMatchObject({ tool: "self_page", cut: true, ceiling: 2_000 });
    expect(over[0]?.["chars"] as number).toBeGreaterThan(2_000);
    expect(over[0]?.["cutTo"] as number).toBeLessThanOrEqual(2_000);
    // Never the text on the row.
    expect(JSON.stringify(over[0])).not.toContain("The page goes on");
    const [f] = resultFindings(c.store);
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("self_page");
    expect(f?.detail).toContain("cut to");
  });

  test("a small result is untouched", async () => {
    const c = brain();
    const s = server(c);
    const res = await s.call("status", {});
    expect(res.structuredContent["cut"]).toBeUndefined();
    expect(rows(c, MCP_OVERSIZE_EVENT)).toEqual([]);
  });
});

describe("doctor's Tool results line: what reached the model, not what ran", () => {
  test("silent with nothing in the window; amber on a finished run missing a part; green once every part came back", () => {
    const c = brain();
    c.store.advanceClock("2026-09-10");
    expect(resultFindings(c.store)).toEqual([]);
    // A run handed in three parts that finished (not an open dream) with only part 2 fetched.
    c.noteAdapterEvent(MCP_PART_EVENT, { mechanism: "dream", ref: "drm_test1", part: 1, of: 3, chars: 39_000 });
    c.noteAdapterEvent(MCP_PART_EVENT, { mechanism: "dream", ref: "drm_test1", part: 2, of: 3, chars: 38_000 });
    const [amber] = resultFindings(c.store);
    expect(amber?.severity).toBe("amber");
    expect(amber?.detail).toContain("dream drm_test1");
    expect(amber?.detail).toContain("without part 3");
    c.noteAdapterEvent(MCP_PART_EVENT, { mechanism: "dream", ref: "drm_test1", part: 3, of: 3, chars: 12_000 });
    const [green] = resultFindings(c.store);
    expect(green?.severity).toBe("green");
    expect(green?.detail).toContain("1 bundle came in parts, every part read");
    expect(green?.data["largestPart"]).toBe(39_000);
  });

  test("a dream still open is not judged for the parts it has not fetched yet", async () => {
    const c = brain();
    busyNight(c, "quoted");
    const s = server(c);
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    expect(((begin.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1)).toBeGreaterThan(1);
    expect(resultFindings(c.store)[0]?.severity).toBe("green");
    // Journaled without its later parts: now it is judged.
    await s.call("dream", { phase: "journal", session: SESSION, dream: begin.structuredContent["dream"] as string, text: "Thin." });
    const [f] = resultFindings(c.store);
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("finished without part");
  }, 90_000);
});
