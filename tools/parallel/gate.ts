/**
 * `tools/parallel/gate.ts` — CONTRACT §5 precondition 1, as a predicate.
 *
 * Replay's own `gateOpen()` is the CUTOVER gate and is untouched here: it
 * demands zero `not-exercised` and zero `needs-rater`, which NO replay record
 * can satisfy, because replay drives no turn loop. This file is the other gate
 * — "is the replay record green for THIS run's purposes" — and it is a
 * WHITELIST, not a relaxation: every id replay could not exercise must appear
 * in one of the enumerated sets below, by name, with the registry's own reason.
 * An id in neither set shuts the gate. That is the whole point: a mechanism
 * that STARVES in a future replay shows up here as a refusal, not as one more
 * row in a familiar list.
 *
 * ── WHY THERE ARE THREE SETS, NOT TWO ───────────────────────────────────────
 *
 * The CONTRACT's precondition-1 sentence names two: `PARALLEL_EXERCISABLE` and
 * `RATER_DEFERRED`. Read strictly, that is unsatisfiable, and the suite proves
 * it (`test/parallel.test.ts`, "the strict two-set reading shuts the gate on
 * the owner's own sample route"): the registry marks 23 ids `not-exercised`,
 * and only 13 of them are ids a parallel run can exercise. The other 10 say so
 * in their own `why` text — v1-mechanism vocabulary with no v2 counterpart, or
 * a surface covered by the seam suite rather than by any run. Putting them in
 * `PARALLEL_EXERCISABLE` would be a lie about what this run measures; leaving
 * them out kills the owner's ruled sample route (§5 P1, RULED 2026-09-03).
 *
 * So they get the CONTRACT's own third word. §5 G13: `not-applicable` — "a
 * criterion structurally out of scope ... enumerated in the run directory
 * before the phase begins; it needs no waiver and can never render green."
 * `NOT_APPLICABLE_TO_RUN` is that enumeration, and all three sets are copied
 * into the run directory exactly as precondition 1 requires.
 *
 * Nothing here imports either system under test (the independent-scorer rule,
 * [v1] §17.2 / replay G5) and nothing here writes.
 */
import type { Verdict } from "../replay/types.js";

import type { GateVerdict, Waiver } from "./types.js";

/**
 * The `not-exercised` ids ONLY a parallel run can exercise — §6's charter, id
 * by id, each read out of `tools/replay/baselines.ts` rather than guessed. The
 * registry's own `why` for each is quoted in the comment beside it.
 *
 * §1.4 (all four) and `reinforce.missMix` share one reason: "the replay driver
 * feeds the crash-fallback path ... it runs no turn loop, so no recall
 * decision, credit, or reinforcement is exercised."
 */
export const PARALLEL_EXERCISABLE: readonly string[] = [
  // §1.4 — the surfacing metrics. Real turns are the only way to move them.
  "surface.meanSurfaced",
  "surface.zeroSurfacedRate",
  "surface.meanFootnotes",
  "surface.affectFlagRate",
  // §1.5 — the loop replay structurally zeroed (`uses=0` on every row).
  "reinforce.missMix",
  // §1.8 — "measured forward, in the parallel run", in the registry's words.
  "episode.ingestedPerActiveDay",
  "episode.regrowRate",
  "episode.meanSalience",
  "episode.hasEmotionRate",
  // §1.7 — "no wake/turn loop in a fallback replay".
  "prospective.fireRate",
  "prospective.referenceRate",
  // §1.9 — "delivery is host-side and session-scoped".
  "wake.deliveredBytes",
  // §1.11 — "grading it needs a host that can drop a boundary — the parallel
  // run — not a driver that manufactures one per bucket." Named explicitly.
  "session.boundaryCoverage",
];

/**
 * The two `needs-rater` ids. Replay has no rater; this run is where they are
 * put to one (CONTRACT §5 P1: "no rater outside this run").
 */
