/**
 * INTERFERENCE FOR ROUTINE WORK EVENTS (2026-11-07, FD1 step 3; Mike's
 * ruling mem_dc74aa500871, lightly held: "wherever something is growing,
 * consider fading more"). A newer routine work event on the same subject fades
 * the older one, the way a write's `updates` already does: "0.3.50 released"
 * fades "0.3.46 ready to publish" and "0.3.47 after-publish steps". Three
 * quarters of a working store is `about: work`, mostly status events, and
 * each one used to take its whole slow curve to leave.
 *
 * **The route: subject tokens, through the one door.** No model and no
 * vectors. The subject is what a status event names exactly — a release in a
 * version series (`0.3.46`, series `0.3`) or a pull request (`#772`) — in the
 * same folder, read in each memory's HEADLINE (its title, or its first words:
 * `headline`), never a version named in passing further down. Each night
 * (`sleep/interfere.ts`, a phase of the cycle) an
 * older memory that names the same series at a version no higher than a newer
 * one's, or the same pull request, and was written on an EARLIER lived day,
 * is settled `changed` under the nearest such memory (fewest patches on, then
 * the newest written) through
 * `reconsolidation.ts#supersede`, source `interference`, reason
 * `superseded-by-newer`: its fade multiplier takes `CHANGED_FADE` (×0.5,
 * what an `updates` revision gives), it stays recallable, labelled earlier,
 * and every fade can be undone like any settle. The prune is not touched:
 * a faded memory still waits `D_FLOOR_DAYS` under the floor before it leaves,
 * and is counted then as an age prune. Not the slot detector (it needs
 * vectors, reads only 7 lived days back, and waits on the dream, 4 a night)
 * nor the dream's fold (a model's call): neither scales to thousands of
 * status notes, and "#760 merged" / "#772 merged" are near-identical by
 * meaning yet two subjects, which tokens tell apart.
 *
 * **Only what nobody leaned on (the scope guard).** The older memory must be
 * a `fact` about `work`, written by a session in a folder, `done` or unmarked,
 * in the episodic band, never protected or core, not a belief, with no date
 * to be reminded on, not an open item (`unresolved` / `settlesWhen`: "Still
 * open" is the review's item 3, a later PR — this sweep never closes one),
 * not said by the owner, with no feeling (none recorded, no emotional
 * salience), unsalient (`sal` at most `SAL_MAX`), never really used (uses
 * under `W_USEFUL`: one open, quote, or rating of 2 or 3 is past it), reading
 * as a status event (`STATUS_WORDS`), and in no pair already (one cut per
 * memory; a pair the owner undid is never faded again). Anything the owner
 * said, anything felt, and anything about the owner, us or me keeps the slow
 * curve. The newer memory needs only to be live work in the same folder,
 * `done` or unmarked, and itself a status event in its headline.
 *
 * Measured once, as a dry run on a copy of the owner's store (lived day 47,
 * 5,798 live authored work rows): 124 would fade the first night (105 by
 * version, 19 by pull request), ~150 ms; the guards held the rest (most:
 * `not-done` 1,628, `not-an-event` 1,355, `salient` 827, `owner-said` 464).
 *
 * Counted apart from the prune (the roadmap's condition): the cycle's durable
 * `sleep.cycle` row carries `interfered` beside `pruned`, each fade writes a
 * `contradiction.settled` row with `source: interference` and `reason`, and
 * the trail's `why` names the newer memory.
 */
import { TUNABLES as PHYSICS, sal } from "./physics/index.js";
import { supersede } from "./reconsolidation.js";
import { SETTLES_WHEN_META_KEY } from "./types.js";
import type { Store, WorkEventRow } from "./store/index.js";

/** The pair `source` this sweep writes (no DDL: a TEXT value). */
export const INTERFERENCE_SOURCE = "interference";

/** The reason every interference fade records, on the event and the trail. */
export const INTERFERENCE_REASON = "superseded-by-newer";

