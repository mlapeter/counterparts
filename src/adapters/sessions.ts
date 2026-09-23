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
 * **The MCP server leaves one note of its own here** (2026-09-23):
 * `mcp-server@<pid>.json`, the build it was launched with, so the
 * UserPromptSubmit hook — which runs the INSTALLED build every turn — can tell
 * a session its server is out of date (`decideUpdateNotice`, at the bottom).
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
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CACHE_SCHEMA_VERSION, SCHEMA_VERSION } from "../core/store/index.js";

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
   * TRUE once this session has been told that the MCP server it is talking to
   * runs an older build than the one installed (`decideUpdateNotice` below,
   * 2026-09-23). One-way, like `askedScope`: the notice is shown once per
   * session and never every turn, and this mark is how a fresh hook process
   * knows it already was. Still host state, still no content.
   */
  readonly updateNoticeShown?: boolean;
  /**
   * WHAT THE HOOK THAT SAW THIS SESSION OPEN WAS RUNNING (2026-09-23, roadmap
   * E): the installed build, and that hook's parent process. Written by
   * whichever hook CREATES the record (`recordSession`), refreshed by
   * SessionStart when the session OPENS (startup, resume, clear, fork — never a
   * compaction, which is the same session carrying on), carried forward like
   * `config`.
   *
   * Its ABSENCE is the point: every record this build creates carries one, so
   * a record without one was written by a build before E — its MCP server may
   * be one that records nothing about itself, and the update notice speaks
   * once rather than stay silent about the one server it cannot see
   * (`decideUpdateNotice`). `hookPpid` is
   * how a person checks the host match: on a host that `exec`s its hooks it is
   * the host itself, the same pid an MCP server it started records as
   * `hostPid`. Still host state, still no content.
   */
  readonly opened?: SessionOpened;
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
    /** Set once, when the update notice has been shown. One-way. */
    updateNoticeShown?: boolean;
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
    // One-way, like `askedScope`: a session that has been told has been told,
    // and a later phase written by a process that knows nothing about the
    // notice must not un-tell it — or it would come back at the next turn.
    ...(input.updateNoticeShown === true || prior?.updateNoticeShown === true
      ? { updateNoticeShown: true }
      : {}),
    // STAMPED WHEN THIS CREATES THE RECORD, carried otherwise (#187 re-review,
    // N1). Whatever phase creates a record — SessionStart, a Stop, the seal,
    // SessionEnd — it is a hook on THIS build that created it, so the record
    // carries this build: "no stamp" then means exactly one thing, a record a
    // build before E wrote, and the update notice may read it that way. A
    // session opening refreshes it (`stampSessionOpened`).
    ...(prior?.opened !== undefined
      ? { opened: prior.opened }
      : prior === null
        ? { opened: { build: installedBuild(), hookPpid: process.ppid } }
        : {}),
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
  if (sessionPath(dataDir, sessionId) === null || !Number.isFinite(at)) return null;
  // Into the RAW JSON (`mergeIntoRecord`), not a rewrite from the parsed
  // record: the caller is the MCP server — the long-lived process, and so the
  // one most likely to run an older build than the hooks that wrote this
  // record — and its whitelist would erase whatever a newer hook added (#187
  // review, MINOR-1).
  return mergeIntoRecord(dataDir, sessionId, { nothingNewAt: at }) ? readSession(dataDir, sessionId) : null;
}

