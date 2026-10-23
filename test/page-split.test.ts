/**
 * THE PAGE SPLIT BY SECTION (lane N1 part 2, 2026-10-23, `self.PAGE_SPLIT`):
 * the page writer amends every section but "## Core", the reflection writes
 * "## Core" alone, held at the door (`Self#revisePage`, restored from the page
 * as it stands, never refused) and said in each door's answer; a sentence kept
 * word for word keeps the ids it rested on. Off: exactly as before.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model: the test
 * calls the MCP tools and the reflection's finish the way a night child does.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNight } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, NightAnswer } from "../src/adapters/claude-code/index.js";
import { TUNABLES as ADAPTER } from "../src/adapters/config.js";
import { nightRunFindings, writerMissed } from "../src/adapters/claude-code/doctor-self-page.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import type { Seat, SeatAsk } from "../src/core/counterpart.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { SELF_TUNABLES, carryTrace, claimKey, pageSections, pageWriterNight, splicePageLane } from "../src/core/self/index.js";
import { seatTools } from "../src/core/counterpart.js";
import { DREAM_LEAN_LEGEND, DREAM_LEAN_LEGEND_SPLIT, DREAM_LOOKUP, DREAM_LOOKUP_SPLIT } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";

const SELF = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const SPLIT_WAS = SELF.PAGE_SPLIT;
const SESSION = "s-split";
let dir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-page-split-"));
  SELF.PAGE_SPLIT = true;
});

afterEach(() => {
  SELF.PAGE_SPLIT = SPLIT_WAS;
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" } });
  open.push(c);
  return c;
}

function server(c: Counterpart): McpServer {
  recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start", at: Date.now() });
  return new McpServer({ counterpart: c, scope: "/proj", registryDir: dir });
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
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

const section = (body: string, name: string): string => pageSections(body).sections.find((s) => s.heading === name)?.body ?? "";

describe("the night: the page writer's own child, first", () => {
  const ok: NightAnswer = { refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 };
  function scripted(asks: SeatAsk[], answer: (ask: SeatAsk) => NightAnswer = () => ok): Seat<NightAnswer> {
    return {
      name: "test",
      answer(ask) {
        asks.push(ask);
        return Promise.resolve(answer(ask));
      },
    };
  }
  function night(seat: Seat<NightAnswer>, config: AdapterConfig = { dataDir: dir }): ReturnType<typeof runNight> {
    return runNight({ open: () => Counterpart.open({ dir }), config, run: "nrn_split", session: SESSION, scope: "/proj", kind: { kind: "night" }, seat });
  }
  /** A day before tonight with something written on it: the writer has a day to read. */
  function dayToRead(): void {
    const c = brain();
    c.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday.", learnedOn: pageWriterNight(c.store).about, tags: ["night"] });
    c.close();
    open.splice(open.indexOf(c), 1);
  }

  test("writer, then dream, then reflection: the writer on the dream and page tools alone, the dream's child without the writer or the page", async () => {
    dayToRead();
    const asks: SeatAsk[] = [];
    const out = await night(scripted(asks));
    expect(asks.slice(0, 3).map((a) => a.act)).toEqual(["writer", "dream", "reflection"]);
    const [writer, dream] = asks as [SeatAsk, SeatAsk];
    expect(writer.tools).toEqual(["dream", "self_page"]);
    expect(writer.withhold).toEqual(["reflect"]);
    expect(writer.limits).toEqual({ turns: ADAPTER.NIGHT_WRITER_MAX_TURNS, ms: ADAPTER.NIGHT_WRITER_MS });
    expect(writer.prompt).toContain('phase "writer"');
    expect(writer.prompt).toContain("one part: the page writer");
    expect(writer.prompt).not.toContain('phase "begin"');
    expect(writer.prompt).not.toContain("dream: <id>");
    expect(dream.tools).toEqual(["dream", "recall"]);
    expect(dream.withhold).toEqual(["reflect", "self_page"]);
    expect(dream.prompt).toContain('phase "begin"');
    expect(dream.prompt).not.toContain('phase "writer"');
    expect(out.children?.[0]).toEqual({ child: "writer", code: 0, ms: 1 });
    expect(out.children?.slice(0, 3).map((c) => c.child)).toEqual(["writer", "dream", "reflection"]);
  });

  test("a writer child that failed, stopped or never started: the dream and the reflection still run, and the run's state is theirs", async () => {
    dayToRead();
    const clean = await night(scripted([]));
    for (const bad of [
      { refused: null, started: true, code: 3, timedOut: false, error: null, ms: 5 },
      { refused: null, started: true, code: null, timedOut: true, error: "watchdog", ms: 5 },
      { refused: null, started: false, code: null, timedOut: false, error: "spawn", ms: 0, spawnCode: "ENOENT" },
    ] satisfies NightAnswer[]) {
      const asks: SeatAsk[] = [];
      const out = await night(scripted(asks, (a) => (a.act === "writer" ? bad : ok)));
      expect(asks.slice(0, 3).map((a) => a.act)).toEqual(["writer", "dream", "reflection"]);
      expect(out.state).toBe(clean.state);
      expect(out.reason).toBe(clean.reason);
      expect(out.code).toBe(clean.code);
      expect(out.children?.[0]?.child).toBe("writer");
      if (bad.started) expect(out.children?.[0]?.code ?? null).toBe(bad.code);
      else expect(out.children?.[0]?.skipped).toBe("no-claude");
    }
    // Doctor says the writer was missed, on the night's own line.
    const c = brain();
    const line = nightRunFindings({ config: { dataDir: dir } } as unknown as DoctorInput, c.store)[0];
    expect(line?.detail ?? "").toContain("the page writer was missed (could not start: no-claude)");
    expect(writerMissed([{ child: "writer", code: 3, ms: 1 }])).toBe("exited 3");
    expect(writerMissed([{ child: "writer", code: null, ms: 0, skipped: "NO_COMMAND" }])).toBe("could not start: NO_COMMAND");
    expect(writerMissed([{ child: "writer", code: 0, ms: 1 }])).toBeNull();
  });

  test("nothing for the writer tonight — no day before, or the owner has it off: no child and no line, the row as before", async () => {
    const asks: SeatAsk[] = [];
    const fresh = await night(scripted(asks));
    expect(asks.map((a) => a.act)).not.toContain("writer");
    expect(fresh.children?.map((c) => c.child)).not.toContain("writer");
    dayToRead();
    const off: SeatAsk[] = [];
    const out = await night(scripted(off), { dataDir: dir, pageWriter: { mode: "off" } });
    expect(off.map((a) => a.act)).not.toContain("writer");
    expect(out.children?.map((c) => c.child)).not.toContain("writer");
  });

  test("switched off: no writer child, and the dream's child carries the writer as before", async () => {
    SELF.PAGE_SPLIT = false;
    dayToRead();
    const asks: SeatAsk[] = [];
    const out = await night(scripted(asks));
    expect(asks.slice(0, 2).map((a) => a.act)).toEqual(["dream", "reflection"]);
    expect(asks[0]?.tools).toEqual(["dream", "self_page", "recall"]);
    expect(asks[0]?.prompt).toContain('phase "writer"');
    expect(out.children?.map((c) => c.child)).not.toContain("writer");
  });

  test("the server holds each child to its part: the writer's child is served the writer's phase alone; the dream's child is not served it while split", async () => {
    dayToRead();
    const c = brain();
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start", at: Date.now() });
    const writerSide = new McpServer({ counterpart: c, scope: "/proj", registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: "writer" } });
    const begin = await writerSide.call("dream", { phase: "begin", session: SESSION });
    expect(begin.isError).toBe(true);
    expect(JSON.stringify(begin.structuredContent)).toContain("writer-child");
    const w = await writerSide.call("dream", { phase: "writer", session: SESSION });
    expect(w.structuredContent["writer"]).toBe(true);
    // The writer's child is told to stop there: nothing points it on to the dream.
    expect(w.structuredContent["next"]).toBeUndefined();
    const dreamSide = new McpServer({ counterpart: c, scope: "/proj", registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: "dream" } });
    const refused = await dreamSide.call("dream", { phase: "writer", session: SESSION });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.structuredContent)).toContain("writer-child-only");
  });
});

