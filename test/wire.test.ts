/**
 * `counterparts wire` / `unwire` — the host's settings file, edited.
 *
 * This is the module with the most to lose: `~/.claude/settings.json` belongs
 * to somebody else and may hold every other tool they use. So the tests are
 * organised around the ways that could go wrong rather than around the
 * functions:
 *
 *   1. **Somebody else's hooks survive**, byte-for-meaning, through a wire AND
 *      the unwire after it — position, `matcher`, `timeout`, unknown keys.
 *   2. **A file this cannot read is never rewritten.** The bytes are hashed
 *      before and compared after.
 *   3. **Running it twice is not an event**: no change, no second backup.
 *   4. **A stale entry is repaired, not duplicated.**
 *   5. **A symlink is written THROUGH into the home, and refused outside it.**
 *   6. **`claude` missing is not a failure** — the hooks still land.
 *
 * Hermetic by construction: every test mints a temp HOME under the OS temp dir
 * and removes it in `afterEach`; no test runs the real `claude` binary (the
 * spawner is injected everywhere and records its argv); no test opens a store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { HOST_EVENTS, MCP_SCRIPT, MCP_SERVER_NAME, hookCommand, readHost } from "../src/adapters/cli/install.js";
import {
  BACKUP_INFIX,
  backupPath,
  mcpAddArgs,
  mergeHooks,
  processMark,
  readMcp,
  settingsBytes,
  sightSettings,
  tilde,
  unwire,
  userSettingsPath,
  wire,
  writeSettings,
} from "../src/adapters/cli/wire.js";
import type { ProcessLister, SpawnResult, Spawner, WireInput } from "../src/adapters/cli/wire.js";

// ── the harness ─────────────────────────────────────────────────────────────

let home: string;
const made: string[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "counterparts-wire-"));
  made.push(home);
});

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface Console_ {
  io: Io;
  out: string[];
  err: string[];
  asked: string[];
}

function consoleWith(answers: readonly string[] | null = null): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const queue = answers === null ? [] : [...answers];
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...(answers === null
      ? {}
      : {
          prompt: async (question: string): Promise<string> => {
            asked.push(question);
            return queue.shift() ?? "";
          },
        }),
  };
  return { io, out, err, asked };
}

const text = (lines: readonly string[]): string => lines.join("\n");

const ENV: Record<string, string | undefined> = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };

const settingsFile = (): string => join(home, ".claude", "settings.json");
const mcpFile = (): string => join(home, ".claude.json");
const store = (): string => join(home, ".counterparts", "store");
const configPath = (): string => join(home, ".counterparts", "claude-code.json");

const EXE = "/fake/bin/bun";
/** The exact command string a wiring of this install installs. */
const COMMAND = (custom?: string): string => hookCommand(custom, EXE);

interface FakeSpawner {
  spawner: Spawner;
  calls: string[][];
}

/** A `claude` that records its argv and answers however the test says. */
function spawnerThat(answer: (args: readonly string[]) => SpawnResult): FakeSpawner {
  const calls: string[][] = [];
  return {
    calls,
    spawner: (args) => {
      calls.push([...args]);
      return answer(args);
    },
  };
}

const OK: SpawnResult = { missing: false, code: 0, out: "", err: "" };
const MISSING: SpawnResult = { missing: true, code: null, out: "", err: "" };

const noProcesses: ProcessLister = () => [];

function input(over: Partial<WireInput> = {}): WireInput {
  const c = over.io === undefined ? consoleWith() : null;
  return {
    io: over.io ?? (c as Console_).io,
    env: ENV,
    home,
    configPath: configPath(),
    custom: undefined,
    store: store(),
    now: Date.parse("2026-09-21T14:03:05.123Z"),
    yes: true,
    dryRun: false,
    exe: EXE,
    spawner: spawnerThat(() => OK).spawner,
    lister: noProcesses,
    ...over,
  };
}

function writeSettingsFile(value: unknown): void {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(settingsFile(), `${JSON.stringify(value, null, 2)}\n`);
}

function readSettingsFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsFile(), "utf8")) as Record<string, unknown>;
}

function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Every backup beside the settings file, by name. */
function backups(): string[] {
  const dir = join(home, ".claude");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.includes(BACKUP_INFIX))
    .sort();
}

/** A hook that is not ours, with keys this code has never heard of. */
const FOREIGN = {
  matcher: "*",
  hooks: [{ type: "command", command: "/usr/local/bin/other-tool --hook", timeout: 12 }],
  somethingElse: { deep: [1, 2, 3] },
};

// ── the merge, pure ─────────────────────────────────────────────────────────

