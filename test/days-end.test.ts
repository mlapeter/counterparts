/**
 * DAY'S END (lane D1, 2026-10-23; Mike's go, lightly held): the nightly page
 * writer, renamed, reads the day as it was told — every chapter of the day by
 * its summary, a line each with its address, and the day's few strongest
 * memories with their ids, so Lately can cite them (`self.DAYS_END_INPUT`).
 * And the MUST CHECK (d): a page's cite that a dream then merges — does it
 * dangle?
 *
 * Every check goes through the night's own doors: `runNight` with a stubbed
 * claude in the seat, whose children call the memory's MCP server as a night
 * child does (the dream tool's `writer` phase, `recall`, `self_page`, the
 * dream's `begin`/`propose`/`journal`), and the CLI.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNight } from "../src/adapters/claude-code/index.js";
import type { NightAnswer } from "../src/adapters/claude-code/index.js";
import { selfPageTraceFindings } from "../src/adapters/claude-code/doctor-self-page.js";
import { run as cliRun } from "../src/adapters/cli/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat, SeatAct, SeatAsk } from "../src/core/counterpart.js";
import { nightPartsWords } from "../src/core/dream/index.js";
import { headOf } from "../src/core/recall/standing.js";
import { SELF_TUNABLES, pageWriterNight } from "../src/core/self/index.js";
import { pageTrace } from "../src/core/self/measures.js";
import type { PutInput } from "../src/core/store/index.js";

const S = SELF_TUNABLES as { DAYS_END_INPUT: boolean; DAYS_END_MEMORIES: number; PAGE_SPLIT: boolean };
const WAS = { DAYS_END_INPUT: S.DAYS_END_INPUT, DAYS_END_MEMORIES: S.DAYS_END_MEMORIES, PAGE_SPLIT: S.PAGE_SPLIT };
const SESSION = "s-days-end";
const DAY_MS = 86_400_000;
let root: string;
let dir: string;
let substance = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-days-end-"));
  dir = join(root, "store");
  substance = 0;
  S.DAYS_END_INPUT = true;
  S.PAGE_SPLIT = true;
});

afterEach(() => {
  S.DAYS_END_INPUT = WAS.DAYS_END_INPUT;
  S.DAYS_END_MEMORIES = WAS.DAYS_END_MEMORIES;
  S.PAGE_SPLIT = WAS.PAGE_SPLIT;
  rmSync(root, { recursive: true, force: true });
});

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;

function open(at: () => number = Date.now): Counterpart {
  return Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Mike" }, now: at });
}

const PAGE = [
  "## Core",
  "",
  "I say what I do not know before I guess.",
  "",
  "## Lately",
  "",
  "Lately the work has been the night's children, one at a time.",
  "",
  "## How I work",
  "",
  "I test through the real doors before I call a thing done.",
].join("\n");

const HOLD = "The zqkiln's cone-six hold is thirty-five minutes at 1,100 degrees, Mira and I settled it.";
const HOLD_AGAIN = "Hold the zqkiln at 1,100 degrees for thirty-five minutes on a cone-six firing, as settled with Mira.";
const SUMMARY = "Settled the zqkiln hold at thirty-five minutes with Mira, and wrote it on the kiln door.";

/**
 * Yesterday, lived: a chapter with its summary, the two near-copies about
 * the kiln's hold (the strongest of the day), and `fillers` weaker memories.
 */
