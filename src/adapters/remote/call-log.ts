/**
 * THE CLAUDE.AI TRIAL'S CALL LOG (2026-10-26): one JSON line per message the
 * HTTP door served (`http.ts#CallRecord`), appended to a file the entry point
 * names, so the wake rate per conversation is counted, not guessed
 * (`summarizeCalls`). Ids and codes only — the record's shape holds no
 * argument and no result text, and `http.ts` builds it that way.
 *
 * Never fails its caller: a log that cost a tool call its answer would be the
 * instrument breaking the thing it watches (`adapters/log/`'s rule).
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CallRecord } from "./http.js";

export interface CallLog {
  write(record: CallRecord): void;
}

/** Append-only, created 0600 with its directory. */
export function openCallLog(path: string): CallLog {
  return {
    write(record: CallRecord): void {
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {
        /* the call already happened */
      }
    },
  };
}

/** One connection's story. Kept for a reader that wants the wire's view;
 *  the trial's report reads per chat (`summarizeChats`). */
export interface ConnectionSummary {
  readonly connection: string;
  readonly client: string | null;
  readonly firstAt: string;
  readonly calls: number;
  /** The tools called, in order. */
  readonly tools: readonly string[];
  /** Was `wake` the first tool called on this connection? */
  readonly wokeFirst: boolean;
  readonly woke: boolean;
  readonly remembered: number;
  readonly errors: number;
}

/**
 * The call log read back, per connection (`Mcp-Session-Id`): which tools, in
 * what order, and whether `wake` came first. Lines that do not parse are
 * skipped. Pure apart from the read.
 */
export function summarizeCalls(path: string): ConnectionSummary[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const by = new Map<string, { client: string | null; firstAt: string; calls: number; tools: string[]; errors: number }>();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let r: Partial<CallRecord>;
    try {
      r = JSON.parse(line) as Partial<CallRecord>;
    } catch {
      continue;
    }
    const key = typeof r.connection === "string" ? r.connection : "(none)";
    const entry = by.get(key) ?? { client: null, firstAt: r.at ?? "", calls: 0, tools: [], errors: 0 };
    if (r.method === "initialize" && typeof r.client === "string") entry.client = r.client;
    if (r.method === "tools/call") {
      entry.calls += 1;
      entry.tools.push(typeof r.tool === "string" ? r.tool : "other");
      if (r.ok === false) entry.errors += 1;
    }
    by.set(key, entry);
  }
  return [...by.entries()].map(([connection, e]) => ({
    connection,
    client: e.client,
    firstAt: e.firstAt,
    calls: e.calls,
    tools: e.tools,
    wokeFirst: e.tools[0] === "wake",
    woke: e.tools.includes("wake"),
    remembered: e.tools.filter((t) => t === "remember").length,
    errors: e.errors,
  }));
}

/**
 * ONE CHAT'S STORY (2026-10-26, OL1b): claude.ai keeps one connection open
 * across many chats — the first day's log had a handful of `Mcp-Session-Id`s
 * for a day of conversations — so a connection is not a conversation. A chat
 * is the session its `wake` minted, and every later call that named it.
 */
export interface ChatSummary {
  /** The Counterparts session (minted by `wake`, or named by a call). */
  readonly session: string;
  /** The connection its first call came on. */
  readonly connection: string;
  readonly client: string | null;
  readonly firstAt: string;
  readonly calls: number;
  /** The tools called under this session, in order. */
  readonly tools: readonly string[];
  /** Did a `wake` in this log mint it? False for an id named but minted elsewhere (an older log, a restart). */
  readonly woke: boolean;
  readonly remembered: number;
  /** Was a chapter written under it? */
  readonly chapter: boolean;
  readonly errors: number;
}

/**
 * The calls on one connection that named no session. The server files each
 * under the most recent claude.ai session (remote INTERFACE-GAPS §2), which
 * may be another chat's, so the report counts them apart rather than guess.
 */
export interface UnnamedCalls {
  readonly connection: string;
  readonly calls: number;
  /** Of those, how many came before any wake on this connection: a chat that started without waking. */
  readonly beforeWake: number;
  readonly tools: readonly string[];
  readonly errors: number;
}

export interface ChatsReport {
  readonly chats: readonly ChatSummary[];
  readonly unnamed: readonly UnnamedCalls[];
  /** Every client name seen at `initialize`, first seen first. */
  readonly clients: readonly string[];
}

/**
 * The call log read back PER CHAT: one row per Counterparts session, in the
 * order each first appeared, plus the calls that named none, per connection.
 * Lines that do not parse are skipped. Pure apart from the read.
 */
export function summarizeChats(path: string): ChatsReport {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { chats: [], unnamed: [], clients: [] };
  }
  const clientOf = new Map<string, string>();
  const clients: string[] = [];
  const chats = new Map<string, { connection: string; firstAt: string; tools: string[]; woke: boolean; errors: number }>();
  const unnamed = new Map<string, { calls: number; beforeWake: number; tools: string[]; errors: number }>();
  const wokeOn = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let r: Partial<CallRecord>;
    try {
      r = JSON.parse(line) as Partial<CallRecord>;
    } catch {
      continue;
    }
    const connection = typeof r.connection === "string" ? r.connection : "(none)";
    if (r.method === "initialize" && typeof r.client === "string") {
      clientOf.set(connection, r.client);
      if (!clients.includes(r.client)) clients.push(r.client);
    }
    if (r.method !== "tools/call") continue;
    const tool = typeof r.tool === "string" ? r.tool : "other";
    const failed = r.ok === false;
    if (typeof r.session !== "string") {
      const u = unnamed.get(connection) ?? { calls: 0, beforeWake: 0, tools: [], errors: 0 };
      u.calls += 1;
      if (!wokeOn.has(connection)) u.beforeWake += 1;
      u.tools.push(tool);
      if (failed) u.errors += 1;
      unnamed.set(connection, u);
      continue;
    }
    const c = chats.get(r.session) ?? { connection, firstAt: r.at ?? "", tools: [], woke: false, errors: 0 };
    c.tools.push(tool);
    if (tool === "wake" && !failed) {
      c.woke = true;
      wokeOn.add(connection);
    }
    if (failed) c.errors += 1;
    chats.set(r.session, c);
  }
  return {
    chats: [...chats.entries()].map(([session, c]) => ({
      session,
      connection: c.connection,
      client: clientOf.get(c.connection) ?? null,
      firstAt: c.firstAt,
      calls: c.tools.length,
      tools: c.tools,
      woke: c.woke,
      remembered: c.tools.filter((t) => t === "remember").length,
      chapter: c.tools.includes("chapter"),
      errors: c.errors,
    })),
    unnamed: [...unnamed.entries()].map(([connection, u]) => ({ connection, ...u })),
    clients,
  };
}