export const RATER_DEFERRED: readonly string[] = [
  "prospective.gateTable",
  "surface.loudOffTopicRate",
];

/**
 * §5 G13's `not-applicable`, enumerated: `not-exercised` in replay AND out of
 * scope for the parallel run, each for a reason the registry states. These can
 * never render green anywhere; they are here so that an id NOT on any of the
 * three lists is visible the moment it appears.
 */
export const NOT_APPLICABLE_TO_RUN: readonly string[] = [
  // v1-mechanism vocabulary with no v2 counterpart to grade.
  "ops.outcomeMix",
  "gradient.moveMix",
  "decay.expireReasons",
  "hygiene.applyRate",
  "selfindex.refreshPerActiveDay",
  "thread.matchRate",
  // Covered by the seam suite, not by any run.
  "gate.episodeSurfaceShare",
  // Size-dependent; the size-independent port is `decay.changedShare`.
  "decay.rowsPerTick",
  // Measures the injected interpreter, not the system under test.
  "runner.duration",
  // Belongs to the owner's adapter; the run's stores are not backed up by it.
  "backup.snapshotsPerActiveDay",
];

/** Every `not-exercised` id this gate will accept, from both enumerated sets. */
export const KNOWN_NOT_EXERCISED: readonly string[] = [
  ...PARALLEL_EXERCISABLE,
  ...NOT_APPLICABLE_TO_RUN,
];

/** The three sets, in the shape precondition 1 copies into the run directory. */
export function gateSets(): {
  readonly parallelExercisable: readonly string[];
  readonly raterDeferred: readonly string[];
  readonly notApplicableToRun: readonly string[];
} {
  return {
    parallelExercisable: [...PARALLEL_EXERCISABLE],
    raterDeferred: [...RATER_DEFERRED],
    notApplicableToRun: [...NOT_APPLICABLE_TO_RUN],
  };
}

/**
 * What this predicate needs from a replay pass record. Structural, not nominal:
 * a record read off disk is JSON, and demanding the full `PassRecord` type
 * would make the reader import the renderer (which holds a write API).
 */
export interface GateReadableRecord {
  readonly runId: string;
  readonly readOnlyProof: boolean;
  readonly totalityOk: boolean;
  readonly sample: boolean;
  readonly counts: Readonly<Record<string, number>>;
  readonly verdicts: Readonly<Record<string, { readonly verdict: Verdict }>>;
}

/**
 * Read a pass record off disk into the shape above, or explain the refusal.
 *
 * `pass-record.json` is the file that carries per-id verdicts: `passRecord()`
 * in `tools/replay/report.ts` builds `verdicts[id] = { verdict, reason, value,
 * numerator, denominator }` from the scorecard's metrics. (`scorecard.json`
 * carries them too, in the scorer's own shape; the CONTRACT names the pass
 * record as the machine-readable artifact a switch reads, so this reads that.)
 */
export function parseGateRecord(raw: unknown): GateReadableRecord | string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return "the pass record is not a JSON object";
  }
  const r = raw as Record<string, unknown>;
  const runId = r["runId"];
  if (typeof runId !== "string" || runId.length === 0) {
    return "the pass record carries no runId";
  }
  const counts = r["counts"];
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    return `pass record ${runId} carries no counts block`;
  }
  const verdicts = r["verdicts"];
  if (verdicts === null || typeof verdicts !== "object" || Array.isArray(verdicts)) {
    return `pass record ${runId} carries no per-metric verdicts`;
  }
  const out: Record<string, { verdict: Verdict }> = {};
  for (const [id, value] of Object.entries(verdicts as Record<string, unknown>)) {
    const v = value as Record<string, unknown> | null;
    const verdict = v === null ? undefined : v["verdict"];
    if (typeof verdict !== "string") {
      return `pass record ${runId} has a verdict-less entry for ${id}`;
    }
    out[id] = { verdict: verdict as Verdict };
  }
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
    if (typeof v === "number") numeric[k] = v;
  }
  return {
    runId,
    readOnlyProof: r["readOnlyProof"] === true,
    totalityOk: r["totalityOk"] === true,
    sample: r["sample"] === true,
    counts: numeric,
    verdicts: out,
  };
}

