/**
 * ONE DELIVERY PER EVENT, HOWEVER MANY WIRINGS FIRE IT (2026-10-09).
 *
 * Claude Code runs every hook registered for an event — from settings and from
 * plugins alike — at the same moment, each handed the same input. When two
 * wirings of Counterparts are live (the npm install's hooks in settings and
 * the plugin's, or two settings files naming two builds), every event runs our
 * hook twice: two wakes at session start, two recall blocks per prompt, two
 * Stop asks, two boundaries, two background workers rewriting the wake bundle
 * at each other. The plugin is meant to stand down when it sees the npm wiring
 * (`adapters/plugin.ts#hookGate`), and on 2026-10-09 a plugin from an older
 * build did not recognise the newer `connect`'s hook line and didn't. That
 * reading is tolerant now (`host-wiring.ts#readOurHook`), and this is the
 * backstop for the next way it fails: the FIRST hook process to claim the
 * event does the event's whole job, and its twin exits with no output.
 *
 * THE CLAIM is one row of its OWN small database,
 * `sessions/claims/hook-claims.sqlite` (`claimsPath`), changed in one `BEGIN
 * IMMEDIATE` transaction: the second process waits and then reads what the
 * first wrote. The row holds only the claims of the last `CLAIM_WINDOW_MS` (at
 * most `CLAIM_KEEP` of them), so it never grows. Each of the claim's two writes
 * waits at most `CLAIM_WAIT_MS`.
 *
 * ITS OWN FILE, NOT THE STORE'S `meta` (2026-10-10). Until then the row lived in
 * `counterparts.sqlite`, so the claim waited on the store's one write lock, and
 * the store's busiest writer is the detached worker the previous Stop or
 * SessionEnd started: it reaches the store a bun start-up after its hook exits,
 * which is just when the NEXT hook reaches it. On a loaded machine its commits
 * held the lock for 300 to 600 ms at a time, past the claim's 500 ms, and the
 * claim gave up (`database is locked`) where the hook's other writes, which wait
 * five seconds, went through (CI on master a78e1dae; reproduced in a 2-CPU Linux
 * container). In this file the only writers are claims, each well under a
 * millisecond of work, so a claim waits on nothing but another claim, and a
 * store somebody holds costs it nothing at all. The file is host state, not
 * memory: inside `sessions/` (LAYOUT's entry says new state of that kind goes
 * there), never backed up, and nothing in it outlives the window. In a
 * directory of its own, as `log/` and `association/` are, because the sessions
 * prune removes any FILE directly in `sessions/` untouched for a week, and in
 * WAL a commit touches the log, not the database file.
 *
 * WHAT MAKES TWO PROCESSES TWINS — the same KEY, and running AT THE SAME TIME.
 *
 *   - THE KEY is what Claude Code hands every hook of one event identically: the
 *     session id, the event, and `prompt_id` (2.1.296: "UUID correlating a user
 *     prompt with all subsequent events until the next prompt"), with the prompt
 *     text (UserPromptSubmit), `source` (SessionStart), `stop_hook_active` and
 *     the last assistant message (Stop), `reason` (SessionEnd) and `trigger`
 *     (PreCompact) folded in. Text is hashed; the key is a hash, and nothing of
 *     the prompt is stored. The transcript's size is NOT in it: the host may
 *     write between the twins starting, and a key that differs between twins is
 *     no claim at all.
 *   - AT THE SAME TIME: the host starts the twins together, so each began before
 *     the other could have finished. The winner records when its process started
 *     and, as it exits, when it finished; a process with the same key that
 *     STARTED BEFORE THE HOLDER FINISHED (or while it is still running) is its
 *     twin. A process that started after the holder finished is a separate event
 *     that happens to look the same — a host with no `prompt_id` sending the same
 *     words twice, a session resumed twice in a row — and it delivers. So the
 *     time a hook takes or the store's busy timeout cannot turn a twin into a
 *     second delivery, and no repeat is ever swallowed by a clock. A slow
 *     START-UP can, and did (2026-10-10, measured under load: a twin's runtime
 *     came up 45 ms after the winner finished, and the session got two wakes).
 *     So an event the host sends ONCE per key (`firesOnce`: a session's first
 *     start, a prompt with its id) is a twin whenever it started; the rest keep
 *     the start-time rule, and there the claim is a backstop that a very late
 *     twin can still pass.
 *   - A holder that never says it finished (killed, crashed) holds for
 *     `CLAIM_WINDOW_MS` and no longer.
 *
 * FAIL-OPEN, ALWAYS. No session id, an observer, a claims file that will not
 * take the write: this process delivers. Two deliveries are a nuisance; none is
 * a session that woke up with no memory. A single wiring therefore behaves
 * exactly as before, at the cost of two small writes per event.
 *
 * A CLAIMS FILE THAT IS NOT A DATABASE IS SET ASIDE AND REBUILT, ONCE (review of
 * #359, 2026-10-10). Before, a corrupt or foreign file was a lasting fault: a
 * stderr line on every event, and the backstop off until somebody deleted it.
 * Now the write that meets one (`isUnreadableDatabase`) moves it — with its
 * `-wal` and `-shm`, so a stale log is never replayed into the new file — to
 * `hook-claims.unreadable-<epoch ms>.sqlite` beside it, keeping only the newest
 * such copy, and tries once more on a fresh file. The copy is the durable trace:
 * doctor's `Hook claims` line reads it (`claimsSetAside`). Nothing in the file
 * outlives the window, so nothing is lost but the claims of the last 15 s. The
 * event is delivered whatever happens.
 *
 * PRIVATE, AS `log/` IS: the directory is made 0700 and the file 0600 (SQLite
 * gives its `-wal` and `-shm` the database file's mode).
 *
 * WHY ONE WIRING CLAIMS TOO. A hook cannot know it has no twin: the claim is the
 * backstop for exactly the case where reading the host's wiring got it wrong
 * (2026-10-09), so it cannot be skipped on that same reading. What one wiring
 * pays is the two small writes, on a file nothing else writes.
 */
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { HOOK_CLAIM_LOST_EVENT } from "../../core/counterpart.js";
import { isLocked, isUnreadableDatabase, openDb } from "../../core/store/db.js";
import { sessionsDir } from "../sessions.js";
import type { HookName } from "./hooks.js";

