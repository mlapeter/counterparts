/**
 * THE PROCESS LOG (`src/adapters/log/`, 2026-09-30) — one line per event, to a
 * per-date file under `<dataDir>/sessions/log/`, from the four processes whose
 * event rings used to die with them.
 *
 * What is held here: every one of the four processes writes a line (the real
 * entry points, spawned); only `LOGGED` names go in; no error message, path or
 * sentence reaches a line; files past their week are pruned, at SessionStart;
 * two processes appending at once do not tear a line; a log that cannot be
 * written never fails its caller; observer writes nothing; a store with
 * `sessions/log/` still opens and its registry is not confused; `counterparts
 * log` prints a day; doctor says it in one line; and the two failures the
 * brief promoted are durable rows.
 *
 * Every spawn passes an explicit `env` with a temp `HOME` (`test/preload.ts`).
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CAPTURE_FAILED_EVENT, Counterpart, WRITE_UP_FAILED_EVENT } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { addDays, daysBetween, localDate, machineZone } from "../src/core/time.js";
import {
  LOGGED,
  LOG_DAYS,
  clean,
  errorFields,
  isFailure,
  logDates,
  logDir,
  logFile,
  logged,
  openLog,
  pruneLog,
  readLog,
} from "../src/adapters/log/index.js";
import { pruneSessions, readServerRecords, readSession, recordSession } from "../src/adapters/sessions.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import { logFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { openServer } from "../src/adapters/mcp/index.js";

const SRC = resolve(import.meta.dir, "..", "src");
const HOOK = join(SRC, "adapters", "claude-code", "bin", "hook.ts");
const RUNNER = join(SRC, "adapters", "claude-code", "bin", "runner.ts");
const NIGHTLY = join(SRC, "adapters", "claude-code", "bin", "nightly.ts");
const SERVE = join(SRC, "adapters", "mcp", "bin", "serve.ts");
const LOG_MODULE = join(SRC, "adapters", "log", "index.ts");

/** A sentence no line may ever carry, with spaces so it is a message, not an id. */
const MARKER = "the owner's secret marker 7f3a9c";

let work: string;
let dir: string;
let home: string;
let configPath: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-log-"));
  dir = join(work, "store");
  home = join(work, "home");
  mkdirSync(home, { recursive: true });
  configPath = join(work, "claude-code.json");
  writeFileSync(
    configPath,
    JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, owner: true, embedder: { enabled: false } }),
    "utf8",
  );
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(work, { recursive: true, force: true });
});

/** A store on disk, closed again — what every process below finds. */
function makeStore(): void {
  Store.open({ dir }).close();
}

function lines(date: string = localDate(Date.now())): Record<string, unknown>[] {
  const file = logFile(dir, date);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Every line's text across every file — what a leak test greps. */
function everything(): string {
  if (!existsSync(logDir(dir))) return "";
  return readdirSync(logDir(dir))
    .map((n) => readFileSync(join(logDir(dir), n), "utf8"))
    .join("");
}

/**
 * A child's environment. `TZ` is this process's zone, named: bun test runs in UTC
 * unless TZ is set, while a child given a fresh env reads the MACHINE's zone. The
 * child names its log file by its day and `lines()` reads by this process's day,
 * so without it the two disagree whenever UTC and the machine's date differ —
 * every evening in America/Denver after 00:00 UTC.
 */
function spawnEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: "/usr/bin:/bin",
    TZ: machineZone(),
    HOME: home,
    USERPROFILE: home,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    ...extra,
  };
}

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

function input(over: Partial<HookInput> = {}): HookInput {
  return {
    sessionId: "s1",
    scope: "proj",
    turns: [
      { role: "user", text: "We settled the storage split today, and the cache is rebuildable." },
      { role: "assistant", text: "Recorded — a backup you cannot verify is a backup you do not have." },
    ],
    at: localDate(Date.now()),
    ...over,
  };
}

// ── what goes in ────────────────────────────────────────────────────────────

