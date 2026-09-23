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
import {
  HOOK_COMMAND_MARK,
  HOST_EVENTS,
  MCP_SCRIPT,
  MCP_SERVER_NAME,
  hookCommand,
  readHost,
} from "../src/adapters/cli/install.js";
import {
  BACKUP_INFIX,
  backupPath,
  isOurHookCommand,
  mcpAddArgs,
  mergeHooks,
  processMark,
  readMcp,
  sessionsNote,
  settingsBytes,
  sightSettings,
  sniffSettingsFormat,
  tilde,
  unparsedSettingsWhy,
  unwire,
  userSettingsPath,
  wire,
  writeSettings,
} from "../src/adapters/cli/wire.js";
import type { ProcessLister, SpawnResult, Spawner, WireInput } from "../src/adapters/cli/wire.js";
import { PromptAborted, ui } from "../src/adapters/cli/ui.js";

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

const noProcesses: ProcessLister = () => ({ looked: true, processes: [] });

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
    expect(text(second.out)).toContain("already connected");
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
    // The TAKEOVER is still said out loud; the ordinary "it is registered" line
    // is not, because the one `ok` below carries it (2026-09-22, finding #4).
    expect(text(c.out)).toContain("was already registered; replacing it");
    expect(text(c.out)).toContain("memory tools registered");
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

  test("a console with no prompt and no answer wires NOTHING and names the command that does", async () => {
    // `--yes` came OFF `connect` on 2026-09-22 — it does not ask any more, so
    // there is nothing to skip — and this arm is now only reachable from a
    // caller that asked for a question on a console that cannot put one
    // (`install`, off a terminal, is the one). The refusal names the command
    // whose whole meaning is "do it".
    const c = consoleWith(null);
    const result = await wire(input({ io: c.io, yes: false }));
    expect(result.outcome).toBe("refused");
    expect(existsSync(settingsFile())).toBe(false);
    expect(text(c.err)).toContain("counterparts connect");
  });

  test("a person who answers no gets nothing written, and the command still exits ok", async () => {
    const c = consoleWith(["n"]);
    const result = await wire(input({ io: c.io, yes: false }));
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("declined");
    expect(existsSync(settingsFile())).toBe(false);
    expect(c.asked[0]).toContain("Connect Claude Code now?");
  });

  test("the sessions sentence belongs to the CALLER now, and counts running servers when it can", async () => {
    // It used to print from inside `wire()`, which put it in the middle of
    // `install`'s screen two lines above install's own "restart Claude Code,
    // then run doctor" (2026-09-22, the owner's install screen). `wire()` is
    // silent about it; `sessionsNote` is exported and the console prints it
    // after a standalone `connect`.
    const quiet = consoleWith();
    await wire(input({ io: quiet.io }));
    expect(text(quiet.out)).not.toContain("Hooks start with your next turn");

    const said = consoleWith();
    sessionsNote(ui(said.io, ENV), noProcesses);
    expect(text(said.out)).toContain("Hooks start with your next turn");
    expect(text(said.out)).toContain("restart Claude Code");
    expect(text(said.out)).not.toContain("sessions are running");

    const busy = consoleWith();
    const lister: ProcessLister = () => ({
      looked: true,
      processes: [
        { pid: 11, what: "an MCP server", command: "bun run serve.ts" },
        { pid: 12, what: "an MCP server", command: "bun run serve.ts" },
      ],
    });
    sessionsNote(ui(busy.io, ENV), lister);
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
    expect(text(c.out)).toContain("nothing to disconnect");
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

describe("`counterparts connect` on the command line", () => {
  /** An install, so there is a configuration for `connect` to read. */
  async function install(): Promise<void> {
    const c = consoleWith();
    const code = await run(
      ["install", "--config", configPath(), "--budget", "9000", "--name", "Ada"],
      { io: c.io, env: ENV, home },
    );
    expect(code).toBe(EXIT.ok);
  }

  test("with no configuration `connect` refuses and names the command that makes one", async () => {
    const c = consoleWith();
    const code = await run(["connect", "--config", configPath()], { io: c.io, env: ENV, home });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("install");
  });

  test("with no configuration `disconnect` still works — it only ever takes things out", async () => {
    // The person most likely to run this is somebody who deleted
    // `~/.counterparts` by hand and now has five hooks firing at a store that
    // is gone. Refusing them would leave the mess the command exists to clean.
    await install();
    await run(["connect", "--config", configPath()], { io: consoleWith().io, env: ENV, home });
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    rmSync(join(home, ".counterparts"), { recursive: true, force: true });

    const c = consoleWith();
    const code = await run(["disconnect", "--config", configPath()], {
      io: c.io,
      env: ENV,
      home,
    });
    expect(code).toBe(EXIT.ok);
    expect(readHost(home, home, ENV).events).toEqual([]);
  });

  /**
   * NEITHER OF THEM ASKS, AND THAT IS THE POINT (2026-09-22, item 3).
   *
   * With one host known there is no menu and no confirmation: typing the verb
   * is the yes. The console passes `yes: true` into `wire()`/`unwire()` — which
   * still hold a question, for `install` — and `--yes` is not a flag either of
   * these commands takes any more, because there is nothing left to skip.
   */
  test("connect does it without asking, and disconnect undoes it without asking", async () => {
    await install();
    const on = consoleWith(null);
    expect(
      await run(["connect", "--config", configPath()], {
        io: on.io,
        env: ENV,
        home,
        spawner: spawnerThat(() => OK).spawner,
        processes: noProcesses,
      }),
    ).toBe(EXIT.ok);
    expect(on.asked).toEqual([]);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    expect(text(on.out)).toContain("Connecting Claude Code");
    expect(text(on.out)).toContain("connected — 5 hooks added to");
    // The caller's sentence about sessions that are open right now.
    expect(text(on.out)).toContain("Hooks start with your next turn");

    const off = consoleWith(null);
    expect(
      await run(["disconnect", "--config", configPath()], {
        io: off.io,
        env: ENV,
        home,
        spawner: spawnerThat(() => OK).spawner,
        processes: noProcesses,
      }),
    ).toBe(EXIT.ok);
    expect(off.asked).toEqual([]);
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(text(off.out)).toContain("Disconnecting Claude Code");
    expect(text(off.out)).toContain("hooks removed from");
    expect(text(off.out)).toContain("An open Claude Code session keeps working until you close it.");

    // `--yes` is not a flag either of them takes: nothing is asked.
    const stale = consoleWith();
    expect(
      await run(["connect", "--config", configPath(), "--yes"], { io: stale.io, env: ENV, home }),
    ).toBe(EXIT.refused);
    expect(text(stale.err)).toContain("unknown flag --yes");
  });

  test("the HOST may be named, and a host nobody has is refused with the one we know", async () => {
    await install();
    const named = consoleWith(null);
    expect(
      await run(["connect", "claude-code", "--config", configPath()], {
        io: named.io,
        env: ENV,
        home,
        spawner: spawnerThat(() => OK).spawner,
        processes: noProcesses,
      }),
    ).toBe(EXIT.ok);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);

    for (const command of ["connect", "disconnect"]) {
      const c = consoleWith();
      const code = await run([command, "cursor", "--config", configPath()], {
        io: c.io,
        env: ENV,
        home,
      });
      expect(code, command).toBe(EXIT.refused);
      expect(text(c.err), command).toContain("does not know a host called 'cursor'");
      expect(text(c.err), command).toContain("claude-code");
      expect(text(c.err), command).toContain("Nothing has changed.");
    }
  });

  test("the old spellings are gone, and refuse as unknown commands", async () => {
    // Neither `wire` nor `unwire` ever shipped — 0.1.0 has no such command — so
    // there is no compatibility to keep and no alias to maintain.
    for (const gone of ["wire", "unwire"]) {
      const c = consoleWith();
      expect(await run([gone, "--config", configPath()], { io: c.io, env: ENV, home }), gone).toBe(
        EXIT.usage,
      );
      expect(text(c.err), gone).toContain(`unknown command: ${gone}`);
    }
  });

  test("it refuses --dir in words, and changes nothing", async () => {
    await install();
    for (const command of ["connect", "disconnect", "uninstall"]) {
      const c = consoleWith();
      const code = await run([command, "--config", configPath(), "--dir", store()], {
        io: c.io,
        env: ENV,
        home,
      });
      expect(code, command).toBe(EXIT.refused);
      expect(text(c.err), command).toContain("takes no --dir");
      expect(text(c.err), command).toContain("Nothing has changed.");
    }
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("an unnamed configuration is refused while the explicit-dir guard is armed", async () => {
    const c = consoleWith();
    const code = await run(["connect"], { io: c.io, env: ENV, home });
    expect(code).toBe(EXIT.refused);
  });

  test("under observer every one of the three refuses before anything is read", async () => {
    await install();
    for (const command of ["connect", "disconnect", "uninstall"]) {
      const c = consoleWith();
      const code = await run([command, "--observer", "--config", configPath()], {
        io: c.io,
        env: ENV,
        home,
      });
      expect(code, command).toBe(EXIT.refused);
      expect(text(c.err), command).toContain("observer stance");
    }
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("`connect --dry-run` on a real install writes nothing", async () => {
    await install();
    const c = consoleWith();
    const code = await run(["connect", "--config", configPath(), "--dry-run"], {
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
  /**
   * A console that says it IS a terminal, so `isInteractive` is true.
   *
   * IT MUST ALSO SUPPLY `promptHidden` — the trap `ui.ts`'s own docstring
   * names. Without it `askHidden` REFUSES rather than falling back to the
   * echoing reader, which is rule 3 defending itself, and the key step would
   * abort every test here. `hidden` answers the two key prompts; empty is the
   * ordinary "skip", so these tests ask for no keys.
   */
  function terminal(answers: readonly string[], hidden: readonly string[] = []): Console_ {
    const c = consoleWith(answers);
    const queue = [...hidden];
    return {
      ...c,
      io: {
        ...c.io,
        tty: { stdin: true, stdout: true },
        promptHidden: async (): Promise<string> => queue.shift() ?? "",
      },
    };
  }

  /**
   * THE LOCAL TABLE, WHERE THE HOOKS WILL LOOK — pinned for every test here.
   * `install` checks for it on this arm (`commands.ts`, the "no keys" step),
   * and without the variable the answer would depend on whether the weights
   * package happens to be installed in this checkout's `node_modules`. A folder
   * with the table FILE in it is "found"; an empty folder is "not found".
   */
  function tableEnv(present: boolean): Record<string, string | undefined> {
    const dir = join(home, present ? "table" : "no-table");
    mkdirSync(dir, { recursive: true });
    if (present) writeFileSync(join(dir, "model.safetensors"), "");
    return { ...ENV, COUNTERPARTS_STATIC_WEIGHTS_DIR: dir };
  }

  async function install(
    argv: readonly string[],
    answers: readonly string[],
    spawner: Spawner = spawnerThat(() => OK).spawner,
    env: Record<string, string | undefined> = tableEnv(true),
  ): Promise<Console_> {
    const c = terminal(answers);
    const code = await run(["install", "--config", configPath(), ...argv], {
      io: c.io,
      env,
      home,
      spawner,
      processes: noProcesses,
    });
    expect(code).toBe(EXIT.ok);
    return c;
  }

  /**
   * THE SCREEN THE OWNER SIGNED OFF ON (docs/new-user-findings.md, "The
   * screens", 2026-09-22). The name, the greeting, the connection, the two key
   * questions, and two lines at the end — no step numbers, and nothing about
   * files being created.
   */
  test("it asks the name, connects Claude Code, and the host reads five hooks afterwards", async () => {
    const fake = spawnerThat(() => OK);
    const c = await install([], ["Ada"], fake.spawner);
    expect(c.asked[0]).toContain("What should this memory call you?");
    // THE CONNECT QUESTION IS GONE (item 9): connecting is what install does,
    // so the only questions left are the name and the two optional keys.
    expect(text(c.asked)).not.toContain("Connect Claude Code now?");

    const said = text(c.out);
    expect(said).toContain("Nice to meet you, Ada.");
    expect(said).toContain("Connecting Claude Code…");
    expect(said).toContain("Done. Your memory lives at ~/.counterparts.");
    expect(said).toContain("Restart Claude Code, then run `counterparts doctor`");
    // No step numbers, and no receipt for each file written.
    expect(said).not.toContain("[1/4]");
    expect(said).not.toContain("Created a store at");
    // The store was made, the core was seeded, and the host is wired.
    expect(existsSync(join(home, ".counterparts", "store"))).toBe(true);
    expect(
      (JSON.parse(readFileSync(configPath(), "utf8")) as { identity?: { name?: string } }).identity
        ?.name,
    ).toBe("Ada");
    expect([...readHost(home, home, ENV).events].sort()).toEqual([...HOST_EVENTS].sort());
    expect(fake.calls.some((call) => call.slice(0, 3).join(" ") === `mcp add ${MCP_SERVER_NAME}`)).toBe(true);
  });

  /**
   * "IT SHOULD BE ALL GREEN" IS A PROMISE (adversarial review M1). It used to
   * read `wired.hooks` alone, so an install whose `claude mcp add` had just
   * failed — warning and all, four lines up — still ended by telling the person
   * to expect a green doctor. Doctor is RED on that line.
   */
  test("a failed `claude mcp add` does not end with 'it should be all green'", async () => {
    const angry: Spawner = (args) =>
      args[0] === "mcp" && args[1] === "add"
        ? { missing: false, code: 1, out: "", err: "nope" }
        : OK;
    const c = await install([], ["Ada"], angry);
    const said = text(c.out);
    expect(said).not.toContain("it should be all green");
    expect(said).toContain("the memory tools are NOT registered");
    // The hooks DID land, and the screen says so rather than calling the whole
    // install a failure.
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    expect(said).toContain("Done. Your memory lives at");
  });

  /**
   * KEYLESS BY DEFAULT (roadmap C3, 2026-09-23). The name is the ONLY question:
   * no key is asked about — both are upgrades, added with `credentials set` —
   * and recall by meaning is switched on with the local table, which sends
   * nothing anywhere, so there is nothing to consent to.
   */
  test("the name is the only question: no key is asked about, and recall by meaning is on (static)", async () => {
    const c = await install([], ["Ada"], spawnerThat(() => OK).spawner);
    expect(c.asked).toHaveLength(1);
    const asked = text(c.asked);
    expect(asked).not.toContain("Anthropic");
    expect(asked).not.toContain("Voyage");
    expect(asked).not.toContain("key");
    const said = text(c.out);
    expect(said).not.toContain("Voyage");
    expect(said).toContain("it should be all green");
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    expect(body["embedder"]).toEqual({ enabled: true, kind: "static" });
    // The template is still written, 0600, holding no key.
    const creds = join(home, ".counterparts", "credentials.env");
    expect(existsSync(creds)).toBe(true);
    expect(readFileSync(creds, "utf8")).not.toMatch(/^[A-Z_]+=/m);
  });

  test("--no-embedder at a terminal leaves recall by meaning off, and still asks no key", async () => {
    const c = await install(["--no-embedder"], ["Ada"], spawnerThat(() => OK).spawner);
    expect(c.asked).toHaveLength(1);
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    expect(body["embedder"]).toEqual({ enabled: false, kind: "static" });
  });

  /**
   * THE TABLE NOT WHERE THE HOOKS WILL LOOK: said once, with the fix, and the
   * last line stops promising all green (review M1's rule — a promise needs
   * every half it depends on).
   */
  test("a table that cannot be found is WARNED about, with the fix, and 'all green' is not promised", async () => {
    const c = await install([], ["Ada"], spawnerThat(() => OK).spawner, tableEnv(false));
    const said = text([...c.out, ...c.err]);
    expect(said).toContain("its table was not found");
    expect(said).toContain("bun add -g counterparts-model-potion");
    expect(said).not.toContain("it should be all green");
    expect(said).toContain("everything but recall by meaning should be green");
    // The configuration still asks for it: the fix is the table, not the knob.
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    expect(body["embedder"]).toEqual({ enabled: true, kind: "static" });
  });

  /**
   * A RE-RUN KEEPS THE FILE IT FINDS (install rule 2): a 0.2.0 configuration
   * with no `embedder` block is not rewritten by a terminal re-run. It does not
   * need to be: an absent block reads as the local table at runtime
   * (`config.ts#resolveEmbedder`).
   */
  test("a re-run over a configuration with no embedder block leaves it exactly as it was", async () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    await install(["--no-embedder"], ["Ada"], spawnerThat(() => OK).spawner);
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    delete body["embedder"];
    writeFileSync(configPath(), `${JSON.stringify(body, null, 2)}\n`);
    const before = readFileSync(configPath(), "utf8");
    const again = await install([], [], spawnerThat(() => OK).spawner);
    expect(again.asked).toEqual([]);
    expect(readFileSync(configPath(), "utf8")).toBe(before);
    // …and a flag on that re-run is not silently dropped: it says it was not
    // used, and names the command that would use it (the `--name` rule).
    const flagged = await install(["--embedder"], [], spawnerThat(() => OK).spawner);
    expect(readFileSync(configPath(), "utf8")).toBe(before);
    const said = text([...flagged.out, ...flagged.err]).replace(/\s+/g, " ");
    expect(said).toContain("--embedder was not used");
    expect(said).toContain("install --force --embedder");
  });

  test("an empty name goes on without a core, and says how to add one", async () => {
    const c = await install([], [""], spawnerThat(() => OK).spawner);
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
    // The greeting a returning owner gets, with the name read out of the
    // CONFIGURATION rather than by opening the store.
    expect(said).toContain("Welcome back, Ada.");
    expect(said).toContain("already connected");
    // Nothing was registered a second time, and no second backup was taken —
    // and nothing was spawned at all, because `~/.claude` is there, so the
    // "is Claude Code on this machine" probe never runs.
    expect(fake.calls).toEqual([]);
    expect(backups()).toHaveLength(0);
  });

  /**
   * THE CEILING IS WRITTEN AND NOT EXPLAINED (item 10). The sentence about
   * `injectionBudgetBytes` left this screen for `help install`; the number
   * itself still lands in the file the hooks read, which is the half that
   * matters to somebody who is not reading the screen.
   */
  test("the ceiling is written into the config and never mentioned on screen", async () => {
    const first = await install([], ["Ada"], spawnerThat(() => OK).spawner);
    expect(text(first.out)).not.toContain("injectionBudgetBytes");
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    expect(body["injectionBudgetBytes"]).toBe(9000);
    const again = await install([], [], spawnerThat(() => OK).spawner);
    expect(text(again.out)).not.toContain("injectionBudgetBytes");
  });

  test("a stale wiring is REPAIRED on a re-run, and the old path is named", async () => {
    await install([], ["Ada"], spawnerThat(() => OK).spawner);
    // The install moved — an upgrade, a reinstall from another checkout.
    const stale = '"/old/bun" run "/gone/src/adapters/claude-code/bin/hook.ts"';
    writeSettingsFile({
      hooks: Object.fromEntries(
        HOST_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: stale }] }]]),
      ),
    });
    const again = await install([], [], spawnerThat(() => OK).spawner);
    expect(text(again.out)).toContain("/gone/src/adapters/claude-code/bin/hook.ts");
    expect(readHost(home, home, ENV).stale).toEqual([]);
    expect(backups()).toHaveLength(1);
  });

  /**
   * ITEM 9'S LAST CLAUSE: "Claude Code not on the machine: say so, move on."
   *
   * Neither `~/.claude` nor a `claude` on PATH. Nothing of the host's is
   * created — not even the directory — and the install is still an install.
   */
  test("no Claude Code on the machine: one line, no host files, and the store is still made", async () => {
    const fake = spawnerThat(() => MISSING);
    const c = await install([], ["Ada"], fake.spawner);
    const said = text(c.out);
    expect(said).toContain("Claude Code is not on this machine");
    expect(said).toContain("counterparts connect");
    expect(said).not.toContain("Connecting Claude Code…");
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(existsSync(settingsFile())).toBe(false);
    // It looked, and it looked exactly once.
    expect(fake.calls).toEqual([["--version"]]);
    // The store is made either way, and the last line does not tell somebody
    // to restart a program they do not have.
    expect(existsSync(join(home, ".counterparts", "store"))).toBe(true);
    expect(said).not.toContain("Restart Claude Code");
  });

  test("--name and --yes ask nothing at all — no key questions are left to ask", async () => {
    const c = await install(["--yes", "--name", "Ada"], [], spawnerThat(() => OK).spawner);
    expect(c.asked).toEqual([]);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("--no-connect at a terminal is exactly today's behaviour: it prints, and edits nothing", async () => {
    const fake = spawnerThat(() => OK);
    const c = terminal([]);
    const code = await run(
      ["install", "--config", configPath(), "--no-connect", "--budget", "9000", "--name", "Ada"],
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

  /**
   * CLAUDE CODE IS HERE, THE BINARY IS NOT ON THIS PATH. The directory is the
   * evidence that decides (`commands.ts#claudeCodeHere`), and it is the honest
   * one: a host's process environment is not a login shell's, so a `claude` we
   * cannot see may still be there for the person. The hooks — the half that
   * needs no binary — go in, and the registration line is printed.
   */
  test("`claude` missing does not fail the install — the hooks are still in", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    const c = await install([], ["Ada"], spawnerThat(() => MISSING).spawner);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    const said = text(c.out);
    expect(said).toContain("Connecting Claude Code…");
    expect(said).toContain("`claude` is not on this PATH");
    expect(said).toContain("Done. Your memory lives at");
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

// ── the 2026-09-21 adversarial review ───────────────────────────────────────

/**
 * m1 — a command that MENTIONS our hook is not a command we may rewrite.
 *
 * The review wrapped our hook two ways and lost both halves: `wire` replaced
 * `~/bin/log-start.sh && counterparts-hook` with ours alone, and `unwire`
 * deleted `/opt/mytool/bin/wrap --then counterparts-hook` outright. This file's
 * own promise is that nothing belonging to another tool is a candidate.
 */
describe("m1 — ours to rewrite, versus ours to report", () => {
  test("every command `wire` writes is matched by BOTH the strict test and doctor's mark", () => {
    // The direction that matters: a hook we installed can never read as
    // missing on the surface a person checks.
    for (const custom of [undefined, "/somewhere/else/claude-code.json"]) {
      const command = hookCommand(custom, EXE);
      expect(isOurHookCommand(command)).toBe(true);
      expect(HOOK_COMMAND_MARK.test(command)).toBe(true);
    }
    // And the installed shim, with and without the flag.
    for (const command of [
      "counterparts-hook",
      '/home/me/.bun/bin/counterparts-hook --config "/x/claude-code.json"',
    ]) {
      expect(isOurHookCommand(command)).toBe(true);
      expect(HOOK_COMMAND_MARK.test(command)).toBe(true);
    }
  });

  test("a wrapper is doctor's hook and NOT ours", () => {
    for (const command of [
      "$HOME/bin/log-start.sh && counterparts-hook",
      "/opt/mytool/bin/wrap --then counterparts-hook",
      "counterparts-hook ; echo done",
      "counterparts-hook | tee /tmp/log",
      '"/x/bun" run "/pkg/src/adapters/claude-code/bin/hook.ts" && notify',
      "counterparts-hook --config /x.json --and-then something",
    ]) {
      expect({ command, mark: HOOK_COMMAND_MARK.test(command) }).toEqual({ command, mark: true });
      expect({ command, ours: isOurHookCommand(command) }).toEqual({ command, ours: false });
    }
  });

  test("something else entirely is neither", () => {
    for (const command of ["/usr/local/bin/other-tool --hook", "echo hello"]) {
      expect(isOurHookCommand(command)).toBe(false);
    }
  });

  test("wire LEAVES a wrapper alone, names it, and adds ours beside it", async () => {
    const wrapper = { hooks: [{ type: "command", command: "/opt/wrap --then counterparts-hook", timeout: 20 }] };
    writeSettingsFile({ hooks: { SessionStart: [wrapper] } });
    const c = consoleWith();
    const result = await wire(input({ io: c.io }));
    expect(result.outcome).toBe("ok");
    const start = (readSettingsFile()["hooks"] as Record<string, unknown>)["SessionStart"] as unknown[];
    // Theirs, untouched — `timeout` and all — with ours appended after it.
    expect(start[0]).toEqual(wrapper);
    expect(start[1]).toEqual({ hooks: [{ type: "command", command: COMMAND() }] });
    const said = text(c.out);
    expect(said).toContain("run ours inside a longer command");
    expect(said).toContain("/opt/wrap --then counterparts-hook");
  });

  test("unwire LEAVES a wrapper alone rather than deleting the entry", async () => {
    const wrapper = { hooks: [{ type: "command", command: "/opt/wrap --then counterparts-hook" }] };
    writeSettingsFile({ hooks: { SessionStart: [wrapper] }, model: "opus" });
    const before = readSettingsFile();
    const c = consoleWith();
    expect((await unwire(input({ io: c.io }))).outcome).toBe("ok");
    // The whole document, deep-equal: `unwire` found nothing of ITS OWN here.
    expect(readSettingsFile()).toEqual(before);
    expect(text(c.out)).toContain("run ours inside a longer command");
  });

  test("a stale entry of OURS is still repaired — the strictness is about shape, not path", async () => {
    writeSettingsFile({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: '"/old/bun" run "/gone/src/adapters/claude-code/bin/hook.ts"' }] },
        ],
      },
    });
    const result = await wire(input({ io: consoleWith().io }));
    expect(result.hooks).toBe("repaired");
    const start = (readSettingsFile()["hooks"] as Record<string, unknown>)["SessionStart"] as unknown[];
    expect(start).toHaveLength(1);
  });
});

/** m2 and m3 — the two symlink holes. */
describe("m2, m3 — symlinks the guard did not see", () => {
  test("a DANGLING settings.json symlink refuses instead of replacing the link", () => {
    // `realpathDeep` cannot resolve a dangling link, so it used to hand back
    // the link's own path: `exists: false`, the out-of-home test compared the
    // link against itself, and the write renamed a regular file OVER the link.
    mkdirSync(join(home, ".claude"), { recursive: true });
    const target = join(home, "dotfiles", "settings.json"); // its directory does not exist
    symlinkSync(target, settingsFile());
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toContain("nothing is there");
    expect(sight.refusal).toContain(target);
    expect(lstatSync(settingsFile()).isSymbolicLink()).toBe(true);
  });

  test("a dangling symlink OUT of the home is refused on where it points", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync("/nowhere/at/all/settings.json", settingsFile());
    expect(sightSettings(settingsFile(), home).refusal).toContain("outside your home directory");
  });

  test("a symlinked ~/.claude DIRECTORY pointing out of the home is refused", async () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outside-claude-"));
    made.push(outside);
    symlinkSync(outside, join(home, ".claude"));
    const sight = sightSettings(settingsFile(), home);
    expect(sight.refusal).toContain("outside your home directory");
    const c = consoleWith();
    expect((await wire(input({ io: c.io }))).outcome).toBe("refused");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a symlinked ~/.claude INSIDE the home still works", async () => {
    const real = join(home, "dotfiles", "claude");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, join(home, ".claude"));
    expect((await wire(input({ io: consoleWith().io }))).outcome).toBe("ok");
    expect(existsSync(join(real, "settings.json"))).toBe(true);
  });
});

/** m8 — the short-circuit no longer hangs on one file the host owns. */
describe("m8 — an unreadable ~/.claude.json asks the host", () => {
  test("`claude mcp get` answering 0 means already registered", async () => {
    await wire(input({ io: consoleWith().io }));
    writeFileSync(mcpFile(), "{ not json");
    const fake = spawnerThat(() => OK); // `mcp get` exits 0 → registered
    const c = consoleWith();
    const result = await wire(input({ io: c.io, spawner: fake.spawner }));
    expect(result.mcp).toBe("already");
    expect(text(c.out)).toContain("already connected");
    expect(fake.calls.map((a) => a.slice(0, 2))).toEqual([["mcp", "get"]]);
  });

  test("`claude mcp get` answering non-zero means not wired, so it asks and adds", async () => {
    await wire(input({ io: consoleWith().io }));
    writeFileSync(mcpFile(), "{ not json");
    const fake = spawnerThat((args) =>
      args[1] === "get" ? { missing: false, code: 1, out: "", err: "not found" } : OK,
    );
    const result = await wire(input({ io: consoleWith().io, spawner: fake.spawner }));
    expect(result.outcome).toBe("ok");
    expect(fake.calls.map((a) => a[1])).toEqual(["get", "add"]);
  });
});

/** M2 — `unwire` says whether the deregistration is provable. */
describe("M2 — mcpConfirmed", () => {
  function registration(): void {
    writeFileSync(
      mcpFile(),
      JSON.stringify({
        mcpServers: { [MCP_SERVER_NAME]: { command: EXE, args: ["run", MCP_SCRIPT] } },
      }),
    );
  }

  test("a remove that exits 0 is confirmed", async () => {
    await wire(input({ io: consoleWith().io }));
    registration();
    const result = await unwire(input({ io: consoleWith().io }));
    expect(result.mcpConfirmed).toBe(true);
  });

  test("`claude` missing with a registration still on disk is NOT confirmed", async () => {
    await wire(input({ io: consoleWith().io }));
    registration();
    const result = await unwire(input({ io: consoleWith().io, spawner: spawnerThat(() => MISSING).spawner }));
    expect(result.mcpConfirmed).toBe(false);
    expect(result.mcp).toBe("printed");
  });

  test("`claude` missing with NOTHING registered is confirmed — there was nothing to do", async () => {
    await wire(input({ io: consoleWith().io }));
    expect(existsSync(mcpFile())).toBe(false);
    const result = await unwire(input({ io: consoleWith().io, spawner: spawnerThat(() => MISSING).spawner }));
    expect(result.mcpConfirmed).toBe(true);
  });

  test("an UNREADABLE ~/.claude.json is not an absent registration", async () => {
    // `readMcp` reports `present: false` for a file that will not parse, and
    // reading that as "nothing registered" confirmed a deregistration that
    // never happened — which is what the destructive arms gate on.
    await wire(input({ io: consoleWith().io }));
    writeFileSync(mcpFile(), "{ not json");
    const result = await unwire(
      input({ io: consoleWith().io, spawner: spawnerThat(() => MISSING).spawner }),
    );
    expect(result.mcpConfirmed).toBe(false);
  });

  test("a remove that exits non-zero with the registration still there is not confirmed", async () => {
    await wire(input({ io: consoleWith().io }));
    registration();
    const result = await unwire(
      input({
        io: consoleWith().io,
        spawner: spawnerThat(() => ({ missing: false, code: 7, out: "", err: "boom" })).spawner,
      }),
    );
    expect(result.mcpConfirmed).toBe(false);
  });
});

/** m4 — Ctrl-C is not an answer, at any of the conversation's questions. */
describe("m4 — a cancelled prompt exits non-zero and says what exists", () => {
  /** A terminal whose prompt aborts the way the real readline now does. */
  function aborting(after: number): Console_ {
    const c = consoleWith([]);
    let asked = 0;
    return {
      ...c,
      io: {
        ...c.io,
        tty: { stdin: true, stdout: true },
        promptHidden: async (): Promise<string> => "",
        prompt: async (question: string): Promise<string> => {
          c.asked.push(question);
          asked += 1;
          if (asked > after) throw new PromptAborted("interrupt", "cancelled.");
          return "Ada";
        },
      },
    };
  }

  test("at the NAME prompt: nothing was created, and it says so", async () => {
    const c = aborting(0);
    const code = await run(["install", "--config", configPath()], {
      io: c.io,
      env: ENV,
      home,
      spawner: spawnerThat(() => OK).spawner,
      processes: noProcesses,
    });
    expect(code).not.toBe(EXIT.ok);
    const said = text(c.out);
    expect(said).toContain("stopped; nothing else was changed");
    expect(said).toContain("No store was created");
    expect(existsSync(settingsFile())).toBe(false);
  });

  /**
   * THERE IS NO SECOND PROMPT ANY MORE. It was a key question until 2026-09-23
   * (roadmap C3: install asks about neither key), and before that the wiring
   * question (item 9). A console that would abort at a second question is
   * never asked one: the install finishes, and exits 0.
   */
  test("after the name, nothing else is asked — a second prompt that would abort is never reached", async () => {
    const c = aborting(1);
    const code = await run(["install", "--config", configPath()], {
      io: c.io,
      env: ENV,
      home,
      spawner: spawnerThat(() => OK).spawner,
      processes: noProcesses,
    });
    expect(code).toBe(EXIT.ok);
    expect(c.asked).toHaveLength(1);
    expect(text(c.out)).toContain("Done. Your memory lives at");
    expect(existsSync(join(home, ".counterparts", "store"))).toBe(true);
  });

  /**
   * `connect` HAS NO QUESTION TO CANCEL any more (2026-09-22, item 3), so the
   * third case this block used to hold — Ctrl-C at `wire`'s own prompt — is
   * unreachable through the console. What is still worth proving is that the
   * command does not ASK at all on a terminal that would have answered, and
   * that is asserted where the command lives ("`counterparts connect` on the
   * command line", above).
   */
});

// ── review n1: the file keeps its layout ────────────────────────────────────

/**
 * The first `wire` re-serialised the whole file: 4-space indent, tabs and CRLF
 * all came back 2-space + LF (content and unknown keys always survived, and a
 * backup was always taken). Now the indent, the line endings and the final
 * newline are read off the file and written back the same way.
 */
describe("review n1 — a settings file keeps its layout", () => {
  const BODY = { model: "opus", permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [FOREIGN] } };

  const layouts: readonly { name: string; indent: string; eol: string; final: boolean }[] = [
    { name: "four spaces", indent: "    ", eol: "\n", final: true },
    { name: "tabs", indent: "\t", eol: "\n", final: true },
    { name: "CRLF", indent: "  ", eol: "\r\n", final: true },
    { name: "no final newline", indent: "  ", eol: "\n", final: false },
  ];

  for (const layout of layouts) {
    test(`${layout.name}: connect and disconnect both write it back that way, and a second connect is a no-op`, async () => {
      mkdirSync(join(home, ".claude"), { recursive: true });
      const written = JSON.stringify(BODY, null, layout.indent).replace(/\n/g, layout.eol);
      writeFileSync(settingsFile(), layout.final ? `${written}${layout.eol}` : written);

      expect((await wire(input())).outcome).toBe("ok");
      const after = readFileSync(settingsFile(), "utf8");
      const value = JSON.parse(after) as Record<string, unknown>;
      // Exactly the bytes that layout gives the merged value — nothing else moved.
      const expected = JSON.stringify(value, null, layout.indent).replace(/\n/g, layout.eol);
      expect(after).toBe(layout.final ? `${expected}${layout.eol}` : expected);
      expect(value["model"]).toBe("opus");

      const hash = hashOf(settingsFile());
      expect((await wire(input())).outcome).toBe("ok");
      expect(hashOf(settingsFile())).toBe(hash);

      expect((await unwire(input())).outcome).toBe("ok");
      const back = readFileSync(settingsFile(), "utf8");
      const restored = JSON.stringify(BODY, null, layout.indent).replace(/\n/g, layout.eol);
      expect(back).toBe(layout.final ? `${restored}${layout.eol}` : restored);
    });
  }

  test("a file that is not there, empty, or one line (`{}`) gets two spaces, LF and a final newline", () => {
    expect(sniffSettingsFormat("{}")).toEqual({ indent: "  ", eol: "\n", finalNewline: true });
    expect(sniffSettingsFormat("{}\n")).toEqual({ indent: "  ", eol: "\n", finalNewline: true });
    expect(sniffSettingsFormat('{"model":"opus"}\r\n')).toEqual({ indent: "  ", eol: "\r\n", finalNewline: true });
    expect(settingsBytes({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  test("a layout nobody could have meant takes the default indent and keeps the line endings", () => {
    expect(sniffSettingsFormat('{\r\n \t"a": 1\r\n}\r\n')).toEqual({ indent: "  ", eol: "\r\n", finalNewline: true });
    expect(sniffSettingsFormat(`{\n${" ".repeat(12)}"a": 1\n}\n`).indent).toBe("  ");
  });

  test("ONE pasted CRLF line does not make the whole file CRLF — the majority decides (#188 review M1)", async () => {
    // The reviewer's repro: an LF file with one CRLF line. `includes("\r\n")`
    // turned every line CRLF on the next write — five endings changed where
    // master changed one.
    mkdirSync(join(home, ".claude"), { recursive: true });
    const raw = '{\n  "model": "opus",\r\n  "env": {\n    "A": "1"\n  }\n}\n';
    writeFileSync(settingsFile(), raw);
    expect((await wire(input())).outcome).toBe("ok");
    expect(readFileSync(settingsFile(), "utf8")).not.toContain("\r");
    expect((await unwire(input())).outcome).toBe("ok");
    const after = readFileSync(settingsFile(), "utf8");
    // Exactly one line ending changed: the odd one out, to the file's own LF.
    expect(after).toBe(raw.replace("\r\n", "\n"));
    const endings = (text: string): string[] => text.match(/\r\n|\r|\n/g) ?? [];
    const before = endings(raw);
    const now = endings(after);
    expect(now).toHaveLength(before.length);
    expect(now.filter((e, i) => e !== before[i])).toHaveLength(1);
  });

  test("a mostly-CRLF file stays CRLF, a bare-CR file stays CR, and a tie goes to LF", () => {
    expect(sniffSettingsFormat('{\r\n  "a": 1,\n  "b": 2\r\n}\r\n').eol).toBe("\r\n");
    expect(sniffSettingsFormat('{\r  "a": 1\r}\r')).toEqual({ indent: "  ", eol: "\r", finalNewline: true });
    expect(sniffSettingsFormat('{\r\n  "a": 1\n}').eol).toBe("\n");
    const bytes = settingsBytes({ a: 1 }, { indent: "  ", eol: "\r", finalNewline: true });
    expect(bytes).toBe('{\r  "a": 1\r}\r');
  });

  test("spaces after the last newline still mean the file ends in one (#188 review NIT)", () => {
    expect(sniffSettingsFormat('{\n  "a": 1\n}\n  ').finalNewline).toBe(true);
    expect(sniffSettingsFormat('{\n  "a": 1\n}').finalNewline).toBe(false);
  });

  test("a line break inside a string stays escaped under CRLF", () => {
    const bytes = settingsBytes({ a: "one\ntwo" }, { indent: "  ", eol: "\r\n", finalNewline: true });
    expect(bytes).toBe('{\r\n  "a": "one\\ntwo"\r\n}\r\n');
    expect(JSON.parse(bytes)).toEqual({ a: "one\ntwo" });
  });
});

// ── review n2: a refusal that says what it found ────────────────────────────

describe("review n2 — BOM, comments and trailing commas are named, and still refused", () => {
  const cases: readonly { name: string; bytes: string; says: string }[] = [
    { name: "a byte-order mark", bytes: '\uFEFF{\n  "model": "opus"\n}\n', says: "starts with a byte-order mark" },
    { name: "a // comment", bytes: '{\n  // mine\n  "model": "opus"\n}\n', says: "holds comments (// or /* */)" },
    { name: "a /* */ comment", bytes: '{\n  /* mine */\n  "model": "opus"\n}\n', says: "holds comments (// or /* */)" },
    { name: "a trailing comma", bytes: '{\n  "model": "opus",\n}\n', says: "has a comma just before a closing } or ]" },
  ];
  for (const k of cases) {
    test(`${k.name}: refused by name, with what to do, and not one byte changed`, async () => {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(settingsFile(), k.bytes);
      const before = hashOf(settingsFile());
      for (const verb of [wire, unwire]) {
        const c = consoleWith();
        expect((await verb(input({ io: c.io }))).outcome).toBe("refused");
        const said = text(c.err);
        expect(said).toContain(k.says);
        expect(said).toContain("run this again");
        expect(said).not.toContain("Unexpected");
      }
      expect(hashOf(settingsFile())).toBe(before);
      expect(backups()).toHaveLength(0);
    });
  }

  test("single quotes are named as single quotes — not as comments, even with a URL inside (#188 review M3)", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsFile(), "{'apiKeyHelper': 'curl https://x'}");
    const c = consoleWith();
    expect((await wire(input({ io: c.io }))).outcome).toBe("refused");
    const said = text(c.err);
    expect(said).toContain("uses single quotes");
    expect(said).toContain("plain JSON needs double quotes");
    expect(said).not.toContain("comments");
  });

  test("an apostrophe inside a comment is a comment, not a single-quoted string", () => {
    const why = unparsedSettingsWhy('{\n  // don\'t touch\n  "a": 1\n}\n') ?? "";
    expect(why).toContain("holds comments");
    expect(why).not.toContain("single");
  });

  test("comments AND single quotes are both named", () => {
    const why = unparsedSettingsWhy("{\n  // mine\n  'a': 1\n}\n") ?? "";
    expect(why).toContain("comments (// or /* */) and single-quoted strings");
  });

  test("a `//` inside a string is not a comment — a URL in a setting still parses and wires", async () => {
    writeSettingsFile({ apiKeyHelper: "curl https://example.com/key" });
    expect((await wire(input())).outcome).toBe("ok");
    expect(readSettingsFile()["apiKeyHelper"]).toBe("curl https://example.com/key");
  });

  test("anything else keeps the parser's own words", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsFile(), '{"hooks": oops}');
    const c = consoleWith();
    expect((await wire(input({ io: c.io }))).outcome).toBe("refused");
    expect(text(c.err)).toContain("does not parse as JSON");
  });
});

// ── review n3: the re-read after the question decides ───────────────────────

/**
 * `wire` and `unwire` re-read the file after the person answers and merge again
 * — but wrote on the FIRST plan's `changed`, so when another process had done
 * the same work during the question, they still took a backup and rewrote the
 * (identical) bytes. The re-read's plan decides now.
 */
describe("review n3 — the work done during the question is not done twice", () => {
  test("connect: hooks put in while the question was up → no write, no backup, 'already in'", async () => {
    writeSettingsFile({ model: "opus" });
    let wiredMeanwhile = "";
    const c = consoleWith();
    const io: Io = {
      ...c.io,
      prompt: async (question: string): Promise<string> => {
        c.asked.push(question);
        // Somebody else connects while this one is asking.
        const other = consoleWith();
        expect((await wire(input({ io: other.io }))).outcome).toBe("ok");
        wiredMeanwhile = hashOf(settingsFile());
        return "y";
      },
    };
    const backupsBefore = () => backups().length;
    const result = await wire(input({ io, yes: false }));
    expect(c.asked).toHaveLength(1);
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("already");
    expect(result.backup).toBeNull();
    expect(hashOf(settingsFile())).toBe(wiredMeanwhile);
    // One backup — the OTHER connect's — and none of ours.
    expect(backupsBefore()).toBe(1);
    expect(text(c.out)).toContain("already in place when the file was read again");
    expect(text(c.out)).toContain("hooks already in");
  });

  test("disconnect: hooks taken out while the question was up → no write, no backup", async () => {
    writeSettingsFile({ model: "opus" });
    expect((await wire(input())).outcome).toBe("ok");
    const beforeBackups = backups().length;
    let unwiredMeanwhile = "";
    const c = consoleWith();
    const io: Io = {
      ...c.io,
      prompt: async (question: string): Promise<string> => {
        c.asked.push(question);
        const other = consoleWith();
        expect((await unwire(input({ io: other.io }))).outcome).toBe("ok");
        unwiredMeanwhile = hashOf(settingsFile());
        return "y";
      },
    };
    const result = await unwire(input({ io, yes: false }));
    expect(result.outcome).toBe("ok");
    expect(result.hooks).toBe("none");
    expect(result.backup).toBeNull();
    expect(hashOf(settingsFile())).toBe(unwiredMeanwhile);
    // The other disconnect's backup, and none of ours.
    expect(backups().length).toBe(beforeBackups + 1);
    expect(text(c.out)).toContain("no Counterparts hooks were left in");
    expect(text(c.out)).not.toContain("hooks removed from");
  });
});
