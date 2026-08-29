/**
 * The minting seam — SEAMS.md item I (and queued item 8) close here.
 *
 * `remember/` mints PROPOSALS; nothing in it may touch the store. `sleep/`,
 * `schemas/` and `physics/` all read the memory that a proposal becomes. This
 * file is the one place a proposal becomes a memory, so the two rules that
 * belong to that crossing live in exactly one spot:
 *
 *   1. **`updates:` reaches canonical state.** The author's declaration is
 *      resolved upstream (`remember/updates.ts`) and the RESOLVED id — never the
 *      declared string — is written to `doc.meta["updates"]`. `sleep/`'s
 *      `declaredUpdates()` reads that key and `physics.dedupVerdict` checks it
 *      FIRST, before hash and before cosine. Until this seam existed the
 *      guarantee was enforced downstream and starved at the source: scar §2.6's
 *      exact shape (sleep/INTERFACE-GAPS.md §4, recall/INTERFACE-GAPS.md §2).
 *      A declaration that did NOT resolve writes no key at all — "declared
 *      nothing" is the honest reading, and a dangling address must never become
 *      a merge exclusion for a target that does not exist.
 *   2. **The salience floor is clamped here, once.** `physics.clampSalienceAtSeam`
 *      runs at the proposal→memory seam and nowhere else
 *      (remember/INTERFACE-GAPS.md §7: `remember/` deliberately does not call it,
 *      because calling it there would put the clamp in two places). Any lift
 *      emits `salience.lifted` — v1's "remember this" note claimed a floor in its
 *      prompt with no engine backstop, which is the failure encode §5 G6 names.
 *
 *   3. **The freeze seam has a caller** (SEAMS item N). A proposal that resolved
 *      against an existing element is a CLAIM against that element, and every
 *      such claim routes through `self.noteSelfConfirmation` — so a self-claim
 *      repeat arriving from a transcript sweep is counted and not trained, end to
 *      end. Two things are ENGINE-SET here and cannot be claimed by an author or
 *      an interpreter, exactly as the emotion exemption is engine-set in
 *      `bridge.ts`: the CHANNEL (a fallback sweep can never call itself
 *      authorship — that substitution is the whole doctrine) and the fact that
 *      the call happens at all. The claim's DIRECTION is read off the matcher's
 *      own output rather than guessed (see `directionOf` below).
 *
 * What this seam deliberately does NOT do: re-judge the kind (`submitProposal`
 * already defaulted it), re-gate the content (the gate ran before the proposal
 * existed — its output IS `proposal.content`), invent a band, or decide WHICH
 * claim is a repeat of which element — that matcher is `remember/`'s `updates:`
 * resolution, upstream, and this file does not write a second one.
 */
import { TUNABLES as PHYSICS, clampSalienceAtSeam } from "./physics/index.js";
import type { Proposal } from "./remember/index.js";
import type { Store } from "./store/index.js";
import type { Band, Salience } from "./types.js";

/** The canonical prose meta key. One spelling, read by `sleep/dedup.ts`. */
export const UPDATES_META_KEY = "updates";
/** An open loop is an ordinary memory with a flag (`remember/` CONTRACT §4). */
export const UNRESOLVED_META_KEY = "unresolved";

/** Structurally `Self.noteSelfConfirmation` — this file imports no class. */
export interface FreezeSeam {
  noteSelfConfirmation(occasion: {
    elementId: string;
    source: ClaimChannel;
    direction: ClaimDirection;
    day?: number;
  }): { frozen: boolean; reason: string; reinforced: boolean };
}

/** Which path minted this memory. ENGINE-SET; see rule 3 in the header. */
export type ClaimChannel = "authored" | "fallback" | "episode" | "accommodation";
export type ClaimDirection = "confirm" | "soften";

export interface MintOptions {
  /** Telemetry only — ids, counts, flags. Never body text (store §5 G10). */
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
  /** Nothing is born into identity (module-map ruling 2); default `episodic`. */
  band?: Band;
  /** The freeze seam. Absent means no claim is routed — and a claim that is
   *  never routed is never trained either, so absence is the quiet direction. */
  self?: FreezeSeam;
  /**
   * The minting CHANNEL, engine-set. Defaults to `"authored"` because a
   * `Proposal` is by construction an authored deposit (`session-end` or `jot`);
   * the crash-fallback composition passes `"fallback"` explicitly, and no author
   * field can move it.
   */
  channel?: ClaimChannel;
  /** Explicit override. Absent, the direction is read off `updates.method` —
   *  see `directionOf`, which is where the rule and its reasons live. */
  claimDirection?: ClaimDirection;
}

export interface MintResult {
  id: string;
  /** The freeze verdict, when this memory made a claim against an element. */
  claim: { elementId: string; frozen: boolean; reason: string; reinforced: boolean } | null;
  /** The clamped salience actually written to box 2. */
  salience: Salience;
  /** True when the author's claimed floor exceeded the computed value. */
  lifted: boolean;
  /** No schema context existed at encoding — recorded, never defaulted (§2.9). */
  blind: boolean;
  /** The resolved id written to `doc.meta["updates"]`, or null when none was. */
  updates: string | null;
}

