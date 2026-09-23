/**
 * The embeddings call — the SECOND place in this package that reaches a model
 * API, and the only other network code that exists.
 *
 * `store/` has held the socket for an `Embedder` since it was written, and
 * nothing ever constructed one: every memory this brain has minted so far
 * recorded `novelty: null` with reason `no-chunk-vector`, and the replay review
 * (2026-08-26, F4/F5) is the bill for that — self-assigned salience with no
 * independent check, and a run whose report claimed pinned vectors over a
 * `cache.embeddings` table holding zero rows. This file is the missing half.
 *
 * `interpret-client.ts` is the template, deliberately: same refusal shape, same
 * telemetry discipline, same division of labour. The scars it points at point
 * here too, with one addition of this file's own.
 *
 *   **E1 — CHUNKED, WITH PER-CHUNK FAILURE ISOLATION.** This is the scar that
 *   shapes the whole file. Embeddings arrive in batches, and v1's lesson is that
 *   ONE bad item must not fail the run: a chunk that fails leaves its own slots
 *   `null` and NAMES itself in `failures`, while every sibling chunk's vectors
 *   stand. The unit of isolation is `TUNABLES.EMBED_BATCH_SIZE`, and it is the
 *   same unit as the provider's batch ceiling on purpose — one boundary, not two.
 *
 *   **§2.18** — the credential comes from ONE environment variable this package
 *   names (`EMBED_KEY_ENV`), filled either by the environment or, where the host
 *   hands a process none, by the file the package's own config NAMES
 *   (`credentialsFile`, loaded at the entry point). v1's client accepted a
 *   `.env` found by CONVENTION; that half stays dropped (see `config.ts`).
 *   Missing means a NAMED refusal BEFORE any socket is opened.
 *
 *   **§2.15** — the model id comes from this adapter's own `embed` seat, pinned,
 *   with its own knob; an expired placeholder refuses the call. A vector's
 *   generation is part of its identity — vectors from two models are not
 *   comparable — so a silently-swapped id would silently corrupt every cosine in
 *   the store.
 *
 *   **§2.4** — "off", "refused" and "returned nothing" are three records, never
 *   one zero. `EmbedBatch` carries `requested`, `returned` and `failures`, so a
 *   caller can tell a switched-off embedder from a failing one.
 *
 * **Retries and timeouts are the INJECTOR's**, exactly as `interpret-client.ts`
 * states for the interpreter: this file takes an `AbortSignal` and opens exactly
 * one request per chunk. v1's client retried a 429 once, internally; that is not
 * ported, because a retry policy hidden inside a client is a policy the caller
 * cannot see, cannot count, and cannot turn off (a deliberate deviation from the
 * donor, recorded here rather than silently).
 *
 * **The levers that replace it**, named so "the injector owns it" is a design
 * and not a shrug — a caller implementing 429 backoff has, without editing this
 * file:
 *
 *   - `EmbedBatch.failures[]`, each carrying `code: "HTTP_ERROR"` and the
 *     `status` — so 429 is distinguishable from 500 and from a bad request, and
 *     `from`/`count` say exactly which inputs to re-ask for. Retrying is
 *     re-calling with that slice; nothing here is stateful.
 *   - the `embed.chunk.failed` event, same fields, for a caller that watches
 *     rates rather than return values.
 *   - `signal`, which stops the run at the next chunk boundary and reports
 *     `ABORTED` rather than pretending the remaining inputs were empty — a
 *     timeout is therefore the injector's `AbortSignal.timeout(ms)`, and a
 *     backoff sleep is the injector's, between calls.
 *
 * What this file will NOT do is sleep. A client that sleeps inside a batch holds
 * a detached worker's watchdog budget hostage to a header the far end chose.
 *
 * There is no SDK and no dependency: `fetch` is the runtime's.
 */
import { StaticEmbedderError, loadStaticModel, resolveStaticWeights } from "../../core/embed/static.js";
import type { StaticModel } from "../../core/embed/static.js";
import type { Embedder, EmbedderIdentity } from "../../core/store/index.js";
import { hashText } from "../../core/store/index.js";

