/**
 * `tools/parallel/types.ts` — the instrument's shapes, and nothing else.
 *
 * ONE RULE, inherited verbatim from `tools/replay/report.ts`: everything here is
 * counts, ids, hashes, verdicts, paths and the instrument's own static prose.
 * NEVER memory body text, NEVER transcript text, NEVER a line of either
 * system's injected material (scar §2.20; CONTRACT §5 G14 "ids in state, text
 * at render"). The cross-encoding meter is the sharpest case: it carries
 * CONTENT ADDRESSES of lines, never the lines.
 */

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/** The four-value vocabulary, narrowed: a preflight row never needs a rater. */
export type CheckStatus = "pass" | "fail" | "not-exercised";

/**
 * WHICH GATE A ROW HOLDS. The CONTRACT's §5 preconditions 8 and 9 say it in
 * their own last line — "Gates the S→P flip, not day 1" — so a row that is
 * legitimately unmeasurable before Phase P must not sink Phase S's readiness.
 * Without this field `ready` is unreachable by construction, which would make
 * the preflight a document rather than a gate.
 */
export type CheckGate = "day-1" | "s-to-p";

export interface CheckRow {
  readonly id: string;
  readonly status: CheckStatus;
  /** The instrument's own prose plus numbers. Never either system's content. */
  readonly detail: string;
  readonly gates: CheckGate;
}

export type RunPhase = "0" | "S" | "P";

export interface PreflightReport {
  readonly at: string;
  readonly phase: RunPhase;
  readonly runDir: string;
  /** True when every row gating THIS phase passed. See `CheckGate`. */
  readonly ready: boolean;
  /** Ids of rows deferred to a later phase — named, never silently dropped. */
  readonly deferred: readonly string[];
  readonly checks: readonly CheckRow[];
}

// ---------------------------------------------------------------------------
// The replay gate (precondition 1)
// ---------------------------------------------------------------------------

/**
 * The owner-signed waiver the CONTRACT's precondition 1 requires before a
 * SAMPLE record may open this gate. It names the record, so a waiver signed for
 * one sample cannot travel to another (`recordId` is checked, not just present).
 */
export interface Waiver {
  readonly precondition: number;
  readonly recordId: string;
  readonly signedBy: string;
  readonly signedAt: string;
  readonly reason: string;
}

export interface GateVerdict {
  readonly open: boolean;
  /** Every refusal names its reason. An open gate has none. */
  readonly reasons: readonly string[];
}

// ---------------------------------------------------------------------------
// The daily record
// ---------------------------------------------------------------------------

/**
 * CONTRACT §5 "What counts as a day". Only `active` counts toward a minimum.
 *
 * `unreadable` is the sixth, and it is not one of the CONTRACT's diagnoses — it
 * is the absence of one. A day whose durable read errored or capped has counts
 * that are floors of unknown depth, and every other class here is a claim those
 * counts cannot support. It exists so that such a day can never be `active`
 * (review blocker 9); it is reported, never folded into a phase minimum.
 */
export type DayClass = "active" | "thin" | "contaminated" | "mixed" | "silent" | "unreadable";

/** Which system holds the microphone, as the run record spells it. */
export type Primacy = "v1" | "v2";

export interface MuteEvidence {
  /** v1's `ab.muted`, split by the hook that emitted it. */
  readonly v1AbMutedByHook: Readonly<Record<string, number>>;
  /** v2's durable `adapter.primacy.standdown`, split by hook. */
  readonly v2StanddownByHook: Readonly<Record<string, number>>;
  /** v2's durable `adapter.primacy.deliver`, split by hook. */
  readonly v2DeliverByHook: Readonly<Record<string, number>>;
}

/**
 * G4's detectors, per channel, per side. A detector that CANNOT be read from a
 * durable store is `null`, never `0`: a fabricated zero reads as evidence of
 * silence, which is the exact failure scar §2.4 names.
 */
export interface ContaminationDetectors {
  readonly wake: number | null;
  readonly recall: number | null;
  readonly ritual: number | null;
}

export interface CreatedExited {
  readonly created: number;
  /** NULL when the exit path could not be attributed to this day at all. */
  readonly exited: number | null;
  readonly byKind: Readonly<Record<string, number>>;
  readonly bySource: Readonly<Record<string, number>>;
  /** False when the tally could not be attributed to this date from the store. */
  readonly attributable: boolean;
  readonly note: string;
}

