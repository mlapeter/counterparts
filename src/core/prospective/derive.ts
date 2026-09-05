/**
 * Derivation — **prospectivity is DERIVED, never stored** (§12 G2).
 *
 * There is no `isProspective` flag anywhere in this module, no column that says
 * so, and no author who can set one. Eligibility is a pure predicate over the
 * event date, the encode date, salience and flags, recomputed every time it is
 * asked. Three consequences, all of them the point:
 *
 *   - the property EXPIRES BY ITSELF when the window passes — no cleanup pass;
 *   - there is no second source of truth to drift from the memory;
 *   - decay has nothing to special-case (§12 G10: no decay exemption before
 *     arrival — a future-dated memory that faded before its window was an
 *     occasion that didn't matter).
 *
 * The dates come from the CALLER. This module does no NLP: it reads the shape of
 * a date string and nothing else (`windows.ts`). Whoever extracted "September"
 * from a sentence owns that judgment; the deriver owns only what follows from it.
 *
 * Every refusal has a NAME. "Not prospective" is not a verdict a log can act on,
 * and a memory excluded because it is a skill and one excluded because its window
 * already passed are different systems (scar §2.4).
 */
import type { Kind, Salience } from "../types.js";
import { sal } from "../physics/index.js";
import type { ProspectiveTunables } from "./tunables.js";
import { phaseOf, precisionOf, windowFor } from "./windows.js";
import type { Phase, Window } from "./windows.js";

export type DeriveReason =
  | "eligible"
  /** The memory carries no date at all — the undated "someday" reference. */
  | "no-event-date"
  /** A date string this module cannot read. Refused, never guessed. */
  | "malformed-date"
  /** Year-only precision can never tactfully arrive (§12 G3). */
  | "year-only-precision"
  /** A missing or unreadable encode date FAILS CONSERVATIVELY (§12 G3). */
  | "missing-encode-date"
  /** Archived memory never arrives; the id stays resolvable, it simply stays quiet. */
  | "archived"
  /** Skill memories are excluded by kind (§12 G3). */
  | "excluded-kind"
  /** A journal chapter. Its date is a day that was LIVED, never one arriving. */
  | "journal"
  | "below-salience-floor"
  /** Every derived window is behind us — the property expiring by itself. */
  | "window-passed";

/** Kinds that can never tactfully arrive. `task-state` is excluded STRUCTURALLY:
 *  v2's `Kind` has no such member, so it is a type error, not a runtime refusal
 *  (NOTES.md §3). */
export const EXCLUDED_KINDS: readonly Kind[] = ["skill"];

/**
 * What the deriver needs to know about a memory. Deliberately a plain shape and
 * not the store's row: derivation is a predicate, and a predicate that can only
 * be evaluated against a database is a query.
 */
export interface DerivableMemory {
  readonly id: string;
  readonly kind: Kind;
  readonly salience: Salience;
  readonly archived: boolean;
  /** The encode date (`ProseDoc.learnedOn`). Null / blank / unreadable fails closed. */
  readonly learnedOn: string | null;
  /**
   * A journal chapter (`ProseDoc.type === "episode"`, the field
   * `sleep/types.ts#isJournal` reads off the row).
   *
   * FOUND 2026-09-04 by the adversarial review of PR #70, and it is not a
   * labelling miss — it is a CATEGORY ERROR. A chapter's content date is the day
   * it was LIVED; "Arriving" is false of it no matter what word sits in front of
   * the line. Nothing on this path filtered by type — `Prospective.arrivals`
   * walks `list({ archived: false })` and the only kind excluded was `skill` —
   * so a dated chapter rendered in the wake's horizon lane as a thing about to
   * happen. Reproduced end to end: `at` on the chapter's own date returned it
   * `armed`, and the published briefing read
   * `Arriving: - 2026-09-05 (of 2026-09-10) · ## the lighthouse conversation`.
   *
   * Reachable on the owner's store: 224 migrated episodes are live, carrying
   * `happenedOn`, `learnedOn`, `kind: "self"` and a claimed salience floor.
   *
   * It is refused HERE, in the predicate, rather than at one caller — `derive`
   * has seven call sites in `prospective/index.ts` and a filter at one of them
   * is a rule that holds where somebody remembered it.
   */
  readonly journal: boolean;
}

