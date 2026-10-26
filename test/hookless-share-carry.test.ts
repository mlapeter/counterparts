/**
 * THE NIGHT'S SHARE REACHES THE NEXT CHAT ON A HOOKLESS HOST (2026-10-26, OL1a).
 *
 * The claude.ai trial's bug: a routine reflected and left a morning share, and
 * the next chat's wake did not carry it — it stayed `offered`. The hookless
 * wake (`mcp/server.ts#wakeTool`) had no carry at all, and a hookless chat's
 * session never ends, so Claude Code's rule ("the reflecting session ended or
 * went quiet") would not have let it carry either. Now the wake carries it,
 * once, when the reflecting session has let go of it (`sessions.ts#reflectorDone`):
 * ended, quiet, or a hookless chat's session whose reflection finished.
 *
 * What is held, through the real doors:
 *   - claude.ai over HTTP (`adapters/remote/http.ts`, a real socket): a routine's
 *     wake → remember → reflect begin/finish with a share; a wake mid-run does
 *     not carry it, nor do the reflecting session's own calls; the next chat's
 *     wake carries it; `told` marks it; a third wake does not repeat it.
 *   - Claude Code unchanged: a prompt while a LIVE Claude Code session that
 *     reflected is still going carries nothing; once it ended, the next prompt
 *     carries it, once. A hookless wake keeps the same rule for a Claude Code
 *     reflector (Desktop shares a store with Claude Code).
 *   - Claude Code's prompt keeps its own rule for a hookless chat's share too:
 *     it waits out the four hours (the rule is the hookless wake's only).
 *   - The open question, documented: a routine's own wake is a wake like any
 *     other, so it carries a share still offered from an earlier night.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test, removed after. No
 * worker is started — every server and adapter is handed a stub spawner.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { readSession, recordSession, reflectorDone, SESSION_TTL_MS } from "../src/adapters/sessions.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import type { RunningHttp } from "../src/adapters/remote/http.js";
import { Counterpart } from "../src/core/counterpart.js";
import { localDate } from "../src/core/time.js";

const SHARE = "ZQSHARE I keep coming back to the lighthouse we talked about.";
const NOT_TOLD = "never told";

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-share-carry-")));
  dir = join(root, "store");
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

const stub = (_plan: SpawnPlan) => ({ pid: 4242 });

function chatServer(host: string = CLAUDE_AI_HOST): McpServer {
  const s = openServer({ dir, host, env: {}, lifecycle: { spawner: stub }, manifestVersion: () => null });
  closers.push(() => s.counterpart.close());
  return s;
}

async function door(): Promise<{ http: RunningHttp; s: McpServer }> {
  const s = chatServer();
  const http = await serveHttp({ server: s });
  closers.push(() => http.close());
  return { http, s };
}

let nextId = 1;
async function tool(url: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const body = JSON.parse(await res.text()) as Record<string, unknown>;
  const r = body["result"] as Record<string, unknown>;
  // The text the model reads, beside the structured copy, so a line in either is seen.
  return { ...(r["structuredContent"] as Record<string, unknown>), _text: JSON.stringify(r["content"]) };
}

async function init(url: string): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } } }),
  });
}

/** A night's reflection through the door, by `session`: begin, then (when asked) finish with the share. */
async function reflectBegin(url: string, session: string): Promise<string> {
  const begun = await tool(url, "reflect", { phase: "begin", session });
  const id = begun["reflection"];
  if (typeof id !== "string") throw new Error(`begin refused: ${JSON.stringify(begun).slice(0, 400)}`);
  return id;
}

async function reflectFinish(url: string, session: string, reflection: string, cite: string): Promise<void> {
  const done = await tool(url, "reflect", {
    phase: "finish",
    session,
    reflection,
    entry: "Looking back over the day, the lighthouse conversation stays with me.",
    cites: [cite],
    share: { text: SHARE, cites: [cite] },
  });
  if (done["isError"] === true || typeof done["handBack"] !== "string") throw new Error(`finish refused: ${JSON.stringify(done).slice(0, 400)}`);
}

