/**
 * `tools/replay/` — the validation harness, composed.
 *
 * One call runs the whole instrument: open the corpus read-only, drive v1's
 * recorded days through Counterparts into a fresh temp store, score the result
 * against `docs/harvest/replay-baselines.md` with a four-value verdict per
 * metric, run the decay three-way, and render a report that carries numbers and
 * never text.
 *
 * The pieces stay separately importable on purpose — the corpus reader, the
 * driver, the comparator, the decay comparison and the renderer each have their
 * own contract and their own tests.
 */
export { Corpus, CorpusError, contentAddress, digestOf, manifest } from "./corpus.js";
export type { CorpusEvent, CorpusOptions, CorpusSpan, FileEntry } from "./corpus.js";

export { DriverError, HARNESS_VERSION, assertNoPresetDataDir, runReplay } from "./driver.js";
export type { DriverOptions, ReplayRun } from "./driver.js";

export { METRICS, claimedSections, metricById } from "./baselines.js";

export { BASELINES_DOC, documentSections, scoreMetric, scoreRun, totality } from "./compare.js";

export { REFERENCE_SHAPE, SHAPES, decayShapes } from "./decay-shapes.js";
export type { BandDivergence, DecayShapeReport, RowSource, ShapeStats } from "./decay-shapes.js";

export { ReportError, gateOpen, passRecord, renderReport, writePassRecord } from "./report.js";
export type { PassRecord, RenderInput } from "./report.js";

export type * from "./types.js";

import { Corpus } from "./corpus.js";
import { scoreRun } from "./compare.js";
import { decayShapes } from "./decay-shapes.js";
import type { DecayShapeReport } from "./decay-shapes.js";
import { runReplay } from "./driver.js";
import type { DriverOptions, ReplayRun } from "./driver.js";
import { HARNESS_VERSION } from "./driver.js";
import { passRecord, renderReport } from "./report.js";
import type { PassRecord } from "./report.js";
import type { Scorecard } from "./types.js";

/** Lived days the decay projection runs forward by default. */
export const DEFAULT_DECAY_HORIZON_DAYS = 90;

export interface ReplayOptions extends Omit<DriverOptions, "corpus"> {
  /** The preserved snapshot's root. READ-ONLY, always (guarantee 2). */
  readonly corpusDir: string;
  /** Which embedding generation this run pins. Two coexist in v1's cache. */
  readonly pinModel?: string;
  /**
   * Lived days to project the decay comparison forward, past the last replayed
   * day. A replay mints everything "today", so at the final lived day the
   * elapsed interval is ~0 and all three curves coincide; OQ1 is decided by what
   * they do weeks later. Default 90 — a quarter of lived days, the interval
   * `H_SUPERSEDED_DAYS` and `D_FLOOR_DAYS` already reason over. 0 disables it.
   */
  readonly decayHorizonDays?: number;
}

export interface ReplayResult {
  readonly run: ReplayRun;
  readonly scorecard: Scorecard;
  readonly decay: DecayShapeReport;
  /** The projection, absent only when `decayHorizonDays` was 0. */
  readonly decayHorizon: DecayShapeReport | null;
  readonly report: string;
  readonly pass: PassRecord;
  /** Closes the brain and removes ONLY the directory the driver created. */
  cleanup(): void;
}

export async function replay(opts: ReplayOptions): Promise<ReplayResult> {
  const corpus = Corpus.open(opts.corpusDir, {
    ...(opts.pinModel === undefined ? {} : { pinModel: opts.pinModel }),
  });
  const run = await runReplay({ ...opts, corpus });
  const scorecard = scoreRun(run.observation, run.record);
  // Before cleanup: the decay three-way reads the store the run just built.
  const decay = decayShapes(run.counterpart.store);
  const horizonDays = opts.decayHorizonDays ?? DEFAULT_DECAY_HORIZON_DAYS;
  const decayHorizon =
    horizonDays > 0 ? decayShapes(run.counterpart.store, { day: decay.day + horizonDays }) : null;
  const input = {
    scorecard,
    observation: run.observation,
    decay,
    ...(decayHorizon === null ? {} : { decayHorizon }),
  };
  const result: ReplayResult = {
    run,
    scorecard,
    decay,
    decayHorizon,
    report: renderReport(input),
    pass: passRecord(input),
    cleanup(): void {
      corpus.close();
      run.cleanup();
    },
  };
  return result;
}

export { HARNESS_VERSION as VERSION };
