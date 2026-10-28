/**
 * THE WAKE SAYS SO WHEN SEARCH BY MEANING CAN'T RUN (2026-10-27, W1).
 *
 * A plugin install ran for days with no meaning weights (`NO_WEIGHTS`) and
 * only a doctor run said so. Now the session-start wake carries one line for
 * the model to tell its person, with the fix for the route this copy came by
 * (`doctor-meaning.ts#wakeMeaningLine`, the same route and plugin step as
 * doctor's Recall by meaning line):
 *
 *   - weights missing → the line, `/plugin` for a plugin install, the npm
 *     command for an npm install;
 *   - weights restored → gone, even while the worker's last row still says
 *     NO_WEIGHTS;
 *   - meaning switched off → no line; healthy → no line; nobody to tell
 *     (`claude -p`, a compaction, the night) → no line;
 *   - the worker's vector step failing on two dates with no backfill since →
 *     the "stopped" line, pointing at doctor, at most once a day;
 *   - a backfill "stuck at 0" is not a case: real backfills show the static
 *     table setting an unembeddable memory aside, so the count falls.
 *
 * Driven through the real SessionStart path: `openAdapter(...).sessionStart`
 * (the adapter `bin/hook.ts` builds), the hook process itself for the install
 * route end to end, and Desktop's `wake` notice. Hermetic: a fresh temp dir per
 * test; the weights are pinned by `COUNTERPARTS_STATIC_WEIGHTS_DIR` (an empty
 * folder, or a tiny synthetic table) so nothing depends on whether the weights
 * package is installed in this checkout.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { EMBED_BACKFILL_EVENT, RUNNER_FAILED_EVENT } from "../src/core/counterpart.js";
import { STATIC_WEIGHTS_ENV } from "../src/core/embed/static.js";
import { Store } from "../src/core/store/index.js";
import { localDate } from "../src/core/time.js";
import {
  MEANING_OFF_LEAD,
  MEANING_OFF_WORDS,
  MEANING_STOPPED_TOLD_KEY,
  npmTableCommand,
  openAdapter,
} from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import type { InstallRoute } from "../src/adapters/plugin.js";
import { desktopWakeNotice } from "../src/adapters/mcp/bin/serve.js";
import { openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { backfillVectors } from "../src/adapters/claude-code/vectors.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const REPO_ROOT = resolve(import.meta.dir, "..");

const PLUGIN_STEP = "/plugin → Marketplaces → counterparts → Update marketplace";
/** Under bun, which runs this file; Node's step is checked on `npmTableCommand` itself. */
const NPM_STEP = "in a terminal, run bun add -g counterparts";

let root: string;
let dir: string;
let project: string;
let emptyWeights: string;
let tableWeights: string;
let savedWeights: string | undefined;
const open: { close(): void }[] = [];

/** A synthetic eight-row table (as `test/static-wiring.test.ts` writes one). */
function writeTable(at: string): void {
  const vocab = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "otter", "river", "holt"];
  const width = 4;
  const rows = vocab.map((_, i) => [Math.cos(i), Math.sin(i), (i % 3) - 1, 1]);
  const bytes = new Uint8Array(new Float32Array(rows.flat()).buffer);
  let header = JSON.stringify({ embeddings: { dtype: "F32", shape: [vocab.length, width], data_offsets: [0, bytes.byteLength] } });
  while ((8 + header.length) % 8 !== 0) header += " ";
  const h = new TextEncoder().encode(header);
  const out = new Uint8Array(8 + h.byteLength + bytes.byteLength);
  new DataView(out.buffer).setBigUint64(0, BigInt(h.byteLength), true);
  out.set(h, 8);
  out.set(bytes, 8 + h.byteLength);
  writeFileSync(join(at, "model.safetensors"), out);
  writeFileSync(join(at, "vocab.txt"), `${vocab.join("\n")}\n`);
  writeFileSync(join(at, "package.json"), JSON.stringify({ name: "fixture", counterparts: { model: "tiny-static" } }));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cp-wake-meaning-")));
  dir = join(root, "store");
  project = join(root, "proj");
  emptyWeights = join(root, "no-table");
  tableWeights = join(root, "table");
  for (const d of [project, emptyWeights, tableWeights]) mkdirSync(d, { recursive: true });
  writeTable(tableWeights);
  savedWeights = process.env[STATIC_WEIGHTS_ENV];
  process.env[STATIC_WEIGHTS_ENV] = emptyWeights;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (savedWeights === undefined) delete process.env[STATIC_WEIGHTS_ENV];
  else process.env[STATIC_WEIGHTS_ENV] = savedWeights;
  rmSync(root, { recursive: true, force: true });
});

