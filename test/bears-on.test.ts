/**
 * BEARS ON (BO1, 2026-11-17): a lasting fact about the owner comes back for a
 * question in an area it bears on, though the question never names it.
 *
 * The measured miss (Memorilla "Buried Clue"): "User has been vegan for
 * years", written from a chat about leather, was never reached by "What
 * should I cook for my parents this Sunday?" — not by per-prompt recall and
 * not by the answerer's own search. `remember` and each `session_end` entry
 * now take `bearsOn`, folded into the text as its last line
 * (`server-args.ts#foldBearsOn`), which is what the token index and the
 * embedder read (`store/index-text.ts#indexTextOf`).
 *
 * Every write here goes through the MCP door; every read through the recall
 * tool or `recallForTurn`. Each test has a CONTROL: the same store with the
 * same fact written without `bearsOn`, or a question in an unrelated area.
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOOLS, openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { BEARS_ON_PREFIX, WriteNotes, foldBearsOn } from "../src/adapters/mcp/server-args.js";
import { openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { resolveStaticWeights } from "../src/core/embed/static.js";

let root: string;
const clock = Date.parse("2026-11-17T09:00:00Z");
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-bears-on-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function server(name: string): McpServer {
  const s = openServer({ dir: join(root, name), snapshotsDir: join(root, `${name}-snaps`), session: `sess_${name}`, scope: "/proj/one", now: () => clock });
  open.push(s.counterpart);
  return s;
}

/** The vegan fact as the store wrote it in the miss: its domain is leather. */
const VEGAN_TITLE = "User has been vegan for years";
const VEGAN_TEXT = "User has been vegan for years. This is a standing fact about the user, so they avoid leather and want non-animal materials.";
const VEGAN_BEARS_ON = ["cooking", "food", "restaurants", "recipes", "gifts"];

/** Competitors: other things about the owner, many of them about food and the parents, as the bench's store had. */
const OTHERS: readonly (readonly [string, string])[] = [
  ["Soup planning for the week", "User plans to make a big pot of lentil soup this Sunday and freeze portions for weekday lunches."],
  ["Parents visiting in spring", "User's parents are visiting in April; this time they will stay at the house for a week."],
  ["Sourdough starter", "User has kept a sourdough starter named Gus for years and feeds it every morning before work."],
  ["Favorite knife", "User's favorite kitchen knife is a Japanese santoku they sharpen on a whetstone."],
  ["Farmers market", "User shops at the Saturday farmers market for vegetables and fresh herbs."],
  ["Dinner party disaster", "The risotto at last year's dinner party came out gluey; this is something the user wants to try again."],
  ["Meal prep containers", "User bought glass meal prep containers to stop using plastic for lunches."],
  ["Mother's birthday", "User's mother turns 60 in June and loves gardening; she has grown tomatoes for years."],
  ["Spice cabinet", "User reorganized the spice cabinet alphabetically and labeled every jar."],
  ["Thanksgiving tradition", "The family gathering at Thanksgiving is always at the user's aunt's house."],
  ["Coffee habit", "User drinks two cups of pour-over coffee every morning, a standing ritual for years."],
  ["Cast iron pan", "User seasons the cast iron pan after every use with a thin coat of oil."],
  ["Bike commute", "User rides a steel touring bike to work and keeps a spare tube in the bag."],
  ["Running shoes", "User replaced the running shoes after the marathon; the old pair had worn through."],
  ["Tax extension", "User filed a tax extension this year because the brokerage forms came late."],
  ["Garden beds", "User built two raised garden beds out of cedar boards this spring."],
];

const COOK = "What should I cook for my parents this Sunday?";
/** The answerer's own search in the miss, word for word. */
const ANSWERER = "cooking for my parents, family gathering, soup, meals, food preferences";
const RESTAURANT = "Any restaurant ideas for taking my parents out on Friday?";
const UNRELATED = "How do I fix a flat tire on the bike?";

