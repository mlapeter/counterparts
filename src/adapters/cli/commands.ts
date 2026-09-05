/**
 * The `counterparts` command surface.
 *
 * **Brain analog: none, deliberately** (CONTRACT §2). Humans have no console on
 * their own memory — no inspection of every unfalsifiable anchor, no deliberate
 * erasure, no export. This module is the improvement over the biological
 * original that constitution lines 4 and 6 promise: the self is governed and
 * owner-visible, and the owner owns the data.
 *
 * Three rules shape everything below:
 *
 *   1. **Owner operations never run under observer.** An instrument reading a
 *      store may not initialize one, snapshot one, export one, rebuild one, or
 *      remove from one. `status` is the only read-only command and it runs in
 *      the observer stance by construction, so the console cannot train or
 *      deposit anything by being looked at (scar E7).
 *   2. **Dry run is the default for anything destructive**, with an interactive
 *      confirmation, and the plan is RE-MADE after the confirmation rather than
 *      held across it (scars §2.13, E5 — a lock is never held across a human
 *      prompt, and a plan made before a human went to make coffee is a plan
 *      about a store that may have changed).
 *   3. **Reads are pure** (§5 G9). Inspecting the census or the permanent list
 *      writes nothing and logs nothing; loudness about corruption belongs at
 *      mutation time.
 *
 * `run()` returns an exit code and never calls `process.exit`, so every command
 * is testable against a temp dir with a faked console.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Counterpart } from "../../core/counterpart.js";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
// `band` is imported rather than mirrored: the dashboard computes the live
// band with this exact function, and two implementations of "which band is this
// row in today" is how the two surfaces disagreed in the first place.
import { TUNABLES, band } from "../../core/physics/index.js";
import { LANE_ORDER, PREFACE_RESERVE_BYTES } from "../../core/self/index.js";
// The ONE predicate for "this row is the journal, not a memory" — the same one
// the sleep phases and the dashboard's census use. A second copy of that test
// living here is how the console drifted away from them in the first place.
import { isJournal } from "../../core/sleep/index.js";
// The deep import into box 3's own driver — the same one `snapshot.ts` and
// `export.ts` make, and filed as INTERFACE-GAPS §5. `verify`'s census needs the
// number of vectors box 3 holds, and `Store` exposes no read for it.
import { openDb } from "../../core/store/db.js";
import type { Db } from "../../core/store/db.js";
import {
  LAYOUT,
  Store,
  dataDir,
  isWithin,
  paths,
  storeExists,
} from "../../core/store/index.js";
import type { Band, Kind } from "../../core/types.js";
// The MCP adapter's deliberate-recall dispatcher, imported rather than
// re-implemented: a console with its own question path would be a second set of
// rules about what recall means. `mcp/deliberate.ts` imports nothing from here,
// so the direction stays one-way.
import { deliberateRecall } from "../mcp/deliberate.js";
import { exportStore } from "./export.js";
import {
  BIN,
  configObject,
  credentialsTemplate,
  installLayout,
  layoutRefusal,
  mcpCommand,
  settingsBlock,
  writeOnce,
} from "./install.js";
import { ownerRemoval, planRemoval } from "./removal.js";
import { snapshot, snapshotName } from "./snapshot.js";

export const COMMANDS = [
  "status",
  "install",
  "init",
  "note",
  "recall",
  "export",
  "backup",
  "remove",
  "verify",
  "backfill-claims",
  "rebrief",
] as const;
export type Command = (typeof COMMANDS)[number];

/** Commands that change durable state. Under observer, every one of them refuses. */
export const OWNER_OPS: readonly Command[] = [
  "install",
  "init",
  // `note` deposits. `recall` is a pure read and stays off this list, exactly
  // like `status`: an instrument may look at a memory and may not add to one.
  "note",
  "export",
  "backup",
  "remove",
  "verify",
  "backfill-claims",
  "rebrief",
];

export const EXIT = {
  ok: 0,
  usage: 1,
  refused: 2,
  failed: 3,
} as const;

export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Interactive confirmation. ABSENT means non-interactive, and a destructive
   *  command refuses rather than proceeding unconfirmed. */
  prompt?: (question: string) => Promise<string>;
}

export interface RunOptions {
  io: Io;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /**
   * The home directory `install` writes its configuration under. Real runs never
   * pass it; the TESTS always do, because `install` writes to
   * `~/.counterparts/claude-code.json` by design — that is the one path the
   * hooks read — and a test that used the real one would write the owner's live
   * configuration. The hermetic rule (CLAUDE.md) has no exceptions, so the seam
   * is here rather than in a mocked `os` module.
   */
  home?: string;
}

export function usage(): string {
  return [
    "counterparts — the owner's console for a Counterparts memory store.",
    "",
    "  status              What is held, what left, what was removed. Read-only.",
    "  install             Cold start: create the store, write claude-code.json and a",
    "                      0600 credentials.env under ~/.counterparts/ (the one path",
    "                      the hooks read), and PRINT the host's hooks block and MCP",
    "                      line. Never edits the host. --dir moves the STORE only.",
    "                      --budget <bytes> --name <owner> --embedder --force.",
    "  init                Just a store: create a data dir and PRINT the install steps.",
    "                      No host config, no credentials file, nothing under",
    "                      ~/.counterparts/. For a second store or a scratch one.",
    '                      --name "<owner>" seeds the identity core, as install does.',
    "  note <text>         Remember this, deliberately. The same two doors the MCP",
    "                      tool uses. --kind --title --salience.",
    "  recall <question>   Ask memory a question. Read-only. --id <id> asks for one",
    "                      memory in full instead. --json for the tool's own payload.",
    "  export --out <dir>  Portable copy. --passphrase <secret> or --plaintext.",
    "  backup --out <dir>  Snapshot: prose + canonical DB via VACUUM INTO. Cache excluded.",
    "  remove <id>         The loud removal. Dry run unless --confirm.",
    "  verify              Census of the cache against canonical state. Read-only.",
    "                      --rebuild drops and rebuilds the cache instead; it refuses",
    "                      while the cache holds embeddings this console has no",
    "                      embedder to recompute, unless --drop-vectors is passed.",
    "  backfill-claims     Give unclaimed AUTHORED memories the default claimed",
    "                      floor. Dry run unless --apply.",
    "  rebrief             Re-render and republish the wake bundle NOW, through the",
    "                      boundary's own renderer. Advances no sleep marker and runs",
    "                      no other sleep phase. Needs an injection ceiling, and says",
    "                      which of these gave it one: --budget <bytes>, else",
    "                      <dir>/../claude-code.json (beside the store), else",
    "                      ~/.counterparts/claude-code.json (where the hooks read).",
    "                      Never a config INSIDE the data dir — that store stops",
    "                      opening (§5 G11).",
    "",
    "  --dir <path>        The data directory (default: $COUNTERPARTS_DATA_DIR).",
    "  --observer          Stand down: read-only, owner operations refuse.",
    "  <command> --help    Just that command: what it does and every flag it takes.",
    "",
    "Owner operations never run under observer, and removal is the only one that",
    "asks for a human (CONTRACT §5 G12: owner-in-the-loop is a short, named list).",
  ].join("\n");
}

interface Parsed {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean | undefined>;
}

/**
 * WHICH FLAGS EACH COMMAND TAKES, and the reason this table exists at all.
 *
 * `parseArgs` runs with `strict: false` — it has to, because a strict parse
 * THROWS and this console does not hand an owner a stack trace. The cost, until
 * 2026-09-04, was that an undeclared flag was silently swallowed: a
 * cold-stranger review typed `counterparts note "…" --dirr <store2>`, got
 * `Remembered mem_… — minted.`, and found store2 still empty — the note had gone
 * to the DEFAULT store, which on a real machine is the owner's live memory, and
 * `--dirr` never appeared in the output. A typo in the one flag that says WHICH
 * STORE is the sharpest edge this console has, and it was the one thing the
 * parser would not mention.
 *
 * So: every flag is declared per command, and anything else is refused BEFORE a
 * store is opened. Two rules, both mechanized in `unknownFlag` below:
 *
 *   1. **A flag nobody declared is an error**, with the nearest declared flag
 *      named if there is a near one. Silence is what made the write invisible.
 *   2. **A flag that wants a value and got none is an error.** `strict: false`
 *      turns `--dir` at the end of a line into the BOOLEAN `true`, which every
 *      reader here treats as "absent" — the same silence one step along.
 */
export const COMMON_FLAGS: readonly string[] = ["dir", "observer", "help"];

export const COMMAND_FLAGS: Record<Command, readonly string[]> = {
  status: [],
  install: ["budget", "name", "embedder", "force"],
  // `init` takes `--name` for the same reason `install` does: §3 routes second
  // and scratch stores here, and a store with no identity core is a store the
  // wake has nothing to say about.
  init: ["name"],
  note: ["kind", "title", "salience"],
  recall: ["id", "json"],
  export: ["out", "passphrase", "plaintext"],
  backup: ["out"],
  // `strike-by-content-across-scopes` is the one chase this console refuses by
  // default: a row whose provenance recorded no scope (every migrated row) can
  // only be chased in the buffer by matching its body, and matching a body
  // across every project on the machine is how one removal reaches into work
  // nobody named. The dry run lists what it WOULD match; this flag performs it.
  remove: ["confirm", "reason", "strike-by-content-across-scopes"],
  verify: ["rebuild", "drop-vectors"],
  "backfill-claims": ["apply"],
  rebrief: ["budget"],
};