import { EMBED_KEY_ENV, EMBED_MODEL_DIMS, TUNABLES, VOYAGE_ENDPOINT, embedSeat, embedderKind } from "./config.js";
import type { AdapterConfig, EmbedderKind } from "./config.js";
import type { FetchLike } from "./interpret-client.js";

/** Every way this client refuses, by name. A refusal is never a silent empty. */
export type EmbedRefusal =
  | "NO_API_KEY"
  | "SEAT_UNUSABLE"
  | "NO_FETCH"
  | "HTTP_ERROR"
  | "NO_BODY"
  | "BAD_RESPONSE"
  | "WRONG_VECTOR_COUNT"
  | "ABORTED";

export class EmbedError extends Error {
  readonly code: EmbedRefusal;
  readonly detail: Record<string, string | number>;

  constructor(code: EmbedRefusal, detail: Record<string, string | number> = {}) {
    super(`${code}${Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ""}`);
    this.name = "EmbedError";
    this.code = code;
    this.detail = detail;
  }
}

/** One chunk that failed, named — the countable half of E1. */
export interface ChunkFailure {
  /** Index of the chunk within this call, not within the store. */
  readonly chunk: number;
  /** Where this chunk started in the caller's `texts` array. */
  readonly from: number;
  readonly count: number;
  readonly code: EmbedRefusal;
  readonly status?: number;
  /**
   * True when the bisector narrowed a 400 down to THIS ONE INPUT: the item is
   * the poison, not the batch. `count` is 1 on every such failure, and the
   * caller can act on it — retire the id, repair the text — instead of retrying
   * a whole chunk that will fail the same way forever (I33).
   */
  readonly item?: boolean;
}

export interface EmbedBatch {
  /** The seat's pinned id — the generation these vectors belong to. */
  readonly model: string;
  /** One slot per input, in input order. NULL where the chunk failed. */
  readonly vectors: readonly (number[] | null)[];
  readonly requested: number;
  readonly returned: number;
  readonly chunks: number;
  readonly failures: readonly ChunkFailure[];
}

/** Telemetry: ids, counts, hashes, codes. Never the text being embedded. */
export type EmitFn = (name: string, data: Record<string, string | number | boolean | null>) => void;

export interface EmbedClientOptions {
  config?: AdapterConfig;
  /** Defaults to `globalThis.fetch`. A test supplies its own; nothing else does. */
  fetch?: FetchLike;
  /** Today, ISO — the date a placeholder seat's expiry is judged against. */
  today?: string;
  /** Texts per request. Defaults to the provider's ceiling; also the isolation unit. */
  batchSize?: number;
  onEvent?: EmitFn;
  /** Aborts the request. The watchdog's hand on the socket; retries are its too. */
  signal?: AbortSignal;
}

export type EmbedFn = (texts: readonly string[]) => Promise<EmbedBatch>;

/**
 * Build the batched embeddings call.
 *
 * The two PRE-FLIGHT refusals — no credential, unusable seat — throw before any
 * socket is opened, because neither is a per-chunk condition: no chunk of this
 * call could have succeeded. Everything after that point is per-chunk, and a
 * failure there is isolated rather than thrown (E1).
 */
