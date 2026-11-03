/**
 * STARTER MEMORIES — "told, not lived" (S1, 2026-11-03; `core/told.ts`).
 *
 * Every case goes through a real door: `counterparts install` (and
 * `start-fresh`) creating the store; the Claude Code hook's prompt turn for
 * ambient recall and its footnotes; the `recall` and `remember` tools; and
 * one night through `runNight` with a stubbed claude whose children call the
 * memory's MCP server as a night child does. The hosted signup's half is in
 * `hosted/test/oauth.test.ts`.
 *
 * Hermetic: a fresh temp dir per test, removed after; the home directory is a
 * temp one too. Nothing here can reach a live store.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter, runNight } from "../src/adapters/claude-code/index.js";
import { openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import type { NightAnswer } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat, SeatAct, SeatAsk } from "../src/core/counterpart.js";
import { Store, paths } from "../src/core/store/index.js";
import { Recall } from "../src/core/recall/index.js";
import type { Candidate } from "../src/core/recall/activate.js";
import { gate } from "../src/core/recall/gate.js";
import { freshGateState } from "../src/core/recall/session.js";
import { TUNABLES } from "../src/core/recall/tunables.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { resolveStaticWeights } from "../src/core/embed/static.js";
import { recallTurn } from "../src/core/retrieval.js";
import { hasDayBefore } from "../src/core/self/writer.js";
import { TOLD_SET_KEY, TOLD_SET_VERSION, TOLD_SOURCE, TOLD_SURFACE_KEY, isTold, plantTold, toldSet } from "../src/core/told.js";
import { stripV14 } from "./store-fixture.js";

const ZONE = "America/Denver";
const SCOPE = "/work/garden";
const DAY_MS = 86_400_000;

let root: string;
let cfg: string;
let storeDir: string;
let home: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-told-")));
  cfg = join(root, "cp", "claude-code.json");
  storeDir = join(root, "cp", "store");
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  setSystemTime();
  for (const c of closers.splice(0).reverse()) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function quiet(): Io {
  return { out: () => undefined, err: () => undefined };
}

async function install(...extra: string[]): Promise<void> {
  expect(await run(["install", "--config", cfg, "--no-connect", ...extra], { io: quiet(), env: {}, home })).toBe(EXIT.ok);
}

function withStore<T>(fn: (s: Store) => T): T {
  const s = Store.open({ dir: storeDir });
  try {
    return fn(s);
  } finally {
    s.close();
  }
}

/** The told rows of a store, oldest first. */
function toldRows(s: Store): NonNullable<ReturnType<Store["row"]>>[] {
  return s
    .list({ type: "memory" })
    .map((id) => s.row(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined && r.source === TOLD_SOURCE);
}

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;

// ── the store a new install creates ─────────────────────────────────────────

describe("a new store starts with the set; nothing else ever gets it", () => {
  test("install: exactly the set, marked told, weak, in local words, the version in meta; a re-install adds none; an upgraded older store gets none", async () => {
    await install();
    const set = toldSet("local");
    withStore((s) => {
      const rows = toldRows(s);
      expect(rows.map((r) => r.title).sort()).toEqual(set.map((m) => m.title).sort());
      expect(rows).toHaveLength(11);
      for (const r of rows) {
        expect(r.title?.startsWith("Told: ")).toBe(true);
        expect(r.body.startsWith("Told, not lived: ")).toBe(true);
        expect(JSON.parse(r.meta ?? "{}")).toMatchObject({ told: TOLD_SET_VERSION });
        expect(r.archived).toBe(0);
        expect(r.legacy).toBe(0);
        // Weak: a dreamed gist's start, below anything lived.
        expect(r.claimed ?? 1).toBeLessThanOrEqual(0.3);
        expect(isTold(r)).toBe(true);
      }
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_VERSION);
      expect(s.getMeta(TOLD_SURFACE_KEY)).toBe("local");
      // Local words, never hosted's.
      const all = rows.map((r) => r.body).join("\n");
      expect(all).toContain("`counterparts doctor`");
      expect(all).not.toContain("account page");
      // ROADMAP's 11-03 wording: a reminder saved with its date as a plain one; a pause lasts until resumed.
      expect(all).toContain('"Remind me Thursday to ...": I save it with the date and as a plain reminder, so it comes up that day, or the next time we talk.');
      expect(all).toContain("pause it until they say to resume");
      expect(all).not.toContain("for a while");
      // Never the self: no core, no page.
      expect(rows.every((r) => r.promoted_identity === 0 && r.band !== "identity")).toBe(true);
    });
    // A re-install over the store it made adds nothing.
    await install("--force");
    withStore((s) => expect(toldRows(s)).toHaveLength(11));

    // An OLDER store (a v13 file with one lived memory), upgraded by install: nothing told.
    rmSync(join(root, "cp"), { recursive: true, force: true });
    const old = Store.open({ dir: storeDir });
    old.put({ type: "memory", kind: "fact", body: "A memory from before the starter set." });
    old.close();
    const db = new Database(paths.operational(storeDir));
    stripV14(db);
    db.run("UPDATE meta SET value = '13' WHERE key = 'schemaVersion'");
    db.close();
    await install();
    withStore((s) => {
      expect(Number(s.getMeta("schemaVersion"))).toBeGreaterThan(13);
      expect(toldRows(s)).toHaveLength(0);
      expect(s.getMeta(TOLD_SET_KEY)).toBeUndefined();
      expect(s.countMemories({ archived: false })).toBe(1);
    });
  });

  test("start-fresh is a new store: its blank store starts with the set; the parked one is as it was", async () => {
    await install();
    withStore((s) => s.put({ type: "memory", kind: "fact", body: "Lived before starting fresh." }));
    expect(await run(["start-fresh", "--config", cfg, "--yes", "--nothing-is-open"], { io: quiet(), env: {}, home })).toBe(EXIT.ok);
    withStore((s) => {
      expect(toldRows(s)).toHaveLength(11);
      expect(s.countMemories({ archived: false })).toBe(11);
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_VERSION);
    });
  });
});

