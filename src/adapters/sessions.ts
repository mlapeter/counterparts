/**
 * The live-session registry — host state, shared by the adapters that need it.
 *
 * **Why it exists.** Measured 2026-09-04 on the live host: Claude Code registers
 * an MCP server from a STATIC configuration (command, args, env), so
 * `mcp/bin/serve.ts` never receives `--session`. Every `session_end` call was
 * therefore refused `no-bound-session` and no session's dump ever landed — the
 * authored front door was shut for the whole run while the ask kept going out.
 * The hooks DO know the session id (the host hands it to every hook); the server
 * does not. This file is the note the hooks leave where the server can read it.
 *
 * **It is host state, never memory** (constitution 5). It carries no content: an
 * id, a scope, three timestamps, and a few marks about what this session's hooks
 * have already done — which configuration they read, whether the first-launch
 * question went out, the wake's sentinel of counts and whether its arrival has
 * been checked. Losing the whole directory costs a lazy bind and nothing else,
 * which is why `store/paths.ts` classifies it `backup: false`.
 *
 * **Where it lives.** `<dataDir>/sessions/<id>.json`, because the data dir is the
 * one path both sides already agree on — the hooks resolve it in
 * `claude-code/bin/hook.ts`, the server in `Counterpart.open`.
 *
 * **Neither adapter imports the other.** `mcp/INTERFACE-GAPS.md` §7 keeps
 * adapters as leaves; a sibling module both may import is the shape that rule
 * allows, and it is the reason this file sits beside them rather than inside
 * `claude-code/`.
 *
 * Three rules the code below mechanizes:
 *
 *   1. **Nothing here ever throws at a caller.** A hook may not fail the host
 *      (`claude-code/CONTRACT.md` §5 G2) and a tool may not fail on host trivia.
 *      Every entry point returns `null` on any failure.
 *   2. **A session id is a FILENAME, and the MCP path takes it from a model.**
 *      `isSessionId` is the whole gate: one path segment of `[A-Za-z0-9._-]`,
 *      never `.` or `..`. An id that fails it is not looked up at all.
 *   3. **Writes are atomic** — a temp file beside the target, then `rename`,
 *      so a reader never sees half a record. Same directory, so same
 *      filesystem, so the rename is a rename.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** The one directory name. Classified in `store/paths.ts` LAYOUT. */
export const SESSIONS_DIR = "sessions";

/**
 * **CAL.** How long after its last boundary a session may still be claimed.
 *
 * Every Stop refreshes `lastBoundaryAt`, and the Stop ask is delivered AT
 * a Stop — so this window never has to cover an ordinary session's length, only
 * the gap between an ask and the answer. Four hours is well past any plausible
 * think-time (a session left open over lunch still binds) and comfortably short
 * of a day, so a session that died last night cannot be claimed into today's
 * memory by a server that outlived it.
 */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * **CAL.** How long a record survives at all. Pruned on SessionStart, which is
 * once per session rather than once per turn. A week keeps the run's own
 * forensics readable (constitution 16) while bounding the directory: the files
 * are ~150 bytes and a busy week is a few hundred of them.
 */
export const SESSION_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionPhase = "start" | "boundary" | "end";

