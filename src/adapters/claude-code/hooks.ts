/**
 * The hooks — this host's sensory and motor surface.
 *
 * Everything host-specific lives here so the core stays host-agnostic
 * (constitution 5). The rules this file mechanizes, each from the CONTRACT:
 *
 *   **G2 — no hook ever fails the host.** Every entry point below is wrapped in
 *   `guard()`: one try/catch, one logged failure, one safe return. There is no
 *   path out of this file that throws.
 *   **G3 — every session-ending path reaches the boundary.** `SESSION_ENDING`
 *   is the enumeration and `BOUNDARY_KIND` the mapping; `test/claude-code.test.ts`
 *   walks the list and asserts each one claims spans. Compaction destroying the
 *   transcript must not destroy the day (spec §2 G5).
 *   **G4 — host limits are reported, not assumed.** The injection ceiling comes
 *   from configuration and reaches the core as an argument; a bundle that
 *   exceeds it is an EVENT, never a silent truncation (scar §2.18/§2.4).
 *   **G7 — an observer stands down at the hook boundary**, and says so.
 *   **G8 — the read cursor is per-session and advances after a successful
 *   append**, which is `remember/`'s property; the adapter's job is to hand it
 *   the same session key every time and never to re-slice the transcript itself.
 *   **§2.3 — delivery telemetry is distinct from render telemetry.** The wake
 *   states its own sentinel; the NEXT hook reports the last line the host
 *   actually placed in context. v1 shipped eleven days of truncated wakes
 *   because only the render was instrumented.
 *   **§2 G10/G11 — conversational text only, and injected context is excluded
 *   from PACING but kept in CAPTURE.** `substanceOf` counts one and
 *   `captureSpans` receives the other; the two are computed from the same turns
 *   in the same function, so they cannot drift apart.
 *   **The parallel run's G3/G5 — exactly one system delivers, and the shadow is
 *   ENCODE-ONLY.** Behind `parallel.enabled` (absent by default), every
 *   DELIVERING hook asks `primacy.ts` first and stands down when the answer is
 *   anything but a clean "engram". A stand-down withholds the wake, the recall
 *   and both asks; it withholds NOTHING from capture, because the shadow's whole
 *   job is to encode the same days v1 encodes. Both verdicts are durable
 *   (parallel-run G4: the mute is evidenced, not asserted).
 */
import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  Counterpart,
  RECALL_CREDIT_EVENT,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RECALL_DELIVERED_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT,
} from "../../core/counterpart.js";
import type { AdapterDurableEventName } from "../../core/counterpart.js";
import type { BoundaryKind, Turn as CapturedTurn } from "../../core/remember/index.js";

import { CONFIG_FILE_EVENT } from "../config-path.js";
import { pruneSessions, recordSession } from "../sessions.js";
import type { SessionPhase } from "../sessions.js";

import { capabilities, interpretSeat } from "./config.js";
import { TUNABLES } from "./config.js";
import type { AdapterConfig, CapabilityReport } from "./config.js";
import { CREDENTIAL_FILE_EVENT, credentialRow } from "./credentials.js";
import type { CredentialLoad } from "./credentials.js";
import { primacy } from "./primacy.js";
import { planSpawn, spawnDetached } from "./spawn.js";
import type { SpawnOutcome, Spawner } from "./spawn.js";
import type { Expansion } from "./transcript.js";

/** Every hook this adapter installs, by the name it is wired under. */
export const HOOKS = [
  "session-start",
  "user-prompt-submit",
  "stop",
  "session-end",
  "pre-compact",
] as const;
export type HookName = (typeof HOOKS)[number];

/**
 * The session-ending paths. THREE, not one — the whole point of G3. `stop` is
 * the ordinary turn end, `session-end` is the host closing the session, and
 * `pre-compact` is the transcript about to be destroyed.
 */
export const SESSION_ENDING = ["stop", "session-end", "pre-compact"] as const;
export type SessionEndingHook = (typeof SESSION_ENDING)[number];

/** Host event name → `remember/`'s boundary vocabulary. Total by construction. */
export const BOUNDARY_KIND: Record<SessionEndingHook, BoundaryKind> = {
  stop: "stop",
  "session-end": "session-end",
  "pre-compact": "pre-compaction",
};

/** A turn as the host reports it. `source` is what makes G10/G11 decidable. */
export interface HostTurn extends CapturedTurn {}

export interface HookInput {
  readonly sessionId: string;
  /** The project scope. The host's cwd, resolved — never a raw relative path. */
  readonly scope: string;
  /** The transcript slice the host can see. The cursor decides what is new. */
  readonly turns?: readonly HostTurn[];
  /** Deliberate-recall calls positioned against `turns` (`transcript.ts#Expansion`). */
  readonly expansions?: readonly Expansion[];
  /** What the user typed this turn (`user-prompt-submit`). */
  readonly prompt?: string;
  /** The last line the host actually placed in context — delivery, not render. */
  readonly sentinelSeen?: string | null;
  /** Today's calendar date, for the temporal channel and the horizon lane. */
  readonly at?: string;
  /**
   * THE HOST'S RE-FIRE. A blocked Stop comes back with `stop_hook_active`, and
   * that pass must ask nothing — v1's anti-loop, kept for the same reason. It is
   * checked HERE, not only at delivery, so the re-fire also burns no pacing and
   * no day-cap slot: a silent ask that still advanced the counters would spend
   * the day's chapters on nobody.
   */
  readonly reFired?: boolean;
}

