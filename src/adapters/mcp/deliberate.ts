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
import type { CandidateVerdict, SemanticSource, Verdict } from "../../core/recall/index.js";

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

// ── the result's size, which is a capability of the HOST, not a preference ──
//
// MEASURED 2026-09-04: three `recall` calls in one session returned 7, 8 and 12
// memories as FULL BODIES — 73,000 to 122,000 characters — and every one of the
// three overflowed the host's tool-result ceiling. An answer the host truncates
// is not a smaller answer, it is no answer, and the model that asked cannot tell
// the difference between "nothing came" and "too much came".
//
// This is scar §2.18's rule (the injection ceiling is a host capability) applied
// to the OTHER direction of the same wire. The ambient path has had a byte
// budget since day one (`BUDGET_BYTES`); the deliberate path had none.
//
// The numbers: a LIST answers "which memories", so 300 characters is enough to
// recognize one and decide whether to ask for it; the id path answers "what did
// it say", so it gets an order of magnitude more each; and the total is bounded
// below the smallest tool-result ceiling this package has met.

/** Characters of body per memory in a LIST answer (the question path). */
export const RECALL_EXCERPT_CHARS = 300;
/** Characters of body per memory when the caller asked for it BY ID. */
export const RECALL_BODY_CHARS = 4000;
/** Total characters of memory content in one result, across every memory. */
export const RECALL_RESULT_CHARS = 12_000;
/** How many ids one `ids` call may expand. Effort, not enumeration. */
export const RECALL_MAX_IDS = 3;

/** One memory as it goes on the wire: an excerpt, plus what was left off. */
export interface BoundedMemory {
  readonly id: string;
  readonly tier: Tier;
  readonly kind: string;
  readonly title: string | null;
  /** The body, cut to the applicable budget. */
  readonly excerpt: string;
  /** The full body's length, so "there is more" is a number, not a guess. */
  readonly bodyChars: number;
  /** True when `excerpt` is shorter than the body. */
  readonly truncated: boolean;
  readonly admittedUnder?: Verdict;
}

export interface BoundedResult {
  readonly memories: readonly BoundedMemory[];
  /** Any body was cut. */
  readonly truncated: boolean;
  /** Memories dropped whole because the TOTAL budget ran out. Ranked order is
   *  preserved, so what is dropped is always the least activated. */
  readonly droppedForBudget: number;
  readonly chars: number;
}

function cut(body: string, limit: number): string {
  if (body.length <= limit) return body;
  // Cut at a word boundary when one is near, so an excerpt ends as text rather
  // than mid-token. The ellipsis is part of the budget, not extra.
  const hard = body.slice(0, Math.max(0, limit - 1));
  const space = hard.lastIndexOf(" ");
  return `${space > limit * 0.6 ? hard.slice(0, space) : hard}…`;
}

/**
 * Bound a ranked list of memories to the wire budget. Ranked order is preserved
 * and truncation is stated: an answer that quietly drops its tail is the same
 * failure as an answer the host truncates, moved one layer inward.
 */
export function boundMemories(
  memories: readonly Recalled[],
  perMemoryChars: number,
  totalChars: number = RECALL_RESULT_CHARS,
): BoundedResult {
  const out: BoundedMemory[] = [];
  let chars = 0;
  let truncated = false;
  let dropped = 0;
  for (const m of memories) {
    const remaining = totalChars - chars;
    if (remaining <= 0) {
      dropped += 1;
      continue;
    }
    const excerpt = cut(m.body, Math.min(perMemoryChars, remaining));
    if (excerpt.length < m.body.length) truncated = true;
    chars += excerpt.length;
    out.push({
      id: m.id,
      tier: m.tier,
      kind: m.kind,
      title: m.title,
      excerpt,
      bodyChars: m.body.length,
      truncated: excerpt.length < m.body.length,
      ...(m.admittedUnder === undefined ? {} : { admittedUnder: m.admittedUnder }),
    });
  }
  return { memories: out, truncated, droppedForBudget: dropped, chars };
}

/**
 * The latency budget for the DEEPER LOOK, in ms — deliberately generous, and
 * deliberately not the ambient one.
 *
 * The ambient 1200 ms is a promise to somebody mid-sentence; this is a question
 * a person typed and is waiting for an answer to. It matters because this is the
 * one path allowed to embed IN LINE (the ruling of 2026-09-04: the hot path may
 * not, the ask may), and the vector scan that follows measured 590-1040 ms on a
 * live-sized index all by itself — under the ambient budget the semantic channel
 * would buy the ask nothing but a `latency-abort`.
 */
export const DELIBERATE_BUDGET_MS = 15_000;

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
  | "both-arguments"
  | "ids-too-many";

export interface DeliberateResult {
  readonly path: "handle" | "question" | "none";
  /** How the semantic channel got its input on THIS ask — `in-line` when the
   *  caller embedded the question, `unavailable` when it could not, `none` on
   *  the handle path, which does no scoring at all. */
  readonly semantic: SemanticSource;
  readonly reason: DeliberateReason;
  readonly memories: readonly Recalled[];
  /** Candidates the deeper look actually considered — NOT the number returned.
   *  §9.1 G3: a top-K tuned for surfacing is the wrong answer to "how many". */
  readonly considered: number;
  /** Live memories in the store. The denominator an aggregation question needs. */
  readonly storeSize: number;
  /** Ids a handle matched when the handle was ambiguous. Ids only, no bodies. */
  readonly ambiguous: readonly string[];
  /** The `ids` path only: what happened to each id asked for, in the order
   *  asked. A multi-id lookup is still a DIRECT lookup, so each id's refusal is
   *  stated by name rather than folded into one total (§9.1 G5). */
  readonly perId?: readonly { id: string; reason: DeliberateReason }[];
}