/** A content-date the CALLER extracted. Its precision is its own shape (§12 G4). */
export interface ExtractedDate {
  readonly date: string;
}

export interface DerivedWindow extends Window {
  readonly phase: Phase;
}

export interface Prospectivity {
  readonly memoryId: string;
  readonly eligible: boolean;
  /** The first blocking reason, or "eligible". */
  readonly reason: DeriveReason;
  /** EVERY blocking reason — a memory can fail several ways at once. */
  readonly blockedBy: DeriveReason[];
  /** Windows from the dates that survived, oldest first. Present even when the
   *  memory is INELIGIBLE — a window is a derived fact about a date, and the exit
   *  accounting (§5 G12) needs to see the windows of memories that never fired.
   *  Eligibility is the verdict; `windows` is never one. */
  readonly windows: DerivedWindow[];
  /** Dates that did not become windows, each with the reason it did not. */
  readonly rejectedDates: { date: string; reason: DeriveReason }[];
  /** sal(m) as physics computes it — never a local re-derivation. */
  readonly salience: number;
}

function encodeDateOk(learnedOn: string | null): boolean {
  if (learnedOn === null) return false;
  const p = precisionOf(learnedOn);
  // The encode date is a real instant, so only a full day counts. A memory whose
  // encode date is "2026" cannot be reasoned about as-of anything, and the fail
  // direction is conservative: excluded, not admitted (§12 G3).
  return p === "day";
}

/**
 * The predicate. Pure, and cheap enough to run at read time — which is what makes
 * "derived, never stored" affordable rather than aspirational.
 *
 * `at` is the calendar day being asked about (a `YYYY-MM-DD` key). It is an
 * ARGUMENT: nothing here reads a clock, so an as-of question ("was this arriving
 * on July 5th?") is the same code path as today's.
 */
export function derive(
  memory: DerivableMemory,
  dates: readonly ExtractedDate[],
  at: string,
  t: ProspectiveTunables,
): Prospectivity {
  const blockedBy: DeriveReason[] = [];
  const s = sal(memory.salience);

  if (memory.archived) blockedBy.push("archived");
  if (memory.journal) blockedBy.push("journal");
  if (EXCLUDED_KINDS.includes(memory.kind)) blockedBy.push("excluded-kind");
  if (!encodeDateOk(memory.learnedOn)) blockedBy.push("missing-encode-date");
  if (s < t.SALIENCE_FLOOR) blockedBy.push("below-salience-floor");

  const windows: DerivedWindow[] = [];
  const rejectedDates: { date: string; reason: DeriveReason }[] = [];
  const seen = new Set<string>();
  for (const d of dates) {
    const precision = precisionOf(d.date);
    if (precision === null) {
      rejectedDates.push({ date: d.date, reason: "malformed-date" });
      continue;
    }
    if (precision === "year") {
      rejectedDates.push({ date: d.date, reason: "year-only-precision" });
      continue;
    }
    const w = windowFor(d.date, precision, t);
    if (w === null) {
      rejectedDates.push({ date: d.date, reason: "malformed-date" });
      continue;
    }
    if (seen.has(w.key)) continue;
    seen.add(w.key);
    windows.push({ ...w, phase: phaseOf(w, at) });
  }
  windows.sort((a, b) => (a.opensOn < b.opensOn ? -1 : a.opensOn > b.opensOn ? 1 : 0));

  if (windows.length === 0) {
    blockedBy.push(rejectedDates[0]?.reason ?? "no-event-date");
  } else if (windows.every((w) => w.phase === "passed")) {
    blockedBy.push("window-passed");
  }

  return {
    memoryId: memory.id,
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    windows,
    rejectedDates,
    salience: s,
  };
}
