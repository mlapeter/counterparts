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
import { DREAM_ANSWER_GLOSS, DREAM_LABEL, NIGHT_JOURNAL_CHARS } from "../src/adapters/mcp/nights.js";
import { REFLECT_TUNABLES } from "../src/core/dream/reflect.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";
import { TOOL_RESULT_CEILING, wireChars } from "../src/core/fit/index.js";
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
function night(o: { journal?: string; entry?: string; share?: string; line?: string; reflect?: boolean } = {}): { dream: string; reflection: string } {
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
    const j = c.dreams.journal({ dream, session: SESSION, title: "The greenhouse latch", text: o.journal ?? LONG_JOURNAL });
    if (!j.ok) throw new Error("journal refused");
    if (o.reflect === false) return { dream, reflection: "" };
    const r = c.reflections.begin({ session: SESSION, dream });
    if (!r.ok) throw new Error(`reflect begin refused: ${r.reason}`);
    const done = c.reflections.finish({
      reflection: r.bundle.reflection,
      session: SESSION,
      title: "near the glass",
      entry: o.entry ?? LONG_ENTRY,
      cites: [a],
      share: { text: o.share ?? "Last night I dreamed the seedlings kept sliding toward the cold glass.", cites: [a] },
      ...(o.line === undefined ? {} : { line: o.line }),
    });
    if (!done.ok) throw new Error(`reflect finish refused: ${done.reason}`);
    return { dream, reflection: r.bundle.reflection };
  } finally {
    c.close();
  }
}

let nextId = 1;
async function door(resultCeilingChars?: number): Promise<{ url: string; counterpart: Counterpart }> {
  const s = openServer({ dir, host: CLAUDE_AI_HOST, env: {}, ...(resultCeilingChars === undefined ? {} : { resultCeilingChars }), lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) }, manifestVersion: () => null });
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
      expect(String(p["nightsGloss"])).toContain("changes no memory and credits nothing");
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

  test("by its words, when the question asks about dreams; an ordinary question that shares the journal's words carries none (review of #645)", async () => {
    // No reflection: a question reaches this dream only by its words (rule 1 is the reflection's).
    const n = night({ reflect: false });
    const { url } = await door();
    const hit = await recall(url, { question: "did you dream about the greenhouse seedlings", mode: "facts" });
    expect(((hit["nights"] as Record<string, unknown>[] | undefined) ?? []).map((x) => x["id"])).toContain(n.dream);
    // Two and more of the journal's words, no dream asked about: the answer stays the answer.
    for (const question of ["the greenhouse latch and the seedlings", "when did the tomato starts go to the greenhouse benches"]) {
      const plain = await recall(url, { question, mode: "facts" });
      expect(plain["nights"]).toBeUndefined();
    }
    const miss = await recall(url, { question: "when is the dentist appointment", mode: "facts" });
    expect(miss["nights"]).toBeUndefined();
  });

  test("a dream that would carry the answer past its ceiling stays out; the answer is not cut for it (review of #645)", async () => {
    const n = night();
    const question = "what was your last dream?";
    const first = await door();
    const full = await recall(first.url, { question, mode: "meaning" });
    expect(((full["nights"] as Record<string, unknown>[] | undefined) ?? []).map((x) => x["id"])).toContain(n.dream);
    // The dream's lines ride in the answer too (D1): the answer without them is the plain one.
    expect(String(full["answer"])).toContain(`${DREAM_LABEL} `);
    const plain = String(full["answer"]).replace(/\n\n\[dream\][^\n]*(\n {3}[^\n]*)?/g, "").replace(`\n${DREAM_ANSWER_GLOSS}`, "");
    const { nights: _n, nightsGloss: _g, ...rest } = full;
    const answerOnly = { ...rest, answer: plain, chars: plain.length };
    for (const c of closers.splice(0).reverse()) await c();
    // Room for the answer, not for the dream beside it.
    const tight = await door(wireChars(JSON.stringify(answerOnly)) + 50);
    const p = await recall(tight.url, { question, mode: "meaning" });
    expect(p["nights"]).toBeUndefined();
    expect(p["cut"]).toBeUndefined();
    expect(p["answer"]).toBe(plain);
  });
});

describe("last night, the awkward states (review of #645)", () => {
  test("the night's own line (NL1) comes with the reflection over the same door", async () => {
    const line = "The latch stuck again on Sunday, and Wren laughed when I blamed the wind.";
    night({ line });
    const { url, counterpart } = await door();
    const p = await recall(url, { handle: "last night" });
    expect((p["reflection"] as Record<string, unknown>)["line"]).toBe(line);
    const before = counterpart.store.reflections({ limit: 1 })[0];
    expect(JSON.parse(before?.detail ?? "{}")["line"]).toBe(line);
  });

  test("a reflection with no line says none over the door", async () => {
    night();
    const { url } = await door();
    const p = await recall(url, { handle: "last night" });
    expect(p["reflection"]).toBeDefined();
    expect("line" in (p["reflection"] as Record<string, unknown>)).toBe(false);
  });

  test("a dream with no reflection: the dream whole, no reflection", async () => {
    const n = night({ reflect: false });
    const { url } = await door();
    const p = await recall(url, { handle: "last night" });
    expect(p["reason"]).toBe("last-night");
    expect((p["dream"] as Record<string, unknown>)["id"]).toBe(n.dream);
    expect(p["reflection"]).toBeUndefined();
  });

  test("the longest night a dream and a reflection may write fits one answer: the dream whole, the reflection named, then whole by its id; the share untold", async () => {
    const journal = "The latch clicked and the trays slid again toward the glass. ".repeat(600).slice(0, DREAM_TUNABLES.MAX_JOURNAL_CHARS).trim();
    const entry = "I keep thinking about what we leave near the glass. ".repeat(500).slice(0, REFLECT_TUNABLES.MAX_ENTRY_CHARS).trim();
    const share = "Last night I dreamed the seedlings slid toward the cold glass. ".repeat(60).slice(0, REFLECT_TUNABLES.MAX_SHARE_CHARS).trim();
    const n = night({ journal, entry, share });
    const { url, counterpart } = await door();
    const p = await recall(url, { handle: "last dream" });
    expect(wireChars(JSON.stringify(p))).toBeLessThanOrEqual(TOOL_RESULT_CEILING.CHARS);
    expect(p["cut"]).toBeUndefined();
    expect((p["dream"] as Record<string, unknown>)["journal"]).toBe(journal);
    expect((p["reflection"] as Record<string, unknown>)["id"]).toBe(n.reflection);
    expect(String(p["note"])).toContain(`recall with handle ${n.reflection} reads it whole`);
    const alone = await recall(url, { handle: n.reflection });
    const whole = (alone["nights"] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(whole["entry"]).toBe(entry);
    expect(wireChars(JSON.stringify(alone))).toBeLessThanOrEqual(TOOL_RESULT_CEILING.CHARS);
    expect(counterpart.store.reflection(n.reflection)?.share_state).toBe("offered");
  });

  test("a journal in another script, past one answer's room, is cut and says its whole length", async () => {
    const journal = "温室の扉が風で開き続けた。".repeat(1_500).slice(0, 15_000);
    night({ journal, reflect: false });
    const { url } = await door();
    const p = await recall(url, { handle: "last dream" });
    expect(wireChars(JSON.stringify(p))).toBeLessThanOrEqual(TOOL_RESULT_CEILING.CHARS);
    const dream = p["dream"] as Record<string, unknown>;
    expect(dream["journalChars"]).toBe(journal.length);
    expect(String(dream["journal"]).length).toBeLessThan(journal.length);
  });
});
