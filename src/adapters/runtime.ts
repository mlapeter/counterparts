/**
 * WHICH RUNTIME RUNS A SCRIPT, and the arguments that say so — the one place
 * that knows the difference between Bun and Node.
 *
 * The sources are TypeScript and there is no build step. Bun runs them as they
 * are (`bun run <script.ts>`); Node runs them with `node-hooks.mjs` loaded first
 * (`node --import <node-hooks.mjs> <script.ts>`), which resolves the sources'
 * `./x.js` imports to `./x.ts` and strips the types. Every command this package
 * writes into a host's configuration, and every worker it spawns, is
 * `<runtime> <scriptArgs(script)>`, with the runtime the one running NOW
 * (`process.execPath`) — so `counterparts install` run under Node wires Node,
 * and under Bun wires Bun. The Bun shape was `run <script>` from 2026-09-03
 * and is `--no-env-file run <script>` since 2026-10-09 (below).
 *
 * The runtime is read off the executable's NAME, not off this process, so a
 * caller that passes a fixed executable (every test does) gets the shape that
 * executable needs. Anything not named `node…` is treated as Bun, which is what
 * every command written before Node support said.
 *
 * **BUN IS TOLD NOT TO READ THE PROJECT'S `.env` (2026-10-09).** Bun loads
 * `.env`, `.env.local` and `.env.<NODE_ENV>` from the WORKING DIRECTORY into
 * `process.env` before any of our code runs, and a host starts our hooks and
 * servers in the person's project. So a project whose `.env` set
 * `COUNTERPARTS_DATA_DIR` or `COUNTERPARTS_CONFIG` could point Counterparts at
 * another store — measured, for the plugin's server, which no `-e` pins (scar
 * §2.13 from a direction the spawner's pinning never covered). A variable
 * already in the real environment still wins over a `.env` (also measured), so
 * the hole was every variable nobody set. `--no-env-file` switches the loading
 * off; Node never had it (it reads a `.env` only when `--env-file` names one).
 * Commands written before this carry `run <script>` alone: they still parse
 * (`parseScriptInvocation`), `doctor` names them, and `counterparts connect`
 * rewrites them.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type RuntimeKind = "bun" | "node";

/** Bun's switch that stops it loading `.env` files from the working directory. */
export const BUN_NO_ENV_FILE = "--no-env-file";

/** The module Node loads before a script (`--import`). Absolute, from this file. */
export const NODE_HOOKS = fileURLToPath(new URL("./node-hooks.mjs", import.meta.url));

/** The console's own entry, for a command line that must name Node explicitly. */
export const CLI_SCRIPT = fileURLToPath(new URL("./cli/bin/counterparts.ts", import.meta.url));

/** The oldest Node this has been made to run on: `module.registerHooks`
 *  (22.15 / 23.5), `stripTypeScriptTypes` and unflagged `node:sqlite` (22.13). */
export const NODE_FLOOR = "22.15";

/** The runtime this process is running under. */
export function currentRuntime(): RuntimeKind {
  return process.versions.bun === undefined ? "node" : "bun";
}

/** `bun 1.3.0` or `node 24.9.0` — the runtime this process is, for a reader. */
export function runtimeLabel(): string {
  const bun = process.versions.bun;
  return bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`;
}

/** The runtime an executable path names: `node`, `node24`, `node.exe` → node;
 *  anything else → bun. */
export function runtimeOf(exe: string): RuntimeKind {
  return /^node(js)?(\d[\d.]*)?(\.exe)?$/i.test(exe.split(/[\\/]/).pop() ?? "") ? "node" : "bun";
}

/** The arguments that make `exe` run `script`: `--no-env-file run <script>`
 *  for Bun, `--import <node-hooks.mjs> <script>` for Node. */
export function scriptArgs(script: string, exe: string = process.execPath): string[] {
  return runtimeOf(exe) === "node" ? ["--import", NODE_HOOKS, script] : [BUN_NO_ENV_FILE, "run", script];
}

/** A command split into its parts, when it is `<exe> <scriptArgs(script)> <rest…>`. */
export interface ScriptInvocation {
  readonly exe: string;
  readonly runtime: RuntimeKind;
  readonly script: string;
  /** Whatever followed the script (`--config <path>`, flags). */
  readonly rest: readonly string[];
  /** Whether the runtime reads the project's `.env` into the process: `read`
   *  for a Bun command written before `--no-env-file`, else `ignored`. */
  readonly projectEnv: "read" | "ignored";
}

/**
 * Read `<exe> [--no-env-file] run [--no-env-file] <script> …` or `<exe>
 * --import <…node-hooks.mjs> <script> …` back out of a token list — the
 * inverse of `scriptArgs`, for the readers that must recognise what the
 * writers wrote (`wire.ts#isOurHookCommand`, doctor's runtime line, the
 * plugin's npm-wiring check). The Bun shape without the flag is what every
 * install wrote until 2026-10-09, so it is still ours. Null for any other
 * shape: a command this cannot read is not one of ours.
 */
export function parseScriptInvocation(tokens: readonly string[]): ScriptInvocation | null {
  const exe = tokens[0] ?? "";
  if (exe.length === 0) return null;
  let at = 1;
  let noEnvFile = false;
  if (tokens[at] === BUN_NO_ENV_FILE) {
    noEnvFile = true;
    at += 1;
  }
  if (tokens[at] === "run") {
    at += 1;
    if (tokens[at] === BUN_NO_ENV_FILE) {
      noEnvFile = true;
      at += 1;
    }
    const script = tokens[at] ?? "";
    if (script.length === 0) return null;
    const runtime = runtimeOf(exe);
    return {
      exe,
      runtime,
      script,
      rest: tokens.slice(at + 1),
      projectEnv: runtime === "node" || noEnvFile ? "ignored" : "read",
    };
  }
  if (noEnvFile) return null;
  if (tokens[1] === "--import" && /(^|[/\\])node-hooks\.mjs$/.test(tokens[2] ?? "") && (tokens[3] ?? "").length > 0) {
    return { exe, runtime: "node", script: tokens[3] as string, rest: tokens.slice(4), projectEnv: "ignored" };
  }
  return null;
}

/** Is the runtime a command names actually there? An absolute path is checked
 *  on disk; a bare name (`bun`, `node`) is looked up on `PATH`. */
export function runtimePresent(exe: string, env: Record<string, string | undefined> = process.env): boolean {
  if (exe.includes("/") || exe.includes("\\")) return existsSync(exe);
  const dirs = (env["PATH"] ?? "").split(process.platform === "win32" ? ";" : ":").filter((d) => d.length > 0);
  return dirs.some((d) => existsSync(`${d}/${exe}`));
}

/** Split on whitespace, honouring double quotes — the only quoting
 *  `install.ts#shellQuote` produces, and therefore the only quoting a command
 *  we wrote can carry. A single quote is left in the token, which makes the
 *  match fail, which is the safe direction. */
export function shellTokens(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (ch === "\\" && quoted && i + 1 < command.length) {
      current += command[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (started || current.length > 0) out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current.length > 0) out.push(current);
  return out;
}
