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
import { dirname, join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { CONFIG_FILE, HOST_EVENTS, MCP_SERVER_NAME, readHost } from "../src/adapters/cli/install.js";
import {
  DELETE_PHRASE,
  REMOVE_PACKAGE,
  censusOf,
  configDirRefusal,
  dirSize,
  grouped,
  humanBytes,
  memories,
  ownedKind,
  ownedNames,
  planUninstall,
  storeRefusal,
  uninstall,
} from "../src/adapters/cli/uninstall.js";
import type { UninstallInput } from "../src/adapters/cli/uninstall.js";
import { PARKED_INFIX } from "../src/adapters/cli/start-fresh.js";
import { Store } from "../src/core/store/index.js";
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
const noProcesses: ProcessLister = () => ({ looked: true, processes: [] });

function input(over: Partial<UninstallInput> = {}): UninstallInput {
  return {
    io: consoleWith().io,
    env: ENV,
    home,
    configPath: configPath(),
    custom: undefined,
    config: { dataDir: storePath() },
    now: Date.now(),
    yes: true,
    park: false,
    deleteMemories: false,
    nothingIsOpen: false,
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

/**
 * Hooks in the host's settings file, so there is something to unwire.
 *
 * THE SPAWNER AND THE LISTER ARE INJECTED, and that is not decoration: without
 * them `run()` builds the real ones, and `realSpawner` would invoke whatever
 * `claude` is on the developer's PATH against their own `~/.claude.json`. It
 * survived only because the environment this passes has no PATH in it, which is
 * luck rather than design.
 */
async function wireIt(): Promise<void> {
  const c = consoleWith();
  const code = await run(["wire", "--config", configPath(), "--yes"], {
    io: c.io,
    env: ENV,
    home,
    spawner: okSpawner,
    processes: noProcesses,
  });
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
      const dir = join(homedir(), root, "counterparts");
      const refusal = configDirRefusal(dir, join(dir, CONFIG_FILE), home, "park");
      expect(refusal).toContain("refused by name");
      expect(refusal).toContain(root);
    }
  });

  test("a SYMLINK into a forbidden root is refused on the path it REACHES", () => {
    const target = join(homedir(), ".bansai");
    mkdirSync(target, { recursive: true });
    const link = join(home, "innocent");
    symlinkSync(target, link);
    expect(configDirRefusal(link, join(link, CONFIG_FILE), home, "park")).toContain("refused by name");
    rmSync(target, { recursive: true, force: true });
  });

  test("the home directory and a filesystem root are refused", () => {
    expect(configDirRefusal(home, join(home, CONFIG_FILE), home, "park")).toContain("home directory");
    expect(configDirRefusal("/", join("/", CONFIG_FILE), home, "delete")).toContain("filesystem root");
  });

  test("a path outside the home is refused, and says whose responsibility it is", () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outside-"));
    made.push(outside);
    mkdirSync(join(outside, ".counterparts"), { recursive: true });
    writeFileSync(join(outside, ".counterparts", "claude-code.json"), "{}");
    const dir = join(outside, ".counterparts");
    expect(configDirRefusal(dir, join(dir, CONFIG_FILE), home, "delete")).toContain(
      "outside your home directory",
    );
  });

  test("a relative path is refused rather than resolved against a working directory", () => {
    expect(configDirRefusal("relative-thing", join("relative-thing", CONFIG_FILE), home, "park")).toContain("not an absolute path");
    // A blank path resolves to the working directory, which is outside the
    // test's home — the clause that catches it is the home test, not a
    // separate sentence.
    expect(configDirRefusal("   ", join("   ", CONFIG_FILE), home, "park")).not.toBeNull();
  });

  test("a SYMLINK is refused: renaming one moves the link and leaves the memories live", () => {
    const real = join(home, "real-base");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "claude-code.json"), "{}");
    const link = join(home, "linked-base");
    symlinkSync(real, link);
    expect(configDirRefusal(link, join(link, CONFIG_FILE), home, "park")).toContain("SYMBOLIC LINK");
  });

  test("a directory that does not hold claude-code.json is not one of ours", () => {
    const plain = join(home, "Documents");
    mkdirSync(plain, { recursive: true });
    const refusal = configDirRefusal(plain, join(plain, CONFIG_FILE), home, "delete");
    expect(refusal).toContain("claude-code.json");
    expect(refusal).toContain("not a Counterparts install");
  });

  test("a directory that is not there at all is refused, not created", () => {
    expect(
      configDirRefusal(join(home, "nowhere"), join(home, "nowhere", CONFIG_FILE), home, "park"),
    ).toContain("is not there");
    expect(existsSync(join(home, "nowhere"))).toBe(false);
  });

  test("a real install's base passes every clause", async () => {
    await install();
    expect(configDirRefusal(base(), configPath(), home, "park")).toBeNull();
  });

  // ── the four the BLOCKER added ──────────────────────────────────────────

  test("Claude Code's OWN configuration directory is refused by name", async () => {
    // The review pointed `--config` at `~/.claude` and watched this command
    // rename the host's settings, project transcripts and todos away under a
    // heading that said "Your memory, parked".
    const hostDir = join(home, ".claude");
    mkdirSync(join(hostDir, "projects", "myproj"), { recursive: true });
    writeFileSync(join(hostDir, "settings.json"), "{}");
    writeFileSync(join(hostDir, CONFIG_FILE), "{}");
    const refusal = configDirRefusal(hostDir, join(hostDir, CONFIG_FILE), home, "park");
    expect(refusal).toContain("Claude Code's own configuration directory");
  });

  test("a directory that CONTAINS the home directory is refused", () => {
    const above = join(home, "..");
    expect(configDirRefusal(above, join(above, CONFIG_FILE), home, "delete")).toContain(
      "CONTAINS your home directory",
    );
  });

  test("a directory holding a .git is refused — somebody is working in it", () => {
    const repo = join(home, "someproject");
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, CONFIG_FILE), "{}");
    expect(configDirRefusal(repo, join(repo, CONFIG_FILE), home, "delete")).toContain(".git");
  });

  test("the STORE gets the same ring, wherever it lives", async () => {
    await install();
    expect(storeRefusal(storePath(), home, "park")).toBeNull();
    // Outside the home.
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outstore-"));
    made.push(outside);
    expect(storeRefusal(outside, home, "delete")).toContain("outside your home directory");
    // Inside the home but not a store.
    const plain = join(home, "notastore");
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "a.txt"), "x");
    expect(storeRefusal(plain, home, "delete")).toContain("does not look like a Counterparts store");
    // A live v1 store, by name.
    expect(storeRefusal(join(homedir(), ".bansai", "store"), home, "park")).toContain(
      "refused by name",
    );
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
    if (census.kind === "memories") expect(census.memories).toBeGreaterThanOrEqual(3);
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
    const busy: ProcessLister = () => ({
      looked: true,
      processes: [
        { pid: 7, what: "an MCP server", command: "bun run serve.ts" },
      ],
    });
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
    const busy: ProcessLister = () => ({
      looked: true,
      processes: [
        { pid: 41, what: "an MCP server", command: "bun run serve.ts" },
        { pid: 42, what: "the worker", command: "bun run runner.ts" },
      ],
    });
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

  test("a look that DID NOT HAPPEN refuses, and --nothing-is-open is the way through", async () => {
    // Review M3. `realProcessLister` used to answer `[]` for a missing `ps`, a
    // timeout and a sandbox that refuses process listing, so "I could not look"
    // and "nothing is running" were the same answer — and the destructive verb
    // took it. Reproduced before this was written: a box with no `ps` at all
    // parked a store and said nothing about not having checked.
    await install();
    const angry: ProcessLister = () => {
      throw new Error("no ps");
    };
    const blind: ProcessLister = () => ({ looked: false, processes: [] });

    for (const lister of [angry, blind]) {
      const c = consoleWith();
      expect(await uninstall(input({ io: c.io, park: true, lister }))).toBe("refused");
      expect(text(c.err)).toContain("could not check whether anything of ours is still running");
      expect(text(c.err)).toContain("--nothing-is-open");
      expect(existsSync(base())).toBe(true);
    }

    // The override, which is an assertion about the world rather than a way
    // past a check that FOUND something.
    const ok = consoleWith();
    expect(
      await uninstall(input({ io: ok.io, park: true, lister: blind, nothingIsOpen: true })),
    ).toBe("ok");
    expect(existsSync(base())).toBe(false);
  });

  test("--nothing-is-open never excuses a check that DID find something", async () => {
    await install();
    const busy: ProcessLister = () => ({
      looked: true,
      processes: [{ pid: 3, what: "an MCP server", command: "bun run serve.ts" }],
    });
    const c = consoleWith();
    expect(
      await uninstall(input({ io: c.io, park: true, lister: busy, nothingIsOpen: true })),
    ).toBe("refused");
    expect(text(c.err)).toContain("an MCP server, pid 3");
    expect(existsSync(base())).toBe(true);
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

  test("a store with NO memories never headlines a bare zero", async () => {
    // A fresh install holds an identity core and no memories, so the whole
    // warning used to be "this will delete 0 memories." while the store went.
    await install();
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");
    const warning = c.out.find((l) => l.includes("WARNING: this will delete")) as string;
    expect(warning).toContain("your whole store");
    expect(warning).toContain("no memories in it yet");
    expect(warning).not.toContain("0 memories");
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
    const busy: ProcessLister = () => ({
      looked: true,
      processes: [{ pid: 9, what: "a dashboard", command: "bun run dashboard.ts" }],
    });
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

// ── the 2026-09-21 adversarial review ───────────────────────────────────────

/**
 * BLOCKER 1, both repros, and the shape that replaced them.
 *
 * The review pointed `--config` at `~/.claude` and watched `--park` rename
 * Claude Code's settings, project transcripts and todos away; then pointed one
 * at `~/Documents` and watched `--delete-memories` destroy `taxes/` and
 * `photos/` after warning about ONE memory. Both were reproduced again before
 * the fix was written.
 *
 * What replaced "the directory the configuration sits in" is an explicit list
 * of names this package writes, so these tests are all the same question asked
 * of different directories: **does anything that is not ours survive?**
 */
describe("B1 — only what this package wrote", () => {
  /** An install whose configuration sits in a directory holding other things. */
  async function installIn(dir: string, foreign: readonly string[]): Promise<string> {
    mkdirSync(dir, { recursive: true });
    for (const name of foreign) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `the contents of ${name}\n`);
    }
    const config = join(dir, CONFIG_FILE);
    const c = consoleWith();
    expect(
      await run(["install", "--config", config, "--budget", "9000", "--name", "S"], {
        io: c.io,
        env: ENV,
        home,
      }),
    ).toBe(EXIT.ok);
    return config;
  }

  function planFor(config: string): ReturnType<typeof planUninstall> {
    return planUninstall({
      configPath: config,
      config: { dataDir: join(dirname(config), "store") },
      home,
      verb: "delete",
    });
  }

  test("the plan names our entries and NOT the foreign ones", async () => {
    const dir = join(home, "Documents");
    const config = await installIn(dir, ["taxes/2025.pdf", "photos/a.jpg", "notes.txt"]);
    const plan = planFor(config);
    expect(plan.refusal).toBeNull();
    expect([...plan.foreign].sort()).toEqual(["notes.txt", "photos", "taxes"]);
    expect(plan.wholeDirectory).toBe(false);
    const paths = plan.entries.map((e) => e.path).sort();
    expect(paths).toEqual(
      [join(dir, "store"), join(dir, CONFIG_FILE), join(dir, "credentials.env")].sort(),
    );
  });

  test("--delete-memories leaves every foreign file byte for byte, and the directory", async () => {
    const dir = join(home, "Documents");
    const config = await installIn(dir, ["taxes/2025.pdf", "photos/a.jpg"]);
    const before = fingerprint(join(dir, "taxes")) + "|" + fingerprint(join(dir, "photos"));

    const c = consoleWith([DELETE_PHRASE]);
    expect(
      await uninstall(
        input({
          io: c.io,
          configPath: config,
          config: { dataDir: join(dir, "store") },
          deleteMemories: true,
        }),
      ),
    ).toBe("ok");

    // OURS IS GONE.
    expect(existsSync(join(dir, "store"))).toBe(false);
    expect(existsSync(config)).toBe(false);
    expect(existsSync(join(dir, "credentials.env"))).toBe(false);
    // AND NOTHING ELSE IS.
    expect(existsSync(dir)).toBe(true);
    expect(fingerprint(join(dir, "taxes")) + "|" + fingerprint(join(dir, "photos"))).toBe(before);
    // The plan said so before the phrase was asked for.
    const said = text(c.out);
    expect(said).toContain("This will delete:");
    expect(said).toContain("itself STAYS");
    expect(said).toContain("taxes");
    expect(c.asked[0]).toContain(DELETE_PHRASE);
  });

  test("--park moves ours one by one and leaves the directory and its contents", async () => {
    const dir = join(home, "Documents");
    const config = await installIn(dir, ["taxes/2025.pdf"]);
    const before = fingerprint(join(dir, "taxes"));
    const c = consoleWith();
    expect(
      await uninstall(
        input({ io: c.io, configPath: config, config: { dataDir: join(dir, "store") }, park: true }),
      ),
    ).toBe("ok");
    expect(existsSync(dir)).toBe(true);
    expect(fingerprint(join(dir, "taxes"))).toBe(before);
    expect(existsSync(join(dir, "store"))).toBe(false);
    expect(readdirSync(dir).some((n) => n.startsWith(`store.${PARKED_INFIX}-`))).toBe(true);
    expect(readdirSync(dir).some((n) => n.startsWith(`${CONFIG_FILE}.${PARKED_INFIX}-`))).toBe(true);
  });

  test("a directory holding nothing but ours still moves as ONE rename", async () => {
    await install();
    const plan = planUninstall({
      configPath: configPath(),
      config: { dataDir: storePath() },
      home,
      verb: "park",
    });
    expect(plan.foreign).toEqual([]);
    expect(plan.wholeDirectory).toBe(true);
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true }))).toBe("ok");
    expect(existsSync(base())).toBe(false);
    expect(existsSync(`${base()}.${PARKED_INFIX}-${today()}`)).toBe(true);
  });

  test("the sidecars this package leaves do not make a directory foreign", async () => {
    await install();
    // What `start-fresh`, `wire` and `keys.ts` leave behind.
    writeFileSync(`${configPath()}.tmp`, "{}");
    writeFileSync(join(base(), "scopes.json"), "{}");
    mkdirSync(join(base(), "snapshots"), { recursive: true });
    mkdirSync(`${storePath()}.${PARKED_INFIX}-2026-09-01`, { recursive: true });
    const plan = planUninstall({
      configPath: configPath(),
      config: { dataDir: storePath() },
      home,
      verb: "park",
    });
    expect(plan.foreign).toEqual([]);
    expect(plan.wholeDirectory).toBe(true);
  });

  test("ownedKind knows ours from anybody's", () => {
    const owned = ownedNames(
      join(home, ".counterparts", CONFIG_FILE),
      { dataDir: join(home, ".counterparts", "store") },
      join(home, ".counterparts", "store"),
    );
    expect(ownedKind(CONFIG_FILE, owned)).toBe("config");
    expect(ownedKind("credentials.env", owned)).toBe("credentials");
    expect(ownedKind("scopes.json", owned)).toBe("scopes");
    expect(ownedKind("snapshots", owned)).toBe("snapshots");
    expect(ownedKind("store", owned)).toBe("store");
    expect(ownedKind(`${CONFIG_FILE}.tmp`, owned)).toBe("sidecar");
    expect(ownedKind("scopes.json.4821.tmp", owned)).toBe("sidecar");
    expect(ownedKind("store.parked-2026-09-01", owned)).toBe("sidecar");
    expect(ownedKind("store.blank-2026-09-01", owned)).toBe("sidecar");
    expect(ownedKind("store.new-991", owned)).toBe("sidecar");
    // And everything else is somebody's.
    for (const name of ["taxes", "settings.json", "projects", "todos", "notes.txt", ".git"]) {
      expect(ownedKind(name, owned)).toBeNull();
    }
  });

  test("a configuration whose credentials file lives ELSEWHERE does not claim a name here", () => {
    const owned = ownedNames(
      join(home, ".counterparts", CONFIG_FILE),
      { credentialsFile: join(home, "secrets", "keys.env") },
      null,
    );
    expect(owned.credentials).toBeNull();
    expect(ownedKind("credentials.env", owned)).toBeNull();
  });
});

