#!/usr/bin/env bun
/**
 * THE MEMORY'S SERVER ON THE HARNESS'S CLOCK (2026-10-20, lane 1 step 3).
 *
 * A `claude -p` the harness starts reaches the memory through this, not the
 * product's server (`src/adapters/mcp/bin/serve.ts`): the same tools, served
 * the same way, from a store opened on a clock the harness sets. The product
 * grows no knob for faking time; this file never ships (`tools/`).
 *
 * Opened as the night's child's server is (`night-run.ts#nightMcpConfig`):
 * not the owner's, told which act it serves and which run, with the static
 * embedder. A scripted owner's own session (`week.ts`) opens it as the
 * owner's (`HARNESS_OWNER=1`), as a person's own Claude Code session is. Its clock starts at `HARNESS_NOW` and runs on with the real one,
 * so a call made a minute into the child reads a minute later.
 *
 * Everything comes from its environment, set by the harness's seat
 * (`model-seat.ts`). It refuses a data dir under the owner's live root.
 */
import { openEmbedder } from "../../src/adapters/claude-code/index.js";
import { McpServer, serveStdio } from "../../src/adapters/mcp/index.js";
import { Counterpart } from "../../src/core/counterpart.js";

import { applySettingsFromEnv } from "./settings.js";
import { underLiveRoot } from "./source.js";

/** The variables the harness's seat sets on this server. */
export const SERVE_AT_ENV = {
  dir: "COUNTERPARTS_DATA_DIR",
  now: "HARNESS_NOW",
  timeZone: "HARNESS_TIME_ZONE",
  budget: "HARNESS_BUDGET",
  session: "COUNTERPARTS_SESSION",
  scope: "COUNTERPARTS_SCOPE",
  child: "COUNTERPARTS_NIGHT_CHILD",
  run: "COUNTERPARTS_NIGHT_RUN",
  embed: "HARNESS_EMBED",
  /** `1`: the owner's own session (a scripted owner's); absent, not the owner's (a night child's). */
  owner: "HARNESS_OWNER",
  /** The folder registry a session's server reads, when the harness keeps one. */
  scopes: "HARNESS_SCOPES_FILE",
} as const;

async function main(): Promise<void> {
  const env = process.env;
  applySettingsFromEnv(env);
  const dir = env[SERVE_AT_ENV.dir] ?? "";
  if (dir.trim().length === 0) throw new Error(`${SERVE_AT_ENV.dir} is required`);
  if (underLiveRoot(dir)) throw new Error("refused: the harness's server never opens the owner's live store");
  const base = Number(env[SERVE_AT_ENV.now] ?? "");
  // In MILLISECONDS: an instant in seconds (under 1e12) would date the store in 1970.
  if (!Number.isFinite(base) || base < 1e12) throw new Error(`${SERVE_AT_ENV.now} must be an instant in ms`);
  const startedAt = Date.now();
  const now = (): number => base + (Date.now() - startedAt);
  const timeZone = env[SERVE_AT_ENV.timeZone];
  const embedder = env[SERVE_AT_ENV.embed] === "0" ? null : openEmbedder({ embedder: { enabled: true } });
  const owner = env[SERVE_AT_ENV.owner] === "1";
  const counterpart = Counterpart.open({
    dir,
    owner,
    budgetBytes: Number(env[SERVE_AT_ENV.budget] ?? "9000"),
    now,
    ...(timeZone === undefined || timeZone.length === 0 ? {} : { timeZone }),
    ...(embedder === null ? {} : { embed: embedder.embed }),
  });
  const server = new McpServer({
    counterpart,
    ...(env[SERVE_AT_ENV.session] === undefined ? {} : { session: env[SERVE_AT_ENV.session] }),
    ...(env[SERVE_AT_ENV.scope] === undefined ? {} : { scope: env[SERVE_AT_ENV.scope] }),
    owner,
    ...(embedder === null ? {} : { embedder }),
    ...(env[SERVE_AT_ENV.scopes] === undefined || env[SERVE_AT_ENV.scopes] === "" ? {} : { scopesFile: env[SERVE_AT_ENV.scopes] }),
    env: {
      ...(env[SERVE_AT_ENV.child] === undefined ? {} : { [SERVE_AT_ENV.child]: env[SERVE_AT_ENV.child] }),
      ...(env[SERVE_AT_ENV.run] === undefined ? {} : { [SERVE_AT_ENV.run]: env[SERVE_AT_ENV.run] }),
    },
    now,
  });
  try {
    await serveStdio(server, process.stdin, {
      write: (chunk) => {
        process.stdout.write(chunk);
      },
    });
  } finally {
    counterpart.close();
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`[harness serve-at] ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
