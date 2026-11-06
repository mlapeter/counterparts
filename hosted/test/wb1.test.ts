/**
 * WB1, WRITE-ONLY BACKUPS (2026-11-06): what a leak of the environment gets
 * (nothing), what a restart needs (the volume, no private key), the migration
 * from the shape before (HOSTED_KEKS in the environment, each DEK in the bucket
 * under it), and the erase. Through `main.ts` as its own process wherever the
 * real path is a command; against the S3 stand-in (helpers.ts), which enforces
 * SSE-C; every key a throwaway made here.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { Accounts } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import type { AppBackupOptions } from "../src/app.js";
import { Backups, CONTROL_KEY_ID, KeySealed, LitestreamSidecar, keyObject, legacyKeyObject, litestreamRunner, tombstoneObject } from "../src/backup.js";
import { memoryMailer, r2ObjectStore } from "../src/egress.js";
import { EnvKeyWrapper, KeyStore, RecoverySealer, VOLUME_KEK_FILE, VolumeKeyWrapper, kekVersionOf, keyIdOf, litestreamKey, recoveryOpenerFromText } from "../src/keys.js";
import { migrateKeys, recoverKeys, refuseWhileServing } from "../src/keyops.js";
import { backupFromEnv, prepareVolume } from "../src/main.js";
import { storeTag, tenantDir } from "../src/tenants.js";
import { MAIN, RECOVERY, freePort, s3StandIn, spawnServe, tempRoot, testRecovery } from "./helpers.js";
import type { S3StandIn } from "./helpers.js";

const STANDIN = fileURLToPath(new URL("./fixtures/litestream-standin.mjs", import.meta.url));
const CREDS = { id: "test-generated-id", secret: randomBytes(20).toString("hex") };

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("wb1");
});
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* closed */
    }
  }
  tmp.remove();
});

async function bucket(): Promise<S3StandIn> {
  const s3 = await s3StandIn({ tls: { dir: tmp.root } });
  closers.push(() => s3.close());
  return s3;
}

function standin(ca: string): string {
  const bin = join(tmp.root, "litestream");
  writeFileSync(bin, `#!/bin/sh\nNODE_EXTRA_CA_CERTS="${ca}" exec "${process.execPath}" "${STANDIN}" "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

/** Production's environment for `main.ts`, against the stand-in, exactly: no HOSTED_KEKS unless `extra` says so. */
function envOf(s3: S3StandIn, dataRoot: string, port: number, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: tmp.root,
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    HOSTED_DATA_ROOT: dataRoot,
    PUBLIC_ORIGIN: `http://127.0.0.1:${String(port)}`,
    PORT: String(port),
    MAIL: "log",
    COOKIE_KEYS: randomBytes(32).toString("base64"),
    HOSTED_RECOVERY_PUBKEY: RECOVERY.publicText,
    R2_ENDPOINT: s3.tlsBase!,
    R2_BUCKET: "bkt",
    R2_ACCESS_KEY_ID: CREDS.id,
    R2_SECRET_ACCESS_KEY: CREDS.secret,
    NODE_EXTRA_CA_CERTS: s3.ca!,
    LITESTREAM_BIN: standin(s3.ca!),
    ...extra,
  };
}

/** A `main.ts` command as its own process, `input` on its stdin. Asynchronous: the stand-in answers from this process. */
function cli(env: Record<string, string>, args: string[], input = ""): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [...scriptArgs(MAIN), ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr!.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const t = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.once("close", (status) => {
      clearTimeout(t);
      done({ status, stdout, stderr });
    });
    child.stdin!.end(input);
  });
}

const objectsOf = (s3: S3StandIn): AppBackupOptions["objects"] => r2ObjectStore({ endpoint: s3.base, bucket: "bkt", accessKeyId: CREDS.id, secretAccessKey: CREDS.secret });
const bodyOf = (s3: S3StandIn, key: string): string | null => s3.objects.get(key)?.body.toString("utf8") ?? null;

/** People with live stores, made through the accounts database (sign-up's own rows), and a start that keys them. */
async function livedVolume(s3: S3StandIn, backup: AppBackupOptions, n = 2, o: { replicas?: boolean } = {}): Promise<{ dataRoot: string; stores: string[]; people: string[] }> {
  const dataRoot = join(tmp.root, "volume");
  const accounts = new Accounts({ path: join(dataRoot, "control", "accounts.sqlite") });
  const stores: string[] = [];
  const people: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { code } = accounts.createInvite();
    const req = accounts.requestLink({ email: `wb1-${String(i)}@example.com`, inviteCode: code, timeZone: "America/Denver", browser: "b" });
    assert.ok(req.send);
    const used = accounts.useLink({ token: req.token, browser: "b" });
    assert.ok(used.ok);
    people.push(used.personId);
    stores.push(accounts.person(used.personId)!.storeId!);
  }
  accounts.close();
  const app = createApp({ dataRoot, publicOrigin: "http://127.0.0.1", mailer: memoryMailer(), embedder: null, spawner: () => ({ pid: 1 }), backup });
  await app.start();
  await app.close();
  if (o.replicas !== false) await replicas(s3, dataRoot, stores);
  return { dataRoot, stores, people };
}

/**
 * What Litestream would have put by now (no sidecar runs in these tests): one
 * object under each store's replica prefix and each control database's, under
 * that key's SSE-C key, read from its key file as Litestream reads it.
 */
async function replicas(s3: S3StandIn, dataRoot: string, stores: string[], controlBase = "control/"): Promise<void> {
  const put = async (key: string, keyFile: string): Promise<void> => {
    const sse = readFileSync(keyFile, "utf8").trim();
    const res = await fetch(`${s3.base}/bkt/${key}`, { method: "PUT", body: "ltx", headers: { "x-amz-server-side-encryption-customer-algorithm": "AES256", "x-amz-server-side-encryption-customer-key": sse } });
    assert.ok(res.ok);
  };
  for (const id of stores) await put(`tenants/${id}/0000/0000000000000001-0000000000000001.ltx`, join(tenantDir(join(dataRoot, "tenants"), id), "litestream.key"));
  for (const db of ["accounts.sqlite", "oauth.sqlite"]) await put(`${controlBase}${db}/0000/0000000000000001-0000000000000001.ltx`, join(dataRoot, "control", "litestream.key"));
}

const volumeBackup = (s3: S3StandIn, dataRoot: string, legacy: EnvKeyWrapper | null = null, sealer: RecoverySealer = RECOVERY.sealer): AppBackupOptions => ({
  wrapper: new VolumeKeyWrapper(join(dataRoot, "keys"), legacy),
  sealer,
  objects: objectsOf(s3),
  bucket: "bkt",
  endpoint: s3.base,
  sidecar: null,
});

