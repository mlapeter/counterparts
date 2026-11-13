/**
 * TIME — the one module that converts (docs/time.md, agreed with the owner
 * 2026-09-25).
 *
 * Two kinds of time, and they are never mixed:
 *
 *   - **A moment** — UTC milliseconds since the epoch, taken from the store's one
 *     clock (`store.now()`). `created_at`, an event's `at`, a version's
 *     `archived_at`. Shown in the person's zone, converted HERE, at display time.
 *   - **A calendar date a person says** — plain text as written: `2026-10-15`,
 *     `2026-10`, `2026`, or a range `2026-10-20..2026-10-31`. Never turned into a
 *     moment: "Oct 15" stored as midnight UTC is Oct 14 in Montana, and a month has
 *     no moment to pick at all.
 *
 * The third clock, the LIVED day (`store.livedDay()`, `physics/clock.ts`), is a
 * counter of days actually used and is not a calendar; nothing here moves it.
 *
 * Every conversion between the two kinds lives in this file: a moment's local
 * date, a moment's local clock line, "today" in a zone, and the arithmetic and
 * comparison of calendar dates. `test/time.test.ts` scans `src/` for code that
 * builds dates by hand (`toISOString().slice(0, 10)`, the `getUTC*` and local
 * `Date` getters, `Date.UTC`) outside this file and a short allow-list.
 *
 * **The zone** is an IANA name (`America/Denver`), never an offset, so daylight
 * saving is the zone rules' job. `resolveZone(configured)` is the config's
 * `timeZone` when it names a real zone, else the machine's CURRENT zone, read
 * per call: a laptop that flies to New York shows New York time the next time
 * anything asks. Pure given `(at, zone)`: nothing here reads the ambient clock
 * except `todayIn`'s default, and a store passes its own `now()`.
 *
 * Folded in 2026-09-25: `self/calendar.ts` (B3's local-day helper, 2026-09-23),
 * which re-exports from here so its callers are unchanged, and the calendar
 * arithmetic `prospective/windows.ts` did with the UTC getters.
 */

// ── zones ────────────────────────────────────────────────────────────────────