describe("mergeHooks", () => {
  test("a blank settings file gains exactly the five events and nothing else", () => {
    const merged = mergeHooks({}, COMMAND(), "wire");
    expect(merged.changed).toBe(true);
    expect(merged.events.map((e) => e.event)).toEqual([...HOST_EVENTS]);
    expect(merged.events.every((e) => e.change === "added")).toBe(true);
    expect(Object.keys(merged.value)).toEqual(["hooks"]);
    const hooks = merged.value["hooks"] as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([...HOST_EVENTS].sort());
    for (const event of HOST_EVENTS) {
      expect(hooks[event]).toEqual([{ hooks: [{ type: "command", command: COMMAND() }] }]);
    }
  });

  test("the object handed in is NEVER mutated — a plan is not a write", () => {
    const before = { hooks: { SessionStart: [FOREIGN] }, model: "opus" };
    const snapshot = JSON.stringify(before);
    mergeHooks(before, COMMAND(), "wire");
    mergeHooks(before, "", "unwire");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test("another tool's hook keeps its place, its matcher, its timeout and its unknown keys", () => {
    const merged = mergeHooks(
      { hooks: { SessionStart: [FOREIGN], PreToolUse: [FOREIGN] }, permissions: { allow: ["Bash"] } },
      COMMAND(),
      "wire",
    );
    const hooks = merged.value["hooks"] as Record<string, unknown>;
    const start = hooks["SessionStart"] as unknown[];
    // FIRST, exactly as it was, and ours appended AFTER it.
    expect(start[0]).toEqual(FOREIGN);
    expect(start[1]).toEqual({ hooks: [{ type: "command", command: COMMAND() }] });
    // An event we do not use is not touched at all.
    expect(hooks["PreToolUse"]).toEqual([FOREIGN]);
    // And every other top-level key survives.
    expect(merged.value["permissions"]).toEqual({ allow: ["Bash"] });
    expect(merged.foreignKept).toBeGreaterThan(0);
  });

  test("a STALE entry of ours is replaced IN PLACE, keeping its other keys, never duplicated", () => {
    const stale = "/old/checkout/src/adapters/claude-code/bin/hook.ts";
    const value = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: `"/old/bun" run "${stale}"`, timeout: 30 }] },
        ],
      },
    };
    const merged = mergeHooks(value, COMMAND(), "wire");
    const start = (merged.value["hooks"] as Record<string, unknown>)["SessionStart"] as unknown[];
    expect(start).toHaveLength(1);
    expect(start[0]).toEqual({
      hooks: [{ type: "command", command: COMMAND(), timeout: 30 }],
    });
    const change = merged.events.find((e) => e.event === "SessionStart");
    expect(change?.change).toBe("replaced");
    expect(change?.was).toContain(stale);
  });

  test("the `counterparts-hook` shim is recognised as ours and replaced", () => {
    const merged = mergeHooks(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: "counterparts-hook" }] }] } },
      COMMAND(),
      "wire",
    );
    const stop = (merged.value["hooks"] as Record<string, unknown>)["Stop"] as unknown[];
    expect(stop).toHaveLength(1);
    expect(merged.events.find((e) => e.event === "Stop")?.change).toBe("replaced");
  });

  test("two entries of ours on one event collapse to one — a block pasted twice", () => {
    const merged = mergeHooks(
      {
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: COMMAND() }] },
            { hooks: [{ type: "command", command: COMMAND() }] },
          ],
        },
      },
      COMMAND(),
      "wire",
    );
    const stop = (merged.value["hooks"] as Record<string, unknown>)["Stop"] as unknown[];
    expect(stop).toHaveLength(1);
    expect(merged.events.find((e) => e.event === "Stop")?.duplicatesRemoved).toBe(1);
    expect(merged.changed).toBe(true);
  });

  test("wiring an already-wired file changes nothing at all", () => {
    const once = mergeHooks({}, COMMAND(), "wire");
    const twice = mergeHooks(once.value, COMMAND(), "wire");
    expect(twice.changed).toBe(false);
    expect(twice.events.every((e) => e.change === "kept")).toBe(true);
    expect(JSON.stringify(twice.value)).toBe(JSON.stringify(once.value));
  });

  test("unwire removes ours and drops the empty group, the empty event and the empty `hooks`", () => {
    const wired = mergeHooks({ model: "opus" }, COMMAND(), "wire");
    const bare = mergeHooks(wired.value, "", "unwire");
    expect(bare.changed).toBe(true);
    expect(bare.events.map((e) => e.change)).toEqual(HOST_EVENTS.map(() => "removed"));
    // Not `{ hooks: {} }`, and not `{ hooks: { Stop: [] } }` — our litter, gone.
    expect(bare.value).toEqual({ model: "opus" });
  });

  test("unwire leaves another tool's hook on the same event exactly as it was", () => {
    const start = { hooks: { SessionStart: [FOREIGN] } };
    const wired = mergeHooks(start, COMMAND(), "wire");
    const bare = mergeHooks(wired.value, "", "unwire");
    expect(bare.value).toEqual({ hooks: { SessionStart: [FOREIGN] } });
  });

  test("unwire on a file that has no hooks of ours changes nothing", () => {
    const foreign = { hooks: { SessionStart: [FOREIGN] }, model: "opus" };
    const bare = mergeHooks(foreign, "", "unwire");
    expect(bare.changed).toBe(false);
    expect(bare.value).toEqual(foreign);
  });

  test("another tool's EMPTY shapes survive both directions — neither is ours to tidy", () => {
    // Both of these were destroyed before the A review: a foreign group whose
    // own `hooks` array was already empty took the "the group held nothing but
    // ours" branch, and a foreign `"Stop": []` had its event key deleted by an
    // unwire that had found no hook of ours anywhere at all.
    const foreign = {
      hooks: { Stop: [], PreCompact: [{ matcher: "x", hooks: [] }] },
      model: "opus",
    };
    const bare = mergeHooks(foreign, "", "unwire");
    expect(bare.changed).toBe(false);
    expect(bare.value).toEqual(foreign);

    // And through a wire: the empty GROUP is still there afterwards. (The empty
    // ARRAY on `Stop` is not — an array with no hook in it carries nothing, and
    // it is the one shape a round trip does not restore exactly.)
    const wired = mergeHooks(foreign, COMMAND(), "wire");
    const back = mergeHooks(wired.value, "", "unwire");
    const hooks = back.value["hooks"] as Record<string, unknown>;
    expect(hooks["PreCompact"]).toEqual([{ matcher: "x", hooks: [] }]);
    expect(back.value["model"]).toBe("opus");
  });

  test("a group shaped in a way this does not read is carried through whole", () => {
    const odd = { hooks: { Stop: ["a string", 7, { hooks: "not an array" }] } };
    const merged = mergeHooks(odd, COMMAND(), "wire");
    const stop = (merged.value["hooks"] as Record<string, unknown>)["Stop"] as unknown[];
    expect(stop.slice(0, 3)).toEqual(["a string", 7, { hooks: "not an array" }]);
    expect(stop).toHaveLength(4);
  });
});

