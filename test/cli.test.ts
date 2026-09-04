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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { openDb } from "../src/core/store/db.js";
import { LAYOUT, Store, paths } from "../src/core/store/index.js";
import {
  BLOB_NAME,
  EXIT,
  OWNER_OPS,
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
    expect(printed).toContain("bin/hook.ts");
    expect(printed).toContain("bin/serve.ts");
    expect(printed).toContain("injectionBudgetBytes");
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
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
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

// ── verify ──────────────────────────────────────────────────────────────────

describe("verify", () => {
  test("rebuilds box 3 from canonical state and accounts for every row", async () => {
    const s = store();
    for (let i = 0; i < 5; i++) s.put({ type: "memory", kind: "fact", body: `Canonical memory ${i} of five.` });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });

    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Re-indexed: 5");
    // What cannot be recomputed is DECLARED, with an owner and a repair (§5 G8).
    expect(text(c.out)).toContain("declared: embeddings");
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
    const code = await run(["rebrief", "--budget", "9000"], { io: c.io, env: { [ENV]: dir } });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Re-rendered the wake bundle");
    expect(printed).toContain("identity 2");
    expect(printed).toContain("craft 1");
    expect(printed).toContain("elements 3");
    expect(printed).toContain("ceiling 9000 bytes (--budget)");
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
    const code = await run(["rebrief"], { io: c.io, env: { [ENV]: dir } });
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
    const code = await run(["rebrief", "--dir", inner], { io: c.io, env: { [ENV]: dir } });
    expect(c.err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("ceiling 4096 bytes (");
    expect(text(c.out)).toContain("claude-code.json");

    const after = Store.open({ dir: inner, observer: true });
    open.push(after);
    expect(byteLength(after.getMeta(BRIEFING_KEY) ?? "")).toBeLessThanOrEqual(
      4096 - PREFACE_RESERVE_BYTES,
    );
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
