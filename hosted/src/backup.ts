/**
 * BACKUPS, AND DELETE AT ONCE (OL2 step 5; design §5.3, §5.4 as Mike changed
 * it on 2026-10-26).
 *
 * WHAT LEAVES THE HOST, and under what key:
 *
 *   - **Each store's `counterparts.sqlite`**, streamed by the Litestream
 *     sidecar to `r2://<bucket>/tenants/<storeId>/` under an SSE-C key derived
 *     from that store's DEK (`keys.ts#litestreamKey`), written 0600 beside the
 *     store as `litestream.key`. Only box 2: `cache/` is rebuildable, and
 *     `journal/` and `spans/` are never backed up (`store/paths.ts#LAYOUT`).
 *   - **The control databases** (`control/accounts.sqlite`, `control/oauth.sqlite`),
 *     to `r2://<bucket>/control/<name>/`, under the SSE-C key of a DEK kept for
 *     the pseudo-store `control`.
 *   - **Each wrapped DEK, ONCE**, as its own object `keys/<storeId>.wrapped`,
 *     written at sign-up and re-written only by a rewrap (KEK rotation). No
 *     keys.sqlite backup, no daily copies: R2 versioning and object lock stay
 *     OFF for `keys/` (the runbook's bucket setting), so a delete is a delete.
 *
 * DELETE (`removeStore`), all of it at once: the store leaves the sidecar's
 * configuration (and the sidecar restarts), its key file goes, its wrapped-key
 * object goes, and its whole replica prefix goes. Even a copy someone kept of
 * the bucket is ciphertext under a key that no longer exists anywhere.
 *
 * The sidecar's R2 credentials come from its environment (Litestream reads
 * `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`); the
 * configuration file holds no secret, only paths.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { DATABASE_FILE } from "../../src/core/store/paths.js";
import type { ObjectStore } from "./egress.js";
import type { KeyStore } from "./keys.js";
import { litestreamKey } from "./keys.js";
import { RESTORED_MARKER, STORE_ID, tenantDir } from "./tenants.js";

/** The pseudo-store whose DEK keys the control databases' backups. */
export const CONTROL_KEY_ID = "control";
export const CONTROL_DATABASES = ["accounts.sqlite", "oauth.sqlite"] as const;

/** Litestream snapshot interval and retention, in hours (see `config()`): the "purged within 24 h" bound's margin. */
export const SNAPSHOT_HOURS = 12;

export const keyObject = (storeId: string): string => `keys/${storeId}.wrapped`;
/**
 * A DELETE'S TOMBSTONE in the bucket (the #653 review, M1): the store id and the
 * time, no PII, written BEFORE the key object goes and never removed. A control
 * database restored from before the delete (the sidecar was down when it ran)
 * would bring the account back active, with its email; start-up finds the
 * tombstone and finishes the delete instead.
 */
export const tombstoneObject = (storeId: string): string => `deleted/${storeId}`;
export const replicaPrefix = (storeId: string): string => `tenants/${storeId}/`;

/** The refusal when the bucket's control key is another DEK than this volume's. */
export const CONTROL_KEY_DIFFERS =
  "the bucket's control key is a different key from this volume's (keys/keys.sqlite): a start against another bucket (a wrong R2_BUCKET or R2_ENDPOINT, after keys/keys.sqlite was lost: by a build before R7, or before anyone had signed up) made this volume a new one. The way back: remove keys/ from the volume (rm -rf /data/keys on Railway), then deploy once with CONTROL_ASIDE=<new label> and RESTORE_ON_BOOT=1 (docs/hosted/RUNBOOK.md, If a start refuses).";

/** A store that was opened before has no key on this volume and none in the bucket. */
export class StoreKeyMissing extends Error {
  constructor() {
    super("a store that was opened before has no key here and none in the bucket: it is not backed up until that is resolved");
    this.name = "StoreKeyMissing";
  }
}

/** One `litestream <args>` run, to its exit: the restore command's seam (a stand-in binary in tests). */
export type LitestreamRun = (args: string[]) => Promise<{ code: number; stderr: string }>;

