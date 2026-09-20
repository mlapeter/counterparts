/**
 * `counterparts start-fresh` — N1, against real temp homes.
 *
 * The one property every test here is really about: **the parked directory is
 * byte-identical before and after, and nothing is ever deleted.** So the
 * fingerprint below hashes EVERY file in the tree, the `-wal` and the `-shm`
 * included — unlike `cli.test.ts`'s, which skips the `-shm` on purpose because
 * it is asking a different question ("did a reader write?"). Here the question
 * is "did this directory change AT ALL", and a `-shm` that moved is a directory
 * that changed.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp HOME under
 * the OS temp dir and removes it in `afterEach`, even on failure; `run()` is
 * handed that home and an environment of the test's own, so nothing resolves
 * `$HOME` or `process.env`; and `test/preload.ts` has already redirected
 * `homedir()` into a temp tree besides. No test here spawns a process.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  BLANK_INFIX,
  OPEN_WINDOW_MS,
  PARKED_INFIX,
  guardedMove,
  pairedSuffix,
  park,
  parkRefusal,
  parkedPath,
  planStartFresh,
  planUndo,
  readLiveness,
  sameFilesystemRefusal,
  sight,
} from "../src/adapters/cli/start-fresh.js";
import type { ParkStep } from "../src/adapters/cli/start-fresh.js";
import { DATABASE_FILE, Store, dateOf, isStoreError, storeExists } from "../src/core/store/index.js";
import { PINNED_TAG, forgetPinnedBuild, makeOldFloorStore } from "./old-floor-fixture.js";
import type { OldFloorStore } from "./old-floor-fixture.js";

// ── the harness ─────────────────────────────────────────────────────────────

let home: string;
const made: string[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "counterparts-n1-"));
  made.push(home);
});

afterEach(() => {
  // Removed even when the body threw: a leaked temp dir is the one thing the
  // leftover count at the end of a suite run is watching for.
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
    // `null` means NO PROMPT AT ALL — the non-interactive console, which is a
    // refusal here rather than a silent yes.
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

function text(lines: readonly string[]): string {
  return lines.join("\n");
}

/**
 * THE ENVIRONMENT EVERY SPAWNED SHELL GETS.
 *
 * `test/preload.ts` says it in so many words: a child spawned with NO `env`
 * option inherits bun's original environ snapshot and sees the REAL home,
 * outside the home-redirect guard entirely. These shells run fully absolute
 * paths under the test's own temp home and never resolve a `~` — so they were
 * safe in effect — but "safe by construction, not by luck" is the rule the
 * preload asks for, and a curated env is one line (confirmation review NIT-1).
 */
function shellEnv(): Record<string, string> {
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    USERPROFILE: home,
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  };
}

/**
 * The guarded `mv` lines out of real output — from the block that reflects what
 * ACTUALLY RAN.
 *
 * A successful run prints two blocks: the one read before the confirmation, and
 * the one printed afterwards from the plan that ran (review M2). They are split
 * on that second heading rather than by counting lines, because the number of
 * lines varies (two when there is no snapshots folder, three when there is) and
 * a count would silently return one stale line from the first block.
 */
function guardedLines(out: readonly string[]): string[] {
  const after = out.findIndex((l) => l.includes("as it actually stands now"));
  const from = after === -1 ? out : out.slice(after);
  return from.filter((l) => l.trimStart().startsWith("if [ -e ")).map((l) => l.trim());
}