// ── reading the file ────────────────────────────────────────────────────────

describe("sightSettings", () => {
  test("a file that is not there is not a refusal — wiring creates it", () => {
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toBeNull();
    expect(sight.exists).toBe(false);
    expect(sight.value).toEqual({});
  });

  test("an EMPTY file is not a broken one", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsFile(), "   \n");
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toBeNull();
    expect(sight.exists).toBe(true);
    expect(sight.value).toEqual({});
  });

  test("bytes that are not JSON are a refusal, with the reason", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsFile(), '{ "hooks": { , }');
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toContain("does not parse as JSON");
    expect(sight.refusal).toContain(settingsFile());
  });

  test("a top level that is not an object is a refusal", () => {
    writeSettingsFile([1, 2, 3]);
    expect(sightSettings(settingsFile(), home).refusal).toContain("an array");
  });

  test('a "hooks" key that is not an object is a refusal', () => {
    writeSettingsFile({ hooks: "all of them" });
    expect(sightSettings(settingsFile(), home).refusal).toContain('"hooks"');
  });

  test("an event whose value is not an array is a refusal", () => {
    writeSettingsFile({ hooks: { Stop: { command: "x" } } });
    expect(sightSettings(settingsFile(), home).refusal).toContain('"Stop"');
  });

  test("a symlink INSIDE the home is followed, and the write lands on the target", () => {
    const real = join(home, "dotfiles", "settings.json");
    mkdirSync(dirname(real), { recursive: true });
    writeFileSync(real, `${JSON.stringify({ model: "opus" }, null, 2)}\n`);
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync(real, settingsFile());
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toBeNull();
    expect(sight.symlink).toBe(true);
    // `realpathSync`, because macOS spells `$TMPDIR` through a symlink of its
    // own and the module resolves BOTH sides before it compares.
    expect(sight.target).toBe(realpathSync(real));
    expect(sight.value).toEqual({ model: "opus" });
  });

  test("a symlink OUT of the home is refused rather than followed", () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outside-"));
    made.push(outside);
    const real = join(outside, "settings.json");
    writeFileSync(real, "{}\n");
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync(real, settingsFile());
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toContain("outside your home directory");
    expect(sight.refusal).toContain(real);
  });

  test("a DIRECTORY with that name is refused, not read as empty", () => {
    mkdirSync(settingsFile(), { recursive: true });
    expect(sightSettings(settingsFile(), home).refusal).toContain("not a regular file");
  });
});

// ── writing it ──────────────────────────────────────────────────────────────