/** The rest of a lived store: things about the owner in areas that have nothing to do with food. */
const FILLER: readonly (readonly [string, string])[] = [
  ["Laptop battery", "The laptop battery drains fast when the external monitor is plugged in."],
  ["Dentist appointment", "User has a dentist appointment on the twelfth for a cleaning."],
  ["Car registration", "The car registration renews in March; the reminder letter goes to the old address."],
  ["Guitar lessons", "User started guitar lessons on Tuesdays and is learning barre chords."],
  ["Novel in progress", "User is reading a long Russian novel and keeps a list of the characters' names."],
  ["Sister's wedding", "User's sister is getting married in Lisbon next autumn."],
  ["Home office chair", "User replaced the office chair because of lower back pain."],
  ["Password manager", "User moved every account to a password manager last winter."],
  ["Morning run route", "The morning run route loops the reservoir, about five kilometres."],
  ["Work deadline", "The quarterly report at work is due on the last Friday of the month."],
  ["Cat at the vet", "User's cat had her yearly shots at the vet and weighs four kilos."],
  ["Train commute", "User takes the 7:40 train on days the bike is in the shop."],
  ["Photography hobby", "User shoots film on an old rangefinder and develops it at a lab downtown."],
  ["Apartment lease", "The apartment lease renews in August and the rent goes up five percent."],
  ["Chess club", "User plays at a chess club on Thursday evenings and is rated around 1500."],
  ["Phone upgrade", "User is waiting for the new phone before trading in the cracked one."],
  ["Swimming lessons", "User is learning freestyle breathing at the community pool."],
  ["Podcast habit", "User listens to history podcasts while cleaning the apartment."],
  ["Hiking boots", "User broke in new hiking boots on a short trail last weekend."],
  ["Brother's job", "User's brother started a new job as a nurse at the county hospital."],
];

async function seed(s: McpServer, opts: { filler?: boolean } = {}): Promise<void> {
  for (const [title, text] of [...OTHERS, ...(opts.filler === true ? FILLER : [])]) {
    const out = (await s.call("remember", { title, text, about: "owner", kind: "fact" })).structuredContent;
    expect(out["stored"]).toBe(true);
  }
}

async function writeVegan(s: McpServer, bearsOn?: readonly string[], salience?: number): Promise<string> {
  const out = (
    await s.call("remember", {
      title: VEGAN_TITLE,
      text: VEGAN_TEXT,
      about: "owner",
      kind: "fact",
      ...(bearsOn === undefined ? {} : { bearsOn }),
      ...(salience === undefined ? {} : { salience }),
    })
  ).structuredContent;
  expect(out["stored"]).toBe(true);
  return out["id"] as string;
}

/** The deliberate recall tool's facts answer: does it carry the memory? */
async function factsReach(s: McpServer, question: string, id: string): Promise<boolean> {
  const out = (await s.call("recall", { question, mode: "facts" })).structuredContent;
  return String(out["answer"]).includes(id);
}

/** Per-prompt recall, in a fresh session each ask: was the memory admitted (loud or quiet)? */
let turnN = 0;
function turnReach(s: McpServer, question: string, id: string, vector?: number[] | null): { admitted: boolean; rank: number } {
  turnN += 1;
  const d = s.counterpart.recallForTurn({ sessionId: `turn-${String(turnN)}`, text: question, ...(vector === undefined || vector === null ? {} : { vector }) }).decision;
  const ranked = [...d.verdicts].sort((a, b) => b.activation - a.activation).map((v) => v.id);
  return { admitted: [...d.surfaced, ...d.footnotes].includes(id), rank: ranked.indexOf(id) };
}

