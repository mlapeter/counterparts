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
  NO_DESKTOP_SESSION,
  WAKE,
  encodeMessage,
  openServer,
  renderDescription,
  serveStdio,
  toolDefinitions,
} from "../src/adapters/mcp/index.js";
import type { McpServer, Response, ToolResult } from "../src/adapters/mcp/index.js";
import { TUNABLES } from "../src/adapters/config.js";
import { SESSION_TTL_MS, hostOf, readSession, recordSession } from "../src/adapters/sessions.js";
import { lookupScope, readScopes } from "../src/adapters/scopes.js";
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
    recordSession(dir, { sessionId: "tab-ended", scope: project, phase: "start", at: t.now() });
    recordSession(dir, { sessionId: "tab-ended", scope: project, phase: "end", at: t.now() });
    const ended = payload(await s.call("chapter", { session: "tab-ended", text: "x" }));
    expect(ended["reason"]).toBe("session-not-live");
    expect(String(ended["detail"])).toContain("Claude Code session");
    // Stale: silent past the TTL.
    recordSession(dir, { sessionId: "tab-quiet", scope: project, phase: "start", at: t.now() });
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

  test("the Code-tab session's own directory setting governs its calls, in Claude Code's words — Desktop's place is untouched", async () => {
    const t = clock();
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    const s = desktopServer({ now: t.now, scopesFile });
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now() });
    const chat = payload(await s.call("wake", {}))["session"] as string;

    // The scope tool, named, sets the PROJECT — in Claude Code's words.
    const off = payload(await s.call("scope", { session: "tab-1", mode: "off" }));
    expect(off).toMatchObject({ set: true, scope: project, mode: "off", detail: wordingFor(DEFAULT_HOST).scopeOff });
    const registry = readScopes(scopesFile).registry;
    expect(lookupScope(registry, project).mode).toBe("off");
    expect(lookupScope(registry, DESKTOP_SCOPE).mode).toBe("unset");

    // Every other tool, named, now refuses there in Claude Code's words.
    const refused = payload(await s.call("note", { session: "tab-1", text: "Should not land." }));
    expect(refused["reason"]).toBe("scope-off");
    expect(refused["detail"]).toBe(wordingFor(DEFAULT_HOST).offRefusal);
    // The Desktop chat is not off.
    expect(payload(await s.call("note", { session: chat, text: "The bakery opens at seven on weekdays." }))["stored"]).toBe(true);
    expectUnbound(s);

    // And back on, from the same door.
    expect(payload(await s.call("scope", { session: "tab-1", mode: "on" }))["detail"]).toBe(wordingFor(DEFAULT_HOST).scopeOn);
    expect(payload(await s.call("note", { session: "tab-1", text: "The gauge on the loop reads low until the pump warms up." }))["stored"]).toBe(true);
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
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now() });
    // Desktop's place OFF; the Code tab's project stays on.
    expect(payload(await s.call("scope", { mode: "off" }))["scope"]).toBe(DESKTOP_SCOPE);
    const out = payload(await s.call("recall", { session: "tab-1", question: "the relief valve on the reservoir loop" }));
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
    recordSession(dir, { sessionId: "tab-1", scope: project, phase: "start", at: t.now() });
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
    const note = toolDefinitions(true).find((d) => d["name"] === "note") as Record<string, unknown>;
    const session = ((note["inputSchema"] as { properties: Record<string, { description: string }> }).properties["session"]);
    expect(session?.description).toContain("in a Claude Code session");
    expect(session?.description).toContain("wake or Stop ask names");
  });
});
