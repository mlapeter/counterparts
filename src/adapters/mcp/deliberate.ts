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
import { homedir } from "node:os";

import type { Counterpart } from "../../core/counterpart.js";
import { sessionsHere } from "../../core/coverage/index.js";
import { wireChars } from "../../core/fit/index.js";
import { sessionWords } from "../../core/handoff/index.js";
import { LAST_HERE_LIFE_DAYS, chaptersBySession, latestChapter } from "../../core/handoff/last-here.js";
import { strength } from "../../core/physics/index.js";
import { isConfidential, isSelfPage, localKey, readRecencyAsk, standingOf } from "../../core/recall/index.js";
import { localStamp } from "../../core/time.js";
import { UNBOUND_SESSION } from "../../core/types.js";
import type { CandidateVerdict, FeelingWhose, SemanticSource, Verdict } from "../../core/recall/index.js";
import { ownerNames } from "../../core/sleep/index.js";

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
 * a per-kind loud-tier floor, a tier cap, a session-dedup, the rule that a
 * remembered date may make a memory quiet but never loud, or the rule that a
 * store too small for rarity to discriminate may not go loud. Deliberate effort
 * is exactly the license to look under those.
 *
 * The last three are loud-tier BLOCKS: they reach the caller as
 * `loudBlockedBy` on an admitted candidate rather than as a final verdict, so
 * listing them changes no behavior today. They are listed because this is a
 * named table and a named table is total — a loud block that later becomes a
 * final verdict must not be silently dropped by `tierOf`.
 */
