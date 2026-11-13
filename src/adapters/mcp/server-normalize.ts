/**
 * THE WRITE TOOLS FAIL OPEN (2026-11-13, owner-approved that day). `remember`
 * and `session_end` are the only road from conversation to memory, and until
 * this an optional field the readers could not take — an unreadable
 * `eventDate`, a feeling word off the wheel with no core, a malformed trait,
 * a salience of "0.7" or 1.2, a kind of "lesson" — refused the whole memory
 * (or the whole `session_end` entry), and its words were lost: intake's
 * "degrades to a span" is read only by the crash fallback.
 *
 * THE RULE. This cleans one `remember` call, or one `session_end` entry,
 * BEFORE the existing readers (`server-args.ts`, `remember/intake`) see it,
 * and it never refuses. The content is always kept; the content-level
 * refusals stay where they are (no text, the stub floor, a duplicate, a
 * credential, a size limit). Any optional field it cannot read is DROPPED and
 * named in `dropped` (the field and a short reason code); any value it
 * reinterprets — a synonym, a number sent as text, a number clamped into its
 * range, a date written in words, a feeling word placed on a core — is
 * echoed in `readAs` (the field, what was sent, what it was read as). Both
 * ride in the tool's answer, so the model learns at the moment it matters.
 *
 * OLD SHAPES KEEP WORKING EXACTLY: a value the readers already took passes
 * through untouched, so the output of this is always something the strict
 * readers downstream accept, in the shape they always read.
 *
 * Content in `sent` is cut to `SENT_MAX_CHARS` and never leaves the answer:
 * the durable row (`server.ts#noteWrite`) carries field names, reason codes
 * and counts, and an unplaced feeling's WORD only.
 */
import { isCoreEmotion, lookupWord, CORE_EMOTIONS, FEELINGS_WHEEL, V10_CORES } from "../../core/feelings-wheel.js";
import type { CoreEmotion } from "../../core/feelings-wheel.js";
import { FEELINGS_THESAURUS } from "../../core/feelings-thesaurus.js";
import { feelingWordForm, feelingWordNegated, placeFeelingWord } from "../../core/feelings-place.js";
import { readLooseDate } from "../../core/loose-date.js";
import { isRecurrence, parseCalendarDate } from "../../core/time.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import { ABOUT_MARKS, SAID_BY, STATUSES, axisOfPole, polesOf, repairEmotion } from "../../core/store/index.js";
import type { AboutMark, FeelingInput, TraitInput } from "../../core/store/index.js";
import { MEMORY_KINDS, readAbout, readFeelings, readReminder, readTraits } from "./server-args.js";
import type { ReminderFields } from "./server-args.js";
import type { QuestionEmbedder } from "./server-options.js";

/** How much of a sent value an answer quotes back. */
export const SENT_MAX_CHARS = 64;

/** A trait nudge sent with no strength (a pole word, or an object without one): a middling one. CAL. */
export const DEFAULT_TRAIT_STRENGTH = 0.5;

/**
 * THE EMBEDDER'S BAR for placing a feeling word on a core (step 3), measured
 * 2026-11-13 on potion-base-8M (the static tier): each thesaurus word held out
 * of its core's centroid (wheel words + the rest of the thesaurus), scored by
 * cosine against all seven centroids. At ≥ 0.60 with a margin ≥ 0.15 over the
 * runner-up core it placed 25 of 563 held-out words, all 25 right, and none of
 * 50 non-feeling words or negations; every looser bar tried let a wrong core
 * or a non-feeling word through ("unhappy" → angry at 0.65 / 0.14; "not happy"
 * → happy at 0.59). So the step is rare by design: the thesaurus and the
 * spelling step do the work, and a miss is said and counted, never guessed.
 */
export const MEANING_PLACE_MIN = 0.6;
export const MEANING_PLACE_MARGIN = 0.15;

export interface DroppedField {
  readonly field: string;
  readonly reason: string;
  readonly sent?: string;
  readonly note?: string;
}

export interface ReadAsField {
  readonly field: string;
  readonly sent: string;
  readonly readAs: string;
}

/** What one call or one entry's cleaning said: what it dropped, what it read as something else, which feeling words it could not place. */
export class WriteNotes {
  readonly dropped: DroppedField[] = [];
  readonly readAs: ReadAsField[] = [];
  /** Feeling words nothing placed on a core (word only, lower-case). */
  readonly unplaced: string[] = [];

  drop(field: string, reason: string, sent?: unknown, note?: string): void {
    this.dropped.push({ field, reason, ...(sent === undefined ? {} : { sent: shown(sent) }), ...(note === undefined ? {} : { note }) });
  }

  read(field: string, sent: unknown, readAs: unknown): void {
    this.readAs.push({ field, sent: shown(sent), readAs: shown(readAs) });
  }

  /** The two lists, as an answer carries them; nothing when both are empty. */
  payload(extraDropped: readonly DroppedField[] = []): Record<string, unknown> {
    const dropped = [...this.dropped, ...extraDropped];
    return {
      ...(dropped.length === 0 ? {} : { dropped }),
      ...(this.readAs.length === 0 ? {} : { readAs: [...this.readAs] }),
    };
  }
}

