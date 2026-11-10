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
 * `us` from a reader host is unchanged (Mike, 2026-11-09: no change without his
 * word): who "us" is from Codex — the owner and the counterpart, or the owner
 * and the reading model — is an open question, listed in the codex adapter's
 * INTERFACE-GAPS.
 *
 * A leaf: imports nothing, so the store, the schemas, the night and the door
 * can all read it.
 */

/** The meta key naming the host a memory was written from (a reader host's writes only). */
export const HOST_META_KEY = "host";

/** The meta key marking a reader's note about itself. */
export const READER_SELF_META_KEY = "readerSelf";

/** Who wrote a reader's self-note: the host, and the model when the host named one. */
export interface ReaderSelf {
  readonly host: string;
  readonly model: string | null;
}

/** The reader-self mark out of a meta bag, or null. Never throws. */
export function readerSelfOfMeta(meta: unknown): ReaderSelf | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const v = (meta as Record<string, unknown>)[READER_SELF_META_KEY];
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
  if (row === undefined || row === null) return null;
  const raw = row.meta;
  if (typeof raw === "string") {
    if (!raw.includes(READER_SELF_META_KEY)) return null;
    try {
      return readerSelfOfMeta(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return readerSelfOfMeta(raw);
}

/** Is this row a reader's note about itself? */
export function isReaderSelfRow(row: { readonly meta?: unknown } | undefined | null): boolean {
  return readerSelfOfRow(row) !== null;
}

/**
 * Is a write from a reader host about the reader itself? `about: me`, or a
 * `kind: self` memory with no other mark (`kind: self` beside `us` stays `us`:
 * that word is not changed here).
 */
export function writesReaderSelf(about: string | null | undefined, kind: string | null | undefined): boolean {
  if (about === "me") return true;
  return kind === "self" && (about === null || about === undefined);
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
