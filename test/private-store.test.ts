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
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { modesFindings } from "../src/adapters/claude-code/doctor-modes.js";
import { runSnapshot } from "../src/adapters/snapshots.js";
import { Counterpart } from "../src/core/counterpart.js";
import { STORE_TIGHTENED_EVENT, Store, storeNeedsTightening, tightenStore } from "../src/core/store/index.js";
import { tightenInstallBase } from "../src/adapters/private-base.js";
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
  test("`counterparts connect` tightens a loose ~/.counterparts (its config, snapshots, log) and nothing outside it", async () => {
    const home = join(temp(), "home");
    const base = join(home, ".counterparts");
    const store = join(base, "store");
    const configPath = join(base, "claude-code.json");
    const env = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    const c = quietIo();
    expect(await run(["install", "--no-connect", "--config", configPath, "--budget", "9000", "--name", "Ada"], { io: c.io, env, home })).toBe(EXIT.ok);
    mkdirSync(join(base, "snapshots", "2026-10-01T00-00-00-000Z"), { recursive: true });
    mkdirSync(join(base, "log"), { recursive: true });
    writeFileSync(join(base, "log", "2026-10-27.jsonl"), "{}\n");
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
    // The store is the core's (a writer's open); the base, its config and
    // snapshots and log are `connect`'s (`private-base.ts`).
    expect(mode(base)).toBe(0o700);
    expect(mode(configPath)).toBe(0o600);
    expect(mode(join(base, "snapshots", "2026-10-01T00-00-00-000Z"))).toBe(0o700);
    expect(mode(join(base, "log", "2026-10-27.jsonl"))).toBe(0o600);
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
