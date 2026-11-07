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
 * what an `updates` revision gives), it stays live, labelled earlier, and it
 * is SETTLED OVER (`self#settledOver`): out of the wake's lines and cues, a
 * handoff's "since" line and the self lists, and folded into its holder in
 * recall's facts — which is why the subject rule is strict. Every fade can be
 * undone like any settle. (`SETTLE` off is the plain-fade fallback: the cut
 * and a `memory.interfered` row, no pair, nothing hidden.) The prune is not touched:
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
 * as a status event AT its subject (a status verb beside the version or pull
 * request in its headline: `subjectKeys`), never faded before (`fade` 1), not
 * the faded side of a pair nor under an open question (holding a pair is no
 * reason: a chain's middle link fades in its turn), and never in an
 * interference pair the owner undid. Anything the owner said, anything felt,
 * and anything about the owner, us or me keeps the slow curve. The newer
 * memory must be live work in the same folder, `done` or unmarked, and say
 * the thing was DONE at that subject (released, published, merged, shipped,
 * deployed, tagged, installed, landed, closed), for an equal version too.
 *
 * Measured on a copy of the owner's store (lived day 47, 5,798 live authored
 * work rows), after the review of #777: 71 fade the first night, observer and
 * applied alike (68 by version, 3 by pull request), ~120 ms; 20 sampled pairs
 * hand-checked by title, 19 plainly right and one borderline (a release note
 * carrying a finding beside it). The guards held the rest (most: `not-done`
 * 1,628, `no-subject` 1,446, `salient` 827, `owner-said` 464, `not-an-event`
 * 358). A different series errs safe: 0.4.0 does not fade 0.3.x. A `#12`
 * in prose can pair, rarely, when a status verb stands beside it.
 *
 * Counted apart from the prune (the roadmap's condition): the cycle's durable
 * `sleep.cycle` row carries `interfered` beside `pruned`, each fade writes a
 * `contradiction.settled` row with `source: interference` and `reason`, and
 * the trail's `why` names the newer memory.
 */
import { TUNABLES as PHYSICS, changedFade, fadeOf, sal } from "./physics/index.js";
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
   * How the cut lands. True: a settled `changed` pair through the one door
   * (labelled earlier, undoable — and hidden as settled over in the wake,
   * cues and lists). False: a plain fade, ×`CHANGED_FADE` with a
   * `memory.interfered` row, no pair. Chosen by the roadmap's bar for #777
   * (19 of 20 hand-checked pairs right, and no material per-turn cost).
   */
  SETTLE: true as boolean,
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
 * A STATUS EVENT, NAMED AT ITS SUBJECT (2026-11-07, the review of #777): a
 * version or pull request counts as the memory's subject only when a status
 * verb stands right beside it in the headline — "0.3.46 released", "#741
 * merged", "PR #741 opened", "ready to publish 0.3.47", "installed 0.3.43" —
 * with at most two small words between ("0.3.46 fully released"). A verb
 * elsewhere in the line ("Release branch scan … 0.3.44"), a dotted event name
 * ("memory.merged"), and a noun phrase ("during the 0.3.46 cut") name no
 * event. Two verb sets: what an OLDER memory may be (any step on the way: ready,
 * queued, opened, packed, cut, after-publish), and what a NEWER one must be
 * to stand over it — the thing done (released, published, merged, shipped,
 * deployed, tagged, installed, landed, closed), for an equal version too.
 */
const FILLER = String.raw`(?:is|was|has|have|been|now|fully|finally|all|just|also|then|got|being|and|officially)`;
const DONE = String.raw`released|published|merged|deployed|shipped|tagged|installed|landed|closed`;
const STEP = String.raw`${DONE}|ready|queued|opened|pushed|approved|reviewed|built|packed|cut|after-publish`;
/** After the token: `0.3.46 released`, `#741 is merged`, `0.3.47-dev tagged`. */
const after = (verbs: string): RegExp =>
  new RegExp(String.raw`^(?:-[\w]+)?\s*[:,]?(?:\s+${FILLER}){0,2}\s+(?:${verbs})(?![\w.@/-])`, "i");
/** Before the token: `released 0.3.50`, `merged #741`, `ready to publish 0.3.47`, `installed counterparts@0.3.14`. */
const before = (verbs: string): RegExp =>
  new RegExp(String.raw`(?<![\w.@/-])(?:${verbs}|ready to (?:publish|release|merge|ship|cut))(?:\s+(?:counterparts|version|v))?\s*@?\s*$`, "i");
const AFTER_STEP = after(STEP);
const AFTER_DONE = after(DONE);
const BEFORE_STEP = before(STEP);
const BEFORE_DONE = before(DONE);
/** A noun phrase in front of the token: `the 0.3.46 cut`, `during 0.3.46`. Never an event read forward. */
const DETERMINER = /(?:^|[^\w])(?:the|a|an|this|that|its|during|of|in|for|on|from|since|until|before|with)\s+(?:counterparts@)?$/i;

/** A version, `major.minor.patch`, not part of a longer dotted run (an address, a date). */
const VERSION = /(?<![\w.])v?(\d{1,3})\.(\d{1,3})\.(\d{1,4})(?![\w]|\.\d)/g;

/** A pull request or issue number: `#772`, `PR 772`, `pull/772`. Two digits or more. */
const PULL = /(?:(?<![\w&])#|\bPR\s*#?|\bpull\/)(\d{2,6})\b/gi;

/** What a memory names exactly: each version series' highest patch, and its pull requests. */
export interface SubjectKeys {
  readonly versions: ReadonlyMap<string, number>;
  readonly pulls: ReadonlySet<number>;
}

/**
 * The subject tokens in a headline. `as`: `any` reads every token (the raw
 * read); `step` only those a status verb of any step stands beside (what an
 * older memory is about); `done` only those the thing-done verbs stand beside
 * (what a newer memory must say). Pure.
 */
export function subjectKeys(text: string, as: "any" | "step" | "done" = "step"): SubjectKeys {
  const event = (start: number, end: number): boolean => {
    if (as === "any") return true;
    const head = text.slice(0, start);
    const tail = text.slice(end);
    const [a, b] = as === "done" ? [AFTER_DONE, BEFORE_DONE] : [AFTER_STEP, BEFORE_STEP];
    if (b.test(head)) return true;
    return a.test(tail) && !DETERMINER.test(head);
  };
  const versions = new Map<string, number>();
  for (const m of text.matchAll(VERSION)) {
    if (!event(m.index, m.index + m[0].length)) continue;
    const series = `${Number(m[1])}.${Number(m[2])}`;
    const patch = Number(m[3]);
    versions.set(series, Math.max(versions.get(series) ?? -1, patch));
  }
  const pulls = new Set<number>();
  for (const m of text.matchAll(PULL)) if (event(m.index, m.index + m[0].length)) pulls.add(Number(m[1]));
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
  | "already-faded"
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
  // One cut, ever: a memory something already faded (a settle, an earlier night) keeps what it has.
  if (r.fade < 1) return "already-faded";
  return null;
}

/** The durable row a plain fade writes, one per fade: the older, the newer, the reason (`plainFade`). */
export const INTERFERENCE_EVENT = "memory.interfered";

/**
 * A PLAIN FADE (the fallback the roadmap set for #777): the older memory's
 * fade multiplier ×`CHANGED_FADE`, and one `memory.interfered` row naming the
 * newer memory and the reason — no pair, no settle, so nothing reads it as
 * settled over: it keeps its place in the wake, cues and lists and only its
 * reach drops. False when there is nothing to cut or the write fails.
 */
function plainFade(store: Store, f: InterferenceFade, day: number): boolean {
  try {
    const physics = store.physicsOf(f.over);
    const cut = changedFade(physics, day);
    if (cut === null) return false;
    store.updatePhysics(f.over, { fade: cut.fade });
    store.appendEvent({
      name: INTERFERENCE_EVENT,
      day,
      ref: f.over,
      payload: {
        over: f.over,
        holds: f.holds,
        reason: INTERFERENCE_REASON,
        rule: f.rule,
        key: f.key,
        factor: cut.factor,
        fadeBefore: fadeOf(physics),
        fadeAfter: cut.fade,
        strengthBefore: Math.round(cut.before * 1e4) / 1e4,
        strengthAfter: Math.round(cut.after * 1e4) / 1e4,
        day,
      },
    });
    return true;
  } catch {
    return false;
  }
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
  // The newer side, by folder and subject: what each memory says was DONE to
  // a version or pull request, beside it in its headline.
  const keysOf = new Map<string, SubjectKeys>();
  const doneOf = new Map<string, SubjectKeys>();
  const index = new Map<string, WorkEventRow[]>();
  const slot = (scope: string, k: string): string => `${scope}\u0000${k}`;
  for (const r of rows) {
    const h = headline(r);
    keysOf.set(r.id, subjectKeys(h, "step"));
    if (r.status !== null && r.status !== "done") continue;
    const done = subjectKeys(h, "done");
    doneOf.set(r.id, done);
    const at = [...[...done.versions.keys()].map((s) => `v:${s}`), ...[...done.pulls].map((n) => `pr:${n}`)];
    for (const k of at) {
      const list = index.get(slot(r.scope, k)) ?? [];
      list.push(r);
      index.set(slot(r.scope, k), list);
    }
  }
  // Every memory an interference pair ever named as the older, a withdrawn
  // one included: the owner's undo stands, and one cut is all a memory gets.
  const once = new Set<string>(store.contradictionOlders(INTERFERENCE_SOURCE));

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
      const raw = subjectKeys(headline(r), "any");
      skip(raw.versions.size === 0 && raw.pulls.size === 0 ? "no-subject" : "not-an-event");
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
        const same = sameSubject(keys, doneOf.get(n.id) as SubjectKeys);
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
    // Second reads only for a match: a feeling recorded on it, a pair it is
    // already the faded side of, or a question still open about it. HOLDING a
    // settled pair is no reason (review of #777: a chain's middle link holds
    // the one before it, and must still fade under the one after).
    const standing = store.contradictionsOf([r.id]).get(r.id) ?? [];
    if (once.has(r.id) || standing.some((p) => p.over === r.id || p.state === "unsettled")) {
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
    if (INTERFERENCE_TUNABLES.SETTLE) {
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
    } else if (!plainFade(store, fade, input.day)) {
      skip("refused");
      continue;
    }
    once.add(r.id);
    faded.push(fade);
  }
  return { on: true, examined, faded, skipped, skippedForLimit };
}
