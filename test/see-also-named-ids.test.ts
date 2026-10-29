/**
 * PP1 (2026-10-29): SEE-ALSO FROM NAMED IDS — a memory whose text names
 * another memory's id brings it along when it surfaces ambiently, and a use
 * of what it brought trains the turn's words to it.
 *
 * The real-path demo is the 10-25 ping/pong miss, on a hermetic store seeded
 * to the live shape (10-29 snapshot, read in the brief): the rule says "ping",
 * so do many other memories, the rule sits below its bar for a bare "ping",
 * the note about the miss names the rule's id, and cue learning has wired
 * `ping → note` (live 0.727) and nothing to the rule. Through the real doors:
 * memories written with the `remember` MCP tool, turns through the
 * UserPromptSubmit hook (`Adapter#userPromptSubmit`), ratings through
 * `session_end`'s `rated`, the deltas through the worker's door
 * (`applyPendingAssociations`).
 *
 * Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { TUNABLES as RECALL, FRAMING, namedIds } from "../src/core/recall/index.js";
import type { CandidateVerdict } from "../src/core/recall/index.js";
import { TUNABLES as PHYSICS, strength } from "../src/core/physics/index.js";
import { stemTerm } from "../src/core/store/index.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/see-also";
const ZONE = "America/Denver";
const WRITER = "sess-pp1-writer";

const RULE = "A bare 'ping' from Mike just keeps the cache warm: the reply is 'pong' and nothing else, whatever ping came before.";
const TOPICS = ["library Sundays hours", "printer jams paper", "kitchen tap drips", "garage battery opener", "bus route minutes", "dentist cleaning booked"];
const PINGS = [
  "Pinged IndexNow after the site deploy; ping returned 200.",
  "Ping to the router was 4 ms; ping to the VPS 80 ms.",
  "The health check pings the worker every minute.",
  "Sent a ping to the release channel before tagging.",
  "The phone app shows a ping when a letter arrives.",
  "Ping-pong table in the garage needs a new net.",
  "The monitor pings the dashboard and logs latency.",
  "Asked the reviewer with a ping on the PR thread.",
  "A ping from the sidebar mod means the hook fired.",
  "The site's uptime ping failed twice on Tuesday.",
  "Pinging the store directly showed the lock held.",
  "The keepalive ping keeps the socket open overnight.",
];

let dir: string;
const closers: { close(): void }[] = [];
const saved = { on: RECALL.SEE_ALSO_NAMED_IDS };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-pp1-"));
  setSystemTime(new Date("2026-10-29T15:00:00.000Z"));
});

afterEach(() => {
  (RECALL as { SEE_ALSO_NAMED_IDS: boolean }).SEE_ALSO_NAMED_IDS = saved.on;
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

function adapter(budget = 9_000): Adapter {
  const a = openAdapter(
    { dataDir: dir, injectionBudgetBytes: budget, timeZone: ZONE },
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

function prompt(a: Adapter, session: string, text: string) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
  );
  return a.userPromptSubmit(input);
}

function work(a: Adapter) {
  return a.counterpart.applyPendingAssociations();
}

async function rate(a: Adapter, session: string, rated: { id: string; score: number }[]): Promise<Record<string, unknown>> {
  const out = (await server(a, session).call("session_end", { session, memories: [], rated })).structuredContent;
  return out["rated"] as Record<string, unknown>;
}

const PING = stemTerm("ping");

function pairWeight(a: Adapter, term: string, id: string): number {
  return a.counterpart.store.cueEdgesFor([term]).find((r) => r.memory_id === id)?.weight ?? 0;
}

/** The newest durable `recall.decision` row of a session, as a CHECK-AFTER read finds it. */
function decisionRow(a: Adapter, session: string): { footnotes: { id: string; via?: string; seeAlso?: { by: string } }[]; turn: number } {
  const row = a.counterpart.store.eventLog({ name: "recall.decision", ref: session, order: "desc", limit: 1 })[0];
  return JSON.parse(row?.payload ?? "{}") as { footnotes: { id: string; via?: string; seeAlso?: { by: string } }[]; turn: number };
}

/** A fresh session's verdicts for `text`, built and not recorded. */
function weigh(a: Adapter, session: string, text = "ping"): CandidateVerdict[] {
  return a.counterpart.recall.build({ sessionId: session, text, learned: (terms, day) => a.counterpart.associate.learnedCues(terms, day) }).decision.verdicts;
}