/**
 * MAJOR 1 — the store lives where `dataDir` says, and that can be anywhere.
 *
 * The old code counted the store at `dataDir`, deleted the configuration
 * directory without it, and then said the memory was gone. Both halves of that
 * are lies a person acts on.
 */
describe("M1 — the store, wherever it is", () => {
  async function installElsewhere(): Promise<string> {
    const store = join(home, "elsewhere", "store");
    const c = consoleWith();
    expect(
      await run(
        ["install", "--config", configPath(), "--dir", store, "--budget", "9000", "--name", "S"],
        { io: c.io, env: ENV, home },
      ),
    ).toBe(EXIT.ok);
    expect(existsSync(store)).toBe(true);
    return store;
  }

  test("--delete-memories actually deletes it, and says so path by path", async () => {
    const store = await installElsewhere();
    const c = consoleWith([DELETE_PHRASE]);
    expect(
      await uninstall(input({ io: c.io, config: { dataDir: store }, deleteMemories: true })),
    ).toBe("ok");
    expect(existsSync(store)).toBe(false);
    expect(existsSync(base())).toBe(false);
    const said = text(c.out);
    expect(said).toContain(store);
    expect(said).toContain("is NOT inside that directory");
  });

  test("--park actually parks it, beside itself", async () => {
    const store = await installElsewhere();
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, config: { dataDir: store }, park: true }))).toBe("ok");
    expect(existsSync(store)).toBe(false);
    expect(readdirSync(join(home, "elsewhere")).some((n) => n.startsWith(`store.${PARKED_INFIX}-`))).toBe(
      true,
    );
  });

  test("a store that is not there is said, not claimed", async () => {
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");
    expect(text(c.out)).toContain("No memory was deleted");
  });

  test("a store outside the home REFUSES both arms rather than being left behind", async () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outstore-"));
    made.push(outside);
    await install();
    // A REAL store out there, so this is the refusal and not "nothing to do".
    const made_ = consoleWith();
    expect(
      await run(["init", "--dir", join(outside, "store"), "--name", "S"], {
        io: made_.io,
        env: ENV,
        home,
      }),
    ).toBe(EXIT.ok);
    for (const flags of [{ park: true }, { deleteMemories: true }]) {
      const c = consoleWith([DELETE_PHRASE]);
      expect(
        await uninstall(input({ io: c.io, config: { dataDir: join(outside, "store") }, ...flags })),
      ).toBe("refused");
      expect(existsSync(base())).toBe(true);
    }
  });
});

