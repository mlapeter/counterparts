/**
 * The self tab, round 3b (2026-09-27, a try): the page's history as one strip
 * of lived days, the wake as a short list, its budget on the health tab, and
 * the self map. Hermetic: one fresh temp store, removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { healthView, mindView } from "../src/adapters/dashboard/web/views.js";
import { pageDayUnrecorded, pageDayWords, writerWords } from "../src/adapters/dashboard/web/views/mind.js";
import { MAP_MAX } from "../src/adapters/dashboard/web/views/self-map.js";
// @ts-expect-error — a plain browser module, no declarations
import { dayWords, stripSummary } from "../src/adapters/dashboard/web/pages/self/sections/page.js";
// @ts-expect-error — a plain browser module, no declarations
import { memoryItem, pageAge } from "../src/adapters/dashboard/web/pages/self/sections/wake.js";
// @ts-expect-error — a plain browser module, no declarations
import { MIN_APART, RING_WORDS, layout, nodeWords } from "../src/adapters/dashboard/web/pages/self/sections/map.js";
// @ts-expect-error — a plain browser module, no declarations
import { ruleWords } from "../src/adapters/dashboard/web/pages/self/sections/settling.js";
// @ts-expect-error — a plain browser module, no declarations
import { wakeLine } from "../src/adapters/dashboard/web/pages/health/sections/wake.js";

const PAGE_1 = "## Core\n\nStill forming.\n\n## Lately\n\n- Getting started.\n";
const PAGE_2 = "## Core\n\nI keep things plain.\n\n- Small steps.\n\n## Lately\n\n- Getting started.\n";

let at: string;
const ids: Record<string, string> = {};
const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];

function withSource<T>(fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir: at });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

beforeAll(() => {
  at = mkdtempSync(join(tmpdir(), "counterparts-self-r3b-"));
  const base = Date.parse("2026-09-01T15:00:00Z");
  let offset = 0;
  const now = (): number => base + offset;
  Counterpart.open({ dir: at, owner: true, identity: { name: "Mike" }, now }).close();
  const c = Counterpart.open({ dir: at, owner: true, budgetBytes: 9000, now });
  try {
    for (const [i, date] of dates.entries()) {
      offset = Date.parse(`${date}T15:00:00Z`) - base;
      c.store.advanceClock(date);
      const d = c.store.livedDay();
      if (i === 0) {
        const put = (body: string, kind: "self" | "fact", emotional: number): string =>
          c.store.put({
            type: "memory",
            kind,
            body,
            salience: { relevance: 0.6, emotional, predictive: 0.6 },
            physics: { birthDay: d, lastUsedDay: d },
            // v9: the core reads what a memory is about, marked by meaning.
            ...(kind === "self" ? { about: "me" as const } : {}),
          });
        ids["felt"] = put("I say what I don't know before I guess.", "self", 0.95);
        ids["mild"] = put("I like short sentences.", "self", 0.1);
        ids["fact"] = put("The deploy runs on push.", "fact", 0.95);
        ids["sentBack"] = put("I always know best.", "self", 0.95);
        c.store.appendCoreEvent({ memoryId: ids["sentBack"], action: "demoted", day: d, actor: "owner", reason: "not who I am" });
        // Linked both ways (one line), and to the fact, which is not drawn.
        c.store.link({ src: ids["felt"], dst: ids["mild"], weight: 0.4, day: d });
        c.store.link({ src: ids["mild"], dst: ids["felt"], weight: 0.6, day: d });
        c.store.link({ src: ids["felt"], dst: ids["fact"], weight: 0.9, day: d });
        c.recordPageWriterRun({ about: "2026-08-31", mode: "session", outcome: "revised" });
        c.revisePage(PAGE_1, { reason: "first", by: "writer", day: d });
      }
      if (i === 1) c.recordPageWriterRun({ about: "2026-09-01", mode: "session", outcome: "skipped", detail: "no-room" });
      if (i === 2) c.recordPageWriterRun({ about: "2026-09-02", mode: "session", outcome: "nothing-to-say" });
      if (i === 3) c.revisePage(PAGE_2, { reason: "by hand", by: "owner", day: d });
    }
    c.rebrief({ budgetBytes: 9000 });
    // What a published bundle's hints lane showed (v8's own record of it).
    c.store.recordHintDisplay(c.store.livedDay(), [{ id: ids["mild"] as string, load: 0 }]);
  } finally {
    c.close();
  }
});

afterAll(() => rmSync(at, { recursive: true, force: true }));

describe("the self tab, round 3b", () => {
  test("1: one strip entry per lived day; rewritten days carry their versions, the others say why", () => {
    const v = withSource((src) => mindView(src));
    expect(v.pageDays.map((x) => x.day)).toEqual([1, 2, 3, 4, 5]);
    expect(v.pageDays.map((x) => x.seqs.length > 0)).toEqual([true, false, false, true, false]);
    // A version is placed on the day it was WRITTEN, not the day it was replaced.
    expect(v.pageHistory.map((s) => s.day)).toEqual([1, 4]);
    const [d1, d2, d3, d4, d5] = v.pageDays;
    expect(d1?.by).toBe("writer");
    expect(d4?.by).toBe("owner");
    expect(d4?.reason).toBe("by hand");
    expect(d4?.seqs).toEqual([v.pageHistory[1]?.seq as number]);
    expect(d2?.why).toBe(pageDayWords(writerWords({ about: "2026-09-01", outcome: "skipped", derived: false, run: { detail: "no-room" } }, "")));
    expect(d2?.why).toMatch(/^Not rewritten — the session start had no room left to ask \(the old way\)\./);
    expect(d2?.more).toMatch(/runs inside the nightly run now/);
    expect(d3?.why).toBe("The page writer read the day and kept it as is.");
    expect(d5?.why).toBe(pageDayUnrecorded(d5?.today === true).why);
    expect(d5?.date).toBe("2026-09-05");
    expect(v.pageDaysUndated).toBe(0);
    expect(v.pageDaysEarlier).toBe(0);
  });

  test("1: the strip's words, as the page draws them", () => {
    const filled = { day: 4, date: "2026-09-04", today: false, seqs: [3], by: "owner", reason: "by hand", why: null };
    const hollow = { day: 2, date: "2026-09-02", today: false, seqs: [], by: null, reason: null, why: "Not rewritten — x." };
    expect(dayWords(filled)).toMatch(/^Sep 4th(, 2026)? · lived day 4 — rewritten by you, by hand: “by hand”$/);
    expect(dayWords(hollow)).toMatch(/^Sep 2nd(, 2026)? · lived day 2 — Not rewritten — x\.$/);
    expect(dayWords({ ...hollow, date: null })).toBe("Lived day 2 — Not rewritten — x.");
    expect(stripSummary([filled, hollow])).toMatch(/^Rewritten on 1 of 2 lived days · newest Sep 4th/);
    // 2026-09-30: every kind of reason a version carries, as a person would say it, no ids.
    const today = { ...filled, date: null, today: true, day: 9 };
    expect(dayWords({ ...today, seqs: [5, 6], by: "reflection", reason: "reflection rfl_06c7d252c3c7 after dream drm_5c16061f0f96" }))
      .toBe("Today · lived day 9 — rewritten twice, last by the reflection after today's dream.");
    expect(dayWords({ ...filled, by: "reflection", reason: "reflection rfl_06c7d252c3c7 after dream drm_5c16061f0f96" }))
      .toMatch(/— rewritten by the reflection after that night's dream\.$/);
    expect(dayWords({ ...filled, by: "reflection", reason: "reflection rfl_06c7d252c3c7" })).toMatch(/— rewritten by the reflection\.$/);
    expect(dayWords({ ...filled, seqs: [1, 2, 3], by: "owner", reason: "owner edit" })).toMatch(/— rewritten 3 times, last by you, by hand\.$/);
    expect(dayWords({ ...filled, by: "owner", reason: "restored version 4" })).toMatch(/— rewritten by you, putting an earlier version back\.$/);
    expect(dayWords({ ...filled, by: "writer", reason: "the day moved how I hold the castle game (mem_cb6eea7a6b9f)" }))
      .toMatch(/— rewritten by the page writer: “the day moved how I hold the castle game”$/);
    expect(dayWords({ ...filled, by: "session", reason: "folded in drm_5c16061f0f96, as asked" }))
      .toMatch(/— rewritten by a session: “folded in, as asked”$/);
    expect(dayWords({ ...filled, by: null, reason: null })).toMatch(/— rewritten by someone unrecorded\.$/);
    for (const r of ["reflection rfl_06c7d252c3c7 after dream drm_5c16061f0f96", "x mem_cb6eea7a6b9f y"]) {
      expect(dayWords({ ...filled, by: "session", reason: r })).not.toMatch(/[a-z]{2,6}_[0-9a-f]{6,}/);
    }
    expect(pageDayWords({ what: "rewrote it", next: null })).toBe("The page writer rewrote it.");
    expect(pageDayWords({ what: "nothing ran, and nothing says why", next: null })).toBe("Nothing ran, and nothing says why.");
  });

  test("2: the wake lists the page with its age, and the nearby memories by id", () => {
    const l = withSource((src) => mindView(src)).wakeList;
    expect(l.ok).toBe(true);
    expect(l.page?.writtenDay).toBe(4);
    expect(l.page?.livedDaysAgo).toBe(1);
    expect(l.nearby.map((m) => m.id)).toEqual([ids["mild"] as string]);
    expect(l.nearby[0]?.text).toBe("I like short sentences.");
    expect(l.nearbyLines).toEqual([]);
    expect(pageAge({ date: "2026-09-04", livedDaysAgo: 1, newerThanWake: false })).toMatch(/^written Sep 4th(, 2026)?, 1 lived day ago$/);
    expect(pageAge({ date: null, livedDaysAgo: 0, newerThanWake: true })).toBe("written today — rewritten since; the next wake carries the new one");
  });

  test("2 (2026-09-30): an arriving line is its memory, by title, opening its card — not its whole body", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-self-arriving-"));
    try {
      const c = Counterpart.open({ dir, owner: true, budgetBytes: 9000 });
      let titled: string;
      let bare: string;
      try {
        const salience = { novelty: null, relevance: 0.8, emotional: 0.8, predictive: 0.8 };
        titled = c.store.put({
          type: "memory", kind: "person", title: "Portland move",
          body: "The Portland move lands on the fourth and the truck is booked. (1) pack the kitchen (2) call the movers `move --confirm`.\n\nA second paragraph the wake never prints.",
          learnedOn: "2026-09-01", eventDate: "2026-10-04", salience,
        });
        bare = c.store.put({
          type: "memory", kind: "fact", body: "The dentist is at nine on the fourth. Bring the form.",
          learnedOn: "2026-09-01", eventDate: "2026-10-04", salience,
        });
        c.rebrief({ budgetBytes: 9000, at: "2026-10-04" });
      } finally {
        c.close();
      }
      const dash = Dashboard.open({ dir });
      let arriving;
      try {
        arriving = mindView(dash.source).wakeList.arriving;
      } finally {
        dash.close();
      }
      expect(arriving.map((a) => a.id).sort()).toEqual([titled, bare].sort());
      const move = arriving.find((a) => a.id === titled);
      expect(move?.title).toBe("Portland move");
      const html = arriving.map(memoryItem).join("");
      expect(html).toContain(`openMemory('${titled}')`);
      expect(html).toContain(">Portland move</button>");
      // No title: the first sentence stands in; the rest is on hover only.
      expect(html).toContain(">The dentist is at nine on the fourth.</button>");
      // A line no memory was found for is still listed, as its first sentence.
      expect(memoryItem({ id: null, text: "Something arrives. More words.", title: null, confidential: false }))
        .toBe('<li class="wk-line-i" title="Something arrives. More words.">Something arrives.</li>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("3: the health row says whether the wake fits, and what was trimmed when it did not", () => {
    const w = withSource((src) => healthView(src)).wake;
    expect(w.ok).toBe(true);
    expect(w.parts.reduce((a, p) => a + p.bytes, 0)).toBe(w.bytes);
    expect(wakeLine(w).tone).toBe("green");
    expect(wakeLine({ ...w, bytes: 4000, budget: 9000 }).line).toBe("The wake fits: 4.0 KB of 9.0 KB, 5.0 KB room left");
    const full = wakeLine({ ok: true, bytes: 8900, budget: 9000, parts: [], trimmed: 3, trimmedFrom: ["nearby memories"] });
    expect(full.tone).toBe("amber");
    expect(full.line).toBe("The wake is full: 8.9 KB of 9.0 KB, and the last render left out 3 lines (nearby memories) to fit");
    expect(wakeLine({ ok: false }).tone).toBe("grey");
  });

  test("4: the self map draws the memories about me or about us, read from the engine, and the links between them", () => {
    withSource((src) => {
      const v = mindView(src);
      const m = v.map;
      const drawn = m.nodes.map((n) => n.id);
      expect(drawn).toContain(ids["felt"] as string);
      expect(drawn).toContain(ids["mild"] as string);
      // Not about me (a fact), or sent back by the owner: not on the map.
      expect(drawn).not.toContain(ids["fact"] as string);
      expect(drawn).not.toContain(ids["sentBack"] as string);
      expect(m.nodes.length).toBeLessThanOrEqual(MAP_MAX);
      // The faint ring is the engine's verdict, the same one the counts use.
      expect(m.nodes.find((n) => n.id === ids["felt"])?.oneReturnAway).toBe(true);
      expect(m.nodes.find((n) => n.id === ids["mild"])?.oneReturnAway).toBe(false);
      for (const n of m.nodes) {
        const c = v.settling.candidates.find((x) => x.id === n.id);
        if (c !== undefined) expect(n.oneReturnAway).toBe(c.oneReturnAway);
        expect(n.strength).toBeGreaterThanOrEqual(0);
        expect(n.strength).toBeLessThanOrEqual(1);
      }
      // A pair stored both ways is one line, at the stronger weight; a link to
      // a memory that is not drawn is not drawn either.
      const [a, b] = [ids["felt"] as string, ids["mild"] as string].sort();
      expect(m.links).toEqual([{ a: a as string, b: b as string, weight: 0.6 }]);
    });
  });

  test("4: the map's `?` describes the map as drawn — its three named rings — not the old legend (2026-10-01)", () => {
    const s = withSource((src) => mindView(src).settling);
    const words = ruleWords(s) as string;
    for (const ring of Object.values(RING_WORDS as Record<string, string>)) expect(words).toContain(`“${ring}”`);
    expect(words).not.toContain("faint ring");
    expect(words).toContain("brighter the more firmly it is held");
  });

  test("4: the layout is fixed by the data — the core in the middle, closeness as distance", () => {
    const map = {
      nodes: [
        { id: "c1", core: true, closeness: 2, strength: 1 },
        { id: "c2", core: true, closeness: 2, strength: 1 },
        { id: "near", core: false, closeness: 1.8, strength: 0.5 },
        { id: "far", core: false, closeness: 0, strength: 0.1 },
      ],
      links: [{ a: "near", b: "far", weight: 0.5 }],
    };
    type L = { pos: Map<string, { x: number; y: number }>; cx: number; cy: number; R: number; rc: number };
    const x = layout(map, 500, 330) as L;
    const y = layout(map, 500, 330) as L;
    const dist = (l: L, id: string): number => {
      const p = l.pos.get(id) as { x: number; y: number };
      return Math.hypot(p.x - l.cx, p.y - l.cy);
    };
    for (const id of ["c1", "c2", "near", "far"]) expect(x.pos.get(id)).toEqual(y.pos.get(id) as { x: number; y: number });
    expect(dist(x, "c1")).toBeLessThan(x.rc);
    expect(dist(x, "near")).toBeLessThan(dist(x, "far"));
    expect(dist(x, "far")).toBeCloseTo(x.R, 5);
    expect(nodeWords({ core: true, strength: 0.5 })).toBe("who I am · held 50%");
    expect(nodeWords({ oneReturnAway: true, strength: 0.72 })).toBe("almost there: one more return and it can join · held 72%");
  });

  test("4: ready dots share the innermost ring but never sit on top of each other (2026-09-28)", () => {
    // The owner's map: six ready dots, all linked to the same core memories
    // and to each other, drawn as one overlapping clump beside the core.
    const nodes: { id: string; core: boolean; ready?: boolean; closeness: number; strength: number }[] = [];
    for (let i = 0; i < 4; i++) nodes.push({ id: `mem_core${i}`, core: true, closeness: 2, strength: 0.9 });
    for (let i = 0; i < 6; i++) nodes.push({ id: `mem_ready${i}`, core: false, ready: true, closeness: 2, strength: 0.7 });
    for (let i = 0; i < 30; i++) nodes.push({ id: `mem_o${i}`, core: false, closeness: (i % 10) / 5, strength: 0.4 });
    const links: { a: string; b: string; weight: number }[] = [];
    for (let i = 0; i < 6; i++) {
      links.push({ a: "mem_core0", b: `mem_ready${i}`, weight: 0.8 }, { a: "mem_core1", b: `mem_ready${i}`, weight: 0.5 });
      for (let j = i + 1; j < 6; j++) links.push({ a: `mem_ready${i}`, b: `mem_ready${j}`, weight: 0.6 });
    }
    for (let i = 0; i < 30; i++) links.push({ a: `mem_o${i}`, b: `mem_ready${i % 6}`, weight: 0.3 });
    type P = { x: number; y: number; r: number };
    type L = { pos: Map<string, P>; cx: number; cy: number; rA: number };
    for (const [w, h] of [[700, 380], [360, 342]] as const) {
      const x = layout({ nodes, links }, w, h) as L;
      const again = layout({ nodes, links }, w, h) as L;
      const drawn = nodes.filter((n) => !n.core).map((n) => ({ id: n.id, p: x.pos.get(n.id) as P }));
      for (const d of drawn) expect(again.pos.get(d.id)).toEqual(d.p);
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const a = drawn[i]!.p, b = drawn[j]!.p;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(MIN_APART - 0.5);
        }
      }
      // Still on their ring ("almost there", round 4): only the angle moved.
      for (const d of drawn.filter((n) => n.id.startsWith("mem_ready"))) {
        expect(Math.hypot(d.p.x - x.cx, d.p.y - x.cy)).toBeCloseTo(x.rA, 5);
      }
    }
  });
});
