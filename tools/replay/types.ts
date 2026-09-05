/**
 * `tools/replay/types.ts` — the vocabulary the harness grades in.
 *
 * STRUCTURAL ONLY. Nothing here imports `src/`, and that is load-bearing: the
 * scorer (`baselines.ts`, `compare.ts`, `report.ts`) grades v2 through these
 * shapes rather than by calling the modules under test, which is CONTRACT §5
 * guarantee 5 — *a shared bug must not grade itself*. `test/replay.test.ts`
 * source-scans those three files and this one for `src/core` imports.
 *
 * Everything in here is CONTENT-BY-REFERENCE (scar §2.20): ids, hashes, counts,
 * bytes, rates, reasons. No field on any type below carries memory body text or
 * transcript text, so a report rendered from them cannot leak one.
 */

// ---------------------------------------------------------------------------
// The four-value verdict vocabulary (CONTRACT §3, behavioral-spec §17.2)
// ---------------------------------------------------------------------------

/**
 * FOUR values, and no fifth. `not-exercised` is first class: a criterion nothing
 * ran is never a silent pass (scar §2.4 — "a zero is not a pass"). A metric the
 * harness cannot compute at all also lands here, with its reason spelled out,
 * rather than being dropped from the scorecard.
 */
export type Verdict = "pass" | "fail" | "needs-rater" | "not-exercised" | "watch";

export const VERDICTS: readonly Verdict[] = [
  "pass",
  "fail",
  "needs-rater",
  "not-exercised",
  // `watch` is the UNGRADED verdict (PR-5 review): a measured number with no
  // bar yet. It can neither pass nor fail a run — rendering it as `pass` with
  // an always-true range was scar §2.4's vacuous-PASS shape in miniature, the
  // same reasoning that moved session.boundaryCoverage to not-exercised.
  "watch",
];

/** Why a metric is `not-exercised`. Never absent when the verdict is. */
export type NotExercisedReason =
  /** The harness structurally cannot compute it — the `why` says what is missing. */
  | "not-computable"
  /** Computable in principle; this run produced an empty denominator. */
  | "no-denominator"
  /** Measured on a different model seat, so it is a new baseline (§17.3). */
  | "not-comparable";

/** An inclusive range. RANGES, never points — replay-baselines §1.3's lesson. */
export interface Range {
  readonly lo: number;
  readonly hi: number;
}

/** One measurement: the value plus the fraction it came from, so a report can
 *  show `22/129` beside `17.1%` and a reader can judge the denominator. */
export interface Sample {
  readonly value: number;
  readonly numerator?: number;
  readonly denominator?: number;
}

// ---------------------------------------------------------------------------
// What the driver hands the scorer
// ---------------------------------------------------------------------------

/** A relayed brain event, already content-by-reference at the source. */
export interface ObservedEvent {
  readonly name: string;
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
}

/** One fallback chunk's outcome, as `remember/` reported it. */
export interface ChunkSummary {
  readonly date: string;
  readonly scope: string;
  readonly index: number;
  readonly ok: boolean;
  readonly reason: string;
  readonly spans: number;
  readonly bytes: number;
  readonly proposals: number;
  /**
   * TRUE when this chunk's gate verdict was actually matched to it. FALSE means
   * the chunk never reached the gate (`EMPTY`, `TRUNCATED`, `THREW`) or its
   * record could not be matched — and then `accepted`/`refused`/`blind` below
   * are zeros that mean "not asked", so every gate metric uses THIS as its
   * denominator rather than the chunk count (scar §2.4).
   */
  readonly gated: boolean;
  /** Proposals the chunk gate accepted (from the relayed chunk event). */
  readonly accepted: number;
  readonly refused: number;
  readonly fullyGated: boolean;
  /** Preselection showed this chunk nothing — the headline blind-rate input. */
  readonly blind: boolean;
  /** Memories actually minted out of this chunk. */
  readonly minted: number;
}