/** The zone every conversion falls back to when the machine will not say. */
export const FALLBACK_ZONE = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per (zone, shape), because building one costs ~50 µs. */
function formatter(zone: string, shape: "date" | "clock" | "stamp"): Intl.DateTimeFormat {
  const key = `${shape}|${zone}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f =
      shape === "stamp"
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
        : shape === "date"
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            weekday: "short",
          })
        : new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZoneName: "short",
          });
    formatters.set(key, f);
  }
  return f;
}

/** Is `name` an IANA zone this runtime knows? `"America/Denver"`, `"UTC"`. */
export function isZone(name: unknown): name is string {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 64) return false;
  // A NAME, never an offset (review N5): the runtime accepts "+05:30", but an
  // offset has no daylight-saving rules, which is the reason zones are names.
  if (!/^[A-Za-z]/.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The machine's zone as it stands right now — what `TZ` sets for a process. */
export function machineZone(): string {
  try {
    const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isZone(z) ? z : FALLBACK_ZONE;
  } catch {
    return FALLBACK_ZONE;
  }
}

/**
 * The zone to convert in: the configured one when it is a real zone, else the
 * machine's current one. A misspelt config value is a caller's mistake, and its
 * safe reading is the machine's own day rather than a throw inside a hook — the
 * doctor line names the zone in use, which is where the owner sees it.
 */
export function resolveZone(configured?: string | null): string {
  return configured !== undefined && configured !== null && isZone(configured) ? configured : machineZone();
}

// ── a moment, in a zone ──────────────────────────────────────────────────────

interface Parts {
  year: string;
  month: string;
  day: string;
  weekday: string;
  hour: string;
  minute: string;
  dayPeriod: string;
  timeZoneName: string;
}

function partsOf(at: number, zone: string, shape: "date" | "clock" | "stamp"): Parts | null {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  let raw: Intl.DateTimeFormatPart[];
  try {
    raw = formatter(zone, shape).formatToParts(d);
  } catch {
    if (zone === FALLBACK_ZONE) return null;
    return partsOf(at, FALLBACK_ZONE, shape);
  }
  const out: Record<string, string> = {};
  for (const p of raw) out[p.type] = p.value;
  return {
    year: (out["year"] ?? "").padStart(4, "0"),
    month: out["month"] ?? "",
    day: out["day"] ?? "",
    weekday: out["weekday"] ?? "",
    hour: out["hour"] ?? "",
    minute: out["minute"] ?? "",
    dayPeriod: (out["dayPeriod"] ?? "").toLowerCase(),
    timeZoneName: out["timeZoneName"] ?? "",
  };
}

/**
 * `YYYY-MM-DD` — the calendar day the moment `at` falls on in `zone` (default:
 * the machine's current zone). Empty for a moment that is not a number. An
 * unknown zone name reads as the machine's zone, as `resolveZone` would.
 */
export function localDate(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "date");
  return p === null ? "" : `${p.year}-${p.month}-${p.day}`;
}

/**
 * The moment as a person reads it on a clock: `Thu 25 Sep 2026, 1:40 pm MDT`.
 * The zone's own short name (`MDT`, `EDT`, or `GMT+2` where the runtime has no
 * abbreviation), so a reader who travelled can see which clock it is.
 */
export function localClock(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "clock");
  if (p === null) return "";
  const mo = MONTHS[Number(p.month) - 1] ?? p.month;
  return `${p.weekday} ${String(Number(p.day))} ${mo} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`.trim();
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `HH:MM:SS` on a 24-hour clock — the time of day the moment falls on in
 * `zone`. A log line's spelling, where the date is the file's and the seconds
 * are what tell two lines apart (`adapters/log/`, 2026-09-30). Empty for a
 * moment that is not a number.
 */
export function localTime(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  let f = timeFormatters.get(z);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    timeFormatters.set(z, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  return `${out["hour"] ?? ""}:${out["minute"] ?? ""}:${out["second"] ?? ""}`;
}

/**
 * The moment as a short stamp: `09-29 12:47` — month, day and a 24-hour clock
 * in `zone`. For a line that says when something was written, where the year
 * and the zone's name would be noise (the handoff pointer, 2026-09-30).
 */
export function localStamp(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  if (p === null) return "";
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * The time of day with the zone's short name: `17:47 MDT` — a 24-hour clock
 * in `zone`, and the name of the clock it is on (`MDT`, or `GMT+14` where the
 * runtime has no abbreviation). For a line whose date is printed beside it in
 * the reader's own style (the dashboard card's "written" row, 2026-10-09,
 * which said "17:47 UTC" until then). Empty for a moment that is not a number.
 */
export function localClockZone(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  const q = partsOf(at, z, "clock");
  if (p === null) return "";
  return `${p.hour}:${p.minute}${q === null || q.timeZoneName === "" ? "" : ` ${q.timeZoneName}`}`;
}

/**
 * The same stamp, shortened to the clock (`13:02`) when the moment falls on
 * the same date as `after` in `zone` — a time in a run of times that already
 * named its day (the handoff pointer's "work here 13:02–15:41", 2026-09-30).
 */
export function localStampAfter(at: number, after: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  const q = partsOf(after, z, "stamp");
  if (p === null) return "";
  const clock = `${p.hour}:${p.minute}`;
  return q !== null && q.month === p.month && q.day === p.day ? clock : `${p.month}-${p.day} ${clock}`;
}

/**
 * The first moment of the calendar day `ymd` in `zone` — local midnight, as an
 * instant (2026-10-09). A window over moments that is meant to be a person's
 * days starts here, never at `${ymd}T00:00:00Z`, which is the UTC day: in
 * Denver that opens the window six hours early, in Kiritimati fourteen hours
 * late. Found by a search over `localDate` rather than by offset arithmetic, so
 * a day a clock change starts at 01:00 still starts where the zone says it
 * does. Throws on a malformed day — a caller's bug, as `addDays` does.
 */
export function startOfLocalDay(ymd: string, zone?: string): number {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  if (!isDay(ymd) || !Number.isFinite(utcMidnight)) throw new RangeError(`startOfLocalDay: not a day: ${ymd}`);
  const minute = 60_000;
  // Every offset in use lies inside UTC−12..UTC+14, so local midnight lies
  // between these two bounds, with an hour to spare on each side: the first is
  // always the day before in `z`, the second always `ymd` or later.
  let before = Math.floor((utcMidnight - 15 * 3_600_000) / minute);
  let onOrAfter = Math.floor((utcMidnight + 13 * 3_600_000) / minute);
  while (onOrAfter - before > 1) {
    const mid = Math.floor((before + onOrAfter) / 2);
    if (localDate(mid * minute, z) < ymd) before = mid;
    else onOrAfter = mid;
  }
  return onOrAfter * minute;
}

/** Today's `YYYY-MM-DD` in `zone`. A store passes its own clock; the default is
 *  the ambient one, for an adapter with no store open. */
export function todayIn(zone?: string, at: number = Date.now()): string {
  return localDate(at, zone);
}

/**
 * The UTC calendar date of a moment. For the few places that still name things
 * by the UTC day on purpose (a snapshot folder, a parked directory's suffix —
 * each says why) and for reading rows written before 2026-09-25, whose
 * `learned_on` was UTC. A person's day is `localDate`.
 */
export function utcDate(at: number): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

/** A moment as an ISO-8601 UTC instant (`2026-09-25T19:40:00.000Z`) — a log
 *  line's or a file name's spelling of a moment, never a person's. */
export function isoInstant(at: number): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

const zoneOk = new Map<string, boolean>();
function isZoneCached(zone: string): boolean {
  let ok = zoneOk.get(zone);
  if (ok === undefined) {
    ok = isZone(zone);
    zoneOk.set(zone, ok);
  }
  return ok;
}

// ── calendar dates, as a person says them ────────────────────────────────────

/** How much a stated date says. A range is two days, inclusive. */
export type CalendarPrecision = "day" | "month" | "year" | "range";

/** A stated calendar date, read: the text as written and the days it covers. */
export interface CalendarDate {
  /** Exactly as stated — never widened, never narrowed (prospective §12 G4). */
  readonly text: string;
  readonly precision: CalendarPrecision;
  /** First day covered, `YYYY-MM-DD`. */
  readonly first: string;
  /** Last day covered, inclusive. */
  readonly last: string;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^(\d{4})$/;
/** The range separator: `2026-10-20..2026-10-31`. */
export const RANGE_SEP = "..";
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1_440;
/** An age reads in hours under two days. */
const AGE_IN_HOURS_UNDER_MINUTES = 2 * MINUTES_PER_DAY;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A `YYYY-MM-DD` as a count of days, for arithmetic ONLY. The day is read as
 * the label it is — never as a moment in any zone — so the arithmetic uses the
 * proleptic Gregorian day count directly and needs no `Date` at all.
 */
function dayNumber(y: number, m: number, d: number): number {
  // Days from civil, after Howard Hinnant's algorithm: exact for every year.
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(z: number): string {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return dayNumber(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - dayNumber(y, m, 1);
}

/** The day count of a real `YYYY-MM-DD`, or null (`2026-02-30` is not a day). */
function dayOf(ymd: string): number | null {
  const m = DAY_RE.exec(ymd);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return dayNumber(y, mo, d);
}

/** Is `ymd` a whole, real calendar day? */
export function isDay(ymd: unknown): ymd is string {
  return typeof ymd === "string" && dayOf(ymd) !== null;
}

/** The year of a whole day (`2026` for `2026-10-16`), or "" for anything else. */
export function yearOf(ymd: string): string {
  return isDay(ymd) ? (DAY_RE.exec(ymd)?.[1] ?? "") : "";
}

/**
 * A whole day as a short line says it, `Oct 15` — no year, no leading zero —
 * when it falls in `year`; anything else (another year, a month, a typo) as
 * it was written (2026-10-16, the wake trims).
 */
export function shortDay(ymd: string, year: string | undefined): string {
  const m = DAY_RE.exec(ymd);
  if (m === null || year === undefined || m[1] !== year || !isDay(ymd)) return ymd;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${String(Number(m[3]))}`;
}

