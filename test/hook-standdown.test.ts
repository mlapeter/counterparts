/**
 * A HOOK THAT STOOD DOWN BECAUSE SOMETHING IS WRONG SAYS SO WHERE THE OWNER
 * WILL SEE IT — and a hook that stood down on purpose stays exactly as quiet as
 * it was (H1, 2026-09-18).
 *
 * `bin/hook.ts` has always ended a failed run with one line on stderr and exit
 * 0. A hook's stderr goes nowhere the owner looks, so a store that would not
 * open meant no wake, no recall and no capture in every session, with every
 * visible surface green. The channel that fixes it already exists: since I32 the
 * hook may print a top-level `systemMessage`, which the host DISPLAYS in the
 * terminal, non-blocking, on SessionStart and UserPromptSubmit.
 *
 * Most of what is asserted here is a claim about a PROCESS and a FILESYSTEM —
 * "nothing was injected", "nothing was written", "the second turn was quiet" —
 * so the tests spawn the real entry point with a real payload on stdin, the way
 * `test/scopes.test.ts` does. Each spawn gets a curated environment with a temp
 * `HOME` and no API keys, so no worker starts and nothing is ever billed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readCounterpartOpen, reportLines, worstFirst } from "../src/adapters/claude-code/doctor.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { reachesTheOwner } from "../src/adapters/claude-code/bin/hook.js";
import {
  BUSY_SESSION_START_MESSAGE,
  BUSY_TURN_MESSAGE,
  CONFIG_REFUSED,
  STANDDOWN_REASON_MAX_CHARS,
  STANDDOWN_TAIL,
  TRANSIENT_ESCALATE_AFTER,
  busyWedgedMessage,
  classifyStandDown,
  decideSay,
  describeFault,
  isDeliberate,
  readMark,
  standDownMarkerPath,
  standDownMessage,
  writeMark,
} from "../src/adapters/claude-code/standdown.js";
import type { StandDownMark } from "../src/adapters/claude-code/standdown.js";
import { canonicalScopePath, scopesPath } from "../src/adapters/scopes.js";
import { Store, StoreError, isDatabaseSidecar } from "../src/core/store/index.js";
import { makeBodyUnreadable } from "./store-fixture.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const BUDGET_BYTES = 9000;
/** The message's own opening words — what every "did the owner hear it" asserts on. */
const SAID = "Counterparts memory is OFF for this session";

let work: string;
let store: string;
let configPath: string;
let home: string;
/** A directory holding no `git`, so `readCheckout` cannot grade the agent's own
 *  worktree and the snapshot below measures the code rather than the working copy. */
