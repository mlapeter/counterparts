/**
 * PER-DIRECTORY SCOPE CONTROLS — the registry, the three stances, the pause,
 * the first-launch question, and the two surfaces that can change them.
 *
 * Owner asks G41–G43 (2026-09-10), and the three host gaps they close
 * (`claude-code/INTERFACE-GAPS.md` 6, 7, 8): nobody was asked before a new
 * directory started being remembered; turning one off took four moving parts;
 * and there was no way to pause a directory that is normally on.
 *
 * The tests that matter most here are the PROCESS ones. "The hook produces no
 * output and writes nothing" is a claim about a process and a filesystem, not
 * about a function — the whole guarantee is that nothing is constructed at all,
 * and only a real run can show that. Each spawn gets an explicit `env` with a
 * temp `HOME` (the preload's rule for children) and no API keys, so no worker
 * starts and nothing is ever billed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { SCOPE_ASK } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { hookScope, hookScopeVerdict } from "../src/adapters/claude-code/bin/hook.js";
import { EXIT, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/commands.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  SCOPES_FILE_NAME,
  canonicalScopePath,
  effectiveStance,
  emptyRegistry,
  lookupScope,
  ownEntry,
  parseRegistry,
  readScopes,
  resumeTarget,
  scopesPath,
  setScope,
  stanceOfMode,
  writeScopes,
} from "../src/adapters/scopes.js";
import type { ScopeRegistry } from "../src/adapters/scopes.js";
import { readSession } from "../src/adapters/sessions.js";
import { BOUNDARY_EVENT, RECALL_CREDIT_EVENT } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const BUDGET_BYTES = 9000;

let work: string;
let store: string;
let configPath: string;
let scopesFile: string;
let home: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-scope-"));
  home = join(work, "home");
  mkdirSync(home, { recursive: true });
  store = join(work, "store");
  configPath = join(work, "claude-code.json");
  scopesFile = scopesPath(configPath);
  writeFileSync(
    configPath,
    JSON.stringify({ dataDir: store, injectionBudgetBytes: BUDGET_BYTES }),
    "utf8",
  );
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** The registry, written the way the console writes it. */
function put(entries: Record<string, unknown>): void {
  writeFileSync(
    scopesFile,
    `${JSON.stringify({ version: 1, scopes: entries }, null, 2)}\n`,
    "utf8",
  );
}

/** A hook payload with the four fields `toHookInput` reads. */
function hookPayload(event: string, session: string, cwd: string, transcript?: string): string {
  return JSON.stringify({
    hook_event_name: event,
    session_id: session,
    cwd,
    ...(transcript === undefined ? {} : { transcript_path: transcript }),
  });
}

/** One real hook process, with a curated environment and no keys at all. */
function runHook(
  event: string,
  session: string,
  cwd: string,
  extra: readonly string[] = [],
  transcript?: string,
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath, ...extra], {
    input: hookPayload(event, session, cwd, transcript),
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, USERPROFILE: home },
    timeout: 60_000,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * HOW MANY TIMES A STRING APPEARS ANYWHERE UNDER THE STORE — the only honest
 * form of "this conversation was not recorded": not a reason code, the bytes.
 */
function grepStore(needle: string): number {
  let hits = 0;
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      try {
        hits += readFileSync(p).toString("latin1").split(needle).length - 1;
      } catch {
        /* a file this cannot read holds nothing this can find */
      }
    }
  };
  walk(store);
  return hits;
}

