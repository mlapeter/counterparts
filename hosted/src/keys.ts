/**
 * PER-STORE KEYS (OL2 step 5; design: docs/hosted/DESIGN.md §5.4, as Mike
 * changed it on 2026-10-26; WB1, 2026-11-06: write-only backups).
 *
 * Envelope encryption, and what leaves the host:
 *
 *   - **A DEK** (data-encryption key) per store, and one for the pseudo-store
 *     `control` (the two control databases): 32 random bytes. What a DEK keys,
 *     through HKDF-SHA256 with a purpose label, never the DEK itself: the
 *     store's Litestream SSE-C key (`litestreamKey`).
 *   - **On the volume**, each DEK is kept WRAPPED in `keys/keys.sqlite`
 *     (AES-256-GCM, a fresh random 96-bit nonce per wrap; the store id AND the
 *     KEK version as associated data, so a wrapped value can't be moved to
 *     another store or relabelled). The KEK is reached ONLY through a
 *     `KeyWrapper`. Since WB1 it is **the volume KEK** (`VolumeKeyWrapper`), a
 *     file on the volume (`keys/volume.kek`, 0600), made at the first wrap and
 *     never backed up: an env leak holds no key. The env ring from before WB1
 *     (`HOSTED_KEKS`, `EnvKeyWrapper`) is read only to OPEN keys still under it,
 *     until `migrate-keys` moves them onto the volume KEK.
 *   - **In the bucket**, each DEK is SEALED to the offline recovery key
 *     (`RecoverySealer`): an X25519 public key (`HOSTED_RECOVERY_PUBKEY`, public),
 *     HPKE-style with node:crypto only (an ephemeral X25519 key, HKDF-SHA256,
 *     AES-256-GCM). The server can write these and never read them. The private
 *     key is never in the environment, a log, the repo or on disk here: Mike
 *     keeps it offline, and gives it (stdin, or a file he names) only to
 *     `recover-keys`, after a volume is lost (`RecoveryOpener`). A sealed value
 *     names the recovery key (its fingerprint) and the DEK's KEY ID (`keyIdOf`,
 *     an HKDF output under its own label, never the DEK), so the server can tell
 *     "the bucket's key is this volume's key" without opening it.
 *
 * **Nothing else in hosted/ touches a raw key or a cipher** (pinned by a test
 * that greps for them).
 *
 * Deleting a store deletes its wrapped DEK here and its sealed DEK in R2
 * (`backup.ts`), at once: then no key anywhere rebuilds the DEK, and without the
 * DEK every Litestream copy of that store is ciphertext.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { openDb } from "../../src/core/store/db.js";
import type { Db } from "../../src/core/store/db.js";

/** A wrapped key, serialized: `w1.<kekVersion>.<iv b64url>.<ciphertext+tag b64url>`. */
export type WrappedKey = string;

export interface KeyWrapper {
  /** The KEK version new wraps use. */
  readonly version: string;
  wrap(dek: Buffer, aad: string): Promise<WrappedKey>;
  /** Unwraps with whatever version the value names; throws on a version it doesn't hold or a bad tag. */
  unwrap(wrapped: WrappedKey, aad: string): Promise<Buffer>;
  /**
   * Before a wrap that may be this wrapper's first (`VolumeKeyWrapper`): its key
   * is made now if it may be, given the versions `keys.sqlite` names. Absent:
   * nothing to prepare.
   */
  ready?(versionsInUse: readonly string[]): void;
}

export const DEK_BYTES = 32;

/** The KEK version a wrapped value names. */
export function kekVersionOf(wrapped: WrappedKey): string {
  const parts = wrapped.split(".");
  if (parts.length !== 4 || parts[0] !== "w1" || !/^[A-Za-z0-9_-]{1,32}$/.test(parts[1] ?? "")) throw new Error("not a wrapped key");
  return parts[1]!;
}

function wrapWith(kek: Buffer, version: string, dek: Buffer, aad: string): WrappedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  cipher.setAAD(boundAad(version, aad));
  const ct = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
  return `w1.${version}.${iv.toString("base64url")}.${ct.toString("base64url")}`;
}

