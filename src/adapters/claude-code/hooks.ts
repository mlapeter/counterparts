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
 *   states its own sentinel; the FIRST PROMPT of the session reads the head of
 *   the host's transcript and reports what the host recorded as injected. The
 *   expectation is carried in the session registry record, because every hook is
 *   its own process. v1 shipped eleven days of truncated wakes because only the
 *   render was instrumented.
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
  CHECKOUT_EVENT,
  Counterpart,
  RECALL_CREDIT_EVENT,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RECALL_DELIVERED_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SPAWN_STARTED_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT,
} from "../../core/counterpart.js";
import type { AdapterDurableEventName } from "../../core/counterpart.js";
import type {
  BoundaryKind,
  CaptureResult,
  Turn as CapturedTurn,
} from "../../core/remember/index.js";

import { CONFIG_FILE_EVENT } from "../config-path.js";
import {
  SCOPE_EVENT,
  SCOPE_JOINED_LATE_EVENT,
  SCOPE_REFUSED_EVENT,
  SCOPE_UNREADABLE_EVENT,
  stanceOfMode,
} from "../scopes.js";
import type { ScopeVerdict } from "../scopes.js";
import { countTranslated, readHandleResolutions, translateExpansions } from "../expansions.js";
import type { ExpansionsRead } from "../expansions.js";
import {
  decideUpdateNotice,
  installedBuild,
  markUpdateNoticeShown,
  owedWriteUps,
  progressKey,
  pruneSessions,
  pruneWriteUpProgress,
  readSession,
  readWriteUpProgress,
  recordSession,
  saveWriteUpPointer,
  saveWriteUpProgress,
  stampSessionOpened,
  WRITE_UP_PART_BYTES,
  writeUpEntries,
  writeUpParts,
  writeUpPlan,
} from "../sessions.js";
import type { SessionPhase, SessionRecord } from "../sessions.js";

import {
  SELF_PAGE_WRITER_EVENT,
  SELF_TUNABLES,
  calendarDate,
  writerInstruction,
  writerInstructionOverhead,
} from "../../core/self/index.js";
import { capabilities, pageWriterMode } from "./config.js";
import { TUNABLES } from "./config.js";
import type { AdapterConfig, CapabilityReport } from "./config.js";
import { SESSION_NOTICE_BUDGET_MS, checkoutIsGraded, doctorFindings, noticeMessage, readCheckout } from "./doctor.js";
import type { CheckoutReading } from "./doctor.js";
import { primacy } from "./primacy.js";
import { planSpawn, spawnDetached } from "./spawn.js";
import type { SpawnOutcome, Spawner } from "./spawn.js";
import { NO_ARRIVAL, STOP_ASK_OPENER, readWakeArrival } from "./transcript.js";
import type { Expansion, WakeArrival } from "./transcript.js";

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

/** A turn as the host reports it. `source` is what makes G10/G11 decidable;
 *  `entry` (when the host has one) groups the blocks of one message, so pacing
 *  counts the message once (`transcript.ts#TranscriptTurn`). */
export interface HostTurn extends CapturedTurn {
  readonly entry?: number;
}

export interface HookInput {
  readonly sessionId: string;
  /** The project scope. The host's cwd, resolved — never a raw relative path. */
  readonly scope: string;
  /** The transcript slice the host can see. The cursor decides what is new. */
  readonly turns?: readonly HostTurn[];
  /** True when the host named a transcript this process could not read: the
   *  empty `turns` are then not a count, and pacing moves no watermark on them. */
  readonly turnsUnread?: boolean;
  /** Deliberate-recall calls positioned against `turns` (`transcript.ts#Expansion`). */
  readonly expansions?: readonly Expansion[];
  /** What the user typed this turn (`user-prompt-submit`). */
  readonly prompt?: string;
  /**
   * WHERE THE HOST IS KEEPING THIS SESSION'S TRANSCRIPT — the path the payload
   * named, carried so the delivery check can read the head of it and see what
   * the host recorded as injected at SessionStart (`transcript.ts`). The turns
   * above come from the same file, parsed for conversation; this is the same
   * file read for the one thing that parse deliberately skips.
   */
  readonly transcriptPath?: string;
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
  /**
   * The render's own tail line. At SessionStart it is also the expectation the
   * delivery check tests: it is written into the session registry record, and
   * the session's first prompt compares it against what the host's transcript
   * says arrived.
   */
  readonly sentinel: string | null;
  readonly surfaced: readonly string[];
  readonly footnotes: readonly string[];
  /**
   * THE ask this hook raises — at a Stop, memories and the chapter, one text,
   * one pacer. Null when this Stop is not due one. There is exactly one field
   * because there is exactly one ask at a boundary: two fields is how the
   * blocked moment grew back into two asks (§13 G3).
   *
   * SessionStart uses the same field for the first-launch scope question
   * (`SCOPE_ASK`, G41) and, since S2, for the nightly page writer's block. It
   * is the same field for the same reason: it is the one channel that reaches
   * the model WITHOUT being inside the wake bundle, whose byte count and tail
   * line are stated by its own sentinel.
   *
   * **Three claimants, and the rule is not "they cannot collide" any more** —
   * that sentence was true when there were two, one at `session-start` and one
   * at `stop`. The Stop ask still cannot meet either of the others, and the
   * Stop pacer is untouched by both. The two SessionStart ones CAN want the
   * field on the same morning, and there the first-launch question wins: it is
   * asked once in the life of a directory and ends when anybody answers, while
   * the writer's comes back tomorrow at no cost. The loser is deferred with an
   * event, never concatenated — two unrelated requests in front of a session
   * that has just woken is the shape §13 G3 is about, even though the pacer is
   * not involved.
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
   * WHICH `claude-code.json` THIS PROCESS READ — an absolute path, resolved by
   * the entry point (`bin/hook.ts`, via `adapters/config-path.ts`) and passed in
   * because it is a fact about one process's startup, not something the adapter
   * may go and re-derive.
   *
   * The adapter does three things with it, all of them recording:
   *   - one ring event at construction;
   *   - the `config` field of every session registry record it writes, which is
   *     the only DURABLE trace a hook can leave of this (a hook has no stdout to
   *     tell the owner with — that channel is the model's context);
   *   - the pin onto the detached worker's environment, so parent and child read
   *     one file rather than resolving two.
   */
  readonly configPath?: string;
  /**
   * WHAT `<config dir>/scopes.json` SAYS ABOUT THIS DIRECTORY, resolved by the
   * entry point before anything opened (`bin/hook.ts#hookScopeVerdict`).
   *
   * The adapter does exactly two things with it: records it once, and — when it
   * is `unset` — appends the first-launch question to the wake, once per
   * session (G41). The `off` decision is NOT here: it is made in the entry
   * point, because "no output and no write" is only a guarantee if nothing was
   * constructed. `guard()` still refuses on it as a second, cheap site, for the
   * same reason the observer stand-down lives at the store seam as well as at
   * the entry point (observer-mode G8).
   */
  readonly scope?: ScopeVerdict;
  /** The sentence a registry that IS there and could not be read produced. */
  readonly scopeUnreadable?: string;
  /**
   * The ENTRIES that registry refused, by key (#92 review, F2). A file can parse
   * while one directory's entry does not, and those directories read as unset —
   * which is ON. Ring event here, and a flag on the wake's durable row, because
   * a hook process lives for one turn and "why is this directory recording
   * again" has to be answerable tomorrow.
   */
  readonly scopeRefused?: readonly string[];
}

/**
 * THE FIRST-LAUNCH QUESTION (owner ask G41, 2026-09-10).
 *
 * The hooks are registered globally, so the first session in a new directory
 * already has capture running by the time anyone could have been asked. The
 * honest fix the owner asked for is a question asked once and remembered — and
 * the host offers `SessionStart` as the only place to ask and no place at all
 * to receive an answer, which is `INTERFACE-GAPS.md` gap 7's shape all over
 * again. So the block asks the MODEL to ask the PERSON, and names the console
 * line that records the reply.
 *
 * Advisory wording, mechanized existence (CONTRACT §5 G9): what is guaranteed
 * is that an `unset` directory raises the question exactly once per session and
 * that setting any mode ends it, not the sentences.
 */
export const SCOPE_ASK = [
  "<counterparts-scope>",
  "No setting yet for this directory, so Counterparts is remembering here by default.",
  "Early on, ask the user once which they want: on, observer (reads and recalls, records",
  "nothing), or off (nothing at all). Record the answer with the `scope` tool (mode: on |",
  "observer | off), or with `counterparts scope . --on`, `--observer` or `--off`. Then",
  "do not ask again.",
  "</counterparts-scope>",
].join("\n");

/** The room the question needs, separator included. Measured, never guessed. */
export const SCOPE_ASK_BYTES = Buffer.byteLength(`\n\n${SCOPE_ASK}`, "utf8");

/**
 * THE NIGHTLY PAGE WRITER'S ASK, in `session` mode (S2, 2026-09-20).
 *
 * The plan's fallback for "who runs the nightly writer", and the one that needs
 * no background process: when nothing has revised the page for the day just
 * gone, the first session of the next day is handed that day and asked to do
 * the night's work. It rides in `HookResult.ask` — beside the wake, never
 * inside it — for the reason the scope question does: the wake's byte count and
 * its tail sentinel are load-bearing, and text appended inside the bundle would
 * make `bytes`, the sentinel's number and the tail disagree.
 *
 * **It is not a second pacer.** The scar this package carries about pacers
 * (`self/CONTRACT.md` §3, "one ask, one pacer, a conjunction") is about the
 * BLOCKED MOMENT at Stop, where two asks on two substance pacers once drew
 * about a dozen asks from a 13-turn evening. Nothing here touches that: this
 * fires at SessionStart, it consults no substance, and its cadence is the day
 * boundary itself — at most `PAGE_WRITER_ASKS_PER_DAY` sessions are handed one
 * day, and the first durable row claims it for everyone.
 *
 * The TEXT is the core's (`self/writer.ts#writerInstruction`), because it
 * carries the page and the day and those are memory, not host trivia. What is
 * mechanized here is that the moment exists, that it fits inside the reported
 * ceiling or is deferred rather than truncated, that one session is asked once,
 * and that the ask leaves a durable row (CONTRACT §5 G9).
 */