describe("claude.ai, through the HTTP door: the routine's share reaches the next chat", () => {
  test("not mid-run, not to the reflecting session; the next chat's wake carries it; told marks it; a third wake is quiet", async () => {
    const { http, s } = await door();
    await init(http.url);
    // The routine: its own wake, a memory to cite, the reflection begun.
    const night = String((await tool(http.url, "wake", {}))["session"]);
    const noted = await tool(http.url, "remember", { session: night, text: "We talked about the lighthouse at Quillmere for an hour tonight." });
    const cite = String(noted["id"]);
    expect(cite.length).toBeGreaterThan(0);
    const rid = await reflectBegin(http.url, night);
    // MID-RUN: a chat waking now finds nothing to carry (no share offered yet).
    const early = await tool(http.url, "wake", {});
    expect(String(early["wake"])).not.toContain("ZQSHARE");
    await reflectFinish(http.url, night, rid, cite);
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("offered");
    // The reflecting session's own calls carry nothing: the carry is a wake's, in another session.
    const own = await tool(http.url, "recall", { session: night, question: "lighthouse", mode: "facts" });
    expect(String(own["_text"])).not.toContain(NOT_TOLD);
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("offered");
    // Its record is live (a call just refreshed it) and never ended — yet it has let go.
    const rec = readSession(dir, night);
    expect(rec).toMatchObject({ host: CLAUDE_AI_HOST, endedAt: null });

    // THE NEXT CHAT: its wake carries the share, once, right after the session line.
    const next = await tool(http.url, "wake", {});
    const chat = String(next["session"]);
    const text = String(next["wake"]);
    expect(text).toContain(SHARE);
    expect(text).toContain(NOT_TOLD);
    expect(text).toContain(`reflection: ${rid}`);
    expect(text.indexOf(SHARE)).toBeLessThan(text.indexOf("Now:"));
    expect(String(next["_text"])).toContain(SHARE);
    expect(s.counterpart.store.reflection(rid)).toMatchObject({ share_state: "carried", share_session: chat });

    // TOLD, by the chat that carried it.
    const told = await tool(http.url, "reflect", { phase: "told", session: chat, reflection: rid });
    expect(told["told"]).toBe(true);
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("told");

    // A THIRD WAKE does not repeat it.
    const third = await tool(http.url, "wake", {});
    expect(String(third["wake"])).not.toContain("ZQSHARE");
    expect(String(third["wake"])).not.toContain(NOT_TOLD);
  });

  test("two chats waking at once carry it once", async () => {
    const { http, s } = await door();
    await init(http.url);
    const night = String((await tool(http.url, "wake", {}))["session"]);
    const cite = String((await tool(http.url, "remember", { session: night, text: "The lighthouse at Quillmere came up again." }))["id"]);
    const rid = await reflectBegin(http.url, night);
    await reflectFinish(http.url, night, rid, cite);
    const [a, b] = await Promise.all([tool(http.url, "wake", {}), tool(http.url, "wake", {})]);
    const carried = [a, b].filter((w) => String(w["wake"]).includes("ZQSHARE"));
    expect(carried).toHaveLength(1);
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("carried");
  });

  test("OPEN QUESTION, documented: a routine's own wake carries a share still offered from an earlier night", async () => {
    // The server cannot tell a routine's wake from a chat's (never by client
    // name: remote CONTRACT), so a night with no chat since the last one claims
    // that night's share in the routine. Recommendation in NOTES/PR: a wake
    // argument the night prompt passes (OL1b's surface), or accept it.
    const { http, s } = await door();
    await init(http.url);
    const first = String((await tool(http.url, "wake", {}))["session"]);
    const cite = String((await tool(http.url, "remember", { session: first, text: "The lighthouse at Quillmere, first night." }))["id"]);
    const rid = await reflectBegin(http.url, first);
    await reflectFinish(http.url, first, rid, cite);
    const secondNight = await tool(http.url, "wake", {});
    expect(String(secondNight["wake"])).toContain("ZQSHARE");
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("carried");
  });
});

