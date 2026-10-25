/**
 * E3 (2026-10-24): AN UNSETTLED PAIR COMPETES IN RECALL — retroactive
 * interference, in real time. A write the slot detector reads as the newer
 * state of an older memory leaves an unsettled pair; until the night answers
 * it, a turn that reaches BOTH weighs the older down
 * (`activation × (1 − k · sim · fresh)`), so the newer wins a close race. The
 * older keeps its label and still shows when it clears its bar; alone it is
 * untouched; nothing is written.
 *
 * Through the real doors: memories are written with the `remember` MCP tool
 * (the detector proposes the pair there), turns run through the
 * UserPromptSubmit hook (`Adapter#userPromptSubmit`), the night's answer
 * through the dream's own doors (`dreams.begin` / `propose`'s `slot`). A small
 * fake embedder (topic buckets) gives the vectors the detector and the weight
 * read. Hermetic: every store is a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LiveEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { RECALL_DECISION_EVENT } from "../src/core/counterpart-events.js";
import { CONTRADICTION_TUNABLES, SLOT_SOURCE } from "../src/core/reconsolidation.js";
import { TUNABLES, standingOf, unsettledCompetition } from "../src/core/recall/index.js";
import type { RecallTunables } from "../src/core/recall/index.js";
import type { Embedder } from "../src/core/store/index.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/garage";
const ZONE = "America/Denver";
const WRITER = "sess-writer";

const FILLER = [
  "The library closes early on Sundays now.",
  "Rebasing keeps the history readable for reviewers.",
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
  "The garage door opener needs a new battery soon.",
];

/**
 * A FAKE EMBEDDER: one dimension per topic; `NUDGE` words lean a text a
 * little off its topic, so two texts on one topic read at a chosen closeness
 * (one nudge word against none: cosine ~0.87, past the detector's 0.85).
 */
const TOPIC: Record<string, number> = { car: 0, drives: 0, driving: 0, sister: 1, brother: 1, dentist: 2, library: 3 };
const NUDGE: Record<string, number> = { now: 4, swapped: 4, teacher: 5, nurse: 6 };
const topicVector: Embedder = (text: string): number[] | null => {
  const v = [0, 0, 0, 0, 0, 0, 0, 0.05];
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    const d = TOPIC[w];
    if (d !== undefined) v[d] = (v[d] ?? 0) + 1;
    const n = NUDGE[w];
    if (n !== undefined) v[n] = (v[n] ?? 0) + 0.55;
  }
  return v;
};

let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-unsettled-"));
  setSystemTime(new Date("2026-10-24T15:00:00.000Z"));
});

afterEach(() => {
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

function adapter(tunables: Partial<RecallTunables> = {}): Adapter {
  const embedder: LiveEmbedder = {
    model: "test-topics-e3",
    embed: topicVector,
    vector: async (t: string) => topicVector(t),
    warm: async (texts: readonly string[]) => texts.length,
    stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
  const a = openAdapter(
    { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: ZONE },
    { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder },
  );
  closers.push(a.counterpart);
  tune(a, tunables);
  return a;
}

/** This adapter's recall knobs (its `Recall` copied them at open). */
function tune(a: Adapter, tunables: Partial<RecallTunables>): void {
  Object.assign(a.counterpart.recall.tunables, tunables);
}

function server(a: Adapter, session: string): McpServer {
  return new McpServer({ counterpart: a.counterpart, session, scope: SCOPE, registryDir: dir });
}

async function remember(a: Adapter, text: string): Promise<Record<string, unknown>> {
  const r = await server(a, WRITER).call("remember", { text });
  expect(r.isError).not.toBe(true);
  return r.structuredContent;
}

function prompt(a: Adapter, session: string, text: string) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: dir },
  );
  return a.userPromptSubmit(input);
}

function lastDecision(a: Adapter, session: string): Record<string, unknown> {
  const rows = a.counterpart.store.eventLog({ name: RECALL_DECISION_EVENT, ref: session, order: "desc", limit: 1 });
  return JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
}

const OLDER = "Mike drives a green Subaru Outback car, bought used in Boise.";
const NEWER = "Mike swapped: the car he drives now is a Rivian pickup.";

/** A world old enough to rank by (filler, a few lived days), and the pair written through `remember`. */
async function world(a: Adapter): Promise<{ older: string; newer: string }> {
  const store = a.counterpart.store;
  setSystemTime(new Date("2026-10-24T15:00:00.000Z"));
  findable(store);
  for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) store.advanceClock(d);
  for (const body of FILLER) store.put({ type: "memory", kind: "fact", body });
  const older = String((await remember(a, OLDER))["id"]);
  // Written later the same day (the detector reads the older as written before it).
  setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
  const r = await remember(a, NEWER);
  const newer = String(r["id"]);
  expect(r["slot"]).toMatchObject({ over: older });
  expect(store.contradictionBetween(older, newer)).toMatchObject({ state: "unsettled", source: SLOT_SOURCE, a: older, b: newer });
  return { older, newer };
}

