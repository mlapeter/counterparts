/**
 * `export` — the only way memory leaves this machine, and it leaves by hand.
 *
 * The property is **no silent egress** (contract §4, owner rescope 2): the core
 * has no egress path at all, and this command is an explicit owner action. That
 * makes export the one place the constitution's line 6 — "data leaves the
 * machine only by the owner's explicit choice, encrypted, owner-keyed" — is
 * either honored or quietly broken.
 *
 * **So there is no default.** `--passphrase` encrypts; `--plaintext` is the
 * loud, deliberate opt-out for the ordinary case of copying a store to another
 * directory on the same disk. Neither flag is a REFUSAL, not a guess. An export
 * that silently wrote plaintext because nobody said otherwise is exactly the
 * shape of accident line 6 exists to prevent.
 *
 * Contract §7 OQ1 — "does export encrypt to a key the owner already has, or does
 * it mint one?" — is answered PROVISIONALLY here as: the owner supplies a
 * passphrase, and nothing is minted. Minting is friendlier and is also how an
 * owner ends up with a backup they cannot open. Recorded in NOTES.md as an open
 * owner call, not as a settled one.
 *
 * Crypto is `node:crypto` only: scrypt for the KDF, AES-256-GCM for the payload.
 * No dependency, and the format is documented in the plaintext README written
 * beside the blob — an encrypted archive whose format is undocumented is a
 * different way of losing the data.
 */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, relative } from "node:path";

import { paths } from "../../core/store/index.js";
import type { Store } from "../../core/store/index.js";
import { assertSafeTarget, vacuumInto } from "./snapshot.js";

/** The KDF's cost parameters travel WITH the blob: a hardcoded N is a format
 *  that cannot be strengthened without orphaning every existing export. */
export const KDF = { N: 16384, r: 8, p: 1, keyBytes: 32, saltBytes: 16 } as const;
export const CIPHER = "aes-256-gcm";
export const EXPORT_FORMAT = "counterparts-export-1";
export const BLOB_NAME = "counterparts-export.cpx";

export type ExportMode = "plaintext" | "encrypted";

export interface ExportOptions {
  target: string;
  /** Present ⇒ encrypted. Absent AND `plaintext` false ⇒ refusal. */
  passphrase?: string;
  /** The loud opt-out. */
  plaintext?: boolean;
}

export interface ExportReport {
  readonly ok: boolean;
  readonly mode: ExportMode | "refused";
  readonly target: string;
  readonly files: number;
  readonly bytes: number;
  readonly reason: string;
}

/** path (relative, portable) -> file bytes. Prose stays prose. */
type Bundle = Map<string, Buffer>;

function collect(store: Store, tmpDb: string): Bundle {
  const bundle: Bundle = new Map();
  const proseRoot = paths.prose(store.dir);
  const walk = (path: string): void => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
      return;
    }
    bundle.set(join("prose", relative(proseRoot, path)), readFileSync(path));
  };
  walk(proseRoot);
  // THE DATABASE GOES THROUGH VACUUM INTO, even here. §2.11 does not care
  // whether the file copy is labelled "backup" or "export".
  const copied = vacuumInto(paths.operational(store.dir), tmpDb);
  if (copied.ok) bundle.set("operational.sqlite", readFileSync(tmpDb));
  return bundle;
}

export function exportStore(store: Store, opts: ExportOptions): ExportReport {
  const encrypting = typeof opts.passphrase === "string" && opts.passphrase.length > 0;
  if (!encrypting && opts.plaintext !== true) {
    return {
      ok: false,
      mode: "refused",
      target: opts.target,
      files: 0,
      bytes: 0,
      reason:
        "export refuses to choose for you: pass --passphrase <secret> to encrypt, or --plaintext to say out loud that this copy is unencrypted.",
    };
  }

  let target: string;
  try {
    target = assertSafeTarget(store.dir, opts.target);
    mkdirSync(target, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      mode: "refused",
      target: opts.target,
      files: 0,
      bytes: 0,
      reason: String((err as Error).message ?? err),
    };
  }

  const tmpDb = join(paths.tmp(store.dir), `export-${Date.now()}.sqlite`);
  mkdirSync(paths.tmp(store.dir), { recursive: true });
  let bundle: Bundle;
  try {
    bundle = collect(store, tmpDb);
  } finally {
    rmSync(tmpDb, { force: true });
  }

  let bytes = 0;
  for (const buf of bundle.values()) bytes += buf.length;

  if (!encrypting) {
    for (const [path, buf] of bundle) {
      const out = join(target, path);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, buf);
    }
    writeFileSync(
      join(target, "README.md"),
      plaintextReadme(bundle.size, bytes),
      "utf8",
    );
    return {
      ok: true,
      mode: "plaintext",
      target,
      files: bundle.size,
      bytes,
      reason: "Unencrypted, at the owner's explicit request. Prose is readable in any editor.",
    };
  }

  const blob = encryptBundle(bundle, opts.passphrase as string);
  writeFileSync(join(target, BLOB_NAME), blob);
  writeFileSync(join(target, "README.md"), encryptedReadme(bundle.size, bytes), "utf8");
  return {
    ok: true,
    mode: "encrypted",
    target,
    files: bundle.size,
    bytes,
    reason: `Encrypted with ${CIPHER} under a key derived from your passphrase. Lose the passphrase and this archive is gone.`,
  };
}