/**
 * PRECONDITION 1, as a predicate. Every refusal names its reason; an open gate
 * returns an empty reason list, so a caller cannot mistake silence for detail.
 *
 * `sample: true` is refused UNLESS the run directory's `waivers.json` carries a
 * precondition-1 entry whose `recordId` is THIS record's `runId`. A waiver
 * naming another record is not a waiver for this one — that check is the reason
 * the id is on the file at all.
 */
export function parallelGateOpen(
  record: GateReadableRecord,
  waivers: readonly Waiver[],
): GateVerdict {
  const reasons: string[] = [];

  if (!record.readOnlyProof) {
    reasons.push("readOnlyProof is false: the replay reader was not proved read-only");
  }
  if (!record.totalityOk) {
    reasons.push("totalityOk is false: the scorecard does not cover the baselines");
  }
  const fails = record.counts["fail"] ?? 0;
  if (fails !== 0) {
    reasons.push(`counts.fail is ${fails}: only a run with zero failures opens this gate`);
  }

  const strayNotExercised: string[] = [];
  const strayRater: string[] = [];
  for (const [id, entry] of Object.entries(record.verdicts)) {
    if (entry.verdict === "not-exercised" && !KNOWN_NOT_EXERCISED.includes(id)) {
      strayNotExercised.push(id);
    }
    if (entry.verdict === "needs-rater" && !RATER_DEFERRED.includes(id)) {
      strayRater.push(id);
    }
  }
  if (strayNotExercised.length > 0) {
    reasons.push(
      `not-exercised outside PARALLEL_EXERCISABLE and NOT_APPLICABLE_TO_RUN: ${strayNotExercised
        .sort()
        .join(", ")}`,
    );
  }
  if (strayRater.length > 0) {
    reasons.push(`needs-rater outside RATER_DEFERRED: ${strayRater.sort().join(", ")}`);
  }

  if (record.sample) {
    const signed = waivers.filter(
      (w) => w.precondition === 1 && w.recordId === record.runId,
    );
    if (signed.length === 0) {
      const named = waivers
        .filter((w) => w.precondition === 1)
        .map((w) => w.recordId)
        .sort();
      reasons.push(
        named.length === 0
          ? `sample: true and no precondition-1 waiver names record ${record.runId}`
          : `sample: true and the precondition-1 waiver names ${named.join(", ")}, not ${record.runId}`,
      );
    } else {
      const incomplete = signed.filter(
        (w) =>
          w.signedBy.trim().length === 0 ||
          w.signedAt.trim().length === 0 ||
          w.reason.trim().length === 0,
      );
      if (incomplete.length === signed.length) {
        reasons.push(
          `sample: true and the waiver for ${record.runId} is missing signedBy, signedAt or reason`,
        );
      }
    }
  }

  return { open: reasons.length === 0, reasons };
}

/** Waivers as read off `waivers.json`. Malformed entries are dropped, counted. */
export function parseWaivers(raw: unknown): { waivers: Waiver[]; malformed: number } {
  const list = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)["waivers"])
      ? ((raw as Record<string, unknown>)["waivers"] as unknown[])
      : [];
  const waivers: Waiver[] = [];
  let malformed = 0;
  for (const entry of list) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      malformed += 1;
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e["precondition"] !== "number" || typeof e["recordId"] !== "string") {
      malformed += 1;
      continue;
    }
    waivers.push({
      precondition: e["precondition"],
      recordId: e["recordId"],
      signedBy: typeof e["signedBy"] === "string" ? e["signedBy"] : "",
      signedAt: typeof e["signedAt"] === "string" ? e["signedAt"] : "",
      reason: typeof e["reason"] === "string" ? e["reason"] : "",
    });
  }
  return { waivers, malformed };
}
