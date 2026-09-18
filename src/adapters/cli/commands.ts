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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { Counterpart, RECALL_CREDIT_EVENT, RECALL_DECISION_EVENT } from "../../core/counterpart.js";
import { PROBE_ROW_CEILING, probeOQ4, renderProbe } from "../../core/recall/probe.js";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
// `band` is imported rather than mirrored: the dashboard computes the live
// band with this exact function, and two implementations of "which band is this
// row in today" is how the two surfaces disagreed in the first place.
import { TUNABLES, band } from "../../core/physics/index.js";
import { LANE_ORDER, PREFACE_RESERVE_BYTES } from "../../core/self/index.js";
// The ONE predicate for "this row is the journal, not a memory" — the same one
// the sleep phases and the dashboard's census use. A second copy of that test
// living here is how the console drifted away from them in the first place.
import { TUNABLES as SLEEP_TUNABLES, isJournal } from "../../core/sleep/index.js";
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
  DATA_DIR_ENV,
  EMBED_FAILED_PREFIX,
  ID_PREFIX,
  LAYOUT,
  REQUIRE_EXPLICIT_DIR_ENV,
  SCHEMA_VERSION,
  Store,
  StoreError,
  dataDir,
  dateOf,
  decodeVector,
  describeGuardRefusal,
  encodeVector,
  explicitDirSetting,
  isWithin,
  paths,
  storeExists,
} from "../../core/store/index.js";
import type { EventLogCensus, PathCensus, VectorFormatCensus } from "../../core/store/index.js";
// The owner-op seam's REPAIR half — the one door that un-archives, and only for
// the merge's reason. Imported HERE for the same reason `chaseRemoved` is:
// this is the directory the caller-universality test allows to reach that file.
import { MERGED_ARCHIVE_REASON, unarchiveMerged } from "../../core/store/owner-op-seam.js";
// The WALKING read, imported for the same reason and pinned by the same test:
// it skips the archived-read telemetry AND the deny-list, so it is not a `Store`
// method (`store/walk-seam.ts`). The repair plan is a look at the address.
import { readProseWalking } from "../../core/store/walk-seam.js";
import type { Band, Kind } from "../../core/types.js";
// The MCP adapter's deliberate-recall dispatcher, imported rather than
// re-implemented: a console with its own question path would be a second set of
// rules about what recall means. `mcp/deliberate.ts` imports nothing from here,
// so the direction stays one-way.
import { deliberateRecall } from "../mcp/deliberate.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import {
  CONFIG_ENV,
  CONFIG_FLAG,
  defaultConfigPath,
  implicitConfigRefusal,
  resolveConfigPath,
} from "../config-path.js";
import type { ConfigChoice, ConfigSource } from "../config-path.js";
// The scope registry — host configuration, beside the host configuration. The
// console is the surface that WRITES it; the hooks and the MCP server only read.
import {
  canonicalScopePath,
  lookupScope,
  ownEntry,
  readScopes,
  resumeTarget,
  scopesPath,
  setScope,
  stanceOfMode,
  writeScopes,
} from "../scopes.js";
import type { ScopeMode, ScopeRegistry } from "../scopes.js";
import { OBSERVER_ENV, observerFromEnv, unreadableStanceLine } from "../stance-env.js";
// The what-fired reading, shared with `doctor` and the dashboard's health panel
// so the three surfaces cannot disagree about what "silent" means.
import { STATE_MEANING, STATE_ORDER, firedReport } from "../fired.js";
import type { FiredReport } from "../fired.js";
// THE HOST ADAPTER'S OWN READINGS, imported rather than re-derived — the same
// direction `install.ts` already takes (`../claude-code/config.js`). `doctor`
// and `credentials` are the console's face on the file and the store that
// adapter owns, and a console with its own idea of "which names are credentials"
// or "what counts as red" is exactly the drift I32 ran inside of.
import { CREDENTIAL_NAMES, loadCredentials } from "../claude-code/credentials.js";
import { SPAWN_REFUSAL_PREFIX } from "../claude-code/hooks.js";
import { loadConfig } from "../claude-code/config.js";
import type { AdapterConfig } from "../claude-code/config.js";
import { anyRed, doctorFindings, readCheckout, reportJson, reportLines } from "../claude-code/doctor.js";
import type { CheckoutReading } from "../claude-code/doctor.js";
import { exportStore } from "./export.js";
import {
  BIN,
  CREDENTIALS_FILE,
  configObject,
  credentialsHeld,
  credentialsTemplate,
  hookCommand,
  installLayout,
  throwawayDefaultRefusal,
  layoutRefusal,
  mcpCommand,
  settingsBlock,
  writeOnce,
} from "./install.js";
import { ownerRemoval, planRemoval } from "./removal.js";
import { repairDates } from "./repair-dates.js";
import type { Confidence } from "./repair-dates.js";
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
  "repair-dates",
  "repair-merged-beliefs",
  "rebrief",
  "probe-oq4",
  // Constitution 11's last sentence as a command: which mechanisms fired this
  // week, which have gone quiet, and which record nothing at all. Read-only.
  "fired",
  // I32's two: the reading that says whether the background half is alive, and
  // the one-command repair for the file whose emptiness stopped it.
  "doctor",
  "credentials",
  "scope",
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
  "repair-dates",
  // A repair is a write, and `--dry-run` does not change that: an instrument
  // that has stood down refuses the COMMAND, not just the write, so the owner
  // never gets a plan from a console that could not have carried it out.
  "repair-merged-beliefs",
  "rebrief",
  // `credentials` WRITES a key into the file every entry point reads, and an
  // instrument does not hand the host it is measuring a credential. `doctor`
  // stays off this list beside `status` and `recall`: it is a read.
  //
  // The whole command stands down, `credentials list` included — the stance
  // gate is per command, and `list` paying for `set`'s rule is the cheap
  // direction: the names are in the file, and `doctor` prints them anyway.
  "credentials",
  // `scope` is NOT here, and the omission is the ruling: it writes the HOST's
  // configuration, never a store, so the observer rule that governs it is its
  // own. An instrument may READ the registry — that is how a stood-down session
  // says why it stood down — and every WRITE through it refuses in the same
  // sentence an owner op would. The refusal therefore lives inside the command,
  // beside the write it guards, rather than on this list, which refuses a
  // command whole.
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
  /**
   * STANDARD INPUT, as a seam — `credentials set` is the one command whose
   * argument must never be argv, so it reads the value from here.
   *
   * `isTty` is the host telling us whether a human is at the keyboard: with no
   * pipe the command REFUSES and names the two ways in, rather than hanging on
   * a terminal the owner will have to Ctrl-C. Injected so a test can prove the
   * whole path — including "the value never appears in the output" — without a
   * subprocess.
   */
  stdin?: { isTty: boolean; read: () => Promise<string> };
  /**
   * WHICH CHECKOUT IS RUNNING, for `doctor`. Real runs never pass it — the
   * reading derives itself from the running code's own path, which is the whole
   * point of the finding. The TESTS always do, because the suite runs inside a
   * git checkout that is by definition on a branch and dirty while somebody is
   * working in it, and a test whose verdict depended on that would pass and fail
   * with the developer's `git status`.
   */
  checkout?: CheckoutReading;
}

