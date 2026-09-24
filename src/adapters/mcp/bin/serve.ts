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
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";
import {
  describeScopeTrouble,
  effectiveStance,
  lookupScope,
  readScopes,
  scopesPath,
} from "../../scopes.js";
import { loadConfig, withEmbedderDefault } from "../../claude-code/config.js";
import { openEmbedder } from "../../claude-code/embed-client.js";
import type { LiveEmbedder } from "../../claude-code/embed-client.js";
import { hostScope, openServer } from "../index.js";
import { serveStdio } from "../stdio.js";
import { DATA_DIR_ENV, describeGuardRefusal } from "../../../core/store/index.js";
import {
  OBSERVER_ENV,
  OWNER_ENV,
  observerFromEnv,
  ownerFromEnv,
  unreadableStanceLine,
} from "../../stance-env.js";

/**
 * The same file `bin/hook.ts` and `bin/runner.ts` read by default. One
 * configuration for this host, four entry points — never four ideas of which
 * file answers, and since 2026-09-05 never four ideas of how to move it either:
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
  // The two stance names come from `adapters/stance-env.ts`, not from a second
  // pair of string literals here. That module's whole argument is that two
  // strings which must agree and are written twice have already begun to
  // disagree — it would be a poor place to start a third copy (G39).
  owner: OWNER_ENV,
  observer: OBSERVER_ENV,
} as const;

export interface LaunchOptions {
  session?: string;
  scope?: string;
  dir?: string;
  owner: boolean;
  observer: boolean;
  /**
   * One line per stance variable this launch could not read, ready for stderr.
   * ALWAYS present, usually empty — a caller destructures it off before the
   * rest goes to `openServer`, so the stance stays a pair of booleans and the
   * complaint stays a string. Keeping it here rather than printing from inside
   * `launchOptions` is what keeps that function pure: it is the one thing in
   * this file a test can call over a fresh object with no process involved.
   */
  unreadable: readonly string[];
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
  // THE TWO STANCE VARIABLES ARE READ THE WAY THE GUARD NEXT DOOR IS READ
  // (G39). This used to be one `flag()` closure matching `"1"` and `"true"`
  // exactly, so `=on`, `=True` and `= 1 ` — the set
  // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` documents — all fell silently to
  // "ordinary session". `adapters/stance-env.ts` carries the shared reading and
  // the argument for each fail direction: observer collapses junk to OBSERVER
  // (`docs/observer-mode.md` G5, fail toward standing down), owner collapses it
  // to NOT owner. Same helper, opposite boolean, because least privilege is the
  // opposite boolean for a bit that grants reach and a bit that withholds it.
  const observer = observerFromEnv(env, values["observer"] === true, ENV.observer);
  const owner = ownerFromEnv(env, values["owner"] === true, ENV.owner);
  const unreadable: string[] = [];
  if (observer.malformed !== null) {
    unreadable.push(
      unreadableStanceLine(ENV.observer, observer.malformed, "standing down to observer stance"),
    );
  }
  if (owner.malformed !== null) {
    unreadable.push(
      unreadableStanceLine(ENV.owner, owner.malformed, "this launch is NOT owner-stanced"),
    );
  }
  const session = (values["session"] as string | undefined) ?? env[ENV.session];
  const scope = (values["scope"] as string | undefined) ?? env[ENV.scope];
  const dir = (values["dir"] as string | undefined) ?? env[ENV.dir];
  return {
    ...(session === undefined || session.length === 0 ? {} : { session }),
    ...(scope === undefined || scope.length === 0 ? {} : { scope }),
    ...(dir === undefined || dir.length === 0 ? {} : { dir }),
    owner: owner.on,
    observer: observer.on,
    unreadable,
  };
}

/**
 * The embedder this server may use, decided by the configuration this process
 * read — the local table, unless the configuration switched it off.
 *
 * It is the ONE thing this entry point adds to the server's powers, and it is
 * used for exactly one call: embedding a deliberate question.
 */
export function questionEmbedder(path = CONFIG_PATH): {
  embedder: LiveEmbedder | null;
  reason: string;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent is ordinary; unreadable resolves to OBSERVER inside `loadConfig`,
    // and an observer opens no embedder at all.
    raw = undefined;
  }
  const load = loadConfig(raw);
  // THE EMBEDDER DEFAULT (config.ts#resolveEmbedder): the rule the hook and the
  // worker apply, so the server embeds a question with the table they use.
  const config = withEmbedderDefault(load.config);
  return {
    reason: load.reason,
    // `openEmbedder` is the ONE answer to "is there an embedder": the knob is
    // the gate and an observer gets none.
    embedder: openEmbedder(config),
  };
}

/**
 * Which configuration this server will read, and which rule chose it. Exported
 * and injectable for the same reason `launchOptions` is: the rule is provable
 * without a process on stdin.
 *
 * **The store is NOT decided here.** It still comes from `--dir`, else
 * `COUNTERPARTS_DATA_DIR`, else the default — this file answers "whose embedder
 * knob", which is the other half of the trap QUICKSTART §11.3 names, not the
 * same half.
 */
export function serverConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