describe("planting is all or nothing, and never twice", () => {
  test("the set lands in one write, and a second plant adds nothing", () => {
    const s = Store.open({ dir: storeDir });
    try {
      let puts = 0;
      s.guardWrites((site) => {
        if (site === "put" || site === "putMany") puts += 1;
      });
      expect(plantTold(s, "local")).toHaveLength(11);
      // One write for all eleven: a crash leaves the whole set or none of it.
      expect(puts).toBe(1);
      s.guardWrites(null);
      expect(plantTold(s, "local")).toEqual([]);
      expect(s.toldIds()).toHaveLength(11);
    } finally {
      s.close();
    }
  });

  test("a set without its meta (a crash between the two writes) is not planted again", () => {
    const s = Store.open({ dir: storeDir });
    try {
      s.put({ type: "memory", kind: "fact", title: "Told: x", body: "Told, not lived: x", source: TOLD_SOURCE });
      expect(s.getMeta(TOLD_SET_KEY)).toBeUndefined();
      expect(plantTold(s, "local")).toEqual([]);
      expect(s.toldIds()).toHaveLength(1);
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_VERSION);
      expect(plantTold(s, "local")).toEqual([]);
    } finally {
      s.close();
    }
  });
});

describe("counts and asks that read lived memories leave the set out", () => {
  test("the night's tag ask is never handed one, and the set is no day before", async () => {
    await install();
    withStore((s) => {
      // A fresh store: eleven rows, none of them the night's to tag.
      expect(s.untaggedMemories(50)).toEqual({ memories: [], total: 0 });
      // Nor is the set a day before: day's end on a store holding only it is young.
      expect(hasDayBefore(s, "2999-01-01")).toBe(false);
      const lived = s.put({ type: "memory", kind: "fact", body: "The broad beans went in by the fence." });
      expect(s.untaggedMemories(50).memories.map((m) => m.id)).toEqual([lived]);
      expect(s.countMemories({ archived: false, notSource: TOLD_SOURCE })).toBe(1);
      expect(hasDayBefore(s, "2999-01-01")).toBe(true);
    });
  });
});

// ── the counts a person reads ───────────────────────────────────────────────

function said(): { io: Io; out: string[] } {
  const out: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => out.push(l) }, out };
}

