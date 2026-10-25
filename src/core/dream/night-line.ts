/**
 * THE NIGHT LINE (2026-10-25, the wake-polish builder from random-5b's 10-25
 * wake; Mike's go, lightly held): one line in the wake assembled at a session
 * start saying what last night did, so a quiet night can be told from no
 * night. The counterpart's own page says "After a dream I reflect and tell
 * Mike; a quiet night says so", and until this line the wake said nothing of
 * the night at all.
 *
 *   Last night: dream drm_… made 11 links, 1 fold and 1 feeling; reflection rfl_… rewrote the page.
 *   Last night: a quiet night — dream drm_… changed nothing; reflection rfl_… had nothing much to add.
 *   Last night: a quiet night — too little new to dream on; reflection rfl_… had nothing much to add.
 *   Last night: the nightly run is under way.
 *   Last night: none yet today (last: Oct 24).
 *   Last night: no night ran (last: Oct 20); dreaming is off.
 *
 * What it reads is what `counterparts night` reads (`adapters/cli/dream-core.ts`):
 * the newest dream with its change counts, the newest reflection, the latest
 * headless run's row and the dreaming setting. "Last night" is the night run
 * dated `today`, the session's date — the nightly run starts at the first
 * session of a day and is dated that day. Ids, counts and a few fixed words;
 * never the dream's journal or its title (the journal stays out of the
 * surfaces a session reads, dream CONTRACT), never a word of the reflection.
 * No model. A store that has never dreamed, reflected or run a night gets no
 * line. Pure.
 */
import { dreamSkippedOf, dreamSkippedWords, nightRunLost } from "./index.js";
import type { DreamingSetting, NightRun } from "./index.js";

/** What the line reads, gathered by the caller (`Counterpart#nightLineFor`). */
export interface NightFacts {
  /** The session's date, `YYYY-MM-DD` in the store's zone. */
  readonly today: string;
  readonly now: number;
  /** The newest dream and its changes by action (`Dreams#list(1)`), or null. */
  readonly dream: {
    readonly id: string;
    readonly date: string | null;
    readonly state: string;
    readonly counts: Readonly<Record<string, number>>;
  } | null;
  /** The newest reflection (`Reflections#list(1)`), or null. */
  readonly reflection: {
    readonly id: string;
    readonly date: string | null;
    readonly state: string;
    readonly entry_id: string | null;
    readonly page_version: number | null;
  } | null;
  /** The latest headless run's row (`Dreams#nightRun`), or null. */
  readonly run: NightRun | null;
  readonly setting: DreamingSetting;
}

/** The line's head. */
export const NIGHT_LINE_HEAD = "Last night:";

/**
 * A dream's change, as the line says it: singular and plural. `replayed` is
 * not a change the line names — a dream replays every night — and an action
 * not here is said by its own name.
 */
const CHANGE_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  link: ["link", "links"],
  merge: ["merge", "merges"],
  fold: ["fold", "folds"],
  gist: ["gist", "gists"],
  contradiction: ["contradiction flagged", "contradictions flagged"],
  settle: ["pair settled", "pairs settled"],
  slot: ["slot", "slots"],
  "feeling-now": ["feeling", "feelings"],
  "nominate-core": ["core nomination", "core nominations"],
  "belief-candidate": ["belief proposed", "beliefs proposed"],
};

/** How many of a dream's kinds of change the line names, the most first. */
export const NIGHT_LINE_CHANGES = 3;

/** `11 links, 1 fold and 1 feeling`, or null when the dream changed nothing but replays. */
export function dreamChangeWords(counts: Readonly<Record<string, number>>): string | null {
  const kinds = Object.entries(counts)
    .filter(([action, n]) => action !== "replayed" && n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (kinds.length === 0) return null;
  const said = kinds.slice(0, NIGHT_LINE_CHANGES).map(([action, n]) => {
    const w = CHANGE_WORDS[action];
    return `${String(n)} ${w === undefined ? action : n === 1 ? w[0] : w[1]}`;
  });
  const rest = kinds.length - said.length;
  if (rest > 0) said.push(`${String(rest)} more ${rest === 1 ? "kind" : "kinds"}`);
  return said.length === 1 ? (said[0] ?? "") : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1] ?? ""}`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2026-10-24` → `Oct 24`. */
