/**
 * PER-STORE KEYS (OL2 step 5; design: docs/hosted/DESIGN.md §5.4, as Mike
 * changed it on 2026-10-26).
 *
 * Envelope encryption:
 *
 *   - **The KEK** (key-encryption key) is reached ONLY through a `KeyWrapper`.
 *     For the beta it is a Railway secret (`EnvKeyWrapper`); later it moves to
 *     our own small Cloudflare Worker key service, called only from Railway's
 *     fixed egress IP — a second `KeyWrapper`, and nothing else changes.
 *     **Nothing else in hosted/ touches the raw KEK** (pinned by a test that
 *     greps for the variable's name).
 *   - **A DEK** (data-encryption key) per store: 32 random bytes made at
 *     sign-up, stored only WRAPPED (AES-256-GCM under the KEK, a fresh random
 *     96-bit nonce per wrap; the store id AND the KEK version as associated
 *     data, so a wrapped value can't be moved to another store or relabelled
 *     to another version; the version also recorded on the wrapped value).
 *   - **What a DEK keys**, through HKDF-SHA256 with a purpose label, never the
 *     DEK itself: the store's Litestream SSE-C key (`litestreamKey`).
 *   - **Rewrap** moves every wrapped DEK from KEK version N to N+1: rotation, and
 *     the later move to the Cloudflare key service, in one operation.
 *
 * Deleting a store deletes its wrapped DEK here and its one backup object in R2
 * (`backup.ts`), at once: with the KEK alone nobody can rebuild the DEK, and
 * without the DEK every Litestream copy of that store is ciphertext.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
}

export const DEK_BYTES = 32;

/** The KEK version a wrapped value names. */
export function kekVersionOf(wrapped: WrappedKey): string {
  const parts = wrapped.split(".");
  if (parts.length !== 4 || parts[0] !== "w1" || !/^[A-Za-z0-9_-]{1,32}$/.test(parts[1] ?? "")) throw new Error("not a wrapped key");
  return parts[1]!;
}

/**
 * THE BETA'S KEK HOLDER: keys from the environment (`HOSTED_KEKS`, parsed by
 * `kekRingFromEnv`). The only code in hosted/ that sees a raw KEK.
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

  async wrap(dek: Buffer, aad: string): Promise<WrappedKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.ring.get(this.version)!, iv);
    cipher.setAAD(boundAad(this.version, aad));
    const ct = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
    return `w1.${this.version}.${iv.toString("base64url")}.${ct.toString("base64url")}`;
  }

  async unwrap(wrapped: WrappedKey, aad: string): Promise<Buffer> {
    const version = kekVersionOf(wrapped);
    const kek = this.ring.get(version);
    if (kek === undefined) throw new Error(`no KEK version ${version} in the ring`);
    const [, , ivB64, ctB64] = wrapped.split(".");
    const iv = Buffer.from(ivB64!, "base64url");
    const body = Buffer.from(ctB64!, "base64url");
    if (iv.length !== 12 || body.length < 17) throw new Error("not a wrapped key");
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAAD(boundAad(version, aad));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  }
}

/** The associated data a wrap is bound to: the format, the KEK version and the caller's label (the store id). */
function boundAad(version: string, aad: string): Buffer {
  return Buffer.from(`counterparts/dek/w1\u0000${version}\u0000${aad}`, "utf8");
}

/**
 * `HOSTED_KEKS="v1:<base64 32 bytes>,v2:<…>"` and `HOSTED_KEK_CURRENT="v2"`
 * (current defaults to the only version when there is one). Returns the
 * wrapper, or a refusal that never echoes a key.
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
    if (key.length !== 32) return { refusal: `HOSTED_KEKS: key ${version} is not 32 bytes.` };
    if (ring.has(version)) return { refusal: `HOSTED_KEKS: version ${version} appears twice.` };
    if ([...ring.values()].some((k) => k.equals(key))) return { refusal: `HOSTED_KEKS: key ${version} repeats another version's key.` };
    ring.set(version, key);
  }
  const current = env["HOSTED_KEK_CURRENT"] ?? (ring.size === 1 ? [...ring.keys()][0]! : "");
  if (!ring.has(current)) return { refusal: "set HOSTED_KEK_CURRENT to a version in HOSTED_KEKS." };
  return new EnvKeyWrapper(ring, current);
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
`;

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
    const wrapped = await this.wrapper.wrap(dek, storeId);
    dek.fill(0);
    this.db.run("INSERT INTO store_keys (store_id, wrapped, kek_version, created_at) VALUES (?, ?, ?, ?)", storeId, wrapped, kekVersionOf(wrapped), this.now());
    return wrapped;
  }

  /**
   * RESTORE'S FIRST STEP: take a store's wrapped DEK back from its one backup
   * object (`keys.sqlite` is never replicated, so a new volume starts without
   * it). The value must open under the ring for THIS store id. When a key is
   * already here it must be the same DEK (a rewrap changes the wrapping, never
   * the key); a different one is refused, loudly — adopting it would bury the
   * key one of the two copies is encrypted under. Returns true when it inserted.
   */
  async adopt(storeId: string, wrapped: WrappedKey): Promise<boolean> {
    const incoming = await this.wrapper.unwrap(wrapped, storeId);
    try {
      const here = this.wrapped(storeId);
      if (here !== null) {
        const mine = await this.wrapper.unwrap(here, storeId);
        const same = mine.equals(incoming);
        mine.fill(0);
        if (!same) throw new Error("a different key for that store is already here");
        return false;
      }
      this.db.run("INSERT INTO store_keys (store_id, wrapped, kek_version, created_at) VALUES (?, ?, ?, ?)", storeId, wrapped, kekVersionOf(wrapped), this.now());
      return true;
    } finally {
      incoming.fill(0);
    }
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

  /** A wrapped value from elsewhere (the bucket), opened under this ring for this store: a check. The caller zeroes it. */
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
   * one store at a time, each in its own write. Returns the store ids moved,
   * so the caller re-uploads their backup objects. After a rewrap, `to` is
   * this store's wrapper.
   */
  async rewrap(to: KeyWrapper): Promise<string[]> {
    const moved: string[] = [];
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