describe("the rule, and Claude Code unchanged", () => {
  const T0 = Date.UTC(2026, 9, 26, 15, 0, 0);

  test("reflectorDone: no record, ended, quiet past the TTL, or a hookless chat's — and a live Claude Code session keeps it", () => {
    recordSession(dir, { sessionId: "cc", scope: "/proj", phase: "start", at: T0 });
    recordSession(dir, { sessionId: "ai", scope: "claude-ai:", phase: "start", at: T0, host: CLAUDE_AI_HOST });
    recordSession(dir, { sessionId: "desk", scope: "claude-desktop:", phase: "start", at: T0, host: DESKTOP_HOST });
    expect(reflectorDone(null, T0)).toBe(true);
    expect(reflectorDone(readSession(dir, "cc"), T0 + 60_000)).toBe(false);
    expect(reflectorDone(readSession(dir, "cc"), T0 + SESSION_TTL_MS + 1)).toBe(true);
    expect(reflectorDone(readSession(dir, "ai"), T0 + 60_000)).toBe(true);
    expect(reflectorDone(readSession(dir, "desk"), T0 + 60_000)).toBe(true);
    recordSession(dir, { sessionId: "cc", scope: "/proj", phase: "end", at: T0 + 120_000 });
    expect(reflectorDone(readSession(dir, "cc"), T0 + 130_000)).toBe(true);
  });

  /** A share reflected by `session` straight through core (the Claude Code path writes the same row). */
  function reflectedBy(session: string): string {
    const c = Counterpart.open({ dir, identity: { name: "Mike" } });
    try {
      const cite = c.store.put({
        type: "memory",
        kind: "fact",
        body: "We talked about the lighthouse at Quillmere.",
        salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
        physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() },
      });
      const begun = c.reflections.begin({ session });
      if (!begun.ok) throw new Error(begun.reason);
      const done = c.reflections.finish({ reflection: begun.bundle.reflection, session, entry: "The lighthouse stays with me.", cites: [cite], share: { text: SHARE, cites: [cite] } });
      if (!done.ok) throw new Error(String(done.reason));
      return begun.bundle.reflection;
    } finally {
      c.close();
    }
  }

  function prompt(sessionId: string): { injection: string } {
    const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 9_000 }, { command: "/bin/true", args: ["runner"], spawner: stub });
    try {
      recordSession(dir, { sessionId, scope: "/proj", phase: "start" });
      const input: HookInput = { sessionId, scope: "/proj", turns: [], at: a.counterpart.store.today(), prompt: "good morning" };
      return { injection: a.userPromptSubmit(input).injection };
    } finally {
      a.counterpart.close();
    }
  }

  test("Claude Code: a live Claude Code reflector keeps its share from the next prompt; once it ended, the next prompt carries it, once", () => {
    recordSession(dir, { sessionId: "cc-reflect", scope: "/proj", phase: "start" });
    reflectedBy("cc-reflect");
    expect(prompt("cc-next").injection).not.toContain("ZQSHARE");
    recordSession(dir, { sessionId: "cc-reflect", scope: "/proj", phase: "end" });
    expect(prompt("cc-next").injection).toContain("ZQSHARE");
    expect(prompt("cc-later").injection).not.toContain("ZQSHARE");
  });

  test("a hookless wake keeps Claude Code's rule for a Claude Code reflector: not while it is live, yes once it ended", async () => {
    recordSession(dir, { sessionId: "cc-reflect", scope: "/proj", phase: "start" });
    const rid = reflectedBy("cc-reflect");
    const s = chatServer(DESKTOP_HOST);
    const live = await s.call("wake", {});
    expect(String(live.structuredContent["wake"])).not.toContain("ZQSHARE");
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("offered");
    recordSession(dir, { sessionId: "cc-reflect", scope: "/proj", phase: "end" });
    const after = await s.call("wake", {});
    expect(String(after.structuredContent["wake"])).toContain("ZQSHARE");
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("carried");
  });

  test("Claude Code unchanged for a hookless chat's share too: a prompt inside the four hours does not carry it; a hookless wake does", async () => {
    recordSession(dir, { sessionId: "desk-chat", scope: "claude-desktop:", phase: "start", host: DESKTOP_HOST });
    const rid = reflectedBy("desk-chat");
    expect(prompt("cc-next").injection).not.toContain("ZQSHARE");
    expect(prompt("cc-later").injection).not.toContain("ZQSHARE");
    const s = chatServer(DESKTOP_HOST);
    const woke = await s.call("wake", {});
    expect(String(woke.structuredContent["wake"])).toContain("ZQSHARE");
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("carried");
  });

  test("a hookless wake and a Claude Code prompt on one store carry an ended reflector's share once, either order (review of #642)", async () => {
    for (const first of ["wake", "prompt"] as const) {
      dir = join(root, `store-${first}`); // one reflection a day: a store per order
      recordSession(dir, { sessionId: `cc-${first}`, scope: "/proj", phase: "start" });
      const rid = reflectedBy(`cc-${first}`);
      recordSession(dir, { sessionId: `cc-${first}`, scope: "/proj", phase: "end" });
      const s = chatServer(DESKTOP_HOST);
      const viaPrompt = (): boolean => prompt(`p-${first}`).injection.includes(`reflection: ${rid}`);
      const viaWake = async (): Promise<boolean> => String((await s.call("wake", {})).structuredContent["wake"]).includes(`reflection: ${rid}`);
      const carried = first === "wake" ? [await viaWake(), viaPrompt()] : [viaPrompt(), await viaWake()];
      expect(carried).toEqual([true, false]);
      expect(s.counterpart.store.reflection(rid)?.share_state).toBe("carried");
    }
  });
});