describe("the allowlist", () => {
  test("failures, stand-downs, turn ends, write-ups and the night go in; per-prompt detail stays out", () => {
    for (const name of [
      "process.start",
      "process.end",
      "adapter.boundary",
      "adapter.ask",
      "adapter.writeup.ask",
      "mcp.session_end",
      "handoff.written",
      "dream.night",
      "reflection.finished",
      "adapter.wake.injected",
      "counterpart.rebrief",
      "counterpart.sleep.cycle",
      "runner.retention",
      "adapter.hook.failed",
      "snapshot.threw",
      "adapter.observer.standdown",
    ]) {
      expect(logged(name), name).toBe(true);
    }
    for (const name of [
      "recall.quiet",
      "recall.credit",
      "counterpart.recall.decision",
      "adapter.recall",
      "mcp.recall",
      "associate.coactivate",
      "store.event.appended",
      "store.put",
      "remember.span.appended",
      "adapter.scope",
    ]) {
      expect(logged(name), name).toBe(false);
    }
    expect(LOGGED.suffixes).toEqual([".failed", ".threw", ".standdown"]);
  });

  test("a name outside the list writes nothing; one inside writes one line", () => {
    makeStore();
    const log = openLog({ dataDir: dir, proc: "hook:stop", session: "s1" });
    log.event({ name: "recall.quiet", data: { turn: 1 } });
    expect(existsSync(logDir(dir))).toBe(false);
    log.event({ at: Date.now(), name: "adapter.boundary", data: { spans: 2, reason: "APPENDED" } });
    const got = lines();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      proc: "hook:stop",
      pid: process.pid,
      session: "s1",
      name: "adapter.boundary",
      data: { spans: 2, reason: "APPENDED" },
    });
    expect(typeof got[0]?.["at"]).toBe("string");
    // Owner-only, like every other file under sessions/.
    expect(statSync(logFile(dir, localDate(Date.now()))).mode & 0o777).toBe(0o600);
  });

  test("the file is named by the day in the configured zone, not UTC's", () => {
    makeStore();
    const at = Date.parse("2026-09-30T23:30:00Z");
    const log = openLog({ dataDir: dir, proc: "worker", timeZone: "Pacific/Auckland", now: () => at });
    log.start();
    expect(logDates(dir)).toEqual(["2026-10-01"]);
    expect(lines("2026-10-01")[0]).toMatchObject({ name: "process.start", proc: "worker", session: null });
  });

  test("process.end says how long and why", () => {
    makeStore();
    let t = 1_000;
    const log = openLog({ dataDir: dir, proc: "nightly", now: () => t });
    log.start({ run: "nrn_1" });
    t += 250;
    log.end("done", { parts: "writer,dream" });
    const [start, end] = lines(localDate(1_000));
    expect(start).toMatchObject({ name: "process.start", data: { run: "nrn_1" } });
    expect(end).toMatchObject({ name: "process.end", data: { ms: 250, reason: "done", parts: "writer,dream" } });
  });
});

// ── the content rule ────────────────────────────────────────────────────────

describe("the content rule (store §5 G10)", () => {
  test("a thrown error whose message carries a marker leaves its class, code and place — never the marker", () => {
    makeStore();
    let thrown: unknown;
    try {
      // Thrown from inside this package, with the marker in its message.
      daysBetween(MARKER, "2026-09-30");
    } catch (err) {
      thrown = err;
    }
    expect(String((thrown as Error).message)).toContain(MARKER);
    const fields = errorFields(thrown);
    expect(fields.error).toBe("Error");
    expect(fields.where).toMatch(/^core\/time\.ts:\d+$/);
    const log = openLog({ dataDir: dir, proc: "worker" });
    log.threw(thrown);
    const text = everything();
    expect(text).toContain('"reason":"threw"');
    expect(text).toContain('"where":"core/time.ts:');
    expect(text).not.toContain("marker");
    expect(text).not.toContain("7f3a9c");
  });

  test("a hook that fails on an error carrying the marker logs the failure and not the words", () => {
    const log = openLog({ dataDir: dir, proc: "hook:stop", session: "s1" });
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000 },
      { command: "/bin/true", args: ["x"], spawner: () => ({ pid: 1 }), embedder: null, onEvent: log.event, onCounterpartEvent: log.event },
    );
    open.push(a.counterpart);
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    spyOn(a.counterpart, "boundary").mockImplementation(() => {
      throw new Error(MARKER);
    });
    const out = a.hook("stop", input());
    expect(out.ok).toBe(false);
    const text = everything();
    expect(text).toContain("adapter.hook.failed");
    expect(text).not.toContain("marker");
    expect(text).not.toContain("7f3a9c");
  });

  test("a model-typed write-up id reaches the log only when the registry knows the session", async () => {
    makeStore();
    recordSession(dir, { sessionId: "s-live", scope: "proj", phase: "start" });
    recordSession(dir, { sessionId: "s-old", scope: "proj", phase: "start" });
    const log = openLog({ dataDir: dir, proc: "mcp" });
    const s = openServer({ dir, scope: "proj", onEvent: log.event, onCounterpartEvent: log.event });
    open.push(s.counterpart);
    await s.call("session_end", { session: "s-live", writeUp: "SecretWordBravo" });
    await s.call("session_end", { session: "s-live", writeUp: "s-old" });
    const writeUps = lines().filter((l) => l["name"] === "mcp.write_up");
    expect(writeUps).toHaveLength(2);
    expect(writeUps[0]?.["ref"]).toBeUndefined();
    expect(writeUps[1]?.["ref"]).toBe("s-old");
    expect(everything()).not.toContain("SecretWordBravo");
  });

  test("a value that is not an id, a code or a count is written as its length", () => {
    expect(
      clean({
        id: "mem_01HX",
        code: "SQLITE_BUSY",
        n: 3,
        ok: true,
        none: null,
        date: "2026-09-30",
        where: "adapters/log/index.ts:12",
        path: "/Users/someone/project",
        home: "~/.counterparts",
        up: "a/../b",
        sentence: "a turn the person typed",
        list: [1, 2],
        map: { a: 1 },
        nan: Number.NaN,
      }),
    ).toEqual({
      id: "mem_01HX",
      code: "SQLITE_BUSY",
      n: 3,
      ok: true,
      none: null,
      date: "2026-09-30",
      where: "adapters/log/index.ts:12",
      path: "[text:22]",
      home: "[text:15]",
      up: "[text:6]",
      sentence: "[text:23]",
      list: "[list:2]",
      map: "[map:1]",
      nan: null,
    });
  });
});

