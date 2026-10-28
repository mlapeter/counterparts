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
import { OPEN_LINE_MAX_CHARS } from "../src/adapters/claude-code/hooks.js";
import { FRAMING, SELF_TUNABLES, countedLanes, openCarry } from "../src/core/self/index.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
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

/** Is it under "Still open" — listed (its words)? (Before 2026-10-25 a
 *  counted one showed its id too; the count names no id now, `openTotal`.) */
const inStillOpen = (text: string, id: string): boolean => {
  const said = words.get(id) ?? id;
  return lane(text, FRAMING.threads).some((l) => l.includes(id) || l.includes(said));
};

/** How many "Still open" carries: the items it lists and the ones it counts. */
const openTotal = (text: string): number => {
  const lines = lane(text, FRAMING.threads);
  return lines.filter((l) => l.startsWith("- ")).length + (countedLanes(lines.join("\n")).threads ?? 0);
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
      // The three old ones rank after the six fresh (`byThreadLive`), so they
      // are counted, not listed: 6 fresh + 3 = 9 carried, 5 listed, "4 more".
      for (const text of [w.built, w.assembled]) expect(openTotal(text)).toBe(9);
      const night = s.counterpart.reflections.begin({ session: `s-night-${String(d)}` });
      if (!night.ok) throw new Error(night.reason);
      expect(night.bundle.noLongerCarried).toBeUndefined();
      if (d === 31) expect(night.bundle.staleOpen.map((x) => x.id)).toEqual(expect.arrayContaining([eleven, twelve]));
    }

    // Day 32: the day-11 one is no longer carried, in either wake.
    toDay(s, 32);
    let w = wakes(s);
    // (Counted, so by the total: only the day-11 one is 21 lived days untouched.)
    for (const text of [w.built, w.assembled]) {
      expect(inStillOpen(text, eleven)).toBe(false);
      expect(openTotal(text)).toBe(8);
    }
    // Which one the total lost, by id (review of #623: the count names no ids now).
    const carry32 = openCarry(s.counterpart.store, 32, SELF_TUNABLES.OPEN_CARRY_DAYS).notCarried;
    expect([eleven, twelve, asked].map((id) => carry32.has(id))).toEqual([true, false, false]);
    // Not closed: the flag stands.
    expect(s.counterpart.store.readProse(eleven).meta["unresolved"]).toBe(true);

    // Day 33: both gone, from the list and its count; the asked one stays.
    toDay(s, 33);
    w = wakes(s);
    for (const text of [w.built, w.assembled]) {
      expect(inStillOpen(text, eleven)).toBe(false);
      expect(inStillOpen(text, twelve)).toBe(false);
      expect(openTotal(text)).toBe(7);
      const carry33 = openCarry(s.counterpart.store, 33, SELF_TUNABLES.OPEN_CARRY_DAYS).notCarried;
      expect([eleven, twelve, asked].map((id) => carry33.has(id))).toEqual([true, true, false]);
      // In no other lane either ("Nearby" would read as carried still).
      for (const id of [eleven, twelve]) {
        expect(text).not.toContain(id);
        expect(text).not.toContain(words.get(id) ?? id);
      }
      // 6 fresh + asked = 7 carried: 5 listed, "2 more".
      expect(lane(text, FRAMING.threads).join("\n")).toMatch(/\(2 more open, /);
    }

    // Recall still finds it — and being shown an answer is not a touch.
    const read = await s.call("recall", { question: "the Zillow listing note and the house folder", mode: "facts" });
    expect(read.isError ?? false).toBe(false);
    expect(read.structuredContent["ids"]).toContain(eleven);
    w = wakes(s);
    for (const text of [w.built, w.assembled]) {
      expect(inStillOpen(text, eleven)).toBe(false);
      expect(openTotal(text)).toBe(7);
    }
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
  test("staleOpen drops it; noLongerCarried counts only what a told share has not said; a share citing one does not carry it", async () => {
    const s = server("s-writer");
    const c = s.counterpart;
    toDay(s, 1);
    const a = await remember(s, { text: "Open: is the old deploy key still on the build box?", unresolved: true });
    toDay(s, 3);
    const b = await remember(s, { text: "Open: talk through the chapter numbering later.", unresolved: true });
    toDay(s, 21);
    const night21 = c.reflections.begin({ session: "s-night" });
    if (!night21.ok) throw new Error(night21.reason);
    expect(night21.bundle.staleOpen.map((x) => x.id)).toEqual(expect.arrayContaining([a, b]));
    // The share asks about one, citing it: a reflection's return, not a touch.
    const fin21 = c.reflections.finish({
      reflection: night21.bundle.reflection,
      session: "s-night",
      entry: "A look back.",
      share: { text: "Is the old deploy key still on the build box?", cites: [a] },
      close: [a],
    });
    if (!fin21.ok) throw new Error(fin21.reason);
    // The cite came back as a reflection's return (physics §5.11) — which the carry does not read.
    expect(c.store.returnsOf(a).some((r) => r.source === "reflection" && r.day === 21)).toBe(true);
    expect(c.reflections.told({ reflection: night21.bundle.reflection, session: "s-morning" }).ok).toBe(true);

    toDay(s, 22);
    const night22 = c.reflections.begin({ session: "s-night" });
    if (!night22.ok) throw new Error(night22.reason);
    expect(night22.bundle.staleOpen.map((x) => x.id)).not.toContain(a);
    expect(night22.bundle.staleOpen.map((x) => x.id)).toContain(b);
    expect(night22.bundle.noLongerCarried).toBe(1);
    expect(night22.instructions).toContain('"1 open item nobody touched in 21 lived days is no longer carried; recall shows them."');
    expect(night22.instructions).not.toContain(a);
    // A quiet night: no share, so nothing is spent.
    const fin22 = c.reflections.finish({ reflection: night22.bundle.reflection, session: "s-night", entry: "Another look back." });
    if (!fin22.ok) throw new Error(fin22.reason);
    expect(JSON.parse(c.store.reflection(night22.bundle.reflection)?.detail ?? "{}")["notCarried"]).toEqual([a]);

    // Day 24: b leaves too. a went untold on 22, so the count says both.
    toDay(s, 24);
    const night24 = c.reflections.begin({ session: "s-night" });
    if (!night24.ok) throw new Error(night24.reason);
    expect(night24.bundle.staleOpen.map((x) => x.id)).not.toContain(b);
    expect(night24.bundle.noLongerCarried).toBe(2);
    const fin24 = c.reflections.finish({ reflection: night24.bundle.reflection, session: "s-night", entry: "A third look.", share: { text: "Two open items went quiet; the chapter numbering one among them.", cites: [b] } });
    if (!fin24.ok) throw new Error(fin24.reason);
    expect(c.reflections.told({ reflection: night24.bundle.reflection, session: "s-morning-2" }).ok).toBe(true);

    // Told: the next night has nothing new to say.
    toDay(s, 25);
    const night25 = c.reflections.begin({ session: "s-night" });
    if (!night25.ok) throw new Error(night25.reason);
    expect(night25.bundle.noLongerCarried).toBeUndefined();
    expect(REFLECT_TUNABLES.STALE_OPEN).toBe(5);
  });

  test("the count is of threads the wake carried: a dreamed one and a settled-over one are never 'no longer carried'", async () => {
    const s = server("s-writer");
    const c = s.counterpart;
    toDay(s, 1);
    const dreamed = c.store.put({ type: "memory", kind: "fact", body: "Open: a dreamed thread about the ferry timetable.", source: "dreamed", meta: { unresolved: true } });
    const old = await remember(s, { text: "Open: which day does the store move to the new shelf?", title: "Store move day", unresolved: true });
    await remember(s, { text: "The store moves to the new shelf on Tuesday.", updates: old, how: "changed" });
    expect(c.store.readProse(old).meta["unresolved"]).toBe(true);
    toDay(s, 25);
    const w = wakes(s);
    for (const text of [w.built, w.assembled]) for (const id of [dreamed, old]) expect(inStillOpen(text, id)).toBe(false);
    const night = c.reflections.begin({ session: "s-night" });
    if (!night.ok) throw new Error(night.reason);
    expect(night.bundle.noLongerCarried).toBeUndefined();
    const touches = openCarry(c.store, 25, SELF_TUNABLES.OPEN_CARRY_DAYS);
    expect(touches.touched.has(dreamed)).toBe(false);
    expect(touches.touched.has(old)).toBe(false);
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

// ═══════════════════════════════════════════════════════════════════════════
// The review of #592: a glimpse is not a touch, nor makes a thread this
// session's own; settled-over threads stay out of the Stop ask; the ask's
// whole length is bounded.
// ═══════════════════════════════════════════════════════════════════════════

/** Ambient footnote showings to a session, as recall's own save records them. */
function footnoted(c: Counterpart, sessionId: string, turn: number, ids: readonly string[]): void {
  const prior = loadGateState(c.store, sessionId).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn, tier: "footnoted", trains: true };
  saveGateState(c.store, { ...freshGateState(sessionId), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

const BIG = Array.from({ length: 14 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text: `Turn ${String(i)}: ${"a real exchange with enough substance in it to pace a ritual honestly, said at the length people actually work at. ".repeat(3)}`,
}));

function stopAt(session: string): string {
  const a = openAdapter({ dataDir: dir, injectionBudgetBytes: BUDGET }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) });
  opened.push(a.counterpart);
  recordSession(dir, { sessionId: session, scope: SCOPE, phase: "start" });
  const out = a.stop({ sessionId: session, scope: SCOPE, turns: BIG, at: "2026-09-01" });
  a.counterpart.close();
  opened.splice(opened.indexOf(a.counterpart), 1);
  return out.ask ?? "";
}

function shut(c: Counterpart): void {
  c.close();
  opened.splice(opened.indexOf(c), 1);
}

describe("review of #592 — F4: a glimpse is not a touch for the carry; a rating of 1–3 or drewOn is", () => {
  test("shown as a footnote and left unrated: still not carried (the glimpse still counts as a use)", async () => {
    const s = server("s-writer");
    const c = s.counterpart;
    toDay(s, 1);
    const stale = await remember(s, { text: "Open: the Desktop chat footnote bug seen on the second.", unresolved: true });
    const other = await remember(s, { text: "The kiln fires at cone six for the stoneware glaze." });
    toDay(s, 30);
    expect(inStillOpen(wakes(s).built, stale)).toBe(false);
    const here = as(c, "s-here");
    footnoted(c, "s-here", 1, [stale, other]);
    const r = await here.call("session_end", { session: "s-here", memories: [], rated: [{ id: other, score: 2 }] });
    expect(r.isError ?? false).toBe(false);
    // The glimpse was credited — a use, and its fade restarts — …
    expect(c.store.row(stale)?.last_used_day).toBe(30);
    expect(c.store.returnsOf(stale).map((x) => x.source)).toEqual(["shown"]);
    // … but shown again is not answered: still not carried.
    const w = wakes(s);
    for (const text of [w.built, w.assembled]) expect(inStillOpen(text, stale)).toBe(false);
  });

  test("rated 0 is not a touch; rated 1 is, the same day, at both wakes", async () => {
    const s = server("s-writer");
    const c = s.counterpart;
    toDay(s, 1);
    const stale = await remember(s, { text: "Open: should the glaze order get a second supplier this spring?", unresolved: true });
    toDay(s, 30);
    const h1 = as(c, "s-here");
    footnoted(c, "s-here", 1, [stale]);
    await h1.call("session_end", { session: "s-here", memories: [], rated: [{ id: stale, score: 0 }] });
    let w = wakes(s);
    for (const text of [w.built, w.assembled]) expect(inStillOpen(text, stale)).toBe(false);
    const h2 = as(c, "s-here-2");
    footnoted(c, "s-here-2", 1, [stale]);
    await h2.call("session_end", { session: "s-here-2", memories: [], rated: [{ id: stale, score: 1 }] });
    w = wakes(s);
    for (const text of [w.built, w.assembled]) expect(inStillOpen(text, stale)).toBe(true);
  });
});

describe("review of #592 — F1/F2/F5: the Stop ask's own items", () => {
  test("another folder's open item only glimpsed, or rated 1 or 0, here is not this session's; one it drew on is", async () => {
    const c = Counterpart.open({ dir, now, timeZone: "UTC" });
    opened.push(c);
    recordSession(dir, { sessionId: "s-personal", scope: "/Users/me/personal", phase: "start" });
    const w = new McpServer({ counterpart: c, session: "s-personal", scope: "/Users/me/personal", registryDir: dir, now });
    toDay(w, 1);
    const glimpsed = await remember(w, { text: "Open: will Robin say yes to the house offer by Friday?", title: "Robin house offer", unresolved: true });
    const ontopic = await remember(w, { text: "Open: does the car need its winter tyres before the trip?", title: "Winter tyres", unresolved: true });
    const noise = await remember(w, { text: "Open: should the garden shed be painted green or left?", title: "Shed paint", unresolved: true });
    const drawn = await remember(w, { text: "Open: is the plumber coming Thursday or Friday next week?", title: "Plumber day", unresolved: true });
    const filler = await remember(w, { text: "The kiln fires at cone six for the stoneware glaze." });
    toDay(w, 3);
    const code = as(c, "s-code");
    footnoted(c, "s-code", 1, [glimpsed, ontopic, noise, drawn, filler]);
    const r = await code.call("session_end", {
      session: "s-code",
      memories: [],
      rated: [
        { id: filler, score: 2 },
        { id: ontopic, score: 1 },
        { id: noise, score: 0 },
      ],
      drewOn: [drawn],
    });
    expect(r.isError ?? false).toBe(false);
    expect(c.store.returnsOf(glimpsed).map((x) => [x.source, x.session])).toEqual([["shown", "s-code"]]);
    shut(c);
    const ask = stopAt("s-code");
    for (const t of ["Robin house offer", "Winter tyres", "Shed paint"]) expect(ask).not.toContain(t);
    expect(ask).toContain(`"Plumber day" (${drawn})`);
  });

  test("a thread settled over (updates, how: changed) is not named; the rest are", async () => {
    const s = server("s-here");
    toDay(s, 1);
    const q = await remember(s, { text: "Open: will Mike approve the sidebar split before Friday?", title: "Sidebar split approval", unresolved: true });
    const old = await remember(s, { text: "Open: which day does the store move to the new shelf?", title: "Store move day", unresolved: true });
    await remember(s, { text: "The store moves to the new shelf on Tuesday.", updates: old, how: "changed" });
    expect(s.counterpart.store.readProse(old).meta["unresolved"]).toBe(true);
    shut(s.counterpart);
    const ask = stopAt("s-here");
    expect(ask).toContain(`"Sidebar split approval" (${q})`);
    expect(ask).not.toContain("Store move day");
    expect(ask).not.toContain(old);
  });

  test("the most recently touched first, by the carry's own touch", async () => {
    const s = server("s-here");
    toDay(s, 1);
    const first = await remember(s, { text: "Open: is the old deploy key still on the build box today?", title: "Deploy key", unresolved: true });
    toDay(s, 2);
    const second = await remember(s, { text: "Open: will the sidebar split land before the Friday release?", title: "Sidebar split", unresolved: true });
    toDay(s, 3);
    await s.call("recall", { question: "old deploy key build box", mode: "facts" });
    const drew = await s.call("session_end", { session: "s-here", memories: [], drewOn: [first] });
    expect(drew.structuredContent["drewOn"]).toEqual({ credited: [first] });
    shut(s.counterpart);
    const last = stopAt("s-here").split("\n")[2] ?? "";
    expect(last.indexOf(first)).toBeGreaterThan(-1);
    expect(last.indexOf(first)).toBeLessThan(last.indexOf(second));
  });

  test("the whole ask is bounded: a UUID session, five long titles", async () => {
    const SID = "7c973b1c-d40a-47e5-92bb-8cdb1823a06d";
    const s = server(SID);
    toDay(s, 1);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await remember(s, { text: `Open: ${"a long open question about the release plan and its order ".repeat(3)} ${String(i)}`, unresolved: true }));
    shut(s.counterpart);
    const ask = stopAt(SID);
    const lines = ask.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[2]?.length ?? 0).toBeLessThanOrEqual(OPEN_LINE_MAX_CHARS);
    expect(lines[2]?.match(/mem_[0-9a-f]+/g)?.length).toBe(5);
    // 1,250 until 2026-10-27; 1,300 since the ask invites settlesWhen (F1, 51 characters).
    expect(ask.length).toBeLessThanOrEqual(1_300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The re-review of #592: a real use counts in every order, even on the day a
// reflection cited it (G1); each leaving is said in exactly one share (G2);
// the glimpse rule's revert; a core memory is never a thread here.
// ═══════════════════════════════════════════════════════════════════════════

describe("re-review of #592 — G1: a real use is a touch in every order; a glimpse never is", () => {
  function onDay(c: Counterpart, n: number): void {
    while (c.store.livedDay() < n) {
      dateN += 1;
      c.store.advanceClock(today());
    }
    expect(c.store.livedDay()).toBe(n);
  }
  async function stale(): Promise<{ c: Counterpart; x: string; filler: string }> {
    const s = server("s-writer");
    onDay(s.counterpart, 1);
    const x = await remember(s, { text: "Open: should the glaze order get a second supplier this spring?", unresolved: true });
    const filler = await remember(s, { text: "The kiln fires at cone six for the stoneware glaze." });
    return { c: s.counterpart, x, filler };
  }
  const touched = (c: Counterpart, id: string): number | undefined => c.store.openThreadTouches().find((t) => t.id === id)?.touchedDay;
  async function glimpse(c: Counterpart, session: string, x: string, filler: string): Promise<void> {
    const s = as(c, session);
    footnoted(c, session, 1, [x, filler]);
    const r = await s.call("session_end", { session, memories: [], rated: [{ id: filler, score: 2 }] });
    expect(r.isError ?? false).toBe(false);
  }
  async function rate(c: Counterpart, session: string, x: string, score: number): Promise<void> {
    const s = as(c, session);
    const read = await s.call("recall", { question: "glaze order second supplier spring", mode: "facts" });
    expect(read.structuredContent["ids"]).toContain(x);
    const r = await s.call("session_end", { session, memories: [], rated: [{ id: x, score }] });
    expect(r.isError ?? false).toBe(false);
  }

  test("a glimpse alone is not a touch", async () => {
    const { c, x, filler } = await stale();
    onDay(c, 10);
    await glimpse(c, "sA", x, filler);
    expect(c.store.row(x)?.last_used_day).toBe(10);
    expect(touched(c, x)).toBe(1);
  });

  for (const score of [1, 2, 3]) {
    test(`a glimpse then rating ${String(score)} the same day, then a glimpse days later: touched on the rating's day`, async () => {
      const { c, x, filler } = await stale();
      onDay(c, 10);
      await glimpse(c, "sA", x, filler);
      await rate(c, "sB", x, score);
      expect(touched(c, x)).toBe(10);
      onDay(c, 15);
      await glimpse(c, "sC", x, filler);
      expect(touched(c, x)).toBe(10);
    });
    test(`rating ${String(score)} then a glimpse the same day: touched`, async () => {
      const { c, x, filler } = await stale();
      onDay(c, 10);
      await rate(c, "sB", x, score);
      await glimpse(c, "sA", x, filler);
      expect(touched(c, x)).toBe(10);
    });
  }

  test("two glimpses by two sessions the same day, then a rating 2 by a third: touched", async () => {
    const { c, x, filler } = await stale();
    onDay(c, 10);
    await glimpse(c, "sA", x, filler);
    await glimpse(c, "sB", x, filler);
    await rate(c, "sC", x, 2);
    expect(touched(c, x)).toBe(10);
  });

  test("used on its birth day (refused a credit), glimpsed the next: touched = birth", async () => {
    const { c, x, filler } = await stale();
    await rate(c, "sB", x, 3);
    onDay(c, 2);
    await glimpse(c, "sA", x, filler);
    expect(touched(c, x)).toBe(1);
  });

  for (const how of ["rated 3", "drewOn"] as const) {
    test(`${how} on the day the reflection cited it, then a glimpse the next day: the use still counts, through both wakes`, async () => {
      const { c, x, filler } = await stale();
      onDay(c, 10);
      const night = c.reflections.begin({ session: "s-night" });
      if (!night.ok) throw new Error(night.reason);
      const fin = c.reflections.finish({ reflection: night.bundle.reflection, session: "s-night", entry: "A look back.", share: { text: "Did the glaze order get a second supplier?", cites: [x] }, close: [x] });
      if (!fin.ok) throw new Error(fin.reason);
      expect(c.store.returnsOf(x).some((r) => r.source === "reflection" && r.day === 10)).toBe(true);
      if (how === "rated 3") await rate(c, "sB", x, 3);
      else {
        const s = as(c, "sB");
        await s.call("recall", { question: "glaze order second supplier spring", mode: "facts" });
        const d = await s.call("session_end", { session: "sB", memories: [], drewOn: [x] });
        expect(d.structuredContent["drewOn"]).toEqual({ credited: [x] });
      }
      // The use was refused a return of its own (the reflection's counted that day).
      expect(c.store.returnsOf(x).some((r) => r.day === 10 && r.source !== "reflection")).toBe(false);
      expect(c.store.readProse(x).meta["usedDay"]).toBe(10);
      onDay(c, 11);
      await glimpse(c, "sA", x, filler);
      expect(touched(c, x)).toBe(10);
      onDay(c, 30);
      const w = wakes({ counterpart: c } as McpServer);
      for (const text of [w.built, w.assembled]) expect(inStillOpen(text, x)).toBe(true);
      onDay(c, 31);
      const w2 = wakes({ counterpart: c } as McpServer);
      for (const text of [w2.built, w2.assembled]) expect(inStillOpen(text, x)).toBe(false);
    });
  }

  test("OPEN_CARRY_GLIMPSE_TOUCH true (the revert): a glimpse carries it again", async () => {
    expect(SELF_TUNABLES.OPEN_CARRY_GLIMPSE_TOUCH).toBe(false);
    const { c, x, filler } = await stale();
    onDay(c, 30);
    await glimpse(c, "sA", x, filler);
    expect(openCarry(c.store, 30, SELF_TUNABLES.OPEN_CARRY_DAYS).notCarried.has(x)).toBe(true);
    expect(openCarry(c.store, 30, SELF_TUNABLES.OPEN_CARRY_DAYS, true).notCarried.has(x)).toBe(false);
    const T = SELF_TUNABLES as { OPEN_CARRY_GLIMPSE_TOUCH: boolean };
    T.OPEN_CARRY_GLIMPSE_TOUCH = true;
    try {
      // (The wake reads its own copy of the tunables, taken at open; the reflection reads these.)
      const night = c.reflections.begin({ session: "s-night" });
      if (!night.ok) throw new Error(night.reason);
      expect(night.bundle.noLongerCarried).toBeUndefined();
    } finally {
      T.OPEN_CARRY_GLIMPSE_TOUCH = false;
    }
  });
});

describe("re-review of #592 — G2 and the nits", () => {
  test("each leaving is said in exactly one share: an offered share holds its count until it is carried", async () => {
    const s = server("s-writer");
    const c = s.counterpart;
    toDay(s, 1);
    await remember(s, { text: "Open: is the old deploy key still on the build box?", unresolved: true });
    await remember(s, { text: "Open: talk through the chapter numbering later.", unresolved: true });
    toDay(s, 24);
    const cite = await remember(s, { text: "Mike finished the kiln shelf inventory today." });
    const SAY = "2 open items nobody touched in 21 lived days are no longer carried; recall shows them.";
    toDay(s, 25);
    const n1 = c.reflections.begin({ session: "s-night" });
    if (!n1.ok) throw new Error(n1.reason);
    expect(n1.bundle.noLongerCarried).toBe(2);
    const f1 = c.reflections.finish({ reflection: n1.bundle.reflection, session: "s-night", entry: "A look back.", share: { text: SAY, cites: [cite] } });
    if (!f1.ok) throw new Error(f1.reason);
    // Night 2, the first share still only offered: it holds the count, so this one does not say it.
    toDay(s, 26);
    const n2 = c.reflections.begin({ session: "s-night" });
    if (!n2.ok) throw new Error(n2.reason);
    expect(n2.bundle.noLongerCarried).toBeUndefined();
    const f2 = c.reflections.finish({ reflection: n2.bundle.reflection, session: "s-night", entry: "Again.", share: { text: "The kiln shelf inventory is done.", cites: [cite] } });
    if (!f2.ok) throw new Error(f2.reason);
    // Both shares go out, newest first; only the older one carries the count.
    expect(c.reflections.pendingShare({ session: "s-morning" })?.id).toBe(n2.bundle.reflection);
    expect(c.reflections.carryLine({ session: "s-morning", reflection: n2.bundle.reflection })).not.toBe(null);
    expect(c.reflections.pendingShare({ session: "s-morning-2" })?.id).toBe(n1.bundle.reflection);
    toDay(s, 27);
    const n3 = c.reflections.begin({ session: "s-night" });
    if (!n3.ok) throw new Error(n3.reason);
    expect(n3.bundle.noLongerCarried).toBeUndefined();
    // The build stamp (#591) and the not-carried record live side by side on the row.
    const detail = JSON.parse(c.store.reflection(n1.bundle.reflection)?.detail ?? "{}") as Record<string, unknown>;
    expect(detail["notCarried"]).toHaveLength(2);
    expect(typeof detail["build"]).toBe("string");
  });

  test("a core memory flagged open is never a thread here: not counted as no longer carried", async () => {
    const s = server("s-writer");
    const c = s.counterpart;
    toDay(s, 1);
    const core = c.store.put({ type: "memory", kind: "person", body: "Robin keeps the glaze ledger and asks before reordering.", band: "identity", meta: { unresolved: true }, physics: { birthDay: 1, promotedIdentity: true } });
    toDay(s, 25);
    const carry = openCarry(c.store, 25, SELF_TUNABLES.OPEN_CARRY_DAYS);
    expect(carry.touched.has(core)).toBe(false);
    expect(carry.notCarried.has(core)).toBe(false);
    const night = c.reflections.begin({ session: "s-night" });
    if (!night.ok) throw new Error(night.reason);
    expect(night.bundle.noLongerCarried).toBeUndefined();
  });
});
