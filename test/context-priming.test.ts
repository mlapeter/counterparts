/**
 * CONTEXT PRIMING (2026-10-19, an experiment; check ~10-22): memories
 * connected to what the session is doing get a head start — along links from
 * what it used, wrote or has open here, and along the train of thought of its
 * last few prompts — but only those this turn's own words or meaning reached,
 * never what it wrote, never past the absolute floors, and never in the turn's
 * background. Behaviours and orderings, never pinned tunable values.
 *
 * Driven through `Counterpart#recallForTurn` (what the UserPromptSubmit hook
 * calls) and, for the wake's open threads, the Claude Code adapter.
 *
 * Hermetic: every store is a fresh temp dir, removed after; an unnamed store
 * refuses (`COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { LiveEmbedder } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { RECALL_DECISION_EVENT } from "../src/core/counterpart-events.js";
import { PRIME_KIND, TRAIN_REF, clearIdleCarries, loadGateState, loadTrain, noteWakeOpen, wakeOpenIds } from "../src/core/recall/index.js";
import type { CandidateVerdict, RecallDecision } from "../src/core/recall/index.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const EXPLICIT = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
let dir: string;
let priorEnv: string | undefined;
let priorExplicit: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorExplicit = process.env[EXPLICIT];
  dir = mkdtempSync(join(tmpdir(), "counterparts-priming-"));
  process.env[ENV] = dir;
  process.env[EXPLICIT] = "1";
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
  if (priorExplicit === undefined) delete process.env[EXPLICIT];
  else process.env[EXPLICIT] = priorExplicit;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A deterministic embedder over a few TOPICS, so a test can say which memory
 * the train of thought is near. Each topic is one axis; a text gets a unit of
 * every topic it names a word of, plus a small shared floor so nothing is a
 * zero vector.
 */
const TOPICS: readonly (readonly string[])[] = [
  ["sourdough", "starter", "levain", "dough", "bread", "loaf", "bake", "baking", "oven", "flour", "crumb", "proof"],
  ["tomato", "seedling", "garden", "compost", "planter", "soil", "harvest", "basil"],
  ["bicycle", "bike", "chain", "derailleur", "gear", "saddle", "tyre", "ride"],
  ["invoice", "tax", "receipt", "ledger", "accountant", "budget"],
];
const NOISE_DIMS = 12;
function topicVector(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const v = TOPICS.map((t) => words.filter((w) => t.includes(w)).length);
  // Every other word lands faintly on one of a few axes by its letters, so
  // unrelated texts are not all one direction.
  const noise = new Array<number>(NOISE_DIMS).fill(0);
  for (const w of words) {
    if (TOPICS.some((t) => t.includes(w))) continue;
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    noise[h % NOISE_DIMS] = (noise[h % NOISE_DIMS] ?? 0) + 0.25;
  }
  return [...v, ...noise, 0.01];
}

function brain(sub = "store", embed = true): Counterpart {
  const c = Counterpart.open({ dir: join(dir, sub), owner: true, ...(embed ? { embed: topicVector } : {}) });
  findable(c.store);
  open.push(c);
  return c;
}

/** Ordinary background, so rarity and the relative bar can discriminate. */
const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Fixed the wobbling chair leg with a shim.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "The neighbour's cat sits on the fence every evening.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
  "The heating engineer comes on Thursday morning.",
  "The parcel was left with the neighbour across the road.",
  "Renewed the passport two months before the trip.",
];

function fact(c: Counterpart, body: string, title?: string): string {
  return c.store.put({ type: "memory", kind: "fact", body, ...(title === undefined ? {} : { title }) });
}

function seed(c: Counterpart): void {
  for (const body of FILLER) fact(c, body);
}

function verdict(d: RecallDecision, id: string): CandidateVerdict | undefined {
  return d.verdicts.find((v) => v.id === id);
}

