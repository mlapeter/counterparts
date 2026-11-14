/**
 * THE PAGE IN ITS OWN FORM, ONE STORE AT A TIME (PF1, 2026-11-01). A store whose
 * meta says `self.page_form` = `own` tells its two nightly page writers (day's
 * end and the reflection) to keep the page's sections and form instead of
 * `HOW_I_WORK_RULE`; every other store is told exactly what it was.
 *
 * (a) off is what master said: the rule is the same constant, and the night's
 *     blocks carry master's phrases word for word (the whole-prompt comparison
 *     against master is in the PR: every tunable combination, byte for byte);
 * (b) on, through the real doors: the setting made by the CLI, then `runNight`
 *     with a stubbed claude whose children call the memory's own MCP server;
 * (c) the CLI round trip, and a bad value refused.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNight } from "../src/adapters/claude-code/index.js";
import type { NightAnswer } from "../src/adapters/claude-code/index.js";
import { run } from "../src/adapters/cli/commands.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { Seat, SeatAct, SeatAsk } from "../src/core/counterpart.js";
import {
  AHEAD_PASSED_RULE,
  HOW_I_WORK_RULE,
  OWN_FORM_RULE,
  PAGE_FORM_KEY,
  PAGE_ROOM_BYTES,
  PAGE_ROOM_RULE,
  PAGE_WRITING_RULE,
  SELF_TUNABLES,
  pageFormOf,
  pageRoomRule,
  pageWritingRule,
  writerInstruction,
} from "../src/core/self/index.js";

const S = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const WAS = S.PAGE_SPLIT;
const SESSION = "s-page-form";
const DAY_MS = 86_400_000;
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-page-form-"));
  dir = join(root, "store");
});

afterEach(() => {
  S.PAGE_SPLIT = WAS;
  rmSync(root, { recursive: true, force: true });
});

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;
const text = (r: ToolResult): string => r.content.map((b) => ("text" in b ? String(b.text) : "")).join("\n");
/** The reflection's begin may carry its instructions JSON-escaped. */
const has = (t: string, s: string): boolean => t.includes(s) || t.includes(JSON.stringify(s).slice(1, -1));

function open(at: () => number = Date.now): Counterpart {
  return Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Dana" }, now: at });
}

/** A page in its own form: dated stories, no "## How I work". */
const PAGE = [
  "## Core",
  "",
  "Most of who I am with Dana is still unearned.",
  "",
  "## Stories",
  "",
  "2026-10-30: Dana's glaze ran at the foot; I had said it might, and saying so plainly was worth it.",
  "",
  "## Firm",
  "",
  "Short answers, no jargon.",
].join("\n");

function yesterday(): void {
  const c = open(() => Date.now() - DAY_MS);
  try {
    c.revisePage(PAGE, { reason: "a first page", by: "owner" });
    const day = c.store.livedDay();
    c.store.put({
      type: "memory",
      kind: "person",
      body: "Dana said the crystalline glaze ran at the foot, as I had warned.",
      salience: { relevance: 0.9, emotional: 0.6, predictive: 0.7 },
      physics: { birthDay: day, lastUsedDay: day },
    });
  } finally {
    c.close();
  }
}

function cli(): { out: string[]; opts: Parameters<typeof run>[1] } {
  const out: string[] = [];
  return { out, opts: { io: { out: (l: string) => void out.push(l), err: (l: string) => void out.push(l) }, env: {} } };
}

type Act = (ask: SeatAsk, s: McpServer) => Promise<void>;

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
          await act(ask, s);
        } finally {
          c.close();
        }
      }
      return { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
    },
  };
}