/** The real runner: the binary, with only the given environment (the R2 credentials and PATH). */
export function litestreamRunner(binary: string, env: Record<string, string>): LitestreamRun {
  return (args) =>
    new Promise((done) => {
      let stderr = "";
      const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], env });
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString("utf8")).slice(-4000);
      });
      child.once("error", (err) => done({ code: 127, stderr: err.message }));
      child.once("close", (code) => done({ code: code ?? 1, stderr }));
    });
}

export interface Sidecar {
  /** Running, or restarting on purpose (a reload): readiness. Absent ⇒ assumed up (a stub). */
  up?(): boolean;
  /**
   * Start, or restart with the configuration as it now is. Resolves once the
   * previous child has EXITED (its last upload done) and the new one started:
   * a delete waits on it before it removes the store's objects, or a final
   * sync from the old child could land in R2 after the prefix was cleared.
   */
  reload(): void | Promise<void>;
  stop(): Promise<void>;
}

export interface BackupsOptions {
  readonly dataRoot: string;
  readonly keys: KeyStore;
  readonly objects: ObjectStore;
  /** For the Litestream configuration. */
  readonly bucket: string;
  readonly endpoint: string;
  /** Null: no sidecar (tests, local runs). */
  readonly sidecar?: Sidecar | null;
  /** The store ids that are live now (from accounts), for `ensureAll`. */
  readonly liveStores: () => string[];
  /** Was this store ever opened (accounts' `opened_at`)? A store that was and has no key anywhere gets a new one only by `ensureAll`'s checks. Absent ⇒ never. */
  readonly openedBefore?: (storeId: string) => boolean;
  /**
   * Is this live store locked by a pending delete (R6)? It stays backed up and
   * its key is adopted from the bucket on a new volume, but `ensureAll` NEVER
   * gives it a new key: a store set to be erased is not re-keyed. Absent ⇒ never.
   */
  readonly locked?: (storeId: string) => boolean;
  /** When it was first opened (accounts' `opened_at`, ms), for `ensureAll`'s mint. Absent ⇒ unknown, and nothing is minted. */
  readonly openedAt?: (storeId: string) => number | null;
  /**
   * What `ensureAll` did with a store that lived and has no key anywhere: made
   * it one (`minted`, called right after the key exists, before its upload), or
   * why not. The app audits it and logs it by tag.
   */
  readonly onKeyless?: (storeId: string, outcome: "minted" | KeylessReason) => void;
}

/**
 * WHY A STORE THAT LIVED WITH NO KEY ANYWHERE WAS NOT GIVEN ONE (R5), each a
 * condition of the mint that failed. A fixed vocabulary: it goes into the log
 * and the audit, never free text.
 *
 *   - `no-database`: its database isn't on this volume (it waits for a restore);
 *   - `replica-in-bucket`: the bucket holds replica objects of it, under a key
 *     that is gone (a new key would bury them);
 *   - `tombstone`: the bucket has its tombstone (it was deleted);
 *   - `bucket-unproven`: the bucket had no control key before this start, so it
 *     isn't proven to be this volume's (a new or a different bucket);
 *   - `keys-newer`: this volume's `keys.sqlite` was made after the store was
 *     first opened (it was rebuilt), so a key of it may have existed before;
 *   - `bucket-unreadable`: a check's request to the bucket failed;
 *   - `locked` (R6): its account is set to be deleted. A store set to be erased
 *     is never re-keyed; it is checked BEFORE `ensureStore`, so it never reaches
 *     the mint (`ensureAll`).
 */
export type KeylessReason = "no-database" | "replica-in-bucket" | "tombstone" | "bucket-unproven" | "keys-newer" | "bucket-unreadable" | "locked";
export const KEYLESS_REASONS: readonly KeylessReason[] = ["no-database", "replica-in-bucket", "tombstone", "bucket-unproven", "keys-newer", "bucket-unreadable", "locked"];

function yamlString(s: string): string {
  return JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar
}

export class Backups {
  readonly configPath: string;
  private readonly opts: BackupsOptions;