/** The claims' own directory and database, inside the store's `sessions/`. */
export const CLAIMS_DIR = "claims";
export const CLAIMS_FILE = "hook-claims.sqlite";
/** The one row in it holding the recent claims (the key it had in `meta`). */
export const CLAIMS_ROW = "adapter.hook.claims";
/** How long a claim is kept, and the longest an unfinished one holds. */
export const CLAIM_WINDOW_MS = 15_000;
/** The most claims the row keeps, newest first — a bound on its size if a
 *  clock jumps or a burst of sessions fires at once. */
export const CLAIM_KEEP = 64;
/** How long each of the claim's two writes waits on another claim before it
 *  gives up (and the hook delivers). A twin outwaits its holder's claim — well
 *  under a millisecond of work — many times over. Only claims write the file,
 *  so the store's own writers (the worker, the MCP server, the CLI) never
 *  count against it. */
export const CLAIM_WAIT_MS = 500;

/** Where the claims live, for a store at `dataDir`. */
export function claimsPath(dataDir: string): string {
  return join(sessionsDir(dataDir), CLAIMS_DIR, CLAIMS_FILE);
}

const CLAIMS_DDL = "CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

/**
 * READ, CHANGE AND WRITE THE CLAIMS ROW IN ONE `BEGIN IMMEDIATE`, on the claims
 * file's own connection, opened for this one write and closed after it. `fn`
 * gets the row as it stands inside the transaction and returns the new value,
 * or `undefined` to leave it. Throws what SQLite or the file system throws.
 *
 * Opened as the store is (`openDb`, WAL), then: wait `CLAIM_WAIT_MS`, not the
 * store's five seconds; `synchronous = NORMAL`, not the store's FULL, because
 * nothing here outlives `CLAIM_WINDOW_MS`, so a commit a power cut takes back
 * costs nothing, and in WAL NORMAL never corrupts the file. The two writes of
 * an event, measured in a 2-CPU Linux container (2026-10-10): 3-4 ms with the
 * rollback journal and FULL, about 1 ms with WAL and FULL (an fsync per commit),
 * 0.2 ms with WAL and NORMAL. The log is folded
 * every 100 pages rather than SQLite's 1000, so it stays under half a megabyte
 * beside a row of a few kilobytes.
 */
function updateClaims(dataDir: string, fn: (current: string | undefined) => string | undefined): { readonly setAside: string | null } {
  const path = claimsPath(dataDir);
  try {
    transactClaims(path, fn);
    return { setAside: null };
  } catch (err) {
    if (!isUnreadableDatabase(err) && !movedWhileOpen(err)) throw err;
    // A twin that met the same file may have set it aside and rebuilt it in
    // the meantime (and on macOS a connection whose file it moved says
    // SQLITE_IOERR_VNODE); then this one only tries again, on the file the
    // twin made, and loses to the twin's claim there rather than delivering
    // beside it.
    const setAside = isUnreadableDatabase(err) && stillUnreadable(path) ? setClaimsAside(path) : null;
    transactClaims(path, fn);
    return { setAside };
  }
}

