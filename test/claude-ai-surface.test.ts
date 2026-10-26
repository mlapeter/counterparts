/**
 * THE CLAUDE.AI SURFACE (2026-10-26, OL1b items 2, 4, 5), through the HTTP door
 * (`adapters/remote/http.ts`) — `fetch` against a server on 127.0.0.1:
 *
 *   2. claude.ai's wake: one short session line, the clock and today's plain
 *      reminders, then the wake with "Coming up" and "Still open" moved up
 *      whole; no dream line on this host even when the day's ask is due; no
 *      "same you" line while no host shares the store. Desktop's wake keeps
 *      its words.
 *   4. The tool words: no claude.ai description tells Claude to call a tool
 *      unasked; the chat's summaries carry the words tool search matches;
 *      every other host's descriptions are untouched; only Memory status is
 *      read-only.
 *   5. The "Wake Counterparts" prompt in `prompts/list` and `prompts/get`.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test, removed after; no
 * worker is started (a stub spawner); every word is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { CLAUDE_AI_TOOLS, TOOLS, openServer, renderDescription, toolDefinitions } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { CLAUDE_AI_WORDS } from "../src/adapters/mcp/tools.js";
import { chatLanesFirst, claudeAiSessionLine, sameYouLine } from "../src/adapters/mcp/chat-wake.js";
import { CLAUDE_AI_DREAM_NOTE, CLAUDE_AI_START_PROMPT, DESKTOP_DREAM_NOTE, START_PROMPT } from "../src/adapters/mcp/server-words.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import type { RunningHttp } from "../src/adapters/remote/http.js";
import { FRAMING } from "../src/core/self/index.js";

let root: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-claude-ai-surface-")));
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

function server(host: string, now?: () => number): McpServer {
  const s = openServer({
    dir: join(root, `store-${host}`),
    host,
    env: {},
    lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
    manifestVersion: () => null,
    ...(now === undefined ? {} : { now }),
  });
  closers.push(() => s.counterpart.close());
  return s;
}

async function door(host: string = CLAUDE_AI_HOST, now?: () => number): Promise<{ http: RunningHttp; s: McpServer }> {
  const s = server(host, now);
  const http = await serveHttp({ server: s });
  closers.push(() => http.close());
  await rpc(http.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } });
  return { http, s };
}

let nextId = 1;
async function rpc(url: string, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function tool(url: string, name: string, args: Record<string, unknown>): Promise<{ text: string; structured: Record<string, unknown> }> {
  const body = await rpc(url, "tools/call", { name, arguments: args });
  const r = body["result"] as { content: { text: string }[]; structuredContent: Record<string, unknown> };
  return { text: r.content[0]?.text ?? "", structured: r.structuredContent };
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** A store with a page, an open thread, a plain reminder due today and a nearby memory, published. */
async function lived(url: string, s: McpServer): Promise<void> {
  const session = String((await tool(url, "wake", {})).structured["session"]);
  await tool(url, "remember", { session, kind: "person", title: "Quiet mornings", text: "Wren likes quiet mornings before any planning." });
  await tool(url, "remember", { session, kind: "fact", title: "Seed order", text: "The seed order goes in today.", eventDate: today(), remind: "plain" });
  await tool(url, "remember", { session, kind: "fact", title: "Trellis height?", text: "Asked Wren how tall the bean trellis should be.", unresolved: true });
  await tool(url, "self_page", { session, body: "## Core\nI keep the garden's notes with Wren.\n\n## Lately\nStill open: a quiet week, nothing pressing." });
  s.counterpart.rebrief({ budgetBytes: 9000, at: today() });
}

