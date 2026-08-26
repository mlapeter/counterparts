/**
 * `tools/replay/compare.ts` — the distributional comparator, and the scorer.
 *
 * Turns one replay observation into a scorecard: a four-value verdict per
 * metric, plus the totality tripwire that says whether the scorecard covers the
 * baselines document at all.
 *
 * THREE RULES THIS FILE EXISTS TO KEEP:
 *
 *   1. **Four values, never three.** `not-exercised` is a real outcome with a
 *      reason attached. A metric nothing ran, a metric this harness cannot
 *      compute, and a metric measured on another model seat all say so
 *      (guarantee 4, scar §2.4).
 *   2. **A run with a `not-exercised` is not a clean pass.** `clean` is true only
 *      when every metric passed AND totality held. There is no "mostly".
 *   3. **The scorer is independent** (guarantee 5). Nothing here imports `src/`:
 *      the arithmetic is counting and division over the observation, so a bug in
 *      the code under test cannot grade itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { METRICS } from "./baselines.js";
import type {
  MetricResult,
  MetricSpec,
  ReplayObservation,
  RunRecord,
  Scorecard,
  TotalityReport,
  Verdict,
} from "./types.js";
import { VERDICTS } from "./types.js";

/** The document this harness grades against. Resolved from this file, so a
 *  moved doc fails loudly instead of quietly grading nothing. */
export const BASELINES_DOC = fileURLToPath(
  new URL("../../docs/harvest/replay-baselines.md", import.meta.url),
);

// ---------------------------------------------------------------------------
// The totality tripwire (guarantee 9)
// ---------------------------------------------------------------------------

/** Every `### N.M` heading in the baselines document, in document order. */
export function documentSections(doc: string = readFileSync(BASELINES_DOC, "utf8")): string[] {
  const out: string[] = [];
  for (const m of doc.matchAll(/^###\s+(\d+\.\d+)/gm)) {
    const section = m[1];
    if (section !== undefined && !out.includes(section)) out.push(section);
  }
  return out;
}

/**
 * SOURCE-SCANS THE DOCUMENT rather than trusting a maintained list (§17.2's
 * highest-leverage mechanism, and the cheapest to port). A new `### 1.x` section
 * in `replay-baselines.md` with no registry entry fails the run — which is the
 * whole point: v1 had 17 of 53 event types lighting nothing, and one test born
 * green would have caught six separately-filed findings at once.
 *
 * Only §1 (the distributional baselines) must be claimed. §2 is an inventory and
 * §3 is a pointer to criteria that live elsewhere — entries MAY cite them, and
 * a cited section that does not exist is still an error.
 */
export function totality(
  metrics: readonly MetricSpec[] = METRICS,
  doc?: string,
): TotalityReport {
  const sections = documentSections(doc ?? readFileSync(BASELINES_DOC, "utf8"));
  const claimed = new Set(metrics.map((m) => m.section));
  const unclaimedSections = sections.filter((s) => s.startsWith("1.") && !claimed.has(s));
  const unknownSections = [...claimed].filter((s) => !sections.includes(s)).sort();
  // A range with no scorer is the silent hole: it LOOKS graded and never is.
  const unaccounted = metrics
    .filter((m) => m.grading.kind === "range" && m.compute === undefined)
    .map((m) => m.id);
  return {
    sections,
    unclaimedSections,
    unknownSections,
    unaccounted,
    ok:
      unclaimedSections.length === 0 &&
      unknownSections.length === 0 &&
      unaccounted.length === 0,
  };
}

// ---------------------------------------------------------------------------
// One metric
// ---------------------------------------------------------------------------

export function scoreMetric(spec: MetricSpec, o: ReplayObservation): MetricResult {
  const head = {
    id: spec.id,
    section: spec.section,
    label: spec.label,
    v1: spec.v1,
    unit: spec.unit,
  };

  if (spec.grading.kind === "rater") {
    return {
      ...head,
      verdict: "needs-rater",
      reason: null,
      why: spec.grading.bar,
      observed: null,
      range: null,
    };
  }

  if (spec.grading.kind === "not-computable" || spec.grading.kind === "not-comparable") {
    return {
      ...head,
      verdict: "not-exercised",
      reason: spec.grading.kind === "not-computable" ? "not-computable" : "not-comparable",
      why: spec.grading.why,
      observed: null,
      range: null,
    };
  }

  const range = spec.grading.range;
  if (spec.compute === undefined) {
    // Registered as gradable, no arithmetic supplied. Never a pass.
    return {
      ...head,
      verdict: "not-exercised",
      reason: "not-computable",
      why: "The registry entry declares a range but supplies no scorer (totality tripwire).",
      observed: null,
      range,
    };
  }

  const observed = spec.compute(o);
  if (observed === null) {
    return {
      ...head,
      verdict: "not-exercised",
      reason: "no-denominator",
      why: "This run produced no denominator for the metric — never asked, not zero.",
      observed: null,
      range,
    };
  }

  const inside = observed.value >= range.lo && observed.value <= range.hi;
  return {
    ...head,
    verdict: inside ? "pass" : "fail",
    reason: null,
    why: spec.grading.note ?? null,
    observed,
    range,
  };
}

// ---------------------------------------------------------------------------
// The scorecard
// ---------------------------------------------------------------------------

export function scoreRun(
  observation: ReplayObservation,
  record: RunRecord,
  metrics: readonly MetricSpec[] = METRICS,
  doc?: string,
): Scorecard {
  const results = metrics.map((m) => scoreMetric(m, observation));
  const counts: Record<Verdict, number> = {
    pass: 0,
    fail: 0,
    "needs-rater": 0,
    "not-exercised": 0,
  };
  for (const r of results) counts[r.verdict] += 1;
  const tripwire = totality(metrics, doc);
  return {
    record,
    metrics: results,
    counts,
    totality: tripwire,
    // A run containing a not-exercised can never be reported as a clean pass.
    clean: tripwire.ok && counts.fail === 0 && counts["needs-rater"] === 0 && counts["not-exercised"] === 0,
  };
}

/** Verdicts in a stable order, for a caller that wants to iterate them. */
export function verdictOrder(): readonly Verdict[] {
  return VERDICTS;
}