let emptyBin: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-standdown-"));
  home = join(work, "home");
  emptyBin = join(work, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(emptyBin, { recursive: true });
  store = join(work, "store");
  configPath = join(work, "claude-code.json");
  writeFileSync(
    configPath,
    JSON.stringify({ dataDir: store, injectionBudgetBytes: BUDGET_BYTES }),
    "utf8",
  );
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

interface HookRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The curated environment every hook process here runs under. The transpiler
 * cache is off because bun keeps it under HOME, and a process still writing it
 * when `afterEach` removes `work` puts the directory back — one leftover per run
 * of this file (measured), which is a test not removing what it created.
 */
function hookEnv(): Record<string, string> {
  return {
    PATH: emptyBin,
    HOME: home,
    USERPROFILE: home,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  };
}

/** One real hook process, with a curated environment and no keys at all. */
function runHook(
  event: string,
  session: string,
  opts: {
    readonly args?: readonly string[];
    readonly env?: Record<string, string>;
    readonly cwd?: string;
    readonly source?: string;
  } = {},
): HookRun {
  const payload = JSON.stringify({
    hook_event_name: event,
    session_id: session,
    cwd: opts.cwd ?? work,
    ...(event === "SessionStart" ? { source: opts.source ?? "startup" } : {}),
    ...(event === "UserPromptSubmit" ? { prompt: "hello" } : {}),
  });
  const args = opts.args ?? ["--config", configPath];
  const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, ...args], {
    input: payload,
    encoding: "utf8",
    env: { ...hookEnv(), ...(opts.env ?? {}) },
    timeout: 60_000,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The `systemMessage` the host would display, or null when none was printed. */
function systemMessage(run: HookRun): string | null {
  if (run.stdout.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const value = (parsed as Record<string, unknown>)["systemMessage"];
  return typeof value === "string" ? value : null;
}

/**
 * A store that will not open, broken THE HONEST WAY: a live `type: "schema"`
 * row whose prose file is not there. `Schemas.open` scans every schema row at
 * open and reads each one's prose, so this is exactly the shape that stood
 * every hook of every session down while doctor printed GREEN Store.
 */
function breakTheStore(dir: string, body: string): string {
  const s = Store.open({ dir });
  try {
    const id = s.put({
      type: "schema",
      kind: "entity",
      title: "a belief",
      body,
      meta: { role: "entity", name: "a belief", aliases: [] },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    expect(s.row(id)).toBeDefined();
    return makeBodyUnreadable(s, id);
  } finally {
    s.close();
  }
}

/**
 * Every file under `dir`, by relative path, hashed by CONTENT.
 *
 * The `-shm` is skipped and NOTHING else, the way master's suites do it since
 * box 2 and box 3 went to WAL: it is the shared index every connection writes
 * read-marks into, a read-only one included (`store/paths.ts#isDatabaseSidecar`).
 * The `-wal` is hashed, because committed pages live in it until a checkpoint
 * and a hash that skipped it would pass over exactly the write this is here to
 * catch.
 */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).sort()) {
      if (isDatabaseSidecar(name)) continue;
      const full = join(at, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(dir, "");
  return out;
}

// ── the fault is said out loud ──────────────────────────────────────────────

describe("a store that will not open", () => {
  test("SessionStart says it: valid hook JSON, a systemMessage, exit 0, no wake", () => {
    breakTheStore(store, "a belief the store holds");
    const run = runHook("SessionStart", "s-broken-1");
    expect(run.code).toBe(0);
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    // NOTHING ELSE IS INJECTED: the object carries the message and no context.
    expect(Object.keys(parsed)).toEqual(["systemMessage"]);
    const message = String(parsed["systemMessage"]);
    expect(message).toStartWith(`${SAID}: `);
    expect(message).toContain("(MEMORY_BODY_MISSING)");
    expect(message).toEndWith(STANDDOWN_TAIL);
    // AND THE STDERR LINE IS KEPT — the host log still carries what it carried.
    expect(run.stderr).toContain("[counterparts] hook stood down:");
  });

  test("UserPromptSubmit says it once: the second turn of the same session is quiet", () => {
    breakTheStore(store, "a belief the store holds");
    const first = runHook("UserPromptSubmit", "s-broken-2");
    expect(first.code).toBe(0);
    expect(systemMessage(first)).toContain(SAID);
    const second = runHook("UserPromptSubmit", "s-broken-2");
    expect(second.code).toBe(0);
    expect(second.stdout).toBe("");
    // Quiet in the terminal, never quiet in the log.
    expect(second.stderr).toContain("[counterparts] hook stood down:");
    const third = runHook("UserPromptSubmit", "s-broken-2");
    expect(third.stdout).toBe("");
  });

  test("a NEW session is told, whatever the last one was told", () => {
    breakTheStore(store, "a belief the store holds");
    runHook("UserPromptSubmit", "s-broken-3");
    expect(runHook("UserPromptSubmit", "s-broken-3").stdout).toBe("");
    expect(systemMessage(runHook("UserPromptSubmit", "s-broken-4"))).toContain(SAID);
  });

  test("SessionStart says it again even after this session has been told", () => {
    breakTheStore(store, "a belief the store holds");
    expect(systemMessage(runHook("SessionStart", "s-broken-5"))).toContain(SAID);
    // A compaction re-fires SessionStart inside one session; the owner has just
    // had his terminal rewritten, so the line is worth repeating there.
    expect(systemMessage(runHook("SessionStart", "s-broken-5", { source: "compact" }))).toContain(
      SAID,
    );
  });

  test("the marker lives beside the session records, and carries no memory text", () => {
    const secret = "the-body-of-a-memory-nobody-may-print";
    breakTheStore(store, secret);
    runHook("SessionStart", "s-broken-6");
    const path = standDownMarkerPath(store, "s-broken-6");
    expect(path).not.toBeNull();
    const raw = readFileSync(path ?? "", "utf8");
    expect(raw).not.toContain(secret);
    const record = JSON.parse(raw) as Record<string, unknown>;
    expect(record["sessionId"]).toBe("s-broken-6");
    expect(record["event"]).toBe("session-start");
    expect(record["code"]).toBe("MEMORY_BODY_MISSING");
    expect(typeof record["at"]).toBe("string");
    expect(record["told"]).toBe(true);
    expect(record["transient"]).toEqual({ count: 0, at: "", told: false, escalated: false });
  });

  test("the hook reads and rewrites the WHOLE mark, transient counters included", () => {
    // The transient DISPLAY path cannot be driven from a test: a contended
    // database is a race, and under WAL a reader is not blocked by a writer at
    // all, so there is no way to schedule one. What a process CAN prove is the
    // wiring either side of `decideSay` — that the hook reads the mark this
    // session already has, and writes back what the rule decided — and the rule
    // itself is proved exhaustively below, without a filesystem.
    breakTheStore(store, "a belief the store holds");
    mkdirSync(join(store, "sessions"), { recursive: true });
    writeFileSync(
      join(store, "sessions", "s-carry.standdown.json"),
      `${JSON.stringify({
        sessionId: "s-carry",
        at: "2026-09-18T00:00:00.000Z",
        event: "user-prompt-submit",
        code: "HOOK_FAILED",
        told: false,
        transient: { count: 1, at: "2026-09-18T00:00:00.000Z", told: false, escalated: false },
      })}\n`,
      "utf8",
    );
    // A PERSISTENT fault: said, because this session has not been told one —
    // and the busy count it inherited survives.
    expect(systemMessage(runHook("UserPromptSubmit", "s-carry"))).toContain(SAID);
    const after = readMark(store, "s-carry");
    expect(after?.told).toBe(true);
    expect(after?.transient.count).toBe(1);
    // And now it is told, the next turn is quiet.
    expect(runHook("UserPromptSubmit", "s-carry").stdout).toBe("");
  });

  test("a marker that cannot be written still shows the message, and throws nothing", () => {
    breakTheStore(store, "a belief the store holds");
    const sessions = join(store, "sessions");
    mkdirSync(sessions, { recursive: true });
    chmodSync(sessions, 0o500);
    try {
      const first = runHook("UserPromptSubmit", "s-broken-7");
      expect(first.code).toBe(0);
      expect(systemMessage(first)).toContain(SAID);
      expect(existsSync(join(sessions, "s-broken-7.standdown.json"))).toBe(false);
      // No marker means it is said again rather than not at all — repeating is
      // noise, and silence is the incident this whole track is about.
      expect(systemMessage(runHook("UserPromptSubmit", "s-broken-7"))).toContain(SAID);
    } finally {
      chmodSync(sessions, 0o700);
    }
  });

  test("the mark is never written through a symlink, and lands atomically", () => {
    breakTheStore(store, "a belief the store holds");
    const outside = join(work, "outside.txt");
    writeFileSync(outside, "not the marker's to touch\n", "utf8");
    mkdirSync(join(store, "sessions"), { recursive: true });
    symlinkSync(outside, join(store, "sessions", "s-link.standdown.json"));

    // Said, because the message never depends on the mark landing.
    expect(systemMessage(runHook("SessionStart", "s-link"))).toContain(SAID);
    // And the file outside the store is exactly what it was.
    expect(readFileSync(outside, "utf8")).toBe("not the marker's to touch\n");
    expect(lstatSync(join(store, "sessions", "s-link.standdown.json")).isSymbolicLink()).toBe(true);
    // No half-written temp file left behind either.
    expect(readdirSync(join(store, "sessions")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("a directory sitting where the mark goes is refused, not written into", () => {
    breakTheStore(store, "a belief the store holds");
    mkdirSync(join(store, "sessions", "s-dir.standdown.json"), { recursive: true });
    const run = runHook("SessionStart", "s-dir");
    expect(run.code).toBe(0);
    expect(systemMessage(run)).toContain(SAID);
    expect(readdirSync(join(store, "sessions", "s-dir.standdown.json"))).toEqual([]);
  });

  test("no memory text and no prose body reaches either channel", () => {
    const secret = "the-body-of-a-memory-nobody-may-print";
    breakTheStore(store, secret);
    for (const event of ["SessionStart", "UserPromptSubmit"]) {
      const run = runHook(event, `s-secret-${event}`);
      expect(run.stdout).not.toContain(secret);
      expect(run.stderr).not.toContain(secret);
    }
  });
});

// ── the deliberate stand-downs stay quiet ───────────────────────────────────

describe("a deliberate stand-down says nothing in the terminal", () => {
  /** Every case below asserts the same thing: no `systemMessage`, exit 0. */
  const quiet = (run: HookRun): void => {
    expect(run.code).toBe(0);
    expect(systemMessage(run)).toBeNull();
    expect(run.stdout).not.toContain(SAID);
    expect(run.stderr).not.toContain(SAID);
  };

  /** The registry, written the way the console writes it. */
  const scopedOff = (dir: string): void => {
    writeFileSync(
      scopesPath(configPath),
      `${JSON.stringify(
        { version: 1, scopes: { [dir]: { mode: "off", since: "2026-09-10T00:00:00.000Z" } } },
        null,
        2,
      )}\n`,
      "utf8",
    );
  };

  test("the event's directory is scoped off", () => {
    breakTheStore(store, "a belief the store holds");
    scopedOff(canonicalScopePath(work));
    quiet(runHook("SessionStart", "s-off-1"));
    quiet(runHook("UserPromptSubmit", "s-off-1"));
  });

  test("the session's own directory is scoped off", () => {
    breakTheStore(store, "a belief the store holds");
    // The SESSION's directory, which is `CLAUDE_PROJECT_DIR`, and not the
    // shell's — so the second `off` return is the one that answers, after the
    // configuration has been read.
    const elsewhere = join(work, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    scopedOff(canonicalScopePath(elsewhere));
    quiet(runHook("SessionStart", "s-off-2", { env: { CLAUDE_PROJECT_DIR: elsewhere } }));
  });

  test("an observer with no store to read (STORE_UNINITIALIZED)", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ dataDir: join(work, "absent"), observer: true }),
      "utf8",
    );
    quiet(runHook("SessionStart", "s-observer"));
    quiet(runHook("UserPromptSubmit", "s-observer"));
  });

  test("the explicit-dir guard refusing a configuration nobody named", () => {
    // No `--config`, the guard armed: today's treatment, and the normal state of
    // every agent and test shell in this project.
    const run = runHook("SessionStart", "s-guard-1", {
      args: [],
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
    });
    quiet(run);
    expect(run.stderr).toContain("[counterparts] hook stood down:");
  });

  test("the explicit-dir guard refusing a named configuration that names no store", () => {
    const bare = join(work, "bare.json");
    writeFileSync(bare, JSON.stringify({ injectionBudgetBytes: BUDGET_BYTES }), "utf8");
    const run = runHook("SessionStart", "s-guard-2", {
      args: ["--config", bare],
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
    });
    quiet(run);
    expect(run.stderr).toContain("refused:");
  });

  test("an event name this adapter does not know", () => {
    quiet(runHook("PostToolUse", "s-unknown"));
  });

  test("a Stop re-fire on a healthy store", () => {
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], {
      input: JSON.stringify({
        hook_event_name: "Stop",
        session_id: "s-refire",
        cwd: work,
        stop_hook_active: true,
      }),
      encoding: "utf8",
      env: hookEnv(),
      timeout: 60_000,
    });
    quiet({ code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
  });

  test("a broken store on an event the host displays nothing for", () => {
    breakTheStore(store, "a belief the store holds");
    for (const event of ["Stop", "SessionEnd", "PreCompact"]) {
      const run = runHook(event, `s-undisplayed-${event}`);
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).not.toContain(SAID);
    }
  });

  test("and none of them leaves a marker behind", () => {
    breakTheStore(store, "a belief the store holds");
    for (const event of ["Stop", "SessionEnd", "PreCompact"]) {
      runHook(event, "s-nomarker");
    }
    expect(existsSync(join(store, "sessions", "s-nomarker.standdown.json"))).toBe(false);
  });
});

// ── the wall around v1's live stores holds ──────────────────────────────────

describe("a data dir this build refuses to open", () => {
  /**
   * HERMETIC, AND IT HAS TO BE: the directory names below are the ones the store
   * layer refuses BY NAME, so the test builds fakes under its own temp `HOME`
   * and the hook resolves `homedir()` from that. The real `~/.bansai` and
   * `~/.claude-engram` are neither read nor written here or anywhere in this
   * suite (CLAUDE.md's second standing rule).
   */
  for (const name of [".bansai", ".claude-engram"]) {
    test(`says it, and writes not one byte under a fake ${name}`, () => {
      const forbidden = join(home, name, "nested");
      const config = join(work, `forbidden${name}.json`);
      writeFileSync(config, JSON.stringify({ dataDir: forbidden }), "utf8");
      const run = runHook("SessionStart", "s-forbidden", { args: ["--config", config] });
      expect(run.code).toBe(0);
      // The fault is real and is said — it is the WRITE that is refused.
      expect(systemMessage(run)).toContain("(DATA_DIR_FORBIDDEN)");
      // Nothing was created. Not the marker, not the chain of directories to it.
      expect(existsSync(join(home, name))).toBe(false);
    });
  }

  test("it is a fault, not a deliberate stand-down — which is why it was reachable", () => {
    // `standdown.ts` has a `PLAIN_WORDS` entry for this code, so the path was
    // always going to be walked; the mark write is what had to be stopped, not
    // the message.
    const err = new StoreError("DATA_DIR_FORBIDDEN", { root: "/somewhere" });
    expect(isDeliberate(err)).toBe(false);
    expect(describeFault(err)).toEqual({
      code: "DATA_DIR_FORBIDDEN",
      reason: "the configured data dir is one this build refuses to open",
      kind: "persistent",
    });
  });

  test("the guard is inside the mark's own try, so a refusal is just 'no mark'", () => {
    // Proved against the temp HOME above; here the point is the shape — neither
    // door throws at a caller, whatever it is handed.
    expect(() => readMark(join(home, ".bansai"), "s1")).not.toThrow();
    expect(readMark(join(home, ".bansai"), "s1")).toBeNull();
  });
});

// ── the Stop hook's exit code is master's ───────────────────────────────────

describe("a fault never changes an exit code", () => {
  test("Stop on a store that will not open exits 0, silently", () => {
    breakTheStore(store, "a belief the store holds");
    for (const active of [false, true]) {
      const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], {
        input: JSON.stringify({
          hook_event_name: "Stop",
          session_id: "s-stop-exit",
          cwd: work,
          ...(active ? { stop_hook_active: true } : {}),
        }),
        encoding: "utf8",
        env: hookEnv(),
        timeout: 60_000,
      });
      // Master's behaviour exactly: a throw out of the run exits 0, whatever the
      // ask had set. Exit 2 would block the stop and feed this hook's whole
      // stderr — the stand-down line included — back into the model's context.
      expect(`active=${String(active)} exit`).toBe(`active=${String(active)} exit`);
      expect({ active, code: r.status, stdout: r.stdout }).toEqual({ active, code: 0, stdout: "" });
    }
  });
});

// ── a configuration somebody named ──────────────────────────────────────────

describe("a named configuration that cannot be honoured", () => {
  test("is a fault, and says so", () => {
    const run = runHook("SessionStart", "s-typo", {
      args: ["--config", join(work, "typo.json")],
    });
    expect(run.code).toBe(0);
    const message = systemMessage(run);
    expect(message).toContain(SAID);
    expect(message).toContain(`(${CONFIG_REFUSED})`);
    expect(run.stderr).toContain("[counterparts] hook stood down:");
  });

  test("says it every turn: nothing named a store, so there is nowhere to mark", () => {
    const args = ["--config", join(work, "typo.json")];
    expect(systemMessage(runHook("UserPromptSubmit", "s-typo-2", { args }))).toContain(SAID);
    expect(systemMessage(runHook("UserPromptSubmit", "s-typo-2", { args }))).toContain(SAID);
  });

  test("a named configuration that parses but does not typecheck", () => {
    const bad = join(work, "bad.json");
    writeFileSync(bad, JSON.stringify({ dataDir: 42 }), "utf8");
    const run = runHook("SessionStart", "s-bad", { args: ["--config", bad] });
    expect(run.code).toBe(0);
    expect(systemMessage(run)).toContain("(CONFIG_UNREADABLE)");
    // NO MARKER — and the place to look for one is the DEFAULT store under this
    // run's HOME, because by this point `hostConfig` has resolved `dataDir` to
    // it. Keeping its hands off that store's host state is the whole reason this
    // stand-down exists, so the assertion is that nothing was minted there.
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });
});

// ── the healthy path is unchanged ───────────────────────────────────────────

/**
 * WHAT A HOOK ON A WORKING STORE PRINTS, captured from `origin/master`
 * (039cd5d) before a line of this track was written and diffed byte for byte
 * against the branch.
 *
 * Two things about this string will move under somebody else's PR, and neither
 * is a fault here: the `systemMessage` is `credentialFindings`' own wording,
 * which three open doctor PRs are editing, and the wake is the cold-start
 * bootstrap plus the first-launch scope question. It is pinned because the one
 * thing this track may not do is change what a healthy session start emits.
 */
const HEALTHY_SESSION_START_STDOUT =
  '{"systemMessage":"counterparts: Credentials — (no credentialsFile in the config) holds no key: ' +
  "ANTHROPIC_API_KEY is missing, so the worker will run without an interpreter; nothing is encoded. " +
  "Run: counterparts credentials set ANTHROPIC_API_KEY (the value on stdin; it is never echoed)." +
  '\\nrun: counterparts doctor","hookSpecificOutput":{"hookEventName":"SessionStart",' +
  '"additionalContext":"No briefing has been composed yet — this store has not lived a boundary.' +
  "\\n\\n<counterparts-scope>\\nNo setting yet for this directory, so Counterparts is remembering here by default." +
  "\\nEarly on, ask the user once which they want: on, observer (reads and recalls, records" +
  "\\nnothing), or off (nothing at all). Record the answer with the `scope` tool (mode: on |" +
  "\\nobserver | off), or with `counterparts scope . --on`, `--observer` or `--off`. Then" +
  '\\ndo not ask again.\\n</counterparts-scope>"}}';

describe("a hook on a working store", () => {
  test("SessionStart emits exactly what it emitted on master", () => {
    const run = runHook("SessionStart", "h1-fixed-session");
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(HEALTHY_SESSION_START_STDOUT);
    expect(run.stderr).toBe("");
  });

  test("every other event is silent, and nothing says memory is off", () => {
    runHook("SessionStart", "h1-fixed-session");
    for (const event of ["UserPromptSubmit", "Stop", "SessionEnd", "PreCompact"]) {
      const run = runHook(event, "h1-fixed-session");
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stdout).not.toContain(SAID);
      expect(run.stderr).not.toContain(SAID);
    }
  });

  test("and leaves no stand-down marker", () => {
    runHook("SessionStart", "h1-fixed-session");
    runHook("UserPromptSubmit", "h1-fixed-session");
    expect(existsSync(join(store, "sessions", "h1-fixed-session.standdown.json"))).toBe(false);
  });
});

// ── the vocabulary ──────────────────────────────────────────────────────────

describe("the stand-down vocabulary", () => {
  test("the quiet list is the three refusals that are not faults", () => {
    for (const code of [
      "IMPLICIT_DEFAULT_DIR_REFUSED",
      "EXPLICIT_DIR_GUARD_MALFORMED",
      "STORE_UNINITIALIZED",
    ] as const) {
      expect(isDeliberate(new StoreError(code, {}))).toBe(true);
      expect(classifyStandDown(new StoreError(code, {}))).toBeNull();
    }
    expect(isDeliberate(new StoreError("MEMORY_BODY_MISSING", { id: "mem_x" }))).toBe(false);
  });

  test("a store code with no entry still gets a sentence and its own code", () => {
    // `LAYOUT_UNCLASSIFIED` has no entry in `PLAIN_WORDS` and is a real code a
    // read path can meet: a top-level path nobody classified.
    const fault = describeFault(new StoreError("LAYOUT_UNCLASSIFIED", { name: "surprise" }));
    expect(fault.code).toBe("LAYOUT_UNCLASSIFIED");
    expect(fault.reason.length).toBeGreaterThan(0);
  });

  test("anything that is not a StoreError is HOOK_FAILED and carries its message", () => {
    expect(describeFault(new Error("nothing like a lock"))).toEqual({
      code: "HOOK_FAILED",
      reason: "nothing like a lock",
      kind: "persistent",
    });
    expect(describeFault(new Error("   ")).reason.length).toBeGreaterThan(0);
  });

  test("a busy database is TRANSIENT, under every spelling db.ts knows", () => {
    for (const err of [
      new Error("database is locked"),
      new Error("database table is locked"),
      Object.assign(new Error("whatever"), { code: "SQLITE_BUSY" }),
      Object.assign(new Error("whatever"), { code: "SQLITE_LOCKED_SHAREDCACHE" }),
      new StoreError("SQLITE_UNAVAILABLE", {}),
    ]) {
      const expected = err instanceof StoreError ? "persistent" : "transient";
      expect(`${String(err.message)}: ${describeFault(err).kind}`).toBe(
        `${String(err.message)}: ${expected}`,
      );
    }
  });

  test("the message is capped, and the tail survives the cut", () => {
    const message = standDownMessage({
      code: "HOOK_FAILED",
      reason: "x".repeat(2000),
      kind: "persistent",
    });
    expect(message.length).toBeLessThan(STANDDOWN_REASON_MAX_CHARS + 120);
    expect(message).toEndWith(STANDDOWN_TAIL);
    expect(message).toContain("…");
  });

  test("a multi-line error message is collapsed to one line", () => {
    const message = standDownMessage({
      code: "HOOK_FAILED",
      reason: "one\n\ntwo\tthree ",
      kind: "persistent",
    });
    expect(message).toContain("one two three (HOOK_FAILED)");
    expect(message).not.toContain("\n");
  });

  test("no transient message ever says OFF, and both name the busy database", () => {
    for (const message of [BUSY_TURN_MESSAGE, BUSY_SESSION_START_MESSAGE]) {
      expect(message).not.toContain("OFF");
      expect(message).not.toContain("for this session");
      expect(message).toContain("busy");
      expect(message).toEndWith("If this keeps happening, run: counterparts doctor");
    }
    expect(BUSY_TURN_MESSAGE).toStartWith("Counterparts skipped this turn:");
    expect(BUSY_SESSION_START_MESSAGE).toStartWith(
      "Counterparts could not load memory at session start:",
    );
  });

  test("the marker helpers never throw, and answer false when they cannot", () => {
    const mark = {
      sessionId: "s1",
      at: "2026-09-18T00:00:00.000Z",
      event: "session-start",
      code: "PROSE_FILE_MISSING",
      told: true,
      transient: { count: 0, at: "", told: false, escalated: false },
    };
    expect(readMark(undefined, "s1")).toBeNull();
    expect(writeMark(undefined, "s1", mark)).toBe(false);
    // An id that is not one path segment is never turned into a filename.
    expect(standDownMarkerPath(store, "../escape")).toBeNull();
    expect(writeMark(store, "../escape", mark)).toBe(false);
    expect(readMark(store, "s-never-written")).toBeNull();
    expect(writeMark(store, "s1", mark)).toBe(true);
    expect(readMark(store, "s1")).toEqual(mark);
  });

  test("a mark written in the shape before the transient counters still reads", () => {
    mkdirSync(join(store, "sessions"), { recursive: true });
    writeFileSync(
      join(store, "sessions", "s-old.standdown.json"),
      `${JSON.stringify({ sessionId: "s-old", at: "t", event: "session-start", code: "X" })}\n`,
      "utf8",
    );
    const mark = readMark(store, "s-old");
    // The old shape was only ever written when a persistent line HAD been said.
    expect(mark?.told).toBe(true);
    expect(mark?.transient).toEqual({ count: 0, at: "", told: false, escalated: false });
  });
});

// ── persistent and transient are decided apart ──────────────────────────────

describe("the say rule", () => {
  const busy = describeFault(new Error("database is locked"));
  const broken = describeFault(new StoreError("MEMORY_BODY_MISSING", { id: "mem_x" }));
  const at = Date.parse("2026-09-18T12:00:00.000Z");

  test("a persistent fault: SessionStart always, a prompt only while untold", () => {
    const first = decideSay(broken, "session-start", "s", null, at);
    expect(first.message).toContain("memory is OFF for this session");
    expect(first.mark.told).toBe(true);
    // A compaction re-fires SessionStart, and it says it again.
    expect(decideSay(broken, "session-start", "s", first.mark, at).message).not.toBeNull();
    expect(decideSay(broken, "user-prompt-submit", "s", first.mark, at).message).toBeNull();
    const cold = decideSay(broken, "user-prompt-submit", "s", null, at);
    expect(cold.message).toContain("memory is OFF for this session");
  });

  test("a busy database at a prompt: quiet the first time, said the second, then quiet", () => {
    const one = decideSay(busy, "user-prompt-submit", "s", null, at);
    expect(one.message).toBeNull();
    expect(one.mark.transient).toEqual({
      count: 1,
      at: new Date(at).toISOString(),
      told: false,
      escalated: false,
    });

    const two = decideSay(busy, "user-prompt-submit", "s", one.mark, at);
    expect(two.message).toBe(BUSY_TURN_MESSAGE);
    expect(two.mark.transient.count).toBe(2);
    expect(two.mark.transient.told).toBe(true);

    const three = decideSay(busy, "user-prompt-submit", "s", two.mark, at);
    expect(three.message).toBeNull();
    expect(three.mark.transient.count).toBe(3);
  });

  test("a busy database at SESSION START is said the first time: there is no wake at all", () => {
    const first = decideSay(busy, "session-start", "s", null, at);
    expect(first.message).toBe(BUSY_SESSION_START_MESSAGE);
    expect(first.mark.transient).toEqual({
      count: 1,
      at: new Date(at).toISOString(),
      told: true,
      escalated: false,
    });
    // And having been told once, the session is not told again.
    expect(decideSay(busy, "user-prompt-submit", "s", first.mark, at).message).toBeNull();
  });

  test("the two are tracked APART: a persistent fault after a transient still says it", () => {
    const one = decideSay(busy, "user-prompt-submit", "s", null, at);
    const two = decideSay(busy, "user-prompt-submit", "s", one.mark, at);
    expect(two.mark.told).toBe(false);
    const then = decideSay(broken, "user-prompt-submit", "s", two.mark, at);
    expect(then.message).toContain("memory is OFF for this session");
    // …and the transient count it inherited is not lost.
    expect(then.mark.transient.count).toBe(2);
    expect(then.mark.told).toBe(true);
  });

  test("and a transient after a persistent fault stays quiet on its first turn", () => {
    const told = decideSay(broken, "session-start", "s", null, at);
    const one = decideSay(busy, "user-prompt-submit", "s", told.mark, at);
    expect(one.message).toBeNull();
    expect(one.mark.told).toBe(true);
  });

  /** Walk `count` prompts and answer with what the owner would have seen. */
  const prompts = (n: number, from: StandDownMark | null = null): (string | null)[] => {
    const seen: (string | null)[] = [];
    let mark = from;
    for (let i = 0; i < n; i += 1) {
      const step = decideSay(busy, "user-prompt-submit", "s", mark, at);
      seen.push(step.message);
      mark = step.mark;
    }
    return seen;
  };

  test("a database that STAYS busy escalates once, and says OFF only then", () => {
    // `isLocked` is a test on an error and cannot tell a 40 ms contention from a
    // lock nothing will release. Without this, prompts 3…n are silent forever —
    // I32 again, wearing the transient branch's clothes.
    const seen = prompts(6);
    expect(seen[0]).toBeNull();
    expect(seen[1]).toBe(BUSY_TURN_MESSAGE);
    expect(seen[2]).toBeNull();
    expect(seen[3]).toBeNull();
    expect(seen[4]).toBe(busyWedgedMessage(TRANSIENT_ESCALATE_AFTER));
    expect(seen[5]).toBeNull();
    // Said exactly once, and it is the one transient line allowed to say OFF.
    expect(seen.filter((m) => m !== null && m.includes("effectively off"))).toHaveLength(1);
    expect(busyWedgedMessage(5)).toContain("skipped 5 turns this session");
  });

  test("a locked SessionStart still reaches the escalation, and only once", () => {
    const start = decideSay(busy, "session-start", "s", null, at);
    expect(start.message).toBe(BUSY_SESSION_START_MESSAGE);
    // Counts 2…6 at prompts: the soft line is spent, so the next thing the owner
    // hears is the escalation at 5 — and nothing after it.
    const seen = prompts(5, start.mark);
    expect(seen).toEqual([null, null, null, busyWedgedMessage(TRANSIENT_ESCALATE_AFTER), null]);
  });

  test("the escalation outranks a soft line the session has not had yet", () => {
    // A mark carrying a big count and no `told` — the shape a session gets when
    // its early locks landed on events the host displays nothing for.
    const prior = {
      sessionId: "s",
      at: "",
      event: "stop",
      code: "HOOK_FAILED",
      told: false,
      transient: { count: TRANSIENT_ESCALATE_AFTER - 1, at: "", told: false, escalated: false },
    };
    const step = decideSay(busy, "user-prompt-submit", "s", prior, at);
    expect(step.message).toBe(busyWedgedMessage(TRANSIENT_ESCALATE_AFTER));
    expect(step.mark.transient.escalated).toBe(true);
    expect(step.mark.transient.told).toBe(true);
  });

  test("a negative count in a mark cannot buy back the silence", () => {
    mkdirSync(join(store, "sessions"), { recursive: true });
    writeFileSync(
      join(store, "sessions", "s-neg.standdown.json"),
      `${JSON.stringify({ sessionId: "s-neg", transient: { count: -1_000_000 } })}\n`,
      "utf8",
    );
    expect(readMark(store, "s-neg")?.transient.count).toBe(0);
  });
});

// ── a failure AFTER the turn's work is not a failure of the turn ────────────

describe("what may reach the owner at all", () => {
  /**
   * A close-time throw cannot be induced hermetically — it needs a patched tree,
   * which is how the review that found this proved it — so the rule is pinned
   * where it lives. The other half, a throw BEFORE the work, is proved by a real
   * process above: every "a store that will not open" test throws inside
   * `openAdapter`, and every one of them says it.
   */
  test("once the work is done, a later throw is stderr's and nothing else", () => {
    for (const hook of ["session-start", "user-prompt-submit"] as const) {
      expect(`${hook}: ${String(reachesTheOwner({ hook, wroteStdout: false, didWork: true }))}`).toBe(
        `${hook}: false`,
      );
    }
  });

  test("a throw before the work, on a displayed event, does reach the owner", () => {
    for (const hook of ["session-start", "user-prompt-submit"] as const) {
      expect(`${hook}: ${String(reachesTheOwner({ hook, wroteStdout: false, didWork: false }))}`).toBe(
        `${hook}: true`,
      );
    }
  });

  test("nothing follows the wake, and nothing is said on an undisplayed event", () => {
    expect(reachesTheOwner({ hook: "session-start", wroteStdout: true, didWork: false })).toBe(false);
    for (const hook of ["stop", "session-end", "pre-compact"] as const) {
      expect(`${hook}: ${String(reachesTheOwner({ hook, wroteStdout: false, didWork: false }))}`).toBe(
        `${hook}: false`,
      );
    }
  });
});

// ── doctor says RED when the store will not open ────────────────────────────

function doctorInput(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    configPath,
    configReason: "loaded",
    config: { dataDir: store },
    dir: store,
    credentials: { loaded: [], skippedPresent: [], mode: null, permissive: false, reason: "absent" },
    credentialsPath: undefined,
    store: null,
    today: "2026-09-18",
    refusals: {},
    ...over,
  } as DoctorInput;
}

