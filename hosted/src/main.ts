#!/usr/bin/env node
/**
 * THE HOSTED SERVER'S ENTRY POINT (OL2 step 4). Run on Node 24:
 *
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts serve
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts invite [--uses N] [--note TEXT]
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts rewrap   (server stopped; every DEK onto HOSTED_KEK_CURRENT)
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts restore <storeId|control|--all> [--force]   (server stopped)
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts start-over <storeId>   (a store that never reached the bucket)
 *
 * Everything comes from the environment, and nothing falls back to a default:
 *
 *   HOSTED_DATA_ROOT   absolute path of the volume (required; refused inside a live store)
 *   PUBLIC_ORIGIN      https://app.counterparts.ai (required; every published URL is built from it)
 *   PORT               the port to bind on 0.0.0.0 (serve; default 8080)
 *   TRUST_PROXY        "1" behind Railway's proxy (X-Forwarded-For / -Proto)
 *   RESEND_API_KEY     the mail provider's key (serve; required unless MAIL=log)
 *   MAIL_FROM          e.g. "Counterparts <memory@counterparts.ai>"
 *   MAIL               "log" prints login links to stderr instead of sending (local runs only)
 *   COOKIE_KEYS        comma-separated keys for the OAuth library's cookies (optional)
 *   HOSTED_KEKS        the KEK ring, version:base64 (keys.ts; the beta's KEK holder)
 *   HOSTED_KEK_CURRENT the version new wraps use
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
 *   NEW_BUCKET         R2_BUCKET's exact value: this volume has lived (its control key or control databases are
 *                      here) and the bucket has no control key ON PURPOSE (a move to a new bucket, or turning
 *                      backups on after BACKUPS=off). Without it such a start is refused (R7). One deploy, then unset
 *
 * No secret is ever printed. `invite` prints the new code once, to stdout.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { withEmbedderDefault } from "../../src/adapters/config.js";
import { openEmbedder } from "../../src/adapters/claude-code/embed-client.js";
import { isEntryPoint } from "../../src/adapters/mcp/bin/serve.js";
import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts } from "./accounts.js";
import { controlVolume, createApp, foreignControlRefusal, restoreControl } from "./app.js";
import type { AppBackupOptions, ControlVolume } from "./app.js";
import { Backups, CONTROL_DATABASES, CONTROL_KEY_ID, LitestreamSidecar, litestreamRunner, replicaPrefix, tombstoneObject } from "./backup.js";
import type { KeylessReason, LitestreamRun } from "./backup.js";
import { STORE_ID, Tenants, storeTag } from "./tenants.js";
import type { SharedEmbedder } from "./tenants.js";
import { KeyStore, kekRingFromEnv } from "./keys.js";
import { memoryMailer, r2ObjectStore, resendMailer } from "./egress.js";
import type { Mailer } from "./egress.js";

export function readEnv(env: Record<string, string | undefined>, command: string): { ok: true; dataRoot: string; origin: string; port: number } | { ok: false; refusal: string } {
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
  const live = livePathRefusal(dataRoot, "HOSTED_DATA_ROOT");
  if (live !== null) return { ok: false, refusal: live.replace(/^\[counterparts\] /, "") };
  return { ok: true, dataRoot, origin, port };
}

function mailerFrom(env: Record<string, string | undefined>): Mailer | string {
  if (env["MAIL"] === "log") {
    const mem = memoryMailer();
    return {
      async send(mail) {
        await mem.send(mail);
        process.stderr.write(`[hosted] (MAIL=log) a sign-in email for ${mail.to}:\n${mail.text}\n`);
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
  const wrapper = kekRingFromEnv(env);
  if ("refusal" in wrapper) return { refusal: `refused: ${wrapper.refusal} (or BACKUPS=off for a local run)` };
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
  return { wrapper, objects: r2ObjectStore({ endpoint, bucket, accessKeyId, secretAccessKey }), bucket, endpoint, sidecar };
}

const litestreamBinary = (env: Record<string, string | undefined>): string => env["LITESTREAM_BIN"] ?? "litestream";

/** The Litestream child's whole environment: PATH and the R2 credentials, nothing else of the server's. */
function litestreamEnv(env: Record<string, string | undefined>, accessKeyId: string, secretAccessKey: string): Record<string, string> {
  return { PATH: env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: accessKeyId, LITESTREAM_SECRET_ACCESS_KEY: secretAccessKey };
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
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => [storeId] });
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
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => accounts.liveStoreIds(), openedBefore: (id) => accounts.wasOpened(id), locked: (id) => accounts.storeLocked(id) });
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
        lines.push(`store ${storeTag(id)}: ${err instanceof Error ? err.message : String(err)}`);
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
 * `serve`'s log line for an app event: limit refusals, stores waiting on a
 * restore, a new store's failed backup set-up (R3). The event and the hashed
 * store tag, nothing else: never an id, an address or an error's text.
 */
