/**
 * CARDS ARE BORN WHERE NAMES ARE (2026-10-11, Group 3 part D; review 12 C1).
 *
 * A card used to be born only from a memory's TITLE, and an authored title is
 * a sentence, so no card was ever born on a real store. Now the boundary's
 * sleep cycle tallies the names the live memories keep saying (at least 3
 * memories on at least 2 lived days, `schemas/names.ts`) and offers each to
 * `mention()`, whose gates are unchanged. A newborn card links every memory
 * naming it, which makes it facts mode's subject channel for that name.
 *
 * The owner's spouse case is the shape (synthetic names): a person named in a
 * few memories over a few days gets a card, and a question by her name then
 * finds the same memories or more — including one that names her only in the
 * possessive. A memory that says only "my wife" is reached through an alias,
 * which the tally does not invent.
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Schemas, TUNABLES } from "../src/core/schemas/index.js";
import { tallyNames } from "../src/core/schemas/names.js";
import type { TalliedText } from "../src/core/schemas/names.js";
import { PHASES, phaseReport } from "../src/core/sleep/index.js";
import { factsRecall } from "../src/adapters/mcp/facts.js";
import { ownerRemoval } from "../src/adapters/cli/removal.js";

const NOW = Date.parse("2026-03-02T12:00:00Z");
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const BAR = {
  minMemories: TUNABLES.BIRTH_TALLY.MIN_MEMORIES,
  minDays: TUNABLES.BIRTH_TALLY.MIN_DAYS,
  lowerCaseShare: TUNABLES.BIRTH_TALLY.LOWER_CASE_SHARE,
};

let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-card-births-"));
});

afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(): Store {
  const s = Store.open({ dir, now: () => NOW });
  opened.push(s);
  return s;
}

let seq = 0;
function text(body: string, day: number, opts: { title?: string; kind?: string } = {}): TalliedText {
  seq += 1;
  return { id: `m${String(seq).padStart(3, "0")}`, title: opts.title ?? null, body, day, kind: opts.kind ?? "fact" };
}

function put(s: Store, body: string, day: number, opts: { title?: string; kind?: "fact" | "person" | "entity" } = {}): string {
  return s.put({
    type: "memory",
    kind: opts.kind ?? "fact",
    body,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    physics: { birthDay: day, lastUsedDay: day },
  });
}

/** The spouse shape: a person named in four memories over three lived days,
 *  one only in the possessive, one that is ABOUT her (titled, kind person),
 *  and one memory that names her only by her role. */
function spouse(s: Store): { naming: string[]; possessive: string; roleOnly: string } {
  const naming = [
    put(s, "Dinner at the harbour with Wren, who wants to try the new ferry route.", 1),
    put(s, "Wren is a nurse on night shifts this month, so mornings are quiet.", 2, { title: "Wren works nights", kind: "person" }),
    put(s, "Booked the ferry for the two of us; Wren picked the window seats.", 3),
  ];
  const possessive = put(s, "Picked up Wren's prescription on the way home.", 3);
  const roleOnly = put(s, "My wife thinks the garden needs a second rain barrel.", 3);
  return { naming: [...naming, possessive], possessive, roleOnly };
}

function nameOf(s: Schemas, id: string): string | undefined {
  return s.entity(id)?.name;
}

// ---------------------------------------------------------------------------

