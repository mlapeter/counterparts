/**
 * THE TIME A FACTS QUESTION NAMES (2026-10-03, Release B of deliberate recall)
 * — a sibling of `recency-ask.ts`, read by `mcp/facts.ts` only.
 *
 * Facts mode treats time in a question as a FILTER: only memories inside the
 * window come back, with a count of the matches outside it. This file reads
 * the window off the question, says how far it stretches, and hands back the
 * question with the time words taken out — the rest is what the words and the
 * meaning search, or "last week" would match every memory that says "week".
 *
 * What it reads (a working default, held lightly; the revisit may widen it):
 *
 *   - **days**: "today", "yesterday", "this morning", a clock time
 *     (`recency-ask.ts`'s reading, reused), "N days ago", "a few days ago",
 *     "the other day", "past N days", "recently", "last Saturday" (and "this
 *     past Saturday": the most recent Saturday BEFORE today, so asked on a
 *     Saturday it is a week ago; 2026-10-09). "This Saturday" and "on
 *     Saturday" are not read: either can be the coming one;
 *   - **weeks**: "last week" (Monday to Sunday), "this week", "N weeks ago",
 *     "the past week";
 *   - **months**: "last month", "this month", "in September", "early / mid /
 *     late October", "the end of August";
 *   - **dates**: `2026-09-21`, `2026-09`, `09-21`, `9/21` (month first),
 *     `9/21/2026`, "Sep 21", "September 21st", "21 September", "September 21,
 *     2026" — a year written with the date is the year meant; without one,
 *     `yearFor` picks it. A word in front of a date bounds it (2026-10-09):
 *     "since" runs from the date to today (a month too); "before" / "prior to"
 *     is every day before it, "after" every day after it, open-ended; "until",
 *     "till", "up to", "up until" and "by" every day through it. An open end is
 *     `OPEN_START` / `OPEN_END`, and a bounded window never stretches;
 *   - **anchors**: an event ("around the cut-over", "during the release") or
 *     the last session ("where did we leave off", "last session"). This file
 *     only names them; the caller resolves them against the store, because a
 *     date for "the cut-over" is a search, and "the last session" is a fact
 *     about this directory's sessions.
 *
 * STRETCH. A fuzzy window (a week, a month, part of a month) widens two days
 * each side, a near one ("3 days ago") one day; a named day or date stays
 * exact. `said` is the window as asked, `window` the one that filters.
 *
 * Deliberate only, and facts only. NO MODEL CALL: fixed lists and the store's
 * clock. Pure: `now` and `zone` come in.
 */
import { addDays, daysBetween, localDate, parseCalendarDate } from "../time.js";
import { readRecencyAsk } from "./recency-ask.js";

/** Days a fuzzy window (a week, a month, part of a month) widens on each side. */
export const FUZZY_STRETCH_DAYS = 2;
/** Days a near window ("3 days ago", "the other day") widens on each side. */
export const NEAR_STRETCH_DAYS = 1;

/** The first day of a window with no start ("before 7/22"): earlier than any date a row holds. */
export const OPEN_START = "0001-01-01";
/** The last day of a window with no end ("after 7/22"): later than any date a row holds. */
export const OPEN_END = "9999-12-31";

/** A stretch of calendar days, `YYYY-MM-DD`, inclusive. */
export interface DayWindow {
  readonly from: string;
  readonly to: string;
}

export type TimeAnchor =
  /** An event the question names: the caller searches the phrase and takes its date. */
  | { readonly kind: "event"; readonly phrase: string }
  /** The most recent session (here, when the caller knows where "here" is). */
  | { readonly kind: "session" };

export interface TimeAsk {
  /** The words that asked, as found in the question. */
  readonly cue: string;
  /** The window as asked, before the stretch. Null for an anchor (the caller resolves it). */
  readonly said: DayWindow | null;
  /** The window that filters: `said` widened by `stretch` days each side. */
  readonly window: DayWindow | null;
  /** Days each side; 0 is exact. An anchor's stretch applies once it is resolved. */
  readonly stretch: number;
  /** A time of day, as `YYYY-MM-DD HH:MM` bounds, when the question named one. */
  readonly clock: { readonly from: string; readonly to: string } | null;
  readonly anchor: TimeAnchor | null;
  /** The question with the time words taken out. */
  readonly rest: string;
}

const MONTH_NAMES = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sept", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
] as const;

const MONTH_ALT = MONTH_NAMES.flat().sort((a, b) => b.length - a.length).join("|");