export function eventLine(name: string, store: string): string {
  // `storeTag=` is `storeTag` (SHA-256, the restore CLI's tag); `store=` is server.ts's per-process HMAC tag.
  if (name === "backup.ensure.failed") return `[hosted] ${name} storeTag=${store}: this store is NOT backed up yet (its key or its place in litestream.yml failed; the audit has it). The next restart retries it, and gives it a key if the bucket holds nothing of it\n`;
  if (name === "backup.key.minted") return `[hosted] ${name} storeTag=${store}: this store served with no backup key, here or in the bucket, and the bucket holds nothing of it. It has a key now; backed up once this start is serving\n`;
  if (name.startsWith("backup.keyless.")) {
    const reason = name.slice("backup.keyless.".length) as KeylessReason;
    return `[hosted] backup.keyless storeTag=${store} reason=${reason}: this store is NOT backed up, and no key was made: ${KEYLESS_WORDS[reason]}\n`;
  }
  return `[hosted] ${name} store=${store}\n`;
}

/** What each `backup.keyless` reason says to the operator (docs/hosted/RUNBOOK.md, If a start refuses). */
const KEYLESS_WORDS: Record<KeylessReason, string> = {
  "no-database": "its database isn't on this volume. It waits for a restore (RESTORE_ON_BOOT=1), or for start-over if it never reached the bucket",
  "replica-in-bucket": "the bucket holds backup objects of it under a key that is gone, and a new key would bury them. Tell the coordinator",
  tombstone: "the bucket has its tombstone: it was deleted, and the delete is finished at a start",
  "bucket-unproven": "the bucket had no control key before this start (NEW_BUCKET said it is new on purpose), so it isn't proven to be this volume's. If R2_BUCKET is wrong after all, fix it before anything else; if it is right, the next start checks again (this start put the control key there). If the corrected bucket then refuses with \"the bucket's control key is a different key\", this start made this volume a new control key: remove keys/ (rm -rf /data/keys), then deploy once with CONTROL_ASIDE=<new label> and RESTORE_ON_BOOT=1",
  "keys-newer": "this volume's keys (keys/keys.sqlite) were made after the store was first opened, so an older key of it may exist. Tell the coordinator",
  "bucket-unreadable": "the bucket didn't answer one of the checks. The next restart tries again",
  locked: "its account is set to be deleted (a pending delete), and a store set to be erased is never given a new key. It is erased at its deadline; if its person keeps it, the next start checks it like any store that lived with no key",
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
   * NEW_BUCKET was used on a volume that was NEVER backed up (a `BACKUPS=off`
   * run turning backups on): `serve` passes it to `app.start`, so the stores
   * that lived under off are given keys at this start (R5's (f) and (f2)
   * waived; its other checks stand). Never set for a volume backed up before.
   */
  readonly firstBackup?: boolean;
}