/**
 * Drop records nobody can claim any more. Called from SessionStart only — one
 * `readdir` per session, never per turn, and never on the SessionEnd path that
 * shares a 1.5 s budget with every other hook on that event.
 *
 * Session records and the notes beside them go by AGE; an MCP server's launch
 * record goes by LIVENESS instead (`serverBelieved`), because what it describes
 * is a process, and a process is either running or not whatever the calendar
 * says.
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
        // A SERVER RECORD is kept for exactly as long as its server is
        // believed alive — its pid running AND its heartbeat fresh
        // (`serverBelieved`) — whatever its age: a session left open for a week
        // still has a server the notice must be able to find. A pid the OS
        // handed to some other process after a hard kill stops being believed
        // once the heartbeat goes stale, and a live server whose record went
        // this way writes it again at its next beat.
        const serverPid = serverPidOf(name);
        if (serverPid !== null) {
          if (serverBelieved(serverPid, statSync(full).mtimeMs, now)) continue;
          rmSync(full, { force: true });
          removed += 1;
          continue;
        }
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

// ── the MCP server's launch record, and the update notice (2026-09-23) ──────
//
// A host starts the MCP server ONCE per session and keeps it; the hooks are
// fresh processes at every event. So after an upgrade the hooks run the new
// build and the server keeps the one it loaded (LAUNCH-STATUS I36). The server
// cannot put its build into the SESSION's record at launch — it does not know
// which session it serves until the lazy bind, at the first Stop ask it answers
// (`mcp/server.ts`, refusal 1) — so it leaves its OWN record here, beside the
// session records, and the UserPromptSubmit hook, which does know its session,
// finds it by scope.

/**
 * WHAT A PROCESS WAS BUILT FROM: the package version and the two schema
 * versions its code reads and writes. Two processes sharing one store with
 * different stamps are exactly the pair the notice and the MCP schema gate are
 * about.
 */
export interface BuildStamp {
  /** `package.json#version`, or null when the manifest could not be read. */
  readonly version: string | null;
  /** Box 2's `SCHEMA_VERSION` in the code this process loaded. */
  readonly storeSchema: number;
  /** Box 3's `CACHE_SCHEMA_VERSION` in the code this process loaded. */
  readonly cacheSchema: number;
}

let manifestVersion: string | null | undefined;

/**
 * The package version, from the `package.json` beside this code — the same
 * relative step in the repository and in the installed tarball
 * (`package.json#files` ships `src/` whole). Read once per process and never
 * thrown: a manifest that cannot be read is a null, and a null is never
 * evidence of a change (`sameBuild`).
 */
export function installedVersion(): string | null {
  if (manifestVersion !== undefined) return manifestVersion;
  try {
    const raw = readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8");
    const said = (JSON.parse(raw) as Record<string, unknown>)["version"];
    manifestVersion = typeof said === "string" && said.length > 0 ? said : null;
  } catch {
    manifestVersion = null;
  }
  return manifestVersion;
}

/**
 * The build THIS process is running. Both sides call this one function — the
 * server at launch, the hook every turn — so the two stamps cannot differ in
 * shape, only in value.
 */
export function installedBuild(): BuildStamp {
  return {
    version: installedVersion(),
    storeSchema: SCHEMA_VERSION,
    cacheSchema: CACHE_SCHEMA_VERSION,
  };
}

/** Same build, as far as either side can tell. An unreadable version on either
 *  side is not a mismatch; the two schema numbers always are. */
export function sameBuild(a: BuildStamp, b: BuildStamp): boolean {
  const versionMoved = a.version !== null && b.version !== null && a.version !== b.version;
  return !versionMoved && a.storeSchema === b.storeSchema && a.cacheSchema === b.cacheSchema;
}

/**
 * The remedy, spelled once: the notice ends with it and so does the MCP
 * schema gate's refusal (`mcp/server.ts#STALE_SERVER_REFUSAL`).
 */
export const RECONNECT_REMEDY = "Run /mcp and Reconnect to load it.";

/** The owner's words (2026-09-23), shown once per session, never every turn. */
export const UPDATE_NOTICE = `Counterparts was updated. ${RECONNECT_REMEDY}`;

/**
 * The same line for the other direction — the INSTALLED build is older than
 * the server's, which is a downgrade or a rollback. `sameBuild` cannot tell
 * the two apart; `serverIsNewer` can, and "was updated" would be untrue.
 */
export const CHANGED_NOTICE = `Counterparts was changed to an older version. ${RECONNECT_REMEDY}`;

