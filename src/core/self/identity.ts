/**
 * Identity elements: ranking them for the briefing, enumerating them for the
 * owner, and the standing byte counter that trips before the self-schema can
 * dominate a prompt again.
 *
 * **Ranking is by strength, and that is the whole structure.** v1 kept a separate
 * derived identity *index* — its own budget, its own warmth ordering, its own
 * promotion path with zero production callers, and no reconciler — and it went
 * stale on the day it was seeded (contract §4, behavioral-spec §1 known gap). Here
 * identity elements are ordinary memories carrying strength, the briefing ranks
 * them, and there is no second structure to go stale. Identity-band memories are
 * decay-exempt in `physics/`, so their strength is their earned base: waking as
 * yourself is not a competition, but the order of the telling is.
 *
 * Nothing in this file reads a body into a decision record. Ranking works on rows
 * and physics; prose is read only for the `unresolved` flag (which the store has
 * no index for — INTERFACE-GAPS #2) and text arrives at render time through the
 * `Resolve` seam.
 */
import type { Band, Kind, MemoryPhysics } from "../types.js";
import { strength } from "../physics/index.js";
import type { ProseDoc, ReadOnlyStore, Store } from "../store/index.js";
import type { SelfTunables } from "./tunables.js";

export type LaneName = "identity" | "craft" | "threads" | "hints" | "horizon";

/** One candidate line. Ids only — text is resolved at render time. */
export interface Ranked {
  readonly id: string;
  readonly lane: LaneName;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly protected: boolean;
  readonly bornDay: number;
  /** Threads only: person-scoped debts trim last (behavioral-spec §1 G4). */
  readonly personScoped: boolean;
  /** Lived day this element last rendered in a wake; -1 never. Identity only. */
  readonly lastRendered: number;
  /**
   * Hints only (2026-09-25): WHY this hint ranked where it did. `score` is what
   * the lane is sorted by — strength x context boost x habituation — and the
   * rest is its working, ids and numbers only, so the briefing row can say per
   * hint whether it was context-boosted or habituated. Absent on every other
   * lane, which still sorts by strength or rotation.
   */
  readonly hint?: HintWhy;
}

/** Where a hint came from, relative to the session the render was composed for. */
export type HintContext = "session" | "scope" | "elsewhere" | "no-scope";

/** The habituation state a hint was ranked under. */
export type HintHabit =
  /** Never kept in a published hints lane, or its load has fully recovered. */
  | "fresh"
  /** Shown, and still carrying some of that showing's load. */
  | "habituated"
  /** Used AFTER it had left the wake — organic use, which resets the load. */
  | "reset";

export interface HintWhy {
  readonly score: number;
  readonly context: HintContext;
  /** The multiplier `context` bought: 1 for elsewhere / no-scope. */
  readonly boost: number;
  readonly habit: HintHabit;
  /** Accumulated showing load after recovery, at this day. 0 when fresh or reset. */
  readonly load: number;
  /** `1 / (1 + HINT_HABITUATION x load)` — 1 when fresh or reset. */
  readonly habituation: number;
}

/**
 * WHERE the render is composed FOR (2026-09-25). The briefing is rendered once
 * per lived day in the detached worker, and read by sessions in every directory
 * until the next render — so this is the scope and session of the boundary that
 * triggered the render, the nearest thing to "here" a pre-rendered bundle can
 * know (NOTES, "Nearby by context and habituation"). Absent: no context boost,
 * which is what every non-host caller (rebrief, replay, tests) gets.
 */
export interface RenderHere {
  readonly scope?: string | null;
  readonly session?: string | null;
}

/**
 * Meta key prefix for "this identity element last rendered on lived day N".
 * Written by `Self.boundary` for the identity ids it KEPT (rendered, not
 * merely ranked), read once per scan. The rotation below is the whole
 * consumer.
 */
export const RENDERED_PREFIX = "self.rendered.";

export function lastRenderedOf(store: Store): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of store.metaWithPrefix(RENDERED_PREFIX)) {
    const day = Number.parseInt(value, 10);
    if (Number.isFinite(day)) out.set(key.slice(RENDERED_PREFIX.length), day);
  }
  return out;
}

