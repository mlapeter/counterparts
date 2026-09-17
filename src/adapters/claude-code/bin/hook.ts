#!/usr/bin/env bun
/**
 * The hook entry script. ONE executable for every hook, dispatching on the
 * host's own event name.
 *
 * Run by the host as, e.g.:
 *
 *   ~/.bun/bin/bun run <repo>/src/adapters/claude-code/bin/hook.ts
 *
 * with the hook payload on stdin. It writes the context block (or nothing) to
 * stdout and ALWAYS exits 0 — a hook that fails the host is the one failure
 * mode this adapter does not have (CONTRACT §5 G2). Everything in here is host
 * trivia and may change with the host without touching a core contract (G9).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_DIR_ENV, dataDir, describeGuardRefusal } from "../../../core/store/index.js";
import {
  defaultConfigPath,
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";
import {
  describeScopeTrouble,
  lookupScope,
  mostRestrictiveVerdict,
  readScopes,
  scopesPath,
  stanceOfMode,
} from "../../scopes.js";
import type { ScopeRead, ScopeVerdict } from "../../scopes.js";
import { canonicalScope, readSession } from "../../sessions.js";
import { loadConfig } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { loadCredentials, permissionWarning } from "../credentials.js";
import type { CredentialLoad } from "../credentials.js";
import { HOOKS, openAdapter } from "../index.js";
import type { HookInput, HookName } from "../hooks.js";
import { readTranscript } from "../transcript.js";

/**
 * The host's own spelling of the one event that carries a notice. It appears
 * twice — as a key below, and as `hookSpecificOutput.hookEventName` in the JSON
 * form — and the host matches that field against its own name, so the two
 * spellings must be one constant.
 */
export const HOST_SESSION_START = "SessionStart";

/**
 * THE MOST STDOUT THIS HOOK MAY PRINT AS JSON, and why the number is 9,500.
 *
 * The host's own cap, verbatim (https://code.claude.com/docs/en/hooks): "Hook
 * output strings, including `additionalContext`, `systemMessage`, and plain
 * stdout, are capped at 10,000 characters. Output that exceeds this limit is
 * saved to a file and replaced with a preview and file path."
 *
 * Which is survivable for PLAIN stdout — a truncated wake is still a wake — and
 * fatal for the JSON form: replace the printed object with a preview and the
 * stdout no longer parses as JSON, so `additionalContext` is never read and the
 * ENTIRE WAKE is dropped. And the envelope is bigger than the wake it carries:
 * JSON escaping turns every newline into two characters, so a 9,038-byte wake
 * plus a 352-character notice measured 9,618 characters of stdout — one bad day
 * away from losing the wake on exactly the morning something was red.
 *
 * So the JSON form is used only while it demonstrably fits, with 500 characters
 * of margin for the escaping, and the fallback is the plain wake: the notice is
 * what gets dropped, never the memory. `counterparts doctor` still prints it.
 */
export const ENVELOPE_MAX_CHARS = 9500;

/** The host's event names, mapped to this adapter's. Host trivia, by definition. */
const HOST_HOOKS: Record<string, HookName> = {
  [HOST_SESSION_START]: "session-start",
  UserPromptSubmit: "user-prompt-submit",
  Stop: "stop",
  SessionEnd: "session-end",
  PreCompact: "pre-compact",
};

/**
 * Where the host's configuration for this package lives BY DEFAULT — the path
 * this file has read since it was written, unchanged, and the one the owner's
 * live host resolves at every hook event because it passes no flag.
 *
 * `--config <absolute path>` and `COUNTERPARTS_CONFIG` override it, in that
 * order (`adapters/config-path.ts` states the rule for all four entry points).
 * Neither is set on the live host; a run that sets neither resolves exactly
 * this.
 */
export const CONFIG_PATH = defaultConfigPath();

/** The worker script this hook's spawn runs. Resolved from THIS file's location,
 *  never from a working directory the host chose. */
