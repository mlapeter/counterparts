/**
 * `/api/mind` — identity, the briefing, the journal, the revision stories.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { TUNABLES as PHYSICS, kindPhysics, promotionEligibility, sal } from "../../../../core/physics/index.js";
import { isConfidential } from "../../../../core/recall/index.js";
import {
  FRAMING,
  LANE_ORDER,
  SELF_PAGE_REVISED_EVENT,
  chapterModels,
  pageSections,
  readChapterLead,
} from "../../../../core/self/index.js";
import type { PageVersion } from "../../../../core/self/index.js";
import { TUNABLES as SLEEP, isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { WITHHELD, reveal } from "../reveal.js";
import { chapters, contestedRows, livedDays } from "./rows.js";
import type { ChapterRow, ContestedRow } from "./rows.js";

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
  /**
   * THE WRITTEN PAGE, and what it used to say (2026-09-18, S1). Read-only, like
   * everything else here: the dashboard shows the page and its versions and
   * offers no door to write one — the doors are the MCP tool and the console.
   *
   * The BODIES ride along; the self tab draws them as a timeline and diffs
   * neighbouring versions in the browser (`pages/self/diff.js`).
   */
  readonly page: {
    readonly present: boolean;
    readonly body: string;
    readonly bytes: number;
    readonly revisedOn: string;
    readonly by: string | null;
    readonly reason: string | null;
    readonly version: number;
    readonly stale: boolean;
    readonly core: string;
    readonly lately: string;
    readonly headed: boolean;
  } | null;
  /** The honest absence line when no page has been written. */
  readonly pageAbsent: string | null;
  /** Each body labelled with the write that PRODUCED it, and with what replaced
   *  it named separately — `store.revise` stores the replacing reason on the row
   *  it archives, so the two must not share a word (adversarial review M3). */
  readonly pageVersions: PageVersion[];
  readonly chapters: ChapterRow[];
  readonly chaptersAbsent: string | null;
  readonly stories: StoryView[];
  readonly storiesAbsent: string | null;
  /** The page's whole life, OLDEST first, the standing page last. */
  readonly pageHistory: PageStep[];
  /** What is settling into the core, and what is closest to it. */
  readonly settling: SettlingView;
  /** The published wake cut into its parts, in the order it reads. */
  readonly wakeParts: WakePart[];
  /** The ceiling the last render was composed to; null when no render recorded one. */
  readonly wakeBudget: number | null;
  /** The journal by lived day, newest first. */
  readonly journal: JournalDay[];
  readonly journalAbsent: string | null;
  /** Chapters past the ones sent. 0 when all of them are here. */
  readonly journalMore: number;
}

/** One state of the page: an archived version, or the one standing now. */
export interface PageStep {
  /** 1-based, oldest first — the number a person would count. */
  readonly n: number;
  /** The store's version seq; for the standing page, its `version` + 1. */
  readonly seq: number;
  readonly current: boolean;
  readonly day: number | null;
  /** Calendar date of the write that produced it (the durable row's clock); null when unrecorded. */
  readonly date: string | null;
  readonly by: string | null;
  readonly reason: string | null;
  readonly body: string | null;
  readonly bytes: number | null;
}

export interface Candidate {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly kind: Kind;
  /** What the memory has earned (`physics#base`), and the bar it must reach. */
  readonly base: number;
  readonly threshold: number;
  /** True when consolidation's one-time bonus is already in `base`. */
  readonly consolidated: boolean;
  readonly bonus: number;
  /** Distinct lived days a use was credited, and how many the rule needs. */
  readonly days: number;
  readonly requiredDays: number;
  /** Both conditions met: the next consolidation pass crosses it. */
  readonly eligible: boolean;
}

export interface SettlingRow {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly kind: Kind;
}

