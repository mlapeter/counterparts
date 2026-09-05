/**
 * WHERE EVERY ENTRY POINT LOOKS FOR THE HOST CONFIGURATION. One rule, one file.
 *
 * Until 2026-09-05 there were three answers to "which `claude-code.json`?".
 * `claude-code/bin/hook.ts`, `claude-code/bin/runner.ts` and `mcp/bin/serve.ts`
 * each hard-coded `join(homedir(), ".counterparts", "claude-code.json")` and
 * took no flag; the console looked beside the store and then in the home. That
 * was recorded as LAUNCH-STATUS G1, and it cost two concrete things:
 *
 *   - the clean-room install loop could drive the console and the MCP server at
 *     a scratch install but could not drive THE HOOK anywhere except the one
 *     path its own `$HOME` produced, so "the hook honours a config" was a step
 *     nobody could write;
 *   - an agent or a reviewer on a machine that already has an install could not
 *     run those three entry points at all without redirecting `HOME` — and on
 *     2026-09-04 a critic who could not do that ran `counterparts-mcp` against
 *     the owner's live configuration (its embedder knob, its credentials file)
 *     while pointing at a scratch store.
 *
 * THE RULE, and it is the same sentence for the console, the hook, the worker
 * and the MCP server:
 *
 *   1. `--config <absolute path>`, when the command line carries one;
 *   2. else `COUNTERPARTS_CONFIG`, the flag's equivalent for a host that
 *      launches from a STATIC configuration and has no command line to write
 *      into — which is exactly how Claude Code registers an MCP server
 *      (measured 2026-09-04, `mcp/bin/serve.ts`);
 *   3. else the documented default, unchanged: `~/.counterparts/claude-code.json`
 *      for the hook, the worker and the server; and for the console, whose
 *      `--dir` may name any store, `<dir>/../claude-code.json` first and that
 *      same home path second (`cli/commands.ts#hostCeiling`).
 *
 * Two properties this file exists to keep:
 *
 *   **The default path does not move.** `hook.ts` runs on the owner's live host
 *   at the next hook event; a no-flag, no-env run must resolve exactly what it
 *   resolved before this file existed. `defaultConfigPath()` is that path and
 *   nothing else consults it.
 *
 *   **A `--config` that cannot be honoured REFUSES; it never falls back.** An
 *   operator who names a configuration has said which memory they mean. Falling
 *   back to the default on a bad path is how a scratch run writes into a live
 *   store — the failure direction this whole file is a reaction to. So a
 *   relative path, or a flag with nothing after it, is a named refusal at every
 *   entry point (the hook stands down and exits 0, which is its only way to
 *   refuse without failing the host).
 *
 * It sits beside `sessions.ts` for the same reason that file does: two adapters
 * need it, and neither adapter may import the other (`mcp/INTERFACE-GAPS.md`
 * §7). A sibling both may import is the shape that rule allows.
 */
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { DEFAULT_DATA_DIR_NAME } from "../core/store/index.js";

/** The flag, spelled once. */
export const CONFIG_FLAG = "--config";

/**
 * The environment variable, spelled once. It is the FLAG'S EQUIVALENT and
 * nothing more: same meaning, same precedence order, lower priority. It exists
 * because `claude mcp add` writes a static command + env into the host's own
 * configuration, so `-e COUNTERPARTS_CONFIG=…` is the only way to tell a server
 * launched that way which file to read.
 */
export const CONFIG_ENV = "COUNTERPARTS_CONFIG";

/** The file's name under the home directory. `install` writes exactly this. */
export const CONFIG_FILE_NAME = "claude-code.json";

/**
 * The RING event a hook adapter leaves naming the file it read — ring-only, like
 * `adapter.credentials.file`, because a new DURABLE event name is a core change
 * (`core/counterpart.ts#AdapterDurableEventName`) and this one is not worth one:
 * the durable trace is the session registry record's `config` field, written
 * under the store the config actually named.
 */
export const CONFIG_FILE_EVENT = "adapter.config.file";

export type ConfigSource = typeof CONFIG_FLAG | typeof CONFIG_ENV | "default";

export interface ConfigChoice {
  /** The absolute path to read. Meaningless when `refusal` is set. */
  readonly path: string;
  /** Which of the three answered. Printed or recorded by every entry point. */
  readonly source: ConfigSource;
  /** Non-null when the caller NAMED a configuration this rule cannot honour. */
  readonly refusal: string | null;
}

/**
 * `~/.counterparts/claude-code.json` — the one default, unchanged since the
 * hooks first read it, and the only place a home directory is resolved for a
 * configuration path.
 */
export function defaultConfigPath(home: string = homedir()): string {
  return join(home, DEFAULT_DATA_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * The raw `--config` value on a command line, or undefined. Accepts both
 * `--config <path>` and `--config=<path>`; a flag with nothing usable after it
 * returns the empty string, which the resolver turns into a refusal rather than
 * into silence (the same lesson as `cli/commands.ts#unknownFlag`: a valued flag
 * that got no value is an error, not an absence).
 *
 * Hand-rolled rather than `parseArgs`, because three of the four callers parse
 * their own arguments differently and this must mean the same thing in all of
 * them.
 */
export function configFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === CONFIG_FLAG) {
      const next = argv[i + 1];
      return next === undefined || next.startsWith("--") ? "" : next;
    }
    if (token.startsWith(`${CONFIG_FLAG}=`)) return token.slice(CONFIG_FLAG.length + 1);
  }
  return undefined;
}

/** Why this named path cannot be used, or null. Absolute is the whole rule. */
export function configRefusal(value: string, source: ConfigSource): string | null {
  const named = source === CONFIG_FLAG ? `${CONFIG_FLAG} <path>` : CONFIG_ENV;
  if (value.length === 0) {
    return `refused: ${named} was given nothing. It takes an ABSOLUTE path to a configuration file.`;
  }
  if (!isAbsolute(value)) {
    return (
      `refused: ${named} takes an ABSOLUTE path, and '${value}' is relative. ` +
      "The processes that read this file are launched by a host from a working directory " +
      "nobody chose, so a relative path names a different file in every one of them."
    );
  }
  return null;
}

/**
 * The rule itself: flag, else environment, else the default.
 *
 * `argv` is the entry point's own arguments (`process.argv.slice(2)`), `env` its
 * environment, `home` the home directory — all three injected so the whole rule
 * is provable without a process, and so a test never has to reach a real home.
 */
export function resolveConfigPath(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = {},
  home: string = homedir(),
): ConfigChoice {
  const flag = configFlag(argv);
  if (flag !== undefined) {
    const refusal = configRefusal(flag, CONFIG_FLAG);
    return { path: flag, source: CONFIG_FLAG, refusal };
  }
  const fromEnv = env[CONFIG_ENV];
  // An EMPTY variable is absent, not a refusal: a host that exports the name
  // with no value has said nothing, and `-e COUNTERPARTS_CONFIG=` is a shape a
  // registration can produce by accident. A non-empty one that is relative is a
  // refusal, because somebody meant something by it.
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const value = fromEnv.trim();
    return { path: value, source: CONFIG_ENV, refusal: configRefusal(value, CONFIG_ENV) };
  }
  return { path: defaultConfigPath(home), source: "default", refusal: null };
}

/** The one line every entry point prints or records. Path first: it is the fact. */
export function configLine(choice: ConfigChoice): string {
  return choice.source === "default"
    ? `${choice.path} (the default)`
    : `${choice.path} (named by ${choice.source})`;
}
