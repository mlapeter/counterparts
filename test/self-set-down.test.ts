/**
 * WHAT THE PAGE SETS DOWN (PG1, 2026-11-09; Mike's decision 11-07): a
 * nightly page write names what it takes out, the engine's sentence diff
 * catches what it did not name, each set-down line becomes a memory about me,
 * the next wake says it once, the night's writers are shown the ones life
 * touched since, and recall "set down" lists them.
 *
 * Two halves. THE DIFF, pure, on hand-built page pairs: the samples a
 * reviewer reads to judge "folded vs gone" (and `tools/set-down-diff.ts` runs
 * the same function on real pages). THE NIGHT, real path: `runNight` with a
 * stubbed claude in the seat whose children call the memory's MCP server as a
 * night child does — day's end through the dream tool's `writer` phase and
 * `self_page`, the reflection through the `reflect` tool — then the shaped
 * wake through `Counterpart#wake`, and the MCP `recall` handle.
 *
 * Hermetic: a fresh temp data dir per test, removed after; every word is
 * invented placeholder prose.
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
import { SELF_TUNABLES, pageWriterNight } from "../src/core/self/index.js";
import { SET_DOWN_BACK_EVENT, SET_DOWN_EVENT, SET_DOWN_META, SET_DOWN_TAG, UNNAMED_WHY, diffSetDowns, readSetDowns } from "../src/core/self/set-down.js";
import { WAKE_SHAPE_KEY } from "../src/core/self/tunables.js";

const S = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const SPLIT_WAS = S.PAGE_SPLIT;
const SESSION = "s-set-down";
const DAY_MS = 86_400_000;
const BUDGET = 9_000;
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-set-down-"));
  dir = join(root, "store");
  S.PAGE_SPLIT = true;
});

afterEach(() => {
  S.PAGE_SPLIT = SPLIT_WAS;
  rmSync(root, { recursive: true, force: true });
});

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;

function open(at: () => number = Date.now): Counterpart {
  return Counterpart.open({ dir, identity: { name: "Mike" }, now: at, timeZone: "UTC" });
}

// ── the diff, on hand-built pages: the reviewer's samples ───────────────────

describe("the sentence diff: reworded and folded are kept, the rest set down", () => {
  const BEFORE = [
    "## Lately",
    "",
    "Lately the work has been the night's children, one at a time.",
    "Before naming a cause, I check which build, folder or store is running.",
    "",
    "## How I work",
    "",
    "- Records drift: look, then fix the note.",
    "- Shape isn't a finishing step.",
    "- Ship when tested; provenance, not pacing, tells changes apart.",
    "- I read slowly, without a harvest, and say what I found.",
  ].join("\n");

  test("word for word kept: nothing; reworded: kept; split in two: kept", () => {
    const after = BEFORE.replace("- Ship when tested; provenance, not pacing, tells changes apart.", "- I ship once it's tested. Provenance, not pacing, tells the changes apart.");
    const d = diffSetDowns(BEFORE, after);
    expect(d.verdicts.map((v) => [v.outcome, v.line])).toEqual([["reworded", "Ship when tested; provenance, not pacing, tells changes apart."]]);
  });

  test("a line the writer names as folded is kept when its words are on the page across a short run; not found, it is set down anyway", () => {
    const folded = BEFORE.replace(
      "Lately the work has been the night's children, one at a time.\nBefore naming a cause, I check which build, folder or store is running.",
      "Lately the work has been the night's children, one at a time. On 10-09 a wrong build cost a whole day. Since then, before naming any cause, I check which folder, build or store is the one running.",
    );
    const named = [{ line: "Before naming a cause, I check which build, folder or store is running.", why: "folded into Lately's 10-09 story" }];
    const kept = diffSetDowns(BEFORE, folded, named);
    // Most of its words sit in one new sentence: kept, in the writer's word for it.
    expect(kept.verdicts.find((v) => v.line.startsWith("Before naming"))?.outcome).toBe("folded");
    expect(diffSetDowns(BEFORE, folded).verdicts.find((v) => v.line.startsWith("Before naming"))?.outcome).toBe("reworded");
    // A real fold across sentences: the words spread over three.
    const spread = BEFORE.replace(
      "Before naming a cause, I check which build, folder or store is running.",
      "On 10-09 the wrong build ran for a day, in the right-looking folder. I lost the day to it. Now I check first, then name the cause.",
    );
    const v = diffSetDowns(BEFORE, spread, named).verdicts.find((x) => x.line.startsWith("Before naming"));
    expect(v?.outcome).toBe("folded");
    expect(v?.share).toBeGreaterThanOrEqual(0.5);
    // Said folded, but gone: recorded, with what the writer said.
    const gone = BEFORE.replace("Before naming a cause, I check which build, folder or store is running.", "");
    const g = diffSetDowns(BEFORE, gone, named).verdicts.find((x) => x.line.startsWith("Before naming"));
    expect(g?.outcome).toBe("named");
    expect(g?.why).toContain("said folded, but not found on the page");
  });

  test("named with a why: set down with it; not named: set down unnamed; a named line still on the page matches nothing", () => {
    const after = BEFORE.replace("- Records drift: look, then fix the note.\n", "").replace("- Shape isn't a finishing step.\n", "");
    const d = diffSetDowns(BEFORE, after, [
      { line: "Records drift: look, then fix the note.", why: "no longer lived" },
      { line: "I read slowly, without a harvest, and say what I found.", why: "room" },
    ]);
    expect(d.verdicts.map((x) => [x.outcome, x.why])).toEqual([
      ["named", "no longer lived"],
      ["unnamed", UNNAMED_WHY],
    ]);
    expect(d.unmatchedNamed.map((n) => n.line)).toEqual(["I read slowly, without a harvest, and say what I found."]);
  });

  test("common page words are not a fold: a short rule whose words recur elsewhere on the page is still set down", () => {
    // "note", "look", "fix" all appear on the new page, spread over unrelated sentences.
    const after = [
      "## Lately",
      "",
      "Lately I look at the night's children one at a time, and I note what each one did.",
      "I fix the build first.",
      "",
      "## How I work",
      "",
      "- Ship when tested; provenance, not pacing, tells changes apart.",
    ].join("\n");
    const v = diffSetDowns(BEFORE, after).verdicts.find((x) => x.line.startsWith("Records drift"));
    expect(v?.outcome).toBe("unnamed");
    expect(v?.share).toBeLessThan(0.7);
  });

  test("an opening of the line names it, as a claim's does", () => {
    const after = BEFORE.replace("- I read slowly, without a harvest, and say what I found.\n", "").replace("- I read slowly, without a harvest, and say what I found.", "");
    const d = diffSetDowns(BEFORE, after, [{ line: "I read slowly, without a harvest", why: "no longer lived" }]);
    expect(d.verdicts.map((x) => [x.outcome, x.why])).toEqual([["named", "no longer lived"]]);
  });
});

// ── the night, real path ────────────────────────────────────────────────────

const PAGE = [
  "## Core",
  "",
  "I say what I do not know before I guess. I keep my word small and keep it.",
  "",
  "## Lately",
  "",
  "Lately the work has been the night's children, one at a time.",
  "Before naming a cause, I check which build, folder or store is running.",
  "",
  "## How I work",
  "",
  "- Records drift: look, then fix the note.",
  "- Shape isn't a finishing step.",
  "- I test through the real doors before I call a thing done.",
  "- Ship when tested; provenance, not pacing, tells changes apart.",
].join("\n");

/** Day's end's page: a fold, a rewording, a named drop and an unnamed one. */
const WRITER_PAGE = [
  "## Core",
  "",
  "I say what I do not know before I guess. I keep my word small and keep it.",
  "",
  "## Lately",
  "",
  "Lately the work has been the night's children, one at a time. On 10-09 a wrong build cost a day. The folder looked right. Now I check what is running before naming the cause.",
  "",
  "## How I work",
  "",
  "- I test through the real doors before I call a thing done.",
  "- I ship once it's tested; provenance, not pacing, tells the changes apart.",
].join("\n");

