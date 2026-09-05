#!/usr/bin/env bun
/**
 * The entry script. Thin on purpose: parse a few flags, render a string, print
 * it. Every decision worth testing lives in the view functions, which return
 * strings and know nothing about a terminal.
 *
 * Run as:
 *
 *   ~/.bun/bin/bun run src/adapters/dashboard/bin/dashboard.ts status
 *   ... browse --id mem_abc123
 *   ... stories --limit 3
 *
 * The data dir comes from `COUNTERPARTS_DATA_DIR` or `~/.counterparts/store` by the
 * store's own resolution, at call time; `--dir` overrides it for one run, and
 * `store/paths.ts` structurally refuses a path inside v1's live store.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Dashboard, VIEWS, VIEW_BLURB, isViewName } from "../index.js";
import type { ViewArgs, ViewName } from "../index.js";
import { terminalWantsColour } from "../ansi.js";
import { DATA_DIR_ENV, dataDir, isStoreError } from "../../../core/store/index.js";
import type { StoreError } from "../../../core/store/index.js";
import type { Band, Kind } from "../../../core/types.js";

interface Parsed {
  readonly view: ViewName | "help";
  readonly dir: string | undefined;
  readonly colour: boolean;
  readonly width: number | undefined;
  readonly args: ViewArgs;
}

export function parseArgv(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split("=", 2);
    if (name === undefined) continue;
    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, "true");
    } else {
      flags.set(name, next);
      i += 1;
    }
  }

  const first = positional[0];
  // ASKING FOR HELP MUST NOT OPEN A STORE. `--help` is a flag, so it left no
  // positional behind, and "no positional" meant `status` — which opened the
  // DEFAULT data dir, i.e. the owner's live memory, and rendered it. A claims
  // audit hit exactly that on 2026-09-04 while trying to read the usage. Help is
  // checked before anything else here, and `run()` returns it before it opens
  // anything (§5 G9: reads are pure, and this one reads nothing at all).
  const wantsHelp =
    flags.get("help") === "true" || flags.get("h") === "true" || first === "help" ||
    argv.includes("-h") || argv.includes("--help");
  const view: ViewName | "help" = wantsHelp
    ? "help"
    : first === undefined
      ? "status"
      : isViewName(first)
        ? first
        : "help";

  const args: ViewArgs = {};
  const id = flags.get("id");
  if (id !== undefined) Object.assign(args, { id });
  const limit = flags.get("limit");
  if (limit !== undefined && Number.isFinite(Number(limit))) {
    Object.assign(args, { limit: Number(limit) });
  }
  const band = flags.get("band");
  if (band !== undefined) Object.assign(args, { band: band as Band });
  const kind = flags.get("kind");
  if (kind !== undefined) Object.assign(args, { kind: kind as Kind });
  const name = flags.get("name");
  if (name !== undefined) Object.assign(args, { name });
  if (flags.get("archived") === "true") Object.assign(args, { archived: true });

  const widthFlag = flags.get("width");
  const width =
    widthFlag !== undefined && Number.isFinite(Number(widthFlag)) ? Number(widthFlag) : undefined;

  return {
    view,
    dir: flags.get("dir"),
    colour: flags.get("no-colour") === "true" ? false : flags.get("colour") === "true" || terminalWantsColour(),
    ...(width === undefined ? { width: undefined } : { width }),
    args,
  };
}

export function helpText(): string {
  const lines = [
    "counterparts dashboard — the owner's window",
    "",
    "  bun run src/adapters/dashboard/bin/dashboard.ts <view> [flags]",
    "",
    "Views:",
    ...VIEWS.map((v) => `  ${v.padEnd(9)} ${VIEW_BLURB[v]}`),
    "",
    "Flags:",
    "  --id <id>        open one memory (browse) or one belief (stories)",
    "  --limit <n>      how many rows",
    "  --band <band>    filter the browse list",
    "  --kind <kind>    filter the browse list",
    "  --name <event>   filter the activity feed",
    "  --archived       include archived rows",
    "  --dir <path>     read a different data dir",
    "  --colour / --no-colour, --width <n>",
    "",
    "The web view:",
    "  serve --dir <path> [--port <n>]     the local dashboard, on 127.0.0.1 only",
    `                                      (default port ${SERVE_DEFAULT_PORT}, or ${SERVE_PORT_ENV})`,
    "  serve --yes                         open the DEFAULT store instead. Without --dir",
    "                                      or --yes, 'serve' refuses: on a machine with an",
    "                                      install the default is the owner's live memory.",
    "",
    "It reads in observer mode and writes nothing, ever.",
  ];
  return lines.join("\n");
}

/** Kept in sync with `web/server.ts` by the test, not by an import: the help
 *  text must render without loading a page server the terminal never needs. */
