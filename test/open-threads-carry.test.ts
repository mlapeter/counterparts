/**
 * OPEN THREADS MEAN SOMEONE OWES AN ANSWER (2026-10-22, the open-threads
 * brief; Mike agreed the shape, the numbers are starting points):
 *
 *   1. `unresolved`'s description on `remember` and `session_end`, and the
 *      Stop ask, say open means someone owes an answer.
 *   2. The Stop ask names THIS session's own open items by title and id, at
 *      most `STOP_OPEN_MAX`, and nothing when there are none.
 *   3. An open item with no eventDate, not `asked`, untouched for
 *      `OPEN_CARRY_DAYS` lived days is no longer carried: out of the wake's
 *      "Still open" and its count, built and assembled, and out of the
 *      reflection's `staleOpen`. Not closed; a touch carries it again. Being
 *      shown — in the wake or the reflection's bundle — is not a touch. The
 *      reflection is told the count once, never the list.
 *
 * Every check goes through a real door: the MCP tools, the Stop hook, the
 * wake (turn-end and session start), the reflection's begin and finish.
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, toolSpec } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { recordSession } from "../src/adapters/sessions.js";
import { TUNABLES as ADAPTER_TUNABLES } from "../src/adapters/config.js";
import { openAdapter, stopAsk } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import { STOP_ASK_OPENER, parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { FRAMING, SELF_TUNABLES } from "../src/core/self/index.js";
import { REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { addDays, localDate } from "../src/core/time.js";

const BASE = Date.parse("2026-09-01T12:00:00Z");
const BUDGET = 9_000;
const SCOPE = "/proj";
let dir: string;
let dateN = 0;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-open-carry-"));
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

/** The brain on the test clock, and the tools bound to `session` over it. */
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

/** On to lived day `n`, a calendar day at a time. */
function toDay(s: McpServer, n: number): void {
  while (s.counterpart.store.livedDay() < n) {
    dateN += 1;
    s.counterpart.store.advanceClock(today());
  }
  expect(s.counterpart.store.livedDay()).toBe(n);
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const r = await s.call("remember", args);
  expect(r.isError ?? false).toBe(false);
  const id = r.structuredContent["id"];
  expect(typeof id).toBe("string");
  if (typeof args["text"] === "string") words.set(id as string, args["text"]);
  return id as string;
}

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
function wakes(s: McpServer): { built: string; assembled: string } {
  const c = s.counterpart;
  const built = c.rebrief({ budgetBytes: BUDGET, at: today() });
  expect(built.published).toBe(true);
  const woke = c.wake(BUDGET, { date: today() }, { scope: SCOPE, session: `s-wake-${String(dateN)}` });
  expect(woke.ok).toBe(true);
  return { built: c.wake(BUDGET).text, assembled: woke.text };
}

/** What each memory this test wrote says, by id: a shown line carries its words, a counted one its id. */
const words = new Map<string, string>();

/** Is it under "Still open" — listed (its words) or counted (its id)? */
const inStillOpen = (text: string, id: string): boolean => {
  const said = words.get(id) ?? id;
  return lane(text, FRAMING.threads).some((l) => l.includes(id) || l.includes(said));
};

