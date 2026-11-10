/**
 * A MEMORY WRITTEN BY A MODEL THAT READS THIS MEMORY WITHOUT BEING ITS
 * COUNTERPART (2026-11-09, CX2: Codex, Mike's option 2).
 *
 * The same store can be read from a host whose model is not the counterpart —
 * Codex today, where a GPT model reads the counterpart's memory as a shared
 * record and writes as itself. Two facts about such a write ride the memory's
 * meta bag (no schema bump; `mint.ts` writes them, the door decides them):
 *
 *   - **`host`** — which host wrote it (`codex`). Every memory a reader host
 *     writes carries it, beside the `model` column every write already has.
 *   - **`readerSelf`** — `{ host, model }` on a memory the reader wrote ABOUT
 *     ITSELF: one its writer marked `about: me`, or wrote as `kind: self`. In
 *     this store `me` is the counterpart, so the mark is not recorded; the
 *     memory is kept and recallable, labelled with the host and model, and is
 *     never identity material: no `me`/`us` mark later (`Store#setAbout`),
 *     never a belief's evidence (`schemas#fileSupport`), never a reflection's
 *     lived cite (`dream/reflect.ts`), never a core candidate
 *     (`sleep/consolidate.ts`). With its `about` column null, every reader
 *     keyed on `about IN ('me', 'us')` — the core lane, page stories' head
 *     start, "About me" — already passes it by.
 *
 *   - **`readerUs`** — `{ host, model }` on a memory the reader wrote about
 *     ITSELF AND THE OWNER: one its writer marked `about: us` (Mike, 2026-11-10,
 *     option B: "us" from Codex is the owner and THAT model). In this store `us`
 *     is the owner and the counterpart, so the mark is not recorded either; the
 *     memory is kept, recallable and labelled, and every identity door treats
 *     it as it treats `readerSelf` (`isReaderSelfRow` covers both): never the
 *     counterpart's us, its relationship arc, the self page (nor the nightly
 *     page writer's day, `Counterpart#pageWriterInput`), a belief, a page
 *     story or the wake's us lines.
 *
 * A leaf: imports nothing, so the store, the schemas, the night and the door
 * can all read it.
 */

/** The meta key naming the host a memory was written from (a reader host's writes only). */
export const HOST_META_KEY = "host";

/** The meta key marking a reader's note about itself. */
export const READER_SELF_META_KEY = "readerSelf";

/** The meta key marking a reader's note about itself and the owner (its `us`, option B, 2026-11-10). */
export const READER_US_META_KEY = "readerUs";

/** Who wrote a reader's self-note: the host, and the model when the host named one. */
export interface ReaderSelf {
  readonly host: string;
  readonly model: string | null;
}

/** The reader-self mark out of a meta bag, or null. Never throws. */
export function readerSelfOfMeta(meta: unknown): ReaderSelf | null {
  return labelOfMeta(meta, READER_SELF_META_KEY);
}

/** The reader-us mark out of a meta bag, or null. Never throws. */
export function readerUsOfMeta(meta: unknown): ReaderSelf | null {
  return labelOfMeta(meta, READER_US_META_KEY);
}

/** A `{host, model}` label under `key` in a meta bag, or null. Never throws. */
function labelOfMeta(meta: unknown, key: string): ReaderSelf | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const v = (meta as Record<string, unknown>)[key];
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const host = (v as Record<string, unknown>)["host"];
  if (typeof host !== "string" || host.length === 0) return null;
  const model = (v as Record<string, unknown>)["model"];
  return { host, model: typeof model === "string" && model.length > 0 ? model : null };
}

/**
 * The reader-self mark on a stored row, whose `meta` is the JSON text the
 * store keeps (or already an object). Null for anything else, an unreadable
 * bag included: a row nobody marked is an ordinary memory.
 */
export function readerSelfOfRow(row: { readonly meta?: unknown } | undefined | null): ReaderSelf | null {
  return labelOfRow(row, READER_SELF_META_KEY);
}

/** The reader-us mark on a stored row (its note about itself and the owner), or null. */
export function readerUsOfRow(row: { readonly meta?: unknown } | undefined | null): ReaderSelf | null {
  return labelOfRow(row, READER_US_META_KEY);
}

function labelOfRow(row: { readonly meta?: unknown } | undefined | null, key: string): ReaderSelf | null {
  if (row === undefined || row === null) return null;
  const raw = row.meta;
  if (typeof raw === "string") {
    if (!raw.includes(key)) return null;
    try {
      return labelOfMeta(JSON.parse(raw), key);
    } catch {
      return null;
    }
  }
  return labelOfMeta(raw, key);
}

