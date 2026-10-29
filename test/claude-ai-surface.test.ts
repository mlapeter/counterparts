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
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { CLAUDE_AI_TOOLS, TOOLS, openServer, renderDescription, toolDefinitions } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { CLAUDE_AI_WORDS, DESKTOP_TOOLS } from "../src/adapters/mcp/tools.js";
import { chatLanesFirst, claudeAiSessionLine, sameYouLine } from "../src/adapters/mcp/chat-wake.js";
import { CLAUDE_AI_DREAM_LAUNCH_HOW, CLAUDE_AI_DREAM_NOTE, CLAUDE_AI_REFLECT_LAUNCH_HOW, CLAUDE_AI_START_PROMPT, DESKTOP_DREAM_LAUNCH_HOW, DESKTOP_DREAM_NOTE, DESKTOP_REFLECT_LAUNCH_HOW, START_PROMPT } from "../src/adapters/mcp/server-words.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import type { RunningHttp } from "../src/adapters/remote/http.js";
import { FRAMING } from "../src/core/self/index.js";
import { openDb } from "../src/core/store/db.js";

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

// A fixed local noon, and its date: the server dates "today" in the store's
// zone, so a UTC date (toISOString) is tomorrow every evening west of UTC.
const NOON = new Date("2026-09-26T12:00:00").getTime();
const noon = (): number => NOON;
const today = (): string => "2026-09-26";

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
    const { http, s } = await door(CLAUDE_AI_HOST, noon);
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

  test("chatLanesFirst: a lane collapsed to its one counting line moves up too (an overdue item is a due item)", () => {
    const collapsed = `${FRAMING.horizon} 1 — none due today, 1 overdue; recall ids: mem_a1b2c3`;
    const wake = [
      FRAMING.context,
      "",
      FRAMING.identity,
      "## Core",
      "(End of my page.)",
      "",
      FRAMING.threads,
      "- Oct 26 · one",
      "",
      FRAMING.hints,
      "- Oct 26 · two",
      "",
      collapsed,
      "",
      "<!-- counterparts:wake/end -->",
    ].join("\n");
    const out = chatLanesFirst(wake).split("\n");
    expect(out.slice(0, 6)).toEqual([FRAMING.context, "", collapsed, "", FRAMING.threads, "- Oct 26 · one"]);
    expect(out.length).toBe(wake.split("\n").length);
    expect([...out].sort()).toEqual([...wake.split("\n")].sort());
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

  test("summary and admission change (and dream's negatives); privileges are every host's; Claude Code's and Desktop's words are untouched", () => {
    for (const spec of CLAUDE_AI_TOOLS.slice(1)) {
      const base = TOOLS.find((t) => t.name === spec.name);
      expect(base).toBeDefined();
      const own = CLAUDE_AI_WORDS[spec.name as keyof typeof CLAUDE_AI_WORDS]?.negativeExamples;
      expect(spec.negativeExamples).toEqual(own ?? base?.negativeExamples ?? []);
      expect(spec.negativeExamples.length).toBeGreaterThanOrEqual(1);
      for (const negative of spec.negativeExamples) expect(negative.toLowerCase()).toContain("do not");
      expect(spec.privileges).toEqual(base?.privileges ?? []);
      // The same annotations, but a chat copy is never read-only: it takes `session` (H1, `tools.ts#chatAnnotations`).
      const b = base?.annotations;
      expect(spec.annotations).toEqual((b?.readOnlyHint === true ? { ...b, readOnlyHint: false, idempotentHint: false } : b) as never);
      if (CLAUDE_AI_WORDS[spec.name as keyof typeof CLAUDE_AI_WORDS] === undefined) {
        expect(renderDescription(spec)).toBe(renderDescription(base as never));
      }
    }
    for (const spec of TOOLS) expect(renderDescription(spec)).not.toContain("Save to long-term memory, in the moment");
    expect(toolDefinitions(false).map((t) => t["description"])).toEqual(TOOLS.map((t) => renderDescription(t)));
  });

  // H1 (2026-10-29): the honesty question, closed by the door test below. Whether claude.ai skips its
  // per-tool permission prompt for a read-only tool is NOT tested anywhere, and nothing here claims it.
  test("annotations: nothing is read-only on claude.ai or Desktop (a named call touches the session record); Claude Code's status is", () => {
    const readOnlyOn = (host: boolean | string): string[] =>
      toolDefinitions(host)
        .filter((t) => (t["annotations"] as { readOnlyHint: boolean }).readOnlyHint)
        .map((t) => (t["annotations"] as { title: string }).title);
    expect(readOnlyOn(CLAUDE_AI_HOST)).toEqual([]);
    expect(readOnlyOn(DESKTOP_HOST)).toEqual([]);
    // recall (its use credit), wake, and self_page (it has a write mode) are never read-only anywhere.
    expect(readOnlyOn(false)).toEqual(["Memory status"]);
  });
});

