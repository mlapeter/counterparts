/**
 * `tools/parallel/readers.ts` — every source the instrument reads, READ-ONLY.
 *
 * CONTRACT §5 G1: "the instrument writes nothing but its own run directory."
 * This file is the half that must never write at all, and it is enforced two
 * ways rather than promised: it imports NO filesystem write API (a source-scan
 * in `test/parallel.test.ts` fails the suite if that changes — the pattern is
 * `tools/migrate/read.ts`'s, copied deliberately), and the sqlite handle it
 * opens is probed with an attempted write whose REFUSAL is recorded on the day
 * record, exactly as `tools/replay/corpus.ts` does it.
 *
 * EVERY REAL PATH IS A PARAMETER. Nothing in this file resolves `~/.bansai`,
 * `~/.counterparts`, `~/.memory-ab` or `~/.claude/projects` on its own; the
 * defaults live in `bin/`, where a human types them. That is what lets the
 * suite be hermetic without the tool being a toy.
 *
 * WHAT IS NOT HERE, AND WHY IT IS NAMED INSTEAD OF ZEROED. The brief and the
 * CONTRACT both list v2 detectors — `adapter.wake.injected`, `adapter.recall`,
 * `adapter.episode.ask`, `sleep.symmetry`, `remember.span.quarantined`,
 * `self.schema.*` — as if they were readable out of box 2. They are not: box
 * 2's `events` table takes exactly the eight names in
 * `adapters/dashboard/registries.ts`'s `DURABLE_EVENTS`, and those six are
 * EPHEMERAL ring events that die with the hook process. Counting them from the
 * store would return 0 forever, and a fabricated zero reads as evidence of
 * silence — scar §2.4, and the precise failure §5 G4 exists to prevent. So the
 * reader returns them in `nonDurable`, by name, and the day record prints them
 * as absent BY CONSTRUCTION. It is a real gap in §5 G2 ("recomputable from the
 * two durable stores"), and this is where it is visible.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

import {
  AB_DIR_ENV,
  FOREIGN_MARKERS,
  assignmentHealth,
  assignmentPath,
  classifyBlock,
} from "../../src/adapters/claude-code/index.js";
import type { AssignmentHealth } from "../../src/adapters/claude-code/index.js";
import {
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RECALL_DECISION_EVENT,
} from "../../src/core/counterpart.js";
import { isWithin } from "../../src/core/store/paths.js";
import { MEMORY_SOURCES } from "../../src/core/types.js";

import type {
  CanaryHit,
  CanaryScan,
  HookDurations,
  HookModelReport,
  V1DayCounts,
  V1SessionOrder,
  V2DayCounts,
} from "./types.js";

const require_ = createRequire(import.meta.url);

export class ReaderError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, string | number | boolean>>;
  constructor(code: string, detail: Record<string, string | number | boolean> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "ReaderError";
    this.code = code;
    this.detail = detail;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) v1's event log for one date
// ═══════════════════════════════════════════════════════════════════════════

/**
 * v1's per-turn capture event — the closest thing its log has to a
 * conversational turn, and the one the active-day floor K is counted against.
 * `docs/harvest/log-audit.md` §3 classes it with the interactive-session
 * mechanisms (real distinct-session counts), not the background cycle.
 */
export const V1_TURN_EVENT = "buffer.append";

/** v1's per-write event. An UPPER BOUND on creations: archive-on-overwrite
 *  fires it too (log-audit §2a). Named as a bound, never laundered into one. */
export const V1_CREATED_EVENT = "store.write";
/** v1's only exit path in the audited window. */
export const V1_EXITED_EVENT = "decay.expire";

/** G4's v1-side contamination detectors, per channel. ONE list, exported. */
export const V1_WAKE_EVENTS: readonly string[] = ["wake.rendered", "wake.delivered"];
export const V1_RECALL_EVENT = "surface.decision";
export const V1_RITUAL_EVENT = "episode.asked";

/** Every v1 line type the day record copies into the run directory (G2). */
export const V1_DETECTOR_TYPES: readonly string[] = [
  "ab.muted",
  "wake.rendered",
  "wake.delivered",
  "surface.decision",
  "episode.asked",
  "session.start",
  "session.end",
  V1_TURN_EVENT,
  V1_CREATED_EVENT,
  V1_EXITED_EVENT,
];

export interface V1Line {
  readonly type: string;
  /**
   * v1's OWN `seq`, carried for the record and never for ordering. v1 stamps it
   * per PROCESS and every hook is a fresh process, so it resets many times a
   * day: two lines with seq 3 and seq 1 say nothing about which happened first
   * (review blocker 4). `ordinal` and `ts` are the clocks.
   */
  readonly declaredSeq: number | null;
  /** This line's position in the day's file. The tiebreak clock, always total. */
  readonly ordinal: number;
  readonly session: string | null;
  readonly ts: string | null;
  readonly hook: string | null;
  readonly phase: string | null;
  /** The raw line, kept ONLY so `record.ts` can copy detector lines verbatim. */
  readonly raw: string;
}

/**
 * IS `a` LATER THAN `b`? — the one ordering rule this file has, stated once.
 *
 * The ISO timestamp decides when both lines carry one and they differ; the
 * file's own order decides otherwise. v1 appends its log, so the file order is
 * a real clock; `seq` is not, because it restarts in every hook process.
 */
export function laterThan(a: V1Line, b: V1Line): boolean {
  if (a.ts !== null && b.ts !== null && a.ts !== b.ts) return a.ts > b.ts;
  return a.ordinal > b.ordinal;
}

export function v1LogPath(v1Dir: string, date: string): string {
  return join(v1Dir, "logs", `events-${date}.jsonl`);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Every parsed line of one v1 day, in file order. Tolerant, and counted. */
export function readV1Lines(
  v1Dir: string,
  date: string,
): { lines: V1Line[]; malformed: number; present: boolean; path: string } {
  const path = v1LogPath(v1Dir, date);
  if (!existsSync(path)) return { lines: [], malformed: 0, present: false, path };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { lines: [], malformed: 0, present: false, path };
  }
  const lines: V1Line[] = [];
  let malformed = 0;
  let ordinal = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      malformed += 1;
      continue;
    }
    const o = asRecord(parsed);
    const type = o === null ? null : str(o["type"]);
    if (o === null || type === null) {
      malformed += 1;
      continue;
    }
    // `declared ?? ordinal` MIXED TWO CLOCKS INTO ONE FIELD and then compared
    // across them. v1's `seq` counts within one hook PROCESS and restarts with
    // the next, so a delivery at seq 3 and a later mute at seq 1 read as
    // "earlier" and the straddling session — the flip's own signature — went
    // unseen. The two clocks are kept apart here and only the honest ones are
    // compared (see `laterThan`).
    const declared = typeof o["seq"] === "number" && Number.isFinite(o["seq"]) ? o["seq"] : null;
    lines.push({
      type,
      declaredSeq: declared,
      ordinal,
      session: str(o["session"]),
      ts: str(o["ts"]),
      hook: str(o["hook"]),
      phase: str(o["phase"]),
      raw: trimmed,
    });
    ordinal += 1;
  }
  return { lines, malformed, present: true, path };
}

