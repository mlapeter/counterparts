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
import type { ProseDoc, Store } from "../store/index.js";
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
}

export interface Scanned {
  readonly id: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly physics: MemoryPhysics;
  readonly doc: ProseDoc;
  readonly strength: number;
  readonly unresolved: boolean;
}

/**
 * One pass over the active memories. Called once per boundary render, never on
 * the wake path (contract §5 G1: wake computes nothing).
 */
export function scanActive(store: Store, day: number): Scanned[] {
  const out: Scanned[] = [];
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
    });
  }
  return out;
}

function byStrength(a: Ranked, b: Ranked): number {
  if (b.strength !== a.strength) return b.strength - a.strength;
  if (a.bornDay !== b.bornDay) return a.bornDay - b.bornDay;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

function rank(s: Scanned, lane: LaneName): Ranked {
  return {
    id: s.id,
    lane,
    kind: s.kind,
    band: s.band,
    strength: s.strength,
    protected: s.physics.protected,
    bornDay: s.doc.bornDay,
    personScoped: s.kind === "person",
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
 *   identity — every identity-band memory, strongest first (ties: older first,
 *              then id). Protected elements are INCLUDED: §14.1 G2's no-render
 *              rule guards the interpreter's schema slices — the falsification
 *              path — not the owner-facing wake (NOTES.md #2).
 *   craft    — skill-kind, not already in identity, above the warm floor. The
 *              procedural self is rendered as CONTENT, never a pointer (§1).
 *   threads  — `unresolved` memories: person-scoped first, oldest-opened first.
 *   hints    — everything else warm enough to be worth a nudge, strongest first.
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
    hints.push(rank(s, "hints"));
  }

  identity.sort(byStrength);
  craft.sort(byStrength);
  threads.sort(byThreadAge);
  hints.sort(byStrength);

  return {
    identity: identity.slice(0, t.IDENTITY_MAX),
    craft: craft.slice(0, t.CRAFT_MAX),
    threads: threads.slice(0, t.THREADS_MAX),
    hints: hints.slice(0, t.HINTS_MAX),
    horizon: horizon.slice(0, t.HORIZON_MAX),
  };
}

// ── enumeration (constitution 16, scar §2.19) ───────────────────────────────

export interface EnumeratedElement {
  readonly id: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly protected: boolean;
  readonly promotedIdentity: boolean;
  readonly title: string | null;
  readonly bytes: number;
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
  };
}

export function enumerate(store: Store, day: number): Enumeration {
  const identity: EnumeratedElement[] = [];
  const guarded: EnumeratedElement[] = [];

  for (const id of store.list({ band: "identity", archived: false })) {
    const e = enumerateOne(store, id, day);
    if (e !== null) identity.push(e);
  }
  // Protection is a physics flag, not a band: an element can be permanent
  // without ever having been promoted, which is exactly the case the pair makes
  // visible. There is no `protected` filter on `list()` (INTERFACE-GAPS #2).
  for (const id of store.list({ archived: false })) {
    const e = enumerateOne(store, id, day);
    if (e !== null && e.protected) guarded.push(e);
  }

  identity.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  guarded.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const identityIds = new Set(identity.map((e) => e.id));
  return {
    day,
    identity,
    protected: guarded,
    both: guarded.filter((e) => identityIds.has(e.id)).map((e) => e.id),
    protectedOutsideIdentity: guarded.filter((e) => !identityIds.has(e.id)).map((e) => e.id),
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
export function findIdentityCore(store: Store): string | null {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === IDENTITY_CORE_ROLE) return id;
    } catch {
      continue;
    }
  }
  return null;
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
  for (const id of [
    ...store.list({ band: "identity", archived: false }),
    ...store.list({ kind: "self", archived: false }),
  ]) {
    if (seen.has(id)) continue;
    seen.add(id);
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
  };
}
