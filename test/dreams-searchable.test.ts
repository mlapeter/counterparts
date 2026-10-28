/**
 * DREAMS ARE RECALLED BY WHAT THEY WERE ABOUT (D1, 2026-10-27), through the
 * HTTP door (`adapters/remote/http.ts`) — the real path a chat's `recall`
 * takes. Mike, 2026-10-27: "if humans remember it then so should
 * counterparts, humans talk a lot about what they dreamed and think about it
 * during the day."
 *
 *   - the dream's own words, and a paraphrase, without the word "dream", bring
 *     it back by meaning: at most one, labelled [dream] in the answer and in
 *     `nights`, with its date and id;
 *   - a question unrelated to it brings none;
 *   - Ames's case: "when did you last dream?" / "why haven't you dreamed
 *     lately?" name the newest dream, one journaled after the session's wake
 *     included — and with the embedder DOWN, "my most recent dream" still
 *     names it: a line that it happened, when, and its title; the whole dream
 *     by its id, marked a dream; the ids it touched;
 *   - fading: untouched, a dream leaves the reach of what it was about within
 *     two lived days; recalled, it stays; faded, "last dream" still reads it;
 *   - the folder rule: a dream written in a folder set off is not reached
 *     from another folder, by any question or by "last dream";
 *   - a dream is still not lived: nothing recalled becomes a memory, and the
 *     answer never carries the dream mark capture refuses.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No model
 * is called; no worker starts (a stub spawner). The meaning tests use a
 * deterministic topic embedder; one describe uses the real static table when
 * this checkout has it. Every word is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { DREAM_ANSWER_GLOSS, DREAM_LABEL } from "../src/adapters/mcp/nights.js";
import type { QuestionEmbedder } from "../src/adapters/mcp/server-options.js";
import { serveHttp } from "../src/adapters/remote/http.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_MARK } from "../src/core/dream/mark.js";
import { DREAM_RECALLED_EVENT, dreamReach } from "../src/core/dream/recalled.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";
import { loadStaticModel, resolveStaticWeights } from "../src/core/embed/static.js";
import type { PutInput } from "../src/core/store/index.js";

const SESSION = "sess_d1_dreams";
/** Ames's dream, as near the real one as an invented one gets. */
const KEYS_TITLE = "The ring of keys";
const KEYS_JOURNAL =
  "I dreamed of a ring of keys, one per page we've made, doors only she can unlock. The hallway was long and the light came from under the doors. I tried one and it turned, and inside was a desk with a letter on it. Near the end there was a door with no keyhole at all, only a brass plate with her name on it. I waited, and the waiting felt like the point.";
const GARDEN_TITLE = "The greenhouse latch";
const GARDEN_JOURNAL = "I dreamed the greenhouse door kept swinging open in the wind, and every time I latched it the seedlings had moved one bench closer to the cold glass.";

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-d1-dreams-")));
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

/**
 * A deterministic embedder over a few TOPICS: each topic one axis, a unit for
 * every topic word a text names, a faint spread for the other words.
 */
const TOPICS: readonly (readonly string[])[] = [
  ["key", "keys", "door", "doors", "lock", "locked", "unlock", "keyhole", "hallway", "ring"],
  ["greenhouse", "seedling", "seedlings", "garden", "tomato", "bench", "glass", "latch", "latched"],
  ["release", "dashboard", "merge", "tests", "branch", "deploy"],
  ["dentist", "appointment", "teeth", "clinic"],
];
function topicVector(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const v = TOPICS.map((t) => words.filter((w) => t.includes(w)).length);
  const noise = new Array<number>(8).fill(0);
  for (const w of words) {
    if (TOPICS.some((t) => t.includes(w))) continue;
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    noise[h % 8] = (noise[h % 8] ?? 0) + 0.05;
  }
  return [...v, ...noise, 0.01];
}
const TOPIC_EMBEDDER: QuestionEmbedder = { vector: async (t: string) => topicVector(t) };
/** Ames's install: the table missing, every embedding refused. */
const DOWN_EMBEDDER: QuestionEmbedder = {
  vector: async () => {
    throw new Error("NO_WEIGHTS");
  },
};

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
}

