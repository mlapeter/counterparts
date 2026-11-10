/**
 * CODEX'S TRANSCRIPT, READ (2026-11-09, CX2) — the sibling of
 * `claude-code/transcript.ts`, for the rollout `.jsonl` Codex writes at
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<session id>.jsonl` and names
 * as `transcript_path` on every hook payload.
 *
 * MEASURED on 0.167.0 (CX1 §0b, the 11-09 probe; the shapes below, never the
 * words, are what the fixtures copy): one `{timestamp, type, payload}` object
 * per line. The types seen were `session_meta`, `event_msg`, `response_item`,
 * `world_state`, `turn_context` and `token_usage_record`. A conversation lives in
 * `response_item`s of `payload.type: "message"`:
 *
 *   - `role: "user"` whose `content_item_metadata[].provenance.type` is
 *     `"user"` — what the person typed (`content[].input_text`). CONVERSATION.
 *   - `role: "user"` with provenance `{type: "harness", hook: true}` — a Stop
 *     hook's `reason` coming back as `<hook_prompt hook_run_id="stop:…">…`.
 *     Ours (it carries our ask's opener) is `ritual`; another tool's is
 *     `plumbing`. Both enter nothing and are counted (`remember/spans.ts`).
 *   - `role: "user"` with provenance `{type: "harness", hook: false}` — Codex's
 *     own `<environment_context>`. Not a turn.
 *   - `role: "developer"` — Codex's instructions, and every hook's
 *     `additionalContext` (`content_item_kinds: ["hooks.additional_context"]`,
 *     our wake and recall among them). Not a turn: the wake is not something
 *     that happened, and it stays out of pacing as Claude Code's attachments do.
 *   - `role: "assistant"` with `content[].output_text` — the model's reply.
 *     CONVERSATION.
 *
 * `session_meta.payload.originator` says who opened the session (`codex-tui`,
 * `codex_exec`, …) and `payload.source` how (`vscode`, `exec`, …).
 * `session_meta.payload.model` was null on 0.167; the model is
 * `turn_context.payload.model` (and the hook payload's `model`).
 *
 * UNMEASURED and read loosely: tool calls (`response_item` of type
 * `function_call` with `name` and a JSON `arguments` string is the shape the
 * Responses API uses; a recall call there becomes an expansion), and a
 * `compacted` line (its `timestamp` is taken as the compaction's moment).
 *
 * A leaf of this adapter: core types only.
 */
import { readFileSync } from "node:fs";

import type { HostTurn, TurnExpansion } from "../lifecycle.js";

/** What this host's Stop ask opens with — the same words as Claude Code's, so a reader of either recognises it. */
export const CODEX_STOP_OPENER = "Counterparts, before this session closes:";

export interface CodexTranscriptRead {
  readonly turns: HostTurn[];
  readonly ok: boolean;
  readonly reason: "read" | "absent" | "unreadable";
  /** Lines that were not a JSON object. Counted, never silently swallowed. */
  readonly corrupt: number;
  readonly expansions: TurnExpansion[];
  /** The newest `turn_context.payload.model`. */
  readonly model?: string;
  /** `session_meta.payload.originator`: who opened the session. */
  readonly originator?: string;
  /** `session_meta.payload.source`: how (`vscode`, `exec`, …). */
  readonly source?: string;
  /** The newest `compacted` line's moment, epoch ms. */
  readonly compactedAt?: number;
}

/** The recall tool as an MCP call names it on any host: anchored on the suffix. */
const RECALL_TOOL_NAME = /(^|__|\.)recall$/;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The text items of a message's `content`, joined. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const o = obj(item);
    if (o === null) continue;
    const t = o["text"];
    if (typeof t === "string" && (o["type"] === "input_text" || o["type"] === "output_text" || o["type"] === "text")) parts.push(t);
  }
  return parts.join("\n");
}

/** The provenances a message's metadata names, in order. */
function provenancesOf(payload: Record<string, unknown>): Record<string, unknown>[] {
  const meta = obj(payload["internal_chat_message_metadata_passthrough"]);
  const items = meta === null ? null : meta["content_item_metadata"];
  if (!Array.isArray(items)) return [];
  const out: Record<string, unknown>[] = [];
  for (const it of items) {
    const p = obj(obj(it)?.["provenance"]);
    if (p !== null) out.push(p);
  }
  return out;
}

/** A hook's prompt coming home: tagged by provenance, or by its wrapper when the metadata is missing. */
const HOOK_PROMPT = /^\s*<hook_prompt\b/;
/** Codex's own framed blocks in a user-role message (environment, instructions). */
const HARNESS_FRAME = /^\s*<(environment_context|user_instructions|turn_aborted|user_shell_command)\b/;

