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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, relative } from "node:path";

import { DATABASE_FILE, paths } from "../../core/store/index.js";
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

/** path (relative, portable) -> file bytes. */
type Bundle = Map<string, Buffer>;

/**
 * THE BUNDLE IS THE DATABASE.
 *
 * It used to be the database plus a walk of `prose/**.md`, because that is where
 * the memories were. Since the floor (schema v6) the bodies, their archived
 * versions and their metadata are rows, so the one file IS the export and the
 * walk had nothing left to find. That makes the §2.11 rule the whole of this
 * function rather than a footnote on it: the copy goes through `VACUUM INTO`,
 * which is SQLite's own consistent-snapshot path, and never a file copy of a
 * live database — doubly so now that a torn copy would lose the words and not
 * just the bookkeeping.
 *
 * `--markdown`, `journal/` and `spans/` are F7's; this phase owns the deletion
 * of the prose walk and the move of the scratch file, nothing more.
 */
function collect(store: Store, tmpDb: string): Bundle {
  const bundle: Bundle = new Map();
  const copied = vacuumInto(paths.operational(store.dir), tmpDb);
  if (copied.ok) bundle.set(DATABASE_FILE, readFileSync(tmpDb));
  return bundle;
}

/**
 * Remove any `.export-scratch-*` an interrupted export of an OLDER BUILD left in
 * this target.
 *
 * Belt and braces for exactly one window: a build between the floor landing and
 * this fix wrote its scratch here, and a kill during the vacuum left a
 * plaintext copy of the store behind under a timestamped name that the next
 * export would never collide with. Nothing writes that name any more; this is
 * how the ones already on disk go. It never throws — an export must not fail
 * because a stale file would not delete.
 */
function sweepStaleScratch(target: string): void {
  try {
    for (const name of readdirSync(target)) {
      if (!name.startsWith(".export-scratch-")) continue;
      rmSync(join(target, name), { recursive: true, force: true });
    }
  } catch {
    /* an unreadable target fails for its own reasons, further down */
  }
}

/** What the report says when this export cleaned up after an interrupted one. */
function sweptNote(swept: readonly string[]): string {
  if (swept.length === 0) return "";
  return (
    ` Also removed ${String(swept.length)} abandoned scratch ` +
    `director${swept.length === 1 ? "y" : "ies"} an interrupted export had left in the temp dir ` +
    "(each held an unencrypted copy of the store)."
  );
}

/** The prefix this module's scratch directories wear, in the OS temp dir. */
export const EXPORT_SCRATCH_PREFIX = "counterparts-export-";

/**
 * How old an abandoned scratch directory must be before a later export removes
 * it. **The bound is the whole point**: without it this sweep would delete a
 * CONCURRENT export's directory mid-vacuum, which is a collision the target
 * sweep above cannot have (it matches a name nothing writes any more).
 *
 * Same reasoning and the same number as `adapters/snapshots.ts#PARTIAL_STALE_MS`:
 * comfortably longer than any single export could plausibly still be running.
 */
export const EXPORT_SCRATCH_STALE_MS = 60 * 60_000;

/**
 * Remove abandoned `counterparts-export-*` directories from the OS temp dir.
 *
 * An interrupted `--passphrase` export leaves a PLAINTEXT SQLite copy of the
 * whole store in one (0700, so only this user can read it) and nothing swept
 * it: on macOS `/var/folders` is reaped after roughly three days of non-access,
 * otherwise it sits there (review f5c, NEW-MINOR-6). Moving it out of the
 * target was the big win; this is the rest of it.
 *
 * Exact prefix, `mtime` older than the bound, and only entries this user owns —
 * the temp dir is shared on some systems, and a sweep that took somebody else's
 * directory would be a worse bug than the one it fixes. Never throws.
 */
export function sweepStaleExportScratch(now = Date.now()): string[] {
  const swept: string[] = [];
  const root = tmpdir();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return swept;
  }
  for (const name of names) {
    if (!name.startsWith(EXPORT_SCRATCH_PREFIX)) continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (!st.isDirectory()) continue;
      if (st.uid !== process.getuid?.()) continue;
      if (now - st.mtimeMs < EXPORT_SCRATCH_STALE_MS) continue;
      rmSync(full, { recursive: true, force: true });
      swept.push(name);
    } catch {
      /* a directory that will not stat or will not go is not this export's problem */
    }
  }
  return swept;
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

  // THE SCRATCH GOES IN THE OS TEMP DIR — not in the store, and NOT IN THE
  // TARGET.
  //
  // It lived in `<store>/tmp/` until the floor deleted that directory with the
  // staging it existed for, and a scratch file in the store would now fail the
  // next `assertLayout()` as an unclassified top-level path (§5 G11). The first
  // fix moved it into the target, which `assertSafeTarget` proves is outside
  // the store — and that was the wrong outside. The scratch is a PLAINTEXT
  // SQLite copy of the whole store, and the target of a `--passphrase` export
  // is by definition the place the copy is going: an external disk, a synced
  // folder, the directory the owner is about to hand somebody. Review B killed
  // an exporter mid-`VACUUM INTO` and found a 4 MB unencrypted copy of the
  // memories left behind under a timestamped name that nothing would ever
  // overwrite or sweep (MAJOR-4). `--passphrase` exists precisely to say "this
  // copy leaves the machine".
  //
  // `mkdtempSync` gives it a private directory (0700 by construction) that the
  // OS reaps, so an interrupted export leaks at worst into a temp dir rather
  // than into the artefact. The whole directory goes in the `finally`.
  sweepStaleScratch(target);
  // …and the ones an interrupted export of our own left in the OS temp dir.
  // Said out loud rather than done in silence: it is the owner's plaintext.
  const sweptScratch = sweepStaleExportScratch();
  const scratchDir = mkdtempSync(join(tmpdir(), EXPORT_SCRATCH_PREFIX));
  const tmpDb = join(scratchDir, "scratch.sqlite");
  let bundle: Bundle;
  try {
    bundle = collect(store, tmpDb);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
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
      reason:
        "Unencrypted, at the owner's explicit request. The database is readable by any SQLite." +
        sweptNote(sweptScratch),
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
    reason:
      `Encrypted with ${CIPHER} under a key derived from your passphrase. Lose the passphrase and this archive is gone.` +
      sweptNote(sweptScratch),
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
    `- \`${DATABASE_FILE}\` — the whole store: the memories themselves, their`,
    "  archived versions, and every structured field. Copied through SQLite's own",
    "  VACUUM INTO, never as a file copy of a live database.",
    "",
    "The rebuildable cache is deliberately not included: it is reconstructed from",
    "the database above.",
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
