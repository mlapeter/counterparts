/**
 * THE OPERATOR'S ALERTS (AL1, Mike 2026-11-17): an email to the operator, once
 * each, when hosted is filling up.
 *
 *   - **Spots**: when the accounts reach 80%, then 95%, then 100% of the spots
 *     total (`spots set N`). Each threshold fires once per total; a check that
 *     finds several crossed at once sends one email, for the highest. A new total
 *     re-arms them (`Accounts#setSpots` clears the state).
 *   - **Storage**: when the data volume's used space passes 70% of its size
 *     (`statfs` of the data root), or `storageBytes` when the operator set one
 *     (`HOSTED_STORAGE_ALERT_BYTES`). Once; re-armed when it drops below 90% of
 *     the threshold, so a volume hovering at the line doesn't send one an hour.
 *
 * WHEN: at each account a sign-up makes, and on the app's ten-minute timer
 * (which also sees a `spots set` from another process). No address set: nothing
 * is checked or sent.
 *
 * ONCE, ACROSS DEPLOYS AND RACES: the state is in the control database
 * (`settings`, `alert.spots` = `<total>:<percent>`, `alert.storage` = `1`), and
 * it moves by compare-and-set BEFORE the email goes, so two checks never both
 * send. An email that fails puts the state back, for the next check to try again.
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
/** The share of the volume's size that fires the storage alert, when no byte threshold was set. */
export const STORAGE_ALERT_SHARE = 0.7;
/** Re-armed once used space is below this share of the threshold. */
export const STORAGE_REARM_SHARE = 0.9;

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
  /** A fixed threshold in used bytes on the volume (`HOSTED_STORAGE_ALERT_BYTES`); absent: 70% of the volume's size. */
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
  /** Each alert sent or failed, by its name (`spots-80`, `storage`). A throw is swallowed. */
  readonly onEvent?: (name: AlertEvent, which: string) => void;
}

function size(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export class Alerts {
  private readonly opts: AlertsOptions;
  private running: Promise<void> | null = null;

  constructor(opts: AlertsOptions) {
    this.opts = opts;
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

  /** Claim `from` → `to`, send, and put it back if the send failed. True when an email went. */
  private async send(state: string, from: string | null, to: string, which: string, subject: string, text: string): Promise<boolean> {
    if (!this.opts.accounts.swapAlertState(state, from, to)) return false;
    try {
      await this.opts.mailer.send({ to: this.opts.to, subject, text });
    } catch {
      this.opts.accounts.swapAlertState(state, to, from);
      this.event("alert.failed", which);
      return false;
    }
    this.event("alert.sent", which);
    return true;
  }

  /** The spots alert: the highest threshold crossed and not yet sent for this total. The percent sent, or null. */
  async checkSpots(): Promise<number | null> {
    const { total, people } = this.opts.accounts.spots();
    if (total === 0) return null;
    const raw = this.opts.accounts.alertState("spots");
    const m = raw === null ? null : /^(\d+):(\d+)$/.exec(raw);
    const sent = m !== null && m !== undefined && Number(m[1]) === total ? Number(m[2]) : 0;
    const crossed = SPOT_THRESHOLDS.filter((t) => people * 100 >= t * total).at(-1) ?? 0;
    if (crossed <= sent) return null;
    const left = Math.max(0, total - people);
    const subject = crossed >= 100 ? `Counterparts hosted: all ${String(total)} spots are taken` : `Counterparts hosted: ${String(crossed)}% of spots used (${String(people)} of ${String(total)})`;
    const text = [
      `${String(people)} accounts of ${String(total)} spots; ${String(left)} left.`,
      "",
      crossed >= 100 ? "Sign-up is closed to new addresses: the page sends newcomers to the waiting list." : "When they're gone, sign-up closes to new addresses and the page sends newcomers to the waiting list.",
      "To open more: main.ts spots set <N> on the server (docs/hosted/RUNBOOK.md, Spots).",
      "",
      `This alert is sent once per threshold (80%, 95%, 100%) for a spots total; a new total re-arms it. ${this.opts.publicOrigin}`,
      "",
    ].join("\n");
    return (await this.send("spots", raw, `${String(total)}:${String(crossed)}`, `spots-${String(crossed)}`, subject, text)) ? crossed : null;
  }

  /** The storage alert. True when an email went. */
  async checkStorage(): Promise<boolean> {
    const read = this.opts.volume ?? ((): VolumeUsage | { total: null; used: number } => volumeUsage(this.opts.dataRoot) ?? { total: null, used: dirBytes(this.opts.dataRoot) });
    const v = read();
    if (v === null) return false;
    const threshold = this.opts.storageBytes ?? (v.total === null ? null : Math.floor(v.total * STORAGE_ALERT_SHARE));
    if (threshold === null || threshold <= 0) return false;
    const raw = this.opts.accounts.alertState("storage");
    if (raw !== null) {
      // Sent already: re-armed only well below the line.
      if (v.used < threshold * STORAGE_REARM_SHARE) this.opts.accounts.swapAlertState("storage", raw, null);
      return false;
    }
    if (v.used < threshold) return false;
    const share = v.total === null ? "" : ` (${String(Math.round((v.used / v.total) * 100))}% of ${size(v.total)})`;
    const subject = `Counterparts hosted: the data volume has ${size(v.used)} used${share}`;
    const text = [
      `The data volume has ${size(v.used)} used${share}; the alert line is ${size(threshold)}${this.opts.storageBytes === undefined ? ` (${String(STORAGE_ALERT_SHARE * 100)}% of the volume)` : " (HOSTED_STORAGE_ALERT_BYTES)"}.`,
      "",
      "Grow the Railway volume before it fills: a full volume stops every store's writes and the backups' (docs/hosted/RUNBOOK.md, Storage alert).",
      "",
      `Sent once; it re-arms when used space drops below ${String(STORAGE_REARM_SHARE * 100)}% of the line. ${this.opts.publicOrigin}`,
      "",
    ].join("\n");
    return this.send("storage", null, "1", "storage", subject, text);
  }
}