/** One night on the real path: day's end's block and the reflection's begin, as the children read them. */
async function night(split: boolean): Promise<{ writer: string; reflect: string }> {
  S.PAGE_SPLIT = split;
  let writer = "";
  let reflect = "";
  let dreamId = "";
  const asks: SeatAsk[] = [];
  await runNight({
    open: () => open(),
    config: { dataDir: dir },
    run: "nrn_page_form",
    session: SESSION,
    scope: "/shop",
    kind: { kind: "night" },
    seat: seat(
      {
        writer: async (_ask, s) => {
          const r = await s.call("dream", { phase: "writer", session: SESSION });
          expect(r.isError ?? false).toBe(false);
          writer = String(sc(r)["read"]);
        },
        dream: async (_ask, s) => {
          const begin = await s.call("dream", { phase: "begin", session: SESSION });
          expect(begin.isError ?? false).toBe(false);
          dreamId = String(sc(begin)["dream"]);
          // Page split off, day's end rides in the dream's own child.
          if (!split) writer = String(sc(await s.call("dream", { phase: "writer", session: SESSION, dream: dreamId }))["read"]);
          await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "I dreamed of a kiln shelf." });
        },
        reflection: async (_ask, s) => {
          const r = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
          expect(r.isError ?? false).toBe(false);
          reflect = text(r);
        },
      },
      asks,
    ),
  });
  expect(writer.length).toBeGreaterThan(0);
  expect(reflect.length).toBeGreaterThan(0);
  return { writer, reflect };
}

