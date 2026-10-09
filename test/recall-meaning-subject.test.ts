/**
 * MEANING MODE'S SUBJECT IS THE CARD THE QUESTION IS ABOUT (2026-10-09).
 *
 * It was the card with the most memories. On a real store that is usually
 * the owner's own card, so "what has Ilya been to Mike" answered about Mike,
 * with Ilya under "also named" (found on the dashboard in the review of
 * #333; the `recall` tool picked the same way). Now the question's grammar
 * and the order of its names choose (`meaning.ts#subjectOf`), and counts only
 * break a tie.
 *
 * Every answer here comes through a real door on a seeded demo store: the
 * MCP `recall` tool (`mode: "meaning"`, the counterpart asking, so "you" is
 * the owner), and the console's `counterparts ask --mode meaning` (the owner
 * asking, so "I" is the owner). The cards are read off the store, not typed
 * in, and the counts the bug needs are checked before anything is asked: the
 * owner's card outnumbers one person, and another person outnumbers both.
 *
 * Hermetic: one temp store, seeded once, removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/commands.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import type { MeaningResult } from "../src/adapters/mcp/meaning.js";
import { Counterpart } from "../src/core/counterpart.js";
import { findIdentityCore } from "../src/core/self/index.js";
import { seedDemo } from "../tools/demo/seed.js";

let work: string;
let dir: string;
/** The owner's card, a person with fewer memories than it, and a person with more than that one. */
let owner: { name: string; count: number };
let fewer: { name: string; count: number };
let more: { name: string; count: number };

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "counterparts-meaning-subject-"));
  dir = join(work, "store");
  await seedDemo({ dir });
  const c = Counterpart.open({ dir, owner: true });
  try {
    const core = findIdentityCore(c.store);
    if (core === null) throw new Error("the demo store has no owner card");
    owner = { name: c.schemas.entity(core)?.name ?? "", count: c.store.memoriesNaming(core).length };
    const people = c.schemas
      .entities()
      .filter((e) => e.kind === "person" && e.id !== core)
      .map((e) => ({ name: e.name, count: c.store.memoriesNaming(e.id).length }))
      .filter((p) => p.count > 0)
      .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
    fewer = people[0] as { name: string; count: number };
    more = people[people.length - 1] as { name: string; count: number };
  } finally {
    c.close();
  }
}, 120_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

