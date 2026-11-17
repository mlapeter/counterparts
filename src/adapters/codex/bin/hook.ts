#!/usr/bin/env bun
/**
 * CODEX'S HOOK ENTRY (2026-11-09, CX2). One executable for the four events
 * `counterparts connect --host codex` wires into `$CODEX_HOME/hooks.json`,
 * dispatching on the payload's `hook_event_name`. Run by Codex as, e.g.:
 *
 *   ~/.bun/bin/bun --no-env-file "--config=<empty-bunfig.toml>" run <pkg>/src/adapters/codex/bin/hook.ts
 *
 * with the payload on stdin (`session_id`, `transcript_path`, `cwd`,
 * `hook_event_name`, `model`, and per event `prompt`, `source`,
 * `stop_hook_active`). It prints one JSON object or nothing (`../envelope.ts`)
 * and ALWAYS exits 0: no hook ever fails the host.
 *
 * The order is the guarantee, as in Claude Code's entry (claude-code CONTRACT
 * §5 G13): which configuration, then whether this directory is off — before any
 * store is opened. Ahead of both, the CX1 §6 stand-down: a Codex that Claude
 * Code started (codex-plugin-cc) does nothing, and says so in one line.
 *
 * An ENTRY POINT may borrow another adapter's readers (the MCP server's entry
 * borrows Claude Code's embedder and doctor), so the config, scope and session
 * readers below are Claude Code's own, unchanged: the rule for which file and
 * which directory is one rule on every host.
 */

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart, INJECTION_OVERBUDGET_EVENT, WAKE_INJECTED_EVENT } from "../../../core/counterpart.js";
import type { CounterpartEvent, CounterpartOptions } from "../../../core/counterpart.js";
import type { BoundaryKind } from "../../../core/remember/index.js";
import { isDirectoryScope, projectFolder } from "../../../core/self/work.js";
import { resolveZone, todayIn } from "../../../core/time.js";
import { implicitConfigRefusal, namedConfigRefusal, namedUnreadableRefusal } from "../../config-path.js";
import { TUNABLES } from "../../config.js";
import type { AdapterConfig } from "../../config.js";
import { CLAUDE_CODE_ENV_MARKERS, CODEX_HOST } from "../../hosts.js";
import { Lifecycle, codeOf } from "../../lifecycle.js";
import type { HostTurn, LifecycleOptions, SessionInput, TurnExpansion } from "../../lifecycle.js";
import { lookupScope, mostRestrictiveVerdict, stanceOfMode } from "../../scopes.js";
import { readSession } from "../../sessions.js";
import { openLog } from "../../log/index.js";
import type { LogEvent, ProcessLog } from "../../log/index.js";
import { BINARY, scriptArgs } from "../../runtime.js";
import type { Binary } from "../../runtime.js";
import { WORKER_RUNNER_PATH } from "../../spawn.js";
import type { SpawnOutcome, Spawner } from "../../spawn.js";
import { usePrivateUmask } from "../../private-umask.js";
import { eventDirectory, hookConfigChoice, hookScopeVerdict, hostConfig, sessionScope } from "../../claude-code/bin/hook.js";
import { openEmbedder } from "../../claude-code/embed-client.js";

// ─── words ──────────────────────────────────────────────────────────────────

/**
 * WHAT THIS HOST SAYS, AND WHEN IT SAYS NOTHING (2026-11-09, CX2).
 *
 * Mike's ruling, 11-09 (CX1 §4, option 2): Codex reads the SAME memory, as
 * another model, never in the counterpart's first person. So the wake opens
 * with a frame naming the memory as the counterpart's and the reader as the
 * model it is; the self page is shown for history, not to speak as; and the
 * end ask and the chapter ask the model to write as itself.
 *
 * And the stand-down (CX1 §6): OpenAI's codex-plugin-cc runs Codex from INSIDE
 * Claude Code (`/codex:rescue`, `/codex:review`, the review gate), spawning
 * `codex app-server` with `env: process.env` and the person's own `~/.codex`.
 * Claude Code's transcript already holds that output, so a Codex session
 * started there would be captured twice and woken uninvited. It does nothing.
 * Two signals, either one enough, both unit-testable:
 *
 *   1. the hook's ENVIRONMENT: Claude Code's own markers (`hosts.ts
 *      #CLAUDE_CODE_ENV_MARKERS`), or the plugin's `CODEX_COMPANION_*`;
 *   2. the rollout's `session_meta.originator`: the plugin's client names
 *      itself "Claude Code" at `initialize` (codex-plugin-cc
 *      `scripts/lib/app-server.mjs`, `DEFAULT_CLIENT_INFO`), and the
 *      app-server is expected to record that as the originator.
 *
 * NEITHER IS MEASURED YET: `tools/codex-standdown-probe.sh` prints what a hook
 * really sees, for Mike to run once with the plugin installed.
 */

/** The plugin's own variables, any one of which says the plugin started this Codex. */
export const COMPANION_ENV_MARKERS = ["CODEX_COMPANION_SESSION_ID", "CODEX_COMPANION_APP_SERVER_ENDPOINT"] as const;

/** An originator that names Claude Code (the plugin's client name, in any spelling). */
const CLAUDE_ORIGINATOR = /claude[\s_-]*code/i;

/** Why a Codex session stands down, or null when it is the person's own. */
export type CodexStandDown =
  | { readonly by: "env"; readonly marker: string }
  | { readonly by: "originator"; readonly originator: string };

/** Was this Codex started from inside Claude Code? The environment first, then the rollout. */
export function codexStandDown(
  env: Readonly<Record<string, string | undefined>>,
  originator: string | undefined,
): CodexStandDown | null {
  for (const name of [...COMPANION_ENV_MARKERS, ...CLAUDE_CODE_ENV_MARKERS]) {
    const v = env[name];
    if (typeof v === "string" && v.length > 0) return { by: "env", marker: name };
  }
  if (typeof originator === "string" && CLAUDE_ORIGINATOR.test(originator)) return { by: "originator", originator };
  return null;
}

/** The originators Codex writes for a session nobody attends (measured: `codex exec` is `codex_exec`). */
const HEADLESS_ORIGINATOR = /exec/i;

/** Is a person there? `codex exec` is not; the TUI and the IDE are; unknown reads as a person's. */
export function attendedOfOriginator(originator: string | undefined): boolean | undefined {
  if (originator === undefined) return undefined;
  return !HEADLESS_ORIGINATOR.test(originator);
}

/** The reading model, as a frame names it. */
function reader(model: string | undefined): string {
  return model !== undefined && model.length > 0 ? model : "a model";
}

/**
 * THE WAKE'S FRAME (CX2): the first line the model reads, above the clock,
 * outside the wake block so its sentinels and byte count stand.
 */
