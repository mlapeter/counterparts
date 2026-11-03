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
import type { NightAnswer } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat, SeatAct, SeatAsk } from "../src/core/counterpart.js";
import { Store, paths } from "../src/core/store/index.js";
import { TOLD_SET_KEY, TOLD_SET_VERSION, TOLD_SOURCE, TOLD_SURFACE_KEY, isTold, toldSet } from "../src/core/told.js";
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
