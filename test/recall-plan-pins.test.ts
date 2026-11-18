/**
 * RECALL'S PLAN PINS (2026-11-18, the recall latency diagnosis). Two queries
 * the planner sent through `memories_birth (archived=?)` — every live memory —
 * because the store has no planner statistics and `archived = 0` looks
 * selective when it matches nearly every row:
 *
 * - `tagNeighbours` (priming's concept edges) once its IN list reached 4
 *   words; pinned to the tag index with `+m.archived`;
 * - `subjectsOfKind` (the self subject, a kind's cards); pinned to
 *   `memories_subject_kind` the same way.
 *
 * And two reads cut without a plan: `tagPartners`' `membersOf` reads each word
 * to one past the cap, and `beliefsNamedIn` catches up once a call, not once
 * a named subject. Each is checked here for the same answer as before — the
 * unpinned SQL, the unlimited read, the per-subject `beliefStanding` — and
 * the two through the real door (`Counterpart#recallForTurn`).
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that
 * path; no model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as RECALL } from "../src/core/recall/index.js";
import type { RecallDecision } from "../src/core/recall/index.js";
import { Schemas } from "../src/core/schemas/index.js";
import { tagPartners } from "../src/core/schemas/tags.js";
import { Store } from "../src/core/store/index.js";
import { subjectsOfKindSql, tagNeighboursSql } from "../src/core/store/wave2.js";
import { findable } from "./store-fixture.js";

let root: string;
let clock = Date.UTC(2026, 9, 1, 12);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plan-pins-")));
  clock = Date.UTC(2026, 9, 1, 12);
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

type Ops = { all<T>(sql: string, ...params: unknown[]): T[] };
/** The store's own connection (private; a test reads through it). */
const opsOf = (s: Store): Ops => (s as unknown as { ops: Ops }).ops;
const planOf = (s: Store, sql: string, ...params: unknown[]): string[] =>
  opsOf(s)
    .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
    .map((r) => r.detail);

/** The queries as master a226a147 wrote them, before the pins. */
const unpinnedNeighbours = (n: number): string => tagNeighboursSql(n).replace("+m.archived = 0", "m.archived = 0");
const unpinnedSubjects = (): string => subjectsOfKindSql(false).replace("+archived = 0", "archived = 0");

function store(): Store {
  const s = Store.open({ dir: join(root, "store"), snapshotsDir: join(root, "snaps") });
  open.push(s);
  return s;
}

const WORDS = ["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"];

/** 400 tagged memories, some archived and some superseded, and a few cards with a subject kind. */
function taggedWorld(s: Store): void {
  const ids: string[] = [];
  for (let i = 0; i < 400; i++) {
    const id = s.put({ type: "memory", kind: "fact", body: `memory ${String(i)} about ${WORDS[i % 8] ?? ""}` });
    s.tagMemory(id, [WORDS[i % 8] ?? "w0", `x${String(i % 5)}`, `y${String(i % 13)}`], "write");
    ids.push(id);
  }
  for (const id of ids.slice(0, 40)) s.archive(id, "test");
  for (const id of ids.slice(40, 50)) s.supersede(id, { type: "memory", kind: "fact", body: `newer ${id}` });
  for (const name of ["Ada", "Wren", "Ines"]) {
    const id = s.put({ type: "schema", kind: "person", title: name, body: name, meta: { role: "entity", name, aliases: [] } });
    s.setSubjectKind(id, "person");
  }
}

describe("the plans (EXPLAIN QUERY PLAN)", () => {
  test("tagNeighbours walks the tag index at every list length; unpinned, 4 words or more start from memories_birth", () => {
    const s = store();
    taggedWorld(s);
    for (let n = 1; n <= WORDS.length; n++) {
      const w = WORDS.slice(0, n);
      const plan = planOf(s, tagNeighboursSql(n), ...w, ...w, -1);
      expect(plan[0]).toStartWith("SEARCH a USING COVERING INDEX memory_tags_tag (tag=?)");
      expect(plan.some((d) => d.includes("memories_birth"))).toBe(false);
    }
    // The control: this store is one the unpinned query flips on, so the
    // checks above fail with the pin removed.
    const w6 = WORDS.slice(0, 6);
    expect(planOf(s, unpinnedNeighbours(6), ...w6, ...w6, -1)[0]).toContain("memories_birth");
  });

  test("subjectsOfKind reads the partial subject-kind index; unpinned it starts from memories_birth", () => {
    const s = store();
    taggedWorld(s);
    const plan = planOf(s, subjectsOfKindSql(false), "person");
    expect(plan[0]).toStartWith("SEARCH memories USING INDEX memories_subject_kind (subject_kind=?)");
    expect(plan.some((d) => d.includes("memories_birth"))).toBe(false);
    expect(planOf(s, unpinnedSubjects(), "person")[0]).toContain("memories_birth");
  });
});