/** One user-role message, read as a turn — or null when it is not one. */
function userTurn(payload: Record<string, unknown>, text: string): Pick<HostTurn, "source"> | null {
  const prov = provenancesOf(payload);
  const hook = prov.some((p) => p["hook"] === true) || (prov.length === 0 && HOOK_PROMPT.test(text));
  if (hook) return { source: text.includes(CODEX_STOP_OPENER) ? "ritual" : "plumbing" };
  if (prov.length > 0) {
    // Only what the person typed is conversation; the harness's own blocks are not turns.
    return prov.some((p) => p["type"] === "user") ? { source: "conversation" } : null;
  }
  return HARNESS_FRAME.test(text) ? null : { source: "conversation" };
}

/** The ids a recall call asked for: `handle` and `ids`, as strings, in order. */
function expansionIds(args: unknown): string[] {
  let a: unknown = args;
  if (typeof args === "string") {
    try {
      a = JSON.parse(args);
    } catch {
      return [];
    }
  }
  const o = obj(a);
  if (o === null) return [];
  const out: string[] = [];
  if (typeof o["handle"] === "string") out.push(o["handle"]);
  if (Array.isArray(o["ids"])) for (const id of o["ids"]) if (typeof id === "string") out.push(id);
  return out;
}

/** Parse a rollout's text. Pure: the file read is `readCodexTranscript`'s. */
export function parseCodexTranscript(raw: string): Omit<CodexTranscriptRead, "ok" | "reason"> {
  const turns: HostTurn[] = [];
  const expansions: TurnExpansion[] = [];
  let corrupt = 0;
  let model: string | undefined;
  let originator: string | undefined;
  let source: string | undefined;
  let compactedAt: number | undefined;
  const lines = raw.split("\n");
  for (let ordinal = 0; ordinal < lines.length; ordinal++) {
    const line = (lines[ordinal] ?? "").trim();
    if (line.length === 0) continue;
    let rec: Record<string, unknown> | null;
    try {
      rec = obj(JSON.parse(line));
    } catch {
      rec = null;
    }
    if (rec === null) {
      corrupt += 1;
      continue;
    }
    const type = rec["type"];
    const payload = obj(rec["payload"]) ?? {};
    if (type === "session_meta") {
      if (typeof payload["originator"] === "string") originator = payload["originator"];
      if (typeof payload["source"] === "string") source = payload["source"];
      if (typeof payload["model"] === "string" && payload["model"].length > 0) model = payload["model"];
      continue;
    }
    if (type === "turn_context") {
      if (typeof payload["model"] === "string" && payload["model"].length > 0) model = payload["model"];
      continue;
    }
    if (type === "compacted") {
      const at = typeof rec["timestamp"] === "string" ? Date.parse(rec["timestamp"]) : NaN;
      if (Number.isFinite(at)) compactedAt = at;
      continue;
    }
    if (type !== "response_item") continue;
    const kind = payload["type"];
    if (kind === "function_call" || kind === "custom_tool_call") {
      const name = payload["name"];
      if (typeof name === "string" && RECALL_TOOL_NAME.test(name)) {
        const ids = expansionIds(payload["arguments"] ?? payload["input"]);
        if (ids.length > 0) expansions.push({ atTurn: turns.length, ids });
      }
      continue;
    }
    if (kind !== "message") continue;
    const role = payload["role"];
    const text = textOf(payload["content"]);
    if (text.trim().length === 0) continue;
    if (role === "assistant") {
      turns.push({ role: "assistant", text, source: "conversation", entry: ordinal });
      continue;
    }
    if (role !== "user") continue;
    const read = userTurn(payload, text);
    if (read !== null) turns.push({ role: "user", text, ...read, entry: ordinal });
  }
  return {
    turns,
    corrupt,
    expansions,
    ...(model === undefined ? {} : { model }),
    ...(originator === undefined ? {} : { originator }),
    ...(source === undefined ? {} : { source }),
    ...(compactedAt === undefined ? {} : { compactedAt }),
  };
}

/** Read a rollout by the path the hook was handed. Never throws. */
export function readCodexTranscript(path: string | undefined): CodexTranscriptRead {
  if (path === undefined || path.length === 0) return { turns: [], ok: true, reason: "absent", corrupt: 0, expansions: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { turns: [], ok: false, reason: "unreadable", corrupt: 0, expansions: [] };
  }
  return { ...parseCodexTranscript(raw), ok: true, reason: "read" };
}
