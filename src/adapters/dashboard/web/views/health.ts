/**
 * `/api/health`.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { symmetryCheck } from "../../../../core/physics/index.js";
import { MARKER_UNSET, MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON, readMarker } from "../../../../core/sleep/index.js";
import type { Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { CYCLE_PHASES, DURABLE_EVENTS, DURABLE_EVENT_NAMES, KINDS } from "../../registries.js";
import type { DurableEventName } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { reveal, revealHere } from "../reveal.js";

import { ARCHIVE_PHRASES, REMOVED_BY_OWNER, unmappedArchiveWords } from "./archive-words.js";
import { LOG_CEILING, eventCountsByName } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// health
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthView {
  readonly phases: { phase: string; day: number | null; ago: number | null; torn: boolean; absent: string | null }[];
  readonly symmetry: { kind: Kind; up: number; down: number; reason: string; ok: boolean }[];
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
  /**
   * THE LAST CYCLE, as one line: the newest lived day any phase finished on,
   * which phases finished that day, and when the newest `sleep.cycle` row was
   * written (ms; null when none is held) so the page can say "today" only when
   * it was.
   */
  readonly cycle: {
    readonly day: number | null;
    readonly at: number | null;
    readonly ran: number;
    readonly total: number;
    readonly phases: { phase: string; gloss: string; state: "ran" | "behind" | "never" | "torn"; day: number | null }[];
  };
  /**
   * WHERE ARCHIVED MEMORIES WENT — every archived row counted by its
   * `archived_reason`, each reason in plain words, with the ids behind it so a
   * segment can list them. "Removed by you" is the removal record's memories
   * (a removed row keeps only a skeleton), with its stage and reason.
   */
  readonly archive: {
    readonly total: number;
    readonly reasons: {
      reason: string;
      phrase: string;
      count: number;
      known: boolean;
      items: { id: string; label: string; note: string | null }[];
    }[];
  };
}

/** Each phase of the cycle, in a few plain words (hover text on its dot). */
const PHASE_GLOSS: Record<string, string> = {
  clock: "move the lived day on",
  decay: "let unused memories weaken",
  consolidate: "strengthen and promote what was used",
  prune: "let go of what fell to the floor",
  fade: "fade cards nothing mentions any more",
  dedup: "merge duplicates",
  versions: "tidy old versions",
  briefing: "write the next wake briefing",
  log: "sweep old log rows",
};

/** Shown even at zero: the three ways out that are forgetting by design. */
const ALWAYS_SHOWN = new Set<string>([PRUNE_ARCHIVE_REASON, MERGE_ARCHIVE_REASON, REMOVED_BY_OWNER]);
/** How many ids one segment carries to the page. */
const ARCHIVE_ITEMS_CAP = 200;

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

  // The last cycle: the newest day any phase finished on is "the last cycle";
  // a phase whose marker is older than that is behind.
  const newest = phases.reduce<number | null>((m, p) => (p.day === null ? m : m === null ? p.day : Math.max(m, p.day)), null);
  const lastCycleRow = store.eventLog({ name: "sleep.cycle", order: "desc", limit: 1 })[0];
  const cyclePhases = phases.map((p) => ({
    phase: p.phase,
    gloss: PHASE_GLOSS[p.phase] ?? p.phase,
    state: p.torn ? ("torn" as const) : p.day === null ? ("never" as const) : p.day === newest ? ("ran" as const) : ("behind" as const),
    day: p.day,
  }));
  const cycle = {
    day: newest,
    at: lastCycleRow === undefined ? null : lastCycleRow.at,
    ran: cyclePhases.filter((p) => p.state === "ran").length,
    total: cyclePhases.length,
    phases: cyclePhases,
  };

  // Where archived memories went. One pass over the rows, then the removal
  // record for "removed by you" (a removed row keeps only a skeleton, so its
  // words are gone and the record is what says what happened).
  const byReason = new Map<string, string[]>();
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.archived !== 1) continue;
    const reason = row.archived_reason ?? "";
    if (reason === REMOVED_BY_OWNER) continue;
    const ids = byReason.get(reason) ?? [];
    ids.push(id);
    byReason.set(reason, ids);
  }
  const removedLatest = new Map<string, (typeof removals)[number]>();
  for (const r of removals) removedLatest.set(r.id, r);
  const removedIds = new Set<string>(removedLatest.keys());
  for (const id of store.list()) {
    const row = store.row(id);
    if (row !== undefined && row.archived === 1 && row.archived_reason === REMOVED_BY_OWNER) removedIds.add(id);
  }
  const reasons: HealthView["archive"]["reasons"] = [];
  const itemsOf = (ids: readonly string[]) =>
    ids.slice(0, ARCHIVE_ITEMS_CAP).map((id) => {
      // The archived row's OWN words (not its successor's) when they can be
      // shown; otherwise the named absence or the withholding.
      const r = revealHere(store, id, 90);
      return { id, label: r.text ?? r.label, note: null };
    });
  for (const [reason, phrase] of ARCHIVE_PHRASES) {
    if (reason === REMOVED_BY_OWNER) {
      const ids = [...removedIds];
      if (ids.length === 0 && !ALWAYS_SHOWN.has(reason)) continue;
      reasons.push({
        reason,
        phrase,
        count: ids.length,
        known: true,
        items: ids.slice(0, ARCHIVE_ITEMS_CAP).map((id) => {
          const rec = removedLatest.get(id);
          return {
            id,
            label: rec?.label ?? reveal(store, id, 72).label,
            note: rec === undefined ? null : `${rec.stage} · by ${rec.actor}${rec.reason ? ` · ${rec.reason}` : ""}`,
          };
        }),
      });
      continue;
    }
    const ids = byReason.get(reason) ?? [];
    byReason.delete(reason);
    if (ids.length === 0 && !ALWAYS_SHOWN.has(reason)) continue;
    reasons.push({ reason, phrase, count: ids.length, known: true, items: itemsOf(ids) });
  }
  for (const [reason, ids] of byReason) {
    reasons.push({
      reason: reason === "" ? "(none)" : reason,
      phrase: unmappedArchiveWords(reason),
      count: ids.length,
      known: false,
      items: itemsOf(ids),
    });
  }
  const archive = { total: reasons.reduce((n, r) => n + r.count, 0), reasons };

  return {
    cycle,
    archive,
    phases,
    symmetry,
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