describe("day one never claims memories nobody made (ROADMAP, 11-03)", () => {
  test("status, doctor, the dashboard and uninstall say the lived memories and the starter notes apart", async () => {
    await install();
    const status = said();
    expect(await run(["status", "--dir", storeDir], { io: status.io, env: {}, home })).toBe(EXIT.ok);
    const text = status.out.join("\n");
    expect(text).toContain("Memories: 0 · 11 starter notes");
    expect(text).toMatch(/Today \(\d{4}-\d{2}-\d{2}\): 0 new/);

    const doctor = said();
    await run(["doctor", "--config", cfg], { io: doctor.io, env: {}, home });
    const read = doctor.out.join("\n");
    expect(read).toContain("— 0 memories · 11 starter notes");
    expect(read).toContain("11 starter notes not searchable by meaning yet");

    const dash = Dashboard.open({ dir: storeDir });
    try {
      const overview = JSON.parse(router(new URL("http://127.0.0.1:4747/api/overview"), "127.0.0.1:4747", dash.source).body) as { hero: { headline: string; memories: number; newToday: number } };
      expect(overview.hero.headline).toContain("0 memories · 11 starter notes");
      expect(overview.hero.newToday).toBe(0);
      const memories = JSON.parse(router(new URL("http://127.0.0.1:4747/api/memories"), "127.0.0.1:4747", dash.source).body) as { total: number; starter: number };
      expect([memories.total, memories.starter]).toEqual([0, 11]);
    } finally {
      dash.close();
    }

    const leaving = said();
    await run(["uninstall", "--config", cfg, "--keep-memories", "--yes"], { io: leaving.io, env: {}, home });
    expect(leaving.out.join("\n")).toContain("11 memories (11 of them starter notes) are still at");
  });

  test("with lived memories beside the set, and seeds revised both ways: every count says the lived ones, and the wake's opening line too", async () => {
    await install();
    const a = adapter(storeDir);
    const store = a.counterpart.store;
    const session = "s-counts-0001";
    const mcp = new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: join(root, "registry") });
    for (const text of LIVED.slice(9, 11)) expect((await mcp.call("remember", { session, text })).isError).not.toBe(true);
    const byTitle = (t: string): string => store.toldIds().find((id) => store.row(id)?.title === t) as string;
    // One seed corrected (it leaves), one changed (both were true at their time).
    expect((await mcp.call("remember", { session, text: "I used to think status counted only memories; it counts memories and recent activity, and doctor checks everything.", updates: byTitle("Told: checking that memory works"), how: "corrected" })).isError).not.toBe(true);
    expect((await mcp.call("remember", { session, text: "I used to think export only made an encrypted copy; it can also write plaintext with --plaintext, said out loud.", updates: byTitle("Told: taking the memory with them"), how: "changed" })).isError).not.toBe(true);
    const lived = store.countMemories({ type: "memory", archived: false, notSource: TOLD_SOURCE });
    const told = store.countMemories({ type: "memory", archived: false, source: TOLD_SOURCE });
    expect(lived).toBe(4);
    const pair = `${lived} memories · ${told} starter notes`;

    const status = said();
    expect(await run(["status", "--dir", storeDir], { io: status.io, env: {}, home })).toBe(EXIT.ok);
    expect(status.out.join("\n")).toContain(`Memories: ${lived} · ${told} starter notes`);
    // "New today" never counts a seed (its day is the runner's zone's, so only the bound is pinned).
    const newToday = Number(/Today \(\d{4}-\d{2}-\d{2}\): (\d+) new/.exec(status.out.join("\n"))?.[1] ?? "-1");
    expect(newToday).toBeGreaterThanOrEqual(0);
    expect(newToday).toBeLessThanOrEqual(lived);

    const doctor = said();
    await run(["doctor", "--config", cfg], { io: doctor.io, env: {}, home });
    expect(doctor.out.join("\n")).toContain(`— ${pair}`);

    const dash = Dashboard.open({ dir: storeDir });
    try {
      const overview = JSON.parse(router(new URL("http://127.0.0.1:4747/api/overview"), "127.0.0.1:4747", dash.source).body) as { hero: { headline: string; newToday: number } };
      expect(overview.hero.headline).toContain(pair);
      expect(overview.hero.newToday).toBeLessThanOrEqual(lived);
    } finally {
      dash.close();
    }

    // The wake's opening line: the lived memories are the number.
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: 9_000 });
    const woke = a.sessionStart(toHookInput({ session_id: "s-wake-0001", hook_event_name: "SessionStart", cwd: SCOPE, source: "startup" }, { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: storeDir }));
    expect(woke.injection).toContain(`· ${pair}`);
  });

  test("a fresh store's wake opens on no memories and the starter notes", async () => {
    await install();
    const a = adapter(storeDir);
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: 9_000 });
    const woke = a.sessionStart(toHookInput({ session_id: "s-wake-0002", hook_event_name: "SessionStart", cwd: SCOPE, source: "startup" }, { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: storeDir }));
    expect(woke.injection).toContain("· 0 memories · 11 starter notes");
  });

  test("init makes a bare store, with no starter notes; install sets up yours — and help says so", async () => {
    const bare = join(root, "bare");
    expect(await run(["init", "--dir", bare], { io: quiet(), env: {}, home })).toBe(EXIT.ok);
    const s = Store.open({ dir: bare });
    try {
      expect(toldRows(s)).toHaveLength(0);
    } finally {
      s.close();
    }
    const help = said();
    await run(["help", "init"], { io: help.io, env: {}, home });
    expect(help.out.join("\n")).toContain("init makes a bare store, with no starter notes; install sets up yours.");
  });
});

// ── ranking: lived first ────────────────────────────────────────────────────

/** Twenty-five lived memories, nine of them close to what the starter set is about. */
const LIVED = [
  "Mike turned the memory off for the scratch folder while he tested the parser.",
  "The garden folder memory was paused during the tax week, then turned back on.",
  "We checked the night pass: the dream ran after a long day and the reflection was short.",
  "Mike asked where we left off in the last session and we picked up the fence plan.",
  "A reminder for Thursday: order more compost before the frost.",
  "Mike said that's wrong about the hose length; it is thirty metres, not twenty.",
  "The memory fades what isn't used; Mike was fine with forgetting the old bed layout.",
  "Mike exported a copy of the memory before moving to the new laptop.",
  "We ran doctor when the footnotes stopped; the wake came back after a restart.",
  "The broad beans went in by the fence, netted against the pigeons.",
  "The tomato seedlings need potting on into bigger pots next week.",
  "Mira lent us her long-handled loppers for the hedge.",
  "The water butt overflows in heavy rain; a diverter would fix it.",
  "Mike prefers short answers in the morning and longer ones at night.",
  "The shed roof felt is torn on the north corner.",
  "The leeks are ready to lift once the soil dries out.",
  "Compost bin two is the one that runs hot; turn it weekly.",
  "The pond pump hums when the filter clogs with leaves.",
  "The gooseberries were sour this year after the late frost.",
  "We built a cold frame from the old window panes.",
  "The raspberry canes need cutting back to the ground in February.",
  "Mike's daughter planted sunflowers along the south wall.",
  "The hose reel jams unless it is wound slowly.",
  "The blackbird nests in the ivy above the gate every spring.",
  "The allotment committee meets on the first Monday of the month.",
];

