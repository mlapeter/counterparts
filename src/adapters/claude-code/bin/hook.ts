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
import { STOP_HUMAN_LINE } from "../hooks.js";
import type { HookInput, HookName } from "../hooks.js";
import {
  CONFIG_REFUSED,
  CONFIG_UNREADABLE,
  classifyStandDown,
  decideSay,
  readMark,
  writeMark,
} from "../standdown.js";
import type { SaysSoHook, StandDownFault } from "../standdown.js";
import { readTranscript } from "../transcript.js";

/**
 * The host's own spelling of the one event that carries a notice. It appears
 * twice — as a key below, and as `hookSpecificOutput.hookEventName` in the JSON
 * form — and the host matches that field against its own name, so the two
 * spellings must be one constant.
 */
export const HOST_SESSION_START = "SessionStart";

/**
 * The same, for the second event that carries one since roadmap E
 * (2026-09-23): the update notice, at a prompt (`hostDelivery`).
 */
export const HOST_USER_PROMPT_SUBMIT = "UserPromptSubmit";

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

/**
 * HOW A DUE STOP ASK LEAVES THIS PROCESS — two shapes behind one switch (B1,
 * owner 2026-09-23), because what the host's terminal RENDERS for each is a
 * question no agent can measure (`claude -p` draws no banner). The owner looks
 * at one Stop in his own terminal and picks; the losing shape goes next round.
 * The recipe is in `../NOTES.md` §"The Stop ask's two shapes".
 *
 *   - **`json`** (the default) — exit 0 and one JSON object on stdout:
 *     `{"decision":"block","reason":<the model's ask>,"systemMessage":<the
 *     person's line>}`. The host's reference: `reason` "Tells Claude why it
 *     should continue"; `systemMessage` is a "Warning message shown to the
 *     user". It also says a blocking `reason` is seen "as a warning in the
 *     transcript" — so whether the person reads ONE line here or both is
 *     exactly what the look is for.
 *   - **`stderr`** — the channel proven on this host since day 0: the ask on
 *     stderr, exit 2. The host shows it to the person as `Stop hook error:` and
 *     hands the same text to the model. It has one channel, so the person
 *     reads the model's two lines.
 *
 * Both BLOCK; both are refused on the host's re-fire (`stop_hook_active`).
 *
 * **The switch is a key in `claude-code.json`, not an environment variable**,
 * because a hook process does not carry the login shell's environment on this
 * host (measured day 0 of the parallel run; `config.ts#credentialsFile`), and
 * because the file is re-read by every hook — so a flip takes effect at the next
 * Stop with no restart. It is read here, beside the rest of `hostConfig`, and
 * leniently ON PURPOSE: `"stderr"` in any case and with any surrounding spaces
 * picks stderr (a person typing a preference by hand writes `"STDERR"` or
 * `"stderr "`), and anything else — a typo, a number, nothing — is the default,
 * because a display preference must not stand the adapter down to observer the
 * way a typo in `dataDir` does.
 */
export const STOP_ASK_SHAPE_KEY = "stopAskShape";
export type StopAskShape = "json" | "stderr";
export const DEFAULT_STOP_ASK_SHAPE: StopAskShape = "json";

/** The shape a parsed `claude-code.json` asks for. Total: never throws. */
export function stopAskShapeOf(raw: unknown): StopAskShape {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_STOP_ASK_SHAPE;
  const value = (raw as Record<string, unknown>)[STOP_ASK_SHAPE_KEY];
  return typeof value === "string" && value.trim().toLowerCase() === "stderr" ? "stderr" : DEFAULT_STOP_ASK_SHAPE;
}