/** A sent value as an answer quotes it: text cut to `SENT_MAX_CHARS`, anything else as short JSON. */
export function shown(v: unknown): string {
  let s: string;
  if (typeof v === "string") s = v;
  else {
    try {
      s = JSON.stringify(v) ?? String(v);
    } catch {
      s = String(v);
    }
  }
  return s.length <= SENT_MAX_CHARS ? s : `${s.slice(0, SENT_MAX_CHARS - 1)}…`;
}

/** Places a feeling word by meaning (step 3), or null. Absent when there is no embedder. */
export type MeaningPlacer = (word: string) => Promise<CoreEmotion | null>;

export interface NormalizeContext {
  /** The person's calendar day (`YYYY-MM-DD`, the store's zone): what date words are read against. */
  readonly today: string;
  readonly placeByMeaning?: MeaningPlacer | null;
}

// ── synonyms ────────────────────────────────────────────────────────────────

const KIND_SYNONYMS: Readonly<Record<string, string>> = {
  people: "person", human: "person", someone: "person", friend: "person", contact: "person",
  me: "self", myself: "self", identity: "self",
  lesson: "skill", "how-to": "skill", howto: "skill", "how to": "skill", technique: "skill", method: "skill", procedure: "skill", practice: "skill",
  note: "fact", event: "fact", decision: "fact", info: "fact", information: "fact", memory: "fact", reminder: "fact", todo: "fact", task: "fact", preference: "fact", observation: "fact",
  thing: "entity", project: "entity", tool: "entity", organization: "entity", organisation: "entity", company: "entity", product: "entity", object: "entity",
  location: "place", city: "place", venue: "place", address: "place",
};

const HOW_SYNONYMS: Readonly<Record<string, string>> = {
  change: "changed", update: "changed", updated: "changed", revised: "changed", revise: "changed", replace: "changed", replaced: "changed", supersede: "changed", superseded: "changed",
  correct: "corrected", correction: "corrected", fix: "corrected", fixed: "corrected", wrong: "corrected", mistaken: "corrected",
  disagree: "open", conflict: "open", contradiction: "open", contradicts: "open", unresolved: "open", both: "open", tension: "open",
};

const REMIND_SYNONYMS: Readonly<Record<string, "plain" | "quiet">> = {
  important: "plain", loud: "plain", yes: "plain", true: "plain", say: "plain", tell: "plain", remind: "plain", explicit: "plain", high: "plain", urgent: "plain", on: "plain",
  silent: "quiet", soft: "quiet", no: "quiet", false: "quiet", low: "quiet", passive: "quiet", off: "quiet", gentle: "quiet",
};

const RECURRING_SYNONYMS: Readonly<Record<string, string>> = {
  annually: "yearly", annual: "yearly", "every year": "yearly", "each year": "yearly", "once a year": "yearly", year: "yearly", birthday: "yearly", anniversary: "yearly",
  "every week": "weekly", "each week": "weekly", "once a week": "weekly", week: "weekly",
  "every day": "daily", "each day": "daily", "once a day": "daily", day: "daily", everyday: "daily", nightly: "daily",
  "every month": "monthly", "each month": "monthly", "once a month": "monthly", month: "monthly",
};

const ABOUT_SYNONYMS: Readonly<Record<string, string>> = {
  myself: "me", self: "me", i: "me", assistant: "me", claude: "me",
  user: "owner", them: "owner", person: "owner", human: "owner", they: "owner", him: "owner", her: "owner", personal: "owner", "the owner": "owner", "the user": "owner",
  "both of us": "us", "the two of us": "us", together: "us", relationship: "us", we: "us", "you and me": "us",
  project: "work", code: "work", codebase: "work", repo: "work", job: "work", task: "work", here: "work", folder: "work",
  other: "world", general: "world", news: "world", everything: "world", external: "world", fact: "world", facts: "world",
};

const SAID_BY_SYNONYMS: Readonly<Record<string, string>> = {
  me: "self", i: "self", assistant: "self", claude: "self", myself: "self", ai: "self", model: "self",
  user: "owner", they: "owner", them: "owner", person: "owner", human: "owner", "the user": "owner", "the owner": "owner",
  guess: "inferred", guessed: "inferred", inference: "inferred", assumed: "inferred", assumption: "inferred", implied: "inferred", deduced: "inferred",
};

const STATUS_SYNONYMS: Readonly<Record<string, string>> = {
  completed: "done", complete: "done", finished: "done", happened: "done", shipped: "done", resolved: "done", closed: "done", past: "done", did: "done",
  todo: "planned", "to do": "planned", "to-do": "planned", scheduled: "planned", decided: "planned", plan: "planned", upcoming: "planned", future: "planned", agreed: "planned", committed: "planned",
  idea: "proposed", suggested: "proposed", suggestion: "proposed", proposal: "proposed", maybe: "proposed", considering: "proposed", possible: "proposed",
  question: "asked", pending: "asked", open: "asked", asking: "asked", "waiting": "asked", unanswered: "asked",
};

const WHOSE_SYNONYMS: Readonly<Record<string, "self" | "owner">> = {
  self: "self", me: "self", i: "self", my: "self", mine: "self", myself: "self", assistant: "self", claude: "self", ai: "self",
  owner: "owner", user: "owner", them: "owner", they: "owner", their: "owner", theirs: "owner", him: "owner", her: "owner", his: "owner", person: "owner", human: "owner",
};

const BOOLEAN_WORDS: Readonly<Record<string, boolean>> = { true: true, yes: true, y: true, "1": true, false: false, no: false, n: false, "0": false };

