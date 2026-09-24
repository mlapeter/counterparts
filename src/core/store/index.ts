/**
 * The store seam.
 *
 * TWO boxes behind one object, since the floor (schema v6, 2026-09-20):
 *   2. canonical      — `counterparts.sqlite`   (box 2, `operational.ts`)
 *   3. rebuildable    — `cache/cache.sqlite`    (box 3, `cache.ts`)
 *
 * Box 1 — `prose/**.md`, one markdown file per memory — is gone. `memories`
 * carries `title`, `body` and `meta`, and `versions` carries its own copy of the
 * three, so a memory and its history are one row and one transaction. Markdown
 * is an EXPORT (`render.ts`), and `ProseDoc` is still the read shape, which is
 * why `physics/`, `recall/`, `associate/`, `prospective/`, `encode/` and most of
 * `sleep/` never learned the floor moved.
 *
 * What that buys, in the words of the scars it closes: a crash can no longer
 * leave a row whose words are missing (there is no window between "commit the
 * row" and "publish the file"), removing a memory is one transaction rather than
 * a file chase, a backup is one file, and a copied store cannot read or delete
 * the source store's words because there are none outside the database (I22,
 * whose mechanism is deleted and whose criterion is kept).
 *
 * Every write crosses `mutate()`: it checks the observer stance FIRST, then opens a
 * transaction on box 2. That ordering is the point — an instrument refuses before it
 * has staged a byte, and a future caller inherits the refusal instead of having to
 * remember it (observer-mode.md G3, contract §5 G1).
 *
 * There is no delete/remove/unlink/rm export or method anywhere in this module, for
 * prose or anything else. Removal is an owner operation on a structurally distinct
 * path — see `owner-op-seam.ts`; the store's half of it is the append-only removal
 * record plus the deny-list consulted at load and rebuild (§16 G1, G7, G12).
 *
 * The deny-list is consulted HERE, at the seam, so every module inherits the
 * refusal instead of having to remember it: `read`/`readProse`/`physicsOf`/
 * `readVersion` raise a named `REMOVED` rather than an ENOENT on a chased file,
 * `resolve` stops at a removed id instead of dangling past it, and `put` refuses
 * to reuse one. `row()` is the deliberate exception — it is the raw box-2
 * accessor, and an instrument reading the skeleton of a removed memory is how the
 * owner sees that something WAS here (constitution 16).
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Band, Kind, MemoryPhysics, MemorySource, Salience } from "../types.js";
import { creditUse } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { Db, Statement } from "./db.js";
import { isLocked } from "./db.js";
import { StoreError } from "./errors.js";
import { isObserver } from "../observer.js";
import type { Stance } from "../observer.js";
import {
  DEFAULT_RETENTION_DAYS,
  SCHEMA_VERSION,
  openOperational,
  rowToPhysics,
  rowTombstoned,
} from "./operational.js";
import type {
  EdgeRow,
  EventRow,
  GateSessionRow,
  MemoryRow,
  ProspectiveRow,
  RemovalRow,
  TombstoneRow,
  VersionRow,
} from "./operational.js";
import { grantOwnerOps } from "./owner-op-seam.js";
import {
  DATABASE_FILE,
  LAYOUT,
  PRE_ROWS_READABLE_BY,
  assertLayoutClassified,
  assertSafeDataDir,
  dataDir,
  paths,
  preRowsLeftoversAreEmpty,
  preRowsMarkersIn,
} from "./paths.js";
import {
  ID_PREFIX,
  assertIdWellFormed,
  bodyForStorage,
  hashText,
  parseMeta,
  serializeMeta,
} from "./prose.js";
import type { ProseDoc, ProseType } from "./prose.js";
import {
  DEFAULT_LENGTH_NORM,
  deindexDoc,
  docFrequency,
  embeddingCount,
  indexDoc,
  nearest,
  nearestVectors,
  heldExits,
  cacheAhead,
  heldEmbedder,
  openCache,
  searchRefusal,
  reconcileEmbedder,
  recordedEmbedder,
  resetCache,
  searchIndex,
  setEmbedding,
} from "./cache.js";
import type { EmbedderIdentity, EmbedderVerdict, Hit, LengthNorm, VectorRefusal } from "./cache.js";

export * from "./errors.js";
export * from "../observer.js";
export * from "./paths.js";
export * from "./prose.js";
export * from "./render.js";
export type { Db, Statement } from "./db.js";
export type {
  MemoryRow,
  VersionRow,
  EdgeRow,
  EventRow,
  GateSessionRow,
  ProspectiveRow,
  RemovalRow,
  TombstoneRow,
} from "./operational.js";
export {
  ADDED_COLUMNS,
  DEFAULT_RETENTION_DAYS,
  isPreRowsDatabase,
  OBSERVER_READ_FLOOR,
  SCHEMA_VERSION,
  rowToPhysics,
  rowTombstoned,
} from "./operational.js";
export {
  tokenize,
  cosine,
  CACHE_SCHEMA_VERSION,
  DEFAULT_LENGTH_NORM,
  backfillLengths,
  avgDocLen,
  convertVectorBatch,
  countNonFinite,
  decodeVector,
  encodeVector,
  vectorFormats,
  EMBEDDER_META_KEY,
  EMBEDDER_REBUILD_META_KEY,
  EMBEDDER_HELD_META_KEY,
  heldExits,
  heldEmbedder,
  identityTag,
  parseIdentityTag,
  recordedEmbedder,
  schemaAhead,
} from "./cache.js";
export type { EmbedderIdentity, EmbedderVerdict, RecordedEmbedder, VectorRefusal } from "./cache.js";
export type { ConvertBatchReport, Hit, LengthNorm, VectorFormatCensus } from "./cache.js";
// The seam's TYPES travel as one unit (cli/INTERFACE-GAPS §3). The chase itself
// does not: `chaseRemoved` is importable only from `owner-op-seam.js`, by the one
// directory the caller-universality test allows (§16 G1–G2).
export type {
  ChaseReport,
  OwnerRemovalOutcome,
  OwnerRemovalPort,
  OwnerRemovalRequest,
} from "./owner-op-seam.js";

/** Telemetry: ids, hashes, counts, kinds, tiers. Never body text (§5 G10). */
export interface StoreEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Text in, vector out — or NULL when this embedder has no vector for this text.
 *
 * The null arm is load-bearing and was added when the first real embedder was
 * built (`adapters/claude-code/embed-client.ts`). Every production embedder is a
 * network client behind a cache, and `put`/`rebuildCache` are synchronous: a
 * lookup that misses has nothing to return. The two dishonest alternatives are
 * both worse — throwing fails a write over a rebuildable cache, and returning
 * `[]` writes a dim-0 row that `cosine` reads as 0.0 similarity, which is a lie
 * with a number on it. A miss is counted (`unrecomputed`), exactly as a
 * missing embedder already was, and `tools/replay/INTERFACE-GAPS §4` asks for
 * the same shape ("a cache miss must be a counted `not-exercised`").
 */
export interface Embedder {
  (text: string): number[] | null;
  /**
   * WHICH vectors this embedder produces (cache v5, roadmap C1). Optional, so a
   * plain function is still an embedder — a test stub, a replay harness — and
   * such an embedder is never checked against the cache's tag. A production
   * embedder carries one, and `Store.open` reconciles it with
   * `cache_meta.embedder` once, at open (`cache.ts#reconcileEmbedder`).
   */
  readonly identity?: EmbedderIdentity;
}

export interface StoreOptions extends Stance {
  /** Defaults to `dataDir()` — resolved at call time, so tests redirect via env. */
  dir?: string;
  /** Retention for superseded-version rows, in LIVED days. TUNABLE; default 90. */
  retentionDays?: number;
  /** Optional; without it, embeddings are declared un-recomputed at rebuild. */
  embed?: Embedder;
  /**
   * THE PROVENANCE CLOCK (LAUNCH-STATUS §I7, `NOTES.md` 2026-09-05).
   *
   * The session's wall clock, injected. Everything this store records about
   * WHEN IN THE WORLD something happened — `learnedOn`, event `at`, a version's
   * `archived_at`, a removal record's `at` — reads THIS and never the ambient
   * `Date.now`. The PHYSICS clock is a different clock and stays where it is:
   * `livedDay()` counts days the owner actually lived, advanced by
   * `advanceClock()`, and no wall-clock instant moves it.
   *
   * Defaults to `Date.now`, so a host that injects nothing behaves exactly as
   * before. A seeder, a replay harness and a migration pass one.
   */
  now?: () => number;
  onEvent?: (event: StoreEvent) => void;
}

export interface PutInput {
  /** Optional; generated when absent. Never reused — a taken id is a hard error. */
  id?: string;
  type: ProseType;
  kind: Kind;
  body: string;
  title?: string;
  happenedOn?: string;
  learnedOn?: string;
  meta?: Record<string, unknown>;
  band?: Band;
  salience?: Partial<Salience>;
  physics?: Partial<Omit<MemoryPhysics, "kind" | "salience">>;
  /** Who is minting (engine-set upstream; see `types.MemorySource`). Absent
   *  writes NULL — "unrecorded" — never a defaulted claim of authorship. */
  source?: MemorySource;
  /** Light provenance: ids only, never text (F9, owner ruling 2026-08-29).
   *  Mirrored into the prose doc's meta so the document is self-describing.
   *
   *  `spanHash` is the buffer's own hash of the span this memory WAS — a jot's
   *  own words — and it is here so removal can chase that line by identity
   *  rather than by re-deriving it from the body (cli/INTERFACE-GAPS §9). It
   *  lives in the prose meta and NOWHERE ELSE on purpose: a hash of low-entropy
   *  content is brute-forceable (§16 G9), and the prose document is the one
   *  carrier a removal destroys, so the pointer dies with the thing it points
   *  at instead of outliving it in a box-2 column. */
  origin?: { session?: string; scope?: string; ref?: string; spanHash?: string };
}

/**
 * A memory's confidentiality class, from its `meta`.
 *
 * The truth table lives HERE, beside the writes that carry it, because it is a
 * gate: `recall/activate.ts#isConfidential` is the same answer by the same
 * function, so the surfacing boundary and `StoredMemory.confidential` can never
 * disagree. Since the floor it is also evaluated ONCE PER WRITE and stored in
 * `memories.confidential`, so the gate no longer parses JSON on every read —
 * a gate that re-parses at every call site is a gate that will one day fail
 * open. The function stays the single definition both the column and the
 * boundary are computed from.
 */
export function confidentialByMeta(meta: Readonly<Record<string, unknown>>): boolean {
  if (meta["confidential"] === true) return true;
  const klass = meta["confidentiality"];
  return typeof klass === "string" && klass !== "" && klass !== "open" && klass !== "normal";
}

export interface StoredMemory {
  doc: ProseDoc;
  physics: MemoryPhysics;
  band: Band;
  bandDay: number;
  archived: boolean;
  archivedReason: string | null;
  supersededBy: string | null;
  revision: number;
  contentHash: string;
  /** The confidentiality class, read off the ROW's column (written from
   *  `confidentialByMeta` at every write). Carried on the read so a caller gates
   *  on a boolean rather than on JSON it had to re-interpret. */
  confidential: boolean;
}

export interface PruneReport {
  pruned: number;
  cutoffDay: number;
  retentionDays: number;
}

/**
 * What one bounded sweep of the durable event log did, and what it left. The
 * sweep is capped per pass, so `pruned` and `eligible` are different numbers
 * and both are reported: a report that said only how many rows went could not
 * tell "the backlog is cleared" from "the cap was hit" (scar §2.4).
 */
export interface EventPruneReport extends PruneReport {
  /** Unlatched rows older than the window when the sweep began. */
  eligible: number;
  /** Eligible rows the cap left for the next pass. Zero means the window is clean. */
  remaining: number;
  /** The per-pass cap in force, or null when the caller set none. */
  limit: number | null;
}

/**
 * The durable event log, counted without being touched — what `verify` prints
 * and what an observer's cycle report is computed from. Every number here is a
 * read; nothing in it crosses the write seam.
 */
/** What `eventLog` selects on. `order` defaults to `"asc"` (oldest first). */
export interface EventLogFilter {
  name?: string;
  ref?: string;
  sinceDay?: number;
  limit?: number;
  order?: "asc" | "desc";
}

/**
 * One row of `eventCounts`: a name, how many rows of it the window holds, and
 * the newest of them — by wall clock (`newestAt`, epoch ms), by lived day
 * (`newestDay`) and by `seq` (`newestSeq`, the one to fetch it by). Each is the
 * MAX of its own column, so they need not come from the same row if a clock
 * was ever set back; `newestSeq` is the one that is always the last appended.
 */
export interface EventCount {
  name: string;
  count: number;
  newestAt: number;
  newestDay: number;
  newestSeq: number;
}

export interface EventLogCensus {
  /** Rows held, latched and unlatched. */
  rows: number;
  /** Rows carrying a `dedup_key` — records, kept at any age. */
  latched: number;
  /** The oldest row's lived day and wall-clock instant, or null on an empty log. */
  oldestDay: number | null;
  oldestAt: number | null;
  newestDay: number | null;
  /** `livedDay - retentionDays`: rows with `day` strictly below it are past the window. */
  cutoffDay: number;
  retentionDays: number;
  /** Unlatched rows past the window — what the next sweep would delete, before its cap. */
  eligible: number;
  /** Latched rows past the window — kept by kind, and counted so "kept" is a number. */
  latchedPastCutoff: number;
}

export interface RebuildReport {
  indexed: number;
  skippedDenied: number;
  /**
   * Rows that are canonical but not live — archived, or a superseded head. The
   * text index is the index OF THE LIVE STORE (`cache.ts#deindexDoc`), so a
   * rebuild reproduces exactly what `archive`/`supersede` maintain. COUNTED,
   * not silent: `counterparts verify --rebuild` accounts for every canonical
   * row, and a skip that did not appear in the arithmetic would read as a
   * mismatch (I13).
   */
  skippedArchived: number;
  unrecomputed: number;
  /** Contract §5 G8: what rebuild cannot recompute is DECLARED, with owner + repair. */
  declared: { what: string; owner: string; repair: string }[];
  /** Vectors kept across the rebuild (`keepVectors`), and vectors dropped as
   *  no longer canonical — removed ids and orphans. Both zero by default. */
  keptVectors: number;
  droppedVectors: number;
}

