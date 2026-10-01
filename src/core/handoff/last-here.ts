/**
 * LAST HERE — the wake's line for the session that last wrote a chapter in
 * this directory (2026-09-30, the continuity test).
 *
 * A handoff is for unfinished work, and a session that finished cleanly
 * leaves none, so the directory's pointer said nothing of it: Mike ended an
 * evening's session in ~/random (twenty notes, a chapter, session_end
 * memories, no handoff), opened a new one two minutes later, asked "what do
 * you remember from our most recent session?", and the new session could not
 * find any of it. Every session that writes a chapter writes this line,
 * finished or not, and the line is beside the handoff pointer, not instead of
 * it.
 *
 * **Derived, not stored.** Which directory a chapter was written in is read,
 * in order, off the episode's own `origin_scope` (set at birth since
 * 2026-09-30), off the chapter claims in that directory's coverage file
 * (`coverage/#chapterClaims`), and — for a chapter with neither — off the
 * directories its session's turn-ends are filed in (`coverage/#sessionsHere`,
 * which also gives when that session was here). No new row type, no write.
 *
 * Furniture, like the handoff pointer: spliced at delivery above it, never an
 * element, never a `- ` bullet, every line flattened. Its room comes out of
 * the same reserve, by the same share rule (`reserveBytes`), and it gives way
 * to the handoff — a fortnight's unfinished work outranks orientation.
 */
import type { Store } from "../store/index.js";
import { localDate, readableDate } from "../time.js";
import { isKnownSession, isModelId } from "../types.js";
import { HANDOFF_EXCERPT_BYTES, HANDOFF_LIFE_DAYS, excerpt, flatten, sessionWords } from "./index.js";

/**
 * How long a chapter is "last here", in LIVED days since it was written — the
 * handoff's fortnight, so the two kinds of working context age alike.
 */
export const LAST_HERE_LIFE_DAYS = HANDOFF_LIFE_DAYS;

/** How many sessions the line names in full (the newest with its first
 *  sentence, the one before it by title); the rest of that day by id. */
export const LAST_HERE_SHOWN = 2;

/** How many further chapters "+N more" names by id; past it, a count. */
export const LAST_HERE_LISTED = 3;

/** The title's cap in the line. The id is the door to the whole chapter. */
export const LAST_HERE_TITLE_BYTES = 100;

/** One session's latest chapter, as the line reads it. */
export interface ChapterHere {
  /** The episode row (`epi_…`). */
  readonly id: string;
  readonly session: string;
  /** The model that wrote it, when the row recorded one. */
  readonly model: string | null;
  readonly title: string | null;
  /** The first sentence of its LATEST chapter. */
  readonly excerpt: string;
  /** Epoch ms of the latest write to it, and of its first. */
  readonly writtenAt: number;
  readonly createdAt: number;
  /** The lived day its latest chapter was written on, from the heading. */
  readonly writtenDay: number | null;
  /** The directory it was born in, when the row recorded one (2026-09-30 on). */
  readonly scope: string | null;
}

/** A chapter's session here, with the times the line prints, spelled by the caller. */
export interface LastHere {
  readonly chapter: ChapterHere;
  /** `09-30 16:01–17:53`: when the session was here. */
  readonly when: string;
  /** `09-30`: the date its chapter was written, for "+N more here on …". */
  readonly date: string;
}

/**
 * The engine's own chapter heading (`self/episodes.ts#chapterHeading`), in
 * both its written forms — and nothing a model writes inside a chapter's text,
 * like "## Chapter two" (review of #300, NIT).
 */
const HEADING = /^## chapter \d+ — (?:[^\n]* · )?lived day \d+[ \t]*$/gm;

/**
 * EVERY SESSION'S LATEST CHAPTER, by session, among the live episodes born on
 * or after `fromDay` — one SQL-bounded walk. A row the owner removed is not
 * read. Never throws: a store that will not answer has no chapters.
 */