/** Turns about the memory itself, where the starter set competes with lived memories. */
const TURNS = [
  "how do I turn the memory off for a folder, or pause it?",
  "where did we leave off last session?",
  "did the night pass run, and what did the dream and reflection say?",
  "that's wrong, can you correct the memory about the hose?",
  "remind me Thursday about the compost order",
  "how does the memory fade and forget things it isn't using?",
  "can I export a copy of the memory and take it with me?",
  "the footnotes stopped and the wake is gone, should I run doctor?",
  "what do you remember about the fence and the pigeons?",
];

type Adapter = ReturnType<typeof openAdapter>;

function adapter(dir: string): Adapter {
  const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  return a;
}

async function liveIn(a: Adapter, dir: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const session = "s-lived-0001";
  const s = new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: join(dir, "..", "registry") });
  for (const text of LIVED) {
    const r = await s.call("remember", { session, text });
    expect(r.isError).not.toBe(true);
  }
  for (const id of a.counterpart.store.sessionMemoryIds(session)) ids.set(id, a.counterpart.store.readProse(id).body);
  return ids;
}

function prompt(a: Adapter, dir: string, session: string, text: string): ReturnType<Adapter["userPromptSubmit"]> {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
  );
  return a.userPromptSubmit(input);
}

describe("weaker than anything lived — ambient recall and its footnotes", () => {
  test("on a ~25-memory store, the set never takes a lived match's place, never the loud slot, and comes after every lived footnote; a turn about it still finds it", async () => {
    await install();
    const seeded = adapter(storeDir);
    const seededLived = await liveIn(seeded, storeDir);
    // The same lived memories in a store without the set: what a lived memory would get anyway.
    const plainDir = join(root, "plain", "store");
    const plain = adapter(plainDir);
    const plainLived = await liveIn(plain, plainDir);
    const bodyOf = (m: Map<string, string>, id: string): string => m.get(id) ?? "";
    let toldShown = 0;
    for (const [i, text] of TURNS.entries()) {
      // A new session per turn: nothing deduplicated, nothing echoed.
      const session = `s-turn-${String(i).padStart(4, "0")}`;
      const withSet = await prompt(seeded, storeDir, session, text);
      const without = await prompt(plain, plainDir, session, text);
      const told = new Set(seeded.counterpart.store.toldIds());
      const shownLived = [...withSet.surfaced, ...withSet.footnotes].filter((id) => !told.has(id)).map((id) => bodyOf(seededLived, id)).sort();
      const shownPlain = [...without.surfaced, ...without.footnotes].map((id) => bodyOf(plainLived, id)).sort();
      // Every lived memory a store without the set shows, this one shows too.
      expect({ text, missing: shownPlain.filter((b) => !shownLived.includes(b)) }).toEqual({ text, missing: [] });
      // Never loud.
      expect({ text, loud: withSet.surfaced.filter((id) => told.has(id)) }).toEqual({ text, loud: [] });
      // After every lived footnote.
      const firstTold = withSet.footnotes.findIndex((id) => told.has(id));
      if (firstTold >= 0) {
        toldShown += 1;
        expect({ text, livedAfterTold: withSet.footnotes.slice(firstTold).filter((id) => !told.has(id) && seededLived.has(id)) }).toEqual({ text, livedAfterTold: [] });
      }
    }
    // The set does come up in turns about it.
    expect(toldShown).toBeGreaterThan(0);

    // "How do I turn off this folder?" — the folder memory, by its title, in the footnotes.
    const folder = seeded.counterpart.store.toldIds().find((id) => seeded.counterpart.store.row(id)?.title === "Told: turning memory on or off for a folder") as string;
    const asked = await prompt(seeded, storeDir, "s-folder-0001", "how do I turn off this folder?");
    expect(asked.footnotes).toContain(folder);
    // Its footnote line shows the whole title, the part after "Told:" with it.
    expect(asked.injection).toContain("Told: turning memory on or off for a folder");
  });

  test("cold start ends on lived memories only: five lived beside the set is still cold start, and no seed takes a lived match's place", async () => {
    await install();
    const seeded = adapter(storeDir);
    // The first five lived memories, four of them about what the set covers.
    const session = "s-lived-0005";
    const s = new McpServer({ counterpart: seeded.counterpart, session, scope: SCOPE, registryDir: join(root, "registry") });
    for (const text of LIVED.slice(0, 5)) expect((await s.call("remember", { session, text })).isError).not.toBe(true);
    const store = seeded.counterpart.store;
    expect(store.countMemories({ archived: false })).toBe(16);
    const told = new Set(store.toldIds());
    let gated = 0;
    let toldShown = 0;
    for (const [i, text] of TURNS.entries()) {
      // The regime, through the recall the hook runs: cold start at five
      // lived, though the store holds sixteen rows (before the S1 review it
      // left cold start at four).
      const d = recallTurn(new Recall({ store }), { sessionId: `s-regime-${String(i).padStart(4, "0")}`, text }, {}).decision;
      if (d.candidates > 0) {
        gated += 1;
        expect({ text, regime: d.background.regime }).toEqual({ text, regime: "absolute-cold-start" });
      }
      // No lived candidate lost to a seed: none capped or inhibited while a
      // seed was admitted (the cut, too, ranks lived first), and a seed never loud.
      const toldKept = d.verdicts.filter((v) => told.has(v.id));
      const toldAdmitted = toldKept.filter((v) => v.verdict === "footnoted" || v.verdict === "surfaced");
      if (toldAdmitted.length > 0) expect({ text, livedLost: d.verdicts.filter((v) => !told.has(v.id) && (v.verdict === "capped" || v.verdict === "inhibited")).map((v) => v.id) }).toEqual({ text, livedLost: [] });
      expect({ text, loud: toldKept.filter((v) => v.verdict === "surfaced").map((v) => v.id) }).toEqual({ text, loud: [] });
      // And through the hook: a seed's footnote comes after every lived one.
      const withSet = await prompt(seeded, storeDir, `s-cold-${String(i).padStart(4, "0")}`, text);
      const firstTold = withSet.footnotes.findIndex((id) => told.has(id));
      if (firstTold >= 0) {
        toldShown += 1;
        expect({ text, livedAfterTold: withSet.footnotes.slice(firstTold).filter((id) => !told.has(id)) }).toEqual({ text, livedAfterTold: [] });
      }
      expect({ text, loud: withSet.surfaced.filter((id) => told.has(id)) }).toEqual({ text, loud: [] });
    }
    expect(gated).toBeGreaterThan(0);
    expect(toldShown).toBeGreaterThan(0);
  });

  test("the recall tool (facts) orders a lived memory of comparable match first, and still answers with the set", async () => {
    await install();
    const a = adapter(storeDir);
    await liveIn(a, storeDir);
    const s = new McpServer({ counterpart: a.counterpart, session: "s-ask-0001", scope: SCOPE, registryDir: join(root, "registry") });
    const told = new Set(a.counterpart.store.toldIds());
    const got = sc(await s.call("recall", { question: "turn the memory off for a folder", mode: "facts" }));
    // The answer's numbered lines, in order: "1. <title> · mem_… · words".
    const ids = [...String(got["answer"]).matchAll(/^\d+\. .* · (mem_[0-9a-f]+) · /gm)].map((m) => m[1] as string);
    expect(ids.length).toBeGreaterThan(1);
    const firstTold = ids.findIndex((id) => told.has(id));
    expect(firstTold).toBeGreaterThan(0);
    expect(told.has(ids[0] as string)).toBe(false);
  });
});