/** The host's event names, mapped to this adapter's. Host trivia, by definition. */
const HOST_HOOKS: Record<string, HookName> = {
  [HOST_SESSION_START]: "session-start",
  [HOST_USER_PROMPT_SUBMIT]: "user-prompt-submit",
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
): { config: AdapterConfig; credentials: CredentialLoad; reason: string; stopAskShape: StopAskShape } {
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
    stopAskShape: stopAskShapeOf(raw),
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
    // Canonicalised HERE rather than trusted from the file: `recordSession`
    // canonicalises on write, so this is a no-op for every record this code
    // wrote — and a record written by anything else (a hand edit, an older
    // build, a future writer) would otherwise file this session's spans under a
    // directory keyed by a hash of a string nothing else spells that way.
    if (recorded !== undefined && recorded.length > 0) return canonicalScope(recorded);
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
  const transcriptPath =
    typeof payload["transcript_path"] === "string" && payload["transcript_path"].length > 0
      ? payload["transcript_path"]
      : undefined;
  const transcript = readTranscript(transcriptPath);
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope,
    turns: transcript.turns,
    expansions: transcript.expansions,
    // THE PATH ITSELF, beside the parse of it. The delivery check reads the head
    // of the same file for the attachment `parseTranscript` deliberately skips
    // (`hooks.ts#checkWakeArrival`), and a parsed turn list cannot answer for
    // what the host injected.
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
    // The host's re-fire of a blocked Stop, carried INTO the adapter and not
    // only handled at delivery: the pass that says nothing must also advance
    // nothing (`hooks.ts#askAtStop`).
    ...(payload["stop_hook_active"] === true ? { reFired: true } : {}),
    ...(typeof payload["prompt"] === "string" ? { prompt: payload["prompt"] } : {}),
    at: new Date().toISOString().slice(0, 10),
  };
}

/**
 * THE TWO EVENTS THE HOST DISPLAYS A `systemMessage` ON — measured by the
 * owner's probe on 2026-09-11 and re-stated in `hostDelivery` below. Every other
 * event's stand-down has nowhere to be seen, so it stays on stderr alone.
 */
const SAYS_SO_HOOKS: readonly SaysSoHook[] = ["session-start", "user-prompt-submit"];

/** Narrowed, so the say rule is written against the two events it is about. */
function saysSo(hook: HookName): hook is SaysSoHook {
  return (SAYS_SO_HOOKS as readonly HookName[]).includes(hook);
}

/**
 * MAY THIS EVENT'S FAULT REACH THE OWNER'S TERMINAL AT ALL — the three gates,
 * ahead of the question of what to say (`standdown.ts#decideSay`).
 *
 * Exported because a close-time throw cannot be induced from a hermetic test:
 * it needs a patched tree, which is how the review that found the `didWork` gap
 * proved it. The rule is worth pinning even so, and a pure predicate is the
 * honest shape for a thing a process cannot reach.
 */
export function reachesTheOwner(
  said: Pick<Said, "hook" | "wroteStdout" | "didWork">,
): said is Pick<Said, "hook" | "wroteStdout" | "didWork"> & { hook: SaysSoHook } {
  // The work already happened, so this is the tidying-up failing: stderr's.
  if (said.didWork) return false;
  // Nothing may follow the wake, or stdout stops parsing as JSON.
  if (said.wroteStdout) return false;
  // And only where the host displays a `systemMessage` at all.
  return saysSo(said.hook);
}

/**
 * WHAT THE STAND-DOWN PATH KNOWS ABOUT THIS EVENT SO FAR.
 *
 * Filled in as `main` learns each fact, because a fault can arrive before any of
 * them is known: an unopenable store throws after the configuration is read, a
 * refused configuration throws before there is a store to mark anything in.
 */
interface Said {
  readonly hook: HookName;
  readonly sessionId: string;
  /** The store this run meant to use, once a configuration named one. */
  dataDir: string | undefined;
  /**
   * TRUE once anything has gone to stdout. Nothing may follow it: the host reads
   * stdout as JSON only when the WHOLE of it parses, so a JSON object printed
   * after the wake would turn the wake into plain text and inject the warning
   * into the model's context instead of showing it to the owner.
   */
  wroteStdout: boolean;
  /**
   * TRUE once this event's WORK IS DONE — recall composed, the turn captured,
   * the session record written. A failure after that point is not a failure of
   * the turn, and must not be reported as one.
   *
   * It is a second flag rather than a reading of `wroteStdout`, and the review
   * that found this says why: `wroteStdout` is an ORDERING guard, and on
   * SessionStart the two coincide because SessionStart always writes stdout.
   * On UserPromptSubmit they come apart — an ordinary prompt with nothing to
   * inject writes nothing — so a throw from the `close()` in the `finally`
   * below, which is I38's own shape, told the owner "skipped this turn" about a
   * turn that had just succeeded. A warning that is sometimes false is the one
   * outcome this whole track cannot afford.
   */
  didWork: boolean;
}

/**
 * ONE LINE ON STDERR ALWAYS — AND, WHEN THIS WAS A FAULT, ONE RED LINE WHERE
 * THE OWNER WILL SEE IT.
 *
 * Exit code is untouched (0, always) and nothing else is injected: no wake, no
 * context, just the `systemMessage` the host displays. WHAT to say and WHETHER
 * to say it is `standdown.ts#decideSay`'s, which is the rule that tells a store
 * that will not open from a database that was merely busy; this function is the
 * process end of it — the two channels, the mark, and the ordering.
 *
 * `marker` is false for the two configuration refusals — the first has no store
 * at all, and the second stands down precisely so as not to touch the DEFAULT
 * store's host state on the way out (see its call site) — so those keep no count
 * and say it every turn. `standdown.ts` states why saying it again beats saying
 * nothing.
 */