/**
 * `Oct 15` read back as the whole day it names nearest to `today` — the
 * year before, this one or the next — or null for anything else.
 */
export function dayOfShort(text: string, today: string): string | null {
  const m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(text.trim());
  const t = dayOf(today);
  const month = m === null ? -1 : (MONTHS as readonly string[]).indexOf(m[1] ?? "");
  const y = Number(yearOf(today));
  if (m === null || t === null || month < 0) return null;
  let best: string | null = null;
  let gap = Number.POSITIVE_INFINITY;
  for (const year of [y - 1, y, y + 1]) {
    const ymd = `${String(year).padStart(4, "0")}-${pad2(month + 1)}-${pad2(Number(m[2]))}`;
    const d = dayOf(ymd);
    if (d === null || Math.abs(d - t) >= gap) continue;
    gap = Math.abs(d - t);
    best = ymd;
  }
  return best;
}

/**
 * Read a stated calendar date: a day, a month, a year, or a range of two days
 * (`2026-10-20..2026-10-31`, inclusive, first ≤ last). Null for anything else —
 * a refusal with a shape, never a guess.
 */
export function parseCalendarDate(text: unknown): CalendarDate | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (s.includes(RANGE_SEP)) {
    const [a, b, ...rest] = s.split(RANGE_SEP);
    if (rest.length > 0 || a === undefined || b === undefined) return null;
    const x = dayOf(a);
    const y = dayOf(b);
    if (x === null || y === null || y < x) return null;
    return { text: s, precision: "range", first: a, last: b };
  }
  if (dayOf(s) !== null) return { text: s, precision: "day", first: s, last: s };
  const mm = MONTH_RE.exec(s);
  if (mm !== null) {
    const [y, mo] = [Number(mm[1]), Number(mm[2])];
    if (y < 1 || mo < 1 || mo > 12) return null;
    return { text: s, precision: "month", first: `${mm[1]}-${mm[2]}-01`, last: `${mm[1]}-${mm[2]}-${pad2(daysInMonth(y, mo))}` };
  }
  const yy = YEAR_RE.exec(s);
  if (yy !== null && Number(yy[1]) >= 1) return { text: s, precision: "year", first: `${yy[1]}-01-01`, last: `${yy[1]}-12-31` };
  return null;
}

/** Is `text` a calendar date this module can read? */
export function isCalendarDate(text: unknown): text is string {
  return parseCalendarDate(text) !== null;
}

/** `10-29` from `2026-10-29`. */
export function monthDay(ymd: string): string {
  return ymd.slice("YYYY-".length);
}