export interface SettlingView {
  /** The identity band — the core. */
  readonly core: SettlingRow[];
  /** Protected (permanent) rows. */
  readonly guarded: SettlingRow[];
  /** Beliefs under challenge, or already revised. */
  readonly contested: { id: string; about: string; now: string; revised: boolean; fraction: number; pressure: number; bar: number }[];
  /** Permanent rows that do not stand in the band. */
  readonly outside: SettlingRow[];
  /** Identity-band rows that would not read. Shown whenever there are any. */
  readonly unreadable: { id: string; label: string }[];
  /** The closest candidates, closest first. */
  readonly candidates: Candidate[];
  /** Memories that could reach the core by use and have at least one credited day. */
  readonly onTheWay: number;
  /** Memories that could reach it but have never been used on a later day. */
  readonly unused: number;
  /** Memories whose score and kind put the core out of reach by use alone. */
  readonly outOfReach: number;
  /** The rule, as numbers, so the page states it rather than restating it. */
  readonly rule: { threshold: number; days: number; everyDays: number; repCap: number; bonus: number };
  /** Two-word absences, for each list that is empty. */
  readonly coreAbsent: string | null;
  readonly guardedAbsent: string | null;
  readonly contestedAbsent: string | null;
}

export interface WakePart {
  readonly label: string;
  /** The lane name, "page", "furniture" — a stable key for colour. */
  readonly key: string;
  readonly bytes: number;
}

export interface JournalChapter {
  readonly id: string;
  /** The chapter number inside its session's entry. */
  readonly chapter: number;
  readonly title: string;
  readonly model: string | null;
  readonly first: string;
  /** The chapter's own text, headings off. Null when withheld. */
  readonly text: string | null;
  readonly bytes: number;
  readonly confidential: boolean;
}

export interface JournalDay {
  readonly day: number;
  /** As the chapter heading wrote it (`Wed 23 Sep 2026`); null when it named none. */
  readonly date: string | null;
  readonly chapters: JournalChapter[];
}

export function mindView(src: DashboardSource): MindView {
  const store = src.store;
  const day = store.livedDay();
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const page = src.self.page();
  const sections = pageSections(page?.body ?? "");
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

  const identity = e.identity.map(shape);
  const guarded = e.protected.map(shape);
  const outside = e.protectedOutsideIdentity.map((id) => {
    const r = reveal(store, id, 90);
    return { id, text: r.text ?? r.label };
  });
  const stories = storyViews(src);

  return {
    opening:
      `Lived day ${day}. Who I am, in my own words — and, under it, how that has changed, ` +
      "what is slowly settling into the core, what the next session will be handed, and the journal.",
    identity,
    identityAbsent: e.identity.length === 0 ? (everLived ? NONE : NEVER) : null,
    guarded,
    guardedAbsent: e.protected.length === 0 ? (everLived ? NONE : NEVER) : null,
    both: e.both,
    protectedOutsideIdentity: outside,
    unreadable,
    wake: {
      ok: wake.ok,
      reason: wake.reason,
      bytes: wake.bytes,
      preface: wake.preface,
      lanes: wake.ok ? wakeLanes(wake.text) : [],
      absent: wake.ok ? null : everLived ? NONE : NEVER,
    },
    page:
      page === null
        ? null
        : {
            present: true,
            body: page.body,
            bytes: page.bytes,
            revisedOn: page.revisedOn,
            by: page.by,
            reason: page.reason,
            version: page.version,
            stale: src.self.pageStale(page),
            // The three the type declares, NAMED — a spread of `pageSections`
            // also carried `preamble` into the JSON, which `tsc` cannot catch
            // through a spread (adversarial review n2).
            core: sections.core,
            lately: sections.lately,
            headed: sections.headed,
          },
    pageAbsent: page === null ? (everLived ? NONE : NEVER) : null,
    // NOT guarded on the live page: a CLEARED page has no live row and still has
    // a history, and the console lists it. Two surfaces answering "what did the
    // page used to say" differently is the same class of mismatch the version
    // reasons were (M3). `pageVersions` handles the no-live-row case itself.
    pageVersions: src.self.pageVersions(),
    chapters: chapters(src, 12),
    chaptersAbsent: chapters(src, 1).length === 0 ? (everLived ? NONE : NEVER) : null,
    stories,
    storiesAbsent: stories.length === 0 ? (everLived ? NONE : NEVER) : null,
    pageHistory: pageHistory(src, page),
    settling: settlingView(src, {
      core: identity,
      guarded,
      outside,
      unreadable,
      stories,
      pageId: page?.id ?? null,
      absent: everLived ? NONE : NEVER,
    }),
    wakeParts: wake.ok ? wakeParts(wake.text, page !== null) : [],
    wakeBudget: lastBudget(src),
    ...journal(src, JOURNAL_LIMIT, everLived ? NONE : NEVER),
  };
}

