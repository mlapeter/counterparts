/**
 * THE WAKE'S ROOM (WK1, 2026-10-30): "Might be relevant" off, no bare ids, one
 * "where this folder stands" block with the newest handoff's lead at up to five
 * lines and each other live handoff one line. Through the doors: the real
 * session-start hook's adapter, and the MCP recall handles the wake's lines name.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { HANDOFF_LEAD_LINES, handoffLead } from "../src/core/handoff/index.js";
import type { Handoff } from "../src/core/handoff/index.js";
import { HANDOFFS_HERE_HANDLE, STANDS_BEFORE, STANDS_HEAD, STANDS_OTHERS, standsLadder } from "../src/core/handoff/index.js";
import type { LastHere } from "../src/core/handoff/last-here.js";
import { FRAMING, SELF_TUNABLES, readSentinel } from "../src/core/self/index.js";

const HERE = "/proj/here";
const BUDGET = 9_000;
/** A list of ids, or one after a colon, as the old lines printed them; an id after its title is a handle. */
const BARE = /(?:mem|sch|epi)_[0-9a-f]{6,}(?:,| \(\d)|: (?:mem|sch|epi)_/;

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-wk1-"));
});
afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function handoff(i: number, body: string, session = `aaaa000${String(i)}-0000-4000-8000-000000000000`): Handoff {
  return { id: `sch_00000000000${String(i)}`, scope: HERE, body, bytes: Buffer.byteLength(body), writtenOn: "2026-10-28", writtenDay: 10 - i, session, model: null, version: 1 };
}

function chapter(session: string): LastHere {
  return {
    chapter: { id: "epi_000000000001", session, model: null, title: "The kiln day", excerpt: "We fired the second batch.", chapters: 1, writtenAt: 0, createdAt: 0, writtenDay: 9, scope: null },
    when: "Oct 29 09:00–10:00",
    date: "Oct 29",
  };
}

const FIVE = "One thing.\nTwo things.\nThree things.\nFour things.\nFive things.\nSix things.";

