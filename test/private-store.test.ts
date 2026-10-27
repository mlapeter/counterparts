/**
 * THE LOCAL STORE IS PRIVATE TO ITS USER (2026-10-27, R1).
 *
 * Three halves, each through a real path:
 *   1. IN THIS PROCESS, under a loose umask (022, the Mac default): a store
 *      opened, written through `note` (the remember door), and copied by the
 *      daily snapshot comes out 0700/0600 from the core's own explicit modes,
 *      with no help from the umask. `-wal`/`-shm` follow the database.
 *   2. AN EXISTING STORE an older build left 755/644 is tightened by a
 *      writer's open, and an observer's open leaves it as found; a chmod the
 *      filesystem refuses is skipped and counted, never a refusal.
 *   3. THE CONSOLE AS A CHILD under `umask 022`: `install`, `note` and
 *      `backup`, then every file and directory under the base dir is checked.
 *      Here the entry point's umask (`adapters/private-umask.ts`) does the
 *      work for every file nobody gave a mode. (The same under Node is in
 *      `test/node-smoke.ts`.)
 *
 * Hermetic: every test mints its own temp directories and removes them; the
 * child gets an explicit `env` with HOME inside the temp dir (`test/preload.ts`
 * lists this spawn site).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { modesFindings } from "../src/adapters/claude-code/doctor-modes.js";
import { CLAIM_NAME_RE, PARTIAL_NAME_RE, SNAPSHOT_NAME_RE, runSnapshot } from "../src/adapters/snapshots.js";
import { Counterpart } from "../src/core/counterpart.js";
import { PRE_MIGRATION_NAME_RE, SNAPSHOT_ENTRY_NAMES, STORE_TIGHTENED_EVENT, Store, snapshotsDirRoots, storeNeedsTightening, tightenStore } from "../src/core/store/index.js";
import { installBasePaths, tightenInstallBase } from "../src/adapters/private-base.js";
import { ownedKind, ownedNames } from "../src/adapters/owned-names.js";
import type { StoreEvent } from "../src/core/store/index.js";
import { scriptArgs } from "../src/adapters/runtime.js";

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) {
    const d = made.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "counterparts-private-"));
  made.push(d);
  return d;
}

/** Run `fn` under umask 022, whatever this test process was started with. */
function looseUmask<T>(fn: () => T): T {
  const prev = process.umask(0o022);
  try {
    return fn();
  } finally {
    process.umask(prev);
  }
}

async function looseUmaskAsync<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.umask(0o022);
  try {
    return await fn();
  } finally {
    process.umask(prev);
  }
}

const mode = (p: string): number => statSync(p).mode & 0o777;

/** chmod through /bin/chmod: bun's `chmodSync` drops the sticky and setgid bits. */
function chmodSpecial(p: string, m: number): void {
  expect(spawnSync("/bin/chmod", [m.toString(8), p]).status).toBe(0);
}

/** Every path under `root` (itself included), not following links. */
function walk(root: string): { path: string; dir: boolean; mode: number }[] {
  const out: { path: string; dir: boolean; mode: number }[] = [];
  const go = (p: string): void => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return;
    out.push({ path: p, dir: st.isDirectory(), mode: st.mode & 0o777 });
    if (st.isDirectory()) for (const n of readdirSync(p)) go(join(p, n));
  };
  go(root);
  return out;
}

/** The paths under `root` that anybody but the owner can read or enter. */
function openPaths(root: string): string[] {
  return walk(root)
    .filter((e) => (e.mode & 0o077) !== 0)
    .map((e) => `${e.path.slice(root.length) || "/"} ${e.mode.toString(8)}`);
}