describe("writeSettings", () => {
  test("two-space indentation and one trailing newline, always", () => {
    expect(settingsBytes({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n');
  });

  test("the backup is beside the file, at the file's own mode, and is named in the output", () => {
    writeSettingsFile({ model: "opus" });
    chmodSync(settingsFile(), 0o600);
    const before = readFileSync(settingsFile(), "utf8");
    const now = Date.parse("2026-09-21T14:03:05.123Z");
    const sight = sightSettings(settingsFile(), home);
    const wrote = writeSettings(sight, { model: "opus", hooks: {} }, now);
    expect(wrote.error).toBeNull();
    expect(wrote.backup).toBe(backupPath(settingsFile(), now));
    expect(wrote.backup).toContain("settings.json.counterparts-backup-2026-09-21T14-03-05Z");
    expect(readFileSync(wrote.backup as string, "utf8")).toBe(before);
    expect(statSync(wrote.backup as string).mode & 0o777).toBe(0o600);
    // And the file keeps the mode it had.
    expect(statSync(settingsFile()).mode & 0o777).toBe(0o600);
  });

  test("a file that was not there is created with no backup, and no temp file is left", () => {
    const sight = sightSettings(settingsFile(), home);
    const wrote = writeSettings(sight, { hooks: {} }, Date.now());
    expect(wrote.backup).toBeNull();
    expect(existsSync(settingsFile())).toBe(true);
    expect(readdirSync(join(home, ".claude")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("a symlink stays a symlink: the target is rewritten, the link is not replaced", () => {
    const real = join(home, "dotfiles", "settings.json");
    mkdirSync(dirname(real), { recursive: true });
    writeFileSync(real, "{}\n");
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync(real, settingsFile());
    const sight = sightSettings(settingsFile(), home);
    writeSettings(sight, { hooks: { Stop: [] } }, Date.now());
    expect(readFileSync(real, "utf8")).toContain('"Stop"');
    // `lstat`, NOT `stat`: `stat` follows the link, so this would pass even if
    // the rename had replaced the link with a regular file — which is the one
    // thing this test exists to catch.
    expect(lstatSync(settingsFile()).isSymbolicLink()).toBe(true);
    // And the backup is beside the TARGET, not beside the link.
    expect(readdirSync(join(home, "dotfiles")).some((n) => n.includes(BACKUP_INFIX))).toBe(true);
    expect(readdirSync(join(home, ".claude")).some((n) => n.includes(BACKUP_INFIX))).toBe(false);
  });

  test("a second backup in the same SECOND never lands on the first", () => {
    // The stamp has second resolution, and `wire` then `unwire` is two hundred
    // milliseconds apart in the install loop. Without a free name the second
    // copy overwrote the first, and the person's ORIGINAL file was gone.
    writeSettingsFile({ model: "opus" });
    const original = readFileSync(settingsFile(), "utf8");
    const now = Date.parse("2026-09-21T14:03:05.123Z");
    const first = writeSettings(sightSettings(settingsFile(), home), { one: 1 }, now);
    const second = writeSettings(sightSettings(settingsFile(), home), { two: 2 }, now);
    expect(first.backup).not.toBe(second.backup);
    expect(second.backup).toBe(`${first.backup as string}-2`);
    expect(readFileSync(first.backup as string, "utf8")).toBe(original);
    expect(backups()).toHaveLength(2);
  });
});

// ── the MCP half ────────────────────────────────────────────────────────────

describe("the MCP registration", () => {
  test("the argument vector names the same store and the same script as the printed line", () => {
    const args = mcpAddArgs(store(), undefined, EXE);
    expect(args.slice(0, 5)).toEqual(["mcp", "add", MCP_SERVER_NAME, "-s", "user"]);
    expect(args).toContain(`COUNTERPARTS_DATA_DIR=${store()}`);
    expect(args.slice(-3)).toEqual([EXE, "run", MCP_SCRIPT]);
    // No shell quoting anywhere: these are argv entries, not a command line.
    expect(args.some((a) => a.includes('"'))).toBe(false);
  });

  test("a non-default configuration travels as a second -e", () => {
    const args = mcpAddArgs(store(), "/elsewhere/claude-code.json", EXE);
    expect(args).toContain("COUNTERPARTS_CONFIG=/elsewhere/claude-code.json");
  });

  test("readMcp tells absent from registered-elsewhere from registered-here", () => {
    expect(readMcp(home, ENV, store(), undefined, EXE).present).toBe(false);
    writeFileSync(
      mcpFile(),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: EXE,
            args: ["run", MCP_SCRIPT],
            env: { COUNTERPARTS_DATA_DIR: "/somewhere/else" },
          },
        },
      }),
    );
    const other = readMcp(home, ENV, store(), undefined, EXE);
    expect(other.present).toBe(true);
    expect(other.matches).toBe(false);

    writeFileSync(
      mcpFile(),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: EXE,
            args: ["run", MCP_SCRIPT],
            env: { COUNTERPARTS_DATA_DIR: store() },
          },
        },
      }),
    );
    expect(readMcp(home, ENV, store(), undefined, EXE).matches).toBe(true);
  });

  test("a ~/.claude.json that will not parse reads as unreadable, never as not-installed", () => {
    writeFileSync(mcpFile(), "{ nope");
    const read = readMcp(home, ENV, store(), undefined, EXE);
    expect(read.unreadable).toBe(true);
    expect(read.present).toBe(false);
  });
});

// ── which processes count ───────────────────────────────────────────────────

describe("the process lister's marks", () => {
  test("ours are recognised by the SCRIPT, not by the word in a path", () => {
    expect(processMark("/x/bun run /pkg/src/adapters/mcp/bin/serve.ts")).toBe("an MCP server");
    expect(processMark("/x/bun run /pkg/src/adapters/claude-code/bin/runner.ts")).toBe("the worker");
    expect(processMark("/x/bun run /pkg/src/adapters/dashboard/bin/dashboard.ts")).toBe("a dashboard");
    expect(processMark("/home/me/.bun/bin/counterparts-mcp")).toBe("an MCP server");
  });

  test("a command that merely mentions the name is NOT one of ours", () => {
    expect(processMark("vim /Users/me/counterparts/src/index.ts")).toBeNull();
    expect(processMark("tail -f /var/log/counterparts.log")).toBeNull();
    expect(processMark("/x/bun run /pkg/src/adapters/cli/bin/counterparts.ts uninstall")).toBeNull();
    expect(processMark("grep -r counterparts-mcpx .")).toBeNull();
  });
});

// ── wire, end to end, against a real temp home ──────────────────────────────