describe("2. claude.ai's wake, through the door", () => {
  test("one short session line; the clock and the plain reminder; Coming up and Still open first under the framing line; nothing reworded", async () => {
    const { http, s } = await door();
    await lived(http.url, s);
    const woke = await tool(http.url, "wake", {});
    const session = String(woke.structured["session"]);
    const text = woke.text;
    const lines = text.split("\n");
    expect(lines[0]).toBe(claudeAiSessionLine(session));
    expect(text).not.toContain("Pass session:");
    expect(text).not.toContain("on session_end, chapter, dream and reflect");
    expect(lines[2]?.startsWith("Now: ")).toBe(true);
    expect(text).toContain("Plain reminder (they asked to be told)");
    const framing = lines.indexOf(FRAMING.context);
    const coming = lines.indexOf(FRAMING.horizon);
    const open = lines.indexOf(FRAMING.threads);
    const who = lines.indexOf(FRAMING.identity);
    expect(framing).toBeGreaterThan(0);
    expect(coming).toBe(framing + 2);
    expect(open).toBeGreaterThan(coming);
    expect(who).toBeGreaterThan(open);
    // The page's own "Still open:" words stay inside the page.
    expect(text).toContain("Still open: a quiet week, nothing pressing.");
    // Every line of the composed wake is still there, once.
    expect(text.match(/Seed order|seed order/g)?.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain("Asked Wren how tall the bean trellis should be.");
    expect(text).toContain("Wren likes quiet mornings before any planning.");
    expect(text).toContain("<!-- counterparts:wake/end");
    expect(text).not.toContain("\n\n\n");
    // No "same you" line: no host shares this store.
    expect(text).not.toContain("same you");
    // The payload is as before.
    expect(woke.structured).toMatchObject({ session, host: CLAUDE_AI_HOST, wake: text });
  });

  test("no dream line on claude.ai, even with the day's ask due — and it is left unclaimed", async () => {
    const at = new Date("2026-09-26T12:00:00").getTime();
    const { http, s } = await door(CLAUDE_AI_HOST, () => at);
    const c = s.counterpart;
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    for (const body of ["The cold frame lid sticks in the morning damp.", "Wren talks plans through out loud first.", "I say what I do not know before I guess.", "The rain barrel overflows toward the shed."]) {
      const day = c.store.livedDay();
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    }
    expect(c.dreams.setSetting("ask", { by: "owner" }).ok).toBe(true);
    const text = (await tool(http.url, "wake", {})).text;
    expect(text).not.toContain('phase "launch"');
    expect(text).not.toContain(CLAUDE_AI_DREAM_NOTE);
    // Desktop, on the same kind of store, still says it.
    const d = await door(DESKTOP_HOST, () => at);
    const dc = d.s.counterpart;
    dc.store.advanceClock("2026-09-10");
    for (let day = 11; day <= 20; day += 1) dc.store.advanceClock(`2026-09-${String(day)}`);
    for (const body of ["The cold frame lid sticks in the morning damp.", "Wren talks plans through out loud first.", "I say what I do not know before I guess.", "The rain barrel overflows toward the shed."]) {
      const lived = dc.store.livedDay();
      dc.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: lived, lastUsedDay: lived } });
    }
    expect(dc.dreams.setSetting("ask", { by: "owner" }).ok).toBe(true);
    const desk = (await tool(d.http.url, "wake", {})).text;
    expect(desk).toContain(DESKTOP_DREAM_NOTE);
    expect(desk.startsWith("Counterparts session for this chat: ")).toBe(true);
  });

  test("chatLanesFirst: lanes move whole; a heading inside the page stays; a wake without the framing line is untouched", () => {
    const wake = [
      "<!-- counterparts:wake meet=done -->",
      FRAMING.context,
      "",
      FRAMING.identity,
      "## Core",
      "Still open:",
      "",
      "Coming up:",
      "(End of my page.)",
      "",
      FRAMING.threads,
      "- Oct 26 · one",
      "(2 more open, kept quietly)",
      "",
      FRAMING.hints,
      "- Oct 26 · two",
      "",
      "Arriving:",
      "- due Oct 27 · three",
      "",
      "<!-- counterparts:wake/end -->",
    ].join("\n");
    const out = chatLanesFirst(wake).split("\n");
    expect(out.slice(0, 9)).toEqual([
      "<!-- counterparts:wake meet=done -->",
      FRAMING.context,
      "",
      "Arriving:",
      "- due Oct 27 · three",
      "",
      FRAMING.threads,
      "- Oct 26 · one",
      "(2 more open, kept quietly)",
    ]);
    expect(out.slice(9)).toEqual(["", FRAMING.identity, "## Core", "Still open:", "", "Coming up:", "(End of my page.)", "", FRAMING.hints, "- Oct 26 · two", "", "<!-- counterparts:wake/end -->"]);
    expect(out.length).toBe(wake.split("\n").length);
    expect(chatLanesFirst("No briefing has been composed yet.")).toBe("No briefing has been composed yet.");
  });

  test("the same-you seam: nothing for no shared host, one line for one", () => {
    expect(sameYouLine("Wren", [])).toBeNull();
    expect(sameYouLine("Wren", ["Claude Code"])).toBe("You are the same you who works with Wren in Claude Code: one memory.");
  });
});

