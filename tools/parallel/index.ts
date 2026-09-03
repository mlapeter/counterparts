/**
 * `tools/parallel/` — the parallel run's instrument. One entry point.
 *
 * Read `CONTRACT.md` first; `README.md` is the operator's half.
 */
export {
  KNOWN_NOT_EXERCISED,
  NOT_APPLICABLE_TO_RUN,
  PARALLEL_EXERCISABLE,
  RATER_DEFERRED,
  gateSets,
  parallelGateOpen,
  parseGateRecord,
  parseWaivers,
} from "./gate.js";
export type { GateReadableRecord } from "./gate.js";

export {
  DURABLE_DETECTORS,
  DURABLE_EXIT_EVENTS,
  EPISODE_ASK_MARKERS,
  HOST_SESSION_END_BUDGET_MS,
  MEMORY_MERGED_EVENT,
  MEMORY_PRUNED_EVENT,
  NON_DURABLE_DETECTORS,
  READ_BUSY_TIMEOUT_MS,
  ReaderError,
  WAKE_RECALL_MARKERS,
  V1_CREATED_EVENT,
  V1_DETECTOR_TYPES,
  V1_EXITED_EVENT,
  V1_RECALL_EVENT,
  V1_RITUAL_EVENT,
  V1_TURN_EVENT,
  V1_WAKE_EVENTS,
  dateOf,
  fileHash,
  filesUnder,
  hookModel,
  jsonlFiles,
  laterThan,
  migratedProse,
  openReadOnly,
  overlaps,
  probeReadOnly,
  proseBody,
  proseRows,
  readAssignmentAs,
  readQuarantineLines,
  readSchemaBytes,
  readSurfaceEvidence,
  readV1Day,
  readV1Lines,
  readV2Day,
  realpathOr,
  scanTranscripts,
  transcriptFiles,
  v1LogPath,
  v2StorePath,
} from "./readers.js";
export type {
  AssignmentReading,
  HookEnvSpec,
  HookRecord,
  ProseRow,
  RawDb,
  ReadOnlyProbe,
  ReadOnlyVerdict,
  SchemaBytesReading,
  StoreOpener,
  V1Line,
  V2DayOptions,
} from "./readers.js";

export { preflightArtifacts, readBars, runPreflight } from "./preflight.js";
export type { PreflightOptions } from "./preflight.js";

export {
  RecordError,
  addressLines,
  crossEncoding,
  dailyRecord,
  readRunRecord,
} from "./record.js";
export type { CrossEncodingInput, DailyArtifacts, DailyOptions } from "./record.js";

export { primacyFromAssignment } from "./assignment.js";
export { surfaceSetHash } from "./surface.js";

export { RunDir, WriterError } from "./writer.js";
export type { LiveStores } from "./writer.js";

export type * from "./types.js";