function yesterday(fillers = 20): { episode: string; hold: string; again: string; weakest: string } {
  const c = open(() => Date.now() - DAY_MS);
  try {
    c.revisePage(PAGE, { reason: "a first page", by: "owner" });
    substance += 400;
    expect(c.episodeAsk(SESSION, { turns: substance, bytes: substance * 1_000 }).asked).toBe(true);
    const chapter = `We spent the afternoon at the zqkiln. ${"Mira and I compared the firing logs, cone by cone, and talked the hold time through out loud. ".repeat(40)}`;
    const written = c.appendEpisode(SESSION, chapter, { summary: SUMMARY, title: "The zqkiln afternoon" });
    const put = (body: string, over: Partial<PutInput> = {}): string => {
      const day = c.store.livedDay();
      return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0.2, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
    };
    const strong = { salience: { relevance: 0.95, emotional: 0.9, predictive: 0.95 } };
    const hold = put(HOLD, strong);
    const again = put(HOLD_AGAIN, strong);
    let weakest = "";
    for (let i = 0; i < fillers; i += 1) {
      weakest = put(`A smaller thing from the day, number ${String(i)}: the shelf paper, the glaze bucket, the door latch.`, {
        salience: { relevance: 0.6 - i * 0.02, emotional: 0.1, predictive: 0.6 - i * 0.02 },
      });
    }
    return { episode: written.episodeId as string, hold, again, weakest };
  } finally {
    c.close();
  }
}

type Act = (ask: SeatAsk, s: McpServer, c: Counterpart) => Promise<void>;

/** A stubbed claude: each act's child calls the memory's MCP server as a night child does. */
function seat(acts: Partial<Record<SeatAct, Act>>, asks: SeatAsk[]): Seat<NightAnswer> {
  return {
    name: "test",
    async answer(ask) {
      asks.push(ask);
      const act = acts[ask.act];
      if (act !== undefined) {
        const c = open();
        try {
          const s = new McpServer({ counterpart: c, session: ask.session, scope: ask.scope, registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: ask.act, COUNTERPARTS_NIGHT_RUN: ask.run } });
          await act(ask, s, c);
        } finally {
          c.close();
        }
      }
      return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
    },
  };
}

function night(s: Seat<NightAnswer>): ReturnType<typeof runNight> {
  return runNight({ open: () => open(), config: { dataDir: dir }, run: "nrn_days_end", session: SESSION, scope: "/proj", kind: { kind: "night" }, seat: s });
}

const LATELY = "Lately the zqkiln's thirty-five-minute hold has been the steady part of the work.";