export function embedClient(opts: EmbedClientOptions = {}): EmbedFn {
  const config = opts.config ?? {};
  const doFetch = opts.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike | undefined);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const emit = opts.onEvent ?? ((): void => {});
  const batchSize = opts.batchSize ?? TUNABLES.EMBED_BATCH_SIZE;
  /** Read through a call, never a narrowed local: the flag flips under us. */
  const aborted = (): boolean => opts.signal?.aborted === true;

  return async (texts: readonly string[]): Promise<EmbedBatch> => {
    // ── the credential, from ONE source, checked BEFORE any socket ──────────
    const key = process.env[EMBED_KEY_ENV];
    if (key === undefined || key.trim().length === 0) {
      emit("embed.refused", { code: "NO_API_KEY", env: EMBED_KEY_ENV, texts: texts.length });
      throw new EmbedError("NO_API_KEY", { env: EMBED_KEY_ENV });
    }
    // ── the seat, whose placeholder expires (scar §2.15) ────────────────────
    const seat = embedSeat(config, today);
    if (!seat.usable) {
      emit("embed.refused", { code: "SEAT_UNUSABLE", seat: seat.seat, status: seat.status });
      throw new EmbedError("SEAT_UNUSABLE", { seat: seat.seat, status: seat.status });
    }
    if (doFetch === undefined) {
      emit("embed.refused", { code: "NO_FETCH" });
      throw new EmbedError("NO_FETCH", {});
    }

    const vectors: (number[] | null)[] = new Array<number[] | null>(texts.length).fill(null);
    const failures: ChunkFailure[] = [];
    let returned = 0;
    let chunk = 0;

    for (let from = 0; from < texts.length; from += batchSize) {
      const slice = texts.slice(from, from + batchSize);
      const index = chunk;
      chunk += 1;
      // The watchdog's hand landed. Stop opening sockets, say so by name, and
      // leave the rest null — an abort is a REASON, not a batch of bad data.
      if (aborted()) {
        const rest = texts.length - from;
        failures.push({ chunk: index, from, count: rest, code: "ABORTED" });
        emit("embed.chunk.failed", { chunk: index, from, count: rest, code: "ABORTED", status: null });
        break;
      }
      emit("embed.call", { chunk: index, from, count: slice.length, model: seat.id, seat: seat.status });
      // THE BISECTING ATTEMPT (I33). One call for a healthy chunk; on a 400 —
      // and only a 400 — it halves down to the offending item. Everything it
      // records goes through the two collectors below, so the isolation unit
      // changed without the caller's reading of `failures` changing.
      const budget = { calls: callBudget(slice.length) };
      await attempt(
        {
          doFetch,
          key,
          model: seat.id,
          emit,
          chunk: index,
          budget,
          ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        },
        slice,
        from,
        (at, vec) => {
          vectors[at] = vec;
          returned += 1;
        },
        (failure) => {
          failures.push(failure);
          emit("embed.chunk.failed", {
            chunk: failure.chunk,
            from: failure.from,
            count: failure.count,
            code: failure.code,
            status: failure.status ?? null,
            item: failure.item === true,
          });
        },
        aborted,
      );
    }

    return { model: seat.id, vectors, requested: texts.length, returned, chunks: chunk, failures };
  };
}

/**
 * Make every input WELL-FORMED, for the request body and for nothing else.
 *
 * THE SURROGATE SCAR (I33). Two migrated memories carried a lone UTF-16
 * surrogate in their title; `JSON.stringify` happily emits the escape, the
 * provider answers `400 input is not valid UTF-8` for the WHOLE 64-text chunk,
 * and because `missingVectors` returns a stable order the same head-64 was
 * retried at every boundary for a week while 165 blind memories queued behind
 * it.
 *
 * `toWellFormed()` is the runtime's own repair (bun has it; the regex is the
 * fallback for a runtime that does not). A lone surrogate becomes U+FFFD — the
 * same character the prose file's frontmatter already shows, so what gets
 * embedded is what a reader sees.
 *
 * **THE BODY ONLY.** Nothing upstream is sanitized: the cache key
 * (`createEmbedder`'s `keyOf`), `indexTextOf`, and `store.embedOne`'s lookup all
 * stay on the ORIGINAL string. Sanitizing before the cache write would file the
 * vector under a key the store never asks for, and the backfill would become a
 * paid-for no-op that reports success — which is precisely the failure
 * `vectors.ts` warns about two levels up.
 */