/** The live shape: filler, many "ping" memories, the rule, the note naming it, and `ping → note` learned. */
async function pingWorld(a: Adapter): Promise<{ rule: string; note: string }> {
  const store = findable(a.counterpart.store);
  for (let i = 0; i < 120; i++) store.put({ type: "memory", kind: "fact", body: `Note ${String(i)}: the ${TOPICS[i % TOPICS.length] as string} again, day ${String(i)}.` });
  for (let i = 0; i < 300; i++) store.put({ type: "memory", kind: "fact", body: `Unrelated record ${String(i)} about item${String(i)} and widget${String(i)}.` });
  for (const body of PINGS) store.put({ type: "memory", kind: "fact", body });
  const rule = await remember(a, WRITER, { title: "Ping means pong", text: RULE });
  const note = await remember(a, WRITER, {
    title: "The 10-25 ping miss",
    text: `On 10-25 a bare ping got a long answer instead of pong; the rule I missed is ${rule}, and it holds.`,
  });
  // What cue learning had wired by 10-29: the note, never the rule.
  store.writeCueEdges([{ token: PING, memoryId: note, weight: 0.727, lastDay: store.livedDay(), source: "test-seed" }]);
  return { rule, note };
}

describe("PP1 — see-also from named ids", () => {
  test("namedIds reads every mem_ id a text names, first mention first, each once", () => {
    expect(namedIds("see mem_0ca7f032368a (and mem_0ca7f032368a again), then mem_66bb7d836201abcd.")).toEqual(["mem_0ca7f032368a", "mem_66bb7d836201abcd"]);
    expect(namedIds("mem_short and xmem_0ca7f032368a and mem_0CA7F032368A")).toEqual([]);
  });

  test("the ping demo: a bare 'ping' brings the rule along beside the note; used, it trains 'ping'; the next fresh session's 'ping' reaches the rule on its own pair", async () => {
    const a = adapter();
    const { rule, note } = await pingWorld(a);

    // The live miss: the note is shown for "ping", the rule is under the bar it faced on its own.
    const before = weigh(a, "sess-probe-0");
    const v0 = before.find((v) => v.id === rule);
    expect(before.find((v) => v.id === note)?.verdict).toMatch(/surfaced|footnoted/);
    expect(v0?.via).toBe("see-also");
    expect(v0?.activation ?? 0).toBeLessThan(v0?.bar ?? 0);

    // Session 1, a fresh "ping" through the hook: the note, and the rule beside it, labelled.
    const t1 = prompt(a, "sess-pp1-1", "ping");
    expect([...t1.surfaced, ...t1.footnotes]).toContain(note);
    expect(t1.footnotes).toContain(rule);
    expect(t1.footnotes[t1.footnotes.length - 1]).toBe(rule);
    const injection = t1.injection;
    expect(injection).toContain(`${FRAMING.seeAlso} Ping means pong [${rule}]`);
    // The durable row marks it, so a rating joins to it (CHECK-AFTER).
    const row = decisionRow(a, "sess-pp1-1");
    const marked = row.footnotes.find((f) => f.id === rule);
    expect(marked?.via).toBe("see-also");
    expect(marked?.seeAlso?.by).toBe(note);
    expect(row.footnotes.filter((f) => f.via === "see-also")).toHaveLength(1);

    // The session follows the rule: the rule rated 3, the note rated 0.
    const r1 = await rate(a, "sess-pp1-1", [
      { id: rule, score: 3 },
      { id: note, score: 0 },
    ]);
    expect(r1["rated"]).toBe(2);
    work(a);
    // The turn's word trained to the rule; the 0 weakened `ping → note` (cue learning's own path).
    expect(pairWeight(a, PING, rule)).toBeGreaterThan(0);
    expect(pairWeight(a, PING, note)).toBeLessThan(0.727);

    // Session 2, a fresh "ping": the rule on its own learned pair — no see-also.
    const after = weigh(a, "sess-probe-2");
    const v2 = after.find((v) => v.id === rule);
    expect(v2?.verdict).toMatch(/surfaced|footnoted/);
    expect(v2?.via).toBeUndefined();
    expect(v2?.seeAlso).toBeUndefined();
    const t2 = prompt(a, "sess-pp1-2", "ping");
    expect([...t2.surfaced, ...t2.footnotes]).toContain(rule);
    const row2 = decisionRow(a, "sess-pp1-2");
    expect([...row2.footnotes].find((f) => f.id === rule)?.via).toBeUndefined();
  });

  test("an open of what was brought along credits it, and trains the turn's words to it, as a footnote's would", async () => {
    const a = adapter();
    const { rule } = await pingWorld(a);
    const t1 = prompt(a, "sess-open", "ping");
    expect(t1.footnotes).toContain(rule);
    // Rated 2 ("useful background"): a use at its tier.
    const r = await rate(a, "sess-open", [{ id: rule, score: 2 }]);
    expect(r["rated"]).toBe(1);
    work(a);
    expect(pairWeight(a, PING, rule)).toBeGreaterThan(0);
  });

  test("what may ride along: the head of a corrected one; never an archived one, one this session already saw, or one this session wrote", async () => {
    const a = adapter();
    const store = findable(a.counterpart.store);
    for (let i = 0; i < 60; i++) store.put({ type: "memory", kind: "fact", body: `Unrelated record ${String(i)} about item${String(i)} and widget${String(i)}.` });
    const old = store.put({ type: "memory", kind: "fact", title: "Old kettle rule", body: "Descale the kettle every month." });
    const head = store.supersede(old, { type: "memory", kind: "fact", title: "Kettle rule now", body: "Descale the kettle every two months.", salience: { claimed: 0.5 } });
    const gone = store.put({ type: "memory", kind: "fact", title: "Archived teapot rule", body: "Warm the teapot first." });
    store.archive(gone, "test");
    const faded = store.put({ type: "memory", kind: "fact", title: "Faded mug rule", body: "Rinse the mug before the tea.", salience: { claimed: 0 } });
    expect(strength(store.physicsOf(faded), store.livedDay())).toBeLessThan(PHYSICS.REACH);
    const corrected = await remember(a, WRITER, { title: "Saffron note", text: `Saffron goes in the risotto late; the kettle rule is ${old}.` });
    const archived = await remember(a, WRITER, { title: "Cardamom note", text: `Cardamom pods crushed first; the teapot rule is ${gone}, the mug rule ${faded}.` });

    // The corrected id brings the one that holds now.
    const t1 = prompt(a, "sess-held-1", "saffron risotto");
    expect([...t1.surfaced, ...t1.footnotes]).toContain(corrected);
    expect(t1.footnotes).toContain(head);
    expect(t1.footnotes).not.toContain(old);
    // An archived one, or one faded below reach: nothing rides along.
    const t2 = prompt(a, "sess-held-2", "cardamom pods");
    expect([...t2.surfaced, ...t2.footnotes]).toContain(archived);
    expect(t2.footnotes).not.toContain(gone);
    expect(t2.footnotes).not.toContain(faded);
    expect(decisionRow(a, "sess-held-2").footnotes.some((f) => f.via === "see-also")).toBe(false);
    // Already seen this session: not again.
    const t3 = prompt(a, "sess-held-1", "saffron risotto timing");
    expect(t3.footnotes).not.toContain(head);
    // This session wrote it: already in its context.
    const mine = await remember(a, "sess-writer-2", { title: "Basil rule", text: "Basil goes on after the heat is off." });
    await remember(a, "sess-other-3", { title: "Oregano note", text: `Oregano dried is fine; the basil rule is ${mine}.` });
    const t4 = prompt(a, "sess-writer-2", "oregano dried");
    expect(t4.footnotes).not.toContain(mine);
  });

  test("switch off: nothing rides along, and the render is the gate's alone — the same lines but the see-also one", async () => {
    const a = adapter();
    const { rule, note } = await pingWorld(a);
    const on = a.counterpart.recall.build({ sessionId: "sess-on", text: "ping", learned: (terms, day) => a.counterpart.associate.learnedCues(terms, day) });
    expect(on.decision.footnotes).toContain(rule);
    a.counterpart.close();

    (RECALL as { SEE_ALSO_NAMED_IDS: boolean }).SEE_ALSO_NAMED_IDS = false;
    const b = adapter();
    const off = b.counterpart.recall.build({ sessionId: "sess-off", text: "ping", learned: (terms, day) => b.counterpart.associate.learnedCues(terms, day) });
    expect([...off.decision.surfaced, ...off.decision.footnotes]).toContain(note);
    expect(off.decision.footnotes).not.toContain(rule);
    expect(off.decision.verdicts.find((v) => v.id === rule)?.verdict).toBe("below-bar");
    expect(off.decision.verdicts.some((v) => v.via === "see-also" || v.seeAlso !== undefined)).toBe(false);
    const body = (text: string): string[] => text.split("\n").filter((l) => !l.startsWith("<!-- counterparts:recall/end"));
    // On, the see-also line is the only footnote here (the note is loud), so it brought the header too.
    const lessAlong = body(on.injection).filter((l) => !l.startsWith(`- ${FRAMING.seeAlso}`));
    if (lessAlong[lessAlong.length - 1] === FRAMING.footnoteHeader) lessAlong.splice(-2, 2);
    expect(body(off.injection)).toEqual(lessAlong);
  });

  test("bytes: one line, its title clipped to SEE_ALSO_TITLE_BYTES, the first line a tight budget trims; at most SEE_ALSO_MAX a turn", async () => {
    const a = adapter();
    const store = findable(a.counterpart.store);
    for (let i = 0; i < 60; i++) store.put({ type: "memory", kind: "fact", body: `Kitchen record ${String(i)} about item${String(i)} and widget${String(i)}.` });
    const long = "x".repeat(400);
    const targets = [0, 1, 2].map((i) => store.put({ type: "memory", kind: "fact", title: `Target ${String(i)} ${long}`, body: `Target body ${String(i)}.` }));
    const notes = [
      ["Quince jelly", "Quince jelly set well this autumn"],
      ["Damson gin", "Damson gin steeps until midwinter"],
      ["Medlar curd", "Medlar curd keeps a fortnight chilled"],
    ] as const;
    for (let i = 0; i < 3; i++) await remember(a, WRITER, { title: notes[i]?.[0], text: `${notes[i]?.[1] as string}; see ${targets[i] as string}.` });

    const t = prompt(a, "sess-bytes", "in the kitchen: quince jelly, damson gin, medlar curd");
    const along = decisionRow(a, "sess-bytes").footnotes.filter((f) => f.via === "see-also");
    expect(along.length).toBe(RECALL.SEE_ALSO_MAX);
    const lines = t.injection.split("\n").filter((l) => l.startsWith(`- ${FRAMING.seeAlso}`));
    expect(lines).toHaveLength(RECALL.SEE_ALSO_MAX);
    for (const l of lines) {
      // "- See also: " + title (≤ SEE_ALSO_TITLE_BYTES) + " [mem_…]" — the worst case without a standing label.
      expect(Buffer.byteLength(l)).toBeLessThanOrEqual(2 + Buffer.byteLength(FRAMING.seeAlso) + 1 + RECALL.SEE_ALSO_TITLE_BYTES + 2 + 20 + 1);
    }

    // A budget one byte short of the recall block: the last see-also line is the first thing trimmed.
    const full = (decisionRow(a, "sess-bytes") as unknown as { bytes: number }).bytes;
    const short = a.counterpart.recall.build({ sessionId: "sess-bytes-short", text: "in the kitchen: quince jelly, damson gin, medlar curd", budgetBytes: full - 1 }).decision;
    expect(short.trimmed[0]).toEqual({ lane: "footnote", id: along[along.length - 1]?.id as string });
  });
});