/**
 * The claim's direction, from the matcher's own verdict — not a default anybody
 * had to remember, and not a second matcher.
 *
 *   - **`declared`** — the author (or the interpreter) wrote `updates: <id>`:
 *     they ADDRESSED the element in order to revise it. That is a softening, and
 *     softening is never frozen (§14.2 G6 — freezing both directions would make
 *     the identity model unrevisable in both) and never reinforces here: a
 *     refutation must not credit a use to the belief it refutes. That is scar
 *     §2.10's one-way ratchet, and it is the same rule `physics.dedupVerdict`
 *     checks FIRST for the merge case — the two must not disagree.
 *   - **`content` / `content+hint`** — nobody addressed anything; the ENGINE
 *     matched a restatement. Saying the same thing again IS a confirmation, and
 *     it is exactly the doctrine's scenario when it arrives from a transcript
 *     sweep: a model reading its own conduct and agreeing with its own schema.
 */
export function directionOf(method: string | undefined): ClaimDirection {
  return method === "content" || method === "content+hint" ? "confirm" : "soften";
}

export function mintProposal(store: Store, proposal: Proposal, opts: MintOptions = {}): MintResult {
  const channel = opts.channel ?? "authored";
  const dims: Salience = {
    novelty: proposal.salience.novelty ?? null,
    relevance: proposal.salience.relevance ?? 0,
    emotional: proposal.salience.emotional ?? 0,
    predictive: proposal.salience.predictive ?? 0,
  };
  // The authorship doctrine's salience half (owner ruling 2026-08-29): lived
  // testimony commands the full floor; the fallback's retelling author is
  // capped. The ceiling is ENGINE-SET off the channel — like the channel
  // itself, no author field can move it.
  const ceiling = channel === "fallback" ? PHYSICS.SWEEP_CLAIM_CEILING : 1;
  const clamp = clampSalienceAtSeam(dims, proposal.salience.claimed ?? null, ceiling);

  // The RESOLVED id, and only when it resolved (sleep/INTERFACE-GAPS.md §4:
  // "the minting seam persists the RESOLVED id there, and states which it is").
  const resolved = proposal.updates?.resolved ?? null;

  const meta: Record<string, unknown> = {};
  if (resolved !== null) {
    meta[UPDATES_META_KEY] = resolved;
    meta["updatesMethod"] = proposal.updates?.method ?? "declared";
  }
  if (proposal.unresolved) meta[UNRESOLVED_META_KEY] = true;
  if (proposal.aliases.length > 0) meta["aliases"] = [...proposal.aliases];
  if (proposal.feeling !== null) meta["feeling"] = proposal.feeling.feeling;
  // A capped claim's RAW value survives in prose meta: the cap is doctrine,
  // but silently discarding what the author actually said would be its own
  // small destruction — and the re-run's ceiling decision needs the evidence.
  if (clamp.rawClaim !== null) meta["claimedRaw"] = clamp.rawClaim;

  const id = store.put({
    type: "memory",
    kind: proposal.kind,
    body: proposal.content,
    ...(proposal.title === null ? {} : { title: proposal.title }),
    meta,
    band: opts.band ?? "episodic",
    salience: clamp.salience,
    physics: { birthDay: proposal.day, lastUsedDay: proposal.day },
    // Engine-set provenance (F9-light): the channel as recorded fact, and ids
    // only — session, scope, and the proposal id. Never span or body text.
    source: channel,
    origin: { session: proposal.session, scope: proposal.scope, ref: proposal.id },
  });

  if (clamp.event !== null) {
    opts.onEvent?.("salience.lifted", {
      id,
      computed: clamp.event.computed,
      claimed: clamp.event.claimed,
      applied: clamp.event.applied,
      ceiling: clamp.event.ceiling,
      capped: clamp.event.capped,
    });
  }
  // SEAMS item N: a resolved `updates:` IS a claim against an existing element.
  let claim: MintResult["claim"] = null;
  const direction = opts.claimDirection ?? directionOf(proposal.updates?.method);
  if (resolved !== null && opts.self !== undefined) {
    const outcome = opts.self.noteSelfConfirmation({
      elementId: resolved,
      source: channel,
      direction,
      day: proposal.day,
    });
    claim = {
      elementId: resolved,
      frozen: outcome.frozen,
      reason: outcome.reason,
      reinforced: outcome.reinforced,
    };
    opts.onEvent?.("mint.claim", {
      id,
      element: resolved,
      channel,
      direction,
      frozen: outcome.frozen,
      reason: outcome.reason,
      reinforced: outcome.reinforced,
    });
  }

  opts.onEvent?.("mint.proposal", {
    id,
    proposal: proposal.id,
    kind: proposal.kind,
    updates: resolved,
    updatesReason: proposal.updates?.reason ?? "NO_DECLARATION",
    lifted: clamp.lifted,
    blind: clamp.blind,
  });

  return {
    id,
    claim,
    salience: clamp.salience,
    lifted: clamp.lifted,
    blind: clamp.blind,
    updates: resolved,
  };
}
