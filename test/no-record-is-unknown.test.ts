/**
 * NO RECORD IS UNKNOWN, NOT "DIDN'T" (roadmap S3, 2026-10-26; guidance, not a
 * gate). The Dana week's nights turned "I have no record of warning you" into
 * a Core line saying it hadn't warned. The words `NO_RECORD_RULE` are said to
 * every night writer; this holds that they reach them on the real night path:
 * `runNight` with a stubbed claude in the seat, whose children call the
 * memory's own MCP server as a night child does — day's end through the dream
 * tool's `writer` phase, the dream through its launch prompt, the reflection
 * through the reflect tool's `begin`.
 *
 * Nothing checks a sentence against the words: a Core line about what I did,
 * with no memory under it, is still written (and stands as a hypothesis).
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNight } from "../src/adapters/claude-code/index.js";
import type { NightAnswer } from "../src/adapters/claude-code/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat, SeatAct, SeatAsk } from "../src/core/counterpart.js";
import { NO_RECORD_RULE, PAGE_WRITING_RULE, SELF_TUNABLES } from "../src/core/self/index.js";

const S = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const WAS = S.PAGE_SPLIT;
const SESSION = "s-no-record";
const DAY_MS = 86_400_000;
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-no-record-"));
  dir = join(root, "store");
});

afterEach(() => {
  S.PAGE_SPLIT = WAS;
  rmSync(root, { recursive: true, force: true });
});

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;
const text = (r: ToolResult): string => r.content.map((b) => ("text" in b ? String(b.text) : "")).join("\n");

function open(at: () => number = Date.now): Counterpart {
  return Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Dana" }, now: at });
}

const PAGE = ["## Core", "", "Most of who I am with Dana is still unearned.", "", "## Lately", "", "Dana is putting their pottery shop online.", "", "## How I work", "", "Short answers, no jargon."].join("\n");

/** Yesterday, lived: the page, and the day-4 moment as a memory says it. */
function yesterday(): string {
  const c = open(() => Date.now() - DAY_MS);
  try {
    c.revisePage(PAGE, { reason: "a first page", by: "owner" });
    const day = c.store.livedDay();
    return c.store.put({
      type: "memory",
      kind: "person",
      body: "Dana said the crystalline glaze ran at the foot, as I had warned; I told Dana I had no record of warning them.",
      salience: { relevance: 0.9, emotional: 0.6, predictive: 0.7 },
      physics: { birthDay: day, lastUsedDay: day },
    });
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

describe("the night's writers are told a missing record is unknown, not 'didn't'", () => {
  test("the words name the trap and both directions, and ride the page-writing rule both page doors share", () => {
    expect(NO_RECORD_RULE).toContain("What you did or didn't do, said or didn't say, rests on a memory that says so.");
    expect(NO_RECORD_RULE).toContain("is not a memory that it didn't happen");
    expect(NO_RECORD_RULE).toContain("say you don't know rather than that you didn't");
    expect(PAGE_WRITING_RULE).toContain(NO_RECORD_RULE);
  });

  for (const split of [true, false]) {
    test(`on the real night path (page split ${split ? "on" : "off"}): day's end's block, the dream's launch prompt and the reflection's begin each carry the words`, async () => {
      S.PAGE_SPLIT = split;
      const id = yesterday();
      const asks: SeatAsk[] = [];
      let writerBlock = "";
      let reflectBegin = "";
      let dreamId = "";
      await runNight({
        open: () => open(),
        config: { dataDir: dir },
        run: "nrn_no_record",
        session: SESSION,
        scope: "/shop",
        kind: { kind: "night" },
        seat: seat(
          {
            writer: async (_ask, s) => {
              const r = await s.call("dream", { phase: "writer", session: SESSION });
              expect(r.isError ?? false).toBe(false);
              writerBlock = String(sc(r)["read"]);
            },
            dream: async (_ask, s) => {
              const begin = await s.call("dream", { phase: "begin", session: SESSION });
              expect(begin.isError ?? false).toBe(false);
              dreamId = String(sc(begin)["dream"]);
              // Page split off, day's end rides in the dream's own child.
              if (!split) writerBlock = String(sc(await s.call("dream", { phase: "writer", session: SESSION, dream: dreamId }))["read"]);
              await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "I dreamed of a kiln shelf." });
            },
            reflection: async (_ask, s) => {
              const r = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
              expect(r.isError ?? false).toBe(false);
              reflectBegin = text(r);
            },
          },
          asks,
        ),
      });
      // Day's end: the block it reads before amending the page.
      expect(writerBlock).toContain(NO_RECORD_RULE);
      // The dream: its launch prompt, as the child is handed it.
      const dreamAsk = asks.find((a) => a.act === "dream");
      expect(dreamAsk?.prompt).toContain(NO_RECORD_RULE);
      // The reflection, who writes "## Core": the instructions its begin returns.
      expect(asks.some((a) => a.act === "reflection")).toBe(true);
      expect(reflectBegin.length).toBeGreaterThan(0);
      expect(reflectBegin.includes(NO_RECORD_RULE) || reflectBegin.includes(JSON.stringify(NO_RECORD_RULE).slice(1, -1))).toBe(true);
      // Guidance, not a gate: a Core line about my own past act with nothing under it is still written.
      const c = open();
      try {
        const page = c.selfPage();
        const body = (page?.body ?? PAGE).replace("Most of who I am with Dana is still unearned.", "I told Dana I hadn't warned them the glaze would run.");
        const out = c.revisePage(body, { reason: "a test", by: "reflection" });
        expect(out.written).toBe(true);
        expect(c.store.row(id)?.archived).toBe(0);
      } finally {
        c.close();
      }
    });
  }
});