describe("the name tally (names.ts)", () => {
  test("a name in 3 memories on 2 lived days is reported; fewer memories or one day is not", () => {
    const texts = [text("Lunch with Corvin today.", 1), text("Corvin sent the plans.", 1), text("Called Corvin about the plans.", 2)];
    const r = tallyNames(texts, BAR);
    expect(r.names.map((n) => n.name)).toEqual(["Corvin"]);
    expect(r.names[0]?.memories).toHaveLength(3);
    expect(r.names[0]?.days).toBe(2);
    expect(tallyNames(texts.slice(0, 2), BAR).names).toEqual([]);
    expect(tallyNames(texts.map((t) => ({ ...t, day: 1 })), BAR).names).toEqual([]);
  });

  test("a sentence's first word does not propose a name, but counts for one proposed mid-sentence", () => {
    const starts = [text("Yesterday the rain stopped.", 1), text("Yesterday was long.", 1), text("Yesterday again.", 2)];
    expect(tallyNames(starts, BAR).names).toEqual([]);
    const mixed = [text("Corvin called.", 1), text("- Corvin again", 1), text("Spoke with Corvin at noon.", 2)];
    expect(tallyNames(mixed, BAR).names[0]?.memories).toHaveLength(3);
  });

  test("a capitalized word the store also writes in lower case, in prose, is a word, not a name", () => {
    const texts = [
      text("Pressed Stop on the timer.", 1),
      text("The Stop button stuck.", 1),
      text("We should stop early today.", 2),
      text("Remember to Stop the build.", 2),
    ];
    const r = tallyNames(texts, BAR);
    expect(r.names).toEqual([]);
    expect(r.lowerCase).toBe(1);
  });

  test("lower case in code or an address does not count against a name", () => {
    const texts = [
      text("Shipped Lanternfish to the registry.", 1),
      text("Ran `lanternfish doctor` and Lanternfish was green.", 1),
      text("The repo lives at ~/lanternfish/ and Lanternfish builds clean.", 2),
      text("Installed lanternfish@0.3.1 and told the team Lanternfish is out.", 2),
    ];
    expect(tallyNames(texts, BAR).names.map((n) => n.name)).toEqual(["Lanternfish"]);
  });

  test("weekdays and months are not names", () => {
    const texts = [text("See you on Monday at noon.", 1), text("The move is in March this year.", 1), text("Back on Monday and in March.", 2), text("Monday, then March.", 2)];
    expect(tallyNames(texts, BAR).names).toEqual([]);
  });

  test("a piece said mostly as part of a longer name gives way to the whole name", () => {
    const texts = [
      text("Closed the Copper Kettle for winter.", 1),
      text("The Copper Kettle reopens in spring.", 1),
      text("Painted the sign at the Copper Kettle.", 2),
    ];
    expect(tallyNames(texts, BAR).names.map((n) => n.name)).toEqual(["Copper Kettle"]);
  });

  test("a possessive names the person; the kind comes from what a memory is about", () => {
    const texts = [
      text("Picked up Wren's prescription.", 1),
      text("Wren is a nurse on nights.", 1, { title: "Wren works nights", kind: "person" }),
      text("Booked seats for Wren and me.", 2),
    ];
    const n = tallyNames(texts, BAR).names[0];
    expect(n?.name).toBe("Wren");
    expect(n?.memories).toHaveLength(3);
    expect(n?.titledKinds).toEqual({ person: 1 });
  });

  test("a name the caller holds is skipped", () => {
    const texts = [text("Lunch with Corvin.", 1), text("Corvin sent plans.", 1), text("Called Corvin.", 2)];
    expect(tallyNames(texts, { ...BAR, skip: (n) => n === "Corvin" }).names).toEqual([]);
  });
});