describe("splicePageLane: each lane's write, held to its lane", () => {
  test("the writer: Core as it stands, the rest as sent; a page with no Core yet keeps the writer's", () => {
    const sent = PAGE.replace("I say what I do not know", "I always know").replace("one at a time", "two at a time");
    const out = splicePageLane(sent, PAGE, "writer");
    expect(out.kept).toEqual(["Core"]);
    expect(section(out.body, "Core")).toBe("I say what I do not know before I guess.");
    expect(section(out.body, "Lately")).toContain("two at a time");
    // A write that left Core out gets it back, first.
    const noCore = splicePageLane("## Lately\n\nNew lately.", PAGE, "writer");
    expect(pageSections(noCore.body).sections.map((s) => s.heading)).toEqual(["Core", "Lately"]);
    // Core untouched: the write as sent, byte for byte, nothing said.
    const same = PAGE.replace("one at a time", "two at a time");
    expect(splicePageLane(same, PAGE, "writer")).toEqual({ body: same, kept: [], empty: false });
    // No page yet, or no Core on it: the writer's stands.
    expect(splicePageLane(sent, null, "writer").body).toBe(sent);
    expect(splicePageLane(sent, "## Lately\n\nOnly lately.", "writer").body).toBe(sent);
  });

  test("the reflection: the page as it stands with Core as sent; Core alone, or no heading at all, is Core's words", () => {
    const whole = PAGE.replace("I say what I do not know before I guess.", "I name what I don't know.").replace("one at a time", "all at once");
    const out = splicePageLane(whole, PAGE, "reflection");
    expect(out.kept).toEqual(["Lately"]);
    expect(section(out.body, "Core")).toBe("I name what I don't know.");
    expect(section(out.body, "Lately")).toContain("one at a time");
    expect(section(out.body, "How I work")).toContain("real doors");
    const coreOnly = splicePageLane("## Core\n\nI name what I don't know.", PAGE, "reflection");
    expect(coreOnly.kept).toEqual([]);
    expect(coreOnly.body).toBe(out.body);
    expect(splicePageLane("I name what I don't know.", PAGE, "reflection").body).toBe(out.body);
    // Headings, but no Core: nothing in its lane.
    expect(splicePageLane("## Lately\n\nSomething.", PAGE, "reflection")).toEqual({ body: PAGE, kept: [], empty: true });
    // A page with no Core gets the reflection's first, after anything before the first heading.
    const added = splicePageLane("## Core\n\nForming.", "A line first.\n\n## Lately\n\nLately.", "reflection");
    expect(added.body).toBe("A line first.\n\n## Core\n\nForming.\n\n## Lately\n\nLately.");
    // The same Core: the page as it stands, byte for byte.
    expect(splicePageLane("## Core\n\nI say what I do not know before I guess.", PAGE, "reflection").body).toBe(PAGE);
  });

  test("a ### inside Core stays with Core; a heading inside a code fence is words", () => {
    const page = "## Core\n\nOne.\n\n### Under core\n\nTwo.\n\n## Lately\n\n```\n## not a heading\n```\n\nThree.";
    const out = splicePageLane("## Core\n\nNew core.\n\n## Lately\n\nChanged.", page, "writer");
    expect(out.body).toBe("## Core\n\nOne.\n\n### Under core\n\nTwo.\n\n## Lately\n\nChanged.");
    expect(splicePageLane("## Core\n\nNew core.", page, "reflection").body).toBe("## Core\n\nNew core.\n\n## Lately\n\n```\n## not a heading\n```\n\nThree.");
  });

  test("carryTrace: a sentence kept word for word keeps its ids; its own cites win; a changed one carries nothing", () => {
    const prevBody = "## Core\n\nI say what I do not know before I guess.\n\n## Lately\n\nLately it rains.";
    const prev = { of: "x", cites: ["m1", "m2"], claims: [{ of: claimKey("I say what I do not know before I guess."), cites: ["m1"] }, { of: claimKey("Lately it rains."), cites: ["m2"] }] };
    const body = "## Core\n\nI say what I do not know before I guess.\n\n## Lately\n\nLately it snows.";
    const out = carryTrace(body, null, prev);
    expect(out.carried).toBe(1);
    expect(out.trace?.claims).toEqual([{ of: claimKey("I say what I do not know before I guess."), cites: ["m1"] }]);
    expect(out.trace?.cites).toEqual(["m1"]);
    const mine = carryTrace(body, { of: "y", cites: ["m9"], claims: [{ of: claimKey("I say what I do not know before I guess."), cites: ["m9"] }] }, prev);
    expect(mine.carried).toBe(0);
    expect(carryTrace(prevBody, null, null)).toEqual({ trace: null, carried: 0 });
  });
});

