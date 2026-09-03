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
import { PRIMACY_DELIVER_EVENT, PRIMACY_STANDDOWN_EVENT } from "../../src/core/counterpart.js";
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
  readonly seq: number;
  readonly session: string | null;
  readonly ts: string | null;
  readonly hook: string | null;
  readonly phase: string | null;
  /** The raw line, kept ONLY so `record.ts` can copy detector lines verbatim. */
  readonly raw: string;
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
    // v1 stamps its own `seq`. When one is absent the file's own order is the
    // clock — never 0 for everything, which would make "later" meaningless and
    // silently break the MIXED-day check.
    const declared = typeof o["seq"] === "number" && Number.isFinite(o["seq"]) ? o["seq"] : null;
    lines.push({
      type,
      seq: declared ?? ordinal,
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
    firstDelivery: number | null;
    lastMuted: number | null;
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
        o.lastMuted = line.seq;
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
      if (o.firstDelivery === null || line.seq < o.firstDelivery) o.firstDelivery = line.seq;
    }
  }

  const sessions: V1SessionOrder[] = [...order.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([session, o]) => ({
      session,
      firstDelivery: o.firstDelivery,
      lastMuted: o.lastMuted,
      straddled:
        o.firstDelivery !== null && o.lastMuted !== null && o.lastMuted > o.firstDelivery,
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
interface RawDb {
  prepare(sql: string): RawStatement;
  close(): unknown;
}

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

/**
 * Read-only on both runtimes, and deliberately NOT `Store.open()` — which
 * mkdirs the data directory and runs DDL at open, i.e. writes into the live
 * store the instrument is supposed to observe (CONTRACT §5 Inputs, CLI §7).
 * Same opener shape as `tools/replay/corpus.ts`, same reason.
 */
function openReadOnly(path: string): RawDb {
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
 * The DURABLE detectors the CONTRACT names that box 2 CANNOT carry. Read the
 * file header for why this list exists rather than six zero counters.
 */
export const NON_DURABLE_DETECTORS: readonly string[] = [
  "adapter.wake.injected",
  "adapter.wake.delivered",
  "adapter.recall",
  "adapter.episode.ask",
  "sleep.symmetry",
  "remember.span.quarantined",
  "self.schema.pressure",
  "self.schema.tripped",
  "self.schema.quarantined",
];

/** The durable names this reader counts. All four exist in `DURABLE_EVENTS`. */
export const DURABLE_DETECTORS: readonly string[] = [
  PRIMACY_STANDDOWN_EVENT,
  PRIMACY_DELIVER_EVENT,
  "gate.chunk",
  "band.transition",
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
   * The row cap. The store's own `eventLog` defaults to 500, which a real day
   * would blow past silently; the instrument passes its own, large, explicit.
   */
  readonly limit?: number;
}

const DEFAULT_EVENT_LIMIT = 200_000;

interface OpenStore {
  readonly db: RawDb;
  readonly readOnlyProof: boolean;
}

function openStore(path: string): OpenStore {
  const db = openReadOnly(path);
  let readOnlyProof: boolean;
  try {
    db.prepare("CREATE TABLE IF NOT EXISTS __parallel_probe (x INTEGER)").all();
    readOnlyProof = false;
  } catch {
    readOnlyProof = true;
  }
  return { db, readOnlyProof };
}

function rowsOf<T>(db: RawDb, sql: string, ...args: unknown[]): T[] {
  try {
    return db.prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

const EMPTY_V2 = (path: string): V2DayCounts => ({
  present: false,
  path,
  readOnlyProof: true,
  livedDayNow: null,
  lastActiveDate: null,
  truncated: false,
  eventRowsRead: 0,
  byNameForDate: {},
  primacyByHook: { deliver: {}, standdown: {} },
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
    exitedOnDate: 0,
    exitedByKind: {},
    archivedTotal: 0,
  },
});

/** UTC calendar date of an epoch-ms stamp — the clock `versions.archived_at` uses. */
function dateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function readV2Day(dataDir: string, date: string, opts: V2DayOptions = {}): V2DayCounts {
  const path = v2StorePath(dataDir);
  if (!existsSync(path)) return EMPTY_V2(path);
  const { db, readOnlyProof } = openStore(path);
  try {
    const limit = opts.limit ?? DEFAULT_EVENT_LIMIT;

    const meta = rowsOf<{ key: string; value: string }>(db, "SELECT key, value FROM meta");
    const metaOf = (key: string): string | null =>
      meta.find((m) => m.key === key)?.value ?? null;
    const livedDayRaw = metaOf("livedDay");
    const livedDayNow = livedDayRaw === null ? null : Number.parseInt(livedDayRaw, 10);

    const events = rowsOf<{ name: string; day: number; payload: string | null }>(
      db,
      "SELECT name, day, payload FROM events ORDER BY seq ASC LIMIT ?",
      limit,
    );

    const byNameForDate: Record<string, number> = {};
    const byNameForLivedDay: Record<string, number> = {};
    const deliver: Record<string, number> = {};
    const standdown: Record<string, number> = {};
    const livedDay = opts.livedDay ?? null;

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
      }
      if (livedDay !== null && row.day === livedDay) bump(byNameForLivedDay, row.name);
    }

    // ── memory rows: kind × mint source, and the day's created-vs-exited ─────
    const memories = rowsOf<{
      id: string;
      kind: string;
      source: string | null;
      learned_on: string;
      archived: number;
    }>(db, "SELECT id, kind, source, learned_on, archived FROM memories");

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

    // EXIT is attributed through `versions.archived_at` — the only per-event
    // timestamp the schema keeps for a row leaving the live set. `memories`
    // itself has no archived-at column, which is why this is a join and why
    // the day record says so on its face.
    const kindById = new Map(memories.map((m) => [m.id, m.kind]));
    const archivedIds = new Set(memories.filter((m) => m.archived === 1).map((m) => m.id));
    const versions = rowsOf<{ memory_id: string; archived_at: number }>(
      db,
      "SELECT memory_id, archived_at FROM versions",
    );
    const exited = new Set<string>();
    for (const v of versions) {
      if (!archivedIds.has(v.memory_id)) continue;
      if (dateOf(v.archived_at) !== date) continue;
      exited.add(v.memory_id);
    }
    const exitedByKind: Record<string, number> = {};
    for (const id of exited) bump(exitedByKind, kindById.get(id) ?? "unknown");

    return {
      present: true,
      path,
      readOnlyProof,
      livedDayNow: livedDayNow !== null && Number.isFinite(livedDayNow) ? livedDayNow : null,
      lastActiveDate: metaOf("lastActiveDate"),
      truncated: events.length >= limit,
      eventRowsRead: events.length,
      byNameForDate,
      primacyByHook: { deliver, standdown },
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
        exitedOnDate: exited.size,
        exitedByKind,
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
export function migratedProse(dataDir: string): string[] {
  const path = v2StorePath(dataDir);
  if (!existsSync(path)) return [];
  const { db } = openStore(path);
  try {
    return rowsOf<{ prose_path: string }>(
      db,
      "SELECT prose_path FROM memories WHERE source = 'migrated'",
    ).map((r) => r.prose_path);
  } finally {
    db.close();
  }
}

// ── the self-store byte reading (precondition 5), reproduced read-only ──────

export interface SchemaBytesReading {
  readonly present: boolean;
  readonly bytes: number;
  readonly elements: number;
  readonly quarantined: number;
  readonly empty: boolean;
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
  if (!existsSync(path)) return { present: false, bytes: 0, elements: 0, quarantined: 0, empty: true };
  const { db } = openStore(path);
  try {
    const rows = rowsOf<{
      id: string;
      band: string;
      kind: string;
      source: string | null;
      protected: number;
      prose_path: string;
    }>(
      db,
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
    const total = rowsOf<{ n: number }>(db, "SELECT COUNT(*) AS n FROM memories")[0]?.n ?? 0;
    return { present: true, bytes, elements, quarantined, empty: total === 0 };
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

/** The host's shared SessionEnd budget, in ms (scar §2.18: measured, not assumed). */
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

interface HookRecord {
  readonly hookEvent: string;
  readonly hookName: string;
  readonly durationMs: number;
  /** Completion time, epoch ms. The window is `[at - durationMs, at]`. */
  readonly at: number;
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
  const byEvent = new Map<string, HookRecord[]>();
  for (const r of records) {
    const list = byEvent.get(r.hookEvent) ?? [];
    list.push(r);
    byEvent.set(r.hookEvent, list);
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

  const perHookMap = new Map<string, number[]>();
  for (const r of records) {
    const key = `${r.hookEvent} ${r.hookName}`;
    const list = perHookMap.get(key) ?? [];
    list.push(r.durationMs);
    perHookMap.set(key, list);
  }
  const perHook: HookDurations[] = [...perHookMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, durations]) => {
      const [hookEvent = "", hookName = ""] = key.split(" ");
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        hookEvent,
        hookName,
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

  const sessionEnd = records.filter((r) => /sessionend|session_end|stop/i.test(r.hookEvent));
  // The budget is SHARED across all hooks on the event: sequential hooks spend
  // it one after another (sum), concurrent ones spend the longest (max).
  const worst =
    sessionEnd.length === 0
      ? null
      : model === "parallel"
        ? Math.max(...sessionEnd.map((r) => r.durationMs))
        : sessionEnd.reduce((n, r) => n + r.durationMs, 0);

  return {
    model,
    overlaps,
    records: records.length,
    perHook,
    sessionEndBudgetMs: HOST_SESSION_END_BUDGET_MS,
    sessionEndWorstMs: worst,
    sessionEndOk: worst === null ? null : worst <= HOST_SESSION_END_BUDGET_MS,
  };
}

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
        // Belt and braces: the reader's OWN classifier decides, so the canary
        // and `transcript.ts` cannot disagree about what foreign looks like.
        if (classifyBlock(block.text) !== "foreign") continue;
        conversationHits.push({ file, entry: index, role: role as string, marker });
      }
    }
  }

  return {
    files: files.length,
    entries,
    corrupt,
    conversationHits,
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
