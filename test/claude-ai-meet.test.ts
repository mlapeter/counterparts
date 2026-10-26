/**
 * THE FIRST MEETING FROM A COLD CLAUDE.AI CHAT (2026-10-26, OL1b item 7), through
 * the HTTP door (`adapters/remote/http.ts`): a store that starts as a new
 * install does (`beginNewInstall`) offers the meeting on the first wake, the
 * `meet` script and its steps run over the wire with the wake's session, and
 * the words fit a chat on the web — no "on this computer", no store path, no
 * console command, no dream ask — while every other host's words are unchanged.
 *
 * And the finding it pins: a store this door opens fresh, that nobody started
 * as a new install, offers no meeting at all (remote NOTES).
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after; no worker
 * (a stub spawner); every answer is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import { Counterpart } from "../src/core/counterpart.js";
import { MEET_LINE_OPEN, RETENTION_LINE, WEB_RETENTION_LINE, WEB_UNINSTALL, beginNewInstall, finishText, meetingInstructions, offerLine } from "../src/core/onboarding.js";

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-claude-ai-meet-")));
  dir = join(root, "store");
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

let nextId = 1;
async function door(): Promise<string> {
  const s = openServer({ dir, host: CLAUDE_AI_HOST, env: {}, lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) }, manifestVersion: () => null });
  closers.push(() => s.counterpart.close());
  const http = await serveHttp({ server: s });
  closers.push(() => http.close());
  return http.url;
}

async function call(url: string, name: string, args: Record<string, unknown>): Promise<{ text: string; structured: Record<string, unknown>; isError: boolean }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const r = ((await res.json()) as { result: { content: { text: string }[]; structuredContent: Record<string, unknown>; isError?: boolean } }).result;
  return { text: r.content[0]?.text ?? "", structured: r.structuredContent, isError: r.isError === true };
}

describe("a cold first chat on claude.ai meets", () => {
  test("offer on the first wake, the script and its steps over the wire, words for the web, done on the next wake", async () => {
    const c = Counterpart.open({ dir });
    beginNewInstall(c.store, { dreaming: false });
    c.close();
    const url = await door();

    const woke = await call(url, "wake", {});
    const session = String(woke.structured["session"]);
    expect(woke.text).toContain("meet=not_started");
    expect(woke.text).toContain(MEET_LINE_OPEN);
    expect(woke.text).toContain("They added Counterparts, a memory connector, to be known");
    expect(woke.text).not.toContain("installed a memory plugin");

    const script = await call(url, "meet", { session });
    expect(script.isError).toBe(false);
    expect(script.text).toContain("COUNTERPARTS: THE FIRST MEETING.");
    expect(script.text).toContain("from one conversation to the next");
    expect(script.text).not.toContain("on this computer");
    expect(script.text).not.toContain(root);
    expect(script.text).not.toContain("counterparts uninstall");
    expect(script.text).toContain(WEB_RETENTION_LINE);
    expect(script.text).toContain(WEB_UNINSTALL);
    // No folder question in a chat.
    expect(script.text).not.toContain("Where I remember");

    expect((await call(url, "meet", { session, step: "name", answer: "Wren" })).structured).toMatchObject({ recorded: "name", stored: 1 });
    expect((await call(url, "meet", { session, step: "work", answer: "Wren is restoring an old greenhouse." })).structured).toMatchObject({ recorded: "work", stored: 1 });
    expect((await call(url, "meet", { session, step: "style", answer: "friendly" })).structured).toMatchObject({ recorded: "style" });
    const done = await call(url, "meet", { session, step: "done" });
    expect(done.structured).toMatchObject({ recorded: "done", meet: "done" });
    expect(done.text).toContain(`session: ${session}`);
    expect(done.text).not.toContain("I'll ask to have my first dream");

    const again = await call(url, "wake", {});
    expect(again.text).not.toContain(MEET_LINE_OPEN);
    expect(again.text).toContain("meet=done");
  });

  test("with dreaming on, the first dream is the routine's, never an ask", () => {
    const text = finishText({ name: "Wren", dreaming: "ask", web: true, session: "s1", sidebar: false });
    expect(text).toContain("when the nightly routine runs, I'll have my first dream");
    expect(text).not.toContain("I'll ask to have my first dream");
    // Every other host: unchanged.
    expect(finishText({ name: "Wren", dreaming: "ask", session: "s1", sidebar: false })).toContain("I'll ask to have my first dream");
  });

  test("every other host's words are unchanged", () => {
    const base = { name: null, uninstall: "run counterparts uninstall in a terminal", home: "~/.counterparts", dreaming: "ask" as const, folders: false, plugin: false, state: "offered" as const };
    const desk = meetingInstructions(base);
    expect(desk).toContain("stays on this computer");
    expect(desk).toContain(RETENTION_LINE);
    expect(desk).toContain("removing it: run counterparts uninstall in a terminal.");
    expect(offerLine("not_started")).toContain("They installed a memory plugin to be known");
  });

  test("the finding: a store this door opens fresh, never started as a new install, offers no meeting", async () => {
    const url = await door();
    const woke = await call(url, "wake", {});
    expect(woke.text).toContain("meet=done");
    expect(woke.text).not.toContain(MEET_LINE_OPEN);
  });
});