function standDown(
  said: Said,
  what: { readonly line: string; readonly fault: StandDownFault | null; readonly marker: boolean },
): void {
  process.stderr.write(`[counterparts] hook stood down: ${what.line}\n`);
  const fault = what.fault;
  if (fault === null) return;
  if (!reachesTheOwner(said)) return;
  const dataDir = what.marker ? said.dataDir : undefined;
  const decision = decideSay(fault, said.hook, said.sessionId, readMark(dataDir, said.sessionId));
  // THE MARK IS WRITTEN EITHER WAY. A busy database nobody was told about is
  // still one this session has met, and the count is what decides the next one.
  writeMark(dataDir, said.sessionId, decision.mark);
  if (decision.message === null) return;
  process.stdout.write(JSON.stringify({ systemMessage: decision.message }));
  said.wroteStdout = true;
}

/**
 * A configuration refusal as a REASON clause. `config-path.ts` writes its
 * sentences to stand alone on stderr, so each opens with `refused: ` — which
 * inside this message would read "memory is OFF for this session: refused: …".
 * Said once.
 */
function refusalReason(sentence: string): string {
  const opener = "refused: ";
  return sentence.startsWith(opener) ? sentence.slice(opener.length) : sentence;
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
  const said: Said = {
    hook: name,
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    dataDir: undefined,
    wroteStdout: false,
    didWork: false,
  };
  // THE FAULT HANDLER, HERE RATHER THAN AT THE ENTRY POINT, because this is
  // where the event's own facts are in scope — which hook, which session, which
  // store — and all three are needed to say a stand-down out loud once. The
  // entry point's handler below stays exactly what it was: the last resort for
  // anything that fails before any of this is known.
  try {
    await runHook(name, payload, choice, said);
  } catch (err) {
    // MASTER'S EXIT CODE, RESTORED EXACTLY. On master a throw out of `main`
    // reached the entry point's rejection handler, which always exits 0 — so a
    // Stop that had set `exitCode = 2` for an ask and then threw on `close()`
    // exited 0. Catching the throw HERE let that 2 survive, which would have
    // blocked the stop and fed this hook's whole stderr back to the model as
    // Stop-hook feedback. Maybe an improvement; not this PR's to make. The one
    // thing that changes on this branch is that two displayed events gain a
    // `systemMessage`.
    process.exitCode = 0;
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = `Set "dataDir" in ${choice.path}, or set ${DATA_DIR_ENV}.`;
    standDown(said, {
      line: describeGuardRefusal(err, remedy) ?? detail,
      fault: classifyStandDown(err),
      marker: true,
    });
  }
}

