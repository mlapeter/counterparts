#!/usr/bin/env node
/**
 * THE HOSTED SERVER'S ENTRY POINT (OL2 step 4). Run on Node 24:
 *
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts serve
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts invite [--uses N] [--note TEXT] [--expires DAYS]
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts spots [set N | emails M]   (SU1: how many accounts hosted takes in all; shows N,
 *                                         people and spots left; `set` takes effect at once, no restart. Never set: 0, closed.
 *                                         EC1: `emails M`, the sign-in emails an hour while open; never set: 100)
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts signups   (people and sign-ups per week, counts only; reads, safe beside the running server)
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts restore <storeId|control|--all> [--force]   (server stopped)
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts start-over <storeId>   (a store that never reached the bucket)
 *
 * Write-only backups (WB1; keys.ts, keyops.ts; docs/hosted/RUNBOOK.md, Write-only backups):
 *
 *   … main.ts recovery-keygen   (on Mike's Mac: a recovery keypair; the private key printed to the terminal once, no file)
 *   … main.ts recovery-fingerprint [--key-file <path>]   (a private key's fingerprint, the key read from stdin, not shown)
 *   … main.ts migrate-keys --recovery-fingerprint <fp> [--dry-run] [--abort-control-rekey]   (server stopped, HOSTED_KEKS still
 *                                         set: the keys onto the volume KEK, the bucket's sealed, control re-keyed)
 *   … main.ts recover-keys [--dry-run] [--key-file <path>] [--control-aside <label>] [--adopt-unproven]   (after a volume is lost:
 *                                         the private key from stdin, not shown, or the file; never from the environment)
 *   … main.ts hold   (a start-command override: answers /readyz and nothing else, so `railway ssh` reaches a stopped server)
 *
 * Everything comes from the environment, and nothing falls back to a default:
 *
 *   HOSTED_DATA_ROOT   absolute path of the volume (required; refused inside a live store)
 *   PUBLIC_ORIGIN      https://app.counterparts.ai (required; every published URL is built from it)
 *   PORT               the port to bind on 0.0.0.0 (serve; default 8080)
 *   TRUST_PROXY        how many proxy hops are in front (X-Forwarded-For / -Proto): "2" on Railway (its edge
 *                      adds a hop; RUNBOOK §5.3); unset or "0" trusts neither header; anything else is refused
 *   RESEND_API_KEY     the mail provider's key (serve; required unless MAIL=log)
 *   MAIL_FROM          e.g. "Counterparts <memory@counterparts.ai>"
 *   MAIL               "log" prints login links to stderr instead of sending (local runs only)
 *   COOKIE_KEYS        comma-separated keys for the OAuth library's cookies, newest first, each 32+ characters
 *                      (optional); the first also seeds the forms' CSRF key, so open forms survive a restart.
 *                      Unset: both are random per process, and every open form expires on a restart
 *   HOSTED_RECOVERY_PUBKEY  the recovery key's PUBLIC half (recovery-keygen prints it): every key object put in the
 *                      bucket is sealed to it (WB1). Required with backups on. The private half never goes in the env
 *   HOSTED_KEKS, HOSTED_KEK_CURRENT   the env KEK ring from before WB1, read only to open keys still under it, until
 *                      migrate-keys has moved them onto the volume KEK (keys/volume.kek); then removed
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   one bucket, objects only
 *   LITESTREAM_BIN     the sidecar binary (default: litestream on PATH)
 *   BACKUPS            "off" for a local run with no bucket
 *   LOG_FORWARDED_FOR  "1": log the raw X-Forwarded-For of each /readyz request (first deploy's hop check; unset after)
 *   RESTORE_ON_BOOT    "1": serve restores what this volume is missing from the bucket before it starts
 *                      (the control databases, then every store that lived and has no files here)
 *   CONTROL_ASIDE      a label (letters, digits, - and _): serve moves control/ to control.aside-<label>
 *                      before anything opens it, ONCE per label (the guard overrides/control-aside-<label>.used
 *                      stays), and only on a volume refused as "not the key that wrote the bucket's backups";
 *                      with RESTORE_ON_BOOT=1
 *   NEW_BUCKET         <R2_ENDPOINT's host>/<R2_BUCKET>: this volume has lived (a person or a store) and the
 *                      bucket has no control key ON PURPOSE (a move to a new bucket, or turning backups on after
 *                      BACKUPS=off). Without it such a start is refused (R7). One deploy, then unset
 *
 * No secret is ever printed. `invite` prints the new code once, to stdout.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, join } from "node:path";

import { withEmbedderDefault } from "../../src/adapters/config.js";
import { openDb } from "../../src/core/store/db.js";
import { openEmbedder } from "../../src/adapters/claude-code/embed-client.js";
import { isEntryPoint } from "../../src/adapters/mcp/bin/serve.js";
import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts, MAX_EMAILS_PER_HOUR, MAX_SPOTS, REVIEWER_DEFAULT_DAYS } from "./accounts.js";
import { OidcStore } from "./oauth-adapter.js";
import { controlVolume, createApp, foreignControlRefusal, restoreControl } from "./app.js";
import type { AppBackupOptions, ControlVolume } from "./app.js";
import { errorLine } from "./server.js";
import type { HostedCallRecord } from "./server.js";
import { Backups, CONTROL_DATABASES, CONTROL_KEY_ID, LitestreamSidecar, litestreamRunner, replicaPrefix, tombstoneObject } from "./backup.js";
import type { KeylessReason, LitestreamRun, UploadsEvent } from "./backup.js";
import { signupsCommand } from "./signups.js";
import { STORE_ID, Tenants, storeTag } from "./tenants.js";
import type { SharedEmbedder } from "./tenants.js";
import { KEK_ENV, KeyStore, generateRecoveryKey, recoveryOpenerFromText, recoverySealerFromEnv, volumeWrapperFromEnv } from "./keys.js";
import { SERVING_EVERY_MS, SERVING_MARK, migrateKeys, recoverKeys } from "./keyops.js";
import { memoryMailer, r2ObjectStore, resendMailer } from "./egress.js";
import type { Mailer } from "./egress.js";

export function readEnv(env: Record<string, string | undefined>, command: string): { ok: true; dataRoot: string; origin: string; port: number; trustProxy: number } | { ok: false; refusal: string } {
  const dataRoot = env["HOSTED_DATA_ROOT"];
  if (dataRoot === undefined || !isAbsolute(dataRoot)) return { ok: false, refusal: "refused: set HOSTED_DATA_ROOT to the volume's absolute path. This server never picks a default." };
  const origin = env["PUBLIC_ORIGIN"]?.replace(/\/+$/, "");
  if (origin === undefined || !/^https?:\/\/[^/]+$/.test(origin)) return { ok: false, refusal: "refused: set PUBLIC_ORIGIN (e.g. https://app.counterparts.ai), with no path." };
  if (command === "serve" && origin.startsWith("http://") && env["MAIL"] !== "log") return { ok: false, refusal: "refused: PUBLIC_ORIGIN must be https outside a local run (MAIL=log)." };
  // MAIL=log prints sign-in links to stderr: a local run only. With an https
  // origin it would put links into the host's logs (review of #646).
  if (command === "serve" && origin.startsWith("https://") && env["MAIL"] === "log") return { ok: false, refusal: "refused: MAIL=log is for a local http run; an https PUBLIC_ORIGIN must send real email." };
  const port = Number(env["PORT"] ?? "8080");
  if (command === "serve" && (!Number.isInteger(port) || port <= 0 || port > 65535)) return { ok: false, refusal: "refused: PORT is a whole number from 1 to 65535." };
  // A hop count, refused rather than ignored when it isn't one: "true" or "yes"
  // quietly meaning "no proxy" would put every client in one rate-limit bucket.
  const hopsRaw = env["TRUST_PROXY"] ?? "";
  if (command === "serve" && hopsRaw !== "" && !/^[0-9]$/.test(hopsRaw)) return { ok: false, refusal: "refused: TRUST_PROXY is how many proxy hops are in front of the server, 0 to 9 (2 on Railway; unset or 0 means none)." };
  const trustProxy = /^[0-9]$/.test(hopsRaw) ? Number(hopsRaw) : 0;
  const live = livePathRefusal(dataRoot, "HOSTED_DATA_ROOT");
  if (live !== null) return { ok: false, refusal: live.replace(/^\[counterparts\] /, "") };
  return { ok: true, dataRoot, origin, port, trustProxy };
}

function mailerFrom(env: Record<string, string | undefined>): Mailer | string {
  if (env["MAIL"] === "log") {
    const mem = memoryMailer();
    return {
      async send(mail) {
        await mem.send(mail);
        // Named by its subject: a sign-in link, or one of a delete's emails (R9).
        process.stderr.write(`[hosted] (MAIL=log) an email for ${mail.to}, "${mail.subject}":\n${mail.text}\n`);
      },
    };
  }
  const key = env["RESEND_API_KEY"];
  const from = env["MAIL_FROM"];
  if (key === undefined || key.length === 0 || from === undefined || from.length === 0) return "refused: set RESEND_API_KEY and MAIL_FROM (or MAIL=log for a local run).";
  return resendMailer({ apiKey: key, from });
}

/**
 * The backup pieces from the environment, or a refusal, or null for a local
 * run that said `BACKUPS=off`. R2's token is its own, scoped to one bucket's
 * objects (the runbook); its credentials reach the Litestream child and the
 * object client, and nothing else.
 */
