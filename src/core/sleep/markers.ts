/**
 * Per-concern completion markers — the whole of crash resumption.
 *
 * CONTRACT §3 / §5 G4, v1 §5 G3, scar E8:
 *
 *   - A concern gates on **"active day > my marker"**, never on a transient
 *     "is this a new day" flag. That is the difference between a crash between
 *     the clock ticking and the work finishing replaying its day EXACTLY ONCE,
 *     and skipping it forever.
 *   - A marker advances only after the work AND its persist both succeed.
 *   - Markers only move FORWARD. A torn clock's repair snaps them forward with
 *     it, so recovery never retro-runs history.
 *
 * Markers live in box 2 (canonical operational, transactional), one meta row per
 * phase. INTERFACE-GAPS.md §3 asks for a real table; the key/value row is what
 * the seam offers today, and it is transactional, which is the load-bearing part.
 */

import { MARKER_PREFIX, MARKER_UNSET, TUNABLES } from "./tunables.js";
import type { Phase, SleepStore } from "./types.js";
import { PHASES } from "./types.js";

export function markerKey(phase: Phase): string {
  return `${MARKER_PREFIX}${phase}`;
}

export type MarkerHealth = "unset" | "ok" | "torn";

export interface MarkerRead {
  day: number;
  health: MarkerHealth;
  /** The raw stored text when the marker is torn — for the loud event. */
  raw?: string;
}

/**
 * A torn marker is LOUD, and repair moves forward only (§3, v1 §11 G9). An
 * unreadable value resolves to `MARKER_UNSET`, which means "due today" — the
 * forward direction. It never resolves to a day in the future, which would
 * silently skip work, and never to a day in the past, which would retro-run it.
 */
export function readMarker(store: Pick<SleepStore, "getMeta">, phase: Phase): MarkerRead {
  const raw = store.getMeta(markerKey(phase));
  if (raw === undefined) return { day: MARKER_UNSET, health: "unset" };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MARKER_UNSET) {
    return { day: MARKER_UNSET, health: "torn", raw };
  }
  return { day: n, health: "ok" };
}

export type DueVerdict = "due" | "already-done-today" | "not-due-this-cadence";

/**
 * The gate. `cadence` lived days must have passed since the marker, and an unset
 * marker is always due — an upgraded store that has never run must run, and a
 * store whose marker is ahead of the clock (a torn clock, repaired forward) must
 * NOT retro-run.
 */
export function markerDue(marker: number, day: number, cadence = 1): DueVerdict {
  if (marker === MARKER_UNSET) return "due";
  if (day <= marker) return "already-done-today";
  return day - marker >= cadence ? "due" : "not-due-this-cadence";
}

/** Forward-only. An attempt to move a marker backwards is a silent no-op. */
export function advanceMarker(
  store: Pick<SleepStore, "getMeta" | "setMeta">,
  phase: Phase,
  day: number,
): number {
  const current = readMarker(store, phase);
  if (current.health === "ok" && day <= current.day) return current.day;
  store.setMeta(markerKey(phase), String(day));
  return day;
}

/**
 * An upgraded store initializes markers to the present (§3, v1 §11 G9): *we
 * record completion, so an upgrade must not retro-run.* Only unset markers are
 * touched; an existing marker is never moved backwards to satisfy this.
 */
export function initializeMarkers(
  store: Pick<SleepStore, "getMeta" | "setMeta">,
  day: number,
): Phase[] {
  const touched: Phase[] = [];
  for (const phase of PHASES) {
    if (readMarker(store, phase).health === "unset") {
      store.setMeta(markerKey(phase), String(day));
      touched.push(phase);
    }
  }
  return touched;
}

export function cadenceFor(phase: Phase, override?: Partial<Record<Phase, number>>): number {
  const custom = override?.[phase];
  return custom !== undefined && custom > 0 ? custom : TUNABLES.CADENCE[phase];
}

export function budgetFor(phase: Phase, override?: Partial<Record<Phase, number>>): number {
  const custom = override?.[phase];
  return custom !== undefined && custom >= 0 ? custom : TUNABLES.BUDGETS[phase];
}
