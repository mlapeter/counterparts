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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// Box 3 directly, for the two things `verify`'s guard is about: seeding a
// vector the way the backfill seeds one, and counting what is still there.
import { openCache, setEmbedding } from "../src/core/store/cache.js";
import { openDb } from "../src/core/store/db.js";
import { LAYOUT, Store, paths } from "../src/core/store/index.js";
import {
  BLOB_NAME,
  CONFIG_FILE,
  CREDENTIALS_FILE,
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
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";

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
  test("reports the absence of a store rather than creating one by looking", async () => {
    const empty = join(outside, "no-store-here");
    const c = consoleWith();
    const code = await run(["status", "--dir", empty], { io: c.io });
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("No store at");
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
    expect(printed).toContain("Live memories: 1");
    expect(printed).toContain("Journal: 1 episode");
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
    expect(printed).toContain("Live memories:");
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
    // The claims audit's F6, in the CLI's own text: the hook takes no FLAG, and
    // it does fall back to the environment for the store. "No flag and no
    // environment override" was printed here for a while and is not true
    // (`hook.ts:84`, `dataDir: loaded.dataDir ?? dataDir()`).
    expect(printed).toContain("taking no flag");
    expect(printed).toContain("COUNTERPARTS_DATA_DIR");
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
describe("remove — the span buffer is named, never implied", () => {
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

  test("a note that rode the buffer is named unchased — in the dry run, the report and the record", async () => {
    store().close();
    const w = consoleWith();
    expect(await run(["note", MARKER, "--dir", dir], { io: w.io })).toBe(EXIT.ok);
    const id = idFrom(w.out);
    expect(id).toMatch(/^mem_/);
    // The residue itself, before anything is removed: the prose AND the buffer.
    const seeded = grepStore(dir, "ZQRESIDUEPROBE");
    expect(seeded.some((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"))).toBe(true);

    // The DRY RUN says it, and says it above the closing line — a disclosure
    // under "Nothing has changed" is one the reader has already stopped reading.
    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("the raw capture buffer still holds this memory's words");
    expect(planned).toContain("Chasing it is a core change, not yet written.");
    expect(planned.indexOf("NOT chased")).toBeLessThan(planned.indexOf("Dry run. Nothing has changed."));
    // §16 G15 still holds: the report names a file, never a word of its contents.
    expect(planned).not.toContain("culvert gate key");

    // The REAL removal says the same thing, and the durable record counts it.
    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain(
      "unchased (dark via the deny-list, never silently dropped): spans/",
    );
    expect(printed).toContain("jots.jsonl — the raw capture buffer still holds this memory's words");
    expect(printed).toContain('"unchased":1');

    // And the report is TRUE: the prose is gone, the buffer line is not.
    const left = grepStore(dir, "ZQRESIDUEPROBE");
    expect(left.some((p) => p.startsWith("prose/"))).toBe(false);
    expect(left.some((p) => p.startsWith("spans/"))).toBe(true);
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

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped): nothing");
    expect(printed).toContain('"unchased":0');
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
    expect(printed).toContain("The cache covers every canonical row");
    // Nothing canonical moved, and — the whole point — the vector is still there.
    expect(fingerprint(dir)).toBe(before);
    expect(embeddings()).toBe(1);
    // And not a byte anywhere in the directory, box 3 included: `openCache` is
    // version-idempotent now, so the census may claim the strong form the
    // dashboard suite could only claim across renders (its INTERFACE-GAPS §1).
    expect(everyByte(dir)).toBe(everyByteBefore);
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
      const code = await run([command, "--observer", "--out", outside, "x"], {
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
    expect(text(c.out)).toContain("Live memories:");
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

    // THE ONE PATH THE HOOKS READ. `claude-code/bin/hook.ts` and `bin/runner.ts`
    // both hardcode `join(homedir(), ".counterparts", "claude-code.json")` with
    // no flag and no environment override, and every hook exits 0 — so a config
    // written anywhere else is an ambient half that never fires and never says
    // why. `--dir` therefore moves the STORE and only the store.
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
