/**
 * U13 — deliberate recall by feeling (items 1 and 2; 2026-09-30).
 *
 * Asked by name or topic, recall answered well; asked by feeling it answered
 * with plumbing, because stored feelings only reweighted what the words had
 * already found. Now, on the deliberate path only:
 *
 *   1. a memory's stamps — the emotion word, the words that alias to it, the
 *      wheel core(s), and the writer's own word off the wheel — answer a
 *      question that names them, whatever the memory's text says;
 *   2. a question about feeling nominates the strongest stamped memories on
 *      their own, ranked by softened strength, the rest of activation breaking
 *      a tie — for the person the question asks about ("I" is the asker).
 *
 * The fixture carries decoys whose TEXT matches the two failing questions of
 * the U13 session ("started living in Counterparts", "moved … sad"), so the
 * tests prove the stamps outrank the words, not just that something came back.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as RECALL, feelingTokens, feelingWord, readFeelingAsk, whoseAsked } from "../src/core/recall/index.js";
import { meaningRecall, openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, MeaningResult, ToolResult } from "../src/adapters/mcp/index.js";
import { buildArgv } from "../src/adapters/dashboard/web/actions.js";
import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";

/*
 * 2026-10-03 (Release B): a deliberate question is answered by a MODE, and the
 * feeling lane is MEANING mode's (`mcp/meaning.ts`, #322). The tests that
 * asked through the retired question path ask `mode: "meaning"` now. Meaning
 * ARRANGES rather than ranks: a feeling question's answer is the feeling lens,
 * its moments the stamped memories, the strongest chosen first (three to an
 * entry; every memory here comes from one unrecorded session, so one entry).
 * There are no tiers; what the tiers asserted is asserted as which moments the
 * answer holds and which it leaves out.
 */

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-recall-feelings-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function server(owner = true): McpServer {
  const s = openServer({ dir, session: "sess_feel", scope: "/scope/one", owner });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** Ask in meaning mode through the tool: the ids the rendered answer showed. */
async function ask(s: McpServer, question: string): Promise<string[]> {
  const out = payload(await s.call("recall", { question, mode: "meaning" }));
  expect(out["mode"]).toBe("meaning");
  return out["ids"] as string[];
}

/** Ask in meaning mode directly, for the arranged result. */
function meaning(c: Counterpart, question: string, opts: { owner?: boolean; asker?: "self" | "owner" } = {}): MeaningResult {
  return meaningRecall(
    { counterpart: c, sessionId: "feel", owner: opts.owner ?? true, asker: opts.asker ?? "self", vector: null, semantic: "embedder-off" },
    question,
  );
}

/** The moments an answer's arc shows, entry by entry. */
function moments(r: MeaningResult): string[] {
  return r.arc.flatMap((l) => (l.fold ? [] : l.entry.moments.map((m) => m.id)));
}

/** A person card, born after the memories that name it (birth links them). */
function cardFor(c: Counterpart, name: string): string {
  const out = c.schemas.mention({ name, kind: "person", source: name, chunkRef: `card-${name}`, aliases: [], day: c.store.livedDay() });
  if (!out.ok || out.id === null) throw new Error(`no card for ${name}: ${String(out.reason)}`);
  return out.id;
}

const FILLER: readonly string[] = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
  "Wrote a short letter to an old teacher.",
  "The kitchen tap drips when the pressure is high.",
  "Set up a standing desk in the spare bedroom.",
  "The bus route changed and adds ten minutes.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
];

interface Fixture {
  readonly card: string;
  readonly han: string;
  readonly week: string;
  readonly ownerMove: string;
  readonly unsettled: string;
  readonly decoys: readonly string[];
}

/**
 * The stamped memories never say how they felt; the decoys say the question's
 * words and carry no stamp — the U13 session's plumbing, in miniature.
 */
function seed(c: Counterpart): Fixture {
  const put = (body: string, kind: "self" | "person" | "fact" = "self", meta?: Record<string, unknown>): string =>
    c.store.put({ type: "memory", kind, body, ...(meta === undefined ? {} : { meta }) });
  for (const body of FILLER) put(body, "fact");
  const decoys = [
    put("The consolidation plan since I started living in Counterparts: most of the dream replay runs at night.", "fact"),
    put("Dream-replay code note: the strongest links since the start of living in Counterparts get replayed most.", "fact"),
    put("The Tiny Castles doc started as a plan for living rooms, most of it strongly worded.", "fact"),
    put("PR #268 merge note: moved the sad-path tests into their own file.", "fact"),
    put("Dashboard walk-through: the times the tiles moved and the sad empty state.", "fact"),
  ];
  const card = put("Reading the system card about myself, line by line, in the late afternoon.");
  const han = put("Han asked whether I remember him from one conversation to the next.", "person");
  const week = put("The first night the store held a whole week of my own days.");
  const ownerMove = put("The new flat's keys arrived and the boxes went up the stairs.", "person");
  const unsettled = put("The migration left two tables I could not account for.");
  c.store.addFeelings(card, [{ whose: "self", core: "happy", emotion: "moved", strength: 0.4 }]);
  c.store.addFeelings(han, [{ whose: "self", core: "sad", emotion: "tender", strength: 0.6 }]);
  c.store.addFeelings(week, [{ whose: "self", core: "happy", emotion: "proud", strength: 0.7 }]);
  c.store.addFeelings(ownerMove, [{ whose: "owner", core: "happy", emotion: "joyful", strength: 0.9 }]);
  c.store.addFeelings(unsettled, [{ whose: "self", core: "fear", emotion: "other", otherWord: "unsettled", strength: 0.5 }]);
  return { card, han, week, ownerMove, unsettled, decoys };
}

