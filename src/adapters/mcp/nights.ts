/**
 * A NIGHT BY ITS ID (2026-10-20): `recall` with a dream's id (`drm_…`) or a
 * reflection's (`rfl_…`) as its handle or among its ids reads a short summary
 * of that record. The wake says "I dreamed … (drm_…)" and the morning share
 * names its reflection; until now neither id opened, and the only reader was
 * the console's `dream`, which also undoes — so a session could not review
 * last night with the owner.
 *
 * READ-ONLY, AND NOT A MEMORY. A night is a row in `dreams` / `reflections`,
 * not in `memories`, so a summary rides beside `memories` on the result
 * (`DeliberateResult.nights`), never in it: nothing that credits a use, marks
 * a memory seen, or logs a title's resolution reads this field. Opening a
 * night credits nothing; opening one of the memory ids it names is an
 * ordinary open, credited as any other.
 *
 * In any session, a summary carries no memory's body but a short gist's: the
 * ids are there to open, and an open crosses recall's own boundary. (The
 * confidentiality boundary that also stood here was retired 2026-10-21.)
 *
 * Pure reads over the store; never writes, never throws past its caller.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { clipWire, wireChars } from "../../core/fit/index.js";
import { rowTombstoned } from "../../core/store/index.js";
import type { DreamChangeRow, DreamRow, ReflectionRow, Store } from "../../core/store/index.js";

/** How many memory ids a summary names per kind of change before it counts the rest. */
export const NIGHT_IDS_PER_KIND = 12;
/** A gist is quoted when it is at most this long; a longer one is named by id. */
export const NIGHT_GIST_CHARS = 280;
/** How much of a dream's journal a summary carries (the console prints it whole). */
export const NIGHT_JOURNAL_CHARS = 1_200;
/** How much of a reflection's entry a summary carries. */
export const NIGHT_ENTRY_CHARS = 3_000;

/**
 * WHOLE, UP TO WHAT ONE ANSWER CARRIES (review of #645). A night read whole
 * keeps its journal or entry uncut up to this many wire characters
 * (`fit#wireChars`): the longest journal a dream may write (30,000) fits, so
 * in English "whole" is whole; a text past it (another script, three to a
 * character) is cut, and `journalChars` / `entryChars` says so.
 */
export const NIGHT_WHOLE_WIRE_CHARS = 32_000;

/** Said once on a result that carries a night, so `nights` is not a bare field. */
export const NIGHTS_GLOSS =
  "A night is a dream (drm_) or a reflection (rfl_) the nightly run made: a read-only summary, not a memory. Reading it changes nothing and credits nothing; the memory ids it names open by id as usual. Undoing a dream is the owner's, in the console.";

/** Is this handle a night's id — a dream's or a reflection's? */
export function nightKindOf(handle: string): "dream" | "reflection" | null {
  const h = handle.trim();
  if (/^drm_[0-9a-f]+$/.test(h)) return "dream";
  if (/^rfl_[0-9a-f]+$/.test(h)) return "reflection";
  return null;
}

/** Memory ids, some of them, and how many more there were. */
export interface IdsCapped {
  readonly ids: readonly string[];
  readonly more: number;
}

export interface DreamSummary {
  readonly kind: "dream";
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  /** `begun`, `journaled`, `undone`, … as the row says. */
  readonly state: string;
  readonly title: string | null;
  /** Its journal, cut at `NIGHT_JOURNAL_CHARS`; `journalChars` is the whole length. */
  readonly journal?: string;
  readonly journalChars?: number;
  /** What it did that still stands, by kind (`dreams.counts`: undone changes are not counted). */
  readonly counts: Readonly<Record<string, number>>;
  /** Changes since undone, when there are any. */
  readonly undone?: number;
  /** The memory ids each kind of change touched, capped per kind. */
  readonly touched: Readonly<Record<string, IdsCapped>>;
  /** Its gists: the text when short, else the id alone. */
  readonly gists: readonly { id: string; text?: string; chars?: number }[];
  /** Gists past `NIGHT_IDS_PER_KIND`, counted rather than listed (a night of hundreds stays small). */
  readonly gistsMore?: number;
  /** The reflections after it, newest first. */
  readonly reflections: readonly string[];
}

export interface ReflectionSummary {
  readonly kind: "reflection";
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  /** `begun`, `reflected`. */
  readonly state: string;
  readonly title: string | null;
  /** The dream it followed, or null when it reflected on its own. */
  readonly dream: string | null;
  readonly entry: string | null;
  readonly entryChars?: number;
  /** The memory its entry became. */
  readonly entryId: string | null;
  readonly share: string | null;
  /** `none`, `offered`, `carried`, `told`. */
  readonly shareState: string;
  readonly told: boolean;
  readonly cites: IdsCapped;
  readonly closes: { readonly proposed: readonly string[]; readonly closed: readonly string[] };
  /** The self-page version it wrote, or null. */
  readonly pageVersion: number | null;
}