/**
 * Meta key prefix for a hint's SHOWN history (2026-09-25): `self.hinted.<id>` =
 * `<day>:<load>:<closed>`. `day` is the lived day of the render that last KEPT
 * it in the hints lane, `load` the accumulated showing load as of that day, and
 * `closed` the lived day of the first render that dropped it again, or `-`
 * while it is still in the published bundle. Written by `Self.boundary` on a
 * real publish only, beside `RENDERED_PREFIX`; no schema change. This is the
 * only shown history there is: the durable `self.briefing` row carried counts
 * and trimmed ids, never the kept hints, until this change.
 */
export const HINTED_PREFIX = "self.hinted.";

export interface HintRecord {
  readonly day: number;
  readonly load: number;
  /** Null while the hint is in the live bundle. */
  readonly closed: number | null;
}

export function parseHintRecord(value: string): HintRecord | null {
  const [d, l, c] = value.split(":");
  const day = Number.parseInt(d ?? "", 10);
  const load = Number.parseFloat(l ?? "");
  if (!Number.isFinite(day) || !Number.isFinite(load) || load < 0) return null;
  if (c === undefined || c === "-") return { day, load, closed: null };
  const closed = Number.parseInt(c, 10);
  return Number.isFinite(closed) ? { day, load, closed } : null;
}

export function formatHintRecord(r: HintRecord): string {
  return `${r.day}:${Math.round(r.load * 10_000) / 10_000}:${r.closed === null ? "-" : r.closed}`;
}

export function hintedOf(store: Store): Map<string, HintRecord> {
  const out = new Map<string, HintRecord>();
  for (const [key, value] of store.metaWithPrefix(HINTED_PREFIX)) {
    const r = parseHintRecord(value);
    if (r !== null) out.set(key.slice(HINTED_PREFIX.length), r);
  }
  return out;
}

export interface Scanned {
  readonly id: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly physics: MemoryPhysics;
  readonly doc: ProseDoc;
  readonly strength: number;
  readonly unresolved: boolean;
  /** Who minted it (`mint.ts`'s channels, plus `"migrated"`). NULL on a pre-v4
   *  row whose provenance was never recorded. Carried here because the render
   *  dates a MIGRATED element differently — its encode date is an upper bound. */
  readonly source: string | null;
  readonly lastRendered: number;
  /** Where it was minted — `origin_scope` / `origin_session`. Null when unrecorded. */
  readonly originScope: string | null;
  readonly originSession: string | null;
  /** Its shown history as a hint (`HINTED_PREFIX`), or null if never kept. */
  readonly hinted: HintRecord | null;
}

/**
 * One pass over the active memories. Called once per boundary render, never on
 * the wake path (contract §5 G1: wake computes nothing).
 */
export function scanActive(store: Store, day: number): Scanned[] {
  const out: Scanned[] = [];
  const rendered = lastRenderedOf(store);
  const hinted = hintedOf(store);
  for (const id of store.list({ type: "memory", archived: false })) {
    const row = store.row(id);
    if (row === undefined) continue;
    let doc: ProseDoc;
    let physics: MemoryPhysics;
    try {
      doc = store.readProse(id);
      physics = store.physicsOf(id);
    } catch {
      // A memory whose prose has gone missing must not take the whole briefing
      // down with it (contract §5 G7: the wake never fails the session). It is
      // skipped here and stays visible in `store` telemetry.
      continue;
    }
    out.push({
      id,
      kind: physics.kind,
      band: row.band,
      physics,
      doc,
      strength: strength(physics, day),
      unresolved: doc.meta["unresolved"] === true,
      source: row.source,
      lastRendered: rendered.get(id) ?? -1,
      originScope: nonEmpty(row.origin_scope),
      originSession: nonEmpty(row.origin_session),
      hinted: hinted.get(id) ?? null,
    });
  }
  return out;
}