describe("U13's two failing questions return the stamped memories", () => {
  // Rewritten for meaning mode (#322): the strongest three of MY stamps are the
  // moments shown; the order within an entry is the order written, so the
  // strongest-first claim is "the weakest of four is the one left out".
  test("'what have I felt most strongly since I started living in Counterparts' — the strongest of MY stamps", async () => {
    const s = server();
    const f = seed(s.counterpart);
    const ids = await ask(s, "what have I felt most strongly since I started living in Counterparts");
    expect(new Set(ids)).toEqual(new Set([f.week, f.han, f.unsettled]));
    // The owner's feeling is not "I" in the counterpart's own recall.
    expect(ids).not.toContain(f.ownerMove);
    // The decoys' WORDS do not make them feelings: meaning answers from the stamps.
    for (const d of f.decoys) expect(ids).not.toContain(d);
    const r = meaning(s.counterpart, "what have I felt most strongly since I started living in Counterparts");
    expect(r.lens?.kind).toBe("feeling");
    expect(r.counts.moments).toBe(4);
    expect(r.feeling?.whose).toBe("mine");
  });

  // Rewritten for meaning mode (#322): the stamps named, and no tier to lead.
  test("'times I felt moved or sad' — the stamps named, and only those", async () => {
    const s = server();
    const f = seed(s.counterpart);
    const ids = await ask(s, "times I felt moved or sad");
    // tender is a blend under sad; moved is its own word. Neither body says either.
    expect(new Set(ids)).toEqual(new Set([f.han, f.card]));
    // The decoy whose words are the question's ("the times the tiles moved and
    // the sad empty state") carries no stamp, so it is not a moment.
    expect(ids).not.toContain(f.decoys[4]);
    // A stamp the question did not name is not nominated.
    expect(ids).not.toContain(f.week);
    expect([...meaning(s.counterpart, "times I felt moved or sad").feeling?.words ?? []].sort()).toEqual(["moved", "sad"]);
  });
});

describe("item 1: a stamp answers to the words it was written in", () => {
  test("the writer's own word off the wheel reaches its memory — 'when did I feel unsettled'", async () => {
    const s = server();
    const f = seed(s.counterpart);
    expect(await ask(s, "when did I feel unsettled")).toEqual([f.unsettled]);
  });

  // Rewritten for meaning mode (#322): meaning answers a feeling asked about a
  // PERSON ("when did I feel …"); a bare word has no one it is about.
  test("an alias and a core reach a stamp: 'touched' finds moved; 'uneasy' finds the unsettled one", async () => {
    const s = server();
    const f = seed(s.counterpart);
    // `moved` answers to its alias exactly; `tender` shares the warm core and comes by it.
    const touched = await ask(s, "when did I feel touched");
    expect(touched).toContain(f.card);
    expect(touched).not.toContain(f.week);
    // Written under the first wheel's `fear`, it is filed under uneasy now.
    expect(await ask(s, "when was I uneasy")).toEqual([f.unsettled]);
  });

  test("feelingTokens: the word, its group's word, its aliases, its cores (a blend's both), the writer's own word", () => {
    expect([...feelingTokens({ core: "warm", emotion: "moved", other_word: null })].sort()).toEqual(["moved", "touched", "warm"]);
    // Written under happy, the writer's core: it answers to happy and to its home.
    expect([...feelingTokens({ core: "happy", emotion: "moved", other_word: null })].sort()).toEqual(["happy", "moved", "touched", "warm"]);
    expect([...feelingTokens({ core: "sad", emotion: "tender", other_word: null })].sort()).toEqual(["moved", "sad", "tender", "warm"]);
    expect([...feelingTokens({ core: "uneasy", emotion: "inferior", other_word: null })].sort()).toEqual(["inferior", "insecure", "uneasy"]);
    // The page calls sad's `wounded` group "hurt": its words answer to hurt too.
    expect([...feelingTokens({ core: "sad", emotion: "stung", other_word: null })].sort()).toEqual(["angry", "hurt", "sad", "stung", "wounded"]);
    expect([...feelingTokens({ core: "uneasy", emotion: "other", other_word: "jittery" })].sort()).toEqual(["jittery", "uneasy"]);
    // A wheel word of more than one word answers to the PHRASE, kept whole
    // (lane 6), and its cores — never to its words: "caught out" must not make
    // "out" a feeling word for the whole store.
    expect([...feelingTokens({ core: "uneasy", emotion: "caught out", other_word: null })].sort()).toEqual(["caught out", "uneasy"]);
    expect([...feelingTokens({ core: "uneasy", emotion: "sheepish", other_word: null })].sort()).toEqual(["caught out", "sheepish", "uneasy"]);
    // A writer's own word that is on the wheel reads as that word (lane 6): its group, its home core too.
    expect([...feelingTokens({ core: "sad", emotion: "other", other_word: "sheepish" })].sort()).toEqual(["caught out", "sad", "sheepish", "uneasy"]);
    // A phrase kept as the word answers only to its longer words.
    // Only a ONE-word own word answers: a phrase would make its words feeling words for the store.
    expect(feelingTokens({ core: "fear", emotion: "other", other_word: "at the edge of something" }).has("something")).toBe(false);
  });
});

