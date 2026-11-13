/** The MCP tools' argument readers — and, since 2026-11-13, the cleaning that makes `remember` and `session_end` fail open (`normalizeMemoryFields`) — kinds, dimensions, reminders, feelings, traits, facts, tags, `about` — and the echoes that say back what was read (moved out of `server.ts`, 2026-10-11). */
import type { DepositResult, SentFacts } from "../../core/counterpart.js";
import { isRecurrence, occurrenceOnOrAfter, parseCalendarDate, readLooseDate, readableDate, readableRecurrence } from "../../core/time.js";
import { ALIASES, CORE_EMOTIONS, FEELINGS_THESAURUS, FEELINGS_WHEEL, V10_CORES, isCoreEmotion, lookupWord } from "../../core/feelings-wheel.js";
import type { CoreEmotion } from "../../core/feelings-wheel.js";
import type { Recurrence } from "../../core/time.js";
import { AUTHOR_DIMENSIONS, ownPlumbingNote } from "../../core/remember/index.js";
import { screenTags } from "../../core/tag-screen.js";
import {
  ABOUT_MARKS,
  SAID_BY,
  STATUSES,
  axisOfPole,
  checkFeelings,
  checkTraits,
  isStoreError,
  polesOf,
  repairEmotion,
  saidByOf,
  statusOf,
  stemTerm,
} from "../../core/store/index.js";
import type { AboutMark, FeelingInput, MemoryStatus, SaidBy, TraitInput } from "../../core/store/index.js";
import type { Kind } from "../../core/types.js";
import type { DeliberateResult } from "./deliberate.js";
import type { QuestionEmbedder } from "./server-options.js";

const KIND_SET: Record<Kind, true> = { self: true, person: true, entity: true, skill: true, place: true, fact: true };

export const MEMORY_KINDS = Object.keys(KIND_SET) as readonly Kind[];

/** What one recall call's durable row says (`noteRecall`). Counts only. */
export interface RecallRowFields {
  readonly path: "handle" | "question" | "none";
  readonly reason: string;
  readonly semantic: string;
  readonly considered: number;
  readonly storeSize: number;
  readonly expanded: number;
  readonly blockedBy: Readonly<Record<string, number>>;
  readonly mode?: "facts" | "meaning";
  readonly matched?: number;
  readonly shown?: number;
  readonly faded?: number;
  readonly page?: number;
  /** A question that named a time: `window`, `event` or `session`. */
  readonly time?: string;
  /** Meaning mode's own counts (`MeaningResult.counts`). */
  readonly counts?: Readonly<Record<string, number>>;
  /** By address: the dreams and reflections opened (`nights.ts`) — not memories, so not `expanded`. */
  readonly nights?: number;
  /**
   * A facts answer's title tail, by id (`facts.ts#FACTS_TAIL_SIZE`; 2026-10-20,
   * from the benchmark loss read; helps real recall too; lightly held,
   * revisit): listed, not delivered — kept apart from the delivered ids
   * so a later open by id can be joined against it (the ~10-27 check).
   */
  readonly tail?: readonly string[];
  /**
   * A question's dreams (D1, review of #663): each dream that came beside the
   * answer, why, and its meaning score (null when none was measured) — so the
   * bar can be calibrated on live use. Ids and numbers only.
   */
  readonly dreams?: readonly { readonly id: string; readonly why: string; readonly score: number | null }[];
  /** How long the recall took, ms (FD1 step 5, 2026-11-07): a question's mode
   *  answer (embedding left out), or an address's read. */
  readonly elapsedMs?: number;
}

/**
 * The address paths' refusals are their own `reason` — one per id on the
 * `ids` path, so three unknown ids read as three and not as one.
 */
export function addressBlocked(result: DeliberateResult): Record<string, number> {
  const out: Record<string, number> = {};
  const reasons =
    result.path === "none"
      ? [result.reason]
      : result.perId === undefined
        ? result.reason === "expanded"
          ? []
          : [result.reason]
        : result.perId.filter((p) => p.reason !== "expanded").map((p) => p.reason);
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

export function resolvedIdOf(result: DeliberateResult): string | null | undefined {
  switch (result.reason) {
    case "expanded":
      return result.memories.length === 1 ? (result.memories[0]?.id ?? null) : undefined;
    case "handle-unknown":
    case "handle-ambiguous":
      return null;
    default:
      return undefined;
  }
}

/**
 * The three dimensions an author may claim, off the wire. `null` means "one of
 * them was present and unusable" — a refusal, not a silent drop, because a
 * dimension that quietly vanishes is worse than one that was never offered:
 * both leave a 0 in the row and only one of them tells anybody.
 *
 * `novelty` is deliberately not readable here. It is prediction error, computed
 * at encoding against the store's own context; an author claiming it is exactly
 * the door PR-3 closed in `remember/proposals.ts`.
 */
export function readDimensions(rec: Record<string, unknown>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    const v = rec[dim];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return null;
    out[dim] = v;
  }
  return out;
}

/** The unvalidated read, used only where the refusal must be per-entry: the
 *  values ride to `remember/intake`, which refuses that entry by name. */
export function pickDimensions(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    if (rec[dim] !== undefined) out[dim] = rec[dim];
  }
  return out;
}

// ── a reminder date on a tool call (2026-09-26) ─────────────────────────────

/** What `readReminder` hands back: the draft fields, and what to say about them. */
export type ReminderRead =
  | {
      /** `eventDate: null` is the explicit drop (a revision's cancel); `remind`
       *  rides only when it was SENT, so a revision can tell a left-out mode
       *  from a stated one (review N7). */
      readonly fields: { eventDate?: string | null; remind?: "plain" | "quiet"; recurring?: Recurrence | null };
      /** `remind` was sent with no `eventDate`: there is nothing for it to shape
       *  — unless the memory it revises carries a date (`DepositResult.reminder`). */
      readonly remindIgnored: boolean;
      /** `recurring` was sent with no `eventDate` (2026-10-09): nothing to repeat
       *  — unless the memory it revises carries a date. */
      readonly recurringIgnored?: boolean;
    }
  | {
      readonly refused: "event-date-unreadable" | "remind-unknown" | "recurring-unknown" | "recurring-needs-day";
      readonly detail: string;
    };

