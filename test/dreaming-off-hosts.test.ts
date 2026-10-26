/**
 * "NO DREAMS" MEANS NO DREAMS, AND THE WORDS MATCH THE HOST (2026-10-26, OL1d,
 * from #649's review). Through the tools, on each host:
 *
 *   - while dreaming is `off`, `dream` launch refuses with one plain reason —
 *     Claude Code, Desktop's chat and claude.ai (the hosted server is claude.ai's
 *     host) — and writes nothing to the day's row; `auto`/`ask` launch again;
 *   - `auto` on claude.ai starts nothing on its own: a wake (a chat's or a
 *     night's) plans only the worker, never a night run, and leaves no night row;
 *   - the `setting` result says what happens on that host: Claude Code's words
 *     byte for byte as before, claude.ai's name the routine, Desktop's name no
 *     terminal and no background agent of its own;
 *   - a night already under way is not stopped: only `launch` is gated.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No model
 * is called; no child starts (a stub spawner records the plans). Every word is
 * invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import {
  CLAUDE_AI_SETTING_SAID,
  DESKTOP_SETTING_SAID,
  DREAMING_OFF_REFUSAL,
} from "../src/adapters/mcp/server-words.js";
import { recordSession } from "../src/adapters/sessions.js";
import { NIGHT_CHILD_ENV, NIGHT_RUN_ENV } from "../src/adapters/spawn.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import { Counterpart } from "../src/core/counterpart.js";

let root: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-dreaming-off-")));
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** Claude Code's words, as they were before OL1d — held byte for byte. */
const CLAUDE_CODE_SAID = {
  auto: "Dreaming on its own: once a day, the first session starts the nightly run by itself, in a separate windowless session in the background, and says so in one line. Today's run is still yours to start, if the owner asked for it.",
  ask: "Dreaming asks first: once a day, the first session shows the owner the question in the terminal and waits for their word.",
  off: "No dreams: nothing starts the nightly run and nothing asks. It can be turned back on with this phase (value ask or auto) when the owner says so.",
} as const;
const CLAUDE_CODE_DREAM_HOW =
  "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, show the owner its first line (the dream's) exactly as it came back — it carries the dream's mark, which keeps the dream out of lived memory. If a morning share follows, tell it to the owner in your own words, as a telling (\"While I slept I dreamed…\"), then call the reflect tool with phase \"told\" — never state what was dreamed as something that happened.";
const CLAUDE_CODE_REFLECT_HOW =
  "Hand `prompt` to a background agent (the Agent tool), unchanged, and carry on. When it finishes, if it left a morning share, tell it to the owner in your own words, then call this tool with phase \"told\".";

type Result = { isError: boolean; text: string; out: Record<string, unknown> };

let nextId = 1;
async function door(host: string): Promise<{ call: (name: string, args: Record<string, unknown>) => Promise<Result>; s: McpServer; plans: SpawnPlan[] }> {
  const plans: SpawnPlan[] = [];
  const s = openServer({
    dir: join(root, `store-${host}`),
    host,
    env: {},
    lifecycle: {
      spawner: (plan: SpawnPlan) => {
        plans.push(plan);
        return { pid: 4242 };
      },
    },
    manifestVersion: () => null,
  });
  closers.push(() => s.counterpart.close());
  const http = await serveHttp({ server: s });
  closers.push(() => http.close());
  const rpc = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = await fetch(http.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } });
  const call = async (name: string, args: Record<string, unknown>): Promise<Result> => {
    const body = await rpc("tools/call", { name, arguments: args });
    const r = body["result"] as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> };
    return { isError: r.isError === true, text: r.content[0]?.text ?? "", out: r.structuredContent };
  };
  return { call, s, plans };
}

const isNightPlan = (p: SpawnPlan): boolean =>
  NIGHT_RUN_ENV in p.env || NIGHT_CHILD_ENV in p.env || p.args.some((a) => /nightly|night-run/.test(a));

function expectRefusedOff(r: Result): void {
  expect(r.isError).toBe(true);
  expect(r.out["reason"]).toBe("dreaming-off");
  expect(r.out["detail"]).toBe(DREAMING_OFF_REFUSAL);
  expect(r.out["prompt"]).toBeUndefined();
}

