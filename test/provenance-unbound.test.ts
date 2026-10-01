/**
 * A NOTE FROM BEFORE THE SERVER KNEW ITS SESSION (2026-09-30, the 0.3.10
 * release check).
 *
 * In Claude Code the memory server learns its session only at the first
 * `chapter` or `session_end` (the lazy bind). A `note` before that is filed
 * under the one id every unbound server shares (`UNBOUND_SESSION`, "mcp"), and
 * a recall before it reads as that id too. #302's `from` and the recency lead
 * took it for a real session. Measured on a throwaway store:
 *   - before the bind, every note ANY unbound server ever wrote read
 *     `from: "this session, …"` (a 0.3.9 session's note from 21:13 included);
 *   - after the bind, the same rows read `from: "session mcp, …"`;
 *   - "what do you remember from our most recent session?" led with A's
 *     chapter and its session_end memory and left out A's twelve notes,
 *     every one written before A bound.
 * The live store had 46 of ~430 authored memories under that id.
 *
 * Hermetic: every test makes its own temp directory and removes it. The clock
 * is pinned and the zone is UTC.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { sessionsHere } from "../src/core/coverage/index.js";
import { UNIDENTIFIED_SESSION_WORDS, sessionWords } from "../src/core/handoff/index.js";
import { UNBOUND_SESSION, isKnownSession } from "../src/core/types.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import { recordSession } from "../src/adapters/sessions.js";

const MIN = 60_000;
const DAY0 = Date.UTC(2026, 8, 30);
const at = (h: number, m: number): number => DAY0 + h * 60 * MIN + m * MIN;

const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const B = "b5b6b7b8-0000-4000-8000-00000000000b";
const C = "c9cacbcc-0000-4000-8000-00000000000c";

let root: string;
let storeDir: string;
let HERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-unbound-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  mkdirSync(HERE, { recursive: true });
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

function day(): {
  c: Counterpart;
  set(t: number): void;
  /** A server launched as Claude Code launches it: told no session. */
  unbound(): McpServer;
  talk(session: string, t: number): void;
} {
  let now = at(15, 0);
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => now, timeZone: "UTC" });
  open.push(c);
  const turns = new Map<string, { role: "user" | "assistant"; text: string }[]>();
  return {
    c,
    set(t: number): void {
      now = t;
    },
    unbound(): McpServer {
      return new McpServer({ counterpart: c, scope: HERE, owner: true, registryDir: storeDir, now: () => now });
    },
    talk(session: string, t: number): void {
      now = t;
      const held = turns.get(session) ?? [];
      held.push({ role: "user", text: `(${session.slice(0, 4)} at ${String(t)}) the next bed, and what goes in it.` });
      held.push({ role: "assistant", text: `(${session.slice(0, 4)}) noted, and here is the plan for it.` });
      turns.set(session, held);
      c.captureSpans({ session, scope: HERE, turns: [...held] });
      c.boundary({ session, scope: HERE, kind: "stop" });
    },
  };
}

type Row = { id: string; recent?: boolean; from?: string };
function rows(r: { structuredContent?: unknown }): Row[] {
  return ((r.structuredContent as Record<string, unknown>)["memories"] as Row[]) ?? [];
}
function idOf(r: { structuredContent?: unknown }): string {
  return (r.structuredContent as Record<string, unknown>)["id"] as string;
}

describe("the unbound server's id names no session", () => {
  test("in words: never 'this session', never 'session mcp'", () => {
    expect(isKnownSession(UNBOUND_SESSION)).toBe(false);
    expect(isKnownSession(A)).toBe(true);
    expect(sessionWords(UNBOUND_SESSION, null, UNBOUND_SESSION)).toBe(UNIDENTIFIED_SESSION_WORDS);
    expect(sessionWords(UNBOUND_SESSION, null, A)).toBe(UNIDENTIFIED_SESSION_WORDS);
    expect(sessionWords(UNBOUND_SESSION, "claude-opus-5-5", null)).toBe(`${UNIDENTIFIED_SESSION_WORDS} on Opus 5.5`);
    // A reader that is the unbound id owns nothing.
    expect(sessionWords(A, null, UNBOUND_SESSION)).toBe("session a1b2c3d4");
    expect(sessionWords(A, null, A)).toBe("this session");
  });

  test("a note before the bind is filed under it, and the directory's sessions do not include it", async () => {
    const k = day();
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
    k.talk(A, at(16, 1));
    k.set(at(16, 5));
    const n = await k.unbound().call("note", { text: "The cold frame lid needs a new hinge before the frost." });
    expect(n.isError).not.toBe(true);
    expect(k.c.store.row(idOf(n))?.origin_session).toBe(UNBOUND_SESSION);
    const here = sessionsHere(k.c.spans, HERE).map((s) => s.session);
    expect(here).toContain(A);
    expect(here).not.toContain(UNBOUND_SESSION);
  });
});

