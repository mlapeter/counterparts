/**
 * `/api/health`.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { symmetryCheck } from "../../../../core/physics/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../../../core/schemas/index.js";
import { MARKER_UNSET, MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON, readMarker } from "../../../../core/sleep/index.js";
import type { Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { CYCLE_PHASES, DURABLE_EVENTS, DURABLE_EVENT_NAMES, KINDS } from "../../registries.js";
import type { DurableEventName } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
import { LOG_CEILING, absenceFor, eventCountsByName } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// health
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthView {
  readonly phases: { phase: string; day: number | null; ago: number | null; torn: boolean; absent: string | null }[];
  readonly symmetry: { kind: Kind; up: number; down: number; reason: string; ok: boolean }[];
  readonly exits: { reason: string; count: number; gloss: string; absent: string | null }[];
  /**
   * ONE TABLE, LED BY ENGLISH. There were two — "what a host told me" over the
   * eleven `adapter.*` names, and "everything I can record durably" over all
   * nineteen — so seven identifiers were listed twice on one screen with
   * near-duplicate glosses, and the first thing the health tab showed a person
   * was 23 dotted names against a column of `(never run)` (design review,
   * 2026-09-04, §9 and ranked #4). The gloss each row already carried in its
   * third column now LEADS it and the dotted name is the second line, which is
   * the order a reader needs them in: what this records, then what it is
   * called. `adapter` says whether a host wrote it or the machinery did — the
   * only thing the split table was really saying — and `note` carries the
   * adapter-specific caveat the old table had room for.
   */
  readonly records: {
    name: DurableEventName;
    gloss: string;
    count: number;
    absent: string | null;
    adapter: boolean;
    note: string | null;
  }[];
  readonly heatmap: { days: number[]; names: string[]; cells: { day: number; name: string; count: number }[] };
  readonly removals: { id: string; label: string; stage: string; actor: string; reason: string | null; at: number }[];
  readonly removalsAbsent: string | null;
  readonly blind: readonly { readonly what: string; readonly why: string }[];
}

/** The events an ADAPTER writes — the only ones that can tell the owner what a
 *  host actually did with what was composed for it. */
const ADAPTER_EVENTS: readonly DurableEventName[] = [
  "adapter.ask",
  "adapter.boundary",
  "adapter.recall",
  "adapter.wake.injected",
  "adapter.wake.delivered",
  "adapter.primacy.deliver",
  "adapter.primacy.standdown",
  "adapter.embed.backfill",
  "adapter.semantic.lag",
  "adapter.authorship.ask",
  "adapter.episode.ask",
];

const ADAPTER_NOTE: Partial<Record<DurableEventName, string>> = {
  "adapter.wake.injected": "bytes handed to the host, never the text",
  "adapter.wake.delivered": "whether the briefing was actually seen the next turn",
  "adapter.recall": "how long recall took, when the adapter recorded it",
  "adapter.ask": "asked, paced out, or capped for the day",
  "adapter.authorship.ask": "historical — nothing writes this now",
  "adapter.episode.ask": "historical — nothing writes this now",
};