/** How many chapters the journal sends. The rest are counted, not dropped silently. */
const JOURNAL_LIMIT = 60;

// ─────────────────────────────────────────────────────────────────────────────
// the page's history — a timeline, oldest first
// ─────────────────────────────────────────────────────────────────────────────

function dateOfMs(at: number): string | null {
  if (!Number.isFinite(at) || at <= 0) return null;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Every state the page has been in, OLDEST first, the standing page last.
 *
 * `pageVersions()` already says who wrote each archived body and why; the
 * calendar date comes from the same durable `self.page.revised` rows, matched
 * the same way (the write that produced version `seq` recorded `version: seq - 1`).
 * A cleared page has no standing row and keeps its history, so the timeline
 * still draws.
 */
function pageHistory(src: DashboardSource, page: ReturnType<DashboardSource["self"]["page"]>): PageStep[] {
  const versions = src.self.pageVersions().slice().sort((a, b) => a.seq - b.seq);
  const at = new Map<number, number>();
  const pageId = page?.id ?? null;
  try {
    const rows = pageId === null
      ? src.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, limit: LOG_LIMIT })
      : src.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, ref: pageId, limit: LOG_LIMIT });
    for (const row of rows) {
      const payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
      const v = payload["version"];
      if (typeof v === "number") at.set(v, row.at);
    }
  } catch {
    /* unreadable log: every date reads as unrecorded, never as a guess */
  }
  const steps: PageStep[] = versions.map((v, i) => ({
    n: i + 1,
    seq: v.seq,
    current: false,
    day: v.day,
    date: at.has(v.seq - 1) ? dateOfMs(at.get(v.seq - 1) as number) : null,
    by: v.by,
    reason: v.reason,
    body: v.body,
    bytes: v.bytes,
  }));
  if (page !== null) {
    steps.push({
      n: steps.length + 1,
      seq: page.version + 1,
      current: true,
      day: page.revisedDay,
      date: page.revisedOn.length > 0 ? page.revisedOn : at.has(page.version) ? dateOfMs(at.get(page.version) as number) : null,
      by: page.by,
      reason: page.reason,
      body: page.body,
      bytes: page.bytes,
    });
  }
  return steps;
}

const LOG_LIMIT = 2_000;

// ─────────────────────────────────────────────────────────────────────────────
// what it's settling into — the core, and what is closest to it
// ─────────────────────────────────────────────────────────────────────────────

type Shaped = MindView["identity"][number];

/**
 * The core as it stands, and — the part a young store needs — what is on its way.
 *
 * The candidates are computed with physics' OWN rule, `promotionEligibility`
 * (base >= THETA_ID and credited use on N distinct lived days); nothing here
 * restates the thresholds. What this adds is one honest distinction the rule
 * implies: `base` is `max(wSal x sal, wRep x rep) + cons`, repetition caps at
 * REP_CAP and consolidation adds CONS_BONUS once, so a memory whose best case
 * stays under the bar can never get there by being used (mechanism audit
 * 2026-09-24, Consolidation). Those are counted apart, not listed as "on their
 * way". Schema rows (the page, the identity core, beliefs) are not memories and
 * are left out, as are journal rows.
 */