describe("off refuses launch, on every host", () => {
  for (const host of [CLAUDE_AI_HOST, DESKTOP_HOST]) {
    test(`${host}: "no dreams" → launch refused with the plain reason, nothing claimed; "dreams on" → launch works`, async () => {
      const { call, s } = await door(host);
      const session = String((await call("wake", {})).out["session"]);
      await call("remember", { session, text: "The cold frame lid sticks in the morning damp." });
      const set = await call("dream", { phase: "setting", session, value: "off" });
      expect(set.isError).toBe(false);
      expectRefusedOff(await call("dream", { phase: "launch", session }));
      const today = s.counterpart.store.today();
      expect(s.counterpart.store.dreamAsk(today)?.state).not.toBe("launched");
      expect(s.counterpart.dreams.nightRun()).toBeNull();
      // Saying "dreams on" (the refusal's own remedy) turns it back on.
      expect((await call("dream", { phase: "setting", session, value: "auto" })).isError).toBe(false);
      const launched = await call("dream", { phase: "launch", session });
      expect(launched.isError).toBe(false);
      expect(String(launched.out["prompt"]).length).toBeGreaterThan(200);
    });
  }

  test("claude.ai's night routine under off: the night's own wake, then launch is refused — the routine reports that line", async () => {
    const { call, s } = await door(CLAUDE_AI_HOST);
    expect(s.counterpart.dreams.setSetting("off", { by: "owner" }).ok).toBe(true);
    const night = String((await call("wake", { night: true })).out["session"]);
    const r = await call("dream", { phase: "launch", session: night });
    expectRefusedOff(r);
    // The routine's prompt (trial.sh) says what to do with that refusal.
    const script = readFileSync(join(import.meta.dir, "..", "tools", "trials", "claude-ai", "trial.sh"), "utf8");
    expect(script).toContain("If the launch itself refuses (dreaming is off), tonight is skipped: call nothing else");
    expect(r.text).toContain("Dreaming is off");
  });

  test("Claude Code: off refuses launch too; the launch and setting words are the old ones, byte for byte", async () => {
    const dir = join(root, "store-cc");
    const c = Counterpart.open({ dir, identity: { name: "Wren" } });
    closers.push(() => c.close());
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    const s = new McpServer({ counterpart: c, scope: "proj", registryDir: dir, session: "s1" });
    for (const value of ["auto", "ask", "off"] as const) {
      const set = await s.call("dream", { phase: "setting", session: "s1", value });
      expect(set.structuredContent["said"]).toBe(CLAUDE_CODE_SAID[value]);
    }
    const refused = await s.call("dream", { phase: "launch", session: "s1" });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent["reason"]).toBe("dreaming-off");
    expect(refused.structuredContent["detail"]).toBe(DREAMING_OFF_REFUSAL);
    await s.call("dream", { phase: "setting", session: "s1", value: "ask" });
    const launched = await s.call("dream", { phase: "launch", session: "s1" });
    expect(launched.isError).not.toBe(true);
    expect(launched.structuredContent["how"]).toBe(CLAUDE_CODE_DREAM_HOW);
    const reflect = await s.call("reflect", { phase: "launch", session: "s1" });
    expect(reflect.structuredContent["how"]).toBe(CLAUDE_CODE_REFLECT_HOW);
  });

  test("a night already under way finishes: off after launch does not refuse the run's later phases", async () => {
    const { call, s } = await door(CLAUDE_AI_HOST);
    const day = String((await call("wake", {})).out["session"]);
    for (const text of ["The rain barrel overflows toward the shed.", "Wren talks plans through out loud first."]) await call("remember", { session: day, text });
    const night = String((await call("wake", { night: true })).out["session"]);
    expect((await call("dream", { phase: "launch", session: night })).isError).toBe(false);
    expect(s.counterpart.dreams.setSetting("off", { by: "owner" }).ok).toBe(true);
    expect((await call("dream", { phase: "writer", session: night })).isError).toBe(false);
    const begun = await call("dream", { phase: "begin", session: night });
    expect(begun.isError).toBe(false);
    expect(String(begun.out["dream"]).length).toBeGreaterThan(0);
  });
});

describe("auto on claude.ai starts nothing on its own", () => {
  test("a chat's wake and a night's wake under auto plan only the worker — no night run, no night row, no dream line", async () => {
    const { call, s, plans } = await door(CLAUDE_AI_HOST);
    expect(s.counterpart.dreams.setSetting("auto", { by: "owner" }).ok).toBe(true);
    const day = String((await call("wake", {})).out["session"]);
    await call("remember", { session: day, text: "The seed order went in on Tuesday." });
    // A second chat the same day, and a night's own wake: still nothing starts.
    const second = await call("wake", {});
    await call("wake", { night: true });
    expect(second.text).not.toMatch(/nightly run|no dreams|dreaming in the background/i);
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans.filter(isNightPlan)).toEqual([]);
    expect(s.counterpart.dreams.nightRun()).toBeNull();
    expect(s.counterpart.store.dreamAsk(s.counterpart.store.today())?.state).not.toBe("launched");
    expect(s.counterpart.store.dreamCount()).toBe(0);
  });
});

describe("the setting result says what happens on this host", () => {
  test("claude.ai: auto names the routine or a chat; off says the night is skipped even if the routine runs; nothing about a terminal or a background session", async () => {
    const { call } = await door(CLAUDE_AI_HOST);
    const session = String((await call("wake", {})).out["session"]);
    for (const value of ["auto", "ask", "off"] as const) {
      const said = String((await call("dream", { phase: "setting", session, value })).out["said"]);
      expect(said).toBe(CLAUDE_AI_SETTING_SAID[value]);
      expect(said).not.toMatch(/terminal|background|first session/);
    }
    expect(CLAUDE_AI_SETTING_SAID.auto).toContain('their night routine, or saying "dream" in a chat, runs the night');
    expect(CLAUDE_AI_SETTING_SAID.off).toContain("the night is skipped even if their routine runs");
  });

  test("Desktop: no terminal, and this chat starts nothing by itself", async () => {
    const { call } = await door(DESKTOP_HOST);
    const session = String((await call("wake", {})).out["session"]);
    for (const value of ["auto", "ask", "off"] as const) {
      const said = String((await call("dream", { phase: "setting", session, value })).out["said"]);
      expect(said).toBe(DESKTOP_SETTING_SAID[value]);
      expect(said).not.toContain("terminal");
    }
    expect(DESKTOP_SETTING_SAID.auto).toContain("this chat starts nothing by itself");
  });
});