export function usage(): string {
  return [
    "counterparts — the owner's console for a Counterparts memory store.",
    "",
    "  status              What is held, what left, what was removed. Read-only.",
    "  install             Cold start: create the store, write claude-code.json and a",
    "                      0600 credentials.env under ~/.counterparts/ (the path every",
    "                      entry point reads by default), and PRINT the host's hooks",
    "                      block and MCP line. Never edits the host. --dir moves the",
    "                      STORE only; --config <abs path> moves the CONFIG, the",
    "                      credentials beside it and the default store beneath it, and",
    "                      the printed lines then carry it.",
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
    "                      --prune-index takes archived and superseded rows out of",
    "                      the text index and keeps the embeddings.",
    "                      --retry-skipped puts the ids the backfill gave up on back",
    "                      in the rotation, and changes nothing else.",
    "                      --rebuild, --prune-index, --retry-skipped and --drop-vectors",
    "                      are the writing half, and each needs the store NAMED by --dir.",
    "  migrate-cache       Convert the cache's vectors from JSON text to float32",
    "                      BLOBs, in place, and compact the file. The dry run is",
    "                      read-only; --apply converts, needs the store NAMED by",
    "                      --dir (never the default, and never resolved from",
    "                      COUNTERPARTS_DATA_DIR) and asks unless --yes. --batch <n>.",
    "  backfill-claims     Give unclaimed AUTHORED memories the default claimed",
    "                      floor. Dry run unless --apply, which needs the store",
    "                      NAMED by --dir.",
    "  repair-dates        Propose true `learned` dates for MIGRATED memories that",
    "                      carry the import day, read off engram-era ids (millisecond",
    "                      timestamps), v1 date fields, session references and source",
    "                      paths. Prints counts by confidence and a sample of 20.",
    "                      Dry run unless --apply. --confidence high|medium|low sets",
    "                      the floor for what --apply writes (default high);",
    "                      --import-day <date> overrides the recorded/measured one;",
    "                      --sample <n> changes the sample size. --apply needs the",
    "                      store NAMED by --dir, never resolved for it: this is the",
    "                      one owner op that rewrites thousands of canonical documents.",
    "  repair-merged-beliefs",
    "                      Find beliefs and current-state rows the nightly dedup",
    "                      pass archived as duplicates of an ordinary memory, and",
    "                      put them back. Dry run unless --apply, which needs the",
    "                      store NAMED by --dir.",
    "  doctor              Is the background half alive? Read-only. The config, the",
    "                      credentials BY NAME, the two clocks, the newest sweep,",
    "                      sleep, backfill and credit rows, the spawn refusals and",
    "                      the vector coverage — worst first, each with the one line",
    "                      that fixes it. Exit 1 if anything is red. --json.",
    "  credentials set <NAME>",
    "                      Put one key in the credentials file the config names,",
    "                      0600, without it ever touching your shell history: the",
    "                      value comes from stdin or from --from-env <VAR>, never",
    "                      from the command line, and is never printed back.",
    "                      'credentials list' says which names the file holds.",
    "  rebrief             Re-render and republish the wake bundle NOW, through the",
    "                      boundary's own renderer. Advances no sleep marker and runs",
    "                      no other sleep phase. Needs an injection ceiling, and says",
    "                      which of these gave it one: --budget <bytes>, else the",
    "                      config named by --config / $COUNTERPARTS_CONFIG, else",
    "                      <dir>/../claude-code.json (beside the store), else",
    "                      ~/.counterparts/claude-code.json (where the hooks read).",
    "                      Never a config INSIDE the data dir — that store stops",
    "                      opening (§5 G11).",
    "  probe-oq4           The OQ4 probe (recall CONTRACT §7): per calendar date, how",
    "                      many footnotes were delivered and how many of those the",
    "                      assistant later expanded by id, from recall.decision and",
    "                      recall.credit rows. Read-only; the footnote header is the",
    "                      one string the probe varies (recall/render.ts).",
    "  fired               Which mechanisms have actually fired, and which have not.",
    "                      One line each, SILENT FIRST: when it last fired, how many",
    "                      times in the last 7 days, what it turned away, and — for",
    "                      the ones nothing durable records — which row would fix it.",
    "                      Read-only.",
    "  scope <path|.>      Which directories this memory is for. With a mode flag it",
    "                      writes <config dir>/scopes.json; with none it says what",
    "                      the directory resolves to and which entry decided.",
    "                      --on --observer --off --pause --resume --list",
    '                      --note "<text>" --force. It opens no store and takes no',
    "                      --dir; a subdirectory inherits its nearest ancestor.",
    "",
    "  --dir <path>        The data directory (default: $COUNTERPARTS_DATA_DIR).",
    "  --config <path>     ONE rule, every entry point: --config <absolute path>, else",
    "                      $COUNTERPARTS_CONFIG, else the default above. install and",
    "                      rebrief take it here; counterparts-hook and counterparts-mcp",
    "                      take the same flag, and the server the same variable.",
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
  install: ["budget", "name", "embedder", "force", "config"],
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
  verify: ["rebuild", "drop-vectors", "prune-index", "keep-vectors", "retry-skipped"],
  "migrate-cache": ["apply", "batch", "yes"],
  "backfill-claims": ["apply"],
  "repair-dates": ["apply", "dry-run", "confidence", "import-day", "sample"],
  // `--dry-run` is declared and does NOTHING: dry run is already the default,
  // and the owner's own runbook line spells it out. A flag that names the
  // behavior you are getting must not be refused as unknown.
  "repair-merged-beliefs": ["apply", "dry-run"],
  // `--config` belongs to the two commands that READ or WRITE a host
  // configuration, and to no others. Declaring it everywhere would say the
  // console takes it for `note` or `recall`, which read no config at all — the
  // store comes from `--dir` there and nowhere else.
  rebrief: ["budget", "config"],
  // Read-only, like `status`: rows in, a table out.
  "probe-oq4": [],
  fired: [],
  // `doctor` takes `--config` for the same reason `rebrief` does: it reports on
  // the host configuration, and on a machine with two of them the reading is
  // about whichever one the hooks read.
  doctor: ["config", "json"],
  // `--stdin` and `--from-env` are the only two ways a value gets in. There is
  // deliberately no `--value`: a flag is argv, argv is shell history, and a
  // credential in shell history is a credential on disk in plaintext forever.
  credentials: ["config", "stdin", "from-env"],
  // `--config` because the registry sits BESIDE the configuration, so the flag
  // that says which configuration also says which registry. `--observer` is
  // deliberately NOT declared here: it is a common flag already, and on this
  // one command it means the MODE rather than the console's stance — see
  // `SCOPE_FLAG_HELP`, which is the sentence this command's help page prints
  // for it instead of the shared one.
  scope: ["on", "off", "pause", "resume", "list", "note", "force", "config"],
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
    "Cold start: create the store, write claude-code.json and a 0600 credentials.env under ~/.counterparts/ (the path the hooks read unless --config names another), and PRINT the host's hooks block and MCP line. It never edits the host.",
  init: "Just a store: create a data dir and PRINT the install steps. For a second store or a scratch one.",
  note: "Remember this, deliberately — the same two doors the MCP tool uses.",
  recall: "Ask memory a question. Read-only.",
  export: "A portable copy of the store, encrypted unless you say otherwise.",
  backup: "Snapshot: prose plus the canonical DB via VACUUM INTO. The cache is excluded.",
  remove: "The loud removal. Dry run unless --confirm.",
  verify:
    "Census of the cache against canonical state. Read-only unless --rebuild, --prune-index or --retry-skipped. --rebuild, --prune-index, --retry-skipped and --drop-vectors require --dir.",
  "migrate-cache":
    "Convert the cache's vectors from JSON text to float32 BLOBs, in place, and compact the file. Dry run — read-only — unless --apply. --apply requires --dir.",
  "backfill-claims": "Give unclaimed AUTHORED memories the default claimed floor. Dry run unless --apply. --apply requires --dir.",
  "repair-dates":
    "Give MIGRATED memories carrying the import day their true `learned` date, read off evidence each row already holds — an engram-era id that is a millisecond timestamp, a v1 date field, a session reference, a source path. Counts by confidence and the proposed dates by count. Dry run unless --apply. --apply requires --dir.",
  "repair-merged-beliefs":
    "Put back beliefs and current-state rows the nightly dedup pass archived as duplicates of an ordinary memory. Dry run unless --apply. --apply requires --dir.",
  rebrief: "Re-render and republish the wake bundle NOW, through the boundary's own renderer.",
  "probe-oq4":
    "The OQ4 probe: footnotes delivered vs. later expanded, by calendar date, from recall.decision and recall.credit rows. Read-only.",
  fired:
    "Which mechanisms have actually fired. One line each, silent first: when it last fired, how often in the last 7 days, what it turned away, and — for the ones nothing records — why the store cannot tell. Read-only.",
  doctor:
    "Is the background half alive? The config, the credentials by name, the two clocks, the newest sweep, sleep, backfill and credit rows, the spawn refusals and the vector coverage — worst first, each with the line that fixes it. Read-only; exit 1 if anything is red.",
  credentials:
    "Put one key in the credentials file the config names, 0600, with the value from stdin or --from-env and never from the command line. 'credentials list' says which names the file holds.",
  scope:
    "Which directories this memory is for: on, observer, off, or paused until you resume it. It writes the host's own registry beside claude-code.json, opens no store, and needs no --dir. A subdirectory inherits its nearest ancestor's entry. On this one command --observer names the MODE, not the console's stance.",
};

/** The invocation line, where a command takes something that is not a flag. */
const COMMAND_ARGS: Partial<Record<Command, string>> = {
  note: ' "<text>"',
  recall: ' "<question>"',
  remove: " <id>",
  credentials: " set <NAME> | list",
  scope: " <path|.>",
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
  // TWO COMMANDS, ONE SENTENCE (`recall --json` is the MCP tool's payload,
  // `doctor --json` is the findings): the table is keyed by flag NAME, so the
  // sentence has to be true of both.
  json: "machine-readable output — the structured payload rather than the console's rendering",
  out: "the directory to write into",
  passphrase: "encrypt the export with this secret",
  plaintext: "do not encrypt the export (said on purpose, never by default)",
  confirm: "actually do it — without this, removal is a dry run",
  reason: "the reason, recorded with the removal",
  "strike-by-content-across-scopes":
    "for a memory whose provenance records no project: chase its words through EVERY project's capture buffer (an exact jot, never a substring). Look at what the dry run lists first",
  rebuild: "drop and rebuild the cache instead of counting it",
  "drop-vectors": "let the rebuild lose vectors this console has no embedder to recompute",
  "prune-index": "take the archived and superseded rows out of the text index, keeping the embeddings",
  "keep-vectors": "rebuild the text index and leave every vector where it is",
  "retry-skipped":
    "put the ids the backfill gave up on back in the rotation: it clears every embed.failed counter and changes nothing else",
  apply: "actually do it — without this, it is a dry run",
  config:
    "an absolute path to the host configuration, instead of ~/.counterparts/claude-code.json ($COUNTERPARTS_CONFIG says the same); install WRITES it there, rebrief reads it",
  batch: "rows per transaction while converting (default 500)",
  "dry-run": "say the default out loud: plan and print, change nothing",
  confidence: "high, medium or low — the weakest evidence --apply is allowed to write (default high)",
  "import-day": "YYYY-MM-DD — the day the import ran, instead of the one the store recorded or shows",
  sample: "how many proposed rows to print (default 20)",
  // TRUE OF EVERY COMMAND THAT PRINTS IT, which is the point (review of #77:
  // the first version said "a command that writes still requires --dir", which
  // was false of `note` and of `migrate-cache` itself). `migrate-cache` is the
  // one command left with a `--yes`, and `--apply` there does require `--dir`.
  yes: "skip the typed confirmation, and nothing else — it never stands in for --dir, which --apply requires",
  stdin: "read the value from standard input (the default whenever stdin is not a terminal)",
  "from-env": "read the value from this environment variable instead of from stdin",
  on: "remember here: capture, deposit, wake and recall, as everywhere else",
  off: "nothing here: the hooks produce no output and write nothing, and the tools refuse",
  pause: "off for now, remembering what to go back to",
  resume: "undo a pause (or an off): back to what it was, or on",
  list: "print the whole registry, and the file it came from",
  note: "free text recorded beside the entry, for why",
};

/**
 * THE SENTENCES `scope` PRINTS INSTEAD OF THE SHARED ONES.
 *
 * Two flags mean something else on this command and nowhere else, so its help
 * page says something else about them rather than printing a line that is
 * false. `--observer` is the collision that forced this: it is a COMMON flag
 * meaning "stand this console down", and on `scope` it names one of the four
 * modes the owner asked for by name (G42). The command therefore does NOT read
 * it as a stance — `COUNTERPARTS_OBSERVER` still does, and still refuses every
 * write here — and this table is what keeps the page honest about it.
 */
const SCOPE_FLAG_HELP: Record<string, string> = {
  observer: "reads and recalls here, records nothing — the mode, not this console's stance",
  dir: "not consulted: this command writes host configuration, never a store",
  force: "overwrite a registry this could not parse (it prints what it could not read first)",
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
  // A command may say something else about a flag it means something else by.
  // Today that is `scope` alone, and it is two flags: `--observer` (the mode,
  // not the stance) and `--dir` (not consulted at all). A page that printed the
  // shared sentence for those would be printing something false.
  const override = command === "scope" ? SCOPE_FLAG_HELP : {};
  const flagLine = (name: string): string => {
    const shown = `--${name}${VALUED_FLAGS.includes(name) ? " <value>" : ""}`;
    return `  ${shown.padEnd(20)} ${override[name] ?? FLAG_HELP[name] ?? "(undocumented)"}`;
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
  "config",
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
  "confidence",
  "import-day",
  "sample",
  "from-env",
  "note",
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

/**
 * THE ONE DOOR IN FRONT OF A BULK WRITE: the store is named by the `--dir`
 * FLAG, typed on this command line, or the command refuses.
 *
 * **The disagreement this ends (review of #77, 2026-09-05).** Two writing
 * commands landed the same night with two definitions of "named".
 * `migrate-cache --apply` counted `COUNTERPARTS_DATA_DIR`, so
 * `COUNTERPARTS_DATA_DIR=<store> counterparts migrate-cache --apply --yes`
 * walked through its door, reached the conversion and would have rewritten
 * every vector; `repair-dates --apply`, one command over, refused the identical
 * environment, because its guard read `flags.dir === undefined`. Two answers to
 * "did you name the store", in one console, under one `--yes` sentence
 * asserting they agreed.
 *
 * **The owner's ruling (2026-09-05).** `--yes` only ever skips an interactive
 * confirmation. A command that performs a BULK WRITE always requires the
 * `--dir` flag; neither `--yes` nor `COUNTERPARTS_DATA_DIR` stands in for it.
 * An exported variable is a shell's memory of where a store lives, not a
 * sentence somebody typed about THIS rewrite — and on a real machine what it
 * names is the owner's live memory. Ordinary per-memory commands (`note`,
 * `recall`, `remove`, `init`, `install`, `status`, and `verify`'s read-only
 * census) keep today's behaviour: the variable names their store, which is what
 * QUICKSTART §3 teaches.
 *
 * Called FIRST in each writing body, before `storeExists` and before any
 * planning read: a guard that opened the directory before refusing it has
 * already pointed the command at the store it meant to refuse.
 *
 * `label` is the invocation as the owner typed it (`repair-dates --apply`,
 * `verify --rebuild`) and `what` is the one clause saying what it would have
 * done. Returns the refusal's exit code, or `null` when the door is open.
 */
function requireDirFlagForBulkWrite(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  label: string,
  what: string,
): number | null {
  // The same test the dispatcher uses to decide whether `--dir` named the
  // store. A bare trailing `--dir` never reaches here — `unknownFlag` refuses
  // it for want of a value — and if it ever did it would arrive as boolean
  // `true`, which is "absent" to every reader in this file, and to this one.
  if (typeof flags["dir"] === "string") return null;
  io.err(
    `refused: '${label}' ${what}, and will not run against a store nobody named (it would have been ${dir}). Name the store: --dir <path>.`,
  );
  io.err("Nothing has changed.");
  return EXIT.refused;
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
      // I13's cheap repair: take the archived and superseded rows out of the
      // text index without resetting box 3, so the embeddings survive.
      "prune-index": { type: "boolean" },
      "keep-vectors": { type: "boolean" },
      batch: { type: "string" },
      yes: { type: "boolean" },
      budget: { type: "string" },
      config: { type: "string" },
      // `repair-dates`' three. `dry-run` is a declared boolean rather than a
      // `strict: false` accident so that `--apply --dry-run` is a refusal the
      // command can see, and the two string flags are declared for the same
      // reason `budget` is: an undeclared valued flag arrives as `true`.
      // (`yes` is declared above; `migrate-cache` is the one command that takes
      // it, since repair-dates has no confirmation to skip.)
      "dry-run": { type: "boolean" },
      confidence: { type: "string" },
      "import-day": { type: "string" },
      sample: { type: "string" },
      // `credentials`' two. Declared for the reason every valued flag here is:
      // an undeclared `--from-env` arrives as the BOOLEAN true, and a command
      // that read that as "absent" would fall through to stdin and hang.
      stdin: { type: "boolean" },
      "from-env": { type: "string" },
      observer: { type: "boolean" },
      help: { type: "boolean" },
      // `scope`'s five. Declared as booleans for the same reason `rebuild` is:
      // `strict: false` does not make an undeclared boolean reliable. `--note`
      // is a string, so a trailing `--note` is a refusal rather than a `true`
      // silently recorded as the reason a directory was turned off.
      on: { type: "boolean" },
      off: { type: "boolean" },
      pause: { type: "boolean" },
      resume: { type: "boolean" },
      list: { type: "boolean" },
      note: { type: "string" },
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

  // THE STANCE VARIABLE IS READ THE WAY THE GUARD NEXT DOOR IS READ (G39).
  // This used to match `"1"` and `"true"` exactly, untrimmed, while
  // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` — documented one directory over as the
  // set to reason from — took `1|true|on` trimmed and case-insensitive. So
  // `COUNTERPARTS_OBSERVER=on` looked like an instrument and was an owner
  // console. `adapters/stance-env.ts` is now the one reading, and it collapses
  // a value it cannot read to OBSERVER: `docs/observer-mode.md` G5, fail toward
  // standing down. On this surface that is the cheap direction — a stood-down
  // console still runs every read, and says which stance refused what.
  //
  // ONE COMMAND EXCEPTED, and it is the only exception this console has:
  // `scope --observer` names the MODE to put a directory in (the owner asked
  // for those four words by name, G42), not a stance to put this console in.
  // The two meanings cannot share one flag on one command line, so on `scope`
  // the stance comes from `COUNTERPARTS_OBSERVER` alone — which still refuses
  // every write the command makes, exactly as it refuses an owner op.
  const observerReading = observerFromEnv(
    env,
    parsed.flags["observer"] === true && command !== "scope",
  );
  const observer = observerReading.on;
  if (observerReading.malformed !== null) {
    io.err(
      unreadableStanceLine(OBSERVER_ENV, observerReading.malformed, "standing down to observer stance"),
    );
  }
  if (observer && OWNER_OPS.includes(command)) {
    // Distinguishable, not silent (scar §2.4): the console says which stance
    // refused and which command it refused, so a stood-down run is legible.
    io.err(
      `refused: '${command}' is an owner operation and this console is in observer stance. An instrument reads; it does not change the store.`,
    );
    return EXIT.refused;
  }

  // WHICH HOST CONFIGURATION THIS INVOCATION MEANS — resolved once, by the same
  // rule the hook, the worker and the MCP server use (`adapters/config-path.ts`),
  // and refused rather than guessed.
  //
  // ONLY for the two commands that read or write one. `note`, `recall`, `status`
  // and the rest touch no configuration at all, and a stale
  // `COUNTERPARTS_CONFIG` in somebody's shell must not refuse a command that
  // would never have looked at it — a guard that fires on the innocent case is
  // one people learn to unset rather than to read.
  const readsConfig =
    command === "install" ||
    command === "rebrief" ||
    // `doctor` REPORTS on a host configuration and `credentials` writes the file
    // one names, so both resolve it by the same rule as the other two.
    command === "doctor" ||
    command === "credentials" ||
    // `scope` writes the registry that sits BESIDE the configuration, so the
    // flag that names one names the other.
    command === "scope";
  const named = readsConfig
    ? resolveConfigPath(
        typeof parsed.flags["config"] === "string" ? [`--config=${parsed.flags["config"]}`] : [],
        env,
        opts.home ?? homedir(),
      )
    : undefined;
  if (named !== undefined && named.refusal !== null) {
    io.err(named.refusal);
    return EXIT.refused;
  }

  // `install` resolves its OWN layout and must not go through `resolveDir`:
  // the store's default data dir is `~/.counterparts`, which is exactly the
  // directory this command writes two unclassifiable files into (`install.ts`
  // rule 1). Its default store is the `store/` beneath that instead.
  //
  // Which is why the explicit-dir guard has to be applied HERE by hand: the
  // layout builds `~/.counterparts` from `homedir()` and never calls `dataDir()`,
  // so `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` would otherwise leave `install` free
  // to write the live base — config, credentials, store — from a shell the
  // guard was armed in. An unnamed configuration is refused; `--config
  // <elsewhere>` moves the whole base and is the way through.
  if (command === "install") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return installCommand(parsed, io, env, opts.home, named);
    } catch (err) {
      io.err(`install failed: ${String((err as Error).message ?? err)}`);
      return EXIT.failed;
    }
  }

  // `credentials` OPENS NO STORE, so it must not go through `resolveDir` below:
  // a command that refused for want of a `--dir` it never reads would be a
  // guard firing on the innocent case, which is the shape people learn to work
  // around. The explicit-dir rule still applies to it one door over — the
  // CONFIG it writes beside is the one that names the live store, so an UNNAMED
  // configuration is refused here exactly as it is for `install`.
  if (command === "credentials") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await credentialsCommand(parsed, io, env, named, opts.stdin);
    } catch (err) {
      io.err(`credentials failed: ${String((err as Error).message ?? err)}`);
      return EXIT.failed;
    }
  }

  // `scope` is decided BEFORE the data dir, like `install` and `credentials`,
  // and for a stronger version of the same reason: it never opens a store at
  // all. Resolving one would make a command about the HOST's configuration
  // refuse under `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` for want of a store it does
  // not use — and would put `~/.counterparts` under a command that must be
  // runnable on a machine that has no store yet. The guard still applies to the
  // thing this command DOES touch: an unnamed configuration is refused, because
  // the default one sits in the live base.
  if (command === "scope") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return scopeCommand(parsed, io, observer, named, now);
    } catch (err) {
      io.err(`scope failed: ${String((err as Error).message ?? err)}`);
      return EXIT.failed;
    }
  }

  // `doctor` resolves its store differently from every other command, and the
  // difference is the whole point: it reads the store the CONFIG names, because
  // that is the one the hooks open. A doctor that only ever read
  // `COUNTERPARTS_DATA_DIR` would have declared the temp store healthy through
  // all of I29. So it is handled here, after the configuration is resolved and
  // before the generic `--dir` block.
  //
  // WHICH IS EXACTLY WHY THE EXPLICIT-DIR GUARD APPLIES TO IT HERE, in the same
  // three lines `install` and `credentials` use. The first round of this PR left
  // this branch out and the reviewer reproduced the consequence on the owner's
  // own machine: `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 counterparts doctor`
  // resolved the DEFAULT configuration, read its `dataDir` — the live store —
  // and printed its paths, in a shell armed precisely so that nothing nobody
  // named would open. A read is not exempt: the guard is about which store gets
  // touched at all, not about who writes to it.
  if (command === "doctor") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return doctorCommand(parsed, io, env, named, opts.checkout);
    } catch (err) {
      io.err(`doctor failed: ${String((err as Error).message ?? err)}`);
      return EXIT.failed;
    }
  }

  let dir: string;
  try {
    dir = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : resolveDir(env);
  } catch (err) {
    io.err(describeDirRefusal(err));
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
      case "migrate-cache":
        // Whether the STORE WAS NAMED is the command's own question now, asked
        // by one shared door (`requireDirFlagForBulkWrite`) rather than by each
        // writing command in its own words. This site used to compute it, and
        // counted `COUNTERPARTS_DATA_DIR` where `repair-dates` did not.
        return await migrateCacheCommand(dir, io, parsed.flags);
      case "backup":
        return await backupCommand(dir, io, parsed.flags["out"], now);
      case "export":
        return exportCommand(dir, io, parsed.flags);
      case "remove":
        return await removeCommand(dir, io, parsed.positional[0], parsed.flags, now);
      case "backfill-claims":
        return backfillClaimsCommand(dir, io, parsed.flags);
      case "repair-dates":
        return repairDatesCommand(dir, io, parsed.flags);
      case "repair-merged-beliefs":
        return repairMergedBeliefsCommand(dir, io, parsed.flags);
      case "rebrief":
        return rebriefCommand(dir, io, parsed.flags["budget"], now, opts.home, named);
      case "probe-oq4":
        return probeCommand(dir, io, typeof parsed.flags["dir"] === "string");
      case "fired":
        return firedCommand(dir, io, typeof parsed.flags["dir"] === "string", now);
    }
  } catch (err) {
    io.err(`${command} failed: ${String((err as Error).message ?? err)}`);
    return EXIT.failed;
  }
}

