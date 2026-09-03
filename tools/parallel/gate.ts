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
 * `NOT_APPLICABLE_TO_RUN` is that enumeration, and all three sets — plus the
 * fourth below, `WIRING_ALIVE` — are copied into the run directory exactly as
 * precondition 1 requires.
 *
 * ── NO WAIVER. THE WIRING-ALIVE PREDICATE (RULED 2026-09-03, owner) ─────────
 *
 * The first build of this file refused a `sample: true` record unless an
 * owner-signed `waivers.json` in the run directory named it. The owner struck
 * that: *"I'm not sure our intent was to require signing things to change
 * them."* Signing is ceremony, and a signature proves who typed it, never that
 * the instrument was plugged in.
 *
 * What the gate asks instead is mechanical and reads the record itself: **is
 * the wiring proven alive?** `WIRING_ALIVE` below is that question as a small
 * named set of checks over the pass record's own per-metric verdicts and
 * observed values — cards were shown, not every chunk encoded blind, the gate
 * battery's mix was actually computed. A record that carries those channels
 * alive opens this gate whether it is a full re-run or the queued sample.
 *
 * BAND FAILURES ARE NOT WAIVED BY ANYONE — they are simply not this gate's
 * business. `counts.fail === 0` was the old regime's other half, and it made
 * the owner's own ruled sample route unsatisfiable: the sample's bands are v1's
 * numbers, which §5 G15 says are "calibration to re-earn, not inherited law"
 * (replay G10). The run's own bands judge the run. What is still refused is
 * MISSING EVIDENCE: an absent `sample` flag, an absent `counts.fail`, a verdict
 * outside replay's vocabulary, a header that disagrees with its own rows, or a
 * wiring channel that cannot be read. A gate whose fields fail open is a
 * document.
 *
 * Nothing here imports either system under test (the independent-scorer rule,
 * [v1] §17.2 / replay G5) and nothing here writes.
 */
import { VERDICTS } from "../replay/types.js";
import type { Verdict } from "../replay/types.js";

import type { GateVerdict } from "./types.js";

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

/**
 * What this predicate needs from a replay pass record. Structural, not nominal:
 * a record read off disk is JSON, and demanding the full `PassRecord` type
 * would make the reader import the renderer (which holds a write API).
 *
 * `value` is the metric's OBSERVED number (`report.ts#passRecord`:
 * `value: m.observed === null ? null : m.observed.value`), and it is here
 * because one wiring check reads a number rather than a verdict: a blind rate
 * of exactly 1.0 can sit inside no band at all and still be the one reading
 * that means the cards channel reached nothing.
 */
export interface GateEntry {
  readonly verdict: Verdict;
  readonly value: number | null;
}

export interface GateReadableRecord {
  readonly runId: string;
  readonly readOnlyProof: boolean;
  readonly totalityOk: boolean;
  readonly sample: boolean;
  readonly counts: Readonly<Record<string, number>>;
  readonly verdicts: Readonly<Record<string, GateEntry>>;
}

/**
 * ONE WIRING CHECK: a channel this run depends on, read off the record the run
 * starts from, with its own refusal sentence.
 */
export interface WiringCheck {
  /** The pass-record metric id it reads. */
  readonly id: string;
  /** Which channel being alive this reading proves. Copied into the run dir. */
  readonly proves: string;
  /** The refusal, or null when the channel is proven alive. */
  readonly refusal: (entry: GateEntry | undefined) => string | null;
}

const absent = (id: string): string =>
  `${id} is absent from the record's verdicts: precondition 1 reads the wiring off the rows, and a row that is not there is not a live channel`;

/**
 * PRECONDITION 1's replacement for the waiver (RULED 2026-09-03, owner): the
 * wiring is proven alive, checked mechanically, on whichever record the run
 * starts from — sample or full.
 *
 * Three channels, each the one that was DEAD in the first replay run and had to
 * be rebuilt (the schema-slice wire, PR #6): preselection showing cards at all,
 * the cards reaching some chunk rather than every chunk encoding blind, and the
 * gate battery's mix actually computed rather than never fired. Bands are not
 * asked about here — a channel can be alive and out of v1's band, which is what
 * "calibration to re-earn" means (§5 G15).
 */
