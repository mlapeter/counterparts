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
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { Accounts } from "./accounts.js";
import { controlVolume, foreignControlRefusal } from "./app.js";
import type { AppBackupOptions } from "./app.js";
import { Backups, CONTROL_KEY_ID, keyObject, keyObjectId, legacyKeyObject, tombstoneObject } from "./backup.js";
import { KEK_CURRENT_ENV, KEK_ENV, KeyStore, sealedHeader } from "./keys.js";
import type { RecoveryOpener } from "./keys.js";
import { STORE_ID, storeTag, tenantDir } from "./tenants.js";

const tagOf = (id: string): string => (id === CONTROL_KEY_ID ? CONTROL_KEY_ID : storeTag(id));

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
export async function migrateKeys(dataRoot: string, backup: AppBackupOptions, opts: { dryRun?: boolean } = {}): Promise<{ text: string; left: number }> {
  const dry = opts.dryRun === true;
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
export async function recoverKeys(dataRoot: string, backup: AppBackupOptions, opener: RecoveryOpener, opts: { dryRun?: boolean } = {}): Promise<{ text: string; failed: number }> {
  const dry = opts.dryRun === true;
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
    const failed: string[] = [];
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
      const mine = keys === null ? null : await keys.keyId(id);
      if (mine !== null) {
        if (mine === h.keyId) here += 1;
        else failed.push(`${tagOf(id)}: this volume has another key for it (kept; the bucket's is not adopted)`);
        continue;
      }
      let dek: Buffer;
      try {
        dek = opener.open(sealed, id);
      } catch {
        failed.push(`${tagOf(id)}: its sealed key doesn't open (damaged, or sealed for another id)`);
        continue;
      }
      try {
        if (!dry && keys !== null) {
          await keys.adoptDek(id, dek);
          // The key file is written again from this key by the next start (`ensureStore`).
          rmSync(id === CONTROL_KEY_ID ? join(dataRoot, "control", "litestream.key") : join(tenantDir(join(dataRoot, "tenants"), id), "litestream.key"), { force: true });
        }
      } finally {
        dek.fill(0);
      }
      brought += 1;
    }
    const lines = [
      `${dry ? "recover-keys --dry-run (nothing written)" : "recover-keys"}: recovery key ${opener.fingerprint}`,
      `${String(brought)} keys ${dry ? "open with it, and would be brought back from the bucket" : "brought back from the bucket (wrapped under this volume's key, keys/volume.kek)"}`,
      `${String(here)} already here (the same key), ${String(deleted)} skipped (the bucket has their tombstone: deleted)`,
    ];
    if (other > 0) lines.push(`${String(other)} sealed to another recovery key`);
    if (failed.length > 0) lines.push(`${String(failed.length)} not brought back:`, ...failed.map((f) => `  - ${f}`));
    if (backup.sealer.fingerprint !== opener.fingerprint) lines.push(`note: HOSTED_RECOVERY_PUBKEY is another key (${backup.sealer.fingerprint}); the next start seals every key to it`);
    if (!dry) lines.push(failed.length === 0 ? "next: deploy with RESTORE_ON_BOOT=1 (docs/hosted/RUNBOOK.md, Restore)." : "fix the lines above, then run it again (it is safe to repeat).");
    return { text: lines.join("\n"), failed: failed.length };
  } finally {
    keys?.close();
  }
}
