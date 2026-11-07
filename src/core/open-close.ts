/**
 * THE NIGHT CLOSES OPEN ITEMS ITSELF (2026-11-07, SO1 step 1; Mike's "yes",
 * lightly held). An open item (`unresolved`, with or without `settlesWhen`)
 * that a later memory plainly shows done is closed by the night — no
 * question in the share, no "Shall I close them?". Precision over recall: a
 * wrong close hides a real debt, so the deterministic rule is one, exact,
 * and what it can't be sure of is only LISTED, as "may be done", under
 * `recall "still open"`. Nobody is asked.
 *
 * **The one rule (`release-supersedes`).** A release memory — "X.Y.Z
 * released" / "published" (a FINAL verb beside the version in its headline,
 * `interference.ts#subjectKeys`) — closes every open item in the same folder
 * whose headline names an earlier patch of the same series as a step on the
 * way (ready, cut, queued, packed, after-publish, …): "0.3.46 ready for Mike
 * to publish" and "0.3.47 after-publish steps" close under "0.3.50
 * released". Strictly an earlier patch (W < Z): the same version's release
 * does not close its own after-publish steps. Written strictly later (its
 * moment, else its lived day). The same subject reading the interference
 * sweep uses (`subjectKeys` / `sameSubject`: a verb right beside the
 * version, never a plan, never a noun phrase), so "Check ~7 lived days after
 * 0.3.45" or "fix aimed at 0.3.30" name no release step and never close.
 *
 * **What this rule never closes.** A question to the owner (`status:
 * asked`): only his answer closes one — a write that `updates` it and says it
 * is answered, or the reflection on what he said — and similarity is not his
 * answer; one that may be settled is listed as "may be done". An item the
 * owner reopened (`threadReopenedBy`). A check (CHECK-AFTER, "Check due", a
 * re-read): a release is when a check comes due, not its answer. An item that
 * is conditional on a release ("after 0.3.45", "once 0.3.47 ships"). One the
 * item itself already reads as final ("0.3.47 published but …": what it owes
 * is past the release). Protected or archived rows (`closeThread`'s checks).
 *
 * **The write** is `closeThread`'s (`counterpart-deposit.ts`): the flag set
 * false through `Store#revise` (reason `thread-closed`, the old meta kept in
 * the version row), with `threadClosedBy: {by: "night", day, rule, shows,
 * why}` beside it, and one durable `thread.night.closed` event per close
 * naming the item, the memory that showed it and the reason. No DDL.
 *
 * **The way back** (`reopenNightClosed`): the reflect tool's phase "reopen"
 * with the item's id (the owner says it isn't done), or a write that
 * `updates` it and says `unresolved: true` (the thread goes on, on the new
 * row). Either is recorded (`thread.night.reopened`) and marks the item
 * `threadReopenedBy`, so no night closes it again on its own. Reading an
 * item by id is not a touch: the morning line prints the ids, and looking at
 * what closed must not undo it.
 *
 * **"May be done"** (`mayBeDoneOf`): what the night saw but would not close
 * — an item naming a release step whose series moved on, an item naming a PR
 * a later memory says merged — and what the reflection, reading with a
 * model, thought looks done but wasn't sure of (its `close` ids, which used
 * to be asked in the share). Kept on one store meta row, replaced each
 * night; listed by `recall "still open"` beside the item, never in the wake.
 */
import { THREAD_CLOSED_BY_META_KEY, THREAD_REOPENED_BY_META_KEY, UNRESOLVED_META_KEY } from "./mint.js";
import { INTERFERENCE_SOURCE, headline, sameSubject, subjectKeys } from "./interference.js";
import { undo } from "./reconsolidation.js";
import type { SubjectKeys } from "./interference.js";
import { settlesWhenOf } from "./types.js";
import { openThread } from "./self/identity.js";
import type { Store, WorkEventRow } from "./store/index.js";

/** The rule every night close records. */
export const NIGHT_CLOSE_RULE = "release-supersedes";

/** One durable row per close: the item (`ref`), the memory that showed it, the reason. */
export const NIGHT_CLOSE_EVENT = "thread.night.closed";

/** One durable row per reopen of a night-closed item: the item (`ref`) and what touched it. */
export const NIGHT_REOPEN_EVENT = "thread.night.reopened";

/** The store meta row the night writes its "may be done" list to (JSON; replaced each night). */
export const MAY_BE_DONE_META = "open.mayBeDone";

