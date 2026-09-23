/**
 * `doctor` — the one reading that says out loud whether the BACKGROUND half is
 * alive.
 *
 * **The incident this answers (I32, 2026-09-11).** For a week the detached
 * worker was refused at every boundary — `~/.counterparts/credentials.env` had
 * been rewritten to the template by a forced install, so `planSpawn` answered
 * `NO_CREDENTIAL` every time. Every VISIBLE surface read healthy: the wake
 * delivered, recall rendered, capture captured, `verify` was clean, the daily
 * graded the day ACTIVE. Meanwhile the lived-day clock was frozen at 185, no
 * sleep cycle had run since 09-04, every ask was `capped` against a day that
 * never rolled over, and nothing had been embedded. The owner learned it from a
 * session that went looking.
 *
 * #95 made the refusals durable and persisted the escalation counter — the
 * evidence exists now. This module is the READER of that evidence, and it exists
 * once so the console and the session-start notice cannot disagree about what
 * "healthy" means (constitution 16: if the owner can't see it, it isn't
 * trustworthy).
 *
 * Three rules shape it:
 *
 *   1. **It reads and never writes.** Every store call below is a read; the
 *      caller supplies an OBSERVER store or one that is already open. Nothing
 *      here opens a database, mints a directory or touches box 3.
 *   2. **Names and counts, never values.** A credential is reported by NAME and
 *      by the mode of the file that holds it. Never a value, never a length,
 *      never a prefix. The same rule `credentials.ts` states for itself.
 *   3. **It is on the hot path, so it is bounded.** `sessionNoticeBudgetMs`
 *      bounds the whole reading at session start, checked BETWEEN groups; what
 *      the budget cut off is reported as a finding rather than silently
 *      omitted (scar §2.4 — a door that did not open must not look like a door
 *      nobody needed).
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  EMBED_BACKFILL_EVENT,
  GATE_CHUNK_EVENT,
  GATE_DEPOSIT_EVENT,
  RECALL_CREDIT_EVENT,
  RUNNER_FAILED_EVENT,
  SLEEP_CYCLE_EVENT,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SWEEP_GATE_EVENT,
} from "../../core/counterpart.js";
import { Counterpart } from "../../core/counterpart.js";
import { STORE_CREATED_KEY, Store, dateOf, isStoreError, paths } from "../../core/store/index.js";
import { BUSY_TIMEOUT_MS, journalModeOf } from "../../core/store/db.js";
import type { EventRow } from "../../core/store/index.js";
// The ask allowance the amber hint names, read rather than retyped: a number in
// a diagnostic's prose is a number that goes stale silently.
import { SELF_TUNABLES } from "../../core/self/tunables.js";
// The page's own reader, so this line cannot drift from what the wake prints.
import { clearedMarker, findPageRow, readSelfPage } from "../../core/self/page.js";
import {
  JOURNAL_COPY_FAILED_EVENT,
  JOURNAL_COPY_WRITTEN_EVENT,
} from "../../core/self/journal-file.js";
import {
  hasDayBefore,
  lastPageWriterRun,
  pageWriterAbout,
  pageWriterDue,
  pageWriterStatus,
} from "../../core/self/writer.js";
import type { AskReason } from "../../core/self/episodes.js";
// The what-fired reading, shared with the console's `fired` command and the
// dashboard's health panel so the three cannot disagree about what "silent"
// means (constitution 16, the same rule this module already keeps for "healthy").
import { STATE_MEANING, YOUNG_LIVED_DAYS, daysBetween, firedReport } from "../fired.js";
// The one name the "no configuration was read" line needs, from the module that
// owns it — so the sentence here and the refusal it replaced name the same var.
import { CONFIG_ENV } from "../config-path.js";
import {
  DEFAULT_KEEP,
  futureNamesIn,
  keepOf,
  readSnapshotsDir,
  resolveSnapshotsDir,
} from "../snapshots.js";
import { API_KEY_ENV, EMBED_KEY_ENV, TUNABLES, pageWriterMode } from "./config.js";
import type { AdapterConfig } from "./config.js";
import { CREDENTIAL_NAMES } from "./credentials.js";
import type { CredentialLoad } from "./credentials.js";
// The same vocabulary the hook's stand-down uses, so the terminal and the
// console cannot end up with two answers to "why did it not open".
import { describeFault, faultId, faultPath } from "./standdown.js";

/** Worst first. The order of this array IS the report's order. */
export const SEVERITIES = ["red", "amber", "green"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  /** Stable machine name — the `--json` key and the notice's identity. */
  readonly key: string;
  readonly severity: Severity;
  /** The column heading a human reads: "Credentials", "Clock". */
  readonly title: string;
  /** One line of FACTS: paths, names, counts, dates. Never memory text. */
  readonly detail: string;
  /** One line naming the fix. Empty only when there is nothing to fix. */
  readonly fix: string;
  /** Ids and counts, for `--json`. Never a credential value, never prose. */
  readonly data: Record<string, string | number | boolean | null>;
  /**
   * AN OPTIONAL FEATURE THAT WAS NEVER TURNED ON — printed `OFF`, dim, and
   * counted apart from the ambers (new-user findings #24, owner's answer 12 of
   * 2026-09-22). One skipped Voyage key used to produce three ambers on a
   * fresh install — Embedder off, Credentials missing, Vectors unembedded —
   * and a screen where nothing is wrong should not carry three warnings.
   *
   * IT IS A FLAG ON AMBER, NOT A FOURTH `Severity`, and that is the whole
   * reason the JSON keeps `severity: "amber"`: every reader that switches on a
   * severity — the hook's notice, the dashboard, a script of the owner's —
   * still sees the three words it has always seen, and one that wants the new
   * distinction reads one new boolean. What DOES move is where the line sorts
   * and how it is counted, both of which live in this file (`worstFirst`,
   * `reportLines`, `reportJson`) and nowhere else.
   *
   * NEVER on a feature that WAS working and has stopped: that is the red
   * `keyHistory` exists for, and it is untouched.
   */
  readonly optional?: boolean;
}

/**
 * How long the session-start reading may take before it stops and says so.
 *
 * 150 ms is the credit seam's own budget (`CreditReferencesInput.deadline`),
 * chosen for the same reason: this runs inside a foreground hook, and a hook
 * that costs the owner a visible pause has made the cure worse than the disease.
 * The console passes no budget at all — a person who typed `counterparts
 * doctor` is waiting on purpose.
 */
export const SESSION_NOTICE_BUDGET_MS = 150;

/**
 * How many lived days back the newest-row search widens through.
 *
 * `Store.eventLog` orders ASCENDING and takes a LIMIT, so "the newest row of
 * this name" is not a query it offers (filed as an ask in `cli/INTERFACE-GAPS`).
 * The reading below is exact rather than approximate: a window whose result is
 * SHORTER than the limit was not truncated, so its last row is provably the
 * newest in that window. The ladder starts at today so the common case reads
 * the fewest rows, and widens only when a window is empty.
 */
const WINDOWS: readonly (number | null)[] = [0, 2, 7, 30, null];
const NEWEST_LIMIT = 4000;

export interface DoctorInput {
  /** The host configuration file this reading is about. */
  readonly configPath: string;
  /**
   * How `loadConfig` read that file, when the caller knows. The hook resolves
   * and REFUSES a bad one before it gets here (`bin/hook.ts`), so it passes
   * null and the config finding reports only what the file named.
   */
  /**
   * `not-read` (2026-09-20, finding 6) is `--dir` with no `--config` under the
   * explicit-dir guard: the store was NAMED, so it is read, and the default
   * configuration beside it was not opened at all — because opening it is what
   * would reach the owner's live credentials file. Everything that comes out of
   * a configuration then says so instead of grading a file nobody read.
   */
  readonly configReason: "loaded" | "absent" | "unreadable" | "not-read" | null;
  readonly config: AdapterConfig;
  /** The store this reading actually read. */
  readonly dir: string;
  /**
   * The credential load to REPORT ON, and the two callers hand in different
   * ones on purpose:
   *
   *   - The **console** loads the file against a SCRATCH environment, so what
   *     it reports is what the FILE holds. A console that counted its own shell
   *     would read green on the owner's machine — his `~/.zshrc` exports both
   *     names — while the hook processes, which inherit neither (measured day 0),
   *     stayed blind. That is I32 reproduced inside the diagnostic.
   *   - The **hook** hands in the load it already performed against its own
   *     `process.env` — and that is ALSO a reading of the file, which is what
   *     makes the two agree. `loadCredentials` pushes a name onto `loaded` or
   *     onto `skippedPresent` only when the FILE holds a line for it
   *     (`skippedPresent` means "the file offered this and the environment had
   *     already answered it"), so a template file answers nothing whatever the
   *     environment carries, and a hook launched from a shell that exports both
   *     keys still goes red on a blank file. Asserted in `test/doctor.test.ts`,
   *     because the whole PR turns on it.
   */
  readonly credentials: CredentialLoad;
  readonly credentialsPath: string | undefined;
  /**
   * Names the CALLER's environment answers, when the caller is the console.
   * Reported as one extra clause on the finding for THAT NAME when the file
   * lacks it — "I have that key" and "the hooks have that key" are two different
   * facts, and the gap between them is what made I32 invisible.
   */
  readonly shellNames?: readonly string[];
  /** Null when there is no store at `dir` — the store findings then say so. */
  readonly store: Store | null;
  /** Today, UTC, `YYYY-MM-DD` — the same spelling every `date` field uses. */
  readonly today: string;
  /**
   * The persisted spawn-refusal counters, `reason -> count`
   * (`adapter.spawn.refusals.<reason>` in box 2's meta).
   *
   * An INPUT rather than a read taken here, because the two callers reach them
   * differently: the adapter has `spawnRefusals()`, which also answers for an
   * observer out of its in-memory map, and the console reads the meta prefix off
   * the store. The THRESHOLD and the wording — the part that could drift — live
   * here and only here.
   */
  readonly refusals: Record<string, number>;
  /**
   * HOW MANY TIMES THE WORKER STARTED TODAY, and the date that tally is for.
   *
   * An INPUT for the same reason `refusals` is: the counter lives in the
   * adapter's own meta keys, `hooks.ts` already imports this file, and a read
   * taken here would make that a cycle. `adapter.spawn.started` is latched one
   * row per calendar date, so the ROW proves the door opened and this is the
   * only thing that says how often -- which is why the row carries no tally of
   * its own. A date that is not today is ignored rather than printed: a counter
   * stamped with yesterday answers nothing about today.
   */
  readonly starts?: { date: string | null; count: number };
  /**
   * WHICH CHECKOUT IS RUNNING (see `readCheckout`). Absent: not graded, and no
   * finding is produced at all.
   */
  readonly checkout?: CheckoutReading;
  /**
   * WHETHER THE STORE OPENS THE WAY A SESSION OPENS IT (see `readCounterpartOpen`).
   * Absent: not read, and no finding is produced at all — which is the hook's
   * case, whose counterpart is already open by the time it asks for a notice.
   */
  readonly open?: OpenReading;
  /**
   * WHETHER THE TWO STEPS THE USER DOES BY HAND ACTUALLY TOOK (finding 4).
   * Absent: not read, and no finding is produced at all — the hook's case, which
   * is already running BECAUSE the hooks are installed and has no budget for
   * four more file reads.
   */
  readonly host?: HostReading;
  /** Bound the whole reading. Absent: no bound (the console's case). */
  readonly budgetMs?: number;
  readonly now?: () => number;
}

// ── which checkout is running ───────────────────────────────────────────────

export interface CheckoutReading {
  /**
   * WHAT IS DEPLOYED, graded against the LOCAL `refs/remotes/origin/master` as
   * last fetched — never against the local `master` branch, and never by
   * fetching (this runs on a hook's hot path).
   *
   * The case that set the rule, measured 2026-09-14: a merge to origin/master
   * does NOT deploy. The install tree sat DETACHED at an older sha for thirty
   * minutes after a merge, and every hook in that window ran the old code while
   * "it's merged" was true.
   *
   *   - `master` — HEAD IS origin/master, on a branch or detached. Detached at
   *     origin/master is the intended deploy state, not a fault.
   *   - `behind` — HEAD is an ancestor of origin/master: master moved and this
   *     tree did not. Amber; the code that runs is old but it is merged code.
   *   - `branch` / `detached` — HEAD is NOT an ancestor of origin/master, so
   *     unmerged code is live. Red.
   *   - `dirty` — tracked modifications, wherever HEAD sits. Red.
   *   - `not-a-repo` — an installed package. Nothing to grade.
   *   - `unreadable` — git did not answer, or there is no `origin/master` ref to
   *     grade against. Neutral, and no durable row.
   */
  readonly reason: "master" | "behind" | "branch" | "dirty" | "detached" | "not-a-repo" | "unreadable";
  /** The directory graded. Empty when there was nothing to grade. */
  readonly root: string;
  readonly branch: string | null;
  /** Short sha, or null on an empty repository. */
  readonly head: string | null;
  /** TRACKED modifications only. */
  readonly dirty: number;
  /** How many commits origin/master is ahead, when HEAD is an ancestor of it. */
  readonly behindBy: number | null;
  /** The short sha of `refs/remotes/origin/master`, as last fetched. */
  readonly originMaster: string | null;
  /** True when HEAD IS origin/master — the deploy state, branch or not. */
  readonly atMaster: boolean;
  /**
   * True when the reading ran out of `CHECKOUT_BUDGET_MS` (or one call timed
   * out), which forces `reason` to `unreadable`. It is its own field because the
   * ring row distinguishes "git would not answer" from "git was too slow", and
   * only the second one says something about the machine.
   */
  readonly timedOut: boolean;
}

/**
 * THE PACKAGE ROOT OF THE CODE THAT IS RUNNING — derived from this module's own
 * path and from nothing else.
 *
 * It must not come from a configuration value, and the reason is the whole
 * point of the finding. The host invokes the hook by ABSOLUTE PATH out of
 * `~/.claude/settings.json`, so on the live machine that path resolves to the
 * shared install tree — which is exactly the tree that has to be graded, because
 * whatever is checked out there is what runs against the owner's memory. (It
 * happened: a peer session developed a branch in that checkout and it was live
 * for seven minutes.) A console run from a worktree resolves to the WORKTREE and
 * grades that, which is the right answer for a command somebody typed there.
 */
