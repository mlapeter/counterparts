/**
 * BELIEFS SHOWN (wave 2 lane E, 2026-10-22; design §7): the beliefs slot in
 * ambient recall, tags as a priming partner source, and the wake's project
 * line. Each behind its own switch (`recall.BELIEFS_IN_RECALL`,
 * `recall.TAGS_PRIME`, `self.WAKE_PROJECT_LINE`), each off a clean revert.
 *
 * Through the real doors: the slot through `Counterpart#recallForTurn` (what
 * the UserPromptSubmit hook calls), its rating through the MCP `session_end`
 * tool's `rated` field, the project line through `Counterpart#wake` with a
 * delivery in a folder. The loop the brief guards: shown → rated useful is a
 * USE, once a lived day, never a support filing; a rating counts nothing for
 * a belief about me or us; being shown alone credits nothing.
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that
 * path; no model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NARRATORS } from "../src/adapters/dashboard/web/narrate.js";
import { firedReport } from "../src/adapters/fired.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { RECALL_DECISION_EVENT, RECALL_DECISION_FIELDS } from "../src/core/counterpart-events.js";
import { composeTurn } from "../src/core/retrieval.js";
import { FRAMING, TUNABLES as RECALL, beliefLine, planPrime, primeChannel, rateableSet, planRatedUse, render, strengthWord } from "../src/core/recall/index.js";
import type { BeliefOffer, PrimeInput, RecallDecision } from "../src/core/recall/index.js";
import { freshGateState } from "../src/core/recall/session.js";
import { tagPartners, topicsNamedIn } from "../src/core/schemas/tags.js";
import { SELF_TUNABLES } from "../src/core/self/index.js";
import { parseSetting } from "../tools/harness/settings.js";
import { findable } from "./store-fixture.js";

let root: string;
let clock = Date.UTC(2026, 9, 1, 12);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-beliefs-shown-")));
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

function brain(sub = "store", opts: { embed?: (text: string) => number[] } = {}): Counterpart {
  const c = Counterpart.open({ dir: join(root, sub), now: () => clock, timeZone: "UTC", ...(opts.embed === undefined ? {} : { embed: opts.embed }) });
  findable(c.store);
  open.push(c);
  return c;
}

/** Move the clock and the lived day to `date`; the new lived day. */
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
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Set up a standing desk in the spare bedroom.",
  "Wrote a short letter to an old teacher.",
  "Bought hiking boots that finally fit properly.",
  "Replaced the smoke alarm batteries in the hall.",
];

/** A lived memory the owner said, on `day`, in its own session and folder (so each counts in full). */
function lived(c: Counterpart, body: string, day: number, i: number): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    saidBy: "owner",
    salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { session: `s-life-${String(i)}`, scope: `/life/${String(i)}` },
  });
}

/**
 * A person card, Wren, with a belief born weak on Oct 1 and backed by the
 * owner's words on four later days; the clock left on Oct 6. `about` marks
 * the belief about me or us.
 */
function wrenWorld(c: Counterpart, opts: { about?: "us"; supports?: number; statement?: string; who?: string } = {}): { wren: string; belief: string } {
  const d0 = onDay(c, "2026-10-01");
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body, physics: { birthDay: d0, lastUsedDay: d0 } });
  const wren = c.schemas.mention({ name: "Wren", kind: "person", source: "Wren", chunkRef: "t", day: d0 }).id as string;
  const made = c.schemas.addBelief({
    entityId: wren,
    statement: opts.statement ?? "Wren likes early ferries.",
    day: d0,
    birthRoute: "reflection",
    ...(opts.about === undefined ? {} : { about: opts.about }),
  });
  if (!made.ok) throw new Error(made.reason);
  const belief = made.id as string;
  const n = opts.supports ?? 4;
  for (let i = 0; i < n; i++) {
    const d = onDay(c, `2026-10-0${String(2 + i)}`);
    const m = lived(c, `${opts.who ?? "Wren"} said she took the ${String(6 + i)} o'clock ferry again and loved the quiet crossing.`, d, i);
    const filed = c.schemas.fileSupport({ beliefId: belief, memoryId: m, stance: "support", day: d });
    if (!filed.ok) throw new Error(filed.reason);
  }
  onDay(c, "2026-10-06");
  return { wren, belief };
}

const ASK_WREN = "Is Wren taking the ferry over on Saturday?";

