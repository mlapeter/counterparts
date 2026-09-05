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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
import type { Db, SqlValue } from "../../core/store/db.js";
// Box 3's own door for the vector migration: `openCache` stamps the schema
// version, `vectorFormats` counts the two shapes, `convertVectorBatch` is the
// one transactional step. The conversion arithmetic lives in `store/cache.ts`
// beside the readers it must agree with, never in a second copy here.
import { convertVectorBatch, countNonFinite, openCache, vectorFormats } from "../../core/store/cache.js";
import {
  CACHE_SCHEMA_VERSION,
  LAYOUT,
  Store,
  dataDir,
  decodeVector,
  encodeVector,
  isWithin,
  paths,
  storeExists,
} from "../../core/store/index.js";
import type { VectorFormatCensus } from "../../core/store/index.js";
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
  "migrate-cache",
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
  // Box 3 is rebuildable, and rewriting it is still a WRITE: an instrument does
  // not migrate the store it is reading.
  "migrate-cache",
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
    "                      embedder to recompute, unless --drop-vectors is passed —",
    "                      or --keep-vectors, which re-indexes the text side and",
    "                      leaves every vector where it is.",
    "  migrate-cache       Convert the cache's vectors from JSON text to float32",
    "                      BLOBs, in place, and compact the file. The dry run is",
    "                      read-only; --apply converts, needs the store NAMED",
    "                      (--dir or COUNTERPARTS_DATA_DIR, never the default) and",
    "                      asks unless --yes. --batch <n>.",
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
  remove: ["confirm", "reason"],
  verify: ["rebuild", "drop-vectors", "keep-vectors"],
  "migrate-cache": ["apply", "batch", "yes"],
  "backfill-claims": ["apply"],
  rebrief: ["budget"],
};

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
  "batch",
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
      "keep-vectors": { type: "boolean" },
      batch: { type: "string" },
      yes: { type: "boolean" },
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
        return statusCommand(dir, io);
      case "init":
        return initCommand(dir, io, opts.home, typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined);
      case "note":
        return await noteCommand(dir, io, parsed);
      case "recall":
        return recallCommand(dir, io, parsed);
      case "verify":
        return verifyCommand(dir, io, parsed.flags);
      case "migrate-cache":
        // Whether the STORE WAS NAMED, not just resolved: `--apply` refuses a
        // dir that fell through to the default, which on a real machine is the
        // owner's live memory.
        return await migrateCacheCommand(
          dir,
          io,
          parsed.flags,
          typeof parsed.flags["dir"] === "string" ||
            (env["COUNTERPARTS_DATA_DIR"] ?? "").trim() !== "",
        );
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
function statusCommand(dir: string, io: Io): number {
  if (!storeExists(dir)) {
    // An instrument that MINTS a data dir by looking at one is a wart — and
    // since 2026-08-26 the store itself refuses it (INTERFACE-GAPS §7 closed:
    // observer + absent store is STORE_UNINITIALIZED at open). This guard
    // stays for the friendlier sentence.
    io.out(`No store at ${dir}. Run 'counterparts init' to create one.`);
    return EXIT.ok;
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
    /**
     * Which SHAPE the vectors are in — float32 BLOB (v4) or JSON text (v3).
     * A census that counted them without saying which would not answer the one
     * question `migrate-cache` exists for, and a MIXED cache (an interrupted
     * migration) has to be visible: readers tolerate it, but it is not done.
     */
    readonly vectors: VectorFormatCensus;
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
        vectors: vectorFormats(handle),
      },
    };
  } catch (err) {
    return { path, present: true, counts: null, why: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

/**
 * One line naming the shape box 3's vectors are in, and — when it is mixed —
 * what to run. An empty table is neither format and says so.
 */
function vectorFormatLine(v: VectorFormatCensus): string {
  if (v.total === 0) return "none held";
  const parts: string[] = [];
  if (v.float32 > 0) parts.push(`${v.float32} float32 BLOB (v4)`);
  if (v.jsonText > 0) parts.push(`${v.jsonText} JSON text (v3)`);
  if (v.other > 0) parts.push(`${v.other} unreadable`);
  const tail =
    v.jsonText > 0
      ? " — 'counterparts migrate-cache' converts them in place (dry run by default)"
      : "";
  return `${parts.join(", ")}${tail}`;
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
 * out loud that losing them is the intent.
 *
 * **2026-09-05: the third door.** Refuse-unless-flag was the adapter-level
 * answer while preserving the vectors needed a core change; that change now
 * exists (`Store.rebuildCache({ keepVectors })`), so `--keep-vectors` rebuilds
 * the text index and leaves `embeddings` in place. The refusals stay exactly as
 * they were and now name it, because the safe option being available is not a
 * reason to make the destructive one quieter.
 */
function verifyCommand(dir: string, io: Io, flags: Record<string, string | boolean | undefined>): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  if (flags["rebuild"] !== true) return verifyCensus(dir, io);
  // Both at once is a command line that contradicts itself, and guessing which
  // half the owner meant is the one thing a guard like this may not do.
  if (flags["drop-vectors"] === true && flags["keep-vectors"] === true) {
    io.err("refused: --drop-vectors and --keep-vectors say opposite things about the same rows.");
    return EXIT.refused;
  }
  return verifyRebuild(dir, io, flags["drop-vectors"] === true, flags["keep-vectors"] === true);
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
  io.out(`  vector format: ${vectorFormatLine(cache.counts.vectors)}`);
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
function verifyRebuild(dir: string, io: Io, dropVectors: boolean, keepVectors: boolean): number {
  const cache = censusCache(dir);
  // `--keep-vectors` re-indexes the text side and leaves `embeddings` alone
  // (`Store.rebuildCache({ keepVectors })`, the core follow-up this console
  // filed in NOTES on 2026-09-04 and could not do adapter-side). Nothing is at
  // risk, so neither guard below applies — and an unreadable census is no
  // longer a reason to refuse, because the count it could not take was only
  // ever the count of what would be LOST.
  if (keepVectors) {
    const store = Store.open({ dir });
    try {
      const canonical = store.list().length;
      const report = store.rebuildCache({ keepVectors: true });
      io.out(`Canonical rows: ${canonical}`);
      io.out(`Re-indexed: ${report.indexed}`);
      io.out(`Skipped as removed (deny-list): ${report.skippedDenied}`);
      io.out(`Vectors kept: ${report.keptVectors}   dropped as no longer canonical: ${report.droppedVectors}`);
      io.out(`Not recomputed: ${report.unrecomputed}`);
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
  // FAIL CLOSED. A count that could not be taken is not a count of zero: box 3
  // is the file the Stop-hook worker writes vectors into, so "database is
  // locked" after the busy timeout is an ordinary outcome here — and a guard
  // whose failure mode is "could not count the vectors, so dropped them" is not
  // a guard. An ABSENT cache is different and stays fine: there is nothing to lose.
  if (cache.present && cache.counts === null && !dropVectors) {
    io.err(
      `Refusing: box 3 exists but could not be read (${cache.why ?? "no reason given"}), so this console cannot tell how many embeddings --rebuild would drop — retry, pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors to proceed anyway.`,
    );
    return EXIT.refused;
  }
  const held = cache.counts?.embeddings ?? 0;
  const vectors = `${held} ${held === 1 ? "embedding" : "embeddings"}`;
  if (held > 0 && !dropVectors) {
    io.err(
      `Refusing: --rebuild drops box 3 and this console has no embedder, so the ${vectors} it holds would be gone and each one costs a paid network call to recompute — pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors if losing them is what you mean.`,
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

// ── migrate-cache ───────────────────────────────────────────────────────────

/** Bytes, in the units an owner reads. Box 3 is measured in hundreds of MiB. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/**
 * How many bytes a `VACUUM` would give back, MEASURED — `VACUUM INTO` a
 * throwaway copy outside the data dir, stat it, delete it.
 *
 * The obvious cheap probe is wrong here and was tried: `PRAGMA freelist_count`
 * reads **0** on a cache whose rows were rewritten from ~12.7 KiB of text to
 * 4 KiB of blob, because the pages are not free, they are FRAGMENTED — the win
 * is defragmentation. On a store measured mid-review, `freelist_count = 0` and
 * a real `VACUUM` still took 3,756,032 bytes to 1,544,192 (59%). A probe that
 * reads zero where the answer is 59% is worse than no probe.
 *
 * `VACUUM INTO` is read-only on the source (it is what `backup` already uses),
 * and the copy lands in the OS temp dir, never beside the store — box 3's
 * directory is classified and a stray file there is a store that will not open
 * (§5 G11). Returns null when the probe cannot run, which is not an error: it
 * means this run has no number, and it says so rather than guessing one.
 */
function reclaimableBytes(db: Db, path: string): number | null {
  const probeDir = mkdtempSync(join(tmpdir(), "counterparts-vacuum-probe-"));
  const probe = join(probeDir, "compacted.sqlite");
  try {
    db.run("VACUUM INTO ?", probe);
    return Math.max(0, statSync(path).size - statSync(probe).size);
  } catch {
    return null;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/** Worth compacting: more than a MiB, and more than a twentieth of the file. */
function worthCompacting(reclaimable: number | null, size: number): boolean {
  return reclaimable !== null && reclaimable > 1024 * 1024 && reclaimable > size / 20;
}

/**
 * `migrate-cache` — convert box 3's vectors from JSON text to float32 BLOBs,
 * IN PLACE, and compact the file afterwards.
 *
 * **Why this is a command and not `verify --rebuild`.** A rebuild recomputes;
 * the thing that would have to recompute here is an EMBEDDER, and this console
 * wires none — so `--rebuild` as the migration means "delete ~13,700 vectors
 * that cost a paid network call each and hope something puts them back"
 * (`cli/NOTES.md`, 2026-09-04). The information needed to write the new shape
 * is already in the old one. Converting is a read and a write of the same
 * numbers, so the migration is a conversion.
 *
 * Six properties, each one a rule this console already has:
 *
 *   1. **The dry run is READ-ONLY, not merely honest.** It opens box 3 with
 *      `openDb`, never `openCache`: the migrating constructor stamps
 *      `cache_meta.schemaVersion`, and on the v3 store this will actually be run
 *      against that one row changed the file's hash under a line that said
 *      nothing had changed. Every question the dry run asks is a `SELECT`.
 *   2. **`--apply` names its store out loud.** It refuses a data dir that came
 *      from the DEFAULT — on a real machine that default is the owner's live
 *      memory — so the destination is either `--dir` or `COUNTERPARTS_DATA_DIR`,
 *      typed on purpose. Then it asks, `remove`-style, unless `--yes`.
 *   3. **Transactional per batch, and therefore resumable.** One transaction per
 *      `--batch` rows, not one over the whole table: box 3 is the file the
 *      Stop-hook worker writes into, `BUSY_TIMEOUT_MS` is five seconds, and a
 *      single transaction over 13.9K rows would hold the write lock for the
 *      whole rewrite. An interrupted run leaves a MIXED cache, which every
 *      reader already tolerates (`cache.ts#decodeVector`), and re-running
 *      finishes it.
 *   4. **A row that will not parse costs one row.** It is skipped, counted and
 *      NAMED, and the walk continues past it — the first version rolled its
 *      batch back and then re-selected the same row forever.
 *   5. **Idempotent, and it refuses rather than pretending.** The batch selects
 *      on `typeof(vec) = 'text'`, so a converted row is never touched twice, and
 *      `--apply` with nothing to convert AND nothing to reclaim exits REFUSED
 *      with the counts, because "I did nothing" and "I converted your store"
 *      must not look the same on a terminal.
 *   6. **Compaction is reachable on its own.** The rewrite frees space that only
 *      a `VACUUM` returns, and `VACUUM` is exactly the step most likely to fail
 *      — it takes an exclusive lock, and the worker holds box 3. So a store that
 *      is CONVERTED BUT NOT COMPACTED is a real state with a door: the dry run
 *      reports the reclaimable bytes and `--apply` compacts them. Without that
 *      door, one lost lock stranded 177 MiB behind an "already converted"
 *      refusal — the whole debt, unreachable through the tool that exists to pay
 *      it.
 *
 * It never opens a `Store`: box 3 only, gated on the file EXISTING so the
 * command cannot mint the box it migrates.
 */
async function migrateCacheCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  dirWasNamed: boolean,
): Promise<number> {
  const apply = flags["apply"] === true;
  // FIRST, before this command looks at a single path. `resolveDir` falls
  // through to `dataDir()`, which on the owner's machine is his live memory,
  // and this command's own PR says the merge is reversible and the `--apply`
  // is not. A guard that reads the default directory before refusing it has
  // already been pointed at the store it meant to refuse.
  if (apply && !dirWasNamed) {
    io.err(
      `refused: 'migrate-cache --apply' rewrites every vector in box 3 and will not run against the default data dir (${dir}). Name the store: --dir <path>, or COUNTERPARTS_DATA_DIR.`,
    );
    return EXIT.refused;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const path = paths.cache(dir);
  if (!existsSync(path)) {
    io.err(
      `no cache at ${path} — box 3 has never been built here, so there are no vectors to convert.`,
    );
    return EXIT.failed;
  }
  const batch = (() => {
    const raw = flags["batch"];
    if (typeof raw !== "string") return 500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 500;
  })();

  const sizeBefore = statSync(path).size;
  // READ-ONLY for the report: `openDb` opens what is there and stamps nothing.
  // `openCache` — which brings an out-of-date box 3 up to the current schema —
  // is reserved for `--apply`, below, where a write is the point.
  const db = openDb(path);
  let census: VectorFormatCensus;
  let stamped: string | null;
  try {
    census = vectorFormats(db);
    stamped =
      db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value ??
      null;

    io.out(`Store: ${dir}`);
    io.out(
      `Cache: ${path}  (${humanBytes(sizeBefore)}, schema ${stamped === null ? "unstamped" : `v${stamped}`}` +
        `${stamped === String(CACHE_SCHEMA_VERSION) ? "" : ` — v${CACHE_SCHEMA_VERSION} once anything opens it for writing`})`,
    );
    io.out(
      `Vectors: ${census.total}   float32 BLOB: ${census.float32}   JSON text: ${census.jsonText}` +
        (census.other > 0 ? `   unreadable: ${census.other}` : ""),
    );
    io.out(
      `  bytes in vec: JSON text ${humanBytes(census.jsonTextBytes)}, ` +
        `float32 ${humanBytes(census.float32Bytes)}`,
    );

    if (census.jsonText === 0) {
      // Converted. The remaining question is whether the file was ever
      // compacted — the step most likely to have failed, and the one the
      // "already converted" refusal used to hide.
      const reclaimable = reclaimableBytes(db, path);
      const worth = worthCompacting(reclaimable, sizeBefore);
      io.out("");
      if (reclaimable === null) {
        io.out("Converted. Could not measure whether the file is compacted (the probe would not run).");
      } else if (worth) {
        io.out(
          `Converted, NOT yet compacted: ${humanBytes(reclaimable)} reclaimable of ${humanBytes(sizeBefore)}.`,
        );
      } else {
        io.out(`Converted and compacted. Nothing to do.`);
      }
      if (!apply) {
        if (worth) io.out("Re-run with --apply to compact (it converts nothing — there is nothing left to convert).");
        return EXIT.ok;
      }
      if (!worth) {
        io.err(
          `Refusing: box 3 holds no JSON-text vectors and has nothing worth reclaiming — it is already float32. Nothing was written.`,
        );
        return EXIT.refused;
      }
      const ok = await confirmMigrate(io, flags, dir, `compact box 3 (${humanBytes(reclaimable ?? 0)} reclaimable)`);
      if (!ok) return EXIT.refused;
      const writable = openCache(path);
      try {
        writable.exec("VACUUM");
      } finally {
        writable.close();
      }
      const sizeAfter = statSync(path).size;
      io.out(
        `Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` +
          `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`,
      );
      return EXIT.ok;
    }

    // The projection is arithmetic on the rows themselves, not an average: a
    // store whose vectors are not all the same width would make a mean lie.
    const projected =
      db.get<{ b: number | null }>(
        "SELECT SUM(dim) * 4 AS b FROM embeddings WHERE typeof(vec) = 'text'",
      )?.b ?? 0;
    io.out(
      `  after conversion those ${census.jsonText} rows hold ${humanBytes(projected)} ` +
        `(${census.jsonTextBytes > 0 ? (census.jsonTextBytes / Math.max(projected, 1)).toFixed(1) : "?"}× smaller)`,
    );

    // ONE sample row, decoded both ways. Vectors are not prose, so printing a
    // few of a memory's coordinates discloses nothing a census does not.
    const sample = db.get<{ memory_id: string; dim: number; vec: SqlValue }>(
      "SELECT memory_id, dim, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT 1",
    );
    if (sample !== undefined) {
      try {
        const asIs = Array.from(decodeVector(sample.vec));
        const converted = Array.from(decodeVector(encodeVector(asIs)));
        const drift = asIs.reduce((m, v, i) => Math.max(m, Math.abs(v - (converted[i] ?? 0))), 0);
        const show = (v: readonly number[]): string =>
          v.slice(0, 4).map((x) => x.toPrecision(9)).join(", ");
        io.out("");
        io.out(
          `Sample: ${sample.memory_id}  dim ${sample.dim}  (${String(sample.vec).length} chars of JSON)`,
        );
        io.out(`  now:   [${show(asIs)}, …]`);
        io.out(`  after: [${show(converted)}, …]`);
        io.out(`  largest coordinate change in this row: ${drift.toExponential(3)}`);
        const nonFinite = countNonFinite(asIs);
        if (nonFinite > 0) io.out(`  ${nonFinite} non-finite coordinates in this row become 0`);
      } catch {
        io.out("");
        io.out(`Sample: ${sample.memory_id} — its vec does not parse; the migration will skip and name it.`);
      }
    }
  } finally {
    db.close();
  }

  if (!apply) {
    io.out("");
    io.out("Dry run. Nothing was changed — every question above was a read.");
    io.out(`Take a 'counterparts backup --out <dir>' first; then re-run with --apply to convert (batches of ${batch}).`);
    return EXIT.ok;
  }

  const ok = await confirmMigrate(io, flags, dir, `convert ${census.jsonText} vectors in box 3`);
  if (!ok) return EXIT.refused;

  const writable = openCache(path);
  try {
    let converted = 0;
    let coerced = 0;
    let batches = 0;
    const skipped: string[] = [];
    let after: string | undefined;
    for (;;) {
      const report = convertVectorBatch(writable, batch, after);
      if (report.examined === 0) break;
      converted += report.converted;
      coerced += report.coerced;
      skipped.push(...report.skipped);
      batches += 1;
      // Walk PAST what was examined, so a skipped row is not re-selected
      // forever. `lastId` is non-null whenever `examined > 0`.
      after = report.lastId ?? undefined;
      if (after === undefined) break;
    }
    io.out("");
    io.out(`Converted ${converted} vectors in ${batches} ${batches === 1 ? "batch" : "batches"}.`);
    if (coerced > 0) io.out(`Coerced ${coerced} non-finite coordinates to 0 (a NaN is not a coordinate).`);
    for (const id of skipped) io.out(`  SKIPPED, left exactly as it was: ${id} — its vec does not parse.`);
    const after2 = vectorFormats(writable);
    io.out(`Vectors now: float32 BLOB ${after2.float32}, JSON text ${after2.jsonText}`);
    // Free pages are not free space until the file is rewritten, and the whole
    // debt this pays is file size. VACUUM runs outside any transaction, and it
    // is the step that fails first when another process holds box 3 — so its
    // failure is REPORTED with the way back in, never swallowed.
    let vacuumed = true;
    try {
      writable.exec("VACUUM");
    } catch (err) {
      vacuumed = false;
      io.err(
        `The conversion is committed; the VACUUM that reclaims the space did not run (${String((err as Error).message ?? err)}). ` +
          `Re-run 'counterparts migrate-cache --dir ${dir} --apply' with no session open to compact it.`,
      );
    }
    const sizeAfter = statSync(path).size;
    if (vacuumed) {
      io.out(
        `Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` +
          `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`,
      );
    }
    if (skipped.length > 0) return EXIT.failed;
    return after2.jsonText === 0 && vacuumed ? EXIT.ok : EXIT.failed;
  } finally {
    writable.close();
  }
}

/**
 * The one human in the loop. `--yes` is the non-interactive door (a script, the
 * install loop); without it and without a prompt, this refuses rather than
 * proceeding unconfirmed — the console's rule 2, and the same shape `remove`
 * uses, one notch softer because this destroys no memory.
 */
async function confirmMigrate(
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  dir: string,
  what: string,
): Promise<boolean> {
  if (flags["yes"] === true) return true;
  io.out("");
  io.out(`About to ${what} at ${dir}.`);
  if (io.prompt === undefined) {
    io.err("refused: this is not an interactive console — pass --yes if that is what you mean.");
    return false;
  }
  const answer = (await io.prompt("Type 'yes' to proceed: ")).trim().toLowerCase();
  if (answer !== "yes") {
    io.err("refused: not confirmed. Nothing has changed.");
    return false;
  }
  return true;
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

  // THE PLAN, made read-only and with no lock held (scar E5).
  const planning = Store.open({ dir, observer: true });
  let plan;
  try {
    plan = planRemoval(planning, targetId);
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
  // undiscoverable outside the README (LAUNCH-STATUS §I2).
  io.out(
    plan.spans.state === "not-applicable"
      ? `  ${plan.spans.line}`
      : `  NOT chased — ${plan.spans.line}`,
  );
  for (const name of plan.unchasable) {
    if (name === plan.spans.line) continue; // said once, on its own line above
    io.out(`  CANNOT chase ${name} — the id goes dark via the deny-list instead`);
  }
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
    const replan = planRemoval(store, targetId);
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
      { onEvent: (name, data) => io.out(`  ${name} ${JSON.stringify(data)}`) },
    );
    io.out("");
    io.out(`Removed ${targetId}.`);
    io.out(`  chased: ${outcome.chased.join(", ") || "nothing"}`);
    io.out(`  unchased (dark via the deny-list, never silently dropped): ${outcome.unchased.join(", ") || "nothing"}`);
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
