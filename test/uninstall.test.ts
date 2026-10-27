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
 *      case is here too, and the screen names the destination before it asks.
 *   3. **`--delete-memories` counts first, warns, and takes the phrase.**
 *      Anything but the exact phrase deletes nothing and exits non-zero; Esc,
 *      an empty Enter and `cancel` stop it and exit 0. There is no `--yes` for
 *      it, and a console with no person is a refusal.
 *
 * Both screens are the ones the owner drew on 2026-09-22
 * (`docs/new-user-findings.md` §"The screens"), and a rendered screen is the
 * acceptance criterion: `~/…` paths, the count on the line of the thing it
 * counts, a plain red WARNING, and the way back as a command rather than a
 * pasted shell line.
 *
 * Plus the guard ring: a path outside the home, the home itself, a symlink, a
 * directory that is not one of ours, a live store's root, and anything of ours
 * still running.
 *
 * Hermetic: a fresh temp HOME per test, removed in `afterEach`. No test runs
 * the real `claude` (the spawner is injected) and no test opens a real store.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { CONFIG_FILE, HOST_EVENTS, MCP_SERVER_NAME, readHost } from "../src/adapters/cli/install.js";
import {
  CHECKING_CLAUDE_CODE,
  DELETE_PHRASE,
  DELETE_QUESTION,
  PHRASE_PROMPT,
  LOG_WORTH_SAYING,
  PLUGIN_BEFORE_REOPEN,
  PLUGIN_ID_FALLBACK,
  REMOVE_PACKAGE,
  REMOVE_PLUGIN,
  censusOf,
  configDirRefusal,
  dirSize,
  grouped,
  humanBytes,
  logClause,
  memories,
  ownedKind,
  ownedNames,
  planLines,
  planUninstall,
  storeRefusal,
  uninstall,
  uninstallJson,
  walBytes,
} from "../src/adapters/cli/uninstall.js";
import { SESSIONS_DIR } from "../src/adapters/sessions.js";
import type { UninstallInput } from "../src/adapters/cli/uninstall.js";
import { PARKED_INFIX } from "../src/adapters/cli/start-fresh.js";
import { PROMPT_CANCEL } from "../src/adapters/cli/ui.js";
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
  const code = await run(["connect", "--config", configPath()], {
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
    // The npm install's wiring marker (`npm-live.ts`) is host state, not memory: `connect` writes it and the unwire removes it.
    if (/\/npm-live(\.[0-9a-f]{8})?\.json$/.test(rel)) return;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      parts.push(`${rel}:MISSING`);
      return;
    }
    if (stat.isDirectory()) {
      const names = readdirSync(path).sort();
      parts.push(`${rel}/:[${names.filter((n) => !(skipShm && n.endsWith("-shm")) && !/^npm-live(\.[0-9a-f]{8})?\.json$/.test(n)).join(",")}]`);
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

  test("…and so is the directory CLAUDE_CONFIG_DIR moved it to (review of #337)", () => {
    const moved = join(home, ".claude-work");
    mkdirSync(join(moved, "projects", "myproj"), { recursive: true });
    writeFileSync(join(moved, "settings.json"), "{}");
    writeFileSync(join(moved, CONFIG_FILE), "{}");
    const env = { CLAUDE_CONFIG_DIR: moved };
    expect(configDirRefusal(moved, join(moved, CONFIG_FILE), home, "park", env)).toContain(
      "Claude Code's own configuration directory",
    );
    // Through the plan too, which is what `uninstall` asks.
    const plan = planUninstall({ configPath: join(moved, CONFIG_FILE), config: {}, home, verb: "park", env });
    expect(plan.refusal).toContain("Claude Code's own configuration directory");
    // With no variable the same folder is just a folder: the guard is the
    // host's directory, wherever it is, and nothing wider.
    expect(configDirRefusal(moved, join(moved, CONFIG_FILE), home, "park", {})).toBeNull();
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

  test("the numbers are spelled the way the screen spells them", () => {
    expect(grouped(1204)).toBe("1,204");
    expect(humanBytes(214)).toBe("214 B");
    expect(humanBytes(2048)).toBe("2.0 KB");
    // One decimal below ten and none at or above it: these sit in a column
    // beside each other, and `913.0 KB` spends four characters saying nothing.
    expect(humanBytes(934912)).toBe("913 KB");
    expect(humanBytes(7025459)).toBe("6.7 MB");
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
    // `~/…` on screen (item 13), and the absolute path nowhere on it.
    expect(said).toContain("~/.counterparts/store");
    expect(said).not.toContain(base());
    expect(said).toContain("memories are still at");
    expect(said).toContain(`To remove the program too: ${REMOVE_PACKAGE}`);
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
    // `unwire`'s closing sentence, in the owner's 2026-09-22 wording — two
    // clauses about hooks and servers became the one thing a person can act on.
    expect(text(c.out)).toContain("An open Claude Code session keeps working until you close it.");
  });
});

// ── --park ──────────────────────────────────────────────────────────────────

describe("uninstall --park", () => {
  test("ONE rename: the tree is byte-identical under the dated name, and the screen is the owner's", async () => {
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

    // THE SCREEN, as the owner drew it on 2026-09-22.
    const said = text(c.out);
    expect(said).toContain("counterparts uninstall --park");
    expect(said).toContain("This will set aside (renamed, nothing copied, nothing deleted):");
    // The destination is named BEFORE anything happens, and again afterwards.
    const arrow = `~/.counterparts  →  ~/.counterparts.${PARKED_INFIX}-${today()}`;
    expect(c.out.filter((l) => l.includes(arrow)).length).toBe(2);
    expect(said).toContain("your memory, configuration");
    expect(said).toContain("Set aside");
    expect(said).toContain(
      "To bring it back later: counterparts install — it finds this folder and asks.",
    );
    expect(said).toContain(`To remove the program too: ${REMOVE_PACKAGE}`);
    // `~/…`, and the absolute paths nowhere on the screen.
    expect(said).not.toContain(parked);
    expect(said).not.toContain(base());
  });

  test("the guarded `mv` has LEFT the screen — the way back is a command now", async () => {
    // Finding #22: the undo was a pasted shell one-liner with an
    // `if [ -e … ] … REFUSING … mv … fi` guard in it. "Doesn't make sense."
    // The line itself is not gone — it lives in `counterparts help uninstall`,
    // and `start-fresh.ts#guardedMove` is still where it is proved.
    await install();
    const c = consoleWith();
    await uninstall(input({ io: c.io, park: true }));
    expect(c.out.some((l) => l.trimStart().startsWith("if [ -e "))).toBe(false);
    expect(text(c.out)).not.toContain("REFUSING");
    expect(text(c.out)).toContain("To bring it back later:");
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
    // THE SCREEN, as the owner drew it on 2026-09-22: the plan, the count on
    // the line of the thing it counts, then a plain red WARNING (finding #25 —
    // a `fail` tag in front of a warning reads as a failure).
    expect(said).toContain("counterparts uninstall --delete-memories");
    expect(said).toContain("This will delete, for good:");
    expect(said).toMatch(/~\/\.counterparts\/store\s+[\d.]+ [KMG]?B\s+your memory — [\d,]+ memories/);
    expect(said).toContain("and the ~/.counterparts folder itself.");
    expect(said).toContain("WARNING: nothing can bring these back afterwards.");
    expect(said).not.toContain("fail  WARNING");
    expect(c.asked[0]).toBe(`Type ${DELETE_PHRASE} to go ahead — Esc or "cancel" to stop: `);
    expect(existsSync(base())).toBe(false);
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(said).toContain(`To remove the program too: ${REMOVE_PACKAGE}`);
    expect(said).not.toContain(base());
  });

  test("a store with NO memories never reads as a bare zero", async () => {
    // A fresh install holds an identity core and no memories, so the whole
    // account of the store going used to be "0 memories".
    await install();
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");
    const line = c.out.find((l) => l.includes("your memory —")) as string;
    expect(line).toContain("no memories in it yet");
    expect(line).not.toContain("0 memories");
  });

  test("the count is on the store's own line, spelled with a comma", async () => {
    await install();
    await notes(3);
    const c = consoleWith([DELETE_PHRASE]);
    await uninstall(input({ io: c.io, deleteMemories: true }));
    const line = c.out.find((l) => l.includes("your memory —")) as string;
    expect(line).toMatch(/your memory — [\d,]+ memories/);

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
    for (const wrong of ["delete memories", "DELETE MEMORIES ", "yes", "DELETE  MEMORIES"]) {
      const c = consoleWith([wrong]);
      expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("refused");
      expect(text(c.err)).toBe(`That was not ${DELETE_PHRASE}. Nothing was deleted.`);
      // Not one byte, and the hooks are still in: the phrase is asked BEFORE
      // anything at all is taken out.
      expect(fingerprint(base(), true)).toBe(before);
      expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    }
  });

  test("the THREE ways out stop it, say so, and exit 0", async () => {
    // Owner, finding #21: "once the typed-phrase prompt is up there is no
    // visible way out". Esc, an empty Enter and the word `cancel` are all the
    // person deciding against it — which is not a refusal, and not a failure.
    await install();
    await notes(2);
    await wireIt();
    const before = fingerprint(base(), true);
    for (const out of ["", "cancel", "CANCEL", PROMPT_CANCEL]) {
      const c = consoleWith([out]);
      expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");
      expect(text(c.out)).toContain("Cancelled. Nothing was deleted.");
      expect(c.err).toEqual([]);
      expect(fingerprint(base(), true)).toBe(before);
      expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    }
  });

  test("Esc at the park confirmation is a no, and nothing moves", async () => {
    await install();
    await wireIt();
    const c = consoleWith([PROMPT_CANCEL]);
    expect(await uninstall(input({ io: c.io, park: true, yes: false }))).toBe("ok");
    expect(text(c.out)).toContain("Cancelled. Nothing was moved.");
    // The question said how to get out of it.
    expect(c.asked[0]).toBe("Claude Code will be disconnected. Go ahead? [Y/n]   (Esc or n to stop) ");
    expect(existsSync(base())).toBe(true);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
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
    expect(said).toContain("your memory — the count could not be taken");
    expect(said).toContain("WARNING: nothing can bring these back afterwards.");
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

  // THE PLUGIN REMOVES A HOOK OR A REGISTRATION ONLY WHEN WHAT IT RUNS IS GONE.
  // It writes neither (its hooks are hooks.json's, its server plugin.json's),
  // so a live one is a running npm install's, and uninstalling only the plugin
  // took it from a person with both; a dead one is what `npm rm` without
  // `counterparts uninstall` left, and goes. One that runs the plugin's own
  // files (its console can run `connect`) is gone with the plugin, and goes.
  describe("the plugin's uninstall and the npm install's wiring", () => {
    const PLUGIN_ROOT = join(dirname(import.meta.dir));
    const PLUGIN_ENV = { ...ENV, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
    const REMOVE = ["mcp", "remove", MCP_SERVER_NAME, "-s", "user"];
    const VERSION = ["--version"];
    const MISSING: SpawnResult = { missing: true, code: null, out: "", err: "" };
    /** A file at `<home>/<rel>`, so a command naming it reads as live. */
    function program(rel: string): string {
      const path = join(home, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "#!/bin/sh\n");
      return path;
    }
    function registration(command: string): string {
      writeFileSync(
        join(home, ".claude.json"),
        JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command, args: [] } } }),
      );
      return readFileSync(join(home, ".claude.json"), "utf8");
    }
    const liveRegistration = (): string => registration(program("npm/bin/counterparts-mcp"));
    const deadRegistration = (): string => registration(join(home, "gone", "counterparts-mcp"));
    function shimHooks(shim: string): string {
      mkdirSync(dirname(settingsFile()), { recursive: true });
      writeFileSync(
        settingsFile(),
        JSON.stringify({
          hooks: Object.fromEntries(HOST_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: shim }] }]])),
        }),
      );
      return readFileSync(settingsFile(), "utf8");
    }
    /** An npm install's hooks: its shim, outside the plugin, and there. */
    const liveHooks = (): string => shimHooks(program("npm/bin/counterparts-hook"));
    /** Hooks an `npm rm` left: the shim they name is not there any more. */
    const deadHooks = (): string => shimHooks(join(home, "gone", "counterparts-hook"));
    /** Each `claude` call, with how many questions had been put by then. */
    function recording(
      c?: Console_,
      answer: (args: readonly string[]) => SpawnResult = () => OK,
    ): { calls: string[][]; askedBefore: number[]; spawner: Spawner } {
      const calls: string[][] = [];
      const askedBefore: number[] = [];
      return {
        calls,
        askedBefore,
        spawner: (args) => (calls.push([...args]), askedBefore.push(c?.asked.length ?? 0), answer(args)),
      };
    }

    test("the plugin's keep (`--keep-memories --json`) leaves a live registration, and says whose it is", async () => {
      await install();
      const before = liveRegistration();
      const spy = recording();
      const c = consoleWith(null);
      expect(await uninstallJson(input({ io: c.io, env: PLUGIN_ENV, keepMemories: true, spawner: spy.spawner }))).toBe("ok");
      expect(spy.calls).not.toContainEqual(REMOVE);
      expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(before);
      const body = JSON.parse(text(c.out)) as { outcome: string; lines: string[] };
      expect(body.outcome).toBe("ok");
      expect(text(body.lines)).toContain("so it is the npm install's");
    });

    test("…and the npm install's live hooks stay with it", async () => {
      await install();
      const before = liveHooks();
      liveRegistration();
      const spy = recording();
      const c = consoleWith();
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, keepMemories: true, spawner: spy.spawner }))).toBe("ok");
      expect(spy.calls).toEqual([]);
      expect(readFileSync(settingsFile(), "utf8")).toBe(before);
      expect(text(c.out)).toContain(`${String(HOST_EVENTS.length)} Counterparts hooks were left as they are`);
    });

    test("hooks and a registration that run the plugin's own files go with it", async () => {
      await install();
      await wireIt(); // this process's runtime and THIS package's hook script: the plugin's own
      registration(join(PLUGIN_ROOT, "src", "adapters", "mcp", "bin", "serve.ts"));
      const spy = recording();
      const c = consoleWith();
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, keepMemories: true, spawner: spy.spawner }))).toBe("ok");
      expect(spy.calls).toEqual([REMOVE]);
      expect(readHost(home, home, ENV).events).toHaveLength(0);
      expect(text(c.out)).not.toContain("the npm install's");
    });

    test("an npm install removed without `counterparts uninstall`: its dead hooks and registration go", async () => {
      await install();
      deadHooks();
      deadRegistration();
      const spy = recording();
      const c = consoleWith(null);
      expect(await uninstallJson(input({ io: c.io, env: PLUGIN_ENV, keepMemories: true, spawner: spy.spawner }))).toBe("ok");
      expect(spy.calls).toEqual([REMOVE]);
      expect(readHost(home, home, ENV).events).toHaveLength(0);
      const body = JSON.parse(text(c.out)) as { lines: string[] };
      expect(text(body.lines)).not.toContain("`counterparts uninstall` removes");
      expect(existsSync(storePath())).toBe(true);
    });

    test("the npm install's own uninstall still removes live ones", async () => {
      await install();
      liveHooks();
      liveRegistration();
      const spy = recording();
      expect(await uninstall(input({ keepMemories: true, spawner: spy.spawner }))).toBe("ok");
      expect(spy.calls).toEqual([REMOVE]);
      expect(readHost(home, home, ENV).events).toHaveLength(0);
    });

    test("a plugin park still removes them: the store they open is going (M2)", async () => {
      await install();
      liveHooks();
      liveRegistration();
      const spy = recording();
      expect(await uninstall(input({ env: PLUGIN_ENV, park: true, spawner: spy.spawner }))).toBe("ok");
      expect(spy.calls).toContainEqual(REMOVE);
      expect(readHost(home, home, ENV).events).toHaveLength(0);
    });

    // The plain arm at a terminal asks about deleting AFTER the wiring; the
    // npm install's wiring must not be gone already when the answer is no.
    test("the plugin's plain arm, answered no: the live wiring and the memory both stay", async () => {
      await install();
      const hooksBefore = liveHooks();
      const before = liveRegistration();
      const spy = recording();
      const c = consoleWith(["y", ""]);
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, yes: false, spawner: spy.spawner }))).toBe("ok");
      expect(c.asked).toHaveLength(2);
      expect(spy.calls).not.toContainEqual(REMOVE);
      expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(before);
      expect(readFileSync(settingsFile(), "utf8")).toBe(hooksBefore);
      expect(existsSync(base())).toBe(true);
      expect(text(c.out)).toContain("Kept. Nothing was deleted.");
    });

    test("…answered yes and the phrase: the rest comes out after the phrase, and only then the delete", async () => {
      await install();
      liveHooks();
      liveRegistration();
      const c = consoleWith(["y", "y", DELETE_PHRASE]);
      const spy = recording(c);
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, yes: false, spawner: spy.spawner }))).toBe("ok");
      // `claude` looked for before the question; the removal after the phrase.
      expect(spy.calls).toEqual([VERSION, REMOVE]);
      expect(spy.askedBefore).toEqual([1, 3]);
      expect(readHost(home, home, ENV).events).toHaveLength(0);
      expect(existsSync(base())).toBe(false);
    });

    test("…with no `claude` to remove the registration, the delete is not offered at all", async () => {
      await install();
      const hooksBefore = liveHooks();
      const before = liveRegistration();
      const c = consoleWith(["y", "y", DELETE_PHRASE]);
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, yes: false, spawner: () => MISSING }))).toBe("ok");
      expect(c.asked).toHaveLength(1);
      expect(text(c.out)).toContain("Deleting your memory is not offered right now:");
      expect(text(c.out)).toContain("`claude` is not on this PATH");
      expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(before);
      expect(readFileSync(settingsFile(), "utf8")).toBe(hooksBefore);
      expect(existsSync(storePath())).toBe(true);
    });

    test("…but with nothing registered, no `claude` is needed and the delete goes ahead", async () => {
      await install();
      liveHooks();
      const c = consoleWith(["y", "y", DELETE_PHRASE]);
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, yes: false, spawner: () => MISSING }))).toBe("ok");
      expect(readHost(home, home, ENV).events).toHaveLength(0);
      expect(existsSync(base())).toBe(false);
    });

    test("…and when `claude` cannot remove it after the phrase, nothing is deleted (M2), and the hooks' state is said", async () => {
      await install();
      liveHooks();
      liveRegistration();
      const c = consoleWith(["y", "y", DELETE_PHRASE]);
      const spy = recording(c, (args) => (args[0] === "--version" ? OK : { missing: false, code: 1, out: "", err: "boom" }));
      expect(await uninstall(input({ io: c.io, env: PLUGIN_ENV, yes: false, spawner: spy.spawner }))).toBe("refused");
      expect(existsSync(storePath())).toBe(true);
      expect(text(c.err)).toContain("NOTHING WAS DELETED");
      // The hooks went before the registration refused: said, by whose they were.
      expect(readHost(home, home, ENV).events).toHaveLength(0);
      expect(text(c.err)).toContain("The npm install's hooks are out too");
    });

    // THE DIRECTORY FLAVOR never opens ~/.claude.json: an npm install's
    // `counterparts` on PATH, or a hook of ours that still runs, stands in for
    // "the registration still runs".
    describe("the plugin directory's build", () => {
      const npmPath = (): Record<string, string | undefined> => ({ ...PLUGIN_ENV, PATH: join(home, "npm", "bin") });

      test("keep, with the npm `counterparts` on PATH: no `claude mcp remove`", async () => {
        await install();
        program("npm/bin/counterparts");
        const spy = recording();
        const c = consoleWith(null);
        expect(
          await uninstallJson(input({ io: c.io, env: npmPath(), keepMemories: true, spawner: spy.spawner, readsUserConfig: false })),
        ).toBe("ok");
        expect(spy.calls).toEqual([]);
        const body = JSON.parse(text(c.out)) as { lines: string[] };
        expect(text(body.lines)).toContain("an npm install of Counterparts is still here");
      });

      test("keep, with a live npm hook and no `counterparts` on PATH: no `claude mcp remove`", async () => {
        await install();
        const before = liveHooks();
        const spy = recording();
        const c = consoleWith(null);
        expect(
          await uninstallJson(input({ io: c.io, env: PLUGIN_ENV, keepMemories: true, spawner: spy.spawner, readsUserConfig: false })),
        ).toBe("ok");
        expect(spy.calls).toEqual([]);
        expect(readFileSync(settingsFile(), "utf8")).toBe(before);
        const body = JSON.parse(text(c.out)) as { lines: string[] };
        expect(text(body.lines)).toContain("an npm install of Counterparts is still here");
      });

      test("keep, with no npm `counterparts`: whatever is registered goes", async () => {
        await install();
        deadHooks();
        const spy = recording();
        const c = consoleWith(null);
        expect(
          await uninstallJson(input({ io: c.io, env: PLUGIN_ENV, keepMemories: true, spawner: spy.spawner, readsUserConfig: false })),
        ).toBe("ok");
        expect(spy.calls).toEqual([REMOVE]);
        expect(readHost(home, home, ENV).events).toHaveLength(0);
      });

      test("keep: a `counterparts` in the plugin's own data directory is not an npm install", async () => {
        await install();
        program("plugin-data/counterparts");
        const env = { ...PLUGIN_ENV, CLAUDE_PLUGIN_DATA: join(home, "plugin-data"), PATH: join(home, "plugin-data") };
        const spy = recording();
        const c = consoleWith(null);
        expect(
          await uninstallJson(input({ io: c.io, env, keepMemories: true, spawner: spy.spawner, readsUserConfig: false })),
        ).toBe("ok");
        expect(spy.calls).toEqual([REMOVE]);
      });

      test("plain arm, answered no with the npm `counterparts` on PATH: nothing removed", async () => {
        await install();
        program("npm/bin/counterparts");
        const spy = recording();
        const c = consoleWith(["y", ""]);
        expect(await uninstall(input({ io: c.io, env: npmPath(), yes: false, spawner: spy.spawner, readsUserConfig: false }))).toBe("ok");
        expect(spy.calls).not.toContainEqual(REMOVE);
        expect(existsSync(base())).toBe(true);
      });

      test("plain arm, yes and the phrase: removed after the phrase, then deleted", async () => {
        await install();
        program("npm/bin/counterparts");
        const c = consoleWith(["y", "y", DELETE_PHRASE]);
        const spy = recording(c);
        expect(await uninstall(input({ io: c.io, env: npmPath(), yes: false, spawner: spy.spawner, readsUserConfig: false }))).toBe("ok");
        expect(spy.calls).toEqual([VERSION, REMOVE]);
        expect(spy.askedBefore).toEqual([1, 3]);
        expect(existsSync(base())).toBe(false);
      });
    });
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
    expect(paths).toEqual([join(dir, "store"), join(dir, CONFIG_FILE)].sort());
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
    expect(said).toContain("This will delete, for good:");
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
    // Not ours since the keys were removed (2026-09-24): it may hold somebody's
    // keys, so it is left where it is like anything else we did not write.
    expect(ownedKind("credentials.env", owned)).toBeNull();
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

  test("an old credentials.env beside the configuration is FOREIGN: never deleted, never moved, and named", async () => {
    const dir = join(home, "Documents");
    const config = await installIn(dir, []);
    writeFileSync(join(dir, "credentials.env"), "SOME_KEY=not-a-real-key\n", { mode: 0o600 });
    const plan = planFor(config);
    expect(plan.refusal).toBeNull();
    expect([...plan.foreign]).toEqual(["credentials.env"]);
    expect(plan.wholeDirectory).toBe(false);
    expect(plan.targets).not.toContain(join(dir, "credentials.env"));
    expect(plan.targets).not.toContain(dir);
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
    // Named, and named in the spelling the rest of the screen uses.
    expect(said).toContain("~/elsewhere/store");
    expect(said).not.toContain(store);
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

// ── the wait (the owner's 0.2.0 trial, 2026-09-22) ──────────────────────────

/**
 * Both moving arms sat on a blank screen while `claude mcp list` health-checked
 * every MCP server the person has. `spawnSync` blocks, so a spinner cannot tick
 * (and was ruled out); ONE static line, before the call, on a terminal only.
 */
describe("the wait while Claude Code is checked", () => {
  function registration(): void {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "bun", args: ["x"] } } }),
    );
  }

  /** A terminal console, and a spawner that notes how much had been printed by
   *  the time `claude mcp list` was run. */
  function watched(answers: readonly string[]): {
    c: Console_;
    spawner: Spawner;
    seenAt: () => number | null;
  } {
    const c = consoleWith(answers);
    const io: Io = { ...c.io, tty: { stdin: true, stdout: true, columns: 100 } };
    c.io = io;
    let at: number | null = null;
    const spawner: Spawner = (args) => {
      if (args[0] === "mcp" && args[1] === "list" && at === null) at = c.out.length;
      return OK;
    };
    return { c, spawner, seenAt: () => at };
  }

  for (const arm of ["park", "delete"] as const) {
    test(`--${arm === "park" ? "park" : "delete-memories"}: the line is on screen BEFORE \`claude mcp list\` runs`, async () => {
      await install();
      await wireIt();
      registration();
      const w = watched(arm === "park" ? ["y"] : ["cancel"]);
      const flags = arm === "park" ? { park: true, yes: false } : { deleteMemories: true };
      expect(await uninstall(input({ io: w.c.io, spawner: w.spawner, ...flags }))).toBe("ok");
      const at = w.seenAt();
      expect(at).not.toBeNull();
      // The last two lines printed before the spawn: the line, then a blank.
      expect(w.c.out.slice(0, at ?? 0).slice(-2)).toEqual([CHECKING_CLAUDE_CODE, ""]);
      expect(w.c.out.filter((l) => l === CHECKING_CLAUDE_CODE)).toHaveLength(1);
    });
  }

  test("off a terminal the screen is exactly what it was — no line", async () => {
    await install();
    await wireIt();
    registration();
    const c = consoleWith();
    let listed = false;
    const spawner: Spawner = (args) => {
      if (args[1] === "list") listed = true;
      return OK;
    };
    expect(await uninstall(input({ io: c.io, park: true, spawner }))).toBe("ok");
    expect(listed).toBe(true);
    expect(text(c.out)).not.toContain(CHECKING_CLAUDE_CODE);
  });

  test("nothing registered: no check runs, so nothing is said about one", async () => {
    await install();
    await wireIt();
    const w = watched(["y"]);
    expect(await uninstall(input({ io: w.c.io, spawner: w.spawner, park: true, yes: false }))).toBe("ok");
    expect(w.seenAt()).toBeNull();
    expect(text(w.c.out)).not.toContain(CHECKING_CLAUDE_CODE);
  });
});