function runningRoot(from: string = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** What one bounded `git` call answered. `failed` separates "git said no" from
 *  "git never answered", which are different findings. */
interface GitResult {
  readonly ok: boolean;
  readonly out: string;
  readonly failed: "missing" | "timeout" | "status" | null;
}

export type GitRunner = (args: readonly string[]) => GitResult;

/** The ceiling on ONE `git` call. Never the reading's cost: seven calls at two
 *  seconds is fourteen seconds, which is what the reviewer measured against a
 *  sleeping git shim (7.81 s) before `CHECKOUT_BUDGET_MS` existed. The budget
 *  below is what actually bounds the reading; this is the per-call cap it
 *  narrows. */
export const CHECKOUT_TIMEOUT_MS = 2000;

/**
 * THE WHOLE READING'S BUDGET — one second, and the reason it is not 150 ms.
 *
 * `readCheckout` runs BEFORE `doctorFindings`, whose own deadline starts when it
 * is entered, so the git reads were outside every budget this adapter had: up to
 * seven `spawnSync` calls, each free to take `CHECKOUT_TIMEOUT_MS`. A wedged git
 * — a network filesystem, an index.lock, a fresh cold cache — could hold a
 * foreground session start for fourteen seconds.
 *
 * It is its OWN budget rather than a share of `SESSION_NOTICE_BUDGET_MS`
 * because the two measure different things. 150 ms is right for reading a store
 * that is already open; five process spawns on a cold machine can exceed that on
 * their own, and a checkout reading that timed out every morning would report
 * `unreadable` on exactly the days the tree HAS wandered — the days the finding
 * exists for. One second is the number that is long enough to be read and short
 * enough that nobody notices it. Total worst case at session start:
 * `CHECKOUT_BUDGET_MS` + `SESSION_NOTICE_BUDGET_MS` ≈ 1.15 s.
 */
export const CHECKOUT_BUDGET_MS = 1000;

function gitIn(root: string, remainingMs: () => number, env: NodeJS.ProcessEnv): GitRunner {
  return (args: readonly string[]): GitResult => {
    const res = spawnSync("git", ["-C", root, ...args], {
      timeout: remainingMs(),
      encoding: "utf8",
      windowsHide: true,
      // The environment is passed rather than inherited by default for one
      // reason: under bun a `spawnSync` with no `env` resolves the binary against
      // the REAL environment, so a test cannot put a slow `git` on `PATH` and
      // prove the budget against a spawn that actually blocks. Passing
      // `process.env` is what inheriting already meant.
      env,
    });
    if (res.error !== undefined && res.error !== null) {
      const code = (res.error as NodeJS.ErrnoException).code ?? "";
      return { ok: false, out: "", failed: code === "ETIMEDOUT" ? "timeout" : "missing" };
    }
    if (res.signal !== null && res.signal !== undefined) return { ok: false, out: "", failed: "timeout" };
    if (res.status !== 0) return { ok: false, out: String(res.stdout ?? ""), failed: "status" };
    return { ok: true, out: String(res.stdout ?? ""), failed: null };
  };
}

/**
 * Which branch the RUNNING code is on, and whether its tree is clean.
 *
 * Read-only, bounded, and it never throws: every git call is `spawnSync` with a
 * timeout, and a git that is missing, slow or angry resolves to `unreadable`
 * rather than to an exception on a hook's hot path.
 *
 * `dirty` counts TRACKED changes only (`--untracked-files=no`), because the
 * shared tree carries untracked files by design — a working `docs/IMPROVEMENTS.md`,
 * `.claude/worktrees/` — and neither changes what runs.
 */
export const ORIGIN_MASTER = "refs/remotes/origin/master";

export function readCheckout(
  opts: {
    root?: string | null;
    git?: GitRunner;
    timeoutMs?: number;
    budgetMs?: number;
    /** Injectable clock, so the budget is provable without waiting for it. */
    now?: () => number;
    /** The environment the `git` calls run in; injectable so a test can put a
     *  slow `git` on `PATH` and measure the real spawn path. */
    env?: NodeJS.ProcessEnv;
  } = {},
): CheckoutReading {
  const root = opts.root === undefined ? runningRoot() : opts.root;
  const none = {
    branch: null,
    head: null,
    dirty: 0,
    behindBy: null,
    originMaster: null,
    atMaster: false,
    timedOut: false,
  };
  if (root === null) return { reason: "not-a-repo", root: "", ...none };
  // THE BUDGET, spent across every call rather than per call. Each git gets what
  // is LEFT of it (capped at `CHECKOUT_TIMEOUT_MS`), and once it is gone no
  // further call is made at all — a reading that has run out of time is
  // `unreadable`, which is a state this adapter already knows how to say.
  const now = opts.now ?? ((): number => Date.now());
  const ceiling = opts.timeoutMs ?? CHECKOUT_TIMEOUT_MS;
  const deadline = now() + (opts.budgetMs ?? CHECKOUT_BUDGET_MS);
  let timedOut = false;
  const run =
    opts.git ?? gitIn(root, () => Math.max(1, Math.min(ceiling, deadline - now())), opts.env ?? process.env);
  const git: GitRunner = (args) => {
    if (timedOut || now() >= deadline) {
      timedOut = true;
      return { ok: false, out: "", failed: "timeout" };
    }
    const res = run(args);
    if (res.failed === "timeout") timedOut = true;
    return res;
  };

  const gitDir = git(["rev-parse", "--git-dir"]);
  if (!gitDir.ok) {
    // `status` is git answering "this is not a repository" — an installed
    // package, and nothing to grade. Anything else is git not answering at all.
    return {
      reason: gitDir.failed === "status" ? "not-a-repo" : "unreadable",
      root,
      ...none,
      timedOut,
    };
  }
  const ref = git(["symbolic-ref", "-q", "--short", "HEAD"]);
  const branch = ref.ok && ref.out.trim().length > 0 ? ref.out.trim() : null;
  const headRead = git(["rev-parse", "--short", "HEAD"]);
  const head = headRead.ok && headRead.out.trim().length > 0 ? headRead.out.trim() : null;
  const statusRead = git(["status", "--porcelain", "--untracked-files=no"]);
  const dirty = statusRead.ok
    ? statusRead.out.split("\n").filter((l) => l.trim().length > 0).length
    : 0;
  // THE REF THAT DECIDES, read as last fetched. Fetching here would put a
  // network call on a foreground hook, which is the one thing the wake's own
  // contract forbids (§1 G1).
  const originRead = git(["rev-parse", "--short", ORIGIN_MASTER]);
  const originMaster = originRead.ok && originRead.out.trim().length > 0 ? originRead.out.trim() : null;
  if (originMaster === null || head === null) {
    // A repository with no `origin/master` (a clone with no remote, a fresh
    // init) has nothing to grade against, and an empty repository has no HEAD.
    // Neutral, and no durable row: "we could not grade it" is not a state of
    // the checkout.
    return { reason: "unreadable", root, branch, head, dirty, behindBy: null, originMaster, atMaster: false, timedOut };
  }
  const atMaster = head === originMaster;
  const ancestor = atMaster || git(["merge-base", "--is-ancestor", "HEAD", ORIGIN_MASTER]).ok;
  const countRead = ancestor && !atMaster ? git(["rev-list", "--count", `HEAD..${ORIGIN_MASTER}`]) : null;
  const behindBy =
    countRead !== null && countRead.ok ? (Number.parseInt(countRead.out.trim(), 10) || 0) : null;

  // A reading that ran out of time is not a grade. Half the calls answered and
  // half returned nothing, and "clean at origin/master" assembled out of
  // silence is the one wrong answer this finding may not give.
  if (timedOut) {
    return { reason: "unreadable", root, branch, head, dirty, behindBy, originMaster, atMaster, timedOut };
  }

  // ORDER IS THE GRADE. Tracked modifications are red wherever HEAD sits — they
  // are code that is in no branch at all. Then: at origin/master is the deploy
  // state; an ancestor of it is old-but-merged; anything else is unmerged code
  // running against the owner's memory.
  const reason: CheckoutReading["reason"] =
    dirty > 0
      ? "dirty"
      : atMaster
        ? "master"
        : ancestor
          ? "behind"
          : branch === null
            ? "detached"
            : "branch";
  return { reason, root, branch, head, dirty, behindBy, originMaster, atMaster, timedOut };
}

/** True when this reading is one the adapter records a durable row for. A
 *  package that is not a checkout, and a git that would not answer, are not
 *  states of the checkout and leave nothing behind. */
export function checkoutIsGraded(reading: CheckoutReading): boolean {
  return reading.reason !== "not-a-repo" && reading.reason !== "unreadable";
}

// ── will it open the way a session opens it ─────────────────────────────────

/**
 * WHETHER `Counterpart.open` SUCCEEDS — which is a different question from the
 * one the `Store` finding above answers, and the difference is the whole of H1.
 *
 * The `Store` finding reads the DIRECTORY: is there a store here, and is it the
 * one the config names. A store can pass that and still throw at every session
 * start, because opening a counterpart does more than open a database —
 * `Schemas.open` scans every `type: "schema"` row and reads each one's prose
 * file. One missing file, or one row a removal left behind, and every hook in
 * every session stands down: no wake, no recall, no capture, and until now
 * nothing said so while `doctor` printed GREEN Store on the line above.
 *
 * READ BY THE CALLER, like `readCheckout` — and for the same reason it is not
 * taken inside `doctorFindings`, which is pure over its input and never opens
 * anything. The session-start reading does not take it at all: a hook that got
 * as far as composing a notice has ALREADY opened its counterpart, so paying for
 * a second open there would buy a fact it has in hand.
 */
export interface OpenReading {
  readonly dir: string;
  readonly ok: boolean;
  /** The `StoreErrorCode` (or `HOOK_FAILED`) that came back. Null when it opened. */
  readonly code: string | null;
  /** Plain words for `code` (`standdown.ts`). Empty when it opened. */
  readonly reason: string;
  /**
   * TRUE for the one refusal that is not a fault: `STORE_UNINITIALIZED`, which
   * an OBSERVER gets on a store that does not exist yet or is a schema behind.
   * The hooks run as OWNER and initialize or migrate it, so grading this red
   * would make the console lie for the window between a deploy and the first
   * hook that follows it.
   */
  readonly migratable: boolean;
  /**
   * TRUE for the other refusal that is not a fault of the store: it was BUSY.
   * Another process held it for the moment this reading wanted it, which says
   * nothing about whether a session could open it a second later. Amber, and the
   * fix is to ask again — the same judgement the hook's transient stand-down
   * makes with the same predicate (`db.ts#isLocked`).
   */
  readonly busy: boolean;
  /** The path the error named, when it named one. Never memory text (§5 G10). */
  readonly path: string | null;
  /** The ROW the error named, when it named one — an id, never memory text.
   *  `MEMORY_BODY_MISSING` carries one and no path, because on this floor the
   *  words are the row and there is no file to restore (review B, MAJOR-3). */
  readonly id: string | null;
}

/**
 * "Writes nothing" here means NO STORE CONTENT. It is an observer open, so no
 * row, no prose file and no meta key changes — but any reader of a WAL database
 * touches the `-shm`, and one that finds no `-shm` or `-wal` beside the file
 * CREATES them, exactly as every other reader does (`store/paths.ts#isDatabaseSidecar`
 * is the same exception master's own suites take when they hash a store and mean
 * "nothing wrote"). Anyone comparing store directories should expect that.
 */
export function readCounterpartOpen(
  dir: string,
  /** Injectable so the failure branches are provable without a broken fixture;
   *  the fixture test is still the one that proves the real path. */
  open: (d: string) => { close: () => void } = (d) => Counterpart.open({ dir: d, observer: true }),
): OpenReading {
  let opened: { close: () => void } | null = null;
  try {
    // OBSERVER, because `doctor` is an instrument: it reads and never writes,
    // and an owner open of a store that is not there would MINT one.
    opened = open(dir);
    return {
      dir,
      ok: true,
      code: null,
      reason: "",
      migratable: false,
      busy: false,
      path: null,
      id: null,
    };
  } catch (err) {
    const fault = describeFault(err);
    return {
      dir,
      ok: false,
      code: fault.code,
      reason: fault.reason,
      migratable: isStoreError(err, "STORE_UNINITIALIZED"),
      busy: fault.kind === "transient",
      path: faultPath(err),
      id: faultId(err),
    };
  } finally {
    // Closed immediately, so this reading and the store the console opens next
    // never hold the same database at once.
    try {
      opened?.close();
    } catch {
      /* a close that failed is not a state of the store */
    }
  }
}

// ── the groups ──────────────────────────────────────────────────────────────

/** A finding, with `data` defaulted so each group below stays one expression. */
function finding(
  key: string,
  severity: Severity,
  title: string,
  detail: string,
  fix: string,
  data: Record<string, string | number | boolean | null> = {},
): Finding {
  return { key, severity, title, detail, fix, data };
}

/**
 * An OFF finding: an optional feature nobody has turned on. Amber underneath
 * (see `Finding.optional`), `OFF` on the screen, and the fix is always the
 * command that turns the thing on — never a JSON edit (finding #19).
 */
function off(
  key: string,
  title: string,
  detail: string,
  fix: string,
  data: Record<string, string | number | boolean | null> = {},
): Finding {
  return { key, severity: "amber", title, detail, fix, data, optional: true };
}

/**
 * A path under the owner's home, written the way he types it (`~/…`).
 *
 * The home directory is read here rather than passed in because every caller
 * already has the same one and threading it would put an environment lookup in
 * `DoctorInput` for a cosmetic. It is COSMETIC on purpose: only `detail` and
 * `fix` are folded this way, never `data`, so `--json` keeps the absolute path
 * a script would act on. A store outside the home is returned unchanged, which
 * is every test's case — the temp directories the suite makes are not under it.
 */
function tilde(path: string): string {
  const home = homedir();
  if (home.length === 0 || path === home) return path === home ? "~" : path;
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * The newest rows of one event name, oldest-first, at most `count` of them —
 * or `unknown`, which is a third answer and not a kind of empty.
 *
 * Exact, not approximate: see `WINDOWS`. A window that came back FULL is
 * discarded rather than trusted — its last row is the newest of the first
 * `NEWEST_LIMIT`, which is not the same claim.
 *
 * THE UNBOUNDED WINDOW IS NOT EXEMPT FROM THAT RULE, and the first round of this
 * PR made it so. Once a name held `NEWEST_LIMIT` rows all older than the widest
 * day window, every bounded window came back full and was skipped, the `null`
 * window came back full too — and it alone was trusted, so `rows.slice(-count)`
 * handed back the 4,000th-OLDEST row as "the newest". A store that swept its
 * last 4,000 sleep cycles and ran fine since would have been read off a row from
 * whenever that prefix ended: a confident wrong answer, which is the one thing a
 * diagnostic may never produce. Unknown says so instead.
 */
interface NewestRead {
  readonly rows: EventRow[];
  readonly unknown: boolean;
}

function newestRows(store: Store, name: string, count: number, livedDay: number): NewestRead {
  for (const back of WINDOWS) {
    const rows = store.eventLog(
      back === null
        ? { name, limit: NEWEST_LIMIT }
        : { name, sinceDay: Math.max(0, livedDay - back), limit: NEWEST_LIMIT },
    );
    if (rows.length === 0) continue;
    if (rows.length >= NEWEST_LIMIT) {
      if (back !== null) continue;
      return { rows: [], unknown: true };
    }
    return { rows: rows.slice(-count), unknown: false };
  }
  return { rows: [], unknown: false };
}

/** The one sentence for a name whose newest row cannot be determined. Neutral:
 *  it names what was not read, and claims nothing about the store. */
function undetermined(name: string): string {
  return (
    `newest ${name} row could not be determined: more than ${NEWEST_LIMIT} rows and no bounded window ` +
    "came back short, so the newest one was not read"
  );
}

function payloadOf(row: EventRow | undefined): Record<string, unknown> {
  if (row === undefined || row.payload === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The CALENDAR date a row is about: its own field, else the wall clock it was
 *  written at. `day` is the lived-day column and answers a different question. */
function rowDate(row: EventRow | undefined): string | null {
  if (row === undefined) return null;
  const p = payloadOf(row);
  return typeof p["date"] === "string" && p["date"].length > 0 ? p["date"] : dateOf(row.at);
}

function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" ? v : null;
}

function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === "string" ? v : null;
}

/**
 * The phases of one `sleep.cycle` row that stopped at their budget, phrased.
 * Read STRUCTURALLY — an older row carries no `budgetExhausted` at all, and a
 * phase that left nothing behind carries no count, so both read as "nothing to
 * say" rather than as a zero anybody could mistake for a measurement.
 */
function budgetTruncatedPhases(p: Record<string, unknown>): string[] {
  const phases = p["phases"];
  if (!Array.isArray(phases)) return [];
  const out: string[] = [];
  for (const entry of phases as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e["budgetExhausted"] !== true) continue;
    const name = str(e, "phase") ?? "a phase";
    const left = num(e, "skippedForBudget");
    out.push(
      left === null
        ? `${name} ran out of budget`
        : `${name} ran out of budget (${String(left)} rows not reached this run)`,
    );
  }
  return out;
}

/** The config file itself: the one the hooks read, and whether it was readable. */
function configFindings(input: DoctorInput): Finding[] {
  const out: Finding[] = [];
  const reason = input.configReason;
  if (reason === "not-read") {
    // NOT A FAULT AND NOT A GRADE. `--dir` named a store; nothing named a
    // configuration, and reading the default one is what would open somebody's
    // live credentials file. So the store is graded and this line says, in the
    // words the refusal used to use, exactly what to type to grade the rest.
    out.push(
      finding(
        "config",
        "amber",
        "Config",
        `not read — you named a store with --dir and no configuration, so nothing here grades ${input.configPath}: no credentials, no embedder setting, no snapshot policy, no stance`,
        `To grade those too: counterparts doctor --config <absolute path> (or set ${CONFIG_ENV}).`,
        { path: input.configPath, reason },
      ),
    );
    // ONE COUNT, read once and used twice: the sentence and the row say the
    // same number because it is the same number, and rule 3 of this module —
    // it is on the hot path, so it is bounded — is kept by not asking twice.
    const held = input.store === null ? null : memoryCount(input.store);
    out.push(
      input.store === null
        ? finding("store", "red", MEMORY_TITLE, `no store at ${tilde(input.dir)}`, "Check the path you gave --dir.", {
            dir: input.dir,
            exists: false,
          })
        : finding("store", "green", MEMORY_TITLE, memoryDetail(input, held), "", {
            dir: input.dir,
            exists: true,
            memories: held,
          }),
    );
    return out;
  }
  if (reason === "absent" || reason === "unreadable") {
    out.push(
      finding(
        "config",
        "red",
        "Config",
        `${input.configPath} — ${reason === "absent" ? "no such file" : "unreadable, so every entry point stands down to observer"}`,
        reason === "absent"
          ? "Run: counterparts install (or point --config at the file you meant)."
          : "Fix the JSON, or restore it from claude-code.json.bak beside it.",
        { path: input.configPath, reason },
      ),
    );
  } else {
    out.push(
      finding(
        "config",
        "green",
        "Config",
        `${input.configPath} — read; dataDir ${input.config.dataDir ?? "(unset: the default store)"}`,
        "",
        { path: input.configPath, reason: reason ?? "read-by-caller", dataDir: input.config.dataDir ?? null },
      ),
    );
  }

  // THE STORE THE HOOKS WOULD OPEN, against the one this reading opened. I31's
  // shape: the hooks and another entry point named different stores and nothing
  // noticed, because each was internally consistent.
  const named = input.config.dataDir;
  if (input.store === null) {
    out.push(
      finding("store", "red", MEMORY_TITLE, `no store at ${tilde(input.dir)}`, "Run: counterparts install, or name the store with --dir.", {
        dir: input.dir,
        exists: false,
      }),
    );
  } else if (named !== undefined && named !== input.dir) {
    out.push(
      finding(
        "store",
        "amber",
        MEMORY_TITLE,
        `read ${tilde(input.dir)}, but ${tilde(input.configPath)} names ${tilde(named)} — the hooks read the second one`,
        "Drop --dir (and COUNTERPARTS_DATA_DIR) to read the store the hooks use.",
        { dir: input.dir, named, exists: true },
      ),
    );
  } else {
    // One count, read once — see the `not-read` arm above.
    const held = memoryCount(input.store);
    out.push(
      finding("store", "green", MEMORY_TITLE, memoryDetail(input, held), "", {
        dir: input.dir,
        exists: true,
        memories: held,
      }),
    );
  }

  // THE STANCE IS CALLED `Mode` NOW, and it is said in the words a person can
  // act on rather than in the configuration's (finding #20: "owner: this host
  // encodes" was named as the line nobody could read). The key and the `data`
  // are untouched, so every reader of the JSON sees what it always saw.
  if (input.config.observer === true) {
    out.push(
      finding("stance", "amber", "Mode", "observer — reads memory, writes nothing", "Remove \"observer\" from the config to remember again.", {
        observer: true,
      }),
    );
  } else {
    out.push(finding("stance", "green", "Mode", "remembering", "", { observer: false }));
  }
  return out;
}

/** The column heading the store's own line reads under. It is "Memory" and not
 *  "Store" because the person reading it did not install a database. */
const MEMORY_TITLE = "Memory";

/**
 * HOW MANY MEMORIES THIS STORE HOLDS — the wake preface's own query, which is
 * the number `status` prints as `Memories:` and says so in its aside.
 *
 * ONE `SELECT COUNT(*)` over an indexed filter, never `status`'s walk of every
 * row: this line is built on the hook's hot path too, and a census that opened
 * every row would put the whole store between a session and its first word.
 */
function memoryCount(store: Store): number | null {
  try {
    return store.countMemories({ type: "memory", archived: false });
  } catch {
    // A store that will not answer still has a path worth printing, and the
    // `Store open` line is where an unreadable store is graded.
    return null;
  }
}

/**
 * `~/.counterparts/store — 32 memories, opens fine`.
 *
 * "Opens fine" is the `Store open` reading (`input.open`), said here because
 * the two facts are one sentence to a person: this is where your memory is,
 * and it works. The separate `store-open` finding stays — `doctor --all` and
 * `--json` still carry it, and a store that will NOT open prints its own line
 * with the code and the repair.
 */
function memoryDetail(input: DoctorInput, n: number | null): string {
  const held = n === null ? "" : ` — ${String(n)} ${n === 1 ? "memory" : "memories"}`;
  const opens = input.open?.ok === true ? ", opens fine" : "";
  return `${tilde(input.dir)}${held}${opens}`;
}

/**
 * RECALL BY MEANING — the embedder and the Voyage key, as ONE line.
 *
 * **The finding (#24, the owner's 0.2.0 trial).** Skipping the optional Voyage
 * key produced three ambers: `Embedder off`, `Credentials … is missing`, and
 * `Vectors 35 with no vector`. One optional thing nobody turned on, three
 * problems on the screen — and the fix line for the first told him to hand-edit
 * a JSON file (#19). A person reads that as a broken install.
 *
 * So the three become one, and its grade is `OFF`: optional, never turned on,
 * nothing to do. `vectorFindings` returns nothing at all while the embedder is
 * off (there is nothing to embed), and `credentialFindings` keeps the Voyage
 * name on its factual line under `--all` instead of grading it.
 *
 * THE TWO GRADES THAT ARE NOT `OFF`, and why:
 *
 *   - **Switched ON and no key**: the feature was asked for and cannot run, so
 *     every ask pays for an `embed-failed`. Amber, with the command that fixes
 *     it.
 *   - **Switched OFF on a store that HAS embedded**: something that was running
 *     has stopped. Amber, in the words that line has always used — never `OFF`,
 *     which claims nobody ever turned it on.
 */
function embedderFindings(input: DoctorInput, history: KeyHistory): Finding[] {
  const enabled = input.config.embedder?.enabled === true;
  const present = [...input.credentials.loaded, ...input.credentials.skippedPresent];
  const haveKey = present.includes(EMBED_KEY_ENV);
  const data = { enabled, key: haveKey, everEmbedded: history.embedded };
  const turnOn = `Turn on: counterparts credentials set ${EMBED_KEY_ENV}`;
  if (enabled && haveKey) {
    return [finding("embedder", "green", RECALL_TITLE, "on — recall matches meaning as well as words", "", data)];
  }
  if (enabled) {
    return [
      finding(
        "embedder",
        "amber",
        RECALL_TITLE,
        `on, but ${EMBED_KEY_ENV} is not saved${shellClause(input, EMBED_KEY_ENV, present)} — so nothing is embedded and every ask pays for the attempt`,
        `Run: counterparts credentials set ${EMBED_KEY_ENV}`,
        data,
      ),
    ];
  }
  if (history.embedded) {
    // SAYS WHAT STILL WORKS (2026-09-20, finding 1). "No vectors, no semantic
    // channel" is true and reads as a broken install. Lexical recall is a whole
    // working channel, not a degraded mode.
    return [
      finding(
        "embedder",
        "amber",
        RECALL_TITLE,
        "off — and this store HAS embedded before, so something that was running has stopped. " +
          "Recall still matches on words; what is gone is finding a memory that says the same thing in different words",
        turnOn,
        data,
      ),
    ];
  }
  return [
    off(
      "embedder",
      RECALL_TITLE,
      `optional. Recall works on words; a Voyage key lets it match meaning too.${shellClause(input, EMBED_KEY_ENV, present)}`,
      turnOn,
      data,
    ),
  ];
}

const RECALL_TITLE = "Recall by meaning";
const CRASH_TITLE = "Crash write-up";

/**
 * The clause for THE NAME THIS FINDING IS ABOUT, and no other: "your shell
 * exports VOYAGE_API_KEY" hung on a red about `ANTHROPIC_API_KEY` reads as a
 * non-sequitur and teaches the reader to skip the line.
 *
 * It is the sentence that closes I32 on the owner's own machine: his `~/.zshrc`
 * exports both names, hook processes inherit neither (measured day 0), so "I
 * have that key" and "the hooks have that key" are two different facts and this
 * is where they are told apart.
 */
function shellClause(input: DoctorInput, name: string, present: readonly string[]): string {
  return (input.shellNames ?? []).includes(name) && !present.includes(name)
    ? ` — your shell exports ${name}, and hook processes do not inherit it`
    : "";
}

/**
 * HAS THIS STORE EVER HAD A WORKING KEY (2026-09-20, finding 1).
 *
 * README says no API keys are required and QUICKSTART §6 says the worker still
 * runs the day without one — and `doctor` on a brand-new keyless store printed
 * a RED and exited 1. All three cannot be true. A careful reader concludes a
 * fresh install is broken; a trusting one buys a key the docs said they did not
 * need.
 *
 * The red was written for a real and serious case, so it is kept for that case
 * and only that one: a key that was HERE and has gone. The discriminator is the
 * store's own evidence, never a marker file — a marker would have to be written
 * by something, and the thing that would write it is the thing that is missing.
 *
 *   - The interpreter ran if anything was ever interpreted. `gate.chunk` is the
 *     crash sweep's own row and the sweep is the only interpreted write path,
 *     so one such row ever is proof the key worked here.
 *   - The embedder ran if any backfill ever embedded anything.
 *
 * Both are ONE bounded read each, over the whole log, and both answer "ever",
 * so neither can be undone by retention sweeping the window.
 *
 * **THE FALSE NEGATIVE, stated.** A key that was present and never EXERCISED —
 * no session ever crashed, so the sweep never ran — leaves no `gate.chunk`, and
 * removing it reads amber where the owner might want red. That is the direction
 * this errs on purpose: the amber still names the key and still says what it
 * would add, so nothing is hidden; the alternative errs towards telling every
 * new user their install is broken. Revisit if a second signal appears that
 * proves the key worked without the sweep having run.
 */
interface KeyHistory {
  readonly interpreted: boolean;
  readonly embedded: boolean;
}

export function keyHistory(store: Store | null): KeyHistory {
  if (store === null) return { interpreted: false, embedded: false };
  const any = (name: string, limit: number, ok: (p: Record<string, unknown>) => boolean): boolean => {
    try {
      return store.eventLog({ name, limit }).some((r) => ok(payloadOf(r)));
    } catch {
      // A store that will not answer is not a store that says "never had one".
      // Both callers read `false` as "no evidence", and the line that follows
      // says what works without a key rather than accusing anybody.
      return false;
    }
  };
  return {
    // ONE ROW. `eventLog` orders ascending and `events_name` is an index, so
    // "has there ever been one" is the cheapest question this file asks.
    interpreted: any(GATE_CHUNK_EVENT, 1, () => true),
    // A backfill row exists with or without a key — it records what is still
    // waiting — so this one has to look at the number, over a bounded window of
    // the OLDEST rows, which is where a key that worked and then went would be.
    embedded: any(EMBED_BACKFILL_EVENT, KEY_HISTORY_ROWS, (p) => (num(p, "embedded") ?? 0) > 0),
  };
}

/** How many backfill rows the "has a key ever worked here" read looks at. */
const KEY_HISTORY_ROWS = 200;

/** What a store with no key still does, in one sentence a new user can act on. */
const WITHOUT_A_KEY =
  "everything you and the assistant write by hand still lands — note, session_end, the journal, " +
  "recall, the wake";

/**
 * The credentials, BY NAME. The red is I32's own signature: no interpreter key
 * means the worker runs the day and interprets nothing — but see `keyHistory`
 * above: that red is for a key that WENT AWAY, not for a store that never had
 * one, which is a supported way to run.
 */
function credentialFindings(input: DoctorInput, history: KeyHistory): Finding[] {
  const load = input.credentials;
  const present = [...load.loaded, ...load.skippedPresent];
  const missing = CREDENTIAL_NAMES.filter((n) => !present.includes(n));
  const path = input.credentialsPath ?? "(no credentialsFile in the config)";
  const where = `${tilde(path)}${load.mode === null ? "" : ` (mode ${load.mode})`}`;
  const holds = present.length === 0 ? "holds no key" : `holds ${present.join(", ")}`;
  const out: Finding[] = [];

  const data = {
    path,
    mode: load.mode,
    reason: load.reason,
    present: present.join(","),
    missing: missing.join(","),
    everInterpreted: history.interpreted,
    everEmbedded: history.embedded,
  };

  // THE FACTUAL LINE, ALWAYS — which file, what mode, which names it holds.
  // GREEN unless the one red below stands: a name the file does not hold is not
  // a fault, it is a feature nobody turned on, and the `OFF` line for that
  // feature says so in the words of the thing it buys. This line keeps the
  // names, because "which keys are saved" is a question with one answer and
  // `doctor --all` is where it lives.
  if (missing.includes(API_KEY_ENV) && history.interpreted) {
    // RED only when the key WORKED here and is now gone — the case this line
    // was written for, and the one case `OFF` may never swallow.
    out.push(
      finding(
        "credentials",
        "red",
        "Credentials",
        `${where} ${holds}: ${API_KEY_ENV} is missing, and this store HAS interpreted before — so something that was running has stopped; the worker now runs the day and encodes nothing${shellClause(input, API_KEY_ENV, present)}`,
        `Run: counterparts credentials set ${API_KEY_ENV}`,
        data,
      ),
    );
  } else {
    out.push(finding("credentials", "green", "Credentials", `${where} ${holds}`, "", data));
    out.push(
      missing.includes(API_KEY_ENV)
        ? // THE CRASH SWEEP, AS THE THING IT BUYS. No key has ever been used
          // here, which is a supported way to run — `WITHOUT_A_KEY` is the long
          // form of that sentence, kept on the finding rather than printed as a
          // warning on a screen where nothing is wrong.
          off(
            "crash-writeup",
            CRASH_TITLE,
            `optional. An Anthropic key lets a session that ended too soon get written up anyway.${shellClause(input, API_KEY_ENV, present)}`,
            `Turn on: counterparts credentials set ${API_KEY_ENV}`,
            { ...data, without: WITHOUT_A_KEY },
          )
        : // AND A GREEN ROW WHEN IT IS ON (coordinator, 2026-09-22), mirroring
          // `Recall by meaning`'s. A feature that says `OFF` until you turn it
          // on and then says nothing at all leaves the person who just added
          // the key with no confirmation on the screen they were told to check
          // — and the factual `Credentials` line, which does carry the name,
          // only prints under `--all`.
          finding(
            "crash-writeup",
            "green",
            CRASH_TITLE,
            "on — a session that ended too soon gets written up anyway",
            "",
            data,
          ),
    );
  }

  // The mode is its own finding: a file that holds both keys and is world
  // readable is a different problem from a file that holds neither, and
  // collapsing them would let one hide the other. Warned, never refused
  // (`permissionWarning` states the rule: the owner's machine, the owner's call).
  if (load.mode !== null && load.mode !== "600") {
    out.push(
      finding(
        "credentials-mode",
        "amber",
        "Cred mode",
        `${tilde(path)} is mode ${load.mode}${load.permissive ? " — group or other can read it" : ""}`,
        `Run: chmod 600 ${tilde(path)}`,
        { path, mode: load.mode, permissive: load.permissive },
      ),
    );
  }
  return out;
}

/** The two clocks, and the gap that IS I32's signature. */
function clockFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const raw = store.getMeta("lastActiveDate");
  // A store that has never lived a day carries the key with an EMPTY value, and
  // "" is not the same fact as "2026-09-04": collapsing them here is how a fresh
  // store would read as a frozen one.
  const lastActive = raw === undefined || raw.length === 0 ? null : raw;
  const read = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
  const boundary = rowDate(read.rows[0]);
  const data = { livedDay, lastActiveDate: lastActive, newestBoundary: boundary, today: input.today };
  // Unknown is not "(none)": an unread newest boundary cannot be compared with
  // the clock, so the comparison is not made and the line says why.
  if (read.unknown) {
    const facts =
      `lived day ${livedDay}, lastActiveDate ${lastActive ?? "(unset)"}, today ${input.today} (UTC) — ` +
      undetermined(BOUNDARY_EVENT);
    return [finding("clock", "green", "Clock", facts, "", data)];
  }
  const facts =
    `lived day ${livedDay}, lastActiveDate ${lastActive ?? "(unset)"}, ` +
    `newest boundary ${boundary ?? "(none)"}, today ${input.today} (UTC)`;
  if (boundary !== null && (lastActive === null || lastActive < boundary)) {
    return [
      finding(
        "clock",
        "amber",
        "Clock",
        `${facts} — sessions are reaching boundaries and the clock is not advancing: the worker is not running`,
        "Read the Spawn line below; a refused spawn is the usual cause.",
        data,
      ),
    ];
  }
  return [finding("clock", "green", "Clock", facts, "", data)];
}