/** A plain `x.y.z` compare; anything else is "not newer". */
function versionNewer(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (pa === null || pb === null) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Is `server` a NEWER build than `installed` — a downgrade, seen from here? */
export function serverIsNewer(server: BuildStamp, installed: BuildStamp): boolean {
  return (
    server.storeSchema > installed.storeSchema ||
    server.cacheSchema > installed.cacheSchema ||
    versionNewer(server.version, installed.version)
  );
}

/**
 * What SessionStart stamps on a session that OPENS (`SessionRecord.opened`).
 */
export interface SessionOpened {
  readonly build: BuildStamp;
  /** The stamping hook's parent process — the host, on a host that `exec`s
   *  its hooks. Compare with a server record's `hostPid`. */
  readonly hookPpid: number;
}

function parseBuild(raw: unknown): BuildStamp | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const version = b["version"] ?? null;
  const storeSchema = b["storeSchema"];
  const cacheSchema = b["cacheSchema"];
  if (version !== null && typeof version !== "string") return null;
  if (typeof storeSchema !== "number" || !Number.isInteger(storeSchema)) return null;
  if (typeof cacheSchema !== "number" || !Number.isInteger(cacheSchema)) return null;
  return { version, storeSchema, cacheSchema };
}

function parseOpened(raw: unknown): SessionOpened | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const build = parseBuild(o["build"]);
  const hookPpid = o["hookPpid"];
  if (build === null || typeof hookPpid !== "number" || !Number.isSafeInteger(hookPpid)) return null;
  return { build, hookPpid };
}

/**
 * MERGE FIELDS INTO A SESSION RECORD AS IT IS ON DISK — the raw JSON, never the
 * parsed record.
 *
 * `recordSession` rewrites a record whole from `parseRecord`'s whitelist, which
 * is right for the hooks: they are always the newest code, so their whitelist
 * is the newest one. A write from anywhere else must not do that — a process
 * running an older build (the unrestarted MCP server above all) would erase
 * every field a newer hook had added. So a mark is a merge into the object as
 * found: known and unknown fields alike survive it. Only a file that parses as
 * a session record is written; nothing is created. Atomic; never throws.
 *
 * **NOT LOCKED, and that is accepted.** Every writer of a session record — the
 * hooks' `recordSession`, these marks, the MCP server's `markNothingNew` — is
 * a read-modify-write with an atomic rename at the end and no lock around it.
 * Two writers that interleave (a Stop rewriting the record while the server
 * marks `nothingNewAt`, a prompt marking `updateNoticeShown` in the same
 * instant) can lose the field the slower one did not read. The consequence is
 * bounded to that one field: an update notice shown a second time, a
 * `nothingNewAt` missing from one answer, a stamp missing until the next
 * open. The hook events of one session are sequential and the server's writes
 * follow a Stop, so the window is a coincidence of two processes within
 * milliseconds — the same class every field in this record has lived with
 * since the registry was written (#187 review, MINOR-1).
 */