  constructor(opts: BackupsOptions) {
    this.opts = opts;
    this.configPath = join(opts.dataRoot, "litestream.yml");
  }

  private tenantsRoot(): string {
    return join(this.opts.dataRoot, "tenants");
  }

  private keyFile(storeId: string): string {
    return storeId === CONTROL_KEY_ID ? join(this.opts.dataRoot, "control", "litestream.key") : join(tenantDir(this.tenantsRoot(), storeId), "litestream.key");
  }

  /** Write the store's SSE-C key file (0600) from its DEK. */
  private async writeKeyFile(storeId: string): Promise<void> {
    const dek = await this.opts.keys.dek(storeId);
    const file = this.keyFile(storeId);
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${litestreamKey(dek)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    dek.fill(0);
  }

  /**
   * Make sure a store is backed up: it has a DEK (made now if not), its key
   * file, its one wrapped-key object, and a place in the sidecar's
   * configuration. Idempotent — sign-up calls it, and so does start-up for
   * every live store, so a step that failed once is finished later.
   */
  async ensureStore(storeId: string, opts: { reload?: boolean } = {}): Promise<void> {
    if (storeId !== CONTROL_KEY_ID && !STORE_ID.test(storeId)) throw new Error("not a store id");
    // THE BUCKET'S KEY IS NEVER OVERWRITTEN BY A NEW ONE (OL2b). `keys.sqlite`
    // is not replicated, so on a new volume (or after losing that file) a store
    // has no key here while its backup in R2 is encrypted under the key in
    // `keys/<id>.wrapped`. Minting a fresh DEK and putting it over that object
    // would make every byte of the backup unreadable, for good. So: a key the
    // bucket has is adopted (`KeyStore.adopt`); a new key is made only when
    // neither side has one; and when both have one, the bucket's must be the
    // same DEK (a rewrap's new wrapping) before the local one replaces it.
    const remote = await this.opts.objects.get(keyObject(storeId));
    let wrapped = this.opts.keys.wrapped(storeId);
    let adopted = false;
    if (wrapped === null && remote !== null) {
      adopted = await this.opts.keys.adopt(storeId, await this.readable(storeId, remote));
      wrapped = remote;
    }
    if (wrapped === null && storeId !== CONTROL_KEY_ID && this.opts.openedBefore?.(storeId) === true) {
      // A store that lived, with no key here and none in the bucket: its key may
      // have been lost, and a new one would hide that and make any copy of it
      // unreadable. Never minted here (sign-up, a first open, a restore): only
      // `ensureAll` at start-up mints one, after checking nothing can be buried.
      throw new StoreKeyMissing();
    }
    wrapped ??= await this.opts.keys.create(storeId);
    if (adopted || !existsSync(this.keyFile(storeId))) await this.writeKeyFile(storeId);
    if (remote !== wrapped) {
      if (remote !== null) {
        const checked = await this.readable(storeId, remote);
        try {
          await this.opts.keys.adopt(storeId, checked); // throws on a different DEK
        } catch (err) {
          // The control key, said as such (the #658 review): after a start against
          // a wrong, empty bucket made this volume a new one, "a different key for
          // that store" misleads. The RUNBOOK's way back is named.
          if (storeId === CONTROL_KEY_ID) throw new Error(CONTROL_KEY_DIFFERS);
          throw err;
        }
      }
      await this.opts.objects.put(keyObject(storeId), wrapped);
    }
    if (opts.reload !== false) await this.reload();
  }

  /** The bucket's wrapped key, checked to open under the ring for this store (a refusal that says what to do, never a key). */
  private async readable(storeId: string, remote: string): Promise<string> {
    try {
      (await this.opts.keys.unwrapForCheck(storeId, remote)).fill(0);
    } catch {
      throw new Error("a store's key object in the bucket doesn't open with the KEK ring: put the old version back in the ring and run rewrap again.");
    }
    return remote;
  }

  /**
   * Start-up: every wrapped DEK must open with the ring as it is now (a KEK
   * version dropped before a rewrap finished would otherwise go unnoticed until
   * a restore), then the control key and every live store, then one reload.
   *
   * A STORE THAT LIVED WITH NO KEY ANYWHERE gets one here, and only here, when
   * nothing a new key could bury exists (R5; `mintRefusal`). It runs only at
   * start-up, before any sidecar (`hold`), so no replica of it can appear
   * between the checks and the mint. Anything else is left out of the backups
   * (and said so), never allowed to stop every other person's start.
   */
  async ensureAll(opts: { reload?: boolean } = {}): Promise<{ keyless: number; minted: number }> {
    const unreadable = await this.opts.keys.unreadable();
    if (unreadable.length > 0) throw new Error(`${String(unreadable.length)} wrapped store keys don't open with the KEK ring: put the old version back in the ring and run rewrap again.`);
    // (f) THE BUCKET IS THIS VOLUME'S: it held the control key BEFORE this start.
    // Read before `ensureStore(control)`, which puts the local key into a bucket
    // that has none; past it, the bucket's key was adopted (a new volume) or
    // proven the same DEK as this volume's (a different one throws).
    const bucketProven = (await this.opts.objects.get(keyObject(CONTROL_KEY_ID))) !== null;
    await this.ensureStore(CONTROL_KEY_ID, { reload: false });
    // The control key is in this bucket now (adopted, proven or put): a later
    // start beside a bucket without it is no longer "a turn-on cut short" (R7).
    this.opts.keys.recordFact("control-key-in-bucket");
    let keyless = 0;
    let minted = 0;
    for (const id of this.opts.liveStores()) {
      // A locked store (a delete pending) with no key here and none in the
      // bucket is never handed to `ensureStore`, which would make one: it is
      // counted keyless and left as it is until its erase or its keep (R6).
      if (this.opts.locked?.(id) === true && this.opts.keys.wrapped(id) === null && (await this.opts.objects.get(keyObject(id))) === null) {
        keyless += 1;
        this.opts.onKeyless?.(id, "locked");
        continue;
      }
      try {
        await this.ensureStore(id, { reload: false });
      } catch (err) {
        if (!(err instanceof StoreKeyMissing)) throw err;
        const refusal = await this.mintRefusal(id, bucketProven);
        if (refusal !== null) {
          keyless += 1;
          this.opts.onKeyless?.(id, refusal);
          continue;
        }
        // The key file is written whatever is there: one left from a key that is
        // gone would put the replica under an SSE-C key nobody holds.
        await this.opts.keys.create(id);
        await this.writeKeyFile(id);
        this.opts.onKeyless?.(id, "minted");
        await this.ensureStore(id, { reload: false }); // the key object's one upload
        minted += 1;
      }
    }
    if (opts.reload !== false) await this.reload();
    return { keyless, minted };
  }

  /**
   * THE MINT'S CONDITIONS (R5; the #655 review's list), for a store that
   * `ensureStore` found with no key here (a) and none in the bucket, by a GET
   * that answered "no such key" and didn't throw (b). Null when every one holds:
   *
   *   (e) its database file is here: live, and unbacked;
   *   (c) the bucket's LIST of its replica prefix answered, and empty;
   *   (d) the bucket has no tombstone for it;
   *   (f) the bucket held the control key before this start;
   *   (f2) this volume's control key is older than the store's first open, so
   *        `keys.sqlite` wasn't rebuilt since it lived (a lost `keys.sqlite`
   *        pointed at a new bucket for two starts would pass (f) on the second).
   *
   * Every key a store can have is made or adopted in `keys.sqlite`, and every
   * replica of it is written under one: so with (a)–(f2), no copy of it anywhere
   * is under a key that is gone, and a new key buries nothing.
   *
   * A STORE OPENED BEFORE BACKUPS WERE TURNED ON (R7; `keys.sqlite`'s
   * `backups-turned-on`, written by the NEW_BUCKET start of a volume that ran
   * with BACKUPS=off) has (f) and (f2) waived, at that start and every later
   * one: it never had a key anywhere, and both checks are newer than it by
   * construction. (c), (d) and (e) still hold it back. The fact lives in
   * `keys.sqlite`, so a volume that lost that file loses the waiver with it.
   */
  private async mintRefusal(storeId: string, bucketProven: boolean): Promise<KeylessReason | null> {
    if (this.opts.keys.wrapped(storeId) !== null) throw new Error("a store with a key here reached the mint"); // (a): ensureStore's invariant
    if (!existsSync(this.dbPaths(storeId)[0]!)) return "no-database";
    try {
      if ((await this.opts.objects.list(replicaPrefix(storeId))).length > 0) return "replica-in-bucket";
      if ((await this.opts.objects.get(tombstoneObject(storeId))) !== null) return "tombstone";
    } catch {
      return "bucket-unreadable";
    }
    const opened = this.opts.openedAt?.(storeId) ?? null;
    const turnedOn = this.opts.keys.fact("backups-turned-on");
    if (turnedOn !== null && opened !== null && opened < turnedOn) return null;
    if (!bucketProven) return "bucket-unproven";
    const keysMade = this.opts.keys.createdAt(CONTROL_KEY_ID);
    if (keysMade === null || opened === null || keysMade >= opened) return "keys-newer"; // equal refuses too (the #658 review)
    return null;
  }

  /** After a rewrap: the moved stores' objects carry the new wrapping (an overwrite; versioning is off). */
  async reuploadKeys(storeIds: readonly string[]): Promise<void> {
    for (const id of storeIds) {
      const wrapped = this.opts.keys.wrapped(id);
      if (wrapped !== null) await this.opts.objects.put(keyObject(id), wrapped);
    }
  }

  /**
   * Every live store's (and the control key's) R2 object made equal to its
   * wrapped DEK here. `rewrap` ends with this rather than with only the stores
   * it moved, so a rewrap that died between its database writes and its
   * uploads is repaired by simply running it again. Returns how many were put.
   */
  async syncKeyObjects(): Promise<number> {
    let put = 0;
    for (const id of [CONTROL_KEY_ID, ...this.opts.liveStores()]) {
      const wrapped = this.opts.keys.wrapped(id);
      if (wrapped === null || (await this.opts.objects.get(keyObject(id))) === wrapped) continue;
      await this.opts.objects.put(keyObject(id), wrapped);
      put += 1;
    }
    return put;
  }

  /**
   * DELETE AT ONCE: the local wrapped DEK (so the configuration, written from
   * the key store, no longer has this store), then out of the sidecar — WAITING
   * for the old Litestream child to exit, so nothing it flushes on the way out
   * lands after the prefix delete — then the key file, the wrapped-key object
   * and the replica prefix. Every step is idempotent: a delete that died
   * part-way is finished by running it again. The tenant dir itself is the
   * caller's to remove (after its handle is closed). Returns how many replica
   * objects went.
   */
  async removeStore(storeId: string): Promise<number> {
    if (!STORE_ID.test(storeId)) throw new Error("not a store id");
    await this.opts.objects.put(tombstoneObject(storeId), `${new Date(Date.now()).toISOString()}\n`);
    this.opts.keys.delete(storeId);
    await this.reload();
    rmSync(this.keyFile(storeId), { force: true });
    await this.opts.objects.delete(keyObject(storeId));
    return this.opts.objects.deletePrefix(replicaPrefix(storeId));
  }

  /** The database files one backup id covers: the two control databases, or a store's one file. */
  dbPaths(id: string): string[] {
    if (id === CONTROL_KEY_ID) return CONTROL_DATABASES.map((db) => join(this.opts.dataRoot, "control", db));
    if (!STORE_ID.test(id)) throw new Error("not a store id");
    return [join(tenantDir(this.tenantsRoot(), id), "store", DATABASE_FILE)];
  }

  /**
   * RESTORE ONE BACKUP ID (a store, or `control`) FROM THE BUCKET (OL2b).
   * Run with no sidecar replicating these files: the CLI with the server
   * stopped, or start-up before the sidecar starts (`RESTORE_ON_BOOT`).
   *
   *   1. its key: adopted from `keys/<id>.wrapped` when this volume has none
   *      (`ensureStore`), the key file written, the configuration rewritten;
   *      refused when the bucket has no key object and this volume no key (a
   *      new key would restore nothing, and would replace the record);
   *   2. each database: `litestream restore -config <yml> -o <file>.restoring
   *      -if-replica-exists <file>`, which reads the SSE-C key from the
   *      configuration (a replica URL can't carry one), then the stale
   *      `-wal`/`-shm` go and the restored file is moved into place.
   *
   * A database already in place is refused unless `force` (the drill, or a
   * corrupt file being replaced). A replica that doesn't exist yet (a store
   * signed up and never written) is counted `empty`, not an error.
   */
  async restore(id: string, run: LitestreamRun, opts: { force?: boolean; missingOnly?: boolean } = {}): Promise<{ restored: number; empty: number; kept: number }> {
    const all = this.dbPaths(id);
    // `missingOnly`: the control databases one by one (a control restore cut
    // short after its first file must not leave the second to be made empty).
    const paths = opts.missingOnly === true ? all.filter((p) => !existsSync(p)) : all;
    if (!opts.force) {
      const there = paths.filter((p) => existsSync(p));
      if (there.length > 0) throw new Error(`${String(there.length)} of its database files are already in place: move them aside first (or --force).`);
    }
    if (this.opts.keys.wrapped(id) === null && (await this.opts.objects.get(keyObject(id))) === null) {
      throw new Error("the bucket has no key object for that id, and this volume has no key: there is nothing to restore it with.");
    }
    await this.ensureStore(id, { reload: false });
    // The store being restored is in this configuration even though its file is missing (`config`'s skip).
    writeFileSync(this.configPath, this.config(id), { mode: 0o600 });
    let restored = 0;
    let empty = 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const out = `${path}.restoring`;
      for (const f of [out, `${out}-wal`, `${out}-shm`]) rmSync(f, { force: true });
      const r = await run(["restore", "-config", this.configPath, "-o", out, "-if-replica-exists", path]);
      if (r.code !== 0) throw new Error(`litestream restore exited ${String(r.code)}: ${r.stderr.trim().split("\n").slice(-2).join(" / ").slice(0, 300)}`);
      if (!existsSync(out)) {
        empty += 1;
        continue;
      }
      // A file in place (`--force`) is moved aside, never deleted: the replica
      // may be behind it (`/readyz` doesn't see lag yet). Litestream's own
      // position for the old file (`.<name>-litestream`) goes: it describes a
      // database that is no longer there.
      if (id !== CONTROL_KEY_ID) {
        // Box 3 (the word index and the vectors, `cache/`) is never backed up:
        // whatever is here belongs to the file about to be replaced. It goes, and
        // the marker makes the store's next open rebuild it (`tenants.ts`), or
        // recall finds nothing in a store full of memories. BOTH BEFORE the file
        // moves in (the #653 review, L1): a crash between leaves a marker over the
        // old file (one needless rebuild), never a new file with a stale cache.
        rmSync(join(dirname(path), "cache"), { recursive: true, force: true });
        writeFileSync(join(tenantDir(this.tenantsRoot(), id), RESTORED_MARKER), `${new Date().toISOString()}\n`, { mode: 0o600 });
      }
      for (const f of [path, `${path}-wal`]) if (existsSync(f)) renameSync(f, `${f}.pre-restore-${stamp}`);
      rmSync(`${path}-shm`, { force: true });
      rmSync(join(dirname(path), `.${basename(path)}-litestream`), { recursive: true, force: true });
      renameSync(out, path);
      if (existsSync(`${out}-wal`)) renameSync(`${out}-wal`, `${path}-wal`);
      rmSync(`${out}-shm`, { force: true });
      restored += 1;
    }
    return { restored, empty, kept: all.length - paths.length };
  }

