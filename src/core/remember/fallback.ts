/**
 * The crash fallback — transcript interpretation, demoted from primary path to the
 * thing that runs only when the experiencer never got the pen (contract §4).
 *
 * It runs for spans that are unclaimed and past a session-ending boundary: a crash,
 * a compaction that ate the session, a host with no end-of-session hook. A fallback
 * that runs after a crash is exactly the path that must not lose the day, so the
 * machinery shrank with its role but did not disappear — chunking with per-chunk
 * failure isolation (E1), a `stop_reason` guard (E2), restore-on-throw (E6), and an
 * observer that sweeps nothing (E7).
 *
 * **There is no SDK and no network here.** Interpretation is an INJECTED async
 * function; streaming, retries, token budgets and detachment belong to whoever
 * injects it (INTERFACE-GAPS.md #3). This module owns the choreography only.
 */
import { markCovered, renderForSweep } from "./proposals.js";
import type { MarkedSpan } from "./proposals.js";
import { errCode } from "./spans.js";
import type { Span, SpanBuffer } from "./spans.js";
import { TUNABLES } from "./tunables.js";

export interface SweepChunk {
  index: number;
  spans: Span[];
  /** Covered spans ride ALONG, marked — the sweep loses permission to write the
   *  same memory twice, not sight of the material (§4.1 G4). */
  marked: MarkedSpan[];
  /** The prompt-side rendering. Marks live here and nowhere else (§5 G7). */
  prompt: string;
  bytes: number;
}

export interface InterpretResult {
  proposals?: readonly unknown[];
  /** A truncated response is a failure, not data (scar E2). Absent means the
   *  injected function does not report one — see NOTES §6. */
  stopReason?: string;
}

export type InterpretFn = (chunk: SweepChunk) => Promise<InterpretResult>;

/** Persist one chunk's harvest. Injected: minting is `encode/`'s and `store/`'s. */
export type ApplyFn = (
  proposals: readonly unknown[],
  chunk: SweepChunk,
) => void | Promise<void>;

export const OK_STOP_REASONS: readonly string[] = [
  "end_turn",
  "stop",
  "stop_sequence",
  "tool_use",
];

export type ChunkReason =
  | "APPLIED"
  | "EMPTY"
  | "TRUNCATED"
  | "MALFORMED_RESULT"
  | "THREW"
  | "APPLY_FAILED";

export interface ChunkOutcome {
  index: number;
  ok: boolean;
  /** "EMPTY" and the failure reasons are DISTINCT records: returned-nothing is not
   *  failed (scar §2.4). */
  reason: ChunkReason;
  spans: number;
  bytes: number;
  proposals: number;
  code: string | null;
}

export type SweepReason =
  | "OBSERVER"
  | "NO_ENDED_SESSION"
  | "NOTHING_TO_SWEEP"
  | "NOTHING_UNCLAIMED"
  | "BELOW_MIN_CLAIM"
  | "IO_FAILED"
  | "SWEPT";

export interface SweepReport {
  scope: string;
  ran: boolean;
  reason: SweepReason;
  claimId: string | null;
  chunks: ChunkOutcome[];
  spansSwept: number;
  spansRestored: number;
  proposals: number;
  /** False when a failed restore forbade consuming the claim (spec §2 G7). */
  consumed: boolean;
}

export interface SweepOptions {
  scope: string;
  interpret: InterpretFn;
  apply?: ApplyFn;
  chunkBytes?: number;
  minBytes?: number;
  staleClaimMs?: number;
  okStopReasons?: readonly string[];
}