export function backupFromEnv(env: Record<string, string | undefined>, dataRoot: string): AppBackupOptions | null | { refusal: string } {
  if (env["BACKUPS"] === "off") return null;
  // The volume KEK (WB1): a file on the volume, made at the first wrap; HOSTED_KEKS only while keys are still under it.
  const wrapper = volumeWrapperFromEnv(env, dataRoot);
  if ("refusal" in wrapper) return { refusal: `refused: ${wrapper.refusal}` };
  const sealer = recoverySealerFromEnv(env);
  if ("refusal" in sealer) return { refusal: `refused: ${sealer.refusal} (or BACKUPS=off for a local run)` };
  const endpoint = env["R2_ENDPOINT"];
  const bucket = env["R2_BUCKET"];
  const accessKeyId = env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = env["R2_SECRET_ACCESS_KEY"];
  if (endpoint === undefined || !/^https:\/\/[^/]+$/.test(endpoint) || bucket === undefined || bucket.length === 0 || accessKeyId === undefined || secretAccessKey === undefined) {
    return { refusal: "refused: set R2_ENDPOINT (https, no path), R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or BACKUPS=off for a local run)." };
  }
  const configPath = `${dataRoot}/litestream.yml`;
  const sidecar = new LitestreamSidecar({
    binary: litestreamBinary(env),
    configPath,
    env: litestreamEnv(env, accessKeyId, secretAccessKey),
    onEvent: (name) => process.stderr.write(`[hosted] ${name}\n`),
  });
  return { wrapper, sealer, objects: r2ObjectStore({ endpoint, bucket, accessKeyId, secretAccessKey }), bucket, endpoint, sidecar };
}

const litestreamBinary = (env: Record<string, string | undefined>): string => env["LITESTREAM_BIN"] ?? "litestream";

/**
 * The Litestream child's whole environment: PATH and the R2 credentials, nothing
 * else of the server's. And SSL_CERT_FILE when it is set (not a secret: the
 * drill's local S3 has its own certificate; production never sets it).
 */
function litestreamEnv(env: Record<string, string | undefined>, accessKeyId: string, secretAccessKey: string): Record<string, string> {
  const ca = env["SSL_CERT_FILE"];
  return { PATH: env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: accessKeyId, LITESTREAM_SECRET_ACCESS_KEY: secretAccessKey, ...(ca === undefined || ca === "" ? {} : { SSL_CERT_FILE: ca }) };
}

/** `restore`'s runner, from the same environment as the sidecar's. */
function restoreRunner(env: Record<string, string | undefined>): LitestreamRun {
  return litestreamRunner(litestreamBinary(env), litestreamEnv(env, env["R2_ACCESS_KEY_ID"] ?? "", env["R2_SECRET_ACCESS_KEY"] ?? ""));
}

/**
 * `restore <storeId|control|--all> [--force]`, with the server stopped. `--all`
 * is the volume's disaster recovery: the control databases (when missing),
 * then every live store whose database is missing. Prints counts, never an
 * address or a key; a store id is printed only when the operator named it.
 */
export { storeTag };

/**
 * `start-over <storeId>` (the #653 review, L8): the way out for a store that
 * was opened and never reached the bucket (its person signed up, the volume died
 * within seconds), which otherwise answers 503 forever. Refused unless its
 * database is missing here AND the bucket holds no replica object of it; then
 * its next open starts it as a new install.
 */
export async function startOverCommand(dataRoot: string, backup: AppBackupOptions, storeId: string | undefined): Promise<string> {
  if (storeId === undefined || !STORE_ID.test(storeId)) throw new Error("start-over needs a store id");
  const accounts = new Accounts({ path: join(dataRoot, "control", "accounts.sqlite") });
  const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: backup.wrapper });
  try {
    if (!accounts.liveStoreIds().includes(storeId)) throw new Error("that store isn't a live store in the accounts database");
    // A store set to be deleted (R6) is left as it is (the #659 re-check): kept, it can be started over then.
    if (accounts.storeLocked(storeId)) throw new Error("that store is set to be deleted: start it over only if its person keeps it");
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, sealer: backup.sealer, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => [storeId] });
    if (existsSync(backups.dbPaths(storeId)[0]!)) throw new Error("its database is here: nothing to start over");
    if ((await backup.objects.list(replicaPrefix(storeId))).length > 0) throw new Error("the bucket has a replica of it: restore it instead (RESTORE_ON_BOOT=1)");
    // A deleted store is never started over (the #653 re-review, N3): the next start finishes its delete.
    if ((await backup.objects.get(tombstoneObject(storeId))) !== null) throw new Error("the bucket has its tombstone: it was deleted, and the next start finishes the delete");
    accounts.clearOpened(storeId);
    return `store ${storeTag(storeId)}: starts over as a new, empty store at its next open`;
  } finally {
    keys.close();
    accounts.close();
  }
}

export async function restoreCommand(dataRoot: string, backup: AppBackupOptions, run: LitestreamRun, args: string[], embedder: SharedEmbedder): Promise<{ text: string; failed: number }> {
  const force = args.includes("--force");
  const target = args.find((a) => !a.startsWith("--")) ?? (args.includes("--all") ? "--all" : undefined);
  if (target === undefined || (target !== "--all" && target !== CONTROL_KEY_ID && !STORE_ID.test(target))) throw new Error("restore needs a store id, control, or --all");
  const lines: string[] = [];
  if (target === CONTROL_KEY_ID || target === "--all") {
    // One control database at a time: the one in place is kept unless --force.
    const r = await restoreControl(dataRoot, backup, run, force ? { force } : { missingOnly: true });
    lines.push(`control: ${String(r.restored)} restored, ${String(r.kept)} already here, ${String(r.empty)} with no backup`);
    if (target === CONTROL_KEY_ID) return { text: lines.join("\n"), failed: 0 };
  }
  const accountsPath = join(dataRoot, "control", "accounts.sqlite");
  if (!existsSync(accountsPath)) throw new Error("no accounts database here: restore control first (or --all)");
  const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: backup.wrapper });
  const accounts = new Accounts({ path: accountsPath });
  // Opens each restored store once, so its cache is rebuilt here, offline, not on the person's first call.
  // A store locked by a pending delete (R6) is restored but never opened: its marker rebuilds the cache at its first open after a keep.
  const tenants = new Tenants({ root: join(dataRoot, "tenants"), embedder, spawner: () => ({ pid: 0 }), locked: (id) => accounts.storeLocked(id) });
  try {
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, sealer: backup.sealer, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => accounts.liveStoreIds(), openedBefore: (id) => accounts.wasOpened(id), locked: (id) => accounts.storeLocked(id) });
    const live = accounts.liveStoreIds();
    if (target !== "--all" && !live.includes(target)) throw new Error("that store isn't a live store in the accounts database");
    const ids = target === "--all" ? (force ? live : backups.missingStores()) : [target];
    let restored = 0;
    let empty = 0;
    let failed = 0;
    const deleted = new Set(await backups.tombstoned());
    for (const id of ids) {
      if (deleted.has(id)) {
        // The bucket says it was deleted: never restored; the next start finishes its delete.
        lines.push(`store ${storeTag(id)}: deleted (the bucket has its tombstone); not restored, and the next start finishes the delete`);
        continue;
      }
      try {
        const r = await backups.restore(id, run, { force });
        if (r.restored > 0) {
          accounts.markOpened(id);
          if (!accounts.storeLocked(id)) await tenants.withTenant(id, {}, async () => undefined);
        }
        restored += r.restored;
        empty += r.empty;
      } catch (err) {
        failed += 1;
        // A tag, not the id (the #653 review, L5): matchable against the audit by whoever has the id, nothing more.
        // The message too: Litestream's own `Error:` lines name the database's path, and so the id.
        const message = err instanceof Error ? err.message : String(err);
        lines.push(`store ${storeTag(id)}: ${message.split(id).join(storeTag(id))}`);
      }
    }
    lines.push(`stores: ${String(restored)} restored, ${String(empty)} with no backup yet, ${String(failed)} failed, ${String(live.length - ids.length)} already here`);
    return { text: lines.join("\n"), failed };
  } finally {
    await tenants.closeAll();
    keys.close();
    accounts.close();
  }
}