  /** The live stores whose database file is missing on this volume (start-up's restore check). */
  missingStores(): string[] {
    return this.opts.liveStores().filter((id) => !existsSync(this.dbPaths(id)[0]!));
  }

  /** The Litestream configuration for every store that has a key, and the control databases. No secret in it. */
  config(restoring?: string): string {
    const replica = (path: string, keyFile: string): string[] => [
      `    replica:`,
      `      type: s3`,
      `      bucket: ${yamlString(this.opts.bucket)}`,
      `      path: ${yamlString(path)}`,
      `      endpoint: ${yamlString(this.opts.endpoint)}`,
      `      region: auto`,
      `      sse-customer-key-path: ${yamlString(keyFile)}`,
    ];
    // SNAPSHOTS EVERY 12 h, KEPT 12 h (Mike, 2026-10-26: "your account email is
    // purged from backups within 24 h"). A deleted address lives on in the
    // control database's history until the last snapshot taken before the
    // delete ages out: at most max(interval, retention) after the delete, plus
    // Litestream's retention-enforcement lag, which its docs don't state.
    // Litestream's defaults (24 h / 24 h) would make the bound "24 h plus an
    // unknown lag"; 12 h / 12 h leaves 12 h of room for that lag. The cost: two
    // snapshots a day instead of one, and a 12 h point-in-time window.
    const lines = [
      "# Generated by hosted/src/backup.ts. Do not edit: it is rewritten at every sign-up and delete.",
      "snapshot:",
      `  interval: ${SNAPSHOT_HOURS}h`,
      `  retention: ${SNAPSHOT_HOURS}h`,
      "dbs:",
    ];
    const ids = this.opts.keys.storeIds();
    const listed: string[] = [];
    if (ids.includes(CONTROL_KEY_ID)) {
      for (const db of CONTROL_DATABASES) {
        lines.push(`  - path: ${yamlString(join(this.opts.dataRoot, "control", db))}`, ...replica(`control/${db}`, this.keyFile(CONTROL_KEY_ID)));
      }
    }
    for (const id of ids) {
      if (id === CONTROL_KEY_ID || !STORE_ID.test(id)) continue;
      const dir = tenantDir(this.tenantsRoot(), id);
      // A store that lived and has no database here waits for a restore (the
      // #653 review, M4): it is not handed to the sidecar, which would watch a
      // missing file at its replica's prefix. A store never opened yet stays in,
      // so its first database is replicated from the start.
      if (id !== restoring && this.opts.openedBefore?.(id) === true && !existsSync(join(dir, "store", DATABASE_FILE))) continue;
      lines.push(`  - path: ${yamlString(join(dir, "store", DATABASE_FILE))}`, ...replica(replicaPrefix(id).slice(0, -1), this.keyFile(id)));
      listed.push(id);
    }
    this.lastListed = listed;
    return `${lines.join("\n")}\n`;
  }