/**
 * One chunk's gate record, READ BACK FROM THE DURABLE LOG rather than from the
 * relayed event ring — which is the point. A metric that can only be computed
 * from an in-process event stream cannot be recomputed from a store after the
 * fact, and the parallel run's evidence is exactly a store after the fact.
 *
 * `chunkKey` is the content address of the chunk's own span hashes, so the join
 * is by content and not by arrival order (INTERFACE-GAPS §1's correlation id).
 */
export interface GateRecordSummary {
  readonly chunkKey: string;
  readonly day: number;
  readonly scope: string;
  readonly proposals: number;
  readonly accepted: number;
  readonly refused: number;
  readonly fullyGated: boolean;
  readonly blind: boolean;
  /** How many schemas the author was shown — the count behind `blind`. */
  readonly shown: number;
  readonly candidates: number;
  /** Shown schemas by the channel(s) that reached them (encode §8 G4). */
  readonly shownLexicalOnly: number;
  readonly shownSemanticOnly: number;
  readonly shownBoth: number;
  /**
   * `ran` | `off` | `skipped`. A zero semantic contribution means three
   * different things under the three states, and only `ran` is a measurement
   * (scar §2.4) — so it is the channel-mix metric's denominator filter.
   */
  readonly semanticState: string;
  /** Gate ACTIONS by gate name, as the battery itself counted them — v1's
   *  "737 gate fires", which includes fires on proposals that were accepted. */
  readonly fires: Readonly<Record<string, number>>;
  /** Refusals by first blocking reason. */
  readonly refusalsByReason: Readonly<Record<string, number>>;
}

/**
 * One AUTHORED deposit's gate record, read back from the same durable log
 * (`gate.deposit`, INTERFACE-GAPS §2a).
 *
 * KEPT SEPARATE FROM `gateRecords` ON PURPOSE. The two record kinds share the
 * battery and share the fire vocabulary — so the refusal MIX is legitimately a
 * sum over both — but they do not share a denominator anywhere else. A deposit
 * is one proposal, not a chunk; it is preselected against nothing, so folding
 * these rows into `gateRecords` would drag `preselect.meanSchemasShown` toward
 * zero with a number that was never measured, and put chunks that do not exist
 * into `gate.chunkBlockRate`. Two arrays, one vocabulary, and each metric says
 * which it counts over.
 */
export interface DepositRecordSummary {
  /** The redacted draft's content hash — an address, never the text. */
  readonly contentHash: string;
  readonly day: number;
  readonly scope: string;
  /** Which authored door: `jot`, `session-end`, … */
  readonly source: string;
  readonly accepted: boolean;
  readonly kind: string;
  /** Gate ACTIONS by gate name, counted by the same rule `gate.chunk` uses. */
  readonly fires: Readonly<Record<string, number>>;
  /** Refusals by blocking reason — the same closed vocabulary. */
  readonly refusalsByReason: Readonly<Record<string, number>>;
  /** Every reason the battery blocked on, unjoined. Empty on the accept arm. */
  readonly blockedBy: readonly string[];
  /** Per-gate status by gate name (`clear`, `fired`, `rejected`, …). */
  readonly statuses: Readonly<Record<string, string>>;
}

/** One band crossing, by DIRECTION, read back from the durable log. */
export interface BandTransitionSummary {
  readonly day: number;
  readonly kind: string;
  readonly from: string;
  readonly to: string;
  readonly direction: string;
  readonly site: string;
}

/**
 * One per-kind symmetry verdict (physics guarantee 12, scar §2.10). `reason` is
 * load-bearing: below the minimum sample the verdict is `never-asked` with
 * `ok: true`, and reading that as health is the exact failure the tripwire
 * exists to prevent.
 */
export interface SymmetryVerdictSummary {
  readonly day: number;
  readonly kind: string;
  readonly ok: boolean;
  readonly reason: string;
  readonly up: number;
  readonly down: number;
}

export interface SweepSummary {
  readonly date: string;
  readonly scope: string;
  readonly ran: boolean;
  readonly reason: string;
  readonly chunks: number;
  readonly proposals: number;
  readonly spansSwept: number;
  readonly spansRestored: number;
  readonly consumed: boolean;
}