const keysOf = (dataRoot: string, legacy: EnvKeyWrapper | null = null): KeyStore => {
  const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: new VolumeKeyWrapper(join(dataRoot, "keys"), legacy) });
  closers.push(() => keys.close());
  return keys;
};

/** Every encoding a 32-byte key could be found under in a text object. */
const spellings = (b: Buffer): string[] => [b.toString("base64"), b.toString("base64url"), b.toString("hex"), b.toString("base64").slice(0, 24)];

// ── the leak ─────────────────────────────────────────────────────────────────

describe("WB1: a leak of the environment opens nothing in the bucket", () => {
  test("the env (the R2 token, the recovery PUBLIC key, everything else) and a whole copy of the bucket: no key object opens, no key is in it, and a server built from that env on another volume refuses", async () => {
    const s3 = await bucket();
    const dataRoot0 = join(tmp.root, "volume");
    const { dataRoot, stores } = await livedVolume(s3, volumeBackup(s3, dataRoot0));
    const port = await freePort();
    const env = envOf(s3, dataRoot, port);
    // What the leak holds: every variable, and a copy of every object.
    const copy = new Map([...s3.objects].map(([k, v]) => [k, v.body.toString("utf8")]));
    const keyObjects = [...copy.keys()].filter((k) => k.startsWith("keys/"));
    assert.equal(keyObjects.length, stores.length + 1, "control's key and one per store");
    assert.ok(keyObjects.every((k) => k.endsWith(".sealed")));
    assert.ok([...copy.values()].every((v) => !v.startsWith("w1.")), "nothing in the bucket is under a KEK");

    // The secrets only the volume has: none of them, in any spelling, is in the bucket or in the env.
    const keys = keysOf(dataRoot);
    const volumeKek = Buffer.from(readFileSync(join(dataRoot, "keys", VOLUME_KEK_FILE), "utf8").trim().slice("vol1:".length), "base64");
    assert.equal(volumeKek.length, 32);
    const secrets: Buffer[] = [volumeKek];
    for (const id of [CONTROL_KEY_ID, ...stores]) {
      const dek = await keys.dek(id);
      secrets.push(dek, Buffer.from(litestreamKey(dek), "base64"));
    }
    const leaked = [...copy.values(), ...Object.values(env)].join("\n");
    for (const s of secrets) for (const spelled of spellings(s)) assert.ok(!leaked.includes(spelled), "a volume secret is in the env or the bucket");

    // Every value in the env, tried as the private key: nothing opens.
    for (const value of Object.values(env)) {
      const opener = recoveryOpenerFromText(value);
      if ("refusal" in opener) continue;
      for (const k of keyObjects) assert.throws(() => opener.open(copy.get(k)!, k.slice(5, -7)));
    }
    // Every value in the env, tried as a KEK (as HOSTED_KEKS was): no key object is a wrapped key to try it on,
    // and a key store under it refuses each sealed object.
    for (const value of Object.values(env)) {
      const raw = Buffer.from(value, "base64");
      if (raw.length !== 32) continue;
      const ring = new EnvKeyWrapper(new Map([["v1", raw]]), "v1");
      for (const k of keyObjects) await assert.rejects(ring.unwrap(copy.get(k)!, k.slice(5, -7)));
    }

    // A server built from that env on a volume of the attacker's: it has a KEK (its own, new), and no key of anyone's.
    const theirs = join(tmp.root, "attacker");
    const built = backupFromEnv(env, theirs);
    assert.ok(built !== null && !("refusal" in built));
    const theirKeys = new KeyStore({ path: join(theirs, "keys", "keys.sqlite"), wrapper: built.wrapper });
    closers.push(() => theirKeys.close());
    // (Its R2 client over the stand-in's plain port: this process doesn't trust the test certificate.)
    const theirBackup: AppBackupOptions = { ...built, objects: objectsOf(s3), sidecar: null };
    const b = new Backups({ dataRoot: theirs, keys: theirKeys, objects: theirBackup.objects, sealer: built.sealer, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => stores, openedBefore: () => true });
    for (const id of [CONTROL_KEY_ID, ...stores]) {
      await assert.rejects(b.ensureStore(id, { reload: false }), (err) => err instanceof KeySealed);
      await assert.rejects(theirKeys.adopt(id, copy.get(keyObject(id))!), /not a wrapped key/);
    }
    assert.deepEqual(theirKeys.storeIds(), []);
    // The restore path refuses too, and the bucket is as it was.
    theirKeys.close();
    await assert.rejects(prepareVolume(theirs, theirBackup, litestreamRunner("/bin/false", {})), /recover-keys/);
    const noKey = await cli({ ...env, HOSTED_DATA_ROOT: theirs }, ["recover-keys"], "");
    assert.equal(noKey.status, 1);
    assert.match(noKey.stderr, /isn't a recovery private key/);
    assert.deepEqual(new Map([...s3.objects].map(([k, v]) => [k, v.body.toString("utf8")])), copy, "the bucket unchanged");

    // The control: with the private key, every one opens to the volume's key (the test can tell).
    for (const id of [CONTROL_KEY_ID, ...stores]) assert.deepEqual(RECOVERY.opener.open(copy.get(keyObject(id))!, id), await keys.dek(id));
  });
});

// ── a restart ────────────────────────────────────────────────────────────────

describe("WB1: a restart with the volume intact needs no private key", () => {
  test("serve, with no HOSTED_KEKS and no private key anywhere, opens every store's key from the volume, twice; the bucket is untouched; keys/volume.kek is 0600", async () => {
    const s3 = await bucket();
    const { dataRoot, stores } = await livedVolume(s3, volumeBackup(s3, join(tmp.root, "volume")));
    const kek = join(dataRoot, "keys", VOLUME_KEK_FILE);
    assert.equal(statSync(kek).mode & 0o777, 0o600);
    assert.equal(statSync(join(dataRoot, "keys")).mode & 0o777, 0o700);
    const deks = new Map<string, Buffer>();
    const keys = keysOf(dataRoot);
    for (const id of [CONTROL_KEY_ID, ...stores]) {
      deks.set(id, await keys.dek(id));
      assert.equal(kekVersionOf(keys.wrapped(id)!), "vol1");
    }
    keys.close();
    const before = new Map([...s3.objects].map(([k, v]) => [k, v.body.toString("utf8")]));
    const port = await freePort();
    for (let i = 0; i < 2; i += 1) {
      const run = await spawnServe(envOf(s3, dataRoot, port));
      assert.ok(run.up, run.stderr());
      const out = await run.stop();
      assert.match(out, new RegExp(`key objects sealed to recovery key ${RECOVERY.fingerprint}`));
      assert.doesNotMatch(out, /backup\.keyless|backup\.key\.minted|HOSTED_KEKS|recover-keys/);
    }
    assert.deepEqual(new Map([...s3.objects].map(([k, v]) => [k, v.body.toString("utf8")])), before, "a restart writes no key object");
    const after = keysOf(dataRoot);
    for (const [id, dek] of deks) assert.deepEqual(await after.dek(id), dek);
  });

  test("keys/volume.kek lost beside keys under it: the start refuses, and no new volume key is made over them", async () => {
    const s3 = await bucket();
    const { dataRoot } = await livedVolume(s3, volumeBackup(s3, join(tmp.root, "volume")));
    rmSync(join(dataRoot, "keys", VOLUME_KEK_FILE));
    const run = await spawnServe(envOf(s3, dataRoot, await freePort()));
    assert.equal(run.up, false);
    assert.match(await run.stop(), /don't open: keys\/volume\.kek is missing/);
    assert.equal(existsSync(join(dataRoot, "keys", VOLUME_KEK_FILE)), false);
    const wrapper = new VolumeKeyWrapper(join(dataRoot, "keys"));
    assert.throws(() => wrapper.ready(["vol1"]), /keys\/volume\.kek is missing/);
  });
});

// ── the migration ────────────────────────────────────────────────────────────

describe("WB1: migrate-keys, from HOSTED_KEKS to the volume KEK, sealed key objects and a re-keyed control", () => {
  /**
   * TODAY'S SHAPE, built: keys.sqlite under a HOSTED_KEKS ring (v1), each key
   * object `keys/<id>.wrapped` = that wrapped value (what the build before WB1
   * put), no `.sealed` and no volume KEK, replicas at the default places
   * (`control/<db>/`); and a deleted store's `.wrapped` left behind with its
   * tombstone (a delete that didn't finish).
   */
  async function oldShape(): Promise<{ s3: S3StandIn; dataRoot: string; stores: string[]; ring: EnvKeyWrapper; ringText: string; deks: Map<string, Buffer>; leftover: string; port: number }> {
    const s3 = await bucket();
    const raw = randomBytes(32);
    const ring = new EnvKeyWrapper(new Map([["v1", raw]]), "v1");
    const backup: AppBackupOptions = { wrapper: ring, sealer: RECOVERY.sealer, objects: objectsOf(s3), bucket: "bkt", endpoint: s3.base, sidecar: null };
    const { dataRoot, stores } = await livedVolume(s3, backup);
    const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: ring });
    const deks = new Map<string, Buffer>();
    for (const id of [CONTROL_KEY_ID, ...stores]) {
      deks.set(id, await keys.dek(id));
      s3.objects.delete(keyObject(id));
      s3.objects.set(legacyKeyObject(id), { body: Buffer.from(keys.wrapped(id)!), keyMd5: null });
    }
    keys.close();
    const leftover = randomBytes(16).toString("hex");
    s3.objects.set(legacyKeyObject(leftover), { body: Buffer.from(await ring.wrap(randomBytes(32), leftover)), keyMd5: null });
    s3.objects.set(tombstoneObject(leftover), { body: Buffer.from("2026-11-01T00:00:00.000Z\n"), keyMd5: null });
    assert.equal(existsSync(join(dataRoot, "keys", VOLUME_KEK_FILE)), false);
    return { s3, dataRoot, stores, ring, ringText: `v1:${raw.toString("base64")}`, deks, leftover, port: await freePort() };
  }

  /** Mike's step 3: the release deployed with HOSTED_KEKS still set (it seals every key). No private key on the server. */
  async function releasedAndProven(o: Awaited<ReturnType<typeof oldShape>>): Promise<void> {
    const withRing = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.ok(withRing.up, withRing.stderr());
    await withRing.stop();
  }

  const snapshot = (s3: S3StandIn): Map<string, string> => new Map([...s3.objects].map(([k, v]) => [k, v.body.toString("utf8")]));
  const underControlDefault = (s3: S3StandIn): string[] => [...s3.objects.keys()].filter((k) => k.startsWith("control/accounts.sqlite/") || k.startsWith("control/oauth.sqlite/"));

  test("the release on today's shape: serve with HOSTED_KEKS still set serves, seals every key, and says to migrate; without HOSTED_KEKS it refuses cleanly; migrate-keys without it, or without the proof, refuses, nothing written", async () => {
    const o = await oldShape();
    const withRing = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.ok(withRing.up, withRing.stderr());
    const said = await withRing.stop();
    assert.match(said, new RegExp(`${String(o.stores.length + 1)} keys are still under HOSTED_KEKS: stop the server and run migrate-keys`));
    for (const id of [CONTROL_KEY_ID, ...o.stores]) {
      assert.deepEqual(RECOVERY.opener.open(bodyOf(o.s3, keyObject(id))!, id), o.deks.get(id), "sealed at the start");
      assert.notEqual(bodyOf(o.s3, legacyKeyObject(id)), null, "the old object stays until migrate-keys");
    }
    const before = snapshot(o.s3);
    const keysBytes = readFileSync(join(o.dataRoot, "keys", "keys.sqlite"));
    const without = await spawnServe(envOf(o.s3, o.dataRoot, o.port));
    assert.equal(without.up, false);
    assert.match(await without.stop(), /don't open[^\n]*set HOSTED_KEKS back as it was and run migrate-keys/);
    const refused = await cli(envOf(o.s3, o.dataRoot, o.port), ["migrate-keys"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /set HOSTED_KEKS as it was before WB1[^\n]*Nothing was written/);
    // With HOSTED_KEKS but the recovery key not named, or named wrong (M3): refused, nothing written. No private key asked for.
    const unnamed = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys"]);
    assert.equal(unnamed.status, 1);
    assert.match(unnamed.stderr, /name the recovery key: migrate-keys --recovery-fingerprint <the fingerprint written beside your offline copies>\. Nothing was written/);
    const wrong = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--recovery-fingerprint", testRecovery().fingerprint]);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, new RegExp(`isn't the recovery key HOSTED_RECOVERY_PUBKEY names \\(${RECOVERY.fingerprint}\\)[^\\n]*Nothing was written`));
    assert.deepEqual(snapshot(o.s3), before);
    assert.deepEqual(readFileSync(join(o.dataRoot, "keys", "keys.sqlite")), keysBytes);
    // Beside a running server: refused (its heartbeat). A dry run is fine beside it (step 4). A crash's stale mark doesn't block.
    const running = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.ok(running.up, running.stderr());
    const beside = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(beside.status, 1);
    assert.match(beside.stderr, /a server is running on this volume \(its heartbeat is \d+ s old\): migrate-keys runs with the server stopped/);
    const dryBeside = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--dry-run", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(dryBeside.status, 0, dryBeside.stderr);
    const keysBeside = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["recover-keys"], `${RECOVERY.privateText}\n`);
    assert.match(keysBeside.stderr, /a server is running on this volume[^\n]*recover-keys runs with the server stopped/);
    await running.stop();
    assert.equal(existsSync(join(o.dataRoot, "serving.heartbeat")), false, "a clean stop removes the mark");
    writeFileSync(join(o.dataRoot, "serving.heartbeat"), "a crash's\n");
    utimesSync(join(o.dataRoot, "serving.heartbeat"), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    assert.doesNotThrow(() => refuseWhileServing(o.dataRoot, "migrate-keys"), "a stale mark (a crash) doesn't block");
    assert.throws(() => refuseWhileServing(o.dataRoot, "migrate-keys", () => Date.now() - 100_000), /a server is running/);
  });

  test("the whole migration through the CLI: --dry-run writes nothing; the run moves every key onto the volume KEK, seals them, RE-KEYS control (a new DEK, its databases replicated to a new place and proven, the old replicas gone), deletes every old key object; a second run does nothing; serve needs no HOSTED_KEKS; a lost volume restores from the new control replicas", async () => {
    const o = await oldShape();
    await releasedAndProven(o);
    const env = envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText });
    const keyFiles = o.stores.map((id) => readFileSync(join(tenantDir(join(o.dataRoot, "tenants"), id), "litestream.key"), "utf8"));
    const before = snapshot(o.s3);
    const keysBytes = readFileSync(join(o.dataRoot, "keys", "keys.sqlite"));
    const keys0 = keysOf(o.dataRoot, o.ring);
    const controlCreated = keys0.createdAt(CONTROL_KEY_ID);
    keys0.close();

    const dry = await cli(env, ["migrate-keys", "--dry-run", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    const n = String(o.stores.length + 1);
    assert.match(dry.stdout, /^migrate-keys --dry-run \(nothing written\):/);
    assert.match(dry.stdout, new RegExp(`recovery key ${RECOVERY.fingerprint}: the one named`));
    assert.match(dry.stdout, new RegExp(`${n} keys would be moved from HOSTED_KEKS onto the volume key`));
    assert.match(dry.stdout, /control would be re-keyed/);
    assert.match(dry.stdout, new RegExp(`${String(o.stores.length + 2)} old key objects \\(keys/<id>\\.wrapped, under HOSTED_KEKS\\) would be deleted \\(1 of them deleted stores' leftovers\\)`));
    assert.match(dry.stdout, /a run would finish the migration/);
    assert.deepEqual(snapshot(o.s3), before, "a dry run writes nothing to the bucket");
    assert.deepEqual(readFileSync(join(o.dataRoot, "keys", "keys.sqlite")), keysBytes);

    const run = await cli(env, ["migrate-keys", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, new RegExp(`${n} keys moved from HOSTED_KEKS onto the volume key`));
    assert.match(run.stdout, /control re-keyed: a new control key; the control databases replicated under it \(control\/[A-Za-z0-9_-]{22}\/\), proven by a restore/);
    assert.match(run.stdout, /done: nothing here or in the bucket needs HOSTED_KEKS now\. Remove HOSTED_KEKS and HOSTED_KEK_CURRENT/);
    assert.doesNotMatch(run.stdout + run.stderr, new RegExp([...o.stores, o.leftover].join("|")), "no store id is printed");
    assert.equal([...o.s3.objects.keys()].filter((k) => k.endsWith(".wrapped")).length, 0, "every old key object deleted");
    const keys = keysOf(o.dataRoot);
    for (const id of o.stores) {
      assert.equal(kekVersionOf(keys.wrapped(id)!), "vol1");
      assert.deepEqual(await keys.dek(id), o.deks.get(id), "a store keeps its DEK, rewrapped");
      assert.deepEqual(RECOVERY.opener.open(bodyOf(o.s3, keyObject(id))!, id), o.deks.get(id));
    }
    // Control: a NEW DEK (so a new SSE-C key), sealed, its replicas at control/<key id>/, the old ones gone.
    const control = await keys.dek(CONTROL_KEY_ID);
    assert.notDeepEqual(control, o.deks.get(CONTROL_KEY_ID), "control has a new key");
    assert.deepEqual(RECOVERY.opener.open(bodyOf(o.s3, keyObject(CONTROL_KEY_ID))!, CONTROL_KEY_ID), control);
    const base = `control/${keyIdOf(control)}/`;
    assert.equal(keys.replicaBase(CONTROL_KEY_ID), base);
    assert.equal(keys.createdAt(CONTROL_KEY_ID), controlCreated, "created_at kept: R5's (f2) still reads the volume's age");
    assert.equal(keys.wrapped("control.next"), null);
    for (const db of ["accounts.sqlite", "oauth.sqlite"]) assert.ok([...o.s3.objects.keys()].some((k) => k.startsWith(`${base}${db}/`)), `${db} replicated at the new base`);
    assert.deepEqual(underControlDefault(o.s3), [], "the old control replicas are deleted");
    const oldMd5 = createHash("md5").update(Buffer.from(litestreamKey(o.deks.get(CONTROL_KEY_ID)!), "base64")).digest("base64");
    assert.ok([...o.s3.objects.values()].every((v) => v.keyMd5 !== oldMd5), "nothing in the bucket is under the old control SSE-C key");
    assert.equal(readFileSync(join(o.dataRoot, "control", "litestream.key"), "utf8").trim(), litestreamKey(control));
    assert.equal(existsSync(join(o.dataRoot, "litestream.rekey.yml")), false);
    keys.close();
    assert.equal(statSync(join(o.dataRoot, "keys", VOLUME_KEK_FILE)).mode & 0o777, 0o600);

    // A run again (the start-command override restarts, or Mike re-runs it): nothing to do, nothing written.
    const afterFirst = snapshot(o.s3);
    const again = await cli(env, ["migrate-keys", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.match(again.stdout, /^0 keys moved[\s\S]*^0 sealed key objects written[\s\S]*^0 old key objects[\s\S]*done:/m);
    assert.doesNotMatch(again.stdout, /re-keyed/);
    assert.deepEqual(snapshot(o.s3), afterFirst);

    // HOSTED_KEKS removed: serve starts, the same store keys and key files, replicating control at the new base.
    const served = await spawnServe(envOf(o.s3, o.dataRoot, o.port));
    assert.ok(served.up, served.stderr());
    assert.doesNotMatch(await served.stop(), /HOSTED_KEKS|backup\.keyless|backup\.key\.minted|re-key/);
    o.stores.forEach((id, i) => assert.equal(readFileSync(join(tenantDir(join(o.dataRoot, "tenants"), id), "litestream.key"), "utf8"), keyFiles[i]));
    assert.match(readFileSync(join(o.dataRoot, "litestream.yml"), "utf8"), new RegExp(`path: "${base.replace(/[/-]/g, "\\$&")}accounts\\.sqlite"`));
    assert.deepEqual(underControlDefault(o.s3), []);

    // The volume lost: recover-keys finds control at its new base, and RESTORE_ON_BOOT brings the accounts back from there.
    const people = new Accounts({ path: join(o.dataRoot, "control", "accounts.sqlite") });
    const live = people.liveStoreIds().sort();
    people.close();
    rmSync(o.dataRoot, { recursive: true, force: true });
    const rec = await cli(envOf(o.s3, o.dataRoot, o.port), ["recover-keys"], `${RECOVERY.privateText}\n`);
    assert.equal(rec.status, 0, rec.stderr + rec.stdout);
    assert.equal(keysOf(o.dataRoot).replicaBase(CONTROL_KEY_ID), base, "the new base, found by its replica");
    const restored = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { RESTORE_ON_BOOT: "1" }));
    assert.ok(restored.up, restored.stderr());
    assert.match(await restored.stop(), /restored the control databases: 2 restored/);
    const back = new Accounts({ path: join(o.dataRoot, "control", "accounts.sqlite") });
    assert.deepEqual(back.liveStoreIds().sort(), live);
    back.close();
  });

  test("a re-key cut short, twice (before its new snapshot proved; after the bucket had the new key, before the volume did): each time the start refuses, naming migrate-keys, and nothing is lost; the run again finishes, reusing the new key", async () => {
    const o = await oldShape();
    await releasedAndProven(o);
    const run = litestreamRunner(standin(o.s3.ca!), { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: CREDS.id, LITESTREAM_SECRET_ACCESS_KEY: CREDS.secret });
    const sidecar = (configPath: string): LitestreamSidecar => new LitestreamSidecar({ binary: standin(o.s3.ca!), configPath, env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: CREDS.id, LITESTREAM_SECRET_ACCESS_KEY: CREDS.secret }, killAfterMs: 10_000 });
    // The stand-in's restore runs under the test's https certificate: its R2 endpoint is the https one.
    const backupOf = (objects: AppBackupOptions["objects"]): AppBackupOptions => ({ ...volumeBackup(o.s3, o.dataRoot, o.ring), objects, endpoint: o.s3.tlsBase! });
    const oldControlSealed = bodyOf(o.s3, keyObject(CONTROL_KEY_ID));

    // 1. The new snapshot never proves (its restore keeps failing): nothing switched.
    const failing: typeof run = async () => ({ code: 1, stderr: "standin: no replica" });
    await assert.rejects(migrateKeys(o.dataRoot, backupOf(objectsOf(o.s3)), { recoveryFingerprint: RECOVERY.fingerprint, litestream: { sidecar, run: failing, proveMs: 1500 } }), /didn't prove[^\n]*nothing was switched/);
    let keys = keysOf(o.dataRoot, o.ring);
    const next = await keys.dek("control.next");
    assert.deepEqual(await keys.dek(CONTROL_KEY_ID), o.deks.get(CONTROL_KEY_ID), "control still the old key");
    keys.close();
    assert.equal(bodyOf(o.s3, keyObject(CONTROL_KEY_ID)), oldControlSealed, "the bucket's control key untouched");
    assert.equal(underControlDefault(o.s3).length, 2, "the old control replicas kept");
    const refused = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.equal(refused.up, false);
    assert.match(await refused.stop(), /a control re-key \(migrate-keys\) was cut short[^\n]*run migrate-keys again/);

    // 2. Cut short right after the bucket got the new control key, before the volume switched.
    const inner = objectsOf(o.s3);
    const cut: AppBackupOptions["objects"] = {
      ...inner,
      put: async (key, body) => {
        await inner.put(key, body);
        if (key === keyObject(CONTROL_KEY_ID)) throw new Error("the process died here");
      },
    };
    cut.readableWith = inner.readableWith!.bind(inner);
    await assert.rejects(migrateKeys(o.dataRoot, backupOf(cut), { recoveryFingerprint: RECOVERY.fingerprint, litestream: { sidecar, run } }), /the process died here/);
    assert.deepEqual(RECOVERY.opener.open(bodyOf(o.s3, keyObject(CONTROL_KEY_ID))!, CONTROL_KEY_ID), next, "the bucket has the new key, sealed");
    keys = keysOf(o.dataRoot, o.ring);
    assert.deepEqual(await keys.dek(CONTROL_KEY_ID), o.deks.get(CONTROL_KEY_ID), "the volume still the old key, the new one pending");
    assert.deepEqual(await keys.dek("control.next"), next);
    keys.close();
    const refusedAgain = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.equal(refusedAgain.up, false);
    assert.match(await refusedAgain.stop(), /was cut short/);

    // 3. The run again, through the CLI: finished, with the pending key, the old replicas and key objects gone.
    const done = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(done.status, 0, done.stderr + done.stdout);
    assert.match(done.stdout, /control re-keyed/);
    keys = keysOf(o.dataRoot);
    assert.deepEqual(await keys.dek(CONTROL_KEY_ID), next, "the key the cut-short run made");
    assert.equal(keys.wrapped("control.next"), null);
    keys.close();
    assert.deepEqual(underControlDefault(o.s3), []);
    const served = await spawnServe(envOf(o.s3, o.dataRoot, o.port));
    assert.ok(served.up, served.stderr());
    await served.stop();
  });

  test("an old key object that isn't this volume's key, or whose store the accounts database doesn't know, is KEPT: the run says NOT done, keeps HOSTED_KEKS, and a run after the fix finishes", async () => {
    const o = await oldShape();
    await releasedAndProven(o);
    const backup: AppBackupOptions = { ...volumeBackup(o.s3, o.dataRoot, o.ring), endpoint: o.s3.tlsBase! };
    const litestream = {
      run: litestreamRunner(standin(o.s3.ca!), { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: CREDS.id, LITESTREAM_SECRET_ACCESS_KEY: CREDS.secret }),
      sidecar: (configPath: string): LitestreamSidecar => new LitestreamSidecar({ binary: standin(o.s3.ca!), configPath, env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: CREDS.id, LITESTREAM_SECRET_ACCESS_KEY: CREDS.secret }, killAfterMs: 10_000 }),
    };
    // Someone's other key for the first store (under the same ring), and a key object of a store nobody knows.
    o.s3.objects.set(legacyKeyObject(o.stores[0]!), { body: Buffer.from(await o.ring.wrap(randomBytes(32), o.stores[0]!)), keyMd5: null });
    const stranger = randomBytes(16).toString("hex");
    o.s3.objects.set(legacyKeyObject(stranger), { body: Buffer.from(await o.ring.wrap(randomBytes(32), stranger)), keyMd5: null });
    const out = await migrateKeys(o.dataRoot, backup, { recoveryFingerprint: RECOVERY.fingerprint, litestream });
    assert.equal(out.left, 2, out.text);
    assert.match(out.text, /its old key object is another key than this volume's/);
    assert.match(out.text, /an old key object of a store that isn't in the accounts database/);
    assert.match(out.text, /NOT done: keep HOSTED_KEKS set/);
    assert.notEqual(bodyOf(o.s3, legacyKeyObject(o.stores[0]!)), null);
    assert.notEqual(bodyOf(o.s3, legacyKeyObject(stranger)), null);
    // Everything else moved: the keys here, the sealed objects, control re-keyed, the provable old objects.
    const keys = keysOf(o.dataRoot);
    for (const id of [CONTROL_KEY_ID, ...o.stores]) assert.equal(kekVersionOf(keys.wrapped(id)!), "vol1");
    assert.equal(bodyOf(o.s3, legacyKeyObject(o.stores[1]!)), null);
    assert.equal(bodyOf(o.s3, legacyKeyObject(CONTROL_KEY_ID)), null);
    keys.close();
    // The coordinator looks and removes the two by hand: the next run finishes.
    o.s3.objects.delete(legacyKeyObject(o.stores[0]!));
    o.s3.objects.delete(legacyKeyObject(stranger));
    const done = await migrateKeys(o.dataRoot, backup, { recoveryFingerprint: RECOVERY.fingerprint, litestream });
    assert.equal(done.left, 0, done.text);
    assert.match(done.text, /done:/);
  });

  /** The stand-in Litestream as the re-key's own (sidecar and restore), and a backup whose config names the https stand-in. */
  function rekeyRig(o: Awaited<ReturnType<typeof oldShape>>): { backup: AppBackupOptions; litestream: { sidecar: (p: string) => LitestreamSidecar; run: ReturnType<typeof litestreamRunner>; proveMs?: number } } {
    const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: CREDS.id, LITESTREAM_SECRET_ACCESS_KEY: CREDS.secret };
    return {
      backup: { ...volumeBackup(o.s3, o.dataRoot, o.ring), endpoint: o.s3.tlsBase! },
      litestream: { run: litestreamRunner(standin(o.s3.ca!), env), sidecar: (configPath: string) => new LitestreamSidecar({ binary: standin(o.s3.ca!), configPath, env, killAfterMs: 10_000 }) },
    };
  }

  test("a crash right after the switch, before the new key file (the delta review's HIGH): no control key file is left at all, the next start writes it from the NEW key and drops the old replicas; a key file of the old key is rewritten too; nothing in the bucket is under the old control key", async () => {
    const o = await oldShape();
    await releasedAndProven(o);
    const { backup, litestream } = rekeyRig(o);
    const original = KeyStore.prototype.promote;
    KeyStore.prototype.promote = async function (this: KeyStore, ...args: Parameters<KeyStore["promote"]>): Promise<void> {
      await original.apply(this, args);
      throw new Error("the process died right after the switch");
    };
    try {
      await assert.rejects(migrateKeys(o.dataRoot, backup, { recoveryFingerprint: RECOVERY.fingerprint, litestream }), /died right after the switch/);
    } finally {
      KeyStore.prototype.promote = original;
    }
    const keyFile = join(o.dataRoot, "control", "litestream.key");
    assert.equal(existsSync(keyFile), false, "no key file of either key: the old one went before the switch");
    let keys = keysOf(o.dataRoot, o.ring);
    const fresh = await keys.dek(CONTROL_KEY_ID);
    assert.notDeepEqual(fresh, o.deks.get(CONTROL_KEY_ID));
    assert.equal(keys.wrapped("control.next"), null);
    keys.close();
    assert.equal(underControlDefault(o.s3).length, 2, "the old replicas, not yet dropped");
    const oldMd5 = createHash("md5").update(Buffer.from(litestreamKey(o.deks.get(CONTROL_KEY_ID)!), "base64")).digest("base64");
    const started = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.ok(started.up, started.stderr());
    await started.stop();
    assert.equal(readFileSync(keyFile, "utf8").trim(), litestreamKey(fresh), "written from the new key at the start");
    assert.deepEqual(underControlDefault(o.s3), [], "the start dropped the old control replicas");
    assert.ok([...o.s3.objects.values()].every((v) => v.keyMd5 !== oldMd5), "nothing in the bucket under the old control SSE-C key");
    // The same window reached another way: a file of the OLD key left in place. A start rewrites it before Litestream runs.
    writeFileSync(keyFile, `${litestreamKey(o.deks.get(CONTROL_KEY_ID)!)}\n`, { mode: 0o600 });
    const again = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.ok(again.up, again.stderr());
    await again.stop();
    assert.equal(readFileSync(keyFile, "utf8").trim(), litestreamKey(fresh));
    assert.ok([...o.s3.objects.values()].every((v) => v.keyMd5 !== oldMd5));
    // And the run again finishes the migration (the old key objects).
    const done = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(done.status, 0, done.stderr + done.stdout);
    assert.doesNotMatch(done.stdout, /re-keyed/);
    keys = keysOf(o.dataRoot);
    assert.deepEqual(await keys.dek(CONTROL_KEY_ID), fresh);
    keys.close();
    assert.equal([...o.s3.objects.keys()].filter((k) => k.endsWith(".wrapped")).length, 0);
  });

  test("--abort-control-rekey backs out of a re-key that won't prove: the old control key kept and sealed again, the new key and its replicas gone, the start no longer refused; a later run re-keys", async () => {
    const o = await oldShape();
    await releasedAndProven(o);
    const { backup, litestream } = rekeyRig(o);
    const failing: typeof litestream.run = async () => ({ code: 1, stderr: "standin: no replica" });
    await assert.rejects(migrateKeys(o.dataRoot, backup, { recoveryFingerprint: RECOVERY.fingerprint, litestream: { ...litestream, run: failing, proveMs: 1500 } }), /didn't prove/);
    let keys = keysOf(o.dataRoot, o.ring);
    const pendingBase = `control/${keyIdOf(await keys.dek("control.next"))}/`;
    keys.close();
    assert.ok([...o.s3.objects.keys()].some((k) => k.startsWith(pendingBase)), "the unproven re-key left replicas at its base");
    const refused = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.equal(refused.up, false);
    assert.match(await refused.stop(), /was cut short/);
    const dry = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--abort-control-rekey", "--dry-run"]);
    assert.match(dry.stdout, /a pending control re-key would be backed out/);
    const abort = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--abort-control-rekey"]);
    assert.equal(abort.status, 0, abort.stderr + abort.stdout);
    assert.match(abort.stdout, /the control re-key backed out: the old control key kept/);
    keys = keysOf(o.dataRoot, o.ring);
    assert.equal(keys.wrapped("control.next"), null);
    assert.deepEqual(await keys.dek(CONTROL_KEY_ID), o.deks.get(CONTROL_KEY_ID));
    keys.close();
    assert.deepEqual(RECOVERY.opener.open(bodyOf(o.s3, keyObject(CONTROL_KEY_ID))!, CONTROL_KEY_ID), o.deks.get(CONTROL_KEY_ID), "the bucket's control key is the old one");
    assert.ok(![...o.s3.objects.keys()].some((k) => k.startsWith(pendingBase)), "the new base's objects gone");
    assert.equal(underControlDefault(o.s3).length, 2, "the old replicas kept");
    const served = await spawnServe(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }));
    assert.ok(served.up, served.stderr());
    await served.stop();
    const nothing = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--abort-control-rekey"]);
    assert.match(nothing.stdout, /nothing to back out/);
    // Later, Litestream working: the re-key happens.
    const done = await cli(envOf(o.s3, o.dataRoot, o.port, { HOSTED_KEKS: o.ringText }), ["migrate-keys", "--recovery-fingerprint", RECOVERY.fingerprint]);
    assert.equal(done.status, 0, done.stderr + done.stdout);
    assert.match(done.stdout, /control re-keyed/);
  });
});

// ── a forged key object ──────────────────────────────────────────────────────

describe("WB1: recover-keys adopts no key it can't prove against the store's own replica (the #768 review's M2)", () => {
  test("a sealed object an R2 writer forged (a key of their choosing, sealed to the public key) is refused, by tag; the others come back; an empty replica is left for a new key unless --adopt-unproven, which warns", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    const { stores } = await livedVolume(s3, volumeBackup(s3, dataRoot), 3);
    const [forged, plain, empty] = stores as [string, string, string];
    const theirs = randomBytes(32);
    s3.objects.set(keyObject(forged), { body: Buffer.from(RECOVERY.sealer.seal(theirs, forged)), keyMd5: null });
    for (const k of [...s3.objects.keys()]) if (k.startsWith(`tenants/${empty}/`)) s3.objects.delete(k);
    const keysBefore = keysOf(dataRoot);
    const plainDek = await keysBefore.dek(plain);
    const emptyDek = await keysBefore.dek(empty);
    keysBefore.close();
    rmSync(dataRoot, { recursive: true, force: true });

    const env = envOf(s3, dataRoot, await freePort());
    const r = await cli(env, ["recover-keys"], `${RECOVERY.privateText}\n`);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, new RegExp(`${storeTag(forged)}: its replica doesn't open under the sealed key's SSE-C key: the key object may be FORGED`));
    assert.match(r.stdout, /1 not adopted: no replica to prove the key against/);
    assert.doesNotMatch(r.stdout, /proof recorded/, "a run that refused a key proves nothing");
    let keys = keysOf(dataRoot);
    assert.equal(keys.wrapped(forged), null, "the forged key never adopted");
    assert.equal(keys.wrapped(empty), null);
    assert.deepEqual(await keys.dek(plain), plainDek);
    keys.close();
    // The empty one: adopted only on purpose, loudly.
    const loud = await cli(env, ["recover-keys", "--adopt-unproven"], `${RECOVERY.privateText}\n`);
    assert.match(loud.stdout, new RegExp(`WARNING: ${storeTag(empty)} adopted with NO replica to prove its key against`));
    keys = keysOf(dataRoot);
    assert.deepEqual(await keys.dek(empty), emptyDek);
    assert.equal(keys.wrapped(forged), null);
    keys.close();
  });

  test("a forger who seals a control key of theirs AND plants a replica under it beside the real one: control is refused, naming both places (the delta review's MEDIUM)", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    await livedVolume(s3, volumeBackup(s3, dataRoot));
    const theirs = randomBytes(32);
    s3.objects.set(keyObject(CONTROL_KEY_ID), { body: Buffer.from(RECOVERY.sealer.seal(theirs, CONTROL_KEY_ID)), keyMd5: null });
    const planted = `control/${keyIdOf(theirs)}/`;
    for (const db of ["accounts.sqlite", "oauth.sqlite"]) {
      const res = await fetch(`${s3.base}/bkt/${planted}${db}/0000/0000000000000009-0000000000000009.ltx`, { method: "PUT", body: "theirs", headers: { "x-amz-server-side-encryption-customer-algorithm": "AES256", "x-amz-server-side-encryption-customer-key": litestreamKey(theirs) } });
      assert.ok(res.ok);
    }
    rmSync(dataRoot, { recursive: true, force: true });
    const r = await cli(envOf(s3, dataRoot, await freePort()), ["recover-keys"], `${RECOVERY.privateText}\n`);
    assert.equal(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes(`control: more than one place in the bucket holds control replicas (control/, ${planted})`), r.stdout);
    assert.equal(keysOf(dataRoot).wrapped(CONTROL_KEY_ID), null, "control not adopted");
  });

  test("a 403 from the bucket (a bad or revoked token) is said as such, never as a forged key", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    await livedVolume(s3, volumeBackup(s3, dataRoot), 1);
    rmSync(dataRoot, { recursive: true, force: true });
    s3.fault = ({ method, key }) => (method === "GET" && key.startsWith("tenants/") ? 403 : null);
    const r = await cli(envOf(s3, dataRoot, await freePort()), ["recover-keys"], `${RECOVERY.privateText}\n`);
    s3.fault = null;
    assert.equal(r.status, 1);
    assert.match(r.stdout, /the bucket refused the request \(403\): check the R2 token/);
    assert.doesNotMatch(r.stdout, /FORGED/);
  });

  test("a never-opened store with no replica and a sealed object in the bucket gets a NEW key at its first ensure, sealed over the old object (nothing is under the old one)", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    const { stores } = await livedVolume(s3, volumeBackup(s3, dataRoot), 1, { replicas: false });
    const id = stores[0]!;
    const forged = RECOVERY.sealer.seal(randomBytes(32), id);
    s3.objects.set(keyObject(id), { body: Buffer.from(forged), keyMd5: null });
    const keys = keysOf(dataRoot);
    keys.delete(id);
    const b = new Backups({ dataRoot, keys, objects: objectsOf(s3), sealer: RECOVERY.sealer, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => [id], openedBefore: () => false });
    await b.ensureStore(id, { reload: false });
    const mine = await keys.dek(id);
    assert.deepEqual(RECOVERY.opener.open(bodyOf(s3, keyObject(id))!, id), mine, "the bucket's object is the new key's");
    assert.notEqual(bodyOf(s3, keyObject(id)), forged);
    // A store that lived (or has a replica) is never re-keyed this way.
    keys.delete(id);
    const lived = new Backups({ dataRoot, keys, objects: objectsOf(s3), sealer: RECOVERY.sealer, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => [id], openedBefore: () => true });
    await assert.rejects(lived.ensureStore(id, { reload: false }), (err) => err instanceof KeySealed);
  });
});