/** A word as the synonym tables read it: lower-case, single-spaced, outer quotes and punctuation off. */
function wordForm(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/gu, " ").replace(/^["'`]+|["'`.!]+$/gu, "");
}

/**
 * One enum field: kept when it is already one of `allowed`, read as one when
 * a synonym (or its case) says so, dropped and said otherwise. `null` and
 * absent pass as sent (null is "none" where a reader takes it).
 */
function readEnum(
  rec: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  synonyms: Readonly<Record<string, string>>,
  notes: WriteNotes,
  opts: { field?: string; leaveUnknown?: boolean } = {},
): void {
  const field = opts.field ?? key;
  const v = rec[key];
  if (v === undefined || v === null) return;
  if (typeof v === "string" && allowed.includes(v)) return;
  if (typeof v === "string") {
    const w = wordForm(v);
    const as = allowed.includes(w) ? w : synonyms[w];
    if (as !== undefined && allowed.includes(as)) {
      rec[key] = as;
      notes.read(field, v, as);
      return;
    }
  }
  if (opts.leaveUnknown === true) return;
  delete rec[key];
  notes.drop(field, `${key.toLowerCase()}-unknown`, v, `${field} is one of ${allowed.join(", ")}; the memory was kept without it.`);
}

/** A number off the wire: a finite number, or a numeric string read as one. Null otherwise. */
function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*$/u.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A number field held to its range: read, clamped and said, or dropped and said. Null/absent pass as sent. */
function readRanged(rec: Record<string, unknown>, key: string, lo: number, hi: number, notes: WriteNotes, field: string = key): void {
  const v = rec[key];
  if (v === undefined || v === null) return;
  const n = numberOf(v);
  if (n === null) {
    delete rec[key];
    notes.drop(field, "not-a-number", v, `${field} is a number from ${String(lo)} to ${String(hi)}; the memory was kept without it.`);
    return;
  }
  const kept = Math.min(hi, Math.max(lo, n));
  if (kept !== v) {
    rec[key] = kept;
    notes.read(field, v, kept);
  }
}

// ── one call, or one entry ──────────────────────────────────────────────────

/**
 * Clean one `remember` call (`contentKey: "text"`) or one `session_end` entry
 * (`"content"`) into the shape the readers take, saying in `notes` what was
 * dropped or read as something else. Never throws on what was sent; never
 * drops the content. The side operations (`remove`, `core`, `remark`,
 * `settle`) are the tool's own to judge — this only reads `remove` given as
 * an id and `feelingsNow` given as strings.
 */
export async function normalizeMemoryFields(
  raw: Record<string, unknown>,
  contentKey: "text" | "content",
  ctx: NormalizeContext,
  notes: WriteNotes,
): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = { ...raw };
  // THE CONTENT, under either name: `text` and `content` are one field.
  const other = contentKey === "text" ? "content" : "text";
  const main = rec[contentKey];
  const alt = rec[other];
  if (!(typeof main === "string" && main.trim().length > 0) && typeof alt === "string" && alt.trim().length > 0) {
    rec[contentKey] = alt;
    notes.read(other, "(text)", contentKey);
  }
  delete rec[other];

  readEnum(rec, "kind", MEMORY_KINDS, KIND_SYNONYMS, notes);
  if (rec["title"] !== undefined && rec["title"] !== null && typeof rec["title"] !== "string") {
    if (typeof rec["title"] === "number" && Number.isFinite(rec["title"])) {
      notes.read("title", rec["title"], String(rec["title"]));
      rec["title"] = String(rec["title"]);
    } else {
      notes.drop("title", "title-not-text", rec["title"]);
      delete rec["title"];
    }
  }
  if (rec["title"] === null) delete rec["title"];
  if (rec["updates"] !== undefined && rec["updates"] !== null && typeof rec["updates"] !== "string") {
    notes.drop("updates", "updates-not-text", rec["updates"], "updates is one memory's id; the memory was kept as a new one.");
    delete rec["updates"];
  }
  if (rec["updates"] === null) delete rec["updates"];
  readEnum(rec, "how", ["changed", "corrected", "open"], HOW_SYNONYMS, notes);

  // HOW MUCH IT MATTERS: a number 0-1, a numeric string read, out of range clamped.
  readRanged(rec, "salience", 0, 1, notes);
  for (const dim of AUTHOR_DIMENSIONS) readRanged(rec, dim, 0, 1, notes);

  readEnum(rec, "saidBy", SAID_BY, SAID_BY_SYNONYMS, notes, { leaveUnknown: true });
  readEnum(rec, "status", STATUSES, STATUS_SYNONYMS, notes, { leaveUnknown: true });
  readReminderFields(rec, ctx.today, notes);
  // WHEN IT HAPPENED, in words too; one this cannot read is left for
  // `readWriteFacts`, which drops it and says so beside the memory (v12).
  const occurred = rec["occurredOn"];
  if (typeof occurred === "string") {
    const read = readLooseDate(occurred, ctx.today, "back");
    if (read !== null && read.words) {
      rec["occurredOn"] = read.text;
      notes.read("occurredOn", occurred, read.text);
    }
  }
  readEnum(rec, "about", ABOUT_MARKS, ABOUT_SYNONYMS, notes);
  const open = rec["unresolved"];
  if (open !== undefined && open !== null && typeof open !== "boolean") {
    const b = typeof open === "string" ? BOOLEAN_WORDS[wordForm(open)] : open === 1 ? true : open === 0 ? false : undefined;
    if (b === undefined) {
      notes.drop("unresolved", "not-true-or-false", open);
      delete rec["unresolved"];
    } else {
      rec["unresolved"] = b;
      notes.read("unresolved", open, b);
    }
  }

  if (rec["feelings"] !== undefined) {
    const list = await normalizeFeelings(rec["feelings"], ctx, notes, "feelings");
    if (list === undefined) delete rec["feelings"];
    else rec["feelings"] = list;
  }
  if (rec["traits"] !== undefined) {
    const list = normalizeTraits(rec["traits"], notes);
    if (list === undefined) delete rec["traits"];
    else rec["traits"] = list;
  }
  if (contentKey === "text") {
    // `remove` named by its id alone means {id}.
    if (typeof rec["remove"] === "string" && rec["remove"].trim().length > 0) {
      notes.read("remove", rec["remove"], `{id: "${rec["remove"].trim()}"}`);
      rec["remove"] = { id: rec["remove"].trim() };
    }
    if (rec["feelingsNow"] !== undefined && rec["feelingsNow"] !== null) {
      const now = await normalizeFeelingsNow(rec["feelingsNow"], ctx, notes);
      if (now !== undefined) rec["feelingsNow"] = now;
    }
  }
  return rec;
}