function mergeIntoRecord(
  dataDir: string,
  sessionId: string,
  fields: Record<string, unknown>,
  drop: readonly string[] = [],
): boolean {
  const path = sessionPath(dataDir, sessionId);
  if (path === null) return false;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parseRecord(raw) === null) return false;
    const merged: Record<string, unknown> = { ...(raw as Record<string, unknown>), ...fields };
    for (const key of drop) delete merged[key];
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(merged)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * SessionStart's stamp, on a session that OPENS: the installed build and the
 * hook's parent pid (`SessionRecord.opened`). Merged into the record the same
 * event just wrote; never creates one. Never throws.
 *
 * It also CLEARS `updateNoticeShown` (#187 re-review, N3): an open is often a
 * new host process and so a new MCP server — a session `--resume`d onto a
 * fresh host has not been told about THAT server, and the mark from the last
 * one must not keep it silent. An in-process `/resume` keeps its server, so a
 * stale one there is announced once more — the same accepted cost as `/clear`.
 */
export function stampSessionOpened(dataDir: string, sessionId: string, opened: SessionOpened): boolean {
  return mergeIntoRecord(dataDir, sessionId, { opened }, ["updateNoticeShown"]);
}

/**
 * One running MCP server, as it described itself at launch. Host state, no
 * content: two process ids, a directory, a time and three version numbers.
 */
export interface ServerRecord {
  readonly pid: number;
  /**
   * The server's PARENT at launch — the host process that started it. A hook
   * whose own parent is the same process belongs to the same host instance,
   * and so to the session this server serves; that is the exact match. When
   * the host ran the hook through a shell that did not `exec`, the parents
   * differ and the scope is the match instead (`decideUpdateNotice`).
   */
  readonly hostPid: number;
  /** The server's scope, canonical — the same string its lazy bind compares. */
  readonly scope: string;
  readonly startedAt: number;
  readonly build: BuildStamp;
}

/** A server record as read, with the file's mtime — its last heartbeat. */
export type ServerRecordRead = ServerRecord & { readonly refreshedAt: number };

/**
 * **CAL.** How often a running server touches its record
 * (`mcp/server.ts#recordLaunch`), and how old a record may be and still be
 * believed. The pair is what pins a record to the PROCESS that wrote it, not
 * just to a pid: after a hard kill the OS may hand the pid to anything, and
 * `pidAlive` alone would then believe the record — kept by `pruneSessions` and
 * compared by every new session in that directory — for as long as the
 * stranger ran. Ten beats of slack, so a laptop that slept does not lose its
 * servers for more than one beat after waking (the server writes its record
 * again if it was pruned meanwhile).
 */
export const SERVER_HEARTBEAT_MS = 60_000;
export const SERVER_STALE_MS = 10 * SERVER_HEARTBEAT_MS;

/** Pid running AND heartbeat fresh. */
export function serverBelieved(pid: number, refreshedAt: number, now: number, alive: (pid: number) => boolean = pidAlive): boolean {
  return now - refreshedAt <= SERVER_STALE_MS && alive(pid);
}

/**
 * `sessions/mcp-server@<pid>.json`. The `@` is deliberate: it is outside
 * `isSessionId`'s alphabet, so no session id — and no string a model passes to
 * `session_end` — can ever name this file.
 */
const SERVER_RECORD_PREFIX = "mcp-server@";

export function serverRecordPath(dataDir: string, pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return join(sessionsDir(dataDir), `${SERVER_RECORD_PREFIX}${String(pid)}.json`);
}

/** The pid a directory entry names, when it is a server record; else null. */
function serverPidOf(name: string): number | null {
  if (!name.startsWith(SERVER_RECORD_PREFIX) || !name.endsWith(".json")) return null;
  const digits = name.slice(SERVER_RECORD_PREFIX.length, -".json".length);
  if (!/^[1-9][0-9]*$/.test(digits)) return null;
  const pid = Number(digits);
  return Number.isSafeInteger(pid) ? pid : null;
}

/**
 * Is that process still running? Signal 0 delivers nothing and only asks.
 * `EPERM` is a process that exists and is somebody else's — alive.
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown } | null)?.code === "EPERM";
  }
}

function writeServerRecord(path: string, record: ServerRecord): boolean {
  try {
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Leave the launch record. Atomic like `recordSession`, and never throws: a
 * server whose record did not land costs this session its notice and nothing
 * else.
 */
export function recordServerLaunch(
  dataDir: string,
  input: {
    scope: string;
    build: BuildStamp;
    pid?: number;
    hostPid?: number;
    at?: number;
  },
): ServerRecord | null {
  const pid = input.pid ?? process.pid;
  const path = serverRecordPath(dataDir, pid);
  if (path === null) return null;
  const record: ServerRecord = {
    pid,
    hostPid: input.hostPid ?? process.ppid,
    scope: canonicalScope(input.scope),
    startedAt: input.at ?? Date.now(),
    build: input.build,
  };
  try {
    mkdirSync(sessionsDir(dataDir), { recursive: true });
  } catch {
    return null;
  }
  return writeServerRecord(path, record) ? record : null;
}

/**
 * THE HEARTBEAT: touch the record, or write it again if a SessionStart pruned
 * it while this process was asleep. Never creates a directory — a data dir
 * that went away (a test's temp dir, a store moved aside) is not recreated by
 * a timer. Never throws.
 */
export function refreshServerLaunch(dataDir: string, record: ServerRecord, now: number = Date.now()): boolean {
  const path = serverRecordPath(dataDir, record.pid);
  if (path === null) return false;
  try {
    const at = new Date(now);
    utimesSync(path, at, at);
    return true;
  } catch {
    try {
      if (!statSync(sessionsDir(dataDir)).isDirectory()) return false;
    } catch {
      return false;
    }
    return writeServerRecord(path, record);
  }
}

/** Take the record away at a clean exit. Best-effort: a server the host
 *  killed outright leaves its file, which stops being believed when its pid
 *  dies or its heartbeat goes stale, and is pruned at the next SessionStart. */
export function forgetServerLaunch(dataDir: string, pid: number = process.pid): void {
  const path = serverRecordPath(dataDir, pid);
  if (path === null) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* nothing to say about a file that will not go */
  }
}

