#!/usr/bin/env bun
/**
 * `tools/bench/embedder-trial` — does a static embedding table earn its place
 * beside the lexical channel? (roadmap C1 step 5)
 *
 *   ~/.bun/bin/bun tools/bench/embedder-trial.ts \
 *     --potion <dir with model.safetensors + vocab.txt> \
 *     [--retrieval <dir: static-retrieval-mrl-en-v1, vocab.txt derived>] \
 *     [--runs 5] [--out report.md] [--json report.json]
 *
 * **It can only ever open a store it just made.** There is no `--dir`: every run
 * seeds a FRESH temp directory with `tools/demo/seed.ts` (the synthetic
 * Fernbrook/Halfmoon persona — every byte authored, zero API calls) and removes
 * it afterwards. Nothing here reads a real store, a config or a credentials
 * file. Voyage is measured only when `VOYAGE_API_KEY` is already in THIS
 * process's environment, and then it is a paid call per memory — say so before
 * running it that way.
 *
 * ── WHAT IS MEASURED ────────────────────────────────────────────────────────
 *
 * A fixed query set, labeled by CONTENT (a distinctive substring of the memory
 * that answers it — seed ids are random bytes, so an id label would not survive
 * a reseed). Two halves:
 *
 *   - **paraphrase** — asks for a memory in words it does not contain. The
 *     question the semantic channel exists for.
 *   - **lexical** — asks in the memory's own words. The no-regression half: a
 *     second channel must not push down what the first already found.
 *
 * **Two recall paths, and they are not the same path.**
 *
 *   - **DELIBERATE** (the MCP `recall` tool's shape): the QUESTION's own vector
 *     is handed to `Recall.build`, in line. Sections 1–2 below.
 *   - **PER-TURN** (the hook's shape): a turn is NEVER embedded while it is
 *     being answered. The worker embeds the previous exchange after the
 *     boundary, ranks it, and the NEXT turn gets that ranking as its lagged
 *     semantic cue (`recall/session.ts`). Section 4 below simulates exactly
 *     that — turn 1 is the question with no lagged cue (as a first turn
 *     has none), the worker's rank of the question is stored the way
 *     `Counterpart.noteSessionSemantic` stores it, and turn 2 is a follow-up
 *     that names no topic ("go on — what else do we know about that?"). What it
 *     measures is what the lag can add the turn after a question.
 *
 * Per arm (lexical-only; each static table; Voyage if a key is present):
 *
 *   1. the ACTIVATION RANKING — `recall.activate` over the whole store with no
 *      candidate cap, the turn's vector supplied (or not): rank of the first
 *      relevant memory → recall@1/3/5/10 and MRR;
 *   2. the DELIVERED set — `Recall.build`, the real gate: did a relevant memory
 *      reach the model, and how many items came with it (the noise a channel
 *      buys);
 *   3. the RAW semantic channel — `Store.nearestTo` alone, and the cosine
 *      distribution: best relevant vs best irrelevant, and how many queries'
 *      best relevant clears `SEMANTIC_SEED_FLOOR`. That floor (0.45) was set
 *      for Voyage's cosine scale; a static table's scale is lower, so the floor
 *      is swept as a bench parameter here and NOT changed in `recall/`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmbedder, createStaticEmbedder } from "../../src/adapters/claude-code/embed-client.js";
import type { LiveEmbedder } from "../../src/adapters/claude-code/embed-client.js";
import { loadStaticModel, resolveStaticWeights } from "../../src/core/embed/static.js";
import {
  Recall,
  TUNABLES,
  activate,
  loadGateState,
  loadSessionSemantic,
  saveSessionSemantic,
  withTunables,
} from "../../src/core/recall/index.js";
import { Store, indexTextOf } from "../../src/core/store/index.js";
import { seedDemo } from "../demo/seed.js";

// ═══════════════════════════════════════════════════════════════════════════
// The query set
// ═══════════════════════════════════════════════════════════════════════════

export interface TrialQuery {
  readonly set: "paraphrase" | "lexical";
  readonly text: string;
  /** Any live memory whose body contains one of these is a right answer. */
  readonly relevant: readonly string[];
}

