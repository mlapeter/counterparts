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
import { randomBytes } from "node:crypto";
import type { Band, Kind, MemoryPhysics, Salience } from "../types.js";
import { creditUse } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { Db } from "./db.js";
import { StoreError } from "./errors.js";
import { isObserver } from "../observer.js";
import type { Stance } from "../observer.js";
import { DEFAULT_RETENTION_DAYS, openOperational, rowToPhysics } from "./operational.js";
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
import { LAYOUT, assertLayoutClassified, assertSafeDataDir, dataDir, paths } from "./paths.js";
import {
  ID_PREFIX,
  archivePriorVersion,
  publishStaged,
  readProseFile,
  stageProse,
} from "./prose.js";
import type { ProseDoc, ProseType, Staged } from "./prose.js";
import { indexDoc, nearest, openCache, resetCache, searchIndex } from "./cache.js";
import type { Hit } from "./cache.js";

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
export { DEFAULT_RETENTION_DAYS, SCHEMA_VERSION } from "./operational.js";
export { tokenize, cosine, CACHE_SCHEMA_VERSION } from "./cache.js";
export type { Hit } from "./cache.js";
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

export type Embedder = (text: string) => number[];

export interface StoreOptions extends Stance {
  /** Defaults to `dataDir()` — resolved at call time, so tests redirect via env. */
  dir?: string;
  /** Retention for superseded-version rows, in LIVED days. TUNABLE; default 90. */
  retentionDays?: number;
  /** Optional; without it, embeddings are declared un-recomputed at rebuild. */
  embed?: Embedder;
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

export interface RebuildReport {
  indexed: number;
  skippedDenied: number;
  unrecomputed: number;
  /** Contract §5 G8: what rebuild cannot recompute is DECLARED, with owner + repair. */
  declared: { what: string; owner: string; repair: string }[];
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
  "setGateRecords",
  "pruneGateSessions",
  "appendEvent",
  "pruneEvents",
  "setRanking",
  "pruneSupersededVersions",
  "appendRemovalRecord",
  "rebuildCache",
] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];

const MAX_CHAIN = 32;
const EVENT_RING = 500;

export class Store {
  readonly dir: string;
  readonly observer: boolean;
  readonly retentionDays: number;
  private readonly ops: Db;
  private readonly cache: Db;
  private readonly embed: Embedder | undefined;
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
    // The one thing an instrument may still do is mint an ABSENT store: there is
    // no lock to contend for and no state to disturb, and every empty-store
    // instrument in the build (the dashboard's five views, a stood-down hook)
    // opens exactly that way. That mint-by-observer wart is FILED, not fixed
    // here — fixing it means changing tests in six modules this session may not
    // touch.
    const fresh = !existsSync(paths.operational(this.dir));
    const writesAtOpen = !this.observer || fresh;
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

