/**
 * OPEN ITEMS SAY WHAT SETTLES THEM (2026-10-27, S1; Ames's idea, lightly
 * held: "an open question needs either a trigger or a decision to let it go").
 *
 *   1. `settlesWhen` beside `unresolved: true` on `remember` and on a
 *      `session_end` entry lands in the memory's meta; without the flag it is
 *      dropped and counted. A revision that carries the thread on keeps it.
 *   2. "Still open" — the wake, built and assembled, and `recall "still
 *      open"` — shows it: "… · settles when Katie says how the reading went".
 *   3. The night: the reflection's bundle lists open items that name a
 *      trigger (`settlesOpen`), touched lately or not, and its `closeNow`
 *      closes one whose trigger plainly happened, with a why.
 *   4. Without a settlesWhen, everything is as before: no tail on the line,
 *      no `settlesOpen` in the bundle, and such an item is not closable
 *      before it is stale.
 *   5. `status` counts open items with and without one.
 *
 * Every check goes through a real door: the MCP tools, the wake, the reflect
 * tool. Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, toolSpec } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { recordSession } from "../src/adapters/sessions.js";
import { FRAMING } from "../src/core/self/index.js";
import { settlesTail } from "../src/core/self/briefing.js";
import { SETTLES_WHEN_CHARS, cleanSettlesWhen } from "../src/core/remember/proposals.js";
import { REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { addDays, localDate } from "../src/core/time.js";

const BASE = Date.parse("2026-09-01T12:00:00Z");
const BUDGET = 9_000;
const SCOPE = "/proj";
const KATIE = "Katie says how the reading went";
let dir: string;
let dateN = 0;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-settles-when-"));
});

afterEach(() => {
  for (const c of opened.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

const now = (): number => BASE + dateN * 86_400_000;
const today = (): string => addDays(localDate(BASE, "UTC"), dateN);

function server(session: string): McpServer {
  const c = Counterpart.open({ dir, now, timeZone: "UTC" });
  opened.push(c);
  return as(c, session);
}

/** Another session's tools over the same brain. */
function as(c: Counterpart, session: string): McpServer {
  recordSession(dir, { sessionId: session, scope: SCOPE, phase: "start" });
  return new McpServer({ counterpart: c, session, scope: SCOPE, registryDir: dir, now });
}