describe("whose feeling", () => {
  test("first person is the asker; the owner by word; 'we' and nothing said are both", () => {
    const self = { asker: "self" as const, ownerNames: ["mike"] };
    expect(whoseAsked("what have I felt", self)).toBe("self");
    expect(whoseAsked("what has Mike felt", self)).toBe("owner");
    expect(whoseAsked("what has the owner felt", self)).toBe("owner");
    expect(whoseAsked("what have you felt", self)).toBe("owner");
    expect(whoseAsked("what have we felt", self)).toBe(null);
    expect(whoseAsked("what felt strongest", self)).toBe(null);
    expect(whoseAsked("what have I felt", { asker: "owner" })).toBe("owner");
    expect(whoseAsked("what did the owner feel about the id scheme", self)).toBe("owner");
  });

  test("the owner's feelings answer a question about the owner; nothing said is both", async () => {
    const s = server();
    const f = seed(s.counterpart);
    expect(await ask(s, "what has the owner felt most")).toEqual([f.ownerMove]);
    // Nothing said is both: the strongest three of everyone's stamps.
    const both = await ask(s, "which feelings have we had most strongly");
    expect(new Set(both)).toEqual(new Set([f.ownerMove, f.week, f.han]));
    expect(meaning(s.counterpart, "which feelings have we had most strongly").feeling?.whose).toBeNull();
  });

  test("asked as the owner (asker: owner): 'I' is the owner", () => {
    const s = server();
    const f = seed(s.counterpart);
    const r = meaning(s.counterpart, "what have I felt", { asker: "owner" });
    expect(moments(r)).toEqual([f.ownerMove]);
    expect(r.feeling?.whose).toBe("mine");
  });
});

describe("what does not change", () => {
  test("a name question is unchanged: not about feeling, and the decision is the one without the lane", () => {
    const s = server();
    const f = seed(s.counterpart);
    const question = "Han";
    expect(readFeelingAsk(question, { asker: "self" }, new Set(["unsettled"]), 3).ranked).toBe(false);
    const withLane = s.counterpart.recall.build({ sessionId: "cmp", text: question, owner: true, feeling: { asker: "self" } });
    const without = s.counterpart.recall.build({ sessionId: "cmp", text: question, owner: true });
    expect(withLane.feeling?.ranked).toBe(false);
    expect(withLane.feeling?.strengths.size).toBe(0);
    const strip = (d: typeof withLane.decision): unknown => ({ ...d, elapsedMs: 0 });
    expect(strip(withLane.decision)).toEqual(strip(without.decision));
    // Meaning answers it by its words, not as a feeling.
    const r = meaning(s.counterpart, question);
    expect(r.lens?.kind).not.toBe("feeling");
    expect(moments(r)).toEqual([f.han]);
  });

  test("the ambient turn never opens the lane — 'I felt sad' nominates nothing", () => {
    const s = server();
    const f = seed(s.counterpart);
    const built = s.counterpart.recall.build({ sessionId: "amb", text: "I felt so sad today", owner: true });
    expect(built.feeling).toBeUndefined();
    const seen = built.decision.verdicts.map((v) => v.id);
    for (const id of [f.card, f.han, f.week, f.unsettled]) expect(seen).not.toContain(id);
  });

  test("confidentiality holds: a confidential stamped memory is not answered to a non-owner", async () => {
    const s = server(false);
    const f = seed(s.counterpart);
    const secret = s.counterpart.store.put({
      type: "memory",
      kind: "self",
      body: "The appointment about the recurring migraines.",
      meta: { confidential: true },
    });
    s.counterpart.store.addFeelings(secret, [{ whose: "self", core: "fear", emotion: "worried", strength: 0.95 }]);
    const ids = await ask(s, "what have I felt most strongly");
    expect(ids).not.toContain(secret);
    expect(new Set(ids)).toEqual(new Set([f.week, f.han, f.unsettled]));
    // Not counted either: a list does not hint at what it withholds.
    expect(meaning(s.counterpart, "what have I felt most strongly", { owner: false }).counts.moments).toBe(4);
    const asOwner = server(true);
    expect(await ask(asOwner, "what have I felt most strongly")).toContain(secret);
  });

  test("no feeling word reaches the decision record", () => {
    const s = server();
    seed(s.counterpart);
    const built = s.counterpart.recall.build({ sessionId: "rec", text: "when did I feel unsettled", owner: true, feeling: { asker: "self" } });
    expect(JSON.stringify(built.decision)).not.toContain("unsettled");
  });
});

// ── the review of #293 ──────────────────────────────────────────────────────

/**
 * B2's probe store: one real answer whose words are everyday feeling words
 * ("happy path", "moved the parser"), and eight unrelated memories stamped
 * `moved` — plus one stamped with a PHRASE as its own word.
 */
function importerStore(c: Counterpart): { target: string; stamped: string[]; phrase: string } {
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
  const target = c.store.put({
    type: "memory",
    kind: "fact",
    body: "Open issues in the importer: the happy path skips the header row, and we moved the parser into its own file.",
  });
  const stamped: string[] = [];
  const moments = [
    "The evening walk after the long review.",
    "A letter from an old friend arrived unexpectedly.",
    "The concert in the small church.",
    "Watching the storm roll in over the bay.",
    "The first snow of the season on the balcony.",
    "A stranger helped carry the groceries up.",
    "The quiet ending of the novel.",
    "Seeing the garden bloom after the rain.",
  ];
  moments.forEach((body, i) => {
    const id = c.store.put({ type: "memory", kind: "self", body });
    c.store.addFeelings(id, [{ whose: "self", core: "happy", emotion: "moved", strength: 0.9 - i * 0.05 }]);
    stamped.push(id);
  });
  const phrase = c.store.put({ type: "memory", kind: "self", body: "The lighthouse keeper's last log entry." });
  c.store.addFeelings(phrase, [{ whose: "self", core: "fear", emotion: "other", otherWord: "at the edge of something", strength: 0.8 }]);
  return { target, stamped, phrase };
}