export const RUNNER_PATH = fileURLToPath(new URL("./runner.ts", import.meta.url));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The configuration this process runs on, AND the credential load it performed.
 *
 * The credentials are read HERE, at the process entry point, before anything
 * asks for a key: the spawner's `base` env is `process.env`, the two clients
 * read `process.env`, and the capability report reads `process.env` — so the gap
 * must be filled before any of them look. Measured day 0 of the parallel run:
 * this host's hook processes carry neither name, so without this line the worker
 * refuses every spawn and the embedder never opens.
 *
 * `env` is injected so a test can prove the whole path over a fresh object
 * instead of mutating the suite's own process.
 */
export function hostConfig(
  path = CONFIG_PATH,
  env: NodeJS.ProcessEnv = process.env,
): { config: AdapterConfig; credentials: CredentialLoad; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent is ordinary; unreadable resolves to OBSERVER inside `loadConfig`,
    // which is the fail direction observer-mode G5 requires.
    raw = undefined;
  }
  const load = loadConfig(raw);
  const loaded = load.config;
  // Only a configuration we UNDERSTOOD names a file. An unreadable one resolves
  // to `{ observer: true }` above, and an observer opens no credential.
  const credentials = loadCredentials(loaded.credentialsFile, env);
  // The data dir is RESOLVED here and carried explicitly, so the spawner has a
  // value to pin onto the child (scar §2.13). Leaving it undefined would make
  // the parent and the child resolve it independently, from an environment
  // either of them might have inherited differently.
  // `reason` travels out so the caller can tell "we understood this" from "we
  // stood down because we did not" — the difference matters only for a config
  // somebody NAMED (`namedUnreadableRefusal`).
  return {
    config: { ...loaded, dataDir: loaded.dataDir ?? dataDir() },
    credentials,
    reason: load.reason,
  };
}

/**
 * The configuration this hook process will read, and which of the three rules
 * chose it. Exported and injectable so the no-flag, no-env case — the ONLY case
 * the owner's live host produces — is provable without a process.
 */
export function hookConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

/**
 * WHERE THE AGENT'S SHELL IS RIGHT NOW — the directory THIS EVENT happened in,
 * and nothing more.
 *
 * **The 2026-09-04 measurement this used to rest on is retired.** It read the
 * payload's `cwd` as "the project directory"; the host documents it as
 * "current working directory (follows Claude into worktrees)", and it does. A
 * session that walks into a git worktree — which is how every piece of work in
 * this repository is done — reports the worktree here from that turn onward. One
 * real session on 2026-09-17 had its spans filed under FOUR directories on this
 * value alone.
 *
 * So this is no longer the scope anything is FILED under. It answers exactly one
 * question — which directory the owner's registry should be consulted about for
 * this event — and the filing scope is `sessionScope` below. The payload first,
 * because the whole point is that it moves; the two fallbacks are for a payload
 * that arrived unparsable.
 */
export function eventDirectory(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof payload["cwd"] === "string" && payload["cwd"].length > 0) {
    return resolve(payload["cwd"]);
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) return resolve(projectDir);
  return process.cwd();
}

/**
 * THE `SessionStart` SOURCES THAT OPEN A SESSION rather than interrupting one.
 *
 * The host fires `SessionStart` five ways and says which in `source`: `startup`,
 * `resume`, `clear`, `fork` — all of them a session beginning, in whatever
 * directory the host launched it in — and `compact`, which arrives in the MIDDLE
 * of a session whose MCP server is not relaunched. Treating a compaction as a
 * start would re-anchor a long session's scope to wherever its shell had got to,
 * which is the failure this file is fixing, arriving by another door.
 *
 * A `source` this list does not know, or none at all, does NOT re-anchor a
 * session that already has a record: the safe direction for an unrecognised
 * event is to leave the session where it is.
 */