export const WIRING_ALIVE: readonly WiringCheck[] = [
  {
    id: "preselect.meanSchemasShown",
    proves: "cards were shown — preselection had a schema slice to select from",
    refusal: (e) => {
      if (e === undefined) return absent("preselect.meanSchemasShown");
      return e.verdict === "pass"
        ? null
        : `preselect.meanSchemasShown reads ${e.verdict} (observed ${e.value ?? "null"}): no schema cards reached the chunk gate, so the preselect channel is not proven alive`;
    },
  },
  {
    id: "preselect.blindRate",
    proves: "not every chunk encoded blind — the cards reached real chunks",
    refusal: (e) => {
      if (e === undefined) return absent("preselect.blindRate");
      if (e.value === null || !Number.isFinite(e.value)) {
        return "preselect.blindRate carries no observed value: an unreadable blind rate is not a low one";
      }
      return e.value < 1
        ? null
        : `preselect.blindRate is ${e.value}: EVERY gated chunk encoded blind, which is the dead-wire reading precondition 1 exists to catch`;
    },
  },
  {
    id: "gate.refusalMix",
    proves: "the gate battery fired and its mix was computed",
    refusal: (e) => {
      if (e === undefined) return absent("gate.refusalMix");
      return e.verdict === "not-exercised"
        ? "gate.refusalMix is not-exercised: the battery's per-gate mix was never computed, so the gate channel is not proven alive"
        : null;
    },
  },
];

/** The three sets and the wiring checks, as precondition 1 copies them in. */
export function gateSets(): {
  readonly parallelExercisable: readonly string[];
  readonly raterDeferred: readonly string[];
  readonly notApplicableToRun: readonly string[];
  readonly wiringAlive: readonly { readonly id: string; readonly proves: string }[];
} {
  return {
    parallelExercisable: [...PARALLEL_EXERCISABLE],
    raterDeferred: [...RATER_DEFERRED],
    notApplicableToRun: [...NOT_APPLICABLE_TO_RUN],
    wiringAlive: WIRING_ALIVE.map((w) => ({ id: w.id, proves: w.proves })),
  };
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
  // ABSENT IS NOT FALSE. `r["sample"] === true` read a record with no `sample`
  // field as a full re-run — the permissive answer — and a record whose sample
  // flag was mis-serialized as the string "true" the same way. A gate whose
  // fields fail open is a document (review blocker 1).
  const sample = r["sample"];
  if (typeof sample !== "boolean") {
    return `pass record ${runId} carries no boolean \`sample\` field (got ${describe(sample)}): a missing sample flag is not a full re-run`;
  }
  const out: Record<string, GateEntry> = {};
  for (const [id, value] of Object.entries(verdicts as Record<string, unknown>)) {
    const v = value as Record<string, unknown> | null;
    const verdict = v === null ? undefined : v["verdict"];
    if (typeof verdict !== "string") {
      return `pass record ${runId} has a verdict-less entry for ${id}`;
    }
    // The vocabulary is replay's own, imported as a VALUE rather than cast to
    // its type: `verdict as Verdict` made every string a legal verdict, so a
    // typo'd or renamed value sailed through as neither pass nor fail.
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      return `pass record ${runId} has an unknown verdict for ${id}: ${JSON.stringify(verdict)} is not one of ${VERDICTS.join(", ")}`;
    }
    // A NON-NUMBER OBSERVED VALUE IS NULL, never coerced: the wiring checks
    // read `value` for a number, and `null` there means "not readable", which
    // is a refusal rather than a zero (a blind rate of 0 would be perfect).
    const observed = v === null ? null : v["value"];
    out[id] = {
      verdict: verdict as Verdict,
      value: typeof observed === "number" && Number.isFinite(observed) ? observed : null,
    };
  }
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
    if (typeof v === "number") numeric[k] = v;
  }
  if (typeof numeric["fail"] !== "number") {
    return `pass record ${runId} carries no numeric counts.fail: an absent failure count is not zero failures`;
  }
  return {
    runId,
    readOnlyProof: r["readOnlyProof"] === true,
    totalityOk: r["totalityOk"] === true,
    sample,
    counts: numeric,
    verdicts: out,
  };
}

