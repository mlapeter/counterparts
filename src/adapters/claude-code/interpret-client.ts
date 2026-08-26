/**
 * The crash fallback's model call — the ONE place in this package that reaches
 * a model API, and the only network code that exists at all.
 *
 * `remember/` owns the choreography (chunking, claim/consume, restore-on-throw)
 * and deliberately holds no client; `INTERFACE-GAPS §3` says streaming, token
 * headroom, retries and detachment belong to whoever injects the function. This
 * is that injection, for this host.
 *
 * Five scars are load-bearing here, and each is a line you can point at:
 *
 *   **E2** — a truncated JSON response is a FAILURE, not data. The stop reason
 *   is captured off the `message_delta` event and returned on the result;
 *   `remember/fallback.ts` checks it against `OK_STOP_REASONS` and records the
 *   chunk `TRUNCATED`, so its spans go back for the next boundary rather than a
 *   half-parsed harvest becoming memory.
 *
 *   **E3** — the call STREAMS. A non-streaming long generation dies as a fake
 *   connection timeout, and the socket ceiling that decides "long" is a host
 *   fact this adapter reports rather than the core assuming (scar §2.18).
 *
 *   **§2.14** — the response is never sliced between the first brace and the
 *   last. `extractJson` walks the text with a real string/escape-aware scanner,
 *   and the VALIDATOR is `remember/`'s own `intake()`, downstream: structured
 *   output pins shape, the validator pins meaning, and this file does neither by
 *   regex.
 *
 *   **§2.18** — the credential comes from ONE configured source the package
 *   names (`ANTHROPIC_API_KEY`, from the environment) and never from a file, a
 *   rotation list, or a per-key cursor. Missing means a NAMED refusal before any
 *   socket is opened, not a mysterious failure at the far end.
 *
 *   **§2.15** — the model id comes from the adapter's own seat knob with a
 *   pinned default, and a placeholder that has expired refuses the call.
 *
 * There is no SDK and no dependency: `fetch` is the runtime's.
 */
import type { InterpretFn, InterpretResult, SweepChunk } from "../../core/remember/index.js";

import {
  ANTHROPIC_ENDPOINT,
  ANTHROPIC_VERSION,
  API_KEY_ENV,
  TUNABLES,
  interpretSeat,
} from "./config.js";
import type { AdapterConfig } from "./config.js";

/** Every way this client refuses, by name. A refusal is never a silent empty. */
export type InterpretRefusal =
  | "NO_API_KEY"
  | "SEAT_UNUSABLE"
  | "HTTP_ERROR"
  | "NO_BODY"
  | "NO_JSON_IN_RESPONSE";

export class InterpretError extends Error {
  /** `remember/`'s `errCode()` lifts this into the chunk's telemetry. */
  readonly code: InterpretRefusal;
  readonly detail: Record<string, string | number>;

  constructor(code: InterpretRefusal, detail: Record<string, string | number> = {}) {
    super(`${code}${Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ""}`);
    this.name = "InterpretError";
    this.code = code;
    this.detail = detail;
  }
}

/** Injected so a test can prove the whole path without a socket. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface InterpretClientOptions {
  config?: AdapterConfig;
  /** Defaults to `globalThis.fetch`. A test supplies its own; nothing else does. */
  fetch?: FetchLike;
  /** Today, ISO — the date a placeholder seat's expiry is judged against. */
  today?: string;
  /** Output headroom. Too little is how E2's incident happens. */
  maxTokens?: number;
  /** Telemetry: ids, counts, reasons. Never span text, never response text. */
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
  /** Aborts the request. The watchdog's hand on the socket. */
  signal?: AbortSignal;
}

/**
 * The prompt. It says what a proposal IS in `remember/`'s own vocabulary, and it
 * asks for nothing the intake validator will not accept — but nothing here
 * TRUSTS that: every field is re-validated downstream, and no privileged field
 * exists to ask for, because `Proposal` has nowhere to put one (§4.1 G7).
 *
 * Three lessons of the 2026-08-26 replay review are load-bearing here:
 *   - the OWNER IS NAMED when the config knows them. The first real run minted
 *     15 durable person-memories under a confabulated name ("Matt", appearing
 *     nowhere in the source) because nothing anchored who the transcripts
 *     belong to.
 *   - the KINDS ARE DEFINED. Named without definitions, `entity` came back
 *     ~60% events-filed-as-things and `place` 8-for-8 non-geographic — a spec
 *     absence, not a model failure.
 *   - ONE IDEA HAS TEETH, and a fragment gets `[]` instead of an essay (5 of
 *     121 real calls answered tiny scraps with prose; throw-and-restore held,
 *     but the honest answer was always `[]`).
 */