// ── finding #26: one store, one size, in both plans ─────────────────────────

/**
 * The owner's trial (2026-09-22): the store was 6.7 MB in the `--delete-memories`
 * plan and 1.4 MB in the `--park` plan a minute later. Both arms always walked
 * the same files with the same `dirSize`; what moved between the runs was the
 * store's WRITE-AHEAD LOG (`counterparts.sqlite-wal`), which a process that is
 * killed — or that closes with statements still prepared, which is every one
 * of ours — leaves on disk at whatever size it reached, and which shrinks only
 * when something later checkpoints it. NOTES (2026-09-23) has the measurements.
 *
 * So the plans now (a) size the store before anything in this command opens it,
 * in BOTH arms, and (b) say how much of the number is that log, in the same
 * words under both.
 */
describe("finding #26 — the store's size, and what it is made of", () => {
  /**
   * A real log, left the way a killed writer leaves one: 400 commits with
   * autocheckpoint off, then SIGKILL — so every frame is still in the `-wal` and
   * the database file itself has not moved. The row it churns is deleted again
   * before the kill, so the store's CONTENT is what install left.
   */
  function fattenLog(): void {
    const db = join(storePath(), DATABASE_FILE).replace(/'/g, "\\'");
    const script = [
      `import { Database } from "bun:sqlite";`,
      `const db = new Database('${db}');`,
      `db.exec("PRAGMA wal_autocheckpoint = 0");`,
      `for (let i = 0; i < 400; i++) db.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('test.churn', '" + i + "')");`,
      `db.exec("DELETE FROM meta WHERE key = 'test.churn'");`,
      `process.kill(process.pid, "SIGKILL");`,
    ].join("\n");
    const res = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...ENV } });
    expect(res.signal).toBe("SIGKILL");
  }

  const storeRow = (lines: readonly string[]): string =>
    lines.find((l) => l.includes("your memory")) ?? "";

  test("both arms print the SAME size for the store, and the same sentence about its log", async () => {
    await install();
    fattenLog();
    const size = dirSize(storePath());
    const log = walBytes(storePath());
    expect(log).toBeGreaterThanOrEqual(LOG_WORTH_SAYING);
    const config = { dataDir: storePath() };
    const park = planUninstall({ configPath: configPath(), config, home, verb: "park" });
    const del = planUninstall({ configPath: configPath(), config, home, verb: "delete" });
    const storeBytes = (p: typeof park): number | undefined =>
      p.entries.find((e) => e.kind === "store")?.bytes;
    expect(storeBytes(park)).toBe(size);
    expect(storeBytes(del)).toBe(size);
    expect(park.logBytes).toBe(log);
    expect(del.logBytes).toBe(log);

    const clause = logClause(log, size) ?? [];
    expect(clause).toEqual([
      `${humanBytes(log)} of that is a database log that shrinks on its own;`,
      "nothing is lost when it does.",
    ]);
    const parkLines = planLines(park, "park", home);
    const delLines = planLines(del, "delete", home);
    // THE SAME WORDS under both, each at its own arm's indent.
    const parkAt = parkLines.indexOf(`     ${clause[0] ?? ""}`);
    expect(parkAt).toBeGreaterThan(0);
    expect(parkLines[parkAt + 1]).toBe(`     ${clause[1] ?? ""}`);
    // Under the store's own row, in the column its words start in.
    const row = storeRow(delLines);
    const at = delLines.indexOf(row);
    const column = row.indexOf("your memory");
    expect(delLines[at + 1]).toBe(`${" ".repeat(column)}${clause[0] ?? ""}`);
    expect(delLines[at + 2]).toBe(`${" ".repeat(column)}${clause[1] ?? ""}`);
    expect(row).toContain(humanBytes(size));
  });

  test("the plan opens nothing, and the COUNT comes after the sizes the screen prints (#188 review)", async () => {
    // The reviewer's mutation: make the count's open fold the log (what a
    // future `store/` that finalizes its statements would do on close). With
    // the count taken before the printed sizes, the delete screen lost its log
    // line and its size moved while the park screen kept both — two sizes for
    // one store again. Here `Store.open` folds the log before it opens, and the
    // delete screen must still print the size and the log it had.
    await install();
    fattenLog();
    const size = dirSize(storePath());
    const plan = planUninstall({ configPath: configPath(), config: { dataDir: storePath() }, home, verb: "delete" });
    expect(plan.census).toBeNull();
    expect(walBytes(storePath())).toBe(plan.logBytes);

    const original = Store.open.bind(Store);
    let opened = 0;
    const folding = spyOn(Store, "open").mockImplementation((opts) => {
      opened += 1;
      const db = new Database(join(storePath(), DATABASE_FILE));
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      return original(opts);
    });
    try {
      const c = consoleWith(["cancel"]);
      expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("ok");
      expect(opened).toBe(1); // the count, and nothing else
      const said = text(c.out);
      expect(said).toContain(`store             ${humanBytes(size)}`);
      expect(said).toContain("of that is a database log that shrinks on its own;");
      // The count is still on the store's line.
      expect(said).toMatch(/your memory — (no memories in it yet|\d+ memor)/);
    } finally {
      folding.mockRestore();
    }
  });

  test("the whole screens, both arms, carry it — and a fresh store's screens do not", async () => {
    await install();
    const fresh = consoleWith(["cancel"]);
    expect(await uninstall(input({ io: fresh.io, deleteMemories: true }))).toBe("ok");
    expect(text(fresh.out)).not.toContain("database log");

    fattenLog();
    const del = consoleWith(["cancel"]);
    expect(await uninstall(input({ io: del.io, deleteMemories: true }))).toBe("ok");
    expect(text(del.out)).toContain("of that is a database log that shrinks on its own;");
    // The delete arm's count is an observer open, and since `Db.close()` really
    // closes (2026-10-11) the last connection's close folds the log: the
    // shrinking that sentence promises. So the park arm gets a fat log of its own.
    fattenLog();
    const park = consoleWith(["n"]);
    expect(await uninstall(input({ io: park.io, park: true, yes: false }))).toBe("ok");
    expect(text(park.out)).toContain("of that is a database log that shrinks on its own;");
  });

  test("sized AFTER the pre-flight: a log the health check folds in is gone from BOTH screens", async () => {
    // The cause, reproduced with a stand-in: `claude mcp list` starts our MCP
    // server, which folds the log into the database on its way out. The stub
    // does exactly that — a real `wal_checkpoint(TRUNCATE)` — when it is asked
    // to list. Before 2026-09-23 the delete plan was sized before its own
    // pre-flight (log included) and a park plan run after it found the log
    // gone: two sizes for one store.
    await install();
    await wireIt();
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "bun", args: ["x"] } } }),
    );
    const folding: Spawner = (args) => {
      if (args[0] === "mcp" && args[1] === "list") {
        const db = new Database(join(storePath(), DATABASE_FILE));
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      }
      return OK;
    };
    const sizes: string[] = [];
    for (const flags of [{ deleteMemories: true }, { park: true, yes: false }]) {
      fattenLog();
      expect(walBytes(storePath())).toBeGreaterThanOrEqual(LOG_WORTH_SAYING);
      const c = consoleWith(["deleteMemories" in flags ? "cancel" : "n"]);
      expect(await uninstall(input({ io: c.io, spawner: folding, ...flags }))).toBe("ok");
      const said = text(c.out);
      expect(said).not.toContain("database log");
      if ("deleteMemories" in flags) {
        sizes.push(/store\s+(\S+ \S+)\s+your memory/.exec(said)?.[1] ?? "?");
      } else {
        sizes.push(/— (\S+ \S+)\n/.exec(`${said}\n`)?.[1] ?? "?");
      }
    }
    // The delete plan's store row and the park plan's total are different
    // things (the park line counts the configuration too), so the check is that
    // each is the AFTER-fold size of what it names — neither carries the log.
    // Empty, or gone: SQLite on Linux deletes it when the last connection closes.
    const wal = join(storePath(), `${DATABASE_FILE}-wal`);
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
    expect(walBytes(storePath())).toBeLessThan(LOG_WORTH_SAYING);
    expect(sizes[0]).toBe(humanBytes(dirSize(storePath())));
    expect(sizes[1]).toBe(humanBytes(dirSize(base())));
  });

  test("a small log is not worth a sentence, and neither is a big store's", () => {
    expect(logClause(200 * 1024, 2 * 1024 * 1024)).toBeNull();
    expect(logClause(2 * 1024 * 1024, 100 * 1024 * 1024)).toBeNull();
    expect(logClause(5 * 1024 * 1024, 6 * 1024 * 1024)?.[0]).toContain("5.0 MB of that");
  });

  test("walBytes counts a `-wal` only beside its database, and never opens either", () => {
    const d = join(home, "walk");
    mkdirSync(join(d, "cache"), { recursive: true });
    writeFileSync(join(d, "a.sqlite"), "x");
    writeFileSync(join(d, "a.sqlite-wal"), "y".repeat(100));
    writeFileSync(join(d, "cache", "c.sqlite"), "x");
    writeFileSync(join(d, "cache", "c.sqlite-wal"), "z".repeat(50));
    writeFileSync(join(d, "orphan-wal"), "q".repeat(1000));
    // Not ours: a backup's own log beside its backup (review of #188, NIT).
    writeFileSync(join(d, "a.sqlite.bak"), "x");
    writeFileSync(join(d, "a.sqlite.bak-wal"), "b".repeat(700));
    expect(walBytes(d)).toBe(150);
    expect(walBytes(join(home, "not-there"))).toBe(0);
  });
});

