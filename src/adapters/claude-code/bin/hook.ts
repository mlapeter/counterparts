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

import { dataDir } from "../../../core/store/index.js";
import {
  defaultConfigPath,
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";
import { loadConfig } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { loadCredentials, permissionWarning } from "../credentials.js";
import type { CredentialLoad } from "../credentials.js";
import { HOOKS, openAdapter } from "../index.js";
import type { HookInput, HookName } from "../hooks.js";
import { readTranscript } from "../transcript.js";

/** The host's event names, mapped to this adapter's. Host trivia, by definition. */
const HOST_HOOKS: Record<string, HookName> = {
  SessionStart: "session-start",
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

export function toHookInput(payload: Record<string, unknown>): HookInput {
  const scope = typeof payload["cwd"] === "string" ? resolve(payload["cwd"]) : process.cwd();
  const transcript = readTranscript(
    typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : undefined,
  );
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope,
    turns: transcript.turns,
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
  const { config, credentials, reason } = hostConfig(choice.path);
  // The third arm: a named file that parses but whose fields do not typecheck
  // resolves to observer, and an observer with no `dataDir` reads the DEFAULT
  // store. Standing down is the only answer that keeps the promise the flag
  // makes. An unreadable DEFAULT is unchanged — observer, as it always was.
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`[counterparts] hook stood down: ${unreadable}\n`);
    return;
  }
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
  });
  try {
    const result = adapter.hook(name, toHookInput(payload));
    const delivery = hostDelivery(name, result, payload);
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
 * Pure, so the test proves the channel choice without a process.
 */
export function hostDelivery(
  name: HookName,
  result: { injection: string | null; ask: string | null },
  payload: Record<string, unknown>,
): { stdout: string; stderr: string; exitCode: 0 | 2 } {
  const ask = result.ask !== null && result.ask.length > 0 ? result.ask : null;
  if (name !== "stop") {
    const out = [result.injection ?? "", ask ?? ""].filter((s) => s.length > 0).join("\n\n");
    return { stdout: out, stderr: "", exitCode: 0 };
  }
  // The re-fire is refused twice on purpose: the adapter asks nothing on it, and
  // this channel would not carry it even if something did.
  if (payload["stop_hook_active"] === true || ask === null) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  return { stdout: "", stderr: ask, exitCode: 2 };
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
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[counterparts] hook stood down: ${detail}\n`);
      process.exit(0);
    },
  );
}