/** A `ReminderRead` that was not refused. */
export type ReminderFields = Exclude<ReminderRead, { readonly refused: unknown }>;

const EVENT_DATE_SHAPES =
  'A day "2026-10-15", a month "2026-10", a year "2026", or a range of two days "2026-10-20..2026-10-31" (first day first). Convert "late October" or "before the 15th" into one of those yourself.';

const YEAR_ALONE_NOTE =
  "A year alone names no day, so this will not come back on its own. Give a month, a day or a range if it should.";

/** Review N8 (2026-09-26): a past date is accepted and kept, and SAID — so a
 *  wrong year can be caught by the model that wrote it. */
const DATE_PASSED_NOTE = "That date has already passed — it won't come back as a reminder.";

/**
 * `eventDate` and `remind` off a `remember` or a `session_end` entry, CHECKED
 * before anything mints: the date by `time.ts` (the one module that reads
 * dates), `remind` against its two words. Never a date parsed from prose — the
 * model writes the field (owner decision 2026-09-25/26).
 */
export function readReminder(rec: Record<string, unknown>): ReminderRead {
  const rawDate = rec["eventDate"];
  const rawRemind = rec["remind"];
  const rawRule = rec["recurring"];
  if (rawRemind !== undefined && rawRemind !== null && rawRemind !== "plain" && rawRemind !== "quiet") {
    return { refused: "remind-unknown", detail: '`remind` is "plain" or "quiet".' };
  }
  // HOW OFTEN (2026-10-09): one of four words, refused by name like a date.
  if (rawRule !== undefined && rawRule !== null && !isRecurrence(rawRule)) {
    return { refused: "recurring-unknown", detail: RECURRING_WORDS };
  }
  const sent: { remind?: "plain" | "quiet"; recurring?: Recurrence | null } = {
    ...(rawRemind === "plain" || rawRemind === "quiet" ? { remind: rawRemind } : {}),
    // `null` rides as sent: a revision's "it no longer repeats".
    ...(isRecurrence(rawRule) ? { recurring: rawRule } : rawRule === null ? { recurring: null } : {}),
  };
  if (rawDate === undefined || rawDate === null) {
    return {
      fields: { ...(rawDate === null ? { eventDate: null } : {}), ...sent },
      remindIgnored: sent.remind !== undefined,
      recurringIgnored: isRecurrence(sent.recurring),
    };
  }
  const read = typeof rawDate === "string" ? parseCalendarDate(rawDate) : null;
  if (read === null) {
    return {
      refused: "event-date-unreadable",
      detail: `\`eventDate\` ${typeof rawDate === "string" ? `"${rawDate.slice(0, 64)}"` : "(not text)"} is not a date this can read. ${EVENT_DATE_SHAPES}`,
    };
  }
  if (isRecurrence(sent.recurring) && read.precision !== "day") {
    return { refused: "recurring-needs-day", detail: RECURRING_NEEDS_DAY };
  }
  return { fields: { eventDate: read.text, ...sent }, remindIgnored: false };
}

const RECURRING_WORDS =
  '`recurring` is "daily", "weekly", "monthly" or "yearly", anchored on eventDate. Every other week, "the first Monday" and the like are not kept: leave it out.';

const RECURRING_NEEDS_DAY =
  '`recurring` repeats one day, so eventDate must be a day: the first one ("1990-05-14" for a birthday, any Monday for "every Monday").';

const RECURRING_IGNORED_NOTE = "`recurring` repeats a date; with no `eventDate` there was nothing to repeat.";

const RECURRING_DROPPED_NOTE = "Not repeating any more: only a day repeats, and this date is not one, so it comes once.";

/** What to say about a recorded date: that it has already passed (its last day
 *  is before the person's today — `time.ts#todayIn` in the store's zone), or
 *  that a year alone never comes back. One note, the passed one first. */
function dateNote(eventDate: string, today: string, recurring: Recurrence | null = null): Record<string, unknown> {
  // A REPEATING date never "has passed" (2026-10-09): a birthday anchored in
  // 1990 comes round every year. Said instead: how often, and when next.
  if (recurring !== null) {
    const every = readableRecurrence(eventDate, recurring);
    const next = occurrenceOnOrAfter(eventDate, recurring, today);
    return { ...(every === "" ? {} : { every }), ...(next === null ? {} : { next: next.date }) };
  }
  const read = parseCalendarDate(eventDate);
  if (read === null) return {};
  if (read.last < today) return { note: DATE_PASSED_NOTE };
  return read.precision === "year" ? { note: YEAR_ALONE_NOTE } : {};
}

/** The reminder half of a deposit's answer: what was RECORDED — after a
 *  revision's carry-over, not merely what was sent — or why `remind` had
 *  nothing to shape. Nothing when neither field was sent or nothing minted. */
/** Beside a done at a repeating reminder that sent no title (2026-10-20). */
const OCCURRENCE_TITLE_NOTE =
  "No title was given, and the reminder's was not carried over: this memory says one time was done, and the reminder's title would read as the reminder itself. Give it a short one of its own (\"Backup ran, Oct 20\").";

/** What a revision did with its title (2026-10-14, `counterpart-deposit.ts#carryTitle`). */
export function titleEcho(deposit: DepositResult, askedNote: string): Record<string, unknown> {
  if (!deposit.deposited) return {};
  // A done at a repeat closes one time, not the reminder (2026-10-20).
  if (deposit.titleAsked === true) return { titleAsked: deposit.occurrence === undefined ? askedNote : OCCURRENCE_TITLE_NOTE };
  return deposit.titleCarried === undefined ? {} : { titleCarried: { title: deposit.titleCarried.title, from: deposit.titleCarried.from } };
}

/**
 * DONE FOR THIS TIME, said plainly (2026-10-20, an experiment): which
 * occurrence a `done` at a repeating reminder closed, that the reminder kept
 * its date and repeat, when it comes back, and how to end the repeat instead.
 */
