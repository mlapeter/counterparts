#!/usr/bin/env bun
/**
 * The MCP entry point. Speaks JSON-RPC over stdio and nothing else.
 *
 * Run by a host as, e.g.:
 *
 *   bun run <repo>/src/adapters/mcp/bin/serve.ts --session <id> --scope <dir>
 *
 * Everything host-specific arrives as an ARGUMENT or a named environment
 * variable, and the session id is one of them: this server deposits under
 * exactly one session (`server.ts`, refusal 1), so which session it is has to be
 * decided at launch by the host, not at call time by the model.
 *
 * Nothing in this file is a memory rule; all of it is host trivia (§5 G8).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadConfig } from "../../claude-code/config.js";
import { loadCredentials, permissionWarning } from "../../claude-code/credentials.js";
import type { CredentialLoad } from "../../claude-code/credentials.js";
import { openEmbedder } from "../../claude-code/embed-client.js";
import type { LiveEmbedder } from "../../claude-code/embed-client.js";
import { openServer } from "../index.js";
import { serveStdio } from "../stdio.js";

/** The same file `bin/hook.ts` and `bin/runner.ts` read. One configuration for
 *  this host, three entry points — never three ideas of where the keys live. */
export const CONFIG_PATH = join(homedir(), ".counterparts", "claude-code.json");

export const ENV = {
  session: "COUNTERPARTS_SESSION",
  scope: "COUNTERPARTS_SCOPE",
  owner: "COUNTERPARTS_OWNER",
  observer: "COUNTERPARTS_OBSERVER",
} as const;

export interface LaunchOptions {
  session?: string;
  scope?: string;
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
      owner: { type: "boolean" },
      observer: { type: "boolean" },
    },
    strict: false,
  });
  const flag = (name: keyof typeof ENV): boolean =>
    values[name] === true || env[ENV[name]] === "1" || env[ENV[name]] === "true";
  const session = (values["session"] as string | undefined) ?? env[ENV.session];
  const scope = (values["scope"] as string | undefined) ?? env[ENV.scope];
  return {
    ...(session === undefined || session.length === 0 ? {} : { session }),
    ...(scope === undefined || scope.length === 0 ? {} : { scope }),
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

async function main(): Promise<void> {
  const opts = launchOptions(process.argv.slice(2), process.env);
  const { embedder, credentials, credentialsFile } = questionEmbedder();
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
    () => process.exit(0),
    () => process.exit(1),
  );
}
