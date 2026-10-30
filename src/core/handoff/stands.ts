/**
 * WHERE THIS FOLDER STANDS (WK1, 2026-10-30; ROADMAP's call, for Mike's review).
 *
 * Until now a session start could carry three separate answers to "where were
 * we": "Last here" (the newest chapter written here), "Last said here" (the
 * last exchange, about a day back) and the handoff block (one per writing
 * session, newest first). They were spliced in that order whatever their
 * times, so the 10-30 ~/random wake read a two-day-old handoff as where the
 * work stood beside a newer session's chapter, and the 10-04 and 10-30 reads
 * both said the "here" threads disagree. Older handoffs and same-day chapters
 * were listed by bare id ("+6 older here: sch_…", "+2 more here on Oct 29:
 * epi_…").
 *
 * Now they are one block, grouped BY SESSION and led by the newest:
 *
 *   Where this folder stands: session 0711ddd8 on Opus 5.5, Oct 29 10:11–14:46
 *   — "Title" (epi_…). Its handoff, written 10-29 14:46 (1 day old) (sch_…):
 *     up to five lines of what it says
 *   Before that: session 59f24808, Oct 28 09:00–12:00 — "Title" (epi_…).
 *   Other handoffs here, newest first:
 *   - session 4b57c039, 10-27: its first sentence (sch_…)
 *   (Expand one by its id with recall; retire a finished one with …)
 *
 *   - One session's chapter, last words and newest handoff are ONE entry.
 *   - Entries go newest first, each dated by its newest mention. An older entry
 *     is a different session, so it says something the newer does not: judged
 *     by session and time, never by comparing text.
 *   - THE NEWEST HANDOFF'S LEAD IS UP TO `HANDOFF_LEAD_LINES` LINES, and every
 *     other live handoff gets one line (Mike's markup of the wake, via ROADMAP,
 *     10-30). A body line is indented and flat, so it can never read as a
 *     heading or a line of the wake's own (the scar `pointerBlock` carried).
 *   - Room short, the handoffs without a line are a count and the `handoffs
 *     here` recall handle (`HANDOFFS_HERE_HANDLE`). No wake line lists bare ids.
 *   - Other same-day chapters here ("Before it", "+N more") are not repeated:
 *     "Today so far" and the Yesterday line name them.
 *
 * WHAT GIVES WAY, IN ORDER (`standsLadder`, one rung per step): the about-me
 * line from another folder; the last exchange; the chapter's first sentence;
 * the older chapter a chapterless later session follows; the other handoffs'
 * lines, oldest first; the "since" line; the newest handoff's lead, line by
 * line down to one; and last whichever of the handoff and the chapter is not
 * the lead. So a tight day keeps the NEWEST mention, not the oldest. That
 * reverses review of #300 MAJOR-1 ("the handoff first") only in the case the
 * brief names: a chapter newer than every handoff here now outlives them, with
 * the door still counting them.
 *
 * There is no cap on how many other handoffs get a line: their fortnight's life
 * and the ceiling bound them. Pure.
 *
 * This file and `index.ts` import each other (the reserve is sized from these
 * rungs), for functions only: nothing here reads `index.ts` while loading, and it
 * takes no value from `last-here.ts`, whose constants do.
 */
import {
  HANDOFF_EXCERPT_BYTES,
  HANDOFF_LEAD_LINES,
  HANDOFF_LIFE_DAYS,
  LAST_HERE_TITLE_BYTES,
  daysLeft,
  excerpt,
  expired,
  flatten,
  handoffLead,
  sessionWords,
  sinceLine,
  whenWords,
} from "./index.js";
import type { Handoff, PlansSince, PointerSince } from "./index.js";
import type { LastHere, LaterHere } from "./last-here.js";

/** The recall handle that lists this folder's live handoffs. Exact, trimmed, case-folded, like `last exchange`. */
export const HANDOFFS_HERE_HANDLE = "handoffs here";

/** How the block opens, how an older entry does, and how the other handoffs do. */
export const STANDS_HEAD = "Where this folder stands:";
export const STANDS_BEFORE = "Before that:";
export const STANDS_OTHERS = "Other handoffs here, newest first:";

/** One live handoff, with when it was written (epoch ms, null when unrecorded) and how current it is (the newest's, read at delivery). */
export interface StandsHandoff {
  readonly handoff: Handoff;
  readonly at: number | null;
  readonly since: PointerSince | null;
}