/** The day a stamp or a day opens with: `2026-10-29` from `2026-10-29T12:40` or `2026-10-29`. */
export function stampDay(stamp: string): string {
  return stamp.slice(0, "YYYY-MM-DD".length);
}

/** `12 min`, `27 hours`, `3 days`: hours under two days, as a person says it. Never below zero. */
export function ageWords(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / MINUTE_MS));
  const count = (n: number, w: string): string => `${String(n)} ${w}${n === 1 ? "" : "s"}`;
  if (min < MINUTES_PER_HOUR) return `${String(min)} min`;
  if (min < AGE_IN_HOURS_UNDER_MINUTES) return count(Math.round(min / MINUTES_PER_HOUR), "hour");
  return count(Math.round(min / MINUTES_PER_DAY), "day");
}

/** `ymd` moved by `n` days. Throws on a malformed day — a caller's bug. */
export function addDays(ymd: string, n: number): string {
  const d = dayOf(ymd);
  if (d === null) throw new Error(`addDays: not a calendar day: ${ymd}`);
  return fromDayNumber(d + n);
}

/** Calendar days from `a` to `b`; negative when `b` is earlier. Throws on a malformed day. */
export function daysBetween(a: string, b: string): number {
  const x = dayOf(a);
  const y = dayOf(b);
  if (x === null || y === null) throw new Error(`daysBetween: not calendar days: ${a}, ${b}`);
  return y - x;
}

/** First and last day of a stated `YYYY-MM`, or null. */
export function monthBounds(month: string): { first: string; last: string } | null {
  const c = parseCalendarDate(month);
  return c !== null && c.precision === "month" ? { first: c.first, last: c.last } : null;
}

/**
 * Order two stated dates by the first day each covers, then by the last — so a
 * month sorts beside its first day rather than before every day of the year the
 * way the raw strings would (`'2026-10' < '2026-01-05'` is false, and
 * `'2026-10' < '2026-10-01'` is true). Unreadable text sorts last, by text.
 */
export function compareCalendarDates(a: string, b: string): number {
  const x = parseCalendarDate(a);
  const y = parseCalendarDate(b);
  if (x === null || y === null) return x === null && y === null ? a.localeCompare(b) : x === null ? 1 : -1;
  if (x.first !== y.first) return x.first < y.first ? -1 : 1;
  if (x.last !== y.last) return x.last < y.last ? -1 : 1;
  return 0;
}

/** Does the stated date cover any day from `from` to `to` (inclusive, `YYYY-MM-DD`)? */
export function calendarOverlaps(date: string, from: string, to: string): boolean {
  const c = parseCalendarDate(date);
  return c !== null && c.first <= to && c.last >= from;
}

/** Does the stated date cover the day `ymd`? */
export function calendarCovers(date: string, ymd: string): boolean {
  return calendarOverlaps(date, ymd, ymd);
}

/**
 * A `YYYY-MM-DD` as a person reads it: `Tue 23 Sep 2026`. Empty for anything
 * that is not a whole, real day — a `2026-08` or a typo is not padded into a day
 * it never named. The string is already a calendar day, so no zone is involved.
 */
export function readableDate(ymd: string): string {
  const d = dayOf(ymd.trim());
  if (d === null) return "";
  const [y, mo, dd] = ymd.trim().split("-").map(Number) as [number, number, number];
  // Day 0 of the count (1970-01-01) was a Thursday.
  const weekday = WEEKDAYS[(((d + 4) % 7) + 7) % 7];
  return `${weekday} ${String(dd)} ${MONTHS[mo - 1]} ${String(y)}`;
}

/** Legacy name (`self/calendar.ts`, 2026-09-23): the local date of a moment. */
export const calendarDate = localDate;

// ── a date that repeats (2026-10-09, the owner's design, held lightly) ───────

/**
 * How often a stated DAY comes round again, anchored on that day: a birthday
 * stored as `1990-05-14` with `yearly` is every May 14 from then on. Every
 * other week, "the first Monday" and the like are not kept (loose first), and
 * nothing finer than a day: dates and reminders here are per day.
 */