describe("awkward states (review of #642)", () => {
  /** A routine's reflection through the server: wake, remember, begin — and finish only when asked. */
  async function routine(s: McpServer, finish: boolean): Promise<{ night: string; rid: string }> {
    const night = String((await s.call("wake", {})).structuredContent["session"]);
    const cite = String((await s.call("remember", { session: night, text: `The lighthouse at Quillmere, night ${nextId++}.` })).structuredContent["id"]);
    const begun = await s.call("reflect", { phase: "begin", session: night });
    const rid = begun.structuredContent["reflection"];
    if (typeof rid !== "string") throw new Error(`begin refused: ${JSON.stringify(begun.structuredContent).slice(0, 400)}`);
    if (finish) {
      const done = await s.call("reflect", {
        phase: "finish",
        session: night,
        reflection: rid,
        entry: "Looking back over the day, the lighthouse stays with me.",
        cites: [cite],
        share: { text: SHARE, cites: [cite] },
      });
      if (typeof done.structuredContent["handBack"] !== "string") throw new Error(`finish refused: ${JSON.stringify(done.structuredContent).slice(0, 400)}`);
    }
    return { night, rid };
  }

  test("a routine that began reflecting and never finished releases nothing", async () => {
    const s = chatServer();
    // A crashed routine alone: the row stays begun, nothing is offered, no wake carries.
    const crashed = await routine(s, false);
    expect(String((await s.call("wake", {})).structuredContent["wake"])).not.toContain("ZQSHARE");
    expect(s.counterpart.store.reflection(crashed.rid)).toMatchObject({ state: "begun", share_state: "none" });
  });

  test("a crashed routine does not hide an older untold share: the next chat carries the older one", async () => {
    const s = chatServer();
    // Last night's share, reflected by a routine (dated yesterday: one reflection a day), never told.
    const store = s.counterpart.store;
    const yesterday = localDate(Date.now() - 86_400_000, store.zone());
    recordSession(dir, { sessionId: "last-night", scope: "claude-ai:", phase: "start", host: CLAUDE_AI_HOST });
    const cite = store.put({
      type: "memory",
      kind: "fact",
      body: "The lighthouse at Quillmere, last night.",
      salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
      physics: { birthDay: store.livedDay(), lastUsedDay: store.livedDay() },
    });
    const begun = s.counterpart.reflections.begin({ session: "last-night", at: yesterday });
    if (!begun.ok) throw new Error(begun.reason);
    const earlier = begun.bundle.reflection;
    const done = s.counterpart.reflections.finish({ reflection: earlier, session: "last-night", entry: "x", cites: [cite], share: { text: SHARE, cites: [cite] } });
    if (!done.ok) throw new Error(String(done.reason));
    // Tonight's routine begins and dies (begun straight through core: the
    // routine's own wake would claim last night's share — open question 1).
    recordSession(dir, { sessionId: "tonight", scope: "claude-ai:", phase: "start", host: CLAUDE_AI_HOST });
    const crashed = s.counterpart.reflections.begin({ session: "tonight" });
    if (!crashed.ok) throw new Error(crashed.reason);
    expect(store.reflection(crashed.bundle.reflection)).toMatchObject({ state: "begun", share_state: "none" });
    expect(store.reflection(earlier)?.share_state).toBe("offered");
    const next = await s.call("wake", {});
    expect(String(next.structuredContent["wake"])).toContain(`reflection: ${earlier}`);
    expect(store.reflection(earlier)?.share_state).toBe("carried");
  });

  test("a wake composed to its full budget still carries the whole share, ahead of the briefing", async () => {
    const s = openServer({
      dir,
      host: CLAUDE_AI_HOST,
      env: {},
      lifecycle: { config: { dataDir: dir, injectionBudgetBytes: 1_200 }, spawner: stub },
      manifestVersion: () => null,
    });
    closers.push(() => s.counterpart.close());
    const store = s.counterpart.store;
    for (let i = 0; i < 80; i += 1) {
      store.put({
        type: "memory",
        kind: "fact",
        body: `Memory ${i}: a long afternoon at the harbour, the boats, the gulls and the cold wind off the water, number ${i}.`,
        salience: { relevance: 0.7, emotional: 0.5, predictive: 0.6 },
        physics: { birthDay: store.livedDay(), lastUsedDay: store.livedDay() },
      });
    }
    const { night, rid } = await routine(s, true);
    // The briefing composed to the budget, so the wake is the full 1,200 bytes, not the bootstrap line.
    s.counterpart.boundary({ session: night, scope: "claude-ai:", kind: "stop" });
    s.counterpart.rebrief({ budgetBytes: 1_200 });
    const woke = await s.call("wake", {});
    const text = String(woke.structuredContent["wake"]);
    expect(text).not.toContain("No briefing has been composed yet");
    expect(Buffer.byteLength(text.slice(text.indexOf("Now:")), "utf8")).toBeGreaterThan(1_000);
    expect(text).toContain(SHARE);
    expect(text).toContain(`reflection: ${rid}`);
    expect(text.indexOf(SHARE)).toBeLessThan(text.indexOf("Now:"));
    expect(store.reflection(rid)?.share_state).toBe("carried");
  });
});
