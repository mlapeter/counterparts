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
 * it afterwards. Nothing here reads a real store or a config. (A paid Voyage
 * arm ran here too until the Voyage embedder was removed, 2026-09-24.)
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
 *     measures is what the lag can add the turn after a question: its CEILING.
 *   - **PER-TURN, TOPIC CHANGE** (2026-09-23, the retune): the same, but turn 2
 *     is a DIFFERENT query whose answer shares nothing with the first. The lag
 *     is now about the wrong subject; what it costs — the new subject's target
 *     lost, stale items from the old one — is measured, not guessed.
 *
 * Per arm (lexical-only; each static table):
 *
 *   1. the ACTIVATION RANKING — `recall.activate` over the whole store with no
 *      candidate cap, the turn's vector supplied (or not): rank of the first
 *      relevant memory → recall@1/3/5/10 and MRR;
 *   2. the DELIVERED set — `Recall.build`, the real gate: did a relevant memory
 *      reach the model, and how many items came with it (the noise a channel
 *      buys);
 *   3. the RAW semantic channel — `Store.nearestTo` alone, and the cosine
 *      distribution: best relevant vs best irrelevant, and how many queries'
 *      best relevant clears the default floor (0.45, Voyage's calibration).
 *
 * **The grid and the shipped table.** Each grid cell applies ONE floor/weight to
 * both paths with `SEMANTIC_BY_IDENTITY` emptied, so the swept pair is what
 * runs; a separate **table** arm per model runs the SHIPPED tunables unchanged —
 * the per-identity, per-path values `recall/tunables.ts` chose from this bench —
 * so the report shows them reproducing. `--floors` / `--weights` set the grid.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStaticEmbedder } from "../../src/adapters/claude-code/embed-client.js";
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
import type { RecallTunables } from "../../src/core/recall/index.js";
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
  /** SEMANTIC_WEIGHT for this grid cell (both paths; the identity table emptied). */
  readonly weight: number;
  /**
   * `true`: run the SHIPPED tunables, per-identity table and all — the chosen
   * values reproducing. Otherwise the swept floor/weight, applied to both paths
   * through the defaults (the identity table emptied, or its entry would win).
   */
  readonly shipped?: boolean;
  /**
   * The model name the worker writes into a lag row (`LiveEmbedder.model`: the
   * table's content-derived name). Recall drops a row ranked under another
   * model than the store records (`other-model`), so it must be the real one.
   */
  readonly lagModel?: string;
}

function armTunables(arm: Arm): RecallTunables {
  return arm.shipped === true
    ? withTunables({ BUDGET_MS: 600_000 })
    : withTunables({
        SEMANTIC_SEED_FLOOR: arm.floor,
        SEMANTIC_WEIGHT: arm.weight,
        SEMANTIC_BY_IDENTITY: {},
        BUDGET_MS: 600_000,
      });
}

function armKey(arm: Arm): string {
  return arm.shipped === true ? `${arm.name}-shipped` : `${arm.name}-${arm.floor}-${arm.weight}`;
}

