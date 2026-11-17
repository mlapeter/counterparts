#!/usr/bin/env bun
/**
 * CODEX'S HOOK ENTRY (2026-11-09, CX2). One executable for the four events
 * `counterparts connect --host codex` wires into `$CODEX_HOME/hooks.json`,
 * dispatching on the payload's `hook_event_name`. Run by Codex as, e.g.:
 *
 *   ~/.bun/bin/bun --no-env-file "--config=<empty-bunfig.toml>" run <pkg>/src/adapters/codex/bin/hook.ts
 *
 * with the payload on stdin (`session_id`, `transcript_path`, `cwd`,
 * `hook_event_name`, `model`, and per event `prompt`, `source`,
 * `stop_hook_active`). It prints one JSON object or nothing (`../envelope.ts`)
 * and ALWAYS exits 0: no hook ever fails the host.
 *
 * The order is the guarantee, as in Claude Code's entry (claude-code CONTRACT
 * §5 G13): which configuration, then whether this directory is off — before any
 * store is opened. Ahead of both, the CX1 §6 stand-down: a Codex that Claude
 * Code started (codex-plugin-cc) does nothing, and says so in one line.
 *
 * An ENTRY POINT may borrow another adapter's readers (the MCP server's entry
 * borrows Claude Code's embedder and doctor), so the config, scope and session
 * readers below are Claude Code's own, unchanged: the rule for which file and
 * which directory is one rule on every host.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { implicitConfigRefusal, namedConfigRefusal, namedUnreadableRefusal } from "../../config-path.js";
import { lookupScope, mostRestrictiveVerdict, stanceOfMode } from "../../scopes.js";
import { openLog } from "../../log/index.js";
import type { LogEvent, ProcessLog } from "../../log/index.js";
import { resolveZone, todayIn } from "../../../core/time.js";
import type { AdapterConfig } from "../../config.js";
import { BINARY, scriptArgs } from "../../runtime.js";
import type { Binary } from "../../runtime.js";
import { WORKER_RUNNER_PATH } from "../../spawn.js";
import type { Spawner } from "../../spawn.js";
import { usePrivateUmask } from "../../private-umask.js";
import { eventDirectory, hookConfigChoice, hookScopeVerdict, hostConfig, sessionScope } from "../../claude-code/bin/hook.js";
import { openEmbedder } from "../../claude-code/embed-client.js";
import { CODEX_EVENT_NAMES } from "../adapter.js";
import type { CodexHookInput, CodexHookName } from "../adapter.js";
import { codexDelivery } from "../envelope.js";
import { openCodexAdapter } from "../index.js";
import { readCodexTranscript } from "../transcript.js";
import type { CodexTranscriptRead } from "../transcript.js";
import { attendedOfOriginator, codexStandDown } from "../words.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** The payload and one read of its rollout, as the adapter's input. Exported for tests. */
export function toCodexHookInput(
  payload: Readonly<Record<string, unknown>>,
  transcript: CodexTranscriptRead,
  opts: { readonly scope: string; readonly timeZone?: string },
): CodexHookInput {
  const transcriptPath =
    typeof payload["transcript_path"] === "string" && payload["transcript_path"].length > 0 ? payload["transcript_path"] : undefined;
  const model = typeof payload["model"] === "string" && payload["model"].length > 0 ? payload["model"] : transcript.model;
  const attended = attendedOfOriginator(transcript.originator);
  return {
    sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
    scope: opts.scope,
    turns: transcript.turns,
    expansions: transcript.expansions,
    ...(transcriptPath !== undefined && !transcript.ok ? { turnsUnread: true } : {}),
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
    ...(model === undefined ? {} : { model }),
    ...(transcript.compactedAt === undefined ? {} : { compactedAt: transcript.compactedAt }),
    ...(payload["stop_hook_active"] === true ? { reFired: true } : {}),
    ...(typeof payload["prompt"] === "string" ? { prompt: payload["prompt"] } : {}),
    ...(typeof payload["source"] === "string" && payload["source"].length > 0 ? { source: payload["source"] } : {}),
    ...(attended === undefined ? {} : { attended }),
    at: todayIn(resolveZone(opts.timeZone)),
  };
}