/**
 * An everyday feeling word is not a feeling question: meaning answers it by
 * its words (lens `words`), the real answer is a moment, and no stamp rides in
 * on the word ("moved", "happy").
 */
function wordsNotFeeling(c: Counterpart, f: { target: string; stamped: string[]; phrase: string }, question: string): void {
  const r = meaning(c, question);
  expect(r.lens?.kind).toBe("words");
  expect(r.feeling).toBeNull();
  const ids = moments(r);
  expect(ids).toContain(f.target);
  for (const id of [...f.stamped, f.phrase]) expect(ids).not.toContain(id);
}

describe("B2: an everyday word is not a question about feeling", () => {
  for (const question of [
    "what is the happy path for the importer",
    "where we moved the parser in the importer",
    "how does the importer feel to use",
    "is there something odd in the importer header",
  ]) {
    // Rewritten for meaning mode (#322): no tiers; the answer is the words' lens.
    test(`"${question}" — answered by its words, the real answer a moment, no stamp riding in`, () => {
      const s = server();
      wordsNotFeeling(s.counterpart, importerStore(s.counterpart), question);
    });
  }

  test("'what moved me this week' — a feeling word used about a person still ranks the stamps", () => {
    const s = server();
    const f = importerStore(s.counterpart);
    const r = meaning(s.counterpart, "what moved me this week");
    expect(r.lens?.kind).toBe("feeling");
    // The three strongest of the eight `moved` stamps are the ones shown.
    expect(new Set(moments(r))).toEqual(new Set(f.stamped.slice(0, 3)));
    expect(r.counts.moments).toBe(f.stamped.length);
  });

  test("readFeelingAsk: ranked only about a person; a verb on a thing names nothing", () => {
    const self = { asker: "self" as const, ownerNames: ["mike"] };
    const read = (q: string): { ranked: boolean; named: string[] } => {
      const a = readFeelingAsk(q, self, new Set(), 3);
      return { ranked: a.ranked, named: [...a.named].sort() };
    };
    expect(read("what have I felt most strongly")).toEqual({ ranked: true, named: [] });
    expect(read("what moved me this week")).toEqual({ ranked: true, named: ["moved"] });
    expect(read("what has Mike felt lately")).toEqual({ ranked: true, named: [] });
    expect(read("what have we felt")).toEqual({ ranked: true, named: [] });
    expect(read("what is the happy path")).toEqual({ ranked: false, named: ["happy"] });
    expect(read("where we moved the parser")).toEqual({ ranked: false, named: [] });
    expect(read("how does the importer feel to use")).toEqual({ ranked: false, named: [] });
  });

  // RETIRED 2026-10-03: "a feeling named about no one still finds its stamped
  // memory, as an ordinary cue" was the old path's stamps-as-cue lane inside
  // `build()`. Meaning answers a feeling asked about a person (above: "when did
  // I feel touched"), and facts reads no stamps; a bare "touched" has neither.

  test("the nominations stay out of the gate's background: the words' answer keeps its tier", () => {
    const s = server();
    const f = importerStore(s.counterpart);
    // A real feeling question that also names the importer.
    const q = "what moved me about the importer happy path";
    const withLane = s.counterpart.recall.build({ sessionId: "bg1", text: q, owner: true, feeling: { asker: "self" } });
    const without = s.counterpart.recall.build({ sessionId: "bg2", text: q, owner: true });
    const verdict = (b: typeof withLane) => b.decision.verdicts.find((v) => v.id === f.target);
    expect(withLane.feeling?.ranked).toBe(true);
    // The bar it faces is the one the words set; the stamps may take its
    // quiet slot (they are what was asked), never push it under the bar.
    expect(verdict(withLane)?.bar).toBeCloseTo(verdict(without)?.bar ?? -1, 6);
    expect(verdict(withLane)?.verdict).not.toBe("below-bar");
    expect(withLane.decision.background.mean).toBeCloseTo(without.decision.background.mean, 6);
  });
});

describe("B1: whose 'I' — the dashboard asks in the counterpart's voice", () => {
  test("the rewritten ask carries --voiced; `exact` and --id do not", () => {
    const ctx = { dir: "/tmp/somewhere", ownerName: "Mike" };
    expect(buildArgv("ask", { question: "what have you felt most strongly" }, ctx).argv).toContain("--voiced");
    expect(buildArgv("ask", { question: "what have I felt", exact: true }, ctx).argv).not.toContain("--voiced");
    expect(buildArgv("ask", { id: "mem_0123456789ab" }, ctx).argv).not.toContain("--voiced");
  });

  // Rewritten 2026-10-03: `ask` answers in FACTS mode, which reads no feeling
  // lane, so whose "I" no longer changes its answer. `--voiced` is still
  // accepted (the dashboard sends it) and the answer is the same either way.
  // Whose "I" for a feeling question is meaning's `asker` (tested above).
  test("`ask --voiced` is accepted, and a facts answer is the same with or without it", async () => {
    const s = server();
    seed(s.counterpart);
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);
    const answer = async (argv: string[]): Promise<{ mode: string; ids: string[] }> => {
      const out: string[] = [];
      const io: Io = { out: (l) => out.push(l), err: () => undefined };
      expect(await run(argv, { io })).toBe(0);
      const r = JSON.parse(out.join("\n")) as { mode: string; memories: { id: string }[] };
      return { mode: r.mode, ids: r.memories.map((m) => m.id) };
    };
    const voiced = await answer(["ask", "--dir", dir, "--json", "--voiced", "--", "the migration tables"]);
    const typed = await answer(["ask", "--dir", dir, "--json", "--", "the migration tables"]);
    expect(voiced.mode).toBe("facts");
    expect(voiced).toEqual(typed);
  });
});