export function chaptersBySession(store: Store, opts: { fromDay?: number } = {}): Map<string, ChapterHere> {
  const out = new Map<string, ChapterHere>();
  let ids: string[];
  let denied: Set<string>;
  try {
    ids = store.list({
      type: "episode",
      archived: false,
      ...(opts.fromDay === undefined ? {} : { bornFromDay: opts.fromDay }),
    });
    denied = ids.length === 0 ? new Set() : new Set(store.deniedIds());
  } catch {
    return out;
  }
  for (const id of ids) {
    if (denied.has(id)) continue;
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
      let session = row.origin_session;
      if (session === null || session.length === 0) {
        const meta = JSON.parse(row.meta || "{}") as Record<string, unknown>;
        session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
      }
      // A chapter needs a bound session, so this is a guard: the unbound id names no one.
      if (!isKnownSession(session)) continue;
      const createdAt = row.created_at ?? 0;
      const writtenAt = row.updated_at ?? createdAt;
      const held = out.get(session);
      if (held !== undefined && held.writtenAt >= writtenAt) continue;
      const { text, day } = latestChapter(row.body);
      out.set(session, {
        id,
        session,
        model: isModelId(row.model) ? row.model : null,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        excerpt: excerpt(text),
        writtenAt,
        createdAt,
        writtenDay: day ?? (Number.isFinite(row.birth_day) ? row.birth_day : null),
        scope: row.origin_scope === null || row.origin_scope.length === 0 ? null : row.origin_scope,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** The text of an episode's LAST chapter, and the lived day its heading names. */
export function latestChapter(body: string): { text: string; day: number | null } {
  let last: RegExpExecArray | null = null;
  for (const m of body.matchAll(HEADING)) last = m as RegExpExecArray;
  if (last === null) return { text: body, day: null };
  const day = /lived day (\d+)/.exec(last[0])?.[1];
  return { text: body.slice((last.index ?? 0) + last[0].length), day: day === undefined ? null : Number(day) };
}

const norm = (s: string): string => s.trim().replace(/\/+$/, "");

/**
 * THE CHAPTERS WRITTEN HERE, newest first, each with when its session was
 * here. A chapter is HERE when its row says this directory; with no directory
 * on the row, when this directory's coverage file holds its chapter claim
 * (`claimed`), or failing that when its session's turn-ends are filed here
 * (`sessions`). The waking session's own chapter is not "last here" (review
 * of #300 MINOR-3). Kept while its latest chapter is inside the fortnight.
 */
export function chaptersHere(
  chapters: ReadonlyMap<string, ChapterHere>,
  here: {
    readonly scope: string;
    readonly claimed: ReadonlySet<string>;
    readonly sessions: ReadonlyMap<string, { firstAt: number; lastAt: number }>;
  },
  day: number,
  opts: { readonly reader?: string | null; readonly lifeDays?: number } = {},
): { chapter: ChapterHere; firstAt: number; lastAt: number }[] {
  const lifeDays = opts.lifeDays ?? LAST_HERE_LIFE_DAYS;
  const out: { chapter: ChapterHere; firstAt: number; lastAt: number }[] = [];
  for (const chapter of chapters.values()) {
    if (opts.reader !== undefined && opts.reader !== null && chapter.session === opts.reader) continue;
    if (chapter.writtenDay !== null && day - chapter.writtenDay >= lifeDays) continue;
    const s = here.sessions.get(chapter.session);
    const isHere =
      chapter.scope !== null ? norm(chapter.scope) === norm(here.scope) : here.claimed.has(chapter.id) || s !== undefined;
    if (!isHere) continue;
    out.push({
      chapter,
      firstAt: Math.min(s?.firstAt ?? chapter.createdAt, chapter.createdAt || Infinity),
      lastAt: Math.max(s?.lastAt ?? 0, chapter.writtenAt),
    });
  }
  return out.sort((a, b) => b.chapter.writtenAt - a.chapter.writtenAt || (a.chapter.id < b.chapter.id ? 1 : -1));
}

/** `— "Title" (epi_…)`, or `— epi_…` when the chapter has no title. */
function named(c: ChapterHere): string {
  return c.title === null ? `— ${c.id}` : `— "${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id})`;
}

/**
 * THE LINES, for the newest `shown` sessions here (1 or 2): the newest with its
 * first sentence, the one before it by title, and the rest written THAT DAY by
 * id. `more` false leaves the "+N more" line off — the narrowest rung.
 */
export function lastHereBlock(
  entries: readonly LastHere[],
  opts: { readonly shown?: number; readonly more?: boolean; readonly reader?: string | null } = {},
): string | null {
  const first = entries[0];
  if (first === undefined) return null;
  const reader = opts.reader ?? null;
  const sameDay = entries.filter((e) => e.date === first.date);
  const shown = Math.max(1, Math.min(opts.shown ?? LAST_HERE_SHOWN, sameDay.length));
  const who = (e: LastHere): string => sessionWords(e.chapter.session, e.chapter.model, reader);
  const lines = [
    `Last here: ${who(first)}, ${first.when} ${named(first.chapter)}.${first.chapter.excerpt.length > 0 ? ` ${excerpt(first.chapter.excerpt, HANDOFF_EXCERPT_BYTES)}` : ""}`,
  ];
  for (const e of sameDay.slice(1, shown)) lines.push(`Before it: ${who(e)}, ${e.when} ${named(e.chapter)}.`);
  const rest = sameDay.slice(shown);
  if (opts.more !== false && rest.length > 0) {
    const ids = rest.slice(0, LAST_HERE_LISTED).map((e) => e.chapter.id);
    const unnamed = rest.length - ids.length;
    lines.push(`+${rest.length} more here on ${first.date}: ${ids.join(", ")}${unnamed > 0 ? `, and ${unnamed} more` : ""}.`);
  }
  return lines.map(flatten).join("\n");
}

/** How many of yesterday's chapters the "Yesterday" line names by title. */
export const YESTERDAY_SHOWN = 4;

/** A title's cap in the "Yesterday" line; the id is the door to the rest. */
export const YESTERDAY_TITLE_BYTES = 60;

/** One episode's chapters written on a date (`chaptersOn`). */
export interface ChaptersOnDate {
  /** The episode row (`epi_…`). */
  readonly id: string;
  readonly title: string | null;
  /** How many of its chapters were written that day. */
  readonly chapters: number;
  /** When the episode was born, for the order. */
  readonly createdAt: number;
}

/** Every chapter heading in an episode body, with the date it names when it names one. */
const DATED_HEADING = /^## chapter \d+ — (?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4}) · )?(?:[^\n]* · )?lived day \d+[ \t]*$/gm;

/**
 * THE CHAPTERS WRITTEN ON `date`, store-wide, per episode, oldest episode
 * first (review of #308): read off each chapter's own heading, which prints
 * the calendar day it was written beside the lived day (`self/episodes.ts#
 * chapterHeading`, since 2026-09-24) — so a session that wrote a chapter that
 * day and another the next is still that day's, and two chapters that day
 * count as two. An episode whose headings carry no date falls back to its
 * row's first and latest write. Bounded to the episodes born inside
 * `fromDay`. A removed or superseded row is not read. Never throws.
 */
export function chaptersOn(store: Store, date: string, opts: { fromDay?: number } = {}): ChaptersOnDate[] {
  const out: ChaptersOnDate[] = [];
  const said = readableDate(date);
  if (said.length === 0) return out;
  let ids: string[];
  let denied: Set<string>;
  try {
    ids = store.list({ type: "episode", archived: false, ...(opts.fromDay === undefined ? {} : { bornFromDay: opts.fromDay }) });
    denied = ids.length === 0 ? new Set() : new Set(store.deniedIds());
  } catch {
    return out;
  }
  const zone = store.zone();
  for (const id of ids) {
    if (denied.has(id)) continue;
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
      let dated = 0;
      let that = 0;
      for (const m of row.body.matchAll(DATED_HEADING)) {
        if (m[1] === undefined) continue;
        dated += 1;
        if (m[1] === said) that += 1;
      }
      // THE HEADING'S DATE ONLY (second review of #308): a row's own write
      // times move for a retitle or a revision too, so they would list a day
      // no chapter was written on. An episode from before headings carried a
      // date (2026-09-24) is read by the day it was born, and only then.
      if (dated === 0 && localDate(row.created_at ?? 0, zone) === date) that = 1;
      if (that === 0) continue;
      out.push({ id, title: row.title === null || row.title.trim().length === 0 ? null : row.title, chapters: that, createdAt: row.created_at ?? 0 });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * THE "YESTERDAY" LINE (2026-10-01, build 3) — store-wide, from the chapters
 * written on `date` (`chaptersOn`), oldest episode first, each by its title and
 * id (and how many chapters, when more than one); the rest by count. One line,
 * CARRYING ITS DATE — "Yesterday, 09-30: …" — because the wake is composed at a
 * boundary and served as it stands until the next: a bundle built late at
 * night is read in the morning, and a date stays true where "yesterday" alone
 * would not. No model run: titles and ids only. Null when that day has no
 * chapter.
 */
export function yesterdayLine(day: readonly ChaptersOnDate[], date: string): string | null {
  if (day.length === 0) return null;
  const shown = day.slice(0, YESTERDAY_SHOWN).map((c) => {
    const n = c.chapters > 1 ? `, ${String(c.chapters)} chapters` : "";
    return c.title === null ? `${c.id}${n === "" ? "" : ` (${n.slice(2)})`}` : `"${excerpt(c.title, YESTERDAY_TITLE_BYTES)}" (${c.id}${n})`;
  });
  const rest = day.length - shown.length;
  return flatten(`Yesterday, ${date.slice(5)}: ${shown.join("; ")}${rest > 0 ? `; and ${String(rest)} more` : ""}.`);
}

/**
 * THE BLOCKS A DELIVERY MAY TRY, widest first — `pointerLadder`'s shape: every
 * session of that day shown, then the newest with the count of the rest, then
 * the newest alone. Duplicates dropped.
 */
export function lastHereLadder(entries: readonly LastHere[], reader: string | null = null): string[] {
  const out: string[] = [];
  for (const block of [
    lastHereBlock(entries, { reader }),
    lastHereBlock(entries, { reader, shown: 1 }),
    lastHereBlock(entries, { reader, shown: 1, more: false }),
  ]) {
    if (block !== null && !out.includes(block)) out.push(block);
  }
  return out;
}