export function codexFrame(model: string | undefined): string {
  const who = reader(model);
  return (
    `[Counterparts in Codex] What follows is the shared memory of this person's counterpart — the AI they work with in Claude — read here by you, ${who} in Codex. ` +
    "You are not that counterpart: its self page is shown for history, not yours to speak as, and \"I\" and \"me\" in what follows are the counterpart. " +
    `Use the memories as context; when you write a memory or a chapter, write as yourself (${who} in Codex). ` +
    "The counterpart's dreams and reflections run in Claude, not here."
  );
}

/** The rule the end ask carries about whose words these are. */
export function codexVoiceRule(model: string | undefined): string {
  const who = reader(model);
  return `Write as yourself, ${who} in Codex, not as the counterpart; \`about: me\` keeps a note about you, never the counterpart's self.`;
}

/**
 * THE STOP ASK, IN THIS HOST'S VOICE (CX2): Claude Code's two numbered lines
 * (`claude-code/hooks.ts#stopAsk`), with the voice rule in the first and the
 * chapter written as the reading model. The rating and open-items clauses
 * stay out: the ask is the backstop, and the tools' own descriptions say the rest.
 */
export function codexStopAsk(sessionId: string, chapter: number, model: string | undefined): string {
  return [
    `${CODEX_STOP_OPENER_WORDS} 1) hand back what caught your attention since you last wrote, one idea each — what you read, what they said, what happened — with the counterparts session_end tool, session: ${sessionId}. ${codexVoiceRule(model)} \`handoff\` only if work here is unfinished; \`updates\` anything dated or open now done.`,
    `2) Write chapter ${String(chapter)} with the counterparts chapter tool, session: ${sessionId} — your own account of this session, as ${reader(model)} in Codex.`,
  ].join("\n");
}

/** `transcript.ts#CODEX_STOP_OPENER`, restated here so this file stays a leaf (a test pins them equal). */
export const CODEX_STOP_OPENER_WORDS = "Counterparts, before this session closes:";

/** What the person sees beside the ask, when Codex shows the hook's reason. */
export const CODEX_STOP_HUMAN_LINE = "Counterparts: asking the model to write up this session's memories.";

// ─── transcript ─────────────────────────────────────────────────────────────

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

// ─── adapter ────────────────────────────────────────────────────────────────

/**
 * THE CODEX ADAPTER (2026-11-09, CX2): the host lifecycle (`../lifecycle.ts`),
 * driven by four of Codex's hook events — SessionStart (the wake), UserPromptSubmit
 * (recall), Stop (capture and the end ask) and SessionEnd (the final boundary).
 *
 * It EXTENDS `Lifecycle`, as Claude Code's adapter does, and imports no other
 * adapter: Codex's hooks line up with Claude Code's almost one to one, but what
 * it leaves out is the point (CX1; Mike's rulings of 11-09):
 *
 *   - **No night.** Claude dreams and reflects; nothing here offers, starts or
 *     catches up a night run, or tells a morning share. The worker spawned at
 *     each boundary (the Hebbian flush, the sleep cycle) is host-agnostic and
 *     runs as it does everywhere.
 *   - **Not the counterpart.** The wake opens with a frame (`words.ts
 *     #codexFrame`): the counterpart's shared memory, read by `<model>` in
 *     Codex; the self page shown for history, not to speak as. The end ask asks
 *     the model to write as itself.
 *   - **None of Claude Code's person-facing machinery** — the first meeting, the
 *     first-launch scope question, plain reminders, the update and maintenance
 *     lines, the write-up pointer. Each is claimed once and never comes back,
 *     so each waits for a Claude Code session rather than being spent where it
 *     was never designed to be said (INTERFACE-GAPS lists them).
 *
 * G2 (claude-code CONTRACT §5) holds here too: no hook ever fails the host.
 * Every entry is wrapped in `guard`, and a throw is a quiet, logged hook.
 */

/** The four Codex events this adapter is wired under, by its own names. */
export const CODEX_HOOKS = ["session-start", "user-prompt-submit", "stop", "session-end"] as const;
export type CodexHookName = (typeof CODEX_HOOKS)[number];

/** Codex's own spellings, as `hook_event_name` carries them (measured 11-09). */
export const CODEX_EVENT_NAMES: Readonly<Record<string, CodexHookName>> = {
  SessionStart: "session-start",
  UserPromptSubmit: "user-prompt-submit",
  Stop: "stop",
  SessionEnd: "session-end",
};

/** The two session-ending events and the boundary each records. */
const BOUNDARY: Record<"stop" | "session-end", BoundaryKind> = { stop: "stop", "session-end": "session-end" };

/** One moment of a Codex session: the lifecycle's input and what only this host says. */
export interface CodexHookInput extends SessionInput {
  /** The rollout this session writes (`transcript_path`). */
  readonly transcriptPath?: string;
  /** The re-fire of a blocked Stop (`stop_hook_active`): asks nothing, advances nothing. */
  readonly reFired?: boolean;
  /** Whether a person is there: false for `codex exec` (`words.ts#attendedOfOriginator`). */
  readonly attended?: boolean;
  /** Why SessionStart fired: `startup`, `resume`, `clear`, `compact`, `fork`. */
  readonly source?: string;
}

export interface CodexHookResult {
  readonly hook: CodexHookName;
  readonly ok: boolean;
  readonly reason: string;
  /** For the model's context. The empty string on a quiet hook. */
  readonly injection: string;
  readonly bytes: number;
  readonly sentinel: string | null;
  /** The Stop's ask, or null. */
  readonly ask: string | null;
  readonly spansAppended: number;
  readonly spawn: SpawnOutcome | null;
  readonly observer: boolean;
}

export type CodexAdapterOptions = Omit<LifecycleOptions, "host">;

export class CodexAdapter extends Lifecycle {
  /** The anti-loop guard: one hook per session in flight at a time. */
  private readonly inFlight = new Set<string>();

  constructor(opts: CodexAdapterOptions) {
    super({ ...opts, host: CODEX_HOST });
  }

  /** The wake, framed for a model that reads this memory without being its counterpart. */
  sessionStart(input: CodexHookInput): CodexHookResult {
    return this.guard("session-start", input, (out) => {
      this.noteSession("start", input);
      const budget = this.config.injectionBudgetBytes;
      if (budget === undefined || this.config.injectionBudgetDefaulted === true) {
        this.emit("adapter.budget.unreported", budget === undefined ? {} : { defaulted: budget });
      }
      const woke = this.composeWake(input, budget);
      // THE FRAME, then the clock, both OUTSIDE the wake block: its sentinels
      // and byte count stand, as Claude Code's clock line leaves them.
      const lead = `${codexFrame(input.model)}\n${this.nowLine()}\n`;
      const sent = woke.bytes + Buffer.byteLength(lead, "utf8");
      if (budget !== undefined && sent > budget) {
        this.noteDeliveryWarning(INJECTION_OVERBUDGET_EVENT, { hook: "session-start", bytes: sent, budget }, input);
      }
      this.record(WAKE_INJECTED_EVENT, input, {
        ok: woke.ok,
        reason: woke.reason,
        bytes: woke.bytes,
        budget: budget ?? null,
        sentinel: woke.sentinel !== null,
        preface: woke.preface !== null,
        interactive: input.attended !== false,
        folder: isDirectoryScope(input.scope) ? projectFolder(input.scope) : null,
        resumed: false,
        host: CODEX_HOST,
      });
      return {
        ...out,
        ok: woke.ok,
        reason: woke.reason,
        injection: `${lead}${woke.text}`,
        bytes: woke.bytes,
        sentinel: woke.sentinel,
      };
    });
  }