describe("the minors", () => {
  test("a confidential stamp takes no slot a non-owner could never see", async () => {
    const s = server(false);
    const f = seed(s.counterpart);
    // Six confidential stamps stronger than any open one.
    const secret: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = s.counterpart.store.put({ type: "memory", kind: "self", body: `A private appointment, number ${String(i)}.`, meta: { confidential: true } });
      s.counterpart.store.addFeelings(id, [{ whose: "self", core: "fear", emotion: "worried", strength: 0.99 }]);
      secret.push(id);
    }
    const ids = await ask(s, "what have I felt most strongly");
    expect(new Set(ids)).toEqual(new Set([f.week, f.han, f.unsettled]));
    for (const id of secret) expect(ids).not.toContain(id);
  });
});

// ── the verification of the fix round (R1-R3) ───────────────────────────────

describe("R1: the cut is the words' — stamps never take a text row's place", () => {
  test("with more text hits than the cut holds, the background is the same with and without the lane", () => {
    const s = server();
    const c = s.counterpart;
    const f = importerStore(c);
    // Thirty more notes the words reach: the 24-candidate cut binds.
    for (let i = 0; i < 30; i++) {
      c.store.put({ type: "memory", kind: "fact", body: `Importer note ${String(i)}: the parser step ${"x".repeat(i % 5)} handles row ${String(i * 3)} of the header batch.` });
    }
    const q = "what moved me about the importer parser step";
    const withLane = c.recall.build({ sessionId: "r1a", text: q, owner: true, feeling: { asker: "self" } });
    const without = c.recall.build({ sessionId: "r1b", text: q, owner: true });
    expect(withLane.feeling?.ranked).toBe(true);
    expect(without.decision.candidates).toBeGreaterThanOrEqual(RECALL.MAX_CANDIDATES);
    const bgWith = withLane.decision.background;
    const bgWithout = without.decision.background;
    expect(bgWith.n).toBe(bgWithout.n);
    expect(bgWith.mean).toBeCloseTo(bgWithout.mean, 9);
    expect(bgWith.sd).toBeCloseTo(bgWithout.sd, 9);
    // Every text row the cut kept without the lane is still there with it.
    const textWith = new Set(withLane.decision.verdicts.map((v) => v.id));
    for (const v of without.decision.verdicts) expect(textWith.has(v.id)).toBe(true);
    // And the stamps came too, after the cut.
    expect(withLane.decision.verdicts.some((v) => f.stamped.includes(v.id))).toBe(true);
  });
});

describe("R2: a quiet text answer is not buried under dim stamped rows", () => {
  // Rewritten for meaning mode (#322): a person with a card is the SUBJECT, and
  // a feeling question about them keeps their arc — stamped rows about nobody
  // in particular do not bury it. (Without a card the topic is not read: see
  // the report on #323.)
  test("'how did I feel after Han asked whether I remember him' — Han's arc, not the unrelated stamps", () => {
    const s = server();
    const c = s.counterpart;
    const f = importerStore(c);
    const han = c.store.put({ type: "memory", kind: "person", body: "Han asked whether I remember him from one conversation to the next." });
    cardFor(c, "Han");
    const r = meaning(c, "how did I feel after Han asked whether I remember him");
    expect(r.lens).toMatchObject({ kind: "card", name: "Han" });
    expect(moments(r)).toContain(han);
    for (const id of f.stamped) expect(moments(r)).not.toContain(id);
    // Han's moment carries no feeling, and the answer says so rather than guessing one.
    expect(r.notes.some((n) => n.includes("carry"))).toBe(true);
  });
});

describe("R3: everyday phrasings do not rank; real feeling questions still do", () => {
  const self = { asker: "self" as const, ownerNames: ["mike"] };
  for (const q of [
    "I feel like the importer test is flaky",
    "moved my parser into its own file",
    "my happy path test fails",
    "I moved it to src",
    "is my build open",
    "I felt that the review was too long",
  ]) {
    test(`"${q}" does not rank`, () => {
      expect(readFeelingAsk(q, self, new Set(), 3).ranked).toBe(false);
    });
  }
  for (const q of [
    "what moved me this week",
    "times I felt moved or sad",
    "what have I felt most strongly",
    "when was I afraid",
    // A possessive beside a feel-word is the person (final check, F1) — the
    // shape the dashboard's rewrite hands over.
    "what are my feelings lately",
    "what's your mood",
    "how are my feelings",
  ]) {
    test(`"${q}" still ranks`, () => {
      expect(readFeelingAsk(q, self, new Set(), 3).ranked).toBe(true);
    });
  }

  for (const q of ["I feel like the importer parser test is flaky", "moved my parser into its own file in the importer", "my happy path test fails in the importer"]) {
    // Rewritten for meaning mode (#322): no tiers; the answer is the words' lens.
    test(`end to end: "${q}" — answered by its words, the importer answer a moment`, () => {
      const s = server();
      wordsNotFeeling(s.counterpart, importerStore(s.counterpart), q);
    });
  }

  test("'afraid' is scared's group: 'when was I afraid' reaches a memory stamped scared", () => {
    const s = server();
    const f = seed(s.counterpart);
    const scary = s.counterpart.store.put({ type: "memory", kind: "self", body: "The night the disk filled up during the backup." });
    s.counterpart.store.addFeelings(scary, [{ whose: "self", core: "fear", emotion: "scared", strength: 0.8 }]);
    const ids = moments(meaning(s.counterpart, "when was I afraid"));
    expect(ids).toContain(scary);
    // The happy and sad stamps are not afraid.
    for (const id of [f.week, f.card, f.han]) expect(ids).not.toContain(id);
  });
});

