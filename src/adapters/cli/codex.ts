/**
 * `counterparts connect --host codex` and `disconnect --host codex` (2026-11-09,
 * CX2): Codex's two files, read, backed up, edited (`codex/wire.ts`) and
 * written whole, atomically.
 *
 *   - `$CODEX_HOME/hooks.json` — our four hooks (SessionStart, UserPromptSubmit,
 *     Stop, SessionEnd), appended after every other tool's; theirs untouched.
 *   - `$CODEX_HOME/config.toml` — our `[mcp_servers.counterparts]` table, the
 *     store and the configuration named in its `env`; on disconnect, that table
 *     and the `hooks.state` rows at our hooks' positions.
 *
 * `CODEX_HOME` is Codex's own variable; absent, `~/.codex`. Trust is the
 * person's (CX1 §5 route i): nothing here writes a `trusted_hash`, and the last
 * line says to approve the hooks in Codex's `/hooks`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CONFIG_ENV, CONFIG_FLAG } from "../config-path.js";
import { entryScript, hostInvocation, hostPath } from "../runtime.js";
import {
  CODEX_MCP_NAME,
  codexMcpBlock,
  dropHookStates,
  foreignShapedMcp,
  mergeCodexHooks,
  mergeCodexMcp,
  ourPositions,
  formatLike,
  hasCodexMcp,
  tomlProblem,
  stateKey,
} from "../codex/wire.js";
import { CODEX_HOST } from "../hosts.js";
import { MCP_SCRIPT, runCommand, shellQuote } from "./install.js";
import { copyToFreeBackup, tilde } from "./wire.js";
import type { Io } from "./commands-shared.js";

/** Codex's hook entry, by its path in this package. */
export const CODEX_HOOK_SCRIPT = entryScript(new URL("../codex/bin/hook.ts", import.meta.url));

/** Codex's home: its own `CODEX_HOME`, or `~/.codex`. */
export function codexHome(home: string, env: Readonly<Record<string, string | undefined>>): string {
  const named = env["CODEX_HOME"];
  return typeof named === "string" && named.length > 0 ? named : join(home, ".codex");
}

/** The hook command Codex is told to run; `--config` only when the configuration is not where the hook looks by default. */
export function codexHookCommand(configPath: string | undefined, exe: string = process.execPath): string {
  const base = runCommand(CODEX_HOOK_SCRIPT, exe);
  return configPath === undefined || configPath.length === 0 ? base : `${base} ${CONFIG_FLAG} ${shellQuote(hostPath(configPath))}`;
}

/** Our MCP table: the server under this runtime, told `--host codex`, the store and configuration in `env`. */
export function codexMcpTable(store: string, configPath: string | undefined, exe: string = process.execPath): string {
  const { command, args } = hostInvocation(MCP_SCRIPT, exe);
  return codexMcpBlock(command, [...args, "--host", CODEX_HOST], {
    COUNTERPARTS_DATA_DIR: store,
    ...(configPath === undefined || configPath.length === 0 ? {} : { [CONFIG_ENV]: configPath }),
  });
}

export interface CodexWireInput {
  readonly io: Io;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  /** The configuration this install runs on, and whether it is not the default one. */
  readonly configPath: string;
  readonly custom: boolean;
  readonly store: string;
  readonly now: number;
  readonly dryRun?: boolean;
  readonly exe?: string;
  /** `process.platform`, injectable for a test. */
  readonly platform?: string;
}

export type CodexWireOutcome = "ok" | "refused" | "failed";