/** The whole tree, every byte, including the sidecars and the directory shape. */
function fingerprint(root: string): string {
  const parts: string[] = [];
  const walk = (path: string, rel: string): void => {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      parts.push(`${rel}:MISSING`);
      return;
    }
    if (stat.isDirectory()) {
      const names = readdirSync(path).sort();
      // The ENTRY LIST is part of the fingerprint: a file that appeared and one
      // that vanished must both show, not just a body that changed.
      parts.push(`${rel}/:[${names.join(",")}]`);
      for (const name of names) walk(join(path, name), `${rel}/${name}`);
      return;
    }
    parts.push(`${rel}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  };
  // RELATIVE to the root, so the fingerprint of a directory and of the same
  // directory under its parked name are comparable without string surgery.
  walk(root, "");
  return parts.join("|");
}

/** The environment every `run()` here gets: the guard armed, nothing else. */
function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", ...extra };
}

const base = (): string => join(home, ".counterparts");
const configPath = (): string => join(base(), "claude-code.json");
const storePath = (): string => join(base(), "store");
const snapshotsPath = (): string => join(base(), "snapshots");
const today = (): string => dateOf(Date.now());

/** A real install, through the console, exactly as a stranger would. */
async function install(extra: readonly string[] = []): Promise<Console_> {
  const c = consoleWith();
  const code = await run(
    ["install", "--config", configPath(), "--budget", "12000", "--name", "Mike", ...extra],
    { io: c.io, env: env(), home },
  );
  expect(code).toBe(EXIT.ok);
  return c;
}

/** One real memory, so the parked store is not an empty shell. */
async function note(body = "the parked store must survive this"): Promise<void> {
  const c = consoleWith();
  expect(await run(["note", body, "--dir", storePath()], { io: c.io, env: env(), home })).toBe(
    EXIT.ok,
  );
}

/** A snapshot directory with one copy in it, the shape F2 leaves behind. */
function seedSnapshots(): void {
  const copy = join(snapshotsPath(), "2026-09-19T00-00-00-000Z");
  mkdirSync(join(copy, "prose"), { recursive: true });
  writeFileSync(join(copy, "marker"), "yesterday");
}

// ── the pure half ───────────────────────────────────────────────────────────

describe("the parked name", () => {
  test("is the path, the infix and the UTC date, with a suffix when taken", () => {
    const taken = new Set(["/x/store.parked-2026-09-20", "/x/store.parked-2026-09-20-2"]);
    expect(parkedPath("/x/store", PARKED_INFIX, "2026-09-20", () => false)).toBe(
      "/x/store.parked-2026-09-20",
    );
    expect(parkedPath("/x/store", PARKED_INFIX, "2026-09-20", (c) => taken.has(c))).toBe(
      "/x/store.parked-2026-09-20-3",
    );
    expect(parkedPath("/x/store", BLANK_INFIX, "2026-09-20", () => false)).toBe(
      "/x/store.blank-2026-09-20",
    );
  });
});

describe("what may not be parked", () => {
  test("a store inside ~/.bansai is refused BY NAME", () => {
    // `forbiddenRoots()` hangs off `homedir()`, which `test/preload.ts` has
    // redirected into a temp tree — so this is the real guard, on a real path,
    // and it touches nothing of the owner's.
    const live = join(homedir(), ".bansai", "store");
    const refusal = parkRefusal("store", live, join(homedir(), "c.json"));
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("refused by name");
    expect(refusal).toContain(".bansai");
  });

  test("a store inside ~/.claude-engram is refused BY NAME", () => {
    const refusal = parkRefusal("store", join(homedir(), ".claude-engram"), join(home, "c.json"));
    expect(refusal).toContain("refused by name");
    expect(refusal).toContain(".claude-engram");
  });

  test("a SYMLINK into a forbidden root is refused on the path it REACHES", () => {
    // The F2 lesson: `assertSafeDataDir` is string math and follows no links, so
    // a check on the written spelling alone lets this through.
    const target = join(homedir(), ".bansai");
    mkdirSync(target, { recursive: true });
    const link = join(home, "innocent-looking-store");
    symlinkSync(target, link);
    const refusal = parkRefusal("store", link, join(home, "c.json"));
    expect(refusal).toContain("refused by name");
    expect(refusal).toContain(".bansai");
    rmSync(target, { recursive: true, force: true });
  });

  test("an ordinary symlink is refused too, with the reason", () => {
    const real = join(home, "real-store");
    mkdirSync(real, { recursive: true });
    const link = join(home, "link-store");
    symlinkSync(real, link);
    const refusal = parkRefusal("store", link, join(home, "c.json"));
    expect(refusal).toContain("SYMBOLIC LINK");
    expect(refusal).toContain(real);
  });

  test("a store that CONTAINS the configuration is refused", () => {
    const refusal = parkRefusal("store", base(), join(base(), "claude-code.json"));
    expect(refusal).toContain("CONTAINS the configuration");
  });

  test("the home directory and a filesystem root are refused", () => {
    expect(parkRefusal("store", homedir(), join(home, "c.json"))).toContain("home directory");
    expect(parkRefusal("store", "/", join(home, "c.json"))).toContain("filesystem root");
  });

  test("an ordinary directory beside the configuration is allowed", () => {
    mkdirSync(storePath(), { recursive: true });
    expect(parkRefusal("store", storePath(), configPath())).toBeNull();
    // And the same-filesystem pre-check passes for a sibling on one disk.
    expect(sameFilesystemRefusal(storePath())).toBeNull();
  });
});

describe("reading the ground", () => {
  test("`sight` answers about the FILESYSTEM, never about the floor", () => {
    expect(sight(join(home, "nope")).present).toBe(false);
    mkdirSync(join(home, "empty"));
    expect(sight(join(home, "empty"))).toMatchObject({ present: true, entries: 0 });
    // A directory holding nothing this build recognises still counts as a store
    // to park — which is exactly cut-over day, and exactly what `storeExists()`
    // would get wrong once the floor renames the database.
    mkdirSync(join(home, "old-floor"));
    writeFileSync(join(home, "old-floor", "some-future-database.sqlite"), "x");
    expect(sight(join(home, "old-floor")).entries).toBe(1);
  });

  test("a live session record is a refusing sign; a fresh -shm is only a warning", () => {
    const dir = join(home, "s");
    mkdirSync(join(dir, "sessions"), { recursive: true });
    const now = Date.now();
    writeFileSync(
      join(dir, "sessions", "abc.json"),
      JSON.stringify({ sessionId: "abc", scope: "/w", startedAt: now, lastBoundaryAt: now, endedAt: null }),
    );
    writeFileSync(join(dir, "counterparts.sqlite-shm"), "x");
    const reading = readLiveness(dir, now);
    expect(reading.signs.map((s) => s.what)).toEqual(["session abc"]);
    expect(reading.recent.map((s) => s.what)).toEqual(["counterparts.sqlite-shm"]);
  });

  test("an ENDED session, and one outside the window, are neither", () => {
    const dir = join(home, "s2");
    mkdirSync(join(dir, "sessions"), { recursive: true });
    const now = Date.now();
    writeFileSync(
      join(dir, "sessions", "done.json"),
      JSON.stringify({ sessionId: "done", scope: "/w", startedAt: now, lastBoundaryAt: now, endedAt: now }),
    );
    writeFileSync(
      join(dir, "sessions", "old.json"),
      JSON.stringify({
        sessionId: "old",
        scope: "/w",
        startedAt: now,
        lastBoundaryAt: now - OPEN_WINDOW_MS - 1000,
        endedAt: null,
      }),
    );
    expect(readLiveness(dir, now).signs).toEqual([]);
  });
});

// ── the command ─────────────────────────────────────────────────────────────

describe("start-fresh, end to end", () => {
  test("parks the store and its snapshots, and leaves the parked tree byte-identical", async () => {
    await install();
    await note();
    seedSnapshots();

    const before = fingerprint(storePath());
    const snapsBefore = fingerprint(snapshotsPath());
    const configBefore = readFileSync(configPath());
    const credsBefore = readFileSync(join(base(), "credentials.env"));
    const credsMode = statSync(join(base(), "credentials.env")).mode;

    const c = consoleWith();
    const code = await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    expect(code).toBe(EXIT.ok);

    const parkedStore = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const parkedSnaps = `${snapshotsPath()}.${PARKED_INFIX}-${today()}`;
    expect(existsSync(parkedStore)).toBe(true);
    expect(existsSync(parkedSnaps)).toBe(true);

    // THE PROMISE. Every byte, every sidecar, every directory entry.
    expect(fingerprint(parkedStore)).toBe(before);
    expect(fingerprint(parkedSnaps)).toBe(snapsBefore);

    // The configuration and the credentials, untouched.
    expect(readFileSync(configPath())).toEqual(configBefore);
    expect(readFileSync(join(base(), "credentials.env"))).toEqual(credsBefore);
    expect(statSync(join(base(), "credentials.env")).mode).toBe(credsMode);

    // And a blank store where the old one was.
    const fresh = Store.open({ dir: storePath(), observer: true });
    try {
      expect(fresh.list().length).toBe(0);
    } finally {
      fresh.close();
    }
  });

  test("the store the configuration names is the one that moves, and the blank one lands there", async () => {
    await install();
    await note();
    // A DECOY in the environment. `installLayout` reads COUNTERPARTS_DATA_DIR
    // when no `--dir` is given, and QUICKSTART teaches people to export it — so
    // this is the shell a real owner runs the command in.
    const decoy = join(home, "decoy-store");
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env({ COUNTERPARTS_DATA_DIR: decoy }),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(existsSync(decoy)).toBe(false);
    // `storeExists` is right for the NEW store and wrong for the parked one, which
    // is the whole distinction this command draws: the new store is on the
    // running build's floor, so asking for its database BY NAME is honest.
    expect(storeExists(storePath())).toBe(true);
  });

  test("records its own beginning in the new store, and `status` says so", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home });

    const s = consoleWith();
    expect(await run(["status", "--dir", storePath()], { io: s.io, env: env(), home })).toBe(EXIT.ok);
    expect(text(s.out)).toContain(`Began: ${today()}`);
    expect(text(s.out)).toContain(`${PARKED_INFIX}-${today()}`);
    expect(text(s.out)).toContain("untouched");
  });

  test("a second run the same day parks beside the first, never over it", async () => {
    await install();
    await note();
    const first = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: first.io, env: env(), home });
    const firstParked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const firstFingerprint = fingerprint(firstParked);

    const second = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
        io: second.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(existsSync(`${firstParked}-2`)).toBe(true);
    // The FIRST one is untouched — nothing is ever overwritten, and nothing is
    // ever deleted.
    expect(fingerprint(firstParked)).toBe(firstFingerprint);
  });

  test("it parks a store the running build REFUSES to open", async () => {
    await install();
    // An unclassified top-level entry: `assertLayout()` refuses this store at
    // open (§5 G11). The REAL cut-over case — a pre-rows store refused by the
    // floor — has its own block at the bottom of this file, built by the build
    // that wrote that floor. This one stays because it is a DIFFERENT refusal,
    // and the property is "any store this build will not open".
    writeFileSync(join(storePath(), "a-name-this-build-does-not-know"), "from another floor");
    expect(() => Store.open({ dir: storePath(), observer: true })).toThrow();

    const before = fingerprint(storePath());
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    expect(fingerprint(parked)).toBe(before);
    // And the new store opens, because it is this build's own.
    const fresh = Store.open({ dir: storePath(), observer: true });
    fresh.close();
  });

  test("snapshots pointed somewhere else are LEFT ALONE, and it says so", async () => {
    await install();
    await note();
    const elsewhere = join(home, "my-own-backups");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "keep-me"), "mine");
    const config = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    config["snapshots"] = { dir: elsewhere };
    writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("LEFT ALONE");
    expect(existsSync(join(elsewhere, "keep-me"))).toBe(true);
    expect(existsSync(`${elsewhere}.${PARKED_INFIX}-${today()}`)).toBe(false);
  });
});

describe("the dry run", () => {
  test("prints every rename and every file, and changes nothing at all", async () => {
    await install();
    await note();
    seedSnapshots();
    const before = fingerprint(base());

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--dry-run"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);

    const out = text(c.out);
    expect(out).toContain(`${snapshotsPath()}\n    -> ${snapshotsPath()}.${PARKED_INFIX}-${today()}`);
    expect(out).toContain(`${storePath()}\n    -> ${storePath()}.${PARKED_INFIX}-${today()}`);
    expect(out).toContain("Then it will create a blank store at:");
    expect(out).toContain(configPath());
    expect(out).toContain("unchanged");
    expect(out).toContain("Dry run. Nothing has been moved and nothing has been written.");
    // The rollback is printed before anything moves, dry run or not — and each
    // line is GUARDED (review M3): a bare `mv` nests instead of refusing.
    expect(out).toContain(`mv "${storePath()}" "${storePath()}.${BLANK_INFIX}-${today()}"`);
    expect(out).toContain(`if [ -e "${storePath()}.${BLANK_INFIX}-${today()}" ]; then`);

    expect(fingerprint(base())).toBe(before);
  });
});

describe("the refusals", () => {
  test("--dir is refused in words, not ignored", async () => {
    await install();
    const before = fingerprint(base());
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--dir", storePath(), "--yes"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("takes no --dir");
    expect(fingerprint(base())).toBe(before);
  });

  test("a non-interactive console with no --yes refuses and changes nothing", async () => {
    await install();
    await note();
    const before = fingerprint(base());
    const c = consoleWith(null);
    expect(
      await run(["start-fresh", "--config", configPath()], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("not an interactive console");
    expect(fingerprint(base())).toBe(before);
  });

  test("a confirmation that does not match refuses and changes nothing", async () => {
    await install();
    await note();
    const before = fingerprint(base());
    const c = consoleWith(["yes"]);
    expect(
      await run(["start-fresh", "--config", configPath()], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("did not match");
    expect(fingerprint(base())).toBe(before);
  });

  test("the confirmation asks for the PARKED NAME, and that answer proceeds", async () => {
    await install();
    await note();
    const word = `${basename(storePath())}.${PARKED_INFIX}-${today()}`;
    const c = consoleWith([word]);
    expect(
      await run(["start-fresh", "--config", configPath()], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    expect(text(c.asked)).toContain(word);
    expect(existsSync(`${storePath()}.${PARKED_INFIX}-${today()}`)).toBe(true);
  });

  test("a live session record refuses, and nothing moves", async () => {
    await install();
    await note();
    const now = Date.now();
    mkdirSync(join(storePath(), "sessions"), { recursive: true });
    writeFileSync(
      join(storePath(), "sessions", "live.json"),
      JSON.stringify({
        sessionId: "live",
        scope: join(home, "a-project"),
        startedAt: now,
        lastBoundaryAt: now,
        endedAt: null,
      }),
    );
    const before = fingerprint(base());
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("session live");
    expect(text(c.err)).toContain("Close every Claude Code session");
    expect(fingerprint(base())).toBe(before);
  });

  test("a configuration that names no store refuses rather than guessing", async () => {
    mkdirSync(base(), { recursive: true });
    writeFileSync(configPath(), `${JSON.stringify({ owner: true }, null, 2)}\n`);
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain('names no "dataDir"');
  });

  test("a configuration that will not parse refuses", async () => {
    mkdirSync(base(), { recursive: true });
    writeFileSync(configPath(), "{ not json");
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("will not be understood");
  });

  test("an UNNAMED configuration refuses under the explicit-dir guard", async () => {
    const c = consoleWith();
    expect(await run(["start-fresh", "--yes"], { io: c.io, env: env(), home })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("no configuration was named");
  });

  test("it refuses under observer, like every owner operation", async () => {
    await install();
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--observer", "--yes"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("observer stance");
  });
});

describe("a machine with nothing on it", () => {
  test("no configuration at all: it is an ordinary first install, and says so", async () => {
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--name", "Mike"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("There is no configuration at that path");
    // THE STORE LINE IS NEVER BLANK on this arm (review B1) — it names where
    // the install will land, before it lands there.
    expect(text(c.out)).toContain(`Store:         ${storePath()}`);
    expect(existsSync(configPath())).toBe(true);
    // `storeExists` is right for the NEW store and wrong for the parked one, which
    // is the whole distinction this command draws: the new store is on the
    // running build's floor, so asking for its database BY NAME is honest.
    expect(storeExists(storePath())).toBe(true);
    // Nothing was parked, so nothing claims to have been.
    expect(readdirSync(base()).some((n) => n.includes(PARKED_INFIX))).toBe(false);
  });

  test("a configuration whose store is not there yet: also just an install", async () => {
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Nothing to park");
    // `storeExists` is right for the NEW store and wrong for the parked one, which
    // is the whole distinction this command draws: the new store is on the
    // running build's floor, so asking for its database BY NAME is honest.
    expect(storeExists(storePath())).toBe(true);
  });
});

// ── interruption ────────────────────────────────────────────────────────────

describe("killed between any two steps", () => {
  test("the renames stop at the first failure and undo nothing", async () => {
    await install();
    await note();
    seedSnapshots();
    const storeBefore = fingerprint(storePath());

    const plan = planStartFresh({
      configPath: configPath(),
      configPresent: true,
      dataDir: storePath(),
      snapshotsConfigured: undefined,
      now: Date.now(),
      home,
    });
    expect(plan.parks.map((p) => p.label)).toEqual(["snapshots", "store"]);

    // FAIL AT STEP 2 — the store's own rename, the worst place to be killed.
    const seen: ParkStep[] = [];
    const outcome = park(plan.parks, {
      rename: (from, to) => {
        seen.push({ label: "", from, to });
        if (seen.length === 2) throw Object.assign(new Error("injected"), { code: "EIO" });
        renameSync(from, to);
      },
    });
    expect(outcome.done.map((s) => s.label)).toEqual(["snapshots"]);
    expect(outcome.failed?.label).toBe("store");
    expect(outcome.error).toContain("EIO");
    // The store is exactly where it was, byte for byte: a failed rename is not
    // a half-move, and nothing here tries to "recover" by renaming again.
    expect(fingerprint(storePath())).toBe(storeBefore);
  });

  test("a run interrupted after the store's rename is FINISHED by the next one", async () => {
    await install();
    await note();
    seedSnapshots();

    // Exactly the state a kill between the rename and the install leaves: the
    // configuration names a directory that is not there.
    const plan = planStartFresh({
      configPath: configPath(),
      configPresent: true,
      dataDir: storePath(),
      snapshotsConfigured: undefined,
      now: Date.now(),
      home,
    });
    const outcome = park(plan.parks);
    expect(outcome.failed).toBeNull();
    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const parkedBefore = fingerprint(parked);
    expect(existsSync(storePath())).toBe(false);

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("A previous run was interrupted");
    expect(text(c.out)).toContain(parked);
    // `storeExists` is right for the NEW store and wrong for the parked one, which
    // is the whole distinction this command draws: the new store is on the
    // running build's floor, so asking for its database BY NAME is honest.
    expect(storeExists(storePath())).toBe(true);
    // It finished the job; it did not park anything a second time.
    expect(fingerprint(parked)).toBe(parkedBefore);
    expect(existsSync(`${parked}-2`)).toBe(false);

    // And the new store still knows where the old one went.
    const s = consoleWith();
    await run(["status", "--dir", storePath()], { io: s.io, env: env(), home });
    expect(text(s.out)).toContain(parked);
  });

  test("a kill between the install and the record leaves a usable store, and says nothing false", async () => {
    // The record is written last and never retried. A store without it is a
    // store `status` simply does not describe the beginning of — which is the
    // honest outcome, and is asserted here so nobody "fixes" it into a lie.
    await install();
    const fresh = Store.open({ dir: storePath(), observer: true });
    try {
      expect(fresh.getMeta("store.started")).toBeUndefined();
    } finally {
      fresh.close();
    }
    const s = consoleWith();
    await run(["status", "--dir", storePath()], { io: s.io, env: env(), home });
    expect(text(s.out)).not.toContain("This store began on");
  });
});


// ── cut-over day ────────────────────────────────────────────────────────────

describe(`cut-over day: this build, and a store written by ${PINNED_TAG}`, () => {
  let old: OldFloorStore | null = null;

  afterEach(() => {
    old?.cleanup();
    old = null;
  });
  afterAll(forgetPinnedBuild);

  /** An `install`ed base whose `dataDir` holds a REAL v5 store. */
  async function withOldFloorStore(): Promise<void> {
    await install();
    old = makeOldFloorStore();
    // The blank store `install` just made is in the way. Removing a store this
    // test created two lines ago is not the thing `start-fresh` refuses to do.
    rmSync(storePath(), { recursive: true, force: true });
    // A RENAME, so the fixture's bytes — the `-wal` above all — arrive unchanged.
    renameSync(old.dir, storePath());
    old.dir = storePath();
    // And the snapshots folder as cut-over day really has it: copies of the
    // OLD floor, which F5's rotation recognises and never deletes or counts.
    // Parking it is belt and braces, and this is the shape it is braced for.
    const copy = join(snapshotsPath(), "2026-09-19T00-00-00-000Z");
    mkdirSync(join(copy, "prose", "memories"), { recursive: true });
    writeFileSync(join(copy, "prose", "memories", "mem_old.md"), "an old-floor copy");
    writeFileSync(join(copy, "operational.sqlite"), "not really a database, and never opened");
  }

  test("the fixture really is a pre-rows store, with pages only in its -wal", async () => {
    await withOldFloorStore();
    expect(existsSync(join(storePath(), "operational.sqlite"))).toBe(true);
    expect(existsSync(join(storePath(), "prose"))).toBe(true);
    expect(existsSync(join(storePath(), "versions"))).toBe(true);
    // The sharp part: the database file is a stub and the sidecar holds the
    // database. Anything that opens this store may checkpoint on close and move
    // those bytes — which is what "never opens it" is protecting.
    const wal = statSync(join(storePath(), "operational.sqlite-wal")).size;
    expect(wal).toBeGreaterThan(statSync(join(storePath(), "operational.sqlite")).size);
    // And this build refuses it BY NAME, which is the whole reason N1 exists.
    let refused: unknown;
    try {
      Store.open({ dir: storePath(), observer: true });
    } catch (err) {
      refused = err;
    }
    expect(isStoreError(refused, "STORE_PRE_ROWS")).toBe(true);
  });

  test("start-fresh parks it BYTE-IDENTICAL and never reaches the pre-rows refusal", async () => {
    await withOldFloorStore();
    const before = fingerprint(storePath());

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);

    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    expect(fingerprint(parked)).toBe(before);
    expect(statSync(join(parked, "operational.sqlite-wal")).size).toBeGreaterThan(0);

    // If any step of this command had opened the old store, F5's refusal would
    // have surfaced. Nothing in the output mentions it, because nothing tried.
    const all = `${text(c.out)}\n${text(c.err)}`;
    expect(all).not.toContain("STORE_PRE_ROWS");
    expect(all).not.toContain("was written before this build's floor");
    // What it DOES say is that the store it is moving is on the old floor —
    // read from FILENAMES, never from the database.
    expect(text(c.out)).toContain("OLD FLOOR");
    expect(text(c.out)).toContain(PINNED_TAG);

    // F5's refusal is itself byte-safe, so asserting it here cannot be what
    // moved anything — and this proves both claims at once.
    expect(() => Store.open({ dir: parked, observer: true })).toThrow();
    expect(fingerprint(parked)).toBe(before);

    // The old-floor snapshot copies went with it, untouched.
    const parkedSnaps = `${snapshotsPath()}.${PARKED_INFIX}-${today()}`;
    expect(existsSync(join(parkedSnaps, "2026-09-19T00-00-00-000Z", "prose", "memories", "mem_old.md"))).toBe(
      true,
    );
    expect(existsSync(snapshotsPath())).toBe(false);
  });

  test("the dry run against an old-floor store changes nothing", async () => {
    await withOldFloorStore();
    const before = fingerprint(base());
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--dry-run"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(fingerprint(base())).toBe(before);
    expect(text(c.out)).toContain("OLD FLOOR");
  });

  test("the store it creates in its place is a NEW-floor store that opens", async () => {
    await withOldFloorStore();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home });

    expect(existsSync(join(storePath(), DATABASE_FILE))).toBe(true);
    expect(existsSync(join(storePath(), "prose"))).toBe(false);
    expect(storeExists(storePath())).toBe(true);
    const fresh = Store.open({ dir: storePath(), observer: true });
    try {
      expect(fresh.list().length).toBe(0);
    } finally {
      fresh.close();
    }

    const s = consoleWith();
    expect(await run(["status", "--dir", storePath()], { io: s.io, env: env(), home })).toBe(EXIT.ok);
    expect(text(s.out)).toContain(`Began: ${today()}`);
    expect(text(s.out)).toContain(`${PARKED_INFIX}-${today()}`);
  });

  test("the printed rollback lines put the old-floor store back, unchanged", async () => {
    await withOldFloorStore();
    const before = fingerprint(storePath());
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home });

    // The lines AS PRINTED, parsed back out of the output and RUN THROUGH A
    // SHELL — so what is proved is the text the owner pastes, guards and all,
    // rather than a second copy of the intention behind it.
    const lines = guardedLines(c.out);
    // Three: park the blank store, put the old one back, put the snapshots back.
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const r = spawnSync("/bin/sh", ["-c", line], { encoding: "utf8", env: shellEnv() });
      expect(r.status).toBe(0);
      expect(`${r.stdout}${r.stderr}`).not.toContain("REFUSING");
    }

    expect(fingerprint(storePath())).toBe(before);
    expect(existsSync(join(snapshotsPath(), "2026-09-19T00-00-00-000Z", "operational.sqlite"))).toBe(
      true,
    );
    // The blank store was PARKED by that first line, not removed.
    expect(existsSync(`${storePath()}.${BLANK_INFIX}-${today()}`)).toBe(true);
    // And the restored store is the pre-rows one again, refused by name.
    let refused: unknown;
    try {
      Store.open({ dir: storePath(), observer: true });
    } catch (err) {
      refused = err;
    }
    expect(isStoreError(refused, "STORE_PRE_ROWS")).toBe(true);
  });
});

describe("what counts as a store, on four kinds of directory", () => {
  /**
   * F5 changed `storeExists()` under this command: it now answers true for a
   * PRE-ROWS store as well as a new-floor one, so ~20 console commands reach the
   * named refusal instead of "there is no store here, run init". That is right
   * for them and still not the question this command asks, which is "is there
   * anything here I would be writing on top of".
   *
   * The four directories below are where the two readings are compared. They
   * agree on three and differ on the fourth, and the difference is in the safe
   * direction.
   */
  test("no store, old floor, new floor, and a directory wearing both names", async () => {
    await install();
    const newFloor = storePath();
    const none = join(home, "nothing-here");
    const empty = join(home, "empty");
    mkdirSync(empty, { recursive: true });
    const oldFloor = join(home, "old-floor");
    mkdirSync(join(oldFloor, "prose"), { recursive: true });
    writeFileSync(join(oldFloor, "operational.sqlite"), "old");
    const both = join(home, "both");
    mkdirSync(join(both, "prose"), { recursive: true });
    writeFileSync(join(both, "operational.sqlite"), "old");
    writeFileSync(join(both, DATABASE_FILE), "new");

    // NOTHING THERE, and an EMPTY directory: nothing to park either way.
    expect(sight(none).present).toBe(false);
    expect(sight(empty).entries).toBe(0);
    expect(storeExists(none)).toBe(false);
    expect(storeExists(empty)).toBe(false);

    // OLD FLOOR: both readings say there is something. `storeExists` says so
    // only since F5; `sight` said so before and after, because it never asked
    // the floor.
    expect(sight(oldFloor).entries).toBeGreaterThan(0);
    expect(storeExists(oldFloor)).toBe(true);

    // NEW FLOOR, and a directory wearing BOTH names: something, both ways.
    expect(sight(newFloor).entries).toBeGreaterThan(0);
    expect(storeExists(newFloor)).toBe(true);
    expect(sight(both).entries).toBeGreaterThan(0);
    expect(storeExists(both)).toBe(true);
  });

  test("a half-made store — a `cache/` and nothing else — is PARKED, not written over", async () => {
    // The one place the two readings disagree, and the reason this command keeps
    // its own. `storeExists` says false (no database by either name, no pre-rows
    // marker), which would send `install` in to mint a store beside a stale box
    // 3 that belongs to a different store's rows. `sight` says "there is
    // something here", so it is parked and the new store starts clean.
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    mkdirSync(join(storePath(), "cache"), { recursive: true });
    writeFileSync(join(storePath(), "cache", "cache.sqlite"), "somebody else's index");
    expect(storeExists(storePath())).toBe(false);
    expect(sight(storePath()).entries).toBe(1);

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    expect(existsSync(join(parked, "cache", "cache.sqlite"))).toBe(true);
    expect(existsSync(join(storePath(), "cache", "cache.sqlite"))).toBe(true);
    // The new store's cache is its own, not the one that was parked.
    expect(readFileSync(join(storePath(), "cache", "cache.sqlite")).length).not.toBe(
      readFileSync(join(parked, "cache", "cache.sqlite")).length,
    );
  });
});

// ── the adversarial review's findings, one test each ─────────────────────────

describe("B1 — a one-character --config typo", () => {
  test("REFUSES rather than installing into, and stamping, the store at the default path", async () => {
    await install();
    await note();
    const before = fingerprint(base());

    // The reviewer's exact typo: one extra character on the config path.
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", `${configPath()}n`, "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("already holds something");
    // Nothing written anywhere — not the store, not a stray `claude-code.jsonn`.
    expect(fingerprint(base())).toBe(before);
    expect(existsSync(`${configPath()}n`)).toBe(false);

    // And the store still says what it always said.
    const s = consoleWith();
    await run(["status", "--dir", storePath()], { io: s.io, env: env(), home });
    expect(text(s.out)).toContain("Memories: 1");
    expect(text(s.out)).not.toContain("Began:");
  });

  test("the Store: line is never blank, so the screen cannot contradict itself", async () => {
    const c = consoleWith();
    await run(["start-fresh", "--config", `${configPath()}n`, "--dry-run"], {
      io: c.io,
      env: env(),
      home,
    });
    // On a machine with nothing on it this arm still works — and it NAMES where
    // it will land before it lands there.
    expect(text(c.out)).toContain(`Store:         ${storePath()}`);
    expect(text(c.out)).not.toContain("Store:         \n");
  });

  test("COUNTERPARTS_DATA_DIR cannot redirect the cold arm either", async () => {
    const decoy = join(home, "decoy-store");
    const c = consoleWith();
    // No config anywhere, and a decoy exported — the second half of B1.
    expect(
      await run(["start-fresh", "--config", configPath(), "--name", "Mike"], {
        io: c.io,
        env: env({ COUNTERPARTS_DATA_DIR: decoy }),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(existsSync(decoy)).toBe(false);
    expect(storeExists(storePath())).toBe(true);
  });

  test("a config one character from a real one refuses by name", async () => {
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", `${configPath()}n`, "--yes"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("one character away from a configuration that exists");
  });

  test("the record is written ONLY when this run made the store", async () => {
    // The resume arm lands on a store that is already there when a previous run
    // created it and died before the record. Stamping "began today" into a
    // store this run did not make is the falsehood B1 ends.
    await install();
    await note();
    const fresh = Store.open({ dir: storePath() });
    try {
      expect(fresh.getMeta("store.started")).toBeUndefined();
    } finally {
      fresh.close();
    }
    // An ordinary `install` never writes it, and `start-fresh` refusing never
    // reaches it: proved by the refusal test above asserting no `Began:` line.
  });
});

describe("M1 — install can no longer refuse after the parks", () => {
  test("a fractional injectionBudgetBytes is caught BEFORE anything moves", async () => {
    await install();
    await note();
    const config = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    config["injectionBudgetBytes"] = 8192.5;
    writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
    const configBytes = readFileSync(configPath());

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    // It says so, does not pass it on, and the run completes.
    expect(text(c.out)).toContain("is not a whole number of bytes");
    expect(text(c.err)).not.toContain("--budget takes a positive whole number");
    expect(existsSync(`${storePath()}.${PARKED_INFIX}-${today()}`)).toBe(true);
    expect(storeExists(storePath())).toBe(true);
    // And the configuration is still byte-for-byte what it was.
    expect(readFileSync(configPath())).toEqual(configBytes);
  });

  test("the record is NOT written into a store this run found already there", async () => {
    // B1's last clause, on the arm where it is reachable: the resume arm lands
    // on the live path, and a hook can mint a store there between the plan and
    // the install (M4's reproduction). `install` then says "Store already
    // present" — and stamping "began today" into it would be a falsehood on a
    // surface the owner cannot unset from the console.
    await install();
    await note();
    renameSync(storePath(), `${storePath()}.${PARKED_INFIX}-${today()}`);

    // The mint happens at the one moment it can: after the plan has read the
    // ground and before `install` looks. The output line that precedes the look
    // is the seam — a real hook needs no seam, it just has to be quick.
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (line) => {
        out.push(line);
        if (line.startsWith("Creating the blank store") && !existsSync(storePath())) {
          const minted = Store.open({ dir: storePath() });
          minted.close();
        }
      },
      err: (line) => err.push(line),
    };
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], { io, env: env(), home }),
    ).toBe(EXIT.ok);

    // `install` found a store already there and said so; the record is NOT
    // written into it, because this run did not make it.
    expect(text(out)).toContain("Store already present");
    const store = Store.open({ dir: storePath(), observer: true });
    try {
      expect(store.getMeta("store.started")).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

describe("M2 — the way back always names the plan that ran", () => {
  test("the date is frozen, so the printed block and the renames cannot disagree", async () => {
    await install();
    await note();
    seedSnapshots();
    // A clock that crosses UTC midnight between the two reads. Before the fix
    // the printed lines named yesterday and the renames used today.
    const midnight = Date.parse("2026-09-20T23:59:59.500Z");
    let call = 0;
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env(),
        home,
        now: () => {
          call += 1;
          return call === 1 ? midnight : midnight + 2000;
        },
      }),
    ).toBe(EXIT.ok);
    const parked = `${storePath()}.${PARKED_INFIX}-2026-09-20`;
    expect(existsSync(parked)).toBe(true);
    // Every printed line names a path that exists.
    for (const line of guardedLines(c.out)) {
      const src = /else mv "([^"]+)"/.exec(line);
      expect(src).not.toBeNull();
      expect(existsSync(src?.[1] ?? "")).toBe(true);
    }
  });

  test("the way back is re-printed AFTER the renames, from the plan that ran", async () => {
    await install();
    await note();
    seedSnapshots();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    expect(text(c.out)).toContain("The way back, as it actually stands now");
    // Two blocks: the one read before, and the one that is true after.
    expect(c.out.filter((l) => l.trimStart().startsWith("if [ -e ")).length).toBe(6);
  });

  test("a parked name taken while the human answers REFUSES instead of running another plan", async () => {
    await install();
    await note();
    const before = fingerprint(base());
    const c = consoleWith([`${basename(storePath())}.${PARKED_INFIX}-${today()}`]);
    // The prompt answer takes the parked name, exactly as a decoy would.
    const io: Io = {
      out: c.io.out,
      err: c.io.err,
      prompt: async (q: string): Promise<string> => {
        mkdirSync(`${storePath()}.${PARKED_INFIX}-${today()}`, { recursive: true });
        return (await (c.io.prompt as (s: string) => Promise<string>)(q)).trim();
      },
    };
    expect(
      await run(["start-fresh", "--config", configPath()], { io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("the ground moved while this was waiting for you");
    // Only the decoy appeared; the store did not move.
    expect(existsSync(storePath())).toBe(true);
    expect(before.length).toBeGreaterThan(0);
  });
});

describe("M3 — the printed lines refuse rather than nesting", () => {
  test("a guarded line run against an existing destination REFUSES, and nothing nests", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const lines = guardedLines(c.out);
    const restore = lines.find((l) => l.includes(`else mv "${storePath()}.${PARKED_INFIX}-`));
    expect(restore).toBeDefined();

    // The destination exists — the state M4's hook leaves, and the state the
    // reviewer's bare `mv` nested into.
    expect(existsSync(storePath())).toBe(true);
    const r = spawnSync("/bin/sh", ["-c", restore as string], { encoding: "utf8", env: shellEnv() });
    // NON-ZERO on a refusal, so a pasted block stops instead of sailing past it.
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("REFUSING");
    // NOT nested: the parked store is still a sibling, not a child.
    expect(existsSync(join(storePath(), `${basename(storePath())}.${PARKED_INFIX}-${today()}`))).toBe(
      false,
    );
    expect(existsSync(`${storePath()}.${PARKED_INFIX}-${today()}`)).toBe(true);
  });

  test("a path with a space in it survives the copy-paste", () => {
    const line = guardedMove("/tmp/a b/store", "/tmp/a b/store.parked-2026-09-20");
    expect(line).toContain('mv "/tmp/a b/store" "/tmp/a b/store.parked-2026-09-20"');
    expect(line).toContain('if [ -e "/tmp/a b/store.parked-2026-09-20" ]; then');
  });
});