/** The last exchange here, in words. */
export interface StandsSaid {
  readonly session: string;
  readonly at: number;
  /** `14:40`, or `10-29 14:40` the day after. */
  readonly when: string;
  /** The owner's first words, cut, with `…`. */
  readonly quote: string;
  /** The recall handle that reads it whole. */
  readonly handle: string;
}

/** A chapter here, with its session's last time here. */
export interface StandsChapter {
  readonly entry: LastHere;
  readonly at: number;
}

/** A session here newer than every chapter, with none of its own, and the newest chapter before it. */
export interface StandsLater {
  readonly later: LaterHere;
  readonly at: number;
  readonly before: StandsChapter | null;
}

/** What "Last here" knows, as facts (`Counterpart#lastHereFacts`). */
export interface LastHereFacts {
  readonly chapter: StandsChapter | null;
  readonly later: StandsLater | null;
  /** "A chapter about me from …" (`last-here.ts#elsewhereLine`), rendered, or null. */
  readonly aboutMe: string | null;
}

export interface StandsInput extends Partial<LastHereFacts> {
  /** This folder's live handoffs, newest first. */
  readonly handoffs: readonly StandsHandoff[];
  /** What was planned here since the newest handoff (`Handoffs#plansSince`). */
  readonly plans?: PlansSince | null;
  readonly said?: StandsSaid | null;
  readonly day: number;
  readonly reader?: string | null;
  readonly lifeDays?: number;
  /** An episode the wake's body already names: not named again as an older entry. */
  readonly named?: (id: string) => boolean;
}

export interface StandsRung {
  readonly block: string;
  /** The handoffs with a line in it, newest first. */
  readonly shown: readonly Handoff[];
  /** Each shown handoff's own words, in bytes. */
  readonly handoffBytes: readonly number[];
  /** How many live handoffs there are here. */
  readonly live: number;
  /** The ids the "since" line names, or none. */
  readonly plans: readonly string[];
  /** The chapter (or the later session) is in it — "Last here"'s part. */
  readonly chapter: boolean;
  /** That part's own bytes. */
  readonly chapterBytes: number;
  /** The last exchange is in it. */
  readonly said: boolean;
  /** The about-me line from another folder is in it. */
  readonly aboutMe: boolean;
  /** That line's own bytes, its newline included; 0 when it is not in it. */
  readonly aboutMeBytes: number;
}

const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");

/** One mention, before grouping. */
type Mention =
  | { readonly kind: "chapter"; readonly session: string; readonly at: number; readonly entry: LastHere; readonly sentence: boolean }
  | { readonly kind: "later"; readonly session: string; readonly at: number; readonly later: LaterHere }
  | { readonly kind: "handoff"; readonly session: string | null; readonly at: number; readonly h: StandsHandoff; readonly lead: number }
  | { readonly kind: "said"; readonly session: string; readonly at: number; readonly said: StandsSaid };

interface Entry {
  readonly key: string;
  readonly at: number;
  readonly mentions: readonly Mention[];
}

/** `— "Title" (epi_…)`; an untitled chapter by its first words; with neither, nothing (no bare ids). */
function chapterNamed(e: LastHere): string {
  const t = (e.chapter.title ?? "").trim() || e.chapter.excerpt.trim();
  return t.length === 0 ? "" : ` — "${excerpt(t, LAST_HERE_TITLE_BYTES)}" (${e.chapter.id})`;
}

