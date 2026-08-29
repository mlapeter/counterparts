/**
 * The remember→encode bridge — SEAMS.md items 1–3 close here.
 *
 * remember/ owns authorship mechanics and deliberately injects its gate;
 * encode/ owns the battery and deliberately holds no store handle. This file is
 * the one place the two are composed, so the composition rules live in exactly
 * one spot:
 *
 *   1. CHUNK-LEVEL GATED-MEANS-GATED: fallback-sweep chunks route through
 *      `encodeChunk`, whose all-rejected rule already returns zero durable
 *      effects (including prediction checks). The bridge adds no second
 *      implementation — it routes.
 *   2. THE EMOTION EXEMPTION IS ENGINE-SET HERE, from the proposal's source: a
 *      session-end dump or an in-the-moment jot IS the experiencer writing, so
 *      its feelings are self-authored; a fallback sweep's are not. No author
 *      field can claim it (encode validates; remember's drafts can't carry it).
 *   3. Claimed salience, dimensions, and title-as-handle reach the battery, and
 *      a battery refusal is marked `refusedByDesign` so callers can tell a
 *      working gate from a broken one.
 *   4. SEAMS item H: EPISODES route through the same battery. `self/`'s default
 *      episode gate REFUSES everything ("an absent gate is not an open one"), and
 *      `episodeGate()` below is what makes that default unreachable in
 *      production. Episode ingestion was v1's most heavily gated surface — 66% of
 *      all gate fires (scar §2.7) — and a first-person reflection is not exempt
 *      from never durably encoding a credential.
 */
import { computeNovelty, encodeChunk, gateProposal } from "./encode/index.js";
import type {
  ChunkInput,
  ClaimedDimensions,
  EncodeOptions,
  EncodeResult,
  Proposal as EncodeProposal,
} from "./encode/index.js";
import type { GateFn, GateVerdict } from "./remember/index.js";
import type { SweepChunk } from "./remember/index.js";
import type { EpisodeGate } from "./self/index.js";

/**
 * Where the vectors come from — injected, because `encode/` "supplies the inputs
 * and holds no store handle" and this file holds no network client either. The
 * composition root binds all three members; absent, both gates behave exactly as
 * they did before one existed (novelty null, reason `no-chunk-vector`).
 *
 * The split between `vector` and `cached` is not a convenience, it is the shape
 * of the seams: `GateFn` may return a promise and `submitProposal` awaits it, so
 * the authored door can pay for a live embedding; `EpisodeGate` is strictly
 * synchronous, so the episode door may only ask what is already known. A cache
 * miss there is today's behaviour, and it is counted rather than hidden.
 */
export interface VectorSource {
  /** Live: may reach the network. Only called where the caller can await. */
  vector(title: string | null, content: string): Promise<number[] | null>;
  /** Cache-only: never blocks, never opens a socket, null when it does not know. */
  cached(title: string | null, content: string): number[] | null;
  /** E(m) — what this brain already holds near `vec`. Read-only. */
  context(vec: readonly number[]): readonly (readonly number[])[];
  /**
   * Fetch vectors for memories about to be written, in ONE batched call. The
   * sweep's only use: its mints happen in a loop, and a round trip each would be
   * the shape scar E1 warns about paid for one item at a time.
   */
  warm(items: readonly { title: string | null; content: string }[]): Promise<void>;
}

/**
 * Per-proposal gate for the authored paths (session-end dumps and jots).
 *
 * With a `VectorSource` the returned gate is ASYNC (a live embedding is one
 * network call), which `GateFn` permits and `remember/submitProposal` awaits.
 * WITHOUT one it stays synchronous — not for speed, but because a gate that
 * became a promise for every caller would silently break any caller reading
 * `verdict.ok` off the return value.
 */
export function batteryGate(vectors?: VectorSource): GateFn {
  if (vectors === undefined) return (input) => verdictFor(input, computeNovelty(null, []));
  return async (input): Promise<GateVerdict> => {
    const vec = await vectors.vector(input.title, input.content);
    return verdictFor(input, computeNovelty(vec, vec === null ? [] : vectors.context(vec)));
  };
}