describe("M4 — the blank store arrives atomically", () => {
  test("it is built in a sibling and moved in, so the window is two renames", async () => {
    await install();
    await note();
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    // The temp sibling is gone — it became the store.
    expect(readdirSync(base()).filter((n) => n.includes(".new-")).length).toBe(0);
    expect(storeExists(storePath())).toBe(true);
    expect(text(c.out)).toContain("Building the blank store beside your memory first");
  });

  test("more than one parked sibling means the record says NOTHING rather than guessing", async () => {
    await install();
    await note();
    // Two parked siblings and no store: the state a hook-minted half store
    // leaves behind, where the newest NAME is an empty shell.
    const real = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const shell_ = `${storePath()}.${PARKED_INFIX}-${today()}-2`;
    renameSync(storePath(), real);
    mkdirSync(shell_, { recursive: true });

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("more than one parked store");
    const s = consoleWith();
    await run(["status", "--dir", storePath()], { io: s.io, env: env(), home });
    expect(text(s.out)).toContain("Began:");
    // The one line that would have named an empty shell says nothing instead.
    expect(text(s.out)).not.toContain(shell_);
  });
});

describe("M5 — a dataDir that is not absolute", () => {
  for (const [label, value] of [
    ["a relative path", "relative-store"],
    ["a leading tilde", "~/.counterparts/store"],
  ] as const) {
    test(`${label} is refused by name, and nothing in the working directory moves`, async () => {
      await install();
      const config = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
      config["dataDir"] = value;
      writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
      const c = consoleWith();
      expect(
        await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
          io: c.io,
          env: env(),
          home,
        }),
      ).toBe(EXIT.refused);
      expect(text(c.err)).toContain("is not an absolute path");
      expect(existsSync(join(process.cwd(), value))).toBe(false);
    });
  }
});

