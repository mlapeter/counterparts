/**
 * `Counterpart` — the composition root: one brain over one data dir.
 *
 * Every module below this file is deliberately ignorant of its neighbours, and
 * every seam between them is already closed and proved (`docs/SEAMS.md` items
 * 1–3 and A–N). What was still missing was a place where all of them are
 * assembled ONCE, so an adapter composes a brain instead of re-deriving the
 * wiring — which is how a caller "forgets the map and silently loses the safety
 * half that rides along with it" (recall/INTERFACE-GAPS §2, scar §2.6).
 *
 * **This file is wiring. It states no rule of its own.**
 *
 * That is not a style note, it is a mechanized property: `test/counterpart.test.ts`
 * scans this source with comments and string literals stripped and fails on any
 * numeric literal other than 0 or 1. Every number that governs behaviour —
 * budgets, floors, chunk sizes, candidate limits, retention — arrives as an
 * argument or as an import from the module that owns it. A threshold invented
 * here would be a threshold with no home, no CAL marking and no test
 * (scar §2.8), and a host ceiling invented here would be scar §2.18 exactly.
 *
 * The four things this file DOES decide, all of them structural:
 *
 *   1. **Construction order.** `associate` exists before `schemas`, because
 *      `SchemasOptions.retarget` (SEAMS E) is the callback that keeps a
 *      successor from being born cold.
 *   2. **The gates are always wired.** `bridge.batteryGate()` on the authored
 *      front door, `bridge.episodeGate()` on `self/` (SEAMS H — self's own
 *      default REFUSES, and this is what makes that unreachable in production),
 *      and `bridge.gateSweepChunk()` on the fallback, chunk-level (SEAMS 1).
 *   3. **The channel is engine-set.** `"authored"` for the session-end dump and
 *      the jot; `"fallback"` for anything a transcript sweep produced. No
 *      author field and no interpreter output can move it (SEAMS N).
 *   4. **The host's ceiling travels as an argument.** `wake(budgetBytes)` is
 *      where the host reports it; the same number is what `runCycle` hands the
 *      renderer at the boundary. Absent, the briefing REFUSES to render and says
 *      so — an invented ceiling is the failure scar §2.18 records.
 */
import { randomUUID } from "node:crypto";

import { Associate } from "./associate/index.js";
import type { Credited, FlushReport } from "./associate/index.js";
import { selfRenderer } from "./briefing.js";
import { batteryGate, episodeGate, gateSweepChunk } from "./bridge.js";
import type { VectorSource } from "./bridge.js";
import { mintProposal } from "./mint.js";
import type { MintResult } from "./mint.js";
import { isObserver } from "./observer.js";
import type { Stance } from "./observer.js";
import { Prospective } from "./prospective/index.js";
import { Recall } from "./recall/index.js";
import type { CreditResult, Turn as RecallTurn, RecallResult } from "./recall/index.js";
import { SpanBuffer, TUNABLES as REMEMBER, intake, resolveUpdates, submitProposal, sweep, sweepAll } from "./remember/index.js";
import type {
  BoundaryKind,
  BoundaryRecord,
  CaptureResult,
  Candidate,
  InterpretFn,
  Proposal,
  ProposalSource,
  Span,
  SweepChunk,
  SweepReport,
  Turn as CapturedTurn,
  UpdatesResolution,
} from "./remember/index.js";
import type { EncodeResult, Proposal as EncodeProposal } from "./encode/index.js";
import { recallTurn } from "./retrieval.js";
import { Schemas } from "./schemas/index.js";
import { Self } from "./self/index.js";
import type { ChapterAppend, ChapterAsk, IdentityCoreSpec, IngestResult, WakeResult } from "./self/index.js";
import { runCycle } from "./sleep/index.js";
import type { CycleReport } from "./sleep/index.js";
import { Store, assertSafeDataDir, hashText, indexTextOf } from "./store/index.js";
import type { Embedder, StoreEvent } from "./store/index.js";
import { TUNABLES as PHYSICS } from "./physics/index.js";
import type { UseTier } from "./physics/index.js";
import type { Kind } from "./types.js";

/** The durable per-chunk gate record (dashboard registry imports this literal). */
export const GATE_CHUNK_EVENT = "gate.chunk";

/** Telemetry: ids, counts, bytes, reasons, flags. NEVER body text (store §5 G10). */
export interface CounterpartEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * The LIVE half of an embedder — the half that may reach a network, kept apart
 * from `Embedder` because the store's socket is synchronous and a network call
 * is not. Whoever owns the host owns this, exactly as it owns `InterpretFn`
 * (`remember/INTERFACE-GAPS §3`); `adapters/claude-code/embed-client.ts` is the
 * implementation for this repo's first host, and nothing in `core/` names it.
 *
 * `warm` exists because the fallback sweep mints in batches: one batched call
 * for a chunk's accepted proposals, rather than one round trip each.
 */
export interface LiveVectors {
  vector(text: string): Promise<number[] | null>;
  warm(texts: readonly string[]): Promise<unknown>;
}