export interface SessionRecord {
  readonly sessionId: string;
  /** The project directory the session runs in — the hook's own cwd, resolved. */
  readonly scope: string;
  readonly startedAt: number;
  /** Refreshed at every boundary. Liveness is measured from HERE, not from start. */
  readonly lastBoundaryAt: number;
  /** Set once, by SessionEnd. A record with an end is never live again. */
  readonly endedAt: number | null;
  /**
   * The `claude-code.json` the HOOK that wrote this record read — absolute, and
   * present only when the hook was told (`claude-code/bin/hook.ts` resolves it
   * through `adapters/config-path.ts` and passes it in).
   *
   * It is here because a hook has no way to TELL anyone: its stdout is the
   * model's context and its stderr is a host log nobody reads. "Which config did
   * that hook use" was, until 2026-09-05, unanswerable after the fact — and it
   * is the question behind every "why is my memory empty" on a machine with more
   * than one configuration. Still host state, still no content: a path, beside
   * the id, the scope and the three timestamps.
   */
  readonly config?: string;
  /**
   * TRUE once this session has been asked the first-launch scope question
   * (G41). Set by the SessionStart hook at the moment it puts the block into
   * the model's context, and carried forward like `config`.
   *
   * It is here rather than in the scope registry because it is a fact about ONE
   * SESSION, not about the directory: the registry stays `unset` until somebody
   * answers, and asking twice in a session that resumed or compacted is the
   * thing this flag exists to stop. Still host state, still no content.
   */
  readonly askedScope?: boolean;
  /**
   * THE TAIL SENTINEL THE WAKE WAS PRINTED WITH — the expectation the delivery
   * check compares what arrived against, written by SessionStart at the moment
   * it hands the bundle to the host.
   *
   * It is here because the check runs in a DIFFERENT PROCESS. Every hook is its
   * own process; the expectation used to live in a `Map` on the adapter
   * instance, so the hook that was meant to test it always met an empty one and
   * `adapter.wake.delivered` never wrote a row in two weeks of running.
   *
   * Absent means no checkable wake was printed for this session — a cold start
   * whose bundle is the bootstrap line, or a session whose SessionStart stood
   * down — which is how "nothing was supposed to arrive" is told apart from "it
   * was lost". Still host state, still no content: the sentinel is an HTML
   * comment of counts (`<!-- counterparts:wake/end day=190 identity=3 … -->`),
   * the same numbers the durable row carries.
   */
  readonly wakeSentinel?: string;
  /**
   * TRUE once the delivery check has run for this session. It runs at the first
   * `UserPromptSubmit` and leaves one durable row; this is what keeps it from
   * re-reading the transcript on every turn afterwards. One-way, like
   * `askedScope`.
   */
  readonly wakeChecked?: boolean;
  /**
   * THE DATE THIS SESSION WAS ASKED TO WRITE ITS PAGE ABOUT (2026-09-20, S2),
   * `YYYY-MM-DD`, in the fallback `session` mode of the nightly page writer.
   *
   * It does two jobs, and the second is why it is here rather than only in the
   * store's event log:
   *
   *   - it stops the same session being asked twice, exactly as `askedScope`
   *     does for the first-launch question;
   *   - it is what lets the MCP server write `by: "writer"` rather than
   *     `by: "session"` on the revision that comes back. `by` is the DOOR's and
   *     is not claimable from outside (`self/page.ts`), so the server may not
   *     take the model's word for which door it came through — it reads this
   *     mark, which only the SessionStart hook writes, and which names a date
   *     rather than a boolean so a stale mark cannot re-label tomorrow's write.
   *
   * Still host state, still no content: one date beside the id and the scope.
   */
  readonly pageWriterFor?: string;
  /**
   * WHEN THIS SESSION LAST ANSWERED THE STOP ASK WITH "NOTHING NEW" (B1,
   * 2026-09-23) — epoch ms, written by the MCP server when `session_end` arrives
   * with `memories: []` and no handoff.
   *
   * "Nothing worth keeping is a real answer", and until now the only trace an
   * answer left was what it minted, so an honest empty answer and no answer at
   * all were the same silence. This is the difference, kept where the next
   * reader of "did this session answer its ask" will look: the owed-a-write-up
   * predicate (roadmap B3/C2) reads it beside the memories and chapters a
   * session wrote. The time rather than a flag, so it can be compared with the
   * ask it answered (`adapter.ask` rows are stamped). Newest wins.
   *
   * It does NOT touch pacing. The pacer advances at ASK time
   * (`self/index.ts#openChapter` commits `askedAtTurns`/`askedAtBytes` before
   * the ask blocks), so an answer of any kind — this one included — can never
   * cause an immediate re-ask; it only has to be recorded.
   *
   * Still host state, still no content: a number.
   */
  readonly nothingNewAt?: number;
}

/**
 * One path segment, and nothing that could climb out of it. This host's ids are
 * UUIDs; the check is deliberately narrower than "no slashes" because the MCP
 * server passes a MODEL-SUPPLIED string straight into it.
 */
export function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

/**
 * THE OTHER HALF OF `pageWriterFor`, for a session that has no record to carry
 * it: the date a WINDOWLESS nightly writer is writing about, pinned onto its
 * environment by the launcher (`claude-code/page-writer.ts`).
 *
 * It lives beside the record's field rather than in the launcher, because the
 * two are one mechanism read from two directions — the MCP server asks "is this
 * the night's writer" and must not have to know which mode started it — and
 * because a name read in one adapter and written in another is exactly the pair
 * that drifts when it is spelled twice.
 */
export const PAGE_WRITER_ENV = "COUNTERPARTS_PAGE_WRITER";

export function sessionsDir(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR);
}

export function sessionPath(dataDir: string, sessionId: string): string | null {
  if (!isSessionId(sessionId)) return null;
  return join(sessionsDir(dataDir), `${sessionId}.json`);
}

/**
 * The physical path, for comparison. macOS reports `/private/tmp` from
 * `getcwd()` while `os.tmpdir()` says `/tmp`, and a scope comparison that got
 * that wrong would refuse every bind on this host. `realpath` first; `resolve`
 * when the path does not exist (a scope may name a directory this process
 * cannot see).
 */
export function canonicalScope(scope: string): string {
  try {
    return realpathSync(resolve(scope));
  } catch {
    return resolve(scope);
  }
}