  /** The stores the configuration last generated listed. */
  private lastListed: string[] = [];

  /** Is this store in the configuration as last written (`reload`)? (The #653 re-review, N1.) */
  inConfig(storeId: string): boolean {
    return this.lastListed.includes(storeId);
  }

  /** True between `hold()` and `release()`: the configuration is written, the sidecar isn't started. */
  private held = false;

  /**
   * START-UP'S PHASE (the #653 review, L2): no sidecar is started until the
   * restores are done. A pending delete finished at start-up reloads, and a
   * sidecar started then would replicate files a later restore replaces.
   */
  hold(): void {
    this.held = true;
  }

  /** The end of start-up's phase: the configuration written, the sidecar started on it. */
  async release(): Promise<void> {
    this.held = false;
    await this.reload();
  }

  /** Write the configuration and restart the sidecar on it (resolves when the old child has exited). */
  async reload(): Promise<void> {
    writeFileSync(this.configPath, this.config(), { mode: 0o600 });
    if (!this.held) await this.opts.sidecar?.reload();
  }

  /** What of a store is still in the bucket: its key object and its replica objects (a count). */
  async objectsLeft(storeId: string): Promise<number> {
    const key = (await this.opts.objects.get(keyObject(storeId))) === null ? 0 : 1;
    return key + (await this.opts.objects.list(replicaPrefix(storeId))).length;
  }