const shown = (t: { surfaced: readonly string[]; footnotes: readonly string[] }): string[] => [...t.surfaced, ...t.footnotes];

describe("E3 — an unsettled pair competes", () => {
  test("the recall knobs keep step with the detector's", () => {
    expect(TUNABLES.UNSETTLED_COMPETE_SIM_FLOOR).toBe(CONTRADICTION_TUNABLES.SLOT_LINEAGE_COSINE);
    expect(TUNABLES.UNSETTLED_COMPETE_WINDOW_DAYS).toBe(CONTRADICTION_TUNABLES.SLOT_WINDOW_DAYS);
    expect(TUNABLES.UNSETTLED_COMPETES).toBe(true);
  });

  test("1. both cued: the newer ranks above the older, and the older still shows, with its label", async () => {
    const a = adapter();
    const { older, newer } = await world(a);
    const t = prompt(a, "sess-ask", "which car does Mike drive?");
    const ids = shown(t);
    expect(ids).toContain(newer);
    expect(ids).toContain(older);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(t.injection).toContain(`Unsettled — may be out of date, see [${newer}]`);
    const d = lastDecision(a, "sess-ask");
    expect(d["pairsCompeted"]).toBe(1);
    const rows = [...(d["surfaced"] as { id: string }[]), ...(d["footnotes"] as { id: string; competed?: { with: string; factor: number } }[])];
    const row = rows.find((r) => r.id === older) as { competed?: { with: string; factor: number } } | undefined;
    expect(row?.competed?.with).toBe(newer);
    expect(row?.competed?.factor ?? 1).toBeLessThan(1);
    expect(row?.competed?.factor ?? 0).toBeGreaterThan(0.3);
    // The same turn with the switch off: the older came first.
    tune(a, { UNSETTLED_COMPETES: false });
    const off = shown(prompt(a, "sess-ask-off", "which car does Mike drive?"));
    expect(off.indexOf(older)).toBeLessThan(off.indexOf(newer));
  });

  test("2. only the older cued: it shows as before, labelled, at its full activation", async () => {
    const a = adapter();
    const { older, newer } = await world(a);
    const t = prompt(a, "sess-only", "the green Outback bought used in Boise");
    expect(shown(t)).toContain(older);
    expect(shown(t)).not.toContain(newer);
    expect(t.injection).toContain(`Unsettled — may be out of date, see [${newer}]`);
    const d = lastDecision(a, "sess-only");
    expect(d["pairsCompeted"]).toBe(0);
    const rows = [...(d["surfaced"] as { id: string; competed?: unknown }[]), ...(d["footnotes"] as { id: string; competed?: unknown }[])];
    const row = rows.find((r) => r.id === older) as { activation?: number; competed?: unknown } | undefined;
    expect(row?.competed).toBeUndefined();
    // The same turn, switch off: the same activation.
    tune(a, { UNSETTLED_COMPETES: false });
    prompt(a, "sess-only-off", "the green Outback bought used in Boise");
    const off = lastDecision(a, "sess-only-off");
    const offRow = [...(off["surfaced"] as { id: string; activation?: number }[]), ...(off["footnotes"] as { id: string; activation?: number }[])].find((r) => r.id === older);
    expect(row?.activation).toBe(offRow?.activation as number);
  });

  test("a wrong pair (two people, similar facts) costs a tie-break, the older keeps showing labelled, and the night's undo ends it", async () => {
    // The reviewer's case, built on purpose: Ben's sister is not Anna's, but
    // the two read alike, so the detector proposes Ben's as the newer state
    // of Anna's. Until the night says "two things", a turn about both weighs
    // Anna's down — it still shows, with its label; after the undo, nothing.
    const a = adapter();
    const store = a.counterpart.store;
    findable(store);
    for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) store.advanceClock(d);
    for (const body of FILLER) store.put({ type: "memory", kind: "fact", body });
    const anna = String((await remember(a, "Anna's sister, her only sister, is a nurse at the Elm Street clinic."))["id"]);
    setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
    const r = await remember(a, "Ben's sister, his only sister, is a teacher near the clinic.");
    const ben = String(r["id"]);
    expect(r["slot"]).toMatchObject({ over: anna });
    const ask = "whose sister works at the clinic?";
    const t = prompt(a, "sess-wrong", ask);
    expect(shown(t)).toContain(anna);
    expect(shown(t)).toContain(ben);
    expect(t.injection).toContain(`Unsettled — may be out of date, see [${ben}]`);
    expect(lastDecision(a, "sess-wrong")["pairsCompeted"]).toBe(1);
    night(a, store.contradictionBetween(anna, ben)?.id as string, false);
    const u = prompt(a, "sess-wrong-after", ask);
    expect(shown(u)).toContain(anna);
    expect(u.injection).not.toContain("Unsettled");
    expect(lastDecision(a, "sess-wrong-after")["pairsCompeted"]).toBe(0);
  });

  test("3. confirmed at night: the head wins as today, and nothing competes", async () => {
    const a = adapter();
    const { older, newer } = await world(a);
    const pair = a.counterpart.store.contradictionBetween(older, newer)?.id as string;
    night(a, pair, true);
    expect(a.counterpart.store.contradiction(pair)?.state).toBe("settled");
    const t = prompt(a, "sess-after", "which car does Mike drive?");
    expect(shown(t)).toContain(newer);
    expect(shown(t)).not.toContain(older);
    expect(t.injection).toContain(`(earlier: [${older}])`);
    expect(lastDecision(a, "sess-after")["pairsCompeted"]).toBe(0);
  });

  /** Two texts one word apart written through `remember`, the second proposed as the newer state of the first. */
  async function nearDuplicates(a: Adapter, first: string, second: string): Promise<{ older: string; newer: string }> {
    const store = a.counterpart.store;
    findable(store);
    for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) store.advanceClock(d);
    for (const body of FILLER) store.put({ type: "memory", kind: "fact", body });
    const older = String((await remember(a, first))["id"]);
    setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
    const r = await remember(a, second);
    expect(r["slot"]).toMatchObject({ over: older });
    return { older, newer: String(r["id"]) };
  }

  /** Both members' gate verdicts for `ask` (a probe session of its own). */
  function verdictsOf(a: Adapter, session: string, ask: string, older: string, newer: string): { older: unknown; newer: unknown } {
    const d = a.counterpart.recall.build({ sessionId: session, text: ask }).decision;
    return { older: d.verdicts.find((v) => v.id === older)?.verdict, newer: d.verdicts.find((v) => v.id === newer)?.verdict };
  }

  test("near-duplicates by words: a competing pair is not each other's copy — both show, the newer first, the older labelled", async () => {
    // Two texts one word apart are near-duplicates (`NEAR_DUPLICATE`), and the
    // gate shows only the stronger. Off, the older is the stronger here, so the
    // outdated one shows and hides the newer as its copy. On, the two members
    // of a competing pair are exempt from that rule between themselves: both
    // show, the newer first, the older with its label.
    const a = adapter();
    const base = "Mike renewed the car registration for driving at the county office downtown on Monday morning, paying the fee with the";
    const { older, newer } = await nearDuplicates(a, `${base} blue card.`, `${base} green card.`);
    const ask = "when was the car registration renewed at the county office?";
    tune(a, { UNSETTLED_COMPETES: false });
    expect(verdictsOf(a, "probe-off", ask, older, newer)).toEqual({ older: "footnoted", newer: "inhibited" });
    tune(a, { UNSETTLED_COMPETES: true });
    expect(verdictsOf(a, "probe-on", ask, older, newer)).toEqual({ older: "footnoted", newer: "footnoted" });
    const t = prompt(a, "sess-dup", ask);
    const ids = shown(t);
    expect(ids).toContain(older);
    expect(ids.indexOf(newer)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(t.injection).toContain(`Unsettled — may be out of date, see [${newer}]`);
  });

  test("a WRONG near-duplicate pair (two people, one name apart) never hides the older the turn asked about", async () => {
    // The reviewer's case: Anna's renewal and Ben's read alike word for word,
    // so the detector proposes Ben's as the newer state of Anna's. A turn
    // about Anna reaches hers strongly; at the full weight (sim 1, fresh 1,
    // factor 0.4) it sorts below Ben's and, as a near-duplicate, was
    // inhibited as his copy: the true memory gone for the day. It shows,
    // labelled, and Ben's shows too.
    const a = adapter();
    const base = "renewed the car registration for driving at the county office downtown on Monday morning, paying the fee with the blue card.";
    const { older: anna, newer: ben } = await nearDuplicates(a, `Anna ${base}`, `Ben ${base}`);
    const ask = "when did Anna renew the car registration?";
    tune(a, { UNSETTLED_COMPETES: false });
    expect(verdictsOf(a, "probe-off", ask, anna, ben)).toEqual({ older: "footnoted", newer: "inhibited" });
    tune(a, { UNSETTLED_COMPETES: true });
    expect(verdictsOf(a, "probe-on", ask, anna, ben)).toEqual({ older: "footnoted", newer: "footnoted" });
    const t = prompt(a, "sess-anna", ask);
    expect(shown(t)).toContain(anna);
    expect(shown(t)).toContain(ben);
    expect(t.injection).toContain(`Unsettled — may be out of date, see [${ben}]`);
    expect(lastDecision(a, "sess-anna")["pairsCompeted"]).toBe(1);
  });

  test("4. undone at night: no competition from then on, and no label", async () => {
    const a = adapter();
    const { older, newer } = await world(a);
    const pair = a.counterpart.store.contradictionBetween(older, newer)?.id as string;
    night(a, pair, false);
    expect(a.counterpart.store.contradiction(pair)?.state).toBe("withdrawn");
    const t = prompt(a, "sess-undone", "which car does Mike drive?");
    expect(shown(t)).toContain(older);
    expect(shown(t)).toContain(newer);
    expect(t.injection).not.toContain("Unsettled");
    expect(lastDecision(a, "sess-undone")["pairsCompeted"]).toBe(0);
    expect(standingOf(a.counterpart.store, older)).toBeNull();
  });

  test("5. switch off: nothing is read, and the turn and its row are exactly as before", async () => {
    // The same world twice, each in its own store: once with the switch off,
    // once on with k 0 (the weight read, and inert). Off writes no
    // `pairsCompeted` and no `competed`; the injections and the rows
    // match byte for byte once that one field is set aside.
    const a = adapter({ UNSETTLED_COMPETES: false });
    await world(a);
    const t = prompt(a, "sess-x", "which car does Mike drive?");
    const row = lastDecision(a, "sess-x");
    expect("pairsCompeted" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("competed");
    a.counterpart.close();
    closers.length = 0;
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "counterparts-unsettled-"));

    const b = adapter({ UNSETTLED_COMPETES: true, UNSETTLED_COMPETE_K: 0 });
    await world(b);
    const u = prompt(b, "sess-x", "which car does Mike drive?");
    const rowOn = lastDecision(b, "sess-x");
    expect(rowOn["pairsCompeted"]).toBe(0);
    expect(u.injection.replace(/mem_[0-9a-f]+/g, "ID")).toBe(t.injection.replace(/mem_[0-9a-f]+/g, "ID"));
    const strip = (r: Record<string, unknown>): string => {
      const { pairsCompeted: _drop, elapsedMs: _ms, ...rest } = r;
      return JSON.stringify(rest).replace(/mem_[0-9a-f]+/g, "ID");
    };
    expect(strip(rowOn)).toBe(strip(row));
  });

  test("the weight itself: sim over the floor, fresh over the window, the strongest press for an older in two pairs", async () => {
    const a = adapter();
    const { older, newer } = await world(a);
    const store = a.counterpart.store;
    const reached = [older, newer].map((id) => ({ id, cue: 1, semantic: 0 }));
    const tune = { k: 0.6, simFloor: 0.8, windowDays: 7 };
    const day = store.livedDay();
    const m = unsettledCompetition(store, reached, day, tune);
    const c = m.get(older);
    expect(c?.with).toBe(newer);
    expect(c?.fresh).toBe(1);
    expect(c?.sim ?? 0).toBeGreaterThan(0);
    expect(c?.factor).toBeCloseTo(1 - 0.6 * (c?.sim ?? 0), 9);
    expect(m.has(newer)).toBe(false);
    // Three lived days on, the press eases; past the window it is gone.
    expect(unsettledCompetition(store, reached, day + 3, tune).get(older)?.fresh).toBeCloseTo(4 / 7, 9);
    expect(unsettledCompetition(store, reached, day + 7, tune).size).toBe(0);
    // The newer only linked to (no cue, no meaning): no press.
    expect(unsettledCompetition(store, [reached[0]!, { id: newer, cue: 0, semantic: 0, linkOnly: true as const }], day, tune).size).toBe(0);
  });
});

/** The night's answer, through the dream's own doors. */
function night(a: Adapter, pair: string, same: boolean): void {
  const c = a.counterpart;
  const begun = c.dreams.begin({ session: "sess-dream", scope: SCOPE });
  if (!begun.ok) throw new Error(begun.reason);
  const r = c.dreams.propose({ dream: begun.bundle.dream, session: "sess-dream", changes: [{ action: "slot", pair, same, why: same ? "the newer car" : "two things" }] });
  if (!r.ok) throw new Error("propose refused");
  c.dreams.journal({ dream: begun.bundle.dream, session: "sess-dream", text: "A dream." });
}