// ── a lived match found by meaning alone (the single-binary smoke, 2026-11-03) ──

const WEIGHTS = resolveStaticWeights({ env: {} });

/**
 * The smoke's own steps, through the real table: a fresh install (the set
 * planted), one lived note, then a question sharing no content word with it.
 * Before the fix the seeds that shared a question word ("own") set
 * facts mode's weak bar, and the lived note — reached by meaning only — was cut
 * as a weak match (`mcp/facts.ts`, the weak tail).
 */
describe.skipIf(WEIGHTS === null)("a seed never pushes out a lived match found by meaning alone (real table)", () => {
  const CASES = [
    { note: "The espresso machine in the kitchen is a Rancilio Silvia.", question: "which coffee maker do we own?" },
  ];

  async function asked(seeded: boolean, note: string, question: string): Promise<{ lived: string; facts: Record<string, unknown>; meaning: Record<string, unknown>; told: number }> {
    const dir = seeded ? storeDir : join(root, "plain", "store");
    if (seeded) await install();
    const emb = openStaticEmbedder({ env: {} });
    const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: emb });
    closers.push(a.counterpart);
    const session = "s-smoke-0001";
    const s = new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: join(dir, "..", "registry"), embedder: emb });
    expect((await s.call("remember", { session, text: note })).isError).not.toBe(true);
    const [lived] = a.counterpart.store.sessionMemoryIds(session);
    const facts = sc(await s.call("recall", { question, mode: "facts" }));
    const meaning = sc(await s.call("recall", { question, mode: "meaning" }));
    return { lived: lived as string, facts, meaning, told: a.counterpart.store.toldIds().length };
  }

  for (const { note, question } of CASES) {
    test(`facts and meaning mode: "${question}" finds the lived note beside the set, as it does without it`, async () => {
      // No content word in common: what finds it is the meaning.
      const words = (t: string): Set<string> => new Set(t.toLowerCase().match(/[a-z]+/g) ?? []);
      const shared = [...words(question)].filter((w) => words(note).has(w));
      expect(shared.filter((w) => !["the", "in", "is", "a", "we", "do", "with", "which", "what"].includes(w))).toEqual([]);

      const plain = await asked(false, note, question);
      expect(plain.told).toBe(0);
      expect(plain.facts["semantic"]).toBe("in-line");
      expect(plain.facts["ids"]).toContain(plain.lived);

      const seeded = await asked(true, note, question);
      expect(seeded.told).toBe(11);
      expect(seeded.facts["semantic"]).toBe("in-line");
      expect({ question, facts: seeded.facts["ids"] }).toEqual({ question, facts: expect.arrayContaining([seeded.lived]) });
      // Meaning mode leaves the set out altogether, so the lived note is there.
      expect({ question, meaning: seeded.meaning["ids"] }).toEqual({ question, meaning: expect.arrayContaining([seeded.lived]) });
    });
  }
});