/** Working defaults, held lightly (2026-11-07). Read at use. */
export const OPEN_CLOSE_TUNABLES = {
  /** The switch. Off: the phase runs, closes nothing, lists nothing, and counts `switched-off`. */
  ON: true as boolean,
  /**
   * The release must be written in the item's own folder. A version series
   * is one project's ("0.3.x" in another folder may be another product). CAL.
   */
  SAME_FOLDER: true as boolean,
  /** "May be done" entries kept a night at most. CAL. */
  MAY_BE_DONE_MAX: 200 as number,
  /** Reflection proposals older than this many lived days are not listed. CAL. */
  PROPOSED_DAYS: 7 as number,
};

/** Who closed it, beside the flag (`threadClosedBy`) when the night did. */
export interface NightClosedBy {
  readonly by: "night";
  readonly day: number;
  readonly rule: string;
  readonly shows: string;
  readonly why: string;
}

/** One close: the item, the memory that showed it done, the rule, and the why in a few words. */
export interface NightClose {
  readonly id: string;
  readonly shows: string;
  readonly rule: string;
  /** `0.3.46→0.3.50`. */
  readonly key: string;
  /** "0.3.50 released". */
  readonly why: string;
}

/** One "may be done": the item, why it might be, and the memory, when one shows it. */
export interface MayBeDone {
  readonly id: string;
  readonly why: string;
  readonly shows?: string;
  readonly from: "night" | "reflection";
}

/** Why an open item was not closed, one word each (the phase's `skipped`). */
export type OpenCloseSkip =
  | "not-open"
  | "held"
  | "asked"
  | "reopened"
  | "a-check"
  | "conditional"
  | "no-subject"
  | "final-already"
  | "no-later-release"
  | "refused";

export interface OpenCloseInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would close. */
  readonly apply: boolean;
  /** Closes a night at most; the rest wait, counted. */
  readonly budget: number;
}

export interface OpenCloseOutcome {
  readonly on: boolean;
  /** Open items judged. */
  readonly examined: number;
  readonly closed: readonly NightClose[];
  /** What the night saw but would not close. */
  readonly mayBeDone: readonly MayBeDone[];
  readonly skipped: Readonly<Record<string, number>>;
  readonly skippedForLimit: number;
}

/** A check is when something comes due, never what a release settles. */
const A_CHECK = /\bcheck(?:ed|s)?\b|CHECK-AFTER|\bre-?read\b|\bre-?check\b/i;
/** The version as a condition, not a subject: `after 0.3.45`, `once 0.3.47 ships`, `until 0.3.48`. */
const CONDITIONAL = /\b(?:after|once|when|until|post|before|since|by|in|into|for|aimed\s+at|ride|rides|riding)\s+(?:counterparts@|v)?\d{1,3}\.\d{1,3}\.\d{1,4}(?![\w.])/i;
/** A PR number: `#739`, `PR #41`. */
const PR = /(?<![\w&])#(\d{2,6})\b/g;

/** The night-closed record on a memory's meta, or null. */
export function nightClosedOf(meta: Readonly<Record<string, unknown>>): NightClosedBy | null {
  const v = meta[THREAD_CLOSED_BY_META_KEY];
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r["by"] !== "night") return null;
  return {
    by: "night",
    day: typeof r["day"] === "number" ? r["day"] : 0,
    rule: typeof r["rule"] === "string" ? r["rule"] : NIGHT_CLOSE_RULE,
    shows: typeof r["shows"] === "string" ? r["shows"] : "",
    why: typeof r["why"] === "string" ? r["why"] : "",
  };
}

/** Did a later memory's headline say PR `n` was merged (the verb right beside it)? */
function saysMerged(text: string, n: string): boolean {
  // A few words may stand between, as a name does ("#547 sidebar split merged"): this only lists, never closes.
  const after = new RegExp(String.raw`(?<![\w&])#${n}\b(?:\s*\([^)]{0,40}\))?(?:\s+[\w-]+){0,3}?\s+merged\b`, "i");
  const before = new RegExp(String.raw`\bmerged\s+(?:PR\s+|pull\s+)?#${n}\b`, "i");
  return after.test(text) || before.test(text);
}