// ── seven days ──────────────────────────────────────────────────────────────

describe("seven days", () => {
  test("files dated more than LOG_DAYS before today go; the rest, and anything not a date, stay", () => {
    const today = "2026-09-30";
    mkdirSync(logDir(dir), { recursive: true });
    for (let i = 0; i <= 10; i += 1) writeFileSync(logFile(dir, addDays(today, -i)), "{}\n");
    writeFileSync(join(logDir(dir), "notes.txt"), "mine\n");
    expect(pruneLog(dir, today)).toBe(10 - LOG_DAYS);
    expect(logDates(dir)).toEqual(Array.from({ length: LOG_DAYS + 1 }, (_, i) => addDays(today, -LOG_DAYS + i)));
    expect(existsSync(join(logDir(dir), "notes.txt"))).toBe(true);
  });

  test("SessionStart prunes them, beside the session registry", () => {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000 },
      { command: "/bin/true", args: ["x"], spawner: () => ({ pid: 1 }), embedder: null },
    );
    open.push(a.counterpart);
    const today = localDate(Date.now(), a.counterpart.store.zone());
    mkdirSync(logDir(dir), { recursive: true });
    writeFileSync(logFile(dir, addDays(today, -20)), "{}\n");
    writeFileSync(logFile(dir, addDays(today, -1)), "{}\n");
    a.hook("session-start", input());
    expect(logDates(dir)).toEqual([addDays(today, -1)]);
    expect(a.events("adapter.log.pruned")[0]?.data).toEqual({ removed: 1 });
  });
});

// ── the layout and the registry ────────────────────────────────────────────

describe("sessions/log/ confuses nothing", () => {
  test("the store still opens with sessions/log/ present — the layout check sees only `sessions`", () => {
    makeStore();
    mkdirSync(logDir(dir), { recursive: true });
    writeFileSync(logFile(dir, "2026-09-30"), "{}\n");
    const s = Store.open({ dir });
    open.push(s);
    expect(() => s.assertLayout()).not.toThrow();
  });

  test("pruneSessions leaves an old log directory and its files alone, and the readers skip it", () => {
    makeStore();
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    mkdirSync(logDir(dir), { recursive: true });
    writeFileSync(logFile(dir, "2026-09-01"), "{}\n");
    const month = (Date.now() - 30 * 86_400_000) / 1000;
    utimesSync(logDir(dir), month, month);
    pruneSessions(dir);
    expect(existsSync(logFile(dir, "2026-09-01"))).toBe(true);
    expect(readSession(dir, "s1")?.sessionId).toBe("s1");
    expect(readServerRecords(dir)).toEqual([]);
  });
});

// ── never the caller's problem ──────────────────────────────────────────────