// ── the erase ────────────────────────────────────────────────────────────────

describe("WB1: the erase leaves no readable DEK in the bucket", () => {
  test("a delete removes the sealed key object, an old .wrapped one left from before the migration, and the key here; the private key then opens nothing of that store", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    const backup = volumeBackup(s3, dataRoot);
    const { stores, people } = await livedVolume(s3, backup);
    const [gone, kept] = stores as [string, string];
    // An old object of the store, as if migrate-keys hadn't run yet.
    s3.objects.set(legacyKeyObject(gone), { body: Buffer.from("w1.v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), keyMd5: null });
    const app = createApp({ dataRoot, publicOrigin: "http://127.0.0.1", mailer: memoryMailer(), embedder: null, spawner: () => ({ pid: 1 }), backup });
    closers.push(() => app.close());
    await app.start();
    await app.deleteAccount(people[0]!);
    assert.equal(s3.objects.has(keyObject(gone)), false);
    assert.equal(s3.objects.has(legacyKeyObject(gone)), false);
    assert.equal(app.keys!.wrapped(gone), null);
    assert.ok(s3.objects.has(tombstoneObject(gone)));
    // Nothing left in the bucket that the recovery key opens to that store's key.
    for (const [k, v] of s3.objects) if (k.startsWith("keys/")) assert.throws(() => RECOVERY.opener.open(v.body.toString("utf8"), gone), k);
    // recover-keys after a volume loss brings back the others, never the deleted one.
    await app.close();
    rmSync(dataRoot, { recursive: true, force: true });
    const r = await recoverKeys(dataRoot, volumeBackup(s3, dataRoot), RECOVERY.opener);
    assert.equal(r.failed, 0, r.text);
    const keys = keysOf(dataRoot);
    assert.equal(keys.wrapped(gone), null);
    assert.notEqual(keys.wrapped(kept), null);
  });

  test("a store with a tombstone whose sealed object a cut-short delete left: recover-keys skips it", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    const { stores } = await livedVolume(s3, volumeBackup(s3, dataRoot));
    s3.objects.set(tombstoneObject(stores[0]!), { body: Buffer.from("2026-11-01T00:00:00.000Z\n"), keyMd5: null });
    rmSync(dataRoot, { recursive: true, force: true });
    const r = await recoverKeys(dataRoot, volumeBackup(s3, dataRoot), RECOVERY.opener);
    assert.match(r.text, /2 keys brought back[\s\S]*1 skipped \(the bucket has their tombstone: deleted\)/);
    assert.equal(keysOf(dataRoot).wrapped(stores[0]!), null);
  });
});

// ── the recovery key's commands, and hold ────────────────────────────────────

describe("WB1: recovery-keygen, recovery-fingerprint, hold", () => {
  const bare = (): Record<string, string> => ({ PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: tmp.root, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });

  test("recovery-keygen prints the keypair to the terminal once and writes no file; recovery-fingerprint reads the private key from stdin and checks it against HOSTED_RECOVERY_PUBKEY", async () => {
    const cwd = join(tmp.root, "keygen");
    mkdirSync(cwd);
    const made = await cli({ ...bare(), HOME: cwd }, ["recovery-keygen"]);
    assert.equal(made.status, 0, made.stderr);
    const privateLine = /^(cp-recovery:[A-Za-z0-9+/]{43}=)$/m.exec(made.stdout)![1]!;
    const pub = /^HOSTED_RECOVERY_PUBKEY=(\S+)$/m.exec(made.stdout)![1]!;
    const fp = /^fingerprint ([0-9a-f]{16})$/m.exec(made.stdout)![1]!;
    assert.equal(new RecoverySealer(Buffer.from(pub, "base64")).fingerprint, fp);
    assert.ok(!readdirSync(cwd, { recursive: true }).some((n) => String(n).includes("recovery")), "no key file written");
    const withArg = await cli(bare(), ["recovery-keygen", join(tmp.root, "recovery.key")]);
    assert.equal(withArg.status, 1);
    assert.match(withArg.stderr, /takes no argument/);
    assert.equal(existsSync(join(tmp.root, "recovery.key")), false);
    const file = join(tmp.root, "copy.key");
    writeFileSync(file, `${privateLine}\n`, { mode: 0o600 });
    const checked = await cli({ ...bare(), HOSTED_RECOVERY_PUBKEY: pub }, ["recovery-fingerprint"], `${privateLine}\n`);
    assert.equal(checked.stdout, `fingerprint ${fp}\nit is the key HOSTED_RECOVERY_PUBKEY names\n`);
    const other = await cli({ ...bare(), HOSTED_RECOVERY_PUBKEY: testRecovery().publicText }, ["recovery-fingerprint", "--key-file", file]);
    assert.match(other.stdout, /NOT the key HOSTED_RECOVERY_PUBKEY names/);
    const junk = await cli(bare(), ["recovery-fingerprint"], "not a key\n");
    assert.equal(junk.status, 1);
    assert.doesNotMatch(junk.stderr, /not a key/, "a refusal never echoes what it was given");
  });

  test("serve refuses with no HOSTED_RECOVERY_PUBKEY, or one that isn't a key, and HOSTED_KEKS naming the volume's label", async () => {
    const s3 = await bucket();
    const dataRoot = join(tmp.root, "volume");
    const port = await freePort();
    const env = envOf(s3, dataRoot, port);
    const { HOSTED_RECOVERY_PUBKEY: _drop, ...noPub } = env;
    const a = await cli(noPub, ["serve"]);
    assert.equal(a.status, 1);
    assert.match(a.stderr, /refused: set HOSTED_RECOVERY_PUBKEY/);
    const b = await cli({ ...env, HOSTED_RECOVERY_PUBKEY: "abc" }, ["serve"]);
    assert.match(b.stderr, /HOSTED_RECOVERY_PUBKEY isn't a public key/);
    const c = await cli({ ...env, HOSTED_KEKS: `vol1:${randomBytes(32).toString("base64")}` }, ["serve"]);
    assert.match(c.stderr, /vol1 is the volume key's label/);
    assert.equal(existsSync(dataRoot), false, "nothing made on the volume");
  });

  test("hold answers /readyz and 503 to everything else, opens nothing on the volume, and stops on SIGTERM", async () => {
    const port = await freePort();
    const dataRoot = join(tmp.root, "volume");
    mkdirSync(dataRoot);
    const child = spawn(process.execPath, [...scriptArgs(MAIN), "hold"], { env: { ...bare(), PORT: String(port), HOSTED_DATA_ROOT: dataRoot }, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr!.on("data", (d: Buffer) => (err += d.toString("utf8")));
    const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
    closers.push(() => child.kill("SIGKILL"));
    const until = Date.now() + 20_000;
    while (!err.includes("holding on port") && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    assert.match(err, /holding on port/);
    const ready = await fetch(`http://127.0.0.1:${String(port)}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ready: true, holding: true });
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/healthz`)).status, 200, "the image's own healthcheck");
    const other = await fetch(`http://127.0.0.1:${String(port)}/mcp`, { method: "POST" });
    assert.equal(other.status, 503);
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
    assert.equal(existsSync(join(dataRoot, "keys")) || existsSync(join(dataRoot, "control")), false);
  });
});