describe("4. the tool words for chat", () => {
  test("no claude.ai description tells Claude to call a tool unasked; wake's words are for tool search", async () => {
    const { http } = await door();
    const list = ((await rpc(http.url, "tools/list"))["result"] as { tools: Record<string, unknown>[] }).tools;
    for (const t of list) {
      const d = String(t["description"]);
      expect(d).not.toMatch(/call (this|it) first/i);
      expect(d).not.toContain("in every conversation");
    }
    // The chat's own words name no ask claude.ai never makes (the negative
    // examples are every host's, and stay so).
    for (const spec of CLAUDE_AI_TOOLS) {
      for (const words of [spec.summary, spec.admission]) {
        if (["remember", "session_end", "chapter", "wake"].includes(spec.name)) {
          expect(words).not.toContain("end-of-session ask");
          expect(words).not.toContain("boundary ask");
        }
      }
    }
    const wake = String(list[0]?.["description"]);
    for (const word of ["conversation", "memory", "Start"]) expect(wake).toContain(word);
    const by = Object.fromEntries(list.map((t) => [String(t["name"]), String(t["description"])]));
    expect(by["remember"]?.startsWith("Save to long-term memory")).toBe(true);
    expect(by["recall"]?.startsWith("Search your long-term memory")).toBe(true);
    expect(by["chapter"]?.startsWith("Write a chapter of this conversation")).toBe(true);
    expect(by["status"]?.startsWith("Memory status:")).toBe(true);
  });

  test("only summary and admission change; negatives and privileges are every host's; Claude Code's and Desktop's words are untouched", () => {
    for (const spec of CLAUDE_AI_TOOLS.slice(1)) {
      const base = TOOLS.find((t) => t.name === spec.name);
      expect(base).toBeDefined();
      expect(spec.negativeExamples).toEqual(base?.negativeExamples ?? []);
      expect(spec.privileges).toEqual(base?.privileges ?? []);
      expect(spec.annotations).toEqual(base?.annotations as never);
      if (CLAUDE_AI_WORDS[spec.name as keyof typeof CLAUDE_AI_WORDS] === undefined) {
        expect(renderDescription(spec)).toBe(renderDescription(base as never));
      }
    }
    for (const spec of TOOLS) expect(renderDescription(spec)).not.toContain("Save to long-term memory, in the moment");
    expect(toolDefinitions(false).map((t) => t["description"])).toEqual(TOOLS.map((t) => renderDescription(t)));
  });

  test("annotations: on claude.ai only Memory status is read-only (readOnly honesty is open; recall and wake record use)", () => {
    const readOnly = toolDefinitions(CLAUDE_AI_HOST)
      .filter((t) => (t["annotations"] as { readOnlyHint: boolean }).readOnlyHint)
      .map((t) => (t["annotations"] as { title: string }).title);
    expect(readOnly).toEqual(["Memory status"]);
  });
});

describe("5. the Wake Counterparts prompt, through the door", () => {
  test("prompts/list offers it on claude.ai; prompts/get returns its text; Desktop keeps its own", async () => {
    const { http } = await door();
    const listed = ((await rpc(http.url, "prompts/list"))["result"] as { prompts: Record<string, unknown>[] }).prompts;
    expect(listed).toEqual([{ name: "wake-counterparts", title: "Wake Counterparts", description: CLAUDE_AI_START_PROMPT.description, arguments: [] }]);
    const got = (await rpc(http.url, "prompts/get", { name: "wake-counterparts" }))["result"] as { messages: { role: string; content: { text: string } }[] };
    expect(got.messages[0]?.role).toBe("user");
    expect(got.messages[0]?.content.text).toContain("call the counterparts wake tool");
    expect(got.messages[0]?.content.text).toContain("keep the session id");
    const wrong = await rpc(http.url, "prompts/get", { name: START_PROMPT.name });
    expect(wrong["error"]).toBeDefined();

    const d = await door(DESKTOP_HOST);
    const desk = ((await rpc(d.http.url, "prompts/list"))["result"] as { prompts: Record<string, unknown>[] }).prompts;
    expect(desk.map((p) => p["name"])).toEqual([START_PROMPT.name]);
  });
});