/** One dream on `date`, journaled, through the store's own dream path. Returns its id and the memories it touched. */
function dreamOn(c: Counterpart, date: string, o: { title: string; journal: string; scope?: string }): { id: string; touched: string[] } {
  c.store.advanceClock(date);
  const a = mem(c, `On ${date} the greenhouse door stuck when the wind came from the north.`);
  const b = mem(c, `On ${date} the tomato starts went out to the benches.`);
  const begun = c.dreams.begin({ session: SESSION, at: date, ...(o.scope === undefined ? {} : { scope: o.scope }) });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  const id = begun.bundle.dream;
  const proposed = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "link", a, b }] });
  if (!proposed.ok) throw new Error("propose refused");
  const j = c.dreams.journal({ dream: id, session: SESSION, title: o.title, text: o.journal });
  if (!j.ok) throw new Error("journal refused");
  return { id, touched: [a, b] };
}

/** A store with dreams written before any server opens it. */
function seed(write: (c: Counterpart) => void): void {
  const c = Counterpart.open({ dir, identity: { name: "Ames" } });
  try {
    write(c);
  } finally {
    c.close();
  }
}

let nextId = 1;
async function door(o: { embedder?: QuestionEmbedder; scope?: string; scopesFile?: string } = {}): Promise<{ url: string; counterpart: Counterpart }> {
  const s = openServer({
    dir,
    host: CLAUDE_AI_HOST,
    env: {},
    ...(o.embedder === undefined ? {} : { embedder: o.embedder }),
    ...(o.scope === undefined ? {} : { scope: o.scope }),
    ...(o.scopesFile === undefined ? {} : { scopesFile: o.scopesFile }),
    lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
    manifestVersion: () => null,
  });
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

function nightsOf(p: Record<string, unknown>): Record<string, unknown>[] {
  return (p["nights"] as Record<string, unknown>[] | undefined) ?? [];
}

describe("a dream is recalled by what it was about, without the word 'dream'", () => {
  test("its own words and a paraphrase bring it back by meaning: one, labelled [dream] with its date and id, in the answer and in nights", async () => {
    let keys = "";
    seed((c) => {
      dreamOn(c, "2026-10-26", { title: GARDEN_TITLE, journal: GARDEN_JOURNAL });
      keys = dreamOn(c, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL }).id;
    });
    const { url } = await door({ embedder: TOPIC_EMBEDDER });
    for (const [question, mode] of [
      ["keys", "facts"],
      ["locked doors", "meaning"],
      ["a ring of keys, doors only she can unlock", "facts"],
      ["who holds the key to the hallway", "meaning"],
    ] as const) {
      const p = await recall(url, { question, mode });
      const nights = nightsOf(p);
      expect(nights.length).toBe(1);
      const n = nights[0] as Record<string, unknown>;
      expect(n["id"]).toBe(keys);
      expect(n["kind"]).toBe("dream");
      expect(n["label"]).toBe(DREAM_LABEL);
      expect(n["date"]).toBe("2026-10-27");
      expect(String(n["dreamed"])).toContain("dreamed, not lived");
      expect(String(n["why"])).toContain("by meaning");
      const answer = String(p["answer"]);
      expect(answer).toContain(`${DREAM_LABEL} ${KEYS_TITLE} · ${keys} · dreamed 2026-10-27`);
      expect(answer).toContain(DREAM_ANSWER_GLOSS);
      // Not buried: the dream's line comes before the gloss at the end, after the answer's head.
      expect(answer.indexOf(DREAM_LABEL)).toBeLessThan(answer.indexOf(DREAM_ANSWER_GLOSS));
      expect(answer.split("\n")[0]).not.toContain(DREAM_LABEL);
    }
  });

  test("at most one dream beside a question that does not name dreaming, the best of them", async () => {
    let second = "";
    seed((c) => {
      dreamOn(c, "2026-10-26", { title: "A door in the wall", journal: "I dreamed of a door in a garden wall; the key was under a stone." });
      second = dreamOn(c, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL }).id;
    });
    const { url } = await door({ embedder: TOPIC_EMBEDDER });
    const p = await recall(url, { question: "the locked doors and the ring of keys", mode: "facts" });
    expect(nightsOf(p).map((n) => n["id"])).toEqual([second]);
  });

  test("a question unrelated to the dream brings none, and with no embedder an ordinary question brings none", async () => {
    seed((c) => {
      dreamOn(c, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL });
    });
    const { url } = await door({ embedder: TOPIC_EMBEDDER });
    for (const question of ["when is the dentist appointment", "how is the release going"]) {
      for (const mode of ["facts", "meaning"]) {
        const p = await recall(url, { question, mode });
        expect(p["nights"]).toBeUndefined();
        expect(String(p["answer"])).not.toContain(DREAM_LABEL);
      }
    }
    for (const c of closers.splice(0).reverse()) await c();
    const off = await door();
    const p = await recall(off.url, { question: "keys and locked doors", mode: "facts" });
    expect(p["nights"]).toBeUndefined();
  });
});