/** The release a memory's headline says happened, per series: its highest FINAL patch. */
function releasesOf(keys: SubjectKeys): Map<string, number> {
  const out = new Map<string, number>();
  for (const [series, patch] of keys.versions) if (keys.final.get(series) === true) out.set(series, patch);
  return out;
}

interface Evidence {
  readonly row: WorkEventRow;
  readonly head: string;
  readonly at: number;
  readonly released: ReadonlyMap<string, number>;
}

/**
 * THE NIGHT'S CLOSE SWEEP: every open item the one rule reads as settled by
 * a later release in its folder, closed (`closeThread`'s write, with who and
 * why), oldest first, `budget` a night; and the "may be done" list replaced.
 * Under observer it counts and writes nothing. Never throws for one item: a
 * write that fails is counted `refused`.
 */
export function openCloseSweep(store: Store, input: OpenCloseInput): OpenCloseOutcome {
  const skipped: Record<string, number> = {};
  const skip = (why: OpenCloseSkip): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  if (!OPEN_CLOSE_TUNABLES.ON) return { on: false, examined: 0, closed: [], mayBeDone: [], skipped, skippedForLimit: 0 };
  const T = OPEN_CLOSE_TUNABLES;
  const slot = (scope: string): string => (T.SAME_FOLDER ? scope : "*");

  // The later side: live authored work memories, done or unmarked, by folder.
  const evidence = new Map<string, Evidence[]>();
  for (const r of store.workEventRows()) {
    if (r.status !== null && r.status !== "done") continue;
    const head = headline(r);
    const ev: Evidence = { row: r, head, at: r.createdAt, released: releasesOf(subjectKeys(head, "done")) };
    const list = evidence.get(slot(r.scope)) ?? [];
    list.push(ev);
    evidence.set(slot(r.scope), list);
  }
  const laterThan = (e: Evidence, item: { at: number | null; day: number; id: string }): boolean =>
    e.row.id !== item.id && (item.at !== null && item.at > 0 && e.at > 0 ? e.at > item.at : e.row.birthDay > item.day);

  const closed: NightClose[] = [];
  const maybe: MayBeDone[] = [];
  let examined = 0;
  let skippedForLimit = 0;
  for (const id of store.openThreadIds()) {
    const row = store.row(id);
    // Open as the wake reads it (`self/identity.ts#openThread`): one already
    // settled over under a successor is not an open item, whatever its flag.
    if (row === undefined || !openThread(store, id)) {
      skip("not-open");
      continue;
    }
    let meta: Record<string, unknown>;
    try {
      meta = store.readProse(id).meta;
    } catch {
      skip("not-open");
      continue;
    }
    if (meta[UNRESOLVED_META_KEY] !== true) {
      skip("not-open");
      continue;
    }
    examined += 1;
    const head = headline({ title: row.title ?? null, body: row.body });
    const settles = settlesWhenOf(meta);
    const scope = row.origin_scope ?? "";
    const pool = scope.length === 0 ? [] : (evidence.get(slot(scope)) ?? []);
    const item = { at: row.created_at ?? null, day: row.birth_day, id };
    const later = pool.filter((e) => laterThan(e, item));

    // What it might be, for the "may be done" list, when it isn't closed.
    const mayBe = (): MayBeDone | null => {
      if (A_CHECK.test(head)) return null;
      const words = [head, settles ?? ""].join(" \n ");
      // A release step whose series moved on.
      if (!CONDITIONAL.test(words)) {
        const named = subjectKeys(words, "any");
        let best: { e: Evidence; series: string; patch: number; theirs: number } | null = null;
        for (const [series, patch] of named.versions) {
          for (const e of later) {
            const theirs = e.released.get(series);
            if (theirs === undefined || theirs <= patch) continue;
            if (best === null || theirs - patch < best.theirs - best.patch) best = { e, series, patch, theirs };
          }
        }
        if (best !== null) return { id, why: `${best.series}.${String(best.theirs)} released since`, shows: best.e.row.id, from: "night" };
      }
      // A PR a later memory says merged.
      for (const m of words.matchAll(PR)) {
        const n = m[1] as string;
        const e = later.find((x) => saysMerged(x.head, n));
        if (e !== undefined) return { id, why: `#${n} merged since`, shows: e.row.id, from: "night" };
      }
      return null;
    };
    const notClosed = (why: OpenCloseSkip): void => {
      skip(why);
      const m = mayBe();
      if (m !== null && maybe.length < T.MAY_BE_DONE_MAX) maybe.push(m);
    };

    if (row.protected === 1) {
      skip("held");
      continue;
    }
    if (row.status === "asked") {
      notClosed("asked");
      continue;
    }
    if (typeof meta[THREAD_REOPENED_BY_META_KEY] === "string") {
      notClosed("reopened");
      continue;
    }
    if (A_CHECK.test(head)) {
      skip("a-check");
      continue;
    }
    if (CONDITIONAL.test(head)) {
      notClosed("conditional");
      continue;
    }
    const keys = subjectKeys(head, "step");
    if (keys.versions.size === 0) {
      notClosed("no-subject");
      continue;
    }
    if ([...keys.versions.keys()].every((s) => keys.final.get(s) === true)) {
      notClosed("final-already");
      continue;
    }
    // The NEAREST later release: the fewest patches on, then the earliest written.
    let best: { e: Evidence; key: string; gap: number } | null = null;
    for (const e of later) {
      if (e.released.size === 0) continue;
      const same = sameSubject(keys, { versions: e.released, final: new Map([...e.released.keys()].map((s) => [s, true])) });
      if (same === null || same.gap < 1) continue;
      const series = same.key.split("→")[0]?.split(".").slice(0, 2).join(".") ?? "";
      if (keys.final.get(series) === true) continue;
      if (best === null || same.gap < best.gap || (same.gap === best.gap && e.at < best.e.at)) best = { e, key: same.key, gap: same.gap };
    }
    if (best === null) {
      notClosed("no-later-release");
      continue;
    }
    if (closed.length >= input.budget) {
      skippedForLimit += 1;
      continue;
    }
    const to = best.key.split("→")[1] ?? "";
    const c: NightClose = { id, shows: best.e.row.id, rule: NIGHT_CLOSE_RULE, key: best.key, why: `${to} released` };
    if (!input.apply) {
      closed.push(c);
      continue;
    }
    if (!writeClose(store, c, input.day)) {
      skip("refused");
      continue;
    }
    closed.push(c);
  }
  if (input.apply) {
    try {
      store.setMeta(MAY_BE_DONE_META, JSON.stringify({ day: input.day, items: maybe.map((m) => ({ id: m.id, why: m.why, ...(m.shows === undefined ? {} : { shows: m.shows }) })) }));
    } catch {
      /* the list is a convenience: a failed write leaves last night's */
    }
  }
  return { on: true, examined, closed, mayBeDone: maybe, skipped, skippedForLimit };
}