function turn(c: Counterpart, session: string, text = ASK_WREN): { injection: string; decision: RecallDecision } {
  return c.recallForTurn({ sessionId: session, text });
}

function setRecall<K extends keyof typeof RECALL>(c: Counterpart, key: K, value: (typeof RECALL)[K]): void {
  (c.recall.tunables as unknown as Record<string, unknown>)[key] = value;
}

function supportSnapshot(c: Counterpart, belief: string): string {
  return JSON.stringify({ rows: c.store.supportOf(belief), support: c.store.physicsOf(belief).support ?? 0, days: c.store.physicsOf(belief).supportDays ?? 0 });
}

// ── the slot ────────────────────────────────────────────────────────────────

describe("the beliefs slot in ambient recall (Counterpart#recallForTurn)", () => {
  test("switches: on by default and compare-settable, each one", () => {
    expect(RECALL.BELIEFS_IN_RECALL).toBe(true);
    expect(RECALL.TAGS_PRIME).toBe(true);
    expect(SELF_TUNABLES.WAKE_PROJECT_LINE).toBe(true);
    expect(parseSetting("recall.BELIEFS_IN_RECALL=false").value).toBe(false);
    expect(parseSetting("recall.TAGS_PRIME=false").value).toBe(false);
    expect(parseSetting("self.WAKE_PROJECT_LINE=false").value).toBe(false);
    expect(parseSetting("recall.TAGS_PRIME_WEIGHT=0.2").value).toBe(0.2);
    expect(RECALL_DECISION_FIELDS).toContain("beliefs");
  });

  test("a turn naming a subject shows its strongest belief in its own labelled slot, beside (never among) the footnotes", () => {
    const c = brain();
    const { wren, belief } = wrenWorld(c);
    const standing = c.schemas.beliefStanding(wren, c.store.livedDay());
    expect(standing[0]?.strength ?? 0).toBeGreaterThan(RECALL.BELIEFS_SLOT_FLOOR);
    const out = turn(c, "s-slot");
    expect(out.injection).toContain(FRAMING.beliefsHeader);
    expect(out.injection).toContain(`- Wren: Wren likes early ferries. (${strengthWord(standing[0]?.strength ?? 0)}; 4 memories) [${belief}]`);
    expect(out.decision.beliefs?.shown).toEqual([belief]);
    expect(out.decision.beliefs?.offered).toBe(1);
    expect(out.decision.beliefs?.bytes ?? 0).toBeGreaterThan(0);
    // Footnotes stay belief-free.
    expect([...out.decision.surfaced, ...out.decision.footnotes]).not.toContain(belief);
    expect(out.decision.footnotes.length + out.decision.surfaced.length).toBeGreaterThan(0);
    // The slot sits after the footnotes, and the sentinel counts it and states the true total.
    expect(out.injection.indexOf(FRAMING.beliefsHeader)).toBeGreaterThan(out.injection.indexOf(FRAMING.footnoteHeader));
    const last = out.injection.split("\n").at(-1) ?? "";
    expect(last).toContain(" beliefs=1 ");
    expect(last).toContain(`bytes=${String(new TextEncoder().encode(out.injection).length)}`);
    // The durable row says what the slot did.
    const row = JSON.parse(c.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-slot" })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(row["beliefs"]).toEqual({ offered: 1, shown: [belief], bytes: out.decision.beliefs?.bytes });
  });

  test("once a session: the next turn naming the subject does not show it again; another session does", () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    expect(turn(c, "s-once").decision.beliefs?.shown).toEqual([belief]);
    const again = turn(c, "s-once", "Did Wren say which ferry?");
    expect(again.decision.beliefs?.shown).toEqual([]);
    expect(again.injection).not.toContain(FRAMING.beliefsHeader);
    expect(turn(c, "s-other").decision.beliefs?.shown).toEqual([belief]);
  });

  test("born weak and unbacked, a belief does not show: the floor is strict", () => {
    const c = brain();
    const { belief } = wrenWorld(c, { supports: 0 });
    const out = turn(c, "s-weak");
    expect(out.decision.beliefs).toEqual({ offered: 1, shown: [], bytes: 0 });
    expect(out.injection).not.toContain(belief);
  });

  test("a turn with no memory to show still carries the slot when it names the subject", () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    // Wren is named; nothing else in the store shares a word with this turn.
    const out = turn(c, "s-bare", "Wren?");
    expect(out.decision.beliefs?.shown).toEqual([belief]);
    expect(out.injection).toContain(`[${belief}]`);
    expect(out.decision.bytes).toBe(new TextEncoder().encode(out.injection).length);
  });

  test("review of #588 (S2): a turn that hands over only beliefs RENDERED — no recall.quiet, no refusal, and the readers say what went", () => {
    const events: { name: string }[] = [];
    const c = Counterpart.open({ dir: join(root, "store"), now: () => clock, timeZone: "UTC", onEvent: (e) => events.push(e) });
    findable(c.store);
    open.push(c);
    const { belief } = wrenWorld(c, { who: "She" });
    events.splice(0);
    const out = turn(c, "s-only", "Wren?");
    expect(out.decision.surfaced).toEqual([]);
    expect(out.decision.footnotes).toEqual([]);
    expect(out.decision.beliefs?.shown).toEqual([belief]);
    expect(out.decision.reason).toBe("rendered");
    expect(events.some((e) => e.name === "recall.quiet")).toBe(false);
    expect(events.some((e) => e.name === "recall.rendered")).toBe(true);
    // fired.ts counts a recall.decision row whose reason is not `rendered` as a refusal.
    const row = JSON.parse(c.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-only" })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(row["reason"]).toBe("rendered");
    const fired = firedReport(c.store, "2026-10-06").rows.find((r) => r.id === "recall-decision");
    expect(fired?.refusedInWindow ?? 0).toBe(0);
    // The narrators key on the arrays and the bytes, and now on the slot too.
    const said = NARRATORS["recall.decision"]({ store: null as never, row: {} as never, p: row }).text;
    expect(said).not.toContain("I said nothing");
    expect(said).toContain("beliefs about");
    const adapterSaid = NARRATORS["adapter.recall"]({ store: null as never, row: {} as never, p: { reason: "rendered", surfaced: 0, footnotes: 0, beliefs: 1, bytes: out.decision.bytes } }).text;
    expect(adapterSaid).not.toContain("came to nothing");
    expect(adapterSaid).toContain("one belief");
  });

  test("a topic a turn names (a promoted tag) brings its beliefs, under the topic's word", () => {
    const c = brain();
    const d0 = onDay(c, "2026-10-01");
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
    c.store.put({
      type: "schema",
      kind: "fact",
      body: "sourdough: a topic — the memories tagged with it.",
      meta: { role: "entity", name: "", aliases: [], topic: "sourdough", topicAliases: [] },
      subjectKind: "topic",
    });
    c.close();
    open.splice(open.indexOf(c), 1);
    const c2 = brain();
    const topic = [...c2.store.topicCards().values()][0] as string;
    const b = c2.schemas.addBelief({ entityId: topic, statement: "A cold kitchen slows the starter down.", day: d0, birthRoute: "reflection" }).id as string;
    for (let i = 0; i < 3; i++) {
      const d = onDay(c2, `2026-10-0${String(2 + i)}`);
      c2.schemas.fileSupport({ beliefId: b, memoryId: lived(c2, `The sourdough rose slowly in the cold kitchen, day ${String(i)}.`, d, i), stance: "support", day: d });
    }
    onDay(c2, "2026-10-06");
    expect(topicsNamedIn("how is the Sourdough doing?", c2.store.topicCards())).toEqual([topic]);
    const out = turn(c2, "s-topic", "is the sourdough ready to bake?");
    expect(out.decision.beliefs?.shown).toEqual([b]);
    expect(out.injection).toContain(`- sourdough: A cold kitchen slows the starter down.`);
  });

  test("OFF IS IDENTICAL: the lookup is never asked, and the turn is the turn a store with no beliefs gives", () => {
    const c = brain();
    wrenWorld(c);
    let asked = 0;
    const spy = (): readonly BeliefOffer[] => {
      asked += 1;
      return [];
    };
    setRecall(c, "BELIEFS_IN_RECALL", false);
    const off = c.recallForTurn({ sessionId: "s-off", text: ASK_WREN, beliefs: spy });
    expect(asked).toBe(0);
    expect(off.decision.beliefs).toBeNull();
    const offBound = turn(c, "s-off-bound");
    expect(offBound.decision.beliefs).toBeNull();
    setRecall(c, "BELIEFS_IN_RECALL", true);
    const none = c.recallForTurn({ sessionId: "s-none", text: ASK_WREN, beliefs: spy });
    expect(asked).toBe(1);
    const shape = (r: { injection: string; decision: RecallDecision }): unknown => ({
      injection: r.injection.replace(/t=\d+/, "t=?"),
      reason: r.decision.reason,
      surfaced: r.decision.surfaced,
      footnotes: r.decision.footnotes,
      verdicts: r.decision.verdicts.map((v) => [v.id, v.verdict]),
      bytes: r.decision.bytes,
      sentinel: r.decision.sentinel,
    });
    expect(shape(off)).toEqual(shape(none));
    expect(shape(offBound)).toEqual(shape(none));
    expect(off.injection).not.toContain(FRAMING.beliefsHeader);
    expect(off.decision.sentinel).not.toContain("beliefs=");
  });

  test("under pressure the slot gives way first, weakest belief first, and never takes a footnote's room", () => {
    const lines = [0.9, 0.7, 0.5].map((s, i) => ({ id: `mem_b${String(i)}`, text: beliefLine({ id: `mem_b${String(i)}`, subject: "Wren", statement: `Claim number ${String(i)} about ferries and mornings.`, strength: s, support: 3 }, 200) }));
    const resolve = (id: string) => ({ title: `Title of ${id}`, gist: `Gist of ${id}` });
    const base = { turn: 1, affectFlag: false, surfaced: [], footnotes: ["mem_f1", "mem_f2"], gistBytes: 240, titleBytes: 150, pressureRatio: 0.9 };
    const roomy = render({ ...base, beliefs: lines, budgetBytes: 4000 }, resolve);
    expect(roomy.beliefs).toEqual(["mem_b0", "mem_b1", "mem_b2"]);
    const plain = render({ ...base, budgetBytes: 4000 }, resolve);
    const tight = render({ ...base, beliefs: lines, budgetBytes: plain.bytes + 10 }, resolve);
    expect(tight.footnotes).toEqual(["mem_f1", "mem_f2"]);
    expect(tight.beliefs).toEqual([]);
    expect(tight.trimmed.map((t) => t.id)).toEqual(["mem_b2", "mem_b1", "mem_b0"]);
    expect(tight.text).toBe(plain.text);
  });
});

