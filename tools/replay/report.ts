/**
 * `tools/replay/report.ts` — the renderer, and the machine-readable pass record.
 *
 * THE ONE RULE THIS FILE ENFORCES: a report is numbers, counts, ids, verdicts and
 * the harness's own static prose. NEVER memory body text, never transcript text
 * (scar §2.20, CLAUDE.md's "logs are content-by-reference"). That is why the
 * renderer takes a `Scorecard` and a `DecayShapeReport` rather than a store or a
 * corpus: the shapes it is handed do not carry a text field to leak.
 * `test/replay.test.ts` puts marker strings in every fixture span and asserts
 * they appear in neither the rendered report nor the pass record.
 *
 * TOTALITY IS ENFORCED AT RENDER TIME (guarantee 9). A metric with neither a
 * computed value nor a declared reason THROWS here rather than rendering a blank
 * cell — a scorecard that quietly drops a criterion is exactly the failure the
 * four-value vocabulary exists to prevent.
 *
 * The pass record is the other half of §17.2's fourth honesty mechanism: *the
 * gate is not a document, it is a precondition*. `gateOpen()` is what a runtime
 * switch calls, and it refuses anything but a clean run.
 */
import { writeFileSync } from "node:fs";

import type { DecayShapeReport } from "./decay-shapes.js";
import type {
  MetricResult,
  ReplayObservation,
  Scorecard,
  Verdict,
} from "./types.js";

export class ReportError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, string | number | boolean>>;
  constructor(code: string, detail: Record<string, string | number | boolean> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "ReportError";
    this.code = code;
    this.detail = detail;
  }
}

export interface RenderInput {
  readonly scorecard: Scorecard;
  readonly observation: ReplayObservation;
  readonly decay?: DecayShapeReport;
  /**
   * The same comparison run forward N lived days. A replay mints everything
   * "today", so at the final lived day the elapsed interval is ~0 and all three
   * curves sit on top of each other — which would make the OQ1 evidence useless
   * exactly where it matters. The question is what the curves do WEEKS later.
   */
  readonly decayHorizon?: DecayShapeReport;
}

// ---------------------------------------------------------------------------
// Formatting — deterministic for identical inputs, by construction
// ---------------------------------------------------------------------------

function fmt(unit: MetricResult["unit"], value: number): string {
  switch (unit) {
    case "rate":
      return `${(value * 100).toFixed(2)}%`;
    case "bytes":
      return `${value.toFixed(0)} B`;
    case "count":
      return value.toFixed(0);
    case "flag":
      return value === 1 ? "yes" : "no";
    default:
      return value.toFixed(3);
  }
}