/**
 * `eventDate`, `remind` and `recurring`: a date in words read (leaning ahead —
 * or back for a memory marked done, whose passed date becomes when it
 * happened); a synonym read; what cannot be read dropped and said. A repeat
 * beside a date that is not one day drops the repeat and keeps the date.
 */
function readReminderFields(rec: Record<string, unknown>, today: string, notes: WriteNotes): void {
  // `remind: true` is "say it on the day"; false, quiet.
  if (typeof rec["remind"] === "boolean") {
    const as = rec["remind"] ? "plain" : "quiet";
    notes.read("remind", rec["remind"], as);
    rec["remind"] = as;
  }
  readEnum(rec, "remind", ["plain", "quiet"], REMIND_SYNONYMS, notes);
  if (rec["remind"] !== undefined && rec["remind"] !== null && rec["remind"] !== "plain" && rec["remind"] !== "quiet") {
    notes.drop("remind", "remind-unknown", rec["remind"]);
    delete rec["remind"];
  }
  const rule = rec["recurring"];
  if (rule !== undefined && rule !== null && !isRecurrence(rule)) {
    const w = typeof rule === "string" ? wordForm(rule) : "";
    const as = isRecurrence(w) ? w : RECURRING_SYNONYMS[w];
    if (as !== undefined && isRecurrence(as)) {
      rec["recurring"] = as;
      notes.read("recurring", rule, as);
    } else {
      notes.drop("recurring", "recurring-unknown", rule, 'recurring is "daily", "weekly", "monthly" or "yearly"; the date was kept, once.');
      delete rec["recurring"];
    }
  }
  const date = rec["eventDate"];
  if (date !== undefined && date !== null) {
    const done = rec["status"] === "done" && typeof rec["updates"] !== "string";
    const read = readLooseDate(date, today, done ? "back" : "ahead");
    if (read === null) {
      notes.drop(
        "eventDate",
        "event-date-unreadable",
        date,
        'Not a date this can read, so the memory was kept with no reminder date: a day "2026-10-15", a month "2026-10", a range "2026-10-20..2026-10-31", or words like "next Friday".',
      );
      delete rec["eventDate"];
    } else if (read.words) {
      rec["eventDate"] = read.text;
      notes.read("eventDate", date, read.text);
    } else if (read.text !== date) {
      rec["eventDate"] = read.text;
    }
  }
  const kept = rec["eventDate"];
  if (isRecurrence(rec["recurring"]) && typeof kept === "string" && parseCalendarDate(kept)?.precision !== "day") {
    notes.drop("recurring", "recurring-needs-day", rec["recurring"], "Only one day repeats; this date is not one day, so it was kept once, without the repeat.");
    delete rec["recurring"];
  }
}

// ── feelings ────────────────────────────────────────────────────────────────

/** Where a feeling's word ends and what carried it begins, in a string feeling. */
const FEELING_BREAK = /\s*[—–]\s*|\s+-\s+|\s*[:;]\s*|\s+because\s+|\s+as\s+|\s+that\s+|\s*\(\s*/iu;

/**
 * One string feeling read as the object form: `"self: relieved — the test
 * passed"`, `"owner: frustrated"`, `"relieved"`. `whose` before a colon
 * (default self); the word; what carried it after a dash, a colon,
 * "because" or a parenthesis. Null for an empty one.
 */
export function parseFeelingString(s: string): Record<string, unknown> | null {
  let rest = s.trim();
  if (rest.length === 0) return null;
  let whose: string | undefined;
  const head = /^([A-Za-z]+)\s*[:：]\s*/u.exec(rest);
  if (head !== null) {
    const said = head[1] as string;
    const w = WHOSE_SYNONYMS[said.toLowerCase()];
    if (w !== undefined) {
      whose = w;
      rest = rest.slice(head[0].length);
    } else if (lookupWord(said) === undefined && placeFeelingWord(said) === null) {
      // "Mike: frustrated" — a name where whose goes, not a feeling before its
      // nuance: kept as sent, so the feeling is dropped as whose-unknown
      // rather than stored as a feeling called "Mike".
      whose = said;
      rest = rest.slice(head[0].length);
    }
  }
  const cut = FEELING_BREAK.exec(rest);
  let word = rest;
  let carried = "";
  if (cut !== null && cut.index > 0) {
    word = rest.slice(0, cut.index);
    carried = rest.slice(cut.index + cut[0].length).replace(/\)\s*$/u, "");
  } else if (/,/u.test(rest)) {
    const at = rest.indexOf(",");
    if (rest.slice(0, at).trim().split(/\s+/u).length <= 3) {
      word = rest.slice(0, at);
      carried = rest.slice(at + 1);
    }
  }
  word = word.trim();
  if (word.length === 0) return null;
  return { whose: whose ?? "self", emotion: word, ...(carried.trim().length === 0 ? {} : { carried_by: carried.trim() }) };
}