/** The newest row of each family the background half leaves behind. */
function rowFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const out: Finding[] = [];
  /**
   * WAS THERE EVER AN OPPORTUNITY? An absent row is only evidence when a
   * boundary has been reached: on a store that has never held a session there is
   * nothing for the worker to have swept, no cycle to have run and nothing to
   * have embedded, and three ambers on a fresh install teach the owner to read
   * amber as decoration.
   */
  // `unknown` means the store holds MORE than `NEWEST_LIMIT` boundary rows, so
  // it has certainly lived — the one thing this flag needs to know.
  const boundaries = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
  const lived = boundaries.unknown || boundaries.rows.length > 0;
  /** The "no row yet" finding: amber once the store has lived, green before. */
  const absent = (key: string, title: string, what: string, fix: string): Finding =>
    lived
      ? finding(key, "amber", title, what, fix, { rows: 0 })
      : finding(key, "green", title, `${what} — and no boundary has been reached here yet`, "", { rows: 0 });
  /** The "we could not read the newest one" finding: neutral, never a grade. */
  const unread = (key: string, title: string, name: string): Finding =>
    finding(key, "green", title, undetermined(name), "", { unknown: true });

  const sweepRead = newestRows(store, SWEEP_GATE_EVENT, 1, livedDay);
  const sweep = sweepRead.rows[0];
  if (sweepRead.unknown) {
    out.push(unread("sweep", "Sweep", SWEEP_GATE_EVENT));
  } else if (sweep === undefined) {
    out.push(absent("sweep", "Sweep", "no sweep.gate row — no worker has reached the crash sweep here", "Read the Spawn line below."));
  } else {
    const p = payloadOf(sweep);
    const reason = str(p, "reason") ?? "(none)";
    const detail = `newest sweep.gate ${rowDate(sweep) ?? "?"}: reason ${reason}, ran ${num(p, "ran") ?? 0} of ${num(p, "scopes") ?? 0} scopes`;
    /**
     * THE REASON THAT HAS ALREADY BEEN ANSWERED (new-user findings #9).
     *
     * The gate row is the newest sweep, not the current state of the machine.
     * Add the key and this line went on saying AMBER `reason no-credential`
     * until the next session boundary wrote a fresh row — hours, on a quiet
     * afternoon — with a fix line telling the reader to do the thing they had
     * just done. A standing amber nobody can clear is how a person learns to
     * read amber as decoration.
     *
     * So: the newest row says it stood down for want of a key AND the
     * credentials file holds one NOW. Nothing is wrong, and there is nothing to
     * fix, so it is GREEN and says which of the two facts it is looking at. The
     * credentials come from the FILE, never the environment — `credentialFindings`
     * keeps the same rule, and a hook process inherits no shell.
     */
    const keyNow = [...input.credentials.loaded, ...input.credentials.skippedPresent].includes(
      API_KEY_ENV,
    );
    const answered = reason === "no-credential" && keyNow;
    out.push(
      reason === "ran"
        ? finding("sweep", "green", "Sweep", detail, "", { reason, ran: num(p, "ran"), date: rowDate(sweep) })
        : answered
          ? finding(
              "sweep",
              "green",
              "Sweep",
              `${detail} — that sweep ran before ${API_KEY_ENV} was added; the next session boundary will use it`,
              "",
              { reason, ran: num(p, "ran"), date: rowDate(sweep), answered: true },
            )
          : finding(
              "sweep",
              "amber",
              "Sweep",
              detail,
              // EVERY FIX A COMMAND (2026-09-23, from the 0.2.0 trial). The
              // one stand-down whose remedy is a single command says the
              // command; every other reason still points at the row, because
              // what fixes it depends on which door it names.
              reason === "no-credential"
                ? `Run: counterparts credentials set ${API_KEY_ENV}`
                : "The sweep stood down; the reason names why.",
              {
                reason,
                ran: num(p, "ran"),
                date: rowDate(sweep),
              },
            ),
    );
  }

  const cycleRead = newestRows(store, SLEEP_CYCLE_EVENT, 1, livedDay);
  const cycle = cycleRead.rows[0];
  if (cycleRead.unknown) {
    out.push(unread("sleep", "Sleep", SLEEP_CYCLE_EVENT));
  } else if (cycle === undefined) {
    out.push(absent("sleep", "Sleep", "no sleep.cycle row — no cycle has run here since the rows existed", "Read the Spawn line below."));
  } else {
    const p = payloadOf(cycle);
    const reason = str(p, "reason") ?? "(none)";
    const failed = num(p, "failed") ?? 0;
    // WHICH PHASES RAN OUT OF ROAD, from the row's own phase entries (durable
    // since 2026-09-18). Not a severity: with a resume cursor a big store is
    // MEANT to take several nights over a full pass, and grading that amber
    // would teach the reader to ignore this line. It is here so that "the
    // consolidate pass reached a third of the store" is readable at all — the
    // fact that hid for two weeks was not that it happened but that nothing said so.
    const truncated = budgetTruncatedPhases(p);
    const detail =
      `newest sleep.cycle ${rowDate(cycle) ?? "?"}: reason ${reason}, ${failed} failed phase${failed === 1 ? "" : "s"}` +
      (str(p, "failedPhase") === null ? "" : `, died in ${String(str(p, "failedPhase"))}`) +
      (truncated.length === 0 ? "" : `; ${truncated.join(", ")}`);
    // `reason` is "ran" | "clock-failed" | "threw" (`counterpart.ts#recordSleepCycle`),
    // so anything but "ran" is a night that did not happen, not a cadence.
    const data = { reason, failed, date: rowDate(cycle), budgetTruncated: truncated.length };
    out.push(
      reason !== "ran"
        ? finding("sleep", "red", "Sleep", detail, "The nightly cycle is not completing — decay, prune, dedup and consolidate are not running.", data)
        : failed > 0
          ? finding("sleep", "amber", "Sleep", detail, "A phase failed; the row names it.", data)
          : finding("sleep", "green", "Sleep", detail, "", data),
    );
  }

  // TWO rows, because one bad backfill is a flaky provider and two in a row is
  // a poisoned input that will never clear itself (I33's whole shape: the same
  // head-64 chunk retried for 32 consecutive runs).
  const backfillRead = newestRows(store, EMBED_BACKFILL_EVENT, 2, livedDay);
  const backfills = backfillRead.rows;
  const newest = backfills[backfills.length - 1];
  if (backfillRead.unknown) {
    out.push(unread("backfill", "Backfill", EMBED_BACKFILL_EVENT));
  } else if (newest === undefined) {
    out.push(
      absent("backfill", "Backfill", "no adapter.embed.backfill row — nothing has been embedded here", "Read the Embedder and Credentials lines."),
    );
  } else {
    const p = payloadOf(newest);
    const embedded = num(p, "embedded") ?? 0;
    const failed = num(p, "failed") ?? 0;
    const detail =
      `newest backfill ${rowDate(newest) ?? "?"}: embedded ${embedded}, failed ${failed}, ` +
      `remaining ${num(p, "remaining") ?? 0}, skipped ${num(p, "skipped") ?? 0}` +
      (str(p, "codes") === null || str(p, "codes") === "" ? "" : `, codes ${String(str(p, "codes"))}`);
    const prior = backfills.length > 1 ? payloadOf(backfills[0]) : null;
    const stalledTwice =
      embedded === 0 &&
      failed > 0 &&
      prior !== null &&
      (num(prior, "embedded") ?? 0) === 0 &&
      (num(prior, "failed") ?? 0) > 0;
    const data = { embedded, failed, remaining: num(p, "remaining"), skipped: num(p, "skipped"), codes: str(p, "codes"), date: rowDate(newest) };
    out.push(
      stalledTwice
        ? finding("backfill", "red", "Backfill", `${detail} — and the run before it embedded nothing too`, "The backfill is head-of-line blocked; the codes name the fault (see I33).", data)
        : failed > 0
          ? finding("backfill", "amber", "Backfill", detail, "Some chunks failed; the codes name why.", data)
          : finding("backfill", "green", "Backfill", detail, "", data),
    );
  }

  const creditRead = newestRows(store, RECALL_CREDIT_EVENT, 1, livedDay);
  const credit = creditRead.rows[0];
  if (creditRead.unknown) {
    out.push(unread("credit", "Credit", RECALL_CREDIT_EVENT));
  } else if (credit !== undefined) {
    const p = payloadOf(credit);
    const reason = str(p, "reason") ?? "(none)";
    const detail = `newest recall.credit ${rowDate(credit) ?? "?"}: reason ${reason}, credited ${num(p, "credited") ?? 0} of ${num(p, "considered") ?? 0} considered`;
    const data = { reason, credited: num(p, "credited"), considered: num(p, "considered"), date: rowDate(credit) };
    // `no-candidates` and `nothing-to-credit` are the ORDINARY readings until a
    // session expands or quotes something (HANDOFF, 2026-09-14); only the seam
    // itself failing is a finding.
    out.push(
      reason === "failed"
        ? finding("credit", "amber", "Credit", detail, "The credit seam threw; the row names the reason.", data)
        : finding("credit", "green", "Credit", detail, "", data),
    );
  }
  return out;
}