function settlingView(
  src: DashboardSource,
  x: {
    core: Shaped[];
    guarded: Shaped[];
    outside: { id: string; text: string }[];
    unreadable: { id: string; label: string }[];
    stories: StoryView[];
    pageId: string | null;
    absent: string;
  },
): SettlingView {
  const store = src.store;
  const raw: { id: string; kind: Kind; base: number; consolidated: boolean; days: number; eligible: boolean }[] = [];
  let outOfReach = 0;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row) || row.type === "schema" || id === x.pageId) continue;
    let p;
    try {
      p = store.physicsOf(id);
    } catch {
      continue;
    }
    const v = promotionEligibility(p);
    if (v.blockedBy.includes("already-identity")) continue;
    const k = kindPhysics(p.kind);
    const best = Math.max(k.wSal * sal(p.salience), k.wRep * PHYSICS.REP_CAP) + PHYSICS.CONS_BONUS;
    if (best < v.threshold) {
      outOfReach += 1;
      continue;
    }
    raw.push({ id, kind: p.kind, base: v.base, consolidated: p.consolidated, days: v.reinforcedDays, eligible: v.eligible });
  }
  // Closest first: how much of each condition is met, both halves weighted
  // alike; ties by days, then by what it has earned.
  const closeness = (r: (typeof raw)[number]): number =>
    Math.min(1, r.base / PHYSICS.THETA_ID) + Math.min(1, r.days / PHYSICS.N_PROMOTION_DAYS);
  raw.sort((a, b) => closeness(b) - closeness(a) || b.days - a.days || b.base - a.base || (a.id < b.id ? -1 : 1));
  const candidates: Candidate[] = raw.slice(0, CANDIDATE_LIMIT).map((r) => {
    const t = reveal(store, r.id, 110);
    return {
      id: r.id,
      text: t.text ?? t.label,
      confidential: t.confidential,
      kind: r.kind,
      base: r.base,
      threshold: PHYSICS.THETA_ID,
      consolidated: r.consolidated,
      bonus: PHYSICS.CONS_BONUS,
      days: r.days,
      requiredDays: PHYSICS.N_PROMOTION_DAYS,
      eligible: r.eligible,
    };
  });
  const row = (el: { id: string; text: string; confidential?: boolean; kind?: Kind }): SettlingRow => ({
    id: el.id,
    text: el.text,
    confidential: el.confidential === true,
    kind: el.kind ?? "fact",
  });
  return {
    core: x.core.map(row),
    guarded: x.guarded.map(row),
    contested: x.stories.map((s) => ({
      id: s.id,
      about: s.about,
      now: s.nowFull,
      revised: s.revised,
      fraction: s.fraction,
      pressure: s.pressure,
      bar: s.bar,
    })),
    outside: x.outside.map((o) => ({ id: o.id, text: o.text, confidential: false, kind: "fact" as Kind })),
    unreadable: x.unreadable,
    candidates,
    onTheWay: raw.filter((r) => r.days > 0).length,
    unused: raw.filter((r) => r.days === 0).length,
    outOfReach,
    rule: {
      threshold: PHYSICS.THETA_ID,
      days: PHYSICS.N_PROMOTION_DAYS,
      everyDays: SLEEP.CADENCE.consolidate,
      repCap: PHYSICS.REP_CAP,
      bonus: PHYSICS.CONS_BONUS,
    },
    coreAbsent: x.core.length === 0 ? x.absent : null,
    guardedAbsent: x.guarded.length === 0 ? x.absent : null,
    contestedAbsent: x.stories.length === 0 ? x.absent : null,
  };
}

const CANDIDATE_LIMIT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// the wake, in parts
// ─────────────────────────────────────────────────────────────────────────────

const PART_LABEL: Record<string, string> = {
  furniture: "headers",
  page: "self page",
  identity: "who I am",
  craft: "how I work",
  threads: "still open",
  hints: "nearby memories",
  horizon: "arriving",
};

/**
 * The published bundle cut at its OWN lane headings (`FRAMING`, from `self/`),
 * measured in raw bytes, so the parts add up to `wake.bytes` exactly. Unlike
 * `wakeLanes`, a markdown heading does NOT start a part here: the page carries
 * `## Core` and `## Lately`, and those belong to the page's slice. Everything
 * outside a lane (the framing line, the comments, the sentinel) is "headers".
 */