/** Run one Codex hook event: what this file does as a script. Never throws past its caller. */
export async function runCodexHook(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
  out: { stdout: (s: string) => void; stderr: (s: string) => void } = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  },
  /** The worker's starter: injected by a test, so no real worker runs over a temp store. */
  spawner?: Spawner,
): Promise<{ outcome: string }> {
  const name: CodexHookName | undefined = CODEX_EVENT_NAMES[String(payload["hook_event_name"] ?? "")];
  if (name === undefined) return { outcome: "not-ours" };
  const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
  const transcriptPath = typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : undefined;

  // WHICH CONFIGURATION, refused rather than guessed (`config-path.ts`), and
  // with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` an unnamed one stands down.
  const choice = hookConfigChoice(argv, env);
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    out.stderr(`[counterparts] codex hook stood down: ${refusal}\n`);
    return { outcome: "config-refused" };
  }
  // ONE READ OF THE ROLLOUT, shared by the stand-down and the capture.
  const transcript = readCodexTranscript(transcriptPath);

  // STARTED FROM INSIDE CLAUDE CODE (CX1 §6): nothing — no wake, no recall, no
  // capture — and one line, on stderr and in the process log of the store the
  // configuration names (no store is opened for it).
  const down = codexStandDown(env as Record<string, string | undefined>, transcript.originator);
  if (down !== null) {
    const why = down.by === "env" ? `env ${down.marker}` : `originator ${down.originator}`;
    out.stderr(`[counterparts] codex hook stood down: this Codex was started from inside Claude Code (${why}), which already records it\n`);
    try {
      const { config } = hostConfig(choice.path);
      openLog({ dataDir: config.dataDir, proc: `codex-hook:${name}`, session: sessionId, observer: config.observer === true }).end(
        "inside-claude-code",
        down.by === "env" ? { by: "env", marker: down.marker } : { by: "originator" },
      );
    } catch {
      /* the stderr line stands */
    }
    return { outcome: "inside-claude-code" };
  }

  // WHICH DIRECTORY, and what the person said about it — before a store opens.
  const eventDir = eventDirectory(payload, env);
  const { verdict: eventVerdict, read } = hookScopeVerdict(choice.path, eventDir);
  if (stanceOfMode(eventVerdict.mode) === "off") return { outcome: "scope-off" };
  const { config: loaded, reason } = hostConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    out.stderr(`[counterparts] codex hook stood down: ${unreadable}\n`);
    return { outcome: "config-unreadable" };
  }
  const scope = sessionScope(loaded.dataDir, payload, env);
  const verdict = mostRestrictiveVerdict(lookupScope(read.registry, scope), eventVerdict);
  if (stanceOfMode(verdict.mode) === "off") return { outcome: "scope-off" };
  const config: AdapterConfig = verdict.mode === "observer" ? { ...loaded, observer: true } : loaded;

  let log: ProcessLog | null = null;
  const toLog = (e: LogEvent): void => log?.event(e);
  const live = openEmbedder(config);
  const adapter = openCodexAdapter(config, {
    command: process.execPath,
    args: scriptArgs(WORKER_RUNNER_PATH),
    configPath: choice.path,
    ...(spawner === undefined ? {} : { spawner }),
    scope: verdict,
    ...(read.error === null ? {} : { scopeUnreadable: read.error }),
    ...(read.refused.length === 0 ? {} : { scopeRefused: read.refused.map((r) => r.key) }),
    embedder: live === null ? null : { embed: live.embed, vectors: live },
    onEvent: toLog,
    onCounterpartEvent: toLog,
  });
  const opened = openLog({
    dataDir: adapter.counterpart.store.dir,
    proc: `codex-hook:${name}`,
    session: sessionId,
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    observer: config.observer === true,
  });
  log = opened;
  if (name !== "user-prompt-submit") opened.start();
  let outcome = "ok";
  try {
    const input = toCodexHookInput(payload, transcript, { scope, ...(loaded.timeZone === undefined ? {} : { timeZone: loaded.timeZone }) });
    const result = adapter.hook(name, input);
    outcome = result.reason;
    const stdout = codexDelivery(name, result, payload);
    if (stdout.length > 0) out.stdout(stdout);
  } finally {
    adapter.counterpart.close();
  }
  opened.end(outcome, {});
  return { outcome };
}

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {};
  try {
    const text = await readStdin();
    if (text.trim().length > 0) payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* an unreadable payload is a quiet hook, never a failed session */
  }
  await runCodexHook(payload);
}

/** True only when this file is the process entry point, so a test may import it. */
export function isEntryPoint(argv1: string | undefined, url: string, binary: Binary | null = BINARY): boolean {
  if (argv1 === undefined || binary !== null) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

/** Run the hook and exit 0, whatever happened. */
export function start(): void {
  usePrivateUmask();
  void main().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`[counterparts] codex hook stood down: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(0);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) start();