describe("the same answers", () => {
  test("tagNeighbours: the same rows in the same order as the unpinned query, live rows only", () => {
    const s = store();
    taggedWorld(s);
    for (const n of [1, 3, 4, 6, 8]) {
      const w = WORDS.slice(0, n);
      for (const limit of [-1, 5]) {
        const old = opsOf(s).all<{ tag: string; together: number }>(unpinnedNeighbours(n), ...w, ...w, limit);
        expect(old.length).toBeGreaterThan(0);
        expect(s.tagNeighbours(w, limit === -1 ? {} : { limit })).toEqual(old);
      }
    }
  });

  test("subjectsOfKind: the same ids as the unpinned query; archived still asked for in full", () => {
    const s = store();
    taggedWorld(s);
    const old = opsOf(s)
      .all<{ id: string }>(unpinnedSubjects(), "person")
      .map((r) => r.id);
    expect(old.length).toBe(3);
    expect(s.subjectsOfKind("person")).toEqual(old);
    const [first] = old;
    s.archive(first ?? "", "test");
    expect(s.subjectsOfKind("person")).toEqual(old.slice(1));
    expect(s.subjectsOfKind("person", { archived: true })).toEqual(old);
  });

  test("memoriesTagged's limit: the first ids in id order; none given reads all", () => {
    const s = store();
    taggedWorld(s);
    const all = s.memoriesTagged("w3");
    expect(all.length).toBeGreaterThan(10);
    expect(s.memoriesTagged("w3", { limit: 4 })).toEqual(all.slice(0, 4));
    expect(s.memoriesTagged("w3", { limit: Number.POSITIVE_INFINITY })).toEqual(all);
    expect(s.memoriesTagged("w3", { limit: 0 })).toEqual([]);
  });

  test("tagPartners with the capped reads = with the whole reads: under the cap, one word over it, and a cluster over it only together", () => {
    const s = store();
    const put = (body: string, tags: string[]): string => {
      const id = s.put({ type: "memory", kind: "fact", body });
      s.tagMemory(id, tags, "write");
      return id;
    };
    const sources: string[] = [];
    for (let i = 0; i < 6; i++) sources.push(put(`source ${String(i)}`, ["baking", "bread", "starter", "levain", "crumb"].slice(0, 2 + (i % 4))));
    // "rye" keeps company with the baking words: a concept edge.
    for (let i = 0; i < 4; i++) put(`rye ${String(i)}`, ["rye", "bread", "baking"]);
    for (let i = 0; i < 3; i++) put(`rye alone ${String(i)}`, ["rye"]);
    // "flour" on 30 memories and its alias "meal" on 30 more: each under a cap of 40, the cluster over it.
    for (let i = 0; i < 30; i++) put(`flour ${String(i)}`, ["flour", i < 3 ? "baking" : "pantry"]);
    for (let i = 0; i < 30; i++) put(`meal ${String(i)}`, ["meal"]);
    s.recordTagMerge("meal", "flour", "owner");
    sources.push(put("flour source", ["flour", "bread"]));
    // "oven" on 60 memories: over the cap on its own.
    for (let i = 0; i < 60; i++) put(`oven ${String(i)}`, ["oven"]);
    sources.push(put("oven source", ["oven", "starter"]));
    // The whole reads, as before: memoriesTagged with any limit dropped.
    const whole = Object.create(s) as Store;
    whole.memoriesTagged = (tag, opts) => s.memoriesTagged(tag, opts?.archived === undefined ? {} : { archived: opts.archived });
    let capped = 0;
    const counting = Object.create(s) as Store;
    counting.memoriesTagged = (tag, opts) => {
      const got = s.memoriesTagged(tag, opts);
      capped = Math.max(capped, got.length);
      return got;
    };
    for (const opts of [
      { maxTagMemories: 40, neighbours: 2 },
      { maxTagMemories: 40, neighbours: 0 },
      { maxTagMemories: 5, neighbours: 2 },
      { maxTagMemories: 100, neighbours: 3 },
    ]) {
      const before = tagPartners(whole, sources, opts);
      expect(tagPartners(counting, sources, opts)).toEqual(before);
      expect(capped).toBeLessThanOrEqual(opts.maxTagMemories + 1);
      capped = 0;
    }
    expect(tagPartners(s, sources, { maxTagMemories: 40, neighbours: 2 }).size).toBeGreaterThan(0);
  });
});

// ── through the door ─────────────────────────────────────────────────────────