export const DELIBERATE_TIERS: readonly Verdict[] = [
  "below-bar",
  "below-strong-floor",
  "capped",
  "dedup-suppressed",
  "cue-only-temporal",
  "cold-start-undiscriminating",
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
/**
 * Characters of body per memory when the caller asked for it BY ID: ONE PART
 * of it (2026-09-28, build B: was 4,000 with no way to read further). A longer
 * body comes in parts — `part: 2`, `3`, … — so a dream's merge, a journal or a
 * multi-chapter episode can be read whole through this door.
 */
export const RECALL_BODY_CHARS = 8_000;
/** Total characters of memory content in one LIST (question) result, across every memory. */
export const RECALL_RESULT_CHARS = 12_000;
/**
 * THE BY-ID RESULT'S ROOM (2026-09-28; review of #278: a 40,000-character
 * content cap came to 72,900 on the wire). Measured on the SERIALISED
 * memories, as they leave — pretty-printed JSON, a non-ASCII character
 * counted as three (`fit/wireChars`: the ceiling is in tokens) — and counted
 * TWICE, because a result carries its payload as text and as
 * `structuredContent` and a host may count both. About 19k tokens, under the
 * ~25k-token ceiling with room for the rest of the result. Ids past it WAIT,
 * named, for the next call.
 */
export const RECALL_ID_RESULT_CHARS = 56_000;
/**
 * How many ids one `ids` call may expand (2026-09-28: was 3). An index — a
 * dream's, a reflection's — offers lines and names this lookup; a batch of
 * them is the lookup's normal shape. Still effort, not enumeration.
 */
export const RECALL_MAX_IDS = 10;

/** One memory as it goes on the wire: an excerpt, plus what was left off. */
export interface BoundedMemory {
  readonly id: string;
  readonly tier: Tier;
  readonly kind: string;
  readonly title: string | null;
  /** A journal entry, not a memory — see `Recalled.journal`. */
  readonly journal: boolean;
  /** The body, cut to the applicable budget. */
  readonly excerpt: string;
  /** The full body's length, so "there is more" is a number, not a guess. */
  readonly bodyChars: number;
  /** True when `excerpt` is shorter than the body. */
  readonly truncated: boolean;
  readonly admittedUnder?: Verdict;
  /** By id: which part of the body this is, and how many parts it has. */
  readonly part?: number;
  readonly parts?: number;
  /** Its standing in a contradiction, or that it was replaced (`recall/standing.ts`). */
  readonly standing?: string;
  /** Where it came from — see `Recalled.from`. */
  readonly from?: string;
  /** Put first by a question about time — see `Recalled.recent`. */
  readonly recent?: boolean;
}

export interface BoundedResult {
  readonly memories: readonly BoundedMemory[];
  /** Any body was cut. */
  readonly truncated: boolean;
  /** Memories dropped whole because the TOTAL budget ran out. Ranked order is
   *  preserved, so what is dropped is always the least activated. */
  readonly droppedForBudget: number;
  readonly chars: number;
  /** By id: the ids the result had no room for, in the order asked — ask again for them. */
  readonly waiting?: readonly string[];
}

/**
 * BY ID, IN PARTS (2026-09-28, build B). Each body is read as parts of
 * `pageChars`; `part` (from 1) picks which part of every body asked for. The
 * parts are exact slices, so they join back into the whole. Ids past the total
 * WAIT — named, in order — rather than being cut or dropped. The first always
 * fits (a part is smaller than the total).
 */
export function boundById(
  memories: readonly Recalled[],
  part: number = 1,
  pageChars: number = RECALL_BODY_CHARS,
  totalChars: number = RECALL_ID_RESULT_CHARS,
): BoundedResult {
  const out: BoundedMemory[] = [];
  const waiting: string[] = [];
  let chars = 0;
  let truncated = false;
  const p = Number.isInteger(part) && part >= 1 ? part : 1;
  let wire = 0;
  for (const m of memories) {
    const parts = Math.max(1, Math.ceil(m.body.length / pageChars));
    const excerpt = p > parts ? "" : m.body.slice((p - 1) * pageChars, p * pageChars);
    const item: BoundedMemory = {
      id: m.id,
      tier: m.tier,
      kind: m.kind,
      title: m.title,
      journal: m.journal,
      excerpt,
      bodyChars: m.body.length,
      truncated: parts > 1,
      part: p,
      parts,
      ...(m.admittedUnder === undefined ? {} : { admittedUnder: m.admittedUnder }),
      ...(m.standing === undefined ? {} : { standing: m.standing }),
      ...(m.from === undefined ? {} : { from: m.from }),
      ...(m.recent === true ? { recent: true } : {}),
    };
    // As it leaves: serialised, weighted, both copies.
    const cost = 2 * wireChars(JSON.stringify(item, null, 2));
    if (waiting.length > 0 || (out.length > 0 && wire + cost > totalChars)) {
      waiting.push(m.id);
      continue;
    }
    if (parts > 1) truncated = true;
    chars += excerpt.length;
    wire += cost;
    out.push(item);
  }
  return { memories: out, truncated, droppedForBudget: 0, chars, ...(waiting.length > 0 ? { waiting } : {}) };
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
      journal: m.journal,
      excerpt,
      bodyChars: m.body.length,
      truncated: excerpt.length < m.body.length,
      ...(m.admittedUnder === undefined ? {} : { admittedUnder: m.admittedUnder }),
      ...(m.standing === undefined ? {} : { standing: m.standing }),
      ...(m.from === undefined ? {} : { from: m.from }),
      ...(m.recent === true ? { recent: true } : {}),
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

/**
 * A journal entry, not a memory — the owner's ruling of 2026-09-04 (§I14).
 *
 * The chapter stays RECALLABLE: a chapter about the lighthouse conversation may
 * rightly come to mind, and filtering it would answer a question worse than
 * labelling it does. What it must never be is mistaken for a memory — it is the
 * first-person ACCOUNT a memory was made from, it sits outside every sleep phase
 * (`sleep/types.ts#isJournal`), and the physics printed beside it is recorded and
 * never acted on. The dashboard has said so on the row since #33; this is the
 * same sentence at the other two doors.
 *
 * The predicate is `ProseDoc.type`, the same field `isJournal` reads off the row,
 * so the label cannot disagree with the rest of the system about what a chapter
 * is. `kind` stays PHYSICS kind: a chapter is usually `kind: "self"`, which is
 * exactly the ambiguity this boolean resolves rather than overwrites.
 */
export const JOURNAL_GLOSS =
  "A row marked journal: true is a chapter — the first-person account a memory was made from, not a memory. It is outside decay, dedup and the prune, and it is not a claim about the world the way a memory is.";

export interface Recalled {
  readonly id: string;
  readonly tier: Tier;
  readonly kind: string;
  readonly title: string | null;
  /** True for an `epi_` chapter (`ProseDoc.type === "episode"`). See `JOURNAL_GLOSS`. */
  readonly journal: boolean;
  /** The body. The quiet tier returns bodies here, not a count (§9.1 G2). */
  readonly body: string;
  readonly strength: number;
  readonly activation: number;
  /** For a dim item: which loud-tier check the ambient path stopped it at. */
  readonly admittedUnder?: Verdict;
  /**
   * Its standing (2026-09-29, `recall/standing.ts`): earlier, corrected by,
   * disagrees with, unsettled — and, asked for by id, replaced by. Read
   * before the body, so an old memory never reads as current.
   */
  readonly standing?: string;
  /**
   * WHERE IT CAME FROM (2026-09-30, the continuity test): the session that
   * wrote it, the directory, and when — `session a1b2c3d4, ~/random, 09-30
   * 17:41`. With several sessions at work at once, a session asking what
   * happened could not tell its own directory's evening from the release work
   * next door. Read off the row (`origin_session`, `origin_scope`,
   * `created_at`); a row from before any of them was recorded says less, and
   * "an earlier session" when it names none. Never backfilled.
   */
  readonly from?: string;
  /** Put FIRST because the question asked about time and this came from this
   *  directory's most recent session (`recall/recency-ask.ts`). */
  readonly recent?: boolean;
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
  /**
   * LIVE ROWS in the store — the denominator an aggregation question needs, and
   * not the same number as the wake preface's "N memories".
   *
   * `store.list({ archived: false })` returns every unarchived row: memories,
   * the schemas (entities, beliefs, and the identity core `install --name`
   * mints), and the journal's episodes. A store a reader made by following the
   * documented path and then wrote two notes into answers `3 live`, not `2` —
   * the third row is the identity core (found 2026-09-04, when a captured
   * example reproduced one higher than the page said).
   *
   * The COUNT is right for what it is; the word was the problem, so every label
   * over this field says "live rows".
   */
  readonly storeSize: number;
  /** Ids a handle matched when the handle was ambiguous. Ids only, no bodies. */
  readonly ambiguous: readonly string[];
  /** The `ids` path only: what happened to each id asked for, in the order
   *  asked. A multi-id lookup is still a DIRECT lookup, so each id's refusal is
   *  stated by name rather than folded into one total (§9.1 G5). */
  readonly perId?: readonly { id: string; reason: DeliberateReason }[];
  /**
   * WHAT KEPT SOMETHING OUT, by verdict, counted (2026-09-20, E2).
   *
   * Every candidate the deeper look considered and did not admit. It is the
   * answer to "nothing came back — was there nothing, or was it all gated",
   * which nothing could answer before: the verdicts lived for the length of one
   * `build()` call and were then discarded.
   *
   * **It does not go on the wire.** §9.1 G5 is unchanged: a list that announces
   * its gaps leaks their existence, and `confidential-withheld` in particular is
   * silent to the caller. This field exists for the DURABLE ROW in the owner's
   * own store, which `server.ts` writes and `recallPayload` does not read.
   */
  readonly blockedBy?: Readonly<Record<string, number>>;
  /**
   * A QUESTION ABOUT TIME (2026-09-30): which session's rows were put first,
   * by its short id, the phrase that asked, and how many rows. Absent when the
   * question did not ask about time or no earlier session here wrote anything.
   */
  readonly recent?: { readonly session: string; readonly cue: string; readonly rows: number };
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
  /**
   * Whose "I" a question about feeling means (2026-09-30, U13): `self` — the
   * default — for the counterpart's own `recall`, `owner` for the console's
   * `ask`, where the owner is the one typing.
   */
  readonly asker?: FeelingWhose;
  /**
   * The directory the asking session is in (2026-09-30). A question about time
   * puts THIS directory's most recent session first; without a scope (the
   * console's `ask`) it is answered as any other question.
   */
  readonly scope?: string;
}

/**
 * ONE EMBEDDING OF A DELIBERATE QUESTION, and every way it can decline, by name
 * — the round trip `DeliberateOptions.vector` expects the caller to have made.
 * Shared by the two callers that ask deliberately: the MCP `recall` tool and
 * the console's `ask` (2026-09-24). Structural on the embedder (`vector()` is
 * all it needs), so this file still imports no other adapter. Never throws.
 */
export async function embedQuestion(
  embedder: { vector(text: string): Promise<number[] | null> } | null,
  question: string,
): Promise<{ vector: number[] | null; semantic: SemanticSource }> {
  if (embedder === null) return { vector: null, semantic: "embedder-off" };
  try {
    const vector = await embedder.vector(question);
    return vector === null || vector.length === 0
      ? { vector: null, semantic: "embed-failed" }
      : { vector, semantic: "in-line" };
  } catch {
    return { vector: null, semantic: "embed-failed" };
  }
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
  // AN OLD ID READS AS ITSELF (2026-09-29, contradictions): a replaced row
  // asked for by its own id is shown — its own words, with `replaced by` —
  // rather than forwarded to its successor's body. `store.resolve` still
  // follows the chain (store §5 G4 / §16 G3; every write resolution relies on
  // it); this is the display path, and only for an id that names a row.
  const own = (() => {
    try {
      return store.row(handle);
    } catch {
      return undefined;
    }
  })();
  if (own !== undefined && own.superseded_by !== null && !(own.body === "" && own.content_hash === "")) {
    matches.push(own.id);
  }
  try {
    if (matches.length === 0) matches.push(store.resolve(handle));
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
  // THE SELF PAGE IS NOT EXPANDED HERE either (2026-09-18). It is excluded from
  // activation, so it never appears in a result to be followed up — and the one
  // way left to reach it was to pass its id, which would credit a use for a row
  // that is delivered whole at every wake. `self_page` is its door, and it has
  // no cap and no tier.
  if (isSelfPage(read.doc)) {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
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
        journal: read.doc.type === "episode",
        body: read.doc.body,
        // The SAME number the question path reports: base-level activation from
        // `physics/`, not a raw use count. Two paths reporting different
        // quantities under one field name is a measurement bug waiting to be
        // compared across them.
        strength: strength(read.physics, store.livedDay()),
        activation: 1,
        ...standingField(store, id, true),
        ...fromField(store, id, opts.sessionId),
      },
    ],
  };
}

/**
 * WHERE A ROW CAME FROM, as one short string (2026-09-30): who wrote it —
 * "this session" for the asker's own, the short id otherwise, "an earlier
 * session" when the row names none, and "a session that hadn't been
 * identified yet" for a note an unbound server wrote (`UNBOUND_SESSION`; never
 * "this session", whoever asks) — the directory with the home directory
 * as `~`, and when, in the store's zone (a chapter: its latest write). Only
 * what the row already knows; nothing is backfilled. A row the nightly run
 * made says so — "a dream launched from session …", "a reflection" — rather
 * than reading as that session's own words (review of #302, MAJOR-1), and one
 * carried over from an older store says that. Never throws.
 */
export function provenanceOf(store: Counterpart["store"], id: string, reader: string | null = null): string | null {
  try {
    const row = store.row(id);
    if (row === undefined) return null;
    let session = row.origin_session;
    if ((session === null || session.length === 0) && row.type === "episode") {
      const meta = JSON.parse(row.meta || "{}") as Record<string, unknown>;
      session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
    }
    const named = session === null || session.length === 0 ? null : sessionWords(session, null, reader);
    const made = nightlyMade(row);
    const who =
      made === "dream"
        ? named === null ? "a dream" : `a dream launched from ${named}`
        : made === "reflection"
          ? "a reflection"
          : row.source === "migrated"
            ? "carried over from an older store"
            : (named ?? "an earlier session");
    const home = homedir();
    const scope = row.origin_scope;
    const where =
      scope === null || scope.length === 0
        ? null
        : home.length > 1 && (scope === home || scope.startsWith(`${home}/`))
          ? `~${scope.slice(home.length)}`
          : scope;
    const at = row.type === "episode" ? (row.updated_at ?? row.created_at) : row.created_at;
    const when = at === null ? (row.learned_on.length > 0 ? row.learned_on : null) : localStamp(at, store.zone());
    return [who, where, when].filter((p): p is string => p !== null && p.length > 0).join(", ");
  } catch {
    return null;
  }
}

/** Was this row made by the nightly run — a dream's, or a reflection's? */
function nightlyMade(row: { source: string | null; origin_ref: string | null }): "dream" | "reflection" | null {
  const ref = row.origin_ref ?? "";
  if (row.source === "dreamed" || ref.startsWith("dream:")) return "dream";
  if (row.source === "reflection" || ref.startsWith("reflection:")) return "reflection";
  return null;
}

function fromField(store: Counterpart["store"], id: string, reader: string): { from?: string } {
  const from = provenanceOf(store, id, reader);
  return from === null ? {} : { from };
}

/** A memory's standing as a result field, or nothing. Never throws. */
function standingField(store: Counterpart["store"], id: string, byId: boolean): { standing?: string } {
  try {
    const s = standingOf(store, id, { byId });
    return s === null ? {} : { standing: s.note };
  } catch {
    return {};
  }
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
 * scored, not the handful that came back. Together with `storeSize` — LIVE ROWS,
 * schemas and journal included — that is §9.1 G3's whole content: the caller can
 * tell "three matched" from "three were returned" from "three exist".
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
    // A DELIBERATE question may be about feeling (U13): the one caller that
    // opens the feeling lane (`recall/feeling-ask.ts`). Never the ambient turn.
    feeling: { asker: opts.asker ?? "self", ownerNames: safeOwnerNames(counterpart) },
  });
  const decision = built.decision;
  const surfaced = new Set(decision.surfaced);
  const footnoted = new Set(decision.footnotes);

  const admitted: { verdict: CandidateVerdict; tier: Tier }[] = [];
  const dim: CandidateVerdict[] = [];
  // The refusal column, for the durable row only — never for the wire.
  const blockedBy: Record<string, number> = {};
  const blocked = (reason: string): void => {
    blockedBy[reason] = (blockedBy[reason] ?? 0) + 1;
  };
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
    if (v.verdict === "confidential-withheld") {
      blocked(v.verdict);
      continue;
    }
    if (HARD_GATES.includes(v.verdict)) {
      blocked(v.verdict);
      continue;
    }
    if (DELIBERATE_TIERS.includes(v.verdict)) dim.push(v);
    // A verdict in neither table reached the caller as nothing and was counted
    // as nothing. `inhibited` is the one that lands here today; naming it beats
    // an unexplained gap between `considered` and what came back.
    else blocked(v.verdict);
  }
  // A QUESTION ABOUT FEELING (2026-09-30, U13), when it is a RANKED one (a
  // real question about feeling, `recall/feeling-ask.ts`): the memories its
  // stamps nominated have their own bound (`FEELING_CANDIDATES_MAX`), so the
  // dim cap is for the rest, and they lead the tier the gate gave them,
  // strongest stamp first — the words, meaning and recency (the rest of
  // activation) only break a tie. The tiers keep their order (review of #293,
  // S3 and R2): vivid; the felt quiet rows, then the other quiet ones; the felt
  // dim rows, then the other dim ones. So a quiet note that merely says "moved"
  // follows the quiet stamped rows, and no answer the words found is put below
  // a row the gate thought less of. Everything a hard
  // gate or confidentiality refused above stays refused. A feeling named about
  // no one ("the happy path") nominates as an ordinary cue and changes nothing
  // here.
  const felt = built.feeling?.ranked === true ? built.feeling.strengths : new Map<string, number>();
  const feltDim = dim.filter((v) => felt.has(v.id));
  const plainDim = dim.filter((v) => !felt.has(v.id));
  plainDim.sort((a, b) => b.activation - a.activation);
  for (const v of feltDim) admitted.push({ verdict: v, tier: "dim" });
  for (const v of plainDim.slice(0, DELIBERATE_DIM_CAP)) admitted.push({ verdict: v, tier: "dim" });
  // The dim tier's own cap is a refusal like any other: these were reachable by
  // effort and the cap is what stopped them.
  for (const v of plainDim.slice(DELIBERATE_DIM_CAP)) blocked(`dim-cap:${v.verdict}`);
  if (felt.size > 0) {
    // Vivid; felt-quiet, quiet; felt-dim, dim (review of #293, R2): a quiet
    // answer the words found is never put below a stamped row the gate left dim.
    const group = (a: { verdict: CandidateVerdict; tier: Tier }): number =>
      a.tier === "vivid" ? 0 : a.tier === "quiet" ? (felt.has(a.verdict.id) ? 1 : 2) : felt.has(a.verdict.id) ? 3 : 4;
    const order = new Map(admitted.map((a, i) => [a.verdict.id, i]));
    admitted.sort((a, b) => {
      const ga = group(a) - group(b);
      if (ga !== 0) return ga;
      const fa = felt.get(a.verdict.id) ?? -1;
      const fb = felt.get(b.verdict.id) ?? -1;
      if (fa !== fb) return fb - fa;
      if (fa >= 0) return b.verdict.activation - a.verdict.activation;
      return (order.get(a.verdict.id) ?? 0) - (order.get(b.verdict.id) ?? 0);
    });
  }

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
      journal: doc.type === "episode",
      body: doc.body,
      strength: verdict.strength,
      activation: verdict.activation,
      ...(tier === "dim" ? { admittedUnder: verdict.verdict } : {}),
      ...standingField(store, verdict.id, false),
      ...fromField(store, verdict.id, opts.sessionId),
    });
  }

  // A QUESTION ABOUT TIME (2026-09-30): the session it means — its chapter,
  // then what it wrote, newest first — leads the answer. Not when the answer
  // is a RANKED question about feeling: that order is the strongest stamp's,
  // and a recency lead on top of it would answer a different question
  // (review of #302, MINOR-3).
  const recent = built.feeling?.ranked === true ? null : recentRows(counterpart, question, opts);
  const answer = recent === null ? memories : leadWith(counterpart, memories, recent, opts);

  return {
    path: "question",
    semantic,
    reason: answer.length === 0 ? "nothing-came" : "answered",
    memories: answer,
    considered: decision.candidates,
    storeSize: decision.storeSize,
    ambiguous: [],
    blockedBy,
    ...(recent === null || !answer.some((m) => m.recent === true)
      ? {}
      : {
          recent: {
            session: recent.sessions.map((s) => s.slice(0, 8)).join(", "),
            cue: recent.cue,
            rows: answer.filter((m) => m.recent === true).length,
          },
        }),
  };
}

