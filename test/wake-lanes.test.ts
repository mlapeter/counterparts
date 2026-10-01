/**
 * THE WAKE'S LANES DO WHAT THEY WERE MEANT FOR (2026-10-01, lane 8).
 *
 * Craft is this directory's work, composed at delivery for the directory the
 * session opens in; Nearby is what is personal. Every memory here is invented
 * for the test.
 *
 * Hermetic: every test makes its own temp directory and removes it. The clock
 * is pinned and the zone is UTC.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import {
  FRAMING,
  SELF_TUNABLES,
  WORK_HERE_HEADING,
  excerptOf,
  isWorkMemory,
  readSentinel,
} from "../src/core/self/index.js";
import type { AboutMark } from "../src/core/store/index.js";
import type { Kind } from "../src/core/types.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import { toolSpec } from "../src/adapters/mcp/tools.js";
import { recordSession } from "../src/adapters/sessions.js";

const ZONE = "UTC";
const NOW = Date.UTC(2026, 9, 1, 15, 0);
const BUDGET = 9_000;

let root: string;
let storeDir: string;
let WORKSHOP: string;
let LIBRARY: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-wake-lanes-")));
  storeDir = join(root, "store");
  WORKSHOP = join(root, "workshop");
  LIBRARY = join(root, "library");
  mkdirSync(WORKSHOP, { recursive: true });
  mkdirSync(LIBRARY, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function counterpart(tunables?: Record<string, unknown>): Counterpart {
  const c = Counterpart.open({
    dir: storeDir,
    owner: true,
    now: () => NOW,
    timeZone: ZONE,
    ...(tunables === undefined ? {} : { selfTunables: tunables }),
  });
  open.push(c);
  return c;
}

function put(
  c: Counterpart,
  body: string,
  opts: { kind?: Kind; about?: AboutMark; scope?: string; title?: string; born?: number; meta?: Record<string, unknown> } = {},
): string {
  return c.store.put({
    type: "memory",
    kind: opts.kind ?? "fact",
    body,
    salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.about === undefined ? {} : { about: opts.about, aboutBy: "writer" as const }),
    ...(opts.scope === undefined ? {} : { origin: { scope: opts.scope } }),
    ...(opts.meta === undefined ? {} : { meta: opts.meta }),
    ...(opts.born === undefined ? {} : { physics: { birthDay: opts.born, lastUsedDay: opts.born } }),
  });
}

function wake(c: Counterpart, scope: string, budget = BUDGET): string {
  c.rebrief({ budgetBytes: budget, at: "2026-10-01" });
  return c.wake(budget, { date: "2026-10-01" }, { scope, session: "s-reader", exportsFrom: () => true }).text;
}

/** The lines under one heading, up to the next blank line. */
function under(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  if (at < 0) return [];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && (lines[i] ?? "").length > 0; i++) out.push(lines[i] as string);
  return out;
}