function quietIo(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

const ENV = (store: string): Record<string, string> => ({
  COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
  COUNTERPARTS_DATA_DIR: store,
});

// ── 1. in this process: the core's own modes ────────────────────────────────

describe("a store this build makes is private, without help from the umask", () => {
  test("open + note + the daily snapshot: dirs 0700, database and its -wal/-shm 0600, the copy 0600", async () => {
    const base = join(temp(), "home", ".counterparts");
    const store = join(base, "store");
    const snaps = join(base, "snapshots");
    await looseUmaskAsync(async () => {
      Store.open({ dir: store }).close();
      const c = quietIo();
      expect(await run(["note", "Ada prefers the river trail to the hill path when she runs in the morning"], { io: c.io, env: ENV(store) })).toBe(EXIT.ok);
      const cp = Counterpart.open({ dir: store });
      try {
        expect(existsSync(join(store, "counterparts.sqlite-wal"))).toBe(true);
        const report = runSnapshot({ counterpart: cp, dataDir: store, config: { dir: snaps } });
        expect(report.reason).toBe("taken");
      } finally {
        cp.close();
      }
    });
    expect(mode(base)).toBe(0o700);
    expect(mode(store)).toBe(0o700);
    expect(mode(join(store, "cache"))).toBe(0o700);
    expect(mode(join(store, "counterparts.sqlite"))).toBe(0o600);
    expect(mode(join(store, "cache", "cache.sqlite"))).toBe(0o600);
    for (const side of ["counterparts.sqlite-wal", "counterparts.sqlite-shm"]) {
      if (existsSync(join(store, side))) expect(mode(join(store, side))).toBe(0o600);
    }
    expect(mode(snaps)).toBe(0o700);
    const copies = readdirSync(snaps).filter((n) => !n.startsWith("."));
    expect(copies.length).toBe(1);
    const copy = join(snaps, copies[0] ?? "");
    expect(mode(copy)).toBe(0o700);
    expect(mode(join(copy, "counterparts.sqlite"))).toBe(0o600);
    // The database family and the roots are the core's guarantee in a process
    // that did not set the umask (an embedder's): what another module made
    // with no mode (`spans/`) sits inside the 0700 store, where nobody else
    // can reach it. Our own processes make those private too (section 3).
    expect(walk(base).filter((e) => /\.sqlite(-wal|-shm)?$/.test(e.path) && (e.mode & 0o077) !== 0)).toEqual([]);
  });

  test("`backup --out` copies the database 0600 (VACUUM INTO takes 0644 & ~umask, not the source's mode)", async () => {
    const root = temp();
    const store = join(root, "base", "store");
    const out = join(root, "backup-here");
    await looseUmaskAsync(async () => {
      Store.open({ dir: store }).close();
      expect(await run(["note", "Ada keeps her bicycle in the shed behind the bakery on Elm Street"], { io: quietIo().io, env: ENV(store) })).toBe(EXIT.ok);
      const c = quietIo();
      expect(await run(["backup", "--dir", store, "--out", out], { io: c.io, env: ENV(store) })).toBe(EXIT.ok);
    });
    const dbs = walk(out).filter((e) => e.path.endsWith("counterparts.sqlite"));
    expect(dbs.length).toBe(1);
    expect(dbs[0]?.mode).toBe(0o600);
    expect(mode(out)).toBe(0o700);
  });
});

// ── 2. an existing store, tightened once ────────────────────────────────────

/** A store, then loosened the way an older build under umask 022 left it. */
async function looseStore(): Promise<{ base: string; store: string }> {
  const base = join(temp(), ".counterparts");
  const store = join(base, "store");
  Store.open({ dir: store }).close();
  expect(await run(["note", "Ada said the river walk on Sunday mornings is the best part of her week"], { io: quietIo().io, env: ENV(store) })).toBe(EXIT.ok);
  mkdirSync(join(base, "snapshots", "2026-10-01T00-00-00-000Z"), { recursive: true });
  for (const e of walk(base)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
  expect(openPaths(base).length).toBeGreaterThan(3);
  return { base, store };
}

describe("a store an older build left readable is tightened by a writer's open", () => {
  test("every directory 0700 and every file 0600 under the store after one open; nothing outside it; the ring says how many", async () => {
    const { base, store } = await looseStore();
    // An embedder's files beside a dir that happens to be called `store`
    // (review of #657): the core has no business with them.
    mkdirSync(join(base, "app", "public"), { recursive: true });
    writeFileSync(join(base, "server.js"), "// app\n");
    chmodSync(join(base, "app"), 0o755);
    chmodSync(join(base, "app", "public"), 0o755);
    chmodSync(join(base, "server.js"), 0o644);
    const events: StoreEvent[] = [];
    const s = Store.open({ dir: store, onEvent: (e) => events.push(e) });
    s.close();
    expect(openPaths(store)).toEqual([]);
    expect(mode(base)).toBe(0o755);
    expect(mode(join(base, "app"))).toBe(0o755);
    expect(mode(join(base, "app", "public"))).toBe(0o755);
    expect(mode(join(base, "server.js"))).toBe(0o644);
    expect(mode(join(base, "snapshots"))).toBe(0o755);
    const ev = events.find((e) => e.name === STORE_TIGHTENED_EVENT);
    expect(ev).toBeDefined();
    expect(Number(ev?.data?.["tightened"])).toBeGreaterThan(3);
    expect(ev?.data?.["skipped"]).toBe(0);
    // Already tight: the next open does nothing and says nothing.
    const again: StoreEvent[] = [];
    Store.open({ dir: store, onEvent: (e) => again.push(e) }).close();
    expect(again.some((e) => e.name === STORE_TIGHTENED_EVENT)).toBe(false);
  });

  test("an observer's open leaves the modes exactly as found", async () => {
    const { base, store } = await looseStore();
    const before = openPaths(base);
    Store.open({ dir: store, observer: true }).close();
    expect(openPaths(base)).toEqual(before);
  });

  test("a chmod the filesystem refuses is skipped and counted, and the store still opens", async () => {
    const { store } = await looseStore();
    const db = join(realpathSync(store), "counterparts.sqlite");
    const events: StoreEvent[] = [];
    const s = Store.open({
      dir: store,
      onEvent: (e) => events.push(e),
      chmod: (path, m) => {
        if (path === db) throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        chmodSync(path, m);
      },
    });
    try {
      expect(() => s.livedDay()).not.toThrow();
    } finally {
      s.close();
    }
    const ev = events.find((e) => e.name === STORE_TIGHTENED_EVENT);
    expect(ev?.data?.["skipped"]).toBe(1);
    expect(String(ev?.data?.["skippedPaths"])).toContain("counterparts.sqlite");
    expect(mode(db)).toBe(0o644);
    expect(mode(store)).toBe(0o700);
  });

  test("tightenStore never follows a symlink and keeps an owner's x-bit", () => {
    const root = temp();
    const store = join(root, "elsewhere");
    mkdirSync(store);
    const outside = join(root, "outside");
    mkdirSync(outside);
    chmodSync(outside, 0o755);
    symlinkSync(outside, join(store, "link"));
    writeFileSync(join(store, "tool.sh"), "#!/bin/sh\n");
    chmodSync(join(store, "tool.sh"), 0o755);
    chmodSync(store, 0o755);
    const report = tightenStore(store);
    expect(report.skipped).toEqual([]);
    expect(mode(outside)).toBe(0o755);
    expect(mode(join(store, "tool.sh"))).toBe(0o700);
    expect(mode(store)).toBe(0o700);
  });
});

// ── doctor's Privacy row ────────────────────────────────────────────────────

describe("doctor's Privacy row", () => {
  test("amber on a loose store with the chmod lines, green once tightened", async () => {
    const { store } = await looseStore();
    const loose = modesFindings(store, "darwin");
    expect(loose[0]?.severity).toBe("amber");
    expect(loose[0]?.fix).toContain("chmod 700");
    expect(loose[0]?.fix).toContain("chmod 600");
    Store.open({ dir: store }).close();
    expect(modesFindings(store, "darwin")[0]?.severity).toBe("green");
    expect(modesFindings(store, "win32")).toEqual([]);
  });

  test("through `counterparts doctor --dir`, the loose store reads Privacy amber", async () => {
    const { store } = await looseStore();
    const c = quietIo();
    await run(["doctor", "--dir", store], { io: c.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
    const said = c.out.join("\n");
    expect(said).toContain("Privacy");
    expect(said).toContain("readable by other accounts");
  });
});

// ── 3. the console as a child, under umask 022 ──────────────────────────────

const CLI = fileURLToPath(new URL("../src/adapters/cli/bin/counterparts.ts", import.meta.url));

describe("the console's own files are private too (the entry point's umask)", () => {
  test("install, note and backup as children under umask 022: every file 0600, every directory 0700", () => {
    const root = temp();
    const home = join(root, "home");
    mkdirSync(home);
    const base = join(home, ".counterparts");
    const store = join(base, "store");
    const env = {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      USERPROFILE: home,
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      COUNTERPARTS_DATA_DIR: store,
    };
    const child = (args: readonly string[]): { code: number | null; out: string } => {
      const res = spawnSync(
        "/bin/sh",
        ["-c", 'umask 022; exec "$@"', "sh", process.execPath, ...scriptArgs(CLI, process.execPath), ...args],
        { env, encoding: "utf8", input: "", timeout: 60_000 },
      );
      return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    };
    const install = child(["install", "--no-connect", "--config", join(base, "claude-code.json"), "--budget", "9000", "--name", "Ada"]);
    expect(install.code).toBe(0);
    const note = child(["note", "Ada prefers the river trail to the hill path when she runs in the morning", "--config", join(base, "claude-code.json")]);
    expect(note.out).toContain("Remembered");
    const backup = child(["backup", "--out", join(base, "snapshots", "by-hand")]);
    expect(backup.code).toBe(0);
    expect(existsSync(join(base, "snapshots", "by-hand"))).toBe(true);
    expect(openPaths(base)).toEqual([]);
    expect(walk(base).some((e) => e.path.endsWith("spans") && e.dir)).toBe(true);
  });
});

// ── review of #657: the base is the adapters', links are followed at the root ─

describe("the install's base directory is the adapters' to tighten, and only when it is one", () => {
  test("`counterparts connect` tightens a loose ~/.counterparts (itself, its config, store and snapshots) and nothing outside it", async () => {
    const home = join(temp(), "home");
    const base = join(home, ".counterparts");
    const store = join(base, "store");
    const configPath = join(base, "claude-code.json");
    const env = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    const c = quietIo();
    expect(await run(["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"], { io: c.io, env, home })).toBe(EXIT.ok);
    mkdirSync(join(base, "snapshots", "2026-10-01T00-00-00-000Z"), { recursive: true });
    for (const e of walk(base)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    chmodSync(home, 0o755);
    const off = quietIo();
    expect(
      await run(["connect", "--config", configPath], {
        io: off.io,
        env,
        home,
        spawner: () => ({ missing: false, code: 0, out: "", err: "" }),
        processes: () => ({ looked: true, processes: [] }),
      }),
    ).toBe(EXIT.ok);
    // `connect` (`private-base.ts`): the default base holds only ours, so it is
    // closed too.
    expect(mode(base)).toBe(0o700);
    expect(mode(configPath)).toBe(0o600);
    expect(mode(join(base, "snapshots", "2026-10-01T00-00-00-000Z"))).toBe(0o700);
    expect(mode(join(store, "counterparts.sqlite"))).toBe(0o600);
    expect(mode(home)).toBe(0o755);
    expect(modesFindings(store, "darwin", configPath)[0]?.severity).not.toBe("amber");
  });

  test("a dir that is merely named `store` proves nothing: no config beside it, its parent is left alone", () => {
    const root = temp();
    const store = join(root, "store");
    mkdirSync(store);
    chmodSync(root, 0o755);
    expect(tightenInstallBase(join(root, "claude-code.json"), store)).toBe(null);
    expect(mode(root)).toBe(0o755);
    // A config that names another store is not this layout either.
    writeFileSync(join(root, "claude-code.json"), "{}");
    expect(tightenInstallBase(join(root, "claude-code.json"), join(root, "other", "store"))).toBe(null);
    expect(mode(root)).toBe(0o755);
  });
});

describe("a symlinked store is tightened where it really is", () => {
  test("the walk and the check follow the root link; the second open is quiet; doctor is green", () => {
    const root = temp();
    const real = join(root, "real-store");
    Store.open({ dir: real }).close();
    for (const e of walk(real)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    const link = join(root, "link-store");
    symlinkSync(real, link);
    const first: StoreEvent[] = [];
    Store.open({ dir: link, onEvent: (e) => first.push(e) }).close();
    expect(first.some((e) => e.name === STORE_TIGHTENED_EVENT)).toBe(true);
    expect(openPaths(real)).toEqual([]);
    const second: StoreEvent[] = [];
    Store.open({ dir: link, onEvent: (e) => second.push(e) }).close();
    expect(second.some((e) => e.name === STORE_TIGHTENED_EVENT)).toBe(false);
    expect(modesFindings(link, "darwin")[0]?.severity).toBe("green");
  });

  test("a symlinked database is not chmodded through and does not keep the gate open", () => {
    const root = temp();
    const store = join(root, "s");
    Store.open({ dir: store }).close();
    const elsewhere = join(root, "elsewhere.sqlite");
    writeFileSync(elsewhere, "");
    chmodSync(elsewhere, 0o644);
    rmSync(join(store, "counterparts.sqlite"));
    symlinkSync(elsewhere, join(store, "counterparts.sqlite"));
    expect(storeNeedsTightening(store)).toBe(false);
    tightenStore(store);
    expect(mode(elsewhere)).toBe(0o644);
  });
});

// ── re-check of #657: a base that is a home or a project keeps its own entries ─

describe("a config outside ~/.counterparts: only our names in that directory are tightened", () => {
  /** An install whose config sits in `base`, then everything there loosened, with somebody else's entries beside it. */
  async function installIn(home: string, base: string): Promise<{ configPath: string; store: string }> {
    const configPath = join(base, "counterparts.json");
    const store = join(base, "store");
    const env = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    expect(await run(["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"], { io: quietIo().io, env, home })).toBe(EXIT.ok);
    expect(existsSync(join(store, "counterparts.sqlite"))).toBe(true);
    mkdirSync(join(base, "snapshots", "2026-10-01T00-00-00-000Z"), { recursive: true });
    writeFileSync(join(base, "scopes.json"), "{}\n");
    // Somebody else's, as a home directory or a project holds them.
    mkdirSync(join(base, "Public", "Drop Box"), { recursive: true });
    mkdirSync(join(base, ".claude"), { recursive: true });
    mkdirSync(join(base, "log"), { recursive: true });
    writeFileSync(join(base, "log", "access.log"), "GET /\n");
    writeFileSync(join(base, "server.js"), "// app\n");
    for (const e of walk(base)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    chmodSync(join(base, "Public", "Drop Box"), 0o733);
    return { configPath, store };
  }
  const connect = async (configPath: string, home: string): Promise<void> => {
    expect(
      await run(["connect", "--config", configPath], {
        io: quietIo().io,
        env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
        home,
        spawner: () => ({ missing: false, code: 0, out: "", err: "" }),
        processes: () => ({ looked: true, processes: [] }),
      }),
    ).toBe(EXIT.ok);
  };
  const untouched = (base: string): void => {
    expect(mode(base)).toBe(0o755);
    expect(mode(join(base, "Public"))).toBe(0o755);
    expect(mode(join(base, "Public", "Drop Box"))).toBe(0o733);
    expect(mode(join(base, ".claude"))).toBe(0o755);
    expect(mode(join(base, "log"))).toBe(0o755);
    expect(mode(join(base, "log", "access.log"))).toBe(0o644);
    expect(mode(join(base, "server.js"))).toBe(0o644);
  };
  const ours = (base: string, configPath: string, store: string): void => {
    expect(mode(configPath)).toBe(0o600);
    expect(mode(join(base, "scopes.json"))).toBe(0o600);
    expect(openPaths(store)).toEqual([]);
    expect(openPaths(join(base, "snapshots"))).toEqual([]);
  };

  test("config at ~/counterparts.json: connect and a session start leave the home and its other entries alone", async () => {
    const home = join(temp(), "home");
    mkdirSync(home);
    const { configPath, store } = await installIn(home, home);
    await connect(configPath, home);
    untouched(home);
    ours(home, configPath, store);
    // The session-start hook's call, with the home as the real one.
    for (const e of walk(join(home, "snapshots"))) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    tightenInstallBase(configPath, store, { home });
    untouched(home);
    ours(home, configPath, store);
    // doctor reads the same set: amber names none of the home's own entries.
    chmodSync(configPath, 0o644);
    const f = modesFindings(store, "darwin", configPath)[0];
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("counterparts.json");
    expect(f?.detail).not.toContain("Public");
    expect(f?.detail).not.toContain(`${home} (`);
  });

  test("config in a project directory: the project keeps its mode and its files", async () => {
    const home = join(temp(), "home");
    const project = join(home, "code", "my-app");
    mkdirSync(project, { recursive: true });
    const { configPath, store } = await installIn(home, project);
    await connect(configPath, home);
    untouched(project);
    ours(project, configPath, store);
  });

  test("the default ~/.counterparts, holding only ours, is closed whole", async () => {
    const home = join(temp(), "home");
    const base = join(home, ".counterparts");
    mkdirSync(base, { recursive: true });
    const configPath = join(base, "claude-code.json");
    expect(await run(["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"], { io: quietIo().io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, home })).toBe(EXIT.ok);
    for (const e of walk(base)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    await connect(configPath, home);
    expect(openPaths(base)).toEqual([]);
  });
});

test("private-base spells the sidebar's two file names as sidebar-status does", async () => {
  const { SIDEBAR_NAMES } = await import("../src/adapters/private-base.js");
  const { PLUGIN_PRESENCE_NAME, SIDEBAR_FILE_NAME } = await import("../src/adapters/sidebar-status.js");
  expect([...SIDEBAR_NAMES].sort()).toEqual([PLUGIN_PRESENCE_NAME, SIDEBAR_FILE_NAME].sort());
});

// ── re-check of #657: one list of our names, for uninstall and for privacy ──

describe("what uninstall calls ours is what is made private", () => {
  /** A default ~/.counterparts with every kind of thing this package leaves in it. */
  function fullBase(foreign: boolean): { home: string; base: string; configPath: string; store: string; ours: string[] } {
    const home = join(temp(), "home");
    const base = join(home, ".counterparts");
    const store = join(base, "store");
    Store.open({ dir: store }).close();
    const configPath = join(base, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: store }));
    const files = [
      "claude-code.json.4242.tmp",
      "claude-code.json.counterparts-backup-2026-09-21T14-03-05Z",
      "scopes.json",
      "scopes.json.tmp",
      "sidebar.json",
      "sidebar.json.17.tmp",
      "sidebar-plugin-here",
      "npm-live.json",
      "credentials.env",
    ];
    for (const f of files) writeFileSync(join(base, f), "x\n");
    const trees = ["store.parked-2026-09-21", "store.blank-2026-09-21", "store.new-4242", "snapshots", "snapshots.parked-2026-09-21", "rollback-aside-v13-2026-10-11T07-25-00-000Z"];
    for (const t of trees) {
      mkdirSync(join(base, t), { recursive: true });
      writeFileSync(join(base, t, "counterparts.sqlite"), "old memory\n");
    }
    mkdirSync(join(base, "debug", "2026-10-20"), { recursive: true });
    writeFileSync(join(base, "debug", "2026-10-20", "dream-nrn_abc.jsonl"), "{}\n");
    if (foreign) {
      mkdirSync(join(base, "Public"));
      writeFileSync(join(base, "notes.txt"), "mine\n");
    }
    for (const e of walk(base)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    return { home, base, configPath, store, ours: ["claude-code.json", "store", "debug", ...files, ...trees] };
  }

  test("the two callers read one fixture the same way", () => {
    const { home, base, configPath, store, ours } = fullBase(true);
    const owned = ownedNames(configPath, {}, store);
    const byUninstall = readdirSync(base).filter((n) => ownedKind(n, owned, base) !== null);
    const p = installBasePaths(configPath, store, home);
    const byPrivacy = [...(p?.files ?? []), ...(p?.trees ?? [])].map((x) => basename(x));
    // credentials.env is the one difference: uninstall leaves it, privacy closes it.
    expect([...byPrivacy].sort()).toEqual([...byUninstall, "credentials.env"].sort());
    expect([...byPrivacy].sort()).toEqual([...ours].sort());
    expect(p?.baseIsOurs).toBe(false);
  });

  test("a loose default base with a parked store, debug/ and a config backup: all of it closed, doctor green after", async () => {
    const { home, base, configPath, store } = fullBase(false);
    expect(modesFindings(store, "darwin", configPath)[0]?.severity).toBe("amber");
    await run(["connect", "--config", configPath], {
      io: quietIo().io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home,
      spawner: () => ({ missing: false, code: 0, out: "", err: "" }),
      processes: () => ({ looked: true, processes: [] }),
    });
    expect(openPaths(base)).toEqual([]);
    expect(modesFindings(store, "darwin", configPath)[0]?.severity).toBe("green");
  });

  test("a base that others may write in, or that is sticky, is never closed (its entries still are)", () => {
    const { home, base, configPath, store } = fullBase(false);
    chmodSpecial(base, 0o1777);
    tightenInstallBase(configPath, store, { home });
    expect(statSync(base).mode & 0o7777).toBe(0o1777);
    chmodSpecial(base, 0o777);
    tightenInstallBase(configPath, store, { home });
    expect(mode(base)).toBe(0o777);
    expect(mode(join(base, "store.parked-2026-09-21"))).toBe(0o700);
    expect(mode(configPath)).toBe(0o600);
  });
});

// ── round 4 of #657: a configured snapshots dir is the owner's place ────────

describe("a configured snapshots.dir: only the snapshots in it are made private", () => {
  /** The console as a child under umask 022, with HOME the temp home. */
  function cli(home: string, args: readonly string[]): { code: number | null; out: string } {
    const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, USERPROFILE: home, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    const res = spawnSync(
      "/bin/sh",
      ["-c", 'umask 022; exec "$@"', "sh", process.execPath, ...scriptArgs(CLI, process.execPath), ...args],
      { env, encoding: "utf8", input: "", timeout: 60_000 },
    );
    return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }

  const DAY = "2026-10-01T00-00-00-000Z";
  const PRE = "2026-10-02T00-00-00-000Z-pre-migration-v14-to-v15";

  /** Install into $H/.counterparts, point snapshots.dir at `snaps` (or leave the
   *  default), lay out the home the way a person's looks, and loosen it all. */
  function setup(snapsOf: ((home: string) => string) | null): { home: string; base: string; store: string; configPath: string; snaps: string } {
    const home = realpathSync(temp());
    const base = join(home, ".counterparts");
    const store = join(base, "store");
    const configPath = join(base, "claude-code.json");
    const install = cli(home, ["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"]);
    expect(install.code).toBe(0);
    const snaps = snapsOf === null ? join(base, "snapshots") : snapsOf(home);
    if (snapsOf !== null) {
      const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      writeFileSync(configPath, `${JSON.stringify({ ...cfg, snapshots: { dir: snaps } }, null, 2)}\n`);
    }
    // Somebody's home.
    mkdirSync(join(home, "Public", "Drop Box"), { recursive: true });
    mkdirSync(join(home, "Sites"), { recursive: true });
    writeFileSync(join(home, "Sites", "index.html"), "<p>hi</p>\n");
    mkdirSync(join(home, "Documents", "taxes"), { recursive: true });
    writeFileSync(join(home, "Documents", "letter.txt"), "dear\n");
    writeFileSync(join(home, "Documents", "taxes", "2025.pdf"), "%PDF\n");
    // Snapshots this package wrote, where the config points.
    for (const name of [DAY, PRE]) {
      mkdirSync(join(snaps, name), { recursive: true });
      writeFileSync(join(snaps, name, "counterparts.sqlite"), "copy\n");
    }
    for (const e of walk(home)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
    chmodSync(join(home, "Public", "Drop Box"), 0o733);
    return { home, base, store, configPath, snaps };
  }

  const homeUntouched = (home: string): void => {
    expect(mode(home)).toBe(0o755);
    expect(mode(join(home, "Public"))).toBe(0o755);
    expect(mode(join(home, "Public", "Drop Box"))).toBe(0o733);
    expect(mode(join(home, "Sites"))).toBe(0o755);
    expect(mode(join(home, "Sites", "index.html"))).toBe(0o644);
    expect(mode(join(home, "Documents"))).toBe(0o755);
    expect(mode(join(home, "Documents", "letter.txt"))).toBe(0o644);
    expect(mode(join(home, "Documents", "taxes"))).toBe(0o755);
    expect(mode(join(home, "Documents", "taxes", "2025.pdf"))).toBe(0o644);
  };

  const note = (home: string, store: string): void => {
    const res = cli(home, ["note", "Ada keeps her bike in the hall closet since the garage flooded", "--dir", store]);
    expect(res.out).toContain("Remembered");
  };

  const connect = async (configPath: string, home: string): Promise<void> => {
    expect(
      await run(["connect", "--config", configPath], {
        io: quietIo().io,
        env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
        home,
        spawner: () => ({ missing: false, code: 0, out: "", err: "" }),
        processes: () => ({ looked: true, processes: [] }),
      }),
    ).toBe(EXIT.ok);
  };

  test("snapshots.dir = $HOME: a writer's open and connect leave the home and everything in it as they were", async () => {
    const { home, store, configPath } = setup((h) => h);
    note(home, store);
    homeUntouched(home);
    // A refused place gets nothing, not even the entries that look like ours.
    expect(mode(join(home, DAY))).toBe(0o755);
    expect(openPaths(store)).toEqual([]);
    await connect(configPath, home);
    homeUntouched(home);
    const f = modesFindings(store, "darwin", configPath, home)[0];
    expect(f?.severity).toBe("green");
  });

  test("snapshots.dir = ~/Documents holding the person's files: the snapshots in it go private, Documents and its files stay", async () => {
    const { home, store, configPath, snaps } = setup((h) => join(h, "Documents"));
    // doctor before: amber, naming the snapshot entries, never Documents or its files.
    const before = modesFindings(store, "darwin", configPath, home)[0];
    expect(before?.severity).toBe("amber");
    expect(before?.detail).toContain(join(snaps, DAY));
    expect(before?.detail).not.toContain(`${snaps} (`);
    expect(before?.detail).not.toContain("letter.txt");
    expect(before?.detail).not.toContain("taxes");
    note(home, store);
    homeUntouched(home);
    expect(openPaths(join(snaps, DAY))).toEqual([]);
    expect(openPaths(join(snaps, PRE))).toEqual([]);
    await connect(configPath, home);
    homeUntouched(home);
    expect(modesFindings(store, "darwin", configPath, home)[0]?.severity).toBe("green");
  });

  test("snapshots.dir = a dedicated dir holding only snapshots: the dir is closed whole, its parent is not", async () => {
    const { home, store, configPath, snaps } = setup((h) => join(h, "backups", "counterparts-snaps"));
    writeFileSync(join(snaps, ".taking-2026-10-01"), "");
    chmodSync(join(snaps, ".taking-2026-10-01"), 0o644);
    writeFileSync(join(home, "backups", "photos.tar"), "x\n");
    chmodSync(join(home, "backups", "photos.tar"), 0o644);
    const before = modesFindings(store, "darwin", configPath, home)[0];
    expect(before?.detail).toContain(`${snaps} (755)`);
    note(home, store);
    expect(openPaths(snaps)).toEqual([]);
    expect(mode(join(home, "backups"))).toBe(0o755);
    expect(mode(join(home, "backups", "photos.tar"))).toBe(0o644);
    homeUntouched(home);
    await connect(configPath, home);
    expect(modesFindings(store, "darwin", configPath, home)[0]?.severity).toBe("green");
  });

  test("the default snapshots dir: closed whole with the base by connect, the home left alone", async () => {
    const { home, base, store, configPath, snaps } = setup(null);
    note(home, store);
    homeUntouched(home);
    await connect(configPath, home);
    expect(openPaths(base)).toEqual([]);
    expect(mode(snaps)).toBe(0o700);
    homeUntouched(home);
    expect(modesFindings(store, "darwin", configPath, home)[0]?.severity).toBe("green");
  });

  test("a snapshots dir that is sticky, setgid or open to all is never closed; its snapshots still are", () => {
    const root = temp();
    const store = join(root, "store");
    Store.open({ dir: store }).close();
    const snaps = join(root, "shared");
    mkdirSync(join(snaps, DAY), { recursive: true });
    for (const m of [0o1777, 0o777, 0o2750]) {
      chmodSpecial(snaps, m);
      chmodSync(join(snaps, DAY), 0o755);
      tightenStore(store, snaps);
      expect(statSync(snaps).mode & 0o7777).toBe(m);
      expect(mode(join(snaps, DAY))).toBe(0o700);
    }
    // A setgid dir under the store is left as it is, and does not keep the gate open.
    const shared = join(store, "group");
    mkdirSync(shared);
    chmodSpecial(shared, 0o2770);
    expect(statSync(shared).mode & 0o7777).toBe(0o2770);
    tightenStore(store);
    expect(statSync(shared).mode & 0o7777).toBe(0o2770);
    expect(storeNeedsTightening(store)).toBe(false);
  });

  test("a snapshots dir that contains the store, or sits inside it, gets nothing", () => {
    const root = temp();
    const store = join(root, "base", "store");
    Store.open({ dir: store }).close();
    writeFileSync(join(root, "base", "other.txt"), "x\n");
    chmodSync(join(root, "base"), 0o755);
    chmodSync(join(root, "base", "other.txt"), 0o644);
    tightenStore(store, join(root, "base"));
    expect(mode(join(root, "base"))).toBe(0o755);
    expect(mode(join(root, "base", "other.txt"))).toBe(0o644);
    expect(snapshotsDirRoots(join(store, "snaps"), store)).toEqual({ only: [], recursive: [] });
  });

  test("the core spells the snapshot names as snapshots.ts and pre-migration.ts do", () => {
    expect(SNAPSHOT_ENTRY_NAMES.map((r) => r.source).sort()).toEqual(
      [SNAPSHOT_NAME_RE, PRE_MIGRATION_NAME_RE, PARTIAL_NAME_RE, CLAIM_NAME_RE].map((r) => r.source).sort(),
    );
  });
});

// ── round 4 of #657: a symlinked base is closed where it really is ──────────

test("~/.counterparts as a link to the real base: connect closes the real base, doctor green", async () => {
  const home = realpathSync(temp());
  const real = join(home, "elsewhere", "cp");
  mkdirSync(real, { recursive: true });
  symlinkSync(real, join(home, ".counterparts"));
  const configPath = join(home, ".counterparts", "claude-code.json");
  const env = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
  expect(await run(["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"], { io: quietIo().io, env, home })).toBe(EXIT.ok);
  for (const e of walk(join(home, "elsewhere"))) chmodSync(e.path, e.dir ? 0o755 : 0o644);
  const store = join(home, ".counterparts", "store");
  expect(modesFindings(store, "darwin", configPath, home)[0]?.detail).toContain(`${real} (755)`);
  await run(["connect", "--config", configPath], {
    io: quietIo().io,
    env,
    home,
    spawner: () => ({ missing: false, code: 0, out: "", err: "" }),
    processes: () => ({ looked: true, processes: [] }),
  });
  expect(openPaths(real)).toEqual([]);
  expect(mode(join(home, "elsewhere"))).toBe(0o755);
  expect(lstatSync(join(home, ".counterparts")).isSymbolicLink()).toBe(true);
  expect(modesFindings(store, "darwin", configPath, home)[0]?.severity).toBe("green");
});

test("a link from the home to the home itself is never closed", () => {
  const home = realpathSync(temp());
  symlinkSync(home, join(home, "me"));
  const configPath = join(home, "me", "counterparts.json");
  const store = join(home, "store");
  Store.open({ dir: store }).close();
  writeFileSync(join(home, "counterparts.json"), JSON.stringify({ dataDir: store }));
  chmodSync(home, 0o755);
  tightenInstallBase(configPath, store, { home });
  expect(mode(home)).toBe(0o755);
  expect(installBasePaths(configPath, store, home)?.baseIsOurs).toBe(false);
});

test("config at ~/counterparts.json with snapshots.dir = ~/Documents: the base does not take Documents whole either", () => {
  const home = realpathSync(temp());
  const store = join(home, "store");
  Store.open({ dir: store }).close();
  const configPath = join(home, "counterparts.json");
  writeFileSync(configPath, JSON.stringify({ dataDir: store, snapshots: { dir: join(home, "Documents") } }));
  mkdirSync(join(home, "Documents", "taxes"), { recursive: true });
  writeFileSync(join(home, "Documents", "letter.txt"), "dear\n");
  for (const e of walk(home)) chmodSync(e.path, e.dir ? 0o755 : 0o644);
  const p = installBasePaths(configPath, store, home);
  expect(p?.trees.map((t) => basename(t))).not.toContain("Documents");
  tightenInstallBase(configPath, store, { home });
  expect(mode(home)).toBe(0o755);
  expect(mode(join(home, "Documents"))).toBe(0o755);
  expect(mode(join(home, "Documents", "letter.txt"))).toBe(0o644);
  expect(mode(join(home, "Documents", "taxes"))).toBe(0o755);
  expect(mode(configPath)).toBe(0o600);
});

// ── R8: the #657 follow-up lows ─────────────────────────────────────────────

describe("R8: special bits, the mirror, a dangling base link", () => {
  /** The console as a child under umask 022, with HOME the temp home. */
  function cli(home: string, args: readonly string[]): { code: number | null; out: string } {
    const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, USERPROFILE: home, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    const res = spawnSync(
      "/bin/sh",
      ["-c", 'umask 022; exec "$@"', "sh", process.execPath, ...scriptArgs(CLI, process.execPath), ...args],
      { env, encoding: "utf8", input: "", timeout: 60_000 },
    );
    return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }

  function installed(): { home: string; base: string; store: string; configPath: string } {
    const home = realpathSync(temp());
    const base = join(home, ".counterparts");
    const configPath = join(base, "claude-code.json");
    expect(cli(home, ["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"]).code).toBe(0);
    return { home, base, store: join(base, "store"), configPath };
  }

  test("a setgid store dir: a writer leaves it, and doctor says to chmod it by hand, not that a session will", () => {
    const { home, store, configPath } = installed();
    chmodSpecial(store, 0o2755);
    // macOS clears g+s silently for a group the user is not in; Linux CI carries it then.
    if ((lstatSync(store).mode & 0o2000) === 0) return;
    expect(cli(home, ["note", "Ada waters the fern on the landing every other Thursday", "--dir", store]).out).toContain("Remembered");
    expect(lstatSync(store).mode & 0o7777).toBe(0o2755);
    const doc = cli(home, ["doctor", "--config", configPath]);
    const privacy = doc.out.split("\n").filter((l) => /Privacy|chmod/.test(l)).join("\n");
    expect(privacy).toContain(`chmod go-rwx "${store}"`);
    expect(privacy).toContain("no session will close it");
    expect(privacy).not.toContain("the next Claude Code session");
    // Closed by hand as told: green, the bit kept.
    expect(spawnSync("/bin/chmod", ["go-rwx", store]).status).toBe(0);
    expect(lstatSync(store).mode & 0o7777).toBe(0o2700);
    expect(cli(home, ["doctor", "--config", configPath]).out).toContain("readable by you alone");
  });

  test("a configured mirror is named as not checked; its loose copies are left as they are", () => {
    const { home, configPath } = installed();
    const mirror = join(home, "mirror");
    mkdirSync(join(mirror, "2026-10-01T00-00-00-000Z"), { recursive: true });
    writeFileSync(join(mirror, "2026-10-01T00-00-00-000Z", "counterparts.sqlite"), "old copy\n");
    chmodSync(join(mirror, "2026-10-01T00-00-00-000Z", "counterparts.sqlite"), 0o644);
    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(configPath, `${JSON.stringify({ ...cfg, snapshots: { mirror } }, null, 2)}\n`);
    const doc = cli(home, ["doctor", "--config", configPath]);
    expect(doc.out).toContain("readable by you alone");
    expect(doc.out).toContain(`the snapshot mirror at ${mirror} is not checked here`);
    expect(mode(join(mirror, "2026-10-01T00-00-00-000Z", "counterparts.sqlite"))).toBe(0o644);
  });

  test("install through a dangling ~/.counterparts link refuses by name and makes nothing", () => {
    const home = realpathSync(temp());
    const target = join(home, "elsewhere", "base");
    const link = join(home, ".counterparts");
    symlinkSync(target, link);
    const res = cli(home, ["install", "--no-connect", "--config", join(link, "claude-code.json"), "--budget", "9000", "--name", "Ada"]);
    expect(res.code).not.toBe(0);
    expect(res.out).toContain(`${link} is a symbolic link to ${target}, which is not there`);
    expect(res.out).toContain(`mkdir -p "${target}"`);
    expect(res.out).not.toContain("ENOENT");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(home, "elsewhere"))).toBe(false);
  });
});
