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
  DEFAULT_EMBED_MODEL,
  DEFAULT_INTERPRET_MODEL,
  EMBED_KEY_ENV,
  TUNABLES,
  VOYAGE_ENDPOINT,
  capabilities,
  embedSeat,
  embedderState,
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
  CREDENTIAL_FILE_EVENT,
  CREDENTIAL_NAMES,
  credentialRow,
  loadCredentials,
  permissionWarning,
} from "./credentials.js";
export type { CredentialLoad } from "./credentials.js";

export {
  CHECKOUT_BUDGET_MS,
  CHECKOUT_TIMEOUT_MS,
  NOTICE_MAX_CHARS,
  NOTICE_TAIL,
  SESSION_NOTICE_BUDGET_MS,
  SEVERITIES,
  anyRed,
  checkoutIsGraded,
  doctorFindings,
  noticeMessage,
  readCheckout,
  reportJson,
  reportLines,
  worstFirst,
} from "./doctor.js";
export type { CheckoutReading, DoctorInput, Finding, GitRunner, Severity } from "./doctor.js";

export {
  stopAsk,
  BOUNDARY_KIND,
  ClaudeCodeAdapter,
  HOOKS,
  SESSION_ENDING,
  SPAWN_REFUSAL_PREFIX,
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

export {
  EmbedError,
  callBudget,
  createEmbedder,
  embedClient,
  openEmbedder,
  wellFormed,
} from "./embed-client.js";
export type {
  ChunkFailure,
  EmbedBatch,
  EmbedClientOptions,
  EmbedFn,
  EmbedRefusal,
  EmbedderStats,
  LiveEmbedder,
  LiveEmbedderOptions,
} from "./embed-client.js";

export { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV, planSpawn, spawnDetached } from "./spawn.js";
export type { PlanInput, SpawnOutcome, SpawnPlan, SpawnRefusal, Spawner } from "./spawn.js";

export {
  BACKFILL_LIMIT,
  LAG_PROMPT_BYTES,
  LAG_REPLY_BYTES,
  backfillVectors,
  lagText,
  laggedSemantic,
} from "./vectors.js";
export type { BackfillReport, LagReport } from "./vectors.js";

export {
  FOREIGN_MARKERS,
  attributePeers,
  classifyBlock,
  parseTranscript,
  readTranscript,
} from "./transcript.js";
export type { PeerAttribution, TranscriptRead } from "./transcript.js";

export { AB_DIR_ENV, V2_OVERRIDE, abDir, assignmentHealth, assignmentPath, primacy, readAssignment } from "./primacy.js";
export type { Assignment, AssignmentHealth, AssignmentState, Primacy, PrimacyReason } from "./primacy.js";

import { Counterpart } from "../../core/counterpart.js";
import type { AdapterConfig } from "./config.js";
import { openEmbedder } from "./embed-client.js";
import type { LiveEmbedder, LiveEmbedderOptions } from "./embed-client.js";
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
  opts: Omit<AdapterOptions, "counterpart" | "config"> & {
    /** Injected so the whole path is provable without a socket. */
    embedFetch?: LiveEmbedderOptions["fetch"];
    /** Injected so a test can supply vectors without a client at all. */
    embedder?: LiveEmbedder | null;
  } = {},
): ClaudeCodeAdapter {
  const { embedFetch, embedder: injected, ...adapterOpts } = opts;
  const embedder =
    injected !== undefined
      ? injected
      : openEmbedder(config, embedFetch === undefined ? {} : { fetch: embedFetch });
  const counterpart = Counterpart.open({
    // Both halves of the same embedder: the SYNC face the store's index holds,
    // and the LIVE face the novelty seam and the sweep's warm call use.
    ...(embedder === null ? {} : { embed: embedder.embed, vectors: embedder }),
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
  return new ClaudeCodeAdapter({ counterpart, config, ...adapterOpts });
}