function bump(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

/**
 * One v1 day, counted — including the per-session ordering the MIXED class
 * needs. "Straddled" is a DELIVERY followed LATER in the same session by an
 * `ab.muted`: v1 re-reads the assignment file at every hook and latches nothing
 * per session, so a mid-session flip is two voices in one context (§5 G3).
 */
export function readV1Day(v1Dir: string, date: string): V1DayCounts {
  const { lines, malformed, present, path } = readV1Lines(v1Dir, date);
  const byType: Record<string, number> = {};
  const abMutedByHook: Record<string, number> = {};
  let surfaceInject = 0;

  interface Order {
    firstDelivery: V1Line | null;
    lastMuted: V1Line | null;
    mutedAtStart: boolean;
  }
  const order = new Map<string, Order>();
  const orderFor = (session: string): Order => {
    const found = order.get(session);
    if (found !== undefined) return found;
    const fresh: Order = { firstDelivery: null, lastMuted: null, mutedAtStart: false };
    order.set(session, fresh);
    return fresh;
  };

  for (const line of lines) {
    bump(byType, line.type);
    if (line.type === "ab.muted") {
      bump(abMutedByHook, line.hook ?? "unknown");
      if (line.session !== null) {
        const o = orderFor(line.session);
        if (o.lastMuted === null || laterThan(line, o.lastMuted)) o.lastMuted = line;
        if (line.hook === "session_start") o.mutedAtStart = true;
      }
      continue;
    }
    if (line.type === V1_RECALL_EVENT && line.phase === "inject") surfaceInject += 1;
    const isDelivery =
      V1_WAKE_EVENTS.includes(line.type) ||
      (line.type === V1_RECALL_EVENT && line.phase === "inject") ||
      line.type === V1_RITUAL_EVENT;
    if (isDelivery && line.session !== null) {
      const o = orderFor(line.session);
      if (o.firstDelivery === null || laterThan(o.firstDelivery, line)) o.firstDelivery = line;
    }
  }

  const sessions: V1SessionOrder[] = [...order.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([session, o]) => ({
      session,
      firstDelivery: o.firstDelivery === null ? null : o.firstDelivery.ordinal,
      lastMuted: o.lastMuted === null ? null : o.lastMuted.ordinal,
      firstDeliveryAt: o.firstDelivery?.ts ?? null,
      lastMutedAt: o.lastMuted?.ts ?? null,
      straddled:
        o.firstDelivery !== null && o.lastMuted !== null && laterThan(o.lastMuted, o.firstDelivery),
    }));

  return {
    present,
    path,
    lines: lines.length,
    malformed,
    byType,
    abMutedByHook,
    wakeRendered: byType["wake.rendered"] ?? 0,
    wakeDelivered: byType["wake.delivered"] ?? 0,
    surfaceInject,
    episodeAsked: byType[V1_RITUAL_EVENT] ?? 0,
    sessionStart: byType["session.start"] ?? 0,
    sessionEnd: byType["session.end"] ?? 0,
    turns: byType[V1_TURN_EVENT] ?? 0,
    sessions,
    mutedAtSessionStart: [...order.entries()]
      .filter(([, o]) => o.mutedAtStart)
      .map(([session]) => session)
      .sort(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// (b) v2's operational.sqlite, opened READ-ONLY
// ═══════════════════════════════════════════════════════════════════════════

interface RawStatement {
  all(...p: unknown[]): unknown;
}
export interface RawDb {
  prepare(sql: string): RawStatement;
  exec(sql: string): unknown;
  close(): unknown;
}

/** How a handle on the live store is obtained. Production has exactly one. */
export type StoreOpener = (path: string) => RawDb;

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

/**
 * Read-only on both runtimes, and deliberately NOT `Store.open()` — which
 * mkdirs the data directory and runs DDL at open, i.e. writes into the live
 * store the instrument is supposed to observe (CONTRACT §5 Inputs, CLI §7).
 * Same opener shape as `tools/replay/corpus.ts`, same reason.
 */
export function openReadOnly(path: string): RawDb {
  if (isBun()) {
    const { Database } = require_("bun:sqlite") as {
      Database: new (p: string, o?: unknown) => RawDb;
    };
    return new Database(path, { readonly: true });
  }
  const { DatabaseSync } = require_("node:sqlite") as {
    DatabaseSync: new (p: string, o?: unknown) => RawDb;
  };
  return new DatabaseSync(path, { readOnly: true });
}

/**
 * How long a read waits for a writer's lock before it becomes a READ ERROR.
 *
 * The subjects are LIVE and write their own stores while the instrument reads
 * them (CONTRACT §5 Inputs), so a hook holding a write lock at the moment the
 * daily runs is ordinary, not exceptional. Without a busy timeout every such
 * read raced and lost silently; with one it waits, and if it still loses the
 * failure is carried on the record rather than swallowed into a zero.
 */
export const READ_BUSY_TIMEOUT_MS = 5_000;

/** The name the write probe would create if the read-only flag did not take. */
const PROBE_TABLE = "__parallel_probe";

export type ReadOnlyVerdict = "refused" | "writable" | "inconclusive";

export interface ReadOnlyProbe {
  readonly verdict: ReadOnlyVerdict;
  /** sqlite's own words. Never store content — this is DDL, not a row read. */
  readonly detail: string;
}

function messageOf(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? `${e.code}: ` : "";
  return `${code}${typeof e?.message === "string" ? e.message : String(err)}`;
}

/**
 * A refusal is only a refusal when sqlite says READONLY. `SQLITE_BUSY` — a live
 * hook holding the write lock — would otherwise read as proof of read-only-ness,
 * which is a fabricated guarantee: the handle might be perfectly writable and
 * merely blocked this instant (scar §2.4's shape, applied to a lock).
 */
function isReadOnlyRefusal(err: unknown): boolean {
  const text = messageOf(err).toLowerCase();
  return text.includes("readonly") || text.includes("read-only") || text.includes("read only");
}

/**
 * THE WRITE PROBE, and it leaves NOTHING behind on either outcome.
 *
 * The old probe was `CREATE TABLE IF NOT EXISTS __parallel_probe` executed
 * bare: if the read-only flag ever failed to take, that statement was a real,
 * committed, un-rolled-back WRITE into the owner's live store — the instrument
 * breaking CONTRACT §5 G1 in the very line that claims to verify it.
 *
 * So the write is wrapped: `BEGIN IMMEDIATE` … `CREATE TABLE` … `ROLLBACK`. On
 * a read-only handle the DDL is refused inside an empty transaction; on a
 * writable one it lands and is rolled back, and the store file is byte-identical
 * either way (verified against bun:sqlite before this was written). `BEGIN
 * IMMEDIATE` alone is NOT the discriminator — measured 2026-09-03: bun's
 * read-only handle accepts it and defers the lock — so the DDL is what decides.
 */
export function probeReadOnly(db: RawDb): ReadOnlyProbe {
  let began = false;
  let wrote = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    began = true;
    db.exec(`CREATE TABLE ${PROBE_TABLE} (x INTEGER)`);
    wrote = true;
    return {
      verdict: "writable",
      detail: "the handle ACCEPTED a DDL write; the read-only flag did not take",
    };
  } catch (err) {
    return {
      verdict: isReadOnlyRefusal(err) ? "refused" : "inconclusive",
      detail: messageOf(err),
    };
  } finally {
    if (began) {
      try {
        db.exec("ROLLBACK");
      } catch (err) {
        // A failed rollback after a landed write is the one path that can leave
        // the probe table behind. It is a red-line and it is named, never
        // shrugged off in a bare `catch {}`.
        if (wrote) {
          throw new ReaderError("PROBE_ROLLBACK_FAILED", {
            table: PROBE_TABLE,
            detail: messageOf(err),
          });
        }
      }
    }
  }
}

/**
 * The DURABLE detectors the CONTRACT names that box 2 CANNOT carry. Read the
 * file header for why this list exists rather than six zero counters.
 */
export const NON_DURABLE_DETECTORS: readonly string[] = [
  // Recomputable read-only rather than durable as a row: the symmetry verdict
  // is arithmetic over `band.transition`; the quarantine count is the lines of
  // each scope's `quarantine.jsonl`; the self-store bytes are `schemaBytes` over
  // the rows. Named here so a day record never reports them as a zero.
  "sleep.symmetry",
  "remember.span.quarantined",
  "self.schema.pressure",
  "self.schema.tripped",
  "self.schema.quarantined",
];

/**
 * The durable names this reader counts. All exist in `DURABLE_EVENTS`. The four
 * delivery records became durable on 2026-09-03 for exactly this reader's
 * sake: in Phase S they are the contamination detectors on v2's side (§5 G4),
 * and each carries `date` and `session` in its payload.
 */
/**
 * The two durable events that record a memory LEAVING the live set.
 *
 * `versions.archived_at` never was that record: `Store.archive()` writes no
 * versions row at all (read `store/index.ts#archive` — it is one UPDATE on
 * `memories`), so the join this reader used to perform counted zero forever and
 * reported it as a fact. These two rows are the real exit evidence, and they
 * are emitted by `sleep/prune.ts` and `sleep/dedup.ts` with the memory id in
 * `ref` (scar §2.17's other half: created-versus-exited, per kind, per system).
 */
export const MEMORY_PRUNED_EVENT = "memory.pruned";
export const MEMORY_MERGED_EVENT = "memory.merged";
export const DURABLE_EXIT_EVENTS: readonly string[] = [MEMORY_PRUNED_EVENT, MEMORY_MERGED_EVENT];

export const DURABLE_DETECTORS: readonly string[] = [
  PRIMACY_STANDDOWN_EVENT,
  PRIMACY_DELIVER_EVENT,
  "adapter.wake.injected",
  "adapter.wake.delivered",
  "adapter.recall",
  "adapter.episode.ask",
  "gate.chunk",
  "band.transition",
  // Precondition 9's evidence: the per-turn surfacing decision, durable. The
  // S→P preflight reads its presence out of the store rather than taking the
  // CONTRACT's word that it is persisted (replay INTERFACE-GAPS §7).
  RECALL_DECISION_EVENT,
  ...DURABLE_EXIT_EVENTS,
];

export function v2StorePath(dataDir: string): string {
  return join(dataDir, "operational.sqlite");
}

export interface V2DayOptions {
  /**
   * The store's LIVED day for this calendar date, when the caller knows it.
   * `gate.chunk` and `band.transition` carry NO date in their payloads (read
   * their emit sites: `counterpart.ts` and `sleep/types.ts`), so the only
   * attribution available for them is the `day` column — which is the lived
   * day, not the calendar day. Absent, those counts are reported as
   * unattributed rather than guessed.
   */
  readonly livedDay?: number;
  /**
   * The row cap. It is a BACKSTOP now rather than the selection rule: the query
   * filters by name and by day/date in SQL, so a real day's rows are bounded by
   * the day, not by an arbitrary head of the table.
   */
  readonly limit?: number;
  /**
   * TEST SEAM, and the only one in this file. Production never passes it — the
   * read-only opener above is the sole handle on a live store. The suite passes
   * a deliberately WRITABLE opener to prove the write probe actually refuses:
   * that guard is otherwise unfalsifiable, because sqlite's own read-only flag
   * is exactly what it exists to distrust.
   */
  readonly open?: StoreOpener;
}

const DEFAULT_EVENT_LIMIT = 200_000;

interface OpenStore {
  readonly db: RawDb;
  /** Always `true` when this returns: a false verdict THROWS instead. */
  readonly readOnlyProof: true;
}

/**
 * Open the live store, prove the handle cannot write, and REFUSE to read
 * through one that can.
 *
 * The old shape recorded the verdict on the day record and read on regardless,
 * which made §5 G1 a field in a JSON file rather than a guarantee. A handle
 * that accepts a write is an instrument that could corrupt the subject; there
 * is nothing to report from it that is worth the risk of holding it open.
 */
function openStore(path: string, open: StoreOpener = openReadOnly): OpenStore {
  const db = open(path);
  const shut = (): void => {
    try {
      db.close();
    } catch {
      /* the handle is being abandoned either way */
    }
  };
  try {
    // Allowed on a read-only handle (measured on bun:sqlite 1.3), and needed:
    // the subjects write these stores while this reads them.
    db.exec(`PRAGMA busy_timeout = ${READ_BUSY_TIMEOUT_MS}`);
  } catch {
    /* an older build without the pragma still reads; the timeout is a courtesy */
  }
  let probe: ReadOnlyProbe;
  try {
    probe = probeReadOnly(db);
  } catch (err) {
    shut();
    throw err;
  }
  if (probe.verdict !== "refused") {
    shut();
    throw new ReaderError("STORE_NOT_PROVED_READ_ONLY", {
      path,
      verdict: probe.verdict,
      detail: probe.detail,
    });
  }
  return { db, readOnlyProof: true };
}

/**
 * One read, and its failure if it fails. `catch { return [] }` turned a locked
 * or schema-drifted store into an empty day that looked lived — the fabricated
 * zero scar §2.4 names. Errors accumulate on the day record and POISON its
 * detectors; nothing downstream may read a count taken beside one.
 */
function rowsOf<T>(ctx: { db: RawDb; errors: string[] }, sql: string, ...args: unknown[]): T[] {
  try {
    return ctx.db.prepare(sql).all(...args) as T[];
  } catch (err) {
    // The SQL and sqlite's message — schema vocabulary, never row content.
    ctx.errors.push(`${sql.replace(/\s+/g, " ").trim().slice(0, 80)} — ${messageOf(err)}`);
    return [];
  }
}

const EMPTY_V2 = (path: string): V2DayCounts => ({
  present: false,
  path,
  // NOT `true`. An absent store was never opened, so nothing was proved about
  // it; claiming the proof here is the same fabrication as claiming a zero.
  readOnlyProof: null,
  livedDayNow: null,
  lastActiveDate: null,
  truncated: false,
  eventRowsRead: 0,
  readErrors: [],
  byNameForDate: {},
  primacyByHook: { deliver: {}, standdown: {} },
  bySessionForDate: {},
  byNameForLivedDay: {},
  livedDayRead: null,
  nonDurable: [...NON_DURABLE_DETECTORS],
  memories: {
    total: 0,
    byKind: {},
    bySource: {},
    createdOnDate: 0,
    createdByKind: {},
    createdBySource: {},
    exitedOnDate: null,
    exitedByKind: {},
    exitedNote: "no store was opened",
    archivedTotal: 0,
  },
});

/** UTC calendar date of an epoch-ms stamp. */
export function dateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `IN (?, ?, …)` for a fixed name list — the names are ours, never input. */
function placeholders(n: number): string {
  return new Array(n).fill("?").join(", ");
}

export function readV2Day(dataDir: string, date: string, opts: V2DayOptions = {}): V2DayCounts {
  const path = v2StorePath(dataDir);
  if (!existsSync(path)) return EMPTY_V2(path);
  const { db, readOnlyProof } = openStore(path, opts.open);
  const ctx = { db, errors: [] as string[] };
  try {
    const limit = opts.limit ?? DEFAULT_EVENT_LIMIT;

    const meta = rowsOf<{ key: string; value: string }>(ctx, "SELECT key, value FROM meta");
    const metaOf = (key: string): string | null =>
      meta.find((m) => m.key === key)?.value ?? null;
    const livedDayRaw = metaOf("livedDay");
    const livedDayNow = livedDayRaw === null ? null : Number.parseInt(livedDayRaw, 10);

    const livedDay = opts.livedDay ?? null;

    // THE DAY IS SELECTED IN SQL, not carved out of the head of the table.
    // `ORDER BY seq ASC LIMIT n` kept the OLDEST rows on overflow, so a store
    // with history reported a floor made of the wrong day entirely. The filter
    // is the day: the payload's calendar `date` for the adapter rows, the `day`
    // column for the core rows that carry no date. `DESC` is the backstop's
    // direction — if the cap is ever reached it is the NEWEST rows that survive.
    const names = [...DURABLE_DETECTORS];
    const events = rowsOf<{ name: string; day: number; ref: string | null; payload: string | null }>(
      ctx,
      `SELECT name, day, ref, payload FROM events
        WHERE name IN (${placeholders(names.length)})
          AND (day = ? OR payload LIKE ?)
        ORDER BY seq DESC LIMIT ?`,
      ...names,
      // `day` is a non-negative counter, so -1 matches nothing when the caller
      // gave no lived day — the date half of the OR then carries the query.
      livedDay ?? -1,
      `%"date":"${date}"%`,
      limit,
    );

    const byNameForDate: Record<string, number> = {};
    const byNameForLivedDay: Record<string, number> = {};
    const deliver: Record<string, number> = {};
    const standdown: Record<string, number> = {};
    const bySessionForDate: Record<string, Record<string, number>> = {};
    const exitedRefs: { ref: string | null; name: string }[] = [];

    for (const row of events) {
      let payload: Record<string, unknown> = {};
      if (row.payload !== null) {
        try {
          payload = (asRecord(JSON.parse(row.payload)) ?? {}) as Record<string, unknown>;
        } catch {
          payload = {};
        }
      }
      // The ADAPTER events carry the calendar date in their payload, on
      // purpose: the `day` column is the store's lived day, which no hook
      // advances (`hooks.ts#deliveryVerdict`, and the adapter test that pins
      // it). So date attribution runs off the payload for those.
      if (payload["date"] === date) {
        bump(byNameForDate, row.name);
        const hook = str(payload["hook"]) ?? "unknown";
        if (row.name === PRIMACY_DELIVER_EVENT) bump(deliver, hook);
        if (row.name === PRIMACY_STANDDOWN_EVENT) bump(standdown, hook);
        // PER SESSION, which the `silent` class needs and used to approximate
        // away: every adapter record carries `session: input.sessionId`
        // (`hooks.ts#deliveryVerdict` and `#record`), the HOST's session id —
        // the same id v1 stamps on its own log lines.
        const session = str(payload["session"]);
        if (session !== null) {
          const into = bySessionForDate[session] ?? {};
          bump(into, row.name === PRIMACY_DELIVER_EVENT ? `deliver:${hook}` : row.name);
          bySessionForDate[session] = into;
        }
      }
      if (livedDay !== null && row.day === livedDay) {
        bump(byNameForLivedDay, row.name);
        if (DURABLE_EXIT_EVENTS.includes(row.name)) exitedRefs.push({ ref: row.ref, name: row.name });
      }
    }

    // ── memory rows: kind × mint source, and the day's created-vs-exited ─────
    const memories = rowsOf<{
      id: string;
      kind: string;
      source: string | null;
      learned_on: string;
      archived: number;
    }>(ctx, "SELECT id, kind, source, learned_on, archived FROM memories");

    const byKind: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const createdByKind: Record<string, number> = {};
    const createdBySource: Record<string, number> = {};
    let createdOnDate = 0;
    let archivedTotal = 0;
    for (const m of memories) {
      bump(byKind, m.kind);
      // A NULL source is "unrecorded", never defaulted (core/types.ts).
      const source =
        m.source !== null && (MEMORY_SOURCES as readonly string[]).includes(m.source)
          ? m.source
          : m.source === null
            ? "unrecorded"
            : m.source;
      bump(bySource, source);
      if (m.archived === 1) archivedTotal += 1;
      if (m.learned_on === date) {
        createdOnDate += 1;
        bump(createdByKind, m.kind);
        bump(createdBySource, source);
      }
    }

    // EXIT is the DURABLE EXIT EVENTS, counted by the store's lived day.
    //
    // The join this used to perform — `memories.archived` against
    // `versions.archived_at` — could only ever return zero: `Store.archive()`
    // writes no versions row. So the number was a fabricated zero dressed as a
    // measurement. `memory.pruned` and `memory.merged` are the real record, and
    // they carry only the LIVED day, so without one this reads `not-exercised`
    // (null) with the reason on the record rather than a guessed zero.
    const kindById = new Map(memories.map((m) => [m.id, m.kind]));
    const exitedByKind: Record<string, number> = {};
    let exitedOnDate: number | null = null;
    let exitedNote: string;
    if (livedDay === null) {
      exitedNote = `not-exercised: \`${MEMORY_PRUNED_EVENT}\` and \`${MEMORY_MERGED_EVENT}\` carry only the store's LIVED day (no hook advances it and neither event stamps a calendar date), so no --lived-day means no attributable exit count`;
    } else {
      const seen = new Set<string>();
      for (const e of exitedRefs) {
        const id = e.ref;
        if (id === null || seen.has(id)) continue;
        seen.add(id);
        bump(exitedByKind, kindById.get(id) ?? "unknown");
      }
      exitedOnDate = seen.size;
      exitedNote = `durable \`${MEMORY_PRUNED_EVENT}\`/\`${MEMORY_MERGED_EVENT}\` rows on lived day ${livedDay}, de-duplicated by the memory id in \`ref\``;
    }

    return {
      present: true,
      path,
      readOnlyProof,
      livedDayNow: livedDayNow !== null && Number.isFinite(livedDayNow) ? livedDayNow : null,
      lastActiveDate: metaOf("lastActiveDate"),
      truncated: events.length >= limit,
      eventRowsRead: events.length,
      readErrors: [...ctx.errors],
      byNameForDate,
      primacyByHook: { deliver, standdown },
      bySessionForDate,
      byNameForLivedDay,
      livedDayRead: livedDay,
      nonDurable: [...NON_DURABLE_DETECTORS],
      memories: {
        total: memories.length,
        byKind,
        bySource,
        createdOnDate,
        createdByKind,
        createdBySource,
        exitedOnDate,
        exitedByKind,
        exitedNote,
        archivedTotal,
      },
    };
  } finally {
    db.close();
  }
}

/**
 * The prose paths of every row whose mint source is `migrated`.
 *
 * The cross-encoding meter excludes them BY CONSTRUCTION (§5 G7, PR-2
 * doctrine): v1-origin text in v2's store is the migration, not contamination.
 * The exclusion is by ROW rather than by path convention — a migrated row's
 * prose file sits in the same directory as an authored one — which is why this
 * has to come off the store rather than off the filesystem.
 */
export interface ProseRow {
  /** The path as the row spells it. */
  readonly path: string;
  /** The SAME path realpathed — the only spelling a filesystem join may use. */
  readonly realpath: string;
  readonly source: string | null;
  readonly learnedOn: string;
}

/**
 * Every live row's prose path, its mint source and its created date.
 *
 * REALPATH ON BOTH SIDES. The join that used this was raw string equality
 * against a directory walk, and on macOS `/var/...` walks as
 * `/private/var/...`: every migrated row silently failed to match its own file
 * and re-entered the meter as contamination. `realpathOr` is the one spelling
 * rule this tool has (scar §2.13), and it is applied here at the source.
 */
export function proseRows(dataDir: string): { rows: ProseRow[]; readErrors: string[] } {
  const path = v2StorePath(dataDir);
  if (!existsSync(path)) return { rows: [], readErrors: [] };
  const { db } = openStore(path);
  const ctx = { db, errors: [] as string[] };
  try {
    const rows = rowsOf<{
      prose_path: string;
      source: string | null;
      learned_on: string;
    }>(ctx, "SELECT prose_path, source, learned_on FROM memories WHERE archived = 0").map((r) => ({
      path: r.prose_path,
      realpath: realpathOr(r.prose_path),
      source: r.source,
      learnedOn: r.learned_on,
    }));
    return { rows, readErrors: [...ctx.errors] };
  } finally {
    db.close();
  }
}

/** The realpaths of every `migrated` row's prose. The meter's exclusion set. */
export function migratedProse(dataDir: string): string[] {
  return proseRows(dataDir)
    .rows.filter((r) => r.source === "migrated")
    .map((r) => r.realpath);
}

// ── the self-store byte reading (precondition 5), reproduced read-only ──────

export interface SchemaBytesReading {
  readonly present: boolean;
  readonly bytes: number;
  readonly elements: number;
  readonly quarantined: number;
  readonly empty: boolean;
  /** Reads that FAILED. A byte total taken beside one is not a reading. */
  readonly readErrors: readonly string[];
}

/**
 * `self/identity.ts#schemaBytes`, reproduced against a read-only handle.
 *
 * It cannot be CALLED: it takes a `Store`, and `Store.open()` mkdirs and runs
 * DDL. So the rule is reproduced here, one clause at a time, from that
 * function's own body:
 *
 *   the weighed set = rows where (band = 'identity' OR kind = 'self') AND NOT
 *   archived, MINUS the F8 quarantine (source = 'fallback' AND band <>
 *   'identity' AND protected <> 1), and each row weighs the BYTE LENGTH OF ITS
 *   PROSE BODY — `enumerateOne` → `byteLength(doc.body)`, the text below the
 *   frontmatter fence, never the frontmatter itself.
 *
 * A row whose prose file cannot be read weighs nothing, exactly as
 * `enumerateOne` returns null for it.
 */
export function readSchemaBytes(dataDir: string): SchemaBytesReading {
  const path = v2StorePath(dataDir);
  if (!existsSync(path)) {
    return { present: false, bytes: 0, elements: 0, quarantined: 0, empty: true, readErrors: [] };
  }
  const { db } = openStore(path);
  const ctx = { db, errors: [] as string[] };
  try {
    const rows = rowsOf<{
      id: string;
      band: string;
      kind: string;
      source: string | null;
      protected: number;
      prose_path: string;
    }>(
      ctx,
      `SELECT id, band, kind, source, protected, prose_path FROM memories
        WHERE archived = 0 AND (band = 'identity' OR kind = 'self')`,
    );
    let bytes = 0;
    let elements = 0;
    let quarantined = 0;
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (row.source === "fallback" && row.band !== "identity" && row.protected !== 1) {
        quarantined += 1;
        continue;
      }
      const body = proseBody(row.prose_path);
      if (body === null) continue;
      bytes += Buffer.byteLength(body, "utf8");
      elements += 1;
    }
    const total = rowsOf<{ n: number }>(ctx, "SELECT COUNT(*) AS n FROM memories")[0]?.n ?? 0;
    return { present: true, bytes, elements, quarantined, empty: total === 0, readErrors: [...ctx.errors] };
  } finally {
    db.close();
  }
}

const FENCE = "---";

/**
 * The BODY of a prose file: everything below the closing frontmatter fence.
 * `store/prose.ts` serializes `---\n<lines>\n---\n<body>`; this reads the same
 * split, so a byte count here equals `readProse(...).body`'s.
 */
export function proseBody(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) return raw;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === FENCE) return lines.slice(i + 1).join("\n");
  }
  return raw;
}