describe("the way back, as a command", () => {
  test("--undo parks the blank store and puts the parked one back", async () => {
    await install();
    await note("the espresso machine is a Rancilio Silvia");
    seedSnapshots();
    const before = fingerprint(storePath());

    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    expect(storeExists(storePath())).toBe(true);

    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    // The memory is back, byte for byte, and the blank store is PARKED.
    expect(fingerprint(storePath())).toBe(before);
    expect(existsSync(`${storePath()}.${BLANK_INFIX}-${today()}`)).toBe(true);
    expect(existsSync(snapshotsPath())).toBe(true);
    expect(existsSync(`${storePath()}.${PARKED_INFIX}-${today()}`)).toBe(false);
  });

  test("--undo asks for the PARKED name, and --yes alone is refused the same way", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    // `--yes` alone displaces a store with something in it — the same hazard,
    // the same rule.
    const bare = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes"], {
        io: bare.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(bare.err)).toContain("--nothing-is-open");

    // And the word typed back is the DATED parked name, never the bare `store`
    // every store is called.
    const word = `${basename(storePath())}.${PARKED_INFIX}-${today()}`;
    const typed = consoleWith([word]);
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo"], {
        io: typed.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(typed.asked)).toContain(word);
  });

  test("--undo refuses when it cannot tell which parked store is the memory", async () => {
    await install();
    renameSync(storePath(), `${storePath()}.${PARKED_INFIX}-${today()}`);
    mkdirSync(`${storePath()}.${PARKED_INFIX}-${today()}-2`, { recursive: true });
    mkdirSync(storePath(), { recursive: true });
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("will not guess");
  });

  test("--undo LEAVES a parked snapshots folder when one is already back", async () => {
    // The reachable collision, and the one the rotation makes on its own at the
    // first boundary after a fresh start. Refusing the whole undo over a folder
    // of copies would be m2's mistake again; merging would be M3's.
    await install();
    await note();
    seedSnapshots();
    const before = fingerprint(storePath());
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    mkdirSync(join(snapshotsPath(), "2026-09-21T00-00-00-000Z"), { recursive: true });

    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(u.out)).toContain("LEFT WHERE IT IS");
    // The memory came back; both snapshots folders are still there, unmerged.
    expect(fingerprint(storePath())).toBe(before);
    expect(existsSync(join(snapshotsPath(), "2026-09-21T00-00-00-000Z"))).toBe(true);
    expect(
      existsSync(join(`${snapshotsPath()}.${PARKED_INFIX}-${today()}`, "2026-09-19T00-00-00-000Z")),
    ).toBe(true);
  });
});