export const RECURRENCES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Is `v` one of the four recurrence words? */
export function isRecurrence(v: unknown): v is Recurrence {
  return typeof v === "string" && (RECURRENCES as readonly string[]).includes(v);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * A month date (`2026-10`) as a person says it: "October", or "October 2027"
 * when its year is not `today`'s. Null for any other shape. (2026-11-13,
 * facts mode's "also due in this window": `due in October`.)
 */
export function readableMonth(ym: string, today: string): string | null {
  const c = parseCalendarDate(ym);
  if (c === null || c.precision !== "month") return null;
  const name = MONTH_NAMES[Number(c.first.slice(5, 7)) - 1];
  if (name === undefined) return null;
  return c.first.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${c.first.slice(0, 4)}`;
}

/** A month `k` months after `(y, m)`, with the day held to that month's length. */
function monthsAfter(y: number, m: number, d: number, k: number): number {
  const total = y * 12 + (m - 1) + k;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return dayNumber(yy, mm, Math.min(d, daysInMonth(yy, mm)));
}

/**
 * The `k`-th time a stated day comes round (`k = 0` is the day itself), as a
 * day count. ALWAYS counted from the anchor, never from the last occurrence,
 * so a short month cannot drag the rest of the year with it:
 *
 *   - **monthly on the 29th, 30th or 31st** falls on the LAST day of a month
 *     too short to have it (Jan 31 → Feb 28, or 29 in a leap year → Mar 31 →
 *     Apr 30 → May 31);
 *   - **yearly on Feb 29** falls on Feb 28 in a year with no Feb 29.
 */
function occurrenceNumber(y: number, m: number, d: number, rule: Recurrence, k: number): number {
  switch (rule) {
    case "daily":
      return dayNumber(y, m, d) + k;
    case "weekly":
      return dayNumber(y, m, d) + 7 * k;
    case "monthly":
      return monthsAfter(y, m, d, k);
    case "yearly":
      return monthsAfter(y, m, d, 12 * k);
  }
}

/** The anchor read as numbers, or null when it is not one real DAY. */
function anchorParts(anchor: string): [number, number, number] | null {
  if (dayOf(anchor) === null) return null;
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** The `k`-th occurrence of `anchor` (k ≥ 0), `YYYY-MM-DD`; null for anything but a real day. */
export function occurrenceOf(anchor: string, rule: Recurrence, k: number): string | null {
  const p = anchorParts(anchor);
  if (p === null || !Number.isInteger(k) || k < 0) return null;
  return fromDayNumber(occurrenceNumber(p[0], p[1], p[2], rule, k));
}

/**
 * The first occurrence of `anchor` on or after `ymd`, and its index. Never one
 * before the anchor: a repeat starts on the day it was stated. Null when either
 * is not a real day.
 */
export function occurrenceOnOrAfter(anchor: string, rule: Recurrence, ymd: string): { k: number; date: string } | null {
  const p = anchorParts(anchor);
  const target = dayOf(ymd);
  if (p === null || target === null) return null;
  const [y, m, d] = p;
  const start = dayNumber(y, m, d);
  if (target <= start) return { k: 0, date: anchor };
  // A lower bound on k, then forward: at most a step or two past the estimate.
  let k =
    rule === "daily"
      ? target - start
      : rule === "weekly"
        ? Math.floor((target - start) / 7)
        : rule === "monthly"
          ? Math.max(0, (Number(ymd.slice(0, 4)) - y) * 12 + (Number(ymd.slice(5, 7)) - m) - 1)
          : Math.max(0, Number(ymd.slice(0, 4)) - y - 1);
  while (occurrenceNumber(y, m, d, rule, k) < target) k += 1;
  return { k, date: fromDayNumber(occurrenceNumber(y, m, d, rule, k)) };
}

/** Does some occurrence of `anchor` fall on a day from `from` to `to`, inclusive? The first one that does, or null. */
export function occurrenceBetween(anchor: string, rule: Recurrence, from: string, to: string): string | null {
  const next = occurrenceOnOrAfter(anchor, rule, from);
  return next !== null && next.date <= to ? next.date : null;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${String(n)}${suffix}`;
}

/**
 * The repeat as a person says it, from the ANCHOR (so a monthly 31st reads as
 * the 31st even in a February): `every day`, `every Monday`, `every month on
 * the 14th`, `every May 14`. Empty for an anchor that is not a real day.
 */
export function readableRecurrence(anchor: string, rule: Recurrence): string {
  const p = anchorParts(anchor);
  if (p === null) return "";
  const [, m, d] = p;
  switch (rule) {
    case "daily":
      return "every day";
    case "weekly":
      return `every ${WEEKDAY_NAMES[(((dayNumber(p[0], m, d) + 4) % 7) + 7) % 7] ?? ""}`;
    case "monthly":
      return `every month on the ${ordinal(d)}`;
    case "yearly":
      return `every ${MONTH_NAMES[m - 1] ?? ""} ${String(d)}`;
  }
}

// ── a date field written as words ────────────────────────────────────────────

/**
 * A DATE FIELD WRITTEN AS WORDS (2026-11-13, the write tools' fail-open lane).
 *
 * `eventDate` and `occurredOn` are FIELDS the writer fills, and until now only
 * the exact shapes (`time.ts#parseCalendarDate`: a day, a month, a year, a
 * range) were read: "next Friday" in `eventDate` refused the whole memory. This
 * reads the common words for a date — "tomorrow", "next Friday", "Oct 15",
 * "15 October", "late October", "next month", "in two weeks", "yesterday",
 * "last Tuesday" — against the day the server reads (`today`, the store's
 * zone), into one of those exact shapes, which the caller echoes back so the
 * writer sees what was kept.
 *
 * WHAT IT IS NOT. Never a date read out of a memory's TEXT (the 2026-09-25/26
 * rule stands): it reads one field's whole value, anchored at both ends, and
 * a sentence that merely contains a date ("dentist next Friday at 3") is not
 * one of its shapes. It does not import `recall/time-ask.ts` (that module reads
 * a QUESTION's time and is its own lane); the two agree where they overlap
 * ("next week" is next Monday to Sunday; "last Tuesday" the latest Tuesday
 * before today).
 *
 * WHICH WAY A WORD LEANS. `lean: "ahead"` for `eventDate` (a reminder: "Oct
 * 15" is the next Oct 15, "Friday" the next Friday, today included) and
 * `"back"` for `occurredOn` (when it happened: the latest one, today
 * included). "next Friday" is the first Friday AFTER today, whatever the lean
 * (a reminder that comes early is seen; one that comes a week late is missed);
 * "last Friday" the latest one before today.
 *
 * Pure ymd arithmetic (`addDays`, and UTC only for a day's weekday; it lives
 * here, in the one module that converts dates),
 * and every answer is held to `parseCalendarDate` before it leaves.
 */
export type DateLean = "ahead" | "back";

export interface LooseDate {
  /** The exact shape it was read as (`2026-10-15`, `2026-10`, `2026-10-21..2026-10-31`). */
  readonly text: string;
  /** True when words were read; false when the value was already an exact shape. */
  readonly words: boolean;
}

const LOOSE_MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const LOOSE_WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** A month's name or its usual short form ("sept" too), to 1..12. */
function monthOf(word: string): number | null {
  const w = word.replace(/\.$/u, "");
  if (w.length < 3) return null;
  for (const [i, name] of LOOSE_MONTH_NAMES.entries()) {
    if (name.startsWith(w)) return i + 1;
  }
  return w === "sept" ? 9 : null;
}

/** A weekday's name or short form ("tue", "tues", "thurs"), to 0..6 (Sunday 0). */
function weekdayOf(word: string): number | null {
  const w = word.replace(/\.$/u, "");
  if (w.length < 3) return null;
  for (const [i, name] of LOOSE_WEEKDAY_NAMES.entries()) {
    if (name.startsWith(w)) return i;
  }
  return null;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, "a couple of": 2, "a couple": 2, couple: 2, "a few": 3, few: 3, several: 3,
};

function countOf(word: string): number | null {
  if (/^\d{1,3}$/u.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  return { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) };
}

function daysIn(y: number, m: number): number {
  const bounds = monthBounds(`${String(y).padStart(4, "0")}-${pad(m)}`);
  return bounds === null ? 31 : Number(bounds.last.slice(8, 10));
}

function dayText(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

function monthText(y: number, m: number): string {
  return `${String(y).padStart(4, "0")}-${pad(m)}`;
}

/** Months later (or earlier, negative) as a year and month. */
function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + by;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** The same day `by` months on, kept to the month's length ("Jan 31" + 1 month is Feb 28). */
function addMonths(ymd: string, by: number): string {
  const { y, m, d } = ymdParts(ymd);
  const to = shiftMonth(y, m, by);
  return dayText(to.y, to.m, Math.min(d, daysIn(to.y, to.m))) as string;
}

/** 0 = Sunday. */
function weekdayOfDay(ymd: string): number {
  const { y, m, d } = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** This week's Monday (a week runs Monday to Sunday). */
function mondayOf(ymd: string): string {
  return addDays(ymd, -((weekdayOfDay(ymd) + 6) % 7));
}

function range(first: string, last: string): string {
  return first === last ? first : `${first}..${last}`;
}

/** A part of a month: early 1-10, mid 11-20, late 21 to the end. */
function partOfMonth(part: string, y: number, m: number): string | null {
  const last = daysIn(y, m);
  const at = (a: number, b: number): string => range(dayText(y, m, a) as string, dayText(y, m, b) as string);
  switch (part) {
    case "early":
    case "beginning of":
    case "start of":
    case "the beginning of":
    case "the start of":
      return at(1, 10);
    case "mid":
    case "middle of":
    case "the middle of":
      return at(11, 20);
    case "late":
    case "end of":
    case "the end of":
      return at(21, last);
    default:
      return null;
  }
}

const PART = "(early|mid|late|beginning of|start of|middle of|end of|the beginning of|the start of|the middle of|the end of)";

/**
 * A date field's value read as one exact calendar shape, or null. An exact
 * shape comes back as it is (`words: false`); words are read against `today`
 * (`YYYY-MM-DD`, the store's zone) leaning `lean`. Anything else — a sentence,
 * a time of day alone, a shape this does not know — is null, for the caller
 * to drop and say.
 */
export function readLooseDate(value: unknown, today: string, lean: DateLean, zone?: string): LooseDate | null {
  const exact = parseCalendarDate(value);
  if (exact !== null) return { text: exact.text, words: false };
  if (typeof value !== "string" || parseCalendarDate(today)?.precision !== "day") return null;
  // An instant ("2026-11-14T03:00:00Z"): its day in the store's zone.
  if (/^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) {
    const at = Date.parse(value.trim());
    if (!Number.isFinite(at)) return null;
    const day = zone === undefined ? value.trim().slice(0, 10) : localDate(at, zone);
    return parseCalendarDate(day) === null ? null : { text: day, words: true };
  }
  const said = value
    .trim()
    .toLowerCase()
    .replace(/[’`]/gu, "'")
    .replace(/,/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[.!]+$/u, "")
    .replace(/^(?:on|by|around|about|for|at|due|starting|from)\s+/u, "")
    .trim();
  if (said.length === 0 || said.length > 60) return null;
  const read = readWords(said, today, lean);
  if (read === null) return null;
  const held = parseCalendarDate(read);
  if (held === null) return null;
  // An absurd span ("in 999 years") is no date anyone meant: more than
  // LOOSE_YEARS_AHEAD ahead or LOOSE_YEARS_BACK back is not read.
  const ty = Number(today.slice(0, 4));
  if (held.first > `${String(ty + LOOSE_YEARS_AHEAD).padStart(4, "0")}${today.slice(4)}` || held.last < `${String(ty - LOOSE_YEARS_BACK).padStart(4, "0")}${today.slice(4)}`) return null;
  return { text: held.text, words: true };
}

/** How far a date in words may reach: ten years ahead, a hundred back. */
export const LOOSE_YEARS_AHEAD = 10;
export const LOOSE_YEARS_BACK = 100;

/** A time of day after a day ("tomorrow morning", "friday at 3pm", "monday 9:30"): the same day. */
const TIME_OF_DAY = /\s+(?:(?:in the\s+)?(?:morning|afternoon|evening|night)|at\s+\S+(?:\s*(?:am|pm))?|\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))$/u;

function readWords(s: string, today: string, lean: DateLean): string | null {
  // The whole value first ("this morning", "last night" are day words), then
  // without a time of day after it.
  const whole = readDayWords(s, today, lean);
  if (whole !== null) return whole;
  const day = s.replace(TIME_OF_DAY, "").trim();
  return day !== s && day.length > 0 ? readDayWords(day, today, lean) : null;
}

function readDayWords(s: string, today: string, lean: DateLean): string | null {
  const { y: ty, m: tm, d: td } = ymdParts(today);
  switch (s) {
    case "today":
    case "tonight":
    case "this morning":
    case "this afternoon":
    case "this evening":
    case "now":
    case "right now":
      return today;
    case "tomorrow":
    case "tmrw":
    case "tomorrow's":
      return addDays(today, 1);
    case "the day after tomorrow":
    case "day after tomorrow":
      return addDays(today, 2);
    case "yesterday":
    case "last night":
      return addDays(today, -1);
    case "the day before yesterday":
    case "day before yesterday":
      return addDays(today, -2);
    default:
      break;
  }
  let m: RegExpExecArray | null;
  // "in two weeks", "in 3 days", "two weeks from now", "a week from today"
  m = /^(?:in\s+)?(\d{1,3}|a couple of|a couple|a few|[a-z]+)\s+(day|week|month|year)s?(?:\s+(?:from now|from today|later|time))?$/u.exec(s);
  if (m !== null && (s.startsWith("in ") || /from (?:now|today)|later|time$/u.test(s))) {
    const n = countOf(m[1] as string);
    if (n === null) return null;
    return shift(today, m[2] as string, n);
  }
  // "two weeks ago", "a month ago"
  m = /^(\d{1,3}|a couple of|a couple|a few|[a-z]+)\s+(day|week|month|year)s?\s+ago$/u.exec(s);
  if (m !== null) {
    const n = countOf(m[1] as string);
    if (n === null) return null;
    return shift(today, m[2] as string, -n);
  }
  // Weeks, months and years named relative to this one.
  m = /^(next|this|last|the coming|the past|this coming|this past)\s+(week|month|year|weekend)$/u.exec(s);
  if (m !== null) {
    const which = m[1] as string;
    const by = which === "next" || which === "the coming" || which === "this coming" ? 1 : which === "this" ? 0 : -1;
    const unit = m[2] as string;
    if (unit === "week") {
      const monday = addDays(mondayOf(today), 7 * by);
      return range(monday, addDays(monday, 6));
    }
    if (unit === "weekend") {
      const saturday = addDays(mondayOf(today), 5 + 7 * by);
      return range(saturday, addDays(saturday, 1));
    }
    if (unit === "month") {
      const to = shiftMonth(ty, tm, by);
      return monthText(to.y, to.m);
    }
    return String(ty + by).padStart(4, "0");
  }
  if (s === "the weekend" || s === "weekend" || s === "this weekend") {
    const saturday = addDays(mondayOf(today), 5);
    return range(saturday, addDays(saturday, 1));
  }
  if (s === "end of the week" || s === "the end of the week" || s === "end of this week" || s === "the end of this week") {
    // Friday; on a weekend, leaning ahead, the coming one (this week's has passed).
    const friday = addDays(mondayOf(today), 4);
    return lean === "ahead" && friday < today ? addDays(friday, 7) : friday;
  }
  // "early next month", "end of this month", "late last month"
  m = new RegExp(`^${PART}\\s+(?:the\\s+)?(next|this|last)\\s+month$`, "u").exec(s) ?? new RegExp(`^${PART}\\s+the\\s+month$`, "u").exec(s);
  if (m !== null) {
    const by = m[2] === "next" ? 1 : m[2] === "last" ? -1 : 0;
    const to = shiftMonth(ty, tm, by);
    return partOfMonth(m[1] as string, to.y, to.m);
  }
  // A weekday: "friday", "this friday", "next friday", "last friday", "this coming friday", "this past friday"
  m = /^(?:(next|this|last|coming|this coming|this past|past)\s+)?([a-z]+)$/u.exec(s);
  if (m !== null) {
    const wd = weekdayOf(m[2] as string);
    if (wd !== null && (m[2] as string).length >= 3 && monthOf(m[2] as string) === null) {
      const which = m[1] ?? "";
      const now = weekdayOfDay(today);
      const after = ((wd - now + 7) % 7) || 7; // strictly after today
      const before = ((now - wd + 7) % 7) || 7; // strictly before today
      if (which === "next" || which === "coming" || which === "this coming") return addDays(today, after);
      if (which === "last" || which === "past" || which === "this past") return addDays(today, -before);
      // Bare, or "this": the lean decides, today included.
      if (wd === now) return today;
      return lean === "ahead" ? addDays(today, after) : addDays(today, -before);
    }
  }
  // A month with a part: "late october", "early oct 2026", "the end of november"
  m = new RegExp(`^${PART}\\s+([a-z.]+)(?:\\s+(\\d{4}))?$`, "u").exec(s);
  if (m !== null) {
    const mo = monthOf(m[2] as string);
    if (mo === null) return null;
    const y = m[3] !== undefined ? Number(m[3]) : yearFor(mo, null, ty, tm, td, lean);
    return partOfMonth(m[1] as string, y, mo);
  }
  // "oct 15", "october 15th", "oct 15 2026"
  m = /^([a-z.]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/u.exec(s);
  if (m !== null && monthOf(m[1] as string) !== null) return looseMonthDay(monthOf(m[1] as string), Number(m[2]), m[3], ty, tm, td, lean);
  // "15 october", "15th of oct", "the 15th of october 2026"
  m = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z.]+)(?:\s+(\d{4}))?$/u.exec(s);
  if (m !== null && monthOf(m[2] as string) !== null) return looseMonthDay(monthOf(m[2] as string), Number(m[1]), m[3], ty, tm, td, lean);
  // A month alone: "october", "oct 2026", "next october"
  m = /^(?:(next|last|this)\s+)?([a-z.]+)(?:\s+(\d{4}))?$/u.exec(s);
  if (m !== null) {
    const mo = monthOf(m[2] as string);
    let y: number;
    if (mo === null) return readNthOf(s, ty, tm, td, lean);
    if (m[3] !== undefined) y = Number(m[3]);
    else if (m[1] === "next") y = mo > tm ? ty : ty + 1;
    else if (m[1] === "last") y = mo < tm ? ty : ty - 1;
    else if (m[1] === "this") y = ty;
    else y = yearFor(mo, null, ty, tm, td, lean);
    return monthText(y, mo);
  }
  return readNthOf(s, ty, tm, td, lean);
}

/** "the 15th": this month's, or the next (ahead) or last (back) month's when that is the side it falls on. */
function readNthOf(s: string, ty: number, tm: number, td: number, lean: DateLean): string | null {
  const m = /^the\s+(\d{1,2})(?:st|nd|rd|th)$/u.exec(s);
  if (m !== null) {
    const d = Number(m[1]);
    const inThis = d >= td ? lean === "ahead" || d === td : lean === "back";
    const to = inThis ? { y: ty, m: tm } : shiftMonth(ty, tm, lean === "ahead" ? 1 : -1);
    return dayText(to.y, to.m, d);
  }
  return null;
}

function shift(today: string, unit: string, n: number): string {
  if (unit === "day") return addDays(today, n);
  if (unit === "week") return addDays(today, 7 * n);
  if (unit === "month") return addMonths(today, n);
  return addMonths(today, 12 * n);
}

/** The year a month (and day) with no year of its own falls in, leaning `lean` from today, today included. */
function yearFor(mo: number, d: number | null, ty: number, tm: number, td: number, lean: DateLean): number {
  const key = mo * 100 + (d ?? (lean === "ahead" ? 31 : 1));
  const now = tm * 100 + td;
  if (lean === "ahead") return key >= now ? ty : ty + 1;
  return key <= now ? ty : ty - 1;
}

function looseMonthDay(mo: number | null, d: number, year: string | undefined, ty: number, tm: number, td: number, lean: DateLean): string | null {
  if (mo === null) return null;
  const y = year !== undefined ? Number(year) : yearFor(mo, d, ty, tm, td, lean);
  return dayText(y, mo, d);
}