test("the store reaches the bug: the owner's card outnumbers one person, another person outnumbers that one", () => {
  expect(owner.name.length).toBeGreaterThan(0);
  expect(fewer.count).toBeLessThan(owner.count);
  expect(more.count).toBeGreaterThan(fewer.count);
  expect(more.name).not.toBe(fewer.name);
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the recall tool, meaning mode", () => {
  let s: McpServer;
  beforeAll(() => {
    s = openServer({ dir, session: "sess_subject", scope: "/subject", owner: true });
  });
  afterAll(() => {
    s.counterpart.close();
  });

  /** The answer's header line (the subject first) and the whole answer. */
  async function recall(question: string): Promise<{ head: string; answer: string }> {
    const r = (await s.call("recall", { question, mode: "meaning" })).structuredContent as Record<string, unknown>;
    expect(r["mode"]).toBe("meaning");
    const answer = String(r["answer"]);
    return { head: answer.split("\n")[0] ?? "", answer };
  }

  test("the owner named beside a less-remembered person: the one asked about, in either order", async () => {
    const toOwner = await recall(`what has ${fewer.name} been to ${owner.name}`);
    expect(toOwner.head).toStartWith(`${fewer.name} · `);
    expect(toOwner.answer).toContain(`also named: ${owner.name} (`);
    expect(toOwner.answer).not.toContain("alike");
    // The other way round, the grammar puts the owner in the subject's place.
    const ofOwner = await recall(`what has ${owner.name} been to ${fewer.name}`);
    expect(ofOwner.head).toStartWith(`${owner.name} · `);
    expect(ofOwner.answer).toContain(`also named: ${fewer.name} (`);
  });

  test("two people: the one asked about, whichever has more memories, in either order", async () => {
    expect((await recall(`what has ${fewer.name} been to ${more.name}`)).head).toStartWith(`${fewer.name} · `);
    expect((await recall(`what has ${more.name} been to ${fewer.name}`)).head).toStartWith(`${more.name} · `);
    // "since Y" is when, not who.
    expect((await recall(`how has ${fewer.name} changed since ${more.name} arrived?`)).head).toStartWith(`${fewer.name} · `);
    expect((await recall(`how has ${more.name} changed since ${fewer.name} arrived?`)).head).toStartWith(`${more.name} · `);
    // "what happened to X" asks about X; "after Y left" is when.
    expect((await recall(`what happened to ${fewer.name} after ${more.name} left`)).head).toStartWith(`${fewer.name} · `);
    expect((await recall(`what happened to ${more.name} after ${fewer.name} left`)).head).toStartWith(`${more.name} · `);
    // "my arc with X": the person, though a bigger card is named after.
    const arc = await recall(`my arc with ${fewer.name}, and where ${more.name} fits`);
    expect(arc.head).toStartWith(`${fewer.name} · `);
    expect(arc.answer).not.toContain("alike");
    const arcTurned = await recall(`my arc with ${more.name}, and where ${fewer.name} fits`);
    expect(arcTurned.head).toStartWith(`${more.name} · `);
  });

  test("named alike with no grammar between them: the owner leaves it to the other; two others, the first, said so", async () => {
    const pair = await recall(`${owner.name} and ${fewer.name}`);
    expect(pair.head).toStartWith(`${fewer.name} · `);
    expect(pair.answer).not.toContain("alike");
    const both = await recall(`tell me about ${fewer.name} and ${more.name}`);
    expect(both.head).toStartWith(`${fewer.name} · `);
    expect(both.answer).toContain(`it asks about ${fewer.name} and ${more.name} alike: this follows ${fewer.name}, named first`);
    expect(both.answer).toContain(`also named: ${more.name} (`);
    const turned = await recall(`tell me about ${more.name} and ${fewer.name}`);
    expect(turned.head).toStartWith(`${more.name} · `);
    expect(turned.answer).toContain(`it asks about ${more.name} and ${fewer.name} alike`);
  });

  test('"you" — the owner, to me — asked about is his card; anywhere else it names nothing', async () => {
    expect((await recall("what have you been like")).head).toStartWith(`${owner.name} · `);
    expect((await recall("how have you changed?")).head).toStartWith(`${owner.name} · `);
    // Beside a person: the grammar still chooses, and he leaves a place he shares.
    expect((await recall(`what has ${fewer.name} been to you`)).head).toStartWith(`${fewer.name} · `);
    expect((await recall(`how have you and ${fewer.name} been`)).head).toStartWith(`${fewer.name} · `);
    expect((await recall(`how have things been between you and ${fewer.name}?`)).head).toStartWith(`${fewer.name} · `);
    expect((await recall(`what have you been to ${fewer.name}`)).head).toStartWith(`${owner.name} · `);
    // Not asked about: the question's words, as before.
    expect((await recall("do you remember the swap sheet")).head).not.toStartWith(owner.name);
    // A question about feeling: "you" says whose feeling, not whose card.
    const felt = await recall("how have you felt lately");
    expect(felt.head).not.toStartWith(owner.name);
    expect(felt.answer).toContain("feeling asked:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the console's ask --mode meaning: the owner asking, so \"I\" is his", () => {
  async function ask(question: string, extra: readonly string[] = []): Promise<MeaningResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["ask", question, "--mode", "meaning", "--json", ...extra, "--dir", dir], {
      io: { out: (l) => out.push(l), err: (l) => err.push(l) },
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: join(work, "home"),
    });
    expect(err.join("\n")).toBe("");
    expect(code).toBe(0);
    return JSON.parse(out.join("\n")) as MeaningResult;
  }

  test('"what have I been like" is his card; "… to me" is the person; "my" owns a topic, not him', async () => {
    expect((await ask("what have I been like")).lens).toMatchObject({ kind: "card", name: owner.name });
    expect((await ask("how have I changed")).lens).toMatchObject({ kind: "card", name: owner.name });
    const toMe = await ask(`what has ${fewer.name} been to me`);
    expect(toMe.lens).toMatchObject({ kind: "card", name: fewer.name });
    expect(toMe.others).toEqual([]);
    expect((await ask("how has my swap sheet gone")).lens?.name).not.toBe(owner.name);
    // In my voice (--voiced) "I" is me, not him.
    expect((await ask("what have I been like", ["--voiced"])).lens?.name).not.toBe(owner.name);
  });
});
