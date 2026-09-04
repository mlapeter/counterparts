/**
 * `tools/recall-bench` — the input the operator hands it, and the rows it prints.
 *
 * The labels are a HUMAN JUDGMENT, recorded once and re-used: `should_surface`
 * is what the instance that lived the conversation said it wanted, and
 * `known_hubs` is what it actually got and judged irrelevant. Neither is
 * derivable from the store, which is why they arrive as a file rather than as a
 * computation.
 */

export interface BenchQuery {
  readonly session?: string;
  readonly turn?: number;
  readonly at?: string;
  readonly text: string;
  readonly labels?: {
    readonly should_surface?: readonly string[];
    readonly note?: string;
  };
  /** What the LIVE run delivered for this turn, for the record. Not scored. */
  readonly delivered_footnotes_live?: readonly string[];
  readonly delivered_judged_relevant?: number;
}

export interface BenchToolQuery {
  readonly question: string;
  readonly should_surface?: readonly string[];
  readonly note?: string;
}

export interface BenchInput {
  readonly source?: string;
  readonly queries: readonly BenchQuery[];
  readonly tool_queries?: readonly BenchToolQuery[];
  readonly known_hubs?: readonly string[];
  readonly hub_note?: string;
}

/** One delivered memory, as a tier and an id. Ids only — never bodies. */
export interface Delivered {
  readonly id: string;
  readonly tier: string;
}

export interface QueryRow {
  readonly label: string;
  readonly reason: string;
  readonly candidates: number;
  /** Documents whose cue sum hit `CUE_DOC_CAP`. */
  readonly capped: number;
  readonly delivered: readonly Delivered[];
  readonly hubHits: readonly string[];
  /** Labeled ids that came back. */
  readonly wanted: readonly string[];
  /** Labeled ids that exist in the store and did not come back. */
  readonly missed: readonly string[];
  /** Labeled ids that are not in this store at all — not a miss, a gap. */
  readonly absent: readonly string[];
  readonly elapsedMs: number;
}

export interface ToolRow {
  readonly label: string;
  readonly reason: string;
  readonly considered: number;
  readonly returned: number;
  /** Characters the tool would put on the wire. The overflow this PR bounds. */
  readonly chars: number;
  readonly delivered: readonly Delivered[];
  readonly hubHits: readonly string[];
  readonly wanted: readonly string[];
  readonly missed: readonly string[];
  readonly absent: readonly string[];
}

export interface BenchConfig {
  readonly name: string;
  /** BM25 b. 0 reproduces the pre-normalization scorer exactly. */
  readonly b: number;
  /** BM25 k1. */
  readonly k1: number;
  /** Per-document ceiling; `Infinity` disables it. */
  readonly cap: number;
  /** Clamp the length factor at 1 — penalize long, never reward short. */
  readonly oneSided?: boolean;
  /** The GATE's side of the sweep: how many sd above this turn's background a
   *  candidate must stand to be admitted at all, and to go loud. Absent = the
   *  shipped CAL value. */
  readonly snrGlobal?: number;
  readonly snrStrong?: number;
  /** The loud-tier floor, in CUE UNITS — multiples of one maximally-rare cue,
   *  `informativeness(1, storeSize)` (`recall/gate.ts#floorUnit`). One number,
   *  not a per-kind shape: see the note at the override site. */
  readonly floorStrongUnits?: number;
  /** The hard cap on the footnote lane. A cap, not a bar: it changes how many
   *  of the ranked survivors are shown, never which ones rank. */
  readonly maxFootnotes?: number;
  /** Hard gate (b): the absolute floor, checked before any salience adjustment,
   *  in the same cue units as `floorStrongUnits`. */
  readonly floorGlobalUnits?: number;
}

/** One id and how many of the turns delivered it. The hub metric that does not
 *  need a blocklist: "hub hits 0" is true of last week's nine and blind to next
 *  week's, where recurrence is a property of the RUN. */
export interface Recurrence {
  readonly id: string;
  readonly turns: number;
  readonly loud: number;
}

export interface BenchReport {
  readonly config: BenchConfig;
  readonly storeSize: number;
  readonly rows: readonly QueryRow[];
  readonly toolRows: readonly ToolRow[];
  readonly totals: {
    readonly turns: number;
    readonly delivered: number;
    /** The loud tier — 'came clearly to mind'. The contract says RARELY. */
    readonly surfaced: number;
    /** TURNS carrying at least one loud item. The contract's word is *rarely*,
     *  and "rarely" is a property of turns, not of a total. */
    readonly loudTurns: number;
    readonly footnotes: number;
    readonly hubHits: number;
    readonly turnsWithHub: number;
    readonly wanted: number;
    readonly missed: number;
    readonly absent: number;
    readonly allGated: number;
    readonly rendered: number;
    readonly capped: number;
    readonly maxElapsedMs: number;
    /** Ids delivered on 3 or more turns, most-recurrent first. */
    readonly recurring: readonly Recurrence[];
    /** Deliveries that went to a recurring id — the share of the run that is
     *  the same handful of memories saying hello again. */
    readonly recurringDeliveries: number;
  };
}
