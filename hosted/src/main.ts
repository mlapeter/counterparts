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
 *
 * No secret is ever printed. `invite` prints the new code once, to stdout.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { withEmbedderDefault } from "../../src/adapters/config.js";
import { openEmbedder } from "../../src/adapters/claude-code/embed-client.js";
import { isEntryPoint } from "../../src/adapters/mcp/bin/serve.js";
import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts } from "./accounts.js";
import { controlVolume, createApp, foreignControlRefusal, restoreControl } from "./app.js";
import type { AppBackupOptions } from "./app.js";
import { Backups, CONTROL_DATABASES, CONTROL_KEY_ID, LitestreamSidecar, litestreamRunner, replicaPrefix } from "./backup.js";
import type { LitestreamRun } from "./backup.js";
import { STORE_ID, Tenants } from "./tenants.js";
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
/** A store's tag for an operator's terminal: the first 16 hex of its SHA-256, never the id itself. */
export function storeTag(storeId: string): string {
  return createHash("sha256").update(storeId).digest("hex").slice(0, 16);
}

/**
 * `start-over <storeId>` (the #653 review, L8): the way out for a store that
 * was opened and never reached the bucket (its person signed up, the volume died
 * within seconds), which otherwise answers 503 forever. Refused unless its
 * database is missing here AND the bucket holds no replica object of it; then
 * its next open starts it as a new install.
 */
async function startOverCommand(dataRoot: string, backup: AppBackupOptions, storeId: string | undefined): Promise<string> {
  if (storeId === undefined || !STORE_ID.test(storeId)) throw new Error("start-over needs a store id");
  const accounts = new Accounts({ path: join(dataRoot, "control", "accounts.sqlite") });
  const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: backup.wrapper });
  try {
    if (!accounts.liveStoreIds().includes(storeId)) throw new Error("that store isn't a live store in the accounts database");
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => [storeId] });
    if (existsSync(backups.dbPaths(storeId)[0]!)) throw new Error("its database is here: nothing to start over");
    if ((await backup.objects.list(replicaPrefix(storeId))).length > 0) throw new Error("the bucket has a replica of it: restore it instead (RESTORE_ON_BOOT=1)");
    accounts.clearOpened(storeId);
    return `store ${storeTag(storeId)}: starts over as a new, empty store at its next open`;
  } finally {
    keys.close();
    accounts.close();
  }
}

async function restoreCommand(dataRoot: string, backup: AppBackupOptions, run: LitestreamRun, args: string[], embedder: SharedEmbedder): Promise<{ text: string; failed: number }> {
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
  const tenants = new Tenants({ root: join(dataRoot, "tenants"), embedder, spawner: () => ({ pid: 0 }) });
  try {
    const backups = new Backups({ dataRoot, keys, objects: backup.objects, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => accounts.liveStoreIds(), openedBefore: (id) => accounts.wasOpened(id) });
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
          await tenants.withTenant(id, {}, async () => undefined);
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
 * BEFORE ANYTHING OPENS A CONTROL DATABASE (`serve`, `invite`, `rewrap`): is
 * this volume the one that wrote the bucket's backups? (The #OL2b review, H2.)
 *
 *   - The bucket has no `keys/control.wrapped`: a new server. Go on.
 *   - This volume holds the control key too: it is the bucket's. A control
 *     database missing from it (a control restore cut short) is restored alone
 *     with a runner, refused without one. Never made empty: an empty one would
 *     be replicated over the real one.
 *   - The bucket has the key and this volume doesn't: the volume lost its data
 *     (or is new). With no control database here, restore them (a runner) or
 *     refuse, saying how. With one here (made by an `invite`, a `BACKUPS=off`
 *     run, …), always refuse: it isn't the real one, and it would replace it.
 */
export async function prepareVolume(dataRoot: string, backup: AppBackupOptions, run: LitestreamRun | null): Promise<{ refusal?: string; restored?: string }> {
  const v = await controlVolume(dataRoot, backup);
  if (!v.bucketKey) return {};
  if (v.localKey && v.present.length === CONTROL_DATABASES.length) return {};
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
  return { restored: `${String(r.restored)} restored, ${String(r.kept)} already here` };
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
      const prepared = await prepareVolume(read.dataRoot, configured, null);
      if (prepared.refusal !== undefined) {
        process.stderr.write(`[hosted] ${prepared.refusal}\n`);
        process.exitCode = 1;
        return;
      }
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
  // AN EMPTY VOLUME BESIDE A BUCKET THAT HAS BACKUPS: starting would make new,
  // empty control databases and replicate them over the real ones. So either
  // restore them first (RESTORE_ON_BOOT=1) or refuse, saying how.
  const restoreOnBoot = env["RESTORE_ON_BOOT"] === "1";
  if (backup !== null) {
    const prepared = await prepareVolume(read.dataRoot, backup, restoreOnBoot ? restoreRunner(env) : null);
    if (prepared.refusal !== undefined) {
      process.stderr.write(`[hosted] ${prepared.refusal}\n`);
      process.exitCode = 1;
      return;
    }
    if (prepared.restored !== undefined) process.stderr.write(`[hosted] restored the control databases: ${prepared.restored}\n`);
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
    // Limit refusals and stores waiting on a restore: the event and the hashed store tag, nothing else.
    onEvent: (name, store) => process.stderr.write(`[hosted] ${name} store=${store}\n`),
    // First deploy only: the raw X-Forwarded-For of each /readyz request, to count the proxy's hops. Unset it after.
    ...(env["LOG_FORWARDED_FOR"] === "1" ? { logForwardedFor: (raw: string) => process.stderr.write(`[hosted] /readyz X-Forwarded-For: ${raw}\n`) } : {}),
  });
  const report = await app.start(restoreOnBoot && backup !== null ? { restore: restoreRunner(env) } : {});
  if (report.restored > 0) process.stderr.write(`[hosted] RESTORE_ON_BOOT: ${String(report.restored)} store databases restored. Unset RESTORE_ON_BOOT now.\n`);
  if (report.restoreFailed > 0) process.stderr.write(`[hosted] RESTORE_ON_BOOT: ${String(report.restoreFailed)} store restores FAILED; those stores wait (the audit has them as store.restore.failed)\n`);
  if (report.keyless > 0) process.stderr.write(`[hosted] ${String(report.keyless)} stores that lived have no key here or in the bucket: they are NOT backed up, and no new key was made\n`);
  if (report.tombstoned > 0) process.stderr.write(`[hosted] ${String(report.tombstoned)} accounts the bucket says were deleted came back with the control databases: their deletes were finished\n`);
  if (report.leftovers > 0) process.stderr.write(`[hosted] removed what ${String(report.leftovers)} deleted stores had left in the bucket\n`);
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