function runArm(store: Store, relevantIds: readonly Set<string>[], arm: Arm, vectors: readonly (number[] | null)[]): QueryResult[] {
  const tunables = armTunables(arm);
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
      sessionId: `trial-${armKey(arm)}-${i}`,
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
  const tunables = armTunables(arm);
  const recall = new Recall({ store, owner: true, tunables });
  const day = store.livedDay();
  const out: PerTurnResult[] = [];
  QUERIES.forEach((q, i) => {
    const relevant = relevantIds[i] ?? new Set<string>();
    const sessionId = `pt-${armKey(arm)}-${i}`;
    const t1 = recall.recall({ sessionId, text: q.text, owner: true, day }).decision;
    const vector = vectors[i] ?? null;
    if (vector !== null) {
      // The worker, after the boundary: rank the exchange, stamp it for the next turn.
      saveSessionSemantic(store, {
        sessionId,
        turn: loadGateState(store, sessionId).state.turn,
        lastDay: day,
        reason: "ok",
        model: arm.lagModel ?? arm.name,
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

// ── the TOPIC-CHANGING per-turn arm: what the lag COSTS ──────────────────
//
// The on-topic arm above is the lag's CEILING: its turn 2 names no topic, so
// anything the lag brings is on the question's subject. This arm is the other
// half. Turn 1 is query i; the worker's rank of i becomes the lag; turn 2 is a
// DIFFERENT query j, about something else (its relevant set is disjoint from
// i's). The lag is now about the wrong subject, and what it costs is measured
// as: j's target lost against lexical-only's turn 2, stale intrusions (items
// relevant to i — the OLD subject — delivered on turn 2; per-session dedup
// means these are i's memories that turn 1 did not already deliver), and the
// items per turn it adds.

export interface TopicChangeResult {
  /** The set of turn 2's query (j). */
  readonly set: TrialQuery["set"];
  readonly text: string;
  /** j's relevant memory delivered on turn 2. */
  readonly turn2: boolean;
  /**
   * STALE INTRUSIONS, the honest count (review MINOR 3): turn-2 deliveries that
   * the LAG brought — they are among the lagged hits for i — and that are not
   * relevant to j. (The first version counted only i's LABELLED targets, a
   * lower bound blind to anything else the lag pulled in off-topic.)
   */
  readonly stale: number;
  /** The old, labelled-only count, kept for comparison: turn-2 items relevant to i and not to j. */
  readonly staleLabelled: number;
  /** The ids behind `stale`, and every turn-2 delivery — so a summary can subtract what lexical-only delivered anyway. */
  readonly staleIds: readonly string[];
  readonly delivered2: readonly string[];
  readonly items2: number;
}

export interface TopicChangeSummary {
  readonly n: number;
  readonly delivered: number;
  /** Turn-2 targets lexical-only delivered and this arm did not. */
  readonly lost: number;
  /** Stale intrusions (turn-2 deliveries among the lag's hits, not relevant to j), summed over the pairs. */
  readonly stale: number;
  /**
   * …of which lexical-only did NOT deliver on the same turn: what the lag ADDED.
   * Some of the lag's hits are delivered anyway by the new query's own words;
   * those are not a cost of the lag, and this subtracts them.
   */
  readonly staleAdded: number;
  readonly items2: number;
}

/** The partner j for query i: the next query (cyclically) whose relevant set shares nothing with i's. */
export function topicPartner(i: number, relevantIds: readonly Set<string>[]): number {
  const mine = relevantIds[i] ?? new Set<string>();
  for (let step = 1; step < relevantIds.length; step++) {
    const j = (i + step) % relevantIds.length;
    const theirs = relevantIds[j] ?? new Set<string>();
    if ([...theirs].every((id) => !mine.has(id))) return j;
  }
  return (i + 1) % relevantIds.length;
}

function runTopicChangeArm(
  store: Store,
  relevantIds: readonly Set<string>[],
  arm: Arm,
  vectors: readonly (number[] | null)[],
): TopicChangeResult[] {
  const tunables = armTunables(arm);
  const recall = new Recall({ store, owner: true, tunables });
  const day = store.livedDay();
  const out: TopicChangeResult[] = [];
  QUERIES.forEach((q, i) => {
    const j = topicPartner(i, relevantIds);
    const next = QUERIES[j];
    if (next === undefined) return;
    const oldTopic = relevantIds[i] ?? new Set<string>();
    const newTopic = relevantIds[j] ?? new Set<string>();
    const sessionId = `tc-${armKey(arm)}-${i}`;
    recall.recall({ sessionId, text: q.text, owner: true, day });
    const vector = vectors[i] ?? null;
    if (vector !== null) {
      saveSessionSemantic(store, {
        sessionId,
        turn: loadGateState(store, sessionId).state.turn,
        lastDay: day,
        reason: "ok",
        model: arm.lagModel ?? arm.name,
        dim: vector.length,
        hits: store.nearestTo(vector, tunables.SEMANTIC_TOP_M),
      });
    }
    const lag = loadSessionSemantic(store, sessionId);
    const lagIds = new Set((lag.hits ?? []).map((h) => h.id));
    const t2 = recall.recall({
      sessionId,
      text: next.text,
      owner: true,
      day,
      ...(lag.hits === null ? {} : { semanticHits: lag.hits }),
      semanticSource: lag.source,
    }).decision;
    const d2 = [...t2.surfaced, ...t2.footnotes];
    out.push({
      set: next.set,
      text: next.text,
      turn2: d2.some((id) => newTopic.has(id)),
      stale: d2.filter((id) => lagIds.has(id) && !newTopic.has(id)).length,
      staleLabelled: d2.filter((id) => oldTopic.has(id) && !newTopic.has(id)).length,
      staleIds: d2.filter((id) => lagIds.has(id) && !newTopic.has(id)),
      delivered2: d2,
      items2: d2.length,
    });
  });
  return out;
}

export function summarizeTopicChange(
  rows: readonly TopicChangeResult[],
  lexical: readonly TopicChangeResult[] | null,
): TopicChangeSummary {
  const n = rows.length;
  return {
    n,
    delivered: rows.filter((r) => r.turn2).length,
    lost: lexical === null ? 0 : rows.filter((r, i) => (lexical[i]?.turn2 ?? false) && !r.turn2).length,
    stale: rows.reduce((a, r) => a + r.stale, 0),
    staleAdded: rows.reduce((a, r, i) => {
      const base = new Set(lexical?.[i]?.delivered2 ?? []);
      return a + r.staleIds.filter((id) => !base.has(id)).length;
    }, 0),
    items2: n === 0 ? 0 : rows.reduce((a, r) => a + r.items2, 0) / n,
  };
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
  /** The deliberate path's DELIVERIES lexical-only made and this arm lost (rank slips are `regressions`). */
  readonly deliveriesLost: number;
  /** The topic-changing per-turn arm, split by the set of turn 2's query. */
  readonly topicParaphrase: TopicChangeSummary;
  readonly topicLexical: TopicChangeSummary;
  readonly topicRows: readonly TopicChangeResult[];
  readonly shipped: boolean;
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
  readonly deliveriesLostMean: number;
  readonly deliveriesLostMax: number;
  readonly topicParaphrase: TopicChangeSummary;
  readonly topicLexical: TopicChangeSummary;
  readonly shipped: boolean;
}

export interface TrialReport {
  readonly runs: number;
  readonly first: TrialRun;
  readonly aggregate: readonly AggregateArm[];
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
): Promise<{ run: TrialRun }> {
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
      topic: TopicChangeResult[],
      shipped = false,
    ): ArmReport => {
      const lexRows = arms[0]?.rows ?? rows;
      const lexTurns = arms[0]?.perTurnRows ?? null;
      const lexTopic = arms[0]?.topicRows ?? null;
      const para = (xs: readonly PerTurnResult[]): PerTurnResult[] => xs.filter((r) => r.set === "paraphrase");
      const lex = (xs: readonly PerTurnResult[]): PerTurnResult[] => xs.filter((r) => r.set === "lexical");
      const tPara = (xs: readonly TopicChangeResult[]): TopicChangeResult[] => xs.filter((r) => r.set === "paraphrase");
      const tLex = (xs: readonly TopicChangeResult[]): TopicChangeResult[] => xs.filter((r) => r.set === "lexical");
      return {
        deliveriesLost:
          arms.length === 0 ? 0 : rows.filter((r, i) => (lexRows[i]?.deliveredRelevant ?? false) && !r.deliveredRelevant).length,
        topicParaphrase: summarizeTopicChange(tPara(topic), lexTopic === null ? null : tPara(lexTopic)),
        topicLexical: summarizeTopicChange(tLex(topic), lexTopic === null ? null : tLex(lexTopic)),
        topicRows: topic,
        shipped,
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
    const lexTopic = runTopicChangeArm(bare, relevantIds, lexArm, []);
    arms.push(armOf("lexical-only", "—", TUNABLES.SEMANTIC_SEED_FLOOR, TUNABLES.SEMANTIC_WEIGHT, lexRows, false, lexTurns, lexTopic));
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
      // The SHIPPED table first — the chosen values reproducing — then the grid.
      const shippedArm: Arm = { name: t.name, floor: Number.NaN, weight: Number.NaN, shipped: true, lagModel: model.model };
      arms.push(
        armOf(
          t.name,
          model.identity,
          Number.NaN,
          Number.NaN,
          runArm(store, relevantIds, shippedArm, vectors),
          true,
          runPerTurnArm(store, relevantIds, shippedArm, vectors),
          runTopicChangeArm(store, relevantIds, shippedArm, vectors),
          true,
        ),
      );
      for (const { floor, weight } of grid) {
        const arm: Arm = { name: t.name, floor, weight, lagModel: model.model };
        const rows = runArm(store, relevantIds, arm, vectors);
        const turns = runPerTurnArm(store, relevantIds, arm, vectors);
        const topic = runTopicChangeArm(store, relevantIds, arm, vectors);
        arms.push(armOf(t.name, model.identity, floor, weight, rows, true, turns, topic));
      }
      store.close();
    }

    return { run: { storeSize, seedMs, models, arms } };
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

function meanTopic(xs: readonly TopicChangeSummary[]): TopicChangeSummary {
  const m = (f: (s: TopicChangeSummary) => number): number => xs.reduce((a, s) => a + f(s), 0) / Math.max(1, xs.length);
  return {
    n: xs[0]?.n ?? 0,
    delivered: m((s) => s.delivered),
    lost: m((s) => s.lost),
    stale: m((s) => s.stale),
    staleAdded: m((s) => s.staleAdded),
    items2: m((s) => s.items2),
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
  for (let i = 0; i < runs; i++) {
    log(`run ${i + 1}/${runs}`);
    const got = await runOnce(opts, grid, log);
    all.push(got.run);
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
      deliveriesLostMean: same.reduce((s, x) => s + x.deliveriesLost, 0) / Math.max(1, same.length),
      deliveriesLostMax: Math.max(...same.map((x) => x.deliveriesLost)),
      topicParaphrase: meanTopic(same.map((x) => x.topicParaphrase)),
      topicLexical: meanTopic(same.map((x) => x.topicLexical)),
      shipped: a.shipped,
    };
  });
  return {
    runs,
    first,
    aggregate,
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
    `Seeded store: ${first.storeSize} live memories (tools/demo/seed.ts, a fresh temp dir per run), ${report.runs} runs (reseeded each time; means shown, ranges where they decide).`,
  );
  out.push("");
  out.push("| model | load ms | inline refill at open | ms / embed |");
  out.push("|---|---|---|---|");
  for (const m of first.models) {
    out.push(`| ${m.identity} | ${m.loadMs.toFixed(1)} | ${m.refilled === null ? "—" : `${m.refilled} memories in ${m.refillMs} ms`} | ${m.msPerEmbed.toFixed(4)} |`);
  }
  out.push("");
  out.push(
    `**The tuning grid.** One row per floor/weight, applied to BOTH paths (the identity table emptied so the swept pair is what runs); the **table** row is the SHIPPED \`SEMANTIC_BY_IDENTITY\` entry reproducing. Means over ${report.runs} reseeds. Paraphrase n=${lex?.paraphrase.n ?? 0}, lexical n=${lex?.lexical.n ?? 0}.`,
  );
  out.push("");
  out.push(
    "- **Deliberate** (the question's own vector, in line — the MCP `recall` tool): paraphrase targets delivered, MRR over the activation ranking, lexical targets delivered, deliveries lost against lexical-only (either set), rank slips (either set; a slip is a relevant memory ranked lower than lexical-only ranked it), items per turn (paraphrase).",
  );
  out.push(
    `- **Per-turn, on topic** (the hook: question, the worker's rank of it as the lagged cue, then "${FOLLOW_UP}"): paraphrase targets delivered within two turns, of which by the lag alone, deliveries lost. This is the lag's CEILING.`,
  );
  out.push(
    "- **Per-turn, topic change** (question i, its lag, then a DIFFERENT query j): j's targets delivered on turn 2 (paraphrase / lexical), j's targets lost against lexical-only, stale intrusions (turn-2 deliveries that are among i's lagged hits and not relevant to j; summed over the 40 pairs), stale ADDED (of those, the ones lexical-only did not deliver on the same turn anyway — what the lag actually brought), turn-2 items. This is the lag's COST.",
  );
  out.push("");
  out.push(
    "| arm | floor | weight | delib para | MRR | delib lex | delib lost | slips | items/turn | on-topic within two | by lag | lost | topic: para j | lex j | j lost | stale | stale added | turn-2 items |",
  );
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of report.aggregate) {
    const isLex = a.name === "lexical-only";
    const p = a.paraphrase;
    const l = a.lexical;
    const pt = a.perTurnParaphrase;
    const tp = a.topicParaphrase;
    const tl = a.topicLexical;
    const name = isLex ? "**lexical-only**" : a.shipped ? `**${a.name} (table)**` : a.name;
    const fw = (x: number): string => (isLex ? "—" : a.shipped ? "table" : String(x));
    out.push(
      `| ${name} | ${fw(a.floor)} | ${fw(a.weight)} | ${f1(p.deliveredHits)}/${p.n} | ${f3(p.mrr)} | ${f1(l.deliveredHits)}/${l.n} | ${isLex ? "—" : f1(a.deliveriesLostMean)} | ${isLex ? "—" : f1(a.regressionsMean)} | ${f2(p.deliveredPerTurn)} | ${f1(pt.withinTwo)}/${pt.n} | ${f1(pt.byLag)} | ${isLex ? "—" : f1(pt.lost + a.perTurnLexical.lost)} | ${f1(tp.delivered)}/${tp.n} | ${f1(tl.delivered)}/${tl.n} | ${isLex ? "—" : f1(tp.lost + tl.lost)} | ${f1(tp.stale + tl.stale)} | ${isLex ? "—" : f1(tp.staleAdded + tl.staleAdded)} | ${f2((tp.items2 * tp.n + tl.items2 * tl.n) / Math.max(1, tp.n + tl.n))} |`,
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
  out.push("**Per query, first run, deliberate path** — rank of the first relevant memory in the activation ranking (— = never a candidate); `*` = delivered by the gate.");
  out.push("");
  const heads = first.arms.filter(
    (a) => a.name === "lexical-only" || a.shipped || (a.weight === report.shippedWeight && a.floor === report.shippedFloor),
  );
  out.push(
    `| set | query | ${heads.map((a) => (a.name === "lexical-only" ? a.name : a.shipped ? `${a.name} (table)` : `${a.name} f${a.floor} w${a.weight}`)).join(" | ")} |`,
  );
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
  const list = (name: string): number[] | undefined => flag(argv, name)?.split(",").map(Number);
  const floors = list("--floors");
  const weights = list("--weights");
  const report = await runTrial({
    potion,
    ...(retrieval === undefined ? {} : { retrieval }),
    ...(runsFlag === undefined ? {} : { runs: Number(runsFlag) }),
    ...(floors === undefined ? {} : { floors }),
    ...(weights === undefined ? {} : { weights }),
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