// ── counts that drive the gate are lived only (S1 fix, ROADMAP 11-03) ─────────

/** A young store's lived memories: five, a kettle among them that the next turn reaches by meaning only. */
const LIVED_FIVE = [
  "The espresso machine in the kitchen is a Rancilio Silvia.",
  "The kettle in the studio is a Fellow Stagg.",
  "Our dog Juniper is scared of thunderstorms.",
  "The garden fence on the north side needs new posts.",
  "Dana prefers tea over coffee in the afternoon.",
];

describe.skipIf(WEIGHTS === null)("the footnote floor reads lived memories (real table, through the hook)", () => {
  test("five lived beside the set: a memory reached by meaning alone is footnoted, as it is in a store without the set", async () => {
    const world = async (seeded: boolean): Promise<{ a: Adapter; dir: string; told: Set<string> }> => {
      const dir = seeded ? storeDir : join(root, "plain", "store");
      if (seeded) await install();
      const emb = openStaticEmbedder({ env: {} });
      const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: emb });
      closers.push(a.counterpart);
      const session = "s-lived-0005";
      const s = new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: join(dir, "..", "registry"), embedder: emb });
      for (const text of LIVED_FIVE) expect((await s.call("remember", { session, text })).isError).not.toBe(true);
      return { a, dir, told: new Set(a.counterpart.store.toldIds()) };
    };
    const seeded = await world(true);
    const plain = await world(false);
    expect(seeded.told.size).toBe(11);
    const bodies = (w: { a: Adapter; told: Set<string> }, ids: readonly string[]): string[] =>
      ids.filter((id) => !w.told.has(id)).map((id) => w.a.counterpart.store.readProse(id).body);
    for (const [i, text] of ["what do we boil water with?", "which coffee maker do we own?"].entries()) {
      const session = `s-floor-${String(i).padStart(4, "0")}`;
      const withSet = await prompt(seeded.a, seeded.dir, session, text);
      const without = await prompt(plain.a, plain.dir, session, text);
      const shown = bodies(seeded, [...withSet.surfaced, ...withSet.footnotes]);
      const shownPlain = bodies(plain, [...without.surfaced, ...without.footnotes]);
      // The kettle is the lived memory meaning alone reaches; the twin footnotes it.
      expect(shownPlain).toContain("The kettle in the studio is a Fellow Stagg.");
      expect({ text, missing: shownPlain.filter((b) => !shown.includes(b)) }).toEqual({ text, missing: [] });
    }
  });
});

/** A hand-built lived candidate (the gate's own unit; `head-stands-in-bar.test.ts`'s shape). */
function lived(id: string, activation: number): Candidate {
  return {
    id,
    kind: "fact",
    doc: { id, type: "memory", body: `lived note ${id}` } as Candidate["doc"],
    physics: { salience: { relevance: 0.5, emotional: 0, predictive: 0.5 } } as unknown as MemoryPhysics,
    strength: 1,
    sal: 0.5,
    mood: 0,
    cue: activation,
    temporal: 0,
    semantic: 0,
    arrival: 0,
    hops: 0,
    activation,
    cueFraction: 1,
    matched: 1,
    trains: true,
    maxTier: "surfaced",
  };
}

describe("the gate's other store counts read lived memories", () => {
  const verdict = (candidates: Candidate[], storeSize: number, livedSize?: number) =>
    gate(
      { candidates, state: freshGateState("s-gate"), storeSize, ...(livedSize === undefined ? {} : { livedSize }), affectStated: false, turn: 1 },
      TUNABLES,
    ).verdicts.find((v) => v.id === candidates[0]?.id);

  test("the loud tier's strong floor: five lived beside the set face the five-memory floor", () => {
    // 4.5 units: 4.94 at five memories, 9.63 at sixteen. A lived match at 6 is loud in a five-memory store.
    const twin = verdict([lived("m1", 6)], 5);
    expect(twin?.verdict).toBe("surfaced");
    const seeded = verdict([lived("m1", 6)], 16, 5);
    expect({ verdict: seeded?.verdict, loudBlockedBy: seeded?.loudBlockedBy }).toEqual({ verdict: twin?.verdict, loudBlockedBy: twin?.loudBlockedBy });
  });

  test("the one-memory loud cap: one lived note beside the set is a one-memory store, never loud on arrival", () => {
    const twin = verdict([lived("m1", 20)], 1);
    expect(twin).toMatchObject({ verdict: "footnoted", loudBlockedBy: "cold-start-undiscriminating" });
    const seeded = verdict([lived("m1", 20)], 12, 1);
    expect({ verdict: seeded?.verdict, loudBlockedBy: seeded?.loudBlockedBy }).toEqual({ verdict: twin?.verdict, loudBlockedBy: twin?.loudBlockedBy });
  });
});