  /** The live stores with a tombstone in the bucket: deleted, whatever the accounts database says. */
  async tombstoned(): Promise<string[]> {
    const out: string[] = [];
    for (const id of this.opts.liveStores()) if ((await this.opts.objects.get(tombstoneObject(id))) !== null) out.push(id);
    return out;
  }
}

/**
 * THE LITESTREAM SIDECAR: one `litestream replicate -config <file>` child,
 * restarted when the configuration changes and (with a back-off) when it dies.
 * Its environment carries the R2 credentials and nothing else of the server's.
 */
export class LitestreamSidecar implements Sidecar {
  private child: ChildProcess | null = null;
  /** Children sent SIGTERM and not yet exited. */
  private dying: Promise<void>[] = [];
  private stopping = false;
  private restarts: number[] = [];
  private readonly opts: {
    binary: string;
    configPath: string;
    env: Record<string, string>;
    spawnFn?: (cmd: string, args: string[], env: Record<string, string>) => ChildProcess;
    onEvent?: (name: "sidecar.start" | "sidecar.exit" | "sidecar.backoff" | "sidecar.kill") => void;
    /** A child that hasn't exited this long after SIGTERM gets SIGKILL. */
    killAfterMs?: number;
  };

  constructor(opts: LitestreamSidecar["opts"]) {
    this.opts = opts;
  }

