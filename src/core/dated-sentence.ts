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

/** Sentence ends, as handoff/ reads them, and an ellipsis ("…") before a new sentence (`ellipsisInside`). */
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

/** An ellipsis ("…") mid-thought: it ends a sentence only before a capital, a digit, a quote or the end. */
function ellipsisInside(s: string, at: number): boolean {
  if (s[at] !== "…") return false;
  const next = s.slice(at + 1).trimStart();
  return next.length > 0 && !/^[\p{Lu}\d"'“‘(]/u.test(next);
}

/** The first sentence of `s`, past an abbreviation's or an initial's full stop; `s` whole when none ends. */
export function firstSentence(s: string): string {
  END.lastIndex = 0;
  for (let m = END.exec(s); m !== null; m = END.exec(s)) {
    if (!abbreviationAt(s, m.index) && !ellipsisInside(s, m.index)) return s.slice(0, m.index + 1);
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

/** How strongly `sentence` names `days`: `named`, the days it names by number (score 1 or more), then `score`, the sum. */
function weigh(sentence: string, days: readonly Date[]): { named: number; score: number } {
  let named = 0;
  let score = 0;
  for (const day of days) {
    const n = dayScore(sentence, day);
    if (n >= 1) named += 1;
    score += n;
  }
  return { named, score };
}

/** The date's days, or null for anything but a day or a range. */
function daysAsked(eventDate: string | null | undefined): Date[] | null {
  return typeof eventDate === "string" ? daysOf(eventDate) : null;
}

/** The sentence's place among `text`'s and its weight. */
export interface DatedHit {
  readonly sentence: string;
  /** 0 = the first sentence. */
  readonly index: number;
  /** The days of the date it names by number (ISO, m/d, number with month or weekday, ordinal). */
  readonly named: number;
  /** Its whole score: 2 a day by date or number and month, 1 by number and weekday or ordinal, 0.5 by weekday alone. */
  readonly score: number;
}

/**
 * The sentence of `text` that best names `eventDate` (a day `YYYY-MM-DD` or a
 * range `YYYY-MM-DD..YYYY-MM-DD`): the most of its days named by number, then
 * the highest score, then the earliest. Null when no sentence names it at all,
 * or the date is not a day or a range (a month, a year, nothing readable).
 */
export function sentenceNamingDate(text: string, eventDate: string | null | undefined): DatedHit | null {
  const days = daysAsked(eventDate);
  if (days === null) return null;
  let best: DatedHit | null = null;
  const all = sentencesOf(text);
  for (let index = 0; index < all.length; index++) {
    const sentence = all[index] ?? "";
    const w = weigh(sentence, days);
    if (w.score <= 0) continue;
    if (best === null || w.named > best.named || (w.named === best.named && w.score > best.score)) best = { sentence, index, ...w };
  }
  return best;
}

/** Does `text` (a title, say) name `eventDate` at all, a weekday alone included? */
export function namesDate(text: string, eventDate: string | null | undefined): boolean {
  const days = daysAsked(eventDate);
  return days !== null && weigh(text, days).score > 0;
}

/**
 * THE LINE TO SAY A DATED MEMORY BY (what the wake's "Coming up" and the
 * `coming up` door say, `counterpart-wake-shape.ts#datedTitleOfRow`, less its
 * byte cap): `title` when it has words, else the first sentence of `text`;
 * replaced by the sentence that names `eventDate` only on clear evidence that
 * the lead is about something else:
 *
 * - the title, when there is one, does not name the date itself;
 * - the dated sentence is not the first, and names the date by number
 *   (a weekday in passing never displaces a good title);
 * - it names more of the date's days than the first sentence does (a tie keeps
 *   the lead: "Friday the 16th" and "16 October" both name a day's 16th).
 *
 * A title is presumed to say what the memory leads with, so a later sentence
 * that names the date better is the sign the memory holds two things.
 *
 *   datedSentence("The CR-V listing runs through Friday the 16th… Marisol visits Friday 16 to Sunday 18 October.", "2026-10-16..2026-10-18")
 *   // "Marisol visits Friday 16 to Sunday 18 October."
 */
export function datedSentence(text: string, eventDate: string | null | undefined, title?: string | null): string {
  const t = (title ?? "").trim();
  const all = sentencesOf(text);
  const lead = t.length > 0 ? t : (all[0] ?? text.trim());
  const days = daysAsked(eventDate);
  if (days === null) return lead;
  if (t.length > 0 && weigh(t, days).score > 0) return lead;
  const hit = sentenceNamingDate(text, eventDate);
  if (hit === null || hit.index === 0 || hit.named === 0) return lead;
  const first = weigh(all[0] ?? "", days);
  return hit.named > first.named ? hit.sentence : lead;
}