describe("wire", () => {
  test("it writes the five hooks where the host reads them, and doctor's reading agrees", async () => {
    const c = consoleWith();
    const fake = spawnerThat(() => OK);
    const result = await wire(input({ io: c.io, spawner: fake.spawner }));
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("wired");
    expect(result.mcp).toBe("added");

    // THE SAME READING `doctor` MAKES. If these two ever disagree, a wired
    // install reads as unwired on the one surface a person checks.
    const read = readHost(home, join(home, "project"), ENV);
    expect([...read.events].sort()).toEqual([...HOST_EVENTS].sort());
    expect(read.stale).toEqual([]);

    // And the `claude` call is the one the printed line describes.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.slice(0, 3)).toEqual(["mcp", "add", MCP_SERVER_NAME]);
  });

  test("running it twice changes nothing and takes NO second backup", async () => {
    const first = consoleWith();
    await wire(input({ io: first.io }));
    expect(backups()).toHaveLength(0); // the file was created, not replaced
    const after = hashOf(settingsFile());

    // A registration now exists, so the second run has nothing to do at all.
    writeFileSync(
      mcpFile(),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: { command: EXE, args: ["run", MCP_SCRIPT], env: { COUNTERPARTS_DATA_DIR: store() } },
        },
      }),
    );
    const second = consoleWith();
    const fake = spawnerThat(() => OK);
    const result = await wire(input({ io: second.io, spawner: fake.spawner }));
    expect(result.hooks).toBe("already");
    expect(result.mcp).toBe("already");
    expect(text(second.out)).toContain("already wired");
    expect(hashOf(settingsFile())).toBe(after);
    expect(backups()).toHaveLength(0);
    expect(fake.calls).toEqual([]);
  });

  test("a stale entry is REPAIRED, the old path is named, and only one backup is taken", async () => {
    const stale = '"/old/bun" run "/gone/src/adapters/claude-code/bin/hook.ts"';
    writeSettingsFile({
      hooks: Object.fromEntries(
        HOST_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: stale }] }]]),
      ),
    });
    const c = consoleWith();
    const result = await wire(input({ io: c.io }));
    expect(result.hooks).toBe("repaired");
    expect(text(c.out)).toContain("/gone/src/adapters/claude-code/bin/hook.ts");
    expect(backups()).toHaveLength(1);
    const hooks = readSettingsFile()["hooks"] as Record<string, unknown>;
    for (const event of HOST_EVENTS) {
      expect(hooks[event]).toHaveLength(1);
    }
    expect(readHost(home, home, ENV).stale).toEqual([]);
  });

  test("somebody else's hooks survive a wire AND the unwire after it", async () => {
    const original = {
      model: "opus",
      permissions: { allow: ["Bash(git:*)"] },
      hooks: { SessionStart: [FOREIGN], PreToolUse: [FOREIGN] },
    };
    writeSettingsFile(original);
    const before = readSettingsFile();

    await wire(input({ io: consoleWith().io }));
    const wired = readSettingsFile();
    expect((wired["hooks"] as Record<string, unknown>)["PreToolUse"]).toEqual([FOREIGN]);

    const c = consoleWith();
    const result = await unwire(input({ io: c.io }));
    expect(result.outcome).toBe("ok");
    // BYTE FOR MEANING: the whole document, deep-equal to what was there.
    expect(readSettingsFile()).toEqual(before);
  });

  test("a settings file that will not parse REFUSES, changes not one byte, and prints the block", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsFile(), '{"hooks": oops}');
    const before = hashOf(settingsFile());
    const c = consoleWith();
    const result = await wire(input({ io: c.io }));
    expect(result.outcome).toBe("refused");
    expect(hashOf(settingsFile())).toBe(before);
    expect(backups()).toHaveLength(0);
    const said = text(c.err);
    expect(said).toContain("does not parse as JSON");
    expect(said).toContain("SessionStart");
    // The whole block, ready to paste: every event, and the hook script by name.
    for (const event of HOST_EVENTS) expect(said).toContain(event);
    expect(said).toContain("bin/hook.ts");
  });

  test("a symlinked settings.json is written THROUGH; the link is not replaced", async () => {
    const real = join(home, "dotfiles", "settings.json");
    mkdirSync(dirname(real), { recursive: true });
    writeFileSync(real, `${JSON.stringify({ model: "opus" }, null, 2)}\n`);
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync(real, settingsFile());

    await wire(input({ io: consoleWith().io }));
    const through = JSON.parse(readFileSync(real, "utf8")) as Record<string, unknown>;
    expect(Object.keys(through["hooks"] as Record<string, unknown>).sort()).toEqual([...HOST_EVENTS].sort());
    expect(through["model"]).toBe("opus");
  });

  test("`claude` missing is a WARNING and a printed line, not a failure: the hooks still land", async () => {
    const c = consoleWith();
    const result = await wire(input({ io: c.io, spawner: spawnerThat(() => MISSING).spawner }));
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("wired");
    expect(result.mcp).toBe("printed");
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    const said = text(c.out);
    expect(said).toContain("`claude` is not on this PATH");
    expect(said).toContain("claude mcp add counterparts -s user");
  });

  test("a server registered at ANOTHER store is removed and re-added, out loud", async () => {
    writeFileSync(
      mcpFile(),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: { command: EXE, args: ["run", MCP_SCRIPT], env: { COUNTERPARTS_DATA_DIR: "/elsewhere" } },
        },
      }),
    );
    const c = consoleWith();
    const fake = spawnerThat((args) =>
      args[1] === "add" && fake.calls.length === 1
        ? { missing: false, code: 1, out: "", err: "MCP server counterparts already exists" }
        : OK,
    );
    const result = await wire(input({ io: c.io, spawner: fake.spawner }));
    expect(result.outcome).toBe("ok");
    expect(result.mcp).toBe("re-added");
    expect(fake.calls.map((a) => a[1])).toEqual(["add", "remove", "add"]);
    expect(text(c.out)).toContain("re-registered");
  });

  test("--dry-run prints the shape and writes nothing", async () => {
    const c = consoleWith();
    const fake = spawnerThat(() => OK);
    const result = await wire(input({ io: c.io, dryRun: true, spawner: fake.spawner }));
    expect(result.outcome).toBe("ok");
    expect(existsSync(settingsFile())).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(text(c.out)).toContain("5 hooks ->");
  });

  test("a console with no prompt and no --yes wires NOTHING and says which flag means yes", async () => {
    const c = consoleWith(null);
    const result = await wire(input({ io: c.io, yes: false }));
    expect(result.outcome).toBe("refused");
    expect(existsSync(settingsFile())).toBe(false);
    expect(text(c.err)).toContain("--yes");
  });

  test("a person who answers no gets nothing written, and the command still exits ok", async () => {
    const c = consoleWith(["n"]);
    const result = await wire(input({ io: c.io, yes: false }));
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("declined");
    expect(existsSync(settingsFile())).toBe(false);
    expect(c.asked[0]).toContain("Wire Claude Code now?");
  });

  test("the sessions sentence is always there, and counts running servers when it can", async () => {
    const quiet = consoleWith();
    await wire(input({ io: quiet.io }));
    expect(text(quiet.out)).toContain("Hooks start with your next turn");
    expect(text(quiet.out)).toContain("restart Claude Code");
    expect(text(quiet.out)).not.toContain("sessions are running");

    rmSync(join(home, ".claude"), { recursive: true, force: true });
    const busy = consoleWith();
    const lister: ProcessLister = () => [
      { pid: 11, what: "an MCP server", command: "bun run serve.ts" },
      { pid: 12, what: "an MCP server", command: "bun run serve.ts" },
    ];
    await wire(input({ io: busy.io, lister }));
    expect(text(busy.out)).toContain("2 sessions are running the previous version's memory server");
  });

  test("a lister that THROWS never fails the wiring", async () => {
    const c = consoleWith();
    const angry: ProcessLister = () => {
      throw new Error("no ps here");
    };
    const result = await wire(input({ io: c.io, lister: angry }));
    expect(result.outcome).toBe("ok");
  });
});