function brain(sub: string, opts: { embed?: (text: string) => number[] } = {}): Counterpart {
  const c = Counterpart.open({ dir: join(root, sub), now: () => clock, timeZone: "UTC", ...(opts.embed === undefined ? {} : { embed: opts.embed }) });
  findable(c.store);
  open.push(c);
  return c;
}

function onDay(c: Counterpart, date: string): number {
  clock = Date.parse(`${date}T12:00:00Z`);
  c.store.advanceClock(date);
  return c.store.livedDay();
}

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Wrote a short letter to an old teacher.",
];

/** A card with a belief backed by the owner's words on four days (as `beliefs-shown.test.ts`'s Wren). */
function backedBelief(c: Counterpart, idx: Schemas, card: string, statement: string, said: string, from: number): string {
  const made = idx.addBelief({ entityId: card, statement, day: c.store.livedDay(), birthRoute: "reflection" });
  if (!made.ok) throw new Error(made.reason);
  for (let i = 0; i < 4; i++) {
    const d = c.store.livedDay();
    const m = c.store.put({
      type: "memory",
      kind: "fact",
      body: `${said} (${String(from + i)})`,
      saidBy: "owner",
      salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 },
      physics: { birthDay: d, lastUsedDay: d },
      origin: { session: `s-life-${String(from + i)}`, scope: `/life/${String(from + i)}` },
    });
    const filed = idx.fileSupport({ beliefId: made.id as string, memoryId: m, stance: "support", day: d });
    if (!filed.ok) throw new Error(filed.reason);
  }
  return made.id as string;
}