describe("what is work (self/work.ts#isWorkMemory)", () => {
  const base = { originScope: "/w", journal: false } as const;
  test("marked: work is work, any kind; the personal marks are not", () => {
    for (const kind of ["fact", "skill", "self", "person", "entity", "place"] as Kind[]) {
      expect(isWorkMemory({ ...base, about: "work", kind })).toBe(true);
    }
    for (const about of ["me", "us", "owner", "world"]) {
      expect(isWorkMemory({ ...base, about, kind: "fact" })).toBe(false);
      expect(isWorkMemory({ ...base, about, kind: "skill" })).toBe(false);
    }
  });

  test("unmarked: by kind — a skill is work; a fact, entity or place is work when it has a directory", () => {
    expect(isWorkMemory({ ...base, about: null, kind: "skill" })).toBe(true);
    expect(isWorkMemory({ about: null, kind: "skill", originScope: null, journal: false })).toBe(true);
    for (const kind of ["fact", "entity", "place"] as Kind[]) {
      expect(isWorkMemory({ ...base, about: null, kind })).toBe(true);
      expect(isWorkMemory({ about: null, kind, originScope: null, journal: false })).toBe(false);
      expect(isWorkMemory({ about: null, kind, originScope: "  ", journal: false })).toBe(false);
    }
    expect(isWorkMemory({ ...base, about: null, kind: "self" })).toBe(false);
    expect(isWorkMemory({ ...base, about: null, kind: "person" })).toBe(false);
  });

  test("a name scope is not a directory: an unmarked Desktop chat fact stays personal (review of #313)", () => {
    expect(isWorkMemory({ about: null, kind: "fact", originScope: "claude-desktop:", journal: false })).toBe(false);
    expect(isWorkMemory({ about: null, kind: "fact", originScope: "claude-desktop:proj", journal: false })).toBe(false);
    expect(isWorkMemory({ about: null, kind: "fact", originScope: "relative/dir", journal: false })).toBe(false);
    expect(isWorkMemory({ about: null, kind: "fact", originScope: "C:\\work\\proj", journal: false })).toBe(true);
    // A skill is how a job is done wherever it was written; marked work is work.
    expect(isWorkMemory({ about: null, kind: "skill", originScope: "claude-desktop:", journal: false })).toBe(true);
  });

  test("an unmarked person or self memory is personal wherever it was written", () => {
    for (const kind of ["person", "self"] as Kind[]) {
      expect(isWorkMemory({ about: null, kind, originScope: "/w", journal: false })).toBe(false);
    }
  });

  test("a journal copy is never work, whatever its mark", () => {
    expect(isWorkMemory({ ...base, about: "work", kind: "self", journal: true })).toBe(false);
  });
});

describe("Nearby is personal; work waits for its directory", () => {
  test("a work-marked memory and an unmarked fact from a directory leave Nearby; the personal ones stay", () => {
    const c = counterpart();
    put(c, "Dana's sister is moving to the coast in the spring.", { kind: "person", scope: WORKSHOP });
    put(c, "Lunch by the window was the best part of the week.", { scope: "claude-desktop:" });
    const work = put(c, "The parser rejects a trailing comma in the config file.", { about: "work", scope: WORKSHOP });
    const unmarked = put(c, "The build cache lives under the project's tmp folder.", { scope: WORKSHOP });
    const skill = put(c, "I run the narrow test file before the whole suite.", { kind: "skill" });
    put(c, "Dana likes a short answer first and the reasons after.", { about: "owner", scope: WORKSHOP });
    put(c, "The ferry stops running at nine in winter.");
    const text = wake(c, LIBRARY);
    const nearby = under(text, FRAMING.hints).join("\n");
    expect(nearby).toContain("Dana likes a short answer first");
    expect(nearby).toContain("The ferry stops running at nine");
    expect(nearby).toContain("sister is moving to the coast");
    expect(nearby).toContain("Lunch by the window");
    for (const id of [work, unmarked, skill]) expect(text).not.toContain(id);
    expect(text).not.toContain("trailing comma");
    expect(text).not.toContain("build cache");
    expect(text).not.toContain("narrow test file");
    // The stored bundle has no craft lane any more: it is composed per directory.
    expect(text).not.toContain(FRAMING.craft);
    expect(readSentinel(text).intact).toBe(true);
  });

  test("the switch off is the lanes as they were: skill above the warm floor is craft, a fact is Nearby", () => {
    const c = counterpart({ CRAFT_AT_DELIVERY: false });
    put(c, "The build cache lives under the project's tmp folder.", { scope: WORKSHOP, about: "work" });
    put(c, "I run the narrow test file before the whole suite.", { kind: "skill" });
    const text = wake(c, WORKSHOP);
    expect(under(text, FRAMING.craft).join("\n")).toContain("narrow test file");
    expect(under(text, FRAMING.hints).join("\n")).toContain("build cache");
    expect(text).not.toContain(WORK_HERE_HEADING);
  });
});