  /** `chaseRemoved` is not a Store method — it is the owner-op seam's, and it
   *  crosses the same stance check, which is why the site name is spelled here. */
  private assertWritable(site: WriteMethod | "chaseRemoved"): void {
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
    const event: StoreEvent = { at: Date.now(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
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

  /** In-place content revision. Archives the prior version FIRST (§16 G4). */
  revise(
    id: string,
    patch: { body?: string; title?: string; meta?: Record<string, unknown>; reason?: string },
  ): number {
    const { staged, doc, seq } = this.mutate("revise", () => {
      const row = this.requireRow(id);
      const current = readFileSync(row.prose_path, "utf8");
      const version = archivePriorVersion(this.dir, id, current, row.revision + 1);
      this.ops.run(
        `INSERT INTO versions (memory_id, seq, reason, version_day, archived_at, path, content_hash, successor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        id,
        version.seq,
        patch.reason ?? "revise",
        this.livedDay(),
        Date.now(),
        version.path,
        version.hash,
      );
      const prior = readProseFile(row.prose_path, id);
      const next: ProseDoc = {
        ...prior,
        body: patch.body ?? prior.body,
        meta: patch.meta ? { ...prior.meta, ...patch.meta } : prior.meta,
      };
      if (patch.title !== undefined) next.title = patch.title;
      const s = stageProse(this.dir, next);
      this.ops.run(
        "UPDATE memories SET content_hash = ?, revision = ? WHERE id = ?",
        s.hash,
        version.seq,
        id,
      );
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
        Date.now(),
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
    this.emit("store.supersede", oldId, { successor: newId, reason });
    return newId;
  }

  /** Archive is a state, not a deletion: the id stays resolvable (§4.2 G3). */
  archive(id: string, reason: string): void {
    this.mutate("archive", () => {
      this.requireRow(id);
      this.ops.run("UPDATE memories SET archived = 1, archived_reason = ? WHERE id = ?", reason, id);
    });
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
        Date.now(),
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
   * Bounded retention — logs are telemetry, not canonical memory (CLAUDE.md's one
   * named exception to no-silent-destruction). Events carrying a `dedupKey` are
   * KEPT regardless of age: they are the replay latch, and sweeping one would let
   * a replayed day re-append a record the store already accounted for.
   */
  pruneEvents(): PruneReport {
    const report = this.mutate("pruneEvents", () => {
      const cutoffDay = this.livedDay() - this.retentionDays;
      const doomed = this.ops.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM events WHERE day < ? AND dedup_key IS NULL",
        cutoffDay,
      );
      this.ops.run("DELETE FROM events WHERE day < ? AND dedup_key IS NULL", cutoffDay);
      return { pruned: doomed?.n ?? 0, cutoffDay, retentionDays: this.retentionDays };
    });
    this.emit("store.events.pruned", undefined, {
      count: report.pruned,
      cutoffDay: report.cutoffDay,
    });
    return report;
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
        Date.now(),
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
  rebuildCache(): RebuildReport {
    this.assertWritable("rebuildCache");
    resetCache(this.cache);
    const denied = new Set(this.deniedIds());
    const rows = this.ops.all<MemoryRow>("SELECT * FROM memories ORDER BY id");
    let indexed = 0;
    let skippedDenied = 0;
    let unrecomputed = 0;
    for (const row of rows) {
      if (denied.has(row.id)) {
        // A stray copy of a removed memory is skipped and LOGGED, never deleted (§16 G12).
        skippedDenied += 1;
        this.emit("cache.rebuild.denied", row.id, {});
        continue;
      }
      const doc = readProseFile(row.prose_path, row.id);
      const text = indexText(doc);
      if (this.embed) indexDoc(this.cache, row.id, text, this.embed(text));
      else {
        indexDoc(this.cache, row.id, text);
        unrecomputed += 1;
      }
      indexed += 1;
    }
    const declared = this.embed
      ? []
      : [
          {
            what: "embeddings",
            owner: "encode/ (the embedder)",
            repair: "Store.open({ embed }) then rebuildCache()",
          },
        ];
    const report: RebuildReport = { indexed, skippedDenied, unrecomputed, declared };
    this.emit("cache.rebuild", undefined, {
      indexed,
      skippedDenied,
      unrecomputed,
      declaredKinds: declared.map((d) => d.what).join(",") || "none",
    });
    return report;
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
    const doc = readProseFile(row.prose_path, id);
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

  list(filter: { type?: ProseType; kind?: Kind; band?: Band; archived?: boolean } = {}): string[] {
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
    const sql = `SELECT id FROM memories ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
    return this.ops.all<{ id: string }>(sql, ...args).map((r) => r.id);
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
    return readProseFile(row.path, id);
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

  search(cue: string, limit = 10): Hit[] {
    return searchIndex(this.cache, cue, limit);
  }

  nearestTo(vec: readonly number[], limit = 10): Hit[] {
    return nearest(this.cache, vec, limit);
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
    const doc: ProseDoc = {
      id,
      type: input.type,
      learnedOn: input.learnedOn ?? today(),
      bornDay: input.physics?.birthDay ?? day,
      meta: input.meta ?? {},
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
         learned_on, happened_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, ?)`,
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
      staged.finalPath,
      doc.learnedOn,
      doc.happenedOn ?? null,
    );
    return { staged, doc };
  }

  /** Box 3 is best-effort by design: it is rebuildable, so it never fails a write. */
  private indexOne(doc: ProseDoc): void {
    const text = indexText(doc);
    if (this.embed) indexDoc(this.cache, doc.id, text, this.embed(text));
    else indexDoc(this.cache, doc.id, text);
  }
}

function indexText(doc: ProseDoc): string {
  return [doc.title ?? "", doc.body].join("\n");
}

export function newId(type: ProseType): string {
  return `${ID_PREFIX[type]}_${randomBytes(6).toString("hex")}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True when a data dir has already been initialized (used by adapters, not writes). */
export function storeExists(dir: string = dataDir()): boolean {
  return existsSync(paths.operational(dir));
}