// ═══════════════════════════════════════════════════════════════════════════
// (c) the host transcript canary, and the hook execution model
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The host's shared SessionEnd budget, in ms.
 *
 * SOURCE: Claude Code's hooks documentation — SessionEnd hooks share a 1.5 s
 * window, after which the host stops waiting. It is a HOST fact, not a
 * measurement of ours, which is why it is a named constant with its provenance
 * on it rather than a number in an expression (scar §2.18: the host's hook
 * semantics are measured or cited, never assumed silently). Re-verify it on any
 * host upgrade during the run — the same re-probe the canary gets.
 */
export const HOST_SESSION_END_BUDGET_MS = 1_500;

/** Every `.jsonl` under a directory, or the file itself. Paths only. */
export function transcriptFiles(target: string): string[] {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(target);
  } catch {
    return [];
  }
  if (st.isFile()) return [target];
  if (!st.isDirectory()) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let entry: ReturnType<typeof statSync>;
      try {
        entry = statSync(full);
      } catch {
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(target);
  return out;
}

export interface HookRecord {
  /** WHICH SESSION. The transcript file is the session (review should-fix). */
  readonly session: string;
  readonly hookEvent: string;
  readonly hookName: string;
  readonly durationMs: number;
  /** Completion time, epoch ms. The window is `[at - durationMs, at]`. */
  readonly at: number;
}