/**
 * What the durable row may carry of a word nothing placed: the word itself
 * when it is one short word or two (what the thesaurus could grow by), else
 * only that it was a phrase — a longer value can be a sentence of the memory.
 */
export function missedWord(word: string): string {
  const form = feelingWordForm(word);
  return /^[a-z][a-z'-]{0,29}(?: [a-z][a-z'-]{0,29})?$/u.test(form) && form.length <= 40 ? form : "(phrase)";
}

/** A list field sent as one item, or as the list. Undefined when it is neither. */
function asList(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" || (raw !== null && typeof raw === "object")) return [raw];
  return undefined;
}

/**
 * The `feelings` list cleaned: strings read as objects, a single item as a
 * list, `whose` and the numbers read, and a feeling with no core PLACED on one
 * (`placeFeelingWord`, then the embedder when it is sure) — the writer's word
 * always kept as theirs. A feeling that still will not store is dropped ALONE
 * and said; the rest, and the memory, stand. Undefined when nothing is left.
 */
export async function normalizeFeelings(
  raw: unknown,
  ctx: NormalizeContext,
  notes: WriteNotes,
  field: string,
): Promise<Record<string, unknown>[] | undefined> {
  if (raw === undefined || raw === null) return undefined;
  const items = asList(raw);
  if (items === undefined) {
    notes.drop(field, "feelings-not-a-list", raw, 'feelings is a list, one per feeling: "self: relieved — what carried it".');
    return undefined;
  }
  const kept: { from: number; f: Record<string, unknown> }[] = [];
  for (const [i, item] of items.entries()) {
    const at = `${field}[${String(i)}]`;
    let f: Record<string, unknown> | null;
    if (typeof item === "string") f = parseFeelingString(item);
    else if (item !== null && typeof item === "object" && !Array.isArray(item)) f = { ...(item as Record<string, unknown>) };
    else f = null;
    if (f === null) {
      notes.drop(at, "feeling-unreadable", item);
      continue;
    }
    const fixed = await fixFeeling(f, at, ctx, notes);
    if (fixed === null) continue;
    // Checked ALONE, `beneath` aside: one that still will not store goes by itself.
    const { beneath: _b, ...alone } = fixed;
    const check = readFeelings([alone]);
    if ("refused" in check) {
      notes.drop(at, "feeling-invalid", fixed["emotion"], check.refused.replace(/^feelings\[0\]/u, at));
      continue;
    }
    kept.push({ from: i, f: fixed });
  }
  if (kept.length === 0) return undefined;
  // `beneath` is an index into the list as SENT: renumbered past the ones dropped.
  const indexOf = new Map(kept.map((k, n) => [k.from, n]));
  const out = kept.map((k, n) => {
    const b = k.f["beneath"];
    if (b === undefined || b === null) return k.f;
    const to = typeof b === "number" ? indexOf.get(b) : undefined;
    if (to === undefined || to === n) {
      notes.drop(`${field}[${String(k.from)}].beneath`, "beneath-not-kept", b);
      const { beneath: _x, ...rest } = k.f;
      return rest;
    }
    return { ...k.f, beneath: to };
  });
  if ("refused" in readFeelings(out)) {
    // A loop of "this sits on that": every `beneath` goes, the feelings stay.
    const flat = out.map(({ beneath: _x, ...rest }) => rest);
    if (out.some((f) => f["beneath"] !== undefined)) notes.drop(`${field}[].beneath`, "beneath-cycle");
    if ("refused" in readFeelings(flat)) {
      notes.drop(field, "feelings-invalid");
      return undefined;
    }
    return flat;
  }
  return out;
}

