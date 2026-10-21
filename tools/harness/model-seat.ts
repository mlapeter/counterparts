/**
 * A MODEL IN THE HARNESS'S SEAT (2026-10-20, lane 1 step 3): headless Claude
 * Code on the owner's subscription, answering the night's asks against a
 * copy of the store, on the harness's clock.
 *
 * The child is planned exactly as Claude Code's own seat plans it
 * (`night-run.ts#planNightChild`: the tools granted and denied, the
 * permission mode, the turn ceiling and watchdog, the prompt on stdin, the
 * child's own session id, its stream-json output kept), then three things
 * change so it cannot touch the owner's live store:
 *   - its memory server is the harness's (`serve-at.ts`), on the temp copy and
 *     the harness's clock, not the product's;
 *   - `--setting-sources project` in an empty temp directory: no user settings,
 *     so none of the owner's hooks or plugins load (measured 2026-10-20: no
 *     session file, no event, no backup run in the live store);
 *   - belt and braces, `COUNTERPARTS_CONFIG` names a temp config on the temp
 *     store, and the night's quiet flag is set as on every night child.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { NIGHT_MCP_SERVER, hostToolName, planNightChild, readNightSpills, startChild } from "../../src/adapters/claude-code/index.js";
import type { ChildPlan, ChildResult, NightAnswer, NightStarter } from "../../src/adapters/claude-code/index.js";
import type { Seat, SeatAsk } from "../../src/core/counterpart.js";

import { underLiveRoot } from "./source.js";
import { SERVE_AT_ENV } from "./serve-at.js";
import { SETTINGS_ENV, settingsForChild } from "./settings.js";
import { recordUsage } from "./usage.js";

/** The server entry the child's `--mcp-config` names. */
export const SERVE_AT_SCRIPT = fileURLToPath(new URL("./serve-at.ts", import.meta.url));

/**
 * Variables of the parent never handed to the child: the host's session
 * markers, every Counterparts setting, and any API key (the harness runs on
 * the owner's subscription, never a key a shell happened to export). The
 * session guard is set back on, so nothing in the child opens a store nobody
 * named.
 */
function childBaseEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k.startsWith("COUNTERPARTS_") || k.startsWith("CLAUDE_") || k.startsWith("ANTHROPIC_") || k === "CLAUDECODE" || k.startsWith("HARNESS_")) continue;
    out[k] = v;
  }
  out["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
  return out;
}

/** What the child said about itself at start (its stream-json `system/init` line): the plugins it loaded and its MCP servers' state. */
export interface ChildInit {
  readonly plugins: readonly string[];
  readonly servers: readonly { readonly name: string; readonly status: string }[];
}

/** The child's init line, read from its own output; null when it said none. */
export function childInit(output: string | undefined): ChildInit | null {
  for (const line of (output ?? "").split("\n")) {
    if (!line.includes('"init"')) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (o["type"] !== "system" || o["subtype"] !== "init") continue;
      const plugins = Array.isArray(o["plugins"]) ? (o["plugins"] as unknown[]).map((p) => (typeof p === "string" ? p : String((p as { name?: unknown }).name ?? "?"))) : [];
      const servers = Array.isArray(o["mcp_servers"])
        ? (o["mcp_servers"] as { name?: unknown; status?: unknown }[]).map((x) => ({ name: String(x.name ?? "?"), status: String(x.status ?? "?") }))
        : [];
      return { plugins, servers };
    } catch {
      continue;
    }
  }
  return null;
}

export interface ModelSeatInput {
  /** The temp copy the night runs on. Refused under the owner's live root. */
  readonly dir: string;
  /** A temp config file on that copy, for anything in the child that reads one. */
  readonly configPath: string;
  /** The harness's clock: each child's server starts at it. */
  readonly now: () => number;
  readonly timeZone?: string;
  readonly budgetBytes?: number;
  /** The static embedder on the child's server (default on), as live. */
  readonly embed?: boolean;
  /** The model the child runs (`--model`); absent, Claude Code's default. */
  readonly model?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** TESTS ONLY: the starter and the program, in place of a real `claude -p`. */
  readonly start?: NightStarter;
  readonly command?: string;
}

