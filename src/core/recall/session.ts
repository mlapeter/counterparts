/**
 * Per-session gate state — PERSISTED (owner ruling, `docs/module-map.md` Rulings §3).
 *
 * This file exists because of the harvest's most consequential single finding:
 * in v1 the object holding "what surfaced this session", the refractory countdown
 * and the carried cues was constructed fresh every turn and thrown away, because
 * the turn path is a new process per turn and nothing serialized it. Session
 * dedup, the emotional refractory, refractory suppression of arrival cues and
 * cue carry-over were therefore **specified, implemented, tested, and inert on
 * the live path** — exercised only by an in-process replay loop.
 *
 * The generalized lesson, and the reason this module is a file rather than a
 * parameter: **a pure function over caller-owned state is only as real as its
 * caller.** So the state lives in box 2 (canonical operational SQLite, the store's
 * `meta` seam), keyed by session id, and `test/recall.test.ts` asserts that two
 * separate `Recall` instances over two separate `Store` handles — a fresh process,
 * for all this module can tell — share it.
 *
 * **Store:** the `gate_session` TABLE in box 2 — ONE ROW PER RECORD, keyed
 * `(session_id, kind, ref)`. It replaced the single JSON `meta` row at
 * `recall.gate.<sessionId>` on 2026-08-25 (SEAMS item B), which was the fix
 * INTERFACE-GAPS.md #1 asked for and the reason it asked:
 *
 *   > `setMeta` is transactional per call, but `load → mutate → save` is not, so
 *   > two writers on one session — a turn's `recall()` and a late `resolveUse()`
 *   > from the boundary, in different processes — can have the second save drop
 *   > the first's records.
 *
 * That is scar §2.1's own sentence arriving inside a transactional database,
 * because the transaction was around the wrong span. With a row per record the
 * late writer inserts ITS record and cannot touch anybody else's. A merge-on-save
 * would have been the sidecar-plus-discipline answer the scar rejects.
 *
 * **Lifetime:** the session, then `Store.pruneGateSessions()` — a real retention
 * sweep beside `pruneSupersededVersions`, which a meta keyspace could never have.
 * `MAX_SESSION_RECORDS` still bounds the per-session record maps, applied on the
 * write AND on the read, so neither direction can exceed it.
 * **Observer:** never written. An instrument deposits nothing, so its gate state
 * lives and dies in the process (`Recall` holds it in memory and stands down at
 * the write).
 */
import type { GateRecordInput, Store } from "../store/index.js";
import type { UseTier } from "../physics/index.js";

export const GATE_STATE_VERSION = 1;

/** The `gate_session.kind` vocabulary this module owns. `window` is
 *  `prospective/`'s (INTERFACE-GAPS.md §3) and is deliberately not read here. */
export const GATE_KINDS = ["surfaced", "credited", "scalar"] as const;
/** The one `scalar` row: the fields that are not per-memory. */
export const SCALAR_REF = "state";

/** What a memory got, the turn it got it, and whether it may ever train. */
export interface SurfaceRecord {
  turn: number;
  tier: "surfaced" | "footnoted";
  /** False when the memory arrived only through ambiguous handles (§9 G5). */
  trains: boolean;
}

export interface CreditRecord {
  turn: number;
  tier: UseTier;
}

export interface GateState {
  v: number;
  sessionId: string;
  /** Turns this session has SERVED (incremented in the record step, never the build). */
  turn: number;
  /** Lived day of the last recorded turn — the handle a future meta sweep needs. */
  lastDay: number;
  /** Session dedup: what this session already saw, and must not see again. */
  surfaced: Record<string, SurfaceRecord>;
  /** Reference credit already granted, so credit never downgrades (§5 G10). */
  credited: Record<string, CreditRecord>;
  /** Emotional refractory: the turn the affect flag last fired. */
  affectFiredTurn: number | null;
  /** Cue carry-over: last turn's cue tokens, re-entering once at CARRY_DECAY. */
  carriedCues: string[];
  /** The turn `carriedCues` came from; they expire after exactly one turn. */
  carriedFromTurn: number;
}

export function freshGateState(sessionId: string): GateState {
  return {
    v: GATE_STATE_VERSION,
    sessionId,
    turn: 0,
    lastDay: 0,
    surfaced: {},
    credited: {},
    affectFiredTurn: null,
    carriedCues: [],
    carriedFromTurn: -1,
  };
}

