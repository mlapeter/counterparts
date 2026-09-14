/**
 * The store seam.
 *
 * Three boxes behind one object:
 *   1. canonical prose      — `prose/**.md`            (box 1, `prose.ts`)
 *   2. canonical operational — `operational.sqlite`    (box 2, `operational.ts`)
 *   3. rebuildable cache     — `cache/cache.sqlite`    (box 3, `cache.ts`)
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
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import type { Band, Kind, MemoryPhysics, MemorySource, Salience } from "../types.js";
import { creditUse } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { Db } from "./db.js";
import { StoreError } from "./errors.js";
import { isObserver } from "../observer.js";
import type { Stance } from "../observer.js";
import { DEFAULT_RETENTION_DAYS, SCHEMA_VERSION, openOperational, rowToPhysics } from "./operational.js";
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
  LAYOUT,
  assertLayoutClassified,
  assertSafeDataDir,
  dataDir,
  paths,
  resolveStoredPath,
} from "./paths.js";
import {
  ID_PREFIX,
  archivePriorVersion,
  publishStaged,
  readProseFile,
  stageProse,
} from "./prose.js";
import type { ProseDoc, ProseType, Staged } from "./prose.js";
import {
  DEFAULT_LENGTH_NORM,
  deindexDoc,
  docFrequency,
  embeddingCount,
  indexDoc,
  nearest,
  nearestVectors,
  openCache,
  resetCache,
  searchIndex,
  setEmbedding,
} from "./cache.js";
import type { Hit, LengthNorm } from "./cache.js";

export * from "./errors.js";
export * from "../observer.js";
export * from "./paths.js";
export * from "./prose.js";
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
  DEFAULT_RETENTION_DAYS,
  OBSERVER_READ_FLOOR,
  PATHS_MIGRATED_EVENT,
  SCHEMA_VERSION,
  relativizeStoredPaths,
  rowToPhysics,
} from "./operational.js";
export type { PathsConverted } from "./operational.js";
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
} from "./cache.js";
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
export type Embedder = (text: string) => number[] | null;

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

/** One column's spelling census — `Store.pathCensus()`, printed by `verify`. */
export interface PathCensus {
  /** Store-relative rows (the v5 shape). */
  readonly relative: number;
  /** Absolute rows: on a v4 store, not yet migrated; on a v5 store, the ones the
   *  migration could not place. Either way resolved against THIS store when a
   *  `prose/` or `versions/` segment allows it, and read as given otherwise. */
  readonly absolute: number;
  /** Rows that would resolve OUTSIDE `prose/` or `versions/` — a hand-edited
   *  database. Never resolved (`STORED_PATH_ESCAPES`), never stat'ed. */
  readonly escaped: number;
  /** Non-blank, resolvable rows whose file is not on disk. */
  readonly missing: number;
  /** Blanked pointers — removed rows. Nothing to resolve. */
  readonly blank: number;
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

const MAX_CHAIN = 32;
const EVENT_RING = 500;

/** What `list()` and `countMemories()` both select on — one filter, one WHERE. */
export interface MemoryFilter {
  type?: ProseType;
  kind?: Kind;
  band?: Band;
  archived?: boolean;
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
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}

export class Store {
  readonly dir: string;
  readonly observer: boolean;
  readonly retentionDays: number;
  private readonly ops: Db;
  private readonly cache: Db;
  private readonly embed: Embedder | undefined;
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
    const writesAtOpen = !this.observer;
    for (const sub of writesAtOpen
      ? [
          paths.prose(this.dir),
          paths.versions(this.dir),
          paths.tmp(this.dir),
          paths.cacheDir(this.dir),
        ]
      : // Box 3 only, and only because it is DECLARED rebuildable: an instrument
        // needs somewhere to open the cache, and materializing the cache's own
        // container changes no canonical state and takes no canonical lock.
        [paths.cacheDir(this.dir)]) {
      mkdirSync(sub, { recursive: true });
    }
    this.ops = openOperational(paths.operational(this.dir), {
      initialize: writesAtOpen,
      retentionDays: this.retentionDays,
      now: this.nowFn,
    });
    this.cache = openCache(paths.cache(this.dir));
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
        const doc = readProseFile(this.absolutePath(row.prose_path), id);
        indexDoc(this.cache, doc.id, indexText(doc));
      },
    });
    this.assertLayout();
  }

  static open(opts: StoreOptions = {}): Store {
    return new Store(opts);
  }

  close(): void {
    this.ops.close();
    this.cache.close();
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
    const { staged, doc } = this.mutate("put", () => this.insertOne(input));
    publishStaged(staged);
    this.indexOne(doc);
    this.emit("store.put", doc.id, { type: doc.type, kind: input.kind, hash: staged.hash });
    return doc.id;
  }

  /**
   * Atomic by default: one bad input and NOTHING lands. `isolate: true` opts into
   * per-item persistence isolation (§16 G6) — the failure is logged and skipped and
   * the rest persist. Two different promises; the caller picks, out loud.
   */
  putMany(inputs: readonly PutInput[], opts: { isolate?: boolean } = {}): string[] {
    const staged = this.mutate("putMany", () => {
      const out: { staged: Staged; doc: ProseDoc; input: PutInput }[] = [];
      for (const input of inputs) {
        try {
          out.push({ ...this.insertOne(input), input });
        } catch (err) {
          if (!opts.isolate) throw err;
          this.emit("store.put.skipped", input.id, {
            reason: err instanceof StoreError ? err.code : "UNKNOWN",
          });
        }
      }
      return out;
    });
    for (const s of staged) {
      publishStaged(s.staged);
      this.indexOne(s.doc);
      this.emit("store.put", s.doc.id, {
        type: s.doc.type,
        kind: s.input.kind,
        hash: s.staged.hash,
      });
    }
    return staged.map((s) => s.doc.id);
  }

  /**
   * In-place content revision. Archives the prior version FIRST (§16 G4).
   *
   * `learnedOn` / `happenedOn` are the PROVENANCE half, and they travel this same
   * door on purpose (§I7, `NOTES.md` 2026-09-05): correcting a date is a change to
   * canonical prose, so it keeps the prior version exactly the way a body change
   * does — constitution 7, nothing is silently overwritten and the old date stays
   * readable in `versions/`. Both write the prose frontmatter AND the column, in
   * one transaction, because a document and its query surface disagreeing about a
   * date is worse than either being wrong alone.
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
    const { staged, doc, seq } = this.mutate("revise", () => {
      const row = this.requireRow(id);
      const current = readFileSync(this.absolutePath(row.prose_path), "utf8");
      const version = archivePriorVersion(this.dir, id, current, row.revision + 1);
      this.ops.run(
        `INSERT INTO versions (memory_id, seq, reason, version_day, archived_at, path, content_hash, successor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        id,
        version.seq,
        patch.reason ?? "revise",
        this.livedDay(),
        this.nowFn(),
        version.storedPath,
        version.hash,
      );
      const prior = readProseFile(this.absolutePath(row.prose_path), id);
      const next: ProseDoc = {
        ...prior,
        body: patch.body ?? prior.body,
        meta: patch.meta ? { ...prior.meta, ...patch.meta } : prior.meta,
      };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.learnedOn !== undefined) next.learnedOn = patch.learnedOn;
      if (patch.happenedOn !== undefined) next.happenedOn = patch.happenedOn;
      const s = stageProse(this.dir, next);
      this.ops.run(
        "UPDATE memories SET content_hash = ?, revision = ? WHERE id = ?",
        s.hash,
        version.seq,
        id,
      );
      if (patch.learnedOn !== undefined) {
        this.ops.run("UPDATE memories SET learned_on = ? WHERE id = ?", patch.learnedOn, id);
      }
      if (patch.happenedOn !== undefined) {
        this.ops.run("UPDATE memories SET happened_on = ? WHERE id = ?", patch.happenedOn, id);
      }
      return { staged: s, doc: next, seq: version.seq };
    });
    publishStaged(staged);
    this.indexOne(doc);
    this.emit("store.revise", id, { seq, hash: staged.hash });
    return seq;
  }

  /**
   * Supersession: the new memory is born, the old one keeps its id, its prose, and
   * a forwarding address. `resolve(oldId)` follows it forever — the VERSION ROW is
   * what expires at H, not the ability to resolve (§5 G4, §16 G3).
   */
  supersede(oldId: string, input: PutInput, reason = "supersede"): string {
    const { staged, doc, newId } = this.mutate("supersede", () => {
      const row = this.requireRow(oldId);
      const created = this.insertOne(input);
      this.ops.run(
        `INSERT INTO versions (memory_id, seq, reason, version_day, archived_at, path, content_hash, successor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        oldId,
        row.revision + 1,
        reason,
        this.livedDay(),
        this.nowFn(),
        row.prose_path,
        row.content_hash,
        created.doc.id,
      );
      this.ops.run(
        `UPDATE memories SET superseded_by = ?, archived = 1, archived_reason = ?, revision = ?
          WHERE id = ?`,
        created.doc.id,
        reason,
        row.revision + 1,
        oldId,
      );
      return { ...created, newId: created.doc.id };
    });
    publishStaged(staged);
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

  /** Oldest first, so a story reads in the order it happened. */
  eventLog(filter: { name?: string; ref?: string; sinceDay?: number; limit?: number } = {}): EventRow[] {
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
      " ORDER BY seq ASC LIMIT ?";
    return this.ops.all<EventRow>(sql, ...args, filter.limit ?? 500);
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
   * Bounded versioning (contract §4): superseded-version ROWS older than H lived
   * days stop being tracked. Every discard reports what and how much (scar §2.4).
   * The archived prose file is left where it is — this module destroys nothing.
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
      const doc = readProseFile(this.absolutePath(row.prose_path), row.id);
      const text = indexText(doc);
      // KEEP MEANS KEEP. A row that already has a vector is not offered to the
      // embedder at all under `keepVectors` — the first version called it and
      // let `indexDoc` overwrite what it had just promised to preserve, so a
      // process with an embedder wired paid a network call per row and reported
      // the result as `keptVectors`. Two words for one behaviour is how an API
      // starts lying; the name picks the behaviour, and the caller that wants
      // fresh vectors wants a plain `rebuildCache()`.
      const held = keepVectors && heldVectors.has(row.id);
      const vec = held ? null : this.embed ? this.embed(text) : null;
      if (vec !== null) indexDoc(this.cache, row.id, text, vec);
      else {
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
  embedOne(id: string): { found: boolean; vector: boolean } {
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
    const vec = this.embed ? this.embed(indexText(doc)) : null;
    if (vec === null) return { found: true, vector: false };
    setEmbedding(this.cache, id, vec);
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
    const rows = this.ops.all<{ id: string }>(
      `SELECT id FROM memories
        WHERE archived = 0 AND superseded_by IS NULL
        ORDER BY CASE WHEN source IN ('authored', 'episode') OR type = 'episode' THEN 0 ELSE 1 END,
                 birth_day ASC, id ASC`,
    );
    const out: string[] = [];
    for (const r of rows) {
      if (embedded.has(r.id) || denied.has(r.id)) continue;
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
    const doc = readProseFile(this.absolutePath(row.prose_path), id);
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
    return readProseFile(this.absolutePath(row.path), id);
  }

  /**
   * A row's stored path (`prose_path`, a version's `path`), made absolute
   * against THIS store — the one address a caller may hand to the filesystem.
   *
   * Rows hold store-relative paths (`prose/<family>/<id>.md`; CONTRACT §5 G15),
   * so a copied or restored store names the files beside it and never the
   * files of the store it was copied from. A pre-v5 absolute row is PLACED
   * against this store by the migration's own rule, so an instrument on a v4
   * copy reads the copy's file too. `""` — a chased row's blanked pointer —
   * resolves to `""`, never to the store root; a value that would land outside
   * `prose/` or `versions/` throws `STORED_PATH_ESCAPES` (`paths.ts`).
   */
  absolutePath(storedPath: string): string {
    return resolveStoredPath(this.dir, storedPath);
  }

  /**
   * How the two path columns are spelled, and whether their files are there.
   * `verify` prints this; it is the owner's read-only view of the v5 migration
   * on a live store (constitution 16). Pure reads plus one `stat` per row.
   *
   *   relative  — the v5 shape, resolved against this store;
   *   absolute  — a pre-v5 spelling: unmigrated on a v4 store, unplaceable on a
   *               v5 one; placed against this store where a segment allows it;
   *   escaped   — would resolve outside the store's two roots; never resolved;
   *   missing   — a non-blank, resolvable pointer whose file does not exist.
   *
   * Blank pointers (removed rows) are none of these: there is nothing to resolve.
   */
  pathCensus(): { prose: PathCensus; versions: PathCensus } {
    const census = (rows: readonly { p: string }[]): PathCensus => {
      const out = { relative: 0, absolute: 0, escaped: 0, missing: 0, blank: 0 };
      for (const { p } of rows) {
        if (p.length === 0) {
          out.blank += 1;
          continue;
        }
        let resolved: string;
        try {
          resolved = this.absolutePath(p);
        } catch (err) {
          if (err instanceof StoreError && err.code === "STORED_PATH_ESCAPES") {
            out.escaped += 1;
            continue;
          }
          throw err;
        }
        if (isAbsolute(p)) out.absolute += 1;
        else out.relative += 1;
        if (!existsSync(resolved)) out.missing += 1;
      }
      return out;
    };
    return {
      prose: census(this.ops.all<{ p: string }>("SELECT prose_path AS p FROM memories")),
      versions: census(this.ops.all<{ p: string }>("SELECT path AS p FROM versions")),
    };
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
    return nearestVectors(this.cache, vec, limit);
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

  /** Runs INSIDE the caller's transaction. Stages prose; never publishes it. */
  private insertOne(input: PutInput): { staged: Staged; doc: ProseDoc } {
    const id = input.id ?? newId(input.type);
    if (!id.startsWith(`${ID_PREFIX[input.type]}_`)) {
      throw new StoreError("ID_MALFORMED", { id, type: input.type });
    }
    // A removed id is taken FOREVER. Ids are never reused (§4.2 G2), and the one
    // reuse that would matter is the one that quietly resurrects what the owner
    // removed — so the deny-list is consulted at birth as well as at read.
    if (this.has(id) || this.isDenied(id)) throw new StoreError("ID_TAKEN", { id });
    if (typeof input.body !== "string" || input.body.length === 0) {
      throw new StoreError("PROSE_BODY_INVALID", { id, reason: "empty" });
    }
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
      body: input.body,
    };
    if (input.title !== undefined) doc.title = input.title;
    if (input.happenedOn !== undefined) doc.happenedOn = input.happenedOn;
    const staged = stageProse(this.dir, doc);
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
         archived_reason, superseded_by, revision, content_hash, prose_path,
         learned_on, happened_on, source, origin_session, origin_scope, origin_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      staged.hash,
      // The ROW holds the store-relative spelling; `finalPath` is only for the
      // rename that publishes the file (§5 G15).
      staged.storedPath,
      doc.learnedOn,
      doc.happenedOn ?? null,
      input.source ?? null,
      input.origin?.session ?? null,
      input.origin?.scope ?? null,
      input.origin?.ref ?? null,
    );
    return { staged, doc };
  }

  /** Box 3 is best-effort by design: it is rebuildable, so it never fails a write. */
  private indexOne(doc: ProseDoc): void {
    const text = indexText(doc);
    const vec = this.embed ? this.embed(text) : null;
    if (vec !== null) indexDoc(this.cache, doc.id, text, vec);
    else indexDoc(this.cache, doc.id, text);
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

/** True when a data dir has already been initialized (used by adapters, not writes). */
export function storeExists(dir: string = dataDir()): boolean {
  return existsSync(paths.operational(dir));
}
