#!/usr/bin/env bun
/**
 * THE MEMORY SERVER AS A WEB CONNECTOR (2026-10-26, the claude.ai trial).
 *
 *   bun src/adapters/remote/bin/serve-http.ts --dir <store> --config <file> \
 *     [--port <n>] [--call-log <file>] [--canary <sentence>]
 *
 * The same tools over the same store as `mcp/bin/serve.ts`, served to
 * claude.ai's chat over HTTP (`../http.ts`) instead of to a host over stdio. The
 * host is claude.ai's from the start (`hosts.ts#CLAUDE_AI_HOST`): its place is
 * `claude-ai:`, its sessions are minted by `wake`, and no client name changes
 * that.
 *
 * WHAT IT REFUSES, before a byte is served:
 *
 *   - **A store nobody named.** `--dir` is required, whatever the environment
 *     says, and the owner's live stores are refused (`liveStoreRefusal`): this
 *     door puts a store on the web.
 *   - **A configuration nobody named, or one it cannot read** — the rules every
 *     entry point shares (`config-path.ts`).
 *
 * WHAT IT PRINTS: one line on stdout, `url <http://127.0.0.1:port/secret>`, the
 * only place the secret appears; everything else goes to stderr, without it.
 * The trial script reads that line, starts the tunnel to the port, and prints
 * the public URL once. Ctrl-C (or SIGTERM) stops it, and the URL dies with it.
 */
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { configLine, implicitConfigRefusal, namedConfigRefusal, namedUnreadableRefusal, resolveConfigPath } from "../../config-path.js";
import { CLAUDE_AI_HOST } from "../../hosts.js";
import { openServer } from "../../mcp/index.js";
import { isEntryPoint, questionEmbedder } from "../../mcp/bin/serve.js";
import { openLog } from "../../log/index.js";
import type { LogEvent, ProcessLog } from "../../log/index.js";
import { scopesPath } from "../../scopes.js";
import { WORKER_RUNNER_PATH } from "../../spawn.js";
import { scriptArgs } from "../../runtime.js";
import { observerFromEnv, OBSERVER_ENV } from "../../stance-env.js";
import { assertSafeDataDir } from "../../../core/store/index.js";
import { serveHttp } from "../http.js";
import { openCallLog } from "../call-log.js";

/**
 * The stores this door never serves, whatever it is told: the owner's live
 * `~/.counterparts`, which the store seam does not refuse (any install may use
 * it), and the ancestors' stores, which it does (`store/paths.ts`, the one
 * place their names are spelled).
 */
export function liveStoreRefusal(dir: string, home: string = homedir()): string | null {
  const resolved = resolve(dir);
  const live = join(home, ".counterparts");
  if (resolved === live || resolved.startsWith(`${live}${sep}`)) {
    return `[counterparts] refused: ${live} is a live store, and this server puts a store on the web. Name a trial store of its own with --dir.`;
  }
  try {
    assertSafeDataDir(resolved);
  } catch {
    return "[counterparts] refused: that directory is off-limits to this package. Name a trial store of its own with --dir.";
  }
  return null;
}

export interface HttpLaunch {
  readonly dir: string;
  readonly port: number;
  readonly callLog?: string;
  readonly canary?: string;
}

/** The flags, read; a refusal sentence instead when they cannot be honoured. Pure. */
export function readLaunch(argv: readonly string[]): HttpLaunch | { refusal: string } {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dir: { type: "string" },
      config: { type: "string" },
      port: { type: "string" },
      "call-log": { type: "string" },
      canary: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const dir = values.dir;
  if (dir === undefined || dir.trim().length === 0) {
    return { refusal: "[counterparts] refused: name the store with --dir. This server puts a store on the web, so it never falls back to a default one." };
  }
  const live = liveStoreRefusal(dir);
  if (live !== null) return { refusal: live };
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { refusal: "[counterparts] refused: --port is a whole number from 0 to 65535." };
  return {
    dir: resolve(dir),
    port,
    ...(values["call-log"] === undefined ? {} : { callLog: resolve(values["call-log"]) }),
    ...(values.canary === undefined || values.canary.trim().length === 0 ? {} : { canary: values.canary.trim() }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let launch: HttpLaunch | { refusal: string };
  try {
    launch = readLaunch(argv);
  } catch (err) {
    launch = { refusal: `[counterparts] refused: ${err instanceof Error ? err.message : String(err)}` };
  }
  if ("refusal" in launch) {
    process.stderr.write(`${launch.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  // THE CONFIGURATION, by the rule every entry point shares — and here it must
  // be NAMED: the default one is somebody's, and names somebody's store.
  const choice = resolveConfigPath(argv, process.env as Record<string, string | undefined>);
  const named = choice.source !== "default" ? null : "[counterparts] refused: name the configuration with --config. This server never reads the default one.";
  const refusal = named ?? namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const { embedder, reason, snapshotsDir, timeZone, pageWriterMode, config } = questionEmbedder(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`${unreadable}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`[counterparts] config: ${configLine(choice)}\n`);
  const observer = observerFromEnv(process.env as Record<string, string | undefined>, false, OBSERVER_ENV);
  let log: ProcessLog | null = null;
  const toLog = (e: LogEvent): void => log?.event(e);
  const server = openServer({
    dir: launch.dir,
    host: CLAUDE_AI_HOST,
    observer: observer.on,
    ...(launch.canary === undefined ? {} : { canary: launch.canary }),
    // NOTHING OF A HOST'S ENVIRONMENT (2026-10-26): a server started from a
    // terminal inside Claude Code would otherwise carry its markers, and the
    // nightly run's child variables are not this process's either.
    env: {},
    onEvent: toLog,
    onCounterpartEvent: toLog,
    scopesFile: scopesPath(choice.path),
    embedder,
    ...(snapshotsDir === undefined ? {} : { snapshotsDir }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(pageWriterMode === undefined ? {} : { pageWriterMode }),
    lifecycle: {
      // The store the flag named, whatever the file says: one store, one door.
      config: { ...config, dataDir: launch.dir },
      configPath: choice.path,
      command: process.execPath,
      args: scriptArgs(WORKER_RUNNER_PATH),
    },
  });
  server.recordLaunch();
  const opened = openLog({
    dataDir: server.counterpart.store.dir,
    proc: "mcp",
    session: () => server.session,
    ...(timeZone === undefined ? {} : { timeZone }),
    observer: server.observer,
  });
  log = opened;
  opened.start({ boundSession: false });
  const calls = launch.callLog === undefined ? null : openCallLog(launch.callLog);
  let running;
  try {
    running = await serveHttp({
      server,
      port: launch.port,
      onCall: (r) => calls?.write(r),
    });
  } catch (err) {
    process.stderr.write(`[counterparts] the HTTP server did not start: ${err instanceof Error ? err.message : String(err)}\n`);
    server.forgetLaunch();
    server.counterpart.close();
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`[counterparts] serving claude.ai's tools on 127.0.0.1:${String(running.port)} (store ${server.counterpart.store.dir}${launch.canary === undefined ? "" : ", canary set"})\n`);
  // THE ONE LINE THAT CARRIES THE SECRET.
  process.stdout.write(`url ${running.url}\n`);
  await new Promise<void>((resolveStop) => {
    const stop = (): void => resolveStop();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("SIGHUP", stop);
  });
  await running.close();
  opened.end("signal");
  server.forgetLaunch();
  server.counterpart.close();
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main().then(
    () => process.exit(process.exitCode === 1 ? 1 : 0),
    (err: unknown) => {
      process.stderr.write(`[counterparts] server did not start: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
