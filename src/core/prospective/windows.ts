/**
 * Windows — the arithmetic of "has the remembered future arrived yet".
 *
 * **Precision is carried by the date's own shape, never rounded** (§12 G4): a
 * `2026-09` stays a month for its whole life and is never quietly turned into
 * `2026-09-01`. A month *means* early month more than the 29th, so the two
 * precisions get different ramps rather than the same ramp on a rounded date.
 *
 * **The firing key IS the window** (§12 G9), which buys two properties without
 * any extra machinery: a clock repair cannot re-arm a spent window, because the
 * key never depended on the clock; and a reschedule opens a fresh key that owes
 * nothing to the old one's spent budget, because a different date is a different
 * key.
 *
 * **Calendar days here, lived days elsewhere** — deliberately (NOTES.md §1). The
 * event is a calendar fact and "three days before September 4th" is not
 * computable in lived days for a day nobody has lived yet. The once-per-lived-day
 * brake and `last_fired_day` are lived-day integers, and they live in `index.ts`.
 *
 * Pure: no ambient clock read anywhere in this file. The caller supplies `at`.
 */
import type { ProspectiveTunables } from "./tunables.js";

/** As stated. `2026` / `2026-08` / `2026-08-25` — the three shapes prose carries. */
export type DatePrecision = "day" | "month" | "year";

/** The two precisions that can tactfully arrive. Year-only never does (§12 G3). */
export type WindowPrecision = "day" | "month";

export type Phase = "pending" | "arrived" | "passed";

export interface Window {
  /** `d:2026-08-25` or `m:2026-08`. The date is IN the key, on purpose (G9). */
  readonly key: string;
  /** The event date exactly as stated — never widened, never narrowed. */
  readonly eventDate: string;
  readonly precision: WindowPrecision;
  /** First calendar day the window is open. */
  readonly opensOn: string;
  /** The day the ramp peaks: the date itself, or the FIRST of a stated month. */
  readonly peakOn: string;
  /** Last calendar day the window is open (grace included). */
  readonly closesOn: string;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;
const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ISO day -> epoch ms at UTC midnight. Null when the date is not a real day. */
function dayMs(iso: string): number | null {
  const m = DAY_RE.exec(iso);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // Round-trip: rejects 2026-02-30 and friends without a calendar table.
  return isoOf(ms) === iso ? ms : null;
}

function isoOf(ms: number): string {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The precision a date STATES. Null means "not a date this module understands",
 * which the deriver reports as `malformed-date` — a refusal with a name, never a
 * silent skip (scar §2.4).
 */
export function precisionOf(date: string): DatePrecision | null {
  if (DAY_RE.test(date)) return dayMs(date) === null ? null : "day";
  const m = MONTH_RE.exec(date);
  if (m !== null) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? "month" : null;
  }
  return YEAR_RE.test(date) ? "year" : null;
}

export function addDays(isoDay: string, n: number): string {
  const ms = dayMs(isoDay);
  if (ms === null) throw new Error(`addDays: not an ISO day: ${isoDay}`);
  return isoOf(ms + n * DAY_MS);
}

/** Calendar days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const x = dayMs(a);
  const y = dayMs(b);
  if (x === null || y === null) throw new Error(`daysBetween: not ISO days: ${a}, ${b}`);
  return Math.round((y - x) / DAY_MS);
}

/** First and last day of a stated `YYYY-MM`. */
export function monthBounds(month: string): { first: string; last: string } | null {
  const m = MONTH_RE.exec(month);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { first: `${y}-${pad(mo)}-01`, last: isoOf(Date.UTC(y, mo, 0)) };
}

export function windowKey(eventDate: string, precision: WindowPrecision): string {
  return `${precision === "day" ? "d" : "m"}:${eventDate}`;
}

/** The inverse. Null for a key this module did not mint — refused, never guessed. */
export function parseWindowKey(key: string): { eventDate: string; precision: WindowPrecision } | null {
  const tag = key.slice(0, 2);
  const date = key.slice(2);
  const want: WindowPrecision | null = tag === "d:" ? "day" : tag === "m:" ? "month" : null;
  if (want === null) return null;
  return precisionOf(date) === want ? { eventDate: date, precision: want } : null;
}

/**
 * The window a stated date opens. Year precision returns null on purpose — it is
 * excluded structurally, not scored down (§12 G3).
 *
 * A day window peaks on the day. A MONTH window peaks on the FIRST of the month
 * and decays across it, because that is what a stated month means; rounding it to
 * a day would invent a precision the author never claimed.
 */
export function windowFor(
  eventDate: string,
  precision: DatePrecision,
  t: ProspectiveTunables,
): Window | null {
  if (precision === "year") return null;
  if (precision === "day") {
    if (dayMs(eventDate) === null) return null;
    return {
      key: windowKey(eventDate, "day"),
      eventDate,
      precision: "day",
      opensOn: addDays(eventDate, -t.LEAD_DAYS),
      peakOn: eventDate,
      closesOn: addDays(eventDate, t.GRACE_DAYS),
    };
  }
  const bounds = monthBounds(eventDate);
  if (bounds === null) return null;
  return {
    key: windowKey(eventDate, "month"),
    eventDate,
    precision: "month",
    opensOn: addDays(bounds.first, -t.LEAD_DAYS),
    peakOn: bounds.first,
    closesOn: addDays(bounds.last, t.GRACE_DAYS),
  };
}

/** ISO day keys sort lexically, so the comparisons below are the calendar order. */
export function phaseOf(w: Window, at: string): Phase {
  if (at < w.opensOn) return "pending";
  return at > w.closesOn ? "passed" : "arrived";
}

/**
 * How loudly the window is arriving, 0..1 — the RAMP, not a decision. It scales a
 * cue's weight into the ordinary competition; nothing here admits anything.
 *
 * Rises from `RAMP_OPEN` on the opening day to 1 at the peak, then falls to
 * `RAMP_CLOSE` on the last grace day. For a month that decline spans the whole
 * month plus grace, which is precisely "a stated month means early month more
 * than the 29th" expressed as arithmetic rather than as a rounded date.
 */
export function rampAt(w: Window, at: string, t: ProspectiveTunables): number {
  if (phaseOf(w, at) !== "arrived") return 0;
  const toPeak = daysBetween(w.opensOn, w.peakOn);
  if (at <= w.peakOn) {
    if (toPeak <= 0) return 1;
    return t.RAMP_OPEN + (1 - t.RAMP_OPEN) * (daysBetween(w.opensOn, at) / toPeak);
  }
  const tail = daysBetween(w.peakOn, w.closesOn);
  if (tail <= 0) return 1;
  return 1 - (1 - t.RAMP_CLOSE) * (daysBetween(w.peakOn, at) / tail);
}