describe("`from` on a note written before the bind", () => {
  test("another session asking, before and after it binds: the plain words, the directory and the time", async () => {
    const k = day();
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
    k.talk(A, at(16, 1));
    k.set(at(16, 5));
    const n = await k.unbound().call("note", { text: "The cold frame lid needs a new hinge before the frost." });
    const id = idOf(n);
    const want = `${UNIDENTIFIED_SESSION_WORDS}, ${HERE}, 09-30 16:05`;

    // B, a later session, asks before its own server has bound: it used to
    // read "this session, …".
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const b = k.unbound();
    const before = rows(await b.call("recall", { question: "the cold frame lid hinge" })).find((m) => m.id === id);
    expect(before?.from).toBe(want);

    // After B binds (its first chapter): it used to read "session mcp, …".
    const ch = await b.call("chapter", { session: B, text: "We looked at the cold frame and the frost dates." });
    expect(ch.isError).not.toBe(true);
    const after = rows(await b.call("recall", { question: "the cold frame lid hinge" })).find((m) => m.id === id);
    expect(after?.from).toBe(want);
    for (const r of [before, after]) {
      expect(r?.from).not.toMatch(/^this session/);
      expect(r?.from).not.toContain(`session ${UNBOUND_SESSION}`);
    }
  });
});

