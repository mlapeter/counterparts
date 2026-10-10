/**
 * DESKTOP'S CODE TAB REACHES CLAUDE DESKTOP'S SERVER (lane 5, 2026-10-01).
 *
 * Measured live that morning: a Code-tab session's own MCP server stays Claude
 * Code's, but the `counterparts` tools its model sees are Claude Desktop's
 * server (same name, shadowing it) — Desktop mode, shared by every Desktop
 * chat. A call naming no session there was filed under the most recent Desktop
 * chat. So:
 *
 *   1. a Desktop-mode server serves a call that NAMES a live session the hooks
 *      recorded (host `claude-code`) as that Claude Code session — its
 *      directory, its doors, no Desktop ask, not counted — for that call only;
 *   2. the Code-tab wake (entrypoint `claude-desktop`) states the id;
 *   3. the descriptions stop saying wake is never offered in Claude Code;
 *   4. an unnamed call still falls back, and says how a Claude Code session
 *      corrects it.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test — the store, the
 * project, the scope registry — removed after. No worker is started: every
 * server and adapter is handed a stub spawner. No real Desktop config is read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DEFAULT_HOST, DESKTOP_HOST, DESKTOP_SCOPE, wordingFor } from "../src/adapters/hosts.js";
import {
  DESKTOP_INSTRUCTIONS,
  NO_DESKTOP_SESSION,
  SEEN_SESSIONS,
  WAKE,
  encodeMessage,
  openServer,
  renderDescription,
  serveStdio,
  toolDefinitions,
} from "../src/adapters/mcp/index.js";
import type { McpServer, Response, ToolResult } from "../src/adapters/mcp/index.js";
import { TUNABLES } from "../src/adapters/config.js";
import { SESSION_TTL_MS, grantWriteUps, hostOf, readSession, recordSession } from "../src/adapters/sessions.js";
import { lookupScope, readScopes, setScope, writeScopes } from "../src/adapters/scopes.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { CODE_TAB_ENTRYPOINT, codeTabSessionLine } from "../src/adapters/claude-code/hooks.js";
import type { ProposalRecord } from "../src/core/remember/proposals.js";
import { localDate } from "../src/core/time.js";

const MIN = 60_000;

let root: string;
let dir: string;
let project: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-codetab-")));
  dir = join(root, "store");
  project = join(root, "proj");
  mkdirSync(project, { recursive: true });
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

function clock(start = Date.now()): { now: () => number; advance(ms: number): void } {
  let at = start;
  return {
    now: () => at,
    advance(ms: number): void {
      at += ms;
    },
  };
}

function stubSpawner(): (plan: SpawnPlan) => { pid: number } {
  return () => ({ pid: 4242 });
}

/** A server the way Claude Desktop starts one: told nothing; the client's name makes it Desktop's. */
function plainServer(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({
    dir,
    owner: true,
    lifecycle: { spawner: stubSpawner() },
    manifestVersion: () => null,
    env: {},
    ...opts,
  });
  open.push(s.counterpart);
  return s;
}

/** A server already in Desktop mode. */
function desktopServer(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  return plainServer({ host: DESKTOP_HOST, ...opts });
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

function rpc(id: number, method: string, params?: Record<string, unknown>): string {
  return encodeMessage({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) } as never);
}

