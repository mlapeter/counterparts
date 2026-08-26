/**
 * Deliberate recall — effortful, voluntary retrieval, as distinct from the
 * ambient reminding `recall/` already performs every turn.
 *
 * **Brain analog.** Ambient recall is cue-driven reminding; this is a directed
 * search of memory — slower, more effortful, and able to reach material the
 * automatic path left below threshold. What it CANNOT do is reach material that
 * was never cued at all: effort lowers a threshold, it does not conjure an
 * association that does not exist. That is why the hard gates below survive the
 * deeper look and the soft ones do not.
 *
 * **Built on `Recall.build()`, deliberately.** `build` is the pure half of the
 * ambient path: it reads, scores, gates and composes, and writes nothing —
 * `recall()` is the half that records. Reusing `build` means deliberate recall
 * faces the same activation model, the same background bar and the same
 * confidentiality verdict the ambient path does, and gets G4 ("ranking is not
 * recording — this path trains nothing and deposits nothing") for free rather
 * than by promising it. Nothing here calls `resolveUse` or `coactivate`.
 *
 * **The two paths never blur** (§9.1 G1). A handle EXPANDS: `store.resolve`,
 * exact title match, and if neither answers, not-found — there is no search
 * fallback in this file, and a test asserts a near-miss handle returns nothing
 * rather than the memory a fuzzy match would have found. Expansion degrading
 * into fuzzy search is how a precise question quietly becomes a vibe.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { strength } from "../../core/physics/index.js";
import { isConfidential } from "../../core/recall/index.js";
import type { CandidateVerdict, Verdict } from "../../core/recall/index.js";

/**
 * The confidence tiers this adapter reports. Named, not numeric: v1 labeled its
 * fallback tier and left the rest implicit, which made "how sure was it" a
 * question only a replay could answer (CONTRACT §7 OQ3 — answered here as tier
 * names, because a number implies a calibration nobody has done).
 */
export type Tier = "vivid" | "quiet" | "dim";

/**
 * Verdicts the deeper look ADMITS, at the `dim` tier. Every one of them is a
 * SOFT gate in the ambient path: a bar this turn's background happened to set,
 * a per-kind loud-tier floor, a tier cap, a session-dedup, or the rule that a
 * remembered date may make a memory quiet but never loud. Deliberate effort is
 * exactly the license to look under those.
 */
export const DELIBERATE_TIERS: readonly Verdict[] = [
  "below-bar",
  "below-strong-floor",
  "capped",
  "dedup-suppressed",
  "cue-only-temporal",
];

/**
 * Verdicts effort does NOT overturn, and why each one holds:
 *   `dark-uncued`  — hard gate (a). Nothing in the question reached it; a
 *                    memory reached by nothing is not being remembered, it is
 *                    being enumerated.
 *   `below-floor`  — hard gate (b). Below the global floor is below the floor.
 *   `cue-fraction` — hard gate (c). Too little of the activation came from the
 *                    words actually asked; admitting it is drift, not recall.
 *   `inhibited`    — a near-duplicate of something already returned. Nothing is
 *                    withheld by including only the stronger twin.
 *   `confidential-withheld` — the boundary of the ask, handled separately below.
 */
export const HARD_GATES: readonly Verdict[] = ["dark-uncued", "below-floor", "cue-fraction"];

/** Adapter-owned, not a memory property: how many dim items are worth reading. */
export const DELIBERATE_DIM_CAP = 5;

export interface Recalled {
  readonly id: string;
  readonly tier: Tier;
  readonly kind: string;
  readonly title: string | null;
  /** The body. The quiet tier returns bodies here, not a count (§9.1 G2). */
  readonly body: string;
  readonly strength: number;
  readonly activation: number;
  /** For a dim item: which loud-tier check the ambient path stopped it at. */
  readonly admittedUnder?: Verdict;
}

export type DeliberateReason =
  | "expanded"
  | "answered"
  | "handle-unknown"
  | "handle-ambiguous"
  | "handle-confidential-withheld"
  | "nothing-came"
  | "no-argument"
  | "both-arguments";

export interface DeliberateResult {
  readonly path: "handle" | "question" | "none";
  readonly reason: DeliberateReason;
  readonly memories: readonly Recalled[];
  /** Candidates the deeper look actually considered — NOT the number returned.
   *  §9.1 G3: a top-K tuned for surfacing is the wrong answer to "how many". */
  readonly considered: number;
  /** Live memories in the store. The denominator an aggregation question needs. */
  readonly storeSize: number;
  /** Ids a handle matched when the handle was ambiguous. Ids only, no bodies. */
  readonly ambiguous: readonly string[];
}

export interface DeliberateInput {
  readonly handle?: string;
  readonly question?: string;
}

export interface DeliberateOptions {
  readonly sessionId: string;
  /** The owner's own session? Confidentiality turns on this and nothing else. */
  readonly owner: boolean;
  readonly day?: number;
}

const EMPTY = {
  memories: [] as readonly Recalled[],
  considered: 0,
  storeSize: 0,
  ambiguous: [] as readonly string[],
};

/**
 * The dispatcher. EXACTLY ONE argument: two is a caller who does not know which
 * question they are asking, and answering the more convenient one is how the
 * expansion path quietly becomes the search path.
 */
export function deliberateRecall(
  counterpart: Counterpart,
  input: DeliberateInput,
  opts: DeliberateOptions,
): DeliberateResult {
  const hasHandle = typeof input.handle === "string" && input.handle.trim().length > 0;
  const hasQuestion = typeof input.question === "string" && input.question.trim().length > 0;
  if (hasHandle && hasQuestion) {
    return { path: "none", reason: "both-arguments", ...EMPTY };
  }
  if (hasHandle) return expandHandle(counterpart, (input.handle as string).trim(), opts);
  if (hasQuestion) return answerQuestion(counterpart, (input.question as string).trim(), opts);
  return { path: "none", reason: "no-argument", ...EMPTY };
}