function shown(d: RecallDecision): string[] {
  return [...d.surfaced, ...d.footnotes];
}

function turn(c: Counterpart, session: string, text: string): RecallDecision {
  return c.recallForTurn({ sessionId: session, text }).decision;
}


function link(c: Counterpart, a: string, b: string, weight: number): void {
  const day = c.store.livedDay();
  c.store.linkMany([
    { src: a, dst: b, weight, day },
    { src: b, dst: a, weight, day },
  ]);
}

/** `DEBUG_PRIME=1` prints a turn's cued verdicts — for re-tuning the fixture, never asserted on. */
function dbg(label: string, d: RecallDecision, names: Record<string, string>): void {
  if (process.env["DEBUG_PRIME"] !== "1") return;
  const name = (id: string): string => names[id] ?? id.slice(4, 8);
  console.log(
    label,
    JSON.stringify(
      d.verdicts
        .filter((v) => v.cue + v.semantic > 0 && v.verdict !== "below-floor")
        .map((v) => [name(v.id), v.verdict, +v.activation.toFixed(2), +v.bar.toFixed(2), v.primed === undefined ? null : [+v.primed.link.toFixed(2), +v.primed.train.toFixed(2), v.primed.lifted === true]]),
    ),
    JSON.stringify(d.primed),
  );
}

const STARTER = "The sourdough starter lives in the cold pantry and gets fed with rye.";
const BASKET = "Mrs Okafor lent me her wicker proving basket and its drying rack.";
const TOMATO_BASKET = "The basket of tomato seedlings went out to the garden planter.";
const BIKE_BASKET = "The bicycle chain was oiled and the basket bolted to the rack.";
const ASK_STARTER = "how often should the sourdough starter be fed?";
/** Reaches the borrowed basket only weakly: the bicycle memory is the turn's subject. */
const ASK_BASKET = "is the basket still bolted to the bicycle rack";

/** The fixture of the link scenarios: A, and B the basket question reaches weakly. */
function basketStore(c: Counterpart): { a: string; b: string; names: Record<string, string> } {
  seed(c);
  const a = fact(c, STARTER);
  const b = fact(c, BASKET);
  const g1 = fact(c, TOMATO_BASKET);
  const g2 = fact(c, BIKE_BASKET);
  return { a, b, names: { [a]: "A", [b]: "B", [g1]: "G1", [g2]: "G2" } };
}

/**
 * A session USES A: its first turn shows A and A is rated 3 at the boundary
 * (A was born today, so physics credits no use; the session's own rating
 * still makes it a source). Then A and B are linked at two co-uses' worth
 * (associate `CO_USE_DEPOSIT` 0.25 each, #525) — laid after that first turn,
 * so the hop channel's quiet pointer does not show B beside A there.
 */
function useA(c: Counterpart, session: string, a: string, partners: readonly string[]): RecallDecision {
  const first = turn(c, session, ASK_STARTER);
  expect(shown(first)).toContain(a);
  c.rateShown(session, [{ id: a, score: 3 }]);
  for (const p of partners) link(c, a, p, 0.5);
  return first;
}