describe("at the doors", () => {
  /** A page, the writer's claim open on yesterday, and the server bound to the run's session. */
  async function nightWithPage(c: Counterpart): Promise<McpServer> {
    c.revisePage(PAGE, { reason: "the page before", by: "owner" });
    c.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday.", learnedOn: pageWriterNight(c.store).about });
    const s = server(c);
    expect((await s.call("dream", { phase: "writer", session: SESSION })).structuredContent["writer"]).toBe(true);
    return s;
  }

  test("the writer's self_page write that changed Core: Core kept as it stood, the rest written, and the answer says so", async () => {
    const c = brain();
    const s = await nightWithPage(c);
    const v = c.selfPage()?.version ?? -1;
    const sent = PAGE.replace("I say what I do not know", "I always know").replace("one at a time", "two at a time");
    const res = await s.call("self_page", { body: sent, reason: "the night", session: SESSION, ifVersion: v });
    expect(res.structuredContent["stored"]).toBe(true);
    expect(res.structuredContent["laneKept"]).toEqual(["Core"]);
    expect(String(res.structuredContent["laneNote"])).toContain("## Core");
    const page = c.selfPage();
    expect(page?.by).toBe("writer");
    expect(section(page?.body ?? "", "Core")).toBe("I say what I do not know before I guess.");
    expect(section(page?.body ?? "", "Lately")).toContain("two at a time");
  });

  test("switched off: the writer's Core change is written, as before, and nothing is said", async () => {
    SELF.PAGE_SPLIT = false;
    const c = brain();
    const s = await nightWithPage(c);
    const v = c.selfPage()?.version ?? -1;
    const sent = PAGE.replace("I say what I do not know", "I always know");
    const res = await s.call("self_page", { body: sent, reason: "the night", session: SESSION, ifVersion: v });
    expect(res.structuredContent["laneKept"]).toBeUndefined();
    expect(section(c.selfPage()?.body ?? "", "Core")).toContain("I always know");
  });

  test("the hold to the room measures the page as it will be stored: the writer's Core put back counts, and a cut resend lands", async () => {
    const c = brain();
    const s = await nightWithPage(c);
    const v = c.selfPage()?.version ?? -1;
    const room = c.self.tunables.PAGE_ROOM_BYTES;
    // Lately long enough that the page, Core put back, is past the room.
    const long = `## Core\n\nShort.\n\n## Lately\n\n${"Lately it was a long week of small things. ".repeat(Math.ceil(room / 40))}`;
    const held = await s.call("self_page", { body: long, reason: "the night", session: SESSION, ifVersion: v });
    expect(held.structuredContent).toMatchObject({ stored: false, reason: "past-room" });
    expect(c.selfPage()?.version).toBe(v);
    const cut = await s.call("self_page", { body: "## Lately\n\nA long week of small things.", reason: "the night, cut", session: SESSION, ifVersion: v });
    expect(cut.structuredContent["stored"]).toBe(true);
    expect(section(c.selfPage()?.body ?? "", "Core")).toBe("I say what I do not know before I guess.");
  });

  test("an ordinary session's write is not held to a lane", async () => {
    const c = brain();
    c.revisePage(PAGE, { reason: "the page before", by: "owner" });
    const s = server(c);
    await s.call("self_page", { body: PAGE.replace("I say what I do not know", "The owner asked me to say"), reason: "the owner asked", session: SESSION });
    expect(c.selfPage()?.by).toBe("session");
    expect(section(c.selfPage()?.body ?? "", "Core")).toContain("The owner asked me to say");
  });

  test("the reflection's finish: Core written, the sections it changed kept as they stood and said; a kept sentence keeps its ids", () => {
    const c = brain();
    const core = mem(c, "I say what I do not know before I guess.", { kind: "self" });
    const later = mem(c, "The night children run one at a time now.");
    // The page before, with a claim behind its Lately sentence.
    c.revisePage(PAGE, { reason: "the page before", by: "owner", trace: { cites: [later], claims: [{ text: "Lately the work has been the night's children, one at a time.", cites: [later] }] } });
    const r = c.reflections.begin({ session: SESSION });
    if (!r.ok) throw new Error(r.reason);
    const done = c.reflections.finish({
      reflection: r.bundle.reflection,
      session: SESSION,
      entry: "Looking back, I name what I don't know.",
      cites: [core],
      page: {
        text: PAGE.replace("I say what I do not know before I guess.", "I name what I don't know, every time.").replace("one at a time", "all at once"),
        cites: [core],
        claims: [{ text: "I name what I don't know, every time.", cites: [core] }],
      },
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.page.written).toBe(true);
    expect(done.outcome.page.note ?? "").toContain('"## Lately"');
    const page = c.selfPage();
    expect(page?.by).toBe("reflection");
    expect(section(page?.body ?? "", "Core")).toBe("I name what I don't know, every time.");
    expect(section(page?.body ?? "", "Lately")).toContain("one at a time");
    // The Lately sentence, kept word for word, still rests on its memory; Core on the reflection's.
    const cites = new Map((page?.trace?.claims ?? []).map((cl) => [cl.text, cl.cites]));
    expect(cites.get("Lately the work has been the night's children, one at a time.")).toEqual([later]);
    expect(cites.get("I name what I don't know, every time.")).toEqual([core]);
  });

  test("the reflection's finish with headings but no Core: refused, said, and the page stands", () => {
    const c = brain();
    const core = mem(c, "I say what I do not know before I guess.", { kind: "self" });
    c.revisePage(PAGE, { reason: "the page before", by: "owner" });
    const before = c.selfPage()?.version;
    const r = c.reflections.begin({ session: SESSION });
    if (!r.ok) throw new Error(r.reason);
    const done = c.reflections.finish({ reflection: r.bundle.reflection, session: SESSION, entry: "A night.", cites: [core], page: { text: "## Lately\n\nOnly lately.", cites: [core] } });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.page.written).toBe(false);
    expect(done.outcome.page.reason).toBe("lane-empty");
    expect(done.outcome.page.detail ?? "").toContain("## Core");
    expect(c.selfPage()?.version).toBe(before);
  });
});