/** The battery run itself, novelty already decided. One body, two entrances. */
function verdictFor(
  input: Parameters<GateFn>[0],
  novelty: ReturnType<typeof computeNovelty>,
): GateVerdict {
  const selfAuthored = input.source === "session-end" || input.source === "jot";
  const proposal: EncodeProposal = {
    ref: input.span?.hash ?? "authored",
    content: input.content,
    kind: input.kind,
    aliases: input.aliases,
    feeling:
      input.feeling === null
        ? null
        : {
            // remember says `feeling`, encode says `type` — same field.
            type: input.feeling.feeling,
            quote: input.feeling.quote,
            subject: input.feeling.subject,
          },
    selfAuthoredFeeling: selfAuthored,
    claimedSalience: input.claimed,
  };
  if (input.title !== null) {
    proposal.title = input.title;
    proposal.handles = [input.title];
  }
  const dims = dimensionsFrom(input.salience);
  if (dims !== null) proposal.dimensions = dims;

  // Novelty arrives DECIDED — computed against a real vector when the root wired
  // a source, null-with-reason when it did not (scar §2.9: never a default, in
  // either direction). Nothing here invents one.
  const outcome = gateProposal({
    proposal,
    span: input.span?.text ?? input.content,
    novelty,
  });
  const g = outcome.gated;
  if (g.accepted) {
    return {
      ok: true,
      content: g.content,
      aliases: g.aliases,
      feeling:
        g.feeling === null
          ? null
          : { feeling: g.feeling.type, quote: "", subject: g.feeling.subject },
      // The computed dimension travels to the mint. Without this line the
      // number is measured, spent on the gate decision, and thrown away.
      novelty: novelty.novelty,
    };
  }
  return {
    ok: false,
    gate: g.reason,
    reason: g.blockedBy.join("+"),
    refusedByDesign: true,
  };
}

/** All three author dimensions or nothing — a partial claim is not padded. */
function dimensionsFrom(
  s: Partial<{ relevance: number; emotional: number; predictive: number }>,
): ClaimedDimensions | null {
  if (
    typeof s.relevance === "number" &&
    typeof s.emotional === "number" &&
    typeof s.predictive === "number"
  ) {
    return { relevance: s.relevance, emotional: s.emotional, predictive: s.predictive };
  }
  return null;
}

/**
 * The sweep-chunk composition (SEAMS item 1): parsed fallback proposals for ONE
 * chunk go through `encodeChunk` — never `gateProposal` one at a time — so the
 * chunk-level all-rejected rule holds. Fallback proposals are never
 * self-authored: `selfAuthoredFeeling` is stripped here even if the interpreter
 * hallucinated it (the exemption is engine-set, and this engine says no).
 */
export function gateSweepChunk(
  chunk: SweepChunk,
  proposals: readonly EncodeProposal[],
  day: number,
  extras: Omit<ChunkInput, "chunkRef" | "span" | "proposals" | "day"> = {},
  opts: EncodeOptions = {},
): EncodeResult {
  const stripped = proposals.map((p) => ({ ...p, selfAuthoredFeeling: false }));
  const input: ChunkInput = {
    ...extras,
    chunkRef: `sweep:${chunk.index}`,
    span: chunk.spans.map((s) => s.text).join("\n"),
    proposals: stripped,
    day,
  };
  return encodeChunk(input, opts);
}

/**
 * The episode gate (SEAMS item H). Episodes are self-authored by definition, so
 * the emotion exemption applies exactly as it does to a session-end dump; the
 * handles are the episode's named people and places, and a credential in one
 * refuses the whole ingestion (the ops rule: a credential must never become an
 * entity the store indexes).
 *
 * A body secret is REDACTED, not fatal, and the redacted text comes back on the
 * verdict — the same rule every other ingestion path follows.
 */
export function episodeGate(vectors?: VectorSource): EpisodeGate {
  return (input) => {
    const proposal: EncodeProposal = {
      ref: `episode:${input.sessionId}`,
      content: input.text,
      kind: "self",
      selfAuthoredFeeling: true,
    };
    if (input.handles.length > 0) proposal.handles = [...input.handles];
    // CACHE-ONLY, and that is a structural fact, not a shortcut: `EpisodeGate` is
    // synchronous by type, so this door cannot pay for a live embedding. It gets
    // a vector when one was already fetched for this text and null otherwise —
    // which is what the door had before, now countable (`embed.cache.miss`).
    const vec = vectors?.cached(null, input.text) ?? null;
    const outcome = gateProposal({
      proposal,
      span: input.text,
      novelty: computeNovelty(vec, vec === null ? [] : vectors?.context(vec) ?? []),
    });
    const g = outcome.gated;
    if (g.accepted) return { ok: true, text: g.content };
    return { ok: false, gate: g.reason, reason: g.blockedBy.join("+") };
  };
}