/**
 * WHO IS DOING THE WRITING — one week of it, in the owner's own words.
 *
 * **The finding this answers (finding 12, diagnosed 2026-09-17).** Over the run
 * the crash fallback out-wrote the session itself 4.5 : 1, and every visible
 * surface read healthy while it happened: capture captured, deposits were
 * accepted, nothing was red. The two facts that would have shown it are not
 * hard to read and were simply never read out — how often the session was
 * OFFERED the pen, and how much of the week's memory it actually wrote. Both
 * come out of rows the store already keeps (constitution 11: the system itself
 * shows what fired).
 *
 * Three readings, seven calendar days, nothing computed and nothing guessed:
 *
 *   - **The asks, by `outcome`** (`adapter.ask`). `asked` is an invitation that
 *     went out; `capped` is one refused because an allowance was spent; `paced`
 *     is one the substance pacer refused.
 *
 *     The capped ones are SPLIT BY `reason`, because two different rules wear
 *     that one outcome: rows written before 2026-09-17 carry
 *     `day-chapter-cap` — the old ration four sessions of one day shared, whose
 *     clock only the worker advanced — and rows since carry `session-ask-cap`,
 *     this session's own allowance for the day
 *     (`SELF_TUNABLES.MAX_ASKS_PER_SESSION`, which starts over with the calendar
 *     date from 2026-09-18).
 *     Counting them together let the line blame the per-session allowance for
 *     refusals it never made, which is a diagnostic naming the wrong door. The
 *     amber hint therefore keys on the NEW reason alone; the old one is still
 *     counted and named, because the days it recorded are still in the window.
 *   - **The answers** (`gate.deposit`): what the session handed back.
 *   - **The memories** (`memories.source`): how many live memories of the week
 *     the session wrote itself, against how many were written for it later.
 *
 * AMBER on either of two comparisons, and never red — this is a balance, not a
 * fault, and nothing here means the machine is broken.
 *
 * The window is CALENDAR days, taken from the payload's own `date` (else the
 * row's wall clock), never the lived-day column: the lived clock is advanced by
 * the worker and has run seven lived days across fifteen calendar ones on this
 * very store. `sinceDay` is used only to keep the SQL cheap, and a lived day is
 * never longer than a calendar day, so `livedDay - 7` cannot miss a row inside
 * the window.
 */
export const AUTHORSHIP_DAYS = 7;

/** The cap in force. Declared `satisfies AskReason` rather than typed loose, so
 *  a rename in `self/episodes.ts` fails `tsc` here instead of quietly reading
 *  zero one morning. */
const SESSION_ASK_CAP = "session-ask-cap" satisfies AskReason;

/** The cap that WAS in force until 2026-09-17 — one ration shared by every
 *  session of a lived day. Nothing writes it now and it is not in `AskReason`
 *  any more, but the rows it wrote are still inside a seven-day window and a
 *  count that folded them into the new cap would name the wrong door. */
const DAY_CHAPTER_CAP = "day-chapter-cap";

/** The ceiling on one authorship read. A week of the owner's busiest recorded
 *  day (137 ask decisions) is two orders of magnitude inside this; a read that
 *  hits it says so rather than reporting the prefix as the whole. */
const AUTHORSHIP_LIMIT = 20000;

/**
 * THE KEY `start-fresh` WRITES, spelled out rather than imported.
 *
 * `STORE_STARTED_KEY` lives in `adapters/cli/commands.ts`, which imports THIS
 * file — so importing it back would be a cycle. `test/doctor.test.ts` holds the
 * two strings to each other, so a rename there fails a test here instead of
 * silently reading nothing one morning.
 */
const STORE_STARTED_META = "store.started";

/**
 * THE FIRST DAY THIS STORE CAN EVIDENCE, or null when it can evidence none.
 *
 * The finding (new-user findings #8, 2026-09-21): a seven-day window printed
 * `2026-09-15→2026-09-21` on a store made that morning — a week the store did
 * not exist for. The window is not wrong about what it LOOKED at; it is wrong
 * about what it could have seen, and a reader has no way to tell the two apart.
 *
 * TWO SOURCES, and both are the store's own record of ITSELF — never of what is
 * in it. The earliest of them wins, because an over-stated age costs nothing
 * (the window is simply not clamped, which is today's behaviour) while an
 * under-stated one would name a window narrower than the rows it counted:
 *
 *   1. `store.created` — one meta row, written by the open that made the file
 *      (`core/store#STORE_CREATED_KEY`).
 *   2. `store.started` — `start-fresh`'s own record of the day a blank store
 *      took a parked one's place.
 *
 * **Absent on every store made before 2026-09-21** — every store 0.1.0 made,
 * which is why finding #8 stayed open for them after 0.2.0 closed it for new
 * ones. So when neither record is there, two FALLBACKS, in order (2026-09-23):
 *
 *   3. **The oldest event row's `at`** — the moment the row was WRITTEN, on the
 *      store's own provenance clock. Not its `rowDate`: that prefers the
 *      payload's `date` field, which is the day the event is ABOUT, and a
 *      back-dated first row would declare the store younger than its contents.
 *      `at` has no such field to be fooled by. Event pruning cannot make it lie
 *      the dangerous way either: a row is pruned only once it is 90 LIVED days
 *      old, so a store that has lost its first rows is months older than the
 *      seven-day window, and its oldest survivor clamps nothing.
 *   4. **The database file's birth time** — for a store with no events at all.
 *      A filesystem that does not keep one reports zero, which is read as "no
 *      answer", never as 1970.
 *
 * Both fallbacks can only make a store look OLDER than it is when they are
 * wrong (a copied file is born when it was copied, and a row written by replay
 * tooling carries the clock it was given) — never younger than its rows, which
 * is the direction that would matter.
 *
 * TWO THINGS THAT LOOK LIKE SOURCES AND ARE NOT. A memory's `learned_on` — an
 * imported store carries dates from long before it existed. `livedDay` — the
 * physics clock, which the worker advances and which is 0 on a store whose
 * worker has never run.
 */
