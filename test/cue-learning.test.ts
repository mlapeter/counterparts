/**
 * R3 (2026-10-24): CUE LEARNING — the words that brought a memory back, and
 * helped, wire to it.
 *
 * Through the real doors: memories are written with the `remember` MCP tool,
 * turns run through the UserPromptSubmit hook (`Adapter#userPromptSubmit`),
 * a deliberate question through the `recall` tool, ratings through
 * `session_end`'s `rated`, the deltas cross the pending file the credit pass
 * writes, and the worker's door (`applyPendingAssociations`) writes them down.
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { join, resolve } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { ownerRemoval } from "../src/adapters/cli/removal.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import { scopesPath } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { composeTurn } from "../src/core/retrieval.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { TUNABLES as ASSOCIATE } from "../src/core/associate/index.js";
import { CUES_KIND } from "../src/core/recall/index.js";
import { SCHEMA_VERSION, Store, paths, stemTerm } from "../src/core/store/index.js";
import { findable, stripV15 } from "./store-fixture.js";

const SCOPE = "/work/cues";
const ZONE = "America/Denver";
const WRITER = "sess-cue-writer";

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
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
  "The neighbour's cat sits on the fence every evening.",
  "Replaced the smoke alarm batteries in the hall.",
  "Booked the dentist for a routine cleaning.",
  "The bread flour is kept in the second cupboard.",
];

const PING = "A bare 'ping' from Mike just keeps the cache warm; the reply is 'pong' and nothing else.";
const COMPETITORS: readonly { title: string; text: string }[] = [
  { title: "Ping test for IndexNow", text: "Pinged IndexNow after the site deploy; ping returned 200." },
  { title: "Network ping latency", text: "Ping to the router was 4 ms; ping to the VPS 80 ms." },
  { title: "Notes about the ping memory", text: "Talked about the ping memory and whether ping should be answered." },
];

let dir: string;
const closers: { close(): void }[] = [];
const learning = PHYSICS.CUE_LEARNING;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-cues-"));
  setSystemTime(new Date("2026-10-24T15:00:00.000Z"));
});

afterEach(() => {
  (PHYSICS as { CUE_LEARNING: boolean }).CUE_LEARNING = learning;
  setSystemTime();
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

type Adapter = ReturnType<typeof openAdapter>;

function adapter(opts: { dataDir?: string; observer?: boolean } = {}): Adapter {
  const a = openAdapter(
    { dataDir: opts.dataDir ?? dir, injectionBudgetBytes: 9_000, timeZone: ZONE, ...(opts.observer === true ? { observer: true } : {}) },
    { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null },
  );
  closers.push(a.counterpart);
  return a;
}

function server(a: Adapter, session: string): McpServer {
  return new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: dir });
}

async function remember(a: Adapter, session: string, args: Record<string, unknown>): Promise<string> {
  const r = await server(a, session).call("remember", args);
  expect(r.isError).not.toBe(true);
  return r.structuredContent["id"] as string;
}

/** The ping world: filler, the ping memory, and three competitors with "ping" in the title. */
async function pingWorld(a: Adapter): Promise<{ ping: string; competitors: string[] }> {
  findable(a.counterpart.store);
  for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
  const ping = await remember(a, WRITER, { text: PING });
  const competitors: string[] = [];
  for (const c of COMPETITORS) competitors.push(await remember(a, WRITER, { title: c.title, text: c.text }));
  return { ping, competitors };
}

function prompt(a: Adapter, session: string, text: string) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
  );
  return a.userPromptSubmit(input);
}

/** The worker's half: what the credit passes left on disk, written down. */
function work(a: Adapter) {
  return a.counterpart.applyPendingAssociations();
}

async function rate(a: Adapter, session: string, rated: { id: string; score: number }[]): Promise<Record<string, unknown>> {
  const out = (await server(a, session).call("session_end", { session, memories: [], rated })).structuredContent;
  return out["rated"] as Record<string, unknown>;
}

/** Every candidate "ping" reaches on a fresh session's turn, ranked as the gate ranked them, without recording the turn. */
function weigh(a: Adapter, session: string, text = "ping") {
  return a.counterpart.recall.build({ sessionId: session, text, learned: (terms, day) => a.counterpart.associate.learnedCues(terms, day) }).decision.verdicts;
}