// ── the rating loop ─────────────────────────────────────────────────────────

describe("the loop, guarded: a rating of the slot is a use, never support (MCP session_end `rated`)", () => {
  function server(c: Counterpart, session: string): McpServer {
    return new McpServer({ counterpart: c, session, scope: "/scope/beliefs", registryDir: join(root, "registry"), now: () => clock });
  }

  async function rate(c: Counterpart, session: string, rated: { id: string; score: number }[]): Promise<Record<string, unknown>> {
    const s = server(c, session);
    const out = (await s.call("session_end", { session, memories: [], rated })).structuredContent;
    return out["rated"] as Record<string, unknown>;
  }

  test("shown → rated useful credits ONE use a lived day, files no support, and the row files it under `beliefs`", async () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    const support = supportSnapshot(c, belief);
    const uses0 = c.store.row(belief)?.uses ?? 0;
    expect(turn(c, "s-loop").decision.beliefs?.shown).toEqual([belief]);
    const out = await rate(c, "s-loop", [{ id: belief, score: 2 }]);
    expect(out["rated"]).toBe(1);
    const uses1 = c.store.row(belief)?.uses ?? 0;
    expect(uses1).toBeGreaterThan(uses0);
    expect(c.store.row(belief)?.last_used_day).toBe(c.store.livedDay());
    expect(supportSnapshot(c, belief)).toBe(support);
    const row = JSON.parse(c.store.eventLog({ name: "recall.rated", ref: "s-loop" })[0]?.payload ?? "{}") as { ratings: { id: string; score: number; lane: string; drewOn: boolean }[]; coUse: { ids: string[] } };
    expect(row.ratings).toEqual([{ id: belief, score: 2, lane: "beliefs", drewOn: false }]);
    expect(row.coUse.ids).not.toContain(belief);
    // Again the same lived day — the same session, or another that was shown it: nothing more.
    await rate(c, "s-loop", [{ id: belief, score: 2 }]);
    expect(turn(c, "s-loop-2").decision.beliefs?.shown).toEqual([belief]);
    await rate(c, "s-loop-2", [{ id: belief, score: 2 }]);
    expect(c.store.row(belief)?.uses ?? 0).toBe(uses1);
    // The next lived day, shown and rated again: one more use, and still no support.
    onDay(c, "2026-10-07");
    expect(turn(c, "s-loop-3").decision.beliefs?.shown).toEqual([belief]);
    await rate(c, "s-loop-3", [{ id: belief, score: 2 }]);
    expect(c.store.row(belief)?.uses ?? 0).toBeGreaterThan(uses1);
    expect(supportSnapshot(c, belief)).toBe(support);
  });

  test("a rating never counts for a belief about me or us: shown, rated 3, and nothing moves", async () => {
    const c = brain();
    const { belief } = wrenWorld(c, { about: "us", statement: "Wren and I plan best on the early ferry." });
    expect(c.schemas.aboutMeBelief(belief)).toBe(true);
    const before = JSON.stringify(c.store.row(belief));
    const support = supportSnapshot(c, belief);
    expect(turn(c, "s-us").decision.beliefs?.shown).toEqual([belief]);
    await rate(c, "s-us", [{ id: belief, score: 3 }]);
    const row = JSON.parse(c.store.eventLog({ name: "recall.rated", ref: "s-us" })[0]?.payload ?? "{}") as { notCredited: Record<string, number> };
    expect(row.notCredited["belief-about-me"]).toBe(1);
    expect(JSON.stringify(c.store.row(belief))).toBe(before);
    expect(supportSnapshot(c, belief)).toBe(support);
    // And the store's own door refuses it too, whoever asks.
    expect(c.store.reinforce(belief, c.store.livedDay(), "useful", { beliefSlot: true }).reason).toBe("a-belief");
  });

  test("being shown alone credits nothing: a belief left unrated is no glimpse, while an unrated footnote is", async () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    const before = JSON.stringify(c.store.row(belief));
    const out = turn(c, "s-shown");
    expect(out.decision.beliefs?.shown).toEqual([belief]);
    const foot = out.decision.footnotes[0] as string;
    expect(foot).toBeDefined();
    // A rating of the footnote opens the stretch; the belief beside it is left unrated.
    await rate(c, "s-shown", [{ id: foot, score: 1 }]);
    expect(JSON.stringify(c.store.row(belief))).toBe(before);
    // Pure: in the plan, an unrated belief is no credit, an unrated footnote a glimpse.
    const shown = rateableSet({ mem_f: { turn: 1, tier: "footnoted" } }, [], [], { [belief]: 1 });
    expect(shown.get(belief)?.lane).toBe("beliefs");
    const plan = planRatedUse({ shown, rated: [], floor: 0, otherwiseUsed: [], maxMembers: 8 });
    expect(plan.credits).toEqual([{ id: "mem_f", tier: "shown" }]);
    // Rated 3 beside a footnote rated 3: the footnote is co-used, the belief never.
    const both = planRatedUse({
      shown,
      rated: [
        { id: belief, score: 3, lane: "beliefs", drewOn: false },
        { id: "mem_f", score: 3, lane: "footnotes", drewOn: false },
      ],
      floor: 0,
      otherwiseUsed: [belief],
      maxMembers: 8,
    });
    expect(both.coUse).toEqual(["mem_f"]);
    expect(both.together).toEqual([]);
  });

  test("a belief line rated 0 (noise) in two sessions rests, as a habituated footnote does", async () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    for (const s of ["s-noise-1", "s-noise-2"]) {
      expect(turn(c, s).decision.beliefs?.shown).toEqual([belief]);
      await rate(c, s, [{ id: belief, score: 0 }]);
    }
    expect(turn(c, "s-noise-3").decision.beliefs?.shown).toEqual([]);
    // Habituation off (its revert): it shows again.
    setRecall(c, "HABITUATION_BAR_LIFT", 0);
    expect(turn(c, "s-noise-4").decision.beliefs?.shown).toEqual([belief]);
  });

  test("co-use links never land on a belief: rated 3 beside two memories rated 3, the memories link and the belief has no edge either way, so it reaches priming's link channel from nowhere", async () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    const out = turn(c, "s-couse");
    expect(out.decision.beliefs?.shown).toEqual([belief]);
    // Two memories this session was shown: this turn's, and the next turns' if it showed one.
    const seen = [...out.decision.surfaced, ...out.decision.footnotes];
    for (const text of ["The garage door opener and the smoke alarm batteries", "the library on Sundays and the kitchen tap"]) {
      const more = turn(c, "s-couse", text).decision;
      for (const id of [...more.surfaced, ...more.footnotes]) if (!seen.includes(id)) seen.push(id);
    }
    const [m1, m2] = seen as [string, string];
    expect(m2).toBeDefined();
    const got = await rate(c, "s-couse", [
      { id: belief, score: 3 },
      { id: m1, score: 3 },
      { id: m2, score: 2 },
    ]);
    expect(got["rated"]).toBe(3);
    const row = JSON.parse(c.store.eventLog({ name: "recall.rated", ref: "s-couse" })[0]?.payload ?? "{}") as { coUse: { ids: string[]; pairs: number } };
    expect(row.coUse.ids.sort()).toEqual([m1, m2].sort());
    expect(row.coUse.pairs).toBe(1);
    c.applyPendingAssociations({ session: "s-couse" });
    // The two memories are linked; the belief is in no edge, from it or to it.
    expect(c.associate.weightAt(m1, m2)).toBeGreaterThan(0);
    expect(c.store.edgesFrom(belief)).toEqual([]);
    const all = c.store.list({});
    for (const id of all) expect(c.store.edgesFrom(id).some((e) => e.dst === belief)).toBe(false);
    // Priming's link channel: the belief is nobody's partner and has none of its own.
    const partners = c.associate.partnersOf([m1, m2, belief]);
    expect(partners.has(belief)).toBe(false);
    for (const ps of partners.values()) expect(ps.some((p) => p.id === belief)).toBe(false);
  });

  test("review of #588 (S1): the slot's door opens only for a belief this session's slot showed", () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    const before = JSON.stringify(c.store.row(belief));
    // Never shown to this session: the flag is not honoured, nothing moves.
    const blind = c.resolveUse("s-never-shown", belief, "useful", { beliefSlot: true });
    expect(blind.credited).toBe(false);
    expect(JSON.stringify(c.store.row(belief))).toBe(before);
    // Shown to another session does not open it here either.
    expect(turn(c, "s-shown-elsewhere").decision.beliefs?.shown).toEqual([belief]);
    expect(c.resolveUse("s-never-shown", belief, "useful", { beliefSlot: true }).credited).toBe(false);
    expect(JSON.stringify(c.store.row(belief))).toBe(before);
    // Shown to this session: it is the one use a belief takes.
    expect(c.resolveUse("s-shown-elsewhere", belief, "useful", { beliefSlot: true }).credited).toBe(true);
  });

  test("ANY OTHER DOOR still credits a belief nothing (an open, a quote, drewOn): only the slot's rating is a use", () => {
    const c = brain();
    const { belief } = wrenWorld(c);
    const before = JSON.stringify(c.store.row(belief));
    expect(c.resolveUse("s-door", belief, "referenced").credited).toBe(false);
    expect(c.store.reinforce(belief, c.store.livedDay(), "referenced").reason).toBe("a-belief");
    expect(JSON.stringify(c.store.row(belief))).toBe(before);
  });
});