async function runHook(
  name: HookName,
  payload: Record<string, unknown>,
  choice: ConfigChoice,
  said: Said,
): Promise<void> {
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
  //
  // ONE OF THE TWO IS A FAULT AND THE OTHER IS NOT. A configuration somebody
  // NAMED and that could not be honoured is the third of the three invisible
  // stand-downs H1 is about — a typo, and the adapter is off with nothing said.
  // The guard's refusal keeps the treatment it has: it is the normal state of
  // every agent and test shell in this project, and a red line in each of them
  // is how a warning becomes wallpaper (`standdown.ts#isDeliberate`).
  const named = namedConfigRefusal(choice);
  const refusal = named ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    // No marker: nothing has named a store yet, so there is nowhere to keep one.
    standDown(said, {
      line: refusal,
      fault:
        named === null ? null : { code: CONFIG_REFUSED, reason: refusalReason(named), kind: "persistent" },
      marker: false,
    });
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
  //
  // AND WHERE THE OWNER CAN SEE IT (I40, 2026-09-23). stderr from a hook that
  // exits 0 goes to the host's debug log and nowhere else, so this line was
  // written for nobody. It now rides the SessionStart `systemMessage` — the
  // channel the doctor notice already uses, and the one the owner's probe
  // measured displaying (`SAYS_SO_HOOKS`) — AFTER that notice and only if it
  // still fits (`hostDelivery`'s priority order). The stderr copy stays, for the
  // debug log and for the morning the envelope has no room for it.
  const trouble = name === "session-start" ? describeScopeTrouble(read, scopesPath(choice.path)) : null;
  if (trouble !== null) process.stderr.write(`${trouble}\n`);
  const { config: loaded, credentials, reason, stopAskShape } = hostConfig(choice.path);
  // THE THIRD ARM, and it is answered BEFORE anything reads under `dataDir`: a
  // named file that parses but whose fields do not typecheck resolves to
  // observer, and an observer with no `dataDir` reads the DEFAULT store.
  // Standing down is the only answer that keeps the promise the flag makes, and
  // standing down before the session registry is consulted is what keeps it from
  // touching the default store's host state on the way out. An unreadable
  // DEFAULT is unchanged — observer, as it always was.
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    // Said out loud, and with NO marker: `hostConfig` has already resolved
    // `dataDir` to the DEFAULT store, and leaving a file under it is exactly the
    // host state this stand-down exists to keep its hands off. So it says it
    // every turn instead — the cost of not touching a store this run refused.
    standDown(said, {
      line: unreadable,
      fault: { code: CONFIG_UNREADABLE, reason: refusalReason(unreadable), kind: "persistent" },
      marker: false,
    });
    return;
  }
  // From here the configuration was understood, so the store it names is the one
  // a stand-down may leave its once-per-session mark under.
  said.dataDir = loaded.dataDir;
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
    // THE WORK HAPPENED. Recall was composed, the turn was captured, the session
    // record was written — whatever this event's job was, `adapter.hook` has
    // done it and swallowed its own failures doing so (§5 G2). Anything that
    // throws from here on is a failure of the tidying-up, not of the turn, and
    // `standDown` keeps it to stderr.
    said.didWork = true;
    // THE NOTICE, AFTER THE WAKE AND ONLY AT SESSION START. Never on
    // user-prompt-submit: the owner asked for a warning, not a nag. `notice()`
    // is red-only, bounded, and returns null rather than throwing, so the line
    // below cannot change what the wake does on a healthy day.
    // In PRIORITY order (review M1): the doctor notice first, because it has no
    // other route to the owner; the registry line second, because it also has
    // stderr. A line that does not fit is left out, never the wake.
    //
    // AND THE UPDATE NOTICE AT A PROMPT (roadmap E, 2026-09-23): once per
    // session, when the MCP server this session talks to runs an older build
    // than this installed one. It is MARKED only once it is certainly leaving —
    // after the envelope is known to carry it — and SHOWN only if the mark
    // landed, so it never repeats and is never marked-but-lost. A turn whose
    // recall leaves no room drops it, marks nothing, and tries again next turn.
    const update = name === "user-prompt-submit" ? adapter.updateNotice(input) : null;
    const notices = name === "session-start" ? [adapter.notice(input), trouble] : update;
    let delivery = hostDelivery(name, result, payload, notices, stopAskShape);
    if (update !== null && delivery.dropped === null && !adapter.markUpdateNotice(input)) {
      delivery = hostDelivery(name, result, payload, null, stopAskShape);
    }
    // A SESSION THAT OPENS is stamped with the build that saw it open — never a
    // compaction, which is the same session and the same server carrying on.
    if (opensASession(payload)) adapter.stampOpened(input);
    // A notice the envelope could not carry leaves a row rather than nothing:
    // "the terminal said nothing" and "there was nothing to say" are different
    // facts about the same morning (scar §2.4).
    if (delivery.dropped !== null) adapter.noteNoticeDropped(delivery.dropped);
    if (delivery.stdout.length > 0) {
      process.stdout.write(delivery.stdout);
      // Recorded, not inferred: a fault thrown after this point (the close in
      // the `finally` below is inside the same try) may not print a second
      // object, or the wake stops being JSON and lands in the model's context.
      said.wroteStdout = true;
    }
    if (delivery.stderr.length > 0) process.stderr.write(delivery.stderr);
    // The update notice's decisions, where a person can find them (the host's
    // debug log): its ring rows die with this process otherwise. Written only
    // on a turn that had something to decide — due, shown, dropped, failed.
    if (name === "user-prompt-submit") {
      for (const e of [...adapter.events("adapter.update.notice"), ...adapter.events("adapter.notice.dropped")]) {
        process.stderr.write(`[counterparts] ${e.name}: ${JSON.stringify(e.data)}\n`);
      }
    }
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
 *     **Since B1 (2026-09-23) that is one of TWO shapes** (`StopAskShape`): the
 *     default is the host's documented JSON decision — `decision: "block"`,
 *     the model's ask as `reason`, one line for the person as `systemMessage`
 *     — and stderr + exit 2 stays behind the switch until the owner has looked
 *     at both.
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
  /** Non-null when a notice was left out to keep the wake whole — all of them,
   *  or (with several) the lower ones that no longer fit. */
  readonly dropped: { readonly noticeChars: number; readonly envelopeChars: number; readonly limitChars: number } | null;
}