const SERVE_DEFAULT_PORT = 4747;
const SERVE_PORT_ENV = "COUNTERPARTS_DASHBOARD_PORT";

export interface ServeArgs {
  readonly serve: boolean;
  readonly dir: string | undefined;
  readonly port: number | undefined;
  /** `--yes`: I meant the default store. The only way past the refusal below. */
  readonly yes: boolean;
}

/** `serve` is parsed separately from the five views because it is not one: it
 *  returns nothing to print, and `run()` is a pure string function the suite
 *  leans on heavily. Keeping them apart keeps that true. */
export function parseServe(argv: readonly string[]): ServeArgs {
  const parsed = parseArgv(argv);
  const serve = (argv[0] ?? "") === "serve";
  const portFlag = flagValue(argv, "port");
  const port = portFlag !== undefined && Number.isInteger(Number(portFlag)) ? Number(portFlag) : undefined;
  return {
    serve,
    dir: parsed.dir,
    ...(port === undefined ? { port: undefined } : { port }),
    yes: argv.includes("--yes") || argv.includes("--yes=true"),
  };
}

/**
 * THE REFUSAL A STRAY `serve` GETS, or null when the command named its store.
 *
 * `counterparts-dashboard serve`, typed alone, used to print a warning and then
 * open the DEFAULT data dir — which on the author's machine is his live memory,
 * every element of it, on a socket, in a browser. A warning after the fact is
 * the wrong instrument: the page is already up and the reader has already
 * skipped the line. So the default store is now opt-in by name.
 *
 * Pure, and it opens nothing: the sentence has to be reachable without a store
 * and without a socket, or the test for it would need both. `targetDirOf` is
 * the defensive read of the default — `dataDir()` itself throws when the
 * environment points inside v1's live store, and a refusal that throws while
 * naming what it refused is the same bug one frame down.
 *
 * TWO SENTENCES, BECAUSE THERE ARE TWO CASES AND ONLY ONE OF THEM IS KNOWN.
 * `~/.counterparts/store` on a machine with an install IS the owner's live
 * memory — that is what the layout means. `COUNTERPARTS_DATA_DIR` is whatever
 * somebody exported, and an adversarial review pointed this at a scratch demo
 * store and got a refusal asserting it was live memory. The refusal still
 * refuses — QUICKSTART §7 tells the reader to export that variable with the
 * live store in it, so honouring it would put the hole straight back — but it
 * says why without claiming what it cannot check.
 */
export function serveRefusal(
  args: ServeArgs,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (args.dir !== undefined || args.yes) return null;
  const fromEnv = env[DATA_DIR_ENV];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return (
      `Refused: 'serve' does not take the store from ${DATA_DIR_ENV} (${fromEnv}). ` +
      "Pass --dir <path> to name one, or --yes to accept that variable. " +
      "It is the variable QUICKSTART tells you to export with your live memory in it, and 'serve' " +
      "puts a whole store on a socket — so that choice is made in the command. Nothing was opened."
    );
  }
  return (
    `Refused: 'serve' with no --dir would open ${targetDirOf(args)}, which is the default store — ` +
    "on a machine with an install, that is the owner's live memory. " +
    "Pass --dir <path> to name a store, or --yes to mean the default. Nothing was opened."
  );
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === `--${name}`) return argv[i + 1];
    if (token.startsWith(`--${name}=`)) return token.slice(name.length + 3);
  }
  return undefined;
}