function nonEmpty(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function byStrength(a: Ranked, b: Ranked): number {
  if (b.strength !== a.strength) return b.strength - a.strength;
  if (a.bornDay !== b.bornDay) return a.bornDay - b.bornDay;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Identity ROTATES; it does not rank (CONTRACT §3: "re-inhabited, not
 * retrieved — core memories are constitutive, not competed for in a ranker").
 * Least-recently-rendered first, never-rendered ahead of everything, and only
 * then strength, born-day, id. Measured 2026-09-14 on the owner's store
 * (IMPROVEMENTS U6): eight identity elements tied at strength 1.0, the tie
 * broke oldest-born-first, the three winners were the three written on
 * migration day under a fresh clock, and 17 of 20 identity beliefs had never
 * rendered. A strength sort with a smarter tie-break would rotate the eight;
 * this rotates all of them.
 */
function byRotation(a: Ranked, b: Ranked): number {
  if (a.lastRendered !== b.lastRendered) return a.lastRendered - b.lastRendered;
  return byStrength(a, b);
}

/**
 * Hints order (2026-09-25): by `score` = strength x context boost x
 * habituation, then the strength order breaks ties. Not `byStrength`: craft
 * still uses that, and a hint's `strength` field keeps meaning strength.
 */
function byHintScore(a: Ranked, b: Ranked): number {
  const sa = a.hint?.score ?? a.strength;
  const sb = b.hint?.score ?? b.strength;
  if (sb !== sa) return sb - sa;
  return byStrength(a, b);
}

// ── hints: context and habituation (2026-09-25) ─────────────────────────────

/**
 * The habituation reading of one memory's shown history, at day `day`.
 *
 *   - Never kept as a hint → fresh, factor 1.
 *   - Kept, then LEFT the bundle (`closed`), then used on a later lived day
 *     than the render that dropped it → reset, factor 1. That is organic use:
 *     the memory was not on display, so the use was not the display's echo.
 *   - Otherwise the load recovers exponentially from the day it was last kept,
 *     time constant `HINT_RECOVERY_DAYS`. A record still OPEN (it is in the
 *     live bundle) also settles its pending showing here: +1 if it was not used
 *     since, +`HINT_USED_STEP` if it was. A use while on display is NOT a full
 *     reset, on purpose: it cannot be told from the display prompting it, and
 *     "shown → mentioned → credited → shown again" is the loop this exists to
 *     break (NOTES, "Nearby by context and habituation").
 *
 * On the record's own lived day (a second render the same day) nothing settles
 * and nothing recovers: one showing per lived day, as with credit.
 */
export function habituationOf(
  record: HintRecord | null,
  lastUsedDay: number,
  day: number,
  t: SelfTunables,
): { habit: HintHabit; load: number; habituation: number; settled: number } {
  if (record === null) return { habit: "fresh", load: 0, habituation: 1, settled: 0 };
  if (record.closed !== null && lastUsedDay > record.closed) {
    return { habit: "reset", load: 0, habituation: 1, settled: 0 };
  }
  const elapsed = Math.max(0, day - record.day);
  // `settled` = the load AS OF `record.day`, the pending showing included.
  const settled =
    record.closed !== null || elapsed === 0
      ? record.load
      : record.load + (lastUsedDay >= record.day ? t.HINT_USED_STEP : 1);
  const load = settled * Math.exp(-elapsed / t.HINT_RECOVERY_DAYS);
  const habituation = 1 / (1 + t.HINT_HABITUATION * load);
  return { habit: load > 0 ? "habituated" : "fresh", load, habituation, settled };
}

/** The context boost for a memory minted at `originScope` / `originSession`. */
export function contextOf(
  s: Pick<Scanned, "originScope" | "originSession">,
  here: RenderHere | undefined,
  t: SelfTunables,
): { context: HintContext; boost: number } {
  const scope = nonEmpty(here?.scope);
  const session = nonEmpty(here?.session);
  if (scope === null && session === null) return { context: "no-scope", boost: 1 };
  const sameScope = scope !== null && s.originScope === scope;
  const sameSession = session !== null && s.originSession === session;
  if (sameSession) {
    return {
      context: "session",
      boost: (sameScope ? t.HINT_SCOPE_BOOST : 1) * t.HINT_SESSION_BOOST,
    };
  }
  if (sameScope) return { context: "scope", boost: t.HINT_SCOPE_BOOST };
  return { context: "elsewhere", boost: 1 };
}

/**
 * The lived day of the memory's last REAL use, or -1 if it was never credited.
 * A never-used memory carries `lastUsedDay === birthDay` (birth is not a use,
 * and `creditUse` refuses it), so reading `lastUsedDay` raw would count a hint
 * first shown on the day it was minted as "used while on display".
 */
function lastRealUse(s: Scanned): number {
  return s.physics.lastUsedDay > s.physics.birthDay ? s.physics.lastUsedDay : -1;
}

function hintWhy(s: Scanned, day: number, here: RenderHere | undefined, t: SelfTunables): HintWhy {
  const { context, boost } = contextOf(s, here, t);
  const h = habituationOf(s.hinted, lastRealUse(s), day, t);
  return {
    score: s.strength * boost * h.habituation,
    context,
    boost,
    habit: h.habit,
    load: h.load,
    habituation: h.habituation,
  };
}

/**
 * The shown-history writes one publish owes, as meta entries. Pure:
 * `Self.boundary` applies them on a real publish and on nothing else (an
 * observer composes and deposits nothing; `build` never writes).
 *
 *   - every hint the bundle KEPT (rendered, not merely ranked — the same rule
 *     as `RENDERED_PREFIX`): `{day, load as of today, open}`;
 *   - every record that was OPEN (in the previous bundle) and is not kept now:
 *     closed at today, with its pending showing settled.
 *
 * A record already kept on this same lived day is left as it is.
 */
export function hintRecordWrites(
  scanned: readonly Scanned[],
  keptHints: readonly string[],
  day: number,
  t: SelfTunables,
): (readonly [string, string])[] {
  const kept = new Set(keptHints);
  const out: (readonly [string, string])[] = [];
  for (const s of scanned) {
    const r = s.hinted;
    if (kept.has(s.id)) {
      if (r !== null && r.closed === null && r.day === day) continue;
      const h = habituationOf(r, lastRealUse(s), day, t);
      out.push([`${HINTED_PREFIX}${s.id}`, formatHintRecord({ day, load: h.load, closed: null })]);
      continue;
    }
    if (r !== null && r.closed === null) {
      // Closing always settles the pending showing — including on the record's
      // own day (a same-day rebrief that dropped it), where `habituationOf`
      // deliberately settles nothing because the hint might be kept again.
      const step = lastRealUse(s) >= r.day ? t.HINT_USED_STEP : 1;
      out.push([
        `${HINTED_PREFIX}${s.id}`,
        formatHintRecord({ day: r.day, load: r.load + step, closed: day }),
      ]);
    }
  }
  return out;
}

/**
 * Threads order: person-scoped first, then oldest-opened first. The trim eats
 * from the END of the lane, so long-held relational debts drop last
 * (behavioral-spec §1 G4 — *truncation must never be iteration luck*).
 */
function byThreadAge(a: Ranked, b: Ranked): number {
  if (a.personScoped !== b.personScoped) return a.personScoped ? -1 : 1;
  if (a.bornDay !== b.bornDay) return a.bornDay - b.bornDay;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rank(s: Scanned, lane: LaneName, hint?: HintWhy): Ranked {
  return {
    ...(hint === undefined ? {} : { hint }),
    id: s.id,
    lane,
    kind: s.kind,
    band: s.band,
    strength: s.strength,
    protected: s.physics.protected,
    bornDay: s.doc.bornDay,
    personScoped: s.kind === "person",
    lastRendered: s.lastRendered,
  };
}

export interface Lanes {
  identity: Ranked[];
  craft: Ranked[];
  threads: Ranked[];
  hints: Ranked[];
  horizon: Ranked[];
}

/**
 * The contract's ordering, in one place:
 *
 *   identity — every identity-band memory, least-recently-rendered first
 *              (`byRotation`); strength, born-day and id only break ties. Protected elements are INCLUDED: §14.1 G2's no-render
 *              rule guards the interpreter's schema slices — the falsification
 *              path — not the owner-facing wake (NOTES.md #2). A composition
 *              that is NOT owner-facing says so with `BoundaryRequest.omit`, and
 *              the sweep's wake copy passes exactly that predicate: protected and
 *              confidential rows never reach an interpreter's prompt, by either
 *              door.
 *   craft    — skill-kind, not already in identity, above the warm floor. The
 *              procedural self is rendered as CONTENT, never a pointer (§1).
 *   threads  — `unresolved` memories: person-scoped first, oldest-opened first.
 *   hints    — everything else warm enough to be worth a nudge, ordered by
 *              strength x context boost x habituation (2026-09-25; it was
 *              "strongest first", which let one strong memory hold the lane
 *              every day — NOTES, "Nearby by context and habituation"). The
 *              warm floor still reads STRENGTH alone: context and habituation
 *              reorder the lane, they never admit a memory or bar one.
 *   horizon  — the caller's arriving occasions, in the order supplied
 *              (`prospective/` owns the ordering — INTERFACE-GAPS #3).
 *
 * A memory appears in exactly one lane: identity wins, then craft, then threads,
 * then hints. Two lanes showing the same statement is budget spent twice.
 */
export function rankLanes(
  scanned: readonly Scanned[],
  horizon: readonly Ranked[],
  t: SelfTunables,
  here?: RenderHere,
  day?: number,
): Lanes {
  const identity: Ranked[] = [];
  const craft: Ranked[] = [];
  const threads: Ranked[] = [];
  const hints: Ranked[] = [];

  for (const s of scanned) {
    if (s.band === "identity") {
      identity.push(rank(s, "identity"));
      continue;
    }
    if (s.unresolved) {
      threads.push(rank(s, "threads"));
      continue;
    }
    if (s.strength < t.WARM_FLOOR) continue;
    if (s.kind === "skill") {
      craft.push(rank(s, "craft"));
      continue;
    }
    // `day` absent: no clock to settle habituation against, so the reading is
    // taken at the record's own day (nothing settles, nothing recovers). Only
    // the pure-ranking tests call it that way; `Self.build` always passes one.
    hints.push(rank(s, "hints", hintWhy(s, day ?? s.hinted?.day ?? 0, here, t)));
  }

  identity.sort(byRotation);
  craft.sort(byStrength);
  threads.sort(byThreadAge);
  hints.sort(byHintScore);

  return {
    identity: identity.slice(0, t.IDENTITY_MAX),
    craft: craft.slice(0, t.CRAFT_MAX),
    threads: threads.slice(0, t.THREADS_MAX),
    hints: hints.slice(0, t.HINTS_MAX),
    horizon: horizon.slice(0, t.HORIZON_MAX),
  };
}

// ── enumeration (constitution 16, scar §2.19) ───────────────────────────────

/**
 * Why an element is listed but cannot be shown.
 *
 * `removed` is the owner's erasure answering: the deny-list refuses the id by
 * name, and the tombstone says it WAS permanent. `unreadable` is everything
 * else — a row whose prose will not parse or has gone missing.
 *
 * The distinction is the whole point: an enumeration that silently dropped both
 * would make "everything permanent is enumerable" a claim about the elements
 * that happen to still work (scar §2.19), and a removed protected element would
 * leave the permanent list without leaving a trace.
 */
export type EnumeratedAbsence = "removed" | "unreadable";

/** The words an absent element carries where a title would go. */
export const ABSENT_TITLE: Record<EnumeratedAbsence, string> = {
  removed: "[removed]",
  unreadable: "[unreadable]",
};

export interface EnumeratedElement {
  readonly id: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly protected: boolean;
  readonly promotedIdentity: boolean;
  readonly title: string | null;
  readonly bytes: number;
  /** Null when the element is present and readable. Otherwise names WHY not. */
  readonly absent: EnumeratedAbsence | null;
}

/**
 * The identity band and the protected set, SIDE BY SIDE.
 *
 * They are different populations and the difference is the point: identity is
 * what strength earned and physics can still move; protected is permanent ink no
 * revision path can reach and no schema slice will ever contradict
 * ("permanent-includes-permanently-wrong" is doctrine, §14.1 G2). Scar §2.19's
 * criterion is that everything permanent is enumerable on demand — *a list, not a
 * cadence* — and the pair read together is what makes an element that is both,
 * or neither, visible at a glance.
 *
 * Reads are pure: this writes nothing and logs nothing (§14.1 G8).
 */
export interface Enumeration {
  readonly day: number;
  readonly identity: EnumeratedElement[];
  readonly protected: EnumeratedElement[];
  /** Ids in both lists — permanent AND constitutive, the strictest class. */
  readonly both: string[];
  /** Protected elements that are NOT identity band: permanence without the band. */
  readonly protectedOutsideIdentity: string[];
  /** Ids in either half that could not be shown, with the reason. Never silent. */
  readonly absences: { id: string; where: "identity" | "protected"; why: EnumeratedAbsence }[];
}

const encoder = new TextEncoder();

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

function enumerateOne(store: Store, id: string, day: number): EnumeratedElement | null {
  const row = store.row(id);
  if (row === undefined) return null;
  let doc: ProseDoc;
  let physics: MemoryPhysics;
  try {
    doc = store.readProse(id);
    physics = store.physicsOf(id);
  } catch {
    return null;
  }
  return {
    id,
    kind: physics.kind,
    band: row.band,
    strength: strength(physics, day),
    protected: physics.protected,
    promotedIdentity: physics.promotedIdentity,
    title: doc.title ?? null,
    bytes: byteLength(doc.body),
    absent: null,
  };
}

/**
 * The entry an element gets when it is on a list it cannot be read from. It
 * keeps its address, its family and its flags, and carries no strength and no
 * bytes: it weighs nothing, because there is nothing left of it to weigh.
 */
function absentElement(
  id: string,
  why: EnumeratedAbsence,
  was: { kind: Kind; band: Band; protected: boolean; promotedIdentity: boolean },
): EnumeratedElement {
  return {
    id,
    kind: was.kind,
    band: was.band,
    strength: 0,
    protected: was.protected,
    promotedIdentity: was.promotedIdentity,
    title: ABSENT_TITLE[why],
    bytes: 0,
    absent: why,
  };
}

export function enumerate(store: Store, day: number): Enumeration {
  const identity: EnumeratedElement[] = [];
  const guarded: EnumeratedElement[] = [];
  const absences: Enumeration["absences"] = [];
  const denied = new Set(store.deniedIds());

  const absentFromRow = (id: string, where: "identity" | "protected"): EnumeratedElement => {
    // The row is still there; the CONTENT is not. A denied id says so by name —
    // that is the deny-list answering before the prose does — and anything else
    // is honestly "unreadable", which is a different problem with a different fix.
    const why: EnumeratedAbsence = denied.has(id) ? "removed" : "unreadable";
    const row = store.row(id);
    absences.push({ id, where, why });
    return absentElement(id, why, {
      kind: (row?.kind ?? "fact") as Kind,
      band: (row?.band ?? "episodic") as Band,
      protected: row?.protected === 1,
      promotedIdentity: row?.promoted_identity === 1,
    });
  };

  for (const id of store.list({ band: "identity", archived: false })) {
    const e = enumerateOne(store, id, day);
    identity.push(e ?? absentFromRow(id, "identity"));
  }
  // Protection is a physics flag, not a band: an element can be permanent
  // without ever having been promoted, which is exactly the case the pair makes
  // visible. There is no `protected` filter on `list()` (INTERFACE-GAPS #2).
  for (const id of store.list({ archived: false })) {
    const e = enumerateOne(store, id, day);
    if (e === null) {
      // An unreadable row cannot be asked whether it was protected, so the
      // permanent half has to ask the store instead of the row. A dark-but-not-
      // yet-chased row still carries its flag; a chased one carries a tombstone.
      const row = store.row(id);
      if (row?.protected === 1) guarded.push(absentFromRow(id, "protected"));
      continue;
    }
    if (e.protected) guarded.push(e);
  }

  // The chased half: rows the owner removed keep a tombstone saying what they
  // WERE, so permanence and inspectability scale together even here (§2.19).
  // Their skeleton row carries no flags any more — the tombstone is the record.
  const listed = new Set([...identity, ...guarded].map((e) => e.id));
  for (const gone of store.tombstones()) {
    const was = {
      kind: gone.kind,
      band: gone.band,
      protected: gone.wasProtected,
      promotedIdentity: gone.wasPromotedIdentity,
    };
    if ((gone.wasPromotedIdentity || gone.band === "identity") && !listed.has(gone.id)) {
      identity.push(absentElement(gone.id, "removed", was));
      absences.push({ id: gone.id, where: "identity", why: "removed" });
    }
    if (gone.wasProtected && !guarded.some((e) => e.id === gone.id)) {
      guarded.push(absentElement(gone.id, "removed", was));
      absences.push({ id: gone.id, where: "protected", why: "removed" });
    }
  }

  identity.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  guarded.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  absences.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.where < b.where ? -1 : 1));

  const identityIds = new Set(identity.map((e) => e.id));
  return {
    day,
    identity,
    protected: guarded,
    both: guarded.filter((e) => identityIds.has(e.id)).map((e) => e.id),
    protectedOutsideIdentity: guarded.filter((e) => !identityIds.has(e.id)).map((e) => e.id),
    absences,
  };
}

// ── the identity core's HOME row (schemas/INTERFACE-GAPS #5) ────────────────

/**
 * The identity core is a PLACE, not a claim, and not a second identity surface.
 *
 * `schemas/` refuses to birth `kind: "self"` in two independent layers — "one
 * identity core; a second is a category error no evidence could justify" — so the
 * one row that says *the self exists as an entity here* can only come from this
 * module. Without it, `schemas/`'s placement rule degrades from
 * `status-on-identity-refused` to `entity-unknown`: still a refusal, but the
 * wrong one, and a silent weakening of the ~72 KB lesson (contract §5 G4) exactly
 * where it matters most.
 *
 * What this is NOT: v1's identity *index* — its own budget, warmth ordering,
 * promotion path and reconciler — which the contract drops and this build does
 * not have. Identity STATEMENTS remain ordinary memories ranked by strength; this
 * is one empty schema row carrying names, which is what "a newborn schema is
 * empty except its names" means.
 */
export const IDENTITY_CORE_ROLE = "entity";

export interface IdentityCoreSpec {
  /** The core's name. This module never invents one (INTERFACE-GAPS #8). */
  readonly name: string;
  readonly aliases?: readonly string[];
}

/** The existing core, if one has been minted. At most one may exist. */
export function findIdentityCore(store: ReadOnlyStore): string | null {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === IDENTITY_CORE_ROLE) return id;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The core's NAME, for the day-0 lane (`briefing.ts#identityCoreLine`).
 *
 * `ensureIdentityCore` writes the name into three places — title, body and
 * `meta.name` — and `meta.name` is the one `schemas/` indexes, so it is read
 * first, with the title as the fallback for a row written before that shape
 * settled. Null when no core has been minted: this module invents no name
 * (INTERFACE-GAPS #8), and a store installed without `--name` renders exactly
 * what it rendered before.
 *
 * The CALLER is expected to have checked that the identity lane is empty first.
 * This reads prose, so it belongs at a boundary and never on the wake path
 * (contract §5 G1); on any store with even one identity element it is never
 * reached.
 */
export function identityCoreName(store: Store): string | null {
  const id = findIdentityCore(store);
  if (id === null) return null;
  try {
    const doc = store.readProse(id);
    const name = doc.meta["name"];
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
    const title = (doc.title ?? "").trim();
    return title.length > 0 ? title : null;
  } catch {
    // A core whose prose will not read is not a reason to fail the wake (§5 G7).
    return null;
  }
}

// ── the standing self-schema byte counter (contract §5 G4) ──────────────────

export interface SchemaBytesReport {
  readonly bytes: number;
  readonly elements: number;
  readonly trip: number;
  readonly pressureAt: number;
  readonly pressure: boolean;
  readonly tripped: boolean;
  /** The heaviest elements, id + bytes, so the report names its own cause. */
  readonly heaviest: { id: string; bytes: number }[];
  /**
   * Fallback-minted self memories EXCLUDED from this weighing — the quarantine
   * (owner ruling 2026-08-29, review F8): a model reading transcripts must not
   * grow the self through the rumination pathway the CONTRACT forswears. They
   * remain ordinary, recallable memories; here they are counted, never silently
   * absent (scar §2.4). The first blind replay minted 205 of them and tripped
   * this very valve seven times.
   */
  readonly quarantined: number;
  /** The bytes those rows would have weighed — what the quarantine set aside. */
  readonly quarantinedBytes: number;
  /**
   * Episodes EXCLUDED from this weighing (day-0 finding, 2026-09-03): the journal
   * is `kind: self` prose, but it is not the self schema — v1's ~72 KB scar was
   * status accreting on `self.md`, not the diary. Weighing 224 migrated chapters
   * read the valve tripped at 3 MB on a store nobody had written to yet, and every
   * authored chapter after would have kept it tripped. Counted, never absent.
   */
  readonly episodes: number;
  readonly episodeBytes: number;
  /**
   * Migrated self rows EXCLUDED for the same reason the fallback rows are: the
   * valve watches what THIS system accumulates on the self (§5 G4: "status does
   * not accumulate"), and v1's thousand self-kind traces arrived in one write.
   * They remain ordinary, recallable memories; here they are counted.
   */
  readonly migrated: number;
  readonly migratedBytes: number;
}

/**
 * Status does not accumulate on the self. v1's `currentState` reached ~72 KB of
 * self-narration before anyone measured it — the counter exists so the next time
 * is a tripwire and not an archaeology project (earned-mechanism #5, scar §2.4:
 * an event when APPROACHED and an event when crossed).
 */
export function schemaBytes(store: Store, day: number, t: SelfTunables): SchemaBytesReport {
  const seen = new Set<string>();
  const weighed: { id: string; bytes: number }[] = [];
  let quarantined = 0;
  let quarantinedBytes = 0;
  let episodes = 0;
  let episodeBytes = 0;
  let migrated = 0;
  let migratedBytes = 0;
  for (const id of [
    ...store.list({ band: "identity", archived: false }),
    ...store.list({ kind: "self", archived: false }),
  ]) {
    if (seen.has(id)) continue;
    seen.add(id);
    // The quarantine (see the report field). Two exemptions, both earned:
    // identity-band rows got there by a counted crossing (nothing is born into
    // identity), and PROTECTED rows are a deliberate owner act — and since
    // `enumerate()` renders every protected row, exempting them here keeps the
    // measured set equal to the rendered set (PR-2 review should-fix 2: a
    // weighed prompt byte must never be invisible to the byte valve).
    const row = store.row(id);
    if (row !== undefined && row.type === "episode" && row.band !== "identity" && row.protected !== 1) {
      episodes += 1;
      const e = enumerateOne(store, id, day);
      if (e !== null) episodeBytes += e.bytes;
      continue;
    }
    if (
      row !== undefined &&
      row.source === "migrated" &&
      row.band !== "identity" &&
      row.protected !== 1
    ) {
      migrated += 1;
      const m = enumerateOne(store, id, day);
      if (m !== null) migratedBytes += m.bytes;
      continue;
    }
    if (
      row !== undefined &&
      row.source === "fallback" &&
      row.band !== "identity" &&
      row.protected !== 1
    ) {
      quarantined += 1;
      const q = enumerateOne(store, id, day);
      if (q !== null) quarantinedBytes += q.bytes;
      continue;
    }
    const e = enumerateOne(store, id, day);
    if (e !== null) weighed.push({ id, bytes: e.bytes });
  }
  const bytes = weighed.reduce((n, w) => n + w.bytes, 0);
  weighed.sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1));
  const pressureAt = Math.round(t.SCHEMA_BYTES_TRIP * t.SCHEMA_BYTES_PRESSURE);
  return {
    bytes,
    elements: weighed.length,
    trip: t.SCHEMA_BYTES_TRIP,
    pressureAt,
    pressure: bytes >= pressureAt,
    tripped: bytes >= t.SCHEMA_BYTES_TRIP,
    heaviest: weighed.slice(0, 5),
    quarantined,
    quarantinedBytes,
    episodes,
    episodeBytes,
    migrated,
    migratedBytes,
  };
}