function unwrapWith(kek: Buffer, wrapped: WrappedKey, aad: string): Buffer {
  const version = kekVersionOf(wrapped);
  const [, , ivB64, ctB64] = wrapped.split(".");
  const iv = Buffer.from(ivB64!, "base64url");
  const body = Buffer.from(ctB64!, "base64url");
  if (iv.length !== 12 || body.length < 17) throw new Error("not a wrapped key");
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAAD(boundAad(version, aad));
  decipher.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
}

/**
 * A KEK RING HELD IN MEMORY: the ring from before WB1 (`HOSTED_KEKS`, parsed by
 * `kekRingFromEnv`), and the tests' rings. Production wraps under
 * `VolumeKeyWrapper` since WB1, which holds this ring only to open keys still
 * under it.
 */
export class EnvKeyWrapper implements KeyWrapper {
  readonly version: string;
  private readonly ring: ReadonlyMap<string, Buffer>;

  constructor(ring: ReadonlyMap<string, Buffer>, current: string) {
    const seen = new Set<string>();
    for (const [v, k] of ring) {
      if (k.length !== 32) throw new Error(`KEK ${v} is not 32 bytes`);
      // Two versions with one key would make the version label meaningless (and a rewrap a no-op).
      if (seen.has(k.toString("hex"))) throw new Error(`KEK ${v} repeats another version's key`);
      seen.add(k.toString("hex"));
    }
    if (!ring.has(current)) throw new Error("the current KEK version is not in the ring");
    this.ring = ring;
    this.version = current;
  }

  /** The versions this ring holds. */
  versions(): string[] {
    return [...this.ring.keys()];
  }

  async wrap(dek: Buffer, aad: string): Promise<WrappedKey> {
    return wrapWith(this.ring.get(this.version)!, this.version, dek, aad);
  }

  async unwrap(wrapped: WrappedKey, aad: string): Promise<Buffer> {
    const version = kekVersionOf(wrapped);
    const kek = this.ring.get(version);
    if (kek === undefined) throw new Error(`no KEK version ${version} in the ring`);
    return unwrapWith(kek, wrapped, aad);
  }
}

/** The associated data a wrap is bound to: the format, the KEK version and the caller's label (the store id). */
function boundAad(version: string, aad: string): Buffer {
  return Buffer.from(`counterparts/dek/w1\u0000${version}\u0000${aad}`, "utf8");
}

/** The env ring's variable from before WB1, for messages elsewhere (only this file names it in code). */
export const KEK_ENV = "HOSTED_KEKS";

/** The volume KEK's version label. `HOSTED_KEKS` may not use it (`kekRingFromEnv`). */
export const VOLUME_KEK_VERSION = "vol1";
/** The volume KEK's file name, in `keys/` beside `keys.sqlite`: outside every tenant dir, never replicated. */
export const VOLUME_KEK_FILE = "volume.kek";

/** The refusal when keys.sqlite names the volume KEK and its file is gone. */
export const VOLUME_KEK_MISSING =
  "keys/keys.sqlite has keys under this volume's key, and keys/volume.kek is missing or unreadable: they can't be opened, and no new volume key is made over them. Put the file back, or remove keys/ (rm -rf /data/keys) and bring the keys back from the bucket with recover-keys (docs/hosted/RUNBOOK.md, Restore).";

/** The refusal for a key still under HOSTED_KEKS when the environment no longer has that ring. */
export const LEGACY_KEY_NEEDS_RING = "it is under a key from HOSTED_KEKS (from before WB1), and the environment has no such version: set HOSTED_KEKS back as it was and run migrate-keys (docs/hosted/RUNBOOK.md, Write-only backups)";