export interface CrossEncodingDirection {
  /** Distinct content addresses offered by the source side. */
  readonly probes: number;
  /** How many of them were found in the other side's store. */
  readonly hits: number;
  /** False when no probe was offered: `0/0` is UNMEASURED, never clean. */
  readonly measured: boolean;
  /** The addresses that hit — ids, never text (scar §2.20). */
  readonly hitAddresses: readonly string[];
  /** Rows excluded by construction because their mint source is `migrated`. */
  readonly excludedMigrated: number;
  /** Lines scanned on the receiving side. */
  readonly scanned: number;
  /**
   * Probe lines dropped for being shorter than the committed floor. `---` and
   * `## Notes` address identically in every store; offered as probes they hit
   * everything and mean nothing (review blocker 7a).
   */
  readonly probesRejectedShort: number;
  /** The same floor applied to the receiving corpus. */
  readonly corpusRejectedShort: number;
  /**
   * Lines whose own date could not be read, and which were therefore INCLUDED
   * rather than dropped: for a red-line, failing toward detection is right, and
   * the count is here so the number can be read knowing it.
   */
  readonly undatedScanned: number;
}

export interface CrossEncodingMeter {
  /** Which phase's rule was applied. The rules differ; §9 OQ4 sets both. */
  readonly phase: RunPhase;
  readonly bar: number;
  /** The committed probe floor this reading used (`bars.json`). */
  readonly minLineChars: number;
  /** Phase P's red-line share of v1's daily mints (`bars.json`, 0.10). */
  readonly ratioBar: number;
  readonly v1IntoV2: CrossEncodingDirection;
  readonly v2IntoV1: CrossEncodingDirection;
  readonly total: number;
  /**
   * CONTRACT §5 G7 + G10: a red-line halts the day count. Phase S: ANY hit.
   * Phase P: only above `ratioBar` of v1's mints that day (§9 OQ4, RULED
   * 2026-09-03) — v1 keeps v2's injected text by design, so a small count there
   * is the accepted cost, not a breach.
   */
  readonly redLine: boolean;
  /** Phase P, at or below the ratio: a NAMED FINDING, reported, not a halt. */
  readonly namedFinding: boolean;
  /** v1 lines carrying a verbatim v2 line ÷ v1's mints that day. Null if unread. */
  readonly ratio: number | null;
  /** v1's mints on this day — the ratio's denominator, shown with it always. */
  readonly ratioDenominator: number | null;
  /** Which rule was applied and against what. Prose, so the number is legible. */
  readonly ratioNote: string;
  /**
   * §5 G7's named blind spot, carried beside the number so it can never be read
   * without it: the exposure denominator this meter does NOT cover. NULL when
   * the primary's recall volume could not be read at all — a zero there would
   * claim the blind spot was empty.
   */
  readonly exposureDenominator: number | null;
}

export interface DailyRecord {
  readonly date: string;
  readonly phase: RunPhase;
  readonly primacy: Primacy;
  readonly class: DayClass;
  /** Every class that matched, not only the one that won. Totality over drama. */
  readonly flags: readonly DayClass[];
  readonly why: string;
  /** The active-day floor this day was judged against (bars.json). */
  readonly turnFloor: number;
  readonly turns: number;
  readonly v1: V1DayCounts;
  readonly v2: V2DayCounts;
  readonly mute: MuteEvidence;
  readonly contamination: {
    readonly v1: ContaminationDetectors;
    readonly v2: ContaminationDetectors;
  };
  readonly tally: {
    readonly v1: CreatedExited;
    readonly v2: CreatedExited;
  };
  /**
   * `remember.span.quarantined`, recomputed read-only from the line count of
   * every scope's `quarantine.jsonl` (CONTRACT §5 G2's "recomputed read-only
   * from durable state rather than stored — named as such by the instrument").
   */
  readonly quarantine: {
    readonly present: boolean;
    readonly files: number;
    readonly lines: number;
  };
  readonly crossEncoding: CrossEncodingMeter;
  /** Where the day's v1 log lines were copied (G2's evidence, off v1's clock). */
  readonly v1LogCopy: string | null;
}

// ---------------------------------------------------------------------------
// Reader outputs
// ---------------------------------------------------------------------------

export interface V1SessionOrder {
  readonly session: string;
  /**
   * FILE ORDINAL of the first delivery event in this session, or null — never
   * v1's own `seq`, which restarts in every hook process (review blocker 4).
   */
  readonly firstDelivery: number | null;
  /** File ordinal of the last `ab.muted` in this session, or null. */
  readonly lastMuted: number | null;
  /** The ISO stamps the ordering actually used, so the verdict is auditable. */
  readonly firstDeliveryAt: string | null;
  readonly lastMutedAt: string | null;
  /** A delivery followed LATER by a mute: the flip straddled this session. */
  readonly straddled: boolean;
}

