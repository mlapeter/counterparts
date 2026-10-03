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
 *     chapter and its session_end memory and left out A's eleven notes,
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
import { installedBuild, recordSession, stampSessionOpened } from "../src/adapters/sessions.js";

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
  unbound(env?: Record<string, string>): McpServer;
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
    unbound(env?: Record<string, string>): McpServer {
      return new McpServer({ counterpart: c, scope: HERE, owner: true, registryDir: storeDir, now: () => now, ...(env === undefined ? {} : { env }) });
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

type Row = { id: string; from?: string };
function rows(r: { structuredContent?: unknown }): Row[] {
  return ((r.structuredContent as Record<string, unknown>)["memories"] as Row[]) ?? [];
}
/** One result of a facts answer, read off its labeled lines (`mcp/facts.ts`). */
interface FactLine {
  readonly id: string;
  readonly title: string;
  readonly journal: boolean;
  readonly ways: string[];
  /** The `learned …` line (a journal's `my journal · written …` line), as printed. */
  readonly learned: string;
  readonly lines: string[];
}

/** A facts answer: the payload, the header lines, and each result. */
function factsOf(r: { structuredContent?: unknown }): { payload: Record<string, unknown>; header: string[]; items: FactLine[] } {
  const payload = (r.structuredContent ?? {}) as Record<string, unknown>;
  const text = typeof payload["answer"] === "string" ? payload["answer"] : "";
  const lines = text.split("\n");
  const blank = lines.indexOf("");
  const header = blank === -1 ? lines : lines.slice(0, blank);
  const items: FactLine[] = [];
  let cur: string[] | null = null;
  const flush = (): void => {
    if (cur === null) return;
    const m = /^\d+\. (\[journal\] )?(.*) · ((?:mem|epi)_[0-9a-f]+)(?: \(chapter \d+ of \d+\))? · (.*)$/.exec(cur[0] ?? "");
    if (m !== null) {
      items.push({
        id: m[3] as string,
        title: m[2] as string,
        journal: m[1] !== undefined,
        ways: (m[4] as string).split(", "),
        learned: cur.find((l) => /^ {3}(learned |my journal · )/.test(l)) ?? "",
        lines: cur,
      });
    }
    cur = null;
  };
  for (const l of lines) {
    if (/^\d+\. /.test(l)) {
      flush();
      cur = [l];
    } else if (l.startsWith("   ") && cur !== null) {
      cur.push(l);
    } else {
      flush();
    }
  }
  flush();
  return { payload, header, items };
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
    // By id, the whole `from`; asked as a question (facts mode), the same
    // words on the result's learned line.
    const line = `   learned 09-30 in ${HERE} · ${UNIDENTIFIED_SESSION_WORDS} · CURRENT`;
    expect(rows(await b.call("recall", { ids: [id] }))[0]?.from).toBe(want);
    const before = factsOf(await b.call("recall", { question: "the cold frame lid hinge", mode: "facts" })).items.find((m) => m.id === id);
    expect(before?.learned).toBe(line);

    // After B binds (its first chapter): it used to read "session mcp, …".
    const ch = await b.call("chapter", { session: B, text: "We looked at the cold frame and the frost dates." });
    expect(ch.isError).not.toBe(true);
    expect(rows(await b.call("recall", { ids: [id] }))[0]?.from).toBe(want);
    const after = factsOf(await b.call("recall", { question: "the cold frame lid hinge", mode: "facts" })).items.find((m) => m.id === id);
    expect(after?.learned).toBe(line);
    for (const r of [before, after]) {
      expect(r?.learned).not.toContain("this session");
      expect(r?.learned).not.toContain(`session ${UNBOUND_SESSION}`);
    }
  });
});

