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
 * Pure ymd arithmetic (`time.ts#addDays`, and UTC only for a day's weekday),
 * and every answer is held to `parseCalendarDate` before it leaves.
 */
import { addDays, monthBounds, parseCalendarDate } from "./time.js";

export type DateLean = "ahead" | "back";

export interface LooseDate {
  /** The exact shape it was read as (`2026-10-15`, `2026-10`, `2026-10-21..2026-10-31`). */
  readonly text: string;
  /** True when words were read; false when the value was already an exact shape. */
  readonly words: boolean;
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** A month's name or its usual short form ("sept" too), to 1..12. */
function monthOf(word: string): number | null {
  const w = word.replace(/\.$/u, "");
  if (w.length < 3) return null;
  for (const [i, name] of MONTH_NAMES.entries()) {
    if (name.startsWith(w)) return i + 1;
  }
  return w === "sept" ? 9 : null;
}

/** A weekday's name or short form ("tue", "tues", "thurs"), to 0..6 (Sunday 0). */
function weekdayOf(word: string): number | null {
  const w = word.replace(/\.$/u, "");
  if (w.length < 3) return null;
  for (const [i, name] of WEEKDAY_NAMES.entries()) {
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
export function readLooseDate(value: unknown, today: string, lean: DateLean): LooseDate | null {
  const exact = parseCalendarDate(value);
  if (exact !== null) return { text: exact.text, words: false };
  if (typeof value !== "string" || parseCalendarDate(today)?.precision !== "day") return null;
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
  return held === null ? null : { text: held.text, words: true };
}

function readWords(s: string, today: string, lean: DateLean): string | null {
  const { y: ty, m: tm, d: td } = ymdParts(today);
  // A time of day after a day word is the same day ("tomorrow morning", "tonight").
  const dayWord = s.replace(/\s+(?:morning|afternoon|evening|night|at \S+|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/u, "");
  switch (dayWord) {
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
    return addDays(mondayOf(today), 4);
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
  if (m !== null && monthOf(m[1] as string) !== null) return monthDay(monthOf(m[1] as string), Number(m[2]), m[3], ty, tm, td, lean);
  // "15 october", "15th of oct", "the 15th of october 2026"
  m = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z.]+)(?:\s+(\d{4}))?$/u.exec(s);
  if (m !== null && monthOf(m[2] as string) !== null) return monthDay(monthOf(m[2] as string), Number(m[1]), m[3], ty, tm, td, lean);
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

function monthDay(mo: number | null, d: number, year: string | undefined, ty: number, tm: number, td: number, lean: DateLean): string | null {
  if (mo === null) return null;
  const y = year !== undefined ? Number(year) : yearFor(mo, d, ty, tm, td, lean);
  return dayText(y, mo, d);
}