/**
 * THE EXPANSION PATH. Exact by construction: an id that resolves, or a title
 * that matches exactly after trimming and case-folding. No scoring, no cues, no
 * `store.search` — this function does not import one.
 *
 * Withholding is STATED here (§9.1 G5): a direct lookup that answers "nothing"
 * where something exists would be a lie, so the refusal names itself. In the
 * list path below, the same material is dropped silently, because a list that
 * announces its gaps is a list that leaks their existence.
 */
export function expandHandle(
  counterpart: Counterpart,
  handle: string,
  opts: DeliberateOptions,
): DeliberateResult {
  const store = counterpart.store;
  const storeSize = store.list({ archived: false }).length;
  const base = { path: "handle" as const, storeSize, ambiguous: [] as readonly string[] };

  const matches: string[] = [];
  try {
    matches.push(store.resolve(handle));
  } catch {
    // Not an id, or an id that no longer resolves. Fall through to titles —
    // which is NOT a fuzzy fallback: it is the other exact address a memory has.
  }
  if (matches.length === 0) {
    const wanted = handle.toLowerCase();
    for (const id of store.list({ archived: false })) {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null) continue;
      let title: string | null = null;
      try {
        title = store.readProse(id).title ?? null;
      } catch {
        continue;
      }
      if (title !== null && title.trim().toLowerCase() === wanted) matches.push(id);
    }
  }

  if (matches.length === 0) {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (matches.length > 1) {
    // Ids only: an ambiguous handle names the choice without making it, and
    // returning every body would hand back the thing the ambiguity conceals.
    return {
      ...base,
      reason: "handle-ambiguous",
      memories: [],
      considered: matches.length,
      ambiguous: matches,
    };
  }

  const id = matches[0] as string;
  const read = store.read(id);
  if (!opts.owner && isConfidential(read.doc)) {
    return { ...base, reason: "handle-confidential-withheld", memories: [], considered: 1 };
  }
  return {
    ...base,
    reason: "expanded",
    considered: 1,
    memories: [
      {
        id,
        tier: "vivid",
        kind: read.physics.kind,
        title: read.doc.title ?? null,
        body: read.doc.body,
        // The SAME number the question path reports: base-level activation from
        // `physics/`, not a raw use count. Two paths reporting different
        // quantities under one field name is a measurement bug waiting to be
        // compared across them.
        strength: strength(read.physics, store.livedDay()),
        activation: 1,
      },
    ],
  };
}

/**
 * THE QUESTION PATH. `Recall.build()` does the work; this function re-tiers its
 * verdicts under the deliberate rule and fetches bodies for what it admits.
 *
 * `considered` is `decision.candidates` — every candidate the activation pass
 * scored, not the handful that came back. Together with `storeSize` that is
 * §9.1 G3's whole content: the caller can tell "three matched" from "three were
 * returned" from "three exist".
 */
export function answerQuestion(
  counterpart: Counterpart,
  question: string,
  opts: DeliberateOptions,
): DeliberateResult {
  const store = counterpart.store;
  const built = counterpart.recall.build({
    sessionId: opts.sessionId,
    text: question,
    owner: opts.owner,
    ...(opts.day === undefined ? {} : { day: opts.day }),
  });
  const decision = built.decision;
  const surfaced = new Set(decision.surfaced);
  const footnoted = new Set(decision.footnotes);

  const admitted: { verdict: CandidateVerdict; tier: Tier }[] = [];
  const dim: CandidateVerdict[] = [];
  for (const v of decision.verdicts) {
    if (surfaced.has(v.id)) {
      admitted.push({ verdict: v, tier: "vivid" });
      continue;
    }
    if (footnoted.has(v.id)) {
      admitted.push({ verdict: v, tier: "quiet" });
      continue;
    }
    // Silent for the list (§9.1 G5): confidential material is not mentioned,
    // not counted back to the caller, and not hinted at by a gap in a total.
    if (v.verdict === "confidential-withheld") continue;
    if (HARD_GATES.includes(v.verdict)) continue;
    if (DELIBERATE_TIERS.includes(v.verdict)) dim.push(v);
  }
  dim.sort((a, b) => b.activation - a.activation);
  for (const v of dim.slice(0, DELIBERATE_DIM_CAP)) admitted.push({ verdict: v, tier: "dim" });

  const memories: Recalled[] = [];
  for (const { verdict, tier } of admitted) {
    let doc;
    try {
      doc = store.readProse(verdict.id);
    } catch {
      // A row whose prose has gone is not an answer; it is also not a failure
      // worth throwing at a model that asked a question.
      continue;
    }
    memories.push({
      id: verdict.id,
      tier,
      kind: verdict.kind,
      title: doc.title ?? null,
      body: doc.body,
      strength: verdict.strength,
      activation: verdict.activation,
      ...(tier === "dim" ? { admittedUnder: verdict.verdict } : {}),
    });
  }

  return {
    path: "question",
    reason: memories.length === 0 ? "nothing-came" : "answered",
    memories,
    considered: decision.candidates,
    storeSize: decision.storeSize,
    ambiguous: [],
  };
}

/** The tier a verdict earns, exposed for the audit test's mechanization proof. */
export function tierOf(verdict: Verdict, surfaced: boolean, footnoted: boolean): Tier | null {
  if (surfaced) return "vivid";
  if (footnoted) return "quiet";
  if (verdict === "confidential-withheld") return null;
  if (HARD_GATES.includes(verdict)) return null;
  return DELIBERATE_TIERS.includes(verdict) ? "dim" : null;
}