function occurrenceEcho(o: NonNullable<DepositResult["occurrence"]>): Record<string, unknown> {
  const back = o.next === null ? "" : ` It comes back ${readableDate(o.next)}.`;
  const how = " To end the repeat instead: updates its id with eventDate: null.";
  const note =
    o.closed === null
      ? `No occurrence of it is open today, so nothing was closed; the reminder is unchanged.${back}`
      : o.already === true
        ? `This occurrence (${readableDate(o.closed)}) was already closed; the reminder keeps its date and its repeat.${back}`
        : `Closed this occurrence only (${readableDate(o.closed)}): it will not come up again this time. The reminder keeps its date and its repeat, and nothing about it faded.${back}${how}`;
  return {
    occurrenceClosed: o.closed !== null && o.already !== true,
    ...(o.closed === null ? {} : { occurrence: o.closed }),
    recurring: o.recurring,
    from: o.reminder,
    ...(o.next === null ? {} : { next: o.next }),
    note,
  };
}

export function reminderEcho(deposit: DepositResult, dated: ReminderRead, today: string): Record<string, unknown> {
  if ("refused" in dated || !deposit.deposited) return {};
  // Its date was not kept (TC1): `ownPlumbingEcho` says why, beside it.
  if (deposit.ownPlumbing?.dropped.includes("eventDate") === true) return {};
  const occurrence = deposit.occurrence;
  if (occurrence !== undefined) return { reminder: occurrenceEcho(occurrence) };
  const carried = deposit.reminder;
  if (carried !== undefined) {
    const unmoved = carried.moved ? {} : { unmoved: true };
    if (carried.eventDate === null) {
      return {
        reminder: {
          cleared: true,
          from: carried.from,
          ...unmoved,
          // The rest of its chain, closed with it (2026-10-14).
          ...(carried.alsoClosed === undefined ? {} : { alsoClosed: [...carried.alsoClosed] }),
          note:
            carried.alsoClosed === undefined
              ? "The date is dropped: neither this memory nor the one it revises will come back as a reminder."
              : "The date is dropped: neither this memory nor the one it revises will come back as a reminder, nor the earlier memories of the same reminder in `alsoClosed`.",
        },
      };
    }
    // A repeat — sent or carried — that the new date cannot take (a month or a
    // range does not repeat) is SAID, never silently lost.
    const ruleDropped = carried.recurringDropped === true;
    return {
      reminder: {
        eventDate: carried.eventDate,
        remind: carried.remind ?? "quiet",
        ...(carried.recurring === null ? {} : { recurring: carried.recurring }),
        from: carried.from,
        ...(carried.inherited.length > 0 ? { carriedOver: [...carried.inherited] } : {}),
        ...unmoved,
        ...dateNote(carried.eventDate, today, carried.recurring),
        ...(ruleDropped ? { note: RECURRING_DROPPED_NOTE } : {}),
      },
    };
  }
  const { eventDate, remind, recurring } = dated.fields;
  if (typeof eventDate === "string") {
    const rule = isRecurrence(recurring) ? recurring : null;
    return {
      reminder: {
        eventDate,
        remind: remind ?? "quiet",
        ...(rule === null ? {} : { recurring: rule }),
        ...dateNote(eventDate, today, rule),
      },
    };
  }
  // A cancel that found nothing to cancel is SAID (review of #247): silence
  // here read as success while a reminder the model meant to drop kept coming.
  if (eventDate === null && (deposit.proposal?.updates?.declared ?? null) !== null) {
    return {
      reminder: {
        cleared: false,
        note: "No date was dropped: `updates` did not reach a dated memory by its id, so nothing was cancelled.",
      },
    };
  }
  const remindNote = "`remind` shapes how a date comes back; with no `eventDate` there was nothing to shape.";
  if (dated.remindIgnored && dated.recurringIgnored === true) {
    return { reminder: { ignored: "remind, recurring", note: `${remindNote} ${RECURRING_IGNORED_NOTE}` } };
  }
  if (dated.recurringIgnored === true) return { reminder: { ignored: "recurring", note: RECURRING_IGNORED_NOTE } };
  return dated.remindIgnored ? { reminder: { ignored: "remind", note: remindNote } } : {};
}

// ── an undated reminder, said at write time (2026-10-12) ────────────────────

const REMINDER_WORD = /\bremind\b|^\s*reminder\s*:|\bdon'?t forget\b|\bfollow[- ]up\b|\bcheck back\b/im;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_SHAPE = new RegExp(
  `\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b(?:${MONTHS})\\.? \\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\\b` +
    "|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\bin \\d+ (?:days?|weeks?|months?)\\b" +
    "|\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\\b" +
    "|\\b(?:january|february|march|april|june|july|august|september|october|november|december)\\b",
  "i",
);

/** Whether a title or text reads like a reminder: a reminder word AND a date
 *  shape. A heuristic for a WARNING only — the engine never reads a date out
 *  of the text (the 09-25 rule). */
export function readsLikeReminder(...parts: readonly (string | null | undefined)[]): boolean {
  const text = parts.filter((p): p is string => typeof p === "string").join("\n");
  return REMINDER_WORD.test(text) && DATE_SHAPE.test(text);
}

/** What to tell a writer whose stored entry reads like a reminder but carries
 *  no `eventDate` (a dated reminder only ever fires from that field). Nothing
 *  when a date was sent or cleared, or a revision carried one over. Never
 *  sets or guesses the date, never refuses. */
export function undatedReminderWarning(deposit: DepositResult, dated: ReminderRead, title: unknown, text: unknown): Record<string, unknown> {
  if ("refused" in dated || !deposit.deposited || deposit.memoryId === null) return {};
  if ("eventDate" in dated.fields || deposit.reminder !== undefined) return {};
  // A done memory is no reminder (SO1 step 2): its passed date may just have become occurredOn.
  if (deposit.facts?.status === "done") return {};
  if (!readsLikeReminder(typeof title === "string" ? title : null, typeof text === "string" ? text : null)) return {};
  return {
    reminderHint: `this reads like a reminder but has no eventDate, so it will never come back on a date; to make it fire, revise it with updates: ${deposit.memoryId} and an eventDate`,
  };
}

// ── feelings on a tool call (schema v7) ─────────────────────────────────────

export type FeelingsRead = { inputs: FeelingInput[] } | { refused: string };

export type AboutRead = { mark: AboutMark | null } | { refused: string };