/** Same directory, whatever each side's symlinks call it. */
export function sameScope(a: string, b: string): boolean {
  return canonicalScope(a) === canonicalScope(b);
}

/** Not ended, and its last boundary is inside the window. */
export function isLive(
  record: SessionRecord,
  now: number,
  ttlMs: number = SESSION_TTL_MS,
): boolean {
  if (record.endedAt !== null) return false;
  return now - record.lastBoundaryAt <= ttlMs;
}

export function readSession(dataDir: string, sessionId: string): SessionRecord | null {
  const path = sessionPath(dataDir, sessionId);
  if (path === null) return null;
  try {
    return parseRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Absent, unreadable, or half-written by a host that died mid-rename: all
    // three mean "no live session by that name", which is a refusal upstream.
    return null;
  }
}

/**
 * Record the session at one of its three moments. Returns the record as written,
 * or `null` if anything at all went wrong.
 *
 * The phases are not symmetric, and the asymmetry is the point:
 *
 *   - **`start` owns the scope.** It is the only phase that sets it, so a hook
 *     firing from a git worktree cannot rewrite the scope the server matched
 *     against halfway through a session.
 *   - **`boundary` creates if missing.** Sessions already running when this
 *     ships never saw a SessionStart write; requiring one would leave every
 *     live session unbindable until the owner restarted it.
 *   - **`end` is one-way.** A later boundary refreshes the clock but never
 *     clears `endedAt`: a session the host closed does not come back.
 */
export function recordSession(
  dataDir: string,
  input: {
    sessionId: string;
    scope: string;
    phase: SessionPhase;
    at?: number;
    /** The configuration the writing hook read. Carried forward when a later
     *  phase is written by a process that was told nothing. */
    config?: string;
    /** Set once, when the first-launch scope question is delivered (G41).
     *  Carried forward the same way, and never cleared by a later phase. */
    askedScope?: boolean;
    /** The sentinel the wake was printed with, written by SessionStart.
     *  Carried forward like `config`: the newest answer wins. */
    wakeSentinel?: string;
    /** Set once, when the delivery check has left its row. One-way. */
    wakeChecked?: boolean;
    /** The date the nightly page writer asked this session to write about
     *  (S2). Carried forward like `config`; the newest answer wins. */
    pageWriterFor?: string;
    /** When `session_end` last answered "nothing new" (B1). Carried forward
     *  like `config`; the newest answer wins. */
    nothingNewAt?: number;
  },
): SessionRecord | null {
  if (!isSessionId(input.sessionId)) return null;
  const path = sessionPath(dataDir, input.sessionId);
  if (path === null) return null;
  const now = input.at ?? Date.now();
  const prior = readSession(dataDir, input.sessionId);

  const record: SessionRecord = {
    sessionId: input.sessionId,
    scope:
      prior === null || input.phase === "start" ? canonicalScope(input.scope) : prior.scope,
    startedAt: prior?.startedAt ?? now,
    lastBoundaryAt: now,
    endedAt:
      input.phase === "end" ? now : input.phase === "start" ? null : (prior?.endedAt ?? null),
    // The record is REWRITTEN whole at every phase, so a field only SessionStart
    // knew would vanish at the first Stop. This one is carried: the newest
    // answer wins, and a phase written by a process that was told nothing keeps
    // what the last one said.
    ...(input.config !== undefined && input.config.length > 0
      ? { config: input.config }
      : prior?.config !== undefined
        ? { config: prior.config }
        : {}),
    // ONE-WAY, like `endedAt`: a session that has been asked has been asked,
    // and a later phase written by a process that knows nothing about the
    // question must not un-ask it.
    ...(input.askedScope === true || prior?.askedScope === true ? { askedScope: true } : {}),
    // Carried like `config` — newest answer wins — because a SessionStart that
    // fires again inside one session (a compaction) renders a new bundle, and
    // the expectation the next check tests has to be the one last printed.
    ...(input.wakeSentinel !== undefined && input.wakeSentinel.length > 0
      ? { wakeSentinel: input.wakeSentinel }
      : prior?.wakeSentinel !== undefined
        ? { wakeSentinel: prior.wakeSentinel }
        : {}),
    // One-way, like `askedScope`: a session that has been checked has been
    // checked, and the flag is what stops the transcript being re-read at every
    // turn for the rest of the session.
    ...(input.wakeChecked === true || prior?.wakeChecked === true ? { wakeChecked: true } : {}),
    // Carried like `config` rather than one-way, because it names a DATE: a
    // session that lives across midnight and is asked again gets the new date,
    // and a phase written by a process that knows nothing about the writer
    // keeps the one already there.
    ...(input.pageWriterFor !== undefined && input.pageWriterFor.length > 0
      ? { pageWriterFor: input.pageWriterFor }
      : prior?.pageWriterFor !== undefined
        ? { pageWriterFor: prior.pageWriterFor }
        : {}),
    // Carried like `config`, and it MUST be: every Stop rewrites this record
    // whole, and the Stop right after an answer is the host's re-fire, so a
    // field the hook did not know to carry would be erased within the second.
    ...(input.nothingNewAt !== undefined && Number.isFinite(input.nothingNewAt)
      ? { nothingNewAt: input.nothingNewAt }
      : prior?.nothingNewAt !== undefined
        ? { nothingNewAt: prior.nothingNewAt }
        : {}),
  };

  return writeRecord(dataDir, path, record);
}

