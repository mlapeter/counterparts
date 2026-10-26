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

/** One connection's story, as the trial reads it. */
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