describe("the last session, asked in facts mode, and a session's notes from before it bound", () => {
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

  test("a closed session is the last one, its chapter leads, and a note from before its bind says it was placed by its time (2026-10-01)", async () => {
    const k = day();
    const { early, mid, late, chapter } = await afternoonA(k);
    expect(k.c.store.row(early)?.origin_session).toBe(UNBOUND_SESSION);
    expect(k.c.store.row(late)?.origin_session).toBe(A);
    recordSession(storeDir, { sessionId: B, scope: HERE, phase: "start", at: at(17, 0), model: "claude-opus-5-5" });
    k.talk(B, at(17, 1));
    k.set(at(17, 2));
    const got = factsOf(await k.unbound().call("recall", { question: "what do you remember from our most recent session?", mode: "facts" }));
    expect(got.header.some((l) => l.includes("(session a1b2c3d4, its rows first)"))).toBe(true);
    // A's own rows lead — its chapter (16:35) and the note after the bind
    // (16:36), newest first: in facts mode recency only breaks the tie.
    expect(got.items.slice(0, 2).map((m) => m.id)).toEqual([late, chapter]);
    // The notes from before the bind are A's too: they lead with it.
    const lead = got.items.filter((m) => m.ways.includes("session")).map((m) => m.id);
    expect(new Set(lead)).toEqual(new Set([late, chapter, mid, early]));
    expect(got.items.slice(0, 4).map((m) => m.id).sort()).toEqual([late, chapter, mid, early].sort());
    // Inside A's stretch and no one else's: A's, and the words say how it was
    // placed (random-f2's item 4). The row itself still names nobody.
    expect(got.items.find((m) => m.id === mid)?.learned).toBe(`   learned 09-30 (in the window by this date) in ${HERE} · session a1b2c3d4 (placed by when it was written) · CURRENT`);
    expect(k.c.store.row(mid)?.origin_session).toBe(UNBOUND_SESSION);
    expect(got.items.find((m) => m.id === late)?.learned).toBe(`   learned 09-30 (in the window by this date) in ${HERE} · session a1b2c3d4 · CURRENT`);
  });

  test("side by side: a note written while another session was at work here is nobody's; one inside A's stretch alone is A's", async () => {
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
    const got = factsOf(await k.unbound().call("recall", { question: "what do you remember from our most recent session?", mode: "facts" }));
    const e = got.items.find((m) => m.id === early);
    expect(e?.ways).toContain("session");
    expect(e?.learned).toContain("session a1b2c3d4 (placed by when it was written)");
    const m2 = got.items.find((m) => m.id === mid);
    expect(m2?.ways ?? []).not.toContain("session");
    expect(m2?.learned).toContain(UNIDENTIFIED_SESSION_WORDS);
    // Nor is it placed by its time: two sessions were at work then.
    const named = rows(await k.unbound().call("recall", { ids: [mid] }));
    expect(named[0]?.from).toBe(`${UNIDENTIFIED_SESSION_WORDS}, ${HERE}, 09-30 16:15`);
  });

  test("a note from before the bind in ANOTHER directory never leads here, and says where it was written", async () => {
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
    const got = factsOf(await k.unbound().call("recall", { question: "what do you remember from our most recent session?", mode: "facts" }));
    expect(got.items.map((m) => m.id)).toContain(early);
    const away2 = got.items.find((m) => m.id === other);
    expect(away2?.ways ?? []).not.toContain("session");
    expect(away2?.learned).toContain(`in ${elsewhere} · `);
    // Whatever leads, the other directory's note is not before it.
    const firstOther = got.items.findIndex((m) => !m.ways.includes("session"));
    expect(got.items.slice(firstOther === -1 ? got.items.length : firstOther).some((m) => m.ways.includes("session"))).toBe(false);
  });
});