export const FRESH_SESSION_SOURCES: readonly string[] = ["startup", "resume", "clear", "fork"];

/**
 * THE ONE DIRECTORY A SESSION IS FILED UNDER, FOR ITS WHOLE LIFE — spans,
 * boundaries, coverage, the ask's coverage read, the session registry record and
 * the worker's session state.
 *
 * **Why it is not the event's directory.** Measured on the owner's store,
 * 2026-09-17: one session's spans landed in four scope directories and its
 * boundaries in all four, while its authored deposits and their coverage marks
 * landed in ONE — because the MCP server's scope is fixed at launch and a
 * deposit only covers spans in its own scope. Everything the session wrote in
 * the other three was left uncovered, to be rewritten twelve hours later by the
 * crash fallback as though the session had died. Two worktree scopes on that
 * store hold 298 fallback memories and zero authored ones.
 *
 * **Two sources, in this order, and they agree by construction.**
 *
 *   1. **The session registry's own record** (`adapters/sessions.ts`), which
 *      SessionStart wrote and which `recordSession` refuses to rewrite after a
 *      start. It is the recorded fact of where this session began, and it is the
 *      SAME string `mcp/server.ts#requireBoundSession` matches a deposit
 *      against — so a scope taken from here cannot disagree with the server that
 *      claims coverage.
 *   2. **`CLAUDE_PROJECT_DIR`, then the payload's `cwd`, then `process.cwd()`**,
 *      for the first event of a session and for a session whose record was
 *      pruned. The host documents `CLAUDE_PROJECT_DIR` as the project root where
 *      the session started, exports it to hook processes AND to stdio MCP
 *      servers, and keeps it put when the agent enters a worktree or runs `cd` —
 *      which is exactly the property the payload's `cwd` lacks. `serve.ts` reads
 *      the same variable in the same position, which is what makes the two sides
 *      agree without either one telling the other.
 *
 * Canonical on both sides (`canonicalScope`): the record stores a realpath, so a
 * scope read back from it and one resolved fresh have to be the same string or
 * the session would split on `/tmp` versus `/private/tmp` alone — and span
 * directories are keyed by a hash of this exact string (`remember/spans.ts`).
 */
export function sessionScope(
  /** The store the session registry lives under. Absent ⇒ no record to read. */
  dataDir: string | undefined,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
  if (dataDir !== undefined && dataDir.length > 0 && sessionId.length > 0 && !opensASession(payload)) {
    // `readSession` answers null on every failure rather than throwing, which is
    // the rule this whole path lives by: a hook may not fail the host (§5 G2).
    const recorded = readSession(dataDir, sessionId)?.scope;
    if (recorded !== undefined && recorded.length > 0) return recorded;
  }
  return startDirectory(payload, env);
}

/** Is this event a session BEGINNING, whose directory becomes the session's? */
function opensASession(payload: Record<string, unknown>): boolean {
  if (payload["hook_event_name"] !== HOST_SESSION_START) return false;
  const source = payload["source"];
  return typeof source === "string" && FRESH_SESSION_SOURCES.includes(source);
}

/**
 * The directory a session that has no record yet began in. `CLAUDE_PROJECT_DIR`
 * first — see `sessionScope` for why the payload's `cwd` is not good enough.
 */
export function startDirectory(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) return canonicalScope(projectDir);
  if (typeof payload["cwd"] === "string" && payload["cwd"].length > 0) {
    return canonicalScope(payload["cwd"]);
  }
  return canonicalScope(process.cwd());
}

/**
 * THE SCOPE VERDICT for this event: which entry in `<config dir>/scopes.json`
 * governs, and whether the file itself could be read.
 *
 * It takes as many directories as the caller has, and answers with the MOST
 * RESTRICTIVE verdict among them (`scopes.ts#mostRestrictiveVerdict`) — because
 * one event now has two directories to answer for, the session's and the shell's,
 * and privacy follows both while filing follows only the first. The FIRST
 * directory is the session's own and wins every tie, so the `unset` that raises
 * the first-launch question is asked about the directory the session is filed
 * under rather than about wherever it happens to be standing.
 *
 * Exported and injectable because the hook's most important behaviour — `off`
 * means nothing is opened at all — is decided from it before any store exists,
 * and that has to be provable without a process.
 */