export interface CounterpartOptions extends Stance {
  /** Defaults to `dataDir()` — resolved by the store at call time, so tests redirect. */
  dir?: string;
  /**
   * The host's reported injection ceiling, in bytes (scar §2.18). It has NO
   * default anywhere in this package: absent, the briefing phase refuses to
   * render and events `briefing.no-budget`, which is the correct behaviour.
   * `wake()` can report it later, which is the ordinary path — the adapter
   * learns the ceiling from its host's configuration at session start.
   */
  budgetBytes?: number;
  /** Is this the owner's own session? Defaults FALSE in `recall/` (§15 G7). */
  owner?: boolean;
  embed?: Embedder;
  /**
   * The LIVE half of the same embedder: text in, vector out, and it may reach a
   * network. Injected separately from `embed` because the store's socket is
   * synchronous and a network call is not — the adapter that owns the host owns
   * the client, exactly as it owns `InterpretFn` (`remember/INTERFACE-GAPS §3`).
   *
   * Wiring it turns novelty from `no-chunk-vector` into a measurement on the
   * authored door, and — because the text it embeds is shaped the way the store
   * indexes it — the vector one deposit pays for is the vector box 3 stores.
   */
  vectors?: LiveVectors;
  /** Retention window for the bounded logs. `store/` owns the default. */
  retentionDays?: number;
  /** The identity core's name is the OWNER's; there is no default (SEAMS F). */
  identity?: IdentityCoreSpec;
  onEvent?: (e: CounterpartEvent) => void;
  now?: () => number;
}

/** What `wake()` returns: the bundle, plus what the host told us about itself. */
export interface WakeOutcome extends WakeResult {
  /** The ceiling this brain will compose to, or null if none was ever reported. */
  readonly budgetBytes: number | null;
}

export interface DepositContext {
  session: string;
  scope: string;
  /** The span this deposit IS (a jot's own words), withheld from the sweep. */
  ownSpanHash?: string | null;
}

export type DepositReason =
  | "minted"
  | "observer"
  | "malformed"
  | "duplicate-content"
  | "gate-rejected"
  | "gate-failed"
  | "io-failed";

export interface DepositResult {
  readonly deposited: boolean;
  readonly reason: DepositReason;
  readonly memoryId: string | null;
  readonly proposal: Proposal | null;
  readonly mint: MintResult | null;
  /** The battery's own name for its refusal, when the battery refused. */
  readonly gate: string | null;
  /** Span hashes this deposit took off the sweep's input pile. */
  readonly covers: readonly string[];
}

export interface SweepEntry {
  /** The model call. Streaming, headroom and detachment are the adapter's
   *  (`remember/INTERFACE-GAPS` §3, SEAMS queued item 10). */
  interpret: InterpretFn;
  /** One scope, or every scope holding experience (spec §2 G9 — the default). */
  scope?: string;
  chunkBytes?: number;
  minBytes?: number;
  staleClaimMs?: number;
}

export interface SessionEndInput {
  /** The calendar date this cycle belongs to; `sleep/` defaults to today, UTC. */
  date?: string;
  /** The calendar date the horizon lane asks about. Absent ⇒ no horizon lane. */
  at?: string;
  /** When present, the crash fallback runs BEFORE the cycle, so anything it
   *  mints is inside the boundary that decays, consolidates and re-renders. */
  sweep?: SweepEntry;
  /** Override the ceiling reported at wake, for this boundary only. */
  budgetBytes?: number;
}

/** What an appended chapter comes back as, gate verdict included. */
export interface ChapterResult {
  readonly appended: boolean;
  readonly reason: ChapterAppend["reason"] | "gate-refused";
  readonly gate: { gate: string; reason: string } | null;
  readonly episodeId: string | null;
  readonly chapter: number;
  readonly created: boolean;
}

export interface SessionEndReport {
  readonly sweeps: readonly SweepReport[];
  readonly edges: FlushReport;
  readonly cycle: CycleReport;
  readonly budgetBytes: number | null;
}

/**
 * The `kind` a draft that names none becomes. `remember/proposals.ts` spells the
 * same default for the authored door; the fallback door reaches `encode/`
 * through the chunk gate instead, so the default has to be applied here too.
 * SEAMS queued item 9 is exactly this duplication — filed, not hidden.
 */
const DEFAULT_KIND: Kind = "fact";

/**
 * The `ProposalSource` a swept proposal carries. `remember/`'s vocabulary has
 * two members and both mean "the experiencer wrote this"; a sweep is neither,
 * and the field is intake bookkeeping that nothing downstream reads. The
 * authorship record that IS read is `MintOptions.channel`, set to `"fallback"`
 * a few lines below and unclaimable by anything upstream (SEAMS N). Filed in
 * `INTERFACE-GAPS.md` §1.
 */
const SWEPT_SOURCE: ProposalSource = "session-end";

const EVENT_RING = REMEMBER.CONSUMED_LEDGER_MAX;