describe("day's end reads the day as told — the night entry with a stubbed claude", () => {
  test("handed every chapter by its summary with its address and the day's strongest memories with ids, not the whole list; recall opens a chapter; what it cites stands on the page", async () => {
    const y = yesterday();
    const asks: SeatAsk[] = [];
    let block = "";
    let recalled = "";
    let wrote: Record<string, unknown> = {};
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            const r = await s.call("dream", { phase: "writer", session: SESSION });
            expect(r.isError ?? false).toBe(false);
            block = String(sc(r)["read"]);
            const rc = await s.call("recall", { ids: [`${y.episode}#1`] });
            recalled = JSON.stringify(sc(rc));
            const body = PAGE.replace("Lately the work has been the night's children, one at a time.", LATELY);
            wrote = sc(await s.call("self_page", { body, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"], claims: [{ text: LATELY, cites: [y.hold, "mem_000000000000"] }] }));
          },
        },
        asks,
      ),
    );
    // Its child may open a chapter whole.
    expect(asks[0]?.act).toBe("writer");
    expect(asks[0]?.tools).toEqual(["dream", "self_page", "recall"]);
    // The moment, named: the diary of the day, before sleep.
    expect(block).toContain("This is day's end: the diary of this day, before sleep.");
    expect(block).toContain("keep every sentence that still holds");
    // The day as told: the chapter by its summary and its address, not its words whole.
    expect(block).toContain("The day as told");
    expect(block).toContain(`- ${y.episode}#1 · The zqkiln afternoon: ${SUMMARY}`);
    expect(block).not.toContain("compared the firing logs, cone by cone");
    // The strongest memories with their ids — at most DAYS_END_MEMORIES — not the whole day.
    expect(block).toContain(`- ${y.hold} · ${HOLD}`);
    expect(block).toContain(`- ${y.again} · ${HOLD_AGAIN}`);
    expect(block).not.toContain(y.weakest);
    const lines = block.split("\n").filter((l) => /^- mem_[0-9a-f]+ · /.test(l));
    expect(lines).toHaveLength(SELF_TUNABLES.DAYS_END_MEMORIES);
    expect(block).toContain("pass `claims` with it");
    // Recall read the chapter whole by its address.
    expect(recalled).toContain("compared the firing logs, cone by cone");
    // The write: its sentence rests on the memory it named; an id that names nothing is named back.
    expect(wrote["stored"]).toBe(true);
    expect(wrote["traced"]).toMatchObject({ cited: 1, unmatched: 0 });
    expect(wrote["refusedCites"]).toEqual(["mem_000000000000"]);
    const c = open();
    try {
      const page = c.selfPage();
      expect(page?.by).toBe("writer");
      const claim = page?.trace?.claims?.find((x) => x.text === LATELY);
      expect(claim?.cites).toEqual([y.hold]);
      const t = pageTrace(c.store, page as NonNullable<typeof page>);
      expect(t).toMatchObject({ source: "page", cites: 1, live: 1, archivedOrMissing: 0 });
      // The run's row: the dozen it was handed.
      expect(c.pageWriterRuns({ about: pageWriterNight(c.store).about }).find((r) => r.outcome === "asked")?.considered).toBe(SELF_TUNABLES.DAYS_END_MEMORIES);
    } finally {
      c.close();
    }
  });

  test("the switch off: the ranked list of the day as before, no ids, the journal fitted, no recall for the child", async () => {
    S.DAYS_END_INPUT = false;
    const y = yesterday();
    const asks: SeatAsk[] = [];
    let block = "";
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            block = String(sc(await s.call("dream", { phase: "writer", session: SESSION }))["read"]);
          },
        },
        asks,
      ),
    );
    expect(asks[0]?.tools).toEqual(["dream", "self_page"]);
    expect(block).not.toContain("This is day's end");
    expect(block).toContain("Do not write a diary entry here; the journal already has that day.");
    expect(block).toContain("most salient first:");
    expect(block).toContain(`- ${HOLD}`);
    expect(block).not.toContain(`- ${y.hold} · `);
    expect(block).toContain(y.weakest === "" ? "" : "number 19");
    expect(block).not.toContain("The day as told");
    expect(block).toContain("The journal on");
    expect(block).not.toContain("pass `claims` with it");
    const c = open();
    try {
      // Every one of the day's memories, as before.
      expect(c.pageWriterRuns({ about: pageWriterNight(c.store).about }).find((r) => r.outcome === "asked")?.considered).toBe(22);
    } finally {
      c.close();
    }
  });
});

describe("self_page's cites and claims", () => {
  test("what is not a memory's id is named back, never dropped unsaid; nothing usable keeps the trace there", async () => {
    const y = yesterday(1);
    const c = open();
    try {
      const s = new McpServer({ counterpart: c, session: SESSION, scope: "/proj", registryDir: dir });
      const body = PAGE.replace("Lately the work has been the night's children, one at a time.", LATELY);
      const first = sc(await s.call("self_page", { body, reason: "with a cite", claims: [{ text: LATELY, cites: [y.hold] }] }));
      expect(first["stored"]).toBe(true);
      const bad = sc(await s.call("self_page", { body: `${body}\n\nOne more line.`, reason: "bad cites", cites: "mem_x", claims: "nope" }));
      expect(bad["stored"]).toBe(true);
      expect(bad["refusedCites"]).toEqual(["mem_x", "nope"]);
      const mixed = sc(await s.call("self_page", { body, reason: "mixed", cites: [7, "", y.episode, y.hold], claims: [{ text: LATELY, cites: [y.hold] }, "loose"] }));
      expect(mixed["refusedCites"]).toEqual(["7", "", y.episode, "loose"]);
      expect(c.selfPage()?.trace?.claims?.find((x) => x.text === LATELY)?.cites).toEqual([y.hold]);
    } finally {
      c.close();
    }
  });
});

