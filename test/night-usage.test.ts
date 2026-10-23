/**
 * WHAT A NIGHT COSTS, AND THE DEVELOPER'S NIGHT TRANSCRIPTS (lane C1,
 * 2026-10-23). (a) Each night child's tokens, read from its own `stream-json`
 * `result` line, ride the `dream.night` row and event as `usage`, per child and
 * a total; `counterparts night` and doctor say the total. (b) `debug:
 * { nightTranscripts: true }` keeps each child's raw output beside the store
 * for a week; off, nothing is written.
 *
 * Hermetic: a fresh temp base per test (`<base>/store` the data dir), removed
 * after. Every night here goes through the real night entry (`runNight`, and
 * once `bin/nightly.ts` itself) with a stub `claude` executable — no model.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NIGHT_TRANSCRIPT_DAYS, childUsage, loadConfig, nightDebugDir, openNightCounterpart, runNight } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { nightRunFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { nightRunLine } from "../src/adapters/cli/dream-core.js";
import { ownedKind, ownedNames, planUninstall } from "../src/adapters/cli/uninstall.js";
import { runSnapshot } from "../src/adapters/snapshots.js";
import { NIGHT_RUN_EVENT } from "../src/core/dream/index.js";
import { TUNABLES as SCHEMAS_TUNABLES } from "../src/core/schemas/index.js";
import { SELF_TUNABLES, pageWriterNight } from "../src/core/self/index.js";
import { addDays, localDate } from "../src/core/time.js";

const SCHEMAS = SCHEMAS_TUNABLES as { TAGS_NIGHT: boolean };
const SELF = SELF_TUNABLES as { PAGE_SPLIT: boolean };
const TAGS_WAS = SCHEMAS.TAGS_NIGHT;
const SPLIT_WAS = SELF.PAGE_SPLIT;

let base: string;
let dir: string;
let bin: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "counterparts-night-usage-"));
  dir = join(base, "store");
  bin = join(base, "bin");
  mkdirSync(bin);
});

afterEach(() => {
  SCHEMAS.TAGS_NIGHT = TAGS_WAS;
  SELF.PAGE_SPLIT = SPLIT_WAS;
  rmSync(base, { recursive: true, force: true });
});

/** A result line as Claude Code's `stream-json` ends a child. */
function resultLine(input: number, output: number, cacheRead: number, cacheCreate: number, cost: number): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 3, total_cost_usd: cost, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate } });
}
const INIT = JSON.stringify({ type: "system", subtype: "init", session_id: "x", tools: [] });
const ASSISTANT = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }], usage: { input_tokens: 9, output_tokens: 9 } } });

/**
 * A stub `claude`: each start is numbered (1, 2, …); start n prints `out-n`
 * (if any), sleeps `sleep-n` seconds (if any), and exits `code-n` (else 0).
 * Its stdin is kept as `stdin-n`, its argv as `argv-n`.
 */
function stub(outputs: readonly (string | null)[], codes: readonly number[] = [], sleeps: readonly number[] = []): string {
  outputs.forEach((o, i) => {
    if (o !== null) writeFileSync(join(bin, `out-${String(i + 1)}`), `${o}\n`, "utf8");
  });
  codes.forEach((c, i) => writeFileSync(join(bin, `code-${String(i + 1)}`), String(c), "utf8"));
  sleeps.forEach((s, i) => {
    if (s > 0) writeFileSync(join(bin, `sleep-${String(i + 1)}`), String(s), "utf8");
  });
  const path = join(bin, "claude");
  const q = (p: string): string => JSON.stringify(join(bin, p));
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `n=$(cat ${q("count")} 2>/dev/null || echo 0)`,
      "n=$((n+1))",
      `echo $n > ${q("count")}`,
      `printf '%s\\n' "$@" > ${q("argv")}-$n`,
      `cat > ${q("stdin")}-$n`,
      `[ -f ${q("out")}-$n ] && cat ${q("out")}-$n`,
      `[ -f ${q("sleep")}-$n ] && sleep $(cat ${q("sleep")}-$n)`,
      `exit $(cat ${q("code")}-$n 2>/dev/null || echo 0)`,
    ].join("\n"),
    "utf8",
  );
  chmodSync(path, 0o755);
  return path;
}