/**
 * Working defaults, held lightly (2026-11-07). Read at use, never copied at
 * load. (Not in the harness's `--set` list: that reads only the package's
 * public seams, and this file is not one; `physics.CHANGED_FADE` is.) The cut
 * itself is `physics.CHANGED_FADE` (×0.5), the fade a write's `updates` gives
 * the memory it revises: one number for every `changed`.
 */
export const INTERFERENCE_TUNABLES = {
  /** The switch. Off: the phase runs and counts `switched-off`. */
  ON: true as boolean,
  /**
   * The most salience an older memory may carry and still fade: at or under
   * `DEFAULT_CLAIM_PERSONAL` (0.4). A defaulted work event is 0.20, other
   * unclaimed work 0.25; a writer who claimed more than 0.4 said it mattered. CAL.
   */
  SAL_MAX: 0.4 as number,
  /** A memory with no title is read by this many characters of its words: about a title's worth. CAL. */
  HEADLINE_CHARS: 120 as number,
};

/**
 * A STATUS EVENT'S WORDS (2026-11-07, lightly held): the older memory must
 * read as one, so a design note that names a version ("0.3.46 changed the
 * curve because …") is not faded by a release. Whole words, any case.
 */
export const STATUS_WORDS =
  /\b(?:releas(?:e|ed|es|ing)|publish(?:ed|es|ing)?|after-publish|cut|cuts|cutting|merg(?:e|ed|es|ing)|deploy(?:ed|s|ing)?|ship(?:ped|s|ping)?|tag(?:ged)?|install(?:ed|s|ing)?|ready|queued|opened|closed|pushed|landed|built|green|passed|approved|reviewed|bump(?:ed)?)\b/i;

/** A version, `major.minor.patch`, not part of a longer dotted run (an address, a date). */
const VERSION = /(?<![\w.])v?(\d{1,3})\.(\d{1,3})\.(\d{1,4})(?![\w]|\.\d)/g;

/** A pull request or issue number: `#772`, `PR 772`, `pull/772`. Two digits or more. */
const PULL = /(?:(?<![\w&])#|\bPR\s*#?|\bpull\/)(\d{2,6})\b/gi;

/** What a memory names exactly: each version series' highest patch, and its pull requests. */
export interface SubjectKeys {
  readonly versions: ReadonlyMap<string, number>;
  readonly pulls: ReadonlySet<number>;
}

/** The subject tokens in a memory's title and words. Pure. */
export function subjectKeys(text: string): SubjectKeys {
  const versions = new Map<string, number>();
  for (const m of text.matchAll(VERSION)) {
    const series = `${Number(m[1])}.${Number(m[2])}`;
    const patch = Number(m[3]);
    versions.set(series, Math.max(versions.get(series) ?? -1, patch));
  }
  const pulls = new Set<number>();
  for (const m of text.matchAll(PULL)) pulls.add(Number(m[1]));
  return { versions, pulls };
}

/**
 * Which rule makes `newer` the later state of `older`'s subject, or null, and
 * how far on it is (`gap`: patches ahead, 0 for the same version or pull
 * request), so the sweep can name the NEAREST later state. Pure.
 */
export function sameSubject(older: SubjectKeys, newer: SubjectKeys): { rule: "version" | "pull"; key: string; gap: number } | null {
  let best: { rule: "version" | "pull"; key: string; gap: number } | null = null;
  for (const n of older.pulls) if (newer.pulls.has(n)) return { rule: "pull", key: `#${n}`, gap: 0 };
  for (const [series, patch] of older.versions) {
    const theirs = newer.versions.get(series);
    if (theirs === undefined || theirs < patch) continue;
    if (best === null || theirs - patch < best.gap) best = { rule: "version", key: `${series}.${patch}→${series}.${theirs}`, gap: theirs - patch };
  }
  return best;
}

/** Why an older memory keeps its slow curve, one word each (the phase's `skipped`). */
export type InterferenceSkip =
  | "not-a-fact"
  | "not-done"
  | "open-item"
  | "dated"
  | "held"
  | "belief"
  | "owner-said"
  | "felt"
  | "salient"
  | "used"
  | "not-an-event"
  | "no-subject"
  | "no-newer"
  | "already-paired"
  | "refused";

export interface InterferenceFade {
  readonly over: string;
  readonly holds: string;
  readonly rule: "version" | "pull";
  readonly key: string;
}

export interface InterferenceInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would fade. */
  readonly apply: boolean;
  /** Fades a night at most; the rest wait, counted (a budget is not a debt). */
  readonly budget: number;
}