describe("a note written before the bind is filed under its host's session (2026-10-01, items 4 and 12)", () => {
  const HOST = 4242;
  const CODE = { CLAUDECODE: "1" };
  /** A session record as SessionStart leaves it: opened by HOST's hook at `t`. */
  function opened(session: string, t: number, hookPpid = HOST): void {
    recordSession(storeDir, { sessionId: session, scope: HERE, phase: "start", at: t, model: "claude-opus-5-5" });
    stampSessionOpened(storeDir, session, { build: installedBuild(), hookPpid, at: t });
  }
  /** Claude Code's server for HOST, launched now. */
  function launch(k: ReturnType<typeof day>, pid: number, env: Record<string, string> = CODE): McpServer {
    const s = k.unbound(env);
    s.recordLaunch({ pid, hostPid: HOST, heartbeatMs: 0 });
    return s;
  }

  test("one live session here opened by this server's host: the note is that session's, and its model rides along", async () => {
    const k = day();
    k.set(at(16, 0));
    opened(A, at(16, 0));
    const a = launch(k, 90001);
    k.set(at(16, 2));
    // Before any turn-end: the first turn's note that #307 tried to place by time.
    const n = idOf(await a.call("note", { text: "The garlic goes in on the full moon, a family habit." }));
    expect(k.c.store.row(n)?.origin_session).toBe(A);
    expect(k.c.store.row(n)?.model).toBe("claude-opus-5-5");
    // Nothing was frozen: a chapter for A still binds as it always did.
    k.talk(A, at(16, 3));
    k.set(at(16, 4));
    const ch = await a.call("chapter", { session: A, title: "Autumn beds", text: "We planned the autumn beds: garlic on the full moon, broad beans after." });
    expect(ch.isError).not.toBe(true);
    a.forgetLaunch();
  });

  test("an idle tab opened early in another host does not take a sibling's note (the #307 repro)", async () => {
    const k = day();
    opened(A, at(9, 0), 1111);
    k.set(at(16, 0));
    opened(B, at(16, 0));
    const b = launch(k, 90002);
    k.set(at(16, 1));
    const n = idOf(await b.call("note", { text: "Sam's sister lent us her broadfork for the autumn beds." }));
    expect(k.c.store.row(n)?.origin_session).toBe(B);
    b.forgetLaunch();
  });

  test("not exact, nobody's: two live sessions from one host here, no launch record, or not Claude Code", async () => {
    const k = day();
    k.set(at(16, 0));
    for (const s of [A, B]) opened(s, at(16, 0));
    const two = launch(k, 90003);
    k.set(at(16, 1));
    const n = idOf(await two.call("note", { text: "The cold frame lid needs a new hinge before the frost." }));
    expect(k.c.store.row(n)?.origin_session).toBe(UNBOUND_SESSION);
    two.forgetLaunch();
    // A server with no launch record knows no host.
    const m = idOf(await k.unbound(CODE).call("note", { text: "The fence needs a second wire before the goats find the kale." }));
    expect(k.c.store.row(m)?.origin_session).toBe(UNBOUND_SESSION);
  });

  test("a server whose environment is not Claude Code's does not look", async () => {
    const k = day();
    k.set(at(16, 0));
    opened(A, at(16, 0));
    const other = launch(k, 90004, {});
    k.set(at(16, 1));
    const n = idOf(await other.call("note", { text: "The rain barrel overflowed onto the path again last night." }));
    expect(k.c.store.row(n)?.origin_session).toBe(UNBOUND_SESSION);
    other.forgetLaunch();
  });

  test("a crash and a reused pid: a session opened long before this server launched is not its session", async () => {
    const k = day();
    // A's host crashed at 13:00, inside the liveness window still; the OS
    // later handed its pid to a new host.
    opened(A, at(13, 0));
    k.set(at(16, 0));
    const s = launch(k, 90005);
    k.set(at(16, 1));
    const n = idOf(await s.call("note", { text: "The compost wants turning before the cold comes in." }));
    expect(k.c.store.row(n)?.origin_session).toBe(UNBOUND_SESSION);
    s.forgetLaunch();
  });

  test("/resume in the same host re-stamps the open, so the resumed session is found", async () => {
    const k = day();
    // A was first opened yesterday morning; the host launched its server today
    // and the person resumed A in it, which SessionStart stamps afresh.
    opened(A, at(-14, 0));
    k.set(at(16, 0));
    const s = launch(k, 90006);
    k.set(at(16, 1));
    stampSessionOpened(storeDir, A, { build: installedBuild(), hookPpid: HOST, at: at(16, 1) });
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "boundary", at: at(16, 1) });
    k.set(at(16, 2));
    const n = idOf(await s.call("note", { text: "The seed order goes in before the end of the month." }));
    expect(k.c.store.row(n)?.origin_session).toBe(A);
    s.forgetLaunch();
  });
});