export function healthView(src: DashboardSource): HealthView {
  const store = src.store;
  const day = store.livedDay();
  const everLived = day > 0 || store.list().length > 0;

  const phases = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(store, phase);
    if (marker.health === "torn") {
      return { phase, day: null, ago: null, torn: true, absent: "torn marker" };
    }
    if (marker.day === MARKER_UNSET) return { phase, day: null, ago: null, torn: false, absent: NEVER };
    return { phase, day: marker.day, ago: Math.max(0, day - marker.day), torn: false, absent: null };
  });

  const transitions = store.eventLog({ name: "band.transition", limit: LOG_CEILING });
  const symmetry = KINDS.map((kind) => {
    let up = 0;
    let down = 0;
    for (const row of transitions) {
      if (row.payload === null) continue;
      try {
        const p = JSON.parse(row.payload) as { kind?: string; direction?: string };
        if (p.kind !== kind) continue;
        if (p.direction === "up") up += 1;
        else if (p.direction === "down") down += 1;
      } catch {
        continue;
      }
    }
    const verdict = symmetryCheck(kind, { up, down });
    return { kind, up, down, reason: verdict.reason, ok: verdict.reason === "within-expectation" };
  });

  const exitCounts = new Map<string, number>();
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.archived !== 1) continue;
    const reason = row.archived_reason ?? "no reason recorded";
    exitCounts.set(reason, (exitCounts.get(reason) ?? 0) + 1);
  }
  const namedExits: [string, string][] = [
    [PRUNE_ARCHIVE_REASON, "let go at the floor — real forgetting, on physics' verdict alone"],
    [MERGE_ARCHIVE_REASON, "merged into a duplicate I already held"],
    [SCHEMA_TUNABLES.FADE_REASON, "faded out of my vocabulary"],
  ];
  const exits = namedExits.map(([reason, gloss]) => {
    const count = exitCounts.get(reason) ?? 0;
    return { reason, count, gloss, absent: absenceFor(count, everLived) };
  });
  for (const [reason, count] of exitCounts) {
    if (namedExits.some(([r]) => r === reason)) continue;
    exits.push({ reason, count, gloss: "recorded by whatever archived it", absent: null });
  }

  // The merged record table. Every durable name appears exactly once — the
  // totality rule is unchanged, and the test still walks `DURABLE_EVENT_NAMES`
  // against it — but what HAS happened is ordered above what never has, so the
  // first screen of this tab is the log's actual contents rather than eleven
  // adapter names nobody has ever run. The order is stated on the page.
  const counts = eventCountsByName(src);
  const records = DURABLE_EVENT_NAMES.map((name) => {
    const count = counts.get(name) ?? 0;
    const adapter = ADAPTER_EVENTS.includes(name);
    return {
      name,
      gloss: DURABLE_EVENTS[name],
      count,
      absent: count === 0 ? NEVER : null,
      adapter,
      note: adapter ? (ADAPTER_NOTE[name] ?? "counts and reasons; never text") : null,
    };
  }).sort((a, b) => (b.count === a.count ? 0 : b.count - a.count));

  // The heatmap: lived day × event name. Bounded to the last 21 lived days so a
  // long-lived store still fits on a screen without a scrollbar in two axes.
  const span = 21;
  const from = Math.max(0, day - span + 1);
  const days = Array.from({ length: Math.max(1, Math.min(span, day + 1)) }, (_, i) => from + i);
  const cells: { day: number; name: string; count: number }[] = [];
  for (const name of DURABLE_EVENT_NAMES) {
    const rows = store.eventLog({ name, sinceDay: from, limit: LOG_CEILING });
    const per = new Map<number, number>();
    for (const row of rows) per.set(row.day, (per.get(row.day) ?? 0) + 1);
    for (const d of days) cells.push({ day: d, name, count: per.get(d) ?? 0 });
  }

  const removals = store.removalRecord().map((x) => ({
    id: x.memory_id,
    label: reveal(store, x.memory_id, 72).label,
    stage: x.stage,
    actor: x.actor,
    reason: x.reason,
    at: x.at,
  }));

  return {
    phases,
    symmetry,
    exits,
    records,
    heatmap: { days, names: [...DURABLE_EVENT_NAMES], cells },
    removals,
    removalsAbsent: removals.length === 0 ? (everLived ? NONE : NEVER) : null,
    blind: BLIND_SPOTS,
  };
}

/**
 * WHAT I CANNOT SEE — the named absences, in the shape the terminal `status`
 * view established: a number I do not durably hold is stated as a number I do
 * not hold, never invented to fill a panel. Every line here is a real gap, and
 * three of them are filed in `INTERFACE-GAPS.md`.
 */
export const BLIND_SPOTS: readonly { readonly what: string; readonly why: string }[] = [
  {
    what: "What one cycle did.",
    why: "There is no durable per-cycle outcome record — the report goes back to its caller and is gone. What survives is each phase's completion marker and each row's archived-with-reason state, so every exit count on this page is SINCE BIRTH, never 'this cycle'.",
  },
  {
    what: "A protected element I can no longer read.",
    why: "Protection is a flag on the row whose physics stopped reading, so a removed protected element simply leaves the list. The identity band is queryable and that half is recovered above; this half is not (INTERFACE-GAPS §3).",
  },
  {
    what: "Recall latency, unless an adapter recorded it.",
    why: "The core times its own surfacing race and reports it in the decision row. A turn whose adapter wrote no `adapter.recall` leaves no latency behind at all.",
  },
  {
    what: "Anything older than the retention window.",
    why: "The event log is bounded telemetry, not canonical memory. Rows past the window are swept unless a replay latch holds them, so every count on this page is 'what I still have', not 'what ever happened'.",
  },
  {
    what: "Whether a memory was ever actually useful to you.",
    why: "I record that the reply used it, which is the closest thing I have. Whether it helped is a judgement only you can make, and nothing here should be read as evidence of it.",
  },
  {
    what: "Anything a host did not tell me.",
    why: "The wake bundle's arrival, the ask's outcome, the bytes injected — all of it reaches me only if the adapter wrote a row. Silence on this page is sometimes the adapter's silence, not the machine's.",
  },
];

/** Everything the terminal views print, as one number each — the JSON the app's
 *  header badge reads without pulling a whole page. */
