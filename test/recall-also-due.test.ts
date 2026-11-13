/**
 * "ALSO DUE IN THIS WINDOW" (2026-11-13, the follow-up to #815;
 * `src/adapters/mcp/facts.ts#alsoDueLines`). A topical question with a window
 * still to come filters what its words and meaning reached; the reminders due
 * in the window that they did not reach are listed apart, after the page, by
 * date: never matches, never counted, never credited.
 *
 * Hermetic: every test makes its own temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { RECALL_RESULT_CHARS } from "../src/adapters/mcp/deliberate.js";
import { FACTS_ALSO_DUE_SIZE, factsRecall, renderFacts } from "../src/adapters/mcp/facts.js";
import type { FactsResult } from "../src/adapters/mcp/facts.js";
import { Counterpart } from "../src/core/counterpart.js";
import { settle } from "../src/core/reconsolidation.js";
import { findable } from "./store-fixture.js";

const ZONE = "America/Los_Angeles";
/** Saturday 2026-10-03, 15:00 local: "next week" is 10-05..10-11. */
const NOW = Date.parse("2026-10-03T22:00:00Z");
const EARLIER = Date.parse("2026-09-10T18:00:00Z");
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";

let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-also-due-"));
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

function brain(now = NOW): Counterpart {
  const c = Counterpart.open({ dir: join(dir, "store"), now: () => now, timeZone: ZONE });
  findable(c.store);
  open.push(c);
  return c;
}

function ask(c: Counterpart, question: string): FactsResult {
  return factsRecall({ counterpart: c, sessionId: SESSION, vector: null, semantic: "embedder-off" }, question);
}

/** Reminders written weeks earlier, so none is in a window by when it was learned. */
function written(put: (c: Counterpart) => void): Counterpart {
  const early = brain(EARLIER);
  put(early);
  early.close();
  return brain();
}

const fact = (c: Counterpart, title: string, eventDate: string, extra: Record<string, unknown> = {}): string =>
  c.store.put({ type: "memory", kind: "fact", title, body: `${title}.`, eventDate, ...extra });