/** The plan Claude Code's seat would make, moved onto the harness's server and away from the owner's settings. Pure. */
export function planModelChild(input: ModelSeatInput, ask: SeatAsk, hostSession: string): ChildPlan & { readonly ok: boolean; readonly reason: string } {
  const plan = planNightChild({
    config: {
      dataDir: input.dir,
      owner: false,
      injectionBudgetBytes: input.budgetBytes ?? 9_000,
      ...(input.model === undefined ? {} : { dreaming: { model: input.model } }),
    },
    run: ask.run,
    prompt: ask.prompt,
    scope: ask.scope,
    session: ask.session,
    tools: ask.tools.map(hostToolName),
    ...(ask.withhold.length === 0 ? {} : { deny: ask.withhold.map(hostToolName) }),
    ...(ask.act === "catch-up" ? {} : { child: ask.act }),
    ...(ask.limits?.turns === undefined ? {} : { maxTurns: ask.limits.turns }),
    ...(ask.limits?.ms === undefined ? {} : { timeoutMs: ask.limits.ms }),
    configPath: input.configPath,
    baseEnv: childBaseEnv(input.env ?? process.env),
    hostSession,
    readOutput: true,
    ...(input.command === undefined ? {} : { command: input.command }),
  });
  const parent = input.env ?? process.env;
  const server = {
    type: "stdio",
    command: process.execPath,
    args: [SERVE_AT_SCRIPT],
    env: {
      ...(parent["PATH"] === undefined ? {} : { PATH: parent["PATH"] }),
      ...(parent["HOME"] === undefined ? {} : { HOME: parent["HOME"] }),
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      [SERVE_AT_ENV.dir]: input.dir,
      [SERVE_AT_ENV.now]: String(input.now()),
      [SERVE_AT_ENV.budget]: String(input.budgetBytes ?? 9_000),
      [SERVE_AT_ENV.session]: ask.session,
      [SERVE_AT_ENV.scope]: ask.scope,
      [SERVE_AT_ENV.run]: ask.run,
      [SERVE_AT_ENV.embed]: input.embed === false ? "0" : "1",
      ...(ask.act === "catch-up" ? {} : { [SERVE_AT_ENV.child]: ask.act }),
      ...(input.timeZone === undefined ? {} : { [SERVE_AT_ENV.timeZone]: input.timeZone }),
      // The run's settings reach the tools the child calls too (`settings.ts`).
      ...(settingsForChild() === "" ? {} : { [SETTINGS_ENV]: settingsForChild() }),
    },
  };
  const args = [...plan.args];
  const at = args.indexOf("--mcp-config");
  if (at < 0) throw new Error("the night child's plan carries no --mcp-config");
  args[at + 1] = JSON.stringify({ mcpServers: { [NIGHT_MCP_SERVER]: server } });
  args.push("--setting-sources", "project");
  return { ...plan, args };
}

/**
 * Headless Claude Code in the harness's seat, for every act: a write-up owed
 * (`catch-up`, a session that ended without its write-up, as a new owner's
 * short sessions do), the dream, the reflection.
 */
export function modelSeat(input: ModelSeatInput): Seat<NightAnswer> & { readonly inits: Readonly<Record<string, ChildInit | null>> } {
  if (underLiveRoot(input.dir, input.env)) throw new Error("refused: the harness's seat never runs on the owner's live store");
  const inits: Record<string, ChildInit | null> = {};
  return {
    name: `harness:model${input.model === undefined ? "" : `:${input.model}`}`,
    inits,
    async answer(ask: SeatAsk): Promise<NightAnswer> {
      const plan = planModelChild(input, ask, randomUUID());
      if (!plan.ok) return { refused: plan.reason, started: false, code: null, timedOut: false, error: null, ms: 0 };
      const at = Date.now();
      const result: ChildResult = await (input.start ?? ((p: ChildPlan) => startChild(p)))(plan);
      const neverStarted = result.spawnCode !== undefined || (result.code === null && !result.timedOut && result.error !== null);
      if (!neverStarted) {
        inits[ask.act] = childInit(result.output);
        recordUsage(result.output);
      }
      return {
        refused: null,
        started: !neverStarted,
        code: result.code,
        timedOut: result.timedOut,
        error: result.error,
        ms: Date.now() - at,
        ...(result.spawnCode === undefined ? {} : { spawnCode: result.spawnCode }),
        spill: neverStarted ? null : readNightSpills(result),
      };
    },
  };
}