/** Sunday first, as `daysBetween("1970-01-04", day) % 7` counts (that day was a Sunday). */
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** The words that bound a date in front of it, longest first ("up until" before "until"). */
const BOUND_ALT = "prior to|up until|up to|before|after|since|until|till|by";
type Bound = "before" | "after" | "since" | "through";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, "a couple": 2, "a couple of": 2, few: 3, "a few": 3,
};
const NUMBER_ALT = "\\d{1,3}|a couple of|a couple|a few|couple|few|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an|a";

/** Words that end an event phrase: what follows is the question, not the event. */
const PHRASE_STOP = new Set([
  "what", "when", "where", "who", "why", "how", "which", "did", "do", "does", "was", "were", "is", "are", "we",
  "i", "you", "he", "she", "they", "have", "had", "has", "and", "or", "but", "so",
]);

/** Event "phrases" that are not events: time words a caller cannot search. */
const NOT_EVENTS = new Set([
  "then", "time", "that time", "now", "noon", "midnight", "the time", "this time", "that", "same time",
  // A stretch of time, not an event to search for ("during the week", review of #323).
  "day", "days", "week", "weeks", "weekend", "month", "months", "year", "morning", "afternoon", "evening", "night",
]);

const SESSION_PHRASES: readonly string[] = [
  "where did we leave off",
  "where we left off",
  "where were we",
  "pick up where",
  "left off",
  "leave off",
  "our most recent session",
  "most recent session",
  "our last session",
  "last session",
  "previous session",
  "earlier session",
  "our last conversation",
  "last conversation",
  "previous conversation",
  "last chat",
  "last time",
];

function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  const i = MONTH_NAMES.findIndex((names) => (names as readonly string[]).includes(w));
  return i < 0 ? null : i + 1;
}

