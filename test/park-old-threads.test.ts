/**
 * P2 — THE NIGHT PARKS OPEN THREADS UNTOUCHED FOR 2+ WEEKS (2026-10-28,
 * roadmap 10-28; Mike: "ok your lean sounds good"; lightly held), through the
 * real doors: `remember` and `session_end` over MCP, the reflection's night
 * through the `reflect` tool, the wake built at the turn-end (`rebrief`) and
 * assembled at SessionStart (`ClaudeCodeAdapter#sessionStart`), `recall
 * "still open"` and a facts question over MCP, a recall by id credited at the
 * Stop hook (`ClaudeCodeAdapter#stop`, the transcript's expansion), `status`
 * and doctor.
 *
 *   - An open item nobody touched for `OPEN_CARRY_DAYS` (14) lived days is
 *     parked: out of the wake's "Still open" and its "(N more open, …)" count,
 *     counted instead on the tail as `· N parked`; not closed (the flag
 *     stands); `recall "still open"` lists it last, `parked: true`; a facts
 *     question still finds it. The night's reflection is told the count once,
 *     as parked, and records which on its row.
 *   - Recalled by id (and so credited at the Stop) it is carried again: back
 *     in the next session's wake.
 *   - A dated item (eventDate) and an item naming what would settle it
 *     (settlesWhen) are never parked.
 *
 * Hermetic: every store is a temp dir made and removed here; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import {
  COLLAPSED_WORDS,
  FRAMING,
  OPEN_TAIL_WORDS,
  PARKED_WORDS,
  SELF_TUNABLES,
  collapsedLane,
  collapsedLine,
  countedLanes,
  moreLine,
  openCarry,
} from "../src/core/self/index.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ZONE = "UTC";
const BUDGET = 9_000;
const D0 = "2026-10-01";
const at = (ymd: string, h: number, m = 0): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR + m * MIN;
/** The parking line, in lived days (P2: 14). */
const K = SELF_TUNABLES.OPEN_CARRY_DAYS;

/** The session that writes, and the sessions that wake later. */
const S = "9a2c0000-0000-4000-8000-000000000001";
const S2 = "9a2c0000-0000-4000-8000-000000000002";
const S3 = "9a2c0000-0000-4000-8000-000000000003";

let root: string;
let storeDir: string;
let config: string;
let HERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-park-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "shed");
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

interface World {
  c: Counterpart;
  set(t: number): void;
  now(): number;
  today(): string;
}