/** One feeling's fields read; its core placed when it has none and its word is off the wheel. Null when dropped. */
async function fixFeeling(f: Record<string, unknown>, at: string, ctx: NormalizeContext, notes: WriteNotes): Promise<Record<string, unknown> | null> {
  // The word under the names a writer reaches for.
  if (typeof f["emotion"] !== "string" || f["emotion"].trim().length === 0) {
    for (const k of ["feeling", "word", "name"]) {
      if (typeof f[k] === "string" && (f[k] as string).trim().length > 0) {
        f["emotion"] = f[k];
        delete f[k];
        break;
      }
    }
  }
  if (typeof f["emotion"] !== "string" || f["emotion"].trim().length === 0) {
    notes.drop(at, "emotion-missing", f);
    return null;
  }
  if (f["carried_by"] === undefined) {
    for (const k of ["carriedBy", "because", "why", "what"]) {
      if (typeof f[k] === "string") {
        f["carried_by"] = f[k];
        delete f[k];
        break;
      }
    }
  }
  if (f["carried_by"] !== undefined && typeof f["carried_by"] !== "string") {
    notes.drop(`${at}.carried_by`, "not-text", f["carried_by"]);
    delete f["carried_by"];
  }
  if (f["other_word"] !== undefined && typeof f["other_word"] !== "string") {
    notes.drop(`${at}.other_word`, "not-text", f["other_word"]);
    delete f["other_word"];
  }
  // WHOSE: self when left out; a synonym read; anything else is not placed on anyone.
  const whose = f["whose"];
  if (whose === undefined || whose === null || (typeof whose === "string" && whose.trim().length === 0)) f["whose"] = "self";
  else if (whose !== "self" && whose !== "owner") {
    const as = typeof whose === "string" ? WHOSE_SYNONYMS[wordForm(whose)] : undefined;
    if (as === undefined) {
      notes.drop(at, "whose-unknown", whose, 'whose is "self" or "owner"; this feeling was not kept.');
      return null;
    }
    notes.read(`${at}.whose`, whose, as);
    f["whose"] = as;
  }
  readRanged(f, "strength", 0, 1, notes, `${at}.strength`);
  readRanged(f, "valence", -1, 1, notes, `${at}.valence`);
  if (f["beneath"] !== undefined && f["beneath"] !== null && !(typeof f["beneath"] === "number" && Number.isInteger(f["beneath"]))) {
    const n = numberOf(f["beneath"]);
    if (n !== null && Number.isInteger(n)) f["beneath"] = n;
    else {
      notes.drop(`${at}.beneath`, "beneath-not-an-index", f["beneath"]);
      delete f["beneath"];
    }
  }
  // THE CORE. One of the seven (or a first-wheel name) stands; a word the
  // placement reads as a core ("joy" → happy) is read as it; anything else is
  // dropped, and the core is placed from the feeling's word below.
  const core = f["core"];
  if (core === null || (typeof core === "string" && core.trim().length === 0)) delete f["core"];
  else if (core !== undefined) {
    const c = typeof core === "string" ? core.trim().toLowerCase() : "";
    if (isCoreEmotion(c) || (V10_CORES as readonly string[]).includes(c)) {
      if (c !== core) f["core"] = c;
    } else {
      const placed = c.length > 0 && c.length <= 40 ? placeFeelingWord(c) : null;
      if (placed !== null && (placed.by === "wheel" || placed.by === "thesaurus")) {
        notes.read(`${at}.core`, core, placed.core);
        f["core"] = placed.core;
      } else {
        notes.drop(`${at}.core`, "core-unknown", core, `core is one of ${CORE_EMOTIONS.join(", ")}; it was placed from the word instead.`);
        delete f["core"];
      }
    }
  }
  if (f["core"] !== undefined) return f;
  const emotion = f["emotion"] as string;
  const isOther = emotion.trim().toLowerCase() === "other";
  const word = isOther ? (typeof f["other_word"] === "string" ? f["other_word"] : "") : (repairEmotion(emotion, "")?.emotion ?? emotion);
  if (word.trim().length === 0) return f; // `other` with no word: the check says so.
  if (lookupWord(word) !== undefined) return f; // On the wheel: its home core, as always.
  const placed = placeFeelingWord(word);
  if (placed !== null) {
    f["core"] = placed.core;
    notes.read(`${at}.core`, word, placed.core);
    return f;
  }
  const meant = ctx.placeByMeaning == null ? null : await safePlace(ctx.placeByMeaning, word);
  if (meant !== null) {
    f["core"] = meant;
    notes.read(`${at}.core`, word, meant);
    return f;
  }
  notes.unplaced.push(missedWord(word));
  notes.drop(
    at,
    "feeling-unplaced",
    word,
    `"${shown(word)}" is not a feeling word this could place, so that one feeling was not kept (the memory was). Give it a core (${CORE_EMOTIONS.join(", ")}) to keep your word.`,
  );
  return null;
}

async function safePlace(place: MeaningPlacer, word: string): Promise<CoreEmotion | null> {
  try {
    return await place(word);
  } catch {
    return null;
  }
}

/**
 * `feelingsNow` (remember's "how a memory shown here feels now"): one item or
 * a list; a string `"<id>: word — what changed"` read as `{id, emotion,
 * carried_by}`; a core placed as for `feelings`. Items it cannot read pass
 * through for `feelAgain` to answer one by one. Undefined when the value is
 * no list at all (the tool decides what that costs).
 */
async function normalizeFeelingsNow(raw: unknown, ctx: NormalizeContext, notes: WriteNotes): Promise<unknown[] | undefined> {
  const items = asList(raw);
  if (items === undefined) return undefined;
  const out: unknown[] = [];
  for (const [i, item] of items.entries()) {
    const at = `feelingsNow[${String(i)}]`;
    let f: Record<string, unknown> | null = null;
    if (typeof item === "string") {
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*[:：]\s*(.+)$/su.exec(item);
      const parsed = m === null ? null : parseFeelingString(m[2] as string);
      if (m === null || parsed === null) {
        notes.drop(at, "feeling-now-unreadable", item, 'One per memory: "<id>: word — what changed".');
        continue;
      }
      f = { id: m[1], ...parsed };
    } else if (item !== null && typeof item === "object" && !Array.isArray(item)) f = { ...(item as Record<string, unknown>) };
    if (f === null) {
      out.push(item);
      continue;
    }
    const fixed = typeof f["emotion"] === "string" || typeof f["feeling"] === "string" ? await fixFeeling(f, at, ctx, notes) : f;
    if (fixed !== null) out.push(fixed);
  }
  return out;
}