export type NightSummary = DreamSummary | ReflectionSummary;

export type NightRead =
  | { readonly ok: true; readonly night: NightSummary }
  | { readonly ok: false; readonly reason: "handle-unknown" };

function ids(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function detailOf(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function capped(list: readonly string[], max = NIGHT_IDS_PER_KIND): IdsCapped {
  const unique = [...new Set(list)];
  return { ids: unique.slice(0, max), more: Math.max(0, unique.length - max) };
}

function cut(text: string, max: number): { text: string; chars?: number } {
  if (max === Number.POSITIVE_INFINITY) {
    // Whole: uncut up to what one answer carries, measured on the wire.
    return wireChars(text) <= NIGHT_WHOLE_WIRE_CHARS ? { text } : { text: clipWire(text, NIGHT_WHOLE_WIRE_CHARS), chars: text.length };
  }
  return text.length <= max ? { text } : { text: `${text.slice(0, max - 1)}…`, chars: text.length };
}

/** The memory ids one change names: its two refs, and a merge's originals. */
function changeIds(c: DreamChangeRow): string[] {
  const out: string[] = [];
  if (c.ref !== null) out.push(c.ref);
  if (c.ref2 !== null) out.push(c.ref2);
  if (c.action === "merge") out.push(...stringList(detailOf(c.detail)["from"]));
  return out;
}

/** The key `dreams.counts` files a change under: a fold is its own kind. */
function kindOf(c: DreamChangeRow): string {
  return c.action === "gist" && detailOf(c.detail)["fold"] === true ? "fold" : c.action;
}

function dreamSummary(counterpart: Counterpart, dream: DreamRow, changes: readonly DreamChangeRow[], journalMax: number = NIGHT_JOURNAL_CHARS): DreamSummary {
  const store = counterpart.store;
  const standing = changes.filter((c) => c.undone !== 1);
  const byKind = new Map<string, string[]>();
  for (const c of standing) {
    const k = kindOf(c);
    byKind.set(k, [...(byKind.get(k) ?? []), ...changeIds(c)]);
  }
  const touched: Record<string, IdsCapped> = {};
  for (const [k, list] of byKind) touched[k] = capped(list);
  const gists: { id: string; text?: string; chars?: number }[] = [];
  let gistsMore = 0;
  for (const c of standing) {
    if ((c.action !== "gist" && c.action !== "fold") || c.ref === null) continue;
    if (gists.length >= NIGHT_IDS_PER_KIND) {
      gistsMore += 1;
      continue;
    }
    const row = store.row(c.ref);
    if (row === undefined || rowTombstoned(row)) continue;
    const body = row.body.trim();
    gists.push(body.length <= NIGHT_GIST_CHARS ? { id: c.ref, text: body } : { id: c.ref, chars: body.length });
  }
  const undone = changes.length - standing.length;
  const journal = dream.journal === null || dream.journal.trim().length === 0 ? null : cut(dream.journal.trim(), journalMax);
  return {
    kind: "dream",
    id: dream.id,
    date: dream.date,
    day: dream.day,
    state: dream.state,
    title: dream.title,
    ...(journal === null ? {} : { journal: journal.text, ...(journal.chars === undefined ? {} : { journalChars: journal.chars }) }),
    counts: counterpart.dreams.counts(dream.id),
    ...(undone > 0 ? { undone } : {}),
    touched,
    gists,
    ...(gistsMore > 0 ? { gistsMore } : {}),
    reflections: store.reflections({ dreamId: dream.id, limit: 5 }).map((r) => r.id),
  };
}

function reflectionSummary(store: Store, r: ReflectionRow, entryMax: number = NIGHT_ENTRY_CHARS): ReflectionSummary {
  const d = detailOf(r.detail);
  const list = stringList;
  const title = typeof d["title"] === "string" ? d["title"] : null;
  const entry = r.entry === null ? null : cut(r.entry, entryMax);
  return {
    kind: "reflection",
    id: r.id,
    date: r.date,
    day: r.day,
    state: r.state,
    title,
    dream: r.dream_id,
    entry: entry === null ? null : entry.text,
    ...(entry?.chars === undefined ? {} : { entryChars: entry.chars }),
    entryId: r.entry_id,
    share: r.share,
    shareState: r.share_state,
    told: r.share_state === "told",
    cites: capped(ids(r.cites)),
    closes: { proposed: list(d["closeProposed"]), closed: list(d["closed"]) },
    pageVersion: r.page_version,
  };
}

/**
 * ONE NIGHT, by its id: a summary, or why not. `whole` (2026-10-26, OL1b): the
 * journal and the entry uncut — a night asked for alone, by its handle, which
 * is how a chat with no console reads one (`readLastNight` too). Among `ids`
 * it stays a summary, so ten nights beside the memories stay small.
 */
export function readNight(counterpart: Counterpart, id: string, opts: { readonly whole?: boolean } = {}): NightRead {
  const kind = nightKindOf(id);
  const store = counterpart.store;
  const whole = opts.whole === true;
  try {
    if (kind === "dream") {
      const shown = counterpart.dreams.show(id.trim());
      if (shown === null) return { ok: false, reason: "handle-unknown" };
      return { ok: true, night: dreamSummary(counterpart, shown.dream, shown.changes, whole ? Number.POSITIVE_INFINITY : NIGHT_JOURNAL_CHARS) };
    }
    if (kind === "reflection") {
      const r = counterpart.reflections.show(id.trim());
      if (r === null) return { ok: false, reason: "handle-unknown" };
      return { ok: true, night: reflectionSummary(store, r, whole ? Number.POSITIVE_INFINITY : NIGHT_ENTRY_CHARS) };
    }
  } catch {
    // A read that fails answers as not found; recall never throws at a tool.
  }
  return { ok: false, reason: "handle-unknown" };
}

// ── last night, and nights a question names (2026-10-26, OL1b item 3) ────────

/**
 * THE HANDLES THAT READ THE NEWEST NIGHT WHOLE. On claude.ai there is no
 * dashboard and no console, and on the trial's first day "what was your last
 * dream?" found the reflection by meaning, not the dream; "show me the full
 * dream" could not be answered at all (a dream opened only by its exact id,
 * and then as a summary). Exact, like every handle: these words, any case.
 */
export const LAST_NIGHT_HANDLES: readonly string[] = ["last dream", "last night"];

export function isLastNightHandle(handle: unknown): boolean {
  return typeof handle === "string" && LAST_NIGHT_HANDLES.includes(handle.trim().toLowerCase());
}

/** The newest night, whole: its dream and the reflection after it. */
export interface LastNight {
  readonly dream: DreamSummary | null;
  /** Whole; or, past the room (`roomFor` in `readLastNight`), a short summary or just its id. */
  readonly reflection: ReflectionSummary | ReflectionPointer | null;
  /** How the reflection came when the two together passed the room; absent when whole. */
  readonly reflectionCut?: "summary" | "pointer";
}

/** A reflection named by id alone: the room went to the dream. */
export interface ReflectionPointer {
  readonly kind: "reflection";
  readonly id: string;
  readonly date: string | null;
  readonly title: string | null;
  readonly shareState: string;
  readonly told: boolean;
}

/** Room for the two parts of last night together, in wire characters, under one answer's ceiling. */
export const LAST_NIGHT_WIRE_CHARS = 36_000;

/**
 * The newest dream that wrote a journal and was not undone (else the newest
 * dream), with the newest reflection after it; with no dream at all, the
 * newest reflection — the console's `night last` rule. Journal and entry
 * whole. Pure reads; null parts when there is nothing; never throws.
 *
 * ONE ANSWER'S ROOM (review of #645): a dream may journal 30,000 characters
 * and its reflection 20,000 more, past what one tool answer carries — and the
 * server's last net cuts only a top-level string, so the two would have
 * shipped over it whole and been spilled by the host. Past `room`, the dream
 * stays whole and the reflection comes as a summary (its entry cut, and said),
 * or by id alone; its id read as a handle opens it whole on its own.
 */
export function readLastNight(counterpart: Counterpart, room: number = LAST_NIGHT_WIRE_CHARS): LastNight {
  const store = counterpart.store;
  try {
    const recent = store.dreams({ limit: 20 });
    const dream = recent.find((d) => d.journal !== null && d.journal.trim().length > 0 && d.state !== "undone") ?? recent[0];
    const dreamRead = dream === undefined ? null : readNight(counterpart, dream.id, { whole: true });
    const after = dream === undefined ? store.reflections({ limit: 1 })[0] : store.reflections({ dreamId: dream.id, limit: 1 })[0];
    const reflectionRead = after === undefined ? null : readNight(counterpart, after.id, { whole: true });
    const d = dreamRead?.ok === true && dreamRead.night.kind === "dream" ? dreamRead.night : null;
    const r = reflectionRead?.ok === true && reflectionRead.night.kind === "reflection" ? reflectionRead.night : null;
    const fits = (x: unknown): boolean => wireChars(JSON.stringify({ dream: d, reflection: x })) <= room;
    if (r === null || after === undefined || fits(r)) return { dream: d, reflection: r };
    const summary = reflectionSummary(store, after);
    if (fits(summary)) return { dream: d, reflection: summary, reflectionCut: "summary" };
    const pointer: ReflectionPointer = { kind: "reflection", id: r.id, date: r.date, title: r.title, shareState: r.shareState, told: r.told };
    return { dream: d, reflection: pointer, reflectionCut: "pointer" };
  } catch {
    return { dream: null, reflection: null };
  }
}

/** At most this many dreams ride beside a question's answer. */
export const QUESTION_NIGHTS_MAX = 2;
/** How many recent dreams a question's words are matched against. */
export const QUESTION_NIGHTS_LOOKBACK = 30;

/** Does the question name dreaming? */
export function asksAboutDreams(question: string): boolean {
  return /\b(dream|dreams|dreamed|dreamt|dreaming)\b/i.test(question);
}

/** Why a dream rode beside a question's answer. */
export type QuestionNightWhy = "reflection-shown" | "words" | "names-dreams";

/**
 * DREAMS A QUESTION REACHES (2026-10-26, OL1b item 3; lightly held). A dream
 * is not a memory, so neither mode's index finds it; its reflection's entry
 * IS one, and meaning mode found that on the trial's first day. So a dream
 * rides beside a question's answer when:
 *
 *   1. the answer showed the entry of a reflection that followed it; or
 *   2. the question names dreaming, and its title or journal shares a
 *      content word with it (review of #645: on any question, two shared
 *      words carried a work-week dream beside six of eight ordinary
 *      questions — "the release", "the dashboard work" — so a question that
 *      does not ask about dreams is reached only by rule 1); or
 *   3. the question names dreaming and nothing matched: the newest dream.
 *
 * Words, not vectors: dream journals have no embedding (a cache table would
 * be a store-format change, batched with others — not this lane's). Summaries,
 * newest first, at most `QUESTION_NIGHTS_MAX`; each says why it came. `words`
 * is the content-word reader (`reconsolidation.ts#contentWords`), handed in
 * so this file reads no core module it does not already. Never throws.
 */
export function nightsForQuestion(
  counterpart: Counterpart,
  question: string,
  shownIds: readonly string[],
  words: (text: string) => Set<string>,
): { night: DreamSummary; why: QuestionNightWhy }[] {
  const store = counterpart.store;
  try {
    const recent = store.dreams({ limit: QUESTION_NIGHTS_LOOKBACK }).filter((d) => d.state !== "undone");
    if (recent.length === 0) return [];
    const picked = new Map<string, QuestionNightWhy>();
    const shown = new Set(shownIds);
    if (shown.size > 0) {
      for (const r of store.reflections({ limit: QUESTION_NIGHTS_LOOKBACK })) {
        if (r.entry_id !== null && shown.has(r.entry_id) && r.dream_id !== null && recent.some((d) => d.id === r.dream_id)) picked.set(r.dream_id, "reflection-shown");
      }
    }
    const naming = asksAboutDreams(question);
    const asked = words(question);
    // The words that ask ABOUT a night are not what it was about.
    for (const w of ["dream", "dreams", "dreamed", "dreamt", "dreaming", "night", "last"]) for (const v of words(w)) asked.delete(v);
    if (naming && asked.size > 0) {
      for (const d of recent) {
        if (picked.has(d.id)) continue;
        const have = words(`${d.title ?? ""} ${d.journal ?? ""}`);
        let shared = 0;
        for (const w of asked) if (have.has(w)) shared += 1;
        if (shared >= 1) picked.set(d.id, "words");
      }
    }
    if (picked.size === 0 && naming) {
      const newest = recent.find((d) => d.journal !== null && d.journal.trim().length > 0) ?? recent[0];
      if (newest !== undefined) picked.set(newest.id, "names-dreams");
    }
    const order = recent.map((d) => d.id).filter((id) => picked.has(id)).slice(0, QUESTION_NIGHTS_MAX);
    const out: { night: DreamSummary; why: QuestionNightWhy }[] = [];
    for (const id of order) {
      const read = readNight(counterpart, id);
      const why = picked.get(id);
      if (read.ok && read.night.kind === "dream" && why !== undefined) out.push({ night: read.night, why });
    }
    return out;
  } catch {
    return [];
  }
}