/** The close itself: the flag false with who and why beside it, and one durable row. False when the write fails. */
function writeClose(store: Store, c: NightClose, day: number): boolean {
  const by: NightClosedBy = { by: "night", day, rule: c.rule, shows: c.shows, why: c.why };
  try {
    store.revise(c.id, { meta: { [UNRESOLVED_META_KEY]: false, [THREAD_CLOSED_BY_META_KEY]: by }, reason: "thread-closed" });
  } catch {
    return false;
  }
  try {
    store.appendEvent({ name: NIGHT_CLOSE_EVENT, day, ref: c.id, payload: { id: c.id, shows: c.shows, rule: c.rule, key: c.key, reason: c.why, day } });
  } catch {
    /* the meta carries it; the row is the count */
  }
  return true;
}

/**
 * REOPEN A NIGHT-CLOSED ITEM (the way back): the flag true again, reason
 * `thread-reopened`, `threadReopenedBy` set so no night closes it again on
 * its own, and one `thread.night.reopened` row naming what touched it
 * (`reopen`: the reflect tool's phase, on the owner's word; `updates`: a
 * write that carried the thread on). `restoreFlag` false: the thread lives
 * on a successor (an `updates` that said `unresolved: true`), so only the
 * record is written. Returns false when the item wasn't closed by a night.
 */