/** The durable boundary rows, newest last. */
function boundaryRows(): Record<string, unknown>[] {
  const s = Store.open({ dir: store });
  try {
    return s
      .eventLog({ name: BOUNDARY_EVENT, limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
  } finally {
    s.close();
  }
}

interface Console_ {
  io: Io;
  out: string[];
  err: string[];
}

function consoleWith(): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** The console, always pointed at THIS test's configuration. */
async function cli(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; out: string; err: string }> {
  const c = consoleWith();
  const code = await run([...argv, "--config", configPath], { io: c.io, env, home });
  return { code, out: c.out.join("\n"), err: c.err.join("\n") };
}

// ═══════════════════════════════════════════════════════════════════════════
// The registry itself
// ═══════════════════════════════════════════════════════════════════════════

describe("the scope registry", () => {
  test("it lives BESIDE the configuration, wherever that configuration is", () => {
    expect(scopesPath("/a/b/claude-code.json")).toBe(`/a/b/${SCOPES_FILE_NAME}`);
    expect(scopesPath(join(work, "claude-code.json"))).toBe(join(work, "scopes.json"));
  });

  test("an absent file is UNSET, and unset is on — today's behaviour, unchanged", () => {
    const read = readScopes(join(work, "nothing-here.json"));
    expect(read).toEqual({ registry: null, present: false, error: null });
    expect(lookupScope(read.registry, work).mode).toBe("unset");
    expect(stanceOfMode("unset")).toBe("on");
  });

  test("the LONGEST matching ancestor wins, and a subdirectory inherits it", () => {
    const reg = setScope(
      setScope(null, join(work, "a"), "off", { at: "t1" }),
      join(work, "a", "b"),
      "observer",
      { at: "t2" },
    );
    expect(lookupScope(reg, join(work, "a")).mode).toBe("off");
    expect(lookupScope(reg, join(work, "a", "deep", "deeper")).mode).toBe("off");
    // The deeper entry wins over the shallower one, whatever order they are in.
    expect(lookupScope(reg, join(work, "a", "b")).mode).toBe("observer");
    expect(lookupScope(reg, join(work, "a", "b", "c")).mode).toBe("observer");
    expect(lookupScope(reg, join(work, "a", "b", "c")).matched).toBe(
      lookupScope(reg, join(work, "a", "b")).matched,
    );
  });

  test("the match is SEGMENT-AWARE: /a/b never governs /a/bc", () => {
    mkdirSync(join(work, "proj"), { recursive: true });
    mkdirSync(join(work, "project-two"), { recursive: true });
    const reg = setScope(null, join(work, "proj"), "off", { at: "t" });
    expect(lookupScope(reg, join(work, "proj")).mode).toBe("off");
    expect(lookupScope(reg, join(work, "project-two")).mode).toBe("unset");
  });

  test("a directory that does not exist yet still inherits its ancestor", () => {
    // `canonicalScope` realpaths only what exists, so a naive comparison here
    // governs the parent and not the child — the one answer a prefix rule may
    // never give (`scopes.ts#canonicalScopePath`).
    const reg = setScope(null, work, "off", { at: "t" });
    expect(lookupScope(reg, join(work, "not", "created", "yet")).mode).toBe("off");
  });

  test("a corrupt file is UNSET and says why — it is never guessed at", () => {
    writeFileSync(scopesFile, "{not json at all", "utf8");
    const read = readScopes(scopesFile);
    expect(read.present).toBe(true);
    expect(read.registry).toBe(null);
    expect(read.error).toContain("not JSON");
    expect(lookupScope(read.registry, work).mode).toBe("unset");

    // A malformed ENTRY fails the file rather than being dropped: an `off`
    // somebody typed badly must not silently become an `on`.
    for (const bad of [
      { version: 2, scopes: {} },
      { version: 1, scopes: { [work]: { mode: "sometimes", since: "t" } } },
      { version: 1, scopes: { [work]: { mode: "off" } } },
      { version: 1, scopes: { relative: { mode: "off", since: "t" } } },
      { version: 1, scopes: [] },
    ]) {
      const parsed = parseRegistry(bad);
      expect(`${JSON.stringify(bad)} → ${String(parsed.registry)}`).toBe(
        `${JSON.stringify(bad)} → null`,
      );
      expect(parsed.error).not.toBe(null);
    }
    // A file with no `scopes` key at all is an EMPTY registry, not an error.
    expect(parseRegistry({ version: 1 })).toEqual({ registry: emptyRegistry(), error: null });
  });

  test("the write is atomic, and leaves no temp file behind", () => {
    writeScopes(scopesFile, setScope(null, work, "off", { at: "t" }));
    expect(readdirSync(work).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readScopes(scopesFile).registry?.scopes[canonicalScopePath(work)]?.mode).toBe("off");
    // A reader never sees half a file: the rename replaces it whole.
    writeScopes(scopesFile, setScope(null, work, "on", { at: "t2" }));
    expect(readScopes(scopesFile).registry?.scopes[canonicalScopePath(work)]?.mode).toBe("on");
    expect(readdirSync(work).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("a pause REMEMBERS what it interrupted; an off has nothing to remember", () => {
    const observer = setScope(null, work, "observer", { at: "t1" });
    const paused = setScope(observer, work, "paused", { at: "t2" });
    expect(resumeTarget(paused.scopes[canonicalScopePath(work)] ?? null)).toBe("observer");
    const off = setScope(null, work, "off", { at: "t1" });
    expect(resumeTarget(off.scopes[canonicalScopePath(work)] ?? null)).toBe("on");
  });

  test("a note is replaced when given and carried when not", () => {
    const first = setScope(null, work, "off", { at: "t1", note: "client work" });
    expect(first.scopes[canonicalScopePath(work)]?.note).toBe("client work");
    const carried = setScope(first, work, "paused", { at: "t2" });
    expect(carried.scopes[canonicalScopePath(work)]?.note).toBe("client work");
    const replaced = setScope(carried, work, "off", { at: "t3", note: "still private" });
    expect(replaced.scopes[canonicalScopePath(work)]?.note).toBe("still private");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The combination rule
// ═══════════════════════════════════════════════════════════════════════════

describe("effective stance is the MOST RESTRICTIVE of the two sources", () => {
  test("the whole table, and it only ever adds restriction", () => {
    const table: [boolean, Parameters<typeof effectiveStance>[1], string][] = [
      [false, "unset", "on"],
      [false, "on", "on"],
      [false, "observer", "observer"],
      [false, "off", "off"],
      [false, "paused", "off"],
      // The configuration already stood this session down; nothing in the
      // registry may relax it. This row is the one that keeps the three private
      // directories running exactly as they ran before any of this existed.
      [true, "unset", "observer"],
      [true, "on", "observer"],
      [true, "observer", "observer"],
      [true, "off", "off"],
      [true, "paused", "off"],
    ];
    for (const [configObserver, mode, expected] of table) {
      expect(`config=${String(configObserver)} scope=${mode} → ${effectiveStance(configObserver, mode)}`).toBe(
        `config=${String(configObserver)} scope=${mode} → ${expected}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The hooks, as real processes
// ═══════════════════════════════════════════════════════════════════════════

describe("a directory set OFF: no output, no write", () => {
  test("every hook exits 0 with byte-for-byte nothing, and no store is created", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    put({ [project]: { mode: "off", since: "2026-09-10T00:00:00.000Z" } });

    for (const event of ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", "PreCompact"]) {
      const r = runHook(event, `off-${event}`, project);
      expect(`${event} exit`).toBe(`${event} exit`);
      expect({ event, code: r.code, stdout: r.stdout, stderr: r.stderr }).toEqual({
        event,
        code: 0,
        stdout: "",
        stderr: "",
      });
    }
    // The strongest form of "wrote nothing": the store was never constructed.
    expect(existsSync(store)).toBe(false);
  });

  test("PAUSED is off while it lasts, and --resume gives the directory back", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    put({
      [project]: {
        mode: "paused",
        resumeTo: "on",
        since: "2026-09-10T00:00:00.000Z",
      },
    });
    expect(runHook("SessionStart", "paused-1", project).stdout).toBe("");
    expect(existsSync(store)).toBe(false);

    const resumed = await cli(["scope", project, "--resume"]);
    expect(resumed.code).toBe(EXIT.ok);
    expect(resumed.out).toContain("— on.");

    const after = runHook("SessionStart", "paused-2", project);
    expect(after.code).toBe(0);
    expect(after.stdout).toContain("has not lived a boundary");
    expect(existsSync(join(store, "sessions", "paused-2.json"))).toBe(true);
  });

  test("RESUMING does not RETROACTIVELY capture the stretch that was paused (F1)", async () => {
    // The #92 review's third probe, as real processes. A whole conversation
    // happens while the directory is paused — no session record, no cursor,
    // nothing — and then it is resumed MID-SESSION. Before this guard the next
    // Stop sliced the transcript from cursor 0 and deposited the entire paused
    // conversation: six marker hits in `spans/<scope>/buffer.jsonl`.
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    const transcript = join(work, "transcript.jsonl");
    const line = (role: "user" | "assistant", text: string): string =>
      JSON.stringify({ type: role, message: { role, content: text } });
    const paused = Array.from({ length: 6 }, (_, i) =>
      line(
        i % 2 === 0 ? "user" : "assistant",
        `XYZZY-SECRET turn ${String(i + 1)}: the client contract number is 44${String(i)} and the deal closes on Friday, which nobody outside this room is supposed to know about.`,
      ),
    );
    writeFileSync(transcript, `${paused.join("\n")}\n`, "utf8");
    put({ [project]: { mode: "paused", resumeTo: "on", since: "2026-09-10T00:00:00.000Z" } });

    // The paused stretch: silent, and not a byte on disk.
    for (const event of ["SessionStart", "Stop", "Stop"]) {
      expect(runHook(event, "one-session", project, [], transcript).stdout).toBe("");
    }
    expect(existsSync(store)).toBe(false);

    // The flip, mid-session — the same act the `scope` tool performs.
    expect((await cli(["scope", project, "--resume"])).code).toBe(EXIT.ok);
    // PreCompact rather than Stop for the two boundaries below, and the reason
    // is the test harness rather than the rule: a Stop spawns the detached
    // worker, whose store handle is still open when the next hook process
    // starts, and that hook then stands down on `database is locked` — a real
    // race, unrelated to this guard, that would make this test flaky. Every
    // session-ending path runs the SAME `claim()`, which is what is under test.
    const first = runHook("PreCompact", "one-session", project, [], transcript);
    expect(first.code).toBe(0);

    // NOTHING from the paused stretch reached the store...
    expect(grepStore("XYZZY-SECRET")).toBe(0);
    // ...the session is nevertheless known, so the tools can bind to it...
    expect(existsSync(join(store, "sessions", "one-session.json"))).toBe(true);
    // ...and the boundary said so, durably, on its own row.
    expect(boundaryRows().at(-1)?.["joinedLate"]).toBe(true);

    // And the NEXT turns — the ones lived after the resume — are captured
    // normally: the seal moved the cursor, it did not stop the memory.
    writeFileSync(
      transcript,
      `${[
        ...paused,
        line("user", "Now that we are recording again: the storage split keeps canonical prose on disk."),
        line("assistant", "Recorded — and the cache stays out of the backup set, which is the point."),
      ].join("\n")}\n`,
      "utf8",
    );
    const second = runHook("PreCompact", "one-session", project, [], transcript);
    expect(second.code).toBe(0);
    expect(grepStore("XYZZY-SECRET")).toBe(0);
    expect(grepStore("the storage split keeps canonical prose")).toBeGreaterThan(0);
    expect(boundaryRows().at(-1)?.["joinedLate"]).toBe(false);
  });

  test("a directory NOT under the entry is untouched by it", () => {
    const off = join(work, "off-here");
    const on = join(work, "on-here");
    mkdirSync(off, { recursive: true });
    mkdirSync(on, { recursive: true });
    put({ [off]: { mode: "off", since: "2026-09-10T00:00:00.000Z" } });

    expect(runHook("SessionStart", "quiet", off).stdout).toBe("");
    const loud = runHook("SessionStart", "loud", on);
    expect(loud.code).toBe(0);
    expect(loud.stdout).toContain("has not lived a boundary");
    expect(existsSync(join(store, "sessions", "loud.json"))).toBe(true);
    expect(existsSync(join(store, "sessions", "quiet.json"))).toBe(false);
  });

  test("a corrupt registry NEVER fails the hook: it reads as unset, which is on", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    writeFileSync(scopesFile, "{ broken", "utf8");
    const r = runHook("SessionStart", "corrupt", project);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("has not lived a boundary");
  });
});

describe("the scope a hook decides on", () => {
  test("the payload's cwd first, then CLAUDE_PROJECT_DIR, then the process's own", () => {
    expect(hookScope({ cwd: "/a/b" }, {})).toBe("/a/b");
    expect(hookScope({}, { CLAUDE_PROJECT_DIR: "/c/d" })).toBe("/c/d");
    expect(hookScope({ cwd: "/a/b" }, { CLAUDE_PROJECT_DIR: "/c/d" })).toBe("/a/b");
    expect(hookScope({}, {})).toBe(process.cwd());
  });

  test("the verdict reads the registry beside the configuration it was given", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    put({ [project]: { mode: "observer", since: "t" } });
    const { verdict, read } = hookScopeVerdict(configPath, join(project, "sub"));
    expect(verdict.mode).toBe("observer");
    expect(read.error).toBe(null);
    // A configuration somewhere else has its own registry, and does not see this one.
    expect(hookScopeVerdict(join(work, "elsewhere", "claude-code.json"), project).verdict.mode).toBe(
      "unset",
    );
  });
});

describe("a directory set OBSERVER is exactly the existing observer stance", () => {
  test("the wake is delivered and nothing is captured or deposited", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7), so
    // the store has to exist for the READING half to be testable at all.
    Store.open({ dir: store }).close();
    put({ [project]: { mode: "observer", since: "t" } });

    const started = runHook("SessionStart", "obs", project);
    expect(started.code).toBe(0);
    // An observer READS: the wake is delivered, exactly as observer-mode G4 says.
    expect(started.stdout).toContain("has not lived a boundary");
    // And deposits nothing: no session record, because the registry write is a
    // write (`hooks.ts#noteSession`).
    expect(existsSync(join(store, "sessions", "obs.json"))).toBe(false);

    // The session-ending hooks stand down entirely.
    expect(runHook("Stop", "obs", project).stdout).toBe("");
    expect(runHook("SessionEnd", "obs", project).stdout).toBe("");
  });

  /**
   * THE SEAMS THAT ARRIVED AFTER THIS BRANCH WAS WRITTEN, standing down under a
   * REGISTRY observer rather than an environment one — added on the rebase onto
   * master (2026-09-15), because none of the three existed when the branch
   * forked: the worker that now DEGRADES instead of refusing without a key
   * (#95), the credit seam that writes `recall.credit` at every boundary (#99),
   * and the doctor notice that reaches the terminal (#108).
   *
   * None of them needed a line of their own, and this is the test that says why:
   * `bin/hook.ts` folds a registry `observer` into the CONFIG the adapter opens
   * on, so `this.observer` is the same bit `COUNTERPARTS_OBSERVER` sets and the
   * one stand-down in `guard()` covers all three. What is asserted here is that
   * fold's consequence, not a second implementation of it.
   */
  test("the spawn, the credit row and the doctor notice all stand down on the folded bit", () => {
    Store.open({ dir: store }).close();
    let spawns = 0;
    // Exactly what `bin/hook.ts#main` builds for a registry `observer`: the
    // loaded config with `observer: true` folded in, and the verdict carried.
    const a = openAdapter(
      { dataDir: store, injectionBudgetBytes: BUDGET_BYTES, owner: true, observer: true },
      {
        command: "/bin/true",
        args: ["runner"],
        spawner: () => {
          spawns += 1;
          return { pid: 1 };
        },
        scope: {
          mode: "observer",
          matched: join(work, "project"),
          entry: { mode: "observer", since: "t" },
        },
      },
    );
    try {
      expect(a.observer).toBe(true);
      // #108's channel: an instrument narrating the host it measures would be
      // doing more than reading, so the notice is null before any reading.
      expect(a.notice({ sessionId: "obs-2", scope: join(work, "project"), at: "2026-09-10" })).toBe(
        null,
      );
      const stopped = a.stop({ sessionId: "obs-2", scope: join(work, "project"), at: "2026-09-10" });
      expect({ reason: stopped.reason, spawn: stopped.spawn, ask: stopped.ask }).toEqual({
        reason: "observer",
        spawn: null,
        ask: null,
      });
      // #95's spawn was never attempted, so its degrade path was never reached.
      expect(spawns).toBe(0);
      expect(a.events("adapter.observer.standdown")).toHaveLength(1);
      // #99's seam writes nothing: the boundary that would have credited never ran.
      expect(a.counterpart.store.eventLog({ name: RECALL_CREDIT_EVENT })).toHaveLength(0);
    } finally {
      a.counterpart.close();
    }
  });
});

/**
 * THE THREE POST-FORK SEAMS UNDER `off` — the ordering claim, checked at both
 * sites it is made at.
 *
 * The guarantee is the ABSENCE OF CONSTRUCTION, so the process test above is the
 * real one; these two add what it cannot show on its own. The first proves the
 * silence is a silence and not an empty day: the SAME fixture, `on`, prints the
 * JSON envelope PR #108 added (`systemMessage` on a red finding), so a
 * byte-empty stdout under `off` is that channel being closed rather than nothing
 * having been found. The second walks `guard()`'s own predicate, which is the
 * seam a library caller reaches without an entry point.
 */
describe("a directory set OFF stands down the seams added after this branch forked", () => {
  test("the SAME fixture prints the #108 systemMessage envelope when it is on, and nothing when it is off", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });

    // ON (unset): this fixture names no credentials file, so `doctor` finds a
    // RED credentials finding and the entry point prints the JSON envelope.
    const on = runHook("SessionStart", "red-on", project);
    expect(on.code).toBe(0);
    const envelope = JSON.parse(on.stdout) as {
      systemMessage?: string;
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(envelope.systemMessage ?? "").toContain("counterparts:");
    expect(envelope.hookSpecificOutput?.additionalContext ?? "").toContain(
      "has not lived a boundary",
    );

    // OFF: the same red host, the same event, and not one byte on either channel.
    put({ [project]: { mode: "off", since: "2026-09-10T00:00:00.000Z" } });
    const off = runHook("SessionStart", "red-off", project);
    expect({ code: off.code, stdout: off.stdout, stderr: off.stderr }).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("`guard()` refuses before the spawn and before the credit row", () => {
    Store.open({ dir: store }).close();
    let spawns = 0;
    const a = openAdapter(
      { dataDir: store, injectionBudgetBytes: BUDGET_BYTES, owner: true },
      {
        command: "/bin/true",
        args: ["runner"],
        spawner: () => {
          spawns += 1;
          return { pid: 1 };
        },
        scope: { mode: "off", matched: join(work, "project"), entry: { mode: "off", since: "t" } },
      },
    );
    try {
      for (const hook of [
        "session-start",
        "user-prompt-submit",
        "stop",
        "session-end",
        "pre-compact",
      ] as const) {
        const r = a.hook(hook, {
          sessionId: "off-seams",
          scope: join(work, "project"),
          at: "2026-09-10",
          prompt: "anything at all",
        });
        expect(`${hook} → ${r.reason} / ${String(r.spawn)} / ${String(r.ask)}`).toBe(
          `${hook} → scope-off / null / null`,
        );
      }
      expect(spawns).toBe(0);
      expect(a.counterpart.store.eventLog({ name: RECALL_CREDIT_EVENT })).toHaveLength(0);
      // No session record either: `noteSession` is inside the body `guard()`
      // never calls.
      expect(existsSync(join(store, "sessions", "off-seams.json"))).toBe(false);
      expect(a.events("adapter.scope.off")).toHaveLength(5);
    } finally {
      a.counterpart.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The first-launch question (G41)
// ═══════════════════════════════════════════════════════════════════════════

describe("the first-launch question", () => {
  const opened: { close(): void }[] = [];
  // An observer opens no store it would have to mint, so every adapter here
  // starts from one that exists.
  beforeEach(() => {
    Store.open({ dir: store }).close();
  });
  afterEach(() => {
    for (const c of opened.splice(0)) {
      try {
        c.close();
      } catch {
        /* already closed */
      }
    }
  });

  function adapterFor(over: Partial<AdapterConfig> = {}, scope?: Parameters<typeof openAdapter>[1]) {
    const a = openAdapter({ dataDir: store, injectionBudgetBytes: BUDGET_BYTES, owner: true, ...over }, {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 1 }),
      ...(scope ?? {}),
    });
    opened.push(a.counterpart);
    return a;
  }

  test("an UNSET directory is asked exactly once per session, and never again", () => {
    const a = adapterFor();
    const first = a.sessionStart({ sessionId: "s1", scope: join(work, "project"), at: "2026-09-10" });
    expect(first.ask).toBe(SCOPE_ASK);
    // It is a QUESTION, in plain words, naming the three answers and the command.
    expect(SCOPE_ASK).toContain("ask the user once");
    expect(SCOPE_ASK).toContain("`scope` tool");
    expect(SCOPE_ASK).toContain("counterparts scope . --on");
    // The wake itself is untouched: its byte count and its sentinel still
    // describe the bundle and nothing else (§1 G2, scar §2.3).
    expect(first.bytes).toBe(Buffer.byteLength(first.injection, "utf8"));

    // Recorded on the session, so a SessionStart that fires again — a resume, a
    // clear — does not ask a second time.
    expect(readSession(store, "s1")?.askedScope).toBe(true);
    expect(a.sessionStart({ sessionId: "s1", scope: join(work, "project"), at: "2026-09-10" }).ask).toBe(
      null,
    );
  });

  test("it stops the moment the directory is set — to ANY mode", () => {
    for (const mode of ["on", "observer", "off", "paused"] as const) {
      const a = adapterFor(mode === "observer" ? { observer: true } : {}, {
        scope: { mode, matched: join(work, "project"), entry: { mode, since: "t" } },
      } as Parameters<typeof openAdapter>[1]);
      const result = a.sessionStart({
        sessionId: `set-${mode}`,
        scope: join(work, "project"),
        at: "2026-09-10",
      });
      expect(`${mode} → ${String(result.ask)}`).toBe(`${mode} → null`);
    }
  });

  test("an instrument does not ask: it could not record the answer, or the asking", () => {
    const a = adapterFor({ observer: true });
    const result = a.sessionStart({ sessionId: "obs", scope: join(work, "p"), at: "2026-09-10" });
    expect(result.ask).toBe(null);
    expect(a.events("adapter.scope.ask.skipped")).toHaveLength(1);
  });

  test("it is DEFERRED rather than smuggled past the host's ceiling", () => {
    // A ceiling with no room for the question: the wake still goes, the
    // question waits for a session where it fits, and the deferral is an event
    // rather than a silence.
    const a = adapterFor({ injectionBudgetBytes: 10 });
    const result = a.sessionStart({ sessionId: "tight", scope: join(work, "p"), at: "2026-09-10" });
    expect(result.ask).toBe(null);
    expect(a.events("adapter.scope.ask.deferred")).toHaveLength(1);
    // Unmarked, so the next session asks instead of losing the question.
    expect(readSession(store, "tight")?.askedScope).toBeUndefined();
  });

  test("the verdict and an unreadable registry are both on the record", () => {
    const a = openAdapter(
      { dataDir: store, injectionBudgetBytes: BUDGET_BYTES, owner: true },
      {
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 1 }),
        scope: { mode: "unset", matched: null, entry: null },
        scopeUnreadable: "it is not JSON (boom)",
      },
    );
    opened.push(a.counterpart);
    expect(a.events("adapter.scope")[0]?.data["mode"]).toBe("unset");
    expect(a.events("adapter.scope.unreadable")[0]?.data["detail"]).toContain("not JSON");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The console
// ═══════════════════════════════════════════════════════════════════════════

describe("counterparts scope", () => {
  test("it writes the registry, and NAMES the absolute path it wrote", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    const r = await cli(["scope", project, "--off", "--note", "client work"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("Scope set:");
    expect(r.out).toContain("— off.");
    expect(r.out).toContain(scopesFile);
    const entry = readScopes(scopesFile).registry?.scopes[canonicalScopePath(project)];
    expect(entry?.mode).toBe("off");
    expect(entry?.note).toBe("client work");
    expect(entry?.since.length).toBeGreaterThan(10);
  });

  test("a RELATIVE path is resolved before it is stored, and the resolution is said out loud", async () => {
    const r = await cli(["scope", "."]);
    expect(r.code).toBe(EXIT.ok);
    // A read of `.` still names the absolute directory it resolved to; the
    // registry never holds a relative key, because the processes that read it
    // are launched from a working directory nobody chose.
    expect(r.out).toContain(process.cwd());
    const w = await cli(["scope", ".", "--off"]);
    expect(w.out).toContain("resolved to that path");
    expect(Object.keys(readScopes(scopesFile).registry?.scopes ?? {})).toEqual([
      canonicalScopePath(process.cwd()),
    ]);
  });

  test("every mode flag, and one at a time", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    for (const [flag, mode] of [
      ["--on", "on"],
      ["--observer", "observer"],
      ["--off", "off"],
      ["--pause", "paused"],
    ] as const) {
      const r = await cli(["scope", project, flag]);
      expect(`${flag} → ${r.out.split("\n")[0] ?? ""}`).toBe(
        `${flag} → Scope set: ${canonicalScopePath(project)} — ${mode}.`,
      );
    }
    const both = await cli(["scope", project, "--on", "--off"]);
    expect(both.code).toBe(EXIT.refused);
    expect(both.err).toContain("one mode at a time");
  });

  test("--pause remembers, --resume restores, and --resume on an unset directory refuses", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    expect((await cli(["scope", project, "--observer"])).code).toBe(EXIT.ok);
    expect((await cli(["scope", project, "--pause"])).code).toBe(EXIT.ok);
    const paused = await cli(["scope", project]);
    expect(paused.out).toContain("paused");
    expect(paused.out).toContain("--resume puts it back to observer");
    const resumed = await cli(["scope", project, "--resume"]);
    expect(resumed.out).toContain("— observer.");

    const nothing = await cli(["scope", join(work, "never-set"), "--resume"]);
    expect(nothing.code).toBe(EXIT.refused);
    expect(nothing.err).toContain("nothing to resume");
  });

  test("--resume also turns an OFF directory back on — the loop the owner asked for", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    await cli(["scope", project, "--off"]);
    const back = await cli(["scope", project, "--resume"]);
    expect(back.code).toBe(EXIT.ok);
    expect(back.out).toContain("— on.");
  });

  test("--list prints the registry and the file it came from", async () => {
    const empty = await cli(["scope", "--list"]);
    expect(empty.code).toBe(EXIT.ok);
    expect(empty.out).toContain("Nothing is set. Every directory is on by default.");

    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    await cli(["scope", project, "--pause", "--note", "an afternoon off"]);
    const listed = await cli(["scope", "--list"]);
    expect(listed.out).toContain(scopesFile);
    expect(listed.out).toContain("paused");
    expect(listed.out).toContain("(resumes to on)");
    expect(listed.out).toContain("an afternoon off");

    const confused = await cli(["scope", project, "--list"]);
    expect(confused.code).toBe(EXIT.refused);
  });

  test("with no flag it says the effective mode and WHICH entry decided it", async () => {
    const parent = join(work, "parent");
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    await cli(["scope", parent, "--off"]);

    const inherited = await cli(["scope", child]);
    expect(inherited.code).toBe(EXIT.ok);
    expect(inherited.out).toContain("off");
    expect(inherited.out).toContain("(an ancestor)");
    expect(inherited.out).toContain(canonicalScopePath(parent));

    const own = await cli(["scope", parent]);
    expect(own.out).toContain("Decided by its own entry");

    const unset = await cli(["scope", join(work, "elsewhere")]);
    expect(unset.out).toContain("unset");
    expect(unset.out).toContain("so it is on (the default)");
  });

  test("bare `scope` names what it needs instead of guessing", async () => {
    const r = await cli(["scope"]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain("name a directory");
  });

  test("a registry it cannot parse is never overwritten without --force", async () => {
    writeFileSync(scopesFile, "{ half a file", "utf8");
    const refused = await cli(["scope", work, "--off"]);
    expect(refused.code).toBe(EXIT.refused);
    expect(refused.err).toContain("could not be read");
    expect(refused.err).toContain("--force");
    expect(readFileSync(scopesFile, "utf8")).toBe("{ half a file");

    // Reading refuses too, and says the same thing rather than reporting a lie.
    expect((await cli(["scope", "--list"])).code).toBe(EXIT.refused);
    expect((await cli(["scope", work])).code).toBe(EXIT.refused);

    const forced = await cli(["scope", work, "--off", "--force"]);
    expect(forced.code).toBe(EXIT.ok);
    expect(readScopes(scopesFile).registry?.scopes[canonicalScopePath(work)]?.mode).toBe("off");
  });

  test("an observer console READS the registry and refuses to write it", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    await cli(["scope", project, "--off"]);

    // `--observer` on THIS command is the MODE, so the stance can only come
    // from the environment — and it refuses the write in the same sentence an
    // owner op refuses in.
    const write = await cli(["scope", project, "--on"], { COUNTERPARTS_OBSERVER: "1" });
    expect(write.code).toBe(EXIT.refused);
    expect(write.err).toContain("observer stance");
    expect(readScopes(scopesFile).registry?.scopes[canonicalScopePath(project)]?.mode).toBe("off");

    // Reading is exactly what an instrument is for: "why did this session
    // record nothing" has to be answerable from a stood-down console.
    const read = await cli(["scope", project], { COUNTERPARTS_OBSERVER: "1" });
    expect(read.code).toBe(EXIT.ok);
    expect(read.out).toContain("off");
    expect((await cli(["scope", "--list"], { COUNTERPARTS_OBSERVER: "1" })).code).toBe(EXIT.ok);
  });

  test("--observer here is the MODE, and does not stand the console down", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    const r = await cli(["scope", project, "--observer"]);
    expect(r.code).toBe(EXIT.ok);
    expect(readScopes(scopesFile).registry?.scopes[canonicalScopePath(project)]?.mode).toBe("observer");
  });

  test("it opens no store, and needs none: the guard that refuses an unnamed one is the CONFIG's", async () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    // No `--dir`, and the suite runs with COUNTERPARTS_REQUIRE_EXPLICIT_DIR
    // armed: a command that resolved a store would refuse here.
    const r = await cli(["scope", project, "--off"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(store)).toBe(false);

    // The guard DOES cover the thing this command touches: with no
    // configuration named, the default one is in the live base.
    const c = consoleWith();
    const code = await run(["scope", project, "--off"], {
      io: c.io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home,
    });
    expect(code).toBe(EXIT.refused);
    expect(c.err.join("\n")).toContain("no configuration was named");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The MCP server
// ═══════════════════════════════════════════════════════════════════════════

describe("the MCP server in a directory set off", () => {
  const opened: { counterpart: { close(): void } }[] = [];
  afterEach(() => {
    for (const s of opened.splice(0)) {
      try {
        s.counterpart.close();
      } catch {
        /* already closed */
      }
    }
  });

  function server(over: Parameters<typeof openServer>[0] = {}) {
    const s = openServer({
      dir: store,
      scope: join(work, "project"),
      owner: true,
      scopesFile,
      ...over,
    });
    opened.push(s);
    return s;
  }

  function body(result: ToolResult): Record<string, unknown> {
    return result.structuredContent;
  }

  test("every tool but `scope` refuses by NAME, and nothing durable moves", async () => {
    Store.open({ dir: store }).close();
    put({ [join(work, "project")]: { mode: "off", since: "t" } });
    const s = server();
    for (const [name, args] of [
      ["note", { text: "not here" }],
      ["recall", { question: "anything" }],
      ["status", {}],
      ["session_end", { session: "s", memories: [{ content: "nor this" }] }],
      ["chapter", { session: "s", text: "nor this" }],
    ] as [string, Record<string, unknown>][]) {
      const result = await s.call(name, args);
      expect(`${name} → ${String(body(result)["reason"])}`).toBe(`${name} → scope-off`);
      expect(result.isError).toBe(true);
    }
    expect(s.events("mcp.scope.off")).toHaveLength(5);
    // The refusal precedes the session bind: a model cannot learn anything
    // about which sessions exist by calling into a directory that is off.
    expect(s.events("mcp.session.unbound")).toHaveLength(0);
  });

  test("`scope` still answers there — a switch that only turns one way is not a switch", async () => {
    Store.open({ dir: store }).close();
    put({ [join(work, "project")]: { mode: "off", since: "t" } });
    const s = server();

    const read = await s.call("scope", {});
    expect(body(read)["mode"]).toBe("off");
    expect(body(read)["stance"]).toBe("off");

    const set = await s.call("scope", { mode: "on", note: "back on" });
    expect(body(set)["set"]).toBe(true);
    expect(readScopes(scopesFile).registry?.scopes[canonicalScopePath(join(work, "project"))]?.mode).toBe("on");
    // Per call, not per process: the very next call is served.
    expect(body(await s.call("status", {}))["reason"]).not.toBe("scope-off");
  });

  test("it acts on THIS server's directory and takes no path from the model", async () => {
    Store.open({ dir: store }).close();
    const s = server();
    const result = await s.call("scope", { mode: "off", path: "/somewhere/else" });
    // An unusable argument is refused by the schema's `additionalProperties`
    // upstream; what matters here is that the write landed on this server's own
    // scope and nowhere else.
    expect(body(result)["scope"]).toBe(join(work, "project"));
    expect(Object.keys(readScopes(scopesFile).registry?.scopes ?? {})).toEqual([
      canonicalScopePath(join(work, "project")),
    ]);
  });

  test("an unusable mode is refused, and an unreadable registry is never overwritten", async () => {
    Store.open({ dir: store }).close();
    const s = server();
    expect(body(await s.call("scope", { mode: "maybe" }))["reason"]).toBe("mode-unusable");

    writeFileSync(scopesFile, "{ broken", "utf8");
    const refused = await s.call("scope", { mode: "off" });
    expect(body(refused)["reason"]).toBe("registry-unreadable");
    expect(readFileSync(scopesFile, "utf8")).toBe("{ broken");
  });

  test("an observer reads the setting and stands down on changing it", async () => {
    Store.open({ dir: store }).close();
    put({ [join(work, "project")]: { mode: "observer", since: "t" } });
    const s = server({ observer: true });
    expect(body(await s.call("scope", {}))["mode"]).toBe("observer");
    const set = await s.call("scope", { mode: "on" });
    expect(body(set)["stoodDown"]).toBe(true);
    expect(ownEntry(readScopes(scopesFile).registry, join(work, "project"))?.mode).toBe(
      "observer",
    );
  });

  test("a server told about no registry reads `unset` and behaves as it always has", async () => {
    Store.open({ dir: store }).close();
    put({ [join(work, "project")]: { mode: "off", since: "t" } });
    const s = server({ scopesFile: undefined });
    expect(body(await s.call("status", {}))["reason"]).not.toBe("scope-off");
    expect(body(await s.call("scope", {}))["mode"]).toBe("unset");
    expect(body(await s.call("scope", { mode: "on" }))["reason"]).toBe("no-registry");
  });
});

/** Nothing above may leave a scopes.json anywhere but its own temp directory. */
test("the suite's own registry never leaves the temp directory", () => {
  const registry: ScopeRegistry = setScope(null, work, "off", { at: "t" });
  expect(Object.keys(registry.scopes).every((k) => k.startsWith("/"))).toBe(true);
});
