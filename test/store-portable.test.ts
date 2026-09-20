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
  mkdirSync(join(dir, "cache"), { recursive: true });
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
    // It names what it found, what this build writes, and which build still
    // reads the store — a refusal that ends in something to do.
    expect(detail["found"]).toBe("operational.sqlite");
    expect(detail["expected"]).toBe(SCHEMA_VERSION);
    expect(detail["readableBy"]).toBe("floor/v5-last");

    // NOTHING MOVED. Not one byte, and no new file: no `counterparts.sqlite`
    // minted beside the old one, no `cache/` created, no v6 DDL run, and above
    // all `schemaVersion` still reads 5 and `memories` still has no `body`.
    expect(fingerprint(source)).toEqual(before);
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
    expect(existsSync(join(source, "spans"))).toBe(false);
    expect(existsSync(join(source, "sessions"))).toBe(false);
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
  });

  test("`storeExists` says YES to a pre-rows store, so every console door reaches the named refusal", () => {
    buildV5Store(source);
    // It is the gate ~20 commands ask before they open anything. Answering
    // "no store here" would send all of them down the "run init" path — the one
    // sentence that invites somebody to build a store on top of his old one.
    expect(storeExists(source)).toBe(true);
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
