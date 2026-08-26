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
 * The data dir comes from `COUNTERPARTS_DATA_DIR` or `~/.counterparts` by the
 * store's own resolution, at call time; `--dir` overrides it for one run, and
 * `store/paths.ts` structurally refuses a path inside v1's live store.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Dashboard, VIEWS, VIEW_BLURB, isViewName } from "../index.js";
import type { ViewArgs, ViewName } from "../index.js";
import { terminalWantsColour } from "../ansi.js";
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
  const view: ViewName | "help" =
    first === undefined ? "status" : isViewName(first) ? first : "help";

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
    "It reads in observer mode and writes nothing, ever.",
  ];
  return lines.join("\n");
}

export function run(argv: readonly string[]): string {
  const parsed = parseArgv(argv);
  if (parsed.view === "help") return helpText();
  const dashboard = Dashboard.open({
    ...(parsed.dir === undefined ? {} : { dir: parsed.dir }),
    colour: parsed.colour,
    ...(parsed.width === undefined ? {} : { width: parsed.width }),
  });
  try {
    return dashboard.render(parsed.view, parsed.args);
  } finally {
    dashboard.close();
  }
}

/** True only when this file is the process entry point — so a test may import
 *  `run` and `parseArgv` without the script printing itself (the same guard
 *  `adapters/claude-code/bin/` uses). */
export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.stdout.write(`${run(process.argv.slice(2))}\n`);
  process.exit(0);
}