/**
 * The chunk gate's own record, as it is PERSISTED (store `events`, SEAMS K).
 *
 * `encodeChunk` returns a full `EncodeResult`; before this existed the
 * composition root emitted five counts from it and let the rest go, which made
 * three of the replay harness's baselines structurally not-computable
 * (`gate.refusalMix`, `preselect.meanSchemasShown`, `preselect.channelMix` —
 * `tools/replay/INTERFACE-GAPS.md` §1). A metric that cannot be computed from a
 * replayed store is a metric the parallel run cannot check.
 *
 * CONTENT-BY-REFERENCE, ALL OF IT (store §5 G10): a chunk key, a scope, ids,
 * counts, gate names, closed-vocabulary reasons and states. No span text, no
 * proposal text, no alias, no quote, no secret and no hash of one.
 *
 * This function DERIVES NOTHING. `fires` counts the battery's own per-gate
 * events by name (`gate.<name>` — the battery decides what an acting gate is,
 * and it already writes one event per acting gate); the channel and preselection
 * fields are copied off `Preselection`. A rule about what counts as a fire would
 * be a rule with no home here.
 */
function gateChunkRecord(
  result: EncodeResult,
  ctx: { chunkKey: string; index: number; scope: string; session: string },
): Record<string, unknown> {
  const pre = result.preselection;
  const fires: Record<string, number> = {};
  for (const e of result.events) {
    const parts = e.event.split(".");
    const gate = parts[0] === "gate" ? parts[1] : undefined;
    if (gate === undefined) continue;
    fires[gate] = (fires[gate] ?? 0) + 1;
  }
  const refusalsByReason: Record<string, number> = {};
  for (const r of result.refused) {
    refusalsByReason[r.reason] = (refusalsByReason[r.reason] ?? 0) + 1;
  }
  return {
    chunkKey: ctx.chunkKey,
    index: ctx.index,
    scope: ctx.scope,
    session: ctx.session,
    day: result.day,
    proposals: result.accepted.length + result.refused.length,
    accepted: result.accepted.length,
    refused: result.refused.length,
    fullyGated: result.fullyGated,
    effects: result.effects.length,
    blind: pre.blind,
    // What the author was shown, and through WHICH channel — §8 G4's overlap is
    // reported rather than hidden, so "did the semantic channel add anything?"
    // is a number instead of an argument.
    shown: pre.shown.length,
    shownIds: pre.shown.map((s) => s.id),
    shownLexicalOnly: pre.lexicalIds.filter((id) => !pre.semanticIds.includes(id)).length,
    shownSemanticOnly: pre.semanticOnlyIds.length,
    shownBoth: pre.overlapIds.length,
    candidates: pre.candidates,
    // "off" is silence, "skipped" is a failure, "ran" is a measurement — three
    // records a bare zero cannot tell apart (§5 G8, scar §2.4).
    semanticState: pre.semantic.state,
    semanticReason: pre.semantic.reason,
    channels: result.channels.map((c) => ({
      channel: c.channel,
      state: c.state,
      reason: c.reason,
    })),
    novelty: result.novelty.novelty,
    noveltyReason: result.novelty.reason,
    fires,
    refusalsByReason,
    refusals: result.refused.map((r) => ({
      ref: r.ref,
      kind: r.kind,
      reason: r.reason,
      blockedBy: [...r.blockedBy],
    })),
  };
}

export class Counterpart {
  readonly store: Store;
  readonly spans: SpanBuffer;
  readonly associate: Associate;
  readonly schemas: Schemas;
  readonly self: Self;
  readonly recall: Recall;
  readonly prospective: Prospective;
  /** One predicate, one definition: the store's. Never re-derived here. */
  readonly observer: boolean;

  /** Undefined when no embedder was wired, and under observer. See below. */
  private readonly vectors: VectorSource | undefined;
  private reportedBudget: number | null;
  private readonly onEvent: ((e: CounterpartEvent) => void) | undefined;
  private readonly nowFn: () => number;
  private readonly ring: CounterpartEvent[] = [];

