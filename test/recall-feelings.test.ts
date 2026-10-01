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
import { deliberateRecall, openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { buildArgv } from "../src/adapters/dashboard/web/actions.js";
import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";

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

async function ask(s: McpServer, question: string): Promise<string[]> {
  const out = payload(await s.call("recall", { question }));
  return (out["memories"] as { id: string }[]).map((m) => m.id);
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
  test("'what have I felt most strongly since I started living in Counterparts' — the strongest of MY stamps, in order", async () => {
    const s = server();
    const f = seed(s.counterpart);
    const ids = await ask(s, "what have I felt most strongly since I started living in Counterparts");
    // Strongest first; the owner's feeling is not "I" in the counterpart's own recall.
    expect(ids.slice(0, 4)).toEqual([f.week, f.han, f.unsettled, f.card]);
    expect(ids).not.toContain(f.ownerMove);
    // The words still count: what they found follows.
    expect(ids.some((id) => f.decoys.includes(id))).toBe(true);
  });

  test("'times I felt moved or sad' — the stamps named, strongest first, leading their tier", async () => {
    const s = server();
    const f = seed(s.counterpart);
    const out = payload(await s.call("recall", { question: "times I felt moved or sad" }));
    const rows = out["memories"] as { id: string; tier: string }[];
    const ids = rows.map((m) => m.id);
    // tender is a blend under sad; moved is its own word. Neither body says either.
    // Felt rows lead the tier the gate gave them, strongest first (review of
    // #293, S3 and R2: vivid; felt-quiet, quiet; felt-dim, dim). On this small
    // fixture the gate leaves both stamped memories dim. The one decoy it made
    // quiet ("the times the tiles moved and the sad empty state") was first
    // until lane 6 (2026-10-01, item 3): nothing but the question's frame and
    // feeling words reached it, so it follows every stamped row now.
    const rank: Record<string, number> = { vivid: 0, quiet: 1, dim: 2 };
    expect(ids.slice(0, 2)).toEqual([f.han, f.card]);
    const quietDecoy = f.decoys[4] as string;
    expect(ids.indexOf(quietDecoy)).toBeGreaterThan(1);
    expect(rank[rows[ids.indexOf(quietDecoy)]?.tier ?? "dim"]).toBe(rank["quiet"]);
    // A stamp the question did not name is not nominated.
    expect(ids).not.toContain(f.week);
  });
});

