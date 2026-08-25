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
 * **Store:** `meta` row `recall.gate.<sessionId>`, one JSON document.
 * **Lifetime:** the session. Bounded by `MAX_SESSION_RECORDS` per row because the
 * store exposes no meta enumeration or expiry yet (INTERFACE-GAPS.md #1); `lastDay`
 * is stamped so the sweep that gap describes has something to sweep on.
 * **Observer:** never written. An instrument deposits nothing, so its gate state
 * lives and dies in the process (`Recall` holds it in memory and stands down at
 * the write).
 */
import type { Store } from "../store/index.js";
import type { UseTier } from "../physics/index.js";

export const GATE_STATE_VERSION = 1;
export const GATE_KEY_PREFIX = "recall.gate.";

export function gateKey(sessionId: string): string {
  return `${GATE_KEY_PREFIX}${sessionId}`;
}

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

export function loadGateState(store: Store, sessionId: string): LoadResult {
  const raw = store.getMeta(gateKey(sessionId));
  if (raw === undefined) return { state: freshGateState(sessionId), status: "absent" };
  try {
    const parsed = JSON.parse(raw) as Partial<GateState>;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.v !== GATE_STATE_VERSION ||
      typeof parsed.turn !== "number"
    ) {
      return { state: freshGateState(sessionId), status: "unreadable" };
    }
    const fresh = freshGateState(sessionId);
    return {
      state: {
        ...fresh,
        ...parsed,
        v: GATE_STATE_VERSION,
        sessionId,
        surfaced: parsed.surfaced ?? {},
        credited: parsed.credited ?? {},
        carriedCues: parsed.carriedCues ?? [],
      },
      status: "loaded",
    };
  } catch {
    return { state: freshGateState(sessionId), status: "unreadable" };
  }
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
  const bounded: GateState = {
    ...state,
    surfaced: bound(state.surfaced, max),
    credited: bound(state.credited, max),
  };
  store.setMeta(gateKey(state.sessionId), JSON.stringify(bounded));
}