  /** A child running, or one being replaced by a reload. False while backing off after a crash, or stopped. */
  up(): boolean {
    if (this.stopping) return false;
    const c = this.child;
    if (c !== null) return c.exitCode === null && c.signalCode === null;
    return this.reloading > 0;
  }

  private reloading = 0;

  async reload(): Promise<void> {
    this.reloading += 1;
    try {
      await this.reloadOnce();
    } finally {
      this.reloading -= 1;
    }
  }

  private async reloadOnce(): Promise<void> {
    this.stopping = false;
    const old = this.child;
    this.child = null;
    if (old !== null) this.dying.push(this.terminate(old));
    // Every child already on its way out, not only this one: two reloads in a row
    // must not leave the first child flushing while the second is said done.
    const waiting = [...this.dying];
    await Promise.all(waiting);
    this.dying = this.dying.filter((p) => !waiting.includes(p));
    if (!this.stopping) this.start();
  }

  /** SIGTERM (Litestream finishes its upload and exits), SIGKILL after `killAfterMs`; resolves on exit. */
  private terminate(c: ChildProcess): Promise<void> {
    return new Promise<void>((done) => {
      if (typeof c.exitCode === "number" || typeof c.signalCode === "string") {
        done();
        return;
      }
      c.removeAllListeners("exit"); // no back-off restart for a child we ended
      const timer = setTimeout(() => {
        this.opts.onEvent?.("sidecar.kill");
        c.kill("SIGKILL");
      }, this.opts.killAfterMs ?? 30_000);
      timer.unref?.();
      c.once("exit", () => {
        clearTimeout(timer);
        this.opts.onEvent?.("sidecar.exit");
        done();
      });
      c.kill("SIGTERM");
    });
  }

  private start(): void {
    if (this.stopping || this.child !== null) return;
    const run = this.opts.spawnFn ?? ((cmd: string, args: string[], env: Record<string, string>) => spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"], env }));
    const child = run(this.opts.binary, ["replicate", "-config", this.opts.configPath], this.opts.env);
    this.child = child;
    this.opts.onEvent?.("sidecar.start");
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      this.opts.onEvent?.("sidecar.exit");
      if (this.stopping) return;
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => t > now - 60 * 60 * 1000);
      this.restarts.push(now);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(6, this.restarts.length - 1));
      this.opts.onEvent?.("sidecar.backoff");
      setTimeout(() => this.start(), delay).unref?.();
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const c = this.child;
    this.child = null;
    if (c !== null) this.dying.push(this.terminate(c));
    const waiting = [...this.dying];
    await Promise.all(waiting);
    this.dying = this.dying.filter((p) => !waiting.includes(p));
  }
}