  private constructor(opts: CounterpartOptions) {
    // THE PATH GUARD, BEFORE ANYTHING OPENS (scar §2.13). `dataDir()` asserts
    // this for the environment-resolved path, but an EXPLICIT `dir` reaches
    // `Store.open` unchecked — so a caller who passes one aims straight at v1's
    // live memory with nothing in the way. Found live while writing
    // `test/counterpart.test.ts`, which created a directory under `~/.bansai`
    // before this line existed. Filed in `INTERFACE-GAPS.md` §2: the assertion
    // belongs in `Store.open` too, and this is not a substitute for that.
    if (opts.dir !== undefined) assertSafeDataDir(opts.dir);
    this.observer = isObserver(opts);
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
    this.reportedBudget = opts.budgetBytes ?? null;

    this.store = Store.open({
      observer: this.observer,
      ...(opts.dir === undefined ? {} : { dir: opts.dir }),
      ...(opts.embed === undefined ? {} : { embed: opts.embed }),
      ...(opts.retentionDays === undefined ? {} : { retentionDays: opts.retentionDays }),
      onEvent: (e: StoreEvent) => this.relay("store", e),
    });

    // THE VECTOR SOURCE (bridge `VectorSource`), assembled from the two halves
    // the host injected and the ONE thing only this file holds: the store the
    // context slice is read from. Absent both halves it stays undefined and the
    // gates behave exactly as they did before an embedder existed.
    //
    // NOT UNDER OBSERVER. An instrument opens no sockets: embedding a text is
    // egress, it costs money, and observer mode's rule is that a stood-down
    // instrument leaves the world as it found it (docs/observer-mode.md, scar
    // E7). The stand-down is visible — `novelty.reason` stays `no-chunk-vector`.
    const embed = opts.embed;
    const live = opts.vectors;
    this.vectors =
      this.observer || (embed === undefined && live === undefined)
        ? undefined
        : {
            vector: async (title, content) =>
              live === undefined
                ? embed?.(indexTextOf(title, content)) ?? null
                : live.vector(indexTextOf(title, content)),
            cached: (title, content) => embed?.(indexTextOf(title, content)) ?? null,
            // One batched call for a whole chunk's mints. Without a live half
            // there is nothing to warm — the cache is whatever it already was.
            warm: async (items) => {
              if (live === undefined) return;
              await live.warm(items.map((i) => indexTextOf(i.title, i.content)));
            },
            // E(m): the K nearest memories this brain already holds. K is
            // `physics/`'s CAL number, imported — a size chosen here would be a
            // threshold with no home (the rule at the top of this file).
            context: (vec) => this.store.neighbourVectors(vec, PHYSICS.K_NEAREST),
          };

    // SEAMS E: `schemas/` may not import `associate/`, so the retarget callback
    // is injected — which means the edge graph must exist FIRST. Without this
    // line a revision leaves its successor cold (scar §2.2, live until wired).
    this.associate = new Associate({
      store: this.store,
      onEvent: (e) => this.relay("associate", e),
    });
    this.schemas = Schemas.open({
      store: this.store,
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      onEvent: (e) => this.relay("schemas", { at: e.at, name: e.event, ...(e.ref === undefined ? {} : { ref: e.ref }), ...(e.data === undefined ? {} : { data: e.data }) }),
    });
    // SEAMS H: the REAL battery, so `self/`'s refusing default is unreachable.
    this.self = new Self({
      store: this.store,
      gate: episodeGate(this.vectors),
      onEvent: (e) => this.relay("self", e),
      now: this.nowFn,
    });
    this.recall = new Recall({
      store: this.store,
      owner: opts.owner === true,
      ...(this.reportedBudget === null ? {} : { budgetBytes: this.reportedBudget }),
      onEvent: (e) => this.relay("recall", e),
      now: this.nowFn,
    });
    this.prospective = new Prospective({
      store: this.store,
      onEvent: (e) => this.relay("prospective", e),
      now: this.nowFn,
    });
    this.spans = new SpanBuffer({
      dir: this.store.dir,
      observer: this.observer,
      day: () => this.store.livedDay(),
      now: this.nowFn,
      onEvent: (e) => this.relay("remember", e),
    });

    if (opts.identity !== undefined) this.self.ensureIdentityCore(opts.identity);
  }

  static open(opts: CounterpartOptions = {}): Counterpart {
    return new Counterpart(opts);
  }

  close(): void {
    this.store.close();
  }

  /** The ceiling the host reported, or null. Checkable, never assumed (§2.18). */
  budgetBytes(): number | null {
    return this.reportedBudget;
  }

  events(name?: string): CounterpartEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── wake ───────────────────────────────────────────────────────────────────

  /**
   * Read what the previous boundary published, and record what the host says it
   * can carry. Zero compute, zero model calls, zero network (§1 G1); the
   * bundle's cost was paid by the previous boundary.
   *
   * The ceiling is REPORTED here rather than configured here. A host that
   * reports none gets a tripwire event and a brain that will refuse to render a
   * briefing at the next boundary — loudly, rather than composing to a number
   * nobody chose.
   */
  wake(budgetBytes?: number): WakeOutcome {
    if (budgetBytes === undefined) {
      this.emit("counterpart.budget.unreported", undefined, { had: this.reportedBudget });
    } else {
      this.reportedBudget = budgetBytes;
      this.emit("counterpart.budget.reported", undefined, { budgetBytes });
    }
    const result = this.self.wake();
    this.emit("counterpart.wake", undefined, {
      ok: result.ok,
      reason: result.reason,
      bytes: result.bytes,
      budgetBytes: this.reportedBudget,
    });
    return { ...result, budgetBytes: this.reportedBudget };
  }

  /** The DELIVERY-side record, distinct from the render-side one (scar §2.3). */
  noteWakeDelivered(sentinelSeen: string | null, expected: string | null): boolean {
    return this.self.noteDelivered(sentinelSeen, expected);
  }

  // ── the turn ───────────────────────────────────────────────────────────────

  /**
   * A turn boundary: append what is new, advance the cursor. Microseconds, no
   * model call, and it cannot throw — `SpanBuffer.capture` swallows its own
   * failures and returns a reason (§2 G1/G12).
   */
  captureSpans(input: { session: string; scope: string; turns: readonly CapturedTurn[] }): CaptureResult {
    return this.spans.capture(input);
  }

