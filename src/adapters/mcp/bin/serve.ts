#!/usr/bin/env bun
/**
 * The MCP entry point. Speaks JSON-RPC over stdio and nothing else.
 *
 * Run by a host as, e.g.:
 *
 *   bun run <repo>/src/adapters/mcp/bin/serve.ts --session <id> --scope <dir>
 *
 * Everything host-specific arrives as an ARGUMENT or a named environment
 * variable, and the session id is one of them when the host can supply it: this
 * server deposits under exactly one session (`server.ts`, refusal 1), and being
 * TOLD which one at launch is still the preferred path.
 *
 * **Measured 2026-09-04:** Claude Code cannot use that path. Its MCP servers are
 * registered from a static configuration — command, args, env — with no per-
 * session substitution, so neither `--session` nor `COUNTERPARTS_SESSION` ever
 * arrives, and for the whole first run every dump was refused `no-bound-session`.
 * The flags below are unchanged and still win; a launch without them now falls
 * through to `server.ts`'s lazy bind against `adapters/sessions.ts`'s registry.
 *
 * `--dir` is here for the same reason `hook.ts` pins the data dir onto its
 * child: the registry is found under the data dir, so the two sides have to
 * resolve the SAME one. Absent, both fall back to `dataDir()` and agree anyway.
 *
 * Nothing in this file is a memory rule; all of it is host trivia (§5 G8).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  configLine,
  defaultConfigPath,
  namedConfigRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";
import { loadConfig } from "../../claude-code/config.js";
import { loadCredentials, permissionWarning } from "../../claude-code/credentials.js";
import type { CredentialLoad } from "../../claude-code/credentials.js";
import { openEmbedder } from "../../claude-code/embed-client.js";
import type { LiveEmbedder } from "../../claude-code/embed-client.js";
import { openServer } from "../index.js";
import { serveStdio } from "../stdio.js";

/**
 * The same file `bin/hook.ts` and `bin/runner.ts` read by default. One
 * configuration for this host, four entry points — never four ideas of where the
 * keys live, and since 2026-09-05 never four ideas of how to move it either:
 * `--config <absolute path>`, else `COUNTERPARTS_CONFIG`, else this
 * (`adapters/config-path.ts`).
 *
 * The environment variable matters MORE here than anywhere else. This host
 * registers an MCP server from a static configuration — command, args, env — so
 * `-e COUNTERPARTS_CONFIG=…` in the `claude mcp add` line is the only way a
 * server launched by it can be pointed at anything but the default. That is why
 * the variable exists at all.
 */
export const CONFIG_PATH = defaultConfigPath();

export const ENV = {
  session: "COUNTERPARTS_SESSION",
  scope: "COUNTERPARTS_SCOPE",
  dir: "COUNTERPARTS_DATA_DIR",
  owner: "COUNTERPARTS_OWNER",
  observer: "COUNTERPARTS_OBSERVER",
} as const;

export interface LaunchOptions {
  session?: string;
  scope?: string;
  dir?: string;
  owner: boolean;
  observer: boolean;
}

/** Flags beat environment; absent means absent, never a guessed default. */
export function launchOptions(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): LaunchOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      session: { type: "string" },
      scope: { type: "string" },
      dir: { type: "string" },
      owner: { type: "boolean" },
      observer: { type: "boolean" },
      // Declared so `strict: false` does not read `--config <path>` as a boolean
      // and leave the path as a stray positional. The VALUE is resolved by
      // `serverConfigChoice` below, which is the one rule all four entry points
      // share; this declaration only keeps the parse honest.
      config: { type: "string" },
    },
    strict: false,
  });
  const flag = (name: keyof typeof ENV): boolean =>
    values[name] === true || env[ENV[name]] === "1" || env[ENV[name]] === "true";
  const session = (values["session"] as string | undefined) ?? env[ENV.session];
  const scope = (values["scope"] as string | undefined) ?? env[ENV.scope];
  const dir = (values["dir"] as string | undefined) ?? env[ENV.dir];
  return {
    ...(session === undefined || session.length === 0 ? {} : { session }),
    ...(scope === undefined || scope.length === 0 ? {} : { scope }),
    ...(dir === undefined || dir.length === 0 ? {} : { dir }),
    owner: flag("owner"),
    observer: flag("observer"),
  };
}