export function encryptBundle(bundle: Bundle, passphrase: string): Buffer {
  const salt = randomBytes(KDF.saltBytes);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, KDF.keyBytes, { N: KDF.N, r: KDF.r, p: KDF.p });
  const manifest: Record<string, string> = {};
  for (const [path, buf] of bundle) manifest[path] = buf.toString("base64");
  const plain = gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"));
  const cipher = createCipheriv(CIPHER, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope = {
    format: EXPORT_FORMAT,
    cipher: CIPHER,
    kdf: { name: "scrypt", ...KDF },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: body.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

/**
 * The read-back half. It exists because a backup nobody has ever opened is not
 * evidence of anything (contract §7 OQ3, and §2.17's "an untried path is
 * unproven"): `test/cli.test.ts` round-trips a real export through it.
 */
export function decryptBundle(blob: Buffer, passphrase: string): Map<string, Buffer> {
  const envelope = JSON.parse(blob.toString("utf8")) as {
    format: string;
    kdf: { N: number; r: number; p: number; keyBytes: number };
    salt: string;
    iv: string;
    tag: string;
    payload: string;
  };
  if (envelope.format !== EXPORT_FORMAT) throw new Error(`unknown export format: ${envelope.format}`);
  const salt = Buffer.from(envelope.salt, "base64");
  const key = scryptSync(passphrase, salt, envelope.kdf.keyBytes, {
    N: envelope.kdf.N,
    r: envelope.kdf.r,
    p: envelope.kdf.p,
  });
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = gunzipSync(
    Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]),
  );
  const manifest = JSON.parse(plain.toString("utf8")) as Record<string, string>;
  const out = new Map<string, Buffer>();
  for (const [path, b64] of Object.entries(manifest)) out.set(path, Buffer.from(b64, "base64"));
  return out;
}

function plaintextReadme(files: number, bytes: number): string {
  return [
    "# Counterparts export (UNENCRYPTED)",
    "",
    `${files} files, ${bytes} bytes, written at the owner's explicit request with --plaintext.`,
    "",
    "- `prose/` — the memories themselves, Markdown, readable in any editor.",
    "- `operational.sqlite` — canonical operational state, copied through SQLite's",
    "  own VACUUM INTO, never as a file copy of a live database.",
    "",
    "The rebuildable cache is deliberately not included: it is reconstructed from",
    "the two things above.",
    "",
    "This copy is not encrypted. Treat it the way you would treat the store itself.",
    "",
  ].join("\n");
}

function encryptedReadme(files: number, bytes: number): string {
  return [
    "# Counterparts export (encrypted)",
    "",
    `\`${BLOB_NAME}\` holds ${files} files (${bytes} bytes before compression).`,
    "",
    "Format, so this is never an archive you cannot open:",
    "",
    `1. The blob is JSON: \`{format, cipher, kdf, salt, iv, tag, payload}\` — all base64.`,
    `2. Key = scrypt(passphrase, salt, N/r/p from the \`kdf\` field), ${KDF.keyBytes} bytes.`,
    `3. Payload = ${CIPHER}(gzip(JSON manifest of path -> base64 file bytes)).`,
    "",
    "The passphrase is yours and is not stored anywhere. There is no recovery path;",
    "that is the point of it being owner-keyed.",
    "",
  ].join("\n");
}