async function main(): Promise<void> {
  const { unreadable: stanceNotices, ...opts } = launchOptions(process.argv.slice(2), process.env);
  // stderr, never stdout (stdout is the JSON-RPC wire), and BEFORE the config
  // refusals: a stance variable nobody could read changed what this server may
  // do, and the transcript has to say so even on a launch that then refuses for
  // an unrelated reason (scar §2.4 — a path that discards something says what).
  for (const line of stanceNotices) process.stderr.write(`${line}\n`);
  const choice = serverConfigChoice();
  // The second refusal is the explicit-dir guard (`config-path.ts#implicitConfigRefusal`):
  // armed, an UNNAMED configuration refuses the launch too — the default one is
  // somebody's configuration and names somebody's store. Never armed on the live host.
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    // A server told to read a configuration it cannot resolve — relative, or
    // absolute and not there — does not fall back to the default one: on a
    // machine with an install, that default is somebody else's. It refuses
    // to start, loudly, on stderr.
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const { embedder, reason } = questionEmbedder(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`${unreadable}\n`);
    process.exitCode = 1;
    return;
  }
  // stderr, never stdout — stdout is the JSON-RPC wire. This is this entry
  // point's "which file answered": printed at every launch, before a byte of
  // protocol, because a server reading a configuration nobody named is exactly
  // how a scratch run came to embed on the owner's key (2026-09-04).
  process.stderr.write(`[counterparts] config: ${configLine(choice)}\n`);
  // WHICH DIRECTORY, AND WHAT THE HOST WAS TOLD ABOUT IT. The registry sits
  // beside the configuration this launch resolved, so `-e COUNTERPARTS_CONFIG=…`
  // moves both together and a scratch install's scopes are its own.
  //
  // The server still STARTS in a directory set `off`: a server that refused to
  // launch is reported by this host as "MCP server failed", which is a broken
  // tool rather than a directory that asked to be left alone — and the `scope`
  // tool is what turns it back on, so it has to be reachable. Every other tool
  // refuses `scope-off`, per call, from the file as it stands at that moment.
  const scopesFile = scopesPath(choice.path);
  const scopeRead = readScopes(scopesFile);
  // THE SAME RULE THE SERVER ITSELF WILL APPLY, from the same function: the
  // launch's own `--scope`, else `CLAUDE_PROJECT_DIR` — which this host exports
  // to stdio MCP servers and to hooks alike, and which is what makes this
  // server's scope and the hooks' session scope the same string — else this
  // process's working directory. Resolved once, so the registry is consulted
  // about exactly the directory the server goes on to run in.
  const serverScope = hostScope(opts.scope)?.scope ?? process.cwd();
  const scopeVerdict = lookupScope(scopeRead.registry, serverScope);
  // THE SAME SENTENCE THE HOOK PRINTS, from the same function (#92 review, F2).
  // It was written out inline here and covered only a whole-file failure, so a
  // registry whose ENTRIES were refused — one typo'd `off` among good ones —
  // gave the operator nothing at the one moment this process can speak to them.
  const trouble = describeScopeTrouble(scopeRead, scopesFile);
  if (trouble !== null) process.stderr.write(`${trouble}\n`);
  // ONE line at launch when this directory is not an ordinary one — the only
  // channel this process has to the operator, and the difference between a
  // muted server and a broken one (scar §2.4).
  const stance = effectiveStance(opts.observer, scopeVerdict.mode);
  if (stance !== "on" || scopeVerdict.mode !== "unset") {
    process.stderr.write(
      `[counterparts] scope: ${serverScope} is ${scopeVerdict.mode}` +
        `${scopeVerdict.matched === null ? "" : ` (set by ${scopeVerdict.matched})`}` +
        ` — this server runs ${stance}.\n`,
    );
  }
  const server = openServer({
    ...opts,
    // THE COMBINATION, most restrictive wins: a registry that says `observer`
    // stands the server down even when the configuration did not, and a
    // configuration that already said so is never relaxed by a registry.
    //
    // `off` deliberately does NOT set the observer bit. Under observer every
    // tool stands down INCLUDING `scope`'s write, and `scope` is the one door
    // that has to keep working in an off directory or the switch only turns one
    // way. Nothing is at risk: every other tool refuses `scope-off` one layer
    // above, per call, before it can reach a store.
    observer: stance === "observer" || opts.observer,
    scopesFile,
    embedder,
  });
  // THE BUILD THIS PROCESS WILL KEEP FOR THE REST OF THE SESSION, left where
  // the hooks can compare it with the installed one every turn
  // (`server.ts#recordLaunch`). Taken away again at a clean exit; a server the
  // host kills outright leaves a record that reads as dead and is pruned.
  server.recordLaunch();
  try {
    await serveStdio(server, process.stdin, {
      write: (chunk) => {
        process.stdout.write(chunk);
      },
    });
  } finally {
    server.forgetLaunch();
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
    (err: unknown) => {
      // A server that cannot start SAYS why, on stderr (stdout is the wire).
      // Before this line, the gap between the two guards — a named configuration
      // that names no store, no `--dir`, no variable — was a bare exit 1 that
      // the host reports as "MCP server failed" and nothing else (#80 review).
      // The explicit-dir guard gets a sentence with THIS entry point's remedy;
      // any other failure gets its own message.
      const detail = err instanceof Error ? err.message : String(err);
      const remedy = `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`;
      process.stderr.write(
        `${describeGuardRefusal(err, remedy) ?? `[counterparts] server did not start: ${detail}`}\n`,
      );
      process.exit(1);
    },
  );
}