export function hookScopeVerdict(
  configPath: string,
  ...scopes: readonly string[]
): { verdict: ScopeVerdict; read: ScopeRead } {
  const read = readScopes(scopesPath(configPath));
  return { verdict: verdictOver(read, scopes), read };
}

/** The most restrictive verdict over `scopes`, first one winning ties. */
function verdictOver(read: ScopeRead, scopes: readonly string[]): ScopeVerdict {
  let verdict: ScopeVerdict = { mode: "unset", matched: null, entry: null };
  let first = true;
  for (const dir of scopes) {
    const one = lookupScope(read.registry, dir);
    verdict = first ? one : mostRestrictiveVerdict(verdict, one);
    first = false;
  }
  return verdict;
}

export function toHookInput(
  payload: Record<string, unknown>,
  opts: {
    /** The scope this session is filed under, when the caller already resolved
     *  it. Absent: resolved here, from the registry under `dataDir`. */
    readonly scope?: string;
    readonly dataDir?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): HookInput {
  const scope = opts.scope ?? sessionScope(opts.dataDir, payload, opts.env ?? process.env);
  const transcript = readTranscript(
    typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : undefined,
  );
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope,
    turns: transcript.turns,
    expansions: transcript.expansions,
    // The host's re-fire of a blocked Stop, carried INTO the adapter and not
    // only handled at delivery: the pass that says nothing must also advance
    // nothing (`hooks.ts#askAtStop`).
    ...(payload["stop_hook_active"] === true ? { reFired: true } : {}),
    ...(typeof payload["prompt"] === "string" ? { prompt: payload["prompt"] } : {}),
    at: new Date().toISOString().slice(0, 10),
  };
}

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {};
  try {
    const text = await readStdin();
    if (text.trim().length > 0) payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* an unreadable payload is a quiet hook, never a failed session */
  }
  const name = HOST_HOOKS[String(payload["hook_event_name"] ?? "")];
  if (name === undefined || !HOOKS.includes(name)) return;

  // WHICH CONFIGURATION, decided before anything is read and refused rather
  // than guessed. A caller who named one and named it badly gets a stand-down,
  // never a silent fall-back onto the default store (`config-path.ts`).
  const choice = hookConfigChoice();
  // `namedConfigRefusal` covers the flag's own refusals AND the one the first
  // review of this rule found: an absolute path to a file that is not there was
  // honoured silently, read as an absent config, and fell through to `dataDir()`
  // — the live store on any machine with an install. An absent DEFAULT is still
  // ordinary; this only ever refuses a path somebody named.
  //
  // `implicitConfigRefusal` is the explicit-dir guard at this door: with
  // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` an UNNAMED configuration stands the
  // hook down too, because the default one names a store. The live host never
  // sets it, so the no-flag, no-env case there resolves exactly what it did.
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    process.stderr.write(`[counterparts] hook stood down: ${refusal}\n`);
    return;
  }
  // WHICH DIRECTORY, AND WHAT THIS HOST WAS TOLD ABOUT IT — decided here,
  // before a store is opened, because that ordering is the whole guarantee
  // (`../CONTRACT.md` §5 G13): a directory set `off` produces no output and no
  // write because nothing was ever constructed to produce either. An
  // unreadable registry resolves to `unset` (⇒ on, today's behaviour) and is
  // reported as a ring event once the adapter that owns the ring exists.
  //
  // THE EVENT'S OWN DIRECTORY IS CHECKED FIRST AND ALONE, and that ordering is
  // load-bearing: it is what keeps an `off` directory's silence byte-for-byte
  // what it was. Nothing has been read but the registry at this point — not the
  // configuration, not the session record — so a directory the owner opted out
  // of still costs exactly one small file read and returns. The session's own
  // directory is folded in below, once there is a store path to look it up in.
  const eventDir = eventDirectory(payload);
  const { verdict: eventVerdict, read } = hookScopeVerdict(choice.path, eventDir);
  if (stanceOfMode(eventVerdict.mode) === "off") {
    // Silent on BOTH channels, deliberately. `off` is an opt-out, not an
    // observer stand-down: there is no store to log to without writing one, and
    // UserPromptSubmit fires every turn, so a line per event would be a
    // permanent noise floor in the host's log for a directory that asked to be
    // left alone. The record that this happened is the registry itself, which
    // `counterparts scope <path>` prints on demand.
    return;
  }
  // A REGISTRY IN TROUBLE IS NOT SILENT, and that is a DIFFERENT exception from
  // the one above (#92 review, F2). `off` is silent because the owner said leave
  // this alone; a file that could not be read — or an entry in it that could not
  // — has said nothing at all, and its fail direction is `unset`, which is ON.
  // The review's measurement: one typo'd mode turned every correctly typed `off`
  // in the file on, with the only evidence a ring event in a process that lives
  // for one turn. So: one line, on SessionStart ONLY (UserPromptSubmit fires
  // every turn and this is a warning, not a nag), AFTER the `off` return above
  // so that the silence of an off directory stays byte-for-byte.
  if (name === "session-start") {
    const trouble = describeScopeTrouble(read, scopesPath(choice.path));
    if (trouble !== null) process.stderr.write(`${trouble}\n`);
  }
  const { config: loaded, credentials, reason } = hostConfig(choice.path);
  // THE THIRD ARM, and it is answered BEFORE anything reads under `dataDir`: a
  // named file that parses but whose fields do not typecheck resolves to
  // observer, and an observer with no `dataDir` reads the DEFAULT store.
  // Standing down is the only answer that keeps the promise the flag makes, and
  // standing down before the session registry is consulted is what keeps it from
  // touching the default store's host state on the way out. An unreadable
  // DEFAULT is unchanged — observer, as it always was.
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`[counterparts] hook stood down: ${unreadable}\n`);
    return;
  }
  // THE SESSION'S OWN DIRECTORY — the one everything this event captures will be
  // FILED under, whatever directory the agent's shell has wandered into. It is
  // resolved here rather than above because its first source is the session
  // registry, which lives under the store the configuration names.
  const scope = sessionScope(loaded.dataDir, payload);
  // AND PRIVACY FOLLOWS BOTH DIRECTORIES, most restrictive winning. Filing
  // follows the session; a session that walks into a directory the owner set
  // `off` or `observer` goes at least as quiet as that directory, or the stable
  // scope would have become a way to carry capture past an opt-out. The
  // session's verdict is first, so it wins a tie and its `unset` is the one that
  // raises the first-launch question.
  const verdict = mostRestrictiveVerdict(lookupScope(read.registry, scope), eventVerdict);
  if (stanceOfMode(verdict.mode) === "off") {
    // Silent, for the same reason the event-directory return above is silent —
    // and reached only when the session's OWN directory is the one that is off,
    // which is a session whose SessionStart ran somewhere the owner opted out
    // of. Nothing has been written; the configuration and the session record
    // were read, and neither is a write.
    return;
  }
  // THE COMBINATION: the most restrictive of what the configuration said and
  // what the registry says (`adapters/scopes.ts#effectiveStance`, applied here
  // by folding the registry's `observer` into the config the adapter opens on).
  // It only ever adds restriction, which is why the three private directories
  // running on an observer CONFIG are untouched by any of this.
  const config: AdapterConfig =
    verdict.mode === "observer" ? { ...loaded, observer: true } : loaded;
  // A file the group or the world can read is WARNED about, by mode, and never
  // refused: the owner's machine, the owner's call (§5 G2 — a throw here would
  // fail the host over a permission bit).
  const warning = permissionWarning(config.credentialsFile, credentials);
  if (warning !== null) process.stderr.write(`${warning}\n`);
  const adapter = openAdapter(config, {
    command: process.execPath,
    args: ["run", RUNNER_PATH],
    credentials,
    // WHICH FILE THIS RUN READ, carried into the adapter so it can be RECORDED:
    // a hook cannot print to the owner (its stdout is the model's context), so
    // the answer goes into the session registry record and the event ring
    // instead. It is also pinned onto the worker's environment, so the child
    // reads the same file its parent did rather than resolving one of its own.
    configPath: choice.path,
    // The verdict travels IN, for the same reason the credentials do: it is a
    // fact about this process's startup, decided before anything opened, and
    // the adapter's jobs with it are to record it and — when it is `unset` — to
    // ask the question once (G41).
    scope: verdict,
    ...(read.error === null ? {} : { scopeUnreadable: read.error }),
    ...(read.refused.length === 0 ? {} : { scopeRefused: read.refused.map((r) => r.key) }),
  });
  try {
    // ONE read of the transcript, shared by the hook and the notice: `toHookInput`
    // opens and parses the transcript file, and calling it twice would pay for
    // that twice on the hot path. The scope is handed IN rather than resolved
    // again: it was decided above, the registry verdict was taken on it, and two
    // resolutions of one value is the shape scar §2.13 is about.
    const input = toHookInput(payload, { scope });
    const result = adapter.hook(name, input);
    // THE NOTICE, AFTER THE WAKE AND ONLY AT SESSION START. Never on
    // user-prompt-submit: the owner asked for a warning, not a nag. `notice()`
    // is red-only, bounded, and returns null rather than throwing, so the line
    // below cannot change what the wake does on a healthy day.
    const notice = name === "session-start" ? adapter.notice(input) : null;
    const delivery = hostDelivery(name, result, payload, notice);
    // A notice the envelope could not carry leaves a row rather than nothing:
    // "the terminal said nothing" and "there was nothing to say" are different
    // facts about the same morning (scar §2.4).
    if (delivery.dropped !== null) adapter.noteNoticeDropped(delivery.dropped);
    if (delivery.stdout.length > 0) process.stdout.write(delivery.stdout);
    if (delivery.stderr.length > 0) process.stderr.write(delivery.stderr);
    process.exitCode = delivery.exitCode;
  } finally {
    adapter.counterpart.close();
  }
}