function storeFirstDay(store: Store): string | null {
  let first: string | null = null;
  for (const key of [STORE_CREATED_KEY, STORE_STARTED_META]) {
    const said = store.getMeta(key);
    if (said === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(said)) continue;
    if (first === null || said < first) first = said;
  }
  if (first !== null) return first;
  return oldestEventDay(store) ?? databaseBirthDay(store.dir);
}

/** The calendar day (UTC) the store's oldest surviving event row was written,
 *  or null when it has none, or none that can be read. */
function oldestEventDay(store: Store): string | null {
  try {
    const at = store.eventLog({ limit: 1 })[0]?.at;
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? dateOf(at) : null;
  } catch {
    return null;
  }
}

/** The calendar day (UTC) the store's database file was born, or null when the
 *  filesystem keeps no birth time (it reports zero) or the file cannot be read. */
function databaseBirthDay(dir: string): string | null {
  try {
    const born = statSync(paths.operational(dir)).birthtimeMs;
    return Number.isFinite(born) && born > 0 ? dateOf(born) : null;
  } catch {
    return null;
  }
}

/**
 * The window to SAY, given the window that was read.
 *
 * Only ever moves the start FORWARD, and only into the range
 * `(windowStart, today]` — a first day at or before the window start changes
 * nothing, and one after today is a clock nobody should trust (it is also what
 * every synthetic test store looks like: rows written now, graded against a
 * `today` in the past).
 *
 * The READING is untouched: the counts are still taken over the full window, so
 * no grade and no number moves. This decides one string.
 */
function windowShown(windowStart: string, today: string, firstDay: string | null): string {
  if (firstDay === null) return windowStart;
  return firstDay > windowStart && firstDay <= today ? firstDay : windowStart;
}

/** `2026-09-15→2026-09-21`, or `since 2026-09-21` for a store one day old. */
function windowPhrase(shown: string, today: string): string {
  return shown === today ? `since ${today}` : `${shown}→${today}`;
}

/** `YYYY-MM-DD`, `back` days before `today`. UTC, like every date in this store. */
function daysBefore(today: string, back: number): string {
  const at = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(at)) return today;
  return new Date(at - back * 86_400_000).toISOString().slice(0, 10);
}

/** Every row of one name whose CALENDAR date is on or after `from`. */
function rowsInWindow(
  store: Store,
  name: string,
  livedDay: number,
  from: string,
): { rows: EventRow[]; truncated: boolean } {
  const all = store.eventLog({
    name,
    sinceDay: Math.max(0, livedDay - AUTHORSHIP_DAYS),
    limit: AUTHORSHIP_LIMIT,
  });
  return {
    rows: all.filter((r) => {
      const date = rowDate(r);
      return date !== null && date >= from;
    }),
    // `eventLog` orders ASCENDING, so a full read is the OLDEST rows of the
    // window and the newest days are the ones missing. The counts are a floor
    // and the line says so; a confident wrong number is the one thing a
    // diagnostic may never produce.
    truncated: all.length >= AUTHORSHIP_LIMIT,
  };
}

/** The oldest calendar date among the rows this line actually read — the second
 *  clock for "too new to grade". Null when it read none at all. */
function oldestAuthorshipDate(
  asks: readonly EventRow[],
  deposits: readonly EventRow[],
): string | null {
  let oldest: string | null = null;
  for (const row of [...asks, ...deposits]) {
    const date = rowDate(row);
    if (date !== null && (oldest === null || date < oldest)) oldest = date;
  }
  return oldest;
}

function authorshipFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  // Inclusive of today: seven calendar days means today and the six before it.
  const from = daysBefore(input.today, AUTHORSHIP_DAYS - 1);
  const asks = rowsInWindow(store, ADAPTER_ASK_EVENT, livedDay, from);
  const deposits = rowsInWindow(store, GATE_DEPOSIT_EVENT, livedDay, from);
  let asked = 0;
  let capped = 0;
  let cappedBySession = 0;
  let cappedByDay = 0;
  let paced = 0;
  let unlabelled = 0;
  for (const row of asks.rows) {
    const payload = payloadOf(row);
    switch (str(payload, "outcome")) {
      case "asked":
        asked += 1;
        break;
      case "capped": {
        capped += 1;
        const reason = str(payload, "reason");
        if (reason === SESSION_ASK_CAP) cappedBySession += 1;
        else if (reason === DAY_CHAPTER_CAP) cappedByDay += 1;
        break;
      }
      case "paced":
        paced += 1;
        break;
      default:
        // Rows from before the single pacer carry no `outcome` at all. Counted
        // apart rather than folded into one of the three, and named only when
        // there are any — a bucket that is always zero is noise.
        unlabelled += 1;
    }
  }
  const authored = store.countMemories({
    type: "memory",
    archived: false,
    source: "authored",
    learnedOnFrom: from,
  });
  const fallback = store.countMemories({
    type: "memory",
    archived: false,
    source: "fallback",
    learnedOnFrom: from,
  });
  // WHAT THE LINE SAYS IT LOOKED AT (finding 8). The window READ is still the
  // full seven days — every count above and below is taken over `from` — and
  // this is the one string that changes: on a store younger than the window,
  // claiming a week it did not exist for is the diagnostic telling its reader
  // something that is not so.
  const shown = windowShown(from, input.today, storeFirstDay(store));
  // "of that week" is part of the same claim, and has to go with it.
  const span = shown === from ? "of that week" : "in that time";
  // The NEW reason alone decides the hint: the old shared day cap stopped being
  // written on 2026-09-17 and its rows only age out of the window, so keying on
  // the total would go on blaming a rule nothing enforces any more.
  const capBinds = cappedBySession > asked;
  const sweepWins = fallback > authored;
  const cappedSplit = [
    cappedBySession === 0 ? "" : `${String(cappedBySession)} by a session's own allowance for the day`,
    cappedByDay === 0 ? "" : `${String(cappedByDay)} by the old shared day cap`,
    capped - cappedBySession - cappedByDay === 0
      ? ""
      : `${String(capped - cappedBySession - cappedByDay)} naming no cap`,
  ].filter((s) => s.length > 0);
  const detail =
    `${windowPhrase(shown, input.today)}: the session was invited to write ${String(asked)} ${asked === 1 ? "time" : "times"}, ` +
    `refused ${String(capped)} on a cap${cappedSplit.length === 0 ? "" : ` (${cappedSplit.join(", ")})`} ` +
    `and ${String(paced)} for pacing` +
    `${unlabelled === 0 ? "" : ` (${String(unlabelled)} older rows name no outcome)`}; ` +
    `it answered with ${String(deposits.rows.length)} ${deposits.rows.length === 1 ? "deposit" : "deposits"}; ` +
    `${String(authored)} live ${authored === 1 ? "memory" : "memories"} ${span} ${authored === 1 ? "is" : "are"} its own, ` +
    `${String(fallback)} ${fallback === 1 ? "was" : "were"} written for it by the fallback sweep` +
    `${asks.truncated || deposits.truncated ? " (counts are a floor: the event read hit its limit)" : ""}`;
  const fixes = [
    capBinds
      ? `A session's own allowance for the day (${String(SELF_TUNABLES.MAX_ASKS_PER_SESSION)} asks) is refusing the pen more often than it offers it — sessions are running long enough to exhaust it within a day, and that number is worth a look.`
      : "",
    sweepWins
      ? "The sweep writes what the session did not: check that sessions reach a session-end boundary in the scope they captured in, and that the Stop ask is reaching the model."
      : "",
  ].filter((s) => s.length > 0);
  const data = {
    from,
    // The window the SENTENCE names, beside the one the counts were taken over.
    // They differ only on a store younger than seven days, and a consumer that
    // wants the reading rather than the wording keeps reading `from`.
    shownFrom: shown,
    to: input.today,
    asked,
    capped,
    cappedBySession,
    cappedByDay,
    paced,
    unlabelled,
    deposits: deposits.rows.length,
    authored,
    fallback,
    truncated: asks.truncated || deposits.truncated,
  };
  // TOO NEW TO GRADE (2026-09-20, finding 2). Both ambers here are RATIOS —
  // "the cap refused more often than it offered", "the sweep wrote more than
  // the session did" — and a ratio over a handful of rows is not a reading. On
  // a store that has not lived a day or two, the sentence stands and the colour
  // does not: there is nothing here to fix that waiting will not answer.
  //
  // **TWO CLOCKS, the same rule `FiredReport.young` keeps.** An earlier version
  // used the lived clock alone, arguing that these ambers are about how a
  // session behaved and so cannot predate the clock moving. That premise is
  // false: `store.advanceClock()` has exactly one caller, the sleep cycle, and
  // sessions ask and deposit at every boundary whether or not the worker ever
  // runs. So a store whose worker has been dead since day 1 — spawn refused, no
  // credential, a broken checkout — piles up a fortnight of asks and deposits
  // with a perfectly meaningful cap/sweep ratio and read GREEN, "too new to
  // grade", for ever. That is the exact store the two-clock rule exists to
  // protect, one finding over.
  const young =
    livedDay < YOUNG_LIVED_DAYS &&
    daysBetween(oldestAuthorshipDate(asks.rows, deposits.rows) ?? input.today, input.today) <
      YOUNG_LIVED_DAYS;
  return [
    finding(
      "authorship",
      !young && (capBinds || sweepWins) ? "amber" : "green",
      "Authorship",
      young && (capBinds || sweepWins)
        ? `${detail} — too new to grade: this store is on lived day ${String(livedDay)}`
        : detail,
      young ? "" : fixes.join(" "),
      { ...data, young, livedDay },
    ),
  ];
}

/**
 * WHAT FIRED — the roll-call of mechanisms, read from the rows that exist today.
 *
 * Constitution 11: done means seen firing, not merged, and the system itself
 * shows what fired and what did not. Several mechanisms merged in September ran
 * zero times on the live store and nothing said so; this is the line that would
 * have said it.
 *
 * AMBER on one comparison and never red in this first version: a mechanism that
 * fired in the PREVIOUS seven days and not once in this one. That is the only
 * signal here that says something CHANGED — a count of never-fired mechanisms is
 * a standing fact about the build, and ambering on it every morning would train
 * its reader to ignore the line that matters.
 *
 * THE SESSION-START READING DOES NOT TAKE IT. This is the only group here whose
 * SQL is not bounded by a lived day — the roll-call is a question about the
 * whole log, and the five table probes cost a query per memory on top — and a
 * hook that paid for it would have made the cure worse than the disease. The
 * between-groups budget check cannot help: a group that starts inside the budget
 * then runs as long as it likes. And it would buy nothing there, because the
 * notice carries reds only and this finding is never red. So the budgeted
 * reading says where the answer lives instead of half-reading it.
 */
function firedFindings(input: DoctorInput, store: Store): Finding[] {
  if (input.budgetMs !== undefined) {
    return [
      finding(
        "fired",
        "green",
        "Fired",
        "the roll-call of mechanisms is not read at session start: it walks the whole event log, " +
          "and a hook is not the place to pay for that",
        "",
        { read: false },
      ),
    ];
  }
  const report = firedReport(store, input.today);
  const c = report.counts;
  const blocked =
    c.blocked === 0
      ? ""
      : `, ${String(c.blocked)} ${c.blocked === 1 ? "was" : "were"} stopped by something that said so`;
  // The same clamp the Authorship line takes (finding 8), through the same
  // helper and with the same guard. `report.from` — what was READ, and what the
  // `fired` command's own header prints — is untouched; this is the wording.
  const shown = windowShown(report.from, report.today, storeFirstDay(store));
  const roll =
    `${windowPhrase(shown, report.today)}: ${String(c.firing)} of ${String(report.rows.length)} mechanisms fired ` +
    `${shown === report.from ? "this week" : "in that time"}${blocked}, ` +
    `${String(c.quiet)} ${c.quiet === 1 ? "has" : "have"} gone quiet, ` +
    `${String(c.never)} ${c.never === 1 ? "has" : "have"} never fired, ` +
    `${String(c.new)} ${c.new === 1 ? "is" : "are"} too new to grade, ` +
    `${String(c.blind)} ${c.blind === 1 ? "records" : "record"} nothing durable at all` +
    `${c.disabled + c.retired === 0 ? "" : ` (${String(c.disabled)} stood down, ${String(c.retired)} retired)`}` +
    `${report.notRead.length === 0 ? "" : `; ${String(report.notRead.length)} whose evidence is a table were not read on this pass`}` +
    `${report.truncated ? "; counts are a floor — the event read hit its limit" : ""}`;
  const data: Record<string, string | number | boolean | null> = {
    from: report.from,
    to: report.today,
    firing: c.firing,
    blocked: c.blocked,
    quiet: c.quiet,
    never: c.never,
    new: c.new,
    blind: c.blind,
    disabled: c.disabled,
    retired: c.retired,
    notRead: report.notRead.join(","),
    truncated: report.truncated,
    wentQuiet: report.wentQuiet.join("; "),
    wentBlocked: report.wentBlocked.join("; "),
    young: report.young,
    livedDay: report.livedDay,
  };
  // TOO NEW TO GRADE (2026-09-20, finding 2). On a store younger than a lived
  // day or two, "28 have never fired" is a true sentence that reads like a
  // broken install — nothing has fired because nothing has happened yet. One
  // line saying so is more use than the roll-call, and the roll-call comes back
  // on its own. GREEN, because there is nothing here to fix.
  if (report.young) {
    return [
      finding(
        "fired",
        "green",
        "Fired",
        `this store is on lived day ${String(report.livedDay)} — too new to grade; nothing has fired ` +
          `because nothing has happened yet` +
          (c.blocked === 0 ? "" : `, though ${String(c.blocked)} was already stopped by something`),
        c.blocked === 0 ? "" : "Run: counterparts fired — the blocked rows say by what.",
        data,
      ),
    ];
  }
  // GRADED ON BOTH LISTS. `blocked` outranks `quiet` in the state machine, so a
  // mechanism that fired last week and was turned away every day this week
  // leaves `wentQuiet` — and without `wentBlocked` this finding would have gone
  // GREEN for it. A state that says MORE must never make a diagnostic read
  // safer than it did before that state existed.
  if (report.wentQuiet.length === 0 && report.wentBlocked.length === 0) {
    return [
      finding(
        "fired",
        "green",
        "Fired",
        `${roll}. Nothing that fired last week has fallen silent this week.`,
        "",
        data,
      ),
    ];
  }
  const changed = [
    report.wentBlocked.length === 0
      ? ""
      : `Fired last week and STOPPED this week: ${report.wentBlocked.join("; ")}`,
    report.wentQuiet.length === 0
      ? ""
      : `Fired last week and not once this week: ${report.wentQuiet.join("; ")}`,
  ].filter((s) => s.length > 0);
  return [
    finding(
      "fired",
      "amber",
      "Fired",
      `${roll}. ${changed.join(". ")}`,
      report.wentBlocked.length > 0
        ? `Run: counterparts fired — ${STATE_MEANING.blocked}, and the reason on the row names what to fix.`
        : `Run: counterparts fired — ${STATE_MEANING.quiet}, which is a wiring fault more often than a verdict.`,
      data,
    ),
  ];
}