function pairWeight(a: Adapter, term: string, id: string): number {
  return a.counterpart.store.cueEdgesFor([term]).find((r) => r.memory_id === id)?.weight ?? 0;
}

const PING_TERM = stemTerm("ping");

describe("R3 — cue learning", () => {
  test("1. the ping demo: three competitors beat it for 'ping' at first; after B, C and D use it, E's bare 'ping' brings it back first and LOUD", async () => {
    const a = adapter();
    const { ping, competitors } = await pingWorld(a);

    // Before any learning: each competitor outranks the ping memory for "ping".
    const before = weigh(a, "sess-probe-0");
    const act = (id: string) => before.find((v) => v.id === id)?.activation ?? 0;
    for (const c of competitors) expect(act(c)).toBeGreaterThan(act(ping));
    const e0 = prompt(a, "sess-E0", "ping");
    expect(e0.surfaced).not.toContain(ping);

    // B asks for it on purpose, and its answer shows it; B rates it 3.
    const asked = (await server(a, "sess-B").call("recall", { question: "what do I reply to a ping?", mode: "meaning" })).structuredContent;
    expect(asked["ids"] as string[]).toContain(ping);
    expect((await rate(a, "sess-B", [{ id: ping, score: 3 }]))["rated"]).toBe(1);
    expect(work(a).cues?.rows ?? 0).toBeGreaterThan(0);
    const afterB = pairWeight(a, PING_TERM, ping);
    expect(afterB).toBeGreaterThan(0);

    // C and D say "ping", are shown it, and rate it 3.
    for (const s of ["sess-C", "sess-D"]) {
      const turn = prompt(a, s, "ping");
      // A quiet footnote now, and the first thing shown; not loud yet.
      expect(turn.footnotes[0]).toBe(ping);
      expect(turn.surfaced).toEqual([]);
      expect((await rate(a, s, [{ id: ping, score: 3 }]))["rated"]).toBe(1);
      work(a);
    }
    const afterD = pairWeight(a, PING_TERM, ping);
    expect(afterD).toBeGreaterThan(afterB);
    expect(afterD).toBeLessThan(ASSOCIATE.CUE_W_CAP);

    // E's bare "ping": first, ahead of all three, and at the LOUD tier.
    const after = weigh(a, "sess-probe-1");
    const top = [...after].sort((x, y) => y.activation - x.activation)[0];
    expect(top?.id).toBe(ping);
    const e = prompt(a, "sess-E", "ping");
    expect(e.surfaced).toEqual([ping]);
    const v = after.find((x) => x.id === ping);
    expect(v?.verdict).toBe("surfaced");
    expect(v?.cueFraction ?? 0).toBeGreaterThanOrEqual(0.5);
    // The competitors were never wired to "ping".
    for (const c of competitors) expect(pairWeight(a, PING_TERM, c)).toBe(0);
  });

  test("1b. the read follows the word's share of the turn: after the same training, a long prompt about something else that says 'ping' once does not bring the ping memory LOUD", async () => {
    // Review of #613: read at a flat `w × CUE_PAIR_UNITS`, this prompt brought
    // the ping memory LOUD at 13.4 (cue fraction 1.0), first, ahead of the
    // house memories it is about (7.1). Read at `w × share × CUE_PAIR_UNITS`,
    // the share being "ping"'s part of the turn's cue weight (the split
    // training uses), it is a sliver: below the bar, about 2.5.
    const a = adapter();
    const { ping } = await pingWorld(a);
    await server(a, "sess-B").call("recall", { question: "what do I reply to a ping?", mode: "meaning" });
    await rate(a, "sess-B", [{ id: ping, score: 3 }]);
    work(a);
    for (const s of ["sess-C", "sess-D"]) {
      prompt(a, s, "ping");
      await rate(a, s, [{ id: ping, score: 3 }]);
      work(a);
    }
    expect(pairWeight(a, PING_TERM, ping)).toBeGreaterThan(0.75);

    // About the house, ~35 words, every content word one the store holds, "ping" once.
    const LONG =
      "Before the dentist cleaning, remind me what is left at home: the printer jams on heavy paper, the kitchen tap drips, the garage opener battery is low, and ping the library about Sunday hours.";
    const vs = weigh(a, "sess-long-probe", LONG);
    const v = vs.find((x) => x.id === ping);
    const top = [...vs].sort((x, y) => y.activation - x.activation)[0];
    expect(top?.id).not.toBe(ping);
    expect(v?.verdict).not.toBe("surfaced");
    expect(v?.activation ?? 0).toBeLessThan(top?.activation ?? 0);
    const turn = prompt(a, "sess-long", LONG);
    expect(turn.surfaced).not.toContain(ping);

    // The same store, a bare "ping": the whole pair, LOUD (the demo's bar still holds).
    expect(prompt(a, "sess-bare", "ping").surfaced).toEqual([ping]);
  });

  test("step 0, a shape that fits the live row: by its word alone, a memory 'ping' shares with five others stays below even the UNLIFTED bar, fresh or mid-conversation (crossProjectLifted 0)", async () => {
    // The 10-24 "one turn late" (session bf46ebbb turn 6, ~/random): the live
    // decision row has crossProjectLifted 0 — the cross-project lift turned
    // nothing away — and the ping memory was not shown; one turn later it
    // came first at 27.25. A shape that fits that row without the lift: by
    // the word alone, a memory whose word several others share (live: about
    // six held "ping") sits below the bar itself, not between the bar and the
    // lifted bar. What else carried it on turn 7 is not known from the rows
    // (they keep counts and shown ids, not verdicts). The likeliest
    // difference: mid-conversation the meaning channel is the LAGGED vector
    // of the previous prompt (in-line meaning runs only on a first or stale
    // turn), so on turn 6 it pointed at turn 5's subject and on turn 7 at
    // turn 6's "ping". This test pins only the word's half. Learning lifts
    // exactly this case: a practised "ping" reads at share 1 (carried words
    // are not in the share).
    (PHYSICS as { CUE_LEARNING: boolean }).CUE_LEARNING = false;
    const a = adapter();
    findable(a.counterpart.store);
    const topics = ["library Sundays hours", "printer jams paper", "kitchen tap drips", "garage battery opener", "bus route minutes", "dentist cleaning booked"];
    for (let i = 0; i < 120; i++) a.counterpart.store.put({ type: "memory", kind: "fact", body: `Note ${String(i)}: the ${topics[i % topics.length] as string} again, day ${String(i)}.` });
    for (let i = 0; i < 300; i++) a.counterpart.store.put({ type: "memory", kind: "fact", body: `Unrelated record ${String(i)} about item${String(i)} and widget${String(i)}.` });
    for (let i = 0; i < 5; i++) a.counterpart.store.put({ type: "memory", kind: "fact", body: `Talked about ping number ${String(i)} and whether to answer it.` });
    const ping = await remember(a, "sess-other-writer", { text: PING });
    // By the word alone, on a first turn: below the bar (the verdicts, built without recording).
    const verdictOf = (session: string) => a.counterpart.recall.build({ sessionId: session, text: "ping" }).decision.verdicts.find((x) => x.id === ping);
    const fresh = verdictOf("sess-fresh");
    expect(fresh?.verdict).toBe("below-bar");
    expect(fresh?.activation ?? 0).toBeLessThan(fresh?.bar ?? 0);
    // Mid-conversation, after another subject: below the bar, and the row says the lift held nothing back.
    prompt(a, "sess-mid", "what about the library on Sundays, and the printer that jams?");
    const mid = verdictOf("sess-mid");
    expect(mid?.verdict).toBe("below-bar");
    const turn = prompt(a, "sess-mid", "ping");
    expect([...turn.surfaced, ...turn.footnotes]).not.toContain(ping);
    const row = a.counterpart.store.eventLog({ name: "recall.decision", ref: "sess-mid", order: "desc", limit: 1 })[0];
    const d = JSON.parse(row?.payload ?? "{}") as { turn?: number; crossProjectLifted?: number };
    expect(d.turn).toBe(2);
    expect(d.crossProjectLifted).toBe(0);
  });

  test("2. a competitor rated 0 for 'ping' drops for 'ping', and not for its own other words", async () => {
    const a = adapter();
    const { competitors } = await pingWorld(a);
    const net = competitors[1] as string; // "Network ping latency": ping, router, latency
    const t1 = prompt(a, "sess-net-1", "ping latency router");
    expect([...t1.surfaced, ...t1.footnotes]).toContain(net);
    await rate(a, "sess-net-1", [{ id: net, score: 3 }]);
    work(a);
    const latency = stemTerm("latency");
    const p1 = pairWeight(a, PING_TERM, net);
    const l1 = pairWeight(a, latency, net);
    expect(p1).toBeGreaterThan(0);
    expect(l1).toBeGreaterThan(p1); // the rarer words took more of the use

    // A bare "ping" now shows it; this session calls it noise.
    const t2 = prompt(a, "sess-net-2", "ping");
    expect([...t2.surfaced, ...t2.footnotes]).toContain(net);
    await rate(a, "sess-net-2", [{ id: net, score: 0 }]);
    work(a);
    expect(pairWeight(a, PING_TERM, net)).toBeLessThan(p1);
    expect(pairWeight(a, latency, net)).toBe(l1);
    // "ping" no longer lifts it; "latency" still does.
    const pingTurn = weigh(a, "sess-net-probe-1").find((v) => v.id === net);
    expect(pingTurn?.verdict).not.toBe("footnoted");
    const t3 = prompt(a, "sess-net-3", "latency");
    expect([...t3.surfaced, ...t3.footnotes]).toContain(net);
  });

  test("3. homeostasis: fifty credits of one showing train once; fifty sessions leave each pair under the cap and the word's total at most CUE_MAX_OUT", async () => {
    const a = adapter();
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const ping = await remember(a, WRITER, { text: PING });
    const team = await remember(a, WRITER, { text: "Ping the release channel before tagging a build, every time." });

    // One session, one showing, rated 3 fifty times: the showing trains once.
    const one = prompt(a, "sess-h-0", "ping");
    expect([...one.surfaced, ...one.footnotes]).toContain(ping);
    for (let i = 0; i < 50; i++) await rate(a, "sess-h-0", [{ id: ping, score: 3 }]);
    work(a);
    expect(pairWeight(a, PING_TERM, ping)).toBeCloseTo(0.5, 6);

    // Fifty sessions, both memories shown for "ping" and rated 3 in each.
    let rows = 0;
    for (let i = 1; i <= 50; i++) {
      const s = `sess-h-${String(i)}`;
      const turn = prompt(a, s, "ping");
      const shown = [...turn.surfaced, ...turn.footnotes].filter((id) => id === ping || id === team);
      await rate(a, s, shown.map((id) => ({ id, score: 3 })));
      rows += work(a).cues?.rows ?? 0;
    }
    expect(rows).toBeGreaterThan(0);
    const wPing = pairWeight(a, PING_TERM, ping);
    const wTeam = pairWeight(a, PING_TERM, team);
    expect(wPing).toBeLessThan(ASSOCIATE.CUE_W_CAP);
    expect(wTeam).toBeLessThan(ASSOCIATE.CUE_W_CAP);
    expect(wTeam).toBeGreaterThan(0);
    const total = a.counterpart.store.cueEdgesFor([PING_TERM]).reduce((sum, r) => sum + r.weight, 0);
    expect(total).toBeLessThanOrEqual(ASSOCIATE.CUE_MAX_OUT + 1e-9);
    // Scaling did the bounding: the two together sit at the ceiling.
    expect(total).toBeGreaterThan(ASSOCIATE.CUE_MAX_OUT - 0.05);
  });

  test("3b. credits that reach the worker together (two sessions in the same second, or a backlog) train as the same uses one at a time would: the pair stays under its cap", async () => {
    const a = adapter();
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const ping = await remember(a, WRITER, { text: PING });
    // Three sessions, the same second (the clock does not move), each shown it for a bare "ping" and rating it 3.
    for (const s of ["sess-same-1", "sess-same-2", "sess-same-3"]) {
      const turn = prompt(a, s, "ping");
      expect([...turn.surfaced, ...turn.footnotes]).toContain(ping);
      await rate(a, s, [{ id: ping, score: 3 }]);
    }
    // One worker run carries all three.
    expect(work(a).cues?.deltas).toBe(3);
    const w = pairWeight(a, PING_TERM, ping);
    expect(w).toBeLessThan(ASSOCIATE.CUE_W_CAP);
    // 0 → 0.5 → 0.75 → 0.875: what three uses applied one at a time give.
    expect(w).toBeCloseTo(0.875, 6);
  });

  test("4. the writer's own birth-day session trains nothing; another session the same day trains", async () => {
    const a = adapter();
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const ping = await remember(a, WRITER, { text: PING });
    const ask = async (session: string) => (await server(a, session).call("recall", { question: "what do I reply to a ping?", mode: "meaning" })).structuredContent["ids"] as string[];

    expect(await ask(WRITER)).toContain(ping);
    const own = await rate(a, WRITER, [{ id: ping, score: 3 }]);
    expect(own["rated"]).toBe(1);
    expect(work(a).cues).toBeUndefined();
    expect(a.counterpart.store.cueEdgesOf(ping)).toEqual([]);

    expect(await ask("sess-other")).toContain(ping);
    await rate(a, "sess-other", [{ id: ping, score: 3 }]);
    expect(work(a).cues?.rows ?? 0).toBeGreaterThan(0);
    expect(pairWeight(a, PING_TERM, ping)).toBeGreaterThan(0);
  });

  test("5. erasing the memory removes its pairs, the removal counts them, and 'ping' no longer fetches it", async () => {
    const a = adapter();
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const ping = await remember(a, WRITER, { text: PING });
    const shown = prompt(a, "sess-x-3", "ping");
    expect([...shown.surfaced, ...shown.footnotes]).toContain(ping);
    await rate(a, "sess-x-3", [{ id: ping, score: 3 }]);
    work(a);
    expect(a.counterpart.store.cueEdgesOf(ping).length).toBeGreaterThan(0);

    const outcome = ownerRemoval(a.counterpart.store, { targetId: ping, actor: "owner", reason: "test", requestedAt: 0 });
    expect(JSON.stringify(outcome)).toContain("operational.cue_edges");
    expect(a.counterpart.store.cueEdgesOf(ping)).toEqual([]);
    expect(a.counterpart.associate.learnedCues([PING_TERM]).get(PING_TERM) ?? []).toEqual([]);
    const after = prompt(a, "sess-x-4", "ping");
    expect([...after.surfaced, ...after.footnotes]).not.toContain(ping);
    expect(weigh(a, "sess-x-probe").map((v) => v.id)).not.toContain(ping);
  });

  test("5b. a word whose only memory is removed does not live on as a learned cue to another memory", async () => {
    // Review of #613: the guard (df > 0) held when the pair was learned, but
    // a word wired to memory B and held only by memory A must leave with A.
    const a = adapter();
    findable(a.counterpart.store);
    for (const body of FILLER) a.counterpart.store.put({ type: "memory", kind: "fact", body });
    const ping = await remember(a, WRITER, { text: PING });
    const secret = await remember(a, WRITER, { text: "Quillfeather is the codename for the surprise party." });
    const word = stemTerm("quillfeather");
    const turn = prompt(a, "sess-q-1", "ping pong quillfeather");
    expect([...turn.surfaced, ...turn.footnotes]).toContain(ping);
    await rate(a, "sess-q-1", [{ id: ping, score: 3 }]);
    work(a);
    expect(pairWeight(a, word, ping)).toBeGreaterThan(0);
    expect(pairWeight(a, PING_TERM, ping)).toBeGreaterThan(0);

    const outcome = ownerRemoval(a.counterpart.store, { targetId: secret, actor: "owner", reason: "test", requestedAt: 0 });
    expect(JSON.stringify(outcome)).toContain("words no memory holds now");
    expect(a.counterpart.store.cueEdgesFor([word])).toEqual([]);
    // A word another memory still holds keeps its pair.
    expect(pairWeight(a, PING_TERM, ping)).toBeGreaterThan(0);
  });

  test("6. an observer writes no pair and reads none", async () => {
    const a = adapter();
    const { ping } = await pingWorld(a);
    await server(a, "sess-B").call("recall", { question: "what do I reply to a ping?", mode: "meaning" });
    await rate(a, "sess-B", [{ id: ping, score: 3 }]);
    work(a);
    expect(pairWeight(a, PING_TERM, ping)).toBeGreaterThan(0);
    const lifted = weigh(a, "sess-obs-probe").find((v) => v.id === ping)?.activation ?? 0;

    const watcher = Counterpart.open({ dir, observer: true });
    closers.push(watcher);
    const cueRows = (): number => a.counterpart.store.gateRecords("sess-obs").filter((r) => r.kind === CUES_KIND).length;
    const pairs = JSON.stringify(a.counterpart.store.cueEdgesFor([PING_TERM]));
    const r = watcher.recallForTurn({ sessionId: "sess-obs", text: "ping" });
    const seen = r.decision.verdicts.find((v) => v.id === ping)?.activation ?? 0;
    // Read none: the learned lift is not in an instrument's turn.
    expect(seen).toBeLessThan(lifted);
    expect(watcher.associate.learnedCues([PING_TERM]).size).toBe(0);
    // Write none: no cue record, and a credit trains nothing.
    expect(cueRows()).toBe(0);
    const credit = watcher.resolveUse("sess-obs", ping, "referenced");
    expect(credit.cues).toBeUndefined();
    expect(watcher.recall.cueDepress("sess-obs", ping)).toEqual([]);
    expect(JSON.stringify(a.counterpart.store.cueEdgesFor([PING_TERM]))).toBe(pairs);
  });

  test("7. switch off: nothing is recorded, trained or read, and the turn is composed exactly as before", async () => {
    (PHYSICS as { CUE_LEARNING: boolean }).CUE_LEARNING = false;
    const a = adapter();
    const { ping } = await pingWorld(a);
    const base = composeTurn({ sessionId: "s", text: "ping" }, { associate: a.counterpart.associate });
    expect(base.learned).toBeUndefined();
    await server(a, "sess-B").call("recall", { question: "what do I reply to a ping?", mode: "meaning" });
    await rate(a, "sess-B", [{ id: ping, score: 3 }]);
    for (const s of ["sess-C", "sess-D"]) {
      const t = prompt(a, s, "ping");
      expect([...t.surfaced, ...t.footnotes]).not.toContain(ping);
      await rate(a, s, [{ id: ping, score: 3 }]);
    }
    expect(work(a).cues).toBeUndefined();
    const e = prompt(a, "sess-E", "ping");
    expect([...e.surfaced, ...e.footnotes]).not.toContain(ping);
    const kinds = new Set<string>();
    for (const s of ["sess-B", "sess-C", "sess-D", "sess-E"]) for (const r of a.counterpart.store.gateRecords(s)) kinds.add(r.kind);
    expect(kinds.has(CUES_KIND)).toBe(false);
    expect(kinds.has("cuetrain")).toBe(false);
    expect(a.counterpart.store.cueEdgesOf(ping)).toEqual([]);
  });
});