export interface HookResult {
  readonly hook: HookName;
  readonly ok: boolean;
  readonly reason: string;
  /** What to add to the host's context. The EMPTY STRING on a quiet hook. */
  readonly injection: string;
  readonly bytes: number;
  /** The render's own tail line, for the next hook's delivery check. */
  readonly sentinel: string | null;
  readonly surfaced: readonly string[];
  readonly footnotes: readonly string[];
  /**
   * THE ask — memories and the chapter, one text, one pacer. Null when this Stop
   * is not due one. There is exactly one field because there is exactly one ask:
   * two fields is how the blocked moment grew back into two asks (§13 G3).
   */
  readonly ask: string | null;
  readonly spansAppended: number;
  readonly spawn: SpawnOutcome | null;
  readonly observer: boolean;
}

export interface AdapterEvent {
  readonly at: number;
  readonly name: string;
  readonly data: Record<string, string | number | boolean | null>;
}

export interface AdapterOptions {
  readonly counterpart: Counterpart;
  readonly config: AdapterConfig;
  /** The interpreter the detached worker runs under. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly spawner?: Spawner;
  readonly onEvent?: (e: AdapterEvent) => void;
  readonly now?: () => number;
  /**
   * What this PROCESS's credential file answered, from the entry point that
   * loaded it (`bin/hook.ts`). Passed in rather than looked up: provenance is a
   * fact about one process's startup, and the adapter's only jobs with it are to
   * say `env` or `file` on the capability row and to leave ONE ring event saying
   * the file was used. Names and counts only — never a value.
   */
  readonly credentials?: CredentialLoad;
  /**
   * WHICH `claude-code.json` THIS PROCESS READ — an absolute path, resolved by
   * the entry point (`bin/hook.ts`, via `adapters/config-path.ts`) and passed in
   * for the same reason `credentials` is: it is a fact about one process's
   * startup, not something the adapter may go and re-derive.
   *
   * The adapter does three things with it, all of them recording:
   *   - one ring event at construction, exactly as the credential file gets;
   *   - the `config` field of every session registry record it writes, which is
   *     the only DURABLE trace a hook can leave of this (a hook has no stdout to
   *     tell the owner with — that channel is the model's context);
   *   - the pin onto the detached worker's environment, so parent and child read
   *     one file rather than resolving two.
   */
  readonly configPath?: string;
}

/**
 * THE ONE STOP ASK — v2's front door and its journal, in one text.
 *
 * The wording is advisory (remember G11 [A], CONTRACT §5 G9); that an ask exists
 * at a session-ending path is what is mechanized. It names the TOOLS, because
 * the RETURN channel is a tool, not a hook: a hook can only put text into the
 * context, and the deposits come back through `Counterpart.submitSessionEnd`
 * and `Counterpart.appendEpisode` — reached, in this host, by the MCP adapter's
 * `session_end` and `chapter` (`mcp/CONTRACT.md`). Filed in
 * `INTERFACE-GAPS.md` §7.
 *
 * **ONE ask, not two.** Behavioral-spec §13 G3 said it in v1's words — "the
 * blocked moment carries a single ask; new features do not get to grow it back
 * into two" — and v2 grew it back into two anyway: the authorship ask on its own
 * turn/byte pacer and the episode ask on the chapter pacer, firing at different
 * Stops. Measured 2026-09-04: about a dozen asks in a 13-turn evening. They are
 * one text on one pacer here, and the pacer is the chapter's.
 *
 * The other three corrections, all measured the same day:
 *
 *   - **It names the session id and both tools.** The host's MCP servers are
 *     launched from a static config and never learn which session they are
 *     serving, so the id has to travel in the ask — it is what the server binds
 *     itself with (`adapters/sessions.ts`, `mcp/server.ts#requireBoundSession`).
 *     Without it the model reached for `note` 34 times in one session and no
 *     session's dump ever landed. On the Stops where only the episode half
 *     fired, the model got no id and no tool name at all.
 *   - **`updates` is a FIELD, and the ask says so.** The old wording said
 *     "say `updates: <id>`", and four notes duly arrived with `updates: mem_x.`
 *     as the first words of their prose — unlinked, because prose is not a
 *     field. It is a field on a `session_end` entry AND on `note`.
 *   - **The chapter number is the store's.** It is one past what was WRITTEN,
 *     never one past what was asked, so an unanswered ask does not silently
 *     renumber the journal.
 *   - **It says salience is the author's to set.** An unclaimed authored memory
 *     takes a modest default floor, deliberately below the semantic band
 *     (`physics/`, 2026-09-04), and the author's own claim is the only channel
 *     by which lived testimony outranks something a sweep noticed — the sweep's
 *     claim is capped where the author's is not.
 *
 * Short on purpose: a model reads this at every Stop that is due one.
 */
export function stopAsk(sessionId: string, chapter: number): string {
  return [
    "Before this session closes, two things, both yours to write:",
    `1. What did you LEARN here that is worth keeping? Your own words, one idea per memory, the way you would want to find it again. Hand them back with the counterparts session_end tool, session: ${sessionId}. \`updates\` is a FIELD on an entry (and on note), never prose: the id of the memory that entry revises. Set \`salience\` (0-1) on anything that should last: unset entries take a modest default, and your claim is the only way what you lived outranks what a sweep noticed.`,
    chapter === 1
      ? `2. Write this session's episode with the counterparts chapter tool, session: ${sessionId} — first person, your voice, any length: what happened and what mattered, how it felt, what you learned about them and about yourself, what is still open. For the next you, not a report; append in the moment when something happens later.`
      : `2. Add chapter ${String(chapter)} to this session's episode with the counterparts chapter tool, session: ${sessionId} — this stretch, in the moment, in your own voice. Not a recap of the earlier chapters.`,
    "Nothing worth keeping is a real answer, and a short true episode beats a manufactured deep one.",
  ].join("\n");
}

const EVENT_RING = 500;