// ── tags prime ──────────────────────────────────────────────────────────────

/** A deterministic embedder over a few topics (as `context-priming.test.ts`'s), so meaning reaches what words do. */
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

describe("concept edges into priming (TAGS_PRIME)", () => {
  test("tag partners: a shared tag at 1, a concept-edge neighbour at 0.5; a stop tag and an everywhere tag partner nothing", () => {
    const c = brain();
    const put = (body: string, tags: string[]): string => {
      const id = c.store.put({ type: "memory", kind: "fact", body });
      c.store.tagMemory(id, tags, "writer");
      return id;
    };
    const a = put("The rye starter got fed twice.", ["sourdough", "october"]);
    const same = put("The levain smelled sharp.", ["sourdough"]);
    // "rye" keeps appearing with "sourdough" (two memories carry both): a concept edge.
    put("Rye and sourdough loaves for the market.", ["sourdough", "rye"]);
    put("Rye flour is cheaper at the mill.", ["sourdough", "rye"]);
    const neighbour = put("A rye cracker recipe from the baker.", ["rye"]);
    const dated = put("Something else from October.", ["october"]);
    const got = tagPartners(c.store, [a], { maxTagMemories: 40, neighbours: 2 });
    const of = new Map((got.get(a) ?? []).map((p) => [p.id, p.weight]));
    expect(of.get(same)).toBe(1);
    expect(of.get(neighbour)).toBe(0.5);
    expect(of.has(dated)).toBe(false);
    expect(of.has(a)).toBe(false);
    // A tag on more memories than the cap is about everything here: nothing.
    expect(tagPartners(c.store, [a], { maxTagMemories: 2, neighbours: 2 }).get(a)?.some((p) => p.id === same) ?? false).toBe(false);
  });

  test("the plan: tags join the link channel at TAGS_PRIME_WEIGHT, say so per partner, and off the source is never asked", () => {
    const c = brain();
    const day = c.store.livedDay();
    const state = { ...freshGateState("s-plan"), credited: { mem_src: { turn: 1, tier: "referenced" as const, day } } };
    let asked = 0;
    const prime: PrimeInput = {
      vector: null,
      partners: () => new Map(),
      tagPartners: (ids) => {
        asked += 1;
        return new Map(ids.map((id) => [id, [{ id: "mem_tagged", weight: 1 }]]));
      },
    };
    const t = { ...RECALL };
    const on = planPrime({ store: c.store, sessionId: "s-plan", state, turnNo: 2, day, echo: undefined, prime, t });
    expect(asked).toBe(1);
    const got = on.activation.link.get("mem_tagged");
    expect(got?.weight).toBeCloseTo(RECALL.TAGS_PRIME_WEIGHT, 9);
    expect(got?.tag).toBeCloseTo(RECALL.TAGS_PRIME_WEIGHT, 9);
    expect(got?.top?.id).toBe("mem_src");
    const off = planPrime({ store: c.store, sessionId: "s-plan", state, turnNo: 2, day, echo: undefined, prime, t: { ...t, TAGS_PRIME: false } });
    expect(asked).toBe(1);
    expect(off.activation.link.size).toBe(0);
    expect(primeChannel({ link: 0.3, train: 0.1, tag: 0.25 })).toBe("tag");
    expect(primeChannel({ link: 0.3, train: 0.1, tag: 0 })).toBe("link");
    expect(primeChannel({ link: 0.1, train: 0.3 })).toBe("train");
  });

  test("the composition root binds the tag source and the slot's lookup from schemas/, and leaves a turn that brings its own", () => {
    const fake = {
      aliasMap: () => new Map(),
      beliefsNamedIn: () => [],
      tagPartnersOf: () => new Map(),
    };
    const out = composeTurn({ sessionId: "s", text: "x", prime: { vector: null } }, { schemas: fake });
    expect(typeof out.beliefs).toBe("function");
    expect(typeof out.prime?.tagPartners).toBe("function");
    const own = (): readonly BeliefOffer[] => [];
    expect(composeTurn({ sessionId: "s", text: "x", beliefs: own }, { schemas: fake }).beliefs).toBe(own);
  });

  test("through recallForTurn: a used memory's tag lifts a weakly reached partner, and the footnote row says by tag, from which source", () => {
    const c = brain("store", { embed: topicVector });
    onDay(c, "2026-10-01");
    for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
    const a = c.store.put({ type: "memory", kind: "fact", body: "The sourdough starter lives in the cold pantry and gets fed with rye." });
    const b = c.store.put({ type: "memory", kind: "fact", body: "Mrs Okafor lent me her wicker proving basket and its drying rack." });
    c.store.put({ type: "memory", kind: "fact", body: "The basket of tomato seedlings went out to the garden planter." });
    c.store.put({ type: "memory", kind: "fact", body: "The bicycle chain was oiled and the basket bolted to the rack." });
    c.store.tagMemory(a, ["baking"], "writer");
    c.store.tagMemory(b, ["baking"], "writer");
    // A strong tag weight, so the test reads a behaviour, not the tuned value.
    setRecall(c, "TAGS_PRIME_WEIGHT", 1);
    const use = (session: string): void => {
      const first = turn(c, session, "how often should the sourdough starter be fed?");
      expect([...first.decision.surfaced, ...first.decision.footnotes]).toContain(a);
      c.rateShown(session, [{ id: a, score: 3 }]);
    };
    use("s-tags");
    const primed = turn(c, "s-tags", "is the basket still bolted to the bicycle rack").decision;
    const vb = primed.verdicts.find((v) => v.id === b);
    expect(vb?.primed?.tag ?? 0).toBeGreaterThan(0);
    expect(vb?.primed?.by).toBe("tag");
    expect(vb?.primed?.top).toBe(a);
    expect([...primed.surfaced, ...primed.footnotes]).toContain(b);
    expect(primed.primed?.byTag ?? 0).toBeGreaterThanOrEqual(1);
    const row = JSON.parse(c.store.eventLog({ name: RECALL_DECISION_EVENT, ref: "s-tags", order: "desc", limit: 1 })[0]?.payload ?? "{}") as {
      footnotes?: { id: string; primed?: { tag?: number; by?: string; top?: string; lifted?: true } }[];
    };
    const rb = row.footnotes?.find((f) => f.id === b);
    expect(rb?.primed?.by).toBe("tag");
    expect(rb?.primed?.top).toBe(a);
    expect(rb?.primed?.tag ?? 0).toBeGreaterThan(0);
    expect(rb?.primed?.lifted).toBe(true);
    // Off: the same session shape, and the tag gives nothing.
    setRecall(c, "TAGS_PRIME", false);
    use("s-notags");
    const plain = turn(c, "s-notags", "is the basket still bolted to the bicycle rack").decision;
    expect(plain.verdicts.find((v) => v.id === b)?.primed?.tag).toBeUndefined();
    expect([...plain.surfaced, ...plain.footnotes]).not.toContain(b);
    expect(plain.primed?.byTag).toBe(0);
  });
});