/**
 * WHAT EACH COMMAND IS, in one line — the lede of its own help page.
 *
 * `usage()` already carried these sentences, wrapped to fit a block. They are
 * declared here rather than parsed back out of it, because a help page built by
 * re-reading another help page's formatting breaks the moment somebody re-wraps
 * a line.
 */
export const COMMAND_BLURB: Record<Command, string> = {
  status: "What is held, what left, what was removed. Read-only.",
  install:
    "Cold start: create the store, write claude-code.json and a 0600 credentials.env under ~/.counterparts/ (the one path the hooks read), and PRINT the host's hooks block and MCP line. It never edits the host.",
  init: "Just a store: create a data dir and PRINT the install steps. For a second store or a scratch one.",
  note: "Remember this, deliberately — the same two doors the MCP tool uses.",
  recall: "Ask memory a question. Read-only.",
  export: "A portable copy of the store, encrypted unless you say otherwise.",
  backup: "Snapshot: prose plus the canonical DB via VACUUM INTO. The cache is excluded.",
  remove: "The loud removal. Dry run unless --confirm.",
  verify: "Census of the cache against canonical state. Read-only unless --rebuild.",
  "backfill-claims": "Give unclaimed AUTHORED memories the default claimed floor. Dry run unless --apply.",
  rebrief: "Re-render and republish the wake bundle NOW, through the boundary's own renderer.",
};

/** The invocation line, where a command takes something that is not a flag. */
const COMMAND_ARGS: Partial<Record<Command, string>> = {
  note: ' "<text>"',
  recall: ' "<question>"',
  remove: " <id>",
};

/**
 * EVERY FLAG, IN ONE SENTENCE. Keyed by the names `COMMAND_FLAGS` and
 * `COMMON_FLAGS` already declare, so `counterparts <command> --help` prints
 * exactly what `unknownFlag` accepts — one table read twice, rather than a help
 * page and a parser that drift apart. The test walks every declared flag
 * against this record, so a flag added without a sentence fails there instead
 * of printing as a bare name.
 */
const FLAG_HELP: Record<string, string> = {
  dir: "the data directory (default: $COUNTERPARTS_DATA_DIR, else ~/.counterparts/store)",
  observer: "stand down: read-only, and every owner operation refuses",
  help: "this page — it opens nothing and writes nothing",
  budget: "the injection ceiling, in bytes",
  name: "the owner's name; it seeds the identity core",
  embedder: "record that an embedder will be configured",
  force: "overwrite configuration this command already wrote once",
  kind: "self, person, entity, skill, place or fact",
  title: "a title for the memory, instead of one taken from its first line",
  salience: "0..1 — how much this one matters",
  id: "one memory, by id, instead of a question",
  json: "the tool's own payload rather than the console's rendering",
  out: "the directory to write into",
  passphrase: "encrypt the export with this secret",
  plaintext: "do not encrypt the export (said on purpose, never by default)",
  confirm: "actually do it — without this, removal is a dry run",
  reason: "the reason, recorded with the removal",
  rebuild: "drop and rebuild the cache instead of counting it",
  "drop-vectors": "let the rebuild lose vectors this console has no embedder to recompute",
  apply: "actually do it — without this, it is a dry run",
};

/**
 * One command's own help page: what it is, how it is invoked, and every flag it
 * takes with a sentence each.
 *
 * The gap this closes (cold-stranger review, 2026-09-04, #9): `counterparts
 * <command> --help` printed the whole console's usage, so the flags a command
 * actually takes were listed nowhere a person could ask for them — the only
 * surface that knew was the refusal you got AFTER typing one wrong. The table
 * that refusal reads is the table this page prints.
 */
export function commandHelp(command: Command): string {
  const own = COMMAND_FLAGS[command] ?? [];
  const flagLine = (name: string): string => {
    const shown = `--${name}${VALUED_FLAGS.includes(name) ? " <value>" : ""}`;
    return `  ${shown.padEnd(20)} ${FLAG_HELP[name] ?? "(undocumented)"}`;
  };
  return [
    `counterparts ${command} — ${COMMAND_BLURB[command]}`,
    "",
    `  counterparts ${command}${COMMAND_ARGS[command] ?? ""}${own.length === 0 ? "" : " [flags]"} [--dir <path>]`,
    "",
    ...(own.length === 0
      ? ["This command takes no flags of its own."]
      : [`Flags for ${command}:`, ...own.map(flagLine)]),
    "",
    "Everywhere:",
    ...COMMON_FLAGS.map(flagLine),
    "",
    "Any other flag is refused before the store is opened.",
  ].join("\n");
}

/** Flags whose value is a string; anything else here is a boolean switch. */
const VALUED_FLAGS: readonly string[] = [
  "dir",
  "out",
  "reason",
  "passphrase",
  "name",
  "kind",
  "title",
  "salience",
  "id",
  "budget",
];

/** Levenshtein, small and local. Only ever used to say "did you mean". */
function editDistance(a: string, b: string): number {
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((row[j - 1] ?? 0) + 1, (rows[i - 1]?.[j] ?? 0) + 1, (rows[i - 1]?.[j - 1] ?? 0) + cost));
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

/**
 * The refusal sentence for `argv` under `command`, or null when every flag is
 * one this command declares and every valued flag was given a value.
 *
 * Pure over its arguments and exported, so the test can walk every command
 * without a store, a console or a process.
 */
export function unknownFlag(command: Command, argv: readonly string[]): string | null {
  const allowed = [...COMMON_FLAGS, ...(COMMAND_FLAGS[command] ?? [])];
  for (const token of argv) {
    if (!token.startsWith("--") || token === "--") continue;
    const [rawName, inline] = token.slice(2).split("=", 2);
    const name = rawName ?? "";
    if (name.length === 0) continue;
    if (!allowed.includes(name)) {
      // Nearest declared flag, but only when it is actually near: a suggestion
      // pulled from across the alphabet is worse than no suggestion.
      const near = allowed
        .map((f) => ({ f, d: editDistance(name, f) }))
        .filter((x) => x.d <= Math.max(2, Math.floor(x.f.length / 3)))
        .sort((a, b) => a.d - b.d)[0];
      return (
        `unknown flag --${name}` +
        (near === undefined ? "" : `; did you mean --${near.f}?`) +
        `\n  '${command}' takes: ${allowed.map((f) => `--${f}`).join(" ")}` +
        "\n  Nothing was opened and nothing was written."
      );
    }
    if (VALUED_FLAGS.includes(name) && inline === undefined) {
      const next = argv[argv.indexOf(token) + 1];
      if (next === undefined || next.startsWith("--")) {
        return (
          `--${name} needs a value, and none followed it.` +
          "\n  Nothing was opened and nothing was written."
        );
      }
    }
  }
  return null;
}