// ── across processes: what the hooks and the server actually are ──────────

describe("R3 — across processes (a long-lived server, per-turn hook processes)", () => {
  const HOOK = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
  let work2: string;
  let store: string;
  let configPath: string;
  let home: string;

  beforeEach(() => {
    work2 = mkdtempSync(join(tmpdir(), "counterparts-cues-proc-"));
    home = join(work2, "home");
    mkdirSync(home, { recursive: true });
    store = join(work2, "store");
    configPath = join(work2, "claude-code.json");
    // No embedder anywhere: what these tests show is the words' path, and it
    // must not depend on whether the machine has the static table's weights.
    writeFileSync(configPath, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9_000, embedder: { enabled: false } }), "utf8");
  });

  afterEach(() => {
    rmSync(work2, { recursive: true, force: true });
  });

  function hook(session: string, prompt: string, cwd: string): { injection: string } {
    const r = spawnSync(process.execPath, ["run", HOOK, "--config", configPath], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: session, cwd, prompt }),
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      timeout: 60_000,
    });
    return { injection: r.stdout ?? "" };
  }

  /** The long-lived server, in this process (the hooks are separate processes). */
  function liveServer(scope: string) {
    const s = openServer({ dir: store, session: "sess-proc-A", scope });
    closers.push(s.counterpart);
    return s;
  }

  test("step 0: a memory written in session A by the long-lived server is findable by session B's very next turn, in its own process", async () => {
    const folder = join(work2, "project");
    const s = liveServer(folder);
    for (const f of FILLER) await s.call("remember", { text: f });
    // B is mid-conversation about something else: its next turn carries those words.
    hook("sess-proc-B", "what about the library on Sundays?", folder);
    const id = (await s.call("remember", { text: PING })).structuredContent["id"] as string;
    expect(typeof id).toBe("string");
    // Written synchronously: the row and its words, before the tool returned.
    expect(s.counterpart.store.search("ping").map((h) => h.id)).toContain(id);
    const next = hook("sess-proc-B", "ping", folder);
    expect(next.injection).toContain(id);
  });

  test("the cross-project bar lift, as a fact about the lift: a memory from another folder that one word reaches, in a background the previous turn's words made, can be held between its bar and the lifted bar (crossProjectLifted 1); a first turn shows it", async () => {
    // Not the 10-24 live miss: that turn's row has crossProjectLifted 0 (see
    // "step 0, a shape that fits the live row" above). What this pins is that
    // nothing is stale across processes — the memory the long-lived server
    // wrote is found, scored and gated by the next hook process — and what
    // `CROSS_PROJECT_BAR_LIFT` (1.25, wave 2 lane G) does in this small store,
    // where "ping" is in one memory: the lift alone turns it away.
    const s = liveServer(join(work2, "a"));
    for (const f of FILLER) await s.call("remember", { text: f });
    hook("sess-proc-B", "what about the library on Sundays, and the printer that jams?", join(work2, "random"));
    const id = (await s.call("remember", { text: PING })).structuredContent["id"] as string;
    const next = hook("sess-proc-B", "ping", join(work2, "random"));
    expect(next.injection).not.toContain(id);
    const row = s.counterpart.store.eventLog({ name: "recall.decision", ref: "sess-proc-B", order: "desc", limit: 1 })[0];
    const record = JSON.parse(row?.payload ?? "{}") as { turn?: number; crossProjectLifted?: number };
    expect(record.turn).toBe(2);
    expect(record.crossProjectLifted).toBe(1);
    // A first turn has no carried words: it shows (the bar is the absolute floor).
    expect(hook("sess-proc-fresh", "ping", join(work2, "random")).injection).toContain(id);
  });

  test("6b. a turn in a folder that is off records no cue words and trains nothing", async () => {
    const s = openServer({ dir: store, session: "sess-proc-A", scope: join(work2, "a") });
    closers.push(s.counterpart);
    for (const f of FILLER) await s.call("remember", { text: f });
    await s.call("remember", { text: PING });
    const off = join(work2, "off-project");
    writeFileSync(scopesPath(configPath), `${JSON.stringify({ version: 1, scopes: { [off]: { mode: "off", since: "2026-10-24T00:00:00.000Z" } } }, null, 2)}\n`, "utf8");
    const turn = hook("sess-proc-off", "ping", off);
    expect(turn.injection).not.toContain("counterparts:recall");
    expect(s.counterpart.store.gateRecords("sess-proc-off")).toEqual([]);
    const on = hook("sess-proc-on", "ping", join(work2, "random"));
    expect(on.injection).toContain("counterparts:recall");
    expect(s.counterpart.store.gateRecords("sess-proc-on").some((r) => r.kind === CUES_KIND)).toBe(true);
  });
});