describe("context priming: what it lifts", () => {
  test("a session that used A, then asks something reaching A's linked partner B only weakly: B shows, primed by link", () => {
    const c = brain();
    const { a, b, names } = basketStore(c);
    useA(c, "s-used", a, [b]);

    const primed = turn(c, "s-used", ASK_BASKET);
    dbg("used", primed, names);
    expect(shown(primed)).toContain(b);
    const vb = verdict(primed, b);
    expect(vb?.primed?.link ?? 0).toBeGreaterThan(0);
    expect(vb?.primed?.from).toContain("used");
    expect(vb?.primed?.lifted).toBe(true);
    expect(primed.primed?.sources.used).toBe(1);
    expect(primed.primed?.byLink).toBeGreaterThanOrEqual(1);
    expect(primed.primed?.lifted).toBeGreaterThanOrEqual(1);
    // Kept out of the background: the bar B faced is the one the words found.
    expect(vb?.activation ?? 0).toBeGreaterThanOrEqual(vb?.bar ?? Infinity);
    expect((vb?.activation ?? 0) - (vb?.primed?.link ?? 0) - (vb?.primed?.train ?? 0)).toBeLessThan(vb?.bar ?? 0);

    // The same question in a session that used nothing: B stays below its bar.
    turn(c, "s-plain", "what goes on the shopping list this week?");
    const plain = turn(c, "s-plain", ASK_BASKET);
    dbg("plain", plain, names);
    expect(shown(plain)).not.toContain(b);
    expect(verdict(plain, b)?.verdict).toBe("below-bar");
    expect(verdict(plain, b)?.primed?.link ?? 0).toBe(0);

    // The durable row says which shown memory was primed, and how.
    const rows = c.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-used", order: "desc", limit: 1 });
    const row = JSON.parse(rows[0]?.payload ?? "{}") as {
      footnotes?: { id: string; primed?: { link: number; from: string[]; lifted?: true } }[];
      primed?: { shown: number; lifted: number; byLink: number };
    };
    const rb = row.footnotes?.find((f) => f.id === b);
    expect(rb?.primed?.link ?? 0).toBeGreaterThan(0);
    expect(rb?.primed?.from).toContain("used");
    expect(rb?.primed?.lifted).toBe(true);
    expect(row.primed?.lifted ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("priming never mints a candidate: a linked partner the turn did not reach is not primed; only what words or meaning reached is", () => {
    const c = brain();
    const { a, b, names } = basketStore(c);
    // Nothing in it the question's words or meaning reach.
    const far = fact(c, "Tax due by May.");
    useA(c, "s-used", a, [b, far]);
    const d = turn(c, "s-used", ASK_BASKET);
    dbg("mint", d, names);
    const v = verdict(d, far);
    expect(v === undefined || (v.cue + v.semantic === 0 && v.primed === undefined)).toBe(true);
    for (const x of d.verdicts) if (x.primed !== undefined) expect(x.cue + x.semantic).toBeGreaterThan(0);
  });
});

describe("context priming: the train of thought", () => {
  // Two probes the same question reaches equally weakly: one in the bread
  // topic (`flour`), one in the garden's (`basil`).
  const FLOUR = "Bought a sack of strong white flour from the mill.";
  const BASIL = "The basil on the windowsill needs repotting soon.";
  const PROBE = "remind me about the flour and the basil";
  const BREAD = ["the sourdough starter smells sour today", "the loaf needs a longer proof in the oven"];
  const GARDEN = ["the tomato seedlings in the garden look leggy", "more compost for the planter soil", "a good harvest from the garden this year"];

  /** The probe question, after `before` in the same session. */
  function probe(c: Counterpart, session: string, before: readonly string[]): RecallDecision {
    for (const t of before) turn(c, session, t);
    return turn(c, session, PROBE);
  }

  test("a session drifting topic: the train follows, and the old topic fades by turn", () => {
    const c = brain();
    seed(c);
    const flour = fact(c, FLOUR);
    const basil = fact(c, BASIL);
    for (const body of [...BREAD, ...GARDEN]) fact(c, `Noted: ${body}.`);
    const names = { [flour]: "FLOUR", [basil]: "BASIL" };
    const trainOf = (d: RecallDecision): { flour: number; basil: number } => ({
      flour: verdict(d, flour)?.primed?.train ?? 0,
      basil: verdict(d, basil)?.primed?.train ?? 0,
    });

    // Bread talk, then the probe: the bread probe is the primed one.
    const onBread = probe(c, "s-bread", BREAD);
    dbg("bread", onBread, names);
    expect(trainOf(onBread).flour).toBeGreaterThan(trainOf(onBread).basil);

    // The same bread talk, then three turns in the garden, then the probe: the train followed.
    const drifted = probe(c, "s-drift", [...BREAD, ...GARDEN]);
    dbg("drift", drifted, names);
    expect(trainOf(drifted).basil).toBeGreaterThan(trainOf(drifted).flour);

    // And by turn: the bread topic's share of the train falls each garden turn.
    const s = "s-turns";
    for (const t of BREAD) turn(c, s, t);
    const share: number[] = [];
    const bread = [1, 0, 0, 0];
    for (const t of GARDEN) {
      turn(c, s, t);
      const tr = loadTrain(c.store, s);
      const v = tr?.vec ?? [];
      const head = v.slice(0, 4);
      const norm = Math.sqrt(v.reduce((x, y) => x + y * y, 0));
      share.push(norm > 0 ? head.reduce((x, y, i) => x + y * (bread[i] ?? 0), 0) / norm : 0);
    }
    for (let i = 1; i < share.length; i++) expect(share[i] ?? 0).toBeLessThan(share[i - 1] ?? 0);
  });
});

describe("context priming: what the session wrote", () => {
  test("a session that wrote W: W stays hidden (echo), but W's older neighbour is primed", () => {
    const c = brain();
    seed(c);
    const older = fact(c, "The old oven runs hot on the left, so the loaf gets turned halfway.");
    const w = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The rye levain doubled overnight once it moved beside the warm oven.",
      origin: { session: "s-wrote" },
    });
    // A faint link, of the order a dream proposes (write-time links are off since #528), so both channels are seen.
    link(c, w, older, 0.06);
    const names = { [older]: "OLDER", [w]: "W" };
    const ask = "how is the levain doing beside the oven?";

    const own = turn(c, "s-wrote", ask);
    dbg("wrote", own, names);
    expect(shown(own)).not.toContain(w);
    expect(verdict(own, w)?.verdict).toBe("echo-skipped");
    // W is never a primed target.
    expect(verdict(own, w)?.primed).toBeUndefined();
    const vo = verdict(own, older);
    expect((vo?.primed?.train ?? 0) + (vo?.primed?.link ?? 0)).toBeGreaterThan(0);
    expect(vo?.primed?.from).toContain("wrote");
    expect(own.primed?.sources.wrote).toBe(1);

    // Another session's first prompt, nothing to prime from: the neighbour is not primed.
    const other = turn(c, "s-other", ask);
    dbg("other", other, names);
    expect(verdict(other, older)?.primed).toBeUndefined();
    expect(verdict(other, w)?.verdict).not.toBe("echo-skipped");
  });
});

describe("context priming: holding a cluster in check", () => {
  test("the head start from a use decays by turn, and session dedup still holds a primed memory to one showing", () => {
    const c = brain();
    const { a, b, names } = basketStore(c);
    useA(c, "s", a, [b]);
    const links: number[] = [];
    let showings = 0;
    for (let i = 0; i < 5; i++) {
      const d = turn(c, "s", ASK_BASKET);
      dbg(`turn${i + 2}`, d, names);
      links.push(verdict(d, b)?.primed?.link ?? 0);
      if (shown(d).includes(b)) showings += 1;
    }
    expect(showings).toBe(1);
    for (let i = 1; i < links.length; i++) expect(links[i] ?? 0).toBeLessThan(links[i - 1] ?? 0);
    expect(links[0] ?? 0).toBeGreaterThan(0);
  });

  test("a habituated memory's raised bar holds after priming", () => {
    const c = brain();
    const { a, b, names } = basketStore(c);
    // Rated 0 in two sessions (`HABITUATION_MIN_SESSIONS`), where the turn reached it strongly.
    for (const s of ["r1", "r2"]) {
      const d = turn(c, s, "the wicker proving basket and drying rack Mrs Okafor lent me");
      expect(shown(d)).toContain(b);
      c.rateShown(s, [{ id: b, score: 0 }]);
    }
    useA(c, "s", a, [b]);
    const d = turn(c, "s", ASK_BASKET);
    dbg("habituated", d, names);
    const vb = verdict(d, b);
    expect(vb?.habituated).toBe(true);
    expect(vb?.primed?.link ?? 0).toBeGreaterThan(0);
    expect(shown(d)).not.toContain(b);
    expect(vb?.verdict).toBe("below-bar");
  });
});

describe("context priming: nothing to prime from", () => {
  test("a session's first prompt with nothing open here: the same injection and verdicts as with priming off", () => {
    const on = brain("same");
    const { names } = basketStore(on);
    const off = Counterpart.open({ dir: join(dir, "same"), owner: true, embed: topicVector, recallTunables: { PRIME_LINK_UNITS: 0, PRIME_TRAIN_SHARE: 0 } });
    open.push(off);
    for (const [i, text] of [ASK_BASKET, ASK_STARTER, "what goes on the shopping list this week?"].entries()) {
      const a = on.recallForTurn({ sessionId: `on-${i}`, text });
      const b = off.recallForTurn({ sessionId: `off-${i}`, text });
      dbg("on", a.decision, names);
      expect(a.injection).toBe(b.injection);
      expect(a.decision.surfaced).toEqual(b.decision.surfaced);
      expect(a.decision.footnotes).toEqual(b.decision.footnotes);
      const strip = (d: RecallDecision): unknown[] => d.verdicts.map((v) => [v.id, v.verdict, v.activation, v.bar]);
      expect(strip(a.decision)).toEqual(strip(b.decision));
      expect(a.decision.verdicts.some((v) => v.primed !== undefined)).toBe(false);
      // Priming ran and found nothing: said on the row, apart from "off".
      expect(a.decision.primed?.sources).toEqual({ used: 0, wrote: 0, open: 0 });
      expect(a.decision.primed?.train).toBe(false);
      expect(b.decision.primed).toBeNull();
    }
  });

  test("the deliberate path never primes", () => {
    const c = brain();
    const { a, b } = basketStore(c);
    useA(c, "s", a, [b]);
    const d = c.recall.recall({ sessionId: "s", text: ASK_BASKET }).decision;
    expect(d.primed).toBeNull();
    expect(d.verdicts.some((v) => v.primed !== undefined)).toBe(false);
  });
});

describe("context priming: what is open here, and its state", () => {
  test("the wake's open threads are read once, at the session's first prompt, and prime their partners", () => {
    const c = brain();
    const { b, names } = basketStore(c);
    const thread = fact(c, "Still need to return the borrowed things to the neighbours.");
    link(c, thread, b, 0.5);
    noteWakeOpen(c.store, "s-wake", [thread], c.store.livedDay());
    expect(wakeOpenIds(c.store, "s-wake")).toEqual([thread]);
    const d = turn(c, "s-wake", ASK_BASKET);
    dbg("wake", d, names);
    expect(d.primed?.sources.open).toBe(1);
    expect(verdict(d, b)?.primed?.from).toContain("open");
    expect(loadTrain(c.store, "s-wake")?.open).toBe(true);
    // The gate state reads as it did: priming's rows are not the gate's.
    expect(loadGateState(c.store, "s-wake").status).toBe("loaded");
  });

  test("a train written before the session's first scalar row does not make the gate state unreadable", () => {
    const c = brain();
    noteWakeOpen(c.store, "s-early", ["mem_nothing"], c.store.livedDay());
    expect(loadGateState(c.store, "s-early").status).toBe("absent");
    expect(c.store.gateRecords("s-early", PRIME_KIND).length).toBe(1);
  });

  test("the train is kept per session in gate state, and an idle session's train is emptied with its carried cues", () => {
    const c = brain();
    seed(c);
    turn(c, "s-idle", "the sourdough starter and the loaf");
    const row = c.store.gateRecords("s-idle", PRIME_KIND).find((r) => r.ref === TRAIN_REF);
    expect(row).toBeDefined();
    expect((loadTrain(c.store, "s-idle")?.vec ?? []).length).toBeGreaterThan(0);
    // Past the retention ceiling, by the row's own clock.
    expect(clearIdleCarries(c.store, -1)).toBeGreaterThanOrEqual(1);
    expect(loadTrain(c.store, "s-idle")?.vec ?? null).toBeNull();
  });
});

describe("context priming: the folder, wired through the Claude Code hooks", () => {
  test("the wake's open threads are recorded at session start and this directory's handoff joins the train: the first prompt counts them", async () => {
    const SCOPE = "/work/bakery";
    const ZONE = "America/Denver";
    const data = join(dir, "hooks");
    const embedder: LiveEmbedder = {
      model: "test-topics-1",
      embed: (t: string) => topicVector(t),
      vector: async (t: string) => topicVector(t),
      warm: async (texts: readonly string[]) => texts.length,
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
    };
    const a = openAdapter(
      { dataDir: data, injectionBudgetBytes: 9_000, owner: true, timeZone: ZONE },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder },
    );
    open.push(a.counterpart);
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const server = new McpServer({ counterpart: a.counterpart, session: "s-prev", scope: SCOPE, owner: true, registryDir: data });
    const asked = await server.call("remember", { session: "s-prev", text: "Is the proving basket still at Mrs Okafor's, or did it come back?", unresolved: true });
    expect(asked.isError).not.toBe(true);
    const thread = (asked.structuredContent as Record<string, unknown>)["id"] as string;
    a.counterpart.writeHandoff("Left off planning the rye bake: the levain needs a warmer spot by the oven.", { scope: SCOPE, session: "s-prev" });
    await a.counterpart.sessionEnd({ date: "2026-10-19", budgetBytes: 9_000 });

    const hook = (raw: Record<string, unknown>) =>
      toHookInput(raw, { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: data });
    a.sessionStart(hook({ session_id: "s-new", hook_event_name: "SessionStart", cwd: SCOPE, source: "startup" }));
    expect(wakeOpenIds(a.counterpart.store, "s-new")).toContain(thread);

    a.userPromptSubmit(hook({ session_id: "s-new", hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: "where is the basket for the rye loaf?" }));
    const rows = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-new", order: "desc", limit: 1 });
    const row = JSON.parse(rows[0]?.payload ?? "{}") as { primed?: { sources: { open: number }; train: boolean } | null };
    expect(row.primed?.sources.open ?? 0).toBeGreaterThanOrEqual(1);
    // Nothing used or written yet: the train is the folder's (the thread's and the handoff's meaning).
    expect(row.primed?.train).toBe(true);
    expect(loadTrain(a.counterpart.store, "s-new")?.open).toBe(true);

    // The handoff alone (a session whose wake recorded no threads): its meaning is the train.
    a.userPromptSubmit(hook({ session_id: "s-hand", hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: "where is the basket for the rye loaf?" }));
    const hand = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-hand", order: "desc", limit: 1 });
    const handRow = JSON.parse(hand[0]?.payload ?? "{}") as { primed?: { sources: { open: number }; train: boolean } | null };
    expect(handRow.primed?.sources.open).toBe(0);
    expect(handRow.primed?.train).toBe(true);
    // And in a directory with no handoff and no wake, nothing to prime from.
    const elsewhere = toHookInput(
      { session_id: "s-else", hook_event_name: "UserPromptSubmit", cwd: "/work/elsewhere", prompt: "where is the basket for the rye loaf?" },
      { scope: "/work/elsewhere", timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: data },
    );
    a.userPromptSubmit(elsewhere);
    const none = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-else", order: "desc", limit: 1 });
    expect((JSON.parse(none[0]?.payload ?? "{}") as { primed?: { train: boolean } | null }).primed?.train).toBe(false);
  });
});