/** The atomic write both writers share: a temp sibling, then `rename`. */
function writeRecord(dataDir: string, path: string, record: SessionRecord): SessionRecord | null {
  try {
    mkdirSync(sessionsDir(dataDir), { recursive: true });
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    return null;
  }
  return record;
}

/**
 * MARK A "NOTHING NEW" ANSWER on a session that is already recorded (B1).
 *
 * The one write into this registry that is not a hook's, and deliberately
 * narrower than `recordSession`: it is not a phase, so it moves no clock — an
 * answer is not a boundary, and `lastBoundaryAt` is what liveness is measured
 * from. It never creates a record either: the MCP server only accepts a
 * `session_end` for a session the hooks recorded, so a missing one is a race
 * with pruning, and the honest answer is `null`, not a record with no start.
 */
export function markNothingNew(dataDir: string, sessionId: string, at: number = Date.now()): SessionRecord | null {
  const path = sessionPath(dataDir, sessionId);
  if (path === null || !Number.isFinite(at)) return null;
  const prior = readSession(dataDir, sessionId);
  if (prior === null) return null;
  return writeRecord(dataDir, path, { ...prior, nothingNewAt: at });
}

/**
 * Drop records nobody can claim any more. Called from SessionStart only — one
 * `readdir` per session, never per turn, and never on the SessionEnd path that
 * shares a 1.5 s budget with every other hook on that event.
 */
export function pruneSessions(
  dataDir: string,
  now: number = Date.now(),
  maxAgeMs: number = SESSION_PRUNE_MS,
): number {
  let removed = 0;
  try {
    for (const name of readdirSync(sessionsDir(dataDir))) {
      const full = join(sessionsDir(dataDir), name);
      try {
        if (now - statSync(full).mtimeMs <= maxAgeMs) continue;
        rmSync(full, { force: true });
        removed += 1;
      } catch {
        continue;
      }
    }
  } catch {
    return removed;
  }
  return removed;
}

function parseRecord(raw: unknown): SessionRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const sessionId = rec["sessionId"];
  const scope = rec["scope"];
  const startedAt = rec["startedAt"];
  const lastBoundaryAt = rec["lastBoundaryAt"];
  const endedAt = rec["endedAt"] ?? null;
  if (!isSessionId(sessionId)) return null;
  if (typeof scope !== "string" || scope.length === 0) return null;
  if (typeof startedAt !== "number" || typeof lastBoundaryAt !== "number") return null;
  if (endedAt !== null && typeof endedAt !== "number") return null;
  // Optional, and never a reason to reject a record: every record written before
  // 2026-09-05 lacks it, and a registry that refused those would refuse every
  // live session on the owner's host at the moment this ships.
  const config = rec["config"];
  return {
    sessionId,
    scope,
    startedAt,
    lastBoundaryAt,
    endedAt,
    ...(typeof config === "string" && config.length > 0 ? { config } : {}),
    // Optional for the same reason `config` is: every record written before
    // 2026-09-10 lacks it, and "not asked" is exactly what its absence means.
    ...(rec["askedScope"] === true ? { askedScope: true } : {}),
    // Optional for the same reason again, and its absence is a real answer:
    // "no checkable wake was printed for this session".
    ...(typeof rec["wakeSentinel"] === "string" && rec["wakeSentinel"].length > 0
      ? { wakeSentinel: rec["wakeSentinel"] }
      : {}),
    ...(rec["wakeChecked"] === true ? { wakeChecked: true } : {}),
    // Optional for the same reason, and read as a DATE rather than a flag: a
    // value that is not a date is no mark at all, so a hand-edited record
    // cannot talk the MCP server into writing `by: "writer"`.
    ...(typeof rec["pageWriterFor"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec["pageWriterFor"])
      ? { pageWriterFor: rec["pageWriterFor"] }
      : {}),
    // Optional for the same reason; a value that is not a finite number is no
    // mark at all.
    ...(typeof rec["nothingNewAt"] === "number" && Number.isFinite(rec["nothingNewAt"])
      ? { nothingNewAt: rec["nothingNewAt"] }
      : {}),
  };
}
