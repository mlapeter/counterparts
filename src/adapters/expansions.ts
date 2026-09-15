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
 * supplies only the translation — what the tool resolved that handle to — so the
 * boundary credits exactly what the session expanded and not one memory more. A
 * list of ids keyed by session would fail twice over: this host launches the MCP
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
 * the handle, a memory id, a timestamp, and the scope that resolved it —
 * deliberately no handle text, because a handle IS a memory's title and
 * `store/paths.ts` classifies `sessions/` as carrying no content (`backup:
 * false`). Hashing is what keeps that classification true without editing it.
 * Losing the whole file costs the credit for one handle expansion, which is the
 * under-credit direction, which is the direction this repo errs in on purpose.
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
  /** The id `expandHandle` actually reached. */
  readonly id: string;
  readonly at: number;
  /** The project the resolving server was serving. Forensics, not a filter —
   *  see `readHandleResolutions`. */
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
 * Record what a handle resolved to. Returns false on any failure at all.
 *
 * The CALLER decides whether there is anything to record — see
 * `mcp/server.ts#recallTool`, which writes only for an expansion that actually
 * happened (`path: "handle"`, `reason: "expanded"`), never for a handle that was
 * unknown, ambiguous, or withheld. A refusal resolved nothing, so there is
 * nothing to translate, so nothing may be credited.
 */
export function recordHandleResolution(
  dataDir: string,
  input: { handle: string; id: string; scope?: string; at?: number },
): boolean {
  const handle = input.handle.trim();
  if (handle.length === 0 || input.id.length === 0) return false;
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
    if (size + line.length > EXPANSIONS_MAX_BYTES) compact(path, record.at);
    appendFileSync(path, line, { encoding: "utf8", mode: 0o600 });
  } catch {
    return false;
  }
  return true;
}

/**
 * Every live resolution, newest answer winning, as `key → id`.
 *
 * NOT filtered by scope, on purpose. The resolution is deterministic — one
 * store, one exact-title match — so which project's server did the resolving
 * cannot change the answer, and a scope comparison that two adapters disagreed
 * about (a git worktree, a symlinked home) would silently reinstate the gap it
 * is here to close. `scope` is recorded so the log can still be read by a human
 * asking where a translation came from.
 */
export function readHandleResolutions(
  dataDir: string,
  opts: { now?: number; ttlMs?: number } = {},
): Map<string, string> {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? EXPANSION_TTL_MS;
  const out = new Map<string, string>();
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
    out.set(record.key, record.id);
  }
  return out;
}

/**
 * Translate the raw expansion strings from a transcript slice.
 *
 * A string the log knows becomes the id it resolved to; everything else passes
 * through UNCHANGED, so a handle nobody resolved still reaches `reference.ts` as
 * itself and still counts `unresolvedHandles`. A guess the tool answered
 * "not-found" must go on being a guess that credited nothing.
 *
 * Literal ids are looked up too, not skipped: `Store.resolve` follows forwarding
 * addresses, so a session that expanded a SUPERSEDED id by name read — and
 * should be credited for — the live head, which is what the tool recorded.
 */
export function translateExpansions(
  expansions: readonly string[],
  resolutions: ReadonlyMap<string, string>,
): string[] {
  if (resolutions.size === 0) return [...expansions];
  return expansions.map((raw) => resolutions.get(handleKey(raw)) ?? raw);
}

/** How many of `expansions` the log actually translated — the boundary row's
 *  `resolvedHandles`, and the one number that proves this seam live. */
export function countTranslated(
  expansions: readonly string[],
  resolutions: ReadonlyMap<string, string>,
): number {
  let n = 0;
  for (const raw of expansions) {
    const to = resolutions.get(handleKey(raw));
    if (to !== undefined && to !== raw.trim()) n += 1;
  }
  return n;
}

/**
 * Rewrite the file with the newest live resolutions and nothing else.
 *
 * Racing an append can lose the line that append was writing. That is accepted:
 * the loss is one handle's translation, the cost is under-credit, and the
 * alternative — a lock file two long-lived processes share — is a new failure
 * mode in the hot path of a tool that may not fail.
 */
function compact(path: string, now: number): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const live = new Map<string, HandleResolution>();
  for (const record of parseLines(raw)) {
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
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const scope = rec["scope"];
  return {
    key,
    id,
    at,
    ...(typeof scope === "string" && scope.length > 0 ? { scope } : {}),
  };
}