/**
 * BEFORE ANYTHING OPENS A CONTROL DATABASE (`serve`, `invite`, `rewrap`,
 * `start-over`): is this volume the one that wrote the bucket's backups? (The
 * #OL2b review, H2; R7.)
 *
 *   - The bucket has no `keys/control.wrapped`, and this volume never lived
 *     (no control key, no control database): a new server. Go on.
 *   - The bucket has no control key, but this volume LIVED (R7): refused,
 *     unless NEW_BUCKET names this bucket. Otherwise the start would make the
 *     volume a control key in that bucket and back the control databases up
 *     there: with a wrong R2_BUCKET, the control writes from then on go to the
 *     wrong bucket, and back on the right one the start refuses "a different
 *     key" (when `keys.sqlite` was lost too). The refusal says which case it
 *     thinks it is (`livedRefusal`).
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

/**
 * A BUCKET WITH NO CONTROL KEY (R7). A volume that never lived starts as a new
 * server. One that lived starts only when NEW_BUCKET is R2_BUCKET's exact
 * value: the variable names the bucket, so one left set never vouches for a
 * different bucket later (a typo'd R2_BUCKET is refused again).
 */
function emptyBucket(dataRoot: string, backup: AppBackupOptions, v: ControlVolume, newBucket: string | undefined): Prepared {
  if (!v.localKey && v.present.length === 0) {
    return newBucket === undefined ? {} : { note: "NEW_BUCKET is set, but this volume is new (no control key, no control databases): it changed nothing. Unset NEW_BUCKET." };
  }
  // Backed up before: the control key here, or (keys.sqlite lost) the control
  // databases' key file, which a BACKUPS=off run never writes (the M2 check).
  const backedUp = v.localKey || existsSync(join(dataRoot, "keys", "keys.sqlite")) || existsSync(join(dataRoot, "control", "litestream.key"));
  if (newBucket === backup.bucket) {
    return backedUp
      ? { note: `NEW_BUCKET=${backup.bucket}: this volume was backed up to another bucket, and starts on this one, which has no control key, on purpose. Its control key and databases are backed up here from this start. Unset NEW_BUCKET once it is serving.` }
      : { note: `NEW_BUCKET=${backup.bucket}: this volume ran without backups (BACKUPS=off) and starts on this bucket, which has no control key, on purpose. Its control databases and every store are backed up here from this start. Unset NEW_BUCKET once it is serving.`, firstBackup: true };
  }
  return { refusal: livedRefusal(v, backedUp, backup.bucket, newBucket) };
}

/** The R7 refusal: the case it thinks it is, what to fix, and the one variable that says "on purpose". */
function livedRefusal(v: ControlVolume, backedUp: boolean, bucket: string, newBucket: string | undefined): string {
  const optIn = `set NEW_BUCKET=${bucket} (R2_BUCKET's value) for one deploy, then unset it`;
  const mismatch = newBucket === undefined ? "" : ` (NEW_BUCKET is set, but not to R2_BUCKET's value "${bucket}", so it doesn't count.)`;
  const tail = ` (docs/hosted/RUNBOOK.md, If a start refuses).${mismatch}`;
  if (v.localKey) {
    return `refused: this volume has been backed up (its control key is in keys/keys.sqlite), but the bucket R2_BUCKET names ("${bucket}") has no control key: R2_BUCKET is most likely wrong. Fix it and deploy again. Only if this is a new, empty bucket on purpose (a move to a new bucket), ${optIn}${tail}`;
  }
  if (backedUp) {
    return `refused: this volume has been backed up (control/litestream.key is here) but has lost its control key (keys/keys.sqlite), and the bucket R2_BUCKET names ("${bucket}") has no control key: R2_BUCKET is most likely wrong. Fix it and deploy again; the right bucket then asks for CONTROL_ASIDE=<new label> and RESTORE_ON_BOOT=1, which bring the control databases back. Only if this is a new, empty bucket on purpose, ${optIn}; this volume's stores lost their keys with keys/keys.sqlite and would stay unbacked there (backup.keyless reason=keys-newer)${tail}`;
  }
  return `refused: this volume has ${v.present.join(" and ")} but has never been backed up: it ran with BACKUPS=off (or an invite ran before its first start). The bucket R2_BUCKET names ("${bucket}") has no control key. To turn backups on into this bucket, ${optIn}; this start then backs up the control databases and every store. If R2_BUCKET is wrong, fix it instead${tail}`;
}

