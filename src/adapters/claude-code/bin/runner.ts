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
 *   1. the crash-fallback sweep, over EVERY scope holding experience (§2 G9);
 *   2. the Hebbian flush;
 *   3. the sleep cycle, whose last content write is the wake briefing.
 *
 * It exits 0 on every path. Nothing about a failed run may reach the host.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../../../core/counterpart.js";

import { loadConfig } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { openEmbedder } from "../index.js";
import { interpretClient } from "../interpret-client.js";
import type { FetchLike } from "../interpret-client.js";
import { DATA_DIR_ENV, WATCHDOG_ENV } from "../spawn.js";

export const CONFIG_PATH = join(homedir(), ".counterparts", "claude-code.json");

export interface RunReport {
  readonly ran: boolean;
  readonly reason: "ran" | "no-data-dir" | "observer" | "failed";
  readonly swept: number;
  readonly minted: number;
  readonly code: string | null;
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
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}): Promise<RunReport> {
  const { config } = input;
  const emit = input.onEvent ?? ((): void => {});
  if (config.dataDir === undefined || config.dataDir.trim().length === 0) {
    emit("runner.refused", { reason: "no-data-dir" });
    return { ran: false, reason: "no-data-dir", swept: 0, minted: 0, code: null };
  }
  if (config.observer === true) {
    // A cycle advances the clock, decays the store and rewrites the briefing:
    // the instrument mutating what it measures (§15 G3).
    emit("runner.refused", { reason: "observer" });
    return { ran: false, reason: "observer", swept: 0, minted: 0, code: null };
  }

  // The embedder, when the owner switched it on. This is the composition root
  // that MINTS — the fallback sweep runs here — so an embedder wired only into
  // `openAdapter` would be an embedder the memories never meet. Its `fetch` is
  // the same injected one the interpreter uses, so the whole worker stays
  // provable without a socket.
  const embedder = openEmbedder(config, {
    // ONE injected `fetch` for the whole worker; the two clients call different
    // endpoints, and a fake that answers both is how a test proves that.
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
    return { ran: true, reason: "ran", swept, minted, code: null };
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNKNOWN";
    emit("runner.failed", { code });
    return { ran: false, reason: "failed", swept: 0, minted: 0, code };
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

export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

async function main(): Promise<void> {
  const { readFileSync } = await import("node:fs");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    raw = undefined;
  }
  const loaded = loadConfig(raw);
  const pinned = pinnedDataDir();
  const { dataDir } = await import("../../../core/store/index.js");
  const config: AdapterConfig = {
    ...loaded.config,
    // The PIN wins. The spawner wrote it last precisely so nothing else can.
    dataDir: pinned ?? loaded.config.dataDir ?? dataDir(),
  };

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
    await runOnce({ config, signal: controller.signal });
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
