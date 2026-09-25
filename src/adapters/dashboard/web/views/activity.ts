/**
 * `/api/activity` and `/api/event` — the durable log, narrated.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { localClock } from "../../../../core/time.js";
import { NEVER, NONE } from "../../layout.js";
import { DURABLE_EVENTS, DURABLE_EVENT_NAMES } from "../../registries.js";
import type { DurableEventName } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { FLOW_NODES, eventsOfNode } from "../flow.js";
import { narrate } from "../narrate.js";
import type { NarratedEvent } from "../narrate.js";
import { FEED_LIMIT, LOG_CEILING, eventCountsByName } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// activity
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityView {
  readonly events: NarratedEvent[];
  readonly total: number;
  readonly lastSeq: number;
  readonly retentionDays: number;
  readonly bound: string;
  readonly absent: string | null;
  readonly vocabulary: { name: DurableEventName; count: number; description: string; absent: string | null; node: string | null }[];
}

export function activityView(
  src: DashboardSource,
  opts: { limit?: number; name?: string; sinceSeq?: number } = {},
): ActivityView {
  const store = src.store;
  const limit = opts.limit ?? FEED_LIMIT;
  const filter: { name?: string; limit: number } = { limit: LOG_CEILING };
  if (opts.name !== undefined && opts.name.length > 0) filter.name = opts.name;
  const all = store.eventLog(filter);
  const since = opts.sinceSeq;
  const window = since === undefined ? all.slice(-limit).reverse() : all.filter((r) => r.seq > since);
  const events = window.map((row) => narrate(store, row));
  const lastSeq = all.length === 0 ? 0 : (all[all.length - 1]?.seq ?? 0);
  const everLived = store.livedDay() > 0 || store.list().length > 0;
  const counts = eventCountsByName(src);

  return {
    events,
    total: all.length,
    lastSeq,
    retentionDays: store.retentionDays,
    bound:
      `I keep events for ${store.retentionDays} lived days; older ones are swept unless a replay latch holds them. ` +
      "This is what I still have, not everything that ever happened.",
    absent: events.length === 0 ? (everLived ? NONE : NEVER) : null,
    vocabulary: DURABLE_EVENT_NAMES.map((name) => {
      const count = counts.get(name) ?? 0;
      return {
        name,
        count,
        description: DURABLE_EVENTS[name],
        absent: count === 0 ? NEVER : null,
        node: (FLOW_NODES.find((nd) => eventsOfNode(nd.key).includes(name))?.key ?? null),
      };
    }),
  };
}

/** One record, opened. `when` is its moment on the reader's clock, converted
 *  here (`core/time.ts`), so the page never builds a date itself. */
export function eventDetail(
  src: DashboardSource,
  seq: number,
): { found: boolean; event: NarratedEvent | null; when: string | null } {
  const store = src.store;
  for (const row of store.eventLog({ limit: LOG_CEILING })) {
    if (row.seq === seq) return { found: true, event: narrate(store, row), when: localClock(row.at, store.zone()) };
  }
  return { found: false, event: null, when: null };
}