describe("the craft lane, composed at delivery for the session's directory", () => {
  test("a session in the workshop gets the workshop's work; one in the library does not", () => {
    const c = counterpart();
    const w1 = put(c, "The parser rejects a trailing comma in the config file.", { about: "work", scope: WORKSHOP, title: "Trailing commas" });
    const w2 = put(c, "I run the narrow test file before the whole suite.", { kind: "skill", scope: WORKSHOP });
    const lib = put(c, "The catalogue sorts by the second word of a title.", { about: "work", scope: LIBRARY });
    const here = wake(c, WORKSHOP);
    const lines = under(here, WORK_HERE_HEADING);
    expect(lines.length).toBe(2);
    expect(lines.join("\n")).toContain(w1);
    expect(lines.join("\n")).toContain(w2);
    expect(here).not.toContain(lib);
    // Title, an excerpt, and the id the recall tool expands.
    expect(lines.find((l) => l.includes(w1))).toMatch(/^- 20\d\d-\d\d-\d\d · Trailing commas — The parser rejects .*\(mem_[0-9a-f]+\)$/);
    const there = wake(c, LIBRARY);
    expect(under(there, WORK_HERE_HEADING)).toEqual([expect.stringContaining(lib)]);
    expect(there).not.toContain(w1);
  });

  test("newest first, then strength; at most WORK_HERE_MAX lines", () => {
    const c = counterpart();
    const ids: string[] = [];
    for (let i = 0; i < SELF_TUNABLES.WORK_HERE_MAX + 2; i++) {
      ids.push(put(c, `Workshop finding number ${String(i)}: the jig needs a shim on the left.`, { about: "work", scope: WORKSHOP, born: i }));
    }
    const lines = under(wake(c, WORKSHOP), WORK_HERE_HEADING);
    expect(lines.length).toBe(SELF_TUNABLES.WORK_HERE_MAX);
    const newestFirst = [...ids].reverse().slice(0, SELF_TUNABLES.WORK_HERE_MAX);
    lines.forEach((l, i) => expect(l).toContain(newestFirst[i] as string));
  });

  test("not a thread, not a reminder, not a journal copy, not confidential, not settled over — and never shown twice", () => {
    const c = counterpart();
    const shown = put(c, "The glue sets in twenty minutes at room temperature.", { about: "work", scope: WORKSHOP });
    const open = put(c, "Which clamp fits the long board is still an open question.", { about: "work", scope: WORKSHOP, meta: { unresolved: true } });
    const copy = put(c, "Chapter copy: a long day at the bench.", { about: "work", scope: WORKSHOP, kind: "self", meta: { episodeId: "epi_000000000001" } });
    const secret = put(c, "The supplier's account terms are private.", { about: "work", scope: WORKSHOP, meta: { confidential: true } });
    const text = wake(c, WORKSHOP);
    const lines = under(text, WORK_HERE_HEADING);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(shown);
    // The unresolved work memory is a thread, shown store-wide, once.
    expect(under(text, FRAMING.threads).join("\n")).toContain("Which clamp fits");
    expect(text.split(open).length - 1).toBeLessThanOrEqual(1);
    expect(text).not.toContain(copy);
    expect(text).not.toContain(secret);
    // No id anywhere in the bundle twice.
    const ids = text.match(/mem_[0-9a-f]{12}/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("it sits above Last here and the handoff, and gives way to them", () => {
    const c = counterpart();
    for (let i = 0; i < 4; i++) {
      put(c, `Workshop finding ${String(i)}: ${"the jig needs a shim on the left side, and the fence drifts. ".repeat(2)}`, { about: "work", scope: WORKSHOP, born: i });
    }
    c.writeHandoff("The cabinet doors are hung; the drawers still need runners.", { scope: WORKSHOP, session: "s-writer-0000" });
    const text = wake(c, WORKSHOP);
    const work = text.indexOf(WORK_HERE_HEADING);
    const handoff = text.indexOf("Where I left off");
    expect(work).toBeGreaterThan(0);
    expect(handoff).toBeGreaterThan(work);
    // A ceiling with room for the handoff and not for the work: the handoff stays.
    const full = c.wake(BUDGET, { date: "2026-10-01" }, { scope: WORKSHOP, session: "s-reader" });
    const workBytes = new TextEncoder().encode(`${[WORK_HERE_HEADING, ...under(full.text, WORK_HERE_HEADING)].join("\n")}\n\n`).length;
    const tight = full.bytes - workBytes + 10;
    const squeezed = c.wake(tight, { date: "2026-10-01" }, { scope: WORKSHOP, session: "s-reader" });
    expect(squeezed.bytes).toBeLessThanOrEqual(tight);
    expect(squeezed.text).toContain("Where I left off");
    expect(under(squeezed.text, WORK_HERE_HEADING).length).toBeLessThan(4);
    expect(readSentinel(squeezed.text).intact).toBe(true);
  });

  test("the boundary reserves the work lines' room, once there is work in a directory sessions open in", () => {
    const c = counterpart();
    const before = c.rebrief({ budgetBytes: BUDGET, at: "2026-10-01" }).composeBudget ?? 0;
    put(c, "The parser rejects a trailing comma in the config file.", { about: "work", scope: WORKSHOP });
    c.captureSpans({ session: "s-writer-0000", scope: WORKSHOP, turns: [{ role: "user", text: "the drawers, then the doors" }] });
    const after = c.rebrief({ budgetBytes: BUDGET, at: "2026-10-01" }).composeBudget ?? 0;
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThanOrEqual(BUDGET / 8);
  });
});

describe("the chapter tool takes an `about` mark, carried to the chapter's memory copy (item 2)", () => {
  const S = "d1d2d3d4-0000-4000-8000-00000000000d";

  function server(c: Counterpart, scope: string): McpServer {
    recordSession(storeDir, { sessionId: S, scope, phase: "start", at: NOW });
    return new McpServer({ counterpart: c, session: S, scope, owner: true, registryDir: storeDir, now: () => NOW });
  }

  function copyOf(c: Counterpart, episodeId: string): { id: string; about: string | null; by: string | null } {
    const ids = c.store.list({ type: "memory", archived: false, originRef: episodeId });
    expect(ids.length).toBe(1);
    const row = c.store.row(ids[0] as string);
    return { id: ids[0] as string, about: row?.about ?? null, by: row?.about_by ?? null };
  }

  test("work keeps the copy home; a later chapter's me replaces it at once and carries it into another directory's wake", async () => {
    const c = counterpart();
    const mcp = server(c, WORKSHOP);
    const first = await mcp.call("chapter", { session: S, title: "Hanging the cabinet doors", text: "I hung the cabinet doors and set the hinges by eye.", about: "work" });
    const out = first.structuredContent as Record<string, unknown>;
    expect(out["stored"]).toBe(true);
    expect(out["about"]).toBe("work");
    const epi = out["episodeId"] as string;
    c.ingestEpisode({ sessionId: S });
    expect(copyOf(c, epi)).toMatchObject({ about: "work", by: "writer" });
    expect(wake(c, LIBRARY)).not.toContain("About me, from another directory");

    const second = await mcp.call("chapter", { session: S, text: "Then I noticed I had been enjoying the quiet of the work.", about: "me" });
    expect((second.structuredContent as Record<string, unknown>)["about"]).toBe("me");
    // On the live copy at once, before any regrowth.
    expect(copyOf(c, epi).about).toBe("me");
    // Regrown with the second chapter's words, the copy keeps the mark.
    c.ingestEpisode({ sessionId: S });
    expect(copyOf(c, epi)).toMatchObject({ about: "me", by: "writer" });
    expect(wake(c, LIBRARY)).toContain("About me, from another directory");
  });

  test("a reflection's mark on the copy survives the copy regrowing", async () => {
    const c = counterpart();
    const mcp = server(c, WORKSHOP);
    const r = await mcp.call("chapter", { session: S, title: "Sanding", text: "I sanded the drawer fronts down to the grain." });
    const epi = (r.structuredContent as Record<string, unknown>)["episodeId"] as string;
    c.ingestEpisode({ sessionId: S });
    expect(copyOf(c, epi).about).toBeNull();
    c.store.setAbout(copyOf(c, epi).id, "us", { by: "reflection" });
    await mcp.call("chapter", { session: S, text: "And then we talked about what the shop is for." });
    c.ingestEpisode({ sessionId: S });
    expect(copyOf(c, epi)).toMatchObject({ about: "us", by: "reflection" });
  });

  test("a mark outside the five is refused before anything is written", async () => {
    const c = counterpart();
    const mcp = server(c, WORKSHOP);
    const r = await mcp.call("chapter", { session: S, text: "I hung the cabinet doors and set the hinges by eye.", about: "building" });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as Record<string, unknown>)["reason"]).toBe("about-malformed");
    expect(c.store.list({ type: "episode" })).toEqual([]);
  });

  test("the about field asks for owner or us on anything personal", () => {
    const about = (toolSpec("note")?.inputSchema as { properties: Record<string, { description: string }> }).properties["about"];
    expect(about?.description).toContain("Mark anything personal — people, feelings, life outside the work — owner or us");
    expect(about?.description).not.toContain("Leave it out when unsure");
  });

  test("the tool asks for it", () => {
    const about = (toolSpec("chapter")?.inputSchema as { properties: Record<string, { description: string; enum: string[] }> }).properties["about"];
    expect(about?.enum).toEqual(["me", "us", "owner", "work", "world"]);
    expect(about?.description).toContain("A session that was only building is work");
    expect(about?.description).toContain("people, feelings or life outside the work is owner or us");
  });
});

describe("the `unresolved` flag: set by note and session_end, closed by updates (item 3)", () => {
  const S = "e1e2e3e4-0000-4000-8000-00000000000e";

  function server(c: Counterpart): McpServer {
    recordSession(storeDir, { sessionId: S, scope: WORKSHOP, phase: "start", at: NOW });
    return new McpServer({ counterpart: c, session: S, scope: WORKSHOP, owner: true, registryDir: storeDir, now: () => NOW });
  }

  const flagged = (c: Counterpart, id: string): boolean => c.store.readProse(id).meta["unresolved"] === true;
  const stillOpen = (c: Counterpart): string => under(wake(c, LIBRARY), FRAMING.threads).join("\n");

  test("note sets it; the thread is under Still open; updates with unresolved: false closes it", async () => {
    const c = counterpart();
    const mcp = server(c);
    const r = await mcp.call("note", { text: "I promised to send Dana the cut list for the bookshelf by Friday.", unresolved: true });
    const id = (r.structuredContent as Record<string, unknown>)["id"] as string;
    expect(flagged(c, id)).toBe(true);
    expect(stillOpen(c)).toContain("the cut list for the bookshelf");

    // A revision that says nothing about the thread leaves it open.
    await mcp.call("note", { text: "The cut list for the bookshelf needs the shelf depth first.", updates: id, how: "open" });
    expect(flagged(c, id)).toBe(true);

    const done = await mcp.call("note", { text: "Sent Dana the cut list for the bookshelf on Thursday.", updates: id, unresolved: false, how: "open" });
    expect((done.structuredContent as Record<string, unknown>)["thread"]).toEqual({ closed: id });
    expect(flagged(c, id)).toBe(false);
    expect(stillOpen(c)).not.toContain("the cut list for the bookshelf");
  });

  test("a session_end entry sets it; `unresolved: true` on an update carries the thread to the newer memory", async () => {
    const c = counterpart();
    const mcp = server(c);
    const first = await mcp.call("session_end", { session: S, memories: [{ content: "Which finish to use on the walnut top is still an open question.", unresolved: true }] });
    const id = ((first.structuredContent as Record<string, unknown>)["outcomes"] as Record<string, unknown>[])[0]?.["id"] as string;
    expect(flagged(c, id)).toBe(true);
    const moved = await mcp.call("session_end", {
      session: S,
      memories: [{ content: "The walnut finish is down to oil or shellac; still to choose.", updates: id, how: "open", unresolved: true }],
    });
    const outcome = ((moved.structuredContent as Record<string, unknown>)["outcomes"] as Record<string, unknown>[])[0] ?? {};
    expect(outcome["thread"]).toEqual({ closed: id });
    expect(flagged(c, id)).toBe(false);
    expect(flagged(c, outcome["id"] as string)).toBe(true);
    const open = stillOpen(c);
    expect(open).toContain("oil or shellac");
    expect(open).not.toContain("Which finish to use");
  });

  test("how: changed with the answer closes it too, by settling", async () => {
    const c = counterpart();
    const mcp = server(c);
    const r = await mcp.call("note", { text: "Whether the shop lease renews in spring is still an open question.", unresolved: true });
    const id = (r.structuredContent as Record<string, unknown>)["id"] as string;
    await mcp.call("note", { text: "The shop lease renewed for two more years.", updates: id, how: "changed" });
    expect(stillOpen(c)).not.toContain("shop lease renews");
  });

  test("closing passes the revision step's checks first: protected, and — for a session not the owner's — confidential or another directory (review of #313)", async () => {
    const openThread = (c: Counterpart, body: string, opts: { scope?: string; meta?: Record<string, unknown>; protect?: boolean } = {}): string =>
      c.store.put({
        type: "memory",
        kind: "fact",
        body,
        salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
        meta: { unresolved: true, ...(opts.meta ?? {}) },
        origin: { scope: opts.scope ?? WORKSHOP },
        ...(opts.protect === true ? { physics: { protected: true } } : {}),
      });
    const close = async (c: Counterpart, id: string, scope = WORKSHOP): Promise<Record<string, unknown> | undefined> =>
      (await c.submitJot({ content: `Answered now: the question in ${id} is settled for good.`, updates: id, unresolved: false }, { session: "s-closer", scope })).thread as
        | Record<string, unknown>
        | undefined;

    const owner = counterpart();
    const guarded = openThread(owner, "Whether the bench gets a vise is an open question the owner protected.", { protect: true });
    expect(await close(owner, guarded)).toEqual({ from: guarded, closed: false, refused: "protected-refuses-revision" });
    expect(flagged(owner, guarded)).toBe(true);
    // The owner may close a confidential one, and one written elsewhere.
    const elsewhere = openThread(owner, "Whether the library extends its hours is an open question.", { scope: LIBRARY, meta: { confidential: true } });
    expect(await close(owner, elsewhere)).toEqual({ from: elsewhere, closed: true });
    owner.close();

    const guest = Counterpart.open({ dir: storeDir, owner: false, now: () => NOW, timeZone: ZONE });
    open.push(guest);
    const there = openThread(guest, "Whether the catalogue gets a second shelf is still open.", { scope: LIBRARY });
    expect(await close(guest, there, WORKSHOP)).toEqual({ from: there, closed: false, refused: "other-directory" });
    expect(flagged(guest, there)).toBe(true);
    const secret = openThread(guest, "Whether the supplier renews the private terms is still open.", { meta: { confidential: true } });
    expect(await close(guest, secret)).toEqual({ from: secret, closed: false, refused: "confidential" });
    const mine = openThread(guest, "Whether the shop opens on Saturdays is still an open question.");
    expect(await close(guest, mine)).toEqual({ from: mine, closed: true });
    expect(flagged(guest, mine)).toBe(false);
  });

  test("the lane is small: at most THREADS_MAX, person-scoped first, oldest first", () => {
    expect(SELF_TUNABLES.THREADS_MAX).toBe(5);
  });
});

describe("excerptOf", () => {
  test("whole when short; cut at a word with an ellipsis when long", () => {
    expect(excerptOf("short and sweet", 60)).toBe("short and sweet");
    const cut = excerptOf("one two three four five six seven eight nine ten", 20);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(21);
    expect(cut).toBe("one two three four…");
  });
});