/**
 * How each hook's output reaches the model on THIS host — measured, not
 * assumed (scar §2.18), on day 0 of the parallel run (2026-09-03):
 *
 *   - SessionStart / UserPromptSubmit: plain stdout with exit 0 is added to the
 *     model's context. The wake (8,859 B) arrived that way.
 *   - Stop: plain stdout with exit 0 reaches NOBODY. An ask written that way
 *     was recorded (`adapter.episode.ask asked:true`) and never seen. The one
 *     channel proven on this host is the blocking one bansai has used all along:
 *     the text on STDERR and exit code 2, which the host feeds back to the model
 *     as "Stop hook feedback" and lets it continue. The host then re-fires Stop
 *     with `stop_hook_active: true`; that re-fire must ask NOTHING or the ask
 *     loops forever (v1's anti-loop, kept here for the same reason).
 *
 * **The fourth channel, added 2026-09-14 for I32: `systemMessage`.** Documented
 * at https://code.claude.com/docs/en/hooks (formerly
 * docs.claude.com/en/docs/claude-code/hooks) and measured by the owner's own
 * probe on 2026-09-11: a SessionStart hook that exits 0 and prints JSON with a
 * top-level `systemMessage` gets that text DISPLAYED in the terminal
 * (`SessionStart:startup says: …`), non-blocking, while `additionalContext` and
 * stderr do not show. The doc also states the rule that makes this safe or
 * dangerous depending on which form you print: **when stdout parses as JSON the
 * raw stdout is NOT also added to context** — only the JSON's fields are. So the
 * wake must ride ENTIRELY in `hookSpecificOutput.additionalContext`, byte for
 * byte what plain stdout would have carried, and a day with nothing red prints
 * the plain form it has printed since day 0 rather than a JSON wrapper nobody
 * has measured on this host.
 *
 * Pure, so the test proves the channel choice without a process. `dropped` is
 * how a pure function reports the one thing it cannot do itself: the caller
 * turns it into the ring row that makes a silent terminal explicable.
 */