describe("doctor reads the open, not just the directory", () => {
  test("green on a store a session could open", () => {
    Store.open({ dir: store }).close();
    const reading = readCounterpartOpen(store);
    expect(reading.ok).toBe(true);
    expect(reading.code).toBeNull();
    const found = doctorFindings(doctorInput({ open: reading })).find((f) => f.key === "store-open");
    expect(found?.severity).toBe("green");
  });

  test("red on a store whose words went missing, naming the code", () => {
    const gone = breakTheStore(store, "a belief the store holds");
    const reading = readCounterpartOpen(store);
    expect(reading.ok).toBe(false);
    expect(reading.code).toBe("MEMORY_BODY_MISSING");
    expect(reading.migratable).toBe(false);
    // NO PATH, and that is the honest answer on this floor: the fault carries
    // `{ id }` because there is no file to restore. `faultPath` returns null and
    // doctor takes its own no-path arm, which it already had.
    expect(reading.path).toBeNull();
    expect(gone).toMatch(/^sch_/);
    const findings = doctorFindings(doctorInput({ open: reading }));
    const found = findings.find((f) => f.key === "store-open");
    expect(found?.severity).toBe("red");
    expect(found?.detail).toContain("will not open — MEMORY_BODY_MISSING:");
    expect(found?.fix).toContain("The code names what the read path met.");
    // And it reaches the console's own report, worst first.
    const printed = reportLines(findings, "2026-09-18").join("\n");
    expect(printed).toContain("will not open — MEMORY_BODY_MISSING");
    expect(worstFirst(findings).filter((f) => f.severity === "red").map((f) => f.key)).toContain(
      "store-open",
    );
  });

  test("the reading writes NOTHING: the store is byte-identical after it", () => {
    breakTheStore(store, "a belief the store holds");
    const before = fingerprint(store);
    readCounterpartOpen(store);
    expect(fingerprint(store)).toEqual(before);
  });

  test("a healthy store is byte-identical after the reading too", () => {
    Store.open({ dir: store }).close();
    const before = fingerprint(store);
    readCounterpartOpen(store);
    expect(fingerprint(store)).toEqual(before);
  });

  test("a store an instrument may not initialize is AMBER, not red", () => {
    // `STORE_UNINITIALIZED` is what an OBSERVER gets on a store that is not
    // there yet or is a schema behind. The hooks run as owner and migrate it, so
    // red here would make the console lie between a deploy and the first hook.
    const reading = readCounterpartOpen(join(work, "absent"), () => {
      throw new StoreError("STORE_UNINITIALIZED", { dir: join(work, "absent") });
    });
    expect(reading.migratable).toBe(true);
    const found = doctorFindings(doctorInput({ open: reading })).find((f) => f.key === "store-open");
    expect(found?.severity).toBe("amber");
  });

  test("no reading, no finding — which is the session-start notice's case", () => {
    const findings = doctorFindings(doctorInput());
    expect(findings.find((f) => f.key === "store-open")).toBeUndefined();
  });
});
