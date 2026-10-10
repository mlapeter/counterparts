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
 *     time a hook takes, the store's busy timeout or a slow start-up cannot turn
 *     a twin into a second delivery, and no repeat is ever swallowed by a clock.
 *   - A holder that never says it finished (killed, crashed) holds for
 *     `CLAIM_WINDOW_MS` and no longer.
 *
 * FAIL-OPEN, ALWAYS. No session id, an observer, a claims file that will not
 * take the write: this process delivers. Two deliveries are a nuisance; none is
 * a session that woke up with no memory. A single wiring therefore behaves
 * exactly as before, at the cost of two small writes per event.
 *
 * WHY ONE WIRING CLAIMS TOO. A hook cannot know it has no twin: the claim is the
 * backstop for exactly the case where reading the host's wiring got it wrong
 * (2026-10-09), so it cannot be skipped on that same reading. What one wiring
 * pays is the two small writes, on a file nothing else writes.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { HOOK_CLAIM_LOST_EVENT } from "../../core/counterpart.js";
import { isLocked, openDb } from "../../core/store/db.js";
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
function updateClaims(dataDir: string, fn: (current: string | undefined) => string | undefined): void {
  const path = claimsPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
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
  try {
    updateClaims(doors.store.dir, (current) => {
      const claims = readClaims(current);
      const held = claims[key];
      // A TWIN: the same event, and this process began before the holder ended.
      if (held !== undefined && fresh(held) && (held.ended === undefined || started < held.ended)) {
        seen.heldBy = held.side;
        return undefined;
      }
      const kept = Object.entries(claims)
        .filter(([k, h]) => k !== key && fresh(h))
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, CLAIM_KEEP - 1);
      return writeClaims(Object.fromEntries([[key, { at: now, side: input.side, started }], ...kept]));
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return isLocked(err) ? { outcome: "unclaimed", detail, busy: true } : { outcome: "unclaimed", detail };
  }
  const winner = seen.heldBy;
  if (winner === null) return { outcome: "won", at: now };
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
  return { outcome: "lost", heldBy: winner };
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
