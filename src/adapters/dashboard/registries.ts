/**
 * The axes the totality test enumerates (CONTRACT §3 / §5 [M]).
 *
 * The rule this file exists to keep: **a new axis in the core must break
 * something here, at compile time, before it can go missing on screen.** v1's
 * curation starvation hid inside a panel nobody rendered, and a hand-copied list
 * of kinds in a dashboard would reproduce that exactly — it would keep rendering
 * five kinds forever after a sixth was born.
 *
 * So none of these three lists is a copy:
 *
 *   - `KINDS` is `Object.keys(PHYSICS.TUNABLES.KINDS)`. That object is declared
 *     `satisfies Record<Kind, KindPhysics>` in `physics/`, so it IS the registry;
 *     reading its keys cannot go stale.
 *   - `BANDS` has no runtime registry in the core (`Band` is a bare union), so
 *     the order map below is declared `satisfies Record<Band, number>`. A band
 *     added to `core/types.ts` fails `tsc` HERE until it is given a position, and
 *     a band removed fails too. `INTERFACE-GAPS.md` §1 asks the core for the
 *     array so this workaround can be deleted.
 *   - `PHASES` is `sleep/`'s own exported tuple, imported, never restated.
 */
import { TUNABLES as PHYSICS } from "../../core/physics/index.js";
import type { PromotionCrossing, PruneRecord } from "../../core/physics/index.js";
import { PHASES } from "../../core/sleep/index.js";
import type { MergeRecord, Phase } from "../../core/sleep/index.js";
import type { PressureIncrement } from "../../core/schemas/index.js";
import type { Band, Kind } from "../../core/types.js";
import {
  ADAPTER_ASK_EVENT,
  AUTHORSHIP_ASK_EVENT,
  BOUNDARY_EVENT,
  EMBED_BACKFILL_EVENT,
  EPISODE_ASK_EVENT,
  GATE_CHUNK_EVENT,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RECALL_DECISION_EVENT,
  RECALL_DELIVERED_EVENT,
  SEMANTIC_LAG_EVENT,
  SWEEP_GATE_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT,
} from "../../core/counterpart.js";
import { BAND_TRANSITION_EVENT } from "../../core/sleep/index.js";

/** Display order for the bands, weakest commitment first. EXHAUSTIVE BY TYPE. */
const BAND_ORDER = {
  episodic: 0,
  semantic: 1,
  identity: 2,
} as const satisfies Record<Band, number>;

export const BANDS: readonly Band[] = (Object.keys(BAND_ORDER) as Band[]).sort(
  (a, b) => BAND_ORDER[a] - BAND_ORDER[b],
);

/** Every kind physics knows how to move. Derived from the physics registry. */
export const KINDS: readonly Kind[] = Object.keys(PHYSICS.KINDS) as Kind[];

/** Every phase the cycle runs, in the cycle's own order. */
export const CYCLE_PHASES: readonly Phase[] = PHASES;

/**
 * Every event name that reaches box 2's `events` table — the DURABLE log, the
 * one that survives the process. Its writers today: `sleep/`'s consolidate,
 * prune, dedup and decay phases, `schemas/`'s credited challenge and
 * `core/revision.ts`'s identity arm (the same name, the same shape, the same
 * dedup latch — a story does not care which arm moved the row), the
 * composition root's three records — the chunk gate's, one per turn's surfacing
 * decision, and one per crash-fallback run's gate, whose ordinary answer is
 * "nothing crashed" and which is therefore the one record here written to prove
 * a SILENCE — and the one narrow seam an ADAPTER may write through
 * (`Counterpart.noteAdapterEvent`, typed on `AdapterDurableEventName`).
 *
 * EXHAUSTIVE BY TYPE, the same way `BAND_ORDER` is. Each record interface
 * declares its `event` as a string literal; the `satisfies` below is keyed on
 * the union of those literals, so one more durable record type — or a renamed
 * literal — fails `tsc` here rather than quietly never appearing in the feed.
 * That is the totality test applied to the log itself: "consolidation has
 * promoted nothing, ever" must be a line the owner can read, not an empty space
 * (scar §2.17, §2.4). The adapter seam is typed rather than `name: string` for
 * exactly this reason.
 */
