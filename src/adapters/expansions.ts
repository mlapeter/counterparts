/**
 * The handle-resolution log — what a deliberate expansion BY HANDLE actually
 * reached, left where the credit pass can read it.
 *
 * **The gap it closes (LAUNCH-STATUS G50).** `recall/reference.ts` credits an
 * expansion from the recall tool call's own input, and it resolves NOTHING: an
 * `ids`/`handle` value that is not literally a `mem_…` address is counted
 * `unresolvedHandles` and credits nothing. But `mcp/tools.ts` documents `handle`
 * as "a memory id or exact handle", and `mcp/deliberate.ts#expandHandle` answers
 * a TITLE with the whole body. So the most deliberate thing a session can do —
 * name a memory and read it — earned no credit at all. Under-credit, and
 * invisible: the boundary row said `expanded: 0, unresolvedHandles: 1`.
 *
 * **Why a log and not a session field.** There is no per-session "expanded ids"
 * state the credit pass reads; `claude-code/hooks.ts#creditAtBoundary` takes its
 * expansions from the TRANSCRIPT (`transcript.ts#expansionIdsOf`) and slices
 * them by the same turn cursor capture uses. That is the thing to preserve: the
 * transcript already decides WHICH handles this session used and WHEN. This file
 * supplies only the translation — what the tool resolved that handle to.
 *
 * **That is not the same as "credit is not widened", which is what the first two
 * commits of this leaf claimed.** The transcript says which handle and when; it
 * cannot say whose ANSWER resolved it, and this table is shared. So the honest
 * statement is narrower: the boundary credits a memory only for a handle THIS
 * session's transcript carries, translated through an answer given in THIS
 * PROJECT (`readHandleResolutions`'s scope filter) and no earlier than THIS
 * SESSION's own start (its `since` floor). What remains is stated where the
 * filters are: two sessions running at once in one project directory share one
 * table.
 *
 * A list of ids keyed by session would fail twice over: this host launches the MCP
 * server from a static config, so it is usually UNBOUND and has no session id to
 * key by (mcp/INTERFACE-GAPS §6, §8), and a flat list cannot be positioned
 * against the turn cursor, so an expansion from turn 3 would be re-credited at
 * every later boundary.
 *
 * **Neither adapter imports the other.** The MCP tool writes, the Claude Code
 * hook reads, and they meet here — the same shape, and for the same reason, as
 * `adapters/sessions.ts` (mcp/INTERFACE-GAPS §7: adapters are leaves, a shared
 * sibling is what that rule allows).
 *
 * **Host state, not memory, and it says so on disk.** The record is a HASH of
 * the handle, the id it reached (or `null` — see `HandleResolution.id`), a
 * timestamp, and the scope that asked —
 * deliberately no handle text, because a handle IS a memory's title and
 * `store/paths.ts` classifies `sessions/` as carrying no content (`backup:
 * false`). Hashing is what keeps that classification true without editing it.
 *
 * **A LOST WRITE IS NOT ALWAYS THE SAFE DIRECTION, and saying it was is what the
 * first draft got wrong.** Losing a RESOLUTION costs one handle's credit —
 * under-credit, the direction this repo errs in on purpose. Losing a REFUSAL is
 * the opposite: the shadow that should have overridden an earlier resolution
 * never lands, and the next asking of that handle is translated through an
 * answer it was never given. So the whole file being lost is under-credit only
 * because the resolutions go with the refusals; a file that can be READ but not
 * APPENDED to is the dangerous shape, and it is one of the three in
 * `readHandleResolutions`'s list. That is why the scope filter, and not the
 * shadow, is the confidentiality boundary here: across projects a lost refusal
 * cannot reach another project's boundary at all. Within ONE project directory
 * it still can, and that residual is recorded rather than papered over.
 *
 * Three rules, mechanized below, inherited from `sessions.ts`:
 *
 *   1. **Nothing here ever throws at a caller.** A tool may not fail on host
 *      bookkeeping and a hook may not fail the host. Every entry point returns
 *      a falsy answer instead.
 *   2. **Appends are appends.** One line per resolution, `O_APPEND`, so two
 *      servers writing at once interleave lines rather than clobbering a file.
 *   3. **Compaction is atomic** — temp file beside the target, then `rename`,
 *      so a reader never sees half a log.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSIONS_DIR, canonicalScope } from "./sessions.js";

/** One file, inside the registry's directory — see the header on placement. */
export const EXPANSIONS_FILE = "expansions.jsonl";

