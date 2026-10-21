/**
 * SETTLED-OVER MEMORIES ARE MARKED WHERE THEIR TITLES SHOW (2026-10-11).
 *
 * On 10-11 a `session_end` result's neighbour list showed a memory a later
 * one had settled `changed` over by its bare title, and the session repeated
 * the rule it replaced. `recall/standing.ts#headOf` resolves a memory to the
 * one that holds now; `earlierMark` is the one mark. Every surface that shows
 * a memory by its own path carries it: a write's neighbours, the dream's and
 * the reflection's bundles; the dream's "coming up" leaves it out the way the
 * wake's Arriving does. The ambient render (footnotes, "Came to mind") already
 * carries `standingOf`'s label, pinned here too.
 *
 * Hermetic: a fresh temp data dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { settle, writeNeighbours } from "../src/core/reconsolidation.js";
import { Counterpart, MCP_OVERSIZE_EVENT } from "../src/core/counterpart.js";
import { onMyMind } from "../src/core/dream/mind.js";
import { TOOL_RESULT_CEILING, wireChars } from "../src/core/fit/index.js";
import { HEAD_MAX_STEPS, Recall, earlierMark, headOf, standingOf } from "../src/core/recall/index.js";
import { settledOver } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

const SESSION = "sess_settled_marks";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-settled-marks-"));
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

function server(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/one", ...opts });
  open.push(s.counterpart);
  return s;
}

function aged(store: Store): void {
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) store.advanceClock(d);
}

function put(store: Store, body: string, extra: Partial<PutInput> = {}): string {
  const day = store.livedDay();
  return store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...extra,
  });
}

function changed(store: Store, holds: string, over: string): void {
  expect(settle(store, { holds, over, how: "changed", actor: "session", why: "settled in a test" }).ok).toBe(true);
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

// The 10-11 shape: a sidebar rule, changed by a later memory, and a new write
// close in words to the OLD one that names nothing in `updates`.
const OLD_RULE = "The MOD sidebar rule: the transcript pane always opens on the left, full height, never collapsed.";
const NEW_RULE = "Mike moved it: panels dock right now, folded shut until clicked.";
const CLOSE_TO_OLD = "The MOD sidebar transcript pane opens on the left, full height, and is never collapsed by default.";

describe("headOf: the memory that holds now", () => {
  test("changed and corrected point at the holder; a chain at its live end; a replaced row at its successor", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    const a = put(s, "The bakery opens at eight on weekdays.");
    const b = put(s, "The bakery opens at seven on weekdays from October.");
    const c = put(s, "The bakery opens at half past six on weekdays from November.");
    expect(headOf(s, a)).toBeNull();
    changed(s, b, a);
    expect(headOf(s, a)).toBe(b);
    expect(headOf(s, b)).toBeNull();
    changed(s, c, b);
    expect(headOf(s, a)).toBe(c);
    expect(headOf(s, b)).toBe(c);
    // The holder gone with no successor: B is the end again, and A points at it.
    s.archive(c, "removed-by-test");
    expect(headOf(s, b)).toBeNull();
    expect(headOf(s, a)).toBe(b);

    const wrong = put(s, "The build takes eight minutes on the old runners.");
    const right = put(s, "The build takes eleven minutes on the old runners.");
    expect(settle(s, { holds: right, over: wrong, how: "corrected", actor: "session", why: "misread" }).ok).toBe(true);
    expect(headOf(s, wrong)).toBe(right);

    const wifi = put(s, "The office wifi is called Harbor.");
    const next = s.supersede(wifi, { type: "memory", kind: "fact", body: "The office wifi is called Lighthouse." });
    expect(headOf(s, wifi)).toBe(next);
    expect(earlierMark(next)).toBe(`earlier (now ${next})`);
  });

  test("agrees with the wake's settledOver: a later hold does not lift it, a gone holder hides nothing, open settles nothing", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    const p = put(s, "The ovens are cleaned on Sunday evening.");
    const q = put(s, "The ovens are cleaned on Saturday evening.");
    const r = put(s, "The ovens are cleaned whenever the week is quiet.");
    changed(s, q, p);
    changed(s, p, r);
    const x = put(s, "The delivery van goes out on Tuesdays and Fridays.");
    const y = put(s, "The delivery van goes out on Mondays only.");
    changed(s, y, x);
    s.archive(y, "removed-by-test");
    const t = put(s, "Tabs are the right indentation here.");
    const u = put(s, "Spaces are the right indentation here.");
    expect(settle(s, { holds: u, over: t, how: "open", actor: "owner" }).ok).toBe(true);
    const over = settledOver(s);
    for (const id of [p, q, r, x, y, t, u]) {
      if (s.row(id)?.archived === 1) continue;
      expect(headOf(s, id) !== null).toBe(over.has(id));
    }
    // A settle speaks only about the pair it names (Group 3 part B): p stays under q, and r with it.
    expect(headOf(s, p)).toBe(q);
    expect(headOf(s, r)).toBe(q);
  });
});

describe("a write's neighbours", () => {
  test("the 10-11 shape: a neighbour settled `changed` by a newer memory is never listed bare", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    const old = put(s, OLD_RULE);
    const head = put(s, NEW_RULE);
    changed(s, head, old);
    const id = put(s, CLOSE_TO_OLD);
    const got = writeNeighbours(s, { id });
    const listed = got.find((n) => n.id === old);
    expect(listed).toBeDefined();
    expect(listed?.standing).toBe(earlierMark(head));
    // The mark comes before the title when the result is serialized.
    const wire = JSON.stringify(listed);
    expect(wire.indexOf('"standing"')).toBeLessThan(wire.indexOf('"title"'));
    // A neighbour that still stands carries no mark.
    for (const n of got) if (n.id !== old) expect(n.standing).toBeUndefined();
  });

  test("left out when what holds now is already in view", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    const old = put(s, OLD_RULE);
    // The retired confidential mark (2026-10-21) on the holder changes nothing.
    const head = put(s, NEW_RULE, { meta: { confidential: true } });
    changed(s, head, old);
    const id = put(s, CLOSE_TO_OLD);
    expect(writeNeighbours(s, { id }).find((n) => n.id === old)?.standing).toBe(earlierMark(head));
    // The holder is the write's own sibling (or what it updates): nothing to point at that is not already here.
    expect(writeNeighbours(s, { id, exclude: [head] }).map((n) => n.id)).not.toContain(old);
  });

  test("remember: the result's neighbours mark it", async () => {
    const srv = server();
    const store = srv.counterpart.store;
    aged(store);
    const old = put(store, OLD_RULE);
    const head = put(store, NEW_RULE);
    changed(store, head, old);
    const body = payload(await srv.call("remember", { text: CLOSE_TO_OLD }));
    const neighbours = body["neighbours"] as Record<string, unknown>[];
    const listed = neighbours.find((n) => n["id"] === old);
    expect(listed?.["standing"]).toBe(earlierMark(head));
  });

  test("session_end: each entry's neighbours mark it; an entry that settles it there and then leaves it off the next", async () => {
    const srv = server();
    const store = srv.counterpart.store;
    aged(store);
    const old = put(store, OLD_RULE);
    const head = put(store, NEW_RULE);
    changed(store, head, old);
    const r = payload(await srv.call("session_end", { session: SESSION, memories: [{ content: CLOSE_TO_OLD }] }));
    const outcomes = r["outcomes"] as Record<string, unknown>[];
    const listed = ((outcomes[0]?.["neighbours"] ?? []) as Record<string, unknown>[]).find((n) => n["id"] === old);
    expect(listed?.["standing"]).toBe(earlierMark(head));

    // A fresh old rule, changed by the dump's FIRST entry: the second entry's
    // neighbours do not list it, because what holds now is the sibling.
    const other = put(store, "The MOD footer rule: the status strip sits at the top of the pane, always visible.");
    const r2 = payload(
      await srv.call("session_end", {
        session: SESSION,
        memories: [
          { content: "The status strip moved: it sits under the composer now and hides when idle.", updates: other, how: "changed" },
          { content: "The MOD footer status strip sits at the top of the pane and is always visible there." },
        ],
      }),
    );
    const o2 = r2["outcomes"] as Record<string, unknown>[];
    expect((o2[0]?.["settled"] as Record<string, unknown>)["how"]).toBe("changed");
    const second = ((o2[1]?.["neighbours"] ?? []) as Record<string, unknown>[]).map((n) => n["id"]);
    expect(second).not.toContain(other);
    // And it WOULD have been listed but for the sibling (review of #408): the
    // same second write, its neighbours read with nothing excluded, lists the
    // old rule, marked with the first entry — so the drop above is the
    // sibling rule, not a neighbour that was never close.
    const firstId = o2[0]?.["id"] as string;
    const secondId = o2[1]?.["id"] as string;
    expect(typeof firstId).toBe("string");
    expect(typeof secondId).toBe("string");
    const unexcluded = writeNeighbours(store, { id: secondId });
    expect(unexcluded.find((n) => n.id === other)?.standing).toBe(earlierMark(firstId));
    expect(writeNeighbours(store, { id: secondId, exclude: [firstId] }).map((n) => n.id)).not.toContain(other);
  });
});

describe("ambient recall (already labelled by standingOf)", () => {
  // Group 2 (2026-10-11): the head wins ambient recall, so a settled-over
  // memory the turn reaches is shown as its head, whose label names it. The
  // "Earlier (now …)" prefix is what it carries where it still shows (the
  // label is `standingOf`'s, pinned below and in the chain test).
  test("a memory settled over that the turn reaches is shown as its head, which names it", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
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
      put(s, body);
    }
    const old = put(s, "The zygomorphic orchid needs watering twice a week.", { title: "Zygomorphic orchid watering" });
    const head = put(s, "The zygomorphic orchid needs watering once a week in autumn.", { title: "Orchid watering in autumn" });
    changed(s, head, old);
    const text = new Recall({ store: s }).build({ sessionId: "r1", text: "how often should the zygomorphic orchid get watering" }).injection;
    const lines = text.split("\n").filter((l) => l.includes(`watering [${old}]`) || l.includes("twice a week"));
    expect(lines).toEqual([]);
    expect(text).toContain(`[${head}]`);
    expect(text).toContain(`(earlier: [${old}])`);
    expect(standingOf(s, old)?.prefix).toBe(`Earlier (now [${head}]): `);
  });
});

describe("the dream and the reflection", () => {
  function brain(): Counterpart {
    const c = Counterpart.open({ dir, identity: { name: "Mike" } });
    open.push(c);
    return c;
  }

  function lived(c: Counterpart): { old: string; head: string } {
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    const mk = (body: string): string =>
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.7, emotional: 0.5, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
    const old = mk(OLD_RULE);
    const head = mk(NEW_RULE);
    mk("The deploy script needs the migration step before the container starts.");
    changed(c.store, head, old);
    return { old, head };
  }

  test("the dream's bundle marks a memory a later one settled over, before its words", () => {
    const c = brain();
    const { old, head } = lived(c);
    const out = c.dreams.begin({ session: SESSION, scope: "/proj" });
    if (!out.ok) throw new Error(out.reason);
    const item = out.bundle.memories[old];
    expect(item).toBeDefined();
    expect(item?.standing).toBe(earlierMark(head));
    expect(out.bundle.memories[head]?.standing).toBeUndefined();
    const wire = JSON.stringify(item);
    expect(wire.indexOf('"standing"')).toBeLessThan(wire.indexOf('"text"'));
  });

  test("the reflection's bundle marks it too", () => {
    const c = brain();
    const { old, head } = lived(c);
    const out = c.reflections.begin({ session: SESSION, scope: "/proj" });
    if (!out.ok) throw new Error(out.reason);
    const item = out.bundle.memories[old];
    expect(item).toBeDefined();
    expect(item?.standing).toBe(earlierMark(head));
    expect(out.bundle.memories[head]?.standing).toBeUndefined();
  });

  test("what's on my mind: a dated memory a later one settled over is not coming up", () => {
    const s = Store.open({ dir });
    open.push(s);
    s.advanceClock("2026-09-10");
    const day = s.livedDay();
    const at = { physics: { birthDay: day, lastUsedDay: day } };
    const old = put(s, "The dentist appointment is on September 12th at nine.", { ...at, eventDate: "2026-09-12" });
    const head = put(s, "The dentist appointment moved to September 13th at ten.", { ...at, eventDate: "2026-09-13" });
    const input = { today: "2026-09-10", day, showable: () => true };
    const before = onMyMind(s, input).flatMap((m) => m.ids);
    expect(before).toContain(old);
    changed(s, head, old);
    const after = onMyMind(s, input).flatMap((m) => m.ids);
    expect(after).not.toContain(old);
    expect(after).toContain(head);
  });
});

// ── review of #408 ───────────────────────────────────────────────────────────

const FILLER = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
];

describe("review of #408: footnotes and neighbours name the same memory", () => {
  test("on a chain A→B→C the footnote, the question path's note and the neighbour all say C", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    for (const body of FILLER) put(s, body);
    const a = put(s, "The zygomorphic orchid needs watering twice a week.", { title: "Zygomorphic orchid watering" });
    const b = put(s, "The zygomorphic orchid needs watering once a week in autumn.", { title: "Orchid watering in autumn" });
    const c = put(s, "The zygomorphic orchid needs watering every ten days in winter.", { title: "Orchid watering in winter" });
    changed(s, b, a);
    changed(s, c, b);
    expect(headOf(s, a)).toBe(c);
    expect(standingOf(s, a)?.prefix).toBe(`Earlier (now [${c}]): `);
    expect(standingOf(s, a)?.note).toBe(`earlier — now ${c}`);
    expect(standingOf(s, b)?.prefix).toBe(`Earlier (now [${c}]): `);
    // B still says what it was over, after: the chain's history is not lost.
    expect(standingOf(s, b)?.suffix).toBe(` (earlier: [${a}])`);
    expect(standingOf(s, c)?.prefix).toBe("");
    // Ambient recall (Group 2, 2026-10-11): the head wins — A and B are not
    // shown at all, C is.
    const text = new Recall({ store: s }).build({ sessionId: "r1", text: "how often should the zygomorphic orchid get watering" }).injection;
    const linesOfA = text.split("\n").filter((l) => l.includes("twice a week") || l.includes("Zygomorphic orchid watering"));
    expect(linesOfA).toEqual([]);
    expect(text).toContain(`[${c}]`);
    expect(text).not.toContain(`[${b}]:`);
    const w = put(s, "The zygomorphic orchid needs watering twice a week, they said at the shop.");
    const n = writeNeighbours(s, { id: w, limit: 10 }).find((x) => x.id === a);
    expect(n?.standing).toBe(earlierMark(c));
  });

  test("a newer pair in which it holds keeps the Earlier label; its holder gone with nothing after: no Earlier label", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    const p = put(s, "The ovens are cleaned on Sunday evening.");
    const q = put(s, "The ovens are cleaned on Saturday evening.");
    changed(s, q, p);
    expect(standingOf(s, p)?.prefix).toBe(`Earlier (now [${q}]): `);
    // A newer pair names P as what holds over R: it speaks about P and R only
    // (Group 3 part B; random-06 — #408 read it as re-affirming P).
    const r = put(s, "The ovens are cleaned whenever the week is quiet.");
    changed(s, p, r);
    expect(headOf(s, p)).toBe(q);
    expect(settledOver(s).has(p)).toBe(true);
    expect(standingOf(s, p)?.prefix).toBe(`Earlier (now [${q}]): `);
    expect(standingOf(s, p)?.suffix).toContain(`earlier: [${r}]`);
    expect(standingOf(s, r)?.prefix).toBe(`Earlier (now [${q}]): `);

    const x = put(s, "The delivery van goes out on Tuesdays and Fridays.");
    const y = put(s, "The delivery van goes out on Mondays only.");
    changed(s, y, x);
    s.archive(y, "removed-by-test");
    expect(headOf(s, x)).toBeNull();
    expect(settledOver(s).has(x)).toBe(false);
    expect(standingOf(s, x)?.prefix ?? "").not.toContain("Earlier");
  });
});

describe("review of #408: a corrected memory is never shown as current", () => {
  test("not a neighbour, not in the dream's or the reflection's bundle, not coming up; by id it says Corrected by", () => {
    const c = Counterpart.open({ dir, identity: { name: "Mike" } });
    open.push(c);
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    const mk = (body: string, extra: Partial<PutInput> = {}): string =>
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.7, emotional: 0.5, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...extra });
    const wrong = mk(OLD_RULE, { eventDate: "2026-09-22" });
    const right = mk(NEW_RULE, { eventDate: "2026-09-23" });
    mk("The deploy script needs the migration step before the container starts.");
    expect(settle(c.store, { holds: right, over: wrong, how: "corrected", actor: "session", why: "misread" }).ok).toBe(true);
    expect(c.store.row(wrong)?.archived).toBe(1);
    const w = mk(CLOSE_TO_OLD);
    expect(writeNeighbours(c.store, { id: w, limit: 10 }).map((n) => n.id)).not.toContain(wrong);
    const d = c.dreams.begin({ session: SESSION, scope: "/proj" });
    if (!d.ok) throw new Error(d.reason);
    expect(Object.keys(d.bundle.memories)).not.toContain(wrong);
    expect(JSON.stringify(d.bundle)).not.toContain(wrong);
    const r = c.reflections.begin({ session: SESSION, scope: "/proj" });
    if (!r.ok) throw new Error(r.reason);
    expect(Object.keys(r.bundle.memories)).not.toContain(wrong);
    const mind = onMyMind(c.store, { today: "2026-09-20", day, showable: () => true }).flatMap((m) => m.ids);
    expect(mind).not.toContain(wrong);
    expect(standingOf(c.store, wrong, { byId: true })?.prefix).toContain(`Corrected by [${right}]`);
  });
});

describe("review of #408: headOf's walk is bounded and never throws", () => {
  interface FakeRow {
    id: string;
    archived: number;
    superseded_by: string | null;
    body: string;
    content_hash: string;
  }
  function fake(rows: FakeRow[], pairs: { over: string; holds: string; at: number }[] = [], opts: { throws?: boolean } = {}): Store {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const cr = pairs.map((p, i) => ({
      id: `pair_${String(i)}`,
      a: p.over,
      b: p.holds,
      state: "settled",
      how: "changed",
      holds: p.holds,
      over: p.over,
      via: null,
      created_at: p.at,
      updated_at: p.at,
    }));
    return {
      row: (id: string) => {
        if (opts.throws === true) throw new Error("database is locked");
        return byId.get(id);
      },
      // Newest first, as the store reads them.
      contradictionsOf: (ids: readonly string[]) => {
        const out = new Map<string, unknown[]>();
        for (const id of ids) {
          const got = cr.filter((p) => p.a === id || p.b === id).reverse();
          if (got.length > 0) out.set(id, got);
        }
        return out;
      },
      contradictions: () => [...cr].reverse(),
    } as unknown as Store;
  }
  const live = (id: string): FakeRow => ({ id, archived: 0, superseded_by: null, body: "words", content_hash: "h" });
  const gone = (id: string, next: string | null): FakeRow => ({ id, archived: 0, superseded_by: next, body: "words", content_hash: "h" });

  test("a cycle of replaced rows ends; a 10,000-long replaced chain stops at the bound; a store that throws settled nothing", () => {
    expect(headOf(fake([gone("m_a", "m_b"), gone("m_b", "m_c"), gone("m_c", "m_a")]), "m_a")).toBeNull();
    const rows: FakeRow[] = [];
    for (let i = 0; i < 10_000; i += 1) rows.push(gone(`m_${String(i)}`, `m_${String(i + 1)}`));
    rows.push(live("m_10000"));
    const long = fake(rows);
    const t0 = performance.now();
    expect(() => headOf(long, "m_0")).not.toThrow();
    expect(performance.now() - t0).toBeLessThan(200);
    expect(headOf(fake([live("m_x")], [], { throws: true }), "m_x")).toBeNull();
    // A pure settle chain past the bound (80 links): still earlier, as the wake
    // says — the mark names the link the walk stopped at, not the live end.
    const chain = Array.from({ length: 81 }, (_, i) => live(`m_c${String(i)}`));
    const settles = Array.from({ length: 80 }, (_, i) => ({ over: `m_c${String(i)}`, holds: `m_c${String(i + 1)}`, at: i + 1 }));
    const pure = fake(chain, settles);
    expect(headOf(pure, "m_c0")).toBe(`m_c${String(HEAD_MAX_STEPS)}`);
    expect(settledOver(pure).has("m_c0")).toBe(true);
    expect(headOf(pure, "m_c40")).toBe("m_c80");
    // A settle cycle tied on the clock: the newest pair speaks, and it ends.
    const tie = fake([live("m_p"), live("m_q")], [
      { over: "m_p", holds: "m_q", at: 5 },
      { over: "m_q", holds: "m_p", at: 5 },
    ]);
    expect(() => headOf(tie, "m_p")).not.toThrow();
    expect(headOf(tie, "m_p") !== null).toBe(settledOver(tie).has("m_p"));
    expect(headOf(tie, "m_q") !== null).toBe(settledOver(tie).has("m_q"));
  });

  test("a 60-link chain of real settles, a replaced row in its middle: headOf agrees with the wake's settledOver on every link", () => {
    const s = Store.open({ dir });
    open.push(s);
    aged(s);
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) ids.push(put(s, `The standup moved again, version ${String(i)} of the time.`));
    for (let i = 1; i < 60; i += 1) changed(s, ids[i] as string, ids[i - 1] as string);
    const mid = ids[30] as string;
    const after = s.supersede(mid, { type: "memory", kind: "fact", body: "The standup moved again, version 30 of the time, reworded." });
    const over = settledOver(s);
    for (const id of [...ids, after]) {
      if (id === mid) continue;
      expect(headOf(s, id) !== null).toBe(over.has(id));
    }
    expect(headOf(s, ids[58] as string)).toBe(ids[59] as string);
    expect(headOf(s, ids[59] as string)).toBeNull();
  });
});

describe("review of #408: the marks stay inside each result's ceiling", () => {
  test("a busy night where nearly every memory was settled over: dream and reflection parts all under the ceiling, no cut", async () => {
    const c = Counterpart.open({ dir, identity: { name: "Mike" } });
    open.push(c);
    c.store.advanceClock("2026-09-10");
    const said = '"said" "so" "plainly" '.repeat(20);
    const mk = (body: string): string => {
      const day = c.store.livedDay();
      return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
    };
    const ids: string[] = [];
    for (let i = 0; i < 120; i += 1) ids.push(mk(`Older memory ${String(i)} of a busy week: ${said}`));
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    for (let i = 0; i < 90; i += 1) ids.push(mk(`Memory ${String(i)} of a busy day: ${said}`));
    // Each memory changed by the next: all but the last carry the mark.
    for (let i = 1; i < ids.length; i += 1) changed(c.store, ids[i] as string, ids[i - 1] as string);
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
    const s = new McpServer({ counterpart: c, scope: "/proj", registryDir: dir });
    const fits = (res: ToolResult): void => {
      expect(res.isError ?? false).toBe(false);
      expect(wireChars(JSON.stringify(res.structuredContent))).toBeLessThanOrEqual(TOOL_RESULT_CEILING.CHARS);
      expect(res.structuredContent["cut"]).toBeUndefined();
    };
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    fits(begin);
    expect(JSON.stringify(begin.structuredContent)).toContain("earlier (now ");
    const dreamId = begin.structuredContent["dream"] as string;
    const of = (begin.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1;
    for (let k = 2; k <= of; k += 1) fits(await s.call("dream", { phase: "part", session: SESSION, dream: dreamId, part: k }));
    await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "A dream, read whole." });
    const r = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
    fits(r);
    const rid = r.structuredContent["reflection"] as string;
    const rof = (r.structuredContent["parts"] as { of: number } | undefined)?.of ?? 1;
    for (let k = 2; k <= rof; k += 1) fits(await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: k }));
    expect(c.store.eventLog({ name: MCP_OVERSIZE_EVENT, limit: 100 })).toEqual([]);
  }, 90_000);
});
