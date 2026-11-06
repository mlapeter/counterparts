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
 *   - **Each DEK (the control key's too), ONCE, SEALED to the recovery key**
 *     (WB1, `keys.ts#RecoverySealer`), as its own object `keys/<storeId>.sealed`,
 *     written at sign-up and re-written only when the recovery key changes. The
 *     server can write it and never open it: a restart reads `keys/keys.sqlite`
 *     on the volume, and only `recover-keys`, given the offline private key,
 *     opens the bucket's copies after a volume is lost. So a leak of the
 *     environment (the R2 token included) and a copy of the bucket open nothing.
 *     No keys.sqlite backup, no volume-KEK backup, no daily copies: R2 object
 *     lock stays OFF for `keys/` (the runbook's bucket setting), so a delete is a
 *     delete. (`keys/<storeId>.wrapped`, the KEK-wrapped object from before WB1,
 *     is read while it is there and removed by `migrate-keys` and by a delete.)
 *
 * DELETE (`removeStore`), all of it at once: the store leaves the sidecar's
 * configuration (and the sidecar restarts), its key file goes, its key objects
 * go, and its whole replica prefix goes. Even a copy someone kept of the bucket
 * is ciphertext under a key that no longer exists anywhere but sealed in that
 * same copy, which only the offline recovery key opens.
 *
 * The sidecar's R2 credentials come from its environment (Litestream reads
 * `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`); the
 * configuration file holds no secret, only paths.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { createHash } from "node:crypto";

import { openDb } from "../../src/core/store/db.js";
import { DATABASE_FILE } from "../../src/core/store/paths.js";
import type { ObjectStore } from "./egress.js";
import type { KeyStore, RecoverySealer } from "./keys.js";
import { KEK_ENV, LEGACY_KEY_NEEDS_RING, litestreamKey, sealedHeader } from "./keys.js";
import { LITESTREAM_META, RESTORED_MARKER, STORE_ID, oldLitestreamMeta, settleLitestreamMeta, tenantDir } from "./tenants.js";

/** The pseudo-store whose DEK keys the control databases' backups. */
export const CONTROL_KEY_ID = "control";
export const CONTROL_DATABASES = ["accounts.sqlite", "oauth.sqlite"] as const;
/**
 * The control key a re-key is making (WB1, `migrate-keys`): a row in keys.sqlite
 * only, never in the bucket, until it is proven and becomes `control`.
 */
export const CONTROL_NEXT_ID = "control.next";
/** Where the control databases' replicas live by default: `control/<db>/`. A re-keyed control key's live at `control/<key id>/<db>/`. */
export const CONTROL_BASE = "control/";
export const controlBaseFor = (keyId: string): string => `control/${keyId}/`;
/** The refusal while a control re-key is half done. */
export const CONTROL_REKEY_PENDING =
  "a control re-key (migrate-keys) was cut short: keys/keys.sqlite holds the new control key, not yet proven. Stop the server and run migrate-keys again; it finishes it (docs/hosted/RUNBOOK.md, Write-only backups).";

/** Litestream snapshot interval and retention, in hours (see `config()`): the "purged within 24 h" bound's margin. */
export const SNAPSHOT_HOURS = 12;

/** The store's DEK in the bucket, sealed to the recovery key (WB1). */
export const keyObject = (storeId: string): string => `keys/${storeId}.sealed`;
/** The store's DEK in the bucket as it was before WB1: wrapped under a `HOSTED_KEKS` KEK. Read while there; `migrate-keys` removes it. */
export const legacyKeyObject = (storeId: string): string => `keys/${storeId}.wrapped`;
/** A key object's store id (either form), or null for another name. */
export function keyObjectId(name: string): { id: string; legacy: boolean } | null {
  const m = /^keys\/([^/]+)\.(sealed|wrapped)$/.exec(name);
  return m === null ? null : { id: m[1]!, legacy: m[2] === "wrapped" };
}
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
  "the bucket's control key is a different key from this volume's (keys/keys.sqlite): a start against another bucket (a wrong R2_BUCKET or R2_ENDPOINT, after keys/keys.sqlite was lost: by a build before R7, or before anyone had signed up) made this volume a new one. The way back: remove keys/ from the volume (rm -rf /data/keys on Railway), then, with the server stopped, run recover-keys --control-aside <new label> with the recovery private key, then deploy once with RESTORE_ON_BOOT=1 (docs/hosted/RUNBOOK.md, If a start refuses).";

/** A store that was opened before has no key on this volume and none in the bucket. */
export class StoreKeyMissing extends Error {
  constructor() {
    super("a store that was opened before has no key here and none in the bucket: it is not backed up until that is resolved");
    this.name = "StoreKeyMissing";
  }
}

/** The words for a key this volume doesn't have and the bucket has only sealed (WB1): the one case the private key is for. */
export const KEY_SEALED =
  "this volume has no key for it, and the bucket's copy is sealed to the recovery key, which the server never holds: run recover-keys with the recovery private key first (docs/hosted/RUNBOOK.md, Restore)";

/**
 * A store (or `control`) with no key on this volume whose key the bucket has,
 * sealed (WB1). Never minted over and never opened here: only `recover-keys`,
 * given the private key, brings it back.
 */
export class KeySealed extends Error {
  constructor() {
    super(KEY_SEALED);
    this.name = "KeySealed";
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
  /** What every key object put in the bucket is sealed to (WB1; `HOSTED_RECOVERY_PUBKEY`). */
  readonly sealer: RecoverySealer;
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
 *   - `sealed` (WB1): not a store with no key anywhere: the bucket has its key,
 *     sealed to the recovery key, and this volume doesn't (`keys.sqlite` was
 *     lost). Never minted over; `recover-keys` brings it back.
 */
export type KeylessReason = "no-database" | "replica-in-bucket" | "tombstone" | "bucket-unproven" | "keys-newer" | "bucket-unreadable" | "locked" | "sealed";
export const KEYLESS_REASONS: readonly KeylessReason[] = ["no-database", "replica-in-bucket", "tombstone", "bucket-unproven", "keys-newer", "bucket-unreadable", "locked", "sealed"];

/**
 * A database's rows, as one digest (the control re-key's proof): every table's
 * rows, in a stable order. Two files with the same rows give the same digest,
 * whatever their pages look like.
 */
export function databaseDigest(path: string): string {
  const db = openDb(path);
  try {
    const h = createHash("sha256");
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const plain = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? `${v.toString()}n` : v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v);
    for (const { name } of tables) {
      h.update(`table ${name}\n`);
      const rows = db.all(`SELECT * FROM "${name.replace(/"/g, '""')}"`).map((r) => JSON.stringify(r, plain)).sort();
      for (const r of rows) h.update(`${r}\n`);
    }
    return h.digest("hex");
  } finally {
    db.close();
  }
}

/** One write transaction on a database, changing no row (the re-key's nudge to a Litestream that ships on change). */
function touchDatabase(path: string): void {
  const db = openDb(path, { wal: true });
  try {
    db.exec("CREATE TABLE IF NOT EXISTS wb1_rekey_touch (x INTEGER); DROP TABLE wb1_rekey_touch;");
  } finally {
    db.close();
  }
}

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
    if (storeId === CONTROL_NEXT_ID) return join(this.opts.dataRoot, "control", "litestream.next.key");
    return storeId === CONTROL_KEY_ID ? join(this.opts.dataRoot, "control", "litestream.key") : join(tenantDir(this.tenantsRoot(), storeId), "litestream.key");
  }

  /** Does the key file hold exactly this key's SSE-C key? False when it is missing, or another key's. */
  private async keyFileCurrent(storeId: string): Promise<boolean> {
    const file = this.keyFile(storeId);
    if (!existsSync(file)) return false;
    const dek = await this.opts.keys.dek(storeId);
    try {
      return readFileSync(file, "utf8").trim() === litestreamKey(dek);
    } finally {
      dek.fill(0);
    }
  }

  /**
   * EVERY KEY FILE AGREES WITH keys.sqlite before Litestream starts (the #768
   * delta review): each key's file rewritten when it is missing or another
   * key's, whatever crash left it so. Returns how many were written.
   */
  async syncKeyFiles(): Promise<number> {
    let n = 0;
    for (const id of this.opts.keys.storeIds()) {
      if (id !== CONTROL_KEY_ID && !STORE_ID.test(id)) continue;
      if (await this.keyFileCurrent(id)) continue;
      await this.writeKeyFile(id);
      n += 1;
    }
    return n;
  }

  /** Where the control databases' replicas live now: `control/`, or a re-keyed control key's `control/<key id>/`. */
  controlBase(): string {
    return this.opts.keys.replicaBase(CONTROL_KEY_ID) ?? CONTROL_BASE;
  }

  /** One control database's replica prefix, as listed (`control/accounts.sqlite/`, or under the re-keyed base). */
  controlPrefix(db: (typeof CONTROL_DATABASES)[number]): string {
    return `${this.controlBase()}${db}/`;
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
    // has no key here while its backup in R2 is encrypted under the key in its
    // key object. Minting a fresh DEK and putting it over that object would make
    // every byte of the backup unreadable, for good. So a new key is made only
    // when neither side has one, and when both have one the bucket's must be the
    // same DEK before anything is put.
    //
    // WB1: the bucket's copy is SEALED to the recovery key, and this server can
    // never open it. With no key here and a sealed one there, it refuses
    // (`KeySealed`): only `recover-keys`, given the private key, brings it back.
    // "The same DEK" is read off the sealed value's key id, without opening it.
    // A key object from before WB1 (`.wrapped`, under HOSTED_KEKS) is still
    // adopted while the ring can open it (`KeyStore.adopt`).
    const remote = await this.bucketKey(storeId);
    let wrapped = this.opts.keys.wrapped(storeId);
    let adopted = false;
    // The one exception (the #768 review, M2's follow-on): a store never opened,
    // with NO replica in the bucket. Nothing is encrypted under the bucket's key,
    // so `recover-keys` couldn't prove it (and doesn't adopt it), and a new key
    // buries nothing: it is made, and its sealed object is put over the old one.
    // A forged key object can't then set this store's future backups' key.
    let unproven = false;
    if (wrapped === null && remote.sealed !== null) {
      unproven = storeId !== CONTROL_KEY_ID && this.opts.openedBefore?.(storeId) !== true && (await this.opts.objects.list(replicaPrefix(storeId))).length === 0;
      if (!unproven) throw new KeySealed();
    }
    if (wrapped === null && remote.legacy !== null) {
      adopted = await this.opts.keys.adopt(storeId, await this.readable(storeId, remote.legacy));
      wrapped = this.opts.keys.wrapped(storeId);
      // A control key from before WB1: an env leak could have opened it, so migrate-keys re-keys it (HIGH 1).
      if (storeId === CONTROL_KEY_ID) this.opts.keys.recordFact("control-rekey-due");
    }
    if (wrapped === null && storeId !== CONTROL_KEY_ID && this.opts.openedBefore?.(storeId) === true) {
      // A store that lived, with no key here and none in the bucket: its key may
      // have been lost, and a new one would hide that and make any copy of it
      // unreadable. Never minted here (sign-up, a first open, a restore): only
      // `ensureAll` at start-up mints one, after checking nothing can be buried.
      throw new StoreKeyMissing();
    }
    if (wrapped === null) await this.opts.keys.create(storeId);
    const mine = (await this.opts.keys.keyId(storeId))!;
    const differs = (): Error =>
      // The control key, said as such (the #658 review): after a start against
      // a wrong, empty bucket made this volume a new one, "a different key for
      // that store" misleads. The RUNBOOK's way back is named.
      storeId === CONTROL_KEY_ID ? new Error(CONTROL_KEY_DIFFERS) : new Error("a different key for that store is already here");
    if (unproven) {
      await this.opts.objects.put(keyObject(storeId), await this.opts.keys.sealed(storeId, this.opts.sealer));
    } else if (remote.sealed !== null) {
      const header = sealedHeader(remote.sealed);
      if (header === null) throw new Error("a store's key object in the bucket (keys/<id>.sealed) isn't one this server wrote: nothing was put over it. Tell the coordinator.");
      if (header.keyId !== mine) throw differs();
      // A new recovery key (HOSTED_RECOVERY_PUBKEY changed): sealed again to it.
      if (header.fingerprint !== this.opts.sealer.fingerprint) await this.opts.objects.put(keyObject(storeId), await this.opts.keys.sealed(storeId, this.opts.sealer));
    } else {
      // Before WB1's object exists: an old `.wrapped` beside it must be this DEK too.
      if (remote.legacy !== null && !adopted) {
        try {
          await this.opts.keys.adopt(storeId, await this.readable(storeId, remote.legacy)); // throws on a different DEK
        } catch (err) {
          if (err instanceof Error && err.message === "a different key for that store is already here") throw differs();
          throw err;
        }
      }
      await this.opts.objects.put(keyObject(storeId), await this.opts.keys.sealed(storeId, this.opts.sealer));
    }
    // The key file is the KEY'S, whatever is there (the #768 delta review): a file left by a key that is gone, or by a crash
    // between a key's change and its file's, would put the replica under an SSE-C key keys.sqlite doesn't hold. After the
    // bucket's checks: a key the bucket says is another one's never gets its file written.
    if (!(await this.keyFileCurrent(storeId))) await this.writeKeyFile(storeId);
    if (opts.reload !== false) await this.reload();
  }

  /**
   * The bucket's key objects for an id: the sealed one (WB1), and the old
   * `.wrapped` one, read only when there is no sealed one (a bucket from before
   * `migrate-keys`).
   */
  async bucketKey(storeId: string): Promise<{ sealed: string | null; legacy: string | null }> {
    const sealed = await this.opts.objects.get(keyObject(storeId));
    if (sealed !== null) return { sealed, legacy: null };
    return { sealed: null, legacy: await this.opts.objects.get(legacyKeyObject(storeId)) };
  }

  /** The bucket has a key object for this id, in either form. */
  async inBucket(storeId: string): Promise<boolean> {
    const k = await this.bucketKey(storeId);
    return k.sealed !== null || k.legacy !== null;
  }

  /** An old `.wrapped` key object, checked to open under the ring for this store (a refusal that says what to do, never a key). */
  private async readable(storeId: string, remote: string): Promise<string> {
    try {
      (await this.opts.keys.unwrapForCheck(storeId, remote)).fill(0);
    } catch {
      throw new Error(`a store's key object in the bucket (keys/<id>.wrapped, from before WB1) doesn't open: ${LEGACY_KEY_NEEDS_RING}.`);
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
    if (this.opts.keys.wrapped(CONTROL_NEXT_ID) !== null) throw new Error(CONTROL_REKEY_PENDING);
    const unreadable = await this.opts.keys.unreadable();
    if (unreadable.length > 0) throw new Error(`${String(unreadable.length)} wrapped store keys in keys/keys.sqlite don't open: keys/volume.kek is missing or not this volume's, or they are under ${KEK_ENV} and the environment no longer has that ring (set ${KEK_ENV} back as it was and run migrate-keys; docs/hosted/RUNBOOK.md, Write-only backups).`);
    // (f) THE BUCKET IS THIS VOLUME'S: it held the control key BEFORE this start.
    // Read before `ensureStore(control)`, which puts the local key into a bucket
    // that has none; past it, the bucket's key was adopted (a new volume) or
    // proven the same DEK as this volume's (a different one throws).
    const bucketProven = await this.inBucket(CONTROL_KEY_ID);
    await this.ensureStore(CONTROL_KEY_ID, { reload: false });
    // A re-key cut short after its switch: its old control replicas (under the old key) never linger past a start.
    await this.dropOldControlReplicas();
    // The control key is in this bucket now (adopted, proven or put): a later
    // start beside a bucket without it is no longer "a turn-on cut short" (R7).
    this.opts.keys.recordFact("control-key-in-bucket");
    let keyless = 0;
    let minted = 0;
    for (const id of this.opts.liveStores()) {
      // A locked store (a delete pending) with no key here and none in the
      // bucket is never handed to `ensureStore`, which would make one: it is
      // counted keyless and left as it is until its erase or its keep (R6).
      if (this.opts.locked?.(id) === true && this.opts.keys.wrapped(id) === null && !(await this.inBucket(id))) {
        keyless += 1;
        this.opts.onKeyless?.(id, "locked");
        continue;
      }
      try {
        await this.ensureStore(id, { reload: false });
      } catch (err) {
        if (err instanceof KeySealed) {
          // Its key is in the bucket, sealed, and not here: never minted over, and
          // left out of the backups until `recover-keys` (WB1). Everyone else starts.
          keyless += 1;
          this.opts.onKeyless?.(id, "sealed");
          continue;
        }
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
    // `<=`: the start's own heal marks a store from before `opened_at` just before the fact, maybe in the same
    // millisecond (the #661 re-check, P7); nothing else opens a store then (the server doesn't listen yet).
    if (turnedOn !== null && opened !== null && opened <= turnedOn) return null;
    if (!bucketProven) return "bucket-unproven";
    const keysMade = this.opts.keys.createdAt(CONTROL_KEY_ID);
    if (keysMade === null || opened === null || keysMade >= opened) return "keys-newer"; // equal refuses too (the #658 review)
    return null;
  }

  /**
   * Is the bucket's sealed object for this id right: there, sealed to the
   * current recovery key, and naming this volume's DEK? "different" when it
   * names another DEK (never overwritten); "missing" or "stale" when a seal of
   * the key here belongs there. Null: no key here.
   */
  async sealedState(storeId: string): Promise<"ok" | "missing" | "stale" | "different" | null> {
    const mine = await this.opts.keys.keyId(storeId);
    if (mine === null) return null;
    const remote = await this.opts.objects.get(keyObject(storeId));
    if (remote === null) return "missing";
    const header = sealedHeader(remote);
    if (header === null || header.keyId !== mine) return "different";
    return header.fingerprint === this.opts.sealer.fingerprint ? "ok" : "stale";
  }

  /**
   * Every live store's (and the control key's) sealed object made right
   * (`sealedState`): put where missing or sealed to an older recovery key.
   * Never over one that names another DEK (counted in `different`). Returns
   * how many were put; `dryRun` counts them and puts nothing.
   */
  async syncKeyObjects(opts: { dryRun?: boolean } = {}): Promise<{ put: number; different: string[] }> {
    let put = 0;
    const different: string[] = [];
    for (const id of [CONTROL_KEY_ID, ...this.opts.liveStores()]) {
      const state = await this.sealedState(id);
      if (state === null || state === "ok") continue;
      if (state === "different") {
        different.push(id);
        continue;
      }
      if (opts.dryRun !== true) await this.opts.objects.put(keyObject(id), await this.opts.keys.sealed(id, this.opts.sealer));
      put += 1;
    }
    return { put, different };
  }

  /** Is a control re-key due (or half done)? Due: the control key was once under HOSTED_KEKS and still lives at the default base. */
  controlRekeyDue(): boolean {
    if (this.opts.keys.wrapped(CONTROL_NEXT_ID) !== null) return true;
    return this.opts.keys.fact("control-rekey-due") !== null && this.opts.keys.replicaBase(CONTROL_KEY_ID) === null;
  }

  /**
   * THE CONTROL RE-KEY (WB1; the #768 review's HIGH 1). A control key that was
   * ever under `HOSTED_KEKS` stays openable by an old environment and an old copy
   * of `keys/control.wrapped`, and so does its SSE-C key: every control snapshot,
   * past and future (every person's email, the OAuth rows). So control gets a NEW
   * DEK and new replicas, with the server stopped:
   *
   *   1. the new key, `control.next`, in keys.sqlite only (a run again reuses it);
   *   2. the control databases replicated under it to `control/<its key id>/`,
   *      once Litestream's local state for them is cleared, by a Litestream of
   *      the re-key's own (`rekeyConfig`); unless that base already PROVES
   *      (a run cut short after this step);
   *   3. PROVEN: each database restored from the new base, under the new key, to
   *      a scratch file whose rows equal the live file's. Not proven: nothing
   *      switched, the old replicas and key untouched; a run again starts here;
   *   4. the switch: `keys/control.sealed` sealed to the new key FIRST (a volume
   *      lost now restores the new replicas), then keys.sqlite in one write
   *      (`promote`: control's row the new key, its `created_at` kept for R5's
   *      (f2), its base the new one), then its key file;
   *   5. the old replicas (`control/<db>/`) deleted (`dropOldControlReplicas`).
   *
   * R7's facts are untouched: the control key object stays in the bucket the
   * whole time (`bucketProven`, `control-key-in-bucket`). A start while step 1-4
   * is unfinished refuses (`CONTROL_REKEY_PENDING`). Returns what it did.
   */
  async rekeyControl(o: { sidecar: (configPath: string) => Sidecar; run: LitestreamRun; proveMs?: number }): Promise<"done" | "not-due"> {
    if (!this.controlRekeyDue()) return "not-due";
    const paths = this.dbPaths(CONTROL_KEY_ID);
    for (const p of paths) if (!existsSync(p)) throw new Error("a control re-key needs both control databases on this volume: restore them first");
    if (this.opts.keys.wrapped(CONTROL_NEXT_ID) === null) await this.opts.keys.create(CONTROL_NEXT_ID);
    const base = controlBaseFor((await this.opts.keys.keyId(CONTROL_NEXT_ID))!);
    const yml = join(this.opts.dataRoot, "litestream.rekey.yml");
    await this.writeKeyFile(CONTROL_NEXT_ID);
    writeFileSync(yml, this.rekeyConfig(base), { mode: 0o600 });
    try {
      if (!(await this.rekeyProven(base, yml, o.run))) {
        // Whatever is at the new base is unproven: it goes, and Litestream starts a fresh snapshot there.
        for (const db of CONTROL_DATABASES) await this.opts.objects.deletePrefix(`${base}${db}/`);
        for (const p of paths) rmSync(join(dirname(p), `.${basename(p)}-litestream`), { recursive: true, force: true });
        const sidecar = o.sidecar(yml);
        await sidecar.reload();
        let proven = false;
        try {
          // A write to each, so even a Litestream that ships only on change has one to ship.
          for (const p of paths) touchDatabase(p);
          const until = Date.now() + (o.proveMs ?? 120_000);
          while (!proven && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 1000));
            proven = await this.rekeyProven(base, yml, o.run);
          }
        } finally {
          await sidecar.stop();
        }
        if (!proven) throw new Error("the control re-key's new snapshot didn't prove (restored, it didn't equal the control databases here) within the time: nothing was switched, the old control key and replicas are as they were. Run migrate-keys again");
      }
      const next = await this.opts.keys.dek(CONTROL_NEXT_ID);
      try {
        await this.opts.objects.put(keyObject(CONTROL_KEY_ID), this.opts.sealer.seal(next, CONTROL_KEY_ID));
      } finally {
        next.fill(0);
      }
      // The old SSE-C key file goes FIRST (the #768 delta review's HIGH): a crash after the switch then leaves no file,
      // and the next start writes it from the new key, never Litestream shipping new control data under the old one.
      rmSync(this.keyFile(CONTROL_KEY_ID), { force: true });
      await this.opts.keys.promote(CONTROL_NEXT_ID, CONTROL_KEY_ID, base);
      await this.writeKeyFile(CONTROL_KEY_ID);
    } finally {
      rmSync(yml, { force: true });
      rmSync(this.keyFile(CONTROL_NEXT_ID), { force: true });
    }
    await this.dropOldControlReplicas();
    return "done";
  }

  /**
   * BACKING OUT OF A RE-KEY THAT WON'T FINISH (`migrate-keys
   * --abort-control-rekey`; the #768 delta review): while `control.next` is
   * pending, the old control key is still this volume's, and its replicas are
   * where they were. So: the bucket's control key object sealed to the OLD key
   * again (a cut-short run may have put the new one), the new base's objects
   * deleted, the pending key and its key file gone, Litestream's local state for
   * the control databases cleared (the re-key's run had pointed it at the new
   * base). The `control-rekey-due` fact stays: the next `migrate-keys` tries
   * again. Refused once the switch has happened (there is nothing to back out).
   */
  async abortControlRekey(): Promise<{ aborted: boolean; deleted: number }> {
    if (this.opts.keys.wrapped(CONTROL_NEXT_ID) === null) return { aborted: false, deleted: 0 };
    const base = controlBaseFor((await this.opts.keys.keyId(CONTROL_NEXT_ID))!);
    if (this.controlBase() === base) throw new Error("the control re-key already switched: nothing to back out");
    await this.opts.objects.put(keyObject(CONTROL_KEY_ID), await this.opts.keys.sealed(CONTROL_KEY_ID, this.opts.sealer));
    let deleted = 0;
    for (const db of CONTROL_DATABASES) deleted += await this.opts.objects.deletePrefix(`${base}${db}/`);
    for (const p of this.dbPaths(CONTROL_KEY_ID)) rmSync(join(dirname(p), `.${basename(p)}-litestream`), { recursive: true, force: true });
    this.opts.keys.delete(CONTROL_NEXT_ID);
    rmSync(this.keyFile(CONTROL_NEXT_ID), { force: true });
    rmSync(join(this.opts.dataRoot, "litestream.rekey.yml"), { force: true });
    return { aborted: true, deleted };
  }

  /** The control databases restored from `base` (the re-key's config) equal the files here: the new snapshot is proven. */
  private async rekeyProven(base: string, yml: string, run: LitestreamRun): Promise<boolean> {
    for (const db of CONTROL_DATABASES) if ((await this.opts.objects.list(`${base}${db}/`)).length === 0) return false;
    for (const path of this.dbPaths(CONTROL_KEY_ID)) {
      const out = `${path}.rekey-proof`;
      const clean = (): void => {
        for (const f of [out, `${out}-wal`, `${out}-shm`]) rmSync(f, { force: true });
      };
      clean();
      try {
        const r = await run(["restore", "-config", yml, "-o", out, "-if-replica-exists", path]);
        if (r.code !== 0 || !existsSync(out)) return false;
        if (databaseDigest(out) !== databaseDigest(path)) return false;
      } catch {
        return false;
      } finally {
        clean();
      }
    }
    return true;
  }

  /**
   * After a re-key: the control replicas at the default base (`control/<db>/`,
   * under the old key) deleted, once control's base is another. Idempotent.
   * Returns how many objects went.
   */
  async dropOldControlReplicas(): Promise<number> {
    if (this.controlBase() === CONTROL_BASE) return 0;
    let n = 0;
    for (const db of CONTROL_DATABASES) n += await this.opts.objects.deletePrefix(`${CONTROL_BASE}${db}/`);
    return n;
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
    await this.opts.objects.delete(legacyKeyObject(storeId)); // one from before WB1, if migrate-keys hadn't run
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
   *   1. its key, from this volume's `keys.sqlite` (`ensureStore`), the key file
   *      written, the configuration rewritten. A volume without it is refused:
   *      when the bucket has it sealed (WB1), `recover-keys` must bring it back
   *      first (`KeySealed`); when the bucket has no key object either, there is
   *      nothing to restore with (a new key would restore nothing, and would
   *      replace the record). A `.wrapped` key object from before WB1 is still
   *      adopted while HOSTED_KEKS opens it;
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
    if (this.opts.keys.wrapped(id) === null && !(await this.inBucket(id))) {
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
      // Drops Litestream's log lines (`time=… level=…`, on stderr since `config`'s
      // `logging.stderr`); the restore CLI replaces the id by its tag in the
      // message (the #653 review, L5), since an `Error:` line can name the path too.
      if (r.code !== 0) throw new Error(`litestream restore exited ${String(r.code)}: ${r.stderr.trim().split("\n").filter((l) => !l.startsWith("time=")).slice(-2).join(" / ").slice(0, 300)}`);
      if (!existsSync(out)) {
        empty += 1;
        continue;
      }
      // A file in place (`--force`) is moved aside, never deleted: the replica
      // may be behind it (`/readyz` sees control's uploads, never one store's). Litestream's own
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
      if (id !== CONTROL_KEY_ID) {
        const dir = tenantDir(this.tenantsRoot(), id);
        rmSync(join(dir, LITESTREAM_META), { recursive: true, force: true });
        rmSync(oldLitestreamMeta(dir), { recursive: true, force: true });
      }
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

  /** One replica's lines in the configuration (`config`, `rekeyConfig`). */
  private replicaLines(path: string, keyFile: string): string[] {
    return [
      `    replica:`,
      `      type: s3`,
      `      bucket: ${yamlString(this.opts.bucket)}`,
      `      path: ${yamlString(path)}`,
      `      endpoint: ${yamlString(this.opts.endpoint)}`,
      `      region: auto`,
      `      sse-customer-key-path: ${yamlString(keyFile)}`,
    ];
  }

  /**
   * The re-key's own configuration (WB1): the two control databases only, at
   * `base`, under the NEW control key's key file. Never the sidecar's.
   */
  rekeyConfig(base: string): string {
    const lines = ["# Generated by hosted/src/backup.ts for a control re-key (migrate-keys). Not the sidecar's.", "logging:", "  stderr: true", "snapshot:", `  interval: ${SNAPSHOT_HOURS}h`, `  retention: ${SNAPSHOT_HOURS}h`, "dbs:"];
    for (const db of CONTROL_DATABASES) lines.push(`  - path: ${yamlString(join(this.opts.dataRoot, "control", db))}`, ...this.replicaLines(`${base}${db}`, this.keyFile(CONTROL_NEXT_ID)));
    return `${lines.join("\n")}\n`;
  }

  /** The Litestream configuration for every store that has a key, and the control databases. No secret in it. */
  config(restoring?: string): string {
    const replica = (path: string, keyFile: string): string[] => this.replicaLines(path, keyFile);
    // SNAPSHOTS EVERY 12 h, KEPT 12 h (Mike, 2026-10-26: "your account email is
    // purged from backups within 24 h"). A deleted address lives on in the
    // control database's history until the last snapshot taken before the
    // delete ages out: at most max(interval, retention) after the delete, plus
    // Litestream's retention-enforcement lag, which its docs don't state.
    // Litestream's defaults (24 h / 24 h) would make the bound "24 h plus an
    // unknown lag"; 12 h / 12 h leaves 12 h of room for that lag. The cost: two
    // snapshots a day instead of one, and a 12 h point-in-time window.
    // LITESTREAM'S OWN LINES TO STDERR (0.5.17 logs to stdout unless
    // `logging.stderr`): the sidecar inherits stderr into the container's log,
    // so a sync error, an R2 403 or an SSE-C refusal shows there. `restore`'s
    // failure message drops Litestream's log lines; the restore CLI replaces the
    // id by its tag in the message. At the default
    // level (INFO) a line names paths, the bucket and the endpoint, never a key:
    // LOG_LEVEL and LITESTREAM_S3_DEBUG never reach the child (`litestreamEnv`).
    const lines = [
      "# Generated by hosted/src/backup.ts. Do not edit: it is rewritten at every sign-up and delete.",
      "logging:",
      "  stderr: true",
      "snapshot:",
      `  interval: ${SNAPSHOT_HOURS}h`,
      `  retention: ${SNAPSHOT_HOURS}h`,
      "dbs:",
    ];
    const ids = this.opts.keys.storeIds();
    const listed: string[] = [];
    if (ids.includes(CONTROL_KEY_ID)) {
      for (const db of CONTROL_DATABASES) {
        lines.push(`  - path: ${yamlString(join(this.opts.dataRoot, "control", db))}`, ...replica(`${this.controlBase()}${db}`, this.keyFile(CONTROL_KEY_ID)));
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
      // Its own state beside the store, never in it (`tenants.ts#LITESTREAM_META`).
      lines.push(`  - path: ${yamlString(join(dir, "store", DATABASE_FILE))}`, `    meta-path: ${yamlString(join(dir, LITESTREAM_META))}`, ...replica(replicaPrefix(id).slice(0, -1), this.keyFile(id)));
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
    // Before the sidecar starts on a `meta-path` outside `store/`: a position
    // an older build left inside it moves there, so Litestream carries on from it.
    for (const id of this.opts.keys.storeIds()) {
      if (id === CONTROL_KEY_ID || !STORE_ID.test(id)) continue;
      try {
        settleLitestreamMeta(tenantDir(this.tenantsRoot(), id));
      } catch {
        /* the store's next open tries again (`tenants.ts#openHandle`) */
      }
    }
    // Every key file is its key's before Litestream reads one.
    await this.syncKeyFiles();
    await this.reload();
  }

  /** Write the configuration and restart the sidecar on it (resolves when the old child has exited). */
  async reload(): Promise<void> {
    writeFileSync(this.configPath, this.config(), { mode: 0o600 });
    if (!this.held) await this.opts.sidecar?.reload();
  }

  /** What of a store is still in the bucket: its key object and its replica objects (a count). */
  async objectsLeft(storeId: string): Promise<number> {
    const sealed = (await this.opts.objects.get(keyObject(storeId))) === null ? 0 : 1;
    const legacy = (await this.opts.objects.get(legacyKeyObject(storeId))) === null ? 0 : 1;
    return sealed + legacy + (await this.opts.objects.list(replicaPrefix(storeId))).length;
  }

  /** The live stores with a tombstone in the bucket: deleted, whatever the accounts database says. */
  async tombstoned(): Promise<string[]> {
    const out: string[] = [];
    for (const id of this.opts.liveStores()) if ((await this.opts.objects.get(tombstoneObject(id))) !== null) out.push(id);
    return out;
  }
}

/** The replica the upload watch reads: the accounts database, which it also writes (`Accounts.heartbeat`). */
export const WATCHED_REPLICA = "control/accounts.sqlite/";
/** How often the watch looks (one LIST of `WATCHED_REPLICA`, then one heartbeat write). */
export const UPLOADS_EVERY_MS = 10 * 60 * 1000;
/** No rise seen for this long ⇒ `stale`. Three looks: one slow or failed LIST never turns it. */
export const UPLOADS_STALE_MS = 30 * 60 * 1000;

/**
 * The highest TXID among a replica's LTX files, `<prefix><4-hex level>/<16 hex
 * min TXID>-<16 hex max TXID>.ltx` (Litestream 0.5.17, ltx v0.5.2's
 * FormatFilename; the restore drill read replication this way on the real
 * binary, `drill/drill-client.ts#maxTxid`). 0n for none. Every level counts, so
 * compaction moving L0 files up never lowers it.
 */
export function maxTxid(keys: readonly string[], prefix: string): bigint {
  let max = 0n;
  for (const k of keys) {
    if (!k.startsWith(prefix)) continue;
    const m = /^[0-9a-f]{4}\/([0-9a-f]{16})-([0-9a-f]{16})\.ltx$/.exec(k.slice(prefix.length));
    if (m !== null && BigInt(`0x${m[2]!}`) > max) max = BigInt(`0x${m[2]!}`);
  }
  return max;
}

/** Why the last look didn't see a rise: a code for the log, never a readyz word. */
export type UploadsReason = "no-rise" | "list-failed" | "heartbeat-failed";

/** What the watch tells the log: still stale (each look while it is), or uploading again. */
export type UploadsEvent = { readonly state: "stale"; readonly minutes: number; readonly reason: UploadsReason } | { readonly state: "ok"; readonly minutes: number };

/**
 * ARE UPLOADS LANDING? (G3; INTERFACE-GAPS §7.) The sidecar running says
 * nothing about R2 accepting what it sends. So, every `UPLOADS_EVERY_MS`:
 *
 *   1. one LIST of `control/accounts.sqlite/`: the highest TXID there. Above
 *      the last look's ⇒ an upload landed since; the clock of the last rise moves.
 *   2. one write to `accounts.sqlite` (`Accounts.heartbeat`), so the next look
 *      has something Litestream must have shipped by then, even on a day nobody
 *      writes anything.
 *
 * `stale` is no rise for `UPLOADS_STALE_MS`, whatever the cause (R2 refusing,
 * the LIST failing, a child that runs and ships nothing). `/readyz` reads
 * `state()`, which is arithmetic on the cached time: no R2 call per hit.
 *
 * A FRESH BOOT can't be stale: `begin()` (when the sidecar starts) sets the
 * last rise to now, so the first `stale` is `UPLOADS_STALE_MS` after a start in
 * which no rise was ever seen. A rise needs two looks (a baseline, then above
 * it), and the second comes `UPLOADS_EVERY_MS` in, well inside that.
 *
 * What it doesn't see: one store's replica failing (its own SSE-C key file)
 * while control's uploads land. Litestream's own `level=ERROR` lines in the log
 * are the signal for that (INTERFACE-GAPS §7).
 */
export class UploadWatch {
  private lastMax: bigint | null = null;
  private lastRiseAt: number | null = null;
  private wasStale = false;
  private looking = false;
  private stopped = false;
  private readonly opts: {
    readonly objects: ObjectStore;
    readonly heartbeat: () => void;
    /** The replica prefix it LISTs (control's accounts database: under a re-keyed control's base after WB1's migration). Absent: `WATCHED_REPLICA`. */
    readonly prefix?: () => string;
    readonly now: () => number;
    readonly staleAfterMs?: number;
    readonly onEvent?: (e: UploadsEvent) => void;
  };

  constructor(opts: UploadWatch["opts"]) {
    this.opts = opts;
  }

  private get staleAfterMs(): number {
    return this.opts.staleAfterMs ?? UPLOADS_STALE_MS;
  }

  /** The sidecar started: the grace begins now. Idempotent within a process (a later call keeps the first). */
  begin(): void {
    this.lastRiseAt ??= this.opts.now();
  }

  /** `stale` once no rise was seen for the threshold; `ok` before `begin` and during the first threshold after it. */
  state(): "ok" | "stale" {
    return this.lastRiseAt !== null && this.opts.now() - this.lastRiseAt > this.staleAfterMs ? "stale" : "ok";
  }

  /**
   * The server is closing: no more looks, and a look in flight skips its
   * heartbeat and its event (the accounts database may be closing under it, and
   * a `heartbeat-failed` line at shutdown would mislead).
   */
  stop(): void {
    this.stopped = true;
  }

  /** One look: the LIST, then the heartbeat. Never throws; a look still running makes this one a no-op. */
  async look(): Promise<void> {
    if (this.stopped || this.looking || this.lastRiseAt === null) return;
    this.looking = true;
    try {
      const riseBefore = this.lastRiseAt;
      let reason: UploadsReason = "no-rise";
      try {
        const watched = this.opts.prefix?.() ?? WATCHED_REPLICA;
        const max = maxTxid(await this.opts.objects.list(watched), watched);
        if (this.lastMax !== null && max > this.lastMax) this.lastRiseAt = this.opts.now();
        // Lower than before (a restore, a new bucket): the new baseline, not a rise.
        this.lastMax = max;
      } catch {
        reason = "list-failed";
      }
      if (this.stopped) return;
      try {
        this.opts.heartbeat();
      } catch {
        if (reason === "no-rise") reason = "heartbeat-failed";
      }
      const stale = this.state() === "stale";
      // Stale: minutes since the last rise. Back to ok: how long it was without one.
      const minutes = Math.floor((this.opts.now() - riseBefore) / 60_000);
      try {
        if (stale) this.opts.onEvent?.({ state: "stale", minutes, reason });
        else if (this.wasStale) this.opts.onEvent?.({ state: "ok", minutes });
      } catch {
        /* a log, not a gate */
      }
      this.wasStale = stale;
    } finally {
      this.looking = false;
    }
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
