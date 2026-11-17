/**
 * THE SENTENCE THAT NAMES A MEMORY'S DATE (2026-11-17, the living journal's
 * finding): "Coming up" said a dated memory by its first sentence, and a memory
 * whose first sentence is about something else pinned its date to the wrong
 * thing. "The CR-V listing runs through Friday the 16th…" led a memory that also
 * held "Marisol visits Friday 16 to Sunday 18 October", dated 16–18 Oct, so the
 * visit read as the CR-V listing. This picks the sentence that names the date.
 *
 * A leaf: pure, no store, no clock, imported by the wake (`counterpart-wake-shape.ts`)
 * and exported from the package entry so a host can call it for its own frame.
 * The date is absolute (a day or a range, as `eventDate` holds it), so nothing
 * here needs today or a zone.
 *
 * How a sentence names a day, strongest first: an ISO date (`2026-10-16`) or a
 * month/day (`10/16`), or the day's number with its month's name anywhere in
 * the sentence ("16 October", "Oct 16-18", "16–18 Oct"); then the number with
 * its weekday ("Friday the 16th") or as an ordinal ("the 16th"); then the
 * weekday alone ("on Friday"). A bare number never names a day ("9:30", "$16",
 * "2016"). Every sentence is scored by the days of the date it names, a range's
 * every day counted, and the best wins, the earliest on a tie: first match
 * would keep the bug, since the CR-V sentence names the range's first day too.
 */

/** Sentence ends, as handoff/ reads them, and an ellipsis ("…", as "..." already ends one). */
const END = /[.!?…](?=\s|$)/g;

/**
 * A full stop that ends a common abbreviation or a lone initial, not a sentence
 * (2026-11-16, journal finding 17: "a stress test with Dr. Okafor at 9:30." read
 * "a stress test with Dr."). Case-sensitive, so "said no. Then" still ends;
 * "No." only before a number ("No. 5"); a lone capital only after a space or
 * the start ("J. Smith", not "FBI."), and never "I" ("so did I. Then").
 */
