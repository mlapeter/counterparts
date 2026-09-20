/**
 * The document shape a memory is READ as, and the two guards that keep it
 * honest on the way into a row.
 *
 * Until the floor (schema v6) this file was box 1: a markdown parser, a stager,
 * an archiver, and ~16,000 files under `prose/`. The memory is now the ROW —
 * `memories.title`, `.body`, `.meta` — so the parser has nothing to parse and
 * the stager nothing to stage. `ProseDoc` survives unchanged as the read shape,
 * which is the seam that let the whole brain layer above `store/` not notice
 * the floor move; `render.ts` keeps the markdown, one direction only, as the
 * EXPORT format. Nothing reads it back.
 *
 * What is left here is what the row still needs:
 *
 *   - `ProseDoc` / `ProseType` / `ID_PREFIX` — the shape and the id families;
 *   - `hashText` — the one content-address function (contract §3);
 *   - `assertJsonSafe` — the G6 guard, now over the `meta` COLUMN. A function,
 *     an `undefined`, a symbol or a `NaN` in meta is silent data loss whether
 *     it is dropped on the way into a file or on the way into a TEXT column,
 *     and v1's named incident (a parser silently dropping tier, frequency,
 *     provenance and aliases on rewrite) is the reason it is checked at all.
 */
import { createHash } from "node:crypto";
import { StoreError } from "./errors.js";

export type ProseType = "memory" | "episode" | "schema";
export const PROSE_TYPES: readonly ProseType[] = ["memory", "episode", "schema"];

/** Type prefix per family. Ids are immutable, never reused, type-prefixed (G2). */
export const ID_PREFIX: Record<ProseType, string> = {
  memory: "mem",
  episode: "epi",
  schema: "sch",
};

export interface ProseDoc {
  id: string;
  type: ProseType;
  title?: string;
  /** When it happened, at stated precision: `2026`, `2026-08`, or `2026-08-25`. Never rounded. */
  happenedOn?: string;
  /** When it was learned (ISO date). Supersession reasoning needs it. */
  learnedOn: string;
  /** Which lived day it was born on — the decay clock's integer (scar E8). */
  bornDay: number;
  /** Unrecognized / module-specific fields. Survives the row round-trip
   *  untouched (G6): the column holds the JSON verbatim. */
  meta: Record<string, unknown>;
  /** The interpretation. This *is* the memory. */
  body: string;
}

/** The one content-address function (contract §3): span, run record, body all join here. */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * An id that can be a row's primary key and a filename in an export.
 *
 * The slash and whitespace refusal predates the floor — it kept an id from
 * inventing a directory under `prose/` — and it is kept because
 * `render.ts` writes `<id>.md` on the way out and because an id with a newline
 * in it makes every log line ambiguous.
 */
export function assertIdWellFormed(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0 || /\s|\//.test(id)) {
    throw new StoreError("ID_MALFORMED", { id: String(id) });
  }
}

/**
 * `meta` as the column holds it: JSON, verbatim, refused rather than truncated
 * when it cannot survive the round trip (G6, G7 — "content that could break the
 * parser is rejected loudly, never truncated").
 */
export function serializeMeta(meta: Record<string, unknown>, id: string): string {
  // A value JSON silently DROPS (a function, undefined, a symbol) or silently
  // transforms (bigint throws, NaN becomes null) is metadata loss on rewrite —
  // v1's named incident. Refuse it here, before it reaches the column.
  assertJsonSafe(meta, id, "meta");
  try {
    return JSON.stringify(meta) ?? "{}";
  } catch (cause) {
    throw new StoreError("PROSE_META_UNSERIALIZABLE", {
      id,
      reason: String((cause as Error).message ?? cause),
    });
  }
}

/** The column read back. A column that will not parse is a hand-edited database. */
export function parseMeta(raw: string, id: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StoreError("MEMORY_META_MALFORMED", {
      id,
      reason: String((cause as Error).message ?? cause),
    });
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** Depth-first: every value must survive JSON.stringify → JSON.parse unchanged. */
export function assertJsonSafe(value: unknown, id: string, path: string): void {
  const t = typeof value;
  if (value === null || t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new StoreError("PROSE_META_UNSERIALIZABLE", { id, path, reason: "non-finite-number" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, id, `${path}[${i}]`));
    return;
  }
  if (t === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(v, id, `${path}.${k}`);
    }
    return;
  }
  throw new StoreError("PROSE_META_UNSERIALIZABLE", { id, path, reason: `type-${t}` });
}