/** MAJOR 2 — the deregistration is confirmed, or nothing moves. */
describe("M2 — a registration that is still there blocks both arms", () => {
  /** `~/.claude.json` as a real `claude mcp add` leaves it. */
  function registration(): void {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: "bun",
            args: ["run", "/pkg/serve.ts"],
            env: { COUNTERPARTS_DATA_DIR: storePath() },
          },
        },
      }),
    );
  }

  test("`claude` missing, with a registration on disk, refuses BEFORE anything is touched", async () => {
    await install();
    await wireIt();
    registration();
    const missing: Spawner = () => ({ missing: true, code: null, out: "", err: "" });
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, spawner: missing }))).toBe("refused");
    expect(text(c.err)).toContain("`claude` is not on this PATH");
    // BEFORE anything: the hooks are still in and the directory is still there.
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    expect(existsSync(base())).toBe(true);
  });

  test("a `claude mcp remove` that fails with the registration still there blocks the move", async () => {
    await install();
    await wireIt();
    registration();
    // `mcp list` answers (the pre-flight passes); `mcp remove` does not.
    const angry: Spawner = (args) =>
      args[1] === "remove"
        ? { missing: false, code: 7, out: "", err: "could not write" }
        : { missing: false, code: 0, out: "", err: "" };
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, spawner: angry }))).toBe("refused");
    expect(text(c.err)).toContain("MCP registration is still there");
    expect(existsSync(base())).toBe(true);
  });

  test("a remove that fails but leaves NO registration is confirmed, and the move runs", async () => {
    await install();
    await wireIt();
    // No `~/.claude.json` at all: `claude` is angry, but there is provably
    // nothing registered, so there is nothing to be blocked on.
    const angry: Spawner = (args) =>
      args[1] === "remove"
        ? { missing: false, code: 7, out: "", err: "some other problem" }
        : { missing: false, code: 0, out: "", err: "" };
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, spawner: angry }))).toBe("ok");
    expect(existsSync(base())).toBe(false);
  });

  test("a `claude` that HANGS or is ANGRY refuses before anything is touched, too", async () => {
    // A `spawnSync` that timed out comes back `missing: false, code: null`, and
    // a `claude` that exits non-zero on a read-only `mcp list` will not manage
    // a removal either. Testing only `missing` let a hung binary through the
    // pre-flight, took the hooks out, and refused thirty seconds later.
    for (const probe of [
      { missing: false, code: null, out: "", err: "" },
      { missing: false, code: 9, out: "", err: "broken" },
    ] as const) {
      await install();
      await wireIt();
      registration();
      const c = consoleWith();
      expect(await uninstall(input({ io: c.io, park: true, spawner: () => probe }))).toBe(
        "refused",
      );
      expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
      expect(existsSync(base())).toBe(true);
      rmSync(base(), { recursive: true, force: true });
      rmSync(join(home, ".claude"), { recursive: true, force: true });
      rmSync(join(home, ".claude.json"), { force: true });
    }
  });

  test("an UNREADABLE ~/.claude.json blocks the moving arms rather than passing them", async () => {
    await install();
    await wireIt();
    writeFileSync(join(home, ".claude.json"), "{ not json");
    const missing: Spawner = () => ({ missing: true, code: null, out: "", err: "" });
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, spawner: missing }))).toBe("refused");
    expect(text(c.err)).toContain("could not be read");
    expect(existsSync(base())).toBe(true);
  });

  test("the plain uninstall is NOT blocked — it moves nothing", async () => {
    await install();
    await wireIt();
    registration();
    const missing: Spawner = () => ({ missing: true, code: null, out: "", err: "" });
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, spawner: missing }))).toBe("ok");
    expect(existsSync(base())).toBe(true);
  });
});