/** An entry's head and the handoff's lead lines under it, and the bytes its parts take. */
function entryWords(e: Entry, reader: string | null): { head: string; lead: readonly string[]; handoffId: string | null; handoffBytes: number; chapterBytes: number } {
  const chapter = e.mentions.find((m) => m.kind === "chapter" || m.kind === "later");
  const handoff = e.mentions.find((m): m is Extract<Mention, { kind: "handoff" }> => m.kind === "handoff");
  const said = e.mentions.find((m): m is Extract<Mention, { kind: "said" }> => m.kind === "said");
  const model = chapter?.kind === "chapter" ? chapter.entry.chapter.model : (handoff?.h.handoff.model ?? null);
  const session = chapter?.session ?? handoff?.session ?? said?.session ?? null;
  const who = sessionWords(session, model, reader);
  const parts: string[] = [];
  let chapterBytes = 0;
  if (chapter?.kind === "chapter") {
    const c = chapter.entry.chapter;
    // Its first sentence only when no handoff of its own says where it stood.
    const titled = (c.title ?? "").trim().length > 0;
    const first = chapter.sentence && handoff === undefined && titled && c.excerpt.length > 0 ? ` ${excerpt(c.excerpt, HANDOFF_EXCERPT_BYTES)}` : "";
    parts.push(`${who}, ${chapter.entry.when}${chapterNamed(chapter.entry)}.${first}`);
  } else if (chapter?.kind === "later") {
    const l = chapter.later;
    const what = l.memory === null ? ", no chapter, not written up yet." : `, no chapter — "${excerpt(l.memory.title, LAST_HERE_TITLE_BYTES)}" (${l.memory.id}).`;
    parts.push(`${who}, ${l.when}${what}`);
  }
  if (parts[0] !== undefined) chapterBytes = byteLength(parts[0]);
  if (said !== undefined) {
    const s = said.said;
    parts.push(`${parts.length === 0 ? `${who}, last` : "Last"} said ${s.when}: "${s.quote}" — recall "${s.handle}".`);
  }
  let lead: readonly string[] = [];
  let handoffBytes = 0;
  if (handoff !== undefined) {
    const h = handoff.h;
    const when = whenWords(h.handoff, h.since);
    const lines = handoffLead(h.handoff.body, handoff.lead);
    const open = `${parts.length === 0 ? `a handoff from ${who},` : "Its handoff,"} ${h.since === null ? `on ${when}` : when} (${h.handoff.id})`;
    // One line of it stays on the head's line; more go under it, indented.
    const words = lines.length === 1 ? `${open}: ${lines[0] ?? ""}` : `${open}:`;
    if (lines.length > 1) lead = lines.map((l) => `  ${l}`);
    handoffBytes = byteLength(words) + 1 + lead.reduce((n, l) => n + byteLength(l) + 1, 0);
    parts.push(words);
  }
  return { head: parts.join(" "), lead, handoffId: handoff?.h.handoff.id ?? null, handoffBytes, chapterBytes };
}

/** One other live handoff's line: who, the day, its first sentence and its id. No staleness sentence: the day says it. */
function otherLine(h: Handoff, reader: string | null): string {
  const on = /^\d{4}-(\d{2}-\d{2})$/.exec(h.writtenOn.trim())?.[1];
  return flatten(`- ${sessionWords(h.session, null, reader)}${on === undefined ? "" : `, ${on}`}: ${excerpt(h.body)} (${h.id})`);
}

/** The block's tail: the handoffs it does not show, by count and handle, and how to expand and retire. */
function doorWords(shown: readonly Handoff[], live: readonly Handoff[], day: number, lifeDays: number): string | null {
  if (live.length === 0) return null;
  const rest = live.length - shown.length;
  const older = shown.length === 0 ? "" : "older ";
  const count = rest > 0 ? `+${String(rest)} ${older}handoff${rest === 1 ? "" : "s"}: recall "${HANDOFFS_HERE_HANDLE}" lists them.` : "";
  if (shown.length === 0) return `(${count})`;
  const only = shown.length === 1 && rest === 0 ? shown[0] : undefined;
  if (only !== undefined) {
    const left = only.writtenDay === null ? lifeDays : daysLeft(only.writtenDay, day, lifeDays);
    return `(Expand it by its id with recall; retire it once done with session_end's retireHandoff: [id]. It stops showing after ${left <= 1 ? "one more day" : `${String(left)} more days`} of use.)`;
  }
  return `(${count === "" ? "" : `${count} `}Expand one by its id with recall; retire a finished one with session_end's retireHandoff: [id]. Each stops showing after ${String(lifeDays)} days of use.)`;
}

interface Choice {
  readonly aboutMe: boolean;
  readonly said: boolean;
  /** The chapter's first sentence. */
  readonly sentence: boolean;
  /** The chapter a later session follows. */
  readonly before: boolean;
  /** How many of the other live handoffs have a line. */
  readonly others: number;
  readonly plans: boolean;
  /** How many lines of the newest handoff's lead. */
  readonly lead: number;
  /** Only the newest entry is kept. */
  readonly leadOnly: boolean;
}

