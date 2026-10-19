/**
 * REVIEW OF #420 (Group 2, 2026-10-11): the edges the review found.
 *
 *   - Every waiting slot proposal comes round: the dream's "to confirm" is the
 *     least shown first, so a dream that passes some by does not starve the rest.
 *   - A proposal one of whose memories is gone is withdrawn before the dream
 *     reads, its cut put back — nothing else could ever answer it.
 *   - A dump's earlier entries are never read as an earlier state of a later one.
 *   - A merge's feelings, each at its original's moment, weigh by their
 *     strongest; only a feeling recorded LATER (a feeling-now, a dream's, a
 *     reflection's) is read as how the memory sits now.
 *   - The head wins AMBIENT recall only: the deliberate paths still show an
 *     earlier version, marked.
 *
 * Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { mindRanked, noteMindShown } from "../src/core/dream/mind.js";
import { Recall, headOf } from "../src/core/recall/index.js";
import { CONTRADICTION_TUNABLES, SLOT_SOURCE, releaseOrphanSlots, slotsToConfirm } from "../src/core/reconsolidation.js";
import { Store } from "../src/core/store/index.js";
import type { Embedder } from "../src/core/store/index.js";
import { LEGACY_SLOT_FADE, useSlotFade } from "./slot-fade-fixture.js";

const SESSION = "sess_review_420";
const T = CONTRADICTION_TUNABLES;
// The provisional cut's arithmetic, at the cut a revert restores (flag only since 2026-10-19).
useSlotFade(LEGACY_SLOT_FADE);

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-review-420-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** One dimension per topic word: two texts on one topic read as one (cos 1). */
const TOPICS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
const embed: Embedder = (text: string): number[] | null => {
  const v = new Array<number>(TOPICS.length + 1).fill(0);
  v[TOPICS.length] = 0.05;
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    const d = TOPICS.indexOf(w);
    if (d >= 0) v[d] = (v[d] ?? 0) + 1;
  }
  return v;
};

function server(): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", owner: true, embed });
  open.push(s.counterpart);
  return s;
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

function aged(store: Store): void {
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
}

async function remember(s: McpServer, text: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return payload(await s.call("remember", { text, ...extra }));
}

function fade(store: Store, id: string): number {
  return Math.round((store.row(id)?.fade ?? 1) * 1e9) / 1e9;
}

/** An older memory and its newer state: the proposal between them. */
async function proposal(s: McpServer, topic: string): Promise<{ older: string; newer: string; pair: string }> {
  const older = String((await remember(s, `The ${topic} status is one.`))["id"]);
  const r = await remember(s, `The ${topic} status is two now.`);
  const slot = r["slot"] as { pair: string; over: string } | undefined;
  expect(slot?.over).toBe(older);
  return { older, newer: String(r["id"]), pair: String(slot?.pair) };
}

test("to confirm: the least shown first, so a dream that passes them by does not starve the rest", async () => {
  const s = server();
  const store = s.counterpart.store;
  aged(store);
  const pairs: string[] = [];
  for (const topic of TOPICS.slice(0, 6)) pairs.push((await proposal(s, topic)).pair);
  const seen = new Map<string, number>();
  for (let night = 0; night < 3; night += 1) {
    const day = store.livedDay();
    const read = mindRanked(store, { today: store.today(), day, showable: () => true, owner: true, slots: true });
    const confirm = read.items.filter((i) => i.kind === "to-confirm");
    expect(confirm).toHaveLength(T.SLOT_PER_NIGHT);
    expect(read.slotsMore).toBe(6 - T.SLOT_PER_NIGHT);
    for (const item of confirm) seen.set(String(item.pair), (seen.get(String(item.pair)) ?? 0) + 1);
    // The dream answers none of them.
    noteMindShown(store, read.items, day);
    store.advanceClock(`2026-09-${String(5 + night).padStart(2, "0")}`);
  }
  // Twelve showings over six proposals: each came round twice, none starved.
  expect(pairs.map((p) => seen.get(p) ?? 0)).toEqual([2, 2, 2, 2, 2, 2]);
  // And nothing expired: all six still wait, each older still provisionally cut.
  expect(slotsToConfirm(store, 100).pairs).toHaveLength(6);
});

test("a proposal whose newer memory is gone is withdrawn before the dream, its cut put back exactly", async () => {
  const s = server();
  const store = s.counterpart.store;
  aged(store);
  const gone = await proposal(s, "alpha");
  const kept = await proposal(s, "bravo");
  expect(fade(store, gone.older)).toBe(T.SLOT_FADE);
  store.archive(gone.newer, "forgotten");
  // Never shown to confirm: one of the two is gone.
  expect(slotsToConfirm(store, 100).pairs.map((p) => p.pair)).toEqual([kept.pair]);
  expect(releaseOrphanSlots(store)).toBe(1);
  expect(store.contradiction(gone.pair)?.state).toBe("withdrawn");
  expect(fade(store, gone.older)).toBe(1);
  // The standing one is untouched; a second pass does nothing.
  expect(store.contradiction(kept.pair)?.state).toBe("unsettled");
  expect(fade(store, kept.older)).toBe(T.SLOT_FADE);
  expect(releaseOrphanSlots(store)).toBe(0);
});