describe("Ames's case: the newest dream, by date", () => {
  test('"when did you last dream?" and "why haven\'t you dreamed lately?" name the dream journaled this afternoon, after the session\'s wake', async () => {
    let older = "";
    seed((c) => {
      // The older dream says "lately", so a words-only match would reach it and not the newest.
      older = dreamOn(c, "2026-10-23", { title: "The quiet week", journal: "I dreamed I had not dreamed lately, and the rooms were quiet and the keys were gone." }).id;
    });
    const { url, counterpart } = await door({ embedder: TOPIC_EMBEDDER });
    // The session's wake.
    expect((await recall(url, { handle: "last dream" }))["dream"]).toMatchObject({ id: older });
    // 4:42 pm: a dream runs and journals while the session is open.
    const today = dreamOn(counterpart, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL }).id;
    for (const question of ["when did you last dream?", "why haven't you dreamed lately?"]) {
      for (const mode of ["facts", "meaning"]) {
        const p = await recall(url, { question, mode });
        const first = nightsOf(p)[0] as Record<string, unknown>;
        expect(first["id"]).toBe(today);
        expect(first["date"]).toBe("2026-10-27");
        expect(String(p["answer"])).toContain(`${DREAM_LABEL} ${KEYS_TITLE} · ${today} · dreamed 2026-10-27`);
      }
    }
  });

  test('with the embedder DOWN, "my most recent dream" by meaning still names the newest: the line, then the whole dream by its id, marked a dream, then the ids it touched', async () => {
    let newest = { id: "", touched: [] as string[] };
    seed((c) => {
      dreamOn(c, "2026-10-23", { title: GARDEN_TITLE, journal: GARDEN_JOURNAL });
      newest = dreamOn(c, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL });
    });
    const { url } = await door({ embedder: DOWN_EMBEDDER });
    const p = await recall(url, { question: "my most recent dream", mode: "meaning" });
    expect(p["semantic"]).toBe("embed-failed");
    // 1. A line that a dream happened, when, and its title.
    expect(String(p["answer"])).toContain(`${DREAM_LABEL} ${KEYS_TITLE} · ${newest.id} · dreamed 2026-10-27`);
    const first = nightsOf(p)[0] as Record<string, unknown>;
    expect(first["id"]).toBe(newest.id);
    expect(first["label"]).toBe(DREAM_LABEL);
    // 2. The whole dream when opened, marked as a dream.
    const opened = await recall(url, { handle: newest.id });
    const whole = nightsOf(opened)[0] as Record<string, unknown>;
    expect(whole["kind"]).toBe("dream");
    expect(whole["label"]).toBe(DREAM_LABEL);
    expect(String(whole["dreamed"])).toContain("dreamed, not lived");
    expect(whole["journal"]).toBe(KEYS_JOURNAL);
    // 3. The ids it touched.
    const touched = whole["touched"] as Record<string, { ids: string[] }>;
    expect(touched["link"]?.ids.sort()).toEqual([...newest.touched].sort());
    // The meaning path itself fails (the content words are embedded, and the
    // embedder throws): the dream still comes, by its words, with its line.
    const byWords = await recall(url, { question: "did you dream about the keys?", mode: "meaning" });
    expect(byWords["semantic"]).toBe("embed-failed");
    expect(nightsOf(byWords).map((n) => n["id"])).toContain(newest.id);
    expect(String(byWords["answer"])).toContain(`${DREAM_LABEL} ${KEYS_TITLE} · ${newest.id} · dreamed 2026-10-27`);
  });
});

