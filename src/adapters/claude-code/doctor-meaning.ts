/**
 * SEARCH BY MEANING THAT CANNOT RUN, said by the wake (2026-10-27, W1), and
 * the install routes doctor's Recall by meaning line shares with it.
 *
 * Why it exists: a plugin install ran for days with no meaning weights
 * (`NO_WEIGHTS`) — the plugin's dependency step had not run — and only a
 * doctor run said so. The person's counterpart could have told them, had its
 * wake carried one line. This is that line: written for the model to say to
 * its person, in words a regular user can act on, with the fix for the route
 * this copy came by (`plugin.ts#installRoute`) — the same route, and the same
 * plugin step, as doctor's own fix line, because both are built here.
 *
 * Cheap by construction (it is read on a hook's hot path): the durable rows
 * the worker already writes (`vectors.ts#backfillVectors`' row, the runner's
 * `adapter.runner.failed`), plus one look for the table's files on disk. It
 * never loads the weights and never starts a worker.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { EMBED_BACKFILL_EVENT, RUNNER_FAILED_EVENT } from "../../core/counterpart.js";
import type { Store } from "../../core/store/index.js";
import { MODEL_FILE, STATIC_WEIGHTS_PACKAGE, VOCAB_FILE, resolveStaticWeights } from "../../core/embed/static.js";
import { bundledModelDir } from "../runtime.js";
import type { AdapterConfig } from "../config.js";
import type { InstallRoute } from "../plugin.js";
import { newestRows, num, payloadOf, str } from "./doctor-finding.js";

// ── the install routes, shared with doctor.ts ──────────────────────────────

/** The plugin's way to a newer or whole copy: Claude Code's plugin manager. */
export const PLUGIN_UPDATE = "in Claude Code, /plugin → Installed → counterparts → Update now (or uninstall it and install it again)";

/** The npm install's command for the meaning table. */
export const TABLE_NPM_COMMAND = `bun add -g ${STATIC_WEIGHTS_PACKAGE}`;

/** The plugin's way to the meaning table: its update reruns the dependency
 *  step, which needs npm (#396: a Bun-only computer has none). */
export const PLUGIN_TABLE_UPDATE = `${PLUGIN_UPDATE}; the plugin installs the table with npm, so with no npm on this computer install Node.js (https://nodejs.org) first`;

/**
 * A fix that installs something, in the words of the route this copy came
 * by: the npm command, the plugin's update, or — not known — both.
 */
export function byRoute(route: InstallRoute | undefined, npm: string, plugin: string = PLUGIN_UPDATE): string {
  const r = route ?? "either";
  if (r === "npm") return npm;
  if (r === "plugin") return plugin;
  return `npm: ${npm} · plugin: ${plugin}`;
}

// ── the table on disk ──────────────────────────────────────────────────────

/**
 * Where this process would load the meaning table from, and whether its two
 * files are there — the same resolution the worker's embedder makes
 * (`embed-client.ts#openStaticEmbedder`), without reading a byte of either.
 * `found` is null when no rule names a directory at all; `complete` says both
 * files exist in the one that was named.
 */
export function tableOnDisk(opts: { env?: Record<string, string | undefined>; packageDir?: string } = {}): {
  found: { dir: string; source: string } | null;
  complete: boolean;
} {
  const packageDir = opts.packageDir ?? bundledModelDir();
  const found = resolveStaticWeights({
    ...(opts.env === undefined ? {} : { env: opts.env }),
    ...(packageDir === undefined ? {} : { packageDir }),
  });
  if (found === null) return { found: null, complete: false };
  return { found, complete: existsSync(join(found.dir, MODEL_FILE)) && existsSync(join(found.dir, VOCAB_FILE)) };
}

// ── the wake's line ────────────────────────────────────────────────────────

/** The refusals that mean "the files are not there" — fixed by putting them
 *  there, so a table found whole now is a table restored. Every other code
 *  (`HASH_MISMATCH`, `BAD_*`, `LOAD_FAILED`, …) is files that would not load,
 *  and stands until the worker's next row says otherwise. */
const NOT_THERE: ReadonlySet<string> = new Set(["NO_WEIGHTS", "MISSING_FILE"]);

/**
 * How many backfill runs in a row must embed nothing, with memories waiting
 * and the count not falling, before the wake calls it stuck. Three is past
 * `EMBED_SKIP_AFTER` (3) by the run that matters: a memory the table cannot
 * embed is set aside on its third failure, and that run's `remaining` falls —
 * so one unembeddable memory never reads as stuck.
 */
export const MEANING_STUCK_RUNS = 3;

/** How many of the newest runner failures are read for a `vectors` one. */
const RUNNER_FAILED_ROWS = 10;

/** Why search by meaning is not running, for the person. */
export type MeaningOff = "missing" | "unloadable" | "stopped";