/**
 * The host's SessionEnd event, and ONLY it.
 *
 * `Stop` was folded in here by a `/stop/i` in the regex, which is a different
 * event with a different budget: `Stop` fires at every turn end, `SessionEnd`
 * once when the host closes the session. Summing them measured a cost no single
 * budget ever has to cover. The names are the host's own (`hookEvent` on a
 * `hook_success` attachment).
 */
function isSessionEnd(hookEvent: string): boolean {
  return /^session[_-]?end$/i.test(hookEvent.trim());
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * PARALLEL OR SEQUENTIAL? — scar §2.18, measured rather than assumed, because
 * if hooks run sequentially two per-turn races stack and the turn budget has to
 * be re-approved.
 *
 * `timestamp` is read as the COMPLETION time and each record occupies
 * `[at - durationMs, at]`. Two records for the SAME `hookEvent` whose windows
 * overlap by more than zero mean the host ran them concurrently. The
 * interpretation is stated because it is an assumption: were `timestamp` the
 * START instead, the same windows shift uniformly and the overlap verdict is
 * unchanged, which is why this discriminator is safe to build on.
 */
export function hookModel(records: readonly HookRecord[]): HookModelReport {
  // GROUPED BY SESSION FIRST. Two hooks that ran in different sessions cannot
  // have raced, and pooling them across a whole scanned corpus manufactured
  // overlaps out of unrelated days — reading the host as `parallel` on
  // coincidence (review should-fix).
  const byEvent = new Map<string, HookRecord[]>();
  for (const r of records) {
    const key = `${r.session}\u0000${r.hookEvent}`;
    const list = byEvent.get(key) ?? [];
    list.push(r);
    byEvent.set(key, list);
  }
  let overlaps = 0;
  for (const list of byEvent.values()) {
    const sorted = [...list].sort((a, b) => a.at - a.durationMs - (b.at - b.durationMs));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i] as HookRecord;
        const b = sorted[j] as HookRecord;
        if (a.hookName === b.hookName) continue;
        const aStart = a.at - a.durationMs;
        const bStart = b.at - b.durationMs;
        if (Math.min(a.at, b.at) - Math.max(aStart, bStart) > 0) overlaps += 1;
      }
    }
  }

  // The pair rides in the VALUE, so the key is never split back apart — the
  // old `split(" ")` could not survive a hook name with a space in it.
  const perHookMap = new Map<
    string,
    { hookEvent: string; hookName: string; durations: number[] }
  >();
  for (const r of records) {
    const key = `${r.hookEvent} ${r.hookName}`;
    const entry = perHookMap.get(key) ?? {
      hookEvent: r.hookEvent,
      hookName: r.hookName,
      durations: [],
    };
    entry.durations.push(r.durationMs);
    perHookMap.set(key, entry);
  }
  const perHook: HookDurations[] = [...perHookMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => {
      const sorted = [...entry.durations].sort((a, b) => a - b);
      return {
        hookEvent: entry.hookEvent,
        hookName: entry.hookName,
        count: sorted.length,
        minMs: sorted[0] ?? 0,
        medianMs: median(sorted),
        maxMs: sorted[sorted.length - 1] ?? 0,
      };
    });

  // Whether more than one hook ever ran for the same event at all decides
  // whether "sequential" is a MEASUREMENT or just an absence of evidence.
  const contested = [...byEvent.values()].some(
    (list) => new Set(list.map((r) => r.hookName)).size > 1,
  );
  const model: HookModelReport["model"] =
    records.length === 0 || !contested ? "unknown" : overlaps > 0 ? "parallel" : "sequential";

  // THE BUDGET IS PER SESSION, and it is SessionEnd's alone.
  //
  // The old line summed every SessionEnd duration in the whole scanned corpus
  // — a month of sessions added together — and folded `Stop` in besides, then
  // compared that number to a one-session budget. What the host actually
  // shares is one budget per SessionEnd event: sequential hooks spend it one
  // after another (sum), concurrent ones spend the longest (max). The WORST
  // session is the one that has to fit.
  const bySession = new Map<string, HookRecord[]>();
  for (const r of records) {
    if (!isSessionEnd(r.hookEvent)) continue;
    const list = bySession.get(r.session) ?? [];
    list.push(r);
    bySession.set(r.session, list);
  }
  let worst: number | null = null;
  let worstSession: string | null = null;
  for (const [session, list] of bySession) {
    const cost =
      model === "parallel"
        ? Math.max(...list.map((r) => r.durationMs))
        : list.reduce((n, r) => n + r.durationMs, 0);
    if (worst === null || cost > worst) {
      worst = cost;
      worstSession = session;
    }
  }

  return {
    model,
    overlaps,
    records: records.length,
    perHook,
    sessionEndBudgetMs: HOST_SESSION_END_BUDGET_MS,
    sessionEndWorstMs: worst,
    sessionEndSessions: bySession.size,
    worstSession,
    sessionEndOk: worst === null ? null : worst <= HOST_SESSION_END_BUDGET_MS,
  };
}