/** The prefix and suffix of a claims file set aside as unreadable, beside the live one. */
export const CLAIMS_SET_ASIDE_PREFIX = "hook-claims.unreadable-";
const CLAIMS_SET_ASIDE_SUFFIX = ".sqlite";

/** True when the file at `path` still cannot be read as a database (it may
 *  have been set aside and rebuilt by a twin since this process met it). */
function stillUnreadable(path: string): boolean {
  try {
    const db = openDb(path, { wal: true });
    try {
      db.get("SELECT count(*) AS n FROM sqlite_master");
    } finally {
      db.close();
    }
    return false;
  } catch (err) {
    return isUnreadableDatabase(err);
  }
}

/**
 * Move the unreadable claims file aside, with its `-wal` and `-shm` (a stale
 * log replayed into a new file would be the corruption all over again), to
 * `hook-claims.unreadable-<epoch ms>.sqlite`, then remove any older copy: one
 * is kept, so it is evidence and never a pile. Returns the copy's path, or
 * null when the file is already gone — a twin moved it first, and its copy
 * is the one kept (review of #366: removing older copies BEFORE the move let
 * the twin that lost the move delete the copy the winner had just made).
 * Throws when the file is there and cannot be moved.
 */
function setClaimsAside(path: string, now: number = Date.now()): string | null {
  const dir = dirname(path);
  const name = `${CLAIMS_SET_ASIDE_PREFIX}${String(now)}${CLAIMS_SET_ASIDE_SUFFIX}`;
  const aside = join(dir, name);
  try {
    renameSync(path, aside);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "ENOENT") return null;
    throw err;
  }
  for (const sidecar of ["-wal", "-shm"]) {
    try {
      renameSync(`${path}${sidecar}`, `${aside}${sidecar}`);
    } catch {
      /* not there: nothing to carry */
    }
  }
  for (const other of readdirSync(dir)) {
    if (other.startsWith(CLAIMS_SET_ASIDE_PREFIX) && !other.startsWith(name)) rmSync(join(dir, other), { force: true });
  }
  return aside;
}

/** SQLITE_IOERR_VNODE (macOS): the file this connection opened was renamed or
 *  removed while it was open — here, only ever by a twin's `setClaimsAside`.
 *  bun names it in `code`; `node:sqlite` gives the extended number. */
function movedWhileOpen(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown } | null | undefined;
  return e?.code === "SQLITE_IOERR_VNODE" || e?.errcode === 6922;
}

/**
 * THE TRACE DOCTOR READS: the claims file set aside as unreadable, if one is
 * there — its file name and when it was set aside (from the name). Null when
 * none is, or the directory cannot be read. Never throws.
 */
export function claimsSetAside(dataDir: string): { readonly name: string; readonly at: number } | null {
  let names: string[];
  try {
    names = readdirSync(dirname(claimsPath(dataDir)));
  } catch {
    return null;
  }
  let newest: { name: string; at: number } | null = null;
  for (const name of names) {
    if (!name.startsWith(CLAIMS_SET_ASIDE_PREFIX) || !name.endsWith(CLAIMS_SET_ASIDE_SUFFIX)) continue;
    const at = Number(name.slice(CLAIMS_SET_ASIDE_PREFIX.length, -CLAIMS_SET_ASIDE_SUFFIX.length));
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > newest.at) newest = { name, at };
  }
  return newest;
}