/**
 * `MCP_ALLOWED_ORIGINS` (DIR1, 2026-11-10): the exact browser origins `/mcp` answers, comma-separated, for
 * a browser-based client such as MCP Inspector's web page (`http://localhost:6274`). Unset or empty: none,
 * as before, so claude.ai (which calls server to server, with no Origin) is unchanged. Each must be a bare
 * origin (scheme, host, port), never `*`, so a typo can't open the door to every page.
 */
export function mcpAllowedOrigins(raw: string | undefined): string[] & { refusal?: never } | { refusal: string } {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",").map((p) => p.trim()).filter((p) => p.length > 0)) {
    let origin: string | null = null;
    try {
      const u = new URL(part);
      origin = (u.protocol === "http:" || u.protocol === "https:") && u.origin === part ? u.origin : null;
    } catch {
      origin = null;
    }
    if (origin === null) return { refusal: `refused: MCP_ALLOWED_ORIGINS takes exact origins like http://localhost:6274, comma-separated; "${part.slice(0, 80)}" isn't one.` };
    out.push(origin);
  }
  return out;
}

/** One `/mcp` message for the container log: ids and codes only (CONTRACT §6). The record's strings are already cut to codes (`http.ts#code`). */
export function callLine(r: HostedCallRecord): string {
  const parts = [`store=${r.store}`, `method=${r.method}`];
  if (r.tool !== undefined) parts.push(`tool=${r.tool}`);
  parts.push(`ok=${String(r.ok)}`);
  if (r.reason !== undefined) parts.push(`reason=${r.reason}`);
  parts.push(`ms=${String(Math.round(r.ms))}`);
  if (r.connection !== null) parts.push(`conn=${r.connection.slice(0, 8)}`);
  if (r.client !== undefined && r.client !== null) parts.push(`client=${JSON.stringify(r.client)}`);
  if (r.clientVersion !== undefined && r.clientVersion !== null) parts.push(`clientVersion=${JSON.stringify(r.clientVersion)}`);
  if (r.protocolVersion !== undefined) parts.push(`protocol=${r.protocolVersion}`);
  return `[hosted] mcp ${parts.join(" ")}\n`;
}

/**
 * `serve`'s log line for an app event: limit refusals, stores waiting on a
 * restore, a new store's failed backup set-up (R3), a delete's email that
 * didn't send (R9). The event and the hashed
 * store tag, nothing else: never an id, an address or an error's text.
 */
export function eventLine(name: string, store: string): string {
  // `storeTag=` is `storeTag` (SHA-256, the restore CLI's tag); `store=` is server.ts's per-process HMAC tag.
  // AR1: counts and codes only; the second argument is never an id here.
  if (name === "retention.failed") return `[hosted] ${name} code=${store}: a deleted account past its 365 days couldn't be forgotten this pass (r2: the bucket didn't answer; leftover: something of its store is still in the bucket; forget: its rows didn't go). It waits and is tried again\n`;
  if (name === "retention.waiting") return `[hosted] ${name} n=${store}: deleted accounts past their 365 days are waiting to be forgotten (uploads not proven landing yet, or the bucket not clean). A stale-uploads line is the thing to fix\n`;
  if (name === "backup.ensure.failed") return `[hosted] ${name} storeTag=${store}: this store is NOT backed up yet (its key or its place in litestream.yml failed; the audit has it). The next restart retries it, and gives it a key if the bucket holds nothing of it\n`;
  if (name === "removal.overdue") return `[hosted] ${name} storeTag=${store}: a memory deleted in chat is overdue: more than 48 h past its erase, or claimed by an erase that didn't finish (it keeps failing, or the timer never reached it). It stays hidden; the audit has removal.failed. Said once per hold\n`;
  if (name === "delete.mail.failed") return `[hosted] ${name} storeTag=${store}: a delete's email (R9) didn't send. The delete stands; the person saw its page. The audit has it\n`;
  if (name === "backup.key.minted") return `[hosted] ${name} storeTag=${store}: this store served with no backup key, here or in the bucket, and the bucket holds nothing of it. It has a key now; backed up once this start is serving\n`;
  if (name.startsWith("backup.keyless.")) {
    const reason = name.slice("backup.keyless.".length) as KeylessReason;
    return `[hosted] backup.keyless storeTag=${store} reason=${reason}: this store is NOT backed up, and no key was made: ${KEYLESS_WORDS[reason]}\n`;
  }
  return `[hosted] ${name} store=${store}\n`;
}

/**
 * The upload watch's log line (G3; `backup.ts#UploadWatch`), codes and minutes
 * only, one fixed shape for monitoring to match on `backup.uploads.stale`:
 *
 *   [hosted] backup.uploads.stale minutes=40 reason=no-rise
 *   [hosted] backup.uploads.ok after=50
 */
export function uploadsLine(e: UploadsEvent): string {
  return e.state === "stale" ? `[hosted] backup.uploads.stale minutes=${String(e.minutes)} reason=${e.reason}\n` : `[hosted] backup.uploads.ok after=${String(e.minutes)}\n`;
}

/** What each `backup.keyless` reason says to the operator (docs/hosted/RUNBOOK.md, If a start refuses). */
const KEYLESS_WORDS: Record<KeylessReason, string> = {
  "no-database": "its database isn't on this volume. It waits for a restore (RESTORE_ON_BOOT=1), or for start-over if it never reached the bucket",
  "replica-in-bucket": "the bucket holds backup objects of it under a key that is gone, and a new key would bury them. Tell the coordinator",
  tombstone: "the bucket has its tombstone: it was deleted, and the delete is finished at a start",
  "bucket-unproven": "the bucket had no control key before this start (NEW_BUCKET said it is new on purpose), so it isn't proven to be this volume's. If R2_BUCKET or R2_ENDPOINT is wrong after all, fix it before anything else; if it is right, the next start checks again (this start put the control key there)",
  "keys-newer": "this volume's keys (keys/keys.sqlite) were made after the store was first opened, so an older key of it may exist. Tell the coordinator",
  "bucket-unreadable": "the bucket didn't answer one of the checks. The next restart tries again",
  locked: "its account is set to be deleted (a pending delete), and a store set to be erased is never given a new key. It is erased at its deadline; if its person keeps it, the next start checks it like any store that lived with no key",
  sealed: "its key isn't on this volume (keys/keys.sqlite lost?), and the bucket has it sealed to the recovery key, which the server never holds. Stop the server and run recover-keys with the recovery private key (docs/hosted/RUNBOOK.md, Restore)",
};

/** CONTROL_ASIDE's label: what goes into the aside dir's and the guard's names. */
export const CONTROL_ASIDE_LABEL = /^[A-Za-z0-9_-]{1,32}$/;

/** Where a used CONTROL_ASIDE label is remembered: a dir the start-up sweep (`app.ts#sweepAside`) never lists. */
export const overrideGuard = (dataRoot: string, label: string): string => join(dataRoot, "overrides", `control-aside-${label}.used`);

/**
 * CONTROL_ASIDE=<label> (R3; the #653 final check's LOW): `serve` moves
 * `control/` to `control.aside-<label>` before anything opens it, so a
 * RESTORE_ON_BOOT start restores the bucket's control databases in its place.
 * The RUNBOOK's recovery for "…but not the key that wrote the bucket's backups".
 *
 * ONLY ON A VOLUME IN THAT STATE (the #655 review): the bucket has the control
 * key, this volume doesn't, and it holds a control database
 * (`foreignControlRefusal`). On any other volume `control/` may be the only
 * copy of every account (a bucket with no control backups has nothing to put
 * in its place, and the sweep deletes the aside a day later), so nothing moves
 * and no guard is written; the start goes on. A bucket that can't be read
 * throws: the start doesn't happen, and nothing moved.
 *
 * AT MOST ONCE PER LABEL, until a human sets a new one. The guard
 * (`overrides/control-aside-<label>.used`) is created exclusively as
 * `claimed <time>` BEFORE the move and rewritten `moved <time>` after it;
 * nothing ever deletes it (not the day-old sweep, which deletes the aside copy
 * itself, so a guard that was the copy's existence re-armed a forgotten
 * override a day later; not a crash-restart). A crash between the claim and
 * the move leaves `control/` where it was, the label used, and says so.
 * Re-arm on purpose with a new label.
 */