function numberOf(word: string): number | null {
  const w = word.toLowerCase().trim();
  if (/^\d+$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function lastDayOf(year: number, month: number): string {
  return parseCalendarDate(`${String(year)}-${pad(month)}`)?.last ?? `${String(year)}-${pad(month)}-28`;
}

/** Monday of the week `ymd` falls in. 1970-01-05 was a Monday. */
function mondayOf(ymd: string): string {
  const since = daysBetween("1970-01-05", ymd);
  return addDays(ymd, -(((since % 7) + 7) % 7));
}

/** The most recent `weekday` (0 = Sunday) strictly before `today`: a week back when today is one. */
function lastWeekday(today: string, weekday: number): string {
  const todays = ((daysBetween("1970-01-04", today) % 7) + 7) % 7;
  const back = (todays - weekday + 7) % 7;
  return addDays(today, -(back === 0 ? 7 : back));
}

function stretched(said: DayWindow, days: number): DayWindow {
  if (days <= 0) return said;
  // An open end stays open: there is nothing past "every day before" to widen into.
  return {
    from: said.from === OPEN_START ? OPEN_START : addDays(said.from, -days),
    to: said.to === OPEN_END ? OPEN_END : addDays(said.to, days),
  };
}

/**
 * The word in front of a date that bounds it — "before 7/22", "since the
 * 2026-09" — and the phrase through the date as written, to take out of the
 * question whole. Null when the date stands alone ("on 7/22", "7/22").
 */
function boundOf(text: string, found: string): { bound: Bound; word: string; phrase: string } | null {
  const m = new RegExp(`\\b(${BOUND_ALT})\\s+(?:the\\s+)?${escape(found)}`, "i").exec(text);
  if (m === null) return null;
  const word = (m[1] as string).toLowerCase().replace(/\s+/g, " ");
  const bound: Bound =
    word === "before" || word === "prior to" ? "before" : word === "after" ? "after" : word === "since" ? "since" : "through";
  return { bound, word, phrase: m[0] };
}

/**
 * A date read off the question — its first and last day, and its stretch
 * standing alone — asked as a whole or bounded by the word in front of it.
 * `cue` is how the header names it, when that is not the text as found.
 */
function dated(text: string, found: string, first: string, last: string, stretch: number, today: string, cue = found): TimeAsk {
  const b = boundOf(text, found);
  if (b === null) return ask(cue, { from: first, to: last }, stretch, without(text, found));
  const said: DayWindow =
    b.bound === "since"
      ? { from: first, to: today }
      : b.bound === "before"
        ? { from: OPEN_START, to: addDays(first, -1) }
        : b.bound === "after"
          ? { from: addDays(last, 1), to: OPEN_END }
          : { from: OPEN_START, to: last };
  // "since" keeps the stretch it always had; a cutoff the person named is exact.
  return ask(`${b.word} ${cue}`, said, b.bound === "since" ? stretch : 0, without(text, b.phrase));
}

/** A month named without a year: this year's when it has begun, else last year's. */
function yearFor(month: number, today: string): number {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return month <= m ? y : y - 1;
}

/** Remove `found` (and a preposition just before it) from `text`, once. */
function without(text: string, found: string): string {
  const at = text.toLowerCase().indexOf(found.toLowerCase());
  if (at < 0) return text;
  let start = at;
  const before = text.slice(0, at);
  const prep = /\b(?:on|in|from|since|around|during|at|of|over|for)\s+$/i.exec(before);
  if (prep !== null) start = at - prep[0].length;
  return `${text.slice(0, start)} ${text.slice(at + found.length)}`.replace(/\s+/g, " ").trim();
}

function ask(
  cue: string,
  said: DayWindow | null,
  stretch: number,
  rest: string,
  extra: { clock?: TimeAsk["clock"]; anchor?: TimeAnchor | null } = {},
): TimeAsk {
  return {
    cue,
    said,
    window: said === null ? null : stretched(said, stretch),
    stretch,
    clock: extra.clock ?? null,
    anchor: extra.anchor ?? null,
    rest,
  };
}

/**
 * DOES THIS QUESTION NAME A TIME — and if so, which window, how far it
 * stretches, and what is left of the question without it? Null when it names
 * none. Pure.
 */
export function readTimeAsk(text: string, clock: { now: number; zone: string }): TimeAsk | null {
  const today = localDate(clock.now, clock.zone);
  const lower = text.toLowerCase().replace(/[’]/g, "'");

  // ── an event anchor: "around the cut-over", "during the release" ─────────
  // An article is asked for ("around THE cut-over"): "questions around pricing"
  // is about pricing, not a time.
  const event = /\b(around|during|at the time of)\s+((?:the|our|that|my)\s+(?!\d)[^?.!,;:]+)/i.exec(text);
  if (event !== null) {
    const words = (event[2] ?? "").trim().split(/\s+/);
    const kept: string[] = [];
    for (const w of words) {
      if (PHRASE_STOP.has(w.toLowerCase())) break;
      kept.push(w);
      if (kept.length >= 6) break;
    }
    const phrase = kept.join(" ").replace(/^(the|a|an|our|my|that|this)\s+/i, "").trim();
    if (phrase.length >= 2 && !NOT_EVENTS.has(phrase.toLowerCase()) && monthOf(phrase) === null && !/^(today|yesterday|last|this|next|early|mid|late)\b/i.test(phrase)) {
      const said = `${event[1] as string} ${kept.join(" ")}`;
      return ask(said.trim(), null, FUZZY_STRETCH_DAYS, without(text, said.trim()), { anchor: { kind: "event", phrase } });
    }
  }

  // ── the last session ─────────────────────────────────────────────────────
  const plain = ` ${lower.replace(/'/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
  const session = SESSION_PHRASES.find((p) => plain.includes(` ${p} `));
  if (session !== undefined) {
    return ask(session, null, 0, removeWords(text, session), { anchor: { kind: "session" } });
  }

  // ── explicit dates ───────────────────────────────────────────────────────
  const iso = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/.exec(text);
  if (iso !== null) {
    const found = iso[0];
    const parsed = parseCalendarDate(found);
    if (parsed !== null) {
      return dated(text, found, parsed.first, parsed.last, parsed.precision === "day" ? 0 : FUZZY_STRETCH_DAYS, today);
    }
  }
  // Month first, as a US writer puts it; a year after it is the year meant.
  const short = /\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?\b/.exec(text);
  if (short !== null) {
    const m = Number(short[1]);
    const d = Number(short[2]);
    const y = short[3] !== undefined ? Number(short[3]) : m >= 1 && m <= 12 ? yearFor(m, today) : 0;
    const day = m >= 1 && m <= 12 ? `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}` : null;
    if (day !== null && parseCalendarDate(day)?.precision === "day") {
      return dated(text, short[0], day, day, 0, today);
    }
  }
  const named = new RegExp(
    `\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b(?:,?\\s+(\\d{4})\\b)?`,
    "i",
  ).exec(text);
  if (named !== null) {
    const month = monthOf((named[1] ?? named[5]) as string);
    const d = Number(named[2] ?? named[4]);
    const year = named[3] ?? named[6];
    if (month !== null) {
      const day = `${String(year !== undefined ? Number(year) : yearFor(month, today)).padStart(4, "0")}-${pad(month)}-${pad(d)}`;
      if (parseCalendarDate(day)?.precision === "day") {
        return dated(text, named[0], day, day, 0, today);
      }
    }
  }

  // ── months ───────────────────────────────────────────────────────────────
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  if (/\blast month\b/i.test(text)) {
    const y = tm === 1 ? ty - 1 : ty;
    const m = tm === 1 ? 12 : tm - 1;
    return ask("last month", { from: `${String(y)}-${pad(m)}-01`, to: lastDayOf(y, m) }, FUZZY_STRETCH_DAYS, without(text, "last month"));
  }
  if (/\bthis month\b/i.test(text)) {
    return ask("this month", { from: `${String(ty)}-${pad(tm)}-01`, to: today }, FUZZY_STRETCH_DAYS, without(text, "this month"));
  }
  const part = new RegExp(`\\b(early|mid|late|the start of|the beginning of|the end of|the middle of)[\\s-]+(${MONTH_ALT})\\b`, "i").exec(text);
  if (part !== null) {
    const month = monthOf(part[2] as string);
    if (month !== null) {
      const y = yearFor(month, today);
      const last = lastDayOf(y, month);
      const which = (part[1] as string).toLowerCase();
      const first = `${String(y)}-${pad(month)}-01`;
      const said =
        which === "early" || which === "the start of" || which === "the beginning of"
          ? { from: first, to: `${String(y)}-${pad(month)}-10` }
          : which === "mid" || which === "the middle of"
            ? { from: `${String(y)}-${pad(month)}-11`, to: `${String(y)}-${pad(month)}-20` }
            : { from: `${String(y)}-${pad(month)}-21`, to: last };
      return ask(part[0], said, FUZZY_STRETCH_DAYS, without(text, part[0]));
    }
  }
  const inMonth = new RegExp(`\\b(in|during|since|through|throughout|over)\\s+(${MONTH_ALT})\\b(?:\\s+(\\d{4}))?|\\b(${MONTH_ALT})\\s+(\\d{4})\\b`, "i").exec(text);
  if (inMonth !== null) {
    const name = (inMonth[2] ?? inMonth[4]) as string;
    const month = monthOf(name);
    // "may" as a month only with a year or "in May": "in may" is still ambiguous ("in may be"), so a capital is asked for.
    const mayOk = name.toLowerCase() !== "may" || /\bMay\b/.test(inMonth[0]);
    if (month !== null && mayOk) {
      const yearText = inMonth[3] ?? inMonth[5];
      const y = yearText !== undefined ? Number(yearText) : yearFor(month, today);
      const first = `${String(y)}-${pad(month)}-01`;
      const isSince = (inMonth[1] ?? "").toLowerCase() === "since";
      const found = inMonth[1] !== undefined ? inMonth[0].slice(inMonth[1].length).trim() : inMonth[0];
      return ask(
        inMonth[0].trim(),
        isSince ? { from: first, to: today } : { from: first, to: lastDayOf(y, month) },
        FUZZY_STRETCH_DAYS,
        without(text, found),
      );
    }
  }

  // ── weeks ────────────────────────────────────────────────────────────────
  if (/\blast week\b/i.test(text)) {
    const monday = addDays(mondayOf(today), -7);
    return ask("last week", { from: monday, to: addDays(monday, 6) }, FUZZY_STRETCH_DAYS, without(text, "last week"));
  }
  if (/\bthis week\b/i.test(text)) {
    return ask("this week", { from: mondayOf(today), to: today }, FUZZY_STRETCH_DAYS, without(text, "this week"));
  }
  const pastWeek = /\b(the\s+)?(past|last)\s+(7 days|seven days|week)\b/i.exec(text);
  if (pastWeek !== null) {
    return ask(pastWeek[0], { from: addDays(today, -6), to: today }, 0, without(text, pastWeek[0]));
  }
  const weeksAgo = new RegExp(`\\b(${NUMBER_ALT})\\s+weeks?\\s+ago\\b`, "i").exec(text);
  if (weeksAgo !== null) {
    const n = numberOf(weeksAgo[1] as string) ?? 1;
    const monday = addDays(mondayOf(today), -7 * n);
    return ask(weeksAgo[0], { from: monday, to: addDays(monday, 6) }, FUZZY_STRETCH_DAYS, without(text, weeksAgo[0]));
  }
  const fewWeeks = /\b(the\s+)?(past|last)\s+(few|couple of|two|three)\s+weeks\b/i.exec(text);
  if (fewWeeks !== null) {
    const n = numberOf(fewWeeks[3] as string) ?? 3;
    return ask(fewWeeks[0], { from: addDays(today, -7 * n + 1), to: today }, 0, without(text, fewWeeks[0]));
  }

  // ── days ─────────────────────────────────────────────────────────────────
  // "Last Saturday": the most recent one before today — a week back when
  // today is a Saturday — and exact, as a named day is; a word in front bounds
  // it as it bounds a date ("since last Saturday"). Not "the last Saturday",
  // which is the last of something else ("of June") (2026-10-09).
  const weekday = new RegExp(`(?<!\\bthe\\s)\\b(?:last|this past)\\s+(${WEEKDAY_NAMES.join("|")})\\b(?:['’]s\\b)?`, "i").exec(text);
  if (weekday !== null) {
    const day = lastWeekday(today, WEEKDAY_NAMES.indexOf((weekday[1] as string).toLowerCase() as (typeof WEEKDAY_NAMES)[number]));
    return dated(text, weekday[0], day, day, 0, today, weekday[0].replace(/['’]s$/i, ""));
  }
  // Before "yesterday" is read on its own (review of #323).
  const dayBefore = /\bthe day before yesterday\b/i.exec(text);
  if (dayBefore !== null) {
    const day = addDays(today, -2);
    return ask(dayBefore[0], { from: day, to: day }, 0, without(text, dayBefore[0]));
  }
  const daysAgo = new RegExp(`\\b(${NUMBER_ALT})\\s+days?\\s+ago\\b`, "i").exec(text);
  if (daysAgo !== null) {
    const word = (daysAgo[1] as string).toLowerCase();
    if (word === "few" || word === "a few" || word === "couple" || word === "a couple" || word === "a couple of") {
      return ask(daysAgo[0], { from: addDays(today, -5), to: addDays(today, -2) }, NEAR_STRETCH_DAYS, without(text, daysAgo[0]));
    }
    const n = numberOf(word) ?? 1;
    const day = addDays(today, -n);
    return ask(daysAgo[0], { from: day, to: day }, NEAR_STRETCH_DAYS, without(text, daysAgo[0]));
  }
  if (/\bthe other day\b/i.test(text)) {
    return ask("the other day", { from: addDays(today, -5), to: addDays(today, -2) }, NEAR_STRETCH_DAYS, without(text, "the other day"));
  }
  const pastDays = new RegExp(`\\b(the\\s+)?(past|last)\\s+(${NUMBER_ALT})\\s+days\\b`, "i").exec(text);
  if (pastDays !== null) {
    const n = Math.max(1, numberOf(pastDays[3] as string) ?? 3);
    return ask(pastDays[0], { from: addDays(today, -(n - 1)), to: today }, 0, without(text, pastDays[0]));
  }
  if (/\b(recently|lately)\b/i.test(text)) {
    const found = /\b(recently|lately)\b/i.exec(text)?.[0] ?? "recently";
    return ask(found, { from: addDays(today, -6), to: today }, 0, without(text, found));
  }

  // ── a named day or a clock: `recency-ask.ts`'s reading ───────────────────
  const recency = readRecencyAsk(text, clock);
  if (recency !== null && recency.window !== null) {
    const from = recency.window.from.slice(0, 10);
    const to = recency.window.to.slice(0, 10);
    const cue = recency.cue;
    const rest = cue === "a clock time" ? text : removeWords(text, cue);
    // A whole day is a day; a part of one (a morning, a clock time) filters by the clock too.
    const whole = recency.window.from.endsWith("00:00") && recency.window.to.endsWith("23:59");
    return ask(cue, { from, to }, 0, rest, whole ? {} : { clock: { from: recency.window.from, to: recency.window.to } });
  }
  return null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Take a phrase matched on plain words out of the original text, as words. */
function removeWords(text: string, phrase: string): string {
  const pattern = phrase
    .split(" ")
    .map((w) => escape(w).split("").join("['’]?"))
    .join("[^a-z0-9]+");
  const re = new RegExp(`\\b${pattern}\\b`, "i");
  const m = re.exec(text);
  return m === null ? text : without(text, m[0]);
}