export interface CycleSummary {
  readonly date: string;
  readonly day: number;
  readonly phasesRan: number;
  readonly phasesFailed: number;
  readonly decayRan: boolean;
  readonly decayExamined: number;
  readonly decayChanged: number;
  readonly promoted: number;
  readonly pruned: number;
  readonly merged: number;
  /** Band moves UP this cycle, counted by direction (physics guarantee 12). */
  readonly bandUp: number;
  /** Band moves DOWN. v1 ran 279 up against zero down and nothing fired. */
  readonly bandDown: number;
  /** Bytes the boundary briefing rendered to, or null when it refused. */
  readonly briefingBytes: number | null;
  /** The ceiling the HOST reported for this boundary (never invented here). */
  readonly budgetBytes: number | null;
}

export interface DaySummary {
  readonly date: string;
  readonly livedDay: number;
  readonly sessions: number;
  readonly spansOffered: number;
  readonly spansCaptured: number;
  readonly jots: number;
  readonly deduped: number;
  readonly excluded: number;
  readonly boundaries: number;
}

/** The replayed store, counted. Ids and counts only. */
export interface StoreCensus {
  readonly memories: number;
  readonly archived: number;
  readonly episodes: number;
  readonly schemas: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byBand: Readonly<Record<string, number>>;
  readonly superseded: number;
  readonly livedDay: number;
}

/** What the corpus reader saw going in — including what it could NOT parse. */
export interface CorpusSummary {
  readonly dir: string;
  readonly days: number;
  readonly spanFiles: number;
  readonly spans: number;
  readonly spanBytes: number;
  readonly sessions: number;
  readonly scopes: number;
  /** Span records that parsed as JSON but did not look like a v1 span. */
  readonly malformedSpans: number;
  /** Files under `buffer-archive/` the reader did not recognize at all. */
  readonly unrecognizedSpanFiles: number;
  /** Spans whose `kind` had to be inferred from `role` (format drift, counted). */
  readonly assumedKind: number;
  /**
   * Spans that parsed only through a NEAR-MISS field spelling rather than v1's
   * own span shape (`spanText`/`sessionId`/`project`/`ts`). Zero is the expected
   * reading against a real v1 snapshot; a large number means the writer's shape
   * moved and `parseSpan` is one release behind.
   */
  readonly assumedShape: number;
  readonly eventFiles: number;
  readonly eventLines: number;
  readonly malformedEventLines: number;
  readonly eventNames: number;
  /** Distinct `runner.start.activeDay` values — v1's lived-day clock (scar E8). */
  readonly activeDays: number;
  readonly indexPresent: boolean;
  /** Embedding rows per model generation, as found. Pinning is the caller's. */
  readonly embeddingModels: Readonly<Record<string, number>>;
  /** The generation the run pinned, or null when the run used no vectors. */
  readonly pinnedModel: string | null;
  readonly pinnedRows: number;
  /** sha256 over (relative path, size, content hash) of every corpus file. */
  readonly digest: string;
  readonly files: number;
}

/**
 * Everything the scorer is allowed to see. The driver builds it; the scorer
 * never reaches past it into a `Store` or a `Counterpart`.
 */
export interface ReplayObservation {
  readonly activeDays: number;
  readonly days: readonly DaySummary[];
  readonly cycles: readonly CycleSummary[];
  readonly sweeps: readonly SweepSummary[];
  readonly chunks: readonly ChunkSummary[];
  /** The chunk gate's own records, read back from the store's DURABLE log. */
  readonly gateRecords: readonly GateRecordSummary[];
  /** The AUTHORED door's gate records, from the same log (§2a). */
  readonly depositRecords: readonly DepositRecordSummary[];
  /** Band crossings by direction, from the same log. */
  readonly bandTransitions: readonly BandTransitionSummary[];
  /** The per-kind symmetry verdicts each cycle rendered. */
  readonly symmetry: readonly SymmetryVerdictSummary[];
  readonly events: readonly ObservedEvent[];
  readonly store: StoreCensus;
  readonly corpus: CorpusSummary;
  /** Mirrors the run record — two metrics grade these directly (guarantees 7–8). */
  readonly seat: string;
  readonly vectors: string;
}