describe("a log that cannot be written", () => {
  test("never throws, and never fails the hook it rides on", () => {
    makeStore();
    // A FILE where the directory should be: every write fails.
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(logDir(dir), "not a directory\n");
    const log = openLog({ dataDir: dir, proc: "hook:session-start", session: "s1" });
    expect(() => {
      log.start();
      log.event({ name: "adapter.hook.failed", data: { code: "X" } });
      log.end("ok");
      log.threw(new Error("x"));
    }).not.toThrow();
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000 },
      { command: "/bin/true", args: ["x"], spawner: () => ({ pid: 1 }), embedder: null, onEvent: log.event, onCounterpartEvent: log.event },
    );
    open.push(a.counterpart);
    // `absent` is a fresh store's wake (nothing rendered yet); `failed` would be the hook's guard.
    expect(a.hook("session-start", input()).reason).toBe("absent");
  });
});

// ── observer ────────────────────────────────────────────────────────────────

describe("observer writes nothing", () => {
  test("an observer's log is off and makes no directory", () => {
    makeStore();
    const log = openLog({ dataDir: dir, proc: "hook:stop", observer: true });
    expect(log.on).toBe(false);
    log.start();
    log.event({ name: "adapter.hook.failed", data: { code: "X" } });
    log.end("ok");
    expect(existsSync(logDir(dir))).toBe(false);
  });

  test("nor does a log with no store to write beside — it never makes a data dir", () => {
    const log = openLog({ dataDir: dir, proc: "worker" });
    log.start();
    expect(existsSync(dir)).toBe(false);
  });

  test("a real hook on an observer configuration leaves no log", () => {
    makeStore();
    const observerConfig = join(work, "observer.json");
    writeFileSync(observerConfig, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, observer: true }), "utf8");
    const r = spawnSync(process.execPath, ["run", HOOK, "--config", observerConfig], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "s-obs", cwd: work, source: "startup" }),
      encoding: "utf8",
      env: spawnEnv(),
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    expect(existsSync(logDir(dir))).toBe(false);
  }, 60_000);
});

// ── four processes ──────────────────────────────────────────────────────────

