/**
 * THE CALENDAR DAY A PERSON LIVES ON — the machine's local time zone.
 *
 * Owner's ruling 2026-09-23 (roadmap B3): the six-a-day ask cap and the
 * "nightly" page writer take their calendar day in the machine's LOCAL zone.
 * Until then both read `Store#today`, which is UTC, so an owner at UTC−6 got the
 * day's allowance back at 18:00 and the writer "slept" at five in the afternoon
 * Pacific (`claude-code/INTERFACE-GAPS` §13, `self/INTERFACE-GAPS` "The cap has
 * a day again").
 *
 * **What this does NOT move.** Two other clocks stay exactly where they were:
 *
 *   - the LIVED day (`store.livedDay()`), the physics clock, which counts days
 *     actually lived and is advanced only by the sleep cycle — nothing here
 *     reads or writes it;
 *   - the PROVENANCE date (`store.today()`, `learned_on`, `revisedOn`, every
 *     `date` a hook stamps), which is `store/`'s and stays UTC by the decision
 *     `store/index.ts#dateOf` records. The page writer still SELECTS a day's
 *     memories by `learned_on`, so the day it names (local) and the day it reads
 *     (UTC-stamped) are offset by the zone — every memory is still read exactly
 *     once, on the run after its UTC date closes (self NOTES §22).
 *
 * The INSTANT is the store's provenance clock (`store.now()`), never the ambient
 * `Date.now`: a seeded, replayed or migrated store decides its days by the run it
 * is replaying, exactly as it dates its rows.
 *
 * `zone` is an IANA name (`"America/Chicago"`, `"UTC"`). Absent, the machine's
 * own zone decides — which is what `TZ` sets for a process. It exists so a test
 * can pin the zone and pass on any machine, not as an owner-facing setting.
 */

/** `YYYY-MM-DD` for `at` (ms since the epoch) in `zone`, or the machine's zone. */
export function calendarDate(at: number, zone?: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  if (zone === undefined) {
    // The machine's zone: the Date getters read it, and so does `TZ`.
    return `${String(d.getFullYear()).padStart(4, "0")}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
  } catch {
    // An unknown zone name is a caller's mistake, and the safe reading of it is
    // the machine's own day rather than a throw inside a hook.
    return calendarDate(at);
  }
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A `YYYY-MM-DD` as a person reads it: `Tue 23 Sep 2026`. Empty for anything
 * that is not a whole, real date — a `2026-08` precision or a typo is not
 * padded into a day it never named.
 *
 * The string is ALREADY a calendar day (whichever zone decided it), so it is
 * read as that day and nothing else: built at UTC midnight and read back with
 * the UTC getters, so a machine west of Greenwich does not name the weekday
 * before it.
 */
export function readableDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (m === null) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return "";
  return `${WEEKDAYS[at.getUTCDay()]} ${String(d)} ${MONTHS[mo - 1]} ${String(y)}`;
}