  /** The turn's recall, under the clock line. Nothing else rides a Codex prompt. */
  userPromptSubmit(input: CodexHookInput): CodexHookResult {
    return this.guard("user-prompt-submit", input, (out) => {
      // Liveness at the prompt: refresh a record, never create one.
      if (input.sessionId.length > 0 && readSession(this.counterpart.store.dir, input.sessionId) !== null) {
        this.noteSession("boundary", input);
      }
      const text = input.prompt ?? "";
      if (text.trim().length === 0) return { ...out, ok: true, reason: "empty-prompt", injection: this.nowLine() };
      const result = this.recallTurn(input, text, { startedBy: input.attended === false ? "unattended" : "person" });
      const decision = result.decision;
      return {
        ...out,
        ok: true,
        reason: decision.reason,
        injection: result.injection.length === 0 ? this.nowLine() : `${this.nowLine()}\n${result.injection}`,
        bytes: decision.bytes,
        sentinel: decision.sentinel,
      };
    });
  }

  /**
   * Stop: capture through the cursor, every turn — the primary door (CX2) —
   * then the one ask, then the detached worker. The spans are durable before
   * the ask goes out, so a crash between costs an ask, never a turn.
   */
  stop(input: CodexHookInput): CodexHookResult {
    return this.guard("stop", input, (out) => {
      const claimed = this.claim("stop", input, out);
      this.noteSession("boundary", input);
      const ask = this.askAtStop(input);
      return { ...claimed, ask, spawn: this.spawnWorker(input) };
    });
  }

  /**
   * SessionEnd: the final boundary. It fires from Codex's app-server daemon a
   * minute or so after `/exit`, inside a 3 s clamp (measured 11-09), so it
   * captures what the last Stop left (usually nothing), closes the record and
   * hands the rest to the detached worker. An empty session — no transcript,
   * or one with no turns — captures nothing and fails nothing.
   */
  sessionEnd(input: CodexHookInput): CodexHookResult {
    return this.guard("session-end", input, (out) => {
      const claimed = this.claim("session-end", input, out);
      this.noteSession("end", input);
      this.noteTail(input);
      return { ...claimed, spawn: this.spawnWorker(input) };
    });
  }

  /** Dispatch by name: what the entry script calls. */
  hook(name: CodexHookName, input: CodexHookInput): CodexHookResult {
    switch (name) {
      case "session-start":
        return this.sessionStart(input);
      case "user-prompt-submit":
        return this.userPromptSubmit(input);
      case "stop":
        return this.stop(input);
      case "session-end":
        return this.sessionEnd(input);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private claim(hook: "stop" | "session-end", input: CodexHookInput, out: CodexHookResult): CodexHookResult {
    const captured = this.captureBoundary(hook, BOUNDARY[hook], input);
    return { ...out, ok: true, reason: captured.reason, spansAppended: captured.spansAppended };
  }

  /** The lifecycle's pacer decides; this host words it. The re-fire asks nothing, and nobody is asked in `codex exec`. */
  private askAtStop(input: CodexHookInput): string | null {
    if (input.reFired === true) return null;
    const chapter = this.paceAsk(input);
    return chapter === null ? null : codexStopAsk(input.sessionId, chapter, input.model);
  }

  private guard(hook: CodexHookName, input: CodexHookInput, body: (out: CodexHookResult) => CodexHookResult): CodexHookResult {
    const base: CodexHookResult = {
      hook,
      ok: false,
      reason: "unknown",
      injection: "",
      bytes: 0,
      sentinel: null,
      ask: null,
      spansAppended: 0,
      spawn: null,
      observer: this.observer,
    };
    const key = `${hook}:${input.sessionId}`;
    if (this.inFlight.has(key)) {
      this.emit("adapter.reentrant", { hook, session: input.sessionId });
      return { ...base, ok: true, reason: "reentrant" };
    }
    this.inFlight.add(key);
    try {
      if (stanceOfMode(this.scope.mode) === "off") {
        this.emit("adapter.scope.off", { hook, matched: this.scope.matched });
        return { ...base, ok: true, reason: "scope-off" };
      }
      if (this.observer && hook !== "session-start" && hook !== "user-prompt-submit") {
        this.emit("adapter.observer.standdown", { hook });
        return { ...base, ok: true, reason: "observer" };
      }
      return body(base);
    } catch (err) {
      this.emit("adapter.hook.failed", { hook, code: codeOf(err) });
      return { ...base, ok: false, reason: "failed" };
    } finally {
      this.inFlight.delete(key);
    }
  }
}

// ─── envelope ───────────────────────────────────────────────────────────────

/**
 * WHAT A CODEX HOOK PRINTS (2026-11-09, CX2) — only the shapes measured on
 * Codex 0.167 (CX1 §0b), nothing carried over from Claude Code's envelope:
 *
 *   - SessionStart / UserPromptSubmit: `{"hookSpecificOutput":{"hookEventName":
 *     …,"additionalContext":…}}`. Measured: a 9,168-byte wake arrived whole as
 *     one developer-role message, and a prompt's context as its own message
 *     before the reply. Codex also reads plain stdout as context, but stdout
 *     that LOOKS like JSON and does not parse fails the hook (codex-rs
 *     `hooks/src/events/common.rs`), so this always prints one whole object.
 *   - Stop: `{"decision":"block","reason":<ask>}`. Measured: Codex continued
 *     with the reason as a user-role `<hook_prompt …>` message, and re-fired
 *     Stop with `stop_hook_active: true`, which prints nothing here.
 *   - SessionEnd: nothing.
 *
 * Always exit 0. No `systemMessage`: Codex parses one at SessionStart, but where
 * it shows is unmeasured, and nothing here needs the person's eye yet.
 */

const EVENT_NAMES: Record<"session-start" | "user-prompt-submit", string> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
};

/** The stdout for this event: one JSON object, or the empty string. */
export function codexDelivery(
  name: CodexHookName,
  result: { readonly injection: string; readonly ask: string | null },
  payload: Readonly<Record<string, unknown>>,
): string {
  if (name === "session-start" || name === "user-prompt-submit") {
    if (result.injection.length === 0) return "";
    return JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT_NAMES[name], additionalContext: result.injection } });
  }
  if (name === "stop") {
    if (payload["stop_hook_active"] === true || result.ask === null || result.ask.length === 0) return "";
    return JSON.stringify({ decision: "block", reason: result.ask });
  }
  return "";
}

// ─── index ──────────────────────────────────────────────────────────────────