/**
 * THE RUNGS, widest first, each one step narrower than the last (the order is
 * this file's head). Duplicates dropped; the delivery takes the first that
 * fits. Empty with nothing to say. Pure.
 */
export function standsLadder(input: StandsInput): StandsRung[] {
  const lifeDays = input.lifeDays ?? HANDOFF_LIFE_DAYS;
  const reader = input.reader ?? null;
  const live = input.handoffs.filter((s) => !expired(s.handoff, input.day, lifeDays));
  const newest = live[0];
  const others = live.slice(1).map((s) => s.handoff);
  const liveHs = live.map((s) => s.handoff);
  const leadMost = newest === undefined ? 0 : Math.max(1, handoffLead(newest.handoff.body, HANDOFF_LEAD_LINES).length);
  const later = input.later ?? null;
  const lead = later === null ? (input.chapter ?? null) : null;
  const before = later?.before ?? null;
  const beforeOk = before !== null && input.named?.(before.entry.chapter.id) !== true;
  const plans = input.plans ?? null;
  const planIds = (plans?.items ?? []).slice(0, 3).map((p) => p.id);
  const said = input.said ?? null;
  const aboutMe = input.aboutMe ?? null;

  const rung = (c: Choice): StandsRung | null => {
    const mentions: Mention[] = [];
    if (lead !== null) mentions.push({ kind: "chapter", session: lead.entry.chapter.session, at: lead.at, entry: lead.entry, sentence: c.sentence });
    if (later !== null) mentions.push({ kind: "later", session: later.later.session, at: later.at, later: later.later });
    if (c.before && before !== null) mentions.push({ kind: "chapter", session: before.entry.chapter.session, at: before.at, entry: before.entry, sentence: false });
    if (newest !== undefined) mentions.push({ kind: "handoff", session: newest.handoff.session, at: newest.at ?? 0, h: newest, lead: c.lead });
    if (c.said && said !== null) mentions.push({ kind: "said", session: said.session, at: said.at, said });
    return render(mentions, c, liveHs, others, { day: input.day, lifeDays, reader, plans: c.plans ? plans : null, aboutMe: c.aboutMe ? aboutMe : null, planIds });
  };

  // Walk the give-ups in their order: each step keeps every earlier one.
  let c: Choice = {
    aboutMe: aboutMe !== null,
    said: said !== null,
    sentence: lead !== null,
    before: beforeOk,
    others: others.length,
    plans: planIds.length > 0,
    lead: leadMost,
    leadOnly: false,
  };
  const steps: Choice[] = [c];
  const step = (next: Partial<Choice>): void => {
    c = { ...c, ...next };
    steps.push(c);
  };
  if (c.aboutMe) step({ aboutMe: false });
  if (c.said) step({ said: false });
  if (c.sentence) step({ sentence: false });
  if (c.before) step({ before: false });
  for (let k = others.length - 1; k >= 0; k--) step({ others: k });
  if (c.plans) step({ plans: false });
  for (let n = leadMost - 1; n >= 1; n--) step({ lead: n });
  if (lead !== null || later !== null) step({ leadOnly: true });

  const out: StandsRung[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    const r = rung(s);
    if (r === null || seen.has(r.block)) continue;
    seen.add(r.block);
    out.push(r);
  }
  return out;
}

