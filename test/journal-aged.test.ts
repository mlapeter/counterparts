/**
 * FD1 STEP 5 (2026-11-07): OLD CHAPTERS STOP COSTING AMBIENT SLOTS. A chapter
 * (or a frozen full copy) whose latest chapter is `LAST_HERE_LIFE_DAYS` (14)
 * or more lived days old is left out of an ambient turn's footnotes, counted
 * on `recall.decision` as `journalAged`; a recent chapter still comes; facts
 * and meaning still find the old one; nothing about strength or ranking moves.
 * `mcp.recall` carries `elapsedMs`.
 *
 * Hermetic: every test opens a fresh temp data dir and removes it; nothing
 * here can reach a live store.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { MCP_RECALL_EVENT, RECALL_DECISION_EVENT } from "../src/core/counterpart-events.js";
import { LAST_HERE_LIFE_DAYS, latestChapter } from "../src/core/handoff/last-here.js";
import { journalAged, recallableRow } from "../src/core/recall/activate.js";
import { chapterHeading } from "../src/core/self/episodes.js";
import { rowToPhysics } from "../src/core/store/index.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/kilns";
const ZONE = "America/Denver";

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "The neighbour's cat sits on the fence every evening.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
  "The bread flour is kept in the second cupboard.",
];

const OLD_CHAPTER = "We fired the zqkiln glazes together and the celadon zqkiln crackled into a blue web overnight.";
const OLD_PROMPT = "how did the celadon zqkiln glazes crackle?";
const NEW_CHAPTER = "We tuned the vrombel loom tension and the vrombel warp finally held through the long run.";
const NEW_PROMPT = "how is the vrombel loom warp tension holding?";

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-journal-aged-"));
  setSystemTime(new Date("2026-11-07T15:00:00.000Z"));
});

afterEach(() => {
  setSystemTime();
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
  return { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE };
}

type Adapter = ReturnType<typeof openAdapter>;

function adapter(): Adapter {
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
  closers.push(a.counterpart);
  findable(a.counterpart.store);
  for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
  return a;
}

function server(a: Adapter, session: string): McpServer {
  return new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: dir });
}

function setDay(a: Adapter, day: number): void {
  a.counterpart.store.setMeta("livedDay", String(day));
}

async function chapter(a: Adapter, session: string, text: string): Promise<string> {
  const r = await server(a, session).call("chapter", { text, title: text.slice(0, 30) });
  expect(r.isError).not.toBe(true);
  const id = r.structuredContent["episodeId"];
  if (typeof id !== "string") throw new Error("no episode id");
  return id;
}

function prompt(a: Adapter, session: string, text: string) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
  );
  return a.userPromptSubmit(input);
}

function lastDecision(a: Adapter, session: string): Record<string, unknown> {
  const rows = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: session, order: "desc", limit: 1 });
  expect(rows.length).toBe(1);
  return JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
}

function shownIn(d: Record<string, unknown>): string[] {
  const ids = (rows: unknown): string[] => ((rows as { id: string }[] | undefined) ?? []).map((r) => r.id);
  return [...ids(d["surfaced"]), ...ids(d["footnotes"])];
}

function lastLookup(a: Adapter): Record<string, unknown> {
  const rows = a.counterpart.store.eventLog({ name: MCP_RECALL_EVENT, order: "desc", limit: 1 });
  expect(rows.length).toBe(1);
  return JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
}

describe("an aged chapter leaves ambient recall, through the real hook", () => {
  test("a chapter footnoted at 5 days is not at 14; a recent one still is; facts and meaning still find the old one", async () => {
    const a = adapter();
    setDay(a, 3);
    const old = await chapter(a, "sess_write_old", OLD_CHAPTER);
    expect(latestChapter(a.counterpart.store.row(old)!.body).day).toBe(3);
    const physicsBefore = rowToPhysics(a.counterpart.store.row(old)!);

    // 5 lived days on: the chapter is footnoted, nothing aged.
    setDay(a, 8);
    await prompt(a, "sess_read_early", OLD_PROMPT);
    const early = lastDecision(a, "sess_read_early");
    expect(shownIn(early)).toContain(old);
    expect(early["journalAged"]).toBe(0);
    const share = early["journalCandidates"] as { pool: number; kept: number; of: number };
    expect(share.kept).toBeGreaterThanOrEqual(1);
    expect(share.pool).toBeGreaterThanOrEqual(share.kept);
    expect(share.of).toBeGreaterThanOrEqual(share.kept);

    // 14 lived days after its last write: left out, by name.
    setDay(a, 3 + LAST_HERE_LIFE_DAYS);
    const recent = await chapter(a, "sess_write_new", NEW_CHAPTER);
    await prompt(a, "sess_read_late", OLD_PROMPT);
    const late = lastDecision(a, "sess_read_late");
    expect(shownIn(late)).not.toContain(old);
    expect(late["journalAged"] as number).toBeGreaterThanOrEqual(1);

    // A chapter written today still comes.
    await prompt(a, "sess_read_new", NEW_PROMPT);
    const fresh = lastDecision(a, "sess_read_new");
    expect(shownIn(fresh)).toContain(recent);
    expect(shownIn(fresh)).not.toContain(old);

    // The deliberate modes still find the old chapter, and say how long they took.
    const s = server(a, "sess_ask");
    const facts = await s.call("recall", { question: "celadon zqkiln glazes", mode: "facts" });
    expect(facts.isError).not.toBe(true);
    expect(facts.structuredContent["ids"] as string[]).toContain(old);
    const factsRow = lastLookup(a);
    expect(factsRow["mode"]).toBe("facts");
    expect(typeof factsRow["elapsedMs"]).toBe("number");
    expect(factsRow["elapsedMs"] as number).toBeGreaterThanOrEqual(0);

    const meaning = await s.call("recall", { question: "what were the zqkiln glazes to us?", mode: "meaning" });
    expect(meaning.isError).not.toBe(true);
    expect(meaning.structuredContent["ids"] as string[]).toContain(old);
    const meaningRow = lastLookup(a);
    expect(meaningRow["mode"]).toBe("meaning");
    expect(typeof meaningRow["elapsedMs"]).toBe("number");

    // By id: exact, whatever its age.
    const byId = await s.call("recall", { ids: [old] });
    expect(byId.isError).not.toBe(true);
    expect(JSON.stringify(byId.structuredContent)).toContain("zqkiln");
    expect(typeof lastLookup(a)["elapsedMs"]).toBe("number");

    // Physics untouched: the skip is an age test, not a strength or ranking row.
    expect(rowToPhysics(a.counterpart.store.row(old)!)).toEqual(physicsBefore);
    expect(a.counterpart.store.ranking(old)).toBeUndefined();
  });
});

describe("journalAged: the age test", () => {
  test("dated from the last chapter, not the birth; 13 days stays, 14 goes; summaries and memories never", () => {
    const a = adapter();
    const store = a.counterpart.store;
    setDay(a, 1);
    // Born on day 1, its latest chapter written on day 20.
    const grown = store.put({
      type: "episode",
      kind: "self",
      body: `${chapterHeading(1, 1)}\n\nFirst.\n\n${chapterHeading(2, 20)}\n\nLater.\n`,
    });
    const row = store.row(grown)!;
    expect(row.birth_day).toBe(1);
    expect(journalAged(store, row, 20 + LAST_HERE_LIFE_DAYS - 1)).toBe(false);
    expect(journalAged(store, row, 20 + LAST_HERE_LIFE_DAYS)).toBe(true);

    // A frozen full copy ages with its chapter.
    const copy = store.put({ type: "memory", kind: "self", body: row.body, source: "episode", origin: { ref: grown } });
    const copyRow = store.row(copy)!;
    expect(copyRow.origin_ref).toBe(grown);
    expect(journalAged(store, copyRow, 20 + LAST_HERE_LIFE_DAYS - 1)).toBe(false);
    expect(journalAged(store, copyRow, 20 + LAST_HERE_LIFE_DAYS)).toBe(true);

    // An ordinary memory never.
    const plain = store.put({ type: "memory", kind: "fact", body: "An old fact." });
    expect(journalAged(store, store.row(plain)!, 500)).toBe(false);

    // Ambient only: a deliberate caller of recallableRow is never told "journal-aged".
    const denied = new Set<string>();
    expect(recallableRow(store, grown, { denied, ambient: true, day: 40 })).toBe("journal-aged");
    expect(typeof recallableRow(store, grown, { denied, ambient: false, day: 40 })).toBe("object");
  });

  test("a body with no heading falls back to its birth day", () => {
    const a = adapter();
    const store = a.counterpart.store;
    setDay(a, 2);
    const bare = store.put({ type: "episode", kind: "self", body: "A chapter from before headings." });
    const row = store.row(bare)!;
    expect(journalAged(store, row, 2 + LAST_HERE_LIFE_DAYS - 1)).toBe(false);
    expect(journalAged(store, row, 2 + LAST_HERE_LIFE_DAYS)).toBe(true);
  });
});