/**
 * THE VOLUME KEK (WB1): 32 random bytes in `<keysDir>/volume.kek` (0600, the dir
 * 0700), written as `vol1:<base64>`. Made at the first wrap (`ready`), and only
 * when `keys.sqlite` names no key under it: a missing file beside keys under it
 * is refused, never replaced. Never backed up: after a volume is lost, the DEKs
 * come back from the bucket under the recovery key (`recover-keys`) and are
 * wrapped under a new volume KEK.
 *
 * `legacy`: the `HOSTED_KEKS` ring from before WB1, while the environment still
 * has it. Used only to OPEN keys under it (`migrate-keys` moves them); every new
 * wrap is under the volume KEK.
 */
export class VolumeKeyWrapper implements KeyWrapper {
  readonly version = VOLUME_KEK_VERSION;
  readonly file: string;
  private key: Buffer | null = null;
  private readonly legacy: EnvKeyWrapper | null;

  constructor(keysDir: string, legacy: EnvKeyWrapper | null = null) {
    if (legacy !== null && legacy.versions().includes(VOLUME_KEK_VERSION)) throw new Error(`HOSTED_KEKS may not name the version ${VOLUME_KEK_VERSION}`);
    this.file = join(keysDir, VOLUME_KEK_FILE);
    this.legacy = legacy;
  }

  /** The `HOSTED_KEKS` versions this wrapper can still open. */
  legacyVersions(): string[] {
    return this.legacy?.versions() ?? [];
  }

  /** The volume KEK file is here. */
  present(): boolean {
    return this.key !== null || existsSync(this.file);
  }

  private load(): Buffer {
    if (this.key !== null) return this.key;
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      throw new Error(VOLUME_KEK_MISSING);
    }
    const m = /^vol1:([A-Za-z0-9+/]{43}=)\s*$/.exec(text);
    const key = m === null ? Buffer.alloc(0) : Buffer.from(m[1]!, "base64");
    if (key.length !== 32) throw new Error(VOLUME_KEK_MISSING);
    this.key = key;
    return key;
  }

  ready(versionsInUse: readonly string[]): void {
    if (this.present()) return;
    if (versionsInUse.includes(VOLUME_KEK_VERSION)) throw new Error(VOLUME_KEK_MISSING);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    // Written whole, then linked into place: two starts racing never leave two keys, or half of one.
    const tmp = `${this.file}.new-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tmp, `${VOLUME_KEK_VERSION}:${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(tmp, 0o600);
      linkSync(tmp, this.file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      rmSync(tmp, { force: true });
      key.fill(0);
    }
  }

  async wrap(dek: Buffer, aad: string): Promise<WrappedKey> {
    return wrapWith(this.load(), VOLUME_KEK_VERSION, dek, aad);
  }

  async unwrap(wrapped: WrappedKey, aad: string): Promise<Buffer> {
    const version = kekVersionOf(wrapped);
    if (version === VOLUME_KEK_VERSION) return unwrapWith(this.load(), wrapped, aad);
    if (this.legacy === null) throw new Error(`no KEK version ${version}: ${LEGACY_KEY_NEEDS_RING}`);
    return this.legacy.unwrap(wrapped, aad);
  }
}

/**
 * `HOSTED_KEKS="v1:<base64 32 bytes>,v2:<…>"` and `HOSTED_KEK_CURRENT="v2"`
 * (current defaults to the only version when there is one). Returns the
 * wrapper, or a refusal that never echoes a key. Since WB1, only for opening
 * keys from before it (`migrate-keys`).
 */
