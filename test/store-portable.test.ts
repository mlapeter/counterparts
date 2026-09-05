/**
 * A store directory is SELF-CONTAINED (store CONTRACT §5 G14, finding I22).
 *
 * `prose_path` and `versions.path` used to hold ABSOLUTE paths, so a copied
 * store — `cp -R`, a `counterparts backup`, a restored snapshot — read and
 * DELETED the source's prose through the copy's rows. Every test below builds a
 * store in a fresh temp dir, copies it somewhere else, and then does the one
 * thing that tells the two apart: it destroys the SOURCE's file (or removes
 * through the COPY) and asks which side moved.
 *
 * The first describe uses only the API master had before the fix, so stashing
 * `src/` makes these FAIL ON THEIR ASSERTIONS rather than at import — that is
 * the pre-fix proof recorded in the PR.
 *
 * Hermetic (CLAUDE.md): fresh temp dirs, removed in afterEach, never a real
 * store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { EXIT, run, snapshot } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  DATA_DIR_ENV,
  OBSERVER_READ_FLOOR,
  PATHS_MIGRATED_EVENT,
  SCHEMA_VERSION,
  Store,
  paths,
  relativizeStoredPath,
  resolveStoredPath,
  stored,
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

/** Every `.md` under `prose/`, relative to the dir — the canonical bytes. */
function proseFiles(dir: string): string[] {
  const root = paths.prose(dir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"))
    .sort();
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

const BODY = "The copy must read its OWN prose, never the source's.";

/** A store with one memory and one revision (so `versions/` has a file too). */
function seed(dir: string): { id: string; proseRel: string } {
  const s = store(dir);
  const id = s.put({ type: "memory", kind: "fact", body: BODY, title: "Portable" });
  s.revise(id, { body: BODY, title: "Portable, revised" });
  s.close();
  open.length = 0;
  return { id, proseRel: join("prose", "memories", `${id}.md`) };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("a copied store is self-contained — master-API tests (the pre-fix proof)", () => {
  test("(a) `cp -R` the store, DESTROY the source's prose, and the copy still reads its own", () => {
    const { id, proseRel } = seed(source);
    const copy = join(elsewhere, "store");
    cpSync(source, copy, { recursive: true });
    expect(existsSync(join(copy, proseRel))).toBe(true);

    // The one move that tells "reads the copy" from "reads the source": the
    // source's file is gone, and the copy's own file is untouched.
    rmSync(join(source, proseRel));
    expect(existsSync(join(source, proseRel))).toBe(false);

    const opened = store(copy);
    expect(opened.read(id).doc.body).toBe(BODY);
    expect(opened.read(id).doc.title).toBe("Portable, revised");
    // …and a version read resolves inside the copy too.
    expect(opened.readVersion(id, 1).title).toBe("Portable");
  });

  test("(b) an owner removal run in the COPY leaves the SOURCE's prose untouched", async () => {
    const { id, proseRel } = seed(source);
    const copy = join(elsewhere, "store");
    cpSync(source, copy, { recursive: true });
    const sourceBefore = proseFiles(source);
    const sourceBytes = readFileSync(join(source, proseRel), "utf8");
    const sourceVersions = readdirSync(paths.versionsFor(source, id));

    const c = consoleAnswering(id);
    const code = await run(["remove", id, "--confirm", "--dir", copy], { io: c.io });
    expect(c.err.join("\n")).toBe("");
    expect(code).toBe(EXIT.ok);

    // The copy's prose and archived versions are gone…
    expect(existsSync(join(copy, proseRel))).toBe(false);
    for (const v of sourceVersions) expect(existsSync(join(copy, "versions", id, v))).toBe(false);
    // …and the source has every file it had, byte for byte.
    expect(proseFiles(source)).toEqual(sourceBefore);
    expect(readFileSync(join(source, proseRel), "utf8")).toBe(sourceBytes);
    expect(readdirSync(paths.versionsFor(source, id))).toEqual(sourceVersions);
    const back = store(source);
    expect(back.read(id).doc.body).toBe(BODY);
  });

  test("(d) a `backup` snapshot opens standalone and reads its own prose after the source is gone", () => {
    const { id, proseRel } = seed(source);
    const s = store(source, { observer: true });
    const target = join(elsewhere, "snap");
    const report = snapshot(s, target);
    expect(report.ok).toBe(true);
    s.close();
    open.length = 0;

    // Wipe the SOURCE entirely: a restore is exactly the case where it is gone.
    rmSync(source, { recursive: true, force: true });
    expect(existsSync(join(target, proseRel))).toBe(true);

    const restored = store(target);
    expect(restored.read(id).doc.body).toBe(BODY);
    expect(restored.readVersion(id, 1).title).toBe("Portable");
    // The restored store is writable and keeps writing INSIDE itself.
    const more = restored.put({ type: "memory", kind: "fact", body: "written after restore" });
    expect(existsSync(join(target, "prose", "memories", `${more}.md`))).toBe(true);
    // Re-create the source dir so afterEach's rmSync has something harmless to remove.
    writeFileSync(join(elsewhere, ".keep"), "");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The v5 shape and the v4 → v5 migration. These use the API the fix added.
// ═══════════════════════════════════════════════════════════════════════════

/** Rewrite every path column to the ABSOLUTE form a pre-v5 build wrote, under `root`. */
function regressToV4(dir: string, root: string): { prose: number; versions: number } {
  const db = new Database(paths.operational(dir));
  const prose = db
    .prepare("SELECT id, prose_path AS p FROM memories WHERE prose_path <> ''")
    .all() as { id: string; p: string }[];
  for (const r of prose) db.run("UPDATE memories SET prose_path = ? WHERE id = ?", [join(root, r.p), r.id]);
  const versions = db
    .prepare("SELECT rowid AS k, path AS p FROM versions WHERE path <> ''")
    .all() as { k: number; p: string }[];
  for (const r of versions) db.run("UPDATE versions SET path = ? WHERE rowid = ?", [join(root, r.p), r.k]);
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '4')");
  db.close();
  return { prose: prose.length, versions: versions.length };
}

function pathColumns(dir: string): { prose: string[]; versions: string[] } {
  const db = new Database(paths.operational(dir), { readonly: true });
  const prose = (db.prepare("SELECT prose_path AS p FROM memories ORDER BY id").all() as { p: string }[]).map(
    (r) => r.p,
  );
  const versions = (
    db.prepare("SELECT path AS p FROM versions ORDER BY memory_id, seq").all() as { p: string }[]
  ).map((r) => r.p);
  db.close();
  return { prose, versions };
}

describe("the stored spelling is store-relative POSIX", () => {
  test("a fresh write records `prose/<family>/<id>.md`, and a revision `versions/<id>/<seq>-<hash>.md`", () => {
    const { id } = seed(source);
    const cols = pathColumns(source);
    expect(cols.prose).toEqual([stored.proseFile("memory", id)]);
    expect(cols.prose[0]).toBe(`prose/memories/${id}.md`);
    expect(cols.versions.length).toBe(1);
    expect(cols.versions[0]).toMatch(new RegExp(`^versions/${id}/0001-[0-9a-f]{16}\\.md$`));
    // Nothing stored is absolute, and nothing stored names the temp dir.
    for (const p of [...cols.prose, ...cols.versions]) {
      expect(p.startsWith("/")).toBe(false);
      expect(p.includes(source)).toBe(false);
    }
    // …and resolving it lands on the file that is actually there.
    const s = store(source, { observer: true });
    expect(s.absolutePath(cols.prose[0] as string)).toBe(paths.proseFile(source, "memory", id));
    expect(existsSync(s.absolutePath(cols.prose[0] as string))).toBe(true);
    expect(existsSync(s.absolutePath(cols.versions[0] as string))).toBe(true);
  });

  test("a blank pointer resolves to NOTHING — never to the store root", () => {
    // `join(dir, "")` is the store directory itself; handed to the removal
    // path's `existsSync` + `rmSync` that would be the worst address there is.
    expect(resolveStoredPath("/some/store", "")).toBe("");
    const s = store(source);
    expect(s.absolutePath("")).toBe("");
    expect(s.absolutePath("prose/memories/mem_x.md")).toBe(join(source, "prose", "memories", "mem_x.md"));
    // An absolute value — a pre-v5 row the migration could not place — is
    // returned as it is, so that row reads where it always read.
    expect(s.absolutePath("/elsewhere/not-a-store/file.md")).toBe("/elsewhere/not-a-store/file.md");
  });

  test("relativizeStoredPath: exact under the dir, the deepest prose/ or versions/ segment elsewhere, null when unplaceable", () => {
    const dir = "/Users/o/.counterparts/store";
    expect(relativizeStoredPath(dir, `${dir}/prose/memories/mem_a.md`)).toBe("prose/memories/mem_a.md");
    expect(relativizeStoredPath(dir, `${dir}/versions/mem_a/0001-abc.md`)).toBe("versions/mem_a/0001-abc.md");
    // Another spelling of the same store (macOS: /var vs /private/var), and a
    // backup restored somewhere else with rows that still name the old dir.
    expect(relativizeStoredPath(dir, "/private/var/folders/x/T/store/prose/memories/mem_b.md")).toBe(
      "prose/memories/mem_b.md",
    );
    expect(relativizeStoredPath(dir, "/old/machine/store/versions/mem_b/0002-def.md")).toBe(
      "versions/mem_b/0002-def.md",
    );
    // A store that itself lives under a directory called `prose` or `versions`
    // is keyed by the DEEPEST segment, which is the store-level one.
    expect(relativizeStoredPath(dir, "/home/prose/archive/store/prose/episodes/epi_c.md")).toBe(
      "prose/episodes/epi_c.md",
    );
    expect(relativizeStoredPath(dir, "/home/versions/store/prose/memories/mem_d.md")).toBe(
      "prose/memories/mem_d.md",
    );
    // Already relative: unchanged (idempotent). Blank: unchanged. Unplaceable: null.
    expect(relativizeStoredPath(dir, "prose/memories/mem_e.md")).toBe("prose/memories/mem_e.md");
    expect(relativizeStoredPath(dir, "")).toBe("");
    expect(relativizeStoredPath(dir, "/somewhere/else/mem_f.md")).toBeNull();
  });
});

describe("the v4 → v5 migration at open", () => {
  test("(c) rows holding ABSOLUTE paths — under this dir AND under another spelling of it — migrate at the first writer open, idempotently, and read", () => {
    const { id } = seed(source);
    // A second memory whose absolute path names a DIFFERENT root — the store as
    // a previous machine or a `/private/var` spelling recorded it. Only the
    // tail rule can place it.
    const s0 = store(source);
    const other = s0.put({ type: "memory", kind: "fact", body: "recorded under another spelling of this store" });
    s0.close();
    open.length = 0;
    const regressed = regressToV4(source, source);
    expect(regressed).toEqual({ prose: 2, versions: 1 });
    const db = new Database(paths.operational(source));
    db.run("UPDATE memories SET prose_path = ? WHERE id = ?", [
      `/private/var/some/other/spelling/store/prose/memories/${other}.md`,
      other,
    ]);
    db.close();
    const before = pathColumns(source);
    expect(before.prose.every((p) => p.startsWith("/"))).toBe(true);
    expect(before.versions.every((p) => p.startsWith("/"))).toBe(true);

    // The first WRITER open converts, in the migrate-at-open transaction…
    const migrated = store(source);
    expect(migrated.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    const after = pathColumns(source);
    expect([...after.prose].sort()).toEqual(
      [stored.proseFile("memory", id), stored.proseFile("memory", other)].sort(),
    );
    expect(after.versions[0]).toMatch(/^versions\//);
    // …reads resolve inside THIS store…
    expect(migrated.read(id).doc.body).toBe(BODY);
    expect(migrated.read(other).doc.body).toBe("recorded under another spelling of this store");
    expect(migrated.readVersion(id, 1).title).toBe("Portable");
    // …the census says so…
    expect(migrated.pathCensus()).toEqual({
      prose: { relative: 2, absolute: 0, missing: 0, blank: 0 },
      versions: { relative: 1, absolute: 0, missing: 0, blank: 0 },
    });
    // …and the conversion left a durable, counts-only record (constitution 16).
    const record = migrated.eventLog({ name: PATHS_MIGRATED_EVENT });
    expect(record.length).toBe(1);
    expect(JSON.parse(record[0]?.payload ?? "{}")).toEqual({
      from: "4",
      to: SCHEMA_VERSION,
      prose: { converted: 2, unplaceable: 0 },
      versions: { converted: 1, unplaceable: 0 },
    });
    expect(record[0]?.payload ?? "").not.toContain(source);
    migrated.close();
    open.length = 0;

    // IDEMPOTENT: a second open writes nothing — the database is byte-identical.
    const bytes = readFileSync(paths.operational(source));
    store(source).close();
    open.length = 0;
    expect(readFileSync(paths.operational(source))).toEqual(bytes);
    expect(store(source).eventLog({ name: PATHS_MIGRATED_EVENT }).length).toBe(1);
  });

  test("a v4 copy opened as an OBSERVER reads without converting; `verify` shows the absolute count read-only", async () => {
    const { id } = seed(source);
    regressToV4(source, source);
    const bytes = readFileSync(paths.operational(source));

    const observer = store(source, { observer: true });
    expect(observer.getMeta("schemaVersion")).toBe(String(OBSERVER_READ_FLOOR));
    expect(observer.read(id).doc.body).toBe(BODY);
    expect(observer.pathCensus()).toEqual({
      prose: { relative: 0, absolute: 1, missing: 0, blank: 0 },
      versions: { relative: 0, absolute: 1, missing: 0, blank: 0 },
    });
    observer.close();
    open.length = 0;
    expect(readFileSync(paths.operational(source))).toEqual(bytes);

    const c = consoleAnswering("");
    expect(await run(["verify", "--dir", source], { io: c.io })).toBe(EXIT.ok);
    const out = c.out.join("\n");
    expect(out).toContain("Prose paths: 0 relative, 1 absolute (unmigrated), 0 missing files");
    expect(out).toContain("Version paths: 0 relative, 1 absolute (unmigrated), 0 missing files");
    expect(out).toContain("store schema v4: absolute paths are converted to relative at the next WRITER open");
    expect(readFileSync(paths.operational(source))).toEqual(bytes);

    // After a writer open the same command reads the converted state.
    store(source).close();
    open.length = 0;
    const d = consoleAnswering("");
    expect(await run(["verify", "--dir", source], { io: d.io })).toBe(EXIT.ok);
    expect(d.out.join("\n")).toContain("Prose paths: 1 relative, 0 absolute (unmigrated), 0 missing files");
    expect(d.out.join("\n")).not.toContain("store schema v4");
  });

  test("a row the migration cannot place is LEFT and counted, and a missing file is a separate count", () => {
    const { id, proseRel } = seed(source);
    const s0 = store(source);
    const stray = s0.put({ type: "memory", kind: "fact", body: "a pointer with no prose/ segment" });
    s0.close();
    open.length = 0;
    regressToV4(source, source);
    const db = new Database(paths.operational(source));
    db.run("UPDATE memories SET prose_path = ? WHERE id = ?", ["/nowhere/at/all/file.md", stray]);
    db.close();
    rmSync(join(source, proseRel));

    const migrated = store(source);
    // The stray row keeps its absolute pointer (unmigrated, counted) and the
    // placed row whose file is gone is counted as missing — two different facts.
    expect(migrated.pathCensus().prose).toEqual({ relative: 1, absolute: 1, missing: 2, blank: 0 });
    expect(migrated.row(stray)?.prose_path).toBe("/nowhere/at/all/file.md");
    expect(migrated.row(id)?.prose_path).toBe(stored.proseFile("memory", id));
    const record = migrated.eventLog({ name: PATHS_MIGRATED_EVENT });
    expect(JSON.parse(record[0]?.payload ?? "{}")).toMatchObject({
      prose: { converted: 1, unplaceable: 1 },
    });
  });

  test("a removed row's blanked pointers are untouched by the migration and counted as blank", async () => {
    const { id } = seed(source);
    const c = consoleAnswering(id);
    expect(await run(["remove", id, "--confirm", "--dir", source], { io: c.io })).toBe(EXIT.ok);
    regressToV4(source, source); // touches only non-blank rows
    const migrated = store(source);
    expect(migrated.row(id)?.prose_path).toBe("");
    expect(migrated.pathCensus().prose).toEqual({ relative: 0, absolute: 0, missing: 0, blank: 1 });
    expect(migrated.eventLog({ name: PATHS_MIGRATED_EVENT })).toEqual([]);
  });
});