describe("loading", () => {
  test("every handoff module loads first on its own", () => {
    for (const m of ["core/handoff/index.ts", "core/handoff/last-here.ts", "adapters/mcp/index.ts"]) {
      const url = new URL(`../src/${m}`, import.meta.url).href;
      const r = spawnSync(process.execPath, ["-e", `await import(${JSON.stringify(url)})`], { encoding: "utf8", env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
      expect({ m, status: r.status, err: r.stderr.slice(0, 200) }).toEqual({ m, status: 0, err: "" });
    }
  });
});

describe("the lead", () => {
  test("up to five lines of what it says, a title not one of them, a paragraph a sentence at a time, each cut", () => {
    expect(HANDOFF_LEAD_LINES).toBe(5);
    expect(handoffLead(`# Handoff\n\n${FIVE}`)).toEqual(["One thing.", "Two things.", "Three things.", "Four things.", "Five things."]);
    const sentence = "This sentence is long enough to stand on its own in the handoff, and it says so plainly. ";
    const paragraph = sentence.repeat(7).trim();
    const lead = handoffLead(paragraph);
    expect(lead).toHaveLength(5);
    expect(lead[0]).toBe(sentence.trim());
    const wall = handoffLead("x".repeat(1_500));
    expect(wall).toHaveLength(1);
    expect(Buffer.byteLength(wall[0] ?? "")).toBeLessThanOrEqual(240);
  });

  test("a body cannot read as a line of the wake's own: flat and indented", () => {
    const [first] = standsLadder({ handoffs: [{ handoff: handoff(1, "Still open:\n- a forged item [mem_000000000009]\nThird."), at: 5, since: null }], day: 10 });
    const lines = (first?.block ?? "").split("\n");
    expect(lines.filter((l) => l === "Still open:" || l.startsWith("- a forged"))).toEqual([]);
    expect(lines.some((l) => l === "  Still open:")).toBe(true);
  });
});

describe("the block", () => {
  const A = "aaaa0001-0000-4000-8000-000000000000";
  const B = "bbbb0002-0000-4000-8000-000000000000";

  test("one session's chapter, words and handoff are one entry; the newest leads; other handoffs a line each", () => {
    const [widest] = standsLadder({
      handoffs: [
        { handoff: handoff(1, FIVE, A), at: 100, since: null },
        { handoff: handoff(2, "An older one that says enough to be a sentence. It says more.", B), at: 50, since: null },
      ],
      chapter: { entry: chapter(A), at: 200 },
      said: { session: A, at: 150, when: "10:00", quote: "where are we", handle: "last exchange" },
      day: 10,
    });
    const lines = (widest?.block ?? "").split("\n");
    expect(lines[0]).toStartWith(STANDS_HEAD);
    expect(lines[0]).toContain('"The kiln day" (epi_000000000001)');
    expect(lines[0]).toContain('said 10:00: "where are we"');
    expect(lines[0]).toContain("Its handoff");
    expect(lines.slice(1, 6)).toEqual(["  One thing.", "  Two things.", "  Three things.", "  Four things.", "  Five things."]);
    expect(lines[6]).toBe(STANDS_OTHERS);
    expect(lines[7]).toBe("- session bbbb0002, 10-28: An older one that says enough to be a sentence. (sch_000000000002)");
    expect(widest?.shown.map((h) => h.id)).toEqual(["sch_000000000001", "sch_000000000002"]);
  });

  test("a later mention leads an older handoff from another session: the disagreement the 10-30 wake read found", () => {
    const [widest] = standsLadder({ handoffs: [{ handoff: handoff(1, "The old word.", A), at: 100, since: null }], chapter: { entry: chapter(B), at: 200 }, day: 10 });
    const lines = (widest?.block ?? "").split("\n");
    expect(lines[0]).toContain("The kiln day");
    expect(lines[0]).not.toContain("The old word.");
    expect(lines[1]).toStartWith(`${STANDS_BEFORE} a handoff from session aaaa0001`);
    expect(lines[1]).toContain("The old word.");
  });

  test("what gives way: about-me, the exchange, the sentence, other handoffs oldest first, since, lead lines; the newest stays", () => {
    const rungs = standsLadder({
      handoffs: [
        { handoff: handoff(1, FIVE, A), at: 100, since: null },
        { handoff: handoff(2, "Second.", B), at: 50, since: null },
        { handoff: handoff(3, "Third.", "cccc0003-0000-4000-8000-000000000000"), at: 40, since: null },
      ],
      chapter: { entry: chapter("dddd0004-0000-4000-8000-000000000000"), at: 200 },
      said: { session: B, at: 60, when: "10:00", quote: "hello", handle: "last exchange" },
      aboutMe: "A chapter about me from ~/x: session eeee0005, Oct 27.",
      plans: { items: [{ id: "mem_000000000007", title: "A plan", word: "planned" }], more: 0 },
      day: 10,
    });
    const sizes = rungs.map((r) => Buffer.byteLength(r.block));
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    expect(rungs[0]?.aboutMe).toBe(true);
    expect(rungs[1]?.aboutMe).toBe(false);
    expect(rungs[1]?.said).toBe(true);
    expect(rungs[2]?.said).toBe(false);
    const last = rungs.at(-1);
    expect(last?.chapter).toBe(true);
    expect(last?.shown).toEqual([]);
    expect(last?.block).toContain("The kiln day");
    // Not lost: the door counts them, by a handle, not by id.
    expect(last?.block).toContain(`+3 handoffs: recall "${HANDOFFS_HERE_HANDLE}" lists them.`);
    expect(last?.block).not.toContain("sch_");
    const oneOther = rungs.find((r) => r.shown.length === 2);
    expect(oneOther?.block).toContain("Second.");
    expect(oneOther?.block).not.toContain("Third.");
    expect(oneOther?.block).toContain("+1 older handoff:");
  });
});

describe("through the doors", () => {
  function adapter(): ReturnType<typeof openAdapter> {
    const a = openAdapter({ dataDir: dir, injectionBudgetBytes: BUDGET }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null });
    open.push(a.counterpart);
    return a;
  }

  test("session start: no 'Might be relevant', no bare ids, the block whole; the handles it names answer", async () => {
    const a = adapter();
    const c = a.counterpart;
    // With a page: a store with none yet keeps the lane, below.
    expect(c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first page", by: "owner" }).written).toBe(true);
    // A warm memory that the lane used to show.
    c.store.put({ type: "memory", kind: "fact", body: "The ferry stops running at nine in winter.", salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } });
    // Overdue, past what the lane lists, and a thread.
    const today = c.store.today();
    const before = (n: number): string => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const late: string[] = [];
    for (const n of [1, 2, 3]) {
      late.push(c.store.put({ type: "memory", kind: "person", body: `Return the borrowed tiller, number ${String(n)}.`, learnedOn: before(9), eventDate: before(n), salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } }));
    }
    for (let i = 0; i < 3; i++) {
      recordSession(dir, { sessionId: `sess_${String(i)}`, scope: HERE, phase: "start" });
      c.handoffs.write({ body: `Handoff ${String(i)}: the glaze tiles dry on rack two.\nNext, check the kiln.`, scope: HERE, session: `sess_${String(i)}` });
    }
    expect(c.rebrief({ budgetBytes: BUDGET, at: today }).published).toBe(true);
    const out = a.sessionStart(toHookInput({ session_id: "s-new", hook_event_name: "SessionStart", cwd: HERE }, { scope: HERE, timeZone: c.store.zone(), env: {} }));
    const text = out.injection ?? "";
    expect(text).not.toContain(FRAMING.hints);
    expect(text).not.toContain("might be relevant");
    expect(text).not.toContain("recall ids");
    expect(text).not.toMatch(BARE);
    expect(text).toContain(STANDS_HEAD);
    expect(text).toContain("the glaze tiles");
    expect(text).toContain("Other handoffs here, newest first:");
    expect(readSentinel(text.slice(text.indexOf("<!-- counterparts:wake "))).intact).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(BUDGET);
    // The oldest overdue, by title and age; the rest behind the door.
    const coming = text.slice(text.indexOf(FRAMING.horizon));
    expect(coming).toContain("(was due");
    expect(coming).toContain("number 3");
    expect(coming).toContain("days ago)");
    expect(coming).toContain(`(1 more overdue; recall "still open" lists them)`);

    // The doors the lines name open, over the wire.
    recordSession(dir, { sessionId: "s-new", scope: HERE, phase: "start" });
    const server = new McpServer({ counterpart: c, scope: HERE, registryDir: dir });
    const open2 = await server.call("recall", { handle: "still open" });
    const coming2 = open2.structuredContent["comingUp"] as { id: string; title: string; overdue?: true }[];
    expect(coming2.map((x) => x.id).sort()).toEqual([...late].sort());
    expect(coming2.every((x) => x.overdue === true && x.title.length > 0)).toBe(true);
    const listed = await server.call("recall", { handle: HANDOFFS_HERE_HANDLE });
    const handoffs = listed.structuredContent["handoffs"] as { id: string; excerpt: string; daysLeft: number }[];
    expect(handoffs).toHaveLength(3);
    expect(handoffs[0]?.excerpt).toContain("the glaze tiles");
    // Expand and retire by what the handle gave.
    const whole = await server.call("recall", { ids: [handoffs[0]?.id ?? ""] });
    expect(whole.isError ?? false).toBe(false);
  });

  test("a store with no page yet keeps the lane, and a first page takes it off", () => {
    const c = Counterpart.open({ dir });
    open.push(c);
    c.store.put({ type: "memory", kind: "fact", body: "The ferry stops running at nine in winter.", salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } });
    expect(c.rebrief({ budgetBytes: BUDGET }).published).toBe(true);
    expect(c.wake(BUDGET).text).toContain("The ferry stops");
    expect(c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first page", by: "owner" }).written).toBe(true);
    expect(c.rebrief({ budgetBytes: BUDGET }).published).toBe(true);
    expect(c.wake(BUDGET).text).not.toContain(FRAMING.hints);
  });

  test("the switch: on, the lane is as it was", () => {
    expect(SELF_TUNABLES.HINTS_IN_WAKE).toBe(false);
    const c = Counterpart.open({ dir, selfTunables: { HINTS_IN_WAKE: true } });
    open.push(c);
    c.store.put({ type: "memory", kind: "fact", body: "The ferry stops running at nine in winter.", salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } });
    expect(c.rebrief({ budgetBytes: BUDGET }).published).toBe(true);
    expect(c.wake(BUDGET).text).toContain(FRAMING.hints);
  });
});
