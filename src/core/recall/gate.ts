/**
 * The surfacing gate — the one place a candidate becomes an intrusion.
 *
 * The named deviation from the brain (constitution line 12, contract §2):
 * **surfacing is judged relative to THIS TURN'S OWN BACKGROUND distribution**,
 * not against an absolute threshold. *Where a design wants `if x > threshold`,
 * suspect a flattened gradient.*
 *
 * Three hard gates salience cannot touch (§9 G7), checked in this order and no
 * other — the order IS the guarantee:
 *
 *   (a) **an uncued memory is dark**, whatever its salience: the salience
 *       arithmetic is never even evaluated;
 *   (b) an **absolute floor** is checked BEFORE any salience adjustment;
 *   (c) the loud tier requires a **minimum fraction of activation from cues**, so
 *       recency alone can never carry a memory there no matter how sacred it is.
 *
 * Two boundary gates sit in front of all three, and salience cannot touch them
 * either: **confidentiality** (sensitive material returns only in the owner's own
 * session, and an observer is a non-owner — observer-mode.md G7) and **session
 * dedup** (this session already saw it).
 *
 * `protected` grants NO surfacing privilege. A protected memory is one revision
 * may not overwrite; that is a write-side property and it buys nothing here.
 *
 * Every verdict names its REASON. A bare boolean cannot be told apart from a bug,
 * and the per-turn decision record is the richest replay comparison surface
 * (contract §5 G14, scar §2.4).
 */
import { tokenize } from "../store/index.js";
import type { Candidate } from "./activate.js";
import { informativeness } from "./cues.js";
import type { GateState } from "./session.js";
import { strongFloor } from "./tunables.js";
import type { RecallTunables } from "./tunables.js";

export type Verdict =
  /** Admitted, loud tier: "came to mind". */
  | "surfaced"
  /** Admitted, quiet tier: "quietly available". */
  | "footnoted"
  /** Boundary: sensitive material, non-owner session. */
  | "confidential-withheld"
  /** Boundary: this session already saw it. */
  | "dedup-suppressed"
  /** Hard gate (a). */
  | "dark-uncued"
  /** Hard gate (b), evaluated before any salience adjustment. */
  | "below-floor"
  /** Below this turn's own background bar. */
  | "below-bar"
  /** Hard gate (c): too little of the activation came from cues. */
  | "cue-fraction"
  /** The per-candidate ceiling: the only cue was a remembered date, and a date
   *  may make a memory quietly available, never loud (prospective §12 G5). */
  | "cue-only-temporal"
  /** Reached the bar, but not the loud tier's per-kind floor. */
  | "below-strong-floor"
  /** Lateral inhibition: a near-duplicate of a stronger admitted candidate. */
  | "inhibited"
  /** Admitted but past the tier cap. An empty slot stays quiet; a full one closes. */
  | "capped";

export type Regime = "relative" | "absolute-cold-start" | "absolute-thin-background";

export interface CandidateVerdict {
  readonly id: string;
  readonly kind: string;
  readonly verdict: Verdict;
  readonly activation: number;
  readonly cue: number;
  /** The temporal portion of `cue` (already inside it) — SEAMS item D. */
  readonly temporal: number;
  readonly semantic: number;
  readonly arrival: number;
  /** Spreading activation (SEAMS item L) — in `activation`, not in cues. */
  readonly hops: number;
  readonly cueFraction: number;
  readonly sal: number;
  readonly strength: number;
  /** False ⇒ this memory may never be credited from this turn (§9 G5). */
  readonly trains: boolean;
  /** The admission bar this candidate actually faced, after leave-one-out and
   *  salience modulation. Two candidates in one turn face different numbers; a
   *  single turn-level bar in the record would be a fiction. */
  readonly bar: number;
  /** For an admitted-but-quiet candidate: which loud-tier check stopped it.
   *  "The footnote tier is where the loud tier said no" is a question replay
   *  asks constantly; a bare tier label cannot answer it. */
  readonly loudBlockedBy?: Verdict;
}

export interface Background {
  readonly regime: Regime;
  readonly n: number;
  /** Whole-sample statistics — the turn-level summary the decision record
   *  reports. The bar each candidate FACES is leave-one-out (see `barsFor`). */
  readonly mean: number;
  readonly sd: number;
  /** Whole-sample admission bar, before leave-one-out and salience. Reported for
   *  replay comparison; not the number any candidate is judged against in the
   *  relative regime. */
  readonly bar: number;
  readonly strongBar: number;
  readonly floor: number;
}