describe("each of the four processes writes its lines", () => {
  test("the hook: its start, what it did, and its end, under its event and session", () => {
    makeStore();
    const r = spawnSync(process.execPath, ["run", HOOK, "--config", configPath], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "s-hook", cwd: work, source: "startup" }),
      encoding: "utf8",
      env: spawnEnv(),
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    const got = lines();
    const names = got.map((l) => l["name"]);
    expect(names[0]).toBe("process.start");
    expect(names).toContain("adapter.wake.injected");
    expect(names[names.length - 1]).toBe("process.end");
    for (const l of got) expect(l).toMatchObject({ proc: "hook:session-start", session: "s-hook" });
    // The allowlist held across a real process, where many more names fired.
    for (const name of names) expect(logged(String(name)), String(name)).toBe(true);

    // A prompt, the most frequent event, writes its end and no start.
    const prompt = spawnSync(process.execPath, ["run", HOOK, "--config", configPath], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s-hook", cwd: work, prompt: "hello" }),
      encoding: "utf8",
      env: spawnEnv(),
      timeout: 60_000,
    });
    expect(prompt.status).toBe(0);
    const promptLines = lines().filter((l) => l["proc"] === "hook:user-prompt-submit");
    expect(promptLines.map((l) => l["name"])).toContain("process.end");
    expect(promptLines.map((l) => l["name"])).not.toContain("process.start");
  }, 60_000);

  test("the worker: start, the day's summary, end", () => {
    makeStore();
    const r = spawnSync(process.execPath, ["run", RUNNER], {
      encoding: "utf8",
      env: spawnEnv({
        COUNTERPARTS_CONFIG: configPath,
        COUNTERPARTS_DATA_DIR: dir,
        COUNTERPARTS_SESSION: "s-worker",
        COUNTERPARTS_SCOPE: work,
      }),
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    const got = lines().filter((l) => l["proc"] === "worker");
    const names = got.map((l) => l["name"]);
    expect(names[0]).toBe("process.start");
    expect(names).toContain("runner.done");
    expect(names).toContain("counterpart.sleep.cycle");
    expect(got[got.length - 1]).toMatchObject({ name: "process.end", session: "s-worker", data: { reason: "ran" } });
  }, 60_000);

  test("the nightly run: start, the run's recorded state, and an end naming it", () => {
    makeStore();
    // No `claude` on this PATH: the run cannot start, and says so.
    const r = spawnSync(process.execPath, ["run", NIGHTLY], {
      encoding: "utf8",
      env: spawnEnv({
        PATH: join(work, "empty-bin"),
        COUNTERPARTS_CONFIG: configPath,
        COUNTERPARTS_DATA_DIR: dir,
        COUNTERPARTS_SESSION: "s-night",
        COUNTERPARTS_SCOPE: work,
        COUNTERPARTS_NIGHT_RUN: "nrn_log",
        COUNTERPARTS_NIGHT_KIND: "night",
      }),
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    const got = lines().filter((l) => l["proc"] === "nightly");
    const names = got.map((l) => l["name"]);
    expect(names[0]).toBe("process.start");
    expect(names).toContain("dream.night");
    expect(got[got.length - 1]).toMatchObject({
      name: "process.end",
      session: "s-night",
      data: { reason: "could-not-start", why: "no-claude", run: "nrn_log" },
    });
  }, 60_000);

  test("the MCP server: start, a refused tool, and its end when stdin closes", () => {
    makeStore();
    const wire = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "session_end", arguments: { memories: [] } } },
    ]
      .map((m) => JSON.stringify(m))
      .join("\n");
    const r = spawnSync(process.execPath, ["run", SERVE, "--config", configPath, "--dir", dir, "--scope", work], {
      input: `${wire}\n`,
      encoding: "utf8",
      env: spawnEnv(),
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    const got = lines().filter((l) => l["proc"] === "mcp");
    const names = got.map((l) => l["name"]);
    expect(names[0]).toBe("process.start");
    expect(names).toContain("mcp.refused");
    expect(got[got.length - 1]).toMatchObject({ name: "process.end", data: { reason: "stdin-closed" } });
  }, 60_000);
});

// ── two at once ─────────────────────────────────────────────────────────────

describe("two processes appending at once", () => {
  test("every line arrives whole", async () => {
    makeStore();
    const N = 400;
    const script = join(work, "append.ts");
    writeFileSync(
      script,
      [
        `import { openLog } from ${JSON.stringify(LOG_MODULE)};`,
        `const log = openLog({ dataDir: ${JSON.stringify(dir)}, proc: "worker", session: process.argv[2] });`,
        `for (let i = 0; i < ${String(N)}; i += 1) log.event({ name: "adapter.boundary", data: { i, pad: "x".repeat(150) } });`,
      ].join("\n"),
      "utf8",
    );
    const env = spawnEnv({ PATH: process.env["PATH"] ?? "/usr/bin:/bin" });
    const a = Bun.spawn([process.execPath, "run", script, "a"], { env, stdout: "ignore", stderr: "pipe" });
    const b = Bun.spawn([process.execPath, "run", script, "b"], { env, stdout: "ignore", stderr: "pipe" });
    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    const read = readLog(dir, localDate(Date.now()));
    expect(read.unreadable).toBe(0);
    expect(read.entries).toHaveLength(2 * N);
    expect(read.entries.filter((e) => e.session === "a")).toHaveLength(N);
    expect(read.entries.filter((e) => e.session === "b")).toHaveLength(N);
  }, 60_000);
});

// ── counterparts log ────────────────────────────────────────────────────────

describe("counterparts log", () => {
  test("prints a day oldest first, one line each, with the dashboard's sentence where there is one", async () => {
    makeStore();
    const now = Date.now();
    const log = openLog({ dataDir: dir, proc: "hook:stop", session: "3f2a9c1e-aaaa-bbbb", now: () => now });
    log.start();
    log.event({ at: now, name: "adapter.boundary", data: { spans: 2, captured: true, reason: "APPENDED" } });
    log.event({ at: now, name: "adapter.tail.failed", data: { code: "EACCES" } });
    // A ring-shaped handoff: its durable sentence would misread these fields,
    // so it prints them as they are.
    log.event({ at: now, name: "handoff.written", data: { bytes: 120, version: 1, created: true } });
    log.end("APPENDED");
    const c = consoleWith();
    expect(await run(["log", "--dir", dir], { io: c.io, env: {}, now: () => now })).toBe(EXIT.ok);
    expect(c.out).toHaveLength(5);
    expect(c.out[3]).toContain("handoff.written  bytes=120 version=1 created=true");
    expect(c.out[3]).not.toContain("showing for");
    c.out.splice(3, 1);
    expect(c.out[0]).toMatch(/^\d{2}:\d{2}:\d{2}  hook:stop\s+3f2a9c1e  process\.start/);
    expect(c.out[1]).toContain("adapter.boundary");
    expect(c.out[1]).toContain("A session reached its boundary — 2 turns captured");
    expect(c.out[2]).toContain("adapter.tail.failed  code=EACCES");
    expect(c.out[3]).toContain("process.end");
    expect(c.out[3]).toContain("reason=APPENDED");
  });

  test("--date prints another day; a day with nothing says so and names the days held", async () => {
    makeStore();
    const now = Date.now();
    const today = localDate(now);
    const yesterday = addDays(today, -1);
    const at = now - 86_400_000;
    openLog({ dataDir: dir, proc: "worker", now: () => at }).start();
    const c = consoleWith();
    expect(await run(["log", "--dir", dir, "--date", localDate(at)], { io: c.io, env: {}, now: () => now })).toBe(EXIT.ok);
    expect(c.out).toHaveLength(1);
    expect(c.out[0]).toContain("worker");
    const empty = consoleWith();
    expect(await run(["log", "--dir", dir], { io: empty.io, env: {}, now: () => now })).toBe(EXIT.ok);
    expect(empty.out.join("\n")).toContain(`Nothing logged on ${today}.`);
    expect(empty.out.join("\n")).toContain(localDate(at) === yesterday ? yesterday : localDate(at));
  });

  test("a date that is not a day is refused, and an unnamed store is refused under the guard", async () => {
    makeStore();
    const bad = consoleWith();
    expect(await run(["log", "--dir", dir, "--date", "yesterday"], { io: bad.io, env: {} })).toBe(EXIT.usage);
    expect(bad.err.join("\n")).toContain("--date takes a day");
    const unnamed = consoleWith();
    expect(await run(["log"], { io: unnamed.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } })).toBe(EXIT.refused);
  });
});