/**
 * Is this row a reader's OWN note — about itself (`readerSelf`), or about
 * itself and the owner (`readerUs`, 2026-11-10)? Either way it is never the
 * counterpart's identity: every door that keeps one out keeps the other out.
 */
export function isReaderSelfRow(row: { readonly meta?: unknown } | undefined | null): boolean {
  return readerSelfOfRow(row) !== null || readerUsOfRow(row) !== null;
}

/**
 * Was this row written from a reader host at all (`meta.host`), or is it a
 * reader's own note? Either way its words are another model's, never the
 * counterpart's (2026-11-10). Never throws.
 */
export function isReaderHostRow(row: { readonly meta?: unknown } | undefined | null): boolean {
  if (row === undefined || row === null) return false;
  if (isReaderSelfRow(row)) return true;
  const raw = row.meta;
  let meta: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.includes(`"${HOST_META_KEY}"`)) return false;
    try {
      meta = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return false;
  const host = (meta as Record<string, unknown>)[HOST_META_KEY];
  return typeof host === "string" && host.length > 0;
}

/**
 * THE COUNTERPART'S OWN IDENTITY (option B, 2026-11-10): a memory marked me or
 * us, a core one (promoted, or in the identity band), or a belief. The one rule
 * the core holds at every operation a reader's words could reach it by — a
 * settle, a write's `updates`, a fold or merge — so that nothing a reader host
 * wrote replaces, fades or folds into it. A reader's own note is never one.
 * Structural, so the store, the night and the door can all read it. Never throws.
 */
export function isCounterpartIdentityRow(
  row:
    | {
        readonly type?: string;
        readonly about?: string | null;
        readonly promoted_identity?: number;
        readonly band?: string;
        readonly meta?: unknown;
      }
    | undefined
    | null,
): boolean {
  if (row === undefined || row === null || isReaderSelfRow(row)) return false;
  if (row.about === "me" || row.about === "us") return true;
  if (row.promoted_identity === 1 || row.band === "identity") return true;
  if (row.type === "schema" && typeof row.meta === "string" && row.meta.includes('"belief"')) {
    try {
      const m = JSON.parse(row.meta) as { role?: unknown } | null;
      return m !== null && typeof m === "object" && m.role === "belief";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Is a write from a reader host about the reader itself? `about: me`, or a
 * `kind: self` memory with no other mark (`kind: self` beside `us` is the
 * reader's `us` note instead: `writesReaderUs`).
 */
export function writesReaderSelf(about: string | null | undefined, kind: string | null | undefined): boolean {
  if (about === "me") return true;
  return kind === "self" && (about === null || about === undefined);
}

/** Is a write from a reader host about the reader and the owner (option B, 2026-11-10)? */
export function writesReaderUs(about: string | null | undefined): boolean {
  return about === "us";
}

/**
 * A reader's own note, as recall labels it (2026-11-10): whose it is and what
 * its `me` or `us` meant — null for an ordinary memory.
 */
export function readerNoteLine(
  row: { readonly meta?: unknown } | undefined | null,
  hostName: (host: string) => string = (h) => (h.length === 0 ? h : `${h.charAt(0).toUpperCase()}${h.slice(1)}`),
): string | null {
  const self = readerSelfOfRow(row);
  if (self !== null) return `${readerLabel(self, hostName(self.host))}'s own note about itself — not about me`;
  const us = readerUsOfRow(row);
  if (us !== null) return `${readerLabel(us, hostName(us.host))}'s own note about itself and the owner — not about us`;
  return null;
}

/** How a reader's self-note is named to the person and the model: "gpt-x in Codex". */
export function readerLabel(r: ReaderSelf, hostName: string): string {
  return r.model === null ? `a model in ${hostName}` : `${r.model} in ${hostName}`;
}

/**
 * A READER'S OWN FEELINGS AND ITS OWN WORDS (CX2 fix round, 2026-11-09): in this
 * store `whose: self` on a feeling and `said_by = self` on a memory mean the
 * COUNTERPART — the fast lane reads a strong self "recognized" as about me
 * (`sleep/consolidate.ts#selfRelevantFeeling`), the night counts "my" feelings
 * (`dream/feeling-weeks.ts`), and a belief files `said_by = self` as a choice.
 * From a reader host they are the model's, so they never reach the feelings
 * table or the column: they ride the memory's meta, labelled with the host and
 * the model. `whose: owner` and every other `said_by` pass through unchanged.
 */
export const READER_FEELINGS_META_KEY = "readerFeelings";
export const READER_SAID_BY_META_KEY = "readerSaidBy";