test("the dream's own bundle releases it: begin withdraws a proposal nobody can answer", async () => {
  const s = server();
  const store = s.counterpart.store;
  aged(store);
  const gone = await proposal(s, "charlie");
  store.archive(gone.newer, "forgotten");
  const begun = s.counterpart.dreams.begin({ session: SESSION });
  expect(begun.ok).toBe(true);
  expect(store.contradiction(gone.pair)?.state).toBe("withdrawn");
  expect(fade(store, gone.older)).toBe(1);
});

test("a dump's earlier entry is not read as an earlier state of a later one", async () => {
  const s = server();
  const store = s.counterpart.store;
  aged(store);
  const r = payload(
    await s.call("session_end", {
      session: SESSION,
      memories: [{ content: "The delta plan is set for Friday." }, { content: "The delta plan is set for Friday, with notes." }],
    }),
  );
  const outcomes = r["outcomes"] as Record<string, unknown>[];
  expect(outcomes.map((o) => o["slot"] ?? null)).toEqual([null, null]);
  expect(store.contradictions({ state: "unsettled" }).filter((c) => c.source === SLOT_SOURCE)).toHaveLength(0);
  // A later call in the same session still is.
  const later = await remember(s, "The delta plan is set for Saturday now.");
  expect(later["slot"]).toBeDefined();
});

test("the head wins ambient recall only: by handle, by facts and by meaning the earlier version still shows, marked", async () => {
  const s = server();
  const store = s.counterpart.store;
  aged(store);
  for (const body of [
    "Ran the morning loop around the reservoir before breakfast.",
    "The tax filing deadline moved to October this year.",
    "Prefers dense espresso over filter coffee at home.",
    "The garage door opener needs a new battery soon.",
    "Rebasing keeps the history readable for reviewers.",
    "The neighbour's cat sits on the fence every evening.",
    "Bought hiking boots that finally fit properly.",
    "The library closes early on Sundays now.",
  ]) {
    await remember(s, body);
  }
  const old = String((await remember(s, "The zygomorphic orchid needs watering twice a week.", { title: "Zygomorphic orchid watering" }))["id"]);
  const head = String(
    (await remember(s, "The zygomorphic orchid needs watering once a week in autumn.", { title: "Orchid watering in autumn", updates: old, how: "changed" }))["id"],
  );
  expect(headOf(store, old)).toBe(head);
  // Ambient: the earlier is not shown by its own words.
  const ambient = new Recall({ store, owner: true }).build({ sessionId: "r-ambient", text: "how often should the zygomorphic orchid get watering" }).injection;
  expect(ambient).not.toContain("twice a week");
  // By handle: that memory, marked.
  const byId = payload(await s.call("recall", { handle: old }));
  const memories = byId["memories"] as Record<string, unknown>[];
  expect(memories[0]?.["id"]).toBe(old);
  expect(String(memories[0]?.["standing"])).toContain(`earlier — now ${head}`);
  // Facts mode: folded under its head, listed as its earlier version.
  const facts = String(payload(await s.call("recall", { question: "zygomorphic orchid watering", mode: "facts" }))["answer"]);
  expect(facts).toContain(head);
  expect(facts).toContain(old);
  // Meaning mode: not filtered.
  const meaning = JSON.stringify(payload(await s.call("recall", { question: "how often does the zygomorphic orchid need watering", mode: "meaning" })));
  expect(meaning).toContain(old);
});

test("a merge's feelings weigh by their strongest; a later recording is how it sits now", () => {
  let clock = Date.UTC(2026, 8, 1, 12);
  const store = Store.open({ dir, now: () => clock });
  open.push(store);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) store.advanceClock(d);
  const day = store.livedDay();
  const id = store.put({ type: "memory", kind: "person", body: "Ada keeps a sketchbook of the river otters she sees.", salience: { relevance: 0.6, emotional: 0, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
  // What a dream's merge does: each original's feelings, at their own moments —
  // a strongly felt older original, a mildly felt newer one.
  const t1 = clock - 5 * 86_400_000;
  const t2 = clock - 86_400_000;
  store.addFeelings(
    id,
    [
      { whose: "owner", core: "happy", emotion: "delighted", strength: 0.8 },
      { whose: "owner", core: "calm", emotion: "content", strength: 0.2 },
    ],
    { provenance: [{ source: "session", createdAt: t1 }, { source: "session", createdAt: t2 }] },
  );
  expect(store.row(id)?.feeling_peak).toBe(0.8);
  // Later, a reflection records how it sits now: that is what it weighs.
  clock += 86_400_000;
  store.addFeelings(id, [{ whose: "self", core: "calm", emotion: "steady", strength: 0.3 }], { source: "reflection" });
  expect(store.row(id)?.feeling_peak).toBe(0.3);
  expect(store.row(id)?.feeling_peak_lived).toBe(0.8);
});