/**
 * `adapters/codex/` — the Codex host's public surface (2026-11-09, CX2).
 *
 * A sibling of `claude-code/`, importing only the shared leaves
 * (`lifecycle.ts`, `hosts.ts`, `sessions.ts`, `scopes.ts`, `config.ts`, …) and
 * `core/` — never another adapter (a test asserts it). Its entry point
 * (`bin/hook.ts`) may borrow Claude Code's config and scope readers and its
 * embedder, as the MCP server's entry point already does.
 */

/** What the entry point hands in: the embedder (opened there), and the brain's event sink. */
export interface OpenCodexOptions extends Omit<CodexAdapterOptions, "counterpart" | "config"> {
  readonly embedder?: { readonly embed: NonNullable<CounterpartOptions["embed"]>; readonly vectors: NonNullable<CounterpartOptions["vectors"]> } | null;
  readonly onCounterpartEvent?: (e: CounterpartEvent) => void;
}

/** Open a brain for this host and wrap it in Codex's hooks — Claude Code's `openAdapter`, for Codex. */
export function openCodexAdapter(config: AdapterConfig, opts: OpenCodexOptions = {}): CodexAdapter {
  const { embedder, onCounterpartEvent, ...rest } = opts;
  const counterpart = Counterpart.open({
    ...(embedder === undefined || embedder === null ? {} : { embed: embedder.embed, vectors: embedder.vectors }),
    ...(config.dataDir === undefined ? {} : { dir: config.dataDir }),
    ...(config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir }),
    ...(config.injectionBudgetBytes === undefined ? {} : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.observer === undefined ? {} : { observer: config.observer }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode }),
    ...(config.identity === undefined
      ? {}
      : { identity: { name: config.identity.name, aliases: [...(config.identity.aliases ?? [])] } }),
    // Codex's hooks run on the person's computer.
    toldSurface: "local",
    ...(onCounterpartEvent === undefined ? {} : { onEvent: onCounterpartEvent }),
  });
  return new CodexAdapter({ counterpart, config, ...rest });
}

// ─── wire ───────────────────────────────────────────────────────────────────

/**
 * CODEX'S TWO FILES, AS THIS PACKAGE EDITS THEM (2026-11-09, CX2) — pure
 * functions over their text; `cli/wire.ts` (its Codex section) reads, backs up and writes.
 *
 *   - `$CODEX_HOME/hooks.json` (default `~/.codex`): our four hooks, ONE GROUP
 *     PER EVENT, APPENDED LAST. Codex keys a hook's trust by its POSITION —
 *     `[hooks.state."<file>:<event>:<group>:<handler>"] trusted_hash = …` in
 *     config.toml (measured 11-09) — so a group inserted before another tool's
 *     would shift that tool's key and quietly untrust it. Ours go after
 *     everything, are updated in place, and are the only ones ever removed.
 *   - `$CODEX_HOME/config.toml`: one `[mcp_servers.counterparts]` table, ours by
 *     its name, rewritten whole; and on disconnect the `hooks.state` rows that
 *     point at our hooks' positions. Nothing else in the file is touched: it is
 *     edited as lines, never parsed and re-serialized (no dependency, and every
 *     comment and every other table stays byte for byte).
 *
 * Trust is the PERSON's (Mike, 11-09, CX1 §5 route i): this file never writes a
 * `trusted_hash`. `connect` says to approve the hooks in Codex's `/hooks`, and
 * `doctor` reads whether they were (`trustOf`).
 */

/** Codex's event names, the order we write them, and the snake form `hooks.state` keys use. */
export const CODEX_EVENTS = [
  { event: "SessionStart", key: "session_start", context: true },
  { event: "UserPromptSubmit", key: "user_prompt_submit", context: true },
  { event: "Stop", key: "stop", context: false },
  { event: "SessionEnd", key: "session_end", context: false },
] as const;

/** The MCP server's name in Codex's config, the same as in Claude Code's. */
export const CODEX_MCP_NAME = "counterparts";

/**
 * A hook command of ours: it runs `adapters/codex/bin/hook.(ts|js)` — never
 * Claude Code's hook, so neither host's `connect` reads the other's line as its own.
 */
export const CODEX_HOOK_MARK = /(^|[/\\])adapters[/\\]codex[/\\]bin[/\\]hook\.(ts|js|mjs)(?=$|["'\s])/;

export function isOurCodexCommand(command: unknown): boolean {
  return typeof command === "string" && CODEX_HOOK_MARK.test(command);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Our handler for one event, exactly as connect writes it. */
export function codexHandler(command: string, context: boolean, event = ""): Record<string, unknown> {
  return {
    type: "command",
    command,
    timeout: event === "SessionEnd" ? TUNABLES.CODEX_SESSION_END_TIMEOUT_S : TUNABLES.CODEX_HOOK_TIMEOUT_S,
    ...(context ? { additionalContextLimit: TUNABLES.CODEX_CONTEXT_LIMIT_TOKENS } : {}),
  };
}

/** Where one of our handlers sits: the event, its group and handler index. */
export interface OurPosition {
  readonly event: string;
  readonly key: string;
  readonly group: number;
  readonly handler: number;
  readonly command: string;
}

/** Every handler of ours in a hooks.json document, by position. */
export function ourPositions(doc: unknown): OurPosition[] {
  const out: OurPosition[] = [];
  const hooks = isRecord(doc) && isRecord(doc["hooks"]) ? doc["hooks"] : {};
  for (const e of CODEX_EVENTS) {
    const groups = hooks[e.event];
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, gi) => {
      if (!isRecord(g) || !Array.isArray(g["hooks"])) return;
      (g["hooks"] as unknown[]).forEach((h, hi) => {
        if (isRecord(h) && isOurCodexCommand(h["command"])) out.push({ event: e.event, key: e.key, group: gi, handler: hi, command: h["command"] as string });
      });
    });
  }
  return out;
}

export type EventOutcome = "added" | "updated" | "already" | "removed" | "absent";

export interface HooksMerge {
  readonly doc: Record<string, unknown>;
  readonly changed: boolean;
  readonly events: readonly { readonly event: string; readonly outcome: EventOutcome }[];
  /** Another tool's hook commands left exactly where they were. */
  readonly foreignKept: number;
  /** Events where another tool's group sat AFTER ours when ours was removed: its trust key moved. */
  readonly shifted: readonly string[];
}

/**
 * Put our four hooks in (`wire`) or take them out (`unwire`). Another tool's
 * groups and handlers are carried through untouched, in their order; a shape
 * this function does not read is carried through whole.
 */
export function mergeCodexHooks(doc: unknown, command: string, direction: "wire" | "unwire"): HooksMerge {
  const next: Record<string, unknown> = isRecord(doc) ? (structuredClone(doc) as Record<string, unknown>) : {};
  const hooks: Record<string, unknown> = isRecord(next["hooks"]) ? (next["hooks"] as Record<string, unknown>) : {};
  const events: { event: string; outcome: EventOutcome }[] = [];
  const shifted: string[] = [];
  let foreignKept = 0;
  let changed = false;
  for (const e of CODEX_EVENTS) {
    const raw = hooks[e.event];
    const groups: unknown[] = Array.isArray(raw) ? [...raw] : [];
    const want = codexHandler(command, e.context, e.event);
    let seen = false;
    let outcome: EventOutcome = direction === "wire" ? "added" : "absent";
    let lastOurs = -1;
    const outGroups: unknown[] = [];
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) {
        outGroups.push(group);
        continue;
      }
      const kept: unknown[] = [];
      let touched = false;
      for (const h of group["hooks"] as unknown[]) {
        if (!(isRecord(h) && isOurCodexCommand(h["command"]))) {
          kept.push(h);
          if (isRecord(h) && typeof h["command"] === "string") foreignKept += 1;
          continue;
        }
        touched = true;
        if (direction === "unwire" || seen) {
          // Removed: on unwire every one of ours; on wire, a duplicate of ours.
          if (direction === "unwire") outcome = "removed";
          changed = true;
          continue;
        }
        seen = true;
        const same = JSON.stringify(h) === JSON.stringify(want);
        outcome = same ? "already" : "updated";
        if (!same) changed = true;
        kept.push(want);
      }
      if (touched) lastOurs = outGroups.length;
      if (touched && kept.length === 0) continue;
      outGroups.push(touched ? { ...group, hooks: kept } : group);
    }
    if (direction === "unwire" && outcome === "removed" && lastOurs >= 0 && lastOurs < outGroups.length) shifted.push(e.event);
    if (direction === "wire" && !seen) {
      outGroups.push({ hooks: [want] });
      changed = true;
    }
    if (outGroups.length > 0) hooks[e.event] = outGroups;
    else delete hooks[e.event];
    events.push({ event: e.event, outcome });
  }
  if (Object.keys(hooks).length > 0 || isRecord(next["hooks"])) next["hooks"] = hooks;
  return { doc: next, changed, events, foreignKept, shifted };
}

