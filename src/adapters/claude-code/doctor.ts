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
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  EMBED_BACKFILL_EVENT,
  GATE_DEPOSIT_EVENT,
  RECALL_CREDIT_EVENT,
  RUNNER_FAILED_EVENT,
  SLEEP_CYCLE_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SWEEP_GATE_EVENT,
} from "../../core/counterpart.js";
import { Store, dateOf } from "../../core/store/index.js";
import type { EventRow } from "../../core/store/index.js";
// The ask allowance the amber hint names, read rather than retyped: a number in
// a diagnostic's prose is a number that goes stale silently.
import { SELF_TUNABLES } from "../../core/self/tunables.js";
import { API_KEY_ENV, EMBED_KEY_ENV, TUNABLES } from "./config.js";
import type { AdapterConfig } from "./config.js";
import { CREDENTIAL_NAMES } from "./credentials.js";
import type { CredentialLoad } from "./credentials.js";

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
  readonly configReason: "loaded" | "absent" | "unreadable" | null;
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
   * WHICH CHECKOUT IS RUNNING (see `readCheckout`). Absent: not graded, and no
   * finding is produced at all.
   */
  readonly checkout?: CheckoutReading;
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

/** The config file itself: the one the hooks read, and whether it was readable. */
function configFindings(input: DoctorInput): Finding[] {
  const out: Finding[] = [];
  const reason = input.configReason;
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
      finding("store", "red", "Store", `no store at ${input.dir}`, "Run: counterparts install, or name the store with --dir.", {
        dir: input.dir,
        exists: false,
      }),
    );
  } else if (named !== undefined && named !== input.dir) {
    out.push(
      finding(
        "store",
        "amber",
        "Store",
        `read ${input.dir}, but ${input.configPath} names ${named} — the hooks read the second one`,
        "Drop --dir (and COUNTERPARTS_DATA_DIR) to read the store the hooks use.",
        { dir: input.dir, named, exists: true },
      ),
    );
  } else {
    out.push(finding("store", "green", "Store", input.dir, "", { dir: input.dir, exists: true }));
  }

  const embedder = input.config.embedder?.enabled === true;
  out.push(
    embedder
      ? finding("embedder", "green", "Embedder", "enabled", "", { enabled: true })
      : finding(
          "embedder",
          "amber",
          "Embedder",
          "embedder off: no vectors, no semantic channel — recall is lexical only",
          `Add "embedder": { "enabled": true } to ${input.configPath} (read strictly: that exact shape).`,
          { enabled: false },
        ),
  );

  if (input.config.observer === true) {
    out.push(
      finding("stance", "amber", "Stance", "observer: this host reads memory and never writes it", "Remove \"observer\" from the config to encode again.", {
        observer: true,
      }),
    );
  } else {
    out.push(finding("stance", "green", "Stance", "owner: this host encodes", "", { observer: false }));
  }
  return out;
}

/**
 * The credentials, BY NAME. The red is I32's own signature: no interpreter key
 * means the worker runs the day and interprets nothing.
 */