describe("H1: Memory status's readOnlyHint is true to what a status call does", () => {
  /** Every row of every table in the store's two databases, and every other file under it, as text. */
  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of [join(dir, "counterparts.sqlite"), join(dir, "cache", "cache.sqlite")]) {
      const db = openDb(file);
      try {
        for (const { name } of db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) {
          out.set(`${file}#${name}`, JSON.stringify(db.all(`SELECT * FROM "${name}" ORDER BY rowid`)));
        }
      } finally {
        db.close();
      }
    }
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (!/\.sqlite(-wal|-shm)?$/.test(n)) out.set(f, readFileSync(f, "utf8"));
      }
    };
    walk(dir);
    return out;
  }
  const changed = (a: Map<string, string>, b: Map<string, string>): string[] =>
    [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).map((k) => k.replace(root, "<root>"));

  test("through the claude.ai door: a status call naming no session changes no row and no file; one naming it touches the session record, so the chat copy is not read-only", async () => {
    const { http, s } = await door();
    const session = String(((await rpc(http.url, "tools/call", { name: "wake", arguments: {} }))["result"] as { structuredContent: Record<string, unknown> }).structuredContent["session"]);
    await rpc(http.url, "tools/call", { name: "remember", arguments: { session, text: "Wren keeps bees on the roof of the library." } });
    const dir = s.counterpart.store.dir;
    const before = snapshot(dir);
    const r = (await rpc(http.url, "tools/call", { name: "status", arguments: {} }))["result"] as { isError?: boolean; structuredContent: Record<string, unknown> };
    expect(r.isError === true).toBe(false);
    expect(typeof r.structuredContent["live"]).toBe("number");
    // The snapshot sees what a write would touch: the memory, the session's registry record.
    expect([...before.keys()].some((k) => k.includes(`sessions/${session}.json`))).toBe(true);
    expect(before.get(`${join(dir, "counterparts.sqlite")}#memories`)).toContain("Wren keeps bees");
    expect(changed(before, snapshot(dir))).toEqual([]);
    // The call the chat copy asks for: `session` named (its schema has it; the result's bindNote asks for it).
    expect(String(r.structuredContent["bindNote"])).toContain('pass the id wake gave this conversation');
    const named = snapshot(dir);
    await rpc(http.url, "tools/call", { name: "status", arguments: { session } });
    expect(changed(named, snapshot(dir))).toEqual([`<root>/store-claude-ai/sessions/${session}.json`]);
    const status = ((await rpc(http.url, "tools/list"))["result"] as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools.find((t) => t.name === "status");
    expect(status?.annotations.readOnlyHint).toBe(false);
  });

  test("Claude Code's status, which takes no session, changes no row and no file, and stays read-only", async () => {
    const s = server("claude-code");
    await s.call("remember", { text: "Wren keeps bees on the roof of the library." });
    const dir = s.counterpart.store.dir;
    const before = snapshot(dir);
    expect(before.get(`${join(dir, "counterparts.sqlite")}#memories`)).toContain("Wren keeps bees");
    expect((await s.call("status", {})).isError === true).toBe(false);
    expect(changed(before, snapshot(dir))).toEqual([]);
    expect((toolDefinitions(false).find((t) => t["name"] === "status")?.["annotations"] as { readOnlyHint: boolean }).readOnlyHint).toBe(true);
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

describe("a night's own wake (night: true), through the door", () => {
  const SHARE = "ZQSHARE The cold frame kept coming back to me.";

  /** A routine's night: its wake, a memory, the reflection with a share. Returns the reflection's id. */
  async function aNight(url: string, wakeArgs: Record<string, unknown>): Promise<string> {
    const night = String((await tool(url, "wake", wakeArgs)).structured["session"]);
    const cite = String((await tool(url, "remember", { session: night, text: "Wren and I talked about the cold frame lid tonight." })).structured["id"]);
    const begun = (await tool(url, "reflect", { phase: "begin", session: night })).structured;
    const rid = String(begun["reflection"]);
    const done = (await tool(url, "reflect", { phase: "finish", session: night, reflection: rid, entry: "The cold frame conversation stays with me.", cites: [cite], share: { text: SHARE, cites: [cite] } })).structured;
    expect(typeof done["handBack"]).toBe("string");
    return rid;
  }

  test("a quiet day: the next night's wake carries nothing, and the next chat carries the share", async () => {
    const { http, s } = await door();
    const rid = await aNight(http.url, { night: true });
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("offered");
    // No chat all day; the routine wakes again for the next night.
    const nextNight = await tool(http.url, "wake", { night: true });
    expect(nextNight.text).not.toContain("ZQSHARE");
    expect(nextNight.text).not.toContain("never told");
    expect(nextNight.text).not.toContain("<counterparts-meet>");
    expect(s.counterpart.store.reflection(rid)?.share_state).toBe("offered");
    // The next chat carries it, first after the session line.
    const chat = await tool(http.url, "wake", {});
    expect(chat.text).toContain(SHARE);
    expect(chat.text.indexOf(SHARE)).toBeLessThan(chat.text.indexOf("Now:"));
    expect(s.counterpart.store.reflection(rid)).toMatchObject({ share_state: "carried", share_session: String(chat.structured["session"]) });
  });

  test("a night's wake still lets the routine dream: launch from the quiet wake's session hands back the run's prompt", async () => {
    const { http } = await door();
    const first = String((await tool(http.url, "wake", {})).structured["session"]);
    for (const text of ["The cold frame lid sticks in the morning damp.", "Wren talks plans through out loud first.", "The rain barrel overflows toward the shed."]) {
      await tool(http.url, "remember", { session: first, text });
    }
    const night = String((await tool(http.url, "wake", { night: true })).structured["session"]);
    const body = await rpc(http.url, "tools/call", { name: "dream", arguments: { phase: "launch", session: night } });
    const r = body["result"] as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(r.isError ?? false).toBe(false);
    expect(r.content[0]?.text.length ?? 0).toBeGreaterThan(200);
  });

  test("a night's wake claims no plain reminder: the day's chat still gets it", async () => {
    const { http } = await door(CLAUDE_AI_HOST, noon);
    const first = String((await tool(http.url, "wake", {})).structured["session"]);
    await tool(http.url, "remember", { session: first, kind: "fact", title: "Seed order", text: "The seed order goes in today.", eventDate: today(), remind: "plain" });
    const quiet = await tool(http.url, "wake", { night: true });
    expect(quiet.text).not.toContain("Plain reminder");
    const chat = await tool(http.url, "wake", {});
    expect(chat.text).toContain("Plain reminder (they asked to be told)");
  });
});

/**
 * THE NIGHT'S WORDS (2026-10-26, OL1c, from #647's review). The routine's own
 * prompt (`trial.sh prompt`, night prompt v2) tells the run to wake with
 * `night: true`, launch, and follow the returned prompt itself, here. claude.ai's
 * `dream` and `reflect` descriptions now say the same thing; every other host
 * keeps the shared words, which name the day's dream line and a background agent.
 */
describe("dream and reflect name the routine on claude.ai (OL1c)", () => {
  const SHARED = ["the day's dream line", "a background agent", "Do NOT run the dream yourself in this conversation"];
  const nightPrompt = (): string => {
    const script = readFileSync(join(import.meta.dir, "..", "tools", "trials", "claude-ai", "trial.sh"), "utf8");
    const m = /^NIGHT_PROMPT='(.*)'$/m.exec(script);
    expect(m).not.toBeNull();
    return (m?.[1] ?? "").replaceAll(`'"'"'`, "'");
  };

  test("tools/list as claude.ai: dream and reflect name the routine and none of the shared words that fight it", async () => {
    const { http } = await door();
    const list = ((await rpc(http.url, "tools/list"))["result"] as { tools: Record<string, unknown>[] }).tools;
    const by = Object.fromEntries(list.map((t) => [String(t["name"]), String(t["description"])]));
    const dream = by["dream"] ?? "";
    const reflect = by["reflect"] ?? "";
    for (const d of [dream, reflect]) {
      expect(d).toContain("night routine");
      expect(d).toContain("In an ordinary conversation, call `launch` only when the person asks");
      for (const phrase of SHARED) expect(d).not.toContain(phrase);
      expect(d.toLowerCase()).not.toContain("background");
    }
    expect(dream).toContain("follows the prompt that returns itself, in that same run");
    expect(dream).toContain("Do NOT start a dream nobody asked for");
    // The propose guard is every host's, kept verbatim.
    expect(dream).toContain("Do NOT use `propose` to correct or delete a memory");
    expect(reflect).toContain("The night routine calls `begin` and `finish` after the dream");
  });

  test("Claude Code's dream and reflect descriptions are the shared ones, byte for byte; Desktop's name no background agent (OL1d)", async () => {
    const defs = Object.fromEntries(toolDefinitions(false).map((t) => [String(t["name"]), String(t["description"])]));
    for (const name of ["dream", "reflect"]) {
      const base = TOOLS.find((t) => t.name === name);
      expect(defs[name]).toBe(renderDescription(base as never));
    }
    for (const phrase of SHARED) expect(defs["dream"]).toContain(phrase);
    expect(defs["reflect"]).toContain("hand its prompt to a background agent");
    // Over Desktop's door: what a Desktop client is sent — the chat's own words.
    const { http } = await door(DESKTOP_HOST);
    const list = ((await rpc(http.url, "tools/list"))["result"] as { tools: Record<string, unknown>[] }).tools;
    for (const name of ["dream", "reflect"]) {
      const d = String(list.find((t) => t["name"] === name)?.["description"]);
      const spec = DESKTOP_TOOLS.find((t) => t.name === name) as never;
      expect(d).toBe(renderDescription(spec));
      expect(d.toLowerCase()).not.toContain("background agent");
      expect(d).not.toContain("Do NOT run the dream yourself in this conversation");
      expect(d).toContain("yourself, here in the chat");
      // Privileges are every host's.
      expect((spec as { privileges: unknown }).privileges).toEqual(TOOLS.find((t) => t.name === name)?.privileges as never);
    }
  });

  test("the night prompt v2's steps, through the door: a night: true wake, dream launch, day's end, the dream, the reflection — none refused", async () => {
    const prompt = nightPrompt();
    // The routine says what claude.ai's descriptions now say: wake quiet, launch, follow it yourself.
    expect(prompt).toContain("wake once, with night: true");
    expect(prompt).toContain('the dream tool with phase "launch"');
    expect(prompt).toContain("follow the prompt it returns yourself, here");
    const { http, s } = await door();
    const day = String((await tool(http.url, "wake", {})).structured["session"]);
    const cite = String((await tool(http.url, "remember", { session: day, text: "Wren and I fixed the cold frame lid together." })).structured["id"]);
    for (const text of ["The rain barrel overflows toward the shed.", "Wren talks plans through out loud first."]) await tool(http.url, "remember", { session: day, text });

    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const body = await rpc(http.url, "tools/call", { name, arguments: args });
      const r = body["result"] as { isError?: boolean; structuredContent: Record<string, unknown> };
      expect({ name, phase: args["phase"], isError: r.isError ?? false, out: r.structuredContent }).toMatchObject({ isError: false });
      return r.structuredContent;
    };
    const night = String((await tool(http.url, "wake", { night: true })).structured["session"]);
    const launched = await call("dream", { phase: "launch", session: night });
    expect(String(launched["prompt"]).length).toBeGreaterThan(200);
    // The result agrees with the description and the routine: follow it here, no background agent.
    expect(launched["how"]).toBe(CLAUDE_AI_DREAM_LAUNCH_HOW);
    expect(String(launched["how"])).toContain("Follow `prompt` yourself, here");
    expect(String(launched["how"]).toLowerCase()).not.toContain("background");
    await call("dream", { phase: "writer", session: night });
    const begun = await call("dream", { phase: "begin", session: night });
    const dreamId = String(begun["dream"]);
    expect(dreamId.length).toBeGreaterThan(0);
    await call("dream", { phase: "journal", session: night, dream: dreamId, title: "The cold frame", text: "I dreamed the cold frame lid would not close." });
    const reflected = await call("reflect", { phase: "begin", session: night, dream: dreamId });
    const rid = String(reflected["reflection"]);
    const done = await call("reflect", { phase: "finish", session: night, reflection: rid, entry: "The cold frame stays with me.", cites: [cite] });
    expect(typeof done["handBack"]).toBe("string");
    expect(s.counterpart.store.dream(dreamId)).toBeDefined();
    expect(s.counterpart.store.reflection(rid)).toBeDefined();
  });

  test("a launch result's `how`: claude.ai's and Desktop's follow the prompt here; Claude Code's hands it to a background agent", async () => {
    for (const [host, dreamHow, reflectHow] of [
      [CLAUDE_AI_HOST, CLAUDE_AI_DREAM_LAUNCH_HOW, CLAUDE_AI_REFLECT_LAUNCH_HOW],
      [DESKTOP_HOST, DESKTOP_DREAM_LAUNCH_HOW, DESKTOP_REFLECT_LAUNCH_HOW],
    ] as const) {
      const { http } = await door(host);
      const session = String((await tool(http.url, "wake", {})).structured["session"]);
      await tool(http.url, "remember", { session, text: "The cold frame lid sticks in the morning damp." });
      const d = String((await tool(http.url, "dream", { phase: "launch", session })).structured["how"]);
      const r = String((await tool(http.url, "reflect", { phase: "launch", session })).structured["how"]);
      expect(d).toBe(dreamHow);
      expect(r).toBe(reflectHow);
      expect(`${d} ${r}`.toLowerCase()).not.toContain("background");
    }
  });
});