const started = (): number => {
  try {
    return Number(readFileSync(join(bin, "count"), "utf8").trim());
  } catch {
    return 0;
  }
};

function config(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { dataDir: dir, identity: { name: "Mike" }, ...over };
}

/** The configuration's path, as the night is handed it: beside the store, as `install` lays it out. */
const configPathOf = (): string => join(base, "claude-code.json");

function night(cfg: AdapterConfig, command: string, run = "nrn_usage", configPath: string = configPathOf()): ReturnType<typeof runNight> {
  return runNight({ open: () => openNightCounterpart(cfg), config: cfg, run, session: "s1", scope: base, kind: { kind: "night" }, command, configPath });
}

/** A store with a day for the writer to read and memories nobody tagged: a night of four children. */
function seed(): void {
  const c = openNightCounterpart(config());
  try {
    const about = pageWriterNight(c.store).about;
    const day = c.store.livedDay();
    for (const body of ["A thing noticed yesterday about the bench.", "Another thing from yesterday, untagged."]) {
      c.store.put({ type: "memory", kind: "fact", body, learnedOn: about, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
    }
  } finally {
    c.close();
  }
}

function nightEvents(): Record<string, unknown>[] {
  const c = openNightCounterpart(config());
  try {
    return c.store.eventLog({ name: NIGHT_RUN_EVENT }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
  } finally {
    c.close();
  }
}

function latest(): ReturnType<ReturnType<typeof openNightCounterpart>["dreams"]["nightRun"]> {
  const c = openNightCounterpart(config());
  try {
    return c.dreams.nightRun();
  } finally {
    c.close();
  }
}

describe("(a) each night child's tokens on dream.night", () => {
  test("the parser: the last result line's usage; none is null, a missing field is 0", () => {
    expect(childUsage([INIT, ASSISTANT, resultLine(5, 7, 1000, 10, 0.01)].join("\n"))).toEqual({ input: 5, output: 7, cacheRead: 1000, cacheCreate: 10, costUsd: 0.01 });
    expect(childUsage([INIT, ASSISTANT].join("\n"))).toBeNull();
    expect(childUsage(undefined)).toBeNull();
    expect(childUsage(`${INIT}\n${resultLine(1, 1, 1, 1, 1).slice(0, 40)}`)).toBeNull();
    expect(childUsage(JSON.stringify({ type: "result", usage: { output_tokens: 3 } }))).toEqual({ input: 0, output: 3, cacheRead: 0, cacheCreate: 0, costUsd: 0 });
    expect(childUsage(JSON.stringify({ type: "result", usage: null }))).toBeNull();
    expect(childUsage(JSON.stringify({ type: "result", usage: {} }))).toBeNull();
    expect(childUsage(JSON.stringify({ type: "result", usage: { input_tokens: "5", output_tokens: -1 } }))).toBeNull();
  });

  test("writer, dream, reflection and tags through a stub claude: each child's tokens and the total on the row, the event, the night line and doctor", async () => {
    SELF.PAGE_SPLIT = true;
    SCHEMAS.TAGS_NIGHT = true;
    seed();
    const cmd = stub([
      [INIT, ASSISTANT, resultLine(3, 4_000, 120_000, 30_000, 0.9)].join("\n"),
      [INIT, resultLine(5, 9_000, 400_000, 60_000, 2.5)].join("\n"),
      [INIT, resultLine(2, 6_000, 200_000, 40_000, 1.25)].join("\n"),
      [INIT, resultLine(10, 2_000, 30_000, 20_000, 0.05)].join("\n"),
    ]);
    const out = await night(config(), cmd);
    expect(out.children?.map((c) => c.child)).toEqual(["writer", "dream", "reflection", "tags"]);
    expect(started()).toBe(4);
    const usage = {
      writer: { input: 3, output: 4_000, cacheRead: 120_000, cacheCreate: 30_000, costUsd: 0.9 },
      dream: { input: 5, output: 9_000, cacheRead: 400_000, cacheCreate: 60_000, costUsd: 2.5 },
      reflection: { input: 2, output: 6_000, cacheRead: 200_000, cacheCreate: 40_000, costUsd: 1.25 },
      tags: { input: 10, output: 2_000, cacheRead: 30_000, cacheCreate: 20_000, costUsd: 0.05 },
      total: { input: 20, output: 21_000, cacheRead: 750_000, cacheCreate: 150_000, costUsd: 4.7 },
    };
    expect(out.usage).toEqual(usage);
    // The row as the store keeps it, read back; the event as the log keeps it.
    expect(latest()?.usage).toEqual(usage);
    const ended = nightEvents().find((p) => p["state"] === out.state);
    expect(ended?.["usage"]).toEqual(usage);
    expect(nightEvents().find((p) => p["state"] === "started")?.["usage"]).toBeUndefined();
    // What `counterparts night` and doctor say.
    expect(nightRunLine(latest() as NonNullable<ReturnType<typeof latest>>)).toContain("; 921k tokens");
    const c = openNightCounterpart(config());
    try {
      const f = nightRunFindings({ today: localDate(Date.now()), config: config() } as unknown as DoctorInput, c.store);
      expect(f[0]?.detail).toContain("921k tokens");
      expect(f[0]?.data["tokens"]).toBe(921_020);
    } finally {
      c.close();
    }
  }, 30_000);

  test("a child with no result line is null, not zeros; one that failed still records what it said", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    // The dream's child says nothing of its usage (stopped short); the reflection says it and exits 2.
    const out = await night(config(), stub([[INIT, ASSISTANT].join("\n"), [INIT, resultLine(1, 2, 3, 4, 0.5)].join("\n")], [0, 2]));
    expect(out.children?.map((c) => [c.child, c.code])).toEqual([
      ["dream", 0],
      ["reflection", 2],
    ]);
    expect(out.usage).toEqual({ dream: null, reflection: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4, costUsd: 0.5 }, total: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4, costUsd: 0.5 } });
    expect(latest()?.usage?.dream).toBeNull();
  }, 30_000);

  test("a failed first child: its usage rides the row the run ends on (could not start), the reflection never asked", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    const out = await night(config(), stub([[INIT, resultLine(7, 8, 9, 10, 0.25)].join("\n")], [2]));
    expect(out.state).toBe("could-not-start");
    expect(out.children?.find((c) => c.child === "reflection")?.skipped).toBe("quick-exit");
    expect(out.usage).toEqual({ dream: { input: 7, output: 8, cacheRead: 9, cacheCreate: 10, costUsd: 0.25 }, total: { input: 7, output: 8, cacheRead: 9, cacheCreate: 10, costUsd: 0.25 } });
    expect(latest()?.usage?.total?.input).toBe(7);
  }, 30_000);

  test("a child killed mid-stream by its watchdog said no usage: null, and the total null", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    const half = resultLine(1, 1, 1, 1, 1).slice(0, 30);
    const out = await night(config({ dreaming: { timeoutMs: 400 } }), stub([`${INIT}\n${half}`], [], [30]));
    expect(out.state).toBe("timed-out");
    expect(out.usage?.dream).toBeNull();
    expect(out.usage?.total).toBeNull();
    expect(nightRunLine(out)).not.toContain("tokens");
  }, 30_000);

  test("no claude at all: no child ran, so no usage on the row", async () => {
    SELF.PAGE_SPLIT = false;
    const out = await night(config({ debug: { nightTranscripts: true } }), join(bin, "no-such-claude"));
    expect(out).toMatchObject({ state: "could-not-start", reason: "no-claude" });
    expect(out.usage).toBeUndefined();
    // Switched on, and nothing to keep: no folder made.
    expect(existsSync(join(base, "debug"))).toBe(false);
  });
});