async function main(): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const [command = "serve", ...rest] = process.argv.slice(2);
  const read = readEnv(env, command);
  if (!read.ok) {
    process.stderr.write(`[hosted] ${read.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "invite" || command === "rewrap" || command === "start-over") {
    // None may make a control database on a volume that isn't the bucket's
    // (prepareVolume); `invite` needs the backups named or BACKUPS=off said
    // (the #653 review, L6), so it can never skip that check by accident.
    const configured = backupFromEnv(env, read.dataRoot);
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
  if (command === "invite") {
    const uses = Number(rest[rest.indexOf("--uses") + 1] ?? "1");
    const note = rest.includes("--note") ? rest[rest.indexOf("--note") + 1] : undefined;
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    const { code } = accounts.createInvite({ maxUses: rest.includes("--uses") && Number.isInteger(uses) && uses > 0 ? uses : 1, ...(note === undefined ? {} : { note }) });
    accounts.close();
    process.stdout.write(`${code}\n`);
    return;
  }
  if (command !== "serve" && command !== "rewrap" && command !== "restore") {
    process.stderr.write("[hosted] commands: serve, invite, rewrap, restore, start-over\n");
    process.exitCode = 1;
    return;
  }
  const backup = backupFromEnv(env, read.dataRoot);
  // BACKUPS=off ON A VOLUME THAT WAS BACKED UP (the #653 review, M2): a delete
  // then would leave its key object and replica in the bucket for good, and
  // nothing would know to remove them. Off is for a volume that never had them.
  if (backup === null && (existsSync(join(read.dataRoot, "keys", "keys.sqlite")) || existsSync(join(read.dataRoot, "control", "litestream.key")))) {
    process.stderr.write("[hosted] refused: BACKUPS=off on a volume that has been backed up (keys/keys.sqlite or control/litestream.key is here). Name the bucket instead.\n");
    process.exitCode = 1;
    return;
  }
  if (backup !== null && "refusal" in backup) {
    process.stderr.write(`[hosted] ${backup.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "rewrap") {
    // Every wrapped DEK onto HOSTED_KEK_CURRENT (the ring holds the old version
    // too), then EVERY live store's R2 object compared and re-written — not only
    // the ones this run moved, so a rewrap that died between the two is repaired
    // by running it again. Run with the server stopped; drop the old version
    // from HOSTED_KEKS only after it prints (start-up refuses a key it can't open).
    if (backup === null) {
      process.stderr.write("[hosted] refused: rewrap needs the keys and the bucket (not BACKUPS=off).\n");
      process.exitCode = 1;
      return;
    }
    const keys = new KeyStore({ path: `${read.dataRoot}/keys/keys.sqlite`, wrapper: backup.wrapper });
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    const backups = new Backups({ dataRoot: read.dataRoot, keys, objects: backup.objects, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => accounts.liveStoreIds() });
    const moved = await keys.rewrap(backup.wrapper);
    const put = await backups.syncKeyObjects();
    keys.close();
    accounts.close();
    process.stdout.write(`rewrapped ${String(moved.length)} keys onto ${backup.wrapper.version}; ${String(put)} key objects re-written\n`);
    return;
  }
  if (command === "restore") {
    if (backup === null) {
      process.stderr.write("[hosted] refused: restore needs the keys and the bucket (not BACKUPS=off).\n");
      process.exitCode = 1;
      return;
    }
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
  const app = createApp({
    dataRoot: read.dataRoot,
    publicOrigin: read.origin,
    mailer,
    trustProxy: env["TRUST_PROXY"] === "1",
    embedder,
    ...(cookieKeys === undefined || cookieKeys.length === 0 ? {} : { cookieKeys }),
    ...(backup === null ? {} : { backup }),
    onEvent: (name, store) => process.stderr.write(eventLine(name, store)),
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
  await new Promise<void>((r) => app.server.listen(read.port, "0.0.0.0", () => r()));
  process.stderr.write(`[hosted] serving ${read.origin} on port ${String(read.port)}${backup === null ? " (BACKUPS=off)" : ""}\n`);
  await new Promise<void>((resolveStop) => {
    process.once("SIGINT", () => resolveStop());
    process.once("SIGTERM", () => resolveStop());
  });
  await new Promise<void>((r) => app.server.close(() => r()));
  await app.close();
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main().then(
    () => process.exit(process.exitCode === 1 ? 1 : 0),
    (err: unknown) => {
      process.stderr.write(`[hosted] did not start: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