describe("the SHOULDs", () => {
  test("--yes alone is refused on a store with anything in it", async () => {
    await install();
    await note();
    const before = fingerprint(base());
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--nothing-is-open");
    expect(fingerprint(base())).toBe(before);
  });

  test("--yes alone is fine on an EMPTY store, which is what a script has", async () => {
    await install();
    rmSync(storePath(), { recursive: true, force: true });
    mkdirSync(storePath(), { recursive: true });
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.ok);
  });

  test("a symlinked snapshots folder LEAVES the snapshots and still parks the store", async () => {
    await install();
    await note();
    const real = join(home, "snapshots-on-another-disk");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "keep"), "mine");
    symlinkSync(real, snapshotsPath());

    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("LEFT WHERE IT IS");
    // The store moved; the symlink and its target did not.
    expect(existsSync(`${storePath()}.${PARKED_INFIX}-${today()}`)).toBe(true);
    expect(lstatSync(snapshotsPath()).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(real, "keep"), "utf8")).toBe("mine");
  });

  test("the pgrep advice names what to look for and what is noise", async () => {
    await install();
    await note();
    const c = consoleWith([""]);
    await run(["start-fresh", "--config", configPath()], { io: c.io, env: env(), home });
    const out = text(c.out);
    for (const needle of ["serve.ts", "dashboard.ts", "hook.ts", "runner.ts", "IGNORE anything"]) {
      expect(out).toContain(needle);
    }
    expect(out).not.toContain("THE ONLY LINE SHOULD BE THIS COMMAND ITSELF");
  });

  test("the store and its snapshots always wear the SAME suffix", () => {
    const taken = new Set([`/x/store.${PARKED_INFIX}-2026-09-20`]);
    // The store's first choice is taken; both must move to `-2` together.
    expect(pairedSuffix(["/x/store", "/x/snapshots"], "2026-09-20", (c) => taken.has(c))).toBe(
      `.${PARKED_INFIX}-2026-09-20-2`,
    );
  });

  test("--name is validated", async () => {
    await install();
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--name", "  ", "--yes"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--name is the owner's name");
  });
});