export async function controlAsideAtStart(dataRoot: string, label: string, backup: AppBackupOptions, now: number = Date.now()): Promise<{ line: string } | { refusal: string }> {
  if (!CONTROL_ASIDE_LABEL.test(label)) return { refusal: "refused: CONTROL_ASIDE must be a label of letters, digits, - and _ (at most 32), e.g. CONTROL_ASIDE=1." };
  const used = guardState(dataRoot, label);
  if (used !== null) return { line: used };
  if (foreignControlRefusal(dataRoot, await controlVolume(dataRoot, backup)) === null) {
    return { line: `CONTROL_ASIDE=${label}: this volume isn't refusing for the control key (or the bucket has no control backups to restore in its place): nothing moved. Unset CONTROL_ASIDE.` };
  }
  return controlAside(dataRoot, label, now);
}

/** What a guard already there says, or null for a label never used. */
function guardState(dataRoot: string, label: string): string | null {
  const guard = overrideGuard(dataRoot, label);
  if (!existsSync(guard)) return null;
  const claimedOnly = readFileSync(guard, "utf8").startsWith("claimed") && !existsSync(join(dataRoot, `control.aside-${label}`));
  return claimedOnly
    ? `CONTROL_ASIDE=${label} was claimed but the move didn't finish: nothing moved. Set a new label (CONTROL_ASIDE=<new label>) to try again.`
    : `CONTROL_ASIDE=${label} was used once already: nothing moved. Unset CONTROL_ASIDE (or set a new label to move control/ aside again).`;
}

/** The move itself, once the volume's state is checked (`controlAsideAtStart`). */
export function controlAside(dataRoot: string, label: string, now: number = Date.now()): { line: string } | { refusal: string } {
  if (!CONTROL_ASIDE_LABEL.test(label)) return { refusal: "refused: CONTROL_ASIDE must be a label of letters, digits, - and _ (at most 32), e.g. CONTROL_ASIDE=1." };
  const used = guardState(dataRoot, label);
  if (used !== null) return { line: used };
  const control = join(dataRoot, "control");
  const aside = join(dataRoot, `control.aside-${label}`);
  if (!existsSync(control)) return { line: `CONTROL_ASIDE=${label}: there is no control/ to move: nothing moved. Unset CONTROL_ASIDE.` };
  if (existsSync(aside)) return { line: `CONTROL_ASIDE=${label}: control.aside-${label} is already here, so nothing moved. Set a new label to move control/ aside.` };
  const guard = overrideGuard(dataRoot, label);
  mkdirSync(join(dataRoot, "overrides"), { recursive: true });
  try {
    writeFileSync(guard, `claimed ${new Date(now).toISOString()}\n`, { flag: "wx" });
  } catch (err) {
    // Only a guard already there means "used"; anything else (EACCES, ENOSPC) stops the start, saying so.
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return { line: guardState(dataRoot, label)! };
  }
  renameSync(control, aside);
  writeFileSync(guard, `moved ${new Date(now).toISOString()}\n`);
  return { line: `CONTROL_ASIDE=${label}: moved control/ to control.aside-${label} (deleted a day from now). Unset CONTROL_ASIDE now; it won't move anything again under this label.` };
}

/** What `prepareVolume` found: a refusal, or the start goes on (with what it restored, and a line to log). */
export interface Prepared {
  readonly refusal?: string;
  readonly restored?: string;
  /** A line for the log: NEW_BUCKET was used, or is set and changed nothing. */
  readonly note?: string;
  /**
   * NEW_BUCKET was used to turn backups on for a volume that ran with
   * `BACKUPS=off` (or to finish such a start that was cut short): `serve`
   * passes it to `app.start`, which records `backups-turned-on` in
   * `keys.sqlite` before anything else (`Backups#mintRefusal` reads it).
   */
  readonly firstBackup?: boolean;
}

/**
 * NEW_BUCKET's value for the bucket this server is pointed at (R7; the #661
 * review): R2_ENDPOINT's host, a slash, R2_BUCKET. Bound to both, so a variable
 * left set never vouches for another bucket, by name or by account.
 */
export function newBucketValue(backup: AppBackupOptions): string {
  return `${new URL(backup.endpoint).host}/${backup.bucket}`;
}

/** Any store's key file on this volume (`tenants/<id>/litestream.key`): a store was given a backup key here. */
function storeKeyFiles(dataRoot: string): boolean {
  const root = join(dataRoot, "tenants");
  if (!existsSync(root)) return false;
  return readdirSync(root).some((id) => STORE_ID.test(id) && existsSync(join(root, id, "litestream.key")));
}

/** Anything on this volume that says it has been backed up (the M2 refusal of BACKUPS=off; R7's T3). */
export function backupTraces(dataRoot: string): boolean {
  return existsSync(join(dataRoot, "keys", "keys.sqlite")) || existsSync(join(dataRoot, "control", "litestream.key")) || storeKeyFiles(dataRoot);
}

/**
 * Did this volume LIVE: is there anyone or anything a start against the wrong
 * bucket could lose (R7; the #661 review's HIGH 2)? A person or a store in the
 * accounts database (any state: a deleted one leaves its row), or a store's dir.
 * A deleted account FORGOTTEN after 365 days (AR1, CONTRACT §31c) leaves no row,
 * so a volume whose only people were forgotten reads as never lived. Harmless:
 * the question is what a wrong-bucket start could lose, and a forgotten account
 * has nothing left to lose (no store, no key, nothing in the bucket: the pass
 * proved that before it forgot).
 * Not a control key, a key file or an invite alone: a first start cut short
 * leaves those, with nothing to lose. An accounts database that can't be read
 * is its own case ("unreadable", the #661 re-check's A3): never new, never
 * NEW_BUCKET.
 */
function volumeLived(dataRoot: string): "no" | "yes" | "unreadable" {
  const path = join(dataRoot, "control", "accounts.sqlite");
  let people = 0;
  if (existsSync(path)) {
    try {
      const db = openDb(path, { wal: true });
      try {
        people = db.get<{ n: number }>("SELECT (SELECT COUNT(*) FROM people) + (SELECT COUNT(*) FROM stores) AS n")?.n ?? 0;
      } finally {
        db.close();
      }
    } catch {
      return "unreadable";
    }
  }
  const root = join(dataRoot, "tenants");
  return people > 0 || (existsSync(root) && readdirSync(root).some((id) => STORE_ID.test(id))) ? "yes" : "no";
}

/** `keys.sqlite`'s backup facts (R7), read only when the file is here. */
function volumeFacts(dataRoot: string, backup: AppBackupOptions): { turnedOn: boolean; controlInBucket: boolean } {
  const path = join(dataRoot, "keys", "keys.sqlite");
  if (!existsSync(path)) return { turnedOn: false, controlInBucket: false };
  const keys = new KeyStore({ path, wrapper: backup.wrapper });
  try {
    return { turnedOn: keys.fact("backups-turned-on") !== null, controlInBucket: keys.fact("control-key-in-bucket") !== null };
  } finally {
    keys.close();
  }
}

/**
 * BEFORE ANYTHING OPENS A CONTROL DATABASE (`serve`, `invite`, `rewrap`,
 * `start-over`; `restore` asks `emptyBucketGate`): is this volume the one that
 * wrote the bucket's backups? (The #OL2b review, H2; R7.)
 *
 *   - The bucket has no `keys/control.wrapped`: a volume with nothing to lose
 *     (no person, no store) starts as a new server. One that LIVED is refused
 *     unless NEW_BUCKET names this bucket (`emptyBucket`): otherwise the start
 *     would make the volume a control key in that bucket and back the control
 *     databases up there, and with a wrong R2_BUCKET every control write from
 *     then on goes to the wrong bucket.
 *   - This volume holds the control key too: it is the bucket's. A control
 *     database missing from it (a control restore cut short) is restored alone
 *     with a runner, refused without one. Never made empty: an empty one would
 *     be replicated over the real one.
 *   - The bucket has the key and this volume doesn't: the volume lost its data
 *     (or is new). With no control database here, restore them (a runner) or
 *     refuse, saying how. With one here (made by an `invite`, a `BACKUPS=off`
 *     run, …), always refuse: it isn't the real one, and it would replace it.
 */
