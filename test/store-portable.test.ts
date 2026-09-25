/**
 * A store directory is SELF-CONTAINED (store CONTRACT §5 G15, finding I22) —
 * and, since the floor, a store written by an older build is REFUSED BY NAME
 * rather than migrated (`STORE_PRE_ROWS`).
 *
 * **The scar, and what is left of it.** `prose_path` and `versions.path` used to
 * hold ABSOLUTE paths, so a copied store — `cp -R`, a `counterparts backup`, a
 * restored snapshot — read and DELETED the source's prose through the copy's
 * rows. v5 answered that with store-relative columns and a placement rule, and
 * this file used to test the rule: `resolveStoredPath`, `relativizeStoredPath`,
 * the escape guard, the v4 → v5 migration and its census, ~330 lines of
 * mechanism. Schema v6 deleted all of it, because a row IS its memory and there
 * are no files outside the database for a copy to reach.
 *
 * Constitution line 14 — port the scars, not the code. The CRITERION is what
 * survives, and it is what the first describe asserts: copy a store, destroy
 * the source, read and remove through the copy, and ask which side moved. Those
 * tests are unchanged in what they claim; only the thing they destroy is
 * different, because there is one file to destroy now instead of a tree.
 *
 * The second describe is the floor's own guard: a REAL pre-rows store, built
 * here by hand because this build has no code that can write one, opened as a
 * writer and as a session — refused by name, with the directory byte-identical
 * afterwards.
 *
 * Hermetic (CLAUDE.md): fresh temp dirs, removed in afterEach, never a real
 * store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Database } from "bun:sqlite";

import { EXIT, run, snapshot } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import {
  DATABASE_FILE,
  DATA_DIR_ENV,
  describePreRowsRefusal,
  SCHEMA_VERSION,
  Store,
  isDatabaseSidecar,
  paths,
  storeExists,
} from "../src/core/store/index.js";

let source: string;
let elsewhere: string;
let priorEnv: string | undefined;
const open: Store[] = [];

function store(dir: string, opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

function closeAll(): void {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
}

/** A console that answers every confirmation with `answer` — the id, for a removal. */
function consoleAnswering(answer: string): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      prompt: async (): Promise<string> => answer,
    },
    out,
    err,
  };
}

/**
 * Every file under `dir`, by relative path, hashed by CONTENT.
 *
 * The `-shm` is skipped and nothing else, the way every suite in this project
 * does it since box 2 went to WAL: it is the shared index every connection
 * writes read-marks into, a read-only one included. The `-wal` IS hashed,
 * because committed pages live in it until a checkpoint and a hash that skipped
 * it would pass over exactly the write this is here to catch.
 */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (isDatabaseSidecar(name)) continue;
      out[relative(dir, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  priorEnv = process.env[DATA_DIR_ENV];
  source = mkdtempSync(join(tmpdir(), "counterparts-src-"));
  elsewhere = mkdtempSync(join(tmpdir(), "counterparts-copy-"));
  process.env[DATA_DIR_ENV] = source;
});