/**
 * Start the web view. The refusal path is the important half: an owner who
 * points this at a directory with no store gets ONE SENTENCE — the same one the
 * terminal views give — and the resolved data dir is PRINTED on every start, so
 * "which store am I looking at" is never a guess.
 */
export async function serve(argv: readonly string[]): Promise<number> {
  const args = parseServe(argv);
  // BEFORE the server module is even loaded, let alone a store opened.
  const refusal = serveRefusal(args);
  if (refusal !== null) {
    process.stderr.write(`${refusal}\n`);
    return 1;
  }
  const dir = args.dir === undefined ? undefined : resolve(args.dir);
  const { startDashboard } = await import("../web/server.js");
  try {
    const running = await startDashboard({
      ...(dir === undefined ? {} : { dir }),
      ...(args.port === undefined ? {} : { port: args.port }),
    });
    process.stdout.write(
      [
        `counterparts dashboard — ${running.url}`,
        `reading ${running.dir}`,
        // Named when it was not asked for. `--dir` is optional and the default
        // is somebody's real memory, so a `serve` typed without one should not
        // look the same as a `serve` aimed on purpose (constitution 16: the
        // system shows its workings). It is a read-only view either way; this
        // line is so a stray start is visible rather than merely harmless.
        // Only reachable with `--yes`, which is the owner saying he meant it —
        // and it still says which store that was.
        ...(dir === undefined
          ? [`(--yes, so this is the DEFAULT store — ${DATA_DIR_ENV} or ~/.counterparts/store)`]
          : []),
        "observer mode: it strengthens nothing, deposits nothing, and writes no file of its own.",
        "ctrl-c to stop.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    const where = dir ?? targetDirOf(args);
    if (isStoreError(err)) {
      process.stderr.write(`${describeStoreError(err, where, args.dir !== undefined)}\n`);
      return 1;
    }
    const code = (err as { code?: string }).code;
    if (code === "EADDRINUSE") {
      process.stderr.write(
        `Port ${args.port ?? SERVE_DEFAULT_PORT} is already in use. Pass --port <n> or set ${SERVE_PORT_ENV}.\n`,
      );
      return 1;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function targetDirOf(args: ServeArgs): string {
  if (args.dir !== undefined) return resolve(args.dir);
  try {
    return dataDir();
  } catch {
    return `the default data dir (${DATA_DIR_ENV} or ~/.counterparts)`;
  }
}

/**
 * Every store refusal, as one sentence. An owner reading an instrument is owed a
 * SENTENCE, not nine frames: the code is the wire shape (`store/errors.ts`), the
 * detail is ids and counts only, and neither ever carries prose — so both can be
 * printed. Constitution 16: a refusal the owner cannot read is a refusal that
 * teaches nothing.
 */
export function describeStoreError(err: StoreError, dir: string, namedDir = false): string {
  switch (err.code) {
    // The instrument refuses to mint an absent store (cli INTERFACE-GAPS §7) —
    // and an owner pointing a dashboard at nothing deserves a sentence, not a
    // stack trace.
    //
    // The remedy names the dir that was passed, exactly as the console's copy
    // of this sentence does: `counterparts init` on its own, offered under a
    // line that just named `--dir /somewhere`, creates the store in the DEFAULT
    // place instead — advice that works, somewhere else.
    case "STORE_UNINITIALIZED":
      return `No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`;
    // The exact error a stranger who put the adapter's config in the wrong place
    // will hit. The CLI's `init` already teaches the rule; this says the same
    // thing at the moment the rule bites.
    case "LAYOUT_UNCLASSIFIED":
      return (
        `LAYOUT_UNCLASSIFIED: ${dir} holds ${String(err.detail["name"] ?? "an unclassified entry")}, ` +
        "which the store's layout does not classify. Write the adapter's configuration BESIDE " +
        "the store, never inside it — the layout check refuses an unclassified file in the data " +
        `dir (§5 G11): ${join(dir, "..", "claude-code.json")}`
      );
    // The explicit-dir guard (`store/paths.ts#REQUIRE_EXPLICIT_DIR_ENV`): armed
    // on purpose by an operator, so the sentence says what it refused and how to
    // proceed. `err.detail["dir"]` is the path the fallback WOULD have opened —
    // taken from the error, because `dataDir()` is what threw and cannot be
    // called to name it.
    case "IMPLICIT_DEFAULT_DIR_REFUSED":
      return (
        `refused: ${String(err.detail["guard"])} and no store was named, so this would have opened the ` +
        `default data dir, ${String(err.detail["dir"])} — on a machine with an install, somebody's live ` +
        `memory. Name the store: --dir <path>, or ${DATA_DIR_ENV}.`
      );
    default:
      return `${err.code}: the store at ${dir} refused this read (${JSON.stringify(err.detail)}).`;
  }
}

/**
 * The dir to NAME in a refusal — resolved defensively, because `dataDir()` can
 * itself throw (`DATA_DIR_FORBIDDEN`, when the env points inside v1's live
 * store). A handler that throws while describing an error would be the very bug
 * it was written to fix, one frame further down.
 */
function targetDir(parsed: Parsed): string {
  if (parsed.dir !== undefined) return resolve(parsed.dir);
  try {
    return dataDir();
  } catch {
    return `the default data dir (${DATA_DIR_ENV} or ~/.counterparts/store)`;
  }
}

/**
 * The rendered view, and whether it is a REFUSAL rather than a render.
 *
 * `run()` returns only the string, because the suite leans on it being a pure
 * string function and every existing test holds. The entry point needs the
 * other half: a view of a store that is not there exits non-zero, the same way
 * `counterparts status` does — a script that asks an instrument what is in a
 * store and gets a sentence about there being no store has not succeeded, and a
 * mistyped `--dir` should not read as a clean run.
 */
export function runReport(argv: readonly string[]): { text: string; refused: boolean } {
  const parsed = parseArgv(argv);
  if (parsed.view === "help") return { text: helpText(), refused: false };
  const refusal = (err: unknown): { text: string; refused: boolean } => ({
    text: describeStoreError(err as StoreError, targetDir(parsed), parsed.dir !== undefined),
    refused: true,
  });
  let dashboard: Dashboard;
  try {
    dashboard = Dashboard.open({
      ...(parsed.dir === undefined ? {} : { dir: parsed.dir }),
      colour: parsed.colour,
      ...(parsed.width === undefined ? {} : { width: parsed.width }),
    });
  } catch (err) {
    // EVERY store refusal, not just the one that was anticipated. A code this
    // file has never heard of still reaches the owner as a line it can read;
    // anything that is not a StoreError is a bug here and still throws.
    if (isStoreError(err)) return refusal(err);
    throw err;
  }
  try {
    return { text: dashboard.render(parsed.view, parsed.args), refused: false };
  } catch (err) {
    if (isStoreError(err)) return refusal(err);
    throw err;
  } finally {
    dashboard.close();
  }
}

export function run(argv: readonly string[]): string {
  return runReport(argv).text;
}

/** True only when this file is the process entry point — so a test may import
 *  `run` and `parseArgv` without the script printing itself (the same guard
 *  `adapters/claude-code/bin/` uses). */
export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  const argv = process.argv.slice(2);
  // Help first, and before `serve` too: `serve --help` would otherwise bind a
  // socket against the default store.
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${helpText()}\n`);
    process.exit(0);
  }
  if ((argv[0] ?? "") === "serve") {
    // The one subcommand that does not return a string: it binds a socket and
    // stays. `run()` is left exactly as it was, so every existing test holds.
    const code = await serve(argv);
    if (code !== 0) process.exit(code);
  } else {
    // A refusal goes to stderr and exits 1: a non-zero exit whose only output
    // is on stdout is half a refusal, and the console's `status` makes exactly
    // the same two calls for exactly the same reason.
    const report = runReport(argv);
    if (report.refused) {
      process.stderr.write(`${report.text}\n`);
      process.exit(1);
    }
    process.stdout.write(`${report.text}\n`);
    process.exit(0);
  }
}
