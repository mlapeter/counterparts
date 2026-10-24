/**
 * A REPLAY CORPUS FROM A SNAPSHOT (2026-10-22, `harness corpus`): the newest
 * (or a named) daily snapshot's database, copied out of
 * `~/.counterparts/snapshots/` into `~/counterparts-backups/`, so a replay has
 * a corpus without anyone typing a `cp` next to the live store.
 *
 * What it touches under `~/.counterparts`: a directory listing of
 * `snapshots/` and one file copy out of it. Nothing there is opened as a
 * database, and nothing is written there. The source must sit inside the
 * snapshots folder; anything else, the live store's own file above all, is
 * refused by name. The copy lands under a temp name in the target folder, is
 * checked byte for byte against the source, made read-only, and only then
 * renamed into place, so a half copy never looks like a corpus. Its counts
 * (the schema, the build that last opened it, beliefs, tags, subjects) are
 * read from the copy, read-only.
 *
 * The replay's own refusal of `~/.counterparts` (`source.ts#underLiveRoot`)
 * is unchanged: a replay still reads only a copy.
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { parseBuildLog } from "../../src/core/store/index.js";
import { liveRoot } from "./source.js";

/** The database a snapshot folder holds (`cli/snapshot.ts` copies `Store.backupSet()`). */
export const SNAPSHOT_DB = "counterparts.sqlite";

/** A snapshot folder's name: the daily one (`snapshotName`) or the store's pre-migration copy. Its first 24 characters are the instant. */
const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-pre-migration-v[0-9A-Za-z]+-to-v[0-9A-Za-z]+)?$/;

export class CorpusError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "CorpusError";
    this.code = code;
  }
}

export interface CorpusOptions {
  /** One snapshot folder (or its `counterparts.sqlite`); absent, the newest in `snapshots`. */
  readonly from?: string;
  /** The snapshots folder. Default: `~/.counterparts/snapshots`. */
  readonly snapshots?: string;
  /** Where the corpus folder is made. Default: `~/counterparts-backups`. */
  readonly out?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface CorpusCounts {
  readonly memories: number;
  readonly archived: number;
  /** Live beliefs (`birth_route` set, v14); null when the store has no such column. */
  readonly beliefs: number | null;
  /** `belief_support` rows (v14); null before v14. */
  readonly beliefSupport: number | null;
  /** `memory_tags` rows and distinct tags (v14); null before v14. */
  readonly tags: number | null;
  readonly distinctTags: number | null;
  /** `memory_subjects` rows (v13+), and the cards that carry a kind of subject (v14). */
  readonly subjectLinks: number | null;
  readonly subjectCards: number | null;
}

export interface CorpusRecord {
  readonly snapshot: string;
  readonly path: string;
  readonly bytes: number;
  readonly schemaVersion: number;
  readonly livedDay: number;
  /** The newest build in the store's build log, or null when it keeps none. */
  readonly build: string | null;
  readonly counts: CorpusCounts;
}

/** A path with its symlinks resolved, as far as it exists. */
function real(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) break;
    tail.unshift(basename(head));
    head = up;
  }
  return join(existsSync(head) ? realpathSync(head) : head, ...tail);
}

const inside = (child: string, parent: string): boolean => child.startsWith(parent + "/");

/** The newest snapshot folder in `dir` holding a database; half copies (`.partial-…`) and other names are passed over. */
export function newestSnapshot(dir: string): string {
  if (!existsSync(dir)) throw new CorpusError("CORPUS_NO_SNAPSHOTS", `${dir} does not exist`);
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SNAPSHOT_NAME_RE.test(e.name) && existsSync(join(dir, e.name, SNAPSHOT_DB)))
    .map((e) => e.name)
    // The instant first; at the same instant, the daily copy before a pre-migration one.
    .sort((a, b) => (a.slice(0, 24) === b.slice(0, 24) ? a.length - b.length : a < b ? -1 : 1));
  const last = names[names.length - 1];
  if (last === undefined) throw new CorpusError("CORPUS_NO_SNAPSHOTS", `no snapshot in ${dir}`);
  return join(dir, last);
}

/** The source file, refused unless it is a snapshot's database inside the snapshots folder. */
export function resolveSource(o: CorpusOptions): { readonly folder: string; readonly file: string } {
  const env = o.env ?? process.env;
  const root = liveRoot(env);
  const snapshots = real(o.snapshots ?? join(root, "snapshots"));
  const picked = o.from === undefined ? newestSnapshot(snapshots) : resolve(o.from);
  const file = real(basename(picked) === SNAPSHOT_DB ? picked : join(picked, SNAPSHOT_DB));
  const liveStore = real(join(root, "store"));
  if (file === liveStore || inside(file, liveStore)) throw new CorpusError("CORPUS_IS_LIVE", "that is the live store; a corpus is copied from a snapshot only");
  if (!inside(file, snapshots)) throw new CorpusError("CORPUS_NOT_A_SNAPSHOT", `${file} is not inside ${snapshots}`);
  const folder = dirname(file);
  // One folder directly inside the snapshots folder, named as a snapshot is named.
  if (dirname(folder) !== snapshots || !SNAPSHOT_NAME_RE.test(basename(folder))) throw new CorpusError("CORPUS_NOT_A_SNAPSHOT", `${folder} is not a snapshot folder of ${snapshots}`);
  if (!existsSync(file)) throw new CorpusError("CORPUS_MISSING", file);
  for (const side of ["-wal", "-shm", "-journal"]) {
    if (existsSync(`${file}${side}`)) throw new CorpusError("CORPUS_NOT_ONE_FILE", `${file} has a ${side.slice(1)} file beside it; a snapshot is one file`);
  }
  return { folder, file };
}