export const PAGE_WRITER_TOOL = "counterparts self_page";

/** The separator `bin/hook.ts#hostDelivery` joins the ask on after the wake. */
export const ASK_SEPARATOR_BYTES = 2;

/**
 * How many recorded deferrals the first-launch question gets before the writer
 * takes the ask field instead.
 *
 * ONE, because the two asks are not symmetrical. The scope question is
 * per-SESSION and comes back at the next one at no cost; the writer's night
 * happens once, and a night that passes is a day missing from the page for
 * good. On a blank store the scope question is exactly what is pending on
 * nights 1–3, so an unanswered one starved the writer for as long as nobody
 * answered — which on a store where nobody ever does is for ever (S2 review,
 * MINOR-5).
 *
 * It counts DEFERRAL ROWS, which are deduped one per night per reason, so the
 * flip is "this night has already lost the field once" — the first session of a
 * day raises the scope question, the second gives the writer its night, and the
 * third raises the scope question again because the night is claimed by then.
 */
export const SCOPE_PATIENCE_DEFERRALS = 1;

/**
 * THE NEXT-SESSION WRITE-UP'S POINTER (roadmap C2, owner 2026-09-23).
 *
 * A session that ended before it was written up — `remember/owes.ts#owesWriteUp`
 * says it owes, defined once by B3 — is written up by the NEXT session that
 * starts in its project. This hook does not carry its words: it puts a short
 * POINTER beside the wake in `HookResult.ask` (how many sessions here are
 * waiting, the oldest one's id, date and size, and the call that fetches it),
 * and the words come back through the MCP door (`mcp/write-up.ts`):
 * `session_end` with `writeUp` and no memories returns the next part, up to
 * ~24 KB; the same call with memories — or `[]`, "nothing worth keeping" —
 * answers it. Nothing leaves the machine beyond what Claude Code already sees;
 * the write-up is in the model's voice. (It is the only route: the opt-in
 * Anthropic API sweep was removed with the key, 2026-09-24.)
 *
 * **Why a pointer (owner's choice, 2026-09-23, option (b) of INTERFACE-GAPS
 * §15).** The host caps a hook's whole output at 10,000 characters and turns
 * anything longer into a preview — of the WAKE, which comes first. On a store
 * whose wake fills its budget there was no room for the words; an MCP result
 * is not under that cap. The pointer names the ended session ONCE and this
 * session once: ~410 bytes with the host's 36-character ids (measured).
 *
 * **Measured against the host's plain-stdout cap, not the reported budget**
 * (PR #192 review, MAJOR 1). The budget is what the WAKE is composed to; with no
 * owner notice `bin/hook.ts#hostDelivery` prints the wake and the asks as PLAIN
 * text, which the host caps at 10,000 characters with no JSON escaping to allow
 * for (bytes ≥ characters, so a byte count under the cap is a character count
 * under it). With a notice, `hostDelivery`'s own rule drops the notice when the
 * envelope would not fit — the wake and its asks win, as always. A pointer that
 * does not fit DEFERS, claims nothing, and says so durably
 * (`sessions.ts#WRITE_UP_POINTER_KEY`), which doctor reads. The count is BYTES
 * against a cap in characters — accepted (PR #192 re-review, NIT): it is the
 * safe direction, and it defers early only for a multi-byte wake over ~9,575
 * bytes, which is already past the 9,000-byte budget `install` writes.
 *
 * **Once per session, and the day's allowance.** A compaction re-firing
 * SessionStart points at nothing; at most `WRITE_UP_ASKS_PER_DAY` sessions a
 * calendar day (local time) are pointed. It MAY COINCIDE with the page writer's
 * ask or the first-launch question — the roadmap's reading of §13 G3, which is
 * about the blocked Stop: both are carried, the other first. Never under
 * observer, never in a directory set `off` (the entry point returns before
 * anything opens).
 */
export const WRITE_UP_OPEN = "<counterparts-write-up>";
export const WRITE_UP_CLOSE = "</counterparts-write-up>";
/** The door, named the way the other asks name their tools. */
export const WRITE_UP_TOOL = "counterparts session_end";
/** Today's pointer count, beside the spawn tally in box 2's meta: two fixed
 *  keys, the date and the count, so nothing grows without a sweep. */
export const WRITE_UP_ASK_DATE_KEY = "adapter.writeup.asks.date";
export const WRITE_UP_ASK_COUNT_KEY = "adapter.writeup.asks.count";

/** THE POINTER the model reads — short, because the words come from the door,
 *  and naming the ended session once. */