/**
 * Where the per-reason spawn refusal counters live: box 2's meta, under
 * `adapter.spawn.refusals.<reason>`.
 *
 * In the STORE because scar E4's escalation is a claim about a HOST over time
 * and a hook process lives for one turn. I32 is the bill for having kept it in
 * an instance field: the worker was refused at every boundary for a week and
 * `escalate` read false every single time, because every count was the first.
 *
 * Meta keys, not a schema change — the same shape `sleep.pruned.<id>` uses.
 */
export const SPAWN_REFUSAL_PREFIX = "adapter.spawn.refusals.";

export class ClaudeCodeAdapter {
  readonly counterpart: Counterpart;
  readonly config: AdapterConfig;
  readonly observer: boolean;

  private readonly command: string;
  private readonly args: readonly string[];
  private readonly spawner: Spawner | undefined;
  private readonly onEvent: ((e: AdapterEvent) => void) | undefined;
  private readonly nowFn: () => number;
  private readonly credentials: CredentialLoad | undefined;
  /** The `claude-code.json` this process read — recorded, pinned, never re-derived. */
  private readonly configPath: string | undefined;
  private readonly ring: AdapterEvent[] = [];
  /** The anti-loop guard: one hook per session in flight at a time. */
  private readonly inFlight = new Set<string>();
  /** The sentinel the LAST render stated, per session — delivery's expectation. */
  private readonly expected = new Map<string, string | null>();
  /**
   * Consecutive identical spawn refusals, per reason (scar E4's escalation) —
   * IN MEMORY ONLY when this adapter cannot write, which is the observer case.
   *
   * The durable copy lives in box 2's meta under `adapter.spawn.refusals.<reason>`
   * and is the one that counts. This map used to BE the counter, and that is
   * half of why I32 ran for a week: a hook process lives for one turn, so
   * "consecutive" was always 1, `escalate` was always false, and scar E4's
   * widening — a repeated refusal reaches a human — was inert on this host after
   * shipping. An instrument still counts here and nowhere else (§15 G3).
   */
  private readonly volatileRefusals = new Map<string, number>();

  constructor(opts: AdapterOptions) {
    this.counterpart = opts.counterpart;
    this.config = opts.config;
    this.observer = opts.counterpart.observer;
    this.command = opts.command ?? process.execPath;
    this.args = opts.args ?? [];
    this.spawner = opts.spawner;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
    this.credentials = opts.credentials;
    this.configPath = opts.configPath;
    // ONE event naming the configuration this process read, for the same reason
    // the credential file gets one: a hook's stdout belongs to the model, so
    // "which file answered" has nowhere else to go in-process. The durable half
    // is the session record's `config` field (`noteSession`).
    if (opts.configPath !== undefined && opts.configPath.length > 0) {
      this.emit(CONFIG_FILE_EVENT, { path: opts.configPath });
    }
    // ONE event, and only when the file actually answered. A run whose keys came
    // from the environment says nothing here, so the presence of this line in
    // the ring IS the record that the configured file was the source (§4 G4:
    // a host fact, surfaced rather than assumed). Last in the constructor:
    // `emit` needs `nowFn`.
    if (opts.credentials !== undefined && opts.credentials.loaded.length > 0) {
      this.emit(CREDENTIAL_FILE_EVENT, credentialRow(opts.credentials));
    }
  }

  events(name?: string): AdapterEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  /** §4 G4: every host-dependent limit, as a checkable value. */
  capabilities(): CapabilityReport[] {
    return capabilities(this.config, process.env, this.credentials);
  }

  // ── session start: the wake ────────────────────────────────────────────────

  /**
   * Inject what the previous boundary published. Zero compute, zero model calls,
   * zero network (§1 G1) — and THE WAKE NEVER FAILS THE SESSION (§1 G7): every
   * failure below returns the empty string and a clean exit.
   */
  sessionStart(input: HookInput): HookResult {
    return this.guard("session-start", input, (out) => {
      // BEFORE the delivery verdict, because the registry is not delivery: a
      // muted shadow still lives a session, and the tool that writes its dump
      // still has to be able to find out that the session is real.
      this.noteSession("start", input);
      // FIRST, before anything is read or composed: is this ours to deliver?
      // A stand-down sets no delivery expectation, because there is no render
      // for the next hook to check — recording one would put a false negative
      // into scar §2.3's telemetry on every muted day.
      if (!this.deliveryVerdict("session-start", input)) {
        return { ...out, ok: true, reason: "primacy-standdown" };
      }
      const budget = this.config.injectionBudgetBytes;
      if (budget === undefined) {
        // The tripwire. We inject what exists, and we say that nobody told us
        // what this host can carry — an invented ceiling is scar §2.18.
        this.emit("adapter.budget.unreported", {});
      }
      // THE DELIVERY PREFACE is asked for here, at injection, and composed
      // nowhere else. The stored bundle was rendered at the last boundary and is
      // served unchanged to every session until the next one; on 2026-09-03 the
      // memory system under this host changed mid-day and the body went on
      // speaking as the old one, with only the HTML comment naming the new. The
      // date is the HOST's — this hook is the only place that has it — and
      // nothing in the line varies between two sessions of the same day, so the
      // delivery expectation below stays a stable string (§2.3).
      const woke = this.counterpart.wake(budget, {
        ...(input.at === undefined ? {} : { date: input.at }),
      });
      this.expected.set(input.sessionId, woke.sentinel);

      if (budget !== undefined && woke.bytes > budget) {
        // Exceeding a reported limit is an EVENT, never silent degradation. The
        // bundle still goes: truncated-and-detectable beats absent.
        this.emit("adapter.injection.overbudget", { bytes: woke.bytes, budget });
      }
      this.record(WAKE_INJECTED_EVENT, input, {
        ok: woke.ok,
        reason: woke.reason,
        bytes: woke.bytes,
        budget: budget ?? null,
        sentinel: woke.sentinel !== null,
        preface: woke.preface !== null,
      });
      return {
        ...out,
        ok: woke.ok,
        reason: woke.reason,
        injection: woke.text,
        bytes: woke.bytes,
        sentinel: woke.sentinel,
      };
    });
  }