export interface RebuildOptions {
  /**
   * Re-index the TOKEN side without dropping `embeddings`.
   *
   * Off by default, because the default is the older and louder claim: box 3 is
   * rebuildable and a rebuild rebuilds it. It exists because that claim prices
   * the four tables the same when they are not — a vector costs a paid network
   * call and a console with no embedder cannot replace one at any price
   * (`adapters/cli/NOTES.md`, 2026-09-04, the follow-up filed by PR #43's
   * review). With it on, a vector whose memory is still canonical survives, a
   * vector for a removed or orphaned id is deleted, and a row whose embedder
   * misses keeps the vector it had instead of counting as `unrecomputed`.
   *
   * **A row that already has a vector is not re-embedded**, even when an
   * embedder is wired: keep means keep, and the caller that wants fresh vectors
   * wants a plain `rebuildCache()`. Rows with NO vector are embedded as usual.
   */
  keepVectors?: boolean;
}

export interface EdgeInput {
  src: string;
  dst: string;
  weight: number;
  day: number;
}

export interface ProspectiveInput {
  memoryId: string;
  windowKey: string;
  eventDate: string;
  precision: "day" | "month" | "year";
  state: "armed" | "fired" | "suppressed" | "expired";
  fires?: number;
  lastFiredDay?: number | null;
}

/**
 * One per-session gate record (SEAMS item B). A ROW, never a re-serialized
 * document: two writers on one session each insert their own record, so a late
 * `resolveUse()` can no longer drop a turn's `recall()` records (scar §2.1).
 */
export interface GateRecordInput {
  sessionId: string;
  /** `surfaced` / `credited` (recall), `window` (prospective), `scalar` (row state). */
  kind: string;
  /** Memory id, window key, or — for `scalar` — the field name. */
  ref: string;
  turn: number;
  lastDay: number;
  tier?: string | null;
  /** False when the memory arrived only through ambiguous handles (recall §9 G5). */
  trains?: boolean | null;
  /** JSON for `scalar` records. Never body text (§5 G10). */
  value?: string | null;
}

/**
 * One durable event (SEAMS item K). Content-BY-REFERENCE: ids, hashes, counts,
 * scores, kinds, tiers — never body text, never a user turn.
 *
 * `dedupKey` is the replay latch: an event carrying one lands AT MOST ONCE, ever
 * (sleep §5 G3 — "every day-gated concern is idempotent under replay"), and
 * `appendEvent` returns 0 when the latch held. Telemetry omits it and accumulates.
 */
export interface EventInput {
  name: string;
  day: number;
  ref?: string | null;
  dedupKey?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * THE TWO SCHEMA STAMPS AS THEY STAND ON DISK RIGHT NOW — box 2's
 * `meta.schemaVersion` and box 3's `cache_meta.schemaVersion`, each exactly as
 * written (a string), or null when the row is not there.
 *
 * Read by `Store.schemaVersions()`, which exists for ONE caller shape: a process
 * that opened this store long ago and has to ask, before it touches anything,
 * whether a newer build has migrated it since. That is the MCP server — the one
 * long-lived process a host starts once per session and never restarts on its
 * own (the MCP adapter's schema gate; LAUNCH-STATUS I36). The core names no
 * adapter, so the pointer is in words.
 */
export interface SchemaVersions {
  readonly store: string | null;
  readonly cache: string | null;
}

export interface RankingRow {
  id: string;
  strength: number;
  band: Band;
  day: number;
}

/**
 * One removed memory, as it survives: an address, what family it belonged to,
 * what it WAS (protected? identity band?), and counts of what the chase took.
 * No title, no body, no content hash — the same rule as the record (§16 G9).
 */
export interface Tombstone {
  readonly id: string;
  readonly type: ProseType;
  readonly kind: Kind;
  readonly band: Band;
  /** Permanent ink at the moment it was removed — why it still shows in the list. */
  readonly wasProtected: boolean;
  readonly wasPromotedIdentity: boolean;
  readonly supersededBy: string | null;
  readonly stage: RemovalNote["stage"];
  readonly at: number;
  /** True while a stripped skeleton row survives to carry lineage pointers. */
  readonly rowSurvives: boolean;
  readonly chased: {
    readonly versions: number;
    readonly edges: number;
    readonly prospective: number;
    readonly gateRows: number;
  };
}

/** No body, no content hash — hashing low-entropy content leaks it (§16 G9). */
export interface RemovalNote {
  memoryId: string;
  stage: "requested" | "dark" | "chased" | "complete";
  actor: string;
  reason?: string;
}

/**
 * Every method that can change durable state. The totality test asserts this list
 * equals the set of sites that consult the observer predicate, and that each one
 * refuses under observer (observer-mode.md G6: every stand-down is observable).
 */
/**
 * The backfill's give-up counter: `embed.failed.<id>` in box 2's meta, and the
 * number of ITEM-ATTRIBUTABLE failures after which `missingVectors` stops
 * offering that id.
 *
 * **Only the failures the provider blamed on the item itself may move it** — a
 * 400 the bisector narrowed down to one input (`ChunkFailure.item`). A 429, a
 * 5xx, a dropped socket, an aborted watchdog or a malformed body says nothing
 * about WHICH input is bad, and counting those was I33 inverted: three bad
 * boundaries in a row would retire a whole healthy window and `unembeddedCount`
 * — the coverage watch — would then read COMPLETE while those memories stayed
 * blind. Three rather than one because even a 400 can be answered for a reason
 * that is not the text.
 *
 * Written by whoever runs the backfill (`adapters/claude-code/vectors.ts`),
 * cleared the moment an id embeds, and cleared wholesale by
 * `counterparts verify --retry-skipped` — which is the remedy a repaired title
 * needs, because a skipped id is never offered again and so can never clear
 * itself. Meta keys only — no schema bump (precedent: `sleep.pruned.<id>`).
 */
export const EMBED_FAILED_PREFIX = "embed.failed.";
export const EMBED_SKIP_AFTER = 3;

/**
 * THE DAY THIS STORE CAME INTO EXISTENCE — one meta row, written once.
 *
 * The finding (new-user findings #8, 2026-09-21): `doctor`'s Authorship line
 * reports a seven-day window and printed `2026-09-15→2026-09-21` on a store made
 * that morning — a week the store did not exist for. A reading that names a
 * window it could not have observed is the diagnostic telling its reader
 * something that is not so, which is the one thing a diagnostic may not do.
 *
 * Nothing in the store knew its own age. `livedDay` is the PHYSICS clock (the
 * worker advances it, and it is 0 on a store whose worker has never run),
 * `lastActiveDate` is empty until a boundary, and the meta table carried no date
 * at all. `store.started` exists but only `start-fresh` writes it.
 *
 * **Written only by the open that CREATED the file** (`fresh`, and never under
 * observer), and `INSERT OR IGNORE` on top of that, so a store that was already
 * there is never stamped with a day it did not begin on — the same rule
 * `install` keeps for `store.started`. A store made before this key existed
 * simply does not have it, and every reader must treat it as unknown rather than
 * as "today".
 */
export const STORE_CREATED_KEY = "store.created";

export const WRITE_METHODS = [
  "put",
  "putMany",
  "revise",
  "supersede",
  "archive",
  "updatePhysics",
  "reinforce",
  "setBand",
  "link",
  "linkMany",
  "setProspective",
  "advanceClock",
  "setMeta",
  "setMetaMany",
  "setGateRecords",
  "pruneGateSessions",
  "appendEvent",
  "pruneEvents",
  "setRanking",
  "pruneSupersededVersions",
  "appendRemovalRecord",
  "rebuildCache",
  "pruneDeadIndex",
  "embedOne",
] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];

/**
 * THE READ HALF OF `Store`, as a type (dashboard INTERFACE-GAPS §4) — so code
 * that only observes can be typed against it and "an instrument cannot reach a
 * write method" is a compile error rather than a source scan.
 *
 * Defined by SUBTRACTION from `WRITE_METHODS`, not by listing the reads: the
 * totality test holds that list equal to the set of sites that enter `mutate`,
 * so a write method added tomorrow drops out of this type the day it is
 * listed, and a read added tomorrow appears in it with no edit here.
 *
 * Two more are left out though neither is a durable write, because neither is
 * a reader's to call: `close()` ends a handle the reader does not own (and on a
 * writable handle it folds the write-ahead log — see `close`), and
 * `guardWrites()` installs or REMOVES the guard a composition root put on the
 * handle. `Omit` over a class keeps only its public members, and a `Store` is
 * assignable to this type, so a real handle passes wherever one is asked for.
 *
 * A type, not a wrapper: it narrows what a caller can NAME, and a cast gets
 * round it. The stance (`observer: true`) is still what the seam refuses on.
 */
export type ReadOnlyStore = Omit<Store, WriteMethod | "close" | "guardWrites">;

const MAX_CHAIN = 32;
const EVENT_RING = 500;

/**
 * The DURABLE row an open writes when the identity check changed something
 * (a reset, a new hold, an adoption, a released hold). Box 2's event log, so
 * doctor and tomorrow can read what the open did to box 3's vectors.
 */
export const EMBEDDER_RECONCILED_EVENT = "store.embedder.reconciled";

/** Rows per box-3 transaction in the at-open inline refill. CAL. */
const REFILL_BATCH = 500;
/**
 * Wall budget for the at-open inline refill, checked between batches. CAL:
 * measured 2026-09-23 (store NOTES) — a static table refills ~a thousand
 * memories in well under this, and the worker's backfill finishes a larger
 * store at the next boundary.
 */
const REFILL_BUDGET_MS = 1500;

/** An `EmbedderVerdict` as telemetry: tags and counts, never text. */
function verdictData(v: EmbedderVerdict): Record<string, string | number | boolean | null> {
  switch (v.kind) {
    case "none":
      return { kind: v.kind };
    case "tagged":
      return { kind: v.kind, tag: v.tag, adopted: v.adopted };
    case "reset":
      return { kind: v.kind, from: v.from, to: v.to, dropped: v.dropped };
    case "held":
      return { kind: v.kind, recorded: v.recorded, configured: v.configured, rows: v.rows };
    case "match":
      return v.released === true ? { kind: v.kind, tag: v.tag, released: true } : { kind: v.kind, tag: v.tag };
    case "cache-ahead":
      return { kind: v.kind, found: v.found, expected: v.expected };
    case "deferred":
      return { kind: v.kind, reason: v.reason };
  }
}

/** What `list()` and `countMemories()` both select on — one filter, one WHERE. */
export interface MemoryFilter {
  type?: ProseType;
  kind?: Kind;
  band?: Band;
  archived?: boolean;
  /**
   * WHO WROTE IT — the mint-source doctrine's column (`authored`, `fallback`,
   * `episode`, `migrated`). Nullable in the schema on purpose, so a filter on a
   * source never matches a row that predates the doctrine, which is what a
   * caller asking "how many did the author write" wants.
   */
  source?: string;
  /**
   * BORN ON OR AFTER this calendar date, `YYYY-MM-DD` — a string comparison,
   * which is exact for that spelling. Undated rows carry `learned_on = ''`
   * (`self/briefing.ts`) and are excluded by the same comparison, which is
   * right: a row with no date is not a row born in a window.
   */
  learnedOnFrom?: string;
}

function memoryWhere(filter: MemoryFilter): { clause: string; args: (string | number)[] } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter.kind) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  if (filter.band) {
    where.push("band = ?");
    args.push(filter.band);
  }
  if (filter.archived !== undefined) {
    where.push("archived = ?");
    args.push(filter.archived ? 1 : 0);
  }
  if (filter.source !== undefined) {
    where.push("source = ?");
    args.push(filter.source);
  }
  if (filter.learnedOnFrom !== undefined) {
    where.push("learned_on >= ?");
    args.push(filter.learnedOnFrom);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}

export class Store {
  readonly dir: string;
  readonly observer: boolean;
  readonly retentionDays: number;
  private readonly ops: Db;
  private readonly cache: Db;
  private readonly embed: Embedder | undefined;
  /**
   * The identity this handle writes and ranks under — `opts.embed.identity`,
   * never under observer. Kept past open because the at-open check is not
   * enough for a handle that lives all session (re-review MAJOR A): every
   * vector write and every ranking re-reads the file's claim against it.
   */
  private readonly identity: EmbedderIdentity | undefined;
  /**
   * What the at-open identity check found (cache v5). `none` when this process
   * configured no identified embedder. `held` means box 3 holds another paid
   * model's vectors and this handle neither writes vectors nor ranks against
   * them until the owner confirms the drop. `cache-ahead` means box 3 was
   * written by a newer build: the same two refusals, and the version is left
   * as found.
   */
  readonly embedderVerdict: EmbedderVerdict;
  /** The provenance clock (§I7). The ONE `Date.now` in this file is its default. */
  private readonly nowFn: () => number;
  private readonly onEvent: ((e: StoreEvent) => void) | undefined;
  private readonly ring: StoreEvent[] = [];