/**
 * THE MARKERS SPLIT INTO TWO CLASSES, and the canary grades them oppositely.
 *
 * `FOREIGN_MARKERS` (src/adapters/claude-code/transcript.ts) is one list with
 * two jobs in it:
 *
 *   0–1  v1's EPISODE ASK — `Stop hook feedback: [bansai] …` and `[bansai] …`.
 *        CONTRACT §5 G8 names this exactly: "the one channel that DOES land as
 *        a user-role message ... is the `foreign` case." Finding it in a
 *        user-role block is the DESIGN WORKING, not a breach. The canary
 *        asserts `classifyBlock` agrees it is `foreign` — because the guarantee
 *        is that `enters()` refuses it, and that refusal is what the
 *        classification buys.
 *
 *   2–4  v1's WAKE and RECALL — `<bansai-memory>`, the standing self-model, the
 *        initializing banner. These arrive as `hook_additional_context`
 *        ATTACHMENTS with no message role, an exclusion carried by the HOST's
 *        transcript shape rather than by v2 (scar §2.18). One of these in a
 *        conversation block means the host changed. That is the red-line.
 *
 * The old canary red-lined all five, so v1's episode ask — the very case the
 * `foreign` source was built for — would have halted the run on day 1.
 */
export const EPISODE_ASK_MARKERS: readonly number[] = [0, 1];
export const WAKE_RECALL_MARKERS: readonly number[] = [2, 3, 4];