/**
 * `dataDir()` reads the environment AT CALL TIME and runs the path guard — and
 * it reads THIS invocation's environment, not the process's: the tests pass one,
 * and a caller-supplied environment is honoured without mutating the real one
 * (the old shape here swapped `COUNTERPARTS_DATA_DIR` in and out of
 * `process.env` around the call; `dataDir(env)` made that unnecessary, and it
 * means the explicit-dir guard is read from the same environment as the dir).
 */
function resolveDir(env: Record<string, string | undefined>): string {
  return dataDir(env);
}

/**
 * The store refusals the console renders as a SENTENCE rather than printing the
 * error's own line: the explicit-dir guard is one an operator armed on purpose,
 * and the reader is owed what it refused and how to proceed (constitution 16),
 * not a JSON detail. The sentence is the store's (`describeGuardRefusal`); the
 * remedy is this console's, because it is the surface that has `--dir`. Every
 * other store error keeps its `${code} ${detail}` line, asserted by code.
 */
function describeDirRefusal(err: unknown): string {
  return (
    describeGuardRefusal(err, `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`) ??
    String((err as Error).message ?? err)
  );
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
/** `probe-oq4` — read-only; the same store-absent and open rules as `status`. */
function probeCommand(dir: string, io: Io, namedDir: boolean): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
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
    // Explicit ceiling: `eventLog` defaults to 500 oldest-first, which would
    // drop the newest rows — the side of the table the probe exists to read.
    const decisions = store.eventLog({ name: RECALL_DECISION_EVENT, limit: PROBE_ROW_CEILING });
    const credits = store.eventLog({ name: RECALL_CREDIT_EVENT, limit: PROBE_ROW_CEILING });
    const rows = [...decisions, ...credits].map((r) => ({ name: r.name, day: r.day, payload: r.payload }));
    for (const line of renderProbe(probeOQ4(rows))) io.out(line);
    for (const [name, got] of [
      [RECALL_DECISION_EVENT, decisions.length],
      [RECALL_CREDIT_EVENT, credits.length],
    ] as const) {
      if (got >= PROBE_ROW_CEILING) {
        io.err(`warning: ${name} hit the ${PROBE_ROW_CEILING}-row ceiling; the newest rows may be missing from this table`);
      }
    }
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `fired` — which mechanisms have actually fired, and which have not.
 *
 * Read-only, and the same store-absent and open rules as `status`: it opens the
 * store in OBSERVER stance whatever the console's own stance is, because reading
 * what fired must not be able to change it.
 *
 * SILENT FIRST is the whole shape of the output. A page that opened with
 * everything that worked would bury the one thing worth acting on — constitution
 * 11's "one that stays silent is diagnosed and fixed" needs the silences on the
 * first screen, and every group carries the one line that says what its state
 * means so the reader never has to know the vocabulary in advance.
 */
function firedCommand(dir: string, io: Io, namedDir: boolean, now: () => number): number {
  if (!storeExists(dir)) {
    io.err(`No store at ${dir}. Run 'counterparts init${namedDir ? ` --dir ${dir}` : ""}' to create one.`);
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
    for (const line of firedLines(firedReport(store, dateOf(now())))) io.out(line);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/** The report as plain text: one mechanism per line, grouped by state. */
export function firedLines(report: FiredReport): string[] {
  const lines = [
    `what has fired — ${report.from}→${report.today} (UTC), against ${report.previousFrom}→${report.previousTo}`,
    "",
  ];
  if (report.wentQuiet.length > 0) {
    lines.push(`Fired last week and not once this week: ${report.wentQuiet.join("; ")}`, "");
  }
  for (const state of STATE_ORDER) {
    const rows = report.rows.filter((r) => r.state === state);
    if (rows.length === 0) continue;
    lines.push(`${state.toUpperCase()} (${String(rows.length)}) — ${STATE_MEANING[state]}`);
    for (const row of rows) {
      const when = row.lastFired === null ? "never" : row.lastFired;
      const refused =
        row.refusedInWindow === 0
          ? ""
          : `  refused ${String(row.refusedInWindow)}${row.topRefusal === null ? "" : ` (${row.topRefusal})`}`;
      lines.push(
        `  ${row.label}`,
        `    last ${when}  ·  7d ${String(row.firedInWindow)}  ·  total ${String(row.total)}${refused}  ·  ${row.evidence}`,
      );
      // The line that turns an absence into a fact: what is missing, and what
      // would fix it. Only the states that HAVE one carry it.
      if (row.note !== null) lines.push(`    ${row.note}`);
    }
    lines.push("");
  }
  const bounds: string[] = [
    `${String(report.rows.length)} mechanisms read; ` +
      STATE_ORDER.map((s) => `${String(report.counts[s])} ${s}`).join(", "),
  ];
  if (report.notRead.length > 0) {
    bounds.push(`Not read on this pass: ${report.notRead.join(", ")}.`);
  }
  if (report.truncated) {
    bounds.push("The event read hit its ceiling, so every total above is a floor, not a count.");
  }
  if (report.probesTruncated) {
    bounds.push("The id scan hit its ceiling, so every table count above is a floor.");
  }
  bounds.push(
    "Events are bounded-retention telemetry: rows past the window are swept unless a replay latch " +
      "holds them, so these are what I still have rather than everything that ever happened.",
  );
  lines.push(...bounds);
  return lines;
}

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
      // THE LIVE BAND, computed, never the stored column. Until 2026-09-14
      // `memories.band` was a birth fossil — episodic at mint, identity at
      // promotion, and never "semantic" — so reading it reported
      // `episodic 128 / semantic 0` where the dashboard, which does this
      // arithmetic, reported `54 / 74` (LAUNCH-STATUS §I10). Same helper, same
      // day, same answer. The column is now reconciled by the decay pass (U8,
      // `sleep/decay.ts`), so it agrees after a boundary — and this stays
      // computed anyway, because it must be right BEFORE the first boundary of
      // the day and on a store whose last pass hit its budget.
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
  named?: ConfigChoice,
): number {
  const dirFlag = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : undefined;
  // A configuration at a NON-DEFAULT LOCATION moves the whole base — config,
  // credentials, and the default store beneath it (`install.ts#installLayout`).
  // The test is the PATH, not how it was named: `--config` spelling out the
  // default path is the default install, and printing a flag for it (with a
  // sentence saying it is "NOT at" the path it is at) would be false.
  const home_ = home ?? homedir();
  const custom =
    named !== undefined &&
    named.source !== "default" &&
    resolve(named.path) !== defaultConfigPath(home_)
      ? named.path
      : undefined;
  const layout = installLayout(dirFlag, env, home_, custom);
  // Before a single directory: a store that would hold its own configuration is
  // a store that never opens again.
  const refusal = layoutRefusal(layout);
  if (refusal !== null) {
    io.err(refusal);
    return EXIT.refused;
  }
  // And before that: the DEFAULT configuration is never written pointing at a
  // throwaway store (`install.ts#throwawayDefaultRefusal`). That is the shape
  // the 2026-09-04 incident took — the live `claude-code.json` rewritten with a
  // temp `dataDir`, three days of memory recorded nowhere. Independent of the
  // explicit-dir guard on purpose: the incident happened in a shell that had
  // neither the guard nor the home mock, so a refusal that needed either would
  // not have been there.
  const throwaway = throwawayDefaultRefusal(layout, env, home_);
  if (throwaway !== null) {
    io.err(throwaway);
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
  // `--force` MAY NOT BLANK A CREDENTIAL (I32 — 2026-09-04's second clobbered
  // field). A forced install that day replaced a file holding two keys with the
  // template below; the detached worker was refused at every boundary for the
  // following week, the lived-day clock froze, and nothing visible said so. A
  // config is regenerable from this command's own flags. A secret is not, and
  // `--force` was typed to fix a config.
  //
  // NAMES ONLY, here and in the lines printed below: no value is read into this
  // function, compared, or shown. (The #80 guard is a different one — it covers
  // the temp-store `dataDir`, and it did not fire here.) The force is simply
  // withdrawn for this one file, so the ordinary "kept" path answers, which is
  // also what keeps the mode reporting in one place.
  const held = force ? credentialsHeld(layout.credentials) : [];
  const creds = writeOnce(layout.credentials, credentialsTemplate(), {
    force: force && held.length === 0,
    mode: 0o600,
  });

  io.out(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  io.out(`  ${config.what} ${config.path}`);
  io.out(`  ${creds.what} ${creds.path} (mode ${creds.mode ?? "?"})`);
  if (held.length > 0) {
    io.out(`    kept even under --force: it already holds ${held.join(" and ")}.`);
    io.out("    A key cannot be regenerated from anything here. Delete the file by");
    io.out("    hand if you really do mean to start over.");
  }
  // The SAME sentence `init` prints, because the two commands did the same
  // thing: a page that calls them interchangeable and then has them say it
  // differently has made the reader do the comparison.
  if (seeded) io.out(`  identity core seeded for ${name ?? ""} — the thing this memory is about.`);
  if (!isWithin(layout.base, resolved)) {
    // --dir moved the STORE. It does not move the configuration: the hooks read
    // the default path unless something NAMES another one (--config, else
    // COUNTERPARTS_CONFIG), and a hook that finds no config stands down and
    // exits 0 — so a config nothing points them at is a silence nobody debugs.
    // Said out loud rather than left for the reader to discover from an ambient
    // half that never fires.
    io.out("");
    io.out(`  --dir moved the STORE only. The configuration stays at ${config.path}:`);
    io.out(
      custom === undefined
        ? "  that is the path the hooks read when nothing names another one,"
        : `  and the printed lines below name it with ${CONFIG_FLAG} / ${CONFIG_ENV},`,
    );
    io.out(`  and it points at your store with "dataDir": "${resolved}".`);
  }
  // Not said of a credentials file kept BECAUSE it holds a key: --force is
  // exactly what the reader just passed, and telling them to pass it again
  // would send them back to the incident this guard exists to prevent.
  if (config.what === "kept" || (creds.what === "kept" && held.length === 0)) {
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
  for (const line of settingsBlock(hookCommand(custom)).split("\n")) io.out(`     ${line}`);
  io.out("");
  io.out("     The runtime and the script are ABSOLUTE on purpose. A host's process");
  io.out("     environment is not your login shell's — measured on this package's own");
  io.out(`     credentials, day 0 — so '${BIN.hook}' on a PATH that lacks bun is a`);
  io.out("     hook that never runs and says nothing.");
  io.out("");
  io.out("  2. Register the MCP server, so note, recall and session_end exist:");
  io.out("");
  io.out(`     ${mcpCommand(resolved, undefined, custom)}`);
  io.out("");
  // THE FLAG IS PRINTED ONLY WHEN IT IS NEEDED, and when it is, the output says
  // why — otherwise a reader learns the wiring as "hooks take a --config", which
  // is exactly the sentence this rule does not want them to carry away. The
  // default path IS the rule (`adapters/config-path.ts`).
  if (custom !== undefined) {
    io.out(`  Both lines carry this install's configuration, because it is NOT at`);
    io.out(`  ${defaultConfigPath(home_)} — the path all four entry points`);
    io.out(`  read when nobody says otherwise. The hook takes it as ${CONFIG_FLAG} <path>; the`);
    io.out(`  server takes it as ${CONFIG_ENV}, because this host launches MCP servers`);
    io.out("  from a static registration with no command line to write into.");
    io.out("");
  }
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
  io.out(`     ceiling ('${BIN.cli} rebrief'). The HOOKS DO NOT — with no flag they read`);
  io.out(`       ${defaultConfigPath(home)}`);
  io.out("     and nothing else, falling back to COUNTERPARTS_DATA_DIR only when that");
  io.out("     file names no store. A hook that finds no config stands down quietly and");
  io.out("     exits 0 (a Stop with a question exits 2 on purpose, and that is the only");
  io.out("     non-zero a hook produces), so a config anywhere else is an ambient half");
  io.out("     that never fires and never says so — unless you NAME it: every entry point");
  io.out(`     takes ${CONFIG_FLAG} <absolute path>, else $${CONFIG_ENV}, else that default.`);
  io.out(`     To wire the hooks for you, use '${BIN.cli} install'.`);
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
      // THE JOURNAL SAYS SO (owner ruling, 2026-09-04 — LAUNCH-STATUS §I14). A
      // chapter stays recallable and is never presented as a memory; the word
      // rides in front of the kind, where the tier already is.
      const journal = m.journal ? "[journal] " : "";
      io.out(`  ${m.id}  [${m.tier}] ${journal}${m.kind}${m.title === null ? "" : ` — ${m.title}`}`);
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
    if (result.memories.some((m) => m.journal)) {
      io.out(
        "  journal = a chapter, the first-person account a memory was made from — not a memory, and outside decay and the prune.",
      );
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

/**
 * THE BAND OF RECORD, RECONCILED (IMPROVEMENTS U8, 2026-09-14).
 *
 * `memories.band` is canonical and the ranking cache's `band` is derived, and
 * until this PR nothing kept them together: the decay phase wrote its reading
 * into box 3 alone, so on the live store 869 rows were semantic in the cache and
 * episodic in the table while the same pass emitted `band.transition` rows
 * saying they had moved. The ruling is that the TABLE FOLLOWS PHYSICS —
 * `sleep/decay.ts` now writes each row's band back when the column disagrees —
 * and this census is how that is checked rather than believed.
 *
 * THREE NUMBERS, because they are three different facts (scar §2.4):
 *   - `rows`      — live, non-journal rows: the population the column describes.
 *     The journal is not a memory and never earns a band (`sleep/types.ts`), and
 *     an archived or superseded row is deliberately outside box 3.
 *   - `disagree`  — the column contradicts the cache. After a decay pass that was
 *     not cut short by its budget (`sleep/tunables.ts` `BUDGETS.decay`, 20,000
 *     examined rows) this is 0, and a non-zero number means either no pass has
 *     run since this shipped or the store is larger than one pass and is still
 *     catching up, a budget's worth a day.
 *   - `unranked`  — live rows box 3 has never seen. Not a disagreement: there is
 *     nothing to disagree with. "Born since the last pass" is the ordinary
 *     cause and NOT the only one — `verify --rebuild` drops the `ranking` table
 *     with the rest of box 3 (`store/cache.ts#resetCache`) and repopulates only
 *     the index, so straight after a rebuild this reads EVERY live row until the
 *     next decay pass; a decay phase killed mid-body (`CycleKilled`, the
 *     watchdog) leaves everything it had not reached unranked the same way.
 */
interface BandOfRecordCensus {
  readonly rows: number;
  readonly disagree: number;
  readonly unranked: number;
}

function bandOfRecordCensus(store: Store): BandOfRecordCensus {
  const ranking = store.rankingAll();
  const denied = new Set(store.deniedIds());
  let rows = 0;
  let disagree = 0;
  let unranked = 0;
  for (const id of store.list({ archived: false })) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    rows += 1;
    const ranked = ranking.get(id);
    if (ranked === undefined) unranked += 1;
    else if (ranked.band !== row.band) disagree += 1;
  }
  return { rows, disagree, unranked };
}

function bandOfRecordLines(c: BandOfRecordCensus): string[] {
  const out = [
    `  band of record: ${c.disagree} of ${c.rows} live rows disagree with the ranking cache` +
      `   (${c.unranked} not yet ranked)`,
  ];
  if (c.disagree > 0) {
    out.push(
      "    The decay phase writes each band move back to `memories.band` (U8), so a pass that",
      "    its budget did not cut short leaves 0 here. A number that survives several boundaries",
      "    means no boundary has run since this store was built — or that the pass is truncating.",
    );
  }
  if (c.unranked > 0) {
    out.push(
      "    Unranked rows are rows box 3 has not read yet: ones born since the last decay pass,",
      "    everything after a `verify --rebuild` (the rebuild drops the ranking table and does not",
      "    refill it), and whatever a decay phase killed mid-body never reached. The next boundary",
      "    ranks them; a count that survives one is a decay phase that is not finishing.",
    );
  }
  return out;
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
/**
 * "N relative, M absolute (unmigrated|unplaceable), K missing files" — the
 * shape the owner reads the v5 path migration by. Escaping rows (a hand-edited
 * database) and blank pointers (removed rows) are named only when there are
 * any, because "0 removed" on every store is noise.
 */
function pathCensusLine(c: PathCensus, schemaBehind: boolean): string {
  const parts = [
    `${c.relative} relative`,
    `${c.absolute} absolute (${schemaBehind ? "unmigrated" : "unplaceable"})`,
    `${c.missing} missing file${c.missing === 1 ? "" : "s"}`,
  ];
  if (c.escaped > 0) parts.push(`${c.escaped} ESCAPE the store (never resolved; hand-edited rows)`);
  if (c.blank > 0) parts.push(`${c.blank} blank (removed)`);
  return parts.join(", ");
}

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
  // THE WRITING HALF NAMES ITS STORE (2026-09-05 ruling). The census is
  // read-only and stays open to `COUNTERPARTS_DATA_DIR`; these three are not.
  // `--drop-vectors` is guarded even though it is inert without `--rebuild`,
  // because it is a standing consent to lose embeddings and must never be
  // typed at a store the owner did not name.
  const writing =
    flags["rebuild"] === true
      ? (["verify --rebuild", "drops box 3 for the whole store and builds it again"] as const)
      : flags["prune-index"] === true
        ? ([
            "verify --prune-index",
            "deletes every archived and superseded row from the text index",
          ] as const)
        : flags["retry-skipped"] === true
          ? ([
              "verify --retry-skipped",
              "clears every embed.failed counter, so the backfill offers those ids again",
            ] as const)
          : flags["drop-vectors"] === true
            ? ([
                "verify --drop-vectors",
                "stands as consent to lose embeddings this console has no embedder to recompute",
              ] as const)
            : null;
  if (writing !== null) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, writing[0], writing[1]);
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  if (flags["rebuild"] !== true) {
    if (flags["prune-index"] === true) return verifyPruneIndex(dir, io);
    if (flags["retry-skipped"] === true) return verifyRetrySkipped(dir, io);
    return verifyCensus(dir, io);
  }
  // Both at once is a command line that contradicts itself, and guessing which
  // half the owner meant is the one thing a guard like this may not do.
  if (flags["drop-vectors"] === true && flags["keep-vectors"] === true) {
    io.err("refused: --drop-vectors and --keep-vectors say opposite things about the same rows.");
    return EXIT.refused;
  }
  return verifyRebuild(dir, io, flags["drop-vectors"] === true, flags["keep-vectors"] === true);
}

/**
 * `--prune-index` — the CHEAP repair, and the only one for a store that holds
 * vectors.
 *
 * The text index is the index of the live store (I13, `store/cache.ts#deindexDoc`):
 * `archive` and `supersede` take a row out of it, and a store written before
 * they did still holds its dead rows' tokens, where they go on counting toward
 * document frequency against a live denominator. The repair is a pure function
 * of what both boxes already hold, so — exactly like `backfillLengths` — it must
 * not be paid for with `--rebuild`, which drops every embedding.
 */
function verifyPruneIndex(dir: string, io: Io): number {
  const store = Store.open({ dir });
  try {
    const removed = store.pruneDeadIndex();
    io.out(`Store: ${dir}`);
    io.out(`Dropped from the text index (archived or superseded): ${removed}`);
    io.out(
      removed === 0
        ? "The index already held live rows only."
        : "Embeddings are untouched — this repair never resets box 3.",
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `--retry-skipped` — the way BACK for an id the backfill gave up on.
 *
 * A skip is not a denial: the memory is live, recallable and lexically indexed,
 * and only its vector is missing. But the skip is self-sealing —
 * `missingVectors` stops offering the id, so the backfill never tries it, so the
 * counter that caused the skip can never be cleared by a run that lands. Until
 * this flag the only remedy was editing box 2 by hand, and `verify` printed a
 * remedy ("repair it, or rebuild box 3") that could not work: a rebuild has no
 * embedder to recompute anything and never touches meta.
 *
 * So: clear every counter, name how many, and let the next boundary's backfill
 * decide again on the evidence. It writes nothing but those rows — no prose, no
 * index, no embeddings — which is why it is the one writing verify flag that can
 * lose nothing.
 */
function verifyRetrySkipped(dir: string, io: Io): number {
  const store = Store.open({ dir });
  try {
    const skipped = store.skippedVectorIds();
    const held = store.metaWithPrefix(EMBED_FAILED_PREFIX);
    const moves: [string, string][] = [];
    for (const [key, value] of held) {
      if (value !== "0") moves.push([key, "0"]);
    }
    if (moves.length > 0) store.setMetaMany(moves);
    io.out(`Store: ${dir}`);
    io.out(`Embed-failure counters cleared: ${moves.length}`);
    io.out(`Back in the backfill's rotation: ${skipped.length}`);
    if (skipped.length > 0) io.out(`  ${skipped.join(", ")}`);
    io.out(
      moves.length === 0
        ? "Nothing was being skipped; the backfill was already offering every live row."
        : "Nothing else changed. If the text is still poison they will be skipped again.",
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * The durable event log, as `verify` prints it: what is held, how old the
 * oldest row is, and — the number this exists for — what the next cycle's log
 * sweep would delete. Before 2026-09-05 nothing swept the log at all
 * (`sleep/NOTES.md` §13); the first sweep on a store that has never been swept
 * is a deletion somebody should be able to see the size of BEFORE it runs,
 * which is what this read-only line is for. The cap is the sleep budget itself,
 * imported rather than restated, so the number printed is the number in force.
 */
export function eventLogLines(log: EventLogCensus): string[] {
  const cap = SLEEP_TUNABLES.BUDGETS.log;
  const wouldDelete = Math.min(log.eligible, cap);
  const oldest =
    log.oldestDay === null || log.oldestAt === null
      ? "oldest: none"
      : `oldest: lived day ${log.oldestDay} (${dateOf(log.oldestAt)})`;
  return [
    `Events: ${log.rows} held (${log.latched} latched records)   ${oldest}   ` +
      `window: ${log.retentionDays} lived days (cutoff day ${log.cutoffDay})`,
    `  past the window: ${log.eligible} unlatched (the next sleep pass deletes ${wouldDelete}, cap ${cap} per pass)` +
      `, ${log.latchedPastCutoff} latched records kept`,
  ];
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
  let live: string[];
  let denied: string[];
  let unembedded: number;
  let skippedVectors: string[];
  let pathsCensus: ReturnType<Store["pathCensus"]>;
  let schemaVersion: string | null;
  let log: EventLogCensus;
  let bands: BandOfRecordCensus;
  try {
    canonical = store.list();
    // What the INDEX is supposed to cover, since I13: the live rows. An
    // archived or superseded row is canonical and deliberately unindexed.
    live = store.list({ archived: false });
    denied = store.deniedIds();
    unembedded = store.unembeddedCount();
    // The other half of that sum since I33: ids the backfill has given up on
    // after `EMBED_SKIP_AFTER` failed runs. They are excluded from the count
    // above on purpose — it reports what is still actionable — so leaving them
    // unprinted here would be the coverage watch quietly losing rows.
    skippedVectors = store.skippedVectorIds();
    pathsCensus = store.pathCensus();
    schemaVersion = store.getMeta("schemaVersion") ?? null;
    log = store.eventLogCensus();
    bands = bandOfRecordCensus(store);
  } finally {
    store.close();
  }

  const cache = censusCache(dir);
  io.out(`Store: ${dir}`);
  io.out(
    `Canonical rows: ${canonical.length}   live rows: ${live.length}   ` +
      `removed (deny-list): ${denied.length}`,
  );
  // THE PATH COLUMNS, SPELLED OUT (store CONTRACT §5 G15; finding I22). Since
  // store schema v5 a row names its file RELATIVE to the store, so a copied or
  // restored store reads its own prose. A v4 store opened here as an observer
  // still shows its absolute rows — that is the read-only view of what the
  // first writer open will convert — and "missing" is a separate fact from
  // either spelling: the pointer resolved to a file that is not there. The
  // word beside the absolute count is chosen by the schema: on a v4 store the
  // rows are UNMIGRATED (the first writer open converts them); on a v5 store a
  // leftover absolute row was migrated and could not be placed — UNPLACEABLE.
  const schemaBehind = schemaVersion !== null && Number.parseInt(schemaVersion, 10) < SCHEMA_VERSION;
  io.out(`Prose paths: ${pathCensusLine(pathsCensus.prose, schemaBehind)}`);
  io.out(`Version paths: ${pathCensusLine(pathsCensus.versions, schemaBehind)}`);
  if (schemaBehind) {
    io.out(
      `  store schema v${schemaVersion}: absolute paths are converted to relative at the next WRITER open (v${SCHEMA_VERSION}); this census is read-only and changed nothing.`,
    );
  }
  for (const line of eventLogLines(log)) io.out(line);

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
  const liveSet = new Set(live);
  const deniedSet = new Set(denied);
  const missing = live.filter((id) => !indexed.has(id) && !deniedSet.has(id));
  const orphans = cache.counts.indexed.filter((id) => !known.has(id));
  // A THIRD state, and it needs its own name and its own repair: an id that is
  // a canonical row but not a live one, still holding token rows. It is not an
  // orphan (the row exists) and it is not missing (it is there); it is a dead
  // row voting on document frequency against a live denominator, which is I13.
  // `--rebuild` would fix it and drop every embedding on the way; the cheap
  // repair is `--prune-index`.
  const stale = cache.counts.indexed.filter((id) => known.has(id) && !liveSet.has(id));

  io.out(`Cache: ${cache.path}`);
  io.out(
    `  indexed documents: ${indexed.size}   index rows: ${cache.counts.indexRows}   ` +
      `document lengths: ${cache.counts.lengths}   ranking rows: ${cache.counts.ranking}`,
  );
  io.out(`  embeddings: ${cache.counts.embeddings}   live memories with no vector: ${unembedded}`);
  for (const line of bandOfRecordLines(bands)) io.out(line);
  if (skippedVectors.length > 0) {
    io.out(`  skipped after repeated embed failures: ${skippedVectors.length}`);
    io.out(`    ${skippedVectors.join(", ")}`);
    io.out("    Not counted above: the backfill stopped offering them, so they cannot");
    io.out("    clear themselves by landing. Repair the text if it is the cause, then");
    io.out("    counterparts verify --dir <store> --retry-skipped puts them back in the");
    io.out("    rotation for the next boundary.");
  }
  io.out(`  indexed but not live (archived or superseded): ${stale.length}`);
  io.out(`  vector format: ${vectorFormatLine(cache.counts.vectors)}`);
  if (missing.length === 0 && orphans.length === 0 && stale.length === 0) {
    io.out("The cache covers every live row and holds nothing else.");
    return EXIT.ok;
  }
  if (missing.length === 0 && orphans.length === 0) {
    io.err(
      `Cache stale: ${stale.length} indexed ids are archived or superseded and still count toward rarity — ` +
        `'counterparts verify --prune-index' drops them and keeps the embeddings.`,
    );
    return EXIT.failed;
  }
  io.err(
    `Cache incomplete: ${missing.length} live rows are not indexed, ${orphans.length} indexed ids are not canonical rows, ` +
      `${stale.length} are canonical but not live — ` +
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
    io.out(`Skipped as not live (archived or superseded): ${report.skippedArchived}`);
    io.out(`Not recomputed: ${report.unrecomputed}`);
    for (const declared of report.declared) {
      io.out(`  declared: ${declared.what} — owner ${declared.owner}; repair: ${declared.repair}`);
    }
    const accounted = report.indexed + report.skippedDenied + report.skippedArchived;
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
 *   2. **`--apply` names its store out loud.** The destination is the `--dir`
 *      FLAG, typed on this line, and nothing else — not the default, and (since
 *      the 2026-09-05 ruling) not `COUNTERPARTS_DATA_DIR` either, which is a
 *      shell's memory rather than a sentence about this rewrite. Then it asks,
 *      `remove`-style, unless `--yes`.
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
): Promise<number> {
  const apply = flags["apply"] === true;
  // FIRST, before this command looks at a single path. `resolveDir` falls
  // through to `dataDir()`, which on the owner's machine is his live memory,
  // and this command's own PR says the merge is reversible and the `--apply`
  // is not. A guard that reads the default directory before refusing it has
  // already been pointed at the store it meant to refuse.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "migrate-cache --apply",
      "rewrites every vector in box 3",
    );
    if (refusal !== null) return refusal;
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
    // NAME THE PROTECTION THAT EXISTS. This line used to say "take a
    // 'counterparts backup' first", which protects nothing here: box 3 is on
    // the backup set's explicit EXCLUSION list ("cache — Box 3 — rebuildable",
    // `store/paths.ts#LAYOUT`), so a snapshot taken before `--apply` contains
    // no copy of the file `--apply` rewrites. The only thing that does is a
    // copy of the file itself — and a copy of a database another process is
    // writing is not a backup (scar §2.11), which is why the sentence says
    // with nothing open rather than leaving that to be discovered.
    io.out(
      `First, copy box 3 aside — 'counterparts backup' skips the cache on purpose (it is rebuildable), so it does not cover this:`,
    );
    io.out(`  cp ${path} ${path}.bak-<date>`);
    io.out(`  (with every session closed — a copy of a database being written is not a copy of it)`);
    io.out(`Then re-run with --apply to convert (batches of ${batch}).`);
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
function backfillClaimsCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // A BULK WRITE ACROSS EVERY AUTHORED MEMORY, and until 2026-09-05 it had no
  // door at all: `COUNTERPARTS_DATA_DIR=<store> backfill-claims --apply` ran.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "backfill-claims --apply",
      "writes the default claimed floor onto every unclaimed authored memory",
    );
    if (refusal !== null) return refusal;
  }
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

// ── repair-dates ────────────────────────────────────────────────────────────

/**
 * The migrated rows' dates, proposed from what the rows themselves carry.
 *
 * The console's half is thin on purpose: parse three flags, refuse a bad one by
 * name, and hand off to `repair-dates.ts`, where the evidence rules and their
 * reasons live. `--dry-run` is accepted and is the DEFAULT — it exists so the
 * safe call can be spelled out loud rather than only implied by the absence of
 * `--apply` — and passing both is a refusal, not a silent winner.
 */
function repairDatesCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // Argument arithmetic only: this opens nothing, so it may stand in front of
  // the store door. A command line that contradicts itself should be told so.
  if (apply && flags["dry-run"] === true) {
    io.err("repair-dates: --apply and --dry-run contradict each other; pass one");
    return EXIT.usage;
  }
  // THE ONE OWNER OP THAT REWRITES THOUSANDS OF CANONICAL DOCUMENTS. A dry run on
  // the defaulted store is read-only and stays unguarded (it is how the owner
  // looks); an APPLY that nobody aimed asks to be aimed (review §4) — by `--dir`,
  // and by nothing else. `--yes` used to stand in for it here, while one command
  // over it meant "skip the typed confirmation"; the 2026-09-05 ruling is that
  // `--yes` only ever skips a confirmation, and this command has none to skip.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "repair-dates --apply",
      "rewrites the date on every migrated memory the evidence reaches",
    );
    if (refusal !== null) return refusal;
  }
  const raw = typeof flags["confidence"] === "string" ? flags["confidence"] : "high";
  if (raw !== "high" && raw !== "medium" && raw !== "low") {
    io.err(`repair-dates: --confidence must be high, medium or low (got ${raw})`);
    return EXIT.usage;
  }
  const confidence: Confidence = raw;
  const importDay = typeof flags["import-day"] === "string" ? flags["import-day"] : undefined;
  if (importDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(importDay)) {
    io.err(`repair-dates: --import-day must be YYYY-MM-DD (got ${importDay})`);
    return EXIT.usage;
  }
  const sampleRaw = typeof flags["sample"] === "string" ? Number(flags["sample"]) : undefined;
  if (sampleRaw !== undefined && (!Number.isInteger(sampleRaw) || sampleRaw < 0)) {
    io.err(`repair-dates: --sample must be a non-negative whole number`);
    return EXIT.usage;
  }
  const report = repairDates(dir, io, {
    apply,
    minConfidence: confidence,
    ...(importDay === undefined ? {} : { importDay }),
    ...(sampleRaw === undefined ? {} : { sample: sampleRaw }),
  });
  if (report === null) return EXIT.failed;
  if (report.refused !== null) return EXIT.refused;
  return report.failures.length === 0 ? EXIT.ok : EXIT.failed;
}

// ── repair-merged-beliefs ───────────────────────────────────────────────────

/** How much of a statement a repair report prints. */
const STATEMENT_PREVIEW = 60;

/** How far back the merge log is read. `eventLog`'s own default is 500. */
const MERGE_LOG_CEILING = 100_000;

interface MergedBelief {
  readonly id: string;
  /** The entity the element hangs off, and its name when the entity is readable. */
  readonly entityId: string | null;
  readonly entityName: string | null;
  /** First 60 characters of the statement, on one line. */
  readonly statement: string;
  /** The memory it was merged into, from the durable merge record. */
  readonly originalId: string | null;
  readonly originalPreview: string | null;
  /** The lived day the merge was recorded on. */
  readonly mergedOnDay: number | null;
  /** True when the row is archived right now (false = already repaired). */
  readonly archived: boolean;
}

/**
 * THE REPAIR FOR PROBE H — beliefs the nightly dedup pass ate.
 *
 * The bug (`sleep/NOTES.md` §12, fixed the same night): a `type: "schema"` row
 * was an ordinary dedup candidate. An element whose statement is X and an
 * ordinary memory whose body is X — no revision anywhere — formed a same-hash
 * group, `mem_` sorted before `sch_` in the tie-break, and the ELEMENT was
 * archived `merged`. `beliefs(entity)` then read empty: the store had stopped
 * believing something nobody retracted. On a migrated store the DIRECTION of
 * that loss is certain — `tools/migrate/apply.ts` minted every element at the
 * import day while migrated memories kept their v1 birth day, so the memory is
 * never younger and the element always loses — and the COUNT is unknown, since
 * a collision needs two distinct v1 items whose gated text is byte-identical.
 * This command is the thing that measures it.
 *
 * Stopping the bug does not undo it. This finds what it already took and puts
 * it back, through the owner-op seam's `unarchiveMerged` — the one door that
 * un-archives, and only for `archived_reason: "merged"`.
 *
 * Two sources are unioned, because either can be the surviving evidence: the
 * `memory.merged` events whose `candidateId` is a `sch_` id (the owner's
 * read-only check, and the one that still reads true after the retention window
 * trims nothing), and the archived schema rows whose reason is the merge (which
 * survives even if the event log has rolled). Ids the owner removed are skipped
 * — the deny-list answers before this tool does.
 *
 * **What it prints, and the tension in printing it.** `backfill-claims` says
 * "IDS AND NUMBERS ONLY — a repair report is not a place to print bodies", and
 * this one prints TWO things that are not ids: the first 60 characters of each
 * statement, and the ENTITY'S NAME. A person's name is author content as
 * squarely as a statement is, and both are the same deliberate deviation. The
 * difference is what the owner has to decide: a claim restored to the store is
 * a claim the system will state in a briefing, and "restore sch_198628843ffb?"
 * is not a question anyone can answer — nor is it answerable without knowing
 * whose belief it is. This runs on the owner's own terminal, on the owner's own
 * store, at the owner's own keystroke — the same reader who could open the
 * prose file. **The durable record stays ids and numbers only**
 * (`memory.unmerged` carries no text at all, §5 G10): the deviation is
 * console-only. Recorded rather than assumed (see `cli/NOTES.md`).
 *
 * **What it does not touch: the `uses` the merge credited.** The original kept
 * `+1` and keeps it. Taking it back would rewrite a physics count whose band
 * may already have been materialized and whose crossing may already be a
 * durable `band.transition` row, to undo one use. The number is written into
 * the `memory.unmerged` record instead, so the credit is auditable rather than
 * silently reversed — and the merge record itself is left exactly where it is
 * (constitution 7: the history is the point).
 */
function repairMergedBeliefsCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // UN-ARCHIVES ROWS IN BULK, and it too had no door before 2026-09-05.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "repair-merged-beliefs --apply",
      "un-archives every belief and current-state row the dedup pass took",
    );
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }

  // The plan is made read-only, as every plan here is (scar E5).
  const planning = Store.open({ dir, observer: true });
  let targets: MergedBelief[];
  try {
    targets = mergedBeliefs(planning);
  } finally {
    planning.close();
  }

  const open = targets.filter((t) => t.archived);
  // WHICH STORE. `--dir` is optional and the default resolves to the owner's
  // live memory, and this is a command whose next step is `--apply`: a repair
  // that did not say what it was about to repair is the 2026-09-04 `--dirr`
  // lesson pointed at the owner's own hands. `status`, `note` and `recall`
  // print this line; `backfill-claims` does not, and should.
  io.out(`Store: ${dir}`);
  io.out(`Beliefs and current-state rows archived as duplicates: ${open.length}`);
  if (targets.length > open.length) {
    io.out(`Already restored (a merge record with a live row): ${targets.length - open.length}`);
  }
  for (const t of targets) {
    const where = t.entityName === null ? (t.entityId ?? "no entity") : t.entityName;
    const day = t.mergedOnDay === null ? "day unrecorded" : `lived day ${t.mergedOnDay}`;
    io.out(`  ${t.id}  ${where}  ${day}${t.archived ? "" : "  [already live]"}`);
    io.out(`    "${t.statement}"`);
    io.out(
      t.originalId === null
        ? "    merged into an original the log no longer names"
        : `    merged into ${t.originalId}${t.originalPreview === null ? "" : `  "${t.originalPreview}"`}`,
    );
  }

  if (!apply) {
    io.out("");
    io.out(
      open.length === 0
        ? "Dry run. Nothing to repair on this store."
        : "Dry run. Nothing has changed. Re-run with --apply to put these back.",
    );
    return EXIT.ok;
  }
  if (open.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return EXIT.ok;
  }

  const store = Store.open({ dir });
  let restored = 0;
  const failures: string[] = [];
  try {
    // RE-CHECK under the writing store: the plan was made against a store that
    // may have moved, and the seam refuses anything that is no longer a merge.
    for (const target of mergedBeliefs(store)) {
      if (!target.archived) continue;
      try {
        const report = unarchiveMerged(store, target.id);
        if (!report.noop) restored += 1;
      } catch (err) {
        failures.push(`${target.id}: ${String((err as Error).message ?? err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Put ${restored} elements back. The uses each merge credited stand, and are recorded.`);
  for (const failure of failures) io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}

/** Archived schema rows the merge took, and the merge records that name them. */
function mergedBeliefs(store: Store): MergedBelief[] {
  const denied = new Set(store.deniedIds());
  const ids = new Set<string>();
  const schemaPrefix = `${ID_PREFIX["schema"]}_`;
  for (const id of store.list({ type: "schema", archived: true })) {
    const row = store.row(id);
    if (row === undefined || denied.has(id)) continue;
    if (row.archived_reason === MERGED_ARCHIVE_REASON) ids.add(id);
  }
  // `eventLog` defaults to 500 rows; a store with more merges than that would
  // silently shorten this list, so the ceiling is named rather than inherited.
  // The ARCHIVED rows above are found by `list`, which has no cap — this pass
  // adds the ones already restored, and the reason it exists at all is that a
  // merge record can outlive the archive it describes.
  for (const event of store.eventLog({ name: "memory.merged", limit: MERGE_LOG_CEILING })) {
    if (event.ref === null || !event.ref.startsWith(schemaPrefix) || denied.has(event.ref)) continue;
    const row = store.row(event.ref);
    if (row === undefined) continue;
    // ARCHIVED FOR A DIFFERENT REASON IS NOT THIS TOOL'S BUSINESS. A belief
    // restored last month and legitimately revised since is archived `revised`
    // with a successor; listing it as an open target would make the next
    // `--apply` refuse it with `UNMERGE_SUPERSEDED` and exit FAILED on a store
    // where nothing is wrong.
    if (row.archived === 1 && row.archived_reason !== MERGED_ARCHIVE_REASON) continue;
    ids.add(event.ref);
  }

  const out: MergedBelief[] = [];
  for (const id of [...ids].sort()) {
    const row = store.row(id);
    if (row === undefined) continue;
    // A WALKING read, the way `schemas/index.ts#load` reads it: the store's
    // archived-read telemetry answers "did anyone look at archived CONTENT",
    // and a repair plan is a look at the address, not at the memory.
    let doc: { body: string; meta: Record<string, unknown> } | null = null;
    try {
      doc = readProseWalking(store, id, row);
    } catch {
      doc = null;
    }
    const entityId = typeof doc?.meta["entityId"] === "string" ? doc.meta["entityId"] : null;
    const merge = mergeRecordOf(store, id);
    out.push({
      id,
      entityId,
      entityName: entityId === null ? null : entityNameOf(store, entityId),
      statement: doc === null ? "(prose unreadable)" : oneLine(doc.body, STATEMENT_PREVIEW),
      originalId: merge.originalId,
      originalPreview:
        merge.originalId === null ? null : previewOf(store, merge.originalId, STATEMENT_PREVIEW),
      mergedOnDay: merge.day,
      archived: row.archived === 1,
    });
  }
  return out;
}

/** The last `memory.merged` record naming this id, in ids and numbers. */
function mergeRecordOf(store: Store, id: string): { originalId: string | null; day: number | null } {
  const rows = store.eventLog({ name: "memory.merged", ref: id });
  const last = rows[rows.length - 1];
  if (last === undefined || last.payload === null) return { originalId: null, day: null };
  try {
    const parsed = JSON.parse(last.payload) as Record<string, unknown>;
    return {
      originalId: typeof parsed["originalId"] === "string" ? parsed["originalId"] : null,
      day: last.day,
    };
  } catch {
    return { originalId: null, day: last.day };
  }
}

function entityNameOf(store: Store, entityId: string): string | null {
  try {
    const name = readProseWalking(store, entityId).meta["name"];
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    // An id with no row, and prose that will not read, are the same answer here
    // — the name is unavailable. `readProseWalking` refuses the first by name,
    // so the row lookup this used to do first has nothing left to add.
    return null;
  }
}

function previewOf(store: Store, id: string, max: number): string | null {
  try {
    return oneLine(readProseWalking(store, id).body, max);
  } catch {
    return null;
  }
}

/** One line, at most `max` characters, with an ellipsis when it was cut. */
function oneLine(body: string, max: number): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
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
  named?: ConfigChoice,
): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const ceiling =
    home === undefined
      ? hostCeiling(dir, budgetFlag, homedir(), named)
      : hostCeiling(dir, budgetFlag, home, named);
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
        : `  budget ${ceiling.bytes} bytes from ${ceiling.source}${
            ceiling.namedBy === undefined ? "" : ` (named by ${ceiling.namedBy})`
          }`,
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

// ── scope ───────────────────────────────────────────────────────────────────

/**
 * `counterparts scope` — which directories this memory is for (owner asks
 * G42/G43, 2026-09-10).
 *
 * **It is a HOST-CONFIG write, not a store write**, and every rule below falls
 * out of that one sentence:
 *
 *   - it takes no `--dir` and opens no store, so it runs on a machine that has
 *     not installed one yet — which is exactly when somebody wants to say "not
 *     here";
 *   - it writes `<config dir>/scopes.json`, so `--config` (and
 *     `$COUNTERPARTS_CONFIG`) moves the registry with the configuration, and a
 *     scratch install's scopes are that install's own;
 *   - it is NOT on `OWNER_OPS`, because that list refuses a COMMAND whole and
 *     an instrument must still be able to READ this file — "why did this
 *     session record nothing" is a question a stood-down console has to be able
 *     to answer. The write half refuses in the same sentence an owner op does,
 *     one function down, beside the write it guards.
 *
 * **A relative path is never stored.** The registry is read by processes a host
 * launches from a working directory nobody chose (`config-path.ts`'s whole
 * argument about `--config`), so a relative key would name a different
 * directory in each of them. `.` is the ordinary way to say "here" and is
 * resolved before anything is written; the output always names the ABSOLUTE
 * path it wrote, so the resolution is never a silent one.
 *
 * **A registry it cannot parse is never overwritten.** `--force` is the way
 * through, and it prints what it could not read first: the alternative is a
 * console that quietly replaces a file somebody hand-edited.
 */
function scopeCommand(
  parsed: Parsed,
  io: Io,
  observer: boolean,
  choice: ConfigChoice | undefined,
  now: () => number,
): number {
  const configPath = choice?.path ?? defaultConfigPath();
  const file = scopesPath(configPath);
  const flags = parsed.flags;
  const asked: { flag: string; mode: ScopeMode }[] = [
    { flag: "on", mode: "on" },
    { flag: "observer", mode: "observer" },
    { flag: "off", mode: "off" },
    { flag: "pause", mode: "paused" },
  ].filter((m) => flags[m.flag] === true) as { flag: string; mode: ScopeMode }[];
  const resuming = flags["resume"] === true;
  const listing = flags["list"] === true;

  if (asked.length + (resuming ? 1 : 0) > 1) {
    io.err(
      `refused: ${[...asked.map((a) => `--${a.flag}`), ...(resuming ? ["--resume"] : [])].join(" and ")} — a directory is in one mode at a time.`,
    );
    io.err("Nothing was written.");
    return EXIT.refused;
  }

  const read = readScopes(file);
  const unreadable = (): void => {
    io.err(`refused: ${file} could not be read — ${read.error ?? "unknown"}.`);
  };
  // THE ENTRIES THIS FILE HOLDS AND NOBODY CAN HONOUR (#92 review, F2). They are
  // named on every path through this command, read or write, because a refused
  // entry reads as unset — which is ON — and the person in front of this console
  // is the only one who can fix it.
  const sayRefused = (): void => {
    for (const entry of read.refused) {
      io.err(`  ignored: ${entry.key} — ${entry.detail}. It reads as unset, which is on.`);
    }
  };

  // ── --list: the whole registry, and the file it came from ─────────────────
  if (listing) {
    if (asked.length > 0 || resuming || parsed.positional.length > 0) {
      io.err("refused: --list prints the whole registry; it takes no path and no mode.");
      return EXIT.refused;
    }
    if (read.error !== null) {
      unreadable();
      io.err("Nothing was read. Fix the file, or replace it with `scope <path> --off --force`.");
      return EXIT.refused;
    }
    io.out(`Scopes (${file}):`);
    if (read.refused.length > 0) {
      io.err(
        `warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this file could not be read:`,
      );
      sayRefused();
    }
    const entries = Object.entries(read.registry?.scopes ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (entries.length === 0) {
      io.out("  Nothing is set. Every directory is on by default.");
      return EXIT.ok;
    }
    for (const [path, entry] of entries) {
      const resume = entry.mode === "paused" ? ` (resumes to ${resumeTarget(entry)})` : "";
      io.out(`  ${entry.mode.padEnd(9)} ${path}${resume}`);
      io.out(`  ${" ".repeat(9)} since ${entry.since}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
    }
    return EXIT.ok;
  }

  const given = parsed.positional[0];
  if (given === undefined) {
    io.err("refused: name a directory (`.` means this one), or pass --list.");
    return EXIT.usage;
  }
  const dir = canonicalScopePath(given);

  // ── no mode: what does this directory resolve to, and who said so ─────────
  if (asked.length === 0 && !resuming) {
    if (read.error !== null) {
      unreadable();
      io.err("Until it is fixed every directory reads as unset, which is on.");
      return EXIT.refused;
    }
    if (read.refused.length > 0) {
      io.err(
        `warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read:`,
      );
      sayRefused();
    }
    const verdict = lookupScope(read.registry, dir);
    io.out(`${dir} — ${verdict.mode === "unset" ? "unset" : verdict.mode}`);
    if (verdict.entry === null) {
      io.out("  Nothing is set for it or for any parent, so it is on (the default).");
      io.out(`  Registry: ${file}`);
      return EXIT.ok;
    }
    io.out(`  Stance: ${stanceOfMode(verdict.mode)}.`);
    io.out(
      verdict.matched === dir
        ? `  Decided by its own entry, set ${verdict.entry.since}.`
        : `  Decided by ${verdict.matched ?? "?"} (an ancestor), set ${verdict.entry.since}.`,
    );
    if (verdict.entry.mode === "paused") {
      io.out(`  --resume puts it back to ${resumeTarget(verdict.entry)}.`);
    }
    if (verdict.entry.note !== undefined) io.out(`  Note: ${verdict.entry.note}`);
    io.out(`  Registry: ${file}`);
    return EXIT.ok;
  }

  // ── the write half ────────────────────────────────────────────────────────
  if (observer) {
    // The same sentence an owner op gets, from the same reasoning: this console
    // is an instrument, and an instrument does not change what it is reading.
    // Note that on THIS command `--observer` is a mode and never a stance, so
    // the only thing that can have stood it down is `COUNTERPARTS_OBSERVER`.
    io.err(
      "refused: writing the scope registry changes this host's configuration, and this console is in observer stance. An instrument reads; it does not change the setting it is reading.",
    );
    return EXIT.refused;
  }
  if (read.error !== null && flags["force"] !== true) {
    unreadable();
    io.err("Nothing was written. Fix it by hand, or pass --force to replace it entirely.");
    return EXIT.refused;
  }
  // A WRITE WOULD DROP THE ENTRIES THIS READ REFUSED — every write rewrites the
  // whole file from what parsed — so it refuses instead, by name (#92 review,
  // F2). `--force` goes ahead and says which entries it is dropping: the good
  // ones are carried (they parsed), the named ones are gone.
  if (read.refused.length > 0) {
    if (flags["force"] !== true) {
      io.err(
        `refused: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read, and writing would drop ${read.refused.length === 1 ? "it" : "them"}:`,
      );
      sayRefused();
      io.err("Nothing was written. Fix those by hand, or pass --force to drop them.");
      return EXIT.refused;
    }
    io.err(
      `warning: --force drops ${String(read.refused.length)} unreadable ${read.refused.length === 1 ? "entry" : "entries"}:`,
    );
    sayRefused();
  }
  // `--force` starts from EMPTY, not from a half-understood file: a registry
  // that did not parse has no entries this can honestly carry forward, and
  // silently keeping the ones that happened to be readable is the shape that
  // turns an `off` into an `on`.
  const base: ScopeRegistry | null = read.error === null ? read.registry : null;

  let mode: ScopeMode;
  if (resuming) {
    const own = ownEntry(base, dir);
    if (own === null) {
      const inherited = lookupScope(base, dir);
      io.err(
        inherited.entry === null
          ? `refused: nothing is set for ${dir}, so there is nothing to resume. It is already on.`
          : `refused: nothing is set for ${dir} itself — it inherits ${inherited.matched ?? "?"}. Resume that one, or set this one directly.`,
      );
      return EXIT.refused;
    }
    if (own.mode === "on" || own.mode === "observer") {
      io.out(`${dir} is already ${own.mode}; nothing to resume, and nothing was written.`);
      return EXIT.ok;
    }
    // `--resume` restores an `off` as well as a `paused`, which is the loop the
    // owner asked for: turn a directory off, work, turn it back on. An `off`
    // never recorded what to go back to, so it goes back to `on`.
    mode = resumeTarget(own);
  } else {
    mode = asked[0]?.mode ?? "on";
  }

  // ONE function for the change, used twice: once against the registry this
  // command read, and again — by `writeScopes` — against whatever is actually
  // on disk if somebody wrote between that read and the rename (#92 review, F3).
  // The other writer is the MCP `scope` tool, in the same directory, in another
  // process, and before this the second rename simply deleted the first entry.
  const apply = (from: ScopeRegistry | null): ScopeRegistry =>
    setScope(from, dir, mode, {
      at: new Date(now()).toISOString(),
      ...(typeof flags["note"] === "string" ? { note: flags["note"] } : {}),
    });
  const next = apply(base);
  writeScopes(file, next, {
    basedOn: read,
    // `--force` over a file nobody could read starts from empty either way:
    // there is nothing in it this can honestly carry forward.
    reapply: (fresh) => apply(read.error === null ? fresh : null),
  });

  io.out(`Scope set: ${dir} — ${mode}.`);
  if (canonicalScopePath(given) !== resolve(given) || given !== dir) {
    io.out(`  ('${given}' resolved to that path; the registry only ever holds absolute ones.)`);
  }
  io.out(`  ${scopeEffect(mode, ownEntry(next, dir)?.resumeTo)}`);
  io.out(`  Written to ${file}`);
  return EXIT.ok;
}

/** What the owner just chose, in one sentence, on the surface that chose it. */
function scopeEffect(mode: ScopeMode, resumeTo: string | undefined): string {
  switch (mode) {
    case "on":
      return "Sessions there capture, deposit, wake and recall, as everywhere else.";
    case "observer":
      return "Sessions there deliver the wake and recall and record nothing; the note, session_end and chapter tools stand down.";
    case "off":
      return "The hooks there produce no output and write nothing, and every tool refuses. `--resume` turns it back on.";
    default:
      return `Off for now. \`--resume\` puts it back to ${resumeTo ?? "on"}.`;
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
  /** Set when a `--config` / `COUNTERPARTS_CONFIG` named the file that answered,
   *  so the printed line can say the number came from a file the caller chose. */
  readonly namedBy?: ConfigSource;
}
export interface CeilingMissing {
  readonly refusal: string;
  readonly searched: readonly string[];
}

export function hostCeiling(
  dir: string,
  flag: string | boolean | undefined,
  home = homedir(),
  /**
   * The configuration this invocation was TOLD to read, when it was told. A
   * named file replaces the two-step search entirely — a caller who said which
   * configuration to use did not ask for a fallback to another one, and falling
   * back would compose a briefing under a ceiling from a file they never named
   * (the same failure as the rest of this rule, one level up).
   */
  named?: ConfigChoice,
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
  const hooksConfig = defaultConfigPath(home);
  // De-duplicated, because on a default install these are the same file and a
  // refusal that named it twice would read as two separate misses.
  const searched =
    named !== undefined && named.source !== "default"
      ? [named.path]
      : beside === hooksConfig
        ? [beside]
        : [beside, hooksConfig];
  const namedBy = named !== undefined && named.source !== "default" ? named.source : undefined;
  for (const candidate of searched) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const value = parsed["injectionBudgetBytes"];
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return {
          bytes: value,
          source: candidate,
          searched,
          ...(namedBy === undefined ? {} : { namedBy }),
        };
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

// ── doctor / credentials ────────────────────────────────────────────────────

/**
 * `doctor`'s exit code when anything is RED.
 *
 * It is the same number as `EXIT.usage` and it means something else: not "you
 * typed this wrong" but "the store you asked about has a red finding". A
 * separate constant rather than a sixth member of `EXIT`, because `EXIT` is this
 * console's vocabulary for how a COMMAND went and this is a verdict about a
 * STORE. Both renderings use it, so a script can branch on `$?` without parsing
 * either.
 */
export const DOCTOR_RED_EXIT = 1;

/**
 * The host configuration at `path`, read the way every entry point reads it,
 * with the three readings kept distinct.
 *
 * `loadConfig(undefined)` says "absent", which is the right answer for a file
 * that is not there and the WRONG one for a file that is there and will not
 * parse — so the parse failure is caught here and named. Both resolve to a
 * config `doctor` can still report on; neither throws.
 */
function hostConfigFor(path: string): {
  config: AdapterConfig;
  reason: "loaded" | "absent" | "unreadable";
} {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    const load = loadConfig(undefined);
    return { config: load.config, reason: "absent" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The same direction `loadConfig` takes for a file it cannot understand:
    // observer, and say so. A config that will not parse silences every hook.
    return { config: { observer: true }, reason: "unreadable" };
  }
  const load = loadConfig(raw);
  return { config: load.config, reason: load.reason };
}

/** Where the credentials live for a given configuration: the file the config
 *  NAMES, else the one `install` writes beside it. */
function credentialsPathFor(configPath: string, config: AdapterConfig): string {
  return config.credentialsFile ?? join(dirname(configPath), CREDENTIALS_FILE);
}

/** The persisted per-reason spawn refusal counters, as `doctor` wants them. */
function spawnRefusalCounters(store: Store | null): Record<string, number> {
  if (store === null) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
    const n = Number(value);
    if (n > 0) out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
  }
  return out;
}

/**
 * `doctor` — the reading that would have caught I32 on day one.
 *
 * Read-only, all the way down: the store is opened in OBSERVER stance, box 3 is
 * never opened at all, and nothing here writes a row. The findings, the
 * severities and the fix sentences live in `claude-code/doctor.ts` and are the
 * SAME ones the session-start notice reads, so the terminal warning and this
 * report cannot say different things about one store.
 *
 * Two things it does differently from every other command, both deliberate:
 *
 *   1. **The store comes from the CONFIG first.** `--dir` overrides it and the
 *      environment is the last resort, because the question `doctor` answers is
 *      "is the store the HOOKS open healthy" — and through all of I29 the
 *      answer for the store the environment named was yes.
 *   2. **The credentials are read from the FILE, against a scratch environment.**
 *      A console that counted its own shell would read green on the owner's
 *      machine — his `~/.zshrc` exports both names — while the hook processes,
 *      which inherit neither (measured day 0), stayed blind. That is I32
 *      reproduced inside the diagnostic. What the shell has and the file lacks
 *      is reported as its own clause instead.
 *
 * **And what reading from the config does NOT buy it: an exemption.** With
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed, this command refuses unless a
 * human named something — `--dir`, or a configuration by `--config` /
 * `COUNTERPARTS_CONFIG`. A configuration found at the DEFAULT path names the
 * live store on every machine with an install, so honouring its `dataDir` past
 * the guard would be the guard's own failure mode wearing a diagnostic's face;
 * the first round of this PR did exactly that and was caught reading the
 * owner's live paths from an armed shell. Two doors enforce it: `run()`
 * (`implicitConfigRefusal`, the same three lines `install` and `credentials`
 * use) and the dir resolution below.
 */
function doctorCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  named?: ConfigChoice,
  checkout?: CheckoutReading,
): number {
  const configPath = named?.path ?? defaultConfigPath();
  const { config, reason } = hostConfigFor(configPath);
  const credentialsPath = credentialsPathFor(configPath, config);
  const credentials = loadCredentials(credentialsPath, {});
  const shellNames = CREDENTIAL_NAMES.filter((n) => (env[n] ?? "").trim().length > 0);

  // WHICH STORE, under the guard. `--dir` is a name. A config the CALLER named
  // (`--config`, `COUNTERPARTS_CONFIG`) is a name, and the `dataDir` inside it is
  // named by extension. A config nobody named is NOT a name — and its `dataDir`
  // field is the live store on every machine with an install, which is why the
  // old shape here never reached `resolveDir` and so never met the guard at all.
  //
  // `run()` already refuses that case one door up (`implicitConfigRefusal`), and
  // this is the second door rather than the first: `doctorCommand` is reachable
  // without it — a caller inside this module, a future dispatch — and the whole
  // finding was that one missing branch let a read at the live store through.
  // The sentence is `verify`'s own, so the two doors say the same thing.
  const namedConfig = named !== undefined && named.source !== "default";
  const guard = explicitDirSetting(env);
  let dir: string;
  try {
    if (typeof parsed.flags["dir"] === "string") {
      dir = parsed.flags["dir"];
    } else if (config.dataDir !== undefined && !namedConfig && guard.armed) {
      throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
        guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${guard.value}`,
        dir: config.dataDir,
      });
    } else {
      dir = config.dataDir ?? resolveDir(env);
    }
  } catch (err) {
    // The explicit-dir guard, at exactly the door `verify`'s census meets it:
    // a store nobody named is refused here too.
    io.err(describeDirRefusal(err));
    return EXIT.refused;
  }

  const today = new Date().toISOString().slice(0, 10);
  let store: Store | null = null;
  try {
    if (storeExists(dir)) store = Store.open({ dir, observer: true });
    const findings = doctorFindings({
      configPath,
      configReason: reason,
      config,
      dir,
      credentials,
      credentialsPath,
      shellNames,
      store,
      today,
      refusals: spawnRefusalCounters(store),
      // WHICH CHECKOUT THIS CONSOLE IS RUNNING. From a worktree it grades the
      // worktree, which is the right answer for a command somebody typed; the
      // hook grades the tree the host invokes by absolute path, which is the
      // one that is live on the owner's memory.
      checkout: checkout ?? readCheckout(),
    });
    if (parsed.flags["json"] === true) {
      io.out(JSON.stringify(reportJson(findings, today), null, 2));
    } else {
      for (const line of reportLines(findings, today)) io.out(line);
    }
    return anyRed(findings) ? DOCTOR_RED_EXIT : EXIT.ok;
  } finally {
    store?.close();
  }
}

/**
 * `credentials set <NAME>` and `credentials list` — the repair I32 did not have.
 *
 * The rule that shapes every line of it: **the value never appears anywhere a
 * value can be read back.** Not in argv (argv is shell history, and a key in
 * shell history is a key on disk in plaintext forever), not in the output, not
 * in an error. It arrives on stdin or out of one named environment variable,
 * goes into the file at 0600, and the console says one sentence naming the NAME
 * and the PATH.
 *
 * **Why the bulk-write `--dir` rule does not apply here.** That rule
 * (`requireDirFlagForBulkWrite`) is about a command that rewrites a STORE nobody
 * named. This one opens no store; it writes one line into the credentials file
 * the CONFIGURATION names — so the guard that applies is the configuration one,
 * and `run()` applies it: with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed, an
 * UNNAMED configuration is refused before this function is reached, exactly as
 * it is for `install`.
 */
async function credentialsCommand(
  parsed: Parsed,
  io: Io,
  env: Record<string, string | undefined>,
  named?: ConfigChoice,
  stdin?: { isTty: boolean; read: () => Promise<string> },
): Promise<number> {
  const configPath = named?.path ?? defaultConfigPath();
  const { config } = hostConfigFor(configPath);
  const path = credentialsPathFor(configPath, config);
  const allowed = CREDENTIAL_NAMES.join(", ");
  const sub = parsed.positional[0];

  if (sub === "list") {
    io.out(`credentials: ${path}`);
    if (!existsSync(path)) {
      io.out("  (no such file — counterparts credentials set <NAME> creates it, 0600)");
      return EXIT.ok;
    }
    // NAMES ONLY, from the loader's own reading of the file (`credentialsHeld`
    // runs it against a scratch environment, so what it returns is what the FILE
    // answers — never what this shell happens to export).
    const held = credentialsHeld(path);
    for (const name of CREDENTIAL_NAMES) {
      io.out(`  ${name.padEnd(20)} ${held.includes(name) ? "present" : "missing"}`);
    }
    return EXIT.ok;
  }

  if (sub !== "set") {
    io.err(
      `refused: 'credentials' takes 'set <NAME>' or 'list'${sub === undefined ? ", and neither was given" : `, not '${sub}'`}.`,
    );
    return EXIT.usage;
  }

  const name = parsed.positional[1];
  if (name === undefined || !CREDENTIAL_NAMES.includes(name)) {
    io.err(
      `refused: ${name === undefined ? "no name was given" : `'${name}' is not a credential this package reads`}. The names are: ${allowed}.`,
    );
    io.err("Nothing was written.");
    return EXIT.usage;
  }

  const fromEnv = typeof parsed.flags["from-env"] === "string" ? parsed.flags["from-env"] : null;
  let raw: string;
  if (fromEnv !== null) {
    const value = env[fromEnv];
    if (value === undefined) {
      io.err(`refused: $${fromEnv} is not set in this environment. Nothing was written.`);
      return EXIT.refused;
    }
    raw = value;
  } else {
    if (stdin === undefined) {
      io.err(
        `refused: no standard input to read ${name} from. Pipe the value in, or use --from-env <VAR>.`,
      );
      return EXIT.usage;
    }
    if (stdin.isTty && parsed.flags["stdin"] !== true) {
      // A terminal with nothing piped into it would BLOCK, and a console that
      // hangs waiting for a secret is a console people Ctrl-C before typing the
      // key on the command line instead.
      io.err(
        `refused: stdin is a terminal. Pipe the value in (printf '%s' "$KEY" | counterparts credentials set ${name}), use --from-env <VAR>, or pass --stdin to type it here.`,
      );
      return EXIT.usage;
    }
    raw = await stdin.read();
  }

  // ONE trailing newline is the shell's, not the owner's: `printf '%s\n'`, a
  // here-string and an editor all add one. The rest is trimmed for the same
  // reason `loadCredentials` trims what it reads back — the writer and the
  // reader must agree about what the value IS.
  const value = raw.replace(/\r?\n$/, "").trim();
  if (value.length === 0) {
    io.err(`refused: the value for ${name} is empty. Nothing was written.`);
    return EXIT.refused;
  }
  if (value.includes("\n") || value.includes("\r")) {
    // A value with a newline in it would mint a SECOND line in the file, which
    // the loader reads as a malformed entry and counts — silently.
    io.err(`refused: the value for ${name} spans more than one line. Nothing was written.`);
    return EXIT.refused;
  }

  writeCredential(path, name, value);
  io.out(`set ${name} in ${path}`);
  return EXIT.ok;
}

/**
 * Write one name into the credentials file, keeping every other line.
 *
 * Three cases, in order: an ACTIVE line for this name is replaced where it
 * stands; else the template's own COMMENTED placeholder (`# NAME=...`) becomes
 * the real line — placed AFTER the indented comment lines that continue it, so
 * the explanation still sits above the line it explains; else the line is
 * appended. Every other line — every comment, the other name, anything the
 * owner added — is preserved byte for byte.
 *
 * **Written to a sibling and RENAMED over the target, never truncated in
 * place.** `writeFileSync` on the target opens it `O_TRUNC`: a crash, a full
 * disk or a kill between the truncate and the write leaves a file that exists
 * and is EMPTY — which is I32's own shape (the credentials file was empty from
 * 09-04, the worker refused `NO_CREDENTIAL` at every boundary for a week, and
 * every surface read healthy). `rename` is atomic on one filesystem, so a reader
 * sees the old file or the new one and never a zero-length one. The mode is set
 * on the TEMP file — `writeFileSync`'s `mode` applies only when a file is
 * created, so writing straight over an existing 0644 file would have held the
 * secret at 0644 until the `chmod` after it — and rename carries the bits with
 * the inode. The final `chmodSync` then holds the promise for the case where
 * the temp file already existed with looser bits.
 */
function writeCredential(path: string, name: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const line = `${name}=${value}`;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    /* absent is ordinary: this command is how the file comes to exist */
  }
  // The names are `CREDENTIAL_NAMES` members, so there is nothing to escape.
  const active = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  const commented = new RegExp(`^\\s*#\\s*(export\\s+)?${name}\\s*=`);
  const out = text.length === 0 ? [] : text.split("\n");
  let replaced = false;
  for (let i = 0; i < out.length; i += 1) {
    if (active.test(out[i] ?? "")) {
      out[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    for (let i = 0; i < out.length; i += 1) {
      if (commented.test(out[i] ?? "")) {
        // The placeholder OWNS the indented comment lines under it ("#" then
        // four or more spaces — the template's own continuation shape). Putting
        // the live line where the placeholder stood left them dangling under a
        // secret, reading as if they explained it; the line goes after them
        // instead, so `# NAME=... what it is / # <indent> why` stays a block.
        let end = i;
        while (/^#\s{4,}\S/.test(out[end + 1] ?? "")) end += 1;
        out.splice(i, 1);
        out.splice(end, 0, line);
        replaced = true;
        break;
      }
    }
  }
  if (!replaced) {
    while (out.length > 0 && (out[out.length - 1] ?? "").trim().length === 0) out.pop();
    out.push(line);
    out.push("");
  }
  // Sibling, then rename: see the note above — the target is never observed
  // truncated, and the secret is never on disk at anything but 0600.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, out.join("\n"), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}