export function wellFormed(input: readonly string[]): { input: string[]; changed: number } {
  let changed = 0;
  const out = input.map((text) => {
    const native = (text as unknown as { toWellFormed?: () => string }).toWellFormed;
    const fixed =
      typeof native === "function"
        ? native.call(text)
        : // Lone surrogates only: a high not followed by a low, or a low not
          // preceded by a high. A well-formed pair is left exactly as it is.
          text.replace(LONE_SURROGATE, "\uFFFD");
    if (fixed !== text) changed += 1;
    return fixed;
  });
  return { input: out, changed };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * The call budget one chunk's bisection may spend: `2·log2(n) + n`.
 *
 * A full binary split of n items costs at most 2n−1 calls, which for a 64-text
 * chunk of entirely-poison inputs would be 127 round trips inside one detached
 * worker's watchdog. This bound is generous for the real case (a handful of bad
 * items) and hard for the pathological one; past it the remaining slice is
 * recorded whole, exactly as a 500 would be.
 */
export function callBudget(n: number): number {
  return Math.ceil(2 * Math.log2(Math.max(n, 2))) + n;
}

interface AttemptContext {
  doFetch: FetchLike;
  key: string;
  model: string;
  emit: EmitFn;
  /** The ORIGINAL chunk index; a bisected half is still that chunk's failure. */
  chunk: number;
  budget: { calls: number };
  signal?: AbortSignal;
}

/**
 * One slice, and — on an HTTP 400 — its halves, recursively, down to one item.
 *
 * 400 ONLY. A 429, a 5xx, an abort or a malformed body says nothing about WHICH
 * input is bad: the whole slice failed for a reason the slice does not own, and
 * splitting it would just multiply the same failure (and, for a 429, the rate
 * that caused it). A 400 is the opposite — the provider read the body and
 * refused it — so the poison is in there, and halving finds it in log2(n) steps.
 */
async function attempt(
  ctx: AttemptContext,
  slice: readonly string[],
  from: number,
  land: (at: number, vec: number[]) => void,
  fail: (failure: ChunkFailure) => void,
  aborted: () => boolean,
): Promise<void> {
  if (slice.length === 0) return;
  const whole = (code: EmbedRefusal, status?: number, item?: boolean): void => {
    fail({
      chunk: ctx.chunk,
      from,
      count: slice.length,
      code,
      ...(status === undefined ? {} : { status }),
      ...(item === true ? { item: true } : {}),
    });
  };
  if (ctx.budget.calls <= 0) {
    // The bound, spent. Whatever is left is recorded the way a whole-chunk
    // failure always was — never silently dropped.
    //
    // A remainder of ONE is still an item failure, and says so. Everything above
    // this line got here because a 400 named its slice, so a single survivor of
    // that descent is the poison whether or not the budget lasted long enough to
    // ask one more time — and `vectors.ts` gates its give-up counter on exactly
    // this flag, so leaving it off here would make the counter depend on how
    // many calls the bisector happened to have left.
    whole("HTTP_ERROR", 400, slice.length === 1);
    return;
  }
  ctx.budget.calls -= 1;
  let err: unknown;
  try {
    const got = await callOnce(ctx, slice);
    for (let i = 0; i < got.length; i += 1) {
      const vec = got[i];
      if (vec !== undefined) land(from + i, vec);
    }
    ctx.emit("embed.done", { chunk: ctx.chunk, count: got.length, dim: got[0]?.length ?? 0 });
    return;
  } catch (caught) {
    err = caught;
  }
  // E1: THIS slice fails. Its siblings do not, and the caller is told which one
  // and why — a null vector with no reason is the shape v1's "one bad item
  // failed the whole run" incident was made of.
  const code: EmbedRefusal = aborted()
    ? "ABORTED"
    : err instanceof EmbedError
      ? err.code
      : "BAD_RESPONSE";
  const rawStatus = err instanceof EmbedError ? err.detail["status"] : undefined;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;
  if (code !== "HTTP_ERROR" || status !== 400 || aborted()) {
    whole(code, status);
    return;
  }
  if (slice.length === 1) {
    // THE POISON, alone and named. `item: true` is what lets the backfill count
    // this id out instead of re-asking for it forever (I33).
    whole(code, status, true);
    return;
  }
  const mid = Math.ceil(slice.length / 2);
  ctx.emit("embed.bisect", { chunk: ctx.chunk, from, count: slice.length, status: 400 });
  await attempt(ctx, slice.slice(0, mid), from, land, fail, aborted);
  await attempt(ctx, slice.slice(mid), from + mid, land, fail, aborted);
}