function foreignMarkerIndex(text: string): number {
  const probe = text.trimStart();
  for (let i = 0; i < FOREIGN_MARKERS.length; i += 1) {
    const marker = FOREIGN_MARKERS[i];
    if (marker !== undefined && marker.test(probe)) return i;
  }
  return -1;
}

/**
 * THE CANARY (§5 G6, G8). Every foreign marker found in a user/assistant
 * CONVERSATION block is a red-line: it means v1's ritual text can reach v2's
 * capture, and the run's whole premise — two encoders, one voice — is gone.
 *
 * Two things are deliberately NOT hits:
 *   - `tool_result` / `tool_use` blocks: the declared blind spot; `enters()`
 *     drops them at `remember/`'s one rule.
 *   - entries with no message role: the host carries v1's wake and
 *     `<bansai-memory>` blocks as `hook_additional_context` ATTACHMENTS, an
 *     exclusion owned by the host's transcript shape rather than by v2. They
 *     are counted into `attachmentHits` and reported beside the verdict, so a
 *     host upgrade that starts routing them as messages is visible as the
 *     number moving from one column to the other.
 *
 * Nothing here returns text: a hit is a file, an entry ordinal, a role, and the
 * INDEX of the recognizer that matched (scar §2.20).
 */
export function scanTranscripts(files: readonly string[]): CanaryScan {
  const conversationHits: CanaryHit[] = [];
  const byDesignHits: CanaryHit[] = [];
  const recognizerDrift: CanaryHit[] = [];
  let attachmentHits = 0;
  let entries = 0;
  let corrupt = 0;
  const hookRecords: HookRecord[] = [];

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let ordinal = 0;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        corrupt += 1;
        continue;
      }
      const entry = asRecord(parsed);
      if (entry === null) {
        corrupt += 1;
        continue;
      }
      entries += 1;
      const index = ordinal;
      ordinal += 1;

      const attachment = asRecord(entry["attachment"]);
      if (attachment !== null && attachment["type"] === "hook_success") {
        const durationMs = attachment["durationMs"];
        const at = Date.parse(str(entry["timestamp"]) ?? str(attachment["timestamp"]) ?? "");
        if (typeof durationMs === "number" && Number.isFinite(durationMs) && Number.isFinite(at)) {
          hookRecords.push({
            // THE TRANSCRIPT FILE IS THE SESSION. Pooling hook records across
            // sessions made two hooks from different days "overlap" and read
            // the host as parallel, and summed a whole corpus of SessionEnd
            // costs into one budget. Both are per-session facts.
            session: file,
            hookEvent: str(attachment["hookEvent"]) ?? "unknown",
            hookName: str(attachment["hookName"]) ?? "unknown",
            durationMs,
            at,
          });
        }
      }

      const message = asRecord(entry["message"]);
      const role = (message?.["role"] ?? entry["role"]) as unknown;
      const hasRole = role === "user" || role === "assistant";
      const content = message?.["content"] ?? entry["content"];

      for (const block of blocksOf(content)) {
        if (block.kind !== "text") {
          if (foreignMarkerIndex(block.text) >= 0) attachmentHits += 1;
          continue;
        }
        const marker = foreignMarkerIndex(block.text);
        if (marker < 0) continue;
        if (!hasRole) {
          attachmentHits += 1;
          continue;
        }
        const hit: CanaryHit = { file, entry: index, role: role as string, marker };
        if (EPISODE_ASK_MARKERS.includes(marker)) {
          // THE DESIGNED CASE (§5 G8). The guarantee is not that this text
          // never arrives — it is that when it does, `transcript.ts` classes it
          // `foreign` and `remember/`'s `enters()` refuses it. So the canary
          // asserts exactly that, and a DISAGREEMENT is its own red-line:
          // recognizer drift means the exclusion silently stopped applying.
          if (classifyBlock(block.text) === "foreign") byDesignHits.push(hit);
          else recognizerDrift.push(hit);
          continue;
        }
        // Markers 2–4: v1's wake and recall, whose exclusion is carried by the
        // host's transcript shape. In a conversation block that shape changed.
        conversationHits.push(hit);
      }
    }
  }

  // TOTALITY OVER A VACUOUS PASS. Zero hits of any class means the scan saw no
  // v1 material at all — which is what an empty corpus, a wrong `--transcripts`
  // path, or a v1 that was not running all look like. It is `not-exercised`,
  // never a clean bill of health (scar §2.4). Attachments count as "seen":
  // they are v1's markers arriving through the channel the design expects.
  const markersSeen = conversationHits.length + byDesignHits.length + attachmentHits;

  return {
    files: files.length,
    entries,
    corrupt,
    conversationHits,
    byDesignHits,
    recognizerDrift,
    markersSeen,
    attachmentHits,
    hooks: hookModel(hookRecords),
  };
}

