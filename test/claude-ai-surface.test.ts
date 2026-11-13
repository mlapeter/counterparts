/**
 * THE CLAUDE.AI SURFACE (2026-10-26, OL1b items 2, 4, 5), through the HTTP door
 * (`adapters/remote/http.ts`) — `fetch` against a server on 127.0.0.1:
 *
 *   2. claude.ai's wake: one short session line, the clock and today's plain
 *      reminders, then the wake with "Coming up" and "Still open" moved up
 *      whole; not core's dream line, but claude.ai's own once a day (HN1); no
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
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { CLAUDE_AI_TOOLS, TOOLS, openServer, renderDescription, toolDefinitions } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { CLAUDE_AI_DELETE, CLAUDE_AI_SCOPE, CLAUDE_AI_TRIM, CLAUDE_AI_WAKE, CLAUDE_AI_WORDS, DESKTOP_TOOLS } from "../src/adapters/mcp/tools.js";
import { chatLanesFirst, claudeAiSessionLine, sameYouLine } from "../src/adapters/mcp/chat-wake.js";
import { CLAUDE_AI_DREAM_LAUNCH_HOW, CLAUDE_AI_DREAM_NOTE, CLAUDE_AI_INSTRUCTIONS, claudeAiNightLine, CLAUDE_AI_REFLECT_LAUNCH_HOW, CLAUDE_AI_START_PROMPT, DESKTOP_DREAM_LAUNCH_HOW, DESKTOP_DREAM_NOTE, DESKTOP_REFLECT_LAUNCH_HOW, START_PROMPT } from "../src/adapters/mcp/server-words.js";
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

/** A store with a page, an open thread, a plain reminder due today and an ordinary memory, published. */
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
    // An ordinary memory is not listed: "Might be relevant" is off the wake (WK1, 2026-10-30).
    expect(text).not.toContain("Wren likes quiet mornings before any planning.");
    expect(text).not.toContain(FRAMING.hints);
    expect(text).toContain("<!-- counterparts:wake/end");
    expect(text).not.toContain("\n\n\n");
    // No "same you" line: no host shares this store.
    expect(text).not.toContain("same you");
    // The payload is as before.
    expect(woke.structured).toMatchObject({ session, host: CLAUDE_AI_HOST, wake: text });
  });

  test("not core's dream line on claude.ai: with the day's ask due, the first wake asks in claude.ai's words and claims the day; a second wake says nothing (HN1)", async () => {
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
    const first = await tool(http.url, "wake", {});
    const text = first.text;
    const session = String(first.structured["session"]);
    expect(text).toContain(claudeAiNightLine({ session, setting: "ask", reflects: null, who: "the person" }));
    expect(text).not.toContain(CLAUDE_AI_DREAM_NOTE);
    expect(text).not.toMatch(/terminal|Agent tool|background agent/);
    expect(c.store.dreamAsk(today())).toMatchObject({ state: "offered", session });
    const again = (await tool(http.url, "wake", {})).text;
    expect(again).not.toContain("dreaming asks first");
    expect(again).not.toContain('phase "launch"');
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

/** What claude.ai's trim was last read against (TT1): see the drift guard below. */
const REVIEWED: Record<string, unknown> = {
  "remember": {
    "claims": [],
    "fields": {
      "about": "d8ed8f5286"
    },
    "drop": {
      "remove": "6c06510efb"
    }
  },
  "recall": {
    "claims": [
      "174c2c7f2f",
      "73cab9e6ba",
      "10aa831937",
      "056871d394",
      "c914c85898",
      "df100cc372",
      "dab0653dc7",
      "50182c13e0"
    ],
    "fields": {
      "question": "090112a6c7",
      "mode": "bd996c592a",
      "page": "aa1b4f19b4",
      "handle": "2f790a5b27",
      "ids": "179f71ee22",
      "part": "9592cce598"
    },
    "drop": {
      "query": "fcb5d6ccbd"
    }
  },
  "session_end": {
    "claims": [],
    "fields": {
      "session": "b2fd9d725b",
      "memories[].about": "9bb6cfb6c8",
      "handoff": "9d000a4c5d"
    },
    "drop": {}
  },
  "chapter": {
    "claims": [],
    "fields": {
      "session": "b2fd9d725b",
      "about": "217fce4da1"
    },
    "drop": {}
  },
  "dream": {
    "claims": [],
    "fields": {
      "phase": "8cd5eda7d1",
      "session": "eb045d78d2"
    },
    "drop": {
      "tagged": "6a7f71a05a",
      "merges": "6a7f71a05a",
      "kinds": "6a7f71a05a"
    }
  },
  "reflect": {
    "claims": [],
    "fields": {
      "session": "eb045d78d2"
    },
    "drop": {}
  },
  "session_end.negativeExamples": "0c25b2047a"
};

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
    // examples too, since TT1: session_end's second is the chat's own).
    for (const spec of CLAUDE_AI_TOOLS) {
      for (const words of [spec.summary, spec.admission, ...(spec.name === "session_end" ? spec.negativeExamples : [])]) {
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

  // DIR1 (2026-11-10): the server's `instructions` are read like a description (the directory's review), so
  // they say what wake is for, never "call it first, before anything", and nothing a directory reader flags.
  test("claude.ai's server instructions describe wake; they do not order a call before anything", async () => {
    const s = server(CLAUDE_AI_HOST);
    const http = await serveHttp({ server: s });
    closers.push(() => http.close());
    const init = (await rpc(http.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } }))["result"] as { instructions: string };
    expect(init.instructions).toBe(CLAUDE_AI_INSTRUCTIONS);
    for (const text of [init.instructions, ...CLAUDE_AI_TOOLS.map((t) => renderDescription(t))]) {
      expect(text).not.toMatch(/call (this|it|its wake tool) first/i);
      expect(text).not.toMatch(/in every conversation/i);
      expect(text).not.toMatch(/before answering anything/i);
      expect(text).not.toMatch(/don't ask first|I set this up myself|tool notices/i);
      expect(text).not.toMatch(/err toward too many/i);
    }
    expect(init.instructions).toContain("wake tool");
  });

  // REWORKED ON PURPOSE (TT1, 2026-11-04; again DIR1, 2026-11-10). TT1 pinned "claims served are the
  // base's own rows"; since DIR1 claude.ai serves NO claims (`tools.ts#withClaimsAsEngine`, policy §5B),
  // so this pins what keeps that safe: every base row is an engine row there, each once, none invented
  // and none lost (`mcp.test.ts` holds the base rows' mechanized paths). Claude Code's and Desktop's
  // words are pinned byte for byte below and in `description-cut.test.ts`.
  test("summary and admission change (and some negatives); no claim is served, every base row is an engine row; Claude Code's and Desktop's words are untouched", () => {
    for (const spec of CLAUDE_AI_TOOLS) {
      expect(spec.privileges).toEqual([]);
      expect(renderDescription(spec)).not.toContain("What this tool guarantees");
    }
    for (const spec of CLAUDE_AI_TOOLS.slice(1)) {
      // claude.ai's own specs (`scope`, `delete_memory`): their rows are their own, all engine rows here.
      const own = spec.name === "scope" ? CLAUDE_AI_SCOPE : spec.name === "delete_memory" ? CLAUDE_AI_DELETE : undefined;
      const base = own ?? TOOLS.find((t) => t.name === spec.name);
      expect(base).toBeDefined();
      if (own === undefined) {
        const words = CLAUDE_AI_WORDS[spec.name as keyof typeof CLAUDE_AI_WORDS]?.negativeExamples;
        expect(spec.negativeExamples).toEqual(words ?? base?.negativeExamples ?? []);
      }
      expect(spec.negativeExamples.length).toBeGreaterThanOrEqual(1);
      for (const negative of spec.negativeExamples) expect(negative.toLowerCase()).toContain("do not");
      const baseRows = [...(base?.privileges ?? []), ...(base?.engine ?? [])];
      const rows = spec.engine ?? [];
      expect(rows.length).toBe(baseRows.length);
      expect(new Set(rows).size).toBe(rows.length);
      expect(new Set(rows)).toEqual(new Set(baseRows));
    }
    const wake = CLAUDE_AI_TOOLS[0]!;
    expect(new Set(wake.engine)).toEqual(new Set([...CLAUDE_AI_WAKE.privileges, ...(CLAUDE_AI_WAKE.engine ?? [])]));
    for (const spec of TOOLS) expect(renderDescription(spec)).not.toContain("Save to long-term memory, in the moment");
    expect(toolDefinitions(false).map((t) => t["description"])).toEqual(TOOLS.map((t) => renderDescription(t)));
  });

  // TT1 (2026-11-04): what the trim must keep true, read off the list a claude.ai client is sent.
  test("claude.ai's trimmed list: no host-false words, the how-to-call words kept, Claude Code's list as it was", () => {
    const defs = toolDefinitions(CLAUDE_AI_HOST) as { name: string; description: string; inputSchema: Record<string, unknown> }[];
    const texts: [string, string][] = [];
    const walk = (node: unknown, path: string): void => {
      const n = node as { description?: unknown; properties?: Record<string, unknown>; items?: unknown } | undefined;
      if (n === undefined || typeof n !== "object") return;
      if (typeof n.description === "string") texts.push([path, n.description]);
      for (const [k, v] of Object.entries(n.properties ?? {})) walk(v, `${path}.${k}`);
      if (n.items !== undefined) walk(n.items, `${path}[]`);
    };
    for (const t of defs) {
      texts.push([t.name, t.description]);
      walk(t.inputSchema, t.name);
    }
    // Words false on claude.ai: no terminal, no folders, no hooks' registry, no dashboard, no
    // end-of-session or boundary ask. `reflect.phase` keeps "join" (a share's question about two
    // folders being one project), which a claude.ai store never asks and a shared local store may.
    // `recall` (its description) keeps "the session-start 'Last here' line" inside the time-filter claim,
    // which claude.ai serves whole because it says how a time in the question reads; a claude.ai wake has
    // a last-here line too. `self_page.session` names the night's own writer, as on every host.
    const FALSE_HERE = /terminal|\bfolders?\b|director(y|ies)|hooks' |dashboard|end-of-session ask|boundary ask|this machine|console|session-start/i;
    const EXEMPT = new Set(["reflect.phase", "recall"]);
    const found = texts.filter(([path, text]) => !EXEMPT.has(path) && FALSE_HERE.test(text)).map(([path, text]) => `${path}: ${String(text.match(FALSE_HERE)?.[0])}`);
    expect(found).toEqual([]);

    const by = Object.fromEntries(defs.map((t) => [t.name, t]));
    const field = (tool: string, path: string): string =>
      texts.find(([p]) => p === `${tool}.${path}`)?.[1] ?? `(no ${tool}.${path})`;
    // How to call: closing, revising, dating, the open flag, the one-word feeling.
    for (const tool of ["remember", "session_end"]) {
      const at = tool === "remember" ? "" : "memories[].";
      expect(field(tool, `${at}updates`)).toContain("`eventDate: null` or `unresolved: false`");
      // Trim PR 2: date words are read since #818, and one that can't be read is dropped and said, never refused.
      expect(field(tool, `${at}eventDate`)).toContain('"2026-10-20..2026-10-31" or words like "next Friday"');
      expect(field(tool, `${at}eventDate`)).not.toContain("refused");
      expect(field(tool, `${at}unresolved`)).toContain("true only when something is blocked on it");
      expect(field(tool, `${at}unresolved`)).toContain("Never curiosity");
      expect(field(tool, `${at}feelings`)).toContain("One feeling word");
      expect(field(tool, `${at}about`)).toContain("Mark anything personal owner or us");
    }
    expect(field("remember", "feelingsNow")).toContain("feels different now");
    expect(field("recall", "question")).toContain('"I" and "me" mean you, the counterpart');
    // Every handle Claude Code's recall names is named on claude.ai too, but the three that read
    // folders or hook-captured words, which claude.ai has none of. A handle added to every host's
    // words fails here until claude.ai's words name it (or it joins this list, with its reason).
    const NOT_ON_CLAUDE_AI = new Set(["last exchange", "handoffs here", "elsewhere", "manual <section>"]);
    const ccHandle = String((TOOLS.find((t) => t.name === "recall")?.inputSchema as { properties: { handle: { description: string } } }).properties.handle.description);
    for (const [, name] of ccHandle.matchAll(/"([^"]+)"/g)) {
      if (!NOT_ON_CLAUDE_AI.has(String(name))) expect(field("recall", "handle")).toContain(`"${String(name)}"`);
    }
    // The plumbing Do NOT is every host's negative, served whole (TC1; on the `text` field until trim PR 2).
    expect(by["remember"]?.description).toContain("Do NOT save refused calls unless the person raised it.");
    // Claude Code's catch-up fields are kept, short: claude.ai's wake can carry the write-up pointer.
    expect(field("session_end", "writeUp")).toContain("ended session");
    // Not published on any host since trim PR 2: traits on a write-up entry (remember keeps them), and
    // the old feeling object's fields (feelings are strings; the object form is still read).
    const entry = (by["session_end"]?.inputSchema as { properties: { memories: { items: { properties: Record<string, unknown> } } } }).properties.memories.items.properties;
    expect(entry["traits"]).toBeUndefined();
    expect((entry["feelings"] as { items: { type: string } }).items.type).toBe("string");
    expect(texts.some(([p]) => p === "remember.traits")).toBe(true);

    // The size, loosely: 92,335 B before TT1 (on 0.3.47's words), 65,044 B after, 67,293 B on 0.3.54's,
    // 40,257 B after DIR1 (no claims served, field words cut), about 26,500 B after trim PR 2 (every
    // host's words as short). A ceiling, so the words do not quietly grow back.
    expect(Buffer.byteLength(JSON.stringify({ tools: defs }), "utf8")).toBeLessThan(28_500);
    // Every other host's list keeps what is claude.ai's alone to lose: remember's `remove`, the tagging child.
    for (const host of [false, DESKTOP_HOST] as const) {
      const json = JSON.stringify(toolDefinitions(host));
      expect(json).toContain('"remove"');
      expect(json).toContain('"tagged"');
    }
  });

  // TT1 over master's 0.3.47 (HD1, TC1); DIR1 (2026-11-10): through the door, claude.ai's delete is its own
  // tool (`delete_memory`, destructive), `remember` there carries no `remove` and says where a stale one
  // goes, the undo handle and the plumbing rule are kept; Claude Code's door serves the registry's list,
  // `remove` and all; and a delete through claude.ai's door holds the memory.
  test("through the door: claude.ai deletes with delete_memory, not remember's remove; \"deleted\" and the plumbing rule kept; Claude Code's list is the registry's", async () => {
    const { http } = await door();
    type Listed = { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; inputSchema: { properties: Record<string, { description?: string; properties?: Record<string, unknown> }>; required?: string[] } };
    const list = ((await rpc(http.url, "tools/list"))["result"] as { tools: Listed[] }).tools;
    const remember = list.find((t) => t.name === "remember");
    expect(remember?.inputSchema.properties["remove"]).toBeUndefined();
    expect(remember?.annotations.destructiveHint).toBe(false);
    const del = list.find((t) => t.name === "delete_memory");
    expect(Object.keys(del?.inputSchema.properties ?? {}).sort()).toEqual(["id", "session", "undo"]);
    expect(del?.inputSchema.required).toEqual(["id"]);
    expect(del?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(String((remember as unknown as { description: string }).description)).toContain("Do NOT save refused calls unless the person raised it.");
    expect(String(list.find((t) => t.name === "recall")?.inputSchema.properties["handle"]?.description)).toContain('"deleted"');
    // Claude Code's own door, introduced as Claude Code (`door` says it is claude-ai, which picks the chat's list).
    const ccHttp = await serveHttp({ server: server("claude-code") });
    closers.push(() => ccHttp.close());
    await rpc(ccHttp.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.0.0" } });
    const ccList = ((await rpc(ccHttp.url, "tools/list"))["result"] as { tools: { name: string }[] }).tools;
    expect(JSON.stringify(ccList)).toBe(JSON.stringify(toolDefinitions(false)));
    expect(ccList.map((t) => t.name)).not.toContain("delete_memory");
    // Since trim PR 2 every host's words are as short as claude.ai's were: the lists differ by recall's
    // claims, `remove` and the tagging child, less claude.ai's own wake and delete_memory.
    expect(Buffer.byteLength(JSON.stringify({ tools: list }), "utf8")).toBeLessThan(Buffer.byteLength(JSON.stringify({ tools: ccList }), "utf8") + 1_000);

    const session = String((await tool(http.url, "wake", {})).structured["session"]);
    const id = String((await tool(http.url, "remember", { session, kind: "fact", text: "Wren's bike lock code is 4471.", about: "owner" })).structured["id"]);
    await tool(http.url, "recall", { session, ids: [id] });
    // A stale list's `remember` with `remove` is told where the delete went, and nothing runs.
    const stale = await tool(http.url, "remember", { session, remove: { id } });
    expect(stale.structured["reason"]).toBe("remove-moved");
    expect(String(stale.structured["detail"])).toContain("delete_memory");
    const held = (await tool(http.url, "delete_memory", { session, id })).structured;
    expect(held["ok"]).toBe(true);
    expect(held["reason"]).toBe("held");
    const back = (await tool(http.url, "delete_memory", { session, id, undo: true })).structured;
    expect(back["ok"]).toBe(true);
    const empty = (await tool(http.url, "delete_memory", { session })).structured;
    expect(empty["ok"]).toBe(false);
    expect(String(empty["detail"])).toContain("delete_memory needs the memory's id");
    // Claude Code's door has no such tool: a protocol error, as for any unknown tool.
    const cc = await rpc(ccHttp.url, "tools/call", { name: "delete_memory", arguments: { id } });
    expect((cc["error"] as { code: number }).code).toBe(-32601);
  });

  /**
   * THE DRIFT GUARD (TT1 review, 2026-11-04). claude.ai's short words are a reading of every host's
   * words at one moment. When those change — a field's description, a claim added, reworded or
   * dropped, a negative the chat's own are derived from — this fails, so the short words are read
   * again instead of going quietly stale: a new claim would otherwise be served on claude.ai as an
   * engine row (unrendered) with nobody having decided it. To pass again, re-read the base words
   * against `CLAUDE_AI_TRIM` / `CLAUDE_AI_WORDS`, change claude.ai's if needed, and paste the new
   * value of REVIEWED from the failure.
   */
  test("drift guard: every host's words that claude.ai's trim was read against are still those words", () => {
    const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 10);
    const at = (schema: unknown, path: string): Record<string, unknown> => {
      let node = schema as Record<string, unknown>;
      path.split(".").forEach((step) => {
        const items = step.endsWith("[]");
        const property = (node["properties"] as Record<string, Record<string, unknown>>)[items ? step.slice(0, -2) : step] as Record<string, unknown>;
        node = items ? (property["items"] as Record<string, unknown>) : property;
      });
      return node;
    };
    const now: Record<string, unknown> = {};
    for (const [name, trim] of Object.entries(CLAUDE_AI_TRIM)) {
      const base = TOOLS.find((t) => t.name === name);
      expect(base).toBeDefined();
      now[name] = {
        claims: base!.privileges.map((p) => hash(p.claim)),
        fields: Object.fromEntries(Object.keys(trim?.fields ?? {}).map((path) => [path, hash(String(at(base!.inputSchema, path)["description"]))])),
        drop: Object.fromEntries((trim?.drop ?? []).map((path) => [path, hash(JSON.stringify(at(base!.inputSchema, path)))])),
      };
    }
    for (const [name, words] of Object.entries(CLAUDE_AI_WORDS)) {
      const base = TOOLS.find((t) => t.name === name);
      // Only words derived from the base's (filtered, mapped, replaced) are read against it.
      if (words?.negativeExamples !== undefined && name !== "dream") now[`${name}.negativeExamples`] = hash(JSON.stringify(base?.negativeExamples));
      if (name === "self_page") now["self_page.summary"] = hash(String(base?.summary));
    }
    if (process.env["TT1_PRINT_REVIEWED"] === "1") console.log(JSON.stringify(now, null, 2));
    expect(now).toEqual(REVIEWED);
  });

  // H1 (2026-10-29): the honesty question, closed by the door test below. Whether claude.ai skips its
  // per-tool permission prompt for a read-only tool is NOT tested anywhere, and nothing here claims it.
  // DIR1 (2026-11-10): claude.ai's rule is the directory's (`tools.ts#CLAUDE_AI_ANNOTATIONS`): read-only
  // when a call changes no memory, page, journal, dream or setting, the server's bookkeeping aside.
  test("annotations: claude.ai's status and recall are read-only (bookkeeping only); Desktop's nothing; Claude Code's status", () => {
    const readOnlyOn = (host: boolean | string): string[] =>
      toolDefinitions(host)
        .filter((t) => (t["annotations"] as { readOnlyHint: boolean }).readOnlyHint)
        .map((t) => (t["annotations"] as { title: string }).title);
    expect(readOnlyOn(CLAUDE_AI_HOST)).toEqual(["Recall memories", "Memory status"]);
    expect(readOnlyOn(DESKTOP_HOST)).toEqual([]);
    // recall (its use credit), wake, and self_page (it has a write mode) are never read-only anywhere.
    expect(readOnlyOn(false)).toEqual(["Memory status"]);
  });
});

describe("claude.ai's scope: one account is one memory, through the door (11-03 reviews)", () => {
  const ROADMAP = "One account is one memory: they can pause it or turn it off, and back on.";

  /** claude.ai's door with a scope registry, as hosted (`hosted/src/tenants.ts`) and the trial launch one. */
  async function scopedDoor(): Promise<{ url: string; registry: string }> {
    const registry = join(root, "config", "scopes.json");
    const s = openServer({
      dir: join(root, "store-scoped"),
      host: CLAUDE_AI_HOST,
      env: {},
      scopesFile: registry,
      lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
      manifestVersion: () => null,
    });
    closers.push(() => s.counterpart.close());
    const http = await serveHttp({ server: s });
    closers.push(() => http.close());
    await rpc(http.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } });
    return { url: http.url, registry };
  }

  test("tools/list: scope's description and fields say one memory, with no directory, file or console", async () => {
    const { url } = await scopedDoor();
    const list = ((await rpc(url, "tools/list"))["result"] as { tools: Record<string, unknown>[] }).tools;
    const scope = list.find((t) => t["name"] === "scope");
    const served = JSON.stringify(scope);
    expect(String(scope?.["description"])).toContain(ROADMAP);
    expect(served).not.toMatch(/director/i);
    expect(served).not.toContain("claude-code.json");
    expect(served).not.toMatch(/console|--note|counterparts scope/);
    expect(Object.keys((scope?.["inputSchema"] as { properties: Record<string, unknown> }).properties).sort()).toEqual(["mode", "note", "session"]);
    expect((scope?.["annotations"] as { title: string }).title).toBe("Memory on or off");
  });

  test("the read and the set say one memory and never the server's path; a refusal while off or paused names no terminal command", async () => {
    const { url, registry } = await scopedDoor();
    const session = String((await tool(url, "wake", {})).structured["session"]);
    const read = await tool(url, "scope", { session });
    expect(read.structured["mode"]).toBe("unset");
    expect(String(read.structured["detail"])).toContain(ROADMAP);
    expect(read.structured).not.toHaveProperty("registry");
    for (const said of [read.text, JSON.stringify(read.structured)]) {
      expect(said).not.toContain(registry);
      expect(said).not.toContain(root);
      expect(said).not.toMatch(/director/i);
    }

    const off = await tool(url, "scope", { session, mode: "off" });
    expect(off.structured["set"]).toBe(true);
    expect(off.structured).not.toHaveProperty("registry");
    expect(off.text).not.toContain(root);
    const readOff = await tool(url, "scope", { session });
    expect(readOff.structured["mode"]).toBe("off");
    expect(String(readOff.structured["detail"])).toContain(ROADMAP);

    const refusedOff = await tool(url, "remember", { session, kind: "fact", text: "Wren waters the beans at dusk." });
    expect(refusedOff.structured["reason"]).toBe("scope-off");
    expect(String(refusedOff.structured["detail"])).toContain("call `scope` with mode `on`");
    expect(refusedOff.text).not.toContain("counterparts scope");

    await tool(url, "scope", { session, mode: "pause" });
    const refusedPaused = await tool(url, "remember", { session, kind: "fact", text: "Wren waters the beans at dusk." });
    expect(String(refusedPaused.structured["detail"])).toContain("call `scope` with mode `resume`");
    expect(refusedPaused.text).not.toContain("counterparts scope");

    const back = await tool(url, "scope", { session, mode: "resume" });
    expect(back.structured["mode"]).toBe("on");
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

  test("through the claude.ai door: a status call naming no session changes no row and no file; one naming it touches only the session record, which claude.ai's rule counts as bookkeeping (DIR1)", async () => {
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
    // DIR1: read-only on claude.ai (what changed is the session's own record, above); Desktop's copy keeps H1's rule.
    expect(status?.annotations.readOnlyHint).toBe(true);
    expect((toolDefinitions(DESKTOP_HOST).find((t) => t["name"] === "status")?.["annotations"] as { readOnlyHint: boolean }).readOnlyHint).toBe(false);
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
    expect(s.counterpart.store.reflection(rid)).toMatchObject({ share_state: "told", share_session: String(chat.structured["session"]) });
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
  // Trim PR 2: the every-host negative says "run one yourself in this conversation".
  const SHARED = ["the day's dream line", "a background agent", "run one yourself in this conversation"];
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
      expect(d.toLowerCase()).toContain("call `launch` when the person asks you to");
      for (const phrase of SHARED) expect(d).not.toContain(phrase);
      expect(d.toLowerCase()).not.toContain("background");
    }
    expect(dream).toContain("then follow the steps it returns, in order, passing the same session");
    expect(dream).toContain("Do NOT start a dream nobody asked for");
    // HN1: the wake that tells a conversation to run the night is not "nobody asked".
    expect(dream).toContain("when the wake says this conversation runs the night");
    // The propose guard is every host's, kept verbatim.
    expect(dream).toContain("Do NOT use `propose` to correct or delete a memory");
    expect(reflect).toContain("the run calls `begin` and `finish` as its steps say");
  });

  test("Claude Code's dream and reflect descriptions are the shared ones, byte for byte; Desktop's name no background agent (OL1d)", async () => {
    const defs = Object.fromEntries(toolDefinitions(false).map((t) => [String(t["name"]), String(t["description"])]));
    for (const name of ["dream", "reflect"]) {
      const base = TOOLS.find((t) => t.name === name);
      expect(defs[name]).toBe(renderDescription(base as never));
    }
    for (const phrase of SHARED) expect(defs["dream"]).toContain(phrase);
    expect(defs["reflect"]).toContain("for a background agent");
    // Over Desktop's door: what a Desktop client is sent — the chat's own words.
    const { http } = await door(DESKTOP_HOST);
    const list = ((await rpc(http.url, "tools/list"))["result"] as { tools: Record<string, unknown>[] }).tools;
    for (const name of ["dream", "reflect"]) {
      const d = String(list.find((t) => t["name"] === name)?.["description"]);
      const spec = DESKTOP_TOOLS.find((t) => t.name === name) as never;
      expect(d).toBe(renderDescription(spec));
      expect(d.toLowerCase()).not.toContain("background agent");
      expect(d).not.toContain("run one yourself in this conversation");
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