afterEach(() => {
  closeAll();
  rmSync(source, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = priorEnv;
});

const BODY = "The copy must read its OWN words, never the source's.";
/** The one actionable token every pre-rows sentence has to carry. */
const HOW_TO_READ_IT = "git checkout floor/v5-last";

/** A store with one memory and one revision, so `versions` holds a row too. */
function seed(dir: string): { id: string } {
  const s = store(dir);
  const id = s.put({ type: "memory", kind: "fact", body: BODY, title: "Portable" });
  s.revise(id, { body: BODY, title: "Portable, revised" });
  s.close();
  open.length = 0;
  return { id };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("a copied store is self-contained — the criterion, with the mechanism gone", () => {
  test("(a) `cp -R` the store, DESTROY the source outright, and the copy still reads its own words", () => {
    const { id } = seed(source);
    const copy = join(elsewhere, "store");
    cpSync(source, copy, { recursive: true });

    // The one move that tells "reads the copy" from "reads the source": there
    // is no source left at all. On the file floor this test removed one `.md`,
    // because a copy could still be reading the source's prose through an
    // absolute row; there is nothing outside the database to point at now, so
    // the honest version of the same question is to take the whole store away.
    rmSync(source, { recursive: true, force: true });
    expect(existsSync(source)).toBe(false);

    const opened = store(copy);
    expect(opened.read(id).doc.body).toBe(BODY);
    expect(opened.read(id).doc.title).toBe("Portable, revised");
    // …and a version read resolves inside the copy too.
    expect(opened.readVersion(id, 1).title).toBe("Portable");
    expect(opened.readVersion(id, 1).body).toBe(BODY);
    // Re-create the source dir so afterEach's rmSync has something to remove.
    mkdirSync(source, { recursive: true });
  });

  test("(b) an owner removal run in the COPY leaves the SOURCE byte-identical", async () => {
    const { id } = seed(source);
    const copy = join(elsewhere, "store");
    cpSync(source, copy, { recursive: true });
    const sourceBefore = fingerprint(source);

    const c = consoleAnswering(id);
    const code = await run(["remove", id, "--confirm", "--dir", copy], { io: c.io });
    expect(c.err.join("\n")).toBe("");
    expect(code).toBe(EXIT.ok);

    // The copy's words are gone — the row survives as a tombstone…
    const removed = store(copy, { observer: true });
    expect(removed.row(id)?.body).toBe("");
    expect(removed.row(id)?.content_hash).toBe("");
    expect(removed.versions(id).map((v) => v.body)).toEqual([""]);
    removed.close();
    open.length = 0;

    // …and the source has every byte it had.
    expect(fingerprint(source)).toEqual(sourceBefore);
    const back = store(source);
    expect(back.read(id).doc.body).toBe(BODY);
    expect(back.readVersion(id, 1).body).toBe(BODY);
  });

  test("(d) a `backup` snapshot opens standalone and HOLDS THE WORDS after the source is gone", () => {
    const { id } = seed(source);
    const s = store(source, { observer: true });
    const target = join(elsewhere, "snap");
    const report = snapshot(s, target);
    expect(report.ok).toBe(true);
    s.close();
    open.length = 0;

    // Wipe the SOURCE entirely: a restore is exactly the case where it is gone.
    rmSync(source, { recursive: true, force: true });

    // THE DATABASE ALONE MUST CARRY THE BODIES NOW. On the file floor a
    // database-only snapshot would have been scar §2.11 all over again; here it
    // is the whole store, and this assertion is what proves the snapshot did
    // not quietly become a copy of the bookkeeping.
    expect(readdirSync(target)).toEqual([DATABASE_FILE]);
    const restored = store(target);
    expect(restored.read(id).doc.body).toBe(BODY);
    expect(restored.readVersion(id, 1).title).toBe("Portable");
    expect(restored.readVersion(id, 1).body).toBe(BODY);
    // The restored store is writable and keeps writing INSIDE itself.
    const more = restored.put({ type: "memory", kind: "fact", body: "written after restore" });
    expect(restored.read(more).doc.body).toBe("written after restore");
    mkdirSync(source, { recursive: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The pre-rows refusal (`STORE_PRE_ROWS`).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A REAL v5 store, built by hand.
 *
 * By hand because it has to be: this build has no code that can write one any
 * more, and a fixture that only pretended — an empty file called
 * `operational.sqlite` — would prove the refusal fires on a name rather than on
 * a store. This is the v5 DDL as `store/operational.ts` carried it at master
 * `481b228`, a real memory row with a real `prose_path`, the prose file it
 * names, and an archived version beside it.
 */
function buildV5Store(dir: string): { id: string; proseRel: string } {
  const id = "mem_000000000001";
  const proseRel = join("prose", "memories", `${id}.md`);
  mkdirSync(join(dir, "prose", "memories"), { recursive: true });
  mkdirSync(join(dir, "versions", id), { recursive: true });
  // NO `cache/`. A real v5 store has one, and leaving it out is deliberate:
  // `Store`'s constructor mkdirs box 3's directory on every open, so its ABSENCE
  // after a refused open is what proves the refusal ran before the first write.
  // A fingerprint hashes files and would not have noticed an empty directory.
  writeFileSync(
    join(dir, proseRel),
    `---\nid: ${id}\ntype: memory\nlearned: 2026-09-01\nbornDay: 0\npayload: ${JSON.stringify({
      id,
      type: "memory",
      learnedOn: "2026-09-01",
      bornDay: 0,
      meta: {},
    })}\n---\nThe words a v5 store keeps in a file.`,
    "utf8",
  );
  writeFileSync(join(dir, "versions", id, "0001-abcdef0123456789.md"), "an archived version", "utf8");

  const db = new Database(join(dir, "operational.sqlite"), { create: true });
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`CREATE TABLE memories (
     id TEXT PRIMARY KEY, type TEXT NOT NULL, kind TEXT NOT NULL, band TEXT NOT NULL,
     band_day INTEGER NOT NULL, novelty REAL, relevance REAL NOT NULL, emotional REAL NOT NULL,
     predictive REAL NOT NULL, claimed REAL, birth_day INTEGER NOT NULL, uses REAL NOT NULL DEFAULT 0,
     last_used_day INTEGER NOT NULL, reinforced_days INTEGER NOT NULL DEFAULT 0,
     consolidated INTEGER NOT NULL DEFAULT 0, promoted_identity INTEGER NOT NULL DEFAULT 0,
     protected INTEGER NOT NULL DEFAULT 0, pressure REAL NOT NULL DEFAULT 0,
     last_challenged_day INTEGER, archived INTEGER NOT NULL DEFAULT 0, archived_reason TEXT,
     superseded_by TEXT REFERENCES memories(id), revision INTEGER NOT NULL DEFAULT 0,
     content_hash TEXT NOT NULL, prose_path TEXT NOT NULL, learned_on TEXT NOT NULL,
     happened_on TEXT, source TEXT, origin_session TEXT, origin_scope TEXT, origin_ref TEXT)`);
  db.exec(`CREATE TABLE versions (
     memory_id TEXT NOT NULL REFERENCES memories(id), seq INTEGER NOT NULL, reason TEXT NOT NULL,
     version_day INTEGER NOT NULL, archived_at INTEGER NOT NULL, path TEXT NOT NULL,
     content_hash TEXT NOT NULL, successor_id TEXT REFERENCES memories(id),
     PRIMARY KEY (memory_id, seq))`);
  db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', '5')");
  db.run("INSERT INTO meta (key, value) VALUES ('livedDay', '12')");
  db.run(
    `INSERT INTO memories (id, type, kind, band, band_day, relevance, emotional, predictive,
       birth_day, last_used_day, content_hash, prose_path, learned_on)
     VALUES (?, 'memory', 'fact', 'episodic', 0, 0, 0, 0, 0, 0, 'abcdef0123456789', ?, '2026-09-01')`,
    [id, proseRel],
  );
  db.run(
    `INSERT INTO versions (memory_id, seq, reason, version_day, archived_at, path, content_hash)
     VALUES (?, 1, 'revise', 0, 0, ?, 'abcdef0123456789')`,
    [id, join("versions", id, "0001-abcdef0123456789.md")],
  );
  db.close();
  return { id, proseRel };
}

describe("a store written before the floor is refused by name, and never touched", () => {
  test("a WRITER open throws STORE_PRE_ROWS and the directory is byte-identical afterwards", () => {
    const { proseRel } = buildV5Store(source);
    const before = fingerprint(source);
    expect(Object.keys(before).sort()).toEqual(
      [proseRel, join("versions", "mem_000000000001", "0001-abcdef0123456789.md"), "operational.sqlite"].sort(),
    );

    let code = "NO_THROW";
    let detail: Record<string, unknown> = {};
    try {
      Store.open({ dir: source });
    } catch (err) {
      code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
      detail = (err as { detail?: Record<string, unknown> }).detail ?? {};
    }
    expect(code).toBe("STORE_PRE_ROWS");
    // It names EVERY marker it found — the 16,000 files under `prose/` are the
    // part the owner would want named, and the first draft mentioned only the
    // database (A-NIT-1) — plus what this build writes and which build still
    // reads the store, so the refusal ends in something to do.
    expect(detail["found"]).toBe("operational.sqlite, prose, versions");
    expect(detail["expected"]).toBe(SCHEMA_VERSION);
    expect(detail["readableBy"]).toBe("floor/v5-last");

    // NOTHING MOVED. Not one byte, and NOT ONE DIRECTORY — `cache/` is the
    // constructor's first write on every other open, so its absence here is the
    // ordering proved rather than asserted. A fingerprint hashes files only and
    // would have passed over an empty one.
    expect(fingerprint(source)).toEqual(before);
    expect(readdirSync(source).sort()).toEqual(["operational.sqlite", "prose", "versions"]);
    expect(existsSync(paths.operational(source))).toBe(false);
    const db = new Database(join(source, "operational.sqlite"), { readonly: true });
    expect(
      (db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string }).value,
    ).toBe("5");
    const columns = (db.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toContain("prose_path");
    expect(columns).not.toContain("body");
    db.close();
    expect(readFileSync(join(source, proseRel), "utf8")).toContain("The words a v5 store keeps in a file");
  });

  test("an OBSERVER open, and a whole session, meet the same refusal and write nothing", () => {
    buildV5Store(source);
    const before = fingerprint(source);

    for (const attempt of [
      (): unknown => Store.open({ dir: source, observer: true }),
      // The hook's own path. `Counterpart.open` makes `spans/` and `sessions/`
      // of its own, so this also proves the refusal lands before any of that:
      // a directory created here would be a byte written into his old store.
      (): unknown => Counterpart.open({ dir: source, observer: true }),
      (): unknown => Counterpart.open({ dir: source, owner: true }),
    ]) {
      let code = "NO_THROW";
      try {
        attempt();
      } catch (err) {
        code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
      }
      expect(code).toBe("STORE_PRE_ROWS");
    }
    expect(fingerprint(source)).toEqual(before);
    // Directories too, and `Counterpart.open` makes three of its own.
    expect(readdirSync(source).sort()).toEqual(["operational.sqlite", "prose", "versions"]);
  });

  test("the old database is never OPENED — a garbage `operational.sqlite` refuses the same way", () => {
    // THE "WITHOUT OPENING IT" CLAIM, PROVED STRUCTURALLY rather than asserted.
    //
    // The fixture above is a valid DELETE-mode SQLite file, so a refusal that
    // quietly opened it to read `meta.schemaVersion` would pass every assertion
    // there. This one is not a database at all: if anything opened it the error
    // would be "file is not a database", not `STORE_PRE_ROWS`.
    //
    // It is also the WAL worry answered without needing a real `-wal`. The live
    // store is in WAL since F1, and an open-and-close of it can checkpoint and
    // delete the log — moving the bytes of the store the refusal exists to leave
    // alone. Nothing that never opens the file can do that.
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "operational.sqlite"), "not a database, not even close", "utf8");
    const before = fingerprint(source);

    let code = "NO_THROW";
    try {
      Store.open({ dir: source });
    } catch (err) {
      code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
    }
    expect(code).toBe("STORE_PRE_ROWS");
    expect(fingerprint(source)).toEqual(before);
    expect(readdirSync(source)).toEqual(["operational.sqlite"]);
  });

  test("a directory holding only prose/ — the database moved away — is refused too", () => {
    // A store whose database was moved or deleted by hand still holds every one
    // of its words. Minting a blank v6 store on top of them would bury the one
    // copy there is, so the markers are all three, not just the database.
    mkdirSync(join(source, "prose", "memories"), { recursive: true });
    writeFileSync(join(source, "prose", "memories", "mem_x.md"), "words with no database", "utf8");
    const before = fingerprint(source);

    let code = "NO_THROW";
    try {
      Store.open({ dir: source });
    } catch (err) {
      code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
    }
    expect(code).toBe("STORE_PRE_ROWS");
    expect(fingerprint(source)).toEqual(before);
    // No database minted on top of them, and no directory either.
    expect(readdirSync(source)).toEqual(["prose"]);
  });

  test("the CONSOLE meets the refusal by name rather than offering to create a store", async () => {
    // The plan's failure mode (a): the checkout is deployed early by habit. What
    // makes that a loud broken session rather than a corrupted store is that
    // every door lands here — and `status` is the door an owner opens first.
    buildV5Store(source);
    const before = fingerprint(source);
    const c = consoleAnswering("");
    const code = await run(["status", "--dir", source], { io: c.io });
    expect(code).not.toBe(EXIT.ok);
    const printed = [...c.out, ...c.err].join("\n");
    // A SENTENCE, not the bare code and a JSON blob the first draft printed.
    expect(printed).toContain("written before this build's floor");
    expect(printed).toContain(HOW_TO_READ_IT);
    expect(printed).not.toContain("STORE_PRE_ROWS {");
    // And NOT the sentence that invites somebody to build a store on top of his
    // old one, which is what `storeExists` answering "no" would have produced.
    expect(printed).not.toContain("counterparts init");
    expect(fingerprint(source)).toEqual(before);
    expect(readdirSync(source).sort()).toEqual(["operational.sqlite", "prose", "versions"]);
  });

  test("A-MAJOR-1: an old build touching a v6 store is a lockout — the remedy names the way out", () => {
    // THE ROLLBACK THE CUT-OVER PLAN CALLS FOR. Master's `Store` constructor
    // mkdirs `prose/`, `versions/`, `tmp/` and mints `operational.sqlite`
    // BEFORE it reaches `assertLayout()`, so ONE old-build SessionStart hook on
    // a v6 store leaves every marker behind — and from then on THIS build
    // refuses its own store, telling the owner it is readable by the build that
    // just stood down on the same directory. Both builds dead, no instructions.
    //
    // Simulated exactly (an old build is not importable here): the empty
    // directories and the empty database it leaves, beside an intact v6 store.
    const { id } = seed(source);
    mkdirSync(join(source, "prose"), { recursive: true });
    mkdirSync(join(source, "versions"), { recursive: true });
    mkdirSync(join(source, "tmp"), { recursive: true });
    writeFileSync(join(source, "operational.sqlite"), "", "utf8");
    const before = fingerprint(source);

    let detail: Record<string, unknown> = {};
    let code = "NO_THROW";
    try {
      Store.open({ dir: source });
    } catch (err) {
      code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
      detail = (err as { detail?: Record<string, unknown> }).detail ?? {};
    }
    expect(code).toBe("STORE_PRE_ROWS");
    // It says THIS build's store is here and intact, names what to remove, and
    // does NOT send him at `floor/v5-last`, which is the build that just failed.
    expect(detail["alsoFound"]).toBe(DATABASE_FILE);
    expect(detail["readableBy"]).toBeUndefined();
    const remedy = String(detail["remedy"]);
    expect(remedy).toContain("is THIS build's store");
    expect(remedy).toContain("opens again with every memory in it");
    // MOVE ASIDE, NEVER REMOVE. By listing alone this case and "a real v5 store
    // whose prose/ was moved out" are indistinguishable, so the instruction has
    // to be safe when the guess is wrong (third review, NEW-MINOR-2).
    expect(remedy).toContain("MOVE THOSE OUT");
    expect(remedy).toContain("do not delete them");
    expect(remedy).not.toMatch(/\bremove\b/i);
    expect(remedy).not.toMatch(/\brm\b/i);
    // …and it names the case the guess cannot rule out.
    expect(remedy).toContain("If you moved prose/ aside yourself");
    // Every marker is named, not just the first (A-NIT-1).
    expect(String(detail["found"])).toContain("operational.sqlite");
    expect(String(detail["found"])).toContain("prose");
    expect(String(detail["found"])).toContain("versions");
    expect(fingerprint(source)).toEqual(before);

    // AND THE REMEDY WORKS. Follow it and the store comes back with every row.
    for (const name of ["operational.sqlite", "prose", "versions", "tmp"]) {
      rmSync(join(source, name), { recursive: true, force: true });
    }
    const back = store(source);
    expect(back.read(id).doc.body).toBe(BODY);
    expect(back.readVersion(id, 1).title).toBe("Portable");
  });

  test("A-MAJOR-1: beside a REAL pre-rows store the remedy never says delete", () => {
    // The same two names, the opposite instruction. A v5 store somebody has
    // hand-copied a `counterparts.sqlite` into is holding every memory he has
    // under `prose/`, and "remove those four" would destroy them. The
    // discrimination is `prose/` being EMPTY or not, asked by LISTING — never
    // by opening the old database, which on a post-F1 store could checkpoint
    // its `-wal` away.
    buildV5Store(source);
    writeFileSync(paths.operational(source), "a v6 database somebody copied in", "utf8");
    const before = fingerprint(source);

    let detail: Record<string, unknown> = {};
    try {
      Store.open({ dir: source });
    } catch (err) {
      detail = (err as { detail?: Record<string, unknown> }).detail ?? {};
    }
    const remedy = String(detail["remedy"]);
    expect(detail["alsoFound"]).toBe(DATABASE_FILE);
    expect(remedy).toContain("WITH FILES IN IT");
    expect(remedy).toContain("DELETE NEITHER");
    // The words that would have been a catastrophe here.
    expect(remedy).not.toContain("Remove");
    expect(remedy).not.toContain("remove");
    expect(fingerprint(source)).toEqual(before);
  });

  test("A-MAJOR-2: a v5 database wearing the v6 NAME is refused, never stamped v6", () => {
    // The filename door is the FIRST lock and this is the second. `mv
    // operational.sqlite counterparts.sqlite` is the first thing a person
    // tries; with `prose/` and `versions/` moved aside too, the constructor
    // sees nothing to refuse. Past it, the old code ran the DDL (which leaves
    // a v5 `memories` alone), then STAMPED the file v6 — after which this build
    // reads no body and the old build refuses it `SCHEMA_AHEAD` for ever.
    buildV5Store(source);
    rmSync(join(source, "prose"), { recursive: true, force: true });
    rmSync(join(source, "versions"), { recursive: true, force: true });
    renameSync(join(source, "operational.sqlite"), paths.operational(source));
    const before = fingerprint(source);

    let code = "NO_THROW";
    let detail: Record<string, unknown> = {};
    try {
      Store.open({ dir: source });
    } catch (err) {
      code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
      detail = (err as { detail?: Record<string, unknown> }).detail ?? {};
    }
    expect(code).toBe("STORE_PRE_ROWS");
    expect(detail["reason"]).toBe("no-body-column");
    expect(detail["found"]).toBe("5");
    expect(detail["readableBy"]).toBe("floor/v5-last");

    // THE STAMP DID NOT MOVE, which is the whole finding: a v5 stamp on a v5
    // shape, and no `versions` table created underneath it either.
    const db = new Database(paths.operational(source), { readonly: true });
    expect(
      (db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string }).value,
    ).toBe("5");
    const columns = (db.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain("prose_path");
    expect(columns).not.toContain("body");
    db.close();
    // The file itself is untouched apart from the sidecars an open leaves —
    // this lock fires with the database already open, unlike the first.
    expect(before["operational.sqlite"]).toBeUndefined();
  });

  test("A-MAJOR-2: a v6-SHAPED database whose stamp was lowered by hand still migrates forward", () => {
    // The reason the lock is keyed on the SHAPE and not on the version. A bare
    // `found < SCHEMA_VERSION` would refuse this, and three tests in
    // `store.test.ts` say it must not: the words are all there, the columns are
    // all there, only the stamp moved.
    const { id } = seed(source);
    const db = new Database(paths.operational(source));
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '3')");
    db.close();
    const migrated = store(source, { snapshotsDir: elsewhere });
    expect(migrated.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(migrated.read(id).doc.body).toBe(BODY);
  });

  test("A-MINOR-4: a directory holding only the old SIDECARS is pre-rows too", () => {
    // `PRE_ROWS_MARKERS` matched exact names while `LAYOUT` prefix-matches its
    // own sidecars, so a pre-rows directory whose main database was moved by
    // hand was not seen as pre-rows: the constructor mkdir'd `cache/`,
    // `openOperational` minted `counterparts.sqlite`, and only THEN did
    // `assertLayout` refuse — on the wrong evidence, and after the one write
    // that landed in a pre-rows directory ahead of the refusal.
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "operational.sqlite-wal"), "frames nobody checkpointed", "utf8");
    writeFileSync(join(source, "operational.sqlite-shm"), "shared index", "utf8");
    const before = fingerprint(source);

    let code = "NO_THROW";
    let detail: Record<string, unknown> = {};
    try {
      Store.open({ dir: source });
    } catch (err) {
      code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "NOT_STORE_ERROR";
      detail = (err as { detail?: Record<string, unknown> }).detail ?? {};
    }
    expect(code).toBe("STORE_PRE_ROWS");
    expect(String(detail["found"])).toContain("operational.sqlite-wal");
    // NOTHING MINTED — not `counterparts.sqlite`, not `cache/`.
    expect(fingerprint(source)).toEqual(before);
    expect(readdirSync(source).sort()).toEqual(["operational.sqlite-shm", "operational.sqlite-wal"]);
    // A pre-F1 store's rollback journal counts the same way.
    rmSync(join(source, "operational.sqlite-shm"));
    rmSync(join(source, "operational.sqlite-wal"));
    writeFileSync(join(source, "operational.sqlite-journal"), "mid-transaction", "utf8");
    expect(() => Store.open({ dir: source })).toThrow(/STORE_PRE_ROWS/);
  });

  test("NEW-MINOR-2: a real v5 store whose prose/ was MOVED OUT is not told to delete anything", () => {
    // The misfire the third review found. This directory is indistinguishable
    // from the lockout by LISTING — empty `prose/`, an `operational.sqlite` —
    // but that database holds 3 memories' physics, bands, dates and the
    // permanent removal record. The old wording said "remove it".
    const { proseRel } = buildV5Store(source);
    const parked = join(elsewhere, "parked");
    mkdirSync(parked, { recursive: true });
    // His shape: the WORDS moved aside, the empty directories left behind. A
    // store whose memories were never revised has an empty `versions/` anyway.
    renameSync(join(source, "prose"), join(parked, "prose"));
    renameSync(join(source, "versions"), join(parked, "versions"));
    mkdirSync(join(source, "prose"), { recursive: true });
    mkdirSync(join(source, "versions"), { recursive: true });
    writeFileSync(paths.operational(source), "a v6 database somebody copied in", "utf8");
    const before = fingerprint(source);

    let detail: Record<string, unknown> = {};
    try {
      Store.open({ dir: source });
    } catch (err) {
      detail = (err as { detail?: Record<string, unknown> }).detail ?? {};
    }
    const remedy = String(detail["remedy"]);
    // The guess is WRONG here — it reads as the lockout — and the instruction
    // is still safe, which is the whole point of move-aside.
    expect(remedy).toContain("MOVE THOSE OUT");
    // The only use of the word "delete" is a PROHIBITION, never an instruction.
    expect(remedy).not.toMatch(/\bremove\b/i);
    expect(remedy).toContain("do not delete them");
    expect(remedy).toContain("If you moved prose/ aside yourself");
    expect(remedy).toContain("keep both");
    expect(fingerprint(source)).toEqual(before);
    // And the parked words are exactly where he put them.
    expect(readFileSync(join(parked, proseRel.replace(/^prose\//, "prose/")), "utf8")).toContain(
      "The words a v5 store keeps in a file",
    );
  });

  test("A-MINOR-3: every refusal has one sentence a person can act on", () => {
    buildV5Store(source);
    let refusal: unknown;
    try {
      Store.open({ dir: source });
    } catch (err) {
      refusal = err;
    }
    const said = describePreRowsRefusal(refusal, "Name a store with --dir.") ?? "";
    // What this directory is, that nothing was touched, which build opens it,
    // and what to do — the four things the bare code and JSON blob did not say.
    expect(said).toContain("written before this build's floor");
    expect(said).toContain("NOTHING WAS TOUCHED");
    expect(said).toContain("floor/v5-last");
    expect(said).toContain("git checkout floor/v5-last");
    expect(said).toContain("Name a store with --dir.");
    // And it is null for anything else, so a caller falls through to its usual
    // rendering rather than mislabelling an unrelated failure.
    expect(describePreRowsRefusal(new Error("something else"), "x")).toBeNull();
  });

  test("`storeExists` says YES to a pre-rows store, so every console door reaches the named refusal", () => {
    buildV5Store(source);
    // It is the gate ~20 commands ask before they open anything. Answering
    // "no store here" would send all of them down the "run init" path — the one
    // sentence that invites somebody to build a store on top of his old one.
    expect(storeExists(source)).toBe(true);
  });

  test("A-MINOR-1/-2: every console door refuses in a SENTENCE and touches nothing — box 3 included", async () => {
    buildV5Store(source);
    // A cache, so the two doors that open box 3 directly have one to reach for.
    mkdirSync(join(source, "cache"), { recursive: true });
    const cache = new Database(paths.cache(source), { create: true });
    cache.exec("CREATE TABLE doc_tokens (memory_id TEXT, token TEXT)");
    cache.close();
    const before = fingerprint(source);

    for (const argv of [
      ["status"],
      ["verify"],
      // `--rebuild` opened box 3 for its census BEFORE box 2, so the refusal
      // arrived after a `-shm` had moved (A-MINOR-2).
      ["verify", "--rebuild", "--drop-vectors"],
      // `migrate-cache` never opens a `Store` at all (A-MINOR-1).
      ["migrate-cache"],
      ["migrate-cache", "--apply", "--yes"],
      ["fired"],
      ["mechanisms"],
    ]) {
      const c = consoleAnswering("");
      const code = await run([...argv, "--dir", source], { io: c.io });
      const printed = [...c.out, ...c.err].join("\n");
      // A SENTENCE, not a bare code and a JSON blob (A-MINOR-3).
      expect({ argv, ok: code !== EXIT.ok }).toEqual({ argv, ok: true });
      expect({ argv, said: printed.includes("written before this build's floor") }).toEqual({
        argv,
        said: true,
      });
      expect({ argv, untouched: printed.includes("NOTHING WAS TOUCHED") }).toEqual({
        argv,
        untouched: true,
      });
      expect({ argv, how: printed.includes(HOW_TO_READ_IT) }).toEqual({ argv, how: true });
      // …and it is true: not one byte, `cache/`'s `-shm` included.
      expect({ argv, after: fingerprint(source) }).toEqual({ argv, after: before });
    }
  });

  test("NEW-MINOR-3/-4: the SHAPE-lock shape gets the same sentence, and box 3 is not touched", async () => {
    // A v5 database wearing the v6 NAME. `preRowsMarkersIn` cannot see it —
    // there is no old filename left — so `status` and `verify` met
    // `OBSERVER_READ_FLOOR`'s `STORE_UNINITIALIZED` and printed a bare code and
    // a JSON blob, while `verify --rebuild`, `migrate-cache` and the hook all
    // printed the sentence. And `migrate-cache` was not refused at all: it ran
    // to completion against box 3 of a store this build says it cannot read.
    buildV5Store(source);
    rmSync(join(source, "prose"), { recursive: true, force: true });
    rmSync(join(source, "versions"), { recursive: true, force: true });
    renameSync(join(source, "operational.sqlite"), paths.operational(source));
    mkdirSync(join(source, "cache"), { recursive: true });
    const cache = new Database(paths.cache(source), { create: true });
    cache.exec("CREATE TABLE doc_tokens (memory_id TEXT, token TEXT)");
    cache.close();
    const before = fingerprint(source);

    for (const argv of [
      ["status"],
      ["verify"],
      ["verify", "--rebuild", "--drop-vectors"],
      ["migrate-cache"],
      ["migrate-cache", "--apply", "--yes"],
    ]) {
      const c = consoleAnswering("");
      const code = await run([...argv, "--dir", source], { io: c.io });
      const printed = [...c.out, ...c.err].join("\n");
      expect({ argv, ok: code !== EXIT.ok }).toEqual({ argv, ok: true });
      expect({ argv, said: printed.includes("written before this build's floor") }).toEqual({
        argv,
        said: true,
      });
      expect({ argv, blob: printed.includes("STORE_UNINITIALIZED {") }).toEqual({
        argv,
        blob: false,
      });
      // NOT ONE BYTE, `cache/`'s `-shm` included — the sweep that used to move
      // before the refusal arrived.
      expect({ argv, after: fingerprint(source) }).toEqual({ argv, after: before });
    }

    // The stamp did not move either: the second lock still refuses the writer.
    const db = new Database(paths.operational(source), { readonly: true });
    expect(
      (db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string }).value,
    ).toBe("5");
    db.close();
  });

  test("NEW-NIT-1: the sentence says a VERSION is a version, not a filename", () => {
    // `describePreRowsRefusal` rendered `found` as though it were always names,
    // so the shape lock printed "it keeps its memories in files (5)".
    buildV5Store(source);
    rmSync(join(source, "prose"), { recursive: true, force: true });
    rmSync(join(source, "versions"), { recursive: true, force: true });
    renameSync(join(source, "operational.sqlite"), paths.operational(source));
    let refusal: unknown;
    try {
      Store.open({ dir: source });
    } catch (err) {
      refusal = err;
    }
    const said = describePreRowsRefusal(refusal, "Name a store with --dir.") ?? "";
    expect(said).not.toContain("files (5)");
    expect(said).toContain("schema v5");
    expect(said).toContain(HOW_TO_READ_IT);
  });

  test("a v6 store is not refused, and the refusal costs a fresh store nothing", () => {
    // Non-vacuity from the other side: the marker check must not be a thing
    // that fires on any directory, and an empty dir is the ordinary first open.
    const { id } = seed(source);
    expect(store(source, { observer: true }).read(id).doc.body).toBe(BODY);
    const fresh = join(elsewhere, "fresh");
    expect(store(fresh).getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
  });
});
