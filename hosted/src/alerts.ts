/**
 * THE OPERATOR'S ALERTS (AL1, Mike 2026-11-17): an email to the operator when
 * hosted is filling up.
 *
 *   - **Spots**: when the accounts reach 80%, then 95%, then 100% of the spots
 *     total (`spots set N`). Each threshold fires once per total; a check that
 *     finds several crossed at once sends one email, for the highest. A new total
 *     re-arms them (`Accounts#setSpots` clears the state).
 *   - **Storage**: when the data volume's used space passes 70% of its size, then
 *     90% (`statfs` of the data root). `storageBytes` (`HOSTED_STORAGE_ALERT_BYTES`)
 *     replaces the first line. A level re-arms when used space drops below 90% of
 *     its line, so a volume hovering at a line doesn't send one an hour.
 *
 * WHEN: at each account a sign-up makes, and on the app's ten-minute timer
 * (which also sees a `spots set` from another process). No address set: nothing
 * is checked or sent.
 *
 * AT LEAST ONCE, NEVER SILENT (the #843 review): the state is in the control
 * database (`settings`, `alert.spots` and `alert.storage`, JSON), so a deploy
 * never re-sends one. A send is CLAIMED first, by compare-and-set (`pending`, with
 * the time), so two checks at once don't both send; it is CONFIRMED after the
 * mailer answers. A failed send releases its claim. A claim never confirmed within
 * `CLAIM_STALE_MS` (the process died mid-send) is taken again by a later check: a
 * duplicate is acceptable, silence isn't.
 *
 * Sent through the app's mailer and not through the sign-in form, so it never
 * counts against the hourly sign-up email cap (EC1). Counts and sizes only: no
 * address, id or name of anyone is in an alert.
 */
import { statfsSync } from "node:fs";

import type { Accounts } from "./accounts.js";
import { dirBytes } from "./limits.js";
import type { Mailer } from "./egress.js";

export const SPOT_THRESHOLDS: readonly number[] = [80, 95, 100];
/** The storage levels, as shares of the volume's size. `storageBytes` replaces the first's line. */
export const STORAGE_LEVELS: readonly number[] = [70, 90];
/** A level re-arms once used space is below this share of its line. */
export const STORAGE_REARM_SHARE = 0.9;
/** A claim not confirmed sent within this long is taken again (the process died mid-send). */
export const CLAIM_STALE_MS = 15 * 60 * 1000;

/** The data volume's size and used bytes, or null when it can't be read. */
export interface VolumeUsage {
  readonly total: number;
  readonly used: number;
}

/** `statfs` of `path`: the filesystem's size and what is used on it. Null when the runtime or the path can't say. */
export function volumeUsage(path: string): VolumeUsage | null {
  try {
    const s = statfsSync(path);
    const bsize = Number(s.bsize);
    const total = Number(s.blocks) * bsize;
    const used = (Number(s.blocks) - Number(s.bfree)) * bsize;
    return Number.isFinite(total) && total > 0 && used >= 0 ? { total, used } : null;
  } catch {
    return null;
  }
}

export interface AlertsConfig {
  /** Where alerts go (`HOSTED_ALERT_EMAIL`). */
  readonly to: string;
  /** The first storage line in used bytes (`HOSTED_STORAGE_ALERT_BYTES`); absent: 70% of the volume's size. */
  readonly storageBytes?: number;
  /** How the volume is read (tests hand in their own). Default: `volumeUsage(dataRoot)`, and `dirBytes(dataRoot)` for `used` when that can't be read. */
  readonly volume?: () => VolumeUsage | { readonly total: null; readonly used: number } | null;
}

export type AlertEvent = "alert.sent" | "alert.failed";

export interface AlertsOptions extends AlertsConfig {
  readonly accounts: Accounts;
  readonly mailer: Mailer;
  readonly dataRoot: string;
  readonly publicOrigin: string;
  readonly now?: () => number;
  /** Each alert sent or failed, by its name (`spots-80`, `storage-70`). A throw is swallowed. */
  readonly onEvent?: (name: AlertEvent, which: string) => void;
}

/** An alert's state: the level confirmed sent, and a claim in flight. `total` is the spots total it is for. */
interface State {
  readonly total?: number;
  readonly sent: number;
  readonly pending?: number;
  readonly at?: number;
}

function parse(raw: string | null): State {
  if (raw === null) return { sent: 0 };
  try {
    const v = JSON.parse(raw) as Partial<State>;
    return { sent: typeof v.sent === "number" ? v.sent : 0, ...(typeof v.total === "number" ? { total: v.total } : {}), ...(typeof v.pending === "number" ? { pending: v.pending } : {}), ...(typeof v.at === "number" ? { at: v.at } : {}) };
  } catch {
    return { sent: 0 };
  }
}

