/**
 * `/api/mind` — identity, the briefing, the journal, the revision stories.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { band, strength } from "../../../../core/physics/index.js";
import { FRAMING, LANE_ORDER, pageSections } from "../../../../core/self/index.js";
import type { PageVersion } from "../../../../core/self/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
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
   * The BODIES ride along rather than a diff. The current dashboard has no
   * precedent for rendering a change between two revisions (`divergentPair` is
   * a side-by-side of two CONTESTED statements, not a text diff), and a page is
   * prose a person reads rather than a field that changed — so this is the
   * simple list the brief named as the fallback, newest first.
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