// ── config.toml, as lines ────────────────────────────────────────────────────

/** A TOML basic string: JSON's escaping is a subset TOML reads the same. */
export function tomlString(s: string): string {
  return JSON.stringify(s);
}

/** Our MCP table, whole. `env` carries the store and the configuration explicitly. */
export function codexMcpBlock(command: string, args: readonly string[], env: Readonly<Record<string, string>>): string {
  const envPairs = Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`);
  return [
    "# Written by `counterparts connect --host codex`; `counterparts disconnect --host codex` removes it.",
    `[mcp_servers.${CODEX_MCP_NAME}]`,
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    `env = { ${envPairs.join(", ")} }`,
  ].join("\n");
}

const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;
const OUR_TABLE = new RegExp(`^mcp_servers\\s*\\.\\s*(?:"${CODEX_MCP_NAME}"|${CODEX_MCP_NAME})(\\s*\\..*)?$`);
const BLOCK_COMMENT = /^#\s*Written by `counterparts connect --host codex`/;
/** One TOML scalar as `scanToml#code` shows it: a string (`""`), a date with a time, or one bare token. */
const SCALAR = /^(""|\d{4}-\d{2}-\d{2}[ T]\S+|[^\s,[\]{}"]+)$/;
/** A line that is only a comment, or blank. */
const COMMENT_OR_BLANK = /^\s*(#.*)?$/;

/** The header line's table name, or null for a line that is not a header. */
function headerOf(line: string): string | null {
  const m = HEADER.exec(line);
  return m === null ? null : (m[1] as string);
}

/**
 * ONE LINE OF config.toml, AS THESE EDITS READ IT (CX2 fix round): its text;
 * its table name when it is a header OUTSIDE a multi-line string (a
 * `[mcp_servers.counterparts]` inside `"""…"""` is words, not a table); whether
 * it began inside such a string; and its CODE — the line with every string
 * replaced by `""` and its comment cut, for the validity check.
 */
interface TomlLine {
  readonly text: string;
  readonly header: string | null;
  readonly inString: boolean;
  readonly code: string;
  /** Still inside a multi-line string at its end. */
  readonly openAfter: boolean;
  /** A one-line string (`"…` or `'…`) that the line never closes. */
  readonly unterminated: boolean;
}

/** Read config.toml's lines with multi-line strings (`"""`, `'''`) tracked. Never throws. */
export function scanToml(text: string): TomlLine[] {
  const out: TomlLine[] = [];
  let open: '"""' | "'''" | null = null;
  for (const line of text.split("\n")) {
    const startedIn = open !== null;
    let code = "";
    let unterminated = false;
    let i = 0;
    while (i < line.length) {
      if (open !== null) {
        const j = line.indexOf(open, i);
        if (j < 0) {
          i = line.length;
          break;
        }
        open = null;
        i = j + 3;
        continue;
      }
      const c = line[i] as string;
      if (c === "#") break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        open = line.startsWith('"""', i) ? '"""' : "'''";
        code += '""';
        i += 3;
        continue;
      }
      if (c === '"') {
        i += 1;
        while (i < line.length && line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
        if (i >= line.length) unterminated = true;
        i += 1;
        code += '""';
        continue;
      }
      if (c === "'") {
        const j = line.indexOf("'", i + 1);
        if (j < 0) unterminated = true;
        i = j < 0 ? line.length : j + 1;
        code += '""';
        continue;
      }
      code += c;
      i += 1;
    }
    out.push({ text: line, header: startedIn ? null : headerOf(line), inString: startedIn, code, openAfter: open !== null, unterminated });
  }
  return out;
}

/**
 * WHY config.toml CANNOT BE EDITED, or null (CX2 fix round). Not a TOML
 * parser: a line-level check that each line outside a string is blank, a
 * comment, a table header, a `key = value`, or the inside of a value an
 * earlier line opened (an array, an inline table, a multi-line string). It
 * names the LINE NUMBER only: a config line may hold a token.
 */
export function tomlProblem(text: string): string | null {
  let depth = 0;
  const lines = scanToml(text);
  for (const [n, l] of lines.entries()) {
    if (l.unterminated) return `line ${String(n + 1)} has a string that is never closed`;
    if (l.inString) continue;
    const code = l.code.trim();
    const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
    if (depth > 0) {
      depth += count(code, /[[{]/g) - count(code, /[\]}]/g);
      if (depth < 0) return `line ${String(n + 1)} closes a bracket nothing opened`;
      continue;
    }
    if (code.length === 0) continue;
    if (/^\[\[?[^[\]]+\]\]?$/.test(code)) continue;
    const kv = /^([A-Za-z0-9_\-"]+(?:\s*\.\s*[A-Za-z0-9_\-"]+)*)\s*=\s*(\S.*)$/.exec(code);
    if (kv === null) return `line ${String(n + 1)} is not a table, a key = value, or a comment`;
    const value = (kv[2] as string).trim();
    // ONE VALUE, AND NOTHING AFTER IT (re-review): a string, a scalar, a date
    // with its time, or the opening of an array or inline table.
    if (!/[[{]/.test(value) && !SCALAR.test(value)) return `line ${String(n + 1)} has more after its value than one value`;
    depth += count(value, /[[{]/g) - count(value, /[\]}]/g);
    if (depth < 0) return `line ${String(n + 1)} closes a bracket nothing opened`;
  }
  if (lines.length > 0 && (lines[lines.length - 1] as TomlLine).openAfter) return "a multi-line string is never closed";
  if (depth > 0) return "an array or inline table is never closed";
  return null;
}

/**
 * Drop the tables `drop` names (each with its body, up to the next header),
 * and our block's own comment line above our MCP table. The comments and
 * blank lines at the END of a dropped table stay: they sit above the next
 * header and are that table's (CX2 fix round: a `# note` above a later table
 * was lost on reconnect).
 */
function dropTables(text: string, drop: (name: string) => boolean): { text: string; dropped: number } {
  const out: string[] = [];
  let skipping = false;
  let skipped: string[] = [];
  let dropped = 0;
  const release = (atEnd: boolean): void => {
    let k = skipped.length;
    while (k > 0 && COMMENT_OR_BLANK.test(skipped[k - 1] as string)) k -= 1;
    // At the end of the file, keep the comments (somebody's) and lose the blank lines.
    const tail = skipped.slice(k);
    out.push(...(atEnd ? tail.filter((s) => s.trim().length > 0) : tail));
    skipped = [];
  };
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      if (skipping) release(false);
      skipping = drop(l.header);
      if (skipping) {
        dropped += 1;
        if (out.length > 0 && BLOCK_COMMENT.test(out[out.length - 1] ?? "")) out.pop();
        continue;
      }
    }
    if (skipping) skipped.push(l.text);
    else out.push(l.text);
  }
  if (skipping) release(true);
  return { text: out.join("\n"), dropped };
}

/** Is there an MCP entry named ours in a form this file does not edit (an inline or dotted one)? */
export function foreignShapedMcp(text: string): boolean {
  let inServers = false;
  for (const l of scanToml(text)) {
    if (l.inString) continue;
    if (l.header !== null) {
      inServers = l.header === "mcp_servers";
      continue;
    }
    if (/^\s*mcp_servers\s*\.\s*"?counterparts"?\s*[.=]/.test(l.code)) return true;
    if (inServers && /^\s*"*counterparts"*\s*[.=]/.test(l.code)) return true;
  }
  return false;
}

/** Does config.toml hold our MCP table? */
export function hasCodexMcp(text: string): boolean {
  return scanToml(text).some((l) => l.header !== null && OUR_TABLE.test(l.header));
}

/** The `[mcp_servers.counterparts]` table's body, as key → raw value text (for doctor). */
export function codexMcpEntry(text: string): Record<string, string> | null {
  let inOurs = false;
  let found = false;
  const out: Record<string, string> = {};
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      const n = l.header.replace(/\s+/g, "");
      inOurs = n === `mcp_servers.${CODEX_MCP_NAME}` || n === `mcp_servers."${CODEX_MCP_NAME}"`;
      found = found || inOurs;
      continue;
    }
    if (!inOurs || l.inString) continue;
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(l.text);
    if (m !== null) out[m[1] as string] = (m[2] as string).trim();
  }
  return found ? out : null;
}

/** Put our MCP table in (replacing one of ours), or take it out. */
export function mergeCodexMcp(text: string, block: string | null): { text: string; changed: boolean; had: boolean } {
  const had = hasCodexMcp(text);
  const { text: without } = dropTables(text, (n) => OUR_TABLE.test(n));
  if (block === null) return { text: without, changed: had, had };
  const base = without.replace(/\n+$/, "");
  const next = `${base.length === 0 ? "" : `${base}\n\n`}${block}\n`;
  return { text: next, changed: next !== text, had };
}

/** A `hooks.state` key: `<hooks.json path>:<event>:<group>:<handler>` (measured 11-09). */
export function stateKey(hooksPath: string, p: Pick<OurPosition, "key" | "group" | "handler">): string {
  return `${hooksPath}:${p.key}:${String(p.group)}:${String(p.handler)}`;
}

/** The key a `[hooks.state."<key>"]` header names, or null. */
function stateKeyOf(header: string): string | null {
  const m = /^hooks\s*\.\s*state\s*\.\s*"((?:[^"\\]|\\.)*)"$/.exec(header);
  if (m === null) return null;
  try {
    return JSON.parse(`"${m[1] as string}"`) as string;
  } catch {
    return null;
  }
}