function size(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export class Alerts {
  private readonly opts: AlertsOptions;
  private readonly now: () => number;
  private running: Promise<void> | null = null;

  constructor(opts: AlertsOptions) {
    this.opts = opts;
    this.now = opts.now ?? ((): number => Date.now());
  }

  /** Both checks, one at a time (a call while one runs waits for that one). Never throws. */
  check(): Promise<void> {
    this.running ??= (async (): Promise<void> => {
      try {
        await this.checkSpots();
      } catch {
        /* the next check */
      }
      try {
        await this.checkStorage();
      } catch {
        /* the next check */
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private event(name: AlertEvent, which: string): void {
    try {
      this.opts.onEvent?.(name, which);
    } catch {
      /* a log, not a gate */
    }
  }

  /**
   * Claim `level` over `raw` (the state as read), send, confirm. A failed send releases the claim.
   * True when an email went.
   */
  private async send(name: string, raw: string | null, base: State, level: number, which: string, subject: string, text: string): Promise<boolean> {
    const claimed = JSON.stringify({ ...(base.total === undefined ? {} : { total: base.total }), sent: base.sent, pending: level, at: this.now() });
    if (!this.opts.accounts.swapAlertState(name, raw, claimed)) return false;
    const settled = (sent: number): void => {
      this.opts.accounts.swapAlertState(name, claimed, JSON.stringify({ ...(base.total === undefined ? {} : { total: base.total }), sent }));
    };
    try {
      await this.opts.mailer.send({ to: this.opts.to, subject, text });
    } catch {
      settled(base.sent);
      this.event("alert.failed", which);
      return false;
    }
    settled(level);
    this.event("alert.sent", which);
    return true;
  }

  /** The state as read, and whether a live claim (another check sending now) means: leave it. */
  private read(name: string): { raw: string | null; state: State; busy: boolean } {
    const raw = this.opts.accounts.alertState(name);
    const state = parse(raw);
    const busy = state.pending !== undefined && state.at !== undefined && this.now() - state.at < CLAIM_STALE_MS;
    return { raw, state, busy };
  }

  /** The spots alert: the highest threshold crossed and not yet confirmed sent for this total. The percent sent, or null. */
  async checkSpots(): Promise<number | null> {
    const { total, people } = this.opts.accounts.spots();
    if (total === 0) return null;
    const { raw, state, busy } = this.read("spots");
    if (busy) return null;
    const sent = state.total === total ? state.sent : 0;
    const crossed = SPOT_THRESHOLDS.filter((t) => people * 100 >= t * total).at(-1) ?? 0;
    if (crossed <= sent) return null;
    const left = Math.max(0, total - people);
    const subject =
      crossed >= 100
        ? `Counterparts hosted: ${total === 1 ? "the 1 spot is" : `all ${String(total)} spots are`} taken`
        : `Counterparts hosted: ${String(crossed)}% of spots used (${String(people)} of ${String(total)})`;
    const text = [
      `${String(people)} ${people === 1 ? "account" : "accounts"} of ${String(total)} ${total === 1 ? "spot" : "spots"}; ${String(left)} left.`,
      "",
      crossed >= 100 ? "Sign-up is closed to new addresses: the page sends newcomers to the waiting list." : "When they're gone, sign-up closes to new addresses and the page sends newcomers to the waiting list.",
      "To open more: main.ts spots set <N> on the server (docs/hosted/RUNBOOK.md, Spots).",
      "",
      `This alert is sent once per threshold (80%, 95%, 100%) for a spots total; a new total re-arms it. ${this.opts.publicOrigin}`,
      "",
    ].join("\n");
    return (await this.send("spots", raw, { total, sent }, crossed, `spots-${String(crossed)}`, subject, text)) ? crossed : null;
  }

  /** The storage alert. The level sent (70 or 90), or null. */
  async checkStorage(): Promise<number | null> {
    const read = this.opts.volume ?? ((): VolumeUsage | { total: null; used: number } => volumeUsage(this.opts.dataRoot) ?? { total: null, used: dirBytes(this.opts.dataRoot) });
    const v = read();
    if (v === null) return null;
    // Each level's line in bytes; a level with no line (no volume size, no override) never fires.
    const lineOf = (level: number): number | null =>
      level === STORAGE_LEVELS[0] && this.opts.storageBytes !== undefined ? this.opts.storageBytes : v.total === null ? null : Math.floor((v.total * level) / 100);
    const { raw, state, busy } = this.read("storage");
    if (busy) return null;
    // Re-arm: the confirmed level falls to the highest one whose line `used` is still near (within 90% of).
    let sent = 0;
    for (const level of STORAGE_LEVELS) {
      const line = lineOf(level);
      if (level <= state.sent && line !== null && v.used >= line * STORAGE_REARM_SHARE) sent = level;
    }
    if (sent !== state.sent && state.pending === undefined) {
      this.opts.accounts.swapAlertState("storage", raw, sent === 0 ? null : JSON.stringify({ sent }));
      return null;
    }
    const crossed = STORAGE_LEVELS.filter((level) => {
      const line = lineOf(level);
      return line !== null && line > 0 && v.used >= line;
    }).at(-1);
    if (crossed === undefined || crossed <= sent) return null;
    const line = lineOf(crossed)!;
    const share = v.total === null ? "" : ` (${String(Math.round((v.used / v.total) * 100))}% of ${size(v.total)})`;
    const subject = `Counterparts hosted: the data volume has ${size(v.used)} used${share}`;
    const text = [
      `The data volume has ${size(v.used)} used${share}; this alert's line is ${size(line)}${crossed === STORAGE_LEVELS[0] && this.opts.storageBytes !== undefined ? " (HOSTED_STORAGE_ALERT_BYTES)" : ` (${String(crossed)}% of the volume)`}.`,
      "",
      `${crossed >= 90 ? "URGENT: g" : "G"}row the Railway volume before it fills: a full volume stops every store's writes and the backups' (docs/hosted/RUNBOOK.md, Alerts to you).`,
      "",
      `Sent once per level (70%, then 90%); a level re-arms when used space drops below ${String(STORAGE_REARM_SHARE * 100)}% of its line. ${this.opts.publicOrigin}`,
      "",
    ].join("\n");
    return (await this.send("storage", raw, { sent }, crossed, `storage-${String(crossed)}`, subject, text)) ? crossed : null;
  }
}
