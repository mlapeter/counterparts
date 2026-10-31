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
 *   - the review's three (#652): a dream whose journal never reaches the store
 *     fails "dream journaled" though the reply had its hand-back; a propose
 *     with no changes fails "the dream's link landed"; a recall that loses the
 *     plan fails "recall finds the plan" — each the only row that fails where
 *     the rest can stand;
 *   - a run folder that already exists is refused;
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
import type { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";

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

  test("with the wake's shape on, every row still passes: the plan by title in the wake and behind the door, last night by title", async () => {
    const o = await playChats({ runDir: join(root, "run"), onOpen: (cp) => cp.store.setMeta(WAKE_SHAPE_KEY, "on") });
    const { rows, passed } = score(o);
    expect(rows.filter((r) => r.verdict === "FAIL")).toEqual([]);
    expect(passed).toBe(true);
    expect(o.wakeShape).toBe(true);
    expect(rows.find((r) => r.check === "chat 7: the plan in Coming up")?.detail).toContain("and in the wake's line");
    const whole = o.steps.find((s) => s.chat === "chat 7" && s.tool === "wake")?.text ?? "";
    const seven = whole.slice(whole.indexOf("<!-- counterparts:wake "), whole.indexOf("counterparts:wake/end"));
    expect(seven).not.toContain("drm_");
    expect(seven).not.toContain("rfl_");
  });

  test("the plan's check proves the item: with the plan gone from the door, it fails, on either shape", async () => {
    for (const on of [false, true]) {
      const dirName = `run-${String(on)}`;
      const o = await playChats({ runDir: join(root, dirName), ...(on ? { onOpen: (cp: Counterpart) => cp.store.setMeta(WAKE_SHAPE_KEY, "on") } : {}) });
      const tampered = { ...o, steps: o.steps.map((s) => (s.tool === "recall" && s.structured["handle"] === "coming up" ? { ...s, structured: { ...s.structured, later: [] } } : s)) };
      expect(score(tampered).rows.find((r) => r.check === "chat 7: the plan in Coming up")?.verdict).toBe("FAIL");
      expect(score(o).rows.find((r) => r.check === "chat 7: the plan in Coming up")?.verdict).toBe("pass");
    }
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

  /** The one row expected to fail under a break, with every other row still passing. */
  function onlyFails(rows: readonly { check: string; verdict: string }[], check: string): void {
    expect(rows.filter((r) => r.verdict === "FAIL").map((r) => r.check)).toEqual([check]);
  }

  test("a break inside the store — the dream's journal never written — fails 'dream journaled', whatever the answer said", async () => {
    const o = await playChats({
      runDir: join(root, "run"),
      onOpen: (cp) => {
        const store = cp.store as unknown as { updateDream: (id: string, patch: Record<string, unknown>) => unknown };
        const real = store.updateDream.bind(store);
        store.updateDream = (id, patch) => (patch["state"] === "journaled" ? undefined : real(id, patch));
      },
    });
    const { rows, passed } = score(o);
    expect(passed).toBe(false);
    // The journal call still answered with its hand-back: the row reads the store, not the reply.
    expect(o.steps.some((s) => s.tool === "dream" && typeof s.structured["handBack"] === "string")).toBe(true);
    expect(rows.find((r) => r.check === "night: dream journaled (store)")?.verdict).toBe("FAIL");
  });

  test("a propose that changes nothing fails 'the dream's link landed'", async () => {
    const emptied = (inner: HttpMcpServer): HttpMcpServer => ({
      handle: (request: Request) => {
        const args = request.params?.["arguments"] as Record<string, unknown> | undefined;
        if (request.method === "tools/call" && request.params?.["name"] === "dream" && args?.["phase"] === "propose") {
          return inner.handle({ ...request, params: { ...request.params, arguments: { ...args, changes: [] } } });
        }
        return inner.handle(request);
      },
      get clientName() {
        return inner.clientName ?? null;
      },
      get clientVersion() {
        return inner.clientVersion ?? null;
      },
    });
    const o = await playChats({ runDir: join(root, "run"), wrap: emptied });
    const { rows, passed } = score(o);
    expect(passed).toBe(false);
    // Only the night's changes: the empty "Last night" still names the dream, so that row holds.
    onlyFails(rows, "night: the dream's link landed");
  });

  test("a recall that loses the plan fails 'recall finds the plan'", async () => {
    const o = await playChats({
      runDir: join(root, "run"),
      // The plan's id gone from that one recall's answer (ids and text alike).
      wrap: (inner) => ({
        handle: async (request: Request) => {
          const res = await inner.handle(request);
          const args = request.params?.["arguments"] as Record<string, unknown> | undefined;
          if (res === null || request.method !== "tools/call" || request.params?.["name"] !== "recall" || args?.["question"] !== "dentist zqalvarez") return res;
          return JSON.parse(JSON.stringify(res).replace(/mem_[0-9a-f]{12}/g, "mem_000000000000")) as Response;
        },
        get clientName() {
          return inner.clientName ?? null;
        },
        get clientVersion() {
          return inner.clientVersion ?? null;
        },
      }),
    });
    const { rows } = score(o);
    onlyFails(rows, "chat 7: recall finds the plan");
  });

  test("a run folder that already exists is refused: never a shared store", async () => {
    const runDir = join(root, "run");
    await playChats({ runDir });
    await expect(playChats({ runDir })).rejects.toThrow("already exists");
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