export type TraitsRead = { inputs: TraitInput[] } | { refused: string };

/**
 * `traits: [{ axis, toward, strength, carried_by? }]` off a `remember` or a
 * `session_end` entry (folded into v9), read and CHECKED before anything
 * mints (`store/traits.ts#checkTraits`, pure). Absent is none; an unknown
 * axis or pole is a refusal that names the item, the reason and what is
 * allowed. Any throw is this entry's refusal, never the call's.
 */
export function readTraits(raw: unknown): TraitsRead {
  try {
    if (raw === undefined || raw === null) return { inputs: [] };
    if (!Array.isArray(raw)) return { refused: "`traits` is a list of objects." };
    const inputs: TraitInput[] = [];
    for (const [i, item] of raw.entries()) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return { refused: `traits[${i}] is not an object.` };
      }
      const t = item as Record<string, unknown>;
      for (const key of ["axis", "toward"] as const) {
        if (typeof t[key] !== "string") return { refused: `traits[${i}].${key} is a word.` };
      }
      const carried = t["carried_by"];
      if (carried !== undefined && typeof carried !== "string") return { refused: `traits[${i}].carried_by is text.` };
      inputs.push({
        axis: t["axis"] as string,
        toward: t["toward"] as string,
        strength: t["strength"] as number,
        ...(carried === undefined ? {} : { carriedBy: carried }),
      });
    }
    try {
      checkTraits(inputs);
    } catch (err) {
      if (isStoreError(err, "TRAIT_INVALID")) {
        const d = (err as { detail?: Record<string, unknown> }).detail ?? {};
        const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
        const pole = typeof d["axisOfPole"] === "string" ? `; that word belongs to ${d["axisOfPole"]}` : "";
        return { refused: `traits[${String(d["index"])}]: ${String(d["reason"])}${allowed}${pole}.` };
      }
      throw err;
    }
    return { inputs };
  } catch (err) {
    return { refused: `traits could not be read: ${String((err as Error).message ?? err)}` };
  }
}

/** `about` on a tool call (schema v9): absent, or one of the five marks. */
/**
 * The open thread a deposit closed (`DepositResult.thread`, 2026-10-01), as a
 * result carries it: `thread: { closed: <the id it updates> }`, or the reason
 * the clear did not land. Nothing when no thread was closed.
 */
/**
 * A MEMORY ABOUT THIS SYSTEM'S OWN PLUMBING (2026-11-04, TC1), as the result
 * says it: kept, with what it did not keep (`dropped`, and a refused me/us
 * mark) and the note, so the writer learns what to write instead. Nothing
 * when the gate did not read it so.
 */
export function ownPlumbingEcho(deposit: DepositResult): Record<string, unknown> {
  const p = deposit.ownPlumbing;
  if (p === undefined || !deposit.deposited) return {};
  return {
    ownPlumbing: {
      kept: true,
      ...(p.dropped.length === 0 ? {} : { dropped: [...p.dropped] }),
      ...(p.aboutRefused === null ? {} : { aboutNotKept: p.aboutRefused }),
      note: ownPlumbingNote({ dropped: p.dropped, aboutRefused: p.aboutRefused, id: deposit.memoryId ?? "" }),
    },
  };
}

export function threadOf(deposit: DepositResult): Record<string, unknown> {
  const t = deposit.thread;
  if (t === undefined) return {};
  return { thread: t.closed ? { closed: t.from } : { closed: null, from: t.from, reason: t.refused ?? "not-recorded" } };
}

/**
 * v12 (2026-10-03): THE WRITER'S THREE FIELDS off a `remember` or a
 * `session_end` entry — `occurredOn` (when it happened: read by `time.ts`,
 * the one module that reads dates), `saidBy` and `status` (against their
 * words). LOOSE FIRST: nothing here refuses the memory. What cannot be read
 * is dropped and said (`dropped`, with what to send instead); null is sent
 * as none (a revision carries nothing over for it); absent is not sent.
 * A date in the future is kept, and a note says that a date to be reminded
 * on is `eventDate`.
 */
export interface FactsRead {
  readonly sent: SentFacts;
  readonly dropped: readonly { readonly field: string; readonly note: string }[];
  readonly notes: readonly string[];
}

const OCCURRED_ON_SHAPES =
  'Send it as a day "2026-09-24", a month "2026-09", a year "2026" or a range "2026-09-21..2026-09-27" — resolve "last week" or "yesterday" to one of those while you know the date.';

const OCCURRED_ON_FUTURE_NOTE =
  "occurredOn is in the future. It is kept, but it means when this happened; a date to be reminded on is eventDate.";

export function readWriteFacts(rec: Record<string, unknown>, today: string): FactsRead {
  const sent: { occurredOn?: string | null; saidBy?: SaidBy | null; status?: MemoryStatus | null } = {};
  const dropped: { field: string; note: string }[] = [];
  const notes: string[] = [];
  const said = (v: unknown): string => (typeof v === "string" ? `"${v.slice(0, 64)}"` : "(not text)");
  const date = rec["occurredOn"];
  if (date === null) sent.occurredOn = null;
  else if (date !== undefined) {
    const read = parseCalendarDate(date);
    if (read === null) {
      dropped.push({ field: "occurredOn", note: `occurredOn ${said(date)} is not a date this can read, so the memory was kept without it. ${OCCURRED_ON_SHAPES}` });
    } else {
      sent.occurredOn = read.text;
      if (read.first > today) notes.push(OCCURRED_ON_FUTURE_NOTE);
    }
  }
  const by = rec["saidBy"];
  if (by === null) sent.saidBy = null;
  else if (by !== undefined) {
    const v = saidByOf(by);
    if (v === null) dropped.push({ field: "saidBy", note: `saidBy ${said(by)} is not one of ${SAID_BY.join(", ")}, so the memory was kept without it.` });
    else sent.saidBy = v;
  }
  const st = rec["status"];
  if (st === null) sent.status = null;
  else if (st !== undefined) {
    const v = statusOf(st);
    if (v === null) dropped.push({ field: "status", note: `status ${said(st)} is not one of ${STATUSES.join(", ")}, so the memory was kept without it.` });
    else sent.status = v;
  }
  return { sent, dropped, notes };
}