// ── the confirmation review's findings, one test each ────────────────────────

describe("BLOCKER-1 — --undo runs the SAME guard ring as the forward direction", () => {
  /** A config whose `dataDir` points wherever the test says, plus a parked
   *  sibling exactly as a forward run would have left one. */
  function layoutAt(dir: string): void {
    mkdirSync(base(), { recursive: true });
    writeFileSync(
      configPath(),
      `${JSON.stringify({ dataDir: dir, credentialsFile: join(base(), "credentials.env") }, null, 2)}\n`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "LIVE"), "the live one");
    mkdirSync(`${dir}.${PARKED_INFIX}-${today()}`, { recursive: true });
    writeFileSync(join(`${dir}.${PARKED_INFIX}-${today()}`, "PARKED"), "the parked one");
  }

  for (const forbidden of [".bansai", ".claude-engram"] as const) {
    test(`a dataDir inside ~/${forbidden} is refused BY NAME, with NO tampering`, async () => {
      // The reviewer's variant A: the forward command refuses this by name, and
      // `--undo` performed two renames inside it one command later.
      const dir = join(homedir(), forbidden, "store");
      layoutAt(dir);
      const before = fingerprint(join(homedir(), forbidden));

      const fwd = consoleWith();
      expect(
        await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
          io: fwd.io,
          env: env(),
          home,
        }),
      ).toBe(EXIT.refused);

      const c = consoleWith();
      expect(
        await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
          io: c.io,
          env: env(),
          home,
        }),
      ).toBe(EXIT.refused);
      expect(text(c.err)).toContain("refused by name");
      expect(text(c.err)).toContain(forbidden);
      // Not one byte, and not one directory entry, moved.
      expect(fingerprint(join(homedir(), forbidden))).toBe(before);
      rmSync(join(homedir(), forbidden), { recursive: true, force: true });
    });
  }

  test("a TAMPERED record naming a directory outside the layout is refused", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    // The record is a row in a database. Anything with the store open can write
    // it — the reviewer pointed it at `~/.bansai/store` and watched v1's memory
    // get renamed onto `dataDir`.
    const victim = join(homedir(), ".bansai", "store");
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, "PRECIOUS-V1-MEMORY"), "do not move me");
    const before = fingerprint(join(homedir(), ".bansai"));
    const store = Store.open({ dir: storePath() });
    try {
      store.setMeta("store.previous.parked", victim);
    } finally {
      store.close();
    }

    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(u.err)).toContain("refused by name");
    expect(fingerprint(join(homedir(), ".bansai"))).toBe(before);
    expect(existsSync(join(victim, "PRECIOUS-V1-MEMORY"))).toBe(true);
    rmSync(join(homedir(), ".bansai"), { recursive: true, force: true });
  });

  test("a record naming the store's own PARENT is refused by shape", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    // `dirname(storeDir)` — the reviewer's crafted value that planned a
    // directory into its own child.
    const store = Store.open({ dir: storePath() });
    try {
      store.setMeta("store.previous.parked", base());
    } finally {
      store.close();
    }
    // The PARKED tree is the one that must not move. Reading the store's own
    // record rewrites its `-shm` — that is MINOR-4, and it is said in the
    // output — so the live store's fingerprint is not the thing to assert on.
    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const before = fingerprint(parked);
    const entriesBefore = readdirSync(base()).sort().join(",");
    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    // It is caught by the ring's "contains the configuration" clause, which
    // fires before the shape rule and says the more useful thing — the point
    // being that the ring is reached at all.
    expect(text(u.err)).toContain("CONTAINS the configuration");
    expect(fingerprint(parked)).toBe(before);
    expect(readdirSync(base()).sort().join(",")).toBe(entriesBefore);
  });

  test("a record naming a SYMLINK is refused, so dataDir never becomes one", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const elsewhere = join(home, "elsewhere4");
    mkdirSync(elsewhere, { recursive: true });
    const link = `${storePath()}.${PARKED_INFIX}-${today()}-9`;
    symlinkSync(elsewhere, link);
    const store = Store.open({ dir: storePath() });
    try {
      store.setMeta("store.previous.parked", link);
    } finally {
      store.close();
    }

    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(u.err)).toContain("SYMBOLIC LINK");
    // The store path is still a real directory, not a link into elsewhere.
    expect(lstatSync(storePath()).isSymbolicLink()).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  test("a record naming a name this package never writes is refused by shape", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const odd = join(base(), "store.something-else");
    mkdirSync(odd, { recursive: true });
    const store = Store.open({ dir: storePath() });
    try {
      store.setMeta("store.previous.parked", odd);
    } finally {
      store.close();
    }
    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(u.err)).toContain("not a name this package writes");
  });

  test("the guard ring is ONE function, and both directions call it", () => {
    // Structural, so the two cannot drift again: the forward plan and the undo
    // plan give the same answer for the same bad path.
    const bad = join(homedir(), ".bansai", "store");
    const forward = planStartFresh({
      configPath: configPath(),
      configPresent: true,
      dataDir: bad,
      snapshotsConfigured: undefined,
      now: Date.now(),
      home,
    });
    const undo = planUndo({
      storeDir: bad,
      parked: null,
      configPath: configPath(),
      now: Date.now(),
      home,
    });
    expect(forward.refusal).not.toBeNull();
    expect(undo.refusal).not.toBeNull();
    expect(undo.refusal).toBe(forward.refusal);
  });
});