/**
 * The embedder this server may use, and the credential load that made it
 * possible — read HERE, at the process entry point, for the same reason
 * `bin/hook.ts` reads it there: the host hands MCP servers a process
 * environment that carries neither key (measured, day 0 of the parallel run),
 * so a server that only consults `process.env` embeds nothing, ever.
 *
 * It is the ONE thing this entry point adds to the server's powers, and it is
 * used for exactly one call: embedding a deliberate question. `env` is injected
 * so a test proves the whole path over a fresh object rather than the suite's
 * own process, and no value is ever returned, logged or emitted — only names.
 */
export function questionEmbedder(
  path = CONFIG_PATH,
  env: NodeJS.ProcessEnv = process.env,
): { embedder: LiveEmbedder | null; credentials: CredentialLoad; credentialsFile?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent is ordinary; unreadable resolves to OBSERVER inside `loadConfig`,
    // and an observer opens no socket at all.
    raw = undefined;
  }
  const config = loadConfig(raw).config;
  const credentials = loadCredentials(config.credentialsFile, env);
  return {
    // `openEmbedder` is the ONE answer to "is there an embedder": the knob is
    // the gate, an observer gets none, and a missing key refuses by name on the
    // first call rather than being re-checked here.
    embedder: openEmbedder(config),
    credentials,
    ...(config.credentialsFile === undefined ? {} : { credentialsFile: config.credentialsFile }),
  };
}

/**
 * Which configuration this server will read, and which rule chose it. Exported
 * and injectable for the same reason `launchOptions` is: the rule is provable
 * without a process on stdin.
 *
 * **The store is NOT decided here.** It still comes from `--dir`, else
 * `COUNTERPARTS_DATA_DIR`, else the default — this file answers "whose keys and
 * whose embedder knob", which is the other half of the trap QUICKSTART §10.3
 * names, not the same half.
 */
export function serverConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

async function main(): Promise<void> {
  const opts = launchOptions(process.argv.slice(2), process.env);
  const choice = serverConfigChoice();
  const refusal = namedConfigRefusal(choice);
  if (refusal !== null) {
    // A server told to read a configuration it cannot resolve — relative, or
    // absolute and not there — does not fall back to the default one: on a
    // machine with an install, that default is somebody else's keys. It refuses
    // to start, loudly, on stderr.
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const { embedder, credentials, credentialsFile } = questionEmbedder(choice.path);
  // stderr, never stdout — stdout is the JSON-RPC wire. This is this entry
  // point's "which file answered": printed at every launch, before a byte of
  // protocol, because a server reading a configuration nobody named is exactly
  // how a scratch run came to embed on the owner's key (2026-09-04).
  process.stderr.write(`[counterparts] config: ${configLine(choice)}\n`);
  const warning = permissionWarning(credentialsFile, credentials);
  // stderr, never stdout: stdout is the JSON-RPC wire. Warned, never refused.
  if (warning !== null) process.stderr.write(`${warning}\n`);
  const server = openServer({ ...opts, embedder });
  try {
    await serveStdio(server, process.stdin, {
      write: (chunk) => {
        process.stdout.write(chunk);
      },
    });
  } finally {
    server.counterpart.close();
  }
}

/** True only when this file is the process entry point — so a test may import
 *  `launchOptions` without the server starting itself on stdin. */
export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main().then(
    // `process.exitCode` is 1 when the launch refused a named configuration it
    // could not honour; every other path ends 0.
    () => process.exit(process.exitCode === 1 ? 1 : 0),
    () => process.exit(1),
  );
}
