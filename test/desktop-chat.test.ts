/**
 * CLAUDE DESKTOP'S CHAT — host groundwork PR B (2026-09-30).
 *
 * Desktop runs ONE MCP server per app, shared by every chat, with no hooks, no
 * conversation id on the wire and no transcript. So the server is its own
 * hook there: a `wake` tool mints the session and returns the briefing, a call
 * that names no session binds to the most recent live Desktop session (and
 * says so), every call refreshes the session's liveness, and the write-up ask
 * rides on a tool result once the session has gone long enough since it last
 * wrote up. Everything is keyed off the client's own name at `initialize`, so a
 * Claude Code client — Desktop's Code tab included — sees exactly what it saw
 * before.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test — the store, a fake
 * home, a fake Desktop config — removed after. No worker is ever started: every
 * server here is handed a stub spawner. Nothing reads the real
 * `claude_desktop_config.json`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import type { ProposalRecord } from "../src/core/remember/proposals.js";
import {
  DESKTOP_HOST,
  DESKTOP_SCOPE,
  hostOfClient,
  isDesktopScratchWorkspace,
  isPseudoScope,
  wordingFor,
} from "../src/adapters/hosts.js";
import {
  DESKTOP_DREAM_NOTE,
  DESKTOP_INSTRUCTIONS,
  ERROR_CODES,
  OWNER_FALSE_NOTE,
  SERVER_VERSION,
  START_PROMPT,
  TOOL_NAMES,
  WAKE,
  encodeMessage,
  openServer,
  renderDescription,
  serveStdio,
  toolDefinitions,
} from "../src/adapters/mcp/index.js";
import type { McpServer, Response, ToolResult } from "../src/adapters/mcp/index.js";
import { TUNABLES } from "../src/adapters/config.js";
import {
  DESKTOP_WAKE_KEY,
  canonicalScope,
  grantWriteUps,
  latestLiveSession,
  listSessions,
  readSession,
  recordSession,
  touchDesktopSession,
} from "../src/adapters/sessions.js";
import { canonicalScopePath, lookupScope, readScopes, setScope, writeScopes } from "../src/adapters/scopes.js";
import { WORKER_RUNNER_PATH } from "../src/adapters/spawn.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { RUNNER_PATH } from "../src/adapters/claude-code/bin/hook.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { SCOPE_ASK } from "../src/adapters/claude-code/hooks.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import type { DesktopReading } from "../src/adapters/claude-code/doctor.js";
import { EXIT, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/commands.js";
import { connectDesktop, desktopConfigPath, desktopEntry, readDesktop } from "../src/adapters/cli/desktop.js";
import { MCP_SCRIPT } from "../src/adapters/cli/install.js";
import { coverageLines } from "../src/adapters/cli/coverage.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import { localDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let root: string;
let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-desktop-")));
  dir = join(root, "store");
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

/** A clock the test turns. */
function clock(start = Date.now()): { now: () => number; advance(ms: number): void } {
  let at = start;
  return {
    now: () => at,
    advance(ms: number): void {
      at += ms;
    },
  };
}

/** A spawner that starts nothing and remembers what it was asked to start. */
function stubSpawner(): { spawner: (plan: SpawnPlan) => { pid: number }; plans: SpawnPlan[] } {
  const plans: SpawnPlan[] = [];
  return { spawner: (plan) => (plans.push(plan), { pid: 4242 }), plans };
}

function server(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({ dir, owner: true, ...opts });
  open.push(s.counterpart);
  return s;
}

