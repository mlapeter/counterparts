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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import { Counterpart } from "../src/core/counterpart.js";
import { MEET_LINE_OPEN, ORIGIN_WITHOUT_ANSWER, RETENTION_LINE, WEB_RETENTION_LINE, WEB_UNINSTALL, beginNewInstall, finishText, meetingInstructions, offerLine } from "../src/core/onboarding.js";

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

  test("H1: the misread `started` right after Now gets plain words, not answer-required; the meeting goes on through `origin`", async () => {
    const c = Counterpart.open({ dir });
    beginNewInstall(c.store, { dreaming: false });
    c.close();
    const url = await door();
    const session = String((await call(url, "wake", {})).structured["session"]);
    const script = await call(url, "meet", { session });
    expect(script.text).toContain("Now → no meet call: go on to the next step.");
    expect(script.text).toContain('origin: "What got you started building things?"');

    // What claude.ai's Claude sent on 2026-10-28, after "Now (about 5 minutes)".
    const misread = await call(url, "meet", { session, step: "started" });
    expect(misread.isError).toBe(true);
    expect(misread.structured["reason"]).toBe("begins-without-step");
    expect(misread.structured["reason"]).not.toBe("answer-required");
    expect(misread.structured["detail"]).toBe(ORIGIN_WITHOUT_ANSWER);
    expect(misread.text).toContain("the meeting begins with meet and no step");
    expect((await call(url, "meet", { session, step: "origin" })).structured["reason"]).toBe("begins-without-step");

    expect((await call(url, "meet", { session, step: "name", answer: "Wren" })).structured).toMatchObject({ recorded: "name", stored: 1 });
    expect((await call(url, "meet", { session, step: "origin", answer: "Wren started building things with a broken radio." })).structured).toMatchObject({ recorded: "origin", stored: 1 });
    expect((await call(url, "meet", { session, step: "started", answer: "Wren also fixed bikes as a kid." })).structured).toMatchObject({ recorded: "origin", stored: 1 });
    expect((await call(url, "meet", { session, step: "done" })).structured).toMatchObject({ recorded: "done", meet: "done" });
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

  // Pinned, not fixed: claude.ai is a chat host (`desktop`), so the close already leaves the sidebar out.
  test("the close names no sidebar on claude.ai, though the machine serving it has one (review of #645)", async () => {
    // A counterparts-sidebar plugin recorded where Claude Code would record it, in a moved config dir.
    const config = join(root, "claude-config");
    mkdirSync(join(config, "plugins"), { recursive: true });
    writeFileSync(join(config, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "counterparts-sidebar@counterparts": [{ installPath: "" }] } }));
    const env = { CLAUDE_CONFIG_DIR: config };
    const closes: Record<string, string> = {};
    for (const host of [CLAUDE_AI_HOST, undefined]) {
      const sub = join(root, `store-${host ?? "code"}`);
      const c = Counterpart.open({ dir: sub });
      beginNewInstall(c.store, { dreaming: false });
      c.close();
      const s = openServer({ dir: sub, ...(host === undefined ? {} : { host }), env, lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) }, manifestVersion: () => null });
      closers.push(() => s.counterpart.close());
      const session = String((await s.call("wake", {})).structuredContent["session"]);
      await s.call("meet", { session });
      closes[host ?? "code"] = (await s.call("meet", { session, step: "done" })).content[0]?.text ?? "";
    }
    expect(closes[CLAUDE_AI_HOST]).not.toContain("/counterparts shows the memory sidebar");
    // The same machine, Claude Code's host: the sidebar line, as before.
    expect(closes["code"]).toContain("/counterparts shows the memory sidebar");
  });

  test("the finding: a store this door opens fresh, never started as a new install, offers no meeting", async () => {
    const url = await door();
    const woke = await call(url, "wake", {});
    expect(woke.text).toContain("meet=done");
    expect(woke.text).not.toContain(MEET_LINE_OPEN);
  });
});