  /** An in-the-moment jot, riding in the buffer with ordinary spans. */
  captureJot(input: { session: string; scope: string; text: string }): CaptureResult {
    return this.spans.jot(input);
  }

  /**
   * Compose one turn's recall with ALL THREE borrowed channels bound
   * (`src/core/retrieval.ts`, SEAMS C/D/L): the alias map from `schemas/`, the
   * temporal cues from `prospective/`, the hop function from `associate/`. A
   * missing `at` means no temporal channel — a lived day is not a date.
   */
  recallForTurn(turn: RecallTurn, opts: { at?: string } = {}): RecallResult {
    return recallTurn(this.recall, turn, {
      schemas: this.schemas,
      prospective: this.prospective,
      associate: this.associate,
      ...(opts.at === undefined ? {} : { at: opts.at }),
    });
  }

  /** Retrospective reinforcement for ONE memory the reply actually used. */
  resolveUse(sessionId: string, memoryId: string, tier: UseTier): CreditResult {
    return this.recall.resolveUse(sessionId, memoryId, tier);
  }

  /**
   * The same, for the whole set a reply used — and then the Hebbian half: what
   * fired together in one reply is buffered as co-activation, flushed at the
   * boundary. `associate/` refuses a set of fewer than two on its own terms.
   */
  resolveUses(
    sessionId: string,
    uses: readonly { memoryId: string; tier: UseTier }[],
  ): CreditResult[] {
    const results: CreditResult[] = [];
    const credited: Credited[] = [];
    for (const use of uses) {
      const result = this.resolveUse(sessionId, use.memoryId, use.tier);
      results.push(result);
      if (result.credited) credited.push({ id: use.memoryId, tier: use.tier });
    }
    this.associate.coactivate(credited);
    return results;
  }

  // ── the authored front door ────────────────────────────────────────────────

  /** The experiencer's end-of-session dump. Channel: `authored` (SEAMS N). */
  async submitSessionEnd(draft: unknown, ctx: DepositContext): Promise<DepositResult> {
    return this.deposit(draft, "session-end", ctx);
  }

  /** An in-the-moment deliberate deposit. Channel: `authored`. */
  async submitJot(draft: unknown, ctx: DepositContext): Promise<DepositResult> {
    return this.deposit(draft, "jot", ctx);
  }

  // ── episodes ───────────────────────────────────────────────────────────────

  /** ONE ask, and the advance is committed before it blocks (§13 G3–G4). */
  episodeAsk(sessionId: string, substance: { turns: number; bytes: number }, day?: number): ChapterAsk {
    return this.self.openChapter(sessionId, substance, day);
  }

  /**
   * Append a chapter to the day's journal — THROUGH THE BATTERY.
   *
   * FOUND BY THE CALLER-UNIVERSALITY TEST (SEAMS queued item 12, scar §2.7): the
   * episode's own prose is a durable ingestion entrance, and `self/` gates only
   * `ingestEpisode`, not `appendChapter`. So a credential written into a chapter
   * landed in canonical prose and stayed there even though the memory minted
   * from it was redacted — "a gate covers every ingestion path AND every side
   * channel", with the journal as the side channel. The gate is the same one
   * SEAMS H wired; wiring it at this entrance too is composition, not a new
   * rule. Filed in `INTERFACE-GAPS.md` §3: `self/` should take the gate the way
   * `ingestEpisode` does, so this cannot be forgotten by the next caller.
   */
  appendEpisode(
    sessionId: string,
    text: string,
    opts: { day?: number; title?: string; happenedOn?: string } = {},
  ): ChapterResult {
    const verdict = episodeGate(this.vectors)({ text, handles: [], sessionId });
    if (!verdict.ok) {
      this.emit("counterpart.episode.chapter.refused", sessionId, {
        gate: verdict.gate,
        reason: verdict.reason,
      });
      return {
        appended: false,
        reason: "gate-refused",
        gate: { gate: verdict.gate, reason: verdict.reason },
        episodeId: null,
        chapter: 0,
        created: false,
      };
    }
    // The GATE's text, never the draft — the same rule ingestion follows.
    const body = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : text;
    const written = this.self.appendChapter(sessionId, body, opts);
    return {
      appended: written.reason === "appended",
      reason: written.reason,
      gate: null,
      episodeId: written.episodeId,
      chapter: written.chapter,
      created: written.created,
    };
  }

  /** Through the REAL battery: a first-person reflection is not exempt (SEAMS H). */
  ingestEpisode(input: { sessionId: string; day?: number; handles?: readonly string[] }): IngestResult {
    return this.self.ingestEpisode(input);
  }

  /** The unaskable tail — bounded and measured, never pretended away (§2 G12). */
  noteOrphanTail(sessionId: string, substance: { turns: number; bytes: number }, day?: number): void {
    this.self.noteOrphanTail(sessionId, substance, day);
  }

  // ── boundaries ─────────────────────────────────────────────────────────────