describe("(b) debug.nightTranscripts", () => {
  test("the setting: read leniently and quietly — unknown keys ignored, never refused, never an old setting", () => {
    const on = loadConfig({ dataDir: dir, debug: { nightTranscripts: true, somethingElse: 1 } });
    expect(on.ok).toBe(true);
    expect(on.config.debug).toEqual({ nightTranscripts: true });
    expect(on.config.retired).toBeUndefined();
    expect(on.config.observer).toBeUndefined();
    for (const raw of [{ nightTranscripts: "yes" }, { other: true }, "on", [true], null]) {
      const read = loadConfig({ dataDir: dir, debug: raw });
      expect(read.ok).toBe(true);
      expect(read.config.debug?.nightTranscripts).toBeUndefined();
      expect(read.config.retired).toBeUndefined();
    }
  });

  test("off: nothing written", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    await night(config(), stub([resultLine(1, 1, 1, 1, 0), resultLine(1, 1, 1, 1, 0)]));
    expect(started()).toBe(2);
    expect(existsSync(join(base, "debug"))).toBe(false);
  }, 30_000);

  test("on: one file per child, 0600 in 0700 folders, holding the child's own output", async () => {
    SELF.PAGE_SPLIT = true;
    SCHEMAS.TAGS_NIGHT = true;
    seed();
    const outs = ["writer", "dream", "reflection", "tags"].map((w, i) => [INIT, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: w }] } }), resultLine(i, i, i, i, 0)].join("\n"));
    const out = await night(config({ debug: { nightTranscripts: true } }), stub(outs));
    expect(out.children?.map((c) => c.child)).toEqual(["writer", "dream", "reflection", "tags"]);
    const debug = join(base, "debug");
    const today = localDate(Date.now());
    expect(readdirSync(debug)).toEqual([today]);
    expect(readdirSync(join(debug, today)).sort()).toEqual(["dream-nrn_usage.jsonl", "reflection-nrn_usage.jsonl", "tags-nrn_usage.jsonl", "writer-nrn_usage.jsonl"]);
    expect(statSync(debug).mode & 0o777).toBe(0o700);
    expect(statSync(join(debug, today)).mode & 0o777).toBe(0o700);
    for (const [i, child] of ["writer", "dream", "reflection", "tags"].entries()) {
      const file = join(debug, today, `${child}-nrn_usage.jsonl`);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, "utf8")).toBe(`${outs[i] as string}\n`);
    }
  }, 30_000);

  test("the week's prune: an 8-day-old folder's files go, a 6-day-old one stays, foreign files, links and folders are left", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    const debug = join(base, "debug");
    const today = localDate(Date.now());
    const old = join(debug, addDays(today, -(NIGHT_TRANSCRIPT_DAYS + 1)));
    const older = join(debug, addDays(today, -30));
    const recent = join(debug, addDays(today, -(NIGHT_TRANSCRIPT_DAYS - 1)));
    const edge = join(debug, addDays(today, -NIGHT_TRANSCRIPT_DAYS));
    for (const d of [old, older, recent, edge, join(debug, "notes")]) mkdirSync(d, { recursive: true });
    writeFileSync(join(old, "dream-nrn_old.jsonl"), "x");
    writeFileSync(join(old, "my-notes.txt"), "mine");
    writeFileSync(join(older, "tags-nrn_older.jsonl"), "x");
    writeFileSync(join(recent, "dream-nrn_recent.jsonl"), "x");
    writeFileSync(join(edge, "dream-nrn_edge.jsonl"), "x");
    writeFileSync(join(debug, "notes", "dream-nrn_notes.jsonl"), "x");
    // A link named like ours, pointing outside: neither it nor its target goes.
    const outside = join(base, "outside.jsonl");
    writeFileSync(outside, "keep me");
    symlinkSync(outside, join(old, "reflection-nrn_link.jsonl"));
    // A date-named LINK to a folder outside: not walked.
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "dream-nrn_far.jsonl"), "keep");
    symlinkSync(elsewhere, join(debug, addDays(today, -20)));

    await night(config(), stub([resultLine(1, 1, 1, 1, 0), resultLine(1, 1, 1, 1, 0)]));

    expect(existsSync(join(old, "dream-nrn_old.jsonl"))).toBe(false);
    expect(readFileSync(join(old, "my-notes.txt"), "utf8")).toBe("mine");
    expect(lstatSync(join(old, "reflection-nrn_link.jsonl")).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("keep me");
    expect(existsSync(older)).toBe(false);
    expect(existsSync(join(recent, "dream-nrn_recent.jsonl"))).toBe(true);
    expect(existsSync(join(edge, "dream-nrn_edge.jsonl"))).toBe(true);
    expect(existsSync(join(debug, "notes", "dream-nrn_notes.jsonl"))).toBe(true);
    expect(readFileSync(join(elsewhere, "dream-nrn_far.jsonl"), "utf8")).toBe("keep");
  }, 30_000);

  test("a debug folder that is a link, or a store outside the package's layout: nothing written, nothing pruned", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    const target = join(base, "target");
    mkdirSync(target);
    symlinkSync(target, join(base, "debug"));
    await night(config({ debug: { nightTranscripts: true } }), stub([resultLine(1, 1, 1, 1, 0), resultLine(1, 1, 1, 1, 0)]));
    expect(readdirSync(target)).toEqual([]);

    // A data dir not named `store`, or a configuration elsewhere: no debug folder at all.
    expect(nightDebugDir(join(base, "elsewhere"), configPathOf())).toBeNull();
    expect(nightDebugDir(dir, join(base, "cfg", "claude-code.json"))).toBeNull();
    expect(nightDebugDir(dir, undefined)).toBeNull();
    expect(nightDebugDir("store", "claude-code.json")).toBeNull();
    expect(nightDebugDir(dir, configPathOf())).toBe(join(base, "debug"));
  }, 30_000);

  test("a store whose configuration lives in another folder (uninstall would not see it): nothing written beside it", async () => {
    SELF.PAGE_SPLIT = false;
    SCHEMAS.TAGS_NIGHT = false;
    await night(config({ debug: { nightTranscripts: true } }), stub([resultLine(1, 1, 1, 1, 0), resultLine(1, 1, 1, 1, 0)]), "nrn_usage", join(base, "cfg", "claude-code.json"));
    expect(started()).toBe(2);
    expect(existsSync(join(base, "debug"))).toBe(false);
  }, 30_000);

  test("snapshots never carry it; uninstall counts it as ours", () => {
    const c = openNightCounterpart(config());
    try {
      mkdirSync(join(base, "debug", "2026-10-23"), { recursive: true });
      writeFileSync(join(base, "debug", "2026-10-23", "dream-nrn_x.jsonl"), "words");
      const report = runSnapshot({ counterpart: c, dataDir: dir, now: Date.parse("2026-10-23T12:00:00Z"), date: "2026-10-23" });
      expect(report.reason).toBe("taken");
      const walk = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [e.name, ...walk(join(p, e.name))] : [e.name]));
      const copied = walk(join(report.dir as string, report.name as string));
      expect(copied.length).toBeGreaterThan(0);
      expect(copied.some((n) => n === "debug" || n.endsWith(".jsonl"))).toBe(false);
    } finally {
      c.close();
    }
    const owned = ownedNames(configPathOf(), config(), dir);
    expect(ownedKind("debug", owned, base)).toBe("sidecar");
    expect(ownedKind("debug", owned)).toBeNull();
    expect(ownedKind("debug", ownedNames(configPathOf(), config(), join(base, "mystore")), base)).toBeNull();
    // Anything of the owner's in it makes the folder theirs: uninstall never deletes it whole.
    writeFileSync(join(base, "debug", "my-notes.txt"), "mine");
    expect(ownedKind("debug", owned, base)).toBeNull();
    rmSync(join(base, "debug", "my-notes.txt"));
    symlinkSync(join(base, "store"), join(base, "debug", "2026-10-22"));
    expect(ownedKind("debug", owned, base)).toBeNull();
  });

  test("uninstall's plan: a debug folder of ours goes with the whole directory; one holding the owner's file is named foreign and kept", () => {
    const home = join(base, "home");
    const cfgDir = join(home, ".counterparts");
    const store = join(cfgDir, "store");
    mkdirSync(cfgDir, { recursive: true });
    openNightCounterpart({ dataDir: store }).close();
    const cfg = join(cfgDir, "claude-code.json");
    writeFileSync(cfg, JSON.stringify({ dataDir: store }), "utf8");
    mkdirSync(join(cfgDir, "debug", "2026-10-23"), { recursive: true });
    writeFileSync(join(cfgDir, "debug", "2026-10-23", "dream-nrn_x.jsonl"), "words");
    const plan = (): ReturnType<typeof planUninstall> => planUninstall({ configPath: cfg, config: { dataDir: store }, home, verb: "delete" });
    expect(plan().refusal).toBeNull();
    expect(plan().foreign).toEqual([]);
    expect(plan().wholeDirectory).toBe(true);
    writeFileSync(join(cfgDir, "debug", "notes.md"), "mine");
    expect(plan().foreign).toEqual(["debug"]);
    expect(plan().wholeDirectory).toBe(false);
  });
});

