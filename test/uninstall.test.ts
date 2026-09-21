/**
 * `counterparts uninstall` — leaving, and the memory that stays.
 *
 * The owner's ruling (2026-09-21) is three sentences, and these tests are those
 * three sentences:
 *
 *   1. **The default leaves `~/.counterparts` in place.** It takes the wiring
 *      out and says where the memory is. The directory is fingerprinted before
 *      and after, entry list included.
 *   2. **`--park` moves it aside under a dated name** — ONE rename, never a
 *      copy, never a delete, and the store is never opened. The `-2` collision
 *      case is here too, and the printed `mv` really is the way back.
 *   3. **`--delete-memories` counts first, warns with the number, and takes the
 *      phrase.** Anything but the exact phrase deletes nothing and exits
 *      non-zero. There is no `--yes` for it, and a console with no person is a
 *      refusal.
 *
 * Plus the guard ring: a path outside the home, the home itself, a symlink, a
 * directory that is not one of ours, a live store's root, and anything of ours
 * still running.
 *
 * Hermetic: a fresh temp HOME per test, removed in `afterEach`. No test runs
 * the real `claude` (the spawner is injected) and no test opens a real store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { HOST_EVENTS, MCP_SERVER_NAME, readHost } from "../src/adapters/cli/install.js";
import {
  DELETE_PHRASE,
  REMOVE_PACKAGE,
  baseRefusal,
  censusOf,
  dirSize,
  grouped,
  humanBytes,
  memories,
  uninstall,
} from "../src/adapters/cli/uninstall.js";
import type { UninstallInput } from "../src/adapters/cli/uninstall.js";
import { PARKED_INFIX } from "../src/adapters/cli/start-fresh.js";
import type { ProcessLister, SpawnResult, Spawner } from "../src/adapters/cli/wire.js";
import { DATABASE_FILE, dateOf } from "../src/core/store/index.js";

// ── the harness ─────────────────────────────────────────────────────────────

let home: string;
const made: string[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "counterparts-uninstall-"));
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

const base = (): string => join(home, ".counterparts");
const configPath = (): string => join(base(), "claude-code.json");
const storePath = (): string => join(base(), "store");
const settingsFile = (): string => join(home, ".claude", "settings.json");
const today = (): string => dateOf(Date.now());

const OK: SpawnResult = { missing: false, code: 0, out: "", err: "" };
const okSpawner: Spawner = () => OK;
const noProcesses: ProcessLister = () => [];

function input(over: Partial<UninstallInput> = {}): UninstallInput {
  return {
    io: consoleWith().io,
    env: ENV,
    home,
    configPath: configPath(),
    custom: undefined,
    dataDir: storePath(),
    now: Date.now(),
    yes: true,
    park: false,
    deleteMemories: false,
    exe: "/fake/bin/bun",
    spawner: okSpawner,
    lister: noProcesses,
    ...over,
  };
}

/** A real install, through the console, exactly as a stranger's would be. */
async function install(): Promise<void> {
  const c = consoleWith();
  const code = await run(["install", "--config", configPath(), "--budget", "9000", "--name", "Ada"], {
    io: c.io,
    env: ENV,
    home,
  });
  expect(code).toBe(EXIT.ok);
}

/** Real memories, so a count is a count of something. */
async function notes(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const c = consoleWith();
    expect(
      await run(["note", `a memory number ${String(i)} about espresso`, "--dir", storePath()], {
        io: c.io,
        env: ENV,
        home,
      }),
    ).toBe(EXIT.ok);
  }
}

/** Hooks in the host's settings file, so there is something to unwire. */
async function wireIt(): Promise<void> {
  const c = consoleWith();
  const code = await run(["wire", "--config", configPath(), "--yes"], { io: c.io, env: ENV, home });
  expect(code).toBe(EXIT.ok);
  expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
}

/**
 * Every byte and every entry name under a tree.
 *
 * `skipShm` is the same distinction `cli.test.ts` draws and
 * `start-fresh.test.ts` deliberately does not: a `-shm` moves whenever anything
 * OPENS the database, and the counting arms open it once, on purpose, to say
 * how many memories are there. So those use `skipShm`, and the `--park` arm —
 * which never opens anything at all — is held to the whole tree.
 */
