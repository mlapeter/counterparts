/**
 * Detached execution — the "heavy work runs somewhere else" half of scar E4.
 *
 * A hook returns in microseconds. Sleep, the crash-fallback sweep and every
 * model call run in a child this file starts and then forgets about. Four
 * properties, each of them an incident someone lived through:
 *
 *   **E4 — a watchdog, validated.** The child gets a timeout, and the timeout is
 *   checked against `remember/`'s claim-staleness window BEFORE the spawn. A
 *   watchdog that fires after a claim looks stale means two runs can hold the
 *   same spans; `remember.validateWatchdog` is the check, and SEAMS queued item
 *   10 asks for it to be PROVEN here rather than asserted in a comment.
 *
 *   **E4's widening — a worker that cannot start ESCALATES.** v1's runner
 *   starved for two days on a credential it expected to inherit from whatever
 *   shell launched the session, and the backlog drained only when a human
 *   noticed. So: a plan that cannot run says why, by name, and the same failure
 *   repeated crosses an escalation threshold instead of writing the same line
 *   forever. The backlog depth rides along as a reported number.
 *
 *   **§2.13 — the spawner pins the child's environment LAST.** `dataDir` is
 *   written onto the child env after every inherited value, so nothing a caller
 *   exported can redirect a run into the wrong store. v1's replay harness
 *   silently honored a pre-set data-directory variable, which is the observer
 *   scar escalated from training a store to destroying its graph.
 *
 *   **§2.18 — the credential comes from the environment we PIN, not the shell we
 *   inherited.** If it is absent the plan refuses before the child exists,
 *   because a child that starts without it fails at the far end where nobody is
 *   looking.
 *
 * `planSpawn` is pure and returns a checkable plan; `spawnDetached` is the six
 * lines that actually start a process. The split is deliberate: everything worth
 * testing is in the pure half.
 */
import { spawn } from "node:child_process";

import { TUNABLES as REMEMBER, validateWatchdog } from "../../core/remember/index.js";

import { API_KEY_ENV, TUNABLES } from "./config.js";
import type { AdapterConfig } from "./config.js";

export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
/** The child is told its own watchdog, so the worker can arm one internally too. */
export const WATCHDOG_ENV = "COUNTERPARTS_WATCHDOG_MS";

export type SpawnRefusal =
  | "NO_DATA_DIR"
  | "NO_CREDENTIAL"
  | "WATCHDOG_NOT_FINITE"
  | "WATCHDOG_EXCEEDS_STALENESS"
  | "OBSERVER";

export interface SpawnPlan {
  readonly ok: boolean;
  readonly reason: SpawnRefusal | "ready";
  readonly command: string;
  readonly args: readonly string[];
  /** The child's complete environment. `COUNTERPARTS_DATA_DIR` is written LAST. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** True when this refusal is the kind a human must be told about (E4). */
  readonly escalate: boolean;
}

export interface PlanInput {
  config: AdapterConfig;
  /** The interpreter for the runtime (`~/.bun/bin/bun`, `node`, ...). */
  command: string;
  /** The worker script and its arguments. */
  args: readonly string[];
  /** The environment to inherit from. Defaults to this process's. */
  baseEnv?: Readonly<Record<string, string | undefined>>;
  /** How many times this exact refusal has been seen already (E4's counter). */
  priorFailures?: number;
}

/**
 * Build the plan and check every precondition. Pure: it starts nothing, and it
 * is the whole of what a test needs to see.
 */
export function planSpawn(input: PlanInput): SpawnPlan {
  const { config } = input;
  const base = input.baseEnv ?? process.env;
  const timeoutMs = config.watchdogMs ?? TUNABLES.WATCHDOG_MS;
  const priorFailures = input.priorFailures ?? 0;
  const escalate = priorFailures + 1 >= TUNABLES.ESCALATE_AFTER;

  // The environment, assembled in the ONE order that matters: everything
  // inherited first, then the values this package owns. A caller's exported
  // COUNTERPARTS_DATA_DIR cannot survive this line (scar §2.13).
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  const refuse = (reason: SpawnRefusal): SpawnPlan => ({
    ok: false,
    reason,
    command: input.command,
    args: [...input.args],
    env,
    timeoutMs,
    escalate,
  });

  if (config.observer === true) {
    // An instrument spawns no worker (§15 G3): a cycle advances the clock,
    // decays the store and rewrites the briefing — the instrument mutating what
    // it measures. This refusal never escalates; it is the correct outcome.
    return { ...refuse("OBSERVER"), escalate: false };
  }
  if (config.dataDir === undefined || config.dataDir.trim().length === 0) {
    return refuse("NO_DATA_DIR");
  }
  const watchdog = validateWatchdog(timeoutMs, REMEMBER.STALE_CLAIM_MS);
  if (!watchdog.ok) {
    return refuse(
      watchdog.reason === "TIMEOUT_NOT_FINITE"
        ? "WATCHDOG_NOT_FINITE"
        : "WATCHDOG_EXCEEDS_STALENESS",
    );
  }
  const key = base[API_KEY_ENV];
  if (key === undefined || key.trim().length === 0) {
    // THE TWO-DAY STARVATION, refused up front. The worker's only job needs a
    // model call; starting it without one buys a silent backlog.
    return refuse("NO_CREDENTIAL");
  }

  env[DATA_DIR_ENV] = config.dataDir;
  env[WATCHDOG_ENV] = String(timeoutMs);
  return {
    ok: true,
    reason: "ready",
    command: input.command,
    args: [...input.args],
    env,
    timeoutMs,
    escalate: false,
  };
}

export interface SpawnOutcome {
  readonly started: boolean;
  readonly reason: SpawnPlan["reason"] | "SPAWN_FAILED";
  readonly pid: number | null;
  readonly escalate: boolean;
  readonly code: string | null;
}

/** Injected so a test can prove the whole path without starting a process. */
export type Spawner = (plan: SpawnPlan) => { pid?: number | undefined; unref?: () => void };

/**
 * Start the child and forget it. Detached, no stdio, unref'd — the parent hook
 * returns immediately and the host never waits on the work.
 */
export function spawnDetached(
  plan: SpawnPlan,
  opts: { spawner?: Spawner; onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void } = {},
): SpawnOutcome {
  const emit = opts.onEvent ?? ((): void => {});
  if (!plan.ok) {
    emit(plan.escalate ? "spawn.escalated" : "spawn.refused", {
      reason: plan.reason,
      timeoutMs: plan.timeoutMs,
      escalate: plan.escalate,
    });
    return { started: false, reason: plan.reason, pid: null, escalate: plan.escalate, code: null };
  }
  const run =
    opts.spawner ??
    ((p: SpawnPlan) =>
      spawn(p.command, [...p.args], {
        detached: true,
        stdio: "ignore",
        env: { ...p.env },
        timeout: p.timeoutMs,
      }));
  try {
    const child = run(plan);
    child.unref?.();
    emit("spawn.started", { pid: child.pid ?? null, timeoutMs: plan.timeoutMs });
    return { started: true, reason: "ready", pid: child.pid ?? null, escalate: false, code: null };
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? ((err as { code: string }).code)
        : "UNKNOWN";
    emit("spawn.failed", { code, timeoutMs: plan.timeoutMs });
    return { started: false, reason: "SPAWN_FAILED", pid: null, escalate: true, code };
  }
}
