/**
 * THE 7-CHAT SCRIPT (`tools/trials/claude-ai/chat-script.ts`, OL4): the seven
 * chats and a night played over the real HTTP door with fixed tool calls, then
 * scored from the call log and the store.
 *
 * What is held:
 *   - on this tree every scored row passes, and the CLI exits 0 and writes its
 *     report, transcript and call log into a fresh run folder;
 *   - a deliberate break makes it fail: a wake that loses the morning share
 *     (the server wrapped behind the same socket) fails "chat 7: wake carries
 *     the share" and the run, and the CLI would exit 1;
 *   - a refused tool call fails "every call answered";
 *   - the script refuses the owner's live store.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test, removed after; HOME
 * is the test's own (test/preload.ts); no model, no worker process, no network
 * beyond 127.0.0.1.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { Request, Response } from "../src/adapters/mcp/protocol.js";
import type { HttpMcpServer } from "../src/adapters/remote/http.js";
import { WORDS, playChats, score } from "../tools/trials/claude-ai/chat-script.js";

const SCRIPT = join(import.meta.dir, "..", "tools", "trials", "claude-ai", "chat-script.ts");

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-chat-script-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A server whose wake answers without the morning share — the regression the script must catch.
 *  The rest of the wake, and every other call, answers unchanged. */
function shareless(inner: HttpMcpServer): HttpMcpServer {
  return {
    async handle(request: Request): Promise<Response | null> {
      const res = await inner.handle(request);
      if (res === null || request.method !== "tools/call" || request.params?.["name"] !== "wake") return res;
      return JSON.parse(JSON.stringify(res).split(WORDS.share).join("(the share was here)")) as Response;
    },
    get clientName() {
      return inner.clientName ?? null;
    },
    get clientVersion() {
      return inner.clientVersion ?? null;
    },
  };
}

describe("the 7-chat script", () => {
  test("passes on this tree: every scored row", async () => {
    const o = await playChats({ runDir: join(root, "run") });
    const { rows, passed } = score(o);
    const failing = rows.filter((r) => r.verdict === "FAIL");
    expect(failing).toEqual([]);
    expect(passed).toBe(true);
    // The rows the brief names are all there.
    const checks = rows.map((r) => r.check);
    for (const want of ["wake shown, every chat", "chat 3: the feeling kept", "chat 6: chapter written", "chat 7: wake carries the share", "chat 7: share told"]) {
      expect(checks).toContain(want);
    }
    expect(rows.find((r) => r.check.startsWith("notices relayed"))?.verdict).toBe("n/a");
  });

  test("the CLI: exit 0, a fresh run folder with the report, the transcript and the call log", () => {
    const dir = join(root, "trials");
    const out = spawnSync(process.execPath, [SCRIPT, "--dir", dir], { encoding: "utf8", env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("PASSED");
    const runs = readdirSync(dir);
    expect(runs).toHaveLength(1);
    const run = join(dir, runs[0] as string);
    for (const f of ["report.txt", "transcript.txt", "calls.jsonl", "store"]) expect(existsSync(join(run, f))).toBe(true);
    expect(readFileSync(join(run, "report.txt"), "utf8")).toContain("Model-free");
  });

  test("a deliberate break — a wake that loses the share — fails the run", async () => {
    const o = await playChats({ runDir: join(root, "run"), wrap: shareless });
    const { rows, passed } = score(o);
    expect(passed).toBe(false);
    expect(rows.find((r) => r.check === "chat 7: wake carries the share")?.verdict).toBe("FAIL");
    // Only the share is gone: the wake itself still answered, and so did every call.
    expect(rows.find((r) => r.check === "wake shown, every chat")?.verdict).toBe("pass");
    expect(rows.find((r) => r.check === "every call answered")?.verdict).toBe("pass");
    expect(rows.filter((r) => r.verdict === "FAIL").map((r) => r.check)).toEqual(["chat 7: wake carries the share"]);
  });

  test("a refused call fails 'every call answered'", async () => {
    const o = await playChats({ runDir: join(root, "run") });
    const broken = { ...o, steps: o.steps.map((s, i) => (i === 3 ? { ...s, ok: false, reason: "gate-rejected" } : s)) };
    const { rows, passed } = score(broken);
    expect(passed).toBe(false);
    expect(rows.find((r) => r.check === "every call answered")?.detail).toContain("gate-rejected");
  });

  test("a call over the budget fails the timing row", async () => {
    const o = await playChats({ runDir: join(root, "run") });
    const { rows } = score(o, { maxMs: 0.0001 });
    expect(rows.find((r) => r.check.startsWith("timings"))?.verdict).toBe("FAIL");
  });

  test("the owner's live store is refused", () => {
    // The child is given this run's env, so its home is the preload's temp one
    // (a child with no env would see the real home: test/preload.ts).
    const out = spawnSync(process.execPath, [SCRIPT, "--dir", join(homedir(), ".counterparts", "ol4")], { encoding: "utf8", env: { ...process.env } });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("refused");
    expect(existsSync(join(homedir(), ".counterparts", "ol4"))).toBe(false);
  });
});