/** One rung's block, and what it carries; null for nothing to say. */
function render(
  all: readonly Mention[],
  c: Choice,
  liveHs: readonly Handoff[],
  others: readonly Handoff[],
  opts: { day: number; lifeDays: number; reader: string | null; plans: PlansSince | null; aboutMe: string | null; planIds: readonly string[] },
): StandsRung | null {
  const entries = group(all);
  // ONLY THE LEAD (the narrowest rung): the newest entry and what is its own.
  const kept = c.leadOnly ? entries.slice(0, 1) : entries;
  const mentions = kept.flatMap((e) => e.mentions);
  const lines: string[] = [];
  const bytesOf = new Map<string, number>();
  let chapterBytes = 0;
  kept.forEach((e, i) => {
    const w = entryWords(e, opts.reader);
    if (w.handoffId !== null) bytesOf.set(w.handoffId, w.handoffBytes);
    chapterBytes += w.chapterBytes;
    lines.push(flatten(`${i === 0 ? STANDS_HEAD : STANDS_BEFORE} ${w.head}`), ...w.lead);
  });
  const hasEntry = lines.length > 0;
  // The other handoffs a line each, while their newest has its own.
  const leadShown = liveHs.filter((h) => bytesOf.has(h.id));
  const otherShown = leadShown.length === 0 || c.leadOnly ? [] : others.slice(0, c.others);
  if (otherShown.length > 0) {
    lines.push(STANDS_OTHERS);
    for (const h of otherShown) {
      const l = otherLine(h, opts.reader);
      bytesOf.set(h.id, byteLength(l) + 1);
      lines.push(l);
    }
  }
  const shown = [...leadShown, ...otherShown];
  const door = hasEntry ? doorWords(shown, liveHs, opts.day, opts.lifeDays) : null;
  if (door !== null) lines.push(flatten(door));
  const since = opts.plans === null || !hasEntry ? null : sinceLine(opts.plans, liveHs.length > 1);
  if (since !== null) lines.push(flatten(since));
  if (opts.aboutMe !== null) lines.push(flatten(opts.aboutMe));
  if (lines.length === 0) return null;
  return {
    block: lines.join("\n"),
    shown,
    handoffBytes: shown.map((h) => bytesOf.get(h.id) ?? 0),
    live: liveHs.length,
    plans: since === null ? [] : opts.planIds,
    chapter: mentions.some((m) => m.kind === "later" || m.kind === "chapter"),
    chapterBytes,
    said: mentions.some((m) => m.kind === "said"),
    aboutMe: opts.aboutMe !== null,
    aboutMeBytes: opts.aboutMe === null ? 0 : byteLength(flatten(opts.aboutMe)) + 1,
  };
}

/** The mentions by session, the newest entry first; ties: the one with a handoff, then the key. */
function group(mentions: readonly Mention[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const m of mentions) {
    const key = m.session === null || m.session.length === 0 ? `handoff:${m.kind === "handoff" ? m.h.handoff.id : ""}` : `session:${m.session}`;
    const e = entries.get(key);
    entries.set(key, e === undefined ? { key, at: m.at, mentions: [m] } : { key, at: Math.max(e.at, m.at), mentions: [...e.mentions, m] });
  }
  return [...entries.values()].sort(
    (a, b) =>
      b.at - a.at ||
      Number(b.mentions.some((m) => m.kind === "handoff")) - Number(a.mentions.some((m) => m.kind === "handoff")) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * THE BYTES THE BOUNDARY RESERVES FOR THIS FOLDER'S HANDOFFS, widest first
 * (`Handoffs#liveBlockBytesByScope`): the block with the handoffs alone, as a
 * delivery would say them, since the reserve is sized to the words that exist.
 */
export function handoffRungBytes(handoffs: readonly StandsHandoff[], day: number, plans: PlansSince | null): number[] {
  return standsLadder({ handoffs, day, plans }).map((r) => byteLength(r.block));
}

/**
 * THE BYTES OF THE CHAPTER'S PART ALONE, widest first
 * (`Counterpart#handoffRoom`): the reserve's "Last here" term.
 */
export function chapterRungBytes(facts: LastHereFacts, day: number, reader: string | null): number[] {
  return standsLadder({ handoffs: [], day, reader, ...facts }).map((r) => byteLength(r.block));
}

/** One live handoff as the `handoffs here` handle lists it. */
export interface HandoffListed {
  readonly id: string;
  readonly writtenOn: string;
  readonly session: string | null;
  readonly model: string | null;
  /** Its first sentence, as the line would say it. */
  readonly excerpt: string;
  /** Lived days until it stops showing. */
  readonly daysLeft: number;
}

/** This folder's live handoffs for the `handoffs here` handle, newest first. Pure. */
export function handoffsListed(handoffs: readonly Handoff[], day: number, lifeDays = HANDOFF_LIFE_DAYS): HandoffListed[] {
  return handoffs
    .filter((h) => !expired(h, day, lifeDays))
    .map((h) => ({
      id: h.id,
      writtenOn: h.writtenOn,
      session: h.session,
      model: h.model ?? null,
      excerpt: excerpt(h.body),
      daysLeft: h.writtenDay === null ? lifeDays : daysLeft(h.writtenDay, day, lifeDays),
    }));
}