export function kekRingFromEnv(env: Record<string, string | undefined>): EnvKeyWrapper | { refusal: string } {
  const raw = env["HOSTED_KEKS"];
  if (raw === undefined || raw.trim().length === 0) return { refusal: "set HOSTED_KEKS (version:base64key, comma-separated)." };
  const ring = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const i = entry.indexOf(":");
    const version = entry.slice(0, i).trim();
    const key = Buffer.from(entry.slice(i + 1).trim(), "base64");
    if (i <= 0 || !/^[A-Za-z0-9_-]{1,32}$/.test(version)) return { refusal: "HOSTED_KEKS: every entry is version:base64key." };
    if (version === VOLUME_KEK_VERSION) return { refusal: `HOSTED_KEKS: ${VOLUME_KEK_VERSION} is the volume key's label; use another.` };
    if (key.length !== 32) return { refusal: `HOSTED_KEKS: key ${version} is not 32 bytes.` };
    if (ring.has(version)) return { refusal: `HOSTED_KEKS: version ${version} appears twice.` };
    if ([...ring.values()].some((k) => k.equals(key))) return { refusal: `HOSTED_KEKS: key ${version} repeats another version's key.` };
    ring.set(version, key);
  }
  const current = env["HOSTED_KEK_CURRENT"] ?? (ring.size === 1 ? [...ring.keys()][0]! : "");
  if (!ring.has(current)) return { refusal: "set HOSTED_KEK_CURRENT to a version in HOSTED_KEKS." };
  return new EnvKeyWrapper(ring, current);
}

/**
 * THE SERVER'S KEY HOLDER FROM THE ENVIRONMENT (WB1): the volume KEK under
 * `<dataRoot>/keys/`, with the `HOSTED_KEKS` ring for opening older keys when it
 * is still set (unset is the normal case after `migrate-keys`).
 */
export function volumeWrapperFromEnv(env: Record<string, string | undefined>, dataRoot: string): VolumeKeyWrapper | { refusal: string } {
  let legacy: EnvKeyWrapper | null = null;
  if ((env["HOSTED_KEKS"] ?? "").trim() !== "") {
    const ring = kekRingFromEnv(env);
    if ("refusal" in ring) return ring;
    legacy = ring;
  }
  return new VolumeKeyWrapper(join(dataRoot, "keys"), legacy);
}

// ── the recovery key: sealed to it in the bucket, opened only by recover-keys ──

const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const SEAL_FORMAT = "s1";
const SEAL_INFO = "counterparts/seal/s1";

/** A recovery key's fingerprint: 16 hex of SHA-256 over its raw public key. */
export function recoveryFingerprint(publicRaw: Buffer): string {
  return createHash("sha256").update(publicRaw).digest("hex").slice(0, 16);
}

function publicKeyOf(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: "der", type: "spki" });
}

function rawPublic(key: KeyObject): Buffer {
  return Buffer.from(key.export({ format: "der", type: "spki" }).subarray(-32));
}

/** A raw 32-byte key from its text: base64 (or base64url), with an optional `<label>:` before it. */
function rawKeyText(text: string): Buffer | null {
  const t = text.trim().replace(/^[a-z0-9-]+:/i, "");
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(t)) return null;
  const raw = Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return raw.length === 32 ? raw : null;
}

/** The DEK's key id: a purpose-bound HKDF output (16 bytes, base64url), never the DEK. Public: it is in the bucket. */
export function keyIdOf(dek: Buffer): string {
  return deriveKey(dek, "key-id").subarray(0, 16).toString("base64url");
}

/** What a sealed value says about itself, readable without the private key. */
export interface SealedHeader {
  readonly fingerprint: string;
  readonly keyId: string;
}

/** A sealed value's header, or null for anything that isn't one (a `w1.` wrapped value from before WB1, junk). */
export function sealedHeader(sealed: string): SealedHeader | null {
  const parts = sealed.trim().split(".");
  if (parts.length !== 6 || parts[0] !== SEAL_FORMAT || !/^[0-9a-f]{16}$/.test(parts[1]!) || !/^[A-Za-z0-9_-]{22}$/.test(parts[2]!)) return null;
  return { fingerprint: parts[1]!, keyId: parts[2]! };
}

function sealAad(storeId: string, fingerprint: string, keyId: string): Buffer {
  return Buffer.from(`${SEAL_INFO}\u0000${storeId}\u0000${fingerprint}\u0000${keyId}`, "utf8");
}

function sealKey(shared: Buffer, ephRaw: Buffer, recipientRaw: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephRaw, recipientRaw]), Buffer.from(SEAL_INFO, "utf8"), 32));
}