describe("MAJOR-1 — --undo refuses a non-absolute dataDir too", () => {
  for (const [label, value] of [
    ["relative", "relative-store"],
    ["tilde", "~/.counterparts/store"],
    ["dot-slash", "./rel2"],
  ] as const) {
    test(`${label}: refused by name, and the cwd is never touched`, async () => {
      mkdirSync(base(), { recursive: true });
      writeFileSync(configPath(), `${JSON.stringify({ dataDir: value }, null, 2)}\n`);
      const c = consoleWith();
      expect(
        await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
          io: c.io,
          env: env(),
          home,
        }),
      ).toBe(EXIT.refused);
      expect(text(c.err)).toContain("not an absolute path");
      expect(existsSync(join(process.cwd(), value))).toBe(false);
    });
  }
});

describe("MAJOR-2 — --undo runs the same live-session check", () => {
  test("a fresh un-ended session record refuses the undo, even with both flags", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const now = Date.now();
    mkdirSync(join(storePath(), "sessions"), { recursive: true });
    writeFileSync(
      join(storePath(), "sessions", "live.json"),
      JSON.stringify({
        sessionId: "live",
        scope: join(home, "a-project"),
        startedAt: now,
        lastBoundaryAt: now,
        endedAt: null,
      }),
    );
    // Taken AFTER the record is seeded, and of the PARKED tree — which is the
    // one that must not move. (Reading the store's own record legitimately
    // rewrites its `-shm`; that is MINOR-4, and it is said in the output.)
    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const before = fingerprint(parked);

    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.refused);
    expect(text(u.err)).toContain("session live");
    expect(text(u.err)).toContain("Close every Claude Code session");
    // Neither directory moved.
    expect(fingerprint(parked)).toBe(before);
    expect(storeExists(storePath())).toBe(true);
    expect(existsSync(parked)).toBe(true);
  });
});