describe("the recency lead and a session's notes from before it bound", () => {
  /** A's afternoon: turns from 16:01, two notes before its server bound, a
   *  chapter at 16:35 (the bind), one note after, the end. */
  async function afternoonA(k: ReturnType<typeof day>): Promise<{ early: string; mid: string; late: string; chapter: string }> {
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
    const a = k.unbound();
    k.talk(A, at(16, 1));
    k.set(at(16, 5));
    const early = idOf(await a.call("note", { text: "The garlic goes in on the full moon, a family habit." }));
    k.talk(A, at(16, 11));
    k.set(at(16, 15));
    const mid = idOf(await a.call("note", { text: "Sam's sister lent us her broadfork for the autumn beds." }));
    k.talk(A, at(16, 21));
    k.talk(A, at(16, 31));
    k.set(at(16, 35));
    const ch = await a.call("chapter", { session: A, title: "Planning the autumn beds", text: "We planned the autumn beds: garlic on the full moon, broad beans after." });
    expect(ch.isError).not.toBe(true);
    const chapter = (ch.structuredContent as Record<string, unknown>)["episodeId"] as string;
    k.set(at(16, 36));
    const late = idOf(await a.call("note", { text: "The fence needs a second wire before the goats find the kale again." }));
    k.talk(A, at(16, 41));
    k.c.boundary({ session: A, scope: HERE, kind: "session-end" });
    return { early, mid, late, chapter };
  }

  test("a closed session's notes from before its bind lead with its chapter, each saying it was not yet identified", async () => {
    const k = day();
    const { early, mid, late, chapter } = await afternoonA(k);
    expect(k.c.store.row(early)?.origin_session).toBe(UNBOUND_SESSION);
    expect(k.c.store.row(late)?.origin_session).toBe(A);
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const got = rows(await k.unbound().call("recall", { question: "what do you remember from our most recent session?" }));
    const lead = got.filter((m) => m.recent === true).map((m) => m.id);
    expect(lead[0]).toBe(chapter);
    // Newest first: the note after the bind, then the two before it.
    expect(lead.slice(1, 4)).toEqual([late, mid, early]);
    expect(got.find((m) => m.id === mid)?.from).toBe(`${UNIDENTIFIED_SESSION_WORDS}, ${HERE}, 09-30 16:15`);
    expect(got.find((m) => m.id === late)?.from).toBe(`session a1b2c3d4, ${HERE}, 09-30 16:36`);
  });

  test("a note in the first turn, before the first turn-end, leads too: the stretch opens at the registry's start (2026-10-01)", async () => {
    const k = day();
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
    const a = k.unbound();
    // Written at 16:00:30, before A's first Stop at 16:01.
    k.set(at(16, 0) + 30_000);
    const first = idOf(await a.call("note", { text: "The rhubarb crowns get split every fourth spring." }));
    k.talk(A, at(16, 1));
    k.set(at(16, 5));
    const ch = await a.call("chapter", { session: A, title: "Rhubarb", text: "We talked about splitting the rhubarb crowns." });
    expect(ch.isError).not.toBe(true);
    k.talk(A, at(16, 11));
    k.c.boundary({ session: A, scope: HERE, kind: "session-end" });
    expect(k.c.store.row(first)?.origin_session).toBe(UNBOUND_SESSION);
    // The captured stretch alone starts at the first turn-end, after the note.
    expect(sessionsHere(k.c.spans, HERE).find((s) => s.session === A)?.firstAt).toBe(at(16, 1));
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const got = rows(await k.unbound().call("recall", { question: "what do you remember from our most recent session?" }));
    const lead = got.filter((m) => m.recent === true).map((m) => m.id);
    expect(lead).toContain(first);
  });

  test("a registry start in another directory does not open the stretch here", async () => {
    const k = day();
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    // A's registry record names another directory; its turns are here.
    recordSession(storeDir, { sessionId: A, scope: elsewhere, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
    const a = k.unbound();
    k.set(at(16, 0) + 30_000);
    const first = idOf(await a.call("note", { text: "The rhubarb crowns get split every fourth spring." }));
    k.talk(A, at(16, 1));
    k.set(at(16, 5));
    const mid = idOf(await a.call("note", { text: "The water butt overflows onto the path in a storm." }));
    k.talk(A, at(16, 11));
    k.c.boundary({ session: A, scope: HERE, kind: "session-end" });
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const lead = new Set(rows(await k.unbound().call("recall", { question: "what do you remember from our most recent session?" })).filter((m) => m.recent === true).map((m) => m.id));
    expect(lead.has(mid)).toBe(true);
    expect(lead.has(first)).toBe(false);
  });

  test("side by side: a note written while another session was at work here is nobody's, and does not lead", async () => {
    const k = day();
    // C works in the same directory from 16:10 to 16:20, alongside A.
    recordSession(storeDir, { sessionId: C, scope: HERE, phase: "start", at: at(16, 9), model: "claude-opus-5-5" });
    const { early, mid } = await (async () => {
      recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
      const a = k.unbound();
      k.talk(A, at(16, 1));
      k.set(at(16, 5));
      const e = idOf(await a.call("note", { text: "The garlic goes in on the full moon, a family habit." }));
      k.talk(C, at(16, 10));
      k.set(at(16, 15));
      const m = idOf(await a.call("note", { text: "Sam's sister lent us her broadfork for the autumn beds." }));
      k.talk(C, at(16, 20));
      k.talk(A, at(16, 31));
      k.set(at(16, 35));
      await a.call("chapter", { session: A, title: "Planning the autumn beds", text: "We planned the autumn beds: garlic on the full moon, broad beans after." });
      k.talk(A, at(16, 41));
      k.c.boundary({ session: A, scope: HERE, kind: "session-end" });
      return { early: e, mid: m };
    })();
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const got = rows(await k.unbound().call("recall", { question: "what do you remember from our most recent session?" }));
    const lead = new Set(got.filter((m) => m.recent === true).map((m) => m.id));
    expect(lead.has(early)).toBe(true);
    expect(lead.has(mid)).toBe(false);
  });

  test("a note from before the bind in ANOTHER directory never leads here", async () => {
    const k = day();
    const { early } = await afternoonA(k);
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    k.set(at(16, 20));
    const away = new McpServer({ counterpart: k.c, scope: elsewhere, owner: true, registryDir: storeDir, now: () => at(16, 20) });
    const other = idOf(await away.call("note", { text: "The bike chain was waxed on the 28th." }));
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const lead = new Set(rows(await k.unbound().call("recall", { question: "what do you remember from our most recent session?" })).filter((m) => m.recent === true).map((m) => m.id));
    expect(lead.has(early)).toBe(true);
    expect(lead.has(other)).toBe(false);
  });
});
