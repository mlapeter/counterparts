/**
 * WHAT WAITS ON THE OWNER: RAISED, BACKED OFF, PARKED (SO1 step 4, revised;
 * Mike 11-07 12:04, all lightly held; `~/counterparts-notes/2026-11-07-briefs/SO1-still-open.md`).
 *
 * An item waiting on the owner is an open memory marked `asked` (the store's
 * own mark for a question to the owner), or a handoff whose lead waits on the
 * owner and that WK3 sank (`counterpart-wake-shape.ts#waitsOnOwner`, meta
 * `wake.handoff.led`). Before this, an `asked` item was never parked
 * (`self/identity.ts#carriesOpen`) and sat in every wake's "Still open"; a
 * sunk handoff sat below the others with no end date. Now:
 *
 *   - RAISED: shown to the owner, in a session someone attends (not a headless
 *     or agent run), as the wake's one mention. Each raise is recorded once per
 *     item per lived day, store-wide: the day latch is an event with a dedup
 *     key (`open.owner.raised:<id>:<day>`), so of two sessions racing for the
 *     same item one writes it; the chain (`wake.owner.raised` meta) is written
 *     only by the winner.
 *   - BACKED OFF: after each unanswered raise, wait `OWNER_RAISE_STEPS` lived
 *     days (3, then 7, then 14); the session-start mention also waits at least
 *     `OWNER_MENTION_EVERY` (a week) since the last raise.
 *   - PARKED: after the last step, the item parks: out of the wake, still
 *     listed (marked parked) under `recall "still open"`. Not closed.
 *   - ANSWERED: a revision of the item (its `revision`, a handoff's `version`)
 *     starts the chain again; an item no longer `asked` or no longer open is no
 *     longer a candidate at all.
 *
 * Meta and events only: no store-format change. Never throws: a chain that
 * won't read is an item never raised (it may be raised again), never one hidden.
 */
import { WAKE_SHAPE_LIMITS as SHAPE } from "./self/tunables.js";
import type { Store } from "./store/index.js";

/** The meta key holding each item's raise chain: `{ [id]: { version, days, kind, scope? } }`. */
export const OWNER_RAISED_KEY = "wake.owner.raised";
/** The event one raise writes (ref the item; payload: session, version, kind, via, scope). Its dedup key is the day latch. */
export const OWNER_RAISED_EVENT = "open.owner.raised";

/** One item's raises at one version of it. */
export interface RaiseChain {
  /** The item's version the raises were made at: a `revision` (memory) or `version` (handoff). */
  readonly version: number;
  /** The lived days it was raised on, oldest first. */
  readonly days: readonly number[];
  readonly kind: "memory" | "handoff";
  readonly scope?: string;
}

type RaiseRecord = Record<string, RaiseChain>;

type ReadStore = Pick<Store, "getMeta">;

/** The whole record; `{}` when absent or unreadable. */
export function raiseRecord(store: ReadStore): RaiseRecord {
  try {
    const v = JSON.parse(store.getMeta(OWNER_RAISED_KEY) ?? "{}") as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RaiseRecord) : {};
  } catch {
    return {};
  }
}

/** The lived days `id` was raised on at `version`: none when its chain is for another version (a revision answers). */
export function raisesAt(record: RaiseRecord, id: string, version: number): readonly number[] {
  const c = record[id];
  if (c === undefined || c.version !== version || !Array.isArray(c.days)) return [];
  return c.days.filter((d) => typeof d === "number" && Number.isFinite(d));
}

/** Where an item stands in its backoff on lived day `today`. */
export type WaitState =
  /** May be mentioned at session start today. */
  | { readonly kind: "due"; readonly raised: number }
  /** Raised, and waiting out its step (or the week, or today's latch). */
  | { readonly kind: "waiting"; readonly raised: number; readonly from: number }
  /** Every step waited out unanswered: out of the wake, listed parked. */
  | { readonly kind: "parked"; readonly raised: number };

/**
 * THE BACKOFF ITSELF, on one item's raise days. With n raises, the last on day
 * L: n = 0 is due; n at the last step parks once `today - L` reaches that
 * step; otherwise it is due once `today - L` reaches the larger of its step
 * and the week (`OWNER_MENTION_EVERY`). Raised today: waiting, whatever the
 * steps (the shared day latch). Pure.
 */
export function waitState(days: readonly number[], today: number, steps: readonly number[] = SHAPE.OWNER_RAISE_STEPS, every: number = SHAPE.OWNER_MENTION_EVERY): WaitState {
  const raised = days.length;
  if (raised === 0) return { kind: "due", raised };
  const last = Math.max(...days);
  const step = steps[Math.min(raised, steps.length) - 1] ?? 0;
  const gone = today - last;
  if (raised >= steps.length) return gone >= step ? { kind: "parked", raised } : { kind: "waiting", raised, from: last + step };
  const wait = Math.max(step, every, 1);
  return gone >= wait ? { kind: "due", raised } : { kind: "waiting", raised, from: last + wait };
}

/**
 * THE OPEN MEMORIES PARKED BY THE BACKOFF on lived day `today`: their chain is
 * at the row's current `revision`, the row still `asked`, and every step is
 * waited out. Read by "Still open" (the wake and the handle), which lists them
 * parked. Never throws.
 */
export function ownerParked(store: Pick<Store, "getMeta" | "row">, today: number): ReadonlySet<string> {
  const out = new Set<string>();
  try {
    for (const [id, c] of Object.entries(raiseRecord(store))) {
      if (c.kind !== "memory") continue;
      const row = store.row(id);
      if (row === undefined || row.status !== "asked") continue;
      if (waitState(raisesAt({ [id]: c }, id, row.revision), today).kind === "parked") out.add(id);
    }
  } catch {
    /* nothing parked: shown, never hidden */
  }
  return out;
}

/**
 * RECORD ONE RAISE: the day latch first (an event whose dedup key is the item
 * and the lived day), and the chain only when this call wrote it. True when
 * this call raised it. A raise at a new version starts the chain again. The
 * caller has already decided the session is attended and the line was shown.
 * Never throws.
 */
export function noteRaised(
  store: Pick<Store, "appendEvent" | "getMeta" | "setMeta">,
  item: { readonly id: string; readonly version: number; readonly kind: "memory" | "handoff"; readonly scope?: string | null },
  at: { readonly day: number; readonly session: string; readonly via: "wake" | "turn" },
): boolean {
  try {
    const seq = store.appendEvent({
      name: OWNER_RAISED_EVENT,
      day: at.day,
      ref: item.id,
      dedupKey: `${OWNER_RAISED_EVENT}:${item.id}:${String(at.day)}`,
      payload: { session: at.session, version: item.version, kind: item.kind, via: at.via, ...(item.scope ? { scope: item.scope } : {}) },
    });
    if (seq <= 0) return false;
    const was = raiseRecord(store);
    const before = raisesAt(was, item.id, item.version);
    const { [item.id]: _old, ...rest } = was;
    const chain: RaiseChain = { version: item.version, days: [...before, at.day], kind: item.kind, ...(item.scope ? { scope: item.scope } : {}) };
    // Newest last; past the bound the oldest go (only lets one be raised again).
    const kept = Object.entries(rest).slice(-(SHAPE.OWNER_RAISES_KEPT - 1));
    store.setMeta(OWNER_RAISED_KEY, JSON.stringify(Object.fromEntries([...kept, [item.id, chain]])));
    return true;
  } catch {
    return false;
  }
}
