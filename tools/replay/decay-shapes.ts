/**
 * `tools/replay/decay-shapes.ts` — physics open question 1, as evidence.
 *
 * v1 ran FLAT. `physics/CONTRACT` defaults EXPONENTIAL. engram had upgraded to a
 * POWER LAW (Ebbinghaus / Wixted / Jost — a power law is the better fit to human
 * forgetting, and it is the reason "when in doubt, follow the brain" points away
 * from the exponential default). `physics/index.ts` says the three-way is
 * "decided by replay, not by taste", and names this file. So this file does not
 * decide it: it runs the SAME replayed corpus under all three curves and reports
 * how far apart they land, per band. The owner decides with the numbers.
 *
 * WHY THIS ONE CALLS THE REAL PHYSICS. The independent-scorer rule (guarantee 5)
 * scopes to criteria the harness GRADES — a shared bug must not grade itself.
 * This comparison grades nothing: it has no bar, no pass, no fail. Its whole
 * purpose is to say what the SYSTEM would do under each curve, which means the
 * system's own `strength()` — including `stability()`, the per-kind kappa, and
 * the identity-band exemption — is the only correct source. A hand-rolled curve
 * here would drift from the shipped one and hand the owner wrong evidence for a
 * real decision.
 *
 * Content-by-reference throughout: ids, counts, strengths, bands. No text.
 */
import { TUNABLES, band, strength } from "../../src/core/physics/index.js";
import type { Band, DecayShape } from "../../src/core/physics/index.js";
import { rowToPhysics } from "../../src/core/store/operational.js";
import type { MemoryRow } from "../../src/core/store/operational.js";

export const SHAPES: readonly DecayShape[] = ["flat", "exponential", "power-law"];

/** The curve the rest of the system currently ships, and the axis the other two
 *  are reported against. Read from `physics/`, never restated here. */
export const REFERENCE_SHAPE: DecayShape = TUNABLES.DECAY_SHAPE;

/** The minimal store surface this needs. Structural, so a fixture can stand in. */
export interface RowSource {
  list(filter?: { type?: "memory"; archived?: boolean }): string[];
  row(id: string): MemoryRow | undefined;
  livedDay(): number;
}

export interface ShapeStats {
  readonly shape: DecayShape;
  readonly meanStrength: number;
  readonly bands: Readonly<Record<Band, number>>;
}

export interface BandDivergence {
  /** The band under the reference shape — the population being followed. */
  readonly band: Band;
  readonly count: number;
  /** Mean strength this population lands at under each shape. */
  readonly meanStrength: Readonly<Record<DecayShape, number>>;
  /** Mean |Δstrength| against the reference shape. */
  readonly meanAbsDelta: Readonly<Record<DecayShape, number>>;
  /** Rows this shape puts in a DIFFERENT band than the reference does. */
  readonly bandFlips: Readonly<Record<DecayShape, number>>;
}

export interface DecayShapeReport {
  readonly day: number;
  readonly rows: number;
  readonly shapes: readonly DecayShape[];
  readonly reference: DecayShape;
  readonly census: readonly ShapeStats[];
  readonly perBand: readonly BandDivergence[];
  /**
   * Do the three curves actually separate on this corpus? FALSE is a real
   * result, not a failure: it means the corpus cannot decide OQ1 and a longer
   * window (or a wider spread of last-used days) is needed before the owner is
   * asked. A zero that means "never asked" says so (scar §2.4).
   */
  readonly distinguishable: boolean;
  /** The largest mean |Δ| any shape shows against the reference. */
  readonly maxMeanAbsDelta: number;
  /** Total band flips across every non-reference shape. */
  readonly totalBandFlips: number;
}

const EPSILON = 1e-9;

function emptyPerShape(): Record<DecayShape, number> {
  return { flat: 0, exponential: 0, "power-law": 0 };
}

/**
 * Run the replayed store under all three curves at one lived day.
 *
 * Archived rows are excluded: they are out of the ranking population, and
 * including them would let dead weight move a mean the owner reads.
 */
export function decayShapes(
  store: RowSource,
  opts: { day?: number; shapes?: readonly DecayShape[] } = {},
): DecayShapeReport {
  const day = opts.day ?? store.livedDay();
  const shapes = opts.shapes ?? SHAPES;
  const reference = REFERENCE_SHAPE;

  const ids = store.list({ type: "memory", archived: false });
  interface Row {
    strengths: Record<DecayShape, number>;
    bands: Record<DecayShape, Band>;
  }
  const rows: Row[] = [];

  for (const id of ids) {
    const raw = store.row(id);
    if (raw === undefined) continue;
    const physics = rowToPhysics(raw);
    const strengths = emptyPerShape();
    const bands: Record<DecayShape, Band> = {
      flat: "episodic",
      exponential: "episodic",
      "power-law": "episodic",
    };
    for (const shape of shapes) {
      strengths[shape] = strength(physics, day, shape);
      bands[shape] = band(physics, day, shape);
    }
    rows.push({ strengths, bands });
  }

  // Whole-corpus census, one line per shape.
  const census: ShapeStats[] = shapes.map((shape) => {
    const counts: Record<Band, number> = { episodic: 0, semantic: 0, identity: 0 };
    let total = 0;
    for (const row of rows) {
      total += row.strengths[shape];
      counts[row.bands[shape]] += 1;
    }
    return {
      shape,
      meanStrength: rows.length === 0 ? 0 : total / rows.length,
      bands: counts,
    };
  });

  // Per-band divergence, following the population the reference shape defines.
  const perBand: BandDivergence[] = [];
  const populations: Band[] = ["identity", "semantic", "episodic"];
  for (const b of populations) {
    const members = rows.filter((r) => r.bands[reference] === b);
    if (members.length === 0) continue;
    const meanStrength = emptyPerShape();
    const meanAbsDelta = emptyPerShape();
    const bandFlips = emptyPerShape();
    for (const shape of shapes) {
      let total = 0;
      let delta = 0;
      let flips = 0;
      for (const row of members) {
        total += row.strengths[shape];
        delta += Math.abs(row.strengths[shape] - row.strengths[reference]);
        if (row.bands[shape] !== row.bands[reference]) flips += 1;
      }
      meanStrength[shape] = total / members.length;
      meanAbsDelta[shape] = delta / members.length;
      bandFlips[shape] = flips;
    }
    perBand.push({ band: b, count: members.length, meanStrength, meanAbsDelta, bandFlips });
  }

  let maxMeanAbsDelta = 0;
  let totalBandFlips = 0;
  for (const entry of perBand) {
    for (const shape of shapes) {
      if (shape === reference) continue;
      maxMeanAbsDelta = Math.max(maxMeanAbsDelta, entry.meanAbsDelta[shape]);
      totalBandFlips += entry.bandFlips[shape];
    }
  }

  // Three curves are "distinguishable" when at least two of them disagree
  // somewhere that matters — a strength gap or a band flip.
  const distinguishable = rows.length > 0 && (maxMeanAbsDelta > EPSILON || totalBandFlips > 0);

  return {
    day,
    rows: rows.length,
    shapes,
    reference,
    census,
    perBand,
    distinguishable,
    maxMeanAbsDelta,
    totalBandFlips,
  };
}