export function parse(argv: readonly string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    options: {
      dir: { type: "string" },
      out: { type: "string" },
      reason: { type: "string" },
      passphrase: { type: "string" },
      plaintext: { type: "boolean" },
      confirm: { type: "boolean" },
      name: { type: "string" },
      embedder: { type: "boolean" },
      force: { type: "boolean" },
      kind: { type: "string" },
      title: { type: "string" },
      salience: { type: "string" },
      id: { type: "string" },
      json: { type: "boolean" },
      apply: { type: "boolean" },
      // `verify`'s two: the rebuild is opt-in, and dropping vectors this console
      // cannot recompute is opt-in on top of that. Declared rather than left to
      // `strict: false`, which does not make an undeclared boolean reliable.
      rebuild: { type: "boolean" },
      "drop-vectors": { type: "boolean" },
      budget: { type: "string" },
      observer: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  return {
    command: positionals[0],
    positional: positionals.slice(1),
    flags: values as Record<string, string | boolean | undefined>,
  };
}

export async function run(argv: readonly string[], opts: RunOptions): Promise<number> {
  const { io } = opts;
  const env = opts.env ?? process.env;
  const now = opts.now ?? ((): number => Date.now());
  const parsed = parse(argv);

  // `--help` is an ANSWERED question, whatever else is on the line: exit 0.
  // Bare `counterparts` is an invocation that named nothing, and stays a usage
  // error. The two used to share the failing code, so the second command a
  // stranger runs set `$?` to 1 and any `set -e` script died on the help text
  // (cold-stranger review, §6.10).
  if (parsed.flags["help"] === true) {
    // A COMMAND NAMED BESIDE `--help` IS A QUESTION ABOUT THAT COMMAND.
    // `counterparts note --help` used to print the whole console's usage, which
    // answers a different question than the one asked and lists none of the
    // flags `note` takes. Bare `--help` still prints the console's usage.
    const named = parsed.command;
    if (named !== undefined && (COMMANDS as readonly string[]).includes(named)) {
      io.out(commandHelp(named as Command));
      return EXIT.ok;
    }
    io.out(usage());
    return EXIT.ok;
  }
  if (parsed.command === undefined) {
    io.out(usage());
    return EXIT.usage;
  }
  if (!(COMMANDS as readonly string[]).includes(parsed.command)) {
    io.err(`unknown command: ${parsed.command}`);
    io.out(usage());
    return EXIT.usage;
  }
  const command = parsed.command as Command;

  // FIRST, before the stance, before the data dir, before any store: a flag
  // this command does not take is a command line that does not mean what it
  // says, and the store it would have written to is the one nobody named.
  const badFlag = unknownFlag(command, argv);
  if (badFlag !== null) {
    for (const line of `refused: ${badFlag}`.split("\n")) io.err(line);
    return EXIT.refused;
  }

  const observer =
    parsed.flags["observer"] === true ||
    env["COUNTERPARTS_OBSERVER"] === "1" ||
    env["COUNTERPARTS_OBSERVER"] === "true";
  if (observer && OWNER_OPS.includes(command)) {
    // Distinguishable, not silent (scar §2.4): the console says which stance
    // refused and which command it refused, so a stood-down run is legible.
    io.err(
      `refused: '${command}' is an owner operation and this console is in observer stance. An instrument reads; it does not change the store.`,
    );
    return EXIT.refused;
  }

  // `install` resolves its OWN layout and must not go through `resolveDir`:
  // the store's default data dir is `~/.counterparts`, which is exactly the
  // directory this command writes two unclassifiable files into (`install.ts`
  // rule 1). Its default store is the `store/` beneath that instead.
  if (command === "install") {
    try {
      return installCommand(parsed, io, env, opts.home);
    } catch (err) {
      io.err(`install failed: ${String((err as Error).message ?? err)}`);
      return EXIT.failed;
    }
  }

  let dir: string;
  try {
    dir = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : resolveDir(env);
  } catch (err) {
    io.err(String((err as Error).message ?? err));
    return EXIT.refused;
  }

  // The console reports; it does not crash. A stack trace on the owner's
  // terminal is the least legible failure this program can produce
  // (constitution 16), and the failure that reached the field was exactly an
  // uncaught open — "database is locked" from a store another process was
  // writing (live-verify 2026-08-25). Each command still handles what it can
  // handle; this is the floor under all of them.
  try {
    switch (command) {
      case "status":
        return statusCommand(dir, io, typeof parsed.flags["dir"] === "string");
      case "init":
        return initCommand(dir, io, opts.home, typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined);
      case "note":
        return await noteCommand(dir, io, parsed);
      case "recall":
        return recallCommand(dir, io, parsed);
      case "verify":
        return verifyCommand(dir, io, parsed.flags);
      case "backup":
        return await backupCommand(dir, io, parsed.flags["out"], now);
      case "export":
        return exportCommand(dir, io, parsed.flags);
      case "remove":
        return await removeCommand(dir, io, parsed.positional[0], parsed.flags, now);
      case "backfill-claims":
        return backfillClaimsCommand(dir, io, parsed.flags["apply"] === true);
      case "rebrief":
        return rebriefCommand(dir, io, parsed.flags["budget"], now, opts.home);
    }
  } catch (err) {
    io.err(`${command} failed: ${String((err as Error).message ?? err)}`);
    return EXIT.failed;
  }
}

/** `dataDir()` reads the environment AT CALL TIME and runs the path guard. */
function resolveDir(env: Record<string, string | undefined>): string {
  const prior = process.env["COUNTERPARTS_DATA_DIR"];
  if (env !== process.env) {
    // A caller-supplied environment is honored without mutating the real one
    // for longer than the call: the tests pass one, and a test that leaked it
    // would be a test that changed the next test's store.
    const value = env["COUNTERPARTS_DATA_DIR"];
    try {
      if (value === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
      else process.env["COUNTERPARTS_DATA_DIR"] = value;
      return dataDir();
    } finally {
      if (prior === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
      else process.env["COUNTERPARTS_DATA_DIR"] = prior;
    }
  }
  return dataDir();
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * The census, owner-side. It opens the store in OBSERVER stance whatever the
 * console's own stance is: reading the store must not be able to change it, and
 * the store's own seam is the thing that enforces that (observer-mode G3).
 *
 * Unlike the model-facing census in `adapters/mcp/`, this one may name ids and
 * enumerate the permanent list — "everything permanent is enumerable and
 * inspectable on demand: a list, not a cadence" (§14.1 G9). The owner's console
 * is exactly where that list belongs.
 */
function statusCommand(dir: string, io: Io, namedDir: boolean): number {
  if (!storeExists(dir)) {
    // An instrument that MINTS a data dir by looking at one is a wart — and
    // since 2026-08-26 the store itself refuses it (INTERFACE-GAPS §7 closed:
    // observer + absent store is STORE_UNINITIALIZED at open). This guard
    // stays for the friendlier sentence.
    //
    // TWO THINGS CHANGED ON 2026-09-04, both from a cold-stranger reading (#11).
    //
    // It exits 1, not 0. "There is no store here" is not a census; a script
    // that asks a store what it holds and gets an answer about nothing at all
    // has not succeeded, and `set -e` around `counterparts status` sailed
    // straight past a typo'd `--dir`. `usage`, not `failed`: nothing broke —
    // the line named a place with no store in it. The sentence goes to stderr
    // for the same reason, because a non-zero exit whose only output was on
    // stdout is half a refusal.
    //
    // And the remedy carries the dir the owner actually typed. `Run
    // 'counterparts init'` after `status --dir /somewhere` would have created
    // the store in the DEFAULT place — not the one the sentence above it just
    // named — which is the worst kind of advice: it works, and it works
    // somewhere else.
    io.err(
      `No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`,
    );
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = Store.open({ dir, observer: true });
  } catch (err) {
    io.err(`could not open the store: ${String((err as Error).message ?? err)}`);
    return EXIT.failed;
  }
  try {
    const kinds: Kind[] = ["self", "person", "entity", "skill", "place", "fact"];
    const bands: Band[] = ["episodic", "semantic", "identity"];
    const denied = new Set(store.deniedIds());
    const byKind: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    const permanent: { id: string; title: string; why: string }[] = [];
    // THREE POPULATIONS, THREE LABELS. A single `live` counter that swallowed
    // all of them is how one demo store reported three different sizes on
    // 2026-09-05: the wake preface says `<n> memories` and counts
    // `type: "memory"` rows only (`self/briefing.ts#prefaceLine`,
    // `store.countMemories({ type: "memory", archived: false })`), while this
    // census walked every row and called the total "Live memories" — 143 here
    // against the preface's 121, the difference being exactly the 13 entities
    // and 9 beliefs. Both numbers were right; one of the labels was not.
    let memories = 0;
    let schemas = 0;
    let journal = 0;
    let archived = 0;
    let superseded = 0;
    const day = store.livedDay();

    for (const id of store.list()) {
      const row = store.row(id);
      if (row === undefined || denied.has(id)) continue;
      if (row.archived === 1) {
        archived += 1;
        continue;
      }
      if (row.superseded_by !== null) {
        superseded += 1;
        continue;
      }
      // THE JOURNAL IS NOT A MEMORY. `store.list()` returns every row, and
      // episodes are rows — so a census that walks it and counts what is left
      // reports the journal as memories, with a `self` kind and an `episodic`
      // band it never earned. `sleep/types.ts#isJournal` is the one predicate
      // for this; PR #27 threaded it through five sleep phases and the
      // dashboard's census and missed the console. Counted on its own line
      // rather than dropped, because a number that vanished would be the same
      // bug facing the other way (§2.4: what is skipped is said out loud).
      if (isJournal(row)) {
        journal += 1;
        continue;
      }
      if (row.type === "schema") schemas += 1;
      else memories += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      // THE LIVE BAND, computed, never the stored column. `memories.band` is a
      // birth fossil — episodic at mint, identity at promotion, and never
      // "semantic" — so reading it reported `episodic 128 / semantic 0` where
      // the dashboard, which does this arithmetic, reported `54 / 74`
      // (LAUNCH-STATUS §I10). Same helper, same day, same answer.
      let liveBand: Band = row.band;
      try {
        liveBand = band(store.physicsOf(id), day);
      } catch {
        // A row whose physics will not read keeps its recorded band, which is
        // the dashboard's fallback too.
      }
      byBand[liveBand] = (byBand[liveBand] ?? 0) + 1;
      if (row.protected === 1 || row.promoted_identity === 1) {
        let title = "(untitled)";
        try {
          title = store.readProse(id).title ?? "(untitled)";
        } catch {
          title = "(prose unreadable)";
        }
        permanent.push({
          id,
          title,
          why: row.protected === 1 ? "protected" : "promoted to identity",
        });
      }
    }

    io.out(`Store: ${store.dir}`);
    io.out(`Lived day ${store.livedDay()}, last active ${store.getMeta("lastActiveDate") || "never"}`);
    io.out("");
    // One line, four labelled populations, and the first number is the one the
    // wake preface says. Anything that adds them into a single "live" total is
    // a surface that will disagree with the briefing the model reads.
    io.out(
      `Memories: ${memories}` +
        `   Beliefs and entities: ${schemas}` +
        `   Journal: ${journal} ${journal === 1 ? "episode" : "episodes"}` +
        `   Archived: ${archived}   Superseded: ${superseded}`,
    );
    io.out(`  by kind: ${kinds.map((k) => `${k} ${byKind[k] ?? 0}`).join("  ")}   (memories + beliefs and entities)`);
    io.out(`  by band: ${bands.map((b) => `${b} ${byBand[b] ?? 0}`).join("  ")}   (computed from physics today, not the stored column)`);
    io.out("  Memories is the number the wake preface states; the journal does not decay.");
    io.out("");

    const removals = store.removalRecord().filter((r) => r.stage === "complete");
    io.out(`Removed: ${removals.length}`);
    for (const row of removals) {
      // Owner side: the id and the date, no body and no content hash — ever.
      io.out(`  ${new Date(row.at).toISOString().slice(0, 10)}  ${row.memory_id}  by ${row.actor}`);
    }
    io.out("");
    io.out(`Permanent (enumerable on demand, §14.1 G9): ${permanent.length}`);
    for (const entry of permanent) io.out(`  ${entry.id}  ${entry.title}  — ${entry.why}`);
    io.out("");
    io.out("Layout:");
    for (const entry of LAYOUT) {
      const present = existsSync(join(store.dir, entry.name)) ? " " : "-";
      io.out(`  ${present} ${entry.backup ? "backed up" : "excluded "}  ${entry.name}  — ${entry.why}`);
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

// ── install ─────────────────────────────────────────────────────────────────

/**
 * The cold start. It writes the three things that are OURS — the store, the
 * adapter's configuration beside it, an empty credential file at 0600 — and
 * PRINTS the two that belong to the host.
 *
 * The refusal direction matters more than the happy path: an existing
 * configuration is KEPT and reported, never merged and never silently
 * rewritten, because the file it would rewrite is the one pointing at somebody's
 * live memory. `--force` is the only way past that, and it says so.
 */
function installCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  home?: string,
): number {
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  const layout = home === undefined ? installLayout(dirFlag, env) : installLayout(dirFlag, env, home);
  // Before a single directory: a store that would hold its own configuration is
  // a store that never opens again.
  const refusal = layoutRefusal(layout);
  if (refusal !== null) {
    io.err(refusal);
    return EXIT.refused;
  }

  let budgetBytes: number | undefined;
  const budgetFlag = parsed.flags["budget"];
  if (typeof budgetFlag === "string" && budgetFlag.length > 0) {
    const n = Number(budgetFlag);
    if (!Number.isInteger(n) || n <= 0) {
      io.err(`refused: --budget takes a positive whole number of bytes, not '${budgetFlag}'.`);
      return EXIT.refused;
    }
    budgetBytes = n;
  }
  const name = typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined;
  const force = parsed.flags["force"] === true;
  const embedder = parsed.flags["embedder"] === true;

  // The store first, and through `Store` itself, so the forbidden-root guard
  // runs before a single directory is created (scar §2.13).
  const existed = storeExists(layout.store);
  let store: Store;
  try {
    store = Store.open({ dir: layout.store });
  } catch (err) {
    io.err(`refused: ${String((err as Error).message ?? err)}`);
    return EXIT.refused;
  }
  const resolved = store.dir;
  store.close();

  // SEED THE CORE NOW, not at the first hook. `install` used to write the name
  // into the config and stop there — `openAdapter` passes `config.identity` to
  // `Counterpart.open`, so the core appeared only when a session first fired.
  // Two things were wrong with that. §3 says "It seeds the identity core" of a
  // command that had not yet; and `init --name` DID seed it immediately, so the
  // two commands the same page calls interchangeable produced different stores
  // (found 2026-09-04, when a captured recall reproduced one row higher than
  // the page said). Same door as `init`: `Counterpart.open`'s own option, which
  // is an ENSURE, so the hook's later call finds it and mints nothing.
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }

  const body = configObject({
    layout,
    ...(budgetBytes === undefined ? {} : { budgetBytes }),
    ...(name === undefined ? {} : { name }),
    embedder,
  });
  const config = writeOnce(layout.config, `${JSON.stringify(body, null, 2)}\n`, { force });
  const creds = writeOnce(layout.credentials, credentialsTemplate(), { force, mode: 0o600 });

  io.out(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  io.out(`  ${config.what} ${config.path}`);
  io.out(`  ${creds.what} ${creds.path} (mode ${creds.mode ?? "?"})`);
  // The SAME sentence `init` prints, because the two commands did the same
  // thing: a page that calls them interchangeable and then has them say it
  // differently has made the reader do the comparison.
  if (seeded) io.out(`  identity core seeded for ${name ?? ""} — the thing this memory is about.`);
  if (!isWithin(layout.base, resolved)) {
    // --dir moved the STORE. It cannot move the configuration: the hooks take no
    // flag and read one hardcoded path (falling back to COUNTERPARTS_DATA_DIR
    // only when that file names no store), and a hook that finds nothing stands
    // down and exits 0 — so a config they cannot find is a silence nobody
    // debugs. Said out loud rather than left for the reader to discover from an
    // ambient half that never fires.
    io.out("");
    io.out(`  --dir moved the STORE only. The configuration stays at ${config.path}:`);
    io.out("  that is the one path the hooks read for their configuration, hardcoded,");
    io.out(`  and it points at your store with "dataDir": "${resolved}".`);
  }
  if (config.what === "kept" || creds.what === "kept") {
    io.out("  (an existing file is never rewritten — pass --force to replace it)");
  }
  if (creds.mode !== undefined && creds.mode !== "600") {
    io.out(`  WARNING: ${creds.path} is mode ${creds.mode}; group or other can read your keys.`);
  }
  if (budgetBytes === undefined) {
    io.out("");
    io.out('  NO "injectionBudgetBytes" was written: nobody told us this host\'s ceiling');
    io.out("  and this package invents none (scar §2.18). Re-run with --budget <bytes>,");
    io.out(`  or add the key to ${config.path}.`);
  }

  io.out("");
  io.out("Two steps left, and they are the HOST'S files, so they are printed, not applied.");
  io.out("Nothing below has been written and no host configuration was read.");
  io.out("");
  io.out("  1. Merge this into ~/.claude/settings.json (one script, five events):");
  io.out("");
  for (const line of settingsBlock().split("\n")) io.out(`     ${line}`);
  io.out("");
  io.out("     The runtime and the script are ABSOLUTE on purpose. A host's process");
  io.out("     environment is not your login shell's — measured on this package's own");
  io.out(`     credentials, day 0 — so '${BIN.hook}' on a PATH that lacks bun is a`);
  io.out("     hook that never runs and says nothing.");
  io.out("");
  io.out("  2. Register the MCP server, so note, recall and session_end exist:");
  io.out("");
  io.out(`     ${mcpCommand(resolved)}`);
  io.out("");
  io.out(`  Then restart Claude Code, and check it with: ${BIN.cli} status --dir ${resolved}`);
  io.out("  An MCP server keeps the code it was launched with: after an upgrade, restart");
  io.out("  every open session or the old server keeps serving.");
  return EXIT.ok;
}

// ── init ────────────────────────────────────────────────────────────────────

/**
 * Create the data dir and PRINT the installation steps. It does not write a
 * host's configuration file: an installer that edits somebody's settings
 * without being asked is the same class of surprise as a memory layer that
 * writes without being asked. The steps are printed; the owner runs them.
 *
 * The forbidden-root refusal is not implemented here — `Store`'s constructor
 * calls `assertSafeDataDir` before it creates a single directory, so a `--dir`
 * aimed at v1's live store fails before anything exists (scar §2.13). This
 * function only has to not catch it.
 */
function initCommand(dir: string, io: Io, home = homedir(), name?: string): number {
  const existed = storeExists(dir);
  let store: Store;
  try {
    store = Store.open({ dir });
  } catch (err) {
    io.err(`refused: ${String((err as Error).message ?? err)}`);
    return EXIT.refused;
  }
  const resolved = store.dir;
  store.close();

  // `--name` seeds the identity core, through `Counterpart.open`'s own option —
  // the same door `install` reaches by writing `identity` into the config. §3
  // routes second and scratch stores here and then says the core has no default
  // anywhere, so an `init` that could not seed one left the documented path
  // unable to produce the thing the documentation says matters. Idempotent:
  // `ensureIdentityCore` is an ENSURE.
  let seeded = false;
  if (name !== undefined && name.length > 0) {
    const brain = openCounterpart(resolved, false, { name });
    try {
      seeded = true;
    } finally {
      brain.close();
    }
  }

  io.out(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  io.out(
    seeded
      ? `  identity core seeded for ${name ?? ""} — the thing this memory is about.`
      : "  no identity core: pass --name \"<your name>\" to seed one. Nothing else gives a",
  );
  if (!seeded) io.out("  store one, and the wake has nothing to be about without it.");
  io.out("");
  io.out("To install the hooks (not done for you — these edit your host's settings):");
  io.out("");
  io.out("  1. Point the host at the hook entry script for every session-ending event:");
  io.out("       SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact");
  io.out(`       installed:  ${BIN.hook}`);
  io.out("       from a clone: bun run <repo>/src/adapters/claude-code/bin/hook.ts");
  io.out("  2. Register the MCP server so the Stop ask has a way back:");
  io.out(`       installed:  ${BIN.mcp}`);
  io.out("       from a clone: bun run <repo>/src/adapters/mcp/bin/serve.ts");
  io.out("  3. Write the adapter's configuration BESIDE the store, never inside it — the");
  io.out("     layout check refuses an unclassified file in the data dir (§5 G11):");
  io.out(`       ${join(resolved, "..", "claude-code.json")}`);
  io.out('       { "dataDir": "<this dir>", "injectionBudgetBytes": <your host\'s ceiling> }');
  io.out("");
  io.out("     WHO HONORS THAT FILE, exactly: this console reads it for the injection");
  io.out(`     ceiling ('${BIN.cli} rebrief'). The HOOKS DO NOT — they read only`);
  io.out(`       ${join(home, ".counterparts", "claude-code.json")}`);
  io.out("     taking no flag, and falling back to COUNTERPARTS_DATA_DIR only when that");
  io.out("     file names no store. A hook that finds no config stands down quietly and");
  io.out("     exits 0 (a Stop with a question exits 2 on purpose, and that is the only");
  io.out("     non-zero a hook produces), so a config anywhere else is an ambient half");
  io.out(`     that never fires and never says so. To wire the hooks, use '${BIN.cli} install'.`);
  io.out("");
  io.out("The injection ceiling has NO default anywhere in this package: a briefing");
  io.out("refuses to render rather than compose to a number nobody chose (scar §2.18).");
  io.out("");
  io.out(`'${BIN.cli} init' makes a STORE and nothing else — a second store, a scratch`);
  io.out(`one, a store on another disk. '${BIN.cli} install' is the cold start: it owns`);
  io.out("~/.counterparts/, writes step 3 there plus a 0600 credentials file, and prints");
  io.out("1 and 2 filled in and ready to paste.");
  return EXIT.ok;
}

// ── note / recall ───────────────────────────────────────────────────────────

/**
 * `note` and `recall` on the console — the same two acts the MCP tools offer,
 * reachable without a host.
 *
 * **They go through exactly the MCP server's doors, and that is the point.** A
 * second way to write a memory would be a second set of rules about what a
 * memory is: `noteTool` captures the words into the span buffer FIRST and then
 * deposits a draft that CLAIMS that span by hash, because without the claim the
 * end-of-session sweep finds the jot's own text sitting in the buffer and mints
 * it again — a "remember this" channel that costs two memories. `recall` calls
 * `deliberateRecall`, the same dispatcher, so the console cannot drift into a
 * softer question path than the model gets.
 *
 * What is NOT shared is the embedder: the console builds none and opens no
 * socket, so a question here is answered on the lexical channel and says so.
 *
 * Why these exist at all: the cold-stranger review of 2026-09-04 reached the end
 * of the install page having verified that a store existed and was empty, with
 * no way to test the one thing the product is for. They hand-wrote JSON-RPC.
 * Most people will not.
 */
async function noteCommand(dir: string, io: Io, parsed: Parsed): Promise<number> {
  const text = parsed.positional.join(" ").trim();
  if (text.length === 0) {
    io.err('refused: note takes the text to remember, e.g. counterparts note "..."');
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }
  let claimed: number | undefined;
  const salienceFlag = parsed.flags["salience"];
  if (typeof salienceFlag === "string" && salienceFlag.length > 0) {
    const n = Number(salienceFlag);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      io.err(`refused: --salience takes a number from 0 to 1, not '${salienceFlag}'.`);
      return EXIT.refused;
    }
    claimed = n;
  }

  const counterpart = openCounterpart(dir);
  try {
    // THE STORE, FIRST, the way `status` names it. A write whose destination is
    // invisible is the shape the 2026-09-04 review found: a mistyped `--dir`
    // resolved to the default store, the note landed there, and the only line
    // printed was that something had been remembered.
    io.out(`Store: ${counterpart.store.dir}`);
    const session = "console";
    const scope = process.cwd();
    // Step 1 of 2, and the ORDER is the rule (see the docblock above).
    const captured = counterpart.captureJot({ session, scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;

    const draft: Record<string, unknown> = { content: text };
    if (typeof parsed.flags["kind"] === "string") draft["kind"] = parsed.flags["kind"];
    if (typeof parsed.flags["title"] === "string") draft["title"] = parsed.flags["title"];
    if (claimed !== undefined) draft["claimed"] = claimed;

    const deposit = await counterpart.submitJot(draft, {
      session,
      scope,
      ...(ownSpanHash === null ? {} : { ownSpanHash }),
    });
    if (!deposit.deposited) {
      io.err(
        `not stored: ${deposit.reason}${deposit.gate === null ? "" : ` (${deposit.gate})`}`,
      );
      return EXIT.refused;
    }
    io.out(`Remembered ${deposit.memoryId ?? "(no id)"} — ${deposit.reason}.`);
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/** The deliberate look, in plain lines. Writes nothing. */
function recallCommand(dir: string, io: Io, parsed: Parsed): number {
  const idFlag = typeof parsed.flags["id"] === "string" ? parsed.flags["id"].trim() : "";
  const question = parsed.positional.join(" ").trim();
  if (idFlag.length === 0 && question.length === 0) {
    io.err('refused: recall takes a question, e.g. counterparts recall "..." — or --id <id>.');
    return EXIT.usage;
  }
  if (idFlag.length > 0 && question.length > 0) {
    io.err("refused: a question and --id are two different asks. Send one.");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}. Run 'counterparts install' first.`);
    return EXIT.failed;
  }

  const counterpart = openCounterpart(dir);
  try {
    // Same rule as `note` and `status`: say which store answered.
    if (parsed.flags["json"] !== true) io.out(`Store: ${counterpart.store.dir}`);
    const result = deliberateRecall(
      counterpart,
      idFlag.length > 0 ? { handle: idFlag } : { question },
      {
        sessionId: "console",
        owner: true,
        vector: null,
        // The console opens no socket, so the semantic channel never ran, and
        // the answer says which channel did (§9.1 G5).
        semantic: "embedder-off",
      },
    );
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(result, null, 2));
      return result.memories.length > 0 ? EXIT.ok : EXIT.ok;
    }
    io.out(
      `${result.path} · ${result.reason} · semantic ${result.semantic} · ` +
        // "live rows", not "live memories": the denominator counts schemas and
        // episodes too, so a store made with `install --name` reads one higher
        // than its memory count. Naming the population is cheaper than a second
        // number, and `status` prints the split.
        `considered ${result.considered} of ${result.storeSize} live rows · returned ${result.memories.length}`,
    );
    if (result.memories.length === 0) {
      io.out("");
      // NOTHING CAME, said as a sentence rather than as an absence. A blank
      // where a memory would have been is the one output a reader cannot tell
      // from a crash, and the reason belongs in the same breath.
      io.out(
        result.considered === 0
          ? "NOTHING CAME BACK — nothing in the store shared a word with the question, so no memory was even scored."
          : `NOTHING CAME BACK — ${result.considered} ${result.considered === 1 ? "memory was" : "memories were"} scored and none was close enough to show.`,
      );
      io.out("  Try words the memory itself would use, or ask for it by id:");
      io.out("  counterparts recall --id <mem_...>");
      return EXIT.ok;
    }
    for (const m of result.memories) {
      io.out("");
      io.out(`  ${m.id}  [${m.tier}] ${m.kind}${m.title === null ? "" : ` — ${m.title}`}`);
      for (const line of m.body.split("\n")) io.out(`    ${line}`);
    }
    // THE TIER LEGEND, and it is not decoration. `answered` means the question
    // reached something, never that the something is right, and the loudest
    // tier present is the only confidence signal in the output. A reader who
    // takes `[quiet]` for a strong hit is reading a footnote as an answer —
    // the cold-stranger review asked a one-row store about Mars, got the
    // espresso machine, and had nothing on screen to tell it apart from the
    // right answer to a real question.
    io.out("");
    const tiers = new Set(result.memories.map((m) => m.tier));
    for (const [tier, gloss] of [
      ["vivid", "came clearly to mind; the ambient path would have surfaced this"],
      ["quiet", "quietly available; the ambient path would have footnoted it, not said it"],
      ["dim", "reached only because you asked deliberately — lower confidence, and labelled so"],
    ] as const) {
      if (tiers.has(tier)) io.out(`  ${tier} = ${gloss}`);
    }
    if (!tiers.has("vivid")) {
      io.out("  Nothing here came back vividly, so treat these as leads rather than answers.");
    }
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * What box 3 holds right now, read WITHOUT going through `Store` — because
 * `Store` has no read API for it. `unembeddedCount()` is the coverage
 * denominator (live rows with no vector), not a count of the vectors held, and
 * the census needs the latter before it may drop anything.
 *
 * The direct open is the same deep import `snapshot.ts` and `export.ts` already
 * make (INTERFACE-GAPS §5): the CLI genuinely needs the database here, not the
 * store's abstraction of it. It is gated on the file EXISTING, because `openDb`
 * creates what it opens and a census that minted box 3 by looking at it would be
 * the instrument-mints-its-subject wart all over again (§7, closed 2026-08-26).
 */
interface CacheCensus {
  readonly path: string;
  /** False when box 3 has never been built here. Nothing was opened, nothing created. */
  readonly present: boolean;
  /** Null when the file is there and its tables are not — a half-built cache. */
  readonly counts: {
    readonly embeddings: number;
    readonly indexRows: number;
    readonly lengths: number;
    readonly ranking: number;
    /** The distinct ids the token index holds, for the set diff below. */
    readonly indexed: readonly string[];
  } | null;
  readonly why: string | null;
}

function censusCache(dir: string): CacheCensus {
  const path = paths.cache(dir);
  if (!existsSync(path)) return { path, present: false, counts: null, why: "never built" };
  let db: Db | undefined;
  try {
    db = openDb(path);
    const handle = db;
    const n = (sql: string): number => handle.get<{ n: number }>(sql)?.n ?? 0;
    return {
      path,
      present: true,
      why: null,
      counts: {
        embeddings: n("SELECT COUNT(*) AS n FROM embeddings"),
        indexRows: n("SELECT COUNT(*) AS n FROM doc_tokens"),
        lengths: n("SELECT COUNT(*) AS n FROM doc_lens"),
        ranking: n("SELECT COUNT(*) AS n FROM ranking"),
        indexed: handle
          .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM doc_tokens")
          .map((r) => r.memory_id),
      },
    };
  } catch (err) {
    return { path, present: true, counts: null, why: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

/**
 * `verify` — the census by default, the rebuild only when asked, and never the
 * rebuild by accident.
 *
 * **The sharp edge this exists to blunt.** `rebuildCache()` begins with
 * `resetCache`, which DROPS `embeddings` along with the rest of box 3, and this
 * console has no embedder to put them back: on the store this was found against,
 * a bare `counterparts verify` would have deleted ~13,700 vectors that each cost
 * a paid network call to recompute. `store/cache.ts` says the same thing in its
 * own voice about `backfillLengths`. Until PR #37 a bare `verify` was saved only
 * by ACCIDENT — it failed the layout check before it reached the store — and an
 * accident is not a guard.
 *
 * So the destructive half now needs `--rebuild`, and even then it refuses while
 * box 3 holds vectors nothing here can recompute, unless `--drop-vectors` says
 * out loud that losing them is the intent. Refuse-unless-flag is the
 * ADAPTER-level answer; preserving the vectors across a rebuild would take a
 * core change (`rebuildCache({ keepVectors })`), and that is filed in NOTES
 * rather than smuggled in here.
 */
function verifyCommand(dir: string, io: Io, flags: Record<string, string | boolean | undefined>): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  return flags["rebuild"] === true
    ? verifyRebuild(dir, io, flags["drop-vectors"] === true)
    : verifyCensus(dir, io);
}

/**
 * Read-only. Opens the store in OBSERVER stance and box 3 on its own connection,
 * one after the other rather than both at once, and writes nothing canonical.
 * (Constructing a `Store` still rewrites box 3's schema-version row when it is
 * out of date — dashboard INTERFACE-GAPS §1 — which is box 3's business.)
 */
function verifyCensus(dir: string, io: Io): number {
  const store = Store.open({ dir, observer: true });
  let canonical: string[];
  let denied: string[];
  let unembedded: number;
  try {
    canonical = store.list();
    denied = store.deniedIds();
    unembedded = store.unembeddedCount();
  } finally {
    store.close();
  }

  const cache = censusCache(dir);
  io.out(`Store: ${dir}`);
  io.out(`Canonical rows: ${canonical.length}   removed (deny-list): ${denied.length}`);

  // The unreadable half of this is narrow by construction: `Store.open` builds
  // box 3 on the way in, so a cache this process cannot read usually fails the
  // open above and is reported there. It is still handled, because between that
  // close and this read is a window another process can change.
  if (cache.counts === null) {
    io.out(
      cache.present
        ? `Cache: ${cache.path} — unreadable (${cache.why ?? "no reason given"}).`
        : `Cache: absent — box 3 has never been built here.`,
    );
    if (canonical.length === 0) {
      io.out("Nothing canonical to index, so nothing is missing.");
      return EXIT.ok;
    }
    io.err(
      cache.present
        ? `${canonical.length} canonical rows and a cache that would not open — retry (another process may hold it); if it is truly gone, 'counterparts verify --rebuild' builds box 3 again.`
        : `${canonical.length} canonical rows have no index — run 'counterparts verify --rebuild' to build box 3.`,
    );
    return EXIT.failed;
  }

  // A SET DIFF, not arithmetic: `indexed + denied === canonical` can agree by
  // coincidence while holding the wrong ids, and it cannot say WHICH way it is
  // wrong. Both directions are named, because an orphaned index row and an
  // unindexed memory are different problems.
  const indexed = new Set(cache.counts.indexed);
  const known = new Set(canonical);
  const deniedSet = new Set(denied);
  const missing = canonical.filter((id) => !indexed.has(id) && !deniedSet.has(id));
  const orphans = cache.counts.indexed.filter((id) => !known.has(id));

  io.out(`Cache: ${cache.path}`);
  io.out(
    `  indexed documents: ${indexed.size}   index rows: ${cache.counts.indexRows}   ` +
      `document lengths: ${cache.counts.lengths}   ranking rows: ${cache.counts.ranking}`,
  );
  io.out(`  embeddings: ${cache.counts.embeddings}   live memories with no vector: ${unembedded}`);
  if (missing.length === 0 && orphans.length === 0) {
    io.out("The cache covers every canonical row and holds nothing else.");
    return EXIT.ok;
  }
  io.err(
    `Cache incomplete: ${missing.length} canonical rows are not indexed, ${orphans.length} indexed ids are not canonical rows — ` +
      `'counterparts verify --rebuild' rebuilds box 3.`,
  );
  return EXIT.failed;
}

/**
 * Rebuild box 3 from canonical state and report. The database is a cache: if
 * this ever loses something canonical, the claim was false and the report is
 * where it shows. What cannot be recomputed is DECLARED, with an owner and a
 * repair, rather than silently missing (§5 G8).
 *
 * The vector count is taken BEFORE a writable store is opened, so the refusal
 * path never constructs one.
 */
function verifyRebuild(dir: string, io: Io, dropVectors: boolean): number {
  const cache = censusCache(dir);
  // FAIL CLOSED. A count that could not be taken is not a count of zero: box 3
  // is the file the Stop-hook worker writes vectors into, so "database is
  // locked" after the busy timeout is an ordinary outcome here — and a guard
  // whose failure mode is "could not count the vectors, so dropped them" is not
  // a guard. An ABSENT cache is different and stays fine: there is nothing to lose.
  if (cache.present && cache.counts === null && !dropVectors) {
    io.err(
      `Refusing: box 3 exists but could not be read (${cache.why ?? "no reason given"}), so this console cannot tell how many embeddings --rebuild would drop — retry, or pass --drop-vectors to proceed anyway.`,
    );
    return EXIT.refused;
  }
  const held = cache.counts?.embeddings ?? 0;
  const vectors = `${held} ${held === 1 ? "embedding" : "embeddings"}`;
  if (held > 0 && !dropVectors) {
    io.err(
      `Refusing: --rebuild drops box 3 and this console has no embedder, so the ${vectors} it holds would be gone and each one costs a paid network call to recompute — pass --drop-vectors if losing them is what you mean.`,
    );
    return EXIT.refused;
  }
  const store = Store.open({ dir });
  try {
    const canonical = store.list().length;
    const report = store.rebuildCache();
    io.out(`Canonical rows: ${canonical}`);
    if (held > 0) io.out(`Dropped on your say-so (--drop-vectors): ${vectors}.`);
    io.out(`Re-indexed: ${report.indexed}`);
    io.out(`Skipped as removed (deny-list): ${report.skippedDenied}`);
    io.out(`Not recomputed: ${report.unrecomputed}`);
    for (const declared of report.declared) {
      io.out(`  declared: ${declared.what} — owner ${declared.owner}; repair: ${declared.repair}`);
    }
    const accounted = report.indexed + report.skippedDenied;
    if (accounted !== canonical) {
      io.err(`MISMATCH: ${canonical} canonical rows, ${accounted} accounted for.`);
      return EXIT.failed;
    }
    io.out("Every canonical row is accounted for.");
    return EXIT.ok;
  } finally {
    store.close();
  }
}

// ── backup ──────────────────────────────────────────────────────────────────

function backupCommand(
  dir: string,
  io: Io,
  out: string | boolean | undefined,
  now: () => number,
): number {
  if (typeof out !== "string" || out.length === 0) {
    io.err("backup needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // §5 G8: A BACKUP NEVER THROWS — and OPENING the store is part of the backup.
  // That is the part that threw in the field: a store held by another process's
  // write transaction answered "database is locked" before `snapshot()`'s own
  // graceful path could be reached (live-verify 2026-08-25). An open that fails
  // is now an ordinary failure report with an exit code.
  let store: Store;
  try {
    store = Store.open({ dir, observer: true });
  } catch (err) {
    io.out(`Snapshot: none — nothing was copied.`);
    io.err(`  could not open the store: ${String((err as Error).message ?? err)}`);
    return EXIT.failed;
  }
  try {
    const target = join(out, snapshotName(now()));
    const report = snapshot(store, target);
    io.out(`Snapshot: ${report.target}`);
    for (const entry of report.copied) {
      io.out(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.name}  (${entry.method}, ${entry.files} files)`);
    }
    for (const entry of report.excluded) io.out(`  --   ${entry.name}  — ${entry.why}`);
    for (const error of report.errors) io.err(`  ${error}`);
    // §5 G8: a backup problem is reported, never thrown — it must not be able
    // to take a consolidation cycle down with it.
    return report.ok ? EXIT.ok : EXIT.failed;
  } finally {
    store.close();
  }
}

// ── export ──────────────────────────────────────────────────────────────────

function exportCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const out = flags["out"];
  if (typeof out !== "string" || out.length === 0) {
    io.err("export needs --out <dir>");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const store = Store.open({ dir, observer: true });
  try {
    const report = exportStore(store, {
      target: out,
      ...(typeof flags["passphrase"] === "string" ? { passphrase: flags["passphrase"] } : {}),
      ...(flags["plaintext"] === true ? { plaintext: true } : {}),
    });
    if (!report.ok) {
      io.err(report.reason);
      return EXIT.refused;
    }
    io.out(`Exported ${report.files} files (${report.bytes} bytes) to ${report.target}`);
    io.out(`Mode: ${report.mode}. ${report.reason}`);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

// ── remove ──────────────────────────────────────────────────────────────────

/**
 * THE LOUD REMOVAL. Dry run by default; `--confirm` plus a typed-back id to go
 * through with it; the plan re-made under a freshly opened store afterwards.
 *
 * Nothing about this is fast, and that is the design: removal has never fired in
 * production in any generation (§7 OQ2), which by scar §2.17's own criterion
 * makes it unproven rather than sound. The friction is what makes it safe to
 * have at all.
 */
async function removeCommand(
  dir: string,
  io: Io,
  targetId: string | undefined,
  flags: Record<string, string | boolean | undefined>,
  now: () => number,
): Promise<number> {
  if (targetId === undefined || targetId.length === 0) {
    io.err("remove needs a memory id");
    return EXIT.usage;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }

  const crossScopeContent = flags["strike-by-content-across-scopes"] === true;

  // THE PLAN, made read-only and with no lock held (scar E5).
  const planning = Store.open({ dir, observer: true });
  let plan;
  try {
    plan = planRemoval(planning, targetId, { crossScopeContent });
  } finally {
    planning.close();
  }
  if (!plan.valid) {
    io.err(`refused: ${plan.reason} (${targetId})`);
    return EXIT.refused;
  }

  io.out(`Removal plan for ${targetId}:`);
  for (const surface of plan.surfaces) io.out(`  chase ${surface.surface}: ${surface.count}`);
  // The seventh surface, printed in ALL THREE states and ABOVE the closing
  // "Nothing has changed" line — a disclosure under the last line of a dry run
  // is a disclosure a reader has already stopped reading (cold-stranger round 3,
  // C3). `not applicable` is stated too: the silence is what made the residue
  // undiscoverable outside the README (LAUNCH-STATUS §I2). `held` is a CHASE
  // now, not a confession; only `unknown` still says NOT chased.
  io.out(
    plan.spans.state === "held"
      ? `  chased — ${plan.spans.line}`
      : plan.spans.state === "unknown"
        ? `  NOT chased — ${plan.spans.line}`
        : `  ${plan.spans.line}`,
  );
  for (const name of plan.unchasable) {
    if (name === plan.spans.line) continue; // said once, on its own line above
    io.out(`  CANNOT chase ${name} — the id goes dark via the deny-list instead`);
  }
  // LEFT ON PURPOSE, which is neither a chase nor a failure (review F6). The
  // spans sentence above already carries the count; this line is what the
  // completion report will repeat, so the two read the same.
  for (const name of plan.leftAlone) io.out(`  LEFT on purpose — ${name}`);
  // IDS ONLY (§16 G15): printing the matching text would re-leak exactly the
  // thing being removed.
  io.out(`  other memories whose text overlaps (ids only): ${plan.contamination.length}`);
  for (const id of plan.contamination) io.out(`    ${id}`);

  if (flags["confirm"] !== true) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --confirm to remove.");
    return EXIT.ok;
  }
  if (io.prompt === undefined) {
    io.err("refused: removal requires an interactive confirmation and this console has no prompt.");
    return EXIT.refused;
  }
  const answer = (await io.prompt(`Type the id to remove it permanently [${targetId}]: `)).trim();
  if (answer !== targetId) {
    io.err("refused: the confirmation did not match. Nothing has changed.");
    return EXIT.refused;
  }

  // RELOAD AND RE-PLAN under the writing store: the human took time, and the
  // store may not be the store the plan was made against.
  const store = Store.open({ dir });
  try {
    const replan = planRemoval(store, targetId, { crossScopeContent });
    if (!replan.valid) {
      io.err(`refused after re-plan: ${replan.reason}. Nothing has changed.`);
      return EXIT.refused;
    }
    const outcome = ownerRemoval(
      store,
      {
        targetId,
        actor: "owner",
        reason: typeof flags["reason"] === "string" ? flags["reason"] : "owner request",
        requestedAt: now(),
      },
      { crossScopeContent, onEvent: (name, data) => io.out(`  ${name} ${JSON.stringify(data)}`) },
    );
    io.out("");
    io.out(`Removed ${targetId}.`);
    io.out(`  chased: ${outcome.chased.join(", ") || "nothing"}`);
    io.out(`  unchased (dark via the deny-list, never silently dropped): ${outcome.unchased.join(", ") || "nothing"}`);
    io.out(`  left on purpose (not a failure — this removal was never entitled to it): ${outcome.leftAlone.join(", ") || "nothing"}`);
    io.out(`  removal record: ${outcome.notes.length} stages appended`);
    return EXIT.ok;
  } catch (err) {
    io.err(`removal failed: ${String((err as Error).message ?? err)}`);
    return EXIT.failed;
  } finally {
    store.close();
  }
}

// ── backfill-claims ─────────────────────────────────────────────────────────

/**
 * The one-shot repair for memories minted BEFORE the authored default existed.
 *
 * Measured 2026-09-04 on the parallel-run store: 48 authored memories, every
 * one of them with relevance/emotional/predictive = 0, most with no claim — so
 * `sal(m)` was 0 and the lived channel's own deposits were the weakest things in
 * the store. New mints get the floor at the seam (`mint.ts`); these rows never
 * crossed a seam that had one.
 *
 * Three properties, all of them the console's usual ones rather than new
 * inventions: it is a DRY RUN unless `--apply`; it refuses under observer via
 * `OWNER_OPS` (an instrument does not repair the store it is reading); and it
 * touches only rows whose `source` is `authored` and whose `claimed` is NULL —
 * an explicit claim, however low, is testimony and is never overwritten.
 * Archived, superseded and removed rows are excluded: the repair is for what
 * the store is still holding.
 *
 * Each write is two durable acts plus a record: the claim onto box 2
 * (`updatePhysics`), the `claimedDefault` flag onto canonical prose (`revise`,
 * which keeps the prior version — constitution 7), and a `salience.defaulted`
 * row in the event log so the daily can count this run.
 *
 * `revise` re-hashes the whole serialized document, so every backfilled row's
 * `content_hash` moves when the flag lands. That is inert by design and not an
 * oversight: `content_hash` addresses the document (id and frontmatter
 * included), which makes it a CHANGE detector, and `sleep/dedup.ts` deliberately
 * hashes the BODY instead — its header says so in as many words. The
 * content-idempotency ledger in `remember/` hashes normalized content and never
 * reads this column at all.
 */
function backfillClaimsCommand(dir: string, io: Io, apply: boolean): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const floor = TUNABLES.AUTHORED_DEFAULT_CLAIM;

  // The plan is made read-only, as every plan here is (scar E5).
  const planning = Store.open({ dir, observer: true });
  let targets: { id: string; kind: string; dims: string }[];
  try {
    targets = backfillTargets(planning);
  } finally {
    planning.close();
  }

  io.out(`Authored memories with no claimed salience: ${targets.length}`);
  io.out(`Default floor to apply: ${floor} (physics TUNABLES.AUTHORED_DEFAULT_CLAIM)`);
  // IDS AND NUMBERS ONLY — a repair report is not a place to print bodies.
  for (const t of targets) io.out(`  ${t.id}  ${t.kind}  dims ${t.dims}`);

  if (!apply) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --apply to write the floor.");
    return EXIT.ok;
  }
  if (targets.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return EXIT.ok;
  }

  const store = Store.open({ dir });
  let written = 0;
  const failures: string[] = [];
  try {
    // RE-CHECK under the writing store: the plan was made against a store that
    // may have moved, and this loop must not write a floor over a claim that
    // arrived in between.
    for (const target of backfillTargets(store)) {
      try {
        const physics = store.physicsOf(target.id);
        store.updatePhysics(target.id, { salience: { ...physics.salience, claimed: floor } });
        store.revise(
          target.id,
          { meta: { [CLAIMED_DEFAULT_META_KEY]: true }, reason: "salience.default" },
        );
        store.appendEvent({
          name: "salience.defaulted",
          day: store.livedDay(),
          ref: target.id,
          payload: { channel: "authored", floor, backfill: true },
        });
        written += 1;
      } catch (err) {
        failures.push(`${target.id}: ${String((err as Error).message ?? err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Applied the default floor to ${written} memories.`);
  for (const failure of failures) io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}

/** Live, authored, unclaimed — in that order, and nothing else. */
function backfillTargets(store: Store): { id: string; kind: string; dims: string }[] {
  const denied = new Set(store.deniedIds());
  const out: { id: string; kind: string; dims: string }[] = [];
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || denied.has(id)) continue;
    if (row.archived === 1 || row.superseded_by !== null) continue;
    if (row.source !== "authored" || row.claimed !== null) continue;
    out.push({
      id,
      kind: row.kind,
      dims: `rel ${row.relevance} emo ${row.emotional} pred ${row.predictive}`,
    });
  }
  return out;
}

// ── rebrief ─────────────────────────────────────────────────────────────────

/**
 * THE OWNER'S RE-RENDER.
 *
 * The wake bundle is composed once per lived day, at the boundary, and served
 * unchanged to every session until the next one. That is a feature — cold start
 * costs one meta read — right up until the render itself changes: the identity
 * share merged mid-day on 2026-09-04 and could not reach a single session's wake
 * until the following boundary, and an owner who wanted their wake regenerated
 * had nothing to run. This is that lever.
 *
 * Three properties, all of them the console's usual ones:
 *
 *   - It goes through the SAME renderer the sleep step uses
 *     (`core/briefing.ts#selfRenderer`, via `Counterpart.rebrief`) — a console
 *     with a second renderer is a console that can publish a bundle the
 *     boundary would never have composed.
 *   - It refuses under observer via `OWNER_OPS`: republishing is a content
 *     write, and an instrument makes none.
 *   - It advances NO sleep marker and runs no other sleep phase. Decay,
 *     consolidation, dedup and prune stay the boundary's work.
 *
 * The ceiling is the host's, never this file's (scar §2.18): `--budget`, else
 * `injectionBudgetBytes` from the host config beside the store, else a refusal
 * that names both.
 */
function rebriefCommand(
  dir: string,
  io: Io,
  budgetFlag: string | boolean | undefined,
  now: () => number,
  home?: string,
): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const ceiling = home === undefined ? hostCeiling(dir, budgetFlag) : hostCeiling(dir, budgetFlag, home);
  if ("refusal" in ceiling) {
    for (const line of ceiling.refusal.split("\n")) io.err(line);
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir);
  try {
    // The horizon lane asks about a calendar date; the console's own clock is
    // the only one in the room, and tests inject it.
    const at = new Date(now()).toISOString().slice(0, 10);
    const report = counterpart.rebrief({ budgetBytes: ceiling.bytes, at });
    if (!report.rendered) {
      io.err(`refused: the render declined (${report.reason}).`);
      return EXIT.refused;
    }
    io.out(`Re-rendered the wake bundle for ${counterpart.store.dir}.`);
    io.out(`  lived day ${report.day}, horizon asked about ${at}`);
    // THE LINE THAT MAKES THE LOOKUP HONEST. It names the file, always — a
    // ceiling read out of a configuration the user never mentioned is a
    // surprise only while nobody says where it came from.
    io.out(
      ceiling.source === "--budget"
        ? `  budget ${ceiling.bytes} bytes from --budget`
        : `  budget ${ceiling.bytes} bytes from ${ceiling.source}`,
    );
    io.out(
      `  composed under ${report.composeBudget} — the delivery preface reserves ${PREFACE_RESERVE_BYTES}`,
    );
    io.out(`  lanes: ${LANE_ORDER.map((l) => `${l} ${report.counts[l] ?? 0}`).join("  ")}`);
    io.out(`  elements ${report.elements}, bytes ${report.bytes}`);
    io.out(
      report.published
        ? "  published — the next session wakes on this bundle."
        : "  NOT published: the store is in observer stance.",
    );
    io.out("  No sleep marker moved and no other sleep phase ran.");
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

/**
 * WHERE THE CONSOLE LOOKS FOR THE HOST CONFIGURATION. One rule, and the only one.
 *
 * `injectionBudgetBytes` is a host capability, and the console has no host — so
 * a command that needs it (today: `rebrief`) has to read the file the host's own
 * adapter reads. That is a real thing the console does, and the documentation
 * said for a while that it did not; a bolded claim a stranger disproved with the
 * second command past the round trip (cold-stranger review, 2026-09-04, issue 3).
 * So it is stated once, here, and every page repeats this and nothing else:
 *
 *   1. `--budget <bytes>`, when given. Nothing is read at all.
 *   2. `<dir>/../claude-code.json` — BESIDE the store. This is the deployed
 *      layout: `~/.counterparts/claude-code.json` with the store at
 *      `~/.counterparts/store`, so for a default install (1) and (2) are the
 *      same file. For a `--dir` elsewhere it is the config that names THAT store.
 *   3. `~/.counterparts/claude-code.json` — the hooks' own hardcoded path, which
 *      is where `counterparts install` always writes, because `--dir` moves the
 *      store and never the configuration.
 *
 * **Never `<dir>/claude-code.json`.** A file inside the data dir fails the layout
 * totality check (§5 G11) and the store stops opening; the `--help` said that
 * path for a while and it was never true.
 *
 * The caller PRINTS which of these answered, always — a number read out of a
 * file the user did not name is only a surprise while it is silent. `searched`
 * carries the paths so a refusal can name every place that was tried rather
 * than one of them.
 */
export interface CeilingFound {
  readonly bytes: number;
  /** `--budget`, or the absolute path of the file that answered. */
  readonly source: string;
  readonly searched: readonly string[];
}
export interface CeilingMissing {
  readonly refusal: string;
  readonly searched: readonly string[];
}

export function hostCeiling(
  dir: string,
  flag: string | boolean | undefined,
  home = homedir(),
): CeilingFound | CeilingMissing {
  if (typeof flag === "string" && flag.length > 0) {
    const n = Number(flag);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        refusal: `refused: --budget takes a positive whole number of bytes, not '${flag}'.`,
        searched: [],
      };
    }
    return { bytes: n, source: "--budget", searched: [] };
  }
  const beside = join(dir, "..", "claude-code.json");
  const hooksConfig = join(home, ".counterparts", "claude-code.json");
  // De-duplicated, because on a default install these are the same file and a
  // refusal that named it twice would read as two separate misses.
  const searched = beside === hooksConfig ? [beside] : [beside, hooksConfig];
  for (const candidate of searched) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const value = parsed["injectionBudgetBytes"];
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return { bytes: value, source: candidate, searched };
      }
    } catch {
      /* an unreadable host config reports no ceiling — the refusal below says so */
    }
  }
  // Scar §2.18: the ceiling is a host capability. There is no default anywhere
  // in this package and this command does not become the place there is one.
  return {
    refusal: [
      'refused: no injection ceiling. Nothing set "injectionBudgetBytes" in either place',
      "this command looks, so there is no number to compose under, and a briefing never",
      "invents one (scar §2.18). Looked, in order:",
      ...searched.map((p) => `  ${p}${existsSync(p) ? "  (present, no injectionBudgetBytes)" : "  (absent)"}`),
      "Pass --budget <bytes>, or add the key to one of those files.",
    ].join("\n"),
    searched,
  };
}

/** Exported for the caller-universality test: the console composes a brain the
 *  same way every other adapter does, and never re-wires the modules. */
export function openCounterpart(
  dir: string,
  observer = false,
  identity?: { readonly name: string },
): Counterpart {
  // `identity` goes through the SAME door the host adapter uses —
  // `Counterpart.open`'s own option, which calls `self.ensureIdentityCore`. The
  // console does not get a second way to mint an identity core; it gets the
  // one way, with a name from a flag instead of from `claude-code.json`.
  return Counterpart.open({ dir, observer, ...(identity === undefined ? {} : { identity }) });
}
