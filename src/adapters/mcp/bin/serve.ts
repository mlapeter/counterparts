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
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { openServer } from "../index.js";
import { serveStdio } from "../stdio.js";

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

async function main(): Promise<void> {
  const opts = launchOptions(process.argv.slice(2), process.env);
  const server = openServer(opts);
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