function world(start: number): World {
  let now = start - 15 * HOUR;
  const c = Counterpart.open({ dir: storeDir, budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  c.rebrief({ budgetBytes: BUDGET, at: new Date(now).toISOString().slice(0, 10) });
  now = start;
  return { c, set: (t) => void (now = t), now: () => now, today: () => new Date(now).toISOString().slice(0, 10) };
}

function adapter(w: World): ClaudeCodeAdapter {
  const verdict = { mode: "on", matched: HERE, entry: null } as ScopeVerdict;
  return new ClaudeCodeAdapter({
    counterpart: w.c,
    config: { dataDir: storeDir, injectionBudgetBytes: BUDGET },
    configPath: config,
    now: () => w.now(),
    scope: verdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
}

/** The wake SessionStart delivers to `session` in HERE, now (assembled). */
function sessionStart(w: World, session: string): string {
  return adapter(w).sessionStart({ sessionId: session, scope: HERE, at: w.today(), source: "startup" } as HookInput).injection;
}

/** Both wakes: the turn-end's (built, published) and a session start's (assembled). */
function wakes(w: World, session: string): { built: string; assembled: string } {
  const built = w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
  expect(built.published).toBe(true);
  return { built: w.c.wake(BUDGET).text, assembled: sessionStart(w, session) };
}

function tools(w: World, session = S): McpServer {
  return new McpServer({ counterpart: w.c, session, scope: HERE, now: () => w.now() });
}

function toDay(w: World, n: number): void {
  while (w.c.store.livedDay() < n) {
    w.set(w.now() + DAY);
    w.c.store.advanceClock(w.today());
  }
  expect(w.c.store.livedDay()).toBe(n);
}

const words = new Map<string, string>();

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

const inStillOpen = (text: string, id: string): boolean => {
  const said = words.get(id) ?? id;
  return lane(text, FRAMING.threads).some((l) => l.includes(id) || l.includes(said));
};

type Item = { id: string; title: string; touched: string; parked?: boolean; date?: string; settlesWhen?: string };
async function stillOpen(s: McpServer): Promise<{ items: Item[]; parked: number; total: number; note: string }> {
  const r = (await s.call("recall", { handle: "still open" })).structuredContent;
  return { items: r["items"] as Item[], parked: (r["parked"] as number | undefined) ?? 0, total: r["total"] as number, note: String(r["note"]) };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("P2. an open item untouched for 14 lived days is parked", () => {
  test("parked after a night: out of the wake and its count, counted as parked, listed last by the handle, still found; recalled by id it is back the next session; dated and settlesWhen items never park", async () => {
    expect(K).toBe(14);
    const w = world(at(D0, 9));
    const s = tools(w);
    toDay(w, 1);
    const hose = await remember(s, { text: "Open: did the hose bib on the north shed get its winter cap?", unresolved: true });
    const dated = await remember(s, { text: "Open: ask the co-op about the seed order on the first of March.", unresolved: true, eventDate: "2027-03-01" });
    // One through session_end, naming what would settle it (S1).
    const ended = await s.call("session_end", {
      session: S,
      memories: [{ content: "Open: is the rain barrel overflow still pointed at the bean rows?", unresolved: true, settlesWhen: "the plumber calls back about the downspout" }],
    });
    expect(ended.isError ?? false).toBe(false);
    const settles = w.c.store.list({ type: "memory" }).find((id) => w.c.store.readProse(id).body.includes("rain barrel overflow"));
    if (settles === undefined) throw new Error("the session_end entry did not land");
    words.set(settles, "rain barrel overflow");

    // Day K: 13 lived days untouched — still carried, nothing parked.
    toDay(w, K);
    let carry = openCarry(w.c.store, K, K);
    expect(carry.notCarried.size).toBe(0);
    let both = wakes(w, `s-day-${String(K)}`);
    for (const text of [both.built, both.assembled]) {
      expect(inStillOpen(text, hose)).toBe(true);
      expect(text).not.toContain(PARKED_WORDS);
    }

    // Day 1 + 15: fifteen lived days untouched. Six live items arrive, so the lane overflows and keeps a count line.
    toDay(w, 16);
    const fresh: string[] = [];
    for (let i = 0; i < 6; i += 1) fresh.push(await remember(s, { text: `Open: does bed ${String(i)} want lime before the frost?`, unresolved: true }));

    // THE NIGHT, through the reflect tool: told the count once, as parked; the row records which.
    const night = tools(w, "s-night");
    const begun = await night.call("reflect", { phase: "begin", session: "s-night" });
    expect(begun.isError ?? false).toBe(false);
    const told = JSON.stringify(begun.structuredContent);
    expect(told).toContain(`1 open item nobody touched in ${String(K)} lived days is parked; recall \\"still open\\" lists them.`);
    expect(told).not.toContain("no longer carried; recall shows them");
    const rid = String(begun.structuredContent["reflection"]);
    const fin = await night.call("reflect", { phase: "finish", session: "s-night", reflection: rid, entry: "A quiet look back over the garden threads." });
    expect(JSON.stringify(fin.structuredContent)).not.toContain("refused");
    expect(fin.isError ?? false).toBe(false);
    expect(JSON.parse(w.c.store.reflection(rid)?.detail ?? "{}")["notCarried"]).toEqual([hose]);

    // The next day: the wakes, built and assembled.
    toDay(w, 17);
    carry = openCarry(w.c.store, 17, K);
    expect([...carry.notCarried.keys()]).toEqual([hose]);
    expect(carry.carried).toEqual(expect.arrayContaining([dated, settles, ...fresh]));
    both = wakes(w, "s-day-17");
    for (const text of [both.built, both.assembled]) {
      const lines = lane(text, FRAMING.threads);
      // Gone from the list and from the count…
      expect(inStillOpen(text, hose)).toBe(false);
      expect(text).not.toContain(hose);
      const tail = lines.at(-1) ?? "";
      const counted = countedLanes(tail).threads ?? 0;
      // 6 fresh + the settlesWhen one + the dated one (months off, so not arriving): 8 carried.
      expect(lines.filter((l) => l.startsWith("- ")).length + counted).toBe(8);
      // …and counted as parked instead, after the paren.
      expect(tail).toBe(`(${String(counted)} more open, ${OPEN_TAIL_WORDS}) · 1 ${PARKED_WORDS}`);
    }
    // Not closed: the flag stands.
    expect(w.c.store.readProse(hose).meta["unresolved"]).toBe(true);

    // recall "still open": the carried first, the parked one last and marked.
    const listed = await stillOpen(s);
    expect(listed.total).toBe(9);
    expect(listed.parked).toBe(1);
    expect(listed.items.at(-1)).toMatchObject({ id: hose, parked: true, touched: "16 lived days ago" });
    expect(listed.items.filter((i) => i.parked === true).map((i) => i.id)).toEqual([hose]);
    expect(listed.items.find((i) => i.id === dated)).toMatchObject({ date: "2027-03-01" });
    expect(listed.items.find((i) => i.id === settles)?.settlesWhen).toBe("the plumber calls back about the downspout");
    expect(listed.note).toContain("The last one is parked (parked: true)");
    // A facts question about the thing itself still finds it.
    const found = await s.call("recall", { question: "the hose bib on the north shed and its winter cap", mode: "facts" });
    expect(found.structuredContent["ids"]).toContain(hose);

    // RECALLED BY ID in a session, and used: the Stop credits the expansion — a touch.
    const a = adapter(w);
    a.sessionStart({ sessionId: S2, scope: HERE, at: w.today(), source: "startup" } as HookInput);
    const opened = await tools(w, S2).call("recall", { ids: [hose] });
    expect(opened.isError ?? false).toBe(false);
    expect(JSON.stringify(opened.structuredContent)).toContain("winter cap");
    a.stop({
      sessionId: S2,
      scope: HERE,
      at: w.today(),
      turns: [
        { role: "user", text: "Did we ever cap the hose bib on the north shed?" },
        { role: "assistant", text: "Let me look at that open item." },
        { role: "assistant", text: "It is still open: nobody recorded the winter cap going on. Worth doing before the frost." },
      ],
      expansions: [{ atTurn: 1, ids: [hose] }],
    } as HookInput);
    expect(w.c.store.readProse(hose).meta["usedDay"]).toBe(17);

    // The next session: back in the wake, nothing parked.
    toDay(w, 18);
    const back = sessionStart(w, S3);
    // Touched yesterday, it is the most recently touched: listed, first.
    expect(inStillOpen(back, hose)).toBe(true);
    expect(back).not.toContain(PARKED_WORDS);
    expect(openCarry(w.c.store, 18, K).notCarried.size).toBe(0);
    const again = await stillOpen(s);
    expect(again.parked).toBe(0);
    expect(again.items.map((i) => i.id)).toContain(hose);
    expect(again.items.find((i) => i.id === hose)?.parked).toBeUndefined();

    // A dated item and a settlesWhen item, untouched far past the line, never park.
    toDay(w, 40);
    carry = openCarry(w.c.store, 40, K);
    expect(carry.notCarried.has(dated)).toBe(false);
    expect(carry.notCarried.has(settles)).toBe(false);
    expect(carry.notCarried.has(fresh[0] ?? "")).toBe(true);
    const late = await stillOpen(s);
    expect(late.items.find((i) => i.id === dated)?.parked).toBeUndefined();
    expect(late.items.find((i) => i.id === settles)?.parked).toBeUndefined();
    // And the night still offers the settlesWhen one (S1's door), not the parked ones.
    const night40 = w.c.reflections.begin({ session: "s-night-40" });
    if (!night40.ok) throw new Error(night40.reason);
    const offered = [...night40.bundle.staleOpen.map((x) => x.id), ...(night40.bundle.settlesOpen ?? []).map((x) => x.id)];
    expect(offered).toContain(settles);
    for (const id of fresh) expect(offered).not.toContain(id);
  });

  test("status and doctor count open, carried and parked", async () => {
    const w = world(at(D0, 9));
    const s = tools(w);
    toDay(w, 1);
    await remember(s, { text: "Open: is the ladder hook on the barn wall still loose?", unresolved: true });
    await remember(s, { text: "Open: did the gate latch get oiled?", unresolved: true });
    toDay(w, 1 + K);
    await remember(s, { text: "Open: which week do the garlic cloves go in?", unresolved: true });

    const status = (await s.call("status", {})).structuredContent;
    expect((status["openItems"] as Record<string, unknown>)["parked"]).toBe(2);
    expect((status["openItems"] as Record<string, unknown>)["open"]).toBe(3);

    const read = doctorFindings({
      configPath: config,
      configReason: "loaded",
      config: { dataDir: storeDir },
      dir: storeDir,
      store: w.c.store,
      today: w.today(),
      refusals: {},
    }).find((x) => x.key === "open-items");
    expect(read?.severity).toBe("green");
    expect(read?.title).toBe("Open items");
    expect(read?.detail).toBe(`3 open: 1 carried in Still open, 2 parked (untouched ${String(K)}+ lived days; not closed, and recall "still open" lists them)`);
    expect(read?.data).toMatchObject({ open: 3, carried: 1, parked: 2, days: K });
  });

  test("doctor says nothing with no open item", () => {
    const w = world(at(D0, 9));
    toDay(w, 2);
    const read = doctorFindings({
      configPath: config,
      configReason: "loaded",
      config: { dataDir: storeDir },
      dir: storeDir,
      store: w.c.store,
      today: w.today(),
      refusals: {},
    }).find((x) => x.key === "open-items");
    expect(read).toBeUndefined();
  });

  test("the tail's readers: the count before the paren reads as before; the collapsed line keeps its lane", () => {
    const more = moreLine("threads", ["mem_a", "mem_b", "mem_c"], undefined, 41);
    expect(more).toBe(`(3 more open, ${OPEN_TAIL_WORDS}) · 41 ${PARKED_WORDS}`);
    expect(countedLanes(more).threads).toBe(3);
    expect(moreLine("threads", ["mem_a"], undefined, 0)).toBe(`(1 more open, ${OPEN_TAIL_WORDS})`);
    const collapsed = collapsedLine("threads", ["mem_a", "mem_b"], { threadsParked: 7 });
    expect(collapsed).toContain(COLLAPSED_WORDS);
    expect(collapsed).toEndWith(` · 7 ${PARKED_WORDS}`);
    expect(collapsedLane(collapsed)).toBe("threads");
    expect(countedLanes(collapsed).threads).toBe(2);
    // Another lane never says parked.
    expect(moreLine("hints", ["mem_a"], undefined, 5)).not.toContain(PARKED_WORDS);
  });
});