export interface LoadResult {
  state: GateState;
  /** "loaded" | "absent" | "unreadable" — a reset is a countable event, never a
   *  silent fresh start (scar §2.4: "did not fire" and "was never asked" differ). */
  status: "loaded" | "absent" | "unreadable";
}

interface ScalarPayload {
  v: number;
  affectFiredTurn: number | null;
  carriedCues: string[];
  carriedFromTurn: number;
}

export function loadGateState(store: Store, sessionId: string, max = Infinity): LoadResult {
  const rows = store.gateRecords(sessionId);
  if (rows.length === 0) return { state: freshGateState(sessionId), status: "absent" };

  const scalarRow = rows.find((r) => r.kind === "scalar" && r.ref === SCALAR_REF);
  if (scalarRow === undefined) return { state: freshGateState(sessionId), status: "unreadable" };
  let scalar: ScalarPayload;
  try {
    const parsed = JSON.parse(scalarRow.value ?? "") as Partial<ScalarPayload>;
    if (parsed === null || typeof parsed !== "object" || parsed.v !== GATE_STATE_VERSION) {
      return { state: freshGateState(sessionId), status: "unreadable" };
    }
    scalar = {
      v: GATE_STATE_VERSION,
      affectFiredTurn: parsed.affectFiredTurn ?? null,
      carriedCues: parsed.carriedCues ?? [],
      carriedFromTurn: parsed.carriedFromTurn ?? -1,
    };
  } catch {
    return { state: freshGateState(sessionId), status: "unreadable" };
  }

  const surfaced: Record<string, SurfaceRecord> = {};
  const credited: Record<string, CreditRecord> = {};
  for (const row of rows) {
    if (row.kind === "surfaced") {
      surfaced[row.ref] = {
        turn: row.turn,
        tier: row.tier === "footnoted" ? "footnoted" : "surfaced",
        trains: row.trains !== 0,
      };
    } else if (row.kind === "credited") {
      credited[row.ref] = { turn: row.turn, tier: (row.tier ?? "referenced") as UseTier };
    }
  }

  return {
    state: {
      v: GATE_STATE_VERSION,
      sessionId,
      turn: scalarRow.turn,
      lastDay: scalarRow.last_day,
      surfaced: bound(surfaced, max),
      credited: bound(credited, max),
      affectFiredTurn: scalar.affectFiredTurn,
      carriedCues: scalar.carriedCues,
      carriedFromTurn: scalar.carriedFromTurn,
    },
    status: "loaded",
  };
}

/** Keep the newest `max` records by turn — the row bounds itself (see header). */
function bound<T extends { turn: number }>(rows: Record<string, T>, max: number): Record<string, T> {
  const entries = Object.entries(rows);
  if (entries.length <= max) return rows;
  entries.sort((a, b) => b[1].turn - a[1].turn);
  return Object.fromEntries(entries.slice(0, max));
}

/**
 * The RECORD half of the build/record split (contract §5 G3). It writes through
 * the store seam, so under observer it refuses there — `Recall` never calls it in
 * that case, and if a future caller does, the refusal is inherited rather than
 * remembered.
 */
export function saveGateState(store: Store, state: GateState, max: number): void {
  const rows: GateRecordInput[] = [
    {
      sessionId: state.sessionId,
      kind: "scalar",
      ref: SCALAR_REF,
      turn: state.turn,
      lastDay: state.lastDay,
      value: JSON.stringify({
        v: GATE_STATE_VERSION,
        affectFiredTurn: state.affectFiredTurn,
        carriedCues: state.carriedCues,
        carriedFromTurn: state.carriedFromTurn,
      } satisfies ScalarPayload),
    },
  ];
  for (const [id, rec] of Object.entries(bound(state.surfaced, max))) {
    rows.push({
      sessionId: state.sessionId,
      kind: "surfaced",
      ref: id,
      turn: rec.turn,
      lastDay: state.lastDay,
      tier: rec.tier,
      trains: rec.trains,
    });
  }
  for (const [id, rec] of Object.entries(bound(state.credited, max))) {
    rows.push({
      sessionId: state.sessionId,
      kind: "credited",
      ref: id,
      turn: rec.turn,
      lastDay: state.lastDay,
      tier: rec.tier,
    });
  }
  store.setGateRecords(rows);
}