  // ── the turn ───────────────────────────────────────────────────────────────

  /**
   * Recall for this turn. The delivery check for the PREVIOUS render runs first
   * (scar §2.3), then the composed recall — all three borrowed channels bound by
   * the composition root, with today's date so the temporal channel exists.
   */
  userPromptSubmit(input: HookInput): HookResult {
    return this.guard("user-prompt-submit", input, (out) => {
      // The stand-down precedes the delivery check for the same reason it
      // precedes the recall: a muted session rendered nothing, so there is no
      // expectation to test and a "not delivered" record would be a lie.
      if (!this.deliveryVerdict("user-prompt-submit", input)) {
        return { ...out, ok: true, reason: "primacy-standdown" };
      }
      if (input.sentinelSeen !== undefined) {
        const expected = this.expected.get(input.sessionId) ?? null;
        const delivered = this.counterpart.noteWakeDelivered(input.sentinelSeen, expected);
        this.record(WAKE_DELIVERED_EVENT, input, { delivered, expected: expected !== null });
      }
      const text = input.prompt ?? "";
      if (text.trim().length === 0) {
        return { ...out, ok: true, reason: "empty-prompt" };
      }
      const result = this.counterpart.recallForTurn(
        {
          sessionId: input.sessionId,
          text,
          ...(this.config.injectionBudgetBytes === undefined
            ? {}
            : { budgetBytes: this.config.injectionBudgetBytes }),
        },
        { ...(input.at === undefined ? {} : { at: input.at }) },
      );
      const decision = result.decision;
      this.expected.set(input.sessionId, decision.sentinel);
      this.record(RECALL_DELIVERED_EVENT, input, {
        reason: decision.reason,
        surfaced: decision.surfaced.length,
        footnotes: decision.footnotes.length,
        bytes: decision.bytes,
        budget: decision.budgetBytes,
        observer: decision.observer,
        // WHERE the semantic channel's input came from, on the row a coverage
        // watch can read out of the store tomorrow. `semantic: "none"` on every
        // real turn is exactly the finding this PR closes; anything but
        // "lagged" here after a worker ran is the lag failing, by name.
        semantic: decision.semanticSource,
        semanticFrom: decision.semanticFromTurn,
      });
      return {
        ...out,
        ok: true,
        reason: decision.reason,
        injection: result.injection,
        bytes: decision.bytes,
        sentinel: decision.sentinel,
        // The footnote tier is carried SEPARATELY from the loud one, because the
        // two mean different things to reinforcement: a footnote trains nothing.
        surfaced: decision.surfaced,
        footnotes: decision.footnotes,
      };
    });
  }

  // ── the boundary, and the three paths that reach it ────────────────────────

  /**
   * THE APPENDER. Microseconds, no model call, no judgment — and it cannot throw
   * into the host, because `SpanBuffer.capture` swallows its own failures and
   * `guard()` catches anything above it (§2 G1/G12).
   */
  boundary(hook: SessionEndingHook, input: HookInput): HookResult {
    return this.guard(hook, input, (out) => this.claim(hook, input, out));
  }

  /**
   * Stop: the boundary, then the ONE ask, then the detached worker.
   *
   * Order matters. The spans are durable before anything else is attempted, so a
   * crash between here and the worker costs a run, never a day. The ask's state
   * advance is committed inside `self.openChapter` BEFORE the ask is handed
   * back, so a crash cannot re-ask in a loop (§13 G3–G4); and any failure in the
   * ask is fail-open — collection never depends on the ritual (§13 G5).
   */
  stop(input: HookInput): HookResult {
    return this.guard("stop", input, (out) => {
      const claimed = this.claim("stop", input, out);
      // The clock the lazy bind reads, refreshed BEFORE the ask that names this
      // session id goes out: the id has to be live by the time the model reads
      // it, and a session already running when this shipped never saw a
      // SessionStart write — so this is also where it first becomes bindable.
      this.noteSession("boundary", input);
      // The boundary is UNCONDITIONAL — the shadow encodes the same days v1
      // encodes, and a parallel run that stopped capturing would be comparing
      // nothing (parallel-run G5: encode-only, and honest). What the stand-down
      // withholds is the ASK, which is delivery: an ask from a system the
      // owner is not talking to today is exactly the double-voice G3 forbids.
      const deliver = this.deliveryVerdict("stop", input);
      // THE AUTHORED FRONT DOOR, first: the experiencer writes its own memories
      // while it still has the pen, and the sweep the worker spawns below is
      // only the fallback for the day nobody got to (contract §4). The ask goes
      // out after the spans are durable, so a crash between the two costs a
      // dump, never a day.
      //
      // The worker below still spawns at EVERY boundary — it carries the
      // Hebbian flush and the sleep cycle, which are not optional — but since
      // 2026-09-04 its sweep step selects nothing unless a session is CRASHED
      // (`remember/fallback.ts`: uncovered spans, no `session-end` boundary,
      // silent past `CRASH_STALE_MS`). Before that gate this line was a comment
      // the code did not keep: one evening's Stops billed 13 chunks and minted
      // 61 memories beside 34 the model had authored itself.
      const ask = deliver ? this.askAtStop(input) : null;
      const spawn = this.spawnWorker(input);
      return { ...claimed, ask, spawn };
    });
  }