async function pump(s: McpServer, chunks: readonly string[]): Promise<Response[]> {
  const out: Response[] = [];
  const input = (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
  await serveStdio(s, input, {
    write: (chunk) => {
      for (const line of chunk.trim().split("\n")) out.push(JSON.parse(line) as Response);
    },
  });
  return out;
}

async function wireCall(s: McpServer, id: number, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const [response] = await pump(s, [rpc(id, "tools/call", { name, arguments: args })]);
  return (response as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
}

/** The Code-tab session's record, written by the hooks themselves: a SessionStart with entrypoint `claude-desktop`. */
function codeTabSessionStart(sessionId: string, scope = project): { injection: string | null } {
  const a = openAdapter(
    { dataDir: dir, owner: true },
    { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) },
  );
  open.push(a.counterpart);
  return a.sessionStart({ sessionId, scope, at: localDate(Date.now()), entrypoint: CODE_TAB_ENTRYPOINT });
}

/** The server is not left holding a call's binding between calls. */
function expectUnbound(s: McpServer): void {
  expect(s.scope).toBe(DESKTOP_SCOPE);
  expect(s.session).toBeNull();
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the owner's own sessions are the owner (2026-10-02)", () => {
  test("Desktop's server, a guest for its chats, serves a Code-tab call as the owner's: it closes a thread opened in another directory, and the list agrees", async () => {
    codeTabSessionStart("tab-own");
    // As the entry point opens it with nothing said and the install's `owner: true`.
    const s = plainServer({ owner: false, codeTabOwner: true });
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } })]);
    const elsewhere = join(root, "elsewhere");
    const thread = s.counterpart.store.put({
      type: "memory",
      kind: "fact",
      body: "Whether the pump housing needs a second gasket is still open.",
      salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
      meta: { unresolved: true },
      origin: { scope: elsewhere },
    });
    // A Desktop chat is still a guest.
    const chat = (await wireCall(s, 2, "wake"))["session"] as string;
    expect((await wireCall(s, 3, "status", { session: chat }))["stance"]).toMatchObject({ owner: false });
    // The Code tab's call is the owner's, and says why.
    const stance = (await wireCall(s, 4, "status", { session: "tab-own" }))["stance"] as Record<string, unknown>;
    expect(stance).toMatchObject({ owner: true });
    expect(String(stance["ownerFrom"])).toContain("Desktop's Code tab");
    const closed = await wireCall(s, 5, "note", {
      session: "tab-own",
      text: "The pump housing took the second gasket; the seep stopped.",
      updates: thread,
      unresolved: false,
    });
    expect(closed["thread"]).toEqual({ closed: thread });
    expect(s.counterpart.store.readProse(thread).meta["unresolved"]).toBe(false);
  });

  test("#317 × #318: what a Code-tab call's recall showed it, confidential included, it may feel again; a Desktop chat may not", async () => {
    codeTabSessionStart("tab-feel");
    const s = plainServer({ owner: false, codeTabOwner: true });
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } })]);
    const secret = s.counterpart.store.put({
      type: "memory",
      kind: "person",
      body: "The diagnosis came back clear; only Mike and I know it yet.",
      salience: { relevance: 0.9, emotional: 0.9, predictive: 0.5 },
      meta: { confidential: true },
      origin: { scope: project },
    });
    const recalled = await wireCall(s, 2, "recall", { session: "tab-feel", ids: [secret] });
    expect(JSON.stringify(recalled)).toContain("The diagnosis came back clear");
    const felt = await wireCall(s, 3, "note", {
      session: "tab-feel",
      feelingsNow: [{ id: secret, core: "calm", emotion: "relieved", strength: 0.9, carried_by: "It came back clear." }],
    });
    expect((felt["feelingsNow"] as { recorded: number }).recorded).toBe(1);
    // A Desktop chat, a guest: its recall does not show it, and it cannot feel it.
    const chat = (await wireCall(s, 4, "wake"))["session"] as string;
    expect(JSON.stringify(await wireCall(s, 5, "recall", { session: chat, ids: [secret] }))).not.toContain("The diagnosis came back clear");
    const refused = await wireCall(s, 6, "note", {
      session: chat,
      feelingsNow: [{ id: secret, core: "calm", emotion: "relieved", strength: 0.9 }],
    });
    expect((refused["feelingsNow"] as { recorded: number }).recorded).toBe(0);
  });
});

