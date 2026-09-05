/**
 * `adapters/cli/` — the owner's console, against real temp stores.
 *
 * Nothing is faked but the console: `Io` collects stdout/stderr into arrays and
 * supplies a scripted answer for the confirmation prompt. Every store is real,
 * every copy is a real copy, and the removal really removes.
 *
 * Two tests here are the ones the contract cares most about, and both are
 * scars rather than features:
 *
 *   §2.11 — the canonical database is copied while a writer holds an OPEN,
 *   uncommitted transaction, and the copy is then opened and read. v1 copied a
 *   live SQLite file with no checkpoint and got away with it because the
 *   database was a declared rebuildable cache; rescope 1 removed exactly that
 *   mitigation.
 *
 *   §16 G2 — the caller-universality test over the import graph. `removal.ts`
 *   may be imported by this directory and nothing else. That test failing is
 *   the point of having it.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { TUNABLES } from "../src/core/physics/index.js";
import {
  BRIEFING_KEY,
  PREFACE_RESERVE_BYTES,
  byteLength,
  readSentinel,
} from "../src/core/self/index.js";
import { PHASES, markerKey } from "../src/core/sleep/index.js";
import { findIdentityCore } from "../src/core/self/index.js";
// Box 3 directly, for the two things `verify`'s guard is about: seeding a
// vector the way the backfill seeds one, and counting what is still there.
import {
  convertVectorBatch,
  decodeVector,
  indexDoc,
  openCache,
  setEmbedding,
} from "../src/core/store/cache.js";
import { openDb } from "../src/core/store/db.js";
import { LAYOUT, Store, paths } from "../src/core/store/index.js";
import {
  BLOB_NAME,
  CONFIG_FILE,
  COMMANDS,
  COMMAND_BLURB,
  COMMAND_FLAGS,
  COMMON_FLAGS,
  CREDENTIALS_FILE,
  commandHelp,
  EXIT,
  HOOK_SCRIPT,
  HOST_EVENTS,
  MCP_SCRIPT,
  OWNER_OPS,
  installLayout,
  layoutRefusal,
  mcpCommand,
  openCounterpart,
  runCommand,
  settingsBlock,
  unknownFlag,
  assertSafeTarget,
  decryptBundle,
  run,
  snapshot,
  vacuumInto,
} from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { ownerRemoval, planRemoval, verifyRemoval } from "../src/adapters/cli/removal.js";
// The box-2 half of the destruction path. Imported HERE for the same reason
// `removal.ts` is: this is the directory allowed to reach it, and the
// caller-universality test below pins that nothing else does.
import { chaseRemoved, unarchiveMerged } from "../src/core/store/owner-op-seam.js";
// The schemas module, to build (and then read back) the thing the repair is
// about: a belief that stopped being a belief.
import { Schemas } from "../src/core/schemas/index.js";
import { applyRevision } from "../src/core/revision.js";

const ENV = "COUNTERPARTS_DATA_DIR";

let dir: string;
let outside: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-cli-"));
  outside = mkdtempSync(join(tmpdir(), "counterparts-out-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

interface Console_ {
  io: Io;
  out: string[];
  err: string[];
  asked: string[];
}

function consoleWith(answers: readonly string[] = []): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const queue = [...answers];
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...(answers.length > 0
      ? {
          prompt: async (question: string): Promise<string> => {
            asked.push(question);
            return queue.shift() ?? "";
          },
        }
      : {}),
  };
  return { io, out, err, asked };
}

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

function text(lines: readonly string[]): string {
  return lines.join("\n");
}

/** Every canonical byte, so "this command wrote nothing" is checkable. */
function fingerprint(root: string): string {
  const parts: string[] = [];
  const walk = (path: string, rel: string): void => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${rel}/${name}`);
      return;
    }
    parts.push(`${rel}:${readFileSync(path).toString("base64")}`);
  };
  for (const name of ["prose", "versions", "spans", "operational.sqlite"]) {
    walk(join(root, name), name);
  }
  return parts.join("|");
}

// ── status ──────────────────────────────────────────────────────────────────

describe("status", () => {
  test("reports the absence of a store rather than creating one by looking — and exits non-zero", async () => {
    const empty = join(outside, "no-store-here");
    const c = consoleWith();
    const code = await run(["status", "--dir", empty], { io: c.io });
    // NOT 0. "There is no store here" is not a census: a script that asks a
    // store what it holds and gets an answer about nothing at all has not
    // succeeded, and `set -e` around `counterparts status` sailed straight past
    // a typo'd `--dir` (cold-stranger review, 2026-09-04, #11). `usage`, not
    // `failed`: nothing broke — the line named a place with no store in it.
    expect(code).toBe(EXIT.usage);
    // On stderr, because a non-zero exit whose only output is on stdout is half
    // a refusal.
    expect(text(c.err)).toContain("No store at");
    expect(text(c.out)).toBe("");
    // And the remedy carries the dir that was actually passed: `counterparts
    // init` alone would have created the store in the DEFAULT place.
    expect(text(c.err)).toContain(`Run 'counterparts init --dir ${empty}'`);
    // The wart this avoids: an instrument that mints the thing it inspects.
    expect(existsSync(empty)).toBe(false);
  });

  test("counts the journal APART from live memories, never as one of them", async () => {
    // The bug this pins: `store.list()` returns every row and episodes are
    // rows, so a census that counts what is left after archived/superseded
    // counts the journal as memories — with a `self` kind and an `episodic`
    // band no episode earned. Two of three census surfaces (the dashboard,
    // the MCP `status` tool) already separated it; the owner's own console
    // did not.
    const brain = openCounterpart(dir);
    open.push(brain);
    brain.store.put({ type: "memory", kind: "fact", body: "One ordinary memory." });
    const written = brain.appendEpisode(
      "s1",
      "The day the console learned to tell a journal from a memory.",
    );
    expect(written.appended).toBe(true);
    brain.close();

    const c = consoleWith();
    expect(await run(["status", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Memories: 1");
    expect(printed).toContain("Journal: 1 episode");
    // And a belief is neither: its own label, so no surface adds it into
    // "memories" and then disagrees with the wake preface (round 8).
    expect(printed).toContain("Beliefs and entities: 0");
    // And the kind/band breakdowns are over memories only.
    expect(printed).toContain("fact 1");
    expect(printed).toContain("self 0");
  });

  test("counts, the removal record, the permanent list, and the layout — and writes nothing", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "person", title: "Ada", body: "Ada reads the logs first." });
    s.updatePhysics(kept, { protected: true });
    const gone = s.put({ type: "memory", kind: "fact", body: "A fact that was later removed." });
    s.appendRemovalRecord({ memoryId: gone, stage: "complete", actor: "owner" });
    s.close();

    const before = fingerprint(dir);
    const c = consoleWith();
    const code = await run(["status"], { io: c.io, env: { [ENV]: dir } });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Memories:");
    expect(printed).toContain("person 1");
    expect(printed).toContain(`Removed: 1`);
    expect(printed).toContain(gone);
    // §14.1 G9: everything permanent is enumerable on demand — a list, not a cadence.
    expect(printed).toContain("Permanent");
    expect(printed).toContain(kept);
    expect(printed).toContain("protected");
    for (const entry of LAYOUT) expect(printed).toContain(entry.name);
    // §5 G9: reads are pure.
    expect(fingerprint(dir)).toBe(before);
  });
});

// ── init ────────────────────────────────────────────────────────────────────

describe("init", () => {
  test("creates a store and PRINTS the hook steps rather than installing them", async () => {
    const fresh = join(outside, "fresh-store");
    const c = consoleWith();
    const code = await run(["init", "--dir", fresh], { io: c.io });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(existsSync(paths.operational(fresh))).toBe(true);
    // Both shapes, because both are real installs: the packaged executables
    // and the entry scripts a `git clone` runs under bun.
    expect(printed).toContain("counterparts-hook");
    expect(printed).toContain("counterparts-mcp");
    expect(printed).toContain("bin/hook.ts");
    expect(printed).toContain("bin/serve.ts");
    expect(printed).toContain("injectionBudgetBytes");
    // The claims audit's F6, in the CLI's own text: with no flag the hook reads
    // one path, and it does fall back to the environment for the store. "No flag
    // and no environment override" was printed here for a while and is not true
    // (`hook.ts#hostConfig`, `dataDir: loaded.dataDir ?? dataDir()`). Since the
    // one-config rule (2026-09-05) the same paragraph says how to name another
    // file, because "the hooks read one path" without that sentence is the
    // half-truth the flag exists to end.
    expect(printed).toContain("with no flag they read");
    expect(printed).toContain("COUNTERPARTS_DATA_DIR");
    expect(printed).toContain("--config <absolute path>");
    expect(printed).toContain("$COUNTERPARTS_CONFIG");
    expect(printed).not.toContain("no environment override");
    // And the exit rule, with its one exception, wherever the exit rule is said.
    expect(printed).not.toContain("every hook exits 0");
    expect(printed).toContain("exits 2 on purpose");
    // Printed, not written: no host configuration file was created.
    expect(existsSync(join(fresh, "claude-code.json"))).toBe(false);
  });

  test("refuses a forbidden data dir via the constructor guard, before anything is created", async () => {
    const forbidden = join(homedir(), ".bansai", "cli-test-must-not-exist");
    const c = consoleWith();
    const code = await run(["init", "--dir", forbidden], { io: c.io });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("DATA_DIR_FORBIDDEN");
    expect(existsSync(forbidden)).toBe(false);
  });

  test("--name seeds the identity core, through the same door install uses", async () => {
    // §3 routes second and scratch stores to `init` and then says the identity
    // core has no default anywhere — so an `init` that could not seed one left
    // the documented path unable to produce the thing the page says matters.
    const named = join(outside, "named-store");
    const c = consoleWith();
    expect(await run(["init", "--dir", named, "--name", "Ada Lovelace"], { io: c.io })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("identity core seeded for Ada Lovelace");

    const brain = openCounterpart(named);
    open.push(brain);
    const coreId = findIdentityCore(brain.store);
    expect(coreId).not.toBe(null);
    expect(brain.store.readProse(coreId as string).meta["name"]).toBe("Ada Lovelace");
    brain.close();

    // ENSURE, not create: a second init with the same name mints no second core.
    const again = consoleWith();
    expect(await run(["init", "--dir", named, "--name", "Ada Lovelace"], { io: again.io })).toBe(
      EXIT.ok,
    );
    const after = openCounterpart(named);
    open.push(after);
    expect(findIdentityCore(after.store)).toBe(coreId);
    after.close();
  });

  test("install and init seed the SAME core, so the two paths make the same store", async () => {
    // §3 says both commands mean the same thing by `--name`. Until 2026-09-04
    // they did not: `init` minted the core, `install` deferred it to the first
    // hook, and a reader who followed §3 and then §7 saw a different live-row
    // count than the page had captured. One assertion, both doors.
    const viaInstall = join(outside, "same-install", "store");
    const viaInit = join(outside, "same-init");
    await run(["install", "--dir", viaInstall, "--budget", "9000", "--name", "Ada"], {
      io: consoleWith().io,
      env: {},
      home: join(outside, "home", "same"),
    });
    await run(["init", "--dir", viaInit, "--name", "Ada"], { io: consoleWith().io });

    for (const d of [viaInstall, viaInit]) {
      const brain = openCounterpart(d);
      open.push(brain);
      const core = findIdentityCore(brain.store);
      expect(core).not.toBe(null);
      expect(brain.store.readProse(core as string).meta["name"]).toBe("Ada");
      // One live row each, and it is the core — the shape §7's capture counts on.
      expect(brain.store.list({ archived: false }).length).toBe(1);
      brain.close();
    }
  });

  test("without --name it says the store has no identity core and how to seed one", async () => {
    const bare = join(outside, "bare-store");
    const c = consoleWith();
    expect(await run(["init", "--dir", bare], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("no identity core");
    expect(printed).toContain("--name");

    const brain = openCounterpart(bare);
    open.push(brain);
    expect(findIdentityCore(brain.store)).toBe(null);
    brain.close();
  });

  test("is idempotent: a second init reports the store it found", async () => {
    const fresh = join(outside, "twice");
    await run(["init", "--dir", fresh], { io: consoleWith().io });
    const c = consoleWith();
    expect(await run(["init", "--dir", fresh], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("already present");
  });
});

// ── backup ──────────────────────────────────────────────────────────────────

describe("backup", () => {
  test("the canonical DB is snapshotted MID-WRITE and the copy opens and reads the committed row", () => {
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      title: "Committed",
      body: "Written inside the window that precedes the copy.",
    });

    // A writer holds an OPEN, uncommitted transaction across the copy. This is
    // the shape that tore v1's file copies: a hot journal on disk and a main
    // file that is not, on its own, the database.
    const writer = openDb(paths.operational(dir));
    writer.exec("BEGIN IMMEDIATE");
    writer.run("INSERT INTO meta (key, value) VALUES (?, ?)", "uncommitted", "never-visible");
    expect(existsSync(`${paths.operational(dir)}-journal`)).toBe(true);

    const target = join(outside, "snap");
    const report = snapshot(s, target);
    writer.exec("COMMIT");
    writer.close();

    const db = report.copied.find((e) => e.name === "operational.sqlite");
    expect(db?.method).toBe("vacuum-into");
    expect(db?.ok).toBe(true);

    // Open the copy and read a row written inside the pre-copy write window.
    const copy = openDb(join(target, "operational.sqlite"));
    const row = copy.get<{ id: string }>("SELECT id FROM memories WHERE id = ?", id);
    expect(row?.id).toBe(id);
    // And the uncommitted write is NOT in the copy: a consistent snapshot, not
    // a smear of whatever the file happened to hold.
    expect(copy.get("SELECT value FROM meta WHERE key = ?", "uncommitted")).toBeUndefined();
    copy.close();
  });

  test("the backup set IS the layout's, and every top-level path is classified", async () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "Something worth keeping a copy of." });
    const backupSet = s.backupSet();
    s.close();

    const c = consoleWith();
    const code = await run(["backup", "--out", outside], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);

    const snapDir = join(outside, readdirSync(outside)[0] as string);
    for (const entry of LAYOUT) {
      const present = existsSync(join(snapDir, entry.name));
      if (entry.backup && existsSync(join(dir, entry.name))) expect(present).toBe(true);
      if (!entry.backup) expect(present).toBe(false);
    }
    // The list is derived from the store's own classification, never a second
    // hand-maintained one (scar §2.11: v1's allowlist silently omitted the
    // canonical journal for three weeks).
    expect(backupSet).toEqual(LAYOUT.filter((e) => e.backup).map((e) => e.name));
    // Box 3 is excluded on purpose, and the report SAYS so rather than omitting it.
    expect(text(c.out)).toContain("cache");
    expect(existsSync(join(snapDir, "cache"))).toBe(false);
  });

  test("a destination inside the store it is copying is refused, both sides resolved first", () => {
    const s = store();
    // The v1 shape: a trailing slash and a relative segment pointing back at
    // live data. `assertSafeTarget` resolves before it compares.
    expect(() => assertSafeTarget(dir, join(dir, "backups/"))).toThrow();
    expect(() => assertSafeTarget(dir, join(dir, "..", "..", "..", "..", "..", "..", "tmp"))).not.toThrow();
    expect(() => assertSafeTarget(dir, join(homedir(), ".bansai"))).toThrow();
    const report = snapshot(s, join(dir, "inside"));
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBe(1);
  });

  test("`backup` survives a store another process is WRITING — the live repro (§5 G8)", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Held", body: "Committed before the lock." });
    s.close();
    open.length = 0;

    // Exactly the live shape (live-verify 2026-08-25): a second process holds an
    // open write transaction on operational.sqlite while the owner runs a
    // backup. Before the fix the CONSTRUCTOR wrote at open, hit the lock, and
    // threw "database is locked" out of `run()` — no report, no exit code, a
    // stack trace on the owner's terminal.
    const holder = openDb(paths.operational(dir));
    holder.exec("BEGIN IMMEDIATE");
    holder.run("INSERT INTO meta (key, value) VALUES (?, ?)", "held", "1");

    const c = consoleWith();
    let code: number | undefined;
    try {
      code = await run(["backup", "--out", outside], { io: c.io, env: { [ENV]: dir } });
    } finally {
      holder.exec("COMMIT");
      holder.close();
    }

    // A report with an exit code — and, because the open no longer writes and
    // `VACUUM INTO` only needs a read, the backup actually SUCCEEDS through the
    // contention rather than merely failing politely.
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("ok  ");
    const snapDir = join(outside, readdirSync(outside)[0] as string);
    const copy = openDb(join(snapDir, "operational.sqlite"));
    expect(copy.get<{ id: string }>("SELECT id FROM memories WHERE id = ?", id)?.id).toBe(id);
    copy.close();
  });

  test("an open that fails is a report too, not a stack trace", async () => {
    const s = store();
    // A store a schema behind refuses to be migrated by an instrument — and the
    // backup command turns that refusal into a line and an exit code.
    s.setMeta("schemaVersion", "0");
    s.close();
    open.length = 0;

    const c = consoleWith();
    const code = await run(["backup", "--out", outside], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.failed);
    expect(text(c.out)).toContain("nothing was copied");
    expect(text(c.err)).toContain("STORE_UNINITIALIZED");
  });

  test("a backup problem is a REPORT, never a throw (§5 G8)", () => {
    const s = store();
    expect(() => snapshot(s, join(homedir(), ".bansai", "nope"))).not.toThrow();
    expect(snapshot(s, join(homedir(), ".bansai", "nope")).ok).toBe(false);
    expect(vacuumInto(join(dir, "does-not-exist.sqlite"), join(outside, "x.sqlite")).ok).toBe(false);
  });
});