export function writeUpPointer(input: {
  waiting: number;
  ended: string;
  endedOn: string;
  bytes: number;
  part: number;
  of: number;
  live: string;
}): string {
  const some =
    input.waiting === 1
      ? "An earlier session here ended before it was written up"
      : `${String(input.waiting)} earlier sessions here ended before they were written up`;
  const size = input.bytes < 1024 ? "under 1 KB" : `~${String(Math.round(input.bytes / 1024))} KB`;
  const part = input.of <= 1 ? "" : `, part ${String(input.part)} of ${String(input.of)}`;
  return [
    WRITE_UP_OPEN,
    `${some}; the oldest, from ${input.endedOn}, left ${size} of what was said to it${part}. To write it up, call ${WRITE_UP_TOOL} with session: ${input.live}, writeUp: ${input.ended} and no memories to get the words, then again with the memories worth keeping (or memories: []).`,
    WRITE_UP_CLOSE,
  ].join("\n");
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
 * The other corrections, all measured the same day:
 *
 *   - **It names the session id and both tools.** The host's MCP servers are
 *     launched from a static config and never learn which session they are
 *     serving, so the id has to travel in the ask — it is what the server binds
 *     itself with (`adapters/sessions.ts`, `mcp/server.ts#requireBoundSession`).
 *     Without it the model reached for `note` 34 times in one session and no
 *     session's dump ever landed. On the Stops where only the episode half
 *     fired, the model got no id and no tool name at all.
 *   - **`updates` is a FIELD.** The old wording said "say `updates: <id>`",
 *     and four notes duly arrived with `updates: mem_x.` as the first words of
 *     their prose — unlinked, because prose is not a field. It is a field on a
 *     `session_end` entry AND on `note`, and since B1 it is the tool
 *     description that says so, not this text.
 *   - **The chapter number is the store's.** It is one past what was WRITTEN,
 *     never one past what was asked, so an unanswered ask does not silently
 *     renumber the journal.
 *   - **Salience is the author's to set.** An unclaimed authored memory takes
 *     a modest default floor, deliberately below the semantic band (`physics/`,
 *     2026-09-04), and the author's own claim is the only channel by which
 *     lived testimony outranks something a sweep noticed — the sweep's claim is
 *     capped where the author's is not. Since B1 the `salience` field's own
 *     description carries this.
 *
 * **SPLIT IN TWO, AND SHORT (B1, owner 2026-09-23).** The person used to read
 * all nine lines of this after every due Stop, printed as `Stop hook error:`,
 * though every word was written for the model (new-user finding #28). Now:
 *
 *   - the PERSON gets `STOP_HUMAN_LINE` — one plain line saying what is
 *     happening, carried as the hook's `systemMessage`
 *     (`bin/hook.ts#hostDelivery`);
 *   - the MODEL gets this: two numbered lines, both naming the session id and
 *     the tool that takes it, plus the two clauses that are about WHETHER to
 *     write — `handoff` only if work here is unfinished (it is a field on the
 *     same `session_end` call, not a third tool and not a second ask: §13 G3),
 *     and "nothing worth keeping is a real answer", which the server now
 *     accepts as `memories: []`.
 *
 * Everything else the old text said — `updates` is a FIELD, salience is a floor
 * and the author's to claim, what an episode is for, what a handoff is — is
 * in the tools' own descriptions (`mcp/tools.ts`), where the model reads it at
 * the moment it fills the fields. Saying it again at every Stop is what made
 * this a wall.
 *
 * It opens with `STOP_ASK_OPENER` (`transcript.ts`), which is how the reader
 * recognises this text coming home on a host-written entry and refuses it from
 * capture (`ritual`, CONTRACT §5 G11) whichever emission shape carried it —
 * today's `additionalContext`, or the stderr and `reason` shapes older
 * transcripts hold.
 */
export function stopAsk(sessionId: string, chapter: number): string {
  return [
    `${STOP_ASK_OPENER} 1) hand back what you learned here that is worth keeping with the counterparts session_end tool, session: ${sessionId} — set \`handoff\` on it only if work here is unfinished.`,
    `2) Write chapter ${String(chapter)} of this session's episode with the counterparts chapter tool, session: ${sessionId}. Nothing worth keeping is a real answer: send \`memories: []\`.`,
  ].join("\n");
}

/**
 * WHAT THE PERSON SEES WHEN THE STOP ASK GOES OUT — one line, theirs (B1).
 *
 * The owner's rule, 2026-09-23: "whatever we display in terminal should be
 * short and useful to the user since they're the one seeing it". It says what
 * is happening and who is doing it, and nothing the person has to act on.
 * Carried as the Stop hook's `systemMessage`, beside the ask's
 * `additionalContext` (`bin/hook.ts#hostDelivery`). The host also shows the
 * ask itself to the person, as `Stop hook feedback: …` — quieter than the
 * `Stop hook error:` it replaced (2026-09-24), not hidden.
 */
export const STOP_HUMAN_LINE = "Counterparts: asking the assistant to write up this session's memories.";

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

/**
 * The other side's counter (2026-09-20, E2): how many times the worker HAS
 * started today. Two fixed keys rather than one per date, because nothing mows
 * meta and the only question the `adapter.spawn.started` row asks of it is "how
 * many today" — the row itself carries the date.
 */
export const SPAWN_START_DATE_KEY = "adapter.spawn.started.date";
export const SPAWN_START_COUNT_KEY = "adapter.spawn.started.count";

export class ClaudeCodeAdapter {
  readonly counterpart: Counterpart;
  readonly config: AdapterConfig;
  readonly observer: boolean;

  private readonly command: string;
  private readonly args: readonly string[];
  private readonly spawner: Spawner | undefined;
  private readonly onEvent: ((e: AdapterEvent) => void) | undefined;
  private readonly nowFn: () => number;
  /** The `claude-code.json` this process read — recorded, pinned, never re-derived. */
  private readonly configPath: string | undefined;
  /** What the scope registry said about this directory. `unset` when nobody said. */
  readonly scope: ScopeVerdict;
  /**
   * WHETHER THE REGISTRY ITSELF WAS IN TROUBLE when this process read it, for
   * the wake's durable row (#92 review, F2): `unreadable` is the whole file,
   * `partial` is one or more entries refused by name. Null is the ordinary day,
   * and the field is `null` on the row rather than absent, so a reader can tell
   * "the registry was fine" from "this row predates the question".
   */
  private scopeTrouble: "unreadable" | "partial" | null = null;
  private readonly ring: AdapterEvent[] = [];
  /** The anti-loop guard: one hook per session in flight at a time. */
  private readonly inFlight = new Set<string>();
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
    this.configPath = opts.configPath;
    this.scope = opts.scope ?? { mode: "unset", matched: null, entry: null };
    // ONE event naming the configuration this process read: a hook's stdout
    // belongs to the model, so
    // "which file answered" has nowhere else to go in-process. The durable half
    // is the session record's `config` field (`noteSession`).
    if (opts.configPath !== undefined && opts.configPath.length > 0) {
      this.emit(CONFIG_FILE_EVENT, { path: opts.configPath });
    }
    // ONE event naming the scope verdict this process ran under, and which
    // entry produced it — the answer to "why did this directory record nothing
    // today", which is otherwise a question only a person reading two JSON
    // files can answer.
    this.emit(SCOPE_EVENT, {
      mode: this.scope.mode,
      matched: this.scope.matched,
      stance: stanceOfMode(this.scope.mode),
    });
    // A registry that IS there and could not be read resolved to `unset` — on,
    // today's behaviour — and says so, because a silent fall-back to the
    // default is exactly the shape scar §2.4 is about.
    if (opts.scopeUnreadable !== undefined && opts.scopeUnreadable.length > 0) {
      this.emit(SCOPE_UNREADABLE_EVENT, { detail: opts.scopeUnreadable });
    }
    // The per-ENTRY half of the same fact. Those directories read as unset,
    // which is on: an `off` somebody typed badly is an `off` nobody is keeping.
    if (opts.scopeRefused !== undefined && opts.scopeRefused.length > 0) {
      this.scopeTrouble = "partial";
      this.emit(SCOPE_REFUSED_EVENT, {
        count: opts.scopeRefused.length,
        keys: opts.scopeRefused.join(", "),
      });
    }
    // An unreadable FILE outranks refused entries: there were no entries.
    if (opts.scopeUnreadable !== undefined && opts.scopeUnreadable.length > 0) {
      this.scopeTrouble = "unreadable";
    }
  }

  events(name?: string): AdapterEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  /** §4 G4: every host-dependent limit, as a checkable value. */
  capabilities(): CapabilityReport[] {
    return capabilities(this.config);
  }

  // ── session start: the wake ────────────────────────────────────────────────

  /**
   * Inject what the previous boundary published. Zero compute, zero model calls,
   * zero network (§1 G1) — and THE WAKE NEVER FAILS THE SESSION (§1 G7): every
   * failure below returns the empty string and a clean exit.
   */
  sessionStart(input: HookInput): HookResult {
    return this.guard("session-start", input, (out) => {
      // ASKED BEFORE THE REGISTRY IS REWRITTEN: `noteSession` rewrites the
      // record whole, so the flag that says "this session has already been
      // asked" has to be read while it is still the previous process's answer.
      const wantsAsk = this.scopeAskDue(input);
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
      // WHERE this session woke rides beside WHEN (E1). The published bundle is
      // one per store and is read by sessions in every directory, so which
      // directory this one opened in is a delivery-time fact exactly as the date
      // is — and it is the only thing that can decide whose handoff pointer,
      // if any, belongs at the foot of this wake.
      const woke = this.counterpart.wake(
        budget,
        { ...(input.at === undefined ? {} : { date: input.at }) },
        { scope: input.scope, session: input.sessionId.length === 0 ? null : input.sessionId },
      );
      // THE EXPECTATION, WRITTEN WHERE THE NEXT PROCESS CAN READ IT. This used
      // to be a `Map` on this instance, which is a line that only looks like it
      // works: every hook is its own process, so the hook that tests it always
      // met an empty map. `adapter.wake.delivered` wrote no row in two weeks of
      // running (mechanism inventory 2026-09-17, S2).
      this.noteWakeExpectation(input, woke.sentinel);

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
        // THE DURABLE HALF of a registry in trouble (#92 review, F2). It rides
        // the session-start row this hook already writes, for the reason
        // `adapter.scope.unreadable` is ring-only: a durable event NAME is a
        // core change (`AdapterDurableEventName`) and this fact is about
        // exactly the moment that row describes.
        scopeRegistry: this.scopeTrouble,
      });
      // THE QUESTION RIDES BESIDE THE WAKE, NEVER INSIDE IT, and only if it
      // FITS.
      //
      // Beside, because the wake's own accounting is load-bearing: its sentinel
      // states the bundle's byte count and must be the LAST line of the bundle,
      // so a truncated wake is detectable from its tail alone (§1 G2, scar
      // §2.3). Text appended inside the injection would make `bytes`, the
      // sentinel's number and the tail all disagree — three lies to deliver one
      // question. `ask` is the field the host delivery already appends after
      // the injection (`bin/hook.ts#hostDelivery`), which is exactly the
      // placement asked for and costs the wake nothing.
      //
      // And only if it fits, because what the host places in context is the
      // whole block: the ceiling it reported governs the wake's bytes plus this
      // one's. With no room the ask is DEFERRED rather than truncated or
      // smuggled past the limit — the session record is left unmarked, so the
      // next session in this directory asks instead, and the deferral is an
      // event rather than a silence.
      //
      // TWO ASKS CAN NOW WANT THIS FIELD, and the first-launch question wins.
      // It is asked once in the life of a directory and ends when anybody
      // answers; the page writer's comes back tomorrow at no cost. Concatenating
      // them would put two unrelated requests in front of a session that has
      // just woken, which is the shape §13 G3 is about even though the pacer is
      // not. The loser is DEFERRED with a row, never dropped silently.
      // ...and after two mornings of losing, the writer goes first. The scope
      // question is advisory and returns at the next session; a night that
      // passes is a day missing from the page for good (S2 review, MINOR-5).
      const scopeFirst = wantsAsk && !this.writerStarvedByScope();
      const ask = scopeFirst ? this.deliverScopeAsk(input, woke.bytes, budget) : "";
      const chosen =
        ask.length > 0 ? ask : this.deliverPageWriterAsk(input, woke.bytes, budget, false);
      if (ask.length > 0) this.deliverPageWriterAsk(input, woke.bytes, budget, true);
      // THE WRITE-UP POINTER RIDES AFTER WHICHEVER ASK TOOK THE FIELD, never
      // instead of it (C2): it may coincide with either, it is measured against
      // the room BOTH of them left, and it is fail-open by construction — a
      // throw inside it costs the pointer and never the wake or the other ask.
      const chosenBytes = chosen.length === 0 ? 0 : Buffer.byteLength(`\n\n${chosen}`, "utf8");
      const writeUp = this.deliverWriteUpAsk(input, woke.bytes + chosenBytes);
      const asks = [chosen, writeUp].filter((a) => a.length > 0).join("\n\n");
      return {
        ...out,
        ok: woke.ok,
        reason: woke.reason,
        injection: woke.text,
        bytes: woke.bytes,
        sentinel: woke.sentinel,
        ask: asks.length === 0 ? null : asks,
      };
    });
  }

  /**
   * Is this session owed the first-launch question (G41)?
   *
   * Three ways to be owed nothing: the directory has an entry (somebody
   * answered, whatever they answered); this session was already asked; or this
   * is an instrument, which has no business asking a person to change a store
   * it may not write — and, having written no session record, no way to
   * remember that it did.
   */
  private scopeAskDue(input: HookInput): boolean {
    if (this.scope.mode !== "unset") return false;
    if (this.observer) {
      this.emit("adapter.scope.ask.skipped", { reason: "observer" });
      return false;
    }
    if (input.sessionId.length === 0) return false;
    try {
      return readSession(this.counterpart.store.dir, input.sessionId)?.askedScope !== true;
    } catch {
      // A registry this cannot read is not a reason to ask twice OR to fail a
      // hook; the quiet answer is the safe one.
      return false;
    }
  }

  /**
   * Deliver the question, and remember that it was delivered. Returns the block
   * to append, or the empty string when there was no room for it.
   */
  private deliverScopeAsk(input: HookInput, wakeBytes: number, budget: number | undefined): string {
    if (budget !== undefined && wakeBytes + SCOPE_ASK_BYTES > budget) {
      this.emit("adapter.scope.ask.deferred", {
        wakeBytes,
        budget,
        need: SCOPE_ASK_BYTES,
      });
      return "";
    }
    // The mark is a SECOND write of the same phase rather than a field folded
    // into the first: the first write happens before the delivery verdict (a
    // muted session still lives one) and the ask is decided after the wake, so
    // one write cannot carry both facts without moving the other.
    const marked = recordSession(this.counterpart.store.dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase: "start",
      at: this.nowFn(),
      askedScope: true,
      ...(this.configPath === undefined || this.configPath.length === 0
        ? {}
        : { config: this.configPath }),
    });
    this.emit("adapter.scope.ask", { bytes: SCOPE_ASK_BYTES, recorded: marked !== null });
    return SCOPE_ASK;
  }

  /**
   * A NIGHT THAT WAS NOT OFFERED, written down where tomorrow can read it.
   *
   * A deferral claims nothing — that is what makes it a deferral — so before
   * this it left only a ring event, which dies with the hook process. That is
   * I32's shape on the newest mechanism in the tree: refused every morning,
   * with nothing durable behind it (S2 review, MINOR-5). The row is `skipped`,
   * which `pageWriterDue` is explicit about never treating as a claim, and it
   * is deduped to ONE per date per reason so a ceiling that is too small every
   * session leaves one line rather than forty.
   */
  private noteWriterDeferred(about: string, reason: string): void {
    try {
      this.counterpart.recordPageWriterRun({
        about,
        mode: "session",
        outcome: "skipped",
        detail: reason,
        dedupKey: `${SELF_PAGE_WRITER_EVENT}:deferred:${about}:${reason}`,
      });
    } catch {
      /* a deferral that cannot be recorded is still a deferral (§5 G7) */
    }
  }

  /**
   * HOW MANY MORNINGS THE FIRST-LAUNCH QUESTION HAS TAKEN THE FIELD.
   *
   * The scope question wins the ask field, and on a blank store it is exactly
   * what is pending on nights 1–3 — so the writer was starved for as long as
   * nobody answered it, which on a store where nobody ever answers is forever
   * (S2 review, MINOR-5). After `SCOPE_PATIENCE_DEFERRALS` deferrals the writer
   * goes first instead: the scope question is advisory and comes back next
   * session, while a night that passes is a day missing from the page for good.
   */
  private writerStarvedByScope(): boolean {
    try {
      const runs = this.counterpart.pageWriterRuns({ limit: 64 });
      // ONCE THE WRITER HAS BEEN ASKED, IT IS NOT STARVED, and the field goes
      // back to the first-launch question. Without this the priority flipped
      // permanently: the writer took both of the night's two asks and the scope
      // question — which is the thing a person actually has to answer — stopped
      // being raised at all.
      if (runs.some((r) => r.outcome === "asked")) return false;
      const deferred = runs.filter(
        (r) => r.outcome === "skipped" && r.detail === "scope-question",
      );
      return deferred.length >= SCOPE_PATIENCE_DEFERRALS;
    } catch {
      return false;
    }
  }

  /**
   * THE NIGHTLY PAGE WRITER'S ASK, in `session` mode — build it, check it fits,
   * claim the day, and hand it back. Returns the block, or the empty string.
   *
   * `standDownOnly` is for the pass where the first-launch question took the
   * field: the verdict is still computed and the deferral still leaves a ring
   * event, so "why was I not asked" is answerable, but nothing is claimed and
   * nothing is recorded — a day that was never offered must stay owed.
   *
   * **The whole body is fail-open.** A writer that cannot be composed costs the
   * ASK and never the wake (§1 G7): every throw below lands in the catch, the
   * session gets its bundle, and the ring says which step gave up.
   */
  private deliverPageWriterAsk(
    input: HookInput,
    wakeBytes: number,
    budget: number | undefined,
    standDownOnly: boolean,
  ): string {
    try {
      const mode = pageWriterMode(this.config);
      // SESSION MODE ONLY. In `host` mode the night is run by a windowless
      // child the worker starts — and that child's own SessionStart hook runs
      // this same code, so without this line the writer would be asked to
      // write inside the session that was started to do the writing.
      if (mode !== "session") return "";
      const due = this.counterpart.pageWriterDue({ mode });
      if (!due.due) {
        // `already-claimed` and `no-previous-day` are the ordinary answers on
        // most mornings; emitting a line for each of them at every session
        // start is how a ring becomes unreadable. Only the two that mean
        // something stood the mechanism down get one.
        if (due.reason === "off" || due.reason === "asks-spent") {
          this.emit("adapter.page.writer.skipped", { reason: due.reason, about: due.about });
        }
        return "";
      }
      if (input.sessionId.length === 0) return "";
      // ALREADY ASKED, IN THIS SESSION. `noteSession("start")` has already run
      // by the time this is called and it rewrites the record whole — but it
      // CARRIES `pageWriterFor` forward, the way it carries `config`, so the
      // mark a previous SessionStart in this same session left is still here.
      // A compaction re-firing SessionStart must not re-ask.
      const record = readSession(this.counterpart.store.dir, input.sessionId);
      if (record?.pageWriterFor === due.about) return "";
      if (standDownOnly) {
        this.emit("adapter.page.writer.deferred", { reason: "scope-question", about: due.about });
        this.noteWriterDeferred(due.about, "scope-question");
        return "";
      }
      const framing = { tool: PAGE_WRITER_TOOL, session: input.sessionId };
      // SIZE THE DAY TO THE ROOM THE WAKE LEFT, rather than composing what the
      // tunable allows and then discovering it does not fit.
      //
      // The wake already carries the page — which is why the block does not
      // repeat it (`self/writer.ts`) — and what is left over varies with the
      // day: on a busy one the memories alone are 8 KB against a ceiling a real
      // wake has already spent most of. Composing the whole tunable and
      // deferring on the total would defer EVERY morning once a store is a few
      // days old, and the only trace would be a ring event that dies with this
      // process, which is I32's shape exactly.
      //
      // So the empty block is measured first — it is the same function with no
      // memories in it, so the two cannot drift — and the day gets whatever is
      // left. A day that could not all fit is delivered SHORT, with `dropped`
      // counted on the run's row; only a block whose own furniture will not fit
      // is deferred.
      //
      // **MEASURED AFTER COMPOSING, not predicted before it** (S2 review,
      // MINOR-1). The estimate was the empty block, which takes the "nothing was
      // written down" branch; the delivered one takes a longer header, a framing
      // line and `3 + len` per bullet against a budget charged at 16 + len. The
      // difference put the composition up to 20 bytes over the host's reported
      // ceiling. So the estimate only SIZES the day, and the real bytes are
      // checked afterwards — one extra composition on a path that already
      // composes twice, and the ceiling becomes a fact instead of an argument.
      const empty = this.counterpart.pageWriterInput({ about: due.about, budgetBytes: 0 });
      const overhead = writerInstructionOverhead(empty, framing) + ASK_SEPARATOR_BYTES;
      const roomFor = (spent: number): number =>
        budget === undefined
          ? SELF_TUNABLES.PAGE_WRITER_MEMORY_BYTES
          : Math.min(SELF_TUNABLES.PAGE_WRITER_MEMORY_BYTES, budget - wakeBytes - spent);
      const defer = (need: number): string => {
        // DEFERRED, never truncated and never smuggled past the ceiling — the
        // same rule the scope question follows. The day is left unclaimed, so
        // the next session in any directory is offered it instead.
        this.emit("adapter.page.writer.deferred", {
          reason: "no-room",
          about: due.about,
          wakeBytes,
          budget: budget ?? 0,
          need,
        });
        this.noteWriterDeferred(due.about, "no-room");
        return "";
      };
      if (roomFor(overhead) < 0) return defer(overhead);
      let built = this.counterpart.pageWriterInput({
        about: due.about,
        budgetBytes: roomFor(overhead),
      });
      let text = writerInstruction(built, framing);
      let bytes = Buffer.byteLength(`\n\n${text}`, "utf8");
      if (budget !== undefined && wakeBytes + bytes > budget) {
        // One re-composition, against the room the FIRST attempt proved was
        // really left. It cannot loop: the second budget is smaller than what
        // the first composition actually spent on memories, so the second block
        // is strictly shorter.
        const over = wakeBytes + bytes - budget;
        const second = roomFor(overhead + over);
        if (second < 0) return defer(bytes);
        built = this.counterpart.pageWriterInput({ about: due.about, budgetBytes: second });
        text = writerInstruction(built, framing);
        bytes = Buffer.byteLength(`\n\n${text}`, "utf8");
        // Still over after the retry — only reachable when the block's own
        // furniture is the thing that does not fit — and then it is deferred
        // rather than delivered over the ceiling.
        if (wakeBytes + bytes > budget) return defer(bytes);
      }
      // A BLOCK THAT CAN CARRY NONE OF THE DAY IS NOT WORTH A NIGHT'S CLAIM
      // (S2 review, MAJOR-1, the other half). The text is honest about it now —
      // it says "I could not see the day" rather than "the day was empty" — but
      // spending one of two asks on a block whose only content is that sentence
      // is worse than leaving the night owed for a session with more room.
      if (built.memories.length === 0 && built.dropped > 0) return defer(bytes);
      // THE CLAIM, and it is durable rather than a flag on this session: two
      // boundaries, or two machines' worth of hooks against one store, must not
      // both set a night going. It is written BEFORE the text is handed over,
      // so a crash between the two costs one day's revision rather than an
      // unbounded re-ask (the same order `openChapter` commits in).
      const claimed = this.counterpart.recordPageWriterRun({
        about: due.about,
        mode: "session",
        outcome: "asked",
        detail:
          `attempt ${String(due.attempt)}` +
          (built.dropped > 0 ? `; ${String(built.dropped)} of the day did not fit the wake's ceiling` : ""),
        bytesBefore: built.page?.bytes ?? 0,
        considered: built.memories.length,
        omitted: built.omitted,
      });
      const marked = recordSession(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        scope: input.scope,
        phase: "start",
        at: this.nowFn(),
        pageWriterFor: due.about,
        ...(this.configPath === undefined || this.configPath.length === 0
          ? {}
          : { config: this.configPath }),
      });
      this.emit("adapter.page.writer.ask", {
        about: due.about,
        attempt: due.attempt,
        bytes,
        considered: built.memories.length,
        dropped: built.dropped,
        omitted: built.omitted,
        claimed,
        recorded: marked !== null,
      });
      return text;
    } catch (err) {
      this.emit("adapter.page.writer.failed", {
        code: err instanceof Error ? err.name : "UNKNOWN",
      });
      return "";
    }
  }

  /**
   * THE NEXT-SESSION WRITE-UP'S POINTER (C2) — find the session in this project
   * that ended owing a write-up and was pointed at least recently (oldest first
   * among equals), and point this session at it. Returns the block, or the empty
   * string.
   *
   * `spent` is the bytes the wake and any other ask already take, separators
   * included. **The whole body is fail-open**: a pointer that cannot be
   * composed costs the pointer and never the wake (§1 G7).
   *
   * The marks come before the words, the page writer's order: the progress
   * entry (so the rotation moves on even if nobody fetches), then this
   * session's `writeUpPointer` — the door's evidence that this session may
   * fetch that session's words — then the day's count and the durable outcome.
   * A mark that will not land hands nothing over.
   */
  private deliverWriteUpAsk(input: HookInput, spent: number): string {
    try {
      // Never under observer: an instrument asks nobody to write into a store
      // it may not write, and has no registry mark to remember that it did.
      if (this.observer) return "";
      if (input.sessionId.length === 0) return "";
      const store = this.counterpart.store;
      const dir = store.dir;
      // ONE PER SESSION. A compaction re-fires SessionStart, and the record
      // carries the mark forward (`sessions.ts#recordSession`).
      const record = readSession(dir, input.sessionId);
      if (record?.writeUpPointer !== undefined) return "";
      // THE DAY'S ALLOWANCE, before anything is read — a spent day costs two
      // meta reads and nothing else.
      const today = this.counterpart.self.calendarToday();
      const spentToday =
        store.getMeta(WRITE_UP_ASK_DATE_KEY) === today ? Number(store.getMeta(WRITE_UP_ASK_COUNT_KEY) ?? "0") : 0;
      if (spentToday >= TUNABLES.WRITE_UP_ASKS_PER_DAY) {
        this.emit("adapter.writeup.skipped", { reason: "asks-spent", today: spentToday });
        return "";
      }
      const now = this.nowFn();
      const t = this.counterpart.self.tunables;
      const plan = writeUpPlan({
        store,
        spans: this.counterpart.spans,
        firstAsk: { turns: t.FIRST_ASK_TURNS, textBytes: t.FIRST_ASK_TEXT_BYTES },
      });
      // Entries whose session stopped owing some other way go first.
      pruneWriteUpProgress(store, plan);
      const inFlight = readWriteUpProgress(store);
      const owed = owedWriteUps(plan, dir, input.scope, now, {
        exclude: input.sessionId,
        progress: inFlight,
      });
      const first = owed[0];
      if (first === undefined) return "";
      const { held, here } = first;
      // THIS PROJECT'S WORDS ONLY (MAJOR 6).
      const entries = writeUpEntries(this.counterpart.spans, { session: held.session, scopes: [here] });
      if (entries.length === 0) return "";
      const key = progressKey(held.session, here);
      const progress = inFlight[key];
      const chunk = progress?.chunk ?? WRITE_UP_PART_BYTES;
      // ONCE THE LAST PART HAS COME BACK (`answer` set, the mark still to
      // land), the count is frozen: the words now read as kept, their marks
      // lengthen the text, and a recount could find a part that was never
      // served (re-review, m-B). The fetch finishes the mark.
      const finished = progress !== undefined && progress.answer !== undefined;
      const cut = finished ? [] : writeUpParts(entries, chunk);
      if (!finished && cut.length === 0) return "";
      const partsCount = finished ? progress.parts : cut.length;
      const done = finished ? progress.parts : Math.min(progress?.done ?? 0, partsCount);
      const text = writeUpPointer({
        waiting: owed.length,
        ended: held.session,
        endedOn: calendarDate(held.clockFrom),
        bytes: cut.slice(done).reduce((n, p) => n + Buffer.byteLength(p, "utf8"), 0),
        part: Math.min(done + 1, partsCount),
        of: partsCount,
        live: input.sessionId,
      });
      const bytes = Buffer.byteLength(`\n\n${text}`, "utf8");
      const room = TUNABLES.WRITE_UP_HOST_OUTPUT_CHARS - spent;
      const outcome = (o: "pointed" | "deferred", reason?: string): void => {
        saveWriteUpPointer(store, {
          at: now,
          date: today,
          outcome: o,
          ...(reason === undefined ? {} : { reason }),
          need: bytes,
          room,
        });
      };
      if (bytes > room) {
        // DEFERRED, never truncated: nothing is claimed, so the next start in
        // this project is pointed instead — and the deferral is DURABLE, so
        // doctor can say the wake is too full and by how much.
        this.emit("adapter.writeup.deferred", { reason: "host-cap", need: bytes, room });
        outcome("deferred", "host-cap");
        return "";
      }
      const saved = saveWriteUpProgress(store, key, {
        ...(progress ?? {}),
        chunk,
        parts: partsCount,
        done,
        handedAt: now,
      });
      const marked =
        saved &&
        recordSession(dir, {
          sessionId: input.sessionId,
          scope: input.scope,
          phase: "start",
          at: now,
          writeUpPointer: held.session,
          ...(this.configPath === undefined || this.configPath.length === 0 ? {} : { config: this.configPath }),
        }) !== null;
      if (!marked) {
        this.emit("adapter.writeup.deferred", { reason: "mark-unwritten", need: bytes, room });
        outcome("deferred", "mark-unwritten");
        return "";
      }
      try {
        if (store.getMeta(WRITE_UP_ASK_DATE_KEY) !== today) store.setMeta(WRITE_UP_ASK_DATE_KEY, today);
        store.setMeta(WRITE_UP_ASK_COUNT_KEY, String(spentToday + 1));
      } catch {
        /* a lost count is never a lost hook (§5 G2) */
      }
      outcome("pointed");
      this.emit("adapter.writeup.ask", {
        ended: held.session,
        part: Math.min(done + 1, partsCount),
        of: partsCount,
        bytes,
        owed: owed.length,
      });
      return text;
    } catch (err) {
      this.emit("adapter.writeup.failed", { code: codeOf(err) });
      return "";
    }
  }

  // ── the turn ───────────────────────────────────────────────────────────────

  /**
   * Recall for this turn. The check that the SESSION'S WAKE ARRIVED runs first,
   * once per session (scar §2.3), then the composed recall — all three borrowed
   * channels bound by the composition root, with today's date so the temporal
   * channel exists.
   */
  userPromptSubmit(input: HookInput): HookResult {
    return this.guard("user-prompt-submit", input, (out) => {
      // The stand-down precedes the delivery check for the same reason it
      // precedes the recall: a muted session rendered nothing, so there is no
      // expectation to test and a "not delivered" record would be a lie.
      if (!this.deliveryVerdict("user-prompt-submit", input)) {
        return { ...out, ok: true, reason: "primacy-standdown" };
      }
      this.checkWakeArrival(input);
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
      // The recall block states its own sentinel too, and nothing checks it: the
      // line that used to hold it was the same dead `Map` the wake's expectation
      // lived in. A recall-arrival check would need the same shape as the wake's
      // — a persisted expectation and a turn-scoped read — and is an open ask
      // (INTERFACE-GAPS §11), not a thing this row can pretend to.
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

  /**
   * "COUNTERPARTS WAS UPDATED" — the line this session's terminal gets, once,
   * when the MCP server it is talking to runs an older build than the one
   * installed (roadmap E, owner decisions 2026-09-23).
   *
   * Asked at `user-prompt-submit`, after the turn, the way `notice()` is asked
   * at `session-start` (`bin/hook.ts`): this process runs the INSTALLED build
   * every turn, so it is the one that knows what current is. It decides and
   * writes nothing (`sessions.ts#decideUpdateNotice`); `markUpdateNotice` is
   * the other half, called only once the line is actually on its way out. An
   * observer marks nothing, so it is never told.
   *
   * Never throws and never costs the turn: any failure is null.
   */
  updateNotice(input: HookInput): string | null {
    if (this.observer || input.sessionId.length === 0) return null;
    try {
      const decision = decideUpdateNotice(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        installed: installedBuild(),
      });
      // Ring rows only when there is something to say; `bin/hook.ts` copies
      // them to stderr, because this process lives for one hook.
      if (decision.reason === "due" || decision.reason === "failed") {
        this.emit("adapter.update.notice", {
          reason: decision.reason,
          matchedBy: decision.matchedBy,
          servers: decision.servers,
          hookPpid: decision.hookPpid,
        });
      }
      return decision.message;
    } catch {
      return null;
    }
  }

  /**
   * Record that the update notice went out — FIRST, before the line is
   * printed, and the line is printed only if this says true. So it is shown
   * once per session, and a mark that will not write is silence rather than
   * the same line every turn. One ring row either way.
   */
  markUpdateNotice(input: HookInput): boolean {
    if (this.observer || input.sessionId.length === 0) return false;
    const marked = markUpdateNoticeShown(this.counterpart.store.dir, input.sessionId);
    this.emit("adapter.update.notice", { reason: marked ? "shown" : "mark-failed" });
    return marked;
  }

  /**
   * SessionStart's stamp on a session that OPENS (`bin/hook.ts` decides which
   * sources do): the installed build and this hook's parent pid
   * (`sessions.ts#SessionRecord.opened`). A session without one opened before
   * any build stamped it, which is what lets the notice speak about a server
   * that records nothing about itself. Merged into the record `sessionStart`
   * just wrote; an observer writes nothing. Never throws.
   */
  stampOpened(input: HookInput): boolean {
    if (this.observer || input.sessionId.length === 0) return false;
    return stampSessionOpened(this.counterpart.store.dir, input.sessionId, {
      build: installedBuild(),
      hookPpid: process.ppid,
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
    // THE STRETCH THIS MEMORY WAS TOLD NOT TO HAVE, sealed before anything is
    // captured. After a `sealed` the ordinary capture below reads NOTHING_NEW;
    // after a `failed` it does not run at all, because a cursor that would not
    // move is a boundary with no way to tell what is new from what was lived
    // outside this memory — and an append lands before a cursor write does.
    const seal = this.sealJoinedLate(hook, input, turns);
    // G10/G11 computed side by side: capture takes EVERYTHING conversational
    // including host-injected context; pacing counts only what the user said.
    const captured: CaptureResult =
      seal === "failed"
        ? {
            captured: false,
            reason: "IO_FAILED",
            spans: [],
            deduped: 0,
            excluded: turns.length,
            cursorBefore: 0,
            cursorAfter: 0,
          }
        : this.counterpart.captureSpans({
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
      // The DURABLE half of `adapter.scope.joined-late`: the boundary row is
      // the one durable name a boundary already has, and this is a fact about
      // THIS boundary. A row that says `joinedLate: true, captured: false` is
      // the whole evidence that a stretch was sealed rather than lost.
      joinedLate: seal !== "none",
    });
    return { ...out, ok: true, reason: captured.reason, spansAppended: captured.spans.length };
  }

  /**
   * THE RETROACTIVE-CAPTURE GUARD (PR #92 review, F1) — the one place a
   * directory that was `off` can still lose its silence.
   *
   * A session that lived under `off` or `paused` wrote NOTHING: no session
   * record, because the hook process returned before a store was opened, and no
   * span cursor for the same reason. Turn the directory back on mid-session —
   * `counterparts scope . --resume`, or the `scope` tool, which is deliberately
   * the one tool that answers in an off directory — and the next boundary sees
   * a cursor of 0 against a transcript holding the WHOLE off conversation. It
   * would deposit all of it. Measured on this branch before this guard: six
   * marker hits in the buffer after the flip.
   *
   * So a boundary that finds NO SESSION RECORD and a cursor still at 0 treats
   * the stretch as somebody else's: it advances the cursor to the end of what
   * it can see, deposits nothing, and records that it did. What follows the
   * flip is captured normally, because the cursor now starts there.
   *
   * **How the cursor moves without a deposit.** `SpanBuffer.capture` advances
   * to `turns.length` when nothing in the slice is capture-eligible
   * (`remember/spans.ts`, the ALL_EXCLUDED arm: "still advance, or the same
   * tool output is re-scanned forever"). So the seal hands it `turns.length`
   * PLACEHOLDERS whose source is `tool` — `enters()` refuses them — and the
   * real turns are never passed to the core at all. That is the only
   * adapter-reachable way to set a cursor today; a `SpanBuffer.sealCursor` in
   * core would be the honest one, and is named in the PR as a core ask.
   *
   * Three conditions, each load-bearing:
   *   - **not an observer**: an observer captures nothing and writes no session
   *     record anyway, and a cursor it cannot write would make the seal a lie.
   *     An `off → observer → on` session is therefore still sealed at the first
   *     boundary after it reaches `on` — the observer stretch left no record.
   *   - **no session record**: the positive evidence that SessionStart ran
   *     inside this memory. It is what a live session has and an off one does not.
   *   - **cursor still 0**: a record PRUNED out from under a long-lived session
   *     (seven days, `sessions.ts`) leaves a cursor behind; that session has
   *     been captured all along and must not lose the turns since its last
   *     boundary.
   */
  private sealJoinedLate(
    hook: SessionEndingHook,
    input: HookInput,
    turns: readonly HostTurn[],
  ): "none" | "sealed" | "failed" {
    if (this.observer) return "none";
    if (input.sessionId.length === 0) return "none";
    try {
      if (readSession(this.counterpart.store.dir, input.sessionId) !== null) return "none";
      if (this.counterpart.spans.cursor(input.scope, input.sessionId) !== 0) return "none";
    } catch {
      // A registry or a cursor this cannot read is not a reason to fail a hook
      // (§5 G2). The quiet answer here is the ordinary path.
      return "none";
    }
    const placeholders: CapturedTurn[] = turns.map(() => ({
      role: "user",
      text: "",
      source: "tool",
    }));
    const sealed = this.counterpart.captureSpans({
      session: input.sessionId,
      scope: input.scope,
      turns: placeholders,
    });
    const moved = sealed.cursorAfter === turns.length;
    this.emit(SCOPE_JOINED_LATE_EVENT, {
      hook,
      mode: this.scope.mode,
      turns: turns.length,
      cursor: sealed.cursorAfter,
      sealed: moved,
      reason: sealed.reason,
    });
    // THE ORDER IS THE SAFETY. The cursor moves first and the session record is
    // written only if it did: a record written beside a cursor that stayed at 0
    // would make the NEXT boundary read this session as an ordinary one and
    // deposit the whole off stretch after all. A seal that could not move the
    // cursor leaves no record either, so the next boundary tries again.
    if (!moved) return "failed";
    // The session becomes bindable HERE, at the first boundary inside the
    // memory — `pre-compact` never calls `noteSession`, and a session with no
    // record is a session the MCP tools refuse.
    this.noteSession("boundary", input);
    return "sealed";
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
    const raw = (input.expansions ?? [])
      .filter((e) => e.atTurn > from && e.atTurn <= to)
      .flatMap((e) => [...e.ids]);
    // G50: a handle the recall tool RESOLVED becomes the id it resolved to.
    // The transcript still decides WHICH handles and WHEN; what it cannot say is
    // whose answer resolved them, so the translation is filtered to THIS
    // PROJECT's resolutions — the same `sameScope` comparison the MCP server
    // already trusts to bind a session. Without it the log hands this boundary
    // the last answer anyone anywhere got, including the owner's resolution of a
    // confidential memory this session was refused (or never asked for at all).
    // A handle nobody resolved in this scope still counts `unresolvedHandles`.
    //
    // The SECOND filter is this session's own start, out of the same registry
    // (`sessions.ts`): a project is a place, not a conversation, so one
    // directory's table also holds last week's answers, and a resolution
    // recorded before this session existed cannot be an answer to anything this
    // session asked. A session whose first hook event is this very Stop has no
    // record yet — `claim()` runs before `noteSession("boundary")` — and gets no
    // floor; that is under-credit's direction only in the sense that it does not
    // tighten, and it is the residual §9 records.
    //
    // The file is read only when there is something to translate — and the row
    // says which of those two it was. `resolvedHandles: 0` alone cannot tell an
    // idle table from a dead one, which is the exact shape of I32's failure.
    //
    // ALL OF IT INSIDE THE TRY. The first draft translated before the try, which
    // meant any throw on this path cost the boundary its row entirely — and a
    // seam that only writes rows when it works is the ring I32 is named for.
    // Only the `expansionsRead` declaration, which cannot throw, sits outside,
    // so the `failed` row can still say how far the read had got.
    let expansionsRead: ExpansionsRead | "not-read" = "not-read";
    try {
      let resolutions = new Map<string, string | null>();
      // Carried off the read rather than fetched again: the key a handle lands
      // on is the store's salt plus the handle (G58), and the two halves of one
      // lookup must not be able to disagree about which salt that was.
      let salt = "";
      if (raw.length > 0) {
        const dataDir = this.counterpart.store.dir;
        const sessionStartedAt = readSession(dataDir, input.sessionId)?.startedAt;
        const read = readHandleResolutions(dataDir, {
          now: this.nowFn(),
          scope: input.scope,
          ...(sessionStartedAt === undefined ? {} : { since: sessionStartedAt }),
        });
        resolutions = read.map;
        salt = read.salt;
        expansionsRead = read.reason;
      }
      const resolvedHandles = countTranslated(raw, resolutions, salt);
      const expansions = translateExpansions(raw, resolutions, salt);
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
        /** G50: expansions the handle-resolution log translated on the way in.
         *  Beside `unresolvedHandles`, it is the pair that says whether a
         *  by-title expansion earned credit or fell through the old gap. */
        resolvedHandles,
        /** WHY the log answered the way it did. `resolvedHandles: 0` on its own
         *  cannot tell an idle table from an absent, unreadable or corrupt one,
         *  and a number that cannot say which is how I32 stayed invisible.
         *  `not-read` means this slice carried no expansion to translate. */
        expansionsRead,
        skippedForBudget: summary.skippedForBudget,
        unreadable: summary.unreadable,
        refused: summary.refused,
        ids: summary.ids.slice(0, 64),
        idsTotal: summary.ids.length,
        expandedIds: summary.expandedIds.slice(0, 64),
        expandedTotal: summary.expandedIds.length,
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
        // The RAW count: the translated list may not exist on this path, and a
        // translation is one-for-one anyway.
        expansions: raw.length,
        expansionsRead,
      });
    }
  }

  private askAtStop(input: HookInput): string | null {
    try {
      // The host's re-fire of a blocked Stop. Nothing is evaluated: no pacing
      // advance, no ask slot, no row — the previous pass already left one.
      if (input.reFired === true) return null;
      // Typed turns and both roles' text (`substanceOf`). The pacing and the
      // per-session, per-calendar-day cap are `self/episodes.ts#askDue`'s; the
      // history of both is in self NOTES. The date on every `adapter.ask` row
      // below answers "how often was the pen offered today" across sessions.
      const substance = substanceOf(input.turns ?? []);
      const chapter = this.counterpart.episodeAsk(input.sessionId, substance, undefined, {
        rebase: input.turnsUnread !== true,
      });
      const outcome = chapter.asked
        ? "asked"
        : chapter.verdict.reason === "session-ask-cap"
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

  /**
   * WRITE DOWN WHAT THE HOST WAS JUST HANDED, so a later process can ask whether
   * it arrived. A second write of the same phase, for the same reason
   * `deliverScopeAsk` makes one: the first write happens before the delivery
   * verdict and the bundle is composed after it.
   *
   * A wake with NO sentinel — the bootstrap line a store with nothing in it
   * publishes — writes nothing, and the absence is the answer: there was no
   * checkable bundle, so nothing was supposed to arrive.
   */
  private noteWakeExpectation(input: HookInput, sentinel: string | null): void {
    if (this.observer) return;
    if (input.sessionId.length === 0) return;
    if (sentinel === null || sentinel.length === 0) return;
    const marked = recordSession(this.counterpart.store.dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase: "start",
      at: this.nowFn(),
      wakeSentinel: sentinel,
      ...(this.configPath === undefined || this.configPath.length === 0
        ? {}
        : { config: this.configPath }),
    });
    this.emit("adapter.wake.expected", { recorded: marked !== null });
  }

  /**
   * DID THE WAKE THIS SESSION COMPOSED REACH THE SESSION? — once, at the first
   * prompt, and never again for this session.
   *
   * **Why here and not at the end.** Nothing inside the SessionStart hook can
   * know what the host did with its return value, and SessionEnd's hooks share
   * 1.5 s between them. The first `UserPromptSubmit` is the earliest moment the
   * host has written the record of its own injection, and it is once per session
   * rather than once per turn.
   *
   * **What it reads.** The head of the host's transcript, bounded
   * (`transcript.ts#readWakeArrival`): this package's SessionStart attachment
   * carries what the hook printed beside what the host says it injected, and the
   * wake's two sentinels stand inside both. The comparison is against
   * `wakeSentinel` from the session record — the expectation a fresh process
   * cannot otherwise have.
   *
   * **What it records.** One `adapter.wake.delivered` row: ids, numbers, flags
   * and an outcome. Never a byte of the bundle.
   *
   * **What it cannot do.** Fail the hook (§5 G2) or cost the turn its recall. A
   * session with no registry record is left entirely alone — it is either an
   * observer, a session older than this code, or the off→on flip the
   * retroactive-capture guard reads that same absence to detect, and a record
   * written from here would take that evidence away.
   */
  private checkWakeArrival(input: HookInput): void {
    if (this.observer) return;
    if (input.sessionId.length === 0) return;
    const started = this.nowFn();
    let record: SessionRecord | null;
    try {
      record = readSession(this.counterpart.store.dir, input.sessionId);
    } catch {
      return;
    }
    if (record === null || record.wakeChecked === true) return;
    const expected = record.wakeSentinel ?? null;
    try {
      // Nothing was supposed to arrive: no expectation, no read. A cold start's
      // bootstrap line and a SessionStart that stood down both land here, and
      // the row says so rather than reporting a wake that was never composed.
      const arrival =
        expected === null ? NO_ARRIVAL : readWakeArrival(input.transcriptPath, { expect: expected });
      const outcome = wakeOutcome(expected, arrival);
      this.record(WAKE_DELIVERED_EVENT, input, {
        outcome,
        // `ok` and `delivered` say the same thing under the two names this row's
        // readers already look for.
        ok: outcome === "delivered",
        delivered: outcome === "delivered",
        expected: expected !== null,
        found: arrival.found,
        transcript: arrival.reason,
        // The two sentinels in what the HOST SAYS IT INJECTED, and in what the
        // hook PRINTED. A tail present in one and not the other is the shape
        // scar §2.3 is about: the render was whole and the delivery was not.
        headInContent: arrival.head.present,
        tailInContent: arrival.tail.present,
        headInStdout: arrival.headPrinted.present,
        tailInStdout: arrival.tailPrinted.present,
        // Whether the host recorded an injected `content` at all — the
        // difference between "it arrived empty" and "this build does not say".
        contentRecorded: arrival.contentRecorded,
        // What each sentinel DECLARED, against what actually arrived.
        headBytes: arrival.head.bytes,
        headElements: arrival.head.elements,
        tailBytes: arrival.tail.bytes,
        tailElements: arrival.tail.elements,
        contentBytes: arrival.contentBytes,
        stdoutBytes: arrival.stdoutBytes,
        linesRead: arrival.linesRead,
        bytesRead: arrival.bytesRead,
        corrupt: arrival.corrupt,
        elapsedMs: this.nowFn() - started,
      });
      // THE VERDICT CROSSES THE SEAM, NOT THE TEXT. `noteDelivered` asks two
      // questions of its argument — was a sentinel seen, and was it the
      // expectation — and both are already answered here. Handing it the
      // matched line would carry a string cut out of the wake bundle (memory
      // text, if a body opened a sentinel it never closed) into a core module;
      // `""` is "seen, and not the one we printed".
      this.counterpart.noteWakeDelivered(
        arrival.tail.present ? (arrival.tail.matchesExpected ? expected : "") : null,
        expected,
      );
    } catch (err) {
      this.emit("adapter.wake.check.failed", {
        code: codeOf(err),
        elapsedMs: this.nowFn() - started,
      });
    }
    // AFTER the row, never before: a flag written first and a row that then
    // failed would close the question for this session with nothing recorded,
    // which is I32's shape. This order can duplicate a row if the flag write
    // fails — the cheaper of the two.
    this.markWakeChecked(input, record);
  }

  /**
   * Close the question for this session. `boundary` creates a record when one is
   * missing, so this is only ever called with a record already read — and it is
   * written at the clock the record already carried, because a prompt is not a
   * boundary and the lazy bind's liveness window is measured from those.
   */
  private markWakeChecked(input: HookInput, prior: SessionRecord): void {
    try {
      recordSession(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        scope: input.scope,
        phase: "boundary",
        at: prior.lastBoundaryAt,
        wakeChecked: true,
        ...(this.configPath === undefined || this.configPath.length === 0
          ? {}
          : { config: this.configPath }),
      });
    } catch {
      /* the check runs again next turn; a hook may not fail the host (§5 G2) */
    }
  }

  /** The orphanable tail: bounded and measured, never pretended away (§13). */
  private noteTail(input: HookInput): void {
    try {
      // The same session state the ask above reads, for the same reason: a tail
      // line that disagreed with the ask about why is how this bug gets found
      // twice.
      this.counterpart.noteOrphanTail(input.sessionId, substanceOf(input.turns ?? []), undefined, {
        rebase: input.turnsUnread !== true,
      });
    } catch (err) {
      this.emit("adapter.tail.failed", { code: codeOf(err) });
    }
  }

  /**
   * The detached worker. The plan is checked BEFORE anything starts — watchdog
   * against the staleness window, data dir, stance — and a refusal that repeats
   * ESCALATES rather than re-logging (scar E4's widening).
   *
   * **The credential was never a precondition after I32** (2026-09-11), and
   * since 2026-09-24 there is no credential at all; see `spawn.ts`'s §2.18
   * paragraph for why refusing was worse than running.
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
      this.noteSpawnStart(input);
      return outcome;
    }
    const count = this.bumpRefusal(String(outcome.reason));
    this.noteSpawnRefusal(outcome, count, input);
    return outcome;
  }

  /**
   * THE DURABLE ROW for a worker that DID start (2026-09-20, E2).
   *
   * I32 made every refusal durable and left the other half open: a healthy
   * start wrote nothing, so a worker dead all week and a week with nothing to
   * do read exactly alike, and the fired view could only call the mechanism
   * blind (inventory §2 row 23). Scar §2.4 is symmetrical — a door that opened
   * and a door nobody opened must not be the same absence either.
   *
   * ONE ROW PER CALENDAR DATE, latched at the store exactly like the refusals
   * beside it. This runs at every boundary, which is a hot path, and three
   * hundred identical rows a day would drown the log the view reads.
   *
   * **THE ROW CARRIES NO COUNT, on purpose.** The latch means only the FIRST
   * start of a day ever writes, so any tally put here would read `1` forever —
   * a number that looks like a measurement and is an artefact of the latch. The
   * day's real tally lives in box 2's meta beside the refusal counters, where
   * `spawnStarts()` reads it and doctor's Spawn line prints it.
   *
   * Never throws, writes nothing under observer, and is not on the critical
   * path: the worker has already been started by the time this runs.
   */
  private noteSpawnStart(input?: HookInput): void {
    if (this.observer) return;
    const date = input?.at ?? new Date(this.nowFn()).toISOString().slice(0, 10);
    try {
      this.bumpStart(date);
      this.counterpart.noteAdapterEvent(
        SPAWN_STARTED_EVENT,
        { date, session: input?.sessionId ?? null },
        { dedupKey: `${SPAWN_STARTED_EVENT}:${date}` },
      );
    } catch (err) {
      this.emit("adapter.spawn.record.failed", { code: codeOf(err) });
    }
  }

  /** How many times the worker has started TODAY, and the date that tally is
   *  for. The row says it happened; this says how often. A read, never a write. */
  spawnStarts(): { date: string | null; count: number } {
    try {
      const store = this.counterpart.store;
      const date = store.getMeta(SPAWN_START_DATE_KEY) ?? null;
      return { date, count: Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") };
    } catch {
      return { date: null, count: 0 };
    }
  }

  /**
   * The day's start tally, beside the refusal counters in box 2's meta. TWO
   * KEYS, not one per date: a key per day would grow without a sweep to mow it,
   * and the only question this answers is "how many today". The tally resets
   * the moment the date it was stamped with is no longer today.
   */
  private bumpStart(date: string): number {
    try {
      const store = this.counterpart.store;
      const on = store.getMeta(SPAWN_START_DATE_KEY);
      const next = on === date ? Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") + 1 : 1;
      if (on !== date) store.setMeta(SPAWN_START_DATE_KEY, date);
      store.setMeta(SPAWN_START_COUNT_KEY, String(next));
      return next;
    } catch {
      // A lost count is never a lost hook (§5 G2). The row still lands, and it
      // still says the worker started today, which is what it is for.
      return 1;
    }
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

  /**
   * THE ONE OR TWO LINES THE OWNER SEES AT SESSION START, or null.
   *
   * I32's closing move. #95 made the refusals durable and `doctor.ts` reads
   * them; this is the surface that puts the worst RED finding where a human
   * already looks — the terminal — instead of leaving it in a store for whoever
   * thinks to ask (adapter INTERFACE-GAPS, "Nothing SAYS the worker has not
   * run"). The owner's ruling, 2026-09-11: the warning must reach the USER's
   * terminal.
   *
   * Three properties, each load-bearing:
   *
   *   - **Red only.** Amber belongs to `counterparts doctor`, which the owner
   *     runs on purpose. A hook that spoke every time something was imperfect is
   *     a hook people learn to scroll past.
   *   - **An observer says nothing at all**, before any read: an instrument that
   *     narrated the host it is measuring would be doing more than reading.
   *   - **It cannot fail the wake** (§5 G2). Every failure — a store that will
   *     not read, a clock that throws — returns null and leaves ONE ring event,
   *     and the wake goes out on exactly the path it took yesterday.
   *
   * Bounded at `SESSION_NOTICE_BUDGET_MS` and checked between finding groups,
   * because this runs inside a foreground hook.
   */
  notice(
    input: HookInput,
    opts: { budgetMs?: number; now?: () => number; checkout?: CheckoutReading } = {},
  ): string | null {
    if (this.observer) return null;
    try {
      const today = input.at ?? new Date(this.nowFn()).toISOString().slice(0, 10);
      // WHICH CODE IS LIVE, read before anything else and RECORDED. The reading
      // is bounded and never throws (`readCheckout`); the row is the mechanized
      // half — a day on master leaves one latched row, and a day the tree
      // wandered leaves one per state it wandered into.
      const checkout = opts.checkout ?? readCheckout();
      if (!checkoutIsGraded(checkout)) {
        // git missing, slow, or no repository at all: nothing to record, and
        // only a "git would not answer" is worth a ring row.
        if (checkout.reason === "unreadable") {
          // `why` separates the two silences: a git that answered "no
          // origin/master" is a fact about the repository, and a git that ran
          // out of `CHECKOUT_BUDGET_MS` is a fact about the machine — and only
          // the second one means the grade is missing on a morning it mattered.
          this.emit("adapter.checkout.unreadable", {
            root: checkout.root,
            why: checkout.timedOut ? "timeout" : "git",
          });
        }
      } else {
        try {
          this.counterpart.noteAdapterEvent(
            CHECKOUT_EVENT,
            {
              reason: checkout.reason,
              branch: checkout.branch,
              head: checkout.head,
              dirty: checkout.dirty,
              behindBy: checkout.behindBy,
              originMaster: checkout.originMaster,
              atMaster: checkout.atMaster,
              date: today,
            },
            // THE REASON IS PART OF THE LATCH. Date, head and dirtiness alone
            // let a day's first row stand for every later one: a `git fetch` in
            // the shared tree moves origin/master, so the SAME clean head that
            // graded `master` at breakfast grades `behind` by lunchtime — and
            // the day's record would still say master. One row per state the
            // tree was actually in, which is the claim the row is for.
            {
              dedupKey: `${CHECKOUT_EVENT}:${today}:${checkout.head ?? "none"}:${checkout.dirty}:${checkout.reason}`,
            },
          );
        } catch (err) {
          this.emit("adapter.checkout.record.failed", { code: codeOf(err) });
        }
      }
      const findings = doctorFindings({
        checkout,
        configPath: this.configPath ?? "(none)",
        // `bin/hook.ts` REFUSED an absent or unreadable NAMED configuration long
        // before this line, so there is no reason left for this reading to
        // re-derive: null says "the caller already vouched for the file".
        configReason: null,
        config: this.config,
        dir: this.config.dataDir ?? "",
        store: this.counterpart.store,
        today,
        refusals: this.spawnRefusals(),
        starts: this.spawnStarts(),
        budgetMs: opts.budgetMs ?? SESSION_NOTICE_BUDGET_MS,
        ...(opts.now === undefined ? {} : { now: opts.now }),
      });
      return noticeMessage(findings);
    } catch (err) {
      // A reading that failed is not a session that failed. One ring row, so the
      // silence is distinguishable from a clean bill of health (scar §2.4).
      this.emit("adapter.doctor.failed", { code: codeOf(err) });
      return null;
    }
  }

  /**
   * RECORD THAT THE TERMINAL DID NOT GET THE WARNING, and why.
   *
   * The host caps a hook's stdout at 10,000 characters, and over that it
   * replaces the string with a preview — which makes the JSON envelope
   * unparseable and drops the wake with it. `bin/hook.ts` therefore prints the
   * PLAIN wake and throws the notice away when the envelope is too big
   * (`ENVELOPE_MAX_CHARS`), and this is how that choice stays visible instead of
   * looking like a healthy morning. Ids and counts only, like every other row.
   */
  noteNoticeDropped(chars: { noticeChars: number; envelopeChars: number; limitChars: number }): void {
    this.emit("adapter.notice.dropped", { ...chars });
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
      // THE SECOND `off` SITE. The entry point already refused before anything
      // opened, which is where the "no output, no write" guarantee actually
      // comes from; this is the same predicate at the seam a future caller
      // reaches, so a library user who constructs an adapter directly inherits
      // the rule instead of having to remember it (observer-mode G8's shape).
      // It is silent on purpose — see `bin/hook.ts` — and the ring event is
      // free here because the ring is already open.
      if (stanceOfMode(this.scope.mode) === "off") {
        this.emit("adapter.scope.off", { hook, matched: this.scope.matched });
        return { ...base, ok: true, reason: "scope-off" };
      }
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
 * Substance for PACING.
 *
 *   - **turns** — messages the PERSON typed: user-role `conversation` turns,
 *     one per transcript entry however many text blocks it holds. The
 *     assistant's text never counts as a turn, so its own writing cannot pace
 *     the ask turn by turn (measured 2026-09-24: 8 assistant blocks against the
 *     owner's 2 messages fired the first ask after his second message).
 *   - **bytes** — conversation text from BOTH roles, which is how a one-prompt
 *     agentic session still reaches an ask.
 *
 * Host-injected material is user-role but is not the user speaking, so it
 * counts toward neither (§2 G11); tool output, file contents and images are the
 * declared blind spot (§2 G10). The same turn list feeds `captureSpans`, where
 * injected context IS kept — the two rules live one function apart on purpose.
 */
export function substanceOf(turns: readonly HostTurn[]): { turns: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  let lastEntry: number | undefined;
  for (const turn of turns) {
    if ((turn.source ?? "conversation") !== "conversation") continue;
    bytes += Buffer.byteLength(turn.text, "utf8");
    if (turn.role !== "user") continue;
    if (turn.entry !== undefined && turn.entry === lastEntry) continue;
    lastEntry = turn.entry;
    count += 1;
  }
  return { turns: count, bytes };
}

/** The six answers the delivery check can give, in plain words. */
export type WakeOutcome =
  | "delivered"
  | "truncated"
  | "mismatch"
  | "printed-unverified"
  | "not-found"
  | "no-wake-expected";

/**
 * THE VERDICT, read from the TAIL SENTINEL ALONE — which is the whole point of
 * the sentinel: "verify arrival from the last line" (§1 G2, scar §2.3). The
 * head sentinel and the measured lengths ride on the row as evidence; they are
 * not inputs to this answer, because a bundle clipped in transit loses its tail
 * first and a reader that needed both would report nothing when it mattered.
 *
 * `mismatch` is the case a resumed session produces: the head of the file holds
 * the SessionStart attachment of the run that created it, so a wake arrived and
 * it is not the one this session composed. "Something else arrived" and "it was
 * cut off" are different mornings.
 *
 * `printed-unverified` is the case a HOST BUILD produces. The verdict is read
 * from `content`, a field of the host's private transcript format measured once;
 * a build that does not record it leaves nothing to read, and answering
 * `truncated` there would say v1's silent-loss bug was happening to every
 * session on that host. When the field is absent the printed side answers
 * instead — it is this package's own stdout, so an intact sentinel there says
 * the hook did its half and the host's half is simply not on the record.
 */
export function wakeOutcome(expected: string | null, arrival: WakeArrival): WakeOutcome {
  if (expected === null) return "no-wake-expected";
  if (!arrival.found) return "not-found";
  if (arrival.tail.present) return arrival.tail.matchesExpected ? "delivered" : "mismatch";
  if (!arrival.contentRecorded) {
    if (arrival.tailPrinted.matchesExpected) return "printed-unverified";
    if (arrival.tailPrinted.present) return "mismatch";
    // Neither recorded nor printed: the attachment is not a wake at all.
    if (!arrival.headPrinted.present) return "not-found";
  }
  return "truncated";
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