/**
 * A DONE MEMORY IS NEVER OVERDUE (SO1 step 2, 2026-11-07, lightly held): a
 * `remember` or `session_end` entry with `status: "done"` and an `eventDate`
 * today or already passed (its last day on or before `today`: a done dated
 * today has happened, coordinator 11-07) says when the thing HAPPENED,
 * so the date is kept as `occurredOn`, not as a reminder. When `occurredOn`
 * was sent too and differs, it is kept and the eventDate is dropped. Either
 * way it is dropped and said beside the memory, in the three fields' `dropped`.
 *
 * Left alone: a date ending after today (a done with a future date is ambiguous),
 * a repeat (`recurring` sent: a done closes one occurrence), and a revision
 * (`updates` sent: its target may repeat, and the deposit's own close decides
 * it; the read side keeps a done one-off with a past date out of Coming up
 * anyway, `prospective/derive.ts` "done"). Pure; returns new reads.
 */
export function doneDateAsOccurred(
  rec: Record<string, unknown>,
  dated: ReminderFields,
  facts: FactsRead,
  today: string,
): { dated: ReminderFields; facts: FactsRead } {
  if (facts.sent.status !== "done" || typeof rec["updates"] === "string") return { dated, facts };
  // `remind` shapes a reminder, and this is none: it goes with the date.
  const { eventDate, remind: _remind, ...rest } = dated.fields;
  if (typeof eventDate !== "string" || isRecurrence(rest.recurring)) return { dated, facts };
  const read = parseCalendarDate(eventDate);
  if (read === null || read.last > today) return { dated, facts };
  const given = facts.sent.occurredOn;
  const keepGiven = typeof given === "string" && given !== read.text;
  const when = read.last !== today ? "has already passed" : read.first === today ? "is today" : "ends today";
  const note = keepGiven
    ? `eventDate "${read.text}" ${when} and this memory is done, so it is not a reminder; occurredOn "${given}" was sent too, so that was kept and the eventDate dropped.`
    : `eventDate "${read.text}" ${when} and this memory is done, so the date was kept as occurredOn (when it happened), not as a reminder: it won't come up as due or overdue.`;
  return {
    dated: { fields: rest, remindIgnored: false },
    facts: {
      sent: keepGiven ? facts.sent : { ...facts.sent, occurredOn: read.text },
      dropped: [...facts.dropped, { field: "eventDate", note }],
      notes: facts.notes,
    },
  };
}

/** The three fields' half of a deposit's answer (v12): what was RECORDED —
 *  after a revision's carry-over — what was carried and from where, and what
 *  was dropped and why. Nothing when nothing was sent, dropped or carried. */
export function factsEcho(deposit: DepositResult, read: FactsRead): Record<string, unknown> {
  const sentAny = Object.keys(read.sent).length > 0;
  if (!sentAny && read.dropped.length === 0 && deposit.facts === undefined) return {};
  const dropped = read.dropped.length === 0 ? {} : { dropped: read.dropped.map((d) => ({ field: d.field, note: d.note })) };
  if (!deposit.deposited) return { facts: { stored: false, reason: "memory-not-stored", ...dropped } };
  const f = deposit.facts;
  return {
    facts: {
      stored: true,
      ...((f?.occurredOn ?? null) === null || f === undefined ? {} : { occurredOn: f.occurredOn }),
      ...((f?.saidBy ?? null) === null || f === undefined ? {} : { saidBy: f.saidBy }),
      ...((f?.status ?? null) === null || f === undefined ? {} : { status: f.status }),
      ...(f === undefined || f.inherited.length === 0 ? {} : { carriedOver: [...f.inherited], from: f.from }),
      ...dropped,
      ...(read.notes.length === 0 ? {} : { note: read.notes.join(" ") }),
    },
  };
}

/**
 * v14, lane B (2026-10-21): A MEMORY'S TAGS off a `remember` or a
 * `session_end` entry — a few words for what it is about. LOOSE FIRST, as the
 * three fields: nothing here refuses the memory. The screen is the core's
 * (`core/tag-screen.ts#screenTags`, the one every door shares): one that is
 * not text, carries a secret, is too long or comes past the limit is dropped
 * and said. A comma-separated string is read as its parts. `null` or an empty
 * list is sent as none: a revision carries nothing over. Absent is not sent —
 * and so is a list whose tags were all blank or all dropped, so a revision
 * still carries its memory's (review of #570).
 */
export interface TagsRead {
  /** Absent: not sent. Null: sent as none. */
  readonly sent?: readonly string[] | null;
  readonly dropped: readonly string[];
}

export { TAG_MAX_CHARS, TAGS_PER_MEMORY } from "../../core/tag-screen.js";

export function readTags(rec: Record<string, unknown>): TagsRead {
  const raw = rec["tags"];
  if (raw === undefined) return { dropped: [] };
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return { sent: null, dropped: [] };
  const items: unknown[] = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [raw];
  const { kept, dropped } = screenTags(items);
  return kept.length === 0 ? { dropped: [...dropped] } : { sent: [...kept], dropped: [...dropped] };
}

/** The tags' half of a deposit's answer (v14, lane B): what was recorded — after a revision's carry-over — and what was dropped. Nothing when nothing was sent, dropped or carried. */
export function tagsEcho(deposit: DepositResult, read: TagsRead): Record<string, unknown> {
  if (read.sent === undefined && read.dropped.length === 0 && deposit.tags === undefined) return {};
  const all = [...read.dropped, ...(deposit.tags?.dropped ?? [])];
  const dropped = all.length === 0 ? {} : { dropped: all };
  if (!deposit.deposited) {
    // A duplicate's words were already there: its tags were not added to the memory it repeats (review of #570).
    const dup = deposit.reason === "duplicate-content" ? { note: "This memory was already stored; these tags were not added to it." } : {};
    return { tags: { stored: false, reason: "memory-not-stored", ...dup, ...dropped } };
  }
  const t = deposit.tags;
  return {
    tags: {
      stored: true,
      tags: t === undefined ? [] : [...t.tags],
      ...(t === undefined || t.from === null ? {} : { carriedFrom: t.from }),
      ...dropped,
    },
  };
}

