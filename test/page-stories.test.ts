/**
 * THE PAGE'S STORIES (PS1, 2026-11-09): stories about growth, not only
 * corrections. On a store that keeps its page in its own form, the night's
 * page writers are told to keep a mix of story kinds and the test a story
 * must pass; day's end is shown a memory about me or us with a head start
 * over the day's work, and a memory nominated as a story during the day
 * first; and a craft practice may move off the page into a skill memory that
 * the set-down record names.
 *
 * Real path, no model: a day lived through the memory's own MCP door (the
 * nomination is a `remember` with `story: true`), then `runNight` with a
 * stubbed claude whose children call the MCP server as a night child does.
 * The asserts are on what the writers are shown and told, and on what the
 * write leaves in the store.
 *
 * Hermetic: a fresh temp data dir per test, removed after; every word is
 * invented placeholder prose (a potter and a kiln).
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
import { strength } from "../src/core/physics/index.js";
import {
  NOMINATED_MARK,
  NOMINATED_NOTE,
  PAGE_FORM_KEY,
  PAGE_STORIES_RULE,
  PAGE_STORY_LIMITS,
  SELF_TUNABLES,
  STORY_TAG,
  pageCraftRule,
  storyHeadStart,
} from "../src/core/self/index.js";
import { SET_DOWN_META, readSetDowns } from "../src/core/self/set-down.js";

const S = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const WAS = S.PAGE_SPLIT;
const SESSION = "s-page-stories";
const DAY_MS = 86_400_000;
let root: string;
let dir: string;

beforeEach(() => {
  process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
  root = mkdtempSync(join(tmpdir(), "counterparts-page-stories-"));
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
  return Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Wren" }, now: at });
}

/** A craft line on the page, about the work only: the one day's end moves to a skill. */
const CRAFT = "- Fire a test tile beside every new glaze, with a known glaze as the control.";
/** A page in its own form whose stories are all corrections. */
const PAGE = [
  "## Core",
  "",
  "Most of who I am with Wren is still unearned.",
  "",
  "## Kiln lessons",
  "",
  "2026-10-02: I blamed the glaze when the kiln shelf was the cause; now I check the shelf first.",
  "2026-10-09: I quoted a cone number from memory and it was wrong; now I read the log.",
  "2026-10-20: I called a batch done before it cooled; now I wait for the kiln to say so.",
  "",
  "## Practices",
  "",
  CRAFT,
  "- I say what I don't know before I guess.",
].join("\n");

/** Day's end's page: the craft line gone, moved to a skill. */
const WRITTEN = PAGE.replace(`${CRAFT}\n`, "");
const SKILL = "Fire a test tile beside every new glaze, with a known glaze fired as the control, before trusting the result.";

const WORK = (i: number): string => `Kiln batch ${String(i)}: loaded the zqshelf with mugs and logged the cone at the zqbench.`;
const ME = "I noticed I enjoy the quiet of unloading a kiln with Wren more than the firing itself.";
const NOMINATED = "Wren and I found the speckled glaze by accident, mixing two leftovers, and laughed about it all afternoon.";

/**
 * Yesterday, lived: the page; more work memories than day's end is handed
 * (`DAYS_END_MEMORIES`), each a little stronger than one memory about me;
 * and one moment nominated as a story through the MCP door.
 */
async function yesterday(own: boolean): Promise<{ me: string; nominated: string; work: string[] }> {
  const c = open(() => Date.now() - DAY_MS);
  try {
    if (own) c.store.setMeta(PAGE_FORM_KEY, "own");
    c.revisePage(PAGE, { reason: "a first page", by: "owner" });
    const day = c.store.livedDay();
    const work: string[] = [];
    for (let i = 0; i < SELF_TUNABLES.DAYS_END_MEMORIES + 2; i += 1) {
      work.push(c.store.put({ type: "memory", kind: "fact", body: WORK(i), salience: { relevance: 0.6, emotional: 0.25, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } }));
    }
    const me = c.store.put({ type: "memory", kind: "self", body: ME, about: "me", salience: { relevance: 0.58, emotional: 0.25, predictive: 0.58 }, physics: { birthDay: day, lastUsedDay: day } });
    // The head start is what moves it: on its own strength it is below every work memory.
    const s = (id: string): number => strength(c.store.physicsOf(id), day);
    for (const w of work) expect(s(me)).toBeLessThan(s(w));
    expect(s(me) + PAGE_STORY_LIMITS.HEAD_START).toBeGreaterThan(Math.max(...work.map(s)));
    const server = new McpServer({ counterpart: c, session: "s-day", scope: "/shop", registryDir: dir });
    const r = sc(await server.call("remember", { session: "s-day", kind: "fact", text: NOMINATED, about: "us", salience: 0.3, story: true }));
    const nominated = String(r["id"]);
    expect(r["story"]).toMatchObject({ nominated: true });
    expect(c.store.tagsOf(nominated).map((t) => t.tag)).toContain(STORY_TAG);
    return { me, nominated, work };
  } finally {
    c.close();
  }
}