export function hostDelivery(
  name: HookName,
  result: { injection: string | null; ask: string | null },
  payload: Record<string, unknown>,
  /**
   * The owner-facing line(s), or null: SessionStart's doctor notice and
   * registry line, UserPromptSubmit's update notice (roadmap E); every other
   * event ignores it. A LIST is a priority order (review M1): each is added
   * only while the envelope still fits, so a lower line can never cost a
   * higher one its place.
   */
  notice: string | null | readonly (string | null)[] = null,
  /** How a due Stop ask leaves (`STOP_ASK_SHAPE_KEY`). Ignored off Stop. */
  stopShape: StopAskShape = DEFAULT_STOP_ASK_SHAPE,
): Delivery {
  const ask = result.ask !== null && result.ask.length > 0 ? result.ask : null;
  if (name !== "stop") {
    const out = [result.injection ?? "", ask ?? ""].filter((s) => s.length > 0).join("\n\n");
    const notices = (typeof notice === "string" || notice === null ? [notice] : notice).filter(
      (n): n is string => n !== null && n.length > 0,
    );
    if (name === "session-start" && notices.length > 0) {
      const envelopeOf = (message: string): string =>
        JSON.stringify({
          systemMessage: message,
          hookSpecificOutput: { hookEventName: HOST_SESSION_START, additionalContext: out },
        });
      // THE WAKE WINS. Over `ENVELOPE_MAX_CHARS` the host would replace this
      // whole string with a preview, the JSON would stop parsing, and the
      // session would start with no memory at all — a worse outcome than not
      // seeing the warning, which `counterparts doctor` prints on request.
      // And the notices go in in the order given, each only if it still fits.
      const kept: string[] = [];
      const left: string[] = [];
      for (const n of notices) {
        if (envelopeOf([...kept, n].join("\n")).length <= ENVELOPE_MAX_CHARS) kept.push(n);
        else left.push(n);
      }
      const dropped =
        left.length === 0
          ? null
          : {
              noticeChars: left.join("\n").length,
              envelopeChars: envelopeOf(notices.join("\n")).length,
              limitChars: ENVELOPE_MAX_CHARS,
            };
      if (kept.length === 0) return { stdout: out, stderr: "", exitCode: 0, dropped };
      return { stdout: envelopeOf(kept.join("\n")), stderr: "", exitCode: 0, dropped };
    }
    // THE UPDATE NOTICE, AT A PROMPT (roadmap E, 2026-09-23) — the same
    // envelope and the same rule: the turn's recall rides whole in
    // `additionalContext` or the notice waits. A turn with no recall prints the
    // `systemMessage` alone rather than an empty context field. A prompt with
    // no notice prints what it always has — plain text, or nothing. More than
    // one line would be JOINED into the one `systemMessage` an object carries,
    // never one replacing another; today the update notice is the only one.
    if (name === "user-prompt-submit" && notices.length > 0) {
      const message = notices.join("\n");
      const envelope = JSON.stringify({
        systemMessage: message,
        ...(out.length === 0
          ? {}
          : { hookSpecificOutput: { hookEventName: HOST_USER_PROMPT_SUBMIT, additionalContext: out } }),
      });
      if (envelope.length > ENVELOPE_MAX_CHARS) {
        return {
          stdout: out,
          stderr: "",
          exitCode: 0,
          dropped: { noticeChars: message.length, envelopeChars: envelope.length, limitChars: ENVELOPE_MAX_CHARS },
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
  if (stopShape === "stderr") return { stdout: "", stderr: ask, exitCode: 2, dropped: null };
  // EXIT 0, because the JSON is the decision: the host reads stdout as JSON on
  // every exit code, but exit 2 would make STDERR the blocking message and
  // turn this back into the other shape. One line, no trailing newline, so the
  // whole of stdout is the object. The ask is ~430 characters, far inside the
  // host's 10,000-character cap on a `reason`.
  return {
    stdout: JSON.stringify({ decision: "block", reason: ask, systemMessage: STOP_HUMAN_LINE }),
    stderr: "",
    exitCode: 0,
    dropped: null,
  };
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