/** Every server record that parses, believed or not. Never throws. */
export function readServerRecords(dataDir: string): ServerRecordRead[] {
  const out: ServerRecordRead[] = [];
  let names: string[];
  try {
    names = readdirSync(sessionsDir(dataDir));
  } catch {
    return out;
  }
  for (const name of names) {
    const pid = serverPidOf(name);
    if (pid === null) continue;
    try {
      const full = join(sessionsDir(dataDir), name);
      const rec = parseServerRecord(JSON.parse(readFileSync(full, "utf8")));
      if (rec !== null && rec.pid === pid) out.push({ ...rec, refreshedAt: statSync(full).mtimeMs });
    } catch {
      continue;
    }
  }
  return out;
}

function parseServerRecord(raw: unknown): ServerRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const pid = rec["pid"];
  const hostPid = rec["hostPid"];
  const scope = rec["scope"];
  const startedAt = rec["startedAt"];
  const build = parseBuild(rec["build"]);
  if (typeof pid !== "number" || !Number.isSafeInteger(pid)) return null;
  if (typeof hostPid !== "number" || !Number.isSafeInteger(hostPid)) return null;
  if (typeof scope !== "string" || scope.length === 0) return null;
  if (typeof startedAt !== "number") return null;
  if (build === null) return null;
  return { pid, hostPid, scope, startedAt, build };
}

/** Why the notice is, or is not, due this turn — for the hook's stderr line. */
export type UpdateNoticeReason =
  /** No session record: there is nowhere to mark "shown", so nothing is due
   *  rather than something said every turn. */
  | "no-record"
  | "already-shown"
  /** No live server in this session's scope, and the session was stamped when
   *  it opened — so its server, if it has one, is one that records itself. */
  | "no-server"
  | "current"
  /** A server this session may be talking to runs another build — or the
   *  session opened before any build stamped it (`matchedBy: "unstamped"`). */
  | "due"
  /** Anything that threw. The turn goes on exactly as it would have. */
  | "failed";

export interface UpdateNoticeDecision {
  /** The line to show, or null. Non-null exactly when `reason` is `due`. */
  readonly message: string | null;
  readonly reason: UpdateNoticeReason;
  /**
   * What decided it: `host` — the servers this hook's own host process
   * started; `unstamped` — none of those, and the session opened before any
   * build stamped it; `scope` — every live server in the scope.
   */
  readonly matchedBy: "host" | "unstamped" | "scope" | null;
  readonly servers: number;
  /** The hook parent the host match was tried against. */
  readonly hookPpid: number;
}