export function reopenNightClosed(store: Store, id: string, via: { readonly by: "reopen" | "updates"; readonly session?: string | null; readonly successor?: string | null; readonly restoreFlag: boolean }): boolean {
  let meta: Record<string, unknown>;
  try {
    meta = store.readProse(id).meta;
  } catch {
    return false;
  }
  const closedBy = nightClosedOf(meta);
  if (closedBy === null) return false;
  let undone = 0;
  if (via.restoreFlag) {
    store.revise(id, { meta: { [UNRESOLVED_META_KEY]: true, [THREAD_REOPENED_BY_META_KEY]: `night:${String(closedBy.day)}` }, reason: "thread-reopened" });
    // A closed item a later night's interference sweep faded under a newer
    // work event (`interference.ts`) is settled over, so out of Still open
    // whatever its flag says: that fade is undone too, and the sweep's
    // one-cut rule keeps it from fading again.
    try {
      for (const p of store.contradictionsOf([id]).get(id) ?? []) {
        if (p.source !== INTERFERENCE_SOURCE || p.a !== id || p.state !== "settled") continue;
        if (undo(store, { pair: p.id, actor: "session", actorId: via.session ?? null, why: "a night-closed item reopened" }).ok) undone += 1;
      }
    } catch {
      /* the flag is back; a fade left in place is the slow curve's */
    }
  }
  try {
    store.appendEvent({
      name: NIGHT_REOPEN_EVENT,
      day: store.livedDay(),
      ref: id,
      payload: { id, by: via.by, closedOn: closedBy.day, rule: closedBy.rule, ...(undone > 0 ? { fadeUndone: undone } : {}), ...(via.session ? { session: via.session } : {}), ...(via.successor ? { successor: via.successor } : {}) },
    });
  } catch {
    /* the flag is the state; the row is the count */
  }
  return true;
}

/**
 * WHAT MAY BE DONE, by item (read at `recall "still open"`): the night's list
 * (`MAY_BE_DONE_META`), then what the newest reflections thought looks done
 * but weren't sure of (their `closeProposed`, within `PROPOSED_DAYS` lived
 * days). Only items still open. Never throws: an unreadable store lists none.
 */
export function mayBeDoneOf(store: Store): Map<string, MayBeDone> {
  const out = new Map<string, MayBeDone>();
  const stillOpen = (id: string): boolean => {
    try {
      return store.readProse(id).meta[UNRESOLVED_META_KEY] === true;
    } catch {
      return false;
    }
  };
  try {
    const raw = store.getMeta(MAY_BE_DONE_META);
    if (raw !== undefined) {
      const parsed = JSON.parse(raw) as { items?: unknown };
      for (const x of Array.isArray(parsed.items) ? parsed.items : []) {
        if (typeof x !== "object" || x === null) continue;
        const r = x as Record<string, unknown>;
        if (typeof r["id"] !== "string" || typeof r["why"] !== "string") continue;
        out.set(r["id"], { id: r["id"], why: r["why"], ...(typeof r["shows"] === "string" ? { shows: r["shows"] } : {}), from: "night" });
      }
    }
  } catch {
    /* none from the night */
  }
  try {
    const day = store.livedDay();
    for (const r of store.reflections({ limit: 7 })) {
      const birth = typeof r.day === "number" ? r.day : day;
      if (day - birth > OPEN_CLOSE_TUNABLES.PROPOSED_DAYS) continue;
      let d: Record<string, unknown> = {};
      try {
        d = JSON.parse(r.detail ?? "{}") as Record<string, unknown>;
      } catch {
        continue;
      }
      const ids = Array.isArray(d["closeProposed"]) ? d["closeProposed"].filter((x): x is string => typeof x === "string") : [];
      for (const id of ids) if (!out.has(id)) out.set(id, { id, why: "the night's reflection thought it looks done", from: "reflection" });
    }
  } catch {
    /* none from the reflections */
  }
  for (const id of [...out.keys()]) if (!stillOpen(id)) out.delete(id);
  return out;
}

/** The closes of the newest night that closed anything, at or after lived day `sinceDay`, oldest first. */
export function lastNightCloses(store: Store, sinceDay: number): NightClose[] {
  try {
    const rows = store.eventLog({ name: NIGHT_CLOSE_EVENT, sinceDay, order: "desc", limit: 200 });
    if (rows.length === 0) return [];
    const newest = rows[0]?.day;
    return rows
      .filter((e) => e.day === newest)
      .reverse()
      .flatMap((e) => {
        try {
          const p = JSON.parse(e.payload ?? "{}") as Record<string, unknown>;
          if (typeof p["id"] !== "string") return [];
          return [{ id: p["id"], shows: typeof p["shows"] === "string" ? p["shows"] : "", rule: typeof p["rule"] === "string" ? p["rule"] : NIGHT_CLOSE_RULE, key: typeof p["key"] === "string" ? p["key"] : "", why: typeof p["reason"] === "string" ? p["reason"] : "" }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