describe("facts mode: every lived match first, then the seeds (ROADMAP 11-03, `core/told.ts`)", () => {
  test("on a ~25-memory store, no seed is ever ordered above a lived match, whatever the scores", async () => {
    await install();
    const a = adapter(storeDir);
    await liveIn(a, storeDir);
    const s = new McpServer({ counterpart: a.counterpart, session: "s-order-0001", scope: SCOPE, registryDir: join(root, "registry") });
    const told = new Set(a.counterpart.store.toldIds());
    let mixed = 0;
    for (const question of TURNS) {
      const got = sc(await s.call("recall", { question, mode: "facts" }));
      const ids = [...String(got["answer"]).matchAll(/^\d+\. .* · (mem_[0-9a-f]+) · /gm)].map((m) => m[1] as string);
      const firstTold = ids.findIndex((id) => told.has(id));
      if (firstTold < 0) continue;
      if (ids.some((id) => !told.has(id))) mixed += 1;
      expect({ question, livedAfterASeed: ids.slice(firstTold).filter((id) => !told.has(id)) }).toEqual({ question, livedAfterASeed: [] });
    }
    expect(mixed).toBeGreaterThan(0);
  });

  test("a young store: \"how do I turn off this folder?\" still gets its seed, after the lived matches", async () => {
    await install();
    const a = adapter(storeDir);
    const session = "s-young-0001";
    const s = new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: join(root, "registry") });
    // Three lived memories, one sharing only the word "folder" with the question: the seed matches it far better.
    const young = ["Dana keeps the seed catalogues in a blue folder in the shed.", LIVED[10] as string, LIVED[12] as string];
    for (const text of young) expect((await s.call("remember", { session, text })).isError).not.toBe(true);
    const store = a.counterpart.store;
    const folder = store.toldIds().find((id) => store.row(id)?.title === "Told: turning memory on or off for a folder") as string;
    const got = sc(await s.call("recall", { question: "how do I turn off this folder?", mode: "facts" }));
    const ids = [...String(got["answer"]).matchAll(/^\d+\. .* · (mem_[0-9a-f]+) · /gm)].map((m) => m[1] as string);
    const told = new Set(store.toldIds());
    const catalogues = store.sessionMemoryIds(session).find((id) => store.readProse(id).body.startsWith("Dana keeps")) as string;
    // The seed answers, and the lived match comes first however weakly it matched.
    expect(ids).toContain(folder);
    expect(ids).toContain(catalogues);
    expect(ids.indexOf(catalogues)).toBeLessThan(ids.indexOf(folder));
    expect(ids.slice(ids.indexOf(folder)).filter((id) => !told.has(id))).toEqual([]);
  });
});

// ── correcting one ──────────────────────────────────────────────────────────

describe("a starter memory can be corrected like any memory", () => {
  test("remember with updates and how: corrected archives it and the correction stands, lived", async () => {
    await install();
    const a = adapter(storeDir);
    const store = a.counterpart.store;
    const target = store.toldIds().find((id) => store.row(id)?.title === "Told: checking that memory works") as string;
    const session = "s-correct-0001";
    const s = new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: join(root, "registry") });
    const r = await s.call("remember", {
      session,
      text: "I used to think counterparts status counts memories and recent activity; on this machine counterparts doctor checks everything and says what to fix, and status counts memories and recent activity — Mike runs doctor first.",
      updates: target,
      how: "corrected",
    });
    expect(r.isError).not.toBe(true);
    expect(store.row(target)?.archived).toBe(1);
    const mine = store.sessionMemoryIds(session).map((id) => store.row(id));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.source).toBe("authored");
    expect(isTold(mine[0])).toBe(false);
  });
});

// ── the night ───────────────────────────────────────────────────────────────

type Act = (ask: SeatAsk, s: McpServer, c: Counterpart) => Promise<void>;

