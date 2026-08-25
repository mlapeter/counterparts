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
 */
import { computeNovelty, encodeChunk, gateProposal } from "./encode/index.js";
import type {
  ChunkInput,
  ClaimedDimensions,
  EncodeOptions,
  EncodeResult,
  Proposal as EncodeProposal,
} from "./encode/index.js";
import type { GateFn, SweepChunk } from "./remember/index.js";

/** Per-proposal gate for the authored paths (session-end dumps and jots). */
export function batteryGate(): GateFn {
  return (input) => {
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

    // No vectors reach this seam yet: novelty is null-with-reason, never a
    // default (scar §2.9). Wiring vectors here is SEAMS follow-on work.
    const outcome = gateProposal({
      proposal,
      span: input.span?.text ?? input.content,
      novelty: computeNovelty(null, []),
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
      };
    }
    return {
      ok: false,
      gate: g.reason,
      reason: g.blockedBy.join("+"),
      refusedByDesign: true,
    };
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
