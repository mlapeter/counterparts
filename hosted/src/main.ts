#!/usr/bin/env node
/**
 * THE HOSTED SERVER'S ENTRY POINT (OL2 step 4). Run on Node 24:
 *
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts serve
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts invite [--uses N] [--note TEXT]
 *   node --import ./src/adapters/node-hooks.mjs hosted/src/main.ts rewrap   (server stopped; every DEK onto HOSTED_KEK_CURRENT)
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
 *
 * No secret is ever printed. `invite` prints the new code once, to stdout.
 */
import { isAbsolute } from "node:path";

import { withEmbedderDefault } from "../../src/adapters/config.js";
import { openEmbedder } from "../../src/adapters/claude-code/embed-client.js";
import { isEntryPoint } from "../../src/adapters/mcp/bin/serve.js";
import { livePathRefusal } from "../../src/adapters/remote/bin/serve-http.js";
import { Accounts } from "./accounts.js";
import { createApp } from "./app.js";
import type { AppBackupOptions } from "./app.js";
import { Backups, LitestreamSidecar } from "./backup.js";
import { KeyStore, kekRingFromEnv } from "./keys.js";
import { memoryMailer, r2ObjectStore, resendMailer } from "./egress.js";
import type { Mailer } from "./egress.js";

export function readEnv(env: Record<string, string | undefined>, command: string): { ok: true; dataRoot: string; origin: string; port: number } | { ok: false; refusal: string } {
  const dataRoot = env["HOSTED_DATA_ROOT"];
  if (dataRoot === undefined || !isAbsolute(dataRoot)) return { ok: false, refusal: "refused: set HOSTED_DATA_ROOT to the volume's absolute path. This server never picks a default." };
  const origin = env["PUBLIC_ORIGIN"]?.replace(/\/+$/, "");
  if (origin === undefined || !/^https?:\/\/[^/]+$/.test(origin)) return { ok: false, refusal: "refused: set PUBLIC_ORIGIN (e.g. https://app.counterparts.ai), with no path." };
  if (command === "serve" && origin.startsWith("http://") && env["MAIL"] !== "log") return { ok: false, refusal: "refused: PUBLIC_ORIGIN must be https outside a local run (MAIL=log)." };
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
    binary: env["LITESTREAM_BIN"] ?? "litestream",
    configPath,
    env: { PATH: env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin", LITESTREAM_ACCESS_KEY_ID: accessKeyId, LITESTREAM_SECRET_ACCESS_KEY: secretAccessKey },
    onEvent: (name) => process.stderr.write(`[hosted] ${name}\n`),
  });
  return { wrapper, objects: r2ObjectStore({ endpoint, bucket, accessKeyId, secretAccessKey }), bucket, endpoint, sidecar };
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
  if (command === "invite") {
    const uses = Number(rest[rest.indexOf("--uses") + 1] ?? "1");
    const note = rest.includes("--note") ? rest[rest.indexOf("--note") + 1] : undefined;
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    const { code } = accounts.createInvite({ maxUses: rest.includes("--uses") && Number.isInteger(uses) && uses > 0 ? uses : 1, ...(note === undefined ? {} : { note }) });
    accounts.close();
    process.stdout.write(`${code}\n`);
    return;
  }
  if (command !== "serve" && command !== "rewrap") {
    process.stderr.write("[hosted] commands: serve, invite, rewrap\n");
    process.exitCode = 1;
    return;
  }
  const backup = backupFromEnv(env, read.dataRoot);
  if (backup !== null && "refusal" in backup) {
    process.stderr.write(`[hosted] ${backup.refusal}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "rewrap") {
    // Every wrapped DEK onto HOSTED_KEK_CURRENT (the ring holds the old version
    // too), then their R2 objects re-written. Run with the server stopped.
    if (backup === null) {
      process.stderr.write("[hosted] refused: rewrap needs the keys and the bucket (not BACKUPS=off).\n");
      process.exitCode = 1;
      return;
    }
    const keys = new KeyStore({ path: `${read.dataRoot}/keys/keys.sqlite`, wrapper: backup.wrapper });
    const accounts = new Accounts({ path: `${read.dataRoot}/control/accounts.sqlite` });
    const backups = new Backups({ dataRoot: read.dataRoot, keys, objects: backup.objects, bucket: backup.bucket, endpoint: backup.endpoint, sidecar: null, liveStores: () => accounts.liveStoreIds() });
    const moved = await keys.rewrap(backup.wrapper);
    await backups.reuploadKeys(moved);
    keys.close();
    accounts.close();
    process.stdout.write(`rewrapped ${String(moved.length)} keys onto ${backup.wrapper.version}\n`);
    return;
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
  });
  await app.start();
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