describe("one night on a seeded store keeps the set out of the self", () => {
  test("day's end, the dream and the reflection are never handed one, can't cite or change one, and no starter words reach the page, its claims, the core, beliefs or cards", async () => {
    // The store and its set are born yesterday, the same day as the lived memories.
    const yesterday = Date.now() - DAY_MS;
    setSystemTime(new Date(yesterday));
    await install("--name", "Mike");
    const open = (): Counterpart => Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), timeZone: ZONE });
    const c0 = open();
    const told = c0.store.toldIds();
    expect(told).toHaveLength(11);
    const day = c0.store.livedDay();
    const lived: string[] = [];
    for (const body of LIVED.slice(9, 13)) lived.push(c0.store.put({ type: "memory", kind: "fact", body, about: "us", salience: { relevance: 0.5, emotional: 0.3, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } }));
    c0.close();
    setSystemTime();

    const toldWords = toldSet("local").map((m) => m.body.slice("Told, not lived: ".length, "Told, not lived: ".length + 40));
    const saysTold = (x: unknown): boolean => {
      const text = JSON.stringify(x ?? null);
      return told.some((id) => text.includes(id)) || toldWords.some((w) => text.includes(w)) || text.includes("Told:");
    };
    const handed: Record<string, unknown> = {};
    const refusals: Record<string, unknown> = {};
    const SESSION = "s-night-0001";
    const acts: Partial<Record<SeatAct, Act>> = {
      writer: async (_ask, s) => {
        const r = await s.call("dream", { phase: "writer", session: SESSION });
        handed["writer"] = sc(r);
        const asked = await s.call("recall", { question: "turn the memory off for a folder, doctor, export", mode: "facts" });
        handed["writer-recall"] = sc(asked);
        const body = ["## Core", "", "I keep what something meant.", "", "## Lately", "", "Lately the broad beans and the pigeons.", "", "## How I work", "", "I test through the real doors."].join("\n");
        const w = sc(await s.call("self_page", { body, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"], claims: [{ text: "Lately the broad beans and the pigeons.", cites: [lived[0], told[0]] }] }));
        refusals["page"] = w["refusedCites"];
      },
      dream: async (_ask, s) => {
        const began = await s.call("dream", { phase: "begin", session: SESSION });
        handed["dream"] = sc(began);
        const dream = String(sc(began)["dream"]);
        const p = sc(
          await s.call("dream", {
            phase: "propose",
            session: SESSION,
            dream,
            changes: [
              { action: "gist", sources: [told[0], told[1]], text: "Memory works by meaning, and folders can be turned off.", why: "a pattern" },
              { action: "merge", ids: [told[2], told[3]], text: "Both about memory.", why: "one thing" },
              { action: "nominate-core", id: told[5], why: "who I am" },
            ],
          }),
        );
        refusals["dream"] = p;
        await s.call("dream", { phase: "journal", session: SESSION, dream, title: "A night", text: "A short dream about beans." });
      },
      reflection: async (_ask, s) => {
        const began = await s.call("reflect", { phase: "begin", session: SESSION });
        handed["reflection"] = sc(began);
      },
    };
    const seat: Seat<NightAnswer> = {
      name: "test",
      async answer(ask) {
        const act = acts[ask.act];
        if (act !== undefined) {
          const c = open();
          try {
            const s = new McpServer({ counterpart: c, session: ask.session, scope: ask.scope, registryDir: join(root, "registry"), env: { COUNTERPARTS_NIGHT_CHILD: ask.act, COUNTERPARTS_NIGHT_RUN: ask.run } });
            await act(ask, s, c);
          } finally {
            c.close();
          }
        }
        return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
      },
    };
    await runNight({ open, config: { dataDir: storeDir }, run: "nrn_told", session: SESSION, scope: SCOPE, kind: { kind: "night" }, seat });

    // Each part of the night ran, and was handed lived memories and none of the set.
    for (const part of ["writer", "dream", "reflection"]) {
      expect({ part, ran: handed[part] !== undefined }).toEqual({ part, ran: true });
      expect({ part, told: saysTold(handed[part]) }).toEqual({ part, told: false });
    }
    expect(JSON.stringify(handed["dream"])).toContain("broad beans");
    // The night's own recall doesn't open one either.
    expect(saysTold(handed["writer-recall"])).toBe(false);
    // The page can't rest on one; the dream can't change, gist or nominate one.
    expect(refusals["page"]).toEqual([told[0]]);
    const proposed = refusals["dream"] as { landed?: Record<string, unknown>; refused?: { reason: string }[] };
    expect(proposed.refused?.map((x) => x.reason)).toEqual(["not-shown-or-gone", "not-shown-or-gone", "not-shown-or-gone"]);
    expect(Object.keys(proposed.landed ?? {})).toHaveLength(0);

    const c = open();
    try {
      const store = c.store;
      // Every starter memory is as it was: live, unmerged, not core.
      for (const id of told) {
        const r = store.row(id);
        expect(r?.archived).toBe(0);
        expect(r?.promoted_identity).toBe(0);
      }
      // No starter words on the page, its claims, the core, beliefs or cards.
      const page = c.selfPage();
      expect(saysTold(page?.body ?? "")).toBe(false);
      expect(saysTold(page?.trace ?? null)).toBe(false);
      const schemaRows = store.list({ type: "schema" }).map((id) => store.row(id));
      expect(saysTold(schemaRows.map((r) => [r?.title, r?.body, r?.meta]))).toBe(false);
      const core = store.list({ type: "memory" }).map((id) => store.row(id)).filter((r) => r?.promoted_identity === 1);
      expect(core.some((r) => isTold(r))).toBe(false);
      // No memory the night wrote (a gist, a merge, a reflection) carries starter words.
      const nightRows = store.list({ type: "memory" }).map((id) => store.row(id)).filter((r) => r !== undefined && (r.source === "dreamed" || r.source === "reflection"));
      expect(saysTold(nightRows.map((r) => [r?.title, r?.body, r?.meta]))).toBe(false);
    } finally {
      c.close();
    }
  });
});