export async function sweep(buffer: SpanBuffer, opts: SweepOptions): Promise<SweepReport> {
  const report: SweepReport = {
    scope: opts.scope,
    ran: false,
    reason: "OBSERVER",
    claimId: null,
    chunks: [],
    spansSwept: 0,
    spansRestored: 0,
    proposals: 0,
    consumed: false,
  };

  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "sweep" });
    return report;
  }

  const ended = buffer.endedSessions(opts.scope);
  if (ended.size === 0) {
    // Nobody has finished a session here: the author may still get the pen. This is
    // a different record from "swept and found nothing".
    buffer.emit("remember.sweep.skipped", undefined, { scope: opts.scope, reason: "NO_ENDED_SESSION" });
    return { ...report, reason: "NO_ENDED_SESSION" };
  }

  const claimed = buffer.claim(opts.scope, {
    ...(opts.minBytes !== undefined ? { minBytes: opts.minBytes } : {}),
    ...(opts.staleClaimMs !== undefined ? { staleClaimMs: opts.staleClaimMs } : {}),
  });
  if (!claimed.claimed) {
    const reason: SweepReason =
      claimed.reason === "BELOW_MIN_CLAIM"
        ? "BELOW_MIN_CLAIM"
        : claimed.reason === "EMPTY"
          ? "NOTHING_TO_SWEEP"
          : claimed.reason === "OBSERVER"
            ? "OBSERVER"
            : "IO_FAILED";
    return { ...report, reason };
  }

  const claim = claimed.claim;
  report.claimId = claim.id;
  const withheld = buffer.withheldHashes(opts.scope);
  const covered = buffer.coveredHashes(opts.scope);

  // Three piles. Ineligible spans belong to sessions still running and go straight
  // back; withheld spans are a proposal's own words and are dropped from the sweep
  // outright (re-encoding them is guaranteed duplication).
  const eligible: Span[] = [];
  const ineligible: Span[] = [];
  for (const span of claim.spans) {
    if (withheld.has(span.hash)) continue;
    if (ended.has(span.session)) eligible.push(span);
    else ineligible.push(span);
  }

  const uncovered = eligible.filter((s) => !covered.has(s.hash));
  if (uncovered.length === 0) {
    // Everything eligible was already authored: retire it without a model call.
    const back = buffer.restore(claim, ineligible);
    const consumed = back.restored ? buffer.consume(claim).consumed : false;
    buffer.emit("remember.sweep.skipped", claim.id, {
      scope: opts.scope,
      reason: "NOTHING_UNCLAIMED",
      retired: eligible.length,
    });
    return {
      ...report,
      reason: "NOTHING_UNCLAIMED",
      spansRestored: back.spans,
      consumed,
    };
  }

  const chunks = chunkSpans(eligible, covered, opts.chunkBytes ?? TUNABLES.CHUNK_BYTES);
  const okStop = opts.okStopReasons ?? OK_STOP_REASONS;
  const failed: Span[] = [];

  for (const chunk of chunks) {
    const outcome = await runChunk(buffer, chunk, opts, okStop);
    report.chunks.push(outcome);
    if (outcome.ok) {
      report.spansSwept += chunk.spans.length;
      report.proposals += outcome.proposals;
    } else {
      // Per-chunk failure isolation (scar E1): this chunk's spans go back and are
      // retried at the next boundary; its siblings are unaffected.
      failed.push(...chunk.spans);
    }
  }

  const back = buffer.restore(claim, [...failed, ...ineligible]);
  report.spansRestored = back.spans;
  if (!back.restored) {
    // A failed restore FORBIDS consuming the claim: the spans stay in claim-or-buffer.
    buffer.emit("remember.sweep.restore.failed", claim.id, { spans: failed.length });
    return { ...report, ran: true, reason: "SWEPT", consumed: false };
  }
  report.consumed = buffer.consume(claim).consumed;
  buffer.emit("remember.sweep.done", claim.id, {
    scope: opts.scope,
    chunks: report.chunks.length,
    swept: report.spansSwept,
    restored: report.spansRestored,
    proposals: report.proposals,
  });
  return { ...report, ran: true, reason: "SWEPT" };
}

/** Every scope holding experience gets swept, not only the one whose boundary fired
 *  (spec §2 G9) — a project never revisited would otherwise hold spans forever. */
export async function sweepAll(
  buffer: SpanBuffer,
  opts: Omit<SweepOptions, "scope">,
): Promise<SweepReport[]> {
  const out: SweepReport[] = [];
  for (const scope of buffer.scopes()) {
    out.push(await sweep(buffer, { ...opts, scope }));
  }
  return out;
}

async function runChunk(
  buffer: SpanBuffer,
  chunk: SweepChunk,
  opts: SweepOptions,
  okStop: readonly string[],
): Promise<ChunkOutcome> {
  const base: ChunkOutcome = {
    index: chunk.index,
    ok: false,
    reason: "THREW",
    spans: chunk.spans.length,
    bytes: chunk.bytes,
    proposals: 0,
    code: null,
  };
  let result: InterpretResult;
  try {
    result = await opts.interpret(chunk);
  } catch (err) {
    const code = errCode(err);
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "THREW", code });
    return { ...base, reason: "THREW", code };
  }

  if (result === null || typeof result !== "object") {
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "MALFORMED_RESULT" });
    return { ...base, reason: "MALFORMED_RESULT" };
  }
  if (result.stopReason !== undefined && !okStop.includes(result.stopReason)) {
    // A truncated JSON response is a failure, not data (scar E2).
    buffer.emit("remember.chunk.failed", undefined, {
      index: chunk.index,
      reason: "TRUNCATED",
      stopReason: result.stopReason,
    });
    return { ...base, reason: "TRUNCATED", code: result.stopReason };
  }
  if (result.proposals !== undefined && !Array.isArray(result.proposals)) {
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "MALFORMED_RESULT" });
    return { ...base, reason: "MALFORMED_RESULT" };
  }

  const proposals = result.proposals ?? [];
  if (proposals.length === 0) {
    // Returned nothing is NOT failed. The chunk's spans are consumed: they were
    // read, and the sweep's verdict was "nothing here" (scar §2.4).
    buffer.emit("remember.chunk.empty", undefined, { index: chunk.index, spans: chunk.spans.length });
    return { ...base, ok: true, reason: "EMPTY" };
  }

  if (opts.apply !== undefined) {
    try {
      await opts.apply(proposals, chunk);
    } catch (err) {
      const code = errCode(err);
      buffer.emit("remember.chunk.failed", undefined, {
        index: chunk.index,
        reason: "APPLY_FAILED",
        code,
      });
      return { ...base, reason: "APPLY_FAILED", code, proposals: proposals.length };
    }
  }
  buffer.emit("remember.chunk.applied", undefined, {
    index: chunk.index,
    spans: chunk.spans.length,
    proposals: proposals.length,
  });
  return { ...base, ok: true, reason: "APPLIED", proposals: proposals.length };
}

export function chunkSpans(
  spans: readonly Span[],
  covered: ReadonlySet<string>,
  chunkBytes: number,
): SweepChunk[] {
  const chunks: SweepChunk[] = [];
  let current: Span[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    const marked = markCovered(current, covered);
    chunks.push({
      index: chunks.length,
      spans: current,
      marked,
      prompt: renderForSweep(marked),
      bytes,
    });
    current = [];
    bytes = 0;
  };
  for (const span of spans) {
    if (current.length > 0 && bytes + span.text.length > chunkBytes) flush();
    current.push(span);
    bytes += span.text.length;
  }
  flush();
  return chunks;
}