/** Every `[hooks.state."<key>"]` row: its key, and whether it carries a trusted hash or is disabled. */
export function hookStates(text: string): Map<string, { trusted: boolean; enabled: boolean }> {
  const out = new Map<string, { trusted: boolean; enabled: boolean }>();
  let current: string | null = null;
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      current = stateKeyOf(l.header);
      if (current !== null) out.set(current, { trusted: false, enabled: true });
      continue;
    }
    if (current === null || l.inString) continue;
    const row = out.get(current);
    if (row === undefined) continue;
    if (/^\s*trusted_hash\s*=\s*"sha256:[0-9a-f]+"/.test(l.text)) out.set(current, { ...row, trusted: true });
    if (/^\s*enabled\s*=\s*false\b/.test(l.text)) out.set(current, { ...row, enabled: false });
  }
  return out;
}

/** Remove the `hooks.state` rows with these keys (disconnect: ours only). */
export function dropHookStates(text: string, keys: ReadonlySet<string>): { text: string; dropped: number } {
  return dropTables(text, (n) => {
    const key = stateKeyOf(n);
    return key !== null && keys.has(key);
  });
}

/** What Codex's trust says about each of our hooks, by the paths Codex may have keyed them under. */
export function trustOf(
  positions: readonly OurPosition[],
  states: ReadonlyMap<string, { trusted: boolean; enabled: boolean }>,
  hooksPaths: readonly string[],
): { event: string; state: "trusted" | "disabled" | "unapproved" }[] {
  return positions.map((p) => {
    for (const path of hooksPaths) {
      const s = states.get(stateKey(path, p));
      if (s === undefined) continue;
      if (!s.enabled) return { event: p.event, state: "disabled" as const };
      if (s.trusted) return { event: p.event, state: "trusted" as const };
    }
    return { event: p.event, state: "unapproved" as const };
  });
}

/** Is Codex's own `memories` feature switched on in config.toml (`[features] memories = true`)? */
export function codexMemoriesOn(text: string): boolean {
  let inFeatures = false;
  for (const l of scanToml(text)) {
    if (l.header !== null) {
      inFeatures = l.header === "features";
      continue;
    }
    if (l.inString) continue;
    if (inFeatures && /^\s*memories\s*=\s*true\b/.test(l.code)) return true;
    if (/^\s*features\s*\.\s*memories\s*=\s*true\b/.test(l.code)) return true;
  }
  return false;
}

/**
 * hooks.json written back in ITS OWN indentation and line ending (CX2 fix
 * round): the indent of its first indented line (two spaces when there is
 * none), and a final newline when it had one.
 */