/** The spawn seam: the persisted counters and the rows they explain. */
function spawnFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const entries = Object.entries(input.refusals).filter(([, n]) => n > 0);
  entries.sort((a, b) => b[1] - a[1]);
  const worst = entries[0];
  // The COUNTERS decide this finding; these three rows only explain it. An
  // unreadable newest row says so in the clause rather than being dropped, which
  // would read as "there is no such row".
  const clause = (name: string): string | null => {
    const read = newestRows(store, name, 1, livedDay);
    if (read.unknown) return undetermined(name);
    const row = read.rows[0];
    return row === undefined ? null : `newest ${name} ${rowDate(row) ?? "?"} (${str(payloadOf(row), "reason") ?? "?"})`;
  };
  const rowClause = [clause(SPAWN_REFUSED_EVENT), clause(SPAWN_FAILED_EVENT), clause(RUNNER_FAILED_EVENT)]
    .filter((s): s is string => s !== null)
    .join("; ");
  const counts = entries.map(([reason, n]) => `${reason} ×${n}`).join(", ");
  // HOW MANY TIMES IT DID START TODAY. `adapter.spawn.started` is latched one
  // row per calendar date, so the row proves the door opened and this counter
  // is the only thing that says how often — which is why the row deliberately
  // carries no tally of its own (it would read `1` forever).
  const starts =
    input.starts !== undefined && input.starts.date === input.today && input.starts.count > 0
      ? input.starts.count
      : null;
  const startClause =
    starts === null ? "" : `; started ${String(starts)} ${starts === 1 ? "time" : "times"} today`;
  const data: Record<string, string | number | boolean | null> = {
    counters: counts,
    escalateAfter: TUNABLES.ESCALATE_AFTER,
    worstReason: worst?.[0] ?? null,
    worstCount: worst?.[1] ?? 0,
  };
  if (worst !== undefined && worst[1] >= TUNABLES.ESCALATE_AFTER) {
    return [
      finding(
        "spawn",
        "red",
        "Spawn",
        `the background worker has been refused ${worst[1]} times in a row (${worst[0]})${rowClause === "" ? "" : ` — ${rowClause}`}`,
        worst[0] === "NO_CREDENTIAL"
          ? `Run: counterparts credentials set ${API_KEY_ENV}`
          : "Read the newest adapter.spawn.refused row; its reason names the door.",
        data,
      ),
    ];
  }
  if (entries.length > 0) {
    return [
      finding("spawn", "amber", "Spawn", `spawn refusals standing: ${counts}${rowClause === "" ? "" : ` — ${rowClause}`}`, "A spawn that starts clears every counter.", data),
    ];
  }
  return [
    finding(
      "spawn",
      "green",
      "Spawn",
      `no spawn refusals standing${startClause}${rowClause === "" ? "" : ` (${rowClause})`}`,
      "",
      { ...data, startsToday: starts },
    ),
  ];
}

/**
 * WHICH CODE IS LIVE. The hooks and the MCP server run whatever the install
 * tree has checked out, so an unmerged branch sitting in it is not a development
 * state — it is the memory layer the owner is using today.
 */
function checkoutFindings(reading: CheckoutReading): Finding[] {
  const data: Record<string, string | number | boolean | null> = {
    reason: reading.reason,
    root: reading.root,
    branch: reading.branch,
    head: reading.head,
    dirty: reading.dirty,
    behindBy: reading.behindBy,
    originMaster: reading.originMaster,
    atMaster: reading.atMaster,
    timedOut: reading.timedOut,
  };
  if (reading.reason === "not-a-repo") {
    return [finding("checkout", "green", "Checkout", "not a git checkout — an installed package, nothing to grade", "", data)];
  }
  if (reading.reason === "unreadable") {
    return [
      finding(
        "checkout",
        "green",
        "Checkout",
        reading.timedOut
          ? `${reading.root} — git did not answer within ${CHECKOUT_BUDGET_MS} ms, so the checkout was not graded`
          : reading.head === null
            ? `${reading.root} — git did not answer, so the checkout was not graded`
            : `${reading.root} — no ${ORIGIN_MASTER} as last fetched, so there is nothing to grade against`,
        "",
        data,
      ),
    ];
  }
  const where = `${reading.branch ?? "detached"}@${reading.head ?? "?"}`;
  if (reading.reason === "master") {
    return [
      finding("checkout", "green", "Checkout", `${reading.root} at origin/master (${where}), clean`, "", data),
    ];
  }
  if (reading.reason === "behind") {
    // AMBER, and deliberately not red: what runs is old, but it is merged code.
    // A merge to origin/master does not deploy — this tree has to move.
    return [
      finding(
        "checkout",
        "amber",
        "Checkout",
        `${where} is behind origin/master by ${String(reading.behindBy ?? 0)} commit${reading.behindBy === 1 ? "" : "s"} as last fetched — master moved and this checkout did not`,
        `Move the checkout: git -C ${reading.root} pull --ff-only (the hooks run what is in that tree, not what is on the remote).`,
        data,
      ),
    ];
  }
  const what =
    reading.reason === "dirty"
      ? `the live hooks are running a modified checkout: ${where}, ${reading.dirty} tracked file${reading.dirty === 1 ? "" : "s"} modified`
      : `the live hooks are running an unmerged checkout: ${where}, which is not an ancestor of origin/master`;
  return [
    finding(
      "checkout",
      "red",
      "Checkout",
      what,
      `Return ${reading.root} to origin/master (git -C ${reading.root} checkout master) — what is in that tree is live on the owner's memory.`,
      data,
    ),
  ];
}

/**
 * THE OPEN ITSELF — red when a session's own read path would throw here.
 *
 * The wording is the hook's: one code and one clause of plain words, so the red
 * line in the terminal and this line say the same thing about the same morning.
 */
function openFindings(reading: OpenReading): Finding[] {
  const data: Record<string, string | number | boolean | null> = {
    dir: reading.dir,
    ok: reading.ok,
    code: reading.code,
    busy: reading.busy,
    path: reading.path,
  };
  if (reading.ok) {
    return [
      finding("store-open", "green", "Store open", `${reading.dir} opens as a session opens it`, "", data),
    ];
  }
  const said = `${reading.dir}: will not open — ${reading.code ?? "?"}: ${reading.reason}`;
  if (reading.busy) {
    // NOT A STATE OF THE STORE. Another process held it for the moment this
    // reading wanted it; a second later it may open perfectly. Grading that red
    // would put an alarm on a race, which is how a diagnostic teaches its reader
    // to skip a line.
    return [
      finding(
        "store-open",
        "amber",
        "Store open",
        `${reading.dir}: the database was busy right now, so the open was not graded`,
        "Run: counterparts doctor again. If it stays busy, something is holding the store — read the Journal line.",
        data,
      ),
    ];
  }
  if (reading.migratable) {
    return [
      finding(
        "store-open",
        "amber",
        "Store open",
        `${said} — read as an instrument, which may not write at open`,
        "The next hook to run as owner initializes or migrates it; run: counterparts install if none does.",
        data,
      ),
    ];
  }
  return [
    finding(
      "store-open",
      "red",
      "Store open",
      said,
      reading.path !== null
        ? `Every session's hooks stand down here. Restore ${reading.path} — a row in this store points at it, and the read path chases it at every open.`
        : reading.id !== null
          ? // THE ROW, NAMED. On the file floor this said "restore <path>" and the
            // owner could fetch that one file from a snapshot; the words are the
            // row now, so the id is the only handle there is — and without it he
            // cannot tell which of thousands of rows to act on (review B,
            // MAJOR-3). There is no repair COMMAND for this today, so the two
            // real exits are named rather than a command invented.
            `Every session's hooks stand down here: no wake, no recall, no capture. The row the read path ` +
            `met is ${reading.id} — its words are gone and its content hash still names them, which no write ` +
            `path in this build produces. THERE MAY BE MORE THAN ONE: this names the row that threw, and ` +
            `counterparts verify --dir <store> lists every such row. Two ways out, both the owner's call: ` +
            `restore a snapshot over the store (see the Snapshot line), or remove those rows — ` +
            `counterparts remove <id> --confirm --dir <store> — which tombstones each one and lets sessions ` +
            `start again, permanently and without its words.`
          : "Every session's hooks stand down here: no wake, no recall, no capture. The code names what the read path met.",
      data,
    ),
  ];
}

/** Coverage of the semantic channel — `verify`'s two census numbers, reused. */
/**
 * Which journal mode box 2 is actually in — the one surface on which a
 * conversion that did not take becomes visible.
 *
 * `openDb` asks for WAL on a writer open and swallows a refusal, because a hook
 * must not die because the worker happened to be committing (`store/db.ts`).
 * That is right, and it is silent, so the MODE is the report. Reading it takes
 * no lock and converts nothing: this is an observer's question, and the console
 * that asks it is standing down.
 */
function journalFindings(store: Store): Finding[] {
  const mode = journalModeOf(paths.operational(store.dir));
  const data = { mode };
  if (mode === "wal") {
    return [
      finding("journal", "green", "Journal mode", `wal (busy timeout ${BUSY_TIMEOUT_MS} ms)`, "", data),
    ];
  }
  return [
    finding(
      "journal",
      "amber",
      "Journal mode",
      `${mode}, not wal — several processes hold this store open at once, and only in wal does a reader never wait for the writer`,
      "Open one session, or run any command that writes: the next writer open converts it. If it keeps reading this, something on an older build is opening the store and setting it back.",
      data,
    ),
  ];
}

function vectorFindings(input: DoctorInput, store: Store): Finding[] {
  // NOTHING TO EMBED, NOTHING TO SAY (finding #24). With the embedder off every
  // live memory has no vector, so this line reported the whole store as a
  // shortfall — an amber that cannot be cleared except by buying a key, beside
  // an `OFF` line that has already said the feature is not on. The coverage of
  // a channel nobody switched on is not a reading anybody needs; the moment it
  // IS on, the line comes back and counts.
  if (input.config.embedder?.enabled !== true) return [];
  const unembedded = store.unembeddedCount();
  const skipped = store.skippedVectorIds().length;
  const detail = `${unembedded} live memories with no vector, ${skipped} skipped after repeated embed failures`;
  const data = { unembedded, skipped };
  if (skipped > 0) {
    return [finding("vectors", "amber", "Vectors", detail, "counterparts verify --dir <store> --retry-skipped puts the skipped ids back in the rotation.", data)];
  }
  if (unembedded > 0) {
    return [finding("vectors", "amber", "Vectors", detail, "The backfill embeds up to 64 per boundary; this number must fall run over run.", data)];
  }
  return [finding("vectors", "green", "Vectors", detail, "", data)];
}

/**
 * THE JOURNAL'S MARKDOWN COPY (2026-09-20, F6) — A LINE ONLY WHEN ONE IS OWED.
 *
 * This group returns NOTHING in the ordinary case, which is the deliberate part.
 * The copy is derived: it is rewritten on every chapter and refilled at every
 * boundary, so "how many files are there" is a number nobody needs and a
 * permanently green line here would be one more row the owner learns to skip
 * (the same argument `snapshotFindings` makes about a permanently amber one).
 *
 * The one reading worth a line is a STANDING failure: the newest
 * `journal.copy.failed` row is newer than the newest `journal.copy.written`,
 * which means the last attempt did not land and the next one has not fixed it.
 * Amber, never red — the chapter itself is a row in the database and is not at
 * risk, which is exactly what the detail says.
 */
export function journalCopyFindings(store: Store): Finding[] {
  const day = store.livedDay();
  const failed = newestRows(store, JOURNAL_COPY_FAILED_EVENT, 1, day);
  if (failed.unknown || failed.rows.length === 0) return [];
  const newestFailed = failed.rows[failed.rows.length - 1] as EventRow;
  const written = newestRows(store, JOURNAL_COPY_WRITTEN_EVENT, 1, day);
  const newestWritten = written.rows[written.rows.length - 1];
  // A later success is the fix, and a fixed fault is not a line.
  if (newestWritten !== undefined && newestWritten.seq > newestFailed.seq) return [];
  const payload = payloadOf(newestFailed);
  const reason = typeof payload["reason"] === "string" ? payload["reason"] : "no reason recorded";
  const on = typeof payload["date"] === "string" ? payload["date"] : "(date unrecorded)";
  const episode = newestFailed.ref ?? "(unrecorded)";
  return [
    finding(
      "journal-copy",
      "amber",
      "Journal copy",
      `the readable copy of the journal could not be written on ${on} (${episode}: ${reason}), and nothing has written one since. The chapters themselves are rows in the database and are unharmed.`,
      "Check that the store directory is writable; the next chapter or the next session boundary writes it again, and deleting journal/ loses nothing.",
      { episode, reason, on },
    ),
  ];
}

/**
 * THE SELF PAGE (2026-09-18, S1) — one line: is there one, how big, how old.
 *
 * GREEN when absent, amber when stale, and never red. A store with no page has
 * not written one yet, which is the correct state of a fresh install and on the
 * first day after this ships — absence is a fact, not a fault, and a line that
 * nags from the moment it lands is a line people learn to read past (the same
 * rule `fired.ts` states for its `blind` rows). Staleness is the reading worth
 * an amber: a page that exists and has stopped being revised means something
 * that was running has stopped.
 *
 * The reading is two row reads and a date comparison, so it sits with the cheap
 * groups rather than with `fired`.
 */
export function selfPageFindings(store: Store): Finding[] {
  const page = readSelfPage(store);
  if (page === null) {
    // CLEARED is not NEVER WRITTEN. The wake says the same thing either way — it
    // has no page — but a line telling the owner nothing was ever written, about
    // a page he cleared last week, is the diagnostic getting it wrong in the one
    // place he would look to check (adversarial review MINOR-F).
    const cleared = clearedPage(store);
    if (cleared !== null) {
      return [
        finding(
          "self-page",
          "green",
          "Self page",
          `cleared ${cleared.on === "" ? "(date unrecorded)" : `on ${cleared.on}`}` +
            `${cleared.reason === "" ? "" : ` — ${cleared.reason}`}; ${cleared.versions} version${cleared.versions === 1 ? "" : "s"} kept`,
          cleared.versions > 0
            ? `Put one back with: counterparts self-page --restore ${cleared.newest}.`
            : "",
          { present: false, cleared: true, on: cleared.on, versions: cleared.versions },
        ),
      ];
    }
    return [
      finding(
        "self-page",
        "green",
        "Self page",
        "not written yet — still forming",
        "",
        { present: false, cleared: false },
      ),
    ];
  }
  const stale = pageStaleOn(page.revisedOn, dateOf(store.now()), SELF_TUNABLES.PAGE_STALE_DAYS);
  const detail =
    `${page.bytes} bytes, version ${page.version}, last revised ${page.revisedOn === "" ? "(unrecorded)" : page.revisedOn}` +
    `${page.by === null ? "" : ` by ${page.by}`}`;
  const data = { present: true, bytes: page.bytes, version: page.version, revisedOn: page.revisedOn, stale };
  return [
    stale
      ? finding(
          "self-page",
          "amber",
          "Self page",
          `${detail} — stale (over ${SELF_TUNABLES.PAGE_STALE_DAYS} days)`,
          "Nothing has revised it lately: check the page writer, or amend it yourself with counterparts self-page --write.",
          data,
        )
      : finding("self-page", "green", "Self page", detail, "", data),
  ];
}

/**
 * THE NIGHTLY PAGE WRITER (2026-09-20, S2) — one line: has last night happened,
 * and what did it come to.
 *
 * **GREEN when it has never run on a store younger than a day**, and that is
 * the whole design of this line rather than a leniency. A mechanism that fires
 * once a night cannot have fired on a store installed this morning, and a line
 * that says something is wrong from the moment it lands is a line people learn
 * to read past — the same rule `fired.ts` states for its `blind` rows and the
 * same one `selfPageFindings` follows for an absent page.
 *
 * Green also for a night that read the day and had nothing to say: that is the
 * mechanism working, and it is stated in words rather than left as a silence.
 *
 * AMBER, with a fix, on the two readings that mean something has stopped: the
 * writer is switched off while a page exists (somebody turned it off and the
 * page will now only move by hand), and a run that failed or was refused. Never
 * red: nothing here can cost a session its memory.
 */