/** How many of the recent session's memories a question about time puts
 *  first, after its chapter. Adapter-owned, like `DELIBERATE_DIM_CAP`. */
export const RECENT_MEMORIES_MAX = 8;

/** How many candidate sessions are looked through for one that wrote
 *  something here. */
export const RECENT_SESSIONS_LOOKED = 5;

/** What a question about time puts first: whose rows, the phrase that asked,
 *  the ids in order, and whether to LEAD with them or only promote the ones
 *  the search found too. */
interface RecentRows {
  readonly sessions: readonly string[];
  readonly cue: string;
  readonly ids: readonly string[];
  /** The chapters among `ids`, whose copies leave the rest of the list. */
  readonly chapters: readonly string[];
  readonly lead: boolean;
}

/**
 * THE ROWS A QUESTION ABOUT TIME PUTS FIRST, or null (2026-09-30, the
 * continuity test; review of #302). Only when the question asks about the
 * recent past (`recall/recency-ask.ts`) and names a directory.
 *
 * WHICH SESSION. A question that names a window ("this morning", "yesterday",
 * "16:01–17:48") means the sessions here, not the asker, that were at work in
 * it — none, no lead. Otherwise "the most recent session" is the one the
 * wake's "Last here" line names (`Counterpart#chaptersHereFor`); failing that,
 * the newest session here that has ENDED (a `session-end`, or work that
 * stopped before the asker's began); a live sibling only after those.
 *
 * WHICH ROWS. The session's latest chapter, then up to `RECENT_MEMORIES_MAX`
 * of the memories it wrote, newest first — in THIS directory when the row
 * says where, never the nightly run's dreams or reflections (whose session is
 * the one that launched them), never a chapter's copy (the chapter is shown),
 * never a replaced row, and no confidential row for a session that is not the
 * owner's, silently, as a list withholds. One row that will not read costs
 * that row, not the lane.
 *
 * LEAD OR PROMOTE. A thin question ("what do you remember from our most
 * recent session?") leads with them; one that also asks about something
 * ("what did we decide about the deploy today?") only moves up those the
 * search found as well. Never throws.
 */
