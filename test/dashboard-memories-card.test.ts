/**
 * The memories tab, round 3 (2026-09-27, a try, not a rule): the memory card's
 * road to the core names the fast lane when it applies (M1); the curve starts
 * at "written" until there is a real use (M2); a journal chapter and the
 * memory drawn from it are one answer to Ask (M3; folded by facts mode itself
 * since 2026-10-09); a dream's near-copy merges say what they were (M4).
 *
 * The card's words are pure browser modules (`shared/memory-card-words.js`,
 * and Ask's rows in `pages/memories/sections/search.js`), imported here
 * directly — `diff.js` in `dashboard-self.test.ts` is the precedent.
 *
 * Hermetic: a fresh temp store seeded through `tools/demo`, the extra states
 * written through the store's own API, then removed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_MERGE_REASON } from "../src/core/dream/index.js";
import { TUNABLES, promotionEligibility } from "../src/core/physics/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { runAction } from "../src/adapters/dashboard/web/actions.js";
import { coreRoad, memoryDetail } from "../src/adapters/dashboard/web/views.js";
import type { MemoryDetail } from "../src/adapters/dashboard/web/views.js";
import { isChapterMemory } from "../src/adapters/dashboard/web/views/memory-words.js";
// @ts-expect-error — a plain browser module, no declarations
import * as cardWordsJs from "../src/adapters/dashboard/web/shared/memory-card-words.js";
import type { FactsResult } from "../src/adapters/mcp/facts.js";
import { seedDemo } from "../tools/demo/seed.js";

// The browser modules' shapes, as this file uses them.
type Step = MemoryDetail["timeline"][number];
interface Ref { id: string; text: string; confidential: boolean }
interface VersionRow { rel: string; dream: boolean; label: string; day: number | null; reason: string | null; refs: Ref[] }
type CurveReading = Pick<MemoryDetail, "curve" | "uses" | "lastUsedDay">;
const { coreRoadLine, curveStart, fadingSince, versionRows } = cardWordsJs as {
  coreRoadLine: (p: MemoryDetail["promotion"], promoted: boolean) => string;
  curveStart: (d: CurveReading) => string;
  fadingSince: (d: CurveReading) => string;
  versionRows: (timeline: readonly Step[]) => VersionRow[];
};

const HOST = "127.0.0.1:4747";
let dir: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-memcard-"));
  await seedDemo({ dir });
  const c = Counterpart.open({ dir, owner: true });
  try {
    const s = c.store;
    const day = s.livedDay();
    const felt = { relevance: 0.7, emotional: 0.9, predictive: 0.4 };
    const calm = { relevance: 0.7, emotional: 0.1, predictive: 0.4 };

    // M1 — strongly felt, about me, written five days ago, never come back to.
    ids.felt = s.put({ type: "memory", kind: "self", about: "me", body: "The four arms of the week, and how each one pulls.", salience: felt, source: "authored" });
    s.updatePhysics(ids.felt, { birthDay: day - 5, lastUsedDay: day - 5 });
    // ...and one just like it that HAS come back once, awake, days later: the fast lane is met.
    ids.returned = s.put({ type: "memory", kind: "self", about: "me", body: "The first reading day, and what it settled.", salience: felt, source: "authored" });
    s.updatePhysics(ids.returned, { birthDay: day - 5, lastUsedDay: day - 5 });
    s.reinforce(ids.returned, day, "referenced", { cued: true });
    // Calm, about me: only the slow lane.
    ids.calm = s.put({ type: "memory", kind: "self", about: "me", body: "I read the solver before the screens.", salience: calm, source: "authored" });
    s.updatePhysics(ids.calm, { birthDay: day - 5, lastUsedDay: day - 5 });
    // Strongly felt, but not about me: no lane at all.
    ids.fact = s.put({ type: "memory", kind: "fact", body: "The ward rota is published on Fridays.", salience: felt, source: "authored" });
    s.updatePhysics(ids.fact, { birthDay: day - 5, lastUsedDay: day - 5 });
    // Strongly felt, about me, and the owner took it out of the core.
    ids.demoted = s.put({ type: "memory", kind: "self", about: "me", body: "A thing the owner said is not who I am.", salience: felt, source: "authored" });
    s.updatePhysics(ids.demoted, { birthDay: day - 5, lastUsedDay: day - 5 });
    s.appendCoreEvent({ memoryId: ids.demoted, action: "demoted", day, reason: "not me", actor: "owner" });

    // M4 — two near-copies folded into a third by a dream.
    ids.merged = s.put({ type: "memory", kind: "fact", title: "Taking the swagger out of /work", body: "Taking the swagger out of /work: say what it does.", source: "authored" });
    ids.copyA = s.put({ type: "memory", kind: "fact", title: "Taking the swagger out of /work", body: "Taking the swagger out of /work, plainly.", source: "authored" });
    ids.copyB = s.put({ type: "memory", kind: "fact", title: "Taking the swagger out of /work", body: "Taking the swagger out of /work — plain words.", source: "authored" });
    s.supersedeInto(ids.copyA, ids.merged, DREAM_MERGE_REASON, { carryReturns: true });
    s.supersedeInto(ids.copyB, ids.merged, DREAM_MERGE_REASON, { carryReturns: true });
  } finally {
    c.close();
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withSrc<T>(fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

const card = (src: DashboardSource, id: string | undefined): MemoryDetail => memoryDetail(src, id ?? "");

/** The store's files, hashed — cache/ (the rebuildable index) left out. */
function canonical(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = relative(root, full);
        if (rel.startsWith("cache/")) continue;
        out.set(rel, `${statSync(full).size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      }
    }
  };
  walk(root);
  return out;
}

describe("M1 — the card's road to the core names the lane that applies", () => {
  test("strongly felt and about me: one real return makes it core, not the slow lane's day count", () => {
    withSrc((src) => {
      const d = card(src, ids.felt);
      expect(d.promotion.oneReturn).toBe(true);
      expect(d.promotion.lane).toBeNull();
      expect(d.promotion.needGap).toBe(TUNABLES.CORE_FAST_GAP_DAYS);
      const line = coreRoadLine(d.promotion, d.promoted);
      expect(line).toContain("one real return makes it core");
      expect(line).not.toContain("separate days");
    });
  });

  test("the verdict is the engine's, read the way the spec says (never re-derived)", () => {
    withSrc((src) => {
      for (const key of ["felt", "returned", "calm", "fact"] as const) {
        const id = ids[key] as string;
        const row = src.store.row(id);
        const p = src.store.physicsOf(id);
        const v = promotionEligibility(p, { aboutMe: row?.kind === "self", day: src.store.livedDay() });
        const d = card(src, id);
        expect(d.promotion).toEqual(coreRoad(v));
        const onlyNoLane = v.blockedBy.length === 1 && v.blockedBy[0] === "no-lane-yet";
        expect(d.promotion.oneReturn).toBe(v.fast.intensity >= v.fast.needIntensity && !v.fast.met && onlyNoLane);
      }
    });
  });

  test("come back once, awake, days later: the fast lane is met and the card says a sleep can make it core", () => {
    withSrc((src) => {
      const d = card(src, ids.returned);
      expect(d.promotion.lane).toBe("fast");
      expect(d.promotion.eligible).toBe(true);
      expect(d.promotion.oneReturn).toBe(false);
      expect(coreRoadLine(d.promotion, d.promoted)).toContain("met the core's bar");
    });
  });

  test("calm and about me: the slow lane, with how many days are left", () => {
    withSrc((src) => {
      const d = card(src, ids.calm);
      expect(d.promotion.oneReturn).toBe(false);
      expect(d.promotion.byUse).toBe(true);
      const line = coreRoadLine(d.promotion, d.promoted);
      expect(line).toContain(`Coming back on ${TUNABLES.CORE_SLOW_DAYS} separate days over ${TUNABLES.CORE_SLOW_SPAN_DAYS} makes it core`);
      expect(line).toContain(`${TUNABLES.CORE_SLOW_DAYS} more to go`);
    });
  });

  test("no lane applies: not about me says nothing; taken out by the owner says so plainly", () => {
    withSrc((src) => {
      const fact = card(src, ids.fact);
      expect(fact.promotion.blocked).toBe("not-about-me");
      expect(fact.promotion.oneReturn).toBe(false);
      expect(fact.promotion.byUse).toBe(false);
      expect(coreRoadLine(fact.promotion, fact.promoted)).toBe("");
      const out = card(src, ids.demoted);
      expect(out.promotion.blocked).toBe("demoted-by-owner");
      expect(out.promotion.oneReturn).toBe(false);
      expect(coreRoadLine(out.promotion, out.promoted)).toContain("You took it out of the core");
    });
  });

  test("the words: in the core already says nothing; the slow lane's strength floor is named when it is the last thing", () => {
    const base = { byUse: true, days: 5, required: 5, span: 30, needSpan: 21, holdShort: false, oneReturn: false, needGap: 2, lane: null, eligible: false, blocked: null };
    expect(coreRoadLine(base, true)).toBe("");
    expect(coreRoadLine({ ...base, holdShort: true }, false)).toContain("held a little more firmly");
    expect(coreRoadLine({ ...base, span: 10 }, false)).toContain("keep coming back a little longer");
    expect(coreRoadLine({ ...base, byUse: false, oneReturn: true, needGap: 1 }, false)).toContain("1 lived day or more");
  });
});

describe("M2 — the curve starts at 'written' until there is a real use", () => {
  test("never used: 'written, day N' and 'fading since it was written', beside 'Not used yet'", () => {
    withSrc((src) => {
      const d = card(src, ids.felt);
      expect(d.uses).toBe(0);
      expect(d.curve?.from).toBe(d.bornDay);
      expect(curveStart(d)).toBe(`written, day ${d.bornDay}`);
      expect(fadingSince(d)).toBe("fading since it was written");
    });
  });

  test("used: 'last used, day N'; a last use older than the curve's window starts it on a plain day", () => {
    withSrc((src) => {
      const d = card(src, ids.returned);
      expect(d.uses).toBeGreaterThan(0);
      const c = d.curve;
      if (c === null) throw new Error("no curve");
      // Used today: the curve starts today.
      expect(curveStart(d)).toBe(`today, day ${c.day}`);
      const earlier = { ...d, lastUsedDay: d.day - 3, curve: { ...c, from: d.day - 3 } };
      expect(curveStart(earlier)).toBe(`last used, day ${d.day - 3}`);
      expect(fadingSince(earlier)).toBe("fading since it was last used");
      const clamped = { ...d, lastUsedDay: d.day - 300, curve: { ...c, from: d.day - 30 } };
      expect(curveStart(clamped)).toBe(`day ${d.day - 30}`);
    });
  });
});

describe("M3 — a journal chapter and the memory drawn from it are one answer", () => {
  // Since 2026-10-09 the page has no fold of its own (`fold.js`, and the
  // `/api/chapters` read it took its links from, are gone): facts mode folds
  // the pair itself (`mcp/facts.ts`, "a chapter and its own copy are one
  // result") and the page draws what the answer says. Checked on a real
  // answer, through the dashboard's own action, not on a hand-made one.
  function aChapter(src: DashboardSource): { memory: string; episode: string } {
    for (const id of src.store.list({ archived: false })) {
      const row = src.store.row(id);
      if (row === undefined || !isChapterMemory(row)) continue;
      const episode = (JSON.parse(row.meta) as Record<string, unknown>)["episodeId"] as string;
      return { memory: id, episode };
    }
    throw new Error("the demo store should hold a chapter memory");
  }

  test("asked in a chapter's own words: the chapter answers, as a journal row, and its copy does not answer beside it", async () => {
    const { ch, words } = withSrc((src) => {
      const found = aChapter(src);
      const body = src.store.row(found.episode)?.body ?? "";
      const prose = body.split("\n").filter((l) => l.trim().length > 0 && !l.trim().startsWith("#")).join(" ");
      return { ch: found, words: prose.split(/\s+/).slice(0, 12).join(" ") };
    });
    const r = await runAction("ask", { question: words, json: true, mode: "facts" }, { dir });
    expect(r.body.exit).toBe(0);
    const answer = JSON.parse((r.body.out ?? []).join("\n")) as FactsResult;
    const answered = answer.memories.map((m) => m.id);
    expect(answered).toContain(ch.episode);
    expect(answered).not.toContain(ch.memory);
    // The browser modules touch `window` at load (`window.openMemory = …`); give them one.
    (globalThis as { window?: unknown }).window ??= globalThis;
    // @ts-expect-error — a plain browser module, no declarations
    const { factsRows } = (await import("../src/adapters/dashboard/web/pages/memories/sections/search.js")) as {
      factsRows: (r: FactsResult, q: string) => string;
    };
    const html = factsRows(answer, words);
    expect(html).toContain(`data-id="${ch.episode}"`);
    expect(html).toContain("Journal · ");
    expect(html).not.toContain(`data-id="${ch.memory}"`);
  });

  test("looking — these cards — leaves the store byte-identical", () => {
    const before = canonical(dir);
    withSrc((src) => {
      for (const id of Object.values(ids)) router(new URL(`http://${HOST}/api/memory?id=${id}`), HOST, src);
    });
    expect([...canonical(dir).entries()]).toEqual([...before.entries()]);
  });
});