// ---------------------------------------------------------------------------
// The run record (CONTRACT §5 guarantees 7 and 8)
// ---------------------------------------------------------------------------

export interface RunRecord {
  /** Derived from the corpus digest and the seat — deterministic on purpose. */
  readonly runId: string;
  readonly at: number;
  /** THE ACTING MODEL SEAT. v1 added this because "which seat ran" had been
   *  unanswerable for months, and it is what makes §17.3's not-comparable rule
   *  enforceable. Required — the driver refuses an empty one. */
  readonly seat: string;
  /** The pinned vector generation (`voyage-3-large`, `voyage-3.5`, or `none`).
   *  A replay that says "reuse the cached vectors" without naming one is
   *  undefined (CONTRACT §4). Required. */
  readonly vectors: string;
  readonly corpusDir: string;
  readonly corpusDigest: string;
  /** The ceiling the host reported. Never invented inside `src/` (scar §2.18). */
  readonly budgetBytes: number;
  readonly storeDir: string;
  readonly harnessVersion: string;
  /** The reader proved its sqlite handle refuses writes (guarantee 2). */
  readonly readOnlyProof: boolean;
}

// ---------------------------------------------------------------------------
// Metric specs and results
// ---------------------------------------------------------------------------

export type Grading =
  | { readonly kind: "range"; readonly range: Range; readonly note?: string }
  /** Measured, UNGRADED: a real number with no bar yet — bars are proposed
   *  from a run's profile, not invented. Renders `watch`, never `pass`. */
  | { readonly kind: "watch"; readonly note: string }
  /** Human-rated: the harness computes the surface, a person renders the verdict. */
  | { readonly kind: "rater"; readonly bar: string }
  /** The harness structurally cannot produce this number. `why` is mandatory. */
  | { readonly kind: "not-computable"; readonly why: string }
  /** A different model seat / a v1-only mechanism: a new baseline, not a check. */
  | { readonly kind: "not-comparable"; readonly why: string };

export interface MetricSpec {
  readonly id: string;
  /** The `replay-baselines.md` section this number comes from ("1.3"). */
  readonly section: string;
  readonly label: string;
  /** v1's own figure, as recorded, for the report's "v1" column. */
  readonly v1: string;
  readonly unit: "rate" | "count" | "per-day" | "mean" | "bytes" | "flag";
  readonly grading: Grading;
  /**
   * The scorer's OWN arithmetic over the observation (guarantee 5). Returns
   * `null` for "this run had no denominator", which becomes `not-exercised`
   * rather than a zero.
   */
  readonly compute?: (o: ReplayObservation) => Sample | null;
}

export interface MetricResult {
  readonly id: string;
  readonly section: string;
  readonly label: string;
  readonly v1: string;
  readonly unit: MetricSpec["unit"];
  readonly verdict: Verdict;
  /** Present whenever the verdict is `not-exercised`. */
  readonly reason: NotExercisedReason | null;
  /** Free-text WHY, from the spec — static harness prose, never corpus text. */
  readonly why: string | null;
  readonly observed: Sample | null;
  readonly range: Range | null;
}

export interface TotalityReport {
  /** Every `### 1.x` section in `replay-baselines.md`. */
  readonly sections: readonly string[];
  /** Sections with no registry entry — a non-empty list FAILS the run. */
  readonly unclaimedSections: readonly string[];
  /** Registry entries naming a section the baselines file does not have. */
  readonly unknownSections: readonly string[];
  /** Metrics with neither a computed value nor a declared reason. Always empty
   *  in a rendered report: the renderer throws instead. */
  readonly unaccounted: readonly string[];
  readonly ok: boolean;
}

export interface Scorecard {
  readonly record: RunRecord;
  readonly metrics: readonly MetricResult[];
  readonly counts: Readonly<Record<Verdict, number>>;
  readonly totality: TotalityReport;
  /** TRUE only when every metric passed AND totality held. A run containing a
   *  `not-exercised` can never be reported as a clean pass (guarantee 4). */
  readonly clean: boolean;
}