export function readAbout(raw: unknown): AboutRead {
  if (raw === undefined || raw === null) return { mark: null };
  if (typeof raw !== "string" || !(ABOUT_MARKS as readonly string[]).includes(raw)) {
    return { refused: `\`about\` is one of ${ABOUT_MARKS.join(", ")}.` };
  }
  return { mark: raw as AboutMark };
}

/**
 * `feelings: [{ whose, core?, emotion, strength?, valence?, carried_by, beneath?, other_word? }]`
 * off a `remember` or a `session_end` entry, read and CHECKED before anything
 * mints (`store/feelings.ts#checkFeelings`, pure). `beneath` is another
 * feeling's index in the same list. Absent is no feelings; anything that will
 * not store is a refusal naming the item and the reason.
 */
export function readFeelings(raw: unknown): FeelingsRead {
  // ANY throw is this entry's refusal, never the call's (review S2): a
  // `session_end` carries siblings that must still land.
  try {
    return readFeelingsOrThrow(raw);
  } catch (err) {
    return { refused: `feelings could not be read: ${String((err as Error).message ?? err)}` };
  }
}

function readFeelingsOrThrow(raw: unknown): FeelingsRead {
  if (raw === undefined || raw === null) return { inputs: [] };
  if (!Array.isArray(raw)) return { refused: "`feelings` is a list of objects." };
  const inputs: FeelingInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { refused: `feelings[${i}] is not an object.` };
    }
    const f = item as Record<string, unknown>;
    for (const key of ["whose", "emotion"] as const) {
      if (typeof f[key] !== "string") return { refused: `feelings[${i}].${key} is a word.` };
    }
    // v11: `core` may be left out (the word's own core), and `strength` and
    // `valence` too (the word's defaults).
    const core = f["core"];
    if (core !== undefined && core !== null && typeof core !== "string") return { refused: `feelings[${i}].core is a word.` };
    const carried = f["carried_by"];
    const other = f["other_word"];
    const valence = f["valence"];
    const strength = f["strength"];
    if (carried !== undefined && typeof carried !== "string") return { refused: `feelings[${i}].carried_by is text.` };
    if (other !== undefined && typeof other !== "string") return { refused: `feelings[${i}].other_word is a word.` };
    // AT THE DOOR, `beneath` is an INDEX into this list and nothing else (review
    // S3): an id would only be checked after the memory minted, so feelings
    // would stop being all-or-nothing with their entry.
    const beneath = f["beneath"];
    if (beneath !== undefined && beneath !== null && !(typeof beneath === "number" && Number.isInteger(beneath))) {
      return { refused: `feelings[${i}].beneath is the index of another feeling in this list.` };
    }
    inputs.push({
      whose: f["whose"] as string,
      ...(typeof core === "string" ? { core } : {}),
      emotion: f["emotion"] as string,
      ...(strength === undefined || strength === null ? {} : { strength: strength as number }),
      ...(valence === undefined || valence === null ? {} : { valence: valence as number }),
      ...(carried === undefined ? {} : { carriedBy: carried }),
      ...(other === undefined ? {} : { otherWord: other }),
      ...(beneath === undefined || beneath === null ? {} : { beneath: beneath as number }),
    });
  }
  try {
    checkFeelings(inputs);
  } catch (err) {
    if (isStoreError(err, "FEELING_INVALID")) {
      const d = (err as { detail?: Record<string, unknown> }).detail ?? {};
      const allowed = typeof d["allowed"] === "string" ? ` (one of ${d["allowed"]})` : "";
      return { refused: `feelings[${String(d["index"])}]: ${String(d["reason"])}${allowed}.` };
    }
    throw err;
  }
  return { inputs };
}

// ── the write tools fail open (2026-11-13) ──────────────────────────────────

/**
 * THE WRITE TOOLS FAIL OPEN (2026-11-13, owner-approved that day). `remember`
 * and `session_end` are the only road from conversation to memory, and until
 * this an optional field the readers could not take — an unreadable
 * `eventDate`, a feeling word off the wheel with no core, a malformed trait,
 * a salience of "0.7" or 1.2, a kind of "lesson" — refused the whole memory
 * (or the whole `session_end` entry), and its words were lost: intake's
 * "degrades to a span" is read only by the crash fallback.
 *
 * THE RULE. `normalizeMemoryFields` (below) cleans one `remember` call, or one `session_end` entry,
 * BEFORE the existing readers (the ones above, `remember/intake`) see it,
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
  // "them" is the owner here: the field's own words are "owner (them as a person)".
  // "they", "him", "her", "person" may be someone else: dropped (review of #818).
  user: "owner", them: "owner", personal: "owner", "the owner": "owner", "the user": "owner",
  "both of us": "us", "the two of us": "us", together: "us", relationship: "us", we: "us", "you and me": "us",
  project: "work", code: "work", codebase: "work", repo: "work", job: "work", task: "work", here: "work", folder: "work",
  other: "world", general: "world", news: "world", everything: "world", external: "world", fact: "world", facts: "world",
};

const SAID_BY_SYNONYMS: Readonly<Record<string, string>> = {
  me: "self", i: "self", assistant: "self", claude: "self", myself: "self", ai: "self", model: "self",
  // "they", "them", "person" may be someone else: dropped (review of #818).
  user: "owner", "the user": "owner", "the owner": "owner",
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
  // Only the words that mean the owner in this tool's vocabulary (review of
  // #818): "her", "him", "they" or a name may be a third person, so that
  // feeling is dropped as whose-unknown, its memory's text carrying it.
  owner: "owner", user: "owner", "the user": "owner", "the owner": "owner",
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

/**
 * A number field held to its range (0-1, or -1-1 for valence). A number sent
 * as text is read. Out of range is NOT clamped (review of #818: a salience of
 * 7 clamped to 1 fed ranking at its maximum): a writer on a 0-10 or 0-100
 * scale is read on it — 1 < n <= 10 as n/10, 10 < n <= 100 as n/100 (by size,
 * the sign kept, for valence) — and echoed in `readAs`; anything else out of
 * range, or a negative on a 0-1 field, is dropped and said. Null/absent pass.
 */