/** The person's sentence for each, before the fix. First person: the model says it. */
export const MEANING_OFF_WORDS: Readonly<Record<MeaningOff, string>> = {
  missing: "My search by meaning is off on this computer (its files didn't install), so I can only find memories by their words.",
  unloadable: "My search by meaning is off on this computer (its files are there but won't load), so I can only find memories by their words.",
  stopped: "My search by meaning has stopped working on this computer, so I can only find memories by their words.",
};

/** What the line is introduced by, for the model. */
export const MEANING_OFF_LEAD = "Counterparts — tell your person when it fits, once this session:";

export interface MeaningOffInput {
  readonly config: AdapterConfig;
  readonly store: Store;
  /** How this copy came (`plugin.ts#installRoute`); absent: both routes are named. */
  readonly install?: InstallRoute;
  /** The environment the table is resolved from; absent, this process's. */
  readonly env?: Record<string, string | undefined>;
  /** The single binary's carried table; absent, `runtime.ts#bundledModelDir`. */
  readonly packageDir?: string;
}

/**
 * Why search by meaning is configured ON and cannot run here, or null:
 *
 *   - **switched off** (`embedder.enabled` not true) or an observer: null.
 *     Off by choice is not a fault, and doctor already says OFF.
 *   - `missing`: this process finds no whole table — before any boundary too,
 *     which is a fresh plugin install's first wake. A worker row that said
 *     `NO_WEIGHTS`/`MISSING_FILE` while the table IS whole now reads as
 *     restored: the wake says nothing, and the next boundary writes a new row.
 *   - `unloadable`: the worker's newest row says the table was there and
 *     would not load (any other refusal code). It stands until the next row.
 *   - `stopped`: the worker's vector step threw after its newest backfill row
 *     (`adapter.runner.failed`, `step: "vectors"`), or the newest
 *     `MEANING_STUCK_RUNS` backfill rows all ran, embedded nothing, and left
 *     memories waiting without the count falling.
 *
 * The hook's environment IS the worker's (the hook starts it), so the look at
 * the disk is the same look the worker makes. Never throws: a reading that
 * fails is no line.
 */
export function meaningOff(input: MeaningOffInput): MeaningOff | null {
  if (input.config.embedder?.enabled !== true || input.config.observer === true) return null;
  try {
    const table = tableOnDisk({
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.packageDir === undefined ? {} : { packageDir: input.packageDir }),
    });
    if (!table.complete) return "missing";
    const store = input.store;
    const read = newestRows(store, EMBED_BACKFILL_EVENT, MEANING_STUCK_RUNS, store.livedDay());
    const rows = read.rows;
    const newest = rows[rows.length - 1];
    const p = payloadOf(newest);
    if (newest !== undefined && str(p, "reason") === "embedder-unavailable") {
      const code = str(p, "codes") ?? "NO_WEIGHTS";
      return NOT_THERE.has(code) ? null : "unloadable";
    }
    const failed = store
      .eventLog({ name: RUNNER_FAILED_EVENT, order: "desc", limit: RUNNER_FAILED_ROWS })
      .find((r) => str(payloadOf(r), "step") === "vectors");
    if (failed !== undefined && (newest === undefined || failed.seq > newest.seq)) return "stopped";
    if (rows.length >= MEANING_STUCK_RUNS) {
      const runs = rows.map((r) => payloadOf(r));
      const nothing = runs.every((r) => str(r, "reason") === "ran" && (num(r, "embedded") ?? 0) === 0 && (num(r, "remaining") ?? 0) > 0);
      const first = num(runs[0] ?? {}, "remaining") ?? 0;
      const last = num(runs[runs.length - 1] ?? {}, "remaining") ?? 0;
      if (nothing && last >= first) return "stopped";
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * THE WAKE'S ONE LINE, or null (`meaningOff`). The fix is the route's: the
 * table's install for `missing`, its reinstall for `unloadable` — doctor's own
 * steps (`PLUGIN_TABLE_UPDATE`, `PLUGIN_UPDATE`, `TABLE_NPM_COMMAND`) — and
 * doctor itself for `stopped`, whose reasons are many and are its to name.
 */
export function wakeMeaningLine(input: MeaningOffInput): string | null {
  const why = meaningOff(input);
  if (why === null) return null;
  const npm = `in a terminal, run ${TABLE_NPM_COMMAND}`;
  const fix =
    why === "missing"
      ? byRoute(input.install, npm, PLUGIN_TABLE_UPDATE)
      : why === "unloadable"
        ? byRoute(input.install, npm, PLUGIN_UPDATE)
        : byRoute(input.install, "in a terminal, run counterparts doctor", "in Claude Code, run /counterparts:doctor");
  const step = why === "stopped" ? "To see why" : "To fix it";
  return `${MEANING_OFF_LEAD} "${MEANING_OFF_WORDS[why]} ${step}: ${fix}."`;
}
