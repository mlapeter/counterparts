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
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { scopeAsk, TUNABLES } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import {
  FRESH_SESSION_SOURCES,
  eventDirectory,
  hookScopeVerdict,
  pausedNotice,
  sessionScope,
  startDirectory,
} from "../src/adapters/claude-code/bin/hook.js";
import { NIGHT_RUN_ENV } from "../src/adapters/claude-code/night-run.js";
import { EXIT, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/commands.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  SCOPES_FILE_NAME,
  canonicalScopePath,
  describeScopeTrouble,
  effectiveStance,
  emptyRegistry,
  lookupScope,
  mostRestrictiveVerdict,
  ownEntry,
  parseRegistry,
  readScopes,
  resumeTarget,
  scopeCommandContext,
  scopesPath,
  setScope,
  stanceOfMode,
  writeScopes,
} from "../src/adapters/scopes.js";
import type {
  EffectiveMode,
  ScopeRead,
  ScopeRegistry,
  ScopeStance,
  ScopeVerdict,
} from "../src/adapters/scopes.js";
import { canonicalScope, readSession, recordSession } from "../src/adapters/sessions.js";
import { BOUNDARY_EVENT, Counterpart, RECALL_CREDIT_EVENT, WAKE_INJECTED_EVENT } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const CLI_SCRIPT = resolve(import.meta.dir, "../src/adapters/cli/bin/counterparts.ts");
const BUDGET_BYTES = 9000;

let work: string;
let store: string;
let configPath: string;
let scopesFile: string;
let home: string;
/** A directory holding no `git`, so `readCheckout` cannot grade whatever checkout
 *  this suite happens to run in — on a branch that reading is RED, on a clean
 *  `origin/master` it is green, and a test must not pass on one and fail on the other. */