export function systemPrompt(identity?: {
  readonly name: string;
  readonly aliases?: readonly string[];
}): string {
  const aka =
    identity?.aliases !== undefined && identity.aliases.length > 0
      ? ` (also appearing as: ${identity.aliases.join(", ")})`
      : "";
  const owner =
    identity === undefined
      ? [
          "If the person the transcripts belong to is not named in them, write",
          "'the owner' — NEVER guess or introduce a name the transcript does not",
          "contain verbatim.",
        ]
      : [
          `The person these transcripts belong to is ${identity.name}${aka}.`,
          `Refer to them as ${identity.name}. Never introduce any other name for`,
          "them; a name not in the transcript verbatim does not exist.",
          "This anchor is context, not material: never propose a memory whose",
          "content restates it — memories come from the transcript alone.",
        ];
  return [
    "You are reading a transcript that its own author never got to summarize — the",
    "session ended before the end-of-session write. Recover what was LEARNED, not",
    "what was said.",
    "",
    ...owner,
    "",
    "Return ONLY a JSON array. Each element is an object:",
    "  content   (required, string) — the memory, in plain prose. ONE idea per",
    "            element: if a passage taught three things, return three elements.",
    "            Never bundle a day's status updates into one memory.",
    "  kind      (optional) — exactly one of:",
    "              self    — a lesson, trait, or practice of the AI assistant itself",
    "              person  — a durable fact about a human (who they are, how they",
    "                        work) — not an event they happened to be part of",
    "              entity  — a durable named thing: a project, company, product,",
    "                        system — not an event, status, or one-time change",
    "              skill   — a reusable technique or how-to",
    "              place   — a physical location",
    "              fact    — everything else durable: events, decisions, states",
    '  title     (optional, string) — a short handle.',
    '  claimed   (optional, number 0-1) — how much this mattered.',
    '  salience  (optional) — { relevance, emotional, predictive }, each 0-1.',
    '  feeling   (optional) — { feeling, quote, subject }; quote must appear in the span.',
    '  aliases   (optional, string[]) — other names for the thing.',
    '  updates   (optional, string) — the id of a memory this revises, if one is named.',
    "",
    "Return [] when the transcript taught nothing. An empty array is a real answer,",
    "and it is THE answer for a fragment too small to teach anything — never",
    "commentary about the fragment.",
    "Do not include commentary, markdown fences, or any text outside the array.",
  ].join("\n");
}

/** The identity-less render, kept for callers and tests that predate the owner
 *  anchor. A configured host lets `interpretClient` build the anchored prompt. */
export const SYSTEM_PROMPT = systemPrompt();

/**
 * Build the `InterpretFn` `remember/`'s sweep takes. One chunk in, proposals and
 * a stop reason out; every failure THROWS with a named code, because a throw is
 * what makes `remember/` restore the chunk's spans (scar E6) instead of
 * consuming them against nothing.
 */
export function interpretClient(opts: InterpretClientOptions = {}): InterpretFn {
  const config = opts.config ?? {};
  const doFetch = opts.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike | undefined);
  const maxTokens = opts.maxTokens ?? TUNABLES.MAX_OUTPUT_TOKENS;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const emit = opts.onEvent ?? ((): void => {});
  // Anchored once, at construction: the owner's identity comes from the host's
  // config, the same source the identity core uses — never inferred from text.
  const system = systemPrompt(config.identity);

  return async (chunk: SweepChunk): Promise<InterpretResult> => {
    // ── the credential, from ONE source, checked BEFORE any socket ──────────
    const key = process.env[API_KEY_ENV];
    if (key === undefined || key.trim().length === 0) {
      emit("interpret.refused", { chunk: chunk.index, code: "NO_API_KEY" });
      throw new InterpretError("NO_API_KEY", { env: API_KEY_ENV });
    }
    // ── the seat, whose placeholder expires (scar §2.15) ────────────────────
    const seat = interpretSeat(config, today);
    if (!seat.usable) {
      emit("interpret.refused", { chunk: chunk.index, code: "SEAT_UNUSABLE", status: seat.status });
      throw new InterpretError("SEAT_UNUSABLE", { seat: seat.seat, status: seat.status });
    }
    if (doFetch === undefined) {
      emit("interpret.refused", { chunk: chunk.index, code: "HTTP_ERROR", reason: "no-fetch" });
      throw new InterpretError("HTTP_ERROR", { reason: "no-fetch" });
    }

    const body = {
      model: seat.id,
      max_tokens: maxTokens,
      // E3: long generations STREAM. This one can be long by construction — a
      // chunk is thousands of bytes of transcript.
      stream: true,
      system,
      messages: [{ role: "user", content: chunk.prompt }],
    };

    emit("interpret.call", {
      chunk: chunk.index,
      bytes: chunk.bytes,
      spans: chunk.spans.length,
      model: seat.id,
      seat: seat.status,
    });

    const response = await doFetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });

    if (!response.ok) {
      emit("interpret.refused", { chunk: chunk.index, code: "HTTP_ERROR", status: response.status });
      throw new InterpretError("HTTP_ERROR", { status: response.status });
    }
    if (response.body === null) {
      emit("interpret.refused", { chunk: chunk.index, code: "NO_BODY" });
      throw new InterpretError("NO_BODY", {});
    }

    const read = await readStream(response.body);
    emit("interpret.done", {
      chunk: chunk.index,
      stopReason: read.stopReason,
      chars: read.text.length,
    });

    // E2, HALF ONE: the stop reason travels back UNJUDGED. `remember/` owns the
    // OK list and the TRUNCATED verdict; two opinions on what counts as a clean
    // completion is how they drift apart.
    if (read.stopReason !== null && read.stopReason !== "end_turn") {
      return { proposals: [], stopReason: read.stopReason };
    }

    const parsed = extractJson(read.text);
    if (parsed === null) {
      // Distinguishable from "returned nothing": the model said something and
      // it was not an array (scar §2.4).
      emit("interpret.refused", { chunk: chunk.index, code: "NO_JSON_IN_RESPONSE" });
      throw new InterpretError("NO_JSON_IN_RESPONSE", { chars: read.text.length });
    }
    return {
      proposals: parsed,
      ...(read.stopReason === null ? {} : { stopReason: read.stopReason }),
    };
  };
}