describe("M4 — the card's Versions say what a dream merge was", () => {
  test("two near-copies merged by a dream: one row, '2 near-copies merged in a dream', both one click away", () => {
    withSrc((src) => {
      const d = card(src, ids.merged);
      const replaced = d.timeline.filter((s) => s.rel === "replaced");
      const copies = [ids.copyA, ids.copyB].map(String).sort();
      expect(replaced.map((s) => s.id).sort()).toEqual(copies);
      expect(replaced.every((s) => s.dream)).toBe(true);
      const rows = versionRows(d.timeline);
      const dream = rows.filter((r) => r.dream);
      expect(dream.length).toBe(1);
      expect(dream[0]?.label).toBe("2 near-copies merged in a dream");
      expect(dream[0]?.reason).toBeNull();
      expect(dream[0]?.refs.map((r) => r.id).sort()).toEqual(copies);
      expect(rows.some((r) => r.label.includes("dream merge"))).toBe(false);
    });
  });

  test("one near-copy reads singular; the merged-in copy's own card says where it went", () => {
    const one = versionRows([{ rel: "replaced", id: "mem_a", text: "t", confidential: false, day: 6, seq: null, reason: DREAM_MERGE_REASON, dream: true }]);
    expect(one.map((r) => r.label)).toEqual(["near-copy merged in a dream"]);
    // Two dreams on two days stay two rows.
    const two = versionRows([
      { rel: "replaced", id: "mem_a", text: "t", confidential: false, day: 6, seq: null, reason: DREAM_MERGE_REASON, dream: true },
      { rel: "replaced", id: "mem_b", text: "t", confidential: false, day: 9, seq: null, reason: DREAM_MERGE_REASON, dream: true },
    ]);
    expect(two.map((r) => r.label)).toEqual(["near-copy merged in a dream", "near-copy merged in a dream"]);
    // Anything else keeps its words and its reason.
    const plain = versionRows([{ rel: "replaced", id: "mem_c", text: "t", confidential: false, day: 3, seq: null, reason: "owner-edit", dream: false }]);
    expect(plain[0]).toMatchObject({ label: "replaced this older memory", reason: "owner edit" });

    withSrc((src) => {
      const copy = card(src, ids.copyA);
      // Opened by its old id it forwards to the merged memory; its own lineage is at its address.
      expect(copy.id).toBe(String(ids.merged));
    });
    const became = versionRows([{ rel: "became", id: "mem_m", text: "t", confidential: false, day: 6, seq: 2, reason: DREAM_MERGE_REASON, dream: true }]);
    expect(became[0]?.label).toBe("merged in a dream into this near-copy");
  });
});
