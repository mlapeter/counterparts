/**
 * The entry point as a process: it refuses to start with anything unnamed,
 * prints an invite code once, and serves health and the 401 on a real port.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { overrideGuard, readEnv } from "../src/main.js";
import { tempRoot } from "./helpers.js";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

let tmp: { root: string; remove: () => void };
beforeEach(() => {
  tmp = tempRoot("main");
});
afterEach(() => tmp.remove());

const baseEnv = (extra: Record<string, string>): Record<string, string> => ({
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  HOME: tmp.root,
  COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
  ...extra,
});

describe("the entry point", () => {
  test("nothing unnamed: no data root, a relative one, no origin, an http origin in production, no mail key", () => {
    assert.equal(readEnv({}, "serve").ok, false);
    assert.equal(readEnv({ HOSTED_DATA_ROOT: "data", PUBLIC_ORIGIN: "https://a.example" }, "serve").ok, false);
    assert.equal(readEnv({ HOSTED_DATA_ROOT: "/data" }, "serve").ok, false);
    assert.equal(readEnv({ HOSTED_DATA_ROOT: "/data", PUBLIC_ORIGIN: "http://a.example" }, "serve").ok, false);
    assert.equal(readEnv({ HOSTED_DATA_ROOT: "/data", PUBLIC_ORIGIN: "https://a.example/path" }, "serve").ok, false);
    assert.equal(readEnv({ HOSTED_DATA_ROOT: "/data", PUBLIC_ORIGIN: "https://app.counterparts.ai" }, "serve").ok, true);
    assert.equal(readEnv({ HOSTED_DATA_ROOT: "/data", PUBLIC_ORIGIN: "https://app.counterparts.ai", MAIL: "log" }, "serve").ok, false);
    const noKek = spawnSync(process.execPath, [...scriptArgs(MAIN), "serve"], { env: baseEnv({ HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "https://app.counterparts.ai" }), encoding: "utf8", timeout: 30_000 });
    assert.equal(noKek.status, 1);
    assert.match(noKek.stderr, /HOSTED_KEKS/);
    const noKey = spawnSync(process.execPath, [...scriptArgs(MAIN), "serve"], { env: baseEnv({ HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "https://app.counterparts.ai", BACKUPS: "off" }), encoding: "utf8", timeout: 30_000 });
    assert.equal(noKey.status, 1);
    assert.match(noKey.stderr, /RESEND_API_KEY/);
  });

  test("a live store is refused as the data root", () => {
    const home = join(tmp.root, "home");
    const run = spawnSync(process.execPath, [...scriptArgs(MAIN), "invite"], { env: { ...baseEnv({ HOSTED_DATA_ROOT: join(home, ".counterparts", "hosted"), PUBLIC_ORIGIN: "https://app.counterparts.ai" }), HOME: home }, encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /live store/);
  });

  test("invite prints one code; serve answers health and the 401 on its port", async () => {
    const env = baseEnv({ HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "http://127.0.0.1", MAIL: "log", PORT: "0", BACKUPS: "off" });
    const invite = spawnSync(process.execPath, [...scriptArgs(MAIN), "invite", "--note", "test"], { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(invite.status, 0, invite.stderr);
    assert.match(invite.stdout.trim(), /^cpi_[A-Za-z0-9_-]{43}$/);
    // PORT=0 is refused (a real port is required); take one the system says is free
    // (a random pick collided with another test file's listener under Node's parallel runner).
    const probe = createNetServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const child = spawn(process.execPath, [...scriptArgs(MAIN), "serve"], { env: { ...env, PUBLIC_ORIGIN: `http://127.0.0.1:${String(port)}`, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
    try {
      let err = "";
      await new Promise<void>((resolveUp, rejectUp) => {
        const t = setTimeout(() => rejectUp(new Error(`did not start: ${err}`)), 30_000);
        child.stderr!.on("data", (d: Buffer) => {
          err += d.toString();
          if (err.includes("serving")) {
            clearTimeout(t);
            resolveUp();
          }
        });
        child.once("exit", () => rejectUp(new Error(`exited: ${err}`)));
      });
      assert.equal((await fetch(`http://127.0.0.1:${String(port)}/healthz`)).status, 200);
      const unauth = await fetch(`http://127.0.0.1:${String(port)}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(unauth.status, 401);
      assert.match(String(unauth.headers.get("www-authenticate")), /resource_metadata=/);
    } finally {
      child.kill("SIGTERM");
    }
  });
});

describe("the entry point, the #653 review's refusals", () => {
  test("L6: invite refuses unless the backups are named or BACKUPS=off is said", () => {
    const env = baseEnv({ HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "https://app.counterparts.ai" });
    const run = spawnSync(process.execPath, [...scriptArgs(MAIN), "invite"], { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /HOSTED_KEKS/);
    assert.doesNotMatch(run.stdout, /cpi_/);
  });

  test("M2: BACKUPS=off is refused on a volume that has been backed up", () => {
    const dataRoot = join(tmp.root, "data");
    mkdirSync(join(dataRoot, "keys"), { recursive: true });
    writeFileSync(join(dataRoot, "keys", "keys.sqlite"), "");
    const env = baseEnv({ HOSTED_DATA_ROOT: dataRoot, PUBLIC_ORIGIN: "http://127.0.0.1:1", MAIL: "log", PORT: "1", BACKUPS: "off" });
    const run = spawnSync(process.execPath, [...scriptArgs(MAIN), "serve"], { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /BACKUPS=off on a volume that has been backed up/);
  });
});

describe("the entry point, R3: CONTROL_ASIDE", () => {
  // A bucket that can't be reached (port 1): `serve` stops at its first bucket
  // read. No network beyond localhost. (The moves themselves, against a bucket,
  // are in ops.test.ts: R2_ENDPOINT must be https, which the S3 stand-in isn't.)
  const withBucket = (dataRoot: string, extra: Record<string, string>): Record<string, string> =>
    baseEnv({
      HOSTED_DATA_ROOT: dataRoot,
      PUBLIC_ORIGIN: "https://app.counterparts.ai",
      HOSTED_KEKS: `v1:${Buffer.alloc(32, 7).toString("base64")}`,
      R2_ENDPOINT: "https://127.0.0.1:1",
      R2_BUCKET: "bkt",
      R2_ACCESS_KEY_ID: "test-generated-id",
      R2_SECRET_ACCESS_KEY: "test-generated-secret",
      ...extra,
    });
  const serve = (env: Record<string, string>) => spawnSync(process.execPath, [...scriptArgs(MAIN), "serve"], { env, encoding: "utf8", timeout: 30_000 });

  test("an unreachable bucket: serve does not start and moves nothing (the volume's state is read first); a used label moves nothing either", () => {
    const dataRoot = join(tmp.root, "data");
    mkdirSync(join(dataRoot, "control"), { recursive: true });
    writeFileSync(join(dataRoot, "control", "accounts.sqlite"), "the only control/");
    const first = serve(withBucket(dataRoot, { CONTROL_ASIDE: "1" }));
    assert.equal(first.status, 1);
    assert.match(first.stderr, /did not start/);
    assert.doesNotMatch(first.stderr, /moved control/);
    assert.equal(readFileSync(join(dataRoot, "control", "accounts.sqlite"), "utf8"), "the only control/");
    assert.equal(existsSync(join(dataRoot, "control.aside-1")), false);
    assert.equal(existsSync(join(dataRoot, "overrides")), false);
    // A label used before (a crash-restart, a forgotten override): said before the bucket is asked anything.
    mkdirSync(join(dataRoot, "overrides"), { recursive: true });
    writeFileSync(overrideGuard(dataRoot, "1"), "moved 2026-10-27T00:00:00.000Z\n");
    mkdirSync(join(dataRoot, "control.aside-1"), { recursive: true });
    const again = serve(withBucket(dataRoot, { CONTROL_ASIDE: "1" }));
    assert.match(again.stderr, /CONTROL_ASIDE=1 was used once already: nothing moved/);
    assert.equal(readFileSync(join(dataRoot, "control", "accounts.sqlite"), "utf8"), "the only control/");
  });

  test("CONTROL_ASIDE is refused with BACKUPS=off, and with a label that isn't one", () => {
    const dataRoot = join(tmp.root, "data");
    mkdirSync(join(dataRoot, "control"), { recursive: true });
    const off = serve(baseEnv({ HOSTED_DATA_ROOT: dataRoot, PUBLIC_ORIGIN: "http://127.0.0.1:1", MAIL: "log", PORT: "1", BACKUPS: "off", CONTROL_ASIDE: "1" }));
    assert.equal(off.status, 1);
    assert.match(off.stderr, /CONTROL_ASIDE needs the bucket/);
    const bad = serve(withBucket(dataRoot, { CONTROL_ASIDE: "../x" }));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /CONTROL_ASIDE must be a label/);
    assert.ok(existsSync(join(dataRoot, "control")));
    assert.equal(existsSync(join(dataRoot, "overrides")), false);
  });
});