// ── review n5: the park heading, when no memory moved ───────────────────────

describe("review n5 — the park screen claims only what moved", () => {
  test("no store at the configured path: no 'your memory' in the plan, and the report says none moved", async () => {
    // The review found "Your memory, parked" printed when the census could not
    // be taken and nothing of the memory moved. The 2026-09-22 screens replaced
    // that heading with "Set aside" and took the census off this arm entirely;
    // this pins what is left of the finding — the words about the memory.
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true }))).toBe("ok");
    const said = text(c.out);
    expect(said).not.toContain("Your memory, parked");
    expect(said).not.toContain("your memory,");
    expect(said).toContain("so no memory is moved");
    expect(said).toContain("Set aside");
    expect(said).toContain("No memory was moved: there was no store at the path the configuration named.");
  });
});

// ── the offer, after the wiring is out (Mike, 2026-10-11) ───────────────────

/**
 * Every uninstall path offers "Also delete all memories and related data? This
 * can't be undone", always behind the typed phrase. These pin the defaults:
 * Enter, Esc, n, no terminal, `--yes` and `--keep-memories` all KEEP; only a yes
 * AND the exact phrase delete; and a store something holds is never offered.
 */
describe("uninstall, plain — the offer to delete", () => {
  /** A Claude Code session whose hooks ran a moment ago, as `readLiveness` reads it. */
  function liveSession(id = "sess-live"): void {
    mkdirSync(join(storePath(), SESSIONS_DIR), { recursive: true });
    writeFileSync(
      join(storePath(), SESSIONS_DIR, `${id}.json`),
      JSON.stringify({ sessionId: id, scope: "/work/project", endedAt: null, lastBoundaryAt: Date.now() }),
    );
  }

  const question = `${DELETE_QUESTION} [y/N]   (Enter keeps them) `;

  test("the DEFAULT keeps: Enter at the question deletes nothing, and the question names the paths", async () => {
    await install();
    await notes(2);
    await wireIt();
    const before = fingerprint(base(), true);
    const c = consoleWith(["y", ""]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(c.asked).toEqual(["Claude Code will be disconnected. Go ahead? [Y/n]   (Esc or n to stop) ", question]);
    // The wiring is out; the memory is all there.
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(fingerprint(base(), true)).toBe(before);
    const said = text(c.out);
    expect(said).toContain("If you say yes, this deletes, for good:");
    expect(said).toMatch(/~\/\.counterparts\/store\s+[\d.]+ [KMG]?B\s+your memory — [\d,]+ memories/);
    expect(said).toContain("and the ~/.counterparts folder itself.");
    // And where it stops: Claude Code's own directory is named as untouched.
    expect(said).toContain("Not touched:");
    expect(said).toMatch(/~\/\.claude\s+Claude Code's own files/);
    expect(said).toContain("Kept. Nothing was deleted.");
    expect(said).toContain(`To remove the program too: ${REMOVE_PACKAGE}`);
  });

  test("n and Esc keep too, and the phrase is never asked", async () => {
    for (const answer of ["n", "no", PROMPT_CANCEL]) {
      await install();
      const before = fingerprint(base(), true);
      const c = consoleWith(["y", answer]);
      expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
      expect(c.asked).toHaveLength(2);
      expect(fingerprint(base(), true)).toBe(before);
      rmSync(base(), { recursive: true, force: true });
    }
  });

  test("y and the exact phrase delete — the store, its snapshots, the configuration — and say so path by path", async () => {
    await install();
    await notes(2);
    await wireIt();
    mkdirSync(join(base(), "snapshots", "2026-10-10"), { recursive: true });
    const plan = planUninstall({ configPath: configPath(), config: { dataDir: storePath() }, home, verb: "delete" });
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(c.asked[1]).toBe(question);
    expect(c.asked[2]).toBe(PHRASE_PROMPT);
    expect(existsSync(base())).toBe(false);
    const said = text(c.out);
    // Every entry the plan named was on the screen before the question (but the
    // npm-live marker, which the unwire removes before the screen is drawn)...
    for (const e of plan.entries.filter((x) => !x.path.endsWith("/npm-live.json"))) expect(said).toContain(e.path.replace(home, "~"));
    // ...and what went is exactly what the plan said would.
    expect(plan.targets).toEqual([base()]);
    expect(said).toContain("WARNING: nothing can bring these back afterwards.");
    expect(said).toContain("Deleted");
    expect(said).toContain("~/.counterparts");
  });

  test("y and the WRONG phrase delete nothing and exit non-zero", async () => {
    await install();
    await notes(1);
    await wireIt();
    const before = fingerprint(base(), true);
    for (const wrong of ["delete memories", "y", "DELETE MEMORIES "]) {
      const c = consoleWith(["y", "y", wrong]);
      expect(await uninstall(input({ io: c.io, yes: false }))).toBe("refused");
      expect(text(c.err)).toBe(`That was not ${DELETE_PHRASE}. Nothing was deleted.`);
      expect(fingerprint(base(), true)).toBe(before);
    }
  });

  test("y and then Esc, Enter or cancel at the phrase stop it, exit 0, and delete nothing", async () => {
    await install();
    const before = fingerprint(base(), true);
    for (const out of ["", "cancel", PROMPT_CANCEL]) {
      const c = consoleWith(["y", "y", out]);
      expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
      expect(text(c.out)).toContain("Cancelled. Nothing was deleted.");
      expect(fingerprint(base(), true)).toBe(before);
    }
  });

  test("no terminal: no question, and the memory stays", async () => {
    await install();
    await wireIt();
    const before = fingerprint(base(), true);
    // `--yes` from a pipe: the wiring goes, nothing is asked.
    const c = consoleWith(null);
    expect(
      await run(["uninstall", "--config", configPath(), "--yes"], {
        io: c.io,
        env: ENV,
        home,
        spawner: okSpawner,
        processes: noProcesses,
      }),
    ).toBe(EXIT.ok);
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(fingerprint(base(), true)).toBe(before);
    expect(text(c.out)).not.toContain(DELETE_QUESTION);
    expect(text(c.out)).toContain("memories are still at");
  });

  test("--yes at a terminal takes the ordinary answer — keep — and asks nothing", async () => {
    await install();
    const before = fingerprint(base(), true);
    const c = consoleWith([]);
    expect(await uninstall(input({ io: c.io, yes: true }))).toBe("ok");
    expect(c.asked).toEqual([]);
    expect(fingerprint(base(), true)).toBe(before);
  });

  test("--keep-memories skips the question, says the old promise, and keeps", async () => {
    await install();
    await wireIt();
    const before = fingerprint(base(), true);
    const c = consoleWith(["y"]);
    const code = await run(["uninstall", "--config", configPath(), "--keep-memories"], {
      io: c.io,
      env: ENV,
      home,
      spawner: okSpawner,
      processes: noProcesses,
    });
    expect(code).toBe(EXIT.ok);
    expect(c.asked).toEqual([
      "Claude Code will be disconnected — your memory stays exactly where it is. Go ahead? [Y/n]   (Esc or n to stop) ",
    ]);
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(fingerprint(base(), true)).toBe(before);
    expect(text(c.out)).toContain("counterparts uninstall --keep-memories");
  });

  test("--keep-memories beside --delete-memories or --park is refused, not guessed at", async () => {
    await install();
    for (const other of [{ deleteMemories: true }, { park: true }]) {
      const c = consoleWith([DELETE_PHRASE]);
      expect(await uninstall(input({ io: c.io, keepMemories: true, ...other }))).toBe("refused");
      expect(text(c.err)).toContain("two answers to one question");
      expect(existsSync(base())).toBe(true);
    }
  });

  test("a LIVE SESSION on the store: the delete is not offered, and says why", async () => {
    await install();
    await wireIt();
    liveSession();
    const before = fingerprint(base(), true);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    // Only the go-ahead was asked: no question whose yes would be refused.
    expect(c.asked).toHaveLength(1);
    const said = text(c.out);
    expect(said).toContain("Deleting your memory is not offered right now:");
    expect(said).toContain("a Claude Code session (session sess-live)");
    expect(fingerprint(base(), true)).toBe(before);
    // The wiring is out all the same: that part was asked for.
    expect(readHost(home, home, ENV).events).toEqual([]);
  });

  test("…and --delete-memories refuses on the same evidence, before anything is unwired", async () => {
    await install();
    await wireIt();
    liveSession();
    const c = consoleWith([DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, deleteMemories: true }))).toBe("refused");
    expect(text(c.err)).toContain("refused: this store is open in:");
    expect(text(c.err)).toContain("session sess-live");
    expect(c.asked).toEqual([]);
    expect(existsSync(storePath())).toBe(true);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("a process of ours running: not offered either", async () => {
    await install();
    const busy: ProcessLister = () => ({
      looked: true,
      processes: [{ pid: 77, what: "an MCP server", command: "bun run serve.ts" }],
    });
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false, lister: busy }))).toBe("ok");
    expect(c.asked).toHaveLength(1);
    expect(text(c.out)).toContain("an MCP server, pid 77");
    expect(existsSync(storePath())).toBe(true);
  });

  test("a session that opens WHILE the phrase is being typed stops the delete", async () => {
    await install();
    const answers = ["y", "y"];
    const asked: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      prompt: async (q) => {
        asked.push(q);
        if (q === PHRASE_PROMPT) {
          liveSession("sess-late");
          return DELETE_PHRASE;
        }
        return answers.shift() ?? "";
      },
    };
    expect(await uninstall(input({ io, yes: false }))).toBe("refused");
    expect(text(err)).toContain("session sess-late");
    expect(text(err)).toContain("Nothing was deleted.");
    expect(existsSync(storePath())).toBe(true);
  });

  test("a snapshots folder the configuration points elsewhere is named as kept, and kept", async () => {
    await install();
    const mine = join(home, "Backups", "counterparts-snaps");
    mkdirSync(join(mine, "2026-10-10"), { recursive: true });
    const config = { dataDir: storePath(), snapshots: { dir: mine } };
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false, config }))).toBe("ok");
    expect(text(c.out)).toContain("~/Backups/counterparts-snaps");
    expect(text(c.out)).toContain("the snapshots folder your configuration names — yours to delete");
    expect(existsSync(base())).toBe(false);
    expect(existsSync(join(mine, "2026-10-10"))).toBe(true);
  });
});

