/**
 * `adapters/dashboard/web/ask-voice.ts` — the memories tab's Ask, turned from
 * the owner's voice into mine before it searches (round 3b, 2026-09-27).
 *
 * What this file proves:
 *
 *   1. **The table**: every rule `toMyVoice` states, one row each — the you →
 *      I/me flip and how a bare "you" is judged, the owner's I → his name, the
 *      swap when no name is known, the one-pass guarantee ("an I made from you
 *      is never turned again"), capitals, and what is left exactly as typed.
 *   2. **The action**: `buildArgv("ask")` searches with the turned text and
 *      says so in `searched`; `exact: true` searches with what was typed; an
 *      `--id` ask is never turned; `runAction` hands `searched` back to the
 *      page; and over the wire the server reads the owner's name off the store.
 *
 * Hermetic (CLAUDE.md): the stores live in fresh temp dirs removed afterwards,
 * and their configurations are always named.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildArgv, runAction } from "../src/adapters/dashboard/web/actions.js";
import type { Run } from "../src/adapters/dashboard/web/actions.js";
import { displayName, toMyVoice } from "../src/adapters/dashboard/web/ask-voice.js";
import { startDashboard } from "../src/adapters/dashboard/web/server.js";
import type { RunningDashboard } from "../src/adapters/dashboard/web/server.js";
import { Counterpart } from "../src/core/counterpart.js";

const NAME = "mike"; // as `sleep#ownerNames` hands it over: lower-cased

/** [what the owner typed, the owner's name or null, what is searched]. */
const TABLE: [string, string | null, string][] = [
  // ── the spec's own cases ──
  ["what have you learned about yourself?", NAME, "what have I learned about myself?"],
  ["do you remember what I said", NAME, "do I remember what Mike said"], // one pass: the new I stays I
  ["did Mike tell you", NAME, "did Mike tell me"],
  ["you're right", NAME, "I'm right"],
  ["you've changed", NAME, "I've changed"],
  ["you'd know", NAME, "I'd know"],
  ["you'll see", NAME, "I'll see"],
  ["Are you sure?", NAME, "Am I sure?"],
  ["you are kind", NAME, "I am kind"],
  ["were you there?", NAME, "was I there?"],
  ["you were there", NAME, "I was there"],
  ["is that yours or mine?", NAME, "is that mine or Mike's?"], // one pass: the new mine stays mine
  ["what's your favourite colour", NAME, "what's my favourite colour"],
  // ── a bare "you": subject or object ──
  ["can you help me remember", NAME, "can I help Mike remember"], // after an auxiliary
  ["don't you remember my dog", NAME, "don't I remember Mike's dog"], // a negated auxiliary
  ["what does Mike think of you?", NAME, "what does Mike think of me?"], // after a preposition
  ["thank you", NAME, "thank me"], // after a verb that takes a person
  ["do you remember what you told me", NAME, "do I remember what I told Mike"], // after a wh-word
  ["You said I was wrong", NAME, "I said Mike was wrong"], // at the start
  ["the thing you said yesterday", NAME, "the thing I said yesterday"], // before a subject's verb
  ["the kids' toys and you", NAME, "the kids' toys and me"], // nothing after it in its clause
  ["aren't you tired? weren't you there?", NAME, "aren't I tired? wasn't I there?"],
  ["you aren't listening", NAME, "I am not listening"],
  // ── the owner's own first person ──
  ["am I right?", NAME, "is Mike right?"],
  ["I am tired", NAME, "Mike is tired"],
  ["I'm tired and I've been busy", NAME, "Mike is tired and Mike has been busy"],
  ["I'll ask again, I'd forgotten", NAME, "Mike will ask again, Mike'd forgotten"],
  ["tell me about yourself", NAME, "tell Mike about myself"],
  ["was I rude to you", NAME, "was Mike rude to me"],
  ["i said what", NAME, "Mike said what"], // a lower-case i is still the owner
  ["what were you doing when I called", "mike lapeter", "what was I doing when Mike Lapeter called"],
  ["did I hurt myself", NAME, "did Mike hurt Mike"],
  // ── no name known: a true swap, never two I's ──
  ["do you remember what I said", null, "do I remember what you said"],
  ["what do you know about me", null, "what do I know about you"],
  ["am I right?", null, "are you right?"],
  ["I'm tired", null, "You're tired"],
  ["was I rude to you", null, "were you rude to me"],
  ["is my plan mine or yours?", null, "is your plan yours or mine?"],
  // ── capitals and apostrophes ──
  ["WHAT DO YOU KNOW ABOUT ME", NAME, "WHAT DO I KNOW ABOUT MIKE"],
  ["Your thoughts?", NAME, "My thoughts?"],
  ["what I said", null, "what you said"], // the owner's I is a capital only where a sentence starts
  ["you’re right, I’ve been busy", NAME, "I’m right, Mike has been busy"],
  // ── whole words only, and left exactly as typed ──
  ["Youtube videos yourselves younger you-know-who", NAME, "Youtube videos yourselves younger you-know-who"],
  ['what did you say about "your turn"?', NAME, 'what did I say about "your turn"?'],
  ["what did you mean by 'you and me'?", NAME, "what did I mean by 'you and me'?"],
  ["what did you mean by “you and me”?", NAME, "what did I mean by “you and me”?"],
  ["did you read `your notes`", NAME, "did I read `your notes`"],
  ['did you say "you told me', NAME, 'did I say "you told me'], // an unclosed double quote runs to the end
  ["don't you think 'twas you", NAME, "don't I think 'twas me"], // an unclosed single quote is an apostrophe
  ["what is mem_abc123 about you", NAME, "what is mem_abc123 about me"],
  ["what did I tell you about src/your.ts", NAME, "what did Mike tell me about src/your.ts"],
  ["email you@example.com your notes", NAME, "email you@example.com my notes"],
  ["We talked about our plans", NAME, "We talked about our plans"], // we/us/our mean both of us
  ["tomatoes in the garden", NAME, "tomatoes in the garden"],
];