// ── the store format: v15 ───────────────────────────────────────────────────

describe("R3 — store v15 (one additive table)", () => {
  test("a v14 store reads as 'nothing learned' to an observer, and migrates after a copy; fresh and migrated converge", () => {
    const root = mkdtempSync(join(tmpdir(), "counterparts-v15-"));
    const at = join(root, "store");
    const snaps = join(root, "snaps");
    try {
      const first = Store.open({ dir: at, snapshotsDir: snaps });
      const id = first.put({ type: "memory", kind: "fact", body: "A v14 memory about ping." });
      first.close();
      const db = new Database(paths.operational(at));
      stripV15(db);
      db.run("UPDATE meta SET value = '14' WHERE key = 'schemaVersion'");
      db.close();

      const reader = Store.open({ dir: at, snapshotsDir: snaps, observer: true });
      expect(reader.getMeta("schemaVersion")).toBe("14");
      expect(reader.cueEdgesFor([PING_TERM])).toEqual([]);
      expect(reader.cueEdgesOf(id)).toEqual([]);
      reader.close();

      const s = Store.open({ dir: at, snapshotsDir: snaps });
      expect(SCHEMA_VERSION).toBe(15);
      expect(s.getMeta("schemaVersion")).toBe("15");
      expect(readdirSync(snaps).filter((n) => n.includes("pre-migration-v14-to-v15"))).toHaveLength(1);
      s.writeCueEdges([{ token: PING_TERM, memoryId: id, weight: 0.5, lastDay: 0, source: "use" }]);
      expect(s.cueEdgesOf(id).map((r) => r.weight)).toEqual([0.5]);
      s.close();

      const fresh = join(root, "fresh");
      Store.open({ dir: fresh, snapshotsDir: snaps }).close();
      const shape = (path: string): string => {
        const d = new Database(path, { readonly: true });
        try {
          return JSON.stringify([d.query("PRAGMA table_info(cue_edges)").all(), d.query("PRAGMA index_list(cue_edges)").all()]);
        } finally {
          d.close();
        }
      };
      expect(shape(paths.operational(at))).toBe(shape(paths.operational(fresh)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