// ── round 2 (2026-10-01, lane 6): any feeling word reaches its core; the
// strongest over all time; memories about the feeling system don't crowd ──

/** Filler, a few stamped memories of the uneasy core, and one UNSTAMPED memory
 *  about the feeling system whose words are the question's. */
function uneasyStore(c: Counterpart): { sheepish: string[]; wheelDoc: string; topical: string } {
  const put = (body: string, kind: "self" | "fact" = "self"): string => c.store.put({ type: "memory", kind, body });
  for (const body of FILLER) put(body, "fact");
  const sheepish = [
    put("The review found the test I had quietly skipped."),
    put("I quoted the wrong release number back to him."),
    put("The handoff I wrote named a file that never existed."),
  ];
  [0.6, 0.5, 0.4].forEach((strength, i) =>
    c.store.addFeelings(sheepish[i] as string, [{ whose: "self", core: "uneasy", emotion: "sheepish", strength }]),
  );
  const wheelDoc = put(
    "Feelings wheel notes: afraid, scared and frightened sit in the uneasy core; ashamed and guilty too. When was I afraid is a question the wheel answers.",
    "fact",
  );
  const topical = put("The quarterly garden plan: tomatoes, beans, and a new trellis.", "fact");
  return { sheepish, wheelDoc, topical };
}

describe("lane 6, item 1: any feeling word reaches its core, tiered", () => {
  test("'when was I afraid' with no afraid stamp answers with the uneasy ones, and not the wheel's notes", () => {
    const s = server();
    const f = uneasyStore(s.counterpart);
    const ids = moments(meaning(s.counterpart, "when was I afraid"));
    // All three, by their core.
    expect(new Set(ids)).toEqual(new Set(f.sheepish));
    // The unstamped note full of the question's words is not a moment of a feeling (item 3).
    expect(ids).not.toContain(f.wheelDoc);
  });

  // Rewritten for meaning mode (#322): an exact stamp counts whole and a core
  // match half, so the weaker exact 'scared' stamp is chosen beside the
  // strongest uneasy ones; there is no rank order inside an entry to assert.
  test("an exact stamp counts whole: a weaker 'scared' stamp answers 'afraid' beside stronger uneasy ones", () => {
    const s = server();
    const c = s.counterpart;
    const f = uneasyStore(c);
    const scared = c.store.put({ type: "memory", kind: "self", body: "The disk filled up halfway through the backup." });
    c.store.addFeelings(scared, [{ whose: "self", core: "uneasy", emotion: "scared", strength: 0.3 }]);
    const r = meaning(c, "when was I afraid");
    expect(moments(r)).toContain(scared);
    // The weakest core match (0.4, halved) is the one of four left off the three slots.
    expect(moments(r)).not.toContain(f.sheepish[2]);
    expect(r.counts.moments).toBe(4);
    const built = c.recall.build({ sessionId: "l6b-lane", text: "when was I afraid", owner: true, feeling: { asker: "self" } });
    expect(built.feeling?.pool).toBe(4);
    expect(built.feeling?.core).toBe(3);
    // The core tier brings no more cue than the weakest exact nomination (none of these bodies shares a word with the question).
    const cue = new Map(built.decision.verdicts.map((v) => [v.id, v.cue]));
    expect(cue.get(scared) as number).toBeGreaterThan(0);
    for (const id of f.sheepish) expect(cue.get(id) as number).toBeCloseTo(cue.get(scared) as number, 9);
  });

  test("'ashamed or caught out': the phrase is read whole, and 'ashamed' alone reaches the core", () => {
    const s = server();
    const f = uneasyStore(s.counterpart);
    const self = { asker: "self" as const };
    const read = readFeelingAsk("when did I feel ashamed or caught out", self, new Set(), 3);
    expect(read.ranked).toBe(true);
    expect(read.named.has("caught out")).toBe(true);
    expect(read.named.has("caught")).toBe(false);
    expect([...read.cores]).toEqual(["uneasy"]);
    for (const question of ["when did I feel ashamed or caught out", "when did I feel ashamed", "when was I embarrassed"]) {
      expect(new Set(moments(meaning(s.counterpart, question)))).toEqual(new Set(f.sheepish));
    }
  });

  test("feelingWord: everyday words and light stems land on the wheel, and nothing else does", () => {
    expect(feelingWord("happiest")).toEqual({ word: "happy", superlative: true, via: "stem" });
    expect(feelingWord("happier")).toEqual({ word: "happy", superlative: false, via: "stem" });
    expect(feelingWord("sadness")?.word).toBe("sad");
    expect(feelingWord("saddest")).toEqual({ word: "sad", superlative: true, via: "stem" });
    expect(feelingWord("angrier")?.word).toBe("angry");
    expect(feelingWord("loneliest")?.word).toBe("lonely");
    expect(feelingWord("scary")).toEqual({ word: "scared", superlative: false, via: "everyday" });
    expect(feelingWord("shame")?.word).toBe("ashamed");
    expect(feelingWord("proudest")).toEqual({ word: "proud", superlative: true, via: "stem" });
    expect(feelingWord("moved")?.via).toBe("wheel");
    // Stems only of known feeling words (review of #310): "opener", "warmer", "closer" are about things.
    for (const w of ["interest", "panic", "hope", "love", "worry", "latest", "honest", "matter", "user", "constructor", "tostring", "hasownproperty",
      "opener", "warmer", "closer", "joy", "pride", "curiosity"]) expect(feelingWord(w)).toBeNull();
    expect(() => readFeelingAsk("how did I feel about the constructor refactor", { asker: "self" }, new Set(), 3)).not.toThrow();
    const self = { asker: "self" as const };
    for (const q of ["I hope the build passes", "why did the kernel panic", "upset the ordering of the list"]) {
      expect(readFeelingAsk(q, self, new Set(), 3).ranked).toBe(false);
    }
    expect(readFeelingAsk("let down the drawbridge", self, new Set(), 3).named.size).toBe(0);
  });

  test("review of #310: names, everyday words out of frame, and 'caught out' about a thing name nothing", () => {
    const self = { asker: "self" as const, ownerNames: ["mike"] };
    for (const q of [
      "what did I learn from Joy about the launch",
      "which endpoints I stressed in the load test",
      "what did I plan for pride month",
      "what did I read about the curiosity rover",
      "I keep getting caught out of range errors",
      "where I caught out of range errors",
      "where we caught out of range errors",
      "how did I warm the cache",
      "is my opener test still flaky",
    ]) {
      const read = readFeelingAsk(q, self, new Set(), 3);
      expect(read.named.size).toBe(0);
    }
    // The same words in a feeling's frame still name one.
    expect(readFeelingAsk("when was I stressed", self, new Set(), 3).named.has("worried")).toBe(true);
    expect(readFeelingAsk("when did I feel shame", self, new Set(), 3).ranked).toBe(true);
    expect(readFeelingAsk("when was I caught out", self, new Set(), 3).named.has("caught out")).toBe(true);
    expect(readFeelingAsk("when did I feel caught out", self, new Set(), 3).ranked).toBe(true);
  });

  test("the owner's name in the possessive is the owner — beside a feel-word only", () => {
    const input = { asker: "self" as const, ownerNames: ["mike"] };
    expect(whoseAsked("what are Mike's feelings about the launch", input)).toBe("owner");
    expect(readFeelingAsk("what are Mike's feelings about the launch", input, new Set(), 3).ranked).toBe(true);
    expect(readFeelingAsk("Mike's happy path test fails", input, new Set(), 3).ranked).toBe(false);
    expect(whoseAsked("what are James' feelings", { asker: "self", ownerNames: ["james"] })).toBe("owner");
    // A plain plural is not the owner (review of #310): "bills", "marks".
    const bill = { asker: "self" as const, ownerNames: ["bill", "mark"] };
    expect(whoseAsked("how did I feel paying the bills", bill)).toBe("self");
    expect(whoseAsked("how did I feel about the marks on the wall", bill)).toBe("self");
    expect(whoseAsked("how did Bill's feelings change", bill)).toBe("owner");
  });
});