/** The one transaction, on a connection opened for it and closed after it. */
function transactClaims(path: string, fn: (current: string | undefined) => string | undefined): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Made 0600 before SQLite makes it 0644; its `-wal` and `-shm` take this mode.
  // A twin may make it first, and anything else wrong surfaces at the open.
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch {
    /* there already, or the open below says why not */
  }
  const db = openDb(path, { wal: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${String(CLAIM_WAIT_MS)}`);
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA wal_autocheckpoint = 100");
    db.exec(CLAIMS_DDL);
    db.transaction(() => {
      const row = db.get<{ value: string }>("SELECT value FROM claims WHERE key = ?", CLAIMS_ROW);
      const next = fn(row?.value);
      if (next !== undefined) db.run("INSERT OR REPLACE INTO claims (key, value) VALUES (?, ?)", CLAIMS_ROW, next);
    });
  } finally {
    db.close();
  }
}

/** Which side of the doubled wiring a hook process is, for the record. */
export type ClaimSide = "plugin" | "settings";

/** The outcome: `won` delivers, `lost` exits quietly, `unclaimed` delivers
 *  because no claim could be made (no session, an observer, a failed write). */
export type ClaimOutcome = "won" | "lost" | "unclaimed";

function text(payload: Record<string, unknown>, field: string): string {
  const v = payload[field];
  return typeof v === "string" ? v : "";
}

function digest(value: string): string {
  return value.length === 0 ? "" : createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * The claim key for this event, from the input Claude Code gave the hook; null
 * when there is no session id to claim under. Pure.
 */
export function deliveryClaimKey(name: HookName, payload: Record<string, unknown>): string | null {
  const session = text(payload, "session_id");
  if (session.length === 0) return null;
  const parts = [
    session,
    name,
    text(payload, "prompt_id"),
    text(payload, "agent_id"),
    text(payload, "source"),
    payload["stop_hook_active"] === true ? "re-fired" : "",
    digest(text(payload, "prompt")),
    digest(text(payload, "last_assistant_message")),
    text(payload, "reason"),
    text(payload, "trigger"),
    digest(text(payload, "custom_instructions")),
  ];
  return digest(JSON.stringify(parts));
}

/**
 * DOES THE HOST SEND THIS EVENT ONCE PER KEY? (2026-10-10, the 0.3.15 release
 * check.) A SessionStart that opens a session id — `startup`, `clear`, `fork`,
 * each a new id — and a prompt carrying its `prompt_id`, one per prompt, are
 * never sent twice. So for these a same-key process inside the window is the
 * holder's twin WHENEVER it started. Measured: with two settings wirings on a
 * machine loaded by the suite, the second hook's runtime came up 45 ms after
 * the first had finished its SessionStart, the start-time rule read a new
 * event, and the session got two wakes (1 session of 6; 5 of 5 were single on
 * a quiet machine). `resume`, `compact`, a Stop, SessionEnd, PreCompact and a
 * prompt with no id can legitimately repeat with the same key, so they keep the
 * start-time rule, and for them a twin that starts late still delivers: the
 * plugin's stand-down (`plugin.ts#hookGate`) is the main guard, the claim a
 * backstop. Pure.
 */
export function firesOnce(name: HookName, payload: Record<string, unknown>): boolean {
  if (name === "session-start") return ["startup", "clear", "fork"].includes(text(payload, "source"));
  if (name === "user-prompt-submit") return text(payload, "prompt_id").length > 0;
  return false;
}

/** One held claim: when it was made, by which side, when its process started,
 *  and when it finished (absent while it runs). */
interface Held {
  readonly at: number;
  readonly side: string;
  readonly started: number;
  readonly ended?: number;
}

function readClaims(raw: string | undefined): Record<string, Held> {
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, Held> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v) || typeof v[0] !== "number" || !Number.isFinite(v[0])) continue;
      const at = v[0];
      const started = typeof v[2] === "number" && Number.isFinite(v[2]) ? v[2] : at;
      const ended = typeof v[3] === "number" && Number.isFinite(v[3]) ? v[3] : undefined;
      out[k] = { at, side: typeof v[1] === "string" ? v[1] : "", started, ...(ended === undefined ? {} : { ended }) };
    }
    return out;
  } catch {
    return {};
  }
}

function writeClaims(claims: Record<string, Held>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(claims).map(([k, h]) => [k, h.ended === undefined ? [h.at, h.side, h.started] : [h.at, h.side, h.started, h.ended]]),
    ),
  );
}

/** What a claim needs of the counterpart: the store's directory, under which
 *  the claims file lives, and the durable event log a loss is recorded in.
 *  Structural, so a test can hand it a directory no file can be made under. */
export interface ClaimDoors {
  readonly store: { readonly dir: string };
  noteAdapterEvent(name: typeof HOOK_CLAIM_LOST_EVENT, data: Record<string, unknown>): boolean;
}

export interface ClaimInput {
  readonly hook: HookName;
  readonly key: string | null;
  readonly sessionId: string;
  readonly side: ClaimSide;
  /** Under observer nothing is written, so nothing is claimed. */
  readonly observer: boolean;
  /** When this process started (epoch ms); `performance.timeOrigin` by default. */
  readonly started?: number;
  /** The host sends this event once per key (`firesOnce`): a same-key claim in
   *  the window is a twin whenever this process started. */
  readonly once?: boolean;
  readonly now?: number;
}

