/**
 * DREAMS REACHABLE FROM A CHAT (2026-10-26, OL1b item 3), through the HTTP door
 * (`adapters/remote/http.ts`) on a claude.ai server — the host with no console
 * and no dashboard, where "show me the full dream" could not be answered:
 *
 *   - `recall` with handle "last dream" (or "last night", any case) reads the
 *     newest dream whole — title, journal uncut, what it did — and the
 *     reflection after it, entry and share uncut; nothing marked told;
 *   - a dream's id alone reads it whole; among `ids` it stays a summary;
 *   - a question reaches a dream: by the reflection the answer showed, by the
 *     words it shares with the journal, or — asking about dreams — the newest;
 *     an unrelated question carries none.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No model
 * is called; no worker starts (a stub spawner). Every word is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { NIGHT_JOURNAL_CHARS } from "../src/adapters/mcp/nights.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { PutInput } from "../src/core/store/index.js";

const SESSION = "sess_night_ol1b";
const LONG_JOURNAL = `I dreamed the greenhouse door kept swinging open in the wind, and every time I latched it the seedlings had moved one bench closer to the cold glass. ${"The latch clicked and the trays slid again. ".repeat(40)}By the end I was carrying the tomato starts in my arms.`;
const LONG_ENTRY = `The dream kept moving the seedlings toward the cold. ${"I keep thinking about what we leave near the glass. ".repeat(80)}`;

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-claude-ai-dreams-")));
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

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
}

/** One night: a dream with a long journal, then a reflection after it with a long entry and a share. */
function night(): { dream: string; reflection: string } {
  const c = Counterpart.open({ dir, identity: { name: "Wren" } });
  try {
    c.store.advanceClock("2026-09-20");
    const a = mem(c, "The greenhouse door sticks when the wind comes from the north.");
    const b = mem(c, "The tomato starts went out to the greenhouse benches on Saturday.");
    c.store.advanceClock("2026-09-21");
    const begun = c.dreams.begin({ session: SESSION });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const dream = begun.bundle.dream;
    const proposed = c.dreams.propose({ dream, session: SESSION, changes: [{ action: "link", a, b }] });
    if (!proposed.ok) throw new Error("propose refused");
    const j = c.dreams.journal({ dream, session: SESSION, title: "The greenhouse latch", text: LONG_JOURNAL });
    if (!j.ok) throw new Error("journal refused");
    const r = c.reflections.begin({ session: SESSION, dream });
    if (!r.ok) throw new Error(`reflect begin refused: ${r.reason}`);
    const done = c.reflections.finish({
      reflection: r.bundle.reflection,
      session: SESSION,
      title: "near the glass",
      entry: LONG_ENTRY,
      cites: [a],
      share: { text: "Last night I dreamed the seedlings kept sliding toward the cold glass.", cites: [a] },
    });
    if (!done.ok) throw new Error(`reflect finish refused: ${done.reason}`);
    return { dream, reflection: r.bundle.reflection };
  } finally {
    c.close();
  }
}

let nextId = 1;
async function door(): Promise<{ url: string; counterpart: Counterpart }> {
  const s = openServer({ dir, host: CLAUDE_AI_HOST, env: {}, lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) }, manifestVersion: () => null });
  closers.push(() => s.counterpart.close());
  const http = await serveHttp({ server: s });
  closers.push(() => http.close());
  return { url: http.url, counterpart: s.counterpart };
}

async function recall(url: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: "recall", arguments: args } }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { structuredContent: Record<string, unknown>; isError?: boolean } };
  expect(body.result.isError).not.toBe(true);
  return body.result.structuredContent;
}

describe("last dream, whole, through the door", () => {
  test('"last dream" and "Last Night" read the newest dream and its reflection uncut; nothing is marked told', async () => {
    const n = night();
    const { url, counterpart } = await door();
    for (const handle of ["last dream", "Last Night"]) {
      const p = await recall(url, { handle });
      expect(p["reason"]).toBe("last-night");
      const dream = p["dream"] as Record<string, unknown>;
      const reflection = p["reflection"] as Record<string, unknown>;
      expect(dream["id"]).toBe(n.dream);
      expect(dream["title"]).toBe("The greenhouse latch");
      expect(dream["journal"]).toBe(LONG_JOURNAL);
      expect(String(dream["journal"]).length).toBeGreaterThan(NIGHT_JOURNAL_CHARS);
      expect(dream["journalChars"]).toBeUndefined();
      expect(reflection["id"]).toBe(n.reflection);
      expect(reflection["entry"]).toBe(LONG_ENTRY.trim());
      expect(reflection["share"]).toBe("Last night I dreamed the seedlings kept sliding toward the cold glass.");
      expect(String(p["nightsGloss"])).toContain("changes nothing");
    }
    expect(counterpart.store.reflection(n.reflection)?.share_state).toBe("offered");
  });

  test("a store with no nights says so", async () => {
    Counterpart.open({ dir }).close();
    const { url } = await door();
    const p = await recall(url, { handle: "last dream" });
    expect(p["reason"]).toBe("no-night");
    expect(p["dream"]).toBeUndefined();
  });

  test("a dream's id alone reads it whole; among ids it stays a summary", async () => {
    const n = night();
    const { url } = await door();
    const alone = await recall(url, { handle: n.dream });
    const one = (alone["nights"] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(one["journal"]).toBe(LONG_JOURNAL);
    const listed = await recall(url, { ids: [n.dream] });
    const summary = (listed["nights"] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(String(summary["journal"]).length).toBeLessThanOrEqual(NIGHT_JOURNAL_CHARS);
    expect(summary["journalChars"]).toBe(LONG_JOURNAL.length);
  });
});

describe("a question reaches a dream", () => {
  test("asking about dreams, by meaning: the newest dream rides beside the answer, read-only", async () => {
    const n = night();
    const { url } = await door();
    const p = await recall(url, { question: "what was your last dream?", mode: "meaning" });
    const nights = (p["nights"] as Record<string, unknown>[] | undefined) ?? [];
    expect(nights.map((x) => x["id"])).toContain(n.dream);
    expect(String(nights[0]?.["why"]).length).toBeGreaterThan(0);
    expect(String(p["nightsGloss"])).toContain('handle "last dream"');
  });

  test("by its words, in facts mode: a question that shares the journal's words finds it; an unrelated one carries none", async () => {
    const n = night();
    const { url } = await door();
    const hit = await recall(url, { question: "the greenhouse latch and the seedlings", mode: "facts" });
    expect(((hit["nights"] as Record<string, unknown>[] | undefined) ?? []).map((x) => x["id"])).toContain(n.dream);
    const miss = await recall(url, { question: "when is the dentist appointment", mode: "facts" });
    expect(miss["nights"]).toBeUndefined();
  });
});