describe("lane 6, item 2: 'most / ever / strongest / since' rank by recorded strength", () => {
  // Rewritten for meaning mode (#322): the two moments come from two sessions,
  // so each is its own entry of the arc, and an entry's `hold` is the stamp's
  // value — recorded for "happiest", softened for "happy".
  test("an old strong feeling holds 'when was I happiest' most; 'when was I happy' keeps the softened order", () => {
    const s = server();
    const c = s.counterpart;
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
    c.store.advanceClock("2026-08-01");
    const old = c.store.put({ type: "memory", kind: "self", body: "The afternoon the first full week replayed cleanly.", origin: { session: "sess-august" } });
    c.store.addFeelings(old, [{ whose: "self", core: "happy", emotion: "joyful", strength: 0.9 }]);
    for (let d = 2; d <= 31; d++) c.store.advanceClock(`2026-08-${String(d).padStart(2, "0")}`);
    for (let d = 1; d <= 15; d++) c.store.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    const fresh = c.store.put({ type: "memory", kind: "self", body: "The dashboard tile finally lined up on the phone.", origin: { session: "sess-september" } });
    c.store.addFeelings(fresh, [{ whose: "self", core: "happy", emotion: "glad", strength: 0.5 }]);
    const self = { asker: "self" as const };
    expect(readFeelingAsk("when was I happiest", self, new Set(), 3).strongest).toBe(true);
    expect(readFeelingAsk("what have I felt most strongly", self, new Set(), 3).strongest).toBe(true);
    expect(readFeelingAsk("when was I happy", self, new Set(), 3).strongest).toBe(false);
    // Only beside a feeling, and never about the recent past (review of #310).
    expect(readFeelingAsk("what have I felt most recently", self, new Set(), 3).strongest).toBe(false);
    expect(readFeelingAsk("how did I feel about the most recent release", self, new Set(), 3).strongest).toBe(false);
    expect(readFeelingAsk("when was I happiest lately", self, new Set(), 3).strongest).toBe(false);
    expect(readFeelingAsk("how did I feel about the worst bug since the launch", self, new Set(), 3).strongest).toBe(false);
    expect(readFeelingAsk("what moved me most", self, new Set(), 3).strongest).toBe(true);
    /** The moment of the entry that holds the question most. */
    const first = (question: string): string | undefined => {
      const entries = meaning(c, question).arc.flatMap((l) => (l.fold ? [] : [l.entry]));
      return [...entries].sort((a, b) => b.hold - a.hold)[0]?.moments[0]?.id;
    };
    expect(first("when was I happiest")).toBe(old);
    expect(first("what have I felt most strongly")).toBe(old);
    expect(first("what have I ever felt happy about")).toBe(old);
    // Softening is how a feeling fades, and an ordinary question keeps it.
    expect(first("when was I happy")).toBe(fresh);
    expect(first("what have I felt most recently")).toBe(fresh);
  });
});