function fmtRange(unit: MetricResult["unit"], lo: number, hi: number): string {
  if (unit === "flag") return lo === hi ? fmt(unit, lo) : `${fmt(unit, lo)}–${fmt(unit, hi)}`;
  return `${fmt(unit, lo)} – ${fmt(unit, hi)}`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const MARK: Record<Verdict, string> = {
  pass: "PASS",
  fail: "FAIL",
  "needs-rater": "RATER",
  "not-exercised": "N/EX",
};

/** Wrap the harness's own prose so a long reason stays readable in a terminal. */
function wrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(indent + line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(indent + line);
  return lines;
}

// ---------------------------------------------------------------------------
// The rendered report
// ---------------------------------------------------------------------------

export function renderReport(input: RenderInput): string {
  const { scorecard, observation, decay } = input;
  assertAccounted(scorecard);

  const r = scorecard.record;
  const c = observation.corpus;
  const out: string[] = [];

  out.push("COUNTERPARTS REPLAY SCORECARD");
  out.push("=".repeat(78));
  out.push(`run             ${r.runId}`);
  out.push(`harness         ${r.harnessVersion}`);
  out.push(`acting seat     ${r.seat}`);
  out.push(`vectors pinned  ${r.vectors}`);
  out.push(`host ceiling    ${r.budgetBytes} B`);
  out.push(`corpus digest   ${r.corpusDigest}`);
  out.push(`corpus dir      ${r.corpusDir}`);
  out.push(`read-only proof ${r.readOnlyProof ? "sqlite refused a write through the reader's handle" : "NOT PROVEN"}`);
  out.push("");

  out.push("CORPUS AS READ");
  out.push("-".repeat(78));
  out.push(`days ${c.days} · files ${c.files} · span files ${c.spanFiles} · spans ${c.spans} (${c.spanBytes} B)`);
  out.push(`sessions ${c.sessions} · scopes ${c.scopes} · v1 active days ${c.activeDays}`);
  out.push(`event files ${c.eventFiles} · event lines ${c.eventLines} · distinct names ${c.eventNames}`);
  out.push(
    `index ${c.indexPresent ? "present" : "absent"} · embedding rows ${Object.entries(c.embeddingModels)
      .sort()
      .map(([m, n]) => `${m}=${n}`)
      .join(", ") || "none"} · pinned ${c.pinnedModel ?? "none"} (${c.pinnedRows} rows)`,
  );
  // FORMAT DRIFT, PRINTED. First contact with the real corpus shows up here as
  // a number instead of a stack trace (see NOTES §1).
  out.push(
    `format drift: malformed spans ${c.malformedSpans} · unrecognized span files ${c.unrecognizedSpanFiles} · assumed kind ${c.assumedKind} · assumed shape ${c.assumedShape} · malformed event lines ${c.malformedEventLines}`,
  );
  out.push("");

  out.push("REPLAY");
  out.push("-".repeat(78));
  const spansCaptured = observation.days.reduce((n, d) => n + d.spansCaptured, 0);
  const sweepsRan = observation.sweeps.filter((s) => s.ran).length;
  const minted = observation.chunks.reduce((n, ch) => n + ch.minted, 0);
  out.push(
    `active days ${observation.activeDays} · spans captured ${spansCaptured} · sweeps ran ${sweepsRan}/${observation.sweeps.length}`,
  );
  out.push(
    `chunks ${observation.chunks.length} · minted ${minted} · store: ${observation.store.memories} memories (${observation.store.archived} archived), ${observation.store.episodes} episodes, lived day ${observation.store.livedDay}`,
  );
  const kinds = Object.entries(observation.store.byKind).sort();
  const bands = Object.entries(observation.store.byBand).sort();
  out.push(`by kind: ${kinds.map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
  out.push(`by band: ${bands.map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
  // THE GATE'S OWN RECORD, and the ratchet tripwire's standing. Both are read
  // back out of the replayed store, so this line says what a parallel run's
  // store would say — which is the only form that evidence ever takes.
  const shown = observation.gateRecords.reduce((n, g) => n + g.shown, 0);
  const fires = observation.gateRecords.reduce(
    (n, g) => n + Object.values(g.fires).reduce((a, b) => a + b, 0),
    0,
  );
  out.push(
    `gate records ${observation.gateRecords.length} · gate fires ${fires} · schemas shown ${shown} · blind ${observation.gateRecords.filter((g) => g.blind).length}`,
  );
  const up = observation.bandTransitions.filter((t) => t.direction === "up").length;
  const down = observation.bandTransitions.filter((t) => t.direction === "down").length;
  // Grouped by REASON, never by `ok`: below the minimum sample a verdict is
  // `never-asked` and carries `ok: true`, and printing that as health is the
  // exact failure guarantee 12 exists to prevent (scar §2.4).
  const byReason = new Map<string, number>();
  for (const v of observation.symmetry) byReason.set(v.reason, (byReason.get(v.reason) ?? 0) + 1);
  const verdicts =
    observation.symmetry.length === 0
      ? "no verdict rendered"
      : [...byReason.entries()]
          .sort()
          .map(([r, n]) => `${r}=${n}`)
          .join(", ");
  out.push(`band moves: up ${up} · down ${down} · symmetry verdicts: ${verdicts}`);
  out.push("");

  out.push("METRICS vs docs/harvest/replay-baselines.md");
  out.push("-".repeat(78));
  let section = "";
  for (const m of scorecard.metrics) {
    if (m.section !== section) {
      section = m.section;
      out.push("");
      out.push(`§${section}`);
    }
    const observed = m.observed === null ? "—" : fmt(m.unit, m.observed.value);
    const denom =
      m.observed?.denominator === undefined
        ? ""
        : ` (${m.observed.numerator ?? 0}/${m.observed.denominator})`;
    const range = m.range === null ? "—" : fmtRange(m.unit, m.range.lo, m.range.hi);
    out.push(`  ${pad(MARK[m.verdict], 6)}${pad(m.id, 34)}${pad(observed + denom, 22)}expect ${range}`);
    out.push(...wrap(m.label, 70, "         "));
    out.push(...wrap(`v1: ${m.v1}`, 70, "         "));
    if (m.reason !== null) out.push(...wrap(`not-exercised (${m.reason})`, 70, "         "));
    if (m.why !== null) out.push(...wrap(m.why, 70, "         "));
  }
  out.push("");

  out.push("VERDICTS");
  out.push("-".repeat(78));
  out.push(
    `pass ${scorecard.counts.pass} · fail ${scorecard.counts.fail} · needs-rater ${scorecard.counts["needs-rater"]} · not-exercised ${scorecard.counts["not-exercised"]}`,
  );
  out.push(
    scorecard.clean
      ? "CLEAN PASS — every criterion was exercised and every one of them passed."
      : "NOT A CLEAN PASS — a run containing a fail, a rater item, or a not-exercised criterion is not a pass. See the reasons above.",
  );
  out.push("");

  out.push("TOTALITY TRIPWIRE");
  out.push("-".repeat(78));
  const t = scorecard.totality;
  out.push(`sections in the baselines doc: ${t.sections.join(", ")}`);
  out.push(`unclaimed §1 sections: ${t.unclaimedSections.join(", ") || "none"}`);
  out.push(`registry sections not in the doc: ${t.unknownSections.join(", ") || "none"}`);
  out.push(`metrics declaring a range with no scorer: ${t.unaccounted.join(", ") || "none"}`);
  out.push(t.ok ? "tripwire: HELD" : "tripwire: TRIPPED — the scorecard does not cover the baselines.");
  out.push("");

  if (decay !== undefined) {
    out.push("DECAY SHAPE — physics open question 1 (evidence, not a verdict)");
    out.push("-".repeat(78));
    out.push(...decayBlock(decay, "at the last replayed lived day"));
    if (input.decayHorizon !== undefined) {
      out.push("");
      out.push(
        ...decayBlock(
          input.decayHorizon,
          `projected forward ${input.decayHorizon.day - decay.day} lived days — where the curves actually differ`,
        ),
      );
    }
    out.push("");
  } else {
    out.push("DECAY SHAPE — not run for this report.");
    out.push("");
  }

  return out.join("\n");
}

/**
 * One decay-shape block. Six decimals throughout: at short intervals the three
 * curves differ in the fourth decimal, and a display that rounds them to the
 * same number would contradict the verdict printed under it.
 */
function decayBlock(decay: DecayShapeReport, when: string): string[] {
  const out: string[] = [];
  out.push(`lived day ${decay.day} (${when}) · rows ${decay.rows} · reference ${decay.reference}`);
  for (const s of decay.census) {
    const bandLine = (["identity", "semantic", "episodic"] as const)
      .map((b) => `${b}=${s.bands[b]}`)
      .join(" ");
    out.push(`  ${pad(s.shape, 13)}mean strength ${s.meanStrength.toFixed(6)}   ${bandLine}`);
  }
  for (const b of decay.perBand) {
    out.push(`  band ${b.band} (${b.count} rows, by the reference shape)`);
    for (const shape of decay.shapes) {
      out.push(
        `    ${pad(shape, 13)}mean ${b.meanStrength[shape].toFixed(6)}  |Δ| ${b.meanAbsDelta[shape].toFixed(6)}  band flips ${b.bandFlips[shape]}`,
      );
    }
  }
  out.push(
    decay.distinguishable
      ? `  → the curves separate (max mean |Δ| ${decay.maxMeanAbsDelta.toExponential(3)}, ${decay.totalBandFlips} band flips).`
      : "  → the curves do NOT separate here. That is a result, not a pass: a wider spread of last-used days is needed before the question is put to the owner.",
  );
  return out;
}

/** Guarantee 9 at render time: no metric may be silently blank. */
function assertAccounted(scorecard: Scorecard): void {
  if (scorecard.totality.unaccounted.length > 0) {
    throw new ReportError("METRIC_UNACCOUNTED", {
      ids: scorecard.totality.unaccounted.join(","),
    });
  }
  for (const m of scorecard.metrics) {
    const accounted = m.observed !== null || m.reason !== null || m.verdict === "needs-rater";
    if (!accounted) throw new ReportError("METRIC_UNACCOUNTED", { id: m.id });
  }
}

// ---------------------------------------------------------------------------
// The machine-readable pass record
// ---------------------------------------------------------------------------

export interface PassRecord {
  readonly harnessVersion: string;
  readonly runId: string;
  readonly at: number;
  readonly seat: string;
  readonly vectors: string;
  readonly corpusDigest: string;
  readonly budgetBytes: number;
  readonly readOnlyProof: boolean;
  readonly clean: boolean;
  readonly counts: Readonly<Record<Verdict, number>>;
  readonly totalityOk: boolean;
  readonly verdicts: Readonly<Record<string, { verdict: Verdict; reason: string | null; value: number | null }>>;
  readonly decay: DecaySummary | null;
  /** The same comparison projected forward — where OQ1 is actually decided. */
  readonly decayHorizon: DecaySummary | null;
}

export interface DecaySummary {
  readonly day: number;
  readonly reference: string;
  readonly distinguishable: boolean;
  readonly maxMeanAbsDelta: number;
  readonly totalBandFlips: number;
  /** Mean strength per shape — the number the owner compares. */
  readonly meanStrength: Readonly<Record<string, number>>;
}

function decaySummary(decay: DecayShapeReport): DecaySummary {
  const meanStrength: Record<string, number> = {};
  for (const s of decay.census) meanStrength[s.shape] = s.meanStrength;
  return {
    day: decay.day,
    reference: decay.reference,
    distinguishable: decay.distinguishable,
    maxMeanAbsDelta: decay.maxMeanAbsDelta,
    totalBandFlips: decay.totalBandFlips,
    meanStrength,
  };
}

export function passRecord(input: RenderInput): PassRecord {
  const { scorecard, decay } = input;
  assertAccounted(scorecard);
  const verdicts: Record<string, { verdict: Verdict; reason: string | null; value: number | null }> = {};
  for (const m of scorecard.metrics) {
    verdicts[m.id] = {
      verdict: m.verdict,
      reason: m.reason,
      value: m.observed === null ? null : m.observed.value,
    };
  }
  const r = scorecard.record;
  return {
    harnessVersion: r.harnessVersion,
    runId: r.runId,
    at: r.at,
    seat: r.seat,
    vectors: r.vectors,
    corpusDigest: r.corpusDigest,
    budgetBytes: r.budgetBytes,
    readOnlyProof: r.readOnlyProof,
    clean: scorecard.clean,
    counts: scorecard.counts,
    totalityOk: scorecard.totality.ok,
    verdicts,
    decay: decay === undefined ? null : decaySummary(decay),
    decayHorizon: input.decayHorizon === undefined ? null : decaySummary(input.decayHorizon),
  };
}

export function writePassRecord(path: string, record: PassRecord): void {
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * WHAT A RUNTIME SWITCH CALLS. The ambient path stays off until a recorded run
 * says otherwise, and "otherwise" means clean, on this harness version, with the
 * seat and the vector generation named. A document does not open this gate.
 */
export function gateOpen(record: PassRecord, harnessVersion: string): boolean {
  return (
    record.clean &&
    record.totalityOk &&
    record.readOnlyProof &&
    record.harnessVersion === harnessVersion &&
    record.seat.trim().length > 0 &&
    record.vectors.trim().length > 0
  );
}