export function pageWriterFindings(store: Store, config: AdapterConfig): Finding[] {
  const mode = pageWriterMode(config);
  const today = dateOf(store.now());
  const about = pageWriterAbout(today);
  const last = lastPageWriterRun(store);
  const page = readSelfPage(store);
  const data = {
    mode,
    lastAbout: last?.about ?? "",
    lastOutcome: last?.outcome ?? "",
    ran: last !== null,
  };
  // A BLOCK THAT COULD NOT BE READ IS AMBER, AND IT SAYS WHICH KEY. The block is
  // lenient now (S2 review), so a typo costs the setting rather than the store's
  // memory — but a setting that silently did nothing is the other half of that
  // failure, and this is the line that stops it being silent.
  const ignored = config.pageWriter?.ignored ?? [];
  if (ignored.length > 0) {
    return [
      finding(
        "page-writer",
        "amber",
        "Page writer",
        `${mode} mode; ${ignored.join("; ")}`,
        "Fix the pageWriter block in claude-code.json. Nothing else in the file was affected, and memory is unaffected.",
        { ...data, ignored: ignored.join(" | ") },
      ),
    ];
  }
  if (mode === "off") {
    // GREEN, always. Off is a setting somebody chose, and a diagnostic that
    // grades a deliberate choice as a fault is the shape of line people learn to
    // read past — the same rule `fired.ts` states for a `disabled` mechanism.
    // The line still says what off MEANS, so nobody has to remember.
    return [
      finding(
        "page-writer",
        "green",
        "Page writer",
        page === null
          ? "off — nothing writes the self page on its own, and nothing has been written by hand either"
          : "off — the page stands, and from here it changes only when somebody writes it",
        "",
        data,
      ),
    ];
  }
  if (last === null) {
    // NEVER RUN. On a store with no yesterday that is the correct state and
    // says so; on one that has lived a day it is still green, because the
    // mechanism runs at the NEXT session start and has not been given a turn.
    const young = !hasDayBefore(store, today);
    return [
      finding(
        "page-writer",
        "green",
        "Page writer",
        young
          ? `${mode} mode; never run — this store has no day before ${today} yet`
          : `${mode} mode; never run — the next session start is its first turn (${about})`,
        "",
        { ...data, young },
      ),
    ];
  }
  const status = pageWriterStatus(store, last.about, today);
  const when = `last ran for ${last.about}${last.on === "" ? "" : ` on ${last.on}`}`;
  // IS TONIGHT'S ALREADY OWED, AND HAS IT BEEN OWED FOR A WHILE? The failure
  // this catches is the one with no row at all behind it: an ask that will not
  // fit the host's ceiling is DEFERRED, and a deferral leaves only a ring event
  // that dies with the hook process. Without this line, a writer that stopped
  // being delivered on day 4 reads exactly like one that ran last night —
  // which is I32's shape, and the reason this line exists at all.
  const owed = pageWriterDue(store, {
    mode,
    today,
    observer: store.observer,
    asksPerDay: SELF_TUNABLES.PAGE_WRITER_ASKS_PER_DAY,
  });
  const staleFor = last.on === "" ? 0 : daysBetween(last.on, today);
  const overdue = owed.due && staleFor > PAGE_WRITER_STALE_DAYS;
  const bad = status.outcome === "failed" || status.outcome === "refused";
  const detail =
    `${mode} mode; ${when} — ${status.outcome}` +
    (status.derived ? " (derived: it was handed the day and wrote nothing)" : "") +
    (status.run !== null && status.run.detail.length > 0 && !status.derived
      ? `, ${status.run.detail}`
      : "") +
    (owed.due ? `; ${owed.about} is owed` : "") +
    (overdue ? ` and nothing has been delivered for ${String(staleFor)} days` : "");
  return [
    finding(
      "page-writer",
      bad || overdue ? "amber" : "green",
      "Page writer",
      detail,
      bad || overdue
        ? "counterparts fired --dir <store> --observer shows the run's own row. A night that is owed but never delivered is usually the host's injection ceiling: the block is deferred rather than truncated, so raise injectionBudgetBytes or run the writer in host mode. counterparts self-page --write amends the page by hand meanwhile."
        : "",
      {
        ...data,
        outcome: status.outcome,
        derived: status.derived,
        owedFor: owed.due ? owed.about : "",
        staleFor,
      },
    ),
  ];
}

// `daysBetween` is `fired.ts`'s (E2, 2026-09-20) and is imported at the top of
// this file rather than written twice. S2 landed a local copy of the same four
// lines and the merge put them side by side; one definition is the rule this
// module already keeps for every other reading it shares with the fired view.
// The one behavioural difference is deliberate: the shared one can return a
// NEGATIVE when a clock has moved backwards, and `overdue` below compares with
// `>`, so a future date reads "not overdue" rather than being clamped to today.

/** Calendar days a night may be owed before the line says so. A writer that
 *  missed last night has not failed; one that has missed three has. */
export const PAGE_WRITER_STALE_DAYS = 2;

/** A page that was written and then cleared: when, why, and what is restorable.
 *  Null when no page row exists at all. */
function clearedPage(
  store: Store,
): { on: string; reason: string; versions: number; newest: number } | null {
  const id = findPageRow(store);
  if (id === null) return null;
  let marker: { on: string; reason: string } | null = null;
  try {
    marker = clearedMarker(store.readProse(id).meta);
  } catch {
    return null;
  }
  if (marker === null) return null;
  const versions = store.versions(id);
  const newest = versions.reduce((n, v) => Math.max(n, v.seq), 0);
  return { ...marker, versions: versions.length, newest };
}

/**
 * Calendar days, like every other window here. A date that is absent or does
 * not READ reads as stale — the same direction `self/#pageStale` takes, and the
 * two are asserted to agree.
 */