export interface V1DayCounts {
  readonly present: boolean;
  readonly path: string;
  readonly lines: number;
  /** Lines that were not JSON, or carried no `type`. Counted, never swallowed. */
  readonly malformed: number;
  readonly byType: Readonly<Record<string, number>>;
  readonly abMutedByHook: Readonly<Record<string, number>>;
  readonly wakeRendered: number;
  readonly wakeDelivered: number;
  /** `surface.decision` with `phase === "inject"` — v1's recall injection. */
  readonly surfaceInject: number;
  readonly episodeAsked: number;
  readonly sessionStart: number;
  readonly sessionEnd: number;
  readonly turns: number;
  readonly sessions: readonly V1SessionOrder[];
  /** Sessions muted at session start — the `silent` class's left half. */
  readonly mutedAtSessionStart: readonly string[];
}

export interface V2DayCounts {
  readonly present: boolean;
  readonly path: string;
  /**
   * sqlite refused a write through the very handle this reader used. NULL when
   * no store was opened at all — an unopened store proves nothing, and `true`
   * there was a fabricated guarantee. It is never `false`: a handle that
   * accepts a write makes the reader THROW rather than report (readers.ts).
   */
  readonly readOnlyProof: boolean | null;
  readonly livedDayNow: number | null;
  readonly lastActiveDate: string | null;
  /** True when the event read hit its row cap: the counts below are a FLOOR,
   *  not a total. A counter that quietly caps is the scar §2.4 failure. */
  readonly truncated: boolean;
  readonly eventRowsRead: number;
  /**
   * Reads that FAILED — the SQL and sqlite's message, never a row. A day with
   * any of these cannot be classified: `record.ts` poisons its detectors to
   * null and refuses `active` (scar §2.4 — a swallowed error is a zero).
   */
  readonly readErrors: readonly string[];
  /** Durable rows whose PAYLOAD carries `date === <date>` (the adapter events). */
  readonly byNameForDate: Readonly<Record<string, number>>;
  readonly primacyByHook: {
    readonly deliver: Readonly<Record<string, number>>;
    readonly standdown: Readonly<Record<string, number>>;
  };
  /**
   * The same rows keyed by the HOST session id every adapter record carries in
   * its payload, then by what happened (`deliver:<hook>`, or the event name).
   * The `silent` class's right half, and the reason it is a join rather than a
   * difference of counts.
   */
  readonly bySessionForDate: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Durable rows counted by the store's LIVED-day column, when one was given. */
  readonly byNameForLivedDay: Readonly<Record<string, number>>;
  readonly livedDayRead: number | null;
  /**
   * Detectors this brief and the CONTRACT name that are NOT durable events in
   * v2 today, so they can never be counted out of the store. Named here rather
   * than reported as zero (scar §2.4; CONTRACT §5 G2's own premise).
   */
  readonly nonDurable: readonly string[];
  readonly memories: {
    readonly total: number;
    readonly byKind: Readonly<Record<string, number>>;
    readonly bySource: Readonly<Record<string, number>>;
    readonly createdOnDate: number;
    readonly createdByKind: Readonly<Record<string, number>>;
    readonly createdBySource: Readonly<Record<string, number>>;
    /**
     * Exits counted from the durable `memory.pruned` / `memory.merged` rows.
     * NULL is `not-exercised`: those rows carry only the store's LIVED day, so
     * without a `--lived-day` there is nothing to attribute them to, and a zero
     * would read as "nothing left the store" (scar §2.4).
     */
    readonly exitedOnDate: number | null;
    readonly exitedByKind: Readonly<Record<string, number>>;
    /** How the number above was obtained — or why there is none. */
    readonly exitedNote: string;
    readonly archivedTotal: number;
  };
}

// ---------------------------------------------------------------------------
// The transcript canary and the host's hook model
// ---------------------------------------------------------------------------

/** A foreign marker found in a message block. Address only, never text. */
export interface CanaryHit {
  readonly file: string;
  readonly entry: number;
  readonly role: string;
  /** Index into `FOREIGN_MARKERS` — the recognizer, by reference. */
  readonly marker: number;
}

export type HookExecutionModel = "parallel" | "sequential" | "unknown";

export interface HookDurations {
  readonly hookEvent: string;
  readonly hookName: string;
  readonly count: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly maxMs: number;
}