// ── doctor ──────────────────────────────────────────────────────────────────

describe("doctor's one line", () => {
  test("where the log is, how many days it holds, and how many failures today", () => {
    makeStore();
    const today = localDate(Date.now());
    const reading = (): DoctorInput =>
      ({ dir, today, config: { dataDir: dir }, configPath, configReason: "loaded", store: null, refusals: {} }) as DoctorInput;
    expect(logFindings(reading())[0]).toMatchObject({ key: "log", severity: "green", data: { days: 0 } });
    const log = openLog({ dataDir: dir, proc: "hook:stop" });
    log.start();
    log.event({ name: "adapter.tail.failed", data: { code: "X" } });
    log.threw(new Error("x"));
    const [f] = logFindings(reading());
    expect(f).toMatchObject({ key: "log", severity: "green", title: "Log", data: { days: 1, failuresToday: 2 } });
    expect(f?.detail).toContain(logDir(dir));
    expect(f?.detail).toContain("holds 1 day");
    expect(f?.detail).toContain("2 failures today");
    expect(isFailure({ name: "process.end", data: { reason: "ok" } })).toBe(false);
  });
});

// ── the two failures that became rows ───────────────────────────────────────

describe("two failures are durable rows", () => {
  test("a turn the buffer would not take is a remember.capture.failed row — code and site, no words", () => {
    const c = Counterpart.open({ dir });
    open.push(c);
    // A FILE where the span buffer's directory should be: the capture cannot write.
    rmSync(join(dir, "spans"), { recursive: true, force: true });
    writeFileSync(join(dir, "spans"), "not a directory\n");
    const out = c.captureSpans({ session: "s1", scope: "proj", turns: input().turns ?? [] });
    expect(out.reason).toBe("IO_FAILED");
    const rows = c.store.eventLog({ name: CAPTURE_FAILED_EVENT, limit: 10 });
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ session: "s1", site: "capture" });
    expect(typeof payload["code"]).toBe("string");
    expect(rows[0]?.payload ?? "").not.toContain("storage split");
  });

  test("a write-up pointer that could not be composed is an adapter.writeup.failed row", () => {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000 },
      { command: "/bin/true", args: ["x"], spawner: () => ({ pid: 1 }), embedder: null },
    );
    open.push(a.counterpart);
    spyOn(a.counterpart.self, "calendarToday").mockImplementation(() => {
      throw new Error(MARKER);
    });
    // Fail-open: the wake still went out (`absent` on a fresh store), only the pointer was lost.
    expect(a.hook("session-start", input({ sessionId: "s-wu" })).reason).toBe("absent");
    const rows = a.counterpart.store.eventLog({ name: WRITE_UP_FAILED_EVENT, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject({ session: "s-wu", code: "Error" });
    expect(rows[0]?.payload ?? "").not.toContain("marker");
  });
});