describe("PF1: one store's nightly writers keep the page's own form", () => {
  test("(a) off: the rule is master's constant, unchanged", () => {
    expect(pageWritingRule(null)).toBe(PAGE_WRITING_RULE);
    expect(pageWritingRule(undefined)).toBe(PAGE_WRITING_RULE);
    expect(HOW_I_WORK_RULE).toBe(
      `Under "## How I work", keep a few short, general lessons, a line or two each, without dated examples or anecdotes; the stories stay in the memories.`,
    );
    expect(PAGE_WRITING_RULE.startsWith(`${HOW_I_WORK_RULE} The page is read on later days`)).toBe(true);
    // On: the one sentence swapped, the rest word for word.
    expect(pageWritingRule("own")).toBe(PAGE_WRITING_RULE.replace(HOW_I_WORK_RULE, OWN_FORM_RULE));
    expect(pageWritingRule("own")).not.toContain("How I work");
  });

  test("a line still ahead after it passed (2026-11-13): one sentence, about lines that still read as ahead, in both forms; and the host's room in place of the default", () => {
    expect(AHEAD_PASSED_RULE).toBe(
      "A line that speaks of something ahead which has since happened or passed is no longer true as written: say it as past, or set it down.",
    );
    expect(PAGE_WRITING_RULE).toContain(`the wake dates the page. ${AHEAD_PASSED_RULE} `);
    expect(pageWritingRule("own")).toContain(AHEAD_PASSED_RULE);
    // The room: the default is the constant, word for word; a host's room replaces only the number.
    expect(pageWritingRule(null, PAGE_ROOM_BYTES)).toBe(PAGE_WRITING_RULE);
    expect(pageRoomRule()).toBe(PAGE_ROOM_RULE);
    const at600 = pageWritingRule("own", 600);
    expect(at600).toContain("The whole page has 600 bytes of room");
    expect(at600).not.toContain(String(PAGE_ROOM_BYTES));
    expect(at600).toBe(pageWritingRule("own").replace(PAGE_ROOM_RULE, pageRoomRule(600)));
  });

  test("the store's word: only `own` is own, and a store that won't answer reads as absent", () => {
    const c = open();
    try {
      expect(pageFormOf(c.store)).toBeNull();
      c.store.setMeta(PAGE_FORM_KEY, " own ");
      expect(pageFormOf(c.store)).toBe("own");
      c.store.setMeta(PAGE_FORM_KEY, "on");
      expect(pageFormOf(c.store)).toBeNull();
      c.store.setMeta(PAGE_FORM_KEY, "");
      expect(pageFormOf(c.store)).toBeNull();
    } finally {
      c.close();
    }
    expect(pageFormOf({ getMeta: () => { throw new Error("closed"); } })).toBeNull();
  });

  test("(c) the console sets it for one store, reads it, puts it back, and refuses a bad word", async () => {
    open().close();
    const { out, opts } = cli();
    expect(await run(["page-form", "--dir", dir], opts)).toBe(0);
    expect(out.at(-1)).toContain("the default");
    expect(await run(["page-form", "own", "--dir", dir], opts)).toBe(0);
    expect(out.at(-1)).toContain("its own");
    expect(await run(["page-form", "--dir", dir], opts)).toBe(0);
    expect(out.at(-1)).toContain("its own");
    expect(await run(["page-form", "default", "--dir", dir], opts)).toBe(0);
    expect(out.at(-1)).toContain("the default");
    expect(await run(["page-form", "on", "--dir", dir], opts)).not.toBe(0);
    expect(await run(["page-form", "own", "extra", "--dir", dir], opts)).not.toBe(0);
    // An observer console reads it but may not set it.
    expect(await run(["page-form", "own", "--dir", dir, "--observer"], opts)).not.toBe(0);
    expect(out.at(-1)).toContain("observer");
    expect(await run(["page-form", "--dir", dir, "--observer"], opts)).toBe(0);
    expect(out.at(-1)).toContain("the default");
    const c = open();
    try {
      expect(pageFormOf(c.store)).toBeNull();
    } finally {
      c.close();
    }
  });

  for (const split of [true, false]) {
    test(`(a) off, on the real night path (page split ${split ? "on" : "off"}): both writers are told what master told them`, async () => {
      yesterday();
      const { writer, reflect } = await night(split);
      expect(writer).toContain(PAGE_WRITING_RULE);
      expect(writer).not.toContain(OWN_FORM_RULE);
      expect(has(reflect, PAGE_WRITING_RULE)).toBe(true);
      // A line still ahead after it passed (2026-11-13): told to both doors.
      expect(writer).toContain(AHEAD_PASSED_RULE);
      expect(has(reflect, AHEAD_PASSED_RULE)).toBe(true);
      expect(has(reflect, OWN_FORM_RULE)).toBe(false);
      if (split) {
        expect(writer).toContain("and `## How I work` (how you work now) from the day.");
        expect(has(reflect, "day's end amends the other sections (Lately, How I work) from the day")).toBe(true);
      } else {
        expect(has(reflect, `put craft — how a job is done — under "## How I work".`)).toBe(true);
      }
    });

    test(`(b) on, set by the CLI, on the real night path (page split ${split ? "on" : "off"}): no "How I work" anywhere, the own-form sentence instead`, async () => {
      yesterday();
      const { opts } = cli();
      expect(await run(["page-form", "own", "--dir", dir], opts)).toBe(0);
      const { writer, reflect } = await night(split);
      // The page itself has no such heading, so any mention would be an instruction.
      for (const t of [writer, reflect]) {
        expect(t).not.toContain("How I work");
        expect(has(t, HOW_I_WORK_RULE)).toBe(false);
        expect(has(t, OWN_FORM_RULE)).toBe(true);
        expect(has(t, pageWritingRule("own"))).toBe(true);
      }
      if (split) {
        expect(writer).toContain("and the page's other sections from the day, in their own form.");
        expect(has(reflect, "day's end amends the other sections (every section but Core) from the day")).toBe(true);
      } else {
        expect(has(reflect, "put craft")).toBe(false);
      }
      // Undo by a word: what the store's writer is handed next is master's again.
      expect(await run(["page-form", "default", "--dir", dir], opts)).toBe(0);
      const c = open();
      try {
        const built = c.pageWriterInput({ about: "2026-10-31" });
        expect(built.pageForm).toBeUndefined();
        expect(writerInstruction(built, { tool: "self_page" })).toContain(PAGE_WRITING_RULE);
      } finally {
        c.close();
      }
    });
  }
});