const ON: AdapterConfig["embedder"] = { enabled: true, kind: "static" };

/** A memory, and the worker's durable rows, written before any session opens. */
function seed(rows: readonly { name: string; payload: Record<string, string | number | null> }[] = []): void {
  const s = Store.open({ dir });
  try {
    s.put({ type: "memory", kind: "fact", body: "the otter survey runs on the river holt" });
    for (const r of rows) s.appendEvent({ name: r.name, day: s.livedDay(), payload: r.payload });
  } finally {
    s.close();
  }
}

function backfill(over: Record<string, string | number | null>): { name: string; payload: Record<string, string | number | null> } {
  return {
    name: EMBED_BACKFILL_EVENT,
    payload: { embedded: 0, failed: 0, remaining: 1, attempted: 0, reason: "ran", codes: "", skipped: 0, kind: "static", weights: "env", model: "tiny-static", ...over },
  };
}

const NO_WEIGHTS_ROW = backfill({ reason: "embedder-unavailable", codes: "NO_WEIGHTS", weights: null, model: null });

/** A session start the way `bin/hook.ts` makes one: the adapter, its install route, the hook's input. */
function wake(
  opts: {
    install?: InstallRoute;
    embedder?: AdapterConfig["embedder"];
    observer?: boolean;
    nightRun?: boolean;
    entrypoint?: string;
    source?: string;
    at?: string;
  } = {},
): string {
  const config: AdapterConfig = {
    dataDir: dir,
    ...(opts.embedder === undefined ? { embedder: ON } : { embedder: opts.embedder }),
    ...(opts.observer === true ? { observer: true } : {}),
  };
  const a = openAdapter(config, {
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 1 }),
    embedder: null,
    ...(opts.install === undefined ? {} : { install: opts.install }),
  });
  open.push(a.counterpart);
  const r = a.sessionStart({
    sessionId: `s-${Math.random().toString(36).slice(2)}`,
    scope: project,
    at: opts.at ?? localDate(Date.now()),
    source: opts.source ?? "startup",
    ...(opts.entrypoint === undefined ? {} : { entrypoint: opts.entrypoint }),
    ...(opts.nightRun === true ? { nightRun: true } : {}),
  });
  a.counterpart.close();
  open.length = 0;
  return r.injection ?? "";
}

function lineOf(text: string): string | undefined {
  return text.split("\n").find((l) => l.startsWith(MEANING_OFF_LEAD));
}

describe("weights missing", () => {
  test("a plugin install: the line, with /plugin's step and never the npm command", () => {
    seed([NO_WEIGHTS_ROW]);
    const line = lineOf(wake({ install: "plugin" }));
    expect(line).toBeDefined();
    expect(line).toContain(MEANING_OFF_WORDS.missing);
    expect(line).toContain(`To fix it: in Claude Code, ${PLUGIN_STEP}`);
    expect(line).toContain("install Node.js (https://nodejs.org) first");
    expect(line).not.toContain("bun add");
  });

  test("an npm install: the line, with the npm command and never /plugin", () => {
    seed([NO_WEIGHTS_ROW]);
    const line = lineOf(wake({ install: "npm" }));
    expect(line).toContain(MEANING_OFF_WORDS.missing);
    expect(line).toContain(`To fix it: ${NPM_STEP}.`);
    expect(line).not.toContain("/plugin");
  });

  test("before any boundary (a fresh install's first wake): the line already, from the disk", () => {
    seed();
    expect(lineOf(wake({ install: "plugin" }))).toContain(MEANING_OFF_WORDS.missing);
  });

  test("route not known: both steps named", () => {
    seed([NO_WEIGHTS_ROW]);
    const line = lineOf(wake());
    expect(line).toContain(`npm: ${NPM_STEP}`);
    expect(line).toContain(`plugin: in Claude Code, ${PLUGIN_STEP}`);
  });

  test("one line, under the clock, outside the wake block", () => {
    seed([NO_WEIGHTS_ROW]);
    const text = wake({ install: "plugin" });
    const lines = text.split("\n");
    expect(lines.filter((l) => l.startsWith(MEANING_OFF_LEAD))).toHaveLength(1);
    expect(lines.findIndex((l) => l.startsWith(MEANING_OFF_LEAD))).toBe(1);
  });
});