export const QUERIES: readonly TrialQuery[] = [
  // ── paraphrase: the answer in other words ──────────────────────────────
  {
    set: "paraphrase",
    text: "what happened when a pair of staff both claimed one opening and the later edit overwrote the earlier",
    relevant: ["the second write silently won"],
  },
  {
    set: "paraphrase",
    text: "why daylight saving time is a hazard for the scheduling engine",
    relevant: ["The clocks go back in October", "a day that is not twenty-four hours long", "what Driftwood does with the clocks"],
  },
  {
    set: "paraphrase",
    text: "the lead nurse refuses to put someone on overnight duty right after an evening one because of the commute",
    relevant: ["because of the drive home", "immediately after a late"],
  },
  {
    set: "paraphrase",
    text: "no mobile reception underground where the staff hand over",
    relevant: ["The basement corridor at Cotter Street Clinic has no signal"],
  },
  {
    set: "paraphrase",
    text: "the optimiser became ten times slower as the headcount rose",
    relevant: ["about ninety seconds, not nine"],
  },
  {
    set: "paraphrase",
    text: "temporary agency workers are able to turn down work they are offered",
    relevant: ["Bank staff decline about one in five", "bank staff who can decline any shift"],
  },
  {
    set: "paraphrase",
    text: "what the different ink hues on the handwritten timetable indicate",
    relevant: ["three pen colours", "The red pen on the paper rota", "encodes it in pen colour"],
  },
  {
    set: "paraphrase",
    text: "a cramped layout won the argument once it was taped up life-size",
    relevant: ["ended the density argument", "argument about density resolved itself", "a dense rota grid is kinder"],
  },
  {
    set: "paraphrase",
    text: "the company's head agrees to expansion before working out the price",
    relevant: ["says yes to a new ward first and works out the cost afterwards"],
  },
  {
    set: "paraphrase",
    text: "the engine counts a slot as staffed even when everyone on it is inexperienced",
    relevant: ["three juniors on a night counts as covered"],
  },
  {
    set: "paraphrase",
    text: "the handheld application displays stale schedules without saying how out of date they are",
    relevant: ["no indication of how old it is", "last-updated stamp"],
  },
  {
    set: "paraphrase",
    text: "why we release software midweek instead of at the end of the week",
    relevant: ["The studio ships on Thursdays"],
  },
  {
    set: "paraphrase",
    text: "the developer won't accept a database change that takes more than a single step to undo",
    relevant: ["reversing it needed two commands instead of one", "could not roll back in one command"],
  },
  {
    set: "paraphrase",
    text: "the design library only has pieces for when everything goes right",
    relevant: ["Every state in the system is a happy one"],
  },
  {
    set: "paraphrase",
    text: "how many manual fixes people made to each automatically produced schedule",
    relevant: ["The edits average eleven per rota", "Eleven hand edits per generated rota"],
  },
  {
    set: "paraphrase",
    text: "our office sits upstairs from a shop that sells boat supplies",
    relevant: ["two rooms above a chandlery"],
  },
  {
    set: "paraphrase",
    text: "workers look for their own entry before anything else when they check the posted timetable",
    relevant: ["finding their own name first"],
  },
  {
    set: "paraphrase",
    text: "equity between employees is judged over four weeks rather than seven days",
    relevant: ["across a rolling month", "fairness across a whole month", "a month-long window"],
  },
  {
    set: "paraphrase",
    text: "nobody has simulated two departments drawing on one pool of casual workers",
    relevant: ["over two wards sharing staff", "never been run over two wards at once"],
  },
  {
    set: "paraphrase",
    text: "the senior nurse privately ranks how competent each colleague is",
    relevant: ["a mental grade for every nurse"],
  },
  {
    set: "paraphrase",
    text: "what three core views make up the product we sell to little medical practices",
    relevant: ["a rota grid, a swap sheet, and a phone view"],
  },
  {
    set: "paraphrase",
    text: "the windowless space where difficult discussions always end up",
    relevant: ["The back room has the whiteboard and no window"],
  },
  {
    set: "paraphrase",
    text: "the solver's author built it alone during a cold season and still checks each change",
    relevant: ["wrote Driftwood on his own over a winter"],
  },
  {
    set: "paraphrase",
    text: "the designer works on her feet with paper rather than at a computer",
    relevant: ["designs standing up, with a printout"],
  },
  {
    set: "paraphrase",
    text: "a single extra rule made computation a little slower yet wiped out most of the human touch-ups",
    relevant: ["took the solve from nine seconds to eleven"],
  },
  {
    set: "paraphrase",
    text: "the mobile developer assumes connectivity is usually absent",
    relevant: ["treats offline as the default state", "starts every discussion from what happens with no signal"],
  },
  {
    set: "paraphrase",
    text: "requests to track holidays, contractors and a supervisor dashboard that nobody has estimated",
    relevant: ["annual leave, agency staff, a manager view"],
  },
  {
    set: "paraphrase",
    text: "the founder sells it as returning personal time to supervisors at the end of the weekend",
    relevant: ["give charge nurses their Sunday evening back"],
  },
  {
    set: "paraphrase",
    text: "the device quietly stores the previous seven days so it works without a connection",
    relevant: ["already keeps last week's rota locally"],
  },
  {
    set: "paraphrase",
    text: "another department wants to join, which would more than double the people the optimiser must handle",
    relevant: ["from twenty-two staff to fifty-one"],
  },
  // ── lexical: the answer in its own words (the no-regression half) ──────
  {
    set: "lexical",
    text: "Driftwood nineteen hard constraints six soft ones",
    relevant: ["Driftwood carries nineteen hard constraints"],
  },
  {
    set: "lexical",
    text: "swap sheet conflict handling",
    relevant: ["it currently has no conflict handling at all"],
  },
  {
    set: "lexical",
    text: "Tessellate design system eleven components",
    relevant: ["Tessellate is the studio's design system"],
  },
  {
    set: "lexical",
    text: "Ilya Broadbent phone view with no signal",
    relevant: ["Ilya Broadbent builds the phone view"],
  },
  {
    set: "lexical",
    text: "skill mix per-shift requirement rather than a per-person grade",
    relevant: ["model skill mix as a per-shift requirement"],
  },
  {
    set: "lexical",
    text: "rota grid took four seconds on the ward tablet",
    relevant: ["took four seconds to appear on the ward tablet"],
  },
  {
    set: "lexical",
    text: "red pen shift covered under protest",
    relevant: ["The red pen on the paper rota means a shift covered under protest"],
  },
  {
    set: "lexical",
    text: "Rosalind Achebe founded Fernbrook after hospital operations work",
    relevant: ["founded Fernbrook after eleven years of hospital operations"],
  },
  {
    set: "lexical",
    text: "Thursday maintenance window for the skill-mix schema change",
    relevant: ["Thursday maintenance window"],
  },
  {
    set: "lexical",
    text: "corridor noticeboard printed rota Friday afternoon",
    relevant: ["The corridor noticeboard is where the rota becomes real", "printed rota goes up every Friday afternoon"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Scoring
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryResult {
  readonly text: string;
  readonly set: TrialQuery["set"];
  /** 1-based rank of the first relevant memory in the activation ranking; null = not a candidate. */
  readonly rank: number | null;
  /** 1-based rank in the raw semantic ranking (`nearestTo`); null for lexical-only. */
  readonly semanticRank: number | null;
  readonly delivered: number;
  readonly deliveredRelevant: boolean;
  /** Best cosine of a relevant memory / of an irrelevant one. Null for lexical-only. */
  readonly bestRelevantCos: number | null;
  readonly bestOtherCos: number | null;
}

export interface Summary {
  readonly n: number;
  readonly r1: number;
  readonly r3: number;
  readonly r5: number;
  readonly r10: number;
  readonly mrr: number;
  readonly deliveredHits: number;
  readonly deliveredPerTurn: number;
}

export function summarize(rows: readonly QueryResult[], pick: (r: QueryResult) => number | null = (r) => r.rank): Summary {
  const n = rows.length;
  const at = (k: number): number => rows.filter((r) => {
    const x = pick(r);
    return x !== null && x <= k;
  }).length;
  const mrr = n === 0 ? 0 : rows.reduce((s, r) => {
    const x = pick(r);
    return s + (x === null ? 0 : 1 / x);
  }, 0) / n;
  return {
    n,
    r1: at(1),
    r3: at(3),
    r5: at(5),
    r10: at(10),
    mrr,
    deliveredHits: rows.filter((r) => r.deliveredRelevant).length,
    deliveredPerTurn: n === 0 ? 0 : rows.reduce((s, r) => s + r.delivered, 0) / n,
  };
}

interface Arm {
  readonly name: string;
  readonly floor: number;
  /** SEMANTIC_WEIGHT — a bench parameter here, never a change to `recall/`. */
  readonly weight: number;
}

function runArm(store: Store, relevantIds: readonly Set<string>[], arm: Arm, vectors: readonly (number[] | null)[]): QueryResult[] {
  const tunables = withTunables({ SEMANTIC_SEED_FLOOR: arm.floor, SEMANTIC_WEIGHT: arm.weight, BUDGET_MS: 600_000 });
  const recall = new Recall({ store, owner: true, tunables });
  const day = store.livedDay();
  const storeSize = store.list({ archived: false }).length;
  const out: QueryResult[] = [];
  QUERIES.forEach((q, i) => {
    const relevant = relevantIds[i] ?? new Set<string>();
    const vector = vectors[i] ?? undefined;
    const act = activate(
      store,
      { text: q.text, day, selfFelt: false, maxCandidates: 10_000, storeSize, ...(vector === undefined ? {} : { vector }) },
      tunables,
    );
    const ranked = [...act.candidates].sort((a, b) => b.activation - a.activation || (a.id < b.id ? -1 : 1));
    const pos = ranked.findIndex((c) => relevant.has(c.id));
    const built = recall.build({
      sessionId: `trial-${arm.name}-${arm.floor}-${arm.weight}-${i}`,
      text: q.text,
      owner: true,
      day,
      ...(vector === undefined ? {} : { vector }),
    });
    const delivered = [...built.decision.surfaced, ...built.decision.footnotes];
    let semanticRank: number | null = null;
    let bestRelevantCos: number | null = null;
    let bestOtherCos: number | null = null;
    if (vector !== undefined) {
      const all = store.nearestTo(vector, 100_000);
      const sp = all.findIndex((h) => relevant.has(h.id));
      semanticRank = sp < 0 ? null : sp + 1;
      bestRelevantCos = all.find((h) => relevant.has(h.id))?.score ?? null;
      bestOtherCos = all.find((h) => !relevant.has(h.id))?.score ?? null;
    }
    out.push({
      text: q.text,
      set: q.set,
      rank: pos < 0 ? null : pos + 1,
      semanticRank,
      delivered: delivered.length,
      deliveredRelevant: delivered.some((id) => relevant.has(id)),
      bestRelevantCos,
      bestOtherCos,
    });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// The per-turn (hook) path
// ═══════════════════════════════════════════════════════════════════════════

/** Turn 2's text: a continuation that names no topic, so anything it delivers came from the lag. */
export const FOLLOW_UP = "go on — what else do we know about that?";

export interface PerTurnResult {
  readonly text: string;
  readonly set: TrialQuery["set"];
  /** A relevant memory was delivered on turn 1 (no lagged cue exists yet). */
  readonly turn1: boolean;
  /** …on turn 2, carried by the previous turn's lagged cue (or not at all). */
  readonly turn2: boolean;
  readonly items1: number;
  readonly items2: number;
}

export interface PerTurnSummary {
  readonly n: number;
  /** Queries with a relevant memory delivered on turn 1 or turn 2. */
  readonly withinTwo: number;
  /** …of which only turn 2 delivered it — what the lag added. */
  readonly byLag: number;
  readonly itemsPerTurn: number;
  /** Queries lexical-only delivered within two turns and this arm did not. */
  readonly lost: number;
}

/**
 * The hook's shape, two turns per query, through `Recall.recall` (the
 * RECORDING half — per-session dedup and the one-turn lifetime of the lag row
 * are live, exactly as in a session). The worker step is the two lines
 * `Counterpart.noteSessionSemantic` runs: rank with `nearestTo(vec,
 * SEMANTIC_TOP_M)` and `saveSessionSemantic` stamped with the served turn.
 */
function runPerTurnArm(
  store: Store,
  relevantIds: readonly Set<string>[],
  arm: Arm,
  vectors: readonly (number[] | null)[],
): PerTurnResult[] {
  const tunables = withTunables({ SEMANTIC_SEED_FLOOR: arm.floor, SEMANTIC_WEIGHT: arm.weight, BUDGET_MS: 600_000 });
  const recall = new Recall({ store, owner: true, tunables });
  const day = store.livedDay();
  const out: PerTurnResult[] = [];
  QUERIES.forEach((q, i) => {
    const relevant = relevantIds[i] ?? new Set<string>();
    const sessionId = `pt-${arm.name}-${arm.floor}-${arm.weight}-${i}`;
    const t1 = recall.recall({ sessionId, text: q.text, owner: true, day }).decision;
    const vector = vectors[i] ?? null;
    if (vector !== null) {
      // The worker, after the boundary: rank the exchange, stamp it for the next turn.
      saveSessionSemantic(store, {
        sessionId,
        turn: loadGateState(store, sessionId).state.turn,
        lastDay: day,
        reason: "ok",
        model: arm.name,
        dim: vector.length,
        hits: store.nearestTo(vector, tunables.SEMANTIC_TOP_M),
      });
    }
    const lag = loadSessionSemantic(store, sessionId);
    const t2 = recall.recall({
      sessionId,
      text: FOLLOW_UP,
      owner: true,
      day,
      ...(lag.hits === null ? {} : { semanticHits: lag.hits }),
      semanticSource: lag.source,
    }).decision;
    const d1 = [...t1.surfaced, ...t1.footnotes];
    const d2 = [...t2.surfaced, ...t2.footnotes];
    out.push({
      text: q.text,
      set: q.set,
      turn1: d1.some((id) => relevant.has(id)),
      turn2: d2.some((id) => relevant.has(id)),
      items1: d1.length,
      items2: d2.length,
    });
  });
  return out;
}

export function summarizePerTurn(rows: readonly PerTurnResult[], lexical: readonly PerTurnResult[] | null): PerTurnSummary {
  const n = rows.length;
  return {
    n,
    withinTwo: rows.filter((r) => r.turn1 || r.turn2).length,
    byLag: rows.filter((r) => !r.turn1 && r.turn2).length,
    itemsPerTurn: n === 0 ? 0 : rows.reduce((a, r) => a + r.items1 + r.items2, 0) / (2 * n),
    lost:
      lexical === null
        ? 0
        : rows.filter((r, i) => {
            const b = lexical[i];
            return b !== undefined && (b.turn1 || b.turn2) && !(r.turn1 || r.turn2);
          }).length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The run
// ═══════════════════════════════════════════════════════════════════════════

export interface TrialOptions {
  readonly potion: string;
  readonly retrieval?: string;
  readonly floors?: readonly number[];
  readonly weights?: readonly number[];
  /**
   * How many times to reseed and rerun. The seed's CONTENT is deterministic but
   * its ids are random bytes, and the lexical channel breaks score ties by id
   * (`searchIndex`'s `ORDER BY score DESC, memory_id ASC LIMIT`), so which of a
   * tied set makes a cue's cut differs per seed. One run is one draw; the
   * report is the mean over `runs` draws, with the range.
   */
  readonly runs?: number;
  readonly env?: Record<string, string | undefined>;
  readonly log?: (line: string) => void;
}

export interface ArmReport {
  readonly name: string;
  readonly identity: string;
  readonly floor: number;
  readonly weight: number;
  readonly paraphrase: Summary;
  readonly lexical: Summary;
  readonly semanticParaphrase: Summary | null;
  readonly semanticLexical: Summary | null;
  /** Queries (either set) this arm did worse on than lexical-only, this run. */
  readonly regressions: readonly string[];
  readonly rows: readonly QueryResult[];
  /** The hook's path (section 4): paraphrase and lexical halves. */
  readonly perTurnParaphrase: PerTurnSummary;
  readonly perTurnLexical: PerTurnSummary;
  readonly perTurnRows: readonly PerTurnResult[];
}

export interface ModelReport {
  readonly identity: string;
  readonly loadMs: number;
  readonly refillMs: number | null;
  readonly refilled: number | null;
  readonly msPerEmbed: number;
}

export interface TrialRun {
  readonly storeSize: number;
  readonly seedMs: number;
  readonly models: readonly ModelReport[];
  readonly arms: readonly ArmReport[];
}

/** One arm across every run: means, and the range of the two numbers that decide. */
export interface AggregateArm {
  readonly name: string;
  readonly identity: string;
  readonly floor: number;
  readonly weight: number;
  readonly paraphrase: Summary;
  readonly lexical: Summary;
  readonly semanticParaphrase: Summary | null;
  readonly semanticLexical: Summary | null;
  readonly paraMrrRange: readonly [number, number];
  readonly paraDeliveredRange: readonly [number, number];
  /** Mean regressions per run, and the most any run had. */
  readonly regressionsMean: number;
  readonly regressionsMax: number;
  readonly perTurnParaphrase: PerTurnSummary;
  readonly perTurnLexical: PerTurnSummary;
}

export interface TrialReport {
  readonly runs: number;
  readonly first: TrialRun;
  readonly aggregate: readonly AggregateArm[];
  readonly voyage: "measured" | "no-key";
  readonly shippedFloor: number;
  readonly shippedWeight: number;
}

/** Queries on which an arm ranked a relevant memory WORSE than lexical-only did, or lost a delivery lexical made. */
export function regressions(lexical: readonly QueryResult[], arm: readonly QueryResult[]): string[] {
  const out: string[] = [];
  arm.forEach((r, i) => {
    const base = lexical[i];
    if (base === undefined) return;
    const worse = base.rank !== null && (r.rank === null || r.rank > base.rank);
    const lost = base.deliveredRelevant && !r.deliveredRelevant;
    if (worse || lost) out.push(`${r.set}: "${r.text}" — rank ${String(base.rank)} → ${String(r.rank)}${lost ? ", delivery lost" : ""}`);
  });
  return out;
}

async function runOnce(
  opts: TrialOptions,
  grid: readonly { floor: number; weight: number }[],
  log: (line: string) => void,
): Promise<{ run: TrialRun; voyage: boolean }> {
  const env = opts.env ?? process.env;
  const dir = mkdtempSync(join(tmpdir(), "cp-embedder-trial-"));
  try {
    const t0 = performance.now();
    await seedDemo({ dir });
    const seedMs = performance.now() - t0;

    // Labels → ids, against the seeded content. A label that matches nothing is
    // a typo in this file, and the run refuses rather than scoring a miss.
    const bare = Store.open({ dir });
    const live = bare.list({ archived: false });
    const bodies = new Map(live.map((id) => [id, bare.readProse(id).body] as const));
    const relevantIds = QUERIES.map((q) => {
      const ids = new Set<string>();
      for (const [id, body] of bodies) if (q.relevant.some((s) => body.includes(s))) ids.add(id);
      if (ids.size === 0) throw new Error(`label matches nothing in the seeded store: ${q.relevant.join(" | ")}`);
      return ids;
    });
    const storeSize = live.length;

    const arms: ArmReport[] = [];
    const models: ModelReport[] = [];
    const armOf = (
      name: string,
      identity: string,
      floor: number,
      weight: number,
      rows: QueryResult[],
      semantic: boolean,
      perTurn: PerTurnResult[],
    ): ArmReport => {
      const lexRows = arms[0]?.rows ?? rows;
      const lexTurns = arms[0]?.perTurnRows ?? null;
      const para = (xs: readonly PerTurnResult[]): PerTurnResult[] => xs.filter((r) => r.set === "paraphrase");
      const lex = (xs: readonly PerTurnResult[]): PerTurnResult[] => xs.filter((r) => r.set === "lexical");
      return {
        perTurnParaphrase: summarizePerTurn(para(perTurn), lexTurns === null ? null : para(lexTurns)),
        perTurnLexical: summarizePerTurn(lex(perTurn), lexTurns === null ? null : lex(lexTurns)),
        perTurnRows: perTurn,
        name,
        identity,
        floor,
        weight,
        paraphrase: summarize(rows.filter((r) => r.set === "paraphrase")),
        lexical: summarize(rows.filter((r) => r.set === "lexical")),
        semanticParaphrase: semantic ? summarize(rows.filter((r) => r.set === "paraphrase"), (r) => r.semanticRank) : null,
        semanticLexical: semantic ? summarize(rows.filter((r) => r.set === "lexical"), (r) => r.semanticRank) : null,
        regressions: arms.length === 0 ? [] : regressions(lexRows, rows),
        rows,
      };
    };

    // ── lexical-only: no vector on the turn ──
    const lexArm: Arm = { name: "lexical-only", floor: TUNABLES.SEMANTIC_SEED_FLOOR, weight: TUNABLES.SEMANTIC_WEIGHT };
    const lexRows = runArm(bare, relevantIds, lexArm, []);
    const lexTurns = runPerTurnArm(bare, relevantIds, lexArm, []);
    arms.push(armOf("lexical-only", "—", TUNABLES.SEMANTIC_SEED_FLOOR, TUNABLES.SEMANTIC_WEIGHT, lexRows, false, lexTurns));
    bare.close();

    // ── the static tables: the SAME store, reopened under each; the identity
    //    check drops the previous table's vectors and refills inline ──
    const tables: { name: string; dir: string; model: string; dim?: number }[] = [
      { name: "potion-base-8M", dir: opts.potion, model: "potion-base-8M" },
      ...(opts.retrieval === undefined
        ? []
        : [{ name: "static-retrieval-mrl-en-v1@256", dir: opts.retrieval, model: "static-retrieval-mrl-en-v1", dim: 256 }]),
    ];
    for (const t of tables) {
      const model = loadStaticModel({ dir: t.dir, ...(t.dim === undefined ? {} : { dim: t.dim }) });
      const embedder = createStaticEmbedder(model);
      const store = Store.open({ dir, embed: embedder.embed });
      const refill = store.events("cache.embedder.refilled")[0]?.data;
      const w0 = performance.now();
      for (let i = 0; i < 500; i++) model.embed(`${QUERIES[i % QUERIES.length]?.text ?? ""} ${i}`);
      models.push({
        identity: model.identity,
        loadMs: model.loadMs,
        refillMs: typeof refill?.["ms"] === "number" ? refill["ms"] : null,
        refilled: typeof refill?.["embedded"] === "number" ? refill["embedded"] : null,
        msPerEmbed: (performance.now() - w0) / 500,
      });
      log(`  ${model.identity}: ${store.embedderVerdict.kind}, refilled ${String(refill?.["embedded"])} in ${String(refill?.["ms"])} ms`);
      const vectors = QUERIES.map((q) => model.embed(q.text));
      for (const { floor, weight } of grid) {
        const rows = runArm(store, relevantIds, { name: t.name, floor, weight }, vectors);
        const turns = runPerTurnArm(store, relevantIds, { name: t.name, floor, weight }, vectors);
        arms.push(armOf(t.name, model.identity, floor, weight, rows, true, turns));
      }
      store.close();
    }

    // ── Voyage, only with a key already in this process (a paid call per memory) ──
    let voyage = false;
    const key = env["VOYAGE_API_KEY"];
    if (key !== undefined && key.trim().length > 0) {
      const paid: LiveEmbedder = createEmbedder({ config: { embedder: { enabled: true } } });
      const s0 = Store.open({ dir });
      const texts = s0.list({ archived: false }).map((id) => {
        const d = s0.readProse(id);
        return indexTextOf(d.title, d.body);
      });
      s0.close();
      await paid.warm([...texts, ...QUERIES.map((q) => q.text)]);
      const store = Store.open({ dir, embed: paid.embed });
      for (const id of store.missingVectors(Number.MAX_SAFE_INTEGER)) store.embedOne(id);
      const vectors = await Promise.all(QUERIES.map((q) => paid.vector(q.text)));
      for (const { floor, weight } of grid) {
        const rows = runArm(store, relevantIds, { name: "voyage", floor, weight }, vectors);
        const turns = runPerTurnArm(store, relevantIds, { name: "voyage", floor, weight }, vectors);
        arms.push(armOf("voyage", paid.model, floor, weight, rows, true, turns));
      }
      store.close();
      voyage = true;
    }
    return { run: { storeSize, seedMs, models, arms }, voyage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function meanSummary(xs: readonly Summary[]): Summary {
  const m = (f: (s: Summary) => number): number => xs.reduce((a, s) => a + f(s), 0) / Math.max(1, xs.length);
  return {
    n: xs[0]?.n ?? 0,
    r1: m((s) => s.r1),
    r3: m((s) => s.r3),
    r5: m((s) => s.r5),
    r10: m((s) => s.r10),
    mrr: m((s) => s.mrr),
    deliveredHits: m((s) => s.deliveredHits),
    deliveredPerTurn: m((s) => s.deliveredPerTurn),
  };
}

function meanPerTurn(xs: readonly PerTurnSummary[]): PerTurnSummary {
  const m = (f: (s: PerTurnSummary) => number): number => xs.reduce((a, s) => a + f(s), 0) / Math.max(1, xs.length);
  return {
    n: xs[0]?.n ?? 0,
    withinTwo: m((s) => s.withinTwo),
    byLag: m((s) => s.byLag),
    itemsPerTurn: m((s) => s.itemsPerTurn),
    lost: m((s) => s.lost),
  };
}

export async function runTrial(opts: TrialOptions): Promise<TrialReport> {
  const log = opts.log ?? ((): void => {});
  const floors = opts.floors ?? [TUNABLES.SEMANTIC_SEED_FLOOR, 0.35, 0.25, 0.15, 0];
  const weights = opts.weights ?? [TUNABLES.SEMANTIC_WEIGHT, 3, 6];
  const grid = weights.flatMap((weight) => floors.map((floor) => ({ floor, weight })));
  const runs = Math.max(1, opts.runs ?? 5);
  const all: TrialRun[] = [];
  let voyage = false;
  for (let i = 0; i < runs; i++) {
    log(`run ${i + 1}/${runs}`);
    const got = await runOnce(opts, grid, log);
    all.push(got.run);
    voyage = voyage || got.voyage;
  }
  const first = all[0];
  if (first === undefined) throw new Error("no run");
  const aggregate: AggregateArm[] = first.arms.map((a, idx) => {
    const same = all.map((r) => r.arms[idx]).filter((x): x is ArmReport => x !== undefined);
    const paraMrr = same.map((x) => x.paraphrase.mrr);
    const paraDel = same.map((x) => x.paraphrase.deliveredHits);
    const regs = same.map((x) => x.regressions.length);
    const sp = same.map((x) => x.semanticParaphrase).filter((x): x is Summary => x !== null);
    const sl = same.map((x) => x.semanticLexical).filter((x): x is Summary => x !== null);
    return {
      name: a.name,
      identity: a.identity,
      floor: a.floor,
      weight: a.weight,
      paraphrase: meanSummary(same.map((x) => x.paraphrase)),
      lexical: meanSummary(same.map((x) => x.lexical)),
      semanticParaphrase: sp.length === 0 ? null : meanSummary(sp),
      semanticLexical: sl.length === 0 ? null : meanSummary(sl),
      paraMrrRange: [Math.min(...paraMrr), Math.max(...paraMrr)],
      paraDeliveredRange: [Math.min(...paraDel), Math.max(...paraDel)],
      regressionsMean: regs.reduce((s, x) => s + x, 0) / Math.max(1, regs.length),
      regressionsMax: Math.max(...regs),
      perTurnParaphrase: meanPerTurn(same.map((x) => x.perTurnParaphrase)),
      perTurnLexical: meanPerTurn(same.map((x) => x.perTurnLexical)),
    };
  });
  return {
    runs,
    first,
    aggregate,
    voyage: voyage ? "measured" : "no-key",
    shippedFloor: TUNABLES.SEMANTIC_SEED_FLOOR,
    shippedWeight: TUNABLES.SEMANTIC_WEIGHT,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

const f1 = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const f2 = (x: number): string => x.toFixed(2);
const f3 = (x: number): string => x.toFixed(3);

export function renderTrial(report: TrialReport): string {
  const out: string[] = [];
  const lex = report.aggregate.find((a) => a.name === "lexical-only");
  const first = report.first;
  out.push(
    `Seeded store: ${first.storeSize} live memories (tools/demo/seed.ts, a fresh temp dir per run), ${report.runs} runs (reseeded each time; means shown, ranges where they decide). Voyage: ${report.voyage === "measured" ? "measured" : "not measured (no VOYAGE_API_KEY in this process)"}.`,
  );
  out.push("");
  out.push("| model | load ms | inline refill at open | ms / embed |");
  out.push("|---|---|---|---|");
  for (const m of first.models) {
    out.push(`| ${m.identity} | ${m.loadMs.toFixed(1)} | ${m.refilled === null ? "—" : `${m.refilled} memories in ${m.refillMs} ms`} | ${m.msPerEmbed.toFixed(4)} |`);
  }
  out.push("");
  out.push(
    `**Deliberate path (the MCP recall tool's shape: the question's own vector, in line)** — the activation ranking (\`recall.activate\`, no candidate cap; R@k = queries with a relevant memory in the top k, MRR over the first relevant) and the delivered set (\`Recall.build\`, the real gate). Paraphrase n=${lex?.paraphrase.n ?? 0}, lexical n=${lex?.lexical.n ?? 0}. floor = SEMANTIC_SEED_FLOOR (shipped ${report.shippedFloor}), weight = SEMANTIC_WEIGHT (shipped ${report.shippedWeight}) — bench parameters, neither changed in recall/. Regressions = queries (either set) ranked lower than lexical-only ranked them, or a delivery lexical-only made and this arm lost; mean per run (max).`,
  );
  out.push("");
  out.push("| arm | floor | weight | para R@1 | R@3 | R@5 | R@10 | MRR (range) | delivered (range) | items/turn | lex R@1 | R@3 | MRR | delivered | items/turn | regressions |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of report.aggregate) {
    const p = a.paraphrase;
    const l = a.lexical;
    const isLex = a.name === "lexical-only";
    const shipped = a.floor === report.shippedFloor && a.weight === report.shippedWeight;
    const name = isLex ? "**lexical-only**" : shipped ? `**${a.name}** (shipped)` : a.name;
    out.push(
      `| ${name} | ${isLex ? "—" : a.floor} | ${isLex ? "—" : a.weight} | ${f1(p.r1)} | ${f1(p.r3)} | ${f1(p.r5)} | ${f1(p.r10)} | ${f3(p.mrr)} (${f3(a.paraMrrRange[0])}–${f3(a.paraMrrRange[1])}) | ${f1(p.deliveredHits)} (${a.paraDeliveredRange[0]}–${a.paraDeliveredRange[1]}) | ${f2(p.deliveredPerTurn)} | ${f1(l.r1)} | ${f1(l.r3)} | ${f3(l.mrr)} | ${f1(l.deliveredHits)} | ${f2(l.deliveredPerTurn)} | ${isLex ? "—" : `${f1(a.regressionsMean)} (${a.regressionsMax})`} |`,
    );
  }
  out.push("");
  out.push(
    `**The per-turn (hook) path** — two turns per query through \`Recall.recall\`: turn 1 is the question (no lagged cue yet, as on any first turn), the worker ranks the question and stores it as the lagged cue, turn 2 is "${FOLLOW_UP}". within two = a relevant memory delivered on turn 1 or 2; by lag = delivered only on turn 2; lost = delivered within two turns by lexical-only and not by this arm. Means over ${report.runs} runs.`,
  );
  out.push("");
  out.push("| arm | floor | weight | para within two | para by lag | para lost | lex within two | lex lost | items/turn (para) |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const a of report.aggregate) {
    const isLex = a.name === "lexical-only";
    const p = a.perTurnParaphrase;
    const l = a.perTurnLexical;
    const shipped = a.floor === report.shippedFloor && a.weight === report.shippedWeight;
    const name = isLex ? "**lexical-only**" : shipped ? `**${a.name}** (shipped)` : a.name;
    out.push(
      `| ${name} | ${isLex ? "—" : a.floor} | ${isLex ? "—" : a.weight} | ${f1(p.withinTwo)}/${p.n} | ${f1(p.byLag)} | ${isLex ? "—" : f1(p.lost)} | ${f1(l.withinTwo)}/${l.n} | ${isLex ? "—" : f1(l.lost)} | ${f2(p.itemsPerTurn)} |`,
    );
  }
  out.push("");
  out.push("**The raw semantic channel** — `Store.nearestTo` alone, the whole store ranked by cosine — and its cosine scale (first run):");
  out.push("");
  out.push("| model | para R@1 | R@3 | R@5 | R@10 | MRR | lex R@1 | R@5 | MRR | mean best-relevant cos | mean best-other cos | queries whose best relevant ≥ shipped floor |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  const seen = new Set<string>();
  for (const a of report.aggregate) {
    if (a.semanticParaphrase === null || a.semanticLexical === null || seen.has(a.name)) continue;
    seen.add(a.name);
    const rows = first.arms.find((x) => x.name === a.name)?.rows ?? [];
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const rel = rows.map((r) => r.bestRelevantCos ?? 0);
    const oth = rows.map((r) => r.bestOtherCos ?? 0);
    const clear = rows.filter((r) => (r.bestRelevantCos ?? 0) >= report.shippedFloor).length;
    const sp = a.semanticParaphrase;
    const sl = a.semanticLexical;
    out.push(
      `| ${a.identity} | ${f1(sp.r1)} | ${f1(sp.r3)} | ${f1(sp.r5)} | ${f1(sp.r10)} | ${f3(sp.mrr)} | ${f1(sl.r1)} | ${f1(sl.r5)} | ${f3(sl.mrr)} | ${f3(mean(rel))} | ${f3(mean(oth))} | ${clear}/${rows.length} |`,
    );
  }
  out.push("");
  out.push("**Per query, first run** — rank of the first relevant memory in the activation ranking (— = never a candidate); `*` = delivered by the gate.");
  out.push("");
  const heads = first.arms.filter(
    (a) =>
      a.name === "lexical-only" ||
      (a.weight === report.shippedWeight && a.floor === report.shippedFloor) ||
      (a.weight === 6 && a.floor === 0.15),
  );
  out.push(`| set | query | ${heads.map((a) => (a.name === "lexical-only" ? a.name : `${a.name} f${a.floor} w${a.weight}`)).join(" | ")} |`);
  out.push(`|---|---|${heads.map(() => "---").join("|")}|`);
  QUERIES.forEach((q, i) => {
    const cells = heads.map((a) => {
      const r = a.rows[i];
      if (r === undefined) return "?";
      return `${r.rank === null ? "—" : r.rank}${r.deliveredRelevant ? "*" : ""}`;
    });
    out.push(`| ${q.set} | ${q.text} | ${cells.join(" | ")} |`);
  });
  return out.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: readonly string[]): Promise<number> {
  const potion = flag(argv, "--potion") ?? resolveStaticWeights()?.dir;
  if (potion === undefined) {
    process.stderr.write("embedder-trial: no potion weights — pass --potion <dir> or set COUNTERPARTS_STATIC_WEIGHTS_DIR\n");
    return 2;
  }
  const retrieval = flag(argv, "--retrieval");
  const runsFlag = flag(argv, "--runs");
  const report = await runTrial({
    potion,
    ...(retrieval === undefined ? {} : { retrieval }),
    ...(runsFlag === undefined ? {} : { runs: Number(runsFlag) }),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  const md = renderTrial(report);
  const outPath = flag(argv, "--out");
  if (outPath !== undefined) writeFileSync(outPath, `${md}\n`);
  const jsonPath = flag(argv, "--json");
  if (jsonPath !== undefined) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${md}\n`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