function recentRows(counterpart: Counterpart, question: string, opts: DeliberateOptions): RecentRows | null {
  const scope = opts.scope?.trim() ?? "";
  if (scope.length === 0) return null;
  const store = counterpart.store;
  let ask: ReturnType<typeof readRecencyAsk>;
  try {
    ask = readRecencyAsk(question, { now: store.now(), zone: store.zone() });
  } catch {
    return null;
  }
  if (ask === null) return null;
  try {
    const zone = store.zone();
    const all = sessionsHere(counterpart.spans, scope);
    const asker = all.find((s) => s.session === opts.sessionId) ?? null;
    const others = all.filter((s) => s.session !== opts.sessionId);
    let candidates: string[];
    if (ask.window !== null) {
      const w = ask.window;
      candidates = others
        .filter((s) => localKey(s.firstAt, zone) <= w.to && localKey(s.lastAt, zone) >= w.from)
        .map((s) => s.session);
      if (candidates.length === 0) return null;
    } else {
      const named = counterpart.chaptersHereFor(scope, opts.sessionId)[0]?.chapter.session ?? null;
      const ended = others.filter((s) => s.ended || (asker !== null && s.lastAt < asker.firstAt)).map((s) => s.session);
      const live = others.map((s) => s.session);
      candidates = [...new Set([...(named === null ? [] : [named]), ...ended, ...live])];
    }
    const chapters = chaptersBySession(store, { fromDay: Math.max(0, store.livedDay() - LAST_HERE_LIFE_DAYS + 1) });
    const shown = (id: string): boolean => {
      try {
        return opts.owner || !isConfidential(store.read(id).doc);
      } catch {
        return false;
      }
    };
    const norm = (s: string): string => s.trim().replace(/\/+$/, "");
    const sessions: string[] = [];
    const ids: string[] = [];
    const chapterIds: string[] = [];
    let memories = 0;
    // With a window every session in it contributes; without one, the first
    // that wrote anything here is THE session.
    for (const session of candidates.slice(0, RECENT_SESSIONS_LOOKED)) {
      const before = ids.length;
      const chapter = chapters.get(session);
      if (chapter !== undefined && (chapter.scope === null || norm(chapter.scope) === norm(scope)) && shown(chapter.id)) {
        ids.push(chapter.id);
        chapterIds.push(chapter.id);
      }
      const written: { id: string; at: number }[] = [];
      for (const id of store.list({ type: "memory", archived: false, originSession: session })) {
        try {
          const r = store.row(id);
          if (r === undefined || r.superseded_by !== null) continue;
          if (nightlyMade(r) !== null) continue;
          if (r.origin_scope !== null && r.origin_scope.length > 0 && norm(r.origin_scope) !== norm(scope)) continue;
          // A chapter's copy is the chapter (recall §3, U13).
          if (r.source === "episode" && chapter !== undefined && r.origin_ref === chapter.id) continue;
          written.push({ id, at: r.created_at ?? 0 });
        } catch {
          continue;
        }
      }
      written.push(...preBindNotes(store, scope, session, all));
      written.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
      for (const w of written) {
        if (memories >= RECENT_MEMORIES_MAX) break;
        if (!shown(w.id)) continue;
        ids.push(w.id);
        memories += 1;
      }
      if (ids.length > before) sessions.push(session);
      if (ask.window === null && ids.length > 0) break;
    }
    if (ids.length === 0) return null;
    return { sessions, cue: ask.cue, ids, chapters: chapterIds, lead: ask.thin };
  } catch {
    return null;
  }
}