export interface DeliberateInput {
  readonly handle?: string;
  readonly question?: string;
  /** Full bodies for memories the caller already has the ids of — the follow-up
   *  to a list, and the reason the list can afford to be excerpts. */
  readonly ids?: readonly string[];
}

export interface DeliberateOptions {
  readonly sessionId: string;
  /** The owner's own session? Confidentiality turns on this and nothing else. */
  readonly owner: boolean;
  readonly day?: number;
  /**
   * The question's embedding, computed IN LINE by the caller (`server.ts`).
   * Absent means the semantic channel degrades to lexical-only and the result
   * SAYS so — never a silently narrower answer (contract §5 G1).
   */
  readonly vector?: readonly number[] | null;
  /** Why there is no vector, when there is none — the caller knows and this
   *  file cannot. Defaults to `embedder-off`, the ordinary case. */
  readonly semantic?: SemanticSource;
}

const EMPTY = {
  semantic: "none" as SemanticSource,
  memories: [] as readonly Recalled[],
  considered: 0,
  storeSize: 0,
  ambiguous: [] as readonly string[],
};

/** Live memories, the same count every answering path reports. Never throws:
 *  a refusal must not become a crash because the census failed. */
function liveCount(counterpart: Counterpart): number {
  try {
    return counterpart.store.list({ archived: false }).length;
  } catch {
    return 0;
  }
}

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
  const askedIds = (input.ids ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  const hasIds = askedIds.length > 0;
  // THREE paths now, still exactly one per call. `ids` is the follow-up to a
  // list — "give me those in full" — and mixing it with a question is the same
  // caller confusion `both-arguments` already refuses.
  if ([hasHandle, hasQuestion, hasIds].filter(Boolean).length > 1) {
    return { path: "none", reason: "both-arguments", ...EMPTY, storeSize: liveCount(counterpart) };
  }
  if (hasHandle) return expandHandle(counterpart, (input.handle as string).trim(), opts);
  if (hasIds) return expandIds(counterpart, askedIds, opts);
  if (hasQuestion) return answerQuestion(counterpart, (input.question as string).trim(), opts);
  // The REAL store size, even on a refusal. A caller who misspelled the argument
  // name got `storeSize: 0` here until 2026-09-04, which reads as "your store is
  // empty" — the wrong problem, stated confidently, at exactly the moment the
  // caller is already unsure what they did wrong (cold-stranger review, §6.9).
  return { path: "none", reason: "no-argument", ...EMPTY, storeSize: liveCount(counterpart) };
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
  // The expansion path scores nothing, so no channel is consulted and none is
  // reported dark: `none` here means "not asked", not "asked and empty".
  const base = {
    path: "handle" as const,
    semantic: "none" as SemanticSource,
    storeSize,
    ambiguous: [] as readonly string[],
  };

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
 * THE ID PATH — "those three, in full", after a list.
 *
 * It is `expandHandle` in a loop and deliberately nothing more: each id crosses
 * the same exact-address resolution and the same confidentiality boundary, so
 * withholding is still STATED per id (§9.1 G5) and no id fuzzes into a search.
 * Writing a second resolver here to save a loop is how the expansion path
 * quietly becomes the search path.
 *
 * The count is capped because effort is not enumeration: a caller who wants
 * twenty bodies is asking for the store, and `status` is the tool for that.
 */
export function expandIds(
  counterpart: Counterpart,
  ids: readonly string[],
  opts: DeliberateOptions,
): DeliberateResult {
  const unique = [...new Set(ids)];
  const storeSize = counterpart.store.list({ archived: false }).length;
  // Same as `expandHandle`: an exact address consults no channel, so `none`
  // here means "not asked", never "asked and empty".
  const base = { path: "handle" as const, semantic: "none" as SemanticSource, storeSize };
  if (unique.length > RECALL_MAX_IDS) {
    return {
      ...base,
      reason: "ids-too-many",
      memories: [],
      considered: unique.length,
      ambiguous: [],
      perId: unique.map((id) => ({ id, reason: "ids-too-many" as const })),
    };
  }
  const memories: Recalled[] = [];
  const ambiguous: string[] = [];
  const perId: { id: string; reason: DeliberateReason }[] = [];
  for (const id of unique) {
    const one = expandHandle(counterpart, id, opts);
    perId.push({ id, reason: one.reason });
    memories.push(...one.memories);
    ambiguous.push(...one.ambiguous);
  }
  return {
    ...base,
    reason: memories.length > 0 ? "expanded" : (perId[0]?.reason ?? "handle-unknown"),
    memories,
    considered: unique.length,
    ambiguous,
    perId,
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
  // THE ONE PATH ALLOWED TO EMBED IN LINE. The caller did the round trip; this
  // pass does the ranking, under a budget that can afford it.
  const vector = opts.vector ?? null;
  const semantic: SemanticSource =
    vector !== null && vector.length > 0 ? "in-line" : opts.semantic ?? "embedder-off";
  const built = counterpart.recall.build({
    sessionId: opts.sessionId,
    text: question,
    owner: opts.owner,
    budgetMs: DELIBERATE_BUDGET_MS,
    ...(vector === null || vector.length === 0 ? {} : { vector }),
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
    semantic,
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