/** m5 and m6 — the number, and how it is taken. */
describe("the count", () => {
  test("it is the number `status` calls Memories, with the journal beside it", async () => {
    await install();
    await notes(3);
    const census = censusOf(base(), storePath());
    expect(census.kind).toBe("memories");
    if (census.kind !== "memories") return;

    // The same population, read the same way `status` reads it.
    const status = consoleWith();
    expect(await run(["status", "--dir", storePath()], { io: status.io, env: ENV, home })).toBe(
      EXIT.ok,
    );
    const line = status.out.find((l) => l.startsWith("Memories: ")) as string;
    const shown = Number(/^Memories: (\d+)/.exec(line)?.[1] ?? "-1");
    expect(census.memories).toBe(shown);
    expect(census.journal).toBeGreaterThanOrEqual(0);
  });

  test("beliefs, entities and the self page are NOT counted as memories", async () => {
    await install();
    // `--name` seeds the identity core, which is a schema row: `status` calls
    // it a belief, and the warning used to call it a memory.
    const census = censusOf(base(), storePath());
    expect(census.kind).toBe("memories");
    if (census.kind === "memories") expect(census.memories).toBe(0);
  });

  test("counting opens the store READ-ONLY: no lock is taken and nothing is written", async () => {
    await install();
    // An observer open refuses every write by construction; the proof that
    // matters here is that a SECOND reader can hold it at the same time, which
    // a writer open would have made a "database is locked" (the I38 shape).
    const other = Store.open({ dir: storePath(), observer: true });
    try {
      const census = censusOf(base(), storePath());
      expect(census.kind).toBe("memories");
    } finally {
      other.close();
    }
  });

  test("the plain uninstall creates nothing under a store that is not there", async () => {
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io }))).toBe("ok");
    expect(existsSync(storePath())).toBe(false);
  });
});