const ABBREV_BEFORE = /(?:^|[\s("'“‘])(?:Dr|Mr|Mrs|Ms|St|Jr|Sr|Prof|Mt|vs|etc|[Ee]\.g|[Ii]\.e|[ap]\.m|[AP]\.M|[A-HJ-Z])$/u;
const NUMBER_ABBREV = /(?:^|[\s("'“‘])No$/u;

/** Not a sentence's end: the "." after an abbreviation or an initial. */
function abbreviationAt(s: string, dot: number): boolean {
  if (s[dot] !== ".") return false;
  const before = s.slice(0, dot);
  if (ABBREV_BEFORE.test(before)) return true;
  return NUMBER_ABBREV.test(before) && /^\s+\d/u.test(s.slice(dot + 1));
}

/** The first sentence of `s`, past an abbreviation's or an initial's full stop; `s` whole when none ends. */
export function firstSentence(s: string): string {
  END.lastIndex = 0;
  for (let m = END.exec(s); m !== null; m = END.exec(s)) {
    if (!abbreviationAt(s, m.index)) return s.slice(0, m.index + 1);
  }
  return s;
}

/** Every sentence of `text`, in order, trimmed, by `firstSentence`'s rule; a line break ends one too. Empty ones dropped. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let rest = line.trim();
    while (rest.length > 0) {
      const s = firstSentence(rest);
      const t = s.trim();
      if (t.length > 0) out.push(t);
      rest = rest.slice(s.length).trim();
    }
  }
  return out;
}

const MONTH_WORDS: readonly (readonly string[])[] = [
  ["January", "Jan"],
  ["February", "Feb"],
  ["March", "Mar"],
  ["April", "Apr"],
  ["May"],
  ["June", "Jun"],
  ["July", "Jul"],
  ["August", "Aug"],
  ["September", "Sept", "Sep"],
  ["October", "Oct"],
  ["November", "Nov"],
  ["December", "Dec"],
];
const WEEKDAY_WORDS: readonly (readonly string[])[] = [
  ["Sunday", "Sun"],
  ["Monday", "Mon"],
  ["Tuesday", "Tues", "Tue"],
  ["Wednesday", "Wed"],
  ["Thursday", "Thurs", "Thu"],
  ["Friday", "Fri"],
  ["Saturday", "Sat"],
];
/** A range longer than this is scored by its two ends only. */
const MAX_DAYS_SCORED = 31;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The days `eventDate` covers (a day, or a range `a..b`), as UTC dates; null for anything else. */
function daysOf(eventDate: string): Date[] | null {
  const parts = eventDate.trim().split("..");
  if (parts.length > 2) return null;
  const ends: Date[] = [];
  for (const p of parts) {
    const m = DAY_RE.exec(p.trim());
    if (m === null) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCDate() !== Number(m[3])) return null;
    ends.push(d);
  }
  const first = ends[0];
  const last = ends[ends.length - 1];
  if (first === undefined || last === undefined || last < first) return null;
  const span = Math.round((last.getTime() - first.getTime()) / 86_400_000);
  if (span >= MAX_DAYS_SCORED) return [first, last];
  const out: Date[] = [];
  for (let i = 0; i <= span; i++) out.push(new Date(first.getTime() + i * 86_400_000));
  return out;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A capitalised name or abbreviation as a whole word, an abbreviation's own "." allowed ("Oct."): case-sensitive, so "may" and "march" as words are not months. */
const wordsRe = (words: readonly string[]): RegExp => new RegExp(`(?<![A-Za-z])(?:${words.map(escape).join("|")})(?![A-Za-z])`, "u");
const MONTH_RES = MONTH_WORDS.map(wordsRe);
const WEEKDAY_RES = WEEKDAY_WORDS.map(wordsRe);

/** The day's number as a word of its own: not a time, money, a decimal, a year or part of a longer number. */
function numberRe(day: number): { any: RegExp; ordinal: RegExp } {
  const n = `0?${String(day)}`;
  const lead = `(?<![\\d:$£€.,/])`;
  const tail = `(?![\\d:%])(?![.,]\\d)`;
  return { any: new RegExp(`${lead}${n}(?:st|nd|rd|th)?${tail}`, "u"), ordinal: new RegExp(`${lead}${n}(?:st|nd|rd|th)${tail}`, "u") };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** How strongly `sentence` names `day`: 2 by its date or number and month, 1 by its number with its weekday or as an ordinal, 0.5 by its weekday alone, else 0. */
function dayScore(sentence: string, day: Date): number {
  const y = day.getUTCFullYear();
  const mo = day.getUTCMonth() + 1;
  const d = day.getUTCDate();
  if (sentence.includes(`${String(y)}-${pad(mo)}-${pad(d)}`)) return 2;
  if (new RegExp(`(?<![\\d/])0?${String(mo)}/0?${String(d)}(?![\\d])`, "u").test(sentence)) return 2;
  const num = numberRe(d);
  const hasNumber = num.any.test(sentence);
  const month = MONTH_RES[mo - 1]?.test(sentence) === true;
  const weekday = WEEKDAY_RES[day.getUTCDay()]?.test(sentence) === true;
  if (hasNumber && month) return 2;
  if ((hasNumber && weekday) || num.ordinal.test(sentence)) return 1;
  return weekday ? 0.5 : 0;
}

/** How strongly `sentence` names any of `days`: the sum of each day's score. */
function sentenceScore(sentence: string, days: readonly Date[]): number {
  return days.reduce((n, day) => n + dayScore(sentence, day), 0);
}

/**
 * The sentence of `text` that best names `eventDate` (a day `YYYY-MM-DD` or a
 * range `YYYY-MM-DD..YYYY-MM-DD`), with its place among the sentences (0 = the
 * first) and its score; null when no sentence names it, or the date is not a day
 * or a range (a month, a year, or nothing readable).
 */
export function sentenceNamingDate(text: string, eventDate: string | null | undefined): { sentence: string; index: number; score: number } | null {
  if (typeof eventDate !== "string") return null;
  const days = daysOf(eventDate);
  if (days === null) return null;
  let best: { sentence: string; index: number; score: number } | null = null;
  const all = sentencesOf(text);
  for (let index = 0; index < all.length; index++) {
    const sentence = all[index] ?? "";
    const score = sentenceScore(sentence, days);
    if (score > 0 && (best === null || score > best.score)) best = { sentence, index, score };
  }
  return best;
}

/** Does `text` (a title, say) name `eventDate` at all? */
export function namesDate(text: string, eventDate: string | null | undefined): boolean {
  if (typeof eventDate !== "string") return false;
  const days = daysOf(eventDate);
  return days !== null && sentenceScore(text, days) > 0;
}

/**
 * THE SENTENCE TO SAY A DATED MEMORY BY: the one of `text` that names
 * `eventDate` (`sentenceNamingDate`); when none does, `fallback` (a title, say)
 * when it has words, else the first sentence of `text`.
 *
 *   datedSentence("The CR-V listing runs through Friday the 16th. Marisol visits Friday 16 to Sunday 18 October.", "2026-10-16..2026-10-18")
 *   // "Marisol visits Friday 16 to Sunday 18 October."
 */
export function datedSentence(text: string, eventDate: string | null | undefined, fallback?: string | null): string {
  const hit = sentenceNamingDate(text, eventDate);
  if (hit !== null) return hit.sentence;
  const f = (fallback ?? "").trim();
  if (f.length > 0) return f;
  return sentencesOf(text)[0] ?? text.trim();
}