function pageStaleOn(revisedOn: string, today: string, limit: number): boolean {
  const on = revisedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return true;
  const a = Date.parse(`${on}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.round((b - a) / 86_400_000) > limit;
}

/**
 * How to get a memory back. Short enough to survive being read in a panic, and
 * printed as the remedy on every Snapshot finding that is not green, because the
 * moment somebody needs it is the moment they will not go looking for it.
 */
export const RESTORE_STEPS =
  "To restore: stop every session, copy a snapshot directory to the store's path, " +
  "then counterparts verify --dir <store> --rebuild (with the embed key exported, or " +
  "the vectors are dropped and refilled over the following days). Everything comes back " +
  "with the copy — the memories, their versions and the journal are all in the database; " +
  "the search index and the vectors are rebuilt. A copy holding operational.sqlite or " +
  "prose/ is from BEFORE the floor changed and this build cannot open it: it is kept and " +
  "counted, never rotated, and the build tagged floor/v5-last reads it.";

/** How stale the newest snapshot may be before this line goes amber. A daily
 *  mechanism that has not fired for two calendar days has missed one. */
export const SNAPSHOT_STALE_DAYS = 2;

/**
 * IS THERE A RECENT COPY OF THE STORE, AND HOW MANY ARE ACTUALLY THERE.
 *
 * The one line that answers "if this database were wiped this afternoon, what
 * would come back" — so it **counts the directory**, not the row. The first
 * version of this finding read `kept` and `oldest` straight out of the newest
 * `snapshot.taken` row, and the F2 review proved what that is worth: delete every
 * copy from disk and the line still read green, "1 kept", for a full day, then
 * went amber for the wrong reason. A row says what a run once wrote. The
 * directory says what you have.
 *
 * Reading a directory listing writes nothing, so this is observer-safe.
 *
 * Amber, never red: a missing backup is not a broken memory, and a diagnostic
 * that shouts the same colour for both teaches its reader to read past the one
 * that matters.
 */
function snapshotFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  const resolved = resolveSnapshotsDir(input.dir, input.config.snapshots?.dir);
  const keep = keepOf(input.config.snapshots?.keep);
  // What the configuration could not read, said out loud rather than left as a
  // default nobody asked for (F2 review, MAJOR-2). It rides on every arm below.
  const ignored = input.config.snapshots?.ignored ?? [];
  const misread = ignored.length === 0 ? "" : ` — ${ignored.join("; ")}`;
  const data: Record<string, string | number | boolean | null> = {
    keep,
    where: resolved.reason,
    ignored: ignored.length === 0 ? null : ignored.join("; "),
  };
  if (resolved.dir === null) {
    // Not a fault and not a silence: this store is not the `store/` subdirectory
    // of a base directory, so there is nowhere by convention to put copies.
    return [
      finding(
        "snapshot",
        "amber",
        "Snapshots",
        `no daily snapshot is being taken: this store is not inside a base directory, so there is no default place to keep copies${misread}`,
        'Add "snapshots": { "dir": "<an absolute path outside the store>" } to the configuration.',
        data,
      ),
    ];
  }

  // THE DISK, FIRST. Everything printed below about how many copies there are
  // comes from here.
  const disk = readSnapshotsDir(resolved.dir);
  const onDisk = disk.names.length;
  const newest = disk.names[onDisk - 1] ?? null;
  const oldest = disk.names[0] ?? null;
  const future = futureNamesIn(disk.names, Date.parse(`${input.today}T00:00:00Z`)).length;
  // A correctly-named directory the layout rule does not recognise as a copy is
  // KEPT — this package never deletes what it cannot prove it made — but it is
  // never counted and never rotated either, so without this clause it would be
  // permanent, invisible residue in the one directory the owner relies on
  // (second F2 review, MAJOR-A).
  const strange =
    disk.unrecognised.length === 0
      ? ""
      : `; ${String(disk.unrecognised.length)} director${disk.unrecognised.length === 1 ? "y is" : "ies are"} named like snapshots but do not look like copies of a store, so they are not counted and will never be rotated: ${disk.unrecognised.slice(0, 3).join(", ")}${disk.unrecognised.length > 3 ? ` and ${String(disk.unrecognised.length - 3)} more` : ""}`;
  // PRE-ROWS COPIES ARE SAID, AND THEY ARE NOT A FAULT (review B, MAJOR-2 and
  // NIT-3/-4). After cut-over the owner's snapshots directory holds his old
  // floor's copies permanently: they are never rotated, because this build
  // cannot open one to know what is in it. That is the right outcome and it
  // must not read as a problem — a permanently amber Snapshot line is a line
  // people learn to skip. So it is a clause on the ordinary sentence, and the
  // grading below deliberately does not consider it.
  const older =
    disk.preRows.length === 0
      ? ""
      : `; ${String(disk.preRows.length)} older-format cop${disk.preRows.length === 1 ? "y" : "ies"} this build cannot open — kept, never rotated, read by the build tagged floor/v5-last: ${disk.preRows.slice(0, 3).join(", ")}${disk.preRows.length > 3 ? ` and ${String(disk.preRows.length - 3)} more` : ""}`;
  const held = {
    ...data,
    onDisk,
    newest,
    oldest,
    readable: disk.readable,
    future,
    unrecognised: disk.unrecognised.length,
    preRows: disk.preRows.length,
  };

  const read = newestRows(store, SNAPSHOT_TAKEN_EVENT, 1, livedDay);
  const row = read.unknown ? undefined : read.rows[0];
  const rowDated = rowDate(row);

  // A ROW SAYS A COPY WAS MADE AND THE DIRECTORY HOLDS NONE. The loudest thing
  // this line can say, and the case the review proved read green.
  if (onDisk === 0 && (rowDated !== null || read.unknown)) {
    return [
      finding(
        "snapshot",
        "amber",
        "Snapshots",
        `${disk.readable ? "the snapshots directory is empty" : "the snapshots directory is missing or unreadable"} — but a snapshot.taken row says one was made${rowDated === null ? "" : ` on ${rowDated}`}. There is nothing to restore from.${strange}`,
        RESTORE_STEPS,
        { ...held, rows: 1 },
      ),
    ];
  }

  if (onDisk === 0) {
    // The same rule the row findings use: an absent copy is only evidence once a
    // boundary has been reached. On a fresh install there has been no worker run
    // to take a first one, and an amber there is decoration.
    const boundaries = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
    const lived = boundaries.unknown || boundaries.rows.length > 0;
    const failed = newestRows(store, SNAPSHOT_FAILED_EVENT, 1, livedDay);
    const failedRow = failed.rows[0];
    const why =
      failedRow === undefined
        ? ""
        : ` — newest ${SNAPSHOT_FAILED_EVENT} ${rowDate(failedRow) ?? "?"} (${str(payloadOf(failedRow), "step") ?? "?"}: ${str(payloadOf(failedRow), "reason") ?? "?"})`;
    return [
      lived
        ? finding(
            "snapshot",
            "amber",
            "Snapshots",
            `no snapshot has ever been taken here${why}${strange}${misread}`,
            "The worker takes one after the sleep cycle; the next boundary should leave a snapshot.taken row.",
            { ...held, rows: 0 },
          )
        : finding(
            "snapshot",
            "green",
            "Snapshots",
            `no snapshot yet — and no boundary has been reached here yet${strange}${misread}`,
            "",
            { ...held, rows: 0 },
          ),
    ];
  }

  // Copies exist. Their own names carry the date, so the line does not depend on
  // a row at all — and when a row disagrees with the directory, it says so.
  const newestDate = (newest ?? "").slice(0, 10);
  // THE OLDEST COPY IS A `--json` FACT, NOT A SCREEN ONE (2026-09-22). "last
  // 2026-09-22, 2 kept" answers the question a person has; the oldest date only
  // matters when the rotation is being reasoned about, and `data.oldest` carries
  // it for whoever is doing that.
  const detail =
    `last ${newestDate}, ${onDisk} kept` +
    (keep === DEFAULT_KEEP ? "" : ` (keeping ${keep})`) +
    (future === 0 ? "" : `; ${future} dated in the future, holding a slot each`) +
    (rowDated !== null && rowDated > newestDate
      ? `; the newest snapshot.taken row says ${rowDated}, which is not on disk`
      : "") +
    strange +
    older +
    misread;
  // Two or more calendar days back is a daily mechanism that has missed one, so
  // the boundary day itself is already amber.
  const stale = newestDate === "" || newestDate <= daysBefore(input.today, SNAPSHOT_STALE_DAYS);
  const disagrees = rowDated !== null && rowDated > newestDate;
  return [
    stale || disagrees || future > 0 || disk.unrecognised.length > 0 || ignored.length > 0
      ? finding(
          "snapshot",
          "amber",
          "Snapshots",
          stale ? `${detail} — ${SNAPSHOT_STALE_DAYS} days ago or more` : detail,
          stale
            ? "The copy is taken by the worker after a boundary; read the Spawn line below."
            : RESTORE_STEPS,
          held,
        )
      : finding("snapshot", "green", "Snapshots", detail, "", held),
  ];
}

// ── the two steps the user does BY HAND ─────────────────────────────

/**
 * DID THE HOOKS BLOCK AND THE MCP REGISTRATION ACTUALLY TAKE (finding 4).
 *
 * `install` prints those two and applies neither, correctly: they edit somebody
 * else's editor configuration. But nothing then checked them, so a user who
 * pasted the block into a project settings file instead of the user one — or
 * never restarted — got a fully green `doctor` and total silence. The failure
 * mode of this product is silence, which is the one thing a diagnostic exists
 * to break.
 *
 * **THE READ IS THE CALLER'S** (`cli/install.ts#readHost`), for the reason
 * `checkout` and `open` are: it is four small file reads outside this store, in
 * a format that belongs to the host, and the adapters here are leaves that do
 * not import each other. What comes in carries the host's own vocabulary —
 * which events were expected, what the server is called — so this file grades
 * and keeps nothing it would have to hold in step.
 *
 * AMBER, NEVER RED, and it always says which files it read: `~/.claude.json` is
 * the host's own state file, documented as one the host writes for itself, so a
 * negative answer here is "I looked at these and did not find it", never "you
 * did not install it".
 */
export interface HostReading {
  /** The events a full install covers, in the host's spelling. */
  readonly expected: readonly string[];
  /** Which of `expected` carry a command that looks like ours. */
  readonly events: readonly string[];
  /** Events whose command names a path that is not on disk — installed, and
   *  failing silently at every session start. */
  readonly stale: readonly { event: string; path: string }[];
  /** Every settings file this read actually opened and parsed. */
  readonly settingsRead: readonly string[];
  /** Files that exist and could not be opened or parsed — not the same fact as
   *  "there is no such file", and not something to stay quiet about. */
  readonly settingsUnreadable: readonly string[];
  /** True when the MCP server is registered at user scope. */
  readonly mcp: boolean;
  readonly mcpName: string;
  readonly mcpFile: string;
  /** The MCP file exists but could not be read or parsed. */
  readonly mcpUnreadable: boolean;
}

function hostFindings(reading: HostReading): Finding[] {
  const total = reading.expected.length;
  const missing = reading.expected.filter((e) => !reading.events.includes(e));
  const stale = reading.stale;
  const where = [
    reading.settingsRead.length === 0
      ? "no host settings file was readable"
      : `read ${reading.settingsRead.join(", ")}`,
    // AN UNREADABLE FILE IS SAID OUT LOUD. Dropping it silently is how a
    // mode-000 settings file reads as an absent one, and the reader is then
    // told to paste a block they have already pasted.
    reading.settingsUnreadable.length === 0
      ? ""
      : `could not read ${reading.settingsUnreadable.join(", ")}`,
  ]
    .filter((s) => s.length > 0)
    .join("; ");
  const data: Record<string, string | number | boolean | null> = {
    events: reading.events.join(","),
    missing: missing.join(","),
    stale: stale.map((s) => `${s.event}→${s.path}`).join(","),
    settingsRead: reading.settingsRead.join(","),
    settingsUnreadable: reading.settingsUnreadable.join(","),
    mcp: reading.mcp,
    mcpFile: reading.mcpFile,
  };
  const mcpClause = reading.mcp
    ? `the MCP server is registered in ${reading.mcpFile}`
    : reading.mcpUnreadable
      ? `${reading.mcpFile} could not be read, so the MCP registration could not be checked`
      : `no MCP server named "${reading.mcpName}" in ${reading.mcpFile}`;

  if (missing.length === 0 && stale.length === 0 && reading.mcp) {
    // THE ONE LINE THE PERSON CAME FOR: is my assistant joined up to this
    // memory? It says `connected` because that is the verb the command has
    // (`counterparts connect`), and it names the two halves — the hooks and the
    // tools — rather than a file format nobody asked about. `--json` still
    // carries every event name and every path in `data`.
    return [
      finding(
        "host",
        "green",
        "Claude Code",
        `connected: ${String(total)} hooks and the memory tools`,
        "",
        data,
      ),
    ];
  }
  // THE FIX IS `connect` NOW, NOT `install` (2026-09-21, A; renamed from `wire`
  // 2026-09-22). Until that change the only thing the package could do about a
  // missing hook was PRINT a block, so the fix line sent a reader to the command
  // that prints it and then asked them to paste. `counterparts connect` does the
  // paste: it backs the file up, merges beside whatever else is on those events,
  // and repairs an entry of ours that names a path that has moved — which is
  // precisely the `stale` case below. A fix line that names the longer way round
  // is a fix line somebody follows.
  //
  // ONE SENTENCE, whatever is wrong: the three cases below were three separate
  // fix lines that each began "Run: counterparts connect", and a reader with
  // two of them was told to run the same command twice.
  const does: string[] = [];
  if (missing.length > 0) does.push("adds the hooks beside anything already there");
  if (stale.length > 0) {
    does.push(
      `replaces the ${stale.length === 1 ? "stale entry" : "stale entries"} with the path this install actually has`,
    );
  }
  if (!reading.mcp && !reading.mcpUnreadable) does.push("registers the memory tools");
  const fixes =
    does.length === 0
      ? []
      : [
          `Run: counterparts connect — it backs up ~/.claude/settings.json, ${
            does.length === 1 ? does[0] : `${does.slice(0, -1).join(", ")} and ${does[does.length - 1] ?? ""}`
          }. Then restart Claude Code.`,
        ];
  // STALE FIRST. "GREEN while nothing fires" is the one outcome this line was
  // added to prevent, and a block pointing at a deleted checkout is exactly
  // that: it matches, it is installed, and every session start fails silently.
  const staleClause =
    stale.length === 0
      ? ""
      : `${stale.map((s) => s.event).join(", ")} point${stale.length === 1 ? "s" : ""} at ${stale
          .map((s) => s.path)
          .join(", ")}, which is not there`;
  const connected =
    missing.length === total
      ? `no hook of ours is connected on any of the ${String(total)} events`
      : missing.length > 0
        ? `connected on ${reading.events.join(", ")} but NOT on ${missing.join(", ")}`
        : `all ${String(total)} hook events are connected`;
  const detail = [staleClause, connected, `(${where})`, mcpClause]
    .filter((s) => s.length > 0)
    .join("; ")
    .replace("; (", " (");
  return [finding("host", "amber", "Claude Code", detail, fixes.join(" "), data)];
}

// ── the reading ─────────────────────────────────────────────────────────────

const RANK: Record<Severity, number> = { red: 0, amber: 1, green: 3 };

/**
 * FOUR TIERS, THREE SEVERITIES. `OFF` sits between the ambers and the greens:
 * it is not a warning (nothing is wrong) and it is not a pass (the feature is
 * not running), and a real amber — a stale snapshot, a failed phase — must
 * never print BELOW a line saying an optional extra was never switched on.
 * The tier is computed here, once, because `reportLines`, `reportJson`, the
 * terminal renderer and the notice all read their order through this function.
 */
export function tierOf(f: Finding): number {
  return f.severity === "amber" && f.optional === true ? 2 : RANK[f.severity];
}

/** Worst first, stable within a tier — the order the report and the notice
 *  both read. */
export function worstFirst(findings: readonly Finding[]): Finding[] {
  return [...findings]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => tierOf(a.f) - tierOf(b.f) || a.i - b.i)
    .map((x) => x.f);
}

/** The four words a grade is printed as. `OFF` is dim wherever there is
 *  colour; in plain text it is just the word, which is the point (§2.4 — an
 *  absence is displayed, never merely un-highlighted). */
export type GradeWord = "RED" | "AMBER" | "OFF" | "GREEN";

export function gradeWord(f: Finding): GradeWord {
  return f.severity === "amber" && f.optional === true ? "OFF" : (f.severity.toUpperCase() as GradeWord);
}

/** How many of each word are in a reading — the summary's own arithmetic, and
 *  `--json`'s, from one place so the two cannot disagree. */
export function tally(findings: readonly Finding[]): Record<Lowercase<GradeWord>, number> {
  const out = { red: 0, amber: 0, off: 0, green: 0 };
  for (const f of findings) out[gradeWord(f).toLowerCase() as Lowercase<GradeWord>] += 1;
  return out;
}

/**
 * `0 red, 0 amber, 2 off, 5 green.` — the summary, from a tally.
 *
 * The `off` term appears only when something IS off: a store with both keys in
 * place should not be told about a column it has nothing in. "Nothing to fix."
 * is gone with the owner's answer 12 — the counts are the one line he reads to
 * the end, and a sentence that replaced them made the two arms of this report
 * say different things about the same store.
 */
export function summaryLine(t: Record<Lowercase<GradeWord>, number>): string {
  return (
    `${String(t.red)} red, ${String(t.amber)} amber` +
    (t.off === 0 ? "" : `, ${String(t.off)} off`) +
    `, ${String(t.green)} green.`
  );
}

/**
 * THE READING. Pure over its input, worst first, and never a write.
 *
 * Groups run cheapest-and-most-diagnostic first, and the budget is checked
 * BETWEEN them: the config, the credentials and the counters are answered before
 * anything walks the event log, so a reading that runs out of time still carries
 * I32's own signature.
 */
export function doctorFindings(input: DoctorInput): Finding[] {
  const now = input.now ?? ((): number => Date.now());
  const deadline = input.budgetMs === undefined ? null : now() + input.budgetMs;
  const unread = input.configReason === "not-read";
  // TWO BOUNDED READS, before anything else touches the store: whether a key
  // has ever worked HERE is what decides red from amber — and now `OFF` from
  // amber — on the lines a new user reads first (finding 1, finding #24).
  // Cheap enough for the session-start budget: one indexed row, plus a window
  // of backfill rows.
  //
  // NOT WHEN NO CONFIGURATION WAS READ: the credentials file is named by the
  // configuration, so there is nothing to report on and the Config line above
  // has already said so.
  const history = unread ? { interpreted: false, embedded: false } : keyHistory(input.store);
  const out: Finding[] = [
    ...configFindings(input),
    // THE TWO OPTIONAL FEATURES, in the order the screen reads them: recall by
    // meaning first, because it is the one a person is most likely to want.
    ...(unread ? [] : embedderFindings(input, history)),
    ...(unread ? [] : credentialFindings(input, history)),
    // Already READ by the caller (the git calls are its own bounded business),
    // so this costs nothing here and is answered before any store read.
    ...(input.checkout === undefined ? [] : checkoutFindings(input.checkout)),
    // Read by the caller for the same reason, and answered beside the `Store`
    // line it qualifies: "there is a store here" and "it opens" are two facts.
    ...(input.open === undefined ? [] : openFindings(input.open)),
    // DID THE HOST STEPS TAKE (finding 4). Also read by the caller — it is four
    // small file reads outside this store, and the hook does not pay for them.
    ...(input.host === undefined ? [] : hostFindings(input.host)),
  ];
  const store = input.store;
  if (store === null) return worstFirst(out);

  const groups: (readonly [string, () => Finding[]])[] = [
    ["spawn", () => spawnFindings(input, store)],
    ["clock", () => clockFindings(input, store)],
    ["rows", () => rowFindings(input, store)],
    ["authorship", () => authorshipFindings(input, store)],
    ["journal", () => journalFindings(store)],
    ["vectors", () => vectorFindings(input, store)],
    // The snapshot policy lives in the configuration, so with none read this
    // line would grade a default nobody chose.
    ...(unread ? [] : [["snapshot", (): Finding[] => snapshotFindings(input, store)] as const]),
    ["self-page", () => selfPageFindings(store)],
    ["page-writer", () => pageWriterFindings(store, input.config)],
    // F6: silent unless a copy failure is standing. Two bounded event reads.
    ["journal-copy", () => journalCopyFindings(store)],
    // LAST, and deliberately: it is the widest read here — the whole event log,
    // plus a pass over the ids for the table probes — so when the console's
    // reading is cut short this is the group that goes, and the `Budget` finding
    // below says so rather than leaving a silent gap. A budgeted reading does
    // not take it at all; see `firedFindings`.
    ["fired", () => firedFindings(input, store)],
  ];
  const skipped: string[] = [];
  for (const [name, read] of groups) {
    if (deadline !== null && now() > deadline) {
      skipped.push(name);
      continue;
    }
    out.push(...read());
  }
  if (skipped.length > 0) {
    out.push(
      finding(
        "budget",
        "amber",
        "Budget",
        `the session-start reading stopped after ${String(input.budgetMs)} ms and did not read: ${skipped.join(", ")}`,
        "Run: counterparts doctor — the console reads without a budget.",
        { skipped: skipped.join(","), budgetMs: input.budgetMs ?? 0 },
      ),
    );
  }
  return worstFirst(out);
}

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * The two columns every doctor line lays out in — `ui.ts` holds the same pair
 * and `test/ui.test.ts` holds the two files to each other.
 *
 * WIDENED 2026-09-22 (6/12 → 7/20) because the labels changed. The line a
 * person came for is now called `Recall by meaning`, which is seventeen
 * characters, and a title wider than its column pushes its own detail out of
 * the column every other detail is in. The owner's screen is the measurement:
 * `OFF` plus four spaces, `Recall by meaning` plus three.
 */
const SEVERITY_COLUMN = 7;
const TITLE_COLUMN = 20;

/** The console's report: a table, worst first, and a fix under anything that is
 *  not green. */
export function reportLines(findings: readonly Finding[], today: string): string[] {
  const ordered = worstFirst(findings);
  const lines = [`counterparts doctor — ${today} (UTC)`, ""];
  for (const f of ordered) lines.push(...findingLines(f));
  lines.push("");
  lines.push(summaryLine(tally(ordered)));
  return lines;
}

/** ONE finding, in the two columns both arms of this report lay out in — the
 *  grade word, the title, the detail, and the fix in the constant gutter. */
export function findingLines(f: Finding): string[] {
  // A TITLE AS WIDE AS THE COLUMN STILL GETS ITS SPACE (2026-09-20). `padEnd`
  // is a floor, not a gap: a title exactly `TITLE_COLUMN` long would otherwise
  // print as `GREEN Journal modewal (busy timeout 5000 ms)`.
  const title = f.title.length >= TITLE_COLUMN ? `${f.title} ` : f.title.padEnd(TITLE_COLUMN);
  const head = `${gradeWord(f).padEnd(SEVERITY_COLUMN)}${title}`;
  // AN `OFF` LINE HAS NO `fix:`. Nothing is broken, so there is nothing to fix:
  // the command is an INVITATION and it reads as one sentence with the line
  // that explains what it buys. Every other grade keeps the fix on its own
  // line, in the constant gutter, where a person scanning for what to do finds
  // every one of them in the same column.
  if (f.optional === true) return [`${head}${f.detail}${f.fix.length === 0 ? "" : `  ${f.fix}`}`];
  const out = [`${head}${f.detail}`];
  if (f.fix.length > 0) out.push(`${" ".repeat(SEVERITY_COLUMN + TITLE_COLUMN)}fix: ${f.fix}`);
  return out;
}

/**
 * The `--json` shape: ids, counts, severities. Never a credential value.
 *
 * **COMPLETE AND UNFOLDED, always** — the terminal's folded screen is a layout
 * and this is the reading. Every finding is here whatever the console did with
 * it, in the same order, with its own grade.
 *
 * `severity` STAYS THREE-VALUED and an `OFF` finding carries `optional: true`
 * beside it (the owner's answer 12, 2026-09-22). A fourth severity would have
 * moved every reader that switches on the word — the hook's notice, the
 * dashboard, a script — for a distinction only the screen needs. The counts at
 * the top do split them, because a top-level `amber: 2` beside a screen reading
 * `0 amber, 2 off` is exactly the disagreement this module exists to prevent.
 */
export function reportJson(findings: readonly Finding[], today: string): Record<string, unknown> {
  const ordered = worstFirst(findings);
  const t = tally(ordered);
  return {
    date: today,
    red: t.red,
    amber: t.amber,
    off: t.off,
    green: t.green,
    findings: ordered.map((f) => ({
      key: f.key,
      severity: f.severity,
      ...(f.optional === true ? { optional: true } : {}),
      title: f.title,
      detail: f.detail,
      fix: f.fix,
      data: f.data,
    })),
  };
}

/** True when anything is red — the console's exit code, and the notice's gate. */
export function anyRed(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "red");
}

/** The last line of every notice, and the only part that is never truncated:
 *  the repair is not a thing to remember. */
export const NOTICE_TAIL = "run: counterparts doctor";

/**
 * How long a notice may be, in characters.
 *
 * The host caps EVERY hook output string at 10,000 characters and replaces
 * anything longer with a preview and a file path
 * (https://code.claude.com/docs/en/hooks: "Hook output strings, including
 * `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000
 * characters"). The notice rides in the same JSON object as the wake, so every
 * character it spends is a character the wake cannot have — and the wake is the
 * thing the session cannot do without. 400 is enough for a finding, its fix and
 * the tail; a finding that needs more than that needs the console, which is what
 * the tail says.
 */
export const NOTICE_MAX_CHARS = 400;

/**
 * THE ONE OR TWO LINES THE OWNER SEES IN THE TERMINAL, or null.
 *
 * RED ONLY. Amber never reaches the terminal from a hook: the owner asked for a
 * warning, not a nag, and a notice that fires on a store with one un-embedded
 * memory is a notice people learn to scroll past. The last line is always the
 * same eight characters plus the command, so the repair is never a thing to
 * remember — and it survives the cap, which the first line does not.
 */
export function noticeMessage(findings: readonly Finding[]): string | null {
  const reds = worstFirst(findings).filter((f) => f.severity === "red");
  const first = reds[0];
  if (first === undefined) return null;
  const more =
    reds.length === 1 ? "" : ` (+${reds.length - 1} more: ${reds.slice(1).map((f) => f.title).join(", ")})`;
  const fix = first.fix.length === 0 ? "" : ` ${first.fix}`;
  const head = `counterparts: ${first.title} — ${first.detail}.${fix}${more}`;
  // The tail and its newline are reserved FIRST, so what is cut is always the
  // explanation and never the way to get the whole of it.
  const room = NOTICE_MAX_CHARS - NOTICE_TAIL.length - 1;
  const line = head.length <= room ? head : `${head.slice(0, Math.max(0, room - 1))}…`;
  return `${line}\n${NOTICE_TAIL}`;
}