describe("PP1 — another project's work, named by a shown memory (review of #681)", () => {
  test("RECALL_BY_PROJECT on: never rides along; the lift's count never counts what see-also showed", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-pp1-project-")));
    const bakery = join(root, "bakery");
    const garage = join(root, "garage");
    for (const d of [bakery, garage]) mkdirSync(d, { recursive: true });
    const c = Counterpart.open({ dir: join(root, "store") });
    const tunables = c.recall.tunables as { RECALL_BY_PROJECT: boolean; CROSS_PROJECT_BAR_LIFT: number };
    try {
      const store = findable(c.store);
      for (let i = 0; i < 60; i++) store.put({ type: "memory", kind: "fact", body: `Unrelated record ${String(i)} about item${String(i)} and widget${String(i)}.` });
      const work = (body: string, title: string, scope: string): string =>
        store.put({ type: "memory", kind: "fact", title, body, about: "work", aboutBy: "writer", origin: { scope } });
      // The bakery's memory is reached by the turn's words, and only the lift keeps it back.
      const theirs = work("The starter jar on the workbench feeds the bakery's flour order.", "Bakery starter jar", bakery);
      const ours = work(`The starter jar sits on the workbench now; see ${theirs}.`, "Workbench starter jar", garage);
      tunables.CROSS_PROJECT_BAR_LIFT = 1_000;
      const lifted = c.recallForTurn({ sessionId: "s-lift", text: "the starter jar on the workbench" }, { scope: garage });
      expect([...lifted.decision.surfaced, ...lifted.decision.footnotes]).toContain(ours);
      // Kept back, or shown: never both.
      expect(lifted.decision.crossProjectLifted).toBe(lifted.decision.footnotes.includes(theirs) ? 0 : 1);
      tunables.RECALL_BY_PROJECT = true;
      const held = c.recallForTurn({ sessionId: "s-held", text: "the starter jar on the workbench" }, { scope: garage });
      expect([...held.decision.surfaced, ...held.decision.footnotes]).toContain(ours);
      expect(held.decision.footnotes).not.toContain(theirs);
      expect(held.decision.verdicts.some((v) => v.via === "see-also")).toBe(false);
    } finally {
      tunables.RECALL_BY_PROJECT = RECALL.RECALL_BY_PROJECT;
      tunables.CROSS_PROJECT_BAR_LIFT = RECALL.CROSS_PROJECT_BAR_LIFT;
      c.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