/** Write `text` to `path` whole: a temp file beside it, then one rename. */
function writeWhole(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.counterparts-${String(process.pid)}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Connect (`wire`) or disconnect (`unwire`) Codex. Everything it changed is said, with its backup. */
export function wireCodex(input: CodexWireInput, direction: "wire" | "unwire"): CodexWireOutcome {
  const { io, home, now } = input;
  const codex = codexHome(home, input.env);
  const hooksPath = join(codex, "hooks.json");
  const tomlPath = join(codex, "config.toml");
  const exe = input.exe ?? process.execPath;
  // WINDOWS WAITS (CX2): the hooks would need `commandWindows`, which is a follow-up.
  if (direction === "wire" && (input.platform ?? process.platform) === "win32") {
    io.err("refused: Counterparts does not support Codex on Windows yet (its hooks need a Windows command line, a follow-up). Nothing has changed.");
    return "refused";
  }

  // READ BOTH BEFORE WRITING EITHER: a file we cannot read whole is refused, and nothing changes.
  const hooksRaw = readText(hooksPath);
  let hooksDoc: unknown = {};
  if (hooksRaw !== null && hooksRaw.trim().length > 0) {
    try {
      hooksDoc = JSON.parse(hooksRaw);
    } catch {
      io.err(`refused: ${tilde(hooksPath, home)} is not JSON this command can read, so it was left as it is. Fix it (or move it aside) and run this again.`);
      io.err("Nothing has changed.");
      return "refused";
    }
  }
  const tomlRaw = readText(tomlPath) ?? "";
  // A config.toml this command cannot read line by line is refused whole (CX2 fix round): never appended to.
  const problem = tomlProblem(tomlRaw);
  if (problem !== null) {
    io.err(`refused: ${tilde(tomlPath, home)} does not read as TOML (${problem}), so neither of Codex's files was changed. Fix that line (Codex will not start with it either), then run this again.`);
    io.err("Nothing has changed.");
    return "refused";
  }
  if (foreignShapedMcp(tomlRaw)) {
    io.err(
      `refused: ${tilde(tomlPath, home)} names a "${CODEX_MCP_NAME}" MCP server in a form this command does not edit (an inline or dotted key). ` +
        `Remove that entry by hand, or run \`codex mcp remove ${CODEX_MCP_NAME}\`, then run this again.`,
    );
    io.err("Nothing has changed.");
    return "refused";
  }

  const command = codexHookCommand(input.custom ? input.configPath : undefined, exe);
  const before = ourPositions(hooksDoc);
  const hooks = mergeCodexHooks(hooksDoc, command, direction);
  let toml = mergeCodexMcp(tomlRaw, direction === "wire" ? codexMcpTable(input.store, input.custom ? input.configPath : undefined, exe) : null);
  // DISCONNECT ALSO TAKES OUR TRUST ROWS (CX1 §5): the `hooks.state` rows at the
  // positions our hooks held, under the path Codex keys them by. Never another's.
  let statesDropped = 0;
  if (direction === "unwire" && before.length > 0) {
    const keys = new Set(before.map((p) => stateKey(hooksPath, p)));
    const dropped = dropHookStates(toml.text, keys);
    statesDropped = dropped.dropped;
    if (dropped.dropped > 0) toml = { ...toml, text: dropped.text, changed: true };
  }

  const verb = direction === "wire" ? "connect" : "disconnect";
  if (input.dryRun === true) {
    io.out(`Codex (${verb}, dry run — nothing written):`);
    for (const e of hooks.events) io.out(`  hook ${e.event}: ${e.outcome}`);
    io.out(`  MCP server "${CODEX_MCP_NAME}" in ${tilde(tomlPath, home)}: ${toml.changed ? (direction === "wire" ? (toml.had ? "updated" : "added") : "removed") : "unchanged"}`);
    return "ok";
  }

  try {
    if (hooks.changed && !(direction === "unwire" && hooksRaw === null)) {
      if (hooksRaw !== null) io.out(`Backed up ${tilde(hooksPath, home)} to ${tilde(copyToFreeBackup(hooksPath, now), home)}.`);
      writeWhole(hooksPath, formatLike(hooksRaw, hooks.doc));
    }
    if (toml.changed) {
      if (existsSync(tomlPath)) io.out(`Backed up ${tilde(tomlPath, home)} to ${tilde(copyToFreeBackup(tomlPath, now), home)}.`);
      writeWhole(tomlPath, toml.text);
    }
  } catch (err) {
    io.err(`failed: could not write Codex's files (${err instanceof Error ? err.message : String(err)}). What was backed up is beside each file.`);
    return "failed";
  }

  const changed = hooks.events.filter((e) => e.outcome !== "already" && e.outcome !== "absent");
  if (direction === "wire") {
    io.out(
      hooks.changed
        ? `Codex hooks: ${changed.map((e) => `${e.event} ${e.outcome}`).join(", ")} in ${tilde(hooksPath, home)} (${String(hooks.foreignKept)} other hook${hooks.foreignKept === 1 ? "" : "s"} left as they were).`
        : `Codex hooks: already in ${tilde(hooksPath, home)}; nothing changed.`,
    );
    io.out(
      toml.changed
        ? `Codex MCP server "${CODEX_MCP_NAME}": ${toml.had ? "updated" : "added"} in ${tilde(tomlPath, home)}.`
        : `Codex MCP server "${CODEX_MCP_NAME}": already in ${tilde(tomlPath, home)}; nothing changed.`,
    );
    io.out("");
    io.out("One step is yours: Codex runs a new hook only once you approve it.");
    io.out("  1. Start Codex, type /hooks, and approve the four Counterparts hooks (SessionStart, UserPromptSubmit, Stop, SessionEnd).");
    io.out("  2. Quit Codex and start it again. The next session wakes with the memory.");
    io.out("Until then the memory tools work and the hooks are skipped. `counterparts doctor` says which hooks are approved.");
    io.out("Codex reads this memory as itself, not as your counterpart, and runs no dreams or reflection: those stay in Claude.");
  } else {
    io.out(
      changed.length > 0
        ? `Codex hooks: removed ours from ${tilde(hooksPath, home)}; every other hook was left as it was.`
        : `Codex hooks: none of ours in ${tilde(hooksPath, home)}; nothing changed.`,
    );
    if (hooks.shifted.length > 0) {
      io.out(
        `  Another tool's hook came after ours in ${hooks.shifted.join(", ")}: Codex keys approval by position, so it may ask you to approve that tool's hook again in /hooks.`,
      );
    }
    io.out(
      toml.had
        ? `Codex MCP server "${CODEX_MCP_NAME}": removed from ${tilde(tomlPath, home)}${statesDropped > 0 ? `, with its ${String(statesDropped)} hook approval row${statesDropped === 1 ? "" : "s"}` : ""}.`
        : `Codex MCP server "${CODEX_MCP_NAME}": not in ${tilde(tomlPath, home)}; nothing changed.`,
    );
    io.out("Your memory is not touched.");
  }
  return "ok";
}

/** Is anything of ours in Codex's files (our hooks, or our MCP table)? A read; never throws. */
export function codexWired(home: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const codex = codexHome(home, env);
  let doc: unknown = {};
  try {
    doc = JSON.parse(readText(join(codex, "hooks.json")) ?? "{}");
  } catch {
    doc = {};
  }
  return ourPositions(doc).length > 0 || hasCodexMcp(readText(join(codex, "config.toml")) ?? "");
}