describe("through bin/nightly.ts, a stub claude first on PATH", () => {
  test("the real entry point records each child's tokens and, switched on, keeps their output", () => {
    SELF.PAGE_SPLIT = false;
    const configPath = join(base, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, identity: { name: "Mike" }, debug: { nightTranscripts: true } }), "utf8");
    stub([[INIT, resultLine(11, 22, 33, 44, 0.1)].join("\n"), [INIT, resultLine(1, 2, 3, 4, 0.2)].join("\n")]);
    openNightCounterpart(config()).close();
    const nightly = join(import.meta.dir, "..", "src", "adapters", "claude-code", "bin", "nightly.ts");
    const out = Bun.spawnSync([process.execPath, "run", nightly], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: base,
        COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
        COUNTERPARTS_CONFIG: configPath,
        COUNTERPARTS_DATA_DIR: dir,
        COUNTERPARTS_SESSION: "s1",
        COUNTERPARTS_SCOPE: base,
        COUNTERPARTS_NIGHT_RUN: "nrn_e2e",
        COUNTERPARTS_NIGHT_KIND: "night",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(out.exitCode).toBe(0);
    const row = latest();
    expect(row?.run).toBe("nrn_e2e");
    expect(row?.usage?.dream).toEqual({ input: 11, output: 22, cacheRead: 33, cacheCreate: 44, costUsd: 0.1 });
    expect(row?.usage?.reflection).toEqual({ input: 1, output: 2, cacheRead: 3, cacheCreate: 4, costUsd: 0.2 });
    expect(row?.usage?.total).toEqual({ input: 12, output: 24, cacheRead: 36, cacheCreate: 48, costUsd: 0.3 });
    const day = join(base, "debug", localDate(Date.now()));
    expect(readdirSync(day)).toContain("dream-nrn_e2e.jsonl");
    expect(statSync(join(day, "dream-nrn_e2e.jsonl")).mode & 0o777).toBe(0o600);
  }, 30_000);
});