export async function prepareVolume(dataRoot: string, backup: AppBackupOptions, run: LitestreamRun | null, opts: { newBucket?: string | undefined } = {}): Promise<Prepared> {
  const v = await controlVolume(dataRoot, backup);
  const newBucket = opts.newBucket === undefined || opts.newBucket === "" ? undefined : opts.newBucket;
  if (!v.bucketKey) return emptyBucket(dataRoot, backup, v, newBucket);
  const unused = newBucket === undefined ? {} : { note: "NEW_BUCKET is set, but the bucket already has the control key: it changed nothing. Unset NEW_BUCKET." };
  if (v.localKey && v.present.length === CONTROL_DATABASES.length) return unused;
  const foreign = foreignControlRefusal(dataRoot, v);
  if (foreign !== null) return { refusal: foreign };
  if (run === null) {
    return {
      refusal: v.localKey
        ? `refused: ${String(CONTROL_DATABASES.length - v.present.length)} of the control databases are missing from this volume, and the bucket has their backups. Set RESTORE_ON_BOOT=1 and deploy again to restore them (docs/hosted/RUNBOOK.md, Restore).`
        : "refused: this volume has no accounts database, but the bucket has backups. Set RESTORE_ON_BOOT=1 and deploy again to restore them (docs/hosted/RUNBOOK.md, Restore), or point R2_BUCKET at an empty bucket for a new server.",
    };
  }
  const r = await restoreControl(dataRoot, backup, run, { missingOnly: true });
  if (r.restored + r.kept < CONTROL_DATABASES.length) return { refusal: `refused: the bucket's key object is there, but ${String(r.empty)} control databases have no replica to restore from. Nothing was started.` };
  return { restored: `${String(r.restored)} restored, ${String(r.kept)} already here`, ...unused };
}

/** R7's check alone, for `restore` (whose own control rules are `restoreControl`'s): {} when the bucket has the control key. */
export async function emptyBucketGate(dataRoot: string, backup: AppBackupOptions, newBucket: string | undefined): Promise<Prepared> {
  const v = await controlVolume(dataRoot, backup);
  return v.bucketKey ? {} : emptyBucket(dataRoot, backup, v, newBucket === "" ? undefined : newBucket);
}

/**
 * A BUCKET WITH NO CONTROL KEY (R7). The case is read from what the volume
 * holds, in this order:
 *
 *   - nothing to lose (`volumeLived`): a new server, whatever keys a first
 *     start cut short left (a GET or PUT that failed, an invite made first);
 *   - `backups-turned-on` without `control-key-in-bucket`: a NEW_BUCKET start
 *     turning backups on was cut short. NEW_BUCKET again finishes it;
 *   - the control key here: backed up to some bucket, so R2_BUCKET (or
 *     R2_ENDPOINT) is most likely wrong. NEW_BUCKET moves it, on purpose;
 *   - a key file (`control/` or a store's) but no control key: backed up, and
 *     `keys.sqlite` lost. NEW_BUCKET never counts here: the stores' keys are
 *     in the old bucket, and a new one could only hold them keyless;
 *   - none of those: it ran with BACKUPS=off. NEW_BUCKET turns backups on.
 *
 * NEW_BUCKET counts only as `newBucketValue` (endpoint host and bucket).
 */
function emptyBucket(dataRoot: string, backup: AppBackupOptions, v: ControlVolume, newBucket: string | undefined): Prepared {
  const value = newBucketValue(backup);
  const unset = " Unset NEW_BUCKET once it is serving.";
  const lived = volumeLived(dataRoot);
  if (lived === "no") {
    return newBucket === undefined ? {} : { note: "NEW_BUCKET is set, but this volume has no person and no store yet, so it starts as a new server without it: it changed nothing. Unset NEW_BUCKET." };
  }
  if (lived === "unreadable") {
    // Never NEW_BUCKET here: the start would only fail opening it (the #661 re-check, A3).
    return { refusal: `refused: control/accounts.sqlite is on this volume but isn't a database this server can read (a damaged file, or one copied in by hand), and the bucket R2_ENDPOINT and R2_BUCKET name ("${newBucketValue(backup)}") has no control key. Nothing was made or put. Point R2_BUCKET and R2_ENDPOINT at the bucket that has this volume's backups and deploy once with CONTROL_ASIDE=<new label> and RESTORE_ON_BOOT=1, or tell the coordinator (docs/hosted/RUNBOOK.md, If a start refuses).` };
  }
  const vouched = newBucket === value;
  const mismatch = newBucket === undefined || vouched ? "" : ` (NEW_BUCKET is set, but not to "${value}", so it doesn't count.)`;
  const optIn = `set NEW_BUCKET=${value} (R2_ENDPOINT's host and R2_BUCKET) for one deploy, then unset it`;
  const where = `the bucket R2_ENDPOINT and R2_BUCKET name ("${value}")`;
  const runbook = " (docs/hosted/RUNBOOK.md, If a start refuses).";
  const facts = volumeFacts(dataRoot, backup);
  if (facts.turnedOn && !facts.controlInBucket) {
    if (vouched) return { note: `NEW_BUCKET=${value}: finishing a start that turned backups on and was cut short before this volume's control key reached the bucket.${unset}`, firstBackup: true };
    return { refusal: `refused: a start that turned backups on (NEW_BUCKET) was cut short before this volume's control key reached the bucket, and ${where} has no control key. If that is the bucket you are turning backups on into, ${optIn}; if R2_BUCKET or R2_ENDPOINT changed since, fix it${runbook}${mismatch}` };
  }
  if (v.localKey) {
    if (vouched) return { note: `NEW_BUCKET=${value}: this volume was backed up to another bucket, and starts on this one, which has no control key, on purpose. Its control key, its databases and its stores' keys are backed up here from this start.${unset}` };
    return { refusal: `refused: this volume has been backed up (its control key is in keys/keys.sqlite), but ${where} has no control key: R2_BUCKET or R2_ENDPOINT is most likely wrong. Fix it and deploy again. Only if this is a new, empty bucket on purpose (a move to a new bucket), ${optIn}${runbook}${mismatch}` };
  }
  if (existsSync(join(dataRoot, "control", "litestream.key")) || storeKeyFiles(dataRoot)) {
    // Never a NEW_BUCKET here (the #661 review): the stores' keys went with keys.sqlite and are in the old bucket only.
    return { refusal: `refused: this volume has been backed up (a backup key file is here) but has lost keys/keys.sqlite, and ${where} has no control key: R2_BUCKET or R2_ENDPOINT is most likely wrong. Fix it and deploy again; the right bucket then needs recover-keys with the recovery private key (with --control-aside <new label> when control databases are here), then RESTORE_ON_BOOT=1, which bring the keys and databases back. A new bucket can't take this volume: its stores' keys are only in the old one. If the old bucket is gone, tell the coordinator${runbook}` };
  }
  if (vouched) return { note: `NEW_BUCKET=${value}: this volume ran without backups (BACKUPS=off) and starts on this bucket, which has no control key, on purpose. Its control databases and every store are backed up here from this start.${unset}`, firstBackup: true };
  return { refusal: `refused: this volume has people or stores but has never been backed up: it ran with BACKUPS=off. ${where[0]!.toUpperCase()}${where.slice(1)} has no control key. To turn backups on into this bucket, ${optIn}; this start then backs up the control databases and every store. If R2_BUCKET or R2_ENDPOINT is wrong, fix it instead${runbook}${mismatch}` };
}

/** The M2 refusal (the #653 review; store key files counted since the #661 review). */
const BACKUPS_OFF_REFUSAL = "refused: BACKUPS=off on a volume that has been backed up (keys/keys.sqlite, control/litestream.key or a store's litestream.key is here). Name the bucket instead.";

/**
 * A secret for a command (WB1: the recovery private key): from `--key-file
 * <path>`, or stdin. On a terminal it is read with the echo off, so a pasted key
 * never shows; piped, the whole of stdin. Never from the environment, never
 * printed or logged.
 */
