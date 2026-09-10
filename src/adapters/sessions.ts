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
 * id, a scope, three timestamps. Losing the whole directory costs a lazy bind
 * and nothing else, which is why `store/paths.ts` classifies it `backup: false`.
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
  };

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
  };
}