export interface InterferenceOutcome {
  /** False when the sweep is switched off. */
  readonly on: boolean;
  /** Older work memories judged. */
  readonly examined: number;
  /** Faded tonight (or, under observer, would be). */
  readonly faded: readonly InterferenceFade[];
  readonly skipped: Readonly<Record<string, number>>;
  /** Would have faded, past tonight's budget. */
  readonly skippedForLimit: number;
}

/**
 * WHAT A MEMORY IS ABOUT, IN ITS OWN HEADLINE (2026-11-07): its title, or the
 * first `HEADLINE_CHARS` of its words when it has none. A status event names
 * its release or pull request there ("0.3.25 released 10-16", "#655 merged");
 * a version named in passing further down a note (a finding that mentions the
 * build it was seen on) is not its subject. Read on a copy of the owner's
 * store (day 47): reading the whole body, 0.3.50 named in one note's last
 * line was the "newer state" of eleven unrelated coordination notes.
 */
export function headline(r: { readonly title: string | null; readonly body: string }): string {
  const t = r.title?.trim() ?? "";
  if (t.length > 0) return t;
  const max = INTERFERENCE_TUNABLES.HEADLINE_CHARS;
  if (r.body.length <= max) return r.body;
  // Cut at a space, never inside a word: `…0.3.4|6` must not read as 0.3.4, nor `#74|1` as #74.
  const cut = r.body.slice(0, max + 1);
  const at = cut.search(/\s\S*$/);
  return at > 0 ? cut.slice(0, at) : "";
}

/** The guard on the OLDER memory that needs no second read, or null when it may fade. */
function rowGuard(r: WorkEventRow): InterferenceSkip | null {
  if (r.kind !== "fact") return "not-a-fact";
  if (r.status !== null && r.status !== "done") return "not-done";
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(r.meta) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  if (meta["unresolved"] === true || (typeof meta[SETTLES_WHEN_META_KEY] === "string" && meta[SETTLES_WHEN_META_KEY] !== "")) return "open-item";
  if (r.eventDate !== null) return "dated";
  if (r.protected || r.promoted || r.band !== "episodic") return "held";
  if (r.belief) return "belief";
  if (r.saidBy === "owner") return "owner-said";
  if (r.emotional > 0) return "felt";
  if (sal({ novelty: r.novelty, relevance: r.relevance, emotional: r.emotional, predictive: r.predictive, claimed: r.claimed }) > INTERFERENCE_TUNABLES.SAL_MAX) return "salient";
  if (r.uses >= PHYSICS.W_USEFUL) return "used";
  if (!STATUS_WORDS.test(headline(r))) return "not-an-event";
  return null;
}

/**
 * THE NIGHT'S INTERFERENCE SWEEP: every older routine work memory a newer one
 * in the same folder reads as the later state of, faded through the one door
 * (`supersede`, `changed`, source `interference`, reason
 * `superseded-by-newer`), oldest first, `budget` a night. Under observer it
 * counts and writes nothing. A fade the door refuses is counted `refused`
 * and the sweep goes on.
 */