function shortDate(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd);
  const mo = m === null ? undefined : SHORT_MONTHS[Number(m[1]) - 1];
  return m === null || mo === undefined ? ymd : `${mo} ${String(Number(m[2]))}`;
}

/** The day before `ymd`, as `YYYY-MM-DD` (calendar arithmetic, no zone). */
function dayBefore(ymd: string): string {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  return Number.isNaN(t) ? "" : new Date(t - 86_400_000).toISOString().slice(0, 10);
}

/** The line, or null when there is no night to speak of (a store that never had one). */
export function nightLine(f: NightFacts): string | null {
  const { today, run } = f;
  const dream = f.dream?.date === today ? f.dream : null;
  const reflection = f.reflection?.date === today ? f.reflection : null;
  const runToday = run !== null && run.date === today ? run : null;
  const off = f.setting === "off" ? "; dreaming is off" : "";

  // Running now: whatever it has begun is not yet what it did.
  if (runToday !== null && runToday.state === "started" && !nightRunLost(runToday, f.now)) return `${NIGHT_LINE_HEAD} the nightly run is under way.`;
  if (dream === null && reflection === null) {
    const skipped = runToday === null ? null : dreamSkippedOf(runToday);
    if (runToday !== null && skipped !== null && (runToday.state === "done" || runToday.state === "partial")) {
      return `${NIGHT_LINE_HEAD} a quiet night — ${dreamSkippedWords(skipped)}.`;
    }
    if (runToday !== null && runToday.state !== "done" && runToday.state !== "started") {
      return `${NIGHT_LINE_HEAD} the nightly run did not finish (${runToday.state}).`;
    }
    // Nothing tonight: when the last one was.
    const dates = [f.dream?.date, f.reflection?.date, run?.date].filter((d): d is string => typeof d === "string" && d.length > 0 && d < today).sort();
    const last = dates[dates.length - 1];
    if (last === undefined) return null;
    return last === dayBefore(today)
      ? `${NIGHT_LINE_HEAD} none yet today (last: ${shortDate(last)})${off}.`
      : `${NIGHT_LINE_HEAD} no night ran (last: ${shortDate(last)})${off}.`;
  }

  // What the dream did.
  let dreamPart: string | null = null;
  let dreamQuiet = true;
  if (dream !== null) {
    if (dream.state === "undone") dreamPart = `dream ${dream.id} was undone`;
    else if (dream.state !== "journaled") {
      dreamPart = `dream ${dream.id} was begun, not finished`;
    } else {
      const did = dreamChangeWords(dream.counts);
      dreamQuiet = did === null;
      dreamPart = did === null ? `dream ${dream.id} changed nothing` : `dream ${dream.id} made ${did}`;
    }
  } else {
    const skipped = runToday === null ? null : dreamSkippedOf(runToday);
    dreamPart = skipped === null ? null : dreamSkippedWords(skipped);
  }

  // What the reflection did.
  let reflectionPart: string | null = null;
  let reflectionQuiet = true;
  if (reflection !== null) {
    if (reflection.state !== "reflected") {
      reflectionPart = `reflection ${reflection.id} was begun, not finished`;
    } else if (reflection.page_version !== null) {
      reflectionQuiet = false;
      reflectionPart = `reflection ${reflection.id} rewrote the page`;
    } else if (reflection.entry_id !== null) {
      reflectionQuiet = false;
      reflectionPart = `reflection ${reflection.id} wrote an entry`;
    } else {
      reflectionPart = `reflection ${reflection.id} had nothing much to add`;
    }
  }

  const parts = [dreamPart, reflectionPart].filter((p): p is string => p !== null).join("; ");
  const quiet = dreamQuiet && reflectionQuiet && (dream === null || dream.state === "journaled") && (reflection === null || reflection.state === "reflected");
  return quiet ? `${NIGHT_LINE_HEAD} a quiet night — ${parts}.` : `${NIGHT_LINE_HEAD} ${parts}.`;
}