/** What a refusal may say about a value it rejected: its shape, never a secret. */
function describe(v: unknown): string {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  return typeof v;
}

/**
 * PRECONDITION 1, as a predicate. Every refusal names its reason; an open gate
 * returns an empty reason list, so a caller cannot mistake silence for detail.
 *
 * **RULED 2026-09-03 (owner): no waiver — the wiring-alive predicate replaces
 * it.** A `sample: true` record is accepted on the same terms as a full re-run:
 * `readOnlyProof && totalityOk`, every enumerated-set check, and every
 * `WIRING_ALIVE` channel proven alive off the record's own rows. The sample's
 * band failures are not waived by anyone — they are the run's to re-earn.
 */
export function parallelGateOpen(record: GateReadableRecord): GateVerdict {
  const reasons: string[] = [];

  if (!record.readOnlyProof) {
    reasons.push("readOnlyProof is false: the replay reader was not proved read-only");
  }
  if (!record.totalityOk) {
    reasons.push("totalityOk is false: the scorecard does not cover the baselines");
  }

  // ── THE FIELDS THAT USED TO FAIL OPEN (review blocker 1) ──────────────────
  //
  // This predicate is re-checked here rather than trusted from `parseGateRecord`
  // because it is the thing a cutover switch calls, and a caller can hand it a
  // record it built itself. Each of these was previously a coercion:
  // `sample: r["sample"] === true` (absent read as a full re-run), `counts.fail
  // ?? 0` (absent read as zero failures), and `verdict as Verdict` (any string
  // read as a legal verdict). Every one of them opened the gate on missing
  // evidence, which is the opposite of what a gate is for.
  //
  // `sample` is still REQUIRED and still recorded — the run says which record it
  // started from — but it no longer decides anything by itself (RULED
  // 2026-09-03). `counts.fail` is required as EVIDENCE, not as a bar: a number
  // that is not there cannot be cross-checked against the rows below.
  const sample: unknown = record.sample;
  if (typeof sample !== "boolean") {
    reasons.push(
      `sample is ${describe(sample)}, not a boolean: an absent sample flag is not a full re-run`,
    );
  }
  const fails: unknown = record.counts["fail"];
  if (typeof fails !== "number" || !Number.isFinite(fails)) {
    reasons.push(
      `counts.fail is ${describe(fails)}, not a number: an absent failure count is not zero failures`,
    );
  }

  const strayNotExercised: string[] = [];
  const strayRater: string[] = [];
  const unknownVerdicts: string[] = [];
  let failVerdicts = 0;
  for (const [id, entry] of Object.entries(record.verdicts)) {
    const verdict: unknown = entry?.verdict;
    if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) {
      unknownVerdicts.push(`${id}=${describe(verdict)}`);
      continue;
    }
    if (verdict === "fail") failVerdicts += 1;
    if (verdict === "not-exercised" && !KNOWN_NOT_EXERCISED.includes(id)) {
      strayNotExercised.push(id);
    }
    if (verdict === "needs-rater" && !RATER_DEFERRED.includes(id)) {
      strayRater.push(id);
    }
  }
  if (unknownVerdicts.length > 0) {
    reasons.push(
      `verdicts outside the replay vocabulary (${VERDICTS.join(", ")}): ${unknownVerdicts.sort().join(", ")}`,
    );
  }
  // THE COUNTS AND THE ROWS MUST AGREE. `counts` is a summary the report writes
  // beside the rows it summarizes; a record whose header says zero failures
  // over a body that holds one is not a record this gate can read at all —
  // and which half is wrong is not for the gate to decide.
  if (typeof fails === "number" && Number.isFinite(fails) && fails !== failVerdicts) {
    reasons.push(
      `counts.fail is ${fails} but ${failVerdicts} per-metric verdict(s) read "fail": the summary and the rows disagree`,
    );
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

  // ── THE WIRING, PROVEN ALIVE (the waiver's replacement) ───────────────────
  for (const check of WIRING_ALIVE) {
    const refusal = check.refusal(record.verdicts[check.id]);
    if (refusal !== null) reasons.push(refusal);
  }

  return { open: reasons.length === 0, reasons };
}
