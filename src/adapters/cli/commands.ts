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
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Counterpart } from "../../core/counterpart.js";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
import { TUNABLES } from "../../core/physics/index.js";
import { LANE_ORDER, PREFACE_RESERVE_BYTES } from "../../core/self/index.js";
import {
  LAYOUT,
  Store,
  dataDir,
  storeExists,
} from "../../core/store/index.js";
import type { Band, Kind } from "../../core/types.js";
import { exportStore } from "./export.js";
import { ownerRemoval, planRemoval } from "./removal.js";
import { snapshot, snapshotName } from "./snapshot.js";

export const COMMANDS = [
  "status",
  "init",
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
  "init",
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
}

export function usage(): string {
  return [
    "counterparts — the owner's console for a Counterparts memory store.",
    "",
    "  status              What is held, what left, what was removed. Read-only.",
    "  init                Create a fresh data dir and PRINT the hook install steps.",
    "  export --out <dir>  Portable copy. --passphrase <secret> or --plaintext.",
    "  backup --out <dir>  Snapshot: prose + canonical DB via VACUUM INTO. Cache excluded.",
    "  remove <id>         The loud removal. Dry run unless --confirm.",
    "  verify              Rebuild the cache from canonical state and report.",
    "  backfill-claims     Give unclaimed AUTHORED memories the default claimed",
    "                      floor. Dry run unless --apply.",
    "  rebrief             Re-render and republish the wake bundle NOW, through the",
    "                      boundary's own renderer. Advances no sleep marker and runs",
    "                      no other sleep phase. --budget <bytes> overrides the host",
    "                      ceiling read from <dir>/claude-code.json.",
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
      apply: { type: "boolean" },
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

  if (parsed.command === undefined || parsed.flags["help"] === true) {
    io.out(usage());
    return parsed.command === undefined ? EXIT.usage : EXIT.ok;
  }
  if (!(COMMANDS as readonly string[]).includes(parsed.command)) {
    io.err(`unknown command: ${parsed.command}`);
    io.out(usage());
    return EXIT.usage;
  }
  const command = parsed.command as Command;

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
        return initCommand(dir, io);
      case "verify":
        return verifyCommand(dir, io);
      case "backup":
        return await backupCommand(dir, io, parsed.flags["out"], now);
      case "export":
        return exportCommand(dir, io, parsed.flags);
      case "remove":
        return await removeCommand(dir, io, parsed.positional[0], parsed.flags, now);
      case "backfill-claims":
        return backfillClaimsCommand(dir, io, parsed.flags["apply"] === true);
      case "rebrief":
        return rebriefCommand(dir, io, parsed.flags["budget"], now);
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
    let live = 0;
    let archived = 0;
    let superseded = 0;

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
      live += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      byBand[row.band] = (byBand[row.band] ?? 0) + 1;
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
    io.out(`Live memories: ${live}   archived: ${archived}   superseded: ${superseded}`);
    io.out(`  by kind: ${kinds.map((k) => `${k} ${byKind[k] ?? 0}`).join("  ")}`);
    io.out(`  by band: ${bands.map((b) => `${b} ${byBand[b] ?? 0}`).join("  ")}`);
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
function initCommand(dir: string, io: Io): number {
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

  io.out(existed ? `Store already present at ${resolved}.` : `Created a store at ${resolved}.`);
  io.out("");
  io.out("To install the hooks (not done for you — these edit your host's settings):");
  io.out("");
  io.out("  1. Point the host at the hook entry script for every session-ending event:");
  io.out("       SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact");
  io.out("       command: bun run <repo>/src/adapters/claude-code/bin/hook.ts");
  io.out("  2. Register the MCP server so the Stop ask has a way back:");
  io.out("       command: bun run <repo>/src/adapters/mcp/bin/serve.ts --session <id>");
  io.out("  3. Write the adapter's configuration BESIDE the store, never inside it — the");
  io.out("     layout check refuses an unclassified file in the data dir (§5 G11):");
  io.out(`       ${join(resolved, "..", "claude-code.json")}`);
  io.out('       { "dataDir": "<this dir>", "injectionBudgetBytes": <your host\'s ceiling> }');
  io.out("");
  io.out("The injection ceiling has NO default anywhere in this package: a briefing");
  io.out("refuses to render rather than compose to a number nobody chose (scar §2.18).");
  return EXIT.ok;
}

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * Rebuild box 3 from canonical state and report. The database is a cache: if
 * this ever loses something canonical, the claim was false and the report is
 * where it shows. What cannot be recomputed is DECLARED, with an owner and a
 * repair, rather than silently missing (§5 G8).
 */
function verifyCommand(dir: string, io: Io): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const store = Store.open({ dir });
  try {
    const canonical = store.list().length;
    const report = store.rebuildCache();
    io.out(`Canonical rows: ${canonical}`);
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
  for (const name of plan.unchasable) {
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
): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const ceiling = hostCeiling(dir, budgetFlag);
  if (typeof ceiling === "string") {
    io.err(ceiling);
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
    io.out(
      `  ceiling ${ceiling.bytes} bytes (${ceiling.source}); composed under ${report.composeBudget}` +
        ` — the delivery preface reserves ${PREFACE_RESERVE_BYTES}`,
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

/** The host's reported injection ceiling, or the sentence explaining its absence. */
function hostCeiling(
  dir: string,
  flag: string | boolean | undefined,
): { bytes: number; source: string } | string {
  if (typeof flag === "string" && flag.length > 0) {
    const n = Number(flag);
    if (!Number.isInteger(n) || n <= 0) {
      return `refused: --budget takes a positive whole number of bytes, not '${flag}'.`;
    }
    return { bytes: n, source: "--budget" };
  }
  // BESIDE the store, never inside it: the layout totality check (§5 G11)
  // refuses an unclassified file in the data dir, which is why the deployed
  // config sits at `~/.counterparts/claude-code.json` with `dataDir` pointing
  // at a subdirectory (measured 2026-09-03).
  const path = join(dir, "..", "claude-code.json");
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const value = parsed["injectionBudgetBytes"];
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return { bytes: value, source: path };
      }
    } catch {
      /* an unreadable host config reports no ceiling — the refusal below says so */
    }
  }
  // Scar §2.18: the ceiling is a host capability. There is no default anywhere
  // in this package and this command does not become the place there is one.
  return (
    "refused: no injection ceiling. Pass --budget <bytes>, or set " +
    `"injectionBudgetBytes" in ${path}. A briefing never invents one (scar §2.18).`
  );
}

/** Exported for the caller-universality test: the console composes a brain the
 *  same way every other adapter does, and never re-wires the modules. */
export function openCounterpart(dir: string, observer = false): Counterpart {
  return Counterpart.open({ dir, observer });
}