// ── traits ──────────────────────────────────────────────────────────────────

/**
 * The `traits` list cleaned: a string `"bold — what showed it"` (or one
 * item, or `{toward}` with no axis) read to its axis, a strength defaulted
 * (`DEFAULT_TRAIT_STRENGTH`) or read and clamped. A nudge that still will not
 * store is dropped alone and said. Undefined when nothing is left.
 */
export function normalizeTraits(raw: unknown, notes: WriteNotes): Record<string, unknown>[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const items = asList(raw);
  if (items === undefined) {
    notes.drop("traits", "traits-not-a-list", raw);
    return undefined;
  }
  const out: Record<string, unknown>[] = [];
  for (const [i, item] of items.entries()) {
    const at = `traits[${String(i)}]`;
    let t: Record<string, unknown> | null = null;
    if (typeof item === "string") {
      const s = item.trim();
      const cut = FEELING_BREAK.exec(s);
      const head = (cut !== null && cut.index > 0 ? s.slice(0, cut.index) : s).trim().toLowerCase().replace(/^(?:more|toward|towards|a bit|slightly|very)\s+/u, "");
      const tail = cut !== null && cut.index > 0 ? s.slice(cut.index + cut[0].length).replace(/\)\s*$/u, "").trim() : "";
      const axis = axisOfPole(head);
      if (axis === undefined) {
        notes.drop(at, "trait-unknown", item, "A trait is one pole word: careful/bold, agreeable/candid, guarded/open, focused/curious, following/initiating, inward/outward, serious/playful.");
        continue;
      }
      t = { axis, toward: head, strength: DEFAULT_TRAIT_STRENGTH, ...(tail.length === 0 ? {} : { carried_by: tail }) };
      notes.read(at, item, `${axis}: ${head}`);
    } else if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      t = { ...(item as Record<string, unknown>) };
      if (t["carried_by"] === undefined && typeof t["carriedBy"] === "string") {
        t["carried_by"] = t["carriedBy"];
        delete t["carriedBy"];
      }
      const toward = typeof t["toward"] === "string" ? wordForm(t["toward"]) : undefined;
      const axisSent = typeof t["axis"] === "string" ? wordForm(t["axis"]) : undefined;
      if (toward !== undefined && toward !== t["toward"]) t["toward"] = toward;
      // The axis as a pole ("bold") with no toward: that pole, on its axis.
      if (toward === undefined && axisSent !== undefined && axisOfPole(axisSent) !== undefined) {
        t["toward"] = axisSent;
        t["axis"] = axisOfPole(axisSent);
        notes.read(`${at}.axis`, axisSent, t["axis"]);
      } else if (toward !== undefined && (axisSent === undefined || polesOf(axisSent) === undefined || !(polesOf(axisSent) as readonly string[]).includes(toward))) {
        const axis = axisOfPole(toward);
        if (axis !== undefined) {
          if (axisSent !== undefined) notes.read(`${at}.axis`, t["axis"], axis);
          t["axis"] = axis;
        }
      } else if (axisSent !== undefined && axisSent !== t["axis"]) t["axis"] = axisSent;
      if (t["strength"] === undefined || t["strength"] === null) {
        t["strength"] = DEFAULT_TRAIT_STRENGTH;
      } else readRanged(t, "strength", 0, 1, notes, `${at}.strength`);
      if (t["strength"] === undefined) t["strength"] = DEFAULT_TRAIT_STRENGTH;
      if (t["carried_by"] !== undefined && typeof t["carried_by"] !== "string") {
        notes.drop(`${at}.carried_by`, "not-text", t["carried_by"]);
        delete t["carried_by"];
      }
    }
    if (t === null) {
      notes.drop(at, "trait-unreadable", item);
      continue;
    }
    const check = readTraits([t]);
    if ("refused" in check) {
      notes.drop(at, "trait-invalid", item, check.refused.replace(/^traits\[0\]/u, at));
      continue;
    }
    out.push(t);
  }
  return out.length === 0 ? undefined : out;
}

// ── the embedder's step ─────────────────────────────────────────────────────

const NEGATING_PREFIX = /^(?:un|dis|in|im|ir|il|non|mis)(?=[a-z]{3})/u;

/** Each core's centroid over its wheel words and thesaurus words, per embedder (built once, on the first miss). */
const CENTROIDS = new WeakMap<QuestionEmbedder, Promise<Map<CoreEmotion, number[]> | null>>();

function unit(v: readonly number[]): number[] | null {
  const n = Math.hypot(...v);
  return n > 0 && Number.isFinite(n) ? v.map((x) => x / n) : null;
}

async function centroidsOf(embedder: QuestionEmbedder): Promise<Map<CoreEmotion, number[]> | null> {
  const sums = new Map<CoreEmotion, number[]>();
  const words: [string, CoreEmotion][] = [...FEELINGS_WHEEL.map((e) => [e.key, e.core] as [string, CoreEmotion]), ...FEELINGS_THESAURUS];
  for (const [word, core] of words) {
    const v = await embedder.vector(word);
    const u = v === null ? null : unit(v);
    if (u === null) continue;
    const s = sums.get(core);
    if (s === undefined) sums.set(core, u);
    else if (s.length === u.length) for (let i = 0; i < u.length; i++) s[i] = (s[i] as number) + (u[i] as number);
  }
  if (sums.size !== CORE_EMOTIONS.length) return null;
  const out = new Map<CoreEmotion, number[]>();
  for (const [core, s] of sums) {
    const u = unit(s);
    if (u === null) return null;
    out.set(core, u);
  }
  return out;
}