let emptyBin: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-scope-"));
  home = join(work, "home");
  mkdirSync(home, { recursive: true });
  emptyBin = join(work, "bin");
  mkdirSync(emptyBin, { recursive: true });
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
    // The transpiler cache is off because bun keeps it under HOME and a late write
    // puts the temp dir back after `afterEach` removed it (`hook-standdown.test.ts`).
    env: { PATH: emptyBin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
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

/** A SessionStart's `systemMessage` (the person's line), or null. */
function systemMessageOf(stdout: string): string | null {
  if (stdout.trim().length === 0) return null;
  const v = (JSON.parse(stdout) as Record<string, unknown>)["systemMessage"];
  return typeof v === "string" ? v : null;
}

/** A SessionStart's `additionalContext` (the model's), or null. */
function contextOf(stdout: string): string | null {
  if (stdout.trim().length === 0) return null;
  const out = (JSON.parse(stdout) as Record<string, unknown>)["hookSpecificOutput"] as Record<string, unknown> | undefined;
  const v = out?.["additionalContext"];
  return typeof v === "string" ? v : null;
}

/**
 * The person's line in a folder paused by its own entry, verbatim. The folder is
 * NAMED (review of #362): `dir` is outside the test's HOME, so it is written out
 * whole, realpathed as the registry key is. And these hooks read `--config
 * configPath`, not the default beside HOME, so the command names it too.
 */
function pausedHere(dir: string): string {
  const named = canonicalScopePath(dir);
  return `Counterparts memory is paused in ${named}; \`${resumeCommand(named)}\` turns it back on.`;
}

/** The resume command a hook run with `--config configPath` prints for `target`. */
function resumeCommand(target: string): string {
  return `counterparts scope ${target} --resume --config ${configPath}`;
}

/** Every file under `dir` with its size and mtime — "nothing was written", as bytes on disk. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        out[`${p}/`] = "dir";
        walk(p);
        continue;
      }
      const st = statSync(p);
      out[p] = `${String(st.size)}@${String(st.mtimeMs)}`;
    }
  };
  walk(dir);
  return out;
}

/** The durable rows of one name, newest last. */
function durableRows(name: string): Record<string, unknown>[] {
  const s = Store.open({ dir: store });
  try {
    return s
      .eventLog({ name, limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
  } finally {
    s.close();
  }
}

/** The durable boundary rows, newest last. */
function boundaryRows(): Record<string, unknown>[] {
  return durableRows(BOUNDARY_EVENT);
}

/** The durable session-start rows, newest last. */
function wakeRows(): Record<string, unknown>[] {
  return durableRows(WAKE_INJECTED_EVENT);
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
    expect(read).toEqual({ registry: null, present: false, error: null, refused: [], raw: null });
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

  test("two keys for ONE directory resolve to the MORE RESTRICTIVE of them (F4)", () => {
    // A hand-edited file can hold `/tmp/x` beside `/private/tmp/x`, or `…/proj`
    // beside `…/proj/.` — one directory, two keys. `setScope` replaces every
    // such key when IT writes, so this is somebody's own editing; deciding it by
    // whichever key came first in the JSON meant an `off` could resolve to `on`.
    const proj = join(work, "proj");
    mkdirSync(proj, { recursive: true });
    for (const order of [
      { [proj]: { mode: "off", since: "t" }, [`${proj}/.`]: { mode: "on", since: "t" } },
      { [`${proj}/.`]: { mode: "on", since: "t" }, [proj]: { mode: "off", since: "t" } },
    ]) {
      const reg = parseRegistry({ version: 1, scopes: order }).registry;
      expect(`${JSON.stringify(Object.keys(order))} → ${lookupScope(reg, proj).mode}`).toBe(
        `${JSON.stringify(Object.keys(order))} → off`,
      );
      // And the subdirectories that inherit it inherit the same answer.
      expect(lookupScope(reg, join(proj, "sub")).mode).toBe("off");
    }
    // Every pair, so the rule is the ORDER and not one lucky case.
    const ranked: [string, string, string][] = [
      ["on", "observer", "observer"],
      ["on", "off", "off"],
      ["observer", "paused", "paused"],
      ["on", "paused", "paused"],
      ["observer", "off", "off"],
    ];
    for (const [a, b, expected] of ranked) {
      for (const pair of [
        { [proj]: { mode: a, since: "t" }, [`${proj}/.`]: { mode: b, since: "t" } },
        { [proj]: { mode: b, since: "t" }, [`${proj}/.`]: { mode: a, since: "t" } },
      ]) {
        const reg = parseRegistry({ version: 1, scopes: pair }).registry;
        expect(`${a}+${b} → ${lookupScope(reg, proj).mode}`).toBe(`${a}+${b} → ${expected}`);
      }
    }
  });

  test("a directory that does not exist yet still inherits its ancestor", () => {
    // `canonicalScope` realpaths only what exists, so a naive comparison here
    // governs the parent and not the child — the one answer a prefix rule may
    // never give (`scopes.ts#canonicalScopePath`).
    const reg = setScope(null, work, "off", { at: "t" });
    expect(lookupScope(reg, join(work, "not", "created", "yet")).mode).toBe("off");
  });

  test("a file that is not a registry AT ALL is UNSET and says why", () => {
    writeFileSync(scopesFile, "{not json at all", "utf8");
    const read = readScopes(scopesFile);
    expect(read.present).toBe(true);
    expect(read.registry).toBe(null);
    expect(read.error).toContain("not JSON");
    expect(read.refused).toEqual([]);
    expect(lookupScope(read.registry, work).mode).toBe("unset");

    // The whole-file failures: there are no entries in these to honour.
    for (const bad of [
      { version: 2, scopes: {} },
      { version: 1, scopes: [] },
      { version: 1, scopes: "off" },
      [],
      null,
    ]) {
      const parsed = parseRegistry(bad);
      expect(`${JSON.stringify(bad)} → ${String(parsed.registry)}`).toBe(
        `${JSON.stringify(bad)} → null`,
      );
      expect(parsed.error).not.toBe(null);
    }
    // A file with no `scopes` key at all is an EMPTY registry, not an error.
    expect(parseRegistry({ version: 1 })).toEqual({
      registry: emptyRegistry(),
      error: null,
      refused: [],
    });
  });

  test("ONE bad entry is refused BY NAME; the good entries still stand (F2)", () => {
    // The rule this replaces failed the whole file on one typo — which turned
    // every correctly typed `off` in it ON, because the hook's fail direction
    // for an unreadable file is unset (⇒ on) and has to be (§5 G2).
    const good = join(work, "private");
    const typo = join(work, "typo");
    mkdirSync(good, { recursive: true });
    const parsed = parseRegistry({
      version: 1,
      scopes: {
        [good]: { mode: "off", since: "t" },
        [typo]: { mode: "offf", since: "t" },
        [join(work, "nosince")]: { mode: "off" },
        [join(work, "badresume")]: { mode: "paused", since: "t", resumeTo: "off" },
        [join(work, "badnote")]: { mode: "off", since: "t", note: 7 },
        [join(work, "notanobject")]: "off",
        relative: { mode: "off", since: "t" },
      },
    });
    // The good entry is honoured, and it still governs its subdirectories.
    expect(parsed.error).toBe(null);
    expect(Object.keys(parsed.registry?.scopes ?? {})).toEqual([good]);
    expect(lookupScope(parsed.registry, join(good, "sub")).mode).toBe("off");
    // Every bad one is named, with the reason beside it.
    expect(parsed.refused.map((r) => r.key)).toEqual([
      typo,
      join(work, "nosince"),
      join(work, "badresume"),
      join(work, "badnote"),
      join(work, "notanobject"),
      "relative",
    ]);
    expect(parsed.refused[0]?.detail).toContain('mode "offf"');
    // A refused entry is UNSET, never guessed at in either direction.
    expect(lookupScope(parsed.registry, typo).mode).toBe("unset");
    // And the sentence every surface prints names the file and the entries.
    const read: ScopeRead = { registry: parsed.registry, present: true, error: null, refused: parsed.refused, raw: "" };
    const line = describeScopeTrouble(read, scopesFile) ?? "";
    expect(line).toContain(scopesFile);
    expect(line).toContain("6 entries");
    expect(line).toContain(typo);
    expect(describeScopeTrouble({ registry: emptyRegistry(), present: true, error: null, refused: [], raw: "" }, scopesFile)).toBe(null);
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

  test("a write that lands inside another writer's window is not clobbered (F3)", () => {
    // Two writers exist — the console `scope` command and the MCP `scope` tool
    // — and both read, then modify, then rename. The review's measurement: both
    // read the same absent file, A wrote projA off, B wrote projB off, and the
    // file ended with projB alone. A's `off` was gone and nothing said so.
    const a = join(work, "projA");
    const b = join(work, "projB");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });

    const readA = readScopes(scopesFile);
    const applyA = (from: ScopeRegistry | null): ScopeRegistry =>
      setScope(from, a, "off", { at: "2026-09-15T00:00:00.000Z" });
    // B lands INSIDE A's read→rename window: the same shape as another process
    // renaming its own temp file a millisecond before this one does.
    const applyB = (from: ScopeRegistry | null): ScopeRegistry =>
      setScope(from, b, "off", { at: "2026-09-15T00:00:01.000Z" });
    writeScopes(scopesFile, applyB(readScopes(scopesFile).registry));

    writeScopes(scopesFile, applyA(readA.registry), { basedOn: readA, reapply: applyA });

    const final = readScopes(scopesFile);
    expect(lookupScope(final.registry, a).mode).toBe("off");
    expect(lookupScope(final.registry, b).mode).toBe("off");
    expect(readdirSync(work).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    // And a write whose file did NOT move is written exactly as it was computed.
    const steady = readScopes(scopesFile);
    const applyC = (from: ScopeRegistry | null): ScopeRegistry =>
      setScope(from, a, "observer", { at: "2026-09-15T00:00:02.000Z" });
    writeScopes(scopesFile, applyC(steady.registry), { basedOn: steady, reapply: applyC });
    const after = readScopes(scopesFile);
    expect(lookupScope(after.registry, a).mode).toBe("observer");
    expect(lookupScope(after.registry, b).mode).toBe("off");
  });

  test("the two REAL writers interleave without losing an entry (F3)", async () => {
    // The same property through the surfaces that have it: the console reads
    // and writes, and the MCP tool writes between the two halves.
    const project = join(work, "project");
    const other = join(work, "other");
    mkdirSync(project, { recursive: true });
    mkdirSync(other, { recursive: true });
    Store.open({ dir: store }).close();

    // The console's write, then the tool's: neither loses the other's entry.
    expect((await cli(["scope", other, "--off"])).code).toBe(EXIT.ok);
    const s = openServer({ dir: store, scope: project, owner: true, scopesFile });
    try {
      const set = await s.call("scope", { mode: "off" });
      expect(set.structuredContent["set"]).toBe(true);
    } finally {
      s.counterpart.close();
    }
    const final = readScopes(scopesFile);
    expect(lookupScope(final.registry, other).mode).toBe("off");
    expect(lookupScope(final.registry, project).mode).toBe("off");
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
    // Its one line at session start (rulings brief #19), and nothing else.
    expect(systemMessageOf(runHook("SessionStart", "paused-1", project).stdout)).toBe(pausedHere(project));
    expect(runHook("UserPromptSubmit", "paused-1", project).stdout).toBe("");
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

    // The paused stretch: one line at session start, silent after, and not a
    // byte on disk.
    for (const event of ["SessionStart", "Stop", "Stop"]) {
      const out = runHook(event, "one-session", project, [], transcript).stdout;
      if (event === "SessionStart") expect(systemMessageOf(out)).toBe(pausedHere(project));
      else expect(out).toBe("");
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

// ═══════════════════════════════════════════════════════════════════════════
// A PAUSED folder says so, once, at session start (rulings brief #19, 2026-10-10)
// ═══════════════════════════════════════════════════════════════════════════

describe("a PAUSED folder says so at session start, and does nothing else", () => {
  /** A hook process with control of the payload's source and the environment. */
  function start(opts: {
    session: string;
    cwd: string;
    event?: string;
    source?: string;
    env?: Record<string, string>;
  }): { code: number; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], {
      input: JSON.stringify({
        hook_event_name: opts.event ?? "SessionStart",
        session_id: opts.session,
        cwd: opts.cwd,
        ...(opts.source === undefined ? {} : { source: opts.source }),
      }),
      encoding: "utf8",
      env: { PATH: emptyBin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", ...opts.env },
      timeout: 60_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  const SOURCES = ["startup", "resume", "clear", "compact"] as const;
  const OTHER_EVENTS = ["UserPromptSubmit", "Stop", "SessionEnd", "PreCompact"] as const;

  test("every SessionStart source says it ONCE — the person's line and the model's — and opens no store", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    put({ [project]: { mode: "paused", resumeTo: "on", since: "2026-10-10T00:00:00.000Z" } });
    for (const source of SOURCES) {
      const r = start({ session: `paused-${source}`, cwd: project, source });
      expect({ source, code: r.code, stderr: r.stderr }).toEqual({ source, code: 0, stderr: "" });
      // ONE JSON object: the person's line, and the model's.
      const named = canonicalScopePath(project);
      expect(JSON.parse(r.stdout)).toEqual({
        systemMessage: pausedHere(project),
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext:
            `Counterparts memory is paused in ${named}: no memories are loaded and nothing said here is remembered ` +
            `until the person resumes it (\`${resumeCommand(named)}\`). Don't act as if you remember earlier sessions.`,
        },
      });
      // Once: the person's line is in the output one time, the model's one time.
      expect(r.stdout.split("Counterparts memory is paused").length - 1).toBe(2);
    }
    // And every other event is as silent as `off`.
    for (const event of OTHER_EVENTS) {
      const r = start({ session: "paused-others", cwd: project, event });
      expect({ event, code: r.code, stdout: r.stdout, stderr: r.stderr }).toEqual({ event, code: 0, stdout: "", stderr: "" });
    }
    expect(existsSync(store)).toBe(false);
  });

  test("NOTHING is written to a store that exists: no session record, no claim, no log, not a byte", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    // A store that is there, as on any machine with an install.
    Counterpart.open({ dir: store }).close();
    put({ [project]: { mode: "paused", since: "2026-10-10T00:00:00.000Z" } });
    const before = snapshot(store);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    for (const source of SOURCES) {
      expect(systemMessageOf(start({ session: "no-write", cwd: project, source }).stdout)).toBe(pausedHere(project));
    }
    for (const event of OTHER_EVENTS) expect(start({ session: "no-write", cwd: project, event }).stdout).toBe("");
    expect(snapshot(store)).toEqual(before);
    expect(existsSync(join(store, "sessions", "no-write.json"))).toBe(false);
    expect(existsSync(join(store, "sessions", "claims"))).toBe(false);
  });

  test("paused by a PARENT: the parent is named, and the command resumes the entry that paused it", async () => {
    const parent = join(home, "random");
    const child = join(parent, "proj");
    mkdirSync(child, { recursive: true });
    put({ [parent]: { mode: "paused", resumeTo: "on", since: "2026-10-10T00:00:00.000Z" } });
    const r = start({ session: "by-parent", cwd: child, source: "startup" });
    expect(systemMessageOf(r.stdout)).toBe(
      `Counterparts memory is paused for ~/random, which includes this folder; \`${resumeCommand("~/random")}\` turns it back on.`,
    );
    expect(contextOf(r.stdout)).toContain("paused for ~/random, which includes this folder");
    expect(contextOf(r.stdout)).toContain(`\`${resumeCommand("~/random")}\``);
    // Why the parent has to be named: `--resume` on the child refuses ...
    expect((await cli(["scope", child, "--resume"])).code).toBe(EXIT.refused);
    // ... and on the parent — the command the notice gives — turns it back on.
    expect((await cli(["scope", parent, "--resume"])).code).toBe(EXIT.ok);
    const after = start({ session: "by-parent-2", cwd: child, source: "startup" });
    expect(after.stdout).not.toContain("paused");
    expect(after.stdout).toContain("has not lived a boundary");
  });

  test("a parent outside HOME is named by its absolute path", () => {
    const outside = join(work, "elsewhere");
    const child = join(outside, "proj");
    mkdirSync(child, { recursive: true });
    put({ [outside]: { mode: "paused", since: "2026-10-10T00:00:00.000Z" } });
    const said = systemMessageOf(start({ session: "outside", cwd: child, source: "startup" }).stdout) ?? "";
    const abs = canonicalScopePath(outside);
    expect(said).toBe(
      `Counterparts memory is paused for ${abs}, which includes this folder; \`${resumeCommand(abs)}\` turns it back on.`,
    );
  });

  test("the notice's command, typed VERBATIM in another terminal, resumes the registry the hook read", () => {
    // The two things a command in a notice can get wrong, both proved on a real
    // shell and the real console: `.` (here, the terminal stands in HOME), and a
    // registry other than the console's default (these hooks read `--config`).
    const project = join(home, "random", "proj");
    mkdirSync(project, { recursive: true });
    put({ [project]: { mode: "paused", resumeTo: "on", since: "2026-10-10T00:00:00.000Z" } });
    const said = systemMessageOf(start({ session: "verbatim", cwd: project, source: "startup" }).stdout) ?? "";
    const command = /`([^`]+)`/.exec(said)?.[1] ?? "";
    expect(command).toBe(resumeCommand("~/random/proj"));
    // A `counterparts` on PATH that is this checkout's console.
    const shim = join(work, "shim");
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, "counterparts"), `#!/bin/sh\nexec '${process.execPath}' run '${CLI_SCRIPT}' "$@"\n`, { mode: 0o755 });
    const typed = spawnSync("/bin/sh", ["-c", command], {
      cwd: home,
      encoding: "utf8",
      env: { PATH: `${shim}:${emptyBin}`, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      timeout: 60_000,
    });
    expect({ code: typed.status, stderr: typed.stderr }).toEqual({ code: 0, stderr: "" });
    expect(typed.stdout).toContain("— on.");
    // The registry the hook reads was the one written: the next start wakes.
    const after = start({ session: "verbatim-2", cwd: project, source: "startup" });
    expect(after.stdout).not.toContain("paused");
    expect(after.stdout).toContain("has not lived a boundary");
    // And the default registry beside HOME was never touched.
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the SESSION's folder paused while the shell stands elsewhere: named, as covering this session", () => {
    const project = join(home, "project");
    const elsewhere = join(home, "elsewhere");
    mkdirSync(project, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    put({ [project]: { mode: "paused", since: "2026-10-10T00:00:00.000Z" } });
    // The session is filed under CLAUDE_PROJECT_DIR; the event's cwd is not paused.
    const r = start({ session: "session-dir", cwd: elsewhere, source: "startup", env: { CLAUDE_PROJECT_DIR: project } });
    expect(systemMessageOf(r.stdout)).toBe(
      `Counterparts memory is paused for ~/project, which covers this session; \`${resumeCommand("~/project")}\` turns it back on.`,
    );
    expect(existsSync(join(store, "sessions", "session-dir.json"))).toBe(false);
  });

  test("a session filed under an OFF folder whose shell stands in a paused one says nothing", () => {
    // Resuming the paused folder would turn nothing back on for this session —
    // its own folder is off — so the line would be a false promise, and `off`
    // is silent. A start (CLAUDE_PROJECT_DIR is not the cwd) and a compaction
    // (the shell moved) are the two ways SessionStart meets this.
    const offDir = join(home, "private");
    const pausedDir = join(home, "random");
    mkdirSync(offDir, { recursive: true });
    mkdirSync(pausedDir, { recursive: true });
    put({
      [offDir]: { mode: "off", since: "2026-10-10T00:00:00.000Z" },
      [pausedDir]: { mode: "paused", resumeTo: "on", since: "2026-10-10T00:00:00.000Z" },
    });
    for (const source of SOURCES) {
      const r = start({ session: `off-session-${source}`, cwd: pausedDir, source, env: { CLAUDE_PROJECT_DIR: offDir } });
      expect({ source, code: r.code, stdout: r.stdout, stderr: r.stderr }).toEqual({ source, code: 0, stdout: "", stderr: "" });
    }
    expect(existsSync(store)).toBe(false);
    // The paused folder's own session still hears it.
    const own = start({ session: "own", cwd: pausedDir, source: "startup", env: { CLAUDE_PROJECT_DIR: pausedDir } });
    expect(systemMessageOf(own.stdout)).toBe(`Counterparts memory is paused in ~/random; \`${resumeCommand("~/random")}\` turns it back on.`);
  });

  test("OFF stays silent on every source; ON and OBSERVER say nothing about a pause", () => {
    const off = join(work, "off");
    const on = join(work, "on");
    const watched = join(work, "watched");
    for (const d of [off, on, watched]) mkdirSync(d, { recursive: true });
    put({
      [off]: { mode: "off", since: "2026-10-10T00:00:00.000Z" },
      [on]: { mode: "on", since: "2026-10-10T00:00:00.000Z" },
      [watched]: { mode: "observer", since: "2026-10-10T00:00:00.000Z" },
    });
    for (const source of SOURCES) {
      const r = start({ session: `off-${source}`, cwd: off, source });
      expect({ source, code: r.code, stdout: r.stdout, stderr: r.stderr }).toEqual({ source, code: 0, stdout: "", stderr: "" });
    }
    expect(existsSync(store)).toBe(false);
    const loud = start({ session: "on-1", cwd: on, source: "startup" });
    expect(loud.stdout).toContain("has not lived a boundary");
    expect(loud.stdout).not.toContain("paused");
    // Observer reads the store the `on` session just made.
    const quiet = start({ session: "observer-1", cwd: watched, source: "startup" });
    expect(quiet.code).toBe(0);
    expect(quiet.stdout.length).toBeGreaterThan(0);
    expect(quiet.stdout).not.toContain("paused");
  });

  test("the headless nightly run, in a paused folder, is told nothing", () => {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    put({ [project]: { mode: "paused", since: "2026-10-10T00:00:00.000Z" } });
    const r = start({ session: "night", cwd: project, source: "startup", env: { [NIGHT_RUN_ENV]: "1" } });
    expect({ code: r.code, stdout: r.stdout, stderr: r.stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

describe("pausedNotice, the words", () => {
  const paused = (matched: string): ScopeVerdict => ({ mode: "paused", matched, entry: { mode: "paused", since: "t" } });

  test("nothing for any mode but paused", () => {
    for (const mode of ["on", "observer", "off", "unset"] as const) {
      const v: ScopeVerdict = { mode, matched: mode === "unset" ? null : "/x", entry: null };
      expect(pausedNotice(v, "/x", { whose: "folder", home: "/h", pluginRoot: null })).toBe(null);
    }
  });

  test("a path that needs quoting is quoted, and a quoted path is never `~`-shortened", () => {
    const dir = join(home, "my dir");
    mkdirSync(join(dir, "proj"), { recursive: true });
    const n = pausedNotice(paused(dir), join(dir, "proj"), { whose: "folder", home, pluginRoot: null });
    const abs = canonicalScopePath(dir);
    expect(n?.person).toBe(
      `Counterparts memory is paused for ~/my dir, which includes this folder; \`counterparts scope '${abs}' --resume\` turns it back on.`,
    );
  });

  test("under the plugin, the command is the plugin's own launcher (no `counterparts` on PATH)", () => {
    const project = join(home, "p");
    mkdirSync(project, { recursive: true });
    const root = join(home, ".claude", "plugins", "cache", "counterparts", "counterparts", "0.3.15");
    const n = pausedNotice(paused(project), project, { whose: "folder", home, pluginRoot: root });
    expect(n?.person).toBe(
      "Counterparts memory is paused in ~/p; `sh ~/.claude/plugins/cache/counterparts/counterparts/0.3.15/src/adapters/plugin-run.sh cli scope ~/p --resume` turns it back on.",
    );
  });

  test("a plugin root and a named configuration with spaces are quoted whole; `--config` is two words", () => {
    const project = join(home, "p");
    mkdirSync(project, { recursive: true });
    const root = join(work, "plugin copies", "counterparts");
    const config = join(home, "other base", "claude-code.json");
    const n = pausedNotice(paused(project), project, { whose: "folder", home, pluginRoot: root, configPath: config });
    expect(n?.person).toBe(
      `Counterparts memory is paused in ~/p; \`sh '${join(root, "src", "adapters", "plugin-run.sh")}' cli scope ~/p --resume --config '${config}'\` turns it back on.`,
    );
    // A named configuration with no spaces under HOME is `~`-shortened, unquoted, so the shell expands it.
    const plain = pausedNotice(paused(project), project, { whose: "folder", home, pluginRoot: null, configPath: join(home, "base", "claude-code.json") });
    expect(plain?.person).toBe("Counterparts memory is paused in ~/p; `counterparts scope ~/p --resume --config ~/base/claude-code.json` turns it back on.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A registry in trouble is NOT silent (#92 review, F2)
// ═══════════════════════════════════════════════════════════════════════════

describe("a registry that could not be read says so, where somebody can read it", () => {
  test("every corruption mode puts ONE line on the hook's stderr at SessionStart", () => {
    // The fail direction is `unset`, which is ON — so a file nobody can read
    // turns every `off` in it back on. Before this, the only record was a ring
    // event in a process that lives for one turn, and `bin/hook.ts` wires no
    // `onEvent` at all: the ring died with the process, unread.
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    const cases: [string, () => void][] = [
      ["zero bytes (a crash mid-write)", () => writeFileSync(scopesFile, "", "utf8")],
      ["not JSON", () => writeFileSync(scopesFile, "{ broken", "utf8")],
      [
        "a version this does not read",
        () =>
          writeFileSync(
            scopesFile,
            JSON.stringify({ version: 2, scopes: { [project]: { mode: "off", since: "t" } } }),
            "utf8",
          ),
      ],
      [
        "unreadable (EACCES)",
        () => {
          put({ [project]: { mode: "off", since: "t" } });
          chmodSync(scopesFile, 0o000);
        },
      ],
    ];
    for (const [label, corrupt] of cases) {
      rmSync(scopesFile, { force: true });
      corrupt();
      const r = runHook("SessionStart", `trouble-${label.slice(0, 4)}`, project);
      expect({ label, code: r.code }).toEqual({ label, code: 0 });
      expect(`${label}: ${r.stderr}`).toContain("[counterparts] scope registry");
      expect(`${label}: ${r.stderr}`).toContain(scopesFile);
      expect(`${label}: ${r.stderr}`).toContain("reads as unset (on)");
      // I40 (2026-09-23): stderr at exit 0 reaches only the host's debug log,
      // so the same line now rides the SessionStart `systemMessage`, which the
      // terminal shows. The stderr copy above stays for the log.
      const said = String((JSON.parse(r.stdout) as Record<string, unknown>)["systemMessage"]);
      expect(`${label}: ${said}`).toContain("[counterparts] scope registry");
      expect(`${label}: ${said}`).toContain(scopesFile);
      // The hook still WORKS — the line is a warning, never a stand-down (§5 G2).
      expect(`${label}: ${r.stdout}`).toContain("has not lived a boundary");
      // ONE event only. `UserPromptSubmit` fires every turn, and a line per turn
      // is a permanent noise floor in the host's log rather than a warning.
      expect(runHook("UserPromptSubmit", "trouble-turn", project).stderr).toBe("");
      chmodSync(scopesFile, 0o600);
    }
  });

  test("ONE typo'd entry no longer turns the correctly typed `off` entries ON", () => {
    // The measurement that changed the rule: whole-file-fail meant one bad
    // entry turned every good `off` in the file on.
    const off = join(work, "private");
    const unset = join(work, "ordinary");
    mkdirSync(off, { recursive: true });
    mkdirSync(unset, { recursive: true });
    put({
      [off]: { mode: "off", since: "2026-09-10T00:00:00.000Z" },
      [join(work, "typo")]: { mode: "offf", since: "2026-09-10T00:00:00.000Z" },
    });

    // The good entry still holds — byte-for-byte silence, and no store.
    const quiet = runHook("SessionStart", "still-off", off);
    expect({ code: quiet.code, stdout: quiet.stdout, stderr: quiet.stderr }).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(existsSync(store)).toBe(false);

    // And the directory that does run hears about the entry nobody can honour,
    // by name — it is the only surface that reaches a person on this host.
    const loud = runHook("SessionStart", "ordinary-session", unset);
    expect(loud.code).toBe(0);
    expect(loud.stderr).toContain(join(work, "typo"));
    expect(String((JSON.parse(loud.stdout) as Record<string, unknown>)["systemMessage"])).toContain(join(work, "typo"));
    expect(loud.stderr).toContain("IGNORED");
    expect(loud.stdout).toContain("has not lived a boundary");
    // The durable half, on the row this session-start already writes.
    const wake = wakeRows().at(-1);
    expect(wake?.["scopeRegistry"]).toBe("partial");
  });

  test("the console names the entries it cannot read, and refuses to drop them", async () => {
    const off = join(work, "private");
    mkdirSync(off, { recursive: true });
    const typo = join(work, "typo");
    put({
      [off]: { mode: "off", since: "t" },
      [typo]: { mode: "offf", since: "t" },
    });

    const listed = await cli(["scope", "--list"]);
    expect(listed.code).toBe(EXIT.ok);
    expect(listed.err).toContain(typo);
    expect(listed.out).toContain(off);

    // A write would rewrite the file from what parsed, dropping the bad entry.
    const refused = await cli(["scope", join(work, "elsewhere"), "--off"]);
    expect(refused.code).toBe(EXIT.refused);
    expect(refused.err).toContain(typo);
    expect(refused.err).toContain("Nothing was written");
    expect(readScopes(scopesFile).refused.length).toBe(1);

    // `--force` goes ahead, says what it dropped, and keeps what parsed.
    const forced = await cli(["scope", join(work, "elsewhere"), "--off", "--force"]);
    expect(forced.code).toBe(EXIT.ok);
    expect(forced.err).toContain(typo);
    const after = readScopes(scopesFile);
    expect(after.refused).toEqual([]);
    expect(lookupScope(after.registry, off).mode).toBe("off");
    expect(lookupScope(after.registry, typo).mode).toBe("unset");
  });
});

describe("the scope a hook decides on", () => {
  /**
   * TWO DIRECTORIES, TWO QUESTIONS. The event's is where the shell is standing,
   * and it is the one the owner's registry is consulted about; the session's is
   * where everything is FILED, and it does not move for the session's whole life.
   */
  test("the EVENT's directory is the payload's cwd — it follows Claude, and it is meant to", () => {
    expect(eventDirectory({ cwd: "/a/b" }, {})).toBe("/a/b");
    expect(eventDirectory({}, { CLAUDE_PROJECT_DIR: "/c/d" })).toBe("/c/d");
    expect(eventDirectory({ cwd: "/a/b" }, { CLAUDE_PROJECT_DIR: "/c/d" })).toBe("/a/b");
    expect(eventDirectory({}, {})).toBe(process.cwd());
  });

  test("the SESSION's directory prefers CLAUDE_PROJECT_DIR, which does not follow Claude", () => {
    // The host keeps this one put when the agent enters a worktree or runs `cd`,
    // and exports it to stdio MCP servers as well as to hooks — which is what
    // makes the two adapters agree without either one telling the other.
    expect(startDirectory({ cwd: "/a/b" }, { CLAUDE_PROJECT_DIR: "/c/d" })).toBe(
      canonicalScope("/c/d"),
    );
    expect(startDirectory({ cwd: "/a/b" }, {})).toBe(canonicalScope("/a/b"));
    expect(startDirectory({}, {})).toBe(canonicalScope(process.cwd()));
  });

  test("a session with a record is filed where that record says, whatever the payload says now", () => {
    mkdirSync(store, { recursive: true });
    const project = join(work, "project");
    const worktree = join(work, "project", "wt");
    mkdirSync(worktree, { recursive: true });
    recordSession(store, { sessionId: "s1", scope: project, phase: "start" });
    // The shell has moved, and CLAUDE_PROJECT_DIR is not even set: the record
    // alone is enough.
    expect(sessionScope(store, { session_id: "s1", cwd: worktree }, {})).toBe(
      canonicalScope(project),
    );
    // A session nobody has recorded falls through to the start directory.
    expect(sessionScope(store, { session_id: "s2", cwd: worktree }, {})).toBe(
      canonicalScope(worktree),
    );
  });

  test("a SessionStart that OPENS a session re-anchors it; a compaction does not", () => {
    mkdirSync(store, { recursive: true });
    const project = join(work, "project");
    const elsewhere = join(work, "elsewhere");
    mkdirSync(project, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    recordSession(store, { sessionId: "s1", scope: project, phase: "start" });
    const at = (source?: string): string =>
      sessionScope(store, {
        hook_event_name: "SessionStart",
        session_id: "s1",
        cwd: elsewhere,
        ...(source === undefined ? {} : { source }),
      }, {});
    // Auto or manual compaction fires SessionStart in the MIDDLE of a session
    // whose MCP server is not relaunched. Re-anchoring there would split the
    // session at every compaction — this bug arriving by another door.
    expect(at("compact")).toBe(canonicalScope(project));
    // A source this does not know is treated the same way: the safe direction
    // for an unrecognised event is to leave the session where it is.
    expect(at("something-new")).toBe(canonicalScope(project));
    expect(at()).toBe(canonicalScope(project));
    // The four that really do open a session take their own directory.
    for (const source of FRESH_SESSION_SOURCES) {
      expect(at(source)).toBe(canonicalScope(elsewhere));
    }
  });

  test("a record holding an UNCANONICAL scope is still filed under the canonical one", () => {
    // `recordSession` canonicalises on write, so nothing this code wrote can be
    // in this state — but span directories are keyed by a hash of the exact
    // string, so a record written by a hand edit, an older build or a future
    // writer must not open a second directory for the same place.
    mkdirSync(store, { recursive: true });
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    recordSession(store, { sessionId: "s1", scope: project, phase: "start" });
    const path = join(store, "sessions", "s1.json");
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    // Not `join`, which would normalise it back: the record has to hold the
    // unnormalised spelling for this to test anything.
    writeFileSync(path, `${JSON.stringify({ ...record, scope: `${project}/sub/..` })}\n`);
    expect(sessionScope(store, { session_id: "s1", cwd: project }, {})).toBe(
      canonicalScope(project),
    );
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

// ═══════════════════════════════════════════════════════════════════════════
// The combinator itself, every pair of it (2026-09-17 review)
// ═══════════════════════════════════════════════════════════════════════════
describe("the rule that combines two verdicts", () => {
  /** The stance each mode carries, WRITTEN OUT rather than derived from the
   *  function under test: a table that asks `stanceOfMode` what it thinks would
   *  follow a change in it silently, which is the opposite of a pin. */
  const STANCE: Record<EffectiveMode, ScopeStance> = {
    unset: "on",
    on: "on",
    observer: "observer",
    paused: "off",
    off: "off",
  };
  /** How restrictive each stance is. `off` wins over `observer` wins over `on`. */
  const RANK: Record<ScopeStance, number> = { on: 0, observer: 1, off: 2 };
  const MODES = Object.keys(STANCE) as EffectiveMode[];
  const verdict = (mode: EffectiveMode): ScopeVerdict => ({
    mode,
    matched: `/k/${mode}`,
    entry: null,
  });

  test("`unset` rides with `on` and `paused` rides with `off`", () => {
    for (const mode of MODES) expect(stanceOfMode(mode)).toBe(STANCE[mode]);
  });

  test("every pair of modes, both ways round, resolves to the safer STANCE", () => {
    // One event now has two directories to answer for — the session's and the
    // shell's — and this is the only thing standing between "either one says
    // off" and a capture. All 25 pairs, in both argument orders, because the
    // function is not symmetric: it breaks ties toward its first argument.
    for (const session of MODES) {
      for (const event of MODES) {
        const out = mostRestrictiveVerdict(verdict(session), verdict(event));
        const safer =
          RANK[STANCE[session]] >= RANK[STANCE[event]] ? STANCE[session] : STANCE[event];
        expect(stanceOfMode(out.mode)).toBe(safer);
        // Never LESS restrictive than either side, whichever way it went.
        expect(RANK[stanceOfMode(out.mode)]).toBeGreaterThanOrEqual(RANK[STANCE[session]]);
        expect(RANK[stanceOfMode(out.mode)]).toBeGreaterThanOrEqual(RANK[STANCE[event]]);
      }
    }
  });

  test("a tie goes to the SESSION's verdict, so its entry is the one named", () => {
    for (const session of MODES) {
      for (const event of MODES) {
        if (RANK[STANCE[session]] !== RANK[STANCE[event]]) continue;
        const primary = verdict(session);
        // Object identity, not the mode: `unset` and `on` tie while being
        // different modes, and the WHOLE verdict has to survive so the
        // directory the owner is told about is the one that decided.
        expect(mostRestrictiveVerdict(primary, verdict(event))).toBe(primary);
      }
    }
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

    // ON (unset): a worker refused past the escalation threshold is doctor's
    // RED Spawn finding, and a red is what makes the entry point print the JSON
    // envelope. (It was a key that went missing until the keys were removed on
    // 2026-09-24.) Seeded explicitly, because without a red of its own this
    // test would pass only where the Checkout line happened to be red, which is
    // every branch and no clean master.
    const seeded = Store.open({ dir: store });
    seeded.setMeta("adapter.spawn.refusals.WATCHDOG_EXCEEDS_STALENESS", "9");
    seeded.close();
    const on = runHook("SessionStart", "red-on", project);
    expect(on.code).toBe(0);
    const envelope = JSON.parse(on.stdout) as {
      systemMessage?: string;
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(envelope.systemMessage ?? "").toContain("counterparts:");
    expect(envelope.systemMessage ?? "").toContain("Spawn");
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
    const folder = join(work, "project");
    const first = a.sessionStart({ sessionId: "s1", scope: folder, at: "2026-09-10" });
    expect(first.ask).toBe(scopeAsk(folder, { home: homedir(), pluginRoot: null, configPath: null }));
    // It is a QUESTION, in plain words, naming the three answers and the command.
    expect(first.ask).toContain("ask the user once");
    expect(first.ask).toContain("`scope` tool");
    // The command NAMES the session's folder, never `.` (2026-10-10): `.` is
    // wherever the shell stands when the line is run.
    expect(first.ask).toContain(`\`counterparts scope ${canonicalScopePath(folder)} --on\``);
    expect(first.ask).not.toContain("scope . ");
    // Under the plugin, the plugin's launcher; with another registry, `--config`.
    const plugin = scopeAsk(folder, { home, pluginRoot: join(home, "root"), configPath: join(home, "cfg", "claude-code.json") });
    expect(plugin).toContain(
      `\`sh ~/root/src/adapters/plugin-run.sh cli scope ${canonicalScopePath(folder)} --on --config ~/cfg/claude-code.json\``,
    );
    // The wake itself is untouched: its byte count and its sentinel still
    // describe the bundle and nothing else (§1 G2, scar §2.3) — not even the
    // clock line that rides above it since 2026-09-25 (docs/time.md rule 5).
    expect(first.injection).toMatch(/^Now: [^\n]+\n/);
    expect(first.bytes).toBe(Buffer.byteLength(first.injection.replace(/^Now: [^\n]+\n/, ""), "utf8"));

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
    // rather than a silence. The ceiling is the envelope's ONE budget, the
    // host's cap (2026-09-29): a wake that fills it leaves no room.
    const a = adapterFor();
    const text = "w".repeat(TUNABLES.HOST_OUTPUT_CHARS - 50);
    (a.counterpart as unknown as { wake: () => unknown }).wake = () => ({
      text,
      ok: true,
      reason: "loaded",
      bytes: text.length,
      sentinel: null,
      reading: null,
      preface: null,
      budgetBytes: BUDGET_BYTES,
    });
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

  test("a refusal NAMES the folder and the entry that set it, and its console line works typed anywhere (2026-10-10)", async () => {
    Store.open({ dir: store }).close();
    const project = join(work, "project");
    const sub = join(project, "sub");
    mkdirSync(sub, { recursive: true });
    const ctx = { home, pluginRoot: null, configPath };

    // Its own pause: the tool's `resume`, or the console line for this folder.
    put({ [project]: { mode: "paused", since: "t", resumeTo: "on" } });
    const own = String(body(await server({ scopeCommand: ctx }).call("note", { text: "x" }))["detail"]);
    expect(own).toBe(
      `Counterparts is paused for this directory (${canonicalScopePath(project)}). Nothing is recorded or read here until it is resumed — call \`scope\` with mode \`resume\`, or run \`counterparts scope ${canonicalScopePath(project)} --resume --config ${configPath}\`.`,
    );

    // A PARENT's pause, seen from a subfolder: `--resume` on the subfolder (or
    // on `.` typed there) is refused, so the line names the parent.
    const s = server({ scope: sub, scopeCommand: ctx });
    const detail = String(body(await s.call("note", { text: "x" }))["detail"]);
    const line = `counterparts scope ${canonicalScopePath(project)} --resume --config ${configPath}`;
    expect(detail).toContain(`Counterparts is paused for ${canonicalScopePath(project)}, which includes this directory (${canonicalScopePath(sub)})`);
    expect(detail).toContain(`run \`${line}\``);
    expect(detail).toContain("mode `resume` refuses here");
    expect(detail).not.toContain("scope . ");
    // The tool's own `resume` does refuse here, as the words say.
    expect(body(await s.call("scope", { mode: "resume" }))["reason"]).toBe("nothing-to-resume");

    // The line, typed as printed (from wherever the console stands), resumes the parent.
    const c = consoleWith();
    expect(await run(line.split(" ").slice(1), { io: c.io, env: {}, home })).toBe(EXIT.ok);
    expect(body(await s.call("status", {}))["reason"]).not.toBe("scope-off");

    // An inherited OFF names both lines: this folder alone, or the whole parent.
    put({ [project]: { mode: "off", since: "t" } });
    const off = String(body(await s.call("note", { text: "x" }))["detail"]);
    expect(off).toContain(`run \`counterparts scope ${canonicalScopePath(sub)} --on --config ${configPath}\`, to turn it on here alone`);
    expect(off).toContain(`\`counterparts scope ${canonicalScopePath(project)} --on --config ${configPath}\` turns all of`);
  });

  test("a refusal under the plugin names the plugin's launcher; the default registry adds no `--config`", async () => {
    Store.open({ dir: store }).close();
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    put({ [project]: { mode: "paused", since: "t" } });
    const root = join(home, "plugin-root");
    const plugin = String(
      body(await server({ scopeCommand: { home, pluginRoot: root, configPath: null } }).call("note", { text: "x" }))["detail"],
    );
    expect(plugin).toContain(`run \`sh ~/plugin-root/src/adapters/plugin-run.sh cli scope ${canonicalScopePath(project)} --resume\``);
    // Built from a configuration path: the default one (under HOME) names nothing.
    expect(scopeCommandContext({ configPath: join(home, ".counterparts", "claude-code.json"), pluginRoot: null, home }).configPath).toBe(null);
    expect(scopeCommandContext({ configPath, pluginRoot: "  ", home })).toEqual({ home, pluginRoot: null, configPath });
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

  test("a file with ONE entry it cannot read is READ but never written (F2)", async () => {
    Store.open({ dir: store }).close();
    const typo = join(work, "typo");
    put({
      [join(work, "project")]: { mode: "off", since: "t" },
      [typo]: { mode: "offf", since: "t" },
    });
    const s = server();
    const before = readFileSync(scopesFile, "utf8");

    // Reading still answers — in an off directory `scope` is the one door —
    // and it says which entries nobody can honour.
    const read = await s.call("scope", {});
    expect(body(read)["mode"]).toBe("off");
    expect(JSON.stringify(body(read)["registryRefused"])).toContain(typo);

    // Writing would rewrite the file from what parsed, dropping that entry.
    // A model does not get to make that trade on somebody's behalf.
    const refused = await s.call("scope", { mode: "on" });
    expect(body(refused)["reason"]).toBe("registry-partly-unreadable");
    expect(readFileSync(scopesFile, "utf8")).toBe(before);
  });

  test("an empty note CLEARS on this door too, exactly as it does on the console (F5)", async () => {
    Store.open({ dir: store }).close();
    const project = join(work, "project");
    const s = server();
    expect(body(await s.call("scope", { mode: "off", note: "client work" }))["set"]).toBe(true);
    expect(ownEntry(readScopes(scopesFile).registry, project)?.note).toBe("client work");

    // Omitted: the reason a directory is off outlives the flag that paused it.
    await s.call("scope", { mode: "pause" });
    expect(ownEntry(readScopes(scopesFile).registry, project)?.note).toBe("client work");

    // Empty: cleared — and the console does exactly the same thing, which is
    // the whole point. Before this the tool kept the note the console dropped.
    await s.call("scope", { mode: "off", note: "" });
    expect(ownEntry(readScopes(scopesFile).registry, project)?.note).toBeUndefined();

    await s.call("scope", { mode: "off", note: "again" });
    expect((await cli(["scope", project, "--off", "--note", ""])).code).toBe(EXIT.ok);
    expect(ownEntry(readScopes(scopesFile).registry, project)?.note).toBeUndefined();
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

/**
 * ONE CAPTURE SCOPE PER SESSION — as real processes, because the whole claim is
 * about what a hook process does with a payload whose `cwd` has moved.
 *
 * Measured on the owner's store, 2026-09-17: one session's spans landed in four
 * scope directories and its boundaries in all four, while its authored deposits
 * and their coverage marks landed in one — so the rest was left uncovered for
 * the crash fallback to rewrite twelve hours later.
 */
describe("one capture scope per session, wherever the shell wanders", () => {
  /** A hook process with full control of the payload AND the environment. */
  function runIn(opts: {
    event: string;
    session: string;
    cwd: string;
    source?: string;
    transcript?: string;
    projectDir?: string;
  }): { code: number; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], {
      input: JSON.stringify({
        hook_event_name: opts.event,
        session_id: opts.session,
        cwd: opts.cwd,
        ...(opts.source === undefined ? {} : { source: opts.source }),
        ...(opts.transcript === undefined ? {} : { transcript_path: opts.transcript }),
      }),
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: home,
        USERPROFILE: home,
        ...(opts.projectDir === undefined ? {} : { CLAUDE_PROJECT_DIR: opts.projectDir }),
      },
      timeout: 60_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  /** Two turns of ordinary conversation, as this host writes a transcript. */
  function transcriptOf(marker: string): string {
    const path = join(work, `${marker}.jsonl`);
    const line = (role: "user" | "assistant", text: string): string =>
      JSON.stringify({ type: role, message: { role, content: text } });
    writeFileSync(
      path,
      `${[
        line(
          "user",
          `${marker}: the nightly export runs before the backup, so a failed export leaves a stale copy that looks fresh.`,
        ),
        line(
          "assistant",
          `${marker}: then the backup has to be gated on the export's exit code rather than on the clock.`,
        ),
      ].join("\n")}\n`,
      "utf8",
    );
    return path;
  }

  /** How many conversational spans this memory holds for one directory. */
  function spansIn(scope: string): number {
    const s = openServer({ dir: store, scope, owner: true });
    try {
      return s.counterpart.spans.spans(s.scope).length;
    } finally {
      s.counterpart.close();
    }
  }

  test("the spans, the boundary and the record all stay where the session STARTED", () => {
    const project = join(work, "project");
    const worktree = join(project, ".claude", "worktrees", "wt");
    mkdirSync(worktree, { recursive: true });

    expect(
      runIn({ event: "SessionStart", session: "wanders", cwd: project, source: "startup" }).code,
    ).toBe(0);
    expect(readSession(store, "wanders")?.scope).toBe(canonicalScope(project));

    // The agent's shell moves into a worktree, and every later payload says so.
    // NO `CLAUDE_PROJECT_DIR` here at all: the session registry alone has to
    // hold the session together, because that is the source a host which does
    // not export the variable leaves us with.
    const moved = runIn({
      event: "PreCompact",
      session: "wanders",
      cwd: worktree,
      transcript: transcriptOf("WANDERS"),
    });
    expect(moved.code).toBe(0);

    expect(spansIn(canonicalScope(project))).toBeGreaterThan(0);
    expect(spansIn(canonicalScope(worktree))).toBe(0);
    // The boundary was NOT read as a session joining a memory late: the record
    // written at SessionStart is found under the same scope the boundary claims,
    // which is the thing four directories used to make impossible.
    expect(boundaryRows().at(-1)?.["joinedLate"]).toBe(false);
  });

  test("CLAUDE_PROJECT_DIR holds a session together even before its first record", () => {
    const project = join(work, "project");
    const worktree = join(project, "wt");
    mkdirSync(worktree, { recursive: true });
    // No SessionStart at all — the shape of a session that was already running
    // when this shipped, or one whose record has been pruned. The host's own
    // stable variable is what keeps the filing in one place.
    const transcript = transcriptOf("NORECORD");
    const first = runIn({
      event: "PreCompact",
      session: "no-record",
      cwd: worktree,
      projectDir: project,
      transcript,
    });
    expect(first.code).toBe(0);
    // A boundary with no record joins the memory late and SEALS (§5 G13's
    // retroactive-capture guard) — unchanged by any of this. What changed is
    // WHERE the seal, the cursor and the record it leaves behind land.
    expect(boundaryRows().at(-1)?.["joinedLate"]).toBe(true);
    expect(readSession(store, "no-record")?.scope).toBe(canonicalScope(project));

    // Everything after the seal is captured normally, and in the ONE directory.
    writeFileSync(
      transcript,
      `${[
        readFileSync(transcript, "utf8").trim(),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "AFTERSEAL: the cache stays out of the backup set." },
        }),
      ].join("\n")}\n`,
      "utf8",
    );
    const second = runIn({
      event: "PreCompact",
      session: "no-record",
      cwd: worktree,
      projectDir: project,
      transcript,
    });
    expect(second.code).toBe(0);
    expect(spansIn(canonicalScope(project))).toBeGreaterThan(0);
    expect(spansIn(canonicalScope(worktree))).toBe(0);
    expect(grepStore("AFTERSEAL")).toBeGreaterThan(0);
  });

  test("A DEPOSIT FROM THE MCP SIDE COVERS SPANS THE HOOKS CAPTURED FROM A MOVED cwd", async () => {
    const project = join(work, "project");
    const worktree = join(project, ".claude", "worktrees", "wt");
    mkdirSync(worktree, { recursive: true });

    expect(
      runIn({ event: "SessionStart", session: "covers", cwd: project, source: "startup" }).code,
    ).toBe(0);
    expect(
      runIn({
        event: "PreCompact",
        session: "covers",
        cwd: worktree,
        transcript: transcriptOf("COVERS"),
      }).code,
    ).toBe(0);

    // The server as this host launches it: its scope is fixed for the life of
    // the process and it never hears about the worktree.
    const s = openServer({ dir: store, scope: project, owner: true });
    try {
      const before = s.counterpart.spans.coverageReport(s.scope);
      expect(before.spans).toBeGreaterThan(0);
      expect(before.covered).toBe(0);
      const result = (
        await s.call("session_end", {
          session: "covers",
          memories: [
            {
              content:
                "Gating the backup on the export's exit code is what stops a stale copy from looking fresh.",
            },
          ],
        })
      ).structuredContent;
      expect(result["deposited"]).toBe(1);
      // THE POINT: the author's own memory takes the session's spans off the
      // sweep's pile. Before this branch those spans were in another directory
      // and this number stayed at zero.
      expect(s.counterpart.spans.coverageReport(s.scope).covered).toBeGreaterThan(0);
    } finally {
      s.counterpart.close();
    }
  });

  test("THE BATCH, END TO END: a session that answered and then sat idle leaves the fallback nothing to write", async () => {
    // The end-state the 2026-09-17 authorship batch exists for, across all three
    // of its changes at once: the session's spans are filed in ONE scope although
    // its shell moved, its own deposit covers them, and an idle-past-the-window
    // session therefore hands the crash fallback nothing: no interpreter call, no
    // wake composed into a prompt, no fallback memory.
    const project = join(work, "project");
    const worktree = join(project, ".claude", "worktrees", "wt");
    mkdirSync(worktree, { recursive: true });

    expect(
      runIn({ event: "SessionStart", session: "idle", cwd: project, source: "startup" }).code,
    ).toBe(0);
    expect(
      runIn({
        event: "PreCompact",
        session: "idle",
        cwd: worktree,
        transcript: transcriptOf("IDLE"),
      }).code,
    ).toBe(0);
    expect(spansIn(canonicalScope(worktree))).toBe(0);

    const s = openServer({ dir: store, scope: project, owner: true });
    try {
      // CONTROL: before the author answers, this silent session IS the fallback's
      // to read. `staleMs: 0` stands in for the twelve idle hours.
      expect(s.counterpart.spans.crashedPending(s.scope, { staleMs: 0 }).uncovered).toBeGreaterThan(0);

      const result = (
        await s.call("session_end", {
          session: "idle",
          memories: [
            {
              content:
                "A restore drill that never runs is a backup nobody has tested; schedule the drill, not only the copy.",
            },
          ],
        })
      ).structuredContent;
      expect(result["deposited"]).toBe(1);
      expect(s.counterpart.spans.crashedPending(s.scope, { staleMs: 0 }).uncovered).toBe(0);

      const prompts: string[] = [];
      const reports = await s.counterpart.sweepFallback({
        crashStaleMs: 0,
        interpret: async (chunk) => {
          prompts.push(chunk.prompt);
          return { proposals: [], stopReason: "end_turn" };
        },
      });
      expect(prompts).toEqual([]);
      expect(reports.some((r) => r.ran)).toBe(false);
      expect(s.counterpart.store.countMemories({ type: "memory", source: "fallback" })).toBe(0);
      expect(s.counterpart.store.countMemories({ type: "memory", source: "authored" })).toBe(1);
    } finally {
      s.counterpart.close();
    }
  });

  test("PRIVACY: a session that starts ON and walks into an OFF directory goes silent", () => {
    const project = join(work, "project");
    const secret = join(work, "secret");
    mkdirSync(project, { recursive: true });
    mkdirSync(secret, { recursive: true });
    put({ [secret]: { mode: "off", since: "2026-09-17T00:00:00.000Z" } });

    expect(
      runIn({ event: "SessionStart", session: "walks", cwd: project, source: "startup" }).code,
    ).toBe(0);
    // In the off directory the hook produces nothing and writes nothing, even
    // though the session is filed somewhere the owner said yes to.
    const inside = runIn({
      event: "PreCompact",
      session: "walks",
      cwd: secret,
      transcript: transcriptOf("OFFMARKER"),
    });
    expect(inside.code).toBe(0);
    expect(inside.stdout).toBe("");
    expect(grepStore("OFFMARKER")).toBe(0);
    // And a SessionStart in there says nothing either — no wake, no ask.
    expect(runIn({ event: "SessionStart", session: "walks", cwd: secret }).stdout).toBe("");

    // Back in the project it records again: the stance is the event's to set,
    // turn by turn, and nothing here is sticky.
    const back = runIn({
      event: "PreCompact",
      session: "walks",
      cwd: project,
      transcript: transcriptOf("ONMARKER"),
    });
    expect(back.code).toBe(0);
    expect(grepStore("ONMARKER")).toBeGreaterThan(0);
  });

  test("PRIVACY: a session that starts ON and walks into an OBSERVER directory deposits nothing", () => {
    const project = join(work, "project");
    const reading = join(work, "reading-room");
    mkdirSync(project, { recursive: true });
    mkdirSync(reading, { recursive: true });
    put({ [reading]: { mode: "observer", since: "2026-09-17T00:00:00.000Z" } });

    expect(
      runIn({ event: "SessionStart", session: "reads", cwd: project, source: "startup" }).code,
    ).toBe(0);
    const inside = runIn({
      event: "PreCompact",
      session: "reads",
      cwd: reading,
      transcript: transcriptOf("OBSMARKER"),
    });
    expect(inside.code).toBe(0);
    // An observer reads and deposits nothing — the stand-down the registry
    // folds into the config, reached here through the EVENT's directory.
    expect(grepStore("OBSMARKER")).toBe(0);
  });

  test("PRIVACY: a session that STARTED in an off directory is off wherever it goes", () => {
    const secret = join(work, "secret");
    const project = join(work, "project");
    mkdirSync(secret, { recursive: true });
    mkdirSync(project, { recursive: true });
    put({ [secret]: { mode: "off", since: "2026-09-17T00:00:00.000Z" } });

    // Nothing at all is written for the session while it is in there.
    expect(runIn({ event: "SessionStart", session: "quiet", cwd: secret, source: "startup" }).stdout).toBe("");
    // It then walks into a directory that IS on — carrying a transcript of what
    // was said in the off one. The session's own directory is still off, so the
    // hook stands down there too, and the off stretch is never captured.
    const out = runIn({
      event: "PreCompact",
      session: "quiet",
      cwd: project,
      projectDir: secret,
      transcript: transcriptOf("SECRETMARKER"),
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toBe("");
    expect(grepStore("SECRETMARKER")).toBe(0);
    // NOT A BYTE — the guarantee is the absence of construction (§5 G19), and
    // this is the one path that reaches the SECOND return, after the
    // configuration and the session registry have been read. Neither is a write.
    expect(existsSync(store)).toBe(false);
  });
});

/** Nothing above may leave a scopes.json anywhere but its own temp directory. */
test("the suite's own registry never leaves the temp directory", () => {
  const registry: ScopeRegistry = setScope(null, work, "off", { at: "t" });
  expect(Object.keys(registry.scopes).every((k) => k.startsWith("/"))).toBe(true);
});