export interface GateInput {
  readonly candidates: readonly Candidate[];
  readonly state: GateState;
  readonly storeSize: number;
  readonly owner: boolean;
  /** The turn stated a feeling (any subject) — the affect flag's turn gate. */
  readonly affectStated: boolean;
  readonly turn: number;
}

export interface GateResult {
  readonly background: Background;
  readonly verdicts: CandidateVerdict[];
  readonly surfaced: Candidate[];
  readonly footnotes: Candidate[];
  /** One content-free line: no ids, no bodies, no feeling named. */
  readonly affectFlag: boolean;
  readonly affectReason: "fired" | "no-feeling-in-turn" | "refractory" | "nothing-charged";
}

/** Jaccard over indexed tokens — the similarity the cache itself would compute. */
export function similarity(a: Candidate, b: Candidate): number {
  const sa = new Set(tokenize(`${a.doc.title ?? ""}\n${a.doc.body}`));
  const sb = new Set(tokenize(`${b.doc.title ?? ""}\n${b.doc.body}`));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const tok of sa) if (sb.has(tok)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/**
 * **The unit the absolute floors are denominated in: ONE MAXIMALLY-RARE CUE.**
 *
 * `informativeness(1, storeSize)` is the weight a cue matching exactly one
 * memory carries — the largest rarity weight the model can produce, and the
 * model's own natural unit. A floor of `2.0` therefore means the same sentence
 * at every scale: *a candidate needs two maximally-rare cues' worth of evidence
 * before it may be admitted.*
 *
 * Why a unit at all (scar §2.8, CONTRACT §7 OQ5). v1's activation was a
 * normalized cosine in 0-1 and its floors were absolute numbers in that space.
 * v2's is a SUM of `idf × length-normalized evidence`, so the same numeral means
 * "everything passes" on a 15,000-memory store (where `informativeness(1, N)` is
 * 8.9) and "nothing passes" on a seventeen-memory one (where it is 2.2). The
 * floors were consequently decorative — MEASURED 2026-09-04: scaling them ×1 to
 * ×15 changed not one delivered item on `tools/recall-bench` — and the loud tier
 * fired on 13 of 13 real turns because only the RELATIVE bar was gating it, and
 * a relative bar cannot keep a low-evidence turn quiet (a thin turn's top
 * candidate stands FURTHER above its own thin background, not nearer).
 *
 * This is ACT-R's retrieval threshold τ, restored to the model's own units: below
 * τ a chunk is not retrieved however distinctive it looks against its neighbours.
 * The relative bar (contract §2's named deviation) is unchanged and still does
 * the discriminating; the floor only says how weak is too weak to be worth
 * anyone's attention.
 *
 * The one thing that made this possible is not in this file: rarity had to be
 * MEASURED before it could be a unit. `activate.ts` was reading document
 * frequency off the length of a bounded top-K, so on a large store every common
 * word looked rare and every turn's activation was inflated by roughly the same
 * amount its rare words were (`store/cache.ts#docFrequency`).
 */
export function floorUnit(storeSize: number): number {
  return informativeness(1, storeSize);
}

/**
 * The background statistic stays GLOBAL across kinds — v1 measured per-kind
 * backgrounds to rescue nothing — and so, as of 2026-09-04, is the loud-tier
 * FLOOR: see `tunables.ts#FLOOR_STRONG_BY_KIND_UNITS` for the measurement that
 * retired v1's per-kind shape without retiring the mechanism (§9 G12).
 *
 * Two degeneracies force the absolute regime, and naming them is the point:
 * a store too small for the variance estimate to mean anything (cold start —
 * *small stores over-surface*, so cold start is STRICTER, not looser), and a
 * background too thin to be a distribution at all, where `mean + k·sd` collapses
 * to the lone candidate's own activation and nothing could ever clear its own bar.
 */
export function background(
  activations: readonly number[],
  storeSize: number,
  t: RecallTunables,
): Background {
  const n = activations.length;
  const mean = n === 0 ? 0 : activations.reduce((a, b) => a + b, 0) / n;
  const varSum = activations.reduce((acc, x) => acc + (x - mean) * (x - mean), 0);
  const sd = n === 0 ? 0 : Math.sqrt(varSum / n);
  const unit = floorUnit(storeSize);

  if (storeSize < t.COLD_START_MIN_STORE) {
    const cold = t.COLD_START_FLOOR_UNITS * unit;
    return {
      regime: "absolute-cold-start",
      n,
      mean,
      sd,
      bar: cold,
      strongBar: cold,
      floor: cold,
    };
  }
  const floor = t.FLOOR_GLOBAL_UNITS * unit;
  if (n < t.MIN_BACKGROUND_SAMPLE || sd === 0) {
    return {
      regime: "absolute-thin-background",
      n,
      mean,
      sd,
      bar: floor,
      strongBar: floor,
      floor,
    };
  }
  return {
    regime: "relative",
    n,
    mean,
    sd,
    bar: mean + t.SNR_GLOBAL * sd,
    strongBar: mean + t.SNR_STRONG * sd,
    floor,
  };
}

/**
 * Two-sided salience modulation of the RELATIVE bar only. Salience lowers the bar
 * for what already passed relevance and raises it for what barely registers; it
 * never bypasses relevance and it never touches the absolute regimes, whose whole
 * purpose is to be un-negotiable.
 */
function modulate(bar: number, sal: number, regime: Regime, t: RecallTunables): number {
  if (regime !== "relative") return bar;
  return bar * (1 - t.SAL_BAR_WEIGHT * (2 * sal - 1));
}

/**
 * The bar one candidate faces, computed LEAVE-ONE-OUT: the background is the
 * turn's OTHER activations, never the candidate's own.
 *
 * This is a correction v1's shape invites and does not make. Including the
 * candidate in its own background means the strongest hit drags `mean + k·sd` up
 * by roughly the amount it stands out — so a lone, perfectly-cued memory is
 * measured against itself and can never clear its own bar. "Relative to this
 * turn's background" only means anything if the candidate is not the background.
 */
export function looBar(
  activation: number,
  sum: number,
  sumSq: number,
  n: number,
  snr: number,
): number {
  const m = n - 1;
  if (m <= 0) return activation;
  const mean = (sum - activation) / m;
  const variance = Math.max(0, (sumSq - activation * activation) / m - mean * mean);
  return mean + snr * Math.sqrt(variance);
}

export function gate(input: GateInput, t: RecallTunables): GateResult {
  const acts = input.candidates.filter((c) => c.cue + c.semantic > 0).map((c) => c.activation);
  const bg = background(acts, input.storeSize, t);
  /** The loud-tier floors are in the same unit as hard gate (b)'s (`floorUnit`). */
  const loudUnit = floorUnit(input.storeSize);
  const sum = acts.reduce((a, b) => a + b, 0);
  const sumSq = acts.reduce((a, b) => a + b * b, 0);
  const n = acts.length;
  const barsFor = (c: Candidate): { admit: number; loud: number } =>
    bg.regime === "relative"
      ? {
          admit: modulate(looBar(c.activation, sum, sumSq, n, t.SNR_GLOBAL), c.sal, bg.regime, t),
          loud: modulate(looBar(c.activation, sum, sumSq, n, t.SNR_STRONG), c.sal, bg.regime, t),
        }
      : { admit: bg.bar, loud: bg.strongBar };

  const verdicts: CandidateVerdict[] = [];
  const admitted: { c: Candidate; loud: boolean }[] = [];
  const loudBlock = new Map<string, Verdict>();
  const faced = new Map<string, number>();
  const record = (c: Candidate, verdict: Verdict): void => {
    const blocked = loudBlock.get(c.id);
    verdicts.push({
      bar: faced.get(c.id) ?? bg.bar,
      id: c.id,
      kind: c.kind,
      verdict,
      activation: c.activation,
      cue: c.cue,
      temporal: c.temporal,
      semantic: c.semantic,
      arrival: c.arrival,
      hops: c.hops,
      cueFraction: c.cueFraction,
      sal: c.sal,
      strength: c.strength,
      trains: c.trains,
      ...(blocked !== undefined ? { loudBlockedBy: blocked } : {}),
    });
  };

  /** Charged candidates feed the affect flag even when they never surface —
   *  a content-free line leaks nothing, and that is what makes it the cheapest
   *  tier. */
  let charged = false;

  for (const c of input.candidates) {
    // Boundary gate 1 — confidentiality. Silent in a list (§9.1 G5); the
    // decision record still counts it, so withholding is measurable.
    if (c.confidential && !input.owner) {
      record(c, "confidential-withheld");
      continue;
    }
    // Hard gate (a) — uncued is dark. Salience is never evaluated below here
    // for such a candidate, which is the guarantee, not an optimization.
    if (c.cue + c.semantic <= 0) {
      record(c, "dark-uncued");
      continue;
    }
    // The affect flag is charged BEFORE dedup, deliberately: the flag is about
    // what THIS TURN touches, and it names nothing — no id, no body, no feeling.
    // A memory already sitting in this session's context still means the turn is
    // near something that carries weight.
    if (c.physics.salience.emotional >= t.AFFECT_MIN_EMOTION) charged = true;
    // Boundary gate 2 — session dedup. It is already in this session's context.
    if (input.state.surfaced[c.id] !== undefined) {
      record(c, "dedup-suppressed");
      continue;
    }
    // Hard gate (b) — the absolute floor, BEFORE any salience adjustment.
    if (c.activation < bg.floor) {
      record(c, "below-floor");
      continue;
    }
    const bars = barsFor(c);
    faced.set(c.id, bars.admit);
    if (c.activation < bars.admit) {
      record(c, "below-bar");
      continue;
    }
    // Loud-tier eligibility. Hard gate (c) first: arrival makes a memory warm,
    // only relevance makes it loud.
    let loud = true;
    // The per-candidate ceiling is checked FIRST among the loud-tier rules, so a
    // capped candidate's record NAMES the cap rather than whichever other rule
    // happened to fire second.
    if (c.maxTier === "footnoted") {
      loud = false;
      loudBlock.set(c.id, "cue-only-temporal");
    } else if (c.cueFraction < t.MIN_CUE_FRACTION) {
      loud = false;
      loudBlock.set(c.id, "cue-fraction");
    } else if (c.activation < strongFloor(t, c.kind, loudUnit)) {
      loud = false;
      loudBlock.set(c.id, "below-strong-floor");
    } else if (c.activation < bars.loud) {
      loud = false;
      loudBlock.set(c.id, "below-bar");
    }
    admitted.push({ c, loud });
  }

  // ── lateral inhibition on PURE activation (§9 G8: admission, inhibition and
  // the footnote tier never see salience — that is what keeps the footnote tier
  // a recency DISCOVERY channel rather than a second salience ranking).
  admitted.sort((a, b) => b.c.activation - a.c.activation || (a.c.id < b.c.id ? -1 : 1));
  const kept: { c: Candidate; loud: boolean }[] = [];
  for (const a of admitted) {
    const dup = kept.some((k) => similarity(k.c, a.c) >= t.NEAR_DUPLICATE);
    if (dup) {
      record(a.c, "inhibited");
      continue;
    }
    kept.push(a);
  }

  // ── tiers: disjoint by construction, and capped ─────────────────────────
  const loudPool = kept.filter((k) => k.loud);
  loudPool.sort(
    (a, b) =>
      b.c.activation + t.SAL_SORT_WEIGHT * b.c.sal - (a.c.activation + t.SAL_SORT_WEIGHT * a.c.sal) ||
      (a.c.id < b.c.id ? -1 : 1),
  );
  const surfaced = loudPool.slice(0, t.MAX_SURFACED).map((k) => k.c);
  const surfacedIds = new Set(surfaced.map((c) => c.id));

  const footnotePool = kept.filter((k) => !surfacedIds.has(k.c.id));
  const footnotes = footnotePool.slice(0, t.MAX_FOOTNOTES).map((k) => k.c);
  const footnoteIds = new Set(footnotes.map((c) => c.id));

  for (const c of surfaced) record(c, "surfaced");
  for (const c of footnotes) record(c, "footnoted");
  for (const k of kept) {
    if (!surfacedIds.has(k.c.id) && !footnoteIds.has(k.c.id)) record(k.c, "capped");
  }

  // ── the affect flag: turn-gated, then refractory-gated ──────────────────
  let affectFlag = false;
  let affectReason: GateResult["affectReason"] = "nothing-charged";
  if (!input.affectStated) {
    affectReason = "no-feeling-in-turn";
  } else if (!charged) {
    affectReason = "nothing-charged";
  } else if (
    input.state.affectFiredTurn !== null &&
    input.turn - input.state.affectFiredTurn < t.AFFECT_REFRACTORY_TURNS
  ) {
    affectReason = "refractory";
  } else {
    affectFlag = true;
    affectReason = "fired";
  }

  return { background: bg, verdicts, surfaced, footnotes, affectFlag, affectReason };
}
