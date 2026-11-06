/**
 * WRITE-ONLY BACKUPS' TWO COMMANDS (WB1, 2026-11-06): `migrate-keys` (the keys
 * from `HOSTED_KEKS` moved onto the volume KEK, the bucket's key objects sealed
 * to the recovery key, the old ones removed) and `recover-keys` (after a volume
 * is lost: the bucket's sealed keys opened with the private key Mike gives it,
 * and wrapped here under a new volume KEK). Both run with the server stopped.
 *
 * Neither prints a key, an id or an address: counts, the recovery key's
 * fingerprint, and a store's tag (`storeTag`) when one needs a look. No cipher
 * here: every one is in keys.ts.
 */
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { Accounts } from "./accounts.js";
import { controlVolume, foreignControlRefusal } from "./app.js";
import type { AppBackupOptions } from "./app.js";
import { Backups, CONTROL_BASE, CONTROL_KEY_ID, CONTROL_NEXT_ID, keyObject, keyObjectId, legacyKeyObject, replicaPrefix, tombstoneObject } from "./backup.js";
import type { LitestreamRun, Sidecar } from "./backup.js";
import { KEK_CURRENT_ENV, KEK_ENV, KeyStore, VOLUME_KEK_VERSION, kekVersionOf, litestreamKey, sealedHeader } from "./keys.js";
import type { RecoveryOpener } from "./keys.js";
import { STORE_ID, storeTag, tenantDir } from "./tenants.js";

const tagOf = (id: string): string => (id === CONTROL_KEY_ID ? CONTROL_KEY_ID : storeTag(id));

/**
 * THE RUNNING SERVER'S MARK (the #768 delta review): `serve` rewrites
 * `<data root>/serving.heartbeat` every `SERVING_EVERY_MS` while it listens, and
 * removes it at a clean stop. A mark younger than `SERVING_STALE_MS` means a
 * server is (or was just) running on this volume; an older one is a crash's.
 */
export const SERVING_MARK = "serving.heartbeat";
export const SERVING_EVERY_MS = 15_000;
export const SERVING_STALE_MS = 60_000;

/** Refuses when a server's mark is fresh on this volume. */
export function refuseWhileServing(dataRoot: string, what: string, now: () => number = Date.now): void {
  const mark = join(dataRoot, SERVING_MARK);
  if (!existsSync(mark)) return;
  const age = now() - statSync(mark).mtimeMs;
  if (age < SERVING_STALE_MS) {
    throw new Error(`a server is running on this volume (its heartbeat is ${String(Math.max(0, Math.round(age / 1000)))} s old): ${what} runs with the server stopped (a start-command override, or hold). If it stopped just now, wait a minute and run it again. Nothing was written`);
  }
}

/** What `replicaProof` found. */
type ReplicaProof =
  | { state: "ok"; base: string | null }
  | { state: "refused" | "empty" | "cannot" }
  | { state: "denied" | "unreadable" }
  | { state: "several"; bases: string[] };

