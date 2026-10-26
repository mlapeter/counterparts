/**
 * The entry point as a process: it refuses to start with anything unnamed,
 * prints an invite code once, and serves health and the 401 on a real port.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { readEnv } from "../src/main.js";
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
    const noKey = spawnSync(process.execPath, [...scriptArgs(MAIN), "serve"], { env: baseEnv({ HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "https://app.counterparts.ai" }), encoding: "utf8", timeout: 30_000 });
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
    const env = baseEnv({ HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "http://127.0.0.1", MAIL: "log", PORT: "0" });
    const invite = spawnSync(process.execPath, [...scriptArgs(MAIN), "invite", "--note", "test"], { env, encoding: "utf8", timeout: 30_000 });
    assert.equal(invite.status, 0, invite.stderr);
    assert.match(invite.stdout.trim(), /^cpi_[A-Za-z0-9_-]{43}$/);
    // PORT=0 is refused (a real port is required); pick one.
    const port = 40000 + Math.floor(Math.random() * 20000);
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
