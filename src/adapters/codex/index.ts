/**
 * `adapters/codex/` — the Codex host's public surface (2026-11-09, CX2).
 *
 * A sibling of `claude-code/`, importing only the shared leaves
 * (`lifecycle.ts`, `hosts.ts`, `sessions.ts`, `scopes.ts`, `config.ts`, …) and
 * `core/` — never another adapter (a test asserts it). Its entry point
 * (`bin/hook.ts`) may borrow Claude Code's config and scope readers and its
 * embedder, as the MCP server's entry point already does.
 */
export { CODEX_EVENT_NAMES, CODEX_HOOKS, CodexAdapter } from "./adapter.js";
export type { CodexAdapterOptions, CodexHookInput, CodexHookName, CodexHookResult } from "./adapter.js";
export { codexDelivery } from "./envelope.js";
export { CODEX_STOP_OPENER, parseCodexTranscript, readCodexTranscript } from "./transcript.js";
export type { CodexTranscriptRead } from "./transcript.js";
export {
  COMPANION_ENV_MARKERS,
  CODEX_STOP_HUMAN_LINE,
  attendedOfOriginator,
  codexFrame,
  codexStandDown,
  codexStopAsk,
  codexVoiceRule,
} from "./words.js";
export type { CodexStandDown } from "./words.js";

import { Counterpart } from "../../core/counterpart.js";
import type { CounterpartEvent } from "../../core/counterpart.js";
import type { CounterpartOptions } from "../../core/counterpart.js";
import type { AdapterConfig } from "../config.js";
import { CodexAdapter } from "./adapter.js";
import type { CodexAdapterOptions } from "./adapter.js";

/** What the entry point hands in: the embedder (opened there), and the brain's event sink. */
export interface OpenCodexOptions extends Omit<CodexAdapterOptions, "counterpart" | "config"> {
  readonly embedder?: { readonly embed: NonNullable<CounterpartOptions["embed"]>; readonly vectors: NonNullable<CounterpartOptions["vectors"]> } | null;
  readonly onCounterpartEvent?: (e: CounterpartEvent) => void;
}

/** Open a brain for this host and wrap it in Codex's hooks — Claude Code's `openAdapter`, for Codex. */
export function openCodexAdapter(config: AdapterConfig, opts: OpenCodexOptions = {}): CodexAdapter {
  const { embedder, onCounterpartEvent, ...rest } = opts;
  const counterpart = Counterpart.open({
    ...(embedder === undefined || embedder === null ? {} : { embed: embedder.embed, vectors: embedder.vectors }),
    ...(config.dataDir === undefined ? {} : { dir: config.dataDir }),
    ...(config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir }),
    ...(config.injectionBudgetBytes === undefined ? {} : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.observer === undefined ? {} : { observer: config.observer }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(config.pageWriter?.mode === undefined ? {} : { pageWriterMode: config.pageWriter.mode }),
    ...(config.identity === undefined
      ? {}
      : { identity: { name: config.identity.name, aliases: [...(config.identity.aliases ?? [])] } }),
    // Codex's hooks run on the person's computer.
    toldSurface: "local",
    ...(onCounterpartEvent === undefined ? {} : { onEvent: onCounterpartEvent }),
  });
  return new CodexAdapter({ counterpart, config, ...rest });
}
