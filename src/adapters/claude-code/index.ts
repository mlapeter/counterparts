/**
 * `adapters/claude-code/` — the launch adapter's public surface.
 *
 * The dependency direction is one-way and asserted by a test: the core imports
 * NOTHING from this directory (CONTRACT §5 G1, constitution line 5). Everything
 * this file exports is host-shaped; everything it imports from `../../core/` is
 * host-agnostic.
 */
export {
  ANTHROPIC_ENDPOINT,
  ANTHROPIC_VERSION,
  API_KEY_ENV,
  CAPABILITIES,
  DEFAULT_INTERPRET_MODEL,
  TUNABLES,
  capabilities,
  interpretSeat,
  loadConfig,
  seatStatus,
} from "./config.js";
export type {
  AdapterConfig,
  CapabilityName,
  CapabilityReport,
  LoadedConfig,
  ModelSeat,
  SeatStatus,
  SeatVerdict,
} from "./config.js";

export {
  AUTHORSHIP_ASK,
  BOUNDARY_KIND,
  ClaudeCodeAdapter,
  HOOKS,
  SESSION_ENDING,
  substanceOf,
} from "./hooks.js";
export type {
  AdapterEvent,
  AdapterOptions,
  HookInput,
  HookName,
  HookResult,
  HostTurn,
  SessionEndingHook,
} from "./hooks.js";

export { InterpretError, SYSTEM_PROMPT, extractJson, interpretClient, readStream } from "./interpret-client.js";
export type { FetchLike, InterpretClientOptions, InterpretRefusal, StreamRead } from "./interpret-client.js";

export { DATA_DIR_ENV, WATCHDOG_ENV, planSpawn, spawnDetached } from "./spawn.js";
export type { PlanInput, SpawnOutcome, SpawnPlan, SpawnRefusal, Spawner } from "./spawn.js";

export { parseTranscript, readTranscript } from "./transcript.js";
export type { TranscriptRead } from "./transcript.js";

import { Counterpart } from "../../core/counterpart.js";
import type { AdapterConfig } from "./config.js";
import { ClaudeCodeAdapter } from "./hooks.js";
import type { AdapterOptions } from "./hooks.js";

/**
 * Open a brain for this host and wrap it in the hooks.
 *
 * The two host facts travel as ARGUMENTS, which is the whole charter: the
 * injection ceiling the host reported becomes the core's `budgetBytes`, and the
 * data directory is the one the configuration names — never one inherited from
 * an ambient environment variable a caller happened to export (scar §2.13).
 */
export function openAdapter(
  config: AdapterConfig,
  opts: Omit<AdapterOptions, "counterpart" | "config"> = {},
): ClaudeCodeAdapter {
  const counterpart = Counterpart.open({
    ...(config.dataDir === undefined ? {} : { dir: config.dataDir }),
    ...(config.injectionBudgetBytes === undefined
      ? {}
      : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.observer === undefined ? {} : { observer: config.observer }),
    ...(config.owner === undefined ? {} : { owner: config.owner }),
    ...(config.identity === undefined
      ? {}
      : { identity: { name: config.identity.name, aliases: [...(config.identity.aliases ?? [])] } }),
  });
  return new ClaudeCodeAdapter({ counterpart, config, ...opts });
}