  /** The host closing the session: a boundary, the tail measurement, a worker. */
  sessionEnd(input: HookInput): HookResult {
    return this.guard("session-end", input, (out) => {
      const claimed = this.claim("session-end", input, out);
      // One tiny rename, inside the 1.5 s this event's hooks share. It closes
      // the session to any later claim: a dump arriving after this is the
      // sweep's job, not the experiencer's.
      this.noteSession("end", input);
      this.noteTail(input);
      return { ...claimed, spawn: this.spawnWorker(input) };
    });
  }

  /**
   * Pre-compaction: the transcript is about to be destroyed. This is the
   * compaction-amnesia backstop, and it is why the boundary list has three
   * members instead of one.
   */
  preCompact(input: HookInput): HookResult {
    return this.guard("pre-compact", input, (out) => {
      const claimed = this.claim("pre-compact", input, out);
      this.noteTail(input);
      return claimed;
    });
  }

  /** Dispatch by name — what the entry script calls, and what the totality test walks. */
  hook(name: HookName, input: HookInput): HookResult {
    switch (name) {
      case "session-start":
        return this.sessionStart(input);
      case "user-prompt-submit":
        return this.userPromptSubmit(input);
      case "stop":
        return this.stop(input);
      case "session-end":
        return this.sessionEnd(input);
      case "pre-compact":
        return this.preCompact(input);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * MAY THIS HOOK DELIVER? — the parallel run's G3, at every delivering channel.
   *
   * Without the knob this is `true` and nothing is emitted at all: the flag's
   * absence must be indistinguishable from a build that never had it, or every
   * test and every ordinary session grows a primacy record it cannot explain.
   *
   * With the knob, `primacy()` decides and BOTH verdicts are recorded — the
   * stand-down because an unevidenced mute is indistinguishable from a broken
   * hook (parallel-run G4, scar §2.4), and the delivery because a Phase P day
   * has to be able to show positive evidence that v2 spoke. Each record goes to
   * the ring AND to box 2, because the ring dies with the hook process and the
   * daily count is a claim about the run.
   *
   * `date` rides in the durable payload deliberately: the log's `day` column is
   * the store's LIVED day, which only the heavy cycle advances, so a hook-path
   * row would stamp whatever lived day the store was already on.
   */
  private deliveryVerdict(hook: HookName, input: HookInput): boolean {
    if (this.config.parallel?.enabled !== true) return true;
    const verdict = primacy();
    const name = verdict.deliver ? PRIMACY_DELIVER_EVENT : PRIMACY_STANDDOWN_EVENT;
    const data = {
      hook,
      reason: verdict.reason,
      system: verdict.system,
      date: input.at ?? null,
      session: input.sessionId,
    };
    this.emit(name, data);
    this.counterpart.noteAdapterEvent(name, data);
    return verdict.deliver;
  }

  /**
   * A DELIVERY record: to the ring and to box 2, with the calendar date and the
   * session riding in the payload for the same reason `deliveryVerdict` puts
   * them there — the store's `day` column is the lived day, and the parallel
   * run counts these per calendar day, per session, after the process is gone.
   */
  private record(
    name: AdapterDurableEventName,
    input: HookInput,
    data: Record<string, string | number | boolean | null>,
  ): void {
    const row = { ...data, date: input.at ?? null, session: input.sessionId };
    this.emit(name, row);
    this.counterpart.noteAdapterEvent(name, row);
  }

  /**
   * Capture and record the boundary. ONE function for all three paths, so a
   * fourth session-ending event added later cannot accidentally get a different
   * shape (G3).
   */
  private claim(hook: SessionEndingHook, input: HookInput, out: HookResult): HookResult {
    const turns = input.turns ?? [];
    // G10/G11 computed side by side: capture takes EVERYTHING conversational
    // including host-injected context; pacing counts only what the user said.
    const captured = this.counterpart.captureSpans({
      session: input.sessionId,
      scope: input.scope,
      turns,
    });
    const record = this.counterpart.boundary({
      session: input.sessionId,
      scope: input.scope,
      kind: BOUNDARY_KIND[hook],
    });
    // Reference resolution (recall §9.2) over the SAME slice capture just took:
    // the cursor is the one authority on what is new, for credit as for spans.
    this.creditAtBoundary(input, captured.cursorBefore, captured.cursorAfter);
    this.record(BOUNDARY_EVENT, input, {
      hook,
      kind: record.kind,
      captured: captured.captured,
      reason: captured.reason,
      spans: captured.spans.length,
      deduped: captured.deduped,
      excluded: captured.excluded,
      cursorBefore: captured.cursorBefore,
      cursorAfter: captured.cursorAfter,
      ask: record.askRaised,
    });
    return { ...out, ok: true, reason: captured.reason, spansAppended: captured.spans.length };
  }

  /**
   * THE ONE ASK, ON ONE PACER, fail-open: an error in the ritual never costs the
   * collection (§13 G5).
   *
   * What changed on 2026-09-04, and why:
   *
   *   - **One pacer.** The authorship ask paced itself on turns-and-bytes since
   *     its own last ask; the episode ask paced itself on the chapter rule. They
   *     fired on different Stops, so the model was asked about a dozen times in
   *     one 13-turn evening. `episodeAsk` is now the only pacer, and its verdict
   *     decides whether this Stop says anything at all.
   *   - **The coverage read stays, as a RECORD and not a gate.** It measures
   *     rather than assumes (§2 G12) and it puts the unaskable tail on the
   *     record as a number instead of a hope; what it must not do is add a
   *     second condition to a single ask.
   *   - **The re-fired Stop asks nothing and advances nothing.**
   */
  /**
   * THE CREDIT SEAM — the consumer recall INTERFACE-GAPS §5 said had no home.
   *
   * Assistant `conversation` turns and deliberate-recall calls from the new
   * slice go to `Counterpart.creditReferences`, which decides (`reference.ts`)
   * and credits (`resolveUses`). One durable row per boundary, `recall.credit`,
   * with a `reason` the daily's readers split on: `credited` is the signal the
   * `memory.reinforced` watch turns green on; `failed` and `budget-exceeded`
   * are the ones to alarm on. A boundary that credits nothing still leaves its
   * row (`nothing-to-credit` / `no-candidates`) — silence must never masquerade
   * as health, and a seam that only wrote rows when it worked would be the ring
   * this repo already learned from (I32).
   *
   * Never fails the boundary: telemetry may not fail the host (§1 G7), and a
   * credit that could not be decided is a `failed` row, not a lost capture.
   */
  private creditAtBoundary(input: HookInput, from: number, to: number): void {
    const started = this.nowFn();
    // Read before the try: the failed row carries the day too.
    const day = this.counterpart.store.livedDay();
    const turns = input.turns ?? [];
    const slice = turns.slice(Math.max(0, from), Math.max(from, to));
    const assistantTurns = slice
      .filter((t) => t.role === "assistant" && (t.source === undefined || t.source === "conversation"))
      .map((t) => t.text);
    // Half-open on the left: a call positioned AT `from` sat before the first
    // new turn and belonged to the previous slice, which already judged it.
    const expansions = (input.expansions ?? [])
      .filter((e) => e.atTurn > from && e.atTurn <= to)
      .flatMap((e) => [...e.ids]);
    try {
      const summary = this.counterpart.creditReferences(input.sessionId, {
        assistantTurns,
        expansions,
        deadline: started + TUNABLES.CREDIT_BUDGET_MS,
        now: this.nowFn,
      });
      this.emit(RECALL_CREDIT_EVENT, {
        reason: summary.reason,
        considered: summary.considered,
        expanded: summary.expanded,
        quoted: summary.quoted,
        credited: summary.credited,
        elapsedMs: this.nowFn() - started,
      });
      this.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
        reason: summary.reason,
        session: input.sessionId,
        date: input.at ?? null,
        day: summary.day,
        turns: assistantTurns.length,
        considered: summary.considered,
        expanded: summary.expanded,
        quoted: summary.quoted,
        credited: summary.credited,
        unresolvedHandles: summary.unresolvedHandles,
        skippedForBudget: summary.skippedForBudget,
        unreadable: summary.unreadable,
        refused: summary.refused,
        ids: summary.ids.slice(0, 64),
        idsTotal: summary.ids.length,
        elapsedMs: this.nowFn() - started,
      });
    } catch (err) {
      const code = codeOf(err);
      this.emit(RECALL_CREDIT_EVENT, { reason: "failed", code });
      this.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
        reason: "failed",
        session: input.sessionId,
        date: input.at ?? null,
        day,
        code,
        turns: assistantTurns.length,
        expansions: expansions.length,
      });
    }
  }

  private askAtStop(input: HookInput): string | null {
    try {
      // The host's re-fire of a blocked Stop. Nothing is evaluated: no pacing
      // advance, no day-cap slot, no row — the previous pass already left one.
      if (input.reFired === true) return null;
      const substance = substanceOf(input.turns ?? []);
      // THE DAY'S CAP IS CHARGED TO THE CALENDAR DATE, not the lived day (I32).
      // `input.at` is the host's UTC ISO date — the same zone as every other
      // `date` field in this store. The worker advances the lived-day clock, so
      // keying the cap on it made the cap depend on the very machinery whose
      // failure it then hid: a frozen clock meant `self.episode.day.185 = 4`
      // forever, and the model was never asked for a chapter again.
      const chapter = this.counterpart.episodeAsk(
        input.sessionId,
        substance,
        undefined,
        input.at,
      );
      const outcome = chapter.asked
        ? "asked"
        : chapter.verdict.reason === "day-chapter-cap"
          ? "capped"
          : "paced";
      let coverage: { spans: number; covered: number; uncovered: number; unaskableSpans: number; unaskableBytes: number } | null =
        null;
      try {
        coverage = this.counterpart.spans.coverageReport(input.scope);
      } catch (err) {
        this.emit("adapter.coverage.failed", { code: codeOf(err) });
      }
      this.record(ADAPTER_ASK_EVENT, input, {
        asked: chapter.asked,
        outcome,
        reason: chapter.verdict.reason,
        chapter: chapter.chapter,
        turns: substance.turns,
        bytes: substance.bytes,
        sinceTurns: chapter.verdict.sinceTurns,
        sinceBytes: chapter.verdict.sinceBytes,
        spans: coverage?.spans ?? null,
        covered: coverage?.covered ?? null,
        uncovered: coverage?.uncovered ?? null,
        unaskableSpans: coverage?.unaskableSpans ?? null,
        unaskableBytes: coverage?.unaskableBytes ?? null,
      });
      // The ask NAMES this session and its chapter: the id is what the MCP
      // server binds itself with, so an ask that omitted it would be an
      // invitation the model has no way to accept on this host — and the
      // chapter number is the STORE's, one past what was written.
      return chapter.asked ? stopAsk(input.sessionId, chapter.chapter) : null;
    } catch (err) {
      this.emit("adapter.ask.failed", { code: codeOf(err) });
      return null;
    }
  }

  /**
   * THE LIVE-SESSION REGISTRY (`adapters/sessions.ts`), written here because the
   * hooks are the only thing on this host that knows the session id.
   *
   * Host state, not memory: an id, a scope, three timestamps, no content. It is
   * what lets the MCP server — which this host launches from a static config
   * that carries no session — bind itself to the session the ask named, and
   * refuse anything else. Ring-only telemetry: this fires at every Stop, and a
   * durable row per turn to say "the file was written" is not evidence anyone
   * needs.
   *
   * Under observer NOTHING is recorded (the tools stand down anyway), and every
   * failure is silent by construction: `recordSession` returns null rather than
   * throwing, because a hook may not fail the host (§5 G2).
   */
  private noteSession(phase: SessionPhase, input: HookInput): void {
    if (this.observer) return;
    if (input.sessionId.length === 0) return;
    // The STORE's dir, not the config's: it is the one that went through
    // `assertSafeDataDir`, and it is the same value the MCP server resolves on
    // its own side. Reading the raw config here could put the registry in a
    // sibling directory the tool never looks in, over a trailing slash.
    const dir = this.counterpart.store.dir;
    const record = recordSession(dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase,
      at: this.nowFn(),
      // THE DURABLE ANSWER TO "WHICH CONFIG DID THIS HOOK READ". A hook cannot
      // print it — stdout is the model's context — so it is recorded here, in
      // the one file this process writes that is host state rather than memory,
      // under the store the configuration itself named. A record written by a
      // process that was told nothing carries no field at all.
      ...(this.configPath === undefined || this.configPath.length === 0
        ? {}
        : { config: this.configPath }),
    });
    this.emit("adapter.session.registry", { phase, ok: record !== null });
    // Bounded growth, once per session rather than once per turn — and never on
    // the SessionEnd path, whose hooks share 1.5 s between them.
    if (phase === "start") {
      const pruned = pruneSessions(dir, this.nowFn());
      if (pruned > 0) this.emit("adapter.session.registry.pruned", { removed: pruned });
    }
  }

  /** The orphanable tail: bounded and measured, never pretended away (§13). */
  private noteTail(input: HookInput): void {
    try {
      // The same counter the ask above is charged to, for the same reason.
      this.counterpart.noteOrphanTail(
        input.sessionId,
        substanceOf(input.turns ?? []),
        undefined,
        input.at,
      );
    } catch (err) {
      this.emit("adapter.tail.failed", { code: codeOf(err) });
    }
  }

  /**
   * The detached worker. The plan is checked BEFORE anything starts — watchdog
   * against the staleness window, data dir, stance — and a refusal that repeats
   * ESCALATES rather than re-logging (scar E4's widening).
   *
   * **The credential is NOT a precondition any more** (I32, 2026-09-11). The
   * worker starts without one and degrades the single step that needs it; see
   * `spawn.ts`'s §2.18 paragraph for why refusing was worse than running.
   *
   * **Every refusal and every failure now leaves a DURABLE row**, one per reason
   * per calendar date, and the per-reason counter that decides escalation lives
   * in box 2's meta rather than in this object. Both halves are the same repair:
   * a hook process lives for one turn, so anything it knows about a repeated
   * failure dies before the next hook could act on it.
   */
  private spawnWorker(input?: HookInput): SpawnOutcome {
    // The child is TOLD whose turn it just followed. Without it the worker can
    // sweep and sleep but cannot leave the next turn a semantic cue, because
    // that cue is per-session state (`recall/session.ts`).
    const bound = {
      ...(input?.sessionId === undefined || input.sessionId.length === 0
        ? {}
        : { session: input.sessionId }),
      ...(input?.scope === undefined || input.scope.length === 0 ? {} : { scope: input.scope }),
      // The child reads the SAME configuration this process read. Without the
      // pin the worker would resolve its own — and a hook driven by `--config`
      // would spawn a worker that went back to the default file, which is the
      // shape scar §2.13 is about: parent and child resolving one value twice.
      ...(this.configPath === undefined || this.configPath.length === 0
        ? {}
        : { configPath: this.configPath }),
    };
    const seat = interpretSeat(this.config, new Date(this.nowFn()).toISOString().slice(0, 10));
    if (!seat.usable) {
      // A placeholder that expired is a decision nobody made (scar §2.15c). It
      // has never stopped the spawn and must not start to: the seat belongs to
      // the SWEEP's model call, which is one of the worker's five jobs, and the
      // interpret client refuses it by name at the far end. Said here so the
      // ring carries the reason the sweep is about to decline.
      this.emit("adapter.spawn.seat", { seat: seat.seat, status: seat.status });
    }
    const plan = planSpawn({
      config: this.config,
      command: this.command,
      args: this.args,
      priorFailures: 0,
      ...bound,
    });
    // The PERSISTED count, read before the replan: `escalate` is a claim about
    // how often this has happened on this host, not about this process.
    const prior = plan.ok ? 0 : this.refusalCount(plan.reason);
    const replanned = plan.ok
      ? plan
      : planSpawn({
          config: this.config,
          command: this.command,
          args: this.args,
          priorFailures: prior,
          ...bound,
        });
    const outcome = spawnDetached(replanned, {
      ...(this.spawner === undefined ? {} : { spawner: this.spawner }),
      onEvent: (name, data) => this.emit(name, data),
    });
    if (outcome.started) {
      // A start clears the slate for every reason: whatever was wrong is not
      // wrong now, and a counter that only ever climbed would escalate forever
      // off one bad afternoon.
      this.clearRefusals();
      return outcome;
    }
    const count = this.bumpRefusal(String(outcome.reason));
    this.noteSpawnRefusal(outcome, count, input);
    return outcome;
  }

  /**
   * THE DURABLE ROW for a worker that did not start (I32).
   *
   * One row per reason per CALENDAR DATE — `dedupKey` does the gating at the
   * store, so a refusal repeating at every boundary writes once and not three
   * hundred times. `count` is the persisted counter AT THIS MOMENT, so the day's
   * one row still says how deep the hole was by the time it was written; the
   * live depth is `spawnRefusals()`.
   *
   * Never throws: this is the tail of a hook, and a hook may not fail the host
   * (§5 G2). An observer writes nothing — `noteAdapterEvent` stands down at the
   * core's own seam, and the counter above stayed in memory for the same reason.
   */
  private noteSpawnRefusal(outcome: SpawnOutcome, count: number, input?: HookInput): void {
    if (this.observer) return;
    const name = outcome.reason === "SPAWN_FAILED" ? SPAWN_FAILED_EVENT : SPAWN_REFUSED_EVENT;
    const date = input?.at ?? null;
    try {
      this.counterpart.noteAdapterEvent(
        name,
        {
          reason: String(outcome.reason),
          code: outcome.code,
          count,
          escalate: outcome.escalate,
          date,
          session: input?.sessionId ?? null,
        },
        // No date is still one row per reason per RUN OF DAYS rather than per
        // boundary: a caller that knows no date is a test or a bare invocation,
        // and neither should be able to flood the log.
        { dedupKey: `${name}:${String(outcome.reason)}:${date ?? "no-date"}` },
      );
    } catch (err) {
      this.emit("adapter.spawn.record.failed", { code: codeOf(err) });
    }
  }

  /**
   * The per-reason refusal counters, as they stand. PR 2's session-start notice
   * reads this — "your background worker has not started in four days" is a
   * sentence somebody has to be able to say — and it is a read, never a write.
   */
  spawnRefusals(): Record<string, number> {
    const out: Record<string, number> = {};
    if (this.observer) {
      for (const [reason, n] of this.volatileRefusals) out[reason] = n;
      return out;
    }
    try {
      for (const [key, value] of this.counterpart.store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
        const n = Number(value);
        if (n > 0) out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
      }
    } catch (err) {
      this.emit("adapter.spawn.refusals.failed", { code: codeOf(err) });
    }
    return out;
  }

  private refusalCount(reason: string): number {
    if (this.observer) return this.volatileRefusals.get(reason) ?? 0;
    try {
      return Number(this.counterpart.store.getMeta(`${SPAWN_REFUSAL_PREFIX}${reason}`) ?? "0");
    } catch {
      return 0;
    }
  }

  /** Returns the count AFTER this refusal. A meta write that loses the lock to
   *  an overlapping runner costs the count, never the hook (§5 G2). */
  private bumpRefusal(reason: string): number {
    const next = this.refusalCount(reason) + 1;
    if (this.observer) {
      this.volatileRefusals.set(reason, next);
      return next;
    }
    try {
      this.counterpart.store.setMeta(`${SPAWN_REFUSAL_PREFIX}${reason}`, String(next));
    } catch (err) {
      this.emit("adapter.spawn.count.failed", { code: codeOf(err) });
    }
    return next;
  }

  private clearRefusals(): void {
    this.volatileRefusals.clear();
    if (this.observer) return;
    try {
      const store = this.counterpart.store;
      for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
        // Zero, not deleted: `meta` has no delete on the write seam's allowlist,
        // and a zero reads identically everywhere the counter is consulted.
        if (value !== "0") store.setMeta(key, "0");
      }
    } catch (err) {
      this.emit("adapter.spawn.count.failed", { code: codeOf(err) });
    }
  }

  /**
   * The one wrapper. Stance first (an instrument stands down and SAYS SO), then
   * the anti-loop guard, then the work — and nothing that happens inside reaches
   * the host as an exception (G2, G7).
   */
  private guard(
    hook: HookName,
    input: HookInput,
    body: (out: HookResult) => HookResult,
  ): HookResult {
    const base: HookResult = {
      hook,
      ok: false,
      reason: "unknown",
      injection: "",
      bytes: 0,
      sentinel: null,
      surfaced: [],
      footnotes: [],
      ask: null,
      spansAppended: 0,
      spawn: null,
      observer: this.observer,
    };
    const key = `${hook}:${input.sessionId}`;
    if (this.inFlight.has(key)) {
      // Re-entrancy: our own injection lands in the transcript, and a hook that
      // re-enters on it would recall on its own render forever.
      this.emit("adapter.reentrant", { hook, session: input.sessionId });
      return { ...base, ok: true, reason: "reentrant" };
    }
    this.inFlight.add(key);
    try {
      if (this.observer && hook !== "session-start" && hook !== "user-prompt-submit") {
        // An instrument reads (the wake is delivered, recall works) and deposits
        // nothing. The stand-down is logged: silence is indistinguishable from a
        // broken hook (scar E7, §2.4).
        this.emit("adapter.observer.standdown", { hook });
        return { ...base, ok: true, reason: "observer" };
      }
      return body(base);
    } catch (err) {
      // NO HOOK EVER FAILS THE HOST (G2). Logged, swallowed, clean exit.
      this.emit("adapter.hook.failed", { hook, code: codeOf(err) });
      return { ...base, ok: false, reason: "failed" };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private emit(name: string, data: Record<string, string | number | boolean | null>): void {
    const event: AdapterEvent = { at: this.nowFn(), name, data };
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    try {
      this.onEvent?.(event);
    } catch {
      // Even telemetry may not fail the host (§1 G7: "failed telemetry means
      // the bootstrap line or nothing, and a clean exit").
    }
  }
}

/**
 * Substance for PACING — conversational turns only.
 *
 * Host-injected material is user-role but is not the user speaking, so it must
 * not pace a ritual (§2 G11); tool output, file contents and images are the
 * declared blind spot and never counted (§2 G10). The same turn list feeds
 * `captureSpans`, where injected context IS kept — the two rules live one
 * function apart on purpose.
 */
export function substanceOf(turns: readonly HostTurn[]): { turns: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const turn of turns) {
    if ((turn.source ?? "conversation") !== "conversation") continue;
    count += 1;
    bytes += Buffer.byteLength(turn.text, "utf8");
  }
  return { turns: count, bytes };
}

function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}