  private constructor(opts: StoreOptions) {
    // The guard runs on EVERY path, explicit or defaulted — an explicit `dir`
    // reaching mkdirSync unchecked is how a test once deposited a skeleton
    // inside the live v1 store (found by the caller-universality build, fixed
    // at this root the same day).
    this.dir = assertSafeDataDir(opts.dir ?? dataDir());
    this.observer = isObserver(opts);
    this.retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.embed = opts.embed;
    this.nowFn = opts.now ?? Date.now;
    this.onEvent = opts.onEvent;

    // ── THE PRE-ROWS REFUSAL, AND IT IS THE FIRST THING THAT HAPPENS ───────
    //
    // Before `fresh`, before the first `mkdirSync`, before `openOperational`,
    // before `assertLayout` — because every one of those writes something, and
    // the whole promise of this refusal is that a store written by an older
    // floor is left BYTE-IDENTICAL by an attempt to open it.
    //
    // The hazard it closes is the one thing in this rebuild that could destroy
    // the owner's live memory. `openOperational` migrates any store below
    // `SCHEMA_VERSION`; a v5 store reaching it would get `body` NULL on every
    // row while its words sat in ~16,000 markdown files this build cannot see,
    // and it would then be stamped v6 — unreadable by the build that CAN read
    // it. There is no migration and there is not going to be one (owner ruling
    // 6): the cut-over carries nothing and he starts as a new user.
    //
    // ORDER MATTERS TWICE OVER. `assertLayout()` would also refuse a v5 store,
    // on the unclassified `prose/` — but only after the database had been
    // opened and a blank `counterparts.sqlite` minted beside the old one, and a
    // refusal that names the layout instead of the floor is the wrong sentence
    // for somebody looking at three weeks of memory.
    //
    // It reads FILENAMES, never the old database (`preRowsMarkersIn`): since F1
    // the live store is in WAL, so an open-and-close to read its schema version
    // could checkpoint and remove its `-wal` — moving the bytes of the store
    // this exists to leave alone. `openOperational` carries the SECOND lock,
    // for a v5 database wearing the v6 name, where the file is already open and
    // that argument no longer applies.
    const preRows = preRowsMarkersIn(this.dir);
    if (preRows.length > 0) {
      throw new StoreError("STORE_PRE_ROWS", {
        dir: this.dir,
        // ALL of them, not the first: a refusal that named only
        // `operational.sqlite` never mentioned the 16,000 files under `prose/`,
        // which is the part the owner would want named.
        found: preRows.join(", "),
        expected: SCHEMA_VERSION,
        ...preRowsRemedy(this.dir, preRows),
      });
    }

    // AN INSTRUMENT WRITES NOTHING AT OPEN when there is a store to read.
    //
    // The old constructor ran the DDL and four meta upserts on every open,
    // whatever the stance — and a write at open takes SQLite's write lock, which
    // is how a live `counterparts backup` threw "database is locked" while a
    // session held an open transaction (live-verify 2026-08-25; CLI CONTRACT §5
    // G8 says a backup never throws). An up-to-date store now opens clean, and a
    // store that is a schema BEHIND refuses under observer by name rather than
    // migrating itself out from under the process that owns it.
    //
    // An ABSENT store refuses under observer too (cli INTERFACE-GAPS §7, closed
    // 2026-08-26). There is no lock to contend for there — but "an instrument
    // that MINTS a data dir by looking at one is a wart" (`statusCommand`), and
    // a stood-down hook with an unreadable config was exactly the caller that
    // would quietly deposit a skeleton store on a machine that had none. Same
    // named refusal as the schema-behind case: to a reader, "not created yet"
    // and "not migrated yet" are one condition — nothing here to read.
    const fresh = !existsSync(paths.operational(this.dir));
    if (this.observer && fresh) {
      throw new StoreError("STORE_UNINITIALIZED", {
        path: paths.operational(this.dir),
        expected: SCHEMA_VERSION,
      });
    }
    // ONE DIRECTORY, either way: box 3's. `prose/`, `versions/` and `tmp/` went
    // with the floor — the canonical box is a single file SQLite makes itself,
    // and there is nothing left to stage. Box 3's container is made even under
    // observer, and only because it is DECLARED rebuildable: an instrument
    // needs somewhere to open the cache, and materializing the cache's own
    // directory changes no canonical state and takes no canonical lock.
    mkdirSync(paths.cacheDir(this.dir), { recursive: true });
    this.ops = openOperational(paths.operational(this.dir), {
      initialize: !this.observer,
      retentionDays: this.retentionDays,
    });
    this.cache = openCache(paths.cache(this.dir));
    // THE AT-OPEN IDENTITY CHECK (cache v5, roadmap C1). Once per open, never
    // per call, and never under observer: an instrument has no embedder, and
    // "a recorded identity with no configured embedder" keeps the rows as they
    // are.
    //
    // A cache from a NEWER build is checked first and wins over everything:
    // no reconcile (it could drop rows or write a tag), no vectors written, no
    // ranking — whatever this process configured. Named, never silent.
    //
    // A HOLD IS THE FILE'S, NOT THE HANDLE'S (review of #190, MAJOR 1): a
    // handle with no identity — the MCP server's, the dashboard's, the
    // console's — reads the durable marker and refuses to rank exactly as the
    // handle that wrote it does. Either way a held or ahead handle has its
    // embedder withdrawn, so no vector is written beside another model's.
    const identity = this.observer ? undefined : opts.embed?.identity;
    this.identity = identity;
    const ahead = cacheAhead(this.cache);
    const held = ahead === null && identity === undefined ? heldEmbedder(this.cache) : null;
    // A DECISION that lost box 3's write lock past the busy timeout costs the
    // tag for this open, never the open (re-review NIT 1): `deferred`, the
    // embedder withdrawn, and the next open decides again.
    const reconcile = (id: EmbedderIdentity): EmbedderVerdict => {
      try {
        return reconcileEmbedder(this.cache, id);
      } catch (err) {
        if (!isLocked(err)) throw err;
        return { kind: "deferred", reason: "locked" };
      }
    };
    this.embedderVerdict =
      ahead !== null
        ? { kind: "cache-ahead", found: ahead.found, expected: ahead.expected }
        : identity !== undefined
          ? reconcile(identity)
          : held !== null
            ? {
                kind: "held",
                recorded: recordedEmbedder(this.cache)?.tag ?? null,
                configured: held,
                rows: embeddingCount(this.cache),
                fresh: false,
              }
            : { kind: "none" };
    if (
      this.embedderVerdict.kind === "held" ||
      this.embedderVerdict.kind === "cache-ahead" ||
      this.embedderVerdict.kind === "deferred"
    ) {
      this.embed = undefined;
    }
    if (this.embedderVerdict.kind === "cache-ahead") {
      this.emit("cache.schema.ahead", undefined, verdictData(this.embedderVerdict));
    } else if (this.embedderVerdict.kind !== "none" && this.embedderVerdict.kind !== "match") {
      this.emit("cache.embedder.reconciled", undefined, verdictData(this.embedderVerdict));
    }
    // THE DAY THIS STORE BEGAN (`STORE_CREATED_KEY`, new-user finding 8). Only
    // the open that CREATED the file writes it, and `OR IGNORE` on top of that:
    // a store that was already here must never be stamped with a day it did not
    // begin on. Under observer nothing is written at all — an instrument that
    // minted this row would be writing at open, which is the rule two comments
    // up. The provenance clock, so a seeded test dates it as it dates everything
    // else.
    if (fresh && !this.observer) {
      this.ops.run(
        "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
        STORE_CREATED_KEY,
        dateOf(this.nowFn()),
      );
    }
    // The owner-op capability. Handed to the seam module, never to a caller:
    // holding a Store gives you no way to destroy anything, and `ownerMutate`
    // routes the chase through the same stance check every write crosses.
    grantOwnerOps(this, {
      dir: this.dir,
      ownerMutate: (site, fn) => {
        this.assertWritable(site);
        return this.ops.transaction(() => fn(this.ops));
      },
      rawRow: (id) => this.row(id),
      isDenied: (id) => this.isDenied(id),
      // The narrowest possible route to box 3, and the LEXICAL half only: it
      // rewrites `doc_tokens` / `doc_lens` for one id from that id's own prose,
      // and leaves the `embeddings` row exactly where it is (`indexDoc` writes a
      // vector only when it is HANDED one, and it is not handed one here). A
      // restore must never make a paid embedding call, and it must never drop a
      // vector it cannot recompute.
      //
      // It exists because `archive()` is on its way to DEINDEXING (PR #64,
      // `overnight/df-live-rows`, counts document frequency over live rows by
      // removing archived rows from the index). Without this, whichever of the
      // two lands second leaves `unarchiveMerged` restoring a row that is live,
      // listed in `beliefs(entity)`, and invisible to lexical recall — with no
      // cheap repair, since a cache rebuild without an embedder drops every
      // vector on the store. Harmless on a master where `archive()` still
      // leaves the index alone: re-indexing an already-indexed row from its own
      // prose is a write of the same rows.
      reindexLexical: (id) => {
        const row = this.row(id);
        if (row === undefined) return;
        indexDoc(this.cache, id, indexTextOf(row.title, row.body));
      },
    });
    this.assertLayout();
    this.afterReconcile(identity);
  }

  /**
   * What an open does AFTER the identity check wrote something — and only then;
   * the steady state (a match, `none`, a standing hold) writes nothing here.
   *
   *   1. **A durable row** (`EMBEDDER_RECONCILED_EVENT`) for every transition:
   *      a reset (and how many vectors it dropped), a NEW hold (with the two
   *      exits), an adoption, a released hold. Through box 2's event log, not
   *      only the in-process ring — the hook's composition root passes no
   *      `onEvent`, and a drop nobody can read tomorrow is the §2.4 failure.
   *   2. **The skip list starts over for a new identity** (review MINOR 3): an
   *      id the old embedder gave up on (a Voyage 400, a table with no token
   *      for an emoji) is offered to the new one. `embed.failed.<id>` counters
   *      are not keyed by identity, so a reset is when they stop meaning
   *      anything.
   *   3. **Inline refill**, for an embedder that can: every live memory is
   *      missing its vector and a static table computes them in-process for
   *      nothing. The tag went down FIRST (inside `reconcileEmbedder`), so a
   *      process that dies part-way leaves rows that all match their tag, and
   *      the worker's backfill finishes the rest.
   */
  private afterReconcile(identity: EmbedderIdentity | undefined): void {
    if (this.observer) return;
    const v = this.embedderVerdict;
    const newIdentity = v.kind === "reset" || (v.kind === "tagged" && v.tag !== null && v.adopted === 0);
    const durable =
      v.kind === "reset" ||
      v.kind === "deferred" ||
      (v.kind === "held" && v.fresh) ||
      (v.kind === "tagged" && v.adopted > 0) ||
      (v.kind === "match" && v.released === true);
    if (durable) {
      try {
        this.appendEvent({
          name: EMBEDDER_RECONCILED_EVENT,
          day: this.livedDay(),
          payload: { ...verdictData(v), ...(v.kind === "held" ? { exits: heldExits(v.recorded) } : {}) },
        });
      } catch {
        // A lost lock costs the row, never the open (§5 G2's spirit).
      }
    }
    if (newIdentity) {
      try {
        const moves: [string, string][] = [];
        for (const [key, value] of this.metaWithPrefix(EMBED_FAILED_PREFIX)) {
          if (value !== "0") moves.push([key, "0"]);
        }
        if (moves.length > 0) this.setMetaMany(moves);
      } catch {
        // Same bargain: the counters are a retry hint, not memory.
      }
    }
    if (identity?.rebuild === "inline" && (v.kind === "reset" || (v.kind === "tagged" && v.tag !== null))) {
      this.refillVectorsInline();
    }
  }

  static open(opts: StoreOptions = {}): Store {
    return new Store(opts);
  }

  close(): void {
    this.ops.close();
    this.cache.close();
  }

  /** Prepared once, on first use; see `schemaVersions`. */
  private schemaReads: { store: Statement; cache: Statement } | undefined;

  /**
   * THE SCHEMA STAMPS ON DISK NOW, read fresh on this store's own two
   * connections — two primary-key lookups, no transaction, no write, and
   * nothing that changes under observer.
   *
   * `SCHEMA_AHEAD` is decided ONCE, at open (`operational.ts#openOperational`),
   * and that is right for every process that opens a store and closes it again
   * within one event. It is not enough for one that stays open: a hook running
   * newer code can migrate the file underneath it, and nothing on the handle it
   * already holds would say so. This is how such a process asks.
   *
   * It SEES the other process's migration because neither read runs inside a
   * transaction: each one starts a fresh read on the connection and so reads
   * whatever was last committed, WAL or not. Prepared once and kept, so the
   * steady-state cost is two statement steps (measured, ~3 µs — the MCP
   * adapter's NOTES). It may THROW — a table another build dropped, a
   * disk that went away — and the caller decides what that means; the only
   * caller today refuses its tool rather than guess.
   */
  schemaVersions(): SchemaVersions {
    this.schemaReads ??= {
      store: this.ops.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'"),
      cache: this.cache.prepare("SELECT value FROM cache_meta WHERE key = 'schemaVersion'"),
    };
    return {
      store: this.schemaReads.store.get<{ value: string }>()?.value ?? null,
      cache: this.schemaReads.cache.get<{ value: string }>()?.value ?? null,
    };
  }

  // ── the seam ───────────────────────────────────────────────────────────────

  /**
   * The one place a write becomes durable. Stance first, transaction second: an
   * observer refuses before any staging, and a partial multi-row change is
   * impossible because box 2 rolls back as a unit.
   */
  private mutate<T>(site: WriteMethod, fn: () => T): T {
    this.assertWritable(site);
    return this.ops.transaction(fn);
  }

  /** `chaseRemoved` and `unarchiveMerged` are not Store methods — they are the
   *  owner-op seam's, and they cross the same stance check, which is why their
   *  site names are spelled here. */
  private assertWritable(site: WriteMethod | "chaseRemoved" | "unarchiveMerged"): void {
    if (this.observer) {
      // Telemetry is the deliberate exception: a stood-down instrument must be
      // distinguishable from a broken hook (observer-mode.md G5/G6, scar §2.4).
      this.emit("store.observer.standdown", undefined, { site });
      throw new StoreError("OBSERVER_REFUSED", { site });
    }
    // The caller's own check, when it installed one (`guardWrites`): AFTER the
    // stance, so an instrument's refusal stays the observer's, and BEFORE any
    // transaction, so a write it refuses has staged nothing.
    this.writeGuard?.(site);
  }

  /** The one slot `guardWrites` fills. */
  private writeGuard: ((site: string) => void) | null = null;

  /**
   * A CHECK RUN BEFORE EVERY WRITE THIS STORE MAKES — every `WRITE_METHODS` site
   * and the owner-op seam's, through `assertWritable`, after the stance check
   * and before the transaction. It refuses by THROWING; whatever it throws is
   * what the writer sees, and nothing has been staged.
   *
   * It exists for the one long-lived caller (2026-09-23, roadmap E, #187
   * re-review N5): the MCP server holds this store for a whole session while
   * the hooks, on a newer build, may migrate it. Its tools check the schema
   * stamps on entry, but a deposit can `await` (the embedder, at write time)
   * between that check and its writes; the guard re-reads the stamps at the
   * moment each write happens (`schemaVersions`, ~3 µs). One slot; null
   * removes it. The store itself decides nothing with it.
   */
  guardWrites(check: ((site: string) => void) | null): void {
    this.writeGuard = check;
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: StoreEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }

  /**
   * The provenance clock's instant, and the calendar date it falls on.
   *
   * TWO CLOCKS, and this is the second one. `livedDay()` above is the physics
   * clock — how much EXPERIENCE has passed, which is what decay and
   * consolidation run on. These two say WHEN IN THE WORLD, which is what a
   * memory's provenance is made of. A caller that wants "the date this store
   * thinks it is" asks here rather than reading the ambient clock, so a seeded,
   * replayed or migrated store dates its rows by the run it is replaying.
   *
   * UTC, like every other date this codebase writes (the hooks' own
   * `new Date().toISOString().slice(0, 10)`, `sleep/cycle.ts#todayDate`). Local
   * dating is a separate question with a separate answer; see NOTES 2026-09-05.
   */
  now(): number {
    return this.nowFn();
  }

  today(): string {
    return dateOf(this.nowFn());
  }

  /** Copies, ordered oldest first. Optionally filtered by name. */
  events(name?: string): StoreEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  /** Contract §5 G11: a top-level path nobody classified fails loudly. */
  assertLayout(): void {
    assertLayoutClassified(readdirSync(this.dir));
  }