/** The places under `control/` that hold control replica objects: the default (`control/`) and each `control/<id>/`. */
export async function controlBasesInBucket(objects: AppBackupOptions["objects"]): Promise<string[]> {
  const bases = new Set<string>();
  for (const k of await objects.list(CONTROL_BASE)) {
    if (/^control\/(accounts|oauth)\.sqlite\//.test(k)) bases.add(CONTROL_BASE);
    const m = /^(control\/[A-Za-z0-9_-]{22}\/)(accounts|oauth)\.sqlite\//.exec(k);
    if (m !== null) bases.add(m[1]!);
  }
  return [...bases].sort();
}

/**
 * A sealed key, proven against the store's own replica (the #768 reviews' M2):
 * EVERY object under its replica opens under the key's SSE-C key ("ok"), one
 * doesn't ("refused": the key object may be forged, or the replica mixed), the
 * token is refused ("denied", a 403: says nothing of the key), or there is
 * nothing to try ("empty"). Control: refused when more than one place under
 * `control/` holds replica objects ("several"): a forger who sealed a key of
 * theirs AND planted a replica under it beside the honest one is told apart only
 * by a person. "ok" says where control's replicas are (`base`, null for the
 * default).
 *
 * What it catches: a lone forged key object, an accident, a mixed replica. Not:
 * someone with R2 write who replaced a store's whole replica with one under
 * their own key. The defence there is rotating the R2 token BEFORE a recovery.
 */
async function replicaProof(backup: AppBackupOptions, id: string, dek: Buffer): Promise<ReplicaProof> {
  const check = backup.objects.readableWith?.bind(backup.objects);
  let prefixes: string[];
  let base: string | null = null;
  if (id === CONTROL_KEY_ID) {
    const bases = await controlBasesInBucket(backup.objects);
    if (bases.length > 1) return { state: "several", bases };
    if (bases.length === 0) return { state: "empty" };
    base = bases[0] === CONTROL_BASE ? null : bases[0]!;
    prefixes = [`${bases[0]!}accounts.sqlite/`, `${bases[0]!}oauth.sqlite/`];
  } else prefixes = [replicaPrefix(id)];
  const objects: string[] = [];
  for (const p of prefixes) objects.push(...(await backup.objects.list(p)));
  if (objects.length === 0) return { state: "empty" };
  if (check === undefined) return { state: "cannot" };
  const sse = litestreamKey(dek);
  let opened = 0;
  for (const o of objects) {
    const r = await check(o, sse);
    if (r === "denied") return { state: "denied" };
    if (r === "wrong-key") return { state: "refused" };
    if (r === "other") return { state: "unreadable" };
    if (r === "ok") opened += 1;
  }
  // Every object gone between the LIST and its GET: nothing was opened, so nothing is proven.
  return opened === 0 ? { state: "empty" } : { state: "ok", base };
}

/**
 * `migrate-keys [--dry-run]` (WB1): from the shape before WB1 (DEKs wrapped
 * under `HOSTED_KEKS`, which sits in the environment beside the R2 token, and
 * each `keys/<id>.wrapped` in the bucket under it) to write-only backups. With
 * the server stopped, and `HOSTED_KEKS` still set:
 *
 *   1. every key in `keys.sqlite` must open (a ring that can't is refused, and
 *      nothing is written);
 *   2. each key still under `HOSTED_KEKS` is rewrapped under the volume KEK
 *      (`keys/volume.kek`, made now if this volume has none);
 *   3. a live store (or control) with no key here whose only copy is an old
 *      `.wrapped` object is adopted, as a start would;
 *   4. every live store's and control's `keys/<id>.sealed` is put where it is
 *      missing or sealed to an older recovery key, never over one naming another
 *      key;
 *   5. every old `keys/<id>.wrapped` is DELETED once it is proven redundant:
 *      it opens to the key here and that key's sealed object is right; or it is
 *      a deleted store's (its tombstone, or accounts says deleted). Anything else
 *      is kept and counted, and `HOSTED_KEKS` must stay.
 *
 * IDEMPOTENT: a run cut short anywhere is finished by running it again, and a
 * second run on a migrated volume does nothing. `dryRun` reads everything,
 * writes nothing (not even the volume KEK), and says what a run would do.
 */
export async function migrateKeys(
  dataRoot: string,
  backup: AppBackupOptions,
  opts: {
    dryRun?: boolean;
    recoveryFingerprint?: string;
    abortControlRekey?: boolean;
    litestream?: { sidecar: (configPath: string) => Sidecar; run: LitestreamRun; proveMs?: number };
    now?: () => number;
  } = {},
): Promise<{ text: string; left: number }> {
  const dry = opts.dryRun === true;
  // Never beside a running server (the #768 delta review): its sidecar and its writes would race every step below.
  if (!dry) refuseWhileServing(dataRoot, "migrate-keys", opts.now);
  const accountsPath = join(dataRoot, "control", "accounts.sqlite");
  if (!existsSync(accountsPath)) throw new Error("no accounts database on this volume: nothing to migrate (a new server starts in the new shape by itself)");
  const keysPath = join(dataRoot, "keys", "keys.sqlite");
  if (!existsSync(keysPath)) throw new Error("no keys/keys.sqlite on this volume: nothing to migrate here. If the volume was lost, bring the keys back with recover-keys (docs/hosted/RUNBOOK.md, Restore)");
  const keys = new KeyStore({ path: keysPath, wrapper: backup.wrapper });
  const accounts = new Accounts({ path: accountsPath });
  try {
    const live = accounts.liveStoreIds();
    const deleted = new Set(accounts.deletedStoreIds());
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, sealer: backup.sealer, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => live });
    const unreadable = await keys.unreadable();
    if (unreadable.length > 0) {
      throw new Error(`${String(unreadable.length)} keys in keys/keys.sqlite don't open with ${KEK_ENV} and keys/volume.kek: set ${KEK_ENV} as it was before WB1 (every version) and run migrate-keys again. Nothing was written`);
    }
    const would = dry ? "would be " : "";
    const lines: string[] = [];
    const kept: string[] = [];

    if (opts.abortControlRekey === true) {
      // Backing out of a control re-key that won't prove (Litestream can't reach the bucket, say): the old key stays.
      if (dry) return { text: `migrate-keys --abort-control-rekey --dry-run (nothing written):\n${keys.wrapped(CONTROL_NEXT_ID) === null ? "no control re-key is pending: nothing to back out" : "a pending control re-key would be backed out: the old control key kept, the new key and its replicas deleted"}`, left: 0 };
      const r = await backups.abortControlRekey();
      return {
        text: r.aborted
          ? `migrate-keys --abort-control-rekey:\nthe control re-key backed out: the old control key kept (and sealed in the bucket again), the new key and its ${String(r.deleted)} replica objects deleted. The server starts again; run migrate-keys later to re-key control (docs/hosted/RUNBOOK.md, Write-only backups)`
          : "migrate-keys --abort-control-rekey:\nno control re-key is pending: nothing to back out",
        left: 0,
      };
    }

    // 0. THE RECOVERY KEY, NAMED (the #768 reviews' M3): the old key objects are the last copies the old KEK opens, and a
    // mistyped recovery key would leave none that open. So nothing is moved, re-keyed or deleted unless the run names the
    // fingerprint Mike checked on his Mac against both offline copies (`recovery-fingerprint`), and it is the one every
    // key object is sealed to. The private key itself never comes near the server for this.
    const fp = backup.sealer.fingerprint;
    const named = opts.recoveryFingerprint;
    if (!dry && named === undefined) throw new Error(`name the recovery key: migrate-keys --recovery-fingerprint <the fingerprint written beside your offline copies>. Nothing was written`);
    if (!dry && named !== fp) throw new Error(`--recovery-fingerprint ${String(named)} isn't the recovery key HOSTED_RECOVERY_PUBKEY names: compare it with the fingerprint written beside your offline copies (recovery-fingerprint) and the variable. Nothing was written`);
    // Never the server's own fingerprint as the value to pass: a run must name the one written beside the offline copies.
    lines.push(named === fp ? `recovery key: the one named (--recovery-fingerprint)` : `recovery key: ${named === undefined ? "not named" : "NOT the key the bucket is sealed to"}; a run needs --recovery-fingerprint <the fingerprint written beside your offline copies>; compare it with the one this server's start logs`);
    if (named !== fp) kept.push(`the recovery key isn't named: run with --recovery-fingerprint <the fingerprint beside your offline copies>`);

    // 1b. Control's key once under HOSTED_KEKS ⇒ a re-key (HIGH 1). Recorded BEFORE the rewrap below moves it onto the
    // volume KEK, so a run cut short still knows.
    const controlWrapped = keys.wrapped(CONTROL_KEY_ID);
    const controlWasLegacy = (controlWrapped !== null && kekVersionOf(controlWrapped) !== VOLUME_KEK_VERSION) || (await backup.objects.get(legacyKeyObject(CONTROL_KEY_ID))) !== null;
    if (controlWasLegacy && !dry && keys.replicaBase(CONTROL_KEY_ID) === null) keys.recordFact("control-rekey-due");
    const rekeyDue = backups.controlRekeyDue() || (dry && controlWasLegacy && keys.replicaBase(CONTROL_KEY_ID) === null);

    // 2. Onto the volume KEK.
    const toMove = keys.notOnCurrent();
    if (!dry && toMove > 0) await keys.rewrap(backup.wrapper);
    lines.push(`${String(toMove)} keys ${would}moved from ${KEK_ENV} onto the volume key (keys/volume.kek)`);

    // 3. Live keys whose only copy is an old object in the bucket.
    const adoptable = new Set<string>();
    for (const id of [CONTROL_KEY_ID, ...live]) {
      if (keys.wrapped(id) !== null || (await backup.objects.get(keyObject(id))) !== null) continue;
      const old = await backup.objects.get(legacyKeyObject(id));
      if (old === null) continue;
      try {
        if (dry) (await keys.unwrapForCheck(id, old)).fill(0);
        else await keys.adopt(id, old);
        adoptable.add(id);
      } catch {
        kept.push(`${tagOf(id)}: its only key is an old key object that doesn't open with ${KEK_ENV}`);
      }
    }
    if (adoptable.size > 0) lines.push(`${String(adoptable.size)} keys ${would}adopted from the bucket's old key objects (no key for them was on this volume)`);

    // 3b. The control re-key (HIGH 1): a new control key, new control replicas, proven, then the old ones gone.
    if (rekeyDue) {
      if (dry) lines.push("control would be re-keyed: a new control key, its databases replicated under it to a new place, proven by a restore, then the old control replicas deleted");
      else if (opts.litestream === undefined) kept.push(`control: its key was under ${KEK_ENV} and needs a re-key, which needs Litestream (run migrate-keys from the server's image)`);
      else {
        await backups.rekeyControl(opts.litestream);
        lines.push(`control re-keyed: a new control key; the control databases replicated under it (${backups.controlBase()}), proven by a restore; the old control replicas deleted`);
      }
    } else if (!dry) {
      // A run after a re-key that stopped before its last step: the old replicas still go.
      const dropped = await backups.dropOldControlReplicas();
      if (dropped > 0) lines.push(`${String(dropped)} old control replica objects (from before the re-key) deleted`);
    }

    // 4. The sealed objects. In a dry run the adoptable ones count as here.
    const sync = await backups.syncKeyObjects({ dryRun: dry });
    const sealedPut = sync.put + (dry ? adoptable.size : 0);
    for (const id of sync.different) kept.push(`${tagOf(id)}: the bucket's sealed key object names another key than this volume's (nothing was put over it)`);
    lines.push(`${String(sealedPut)} sealed key objects ${dry ? "would be " : ""}written (sealed to recovery key ${backup.sealer.fingerprint})`);

    // 5. The old objects.
    let removed = 0;
    let leftovers = 0;
    for (const name of await backup.objects.list("keys/")) {
      const parsed = keyObjectId(name);
      if (parsed === null || !parsed.legacy) continue;
      const id = parsed.id;
      if (id !== CONTROL_KEY_ID && !STORE_ID.test(id)) {
        kept.push(`an old key object whose name isn't a store's (${name.length} characters): left as it is`);
        continue;
      }
      const old = await backup.objects.get(name);
      if (old === null) continue;
      const isLive = id === CONTROL_KEY_ID || live.includes(id);
      if (!isLive) {
        // A deleted store's key object, left by a delete that didn't finish: the erase, finished.
        const gone = deleted.has(id) || (await backup.objects.get(tombstoneObject(id))) !== null;
        if (!gone) {
          kept.push(`${tagOf(id)}: an old key object of a store that isn't in the accounts database`);
          continue;
        }
        if (!dry) await backup.objects.delete(name);
        removed += 1;
        leftovers += 1;
        continue;
      }
      if (adoptable.has(id)) {
        // Adopted from this very object (or, in a dry run, would be).
        if (!dry) await backup.objects.delete(name);
        removed += 1;
        continue;
      }
      if (id === CONTROL_KEY_ID && (backups.controlBase() !== CONTROL_BASE || (dry && rekeyDue))) {
        // The OLD control key, after the re-key (or in a dry run, the one it would replace): its replicas are gone, so it opens nothing we keep.
        if (!dry) await backup.objects.delete(name);
        removed += 1;
        continue;
      }
      if (keys.wrapped(id) === null) {
        kept.push(`${tagOf(id)}: an old key object for a live store with no key here and a sealed one in the bucket`);
        continue;
      }
      let same = false;
      try {
        const theirs = await keys.unwrapForCheck(id, old);
        const mine = await keys.dek(id);
        same = theirs.equals(mine);
        theirs.fill(0);
        mine.fill(0);
      } catch {
        kept.push(`${tagOf(id)}: its old key object doesn't open with ${KEK_ENV}`);
        continue;
      }
      if (!same) {
        kept.push(`${tagOf(id)}: its old key object is another key than this volume's`);
        continue;
      }
      const state = await backups.sealedState(id);
      if (state !== "ok" && !(dry && (state === "missing" || state === "stale"))) {
        kept.push(`${tagOf(id)}: its sealed key object isn't right yet (${String(state)})`);
        continue;
      }
      if (!dry) await backup.objects.delete(name);
      removed += 1;
    }
    lines.push(`${String(removed)} old key objects (keys/<id>.wrapped, under ${KEK_ENV}) ${dry ? "would be " : ""}deleted${leftovers > 0 ? ` (${String(leftovers)} of them deleted stores' leftovers)` : ""}`);
    const stillLegacy = dry ? 0 : keys.notOnCurrent();
    if (stillLegacy > 0) kept.push(`${String(stillLegacy)} keys here are still under ${KEK_ENV}`);
    if (kept.length > 0) {
      lines.push(`${String(kept.length)} things ${dry ? "would be " : ""}left that still need ${KEK_ENV} or a look:`, ...kept.map((k) => `  - ${k}`));
      lines.push(dry ? `a run would NOT finish the migration: keep ${KEK_ENV}, and tell the coordinator about the lines above.` : `NOT done: keep ${KEK_ENV} set, and tell the coordinator about the lines above (a run again is safe).`);
    } else {
      lines.push(
        dry
          ? `a run would finish the migration: nothing here or in the bucket would need ${KEK_ENV} after it.`
          : `done: nothing here or in the bucket needs ${KEK_ENV} now. Remove ${KEK_ENV} and ${KEK_CURRENT_ENV} from the environment (docs/hosted/RUNBOOK.md, Write-only backups).`,
      );
    }
    return { text: `${dry ? "migrate-keys --dry-run (nothing written)" : "migrate-keys"}:\n${lines.join("\n")}`, left: kept.length };
  } finally {
    keys.close();
    accounts.close();
  }
}

/**
 * `recover-keys [--dry-run]` (WB1): AFTER A VOLUME IS LOST, the bucket's keys,
 * brought back with the offline recovery key, with the server stopped. Every
 * `keys/<id>.sealed` in the bucket (control's and each store's) is opened with
 * the private key, checked against its key id, and wrapped here under this
 * volume's KEK (a new one on a new volume). Then a `RESTORE_ON_BOOT=1` start (or
 * `restore --all`) restores the databases as it always has, needing no private
 * key.
 *
 * Skipped, and counted: a store the bucket has a tombstone for (deleted; the
 * next start finishes its delete), and a key this volume already holds (the
 * same key, by its key id; another key is never replaced). Refused, before
 * anything is written: control databases on this volume without the control key
 * (they aren't the bucket's: `controlAside` moves them first), and a private key
 * that isn't the one the bucket's keys are sealed to.
 *
 * `dryRun` opens every sealed key and writes nothing: the offline copy proven
 * against the bucket.
 */
export async function recoverKeys(dataRoot: string, backup: AppBackupOptions, opener: RecoveryOpener, opts: { dryRun?: boolean; adoptUnproven?: boolean } = {}): Promise<{ text: string; failed: number }> {
  const dry = opts.dryRun === true;
  if (!dry) refuseWhileServing(dataRoot, "recover-keys");
  // Never the control key beside control databases that aren't the bucket's (the #653 review, H1).
  const foreign = foreignControlRefusal(dataRoot, await controlVolume(dataRoot, backup));
  if (foreign !== null && !dry) throw new Error(foreign.replace(/^refused: /, ""));
  const names = await backup.objects.list("keys/");
  const ids: string[] = [];
  for (const name of names) {
    const parsed = keyObjectId(name);
    if (parsed === null || parsed.legacy) continue;
    if (parsed.id === CONTROL_KEY_ID || STORE_ID.test(parsed.id)) ids.push(parsed.id);
  }
  // Control first: a run cut short leaves the accounts' key here before any store's.
  ids.sort((a, b) => (a === CONTROL_KEY_ID ? -1 : b === CONTROL_KEY_ID ? 1 : 0));
  const sealedTo = new Set<string>();
  const headers = new Map<string, string>();
  for (const id of ids) {
    const sealed = await backup.objects.get(keyObject(id));
    if (sealed === null) continue;
    headers.set(id, sealed);
    const h = sealedHeader(sealed);
    if (h !== null) sealedTo.add(h.fingerprint);
  }
  if (headers.size === 0) throw new Error(`the bucket has no sealed key objects (keys/<id>.sealed): nothing to recover. A bucket from before WB1 is restored with ${KEK_ENV} (RESTORE_ON_BOOT=1)`);
  if (!sealedTo.has(opener.fingerprint)) {
    throw new Error(`this private key (fingerprint ${opener.fingerprint}) isn't the recovery key the bucket's keys are sealed to (${[...sealedTo].sort().join(", ")}). Nothing was written`);
  }
  const keysPath = join(dataRoot, "keys", "keys.sqlite");
  const keys = dry && !existsSync(keysPath) ? null : new KeyStore({ path: keysPath, wrapper: backup.wrapper });
  try {
    if (keys !== null) {
      const unreadable = await keys.unreadable();
      if (unreadable.length > 0) throw new Error(`${String(unreadable.length)} keys already in keys/keys.sqlite don't open (keys/volume.kek missing or not this volume's): remove keys/ (rm -rf /data/keys) and run recover-keys again. Nothing was written`);
    }
    let brought = 0;
    let here = 0;
    let deleted = 0;
    let other = 0;
    let opened = 0;
    let unproven = 0;
    const failed: string[] = [];
    const warnings: string[] = [];
    const legacyControl = (await backup.objects.get(legacyKeyObject(CONTROL_KEY_ID))) !== null;
    for (const [id, sealed] of headers) {
      if (id !== CONTROL_KEY_ID && (await backup.objects.get(tombstoneObject(id))) !== null) {
        deleted += 1;
        continue;
      }
      const h = sealedHeader(sealed);
      if (h === null) {
        failed.push(`${tagOf(id)}: its key object isn't a sealed key`);
        continue;
      }
      if (h.fingerprint !== opener.fingerprint) {
        other += 1;
        failed.push(`${tagOf(id)}: sealed to another recovery key (${h.fingerprint})`);
        continue;
      }
      // Every sealed key is OPENED, the ones this volume holds too: that is what proves the private key (M3).
      let dek: Buffer;
      try {
        dek = opener.open(sealed, id);
      } catch {
        failed.push(`${tagOf(id)}: its sealed key doesn't open (damaged, or sealed for another id)`);
        continue;
      }
      try {
        opened += 1;
        if (keys !== null && keys.wrapped(id) !== null) {
          const mine = await keys.dek(id);
          const same = mine.equals(dek);
          mine.fill(0);
          if (same) here += 1;
          else failed.push(`${tagOf(id)}: this volume has another key for it (kept; the bucket's is not adopted)`);
          continue;
        }
        // NOT ADOPTED UNPROVEN (the #768 review's M2): anyone with R2 write can seal
        // a key of their choosing to the public key. So a key is adopted only once
        // one of the store's own replica objects opens under its SSE-C key.
        const proof = await replicaProof(backup, id, dek);
        if (proof.state === "refused") {
          failed.push(`${tagOf(id)}: its replica doesn't open under the sealed key's SSE-C key: the key object may be FORGED (someone with R2 write access). Not adopted`);
          continue;
        }
        if (proof.state === "unreadable") {
          failed.push(`${tagOf(id)}: the bucket answered a replica object with an error that says nothing about the key (not 200, 400, 403 or 404). Not adopted; run it again, and tell the coordinator if it repeats`);
          continue;
        }
        if (proof.state === "denied") {
          failed.push(`${tagOf(id)}: the bucket refused the request (403): check the R2 token (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). Not adopted`);
          continue;
        }
        if (proof.state === "several") {
          failed.push(`control: more than one place in the bucket holds control replicas (${proof.bases.join(", ")}): someone may have planted one beside the real one. Not adopted; tell the coordinator, and rotate the R2 token first`);
          continue;
        }
        if (proof.state === "cannot") {
          failed.push(`${tagOf(id)}: this object store can't check a replica: not adopted`);
          continue;
        }
        if (proof.state === "empty") {
          if (opts.adoptUnproven !== true) {
            // Nothing is under its key: never opened, or never replicated. Left, and given a new key at its first open.
            unproven += 1;
            continue;
          }
          warnings.push(`WARNING: ${tagOf(id)} adopted with NO replica to prove its key against (--adopt-unproven): if anyone else could write the bucket, its future backups may be under THEIR key`);
        }
        if (!dry && keys !== null) {
          // In this order, so a crash anywhere leaves nothing that disagrees: no key file of another key (the next
          // start writes it from this key), control's replica place before its key, then the key.
          rmSync(id === CONTROL_KEY_ID ? join(dataRoot, "control", "litestream.key") : join(tenantDir(join(dataRoot, "tenants"), id), "litestream.key"), { force: true });
          if (id === CONTROL_KEY_ID && proof.state === "ok" && proof.base !== null) keys.setReplicaBase(CONTROL_KEY_ID, proof.base);
          await keys.adoptDek(id, dek);
          // The bucket still has the control key from before WB1: migrate-keys re-keys control (HIGH 1).
          if (id === CONTROL_KEY_ID && legacyControl) keys.recordFact("control-rekey-due");
        }
        brought += 1;
      } finally {
        dek.fill(0);
      }
    }
    // THE PROOF (M3): this private key opened every sealed key it met, each this volume's or proven against its
    // replica. migrate-keys deletes nothing without it. The only write a dry run makes, and only on a volume with keys.
    const proven = keys !== null && failed.length === 0 && opened > 0;
    if (proven) keys.recordProof(opener.fingerprint, opened);
    const lines = [
      `${dry ? "recover-keys --dry-run (nothing written but the proof)" : "recover-keys"}: recovery key ${opener.fingerprint}: ${String(opened)} sealed keys opened with it`,
      `${String(brought)} keys ${dry ? "would be brought back from the bucket (each proven against its replica)" : "brought back from the bucket (each proven against its replica; wrapped under this volume's key, keys/volume.kek)"}`,
      `${String(here)} already here (the same key), ${String(deleted)} skipped (the bucket has their tombstone: deleted)`,
    ];
    if (unproven > 0) lines.push(`${String(unproven)} not adopted: no replica to prove the key against (never opened, or never backed up). Each gets a new key at its first open; --adopt-unproven adopts them anyway`);
    lines.push(...warnings);
    if (other > 0) lines.push(`${String(other)} sealed to another recovery key`);
    if (failed.length > 0) lines.push(`${String(failed.length)} not brought back:`, ...failed.map((f) => `  - ${f}`));
    if (backup.sealer.fingerprint !== opener.fingerprint) lines.push(`note: HOSTED_RECOVERY_PUBKEY is another key (${backup.sealer.fingerprint}); the next start seals every key to it`);
    if (proven) lines.push(`proof recorded: recovery key ${opener.fingerprint} opens this bucket's keys`);
    if (!dry) lines.push(failed.length === 0 ? "next: deploy with RESTORE_ON_BOOT=1 (docs/hosted/RUNBOOK.md, Restore)." : "fix the lines above, then run it again (it is safe to repeat).");
    return { text: lines.join("\n"), failed: failed.length };
  } finally {
    keys?.close();
  }
}
