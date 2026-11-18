/**
 * BEARS ON (BO1, 2026-11-17): a lasting fact about the owner comes back for a
 * question in an area it bears on, though the question never names it.
 *
 * The measured miss (Memorilla "Buried Clue"): "User has been vegan for
 * years", written from a chat about leather, was never reached by "What
 * should I cook for my parents this Sunday?" — not by per-prompt recall and
 * not by the answerer's own search. `remember` and each `session_end` entry
 * now take `bearsOn`, folded into the text after the battery as its last
 * paragraph, "Also about: …" (`core/areas.ts`), which is what the token index
 * and the embedder read (`store/index-text.ts#indexTextOf`). The fix round
 * (review of #846, numbered 1-9 and (a)-(b) below) holds what the line may not do.
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
import { AREAS_LABEL, AREAS_OFF_SUBJECT, admitAreas, areasLineOf, areasOfLine, foldAreas, keepSourcesAreas, readAreas, stripAreasLine } from "../src/core/areas.js";
import { CODEX_HOST } from "../src/adapters/hosts.js";
import { titleOfRow } from "../src/core/counterpart-wake-shape.js";
import { Counterpart } from "../src/core/counterpart.js";
import { STOPWORDS } from "../src/core/recall/reference.js";
import { tokenize } from "../src/core/store/index.js";
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

const KEY = "sk-ant-api03-" + "A".repeat(90) + "AA";
const LINE = `${AREAS_LABEL} cooking, food, restaurants, recipes, gifts.`;
const VEGAN_STORED = `${VEGAN_TEXT}\n\n${LINE}`;

function body(s: McpServer, id: string): string {
  return s.counterpart.store.row(id)?.body ?? "";
}

describe("the core reads, admits and folds the areas", () => {
  test("a list, or a comma-separated string, screened like tags; reasons, never values", () => {
    expect(readAreas(["Cooking", "restaurants", "cooking", " gifts "])).toEqual({ sent: ["cooking", "restaurants", "gifts"], dropped: [] });
    expect(readAreas("hikes, stairs").sent).toEqual(["hikes", "stairs"]);
    expect(readAreas(null)).toEqual({ sent: null, dropped: [] });
    expect(readAreas(undefined)).toEqual({ dropped: [] });
    const r = readAreas(["food", 7, KEY]);
    expect(r.sent).toEqual(["food"]);
    expect(r.dropped).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("sk-ant");
  });

  test("off-subject: none kept; an area the text names (stemmed) is dropped", () => {
    expect(admitAreas(["cooking"], { about: "work", kind: "fact", text: "x" })).toEqual({ areas: [], dropped: [AREAS_OFF_SUBJECT] });
    expect(admitAreas(["cooking"], { about: null, kind: "person", text: "Katie" }).areas).toEqual(["cooking"]);
    const named = admitAreas(["home network", "router placement", "cooking"], { about: "owner", kind: "fact", text: "The user moved the router off the home network shelf; the cook works nights." });
    expect(named.areas).toEqual([]);
    expect(named.dropped).toHaveLength(3);
  });

  test("the fold ends the text as a sentence, then the line as its own paragraph; once only", () => {
    expect(foldAreas("Vegan for years", ["cooking"])).toBe(`Vegan for years.\n\n${AREAS_LABEL} cooking.`);
    expect(foldAreas("Vegan for years.", ["cooking", "gifts"])).toBe(`Vegan for years.\n\n${AREAS_LABEL} cooking, gifts.`);
    const once = foldAreas("Vegan.", ["cooking"]);
    expect(foldAreas(once, ["gifts"])).toBe(once);
    expect(stripAreasLine(once)).toBe("Vegan.");
  });

  test("the label's words are words no search uses: both are query stopwords", () => {
    for (const w of tokenize(AREAS_LABEL)) expect(STOPWORDS.has(w)).toBe(true);
  });

  test("remember and each session_end entry publish bearsOn, narrowly, and both carry the engine row", () => {
    const remember = TOOLS.find((t) => t.name === "remember");
    const sessionEnd = TOOLS.find((t) => t.name === "session_end");
    const desc = (remember?.inputSchema as { properties: Record<string, { description?: string }> }).properties["bearsOn"]?.description ?? "";
    expect(desc).toContain("that the text doesn't name");
    expect(desc).toContain("Otherwise leave it out.");
    const items = (sessionEnd?.inputSchema as { properties: { memories: { items: { properties: Record<string, unknown> } } } }).properties.memories.items;
    expect(items.properties["bearsOn"]).toBeDefined();
    for (const t of [remember, sessionEnd]) expect((t?.engine ?? []).some((p) => p.claim.startsWith("`bearsOn`"))).toBe(true);
  });
});

describe("through the door: what the line may and may not do", () => {
  test("remember with bearsOn: the stored text carries the line, and the answer says what was folded", async () => {
    const s = server("store");
    const out = (await s.call("remember", { title: VEGAN_TITLE, text: VEGAN_TEXT, about: "owner", kind: "fact", bearsOn: VEGAN_BEARS_ON })).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(body(s, out["id"] as string)).toBe(VEGAN_STORED);
    expect(out["bearsOn"]).toEqual({ stored: true, areas: VEGAN_BEARS_ON });
  });

  test("1. the line never rescues a write: a stub, or a credential alone, is refused as before", async () => {
    const s = server("store");
    const stub = (await s.call("remember", { text: "ok", about: "owner", bearsOn: ["cooking", "food"] })).structuredContent;
    expect(stub["stored"]).not.toBe(true);
    const key = (await s.call("remember", { text: KEY, about: "owner", bearsOn: ["cooking", "food"] })).structuredContent;
    expect(key["stored"]).not.toBe(true);
    const end = (await s.call("session_end", { memories: [{ content: "ok", about: "owner", bearsOn: "cooking, food" }] })).structuredContent;
    expect((end["outcomes"] as Record<string, unknown>[])[0]?.["stored"]).toBe(false);
  });

  test("2. a re-save of the same fact with other areas is a duplicate, pointed at updates", async () => {
    const s = server("store");
    await s.call("remember", { title: VEGAN_TITLE, text: VEGAN_TEXT, about: "owner", kind: "fact", bearsOn: ["cooking"] });
    const again = (await s.call("remember", { title: VEGAN_TITLE, text: VEGAN_TEXT, about: "owner", kind: "fact", bearsOn: ["gifts"] })).structuredContent;
    expect(again["stored"]).toBe(false);
    expect(again["reason"]).toBe("duplicate-content");
    expect(JSON.stringify(again["bearsOn"])).toContain("send updates with its id and bearsOn");
  });

  test("3. the label reaches nothing: bear and Chicago Bears questions leave the fact out", async () => {
    const s = server("store");
    await seed(s);
    const id = await writeVegan(s, VEGAN_BEARS_ON);
    for (const q of ["bear safety while camping", "Did the Chicago Bears win?"]) {
      expect({ q, reached: await factsReach(s, q, id) }).toEqual({ q, reached: false });
      expect({ q, admitted: turnReach(s, q, id).admitted }).toEqual({ q, admitted: false });
    }
    // The label's own words are stopwords to the facts search. (Per-prompt
    // weighs words by rarity, not a stop list: in a store this small "also" and
    // "about" are rare, so that path is not asserted here; in a lived store
    // they are among the commonest words it holds.)
    expect(await factsReach(s, "what else is it also about", id)).toBe(false);
    // CONTROL: the old label, written by hand, is what "bear" reached.
    const old = (await s.call("remember", { text: "User is lactose intolerant.\nBears on: cooking, food.", about: "owner", kind: "fact" })).structuredContent;
    expect(await factsReach(s, "bear safety while camping", old["id"] as string)).toBe(true);
  });

  test("4. a dropped area is said by its reason; a secret is never echoed", async () => {
    const s = server("store");
    const out = (await s.call("remember", { title: VEGAN_TITLE, text: VEGAN_TEXT, about: "owner", kind: "fact", bearsOn: ["food", KEY] })).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(body(s, out["id"] as string)).toBe(`${VEGAN_TEXT}\n\n${AREAS_LABEL} food.`);
    expect(JSON.stringify(out)).not.toContain("sk-ant");
    expect((out["bearsOn"] as { dropped: string[] }).dropped).toHaveLength(1);
  });

  test("5. two unrelated facts sharing areas are not offered as each other's neighbours", async () => {
    const s = server("store");
    await writeVegan(s, ["cooking", "food", "restaurants", "gifts"]);
    const out = (
      await s.call("remember", { title: "Peanut allergy", text: "User is allergic to peanuts.", about: "owner", kind: "fact", bearsOn: ["cooking", "food", "restaurants", "gifts"] })
    ).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(out["neighbours"]).toBeUndefined();
  });

  test("6. a revision carries its memory's line; bearsOn: null sends none; its own areas replace", async () => {
    const s = server("store");
    const id = await writeVegan(s, VEGAN_BEARS_ON);
    const rev = (await s.call("remember", { text: "User has been vegan for years and avoids honey too.", about: "owner", kind: "fact", updates: id, how: "changed" })).structuredContent;
    expect(body(s, rev["id"] as string)).toBe(`User has been vegan for years and avoids honey too.\n\n${LINE}`);
    expect((rev["bearsOn"] as { carriedFrom: string }).carriedFrom).toBe(id);
    const off = (await s.call("remember", { text: "User has been vegan for years, and eats no honey or gelatin.", about: "owner", kind: "fact", updates: rev["id"], how: "changed", bearsOn: null })).structuredContent;
    expect(body(s, off["id"] as string)).toBe("User has been vegan for years, and eats no honey or gelatin.");
    const own = (await s.call("session_end", { memories: [{ content: "User has been vegan for years; gelatin is out too.", about: "owner", kind: "fact", updates: rev["id"], how: "changed", bearsOn: ["baking"] }] })).structuredContent;
    const ownId = (own["outcomes"] as Record<string, unknown>[])[0]?.["id"] as string;
    expect(body(s, ownId)).toBe(`User has been vegan for years; gelatin is out too.\n\n${AREAS_LABEL} baking.`);
  });

  test("7. an untitled memory's heading stops before the line", async () => {
    const s = server("store");
    const out = (await s.call("remember", { text: "User has been vegan for years", about: "owner", kind: "fact", bearsOn: ["cooking"] })).structuredContent;
    const row = s.counterpart.store.row(out["id"] as string);
    expect(row?.body).toBe(`User has been vegan for years.\n\n${AREAS_LABEL} cooking.`);
    expect(titleOfRow({ title: null, body: row?.body ?? "" })).not.toContain("Also about");
  });

  test("(a) off-subject: a memory not about people stores without the line, and says why", async () => {
    const s = server("store");
    const out = (await s.call("remember", { text: "Moved the router to the hallway shelf for better coverage.", about: "work", bearsOn: ["wifi"] })).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(body(s, out["id"] as string)).toBe("Moved the router to the hallway shelf for better coverage.");
    expect(out["bearsOn"]).toEqual({ stored: false, areas: [], dropped: [AREAS_OFF_SUBJECT] });
  });

  test("(b) areas the text already names are dropped; none left, no line", async () => {
    const s = server("store");
    const out = (
      await s.call("remember", { text: "The user's home network drops when the router sits in the closet; router placement matters.", about: "owner", bearsOn: ["home network", "router placement"] })
    ).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(body(s, out["id"] as string)).not.toContain(AREAS_LABEL);
    expect((out["bearsOn"] as { dropped: string[] }).dropped).toHaveLength(2);
  });
});

describe("a lasting fact comes back for a question in an area it bears on", () => {
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
    // Salience held equal in both stores (0.8): the only difference is the line.
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

  test("9. per-prompt, the cook question at the default salience: the fact is a candidate (the precondition the gap below needs)", async () => {
    const bears = server("bears");
    await seed(bears, { filler: true });
    const id = await writeVegan(bears, VEGAN_BEARS_ON);
    expect(turnReach(bears, COOK, id).rank).toBeGreaterThanOrEqual(0);
  });

  // THE GAP THIS DOES NOT CLOSE (BO1, measured on a copy of the bench's Sam
  // store too): at the default salience a writer leaves on an owner fact, the
  // soup memories set the cook turn's relative bar and the vegan fact — a
  // candidate, by the test above — stays under it. On the bench store it is
  // worse: at its real age (written day 88, asked day 150, never used) the
  // fact has faded below reach, and ambient recall leaves a below-reach memory
  // out whatever its words. Admission there is the gate's and forgetting's
  // question, not the write's; when it is answered this starts passing and
  // should flip.
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
    expect(body(s, id as string)).toBe(`${VEGAN_TEXT}\n\n${AREAS_LABEL} cooking, food, restaurants, gifts.`);
    expect(body(s, other as string)).toBe("The new road bike's chain was replaced after the race.");
    expect(await factsReach(s, COOK, id as string)).toBe(true);
    expect(turnReach(s, COOK, id as string).admitted).toBe(true);
    expect(await factsReach(s, UNRELATED, id as string)).toBe(false);
  });
});

describe("fix round 2 (review of #846)", () => {
  test("R1. a revision with no about mark inherits its target's, so its areas are judged against that; all dropped, the old line carries", async () => {
    const s = server("store");
    const id = await writeVegan(s, VEGAN_BEARS_ON);
    const rev = (await s.call("remember", { text: "User has been vegan for years and also avoids honey and gelatin.", kind: "fact", updates: id, how: "changed", bearsOn: ["baking"] })).structuredContent;
    expect(rev["stored"]).toBe(true);
    expect(body(s, rev["id"] as string)).toBe(`User has been vegan for years and also avoids honey and gelatin.\n\n${AREAS_LABEL} baking.`);
    expect(rev["bearsOn"]).toEqual({ stored: true, areas: ["baking"] });
    // Every sent area dropped (the text names it): the old line is kept, not lost.
    const again = (await s.call("remember", { text: "User has been vegan for years; honey and gelatin are out.", kind: "fact", updates: rev["id"], how: "changed", bearsOn: ["vegan"] })).structuredContent;
    expect(body(s, again["id"] as string)).toBe(`User has been vegan for years; honey and gelatin are out.\n\n${AREAS_LABEL} baking.`);
    expect((again["bearsOn"] as { carriedFrom: string }).carriedFrom).toBe(rev["id"] as string);
  });

  test("R2. a text with its own areas line and bearsOn sent: the line is replaced, and the answer names what was folded; nothing landed is never stored:true", async () => {
    const s = server("store");
    const out = (
      await s.call("remember", { text: `User is lactose intolerant.\n\n${AREAS_LABEL} dairy aisle.`, about: "owner", kind: "fact", bearsOn: ["cooking", "restaurants"] })
    ).structuredContent;
    expect(body(s, out["id"] as string)).toBe(`User is lactose intolerant.\n\n${AREAS_LABEL} cooking, restaurants.`);
    expect(out["bearsOn"]).toEqual({ stored: true, areas: ["cooking", "restaurants"] });
    const none = (await s.call("remember", { text: "User is allergic to shellfish.", about: "owner", kind: "fact", bearsOn: ["shellfish"] })).structuredContent;
    expect(none["stored"]).toBe(true);
    expect((none["bearsOn"] as { stored: boolean }).stored).toBe(false);
    expect(body(s, none["id"] as string)).toBe("User is allergic to shellfish.");
  });

  test("R3. the description says the mark it needs; a reader host's us is let through though it stores no mark", async () => {
    const remember = TOOLS.find((t) => t.name === "remember");
    const desc = (remember?.inputSchema as { properties: Record<string, { description?: string }> }).properties["bearsOn"]?.description ?? "";
    expect(desc).toContain("marked about owner or us or kind person");
    const s = openServer({ dir: join(root, "codex"), snapshotsDir: join(root, "codex-snaps"), session: "sess_cx", host: CODEX_HOST, scope: "/proj/one", now: () => clock });
    open.push(s.counterpart);
    const out = (await s.call("remember", { text: "The owner and I keep a vegan kitchen when we cook together.", about: "us", kind: "fact", bearsOn: ["restaurants", "gifts"] })).structuredContent;
    expect(out["stored"]).toBe(true);
    expect(s.counterpart.store.row(out["id"] as string)?.about ?? null).toBeNull();
    expect(body(s, out["id"] as string)).toBe(`The owner and I keep a vegan kitchen when we cook together.\n\n${AREAS_LABEL} restaurants, gifts.`);
  });

  test("R4. a night's merge or fold keeps the union of its sources' areas when its words dropped them, for people only, minus what its words name", () => {
    const owner = { about: "owner", kind: "fact" };
    const merged = keepSourcesAreas(
      "Mia and Sam are both vegan.",
      [`Mia is vegan.\n\n${AREAS_LABEL} cooking, restaurants.`, `Sam is vegan.\n\n${AREAS_LABEL} restaurants, gifts.`, "Sam lives in Leeds."],
      owner,
    );
    expect(merged).toBe(`Mia and Sam are both vegan.\n\n${AREAS_LABEL} cooking, restaurants, gifts.`);
    expect(keepSourcesAreas(`Merged.\n\n${AREAS_LABEL} baking.`, [`x\n\n${AREAS_LABEL} cooking.`], owner)).toBe(`Merged.\n\n${AREAS_LABEL} baking.`);
    expect(keepSourcesAreas("Merged.", ["no line here"], owner)).toBe("Merged.");
    // Round 3: the merged memory's own mark and words decide, as a write's do.
    expect(keepSourcesAreas("Merged.", [`x\n\n${AREAS_LABEL} cooking.`], { about: "work", kind: "fact" })).toBe("Merged.");
    expect(keepSourcesAreas("Merged.", [`x\n\n${AREAS_LABEL} cooking.`], { about: null, kind: "person" })).toBe(`Merged.\n\n${AREAS_LABEL} cooking.`);
    expect(keepSourcesAreas("They cook at home.", [`x\n\n${AREAS_LABEL} cooking, gifts.`], owner)).toBe(`They cook at home.\n\n${AREAS_LABEL} gifts.`);
    const many = Array.from({ length: 12 }, (_, i) => `area${String.fromCharCode(97 + i)}`);
    expect(areasOfLine(areasLineOf(keepSourcesAreas("M.", [`x\n\n${AREAS_LABEL} ${many.join(", ")}.`], owner)) ?? "")).toHaveLength(8);
  });

  test("R4b. a real merge: the areas line sits before the Names line, which stays last, so the wake's strip leaves no ids", () => {
    const c = Counterpart.open({ dir: join(root, "dream"), identity: { name: "Mike" } });
    open.push(c);
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 14; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    const at = { physics: { birthDay: day, lastUsedDay: day } };
    const named = c.store.put({ type: "memory", kind: "fact", body: "Mike's parents visit every spring and stay a week at the house.", about: "owner", ...at });
    const a = c.store.put({
      type: "memory",
      kind: "fact",
      body: `Mike has been vegan for years, as his parents know (${named}).\n\n${AREAS_LABEL} cooking, restaurants.`,
      about: "owner",
      salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
      ...at,
    });
    const b = c.store.put({
      type: "memory",
      kind: "fact",
      body: `Mike eats no animal products at all, and has not for years.\n\n${AREAS_LABEL} restaurants, gifts.`,
      about: "owner",
      salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
      ...at,
    });
    const begun = c.dreams.begin({ session: "s-dream", scope: "/proj" });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const out = c.dreams.propose({ dream: begun.bundle.dream, session: "s-dream", changes: [{ action: "merge", ids: [a, b], text: "Mike has been fully vegan for years and eats no animal products" }] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const merged = out.results[0]?.id as string;
    const mergedBody = c.store.row(merged)?.body ?? "";
    expect(mergedBody).toBe(`Mike has been fully vegan for years and eats no animal products.\n\n${AREAS_LABEL} cooking, restaurants, gifts.\n\nNames: ${named}`);
    // The two strips the wake reads (`counterpart-wake-shape.ts`, `time.ts#datedText`) take a LAST Names line only.
    const read = mergedBody.replace(/\n+Names: [^\n]*\s*$/u, "");
    expect(read).not.toContain("mem_");
    expect(read).not.toContain("Names:");
    expect(titleOfRow({ title: null, body: mergedBody })).toBe("Mike has been fully vegan for years and eats no animal products.");
  });

  test("R6. a revision carries its target's line only when the memory as stored is one areas are for", async () => {
    const s = server("store");
    const id = await writeVegan(s, VEGAN_BEARS_ON);
    const world = (await s.call("remember", { text: "Veganism has grown a lot in this city over the last decade.", about: "world", kind: "fact", updates: id, how: "changed" })).structuredContent;
    expect(world["stored"]).toBe(true);
    expect(body(s, world["id"] as string)).toBe("Veganism has grown a lot in this city over the last decade.");
    expect(world["bearsOn"]).toBeUndefined();
    // It did revise the vegan fact (settled over it, not held): the carry was asked, and refused.
    expect((world["settled"] as { over: string }).over).toBe(id);
  });

  test("R5. two people's facts sharing the same areas are not one memory to the near-duplicate hide", async () => {
    const s = server("store");
    await seed(s, { filler: true });
    const areas = ["cooking", "food", "restaurants", "recipes", "gifts", "baking"];
    // "Mia is vegan." alone is under the content floor, so a few words more; the
    // two texts differ only by the name (word overlap 0.8 without the line, 0.89 with it).
    const mia = (await s.call("remember", { text: "Mia has been strictly vegan for many years now.", kind: "person", salience: 0.8, bearsOn: areas })).structuredContent["id"] as string;
    const sam = (await s.call("remember", { text: "Sam has been strictly vegan for many years now.", kind: "person", salience: 0.8, bearsOn: areas })).structuredContent["id"] as string;
    expect(body(s, mia)).toContain(AREAS_LABEL);
    expect(body(s, sam)).toContain(AREAS_LABEL);
    const d = s.counterpart.recallForTurn({ sessionId: "turn-r5", text: "Any recipes for cooking and baking gifts for Mia and Sam?" }).decision;
    const shown = [...d.surfaced, ...d.footnotes];
    expect(shown).toContain(mia);
    expect(shown).toContain(sam);
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