/**
 * SEALS A DEK TO THE RECOVERY KEY'S PUBLIC HALF (WB1). Write-only: nothing here
 * can open what it seals. The value:
 *
 *   `s1.<fingerprint>.<key id>.<ephemeral public b64url>.<iv b64url>.<ciphertext+tag b64url>`
 *
 * A fresh ephemeral X25519 key per seal; the AES-256-GCM key is
 * HKDF-SHA256(the shared secret, salt = ephemeral ‖ recipient, info "counterparts/seal/s1");
 * the store id, the fingerprint and the key id are the associated data, so a
 * sealed value can't be moved to another store or relabelled.
 */
export class RecoverySealer {
  readonly fingerprint: string;
  private readonly publicRaw: Buffer;
  private readonly publicKey: KeyObject;

  constructor(publicRaw: Buffer) {
    if (publicRaw.length !== 32) throw new Error("a recovery public key is 32 bytes");
    this.publicRaw = Buffer.from(publicRaw);
    this.publicKey = publicKeyOf(this.publicRaw);
    this.fingerprint = recoveryFingerprint(this.publicRaw);
  }

  seal(dek: Buffer, storeId: string): string {
    const eph = generateKeyPairSync("x25519");
    const ephRaw = rawPublic(eph.publicKey);
    const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: this.publicKey });
    const key = sealKey(shared, ephRaw, this.publicRaw);
    shared.fill(0);
    const keyId = keyIdOf(dek);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(sealAad(storeId, this.fingerprint, keyId));
    const ct = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
    key.fill(0);
    return `${SEAL_FORMAT}.${this.fingerprint}.${keyId}.${ephRaw.toString("base64url")}.${iv.toString("base64url")}.${ct.toString("base64url")}`;
  }
}

/** `HOSTED_RECOVERY_PUBKEY`: the recovery key's public half, base64 of its 32 raw bytes. A refusal never echoes it. */
export function recoverySealerFromEnv(env: Record<string, string | undefined>): RecoverySealer | { refusal: string } {
  const raw = env["HOSTED_RECOVERY_PUBKEY"];
  if (raw === undefined || raw.trim() === "") return { refusal: "set HOSTED_RECOVERY_PUBKEY (the recovery key's public half: recovery-keygen prints it; docs/hosted/RUNBOOK.md, Write-only backups)." };
  const pub = rawKeyText(raw);
  if (pub === null) return { refusal: "HOSTED_RECOVERY_PUBKEY isn't a public key (base64 of 32 bytes, as recovery-keygen prints it)." };
  return new RecoverySealer(pub);
}

/**
 * OPENS WHAT `RecoverySealer` SEALED: only `recover-keys` makes one, from the
 * private key Mike gives it (stdin or a file), and drops it when done. Never
 * built from the environment.
 */
export class RecoveryOpener {
  readonly fingerprint: string;
  private readonly privateKey: KeyObject;
  private readonly publicRaw: Buffer;

  constructor(privateRaw: Buffer) {
    if (privateRaw.length !== 32) throw new Error("a recovery private key is 32 bytes");
    this.privateKey = createPrivateKey({ key: Buffer.concat([X25519_PKCS8, privateRaw]), format: "der", type: "pkcs8" });
    this.publicRaw = rawPublic(createPublicKey(this.privateKey));
    this.fingerprint = recoveryFingerprint(this.publicRaw);
  }

  /** The DEK sealed for this store id: throws on another recovery key, another store, a tampered value, or a key id that doesn't match. */
  open(sealed: string, storeId: string): Buffer {
    const header = sealedHeader(sealed);
    if (header === null) throw new Error("not a sealed key");
    if (header.fingerprint !== this.fingerprint) throw new Error(`sealed to another recovery key (fingerprint ${header.fingerprint}, this key's is ${this.fingerprint})`);
    const [, , , ephB64, ivB64, ctB64] = sealed.trim().split(".");
    const ephRaw = Buffer.from(ephB64!, "base64url");
    const iv = Buffer.from(ivB64!, "base64url");
    const body = Buffer.from(ctB64!, "base64url");
    if (ephRaw.length !== 32 || iv.length !== 12 || body.length !== DEK_BYTES + 16) throw new Error("not a sealed key");
    const shared = diffieHellman({ privateKey: this.privateKey, publicKey: publicKeyOf(ephRaw) });
    const key = sealKey(shared, ephRaw, this.publicRaw);
    shared.fill(0);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(sealAad(storeId, header.fingerprint, header.keyId));
    decipher.setAuthTag(body.subarray(body.length - 16));
    let dek: Buffer;
    try {
      dek = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
    } finally {
      key.fill(0);
    }
    if (keyIdOf(dek) !== header.keyId) {
      dek.fill(0);
      throw new Error("the sealed key doesn't match its key id");
    }
    return dek;
  }
}