/**
 * IS "Counterparts was updated" DUE THIS TURN? — decided by a hook running the
 * INSTALLED build, which is the whole point: it is the one process that knows
 * what "current" is. It WRITES NOTHING; `markUpdateNoticeShown` is the other
 * half, and the caller marks only once the line is actually on its way.
 *
 * In order:
 *
 *   1. The believed servers (`serverBelieved`) in this session's scope that
 *      THIS hook's host started (`hostPid` = the hook's parent) are the exact
 *      answer when there are any: due if any runs another build.
 *   2. Otherwise, a session that OPENED before any build stamped it
 *      (`SessionRecord.opened` absent) is due, once: its server was started
 *      then too, and may be one that records nothing about itself — the case
 *      of the upgrade that installs this code (MAJOR-1 of #187's review).
 *   3. Otherwise every believed server in the scope, and ANY stale one makes
 *      it due. This can speak once to a session whose own server is current
 *      while a second session in the same directory runs an old one; the
 *      advice is harmless, and it never stays silent about this session's.
 *
 * A downgrade gets `CHANGED_NOTICE` rather than "was updated". Never throws;
 * `failed` is a reason like any other.
 */
export function decideUpdateNotice(
  dataDir: string,
  input: {
    sessionId: string;
    installed: BuildStamp;
    /** This hook's parent process. Defaults to `process.ppid`. */
    hostPid?: number;
    /** Injected so a test can say which pids are running. */
    alive?: (pid: number) => boolean;
    now?: number;
  },
): UpdateNoticeDecision {
  const hookPpid = input.hostPid ?? process.ppid;
  const quiet = (
    reason: UpdateNoticeReason,
    matchedBy: UpdateNoticeDecision["matchedBy"] = null,
    servers = 0,
  ): UpdateNoticeDecision => ({ message: null, reason, matchedBy, servers, hookPpid });
  const due = (
    compared: readonly ServerRecord[],
    matchedBy: NonNullable<UpdateNoticeDecision["matchedBy"]>,
  ): UpdateNoticeDecision => ({
    message: compared.some((s) => serverIsNewer(s.build, input.installed)) ? CHANGED_NOTICE : UPDATE_NOTICE,
    reason: "due",
    matchedBy,
    servers: compared.length,
    hookPpid,
  });
  try {
    const record = readSession(dataDir, input.sessionId);
    if (record === null) return quiet("no-record");
    if (record.updateNoticeShown === true) return quiet("already-shown");
    const now = input.now ?? Date.now();
    const alive = input.alive ?? pidAlive;
    const live = readServerRecords(dataDir).filter(
      (s) => sameScope(s.scope, record.scope) && serverBelieved(s.pid, s.refreshedAt, now, alive),
    );
    const own = live.filter((s) => s.hostPid === hookPpid);
    if (own.length > 0) {
      return own.every((s) => sameBuild(s.build, input.installed)) ? quiet("current", "host", own.length) : due(own, "host");
    }
    if (record.opened === undefined) return due([], "unstamped");
    if (live.length === 0) return quiet("no-server");
    return live.every((s) => sameBuild(s.build, input.installed)) ? quiet("current", "scope", live.length) : due(live, "scope");
  } catch {
    return quiet("failed");
  }
}

/**
 * THE ONCE-PER-SESSION MARK. The caller writes it when the line is on its way
 * and SHOWS the line only if this returns true — so a mark that will not write
 * is silence rather than a notice every turn (the owner asked for a notice, not
 * a nag), and a line that could not be carried is never marked as shown.
 *
 * A merge into the record's raw JSON (`mergeIntoRecord`), so it moves no clock
 * and erases no field it does not know. No record, no mark. Never throws.
 */
export function markUpdateNoticeShown(dataDir: string, sessionId: string): boolean {
  try {
    const record = readSession(dataDir, sessionId);
    if (record === null) return false;
    if (record.updateNoticeShown === true) return true;
    return mergeIntoRecord(dataDir, sessionId, { updateNoticeShown: true });
  } catch {
    return false;
  }
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
    // Optional for the same reason as `askedScope`, and its absence means
    // exactly "not told yet".
    ...(rec["updateNoticeShown"] === true ? { updateNoticeShown: true } : {}),
    // Optional, and its absence is the answer the notice reads: "opened before
    // any build stamped it". A malformed one reads as absent.
    ...((): { opened?: SessionOpened } => {
      const opened = parseOpened(rec["opened"]);
      return opened === null ? {} : { opened };
    })(),
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