export function interferenceSweep(store: Store, input: InterferenceInput): InterferenceOutcome {
  const skipped: Record<string, number> = {};
  const skip = (why: InterferenceSkip): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  if (!INTERFERENCE_TUNABLES.ON) return { on: false, examined: 0, faded: [], skipped, skippedForLimit: 0 };
  const rows = store.workEventRows();
  // The newer side, by folder and subject: each holds its newest first.
  const keysOf = new Map<string, SubjectKeys>();
  const index = new Map<string, WorkEventRow[]>();
  const slot = (scope: string, k: string): string => `${scope}\u0000${k}`;
  for (const r of rows) {
    const keys = subjectKeys(headline(r));
    keysOf.set(r.id, keys);
    // The newer side: done or unmarked, and itself a status event in its headline.
    if ((r.status !== null && r.status !== "done") || !STATUS_WORDS.test(headline(r))) continue;
    const at = [...[...keys.versions.keys()].map((s) => `v:${s}`), ...[...keys.pulls].map((n) => `pr:${n}`)];
    for (const k of at) {
      const list = index.get(slot(r.scope, k)) ?? [];
      list.push(r);
      index.set(slot(r.scope, k), list);
    }
  }
  // Every memory an interference pair ever named as the older, a withdrawn
  // one included: the owner's undo stands, and one cut is all a memory gets.
  const once = new Set<string>();
  for (const c of store.contradictions({ limit: 10_000_000 })) if (c.source === INTERFERENCE_SOURCE) once.add(c.a);

  const faded: InterferenceFade[] = [];
  let examined = 0;
  let skippedForLimit = 0;
  for (const r of rows) {
    const guard = rowGuard(r);
    if (guard !== null) {
      skip(guard);
      continue;
    }
    const keys = keysOf.get(r.id) as SubjectKeys;
    if (keys.versions.size === 0 && keys.pulls.size === 0) {
      skip("no-subject");
      continue;
    }
    examined += 1;
    // The NEAREST later state, written on a later lived day: the fewest patches
    // on (the same version or pull request first), then the newest written.
    let best: { row: WorkEventRow; rule: "version" | "pull"; key: string; gap: number } | null = null;
    const seen = new Set<string>();
    for (const k of [...[...keys.versions.keys()].map((s) => `v:${s}`), ...[...keys.pulls].map((n) => `pr:${n}`)]) {
      for (const n of index.get(slot(r.scope, k)) ?? []) {
        if (seen.has(n.id) || n.id === r.id || n.birthDay <= r.birthDay) continue;
        seen.add(n.id);
        const same = sameSubject(keys, keysOf.get(n.id) as SubjectKeys);
        if (same === null) continue;
        const nearer =
          best === null ||
          same.gap < best.gap ||
          (same.gap === best.gap && (n.createdAt > best.row.createdAt || (n.createdAt === best.row.createdAt && n.id > best.row.id)));
        if (nearer) best = { row: n, ...same };
      }
    }
    if (best === null) {
      skip("no-newer");
      continue;
    }
    // Second reads only for a match: a feeling recorded on it, a pair already standing.
    if (once.has(r.id) || (store.contradictionsOf([r.id]).get(r.id) ?? []).length > 0) {
      skip("already-paired");
      continue;
    }
    const peak = store.row(r.id)?.feeling_peak ?? null;
    if (typeof peak === "number" && peak > 0) {
      skip("felt");
      continue;
    }
    if (faded.length >= input.budget) {
      skippedForLimit += 1;
      continue;
    }
    const fade: InterferenceFade = { over: r.id, holds: best.row.id, rule: best.rule, key: best.key };
    if (!input.apply) {
      faded.push(fade);
      continue;
    }
    const out = supersede(store, {
      holds: best.row.id,
      over: r.id,
      how: "changed",
      source: INTERFERENCE_SOURCE,
      actor: "detector",
      why: `${INTERFERENCE_REASON}: ${best.row.id} (${best.key})`,
      reason: INTERFERENCE_REASON,
      day: input.day,
      closeFlags: false,
    });
    if (!out.ok) {
      skip("refused");
      continue;
    }
    once.add(r.id);
    faded.push(fade);
  }
  return { on: true, examined, faded, skipped, skippedForLimit };
}