export interface HookModelReport {
  readonly model: HookExecutionModel;
  /** Pairs of same-event hook windows that overlapped in wall-clock time. */
  readonly overlaps: number;
  readonly records: number;
  readonly perHook: readonly HookDurations[];
  /** The host's shared SessionEnd budget, in ms. */
  readonly sessionEndBudgetMs: number;
  /**
   * What the WORST SINGLE SESSION's SessionEnd cost — summed across its hooks
   * when sequential, the longest when parallel. Per session, and SessionEnd
   * only: `Stop` is a different event with a different budget. NULL when no
   * SessionEnd record was seen, which is `not-exercised`, never a pass.
   */
  readonly sessionEndWorstMs: number | null;
  /** How many sessions carried a SessionEnd record at all. The denominator. */
  readonly sessionEndSessions: number;
  /** Which session that worst cost came from — a path, so it can be re-read. */
  readonly worstSession: string | null;
  readonly sessionEndOk: boolean | null;
}

export interface CanaryScan {
  readonly files: number;
  readonly entries: number;
  readonly corrupt: number;
  /**
   * v1's WAKE/RECALL markers (indexes 2–4) inside user/assistant CONVERSATION
   * blocks. THE red-line: that exclusion is carried by the host's transcript
   * shape, so one of these here means the host changed (§5 G8, scar §2.18).
   */
  readonly conversationHits: readonly CanaryHit[];
  /**
   * v1's EPISODE-ASK markers (indexes 0–1) in a user-role block, WITH
   * `classifyBlock` agreeing they are `foreign`. This is the design working —
   * §5 G8's "the one channel that DOES land as a user-role message ... is the
   * `foreign` case" — so it is counted, never red-lined.
   */
  readonly byDesignHits: readonly CanaryHit[];
  /**
   * An episode-ask marker whose text `classifyBlock` did NOT call `foreign`.
   * Recognizer drift: the exclusion silently stopped applying. Its own red-line.
   */
  readonly recognizerDrift: readonly CanaryHit[];
  /**
   * Every v1 marker the scan saw anywhere, attachments included. ZERO means the
   * scan proved nothing — an empty corpus and a clean one are indistinguishable
   * — so the check reads `not-exercised` rather than passing vacuously.
   */
  readonly markersSeen: number;
  /**
   * Foreign markers in host-carried material — `tool_result` blocks and entries
   * with no message role. Reported SEPARATELY because that exclusion is carried
   * by the host's transcript shape, not by v2 (CONTRACT §5 G8).
   */
  readonly attachmentHits: number;
  readonly hooks: HookModelReport;
}

// ---------------------------------------------------------------------------
// The run record
// ---------------------------------------------------------------------------

export interface RunRecord {
  readonly startDate: string;
  readonly phase: RunPhase;
  readonly primacy: Primacy;
  /**
   * Active days, PER PHASE. Recomputed from `days[].phase` on every write, so a
   * Phase P count can never inherit Phase S's days (review blocker 5).
   */
  readonly activeDays: Readonly<Record<string, number>>;
  /**
   * Every lived day recorded, with its class AND the phase it was lived in —
   * the field the per-phase counts are computed from. Without it the run record
   * cannot say which minimum a day counted toward (scar E8).
   */
  readonly days: readonly {
    readonly date: string;
    readonly class: DayClass;
    readonly phase: RunPhase;
  }[];
  readonly configHashes: {
    readonly v2Config: string | null;
    readonly assignment: string | null;
  };
  readonly seat: string;
  readonly vectors: string;
  /**
   * G12's carry-forward hash: the digest of `surfaceSetFields()` as of the
   * build that wrote this record. Precondition 9's second half — "provably
   * identical" needs a hash written down BEFORE the change it prices.
   */
  readonly surfaceSet: string;
  readonly updatedAt: string;
}

export interface Bars {
  /** K — the active-day conversational-turn floor, committed before Phase S. */
  readonly activeDayTurnFloor: number;
  readonly crossEncodingBar: number;
  /**
   * The cross-encoding meter's PROBE FLOOR, in characters. Committed like every
   * other bar and required like every other bar: without it `---` and `## Notes`
   * are probes, and the meter manufactures hits out of markdown punctuation.
   * There is no default — a floor chosen after seeing the data is not a bar.
   */
  readonly crossEncodingMinLineChars: number;
  /**
   * Phase P's red-line share of v1's daily mints (§9 OQ4, RULED 2026-09-03:
   * 0.10). Phase S's bar is zero hits and does not use this.
   */
  readonly crossEncodingRatioBar: number;
  readonly committedAt: string;
  /**
   * Precondition 1's drop-dead, as a DATE the preflight can compare rather than
   * a sentence in a document (§5 P1: "drop-dead 2026-09-08").
   */
  readonly preconditionDropDead: string;
}