export interface Delivery {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: 0 | 2;
  /** Non-null when the notice was dropped to keep the wake whole. */
  readonly dropped: { readonly noticeChars: number; readonly envelopeChars: number; readonly limitChars: number } | null;
}

export function hostDelivery(
  name: HookName,
  result: { injection: string | null; ask: string | null },
  payload: Record<string, unknown>,
  /** The owner-facing warning, or null. Only SessionStart carries one. */
  notice: string | null = null,
): Delivery {
  const ask = result.ask !== null && result.ask.length > 0 ? result.ask : null;
  if (name !== "stop") {
    const out = [result.injection ?? "", ask ?? ""].filter((s) => s.length > 0).join("\n\n");
    if (name === "session-start" && notice !== null && notice.length > 0) {
      const envelope = JSON.stringify({
        systemMessage: notice,
        hookSpecificOutput: { hookEventName: HOST_SESSION_START, additionalContext: out },
      });
      // THE WAKE WINS. Over `ENVELOPE_MAX_CHARS` the host would replace this
      // whole string with a preview, the JSON would stop parsing, and the
      // session would start with no memory at all — a worse outcome than not
      // seeing the warning, which `counterparts doctor` prints on request.
      if (envelope.length > ENVELOPE_MAX_CHARS) {
        return {
          stdout: out,
          stderr: "",
          exitCode: 0,
          dropped: { noticeChars: notice.length, envelopeChars: envelope.length, limitChars: ENVELOPE_MAX_CHARS },
        };
      }
      return { stdout: envelope, stderr: "", exitCode: 0, dropped: null };
    }
    return { stdout: out, stderr: "", exitCode: 0, dropped: null };
  }
  // The re-fire is refused twice on purpose: the adapter asks nothing on it, and
  // this channel would not carry it even if something did.
  if (payload["stop_hook_active"] === true || ask === null) {
    return { stdout: "", stderr: "", exitCode: 0, dropped: null };
  }
  return { stdout: "", stderr: ask, exitCode: 2, dropped: null };
}

/** True only when this file is the process entry point — so a test may import
 *  `toHookInput` and `hostConfig` without the script running itself. */
export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main().then(
    () => process.exit(process.exitCode === 2 ? 2 : 0),
    (err: unknown) => {
      // A failed hook is a QUIET hook, never a failed session — but a
      // stand-down stays observable (observer-mode G6). One line names it:
      // e.g. an observer stance finding no store to read (cli §7) says
      // STORE_UNINITIALIZED here instead of minting one silently.
      //
      // The explicit-dir guard gets a SENTENCE with THIS entry point's remedy:
      // a hook has no `--dir`, so the way to name its store is the `dataDir`
      // field of the file it was pointed at (the gap between the two guards —
      // a named configuration that names no store; #80 review).
      const detail = err instanceof Error ? err.message : String(err);
      const remedy = `Set "dataDir" in ${hookConfigChoice().path}, or set ${DATA_DIR_ENV}.`;
      process.stderr.write(`[counterparts] hook stood down: ${describeGuardRefusal(err, remedy) ?? detail}\n`);
      process.exit(0);
    },
  );
}
