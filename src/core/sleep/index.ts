/**
 * `sleep/` — systems consolidation: pure math on a cycle.
 *
 * The librarian. It advances the lived-day clock, materializes strength into the
 * ranking cache, marks consolidation and executes the identity crossing, prunes
 * at the floor (archivally), dedups, expires superseded-version rows, and
 * re-renders the wake briefing LAST.
 *
 * **Zero generative model calls, asserted by a test over this module's sources**
 * (CONTRACT §5 G1). Embedding lookups are permitted arithmetic and arrive
 * INJECTED, isolated, and degrading to lexical — never as a dependency of this
 * module.
 *
 * What this module deliberately does NOT contain, and why:
 *
 *   - **The lock, the watchdog, and detachment** (§3, scars E4/E5). Those belong
 *     to the adapter that spawns the cycle; the cross-key configuration
 *     invariant that binds them is here, as `validateWatchdog`, because it is
 *     arithmetic. INTERFACE-GAPS.md §6.
 *   - **The briefing itself.** `self/` owns it. Sleep owns only that it is last.
 *   - **Any import from `../self/`.** A test asserts the absence.
 */

export { runCycle, todayDate, census } from "./cycle.js";
export type { SleepOptions } from "./cycle.js";

export {
  MARKER_PREFIX,
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  MERGE_RECORD_PREFIX,
  PROMOTION_RECORD_PREFIX,
  PRUNE_ARCHIVE_REASON,
  PRUNE_RECORD_PREFIX,
  TUNABLES,
  shouldSpawn,
  validateWatchdog,
} from "./tunables.js";
export type { SpawnReason, WatchdogReason } from "./tunables.js";

export {
  advanceMarker,
  budgetFor,
  cadenceFor,
  initializeMarkers,
  markerDue,
  markerKey,
  readMarker,
} from "./markers.js";
export type { DueVerdict, MarkerHealth, MarkerRead } from "./markers.js";

export {
  STRENGTH_CACHE_FILE,
  memoryStrengthCache,
  sqliteStrengthCache,
  storeRankingCache,
  supportsRanking,
  strengthCachePath,
} from "./strength-cache.js";
export type { StrengthCache, StrengthRow } from "./strength-cache.js";

export { DECAY_SKIPS, runDecay } from "./decay.js";
export type { DecayResult, DecaySkip } from "./decay.js";

export { CONSOLIDATION_SKIPS, promotionRecordKey, runConsolidate } from "./consolidate.js";
export type { ConsolidateResult, ConsolidationSkip } from "./consolidate.js";

export { inLiveRevisionChain, pruneRecordKey, runPrune } from "./prune.js";
export type { PruneResult } from "./prune.js";

export { contentHashCandidates, declaredUpdates, mergeRecordKey, runDedup } from "./dedup.js";
export type { DedupCandidateInput, DedupCandidateSource, DedupPair, DedupResult } from "./dedup.js";

export { runBriefing } from "./briefing.js";
export type { BriefingContext, BriefingOutcome, BriefingResult, RenderFn } from "./briefing.js";

export { CycleKilled, PHASES, countSkip, emptyOutcome, phaseReport } from "./types.js";
export type {
  CycleReport,
  CycleStep,
  KindCensus,
  MergeRecord,
  Phase,
  PhaseCtx,
  PhaseOutcome,
  PhaseReason,
  PhaseReport,
  PhaseStatus,
  PromotionRecord,
  PrunedRecord,
  SleepEvent,
  SleepStore,
  StepStage,
} from "./types.js";