describe("cards are born from the tally, gated by mention() (Schemas#birthsFromNames)", () => {
  test("the spouse shape: one person card, kind person, linked to every memory naming her", () => {
    const s = store();
    const { naming, roleOnly } = spouse(s);
    const schemas = Schemas.open({ store: s });
    const r = schemas.birthsFromNames(4);
    expect(r.born).toHaveLength(1);
    const card = r.born[0] as string;
    expect(nameOf(schemas, card)).toBe("Wren");
    expect(schemas.entity(card)?.kind).toBe("person");
    expect(s.memoriesNaming(card).sort()).toEqual([...naming].sort());
    expect(s.memoriesNaming(card)).not.toContain(roleOnly);
    // The gates ran: one mention, one birth.
    expect(schemas.events("schema.mention")).toHaveLength(1);
    expect(schemas.events("schema.birth")).toHaveLength(1);
    // The next night offers nothing: the name has its card.
    expect(schemas.birthsFromNames(5).offered).toBe(0);
  });

  test("the identity core's name is never offered, and a near variant is refused as a collision", () => {
    const s = store();
    s.put({ type: "schema", kind: "self", title: "Rowan", body: "Rowan", meta: { role: "entity", name: "Rowan", aliases: [] } });
    for (const [body, day] of [
      ["Rowan wants the ferry plan by Friday.", 1],
      ["Talked with Rowan Hale about the ferry.", 1],
      ["Rowan Hale signed the form.", 2],
      ["Met Rowan Hale and Rowan at the dock.", 2],
    ] as const) {
      put(s, body, day);
    }
    const schemas = Schemas.open({ store: s });
    const r = schemas.birthsFromNames(3);
    expect(r.born).toEqual([]);
    expect(r.refused).toEqual({ "collision-near": 1 });
    expect(schemas.entities().filter((e) => e.kind !== "self")).toEqual([]);
  });

  test("a faded card's name is left to come back the way a faded card does", () => {
    const s = store();
    spouse(s);
    const first = Schemas.open({ store: s });
    const card = first.birthsFromNames(4).born[0] as string;
    s.archive(card, TUNABLES.FADE_REASON);
    const later = Schemas.open({ store: s });
    const r = later.birthsFromNames(9);
    expect(r.offered).toBe(0);
    expect(r.born).toEqual([]);
  });

  test("a card the owner removed is not born again, from the old memories or from new ones", () => {
    const s = store();
    const { naming } = spouse(s);
    const card = Schemas.open({ store: s }).birthsFromNames(4).born[0] as string;
    expect(card).toBeDefined();
    ownerRemoval(s, { targetId: card, actor: "owner", reason: "no card for her", requestedAt: 0 });
    // The chase blanks the card's name; what stays is the ids it linked (an
    // address, never a word or a hash of one: store CONTRACT §16 G9).
    expect(s.row(card)?.body).toBe("");
    expect(s.cardTombstoneLinks().map((l) => [...l].sort())).toEqual([[...naming].sort()]);

    const next = Schemas.open({ store: s });
    const r = next.birthsFromNames(5);
    expect(r.born).toEqual([]);
    expect(r.offered).toBe(0);
    expect(r.refused).toEqual({ "removed-by-owner": 1 });

    // Talked about on two more days: still the name the owner took the card from.
    put(s, "Wren took the early ferry again.", 6);
    put(s, "Wren and I fixed the gate.", 7);
    put(s, "Wren's sister visited for lunch.", 7);
    expect(Schemas.open({ store: s }).birthsFromNames(8).born).toEqual([]);
    // Another name in the same memories is not caught by it.
    for (const [body, day] of [["Corvin rang about the boat.", 6], ["Lunch with Corvin.", 7], ["Corvin sent the plans.", 8]] as const) {
      put(s, body, day);
    }
    const third = Schemas.open({ store: s });
    expect(third.birthsFromNames(9).born.map((id) => nameOf(third, id))).toEqual(["Corvin"]);
  });

  test("the owner's first or last name alone is refused against his two-word core", () => {
    const s = store();
    s.put({
      type: "schema",
      kind: "self",
      title: "Rowan Adler",
      body: "Rowan Adler",
      meta: { role: "entity", name: "Rowan Adler", aliases: [] },
    });
    for (const v of ["Rowan", "Adler"]) {
      put(s, `Today ${v} fixed the bike.`, 1, { title: v, kind: "person" });
      put(s, `Later ${v} went running by the river.`, 2);
      put(s, `On the trip ${v} said the hills were steep.`, 3);
    }
    const schemas = Schemas.open({ store: s });
    const r = schemas.birthsFromNames(4);
    expect(r.born).toEqual([]);
    expect(r.refused).toEqual({ "collision-near": 2 });
  });

  test("the night's limit births the most-named first and counts the rest, which come next night", () => {
    const s = store();
    for (const [name, n] of [["Corvin", 5], ["Marisol", 4], ["Tamsin", 3]] as const) {
      for (let i = 0; i < n; i += 1) put(s, `Spoke with ${name} about item ${String(i)}.`, 1 + (i % 2));
    }
    const schemas = Schemas.open({ store: s });
    const first = schemas.birthsFromNames(3, { limit: 2 });
    expect(first.born.map((id) => nameOf(schemas, id))).toEqual(["Corvin", "Marisol"]);
    expect(first.skippedForLimit).toBe(1);
    const next = schemas.birthsFromNames(4, { limit: 2 });
    expect(next.born.map((id) => nameOf(schemas, id))).toEqual(["Tamsin"]);
    expect(next.skippedForLimit).toBe(0);
  });

  test("a dry run offers and counts, and writes nothing", () => {
    const s = store();
    spouse(s);
    const schemas = Schemas.open({ store: s });
    const before = s.list({ type: "schema" }).length;
    const r = schemas.birthsFromNames(4, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.offered).toBe(1);
    expect(r.born).toEqual([]);
    expect(s.list({ type: "schema" }).length).toBe(before);
    expect(schemas.events("schema.mention")).toHaveLength(0);
  });
});