type Act = (ask: SeatAsk, s: McpServer) => Promise<void>;

function seat(acts: Partial<Record<SeatAct, Act>>): Seat<NightAnswer> {
  return {
    name: "test",
    async answer(ask) {
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

/** One night on the real path: day's end's block (and its write, when given), the reflection's begin. */
async function night(split: boolean, write?: (s: McpServer, ifVersion: unknown) => Promise<void>): Promise<{ writer: string; reflect: string }> {
  S.PAGE_SPLIT = split;
  let writer = "";
  let reflect = "";
  let dreamId = "";
  const writerAct = async (s: McpServer, dream?: string): Promise<void> => {
    const r = await s.call("dream", { phase: "writer", session: SESSION, ...(dream === undefined ? {} : { dream }) });
    expect(r.isError ?? false).toBe(false);
    writer = String(sc(r)["read"]);
    if (write !== undefined) await write(s, sc(r)["ifVersion"]);
  };
  await runNight({
    open: () => open(),
    config: { dataDir: dir },
    run: "nrn_page_stories",
    session: SESSION,
    scope: "/shop",
    kind: { kind: "night" },
    seat: seat({
      writer: async (_ask, s) => writerAct(s),
      dream: async (_ask, s) => {
        const begin = await s.call("dream", { phase: "begin", session: SESSION });
        expect(begin.isError ?? false).toBe(false);
        dreamId = String(sc(begin)["dream"]);
        // Page split off, day's end rides in the dream's own child.
        if (!split) await writerAct(s, dreamId);
        await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "I dreamed of a kiln shelf." });
      },
      reflection: async (_ask, s) => {
        const r = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
        expect(r.isError ?? false).toBe(false);
        reflect = text(r);
      },
    }),
  });
  expect(writer.length).toBeGreaterThan(0);
  expect(reflect.length).toBeGreaterThan(0);
  return { writer, reflect };
}

/** Day's end's memory lines, in the order shown, by the memory id that leads each. */
function shownOrder(block: string): string[] {
  return block
    .split("\n")
    .filter((l) => /^- mem_[0-9a-z]+ · /.test(l))
    .map((l) => l.slice(2, l.indexOf(" · ")));
}

describe("PS1: the page's stories, on an own-form store", () => {
  test("day's end is told the mix and its test, shown the nominated moment first and a memory about me ahead of the day's work, and a craft line it moves out becomes a skill memory its set-down names", async () => {
    const { me, nominated, work } = await yesterday(true);
    let wrote: Record<string, unknown> = {};
    const { writer, reflect } = await night(true, async (s, ifVersion) => {
      wrote = sc(await s.call("self_page", { body: WRITTEN, reason: "day's end", session: SESSION, ifVersion, setDown: [{ line: CRAFT.slice(2), why: "moved to a skill", skill: SKILL }] }));
    });

    // Told: the mix, the test, and the craft rule (the set-down rule it builds on before it).
    expect(writer).toContain(PAGE_STORIES_RULE);
    expect(writer).toContain(pageCraftRule("`setDown`"));
    expect(writer).toContain("A page whose stories are only corrections is the failure to avoid");
    expect(writer).toContain("would still teach something in a different project");
    expect(writer).toContain("not about honesty or about the owner");
    expect(writer.indexOf("pass `setDown`")).toBeLessThan(writer.indexOf(PAGE_STORIES_RULE));

    // Shown: the nomination first, marked and explained; the memory about me
    // ahead of the work that outranks it on strength, inside the dozen.
    const order = shownOrder(writer);
    expect(order).toHaveLength(SELF_TUNABLES.DAYS_END_MEMORIES);
    expect(order[0]).toBe(nominated);
    // The heading says how the dozen was picked, not "strongest".
    expect(writer).toContain(`The ${String(SELF_TUNABLES.DAYS_END_MEMORIES)} picked (nominated first, then the strongest, a memory about me or us a little ahead) of the`);
    expect(writer).toContain(`- ${nominated} · ${NOMINATED_MARK} ${NOMINATED}`);
    expect(writer).toContain(NOMINATED_NOTE);
    expect(writer.indexOf(NOMINATED_NOTE)).toBeLessThan(writer.indexOf(`- ${nominated} · `));
    expect(order).toContain(me);
    for (const w of work) if (order.includes(w)) expect(order.indexOf(me)).toBeLessThan(order.indexOf(w));
    // Only the nomination carries the mark.
    expect(writer.split("\n").filter((l) => l.startsWith("- mem_") && l.includes(NOMINATED_MARK))).toHaveLength(1);

    // Page split on: the reflection writes Core alone, which tells no stories.
    expect(has(reflect, PAGE_STORIES_RULE)).toBe(false);

    // Moved out: a skill memory with the practice, named by the set-down record and said back.
    expect(wrote["stored"]).toBe(true);
    expect(String(wrote["setDown"])).toContain("Moved to a skill memory: mem_");
    const c = open();
    try {
      const rows = readSetDowns(c.store);
      expect(rows.map((r) => r.line)).toEqual([CRAFT.slice(2)]);
      const row = rows[0];
      if (row === undefined) throw new Error("no set-down");
      expect(row.why).toBe("moved to a skill");
      expect(row.skill).toMatch(/^mem_/);
      const skill = c.store.row(String(row.skill));
      expect(skill?.kind).toBe("skill");
      expect(skill?.about ?? null).toBeNull();
      expect(c.store.readProse(String(row.skill)).body).toBe(SKILL);
      expect((c.store.readProse(row.id).meta[SET_DOWN_META] as Record<string, unknown>)["skill"]).toBe(row.skill);
      expect(c.store.readProse(row.id).body).toContain(`Moved to a skill memory: ${String(row.skill)}.`);
      // Nothing else moved: the stories and the practice about honesty stand.
      expect(c.self.page()?.body).toBe(WRITTEN);
      // Through the door: a question about the work finds the skill.
      const s = new McpServer({ counterpart: c, session: "s-next", scope: "/shop", registryDir: dir });
      const r = await s.call("recall", { session: "s-next", question: "how do I check a new glaze with a test tile and a control?", mode: "facts" });
      expect(r.isError ?? false).toBe(false);
      expect(JSON.stringify(sc(r))).toContain(String(row.skill));
    } finally {
      c.close();
    }
  });

  test("page split off: the reflection writes the whole page, and is told the mix, the test and the craft rule", async () => {
    await yesterday(true);
    const { reflect } = await night(false);
    expect(has(reflect, PAGE_STORIES_RULE)).toBe(true);
    expect(has(reflect, pageCraftRule("page.setDown"))).toBe(true);
  });
});

describe("PS1 on a store in the default form", () => {
  test("no story words and no head start; a nomination still leads, since the field is offered on every host", async () => {
    const { me, nominated, work } = await yesterday(false);
    const { writer, reflect } = await night(true);
    expect(writer).not.toContain(PAGE_STORIES_RULE);
    expect(writer).not.toContain("moved to a skill");
    expect(has(reflect, PAGE_STORIES_RULE)).toBe(false);
    const order = shownOrder(writer);
    expect(order[0]).toBe(nominated);
    expect(writer).toContain(NOMINATED_NOTE);
    // Without the head start the dozen is the strongest work: the memory about me is cut.
    expect(order).not.toContain(me);
    expect(order.slice(1).every((id) => work.includes(id))).toBe(true);
  });

  test("the head start is a weight on the order for me and us only, on an own-form store only", () => {
    expect(storyHeadStart("me", true)).toBe(PAGE_STORY_LIMITS.HEAD_START);
    expect(storyHeadStart("us", true)).toBe(PAGE_STORY_LIMITS.HEAD_START);
    for (const about of ["owner", "work", "world", null, undefined]) expect(storyHeadStart(about, true)).toBe(0);
    expect(storyHeadStart("me", false)).toBe(0);
  });
});