export type DurableEventName =
  | PromotionCrossing["event"]
  | PruneRecord["event"]
  | MergeRecord["event"]
  | PressureIncrement["event"]
  | typeof GATE_CHUNK_EVENT
  | typeof RECALL_DECISION_EVENT
  | typeof SWEEP_GATE_EVENT
  | typeof BAND_TRANSITION_EVENT
  | typeof PRIMACY_STANDDOWN_EVENT
  | typeof PRIMACY_DELIVER_EVENT
  | typeof WAKE_INJECTED_EVENT
  | typeof WAKE_DELIVERED_EVENT
  | typeof RECALL_DELIVERED_EVENT
  | typeof EPISODE_ASK_EVENT
  | typeof BOUNDARY_EVENT
  | typeof AUTHORSHIP_ASK_EVENT
  | typeof ADAPTER_ASK_EVENT
  | typeof EMBED_BACKFILL_EVENT
  | typeof SEMANTIC_LAG_EVENT;

export const DURABLE_EVENTS = {
  "adapter.ask": "the Stop ask was evaluated (asked, paced out, or capped for the day)",
  // The two names below are HISTORICAL: until 2026-09-04 the blocked moment
  // carried two asks on two pacers and each left its own row. Nothing writes
  // them now; they stay in the vocabulary so the days recorded under them are
  // still readable, which is what a feed the owner can trust requires (§16).
  "adapter.authorship.ask": "HISTORICAL: the authorship half of the old two-ask Stop",
  "adapter.boundary": "a session-ending path reached the boundary (spans captured, cursor moved)",
  "adapter.embed.backfill": "the worker gave vectors to memories that had none (embedded, remaining, failed)",
  "adapter.semantic.lag": "the worker left next turn's semantic cue (or named why it could not)",
  "adapter.episode.ask": "HISTORICAL: the episode half of the old two-ask Stop",
  "adapter.primacy.deliver": "a hook delivered while the parallel run was on",
  "adapter.primacy.standdown": "a hook withheld delivery so the other system could speak",
  "adapter.recall": "a turn's recall was composed for injection (counts and bytes)",
  "adapter.wake.delivered": "the previous wake's arrival was checked on the next turn",
  "adapter.wake.injected": "a wake bundle was handed to the host (bytes, never text)",
  "band.promoted": "a memory crossed into the identity band",
  "band.transition": "a memory changed bands (the symmetry counter's food)",
  "gate.chunk": "a swept chunk met the gate battery",
  "memory.pruned": "a memory was let go at the floor",
  "memory.merged": "a duplicate was merged into its original",
  "recall.decision": "a turn decided what came to mind (and what stayed quiet)",
  "revision.pressure": "a belief or an identity element took a credited challenge",
  "sweep.gate": "the crash fallback ran its gate (scopes looked at, scopes skipped as nothing-crashed, spans swept)",
} as const satisfies Record<DurableEventName, string>;

export const DURABLE_EVENT_NAMES: readonly DurableEventName[] = Object.keys(
  DURABLE_EVENTS,
) as DurableEventName[];

/**
 * What one axis reports. `absent` is a fact about the axis, not a formatting
 * hint: the renderer prints the absence marker when it is true, and the test
 * asserts the pairing (a nonzero axis marked absent is a bug either way).
 */
export interface AxisCount {
  readonly axis: string;
  readonly count: number;
  readonly absent: boolean;
}

export function countBy<T extends string>(
  registry: readonly T[],
  counts: ReadonlyMap<T, number>,
): AxisCount[] {
  return registry.map((axis) => {
    const count = counts.get(axis) ?? 0;
    return { axis, count, absent: count === 0 };
  });
}