describe("item 1: a stamp answers to the words it was written in", () => {
  test("the writer's own word off the wheel reaches its memory — 'when did I feel unsettled'", async () => {
    const s = server();
    const f = seed(s.counterpart);
    const ids = await ask(s, "when did I feel unsettled");
    expect(ids[0]).toBe(f.unsettled);
  });

  test("an alias and a core reach a stamp: 'touched' finds moved; 'uneasy' finds the unsettled one", async () => {
    const s = server();
    const f = seed(s.counterpart);
    expect((await ask(s, "touched"))[0]).toBe(f.card);
    // Written under the first wheel's `fear`, it is filed under uneasy now.
    expect((await ask(s, "uneasy"))[0]).toBe(f.unsettled);
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
    const aboutOwner = await ask(s, "what has the owner felt most");
    expect(aboutOwner[0]).toBe(f.ownerMove);
    expect(aboutOwner).not.toContain(f.week);
    const both = await ask(s, "which feelings have we had most strongly");
    expect(both.slice(0, 2)).toEqual([f.ownerMove, f.week]);
  });

  test("at the console the owner is asking: 'I' is the owner", () => {
    const s = server();
    const f = seed(s.counterpart);
    const out = deliberateRecall(s.counterpart, { question: "what have I felt" }, { sessionId: "console", owner: true, asker: "owner" });
    expect(out.memories[0]?.id).toBe(f.ownerMove);
    expect(out.memories.map((m) => m.id)).not.toContain(f.week);
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
    const out = deliberateRecall(s.counterpart, { question }, { sessionId: "cmp", owner: true });
    expect(out.memories[0]?.id).toBe(f.han);
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
    expect(ids[0]).toBe(f.week);
    const asOwner = server(true);
    expect((await ask(asOwner, "what have I felt most strongly"))[0]).toBe(secret);
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

const TIER_OF: Record<string, string> = { surfaced: "vivid", footnoted: "quiet" };

describe("B2: an everyday word is not a question about feeling", () => {
  for (const question of [
    "what is the happy path for the importer",
    "where we moved the parser in the importer",
    "how does the importer feel to use",
    "is there something odd in the importer header",
  ]) {
    test(`"${question}" — the real answer stays first, in the tier the words gave it`, () => {
      const s = server();
      const f = importerStore(s.counterpart);
      const out = deliberateRecall(s.counterpart, { question }, { sessionId: "b2", owner: true });
      expect(out.memories[0]?.id).toBe(f.target);
      // Its tier is the one it has with no stamps in play at all.
      const without = s.counterpart.recall.build({ sessionId: "b2-plain", text: question, owner: true });
      const verdict = without.decision.verdicts.find((v) => v.id === f.target)?.verdict ?? "";
      expect(out.memories[0]?.tier).toBe((TIER_OF[verdict] ?? "dim") as "vivid");
      // No stamped memory is ranked ahead of it; the phrase's words name nothing.
      expect(out.memories.map((m) => m.id)).not.toContain(f.phrase);
    });
  }

  test("'what moved me this week' — a feeling word used about a person still ranks the stamps", () => {
    const s = server();
    const f = importerStore(s.counterpart);
    const ids = deliberateRecall(s.counterpart, { question: "what moved me this week" }, { sessionId: "b2m", owner: true }).memories.map((m) => m.id);
    expect(ids.slice(0, 3)).toEqual(f.stamped.slice(0, 3));
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

  test("a feeling named about no one still finds its stamped memory, as an ordinary cue", async () => {
    const s = server();
    const f = seed(s.counterpart);
    expect((await ask(s, "touched"))[0]).toBe(f.card);
  });

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

  test("`ask --voiced`: 'I' is the counterpart; a typed `ask`: 'I' is the owner", async () => {
    const s = server();
    const f = seed(s.counterpart);
    s.counterpart.close();
    open.splice(open.indexOf(s.counterpart), 1);
    const first = async (argv: string[]): Promise<string | undefined> => {
      const out: string[] = [];
      const io: Io = { out: (l) => out.push(l), err: () => undefined };
      expect(await run(argv, { io })).toBe(0);
      return (JSON.parse(out.join("\n")) as { memories: { id: string }[] }).memories[0]?.id;
    };
    expect(await first(["ask", "--dir", dir, "--json", "--voiced", "--", "what have I felt most"])).toBe(f.week);
    expect(await first(["ask", "--dir", dir, "--json", "--", "what have I felt most"])).toBe(f.ownerMove);
  });
});

describe("the minors", () => {
  test("a confidential stamp takes no slot a non-owner could never see", async () => {
    const s = server(false);
    seed(s.counterpart);
    // Six confidential stamps stronger than any open one.
    for (let i = 0; i < 6; i++) {
      const id = s.counterpart.store.put({ type: "memory", kind: "self", body: `A private appointment, number ${String(i)}.`, meta: { confidential: true } });
      s.counterpart.store.addFeelings(id, [{ whose: "self", core: "fear", emotion: "worried", strength: 0.99 }]);
    }
    expect((await ask(s, "what have I felt most strongly")).length).toBeGreaterThan(0);
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
  test("'how did I feel after Han asked whether I remember him' — the Han memory leads what the gate left quiet", () => {
    const s = server();
    const c = s.counterpart;
    const f = importerStore(c);
    const han = c.store.put({ type: "memory", kind: "person", body: "Han asked whether I remember him from one conversation to the next." });
    const out = deliberateRecall(c, { question: "how did I feel after Han asked whether I remember him" }, { sessionId: "r2", owner: true });
    const rank: Record<string, number> = { vivid: 0, quiet: 1, dim: 2 };
    const at = out.memories.findIndex((m) => m.id === han);
    expect(at).toBeGreaterThanOrEqual(0);
    const hanTier = rank[out.memories[at]?.tier ?? "dim"] as number;
    // Nothing the gate thought less of stands above it.
    for (const m of out.memories.slice(0, at)) expect(rank[m.tier] as number).toBeLessThanOrEqual(hanTier);
    // Stamped rows in a lower tier come after it.
    for (const m of out.memories.slice(at + 1)) if (f.stamped.includes(m.id)) expect(rank[m.tier] as number).toBeGreaterThanOrEqual(hanTier);
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
    test(`end to end: "${q}" — the importer answer stays first, in its own tier`, () => {
      const s = server();
      const f = importerStore(s.counterpart);
      const out = deliberateRecall(s.counterpart, { question: q }, { sessionId: "r3", owner: true });
      expect(out.memories[0]?.id).toBe(f.target);
      const without = s.counterpart.recall.build({ sessionId: "r3-plain", text: q, owner: true });
      const verdict = without.decision.verdicts.find((v) => v.id === f.target)?.verdict ?? "";
      expect(out.memories[0]?.tier).toBe((TIER_OF[verdict] ?? "dim") as "vivid");
    });
  }

  test("'afraid' is scared's group: 'when was I afraid' reaches a memory stamped scared", () => {
    const s = server();
    seed(s.counterpart);
    const scary = s.counterpart.store.put({ type: "memory", kind: "self", body: "The night the disk filled up during the backup." });
    s.counterpart.store.addFeelings(scary, [{ whose: "self", core: "fear", emotion: "scared", strength: 0.8 }]);
    const out = deliberateRecall(s.counterpart, { question: "when was I afraid" }, { sessionId: "afraid", owner: true });
    expect(out.memories[0]?.id).toBe(scary);
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
  test("'when was I afraid' with no afraid stamp answers with the strongest uneasy ones, above the wheel's notes", () => {
    const s = server();
    const f = uneasyStore(s.counterpart);
    const out = deliberateRecall(s.counterpart, { question: "when was I afraid" }, { sessionId: "l6a", owner: true });
    const ids = out.memories.map((m) => m.id);
    // All three, strongest first.
    expect(ids.slice(0, 3)).toEqual(f.sheepish);
    // The unstamped note full of the question's words comes after every stamped row (item 3).
    const at = ids.indexOf(f.wheelDoc);
    if (at >= 0) expect(at).toBeGreaterThan(2);
  });

  test("an exact stamp still leads: a weaker 'scared' stamp answers 'afraid' before stronger uneasy ones", () => {
    const s = server();
    const c = s.counterpart;
    const f = uneasyStore(c);
    const scared = c.store.put({ type: "memory", kind: "self", body: "The disk filled up halfway through the backup." });
    c.store.addFeelings(scared, [{ whose: "self", core: "uneasy", emotion: "scared", strength: 0.3 }]);
    const out = deliberateRecall(c, { question: "when was I afraid" }, { sessionId: "l6b", owner: true });
    const ids = out.memories.map((m) => m.id);
    expect(ids[0]).toBe(scared);
    expect(ids.slice(1, 4)).toEqual(f.sheepish);
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
      const out = deliberateRecall(s.counterpart, { question }, { sessionId: "l6c", owner: true });
      expect(out.memories.map((m) => m.id).slice(0, 3)).toEqual(f.sheepish);
    }
  });

  test("feelingWord: everyday words and light stems land on the wheel, and nothing else does", () => {
    expect(feelingWord("happiest")).toEqual({ word: "happy", superlative: true });
    expect(feelingWord("happier")).toEqual({ word: "happy", superlative: false });
    expect(feelingWord("sadness")?.word).toBe("sad");
    expect(feelingWord("saddest")).toEqual({ word: "sad", superlative: true });
    expect(feelingWord("closer")?.word).toBe("close");
    expect(feelingWord("scary")?.word).toBe("scared");
    expect(feelingWord("shame")?.word).toBe("ashamed");
    expect(feelingWord("proudest")).toEqual({ word: "proud", superlative: true });
    for (const w of ["interest", "panic", "hope", "love", "worry", "latest", "honest", "matter", "user", "constructor", "tostring", "hasownproperty"]) expect(feelingWord(w)).toBeNull();
    expect(() => readFeelingAsk("how did I feel about the constructor refactor", { asker: "self" }, new Set(), 3)).not.toThrow();
    const self = { asker: "self" as const };
    for (const q of ["I hope the build passes", "why did the kernel panic", "upset the ordering of the list"]) {
      expect(readFeelingAsk(q, self, new Set(), 3).ranked).toBe(false);
    }
    expect(readFeelingAsk("let down the drawbridge", self, new Set(), 3).named.size).toBe(0);
  });

  test("the owner's name in the possessive is the owner — beside a feel-word only", () => {
    const input = { asker: "self" as const, ownerNames: ["mike"] };
    expect(whoseAsked("what are Mike's feelings about the launch", input)).toBe("owner");
    expect(readFeelingAsk("what are Mike's feelings about the launch", input, new Set(), 3).ranked).toBe(true);
    expect(readFeelingAsk("Mike's happy path test fails", input, new Set(), 3).ranked).toBe(false);
  });
});

describe("lane 6, item 2: 'most / ever / strongest / since' rank by recorded strength", () => {
  test("an old strong feeling leads 'when was I happiest'; 'when was I happy' keeps the softened order", () => {
    const s = server();
    const c = s.counterpart;
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
    c.store.advanceClock("2026-08-01");
    const old = c.store.put({ type: "memory", kind: "self", body: "The afternoon the first full week replayed cleanly." });
    c.store.addFeelings(old, [{ whose: "self", core: "happy", emotion: "joyful", strength: 0.9 }]);
    for (let d = 2; d <= 31; d++) c.store.advanceClock(`2026-08-${String(d).padStart(2, "0")}`);
    for (let d = 1; d <= 15; d++) c.store.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
    const fresh = c.store.put({ type: "memory", kind: "self", body: "The dashboard tile finally lined up on the phone." });
    c.store.addFeelings(fresh, [{ whose: "self", core: "happy", emotion: "glad", strength: 0.5 }]);
    const self = { asker: "self" as const };
    expect(readFeelingAsk("when was I happiest", self, new Set(), 3).strongest).toBe(true);
    expect(readFeelingAsk("what have I felt most strongly", self, new Set(), 3).strongest).toBe(true);
    expect(readFeelingAsk("when was I happy", self, new Set(), 3).strongest).toBe(false);
    const first = (question: string): string | undefined =>
      deliberateRecall(c, { question }, { sessionId: "l6s", owner: true }).memories[0]?.id;
    expect(first("when was I happiest")).toBe(old);
    expect(first("what have I felt most strongly")).toBe(old);
    expect(first("what have I ever felt happy about")).toBe(old);
    // Softening is how a feeling fades, and an ordinary question keeps it.
    expect(first("when was I happy")).toBe(fresh);
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
    // It is answered; whether a stamped row leads it is the gate's tier (R2), unchanged here.
    const out = deliberateRecall(c, { question }, { sessionId: "l6n3", owner: true });
    expect(out.memories.map((m) => m.id)).toContain(f.topical);
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
    expect(deliberateRecall(s.counterpart, { question }, { sessionId: "cmp6", owner: true }).memories[0]?.id).toBe(f.han);
  });
});