describe("the confirmation review's MINORs and NITs", () => {
  test("MINOR-3: a successful undo prints the way back FROM it", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--yes", "--nothing-is-open"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(u.out)).toContain("The store this displaced is PARKED, not removed");
    expect(text(u.out)).toContain("there is no --undo of an --undo");
    // And the two printed lines actually work.
    const lines = u.out.filter((l) => l.trimStart().startsWith("if [ -e ")).map((l) => l.trim());
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const r = spawnSync("/bin/sh", ["-c", line], { encoding: "utf8", env: shellEnv() });
      expect(r.status).toBe(0);
    }
    // The blank store is back at the store path, with its own marker intact.
    expect(storeExists(storePath())).toBe(true);
  });

  test("MINOR-2: --undo re-reads after the confirmation and REFUSES on drift", async () => {
    // M2's lesson applied to this direction, driven through the `prompt` seam
    // rather than a TTY: while the human answers, the rotation puts a snapshots
    // folder back at the live name — so the plan that would run has one move
    // fewer than the plan that was read.
    await install();
    await note();
    seedSnapshots();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const parked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const before = fingerprint(parked);
    const entriesBefore = readdirSync(base()).sort().join(",");

    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      prompt: async (): Promise<string> => {
        mkdirSync(snapshotsPath(), { recursive: true });
        return basename(parked);
      },
    };
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo"], { io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(err)).toContain("the ground moved while this was waiting for you");
    // Nothing moved: the parked tree is untouched and the layout is as it was
    // but for the snapshots folder the test itself made.
    expect(fingerprint(parked)).toBe(before);
    expect(readdirSync(base()).sort().join(",")).toBe(
      [...entriesBefore.split(","), "snapshots"].sort().join(","),
    );
  });

  test("MINOR-4: --undo --dry-run says what it touched", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const u = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--undo", "--dry-run"], {
        io: u.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(u.out)).toContain("`-shm` index may have been");
    expect(text(u.out)).toContain("the parked store was not opened");
    // And it really did not move anything.
    expect(existsSync(`${storePath()}.${PARKED_INFIX}-${today()}`)).toBe(true);
  });

  test("MINOR-5: part-built stores from interrupted runs are NAMED, never used", async () => {
    await install();
    await note();
    const stray = `${storePath()}.new-99999`;
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "half"), "from a crashed run");
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--dry-run"], {
        io: c.io,
        env: env(),
        home,
      }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("part-built stores from interrupted runs");
    expect(text(c.out)).toContain(stray);
    expect(text(c.out)).toContain("nothing here will remove");
    // And a real run steps over it rather than adopting it.
    const r = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: r.io,
      env: env(),
      home,
    });
    expect(readFileSync(join(stray, "half"), "utf8")).toBe("from a crashed run");
  });

  test("NIT-2: the REFUSING branch exits non-zero, so a pasted block stops", async () => {
    await install();
    await note();
    const c = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes", "--nothing-is-open"], {
      io: c.io,
      env: env(),
      home,
    });
    const restore = guardedLines(c.out).find((l) =>
      l.includes(`else mv "${storePath()}.${PARKED_INFIX}-`),
    );
    const r = spawnSync("/bin/sh", ["-c", restore as string], {
      encoding: "utf8",
      env: shellEnv(),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REFUSING");
    expect(r.stdout).toBe("");
  });

  test("NIT-3: before anything moves, the way back does not call the memory blank", async () => {
    await install();
    await note();
    const c = consoleWith([""]);
    await run(["start-fresh", "--config", configPath()], { io: c.io, env: env(), home });
    const out = text(c.out);
    // The pre-move block says what an interruption during the install means...
    expect(out).toContain("If it stops before it prints 'parked store:', NOTHING HAS MOVED");
    expect(out).toContain("<store>.new-<number>");
    // ...and line 1 is conditional rather than unconditional.
    expect(out).toContain("and if a blank store has appeared at the store path by then");
  });
});
