/**
 * The web dashboard's JSON views — the same read surface the terminal views use
 * (`DashboardSource`), shaped for a page instead of for a column of text.
 *
 * Four rules travel from the terminal adapter unchanged, and they are the reason
 * this file exists rather than a handful of ad-hoc handlers in the server:
 *
 *   1. **Render-time id resolution, everywhere.** Nothing below emits text that
 *      was stored beside an id. Every id becomes words at the moment the request
 *      is served, through `reveal()` — so a removed memory reads as removed in a
 *      panel built from a three-day-old event (scar §2.20).
 *   2. **Confidential rows are withheld the way every other surface withholds
 *      them** (`reveal.ts`). The row stays visible — id, band, strength, its dot
 *      in the constellation — and only the sentence is gone. A memory the owner
 *      cannot see the existence of would be the worse failure.
 *   3. **Absence has two words.** `(none yet)` — asked, and the answer is zero.
 *      `(never run)` — never asked. Every panel says which; none is blank
 *      (scar §2.4, `NOTES.md`).
 *   4. **Totality.** Kinds, bands, cycle phases and durable event names come
 *      from `registries.ts`, which derives them from the live core. A member
 *      with nothing to report is a row that says so.
 *
 * The journal is excluded from every memory census here, exactly as `status.ts`
 * and `browse.ts` exclude it: an episode is the SOURCE a memory was made from,
 * it sits outside every sleep phase, and counting it would make the census wrong
 * by the number of days lived.
 */
import { band, rep, sal, strength, symmetryCheck, TUNABLES as PHYSICS } from "../../../core/physics/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../../core/schemas/index.js";
import {
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  PRUNE_ARCHIVE_REASON,
  isJournal,
  readMarker,
} from "../../../core/sleep/index.js";
import { FRAMING, LANE_ORDER } from "../../../core/self/index.js";
import type { Band, Kind } from "../../../core/types.js";
import { NEVER, NONE, num } from "../layout.js";
import { BANDS, CYCLE_PHASES, DURABLE_EVENTS, DURABLE_EVENT_NAMES, KINDS } from "../registries.js";
import type { DurableEventName } from "../registries.js";
import type { DashboardSource } from "../source.js";
import { contestedBeliefs } from "../stories.js";
import { FLOW_EDGES, FLOW_NODES, NO_EVENT_OF_ITS_OWN, UNLOGGED_PATH, eventsOfNode, findNode } from "./flow.js";
import type { NodeKey } from "./flow.js";
import { narrate } from "./narrate.js";
import type { NarratedEvent } from "./narrate.js";
import { WITHHELD, gistOfDoc, reveal, revealHere } from "./reveal.js";

/** How many rows a feed hands back unless asked otherwise. */
export const FEED_LIMIT = 40;
/** The event-log read ceiling. The log is bounded-retention anyway. */
const LOG_CEILING = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// shared shaping
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryLine {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly kind: Kind;
  readonly band: Band;
  /** The band column as recorded — a birth fossil, kept beside the live one. */
  readonly recordedBand: Band;
  readonly strength: number;
  readonly salience: number;
  readonly uses: number;
  readonly bornDay: number;
  readonly lastUsedDay: number;
  readonly ageDays: number;
  readonly protected: boolean;
  readonly promoted: boolean;
  readonly pressure: number;
  readonly archived: string | null;
  /**
   * True for a `schema` row — an entity, or a belief about one.
   *
   * It is in this census because the physics runs on it like anything else and
   * every distribution on the memories page should cover it. It is NOT a
   * memory, and counting it as one made the overview's headline disagree with
   * the console: 145 against `counterparts status`'s 121 memories plus 24
   * beliefs and entities, on the same store, at the same moment.
   */
  readonly schema: boolean;
  /** True when the row would not read at all — listed, never dropped. */
  readonly unreadable: boolean;
}

interface CensusOptions {
  readonly includeArchived?: boolean;
}

/**
 * Every live memory, with its physics computed for today. One pass; every panel
 * on the memories page is a fold over this array, so the page cannot disagree
 * with itself about how many memories there are.
 */
function census(src: DashboardSource, opts: CensusOptions = {}): MemoryLine[] {
  const store = src.store;
  const day = store.livedDay();
  const filter = opts.includeArchived === true ? {} : { archived: false };
  const out: MemoryLine[] = [];
  for (const id of store.list(filter)) {
    const row = store.row(id);
    if (row === undefined) continue;
    // The journal is not a memory. See the file header.
    if (isJournal(row)) continue;
    try {
      const physics = store.physicsOf(id);
      const doc = store.readProse(id);
      const g = gistOfDoc(doc, 96);
      const live = band(physics, day);
      out.push({
        id,
        text: g.text,
        confidential: g.confidential,
        kind: row.kind,
        band: live,
        recordedBand: row.band,
        strength: strength(physics, day),
        salience: sal(physics.salience),
        uses: physics.uses,
        bornDay: physics.birthDay,
        lastUsedDay: physics.lastUsedDay,
        ageDays: Math.max(0, day - physics.birthDay),
        protected: physics.protected === true,
        promoted: physics.promotedIdentity === true,
        pressure: physics.pressure,
        archived: row.archived === 1 ? (row.archived_reason ?? "archived") : null,
        schema: row.type === "schema",
        unreadable: false,
      });
    } catch {
      // A removed row, or prose that will not read. It is still a real row, so
      // it is a named absence in the list rather than a silent subtraction.
      out.push({
        id,
        text: reveal(store, id, 96).label,
        confidential: false,
        kind: row.kind,
        band: row.band,
        recordedBand: row.band,
        strength: 0,
        salience: 0,
        uses: 0,
        bornDay: 0,
        lastUsedDay: 0,
        ageDays: 0,
        protected: row.protected === 1,
        promoted: row.promoted_identity === 1,
        pressure: row.pressure,
        archived: row.archived === 1 ? (row.archived_reason ?? "archived") : null,
        schema: row.type === "schema",
        unreadable: true,
      });
    }
  }
  // Strongest first, ties by id — the same order `browse.ts` lists in, so the
  // two surfaces answer "what is strong today" the same way, and so a caller
  // that takes the head of this list gets a defined row rather than whatever
  // SQLite happened to return first.
  out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  return out;
}