export interface StreamRead {
  readonly text: string;
  /** From `message_delta`. Null when the stream ended without stating one. */
  readonly stopReason: string | null;
}

/**
 * Consume the SSE stream, keeping exactly two things: the concatenated text and
 * the stop reason. Everything else — usage, ids, block indices — is the API's
 * bookkeeping, and none of it is content this package needs.
 *
 * A malformed `data:` line is SKIPPED, not fatal: a stream that carried real
 * deltas and one bad frame still produced text, and dropping the whole harvest
 * for a frame we could not parse would be the opposite of E6.
 */
export async function readStream(stream: ReadableStream<Uint8Array>): Promise<StreamRead> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason: string | null = null;

  const handle = (line: string): void => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice("data:".length).trim();
    if (payload.length === 0 || payload === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event["type"];
    if (type === "content_block_delta") {
      const delta = event["delta"] as Record<string, unknown> | undefined;
      if (delta !== undefined && typeof delta["text"] === "string") text += delta["text"];
    } else if (type === "message_delta") {
      const delta = event["delta"] as Record<string, unknown> | undefined;
      if (delta !== undefined && typeof delta["stop_reason"] === "string") {
        stopReason = delta["stop_reason"];
      }
    } else if (type === "error") {
      const error = event["error"] as Record<string, unknown> | undefined;
      const kind = typeof error?.["type"] === "string" ? (error["type"] as string) : "stream-error";
      // An in-stream error is a stop reason the OK list will reject, which is
      // exactly the treatment a truncation gets — one path, not two.
      stopReason = kind;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n");
    while (cut >= 0) {
      handle(buffer.slice(0, cut).trim());
      buffer = buffer.slice(cut + 1);
      cut = buffer.indexOf("\n");
    }
  }
  if (buffer.trim().length > 0) handle(buffer.trim());
  return { text, stopReason };
}

/**
 * Find the first COMPLETE top-level JSON array in the text, by walking it with a
 * scanner that knows about strings and escapes.
 *
 * The forbidden shortcut — slice from the first `[` to the last `]` — is scar
 * §2.14: a bracket inside a quoted string moves the boundary and the parse
 * fails on content that was perfectly well-formed. This walker cannot make that
 * mistake because it never looks at a bracket that is inside a string.
 *
 * It returns the ARRAY's elements, unvalidated. Validation is `remember/`'s
 * `intake()`, downstream, on purpose: the shape is pinned here and the MEANING
 * is pinned there, and this file gets no opinion about the second.
 */
export function extractJson(text: string): unknown[] | null {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "[") continue;
    const end = scanArray(text, i);
    if (end === null) continue;
    try {
      const parsed: unknown = JSON.parse(text.slice(i, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not a valid array starting here; keep looking. A prose "[" in a preamble
      // is exactly the case the naive slice gets wrong.
      continue;
    }
  }
  return null;
}

/** The index of the `]` closing the array that opens at `start`, or null. */
function scanArray(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return ch === "]" ? i : null;
      if (depth < 0) return null;
    }
  }
  return null;
}
