/**
 * The owner is named, never gendered (2026-09-27, found in the 0.3.5 release
 * check). Every line the reflection, the dream and the memory tools say about
 * the owner uses the name the store knows (the identity core's `name`, `init
 * --name`) — or "the owner" / "them" when there is none — and never he, him,
 * his or himself.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import { TOOLS, renderDescription } from "../src/adapters/mcp/tools.js";
import { Counterpart } from "../src/core/counterpart.js";
import { REFLECT_QUESTIONS } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";

const NAME = "Rosalind Achebe";
const GENDERED = /\b(he|him|his|himself|she|her|hers|herself)\b/i;
const SESSION = "s-owner-name";

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-owner-name-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(name: string | null = NAME): Counterpart {
  // The calendar follows the test's days (the gates are the calendar date since 2026-09-28).
  const c = Counterpart.open({ dir, ...(name === null ? {} : { identity: { name } }), now: () => Date.now() + dateN * 86_400_000 });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): void {
  dateN += 1;
  c.store.advanceClock(new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10));
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

/** A lived stretch and a journaled dream that flagged a contradiction about the owner. */
function dreamed(c: Counterpart): { dream: string; felt: string; person: string } {
  nextDay(c);
  for (let i = 0; i < 3; i += 1) nextDay(c);
  const felt = mem(c, `I felt proud when ${NAME} said the rota finally reads like a person wrote it.`, {
    kind: "self",
    about: "me",
    salience: { relevance: 0.8, emotional: 0.8, predictive: 0.5 },
  });
  const person = mem(c, `${NAME} wants the swap sheet shipped this Thursday.`, { kind: "person", about: "owner" });
  const other = mem(c, `${NAME} said the swap sheet can wait until next month.`, { kind: "person", about: "owner" });
  mem(c, "The swap sheet deploys when main is pushed.", { kind: "fact" });
  const begun = c.dreams.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`dream refused: ${begun.reason}`);
  const p = c.dreams.propose({ dream: begun.bundle.dream, session: SESSION, changes: [{ action: "contradiction", a: person, b: other }] });
  if (!p.ok) throw new Error("propose refused");
  const j = c.dreams.journal({ dream: begun.bundle.dream, session: SESSION, title: "the rota", text: "I dreamed the rota was a letter." });
  if (!j.ok) throw new Error("journal refused");
  return { dream: begun.bundle.dream, felt, person };
}

describe("the owner is named, never gendered", () => {
  test("the question list and every memory tool's text carry no gendered pronoun", () => {
    for (const q of REFLECT_QUESTIONS) expect(q.text).not.toMatch(GENDERED);
    for (const spec of TOOLS) {
      const text = `${renderDescription(spec)}\n${JSON.stringify(spec)}`;
      expect({ tool: spec.name, gendered: GENDERED.test(text) }).toEqual({ tool: spec.name, gendered: false });
    }
  });

  test("the reflection's prompts, hand-back and carried share use the configured name", () => {
    const c = brain();
    const d = dreamed(c);
    const launch = c.reflections.launchPrompt({ session: SESSION });
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "I keep wanting the rota to read like a person wrote it.",
      cites: [d.felt],
      share: { text: "Last night I dreamed the rota was a letter — I think because it should read like a person wrote it.", cites: [d.felt] },
    });
    if (!done.ok) throw new Error(done.reason);
    const carried = c.reflections.carryLine({ session: "s-next", reflection: begun.bundle.reflection });
    const said = { launch, instructions: begun.instructions, handBack: done.outcome.handBack, carried: carried ?? "" };
    for (const [where, text] of Object.entries(said)) {
      expect({ where, named: text.includes(NAME) }).toEqual({ where, named: true });
      expect({ where, gendered: text.match(GENDERED)?.[0] ?? null }).toEqual({ where, gendered: null });
    }
    expect(said.handBack).toContain(`tentatively where it is about ${NAME}`);
    expect(said.carried).toContain(`tentatively where it is about ${NAME}`);
  });

  test("a question that speaks of the owner names them, across the rotation", () => {
    const c = brain();
    nextDay(c);
    const asked: string[] = [];
    for (let i = 0; i < REFLECT_QUESTIONS.length; i += 1) {
      nextDay(c);
      const begun = c.reflections.begin({ session: SESSION });
      if (!begun.ok) throw new Error(begun.reason);
      asked.push(...begun.bundle.questions);
      const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Nothing much.", cites: [] });
      if (!done.ok) throw new Error(done.reason);
    }
    const aboutOwner = asked.filter((q) => q.includes(NAME));
    expect(aboutOwner).toContain(`What did ${NAME} seem to need but not say?`);
    for (const q of asked) {
      expect(q).not.toContain("{owner}");
      expect(q).not.toMatch(GENDERED);
    }
  });

  test("a dream's flagged contradiction about the owner is raised with the owner, by name", () => {
    const c = brain();
    dreamed(c);
    const lines = c.dreams.raiseLines({ session: "s-next" });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`It is about ${NAME}, or the two of you: raise it with ${NAME}.`);
    expect(lines[0]).not.toMatch(GENDERED);
  });

  test("with no name on the store, the lines say \"the owner\" — still no pronoun", () => {
    const c = brain(null);
    const d = dreamed(c);
    const raised = c.dreams.raiseLines({ session: "s-next" }).join("\n");
    const begun = c.reflections.begin({ session: SESSION, dream: d.dream });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "I keep wanting the rota to read like a person wrote it.",
      cites: [d.felt],
      share: { text: "I've been thinking about the rota.", cites: [d.felt] },
    });
    if (!done.ok) throw new Error(done.reason);
    for (const text of [raised, begun.instructions, done.outcome.handBack, c.reflections.launchPrompt({ session: SESSION })]) {
      expect(text).toContain("the owner");
      expect(text).not.toMatch(GENDERED);
    }
  });

  test("`core --reflected-feeling on` answers the way `off` does: \"On:\" then the sentence, not \"On. a …\"", async () => {
    brain().close();
    open.splice(0);
    for (const value of ["on", "off"]) {
      const out: string[] = [];
      const code = await run(["core", "--reflected-feeling", value, "--dir", dir], { io: { out: (l) => out.push(l), err: () => undefined } });
      expect(code).toBe(0);
      expect(out[0]).toMatch(value === "on" ? /^On: a feeling/ : /^Off: nothing/);
      expect(out[0]).not.toMatch(/^\w+\. [a-z]/);
    }
  });
});
