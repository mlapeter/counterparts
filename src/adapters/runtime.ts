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
 * and under Bun wires Bun, and the Bun shape is byte-for-byte what it has been
 * since 2026-09-03.
 *
 * The runtime is read off the executable's NAME, not off this process, so a
 * caller that passes a fixed executable (every test does) gets the shape that
 * executable needs. Anything not named `node…` is treated as Bun, which is what
 * every command written before Node support said.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeKind = "bun" | "node";

// ── the single binary (spike, 2026-10-09: docs/notes/single-binary-spike.md) ──
//
// `bun build --compile` (tools/single-binary/) packs every module into one
// executable. Inside it, EVERY module's `import.meta.url` is the binary's own
// virtual file (`file:///$bunfs/root/<name>`; `B:/~BUN/root/<name>` on
// Windows), so a path computed from `import.meta.url` no longer says where a
// module lives, and the files the build embedded sit under that virtual root
// at their repository-relative paths (`--root <repo> --asset-naming
// '[dir]/[name].[ext]'`).
const SELF = fileURLToPath(import.meta.url);

/** The virtual root of a compiled binary, or null when running from source. */
export const COMPILED_ROOT: string | null = /[\\/]\$bunfs[\\/]|[\\/]~BUN[\\/]/.test(SELF) ? dirname(SELF) : null;

/** Is this process the single compiled binary? */
export function isCompiled(): boolean {
  return COMPILED_ROOT !== null;
}

/** A file of this package by its path from the package root — on disk from
 *  source, in the binary's embedded files when compiled. */
export function packagePath(rel: string): string {
  if (COMPILED_ROOT === null) return fileURLToPath(new URL(`../../${rel}`, import.meta.url));
  // Bun names an embedded file at the top of the build root `./<name>` (its
  // `[dir]` is "."), and the virtual filesystem matches names exactly
  // (measured on 1.3.10; the build's `selfcheck` mode holds this).
  return rel.includes("/") ? join(COMPILED_ROOT, rel) : `${COMPILED_ROOT}/./${rel}`;
}

/** The model table's directory inside the binary; undefined from source,
 *  where `core/embed/static.ts` resolves the installed package itself. */
export function bundledModelDir(): string | undefined {
  return COMPILED_ROOT === null ? undefined : packagePath("node_modules/counterparts-model-potion");
}

/** The binary's first argument for each entry script (by file name, which
 *  survives the virtual paths): what `scriptArgs` hands the binary to run it. */
export const COMPILED_MODES: Readonly<Record<string, string>> = {
  "hook.ts": "hook",
  "serve.ts": "mcp",
  "counterparts.ts": "cli",
  "dashboard.ts": "dashboard",
  "runner.ts": "runner",
  "nightly.ts": "nightly",
};

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

/** The arguments that make `exe` run `script`: `run <script>` for Bun,
 *  `--import <node-hooks.mjs> <script>` for Node. */
export function scriptArgs(script: string, exe: string = process.execPath): string[] {
  // The compiled binary runs ITSELF in another mode: `<binary> runner`.
  const mode = COMPILED_ROOT !== null && exe === process.execPath ? COMPILED_MODES[basename(script)] : undefined;
  if (mode !== undefined) return [mode];
  return runtimeOf(exe) === "node" ? ["--import", NODE_HOOKS, script] : ["run", script];
}

/** A command split into its parts, when it is `<exe> <scriptArgs(script)> <rest…>`. */
export interface ScriptInvocation {
  readonly exe: string;
  readonly runtime: RuntimeKind;
  readonly script: string;
  /** Whatever followed the script (`--config <path>`, flags). */
  readonly rest: readonly string[];
}

/**
 * Read `<exe> run <script> …` or `<exe> --import <…node-hooks.mjs> <script> …`
 * back out of a token list — the inverse of `scriptArgs`, for the readers that
 * must recognise what the writers wrote (`wire.ts#isOurHookCommand`, doctor's
 * runtime line). Null for any other shape: a command this cannot read is not
 * one of ours.
 */
export function parseScriptInvocation(tokens: readonly string[]): ScriptInvocation | null {
  const exe = tokens[0] ?? "";
  if (exe.length === 0) return null;
  if (tokens[1] === "run" && (tokens[2] ?? "").length > 0) {
    return { exe, runtime: runtimeOf(exe), script: tokens[2] as string, rest: tokens.slice(3) };
  }
  if (tokens[1] === "--import" && /(^|[/\\])node-hooks\.mjs$/.test(tokens[2] ?? "") && (tokens[3] ?? "").length > 0) {
    return { exe, runtime: "node", script: tokens[3] as string, rest: tokens.slice(4) };
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