describe("also due in this window", () => {
  test("the matched reminder is the match; the week's other reminders are listed after it, by date, not counted, without it", () => {
    const ids: Record<string, string> = {};
    const c = written((e) => {
      ids["vet"] = fact(e, "Biscuit's zqvet visit", "2026-10-08");
      ids["fri"] = fact(e, "Recital at the school hall", "2026-10-09");
      ids["mon"] = fact(e, "Haircut with Jo", "2026-10-05");
      ids["far"] = fact(e, "Annual boiler service", "2026-11-20");
    });
    const r = ask(c, "zqvet next week");
    expect(r.matched).toBe(1);
    expect(r.memories.map((m) => m.id)).toEqual([ids["vet"] as string]);
    expect(r.alsoDue?.items.map((i) => i.id)).toEqual([ids["mon"] as string, ids["fri"] as string]);
    const text = renderFacts(r);
    expect(text.split("\n")[0]).toBe("1 match · showing 1");
    expect(text).toContain("also due in this window (2), not matches (open any by id):");
    expect(text).toContain(`- Haircut with Jo · due Mon 10-05 · ${ids["mon"] as string}`);
    expect(text).toContain(`- Recital at the school hall · due Fri 10-09 · ${ids["fri"] as string}`);
    expect(text.indexOf("also due in this window")).toBeGreaterThan(text.indexOf(ids["vet"] as string));
    expect(text).not.toContain("Annual boiler service");
  });

  test("at most ten, by date, then +K more; the heading counts them all", () => {
    const c = written((e) => {
      for (let d = 5; d <= 11; d++) {
        fact(e, `Morning thing ${String(d)}`, `2026-10-${String(d).padStart(2, "0")}`);
        fact(e, `Evening thing ${String(d)}`, `2026-10-${String(d).padStart(2, "0")}`);
      }
    });
    c.store.put({ type: "memory", kind: "fact", body: "The zqbike needs a chain." });
    const r = ask(c, "zqbike next week");
    expect(r.alsoDue?.items.length).toBe(FACTS_ALSO_DUE_SIZE);
    expect(r.alsoDue?.more).toBe(14 - FACTS_ALSO_DUE_SIZE);
    const dues = (r.alsoDue?.items ?? []).map((i) => i.due);
    expect(dues).toEqual([...dues].sort());
    const text = renderFacts(r);
    expect(text).toContain("also due in this window (14), not matches");
    expect(text).toContain(`+${String(14 - FACTS_ALSO_DUE_SIZE)} more`);
    // The bike note is the one match (undated, kept by the look-ahead); the list is not counted.
    expect(r.matched).toBe(1);
    // Nothing matched is still nothing matched, and the list follows it.
    const none = renderFacts(ask(c, "zqnothing next week"));
    expect(none.split("\n")[0]).toBe("0 match");
    expect(none.indexOf("also due in this window (14)")).toBeGreaterThan(none.indexOf("Nothing matched."));
  });

  test("a daily repeat is one line (its first day in the window); a weekly one over two weeks is one line, its first occurrence", async () => {
    const c = written(() => {});
    const s = new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", registryDir: join(dir, "store"), now: () => NOW });
    const remember = async (args: Record<string, unknown>): Promise<string> => (await s.call("remember", args)).structuredContent["id"] as string;
    const daily = await remember({ title: "Water the plants", text: "Water the plants on the porch and in the kitchen window.", eventDate: "2026-09-01", recurring: "daily" });
    const weekly = await remember({ title: "Bins out", text: "Put the recycling and the green bins out by the road.", eventDate: "2026-09-01", recurring: "weekly" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqkayak trip is on hold." });
    const r = ask(c, "zqkayak between 5 and 18 October");
    const items = r.alsoDue?.items ?? [];
    expect(items.filter((i) => i.id === daily).length).toBe(1);
    expect(items.filter((i) => i.id === weekly).length).toBe(1);
    expect(items.find((i) => i.id === daily)?.due).toBe("2026-10-05");
    expect(items.find((i) => i.id === weekly)?.due).toBe("2026-10-06");
    const text = renderFacts(r);
    expect(text).toContain("- Water the plants · due Mon 10-05, every day ·");
    expect(text).toContain("- Bins out · due Tue 10-06, every Tuesday ·");
  });

  test("the same rules as a match: a moved reminder's old date, a one-off done today, a closed occurrence are not listed", () => {
    const ids: Record<string, string> = {};
    const c = written((e) => {
      ids["old"] = fact(e, "Dentist Tue 6 Oct", "2026-10-06");
      ids["moved"] = fact(e, "Dentist moved to Tue 20 Oct", "2026-10-20");
      ids["doneToday"] = fact(e, "Return the library books", "2026-10-03", { status: "done" });
      ids["open"] = fact(e, "Pick up the frames", "2026-10-04");
    });
    expect(settle(c.store, { holds: ids["moved"] as string, over: ids["old"] as string, how: "changed", why: "the day moved", actor: "session" }).ok).toBe(true);
    c.store.put({ type: "memory", kind: "fact", body: "The zqcanoe is in the shed." });
    const listed = (ask(c, "zqcanoe the coming week").alsoDue?.items ?? []).map((i) => i.id);
    expect(listed).toEqual([ids["open"] as string]);
  });

  test("a closed occurrence of a repeat gives way to the next, which is outside the window", async () => {
    const c = written(() => {});
    const s = new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", registryDir: join(dir, "store"), now: () => NOW });
    const bins = (await s.call("remember", { title: "Bins out", text: "Put the recycling and the green bins out by the road.", eventDate: "2026-09-01", recurring: "weekly" })).structuredContent["id"] as string;
    c.store.put({ type: "memory", kind: "fact", body: "The zqcanoe is in the shed." });
    expect((ask(c, "zqcanoe next week").alsoDue?.items ?? []).map((i) => i.id)).toEqual([bins]);
    expect(c.prospective.closeOccurrence(bins, "2026-10-03")?.occurrence).toBe("2026-10-06");
    expect(ask(c, "zqcanoe next week").alsoDue).toBeUndefined();
  });

  test("no section: a question that is only time (it already lists them), a window in the past, a question with no window", () => {
    const ids: Record<string, string> = {};
    const c = written((e) => {
      ids["mon"] = fact(e, "Haircut with Jo", "2026-10-05");
      ids["past"] = fact(e, "Plumber came", "2026-09-30");
    });
    c.store.put({ type: "memory", kind: "fact", body: "The zqbike needs a chain." });
    const only = ask(c, "what's on next week");
    expect(only.alsoDue).toBeUndefined();
    expect(only.memories.map((m) => m.id)).toEqual([ids["mon"] as string]);
    expect(renderFacts(only)).not.toContain("also due in this window");
    expect(ask(c, "zqbike last week").alsoDue).toBeUndefined();
    expect(ask(c, "zqbike").alsoDue).toBeUndefined();
  });

  test("when the answer runs out of room the list goes first, before the title tail and any excerpt", () => {
    const c = written((e) => {
      for (let d = 5; d <= 11; d++) fact(e, `Reminder ${String(d)}`, `2026-10-${String(d).padStart(2, "0")}`);
    });
    for (let i = 0; i < 40; i++) c.store.put({ type: "memory", kind: "fact", body: `zqlong note ${String(i)}: ${"word ".repeat(80)}` });
    const r = ask(c, "zqlong the coming week");
    expect(r.alsoDue?.items.length).toBe(6);
    // Pad the first title so the answer fits without the list and not with it.
    const without = renderFacts({ ...r, alsoDue: undefined } as FactsResult).length;
    const pad = RECALL_RESULT_CHARS - without - 5;
    const first = r.memories[0];
    expect(first).toBeDefined();
    const padded = { ...r, memories: [{ ...first!, line: `${first!.line}${"x".repeat(pad)}` }, ...r.memories.slice(1)] } as FactsResult;
    const text = renderFacts(padded);
    expect(text.length).toBeLessThanOrEqual(RECALL_RESULT_CHARS);
    expect(text).toContain("next 20, titles only");
    expect(text).not.toContain("also due in this window");
  });
});

describe("through the recall tool", () => {
  const body = (r: ToolResult): Record<string, unknown> => r.structuredContent;

  test("a topical question next week: its one match is the answer (and its ids); the week's other reminders are listed under the heading", async () => {
    const c = written(() => {});
    const s = new McpServer({ counterpart: c, session: SESSION, scope: "/scope/one", registryDir: join(dir, "store"), now: () => NOW });
    const remember = async (title: string, eventDate: string): Promise<string> => body(await s.call("remember", { title, text: `${title}, on the calendar for that day.`, eventDate }))["id"] as string;
    const vet = await remember("Biscuit's vet, Dr. Okafor", "2026-10-08");
    const haircut = await remember("Haircut with Jo", "2026-10-05");
    const recital = await remember("Recital at the school hall", "2026-10-09");
    const out = body(await s.call("recall", { question: "when is Biscuit's vet next week", mode: "facts" }));
    expect(out["ids"]).toEqual([vet]);
    expect(out["matched"]).toBe(1);
    const answer = String(out["answer"]);
    expect(answer).toContain("also due in this window (2), not matches (open any by id):");
    expect(answer).toContain(`- Haircut with Jo · due Mon 10-05 · ${haircut}`);
    expect(answer).toContain(`- Recital at the school hall · due Fri 10-09 · ${recital}`);
    // Listed, not shown: no recall credit, no quotable record.
    expect(c.store.gateRecords(SESSION, "asked").map((r) => r.ref)).not.toContain(haircut);
  });
});