describe("through recallForTurn", () => {
  test("beliefs: one catch-up a call, the same offers as each subject's beliefStanding, and a belief another index filed is still offered", () => {
    const c = brain("store");
    const d0 = onDay(c, "2026-10-01");
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body, physics: { birthDay: d0, lastUsedDay: d0 } });
    const card = (name: string): string => {
      const m = c.schemas.mention({ name, kind: "person", source: name, chunkRef: `t-${name}`, day: d0 });
      if (!m.ok || m.id === undefined || m.id === null) throw new Error(`${name}: ${JSON.stringify(m)}`);
      return m.id;
    };
    const wren = card("Wren");
    const ada = card("Ada");
    const ines = card("Ines");
    const wrenBelief = backedBelief(c, c.schemas, wren, "Wren likes early ferries.", "Wren took the early ferry and loved it", 0);
    // Another process's index (opened now, as a worker would be): the belief
    // it files is a row `c.schemas` has never seen, so only a catch-up finds it.
    const other = Schemas.open({ store: c.store });
    const adaBelief = backedBelief(c, other, ada, "Ada prefers the late ferry.", "Ada caught the late ferry home again", 10);
    onDay(c, "2026-10-06");
    const day = c.store.livedDay();
    const text = "Are Wren, Ada and Ines all taking the ferry over on Saturday?";

    let schemaLists = 0;
    const list = c.store.list.bind(c.store);
    c.store.list = (filter = {}) => {
      if (filter.type === "schema") schemaLists += 1;
      return list(filter);
    };
    const got = c.schemas.beliefsNamedIn(text, day);
    expect(schemaLists).toBe(1);
    c.store.list = list;

    // Before: each subject caught up and read on its own (`beliefStanding`, which still does).
    const before = [wren, ada, ines].sort().flatMap((id) => {
      const name = c.schemas.entity(id)?.name ?? "";
      return c.schemas.beliefStanding(id, day).map((b) => ({ id: b.id, subject: name, statement: b.statement, strength: b.strength, support: b.support, contested: b.contested }));
    });
    expect(got).toEqual(before);
    expect(got.map((b) => b.id).sort()).toEqual([adaBelief, wrenBelief].sort());

    // The whole turn, through the hook's door: one scan of the schema rows
    // (the beliefs slot's catch-up), however many subjects the prompt names.
    schemaLists = 0;
    c.store.list = (filter = {}) => {
      if (filter.type === "schema") schemaLists += 1;
      return list(filter);
    };
    const out = c.recallForTurn({ sessionId: "s-beliefs", text });
    c.store.list = list;
    expect(schemaLists).toBe(1);
    expect(out.decision.beliefs?.offered).toBe(2);
    expect([...(out.decision.beliefs?.shown ?? [])].sort()).toEqual([adaBelief, wrenBelief].sort());
  });

  test("priming: a source with 4+ tag words primes the same candidates with the pins as with the unpinned, unlimited reads", () => {
    /** One store built the same way; `old` swaps in master's queries. */
    const run = (sub: string, old: boolean): { decision: RecallDecision; body: (id: string) => string; widest: number } => {
      clock = Date.UTC(2026, 9, 1, 12);
      const c = brain(sub, { embed: topicVector });
      onDay(c, "2026-10-01");
      let widest = 0;
      const neighbours = c.store.tagNeighbours.bind(c.store);
      c.store.tagNeighbours = (tags, opts) => {
        widest = Math.max(widest, tags.length);
        if (!old) return neighbours(tags, opts);
        const want = [...new Set(tags)];
        return opsOf(c.store).all<{ tag: string; together: number }>(unpinnedNeighbours(want.length), ...want, ...want, opts?.limit ?? -1);
      };
      if (old) {
        const tagged = c.store.memoriesTagged.bind(c.store);
        c.store.memoriesTagged = (tag, opts) => tagged(tag, opts?.archived === undefined ? {} : { archived: opts.archived });
      }
      for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
      const a = c.store.put({ type: "memory", kind: "fact", body: "The sourdough starter lives in the cold pantry and gets fed with rye." });
      const b = c.store.put({ type: "memory", kind: "fact", body: "Mrs Okafor lent me her wicker proving basket and its drying rack." });
      const n = c.store.put({ type: "memory", kind: "fact", body: "A crusty loaf recipe card pinned beside the bicycle rack." });
      c.store.put({ type: "memory", kind: "fact", body: "The basket of tomato seedlings went out to the garden planter." });
      c.store.put({ type: "memory", kind: "fact", body: "The bicycle chain was oiled and the basket bolted to the rack." });
      for (let i = 0; i < 3; i++) {
        const r = c.store.put({ type: "memory", kind: "fact", body: `Rye loaves for the market, batch ${String(i)}.` });
        c.store.tagMemory(r, ["rye", "bread", "levain"], "writer");
      }
      c.store.tagMemory(a, ["baking", "bread", "starter", "levain", "pantry"], "writer");
      c.store.tagMemory(b, ["baking"], "writer");
      c.store.tagMemory(n, ["rye"], "writer");
      c.store.recordTagMerge("loaf", "bread", "owner");
      (c.recall.tunables as unknown as Record<string, unknown>)["TAGS_PRIME_WEIGHT"] = 1;
      const first = c.recallForTurn({ sessionId: "s-prime", text: "how often should the sourdough starter be fed?" });
      expect([...first.decision.surfaced, ...first.decision.footnotes]).toContain(a);
      c.rateShown("s-prime", [{ id: a, score: 3 }]);
      const primed = c.recallForTurn({ sessionId: "s-prime", text: "is the basket still bolted to the bicycle rack" }).decision;
      const body = (id: string): string => c.store.row(id)?.body ?? id;
      return { decision: primed, body, widest };
    };
    const now = run("store-now", false);
    const was = run("store-was", true);
    // The source's neighbour list was long enough to flip the unpinned plan.
    expect(now.widest).toBeGreaterThanOrEqual(4);
    expect(was.widest).toBe(now.widest);
    const view = (r: { decision: RecallDecision; body: (id: string) => string }): unknown => ({
      surfaced: r.decision.surfaced.map(r.body),
      footnotes: r.decision.footnotes.map(r.body),
      primed: r.decision.verdicts
        .filter((v) => v.primed !== undefined)
        .map((v) => ({ id: r.body(v.id), ...v.primed, top: v.primed?.top === undefined ? undefined : r.body(v.primed.top) }))
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
      counts: r.decision.primed === undefined ? undefined : { ...r.decision.primed },
    });
    expect(view(now)).toEqual(view(was));
    expect(now.decision.primed?.byTag ?? 0).toBeGreaterThanOrEqual(1);
    expect(RECALL.TAGS_PRIME).toBe(true);
  });
});

/** A deterministic embedder over a few topics (as `beliefs-shown.test.ts`'s). */
const TOPICS: readonly (readonly string[])[] = [
  ["sourdough", "starter", "levain", "dough", "bread", "loaf", "bake", "baking", "oven", "flour", "crumb", "proof", "proving"],
  ["tomato", "seedling", "seedlings", "garden", "compost", "planter", "soil", "harvest", "basil"],
  ["bicycle", "bike", "chain", "derailleur", "gear", "saddle", "tyre", "ride"],
];
function topicVector(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const v = TOPICS.map((t) => words.filter((w) => t.includes(w)).length);
  const noise = new Array<number>(12).fill(0);
  for (const w of words) {
    if (TOPICS.some((t) => t.includes(w))) continue;
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    noise[h % 12] = (noise[h % 12] ?? 0) + 0.25;
  }
  return [...v, ...noise, 0.01];
}