/** ONE request. Every failure here is an `EmbedError` so the caller can name it. */
async function callOnce(ctx: AttemptContext, input: readonly string[]): Promise<number[][]> {
  const { doFetch, key, model } = ctx;
  // THE BODY, AND ONLY THE BODY (I33 — see `wellFormed`).
  const sanitized = wellFormed(input);
  if (sanitized.changed > 0) {
    ctx.emit("embed.sanitized", { chunk: ctx.chunk, count: sanitized.changed });
  }
  const response = await doFetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The credential is a HEADER. Never a query parameter: a URL is logged by
      // every proxy between here and there.
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, input: sanitized.input }),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  });

  if (!response.ok) throw new EmbedError("HTTP_ERROR", { status: response.status });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new EmbedError("NO_BODY", {});
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new EmbedError("BAD_RESPONSE", { reason: "no-data-array" });

  const out: number[][] = [];
  for (const row of data) {
    const vec = (row as { embedding?: unknown } | null)?.embedding;
    if (!Array.isArray(vec) || vec.length === 0 || !vec.every((n) => typeof n === "number")) {
      throw new EmbedError("BAD_RESPONSE", { reason: "no-embedding" });
    }
    out.push(vec as number[]);
  }
  // A short answer is a FAILURE, not data — the embeddings analogue of E2. Slot
  // n of the response is the vector for input n; a response that dropped one
  // would silently attach every later vector to the wrong text.
  if (out.length !== input.length) {
    throw new EmbedError("WRONG_VECTOR_COUNT", { asked: input.length, got: out.length });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// The store-facing half: a SYNC embedder over an async client
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `store.Embedder` is synchronous — `put` and `rebuildCache` are — and an HTTP
 * call is not. That mismatch is real and this is where it is handled honestly
 * rather than papered over:
 *
 *   - `vector()` / `warm()` are the LIVE half. They are called from paths that
 *     can await (the authored gate, the sweep's apply), and every vector they
 *     fetch lands in the cache.
 *   - `embed` is the SYNC half the store holds. It never opens a socket. It
 *     answers from the cache the live half filled, and a MISS returns `null` —
 *     a counted "not exercised", never an empty vector. (A zero-length vector
 *     written into box 3 would be a dim-0 row that every cosine reads as 0.0
 *     similarity: a lie with a number on it, which is exactly what
 *     `computeNovelty`'s null-with-reason design exists to avoid.)
 *
 * The cache is keyed by (model, hash of text): the model, because vectors from
 * two generations are not comparable; the HASH, because a cache keyed by text is
 * a copy of the store's contents in memory with no lifecycle.
 */
export interface LiveEmbedder {
  /** The seat's pinned id — the generation this cache holds. */
  readonly model: string;
  /**
   * Which embedder this is. Absent reads as `"voyage"` (an injected test
   * embedder built before the field existed is the paid shape).
   */
  readonly kind?: EmbedderKind;
  /**
   * Does this embedder need `VOYAGE_API_KEY` to produce a vector? The static
   * table does not (`false`), and `vectors.ts` must not record
   * `no-credentials` for an embedder that never asks for one. Absent = true.
   */
  readonly needsCredential?: boolean;
  /**
   * Set when this embedder was ASKED FOR and could not be built — today, a
   * static table whose weights were not found or would not load (`NO_WEIGHTS`,
   * `MISSING_FILE`, `HASH_MISMATCH`, …). Such an embedder answers every ask
   * with null, carries no identity (so the store never reconciles against it),
   * and the worker's backfill writes the code into its DURABLE row
   * (`reason: "embedder-unavailable"`) — which is how a refusal that happened
   * inside a hook process, whose `onEvent` goes nowhere, reaches doctor.
   */
  readonly unavailable?: string;
  /** For the static table: which rule found the weights (`option`, `env`, `package`). */
  readonly weights?: "option" | "env" | "package";
  /**
   * The sync face `Store.open({ embed })` takes. For the paid seat: cache only,
   * never a socket. For the static table: it COMPUTES, in-process — which is
   * what puts a vector on every memory at write time, in whatever process
   * writes (roadmap C1 step 4). Either way it carries its `identity`, and the
   * store checks that against box 3's tag once, at open.
   */
  readonly embed: Embedder;
  /** Fetch (or serve) one vector. Returns null on any refusal — never throws. */
  vector(text: string): Promise<number[] | null>;
  /** Fetch many in one batched call. Returns how many landed. Never throws. */
  warm(texts: readonly string[]): Promise<number>;
  readonly stats: () => EmbedderStats;
}

export interface EmbedderStats {
  /** Sync lookups the cache answered. */
  readonly hits: number;
  /** Sync lookups it could not — the countable `not-exercised` (replay §4). */
  readonly misses: number;
  readonly cached: number;
  /** Texts the live half asked the provider for. */
  readonly fetched: number;
  /** Texts the provider did not return a vector for, by any cause. */
  readonly failed: number;
  /**
   * The failures of the LAST fill, verbatim — reset at the start of each one.
   *
   * The codes used to exist only inside this module: `embed.partial` put them in
   * an event, the event went to the runner's ring, and the ring died with the
   * detached process. So `adapter.embed.backfill` carried `failed: 64` with no
   * way to tell a 429 from a 400 from a dead seat, and I33 ran for a week
   * looking like "the Voyage side is failing". The backfill persists these now.
   */
  readonly lastFailures: readonly ChunkFailure[];
}

export interface LiveEmbedderOptions extends EmbedClientOptions {
  /** Injected so a test can exercise the whole path without a socket. */
  client?: EmbedFn;
}

export function createEmbedder(opts: LiveEmbedderOptions = {}): LiveEmbedder {
  const emit = opts.onEvent ?? ((): void => {});
  const client = opts.client ?? embedClient(opts);
  const model = embedSeat(opts.config ?? {}, opts.today ?? new Date().toISOString().slice(0, 10)).id;
  const cache = new Map<string, number[]>();
  let hits = 0;
  let misses = 0;
  let fetched = 0;
  let failed = 0;
  let lastFailures: readonly ChunkFailure[] = [];

  const keyOf = (text: string): string => `${model}\0${hashText(text)}`;

  // The paid seat's identity: its pinned id, and its output width when this
  // package knows it (`EMBED_MODEL_DIMS` — we never send `output_dimension`, so
  // it is the model's default). An id nobody listed has `dim: null`, its width
  // is learned from its first vector, and untagged rows are never adopted under
  // it (review of #190, MINOR 1). `external`: box 3 never drops these rows at
  // open, and never refills them inline — the backfill is the paid path.
  const identity: EmbedderIdentity = { model, dim: EMBED_MODEL_DIMS[model] ?? null, rebuild: "external" };
  const embed: Embedder = Object.assign(
    (text: string): number[] | null => {
      const hit = cache.get(keyOf(text));
      if (hit === undefined) {
        misses += 1;
        // Content-by-reference: the HASH of the text that missed, never the text.
        emit("embed.cache.miss", { hash: hashText(text), model });
        return null;
      }
      hits += 1;
      return hit;
    },
    { identity },
  );

  const fill = async (texts: readonly string[]): Promise<number> => {
    // Per fill, not cumulative: the caller asks "what went wrong THIS run".
    // BEFORE the early return, so a fill the cache answered entirely reports an
    // empty list rather than the previous fill's codes.
    lastFailures = [];
    const wanted = [...new Set(texts.filter((t) => t.length > 0 && !cache.has(keyOf(t))))];
    if (wanted.length === 0) return 0;
    let landed = 0;
    try {
      const batch = await client(wanted);
      fetched += wanted.length;
      for (let i = 0; i < wanted.length; i += 1) {
        const vec = batch.vectors[i];
        const text = wanted[i];
        if (vec === null || vec === undefined || text === undefined) {
          failed += 1;
          continue;
        }
        cache.set(keyOf(text), vec);
        landed += 1;
      }
      lastFailures = batch.failures;
      if (batch.failures.length > 0) {
        emit("embed.partial", {
          chunks: batch.chunks,
          failed: batch.failures.length,
          codes: batch.failures.map((f) => f.code).join(","),
        });
      }
    } catch (err) {
      // THE WHOLE CALL REFUSED, and it still owes a code (I33's own lesson,
      // applied to the one path that was exempt from it). `embedClient` throws
      // before it opens a socket for a missing key, a dead seat or no `fetch`,
      // so `failures` was never built and `lastFailures` stayed EMPTY — which is
      // how `adapter.embed.backfill` came to carry `failed: 64, codes: ""`, the
      // unreadable row that field exists to abolish. One synthetic whole-slice
      // entry, carrying the code and nothing else it cannot vouch for.
      lastFailures = [
        {
          chunk: 0,
          from: 0,
          count: wanted.length,
          code: err instanceof EmbedError ? err.code : "BAD_RESPONSE",
        },
      ];
      // A refusal the whole call shares (no key, dead seat, no fetch). It is
      // NULL to the caller: an embedder that cannot embed must never fail a
      // deposit — box 3 is rebuildable, a memory is not.
      //
      // It is not re-emitted here. `embedClient` already emitted `embed.refused`
      // with the code, through THIS emitter, and one refusal logged twice is a
      // rate nobody can read. (An injected `client` that emits nothing is a test
      // affordance; production always goes through the client above.)
      failed += wanted.length;
    }
    return landed;
  };

  return {
    model,
    kind: "voyage",
    needsCredential: true,
    embed,
    async vector(text: string): Promise<number[] | null> {
      if (text.length === 0) return null;
      const key = keyOf(text);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      await fill([text]);
      return cache.get(key) ?? null;
    },
    warm: fill,
    stats: (): EmbedderStats => ({
      hits,
      misses,
      cached: cache.size,
      fetched,
      failed,
      lastFailures: [...lastFailures],
    }),
  };
}

/**
 * Build this host's embedder, or say — by returning null — that there is none.
 * Both composition roots (`openAdapter`, `bin/runner.ts`) go through here, so
 * "when is there an embedder" has ONE answer rather than one per entrance.
 *
 * THE KNOB IS THE GATE, NOT THE CREDENTIAL. A `VOYAGE_API_KEY` exported for some
 * other tool is not consent to ship this store's text to a third party (v2's
 * no-silent-egress rescope), so `embedder.enabled` must be explicitly true.
 * When it is true and the key is missing, the client refuses BY NAME on its
 * first call — `NO_API_KEY`, before any socket — and that check is the client's,
 * never a second copy written here that could drift from it.
 */
export function openEmbedder(
  config: AdapterConfig,
  opts: Omit<LiveEmbedderOptions, "config"> & StaticEmbedderOptions = {},
): LiveEmbedder | null {
  if (config.embedder?.enabled !== true) return null;
  // An instrument opens no sockets (docs/observer-mode.md, scar E7) — and
  // computes no vectors either: an observer's store takes no embedder at all.
  if (config.observer === true) return null;
  if (embedderKind(config) === "static") return openStaticEmbedder(opts);
  const { weightsDir: _weightsDir, env: _env, ...live } = opts;
  return createEmbedder({ config, ...live });
}

// ═══════════════════════════════════════════════════════════════════════════
// The static tier: the same seat, filled by a local table
// ═══════════════════════════════════════════════════════════════════════════

export interface StaticEmbedderOptions {
  /** An explicit weights directory; else `COUNTERPARTS_STATIC_WEIGHTS_DIR`, else the package. */
  weightsDir?: string;
  /** The environment the weights directory is resolved from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  onEvent?: EmitFn;
}

/**
 * The static table behind the SAME `LiveEmbedder` seat the paid client fills,
 * so every composition root that already wires `embedder.embed` into the store
 * and `embedder` into the novelty seam wires this one too, with no change.
 *
 * The difference that matters: its sync `embed` COMPUTES. `Store.put` calls it
 * at write time, so a memory gets its vector in the process that wrote it —
 * hook, worker, console — and the semantic channel is never dark for want of
 * a worker run (recall INTERFACE-GAPS §6's residue, for this tier). The
 * worker's backfill still runs, for rows written by a process that had no
 * embedder (the MCP server's `note` today, mcp INTERFACE-GAPS §7).
 *
 * `vector()` and `warm()` never touch a network and never throw; there is no
 * cache, because there is nothing to save by keeping one.
 */
export function createStaticEmbedder(
  model: StaticModel,
  opts: { onEvent?: EmitFn; weights?: "option" | "env" | "package" } = {},
): LiveEmbedder {
  const emit = opts.onEvent ?? ((): void => {});
  let hits = 0;
  let misses = 0;
  const identity: EmbedderIdentity = { model: model.model, dim: model.dim, rebuild: "inline" };
  const compute = (text: string): number[] | null => {
    const vec = model.embed(text);
    if (vec === null) {
      misses += 1;
      // A text with no known token (empty, all symbols, an unknown script) — a
      // counted miss, never a zero vector. The hash, never the text.
      emit("embed.static.empty", { hash: hashText(text), model: model.model });
    } else hits += 1;
    return vec;
  };
  const embed: Embedder = Object.assign(compute, { identity });
  return {
    model: model.model,
    kind: "static",
    needsCredential: false,
    ...(opts.weights === undefined ? {} : { weights: opts.weights }),
    embed,
    vector: async (text: string): Promise<number[] | null> => (text.length === 0 ? null : compute(text)),
    // Nothing to fetch ahead of time: the sync face computes when the store
    // asks, so warming would compute every vector twice. Reports how many of
    // the texts are non-empty — the ones the store's ask can answer.
    warm: async (texts: readonly string[]): Promise<number> => texts.filter((t) => t.length > 0).length,
    stats: (): EmbedderStats => ({ hits, misses, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

/**
 * The static table that was asked for and is not here: every ask answers null,
 * no identity (the store never reconciles against it, so nothing in box 3 is
 * touched), and `unavailable` carries the refusal's code to the worker's
 * durable backfill row. Lexical recall is untouched.
 */
export function unavailableStaticEmbedder(code: string): LiveEmbedder {
  const embed: Embedder = (): number[] | null => null;
  return {
    model: "static",
    kind: "static",
    needsCredential: false,
    unavailable: code,
    embed,
    vector: async (): Promise<number[] | null> => null,
    warm: async (): Promise<number> => 0,
    stats: (): EmbedderStats => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

/**
 * Load the table and wrap it — or, when it cannot, say so by NAME twice: an
 * `embed.refused` event for whoever listens, and an UNAVAILABLE embedder whose
 * code the worker writes durably (review of #190, MAJOR 3: a hook's `onEvent`
 * goes nowhere, so the event alone reached no one). A missing table is not an
 * error worth a failed hook: the brain runs lexical-only, exactly as it did
 * before.
 */
export function openStaticEmbedder(opts: StaticEmbedderOptions = {}): LiveEmbedder {
  const emit = opts.onEvent ?? ((): void => {});
  const found = resolveStaticWeights({
    ...(opts.weightsDir === undefined ? {} : { dir: opts.weightsDir }),
    ...(opts.env === undefined ? {} : { env: opts.env }),
  });
  if (found === null) {
    emit("embed.refused", { code: "NO_WEIGHTS", kind: "static" });
    return unavailableStaticEmbedder("NO_WEIGHTS");
  }
  try {
    const model = loadStaticModel({ dir: found.dir });
    emit("embed.static.loaded", {
      model: model.model,
      dim: model.dim,
      source: found.source,
      ms: Math.round(model.loadMs),
    });
    return createStaticEmbedder(model, {
      weights: found.source,
      ...(opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }),
    });
  } catch (err) {
    const code = err instanceof StaticEmbedderError ? err.code : "LOAD_FAILED";
    emit("embed.refused", { code, kind: "static", source: found.source });
    return unavailableStaticEmbedder(code);
  }
}