// ── the wake's project line ─────────────────────────────────────────────────

describe("the wake's project line (an experiment)", () => {
  const DATE = "2026-10-06";
  const BUDGET = 9_000;

  function projectWorld(): { c: Counterpart; folder: string; project: string; belief: string; other: string } {
    const folder = join(root, "lantern");
    const other = join(root, "garden");
    for (const d of [folder, other]) mkdirSync(d, { recursive: true });
    const c = brain();
    const d0 = onDay(c, "2026-10-01");
    const joined = c.joinProject({ folder, project: "Lantern", by: "owner" });
    if (!joined.ok) throw new Error(joined.reason);
    const project = joined.project.id;
    const belief = c.schemas.addBelief({ entityId: project, statement: "Lantern ships small, reviewed steps.", day: d0, birthRoute: "reflection" }).id as string;
    for (let i = 0; i < 4; i++) {
      const d = onDay(c, `2026-10-0${String(2 + i)}`);
      c.schemas.fileSupport({ beliefId: belief, memoryId: lived(c, `Mike asked again for one reviewed step at a time, take ${String(i)}.`, d, i), stance: "support", day: d });
    }
    onDay(c, DATE);
    return { c, folder, project, belief, other };
  }

  function wake(c: Counterpart, folder: string, budget = BUDGET): string {
    c.rebrief({ budgetBytes: budget, at: DATE });
    return c.wake(budget, { date: DATE }, { scope: folder, session: "s-reader", exportsFrom: () => true }).text;
  }

  test("in a project's folder, its strongest beliefs under one heading naming it; in another folder, none", () => {
    const { c, folder, belief, other } = projectWorld();
    const text = wake(c, folder);
    expect(text).toContain("This project (Lantern), as I hold it:");
    expect(text).toMatch(new RegExp(`\\n- Lantern ships small, reviewed steps\\. \\((tentative|fairly sure|firm); 4 memories\\) \\[${belief}\\]\\n`));
    const elsewhere = wake(c, other);
    expect(elsewhere).not.toContain("as I hold it");
  });

  test("off is the wake it was; and it yields first: at a ceiling with no room left, the wake goes without it, byte for byte", () => {
    const { c, folder } = projectWorld();
    (c.self.tunables as { WAKE_PROJECT_LINE: boolean }).WAKE_PROJECT_LINE = false;
    const off = wake(c, folder);
    expect(off).not.toContain("as I hold it");
    (c.self.tunables as { WAKE_PROJECT_LINE: boolean }).WAKE_PROJECT_LINE = true;
    const on = wake(c, folder);
    expect(on).toContain("as I hold it");
    expect(on.length).toBeGreaterThan(off.length);
    // A ceiling with no room left past what the wake already carries: it yields, and the wake is the off wake.
    const tight = new TextEncoder().encode(off).length;
    (c.self.tunables as { WAKE_PROJECT_LINE: boolean }).WAKE_PROJECT_LINE = false;
    const offTight = wake(c, folder, tight);
    (c.self.tunables as { WAKE_PROJECT_LINE: boolean }).WAKE_PROJECT_LINE = true;
    expect(new TextEncoder().encode(offTight).length).toBeLessThanOrEqual(tight);
    expect(wake(c, folder, tight)).toBe(offTight);
    // Its own byte budget too small for a line: none, and the wake is the off wake.
    (c.self.tunables as { WAKE_PROJECT_LINE_BYTES: number }).WAKE_PROJECT_LINE_BYTES = 20;
    expect(wake(c, folder)).toBe(off);
  });
});
