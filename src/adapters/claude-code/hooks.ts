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
  AUTHORSHIP_ASK_EVENT,
  BOUNDARY_EVENT,
  Counterpart,
  EPISODE_ASK_EVENT,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RECALL_DELIVERED_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT,
} from "../../core/counterpart.js";
import type { AdapterDurableEventName } from "../../core/counterpart.js";
import type { BoundaryKind, Turn as CapturedTurn } from "../../core/remember/index.js";

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
  /** What the user typed this turn (`user-prompt-submit`). */
  readonly prompt?: string;
  /** The last line the host actually placed in context — delivery, not render. */
  readonly sentinelSeen?: string | null;
  /** Today's calendar date, for the temporal channel and the horizon lane. */
  readonly at?: string;
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
  /** The episode ask, when a chapter is due. Never more than one per hook. */
  readonly ask: string | null;
  /**
   * The session-end AUTHORSHIP ask: the experiencer's invitation to write its
   * own memories while it still has the pen. Null when this scope has nothing
   * uncovered left to author.
   */
  readonly authorshipAsk: string | null;
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
}

/**
 * The session-end authorship ask — v2's FRONT DOOR, in words.
 *
 * The wording is advisory (remember G11 [A], CONTRACT §5 G9); that an ask exists
 * at a session-ending path is what is mechanized. It names the TOOL, because the
 * RETURN channel is a tool, not a hook: a hook can only put text into the
 * context, and the deposit comes back through `Counterpart.submitSessionEnd` —
 * reached, in this host, by the MCP adapter's `session_end`
 * (`mcp/CONTRACT.md`). Filed in `INTERFACE-GAPS.md` §7.
 *
 * Two corrections, both measured 2026-09-04 on the live host:
 *
 *   - **It names the session id and the tool.** The host's MCP servers are
 *     launched from a static config and never learn which session they are
 *     serving, so the id has to travel in the ask — it is what the server binds
 *     itself with (`adapters/sessions.ts`, `mcp/server.ts#requireBoundSession`).
 *     Without it the model reached for `note` 34 times in one session and no
 *     session's dump ever landed.
 *   - **`updates` is a FIELD, and the ask says so.** The old wording said
 *     "say `updates: <id>`", and four notes duly arrived with `updates: mem_x.`
 *     as the first words of their prose — unlinked, because prose is not a
 *     field. It is a field on a `session_end` entry AND on `note`.
 *
 * Short on purpose: a model reads this at every Stop that is due one.
 */
export function authorshipAsk(sessionId: string): string {
  return [
    "Before this session closes: what did you LEARN here that is worth keeping?",
    "Write it yourself — your own words, not a summary of the transcript. One idea",
    "per memory, the way you would want to find it again. Hand them back with the",
    `counterparts session_end tool, session: ${sessionId}.`,
    "`updates` is a FIELD on an entry (and on note), never prose: set it to the id",
    "of the memory that entry revises. Nothing worth keeping is a real answer.",
  ].join("\n");
}