/** Refuse a path the corpus would write (its folder, its record) under the live root. */
export function assertOutsideLive(path: string, what: string, env: NodeJS.ProcessEnv = process.env): void {
  const target = real(path);
  const root = real(liveRoot(env));
  if (target === root || inside(target, root)) throw new CorpusError("CORPUS_WRITES_LIVE", `${what} goes outside ~/.counterparts (${target})`);
}

function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The counts, from a database opened read-only. A table or column a schema doesn't have reads as null. */
export function readCorpus(path: string): Omit<CorpusRecord, "snapshot" | "path" | "bytes"> {
  const db = new Database(path, { readonly: true });
  try {
    const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const columns = new Set((db.query("PRAGMA table_info(memories)").all() as { name: string }[]).map((r) => r.name));
    const n = (sql: string): number => Number((db.query(sql).get() as { n: number } | null)?.n ?? 0);
    const meta = new Map((db.query("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const log = parseBuildLog((db.query("SELECT key, value FROM meta WHERE key LIKE 'build.%' ORDER BY rowid").all() as { key: string; value: string }[]));
    const LIVE = "type = 'memory' AND archived = 0";
    return {
      schemaVersion: Number(meta.get("schemaVersion") ?? "0"),
      livedDay: Number(meta.get("livedDay") ?? "0"),
      build: log.length === 0 ? null : log[log.length - 1]!.build,
      counts: {
        memories: n(`SELECT COUNT(*) AS n FROM memories WHERE ${LIVE}`),
        archived: n("SELECT COUNT(*) AS n FROM memories WHERE type = 'memory' AND archived = 1"),
        // A belief is a schema row (`type = 'schema'`) with a birth route — counted whatever its type (10-24: `LIVE` read 0).
        beliefs: columns.has("birth_route") ? n("SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND birth_route IS NOT NULL") : null,
        beliefSupport: tables.has("belief_support") ? n("SELECT COUNT(*) AS n FROM belief_support") : null,
        tags: tables.has("memory_tags") ? n("SELECT COUNT(*) AS n FROM memory_tags") : null,
        distinctTags: tables.has("memory_tags") ? n("SELECT COUNT(DISTINCT tag) AS n FROM memory_tags") : null,
        subjectLinks: tables.has("memory_subjects") ? n("SELECT COUNT(*) AS n FROM memory_subjects") : null,
        subjectCards: columns.has("subject_kind") ? n("SELECT COUNT(*) AS n FROM memories WHERE archived = 0 AND subject_kind IS NOT NULL") : null,
      },
    };
  } finally {
    db.close();
  }
}

/** The corpus folder's name: the snapshot's date, the schema, and the build when the store logs one. Pure. */
export function corpusName(snapshot: string, schemaVersion: number, build: string | null): string {
  const safe = build === null ? null : build.replace(/[^0-9A-Za-z.+-]/g, "_");
  return `${snapshot.slice(0, 10)}-corpus-v${String(schemaVersion)}${safe === null ? "" : `-${safe}`}`;
}

/** Copy the snapshot out, check it, name it, and read its counts. */
export function makeCorpus(o: CorpusOptions = {}): CorpusRecord {
  const env = o.env ?? process.env;
  const { folder, file } = resolveSource(o);
  const outRoot = real(o.out ?? join(env["HOME"] ?? homedir(), "counterparts-backups"));
  assertOutsideLive(outRoot, "the corpus", env);
  mkdirSync(outRoot, { recursive: true });
  const temp = join(outRoot, `.partial-corpus-${String(process.pid)}-${String(Date.now())}`);
  mkdirSync(temp);
  try {
    const copy = join(temp, SNAPSHOT_DB);
    copyFileSync(file, copy);
    if (hashOf(copy) !== hashOf(file)) throw new CorpusError("CORPUS_COPY_DIFFERS", "the copy is not the snapshot byte for byte; nothing kept");
    chmodSync(copy, 0o444);
    const read = readCorpus(copy);
    const snapshot = basename(folder);
    const dest = join(outRoot, corpusName(snapshot, read.schemaVersion, read.build));
    if (existsSync(dest)) throw new CorpusError("CORPUS_EXISTS", `${dest} is already there; remove it or name another --out`);
    renameSync(temp, dest);
    const path = join(dest, SNAPSHOT_DB);
    return { snapshot, path, bytes: statSync(path).size, ...read };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** The record as lines: where it went, and whether it is worth replaying. */
export function renderCorpus(r: CorpusRecord): string {
  const c = r.counts;
  const v = (x: number | null, what: string): string => (x === null ? `${what} none (not kept before v14)` : `${what} ${String(x)}`);
  const out = [
    `corpus: ${r.path}`,
    `  from snapshot ${r.snapshot} · schema v${String(r.schemaVersion)} · build ${r.build ?? "(the store logs none)"} · lived day ${String(r.livedDay)} · ${(r.bytes / 1e6).toFixed(1)} MB`,
    `  memories ${String(c.memories)} live, ${String(c.archived)} archived`,
    `  ${v(c.beliefs, "beliefs")} · ${v(c.beliefSupport, "support rows")}`,
    `  ${v(c.tags, "tag rows")} · ${v(c.distinctTags, "distinct tags")}`,
    `  ${v(c.subjectLinks, "subject links")} · ${v(c.subjectCards, "subject cards")}`,
  ];
  if ((c.beliefs ?? 0) === 0) out.push("  no beliefs yet: a replay of beliefs or support has nothing to read here");
  out.push(`  replay it: bun tools/harness/cli.ts replay --source ${r.path}`);
  return out.join("\n");
}