/**
 * **CAL.** How long a resolution may still translate a handle.
 *
 * It only has to outlive the gap between a `recall` call and the boundary that
 * judges it, and a boundary fires at every Stop. A day is generous by orders of
 * magnitude and still short enough that a renamed memory cannot be credited
 * under last week's title.
 */
export const EXPANSION_TTL_MS = 24 * 60 * 60 * 1000;

/** **CAL.** Compact when the file passes this. ~90 bytes a line, so ~700 lines. */
export const EXPANSIONS_MAX_BYTES = 64 * 1024;

/** **CAL.** How many live resolutions a compaction keeps, newest last. */
export const EXPANSIONS_KEEP = 256;

export interface HandleResolution {
  /** `handleKey` of the handle the model passed. Never the handle itself. */
  readonly key: string;
  /**
   * The id `expandHandle` actually reached — or NULL, which is a SHADOW: this
   * handle was asked and answered with nothing, and the newest answer wins.
   *
   * The shadow is not bookkeeping. The log is keyed by handle, not by session,
   * because the resolution is deterministic — but a refusal is not: the owner's
   * own session resolves a confidential title and a stranger's session is told
   * nothing, and without a shadow the stranger's boundary would translate the
   * same handle through the owner's entry and credit a memory it was never
   * shown. Same shape for a title that has since gone ambiguous, or been renamed
   * away.
   *
   * It is NOT the confidentiality boundary, though the first draft said so: a
   * shadow only exists where an answer was given, and three askings get none.
   * `readHandleResolutions`'s scope filter is what covers those.
   */
  readonly id: string | null;
  readonly at: number;
  /**
   * The project the resolving server was serving, canonical. It IS a filter —
   * see `readHandleResolutions` — and it is the only thing on a record that can
   * say whose asking this answer belongs to. A record without one cannot pass
   * the filter at all.
   */
  readonly scope?: string;
}

export function expansionsPath(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR, EXPANSIONS_FILE);
}

/**
 * The lookup key: the handle, trimmed and case-folded, hashed.
 *
 * Trim-and-fold is not a normalization of this module's invention — it is
 * EXACTLY the comparison `mcp/deliberate.ts#expandHandle` makes against a title
 * (`title.trim().toLowerCase() === handle.toLowerCase()`, on a handle the
 * dispatcher already trimmed). Two spellings that the resolver treats as the
 * same handle must land on the same key, or the translation misses the case the
 * session actually used.
 */
