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
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { dataDir } from "../../../core/store/index.js";
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

/** Where the host's configuration for this package lives. */
export const CONFIG_PATH = join(homedir(), ".counterparts", "claude-code.json");

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
): { config: AdapterConfig; credentials: CredentialLoad } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent is ordinary; unreadable resolves to OBSERVER inside `loadConfig`,
    // which is the fail direction observer-mode G5 requires.
    raw = undefined;
  }
  const loaded = loadConfig(raw).config;
  // Only a configuration we UNDERSTOOD names a file. An unreadable one resolves
  // to `{ observer: true }` above, and an observer opens no credential.
  const credentials = loadCredentials(loaded.credentialsFile, env);
  // The data dir is RESOLVED here and carried explicitly, so the spawner has a
  // value to pin onto the child (scar §2.13). Leaving it undefined would make
  // the parent and the child resolve it independently, from an environment
  // either of them might have inherited differently.
  return { config: { ...loaded, dataDir: loaded.dataDir ?? dataDir() }, credentials };
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

  const { config, credentials } = hostConfig();
  // A file the group or the world can read is WARNED about, by mode, and never
  // refused: the owner's machine, the owner's call (§5 G2 — a throw here would
  // fail the host over a permission bit).
  const warning = permissionWarning(config.credentialsFile, credentials);
  if (warning !== null) process.stderr.write(`${warning}\n`);
  const adapter = openAdapter(config, {
    command: process.execPath,
    args: ["run", RUNNER_PATH],
    credentials,
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
  result: { injection: string | null; authorshipAsk: string | null; ask: string | null },
  payload: Record<string, unknown>,
): { stdout: string; stderr: string; exitCode: 0 | 2 } {
  const asks = [result.authorshipAsk, result.ask].filter((s): s is string => s !== null && s.length > 0);
  if (name !== "stop") {
    const out = [result.injection ?? "", ...asks].filter((s) => s.length > 0).join("\n\n");
    return { stdout: out, stderr: "", exitCode: 0 };
  }
  if (payload["stop_hook_active"] === true || asks.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  return { stdout: "", stderr: asks.join("\n\n"), exitCode: 2 };
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