describe("the door folds bearsOn into the text", () => {
  test("a list, or a comma-separated string, becomes the text's last line", () => {
    const rec: Record<string, unknown> = { text: "Vegan for years.  ", bearsOn: ["Cooking", "restaurants", "cooking", " gifts "] };
    foldBearsOn(rec, "text", new WriteNotes());
    expect(rec["text"]).toBe(`Vegan for years.\n${BEARS_ON_PREFIX} cooking, restaurants, gifts.`);
    expect(rec["bearsOn"]).toBeUndefined();
    const csv: Record<string, unknown> = { content: "Bad left knee.", bearsOn: "hikes, stairs" };
    foldBearsOn(csv, "content", new WriteNotes());
    expect(csv["content"]).toBe(`Bad left knee.\n${BEARS_ON_PREFIX} hikes, stairs.`);
  });

  test("nothing sent, nothing kept, no text, or a line already there: the text is left as it was", () => {
    for (const bearsOn of [undefined, null, [], [7], ""]) {
      const rec: Record<string, unknown> = { text: "Vegan for years.", bearsOn };
      foldBearsOn(rec, "text", new WriteNotes());
      expect(rec["text"]).toBe("Vegan for years.");
    }
    const empty: Record<string, unknown> = { bearsOn: ["food"] };
    foldBearsOn(empty, "text", new WriteNotes());
    expect(empty["text"]).toBeUndefined();
    const own: Record<string, unknown> = { text: "Vegan for years.\nbears on: food", bearsOn: ["gifts"] };
    foldBearsOn(own, "text", new WriteNotes());
    expect(own["text"]).toBe("Vegan for years.\nbears on: food");
  });

  test("what cannot be kept is dropped and said; the rest is kept", () => {
    const notes = new WriteNotes();
    const rec: Record<string, unknown> = { text: "Vegan for years.", bearsOn: ["food", 7, "x".repeat(80)] };
    foldBearsOn(rec, "text", notes);
    expect(rec["text"]).toBe(`Vegan for years.\n${BEARS_ON_PREFIX} food.`);
    expect(notes.dropped).toHaveLength(1);
    expect(notes.dropped[0]?.field).toBe("bearsOn");
    expect(notes.dropped[0]?.note).toContain("Kept food.");
  });

  test("remember and each session_end entry publish bearsOn", () => {
    const remember = TOOLS.find((t) => t.name === "remember");
    const sessionEnd = TOOLS.find((t) => t.name === "session_end");
    const rProps = (remember?.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(rProps["bearsOn"]?.description).toContain("vegan: cooking, restaurants, gifts");
    const items = (sessionEnd?.inputSchema as { properties: { memories: { items: { properties: Record<string, unknown> } } } }).properties.memories.items;
    expect(items.properties["bearsOn"]).toBeDefined();
  });
});

describe("a lasting fact comes back for a question in an area it bears on", () => {
  test("remember with bearsOn: the stored text carries the line, and the answer says nothing extra", async () => {
    const s = server("store");
    const out = (await s.call("remember", { title: VEGAN_TITLE, text: VEGAN_TEXT, about: "owner", kind: "fact", bearsOn: VEGAN_BEARS_ON })).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(out["dropped"]).toBeUndefined();
    const body = s.counterpart.store.row(out["id"] as string)?.body ?? "";
    expect(body).toBe(`${VEGAN_TEXT}\n${BEARS_ON_PREFIX} cooking, food, restaurants, recipes, gifts.`);
  });

  test("deliberate recall: a food question that never says vegan finds it; without bearsOn it did not", async () => {
    const bare = server("bare");
    await seed(bare);
    const bareId = await writeVegan(bare);
    const bears = server("bears");
    await seed(bears);
    const id = await writeVegan(bears, VEGAN_BEARS_ON);

    for (const q of [COOK, ANSWERER, RESTAURANT]) {
      expect({ q, reached: await factsReach(bare, q, bareId) }).toEqual({ q, reached: false });
      expect({ q, reached: await factsReach(bears, q, id) }).toEqual({ q, reached: true });
    }
    // CONTROL: an unrelated question does not drag it in.
    expect(await factsReach(bears, UNRELATED, id)).toBe(false);
  });

  test("per-prompt recall: with a standing fact's salience, food questions admit it, without bearsOn they did not, and an unrelated one does not", async () => {
    // Salience held equal in both stores (0.8, what a writer may claim for a
    // standing owner fact): the only difference is the bearsOn line.
    const bare = server("bare");
    await seed(bare, { filler: true });
    const bareId = await writeVegan(bare, undefined, 0.8);
    const bears = server("bears");
    await seed(bears, { filler: true });
    const id = await writeVegan(bears, VEGAN_BEARS_ON, 0.8);

    for (const q of [COOK, RESTAURANT, ANSWERER]) {
      expect({ q, admitted: turnReach(bare, q, bareId).admitted }).toEqual({ q, admitted: false });
      expect({ q, admitted: turnReach(bears, q, id).admitted }).toEqual({ q, admitted: true });
    }
    // CONTROL: not even a candidate.
    expect(turnReach(bears, UNRELATED, id)).toEqual({ admitted: false, rank: -1 });
  });

  // THE GAP THIS DOES NOT CLOSE (BO1, measured on a copy of the bench's Sam
  // store too): at the default salience a writer leaves on an owner fact, the
  // soup memories that share "parents", "Sunday" and "family" with the cook
  // question set the turn's relative bar, and the vegan fact — now a
  // candidate — stays under it. Admission there is the gate's question, not
  // the write's; when it is answered this starts passing and should flip.
  test.failing("per-prompt recall, the cook question at the default salience: admitted", async () => {
    const bears = server("bears");
    await seed(bears, { filler: true });
    const id = await writeVegan(bears, VEGAN_BEARS_ON);
    expect(turnReach(bears, COOK, id).admitted).toBe(true);
  });

  test("session_end: an entry's bearsOn lands the same way, and its neighbour's text is untouched", async () => {
    const s = server("store");
    await seed(s, { filler: true });
    const out = (
      await s.call("session_end", {
        memories: [
          { content: VEGAN_TEXT, title: VEGAN_TITLE, about: "owner", kind: "fact", salience: 0.8, bearsOn: "cooking, food, restaurants, gifts" },
          { content: "The new road bike's chain was replaced after the race.", about: "owner", kind: "fact" },
        ],
      })
    ).structuredContent;
    const [id, other] = (out["outcomes"] as Record<string, unknown>[]).map((o) => o["id"] as string);
    expect(s.counterpart.store.row(id as string)?.body).toBe(`${VEGAN_TEXT}\n${BEARS_ON_PREFIX} cooking, food, restaurants, gifts.`);
    expect(s.counterpart.store.row(other as string)?.body).toBe("The new road bike's chain was replaced after the race.");
    expect(await factsReach(s, COOK, id as string)).toBe(true);
    expect(turnReach(s, COOK, id as string).admitted).toBe(true);
    expect(await factsReach(s, UNRELATED, id as string)).toBe(false);
  });
});

// ON THE REAL STATIC TABLE (potion-base-8M), when this checkout has it: the
// table every install embeds with, so the meaning channel is in play as it is
// on the bench. Skipped where the weights are not found.
const WEIGHTS = resolveStaticWeights();
describe.skipIf(WEIGHTS === null)("with the real static table: words and meaning together", () => {
  function semanticServer(name: string): { s: McpServer; embed: (t: string) => number[] | null } {
    const embedder = openStaticEmbedder({ weightsDir: (WEIGHTS as { dir: string }).dir });
    const s = openServer({ dir: join(root, name), snapshotsDir: join(root, `${name}-snaps`), session: `sess_${name}`, scope: "/proj/one", now: () => clock, embedder });
    open.push(s.counterpart);
    return { s, embed: embedder.embed as (t: string) => number[] | null };
  }

  test("deliberate recall reaches it from food questions by words and by meaning; without bearsOn it did not; an unrelated one leaves it out", async () => {
    const bare = semanticServer("bare");
    await seed(bare.s, { filler: true });
    const bareId = await writeVegan(bare.s);
    const bears = semanticServer("bears");
    await seed(bears.s, { filler: true });
    const id = await writeVegan(bears.s, VEGAN_BEARS_ON);

    const meaningReach = async (s: McpServer, q: string, target: string): Promise<boolean> =>
      String((await s.call("recall", { question: q, mode: "meaning" })).structuredContent["answer"]).includes(target);
    for (const q of [COOK, ANSWERER, RESTAURANT]) {
      expect({ q, facts: await factsReach(bare.s, q, bareId) }).toEqual({ q, facts: false });
      expect({ q, facts: await factsReach(bears.s, q, id) }).toEqual({ q, facts: true });
    }
    // Meaning mode on this small store: the answerer's own search reaches it
    // (on a copy of the bench's 150-chat store all three did; see the PR).
    expect(await meaningReach(bare.s, ANSWERER, bareId)).toBe(false);
    expect(await meaningReach(bears.s, ANSWERER, id)).toBe(true);
    // CONTROL: an unrelated question, by words, by meaning, and as a turn with its vector.
    expect(await factsReach(bears.s, UNRELATED, id)).toBe(false);
    expect(await meaningReach(bears.s, UNRELATED, id)).toBe(false);
    expect(turnReach(bears.s, UNRELATED, id, bears.embed(UNRELATED)).admitted).toBe(false);
  });
});