  backupSet(): string[] {
    return LAYOUT.filter((e) => e.backup).map((e) => e.name);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  put(input: PutInput): string {
    const doc = this.mutate("put", () => this.insertOne(input));
    this.indexOne(doc);
    this.emit("store.put", doc.id, { type: doc.type, kind: input.kind, hash: hashText(doc.body) });
    return doc.id;
  }

  /**
   * Atomic by default: one bad input and NOTHING lands. `isolate: true` opts into
   * per-item persistence isolation (§16 G6) — the failure is logged and skipped and
   * the rest persist. Two different promises; the caller picks, out loud.
   */
  putMany(inputs: readonly PutInput[], opts: { isolate?: boolean } = {}): string[] {
    const landed = this.mutate("putMany", () => {
      const out: { doc: ProseDoc; input: PutInput }[] = [];
      for (const input of inputs) {
        try {
          // A SAVEPOINT PER ITEM under `isolate`, not a bare call. The insert
          // used to be preceded by a file stage that validated everything
          // first, so a throw happened before any row was written; now the
          // validation and the INSERT are in the same method, and a failure
          // after the INSERT — a constraint, a foreign key, anything a later
          // reviewer adds below it — would otherwise be swallowed here and
          // COMMITTED by the outer transaction. `Db.transaction` nests as
          // SAVEPOINT / ROLLBACK TO, so per-item isolation is structural
          // (§16 G6) rather than a property of the current line order.
          out.push({ doc: this.isolatedInsert(input, opts.isolate === true), input });
        } catch (err) {
          if (!opts.isolate) throw err;
          this.emit("store.put.skipped", input.id, {
            reason: err instanceof StoreError ? err.code : "UNKNOWN",
          });
        }
      }
      return out;
    });
    for (const s of landed) {
      this.indexOne(s.doc);
      this.emit("store.put", s.doc.id, {
        type: s.doc.type,
        kind: s.input.kind,
        hash: hashText(s.doc.body),
      });
    }
    return landed.map((s) => s.doc.id);
  }

  /** `insertOne`, inside its own savepoint when the caller asked for isolation. */
  private isolatedInsert(input: PutInput, isolate: boolean): ProseDoc {
    return isolate ? this.ops.transaction(() => this.insertOne(input)) : this.insertOne(input);
  }

  /**
   * In-place content revision. The prior version is written in the SAME
   * transaction as the update (§16 G4) — not before it, because there is no
   * longer a before: the version is a row, not a file copied out of the way.
   *
   * `learnedOn` / `happenedOn` are the PROVENANCE half, and they travel this same
   * door on purpose (§I7, `NOTES.md` 2026-09-05): correcting a date is a change to
   * canonical content, so it keeps the prior version exactly the way a body change
   * does — constitution 7, nothing is silently overwritten and the old date stays
   * readable in the version. **That is why `versions` carries `learned_on` and
   * `happened_on` of its own**, which the floor plan did not ask for: with the
   * dates read off the live row instead, one correction would have silently
   * rewritten every version behind it.
   */
  revise(
    id: string,
    patch: {
      body?: string;
      title?: string;
      meta?: Record<string, unknown>;
      learnedOn?: string;
      happenedOn?: string;
      reason?: string;
    },
  ): number {
    const { doc, seq, hash } = this.mutate("revise", () => {
      const row = this.requireRow(id);
      const prior = this.docOf(row);
      const seq = row.revision + 1;
      // THE PRIOR VERSION, WORDS AND ALL, IN THE SAME TRANSACTION. It used to be
      // a file copied into `versions/<id>/` before the new text was staged, with
      // a `wx` collision loop and a crash window between the two; it is now a
      // row written beside the update, so "an overwrite keeps the prior version"
      // is a property of the transaction rather than of the ordering (§5 G5).
      this.ops.run(
        `INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        id,
        seq,
        patch.reason ?? "revise",
        this.livedDay(),
        this.nowFn(),
        row.content_hash,
        row.title,
        row.body,
        row.meta,
        row.learned_on,
        row.happened_on,
      );
      const next: ProseDoc = {
        ...prior,
        body: patch.body ?? prior.body,
        meta: patch.meta ? { ...prior.meta, ...patch.meta } : prior.meta,
      };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.learnedOn !== undefined) next.learnedOn = patch.learnedOn;
      if (patch.happenedOn !== undefined) next.happenedOn = patch.happenedOn;
      // THE SAME RULE AS `put`, through the same function. `patch.body ?? ...`
      // accepts `""` happily, and on this floor that would write the one state
      // no write path may produce — a row whose hash names words its body no
      // longer holds, which every read answers as `MEMORY_BODY_MISSING` and
      // which takes the next session's `Schemas.open` down on a schema row.
      // Whitespace-only and a lone surrogate go through it too.
      next.body = bodyForStorage(next.body, id);
      const nextHash = hashText(next.body);
      this.ops.run(
        `UPDATE memories
            SET content_hash = ?, revision = ?, title = ?, body = ?, meta = ?,
                confidential = ?, learned_on = ?, happened_on = ?
          WHERE id = ?`,
        nextHash,
        seq,
        next.title ?? null,
        next.body,
        serializeMeta(next.meta, id),
        // RECOMPUTED, never carried: a revision that patches `meta` can turn
        // the confidentiality gate on or off, and a column that went stale
        // against its own truth table is a gate that fails open silently.
        confidentialByMeta(next.meta) ? 1 : 0,
        next.learnedOn,
        next.happenedOn ?? null,
        id,
      );
      return { doc: next, seq, hash: nextHash };
    });
    this.indexOne(doc);
    this.emit("store.revise", id, { seq, hash });
    return seq;
  }

  /**
   * Supersession: the new memory is born, the old one keeps its id, its prose, and
   * a forwarding address. `resolve(oldId)` follows it forever — the VERSION ROW is
   * what expires at H, not the ability to resolve (§5 G4, §16 G3).
   */
  supersede(oldId: string, input: PutInput, reason = "supersede"): string {
    const { doc, newId } = this.mutate("supersede", () => {
      const row = this.requireRow(oldId);
      const created = this.insertOne(input);
      // The version row carries a COPY of the head's words rather than a pointer
      // to the file both used to share. The head keeps its own row and its own
      // body too, so the text is held twice for as long as the version row
      // lives — the honest cost of rows over files, bounded by the 90-day
      // version prune (owner ruling 1). See `store/NOTES.md`.
      this.ops.run(
        `INSERT INTO versions
           (memory_id, seq, reason, version_day, archived_at, content_hash, successor_id,
            title, body, meta, learned_on, happened_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        oldId,
        row.revision + 1,
        reason,
        this.livedDay(),
        this.nowFn(),
        row.content_hash,
        created.id,
        row.title,
        row.body,
        row.meta,
        row.learned_on,
        row.happened_on,
      );
      this.ops.run(
        `UPDATE memories SET superseded_by = ?, archived = 1, archived_reason = ?, revision = ?
          WHERE id = ?`,
        created.id,
        reason,
        row.revision + 1,
        oldId,
      );
      return { doc: created, newId: created.id };
    });
    this.indexOne(doc);
    // The head leaves box 3 as the successor enters it. Box 2 keeps the row,
    // the prose and the forwarding address — this is the INDEX, and the index
    // is the index of the live store (`cache.ts#deindexDoc`).
    deindexDoc(this.cache, oldId);
    this.emit("store.supersede", oldId, { successor: newId, reason });
    return newId;
  }

  /** Archive is a state, not a deletion: the id stays resolvable (§4.2 G3). */
  archive(id: string, reason: string): void {
    this.mutate("archive", () => {
      this.requireRow(id);
      this.ops.run("UPDATE memories SET archived = 1, archived_reason = ? WHERE id = ?", reason, id);
    });
    // Out of the index, not out of the store: `read`, `resolve` and the version
    // chain are untouched. An archived row was never deliverable — `activate`
    // discards the hit — and while it stayed indexed it went on voting on
    // rarity against a live denominator (`cache.ts#deindexDoc`, I13).
    deindexDoc(this.cache, id);
    this.emit("store.archive", id, { reason });
  }

  /**
   * Physics-only bookkeeping. It never rewrites prose, which is why v1's
   * "strength-only exemption to archive-on-overwrite" is not ported: with physics in
   * box 2 the exemption is structural rather than a line-level diff (see NOTES.md).
   */
  updatePhysics(id: string, patch: Partial<MemoryPhysics>): void {
    this.mutate("updatePhysics", () => {
      this.requireRow(id);
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const put = (col: string, val: string | number | null) => {
        sets.push(`${col} = ?`);
        args.push(val);
      };
      if (patch.kind !== undefined) put("kind", patch.kind);
      if (patch.salience !== undefined) {
        put("novelty", patch.salience.novelty);
        put("relevance", patch.salience.relevance);
        put("emotional", patch.salience.emotional);
        put("predictive", patch.salience.predictive);
        put("claimed", patch.salience.claimed ?? null);
      }
      if (patch.birthDay !== undefined) put("birth_day", patch.birthDay);
      if (patch.uses !== undefined) put("uses", patch.uses);
      if (patch.lastUsedDay !== undefined) put("last_used_day", patch.lastUsedDay);
      if (patch.reinforcedDays !== undefined) put("reinforced_days", patch.reinforcedDays);
      if (patch.consolidated !== undefined) put("consolidated", patch.consolidated ? 1 : 0);
      if (patch.promotedIdentity !== undefined)
        put("promoted_identity", patch.promotedIdentity ? 1 : 0);
      if (patch.protected !== undefined) put("protected", patch.protected ? 1 : 0);
      if (patch.pressure !== undefined) put("pressure", patch.pressure);
      if (patch.lastChallengedDay !== undefined)
        put("last_challenged_day", patch.lastChallengedDay);
      if (sets.length === 0) return;
      this.ops.run(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
    });
    this.emit("store.physics", id, { fields: Object.keys(patch).join(",") });
  }

  /**
   * Persist one credited use. The crediting RULE is owned entirely by
   * physics.creditUse (§5.5 tier weights, birth-day / stale-day / same-day
   * refusals, distinct-day counting for §5.3 promotion) — the store applies the
   * verdict absolutely and adds no opinion of its own. One rule, one owner:
   * a second implementation of this arithmetic is exactly the divergence that
   * produced v1's "two clocks" fiction.
   */
  reinforce(id: string, day: number, tier: UseTier = "referenced"): CreditOutcome {
    const outcome = this.mutate("reinforce", () => {
      const row = this.requireRow(id);
      const verdict = creditUse(rowToPhysics(row), day, tier);
      if (verdict.credited) {
        this.ops.run(
          `UPDATE memories
              SET uses = ?, last_used_day = ?, reinforced_days = ?
            WHERE id = ?`,
          verdict.next.uses,
          verdict.next.lastUsedDay,
          verdict.next.reinforcedDays,
          id,
        );
      }
      return verdict;
    });
    this.emit("store.reinforce", id, {
      credited: outcome.credited,
      reason: outcome.reason,
      day,
      tier,
    });
    return outcome;
  }

  setBand(id: string, band: Band, day: number): void {
    this.mutate("setBand", () => {
      this.requireRow(id);
      this.ops.run("UPDATE memories SET band = ?, band_day = ? WHERE id = ?", band, day, id);
    });
    this.emit("store.band", id, { band, day });
  }

  link(edge: EdgeInput): void {
    this.mutate("link", () => {
      this.ops.run(
        "INSERT OR REPLACE INTO edges (src, dst, weight, last_day) VALUES (?, ?, ?, ?)",
        edge.src,
        edge.dst,
        edge.weight,
        edge.day,
      );
    });
    this.emit("store.link", edge.src, { dst: edge.dst, weight: edge.weight });
  }

  /** Multi-row and foreign-keyed: one bad endpoint rolls the whole batch back. */
  linkMany(edges: readonly EdgeInput[]): void {
    this.mutate("linkMany", () => {
      const st = this.ops.prepare(
        "INSERT OR REPLACE INTO edges (src, dst, weight, last_day) VALUES (?, ?, ?, ?)",
      );
      for (const e of edges) st.run(e.src, e.dst, e.weight, e.day);
    });
    this.emit("store.link", undefined, { count: edges.length });
  }

  setProspective(entry: ProspectiveInput): void {
    this.mutate("setProspective", () => {
      this.requireRow(entry.memoryId);
      this.ops.run(
        `INSERT OR REPLACE INTO prospective
           (memory_id, window_key, event_date, precision, state, fires, last_fired_day)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        entry.memoryId,
        entry.windowKey,
        entry.eventDate,
        entry.precision,
        entry.state,
        entry.fires ?? 0,
        entry.lastFiredDay ?? null,
      );
    });
    this.emit("store.prospective", entry.memoryId, {
      window: entry.windowKey,
      state: entry.state,
    });
  }

  /** The active-day clock (scar E8): days actually lived, not calendar days. */
  advanceClock(date: string): number {
    const day = this.mutate("advanceClock", () => {
      const last = this.getMeta("lastActiveDate") ?? "";
      if (last !== "" && date < last) {
        throw new StoreError("CLOCK_BACKWARDS", { date, last });
      }
      if (date === last) return this.livedDay();
      const next = this.livedDay() + 1;
      this.ops.run("UPDATE meta SET value = ? WHERE key = 'livedDay'", String(next));
      this.ops.run("UPDATE meta SET value = ? WHERE key = 'lastActiveDate'", date);
      return next;
    });
    this.emit("store.clock", undefined, { livedDay: day, date });
    return day;
  }

  setMeta(key: string, value: string): void {
    this.mutate("setMeta", () => {
      this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
    });
    this.emit("store.meta", undefined, { key });
  }

  /**
   * Many meta rows, ONE transaction and one ring line.
   *
   * `setMeta` in a loop is one write transaction — one lock acquisition — per
   * key, and the caller this exists for moves a whole window's worth of the
   * backfill's give-up counters at a boundary where the adapter has measured six
   * overlapping workers against a 5 s busy timeout (adapter `NOTES.md`, I33).
   * One `mutate` is one acquisition and rolls back as a unit: the same bargain
   * `linkMany` and `setRanking` already make, and the reason the ring gets a
   * count here rather than N identical `key` lines.
   *
   * Keys repeated within one call resolve last-wins, as `INSERT OR REPLACE` does
   * anywhere else. An empty list still crosses the stance check, because a
   * stand-down that depends on how much work there was is not a stand-down.
   */
  setMetaMany(entries: readonly (readonly [string, string])[]): void {
    this.mutate("setMetaMany", () => {
      for (const [key, value] of entries) {
        this.ops.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
      }
    });
    this.emit("store.meta", undefined, { count: entries.length });
  }

  // ── box 2: per-session gate state (SEAMS item B) ───────────────────────────

  /**
   * Upsert gate records. One transaction, one row per record — a writer replaces
   * only the records it names, so two processes in one session cannot drop each
   * other's (recall/INTERFACE-GAPS.md §1, scar §2.1).
   */
  setGateRecords(rows: readonly GateRecordInput[]): void {
    // Stance FIRST, then the empty check: an observer must refuse even a no-op
    // write, or the stand-down becomes conditional on the payload (G6).
    this.assertWritable("setGateRecords");
    if (rows.length === 0) return;
    this.ops.transaction(() => {
      const st = this.ops.prepare(
        `INSERT OR REPLACE INTO gate_session
           (session_id, kind, ref, turn, tier, trains, value, last_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        st.run(
          r.sessionId,
          r.kind,
          r.ref,
          r.turn,
          r.tier ?? null,
          r.trains === undefined || r.trains === null ? null : r.trains ? 1 : 0,
          r.value ?? null,
          r.lastDay,
        );
      }
    });
    this.emit("store.gate.records", undefined, { count: rows.length });
  }

  gateRecords(sessionId: string, kind?: string): GateSessionRow[] {
    return kind === undefined
      ? this.ops.all<GateSessionRow>(
          "SELECT * FROM gate_session WHERE session_id = ? ORDER BY kind, ref",
          sessionId,
        )
      : this.ops.all<GateSessionRow>(
          "SELECT * FROM gate_session WHERE session_id = ? AND kind = ? ORDER BY ref",
          sessionId,
          kind,
        );
  }

  /**
   * The retention sweep the meta keyspace could never have (recall's gap §1: "a
   * long-lived store accumulates one dead row per session forever"). Operational
   * state with a lifetime, swept on the active-day clock beside the version prune.
   */
  pruneGateSessions(): PruneReport {
    const report = this.mutate("pruneGateSessions", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM gate_session WHERE last_day < ?",
        cutoffDay,
      );
      this.ops.run("DELETE FROM gate_session WHERE last_day < ?", cutoffDay);
      return { pruned: doomed?.n ?? 0, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.gate.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay,
    });
    return report;
  }

  // ── box 2: the durable event log (SEAMS item K) ────────────────────────────

  /**
   * Append one event. Returns its seq, or 0 when a `dedupKey` latch refused a
   * repeat — the caller can tell "recorded" from "already recorded", which is
   * what replay idempotence needs to stay a fact rather than a hope.
   */
  appendEvent(input: EventInput): number {
    const seq = this.mutate("appendEvent", () => {
      this.ops.run(
        `INSERT OR IGNORE INTO events (at, day, name, ref, dedup_key, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        this.nowFn(),
        input.day,
        input.name,
        input.ref ?? null,
        input.dedupKey ?? null,
        input.payload === undefined || input.payload === null
          ? null
          : JSON.stringify(input.payload),
      );
      const row = this.ops.get<{ n: number }>("SELECT changes() AS n");
      if ((row?.n ?? 0) === 0) return 0;
      return this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq")?.seq ?? 0;
    });
    this.emit("store.event.appended", input.ref ?? undefined, {
      name: input.name,
      seq,
      deduped: seq === 0,
    });
    return seq;
  }

  /**
   * Oldest first by default, so a story reads in the order it happened.
   *
   * `order: "desc"` is NEWEST first (cli INTERFACE-GAPS §10): with a `limit`, an
   * ascending read is the OLDEST N rows, so "the newest row of this name" was not
   * a query — a caller that took `rows.at(-1)` off a full window was reading last
   * week. `eventLog({ name, order: "desc", limit: 1 })` is that row, exactly.
   * Rows come back in the order asked for; nothing is re-sorted after the LIMIT.
   */
  eventLog(filter: EventLogFilter = {}): EventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.name !== undefined) {
      where.push("name = ?");
      args.push(filter.name);
    }
    if (filter.ref !== undefined) {
      where.push("ref = ?");
      args.push(filter.ref);
    }
    if (filter.sinceDay !== undefined) {
      where.push("day >= ?");
      args.push(filter.sinceDay);
    }
    const sql =
      "SELECT * FROM events" +
      (where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`) +
      ` ORDER BY seq ${filter.order === "desc" ? "DESC" : "ASC"} LIMIT ?`;
    return this.ops.all<EventRow>(sql, ...args, filter.limit ?? 500);
  }

  /**
   * THE LOG COUNTED BY NAME, in SQL — one `GROUP BY`, no row leaves the
   * database (cli INTERFACE-GAPS §11, dashboard INTERFACE-GAPS §5).
   *
   * Sorted by name. Every name present in the window appears exactly once, so
   * this is also the distinct-name read: a writer that appended a name no
   * registry knows shows up here rather than going unlisted. A name with no
   * rows in the window is ABSENT, not zero — a caller rendering a vocabulary
   * looks its names up and reads a miss as never.
   *
   * `sinceDay` bounds on the LIVED-day column (`day >= ?`, as `eventLog` does);
   * `sinceAt` on the wall clock the row was written at (`at >= ?`, epoch ms).
   * Both may be given. Neither reads a payload: a count by a calendar date some
   * payloads carry (`adapters/fired.ts` dates rows by `payload.date`) is not a
   * column and is not answered here.
   *
   * READ-ONLY: never enters `mutate`, so an observer may ask it.
   */
  eventCounts(filter: { sinceDay?: number; sinceAt?: number } = {}): EventCount[] {
    const where: string[] = [];
    const args: number[] = [];
    if (filter.sinceDay !== undefined) {
      where.push("day >= ?");
      args.push(filter.sinceDay);
    }
    if (filter.sinceAt !== undefined) {
      where.push("at >= ?");
      args.push(filter.sinceAt);
    }
    const rows = this.ops.all<{ name: string; n: number; newest_at: number; newest_day: number; newest_seq: number }>(
      "SELECT name, COUNT(*) AS n, MAX(at) AS newest_at, MAX(day) AS newest_day, MAX(seq) AS newest_seq" +
        " FROM events" +
        (where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`) +
        " GROUP BY name ORDER BY name",
      ...args,
    );
    return rows.map((r) => ({
      name: r.name,
      count: r.n,
      newestAt: r.newest_at,
      newestDay: r.newest_day,
      newestSeq: r.newest_seq,
    }));
  }

  /** Every event name the log holds, sorted. `eventCounts()` without the counts. */
  eventNames(): string[] {
    return this.ops.all<{ name: string }>("SELECT DISTINCT name FROM events ORDER BY name").map((r) => r.name);
  }

  /**
   * Bounded retention — logs are telemetry, not canonical memory: "the one
   * system-path exception to no-deletion — bounded-retention logs"
   * (`docs/harvest/behavioral-spec.md` #17, v1's `pruneLogs` in `log-audit.md`
   * §3). Events carrying a `dedupKey` are KEPT regardless of age: they are the
   * replay latch, and sweeping one would let a replayed day re-append a record
   * the store already accounted for.
   *
   * `limit` caps the rows one call deletes, OLDEST FIRST by `seq`, so a pass on a
   * store that has never been swept cannot run long or hold the write lock across
   * a backlog: it takes the cap's worth and reports how much is left. Its caller
   * is `sleep/log.ts`, on the cycle's own budget; before 2026-09-05 nothing
   * called this at all (`sleep/NOTES.md` §13), and the window it documents was
   * a number the log was eligible for and never subject to.
   */
  pruneEvents(opts: { limit?: number } = {}): EventPruneReport {
    const limit = opts.limit === undefined ? null : Math.max(0, Math.floor(opts.limit));
    const report = this.mutate("pruneEvents", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const eligible =
        this.ops.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM events WHERE day < ? AND dedup_key IS NULL",
          cutoffDay,
        )?.n ?? 0;
      if (limit === null) {
        this.ops.run("DELETE FROM events WHERE day < ? AND dedup_key IS NULL", cutoffDay);
      } else {
        this.ops.run(
          `DELETE FROM events WHERE seq IN (
             SELECT seq FROM events WHERE day < ? AND dedup_key IS NULL
             ORDER BY seq ASC LIMIT ?)`,
          cutoffDay,
          limit,
        );
      }
      const pruned = this.ops.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
      return {
        pruned,
        eligible,
        remaining: eligible - pruned,
        limit,
        cutoffDay,
        retentionDays: this.retentionDays,
      };
    });
    this.emit("store.events.pruned", undefined, {
      count: report.pruned,
      eligible: report.eligible,
      remaining: report.remaining,
      limit: report.limit,
      cutoffDay: report.cutoffDay,
      retentionDays: report.retentionDays,
    });
    return report;
  }

  /**
   * The log counted, not touched. READ-ONLY by construction — it never calls
   * `mutate`, so an observer may ask it (the cycle's read-only report does) and
   * `counterparts verify` prints it without opening a writable store.
   */
  eventLogCensus(): EventLogCensus {
    const cutoffDay = this.livedDay() - this.retentionDays;
    const totals = this.ops.get<{
      total: number;
      latched: number;
      oldest_day: number | null;
      oldest_at: number | null;
      newest_day: number | null;
    }>(
      `SELECT COUNT(*) AS total,
              COUNT(dedup_key) AS latched,
              MIN(day) AS oldest_day,
              MIN(at) AS oldest_at,
              MAX(day) AS newest_day
         FROM events`,
    );
    const past = this.ops.get<{ eligible: number; latched: number }>(
      `SELECT COUNT(*) - COUNT(dedup_key) AS eligible,
              COUNT(dedup_key) AS latched
         FROM events WHERE day < ?`,
      cutoffDay,
    );
    return {
      rows: totals?.total ?? 0,
      latched: totals?.latched ?? 0,
      oldestDay: totals?.oldest_day ?? null,
      oldestAt: totals?.oldest_at ?? null,
      newestDay: totals?.newest_day ?? null,
      cutoffDay,
      retentionDays: this.retentionDays,
      eligible: past?.eligible ?? 0,
      latchedPastCutoff: past?.latched ?? 0,
    };
  }

  // ── box 3: the ranking cache (SEAMS item J) ────────────────────────────────

  /**
   * Materialize `strength(m, d)` / `band(m, d)` into box 3. Box 3 only: nothing
   * here is truth, and `rebuildCache()` drops it with the rest of the cache. A
   * replayed day is a no-op by construction — same state, same day, same number.
   */
  setRanking(rows: readonly RankingRow[]): void {
    this.assertWritable("setRanking");
    if (rows.length === 0) return;
    this.cache.transaction(() => {
      const st = this.cache.prepare(
        "INSERT OR REPLACE INTO ranking (memory_id, strength, band, day) VALUES (?, ?, ?, ?)",
      );
      for (const r of rows) st.run(r.id, r.strength, r.band, r.day);
    });
    this.emit("store.ranking", undefined, { count: rows.length });
  }

  ranking(id: string): RankingRow | undefined {
    const row = this.cache.get<{ memory_id: string; strength: number; band: string; day: number }>(
      "SELECT * FROM ranking WHERE memory_id = ?",
      id,
    );
    return row === undefined
      ? undefined
      : { id: row.memory_id, strength: row.strength, band: row.band as Band, day: row.day };
  }

  rankingAll(): Map<string, RankingRow> {
    const out = new Map<string, RankingRow>();
    for (const row of this.cache.all<{
      memory_id: string;
      strength: number;
      band: string;
      day: number;
    }>("SELECT * FROM ranking")) {
      out.set(row.memory_id, {
        id: row.memory_id,
        strength: row.strength,
        band: row.band as Band,
        day: row.day,
      });
    }
    return out;
  }

  /**
   * Bounded versioning (contract §4): superseded-version rows older than H lived
   * days go. Every discard reports what and how much (scar §2.4).
   *
   * **THIS DELETES THE OWNER'S EARLIER WORDS, and since the floor that is the
   * plain truth of it.** The line that used to stand here said "the archived
   * prose file is left where it is — this module destroys nothing", and it was
   * true: a version row was a NOTE about a file nothing ever unlinked, so the
   * prune cost the history its index and not one word. The words are IN the row
   * now, so at H the wording itself is gone.
   *
   * Kept anyway, at 90 lived days (owner ruling 1, 2026-09-18), and his reason
   * is the general steer: simple, elegant working-memory mechanics over keeping
   * everything, and losing some history after a month or two is an acceptable
   * price. Our own store sets `retentionDays` high for debugging.
   * `test/self-page.test.ts` makes the cost visible on the self page, which is
   * where an owner would feel it first.
   */
  pruneSupersededVersions(): PruneReport {
    const report = this.mutate("pruneSupersededVersions", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.all<VersionRow>(
        "SELECT * FROM versions WHERE version_day < ?",
        cutoffDay,
      );
      this.ops.run("DELETE FROM versions WHERE version_day < ?", cutoffDay);
      return { pruned: doomed.length, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.versions.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay,
      retentionDays: report.retentionDays,
    });
    return report;
  }

  /**
   * The store's half of the owner-removal seam: the canonical, append-only record.
   * A later stage appends; it never rewrites the earlier line (§16 G8). If this
   * cannot be written, the caller must move nothing (§16 G10).
   */
  appendRemovalRecord(note: RemovalNote): number {
    const seq = this.mutate("appendRemovalRecord", () => {
      this.ops.run(
        "INSERT INTO removal_record (memory_id, stage, at, actor, reason) VALUES (?, ?, ?, ?, ?)",
        note.memoryId,
        note.stage,
        this.nowFn(),
        note.actor,
        note.reason ?? null,
      );
      const row = this.ops.get<{ seq: number }>("SELECT last_insert_rowid() AS seq");
      return row?.seq ?? 0;
    });
    this.emit("store.removal.recorded", note.memoryId, { stage: note.stage, seq });
    return seq;
  }

  /**
   * Box 3 only. Deleting the cache file and calling this must lose nothing
   * canonical; what cannot be recomputed is declared and counted (§5 G8).
   */
  rebuildCache(opts: RebuildOptions = {}): RebuildReport {
    this.assertWritable("rebuildCache");
    const keepVectors = opts.keepVectors === true;
    // Read the surviving vector ids BEFORE the reset, so "kept" is a count and
    // not an assumption, and so the sweep below knows what it is sweeping.
    const heldVectors = keepVectors
      ? new Set(
          this.cache
            .all<{ memory_id: string }>("SELECT memory_id FROM embeddings")
            .map((r) => r.memory_id),
        )
      : new Set<string>();
    // THE DROP-VECTORS EXIT LEAVES A DURABLE ROW (re-review NIT 2): what a
    // plain rebuild drops, and the hold it ends, read before the reset.
    const droppingVectors = keepVectors ? 0 : embeddingCount(this.cache);
    const endingHold = keepVectors ? null : heldEmbedder(this.cache);
    resetCache(this.cache, { keepEmbeddings: keepVectors });
    const denied = new Set(this.deniedIds());
    const rows = this.ops.all<MemoryRow>("SELECT * FROM memories ORDER BY id");
    let indexed = 0;
    let skippedDenied = 0;
    let skippedArchived = 0;
    let unrecomputed = 0;
    for (const row of rows) {
      if (denied.has(row.id)) {
        // A stray copy of a removed memory is skipped and LOGGED, never deleted (§16 G12).
        skippedDenied += 1;
        this.emit("cache.rebuild.denied", row.id, {});
        continue;
      }
      // Not live, not indexed. `archive` and `supersede` take a row out of box 3
      // as it goes dark; a rebuild that put it back would restore the I13 bug on
      // the owner's next `verify --rebuild` — the index's denominator would
      // count rows `recall`'s `storeSize` does not.
      if (row.archived === 1 || row.superseded_by !== null) {
        skippedArchived += 1;
        continue;
      }
      const text = indexTextOf(row.title, row.body);
      // KEEP MEANS KEEP. A row that already has a vector is not offered to the
      // embedder at all under `keepVectors` — the first version called it and
      // let `indexDoc` overwrite what it had just promised to preserve, so a
      // process with an embedder wired paid a network call per row and reported
      // the result as `keptVectors`. Two words for one behaviour is how an API
      // starts lying; the name picks the behaviour, and the caller that wants
      // fresh vectors wants a plain `rebuildCache()`.
      const held = keepVectors && heldVectors.has(row.id);
      const vec = held ? null : this.embed ? this.embed(text) : null;
      if (vec !== null) {
        if (indexDoc(this.cache, row.id, text, vec) !== null) unrecomputed += 1;
      } else {
        indexDoc(this.cache, row.id, text);
        // A miss is only a LOSS when there was nothing there to keep. Under
        // `keepVectors` the row's existing vector is still in the table, so
        // counting it un-recomputed would report a gap box 3 does not have.
        if (!held) unrecomputed += 1;
      }
      indexed += 1;
    }
    // Vectors whose memory is no longer canonical do NOT survive a rebuild —
    // `keepVectors` preserves the cache, it does not resurrect a removed
    // memory's trace (§16 G12) or keep an orphan the set diff would then report
    // forever. Deleted here rather than skipped, because the plain rebuild
    // drops them by dropping the table and the two paths must agree.
    let droppedVectors = 0;
    let keptVectors = 0;
    if (keepVectors && heldVectors.size > 0) {
      const canonical = new Set(rows.map((r) => r.id));
      const del = this.cache.prepare("DELETE FROM embeddings WHERE memory_id = ?");
      this.cache.transaction(() => {
        for (const id of heldVectors) {
          if (!canonical.has(id) || denied.has(id)) {
            del.run(id);
            droppedVectors += 1;
          } else keptVectors += 1;
        }
      });
    }
    // Declared when there is no embedder at all, AND when a configured one
    // could not answer for some rows — both are "box 3 does not hold what a
    // vector channel would need", and a silent partial is the worse of the two.
    //
    // `keepVectors` is the third way to have nothing to declare, and it is the
    // reason this is not simply "is there an embedder": a rebuild that kept
    // every vector it started with is not missing them, whatever this process
    // could or could not have recomputed. Without the extra arm a
    // `verify --rebuild --keep-vectors` that lost nothing would still print a
    // repair instruction for a gap box 3 does not have.
    const declared =
      unrecomputed === 0 && (this.embed !== undefined || keepVectors)
        ? []
        : [
            {
              what: "embeddings",
              owner: "encode/ (the embedder)",
              repair: "Store.open({ embed }) then rebuildCache()",
            },
          ];
    const report: RebuildReport = {
      indexed,
      skippedDenied,
      skippedArchived,
      unrecomputed,
      declared,
      keptVectors,
      droppedVectors,
    };
    this.emit("cache.rebuild", undefined, {
      indexed,
      skippedDenied,
      skippedArchived,
      unrecomputed,
      keptVectors,
      droppedVectors,
      declaredKinds: declared.map((d) => d.what).join(",") || "none",
    });
    if (droppingVectors > 0 || endingHold !== null) {
      try {
        this.appendEvent({
          name: EMBEDDER_RECONCILED_EVENT,
          day: this.livedDay(),
          payload: { kind: "dropped", by: "rebuildCache", dropped: droppingVectors, releasedHold: endingHold },
        });
      } catch {
        // A lost lock costs the row, never the rebuild.
      }
    }
    return report;
  }

  /**
   * Take every NOT-LIVE document out of the text index, and touch nothing else.
   *
   * This is I13's migration, and it exists for the same reason `backfillLengths`
   * does: the repair is a pure function of state box 3 and box 2 already hold,
   * so it must not be paid for with `rebuildCache`, which begins with
   * `resetCache` and drops every embedding — roughly 13.9K of them on the store
   * this was written against, one paid network call each. `counterparts verify
   * --rebuild` refuses outright for that reason unless the owner passes
   * `--drop-vectors`, so a rebuild is not a repair anyone can actually run here.
   *
   * `archive` and `supersede` keep the invariant going forward
   * (`cache.ts#deindexDoc`); this is how a store that predates them catches up.
   * It is NOT run at open: an instrument writes nothing at open, and a write at
   * open takes the write lock (see the constructor). The owner runs it by name.
   *
   * Returns the number of documents removed from the index.
   */
  pruneDeadIndex(): number {
    this.assertWritable("pruneDeadIndex");
    const live = new Set(this.list({ archived: false }));
    const indexed = this.cache
      .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM doc_tokens")
      .map((r) => r.memory_id);
    let removed = 0;
    for (const id of indexed) {
      if (live.has(id)) continue;
      deindexDoc(this.cache, id);
      removed += 1;
    }
    if (removed > 0) this.emit("cache.prune.dead", undefined, { removed });
    return removed;
  }

  /**
   * Give ONE existing memory its vector — **the vector row only**, never the
   * token rows.
   *
   * `rebuildCache()` was the only public way to put a vector in box 3, and it
   * resets the whole cache: a store whose embedder arrived after its memories
   * did (this one — 40 authored notes, 224 episodes and 288 migrated memories
   * with no vector, measured 2026-09-04) had no way to fill the gap
   * incrementally, so the semantic channel stayed blind to exactly the
   * first-person material it most wanted.
   *
   * **Why not `indexDoc`, which would have been the obvious reuse:** it deletes
   * and re-inserts every `doc_tokens` row for the document. The text has not
   * changed — only the vector is missing — so that is pure churn on the 263 MB
   * token index whose page-cache warming is what pushed `recall/`'s BUDGET_MS
   * from 250 to 1200. A backfill of 64 memories per Stop would have made the
   * cold recall it exists to serve slower.
   *
   * It reads the SYNC embedder, like every other indexing site, so the caller's
   * job is to have warmed the live half first with `indexTextOf(title, body)` —
   * the same string `indexOne` looks a vector up by. A miss is not an error and
   * not a lie: nothing is written and `vector` comes back false, so a backfill
   * that warmed the wrong text reports zero rather than success.
   */
  embedOne(id: string): { found: boolean; vector: boolean; refused?: VectorRefusal } {
    this.assertWritable("embedOne");
    if (this.isDenied(id)) return { found: false, vector: false };
    const row = this.row(id);
    if (row === undefined) return { found: false, vector: false };
    let doc: ProseDoc;
    try {
      doc = this.readProse(id);
    } catch {
      return { found: false, vector: false };
    }
    // THE THIRD DOOR, guarded like the other two. `unembeddedIds` will never
    // offer one of these, but this method takes an id from a caller and a
    // backfill that named one directly would embed it — the whole point of
    // `noVector` is that a caller cannot reach the wire for these rows by any
    // route. `found: true, vector: false` is the honest answer: the row is
    // there, and it has no vector on purpose.
    const vec = this.embed && !noVector(doc.type, doc.meta["role"]) ? this.embed(indexText(doc)) : null;
    if (vec === null) return { found: true, vector: false };
    // `refused`: the FILE said no (held, ahead, or now another identity's) —
    // not the item's fault, so a backfill must not count it against the id.
    const refused = setEmbedding(this.cache, id, vec);
    if (refused !== null) {
      this.emit("cache.vector.refused", id, { site: "embedOne", reason: refused });
      return { found: true, vector: false, refused };
    }
    return { found: true, vector: true };
  }

  /**
   * Live memories box 3 holds no vector for, in the order a backfill should take
   * them: **the first-person material first** — what the experiencer authored
   * (`source = 'authored'`) and its own episodes — then everything else, oldest
   * first inside each group.
   *
   * The order is the whole point and it is a memory claim, not a convenience:
   * an authored note and an episode are the memories this brain wrote about
   * itself, so if a bounded backfill only ever reaches N per run, those are the
   * N that should arrive first.
   *
   * Two boxes, two queries, diffed here: box 2 knows what is live, box 3 knows
   * what is embedded, and they are separate files by design.
   */
  missingVectors(limit = 64): string[] {
    return this.unembeddedIds(limit, false);
  }

  /**
   * The ids a backfill has given up on — `EMBED_SKIP_AFTER` failed runs each.
   *
   * THE HEAD-OF-LINE SCAR (I33, 2026-09-11). Two migrated memories carried a
   * lone UTF-16 surrogate in their title; the provider answered 400 for the
   * whole 64-text chunk; `missingVectors` returns a STABLE order, so the same
   * head-64 was retried at every boundary for a week and 165 blind memories
   * behind them never got a turn. A skip list is the general fix: whatever the
   * poison is, an id that has failed three runs stops holding the queue.
   *
   * Distinct from `deniedIds()` by design. A denial is a REMOVAL — the row is
   * dark and must never come back. A skip is an operational give-up on ONE
   * channel: the memory is live, recallable, and lexically indexed; only its
   * vector is missing, and a repair (or a rebuild) clears the counter.
   *
   * Kept in box 2's meta rather than a column, because it is a fact about a
   * retry loop and not about the memory — same shape as `sleep.pruned.<id>`,
   * and no schema bump.
   */
  skippedVectorIds(): string[] {
    return this.unembeddedIds(Number.MAX_SAFE_INTEGER, true);
  }

  /**
   * Live memories with no vector, in backfill order. `skipped` selects WHICH
   * half: the ones a backfill should try (false) or the ones it has given up on
   * (true). One query, one order, two readings — a second copy of this walk is
   * how the two lists would drift.
   */
  private unembeddedIds(limit: number, skipped: boolean): string[] {
    const embedded = new Set(
      this.cache.all<{ memory_id: string }>("SELECT memory_id FROM embeddings").map(
        (r) => r.memory_id,
      ),
    );
    const denied = new Set(this.deniedIds());
    // ONE read of the failure counters per call, not one per candidate row.
    const failures = this.metaWithPrefix(EMBED_FAILED_PREFIX);
    const givenUp = (id: string): boolean =>
      Number(failures.get(`${EMBED_FAILED_PREFIX}${id}`) ?? "0") >= EMBED_SKIP_AFTER;
    const rows = this.ops.all<{ id: string; type: string; meta: string }>(
      `SELECT id, type, meta FROM memories
        WHERE archived = 0 AND superseded_by IS NULL
        ORDER BY CASE WHEN source IN ('authored', 'episode') OR type = 'episode' THEN 0 ELSE 1 END,
                 birth_day ASC, id ASC`,
    );
    const out: string[] = [];
    for (const r of rows) {
      if (embedded.has(r.id) || denied.has(r.id)) continue;
      if (notForEmbedding(r)) continue;
      if (givenUp(r.id) !== skipped) continue;
      out.push(r.id);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * How many live memories a backfill could still act on — the denominator a
   * coverage watch needs, and the number that must fall run over run.
   *
   * Since I33 it EXCLUDES the give-up list, because the number's job is to say
   * what is actionable: a count that never falls because three ids in it can
   * never be embedded is a watch that has stopped meaning anything. The excluded
   * ids are not hidden — `skippedVectorIds()` names them, the backfill row
   * carries `skipped`, and `verify` prints both, so the two numbers add up on
   * the page where an owner reads them.
   */
  unembeddedCount(): number {
    return this.missingVectors(Number.MAX_SAFE_INTEGER).length;
  }

  /**
   * Every meta row under one key prefix. A read; nothing is created.
   *
   * The meta table is this store's general-purpose key space, and two of its
   * inhabitants are per-id counters (`sleep.pruned.<id>`, `embed.failed.<id>`)
   * whose readers want the whole family at once. One `LIKE` beats N `getMeta`
   * calls in a loop over every live memory, which is what the alternative was.
   * `_` and `%` in the prefix are escaped: the caller passes a key prefix, not
   * a pattern.
   */
  metaWithPrefix(prefix: string): Map<string, string> {
    const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.ops.all<{ key: string; value: string }>(
      `SELECT key, value FROM meta WHERE key LIKE ? ESCAPE '\\'`,
      pattern,
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /**
   * How many vectors box 3 HOLDS — the numerator, and a different number from
   * `unembeddedCount()`.
   *
   * Filed as a core follow-up by PR #43's review (`adapters/cli/NOTES.md`,
   * 2026-09-04): the console needed "how many embeddings would `--rebuild`
   * destroy" before it could refuse, `unembeddedCount()` is the coverage
   * denominator instead, and with no read API for the count the CLI reached
   * past the Store into `cache.sqlite` with its own `openDb`. It still does for
   * the census — that read is deliberately gated on the FILE existing, so it
   * cannot mint the box it inspects, which a Store constructor cannot promise —
   * but a caller that already holds an open Store now has the number here.
   *
   * Counts every vector, including one held for an archived or superseded row:
   * this is what box 3 contains, not what a live coverage ratio would want.
   */
  embeddingCount(): number {
    return embeddingCount(this.cache);
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  has(id: string): boolean {
    return this.row(id) !== undefined;
  }

  row(id: string): MemoryRow | undefined {
    return this.ops.get<MemoryRow>("SELECT * FROM memories WHERE id = ?", id);
  }

  read(id: string): StoredMemory {
    const row = this.requireRow(id);
    const doc = this.docOf(row);
    if (row.archived === 1) {
      // §5 G13: a read-back of archived content is an event, so "did the archival
      // mechanisms ever pay for themselves" is an answerable question in v2.
      this.emit("store.archived.read", id, { reason: row.archived_reason });
    }
    return {
      doc,
      physics: rowToPhysics(row),
      band: row.band,
      bandDay: row.band_day,
      archived: row.archived === 1,
      archivedReason: row.archived_reason,
      supersededBy: row.superseded_by,
      revision: row.revision,
      contentHash: row.content_hash,
      confidential: row.confidential === 1,
    };
  }

  readProse(id: string): ProseDoc {
    return this.read(id).doc;
  }

  physicsOf(id: string): MemoryPhysics {
    return rowToPhysics(this.requireRow(id));
  }

  /**
   * Follows the forwarding addresses to the live head. Cycles are a hard error.
   *
   * A REMOVED id is terminal: the walk stops there and returns it, rather than
   * walking past it or reporting the address as dangling. That is what makes a
   * survivor's lineage pointer resolve to a named removal — `read` refuses the
   * returned id by name, so a renderer prints "[removed by the owner]" instead
   * of "[a forwarding address with nothing at the end]". The deny-list is
   * checked BEFORE the row, so the answer is the same before and after the
   * chase has stripped the row to a skeleton.
   */
  resolve(id: string): string {
    let current = id;
    const seen = new Set<string>();
    for (let depth = 0; depth <= MAX_CHAIN; depth++) {
      if (seen.has(current)) throw new StoreError("ID_CYCLE", { id, at: current });
      seen.add(current);
      if (this.isDenied(current)) return current;
      const row = this.row(current);
      if (row === undefined) {
        throw new StoreError(current === id ? "ID_UNKNOWN" : "ID_DANGLING", { id, at: current });
      }
      if (row.superseded_by === null) return current;
      current = row.superseded_by;
    }
    throw new StoreError("ID_CHAIN_TOO_DEEP", { id, max: MAX_CHAIN });
  }

  list(filter: MemoryFilter = {}): string[] {
    const { clause, args } = memoryWhere(filter);
    const sql = `SELECT id FROM memories ${clause} ORDER BY id`;
    return this.ops.all<{ id: string }>(sql, ...args).map((r) => r.id);
  }

  /**
   * How many rows `list()` would return, counted in SQL rather than materialized.
   * The same filter, the same WHERE, one number — for the callers that want the
   * SIZE of the store (the wake's delivery preface states it) and would otherwise
   * build an array of every id to take its length.
   */
  countMemories(filter: MemoryFilter = {}): number {
    const { clause, args } = memoryWhere(filter);
    const sql = `SELECT COUNT(*) AS n FROM memories ${clause}`;
    return this.ops.get<{ n: number }>(sql, ...args)?.n ?? 0;
  }

  versions(id: string): VersionRow[] {
    return this.ops.all<VersionRow>(
      "SELECT * FROM versions WHERE memory_id = ? ORDER BY seq",
      id,
    );
  }

  /** Reading a superseded/archived version is an event (§5 G13). */
  readVersion(id: string, seq: number): ProseDoc {
    // The version row survives a removal as a lineage pointer with its content
    // pointers blanked; reading it is refused by name, never by ENOENT.
    this.refuseIfDenied(id);
    const row = this.ops.get<VersionRow>(
      "SELECT * FROM versions WHERE memory_id = ? AND seq = ?",
      id,
      seq,
    );
    if (row === undefined) throw new StoreError("VERSION_UNKNOWN", { id, seq });
    this.emit("store.version.read", id, { seq, reason: row.reason });
    return this.versionDoc(id, row);
  }

  /**
   * Rows whose WORDS WENT MISSING — `body = ''` with a content hash that still
   * names them. Ids only; never a body (§5 G10).
   *
   * The fault `MEMORY_BODY_MISSING` is raised for, counted. It is not a
   * tombstone (both halves blank, the owner's removal) and no write path in
   * this build produces it: `put` and `revise` both refuse an empty body, and
   * the chase blanks the pair together. So a non-empty answer means something
   * happened to the store underneath itself.
   *
   * It exists because the fault stands EVERY session down while `status` and
   * `verify` both read green, and doctor's red line named the class and not the
   * row — so the owner could not find which of thousands of rows to act on
   * (review B, MAJOR-3). A read; nothing here crosses the write seam.
   */
  faultedIds(): string[] {
    return this.ops
      .all<{ id: string }>(
        "SELECT id FROM memories WHERE body = '' AND content_hash <> '' ORDER BY id",
      )
      .map((r) => r.id);
  }

  edgesFrom(src: string): EdgeRow[] {
    return this.ops.all<EdgeRow>("SELECT * FROM edges WHERE src = ? ORDER BY dst", src);
  }

  prospectiveFor(id: string): ProspectiveRow[] {
    return this.ops.all<ProspectiveRow>(
      "SELECT * FROM prospective WHERE memory_id = ? ORDER BY window_key",
      id,
    );
  }

  removalRecord(id?: string): RemovalRow[] {
    const rows =
      id === undefined
        ? this.ops.all<RemovalRow>("SELECT * FROM removal_record ORDER BY seq")
        : this.ops.all<RemovalRow>(
            "SELECT * FROM removal_record WHERE memory_id = ? ORDER BY seq",
            id,
          );
    this.emit("store.removalRecord.read", id, { rows: rows.length });
    return rows;
  }

  /**
   * What removal left behind, joined into one row per removed memory: the
   * tombstone's flags and counts, the latest stage of its record, and whether a
   * skeleton row survives in `memories`.
   *
   * This is the read that keeps scar §2.19 true from the other side — "everything
   * permanent is enumerable and inspectable" has to survive the one operation
   * that ends permanence, or a removed protected element simply vanishes from
   * the list and nobody can tell it apart from one that was never there.
   *
   * PURE and emit-free, unlike `removalRecord()`: `self.enumerate` calls it on
   * every enumeration, and an enumeration that logged would stop being a read
   * (§14.1 G8).
   */
  tombstones(): Tombstone[] {
    const rows = this.ops.all<
      TombstoneRow & { last_stage: string | null; row_survives: number }
    >(
      `SELECT t.*,
              (SELECT r.stage FROM removal_record r
                WHERE r.memory_id = t.memory_id ORDER BY r.seq DESC LIMIT 1) AS last_stage,
              (SELECT COUNT(*) FROM memories m WHERE m.id = t.memory_id) AS row_survives
         FROM removal_tombstone t
        ORDER BY t.memory_id`,
    );
    return rows.map((r) => ({
      id: r.memory_id,
      type: r.type,
      kind: r.kind,
      band: r.band,
      wasProtected: r.protected === 1,
      wasPromotedIdentity: r.promoted_identity === 1,
      supersededBy: r.superseded_by,
      stage: (r.last_stage ?? "dark") as RemovalNote["stage"],
      at: r.at,
      rowSurvives: r.row_survives > 0,
      chased: {
        versions: r.versions,
        edges: r.edges,
        prospective: r.prospective,
        gateRows: r.gate_rows,
      },
    }));
  }

  /** Ids a removal has taken dark: consulted at load and at rebuild (§16 G12). */
  deniedIds(): string[] {
    return this.ops
      .all<{ memory_id: string }>(
        "SELECT DISTINCT memory_id FROM removal_record WHERE stage IN ('dark', 'chased', 'complete')",
      )
      .map((r) => r.memory_id);
  }

  /**
   * The token channel's read. `norm` is the document-length normalization
   * (`cache.ts#LengthNorm`); recall passes its own CAL values, and the two
   * callers that are not recall take the default.
   */
  search(cue: string, limit = 10, norm: LengthNorm = DEFAULT_LENGTH_NORM): Hit[] {
    return searchIndex(this.cache, cue, limit, norm);
  }

  /**
   * How many indexed documents hold each token — the rarity denominator.
   *
   * Separate from `search` on purpose: `search` returns a bounded TOP-K, and a
   * top-K's length is `min(trueDf, k)`, not a document frequency. Reading it as
   * one is the measurement error `cache.ts#docFrequency` documents.
   */
  docFrequency(tokens: readonly string[]): Map<string, number> {
    return docFrequency(this.cache, tokens);
  }

  nearestTo(vec: readonly number[], limit = 10): Hit[] {
    // A held mismatch ranks nothing: the rows are another model's, and a
    // cosine across two models is a number that means nothing (§2.15). A cache
    // from a newer build ranks nothing either: its vectors are not this
    // build's to interpret.
    if (!this.rankable(vec.length, "nearestTo")) return [];
    return nearest(this.cache, vec, limit);
  }

  /**
   * The vectors of the `limit` memories nearest `vec` — E(m), the context a
   * novelty measurement is prediction error AGAINST (physics §5.1). Read-only,
   * box 3 only, and it strengthens nothing: this is an instrument's read.
   *
   * Returns fewer than `limit` (or none) whenever box 3 holds fewer vectors,
   * which is the ordinary state of a store whose embedder is switched off — and
   * `computeNovelty` turns that emptiness into `blind-no-context` rather than a
   * number, which is the whole point of asking it this way.
   */
  neighbourVectors(vec: readonly number[], limit = 10): number[][] {
    if (!this.rankable(vec.length, "neighbourVectors")) return [];
    return nearestVectors(this.cache, vec, limit);
  }

  /**
   * The identity box 3 records for its vectors RIGHT NOW — read fresh, one
   * primary-key read — when THIS handle may rank against them; null otherwise
   * (a hold, a newer build's cache, a file now another identity's than this
   * handle's, or no tag at all).
   *
   * It is what recall calibrates the semantic channel by (`recall/tunables.ts`
   * `SEMANTIC_BY_IDENTITY`, keyless/recall-tune): the file's tag rather than the
   * handle's open-time verdict, so a handle whose open was `deferred` (lost the
   * lock) or that has no identity of its own still gets the calibration of the
   * vectors it actually ranks — and a handle whose file moved to another model
   * gets null, the defaults, while its ranking is refused anyway.
   */
  rankingIdentity(): string | null {
    const v = this.embedderVerdict.kind;
    if (v === "held" || v === "cache-ahead") return null;
    try {
      if (searchRefusal(this.cache, this.identity, this.identity?.dim ?? 0) !== null) return null;
      return recordedEmbedder(this.cache)?.tag ?? null;
    } catch {
      return null;
    }
  }

  /**
   * May this handle take a cosine against box 3 RIGHT NOW? The at-open
   * verdict first (held, ahead), then the FILE's claim read fresh against this
   * handle's identity (`cache.ts#searchRefusal`) — one primary-key read, the
   * per-call pattern #187 uses for the schema stamp. A refusal is an event with
   * its reason, and an empty answer, never a cosine across two models.
   */
  private rankable(dim: number, site: string): boolean {
    const v = this.embedderVerdict.kind;
    if (v === "held" || v === "cache-ahead") return false;
    const refused = searchRefusal(this.cache, this.identity, dim);
    if (refused === null) return true;
    this.emit("cache.vector.refused", undefined, { site, reason: refused });
    return false;
  }

  livedDay(): number {
    return Number(this.getMeta("livedDay") ?? "0");
  }

  getMeta(key: string): string | undefined {
    return this.ops.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private requireRow(id: string): MemoryRow {
    // The deny-list answers FIRST, and answers even after the chase has taken
    // the row away: a removed id must never come back as "no such memory", and
    // never as an ENOENT on the prose file that used to hold it.
    this.refuseIfDenied(id);
    const row = this.row(id);
    if (row === undefined) throw new StoreError("ID_UNKNOWN", { id });
    return row;
  }

  /** Emit-free (§14.1 G8: reads are pure) — this is called on every read path. */
  private isDenied(id: string): boolean {
    const denied = this.ops.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM removal_record WHERE memory_id = ? AND stage IN ('dark','chased','complete')",
      id,
    );
    return (denied?.n ?? 0) > 0;
  }

  private refuseIfDenied(id: string): void {
    if (this.isDenied(id)) throw new StoreError("REMOVED", { id, by: "owner" });
  }

  /** Runs INSIDE the caller's transaction. One INSERT; there is nothing to publish. */
  private insertOne(input: PutInput): ProseDoc {
    const id = input.id ?? newId(input.type);
    // Both id checks BEFORE the row: the shape rule used to live in
    // `serializeProse`, which ran while the file was staged and so refused
    // before anything had been written. It has to keep refusing first.
    assertIdWellFormed(id);
    if (!id.startsWith(`${ID_PREFIX[input.type]}_`)) {
      throw new StoreError("ID_MALFORMED", { id, type: input.type });
    }
    // A removed id is taken FOREVER. Ids are never reused (§4.2 G2), and the one
    // reuse that would matter is the one that quietly resurrects what the owner
    // removed — so the deny-list is consulted at birth as well as at read.
    if (this.has(id) || this.isDenied(id)) throw new StoreError("ID_TAKEN", { id });
    // NORMALISED AND CHECKED BEFORE THE ROW. `bodyForStorage` is the one rule
    // both write doors share: whitespace-only is empty, and a lone surrogate is
    // folded to what SQLite will actually store so the hash below addresses the
    // bytes that land (review B, MINOR-4/-5).
    const body = bodyForStorage(input.body, id);
    const day = this.livedDay();
    // Source and origin mirror into the prose meta: the document is canonical
    // and self-describing; the columns are the query surface for the same fact.
    const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
    if (input.source !== undefined) meta["source"] = input.source;
    if (input.origin !== undefined) {
      const origin: Record<string, string> = {};
      if (input.origin.session !== undefined) origin["session"] = input.origin.session;
      if (input.origin.scope !== undefined) origin["scope"] = input.origin.scope;
      if (input.origin.ref !== undefined) origin["ref"] = input.origin.ref;
      if (input.origin.spanHash !== undefined) origin["spanHash"] = input.origin.spanHash;
      if (Object.keys(origin).length > 0) meta["origin"] = origin;
    }
    const doc: ProseDoc = {
      id,
      type: input.type,
      learnedOn: input.learnedOn ?? this.today(),
      bornDay: input.physics?.birthDay ?? day,
      meta,
      body,
    };
    if (input.title !== undefined) doc.title = input.title;
    if (input.happenedOn !== undefined) doc.happenedOn = input.happenedOn;
    // Serialized (and so G6-checked) BEFORE the INSERT, for the same reason:
    // a function or a NaN in `meta` is silent data loss, and the refusal must
    // land while nothing has been written.
    const metaJson = serializeMeta(meta, id);
    const contentHash = hashText(doc.body);
    const s: Salience = {
      novelty: input.salience?.novelty ?? null,
      relevance: input.salience?.relevance ?? 0,
      emotional: input.salience?.emotional ?? 0,
      predictive: input.salience?.predictive ?? 0,
      claimed: input.salience?.claimed ?? null,
    };
    this.ops.run(
      `INSERT INTO memories (
         id, type, kind, band, band_day, novelty, relevance, emotional, predictive,
         claimed, birth_day, uses, last_used_day, reinforced_days, consolidated,
         promoted_identity, protected, pressure, last_challenged_day, archived,
         archived_reason, superseded_by, revision, content_hash,
         learned_on, happened_on, source, origin_session, origin_scope, origin_ref,
         title, body, meta, confidential)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.type,
      input.kind,
      input.band ?? "episodic",
      day,
      s.novelty,
      s.relevance,
      s.emotional,
      s.predictive,
      s.claimed ?? null,
      doc.bornDay,
      input.physics?.uses ?? 0,
      input.physics?.lastUsedDay ?? day,
      input.physics?.reinforcedDays ?? 0,
      input.physics?.consolidated ? 1 : 0,
      input.physics?.promotedIdentity ? 1 : 0,
      input.physics?.protected ? 1 : 0,
      input.physics?.pressure ?? 0,
      input.physics?.lastChallengedDay ?? null,
      contentHash,
      doc.learnedOn,
      doc.happenedOn ?? null,
      input.source ?? null,
      input.origin?.session ?? null,
      input.origin?.scope ?? null,
      input.origin?.ref ?? null,
      doc.title ?? null,
      doc.body,
      metaJson,
      confidentialByMeta(meta) ? 1 : 0,
    );
    return doc;
  }

  /**
   * A row read as the document it is.
   *
   * THE READ SEAM, and the reason nothing above `store/` noticed the floor
   * move: `ProseDoc` is the shape it always was, assembled from columns now
   * instead of parsed out of a file's frontmatter.
   *
   * The body check is the fault `PROSE_FILE_MISSING` used to be. A blank body
   * beside a blank hash is a TOMBSTONE — the owner removed this — and never
   * reaches here through a read, because the deny-list refuses the id by name
   * first (`requireRow`); a blank body beside a real hash is a row whose words
   * went missing underneath the store, which no write path in this module
   * produces and which is worth a loud, named refusal rather than an empty
   * memory that reads as if it said nothing.
   */
  private docOf(row: MemoryRow): ProseDoc {
    if (row.body.length === 0) {
      throw new StoreError("MEMORY_BODY_MISSING", {
        id: row.id,
        tombstoned: rowTombstoned(row),
      });
    }
    const doc: ProseDoc = {
      id: row.id,
      type: row.type,
      learnedOn: row.learned_on,
      bornDay: row.birth_day,
      meta: parseMeta(row.meta, row.id),
      body: row.body,
    };
    if (row.title !== null) doc.title = row.title;
    if (row.happened_on !== null) doc.happenedOn = row.happened_on;
    return doc;
  }

  /**
   * An archived version read as the document it was.
   *
   * `title`, `body`, `meta` and the two PROVENANCE dates come from the version
   * row, because all five can be revised and the version is what they were;
   * `type` and `bornDay` come from the live row, because neither can (an id's
   * prefix pins its family, and a birth day is physics, not content).
   */
  private versionDoc(id: string, version: VersionRow): ProseDoc {
    if (version.body.length === 0) {
      throw new StoreError("MEMORY_BODY_MISSING", { id, seq: version.seq });
    }
    const head = this.row(id);
    const doc: ProseDoc = {
      id,
      type: head?.type ?? "memory",
      learnedOn: version.learned_on,
      bornDay: head?.birth_day ?? 0,
      meta: parseMeta(version.meta, id),
      body: version.body,
    };
    if (version.title !== null) doc.title = version.title;
    if (version.happened_on !== null) doc.happenedOn = version.happened_on;
    return doc;
  }

  /**
   * Give every live memory its vector, in-process, right now — the INLINE half
   * of the identity check, for an embedder whose sync face computes (a static
   * table). Not a public door: it runs from the constructor, after a reset or
   * a first tag, and only there.
   *
   * Batched: one box-3 transaction per `REFILL_BATCH` rows, because box 3 runs
   * `synchronous = FULL` and a commit per row is an fsync per row. Bounded by
   * `REFILL_BUDGET_MS` between batches: the first open after a switch is often
   * a hook, and a store too large to refill inside the budget is finished by
   * the worker's backfill rather than holding the hook. Reports what it did.
   */
  private refillVectorsInline(): void {
    const embed = this.embed;
    if (embed === undefined) return;
    // A BUDGET timer, not a clock: `performance.now()` is monotonic and dates
    // nothing, so the provenance rule (one ambient `Date.now` in this file,
    // `two-clocks.test.ts`) is untouched.
    const t0 = performance.now();
    const ids = this.missingVectors(Number.MAX_SAFE_INTEGER);
    let embedded = 0;
    let skipped = 0;
    let at = 0;
    while (at < ids.length && performance.now() - t0 < REFILL_BUDGET_MS) {
      const batch = ids.slice(at, at + REFILL_BATCH);
      at += batch.length;
      this.cache.transaction(() => {
        for (const id of batch) {
          let doc: ProseDoc;
          try {
            doc = this.readProse(id);
          } catch {
            skipped += 1;
            continue;
          }
          // `missingVectors` already leaves out every `noVector` row; asked again
          // here because this is a write path, and every write path asks.
          const vec = noVector(doc.type, doc.meta["role"]) ? null : embed(indexText(doc));
          if (vec === null) {
            skipped += 1;
            continue;
          }
          if (setEmbedding(this.cache, id, vec) !== null) {
            skipped += 1;
            continue;
          }
          embedded += 1;
        }
      });
    }
    this.emit("cache.embedder.refilled", undefined, {
      embedded,
      skipped,
      remaining: ids.length - at,
      ms: Math.round(performance.now() - t0),
    });
  }

  /**
   * Box 3 is best-effort by design: it is rebuildable, so it never fails a
   * write.
   *
   * **This is where `noVector` has to be asked, and the backfill is the second
   * place and not the first.** The live adapter wires a SYNC embedder
   * (`claude-code/index.ts`), so every `put` and `revise` embeds here, at write
   * time, long before `unembeddedIds` is consulted — a filter only on the
   * backfill leaves the write path handing the whole body to an embedder. That
   * was measured, with a stub, before it was fixed.
   *
   * The TOKENS are still written either way. A row nobody should embed is still
   * a row the OWNER should be able to find: the dashboard's search, the console
   * `remove` flow and `expandHandle`'s exact-title match all read the lexical
   * index, and none of them is a recall candidate path.
   */
  private indexOne(doc: ProseDoc): void {
    const text = indexText(doc);
    const vec = this.embed && !noVector(doc.type, doc.meta["role"]) ? this.embed(text) : null;
    if (vec === null) {
      indexDoc(this.cache, doc.id, text);
      return;
    }
    // The per-write check (re-review MAJOR A): a long-lived handle whose file
    // now names another identity writes the words and NOT the vector, leaving
    // the memory for the owning identity's backfill.
    const refused = indexDoc(this.cache, doc.id, text, vec);
    if (refused !== null) this.emit("cache.vector.refused", doc.id, { site: "put", reason: refused });
  }
}

/**
 * The string box 3 indexes for a document — and therefore the string a CALLER
 * must embed if it wants its vector to be the one this store looks up at `put`
 * time. Exported for exactly that: `counterpart.ts` composes it from a
 * proposal's title and its GATED content before the memory exists, so one live
 * call serves both the novelty seam and box 3.
 *
 * The word gated is the whole contract. This function is a pure join, so it
 * cannot enforce which content it is handed — a caller that composes it from the
 * author's raw draft will cache under a key `indexOne` never asks for, and every
 * redaction or hedge silently costs the deposit its vector. The ordering that
 * makes it true lives in `bridge.batteryGate`, and a test asserts it.
 */
export function indexTextOf(title: string | null | undefined, body: string): string {
  return [title ?? "", body].join("\n");
}

function indexText(doc: ProseDoc): string {
  return indexTextOf(doc.title, doc.body);
}

/**
 * What to TELL somebody whose directory holds pre-rows names — and, when it is
 * ambiguous, what not to tell them.
 *
 * Three cases, and the middle one is the finding this exists for (review A,
 * MAJOR-1). The PRE-FLOOR build's `Store` constructor — the one tagged
 * `floor/v5-last`, and what a stale worktree or an un-deployed checkout still
 * runs — mkdirs `prose/`, `versions/`, `tmp/`
 * and mints `operational.sqlite` BEFORE it reaches `assertLayout()`, so **one**
 * old-build SessionStart hook on a v6 store leaves every marker behind. That is
 * the rollback the cut-over plan actually calls for, and after it the new build
 * refuses its own store for ever while telling the owner it is "readable by
 * floor/v5-last" — the build that just stood down on the same directory. Both
 * builds dead, and nothing saying which four names to remove.
 *
 * **The discrimination is by LISTING, never by opening** — see
 * `preRowsLeftoversAreEmpty`. An old build's leftovers are EMPTY `prose/` and
 * `versions/`; a real v5 store's are not, and a directory that has both names
 * because somebody hand-copied a `counterparts.sqlite` into a v5 store is
 * holding every memory he has under `prose/`. "Remove those four" is the right
 * instruction for the first and a catastrophe for the second, so the sentence
 * asks before it says it. **Nothing here deletes anything**; the owner does.
 */
function preRowsRemedy(
  dir: string,
  found: readonly string[],
): { readableBy: string } | { alsoFound: string; remedy: string } {
  if (!existsSync(paths.operational(dir))) return { readableBy: PRE_ROWS_READABLE_BY };
  const leftovers = found.filter((n) => n !== DATABASE_FILE).join(", ");
  // MOVE ASIDE, NEVER REMOVE — and that is what makes the guess below safe to
  // get wrong (third review, NEW-MINOR-2). By LISTING alone an old build's
  // empty leftovers and a REAL v5 store whose `prose/` somebody moved out look
  // identical: both have an empty `prose/` and an `operational.sqlite`, and the
  // second one's database holds every memory's physics, bands, dates and the
  // permanent removal record. Telling him to delete it would destroy the store.
  // Telling him to move it into a folder of its own costs one `mv` and is
  // reversible whichever of the two it turns out to be.
  if (preRowsLeftoversAreEmpty(dir)) {
    return {
      alsoFound: DATABASE_FILE,
      remedy:
        `${DATABASE_FILE} is THIS build's store. Beside it are ${leftovers} (and possibly tmp/), ` +
        `which an older build leaves behind when it is pointed at a store like this one — its ` +
        `prose/ and versions/ are empty here. MOVE THOSE OUT of this directory into a folder of ` +
        `their own; do not delete them, and do not delete ${DATABASE_FILE}. This store then opens ` +
        `again with every memory in it. If you moved prose/ aside yourself, that operational.sqlite ` +
        `is your PRE-ROWS store and the words that go with it are wherever you put them — keep both, ` +
        `and open it with the build tagged ${PRE_ROWS_READABLE_BY}.`,
    };
  }
  return {
    alsoFound: DATABASE_FILE,
    remedy:
      `this directory holds TWO stores' names — a pre-rows store (${leftovers}, WITH FILES IN IT) ` +
      `and a ${DATABASE_FILE}. DELETE NEITHER. Move one of them out into a directory of its own and ` +
      `point at the one you mean; the pre-rows half is read by the build tagged ${PRE_ROWS_READABLE_BY}.`,
  };
}

/**
 * THE TWO ROWS THAT NEVER GET A VECTOR, and why the rule is one function.
 *
 * Both are `type: "schema"` rows that are DELIVERED AT THE WAKE and are skipped
 * by `recall/activate.ts`, so neither can reach a turn through the semantic
 * channel however good its vector is. Embedding either buys retrieval nothing
 * and costs three things that were measured rather than argued:
 *
 *   1. **The most sensitive prose in the store goes out to an embedding API for
 *      no use.** The self page is up to 16 KB of first-person identity; the
 *      handoff is the prose E1's own CONTRACT calls the likeliest to carry a
 *      token. Data leaves the machine only by the owner's choice (constitution
 *      6), and "because the indexer indexes everything" is not a choice.
 *   2. **They put a permanent floor under `unembeddedCount()`** — the number
 *      `doctor` and the parallel run watch, whose whole job is to say what is
 *      ACTIONABLE. On a keyless store that floor never falls.
 *   3. **A vector for a superseded body can displace a live neighbour** on the
 *      semantic slate (`cache.ts#deindexDoc`'s note: `nearestTo` scans
 *      `embeddings` with no liveness filter). Fewer rows in that table that
 *      nothing can deliver is strictly better.
 *
 *   - **`role: "page"`** — the self page (S1). Raised by E1's adversarial review
 *     as "worth checking whether the page is in the same position"; it was, and
 *     the coordinating session asked for the exclusion on 2026-09-20. **A
 *     WORKING DEFAULT, not a ruling — the owner has not been asked, and this is
 *     revisable without ceremony** (CLAUDE.md). The three reasons above are the
 *     whole of the argument for it; if any of them stops being true, so does
 *     this line.
 *   - **`role: "handoff"`** — the per-directory handoff (E1).
 *
 * Read STRUCTURALLY, for the reason `recall/` reads these roles structurally:
 * `store/` depends on no module above it, and a parse that fails reads as
 * "embed it", which is the direction that only ever costs a vector nobody asks
 * for. The strings' owners are `core/self/page.ts#SELF_PAGE_ROLE` and
 * `core/handoff/index.ts#HANDOFF_ROLE`.
 *
 * **What is NOT excluded, checked by the same test and left alone:**
 * the JOURNAL (`type: "episode"`) is a real recall candidate — `activate` does
 * not skip it, `expandHandle` returns it with `journal: true`, and the backfill
 * puts episodes in the FIRST group on purpose — so a vector buys it something
 * and it keeps one. Beliefs and entities (`role: "belief"`, `"entity"`) are
 * candidates too. S2's nightly writer mints no row of its own: it revises the
 * PAGE row and writes events, so excluding the page covers it whole.
 */
export function noVector(type: string, role: unknown): boolean {
  return type === "schema" && (role === "handoff" || role === "page");
}

/** The same rule for a caller holding box 2's columns rather than a document. */
function notForEmbedding(row: { type: string; meta: string }): boolean {
  if (row.type !== "schema") return false;
  try {
    return noVector(row.type, (JSON.parse(row.meta) as Record<string, unknown>)["role"]);
  } catch {
    return false;
  }
}

export function newId(type: ProseType): string {
  return `${ID_PREFIX[type]}_${randomBytes(6).toString("hex")}`;
}

/**
 * The calendar date an INSTANT falls on — the provenance clock's only arithmetic.
 *
 * UTC by deliberate choice, not by accident: every other date in this codebase is
 * written with the same `toISOString().slice(0, 10)` (the hook that supplies
 * `advanceClock`'s date, `sleep/cycle.ts#todayDate`, the embedder's seat rotation),
 * so a local-dating provenance clock would put provenance and physics on two
 * different calendars. Moving all of them to local dating is a real, separate
 * question, filed in `NOTES.md` 2026-09-05 with its evidence.
 *
 * NOT `physics/clock.ts#dayKey`. That function shifts by the BOUNDARY HOUR, which
 * is a physics idea — "which lived day does this activity belong to" — and a
 * memory taken at 01:30 was taken on the 14th no matter which lived day it counts
 * toward. Provenance does not get the boundary shift.
 */
export function dateOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The ambient date. Adapters and defaults only — a store reads `store.today()`. */
export function today(): string {
  return dateOf(Date.now());
}

/**
 * True when a data dir has already been initialized (used by adapters, not writes).
 *
 * A PRE-ROWS store counts, and has to: ~20 console commands gate on this before
 * they open anything, and a v5 store answering "false" would send every one of
 * them down the "there is no store here, run init" path — which is both wrong
 * and the one sentence that invites somebody to create a store on top of his
 * old one. Answering true sends them all to the named `STORE_PRE_ROWS` refusal
 * instead, which says what happened and which build still reads it.
 */
export function storeExists(dir: string = dataDir()): boolean {
  return existsSync(paths.operational(dir)) || preRowsMarkersIn(dir).length > 0;
}