describe("Desktop's server serves a Code-tab session that names itself", () => {
  test("end to end: the hooks' record, named, is served as that Claude Code session — its directory, its doors, no Desktop ask — interleaved with a Desktop chat, nothing leaks", async () => {
    const t = clock();
    // The Code tab's SessionStart hook: the record, and the wake line naming the id.
    const woke = codeTabSessionStart("tab-1");
    expect(woke.injection ?? "").toContain("pass session: tab-1 on every call");
    const record = readSession(dir, "tab-1");
    expect(record).toMatchObject({ entrypoint: CODE_TAB_ENTRYPOINT, endedAt: null });
    expect(hostOf(record as NonNullable<typeof record>)).toBe(DEFAULT_HOST);

    // Desktop's own server, told nothing: the `claude-ai` client makes it Desktop's.
    const s = plainServer({ now: t.now });
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } })]);
    expect(s.host).toBe(DESKTOP_HOST);
    expectUnbound(s);

    // A Desktop chat wakes, beside it.
    const chat = (await wireCall(s, 2, "wake"))["session"] as string;
    expect(readSession(dir, chat)?.host).toBe(DESKTOP_HOST);
    // Long enough that a Desktop session would be due its write-up ask.
    t.advance(TUNABLES.DESKTOP_ASK_AFTER_MS + MIN);

    let id = 10;
    const served: Record<string, unknown>[] = [];
    const chatAsks: string[] = [];
    for (let i = 0; i < TUNABLES.DESKTOP_ASK_CALLS + 2; i++) {
      // The Code tab's note, named: filed in ITS directory, under ITS session.
      const noted = await wireCall(s, id++, "note", {
        session: "tab-1",
        text: `Code tab, pass ${String(i)}: the relief valve is seated before the pump runs, or the reservoir loop loses pressure.`,
      });
      served.push(noted);
      expect(noted["stored"]).toBe(true);
      const row = s.counterpart.store.row(noted["id"] as string);
      expect(row?.origin_scope).toBe(project);
      expect(row?.origin_session).toBe("tab-1");
      expectUnbound(s);

      // The Desktop chat's note between them: filed under claude-desktop:, its own session.
      const chatNote = await wireCall(s, id++, "note", {
        session: chat,
        text: `Desktop chat, pass ${String(i)}: the library on Elm Street closes at four on Sundays now.`,
      });
      expect(chatNote["stored"]).toBe(true);
      const chatRow = s.counterpart.store.row(chatNote["id"] as string);
      expect(chatRow?.origin_scope).toBe(DESKTOP_SCOPE);
      expect(chatRow?.origin_session).toBe(chat);
      if (chatNote["writeUpAsk"] !== undefined) chatAsks.push(String(chatNote["writeUpAsk"]));
      expectUnbound(s);
    }
    // No Desktop machinery on any Code-tab result: no bind note, no ask.
    for (const out of served) {
      expect(out["boundTo"]).toBeUndefined();
      expect(out["bindNote"]).toBeUndefined();
      expect(out["writeUpAsk"]).toBeUndefined();
    }
    // The Desktop chat, on the same server and the same clock, WAS due its
    // ask — about itself, never the Code tab.
    expect(chatAsks.length).toBeGreaterThan(0);
    for (const ask of chatAsks) {
      expect(ask).toContain(chat);
      expect(ask).not.toContain("tab-1");
    }
    // Not counted as a Desktop call: its record carries no Desktop pacer.
    expect(readSession(dir, "tab-1")?.desk).toBeUndefined();
    expect(readSession(dir, chat)?.desk).toBeDefined();
    expect(s.events("mcp.desktop.call").some((e) => e.ref === "tab-1")).toBe(false);
    expect(s.events("mcp.session.served").filter((e) => e.ref === "tab-1").length).toBe(TUNABLES.DESKTOP_ASK_CALLS + 2);

    // Its chapter and its session_end, exactly as Claude Code's own server would take them.
    const chapter = await wireCall(s, id++, "chapter", { session: "tab-1", text: "Seated the relief valve; the loop holds pressure now." });
    expect(chapter["stored"]).toBe(true);
    expect(chapter["session"]).toBe("tab-1");
    expect(chapter["writeUpAsk"]).toBeUndefined();
    expectUnbound(s);
    const ended = await wireCall(s, id++, "session_end", {
      session: "tab-1",
      memories: [{ content: "The reservoir loop loses pressure unless the relief valve is seated first.", kind: "fact" }],
      handoff: "Code tab: the valve is seated; the gauges are next.",
    });
    expect(ended["deposited"]).toBe(1);
    expect(ended["boundBy"]).toBeUndefined();
    expect((ended["handoff"] as Record<string, unknown>)["written"]).toBe(true);
    expect(s.counterpart.spans.proposalRecords<ProposalRecord>(project).some((p) => p.session === "tab-1" && p.accepted === true)).toBe(true);
    expect(s.counterpart.spans.proposalRecords<ProposalRecord>(DESKTOP_SCOPE).some((p) => p.session === "tab-1")).toBe(false);
    // The handoff is the project's, not Desktop's place.
    expect(s.counterpart.readHandoffs(project).map((h) => h.session)).toEqual(["tab-1"]);
    expect(s.counterpart.readHandoffs(DESKTOP_SCOPE)).toEqual([]);
    expectUnbound(s);

    // And the very next Desktop call, unnamed, falls back to the Desktop chat — never to the Code tab.
    const after = await wireCall(s, id++, "status");
    expect(after["boundTo"]).toBe(chat);
  });

  test("ended, stale and unknown ids are refused by name; a Desktop id still binds as a Desktop chat", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    // Ended: the hooks wrote its end.
    recordSession(dir, { sessionId: "tab-ended", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    recordSession(dir, { sessionId: "tab-ended", scope: project, phase: "end", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    const ended = payload(await s.call("chapter", { session: "tab-ended", text: "x" }));
    expect(ended["reason"]).toBe("session-not-live");
    expect(String(ended["detail"])).toContain("Claude Code session");
    // Stale: silent past the TTL.
    recordSession(dir, { sessionId: "tab-quiet", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    t.advance(SESSION_TTL_MS + MIN);
    expect(payload(await s.call("session_end", { session: "tab-quiet", memories: [] }))["reason"]).toBe("session-not-live");
    // Unknown: no record at all.
    const unknown = payload(await s.call("chapter", { session: "nobody-1", text: "x" }));
    expect(unknown["reason"]).toBe("session-unknown");
    expect(String(unknown["detail"])).toContain("Claude Code session");
    // A Desktop chat's id is a Desktop chat's, as before.
    const chat = payload(await s.call("wake", {}))["session"] as string;
    const chatChapter = payload(await s.call("chapter", { session: chat, text: "A Desktop chat's chapter." }));
    expect(chatChapter["session"]).toBe(chat);
    expect(s.events("mcp.session.served")).toEqual([]);
    expectUnbound(s);
  });

  test("a write-up runner is never served through the Code-tab path — not by its prefix, not by a grant on a Code-tab record (review of #308)", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    // A live Code-tab-shaped record with the nightly runner's id.
    recordSession(dir, { sessionId: "writeup-nrn_x", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    // And a genuine Code-tab session that somehow carries a grant.
    recordSession(dir, { sessionId: "tab-granted", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    expect(grantWriteUps(dir, { runner: "tab-granted", scope: project, subjects: ["old-1"], at: t.now() })).toBe(true);
    for (const id of ["writeup-nrn_x", "tab-granted"]) {
      const out = payload(await s.call("session_end", { session: id, memories: [{ content: "A first-hand memory nobody lived here.", kind: "fact" }] }));
      expect(out["stored"]).toBe(false);
      expect(s.events("mcp.session.served").filter((e) => e.ref === id)).toEqual([]);
    }
  });

  test("the Code-tab session's own directory setting governs its calls, in Claude Code's words — Desktop's place is untouched", async () => {
    const t = clock();
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    const s = desktopServer({ now: t.now, scopesFile });
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    const chat = payload(await s.call("wake", {}))["session"] as string;

    // The scope tool, named, sets the PROJECT — in Claude Code's words.
    const off = payload(await s.call("scope", { session: "tab-1", mode: "off" }));
    expect(off).toMatchObject({ set: true, scope: project, mode: "off", detail: wordingFor(DEFAULT_HOST).scopeOff });
    const registry = readScopes(scopesFile).registry;
    expect(lookupScope(registry, project).mode).toBe("off");
    expect(lookupScope(registry, DESKTOP_SCOPE).mode).toBe("unset");

    // Every other tool, named, now refuses there in Claude Code's words.
    const refused = payload(await s.call("remember", { session: "tab-1", text: "Should not land." }));
    expect(refused["reason"]).toBe("scope-off");
    expect(refused["detail"]).toBe(wordingFor(DEFAULT_HOST).offRefusal);
    // The Desktop chat is not off.
    expect(payload(await s.call("remember", { session: chat, text: "The bakery opens at seven on weekdays." }))["stored"]).toBe(true);
    expectUnbound(s);

    // And back on, from the same door.
    expect(payload(await s.call("scope", { session: "tab-1", mode: "on" }))["detail"]).toBe(wordingFor(DEFAULT_HOST).scopeOn);
    expect(payload(await s.call("remember", { session: "tab-1", text: "The gauge on the loop reads low until the pump warms up." }))["stored"]).toBe(true);
  });

  test("the heartbeat reads the SERVER's place, never a call's — even when it ticks mid-call", async () => {
    const t = clock();
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    let ticked = 0;
    let s: McpServer;
    // A question embedder that lets the heartbeat tick while a served call is
    // awaiting — the window a timer can land in.
    const embedder = {
      vector: async (): Promise<number[] | null> => {
        (s as unknown as { beat(first: boolean): unknown }).beat(false);
        ticked++;
        return null;
      },
    };
    s = desktopServer({ now: t.now, scopesFile, embedder });
    expect(s.recordLaunch({ pid: 999_001, hostPid: 999_000, heartbeatMs: 0 })?.scope).toBe(DESKTOP_SCOPE);
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    // Desktop's place OFF; the Code tab's project stays on.
    expect(payload(await s.call("scope", { mode: "off" }))["scope"]).toBe(DESKTOP_SCOPE);
    const out = payload(await s.call("recall", { session: "tab-1", question: "the relief valve on the reservoir loop", mode: "facts" }));
    expect(out["reason"]).not.toBe("scope-off");
    expect(ticked).toBe(1);
    // The tick asked about claude-desktop: (off) and took the launch record
    // away — it did not read the project the call was served in.
    expect(s.events("mcp.launch.scope").map((e) => e.data?.["recorded"])).toEqual([false]);
    s.forgetLaunch();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("no session named from the Code tab: it still files under the most recent Desktop chat, and says how to correct it", () => {
  test("the bind note names the Desktop chat and tells a Claude Code session to pass its own id", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    const chat = payload(await s.call("wake", {}))["session"] as string;
    const out = payload(await s.call("status", {}));
    expect(out["boundTo"]).toBe(chat);
    expect(String(out["bindNote"])).toContain(`Desktop chat ${chat}`);
    expect(String(out["bindNote"])).toContain("If you are a Claude Code session");
    expect(String(out["bindNote"])).toContain("most recent Claude Desktop session");
  });

  test("with no Desktop chat live, a Code-tab call is told not to wake, but to pass its id", async () => {
    const s = desktopServer();
    const refused = payload(await s.call("chapter", { text: "Nothing to bind to." }));
    expect(refused["reason"]).toBe("session-required");
    expect(refused["detail"]).toBe(NO_DESKTOP_SESSION);
    expect(String(refused["detail"])).toContain("do not call wake");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the Code-tab wake line, and the descriptions", () => {
  test("only an entrypoint of `claude-desktop` gets the line; a terminal session's wake does not", () => {
    expect(codeTabSessionLine({ entrypoint: CODE_TAB_ENTRYPOINT, sessionId: "abc-1" })).toContain("pass session: abc-1 on every call");
    expect(codeTabSessionLine({ entrypoint: "cli", sessionId: "abc-1" })).toBeNull();
    expect(codeTabSessionLine({ sessionId: "abc-1" })).toBeNull();
    expect(codeTabSessionLine({ entrypoint: CODE_TAB_ENTRYPOINT, sessionId: "" })).toBeNull();

    const a = openAdapter({ dataDir: dir, owner: true }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    open.push(a.counterpart);
    const terminal = a.sessionStart({ sessionId: "term-1", scope: project, at: localDate(Date.now()), entrypoint: "cli" });
    expect(terminal.injection ?? "").not.toContain("Code tab");
    expect(terminal.injection ?? "").not.toContain("term-1");
  });

  test("wake no longer says it is never offered in Claude Code; the Desktop `session` names a Claude Code session's id too", () => {
    const wake = renderDescription(WAKE);
    expect(wake).not.toContain("it is not offered there");
    expect(wake).toContain("Desktop's Code tab");
    expect(wake).toContain("Pass your session id");
    const note = toolDefinitions(true).find((d) => d["name"] === "remember") as Record<string, unknown>;
    const session = ((note["inputSchema"] as { properties: Record<string, { description: string }> }).properties["session"]);
    expect(session?.description).toContain("in a Claude Code session");
    expect(session?.description).toContain("wake or Stop ask names");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("review of #309", () => {
  test("observer in the Code tab's project: a served `scope` call stands down — it cannot lift the observer from inside", async () => {
    const t = clock();
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    writeScopes(scopesFile, setScope(null, project, "observer", { at: new Date().toISOString() }));
    const s = desktopServer({ now: t.now, scopesFile });
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now(), entrypoint: CODE_TAB_ENTRYPOINT });
    const out = payload(await s.call("scope", { session: "tab-1", mode: "on" }));
    expect(out["set"]).not.toBe(true);
    expect(s.events("mcp.scope.set")).toEqual([]);
    expect(lookupScope(readScopes(scopesFile).registry, project).mode).toBe("observer");
    // Its note stands down too, and writes nothing.
    const noted = payload(await s.call("remember", { session: "tab-1", text: "Should not land in an observer project." }));
    expect(noted["stored"]).not.toBe(true);
    // Desktop's own place is not observer: its scope tool still works there.
    expect(payload(await s.call("scope", { mode: "on" }))["set"]).toBe(true);
  });

  test("a terminal Claude Code session is not Desktop's to serve: refused by name, and an unbound call says why", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    recordSession(dir, { sessionId: "term-1", scope: project, phase: "start", at: t.now(), entrypoint: "cli" });
    recordSession(dir, { sessionId: "old-1", scope: project, phase: "start", at: t.now() });
    for (const id of ["term-1", "old-1"]) {
      const refused = payload(await s.call("chapter", { session: id, text: "x" }));
      expect(refused["reason"]).toBe("session-not-code-tab");
      expect(String(refused["detail"])).toContain("outside Desktop's Code tab");
    }
    const noted = payload(await s.call("remember", { session: "term-1", text: "The bus to the reservoir leaves at ten past the hour." }));
    expect(noted["stored"]).toBe(true);
    expect(noted["sessionRefused"]).toBe("session-not-code-tab");
    expect(String(noted["sessionNote"])).toContain("claude-desktop:");
    expect(s.counterpart.store.row(noted["id"] as string)?.origin_scope).toBe(DESKTOP_SCOPE);
    expect(s.events("mcp.session.served")).toEqual([]);
  });

  test("idle past the TTL, then a prompt: the prompt hook makes the Code-tab session live again before the model's first call", async () => {
    const realNow = Date.now();
    // The session started, answered, then sat idle past the TTL.
    recordSession(dir, { sessionId: "tab-idle", scope: project, phase: "start", at: realNow - SESSION_TTL_MS - 10 * MIN, entrypoint: CODE_TAB_ENTRYPOINT });
    const s = desktopServer();
    // Before the prompt: a note under that id is not filed silently — it says why it ran unbound.
    const before = payload(await s.call("remember", { session: "tab-idle", text: "Before the prompt: the reservoir gate locks at dusk." }));
    expect(before["sessionRefused"]).toBe("session-not-live");
    expect(String(before["sessionNote"])).toContain("no session");
    // The person types; the UserPromptSubmit hook runs before the model calls anything.
    const a = openAdapter({ dataDir: dir, owner: true }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    open.push(a.counterpart);
    a.userPromptSubmit({ sessionId: "tab-idle", scope: project, at: localDate(Date.now()), prompt: "where were we on the gate?", entrypoint: CODE_TAB_ENTRYPOINT });
    expect(readSession(dir, "tab-idle")?.lastBoundaryAt ?? 0).toBeGreaterThanOrEqual(realNow);
    // Now the call is served as the session, in its project.
    const after = payload(await s.call("remember", { session: "tab-idle", text: "After the prompt: the reservoir gate locks at dusk, not at nine." }));
    expect(after["stored"]).toBe(true);
    expect(after["sessionRefused"]).toBeUndefined();
    expect(s.counterpart.store.row(after["id"] as string)?.origin_scope).toBe(project);
    expect(s.counterpart.store.row(after["id"] as string)?.origin_session).toBe("tab-idle");
  });

  test("the handshake's instructions and the unnamed-handoff refusal tell a Claude Code session not to wake", async () => {
    expect(DESKTOP_INSTRUCTIONS).toContain("do not call wake");
    const t = clock();
    const s = desktopServer({ now: t.now });
    payload(await s.call("wake", {}));
    const out = payload(await s.call("session_end", { memories: [], handoff: "unnamed" }));
    expect(String((out["handoff"] as Record<string, unknown>)["detail"])).toContain("Claude Code session (Desktop's Code tab)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("what each Desktop chat was shown is its own (review of #317)", () => {
  /** A plain memory to be shown and felt again. */
  function plainMemory(s: McpServer, body: string): string {
    return s.counterpart.store.put({
      type: "memory",
      kind: "fact",
      body,
      salience: { relevance: 0.7, emotional: 0.4, predictive: 0.5 },
      origin: { scope: project },
    });
  }
  async function recorded(s: McpServer, id: number, session: string, memory: string): Promise<number> {
    const out = await wireCall(s, id, "note", { session, feelingsNow: [{ id: memory, core: "calm", emotion: "relieved", strength: 0.5 }] });
    return (out["feelingsNow"] as { recorded: number }).recorded;
  }

  test("two chats on one server: chat B cannot feel again what only chat A recalled", async () => {
    const s = plainServer();
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } })]);
    // Both chats wake BEFORE the memory exists, so no wake could have shown it.
    const a = (await wireCall(s, 2, "wake"))["session"] as string;
    const b = (await wireCall(s, 3, "wake"))["session"] as string;
    expect(a).not.toBe(b);
    const x = plainMemory(s, "The gate's new latch held through the storm.");
    expect(JSON.stringify(await wireCall(s, 4, "recall", { session: a, ids: [x] }))).toContain("new latch held");
    expect(await recorded(s, 5, b, x)).toBe(0);
    expect(await recorded(s, 6, a, x)).toBe(1);
  });

  test("the SEEN_SESSIONS most recently shown chats are kept: the least recent is let go and must recall again", async () => {
    const s = plainServer();
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } })]);
    let n = 2;
    const first = (await wireCall(s, n++, "wake"))["session"] as string;
    const x = plainMemory(s, "The orchard's first pears came in small and sweet.");
    const y = plainMemory(s, "The shed roof was patched on the north side.");
    await wireCall(s, n++, "recall", { session: first, ids: [x] });
    // SEEN_SESSIONS more chats are each shown something. Partway through, the
    // first chat is shown x again: being shown makes it recent (review of
    // #319), so the chat let go past the bound is the oldest of the fresh ones.
    const chats: string[] = [];
    for (let i = 0; i < SEEN_SESSIONS; i += 1) {
      if (i === 10) await wireCall(s, n++, "recall", { session: first, ids: [x] });
      const chat = (await wireCall(s, n++, "wake"))["session"] as string;
      chats.push(chat);
      expect(JSON.stringify(await wireCall(s, n++, "recall", { session: chat, ids: [y] }))).toContain("shed roof");
    }
    const oldest = chats[0] as string;
    expect(await recorded(s, n++, oldest, y)).toBe(0);
    expect(await recorded(s, n++, first, x)).toBe(1);
    // Shown again, the one let go may feel it.
    await wireCall(s, n++, "recall", { session: oldest, ids: [y] });
    expect(await recorded(s, n++, oldest, y)).toBe(1);
  });
});
