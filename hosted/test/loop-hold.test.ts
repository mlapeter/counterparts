/**
 * A CLI command must never exit 0 half done. The WB1 `migrate-keys` flake (CI,
 * bun on Linux, 11-10 to 11-13): after the control re-key proved, the next
 * object-store call was the only work left, held nothing open, and the event
 * loop ran empty; the process exited 0 having printed nothing. Each fixture
 * runs as its own process, under the runtime running this file.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { STALLED } from "../src/main.js";

function runFixture(name: string, args: string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const fixture = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...scriptArgs(fixture), ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("a command can't exit 0 half done", () => {
  // put is where the WB1 stall was traced (the control key object, after the re-key proved); every method is held.
  for (const method of ["put", "get", "delete", "list", "deletePrefix", "readableWith"]) {
    test(`an object-store ${method} holds the process open until it settles, even when it is the only work left`, async () => {
      const out = await runFixture("r2-only-work.ts", [method]);
      assert.equal(out.code, 0, out.stderr);
      assert.match(out.stdout, new RegExp(`^${method} done `), `the call never finished: exit ${String(out.code)}, stderr ${out.stderr}`);
    });
  }

  test("the entry point: a command whose last await holds nothing open exits 1 and says it stopped, never 0 with nothing printed", async () => {
    const out = await runFixture("stall-entry.ts");
    assert.equal(out.code, 1, `exit ${String(out.code)}, stdout ${JSON.stringify(out.stdout)}, stderr ${out.stderr}`);
    assert.equal(out.stdout, "");
    assert.ok(out.stderr.includes(STALLED), out.stderr);
  });

  test("stopped is final: a command that resumes while the exit waits on stderr neither prints its report nor changes the exit code", async () => {
    const out = await runFixture("stall-entry.ts", ["revived"]);
    assert.equal(out.code, 1, `exit ${String(out.code)}, stdout ${JSON.stringify(out.stdout)}, stderr ${out.stderr}`);
    assert.equal(out.stdout, "", "the revived command printed after the stop was said");
    assert.ok(out.stderr.includes(STALLED), out.stderr);
    assert.ok(!out.stderr.includes("did not start"), out.stderr);
  });
});