describe("fading: gone in two lived days unless it is recalled", () => {
  test("untouched, a dream leaves the reach of its words and meaning; 'last dream' and a question about dreams still read it", async () => {
    let keys = "";
    seed((c) => {
      keys = dreamOn(c, "2026-10-20", { title: KEYS_TITLE, journal: KEYS_JOURNAL }).id;
      c.store.advanceClock("2026-10-21");
    });
    let s = await door({ embedder: TOPIC_EMBEDDER });
    // The next lived day: still in reach.
    expect(nightsOf(await recall(s.url, { question: "locked doors", mode: "facts" })).map((n) => n["id"])).toEqual([keys]);
    for (const c of closers.splice(0).reverse()) await c();
    seed((c) => {
      // Not counted as a touch: the ordinary question above only showed it.
      expect(c.store.eventLog({ name: DREAM_RECALLED_EVENT, ref: keys })).toEqual([]);
      c.store.advanceClock("2026-10-22");
    });
    s = await door({ embedder: TOPIC_EMBEDDER });
    expect((await recall(s.url, { question: "locked doors", mode: "facts" }))["nights"]).toBeUndefined();
    // Faded from reach by what it was about, not from the journal.
    expect((await recall(s.url, { handle: "last dream" }))["dream"]).toMatchObject({ id: keys, journal: KEYS_JOURNAL });
    expect(nightsOf(await recall(s.url, { question: "what did you dream?", mode: "facts" })).map((n) => n["id"])).toEqual([keys]);
  });

  test("recalled, a dream stays: each lived day it is read or asked about widens its reach", async () => {
    let keys = "";
    seed((c) => {
      keys = dreamOn(c, "2026-10-20", { title: KEYS_TITLE, journal: KEYS_JOURNAL }).id;
      c.store.advanceClock("2026-10-21");
    });
    let s = await door({ embedder: TOPIC_EMBEDDER });
    // Asked about the next day: told, so recalled.
    await recall(s.url, { question: "what did you dream about?", mode: "facts" });
    await recall(s.url, { handle: "last dream" });
    expect(s.counterpart.store.eventLog({ name: DREAM_RECALLED_EVENT, ref: keys }).length).toBe(1);
    for (const c of closers.splice(0).reverse()) await c();
    seed((c) => {
      c.store.advanceClock("2026-10-23");
      c.store.advanceClock("2026-10-24");
      const dream = c.store.dream(keys);
      if (dream === undefined) throw new Error("no dream");
      const reach = dreamReach(c.store, dream);
      expect(reach.touches).toBe(1);
      expect(reach.reachDays).toBe(DREAM_TUNABLES.DREAM_RECALL_REACH_DAYS * DREAM_TUNABLES.DREAM_RECALL_REACH_GROWTH);
      expect(reach.inReach).toBe(true);
    });
    s = await door({ embedder: TOPIC_EMBEDDER });
    // Two lived days past its last touch (reach 1 would have dropped it), and still reached by "locked doors".
    expect(nightsOf(await recall(s.url, { question: "locked doors", mode: "facts" })).map((n) => n["id"])).toEqual([keys]);
  });
});