describe("toMyVoice — the table", () => {
  test("has at least 25 cases", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(25);
  });
  for (const [typed, name, searched] of TABLE) {
    test(`${JSON.stringify(typed)} (${name === null ? "no name" : name}) → ${JSON.stringify(searched)}`, () => {
      const r = toMyVoice(typed, name);
      expect(r.text).toBe(searched);
      expect(r.changed).toBe(searched !== typed);
    });
  }

  test("a question with no pronoun is unchanged, and says so", () => {
    expect(toMyVoice("tomatoes in the garden", NAME)).toEqual({ text: "tomatoes in the garden", changed: false });
    expect(toMyVoice("", null)).toEqual({ text: "", changed: false });
  });

  test("the name is written as a person writes it", () => {
    expect(displayName("mike")).toBe("Mike");
    expect(displayName("  mary-jane  watson ")).toBe("Mary-Jane Watson");
    expect(displayName("")).toBeNull();
    expect(displayName(null)).toBeNull();
  });
});

// ── the action ──────────────────────────────────────────────────────────────

describe("the ask action searches in my voice", () => {
  const ctx = { dir: "/tmp/somewhere", ownerName: NAME };

  test("the question is turned, and `searched` says what was searched", () => {
    const b = buildArgv("ask", { question: "do you remember what I said?", json: true }, ctx);
    expect(b.argv.slice(-2)).toEqual(["--", "do I remember what Mike said?"]);
    expect(b.searched).toEqual({ text: "do I remember what Mike said?", changed: true, exact: false });
  });

  test("exact: true searches with what was typed", () => {
    const b = buildArgv("ask", { question: "do you remember what I said?", exact: true }, ctx);
    expect(b.argv.slice(-2)).toEqual(["--", "do you remember what I said?"]);
    expect(b.searched).toEqual({ text: "do you remember what I said?", changed: false, exact: true });
  });

  test("with no name the owner's I becomes you; a pronoun-free question is unchanged", () => {
    const swapped = buildArgv("ask", { question: "what do you know about me" }, { dir: "/tmp/somewhere" });
    expect(swapped.argv.at(-1)).toBe("what do I know about you");
    const plain = buildArgv("ask", { question: "tea" }, ctx);
    expect(plain.argv.at(-1)).toBe("tea");
    expect(plain.searched?.changed).toBe(false);
  });

  test("in meaning mode the owner's I is you, never his name: his name would be a card meaning takes as the subject (review of #333)", () => {
    const meaning = buildArgv("ask", { question: "what has Ilya been to me", mode: "meaning" }, ctx);
    expect(meaning.argv.slice(-2)).toEqual(["--", "what has Ilya been to you"]);
    expect(meaning.argv).toContain("--voiced");
    const facts = buildArgv("ask", { question: "what has Ilya been to me", mode: "facts" }, ctx);
    expect(facts.argv.at(-1)).toBe("what has Ilya been to Mike");
  });

  test("an --id ask is an address, never turned", () => {
    const b = buildArgv("ask", { id: "mem_0123456789ab" }, ctx);
    expect(b.argv.slice(-2)).toEqual(["--id", "mem_0123456789ab"]);
    expect(b.searched).toBeUndefined();
  });

  test("a question still may not begin with --", () => {
    expect(() => buildArgv("ask", { question: "--help you" }, ctx)).toThrow('may not begin with "--"');
    expect(() => buildArgv("ask", { question: "you", exact: "yes" }, ctx)).toThrow("true or false");
  });

  test("runAction hands `searched` back, and the console is given the turned text", async () => {
    let seen: readonly string[] = [];
    const run: Run = async (argv, { io }) => {
      seen = argv;
      io.out("{}");
      return 0;
    };
    const r = await runAction("ask", { question: "what have you learned about yourself?", json: true }, ctx, { run });
    expect(r.status).toBe(200);
    expect(seen.at(-1)).toBe("what have I learned about myself?");
    expect(r.body.searched).toEqual({ text: "what have I learned about myself?", changed: true, exact: false });
    const note = await runAction("note", { text: "you and me" }, ctx, { run });
    expect(note.body.searched).toBeUndefined();
    expect(seen.at(-1)).toBe("you and me"); // a note is written as typed
  });
});

