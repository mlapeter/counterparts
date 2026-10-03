/**
 * THE NODE SMOKE TEST — the package run under Node instead of Bun, end to end.
 *
 *   bun run test:node        (needs `node` 22.15+ on PATH)
 *
 * The suite proper is `bun test`, and it stays Bun's: this file is the smallest
 * proof that the same sources run under Node through `src/adapters/node-hooks.mjs`
 * (the type stripper and the `.js` → `.ts` resolver). It is named so `bun test`
 * does not collect it, and it uses only `node:test` and `node:assert`.
 *
 * What it proves, each against a fresh temp directory it removes:
 *   1. the store opens on `node:sqlite` and holds a row across a close;
 *   2. the MCP server starts over stdio, answers `status`, and round-trips a
 *      `note` into a `recall`;
 *   3. a SessionStart hook runs end to end on a fake payload and injects a wake;
 *   4. `install`'s printed commands name Node, and the hook command it prints is
 *      one the hook reader recognises as ours;
 *   5. recall's meaning mode answers in this process (`mcp/meaning.ts`).
 *
 * Hermetic: every child gets HOME pointed into the temp directory and
 * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, and nothing here names a default path.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { hookCommand, runCommand } from "../src/adapters/cli/install.js";
import { isOurHookCommand } from "../src/adapters/cli/wire.js";
import { meaningRecall, renderMeaning } from "../src/adapters/mcp/meaning.js";
import { NODE_HOOKS, currentRuntime, scriptArgs } from "../src/adapters/runtime.js";
import { Counterpart } from "../src/core/counterpart.js";
import { openDb } from "../src/core/store/db.js";
import { Store } from "../src/core/store/index.js";

// THE GUARD, ARMED HERE rather than trusted to the caller's shell: Node has no
// `test/preload.ts`, so this is what keeps a forgotten path from reaching a real
// `~/.counterparts`. Nothing above reads it at import time.
process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";

const HOOK = fileURLToPath(new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url));
const SERVE = fileURLToPath(new URL("../src/adapters/mcp/bin/serve.ts", import.meta.url));

let work = "";
let home = "";
let store = "";
let config = "";

function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: home,
    USERPROFILE: home,
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    ...extra,
  };
}

/** One run of `<node> --import node-hooks.mjs <script>`, stdin given whole. */
function run(script: string, args: readonly string[], input: string, env: Record<string, string>) {
  const res = spawnSync(process.execPath, [...scriptArgs(script, process.execPath), ...args], {
    input,
    env,
    cwd: work,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function rpc(lines: readonly object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

const INIT = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

function responses(stdout: string): Map<number, Record<string, unknown>> {
  const out = new Map<number, Record<string, unknown>>();
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const msg = JSON.parse(line) as Record<string, unknown>;
    if (typeof msg["id"] === "number") out.set(msg["id"], msg);
  }
  return out;
}

before(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-node-smoke-"));
  home = join(work, "home");
  store = join(work, "store");
  config = join(work, "claude-code.json");
  mkdirSync(home, { recursive: true });
  writeFileSync(config, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9000 }), "utf8");
});

after(() => {
  if (work.length > 0) rmSync(work, { recursive: true, force: true });
});

describe("under Node", () => {
  test("this process is Node, not Bun", () => {
    assert.equal(currentRuntime(), "node");
    assert.equal(process.versions.bun, undefined);
  });

  test("the database binds node:sqlite and keeps a row across a close", () => {
    const path = join(work, "probe.sqlite");
    const db = openDb(path);
    try {
      assert.equal(db.driver, "node:sqlite");
      db.run("CREATE TABLE probe (v TEXT, n INTEGER)");
      // Booleans and undefined are the binding seam's to normalize (db.ts).
      db.run("INSERT INTO probe (v, n) VALUES (?, ?)", "kept", true);
    } finally {
      db.close();
    }
    const again = openDb(path);
    try {
      assert.deepEqual({ ...again.get<{ v: string; n: number }>("SELECT v, n FROM probe") }, { v: "kept", n: 1 });
    } finally {
      again.close();
    }
  });

  test("a store is created and opens again at its schema", () => {
    const first = Store.open({ dir: store });
    const versions = first.schemaVersions();
    first.close();
    const again = Store.open({ dir: store });
    try {
      assert.deepEqual(again.schemaVersions(), versions);
    } finally {
      again.close();
    }
  });

  test("the MCP server answers status over stdio, and a note comes back from recall", () => {
    const canary = "The node smoke canary: the bicycle in the hallway is a green Brompton.";
    const res = run(
      SERVE,
      [],
      rpc([
        ...INIT,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "note", arguments: { text: canary } } },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "recall", arguments: { question: "what bicycle is in the hallway?" } },
        },
      ]),
      childEnv({ COUNTERPARTS_DATA_DIR: store, COUNTERPARTS_CONFIG: config }),
    );
    assert.equal(res.code, 0, res.stderr);
    const got = responses(res.stdout);
    assert.ok(JSON.stringify(got.get(1) ?? {}).includes("serverInfo"), res.stdout);
    const status = JSON.stringify(got.get(2) ?? {});
    assert.ok(!status.includes('"isError":true') && status.includes("result"), status);
    const noted = JSON.stringify(got.get(3) ?? {});
    assert.ok(!noted.includes('"isError":true'), noted);
    const recalled = JSON.stringify(got.get(4) ?? {});
    assert.ok(recalled.includes("Brompton"), `recall did not return the note: ${recalled}\n${res.stderr}`);
  });

  test("a SessionStart hook runs end to end and injects a wake", () => {
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "node-smoke-1",
      cwd: work,
      source: "startup",
      transcript_path: join(work, "transcript.jsonl"),
    });
    const res = run(HOOK, ["--config", config], payload, childEnv());
    assert.equal(res.code, 0, res.stderr);
    // Plain text is the context; the JSON form carries it beside a notice for
    // the person (`envelope.ts`), which this store may or may not have.
    const context = res.stdout.trimStart().startsWith("{")
      ? ((JSON.parse(res.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput
          ?.additionalContext ?? "")
      : res.stdout;
    assert.match(context, /^Now: /m, res.stdout);
  });

  test("install names Node in what it writes, and reads it back as ours", () => {
    const hook = hookCommand(undefined, process.execPath);
    assert.ok(hook.includes("--import") && hook.includes(NODE_HOOKS), hook);
    assert.ok(!hook.includes(" run "), hook);
    assert.ok(isOurHookCommand(hook), hook);
    assert.ok(isOurHookCommand(hookCommand(config, process.execPath)));
    assert.ok(runCommand(SERVE, process.execPath).endsWith(`"${SERVE}"`));
  });

  test("meaning mode arranges a card's arc in this process", () => {
    const c = Counterpart.open({ dir: join(work, "meaning"), snapshotsDir: join(work, "meaning-snaps"), owner: true });
    try {
      const card = c.schemas.mention({ name: "Ada", kind: "person", source: "Ada", chunkRef: "card-Ada", aliases: [], day: c.store.livedDay() });
      assert.ok(card.ok, String(card.reason));
      const id = c.store.put({ type: "memory", kind: "fact", body: "Ada shipped the parser today.", origin: { session: "node-smoke-m", scope: work } });
      const r = meaningRecall({ counterpart: c, sessionId: "node-smoke-m", owner: true }, "What has Ada been to me?");
      assert.equal(r.reason, "answered");
      assert.ok(r.shown.includes(id), JSON.stringify(r.shown));
      assert.match(renderMeaning(r), /^Ada · 1 session with no chapter · 1 moment/);
    } finally {
      c.close();
    }
  });
});
