/**
 * THE WAKE IS BEHIND EVERY ACCEPTED MEMORY AND EVERY HANDOFF CHANGE (2026-10-10).
 *
 * Found that day by a hermetic repro (~/counterparts-notes/2026-10-10-wake-staleness.md):
 * only `session_end`'s write-ups, chapters, the page, a told reminder, a new
 * build and the night run's end marked the wake behind. A memory written with
 * `note` mid-session — the most common write — set no mark, so the turn-end
 * worker found the wake `current` and rendered nothing: Still open, Nearby and
 * Arriving stayed as they were for up to a day, in every directory, and a
 * thread a note closed stayed listed. The mark now sits in `Counterpart.deposit`
 * (trigger `memory`; a write-up keeps `write-up`) and at the handoff write,
 * retire and clear (trigger `handoff`).
 *
 * Hermetic: every test opens a fresh temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { BRIEFING_KEY, wakeBehind } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";

const BUDGET = 9_000;

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-wake-behind-every-memory-"));
});

afterEach(() => {
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function config(): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: BUDGET, owner: true };
}

function counterpart(): Counterpart {
  const c = Counterpart.open({ dir, budgetBytes: BUDGET, owner: true });
  closers.push(c);
  return c;
}

/** Seeds a few warm facts and the page; returns the store's today and tomorrow. */
function seed(): { d1: string; d2: string } {
  const c = Counterpart.open({ dir, budgetBytes: BUDGET, owner: true });
  try {
    const day = c.store.livedDay();
    for (let i = 0; i < 4; i += 1) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: `A warm seed fact about the world, number ${String(i)}.`,
        about: "world",
        salience: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
        physics: { birthDay: day, lastUsedDay: day },
      } as never);
    }
    c.revisePage("## Core\nI am a test self.\n", { by: "owner", reason: "seed" });
    const d1 = c.store.today();
    const next = new Date(`${d1}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { d1, d2: next.toISOString().slice(0, 10) };
  } finally {
    c.close();
  }
}

/** The published bundle, read in a process of its own. */
function published(): string {
  const s = Store.open({ dir, observer: true });
  try {
    return s.getMeta(BRIEFING_KEY) ?? "";
  } finally {
    s.close();
  }
}

function behind(): readonly string[] | null {
  const s = Store.open({ dir, observer: true });
  try {
    return wakeBehind(s)?.triggers ?? null;
  } finally {
    s.close();
  }
}

/** Every `self.briefing` row's payload, oldest first. */
function briefingRows(): Record<string, unknown>[] {
  const s = Store.open({ dir, observer: true });
  try {
    return s.eventLog({ name: "self.briefing", order: "asc", limit: 1_000 }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
  } finally {
    s.close();
  }
}

/** The worker a Stop spawns, run in this process. */
async function worker(date: string): Promise<void> {
  const report = await runOnce({ config: config(), date, embedder: null });
  expect(report.ran).toBe(true);
}

/** A session's turn ends: the Stop spawns the worker (stubbed), which then runs here. */
async function turnEnd(session: string, scope: string, at: string): Promise<void> {
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  try {
    expect(a.stop({ sessionId: session, scope, at, turns: [] }).spawn?.started).toBe(true);
  } finally {
    a.counterpart.close();
  }
  await worker(at);
}

/** What a session starting now in `scope` wakes to. */
function wakeOf(session: string, scope: string, at: string): string {
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  recordSession(dir, { sessionId: session, scope, phase: "start" });
  try {
    return a.sessionStart({ sessionId: session, scope, at, turns: [] }).injection ?? "";
  } finally {
    a.counterpart.close();
  }
}

/** A session's MCP server; `note` still answers after its rename to `remember` (G1c). */
function server(session: string, scope: string): ReturnType<typeof openServer> {
  recordSession(dir, { sessionId: session, scope, phase: "start" });
  const mcp = openServer({ dir, session, scope, owner: true });
  closers.push(mcp.counterpart);
  return mcp;
}

function stored(out: { structuredContent: Record<string, unknown> }): string {
  const id = out.structuredContent["memoryId"] ?? out.structuredContent["id"];
  expect(typeof id).toBe("string");
  return id as string;
}

describe("a memory written with note reaches the wake at the next turn-end", () => {
  test("session A notes a thread, an owner fact and a dated one, its turn ends, and session B — in another directory — wakes to all three", async () => {
    const { d1, d2 } = seed();
    await worker(d1); // the day's first turn-end: the cycle renders
    expect(briefingRows().map((r) => r["reason"])).toEqual(["rendered"]);

    const mcp = server("A", "proj-a");
    for (const args of [
      { text: "THREAD-MARK: should the importer retry on a 429?", unresolved: true, relevance: 0.9, emotional: 0.7, predictive: 0.9 },
      { text: "NEARBY-MARK: the owner was ill with pneumonia last week.", about: "owner", relevance: 0.95, emotional: 0.9, predictive: 0.9 },
      { text: "ARRIVING-MARK: the dentist appointment.", eventDate: d2, about: "owner", relevance: 0.9, emotional: 0.6, predictive: 0.9 },
    ]) {
      stored(await mcp.call("note", args));
    }
    mcp.counterpart.close();

    // Marked, not yet rendered: the bundle is the morning's.
    expect(behind()).toEqual(["memory"]);
    expect(published()).not.toContain("THREAD-MARK");

    await turnEnd("A", "proj-a", d1);
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["memory"] });
    expect(behind()).toBe(null);

    const b = wakeOf("B", "proj-b", d1);
    expect(b).toContain("THREAD-MARK");
    expect(b).toContain("NEARBY-MARK");
    expect(b).toContain("ARRIVING-MARK");

    // Nothing new since: the next turn-end renders nothing.
    await turnEnd("A", "proj-a", d1);
    expect(briefingRows().length).toBe(2);
  });

  test("a thread a note closes leaves Still open at the next turn-end, not the next lived day", async () => {
    const { d1 } = seed();
    await worker(d1);
    const mcp = server("A", "proj-a");
    const open = stored(await mcp.call("note", { text: "CLOSE-MARK: does the export keep the dates?", unresolved: true, relevance: 0.9, emotional: 0.7, predictive: 0.9 }));
    await turnEnd("A", "proj-a", d1);
    expect(wakeOf("B", "proj-b", d1)).toContain("CLOSE-MARK");

    stored(await mcp.call("note", { text: "Answered: the export keeps the dates, checked against a real file.", updates: open, unresolved: false }));
    mcp.counterpart.close();
    expect(behind()).toEqual(["memory"]);
    await turnEnd("A", "proj-a", d1);
    expect(wakeOf("C", "proj-b", d1)).not.toContain("CLOSE-MARK");
  });

  test("a write-up keeps its own trigger; a refused note marks nothing", async () => {
    seed();
    const c = counterpart();
    c.refreshWake({ at: c.store.today() }); // the seed page's mark, caught up
    expect(wakeBehind(c.store)).toBe(null);
    const refused = await c.submitJot({ content: "" }, { session: "s1", scope: "proj" });
    expect(refused.deposited).toBe(false);
    expect(wakeBehind(c.store)).toBe(null);

    expect((await c.submitJot({ content: "A plain note about the build this morning." }, { session: "s1", scope: "proj" })).deposited).toBe(true);
    expect((await c.submitSessionEnd({ content: "A write-up memory about the build this afternoon." }, { session: "s1", scope: "proj" })).deposited).toBe(true);
    expect(wakeBehind(c.store)?.triggers).toEqual(["write-up", "memory"]);
  });
});

describe("a handoff change marks the wake behind", () => {
  test("write, retire and clear each mark it under `handoff`; the refresh renders; a refused retire marks nothing", () => {
    seed();
    const c = counterpart();
    c.refreshWake({ at: c.store.today() }); // the seed page's mark, caught up
    expect(wakeBehind(c.store)).toBe(null);
    const caughtUp = (): void => {
      expect(c.refreshWake({ at: c.store.today() }).reason).toBe("rendered");
      expect(wakeBehind(c.store)).toBe(null);
    };

    const written = c.writeHandoff("The importer is half done; finish the retry loop next.", { scope: "proj", session: "s1" });
    expect(written.written).toBe(true);
    expect(wakeBehind(c.store)?.triggers).toEqual(["handoff"]);
    expect(c.refreshWake({ at: c.store.today() })).toMatchObject({ reason: "rendered", triggers: ["handoff"] });
    expect(briefingRows().at(-1)).toMatchObject({ reason: "refresh", triggers: ["handoff"] });

    // Retired by another session in the same directory, its work done.
    const retired = c.retireHandoff(written.id as string, { scope: "proj", session: "s2" });
    expect(retired.written).toBe(true);
    expect(wakeBehind(c.store)?.triggers).toEqual(["handoff"]);
    caughtUp();

    // An id that is not a live handoff here: refused, and nothing marked.
    expect(c.retireHandoff(written.id as string, { scope: "proj", session: "s2" }).written).toBe(false);
    expect(wakeBehind(c.store)).toBe(null);

    expect(c.writeHandoff("Another plan for this directory.", { scope: "proj", session: "s3" }).written).toBe(true);
    caughtUp();
    expect(c.clearHandoff({ scope: "proj", session: "s3" }).written).toBe(true);
    expect(wakeBehind(c.store)?.triggers).toEqual(["handoff"]);
  });
});