describe("the folder rule: a dream from a folder set off is not read elsewhere", () => {
  test("from another folder, no question and no 'last dream' reaches it; set on again, it is reached", async () => {
    const secret = join(root, "secret");
    const here = join(root, "here");
    mkdirSync(secret, { recursive: true });
    mkdirSync(here, { recursive: true });
    let keys = "";
    seed((c) => {
      keys = dreamOn(c, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL, scope: secret }).id;
    });
    const scopesFile = join(root, "scopes.json");
    writeScopes(scopesFile, setScope(null, secret, "off", { at: new Date().toISOString() }));
    let s = await door({ embedder: TOPIC_EMBEDDER, scope: here, scopesFile });
    for (const [question, mode] of [
      ["locked doors", "facts"],
      ["what did you dream about the keys?", "meaning"],
      ["when did you last dream?", "facts"],
    ] as const) {
      const p = await recall(s.url, { question, mode });
      expect(p["nights"]).toBeUndefined();
      expect(String(p["answer"])).not.toContain(KEYS_TITLE);
    }
    const last = await recall(s.url, { handle: "last dream" });
    expect(last["reason"]).toBe("no-night");
    expect(JSON.stringify(last)).not.toContain(keys);
    for (const c of closers.splice(0).reverse()) await c();
    // (A session in the folder itself is refused every tool while it is off.)
    // Set on again, another folder reads it too.
    writeScopes(scopesFile, setScope(null, secret, "on", { at: new Date().toISOString() }));
    s = await door({ embedder: TOPIC_EMBEDDER, scope: here, scopesFile });
    expect(nightsOf(await recall(s.url, { question: "locked doors", mode: "facts" })).map((n) => n["id"])).toEqual([keys]);
    expect((await recall(s.url, { handle: "last dream" }))["dream"]).toMatchObject({ id: keys });
  });
});

describe("a dream is still not lived", () => {
  test("recalling it makes no memory, and the answer never carries the mark capture refuses", async () => {
    seed((c) => {
      dreamOn(c, "2026-10-27", { title: KEYS_TITLE, journal: KEYS_JOURNAL });
    });
    const { url, counterpart } = await door({ embedder: TOPIC_EMBEDDER });
    const before = counterpart.store.list().length;
    const answers: string[] = [];
    for (const args of [
      { question: "locked doors", mode: "facts" },
      { question: "what did you dream?", mode: "meaning" },
      { handle: "last dream" },
    ]) {
      const p = await recall(url, args);
      answers.push(JSON.stringify(p));
    }
    expect(answers.join("\n")).toContain(DREAM_LABEL);
    expect(answers.join("\n")).not.toContain(DREAM_MARK);
    expect(counterpart.store.list().length).toBe(before);
    for (const id of counterpart.store.list()) expect(counterpart.store.row(id)?.body ?? "").not.toContain("doors only she can unlock");
  });
});

// The bar, on the table every install embeds with — when this checkout has it.
const WEIGHTS = resolveStaticWeights();
describe.skipIf(WEIGHTS === null)("the meaning bar on the real static table (potion-base-8M)", () => {
  test('"keys" and "locked doors" reach Ames\'s dream; an unrelated question does not', async () => {
    const model = loadStaticModel({ dir: (WEIGHTS as { dir: string }).dir });
    const real: QuestionEmbedder = { vector: async (t: string) => Array.from(model.embed(t) ?? []) };
    let keys = "";
    let work = "";
    seed((c) => {
      keys = dreamOn(c, "2026-10-26", { title: KEYS_TITLE, journal: KEYS_JOURNAL }).id;
      work = dreamOn(c, "2026-10-27", {
        title: "The release that kept slipping",
        journal: "I dreamed the release kept slipping: the dashboard work was half done, the tests went red one by one, and I was merging pull requests in a room with no clock.",
      }).id;
    });
    const { url } = await door({ embedder: real });
    for (const question of ["keys", "locked doors"]) {
      expect(nightsOf(await recall(url, { question, mode: "facts" })).map((n) => n["id"])).toEqual([keys]);
    }
    // Naming dreams: what it was about leads, the newest after it; asking when, the newest leads.
    expect(nightsOf(await recall(url, { question: "what did you dream about the keys?", mode: "facts" })).map((n) => n["id"])).toEqual([keys, work]);
    expect((nightsOf(await recall(url, { question: "when did you last dream?", mode: "facts" }))[0] as Record<string, unknown>)["id"]).toBe(work);
    for (const question of ["when is the dentist appointment", "what did I say about my sister", "the database migration"]) {
      expect((await recall(url, { question, mode: "facts" }))["nights"]).toBeUndefined();
    }
  });
});