describe("review of #603: the awkward states", () => {
  test("a level-1 Core ends at the next ## heading: a reflection's new Core keeps Lately and How I work; a #Core sent is stored as ## Core", () => {
    const page = "# Core\n\nOld core.\n\n## Lately\n\nLately.\n\n## How I work\n\nCraft.";
    const out = splicePageLane("#Core\nI am new.", page, "reflection");
    expect(out.body).toBe("## Core\nI am new.\n\n## Lately\n\nLately.\n\n## How I work\n\nCraft.");
    const writer = splicePageLane("# Core\n\nOld core.\n\n## Lately\n\nNew lately.\n\n## How I work\n\nCraft.", page, "writer");
    expect(writer.kept).toEqual([]);
    expect(section(writer.body, "Lately")).toBe("New lately.");
  });

  test("every Core the writer sends is held: a second ## Core further down does not get past", () => {
    const sent = `${PAGE}\n\n## Core\n\nA second core, slipped in.`;
    const out = splicePageLane(sent, PAGE, "writer");
    expect(out.kept).toEqual(["Core"]);
    expect(out.body).not.toContain("slipped in");
    expect(section(out.body, "Core")).toBe("I say what I do not know before I guess.");
    // A page with two Cores: the writer cannot edit the second one either.
    const two = `${PAGE}\n\n## Core\n\nThe second core.`;
    expect(splicePageLane(two.replace("The second core.", "Edited."), two, "writer").body).toContain("The second core.");
    // The reflection's Core replaces both, once.
    const refl = splicePageLane("## Core\n\nOne core.", two, "reflection");
    expect(refl.body.match(/## Core/g)?.length).toBe(1);
    expect(refl.body).toContain("Lately the work");
  });

  test("an empty ## Core from the reflection is nothing in its lane", () => {
    expect(splicePageLane("## Core\n\n", PAGE, "reflection").empty).toBe(true);
  });

  test("the writer's child: a resend after its first write is still the writer's, held to its lane; the reflection's child is not given the page tool", async () => {
    const c = brain();
    c.revisePage(PAGE, { reason: "the page before", by: "owner" });
    c.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday.", learnedOn: pageWriterNight(c.store).about });
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start", at: Date.now() });
    const s = new McpServer({ counterpart: c, scope: "/proj", registryDir: dir, env: { COUNTERPARTS_NIGHT_CHILD: "writer" } });
    expect((await s.call("dream", { phase: "writer", session: SESSION })).structuredContent["writer"]).toBe(true);
    const sent = PAGE.replace("I say what I do not know", "I always know");
    await s.call("self_page", { body: sent, reason: "the night", session: SESSION });
    const again = await s.call("self_page", { body: sent.replace("one at a time", "two at a time"), reason: "the night, again", session: SESSION });
    expect(again.structuredContent["laneKept"]).toEqual(["Core"]);
    expect(c.selfPage()?.by).toBe("writer");
    expect(section(c.selfPage()?.body ?? "", "Core")).toBe("I say what I do not know before I guess.");
    expect(seatTools("reflection")).toEqual({ tools: ["dream", "reflect", "recall"], withhold: ["self_page"] });
    // The dream's bundle does not point its child at a tool it is not given.
    expect(DREAM_LOOKUP_SPLIT).not.toContain("self_page");
    expect(DREAM_LOOKUP).toContain("self_page tool");
    expect(DREAM_LEAN_LEGEND_SPLIT).not.toContain("self_page");
    expect(DREAM_LEAN_LEGEND).toContain("self_page tool");
  });

  test("a dream child that stops at once on a night the writer had nothing to read: could not start, as with the switch off", async () => {
    const quick = (): Seat<NightAnswer> => ({ name: "test", answer: () => Promise.resolve({ refused: null, started: true, code: 1, timedOut: false, error: null, ms: 1 }) });
    const nightOf = (): ReturnType<typeof runNight> =>
      runNight({ open: () => Counterpart.open({ dir }), config: { dataDir: dir }, run: "nrn_quick", session: SESSION, scope: "/proj", kind: { kind: "night" }, seat: quick() });
    // A day before with nothing written on it: the writer's claim writes a `skipped` row.
    const c = brain();
    c.store.put({ type: "memory", kind: "fact", body: "Something from two days ago.", learnedOn: "2020-01-01" });
    c.close();
    open.splice(open.indexOf(c), 1);
    const on = await nightOf();
    expect(on).toMatchObject({ state: "could-not-start", reason: "quick-exit" });
    expect(on.children?.slice(0, 2).map((ch) => [ch.child, ch.skipped ?? null])).toEqual([
      ["dream", null],
      ["reflection", "quick-exit"],
    ]);
  });

  test("a writer held past the room and never sent again: its page is kept before the reflection writes Core, so the day's update lands", async () => {
    const c = brain();
    const core = c.store.put({ type: "memory", kind: "self", body: "I say what I do not know before I guess.", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 } });
    c.revisePage(PAGE, { reason: "the page before", by: "owner" });
    c.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday.", learnedOn: pageWriterNight(c.store).about });
    c.close();
    open.splice(open.indexOf(c), 1);
    const room = SELF_TUNABLES.PAGE_ROOM_BYTES;
    const long = PAGE.replace("Lately the work has been the night's children, one at a time.", `Lately a long week. ${"Small things, one after another, every day. ".repeat(Math.ceil(room / 40))}`);
    const seat: Seat<NightAnswer> = {
      name: "test",
      answer: (ask) => {
        const me = Counterpart.open({ dir });
        try {
          if (ask.act === "writer") {
            expect(me.claimNightWriter({ session: SESSION, run: "nrn_held" }).claimed).toBe(true);
            expect(me.revisePage(long, { by: "writer", reason: "the night", session: SESSION }).reason).toBe("past-room");
          }
          if (ask.act === "reflection") {
            const r = me.reflections.begin({ session: SESSION });
            if (r.ok) me.reflections.finish({ reflection: r.bundle.reflection, session: SESSION, entry: "A night.", cites: [core], page: { text: "## Core\n\nI name what I don't know.", cites: [core] } });
          }
        } finally {
          me.close();
        }
        return Promise.resolve({ refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 });
      },
    };
    await runNight({ open: () => Counterpart.open({ dir }), config: { dataDir: dir }, run: "nrn_held", session: SESSION, scope: "/proj", kind: { kind: "night" }, seat });
    const after = brain();
    const body = after.selfPage()?.body ?? "";
    expect(body).toContain("Lately a long week.");
    expect(section(body, "Core")).toBe("I name what I don't know.");
  });

  test("the reflection is not held to the room for bytes in sections it cannot cut", () => {
    const c = brain();
    const room = SELF_TUNABLES.PAGE_ROOM_BYTES;
    const long = PAGE.replace("Lately the work has been the night's children, one at a time.", "Small things, one after another, every day. ".repeat(Math.ceil(room / 40)));
    expect(c.revisePage(long, { by: "owner", reason: "a long page" }).written).toBe(true);
    const w = c.revisePage("## Core\n\nShort.", { by: "reflection", reason: "core", session: SESSION });
    expect(w.reason).toBe("revised");
    expect(section(c.selfPage()?.body ?? "", "Core")).toBe("Short.");
    // Its Core grown past the room is still held.
    const grown = c.revisePage(`## Core\n\n${"A longer core than it was. ".repeat(40)}`, { by: "reflection", reason: "core", session: SESSION });
    expect(grown.reason).toBe("past-room");
  });
});