function nextDay(s: McpServer): void {
  dateN += 1;
  s.counterpart.store.advanceClock(today());
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<{ id: string; result: Record<string, unknown> }> {
  const r = await s.call("remember", args);
  expect(r.isError ?? false).toBe(false);
  const id = r.structuredContent["id"];
  expect(typeof id).toBe("string");
  return { id: id as string, result: r.structuredContent };
}

const meta = (s: McpServer, id: string): Record<string, unknown> => s.counterpart.store.readProse(id).meta;

/** The lines under a lane heading, up to the blank line that ends it. */
function lane(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return out;
}

/** Both wakes for today: the turn-end's (published) and a session start's (assembled). */
function wakes(s: McpServer): string[] {
  const c = s.counterpart;
  const built = c.rebrief({ budgetBytes: BUDGET, at: today() });
  expect(built.published).toBe(true);
  const woke = c.wake(BUDGET, { date: today() }, { scope: SCOPE, session: `s-wake-${String(dateN)}` });
  expect(woke.ok).toBe(true);
  return [c.wake(BUDGET).text, woke.text];
}

// ═══════════════════════════════════════════════════════════════════════════
describe("1. the field", () => {
  test("remember and session_end both offer it, and say a date goes in eventDate", () => {
    const remembered = (toolSpec("remember")?.inputSchema as { properties: Record<string, { description: string }> }).properties["settlesWhen"];
    const entry = (toolSpec("session_end")?.inputSchema as { properties: { memories: { items: { properties: Record<string, { description: string }> } } } }).properties.memories.items
      .properties["settlesWhen"];
    for (const d of [remembered?.description, entry?.description]) {
      expect(d).toContain("with unresolved: true");
      expect(d).toContain("A date goes in eventDate");
    }
  });

  test("remember with unresolved + settlesWhen keeps it in meta; without the flag it is dropped", async () => {
    const s = server("s-a");
    nextDay(s);
    const open = await remember(s, { text: "Open: how did Katie's first reading at the library go?", unresolved: true, settlesWhen: `  ${KATIE}\n` });
    expect(meta(s, open.id)["unresolved"]).toBe(true);
    expect(meta(s, open.id)["settlesWhen"]).toBe(KATIE);
    const plain = await remember(s, { text: "The library reading room seats forty people.", settlesWhen: "never mind" });
    expect(meta(s, plain.id)["settlesWhen"]).toBeUndefined();
    expect(meta(s, plain.id)["unresolved"]).toBeUndefined();
  });

  test("a long phrase is cut at a word, never refused", () => {
    const long = `${"Mike decides whether the spring pricing goes up ".repeat(6)}today`;
    const kept = cleanSettlesWhen(long) ?? "";
    expect(kept.length).toBeLessThanOrEqual(SETTLES_WHEN_CHARS);
    expect(kept.endsWith("…")).toBe(true);
    expect(cleanSettlesWhen("   ")).toBeNull();
  });

  test("session_end entries take it the same way", async () => {
    const s = server("s-end");
    nextDay(s);
    const r = await s.call("session_end", {
      session: "s-end",
      memories: [
        { content: "Open: Mike has not yet decided the pricing for the spring kiln class.", unresolved: true, settlesWhen: "Mike decides pricing" },
        { content: "The spring kiln class meets on Tuesdays in the north studio.", settlesWhen: "no flag, so dropped" },
      ],
    });
    expect(r.isError ?? false).toBe(false);
    const ids = s.counterpart.store.list({ type: "memory" });
    const docs = ids.map((id) => ({ id, doc: s.counterpart.store.readProse(id) }));
    const open = docs.find((d) => d.doc.body.includes("pricing for the spring kiln"));
    const plain = docs.find((d) => d.doc.body.includes("meets on Tuesdays"));
    expect(open?.doc.meta["settlesWhen"]).toBe("Mike decides pricing");
    expect(plain?.doc.meta["settlesWhen"]).toBeUndefined();
  });

  test("a revision that carries the thread on keeps it, unless it sends a new one or null", async () => {
    const s = server("s-rev");
    nextDay(s);
    const first = await remember(s, { text: "Open: is the Gilead thread waiting on the Kansas trip?", unresolved: true, settlesWhen: "after Kansas" });
    const carried = await remember(s, { text: "Open: the Gilead thread, still waiting on the Kansas trip, now the week after.", unresolved: true, updates: first.id });
    expect(meta(s, first.id)["unresolved"]).toBe(false);
    expect(meta(s, carried.id)["settlesWhen"]).toBe("after Kansas");
    const renamed = await remember(s, { text: "Open: the Gilead thread now waits on Katie's letter, not Kansas.", unresolved: true, updates: carried.id, settlesWhen: "Katie's letter comes" });
    expect(meta(s, renamed.id)["settlesWhen"]).toBe("Katie's letter comes");
    const dropped = await remember(s, { text: "Open: the Gilead thread, nothing named to settle it now.", unresolved: true, updates: renamed.id, settlesWhen: null });
    expect(meta(s, dropped.id)["settlesWhen"]).toBeUndefined();
    expect(meta(s, dropped.id)["unresolved"]).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2–3. Still open shows it, and the night closes the item when it happens", () => {
  test("the whole path: remember → Still open (wake + recall) → a later memory → the reflection closes it with a why", async () => {
    const s = server("s-day");
    nextDay(s);
    const open = await remember(s, { text: "Open: how did Katie's first reading at the library go?", unresolved: true, settlesWhen: KATIE });
    const plainOpen = await remember(s, { text: "Open: should the kiln log move to the shared folder?", unresolved: true });

    // The wake, built and assembled: the tail on the item that named one, none on the other.
    for (const text of wakes(s)) {
      const lines = lane(text, FRAMING.threads);
      const katie = lines.find((l) => l.includes("Katie's first reading"));
      expect(katie).toBeDefined();
      expect(katie).toEndWith(`· settles when ${KATIE}`);
      const kiln = lines.find((l) => l.includes("kiln log"));
      expect(kiln).toBeDefined();
      expect(kiln).not.toContain("settles");
    }

    // recall "still open"
    const listed = await s.call("recall", { handle: "still open" });
    const items = listed.structuredContent["items"] as { id: string; settlesWhen?: string }[];
    expect(items.find((i) => i.id === open.id)?.settlesWhen).toBe(KATIE);
    expect(items.find((i) => i.id === plainOpen.id)?.settlesWhen).toBeUndefined();

    // The next day the trigger happens.
    nextDay(s);
    const answer = await remember(s, { text: "Katie said the library reading went well: the room was full and two people asked for the poems." });

    // The night: the reflection is shown the item with its trigger, though it is not stale.
    const night = "s-night";
    recordSession(dir, { sessionId: night, scope: SCOPE, phase: "start" });
    const begun = s.counterpart.reflections.begin({ session: night });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.staleOpen.map((x) => x.id)).not.toContain(open.id);
    expect(begun.bundle.settlesOpen?.map((x) => ({ id: x.id, settlesWhen: x.settlesWhen }))).toEqual([{ id: open.id, settlesWhen: KATIE }]);
    expect(begun.instructions).toContain("settlesOpen");
    const rid = begun.bundle.reflection;

    // Through the reflect tool: closed now, with a why and the memory that shows it.
    const fin = await as(s.counterpart, night).call("reflect", {
      phase: "finish",
      session: night,
      reflection: rid,
      entry: "A quiet day; the reading question answered itself.",
      closeNow: [{ id: open.id, why: "Katie said how the reading went: it went well.", shows: answer.id }],
    });
    expect(fin.isError ?? false).toBe(false);
    const m = meta(s, open.id);
    expect(m["unresolved"]).toBe(false);
    expect(m["threadClosedBy"]).toMatchObject({ reflection: rid, why: "Katie said how the reading went: it went well.", shows: answer.id });
    // The one with no trigger is untouched, and could not have been closed tonight.
    expect(meta(s, plainOpen.id)["unresolved"]).toBe(true);

    // And it leaves "Still open".
    for (const text of wakes(s)) expect(lane(text, FRAMING.threads).some((l) => l.includes("Katie's first reading"))).toBe(false);
  });

  test("the reflection's lean bundle names the trigger, and a fresh item with none is not offered", async () => {
    const s = server("s-lean");
    nextDay(s);
    await remember(s, { text: "Open: has the pottery guild answered about the booth?", unresolved: true, settlesWhen: "the guild answers about the booth" });
    await remember(s, { text: "Open: is the glaze order late?", unresolved: true });
    nextDay(s);
    const night = "s-night-lean";
    recordSession(dir, { sessionId: night, scope: SCOPE, phase: "start" });
    const rb = await as(s.counterpart, night).call("reflect", { phase: "begin", session: night });
    expect(rb.isError ?? false).toBe(false);
    const bundle = String(rb.structuredContent["bundle"]);
    const after = lane(bundle, "## settlesOpen");
    const end = after.findIndex((l) => l.startsWith("## "));
    const listed = (end < 0 ? after : after.slice(0, end)).filter((l) => l.startsWith("- "));
    expect(listed.length).toBe(1);
    expect(listed[0]).toContain("pottery guild");
    expect(listed[0]).toEndWith("settlesWhen: the guild answers about the booth");
    expect(String(rb.structuredContent["how"])).toContain("settlesOpen");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("4. without a settlesWhen, as before", () => {
  test("no tail, no settlesOpen, and a fresh item is not closable", async () => {
    const s = server("s-plain");
    nextDay(s);
    const open = await remember(s, { text: "Open: should the kiln log move to the shared folder?", unresolved: true });
    expect(meta(s, open.id)["settlesWhen"]).toBeUndefined();
    for (const text of wakes(s)) {
      const line = lane(text, FRAMING.threads).find((l) => l.includes("kiln log"));
      expect(line).toBeDefined();
      expect(line).not.toContain("settles");
    }
    nextDay(s);
    const night = "s-night-plain";
    recordSession(dir, { sessionId: night, scope: SCOPE, phase: "start" });
    const begun = s.counterpart.reflections.begin({ session: night });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.settlesOpen).toBeUndefined();
    expect(begun.instructions).not.toContain("settlesOpen");
    const done = s.counterpart.reflections.finish({
      reflection: begun.bundle.reflection,
      session: night,
      entry: "Nothing much.",
      closeNow: [{ id: open.id, why: "Looks done." }],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.refused).toEqual([{ id: open.id, reason: "not-offered" }]);
    expect(meta(s, open.id)["unresolved"]).toBe(true);
  });

  test("the tail's words: 'when' is added only when the phrase does not already say it", () => {
    expect(settlesTail(undefined)).toBe("");
    expect(settlesTail(KATIE)).toBe(` · settles when ${KATIE}`);
    expect(settlesTail("after the 11-26 check")).toBe(" · settles after the 11-26 check");
  });

  test("the stale list still carries at most STALE_OPEN, the settles list at most SETTLES_OPEN", () => {
    expect(REFLECT_TUNABLES.STALE_OPEN).toBe(5);
    expect(REFLECT_TUNABLES.SETTLES_OPEN).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("5. the counter", () => {
  test("status counts open items, and how many name what would settle them", async () => {
    const s = server("s-status");
    nextDay(s);
    await remember(s, { text: "Open: how did Katie's first reading at the library go?", unresolved: true, settlesWhen: KATIE });
    await remember(s, { text: "Open: should the kiln log move to the shared folder?", unresolved: true });
    await remember(s, { text: "Open: is the glaze order late?", unresolved: true });
    await remember(s, { text: "The kiln holds twelve shelves." });
    const r = await s.call("status", {});
    expect(r.structuredContent["openItems"]).toMatchObject({ open: 3, withSettlesWhen: 1, withoutSettlesWhen: 2 });
  });
});
