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
import {
  INJECTION_OVERBUDGET_EVENT,
  WAKE_INJECTED_EVENT,
} from "../../core/counterpart.js";
import type { BoundaryKind } from "../../core/remember/index.js";
import { isDirectoryScope, projectFolder } from "../../core/self/work.js";
import { CODEX_HOST } from "../hosts.js";
import { Lifecycle, codeOf } from "../lifecycle.js";
import type { LifecycleOptions, SessionInput } from "../lifecycle.js";
import { stanceOfMode } from "../scopes.js";
import { readSession } from "../sessions.js";
import type { SpawnOutcome } from "../spawn.js";
import { codexFrame, codexStopAsk } from "./words.js";

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