const WRITER_NAMED = [
  { line: "Records drift: look, then fix the note.", why: "no longer lived" },
  { line: "Before naming a cause, I check which build, folder or store is running.", why: "folded into Lately's 10-09 story" },
];

type Act = (ask: SeatAsk, s: McpServer, c: Counterpart) => Promise<void>;

function seat(acts: Partial<Record<SeatAct, Act>>, at: () => number): Seat<NightAnswer> {
  return {
    name: "test",
    async answer(ask) {
      const act = acts[ask.act];
      if (act !== undefined) {
        const c = open(at);
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

function night(s: Seat<NightAnswer>, run: string, at: () => number): ReturnType<typeof runNight> {
  return runNight({ open: () => open(at), config: { dataDir: dir }, now: at, run, session: SESSION, scope: "/proj", kind: { kind: "night" }, seat: s });
}

/** The page and a lived day before tonight, and the core memory the reflection cites. */
function setUp(at: () => number): { core: string } {
  const c = open(() => at() - DAY_MS);
  try {
    c.store.setMeta(WAKE_SHAPE_KEY, "on");
    c.revisePage(PAGE, { reason: "a first page", by: "owner" });
    const day = c.store.livedDay();
    const core = c.store.put({ type: "memory", kind: "self", body: "I say what I do not know before I guess; Mike asked for it.", salience: { relevance: 0.8, emotional: 0.4, predictive: 0.8 }, physics: { birthDay: day, lastUsedDay: day } });
    c.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday, at the zqbench.", learnedOn: pageWriterNight(c.store).about });
    return { core };
  } finally {
    c.close();
  }
}

/** The reflection's finish through the reflect tool: Core with one sentence named as set down. */
const reflectionAct =
  (core: string, page: string, setDown: readonly { line: string; why: string }[], seen?: string[]): Act =>
  async (_ask, s) => {
    const b = sc(await s.call("reflect", { phase: "begin", session: SESSION }));
    seen?.push(JSON.stringify(b));
    const id = String(b["reflection"]);
    for (let p = 2; p <= Number(b["of"] ?? 1); p += 1) seen?.push(JSON.stringify(sc(await s.call("reflect", { phase: "part", session: SESSION, reflection: id, part: p }))));
    const f = await s.call("reflect", { phase: "finish", session: SESSION, reflection: id, entry: "A night of small things.", cites: [core], page: { text: page, cites: [core], setDown } });
    expect(f.isError ?? false).toBe(false);
  };

describe("a night that rewrites the page", () => {
  test("named, unnamed and folded at day's end, named by the reflection: three memories about me, the next wake says it once, recall lists them", async () => {
    let now = Date.parse("2026-11-08T07:00:00Z");
    const at = (): number => now;
    const { core } = setUp(at);
    let block = "";
    let wrote: Record<string, unknown> = {};
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            const r = await s.call("dream", { phase: "writer", session: SESSION });
            block = String(sc(r)["read"]);
            wrote = sc(await s.call("self_page", { body: WRITER_PAGE, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"], setDown: WRITER_NAMED }));
          },
          reflection: reflectionAct(core, "## Core\n\nI say what I do not know before I guess.", [{ line: "I keep my word small and keep it.", why: "retired by the 11-01 publishing ruling" }]),
        },
        at,
      ),
      "nrn_set_down",
      at,
    );
    // Day's end was asked to name what it sets down, and its answer says what was recorded.
    expect(block).toContain("pass `setDown`");
    expect(wrote["stored"]).toBe(true);
    expect(String(wrote["setDown"])).toContain("Set down 2 lines (1 named, 1 not named");
    expect(String(wrote["setDown"])).toContain("2 gone word for word were found on the page reworded or folded");

    const c = open(at);
    try {
      const rows = readSetDowns(c.store);
      // Newest first: the reflection's, then day's end's two (the fold and the rewording are not set-downs).
      expect(rows.map((r) => `${r.by} ${String(r.named)} ${r.line}`).sort()).toEqual([
        "reflection true I keep my word small and keep it.",
        "writer false Shape isn't a finishing step.",
        "writer true Records drift: look, then fix the note.",
      ]);
      const drift = rows.find((r) => r.line.startsWith("Records drift"));
      if (drift === undefined) throw new Error("no set-down for Records drift");
      const row = c.store.row(drift.id);
      const doc = c.store.readProse(drift.id);
      expect(doc.title).toBe("Set down from my page 11-08: Records drift: look, then fix the note.");
      expect(doc.body.startsWith("Records drift: look, then fix the note.\n\n")).toBe(true);
      expect(doc.body).toContain("Why: no longer lived.");
      expect(row?.about).toBe("me");
      expect(row?.source).toBe("reflection");
      expect(c.store.tagsOf(drift.id).map((t) => t.tag)).toEqual([SET_DOWN_TAG]);
      expect(doc.meta["unresolved"]).toBeUndefined();
      const facts = doc.meta[SET_DOWN_META] as Record<string, unknown>;
      expect(facts["from"]).toBe(drift.from);
      expect(facts["section"]).toBe("How I work");
      expect(rows.find((r) => r.line.startsWith("Shape"))?.why).toBe(UNNAMED_WHY);
      expect(rows.find((r) => r.line.startsWith("I keep"))?.why).toBe("retired by the 11-01 publishing ruling");
      // The log carries counts and ids, never a line's words.
      const events = c.store.eventLog({ name: SET_DOWN_EVENT, sinceDay: 0, order: "asc", limit: 10 });
      expect(events).toHaveLength(2);
      for (const e of events) {
        expect(e.payload ?? "").not.toContain("Records drift");
        expect(e.payload ?? "").not.toContain("Shape isn't");
        expect(e.payload ?? "").not.toContain("keep my word");
      }
      expect(JSON.parse(events[0]?.payload ?? "{}")).toMatchObject({ by: "writer", named: 1, unnamed: 1, folded: 1, reworded: 1 });

      // The next morning's first wake, before its night: said once, with the line, and the door.
      now += DAY_MS;
      c.store.advanceClock(new Date(now).toISOString().slice(0, 10));
    } finally {
      c.close();
    }
    const m = open(at);
    try {
      const w = m.wake(BUDGET, { date: new Date(now).toISOString().slice(0, 10) }, { scope: "/proj", session: "s-morning" });
      expect(w.ok).toBe(true);
      const lines = w.text.split("\n").filter((l) => l.startsWith("Set down from my page last night:"));
      expect(lines).toEqual([`Set down from my page last night: "Records drift: look, then fix the note."; "Shape isn't a finishing step.", and 1 more (recall "set down")`]);
      // Told once: not again as news, nor anywhere else in the wake.
      expect(w.text.split("Records drift").length - 1).toBe(1);
      expect(w.text).not.toContain("Set down from my page 11-08");

      // recall "set down", through the MCP door: newest first, with why and date.
      const s = new McpServer({ counterpart: m, session: "s-morning", scope: "/proj", registryDir: dir });
      const r = sc(await s.call("recall", { handle: "set down" }));
      expect(r["total"]).toBe(3);
      const items = r["items"] as Record<string, unknown>[];
      expect(items[0]).toMatchObject({ line: "I keep my word small and keep it.", why: "retired by the 11-01 publishing ruling", date: "2026-11-08", named: true, section: "Core" });
      expect(items.find((i) => i["line"] === "Shape isn't a finishing step.")).toMatchObject({ named: false, why: UNNAMED_WHY });
    } finally {
      m.close();
    }
  });

  test("a quiet night (the page kept, a sentence only reworded): no memory, no event, no wake line", async () => {
    let now = Date.parse("2026-11-08T07:00:00Z");
    const at = (): number => now;
    const { core } = setUp(at);
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            const r = await s.call("dream", { phase: "writer", session: SESSION });
            await s.call("self_page", { body: PAGE.replace("- Ship when tested; provenance, not pacing, tells changes apart.", "- I ship once tested; provenance, not pacing, tells changes apart."), reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"] });
          },
          reflection: reflectionAct(core, "## Core\n\nI say what I do not know before I guess. I keep my word small and keep it.", []),
        },
        at,
      ),
      "nrn_quiet",
      at,
    );
    now += DAY_MS;
    const c = open(at);
    try {
      c.store.advanceClock(new Date(now).toISOString().slice(0, 10));
      expect(readSetDowns(c.store)).toEqual([]);
      // The rewording is counted on the event, and nothing is set down.
      const events = c.store.eventLog({ name: SET_DOWN_EVENT, sinceDay: 0, order: "asc", limit: 10 });
      expect(events.map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>).every((p) => (p["ids"] as unknown[]).length === 0)).toBe(true);
      const w = c.wake(BUDGET, { date: new Date(now).toISOString().slice(0, 10) }, { scope: "/proj", session: "s-morning" });
      expect(w.text).not.toContain("Set down from my page");
    } finally {
      c.close();
    }
  });

  test("the way back: a set-down life touched since is shown to day's end; brought back, it is said, and recall marks it on the page again; the next night's wake doesn't tell the old night's", async () => {
    let now = Date.parse("2026-11-08T07:00:00Z");
    const at = (): number => now;
    const { core } = setUp(at);
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            const r = await s.call("dream", { phase: "writer", session: SESSION });
            await s.call("self_page", { body: WRITER_PAGE, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"], setDown: WRITER_NAMED });
          },
          reflection: reflectionAct(core, "## Core\n\nI say what I do not know before I guess. I keep my word small and keep it.", []),
        },
        at,
      ),
      "nrn_first",
      at,
    );
    // The next day, life touches "Records drift": a newer memory says it again.
    now += DAY_MS;
    let driftId = "";
    {
      const c = open(at);
      try {
        c.store.advanceClock(new Date(now).toISOString().slice(0, 10));
        driftId = readSetDowns(c.store).find((r) => r.line.startsWith("Records drift"))?.id ?? "";
        expect(driftId).not.toBe("");
        const day = c.store.livedDay();
        c.store.put({ type: "memory", kind: "fact", body: "Records drift again today: I had to look, then fix the note on the zqbench.", learnedOn: new Date(now).toISOString().slice(0, 10), physics: { birthDay: day, lastUsedDay: day } });
        // Shape was recalled and used.
        const shape = readSetDowns(c.store).find((r) => r.line.startsWith("Shape"))?.id ?? "";
        c.store.updatePhysics(shape, { uses: 1, lastUsedDay: day });
      } finally {
        c.close();
      }
    }
    now += DAY_MS;
    let block = "";
    let wrote: Record<string, unknown> = {};
    const bundle: string[] = [];
    await night(
      seat(
        {
          writer: async (_ask, s) => {
            const r = await s.call("dream", { phase: "writer", session: SESSION });
            block = String(sc(r)["read"]);
            // Brought back, in its own words.
            wrote = sc(await s.call("self_page", { body: `${WRITER_PAGE}\n- Records drift: look, then fix the note.`, reason: "day's end", session: SESSION, ifVersion: sc(r)["ifVersion"] }));
          },
          reflection: reflectionAct(core, "## Core\n\nI say what I do not know before I guess. I keep my word small and keep it.", [], bundle),
        },
        at,
      ),
      "nrn_second",
      at,
    );
    // Day's end was shown both, with how life touched them.
    expect(block).toContain("Lines your page set down that life has touched since");
    expect(block).toContain(`${driftId} · set down 2026-11-08 (no longer lived); said again in mem_`);
    expect(block).toContain('used since: "Shape isn\'t a finishing step."');
    expect(String(wrote["setDown"])).toContain(`Brought back: ${driftId}.`);
    // The reflection is not handed set-downs as lived memories about me (core, candidates, felt):
    // a set-down from a section that isn't its lane (How I work) is not in its bundle at all.
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle.join("\n")).not.toContain("Shape isn't a finishing step");
    expect(bundle.join("\n")).not.toContain("Set down from my page");
    now += 60_000;
    const c = open(at);
    try {
      const back = c.store.eventLog({ name: SET_DOWN_BACK_EVENT, sinceDay: 0, order: "asc", limit: 10 });
      expect(back.map((e) => e.ref)).toEqual([driftId]);
      const s = new McpServer({ counterpart: c, session: "s-morning", scope: "/proj", registryDir: dir });
      const items = sc(await s.call("recall", { handle: "set down" }))["items"] as Record<string, unknown>[];
      expect(items.find((i) => i["id"] === driftId)?.["onPageAgain"]).toBe(true);
      // This morning's wake, a while after the night began: the newest night set nothing down, so the 11-08 night's lines are not told again.
      const w = c.wake(BUDGET, { date: new Date(now).toISOString().slice(0, 10) }, { scope: "/proj", session: "s-morning" });
      expect(w.text).not.toContain("Set down from my page");
    } finally {
      c.close();
    }
  });

  test("a page held past its room and kept at the run's end still names what it set down", () => {
    const c = open();
    try {
      c.revisePage(PAGE, { reason: "first", by: "owner" });
      const room = SELF_TUNABLES.PAGE_ROOM_BYTES;
      const long = WRITER_PAGE.replace("## How I work", `## How I work\n\n${"Small things, one after another, every day. ".repeat(Math.ceil(room / 40))}`);
      const held = c.revisePage(long, { by: "writer", reason: "the night", session: SESSION, setDown: WRITER_NAMED });
      expect(held.reason).toBe("past-room");
      expect(readSetDowns(c.store)).toEqual([]);
      const kept = c.self.keepHeldPage();
      expect(kept?.written).toBe(true);
      const rows = readSetDowns(c.store);
      expect(rows.find((r) => r.line.startsWith("Records drift"))).toMatchObject({ named: true, why: "no longer lived", by: "writer" });
      expect(rows.find((r) => r.line.startsWith("Shape"))).toMatchObject({ named: false, why: UNNAMED_WHY });
    } finally {
      c.close();
    }
  });

  test("an owner's or a session's own edit is theirs: nothing is recorded", () => {
    const c = open();
    try {
      c.revisePage(PAGE, { reason: "first", by: "owner" });
      c.revisePage(WRITER_PAGE, { reason: "the owner trimmed it", by: "owner" });
      c.revisePage(PAGE, { reason: "a session", by: "session" });
      c.revisePage(WRITER_PAGE, { reason: "a session trimmed it", by: "session" });
      expect(readSetDowns(c.store)).toEqual([]);
      expect(c.store.eventLog({ name: SET_DOWN_EVENT, sinceDay: 0, order: "asc", limit: 10 })).toEqual([]);
    } finally {
      c.close();
    }
  });
});