describe("no line", () => {
  test("weights restored: the worker's last row still says NO_WEIGHTS, the table is whole now — silent", () => {
    seed([NO_WEIGHTS_ROW]);
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    expect(lineOf(wake({ install: "plugin" }))).toBeUndefined();
  });

  test("meaning switched off by choice — even with no table at all", () => {
    seed();
    expect(lineOf(wake({ install: "plugin", embedder: { enabled: false } }))).toBeUndefined();
  });

  test("healthy: the table whole, the newest backfill embedded", () => {
    seed([backfill({ embedded: 1, attempted: 1, remaining: 0 })]);
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    expect(lineOf(wake({ install: "plugin" }))).toBeUndefined();
  });

  test("an observer, and the headless night, say nothing", () => {
    seed([NO_WEIGHTS_ROW]);
    expect(lineOf(wake({ install: "plugin", observer: true }))).toBeUndefined();
    expect(lineOf(wake({ install: "plugin", nightRun: true }))).toBeUndefined();
  });

  test("no person to tell: `claude -p` (sdk-cli) and a compaction say nothing; a person's next start does", () => {
    seed([NO_WEIGHTS_ROW]);
    expect(lineOf(wake({ install: "plugin", entrypoint: "sdk-cli" }))).toBeUndefined();
    // A compaction fires mid-turn — a subagent's own compaction too.
    expect(lineOf(wake({ install: "plugin", source: "compact" }))).toBeUndefined();
    expect(lineOf(wake({ install: "plugin", entrypoint: "cli" }))).toContain(MEANING_OFF_WORDS.missing);
  });
});

describe("the table is there and won't load", () => {
  test("HASH_MISMATCH: the reinstall step, until the next row", () => {
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    seed([backfill({ reason: "embedder-unavailable", codes: "HASH_MISMATCH", weights: null, model: null })]);
    const line = lineOf(wake({ install: "plugin" }));
    expect(line).toContain(MEANING_OFF_WORDS.unloadable);
    expect(line).toContain(`To fix it: in Claude Code, ${PLUGIN_STEP} (or uninstall it and install it again).`);
  });
});

describe("the worker failing", () => {
  const failedOn = (date: string, step = "vectors"): { name: string; payload: Record<string, string | number | null> } => ({
    name: RUNNER_FAILED_EVENT,
    payload: { code: "TypeError", step, date },
  });
  const ok = backfill({ embedded: 1, attempted: 1, remaining: 0 });

  test("the vector step failed on two dates with no backfill since: the stopped line, pointing at doctor", () => {
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    seed([ok, failedOn("2026-10-26"), failedOn("2026-10-27")]);
    const plugin = lineOf(wake({ install: "plugin", at: "2026-10-27" }));
    expect(plugin).toContain(MEANING_OFF_WORDS.stopped);
    expect(plugin).toContain("To see why: in Claude Code, run /counterparts:doctor.");
    expect(lineOf(wake({ install: "npm", at: "2026-10-28" }))).toContain("To see why: in a terminal, run counterparts doctor.");
  });

  test("ONE failed boundary is not a stopped feature (review of #664): silent", () => {
    // The runner's `vectors` step covers the lagged cue as well as the
    // backfill, so a single throw after a good backfill is one bad boundary.
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    seed([ok, failedOn("2026-10-27")]);
    expect(lineOf(wake({ install: "plugin", at: "2026-10-27" }))).toBeUndefined();
  });

  test("a backfill between the two failures clears it; another step's failures never say it", () => {
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    seed([failedOn("2026-10-25"), ok, failedOn("2026-10-26"), failedOn("2026-10-26", "terms"), failedOn("2026-10-27", "terms")]);
    expect(lineOf(wake({ install: "plugin", at: "2026-10-27" }))).toBeUndefined();
  });

  test("said at most once a day: the second wake that day is silent, the next day says it again", () => {
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    seed([failedOn("2026-10-26"), failedOn("2026-10-27")]);
    expect(lineOf(wake({ install: "plugin", at: "2026-10-27" }))).toContain(MEANING_OFF_WORDS.stopped);
    expect(lineOf(wake({ install: "plugin", at: "2026-10-27" }))).toBeUndefined();
    const s = Store.open({ dir });
    try {
      expect(s.getMeta(MEANING_STOPPED_TOLD_KEY)).toBe("2026-10-27");
    } finally {
      s.close();
    }
    expect(lineOf(wake({ install: "plugin", at: "2026-10-28" }))).toContain(MEANING_OFF_WORDS.stopped);
  });

  test("an unattended start does not spend the day's telling", () => {
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    seed([failedOn("2026-10-26"), failedOn("2026-10-27")]);
    expect(lineOf(wake({ install: "plugin", at: "2026-10-27", entrypoint: "sdk-cli" }))).toBeUndefined();
    expect(lineOf(wake({ install: "plugin", at: "2026-10-27" }))).toContain(MEANING_OFF_WORDS.stopped);
  });
});