function credentialFindings(input: DoctorInput): Finding[] {
  const load = input.credentials;
  const present = [...load.loaded, ...load.skippedPresent];
  const missing = CREDENTIAL_NAMES.filter((n) => !present.includes(n));
  const path = input.credentialsPath ?? "(no credentialsFile in the config)";
  /**
   * The clause for THE NAME THIS FINDING IS ABOUT, and no other: "your shell
   * exports VOYAGE_API_KEY" hung on a red about `ANTHROPIC_API_KEY` reads as a
   * non-sequitur and teaches the reader to skip the line.
   *
   * It is the sentence that closes I32 on the owner's own machine: his
   * `~/.zshrc` exports both names, hook processes inherit neither (measured day
   * 0), so "I have that key" and "the hooks have that key" are two different
   * facts and this is where they are told apart.
   */
  const shellClause = (name: string): string =>
    (input.shellNames ?? []).includes(name) && !present.includes(name)
      ? ` — your shell exports ${name}, and hook processes do not inherit it`
      : "";
  const where = `${path}${load.mode === null ? "" : ` (mode ${load.mode})`}`;
  const holds = present.length === 0 ? "holds no key" : `holds ${present.join(", ")}`;
  const out: Finding[] = [];

  if (missing.includes(API_KEY_ENV)) {
    out.push(
      finding(
        "credentials",
        "red",
        "Credentials",
        `${where} ${holds}: ${API_KEY_ENV} is missing, so the worker will run without an interpreter; nothing is encoded${shellClause(API_KEY_ENV)}`,
        `Run: counterparts credentials set ${API_KEY_ENV} (the value on stdin; it is never echoed).`,
        { path, mode: load.mode, reason: load.reason, present: present.join(","), missing: missing.join(",") },
      ),
    );
  } else if (missing.includes(EMBED_KEY_ENV)) {
    out.push(
      finding(
        "credentials",
        "amber",
        "Credentials",
        `${where} ${holds}: ${EMBED_KEY_ENV} is missing, so nothing is embedded${shellClause(EMBED_KEY_ENV)}`,
        `Run: counterparts credentials set ${EMBED_KEY_ENV} (the value on stdin; it is never echoed).`,
        { path, mode: load.mode, reason: load.reason, present: present.join(","), missing: missing.join(",") },
      ),
    );
  } else {
    out.push(
      finding("credentials", "green", "Credentials", `${where} ${holds}`, "", {
        path,
        mode: load.mode,
        reason: load.reason,
        present: present.join(","),
        missing: "",
      }),
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
        `${path} is mode ${load.mode}${load.permissive ? " — group or other can read it" : ""}`,
        `Run: chmod 600 ${path}`,
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
    out.push(
      reason === "ran"
        ? finding("sweep", "green", "Sweep", detail, "", { reason, ran: num(p, "ran"), date: rowDate(sweep) })
        : finding("sweep", "amber", "Sweep", detail, "The sweep stood down; the reason names why.", {
            reason,
            ran: num(p, "ran"),
            date: rowDate(sweep),
          }),
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
    const detail =
      `newest sleep.cycle ${rowDate(cycle) ?? "?"}: reason ${reason}, ${failed} failed phase${failed === 1 ? "" : "s"}` +
      (str(p, "failedPhase") === null ? "" : `, died in ${String(str(p, "failedPhase"))}`);
    // `reason` is "ran" | "clock-failed" | "threw" (`counterpart.ts#recordSleepCycle`),
    // so anything but "ran" is a night that did not happen, not a cadence.
    const data = { reason, failed, date: rowDate(cycle) };
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
 *     went out; `capped` is one refused because the session had already spent
 *     its own allowance of asks (`SELF_TUNABLES.MAX_ASKS_PER_SESSION` — per
 *     session since 2026-09-17, never a shared daily ration); `paced` is one
 *     the substance pacer refused. The `reason` field is deliberately NOT what
 *     this counts — it is a finer vocabulary that is being renamed elsewhere,
 *     and a diagnostic keyed on a string in motion is a diagnostic that will
 *     quietly read zero one morning.
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

/** The ceiling on one authorship read. A week of the owner's busiest recorded
 *  day (137 ask decisions) is two orders of magnitude inside this; a read that
 *  hits it says so rather than reporting the prefix as the whole. */
const AUTHORSHIP_LIMIT = 20000;

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

function authorshipFindings(input: DoctorInput, store: Store): Finding[] {
  const livedDay = store.livedDay();
  // Inclusive of today: seven calendar days means today and the six before it.
  const from = daysBefore(input.today, AUTHORSHIP_DAYS - 1);
  const asks = rowsInWindow(store, ADAPTER_ASK_EVENT, livedDay, from);
  const deposits = rowsInWindow(store, GATE_DEPOSIT_EVENT, livedDay, from);
  let asked = 0;
  let capped = 0;
  let paced = 0;
  let unlabelled = 0;
  for (const row of asks.rows) {
    switch (str(payloadOf(row), "outcome")) {
      case "asked":
        asked += 1;
        break;
      case "capped":
        capped += 1;
        break;
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
  const capBinds = capped > asked;
  const sweepWins = fallback > authored;
  const detail =
    `${from}→${input.today}: the session was invited to write ${String(asked)} ${asked === 1 ? "time" : "times"}, ` +
    `refused ${String(capped)} because a session had used its allowance and ${String(paced)} for pacing` +
    `${unlabelled === 0 ? "" : ` (${String(unlabelled)} older rows name no outcome)`}; ` +
    `it answered with ${String(deposits.rows.length)} ${deposits.rows.length === 1 ? "deposit" : "deposits"}; ` +
    `${String(authored)} live ${authored === 1 ? "memory" : "memories"} of that week ${authored === 1 ? "is" : "are"} its own, ` +
    `${String(fallback)} ${fallback === 1 ? "was" : "were"} written for it by the fallback sweep` +
    `${asks.truncated || deposits.truncated ? " (counts are a floor: the event read hit its limit)" : ""}`;
  const fixes = [
    capBinds
      ? `A session's own allowance (${String(SELF_TUNABLES.MAX_ASKS_PER_SESSION)} asks) is refusing the pen more often than it offers it — sessions are running long enough to exhaust it, and that number is worth a look.`
      : "",
    sweepWins
      ? "The sweep writes what the session did not: check that sessions reach a session-end boundary in the scope they captured in, and that the Stop ask is reaching the model."
      : "",
  ].filter((s) => s.length > 0);
  const data = {
    from,
    to: input.today,
    asked,
    capped,
    paced,
    unlabelled,
    deposits: deposits.rows.length,
    authored,
    fallback,
    truncated: asks.truncated || deposits.truncated,
  };
  return [
    finding(
      "authorship",
      capBinds || sweepWins ? "amber" : "green",
      "Authorship",
      detail,
      fixes.join(" "),
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
  return [finding("spawn", "green", "Spawn", `no spawn refusals standing${rowClause === "" ? "" : ` (${rowClause})`}`, "", data)];
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

/** Coverage of the semantic channel — `verify`'s two census numbers, reused. */
function vectorFindings(store: Store): Finding[] {
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

// ── the reading ─────────────────────────────────────────────────────────────

const RANK: Record<Severity, number> = { red: 0, amber: 1, green: 2 };

/** Worst first, stable within a severity — the order the report and the notice
 *  both read. */
export function worstFirst(findings: readonly Finding[]): Finding[] {
  return [...findings]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
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
  const out: Finding[] = [
    ...configFindings(input),
    ...credentialFindings(input),
    // Already READ by the caller (the git calls are its own bounded business),
    // so this costs nothing here and is answered before any store read.
    ...(input.checkout === undefined ? [] : checkoutFindings(input.checkout)),
  ];
  const store = input.store;
  if (store === null) return worstFirst(out);

  const groups: (readonly [string, () => Finding[]])[] = [
    ["spawn", () => spawnFindings(input, store)],
    ["clock", () => clockFindings(input, store)],
    ["rows", () => rowFindings(input, store)],
    ["authorship", () => authorshipFindings(input, store)],
    ["vectors", () => vectorFindings(store)],
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

const SEVERITY_COLUMN = 6;
const TITLE_COLUMN = 12;

/** The console's report: a table, worst first, and a fix under anything that is
 *  not green. */
export function reportLines(findings: readonly Finding[], today: string): string[] {
  const ordered = worstFirst(findings);
  const reds = ordered.filter((f) => f.severity === "red").length;
  const ambers = ordered.filter((f) => f.severity === "amber").length;
  const lines = [`counterparts doctor — ${today} (UTC)`, ""];
  for (const f of ordered) {
    lines.push(`${f.severity.toUpperCase().padEnd(SEVERITY_COLUMN)}${f.title.padEnd(TITLE_COLUMN)}${f.detail}`);
    if (f.fix.length > 0) lines.push(`${" ".repeat(SEVERITY_COLUMN + TITLE_COLUMN)}fix: ${f.fix}`);
  }
  lines.push("");
  lines.push(
    reds === 0 && ambers === 0
      ? "Nothing to fix."
      : `${reds} red, ${ambers} amber, ${ordered.length - reds - ambers} green.`,
  );
  return lines;
}

/** The `--json` shape: ids, counts, severities. Never a credential value. */
export function reportJson(findings: readonly Finding[], today: string): Record<string, unknown> {
  const ordered = worstFirst(findings);
  return {
    date: today,
    red: ordered.filter((f) => f.severity === "red").length,
    amber: ordered.filter((f) => f.severity === "amber").length,
    green: ordered.filter((f) => f.severity === "green").length,
    findings: ordered.map((f) => ({ key: f.key, severity: f.severity, title: f.title, detail: f.detail, fix: f.fix, data: f.data })),
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