const EVENT_RING = 500;

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
  private readonly ring: AdapterEvent[] = [];
  /** The anti-loop guard: one hook per session in flight at a time. */
  private readonly inFlight = new Set<string>();
  /** The sentinel the LAST render stated, per session — delivery's expectation. */
  private readonly expected = new Map<string, string | null>();
  /** Consecutive identical spawn refusals, per reason (scar E4's escalation). */
  private readonly spawnFailures = new Map<string, number>();

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
      // withholds is the two ASKS, which are delivery: an ask from a system the
      // owner is not talking to today is exactly the double-voice G3 forbids.
      const deliver = this.deliveryVerdict("stop", input);
      // THE AUTHORED FRONT DOOR, first: the experiencer writes its own memories
      // while it still has the pen, and the sweep the worker spawns below is
      // only the fallback for the day nobody got to (contract §4). The ask goes
      // out after the spans are durable, so a crash between the two costs a
      // dump, never a day.
      const authorshipAsk = deliver ? this.askForAuthorship(input) : null;
      const ask = deliver ? this.askForEpisode(input) : null;
      const spawn = this.spawnWorker(input);
      return { ...claimed, ask, authorshipAsk, spawn };
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
   * The authorship ask, raised only when there is something to author: spans
   * this scope holds that no proposal has covered. `coverageReport` is a READ
   * that measures rather than assumes (§2 G12), and it also puts the unaskable
   * tail — the stretch after the last boundary that nobody can be asked about —
   * on the record as a number instead of a hope.
   *
   * Fail-open, like the episode ask: collection never depends on the ritual.
   */
  private askForAuthorship(input: HookInput): string | null {
    try {
      const report = this.counterpart.spans.coverageReport(input.scope);
      // PACED: the host's Stop is every turn, so "anything uncovered" would ask
      // every turn. The last ask's span count is read out of the durable log
      // (the hook process does not survive between turns), and the next ask
      // waits for AUTHORSHIP_REASK_SPANS new spans — the episode ritual's own
      // cadence. The first ask in a session is immediate.
      const substance = substanceOf(input.turns ?? []);
      const lastAsked = this.lastAuthorshipAsk(input.sessionId);
      const due =
        report.uncovered > 0 &&
        (lastAsked === null ||
          (substance.turns >= lastAsked.turns + TUNABLES.AUTHORSHIP_REASK_TURNS &&
            substance.bytes >= lastAsked.bytes + TUNABLES.AUTHORSHIP_REASK_BYTES));
      this.record(AUTHORSHIP_ASK_EVENT, input, {
        asked: due,
        paced: report.uncovered > 0 && !due,
        turns: substance.turns,
        bytes: substance.bytes,
        spans: report.spans,
        covered: report.covered,
        uncovered: report.uncovered,
        unaskableSpans: report.unaskableSpans,
        unaskableBytes: report.unaskableBytes,
      });
      // The ask NAMES this session: the id is what the MCP server binds itself
      // with, so an ask that omitted it would be an invitation the model has no
      // way to accept on this host.
      return due ? authorshipAsk(input.sessionId) : null;
    } catch (err) {
      this.emit("adapter.authorship.ask.failed", { code: codeOf(err) });
      return null;
    }
  }

  /** The substance at this session's last authorship ask, from the durable log; null if never asked. */
  private lastAuthorshipAsk(sessionId: string): { turns: number; bytes: number } | null {
    let last: { turns: number; bytes: number } | null = null;
    for (const row of this.counterpart.store.eventLog({ name: AUTHORSHIP_ASK_EVENT, limit: 2000 })) {
      try {
        const p = JSON.parse(row.payload ?? "{}") as { session?: unknown; asked?: unknown; turns?: unknown; bytes?: unknown };
        if (p.session === sessionId && p.asked === true && typeof p.turns === "number" && typeof p.bytes === "number") {
          if (last === null || p.turns >= last.turns) last = { turns: p.turns, bytes: p.bytes };
        }
      } catch {
        continue;
      }
    }
    return last;
  }

  /** ONE ask, fail-open: an error in the ritual never costs the collection. */
  private askForEpisode(input: HookInput): string | null {
    try {
      const chapter = this.counterpart.episodeAsk(input.sessionId, substanceOf(input.turns ?? []));
      this.record(EPISODE_ASK_EVENT, input, {
        asked: chapter.asked,
        chapter: chapter.chapter,
        reason: chapter.verdict.reason,
      });
      return chapter.ask;
    } catch (err) {
      this.emit("adapter.episode.ask.failed", { code: codeOf(err) });
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
      this.counterpart.noteOrphanTail(input.sessionId, substanceOf(input.turns ?? []));
    } catch (err) {
      this.emit("adapter.tail.failed", { code: codeOf(err) });
    }
  }

  /**
   * The detached worker. The plan is checked BEFORE anything starts — watchdog
   * against the staleness window, credential, data dir, stance — and a refusal
   * that repeats ESCALATES rather than re-logging (scar E4's widening).
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
    };
    const seat = interpretSeat(this.config, new Date(this.nowFn()).toISOString().slice(0, 10));
    if (!seat.usable) {
      // A placeholder that expired is a decision nobody made; the worker's only
      // job needs that seat, so it does not start (scar §2.15c).
      this.emit("adapter.spawn.seat", { seat: seat.seat, status: seat.status });
    }
    const reasonKey = (r: string): number => this.spawnFailures.get(r) ?? 0;
    const plan = planSpawn({
      config: this.config,
      command: this.command,
      args: this.args,
      priorFailures: 0,
      ...bound,
    });
    const prior = plan.ok ? 0 : reasonKey(plan.reason);
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
    if (outcome.started) this.spawnFailures.clear();
    else this.spawnFailures.set(String(outcome.reason), prior + 1);
    return outcome;
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
      authorshipAsk: null,
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