export function handleKey(handle: string): string {
  return createHash("sha256").update(handle.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Record what a handle resolved to — an id, or `null` for "this handle was
 * asked and answered with nothing". Returns false on any failure at all.
 *
 * EVERY handle-path outcome is recorded, not only the expansions. A refusal
 * that left no trace would let an earlier session's resolution translate a
 * later session's identical handle, and the later session may have been refused
 * for a reason the earlier one was not — confidentiality above all. Writing the
 * refusal as a shadow is what keeps the log's key (the handle) honest about the
 * thing it is standing in for (what THIS asking reached).
 */
export function recordHandleResolution(
  dataDir: string,
  input: { handle: string; id: string | null; scope?: string; at?: number },
): boolean {
  const handle = input.handle.trim();
  if (handle.length === 0) return false;
  if (input.id !== null && input.id.length === 0) return false;
  const record: HandleResolution = {
    key: handleKey(handle),
    id: input.id,
    at: input.at ?? Date.now(),
    ...(input.scope === undefined || input.scope.length === 0 ? {} : { scope: canonicalScope(input.scope) }),
  };
  const path = expansionsPath(dataDir);
  try {
    mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      /* no file yet */
    }
    if (size + line.length > EXPANSIONS_MAX_BYTES) compactExpansions(path, record.at);
    appendFileSync(path, line, { encoding: "utf8", mode: 0o600 });
  } catch {
    return false;
  }
  return true;
}

/**
 * Every live answer, newest winning, as `key → id | null`. A `null` value is a
 * shadow and translates nothing (see `HandleResolution.id`).
 *
 * **FILTERED BY SCOPE when `opts.scope` is given, and the caller that credits
 * always gives it.** The first draft of this module refused to filter, reasoning
 * that a RESOLUTION is deterministic — one store, one exact-title match — so it
 * could not matter which project's server performed it, and that the refusals
 * were covered by the shadow. That reasoning has a hole, and it is the one this
 * whole leaf exists to close. The log records the last answer ANYONE got, so a
 * session that got no answer at all still reads someone else's, and there are
 * three routes to that which leave no shadow behind them:
 *
 *   - the tool call never reached `expandHandle` (the server was down, or threw
 *     before the resolver ran) — nothing is refused, so nothing is recorded;
 *   - the call was `recall { handle, question }`, which the dispatcher refuses
 *     as `both-arguments` on path `none`, before the handle path exists;
 *   - the call WAS refused `handle-confidential-withheld`, and the shadow could
 *     not be written (a read-only log, a full disk) — `recordHandleResolution`
 *     returns false, because it may not throw at a tool.
 *
 * In each of those the transcript still carries the title, so the boundary still
 * translates it — through the only line in the log, which may be the owner's
 * resolution of a CONFIDENTIAL memory. The shadow cannot cover a case in which
 * nothing was written.
 *
 * The scope is the discriminator that covers all three at once, and it is the
 * same one the server already trusts for session binding (`sessions.ts#sameScope`
 * at `server.ts#requireBoundSession`): a comparison the two adapters disagree
 * about costs a translation, which is under-credit, the safe direction. A record
 * with no scope at all is dropped for the same reason — a line that cannot say
 * where it came from cannot be matched to where this is.
 *
 * Filtering also removes the opposite race the first draft accepted: a
 * stranger's refusal landing between the owner's call and the owner's Stop cost
 * the owner that credit. The stranger's shadow now carries the stranger's scope,
 * so it never reaches the owner's boundary.
 *
 * **`opts.since` is the other half: the asking session's own start.** A project
 * is a place, not a conversation — the same directory carries Monday's session
 * and Tuesday's, and two at once — so the scope alone still lets last week's
 * resolution of a title answer today's typed guess. The credit pass passes the
 * session's `startedAt` from the live-session registry, and a record stamped
 * before it is dropped. Inclusive at the boundary: a resolution in the same
 * millisecond the session was registered is that session's own.
 *
 * What is LEFT is stated rather than hidden: two sessions running CONCURRENTLY
 * in one project directory share one table, so a call that did not reach
 * `expandHandle` can still be translated through a resolution the other one
 * made. And a session with no registry record has no floor at all.
 */
export function readHandleResolutions(
  dataDir: string,
  opts: { now?: number; ttlMs?: number; scope?: string; since?: number } = {},
): Map<string, string | null> {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? EXPANSION_TTL_MS;
  const since = opts.since;
  // Canonicalized ONCE: `canonicalScope` is a `realpath` syscall, and the file
  // may hold hundreds of lines.
  const want =
    opts.scope === undefined || opts.scope.length === 0 ? null : canonicalScope(opts.scope);
  const out = new Map<string, string | null>();
  let raw: string;
  try {
    raw = readFileSync(expansionsPath(dataDir), "utf8");
  } catch {
    // Absent or unreadable: no translations, which credits exactly what a
    // pre-2026-09-15 store credited. Never a reason to fail a boundary.
    return out;
  }
  for (const record of parseLines(raw)) {
    if (now - record.at > ttl) continue;
    if (want !== null && !scopeMatches(record.scope, want)) continue;
    // The session floor. INCLUSIVE, because a resolution stamped in the same
    // millisecond the session was registered is this session's own.
    if (since !== undefined && record.at < since) continue;
    out.set(record.key, record.id);
  }
  return out;
}

/** Records are written canonical, so the string compare answers almost always;
 *  the `realpath` is the fallback for a line some other writer left raw. */
function scopeMatches(scope: string | undefined, want: string): boolean {
  if (scope === undefined) return false;
  return scope === want || canonicalScope(scope) === want;
}

/**
 * Translate the raw expansion strings from a transcript slice.
 *
 * A string the log resolved becomes the id it reached; everything else — a
 * handle nobody asked, and a handle whose newest answer is a SHADOW — passes
 * through UNCHANGED, so it still reaches `reference.ts` as itself and still
 * counts `unresolvedHandles`. A guess the tool answered "not-found" must go on
 * being a guess that credited nothing.
 *
 * Literal ids are looked up too, not skipped: `Store.resolve` follows forwarding
 * addresses, so a session that expanded a SUPERSEDED id by name read — and
 * should be credited for — the live head, which is what the tool recorded.
 */
export function translateExpansions(
  expansions: readonly string[],
  resolutions: ReadonlyMap<string, string | null>,
): string[] {
  if (resolutions.size === 0) return [...expansions];
  return expansions.map((raw) => resolutions.get(handleKey(raw)) ?? raw);
}

/** How many of `expansions` the log actually translated — the boundary row's
 *  `resolvedHandles`, and the one number that proves this seam live. */
export function countTranslated(
  expansions: readonly string[],
  resolutions: ReadonlyMap<string, string | null>,
): number {
  let n = 0;
  for (const raw of expansions) {
    const to = resolutions.get(handleKey(raw));
    if (to !== undefined && to !== null && to !== raw.trim()) n += 1;
  }
  return n;
}

/**
 * Rewrite the file with the newest live resolutions and nothing else.
 *
 * **The window is narrowed to re-read → rename, and that is not the same as
 * closed.** The first draft read the whole file, wrote the temp copy, and
 * renamed — so a line another process appended anywhere in between was gone,
 * and the compacted file kept the OLDER answer for that handle. For a SHADOW
 * that is not under-credit, it is the leak this module exists to prevent: the
 * refusal disappears and the resolution it was overriding stands again. So the
 * byte length read at the top is kept, the file is re-read from that offset
 * immediately before the rename, and whatever arrived is appended to the temp
 * file (in arrival order, after the sorted block — `readHandleResolutions` takes
 * the last line for a key, so a late shadow still wins).
 *
 * A line appended after THAT read and before the rename is still lost. The
 * window is now two syscalls wide instead of a whole file write, and the
 * alternative — a lock file two long-lived processes share — is a new failure
 * mode in the hot path of a tool that may not fail.
 *
 * Dropping an old entry is safe in the one direction that matters: the map is
 * keyed by handle, so a shadow and the resolution it overrides ARE one entry.
 * Compaction can drop them together; it can never drop the shadow and leave the
 * resolution standing.
 *
 * Exported for `test/sessions.test.ts`, which is the only way to stage the race
 * deterministically — see `duringWindow`.
 */
export function compactExpansions(
  path: string,
  now: number,
  /**
   * TEST SEAM, in the same spirit as the `now` injections this repo already
   * uses: called once the temp file is written and before the tail is re-read,
   * so a test can be the other process instead of hoping to be scheduled like
   * one. Nothing in `src/` passes it.
   */
  duringWindow?: () => void,
): void {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return;
  }
  // BYTES, not characters: the tail is spliced back by offset below.
  const offset = buf.length;
  const live = new Map<string, HandleResolution>();
  for (const record of parseLines(buf.toString("utf8"))) {
    if (now - record.at > EXPANSION_TTL_MS) continue;
    live.set(record.key, record);
  }
  const keep = [...live.values()].slice(-EXPANSIONS_KEEP);
  const tmp = `${path}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(tmp, keep.map((r) => `${JSON.stringify(r)}\n`).join(""), {
      encoding: "utf8",
      mode: 0o600,
    });
    duringWindow?.();
    // Anything appended since the read at the top. A file that SHRANK was
    // replaced by another compaction; splicing its bytes at our offset would
    // produce nonsense, so nothing is carried over.
    const after = readFileSync(path);
    if (after.length > offset) appendFileSync(tmp, after.subarray(offset), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    /* the log stays as it was, one compaction late */
  }
}

/** Lines that are not a record are skipped, never thrown over: a half-written
 *  line from a host that died mid-append is an ordinary thing to find here. */
function parseLines(raw: string): HandleResolution[] {
  const out: HandleResolution[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = parseRecord(parsed);
    if (record !== null) out.push(record);
  }
  return out;
}

function parseRecord(raw: unknown): HandleResolution | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const key = rec["key"];
  const id = rec["id"];
  const at = rec["at"];
  if (typeof key !== "string" || key.length === 0) return null;
  // `null` is a RECORD, not a missing field: it is the shadow a refusal leaves.
  if (id !== null && (typeof id !== "string" || id.length === 0)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const scope = rec["scope"];
  return {
    key,
    id,
    at,
    ...(typeof scope === "string" && scope.length > 0 ? { scope } : {}),
  };
}
