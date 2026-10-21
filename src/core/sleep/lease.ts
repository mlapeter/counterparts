/**
 * ONE CYCLE AT A TIME, PER STORE (2026-10-21, the card twins' root fix).
 *
 * A closing session fires Stop and then SessionEnd, and each spawns a worker
 * that runs the cycle. Both workers are kept: each carries the Hebbian flush,
 * and SessionEnd covers a close with no final Stop. But the two cycles ran side
 * by side ~94 ms apart, and the markers could not keep them apart: a phase
 * reads "due", works, and only then advances its marker, so a slow phase
 * (births, ~1.5 s on the corpus) ran twice — 40 names got two cards, and the
 * briefing rendered twice. Two sessions closing together do the same.
 *
 * So the cycle takes a LEASE before its first phase: one meta row in box 2,
 * `{ owner, pid, at, until }`, taken in one `BEGIN IMMEDIATE` read-change-write
 * (`Store#updateMeta`). A second cycle finds it held and stands aside at once —
 * no waiting on the holder, no retry; the write lock it takes to look is one
 * statement long. The holder releases it in `finally`, only if it is still its
 * own.
 *
 * A HOLDER THAT DIED leaves the row behind, and it is reclaimed once `until`
 * has passed (`TUNABLES.CYCLE_LEASE_MS`). The markers then do what they always
 * did: the phases the dead cycle finished are done, the one it died in is due.
 *
 * A HOLDER THAT IS WEDGED, not dead, is the case a lease alone gets wrong: the
 * reclaimer would run beside it. The watchdog's kill cannot be relied on for
 * it (a detached worker's spawn timeout lives in the hook that exited; its own
 * timer cannot fire while it is stuck in synchronous work). So the lease is
 * FENCED: the cycle reads the row again before every phase and stops —
 * `CycleLeaseLost`, a `CycleKilled` — the moment it is no longer the owner. A
 * wedged cycle can finish at most the one phase it was stuck in.
 *
 * An observer takes no lease: it writes nothing, and a lease is a write.
 */

import { TUNABLES } from "./tunables.js";
import type { CycleStep, Phase } from "./types.js";
import { CycleKilled } from "./types.js";

/** The meta row. One per store. */
export const CYCLE_LEASE_KEY = "sleep.lease";

export interface CycleLease {
  readonly owner: string;
  readonly pid: number | null;
  /** When it was taken, ms. */
  readonly at: number;
  /** When it may be reclaimed, ms. */
  readonly until: number;
}

/** The store as the lease needs it: the one transactional meta write. */
export interface LeaseStore {
  getMeta(key: string): string | undefined;
  updateMeta(key: string, fn: (current: string | undefined) => string | null | undefined): string | null | undefined;
}

/** The row, or null when it is absent or unreadable (unreadable is reclaimable: forward-safe). */
export function readLease(raw: string | undefined): CycleLease | null {
  if (raw === undefined) return null;
  try {
    const v = JSON.parse(raw) as Partial<CycleLease>;
    if (typeof v.owner !== "string" || typeof v.at !== "number" || typeof v.until !== "number") return null;
    if (!Number.isFinite(v.at) || !Number.isFinite(v.until)) return null;
    return { owner: v.owner, pid: typeof v.pid === "number" ? v.pid : null, at: v.at, until: v.until };
  } catch {
    return null;
  }
}

export type LeaseTake =
  | { readonly taken: true; readonly lease: CycleLease; readonly reclaimed: CycleLease | null; readonly torn: boolean }
  | { readonly taken: false; readonly holder: CycleLease };

/**
 * Take the lease, in one transaction: free, expired or unreadable ⇒ ours;
 * held by another owner whose `until` is still ahead ⇒ not taken, and who
 * holds it. Never waits on the holder.
 */
export function takeLease(
  store: LeaseStore,
  opts: { owner: string; now: number; pid?: number | null; leaseMs?: number },
): LeaseTake {
  const leaseMs = opts.leaseMs ?? TUNABLES.CYCLE_LEASE_MS;
  const box: { out?: LeaseTake } = {};
  store.updateMeta(CYCLE_LEASE_KEY, (current) => {
    const held = readLease(current);
    if (held !== null && held.owner !== opts.owner && held.until > opts.now) {
      box.out = { taken: false, holder: held };
      return undefined;
    }
    const lease: CycleLease = { owner: opts.owner, pid: opts.pid ?? null, at: opts.now, until: opts.now + leaseMs };
    box.out = {
      taken: true,
      lease,
      reclaimed: held !== null && held.owner !== opts.owner ? held : null,
      torn: current !== undefined && held === null,
    };
    return JSON.stringify(lease);
  });
  if (box.out === undefined) throw new Error("takeLease: updateMeta did not call back");
  return box.out;
}

/** Whether `owner` still holds the row — the fence, one read. */
export function holdsLease(store: Pick<LeaseStore, "getMeta">, owner: string): boolean {
  return readLease(store.getMeta(CYCLE_LEASE_KEY))?.owner === owner;
}

/** Give it back, only if it is still ours: a reclaimer's row is never deleted. */
export function releaseLease(store: LeaseStore, owner: string): boolean {
  const box = { released: false };
  store.updateMeta(CYCLE_LEASE_KEY, (current) => {
    if (readLease(current)?.owner !== owner) return undefined;
    box.released = true;
    return null;
  });
  return box.released;
}

/**
 * The fence's stop: this cycle's lease was reclaimed while it ran. A
 * `CycleKilled`, so `runCycle` lets it through untouched and the boundary
 * records the cycle as one that died, with the phases it finished.
 */
export class CycleLeaseLost extends CycleKilled {
  readonly holder: CycleLease | null;

  constructor(phase: Phase, holder: CycleLease | null) {
    const step: CycleStep = { phase, stage: "start" };
    super(step);
    this.name = "CycleLeaseLost";
    this.message = `CYCLE_LEASE_LOST ${phase}`;
    this.holder = holder;
  }
}