export interface Claim {
  readonly outcome: ClaimOutcome;
  /** The winner's claim time, which `finishClaim` names. */
  readonly at?: number;
  /** The side that holds the claim, when this process lost it. */
  readonly heldBy?: string;
  /** Why nothing was claimed. */
  readonly detail?: string;
  /** Set when the claim could not be written because another claim held the
   *  file past `CLAIM_WAIT_MS`: contention, which passes, not a fault. */
  readonly busy?: boolean;
  /** Why nothing was claimed, as a code the process log may write as itself
   *  (`SQLITE_BUSY`, `SQLITE_NOTADB`, `ENOTDIR`, …), where `detail` is a sentence. */
  readonly code?: string;
  /** The copy an unreadable claims file was moved to before this claim was
   *  made on a fresh one (`setClaimsAside`). */
  readonly setAside?: string;
}

/**
 * An error as a code the process log writes as itself: the driver's or the
 * file system's own (`SQLITE_NOTADB`, `EACCES`); `node:sqlite`'s number as
 * `SQLITE_<n>`; else the error's class. Never its message.
 */
function codeOf(err: unknown): string {
  const e = err as { code?: unknown; errcode?: unknown; name?: unknown } | null | undefined;
  if (typeof e?.errcode === "number") return `SQLITE_${String(e.errcode)}`;
  if (typeof e?.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.code)) return e.code;
  return typeof e?.name === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : "unknown";
}

/**
 * Claim this event for this process, or learn that its twin already has. A
 * loss is recorded (`adapter.hook.claim.lost`, prunable telemetry). Never
 * throws.
 */
export function claimDelivery(doors: ClaimDoors, input: ClaimInput): Claim {
  if (input.key === null) return { outcome: "unclaimed", detail: "no session id" };
  if (input.observer) return { outcome: "unclaimed", detail: "observer" };
  const key = input.key;
  const now = input.now ?? Date.now();
  const started = input.started ?? performance.timeOrigin;
  const fresh = (h: Held): boolean => Math.abs(now - Math.max(h.at, h.ended ?? h.at)) < CLAIM_WINDOW_MS;
  // Written inside the transaction's callback, read after it.
  const seen: { heldBy: string | null } = { heldBy: null };
  let setAside: string | null = null;
  try {
    ({ setAside } = updateClaims(doors.store.dir, (current) => {
      // Reset: the callback runs again on a rebuilt file (`updateClaims`).
      seen.heldBy = null;
      const claims = readClaims(current);
      const held = claims[key];
      // A TWIN: the same event, and this process began before the holder ended
      // — or the host sends this event only once, so any same-key process in
      // the window is one, however late its runtime came up (`firesOnce`).
      if (held !== undefined && fresh(held) && (input.once === true || held.ended === undefined || started < held.ended)) {
        seen.heldBy = held.side;
        return undefined;
      }
      const kept = Object.entries(claims)
        .filter(([k, h]) => k !== key && fresh(h))
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, CLAIM_KEEP - 1);
      return writeClaims(Object.fromEntries([[key, { at: now, side: input.side, started }], ...kept]));
    }));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code = codeOf(err);
    return isLocked(err) ? { outcome: "unclaimed", detail, code, busy: true } : { outcome: "unclaimed", detail, code };
  }
  const rebuilt = setAside === null ? {} : { setAside };
  const winner = seen.heldBy;
  if (winner === null) return { outcome: "won", at: now, ...rebuilt };
  try {
    doors.noteAdapterEvent(HOOK_CLAIM_LOST_EVENT, {
      hook: input.hook,
      session: input.sessionId,
      lost: input.side,
      won: winner.length === 0 ? null : winner,
    });
  } catch {
    // The row is the record, not the decision: the twin still stands down.
  }
  return { outcome: "lost", heldBy: winner, ...rebuilt };
}

/**
 * THE WINNER IS DONE: stamp its claim with the time it finished, so a later
 * process with the same key — one that started after this — is read as the
 * separate event it is. Only this process's own claim (same key, same `at`) is
 * touched. Never throws: a stamp that does not land leaves the claim to expire.
 */
export function finishClaim(doors: Pick<ClaimDoors, "store">, key: string, at: number, now: number = Date.now()): boolean {
  let stamped = false;
  try {
    updateClaims(doors.store.dir, (current) => {
      stamped = false;
      const claims = readClaims(current);
      const held = claims[key];
      if (held === undefined || held.at !== at) return undefined;
      claims[key] = { ...held, ended: now };
      stamped = true;
      return writeClaims(claims);
    });
  } catch {
    return false;
  }
  return stamped;
}