function countMap<T extends string>(rows: readonly { readonly [K in keyof MemoryLine]: MemoryLine[K] }[], key: "kind" | "band"): Map<T, number> {
  const m = new Map<T, number>();
  for (const r of rows) {
    const v = r[key] as unknown as T;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

/** The absence word for a count. Two words, deliberately (`NOTES.md`). */
function absenceFor(count: number, everAsked: boolean): string | null {
  if (count > 0) return null;
  return everAsked ? NONE : NEVER;
}

/** Live memories, journal and schema rows excluded. The number the console
 *  prints after `Memories:`, and the number every surface here must agree on. */
function memoriesHeld(src: DashboardSource): number {
  return census(src).filter((r) => !r.schema).length;
}

function eventsNamed(src: DashboardSource, name: string): number {
  return src.store.eventLog({ name, limit: LOG_CEILING }).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// meta — what this dashboard is pointed at
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaView {
  readonly dir: string;
  readonly day: number;
  readonly lastActive: string | null;
  readonly observer: true;
  readonly retentionDays: number;
  /** True when nothing has ever been stored. The page says so on purpose. */
  readonly empty: boolean;
  /**
   * HOW MANY ROWS THE STORE HOLDS RIGHT NOW — a fingerprint, not a headline.
   *
   * An open page polls the event log to know whether anything happened, and
   * that is a wrong question: a deposit that writes no durable event never moves
   * the log's sequence, so a page left open reports the old count forever
   * (design review, 2026-09-04 — the only wrong number left on any screen). This
   * is the cheap thing a poll can compare to notice a deposit that left no trace
   * in the log.
   *
   * The case that MOTIVATED it has since gone away: `counterparts note` was the
   * example, and since `gate.deposit` (2026-09-05, replay §2a) the authored door
   * writes a row like every other door, so a note moves the sequence and takes
   * the event branch. This stays as the belt it always was — a store seeded
   * around the door, a migration, any future write that leaves no row — and
   * because a fingerprint that is only correct while one particular writer
   * happens to log is not a fingerprint.
   *
   * It counts every row, including the journal and the archived, which is why
   * it is not called `held`: nothing should ever render it as a memory count.
   */
  readonly rows: number;
  readonly generatedAt: number;
}

/** An empty string is the store's "never moved", not a date. */
function lastActive(raw: string | undefined): string | null {
  return raw === undefined || raw.trim().length === 0 ? null : raw;
}

export function metaView(src: DashboardSource): MetaView {
  const store = src.store;
  const rows = store.list().length;
  return {
    dir: store.dir,
    day: store.livedDay(),
    lastActive: lastActive(store.getMeta("lastActiveDate")),
    observer: true,
    retentionDays: store.retentionDays,
    empty: rows === 0,
    rows,
    generatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// overview
// ─────────────────────────────────────────────────────────────────────────────

export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly accent: "cyan" | "purple" | "amber" | "teal" | "red";
  /** True when the value is an absence marker, not a number. */
  readonly absent: boolean;
}

export interface BarRow {
  readonly label: string;
  readonly count: number;
  readonly fraction: number;
  readonly note: string;
  readonly absent: string | null;
}

export interface ContestedRow {
  readonly id: string;
  readonly headId: string | null;
  readonly about: string;
  /** What it said at its own address, shown around the point it diverges. */
  readonly began: string;
  /** What it says now, shown around the same point. */
  readonly now: string;
  /** Both, whole — for a tooltip and for anyone who wants the sentence. */
  readonly beganFull: string;
  readonly nowFull: string;
  readonly pressure: number;
  readonly bar: number;
  readonly fraction: number;
  readonly revised: boolean;
  readonly challenges: number;
  readonly lastChallengedDay: number | null;
}

export interface ChapterRow {
  readonly id: string;
  readonly title: string;
  readonly day: number;
  readonly bytes: number;
  /** The chapter's opening, in the first person. Never the whole entry. */
  readonly opening: string;
}

export interface OverviewView {
  readonly opening: string;
  readonly tiles: Tile[];
  readonly bands: BarRow[];
  readonly bandNote: string;
  readonly feed: NarratedEvent[];
  /**
   * `promotedDay` is the lived day this element crossed into the band, read off
   * the `band.promoted` record, or null where no such record exists (a seeded
   * or migrated core was never watched crossing). It is here because `strength`
   * on an identity row is a TAUTOLOGY: every element in the band is at 1.00 by
   * construction, so fifteen rows of `strength 1.00` said one thing fifteen
   * times (design review, 2026-09-04, ranked #2). The day it earned the band is
   * the fact that varies — and where the store never recorded one, the row says
   * nothing there rather than inventing a day or repeating the tautology.
   */
  readonly identity: { id: string; text: string; kind: Kind; band: Band; strength: number; promotedDay: number | null; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly identityAbsent: string | null;
  readonly guarded: { id: string; text: string; kind: Kind; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly guardedAbsent: string | null;
  readonly contested: ContestedRow[];
  readonly contestedAbsent: string | null;
  readonly chapters: ChapterRow[];
  readonly chaptersAbsent: string | null;
}

const BAND_GLOSS: Record<Band, string> = {
  episodic: "still an episode; forgettable, and most stay here",
  semantic: "settled into what I know",
  identity: "constitutive — and physics can still move it",
};

export function overviewView(src: DashboardSource, feedLimit = FEED_LIMIT): OverviewView {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  // A SCHEMA ROW IS NOT A MEMORY. The census keeps both, because the bands and
  // kinds below are true of both and the physics runs on both — but the number
  // in the headline tile is the one a person compares against the console, and
  // the console says memories. See `MemoryLine.schema`.
  const held = rows.filter((r) => !r.schema);
  const beliefs = rows.length - held.length;
  const archived = census(src, { includeArchived: true }).filter((r) => r.archived !== null);
  const journal = chapters(src, 5);
  const journalCount = store.list().filter((id) => {
    const row = store.row(id);
    return row !== undefined && isJournal(row);
  }).length;
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const contested = contestedRows(src);
  const byBand = countMap<Band>(rows, "band");
  const peak = Math.max(1, ...BANDS.map((b) => byBand.get(b) ?? 0));
  const everLived = day > 0 || rows.length > 0 || journalCount > 0;
  // The lived day each element crossed into the identity band, where the store
  // watched it happen. Read once for the panel rather than once per row.
  const promotedDays = new Map<string, number>();
  for (const row of store.eventLog({ name: "band.promoted", limit: LOG_CEILING })) {
    if (row.ref !== null && !promotedDays.has(row.ref)) promotedDays.set(row.ref, row.day);
  }

  const tiles: Tile[] = [
    {
      label: "lived days",
      value: String(day),
      note:
        lastActive(store.getMeta("lastActiveDate")) === null
          ? "the clock has never moved"
          : `last of them ${lastActive(store.getMeta("lastActiveDate")) ?? ""}`,
      accent: "cyan",
      absent: day === 0,
    },
    { label: "memories held", value: String(held.length), note: "live, journal excluded", accent: "cyan", absent: held.length === 0 },
    {
      label: "beliefs and entities",
      value: String(beliefs),
      note: "held like memories, counted apart",
      accent: "teal",
      absent: beliefs === 0,
    },
    { label: "archived", value: String(archived.length), note: "held, not gone", accent: "teal", absent: archived.length === 0 },
    { label: "journal entries", value: String(journalCount), note: "chapters — these do not decay", accent: "purple", absent: journalCount === 0 },
    { label: "identity band", value: String(e.identity.length), note: "what strength earned", accent: "purple", absent: e.identity.length === 0 },
    { label: "protected", value: String(e.protected.length), note: "permanent ink, no revision reaches it", accent: "amber", absent: e.protected.length === 0 },
    {
      label: "contested beliefs",
      value: String(contested.length),
      note: contested.length === 0 ? "nothing has argued with me" : "arguments in progress or settled",
      accent: contested.some((c) => c.fraction >= 1) ? "amber" : "teal",
      absent: contested.length === 0,
    },
    {
      label: "last cycle",
      value: lastCycleDay(src) === null ? NEVER : `day ${lastCycleDay(src)}`,
      note: "the newest phase marker I hold",
      accent: "teal",
      absent: lastCycleDay(src) === null,
    },
    {
      label: "wake bytes",
      value: wake.ok ? String(wake.bytes) : NEVER,
      note: wake.ok ? "composed and waiting for the next session" : `nothing waiting (${wake.reason})`,
      accent: wake.ok ? "cyan" : "amber",
      absent: !wake.ok,
    },
  ];

  const opening =
    day === 0 && rows.length === 0
      ? "I have not lived a day yet. Everything below is what I would be able to tell you, and the honest word for how much of it I know is on each panel."
      : `I have lived ${day} ${day === 1 ? "day" : "days"}. I am holding ${held.length} ${held.length === 1 ? "memory" : "memories"}` +
        (beliefs === 0 ? "" : ` and ${beliefs} ${beliefs === 1 ? "belief or entity" : "beliefs and entities"}`) +
        (archived.length === 0 ? "" : `, with ${archived.length} more archived`) +
        (journalCount === 0 ? "." : `, beside ${journalCount} journal ${journalCount === 1 ? "entry" : "entries"} that do not decay.`);

  return {
    opening,
    tiles,
    bands: BANDS.map((b) => {
      const count = byBand.get(b) ?? 0;
      return {
        label: b,
        count,
        fraction: count / peak,
        note: BAND_GLOSS[b],
        absent: absenceFor(count, everLived),
      };
    }),
    bandNote:
      "Memories start episodic and climb only by being used on separate days. Most fade where they started — that is the design, not a shortfall.",
    feed: activityView(src, { limit: feedLimit }).events,
    identity: e.identity.slice(0, 12).map((el) => {
      const r = reveal(store, el.id, 90);
      return {
        id: el.id,
        text: r.text ?? r.label,
        kind: el.kind,
        band: el.band,
        strength: el.strength,
        promotedDay: promotedDays.get(el.id) ?? null,
        ...livedDays(src, el.id),
        confidential: r.confidential,
      };
    }),
    identityAbsent: e.identity.length === 0 ? (everLived ? NONE : NEVER) : null,
    guarded: e.protected.slice(0, 12).map((el) => {
      const r = reveal(store, el.id, 90);
      return {
        id: el.id,
        text: r.text ?? r.label,
        kind: el.kind,
        ...livedDays(src, el.id),
        confidential: r.confidential,
      };
    }),
    guardedAbsent: e.protected.length === 0 ? (everLived ? NONE : NEVER) : null,
    contested,
    contestedAbsent: contested.length === 0 ? (everLived ? NONE : NEVER) : null,
    chapters: journal,
    chaptersAbsent: journal.length === 0 ? (everLived ? NONE : NEVER) : null,
  };
}

/**
 * THE TWO LIVED DAYS — born, and last used.
 *
 * These are the row's metadata now, and the calendar date is not; it has moved
 * to the modal, where there is room to say what it means. The reason is a
 * measurement (design review, 2026-09-04): the identity panel rendered fifteen
 * rows of `learned 2026-09-04` under fifteen rows of `strength 1.00`, so two of
 * the three fields a reader could see never varied, and the panel read as a
 * table of one fact repeated. It was filed as a limitation of the demo store.
 * It was not: `learnedOn` is the day a row ENTERED this store, which in a store
 * built or migrated in one run is the same morning for everything in it, while
 * the lived days are what the physics actually ran on and they spread across
 * the whole month. The more interesting fact was already in the store and the
 * row was showing the other one.
 *
 * `lastUsedDay` is also the one that keeps moving: it is what "this is still
 * load-bearing" looks like as a number.
 */
function livedDays(src: DashboardSource, id: string): { bornDay: number; lastUsedDay: number } {
  try {
    const physics = src.store.physicsOf(id);
    return { bornDay: physics.birthDay, lastUsedDay: physics.lastUsedDay };
  } catch {
    return { bornDay: 0, lastUsedDay: 0 };
  }
}

function lastCycleDay(src: DashboardSource): number | null {
  let newest: number | null = null;
  for (const phase of CYCLE_PHASES) {
    const marker = readMarker(src.store, phase);
    if (marker.health === "torn" || marker.day === MARKER_UNSET) continue;
    newest = newest === null ? marker.day : Math.max(newest, marker.day);
  }
  return newest;
}

function contestedRows(src: DashboardSource): ContestedRow[] {
  const store = src.store;
  const out: ContestedRow[] = [];
  for (const [rootId] of contestedBeliefs(src)) {
    if (rootId === undefined) continue;
    let story;
    try {
      story = src.schemas.story(rootId);
    } catch {
      continue;
    }
    // UNFOLLOWED for the origin. `reveal` walks the supersede chain, so both
    // ends resolved to the SAME row and the page rendered "it began as X" and
    // "it now says X" as byte-identical strings — the one surface whose whole
    // job is to show a change showed none. The retained prose at the original
    // address is what "it began as" means, and `stories.ts` reads it the same
    // way for the same reason.
    const began = revealHere(store, rootId, FULL);
    const now = reveal(store, story.headId, FULL);
    const [beganShown, nowShown] = divergentPair(
      began.text ?? began.label,
      now.text ?? now.label,
    );
    let about = NONE;
    try {
      const entityId = store.readProse(story.headId).meta["entityId"];
      if (typeof entityId === "string") {
        const r = reveal(store, entityId, 60);
        about = r.text ?? r.label;
      }
    } catch {
      about = NONE;
    }
    out.push({
      id: rootId,
      headId: story.headId,
      about,
      began: beganShown,
      now: nowShown,
      beganFull: began.text ?? began.label,
      nowFull: now.text ?? now.label,
      pressure: story.pressure,
      bar: story.bar,
      fraction: story.bar > 0 ? Math.min(1.4, story.pressure / story.bar) : 0,
      revised: story.headId !== rootId,
      challenges: story.increments.length,
      lastChallengedDay: story.lastChallengedDay,
    });
  }
  return out.sort((a, b) => b.fraction - a.fraction || (a.id < b.id ? -1 : 1));
}

/** Wide enough that a statement is read whole before anything is cut. */
const FULL = 400;

/** `text`, cut to `width`, ending in an ellipsis so a cut is visible as one. */
function clipTo(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1).trimEnd()}…`;
}

/**
 * TWO VERSIONS OF ONE STATEMENT, SHOWN AROUND THE POINT THEY DIVERGE.
 *
 * A revision usually keeps most of its sentence — that is what makes it a
 * revision rather than a new belief — so truncating both from character zero
 * shows the identical prefix twice and cuts the change off the end. The window
 * starts a little before the first character that differs, on a word boundary,
 * with a leading ellipsis when it is not the start of the sentence.
 *
 * Two strings that really are identical come back identical; the caller decides
 * what to say about that (a belief whose successor says the same thing is a
 * fact worth reading, not a bug to hide).
 */
export function divergentPair(a: string, b: string, width = 150): [string, string] {
  if (a === b) return [clipTo(a, width), clipTo(b, width)];
  let i = 0;
  const shared = Math.min(a.length, b.length);
  while (i < shared && a[i] === b[i]) i += 1;
  let start = i;
  while (start > 0 && !/\s/.test(a[start - 1] ?? "")) start -= 1;
  // Enough lead-in that the changed clause has a subject, never so much that
  // the window is spent on text both versions share.
  const lead = Math.min(start, Math.floor(width / 3));
  const from = start - lead;
  const head = from > 0 ? "…" : "";
  return [`${head}${clipTo(a.slice(from), width)}`, `${head}${clipTo(b.slice(from), width)}`];
}

function chapters(src: DashboardSource, limit: number): ChapterRow[] {
  const store = src.store;
  const out: ChapterRow[] = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || !isJournal(row)) continue;
    try {
      const doc = store.readProse(id);
      const body = doc.body.trim();
      const opening = firstSentences(body, 260);
      out.push({
        id,
        title: doc.title ?? "an unnamed chapter",
        day: doc.bornDay,
        bytes: new TextEncoder().encode(body).length,
        opening,
      });
    } catch {
      out.push({ id, title: reveal(store, id, 60).label, day: 0, bytes: 0, opening: "" });
    }
  }
  return out.sort((a, b) => b.day - a.day || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

/** The first prose of a chapter, bounded. Headings skipped; never the whole entry. */
function firstSentences(body: string, max: number): string {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--"));
  const joined = lines.join(" ");
  return joined.length <= max ? joined : `${joined.slice(0, max).trimEnd()}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// memories
// ─────────────────────────────────────────────────────────────────────────────

export interface KindRow {
  readonly kind: Kind;
  readonly count: number;
  readonly meanStrength: number;
  readonly absent: string | null;
  readonly wSal: number;
  readonly wRep: number;
  readonly kappa: number;
  readonly iota: number;
  readonly gloss: string;
}

export interface HubRow {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly weight: number;
  readonly degree: number;
}

export interface MemoriesView {
  readonly day: number;
  readonly total: number;
  readonly points: MemoryLine[];
  readonly distribution: { from: number; to: number; count: number }[];
  readonly bands: BarRow[];
  readonly kinds: KindRow[];
  readonly hubs: HubRow[];
  readonly hubsAbsent: string | null;
  readonly pointsAbsent: string | null;
  readonly note: string;
}

const KIND_GLOSS: Record<Kind, string> = {
  self: "who I am — salience only, and the slowest to be argued out of",
  person: "someone I know — salience carries it, repetition does not",
  entity: "a thing in the world — both arms count",
  skill: "how to do something — repetition is nearly all of it, and it erodes slowest",
  place: "somewhere — repetition-driven, slow to erode",
  fact: "a plain fact — erodes fastest, and the cheapest to overturn",
};

export function memoriesView(src: DashboardSource, opts: { limit?: number } = {}): MemoriesView {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  const limit = opts.limit ?? 4000;
  const byKind = countMap<Kind>(rows, "kind");
  const byBand = countMap<Band>(rows, "band");
  const peak = Math.max(1, ...BANDS.map((b) => byBand.get(b) ?? 0));
  const everLived = day > 0 || rows.length > 0;

  const meanByKind = new Map<Kind, number[]>();
  for (const r of rows) {
    const list = meanByKind.get(r.kind) ?? [];
    list.push(r.strength);
    meanByKind.set(r.kind, list);
  }

  const buckets = 20;
  const distribution = Array.from({ length: buckets }, (_, i) => ({
    from: i / buckets,
    to: (i + 1) / buckets,
    count: 0,
  }));
  for (const r of rows) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor(r.strength * buckets)));
    const bucket = distribution[i];
    if (bucket !== undefined) bucket.count += 1;
  }

  return {
    day,
    total: rows.length,
    points: rows.slice(0, limit),
    pointsAbsent: rows.length === 0 ? (everLived ? NONE : NEVER) : null,
    distribution,
    bands: BANDS.map((b) => {
      const count = byBand.get(b) ?? 0;
      return { label: b, count, fraction: count / peak, note: BAND_GLOSS[b], absent: absenceFor(count, everLived) };
    }),
    kinds: KINDS.map((kind) => {
      const count = byKind.get(kind) ?? 0;
      const list = meanByKind.get(kind) ?? [];
      const tunables = PHYSICS.KINDS[kind];
      return {
        kind,
        count,
        meanStrength: list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length,
        absent: absenceFor(count, everLived),
        wSal: tunables.wSal,
        wRep: tunables.wRep,
        kappa: tunables.kappa,
        iota: tunables.iota,
        gloss: KIND_GLOSS[kind],
      };
    }),
    hubs: hubs(src, 15),
    hubsAbsent: hubs(src, 1).length === 0 ? (everLived ? NONE : NEVER) : null,
    note: "Every dot is one memory — or one of the beliefs and entities the schemas hold, which decay and consolidate the same way and are counted apart only where a headline says memories. How many lived days old across, how strong up, how much it mattered at encoding as its size. Colour is the band it is in today, computed now — not the band it was born into.",
  };
}

function hubs(src: DashboardSource, limit: number): HubRow[] {
  const store = src.store;
  const weight = new Map<string, { w: number; d: number }>();
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    for (const edge of store.edgesFrom(id)) {
      for (const end of [id, edge.dst]) {
        const cur = weight.get(end) ?? { w: 0, d: 0 };
        cur.w += edge.weight;
        cur.d += 1;
        weight.set(end, cur);
      }
    }
  }
  return [...weight.entries()]
    .sort((a, b) => b[1].w - a[1].w || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id, v]) => {
      const r = reveal(store, id, 72);
      return { id, text: r.text ?? r.label, confidential: r.confidential, weight: v.w, degree: v.d };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// one memory, opened
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryDetail {
  readonly found: boolean;
  readonly id: string;
  readonly headId: string | null;
  readonly askedFor: string | null;
  /**
   * True when this row is a JOURNAL entry rather than a memory. It matters on
   * an inspection surface: an episode is the source a memory was made from, it
   * sits outside every sleep phase, and the physics below it is recorded but
   * never acted on. Printing its strength without saying that would invite the
   * owner to read a number the engine ignores.
   */
  readonly journal: boolean;
  readonly title: string;
  readonly text: string;
  readonly confidential: boolean;
  /** The absolute path — what an editor needs, and what the copy button hands
   *  over (constitution line 6: the owner reads the store itself). */
  readonly prosePath: string;
  /**
   * The same file, said RELATIVE to the store — `prose/memories/mem_….md`.
   *
   * The absolute form is 150 characters of somebody's tmpdir and it was the
   * whole subtitle of the memory modal, which means it was in every screenshot
   * of the best surface in the product. What identifies a memory's file is its
   * place inside the store, and the machine it happens to be sitting on is not
   * part of that.
   */
  readonly prosePathShort: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly recordedBand: string;
  readonly strength: number;
  readonly salience: { relevance: number; emotional: number; predictive: number; novelty: number | null; claimed: number | null; combined: number };
  readonly repetition: number;
  readonly uses: number;
  readonly reinforcedDays: number;
  readonly bornDay: number;
  readonly lastUsedDay: number;
  readonly learnedOn: string;
  readonly happenedOn: string | null;
  readonly consolidated: boolean;
  readonly promoted: boolean;
  readonly protected: boolean;
  readonly pressure: number;
  readonly bar: number | null;
  readonly archived: string | null;
  readonly removal: { stage: string; actor: string; reason: string | null; at: number }[];
  readonly edges: { id: string; text: string; weight: number; confidential: boolean }[];
  readonly points: { role: string; id: string; text: string }[];
  readonly versions: { seq: number; reason: string; day: number; became: string }[];
  readonly prospective: { date: string; state: string; fires: number; precision: string }[];
  readonly absence: string | null;
}

export function memoryDetail(src: DashboardSource, id: string): MemoryDetail {
  const store = src.store;
  const day = store.livedDay();
  const r = reveal(store, id, 120);
  const empty = {
    found: false,
    id,
    headId: r.headId,
    askedFor: null,
    journal: false,
    title: "",
    text: "",
    confidential: false,
    prosePath: "",
    prosePathShort: "",
    kind: "fact" as Kind,
    band: "episodic" as Band,
    recordedBand: "—",
    strength: 0,
    salience: { relevance: 0, emotional: 0, predictive: 0, novelty: null, claimed: null, combined: 0 },
    repetition: 0,
    uses: 0,
    reinforcedDays: 0,
    bornDay: 0,
    lastUsedDay: 0,
    learnedOn: "—",
    happenedOn: null,
    consolidated: false,
    promoted: false,
    protected: false,
    pressure: 0,
    bar: null,
    archived: null,
    removal: store.removalRecord(id).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: [],
    points: [],
    versions: [],
    prospective: [],
    absence: r.label,
  } satisfies MemoryDetail;

  if (!r.present || r.headId === null) return empty;
  const headId = r.headId;
  let doc;
  let row;
  let physics;
  try {
    doc = store.readProse(headId);
    row = store.row(headId);
    physics = store.physicsOf(headId);
  } catch {
    return empty;
  }
  const g = gistOfDoc(doc, 120);

  const points: { role: string; id: string; text: string }[] = [];
  const push = (role: string, target: unknown): void => {
    if (typeof target !== "string") return;
    const rr = reveal(store, target, 80);
    points.push({ role, id: target, text: rr.text ?? rr.label });
  };
  if (row?.superseded_by !== null && row?.superseded_by !== undefined) push("became", row.superseded_by);
  push("hangs on", doc.meta["entityId"]);
  push("revised", doc.meta["updates"]);
  const grounded = doc.meta["groundedIn"];
  if (Array.isArray(grounded)) for (const gid of grounded) push("grounded in", gid);

  return {
    found: true,
    id: headId,
    headId,
    askedFor: headId === id ? null : id,
    journal: row === undefined ? false : isJournal(row),
    title: doc.title ?? "",
    // The BODY is the memory, and this is the owner's own window onto their own
    // store (constitution line 6). A confidential body is the one exception, and
    // it is withheld here exactly as it is withheld in recall.
    text: g.confidential ? WITHHELD : doc.body.trim(),
    confidential: g.confidential,
    prosePath: row?.prose_path ?? "—",
    prosePathShort: relativeToStore(store.dir, row?.prose_path ?? ""),
    kind: physics.kind,
    band: band(physics, day),
    recordedBand: `${row?.band ?? "—"} (set day ${row?.band_day ?? "—"})`,
    strength: strength(physics, day),
    salience: {
      relevance: physics.salience.relevance,
      emotional: physics.salience.emotional,
      predictive: physics.salience.predictive,
      novelty: physics.salience.novelty,
      claimed: physics.salience.claimed ?? null,
      combined: sal(physics.salience),
    },
    repetition: rep(physics),
    uses: physics.uses,
    reinforcedDays: physics.reinforcedDays ?? 0,
    bornDay: physics.birthDay,
    lastUsedDay: physics.lastUsedDay,
    learnedOn: doc.learnedOn,
    happenedOn: doc.happenedOn ?? null,
    consolidated: physics.consolidated === true,
    promoted: physics.promotedIdentity === true,
    protected: physics.protected === true,
    pressure: physics.pressure,
    bar: physics.pressure > 0 ? barFor(src, headId) : null,
    archived: row?.archived === 1 ? (row.archived_reason ?? "archived") : null,
    removal: store.removalRecord(headId).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: store.edgesFrom(headId).map((edge) => {
      const rr = reveal(store, edge.dst, 72);
      return { id: edge.dst, text: rr.text ?? rr.label, weight: edge.weight, confidential: rr.confidential };
    }),
    points,
    versions: store.versions(headId).map((v) => ({
      seq: v.seq,
      reason: v.reason,
      day: v.version_day,
      became: v.successor_id === null ? "revised in place" : (reveal(store, v.successor_id, 72).label),
    })),
    prospective: store.prospectiveFor(headId).map((p) => ({
      date: p.event_date,
      state: p.state,
      fires: p.fires,
      precision: p.precision,
    })),
    absence: null,
  };
}

/** Strip the store's own directory off the front of a path inside it. */
export function relativeToStore(dir: string, path: string): string {
  if (path.length === 0) return "—";
  const root = dir.replace(/\/+$/, "");
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function barFor(src: DashboardSource, id: string): number | null {
  try {
    return src.schemas.story(id).bar;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// search
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchView {
  readonly q: string;
  readonly hits: { id: string; score: number; text: string; kind: Kind; band: Band; strength: number; confidential: boolean }[];
  readonly absent: string | null;
}

export function searchView(src: DashboardSource, q: string, limit = 25): SearchView {
  const store = src.store;
  const day = store.livedDay();
  const query = q.trim();
  if (query.length === 0) return { q: "", hits: [], absent: NEVER };
  let raw: { id: string; score: number }[];
  try {
    raw = store.search(query, limit * 2);
  } catch {
    return { q: query, hits: [], absent: NONE };
  }
  const hits: SearchView["hits"] = [];
  for (const hit of raw) {
    const row = store.row(hit.id);
    // The journal is searchable in the owner's editor; it is not a memory here.
    if (row === undefined || isJournal(row)) continue;
    const r = reveal(store, hit.id, 100);
    let s = 0;
    let b: Band = row.band;
    try {
      const physics = store.physicsOf(hit.id);
      s = strength(physics, day);
      b = band(physics, day);
    } catch {
      /* a row that will not read is still a hit; it lists with a named absence */
    }
    hits.push({
      id: hit.id,
      score: hit.score,
      text: r.text ?? r.label,
      kind: row.kind,
      band: b,
      strength: s,
      confidential: r.confidential,
    });
    if (hits.length >= limit) break;
  }
  return { q: query, hits, absent: hits.length === 0 ? NONE : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// mind — identity, the briefing, the journal, the revision stories
// ─────────────────────────────────────────────────────────────────────────────

export interface WakeLane {
  /** The lane's own heading, as the briefing writes it. */
  readonly heading: string;
  /** The lane name, when this is one of `self/`'s lanes; null for the preface. */
  readonly lane: string | null;
  /** One element per line, bullets stripped. Verbatim otherwise. */
  readonly items: string[];
}

export interface StoryBeat {
  readonly day: number;
  readonly challenger: string;
  readonly force: number;
  readonly pressureAfter: number;
  readonly bar: number;
  readonly fraction: number;
  /** One clause, in prose. Never an id: an id in a sentence is a leak. */
  readonly verdict: string;
  /** What it became, when it became something — as words, resolved now. */
  readonly became: string | null;
  /** The successor's address, for a link. Kept OUT of `verdict`. */
  readonly becameId: string | null;
  readonly crossed: boolean;
}

export interface StoryView extends ContestedRow {
  readonly beats: StoryBeat[];
  readonly beatsAbsent: string | null;
}

export interface MindView {
  readonly opening: string;
  readonly identity: { id: string; text: string; kind: Kind; band: Band; strength: number; bytes: number; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly identityAbsent: string | null;
  readonly guarded: { id: string; text: string; kind: Kind; band: Band; strength: number; bytes: number; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly guardedAbsent: string | null;
  readonly both: string[];
  readonly protectedOutsideIdentity: { id: string; text: string }[];
  readonly unreadable: { id: string; label: string }[];
  readonly wake: {
    readonly ok: boolean;
    readonly reason: string;
    readonly bytes: number;
    readonly preface: string | null;
    readonly lanes: WakeLane[];
    readonly absent: string | null;
  };
  readonly chapters: ChapterRow[];
  readonly chaptersAbsent: string | null;
  readonly stories: StoryView[];
  readonly storiesAbsent: string | null;
}

export function mindView(src: DashboardSource): MindView {
  const store = src.store;
  const day = store.livedDay();
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const everLived = day > 0 || store.list().length > 0;
  const seen = new Set(e.identity.map((el) => el.id));
  const unreadable = store
    .list({ band: "identity", archived: false })
    .filter((id) => !seen.has(id))
    .map((id) => ({ id, label: reveal(store, id, 72).label }));

  const shape = (el: { id: string; kind: Kind; band: Band; strength: number; bytes: number }): MindView["identity"][number] => {
    const r = reveal(store, el.id, 120);
    return {
      id: el.id,
      text: r.text ?? r.label,
      kind: el.kind,
      band: el.band,
      strength: el.strength,
      bytes: el.bytes,
      ...livedDays(src, el.id),
      confidential: r.confidential,
    };
  };

  return {
    opening:
      `On lived day ${day} I hold ${e.identity.length} ${e.identity.length === 1 ? "element" : "elements"} in the identity band and ` +
      `${e.protected.length} under protection. The first is what repetition and salience earned, and physics can still move it; ` +
      "the second is ink no revision path reaches — including a revision that would be right.",
    identity: e.identity.map(shape),
    identityAbsent: e.identity.length === 0 ? (everLived ? NONE : NEVER) : null,
    guarded: e.protected.map(shape),
    guardedAbsent: e.protected.length === 0 ? (everLived ? NONE : NEVER) : null,
    both: e.both,
    protectedOutsideIdentity: e.protectedOutsideIdentity.map((id) => {
      const r = reveal(store, id, 90);
      return { id, text: r.text ?? r.label };
    }),
    unreadable,
    wake: {
      ok: wake.ok,
      reason: wake.reason,
      bytes: wake.bytes,
      preface: wake.preface,
      lanes: wake.ok ? wakeLanes(wake.text) : [],
      absent: wake.ok ? null : everLived ? NONE : NEVER,
    },
    chapters: chapters(src, 12),
    chaptersAbsent: chapters(src, 1).length === 0 ? (everLived ? NONE : NEVER) : null,
    stories: storyViews(src),
    storiesAbsent: contestedRows(src).length === 0 ? (everLived ? NONE : NEVER) : null,
  };
}

/**
 * The briefing as it actually renders, split at its own lane headings.
 *
 * This is the one place the dashboard shows composed TEXT rather than a shape,
 * and it is deliberate: the wake bundle is what the next session will read, so
 * "what would I say on waking" is unanswerable from a byte count. Nothing is
 * persisted — the bundle is read from the store at request time like every other
 * value on the page, and its own trailing sentinel comment is dropped because it
 * is bookkeeping, not something the assistant says.
 */
export function wakeLanes(text: string): WakeLane[] {
  // The lane names and their headings are TAKEN FROM `self/` — `LANE_ORDER` and
  // `FRAMING` — never retyped here. A renamed lane heading would otherwise leave
  // this splitter silently returning one enormous lane called "the preface",
  // which is precisely the quiet-wrong-answer shape the registries exist against.
  const headings = new Map<string, string>();
  for (const lane of LANE_ORDER) headings.set(FRAMING[lane], lane);

  const lanes: { heading: string; lane: string | null; items: string[] }[] = [];
  let current: { heading: string; lane: string | null; items: string[] } = {
    heading: "How this arrives",
    lane: null,
    items: [],
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // The sentinel is bookkeeping, not something the assistant says.
    if (line.startsWith("<!--")) continue;
    if (line.length === 0) continue;
    const lane = headings.get(line);
    // A markdown heading counts too, so a future briefing that uses one still
    // splits rather than collapsing into a single block.
    const mdHeading = /^#{1,6}\s+(.*)$/.exec(line);
    if (lane !== undefined || mdHeading !== null) {
      if (current.items.length > 0) lanes.push(current);
      current = {
        heading: lane === undefined ? (mdHeading?.[1] ?? line) : line,
        lane: lane ?? null,
        items: [],
      };
      continue;
    }
    current.items.push(line.replace(/^[-*]\s+/, ""));
  }
  if (current.items.length > 0) lanes.push(current);
  return lanes;
}

function storyViews(src: DashboardSource): StoryView[] {
  const store = src.store;
  return contestedRows(src).map((row) => {
    let story;
    try {
      story = src.schemas.story(row.id);
    } catch {
      return { ...row, beats: [], beatsAbsent: NONE };
    }

    const beats: StoryBeat[] = story.increments
      .slice()
      .sort((a, b) => a.day - b.day)
      .map((inc) => {
        const crossed = inc.pressureAfter >= inc.bar;
        const step = story.lineage.find((l) => l.id === inc.targetId && l.successorId !== null);
        const successorId = crossed ? (step?.successorId ?? null) : null;
        const became = successorId === null ? null : reveal(store, successorId, 96).text;
        // The verdict is a CLAUSE, and the numbers it is about are already in
        // their own fields: "0.598 of 0.470" beside the word REVISED read as a
        // numerator larger than its denominator with nothing saying that is
        // exactly what clearing a bar looks like.
        const verdict = crossed
          ? step === undefined || step.successorId === null
            ? "it cleared the bar — but I find no supersession recorded"
            : "it cleared the bar, and I changed my mind"
          : "under the bar — held";
        const c = reveal(store, inc.challengerId, 72);
        return {
          day: inc.day,
          challenger: c.text ?? c.label,
          force: inc.force,
          pressureAfter: inc.pressureAfter,
          bar: inc.bar,
          fraction: inc.bar > 0 ? Math.min(1.3, inc.pressureAfter / inc.bar) : 0,
          verdict,
          became,
          becameId: successorId,
          crossed,
        };
      });
    return {
      ...row,
      beats,
      beatsAbsent:
        beats.length === 0
          ? "(none yet) — this belief carries pressure but I hold no credited challenge for it: the increments predate the durable log, or were swept."
          : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// activity
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityView {
  readonly events: NarratedEvent[];
  readonly total: number;
  readonly lastSeq: number;
  readonly retentionDays: number;
  readonly bound: string;
  readonly absent: string | null;
  readonly vocabulary: { name: DurableEventName; count: number; description: string; absent: string | null; node: string | null }[];
}

export function activityView(
  src: DashboardSource,
  opts: { limit?: number; name?: string; sinceSeq?: number } = {},
): ActivityView {
  const store = src.store;
  const limit = opts.limit ?? FEED_LIMIT;
  const filter: { name?: string; limit: number } = { limit: LOG_CEILING };
  if (opts.name !== undefined && opts.name.length > 0) filter.name = opts.name;
  const all = store.eventLog(filter);
  const since = opts.sinceSeq;
  const window = since === undefined ? all.slice(-limit).reverse() : all.filter((r) => r.seq > since);
  const events = window.map((row) => narrate(store, row));
  const lastSeq = all.length === 0 ? 0 : (all[all.length - 1]?.seq ?? 0);
  const everLived = store.livedDay() > 0 || store.list().length > 0;

  return {
    events,
    total: all.length,
    lastSeq,
    retentionDays: store.retentionDays,
    bound:
      `I keep events for ${store.retentionDays} lived days; older ones are swept unless a replay latch holds them. ` +
      "This is what I still have, not everything that ever happened.",
    absent: events.length === 0 ? (everLived ? NONE : NEVER) : null,
    vocabulary: DURABLE_EVENT_NAMES.map((name) => {
      const count = eventsNamed(src, name);
      return {
        name,
        count,
        description: DURABLE_EVENTS[name],
        absent: count === 0 ? NEVER : null,
        node: (FLOW_NODES.find((nd) => eventsOfNode(nd.key).includes(name))?.key ?? null),
      };
    }),
  };
}

export function eventDetail(src: DashboardSource, seq: number): { found: boolean; event: NarratedEvent | null } {
  const store = src.store;
  for (const row of store.eventLog({ limit: LOG_CEILING })) {
    if (row.seq === seq) return { found: true, event: narrate(store, row) };
  }
  return { found: false, event: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// flow
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowNodeState {
  readonly key: NodeKey;
  readonly label: string;
  readonly sub: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly accent: string;
  /** How many durable events this node has ever recorded, in the kept window. */
  readonly count: number;
  /** The honest state line drawn inside the box. */
  readonly state: string;
  /** True when the log has never carried a single event for this node. */
  readonly silent: boolean;
}

export interface FlowView {
  readonly nodes: FlowNodeState[];
  readonly edges: typeof FLOW_EDGES;
  readonly lastSeq: number;
  readonly feed: NarratedEvent[];
  readonly note: string;
}

export function flowView(src: DashboardSource, feedLimit = 24): FlowView {
  const store = src.store;
  // MEMORIES, not every row: the STORE node says "N memories held" and the
  // overview's tile says the same words, so they had better be the same number.
  const rows = census(src).filter((r) => !r.schema);
  const day = store.livedDay();
  const activity = activityView(src, { limit: feedLimit });
  const counts = new Map<NodeKey, number>();
  for (const v of activity.vocabulary) {
    if (v.node === null) continue;
    counts.set(v.node as NodeKey, (counts.get(v.node as NodeKey) ?? 0) + v.count);
  }

  const nodes: FlowNodeState[] = FLOW_NODES.map((node) => {
    const count = counts.get(node.key) ?? 0;
    const silent = eventsOfNode(node.key).length === 0 || count === 0;
    return {
      key: node.key,
      label: node.label,
      sub: node.sub,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      accent: node.accent,
      count,
      state: nodeState(src, node.key, count, rows.length, day),
      silent,
    };
  });

  return {
    nodes,
    edges: FLOW_EDGES,
    lastSeq: activity.lastSeq,
    feed: activity.events,
    note: "Only particles mean activity. A still diagram is a still machine — nothing here drifts for decoration.",
  };
}

/** The one line inside a node's box: its own state, or the honest absence. */
function nodeState(src: DashboardSource, key: NodeKey, count: number, memories: number, day: number): string {
  const store = src.store;
  switch (key) {
    case "store":
      return memories === 0 ? NONE : `${memories} memories held`;
    case "physics":
      return day === 0 ? NEVER : `day ${day} on the clock`;
    case "associate": {
      let edges = 0;
      for (const id of store.list({ archived: false })) edges += store.edgesFrom(id).length;
      return edges === 0 ? NONE : `${edges} directed edges`;
    }
    case "prospective": {
      let armed = 0;
      let fired = 0;
      for (const id of store.list({ archived: false })) {
        for (const p of store.prospectiveFor(id)) {
          if (p.state === "fired") fired += 1;
          else armed += 1;
        }
      }
      return armed + fired === 0 ? NONE : `${armed} waiting · ${fired} fired`;
    }
    case "self": {
      const e = src.self.enumerate(day);
      return e.identity.length === 0 && e.protected.length === 0
        ? NONE
        : `${e.identity.length} in the band · ${e.protected.length} permanent`;
    }
    case "wake": {
      const wake = src.self.wake();
      return wake.ok ? `${wake.bytes} bytes waiting` : NEVER;
    }
    case "schemas": {
      const entities = src.schemas.entities().length;
      return entities === 0 ? NONE : `${entities} entities`;
    }
    case "spans":
      // Turn capture writes no durable event; see NO_EVENT_OF_ITS_OWN. On a
      // store that has never lived a day the honest word is still `(never run)`
      // — "silent by design" would claim a design decision was exercised.
      return day === 0 ? NEVER : "silent by design";
    case "session": {
      const sessions = new Set<string>();
      for (const name of eventsOfNode("session")) {
        for (const row of store.eventLog({ name, limit: LOG_CEILING })) if (row.ref !== null) sessions.add(row.ref);
      }
      // The surfacing log names its session, so a store whose host wrote no
      // boundary rows can still say how many conversations it has seen.
      for (const row of store.eventLog({ name: "recall.decision", limit: LOG_CEILING })) {
        if (row.ref !== null) sessions.add(row.ref);
      }
      return sessions.size === 0 ? (day === 0 ? NEVER : NONE) : `${sessions.size} sessions seen`;
    }
    case "remember":
      // The door's own record is the ask's pacing row, which only a HOST
      // writes. What the door actually did is the count that came through it.
      return memories === 0 ? (day === 0 ? NEVER : NONE) : `${memories} came through`;
    case "encode":
      // NEITHER ABSENCE WORD IS TRUE HERE once anything is in the store: the
      // battery ran on every one of those memories. `(never run)` beside
      // STORE's `143 memories held` was a contradiction on the face of the
      // diagram. Both doors record now (`gate.chunk`, `gate.deposit`), so the
      // ordinary answer is a count — but a store holding memories that PREDATE
      // the gate log, or that were seeded around the door, still has none, and
      // that state gets its own sentence rather than a zero.
      if (count > 0) return `${count} recorded`;
      if (memories > 0) return `${memories} passed · no gate record for them`;
      return day === 0 ? NEVER : NONE;
    default:
      return count === 0 ? NEVER : `${count} recorded`;
  }
}

export interface NodeDetailView {
  readonly found: boolean;
  readonly key: string;
  readonly label: string;
  readonly what: string;
  readonly analog: string;
  readonly breaks: string;
  readonly eventNames: string[];
  readonly noEventOfItsOwn: string | null;
  /** Work that is real and deliberately unrecorded. See `UNLOGGED_PATH`. */
  readonly unloggedPath: string | null;
  readonly recent: NarratedEvent[];
  readonly recentAbsent: string | null;
  readonly state: string;
}

export function nodeDetail(src: DashboardSource, key: string, limit = 8): NodeDetailView {
  const node = findNode(key);
  if (node === undefined) {
    return {
      found: false,
      key,
      label: "",
      what: "",
      analog: "",
      breaks: "",
      eventNames: [],
      noEventOfItsOwn: null,
      unloggedPath: null,
      recent: [],
      recentAbsent: NEVER,
      state: "",
    };
  }
  const store = src.store;
  const names = eventsOfNode(node.key);
  const rows = [];
  for (const name of names) rows.push(...store.eventLog({ name, limit: LOG_CEILING }));
  rows.sort((a, b) => a.seq - b.seq);
  const recent = rows.slice(-limit).reverse().map((row) => narrate(store, row));
  const everLived = store.livedDay() > 0 || store.list().length > 0;
  return {
    found: true,
    key: node.key,
    label: node.label,
    what: node.what,
    analog: node.analog,
    breaks: node.breaks,
    eventNames: names,
    noEventOfItsOwn: NO_EVENT_OF_ITS_OWN[node.key] ?? null,
    unloggedPath: UNLOGGED_PATH[node.key] ?? null,
    recent,
    recentAbsent: recent.length === 0 ? (names.length === 0 ? null : everLived ? NONE : NEVER) : null,
    state: nodeState(src, node.key, rows.length, memoriesHeld(src), store.livedDay()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// health
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthView {
  readonly phases: { phase: string; day: number | null; ago: number | null; torn: boolean; absent: string | null }[];
  readonly symmetry: { kind: Kind; up: number; down: number; reason: string; ok: boolean }[];
  readonly exits: { reason: string; count: number; gloss: string; absent: string | null }[];
  /**
   * ONE TABLE, LED BY ENGLISH. There were two — "what a host told me" over the
   * eleven `adapter.*` names, and "everything I can record durably" over all
   * nineteen — so seven identifiers were listed twice on one screen with
   * near-duplicate glosses, and the first thing the health tab showed a person
   * was 23 dotted names against a column of `(never run)` (design review,
   * 2026-09-04, §9 and ranked #4). The gloss each row already carried in its
   * third column now LEADS it and the dotted name is the second line, which is
   * the order a reader needs them in: what this records, then what it is
   * called. `adapter` says whether a host wrote it or the machinery did — the
   * only thing the split table was really saying — and `note` carries the
   * adapter-specific caveat the old table had room for.
   */
  readonly records: {
    name: DurableEventName;
    gloss: string;
    count: number;
    absent: string | null;
    adapter: boolean;
    note: string | null;
  }[];
  readonly heatmap: { days: number[]; names: string[]; cells: { day: number; name: string; count: number }[] };
  readonly removals: { id: string; label: string; stage: string; actor: string; reason: string | null; at: number }[];
  readonly removalsAbsent: string | null;
  readonly blind: readonly { readonly what: string; readonly why: string }[];
}

/** The events an ADAPTER writes — the only ones that can tell the owner what a
 *  host actually did with what was composed for it. */
const ADAPTER_EVENTS: readonly DurableEventName[] = [
  "adapter.ask",
  "adapter.boundary",
  "adapter.recall",
  "adapter.wake.injected",
  "adapter.wake.delivered",
  "adapter.primacy.deliver",
  "adapter.primacy.standdown",
  "adapter.embed.backfill",
  "adapter.semantic.lag",
  "adapter.authorship.ask",
  "adapter.episode.ask",
];

const ADAPTER_NOTE: Partial<Record<DurableEventName, string>> = {
  "adapter.wake.injected": "bytes handed to the host, never the text",
  "adapter.wake.delivered": "whether the briefing was actually seen the next turn",
  "adapter.recall": "how long recall took, when the adapter recorded it",
  "adapter.ask": "asked, paced out, or capped for the day",
  "adapter.authorship.ask": "historical — nothing writes this now",
  "adapter.episode.ask": "historical — nothing writes this now",
};

export function healthView(src: DashboardSource): HealthView {
  const store = src.store;
  const day = store.livedDay();
  const everLived = day > 0 || store.list().length > 0;

  const phases = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(store, phase);
    if (marker.health === "torn") {
      return { phase, day: null, ago: null, torn: true, absent: "torn marker" };
    }
    if (marker.day === MARKER_UNSET) return { phase, day: null, ago: null, torn: false, absent: NEVER };
    return { phase, day: marker.day, ago: Math.max(0, day - marker.day), torn: false, absent: null };
  });

  const transitions = store.eventLog({ name: "band.transition", limit: LOG_CEILING });
  const symmetry = KINDS.map((kind) => {
    let up = 0;
    let down = 0;
    for (const row of transitions) {
      if (row.payload === null) continue;
      try {
        const p = JSON.parse(row.payload) as { kind?: string; direction?: string };
        if (p.kind !== kind) continue;
        if (p.direction === "up") up += 1;
        else if (p.direction === "down") down += 1;
      } catch {
        continue;
      }
    }
    const verdict = symmetryCheck(kind, { up, down });
    return { kind, up, down, reason: verdict.reason, ok: verdict.reason === "within-expectation" };
  });

  const exitCounts = new Map<string, number>();
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || row.archived !== 1) continue;
    const reason = row.archived_reason ?? "no reason recorded";
    exitCounts.set(reason, (exitCounts.get(reason) ?? 0) + 1);
  }
  const namedExits: [string, string][] = [
    [PRUNE_ARCHIVE_REASON, "let go at the floor — real forgetting, on physics' verdict alone"],
    [MERGE_ARCHIVE_REASON, "merged into a duplicate I already held"],
    [SCHEMA_TUNABLES.FADE_REASON, "faded out of my vocabulary"],
  ];
  const exits = namedExits.map(([reason, gloss]) => {
    const count = exitCounts.get(reason) ?? 0;
    return { reason, count, gloss, absent: absenceFor(count, everLived) };
  });
  for (const [reason, count] of exitCounts) {
    if (namedExits.some(([r]) => r === reason)) continue;
    exits.push({ reason, count, gloss: "recorded by whatever archived it", absent: null });
  }

  // The merged record table. Every durable name appears exactly once — the
  // totality rule is unchanged, and the test still walks `DURABLE_EVENT_NAMES`
  // against it — but what HAS happened is ordered above what never has, so the
  // first screen of this tab is the log's actual contents rather than eleven
  // adapter names nobody has ever run. The order is stated on the page.
  const records = DURABLE_EVENT_NAMES.map((name) => {
    const count = eventsNamed(src, name);
    const adapter = ADAPTER_EVENTS.includes(name);
    return {
      name,
      gloss: DURABLE_EVENTS[name],
      count,
      absent: count === 0 ? NEVER : null,
      adapter,
      note: adapter ? (ADAPTER_NOTE[name] ?? "counts and reasons; never text") : null,
    };
  }).sort((a, b) => (b.count === a.count ? 0 : b.count - a.count));

  // The heatmap: lived day × event name. Bounded to the last 21 lived days so a
  // long-lived store still fits on a screen without a scrollbar in two axes.
  const span = 21;
  const from = Math.max(0, day - span + 1);
  const days = Array.from({ length: Math.max(1, Math.min(span, day + 1)) }, (_, i) => from + i);
  const cells: { day: number; name: string; count: number }[] = [];
  for (const name of DURABLE_EVENT_NAMES) {
    const rows = store.eventLog({ name, sinceDay: from, limit: LOG_CEILING });
    const per = new Map<number, number>();
    for (const row of rows) per.set(row.day, (per.get(row.day) ?? 0) + 1);
    for (const d of days) cells.push({ day: d, name, count: per.get(d) ?? 0 });
  }

  const removals = store.removalRecord().map((x) => ({
    id: x.memory_id,
    label: reveal(store, x.memory_id, 72).label,
    stage: x.stage,
    actor: x.actor,
    reason: x.reason,
    at: x.at,
  }));

  return {
    phases,
    symmetry,
    exits,
    records,
    heatmap: { days, names: [...DURABLE_EVENT_NAMES], cells },
    removals,
    removalsAbsent: removals.length === 0 ? (everLived ? NONE : NEVER) : null,
    blind: BLIND_SPOTS,
  };
}

/**
 * WHAT I CANNOT SEE — the named absences, in the shape the terminal `status`
 * view established: a number I do not durably hold is stated as a number I do
 * not hold, never invented to fill a panel. Every line here is a real gap, and
 * three of them are filed in `INTERFACE-GAPS.md`.
 */
export const BLIND_SPOTS: readonly { readonly what: string; readonly why: string }[] = [
  {
    what: "What one cycle did.",
    why: "There is no durable per-cycle outcome record — the report goes back to its caller and is gone. What survives is each phase's completion marker and each row's archived-with-reason state, so every exit count on this page is SINCE BIRTH, never 'this cycle'.",
  },
  {
    what: "A protected element I can no longer read.",
    why: "Protection is a flag on the row whose physics stopped reading, so a removed protected element simply leaves the list. The identity band is queryable and that half is recovered above; this half is not (INTERFACE-GAPS §3).",
  },
  {
    what: "Recall latency, unless an adapter recorded it.",
    why: "The core times its own surfacing race and reports it in the decision row. A turn whose adapter wrote no `adapter.recall` leaves no latency behind at all.",
  },
  {
    what: "Anything older than the retention window.",
    why: "The event log is bounded telemetry, not canonical memory. Rows past the window are swept unless a replay latch holds them, so every count on this page is 'what I still have', not 'what ever happened'.",
  },
  {
    what: "Whether a memory was ever actually useful to you.",
    why: "I record that the reply used it, which is the closest thing I have. Whether it helped is a judgement only you can make, and nothing here should be read as evidence of it.",
  },
  {
    what: "Anything a host did not tell me.",
    why: "The wake bundle's arrival, the ask's outcome, the bytes injected — all of it reaches me only if the adapter wrote a row. Silence on this page is sometimes the adapter's silence, not the machine's.",
  },
];

/** Everything the terminal views print, as one number each — the JSON the app's
 *  header badge reads without pulling a whole page. */
export function pulse(src: DashboardSource): { day: number; memories: number; events: number; lastSeq: number } {
  const activity = activityView(src, { limit: 1 });
  return {
    day: src.store.livedDay(),
    memories: memoriesHeld(src),
    events: activity.total,
    lastSeq: activity.lastSeq,
  };
}

export { census };
export { num };