export function formatLike(previous: string | null, doc: unknown): string {
  const indent = previous === null ? "  " : (/\n([ \t]+)\S/.exec(previous)?.[1] ?? "  ");
  const eol = previous !== null && previous.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(doc, null, indent).replace(/\n/g, eol);
  return previous === null || /\r?\n$/.test(previous) ? `${body}${eol}` : body;
}

// ─── doctor ─────────────────────────────────────────────────────────────────

/**
 * DOCTOR'S CODEX LINES (2026-11-09, CX2; CX1 §5). Reads Codex's files only —
 * never runs `codex` (doctor does not run somebody's program to grade them),
 * so two things are said, not measured: the installed version, and whether the
 * login is alive (`codex login status` said "logged in" over a dead token on
 * 11-09). Quiet — no lines at all — on a machine where nothing of ours is in
 * Codex's files.
 *
 * The finding's shape is structural (the `doctor` report's own `Finding`), so
 * this library file imports no other adapter.
 */

export interface CodexFinding {
  readonly key: string;
  readonly severity: "red" | "amber" | "green";
  readonly title: string;
  readonly detail: string;
  readonly fix: string;
  readonly data: Record<string, string | number | boolean | null>;
}

export interface CodexDoctorInput {
  /** `$CODEX_HOME`, or `~/.codex`. */
  readonly codexHome: string;
  /** Is a `codex` executable on PATH (a directory walk)? Null when there is no PATH. */
  readonly codexOnPath: boolean | null;
  /** How the person's console names `connect` (`counterparts`). */
  readonly cli: string;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The newest rollout under `sessions/YYYY/MM/DD/`, or null. A bounded walk: newest year, month, day first. */
export function newestRollout(codexHome: string): string | null {
  const desc = (dir: string): string[] => {
    try {
      return readdirSync(dir).sort().reverse();
    } catch {
      return [];
    }
  };
  const root = join(codexHome, "sessions");
  for (const y of desc(root)) {
    for (const m of desc(join(root, y))) {
      for (const d of desc(join(root, y, m))) {
        const file = desc(join(root, y, m, d)).find((f) => /^rollout-.*\.jsonl$/.test(f));
        if (file !== undefined) return join(root, y, m, d, file);
      }
    }
  }
  return null;
}

export function codexFindings(input: CodexDoctorInput): CodexFinding[] {
  const hooksPath = join(input.codexHome, "hooks.json");
  const tomlPath = join(input.codexHome, "config.toml");
  let hooksDoc: unknown = {};
  const hooksRaw = read(hooksPath);
  try {
    hooksDoc = hooksRaw === null ? {} : JSON.parse(hooksRaw);
  } catch {
    hooksDoc = {};
  }
  const toml = read(tomlPath) ?? "";
  const positions = ourPositions(hooksDoc);
  const mcp = codexMcpEntry(toml);
  if (positions.length === 0 && mcp === null) return [];
  const connect = `${input.cli} connect --host codex`;
  const out: CodexFinding[] = [];

  out.push(
    input.codexOnPath === false
      ? { key: "codex.cli", severity: "amber", title: "Codex", detail: "Counterparts is wired into Codex's files, but there is no `codex` on PATH.", fix: "Install Codex (npm i -g @openai/codex), or disconnect it: counterparts disconnect --host codex", data: { onPath: false } }
      : {
          key: "codex.cli",
          severity: "green",
          title: "Codex",
          detail: `codex ${input.codexOnPath === null ? "(PATH not searched)" : "on PATH"}; home ${input.codexHome}. Its login is not checked here — \`codex login status\` can say logged in over an expired token; a 401 in a session means \`codex login\`.`,
          fix: "",
          data: { onPath: input.codexOnPath },
        },
  );

  // THE FOUR HOOKS, AND WHETHER THE PERSON APPROVED THEM (route i).
  const missing = CODEX_EVENTS.filter((e) => !positions.some((p) => p.event === e.event)).map((e) => e.event);
  let realHooks = hooksPath;
  try {
    realHooks = realpathSync(hooksPath);
  } catch {
    /* the path as named */
  }
  const trust = trustOf(positions, hookStates(toml), [...new Set([hooksPath, realHooks])]);
  const unapproved = trust.filter((t) => t.state === "unapproved").map((t) => t.event);
  const disabled = trust.filter((t) => t.state === "disabled").map((t) => t.event);
  if (missing.length > 0) {
    out.push({ key: "codex.hooks", severity: "amber", title: "Codex hooks", detail: `Missing from ${hooksPath}: ${missing.join(", ")}.`, fix: connect, data: { missing: missing.length } });
  } else if (unapproved.length > 0 || disabled.length > 0) {
    out.push({
      key: "codex.hooks",
      severity: "amber",
      title: "Codex hooks",
      detail: `${unapproved.length > 0 ? `Not approved yet: ${unapproved.join(", ")}` : ""}${unapproved.length > 0 && disabled.length > 0 ? "; " : ""}${disabled.length > 0 ? `switched off in Codex: ${disabled.join(", ")}` : ""}. Codex skips a hook until it is approved, so there is no wake, recall or capture there yet.`,
      fix: "Start Codex, type /hooks, approve the Counterparts hooks, then restart Codex",
      data: { unapproved: unapproved.length, disabled: disabled.length },
    });
  } else {
    out.push({
      key: "codex.hooks",
      severity: "green",
      title: "Codex hooks",
      detail: "All four approved in Codex (SessionStart, UserPromptSubmit, Stop, SessionEnd). Codex asks again if an update changes their command.",
      fix: "",
      data: { approved: positions.length },
    });
  }

  // THE MCP SERVER, told it serves Codex.
  if (mcp === null) {
    out.push({ key: "codex.mcp", severity: "amber", title: "Codex MCP", detail: `No [mcp_servers.counterparts] in ${tomlPath}: the hooks run, the memory tools don't.`, fix: connect, data: { present: false } });
  } else {
    const args = mcp["args"] ?? "";
    const host = /"--host"\s*,\s*"codex"/.test(args);
    out.push(
      host
        ? { key: "codex.mcp", severity: "green", title: "Codex MCP", detail: `counterparts in ${tomlPath}, serving Codex.`, fix: "", data: { present: true } }
        : { key: "codex.mcp", severity: "amber", title: "Codex MCP", detail: `counterparts in ${tomlPath} is not launched with --host codex, so it serves as if Codex's model were the counterpart.`, fix: connect, data: { present: true, host: false } },
    );
  }

  // CODEX'S OWN MEMORY, which would disagree with this one.
  if (codexMemoriesOn(toml)) {
    out.push({
      key: "codex.memories",
      severity: "amber",
      title: "Codex memories",
      detail: "Codex's own memories feature is on: two memories of the same conversations would disagree.",
      fix: `Turn it off: set memories = false under [features] in ${tomlPath}`,
      data: { on: true },
    });
  }

  // THE NEWEST TRANSCRIPT, READ AS THE STOP HOOK READS IT.
  const newest = newestRollout(input.codexHome);
  if (newest !== null) {
    const t = readCodexTranscript(newest);
    out.push(
      t.ok
        ? { key: "codex.transcript", severity: "green", title: "Codex transcript", detail: `The newest session's transcript reads: ${String(t.turns.length)} turns${t.corrupt > 0 ? `, ${String(t.corrupt)} unreadable lines` : ""}.`, fix: "", data: { turns: t.turns.length, corrupt: t.corrupt } }
        : { key: "codex.transcript", severity: "amber", title: "Codex transcript", detail: `The newest session's transcript would not read (${newest}): capture at Stop reads it.`, fix: "Check its permissions; if Codex has moved transcripts elsewhere, this build cannot capture them", data: { ok: false } },
    );
  }
  return out;
}

// ─── the hook entry ─────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** The payload and one read of its rollout, as the adapter's input. Exported for tests. */
export function toCodexHookInput(
  payload: Readonly<Record<string, unknown>>,
  transcript: CodexTranscriptRead,
  opts: { readonly scope: string; readonly timeZone?: string },
): CodexHookInput {
  const transcriptPath =
    typeof payload["transcript_path"] === "string" && payload["transcript_path"].length > 0 ? payload["transcript_path"] : undefined;
  const model = typeof payload["model"] === "string" && payload["model"].length > 0 ? payload["model"] : transcript.model;
  const attended = attendedOfOriginator(transcript.originator);
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope: opts.scope,
    turns: transcript.turns,
    expansions: transcript.expansions,
    ...(transcriptPath !== undefined && !transcript.ok ? { turnsUnread: true } : {}),
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
    ...(model === undefined ? {} : { model }),
    ...(transcript.compactedAt === undefined ? {} : { compactedAt: transcript.compactedAt }),
    ...(payload["stop_hook_active"] === true ? { reFired: true } : {}),
    ...(typeof payload["prompt"] === "string" ? { prompt: payload["prompt"] } : {}),
    ...(typeof payload["source"] === "string" && payload["source"].length > 0 ? { source: payload["source"] } : {}),
    ...(attended === undefined ? {} : { attended }),
    at: todayIn(resolveZone(opts.timeZone)),
  };
}