// ═══════════════════════════════════════════════════════════════════════════
describe("1. open means someone owes an answer", () => {
  test("remember's and session_end's `unresolved` say so, and so does the Stop ask", () => {
    const remembered = (toolSpec("remember")?.inputSchema as { properties: Record<string, { description: string }> }).properties["unresolved"];
    const entry = (toolSpec("session_end")?.inputSchema as { properties: { memories: { items: { properties: Record<string, { description: string }> } } } }).properties.memories.items
      .properties["unresolved"];
    for (const d of [remembered?.description, entry?.description]) {
      expect(d).toContain("true only when someone owes an answer — a question to the owner, a check with a date, a promise");
      expect(d).toContain("A bug observation, a design note or a fact is a memory with no open flag");
      expect(d).toContain("`unresolved: false`");
    }
    expect(stopAsk("s1", 1)).toContain("`unresolved` only when someone owes an answer (a question to them, a check with a date, a promise)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("3. an untouched, ownerless open item stops being carried", () => {
  test("the live store's example: born on lived days 11 and 12, untouched — carried through day 31, gone on 32 and 33; dated and asked ones stay", async () => {
    expect(SELF_TUNABLES.OPEN_CARRY_DAYS).toBe(21);
    const s = server("s-writer");
    toDay(s, 11);
    const eleven = await remember(s, { text: "Open: should the Zillow listing note move to the house folder?", unresolved: true });
    const asked = await remember(s, { text: "Open: Mike asked which week the tax packet goes out.", unresolved: true, status: "asked" });
    toDay(s, 12);
    const twelve = await remember(s, { text: "Open: the Tiny Castles tile sizes disagree between the two sheets.", unresolved: true });
    toDay(s, 25);
    // Six live ones, so the lane overflows and its count line names the rest.
    const fresh: string[] = [];
    for (let i = 0; i < 6; i += 1) fresh.push(await remember(s, { text: `Open: question ${String(i)} for Mike about the kiln schedule this week.`, unresolved: true }));

    // Days 25..31 shown every day — in both wakes and the reflection's bundle —
    // and none of it is a touch.
    // Shown every day from 25 to 31 — in both wakes and the reflection's
    // bundle — and none of it is a touch.
    for (let d = 25; d <= 31; d += 1) {
      toDay(s, d);
      const w = wakes(s);
      for (const text of [w.built, w.assembled]) for (const id of [eleven, twelve, asked]) expect(inStillOpen(text, id)).toBe(true);
      const night = s.counterpart.reflections.begin({ session: `s-night-${String(d)}` });
      if (!night.ok) throw new Error(night.reason);
      expect(night.bundle.noLongerCarried).toBeUndefined();
      if (d === 31) expect(night.bundle.staleOpen.map((x) => x.id)).toEqual(expect.arrayContaining([eleven, twelve]));
    }

    // Day 32: the day-11 one is no longer carried, in either wake.
    toDay(s, 32);
    let w = wakes(s);
    for (const text of [w.built, w.assembled]) {
      expect(inStillOpen(text, eleven)).toBe(false);
      expect(inStillOpen(text, twelve)).toBe(true);
      expect(inStillOpen(text, asked)).toBe(true);
    }
    // Not closed: the flag stands.
    expect(s.counterpart.store.readProse(eleven).meta["unresolved"]).toBe(true);

    // Day 33: both gone, from the list and its count; the asked one stays.
    toDay(s, 33);
    w = wakes(s);
    for (const text of [w.built, w.assembled]) {
      expect(inStillOpen(text, eleven)).toBe(false);
      expect(inStillOpen(text, twelve)).toBe(false);
      expect(inStillOpen(text, asked)).toBe(true);
      // In no other lane either ("Nearby" would read as carried still).
      for (const id of [eleven, twelve]) {
        expect(text).not.toContain(id);
        expect(text).not.toContain(words.get(id) ?? id);
      }
      // 6 fresh + asked = 7 carried: 5 listed, "2 more".
      expect(lane(text, FRAMING.threads).join("\n")).toMatch(/\(2 more still open/);
    }

    // Recall still finds it — and being shown an answer is not a touch.
    const read = await s.call("recall", { question: "the Zillow listing note and the house folder", mode: "facts" });
    expect(read.isError ?? false).toBe(false);
    expect(read.structuredContent["ids"]).toContain(eleven);
    w = wakes(s);
    for (const text of [w.built, w.assembled]) expect(inStillOpen(text, eleven)).toBe(false);
    // Used — the session drew on it — is: carried again the same day.
    const drew = await s.call("session_end", { session: "s-writer", memories: [], drewOn: [eleven] });
    expect(drew.structuredContent["drewOn"]).toEqual({ credited: [eleven] });
    w = wakes(s);
    for (const text of [w.built, w.assembled]) expect(inStillOpen(text, eleven)).toBe(true);
    expect(fresh.length).toBe(6);
  });

  test("a dated open item is carried however long untouched; a revision (a reopen) is a touch", async () => {
    const s = server("s-writer");
    toDay(s, 2);
    const dated = await remember(s, { text: "Open: check the backup restore on the first of the year with Robin.", unresolved: true, eventDate: "2027-01-01" });
    const plain = await remember(s, { text: "Open: does the glaze order need a second supplier before spring?", unresolved: true });
    const reopened = await remember(s, { text: "Open: did the old deploy key come off the build box for good?", unresolved: true });
    // Day 20: the reflection closes one itself; on day 30 the owner reopens it — a revision.
    toDay(s, 20);
    const night = s.counterpart.reflections.begin({ session: "s-night" });
    if (!night.ok) throw new Error(night.reason);
    const fin = s.counterpart.reflections.finish({ reflection: night.bundle.reflection, session: "s-night", entry: "A look back.", closeNow: [{ id: reopened, why: "The key list shows it gone." }] });
    if (!fin.ok) throw new Error(fin.reason);
    expect(s.counterpart.store.readProse(reopened).meta["unresolved"]).toBe(false);
    toDay(s, 30);
    const back = s.counterpart.reflections.reopen({ reflection: night.bundle.reflection, session: "s-owner", ids: [reopened] });
    if (!back.ok) throw new Error(back.reason);
    expect(back.reopened).toEqual([reopened]);

    toDay(s, 40);
    const w = wakes(s);
    for (const text of [w.built, w.assembled]) {
      expect(inStillOpen(text, dated)).toBe(true);
      expect(inStillOpen(text, plain)).toBe(false);
      expect(inStillOpen(text, reopened)).toBe(true);
    }
    const touches = new Map(s.counterpart.store.openThreadTouches().map((t) => [t.id, t]));
    expect(touches.get(dated)).toMatchObject({ touchedDay: 2, dated: true });
    expect(touches.get(reopened)?.touchedDay).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("3b. the reflection: out of staleOpen, and the count told once", () => {
  test("staleOpen drops it; noLongerCarried counts only what is new since the last finished reflection; a share citing one does not carry it", async () => {
    const s = server("s-writer");
    toDay(s, 1);
    const a = await remember(s, { text: "Open: is the old deploy key still on the build box?", unresolved: true });
    toDay(s, 3);
    const b = await remember(s, { text: "Open: talk through the chapter numbering later.", unresolved: true });
    toDay(s, 21);
    const night21 = s.counterpart.reflections.begin({ session: "s-night" });
    if (!night21.ok) throw new Error(night21.reason);
    expect(night21.bundle.staleOpen.map((x) => x.id)).toEqual(expect.arrayContaining([a, b]));
    // The share asks about one, citing it: a reflection's return, not a touch.
    const fin21 = s.counterpart.reflections.finish({
      reflection: night21.bundle.reflection,
      session: "s-night",
      entry: "A look back.",
      share: { text: "Is the old deploy key still on the build box?", cites: [a] },
      close: [a],
    });
    if (!fin21.ok) throw new Error(fin21.reason);
    // The cite came back as a reflection's return (physics §5.11) — which the carry does not read.
    expect(s.counterpart.store.returnsOf(a).some((r) => r.source === "reflection" && r.day === 21)).toBe(true);

    toDay(s, 22);
    const night22 = s.counterpart.reflections.begin({ session: "s-night" });
    if (!night22.ok) throw new Error(night22.reason);
    expect(night22.bundle.staleOpen.map((x) => x.id)).not.toContain(a);
    expect(night22.bundle.staleOpen.map((x) => x.id)).toContain(b);
    expect(night22.bundle.noLongerCarried).toBe(1);
    expect(night22.instructions).toContain('"1 open item nobody touched in three weeks is no longer carried; recall shows them."');
    expect(night22.instructions).not.toContain(a);
    const fin22 = s.counterpart.reflections.finish({ reflection: night22.bundle.reflection, session: "s-night", entry: "Another look back." });
    if (!fin22.ok) throw new Error(fin22.reason);
    expect(JSON.parse(s.counterpart.store.reflection(night22.bundle.reflection)?.detail ?? "{}")["notCarried"]).toEqual([a]);

    // Day 24: b leaves too; only b is new to tell.
    toDay(s, 24);
    const night24 = s.counterpart.reflections.begin({ session: "s-night" });
    if (!night24.ok) throw new Error(night24.reason);
    expect(night24.bundle.staleOpen.map((x) => x.id)).not.toContain(b);
    expect(night24.bundle.noLongerCarried).toBe(1);
    expect(REFLECT_TUNABLES.STALE_OPEN).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2. the Stop ask names this session's own open items", () => {
  const BIG_TURNS: HookInput["turns"] = Array.from({ length: 14 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    text: `Turn ${String(i)}: ${"a real exchange with enough substance in it to pace a ritual honestly, said at the length people actually work at. ".repeat(3)}`,
  }));

  async function writeAs(session: string, items: readonly Record<string, unknown>[]): Promise<string[]> {
    const s = server(session);
    const ids: string[] = [];
    for (const it of items) ids.push(await remember(s, it));
    s.counterpart.close();
    opened.splice(opened.indexOf(s.counterpart), 1);
    return ids;
  }

  function stopFor(session: string): string | null {
    const a = openAdapter({ dataDir: dir, injectionBudgetBytes: BUDGET }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) });
    opened.push(a.counterpart);
    recordSession(dir, { sessionId: session, scope: SCOPE, phase: "start" });
    const out = a.stop({ sessionId: session, scope: SCOPE, turns: BIG_TURNS, at: "2026-09-01" });
    a.counterpart.close();
    opened.splice(opened.indexOf(a.counterpart), 1);
    return out.ask;
  }

  test("by title and id, its own only, open only; none: the two lines as before", async () => {
    const [mine, , ] = await writeAs("s-here", [
      { text: "Open: will Mike approve the sidebar split before Friday?", title: "Sidebar split approval", unresolved: true },
      { text: "The sidebar split moves the mod into its own package." },
      { text: "The kiln question from last week was answered: cone six, by Robin.", unresolved: false },
    ]);
    const [theirs] = await writeAs("s-elsewhere", [{ text: "Open: which day does the store move?", title: "Store move day", unresolved: true }]);
    const ask = stopFor("s-here");
    expect(ask).not.toBe(null);
    const lines = (ask ?? "").split("\n");
    expect(lines.length).toBe(3);
    expect(lines[2]).toBe(`Still open from this session — close any now answered with \`updates\` and \`unresolved: false\`: "Sidebar split approval" (${String(mine)}).`);
    expect(ask).not.toContain(String(theirs));
    // The first two lines are the ask as before; the host reads it home as ritual.
    expect(lines.slice(0, 2).join("\n")).toBe(stopAsk("s-here", 1));
    expect(ask?.startsWith(STOP_ASK_OPENER)).toBe(true);
    const meta = JSON.stringify({ type: "user", userType: "external", isMeta: true, message: { role: "user", content: ask } });
    expect(parseTranscript(meta).turns[0]?.source).toBe("ritual");

    // A session with nothing open: the two lines, exactly.
    expect(stopFor("s-elsewhere-2")).toBe(stopAsk("s-elsewhere-2", 1));
  });

  test("capped at STOP_OPEN_MAX, the newest first; 0 is the revert", async () => {
    expect(ADAPTER_TUNABLES.STOP_OPEN_MAX).toBe(5);
    const ids = await writeAs(
      "s-many",
      Array.from({ length: 7 }, (_, i) => ({ text: `Open: question ${String(i)} for Mike about the release.`, title: `Release question ${String(i)}`, unresolved: true })),
    );
    const ask = stopFor("s-many") ?? "";
    const last = ask.split("\n")[2] ?? "";
    expect(last.match(/mem_[0-9a-f]+/g)?.length).toBe(5);
    const T = ADAPTER_TUNABLES as { STOP_OPEN_MAX: number };
    T.STOP_OPEN_MAX = 0;
    try {
      // Another Stop of the same session is paced: ask a fresh one.
      await writeAs("s-many-2", [{ text: "Open: one more for Mike.", unresolved: true }]);
      expect(stopFor("s-many-2")).toBe(stopAsk("s-many-2", 1));
    } finally {
      T.STOP_OPEN_MAX = 5;
    }
    expect(ids.length).toBe(7);
  });
});