// ── unwire ──────────────────────────────────────────────────────────────────

describe("unwire", () => {
  test("nothing to unwire says so and touches nothing", async () => {
    const c = consoleWith();
    const fake = spawnerThat(() => OK);
    const result = await unwire(input({ io: c.io, spawner: fake.spawner }));
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("none");
    expect(fake.calls).toEqual([]);
    expect(text(c.out)).toContain("nothing to unwire");
  });

  test("`claude mcp remove` answering 'not found' is not a failure", async () => {
    await wire(input({ io: consoleWith().io }));
    writeFileSync(
      mcpFile(),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: EXE, args: ["run", MCP_SCRIPT] } } }),
    );
    const c = consoleWith();
    const result = await unwire(
      input({
        io: c.io,
        spawner: spawnerThat(() => ({ missing: false, code: 1, out: "", err: "No MCP server found" })).spawner,
      }),
    );
    expect(result.outcome).toBe("ok");
    expect(result.mcp).toBe("absent");
    expect(text(c.out)).toContain("was there to remove");
  });

  test("the remove is ATTEMPTED even when our read of ~/.claude.json saw nothing", async () => {
    // That file is the host's own state and may move; our read is evidence, not
    // authority. An unwire that skipped the removal because of where it looked
    // would leave a server pointed at a store nobody is wiring any more.
    await wire(input({ io: consoleWith().io }));
    expect(existsSync(mcpFile())).toBe(false);
    const fake = spawnerThat(() => OK);
    const result = await unwire(input({ io: consoleWith().io, spawner: fake.spawner }));
    expect(result.outcome).toBe("ok");
    expect(fake.calls).toEqual([["mcp", "remove", MCP_SERVER_NAME, "-s", "user"]]);
  });

  test("a console with no prompt and no --yes refuses rather than unwiring", async () => {
    await wire(input({ io: consoleWith().io }));
    const before = hashOf(settingsFile());
    const c = consoleWith(null);
    const result = await unwire(input({ io: c.io, yes: false }));
    expect(result.outcome).toBe("refused");
    expect(hashOf(settingsFile())).toBe(before);
  });
});

// ── through the console ─────────────────────────────────────────────────────