// ── over the wire: the server reads the owner's name off the store ──────────

let temps: string[] = [];
beforeEach(() => {
  temps = [];
});
afterEach(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function store(name: string | null): { dir: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), "counterparts-ask-voice-"));
  temps.push(root);
  const dir = join(root, "store");
  mkdirSync(dir, { recursive: true });
  Counterpart.open({ dir, owner: true, ...(name === null ? {} : { identity: { name } }) }).close();
  const config = join(root, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }));
  return { dir, config };
}

async function ask(running: RunningDashboard, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${running.url}/api/action/ask`, {
    method: "POST",
    headers: { origin: running.url, "content-type": "application/json", "x-counterparts-token": running.token },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("the dashboard's ask, over the wire", () => {
  test("a named owner's I becomes his name; exact leaves it", async () => {
    const s = store("Rosalind Achebe");
    const running = await startDashboard({ dir: s.dir, port: 0, config: s.config });
    try {
      const turned = await ask(running, { question: "what do you know about me?", json: true });
      expect(turned["exit"]).toBe(0);
      expect(turned["searched"]).toEqual({ text: "what do I know about Rosalind Achebe?", changed: true, exact: false });
      expect(String(turned["command"])).toContain("what do I know about Rosalind Achebe?");
      const exact = await ask(running, { question: "what do you know about me?", json: true, exact: true });
      expect(exact["searched"]).toEqual({ text: "what do you know about me?", changed: false, exact: true });
    } finally {
      await running.stop();
    }
  }, 60_000);

  test("a store with no name swaps the owner's I for you", async () => {
    const s = store(null);
    const running = await startDashboard({ dir: s.dir, port: 0, config: s.config });
    try {
      const turned = await ask(running, { question: "what do you know about me?", json: true });
      expect(turned["searched"]).toEqual({ text: "what do I know about you?", changed: true, exact: false });
    } finally {
      await running.stop();
    }
  }, 60_000);
});