/** The private key from its text (`recovery-keygen`'s line), or a refusal that never echoes it. */
export function recoveryOpenerFromText(text: string): RecoveryOpener | { refusal: string } {
  const raw = rawKeyText(text);
  if (raw === null) return { refusal: "that isn't a recovery private key (base64 of 32 bytes, as recovery-keygen wrote it)." };
  try {
    return new RecoveryOpener(raw);
  } finally {
    raw.fill(0);
  }
}

/** A new recovery keypair (`recovery-keygen`): the private key's line, the public key for HOSTED_RECOVERY_PUBKEY, and the fingerprint. */
export function generateRecoveryKey(): { privateText: string; publicText: string; fingerprint: string } {
  const pair = generateKeyPairSync("x25519");
  const priv = Buffer.from(pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32));
  const pub = rawPublic(pair.publicKey);
  const out = { privateText: `cp-recovery:${priv.toString("base64")}`, publicText: pub.toString("base64"), fingerprint: recoveryFingerprint(pub) };
  priv.fill(0);
  return out;
}

/** The HKDF info label of the forms' CSRF key: a key family of its own, apart from `deriveKey`'s. */
export const CSRF_KEY_INFO = "counterparts csrf v1";

/**
 * THE FORMS' CSRF KEY from the current cookie key (H1, 2026-10-29): HKDF-SHA256,
 * no salt, so every process given the same COOKIE_KEYS checks the same tokens
 * and a restart keeps the open forms. Here because every KDF lives in this file.
 * (Never from a KEK: WB1 checked every caller of the KDFs here.)
 */
export function csrfKey(cookieKey: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(cookieKey, "utf8"), Buffer.alloc(0), Buffer.from(CSRF_KEY_INFO, "utf8"), 32));
}

/** A purpose-bound key from a DEK. Never the DEK itself. */
export function deriveKey(dek: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", dek, Buffer.alloc(0), Buffer.from(`counterparts/${purpose}`, "utf8"), 32));
}