function blocksOf(content: unknown): { text: string; kind: "text" | "other" }[] {
  if (typeof content === "string") return [{ text: content, kind: "text" }];
  if (!Array.isArray(content)) return [];
  const out: { text: string; kind: "text" | "other" }[] = [];
  for (const block of content) {
    const b = asRecord(block);
    if (b === null) continue;
    if (b["type"] === "text" && typeof b["text"] === "string") {
      out.push({ text: b["text"], kind: "text" });
      continue;
    }
    // `tool_result` carries text and is EXCLUDED — the host-carried half.
    const text = typeof b["text"] === "string" ? b["text"] : typeof b["content"] === "string" ? b["content"] : "";
    if (text.length > 0) out.push({ text, kind: "other" });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// (d) the assignment file — through `primacy.ts`, never reimplemented
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One hook process's environment, as the preflight must compare them.
 *
 * The CONTRACT asks for "the same realpath from BOTH hook processes'
 * environments (`MEMORY_AB_DIR` unset for both)", which is a claim about two
 * environments — so both are parameters and neither is `process.env`.
 *
 * `abDir` IS THE PATH, not a home directory to derive one from. `homedir()`
 * does not read `$HOME` on every runtime (measured on Bun 1.3: it does not), so
 * a reader that took a home and derived `~/.memory-ab` would resolve the REAL
 * one under a test that thought it had redirected it — which is the hermetic
 * rule broken in the one place it matters most. `bin/` computes the default and
 * passes it in; nothing in this module ever resolves a home.
 *
 * `abDirEnvSet` is a FACT ABOUT THE PROCESS, carried separately: the preflight
 * has to say "MEMORY_AB_DIR is set on the v2 hooks" even while the instrument
 * uses that same variable as its own redirect handle.
 */
export interface HookEnvSpec {
  readonly name: string;
  /** The assignment directory this process resolves. Always explicit. */
  readonly abDir: string;
  /** True when this hook process actually carries `MEMORY_AB_DIR` (a defect). */
  readonly abDirEnvSet?: boolean;
}

export interface AssignmentReading {
  readonly env: string;
  readonly abDirEnvSet: boolean;
  readonly path: string;
  /** The resolved path, or null when nothing exists at it yet. */
  readonly realpath: string | null;
  readonly health: AssignmentHealth;
}

/**
 * Read the assignment file AS ONE NAMED ENVIRONMENT WOULD.
 *
 * `primacy.ts` resolves its directory at CALL time, reading `MEMORY_AB_DIR` first,
 * precisely so a caller can redirect it — its own header says so, and the
 * adapter suite does exactly this. So the variable is set around one call and
 * restored in a `finally`; the assignment logic itself stays
 * `assignmentHealth()`'s, never a second copy of it (§5 G3 stands on there
 * being ONE resolver).
 */
export function readAssignmentAs(spec: HookEnvSpec): AssignmentReading {
  const prior = process.env[AB_DIR_ENV];
  try {
    process.env[AB_DIR_ENV] = spec.abDir;
    const path = assignmentPath();
    const health = assignmentHealth();
    let real: string | null = null;
    try {
      real = realpathSync(path);
    } catch {
      real = null;
    }
    return {
      env: spec.name,
      abDirEnvSet: spec.abDirEnvSet === true,
      path,
      realpath: real,
      health,
    };
  } finally {
    if (prior === undefined) delete process.env[AB_DIR_ENV];
    else process.env[AB_DIR_ENV] = prior;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared read-only helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * REALPATH-DISJOINT, and realpath ONLY — the directories are never opened
 * (scar §2.13: a path guard resolves both sides before it compares).
 *
 * A path that does not exist yet still has to compare CORRECTLY against one
 * that does, or a typo'd nested directory reads as disjoint purely because it
 * has not been created: on macOS `/var/folders/...` is a symlink to
 * `/private/var/folders/...`, so the existing store realpaths to one spelling
 * and the ghost keeps the other. So the nearest EXISTING ancestor is realpathed
 * and the remainder rejoined onto it — every comparison lands in the same
 * spelling of the filesystem, whether or not the leaf exists.
 */
export function realpathOr(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return tail.length === 0 ? realpathSync(head) : join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** True when either path is the other, or lives inside it. `isWithin` is the
 *  store's own containment rule (`store/paths.ts`) — ONE definition of nesting
 *  for the whole repo, so the preflight and the data-dir guard cannot drift. */
export function overlaps(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a);
}

/** sha256 of a file's bytes, or null when it cannot be read. Ids, not content. */
export function fileHash(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/** Every `*.jsonl` under a directory tree. Read-only, sorted, never throws. */
export function jsonlFiles(root: string): string[] {
  return filesUnder(root, (n) => n.endsWith(".jsonl"));
}

export function filesUnder(root: string, accept: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && accept(name)) out.push(full);
    }
  };
  walk(root);
  return out;
}
