#!/usr/bin/env bun
/**
 * The detached worker — everything the foreground hook refused to wait for.
 *
 * Started by `spawn.ts` with a pinned environment (`COUNTERPARTS_DATA_DIR` last)
 * and a watchdog it is TOLD about (`COUNTERPARTS_WATCHDOG_MS`), so the timeout
 * that guards this process is the same number the spawner validated against
 * `remember/`'s claim-staleness window. It arms that watchdog itself as well as
 * being subject to the parent's, because a child that hangs past the window can
 * hold spans a second run would also claim (scars E4/E5, SEAMS queued item 10).
 *
 * What it runs, in order (the composition root owns the order, not this file):
 *   0a. the LAGGED SEMANTIC CUE for the session that just spoke — before
 *       anything else, because it reads the live span buffer and the sweep's
 *       claim moves those spans out of it (`vectors.ts`). It runs on EVERY
 *       boundary, outside the sweep gate and regardless of its verdict: the cue
 *       expires after one turn, so a step that fired only when a session had
 *       crashed would leave the semantic channel dark on every ordinary turn;
 *   0b. one bounded EMBEDDING BACKFILL, on the same terms and for the same
 *       reason — the store's blind memories gain vectors at a guaranteed rate
 *       rather than only when a deposit happens to pay for one, and running it
 *       first means a long sweep cannot starve it;
 *   1. the crash-fallback sweep, over EVERY scope holding experience (§2 G9) —
 *      which SELECTS NOTHING unless a session actually crashed (uncovered spans,
 *      no `session-end` boundary, silent for `CRASH_STALE_MS`). This worker is
 *      spawned at every boundary for the flush and the cycle below; the sweep is
 *      a fallback and its ordinary answer is "nothing crashed", recorded as the
 *      durable `sweep.gate` row so the silence is evidenced (owner ruling
 *      2026-09-04, `remember/fallback.ts`);
 *   2. the Hebbian flush;
 *   3. the sleep cycle, whose last content write is the wake briefing.
 *
 * It exits 0 on every path. Nothing about a failed run may reach the host.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../../../core/counterpart.js";
import { dataDir } from "../../../core/store/index.js";

import {
  configLine,
  defaultConfigPath,
  namedConfigRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";

import { loadConfig } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { loadCredentials, permissionWarning } from "../credentials.js";
import type { CredentialLoad } from "../credentials.js";
import { openEmbedder } from "../index.js";
import type { LiveEmbedder } from "../embed-client.js";
import { interpretClient } from "../interpret-client.js";
import type { FetchLike } from "../interpret-client.js";
import { EMBED_KEY_ENV } from "../config.js";
import { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV } from "../spawn.js";
import { backfillVectors, laggedSemantic } from "../vectors.js";
import type { BackfillReport, LagReport } from "../vectors.js";

/**
 * The default, unchanged: the same file the hook reads when nobody says
 * otherwise. `--config <absolute path>` and the `COUNTERPARTS_CONFIG` the
 * spawner pins override it in that order (`adapters/config-path.ts`).
 */
export const CONFIG_PATH = defaultConfigPath();

/**
 * Which configuration this worker will read, and which rule chose it. Exported
 * and injectable so the pinned case — the only one a hook produces — is provable
 * without a process.
 */
export function runnerConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

export interface RunReport {
  readonly ran: boolean;
  readonly reason: "ran" | "no-data-dir" | "observer" | "failed";
  readonly swept: number;
  readonly minted: number;
  readonly code: string | null;
  /** The next turn's semantic cue, and the vectors this run bought. Null when
   *  the run refused before reaching them. */
  readonly lag: LagReport | null;
  readonly backfill: BackfillReport | null;
}

/**
 * One run. Exported and injectable so the whole worker is testable without a
 * process, a socket, or a real data directory.
 */
