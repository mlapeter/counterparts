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

import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { SELF_TUNABLES, carryTrace, claimKey, pageSections, pageWriterNight, splicePageLane } from "../src/core/self/index.js";
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
