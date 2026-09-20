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
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
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
import { basename, join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  BLANK_INFIX,
  OPEN_WINDOW_MS,
  PARKED_INFIX,
  park,
  parkRefusal,
  parkedPath,
  planStartFresh,
  readLiveness,
  sameFilesystemRefusal,
  sight,
} from "../src/adapters/cli/start-fresh.js";
import type { ParkStep } from "../src/adapters/cli/start-fresh.js";
import { Store, dateOf, storeExists } from "../src/core/store/index.js";

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
    const code = await run(["start-fresh", "--config", configPath(), "--yes"], {
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
      await run(["start-fresh", "--config", configPath(), "--yes"], {
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
    await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home });

    const s = consoleWith();
    expect(await run(["status", "--dir", storePath()], { io: s.io, env: env(), home })).toBe(EXIT.ok);
    expect(text(s.out)).toContain(`This store began on ${today()}`);
    expect(text(s.out)).toContain(`${PARKED_INFIX}-${today()}`);
    expect(text(s.out)).toContain("untouched");
  });

  test("a second run the same day parks beside the first, never over it", async () => {
    await install();
    await note();
    const first = consoleWith();
    await run(["start-fresh", "--config", configPath(), "--yes"], { io: first.io, env: env(), home });
    const firstParked = `${storePath()}.${PARKED_INFIX}-${today()}`;
    const firstFingerprint = fingerprint(firstParked);

    const second = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], {
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
    // open (§5 G11). It stands in here for cut-over day's real case, where the
    // refusal is `STORE_PRE_ROWS` and the reason is the floor.
    writeFileSync(join(storePath(), "a-name-this-build-does-not-know"), "from another floor");
    expect(() => Store.open({ dir: storePath(), observer: true })).toThrow();

    const before = fingerprint(storePath());
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
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
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
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
    // The rollback is printed before anything moves, dry run or not.
    expect(out).toContain(`mv ${storePath()} ${storePath()}.${BLANK_INFIX}-${today()}`);

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
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
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
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain('names no "dataDir"');
  });

  test("a configuration that will not parse refuses", async () => {
    mkdirSync(base(), { recursive: true });
    writeFileSync(configPath(), "{ not json");
    const c = consoleWith();
    expect(
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
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
    expect(text(c.out)).toContain("Nothing to park");
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
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
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
      await run(["start-fresh", "--config", configPath(), "--yes"], { io: c.io, env: env(), home }),
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