describe("(d) a page's cite through a dream's merge", () => {
  test("day's end cites a memory, the dream merges it: the cite stays on its sentence (no retarget), reads live while the original is, and through the merged memory once it is archived — never a hypothesis", async () => {
    const y = yesterday(4);
    let merged = "";
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            const r = await s.call("dream", { phase: "writer", session: SESSION });
            const body = PAGE.replace("Lately the work has been the night's children, one at a time.", LATELY);
            const w = sc(await s.call("self_page", { body, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"], claims: [{ text: LATELY, cites: [y.hold] }] }));
            expect(w["stored"]).toBe(true);
          },
          dream: async (_ask, s, c) => {
            const begin = await s.call("dream", { phase: "begin", session: SESSION });
            expect(begin.isError ?? false).toBe(false);
            const dreamId = String(sc(begin)["dream"]);
            const p = await s.call("dream", { phase: "propose", session: SESSION, dream: dreamId, changes: [{ action: "merge", ids: [y.hold, y.again], text: "The zqkiln's cone-six hold is thirty-five minutes at 1,100 degrees.", title: "The zqkiln hold" }] });
            expect(p.isError ?? false).toBe(false);
            expect(sc(p)["landed"]).toMatchObject({ merged: 1 });
            merged = c.store.dreamChanges(dreamId).find((x) => x.action === "merge")?.ref ?? "";
            await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "I dreamed the two kiln notes were one." });
          },
        },
        [],
      ),
    );
    expect(merged).toMatch(/^mem_/);
    const c = open();
    try {
      const page = c.selfPage();
      if (page === null) throw new Error("no page");
      // The cite is the original's id, on its sentence: nothing retargets it.
      expect(page.trace?.claims?.find((x) => x.text === LATELY)?.cites).toEqual([y.hold]);
      // Since 2026-10-11 a merge leaves its originals live, faded and settled under the merged memory.
      expect(c.store.row(y.hold)?.archived).toBe(0);
      expect(headOf(c.store, y.hold)).toBe(merged);
      const before = pageTrace(c.store, page);
      expect(before).toMatchObject({ cites: 1, live: 1, archivedOrMissing: 0, throughLater: 0, uncited: 2 });
      expect(before.hypotheses).not.toContain(LATELY);
      // Its own curve archives the original later; here, now.
      c.store.archive(y.hold, "decay");
      const after = pageTrace(c.store, page);
      // Resolved through the merge at read (2026-10-23): live, through a later memory.
      expect(after).toMatchObject({ cites: 1, live: 1, archivedOrMissing: 0, throughLater: 1, uncited: 2 });
      expect(after.hypotheses).not.toContain(LATELY);
      const line = selfPageTraceFindings(c.store)[0];
      expect(line?.detail).toContain("1 live (1 through a later memory)");
    } finally {
      c.close();
    }
  });
});

describe("the name: day's end", () => {
  test("the night's words, the CLI and the dashboard say day's end, never the page writer", async () => {
    yesterday(2);
    const asks: SeatAsk[] = [];
    const out = await night(seat({}, asks));
    expect(asks[0]?.prompt).toContain("one part: day's end");
    expect(asks[0]?.prompt).not.toMatch(/page writer/i);
    expect(nightPartsWords({ kind: "night", parts: ["writer", "dream"], children: out.children ?? [] })).toContain("day's end");
    // The CLI: help and the dream setting's words.
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    await cliRun(["help", "dream", "--dir", dir], { io });
    await cliRun(["help", "self-page", "--dir", dir], { io });
    await cliRun(["dream", "--dir", dir], { io });
    await cliRun(["night", "last", "--dir", dir], { io });
    const said = lines.join("\n");
    expect(said.length).toBeGreaterThan(0);
    expect(said).not.toMatch(/page writer/i);
    // The dashboard, by grep: no page-writer words in a string a person reads.
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|ts|html)$/.test(name)) {
          readFileSync(p, "utf8")
            .split("\n")
            .forEach((l, i) => {
              const code = l.trim();
              if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
              if (/["'`][^"'`]*page writer[^"'`]*["'`]/i.test(code)) hits.push(`${p}:${String(i + 1)}`);
            });
        }
      }
    };
    walk(join(import.meta.dir, "..", "src", "adapters", "dashboard"));
    expect(hits).toEqual([]);
  });
});