describe("`counterparts wire` on the command line", () => {
  /** An install, so there is a configuration for `wire` to read. */
  async function install(): Promise<void> {
    const c = consoleWith();
    const code = await run(
      ["install", "--config", configPath(), "--budget", "9000", "--name", "Ada"],
      { io: c.io, env: ENV, home },
    );
    expect(code).toBe(EXIT.ok);
  }

  test("with no configuration `wire` refuses and names the command that makes one", async () => {
    const c = consoleWith();
    const code = await run(["wire", "--config", configPath(), "--yes"], { io: c.io, env: ENV, home });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("install");
  });

  test("with no configuration `unwire` still works — it only ever takes things out", async () => {
    // The person most likely to run this is somebody who deleted
    // `~/.counterparts` by hand and now has five hooks firing at a store that
    // is gone. Refusing them would leave the mess the command exists to clean.
    await install();
    await run(["wire", "--config", configPath(), "--yes"], { io: consoleWith().io, env: ENV, home });
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    rmSync(join(home, ".counterparts"), { recursive: true, force: true });

    const c = consoleWith();
    const code = await run(["unwire", "--config", configPath(), "--yes"], {
      io: c.io,
      env: ENV,
      home,
    });
    expect(code).toBe(EXIT.ok);
    expect(readHost(home, home, ENV).events).toEqual([]);
  });

  test("it refuses --dir in words, and changes nothing", async () => {
    await install();
    for (const command of ["wire", "unwire", "uninstall"]) {
      const c = consoleWith();
      const code = await run([command, "--config", configPath(), "--dir", store(), "--yes"], {
        io: c.io,
        env: ENV,
        home,
      });
      expect(code).toBe(EXIT.refused);
      expect(text(c.err)).toContain("takes no --dir");
      expect(text(c.err)).toContain("Nothing has changed.");
    }
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("an unnamed configuration is refused while the explicit-dir guard is armed", async () => {
    const c = consoleWith();
    const code = await run(["wire", "--yes"], { io: c.io, env: ENV, home });
    expect(code).toBe(EXIT.refused);
  });

  test("under observer every one of the three refuses before anything is read", async () => {
    await install();
    for (const command of ["wire", "unwire", "uninstall"]) {
      const c = consoleWith();
      const code = await run([command, "--observer", "--config", configPath(), "--yes"], {
        io: c.io,
        env: ENV,
        home,
      });
      expect(code).toBe(EXIT.refused);
      expect(text(c.err)).toContain("observer stance");
    }
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("`wire --dry-run` on a real install writes nothing", async () => {
    await install();
    const c = consoleWith();
    const code = await run(["wire", "--config", configPath(), "--dry-run"], {
      io: c.io,
      env: ENV,
      home,
    });
    expect(code).toBe(EXIT.ok);
    expect(existsSync(settingsFile())).toBe(false);
  });
});

// ── install, as a conversation ──────────────────────────────────────────────

/**
 * The interactive arm of `counterparts install` — the path the owner will
 * actually take, and the only one in this package that edits a host after
 * asking.
 *
 * **Every test here injects `spawner` and `processes` through `RunOptions`.**
 * Without that seam a test that sets `io.tty` would reach whatever `claude` is
 * on the developer's PATH and run it against their own `~/.claude.json`. That
 * is the hermetic rule at one remove, and it is the reason those two options
 * exist at all.
 */
describe("install, at a terminal", () => {
  /** A console that says it IS a terminal, so `isInteractive` is true. */
  function terminal(answers: readonly string[]): Console_ {
    const c = consoleWith(answers);
    return { ...c, io: { ...c.io, tty: { stdin: true, stdout: true } } };
  }

  async function install(
    argv: readonly string[],
    answers: readonly string[],
    spawner: Spawner = spawnerThat(() => OK).spawner,
  ): Promise<Console_> {
    const c = terminal(answers);
    const code = await run(["install", "--config", configPath(), ...argv], {
      io: c.io,
      env: ENV,
      home,
      spawner,
      processes: noProcesses,
    });
    expect(code).toBe(EXIT.ok);
    return c;
  }

  test("it asks the name, asks to wire, and the host reads five hooks afterwards", async () => {
    const fake = spawnerThat(() => OK);
    const c = await install([], ["Ada", "y"], fake.spawner);
    expect(c.asked[0]).toContain("What should this memory call you?");
    expect(c.asked[1]).toContain("Wire Claude Code now?");

    const said = text(c.out);
    expect(said).toContain("[1/4]");
    expect(said).toContain("[4/4]");
    expect(said).toContain("Done");
    expect(said).toContain("Your memory is at");
    expect(said).toContain("Restart Claude Code");
    // The store was made, the core was seeded, and the host is wired.
    expect(existsSync(join(home, ".counterparts", "store"))).toBe(true);
    expect(said).toContain("identity core seeded for Ada");
    expect([...readHost(home, home, ENV).events].sort()).toEqual([...HOST_EVENTS].sort());
    expect(fake.calls[0]?.slice(0, 3)).toEqual(["mcp", "add", MCP_SERVER_NAME]);
  });

  test("an empty name goes on without a core, and says how to add one", async () => {
    const c = await install([], ["", "y"], spawnerThat(() => OK).spawner);
    const said = text(c.out);
    expect(said).toContain("No name");
    expect(said).toContain("--name");
    expect(said).not.toContain("identity core seeded");
  });

  test("a RE-RUN does not ask the name again, and says the store was kept", async () => {
    await install([], ["Ada", "y"], spawnerThat(() => OK).spawner);
    // The registration our first run made, as the host would have written it.
    writeFileSync(
      mcpFile(),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: process.execPath,
            args: ["run", MCP_SCRIPT],
            env: { COUNTERPARTS_DATA_DIR: store() },
          },
        },
      }),
    );
    const fake = spawnerThat(() => OK);
    const again = await install([], [], fake.spawner);
    // NOT asked: the core was seeded once and `--name` would not replace it.
    expect(again.asked.some((q) => q.includes("call you"))).toBe(false);
    const said = text(again.out);
    expect(said).toContain("store already here, kept");
    expect(said).toContain("already wired");
    // Nothing was registered a second time, and no second backup was taken.
    expect(fake.calls).toEqual([]);
    expect(backups()).toHaveLength(0);
  });

  test("a re-run does NOT repeat the ceiling sentence about a config it kept", async () => {
    const first = await install([], ["Ada", "y"], spawnerThat(() => OK).spawner);
    expect(text(first.out)).toContain("injection ceiling was set to 9000");
    const again = await install([], [], spawnerThat(() => OK).spawner);
    // `writeOnce` KEEPS the file, so saying it was written would be false about
    // the one file the hooks actually read.
    expect(text(again.out)).not.toContain("injection ceiling was set to");
  });

  test("a stale wiring is REPAIRED on a re-run, and the old path is named", async () => {
    await install([], ["Ada", "y"], spawnerThat(() => OK).spawner);
    // The install moved — an upgrade, a reinstall from another checkout.
    const stale = '"/old/bun" run "/gone/src/adapters/claude-code/bin/hook.ts"';
    writeSettingsFile({
      hooks: Object.fromEntries(
        HOST_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: stale }] }]]),
      ),
    });
    const again = await install([], ["y"], spawnerThat(() => OK).spawner);
    expect(text(again.out)).toContain("/gone/src/adapters/claude-code/bin/hook.ts");
    expect(readHost(home, home, ENV).stale).toEqual([]);
    expect(backups()).toHaveLength(1);
  });

  test("answering no leaves the host alone and says which command finishes it", async () => {
    const fake = spawnerThat(() => OK);
    const c = await install([], ["Ada", "n"], fake.spawner);
    expect(existsSync(settingsFile())).toBe(false);
    expect(fake.calls).toEqual([]);
    const said = text(c.out);
    expect(said).toContain("counterparts wire");
    // The store is made either way.
    expect(existsSync(join(home, ".counterparts", "store"))).toBe(true);
  });

  test("--yes wires without putting the question", async () => {
    const c = await install(["--yes", "--name", "Ada"], [], spawnerThat(() => OK).spawner);
    expect(c.asked).toEqual([]);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("--no-wire at a terminal is exactly today's behaviour: it prints, and edits nothing", async () => {
    const fake = spawnerThat(() => OK);
    const c = terminal([]);
    const code = await run(
      ["install", "--config", configPath(), "--no-wire", "--budget", "9000", "--name", "Ada"],
      { io: c.io, env: ENV, home, spawner: fake.spawner, processes: noProcesses },
    );
    expect(code).toBe(EXIT.ok);
    expect(c.asked).toEqual([]);
    const said = text(c.out);
    expect(said).toContain("Two steps left, and they are the HOST'S files");
    expect(said).toContain("claude mcp add counterparts -s user");
    expect(existsSync(settingsFile())).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  test("a console that is NOT a terminal never reaches the conversation", async () => {
    const fake = spawnerThat(() => OK);
    const c = consoleWith(["Ada", "y"]); // a prompt, but no `tty`
    const code = await run(["install", "--config", configPath(), "--budget", "9000"], {
      io: c.io,
      env: ENV,
      home,
      spawner: fake.spawner,
      processes: noProcesses,
    });
    expect(code).toBe(EXIT.ok);
    expect(c.asked).toEqual([]);
    expect(text(c.out)).toContain("Two steps left");
    expect(existsSync(settingsFile())).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  test("`claude` missing does not fail the install — the hooks are still in", async () => {
    const c = await install([], ["Ada", "y"], spawnerThat(() => MISSING).spawner);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    const said = text(c.out);
    expect(said).toContain("`claude` is not on this PATH");
    expect(said).toContain("Claude Code is wired");
  });
});

// ── small things that are load-bearing ──────────────────────────────────────

describe("the small helpers", () => {
  test("tilde shortens only what is under the home", () => {
    expect(tilde(join(home, ".claude", "settings.json"), home)).toBe("~/.claude/settings.json");
    expect(tilde("/etc/hosts", home)).toBe("/etc/hosts");
    expect(tilde(home, home)).toBe("~");
  });

  test("the backup name carries a UTC stamp with no colons in it", () => {
    const name = backupPath("/x/settings.json", Date.parse("2026-01-02T03:04:05.678Z"));
    expect(name).toBe("/x/settings.json.counterparts-backup-2026-01-02T03-04-05Z");
    expect(name).not.toContain(":");
  });

  test("userSettingsPath follows CLAUDE_CONFIG_DIR, exactly as doctor's reading does", () => {
    expect(userSettingsPath(home, {})).toBe(join(home, ".claude", "settings.json"));
    expect(userSettingsPath(home, { CLAUDE_CONFIG_DIR: "/moved" })).toBe(
      join("/moved", ".claude", "settings.json"),
    );
  });
});