  /**
   * Every session-ending path is a boundary (§2 G5, adapter CONTRACT §3): normal
   * stop, session end, and pre-compaction all land here, and all three raise the
   * ask. Compaction destroying the transcript must not destroy the day.
   *
   * An appender, not a thinker: no model call, no cycle, no throw.
   */
  boundary(input: { session: string; scope: string; kind: BoundaryKind }): BoundaryRecord {
    return this.spans.boundary(input);
  }

  /**
   * The heavy half, run detached by whoever owns detachment: sweep, then sleep.
   *
   * Order is behaviour. The crash fallback runs FIRST, so anything it recovers is
   * inside the boundary that decays it, consolidates it and re-renders the
   * briefing around it. Then the Hebbian buffer flushes — the DB-is-a-cache
   * exemption, batched here rather than per turn. Then the cycle, whose LAST
   * content write is `self.boundary()` through `briefing.selfRenderer` (SEAMS G),
   * carrying the ceiling the HOST reported and refusing to invent one.
   */
  async sessionEnd(input: SessionEndInput = {}): Promise<SessionEndReport> {
    const budgetBytes = input.budgetBytes ?? this.reportedBudget;
    if (input.budgetBytes !== undefined) this.reportedBudget = input.budgetBytes;

    const sweeps = input.sweep === undefined ? [] : await this.sweepFallback(input.sweep);
    const edges = this.associate.flush();

    const render = selfRenderer(this.self, {
      prospective: this.prospective,
      ...(input.at === undefined ? {} : { at: input.at }),
      onEvent: (name, data) => this.emit(name, undefined, data),
    });
    const cycle = runCycle({
      store: this.store,
      render,
      ...(input.date === undefined ? {} : { date: input.date }),
      ...(budgetBytes === null ? {} : { budgetBytes }),
      onEvent: (e) => this.relay("sleep", e),
    });

    this.emit("counterpart.sessionEnd", undefined, {
      day: cycle.day,
      sweeps: sweeps.length,
      edges: edges.reason,
      budgetBytes,
      observer: cycle.observer,
    });
    return { sweeps, edges, cycle, budgetBytes };
  }