async function readSecret(args: readonly string[], what: string): Promise<string> {
  if (args.includes("--key-file")) {
    const path = args[args.indexOf("--key-file") + 1];
    if (path === undefined || path.startsWith("--")) throw new Error("--key-file needs a path");
    return readFileSync(path, "utf8");
  }
  const stdin = process.stdin;
  // Piped: read fd 0 to its end, synchronously (a stream already ended before
  // anything listened would leave nothing to keep the process alive under bun).
  if (stdin.isTTY !== true) return readFileSync(0, "utf8");
  process.stderr.write(`${what} (paste it, then Enter; it isn't shown): `);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((done, fail) => {
    let text = "";
    const onData = (d: Buffer | string): void => {
      for (const ch of d.toString("utf8")) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write("\n");
          done(text);
          return;
        }
        if (ch === "\u0003") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write("\n");
          fail(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * `hold` (WB1): a start-command override for a stopped server. It opens nothing
 * on the volume and reads no key: it answers `/readyz` (so the platform keeps
 * the container, and `railway ssh` reaches it for `recover-keys`) and `503` to
 * everything else, until it is stopped.
 */
async function hold(env: Record<string, string | undefined>): Promise<void> {
  const port = Number(env["PORT"] ?? "8080");
  const server = createServer((req, res) => {
    // /readyz for Railway's healthcheck, /healthz for the image's own (Dockerfile HEALTHCHECK).
    const path = (req.url ?? "").split("?")[0];
    if (path === "/readyz" || path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(`${JSON.stringify({ ready: true, holding: true })}\n`);
      return;
    }
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "300" }).end("Down for maintenance. Back soon.\n");
  });
  await new Promise<void>((r) => server.listen(port, "0.0.0.0", () => r()));
  process.stderr.write(`[hosted] holding on port ${String(port)}: nothing is served and nothing on the volume is open. Clear the start-command override to serve again.\n`);
  await new Promise<void>((resolveStop) => {
    process.once("SIGINT", () => resolveStop());
    process.once("SIGTERM", () => resolveStop());
  });
  await new Promise<void>((r) => server.close(() => r()));
}

/** The commands that need no volume, no bucket and no environment but their arguments (WB1's recovery key; `hold`). */
async function keyCommand(command: string, rest: readonly string[], env: Record<string, string | undefined>): Promise<boolean> {
  if (command === "recovery-keygen") {
    // To the terminal only, no file (the #768 delta review: `rm -P` does nothing on APFS, and a Desktop is often
    // synced and backed up). Shown once; nothing keeps it.
    if (rest.length > 0) throw new Error("recovery-keygen takes no argument: it prints the new private key to this terminal once and writes no file");
    const k = generateRecoveryKey();
    process.stdout.write(
      [
        `HOSTED_RECOVERY_PUBKEY=${k.publicText}`,
        `fingerprint ${k.fingerprint}`,
        "",
        "The PRIVATE key, shown this once and saved nowhere. Copy the line below to the password manager and to paper now,",
        "check each copy with `recovery-fingerprint` (it must print the fingerprint above), write the fingerprint beside",
        "both, then clear this terminal. It never goes into Railway, a chat, a commit or a log.",
        "",
        k.privateText,
        "",
      ].join("\n"),
    );
    return true;
  }
  if (command === "recovery-fingerprint") {
    const opener = recoveryOpenerFromText(await readSecret(rest, "recovery private key"));
    if ("refusal" in opener) {
      process.stderr.write(`[hosted] refused: ${opener.refusal}\n`);
      process.exitCode = 1;
      return true;
    }
    process.stdout.write(`fingerprint ${opener.fingerprint}\n`);
    const sealer = recoverySealerFromEnv(env);
    if (!("refusal" in sealer)) process.stdout.write(sealer.fingerprint === opener.fingerprint ? "it is the key HOSTED_RECOVERY_PUBKEY names\n" : `NOT the key HOSTED_RECOVERY_PUBKEY names (${sealer.fingerprint})\n`);
    return true;
  }
  if (command === "hold") {
    await hold(env);
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const [command = "serve", ...rest] = process.argv.slice(2);
  if (await keyCommand(command, rest, env)) return;
  const read = readEnv(env, command);
  if (!read.ok) {
    process.stderr.write(`[hosted] ${read.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "signups") {
    // Before the backup checks on purpose: it reads one file, and needs no key
    // and no bucket. Nothing below this line runs for it (signups.ts).
    const out = signupsCommand(join(read.dataRoot, "control", "accounts.sqlite"));
    if ("refusal" in out) {
      process.stderr.write(`[hosted] ${out.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${out.text}\n`);
    return;
  }
  if (command === "invite" || command === "spots" || command === "migrate-keys" || command === "start-over" || command === "reviewer") {
    // None may make a control database on a volume that isn't the bucket's
    // (prepareVolume); `invite` needs the backups named or BACKUPS=off said
    // (the #653 review, L6), so it can never skip that check by accident.
    const configured = backupFromEnv(env, read.dataRoot);
    // BACKUPS=off on a volume backed up (M2), for these commands too (the #661 review).
    if (configured === null && backupTraces(read.dataRoot)) {
      process.stderr.write(`[hosted] ${BACKUPS_OFF_REFUSAL}\n`);
      process.exitCode = 1;
      return;
    }
    if (configured !== null && "refusal" in configured) {
      process.stderr.write(`[hosted] ${configured.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    if (configured !== null) {
      const prepared = await prepareVolume(read.dataRoot, configured, null, { newBucket: env["NEW_BUCKET"] });
      if (prepared.refusal !== undefined) {
        process.stderr.write(`[hosted] ${prepared.refusal}\n`);
        process.exitCode = 1;
        return;
      }
      if (prepared.note !== undefined) process.stderr.write(`[hosted] ${prepared.note}\n`);
    }
    if (command === "start-over") {
      if (configured === null) {
        process.stderr.write("[hosted] refused: start-over needs the bucket (not BACKUPS=off).\n");
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${await startOverCommand(read.dataRoot, configured, rest[0])}\n`);
      return;
    }
  }
  if (command === "spots") {
    // SU1: N is accounts in all, every person counted (invited ones and the
    // operator's own too), so `spots set 10` with 4 accounts opens 6. Lowering
    // it removes nobody. A bad N is refused, never read as a default.
    // EC1: `spots emails M` sets the hourly email cap while open, a sibling of
    // `set N` so either changes without restating the other.
    let set: number | null = null;
    let emails: number | null = null;
    if (rest.length > 0) {
      const n = Number(rest[1]);
      const max = rest[0] === "emails" ? MAX_EMAILS_PER_HOUR : MAX_SPOTS;
      if ((rest[0] !== "set" && rest[0] !== "emails") || rest.length !== 2 || !/^\d+$/.test(rest[1] ?? "") || !Number.isInteger(n) || n > max) {
        process.stderr.write(
          `[hosted] refused: spots takes nothing (show), \`set N\` (N a whole number from 0 to ${String(MAX_SPOTS)}) or \`emails M\` (M a whole number from 0 to ${String(MAX_EMAILS_PER_HOUR)}).\n`,
        );
        process.exitCode = 1;
        return;
      }
      if (rest[0] === "set") set = n;
      else emails = n;
    }
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    if (set !== null) accounts.setSpots(set);
    if (emails !== null) accounts.setEmailsPerHour(emails);
    const s = accounts.spots();
    const cap = accounts.emailCap();
    accounts.close();
    process.stdout.write(
      `spots: ${String(s.total)} (accounts in all)\npeople: ${String(s.people)} (accounts that exist now)\nleft: ${String(s.left)} (${s.left > 0 ? "open: a new address signs up with just its email" : "closed: only an invite code signs up"})\n` +
        `emails: ${String(cap.perHour)} an hour while open (${String(cap.thisHour)} this hour${cap.reached && s.left > 0 ? ": reached, new addresses wait for the next hour" : ""})\n`,
    );
    return;
  }
  if (command === "reviewer") {
    // DIR1 (2026-11-10): the directory reviewer's test account. `reviewer <email> [--days N] [--tz Zone]`
    // makes a NEW account at an address the operator controls (refused for one that has an account),
    // whose store fills with the sample at its first open (`sample.ts`), and prints its sign-in code
    // once: typed beside that email under "Have an invite code?" on /login, it signs in with no email.
    // `reviewer revoke <email>` ends every code and web session of that account.
    if (rest[0] === "revoke") {
      const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
      const { revoked: n, personId } = accounts.revokeReviewer(rest[1]);
      accounts.close();
      if (personId === null) {
        process.stderr.write("[hosted] refused: no reviewer account has that email (revoke never touches a member's account).\n");
        process.exitCode = 1;
        return;
      }
      // Its connections too: every grant ends, so a token made with the code is refused at its next call.
      const oidc = new OidcStore(join(read.dataRoot, "control", "oauth.sqlite"));
      oidc.revokeAccount(personId);
      oidc.close();
      process.stdout.write(`${String(n)} reviewer code${n === 1 ? "" : "s"} revoked; its web sessions and connected apps ended\n`);
      return;
    }
    const email = rest[0];
    const days = rest.includes("--days") ? Number(rest[rest.indexOf("--days") + 1]) : REVIEWER_DEFAULT_DAYS;
    const tz = rest.includes("--tz") ? rest[rest.indexOf("--tz") + 1] : undefined;
    if (email === undefined || email.startsWith("--")) {
      process.stderr.write("[hosted] refused: reviewer takes the account's email first (an address you control: delete emails go to it), then optionally --days N (1 to 365, default 90) and --tz <IANA zone>; or `reviewer revoke <email>`.\n");
      process.exitCode = 1;
      return;
    }
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    const made = accounts.createReviewer({ email, days, ...(tz === undefined ? {} : { timeZone: tz }) });
    accounts.close();
    if ("refusal" in made) {
      process.stderr.write(`[hosted] refused: ${made.refusal}.\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${made.code}\n`);
    process.stderr.write(`[hosted] reviewer account made for ${email}: sign in at /login with that email and this code (under "Have an invite code?"). The code expires ${new Date(made.expiresAt).toISOString()}; its memory fills with the sample at the first connection.\n`);
    return;
  }
  if (command === "invite") {
    const uses = Number(rest[rest.indexOf("--uses") + 1] ?? "1");
    const note = rest.includes("--note") ? rest[rest.indexOf("--note") + 1] : undefined;
    // --expires <days> (G1 L4): whole days, 1 to 365; without it, 7. A bad value is refused
    // rather than read as the default, so a typo never makes a code live longer than meant.
    let expiresAt: number | undefined;
    if (rest.includes("--expires")) {
      const days = Number(rest[rest.indexOf("--expires") + 1]);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        process.stderr.write("[hosted] refused: --expires takes whole days, 1 to 365 (the default is 7).\n");
        process.exitCode = 1;
        return;
      }
      expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    }
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    const { code, expiresAt: until } = accounts.createInvite({
      maxUses: rest.includes("--uses") && Number.isInteger(uses) && uses > 0 ? uses : 1,
      ...(note === undefined ? {} : { note }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
    accounts.close();
    process.stdout.write(`${code}\n`);
    process.stderr.write(`[hosted] the code expires ${new Date(until).toISOString()}\n`);
    return;
  }
  if (command !== "serve" && command !== "migrate-keys" && command !== "recover-keys" && command !== "restore") {
    process.stderr.write(`[hosted] commands: serve, invite, reviewer, spots, signups, restore, start-over, migrate-keys, recover-keys, recovery-keygen, recovery-fingerprint, hold${command === "rewrap" ? " (rewrap is gone since WB1: the KEK is on the volume, and migrate-keys moves the keys from ${KEK_ENV} onto it)" : ""}\n`);
    process.exitCode = 1;
    return;
  }
  const backup = backupFromEnv(env, read.dataRoot);
  // BACKUPS=off ON A VOLUME THAT WAS BACKED UP (the #653 review, M2): a delete
  // then would leave its key object and replica in the bucket for good, and
  // nothing would know to remove them. Off is for a volume that never had them.
  if (backup === null && backupTraces(read.dataRoot)) {
    process.stderr.write(`[hosted] ${BACKUPS_OFF_REFUSAL}\n`);
    process.exitCode = 1;
    return;
  }
  if (backup !== null && "refusal" in backup) {
    process.stderr.write(`[hosted] ${backup.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "migrate-keys") {
    // WB1: the keys from HOSTED_KEKS onto the volume KEK, the bucket's key
    // objects sealed to the recovery key, the old ones deleted (keyops.ts).
    // Server stopped. Idempotent; --dry-run writes nothing.
    if (backup === null) {
      process.stderr.write("[hosted] refused: migrate-keys needs the keys and the bucket (not BACKUPS=off).\n");
      process.exitCode = 1;
      return;
    }
    // The control re-key runs a Litestream of its own, on the same binary and environment as the sidecar.
    const litestream = { run: restoreRunner(env), sidecar: (configPath: string) => new LitestreamSidecar({ binary: litestreamBinary(env), configPath, env: litestreamEnv(env, env["R2_ACCESS_KEY_ID"] ?? "", env["R2_SECRET_ACCESS_KEY"] ?? ""), onEvent: (name) => process.stderr.write(`[hosted] re-key ${name}\n`) }) };
    const fpAt = rest.indexOf("--recovery-fingerprint");
    const recoveryFingerprint = fpAt < 0 ? undefined : rest[fpAt + 1];
    const out = await migrateKeys(read.dataRoot, backup, { dryRun: rest.includes("--dry-run"), abortControlRekey: rest.includes("--abort-control-rekey"), litestream, ...(recoveryFingerprint === undefined ? {} : { recoveryFingerprint }) });
    process.stdout.write(`${out.text}\n`);
    if (out.left > 0) process.exitCode = 1;
    return;
  }
  if (command === "recover-keys") {
    // WB1: after a volume is lost, the bucket's sealed keys opened with the
    // private key (stdin or --key-file, never the environment), wrapped here.
    // Server stopped (`hold`, on Railway). Then RESTORE_ON_BOOT=1.
    if (backup === null) {
      process.stderr.write("[hosted] refused: recover-keys needs the bucket (not BACKUPS=off).\n");
      process.exitCode = 1;
      return;
    }
    const dryRun = rest.includes("--dry-run");
    const gate = await emptyBucketGate(read.dataRoot, backup, env["NEW_BUCKET"]);
    if (gate.refusal !== undefined) {
      process.stderr.write(`[hosted] ${gate.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    // Control databases here without the control key aren't the bucket's: the
    // key is never adopted beside them (the #653 review, H1). --control-aside
    // moves them aside first, once per label, as CONTROL_ASIDE does at a start.
    const foreign = foreignControlRefusal(read.dataRoot, await controlVolume(read.dataRoot, backup));
    const label = rest.includes("--control-aside") ? rest[rest.indexOf("--control-aside") + 1] : undefined;
    if (foreign !== null && !dryRun) {
      if (label === undefined) {
        process.stderr.write(`[hosted] ${foreign}\n`);
        process.exitCode = 1;
        return;
      }
      const moved = controlAside(read.dataRoot, label);
      if ("refusal" in moved) {
        process.stderr.write(`[hosted] ${moved.refusal.replace("CONTROL_ASIDE", "--control-aside")}\n`);
        process.exitCode = 1;
        return;
      }
      process.stderr.write(`[hosted] ${moved.line.replace(/ Unset CONTROL_ASIDE now; it won't/, " It won't").replace(/^CONTROL_ASIDE=/, "--control-aside ")}\n`);
    }
    const text = await readSecret(rest, "recovery private key");
    const opener = recoveryOpenerFromText(text);
    if ("refusal" in opener) {
      process.stderr.write(`[hosted] refused: ${opener.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    const out = await recoverKeys(read.dataRoot, backup, opener, { dryRun, adoptUnproven: rest.includes("--adopt-unproven") });
    process.stdout.write(`${out.text}\n`);
    if (out.failed > 0) process.exitCode = 1;
    return;
  }
  if (command === "restore") {
    if (backup === null) {
      process.stderr.write("[hosted] refused: restore needs the keys and the bucket (not BACKUPS=off).\n");
      process.exitCode = 1;
      return;
    }
    // R7's check stands in front of restore too (the #661 review): a forced
    // restore beside a wrong, empty bucket would put the control key there.
    const gate = await emptyBucketGate(read.dataRoot, backup, env["NEW_BUCKET"]);
    if (gate.refusal !== undefined) {
      process.stderr.write(`[hosted] ${gate.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    if (gate.note !== undefined) process.stderr.write(`[hosted] ${gate.note}\n`);
    const out = await restoreCommand(read.dataRoot, backup, restoreRunner(env), rest, openEmbedder(withEmbedderDefault({})));
    process.stdout.write(`${out.text}\n`);
    if (out.failed > 0) process.exitCode = 1;
    return;
  }
  // CONTROL_ASIDE: control/ moved aside once per label, before anything opens
  // it. Never with BACKUPS=off: the aside copy would be the only one, and the
  // sweep deletes it a day later.
  const asideLabel = env["CONTROL_ASIDE"];
  if (asideLabel !== undefined && asideLabel !== "") {
    if (backup === null) {
      process.stderr.write("[hosted] refused: CONTROL_ASIDE needs the bucket (not BACKUPS=off): the copy it sets aside would be the only one.\n");
      process.exitCode = 1;
      return;
    }
    const moved = await controlAsideAtStart(read.dataRoot, asideLabel, backup);
    if ("refusal" in moved) {
      process.stderr.write(`[hosted] ${moved.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`[hosted] ${moved.line}\n`);
  }
  // AN EMPTY VOLUME BESIDE A BUCKET THAT HAS BACKUPS: starting would make new,
  // empty control databases and replicate them over the real ones. So either
  // restore them first (RESTORE_ON_BOOT=1) or refuse, saying how. And (R7) a
  // volume that lived beside a bucket with NO control key: refused unless
  // NEW_BUCKET names the bucket.
  const restoreOnBoot = env["RESTORE_ON_BOOT"] === "1";
  let firstBackup = false;
  if (backup !== null) {
    const prepared = await prepareVolume(read.dataRoot, backup, restoreOnBoot ? restoreRunner(env) : null, { newBucket: env["NEW_BUCKET"] });
    if (prepared.refusal !== undefined) {
      process.stderr.write(`[hosted] ${prepared.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    if (prepared.restored !== undefined) process.stderr.write(`[hosted] restored the control databases: ${prepared.restored}\n`);
    if (prepared.note !== undefined) process.stderr.write(`[hosted] ${prepared.note}\n`);
    firstBackup = prepared.firstBackup === true;
  }
  const mailer = mailerFrom(env);
  if (typeof mailer === "string") {
    process.stderr.write(`[hosted] ${mailer}\n`);
    process.exitCode = 1;
    return;
  }
  // One embedder for every store (the static table, ~30 MB).
  const embedder = openEmbedder(withEmbedderDefault({}));
  const cookieKeys = env["COOKIE_KEYS"]?.split(",").map((k) => k.trim()).filter((k) => k.length >= 32);
  if (cookieKeys === undefined || cookieKeys.length === 0) process.stderr.write("[hosted] COOKIE_KEYS is not set (or no key in it is 32+ characters): the form keys are random per process, so open sign-in and account forms expire on every restart\n");
  const allowedOrigins = mcpAllowedOrigins(env["MCP_ALLOWED_ORIGINS"]);
  if ("refusal" in allowedOrigins) {
    process.stderr.write(`[hosted] ${allowedOrigins.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const app = createApp({
    dataRoot: read.dataRoot,
    publicOrigin: read.origin,
    mailer,
    trustProxy: read.trustProxy,
    embedder,
    ...(cookieKeys === undefined || cookieKeys.length === 0 ? {} : { cookieKeys }),
    ...(backup === null ? {} : { backup }),
    // DIR1: exact browser origins `/mcp` answers (MCP Inspector's web page while testing); unset: none.
    ...(allowedOrigins.length === 0 ? {} : { allowedOrigins }),
    onEvent: (name, store) => process.stderr.write(eventLine(name, store)),
    // Uploads not landing in R2 while the sidecar runs (G3): every look while stale, and once when they land again.
    onUploads: (e) => process.stderr.write(uploadsLine(e)),
    // Every /mcp message, ids and codes only (CONTRACT §6), and every error that became a 500 or an
    // "internal error", by type and code location, never its message (11-02: claude.ai got a 500 nothing logged).
    onCall: (r) => process.stderr.write(callLine(r)),
    onError: (where, store, err) => process.stderr.write(errorLine(where, store, err)),
    // First deploy only: the raw X-Forwarded-For of each /readyz request, to count the proxy's hops. Unset it after.
    ...(env["LOG_FORWARDED_FOR"] === "1" ? { logForwardedFor: (raw: string) => process.stderr.write(`[hosted] /readyz X-Forwarded-For: ${raw}\n`) } : {}),
  });
  const report = await app.start({ ...(restoreOnBoot && backup !== null ? { restore: restoreRunner(env) } : {}), ...(firstBackup ? { firstBackup: true } : {}) });
  if (report.restored > 0) process.stderr.write(`[hosted] RESTORE_ON_BOOT: ${String(report.restored)} store databases restored. Unset RESTORE_ON_BOOT now.\n`);
  if (report.restoreFailed > 0) process.stderr.write(`[hosted] RESTORE_ON_BOOT: ${String(report.restoreFailed)} store restores FAILED; those stores wait (the audit has them as store.restore.failed)\n`);
  if (report.minted > 0) process.stderr.write(`[hosted] ${String(report.minted)} stores that served with no key here or in the bucket were given one (backup.key.minted above)\n`);
  if (report.keyless > 0) process.stderr.write(`[hosted] ${String(report.keyless)} stores that lived have no key here or in the bucket: they are NOT backed up, and no new key was made (backup.keyless above says why, per store)\n`);
  if (report.tombstoned > 0) process.stderr.write(`[hosted] ${String(report.tombstoned)} accounts the bucket says were deleted came back with the control databases: their deletes were finished\n`);
  if (report.leftovers > 0) process.stderr.write(`[hosted] removed what ${String(report.leftovers)} deleted stores had left in the bucket\n`);
  if (report.asideSwept > 0) process.stderr.write(`[hosted] deleted ${String(report.asideSwept)} copies set aside more than a day ago (control.aside-*, *.pre-restore-*)\n`);
  if (report.needsRestore > 0) process.stderr.write(`[hosted] ${String(report.needsRestore)} stores have no files on this volume and wait for a restore (RESTORE_ON_BOOT=1)\n`);
  if (report.clientsSwept > 0) process.stderr.write(`[hosted] dropped ${String(report.clientsSwept)} registered OAuth clients never used\n`);
  if (backup !== null) process.stderr.write(`[hosted] backups: keys on this volume (keys/volume.kek); key objects sealed to recovery key ${backup.sealer.fingerprint}\n`);
  if (report.legacyKeys > 0) process.stderr.write(`[hosted] ${String(report.legacyKeys)} keys are still under ${KEK_ENV}: stop the server and run migrate-keys (docs/hosted/RUNBOOK.md, Write-only backups)\n`);
  // The stop signals are ours BEFORE anyone can be told "serving" (the #768 CI flake): a SIGTERM that lands
  // between the line and its listener would end the process by default, leaving its heartbeat behind.
  const stopped = new Promise<void>((resolveStop) => {
    process.once("SIGINT", () => resolveStop());
    process.once("SIGTERM", () => resolveStop());
  });
  await new Promise<void>((r) => app.server.listen(read.port, "0.0.0.0", () => r()));
  // The running server's mark (keyops.ts#SERVING_MARK): migrate-keys and recover-keys refuse beside it.
  const aliveMark = join(read.dataRoot, SERVING_MARK);
  const beat = (): void => {
    try {
      writeFileSync(aliveMark, `${new Date().toISOString()}\n`, { mode: 0o600 });
    } catch {
      /* a mark, not a gate */
    }
  };
  beat();
  const alive = setInterval(beat, SERVING_EVERY_MS);
  alive.unref?.();
  process.stderr.write(`[hosted] serving ${read.origin} on port ${String(read.port)}${backup === null ? " (BACKUPS=off)" : ""}\n`);
  await stopped;
  clearInterval(alive);
  rmSync(aliveMark, { force: true });
  await new Promise<void>((r) => app.server.close(() => r()));
  await app.close();
}

/**
 * Every write to `s` from here on, as one promise that settles once they have all left
 * the process (a write's own callback). Under bun a `process.exit` right after a write to
 * a pipe can drop it — migrate-keys' report went missing that way now and then in CI
 * (11-07), and a write of a megabyte is cut every time — and neither an empty write's
 * callback nor 'drain' waits for it there; the callback of the write itself does.
 */
function trackWrites(s: NodeJS.WriteStream): () => Promise<void> {
  // A count, not a chain: `serve` writes a line per call for its whole life, and a
  // chained promise per write would grow without end (review of #784).
  let pending = 0;
  let waiting: Array<() => void> = [];
  const settle = (): void => {
    pending -= 1;
    if (pending > 0) return;
    const ready = waiting;
    waiting = [];
    for (const r of ready) r();
  };
  const write = s.write.bind(s) as (...args: unknown[]) => boolean;
  s.write = ((...args: unknown[]): boolean => {
    const cb = typeof args.at(-1) === "function" ? (args.pop() as (err?: Error | null) => void) : undefined;
    pending += 1;
    try {
      return write(...args, (err?: Error | null) => {
        settle();
        cb?.(err);
      });
    } catch (e) {
      // A write that throws (a bad chunk) never calls back: count it settled, and let the caller see the throw.
      settle();
      throw e;
    }
  }) as typeof s.write;
  return () => (pending === 0 ? Promise.resolve() : new Promise<void>((r) => waiting.push(r)));
}

/** `process.exit`, once stdout and stderr have flushed (or after 5 s: a reader gone away never holds the exit). */
function exitFlushed(code: number, flushed: Array<() => Promise<void>>): void {
  const late = setTimeout(() => process.exit(code), 5000);
  void Promise.all(flushed.map((f) => f())).then(() => {
    clearTimeout(late);
    process.exit(code);
  });
}

/** Said when the event loop ran empty with the command still waiting: it never finished. */
export const STALLED = "stopped before it finished: the event loop ran out of work while the command was still waiting on something. What it did may be partial; run it again.";

/**
 * The entry point: `run`, then exit once stdout and stderr have flushed. A
 * command can never exit 0 without having finished: if the event loop runs
 * empty while `run` is still pending (something it awaited held nothing open),
 * the process says so and exits 1, never 0 with half the work done and no
 * report (the WB1 empty-stdout flake).
 */
export function runEntry(run: () => Promise<void>): void {
  const flushed = [trackWrites(process.stdout), trackWrites(process.stderr)];
  let settled = false;
  process.on("beforeExit", () => {
    if (settled) return;
    settled = true;
    process.stderr.write(`[hosted] ${STALLED}\n`);
    exitFlushed(1, flushed);
  });
  void run().then(
    () => {
      settled = true;
      exitFlushed(process.exitCode === 1 ? 1 : 0, flushed);
    },
    (err: unknown) => {
      settled = true;
      process.stderr.write(`[hosted] did not start: ${err instanceof Error ? err.message : String(err)}\n`);
      exitFlushed(1, flushed);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) runEntry(main);