describe("through the composition: the boundary's births phase, and facts mode by name", () => {
  function brain(): Counterpart {
    const c = Counterpart.open({ dir: join(dir, "store"), now: () => NOW });
    opened.push(c);
    return c;
  }

  function ask(c: Counterpart, question: string): string[] {
    const r = factsRecall({ counterpart: c, sessionId: SESSION, vector: null, semantic: "embedder-off" }, question);
    return r.memories.map((m) => m.id);
  }

  test("a session end births the card, and asking by her name finds the same memories or more", async () => {
    const c = brain();
    const { naming, possessive, roleOnly } = spouse(c.store);
    const before = ask(c, "Wren");

    const report = await c.sessionEnd({ date: "2026-03-02" });
    expect(report.cycle.order).toEqual([...PHASES]);
    const births = phaseReport(report.cycle, "births");
    expect(births.status).toBe("ran");
    expect(births.changed).toBe(1);
    const card = c.schemas.entities().find((e) => e.name === "Wren");
    expect(card?.kind).toBe("person");

    const after = ask(c, "Wren");
    for (const id of before) expect(after).toContain(id);
    for (const id of naming) expect(after).toContain(id);
    expect(after).toContain(possessive);
    // The role word alone is not her name, and the tally invents no alias.
    expect(after).not.toContain(roleOnly);
    // The card is the index, never a result itself.
    expect(after).not.toContain(card?.id as string);

    // An alias, once the card has one, links what is written after it (a
    // subject-only match, which facts mode may still rank as a weak one).
    const aliased = c.schemas.addAliases(card?.id as string, ["my wife"], "Wren, my wife", 5);
    expect(aliased.kept).toEqual(["my wife"]);
    const later = await c.submitJot({ content: "My wife booked the ferry for Sunday.", kind: "fact" }, { session: "s1", scope: "proj" });
    expect(c.store.memoriesNaming(card?.id as string)).toContain(later.memoryId as string);
  });

  test("a turn that names her does not surface the card's stub", async () => {
    // Before the card was kept out of the candidates, this turn footnoted it.
    const c = brain();
    spouse(c.store);
    for (let i = 0; i < 30; i += 1) put(c.store, `Filler note ${String(i)} about gardening and tools.`, 1);
    await c.sessionEnd({ date: "2026-03-02" });
    const card = c.schemas.entities().find((e) => e.name === "Wren")?.id as string;
    expect(card).toBeDefined();
    const turn = c.recallForTurn({ sessionId: SESSION, text: "Wren" });
    expect([...turn.decision.surfaced, ...turn.decision.footnotes]).not.toContain(card);
  });

  test("a write never births a card, however it is titled", async () => {
    const c = brain();
    const out = await c.submitSessionEnd(
      { content: "Wren started a new job at the clinic.", kind: "person", title: "Wren" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    expect(c.schemas.entities().filter((e) => e.kind !== "self")).toEqual([]);
  });
});