/**
 * Step 3, by meaning: the nearest core when the embedder is SURE — cosine to
 * that core's centroid at least `MEANING_PLACE_MIN` and ahead of the
 * runner-up by `MEANING_PLACE_MARGIN` — else null. Never for a negation ("not
 * happy") or a word that is a known one with a negating prefix ("unhappy"):
 * a static table reads both as the word they negate.
 */
export function meaningPlacer(embedder: QuestionEmbedder): MeaningPlacer {
  return async (word: string): Promise<CoreEmotion | null> => {
    const form = feelingWordForm(word);
    if (form.length === 0 || form.length > 40 || form.split(" ").length > 4 || feelingWordNegated(form)) return null;
    const bare = form.replace(NEGATING_PREFIX, "");
    if (bare !== form && (lookupWord(bare) !== undefined || FEELINGS_THESAURUS.has(bare) || placeFeelingWord(bare) !== null)) return null;
    let pending = CENTROIDS.get(embedder);
    if (pending === undefined) {
      pending = centroidsOf(embedder).catch(() => null);
      CENTROIDS.set(embedder, pending);
    }
    const cents = await pending;
    if (cents === null) return null;
    const v = await embedder.vector(form);
    const u = v === null ? null : unit(v);
    if (u === null) return null;
    const scored = [...cents.entries()]
      .map(([core, c]) => ({ core, s: c.length === u.length ? c.reduce((t, x, i) => t + x * (u[i] as number), 0) : -1 }))
      .sort((a, b) => b.s - a.s);
    const [top, next] = scored;
    if (top === undefined || next === undefined) return null;
    return top.s >= MEANING_PLACE_MIN && top.s - next.s >= MEANING_PLACE_MARGIN ? top.core : null;
  };
}

// ── the readers, made to fail open ──────────────────────────────────────────

/** A kind intake takes. */
export function isKind(v: unknown): v is string {
  return typeof v === "string" && (MEMORY_KINDS as readonly string[]).includes(v);
}

/** A `how` intake takes. */
export function isHow(v: unknown): v is string {
  return v === "changed" || v === "corrected" || v === "open";
}

/** Which field a reminder refusal names. */
const REMINDER_FIELD: Readonly<Record<string, string>> = {
  "event-date-unreadable": "eventDate",
  "remind-unknown": "remind",
  "recurring-unknown": "recurring",
  "recurring-needs-day": "recurring",
};

/**
 * `readReminder`, never refused: a field it would refuse is dropped and said,
 * and the rest read again without it. After the cleaning this is a net that
 * should never catch anything.
 */
export function readReminderLoose(rec: Record<string, unknown>, notes: WriteNotes): ReminderFields {
  let at = rec;
  for (let i = 0; i < 4; i++) {
    const read = readReminder(at);
    if (!("refused" in read)) return read;
    const field = REMINDER_FIELD[read.refused] ?? "eventDate";
    notes.drop(field, read.refused, at[field], read.detail);
    at = { ...at };
    delete at[field];
  }
  return { fields: {}, remindIgnored: false };
}

/** The three dimensions, each unusable one dropped and said (`readDimensions` refused them all). */
export function dropDimensions(rec: Record<string, unknown>, notes: WriteNotes): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    const v = rec[dim];
    if (v === undefined) continue;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) out[dim] = v;
    else notes.drop(dim, "dimension-out-of-range", v, `${dim} is a number from 0 to 1; the memory was kept without it.`);
  }
  return out;
}

/** `readFeelings`, never refused: feelings that will not store are dropped and said, the memory kept. */
export function readFeelingsLoose(raw: unknown, notes: WriteNotes): { inputs: FeelingInput[] } {
  const read = readFeelings(raw);
  if (!("refused" in read)) return read;
  notes.drop("feelings", "feelings-malformed", undefined, read.refused);
  return { inputs: [] };
}

/** `readAbout`, never refused. */
export function readAboutLoose(raw: unknown, notes: WriteNotes): { mark: AboutMark | null } {
  const read = readAbout(raw);
  if (!("refused" in read)) return read;
  notes.drop("about", "about-unknown", raw, read.refused);
  return { mark: null };
}

/** `readTraits`, never refused. */
export function readTraitsLoose(raw: unknown, notes: WriteNotes): { inputs: TraitInput[] } {
  const read = readTraits(raw);
  if (!("refused" in read)) return read;
  notes.drop("traits", "traits-malformed", undefined, read.refused);
  return { inputs: [] };
}

/**
 * The writer's three fields' drops (`readWriteFacts`, already loose since v12)
 * as the top-level `dropped` list carries them, so one list names everything
 * a write left out. A done's passed `eventDate` kept as `occurredOn` is said
 * there too, as moved rather than unreadable.
 */
export function factsDropped(read: { readonly dropped: readonly { readonly field: string; readonly note: string }[] }): DroppedField[] {
  return read.dropped.map((d) => ({ field: d.field, reason: d.field === "eventDate" ? "kept-as-occurredOn" : "unreadable", note: d.note }));
}