// ── --json: the plugin command's door ───────────────────────────────────────

describe("uninstall --json", () => {
  const pipe = (text_: string) => ({ isTty: false, read: async () => text_ });

  function only(lines: readonly string[]): Record<string, unknown> {
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0] as string) as Record<string, unknown>;
  }

  test("alone it is the PLAN: one JSON line, nothing unwired, nothing touched", async () => {
    await install();
    await notes(3);
    await wireIt();
    const before = fingerprint(base(), true);
    const c = consoleWith(null);
    expect(await uninstallJson(input({ io: c.io, yes: false }))).toBe("ok");
    const plan = only(c.out);
    expect(c.err).toEqual([]);
    expect(plan["mode"]).toBe("plan");
    expect(plan["deletable"]).toBe(true);
    expect(plan["why"]).toBeNull();
    expect(plan["question"]).toBe(DELETE_QUESTION);
    // No scripted delete to offer: the phrase is not handed out, and the next
    // step for a delete is a command the PERSON runs at a terminal.
    expect(plan["phrase"]).toBeUndefined();
    expect(plan["deleteArgs"]).toBeUndefined();
    expect(plan["terminalArgs"]).toEqual(["uninstall", "--config", configPath()]);
    expect(plan["keepArgs"]).toEqual(["uninstall", "--keep-memories", "--json", "--config", configPath()]);
    expect(plan["targets"]).toEqual([base()]);
    expect(plan["memories"]).toBeGreaterThanOrEqual(3);
    const deletes = plan["deletes"] as { path: string; kind: string }[];
    expect(deletes[0]).toMatchObject({ path: storePath(), kind: "store" });
    expect(deletes.map((d) => d.path)).toContain(configPath());
    expect((plan["notTouched"] as { path: string }[]).map((n) => n.path)).toContain(join(home, ".claude"));
    expect((plan["lines"] as string[]).join("\n")).toContain("If you say yes, this deletes, for good:");
    // Not one byte, and the hooks still in.
    expect(fingerprint(base(), true)).toBe(before);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("the plan says when a delete cannot go ahead, and why", async () => {
    await install();
    mkdirSync(join(storePath(), SESSIONS_DIR), { recursive: true });
    writeFileSync(
      join(storePath(), SESSIONS_DIR, "s1.json"),
      JSON.stringify({ sessionId: "s1", endedAt: null, lastBoundaryAt: Date.now() }),
    );
    const c = consoleWith(null);
    await uninstallJson(input({ io: c.io }));
    const plan = only(c.out);
    expect(plan["deletable"]).toBe(false);
    expect(String(plan["why"])).toContain("session s1");
    expect((plan["holders"] as { refuse: boolean }[])[0]?.refuse).toBe(true);
  });

  test("--delete-memories --json is REFUSED, whatever is on stdin: nothing unwired, nothing deleted", async () => {
    await install();
    await notes(1);
    await wireIt();
    const before = fingerprint(base(), true);
    const c = consoleWith(null);
    expect(await uninstallJson(input({ io: c.io, deleteMemories: true }))).toBe("refused");
    const result = only(c.out);
    expect(result["mode"]).toBe("delete");
    expect(result["outcome"]).toBe("refused");
    expect(result["unwired"]).toBe(false);
    expect(String(result["why"])).toContain("terminal");
    expect(fingerprint(base(), true)).toBe(before);
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);

    // Through the console, with the exact phrase piped in: the same refusal.
    for (const stdin of [pipe(`${DELETE_PHRASE}\n`), { isTty: true, read: async () => DELETE_PHRASE }]) {
      const viaRun = consoleWith(null);
      expect(
        await run(["uninstall", "--config", configPath(), "--delete-memories", "--json"], {
          io: viaRun.io,
          env: ENV,
          home,
          spawner: okSpawner,
          processes: noProcesses,
          stdin,
        }),
      ).toBe(EXIT.refused);
      expect(only(viaRun.out)["outcome"]).toBe("refused");
      expect(fingerprint(base(), true)).toBe(before);
      expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
    }
  });

  test("--keep-memories --json uninstalls and keeps, and asks nothing", async () => {
    await install();
    await wireIt();
    const before = fingerprint(base(), true);
    const c = consoleWith(null);
    expect(await uninstallJson(input({ io: c.io, keepMemories: true, yes: false }))).toBe("ok");
    const result = only(c.out);
    expect(result["mode"]).toBe("keep");
    expect(result["unwired"]).toBe(true);
    expect(result["deleted"]).toBeUndefined();
    expect(readHost(home, home, ENV).events).toEqual([]);
    expect(fingerprint(base(), true)).toBe(before);
  });

  test("--keep-memories --json from a prompt-capable console still never asks the delete question", async () => {
    await install();
    await wireIt();
    const before = fingerprint(base(), true);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstallJson(input({ io: c.io, keepMemories: true, yes: false }))).toBe("ok");
    expect(c.asked).toEqual([]);
    expect(fingerprint(base(), true)).toBe(before);
  });

  test("through the console: stdout is the JSON alone, and the exit codes are the console's", async () => {
    await install();
    const plan = consoleWith(null);
    expect(
      await run(["uninstall", "--config", configPath(), "--json"], {
        io: plan.io,
        env: ENV,
        home,
        spawner: okSpawner,
        processes: noProcesses,
      }),
    ).toBe(EXIT.ok);
    const parsed = only(plan.out);
    // The configuration this plan read travels into the args the caller runs next.
    expect(parsed["terminalArgs"]).toEqual(["uninstall", "--config", configPath()]);
    expect(existsSync(base())).toBe(true);
  });

  test("without --json, --delete-memories with no person still refuses, stdin or not", async () => {
    await install();
    const c = consoleWith(null);
    expect(
      await run(["uninstall", "--config", configPath(), "--delete-memories"], {
        io: c.io,
        env: ENV,
        home,
        spawner: okSpawner,
        processes: noProcesses,
        stdin: pipe(`${DELETE_PHRASE}\n`),
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("has no --yes");
    expect(existsSync(base())).toBe(true);
  });
});

// ── review of #414: the edges ───────────────────────────────────────────────

describe("uninstall — review of #414", () => {
  function sessionAt(id: string, lastBoundaryAt: number, endedAt: number | null = null): void {
    mkdirSync(join(storePath(), SESSIONS_DIR), { recursive: true });
    writeFileSync(
      join(storePath(), SESSIONS_DIR, `${id}.json`),
      JSON.stringify({ sessionId: id, scope: "/work/project", endedAt, lastBoundaryAt }),
    );
  }

  test("a session whose last hook was 11 minutes ago does not hold the offer back", async () => {
    await install();
    const now = Date.now();
    sessionAt("sess-old", now - 11 * 60_000);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false, now }))).toBe("ok");
    expect(c.asked).toHaveLength(3);
    expect(existsSync(base())).toBe(false);
  });

  test("a session 9 minutes ago does", async () => {
    await install();
    const now = Date.now();
    sessionAt("sess-recent", now - 9 * 60_000);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false, now }))).toBe("ok");
    expect(c.asked).toHaveLength(1);
    expect(existsSync(storePath())).toBe(true);
  });

  function serverRecord(pid: number): void {
    mkdirSync(join(storePath(), SESSIONS_DIR), { recursive: true });
    writeFileSync(
      join(storePath(), SESSIONS_DIR, `mcp-server@${String(pid)}.json`),
      JSON.stringify({
        pid,
        hostPid: 1,
        scope: "/work/project",
        startedAt: Date.now(),
        build: { version: "0.3.17", storeSchema: 13, cacheSchema: 1 },
      }),
    );
  }

  test("a foreign file in the folder: the offer deletes EXACTLY the plan's targets, and names and keeps the rest", async () => {
    await install();
    await notes(1);
    await wireIt();
    mkdirSync(join(base(), "snapshots", "2026-10-10"), { recursive: true });
    writeFileSync(join(base(), "my-notes.txt"), "mine");
    const plan = planUninstall({ configPath: configPath(), config: { dataDir: storePath() }, home, verb: "delete" });
    expect(plan.targets).not.toContain(base());
    expect(plan.targets.length).toBeGreaterThan(0);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    for (const t of plan.targets) expect(existsSync(t)).toBe(false);
    expect(readdirSync(base())).toEqual(["my-notes.txt"]);
    expect(readFileSync(join(base(), "my-notes.txt"), "utf8")).toBe("mine");
    expect(text(c.out)).toContain("my-notes.txt");
  });

  test("CLAUDE_CONFIG_DIR: the host's moved directory is the one named as untouched, and it survives even inside ~/.counterparts", async () => {
    await install();
    const moved = join(base(), "claude-config");
    mkdirSync(moved, { recursive: true });
    writeFileSync(join(moved, "settings.json"), "{}");
    const env = { ...ENV, CLAUDE_CONFIG_DIR: moved };
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false, env }))).toBe("ok");
    expect(text(c.out)).toMatch(/~\/\.counterparts\/claude-config\s+Claude Code's own files/);
    expect(readFileSync(join(moved, "settings.json"), "utf8")).toBe("{}");
    expect(existsSync(storePath())).toBe(false);
  });

  test("a fresh server record whose pid is DEAD does not hold the offer back", async () => {
    await install();
    const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
    serverRecord(gone);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(c.asked).toHaveLength(3);
    expect(existsSync(base())).toBe(false);
  });

  test("a fresh server record whose pid is alive does", async () => {
    await install();
    serverRecord(process.ppid);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(c.asked).toHaveLength(1);
    expect(text(c.out)).toContain(`a memory server — pid ${String(process.ppid)}`);
    expect(existsSync(storePath())).toBe(true);
  });

  test("--delete-memories looks again after the phrase: a session that opens while it is typed stops it", async () => {
    await install();
    await wireIt();
    const asked: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: () => undefined,
      err: (l) => err.push(l),
      prompt: async (q) => {
        asked.push(q);
        sessionAt("sess-late", Date.now());
        return DELETE_PHRASE;
      },
    };
    expect(await uninstall(input({ io, deleteMemories: true }))).toBe("refused");
    expect(text(err)).toContain("session sess-late");
    expect(existsSync(storePath())).toBe(true);
    // Before the wiring came out.
    expect(readHost(home, home, ENV).events).toHaveLength(HOST_EVENTS.length);
  });

  test("a store symlinked OUTSIDE the folder: the offer is withheld and nothing on either side goes", async () => {
    await install();
    await notes(1);
    // The real store moved elsewhere, and ~/.counterparts/store made a link to it.
    const elsewhere = join(home, "Elsewhere", "real-store");
    mkdirSync(dirname(elsewhere), { recursive: true });
    renameSync(storePath(), elsewhere);
    symlinkSync(elsewhere, storePath());
    const outside = fingerprint(dirname(elsewhere), true);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(c.asked).toHaveLength(1);
    expect(text(c.out)).toContain("Deleting your memory is not offered right now:");
    expect(text(c.out)).toContain("SYMBOLIC LINK");
    expect(fingerprint(dirname(elsewhere), true)).toBe(outside);
    expect(lstatSync(storePath()).isSymbolicLink()).toBe(true);
    expect(existsSync(configPath())).toBe(true);
  });

  test("a snapshots folder that is a symlink outside: the link goes, what it points at stays", async () => {
    await install();
    const precious = join(home, "Elsewhere");
    mkdirSync(join(precious, "2026-10-10"), { recursive: true });
    writeFileSync(join(precious, "taxes.txt"), "mine");
    symlinkSync(precious, join(base(), "snapshots"));
    const outside = fingerprint(precious);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(existsSync(base())).toBe(false);
    expect(fingerprint(precious)).toBe(outside);
  });

  /** Claude Code's record of a plugin install, as `host-wiring.ts#pluginInstall` reads it. */
  function recordPlugin(id: string, enabled?: boolean): void {
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { [id]: [{ scope: "user", installPath: join(home, "cache"), version: "0.3.17" }] } }),
    );
    if (enabled === undefined) return;
    const settings = existsSync(settingsFile())
      ? (JSON.parse(readFileSync(settingsFile(), "utf8")) as Record<string, unknown>)
      : {};
    mkdirSync(dirname(settingsFile()), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify({ ...settings, enabledPlugins: { [id]: enabled } }));
  }

  test("after a delete, a plugin install is told to remove the plugin AT THE TERMINAL, before Claude Code opens again", async () => {
    // An enabled plugin's first start re-creates an empty folder before anybody
    // can reach /plugin (plugin.test.ts proves the re-create), so the closing
    // line names Claude Code's terminal command, not the in-app menu.
    await install();
    recordPlugin("counterparts@counterparts-loop");
    const env = { ...ENV, CLAUDE_PLUGIN_ROOT: join(dirname(import.meta.dir)) };
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false, env }))).toBe("ok");
    expect(existsSync(base())).toBe(false);
    const said = text(c.out);
    expect(said).toContain("To remove the program too: claude plugin uninstall counterparts@counterparts-loop");
    expect(said).toContain(PLUGIN_BEFORE_REOPEN);
    expect(said.indexOf(PLUGIN_BEFORE_REOPEN)).toBeGreaterThan(said.indexOf("claude plugin uninstall"));
    expect(said).not.toContain(REMOVE_PLUGIN);
    expect(said).not.toContain(REMOVE_PACKAGE);
  });

  test("…and after a park, the same; with no record of the plugin, the published id", async () => {
    await install();
    const env = { ...ENV, CLAUDE_PLUGIN_ROOT: join(dirname(import.meta.dir)) };
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, env }))).toBe("ok");
    expect(existsSync(configPath())).toBe(false);
    const said = text(c.out);
    expect(said).toContain(`To remove the program too: claude plugin uninstall ${PLUGIN_ID_FALLBACK}`);
    expect(said).toContain(PLUGIN_BEFORE_REOPEN);
    expect(said).not.toContain(REMOVE_PLUGIN);
  });

  test("an npm install whose host ALSO has the plugin on is told to remove it too after a delete; off, not", async () => {
    await install();
    recordPlugin("counterparts@counterparts", true);
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    const said = text(c.out);
    expect(said).toContain(`To remove the program too: ${REMOVE_PACKAGE}`);
    expect(said).toContain("Claude Code also has the plugin: claude plugin uninstall counterparts@counterparts");
    expect(said).toContain(PLUGIN_BEFORE_REOPEN);

    await install();
    recordPlugin("counterparts@counterparts", false);
    const off = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: off.io, yes: false }))).toBe("ok");
    expect(existsSync(base())).toBe(false);
    expect(text(off.out)).not.toContain("claude plugin uninstall");
  });

  test("review of #425: a project-scope plugin is removed with --scope, from the folder Claude Code recorded", async () => {
    await install();
    const project = join(home, "my project");
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "counterparts@counterparts": [{ scope: "project", projectPath: project, installPath: join(home, "cache") }] },
      }),
    );
    const env = { ...ENV, CLAUDE_PLUGIN_ROOT: join(dirname(import.meta.dir)) };
    const c = consoleWith();
    expect(await uninstall(input({ io: c.io, park: true, env }))).toBe("ok");
    expect(text(c.out)).toContain(
      `To remove the program too: cd '${project}' && claude plugin uninstall counterparts@counterparts --scope project`,
    );
  });

  test("review of #425: an npm-only install is never told to remove a plugin, even with a broken registry", async () => {
    await install();
    const c = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: c.io, yes: false }))).toBe("ok");
    expect(text(c.out)).not.toContain("claude plugin uninstall");

    await install();
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "{ not json");
    const broken = consoleWith(["y", "y", DELETE_PHRASE]);
    expect(await uninstall(input({ io: broken.io, yes: false }))).toBe("ok");
    expect(existsSync(base())).toBe(false);
    expect(text(broken.out)).toContain(`To remove the program too: ${REMOVE_PACKAGE}`);
    expect(text(broken.out)).not.toContain("claude plugin uninstall");
  });

  test("closing lines on a plugin install name the plugin's launcher and /plugin, not bun", async () => {
    await install();
    const root = join(dirname(import.meta.dir));
    const env = { ...ENV, CLAUDE_PLUGIN_ROOT: root };
    const c = consoleWith(["y", ""]);
    expect(await uninstall(input({ io: c.io, yes: false, env }))).toBe("ok");
    const said = text(c.out);
    expect(said).toContain(`To remove the program too: ${REMOVE_PLUGIN}`);
    expect(said).not.toContain(REMOVE_PACKAGE);
    expect(existsSync(base())).toBe(true);
    const kept = consoleWith(null);
    expect(await uninstall(input({ io: kept.io, env }))).toBe("ok");
    expect(text(kept.out)).toMatch(/sh \S*src\/adapters\/plugin-run\.sh cli uninstall --park/);
    expect(text(kept.out)).not.toContain(REMOVE_PACKAGE);
  });
});

// ── round 4 of #657: rollback's set-aside store is memory, and says so ──────

test("a rollback-aside store in the base is named and counted as memory in the delete plan", async () => {
  await install();
  const aside = join(base(), "rollback-aside-v13-2026-10-11T07-25-00-000Z");
  mkdirSync(aside);
  writeFileSync(join(aside, "counterparts.sqlite"), "old memory\n");
  const config = { dataDir: storePath() };
  const del = planUninstall({ configPath: configPath(), config, home, verb: "delete" });
  const entry = del.entries.find((e) => e.path === aside);
  expect(entry?.kind).toBe("aside");
  const lines = planLines(del, "delete", home);
  const row = lines.find((l) => l.includes("rollback-aside-v13")) ?? "";
  expect(row).toContain("memories too: a whole store `rollback` set aside");
  expect(row).not.toContain("a file this package left");
  expect(text(lines)).toContain("That is 2 memory stores: yours, and 1 whole memory store `rollback` set aside.");
  const park = planUninstall({ configPath: configPath(), config, home, verb: "park" });
  expect(text(planLines(park, "park", home, ".parked"))).toContain("memory stores rollback set aside");
});