describe("a backfill 'stuck at 0' is not a case: the static table sets a memory it cannot embed aside", () => {
  test("three real backfills over a memory the table has no word for: remaining falls on the third, and the wake says nothing", async () => {
    process.env[STATIC_WEIGHTS_ENV] = tableWeights;
    const embedder = openStaticEmbedder({ weightsDir: tableWeights });
    expect(embedder.unavailable).toBeUndefined();
    const a = openAdapter({ dataDir: dir, embedder: ON }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder });
    open.push(a.counterpart);
    a.counterpart.store.put({ type: "memory", kind: "fact", body: "zzz qqq xxx" });
    const remaining: number[] = [];
    for (let i = 0; i < 3; i += 1) remaining.push((await backfillVectors({ counterpart: a.counterpart, embedder })).remaining);
    expect(remaining).toEqual([1, 1, 0]);
    a.counterpart.close();
    open.length = 0;
    expect(lineOf(wake({ install: "npm" }))).toBeUndefined();
  });
});

describe("Desktop's wake carries the same line in its notice slot", () => {
  test("the route read from the server's own environment; none on a night's own wake", () => {
    seed([NO_WEIGHTS_ROW]);
    const store = Store.open({ dir });
    open.push(store);
    const input = { store, config: { dataDir: dir, embedder: ON } as AdapterConfig, configPath: join(root, "claude-code.json"), today: localDate(Date.now()) };
    const npm = desktopWakeNotice({ ...input, env: { [STATIC_WEIGHTS_ENV]: emptyWeights } });
    expect(npm).toContain(MEANING_OFF_WORDS.missing);
    expect(npm).toContain(NPM_STEP);
    expect(desktopWakeNotice({ ...input, night: true, env: { [STATIC_WEIGHTS_ENV]: emptyWeights } })).toBeNull();
    expect(desktopWakeNotice({ ...input, env: { [STATIC_WEIGHTS_ENV]: tableWeights } })).toBeNull();
    expect(desktopWakeNotice({ ...input, config: { dataDir: dir, embedder: { enabled: false } }, env: { [STATIC_WEIGHTS_ENV]: emptyWeights } })).toBeNull();
  });
});

describe("the npm route's step names the runtime", () => {
  test("Node: npm install -g counterparts@latest; Bun: bun add -g counterparts — never the weights package alone", () => {
    expect(npmTableCommand("node")).toBe("npm install -g counterparts@latest");
    expect(npmTableCommand("bun")).toBe("bun add -g counterparts");
  });
});

// ── the hook process itself ─────────────────────────────────────────────────

describe("end to end through the hook process: the route comes from the process's own environment", () => {
  function runSessionStart(extraEnv: Record<string, string>): string {
    const home = join(root, "home");
    const bin = join(root, "bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000 }), "utf8");
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], {
      input: JSON.stringify({ cwd: project, hook_event_name: "SessionStart", session_id: `s-${Math.random().toString(36).slice(2)}`, source: "startup" }),
      encoding: "utf8",
      env: { PATH: bin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", [STATIC_WEIGHTS_ENV]: emptyWeights, ...extraEnv },
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout ?? "";
    if (!out.trimStart().startsWith("{")) return out;
    const parsed = JSON.parse(out) as { hookSpecificOutput?: { additionalContext?: string } };
    return parsed.hookSpecificOutput?.additionalContext ?? "";
  }

  test("npm (no CLAUDE_PLUGIN_ROOT): the npm command; the plugin (CLAUDE_PLUGIN_ROOT is this copy): /plugin", () => {
    seed([NO_WEIGHTS_ROW]);
    const npm = lineOf(runSessionStart({}));
    expect(npm).toContain(MEANING_OFF_WORDS.missing);
    expect(npm).toContain(NPM_STEP);
    expect(npm).not.toContain("/plugin");
    const plugin = lineOf(runSessionStart({ CLAUDE_PLUGIN_ROOT: REPO_ROOT, CLAUDE_PLUGIN_DATA: join(root, "plugin-data") }));
    expect(plugin).toContain(MEANING_OFF_WORDS.missing);
    expect(plugin).toContain(PLUGIN_STEP);
    expect(plugin).not.toContain("bun add");
  }, 120_000);

  test("the table restored in the hook's environment: no line", () => {
    seed([NO_WEIGHTS_ROW]);
    expect(lineOf(runSessionStart({ [STATIC_WEIGHTS_ENV]: tableWeights }))).toBeUndefined();
  }, 60_000);
});