/** The store's Litestream SSE-C key, base64 (the form Litestream's key file takes). */
export function litestreamKey(dek: Buffer): string {
  return deriveKey(dek, "litestream-sse-c").toString("base64");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS store_keys (
  store_id TEXT PRIMARY KEY,
  wrapped TEXT NOT NULL,
  kek_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS volume_facts (
  name TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`;

/**
 * Facts about this volume's backups, kept in `keys.sqlite` (R7, the #661
 * review): they go with it when it is lost, which is what makes them safe to
 * act on (a volume rebuilt without them is treated as one that may have had
 * keys somewhere).
 *
 *   - `backups-turned-on`: a start with NEW_BUCKET began turning backups on for
 *     a volume that had run with BACKUPS=off. Written before anything is made
 *     or put. A store opened before it never had a key anywhere.
 *   - `control-key-in-bucket`: this volume's control key has reached a bucket
 *     (`ensureAll`, after its `ensureStore(control)`).
 */
export type VolumeFact = "backups-turned-on" | "control-key-in-bucket";

/** The wrapped DEKs, on the volume (`keys/keys.sqlite`). Not replicated by Litestream (design §5.4). */
export class KeyStore {
  private readonly db: Db;
  private wrapper: KeyWrapper;
  private readonly now: () => number;

  constructor(opts: { path: string; wrapper: KeyWrapper; now?: () => number }) {
    mkdirSync(dirname(opts.path), { recursive: true, mode: 0o700 });
    this.db = openDb(opts.path, { wal: true });
    // A deleted wrapped DEK must not stay in a free cell of the file: node:sqlite's
    // default is OFF (bun's is FAST), and the KEK plus a copy of the volume would
    // otherwise rebuild a "shredded" key.
    this.db.get("PRAGMA secure_delete = ON");
    this.db.exec(SCHEMA);
    this.wrapper = opts.wrapper;
    this.now = opts.now ?? ((): number => Date.now());
  }

  close(): void {
    this.db.close();
  }

  /** A new DEK for a new store; returns its wrapped form (for the one backup object). Refuses a store that has one. */
  async create(storeId: string): Promise<WrappedKey> {
    if (this.wrapped(storeId) !== null) throw new Error("that store already has a key");
    const dek = randomBytes(DEK_BYTES);
    try {
      return await this.insert(storeId, dek);
    } finally {
      dek.fill(0);
    }
  }

  /** The DEK wrapped under the current wrapper (its key made first, if it may be: `KeyWrapper.ready`) and inserted. */
  private async insert(storeId: string, dek: Buffer): Promise<WrappedKey> {
    this.wrapper.ready?.(this.versions());
    const wrapped = await this.wrapper.wrap(dek, storeId);
    this.db.run("INSERT INTO store_keys (store_id, wrapped, kek_version, created_at) VALUES (?, ?, ?, ?)", storeId, wrapped, kekVersionOf(wrapped), this.now());
    return wrapped;
  }

  /** The KEK versions keys.sqlite's rows are under. */
  versions(): string[] {
    return this.db.all<{ v: string }>("SELECT DISTINCT kek_version AS v FROM store_keys ORDER BY v").map((r) => r.v);
  }

  /** How many rows are under a version other than the current wrapper's (keys from HOSTED_KEKS, before `migrate-keys`). */
  notOnCurrent(): number {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM store_keys WHERE kek_version != ?", this.wrapper.version)?.n ?? 0;
  }

  /**
   * A KEY FROM BEFORE WB1, ADOPTED: a `w1.` value from the bucket's old
   * `keys/<id>.wrapped`, opened under the ring for THIS store id (so only while
   * `HOSTED_KEKS` still holds its version), and wrapped here under the current
   * wrapper. When a key is already here it must be the same DEK; a different one
   * is refused, loudly — adopting it would bury the key one of the two copies is
   * encrypted under. Returns true when it inserted.
   */
  async adopt(storeId: string, wrapped: WrappedKey): Promise<boolean> {
    const incoming = await this.wrapper.unwrap(wrapped, storeId);
    try {
      return await this.adoptDek(storeId, incoming);
    } finally {
      incoming.fill(0);
    }
  }

  /**
   * RESTORE'S FIRST STEP (WB1): a DEK opened from the bucket's sealed copy by
   * `recover-keys`, wrapped here. A key already here must be the same DEK; a
   * different one is refused. Returns true when it inserted. The caller zeroes `dek`.
   */
  async adoptDek(storeId: string, dek: Buffer): Promise<boolean> {
    const here = this.wrapped(storeId);
    if (here !== null) {
      const mine = await this.wrapper.unwrap(here, storeId);
      const same = mine.equals(dek);
      mine.fill(0);
      if (!same) throw new Error("a different key for that store is already here");
      return false;
    }
    await this.insert(storeId, dek);
    return true;
  }

  /** The store's key id (`keyIdOf`), or null with no key here: what its sealed copy in the bucket must name. */
  async keyId(storeId: string): Promise<string | null> {
    if (this.wrapped(storeId) === null) return null;
    const dek = await this.dek(storeId);
    try {
      return keyIdOf(dek);
    } finally {
      dek.fill(0);
    }
  }

  /** The store's DEK sealed to the recovery key: its object in the bucket. */
  async sealed(storeId: string, sealer: RecoverySealer): Promise<string> {
    const dek = await this.dek(storeId);
    try {
      return sealer.seal(dek, storeId);
    } finally {
      dek.fill(0);
    }
  }

  /** When a `VolumeFact` was first recorded (ms), or null. */
  fact(name: VolumeFact): number | null {
    return this.db.get<{ at: number }>("SELECT at FROM volume_facts WHERE name = ?", name)?.at ?? null;
  }

  /** Records a `VolumeFact` once: the first time is kept. */
  recordFact(name: VolumeFact): void {
    this.db.run("INSERT OR IGNORE INTO volume_facts (name, at) VALUES (?, ?)", name, this.now());
  }

  /** When this volume's key for the store was made or adopted here (ms), or null. A rewrap keeps it. */
  createdAt(storeId: string): number | null {
    return this.db.get<{ created_at: number }>("SELECT created_at FROM store_keys WHERE store_id = ?", storeId)?.created_at ?? null;
  }

  wrapped(storeId: string): WrappedKey | null {
    return this.db.get<{ wrapped: string }>("SELECT wrapped FROM store_keys WHERE store_id = ?", storeId)?.wrapped ?? null;
  }

  /** The store's DEK, unwrapped. The caller zeroes it when done. */
  async dek(storeId: string): Promise<Buffer> {
    const w = this.wrapped(storeId);
    if (w === null) throw new Error("no key for that store");
    return this.wrapper.unwrap(w, storeId);
  }

  /** A wrapped value from elsewhere (the bucket's old `.wrapped`, before WB1), opened under this ring for this store: a check. The caller zeroes it. */
  async unwrapForCheck(storeId: string, wrapped: WrappedKey): Promise<Buffer> {
    return this.wrapper.unwrap(wrapped, storeId);
  }

  storeIds(): string[] {
    return this.db.all<{ store_id: string }>("SELECT store_id FROM store_keys ORDER BY created_at").map((r) => r.store_id);
  }

  /**
   * Crypto-shred, locally: the wrapped DEK is gone — its cell zeroed
   * (`secure_delete`) and the log folded back and truncated, so no old frame of
   * it stays in `keys.sqlite-wal`. This file is not replicated, so the checkpoint
   * is ours to run. A busy checkpoint is retried by the next delete.
   */
  delete(storeId: string): void {
    this.db.run("DELETE FROM store_keys WHERE store_id = ?", storeId);
    try {
      this.db.get("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      /* busy: the next delete's checkpoint folds it */
    }
  }

  /** The store ids whose wrapped DEK this wrapper can't open (a KEK version dropped before a rewrap finished). */
  async unreadable(): Promise<string[]> {
    const bad: string[] = [];
    for (const row of this.db.all<{ store_id: string; wrapped: string }>("SELECT store_id, wrapped FROM store_keys")) {
      try {
        (await this.wrapper.unwrap(row.wrapped, row.store_id)).fill(0);
      } catch {
        bad.push(row.store_id);
      }
    }
    return bad;
  }

  /**
   * Move every wrapped DEK not on `to.version` onto it: unwrap with the old
   * (the current wrapper must still hold the old version), wrap with the new,
   * one store at a time, each in its own write. Returns the store ids moved.
   * After a rewrap, `to` is this store's wrapper. (`migrate-keys` moves the
   * keys from `HOSTED_KEKS` onto the volume KEK with it, WB1.)
   */
  async rewrap(to: KeyWrapper): Promise<string[]> {
    const moved: string[] = [];
    to.ready?.(this.versions());
    for (const row of this.db.all<{ store_id: string; wrapped: string }>("SELECT store_id, wrapped FROM store_keys WHERE kek_version != ?", to.version)) {
      const dek = await this.wrapper.unwrap(row.wrapped, row.store_id).catch(async () => to.unwrap(row.wrapped, row.store_id));
      const next = await to.wrap(dek, row.store_id);
      dek.fill(0);
      this.db.run("UPDATE store_keys SET wrapped = ?, kek_version = ? WHERE store_id = ?", next, to.version, row.store_id);
      moved.push(row.store_id);
    }
    this.wrapper = to;
    return moved;
  }
}