  /**
   * THE CRASH FALLBACK — the only remaining transcript-reading path, and the one
   * that must not lose the day, since it runs precisely when the experiencer
   * never got the pen. The model call is INJECTED: streaming, token headroom,
   * retries and detachment belong to the adapter that owns the host
   * (`remember/INTERFACE-GAPS` §3).
   *
   * By default every scope holding experience is swept, not only the one whose
   * boundary fired — a project never revisited would otherwise keep captured
   * spans forever (§2 G9).
   */
  async sweepFallback(entry: SweepEntry): Promise<SweepReport[]> {
    const options = {
      interpret: entry.interpret,
      apply: (proposals: readonly unknown[], chunk: SweepChunk) => this.applySweep(proposals, chunk),
      ...(entry.chunkBytes === undefined ? {} : { chunkBytes: entry.chunkBytes }),
      ...(entry.minBytes === undefined ? {} : { minBytes: entry.minBytes }),
      ...(entry.staleClaimMs === undefined ? {} : { staleClaimMs: entry.staleClaimMs }),
    };
    if (entry.scope !== undefined) {
      return [await sweep(this.spans, { ...options, scope: entry.scope })];
    }
    return sweepAll(this.spans, options);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * The authored path, end to end: intake → the encode battery (per proposal,
   * via `bridge.batteryGate()`) → `updates:` resolution against the real store →
   * coverage → mint, with the channel engine-set to `authored`.
   */
  private async deposit(
    draft: unknown,
    source: ProposalSource,
    ctx: DepositContext,
  ): Promise<DepositResult> {
    const none = (reason: DepositReason, gate: string | null = null): DepositResult => ({
      deposited: false,
      reason,
      memoryId: null,
      proposal: null,
      mint: null,
      gate,
      covers: [],
    });

    const result = await submitProposal(this.spans, draft, {
      session: ctx.session,
      scope: ctx.scope,
      source,
      gate: batteryGate(this.vectors),
      ...(ctx.ownSpanHash === undefined ? {} : { ownSpanHash: ctx.ownSpanHash }),
      resolveUpdates: (declared, content) => this.resolveUpdatesFor(ctx.scope, declared, content),
    });

    if (!result.accepted || result.proposal === null) {
      const reason: DepositReason =
        result.reason === "OBSERVER"
          ? "observer"
          : result.reason === "MALFORMED"
            ? "malformed"
            : result.reason === "DUPLICATE_CONTENT"
              ? "duplicate-content"
              : result.reason === "GATE_REJECTED"
                ? "gate-rejected"
                : result.reason === "GATE_FAILED"
                  ? "gate-failed"
                  : "io-failed";
      this.emit("counterpart.deposit.refused", undefined, {
        source,
        reason,
        gate: result.gate,
        malformed: result.malformed,
      });
      return none(reason, result.gate);
    }

    const proposal = result.proposal;
    const mint = mintProposal(this.store, proposal, {
      self: this.self,
      channel: "authored",
      onEvent: (name, data) => this.emit(name, undefined, data),
    });
    this.emit("counterpart.deposit", mint.id, {
      source,
      kind: proposal.kind,
      covers: proposal.covers.length,
      updates: mint.updates,
      lifted: mint.lifted,
      blind: mint.blind,
    });
    this.mentionFromProposal(proposal, `deposit:${mint.id}`);
    return {
      deposited: true,
      reason: "minted",
      memoryId: mint.id,
      proposal,
      mint,
      gate: null,
      covers: proposal.covers,
    };
  }

  /**
   * The fallback path's `apply`. ONE chunk's proposals go through `encodeChunk`
   * together — never `gateProposal` one at a time — so the chunk-level
   * all-rejected rule holds and a fully-gated chunk moves zero durable state,
   * prediction checks included (SEAMS item 1, scar §7b).
   *
   * A throw here is per-chunk failure isolation, not a lost sweep: `remember/`
   * catches it, records `APPLY_FAILED`, and restores that chunk's spans for the
   * next boundary while its siblings stand (scar E1/E6).
   */
  private async applySweep(raw: readonly unknown[], chunk: SweepChunk): Promise<void> {
    const day = this.store.livedDay();
    const drafts: EncodeProposal[] = [];
    const declared = new Map<string, string | null>();

    for (const item of raw) {
      const parsed = intake(item);
      if (!parsed.ok) {
        this.emit("counterpart.sweep.malformed", undefined, {
          chunk: chunk.index,
          reason: parsed.reason,
        });
        continue;
      }
      const d = parsed.draft;
      const ref = `sweep:${chunk.index}:${randomUUID()}`;
      const proposal: EncodeProposal = {
        ref,
        content: d.content,
        kind: d.kind ?? DEFAULT_KIND,
        claimedSalience: d.claimed ?? null,
      };
      if (d.title !== undefined) {
        proposal.title = d.title;
        proposal.handles = [d.title];
      }
      if (d.aliases !== undefined) proposal.aliases = [...d.aliases];
      if (d.feeling !== undefined) {
        proposal.feeling = {
          type: d.feeling.feeling,
          quote: d.feeling.quote,
          subject: d.feeling.subject,
        };
      }
      if (d.salience !== undefined) {
        const s = d.salience;
        if (
          typeof s.relevance === "number" &&
          typeof s.emotional === "number" &&
          typeof s.predictive === "number"
        ) {
          proposal.dimensions = {
            relevance: s.relevance,
            emotional: s.emotional,
            predictive: s.predictive,
          };
        }
      }
      if (d.updates !== undefined) proposal.updates = d.updates;
      if (d.unresolved === true) proposal.unresolved = true;
      drafts.push(proposal);
      declared.set(ref, d.updates ?? null);
    }

    const result = gateSweepChunk(chunk, drafts, day, { observer: this.observer });
    const scope = chunk.spans[0]?.scope ?? "";
    const session = chunk.spans[0]?.session ?? "";
    // THE CORRELATION ID the harness had to guess at (replay INTERFACE-GAPS §1):
    // chunk indices restart at 0 for every scope `sweepAll` visits, so a gate
    // record was matched to a chunk by arrival order. This key is content —
    // the chunk's own span hashes — so the same chunk is the same key on both
    // sides of any join, and it is what the durable record is addressed by.
    const chunkKey = hashText(chunk.spans.map((s: Span) => s.hash).join("\n"));
    this.emit("counterpart.sweep.chunk", chunkKey, {
      chunk: chunk.index,
      chunkKey,
      scope,
      proposals: drafts.length,
      accepted: result.accepted.length,
      refused: result.refused.length,
      fullyGated: result.fullyGated,
      blind: result.preselection.blind,
      shown: result.preselection.shown.length,
      semanticState: result.preselection.semantic.state,
    });
    // THE DURABLE RECORD, and it is written for EVERY chunk that reached the
    // gate — a fully-gated one above all, since those are most of what a refusal
    // distribution is made of. This is telemetry, not a `DurableEffect`: the
    // chunk-level "gated means gated" rule is about strength, uses, revisions,
    // mentions and prediction checks (encode §5 G3), and encode's own
    // `encode.fullyGated` event stands on exactly the same footing.
    //
    // The latch is (chunk content, lived day): a replayed day appends nothing a
    // second time (sleep §5 G3), while spans restored after a failed chunk and
    // re-swept on a LATER day record a second, genuine gate run.
    if (!this.observer) {
      this.store.appendEvent({
        name: GATE_CHUNK_EVENT,
        day,
        ref: chunkKey,
        dedupKey: `gate.chunk:${chunkKey}:${day}`,
        payload: gateChunkRecord(result, { chunkKey, index: chunk.index, scope, session }),
      });
    }
    // A fully-gated chunk moves nothing, and neither does an observer's.
    if (result.fullyGated || result.observer) return;

    // ONE batched embedding call for everything this chunk is about to mint.
    // The store's `Embedder` socket is synchronous and serves a cache, so this
    // is what puts vectors in box 3 on the path that mints most memories — and
    // it is the reason `context()` above has anything to be error against.
    //
    // It does NOT reach `encodeChunk`: passing a chunk vector there would switch
    // on preselection's semantic channel, which is an owner decision that is
    // still open. This warms the store's index; it selects nothing.
    if (this.vectors !== undefined) {
      await this.vectors.warm(
        result.accepted.map((a) => ({ title: a.title ?? null, content: a.content })),
      );
    }

    for (const accepted of result.accepted) {
      const updates = await this.resolveUpdatesFor(
        scope,
        declared.get(accepted.ref) ?? null,
        accepted.content,
      );
      const proposal: Proposal = {
        id: `prp_${randomUUID()}`,
        source: SWEPT_SOURCE,
        session,
        scope,
        content: accepted.content,
        kind: accepted.kind,
        title: accepted.title ?? null,
        salience: { ...accepted.salience, claimed: accepted.salience.claimed ?? null },
        feeling:
          accepted.feeling === null
            ? null
            : { feeling: accepted.feeling.type, quote: "", subject: accepted.feeling.subject },
        aliases: [...accepted.aliases],
        updates,
        unresolved: accepted.unresolved,
        at: this.nowFn(),
        day,
        contentHash: accepted.contentHash,
        covers: chunk.spans.map((s: Span) => s.hash),
        ownSpanHash: null,
      };
      // ENGINE-SET, and the whole doctrine: a sweep can never call itself
      // authorship, so a self-claim repeat arriving from a transcript is
      // counted and NOT trained (SEAMS N).
      const mint = mintProposal(this.store, proposal, {
        self: this.self,
        channel: "fallback",
        onEvent: (name, data) => this.emit(name, undefined, data),
      });
      this.emit("counterpart.sweep.minted", mint.id, {
        chunk: chunk.index,
        kind: proposal.kind,
        updates: mint.updates,
        blind: mint.blind,
      });
      this.mentionFromProposal(proposal, `sweep:${chunk.index}`);
    }
  }

  /**
   * `updates:` resolution with its two injected halves bound to the real store
   * (SEAMS queued item 11): who the candidates are, and whether a declared id
   * resolves. The thresholds stay `remember/`'s — they are CAL numbers with a
   * home, and this file has none.
   */
  private async resolveUpdatesFor(
    scope: string,
    declared: string | null,
    content: string,
  ): Promise<UpdatesResolution> {
    return resolveUpdates(declared, {
      scope,
      content,
      resolveId: (id: string) => {
        try {
          return this.store.resolve(id);
        } catch {
          // An address that does not resolve is not an error: content matching
          // is the fallback, and a refusal costs nothing durable (§5 G10).
          return null;
        }
      },
      candidates: (query): Candidate[] => {
        const out: Candidate[] = [];
        for (const hit of this.store.search(query.content, query.limit)) {
          try {
            const doc = this.store.readProse(hit.id);
            const aliases = doc.meta["aliases"];
            out.push({
              id: hit.id,
              text: doc.body,
              aliases: Array.isArray(aliases)
                ? aliases.filter((a): a is string => typeof a === "string")
                : [],
            });
          } catch {
            // A row whose prose has gone is not a candidate; it is also not an
            // error worth failing a deposit over.
            continue;
          }
        }
        return out;
      },
      onEvent: (name, data) => this.emit(name, undefined, data),
    });
  }

  private relay(module: string, event: { at: number; name: string; ref?: string; data?: Record<string, string | number | boolean | null> }): void {
    const out: CounterpartEvent = { at: event.at, name: event.name };
    if (event.ref !== undefined) out.ref = event.ref;
    out.data = { ...(event.data ?? {}), module };
    this.push(out);
  }


  /**
   * Birth by mention, made AMBIENT (constitution line 8; schemas doctrine):
   * when an authored or swept proposal NAMES an entity-family memory with a
   * title, the mention reaches schemas the moment the memory lands — the writer
   * naming a place is the birth site, and no separate tool or chore exists.
   * schemas.mention() does all the judging (whole-word occurrence, collisions,
   * the birth cap); this is wiring, not rules. Found as gap: `mention()` had
   * ZERO live callers — the doctrine's front door was starved (cli gaps §8).
   */
  private mentionFromProposal(
    proposal: { title?: string | null; kind: Kind; content: string; aliases: readonly string[]; day: number },
    chunkRef: string,
  ): void {
    const title = proposal.title ?? null;
    if (title === null || title.trim().length === 0) return;
    if (proposal.kind !== "entity" && proposal.kind !== "person" && proposal.kind !== "place") return;
    const outcome = this.schemas.mention({
      name: title,
      kind: proposal.kind,
      source: proposal.content,
      chunkRef,
      aliases: proposal.aliases,
      day: proposal.day,
    });
    this.emit("counterpart.mention", outcome.id ?? undefined, {
      reason: outcome.reason,
      kind: proposal.kind,
      day: proposal.day,
    });
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: CounterpartEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.push(event);
  }

  private push(event: CounterpartEvent): void {
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }
}