function desktopServer(
  opts: Parameters<typeof openServer>[0] & { spawner?: (plan: SpawnPlan) => { pid: number } } = {},
): McpServer {
  const { spawner, ...rest } = opts;
  return server({
    host: DESKTOP_HOST,
    lifecycle: { spawner: spawner ?? stubSpawner().spawner },
    manifestVersion: () => null,
    ...rest,
  });
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

function rpc(id: number | string | null, method: string, params?: Record<string, unknown>): string {
  return encodeMessage({
    jsonrpc: "2.0",
    ...(id === null ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
  } as never);
}

/** Drive framed lines through the real stdio pump; the server keeps its state between calls. */
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

function resultOf(r: Response | undefined): Record<string, unknown> {
  return (r as unknown as { result: Record<string, unknown> }).result;
}

/** A tool call over the wire, answered with the tool result's structured payload. */
async function wireCall(s: McpServer, id: number, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const [response] = await pump(s, [rpc(id, "tools/call", { name, arguments: args })]);
  return resultOf(response)["structuredContent"] as Record<string, unknown>;
}

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("end to end over stdio, as Claude Desktop's chat (client `claude-ai`)", () => {
  test("initialize → wake → a call with no id binds to it → chapter and session_end twice each append → the ask arrives after the threshold", async () => {
    const t = clock();
    const spawn = stubSpawner();
    const s = server({ now: t.now, lifecycle: { spawner: spawn.spawner }, manifestVersion: () => null, env: {} });

    // ── the handshake: the client's name makes this Desktop's server ─────────
    const [init] = await pump(s, [
      rpc(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.14" } }),
    ]);
    const hello = resultOf(init);
    expect(hello["instructions"]).toBe(DESKTOP_INSTRUCTIONS);
    expect((hello["capabilities"] as Record<string, unknown>)["prompts"]).toBeDefined();
    expect(s.host).toBe(DESKTOP_HOST);
    expect(s.scope).toBe(DESKTOP_SCOPE);

    // ── the tools, and the prompt ─────────────────────────────────────────────
    const [list, prompts, prompt] = await pump(s, [
      rpc(2, "tools/list"),
      rpc(3, "prompts/list"),
      rpc(4, "prompts/get", { name: START_PROMPT.name }),
    ]);
    const tools = (resultOf(list)["tools"] as { name: string }[]).map((x) => x.name);
    expect(tools).toEqual([...TOOL_NAMES, "wake"]);
    expect((resultOf(prompts)["prompts"] as { title: string }[])[0]?.title).toBe("Start with Counterparts");
    expect(JSON.stringify(resultOf(prompt)["messages"])).toContain("wake");

    // ── wake: a fresh session, its record written by the server itself ───────
    const [woke] = await pump(s, [rpc(5, "tools/call", { name: "wake", arguments: {} })]);
    const wake = resultOf(woke);
    const structured = wake["structuredContent"] as Record<string, unknown>;
    const session = structured["session"] as string;
    expect(typeof session).toBe("string");
    const text = (wake["content"] as { text: string }[])[0]?.text ?? "";
    expect(text.split("\n")[0]).toContain(`Counterparts session for this chat: ${session}`);
    expect(text).toContain("Now: ");
    expect(readSession(dir, session)).toMatchObject({ host: DESKTOP_HOST, scope: DESKTOP_SCOPE, endedAt: null });
    // The first-prompt-of-the-day check: the worker was started, through the shared runner path.
    expect(spawn.plans.length).toBe(1);
    expect(spawn.plans[0]?.args).toEqual(["run", WORKER_RUNNER_PATH]);
    expect(s.counterpart.store.getMeta(DESKTOP_WAKE_KEY)).toBe(String(t.now()));

    // ── a call that names no session binds to the most recent, and says so ──
    t.advance(MIN);
    const noted = await wireCall(s, 6, "note", { text: "The reservoir loop is four miles and takes forty minutes at an easy pace." });
    expect(noted["stored"]).toBe(true);
    expect(noted["boundTo"]).toBe(session);
    expect(noted["boundBy"]).toBe("most-recent");
    expect(String(noted["bindNote"])).toContain("most recent Claude Desktop session");
    // …and moved NOTHING on that record: a fallback-bound call may be another
    // chat's (review of #294, finding 1). A call that NAMES it refreshes it.
    expect(readSession(dir, session)?.lastBoundaryAt).toBe(t.now() - MIN);
    await wireCall(s, 60, "status", { session });
    expect(readSession(dir, session)?.lastBoundaryAt).toBe(t.now());

    // ── chapter twice, session_end twice: each appends ───────────────────────
    const ch1 = await wireCall(s, 7, "chapter", { session, text: "We walked through the reservoir loop and its timing." });
    const ch2 = await wireCall(s, 8, "chapter", { session, text: "Then the relief valve, and why it is seated first." });
    expect(ch1["stored"]).toBe(true);
    expect(ch2["stored"]).toBe(true);
    expect(ch1["boundBy"]).toBeUndefined(); // named, so nothing to say
    const se1 = await wireCall(s, 9, "session_end", {
      session,
      memories: [{ content: "The relief valve has to be seated before the pump runs, or the loop loses pressure.", kind: "fact" }],
    });
    const se2 = await wireCall(s, 10, "session_end", {
      session,
      memories: [{ content: "An easy-pace reservoir loop takes about forty minutes for four miles.", kind: "fact" }],
    });
    expect(se1["deposited"]).toBe(1);
    expect(se2["deposited"]).toBe(1);
    expect(se1["writeUpAsk"]).toBeUndefined();

    // ── the ask: DESKTOP_ASK_CALLS calls AND DESKTOP_ASK_AFTER_MS since the last write-up
    t.advance(TUNABLES.DESKTOP_ASK_AFTER_MS + MIN);
    const r1 = await wireCall(s, 11, "recall", { session, question: "how long is the reservoir loop" });
    const r2 = await wireCall(s, 12, "status", { session });
    expect(r1["writeUpAsk"]).toBeUndefined();
    expect(r2["writeUpAsk"]).toBeUndefined();
    const r3 = await wireCall(s, 13, "note", { session, text: "The pump schedule runs at dawn in the summer months." });
    expect(TUNABLES.DESKTOP_ASK_CALLS).toBe(3);
    expect(String(r3["writeUpAsk"])).toContain(`session_end (session: ${session}`);
    // Once asked, not again until both arms are met again.
    const r4 = await wireCall(s, 14, "status", { session });
    expect(r4["writeUpAsk"]).toBeUndefined();
  });

  test("Cowork (`local-agent-mode-…`) is Desktop too, for now: the same wake, the same place", async () => {
    const s = server({ lifecycle: { spawner: stubSpawner().spawner }, manifestVersion: () => null, env: {} });
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "local-agent-mode-counterparts" } })]);
    expect(s.host).toBe(DESKTOP_HOST);
    expect(s.scope).toBe(DESKTOP_SCOPE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a Claude Code client sees exactly what it saw before", () => {
  test("initialize, tools/list and prompts are unchanged for `claude-code`, an unnamed client, and anyone else", async () => {
    for (const clientInfo of [{ name: "claude-code", version: "2.1" }, undefined, { name: "cursor" }]) {
      const s = server({ scope: "/scope/one" });
      const [init, list, prompts] = await pump(s, [
        rpc(1, "initialize", { protocolVersion: "2025-06-18", ...(clientInfo === undefined ? {} : { clientInfo }) }),
        rpc(2, "tools/list"),
        rpc(3, "prompts/list"),
      ]);
      expect(resultOf(init)).toEqual({
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "counterparts", version: SERVER_VERSION },
      });
      expect((resultOf(list)["tools"] as { name: string }[]).map((x) => x.name)).toEqual([...TOOL_NAMES]);
      expect((prompts as unknown as { error: { code: number } }).error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
      expect(s.host).toBe("claude-code");
      expect(s.scope).toBe("/scope/one");
      // `wake` is not a tool here.
      const [wake] = await pump(s, [rpc(4, "tools/call", { name: "wake", arguments: {} })]);
      expect((wake as unknown as { error: { code: number } }).error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
      expect(payload(await s.call("wake", {}))["reason"]).toBe("unknown-tool");
    }
  });

  test("the Code tab: Desktop's config entry loaded by Claude Code still binds a hook-registered session, lazily and for good", async () => {
    const project = join(root, "proj");
    mkdirSync(project, { recursive: true });
    recordSession(dir, { sessionId: "cc-1", scope: project, phase: "start" });
    const s = server({ scope: project, lifecycle: { spawner: stubSpawner().spawner } });
    await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-code" } })]);
    const out = payload(await s.call("chapter", { session: "cc-1", text: "A chapter from the Code tab." }));
    expect(out["stored"]).toBe(true);
    expect(s.session).toBe("cc-1");
    // Frozen for the process, as always: a second id is refused.
    recordSession(dir, { sessionId: "cc-2", scope: project, phase: "start" });
    expect(payload(await s.call("chapter", { session: "cc-2", text: "Another." }))["reason"]).toBe("session-mismatch");
    // No Desktop behaviour leaked in: no bind note, no refresh bookkeeping.
    expect(out["boundBy"]).toBeUndefined();
    expect(readSession(dir, "cc-1")?.desk).toBeUndefined();
  });

  test("the belt: a process Claude Code started stays Claude Code's even if its client says `claude-ai`", async () => {
    const project = join(root, "proj");
    mkdirSync(project, { recursive: true });
    recordSession(dir, { sessionId: "cc-1", scope: project, phase: "start" });
    for (const env of [{ CLAUDECODE: "1" }, { CLAUDE_PROJECT_DIR: project }, { CLAUDE_CODE_ENTRYPOINT: "cli" }]) {
      const s = server({ scope: project, env, lifecycle: { spawner: stubSpawner().spawner } });
      const [init, list] = await pump(s, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } }), rpc(2, "tools/list")]);
      expect(resultOf(init)["instructions"]).toBeUndefined();
      expect((resultOf(list)["tools"] as { name: string }[]).map((x) => x.name)).toEqual([...TOOL_NAMES]);
      expect(s.host).toBe("claude-code");
      expect(s.scope).toBe(project);
      expect(s.events("mcp.host.kept")[0]?.data?.["marker"]).toBe(Object.keys(env)[0] as string);
      // The hook-registered session still binds, lazily.
      const said = payload(await s.call("chapter", { session: "cc-1", text: `Still Claude Code's, under ${Object.keys(env)[0] as string}.` }));
      expect({ stored: said["stored"], reason: said["reason"] }).toMatchObject({ stored: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("binding, per call", () => {
  test("no live Desktop session: a tool that needs one refuses and names wake; one that does not runs unbound", async () => {
    const s = desktopServer();
    const refused = payload(await s.call("chapter", { text: "Nothing to bind to." }));
    expect(refused["reason"]).toBe("session-required");
    expect(String(refused["detail"])).toContain("wake");
    const noted = payload(await s.call("note", { text: "The library closes early on Sundays now, at four." }));
    expect(noted["stored"]).toBe(true);
    expect(noted["boundTo"]).toBeUndefined();
  });

  test("a named id binds when it is a live Desktop session — and each call binds afresh, never frozen", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    const a = payload(await s.call("wake", {}))["session"] as string;
    const b = payload(await s.call("wake", {}))["session"] as string;
    expect(a).not.toBe(b);
    expect(payload(await s.call("chapter", { session: a, text: "Chat A's chapter." }))["session"]).toBe(a);
    expect(payload(await s.call("chapter", { session: b, text: "Chat B's chapter." }))["session"]).toBe(b);
    // Between calls nothing is bound.
    expect(s.session).toBeNull();
  });

  test("a named id that is not a live Desktop session is refused by name; the most recent is never substituted for it", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    const live = payload(await s.call("wake", {}))["session"] as string;
    recordSession(dir, { sessionId: "cc-1", scope: join(root, "proj"), phase: "start", at: t.now(), entrypoint: "claude-desktop" });
    recordSession(dir, { sessionId: "cc-1", scope: join(root, "proj"), phase: "end", at: t.now(), entrypoint: "claude-desktop" });
    expect(payload(await s.call("chapter", { session: "nobody", text: "x" }))["reason"]).toBe("session-unknown");
    // A Claude Code session the hooks recorded is served as itself while live
    // (Desktop's Code tab, 2026-10-01: test/codetab-session.test.ts); ended, it
    // is refused by name — and the most recent Desktop chat is not substituted.
    expect(payload(await s.call("chapter", { session: "cc-1", text: "x" }))["reason"]).toBe("session-not-live");
    t.advance(5 * HOUR);
    const stale = payload(await s.call("chapter", { session: live, text: "x" }));
    expect(stale["reason"]).toBe("session-not-live");
    expect(String(stale["detail"])).toContain("wake");
  });

  test("two chats (review of #294, finding 1): chat A's unnamed calls fall back to B but never carry B's ask or move B; named calls ask A about A", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    const a = payload(await s.call("wake", {}))["session"] as string;
    t.advance(MIN);
    const b = payload(await s.call("wake", {}))["session"] as string;
    const bBefore = readSession(dir, b);
    // Chat A forgets its id: every call lands on B, the most recent — and says so.
    t.advance(TUNABLES.DESKTOP_ASK_AFTER_MS + MIN);
    for (let i = 0; i < 6; i++) {
      const out = payload(await s.call(i % 2 === 0 ? "status" : "recall", i % 2 === 0 ? {} : { question: `the reservoir loop ${String(i)}` }));
      expect(out["boundTo"]).toBe(b);
      expect(out["writeUpAsk"]).toBeUndefined();
      t.advance(MIN);
    }
    // B's record is exactly as it was: no refresh, no count — so "most recent" cannot flap.
    expect(readSession(dir, b)).toEqual(bBefore);
    // Chat A names its session on every tool — `status`, `scope` and `note` included.
    const named = [
      payload(await s.call("status", { session: a })),
      payload(await s.call("scope", { session: a })),
      payload(await s.call("note", { session: a, text: "Chat A's own note about the relief valve and the pump." })),
    ];
    expect(named.map((o) => o["boundTo"])).toEqual([undefined, undefined, undefined]);
    expect(named[0]?.["writeUpAsk"]).toBeUndefined();
    expect(named[1]?.["writeUpAsk"]).toBeUndefined();
    expect(String(named[2]?.["writeUpAsk"])).toContain(`session_end (session: ${a}`);
    expect(String(named[2]?.["writeUpAsk"])).not.toContain(b);
  });

  test("two chats (review of #295, MINOR-4): a session_end that names no session leaves no handoff — B's stands, A's memories land", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    const a = payload(await s.call("wake", {}))["session"] as string;
    t.advance(MIN);
    const b = payload(await s.call("wake", {}))["session"] as string;
    // Chat B leaves its handoff, naming itself.
    const left = payload(await s.call("session_end", { session: b, memories: [], handoff: "Chat B: the pump schedule is half rewritten; dawn runs next." }));
    expect((left["handoff"] as Record<string, unknown>)["written"]).toBe(true);
    const bRow = s.counterpart.readHandoffs(DESKTOP_SCOPE);
    expect(bRow.map((h) => h.session)).toEqual([b]);
    // Chat A forgets its id: the call falls back to B, the most recent. Its
    // handoff is refused by name; its memories land as they always did.
    t.advance(MIN);
    const out = payload(
      await s.call("session_end", {
        memories: [{ content: "Chat A found the relief valve seats only after the loop is drained.", kind: "fact" }],
        handoff: "Chat A: the relief valve is done; nothing left here.",
      }),
    );
    expect(out["boundBy"]).toBe("most-recent");
    expect(out["deposited"]).toBe(1);
    const refused = out["handoff"] as Record<string, unknown>;
    expect(refused["written"]).toBe(false);
    expect(refused["reason"]).toBe("session-unnamed");
    expect(String(refused["detail"])).toContain("Name your session to leave or retire a handoff: session:");
    // B's handoff is exactly as B left it: same row, same words, same version.
    const after = s.counterpart.readHandoffs(DESKTOP_SCOPE);
    expect(after.map((h) => [h.id, h.body, h.version])).toEqual(bRow.map((h) => [h.id, h.body, h.version]));
    // A blank field (a clear) is refused the same way, and clears nothing.
    const cleared = payload(await s.call("session_end", { memories: [], handoff: "" }));
    expect((cleared["handoff"] as Record<string, unknown>)["reason"]).toBe("session-unnamed");
    expect(s.counterpart.readHandoffs(DESKTOP_SCOPE).map((h) => h.id)).toEqual(bRow.map((h) => h.id));
    // Named, chat A leaves its own beside B's.
    const named = payload(await s.call("session_end", { session: a, memories: [], handoff: "Chat A: the valve is seated; the gauges are next." }));
    expect((named["handoff"] as Record<string, unknown>)["written"]).toBe(true);
    expect((named["handoff"] as Record<string, unknown>)["others"]).toEqual([
      expect.objectContaining({ id: bRow[0]?.id, session: b }),
    ]);
    expect(s.counterpart.readHandoffs(DESKTOP_SCOPE)).toHaveLength(2);
  });

  test("two chats (review of #295, MINOR-4): retireHandoff with no session named retires nothing", async () => {
    const t = clock();
    const s = desktopServer({ now: t.now });
    payload(await s.call("wake", {}));
    t.advance(MIN);
    const b = payload(await s.call("wake", {}))["session"] as string;
    await s.call("session_end", { session: b, memories: [], handoff: "Chat B: the pump schedule is half rewritten; dawn runs next." });
    const id = s.counterpart.readHandoff(DESKTOP_SCOPE)?.id as string;
    t.advance(MIN);
    const out = payload(
      await s.call("session_end", {
        memories: [{ content: "Chat A learned the gauges read low until the loop warms up.", kind: "fact" }],
        retireHandoff: [id],
      }),
    );
    expect(out["deposited"]).toBe(1);
    const retired = out["retired"] as Record<string, unknown>[];
    expect(retired).toHaveLength(1);
    expect(retired[0]?.["reason"]).toBe("session-unnamed");
    expect(s.counterpart.store.row(id)?.archived).toBe(0);
    expect(s.counterpart.readHandoff(DESKTOP_SCOPE)?.id).toBe(id);
    // An empty list is an unused field, not an ask to retire.
    const quiet = payload(await s.call("session_end", { memories: [], retireHandoff: [] }));
    expect(quiet["retired"]).toBeUndefined();
  });

  test("every Desktop tool schema takes an optional `session`; Claude Code's schemas are untouched", () => {
    const props = (t: Record<string, unknown>): Record<string, unknown> =>
      ((t["inputSchema"] as { properties?: Record<string, unknown> }).properties ?? {});
    for (const t of toolDefinitions(true)) {
      if (t["name"] === "wake") continue;
      expect(props(t)["session"]).toBeDefined();
      expect(((t["inputSchema"] as { required?: string[] }).required ?? []).includes("session")).toBe(false);
    }
    for (const name of ["note", "recall", "status", "scope"]) {
      expect(props(toolDefinitions(false).find((t) => t["name"] === name) as Record<string, unknown>)["session"]).toBeUndefined();
    }
  });

  test("the most recent live Desktop session is the one a bare call takes", () => {
    const now = Date.now();
    recordSession(dir, { sessionId: "d-old", scope: DESKTOP_SCOPE, phase: "start", at: now - 2 * HOUR, host: DESKTOP_HOST });
    recordSession(dir, { sessionId: "d-new", scope: DESKTOP_SCOPE, phase: "start", at: now - HOUR, host: DESKTOP_HOST });
    recordSession(dir, { sessionId: "cc-newest", scope: "/x", phase: "start", at: now });
    expect(latestLiveSession(dir, DESKTOP_HOST, now)?.sessionId).toBe("d-new");
    expect(latestLiveSession(dir, DESKTOP_HOST, now + 5 * HOUR)).toBeNull();
    expect(listSessions(dir).map((r) => r.sessionId)).toEqual(["cc-newest", "d-new", "d-old"]);
  });

  test("the pacer: calls and time since the later of wake, last write-up and last ask", () => {
    const t0 = Date.now();
    recordSession(dir, { sessionId: "d-1", scope: DESKTOP_SCOPE, phase: "start", at: t0, host: DESKTOP_HOST });
    const opts = { askCalls: 3, askAfterMs: 20 * MIN };
    // Three calls, but too soon.
    for (let i = 0; i < 3; i++) expect(touchDesktopSession(dir, "d-1", { now: t0 + i, wroteUp: false, ...opts })?.ask).toBe(false);
    // Time has passed: the fourth call is due.
    expect(touchDesktopSession(dir, "d-1", { now: t0 + 21 * MIN, wroteUp: false, ...opts })?.ask).toBe(true);
    // A write-up restarts it.
    expect(touchDesktopSession(dir, "d-1", { now: t0 + 22 * MIN, wroteUp: true, ...opts })?.desk).toEqual({ calls: 0, since: t0 + 22 * MIN });
    // A call that may not ask is counted and asks nothing.
    for (let i = 0; i < 5; i++) {
      expect(touchDesktopSession(dir, "d-1", { now: t0 + 60 * MIN, wroteUp: false, mayAsk: false, ...opts })?.ask).toBe(false);
    }
    // A call that did not NAME the session touches nothing at all.
    const before = readSession(dir, "d-1");
    expect(touchDesktopSession(dir, "d-1", { now: t0 + 90 * MIN, wroteUp: false, named: false, ...opts })?.ask).toBe(false);
    expect(readSession(dir, "d-1")).toEqual(before);
    // Only an existing record is touched.
    expect(touchDesktopSession(dir, "nobody", { now: t0, wroteUp: false, ...opts })).toBeNull();
    expect(existsSync(join(dir, "sessions", "nobody.json"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the wake's parts", () => {
  test("its description is rendered from the registry, every claim names a path on disk, and it is offered to Desktop only", () => {
    expect(toolDefinitions(false).some((t) => t["name"] === "wake")).toBe(false);
    const shipped = toolDefinitions(true).find((t) => t["name"] === "wake");
    expect(shipped?.["description"]).toBe(renderDescription(WAKE));
    const repo = join(import.meta.dir, "..");
    for (const p of WAKE.privileges) {
      const paths = p.mechanizedBy.match(/src\/[A-Za-z0-9/_.-]+\.ts/g) ?? [];
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) expect(existsSync(join(repo, path))).toBe(true);
    }
    for (const n of WAKE.negativeExamples) expect(n.toLowerCase()).toContain("do not");
    expect(TOOL_NAMES).not.toContain("wake");
  });

  test("the update and doctor notices ride as plain lines, in Desktop's words", async () => {
    const s = desktopServer({ manifestVersion: () => "99.0.0", wakeNotice: () => "counterparts: Worker — refused 4 times today." });
    const text = String(payload(await s.call("wake", {}))["wake"]);
    expect(text).toContain(`Counterparts was updated. ${wordingFor(DESKTOP_HOST).reconnect}`);
    expect(text).toContain("Quit and reopen Claude Desktop");
    expect(text).not.toContain("/mcp");
    expect(text).toContain("counterparts: Worker — refused 4 times today.");
    // An older build on disk is "changed", not "updated".
    const older = desktopServer({ manifestVersion: () => "0.0.1" });
    expect(String(payload(await older.call("wake", {}))["wake"])).toContain("Counterparts was changed to an older version.");
  });

  test("the day's dream line: an ASK is said and claimed, with the one line that makes it true in Desktop; `auto` is left for Claude Code, unclaimed", async () => {
    const at = new Date("2026-09-26T12:00:00").getTime();
    const s = desktopServer({ now: () => at });
    const c = s.counterpart;
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    for (const body of [
      "The migration step must run before the container boots, or it boots empty.",
      "Mike likes to talk decisions through out loud before he commits to one.",
      "I say what I do not know before I guess.",
      "The staging deploy needs its secrets file mounted read-only.",
    ]) {
      const day = c.store.livedDay();
      c.store.put({ type: "memory", kind: "fact", body, physics: { birthDay: day, lastUsedDay: day } });
    }
    expect(c.dreams.setSetting("auto", { by: "owner" }).ok).toBe(true);
    const auto = String(payload(await s.call("wake", {}))["wake"]);
    expect(auto).not.toContain(DESKTOP_DREAM_NOTE);
    expect(s.events("mcp.wake.dream").some((e) => e.data?.["left"] === "headless")).toBe(true);
    // Unclaimed: the day's headless offer is still there for Claude Code's first prompt.
    expect(c.dreams.offer({ at: localDate(at, c.store.zone()), session: "cc-1" })?.headless).toBe(true);

    expect(c.dreams.setSetting("ask", { by: "owner" }).ok).toBe(true);
    const ask = String(payload(await s.call("wake", {}))["wake"]);
    expect(ask).toContain('phase "launch"');
    expect(ask).toContain(DESKTOP_DREAM_NOTE);
    // Claimed: once a day.
    expect(String(payload(await s.call("wake", {}))["wake"])).not.toContain(DESKTOP_DREAM_NOTE);
  });

  test("status explains `owner: false` in one phrase, and says nothing extra for the owner", async () => {
    const s = desktopServer({ owner: false });
    const stance = payload(await s.call("status", {}))["stance"] as Record<string, unknown>;
    expect(stance).toMatchObject({ owner: false, ownerMeans: OWNER_FALSE_NOTE });
    const owner = desktopServer({ owner: true });
    expect((payload(await owner.call("status", {}))["stance"] as Record<string, unknown>)["ownerMeans"]).toBeUndefined();
  });

  test("observer: wake stands down over the wire and writes nothing", async () => {
    const seed = Counterpart.open({ dir });
    seed.close();
    const s = desktopServer({ observer: true });
    const out = payload(await s.call("wake", {}));
    expect(out["stoodDown"]).toBe(true);
    expect(listSessions(dir)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the place: `claude-desktop:` is a name, not a directory", () => {
  test("canonicalising leaves it alone, in every process, whatever the working directory", () => {
    expect(isPseudoScope(DESKTOP_SCOPE)).toBe(true);
    for (const notOne of ["/tmp/x", "c:", "C:\\x", "rel/x:", "claude-desktop:/etc", ""]) expect(isPseudoScope(notOne)).toBe(false);
    expect(canonicalScope(DESKTOP_SCOPE)).toBe(DESKTOP_SCOPE);
    expect(canonicalScopePath(DESKTOP_SCOPE)).toBe(DESKTOP_SCOPE);
  });

  test("the scope tool reads and sets it under that name, in Desktop's words, and `off` silences every other tool", async () => {
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    const s = desktopServer({ scopesFile });
    const off = payload(await s.call("scope", { mode: "off" }));
    expect(off).toMatchObject({ set: true, scope: DESKTOP_SCOPE, mode: "off", detail: wordingFor(DESKTOP_HOST).scopeOff });
    const read = readScopes(scopesFile);
    expect(read.refused).toEqual([]);
    expect(lookupScope(read.registry, DESKTOP_SCOPE).mode).toBe("off");
    // A directory is not governed by it, nor it by a directory.
    expect(lookupScope(read.registry, "/Users/someone/proj").mode).toBe("unset");
    expect(payload(await s.call("wake", {}))["reason"]).toBe("scope-off");
    expect(listSessions(dir)).toEqual([]);
    const on = payload(await s.call("scope", { mode: "on" }));
    expect(on["detail"]).toBe(wordingFor(DESKTOP_HOST).scopeOn);
    expect(payload(await s.call("wake", {}))["session"]).toBeDefined();
  });

  test("`off` in Desktop's words: the refusal names claude-desktop:, never `counterparts scope .`", async () => {
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    const s = desktopServer({ scopesFile });
    await s.call("scope", { mode: "off" });
    const refused = payload(await s.call("note", { text: "Should not land." }));
    expect(refused["detail"]).toBe(wordingFor(DESKTOP_HOST).offRefusal);
    expect(String(refused["detail"])).toContain("counterparts scope claude-desktop: --on");
    expect(String(refused["detail"])).not.toContain("scope . ");
    await s.call("scope", { mode: "pause" });
    expect(String(payload(await s.call("note", { text: "Nor this." }))["detail"])).toContain("claude-desktop: --resume");
    // Claude Code's refusal is what it was.
    expect(wordingFor("claude-code").offRefusal).toBe(
      "Counterparts is off for this directory. Nothing is recorded or read here — call `scope` with mode `on`, or run `counterparts scope . --on`.",
    );
  });

  test("observer on claude-desktop: takes effect at once, per call — and the scope tool can still set it back", async () => {
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    const s = desktopServer({ scopesFile, owner: true });
    const session = payload(await s.call("wake", {}))["session"] as string;
    expect(payload(await s.call("scope", { mode: "observer" }))["set"]).toBe(true);
    expect(s.observer).toBe(true);
    expect(s.owner).toBe(false);
    expect(payload(await s.call("note", { session, text: "An observer writes nothing." }))["stoodDown"]).toBe(true);
    expect(payload(await s.call("wake", {}))["stoodDown"]).toBe(true);
    expect(payload(await s.call("scope", { mode: "on" }))["set"]).toBe(true);
    expect(s.observer).toBe(false);
    expect(payload(await s.call("note", { session, text: "Back on: this note lands in Desktop's place." }))["stored"]).toBe(true);
  });

  test("Desktop never inherits the launch directory's observer; any other client still gets it", async () => {
    const scopesFile = join(root, "config", "scopes.json");
    mkdirSync(dirname(scopesFile), { recursive: true });
    const cwd = join(root, "somewhere");
    mkdirSync(cwd, { recursive: true });
    writeScopes(scopesFile, setScope(null, cwd, "observer", { at: new Date().toISOString() }));
    // What `bin/serve.ts` does when Claude Code did not start the process: the
    // store opens as a writer and the server holds the launch directory's observer.
    const desktop = server({ scopesFile, launchObserver: true, env: {}, lifecycle: { spawner: stubSpawner().spawner }, manifestVersion: () => null });
    expect(desktop.observer).toBe(true);
    await pump(desktop, [rpc(1, "initialize", { clientInfo: { name: "claude-ai" } })]);
    expect(desktop.observer).toBe(false);
    expect(payload(await desktop.call("wake", {}))["session"]).toBeDefined();
    const other = server({ scope: cwd, scopesFile, launchObserver: true, env: {} });
    await pump(other, [rpc(1, "initialize", { clientInfo: { name: "cursor" } })]);
    expect(other.observer).toBe(true);
    expect(payload(await other.call("note", { text: "An observer directory writes nothing." }))["stoodDown"]).toBe(true);
  });

  test("a root `off` does not reach it — it has no parent directory", () => {
    const reg = setScope(null, "/", "off", { at: new Date().toISOString() });
    expect(lookupScope(reg, DESKTOP_SCOPE).mode).toBe("unset");
    const file = join(root, "scopes.json");
    writeScopes(file, setScope(reg, DESKTOP_SCOPE, "observer", { at: new Date().toISOString() }));
    expect(lookupScope(readScopes(file).registry, DESKTOP_SCOPE).mode).toBe("observer");
  });

  test("Claude Code's scope wording is byte for byte what it was", () => {
    expect(wordingFor("claude-code").scopeOff).toBe(
      "This directory is no longer recorded or read. The hooks will produce nothing here and every other tool will refuse until it is turned back on — including in a new session, which is the point.",
    );
    expect(wordingFor("claude-code").scopeOn).toStartWith("Recorded. This takes effect for the tools immediately, and for the hooks at their next boundary in this session.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("detection and shared leaves", () => {
  test("the client's name decides: `claude-ai` and `local-agent-mode-*` are Desktop, anything else is not", () => {
    expect(hostOfClient("claude-ai")).toBe(DESKTOP_HOST);
    expect(hostOfClient("local-agent-mode-counterparts")).toBe(DESKTOP_HOST);
    for (const other of ["claude-code", "Claude-AI", "cursor", "", undefined, 7]) expect(hostOfClient(other)).toBeNull();
  });

  test("the worker's runner path the server names IS the hooks' runner path", () => {
    expect(WORKER_RUNNER_PATH).toBe(RUNNER_PATH);
    expect(existsSync(WORKER_RUNNER_PATH)).toBe(true);
  });

  test("the write-up pointer's gave-way event names the host's moment (wake), not session-start", () => {
    const s = desktopServer();
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const lc = new Lifecycle({ counterpart: s.counterpart, config: { dataDir: dir }, host: DESKTOP_HOST, onEvent: (e) => events.push(e) });
    // The label is proved on the event the pointer gives when it has no room,
    // for a Desktop session that ended owing (seeded here by hand: Desktop
    // itself captures nothing, but a later host of the same place might).
    let at = Date.now() - 2 * DAY;
    const seeded = Counterpart.open({ dir, owner: true, now: () => at });
    open.push(seeded);
    recordSession(dir, { sessionId: "old-d", scope: DESKTOP_SCOPE, phase: "start", at });
    const turns: { role: "user"; text: string }[] = [];
    for (let i = 0; i < 6; i++) {
      at += 8 * MIN;
      turns.push({ role: "user", text: `piece ${String(i)}: the relief valve is seated before the pump runs, every time.` });
      seeded.captureSpans({ session: "old-d", scope: DESKTOP_SCOPE, turns: [...turns] });
    }
    recordSession(dir, { sessionId: "old-d", scope: DESKTOP_SCOPE, phase: "end", at });
    recordSession(dir, { sessionId: "new-d", scope: DESKTOP_SCOPE, phase: "start" });
    const out = lc.deliverWriteUpAsk({ sessionId: "new-d", scope: DESKTOP_SCOPE, at: localDate(Date.now(), s.counterpart.store.zone()) }, 1_000_000, {
      limit: TUNABLES.TOOL_RESULT_CHARS,
      label: "wake",
    });
    expect(out).toBe("");
    expect(events.find((e) => e.name === "adapter.envelope.gave-way")?.data).toMatchObject({ hook: "wake", part: "pointer" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("writeUpFor's shape — `mayWriteUp` on the runner's own record — and the door that reads it", () => {
  const PIECE_GAP = 8 * MIN;

  /** A session that talked in `scope` two days ago and ENDED owing a write-up. */
  function endedOwing(id: string, scope: string, opts: { end?: boolean } = {}): void {
    let at = Date.now() - 2 * DAY;
    const c = Counterpart.open({ dir, owner: true, now: () => at });
    recordSession(dir, { sessionId: id, scope, phase: "start", at });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (let i = 0; i < 6; i++) {
      at += PIECE_GAP;
      turns.push({ role: "user", text: `${id} #${String(i)}: the relief valve is seated before the pump runs, or the loop loses pressure.` });
      c.captureSpans({ session: id, scope, turns: [...turns] });
    }
    c.boundary({ session: id, scope, kind: "stop" });
    if (opts.end !== false) {
      c.boundary({ session: id, scope, kind: "session-end" });
      recordSession(dir, { sessionId: id, scope, phase: "end", at: at + 1 });
    } else {
      recordSession(dir, { sessionId: id, scope, phase: "boundary", at });
    }
    c.close();
  }

  test("granted, ended and owed: fetched and answered from ANOTHER directory, the memories filed where the subject was lived", async () => {
    const proj = join(root, "proj");
    const runnerDir = join(root, "runner");
    mkdirSync(proj, { recursive: true });
    mkdirSync(runnerDir, { recursive: true });
    endedOwing("old-1", proj);
    // The LAUNCHER writes the grant; the runner's own hooks later rewrite its record whole and keep it.
    expect(grantWriteUps(dir, { runner: "night-1", scope: runnerDir, subjects: ["old-1"] })).toBe(true);
    recordSession(dir, { sessionId: "night-1", scope: runnerDir, phase: "boundary" });
    expect(readSession(dir, "night-1")?.mayWriteUp).toEqual(["old-1"]);

    const s = server({ scope: runnerDir });
    const fetched = payload(await s.call("session_end", { session: "night-1", writeUp: "old-1" }));
    expect(fetched).toMatchObject({ reason: "part", ended: "old-1", part: 1 });
    const answered = payload(
      await s.call("session_end", {
        session: "night-1",
        writeUp: "old-1",
        memories: [{ content: "The relief valve must be seated before the pump runs, or the reservoir loop loses pressure.", kind: "fact" }],
      }),
    );
    expect(answered).toMatchObject({ reason: "written-up", marked: true, deposited: 1 });
    const spans = s.counterpart.spans;
    // Filed under the SUBJECT's scope, not the runner's.
    expect(spans.proposalRecords<ProposalRecord>(proj).some((p) => p.accepted === true && p.session === "night-1")).toBe(true);
    expect(spans.proposalRecords<ProposalRecord>(runnerDir).some((p) => p.session === "night-1")).toBe(false);
    expect(spans.writeUps(proj).some((w) => w.session === "old-1")).toBe(true);
  });

  test("the door rule, each arm: not listed → other-project; listed and still at work today → live-session; a crash with no end, quiet since → served (2026-10-01); a model cannot grant", async () => {
    const proj = join(root, "proj");
    const runnerDir = join(root, "runner");
    mkdirSync(proj, { recursive: true });
    mkdirSync(runnerDir, { recursive: true });
    endedOwing("old-1", proj);
    endedOwing("quiet-1", proj, { end: false });
    // At work today: it said something a moment ago and has not ended.
    {
      const c = Counterpart.open({ dir, owner: true });
      recordSession(dir, { sessionId: "busy-1", scope: proj, phase: "start" });
      c.captureSpans({ session: "busy-1", scope: proj, turns: [{ role: "user", text: "The busy session's turn about the pump, today." }] });
      c.close();
    }
    recordSession(dir, { sessionId: "night-1", scope: runnerDir, phase: "start" });
    const s = server({ scope: runnerDir });
    // Not listed: the ordinary path, which is this server's project only.
    expect(payload(await s.call("session_end", { session: "night-1", writeUp: "old-1" }))["reason"]).toBe("other-project");
    grantWriteUps(dir, { runner: "night-1", scope: runnerDir, subjects: ["busy-1"] });
    const busy = payload(await s.call("session_end", { session: "night-1", writeUp: "busy-1" }));
    expect(busy).toMatchObject({ reason: "live-session" });
    expect(String(busy["detail"])).toContain("still at work today");
    // A CRASH: no end on any record, quiet since the date changed — the
    // ledger's "not at work" is enough (#289's evidence), and it is served.
    grantWriteUps(dir, { runner: "night-1", scope: runnerDir, subjects: ["quiet-1"] });
    expect(payload(await s.call("session_end", { session: "night-1", writeUp: "quiet-1" }))).toMatchObject({ reason: "part", ended: "quiet-1" });
    // No tool writes the field: a `mayWriteUp` argument is not a grant.
    expect(payload(await s.call("session_end", { session: "night-1", writeUp: "old-1", mayWriteUp: ["old-1"] }))["reason"]).toBe("other-project");
    expect(readSession(dir, "night-1")?.mayWriteUp).toEqual(["quiet-1"]);
    // A malformed grant is no grant.
    expect(grantWriteUps(dir, { runner: "night-1", scope: runnerDir, subjects: ["../etc"] })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("install --host claude-desktop", () => {
  const OTHER_SERVER = {
    command: "/usr/local/bin/other-mcp",
    args: ["--port", "9"],
    env: { OTHER_KEY: "keep me exactly" },
  };

  function seedDesktopConfig(home: string, extra: Record<string, unknown> = {}): string {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ mcpServers: { other: OTHER_SERVER }, globalShortcut: "Cmd+K", ...extra }, null, 2)}\n`);
    return path;
  }

  test("backs the file up, merges only `counterparts`, leaves every other byte of the other server alone — and a second run changes nothing", async () => {
    const home = join(root, "home");
    const configPath = join(root, "elsewhere", "claude-code.json");
    const path = seedDesktopConfig(home);
    const before = readFileSync(path, "utf8");
    const otherBlock = JSON.stringify({ other: OTHER_SERVER }, null, 2).split("\n").slice(1, -1).join("\n").replace(/^/gm, "  ");
    expect(before).toContain(otherBlock);

    const c = consoleWith();
    const code = await run(["install", "--host", "claude-desktop", "--budget", "9000", "--name", "Ada", "--config", configPath], { io: c.io, env: {}, home });
    expect({ code, err: c.err }).toEqual({ code: EXIT.ok, err: [] });
    expect(c.out.join("\n")).toContain("Claude Desktop: connected");
    const after = readFileSync(path, "utf8");
    // The other server's bytes are unchanged, and so is the unrelated key.
    expect(after).toContain(otherBlock);
    const parsed = JSON.parse(after) as { mcpServers: Record<string, unknown>; globalShortcut: string };
    expect(parsed.globalShortcut).toBe("Cmd+K");
    expect(parsed.mcpServers["other"]).toEqual(OTHER_SERVER);
    const store = join(root, "elsewhere", "store");
    expect(parsed.mcpServers["counterparts"]).toEqual(desktopEntry(store, process.execPath, configPath));
    expect((parsed.mcpServers["counterparts"] as { args: string[] }).args).toEqual(["run", MCP_SCRIPT]);
    // Backed up first, beside itself, holding the original bytes.
    const backups = readdirSync(dirname(path)).filter((n) => n.includes("counterparts-backup"));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(dirname(path), backups[0] as string), "utf8")).toBe(before);
    // No Claude Code wiring on this arm.
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);

    // Idempotent: the same entry again writes nothing and backs nothing up.
    const again = consoleWith();
    expect(await run(["install", "--host", "claude-desktop", "--config", configPath], { io: again.io, env: {}, home })).toBe(EXIT.ok);
    expect(again.out.join("\n")).toContain("already connected");
    expect(readFileSync(path, "utf8")).toBe(after);
    expect(readdirSync(dirname(path)).filter((n) => n.includes("counterparts-backup")).length).toBe(1);
  });

  test("replacing an entry that named another store says which store that was, and tells people to quit Desktop first", async () => {
    const home = join(root, "home");
    const configPath = join(root, "elsewhere", "claude-code.json");
    seedDesktopConfig(home, {});
    connectDesktop({ home, store: "/old/store", exe: "/bun", now: Date.now() });
    const c = consoleWith();
    const code = await run(["install", "--host", "claude-desktop", "--config", configPath], { io: c.io, env: {}, home });
    expect(code).toBe(EXIT.ok);
    const said = c.out.join("\n");
    expect(said).toContain("entry updated");
    expect(said).toContain("It named another store before: /old/store");
    expect(said).toContain("quit it and run this again");
  });

  test("with no Desktop config yet, one is created; a config that is not JSON is refused and left alone; an unknown host is a usage error", async () => {
    const home = join(root, "home");
    const made = connectDesktop({ home, store: "/s", exe: "/bun", now: Date.now() });
    expect(made).toMatchObject({ outcome: "added", backup: null });
    expect(JSON.parse(readFileSync(desktopConfigPath(home), "utf8"))).toEqual({ mcpServers: { counterparts: desktopEntry("/s", "/bun") } });

    const broken = join(root, "home2");
    mkdirSync(dirname(desktopConfigPath(broken)), { recursive: true });
    writeFileSync(desktopConfigPath(broken), "{ not json");
    expect(connectDesktop({ home: broken, store: "/s", exe: "/bun", now: Date.now() }).outcome).toBe("refused");
    expect(readFileSync(desktopConfigPath(broken), "utf8")).toBe("{ not json");

    const c = consoleWith();
    expect(await run(["install", "--host", "cursor", "--config", join(root, "x", "claude-code.json")], { io: c.io, env: {}, home })).toBe(EXIT.usage);
  });

  test("the Code-tab name clash: both entries named `counterparts` — green and said when they name one store, amber when they do not", () => {
    const home = join(root, "home");
    seedDesktopConfig(home, {});
    connectDesktop({ home, store: dir, exe: "/bun", now: Date.now() });
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: { command: "/bun", env: { COUNTERPARTS_DATA_DIR: dir } } } }));
    const reading = readDesktop(home, {});
    expect(reading).toMatchObject({ state: "entry", dataDir: dir, codeTab: true, codeDataDir: dir });
    const green = desktopLine(reading);
    expect(green?.severity).toBe("green");
    expect(green?.detail).toContain("its Code tab's counterparts tools come from this entry's server, which shadows ~/.claude.json's");

    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: { command: "/bun", env: { COUNTERPARTS_DATA_DIR: "/some/other/store" } } } }));
    const amber = desktopLine(readDesktop(home, {}));
    expect(amber?.severity).toBe("amber");
    expect(amber?.detail).toContain("different stores");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
function desktopLine(desktop: DesktopReading): { severity: string; detail: string } | undefined {
  const store = Counterpart.open({ dir, owner: true });
  open.push(store);
  const findings = doctorFindings({
    configPath: join(root, "claude-code.json"),
    configReason: "loaded",
    config: { dataDir: dir },
    dir,
    store: store.store,
    today: localDate(Date.now()),
    refusals: {},
    desktop,
  });
  return findings.find((f) => f.key === "desktop");
}

describe("doctor's Claude Desktop line", () => {
  test("quiet — no line at all — when there is no Desktop config or no entry in it", () => {
    for (const state of ["absent", "no-entry"] as const) {
      expect(desktopLine({ path: "/x/claude_desktop_config.json", state, dataDir: null, codeTab: false, codeDataDir: null })).toBeUndefined();
    }
  });

  test("present: when it last woke, the last session, and Desktop sessions as NOT MEASURED — never lost; amber for another store", async () => {
    const reading: DesktopReading = { path: "/x/claude_desktop_config.json", state: "entry", dataDir: dir, codeTab: false, codeDataDir: null };
    expect(desktopLine(reading)?.detail).toContain("no wake yet");
    const s = desktopServer();
    await s.call("wake", {});
    const line = desktopLine(reading);
    expect(line?.severity).toBe("green");
    expect(line?.detail).toContain("last wake");
    expect(line?.detail).toContain("last session active");
    expect(line?.detail).toContain("not measured for write-ups");
    expect(line?.detail).not.toContain("lost");
    expect(desktopLine({ ...reading, dataDir: "/some/other/store" })?.severity).toBe("amber");
  });

  test("`counterparts coverage` names a Desktop day's sessions as unmeasured", async () => {
    const s = desktopServer();
    await s.call("wake", {});
    const today = localDate(Date.now(), s.counterpart.store.zone());
    const lines = coverageLines({ store: s.counterpart.store, date: today, today });
    const line = lines.find((l) => l.startsWith("Claude Desktop:"));
    expect(line).toContain("1 session that day — unmeasured");
    expect(line).toContain("not lost");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Desktop's Code tab, 'No folder': the first-launch question is not asked in a scratch workspace", () => {
  test("a scratch workspace gets no scope question; an ordinary directory still does", () => {
    const scratch = join(root, "Library", "Application Support", "Claude", "scratch-workspaces", "a1", "b2", "scratch-2026-09-30-3b6bc6");
    const ordinary = join(root, "proj");
    mkdirSync(scratch, { recursive: true });
    mkdirSync(ordinary, { recursive: true });
    expect(isDesktopScratchWorkspace(scratch)).toBe(true);
    expect(isDesktopScratchWorkspace(ordinary)).toBe(false);
    const at = localDate(Date.now());
    for (const [scope, asks] of [
      [scratch, false],
      [ordinary, true],
    ] as const) {
      const a = openAdapter({ dataDir: dir, owner: true }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
      open.push(a.counterpart);
      const out = a.sessionStart({ sessionId: `s-${String(asks)}`, scope, at });
      expect((out.ask ?? "").includes(SCOPE_ASK)).toBe(asks);
      if (!asks) expect(a.events("adapter.scope.ask.skipped").some((e) => e.data["reason"] === "scratch-workspace")).toBe(true);
    }
  });
});
