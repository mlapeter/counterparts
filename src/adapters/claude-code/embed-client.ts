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
import type { Embedder } from "../../core/store/index.js";
import { hashText } from "../../core/store/index.js";

import { EMBED_KEY_ENV, TUNABLES, VOYAGE_ENDPOINT, embedSeat } from "./config.js";
import type { AdapterConfig } from "./config.js";
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
      try {
        const got = await callOnce(doFetch, key, seat.id, slice, opts.signal);
        for (let i = 0; i < got.length; i += 1) {
          vectors[from + i] = got[i] ?? null;
          returned += 1;
        }
        emit("embed.done", { chunk: index, count: got.length, dim: got[0]?.length ?? 0 });
      } catch (err) {
        // E1: THIS chunk fails. Its siblings do not, and the caller is told
        // which one and why — a null vector with no reason is the shape v1's
        // "one bad item failed the whole run" incident was made of.
        const code: EmbedRefusal = aborted()
          ? "ABORTED"
          : err instanceof EmbedError
            ? err.code
            : "BAD_RESPONSE";
        const status = err instanceof EmbedError ? err.detail["status"] : undefined;
        const failure: ChunkFailure = {
          chunk: index,
          from,
          count: slice.length,
          code,
          ...(typeof status === "number" ? { status } : {}),
        };
        failures.push(failure);
        emit("embed.chunk.failed", {
          chunk: index,
          from,
          count: slice.length,
          code,
          status: typeof status === "number" ? status : null,
        });
      }
    }

    return { model: seat.id, vectors, requested: texts.length, returned, chunks: chunk, failures };
  };
}

/** ONE request. Every failure here is an `EmbedError` so the caller can name it. */
async function callOnce(
  doFetch: FetchLike,
  key: string,
  model: string,
  input: readonly string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const response = await doFetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The credential is a HEADER. Never a query parameter: a URL is logged by
      // every proxy between here and there.
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, input }),
    ...(signal === undefined ? {} : { signal }),
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
  /** The sync face `Store.open({ embed })` takes. Cache only; never a socket. */
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

  const keyOf = (text: string): string => `${model}\0${hashText(text)}`;

  const embed: Embedder = (text: string): number[] | null => {
    const hit = cache.get(keyOf(text));
    if (hit === undefined) {
      misses += 1;
      // Content-by-reference: the HASH of the text that missed, never the text.
      emit("embed.cache.miss", { hash: hashText(text), model });
      return null;
    }
    hits += 1;
    return hit;
  };

  const fill = async (texts: readonly string[]): Promise<number> => {
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
      if (batch.failures.length > 0) {
        emit("embed.partial", {
          chunks: batch.chunks,
          failed: batch.failures.length,
          codes: batch.failures.map((f) => f.code).join(","),
        });
      }
    } catch {
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
    stats: (): EmbedderStats => ({ hits, misses, cached: cache.size, fetched, failed }),
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
  opts: Omit<LiveEmbedderOptions, "config"> = {},
): LiveEmbedder | null {
  if (config.embedder?.enabled !== true) return null;
  // An instrument opens no sockets (docs/observer-mode.md, scar E7).
  if (config.observer === true) return null;
  return createEmbedder({ config, ...opts });
}