export async function runOnce(input: {
  config: AdapterConfig;
  /** Injected so the whole worker is provable without a socket. */
  fetch?: FetchLike;
  today?: string;
  date?: string;
  signal?: AbortSignal;
  /** The session this run follows, and its scope — pinned onto the child by the
   *  spawner (`SESSION_ENV` / `SCOPE_ENV`). Absent ⇒ no lagged cue is computed
   *  and none is claimed: a run nobody bound to a session has nobody to cue. */
  session?: string;
  scope?: string;
  /** Injected so the whole vector path is provable without a socket. */
  embedder?: LiveEmbedder | null;
  /** Defaults to `process.env`: read for PRESENCE of the embed key, never value. */
  env?: NodeJS.ProcessEnv;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}): Promise<RunReport> {
  const { config } = input;
  const emit = input.onEvent ?? ((): void => {});
  if (config.dataDir === undefined || config.dataDir.trim().length === 0) {
    emit("runner.refused", { reason: "no-data-dir" });
    return { ran: false, reason: "no-data-dir", swept: 0, minted: 0, code: null, lag: null, backfill: null };
  }
  if (config.observer === true) {
    // A cycle advances the clock, decays the store and rewrites the briefing:
    // the instrument mutating what it measures (§15 G3).
    emit("runner.refused", { reason: "observer" });
    return { ran: false, reason: "observer", swept: 0, minted: 0, code: null, lag: null, backfill: null };
  }

  // The embedder, when the owner switched it on. This is the composition root
  // that MINTS — the fallback sweep runs here — so an embedder wired only into
  // `openAdapter` would be an embedder the memories never meet. Its `fetch` is
  // the same injected one the interpreter uses, so the whole worker stays
  // provable without a socket.
  const embedder =
    input.embedder !== undefined
      ? input.embedder
      : openEmbedder(config, {
          // ONE injected `fetch` for the whole worker; the two clients call
          // different endpoints, and a fake that answers both proves it.
          ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
          ...(input.today === undefined ? {} : { today: input.today }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          onEvent: emit,
        });

  const counterpart = Counterpart.open({
    dir: config.dataDir,
    ...(embedder === null ? {} : { embed: embedder.embed, vectors: embedder }),
    ...(config.injectionBudgetBytes === undefined
      ? {}
      : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.owner === undefined ? {} : { owner: config.owner }),
    onEvent: (e) => emit(e.name, { ...(e.data ?? {}) }),
  });
  // The embed credential, by PRESENCE only — the value is never read here and
  // never logged. `embedClient` makes the same check before it opens a socket;
  // asking here is what lets the two vector steps record `no-credentials` as a
  // NAME instead of as a failed call nobody can tell from an empty store.
  const env = input.env ?? process.env;
  const hasCredential = (env[EMBED_KEY_ENV] ?? "").trim().length > 0;

  let lag: LagReport | null = null;
  let backfill: BackfillReport | null = null;
  try {
    // 0a. BEFORE THE SWEEP. The cue is read out of the LIVE span buffer and the
    // sweep's claim moves those spans out of it — run this after `sessionEnd`
    // and the session that just spoke has nothing left to be cued from.
    // BOTH or neither: a data dir is not a scope, and guessing one would look
    // in the wrong span stream and report `no-text` for a session that spoke.
    if (
      input.session !== undefined &&
      input.session.length > 0 &&
      input.scope !== undefined &&
      input.scope.length > 0
    ) {
      lag = await laggedSemantic({
        counterpart,
        sessionId: input.session,
        scope: input.scope,
        embedder,
        hasCredential,
        onEvent: emit,
      });
    }
    // 0b. One bounded batch, before the variable-length sweep, so a long sweep
    // (or the watchdog that ends one) cannot starve the store's blind memories.
    backfill = await backfillVectors({ counterpart, embedder, hasCredential, onEvent: emit });
  } catch (err) {
    // Neither step may cost the run. A cue is a nicety; the sweep is the day.
    emit("vectors.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
  }

  try {
    const interpret = interpretClient({
      config,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.today === undefined ? {} : { today: input.today }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      onEvent: emit,
    });
    const today = input.date ?? new Date().toISOString().slice(0, 10);
    const report = await counterpart.sessionEnd({
      date: today,
      at: today,
      sweep: { interpret },
    });
    const swept = report.sweeps.reduce((n, s) => n + s.spansSwept, 0);
    const minted = report.sweeps.reduce((n, s) => n + s.proposals, 0);
    emit("runner.done", {
      day: report.cycle.day,
      scopes: report.sweeps.length,
      swept,
      minted,
      edges: report.edges.reason,
    });
    return { ran: true, reason: "ran", swept, minted, code: null, lag, backfill };
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNKNOWN";
    emit("runner.failed", { code });
    return { ran: false, reason: "failed", swept: 0, minted: 0, code, lag, backfill };
  } finally {
    counterpart.close();
  }
}

/** The watchdog this process arms on itself, from the number it was told. */
export function watchdogMs(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env[WATCHDOG_ENV];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The data dir this process was PINNED to. Never resolved from anywhere else. */
export function pinnedDataDir(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[DATA_DIR_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}

/** The session (and its scope) this process was told to follow. Read from the
 *  pinned environment for the same reason the data dir is: the spawner wrote
 *  them last, so nothing a caller exported can redirect the cue. */
export function pinnedSession(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[SESSION_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}

export function pinnedScope(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[SCOPE_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}

export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

/**
 * This process's configuration, its pinned data dir, and its credential load.
 *
 * BELT AND BRACES on the credential. A worker the hook spawned already carries
 * the keys — the spawner copies `process.env` into the child, and the hook
 * filled the gap before that copy — but this process also runs when nothing
 * spawned it that way, and it reads the same configuration, so it loads from the
 * same configured file rather than assuming an ancestor did. The load is a no-op
 * where the keys are already there: the ENVIRONMENT WINS, always, and an
 * inherited key is reported as `skippedPresent`, not overwritten.
 *
 * Exported and injectable so the runner's credential path is provable without a
 * process (the entry point itself is not importable).
 */
export function runnerConfig(
  path = CONFIG_PATH,
  env: NodeJS.ProcessEnv = process.env,
): { config: AdapterConfig; credentials: CredentialLoad } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = undefined;
  }
  const loaded = loadConfig(raw);
  const credentials = loadCredentials(loaded.config.credentialsFile, env);
  const pinned = pinnedDataDir(env);
  return {
    config: {
      ...loaded.config,
      // The PIN wins. The spawner wrote it last precisely so nothing else can.
      dataDir: pinned ?? loaded.config.dataDir ?? dataDir(),
    },
    credentials,
  };
}

async function main(): Promise<void> {
  const choice = runnerConfigChoice();
  const refusal = namedConfigRefusal(choice);
  if (refusal !== null) {
    // Same direction as the hook: a worker told to read a configuration it
    // cannot resolve — relative, or absolute and not there — does NOT fall back
    // to the default store. It says so and exits 0: nothing about a failed run
    // may reach the host. This one matters even though the spawner pins a path
    // the parent already read, because the pin travels through an environment
    // and a file can be moved between the two processes.
    process.stderr.write(`[counterparts] worker stood down: ${refusal}\n`);
    return;
  }
  const { config, credentials } = runnerConfig(choice.path);
  // Detached, this stderr goes nowhere (`spawn.ts` runs the child with stdio
  // ignored); run by hand it is the line that says which file answered. The
  // record for a detached run is the pin itself — `COUNTERPARTS_CONFIG` in the
  // environment the spawner wrote — and the session record the parent left.
  process.stderr.write(`[counterparts] worker config: ${configLine(choice)}\n`);
  // No ring here — the worker has no adapter — so the permission warning is a
  // stderr line and nothing else. Warned, never refused (§4).
  const warning = permissionWarning(config.credentialsFile, credentials);
  if (warning !== null) process.stderr.write(`${warning}\n`);

  const timeout = watchdogMs();
  const controller = new AbortController();
  const timer =
    timeout === null
      ? null
      : setTimeout(() => {
          controller.abort();
        }, timeout);
  timer?.unref?.();
  try {
    await runOnce({
      config,
      signal: controller.signal,
      ...(pinnedSession() === null ? {} : { session: pinnedSession() as string }),
      ...(pinnedScope() === null ? {} : { scope: pinnedScope() as string }),
    });
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main().then(
    () => process.exit(0),
    () => process.exit(0),
  );
}