/** Run one Codex hook event: what this file does as a script. Never throws past its caller. */
export async function runCodexHook(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
  out: { stdout: (s: string) => void; stderr: (s: string) => void } = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  },
  /** The worker's starter: injected by a test, so no real worker runs over a temp store. */
  spawner?: Spawner,
): Promise<{ outcome: string }> {
  const name: CodexHookName | undefined = CODEX_EVENT_NAMES[String(payload["hook_event_name"] ?? "")];
  if (name === undefined) return { outcome: "not-ours" };
  const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
  const transcriptPath = typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : undefined;

  // WHICH CONFIGURATION, refused rather than guessed (`config-path.ts`), and
  // with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` an unnamed one stands down.
  const choice = hookConfigChoice(argv, env);
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    out.stderr(`[counterparts] codex hook stood down: ${refusal}\n`);
    return { outcome: "config-refused" };
  }
  // ONE READ OF THE ROLLOUT, shared by the stand-down and the capture.
  const transcript = readCodexTranscript(transcriptPath);

  // STARTED FROM INSIDE CLAUDE CODE (CX1 §6): nothing — no wake, no recall, no
  // capture — and one line, on stderr and in the process log of the store the
  // configuration names (no store is opened for it).
  const down = codexStandDown(env as Record<string, string | undefined>, transcript.originator);
  if (down !== null) {
    const why = down.by === "env" ? `env ${down.marker}` : `originator ${down.originator}`;
    out.stderr(`[counterparts] codex hook stood down: this Codex was started from inside Claude Code (${why}), which already records it\n`);
    try {
      const { config } = hostConfig(choice.path);
      openLog({ dataDir: config.dataDir, proc: `codex-hook:${name}`, session: sessionId, observer: config.observer === true }).end(
        "inside-claude-code",
        down.by === "env" ? { by: "env", marker: down.marker } : { by: "originator" },
      );
    } catch {
      /* the stderr line stands */
    }
    return { outcome: "inside-claude-code" };
  }

  // WHICH DIRECTORY, and what the person said about it — before a store opens.
  const eventDir = eventDirectory(payload, env);
  const { verdict: eventVerdict, read } = hookScopeVerdict(choice.path, eventDir);
  if (stanceOfMode(eventVerdict.mode) === "off") return { outcome: "scope-off" };
  const { config: loaded, reason } = hostConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    out.stderr(`[counterparts] codex hook stood down: ${unreadable}\n`);
    return { outcome: "config-unreadable" };
  }
  const scope = sessionScope(loaded.dataDir, payload, env);
  const verdict = mostRestrictiveVerdict(lookupScope(read.registry, scope), eventVerdict);
  if (stanceOfMode(verdict.mode) === "off") return { outcome: "scope-off" };
  const config: AdapterConfig = verdict.mode === "observer" ? { ...loaded, observer: true } : loaded;

  let log: ProcessLog | null = null;
  const toLog = (e: LogEvent): void => log?.event(e);
  const live = openEmbedder(config);
  const adapter = openCodexAdapter(config, {
    command: process.execPath,
    args: scriptArgs(WORKER_RUNNER_PATH),
    configPath: choice.path,
    ...(spawner === undefined ? {} : { spawner }),
    scope: verdict,
    ...(read.error === null ? {} : { scopeUnreadable: read.error }),
    ...(read.refused.length === 0 ? {} : { scopeRefused: read.refused.map((r) => r.key) }),
    embedder: live === null ? null : { embed: live.embed, vectors: live },
    onEvent: toLog,
    onCounterpartEvent: toLog,
  });
  const opened = openLog({
    dataDir: adapter.counterpart.store.dir,
    proc: `codex-hook:${name}`,
    session: sessionId,
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    observer: config.observer === true,
  });
  log = opened;
  if (name !== "user-prompt-submit") opened.start();
  let outcome = "ok";
  try {
    const input = toCodexHookInput(payload, transcript, { scope, ...(loaded.timeZone === undefined ? {} : { timeZone: loaded.timeZone }) });
    const result = adapter.hook(name, input);
    outcome = result.reason;
    const stdout = codexDelivery(name, result, payload);
    if (stdout.length > 0) out.stdout(stdout);
  } finally {
    adapter.counterpart.close();
  }
  opened.end(outcome, {});
  return { outcome };
}

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {};
  try {
    const text = await readStdin();
    if (text.trim().length > 0) payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* an unreadable payload is a quiet hook, never a failed session */
  }
  await runCodexHook(payload);
}

/** True only when this file is the process entry point, so a test may import it. */
export function isEntryPoint(argv1: string | undefined, url: string, binary: Binary | null = BINARY): boolean {
  if (argv1 === undefined || binary !== null) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

/** Run the hook and exit 0, whatever happened. */
export function start(): void {
  usePrivateUmask();
  void main().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`[counterparts] codex hook stood down: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(0);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) start();