function readRanged(rec: Record<string, unknown>, key: string, lo: number, hi: number, notes: WriteNotes, field: string = key): void {
  const v = rec[key];
  if (v === undefined || v === null) return;
  const n = numberOf(v);
  const range = `${String(lo)} to ${String(hi)}`;
  if (n === null) {
    delete rec[key];
    notes.drop(field, "not-a-number", v, `${field} is a number from ${range}; the memory was kept without it.`);
    return;
  }
  let kept: number | null = n;
  if (n < lo || n > hi) {
    const size = Math.abs(n);
    const scaled = size > 1 && size <= 10 ? n / 10 : size > 10 && size <= 100 ? n / 100 : null;
    kept = scaled !== null && scaled >= lo && scaled <= hi ? scaled : null;
  }
  if (kept === null) {
    delete rec[key];
    notes.drop(field, "out-of-range", v, `${field} is a number from ${range} (a score out of 10 or 100 is read as such); the memory was kept without it.`);
    return;
  }
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
 * when it is one word of plain lower-case letters, at most 20 (what the
 * thesaurus could grow by), else only that it was a phrase — anything more
 * can be a person's words.
 */
export function missedWord(word: string): string {
  const form = feelingWordForm(word);
  // ONE word of plain lower-case letters (review of #818): "owner: sarah's
  // biopsy" must not put a person's words on a durable row.
  return /^[a-z]{1,20}$/u.test(form) ? form : "(phrase)";
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

// ── placing a feeling word on a core ────────────────────────────────────────

/**
 * PLACING A FEELING WORD ON A CORE (2026-11-13, the write tools' fail-open
 * lane). Pure: a word in, a core and how it was found out — or null.
 *
 * A feeling written with no core takes its word's home core when the word is
 * on the wheel (`store/feelings.ts#checkFeelings`). Off the wheel, with no core,
 * it used to refuse the whole memory. This is the backend placement the owner
 * ruled for that case (2026-11-13), in order, the first that answers wins:
 *
 *   1. the wheel itself and its aliases (`lookupWord`), then the thesaurus
 *      (`feelings-wheel.ts#FEELINGS_THESAURUS`) — whole value only;
 *   2. an inflection ("worrying" → worried: an "-ing" form of a participle or
 *      a core, `BY_STEM`), then a misspelling by a TYPO's shape only, the
 *      first letter kept (`slips`: two letters swapped, one doubled or
 *      undoubled; from 9 letters one dropped or added; from 10, two slips) —
 *      single words of 6 letters or more. Never a free substitution: a real
 *      word one letter from a feeling word ("better", "homeless", "graceful")
 *      is not a misspelling of it;
 *   3. the embedder, only when it is confident — that step needs a live
 *      embedder, so it is `meaningPlacer`, below.
 *
 * Never a guessed core. Steps 2 and 3 answer only when every best candidate
 * agrees on the core; a word that carries a negation ("not happy", "no
 * longer afraid") is never placed by anything but step 1 (it is not on the
 * wheel or in the thesaurus, so: never); and a misspelling match is refused
 * when the two words differ by a negating prefix ("uncaring" is not "caring").
 * The caller keeps the writer's own word (`other` + `other_word`): this
 * decides only the core.
 */
export type PlacedBy = "wheel" | "thesaurus" | "stem" | "spelling";

export interface Placement {
  readonly core: CoreEmotion;
  readonly by: PlacedBy;
  /** The wheel, alias or thesaurus word it matched. */
  readonly match: string;
}

/** Words that soften or strengthen a feeling and say nothing about which one ("very", "a bit"). */
const INTENSIFIER = /^(?:(?:very|really|so|quite|rather|pretty|super|extremely|incredibly|deeply|truly|genuinely|totally|completely|utterly|a (?:bit|little|tad)|a little bit|slightly|somewhat|mildly|kind of|kinda|sort of|sorta|more|most|a lot|feeling|felt|feel|i feel|i felt|i'm|i am|i was|am|was|being|got|getting|became|become)\s+)+/u;

/** A negation anywhere in the value: never placed past the wheel and the thesaurus. */
const NEGATION = /(?:^|\s)(?:not|no|never|none|neither|nor|without|hardly|barely|no longer|isn't|wasn't|aren't|weren't|don't|didn't|doesn't|can't|couldn't|won't|wouldn't)(?:\s|$)|n't\b/u;

/** Prefixes that turn a word into its opposite: a misspelling match across one is refused. */
const NEGATING_PREFIXES = ["un", "dis", "in", "im", "ir", "il", "non", "mis", "de"] as const;

/** The value as compared: lower-case, single-spaced, without outer punctuation or leading intensifiers. */
export function feelingWordForm(word: string): string {
  const flat = word
    .trim()
    .toLowerCase()
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, " ")
    .replace(/^[\s"'.,;:!?()[\]-]+|[\s"'.,;:!?()[\]-]+$/gu, "");
  const stripped = flat.replace(INTENSIFIER, "").trim();
  return stripped.length === 0 ? flat : stripped;
}

/** Whether the value carries a negation (so only steps 1 places it). */
export function feelingWordNegated(word: string): boolean {
  return NEGATION.test(word.trim().toLowerCase().replace(/[’`]/gu, "'"));
}

interface Known {
  readonly word: string;
  readonly core: CoreEmotion;
}

/** Every single word steps 2 compare against: the wheel's, its aliases', the thesaurus's. */
const KNOWN: readonly Known[] = (() => {
  const out: Known[] = [];
  for (const e of FEELINGS_WHEEL) out.push({ word: e.key, core: e.core });
  for (const [alias, key] of Object.entries(ALIASES)) {
    const e = FEELINGS_WHEEL.find((x) => x.key === key);
    if (e !== undefined) out.push({ word: alias, core: e.core });
  }
  for (const [word, core] of FEELINGS_THESAURUS) out.push({ word, core });
  return out.filter((k) => /^[a-z]+$/u.test(k.word));
})();

/** Every known single word, to its entry (a word under two cores keeps both, so `agreed` can refuse it). */
const KNOWN_BY_WORD: ReadonlyMap<string, readonly Known[]> = (() => {
  const out = new Map<string, Known[]>();
  for (const k of KNOWN) {
    const list = out.get(k.word) ?? [];
    list.push(k);
    out.set(k.word, list);
  }
  return out;
})();

/**
 * An INFLECTION (2026-11-13, tightened in review): only an "-ing" form of a
 * participle ON THE WHEEL ("worrying" → worried, "relieving" → relieved,
 * "terrifying" → terrified), or of a core ("calming"). A bare word that merely
 * shares a stem is an ordinary word in its own right ("wrong", "long", "sort",
 * "focus", "correct", "please"); an "-ing" word whose stem is short ("moving",
 * "boring") is too often one too; and a thesaurus participle's "-ing" can
 * mean something else ("chilled" is calm, "chilling" is not; "concerning"
 * means "about"). Those go through the thesaurus by name or not at all.
 */
const BY_STEM: ReadonlyMap<string, readonly Known[]> = (() => {
  const out = new Map<string, Known[]>();
  for (const e of FEELINGS_WHEEL) {
    const k: Known = { word: e.key, core: e.core };
    if (!/^[a-z]+$/u.test(k.word) || !(k.word.endsWith("ed") || isCoreEmotion(k.word))) continue;
    const s = stemTerm(k.word);
    const list = out.get(s) ?? [];
    list.push(k);
    out.set(s, list);
  }
  return out;
})();

/** The shortest stem an "-ing" form is read through (core names aside). */
const INFLECTION_MIN_STEM = 5;

/** One core all of these agree on, or null. */
function agreed(list: readonly Known[]): CoreEmotion | null {
  const cores = new Set(list.map((k) => k.core));
  return cores.size === 1 ? (list[0] as Known).core : null;
}

/** `a` is `b` with a negating prefix, or the other way round. */
function prefixedOpposite(a: string, b: string): boolean {
  for (const p of NEGATING_PREFIXES) {
    if (a === p + b || b === p + a) return true;
  }
  return false;
}

/** The shortest word a misspelling is looked for in; shorter words are too often real ones. */
export const SPELLING_MIN_LETTERS = 6;
/** From this length a slip may also drop or add any one letter, not only double or swap. */
export const SPELLING_FREE_LETTER_FROM = 9;
/** From this length two slips are allowed ("dissapointed": one s too many, one p too few). */
export const SPELLING_TWO_SLIPS_FROM = 10;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * The words one TYPO away from `w`, by shape only — never a free
 * substitution, the edit that turns one real word into another ("homeless"
 * / "hopeless", "graceful" / "grateful"): two neighbouring letters swapped,
 * a letter doubled or undoubled, and (long words only, `free`) one letter
 * dropped or added INSIDE the word — never at its end, where a dropped or
 * added letter is another form of the word ("frustrate", "fascinate").
 */
function slips(w: string, free: boolean): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < w.length; i++) {
    if (w[i] !== w[i + 1]) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    else out.add(w.slice(0, i) + w.slice(i + 1));
  }
  for (let i = 0; i < w.length; i++) out.add(w.slice(0, i + 1) + w[i] + w.slice(i + 1));
  if (free) {
    for (let i = 1; i < w.length - 1; i++) out.add(w.slice(0, i) + w.slice(i + 1));
    for (let i = 1; i < w.length; i++) for (const c of LETTERS) out.add(w.slice(0, i) + c + w.slice(i));
  }
  out.delete(w);
  return out;
}

/**
 * Ordinary English words one slip from a feeling word, never read as a
 * misspelling of it: found by running `/usr/share/dict/words` (and the
 * review of #818's list) through the spelling step. Add to it when the
 * dictionary run finds another.
 */
const NOT_SLIPS: ReadonlySet<string> = new Set([
  "sacred", "scarred", "dotting", "pinning", "thrusting", "insulated", "acknowledge", "determine", "appreciate", "recognize",
  "affliction", "forgetting", "indigestion", "invitation", "irrigation", "conclusion", "confession", "concussion", "commission",
  "comparison", "compulsion", "contribute", "homeless", "graceful", "interior", "better", "worse", "wired", "tried", "yucky",
  "closed", "opened", "believed", "discussed", "demoted", "sorted", "focus", "wrong", "long", "sort", "correct", "moving",
  "plea", "please", "interset", "regreet", "fiendship",
]);

/**
 * Steps 1 and 2: the core this word is placed on, how, and the word it
 * matched — or null when neither the wheel, the thesaurus, an inflection nor a
 * misspelling places it with one agreed core.
 */
export function placeFeelingWord(word: string): Placement | null {
  const form = feelingWordForm(word);
  if (form.length === 0) return null;
  const onWheel = lookupWord(form);
  if (onWheel !== undefined) return { core: onWheel.entry.core, by: "wheel", match: onWheel.entry.key };
  const listed = FEELINGS_THESAURUS.get(form);
  if (listed !== undefined) return { core: listed, by: "thesaurus", match: form };
  if (feelingWordNegated(form) || !/^[a-z]+$/u.test(form) || NOT_SLIPS.has(form)) return null;
  if (form.endsWith("ing")) {
    const stem = stemTerm(form);
    const stemmed = (BY_STEM.get(stem) ?? []).filter((k) => isCoreEmotion(k.word) || stem.length >= INFLECTION_MIN_STEM);
    if (stemmed.length > 0) {
      const core = agreed(stemmed);
      return core === null ? null : { core, by: "stem", match: (stemmed[0] as Known).word };
    }
  }
  if (form.length < SPELLING_MIN_LETTERS) return null;
  const first = slips(form, form.length >= SPELLING_FREE_LETTER_FROM);
  const found = (cands: Iterable<string>): Known[] => {
    const out: Known[] = [];
    for (const c of cands) {
      // A slip keeps the first letter ("believed" is not a slip for "relieved").
      if (c[0] !== form[0] || prefixedOpposite(form, c)) continue;
      out.push(...(KNOWN_BY_WORD.get(c) ?? []));
    }
    return out;
  };
  let near = found(first);
  if (near.length === 0 && form.length >= SPELLING_TWO_SLIPS_FROM) {
    const second = new Set<string>();
    for (const c of slips(form, false)) for (const d of slips(c, false)) second.add(d);
    near = found(second);
  }
  if (near.length === 0) return null;
  const core = agreed(near);
  return core === null ? null : { core, by: "spelling", match: (near[0] as Known).word };
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