describe("lane 6, item 3: memories about the feeling system don't crowd a feeling question", () => {
  test("an unstamped row only feeling words reached sits below every stamped row; a topic word keeps its place", () => {
    const s = server();
    const c = s.counterpart;
    const f = uneasyStore(c);
    const built = c.recall.build({ sessionId: "l6n", text: "when was I afraid", owner: true, feeling: { asker: "self" } });
    const seen = new Set(built.decision.verdicts.map((v) => v.id));
    expect(seen.has(f.wheelDoc)).toBe(true);
    expect(built.feeling?.noTopic.has(f.wheelDoc)).toBe(true);
    for (const id of f.sheepish) expect(built.feeling?.noTopic.has(id)).toBe(false);
    // A topic word: the garden plan, asked about by its own word, is not "no topic".
    const question = "how did I feel about the garden plan";
    const topical = c.recall.build({ sessionId: "l6n2", text: question, owner: true, feeling: { asker: "self" } });
    expect(topical.feeling?.ranked).toBe(true);
    expect(topical.feeling?.noTopic.has(f.topical)).toBe(false);
    // Meaning (#322): the feeling question's moments are the stamped rows, and
    // the wheel note the feeling words reached is not one of them. The garden
    // plan has no card and no stamped memory says it: every felt moment
    // follows, and the answer says so plainly (review of #323; the case where a
    // stamped memory does say it is in recall-meaning.test.ts).
    const r = meaning(c, question);
    expect(r.lens?.kind).toBe("feeling");
    expect(moments(r)).not.toContain(f.wheelDoc);
    expect(new Set(moments(r))).toEqual(new Set(f.sheepish));
    expect(r.notes.join(" ")).toContain('no card names "garden plan", and no moment that carries feelings (mine) says it');
  });

  test("second review of #310: a capitalised wheel word is still a feeling; a lower-case 'can' is frame", () => {
    const s = server();
    const c = s.counterpart;
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
    const sad = c.store.put({ type: "memory", kind: "self", body: "The evening the old store was finally archived." });
    c.store.addFeelings(sad, [{ whose: "self", core: "sad", emotion: "wistful", strength: 0.6 }]);
    for (const question of ["when was I Sad", "I felt Sad", "WHEN WAS I SAD"]) {
      expect(readFeelingAsk(question, { asker: "self" }, new Set(), 3).named.has("sad")).toBe(true);
      expect(moments(meaning(c, question))).toEqual([sad]);
    }
    // A wheel note asked about only through frame words stays below the stamped rows.
    uneasyStore(c);
    const note = c.store.put({ type: "memory", kind: "fact", body: "Wheel note: what you can do when afraid is file it under uneasy." });
    const built = c.recall.build({ sessionId: "can", text: "what can I do when I feel afraid", owner: true, feeling: { asker: "self" } });
    expect(built.decision.verdicts.some((v) => v.id === note)).toBe(true);
    expect(built.feeling?.noTopic.has(note)).toBe(true);
  });

  // Rewritten for meaning mode (#322): the core lane still reads the capitals
  // as topics (kept below); in meaning, a topic is a CARD — "Will" with a card
  // is the subject of the answer. RETIRED: the same claim for "May" and "the
  // Can", which have no card and are not people; meaning reads a feeling
  // question with an uncarded topic as the feeling alone (see #323's report).
  test("review of #310: Will, May and Can, capitalised, are topics — and Will, with a card, is meaning's subject", () => {
    const s = server();
    const c = s.counterpart;
    uneasyStore(c);
    const will = c.store.put({ type: "memory", kind: "person", body: "Will helped carry the couch up three flights." });
    const may = c.store.put({ type: "memory", kind: "fact", body: "In May the release slipped twice." });
    const can = c.store.put({ type: "memory", kind: "fact", body: "The Can of paint tipped over on the porch." });
    // Lower-case will/may/can are function words (second review); the asker's capitals make a topic.
    for (const [question, id] of [
      ["how did I feel about Will", will],
      ["how did I feel in May", may],
      ["how did I feel about the Can", can],
    ] as const) {
      const built = c.recall.build({ sessionId: `l6t-${id}`, text: question, owner: true, feeling: { asker: "self" } });
      expect(built.feeling?.ranked).toBe(true);
      expect(built.feeling?.noTopic.has(id)).toBe(false);
    }
    cardFor(c, "Will");
    const r = meaning(c, "how did I feel about Will");
    expect(r.lens).toMatchObject({ kind: "card", name: "Will" });
    expect(moments(r)).toContain(will);
  });

  test("a question not about feeling is unchanged: 'what do I know about Han'", () => {
    const s = server();
    const f = seed(s.counterpart);
    const question = "what do I know about Han";
    const withLane = s.counterpart.recall.build({ sessionId: "cmp6", text: question, owner: true, feeling: { asker: "self", ownerNames: ["mike"] } });
    const without = s.counterpart.recall.build({ sessionId: "cmp6", text: question, owner: true });
    expect(withLane.feeling?.ranked).toBe(false);
    expect(withLane.feeling?.noTopic.size).toBe(0);
    const strip = (d: typeof withLane.decision): unknown => ({ ...d, elapsedMs: 0 });
    expect(strip(withLane.decision)).toEqual(strip(without.decision));
    // Meaning answers it by its words, not as a feeling.
    const r = meaning(s.counterpart, question);
    expect(r.lens?.kind).not.toBe("feeling");
    expect(moments(r)).toContain(f.han);
  });
});