function fingerprint(root: string, skipShm = false): string {
  const parts: string[] = [];
  const walk = (path: string, rel: string): void => {
    if (skipShm && rel.endsWith("-shm")) return;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      parts.push(`${rel}:MISSING`);
      return;
    }
    if (stat.isDirectory()) {
      const names = readdirSync(path).sort();
      parts.push(`${rel}/:[${names.filter((n) => !(skipShm && n.endsWith("-shm"))).join(",")}]`);
      for (const name of names) walk(join(path, name), `${rel}/${name}`);
      return;
    }
    parts.push(`${rel}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  };
  walk(root, "");
  return parts.join("|");
}

// ── the guard ring ──────────────────────────────────────────────────────────

describe("what may not be parked or deleted", () => {
  test("a directory inside a live v1 store is refused BY NAME", () => {
    // `forbiddenRoots()` hangs off `homedir()`, which `test/preload.ts` has
    // redirected into a temp tree — the real guard on a real path.
    for (const root of [".bansai", ".claude-engram"]) {
      const refusal = baseRefusal(join(homedir(), root, "counterparts"), home, "park");
      expect(refusal).toContain("refused by name");
      expect(refusal).toContain(root);
    }
  });

  test("a SYMLINK into a forbidden root is refused on the path it REACHES", () => {
    const target = join(homedir(), ".bansai");
    mkdirSync(target, { recursive: true });
    const link = join(home, "innocent");
    symlinkSync(target, link);
    expect(baseRefusal(link, home, "park")).toContain("refused by name");
    rmSync(target, { recursive: true, force: true });
  });

  test("the home directory and a filesystem root are refused", () => {
    expect(baseRefusal(home, home, "park")).toContain("home directory");
    expect(baseRefusal("/", home, "delete")).toContain("filesystem root");
  });

  test("a path outside the home is refused, and says whose responsibility it is", () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outside-"));
    made.push(outside);
    mkdirSync(join(outside, ".counterparts"), { recursive: true });
    writeFileSync(join(outside, ".counterparts", "claude-code.json"), "{}");
    expect(baseRefusal(join(outside, ".counterparts"), home, "delete")).toContain(
      "outside your home directory",
    );
  });

  test("a relative path is refused rather than resolved against a working directory", () => {
    expect(baseRefusal("relative-thing", home, "park")).toContain("not an absolute path");
    expect(baseRefusal("   ", home, "park")).toContain("nothing named one");
  });

  test("a SYMLINK is refused: renaming one moves the link and leaves the memories live", () => {
    const real = join(home, "real-base");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "claude-code.json"), "{}");
    const link = join(home, "linked-base");
    symlinkSync(real, link);
    expect(baseRefusal(link, home, "park")).toContain("SYMBOLIC LINK");
  });

  test("a directory that does not hold claude-code.json is not one of ours", () => {
    const plain = join(home, "Documents");
    mkdirSync(plain, { recursive: true });
    const refusal = baseRefusal(plain, home, "delete");
    expect(refusal).toContain("claude-code.json");
    expect(refusal).toContain("does not look like");
  });

  test("a directory that is not there at all is refused, not created", () => {
    expect(baseRefusal(join(home, "nowhere"), home, "park")).toContain("is not there");
    expect(existsSync(join(home, "nowhere"))).toBe(false);
  });

  test("a real install's base passes every clause", async () => {
    await install();
    expect(baseRefusal(base(), home, "park")).toBeNull();
  });
});

// ── the count ───────────────────────────────────────────────────────────────

describe("what the warning counts", () => {
  test("a store that opens is counted in memories", async () => {
    await install();
    await notes(3);
    const census = censusOf(base(), storePath());
    expect(census.kind).toBe("memories");
    // The identity core seeded by `--name` is a memory too, so this is a floor.
    if (census.kind === "memories") expect(census.n).toBeGreaterThanOrEqual(3);
  });

  test("an OLD-FLOOR store falls back to a SIZE, and names the refusal", async () => {
    await install();
    // Cut-over day, seen from here: the store holds the markers of a build
    // before this one's floor, and this build refuses it BY NAME. A warning
    // that said "0 memories" there would be the most dangerous sentence this
    // command could print.
    rmSync(join(storePath(), DATABASE_FILE), { force: true });
    writeFileSync(join(storePath(), "operational.sqlite"), "x".repeat(4096));
    const census = censusOf(base(), storePath());
    expect(census.kind).toBe("size");
    if (census.kind === "size") {
      expect(census.bytes).toBeGreaterThan(4000);
      expect(census.why).toContain("STORE_PRE_ROWS");
    }
  });

  test("a store whose LAYOUT will not open falls back to a size too", async () => {
    await install();
    // An unclassified top-level entry is refused at open (§5 G11).
    writeFileSync(join(storePath(), "something-nobody-classified"), "x".repeat(2048));
    const census = censusOf(base(), storePath());
    expect(census.kind).toBe("size");
    if (census.kind === "size") expect(census.why).toContain("would not open");
  });

  test("a directory with no store in it is never OPENED into one", () => {
    const empty = join(home, "no-store-here");
    mkdirSync(empty, { recursive: true });
    const census = censusOf(empty, join(empty, "store"));
    expect(census.kind).toBe("size");
    // `Store.open` CREATES what it opens, so nothing here may reach it.
    expect(existsSync(join(empty, "store"))).toBe(false);
  });

  test("the numbers are spelled the way the ruling spells them", () => {
    expect(grouped(1204)).toBe("1,204");
    expect(humanBytes(512)).toBe("512 bytes");
    expect(humanBytes(2048)).toBe("2.0 KB");
    expect(dirSize(join(home, "nothing-here"))).toBe(0);
  });
});

// ── the default: the memory stays ───────────────────────────────────────────

describe("uninstall, plain", () => {
  test("it unwires, leaves every byte of the memory, and names the one command left", async () => {
    await install();
    await notes(2);
    await wireIt();
    const before = fingerprint(base(), true);

    const c = consoleWith();
    const code = await uninstall(input({ io: c.io }));
    expect(code).toBe("ok");

    // The hooks are gone...
    expect(readHost(home, home, ENV).events).toEqual([]);
    // ...and not one byte of the memory moved.
    expect(fingerprint(base(), true)).toBe(before);

    const said = text(c.out);
    expect(said).toContain(base());
    expect(said).toContain("memories are still at");
    expect(said).toContain(REMOVE_PACKAGE);
    expect(said).toContain("--park");
  });

  test("a console with no person and no --yes refuses before anything is unwired", async () => {
    await install();
    await wireIt();
    const c = consoleWith(null);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("refused");
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("a person who says no changes nothing", async () => {
    await install();
    await wireIt();
    const c = consoleWith(["n"]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("it does NOT refuse while something is running — it changes no directory", async () => {
    await install();
    await wireIt();
    const busy: ProcessLister = () => [
      { pid: 7, what: "an MCP server", command: "bun run serve.ts" },
    ];
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, lister: busy }))).toBe("ok");
    expect(text(c.out)).toContain("keeps its hooks until its next turn");
  });
});

// ── --park ──────────────────────────────────────────────────────────────────

describe("uninstall --park", () => {
  test("ONE rename: the tree is byte-identical under the dated name, and the way back is printed", async () => {
    await install();
    await notes(2);
    await wireIt();
    const before = fingerprint(base());

    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true }))).toBe("ok");

    const parked = `${base()}.${PARKED_INFIX}-${today()}`;
    expect(existsSync(base())).toBe(false);
    expect(existsSync(parked)).toBe(true);
    expect(fingerprint(parked)).toBe(before);

    const said = text(c.out);
    expect(said).toContain(parked);
    // The guarded `mv`, and it really does put it back.
    const line = c.out.find((l) => l.trimStart().startsWith("if [ -e "));
    expect(line).toBeDefined();
    const ran = spawnSync("/bin/sh", ["-c", line as string], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: home },
    });
    expect(ran.status).toBe(0);
    expect(existsSync(base())).toBe(true);
    expect(fingerprint(base())).toBe(before);
  });

  test("the printed `mv` REFUSES rather than nesting when the destination exists", async () => {
    await install();
    const c = consoleWith();
    await uninstall(input({ io: c.io, park: true }));
    // Something reappears at the live name — a hook, a second install.
    mkdirSync(base(), { recursive: true });
    const line = c.out.find((l) => l.trimStart().startsWith("if [ -e ")) as string;
    const ran = spawnSync("/bin/sh", ["-c", line], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: home },
    });
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain("REFUSING");
    // And nothing was nested inside it.
    expect(readdirSync(base())).toEqual([]);
  });

  test("a name already taken becomes -2 rather than a merge", async () => {
    await install();
    mkdirSync(`${base()}.${PARKED_INFIX}-${today()}`, { recursive: true });
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true }))).toBe("ok");
    expect(existsSync(`${base()}.${PARKED_INFIX}-${today()}-2`)).toBe(true);
    // The one that was already there is untouched and still empty.
    expect(readdirSync(`${base()}.${PARKED_INFIX}-${today()}`)).toEqual([]);
  });

  test("it REFUSES while anything of ours is running, and names what", async () => {
    await install();
    await wireIt();
    const busy: ProcessLister = () => [
      { pid: 41, what: "an MCP server", command: "bun run serve.ts" },
      { pid: 42, what: "the worker", command: "bun run runner.ts" },
    ];
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, lister: busy }))).toBe("refused");
    const said = text(c.err);
    expect(said).toContain("an MCP server, pid 41");
    expect(said).toContain("the worker, pid 42");
    expect(said).toContain("Close Claude Code sessions and try again.");
    // AND THE HOOKS ARE STILL THERE: the refusal precedes the unwire.
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    expect(existsSync(base())).toBe(true);
  });

  test("a lister that throws is no evidence, and does not block the park", async () => {
    await install();
    const angry: ProcessLister = () => {
      throw new Error("no ps");
    };
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, lister: angry }))).toBe("ok");
  });
});

// ── --delete-memories ───────────────────────────────────────────────────────

describe("uninstall --delete-memories", () => {
  test("it counts first, warns with the number, takes the phrase, and then deletes", async () => {
    await install();
    await notes(4);
    await wireIt();
    const census = censusOf(base(), storePath());
    expect(census.kind).toBe("memories");

    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");

    const said = text(c.out);
    expect(said).toContain("WARNING: this will delete");
    expect(said).toContain("memories.");
    expect(c.asked[0]).toContain(DELETE_PHRASE);
    expect(existsSync(base())).toBe(false);
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(said).toContain(REMOVE_PACKAGE);
  });

  test("the warning carries the count the ruling asks for, spelled with a comma", async () => {
    await install();
    await notes(3);
    const c = consoleWith([DELETE_PHRASE]);
    await uninstall(input({ io: c.io, deleteMemories: true }));
    const warning = c.out.find((l) => l.includes("WARNING: this will delete")) as string;
    expect(warning).toMatch(/WARNING: this will delete [\d,]+ memories\./);

    // AND IT IS SINGULAR WHEN IT IS ONE. A brand-new install holds exactly one
    // memory — its identity core — so "1 memories" was what a person leaving
    // after five minutes actually read (found on a pty, 2026-09-21).
    expect(memories(1)).toBe("1 memory");
    expect(memories(1204)).toBe("1,204 memories");
  });

  test("ANYTHING but the exact phrase deletes nothing, changes nothing, and exits non-zero", async () => {
    await install();
    await notes(2);
    await wireIt();
    const before = fingerprint(base(), true);
    for (const wrong of ["delete memories", "DELETE MEMORIES ", "yes", "", "DELETE  MEMORIES"]) {
      const c = consoleWith([wrong]);
      expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("refused");
      expect(text(c.err)).toContain("Nothing was deleted");
      // Not one byte, and the hooks are still in: the phrase is asked BEFORE
      // anything at all is taken out.
      expect(fingerprint(base(), true)).toBe(before);
      expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    }
  });

  test("there is no --yes for it: a console with no person refuses and says why", async () => {
    await install();
    await wireIt();
    const c = consoleWith(null);
    expect(await uninstall(input({ io: c.io, deleteMemories: true, yes: true }))).toBe("refused");
    expect(text(c.err)).toContain("has no --yes");
    expect(existsSync(base())).toBe(true);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("it refuses while anything of ours is running, before the count is even taken", async () => {
    await install();
    const busy: ProcessLister = () => [{ pid: 9, what: "a dashboard", command: "bun run dashboard.ts" }];
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true, lister: busy }))).toBe("refused");
    expect(existsSync(base())).toBe(true);
    expect(c.asked).toEqual([]);
  });

  test("a store that will not open still gets a warning, with a size and the reason", async () => {
    await install();
    writeFileSync(join(storePath(), "something-nobody-classified"), "not part of the layout");
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");
    const said = text(c.out);
    expect(said).toContain("WARNING: this will delete");
    expect(said).toContain("The count could not be taken");
    expect(existsSync(base())).toBe(false);
  });

  test("--park and --delete-memories together are refused rather than guessed at", async () => {
    await install();
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, park: true, deleteMemories: true }))).toBe("refused");
    expect(text(c.err)).toContain("two answers to one question");
    expect(existsSync(base())).toBe(true);
  });

  test("it will not delete a directory that is not one of ours", async () => {
    // A configuration pointed at a directory holding no `claude-code.json` —
    // which is exactly what `--config /somewhere/else.json` on a typo produces.
    const plain = join(home, "Documents");
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "taxes.pdf"), "important");
    const c = consoleWith([DELETE_PHRASE]);
    expect(
      await uninstall(input({ io: c.io, deleteMemories: true, configPath: join(plain, "x.json") })),
    ).toBe("refused");
    expect(existsSync(join(plain, "taxes.pdf"))).toBe(true);
  });
});

// ── through the console ─────────────────────────────────────────────────────

describe("`counterparts uninstall` on the command line", () => {
  test("it acts on the configuration it is given, and unwires through the real dispatch", async () => {
    await install();
    await wireIt();
    const c = consoleWith(["y"]);
    const code = await run(["uninstall", "--config", configPath()], { io: c.io, env: ENV, home });
    expect(code).toBe(EXIT.ok);
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(existsSync(base())).toBe(true);
    expect(text(c.out)).toContain(REMOVE_PACKAGE);
  });

  test("with no configuration it refuses rather than deciding what to remove", async () => {
    const c = consoleWith();
    const code = await run(["uninstall", "--config", configPath(), "--yes"], {
      io: c.io,
      env: ENV,
      home,
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("no configuration");
  });

  test("--delete-memories from a non-interactive console exits non-zero and deletes nothing", async () => {
    await install();
    const c = consoleWith(null);
    const code = await run(["uninstall", "--config", configPath(), "--delete-memories"], {
      io: c.io,
      env: ENV,
      home,
    });
    expect(code).toBe(EXIT.refused);
    expect(existsSync(base())).toBe(true);
  });

  test("the MCP deregistration goes out through `claude mcp remove`, never by editing the file", async () => {
    await install();
    await wireIt();
    // The registration `wire` would have made, as the host writes it.
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "x", args: [] } } }),
    );
    const before = readFileSync(join(home, ".claude.json"), "utf8");
    const calls: string[][] = [];
    const c = consoleWith();
    await uninstall(
      input({
        io: c.io,
        spawner: (args) => {
          calls.push([...args]);
          return OK;
        },
      }),
    );
    expect(calls).toEqual([["mcp", "remove", MCP_SERVER_NAME, "-s", "user"]]);
    // We never write that file ourselves.
    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(before);
  });

  test("somebody else's hooks survive an uninstall untouched", async () => {
    await install();
    const foreign = {
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "/opt/other --go" }] }],
      },
      model: "opus",
    };
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsFile(), `${JSON.stringify(foreign, null, 2)}\n`);
    await wireIt();
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io }))).toBe("ok");
    expect(JSON.parse(readFileSync(settingsFile(), "utf8"))).toEqual(foreign);
  });
});