// ── export ──────────────────────────────────────────────────────────────────

describe("export", () => {
  test("refuses to choose for you: neither --passphrase nor --plaintext is a refusal", async () => {
    store().put({ type: "memory", kind: "fact", body: "A memory that is not leaving quietly." });
    const c = consoleWith();
    const code = await run(["export", "--out", join(outside, "e")], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--passphrase");
    expect(existsSync(join(outside, "e", BLOB_NAME))).toBe(false);
  });

  test("--plaintext is portable: prose readable in any editor, DB openable", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Portable", body: "Readable in any editor." });
    s.close();
    const target = join(outside, "plain");
    const c = consoleWith();
    expect(await run(["export", "--out", target, "--plaintext"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );

    const proseFile = join(target, "prose", "memories", `${id}.md`);
    expect(readFileSync(proseFile, "utf8")).toContain("Readable in any editor.");
    const copy = openDb(join(target, "operational.sqlite"));
    expect(copy.get<{ id: string }>("SELECT id FROM memories WHERE id = ?", id)?.id).toBe(id);
    copy.close();
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("UNENCRYPTED");
  });

  test("--passphrase round-trips, and a wrong passphrase does not open it", async () => {
    const s = store();
    const secret = "The migraine clinic appointment is on the fourteenth.";
    const id = s.put({ type: "memory", kind: "person", body: secret });
    s.close();
    const target = join(outside, "sealed");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--passphrase", "correct horse battery"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);

    const blob = readFileSync(join(target, BLOB_NAME));
    // The ciphertext does not carry the plaintext, checked rather than assumed.
    expect(blob.toString("utf8")).not.toContain(secret);
    const opened = decryptBundle(blob, "correct horse battery");
    const prose = opened.get(`prose/memories/${id}.md`);
    expect(prose?.toString("utf8")).toContain(secret);
    expect(opened.has("operational.sqlite")).toBe(true);
    expect(() => decryptBundle(blob, "wrong passphrase")).toThrow();
  });
});

// ── remove ──────────────────────────────────────────────────────────────────

describe("remove — the loud removal", () => {
  test("dry run is the default: the plan prints, ids only, and nothing changes", async () => {
    const s = store();
    const secret = "A private thing that the owner decided to remove.";
    const id = s.put({ type: "memory", kind: "fact", body: secret });
    s.close();

    const before = fingerprint(dir);
    const c = consoleWith();
    const code = await run(["remove", id], { io: c.io, env: { [ENV]: dir } });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Dry run");
    expect(printed).toContain("chase prose");
    // The box-2 rows are a chase surface now, not a confession (BUILD-STATUS 3,
    // closed 2026-08-25): the plan names them alongside the prose, and the
    // "CANNOT chase" line — which used to name three surviving surfaces — has
    // nothing left to print. The LINE stays in the code, because a chase that
    // half-works at run time still has to say so (§16 G15).
    expect(printed).toContain("chase operational rows");
    expect(printed).not.toContain("CANNOT chase");
    // §16 G15: ids only. The contamination scan never prints what it matched.
    expect(printed).not.toContain(secret);
    expect(fingerprint(dir)).toBe(before);
    expect(Store.open({ dir, observer: true }).deniedIds()).toEqual([]);
  });

  test("--confirm without a matching typed id changes nothing", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Still here after a fumbled confirmation." });
    s.close();
    const before = fingerprint(dir);
    const c = consoleWith(["not-the-id"]);
    const code = await run(["remove", id, "--confirm"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("did not match");
    expect(fingerprint(dir)).toBe(before);
  });

  test("a non-interactive console refuses outright — a destructive op needs a human", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Not removable by a pipe." });
    s.close();
    const c = consoleWith();
    expect(await run(["remove", id, "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("interactive confirmation");
  });

  test("confirmed: the record is appended at every stage, the deny-list holds, the prose is gone", async () => {
    const s = store();
    const secret = "A credential-shaped regret the owner wants gone.";
    const id = s.put({ type: "memory", kind: "fact", title: "Regret", body: secret });
    s.put({ type: "memory", kind: "fact", body: "An unrelated memory that survives." });
    s.close();

    const c = consoleWith([id]);
    const code = await run(["remove", id, "--confirm", "--reason", "owner asked"], {
      io: c.io,
      env: { [ENV]: dir },
    });
    expect(code).toBe(EXIT.ok);
    expect(c.asked.length).toBe(1);

    const after = store({ observer: true });
    // The record is canonical, append-only, and carries every stage in order.
    const stages = after.removalRecord(id).map((r) => r.stage);
    expect(stages).toEqual(["requested", "dark", "chased", "complete"]);
    expect(after.removalRecord(id).every((r) => r.actor === "owner")).toBe(true);
    // No body, no content hash, anywhere in the record (§16 G9, scar §2.20).
    const recordText = JSON.stringify(after.removalRecord(id));
    expect(recordText).not.toContain(secret);
    expect(recordText).not.toContain("contentHash");

    // The deny-list holds, and the canonical prose is gone.
    expect(after.deniedIds()).toContain(id);
    const verdict = verifyRemoval(after, id);
    expect(verdict.denied).toBe(true);
    expect(verdict.proseGone).toBe(true);
    expect(proseHolds(dir, secret)).toBe(false);
    // The survivor is untouched: removal chases one memory, not a neighbourhood.
    expect(after.list().filter((other) => other !== id).length).toBe(1);
  });

  test("the chase completes: box-2 rows die with it, and `unchased` is empty", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Doomed", body: "The doomed one." });
    const neighbour = s.put({ type: "memory", kind: "fact", body: "A neighbour it conducts to." });
    s.link({ src: id, dst: neighbour, weight: 0.8, day: 0 });
    s.link({ src: neighbour, dst: id, weight: 0.8, day: 0 });
    s.setProspective({
      memoryId: id,
      windowKey: "w1",
      eventDate: "2026-09",
      precision: "month",
      state: "armed",
    });
    s.setGateRecords([
      { sessionId: "s1", kind: "surfaced", ref: id, turn: 1, lastDay: 0 },
      { sessionId: "s1", kind: "surfaced", ref: neighbour, turn: 1, lastDay: 0 },
    ]);
    s.close();

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("unchased (dark via the deny-list, never silently dropped): nothing");

    const after = store({ observer: true });
    // §16 G14: an erased id left in the graph keeps CONDUCTING between its
    // former neighbours. Both directions are gone, not just the outbound one.
    expect(after.edgesFrom(id)).toEqual([]);
    expect(after.edgesFrom(neighbour)).toEqual([]);
    expect(after.prospectiveFor(id)).toEqual([]);
    expect(after.gateRecords("s1").map((r) => r.ref)).toEqual([neighbour]);

    const verdict = verifyRemoval(after, id);
    expect(verdict).toMatchObject({ denied: true, proseGone: true, rowTombstoned: true, darkState: 0 });
    // The skeleton that stays is stripped of every content pointer, and of the
    // physics that would let it go on ranking, conducting or resisting.
    const skeleton = after.row(id);
    expect(skeleton).toMatchObject({
      content_hash: "",
      prose_path: "",
      protected: 0,
      promoted_identity: 0,
      uses: 0,
      archived: 1,
      archived_reason: "removed-by-owner",
    });
    // …and the tombstone says what it WAS, in flags and counts only.
    const tombstone = after.tombstones();
    expect(tombstone.length).toBe(1);
    expect(tombstone[0]).toMatchObject({
      id,
      kind: "fact",
      stage: "complete",
      rowSurvives: true,
      chased: { versions: 0, edges: 2, prospective: 1, gateRows: 1 },
    });
    expect(JSON.stringify(tombstone)).not.toContain("Doomed");
  });

  test("a chase without a record is refused — the record comes first, always (§16 G10)", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Alive and not going anywhere." });
    expect(() => chaseRemoved(s, id)).toThrow(/REMOVAL_NOT_DARK/);
    expect(s.row(id)?.prose_path).not.toBe("");
    expect(s.removalRecord().length).toBe(0);
  });

  test("an instrument cannot chase: the seam crosses the same stance check", () => {
    const w = store();
    const id = w.put({ type: "memory", kind: "fact", body: "Dark, but nobody may chase it." });
    w.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner" });
    w.close();

    const observer = store({ observer: true });
    expect(() => chaseRemoved(observer, id)).toThrow(/OBSERVER_REFUSED/);
    expect(observer.events("store.observer.standdown").at(-1)?.data?.site).toBe("chaseRemoved");
    // Nothing moved: the row is intact, edges and all.
    expect(observer.row(id)?.prose_path).not.toBe("");
    expect(observer.tombstones()).toEqual([]);
  });

  test("a removed id is skipped and COUNTED at rebuild, never quietly resurrected", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Removed, then rebuilt around." });
    s.put({ type: "memory", kind: "fact", body: "The one that stays indexed." });
    s.close();
    await run(["remove", id, "--confirm"], { io: consoleWith([id]).io, env: { [ENV]: dir } });

    const c = consoleWith();
    expect(await run(["verify", "--rebuild"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Skipped as removed (deny-list): 1");
    expect(printed).toContain("Re-indexed: 1");
    expect(printed).toContain("Every canonical row is accounted for.");
  });

  test("an id that is not a memory-bearing row is refused, and nothing is recorded", async () => {
    store().close();
    const c = consoleWith();
    expect(await run(["remove", "mem_notarealid", "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("unknown-id");
    // A typo must not put an id on the deny-list on the strength of being typed.
    expect(store({ observer: true }).removalRecord().length).toBe(0);
  });

  test("the port itself refuses an invalid target before writing a single stage", () => {
    const s = store();
    expect(planRemoval(s, "mem_nope").valid).toBe(false);
    expect(() =>
      ownerRemoval(s, { targetId: "mem_nope", actor: "owner", reason: "typo", requestedAt: 0 }),
    ).toThrow();
    expect(s.removalRecord().length).toBe(0);
  });
});

// ── removal residue: the span buffer ────────────────────────────────────────

/**
 * LAUNCH-STATUS §I2, and the owner's ruling on it (option A): a note is CAPTURED
 * into `spans/<scope>/jots.jsonl` before it is minted, nothing prunes that file,
 * and `remove` used to report `unchased: nothing` while the words were still on
 * disk — a backup taken afterwards copied them. The chase is core work; saying
 * so is this console's.
 *
 * The probe is §I2's own: a marker string, and a grep of the store afterwards,
 * so the test asserts the RESIDUE as well as the report about it.
 */
describe("remove — the span buffer is CHASED, and what it cannot reach it names", () => {
  const MARKER = "ZQRESIDUEPROBE the culvert gate key is kept under the third fence post.";

  /** Store-relative paths of every file holding `needle`. Ids and paths, no text. */
  function grepStore(root: string, needle: string): string[] {
    const hits: string[] = [];
    const walk = (at: string, rel: string): void => {
      for (const name of readdirSync(at).sort()) {
        const full = join(at, name);
        const next = rel === "" ? name : `${rel}/${name}`;
        if (statSync(full).isDirectory()) walk(full, next);
        else if (readFileSync(full, "utf8").includes(needle)) hits.push(next);
      }
    };
    walk(root, "");
    return hits;
  }

  function idFrom(lines: readonly string[]): string {
    const line = lines.find((l) => l.includes("Remembered mem_")) ?? "";
    return /mem_[0-9a-f]+/.exec(line)?.[0] ?? "";
  }

  /**
   * The MCP `note` tool's own two steps (`adapters/mcp/server.ts:337-362`), which
   * is exactly what `counterparts note` runs: `captureJot` FIRST — the verbatim
   * text into `spans/<key>/jots.jsonl` — then `submitJot` carrying that span's
   * hash as `ownSpanHash`. This is the door that made the residue.
   */
  async function noteThroughTheJotDoor(text: string): Promise<string> {
    const w = consoleWith();
    expect(await run(["note", text, "--dir", dir], { io: w.io })).toBe(EXIT.ok);
    return idFrom(w.out);
  }

  test("the words a note rode in on are struck out of the buffer, and a later backup has none of them", async () => {
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);
    expect(id).toMatch(/^mem_/);
    // The residue itself, before anything is removed: the prose AND the buffer.
    const seeded = grepStore(dir, "ZQRESIDUEPROBE");
    expect(seeded.some((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"))).toBe(true);
    expect(seeded.some((p) => p.startsWith("prose/"))).toBe(true);

    // The DRY RUN counts it as a surface to chase, and says so above the closing
    // line — a disclosure under "Nothing has changed" is one the reader has
    // already stopped reading.
    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("chase spans: 1");
    expect(planned).toContain("chased — spans/");
    expect(planned).toContain("the removal strikes them out of it");
    expect(planned.indexOf("chased — spans/")).toBeLessThan(
      planned.indexOf("Dry run. Nothing has changed."),
    );
    // §16 G15 still holds: the report names a file, never a word of its contents.
    expect(planned).not.toContain("culvert gate key");
    // A dry run strikes nothing.
    expect(grepStore(dir, "ZQRESIDUEPROBE").some((p) => p.startsWith("spans/"))).toBe(true);

    // THE REAL REMOVAL. The buffer is in `chased` with a count, `unchased` is
    // empty, and the completion event says so.
    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("spans(1 line in 1 file)");
    expect(printed).toContain("consumed.jsonl so nothing re-captures the words");
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped): nothing");
    expect(printed).toContain('"unchased":0');
    expect(printed).not.toContain("culvert gate key");

    // AND THE REPORT IS TRUE. This is LAUNCH-STATUS §I2's own grep, and the
    // whole point of the workstream: nothing under the data dir answers.
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);

    // The blast radius the finding measured: a snapshot taken AFTER the removal
    // used to carry the words. It does not now.
    const out = join(outside, "after-removal");
    const b = consoleWith();
    expect(await run(["backup", "--dir", dir, "--out", out], { io: b.io })).toBe(EXIT.ok);
    expect(grepStore(out, "ZQRESIDUEPROBE")).toEqual([]);
  });

  test("the durable strike record carries counts and no content, and the hash is kept so nothing re-captures it", async () => {
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: consoleWith([id]).io })).toBe(
      EXIT.ok,
    );

    const scopes = readdirSync(join(dir, "spans")).filter((n) => /^[0-9a-f]{12}$/.test(n));
    expect(scopes.length).toBe(1);
    const scopeDir = join(dir, "spans", scopes[0] as string);

    const strikes = readFileSync(join(scopeDir, "strikes.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(strikes.length).toBe(1);
    expect(strikes[0]?.["struck"]).toBe(1);
    expect(strikes[0]?.["by"]).toBe("owner");
    // §16 G9: a record of a destruction carries no hash of what it destroyed.
    expect(Object.keys(strikes[0] ?? {}).sort()).toEqual(
      ["at", "by", "day", "files", "ledgered", "struck"],
    );

    // The terminal ledger holds the hash, which is what stops the words being
    // re-admitted by a re-capture, a restore, or a crashed run's orphan merge.
    const consumed = readFileSync(join(scopeDir, "consumed.jsonl"), "utf8");
    expect(consumed.trim().length).toBeGreaterThan(0);
    expect(consumed).not.toContain("culvert gate key");
  });

  test("a note taken TWICE loses only the removed one — the strike is not a truncation", async () => {
    store().close();
    const keeper = "ZQKEEPER the north gate is padlocked and the key hangs in the tack room.";
    const doomedId = await noteThroughTheJotDoor(MARKER);
    await noteThroughTheJotDoor(keeper);

    expect(
      await run(["remove", doomedId, "--confirm", "--dir", dir], { io: consoleWith([doomedId]).io }),
    ).toBe(EXIT.ok);

    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
    // The other note's capture is untouched: in the buffer AND in its prose.
    const kept = grepStore(dir, "ZQKEEPER");
    expect(kept.some((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"))).toBe(true);
    expect(kept.some((p) => p.startsWith("prose/"))).toBe(true);
  });

  test("with the prose GONE, the coverage mark alone still chases it — which is why old rows need no migration", async () => {
    // The retroactive half, isolated. Deleting the prose file takes away BOTH
    // the other two keys at once: the `origin.spanHash` meta this branch added,
    // and the body the option-A console matched on. What is left is what the
    // store has always held — `origin_ref` on the row and an `own: true` mark in
    // the scope's `coverage.jsonl` — and it is enough. That is why a memory
    // minted months before this branch is chaseable with no migration.
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);

    const s = store();
    const prosePath = s.row(id)?.prose_path ?? "";
    const ref = s.row(id)?.origin_ref ?? "";
    s.close();
    expect(ref).toMatch(/^prp_/);
    rmSync(prosePath, { force: true });

    // The mark this chase runs on, on disk since long before the feature.
    const scopes = readdirSync(join(dir, "spans")).filter((n) => /^[0-9a-f]{12}$/.test(n));
    const coverage = readFileSync(join(dir, "spans", scopes[0] as string, "coverage.jsonl"), "utf8");
    expect(coverage).toContain(`"proposalId":"${ref}"`);
    expect(coverage).toContain('"own":true');

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    // Not `unknown`, which is what this same store says when the mark is missing
    // (the blind-spot test below): the buffer is addressed by identity here.
    expect(text(plan.out)).toContain("chase spans: 1");
    expect(text(plan.out)).toContain("chased — spans/");
    expect(text(plan.out)).toContain("matched by the span hash its mint recorded");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("spans(1 line in 1 file)");
    expect(text(c.out)).toContain('"unchased":0');
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
  });

  test("a conversation turn that QUOTES the note is disclosed and left — the plan's count is the strike's count", async () => {
    // The live shape the CLI-only fixtures cannot make: on the owner's machine a
    // note is taken mid-conversation, so the Stop hook has already captured the
    // turn in which the words were SAID into `buffer.jsonl`. That span belongs
    // to no single memory — it is many turns joined — and striking it because
    // one memory quoted it would destroy material nobody named. So it is left,
    // and it is SAID (§16 G15), and the plan's number matches the strike's.
    store().close();
    const s = store();
    s.close();
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureSpans({
        session: "live",
        scope: process.cwd(),
        turns: [
          { role: "user", text: `Please remember this for me: ${MARKER} And then let us move on.` },
        ],
      });
    } finally {
      counterpart.close();
    }
    const id = await noteThroughTheJotDoor(MARKER);
    expect(grepStore(dir, "ZQRESIDUEPROBE").filter((p) => p.startsWith("spans/")).sort()).toEqual([
      expect.stringContaining("buffer.jsonl"),
      expect.stringContaining("jots.jsonl"),
    ]);

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    // ONE line struck, not two: the jot's own capture.
    expect(planned).toContain("chase spans: 1");
    expect(planned).toContain("1 line of conversation under spans/");
    expect(planned).toContain("transcript, not this memory's own capture, and left alone");
    // Matched BY WHAT, said out loud — the two chases are not equally strong.
    expect(planned).toContain("matched by the span hash its mint recorded");
    // The echo is LEFT, which is neither a chase nor a failure, and it never
    // appears under "CANNOT chase … the id goes dark instead" — a conversation
    // turn has no id and no tombstone.
    expect(planned).toContain("LEFT on purpose — spans echo:");
    expect(planned).not.toContain("CANNOT chase spans echo");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    // The plan said 1, the strike took 1.
    expect(printed).toContain("spans(1 line in 1 file)");
    // And the leftover is COUNTED, by name, on its own line — not filed under
    // "unchased (dark via the deny-list…)", which is about failure.
    expect(printed).toContain("left on purpose (not a failure");
    expect(printed).toContain("spans echo: 1 line of conversation");
    expect(printed).toContain('"unchased":0');

    const left = grepStore(dir, "ZQRESIDUEPROBE");
    expect(left.some((p) => p.endsWith("jots.jsonl"))).toBe(false);
    expect(left.some((p) => p.endsWith("buffer.jsonl"))).toBe(true);
    expect(left.some((p) => p.startsWith("prose/"))).toBe(false);
  });

  test("the CONTENT fallback may only ever take a jot — a conversation turn is never struck by shape", async () => {
    // The other half of the echo rule, and the one that matters most: a row with
    // NO recorded hash (migrated, or minted before provenance) is chased by
    // matching its body, and a body that happens to appear verbatim inside a
    // live conversation turn must not take that turn with it. The predicate is
    // restricted to `kind: "jot"` in the seam AND in the plan's count, so this
    // is not a rule one caller could forget.
    store().close();
    const BODY = "ZQFALLBACK the boathouse combination is the year the pier was rebuilt.";
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureSpans({
        session: "live",
        scope: process.cwd(),
        turns: [{ role: "user", text: `We talked about it: ${BODY} Anyway.` }],
      });
    } finally {
      counterpart.close();
    }

    // A row with no origin at all: no spanHash meta, no origin_ref, so nothing
    // but the body can address the buffer.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: BODY });
    s.close();
    expect(s.row).toBeDefined();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    // Nothing to strike — the only line holding these words is a conversation
    // turn, and no jot matched — so the state is the honest `unknown` (a row
    // with no provenance cannot prove it never rode the buffer) AND the
    // conversation line is disclosed. Both, neither hiding the other.
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("if a jot is there");
    expect(planned).toContain("1 line of conversation under spans/");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).not.toContain("spans(1 line");
    expect(text(c.out)).toContain("spans echo: 1 line of conversation");
    expect(text(c.out)).toContain('"unchased":1');
    // THE POINT: the conversation is untouched.
    expect(grepStore(dir, "ZQFALLBACK").some((p) => p.endsWith("buffer.jsonl"))).toBe(true);
    expect(grepStore(dir, "ZQFALLBACK").some((p) => p.startsWith("prose/"))).toBe(false);
  });

  test("a memory that never rode the buffer reads 'not applicable', and unchased stays 0", async () => {
    // A buffer EXISTS in this store — the note above is what puts one there — so
    // "not applicable" is a statement about this memory, not about an empty
    // directory. The row is shaped the way a sweep mint shapes one:
    // `channel: "fallback"`, `ownSpanHash: null`, an origin that names the scope.
    store().close();
    expect(await run(["note", MARKER, "--dir", dir], { io: consoleWith().io })).toBe(EXIT.ok);

    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory the sweep wrote about a conversation, never captured as a jot.",
      source: "fallback",
      origin: { session: "s1", scope: process.cwd(), ref: "prp_test" },
    });
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    expect(text(plan.out)).toContain("spans: not applicable");
    expect(text(plan.out)).toContain("a 'fallback' memory is not captured as a jot");
    expect(text(plan.out)).toContain("no jot under spans/");
    expect(text(plan.out)).toContain("chase spans: 0");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped): nothing");
    expect(printed).toContain('"unchased":0');
    // And the other note's capture is still there — a removal that struck an
    // unrelated scope's buffer would be the worst failure this seam can have.
    expect(grepStore(dir, "ZQRESIDUEPROBE").some((p) => p.startsWith("spans/"))).toBe(true);
  });

  test("removing a migrated row does NOT reach into other projects' jots — it lists them and refuses", async () => {
    // REVIEW F4, and the reason it blocks the live store: `tools/migrate/apply.ts`
    // writes `origin: { ref }` and NOTHING else, so every one of ~12,000 migrated
    // rows has no scope and no span hash. The only chase left is by content — and
    // a content chase with no scope visits every project on the machine.
    // Measured before the fix: removing "buy milk" destroyed two unrelated jots
    // in two unrelated projects and ledgered both their hashes.
    store().close();
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureJot({ session: "a", scope: "/Users/test/project-a", text: "ZQMILK buy milk" });
      counterpart.captureJot({
        session: "b",
        scope: "/Users/test/project-b",
        text: "ZQMILK buy milk and call the vet about the spaniel",
      });
    } finally {
      counterpart.close();
    }

    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "ZQMILK buy milk",
      source: "migrated",
      origin: { ref: "v1_trace_00891" },
    });
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("would have to visit EVERY project on this machine");
    expect(planned).toContain("--strike-by-content-across-scopes");
    // The candidate is NAMED — file and count — and its words are not printed.
    expect(planned).toMatch(/1 jot line whose whole text is this memory's body would have matched, in spans\/[0-9a-f]{12}\/jots\.jsonl \(1\)/);
    expect(planned).not.toContain("call the vet");
    // The longer jot is not even a candidate: exact-line equality, not substring.
    expect(planned).toContain("(1)");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    // NOTHING was struck, and BOTH other projects' jots are exactly as they were.
    expect(text(c.out)).not.toContain("spans(");
    expect(text(c.out)).toContain('"unchased":1');
    const left = grepStore(dir, "ZQMILK");
    expect(left.filter((p) => p.startsWith("spans/")).length).toBe(2);
    // And no hash was ledgered on their behalf.
    for (const scope of readdirSync(join(dir, "spans")).filter((n) => /^[0-9a-f]{12}$/.test(n))) {
      expect(existsSync(join(dir, "spans", scope, "consumed.jsonl"))).toBe(false);
    }
  });

  test("--strike-by-content-across-scopes performs it, and STILL only takes the exact jot", async () => {
    store().close();
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureJot({ session: "a", scope: "/Users/test/project-a", text: "ZQMILK buy milk" });
      counterpart.captureJot({
        session: "b",
        scope: "/Users/test/project-b",
        text: "ZQMILK buy milk and call the vet about the spaniel",
      });
    } finally {
      counterpart.close();
    }
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "ZQMILK buy milk",
      source: "migrated",
      origin: { ref: "v1_trace_00891" },
    });
    s.close();

    const plan = consoleWith();
    expect(
      await run(["remove", id, "--strike-by-content-across-scopes", "--dir", dir], { io: plan.io }),
    ).toBe(EXIT.ok);
    expect(text(plan.out)).toContain("chase spans: 1");
    expect(text(plan.out)).toContain("matched by content across every scope, on your say-so");

    const c = consoleWith([id]);
    expect(
      await run(["remove", id, "--confirm", "--strike-by-content-across-scopes", "--dir", dir], {
        io: c.io,
      }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("spans(1 line in 1 file)");
    // The one whose WHOLE text was the body is gone; the one that merely
    // contains the words — somebody else's memory — is untouched.
    const left = grepStore(dir, "ZQMILK").filter((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"));
    expect(left.length).toBe(1);
    expect(readFileSync(join(dir, left[0] as string), "utf8")).toContain("call the vet");
  });

  test("a crashed strike's .striking aside is SEEN by the plan and folded back by the next one", async () => {
    // REVIEW F1 + F2 + F3. An aside is a crashed strike's survivors: invisible
    // to `claimFiles()`, invisible to the sweep, and — before the fix —
    // invisible to the residue walk, so a second `remove` said "not applicable"
    // while the words sat on disk and `backup` copied them.
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);
    const scope = readdirSync(join(dir, "spans")).find((n) => /^[0-9a-f]{12}$/.test(n)) as string;
    const jots = join(dir, "spans", scope, "jots.jsonl");
    // Stage the crash: the rename landed, the append-back never did.
    renameSync(jots, `${jots}.striking`);
    expect(existsSync(jots)).toBe(false);
    expect(grepStore(dir, "ZQRESIDUEPROBE").some((p) => p.endsWith(".striking"))).toBe(true);

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    // SEEN, not "not applicable".
    expect(text(plan.out)).toContain("chase spans: 1");
    expect(text(plan.out)).toContain(".striking");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    // The aside is gone, the words are gone, and nothing is stranded.
    expect(existsSync(`${jots}.striking`)).toBe(false);
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
  });

  test("an unrelated strike RECOVERS a stranded aside — repair is not gated on having something to strike", async () => {
    // REVIEW F3. The survivors in an aside belong to nobody's removal, so
    // folding them back must not wait for a removal that happens to match them.
    store().close();
    const keeper = "ZQKEEPER the north gate is padlocked and the key hangs in the tack room.";
    await noteThroughTheJotDoor(keeper);
    const doomedId = await noteThroughTheJotDoor(MARKER);
    const scope = readdirSync(join(dir, "spans")).find((n) => /^[0-9a-f]{12}$/.test(n)) as string;
    const jots = join(dir, "spans", scope, "jots.jsonl");

    // A crashed strike left BOTH notes' captures in an aside.
    renameSync(jots, `${jots}.striking`);

    expect(
      await run(["remove", doomedId, "--confirm", "--dir", dir], { io: consoleWith([doomedId]).io }),
    ).toBe(EXIT.ok);

    // The doomed one is gone; the OTHER note's capture came home to the live
    // stream, where the buffer can see it again.
    expect(existsSync(`${jots}.striking`)).toBe(false);
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
    expect(readFileSync(jots, "utf8")).toContain("ZQKEEPER");
  });

  test("the honest line survives for the one state left blind: prose gone, no hash recorded", async () => {
    store().close();
    expect(await run(["note", MARKER, "--dir", dir], { io: consoleWith().io })).toBe(EXIT.ok);

    // A row minted before provenance existed: `source` NULL, no origin at all,
    // and its prose file removed underneath the store. There is nothing left to
    // address the buffer with, and the console says exactly that.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "A pre-provenance memory." });
    const prose = s.row(id)?.prose_path ?? "";
    s.close();
    rmSync(prose, { force: true });

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("no span hash was recorded");
    expect(planned).toContain("a later backup would copy it");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("unchased (dark via the deny-list, never silently dropped): spans/");
    expect(text(c.out)).toContain('"unchased":1');
  });
});

// ── verify ──────────────────────────────────────────────────────────────────

describe("verify", () => {
  /** A vector in box 3, put there the way the backfill puts one there. */
  function seedVector(id: string): void {
    const db = openCache(paths.cache(dir));
    try {
      setEmbedding(db, id, [0.1, 0.2, 0.3]);
    } finally {
      db.close();
    }
  }

  /** Box 3 as it looked before I13: a dead row's tokens still in the index. */
  function reindexDead(id: string, text: string): void {
    const db = openCache(paths.cache(dir));
    try {
      indexDoc(db, id, text);
    } finally {
      db.close();
    }
  }

  /**
   * EVERY file under the data dir, cache included — the dashboard suite's
   * protocol (`test/dashboard.test.ts`'s `snapshot`), not `fingerprint`, which
   * skips box 3 and would let a census that rewrote `doc_tokens` through.
   */
  function everyByte(root: string): string {
    const parts: string[] = [];
    const walk = (at: string): void => {
      for (const name of readdirSync(at).sort()) {
        const full = join(at, name);
        if (statSync(full).isDirectory()) walk(full);
        else parts.push(`${full}:${readFileSync(full).toString("base64")}`);
      }
    };
    walk(root);
    return parts.join("|");
  }

  /** What box 3 holds, read the way the census reads it. */
  function embeddings(): number {
    if (!existsSync(paths.cache(dir))) return 0;
    const db = openDb(paths.cache(dir));
    try {
      return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
    } finally {
      db.close();
    }
  }

  test("the bare command is a CENSUS: it counts box 3 and drops nothing", async () => {
    // The sharp edge: `rebuildCache()` starts with `resetCache`, which drops
    // `embeddings`, and this console has no embedder — so a bare `verify` used
    // to cost one paid network call per vector to undo. On the live store that
    // was ~13,700 of them.
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "The memory whose vector must survive a look." });
    s.put({ type: "memory", kind: "fact", body: "A second memory, with no vector of its own." });
    s.close();
    seedVector(kept);

    const before = fingerprint(dir);
    const everyByteBefore = everyByte(dir);
    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Canonical rows: 2");
    expect(printed).toContain("embeddings: 1");
    expect(printed).toContain("live memories with no vector: 1");
    // "live", not "canonical": since I13 the index covers the LIVE rows and an
    // archived one is deliberately absent from it.
    expect(printed).toContain("live rows: 2");
    expect(printed).toContain("indexed but not live (archived or superseded): 0");
    expect(printed).toContain("The cache covers every live row");
    // Nothing canonical moved, and — the whole point — the vector is still there.
    expect(fingerprint(dir)).toBe(before);
    expect(embeddings()).toBe(1);
    // And not a byte anywhere in the directory, box 3 included: `openCache` is
    // version-idempotent now, so the census may claim the strong form the
    // dashboard suite could only claim across renders (its INTERFACE-GAPS §1).
    expect(everyByte(dir)).toBe(everyByteBefore);
  });

  test("--prune-index is the cheap repair for a store written before I13", async () => {
    // A store that archived rows BEFORE `archive` deindexed them still holds
    // their tokens, where they count toward document frequency against a live
    // denominator. `--rebuild` would fix it and drop every embedding on the way,
    // and refuses outright while it holds any — so it is not a repair the owner
    // of a real store can run. This one is, and the vector survives it.
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "The zygomorphic orchid bloomed after the frost." });
    const gone = s.put({ type: "memory", kind: "fact", body: "The zygomorphic orchid was moved indoors." });
    s.archive(gone, "duplicate");
    s.close();
    // Put the pre-I13 state back by hand, through box 3's own door: archived in
    // box 2, still indexed in box 3, which is what every store written before
    // this change looks like.
    reindexDead(gone, "The zygomorphic orchid was moved indoors.");
    seedVector(kept);

    const before = consoleWith();
    expect(await run(["verify"], { io: before.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(before.out)).toContain("indexed but not live (archived or superseded): 1");
    expect(text(before.err)).toContain("--prune-index");

    const c = consoleWith();
    expect(await run(["verify", "--prune-index"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Dropped from the text index (archived or superseded): 1");
    expect(embeddings()).toBe(1);

    const after = consoleWith();
    expect(await run(["verify"], { io: after.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(after.out)).toContain("indexed but not live (archived or superseded): 0");
  });

  test("--rebuild REFUSES while box 3 holds vectors nothing here can recompute", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory whose vector cost a network call." });
    s.close();
    seedVector(kept);

    const before = fingerprint(dir);
    const c = consoleWith();
    expect(await run(["verify", "--rebuild"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("the 1 embedding it holds would be gone");
    expect(text(c.err)).toContain("paid network call");
    expect(text(c.err)).toContain("--drop-vectors");
    // A refusal that had already opened a writable store would be no refusal.
    expect(fingerprint(dir)).toBe(before);
    expect(embeddings()).toBe(1);
  });

  test("--rebuild --drop-vectors proceeds, and says how many it dropped", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory whose vector the owner chose to lose." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--drop-vectors"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    expect(printed).toContain("Dropped on your say-so (--drop-vectors): 1 embedding.");
    expect(printed).toContain("Re-indexed: 1");
    expect(embeddings()).toBe(0);
  });

  test("--rebuild rebuilds box 3 from canonical state and accounts for every row", async () => {
    const s = store();
    for (let i = 0; i < 5; i++) s.put({ type: "memory", kind: "fact", body: `Canonical memory ${i} of five.` });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });

    // No vectors to lose, so no flag is needed: the guard is about cost, not ceremony.
    const c = consoleWith();
    expect(await run(["verify", "--rebuild"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Re-indexed: 5");
    // What cannot be recomputed is DECLARED, with an owner and a repair (§5 G8).
    expect(text(c.out)).toContain("declared: embeddings");
  });

  test("--rebuild refuses when the vector count CANNOT be taken — the guard fails closed", async () => {
    // The realistic version of this is contention: box 3 is the file the Stop
    // worker writes vectors into, so a locked read is ordinary. An unreadable
    // file reproduces the same branch without a second process. A guard that
    // read zero from a failure would drop what it could not count.
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index went unreadable." });
    s.close();
    writeFileSync(paths.cache(dir), "not a database");

    const c = consoleWith();
    expect(await run(["verify", "--rebuild"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("could not be read");
    expect(readFileSync(paths.cache(dir)).toString()).toBe("not a database");

    // The census over the same store cannot even open it — `Store.open` builds
    // box 3 on the way in — and that is a reported failure, not a stack trace
    // and not a repair.
    const look = consoleWith();
    expect(await run(["verify"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(look.err)).toContain("verify failed:");
    expect(readFileSync(paths.cache(dir)).toString()).toBe("not a database");
  });

  test("the census says so when box 3 is missing, rather than rebuilding it", async () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index was deleted underneath it." });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });

    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(c.err)).toContain("verify --rebuild");
  });

  test("the census names the SHAPE the vectors are in", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory with a vector in the new shape." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("vector format: 1 float32 BLOB (v4)");

    // Age that row back to v3's JSON text and the census says which, and what
    // to run — a mixed cache is a state the readers tolerate and the owner
    // still has to finish.
    writeJsonVector(dir, kept, [0.1, 0.2, 0.3]);
    const look = consoleWith();
    expect(await run(["verify"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(look.out)).toContain("1 JSON text (v3)");
    expect(text(look.out)).toContain("counterparts migrate-cache");
  });

  test("--rebuild --keep-vectors re-indexes the text side and keeps every vector", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory whose vector must survive a rebuild." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--keep-vectors"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    expect(printed).toContain("Vectors kept: 1");
    expect(printed).toContain("dropped as no longer canonical: 0");
    expect(printed).toContain("Re-indexed: 1");
    // Nothing is declared, because nothing is missing — the console has no
    // embedder and did not need one.
    expect(printed).not.toContain("declared: embeddings");
    expect(embeddings()).toBe(1);
  });

  test("--drop-vectors and --keep-vectors together are refused, not guessed at", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory caught between two contradictory flags." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(
      await run(["verify", "--rebuild", "--drop-vectors", "--keep-vectors"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("opposite things");
    expect(embeddings()).toBe(1);
  });
});

// ── migrate-cache ───────────────────────────────────────────────────────────

/** Age one of box 3's rows back to v3's shape: `JSON.stringify` into `vec`. */
function writeJsonVector(at: string, id: string, vec: readonly number[]): void {
  const db = openDb(paths.cache(at));
  try {
    db.run(
      "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
      id,
      vec.length,
      JSON.stringify(vec),
    );
  } finally {
    db.close();
  }
}

describe("migrate-cache — the conversion that is not a rebuild", () => {
  function shapes(): { blob: number; text: number } {
    const db = openDb(paths.cache(dir));
    try {
      const n = (t: string): number =>
        db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE typeof(vec) = ?", t)?.n ?? 0;
      return { blob: n("blob"), text: n("text") };
    } finally {
      db.close();
    }
  }

  /** Memories with v3-shaped vectors — the state the live store is in. */
  function seedJsonStore(n = 2, dim = 3): string[] {
    const s = store();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(s.put({ type: "memory", kind: "fact", body: `A memory whose vector is still JSON text, number ${i}.` }));
    }
    s.close();
    const db = openCache(paths.cache(dir));
    db.close();
    ids.forEach((id, i) =>
      writeJsonVector(dir, id, Array.from({ length: dim }, (_, k) => Math.fround((i + k + 1) / 17))),
    );
    return ids;
  }

  test("the dry run is READ-ONLY — not a byte moves, on a v3-stamped cache either", async () => {
    // `ec31994` made this honest; the review found honest is not read-only.
    // `openCache` stamps `cache_meta.schemaVersion`, which changed the file's
    // hash under a line saying nothing had changed. Every question the dry run
    // asks is a SELECT, so `openDb` is the right door.
    seedJsonStore();
    const aged = openDb(paths.cache(dir));
    aged.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', '3')");
    aged.close();
    const before = readFileSync(paths.cache(dir)).toString("base64");

    const c = consoleWith();
    expect(await run(["migrate-cache"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("JSON text: 2");
    expect(printed).toContain("float32 BLOB: 0");
    expect(printed).toContain("schema v3");
    expect(printed).toContain("Sample:");
    expect(printed).toContain("largest coordinate change in this row:");
    expect(printed).toContain("Dry run. Nothing was changed");
    expect(printed).toContain("counterparts backup");
    // The claim in full: byte-identical, with the cache still stamped v3.
    expect(readFileSync(paths.cache(dir)).toString("base64")).toBe(before);
    expect(shapes()).toEqual({ blob: 0, text: 2 });
  });

  test("--apply REFUSES the default data dir — the store must be named", async () => {
    // On a real machine that default is the owner's live memory, and the guard
    // runs before this command looks at a single path.
    const c = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: c.io, env: {} })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("will not run against the default data dir");
    expect(text(c.err)).toContain("--dir");
  });

  test("--apply asks before it writes, and takes no for an answer", async () => {
    seedJsonStore();
    const before = readFileSync(paths.cache(dir)).toString("base64");

    // No prompt and no --yes: refuse rather than proceed unconfirmed.
    const mute = consoleWith();
    expect(await run(["migrate-cache", "--apply"], { io: mute.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(mute.err)).toContain("--yes");
    expect(readFileSync(paths.cache(dir)).toString("base64")).toBe(before);

    // Asked and declined.
    const no = consoleWith(["no"]);
    expect(await run(["migrate-cache", "--apply"], { io: no.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(no.asked.join("")).toContain("Type 'yes'");
    expect(text(no.err)).toContain("not confirmed");
    expect(shapes()).toEqual({ blob: 0, text: 2 });

    // Asked and confirmed.
    const yes = consoleWith(["yes"]);
    expect(await run(["migrate-cache", "--apply"], { io: yes.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(shapes()).toEqual({ blob: 2, text: 0 });
  });

  test("--apply --yes converts in place, keeps every vector, and compacts the file", async () => {
    seedJsonStore();
    const c = consoleWith();
    expect(
      await run(["migrate-cache", "--apply", "--yes", "--batch", "1"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Converted 2 vectors in 2 batches."); // batched, per --batch
    expect(printed).toContain("Vectors now: float32 BLOB 2, JSON text 0");
    expect(printed).toContain("Cache file:");
    // The count is the whole point: a migration that lost a vector would be a
    // rebuild wearing a different name.
    expect(shapes()).toEqual({ blob: 2, text: 0 });
  });

  test("a store CONVERTED BUT NOT COMPACTED has a door — the 177 MiB is not stranded", async () => {
    // The review's M2, reproduced: `VACUUM` is the step most likely to fail (it
    // takes an exclusive lock), and the old "already converted" refusal fired
    // BEFORE it — so a lost lock left the whole debt unreachable through the
    // tool that exists to pay it. `PRAGMA freelist_count` reads 0 in this
    // state; the win is defragmentation, so the probe is a real `VACUUM INTO`.
    seedJsonStore(400, 256);
    const db = openCache(paths.cache(dir));
    let after: string | undefined;
    for (;;) {
      const r = convertVectorBatch(db, 50, after);
      if (r.examined === 0) break;
      after = r.lastId ?? undefined;
      if (after === undefined) break;
    }
    db.close(); // committed, never vacuumed
    const stranded = statSync(paths.cache(dir)).size;
    expect(shapes()).toEqual({ blob: 400, text: 0 });

    // The dry run NAMES it rather than saying "already converted, nothing to do".
    const look = consoleWith();
    expect(await run(["migrate-cache"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(look.out)).toContain("Converted, NOT yet compacted:");
    expect(text(look.out)).toContain("reclaimable");
    expect(statSync(paths.cache(dir)).size).toBe(stranded); // still read-only

    // And `--apply` compacts it, converting nothing.
    const c = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("Cache file:");
    expect(statSync(paths.cache(dir)).size).toBeLessThan(stranded);
    expect(shapes()).toEqual({ blob: 400, text: 0 });
  });

  test("a second --apply REFUSES once there is nothing left to convert OR reclaim", async () => {
    seedJsonStore();
    const first = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: first.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );

    const again = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: again.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(again.err)).toContain("already float32");
    expect(shapes()).toEqual({ blob: 2, text: 0 });

    // The dry run over the same store is not an error — it was asked a
    // question and it answered it.
    const look = consoleWith();
    expect(await run(["migrate-cache"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(look.out)).toContain("Converted and compacted.");
  });

  test("one unparseable row is skipped, named, and left exactly as it was", async () => {
    const ids = seedJsonStore(3);
    const bad = ids[1] as string;
    const db = openDb(paths.cache(dir));
    db.run("UPDATE embeddings SET vec = ? WHERE memory_id = ?", "not json at all", bad);
    db.close();

    const c = consoleWith();
    // Loud: the store is not fully converted, and the exit code says so.
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.failed,
    );
    const printed = text(c.out);
    expect(printed).toContain("Converted 2 vectors");
    expect(printed).toContain(`SKIPPED, left exactly as it was: ${bad}`);
    expect(shapes()).toEqual({ blob: 2, text: 1 });
    const check = openDb(paths.cache(dir));
    expect(check.get<{ vec: string }>("SELECT vec FROM embeddings WHERE memory_id = ?", bad)?.vec).toBe(
      "not json at all",
    );
    check.close();
  });

  test("it refuses a store it cannot find and a cache that was never built", async () => {
    const empty = mkdtempSync(join(tmpdir(), "counterparts-cli-"));
    try {
      const c = consoleWith();
      expect(await run(["migrate-cache"], { io: c.io, env: { [ENV]: empty } })).toBe(EXIT.failed);
      expect(text(c.err)).toContain("no store at");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index was deleted underneath it." });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });
    const c = consoleWith();
    expect(await run(["migrate-cache"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(c.err)).toContain("never been built here");
    // And it did not mint the box it was inspecting.
    expect(existsSync(paths.cache(dir))).toBe(false);
  });

  test("an instrument does not migrate the store it is reading", async () => {
    seedJsonStore();
    const c = consoleWith();
    expect(
      await run(["migrate-cache", "--apply", "--yes", "--observer"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("observer stance");
    expect(shapes()).toEqual({ blob: 0, text: 2 });
  });
});


// ── backfill-claims ─────────────────────────────────────────────────────────

describe("backfill-claims — the one-shot repair for rows minted before the floor existed", () => {
  /**
   * The pre-PR shape, which no seam can produce any more: an AUTHORED row with
   * no claim and no dimensions. Everything the command must NOT touch is here
   * too, so "only the intended rows" is a fact about this store, not a hope.
   */
  function seedMixed(s: Store): Record<string, string> {
    return {
      // The two targets.
      unclaimedA: s.put({
        type: "memory",
        kind: "fact",
        body: "An authored memory from before the default floor existed.",
        source: "authored",
      }),
      unclaimedB: s.put({
        type: "memory",
        kind: "self",
        body: "A second authored memory, also silent about its salience.",
        source: "authored",
      }),
      // Testimony: an explicit low claim is never overwritten.
      claimedLow: s.put({
        type: "memory",
        kind: "fact",
        body: "An authored memory whose author said, explicitly, barely.",
        source: "authored",
        salience: { claimed: 0.05 },
      }),
      // The other channel: the fallback's ceiling and dims stay as they are.
      swept: s.put({
        type: "memory",
        kind: "fact",
        body: "A swept memory that claimed nothing, and stays that way.",
        source: "fallback",
      }),
      // A pre-v4 row: provenance unrecorded is not provenance claimed.
      unrecorded: s.put({
        type: "memory",
        kind: "fact",
        body: "A memory whose minting channel was never recorded at all.",
      }),
    };
  }

  test("the dry run is the default: it names the rows and changes nothing", async () => {
    const s = store();
    const ids = seedMixed(s);
    const before = fingerprint(dir);
    s.close();

    const c = consoleWith();
    const code = await run(["backfill-claims"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);
    const out = text(c.out);
    expect(out).toContain("Authored memories with no claimed salience: 2");
    expect(out).toContain(ids["unclaimedA"] as string);
    expect(out).toContain(ids["unclaimedB"] as string);
    expect(out).toContain("Dry run. Nothing has changed.");
    // Ids and numbers only — a repair report never prints a body.
    expect(out).not.toContain("before the default floor existed");
    expect(fingerprint(dir)).toBe(before);
  });

  test("--apply writes the floor to exactly the intended rows, flags them, and logs the run", async () => {
    const s = store();
    const ids = seedMixed(s);
    s.close();

    const c = consoleWith();
    const code = await run(["backfill-claims", "--apply"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Applied the default floor to 2 memories.");

    const after = store({ observer: true });
    for (const key of ["unclaimedA", "unclaimedB"]) {
      const id = ids[key] as string;
      expect(after.row(id)?.claimed).toBe(TUNABLES.AUTHORED_DEFAULT_CLAIM);
      expect(after.readProse(id).meta["claimedDefault"]).toBe(true);
      // The dimensions are not invented along the way: the floor is a floor.
      expect(after.row(id)?.relevance).toBe(0);
    }
    // Untouched, all three, for three different reasons.
    expect(after.row(ids["claimedLow"] as string)?.claimed).toBe(0.05);
    expect(after.row(ids["swept"] as string)?.claimed).toBeNull();
    expect(after.row(ids["unrecorded"] as string)?.claimed).toBeNull();
    for (const key of ["claimedLow", "swept", "unrecorded"]) {
      expect(after.readProse(ids[key] as string).meta["claimedDefault"]).toBeUndefined();
    }
    const logged = after.eventLog({ name: "salience.defaulted" });
    expect(logged.length).toBe(2);
    expect(logged.map((e) => e.ref).sort()).toEqual(
      [ids["unclaimedA"] as string, ids["unclaimedB"] as string].sort(),
    );
  });

  test("a second --apply is a no-op: the first run left nothing that still qualifies", async () => {
    const s = store();
    seedMixed(s);
    s.close();
    await run(["backfill-claims", "--apply"], { io: consoleWith().io, env: { [ENV]: dir } });
    const mid = fingerprint(dir);

    const c = consoleWith();
    expect(await run(["backfill-claims", "--apply"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Authored memories with no claimed salience: 0");
    expect(fingerprint(dir)).toBe(mid);
  });
});

// ── repair-merged-beliefs ───────────────────────────────────────────────────

/**
 * THE REPAIR FOR PROBE H, and the owner-op door under it.
 *
 * The bug is fixed in `sleep/dedup.ts` as of the same night — a `type:
 * "schema"` row is no longer a dedup candidate at all — so this store cannot be
 * poisoned by running a real cycle any more. `merge()` below therefore does
 * exactly the four writes the pass used to do, in the same order, and the
 * fixture is the bug's OUTPUT rather than its mechanism. That is the honest
 * shape for a repair test: what has to be undone is the state, not the code
 * path that produced it.
 */
describe("repair-merged-beliefs — putting back the beliefs dedup ate", () => {
  const STATEMENT = "Ada prefers async review over a live walkthrough";

  /** `sleep/dedup.ts`'s merge, by hand: record, event, credit, archive. */
  function merge(s: Store, candidateId: string, originalId: string, day: number): void {
    const record = {
      event: "memory.merged",
      day,
      candidateId,
      originalId,
      reason: "identical-content-hash",
      usesDelta: 1,
    };
    s.setMeta(`sleep.merged.${candidateId}`, JSON.stringify(record));
    s.appendEvent({
      name: "memory.merged",
      day,
      ref: candidateId,
      dedupKey: `sleep.merged.${candidateId}`,
      payload: { ...record },
    });
    const p = s.physicsOf(originalId);
    s.updatePhysics(originalId, { uses: p.uses + 1 });
    s.archive(candidateId, "merged");
  }

  /** A belief eaten by a memory that says the same sentence. */
  // `beforeMerge` runs once the belief is live and before the merge archives
  // it — the one moment a test can measure "while live" now that `archive()`
  // deindexes for real (#64, on this tree).
  function poison(
    s: Store,
    beforeMerge?: (beliefId: string) => void,
  ): { entityId: string; beliefId: string; memoryId: string } {
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: STATEMENT,
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = sc.addBelief({
      entityId,
      statement: STATEMENT,
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const memoryId = s.put({
      type: "memory",
      kind: "person",
      body: STATEMENT,
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    beforeMerge?.(beliefId);
    merge(s, beliefId, memoryId, 0);
    return { entityId, beliefId, memoryId };
  }

  test("the dry run names the belief, the entity, the memory and the day — and writes nothing", async () => {
    const s = store();
    const ids = poison(s);
    const before = fingerprint(dir);
    s.close();

    const c = consoleWith();
    const code = await run(["repair-merged-beliefs", "--dry-run"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);
    const out = text(c.out);
    expect(out).toContain("Beliefs and current-state rows archived as duplicates: 1");
    // WHICH STORE, before the list. `--dir` is optional and the default is the
    // owner's live memory; this is the command G23 asks them to type `--apply` at.
    expect(out).toContain(`Store: ${dir}`);
    expect(out).toContain(ids.beliefId);
    expect(out).toContain("Ada");
    expect(out).toContain("lived day 0");
    expect(out).toContain(ids.memoryId);
    expect(out).toContain(STATEMENT);
    expect(out).toContain("Dry run. Nothing has changed.");
    // Dry run is the default too, `--dry-run` or not.
    expect(fingerprint(dir)).toBe(before);
    const plain = consoleWith();
    expect(await run(["repair-merged-beliefs"], { io: plain.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(fingerprint(dir)).toBe(before);
  });

  test("--apply restores the belief, records the unmerge, and leaves the credit standing", async () => {
    const s = store();
    const ids = poison(s);
    const usesAfterMerge = s.physicsOf(ids.memoryId).uses;
    s.close();

    const c = consoleWith();
    expect(await run(["repair-merged-beliefs", "--apply"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("Put 1 elements back.");

    const after = store({ observer: true });
    expect(after.row(ids.beliefId)?.archived).toBe(0);
    expect(after.row(ids.beliefId)?.archived_reason).toBeNull();
    // It is a BELIEF again, which is the thing that was actually lost.
    const sc = Schemas.open({ store: after });
    expect(sc.beliefs(ids.entityId).map((b) => b.id)).toEqual([ids.beliefId]);

    // The credit STANDS, and the record says so rather than the code hoping so.
    expect(after.physicsOf(ids.memoryId).uses).toBe(usesAfterMerge);
    const logged = after.eventLog({ name: "memory.unmerged" });
    expect(logged.length).toBe(1);
    expect(logged[0]?.ref).toBe(ids.beliefId);
    const payload = JSON.parse(logged[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["originalId"]).toBe(ids.memoryId);
    expect(payload["usesDelta"]).toBe(1);
    expect(payload["mergedOnDay"]).toBe(0);
    // IDS AND NUMBERS ONLY (§5 G10). The console prints the statement and the
    // entity's name so the owner can decide; the DURABLE record carries neither,
    // and this is the assertion that keeps those two facts apart.
    expect(Object.keys(payload).sort()).toEqual(
      ["candidateId", "day", "event", "mergedOnDay", "originalId", "usesDelta"],
    );
    expect(logged[0]?.payload ?? "").not.toContain("Ada");
    expect(logged[0]?.payload ?? "").not.toContain("async review");

    // Constitution 7: the repair erases no history. The merge record and the
    // merge event are both exactly where they were.
    expect(after.getMeta(`sleep.merged.${ids.beliefId}`)).toContain(ids.memoryId);
    expect(after.eventLog({ name: "memory.merged" }).length).toBe(1);
  });

  test("a second --apply changes nothing and appends no second record", async () => {
    const s = store();
    poison(s);
    s.close();
    await run(["repair-merged-beliefs", "--apply"], { io: consoleWith().io, env: { [ENV]: dir } });
    const mid = fingerprint(dir);

    const c = consoleWith();
    expect(await run(["repair-merged-beliefs", "--apply"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("Beliefs and current-state rows archived as duplicates: 0");
    expect(text(c.out)).toContain("[already live]");
    expect(fingerprint(dir)).toBe(mid);
    const after = store({ observer: true });
    expect(after.eventLog({ name: "memory.unmerged" }).length).toBe(1);
  });

  test("a store with nothing to repair says so, and an absent store is not created", async () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "An ordinary memory nobody merged." });
    s.close();
    const c = consoleWith();
    expect(await run(["repair-merged-beliefs"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Beliefs and current-state rows archived as duplicates: 0");
    expect(text(c.out)).toContain("Dry run. Nothing to repair on this store.");

    const missing = join(outside, "no-store-for-repair");
    const c2 = consoleWith();
    expect(await run(["repair-merged-beliefs", "--dir", missing], { io: c2.io, env: {} })).toBe(
      EXIT.failed,
    );
    expect(existsSync(missing)).toBe(false);
  });

  test("the repair is an owner operation: an instrument refuses it, plan and all", async () => {
    const s = store();
    poison(s);
    const before = fingerprint(dir);
    s.close();
    const c = consoleWith();
    expect(
      await run(["repair-merged-beliefs", "--observer"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("owner operation");
    expect(fingerprint(dir)).toBe(before);
  });

  test("the door undoes ONE archive reason and refuses every other by name", () => {
    // The reason this is not a general `unarchive`: a prune, a revision and a
    // removal are all archived, and each is archived for a reason a repair
    // tool has no business reversing.
    const s = store();
    const pruned = s.put({ type: "memory", kind: "fact", body: "A memory let go at the floor." });
    s.archive(pruned, "pruned");
    expect(() => unarchiveMerged(s, pruned)).toThrow(/UNMERGE_NOT_A_MERGE/);
    expect(s.row(pruned)?.archived).toBe(1);

    // A superseded row: restoring it would put two live versions in one chain.
    const target = s.put({ type: "memory", kind: "fact", body: "A belief about the weather." });
    s.supersede(
      target,
      { type: "memory", kind: "fact", body: "A better belief about the weather." },
      "revised-by-pressure",
    );
    expect(() => unarchiveMerged(s, target)).toThrow(/UNMERGE_SUPERSEDED/);

    expect(() => unarchiveMerged(s, "mem_000000000000")).toThrow(/ID_UNKNOWN/);

    // And a merge is restored — the one case it accepts.
    const original = s.put({ type: "memory", kind: "fact", body: "One sentence, noted twice." });
    const duplicate = s.put({
      id: "mem_ffffffffffff",
      type: "memory",
      kind: "fact",
      body: "One sentence, noted twice.",
    });
    s.archive(duplicate, "merged");
    const report = unarchiveMerged(s, duplicate);
    expect(report.noop).toBe(false);
    expect(s.row(duplicate)?.archived).toBe(0);
    // No merge event existed, so the record says so instead of inventing one.
    expect(report.record.originalId).toBeNull();
    expect(report.record.usesDelta).toBeNull();
    expect(original).not.toBe(duplicate);

    // A LIVE row is a no-op that records NOTHING. A `memory.unmerged` row here
    // would read "the owner put this back" about a restore that never
    // happened, and the door has to be honest without the CLI's help.
    const live = s.put({ type: "memory", kind: "fact", body: "A memory nobody merged." });
    const before = s.eventLog({ name: "memory.unmerged" }).length;
    expect(unarchiveMerged(s, live).noop).toBe(true);
    expect(s.eventLog({ name: "memory.unmerged" }).length).toBe(before);
  });

  test("a restored belief is FINDABLE again, even when the archive deindexed it", async () => {
    // The cross-PR hazard, made a test rather than a hope. `archive()` leaves
    // box 3 alone on master today, but PR #64 (`overnight/df-live-rows`) adds
    // `deindexDoc` to it so document frequency is counted over live rows —
    // and then a restore that touched only box 2 would put back a row that is
    // live, listed in `beliefs(entity)`, and invisible to lexical recall, with
    // no cheap repair (a rebuild without an embedder drops every vector).
    //
    // On the batch tree #64 IS merged, so the deindex is no longer simulated:
    // the live count is taken before the merge archives the belief, and the
    // zero after it is asserted rather than produced by hand.
    const tokensFor = (id: string): number => {
      const box3 = openDb(paths.cache(dir));
      try {
        return (
          box3.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_tokens WHERE memory_id = ?", id)?.n ??
          0
        );
      } finally {
        box3.close();
      }
    };
    const s = store();
    let indexedWhileLive = 0;
    const ids = poison(s, (beliefId) => {
      indexedWhileLive = tokensFor(beliefId);
    });
    s.close();
    expect(indexedWhileLive).toBeGreaterThan(0);
    // The archive took the rows out of the text index (I13) — the hazard is real.
    expect(tokensFor(ids.beliefId)).toBe(0);

    expect(
      await run(["repair-merged-beliefs", "--apply"], { io: consoleWith().io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);

    const after = store({ observer: true });
    // Box 3 holds the row's tokens again, and exactly as many as it did.
    expect(tokensFor(ids.beliefId)).toBe(indexedWhileLive);
    // The property, not the table: the cue finds it.
    expect(after.search("walkthrough async review").map((h) => h.id)).toContain(ids.beliefId);
    after.close();

    // And through the door the owner actually uses.
    const r = consoleWith();
    expect(await run(["recall", "what does Ada prefer for review?", "--dir", dir], { io: r.io })).toBe(
      EXIT.ok,
    );
    expect(text(r.out)).toContain("prefers async review");
  });

  test("the restore never touches an embedding it cannot recompute", () => {
    // A repair that made a paid embedding call, or dropped a vector nothing in
    // this process can recompute, would be a worse bug than the one it fixes.
    // `reindexLexical` hands `indexDoc` no vector, and `indexDoc` writes the
    // `embeddings` table only when it is handed one.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "A memory with a vector of its own." });
    const cache = openCache(paths.cache(dir));
    setEmbedding(cache, id, [0.5, 0.25, 0.125]);
    cache.close();
    s.archive(id, "merged");

    unarchiveMerged(s, id);

    const box3 = openDb(paths.cache(dir));
    const row = box3.get<{ dim: number; vec: string | Uint8Array }>(
      "SELECT dim, vec FROM embeddings WHERE memory_id = ?",
      id,
    );
    box3.close();
    expect(row?.dim).toBe(3);
    // Read through the cache's own decoder: box 3 stores float32 BLOBs (#66,
    // on this tree), and these three values are float32-exact.
    expect(Array.from(decodeVector(row?.vec ?? "[]"))).toEqual([0.5, 0.25, 0.125]);
  });

  test("a belief restored and later revised is not offered again — the run stays green", async () => {
    // The sequence the owner hits by running this twice across weeks: merged,
    // restored, then legitimately revised (archived `revised`, with a
    // successor). Listing it as an open target would make the seam refuse with
    // UNMERGE_SUPERSEDED and the whole run exit FAILED on a store where
    // nothing is wrong.
    const s = store();
    const ids = poison(s);
    s.close();
    await run(["repair-merged-beliefs", "--apply"], { io: consoleWith().io, env: { [ENV]: dir } });

    const writable = store();
    const sc = Schemas.open({ store: writable });
    const challengerId = writable.put({
      type: "memory",
      kind: "person",
      body: "Ada asked for a live walkthrough instead",
      meta: { updates: ids.beliefId },
      salience: { novelty: null, relevance: 0.9, emotional: 0.9, predictive: 0.9 },
      physics: { birthDay: 1, lastUsedDay: 1 },
    });
    for (const day of [1, 2, 3]) {
      applyRevision(writable, sc, { updates: ids.beliefId, challengerId, day, method: "declared" }, {});
    }
    expect(writable.row(ids.beliefId)?.superseded_by).not.toBeNull();
    writable.close();

    const c = consoleWith();
    expect(await run(["repair-merged-beliefs", "--apply"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.err)).not.toContain("FAILED");
    expect(text(c.out)).not.toContain(ids.beliefId);
  });

  test("an instrument may not unarchive either — the seam crosses the same stance check", () => {
    const writable = store();
    const id = writable.put({ type: "memory", kind: "fact", body: "A merged duplicate." });
    writable.archive(id, "merged");
    writable.close();
    const reader = store({ observer: true });
    expect(() => unarchiveMerged(reader, id)).toThrow(/OBSERVER_REFUSED/);
    expect(reader.row(id)?.archived).toBe(1);
  });
});

// ── stance ──────────────────────────────────────────────────────────────────

describe("rebrief — the owner's out-of-band wake re-render", () => {
  /** An identity element with an explicit encode date, so the wake can show it. */
  function element(s: Store, body: string, learnedOn: string): string {
    return s.put({
      type: "memory",
      kind: "self",
      body,
      band: "identity",
      salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
      physics: { promotedIdentity: true },
      learnedOn,
    });
  }

  /** Every sleep marker, so "no marker moved" is checkable rather than asserted. */
  function markers(s: Store): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const phase of PHASES) out[phase] = s.getMeta(markerKey(phase));
    return out;
  }

  test("republishes the bundle NOW, prints the lane counts and bytes, and moves no marker", async () => {
    const s = store();
    element(s, "The credential fix sits uncommitted pending review.", "2026-07-26");
    element(s, "The parallel run started this morning.", "2026-09-04");
    s.put({
      type: "memory",
      kind: "skill",
      body: "I read the whole file before editing one line of it.",
      salience: { relevance: 1, emotional: 1, predictive: 1 },
      learnedOn: "2026-08-14",
    });
    for (const phase of PHASES) s.setMeta(markerKey(phase), "7");
    const before = markers(s);
    const day = s.livedDay();
    expect(s.getMeta(BRIEFING_KEY)).toBeUndefined();
    s.close();

    const c = consoleWith();
    const code = await run(["rebrief", "--budget", "9000"], {
      io: c.io,
      env: { [ENV]: dir },
      home: join(outside, "rebrief-home"),
    });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Re-rendered the wake bundle");
    expect(printed).toContain("identity 2");
    expect(printed).toContain("craft 1");
    expect(printed).toContain("elements 3");
    expect(printed).toContain("budget 9000 bytes from --budget");
    expect(printed).toContain("published");

    const after = store({ observer: true });
    const bundle = after.getMeta(BRIEFING_KEY) ?? "";
    // The bundle is really there, and every element in it carries its date.
    expect(bundle).toContain("- 2026-07-26 · The credential fix sits uncommitted pending review.");
    expect(bundle).toContain("- 2026-09-04 · The parallel run started this morning.");
    expect(bundle).toContain("- 2026-08-14 · I read the whole file before editing one line of it.");
    expect(readSentinel(bundle).intact).toBe(true);
    // The preface's room is reserved exactly as `sessionEnd` reserves it, so the
    // first delivered line cannot blow the host's ceiling.
    expect(byteLength(bundle)).toBeLessThanOrEqual(9000 - PREFACE_RESERVE_BYTES);
    expect(printed).toContain(`bytes ${byteLength(bundle)}`);

    // NOT a sleep cycle: no marker advanced, and the day did not move.
    expect(markers(after)).toEqual(before);
    expect(after.livedDay()).toBe(day);
  });

  test("without a ceiling it refuses and names both ways to give it one (§2.18)", async () => {
    store().close();
    const c = consoleWith();
    // A throwaway home: with no ceiling beside the store, `hostCeiling` falls
    // back to the hooks' own `~/.counterparts/claude-code.json`, and a test that
    // used the real one would be reading the owner's live configuration.
    const code = await run(["rebrief"], {
      io: c.io,
      env: { [ENV]: dir },
      home: join(outside, "rebrief-home"),
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("no injection ceiling");
    expect(text(c.err)).toContain("--budget");
    expect(text(c.err)).toContain("injectionBudgetBytes");
    expect(store({ observer: true }).getMeta(BRIEFING_KEY)).toBeUndefined();
  });

  test("the host config BESIDE the store supplies the ceiling when no flag does", async () => {
    // The deployed shape (measured 2026-09-03): the config cannot live INSIDE
    // the data dir — the layout totality check refuses an unclassified file
    // there — so it sits beside it and `dataDir` names the subdirectory.
    const inner = join(dir, "store");
    const s = Store.open({ dir: inner });
    open.push(s);
    element(s, "Something true about how I work.", "2026-08-01");
    s.close();
    const config = join(dir, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: inner, injectionBudgetBytes: 4096 }));

    const c = consoleWith();
    const code = await run(["rebrief", "--dir", inner], {
      io: c.io,
      env: { [ENV]: dir },
      home: join(outside, "rebrief-home"),
    });
    expect(c.err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain(`budget 4096 bytes from ${config}`);
    expect(text(c.out)).toContain("claude-code.json");

    const after = Store.open({ dir: inner, observer: true });
    open.push(after);
    expect(byteLength(after.getMeta(BRIEFING_KEY) ?? "")).toBeLessThanOrEqual(
      4096 - PREFACE_RESERVE_BYTES,
    );
  });

  test("the lookup order is flag, then beside the store, then the hooks' own config — and it SAYS which", async () => {
    // The finding this pins (cold-stranger review 2026-09-04, issue 3): a
    // stranger ran `rebrief --dir <scratch>` and it composed under a ceiling
    // read out of `~/.counterparts/claude-code.json` — a file outside the
    // directory they had named — while the page claimed in bold that no console
    // command reads that file at all. The fallback is legitimate; the silence
    // was not. Every branch below asserts the PRINTED source, not just the number.
    const home = join(outside, "order-home");
    const hooksConfig = join(home, ".counterparts", "claude-code.json");
    mkdirSync(join(home, ".counterparts"), { recursive: true });
    const inner = join(dir, "store");
    const beside = join(dir, "claude-code.json");
    const s = Store.open({ dir: inner });
    open.push(s);
    element(s, "Something true about how I work.", "2026-08-01");
    s.close();

    // (3) only the hooks' config exists: the fallback answers, and names itself.
    writeFileSync(hooksConfig, JSON.stringify({ dataDir: inner, injectionBudgetBytes: 7000 }));
    const fallback = consoleWith();
    expect(await run(["rebrief", "--dir", inner], { io: fallback.io, env: {}, home })).toBe(EXIT.ok);
    expect(text(fallback.out)).toContain(`budget 7000 bytes from ${hooksConfig}`);

    // (2) a config beside the store WINS over the hooks' config.
    writeFileSync(beside, JSON.stringify({ dataDir: inner, injectionBudgetBytes: 4096 }));
    const nearer = consoleWith();
    expect(await run(["rebrief", "--dir", inner], { io: nearer.io, env: {}, home })).toBe(EXIT.ok);
    expect(text(nearer.out)).toContain(`budget 4096 bytes from ${beside}`);
    expect(text(nearer.out)).not.toContain(hooksConfig);

    // (1) the flag beats both, and reads no file at all.
    const flagged = consoleWith();
    expect(
      await run(["rebrief", "--dir", inner, "--budget", "5000"], { io: flagged.io, env: {}, home }),
    ).toBe(EXIT.ok);
    expect(text(flagged.out)).toContain("budget 5000 bytes from --budget");
    expect(text(flagged.out)).not.toContain("claude-code.json");

    // NEVER inside the data dir. A config there fails the layout check and the
    // store stops opening, so it is not a place this lookup may find one.
    rmSync(beside);
    rmSync(hooksConfig);
    writeFileSync(join(inner, "claude-code.json"), JSON.stringify({ injectionBudgetBytes: 1234 }));
    const inside = consoleWith();
    expect(await run(["rebrief", "--dir", inner], { io: inside.io, env: {}, home })).toBe(
      EXIT.refused,
    );
    expect(text(inside.err)).toContain("no injection ceiling");
    // And the refusal names EVERY place it looked, in order, so "where should I
    // put it" is answered by the failure itself.
    expect(text(inside.err)).toContain(join(dir, "claude-code.json"));
    expect(text(inside.err)).toContain(hooksConfig);
    rmSync(join(inner, "claude-code.json"));
  });

  test("under observer it refuses and publishes nothing — an instrument makes no content write", async () => {
    const s = store();
    element(s, "Something true about how I work.", "2026-08-01");
    s.close();

    const c = consoleWith();
    const code = await run(["rebrief", "--budget", "9000", "--observer"], {
      io: c.io,
      env: { [ENV]: dir },
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("observer stance");
    expect(store({ observer: true }).getMeta(BRIEFING_KEY)).toBeUndefined();
  });
});

// ── observer ────────────────────────────────────────────────────────────────

describe("owner operations never run under observer", () => {
  test("every owner op refuses, and says which stance refused it", async () => {
    store().close();
    for (const command of OWNER_OPS) {
      const c = consoleWith();
      // Only flags every command declares: the stance refusal precedes each
      // command's own arguments, and since 2026-09-04 an undeclared flag is
      // itself a refusal, so passing `--out` to `note` would test that instead.
      const code = await run([command, "--observer", "x"], {
        io: c.io,
        env: { [ENV]: dir },
      });
      expect(code).toBe(EXIT.refused);
      expect(text(c.err)).toContain("observer stance");
    }
  });

  test("status still works under observer — an instrument may read", async () => {
    store().close();
    const c = consoleWith();
    expect(await run(["status", "--observer"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Memories:");
  });

  test("the environment can stand the console down too, not only the flag", async () => {
    store().close();
    const c = consoleWith();
    const code = await run(["backup", "--out", outside], {
      io: c.io,
      env: { [ENV]: dir, COUNTERPARTS_OBSERVER: "1" },
    });
    expect(code).toBe(EXIT.refused);
  });
});

// ── the import graph ────────────────────────────────────────────────────────

describe("the destruction path is importable from this directory only", () => {
  test("no core module, no other adapter, and no test but this one imports removal.ts", () => {
    const root = join(import.meta.dir, "..", "src");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const body = readFileSync(full, "utf8");
        if (!body.includes("removal.js") && !body.includes("removal.ts")) continue;
        if (full.includes(join("adapters", "cli"))) continue;
        offenders.push(full);
      }
    };
    walk(root);
    // §16 G2, earned-mechanism #14: THIS TEST FAILING IS THE POINT.
    expect(offenders).toEqual([]);
  });

  test("the seam's CHASE is imported by this directory only — a type import is not a caller", () => {
    const root = join(import.meta.dir, "..", "src");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const body = readFileSync(full, "utf8");
        // A VALUE import of the seam. `export type { … } from "./owner-op-seam.js"`
        // and `import type { … }` are erased at runtime and reach no function.
        for (const line of body.split("\n")) {
          if (!/from\s+"[^"]*owner-op-seam\.js"/.test(line)) continue;
          if (/^\s*(?:import|export)\s+type\b/.test(line)) continue;
          if (full.includes(join("adapters", "cli"))) continue;
          // Store's constructor HANDS the capability over; it never calls the
          // chase, and the test below pins that it re-exports no such name.
          if (full.endsWith(join("core", "store", "index.ts"))) continue;
          offenders.push(`${full}: ${line.trim()}`);
        }
        // A multi-line import block hides the module name from the line scan.
        if (
          /import\s*\{[^}]*\}\s*from\s+"[^"]*owner-op-seam\.js"/s.test(body) &&
          !full.includes(join("adapters", "cli")) &&
          !full.endsWith(join("core", "store", "index.ts")) &&
          !/import\s+type\s*\{[^}]*\}\s*from\s+"[^"]*owner-op-seam\.js"/s.test(body)
        ) {
          offenders.push(`${full}: multi-line value import`);
        }
      }
    };
    walk(root);
    // §16 G2 again, for the half that landed on 2026-08-25.
    expect(offenders).toEqual([]);
  });

  test("the buffer's STRIKE is imported by this directory and its own grantor only", () => {
    // The same pin as the box-2 chase, for the seam that landed 2026-09-05.
    // Two files in `src/` may reach `remember/owner-strike-seam.ts`:
    // `remember/spans.ts`, which HANDS OVER the capability in its constructor
    // and never calls the strike, and `adapters/cli/removal.ts`, the one
    // implementation of the destruction path. A `Counterpart` — which the MCP
    // server holds, and a model talks to — holds a `SpanBuffer` and reaches
    // nothing (§16 G2, and `store/owner-op-seam.ts`'s own reasoning).
    const root = join(import.meta.dir, "..", "src");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const body = readFileSync(full, "utf8");
        for (const line of body.split("\n")) {
          if (!/from\s+"[^"]*owner-strike-seam\.js"/.test(line)) continue;
          if (/^\s*(?:import|export)\s+type\b/.test(line)) continue;
          if (full.includes(join("adapters", "cli"))) continue;
          if (full.endsWith(join("core", "remember", "spans.ts"))) continue;
          offenders.push(`${full}: ${line.trim()}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  test("the strike is not re-exported from remember's index either", () => {
    const index = readFileSync(join(import.meta.dir, "..", "src/core/remember/index.ts"), "utf8");
    expect(index).not.toContain("owner-strike-seam");
  });

  test("the destruction path is not even re-exported from the adapter's index", () => {
    const index = readFileSync(join(import.meta.dir, "..", "src/adapters/cli/index.ts"), "utf8");
    expect(index).not.toContain('from "./removal.js"');
  });

  test("the core imports nothing from adapters/cli", () => {
    const root = join(import.meta.dir, "..", "src", "core");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        // An IMPORT, not a mention: `store/owner-op-seam.ts` names this adapter
        // in prose (it is the seam's other half) and that is documentation, not
        // a dependency.
        if (name.endsWith(".ts") && /from\s+"[^"]*adapters\/cli/.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  test("no egress: neither adapter opens a socket, and export is the only way out", () => {
    const roots = ["src/adapters/cli", "src/adapters/mcp"];
    const offenders: string[] = [];
    for (const root of roots) {
      const base = join(import.meta.dir, "..", root);
      const walk = (path: string): void => {
        for (const name of readdirSync(path)) {
          const full = join(path, name);
          if (statSync(full).isDirectory()) {
            walk(full);
            continue;
          }
          if (!name.endsWith(".ts")) continue;
          const body = readFileSync(full, "utf8");
          for (const shape of ["fetch(", "node:http", "node:https", "node:net", "WebSocket"]) {
            if (body.includes(shape)) offenders.push(`${full}: ${shape}`);
          }
        }
      };
      walk(base);
    }
    expect(offenders).toEqual([]);
  });
});

// ── the console's own shape ─────────────────────────────────────────────────

describe("usage", () => {
  test("--help is an answered question (exit 0); a bare invocation is a usage error", async () => {
    // Two commands apart in a stranger's first minute, and they used to share
    // the failing code: `counterparts --help` set $? to 1 and any `set -e`
    // wrapper died on the help text.
    const helped = consoleWith();
    expect(await run(["--help"], { io: helped.io })).toBe(EXIT.ok);
    expect(text(helped.out)).toContain("the owner's console");

    const bare = consoleWith();
    expect(await run([], { io: bare.io })).toBe(EXIT.usage);
    expect(text(bare.out)).toContain("the owner's console");

    const perCommand = consoleWith();
    expect(await run(["status", "--help"], { io: perCommand.io })).toBe(EXIT.ok);
  });

  /**
   * `counterparts <command> --help` ANSWERS THE QUESTION IT WAS ASKED.
   *
   * It printed the whole console's usage, so the flags a command actually takes
   * were listed nowhere a person could ask for them — the only surface that
   * knew was the refusal you got AFTER typing one wrong (cold-stranger review,
   * 2026-09-04, #9). The table that refusal reads is the table this prints, so
   * this walks every command and holds the two to each other.
   */
  test("every command's own --help lists exactly the flags that command takes", async () => {
    for (const command of COMMANDS) {
      const c = consoleWith();
      expect(await run([command, "--help"], { io: c.io })).toBe(EXIT.ok);
      const said = text(c.out);
      // It is about THIS command, and it says what the command is for.
      expect(said.startsWith(`counterparts ${command} — `)).toBe(true);
      expect(said).toContain(COMMAND_BLURB[command]);

      // Every flag it takes is listed — with a sentence, not as a bare name.
      for (const flag of [...COMMAND_FLAGS[command], ...COMMON_FLAGS]) {
        expect(said).toContain(`--${flag}`);
        expect(said).not.toContain(`--${flag} `.padEnd(21) + "(undocumented)");
      }
      expect(said).not.toContain("(undocumented)");

      // And no flag it would REFUSE. `unknownFlag` is the authority on that, so
      // ask it rather than keeping a second list here.
      for (const other of COMMANDS) {
        for (const flag of COMMAND_FLAGS[other]) {
          if (COMMAND_FLAGS[command].includes(flag) || COMMON_FLAGS.includes(flag)) continue;
          expect(unknownFlag(command, [`--${flag}`])).not.toBeNull();
          expect(said).not.toContain(`--${flag}`);
        }
      }

      // Nothing was opened: a help page is a read of a table, not of a store.
      expect(text(c.err)).toBe("");
    }

    // The same page, reachable as a pure function for anything that wants it.
    expect(commandHelp("remove")).toContain("--confirm");
    expect(commandHelp("remove")).toContain("<id>");
    expect(commandHelp("status")).toContain("takes no flags of its own");
  });
});

// ── unknown flags ───────────────────────────────────────────────────────────

/**
 * A flag the command does not take is a refusal, before anything opens.
 *
 * The measured failure (cold-stranger review, 2026-09-04):
 * `counterparts note "…" --dirr <store2>` printed `Remembered mem_… — minted.`
 * and store2 stayed empty — the note went to the DEFAULT store, which on a real
 * machine is the owner's live memory, and nothing in the output named it. The
 * parser runs `strict: false` because a strict parse throws, and a throw is a
 * stack trace on the owner's terminal; the price was silence.
 */
describe("unknown flags", () => {
  test("every command refuses a flag it does not declare, and names the nearest one", async () => {
    for (const command of COMMANDS) {
      const c = consoleWith();
      const code = await run([command, "--dirr", dir], { io: c.io, env: { [ENV]: dir } });
      expect(code).toBe(EXIT.refused);
      const said = text(c.err);
      expect(said).toContain("unknown flag --dirr");
      expect(said).toContain("did you mean --dir?");
      // It says what this command DOES take, so the reader is not sent to --help.
      expect(said).toContain("--dir");
      expect(said).toContain("Nothing was opened and nothing was written.");
    }
  });

  test("the refusal happens before any store is opened or created", async () => {
    const untouched = join(outside, "never-opened");
    mkdirSync(untouched, { recursive: true });
    const before = readdirSync(untouched);
    for (const argv of [
      ["note", "a memory", "--dirr", untouched],
      ["install", "--budget", "9000", "--nmae", "Ada"],
      ["init", "--dir", untouched, "--bugdet", "9000"],
      ["status", "--totally-bogus-flag"],
      ["remove", "mem_x", "--confrim"],
    ]) {
      const c = consoleWith();
      expect(await run(argv, { io: c.io, env: {}, home: join(outside, "flag-home") })).toBe(
        EXIT.refused,
      );
      expect(text(c.err)).toContain("unknown flag");
    }
    // Byte-identical: no store minted, no config written, nothing touched.
    expect(readdirSync(untouched)).toEqual(before);
    expect(existsSync(join(outside, "flag-home"))).toBe(false);
  });

  test("a flag that wants a value and gets none is refused, not read as absent", () => {
    // `strict: false` turns a trailing `--dir` into the BOOLEAN true, which every
    // reader in this file treats as "not given" — the same silence one step on.
    expect(unknownFlag("status", ["status", "--dir"])).toContain("--dir needs a value");
    expect(unknownFlag("note", ["note", "x", "--title"])).toContain("--title needs a value");
    expect(unknownFlag("rebrief", ["rebrief", "--budget", "--observer"])).toContain(
      "--budget needs a value",
    );
    // `--flag=value` supplies its own value, and a boolean switch needs none.
    expect(unknownFlag("status", ["status", "--dir=/tmp/x"])).toBe(null);
    expect(unknownFlag("recall", ["recall", "q", "--json"])).toBe(null);
  });

  test("each command's declared set is exactly what its usage promises", () => {
    // Totality: a flag added to `parse` and forgotten here would be refused at
    // runtime, so the table is the contract and this walks it.
    for (const command of COMMANDS) {
      const allowed = [...COMMON_FLAGS, ...(COMMAND_FLAGS[command] ?? [])];
      for (const flag of allowed) {
        expect(unknownFlag(command, [command, `--${flag}=x`])).toBe(null);
      }
    }
    // And a flag one command owns is not silently available to another.
    expect(unknownFlag("status", ["status", "--confirm"])).toContain("unknown flag --confirm");
    expect(unknownFlag("note", ["note", "x", "--rebuild"])).toContain("unknown flag --rebuild");
  });
});

// ── note / recall ───────────────────────────────────────────────────────────

/**
 * The console's own two memory acts. They exist because the cold-stranger
 * review of 2026-09-04 reached the end of the install page with no way to test
 * the one thing the product is for, and hand-wrote MCP JSON-RPC instead.
 */
describe("note and recall", () => {
  test("a note round-trips: stored by one call, found by the next", async () => {
    store().close();
    const w = consoleWith();
    expect(
      await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
        io: w.io,
      }),
    ).toBe(EXIT.ok);
    expect(text(w.out)).toContain("Remembered mem_");
    // A SECOND, unrelated memory, so this test asks its question of a store
    // holding more than the answer. The one-memory case is its own test above,
    // deliberately, because a bug at n=1 is invisible to every test that seeds
    // two rows — which is how PR #38's bug survived to a stranger's first minute.
    await run(["note", "An unrelated second memory about the fire escape.", "--dir", dir], {
      io: consoleWith().io,
    });

    const r = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", dir], { io: r.io })).toBe(EXIT.ok);
    const printed = text(r.out);
    expect(printed).toContain("Rancilio Silvia");
    // The console opens no socket, so the answer says which channel ran.
    expect(printed).toContain("semantic embedder-off");
  });

  test("the denominator is labelled LIVE ROWS, and counts the identity core", async () => {
    // The word, not the number. `storeSize` is `list({ archived: false })` —
    // memories, schemas (the identity core included) and journal episodes — so
    // on a store made the documented way it reads one higher than the memory
    // count, and `live` alone read as "live memories". §7's capture is this
    // line, and it is only reproducible while the label names the population.
    const named = join(outside, "live-rows");
    await run(["init", "--dir", named, "--name", "Ada"], { io: consoleWith().io });
    await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", named], {
      io: consoleWith().io,
    });
    const c = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", named], { io: c.io })).toBe(
      EXIT.ok,
    );
    // One memory, one core: two live rows, one of them considered.
    expect(text(c.out)).toContain("considered 1 of 2 live rows");
    const brain = openCounterpart(named);
    open.push(brain);
    expect(brain.store.list({ archived: false }).length).toBe(2);
    brain.close();
  });

  // THE FIRST THING EVERY NEW USER DOES, and for a while the one thing that did
  // not work: at store size one the question path scored no candidates at all
  // (`considered: 0`) and answered `nothing-came`, while the same memory came
  // back fine by id — the write and the index were sound and only the search
  // path was blind at n=1. Reproduced on four independent fresh stores by the
  // cold-stranger review of 2026-09-04 and fixed the same day (PR #38: rarity
  // was exactly zero when the store held one memory). This test was written
  // then and skipped; it is live now, and it stays live, because a bug at n=1
  // is invisible to every test that seeds two rows.
  test("recalls the FIRST memory in a fresh store", async () => {
    store().close();
    await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
      io: consoleWith().io,
    });
    const c = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Rancilio Silvia");
  });

  test("both name the store they wrote to or read from, first line", async () => {
    // The other half of the silent-write fix: even with the flags right, a
    // command whose destination is invisible cannot be checked by the person
    // running it. `status` has always led with `Store:`; these two did not.
    store().close();
    const w = consoleWith();
    await run(["note", "A memory that says where it went.", "--dir", dir], { io: w.io });
    expect(w.out[0]).toBe(`Store: ${dir}`);

    const r = consoleWith();
    await run(["recall", "where did it go?", "--dir", dir], { io: r.io });
    expect(r.out[0]).toBe(`Store: ${dir}`);

    // --json is a machine surface: the payload must still parse on its own.
    const j = consoleWith();
    await run(["recall", "where did it go?", "--dir", dir, "--json"], { io: j.io });
    expect(() => JSON.parse(text(j.out))).not.toThrow();
  });

  test("note takes the SAME two doors the MCP tool does: the span is captured, then claimed", async () => {
    // The order is the rule: without the claim, the end-of-session sweep finds
    // the jot's own words in the buffer and mints them a second time.
    const s = store();
    s.close();
    await run(["note", "Marisol keeps the postgres runbook in her head.", "--dir", dir], {
      io: consoleWith().io,
    });
    const spans = join(dir, "spans");
    expect(existsSync(spans)).toBe(true);
    // One memory, not two: the deposit claimed the span it rode in on.
    const after = openCounterpart(dir);
    open.push(after);
    expect(after.store.list({ archived: false }).length).toBe(1);
    after.close();
  });

  test("recall --id is the exact address, and answers where a question may not", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "The heron is blue in October." });
    s.close();
    const c = consoleWith();
    expect(await run(["recall", "--id", id, "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("The heron is blue in October.");
    expect(text(c.out)).toContain("expanded");
  });

  test("an empty recall is an ANSWER, and says what to try next", async () => {
    store().close();
    const c = consoleWith();
    expect(await run(["recall", "xylophone quokka nothing", "--dir", dir], { io: c.io })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    expect(printed).toContain("NOTHING CAME BACK");
    expect(printed).toContain("counterparts recall --id");
  });

  test("an answer says which TIER it came back at, so a footnote is not read as an answer", async () => {
    // `answered` means the question reached something, never that the something
    // is right. The cold-stranger review asked a one-row store what colour the
    // sky is on Mars, got the espresso machine, and had nothing on screen to
    // tell that apart from the right answer to a real question — the `[quiet]`
    // marker sat on both. The tier is the only confidence signal there is, so
    // the output now says what each tier it printed actually means.
    store().close();
    await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
      io: consoleWith().io,
    });
    const c = consoleWith();
    expect(await run(["recall", "what espresso machine is in the kitchen?", "--dir", dir], { io: c.io })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    // Whatever tier came back, its gloss is on screen beside it.
    const tier = /\[(vivid|quiet|dim)\]/.exec(printed)?.[1];
    expect(tier).toBeDefined();
    expect(printed).toContain(`${tier as string} = `);
    // Nothing vivid means the caller is told these are leads, not answers.
    if (tier !== "vivid") expect(printed).toContain("leads rather than answers");
  });

  test("note refuses empty text, refuses an out-of-range salience, and refuses under observer", async () => {
    store().close();
    const empty = consoleWith();
    expect(await run(["note", "--dir", dir], { io: empty.io })).toBe(EXIT.usage);

    const bad = consoleWith();
    expect(await run(["note", "x", "--salience", "7", "--dir", dir], { io: bad.io })).toBe(
      EXIT.refused,
    );
    expect(text(bad.err)).toContain("--salience");

    // An instrument may LOOK at a memory and may not add to one.
    expect(OWNER_OPS).toContain("note");
    expect(OWNER_OPS).not.toContain("recall");
    const obs = consoleWith();
    expect(await run(["note", "x", "--observer", "--dir", dir], { io: obs.io })).toBe(EXIT.refused);
  });

  test("recall refuses a question AND an --id together, and needs one of them", async () => {
    store().close();
    const both = consoleWith();
    expect(await run(["recall", "a question", "--id", "mem_x", "--dir", dir], { io: both.io })).toBe(
      EXIT.usage,
    );
    const neither = consoleWith();
    expect(await run(["recall", "--dir", dir], { io: neither.io })).toBe(EXIT.usage);
  });

  test("--json prints the tool's own payload, whose storeSize is the real one", async () => {
    store().close();
    await run(["note", "A canary for the payload shape.", "--dir", dir], { io: consoleWith().io });
    const c = consoleWith();
    expect(await run(["recall", "canary payload", "--dir", dir, "--json"], { io: c.io })).toBe(
      EXIT.ok,
    );
    const payload = JSON.parse(text(c.out)) as Record<string, unknown>;
    expect(payload["path"]).toBe("question");
    expect(payload["storeSize"]).toBe(1);
  });
});

// ── install ─────────────────────────────────────────────────────────────────

/**
 * `counterparts install` — the cold start.
 *
 * Every assertion below is about the ONE split that command exists to make:
 * the store, the config and the credential file are ours and get written; the
 * host's `settings.json` and MCP registration are printed and never touched.
 * The hermetic rule stands — every path here is a temp dir, and the layout
 * helper is exercised against an injected home rather than the real one.
 */
describe("install", () => {
  /** A throwaway HOME per test. `install` writes to `~/.counterparts` BY DESIGN
   *  — that is the one path the hooks read — so a test that used the real one
   *  would write the owner's live configuration. */
  function fakeHome(name: string): string {
    return join(outside, "home", name);
  }

  test("writes the store, and the config under ~/.counterparts whatever --dir says", async () => {
    const home = fakeHome("cold");
    const store = join(outside, "cold", "store");
    const c = consoleWith();
    const code = await run(["install", "--dir", store, "--budget", "9000", "--name", "Ada"], {
      io: c.io,
      env: {},
      home,
    });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(existsSync(paths.operational(store))).toBe(true);

    // THE PATH THE HOOKS READ WHEN NOTHING NAMES ANOTHER.
    // `claude-code/bin/hook.ts` and `bin/runner.ts` resolve
    // `join(homedir(), ".counterparts", "claude-code.json")` unless `--config` or
    // `COUNTERPARTS_CONFIG` says otherwise (`adapters/config-path.ts`), and a
    // hook that finds no config stands down at exit 0 — so a config written
    // somewhere else with NOTHING POINTING AT IT is an ambient half that never
    // fires and never says why. `--dir` therefore moves the STORE and only the
    // store; moving the configuration is `--config`'s job, tested in
    // `test/config-rule.test.ts`.
    const config = join(home, ".counterparts", CONFIG_FILE);
    expect(existsSync(config)).toBe(true);
    expect(existsSync(join(store, CONFIG_FILE))).toBe(false);
    expect(existsSync(join(outside, "cold", CONFIG_FILE))).toBe(false);
    const parsed = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
    expect(parsed["dataDir"]).toBe(store);
    expect(parsed["credentialsFile"]).toBe(join(home, ".counterparts", CREDENTIALS_FILE));
    expect(parsed["injectionBudgetBytes"]).toBe(9000);
    expect(parsed["owner"]).toBe(true);
    expect(parsed["identity"]).toEqual({ name: "Ada" });
    // AND THE CORE EXISTS NOW, not at the first hook. `install` used to write
    // the name into the config and leave the minting to `openAdapter` at the
    // first session, while `init --name` minted immediately — so the two
    // commands §3 calls interchangeable produced different stores, and §7's
    // captured `considered N of M live rows` was reproducible only on one of
    // them (2026-09-04).
    expect(printed).toContain("identity core seeded for Ada");
    const brain = openCounterpart(store);
    open.push(brain);
    const core = findIdentityCore(brain.store);
    expect(core).not.toBe(null);
    expect(brain.store.readProse(core as string).meta["name"]).toBe("Ada");
    brain.close();
    // The egress knob is a DECISION, never a side effect of installing.
    expect(parsed["embedder"]).toBeUndefined();
    // Nor is the parallel-run knob: that one is the run's, not a stranger's.
    expect(parsed["parallel"]).toBeUndefined();

    const creds = join(home, ".counterparts", CREDENTIALS_FILE);
    expect(existsSync(creds)).toBe(true);
    expect((statSync(creds).mode & 0o777).toString(8)).toBe("600");
    // Names, never values: the template mentions the two variables and holds none.
    expect(readFileSync(creds, "utf8")).toContain("ANTHROPIC_API_KEY");
    expect(readFileSync(creds, "utf8")).toContain("VOYAGE_API_KEY");

    // A moved store is SAID OUT LOUD, because the thing that did not move is
    // the thing the reader would otherwise assume followed it.
    expect(printed).toContain("--dir moved the STORE only");
    expect(printed).toContain(config);
    // And it says so without F6's phrase: the hook DOES fall back to
    // COUNTERPARTS_DATA_DIR when the config names no store, so "no environment
    // override" is wrong here for the same reason it was wrong in `init`.
    expect(printed).not.toContain("no environment override");
    // The sentence moved with the one-config rule (2026-09-05): the hooks read
    // this path when NOTHING NAMES ANOTHER — `--config` / `COUNTERPARTS_CONFIG`
    // do, and this install passed neither.
    expect(printed).toContain("the path the hooks read when nothing names another one");

    // The host's two steps are PRINTED, and they name absolute paths.
    expect(printed).toContain("claude mcp add counterparts");
    expect(printed).toContain(`COUNTERPARTS_DATA_DIR="${store}"`);
    expect(printed).toContain(HOOK_SCRIPT);
    expect(printed).toContain(MCP_SCRIPT);
    for (const event of HOST_EVENTS) expect(printed).toContain(event);
    expect(printed).toContain("printed, not applied");
  });

  test("refuses a --dir that would put the config inside the data dir", async () => {
    // `--dir ~/.counterparts` is the shape that creates a store and then never
    // opens again: the layout totality check refuses an unclassified top-level
    // entry, and `claude-code.json` is one. Caught before anything is written.
    const home = fakeHome("selfeating");
    const c = consoleWith();
    const code = await run(["install", "--dir", join(home, ".counterparts")], {
      io: c.io,
      env: {},
      home,
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("INSIDE the data dir");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the printed host commands survive a PATH with no bun on it", () => {
    // The failure this pins is invisible: a host whose PATH lacks `~/.bun/bin`
    // runs `counterparts-hook` (shebang `#!/usr/bin/env bun`) and gets "command
    // not found" on every event — no memory, no error the owner ever sees. The
    // host's process environment is not the login shell's; `credentials.ts`
    // measured exactly that on day 0 for the API keys.
    for (const cmd of [settingsBlock(), mcpCommand("/tmp/store")]) {
      // No bare executable NAME may appear as something to run: every runnable
      // token in these blocks is an absolute path.
      expect(cmd).not.toMatch(/"command": "counterparts-hook"/);
      expect(cmd).not.toMatch(/--\s+counterparts-mcp\s*$/);
    }
    expect(existsSync(HOOK_SCRIPT)).toBe(true);
    expect(existsSync(MCP_SCRIPT)).toBe(true);
    // `run` against the real runtime this process is using, absolute both sides.
    expect(runCommand(HOOK_SCRIPT)).toBe(`"${process.execPath}" run "${HOOK_SCRIPT}"`);
    // A path with a space stays one argument.
    expect(runCommand("/a b/c.ts", "/x y/bun")).toBe('"/x y/bun" run "/a b/c.ts"');
  });

  test("--embedder is the only way the egress knob is written", async () => {
    const home = fakeHome("egress");
    const store = join(outside, "egress", "store");
    await run(["install", "--dir", store, "--budget", "9000", "--embedder"], {
      io: consoleWith().io,
      env: {},
      home,
    });
    const parsed = JSON.parse(
      readFileSync(join(home, ".counterparts", CONFIG_FILE), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["embedder"]).toEqual({ enabled: true });
  });

  test("invents no injection ceiling, and says so (scar §2.18)", async () => {
    const home = fakeHome("noceiling");
    const store = join(outside, "noceiling", "store");
    const c = consoleWith();
    expect(await run(["install", "--dir", store], { io: c.io, env: {}, home })).toBe(EXIT.ok);
    const parsed = JSON.parse(
      readFileSync(join(home, ".counterparts", CONFIG_FILE), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["injectionBudgetBytes"]).toBeUndefined();
    expect(text(c.out)).toContain("invents none");
  });

  test("refuses a --budget that is not a positive whole number, before anything is created", async () => {
    const home = fakeHome("badbudget");
    const store = join(outside, "badbudget", "store");
    const c = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "lots"], { io: c.io, env: {}, home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--budget");
    expect(existsSync(store)).toBe(false);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("is idempotent: a second install keeps both files, and --force replaces them", async () => {
    const home = fakeHome("twice-install");
    const store = join(outside, "twice-install", "store");
    const config = join(home, ".counterparts", CONFIG_FILE);
    await run(["install", "--dir", store, "--budget", "9000"], {
      io: consoleWith().io,
      env: {},
      home,
    });
    writeFileSync(config, JSON.stringify({ dataDir: store, injectionBudgetBytes: 1234 }));

    const second = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "9000"], { io: second.io, env: {}, home }),
    ).toBe(EXIT.ok);
    expect(text(second.out)).toContain("kept");
    // The file pointing at somebody's live memory is never silently rewritten.
    expect(
      (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>)["injectionBudgetBytes"],
    ).toBe(1234);

    const third = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "9000", "--force"], {
        io: third.io,
        env: {},
        home,
      }),
    ).toBe(EXIT.ok);
    expect(
      (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>)["injectionBudgetBytes"],
    ).toBe(9000);
  });

  test("refuses a forbidden data dir before a single file is written", async () => {
    const home = fakeHome("forbidden");
    const forbidden = join(homedir(), ".bansai", "cli-install-must-not-exist", "store");
    const c = consoleWith();
    expect(await run(["install", "--dir", forbidden], { io: c.io, env: {}, home })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("DATA_DIR_FORBIDDEN");
    expect(existsSync(forbidden)).toBe(false);
  });

  test("is an owner operation: an observer console refuses it", async () => {
    expect(OWNER_OPS).toContain("install");
    const home = fakeHome("obs");
    const c = consoleWith();
    expect(
      await run(["install", "--dir", join(outside, "obs", "store"), "--observer"], {
        io: c.io,
        env: {},
        home,
      }),
    ).toBe(EXIT.refused);
    expect(existsSync(join(outside, "obs"))).toBe(false);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the config dir is ~/.counterparts always; only the store moves", () => {
    const home = join(outside, "layout-home");
    const layout = installLayout(undefined, {}, home);
    expect(layout.base).toBe(join(home, ".counterparts"));
    expect(layout.store).toBe(join(home, ".counterparts", "store"));
    expect(layout.config).toBe(join(home, ".counterparts", CONFIG_FILE));
    expect(layout.credentials).toBe(join(home, ".counterparts", CREDENTIALS_FILE));

    // A named store — flag or environment — moves the STORE and nothing else,
    // because the hooks read one hardcoded configuration path and no other.
    const named = installLayout(join(outside, "elsewhere", "s"), {}, home);
    expect(named.store).toBe(join(outside, "elsewhere", "s"));
    expect(named.config).toBe(join(home, ".counterparts", CONFIG_FILE));
    const fromEnv = installLayout(
      undefined,
      { COUNTERPARTS_DATA_DIR: join(outside, "e", "s") },
      home,
    );
    expect(fromEnv.store).toBe(join(outside, "e", "s"));
    expect(fromEnv.config).toBe(join(home, ".counterparts", CONFIG_FILE));

    // And the one shape that must be refused rather than created.
    expect(layoutRefusal(layout)).toBe(null);
    expect(layoutRefusal(installLayout(join(home, ".counterparts"), {}, home))).toContain(
      "INSIDE the data dir",
    );
  });

  test("the printed settings block is one command on all five events, and is only printed", () => {
    const block = JSON.parse(settingsBlock()) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    expect(Object.keys(block.hooks).sort()).toEqual([...HOST_EVENTS].sort());
    for (const event of HOST_EVENTS) {
      expect(block.hooks[event]?.[0]?.hooks?.[0]?.command).toBe(runCommand(HOOK_SCRIPT));
    }
    // The host's own settings file is never named as a thing we open.
    expect(settingsBlock()).not.toContain("settings.json");
  });
});

/** True when any canonical prose file still holds `needle`. */
function proseHolds(root: string, needle: string): boolean {
  const walk = (path: string): boolean => {
    if (!existsSync(path)) return false;
    if (statSync(path).isDirectory()) {
      return readdirSync(path).some((name) => walk(join(path, name)));
    }
    return readFileSync(path, "utf8").includes(needle);
  };
  return walk(paths.prose(root));
}