/**
 * A SESSION'S NOTES FROM BEFORE ITS SERVER KNEW IT (the 0.3.10 release check).
 * In Claude Code the memory server learns its session only at the first
 * `chapter` or `session_end`, so a `note` before that is filed under the
 * shared `UNBOUND_SESSION` id, which names no one — and the lead, gathering
 * rows by `origin_session`, missed every one of them. Such a note is counted
 * as `session`'s only when it can be no one else's: it says it was written in
 * THIS directory, it falls inside the stretch `session` was at work here
 * (`coverage#sessionsHere`: its turn-ends and held pieces), and no other
 * session — the asker included — was at work here at that moment. Two
 * sessions side by side in one directory share the stretch, so neither gets
 * the note; it is left to the ranking, as before. Never throws.
 */
function preBindNotes(
  store: Counterpart["store"],
  scope: string,
  session: string,
  here: readonly { session: string; firstAt: number; lastAt: number }[],
): { id: string; at: number }[] {
  const norm = (s: string): string => s.trim().replace(/\/+$/, "");
  const own = here.find((s) => s.session === session);
  if (own === undefined) return [];
  const out: { id: string; at: number }[] = [];
  try {
    for (const id of store.list({ type: "memory", archived: false, originSession: UNBOUND_SESSION })) {
      try {
        const r = store.row(id);
        if (r === undefined || r.superseded_by !== null || nightlyMade(r) !== null) continue;
        if (r.origin_scope === null || r.origin_scope.length === 0 || norm(r.origin_scope) !== norm(scope)) continue;
        const at = r.created_at ?? 0;
        if (at < own.firstAt || at > own.lastAt) continue;
        if (here.some((o) => o.session !== session && at >= o.firstAt && at <= o.lastAt)) continue;
        out.push({ id, at });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * THE ANSWER WITH THE RECENT SESSION'S ROWS FIRST, in their order, each marked
 * `recent`. Leading, a row the search did not reach comes in as `quiet` — put
 * there by the question, not by the gate; a chapter shows its LATEST chapter,
 * not its first (review of #302, MINOR-4). Promoting only, just the rows the
 * search found move up, keeping the tier they earned. Either way the lead
 * chapters' copies leave the rest of the list (MINOR-5), and everything else
 * follows as it was ranked.
 */
function leadWith(counterpart: Counterpart, memories: readonly Recalled[], recent: RecentRows, opts: DeliberateOptions): Recalled[] {
  const store = counterpart.store;
  const found = new Map(memories.map((m) => [m.id, m]));
  const latest = (m: Recalled): Recalled => (m.journal ? { ...m, body: latestChapter(m.body).text.trim() || m.body } : m);
  const lead: Recalled[] = [];
  for (const id of recent.ids) {
    const held = found.get(id);
    if (held !== undefined) {
      lead.push(latest({ ...held, recent: true }));
      continue;
    }
    if (!recent.lead) continue;
    try {
      const read = store.read(id);
      lead.push(
        latest({
          id,
          tier: "quiet",
          kind: read.physics.kind,
          title: read.doc.title ?? null,
          journal: read.doc.type === "episode",
          body: read.doc.body,
          strength: strength(read.physics, store.livedDay()),
          activation: 0,
          ...standingField(store, id, false),
          ...fromField(store, id, opts.sessionId),
          recent: true,
        }),
      );
    } catch {
      continue;
    }
  }
  const led = new Set(lead.map((m) => m.id));
  const shownChapters = new Set(recent.chapters.filter((c) => led.has(c)));
  const copyOfLead = (id: string): boolean => {
    if (shownChapters.size === 0) return false;
    try {
      const r = store.row(id);
      return r !== undefined && r.source === "episode" && r.origin_ref !== null && shownChapters.has(r.origin_ref);
    } catch {
      return false;
    }
  };
  return [...lead, ...memories.filter((m) => !led.has(m.id) && !copyOfLead(m.id))];
}

/** The owner's names, for "whose" in a question about feeling. Never throws. */
function safeOwnerNames(counterpart: Counterpart): string[] {
  try {
    return ownerNames(counterpart.store);
  } catch {
    return [];
  }
}

/** The tier a verdict earns, exposed for the audit test's mechanization proof. */
export function tierOf(verdict: Verdict, surfaced: boolean, footnoted: boolean): Tier | null {
  if (surfaced) return "vivid";
  if (footnoted) return "quiet";
  if (verdict === "confidential-withheld") return null;
  if (HARD_GATES.includes(verdict)) return null;
  return DELIBERATE_TIERS.includes(verdict) ? "dim" : null;
}