export function wakeParts(text: string, hasPage: boolean): WakePart[] {
  const headings = new Map<string, string>();
  for (const lane of LANE_ORDER) headings.set(FRAMING[lane], lane);
  const bytes = new Map<string, number>();
  const order: string[] = [];
  const add = (key: string, n: number): void => {
    if (!bytes.has(key)) order.push(key);
    bytes.set(key, (bytes.get(key) ?? 0) + n);
  };
  let current = "furniture";
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const n = new TextEncoder().encode(raw).length + (i < lines.length - 1 ? 1 : 0);
    const line = raw.trim();
    const lane = headings.get(line);
    if (lane !== undefined) {
      current = lane === "identity" && hasPage ? "page" : lane;
      add("furniture", n);
      return;
    }
    if (line.startsWith("<!--") || line === FRAMING.context) {
      add("furniture", n);
      return;
    }
    add(current, n);
  });
  return order
    .map((key) => ({ key, label: PART_LABEL[key] ?? key, bytes: bytes.get(key) ?? 0 }))
    .filter((p) => p.bytes > 0);
}

/** The ceiling the newest durable render recorded, or null when none did. */
function lastBudget(src: DashboardSource): number | null {
  try {
    const [row] = src.store.eventLog({ name: "self.briefing", order: "desc", limit: 1 });
    if (row === undefined) return null;
    const budget = (JSON.parse(row.payload ?? "{}") as Record<string, unknown>)["budget"];
    return typeof budget === "number" && budget > 0 ? budget : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// the journal — chapters by lived day
// ─────────────────────────────────────────────────────────────────────────────

const CHAPTER_SPLIT = /^(?=[ \t]*#{1,6}[ \t]*chapter[ \t]+\d+)/im;

/**
 * Every chapter, grouped by the lived day it was written on, newest first.
 *
 * One journal row is one session's entry and can hold several chapters, each
 * under its own `## chapter N — <date> · <model> · lived day D` heading, so a
 * row is split at those headings and each part read with `self/`'s own
 * `readChapterLead`. The model falls back to the entry's `meta.models`; a
 * chapter written before either existed shows none.
 */
function journal(src: DashboardSource, limit: number, absent: string): Pick<MindView, "journal" | "journalAbsent" | "journalMore"> {
  const store = src.store;
  const all: (JournalChapter & { day: number; date: string | null })[] = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || !isJournal(row)) continue;
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      all.push({ id, chapter: 1, title: reveal(store, id, 60).label, model: null, first: "", text: null, bytes: 0, confidential: false, day: 0, date: null });
      continue;
    }
    const withheld = isConfidential(doc);
    const models = chapterModels(doc.meta ?? {});
    const parts = doc.body.split(CHAPTER_SPLIT).filter((p) => p.trim().length > 0);
    const title = doc.title ?? "an unnamed chapter";
    parts.forEach((part, i) => {
      const lead = readChapterLead(part);
      const n = lead.chapters[0] ?? i + 1;
      const rest = lead.rest.trim();
      const first = rest.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--")) ?? "";
      all.push({
        id,
        chapter: n,
        title: parts.length > 1 ? `${title} · chapter ${n}` : title,
        model: lead.model ?? models[String(n)] ?? null,
        first: withheld ? WITHHELD : first.length > 200 ? `${first.slice(0, 200).trimEnd()}…` : first,
        text: withheld ? null : rest,
        bytes: new TextEncoder().encode(rest).length,
        confidential: withheld,
        day: lead.livedDay ?? doc.bornDay,
        date: lead.date,
      });
    });
  }
  all.sort((a, b) => b.day - a.day || (a.id < b.id ? 1 : a.id > b.id ? -1 : b.chapter - a.chapter));
  const sent = all.slice(0, limit);
  const days: JournalDay[] = [];
  for (const c of sent) {
    let d = days[days.length - 1];
    if (d === undefined || d.day !== c.day) {
      d = { day: c.day, date: c.date, chapters: [] };
      days.push(d);
    }
    if (d.date === null && c.date !== null) (d as { date: string | null }).date = c.date;
    const { day: _day, date: _date, ...chapter } = c;
    d.chapters.push(chapter);
  }
  return { journal: days, journalAbsent: all.length === 0 ? absent : null, journalMore: all.length - sent.length };
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
