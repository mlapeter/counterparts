/**
 * NOTHING IN THE WAKE IS DROPPED WITHOUT A WORD (2026-10-12, Mike's principle;
 * the minimal version, chosen via RANDOM, lightly held).
 *
 * When room runs short the wake condenses, like a table of contents: every
 * lane it chose is whole, shortened (some items and its count) or counted (one
 * line with ids). A lane that lists nothing folds, with the others that
 * list nothing, into one line when its own does not fit; a lane that lists
 * an item keeps its own count. "Nearby", the least of the lanes, is counted
 * only in room nothing else wants — else it is `quiet`, a step-down. A
 * due-day plain reminder is still said in full. What is left unsaid is
 * `untold`, and doctor's Wake line reads it in red.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { wakeArrivalFindings } from "../src/adapters/claude-code/doctor.js";
import { SELF_BRIEFING_EVENT } from "../src/core/counterpart.js";
import { Prospective } from "../src/core/prospective/index.js";
import {
  FOLDED_WORDS,
  LANE_ORDER,
  MORE_NOUN,
  PAGE_END_LINES,
  SELF_TUNABLES,
  compose,
  countedLanes,
  foldedLine,
  isFoldedLine,
  moreLine,
  collapsedLine,
  pageTopLine,
  readSentinel,
  render,
} from "../src/core/self/index.js";
import type { LaneName, Lanes, PageBlock, Ranked, Resolve } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-never-silent-"));
});
afterEach(() => {
  for (const c of opened.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function item(lane: LaneName, i: number, extra: Partial<Ranked> = {}): Ranked {
  const id = `mem_${lane.slice(0, 2)}${String(i).padStart(10, "0")}`;
  return { id, lane, kind: "fact", band: "semantic", strength: 1 - i / 100, protected: false, bornDay: 0, personScoped: false, lastRendered: -1, ...extra };
}

const WORDS: Record<LaneName, string> = {
  identity: "I hold this about myself and it has stayed true across sessions.",
  craft: "I work this way when the work is hard, and slowly.",
  threads: "This was left unfinished and still wants an answer from him.",
  hints: "An ordinary thing worth a nudge but not a claim.",
  horizon: "A date is coming and he asked to remember it.",
};

const resolve: Resolve = (id) => {
  const lane = LANE_ORDER.find((l) => id.startsWith(`mem_${l.slice(0, 2)}`)) ?? "hints";
  return { statement: `${WORDS[lane]} (${id})`, learnedOn: "2026-10-01", ...(lane === "horizon" ? { due: "2026-10-14" } : {}) };
};

/** A store's worth of lanes: every lane non-empty, caps past on most. */
function lanes(opts: { identity?: number; due?: boolean } = {}): Lanes {
  const n = (lane: LaneName, k: number, extra: (i: number) => Partial<Ranked> = () => ({})): Ranked[] => Array.from({ length: k }, (_, i) => item(lane, i, extra(i)));
  return {
    identity: n("identity", opts.identity ?? 4),
    craft: n("craft", 3),
    threads: n("threads", 6),
    hints: n("hints", 5),
    horizon: n("horizon", 3, (i) => (i === 0 && opts.due === true ? { due: true } : {})),
    overflow: {
      identity: ["mem_idx0000000001"],
      craft: ["mem_crx0000000001"],
      threads: ["mem_thx0000000001", "mem_thx0000000002", "mem_thx0000000003", "mem_thx0000000004"],
      // Nearby's cap is the rest of the store: never counted.
      hints: Array.from({ length: 40 }, (_, i) => `mem_hix${String(i).padStart(10, "0")}`),
      horizon: ["mem_hox0000000001", "mem_hox0000000002"],
    },
  };
}

function page(size: number): PageBlock {
  const text = `## Core\n\n${"x".repeat(Math.max(1, size - 10))}.`;
  return { text, top: pageTopLine("whole", size), end: PAGE_END_LINES.whole, dateline: "(Last revised 2026-10-11.)", rung: "whole", truncated: false, wholeBytes: size };
}

/** Every id a lane offers the wake: its items, and its cap's — but not Nearby's cap. */
function offered(l: Lanes, lane: LaneName): number {
  return l[lane].length + (lane === "hints" ? 0 : (l.overflow?.[lane]?.length ?? 0));
}

describe("the invariant: every lane the wake chose is whole, shortened or counted", () => {
  test("across a sweep of budgets, page sizes and lent room — and in the text, not only the record", () => {
    let folded = 0;
    let shortened = 0;
    let counted = 0;
    for (const pageBytes of [0, 900, 2_500]) {
      for (const lend of [0, 300]) {
        for (const due of [false, true]) {
          const l = lanes({ due });
          const block = pageBytes === 0 ? undefined : page(pageBytes);
          // The floor with every reserved lane counted at its smallest — "Who I
          // am" by its own line (it never folds), the rest folded; "Nearby" is
          // not reserved. The guarantee holds from here up.
          const all: Partial<Record<LaneName, string[]>> = {};
          for (const lane of ["craft", "threads", "horizon"] as const) all[lane] = [...l[lane].map((r) => r.id), ...(l.overflow?.[lane] ?? [])];
          const self = [...l.identity.map((r) => r.id), ...(l.overflow?.identity ?? [])];
          const identity = { page: block ?? null, forming: null };
          const foldFloor = compose({ identity: [], craft: [], threads: [], hints: [], horizon: [] }, 3, resolve, undefined, identity, block === undefined ? { identity: moreLine("identity", self) } : {}, undefined, undefined, foldedLine(all) ?? "").bytes;
          // A due-day line is said in full even past its count (#442): leave room for one.
          const dueLine = due ? Buffer.byteLength(`- due 2026-10-14 · ${WORDS.horizon} (mem_ho0000000000)\n`, "utf8") + 32 : 0;
          for (let budget = 500; budget <= 9_000; budget += 61) {
            const out = render(l, { budgetBytes: budget, day: 3, ...(block === undefined ? {} : { page: block, pageExists: true }), ...(lend > 0 ? { lendBytes: lend } : {}) }, resolve, SELF_TUNABLES);
            expect(readSentinel(out.text).intact).toBe(true);
            if (!out.overBudget) expect(out.bytes).toBeLessThanOrEqual(out.budgetBytes);
            expect(out.budgetBytes).toBeLessThanOrEqual(budget + lend);
            // Above the floor nothing is untold — but for the one exception: a
            // due-day plain reminder said in full where its lane's count has no
            // room (#442), which leaves Arriving's rest untold, and only that.
            const untold = due && out.kept.horizon.length > 0 ? { ...out.untold, horizon: undefined } : out.untold;
            if (budget >= foldFloor + dueLine) expect({ budget, pageBytes, lend, due, untold: JSON.parse(JSON.stringify(untold)) }).toEqual({ budget, pageBytes, lend, due, untold: {} });
            const said = countedLanes(out.text);
            if (out.folded) folded += 1;
            for (const lane of LANE_ORDER) {
              if (lane === "identity" && block !== undefined) continue;
              const total = offered(l, lane);
              const listed = out.kept[lane].length;
              if (out.untold[lane] !== undefined) continue;
              // Whole, shortened or counted — and the count is the rest, exactly.
              // "Nearby" alone may be left uncounted by rank (`quiet`).
              expect({ budget, lane, sum: listed + (out.more[lane] ?? 0) + (out.quiet[lane] ?? 0) }).toEqual({ budget, lane, sum: total });
              if (lane !== "hints") expect(out.quiet[lane]).toBeUndefined();
              // What the record says is what the text says.
              expect({ budget, lane, said: said[lane] }).toEqual({ budget, lane, said: out.more[lane] });
              // A lane that lists an item keeps its own count, never the fold.
              if (listed > 0 && out.more[lane] !== undefined) expect(out.text).toContain(moreLine(lane, []).split(";")[0]?.replace("(0 more", `(${String(out.more[lane])} more`) ?? "");
              if (listed > 0 && listed < l[lane].length) shortened += 1;
              if (listed === 0) counted += 1;
            }
          }
        }
      }
    }
    // The sweep reached every shape.
    expect(folded).toBeGreaterThan(0);
    expect(shortened).toBeGreaterThan(0);
    expect(counted).toBeGreaterThan(0);
  });

  test("a roomy wake pays nothing: no lane lost anything, no line, byte for byte the old composition", () => {
    const l: Lanes = { identity: [item("identity", 0)], craft: [item("craft", 0)], threads: [item("threads", 0)], hints: [item("hints", 0)], horizon: [item("horizon", 0)] };
    const out = render(l, { budgetBytes: 9_000, day: 3 }, resolve, SELF_TUNABLES);
    expect(out.more).toEqual({});
    expect(out.untold).toEqual({});
    expect(out.folded).toBe(false);
    expect(out.text).toBe(compose({ identity: l.identity, craft: l.craft, threads: l.threads, hints: l.hints, horizon: l.horizon }, 3, resolve).text);
  });
});

describe("Nearby: counted in room nothing else wants — of what it chose, never the store", () => {
  test("hints the budget popped are counted when there is room; else quiet, never untold; the cap's forty never", () => {
    const l = lanes();
    const full = render({ ...l, identity: [] }, { budgetBytes: 100_000, day: 3 }, resolve, SELF_TUNABLES);
    expect(full.more.hints).toBeUndefined();
    expect(full.text).not.toContain("more might be relevant");
    let counted = 0;
    let quiet = 0;
    // Every 5 bytes: the window where the count fits and nothing else wants it
    // is narrower than 20 since the line says "might be relevant" (2026-10-12).
    for (let cut = 40; cut <= 400; cut += 5) {
      const out = render({ ...l, identity: [] }, { budgetBytes: full.bytes - cut, day: 3 }, resolve, SELF_TUNABLES);
      const popped = out.trimmed.filter((t) => t.lane === "hints").map((t) => t.id);
      if (popped.length === 0) continue;
      expect(out.untold).toEqual({});
      if (out.more.hints !== undefined) {
        counted += 1;
        expect(out.more.hints).toBe(popped.length);
        expect(countedLanes(out.text).hints).toBe(popped.length);
      } else {
        quiet += 1;
        expect(out.quiet).toEqual({ hints: popped.length });
      }
      // Nearby's count never cost another lane an item: what it lost, it lost
      // to the budget alone — threads keep what they keep without it.
      expect(out.kept.threads.length).toBe(render({ ...l, identity: [], hints: [] }, { budgetBytes: full.bytes - cut, day: 3 }, resolve, SELF_TUNABLES).kept.threads.length);
    }
    expect(counted).toBeGreaterThan(0);
    expect(quiet).toBeGreaterThan(0);
  });

  test("a Nearby lane with nothing listed is one collapsed line, its heading inside it", () => {
    const l = lanes();
    const ids = l.hints.map((r) => r.id);
    expect(collapsedLine("hints", ids)).toStartWith("Might be relevant: 5 — ");
    expect(countedLanes(collapsedLine("hints", ids))).toEqual({ hints: 5 });
  });
});

describe("the folded line", () => {
  test("names every lane that lost something, dated items first, and reads back", () => {
    const line = foldedLine({ threads: ["mem_a", "mem_b", "mem_e", "mem_f"], horizon: ["mem_c"], hints: ["mem_d"] }) ?? "";
    // Counts and the door that lists them, no bare ids (WK1, 2026-10-30).
    expect(line).toBe(`${FOLDED_WORDS} 1 coming up, 4 still open (recall "still open" lists them); 1 might be relevant`);
    expect(isFoldedLine(line)).toBe(true);
    expect(countedLanes(line)).toEqual({ horizon: 1, threads: 4, hints: 1 });
    expect(foldedLine({})).toBeNull();
  });

  test("a bundle stored before the plain-words rename still reads back: 'arriving' and 'nearby'", () => {
    const old = `${FOLDED_WORDS} 1 arriving (recall ids: mem_c); 4 still open (recall ids: mem_a, mem_b, mem_e, and 1 more); 1 nearby (recall ids: mem_d)`;
    expect(countedLanes(old)).toEqual({ horizon: 1, threads: 4, hints: 1 });
    expect(countedLanes("(3 more arriving; recall ids: mem_a, mem_b, mem_c)\n(2 more nearby; recall ids: mem_d, mem_e)")).toEqual({ horizon: 3, hints: 2 });
  });

  test("beside a page that leaves no room for each lane's line, the lanes that list nothing fold — and the page is never cut for them", () => {
    const l = lanes();
    const block = page(2_500);
    const identity = { page: block, forming: null };
    // Room for the page and a folded line, not for every lane's own.
    const all: Partial<Record<LaneName, string[]>> = {};
    for (const lane of ["craft", "threads", "hints", "horizon"] as const) all[lane] = [...l[lane].map((r) => r.id), ...(lane === "hints" ? [] : (l.overflow?.[lane] ?? []))];
    const floor = compose({ identity: [], craft: [], threads: [], hints: [], horizon: [] }, 3, resolve, undefined, identity, {}, undefined, undefined, foldedLine(all) ?? "").bytes;
    const out = render(l, { budgetBytes: floor + 20, day: 3, page: block, pageExists: true }, resolve, SELF_TUNABLES);
    expect(out.folded).toBe(true);
    expect(out.untold).toEqual({});
    expect(out.text).toContain(block.text);
    expect(out.bytes).toBeLessThanOrEqual(out.budgetBytes);
    const counted = countedLanes(out.text);
    expect({ ...counted, hints: (counted.hints ?? 0) + (out.quiet.hints ?? 0) }).toEqual({ craft: 4, threads: 10, hints: 5, horizon: 5 });
    // The fold holds only lanes that list nothing; a lane listing an item has its own line.
    const fold = out.text.split("\n").find(isFoldedLine) ?? "";
    for (const lane of ["craft", "threads", "horizon"] as const) {
      // A count of it in the fold reads "<n> <noun>"; the door's own words carry no count.
      if (out.kept[lane].length > 0) expect(fold).not.toMatch(new RegExp(`\\d ${MORE_NOUN[lane]}`));
    }
  });
});

describe("the exception, and the last resort", () => {
  test("a due-day plain reminder is said in full; when not even a count of the rest fits, the rest is untold and each id leaves a trim row", () => {
    const due = item("horizon", 0, { due: true });
    const l: Lanes = {
      identity: [],
      craft: [],
      threads: [],
      hints: [],
      horizon: [due],
      overflow: { identity: [], craft: [], threads: [], hints: [], horizon: ["mem_hox0000000001", "mem_hox0000000002"] },
    };
    const exact = compose({ identity: [], craft: [], threads: [], hints: [], horizon: [due] }, 3, resolve).bytes;
    const out = render(l, { budgetBytes: exact, day: 3 }, resolve, SELF_TUNABLES);
    expect(out.kept.horizon).toEqual([due.id]);
    expect(out.untold).toEqual({ horizon: 2 });
    expect(out.trimmed.map((t) => t.id).sort()).toEqual(["mem_hox0000000001", "mem_hox0000000002"]);
    // With room for its count, it is counted and nothing is untold.
    const roomy = render(l, { budgetBytes: exact + 200, day: 3 }, resolve, SELF_TUNABLES);
    expect(roomy.untold).toEqual({});
    expect(roomy.more).toEqual({ horizon: 2 });
  });
});

describe("doctor reads an untold render in red; a counted one is a step-down", () => {
  test("a row with untold ids makes the Wake line red, with the date and what to do", () => {
    const store = Store.open({ dir });
    opened.push(store);
    store.appendEvent({
      name: SELF_BRIEFING_EVENT,
      day: store.livedDay(),
      payload: { reason: "rendered", date: "2026-10-12", bytes: 8_900, budget: 9_000, counts: {}, trimmed: [], trimmedTotal: 0, counted: 3, untold: 2, untoldLanes: ["threads"] },
    });
    const f = wakeArrivalFindings(store).find((x) => x.key === "wake");
    expect(f?.severity).toBe("red");
    expect(f?.detail).toContain("went unsaid");
    expect(f?.detail).toContain("(newest 2026-10-12)");
    expect(f?.fix).toContain("bug");
    expect(f?.data["untold"]).toBe(1);
  });

  test("a row that only counted is not red, and not amber either", () => {
    const store = Store.open({ dir });
    opened.push(store);
    store.appendEvent({
      name: SELF_BRIEFING_EVENT,
      day: store.livedDay(),
      payload: { reason: "rendered", date: "2026-10-12", bytes: 8_900, budget: 9_000, counts: {}, trimmed: [{ id: "mem_x", lane: "threads" }], trimmedTotal: 1, trimmedLanes: { threads: 1 }, counted: 5, untold: 0 },
    });
    const f = wakeArrivalFindings(store).find((x) => x.key === "wake");
    expect(f?.severity ?? "green").toBe("green");
    expect(f?.data["steppedDown"] ?? 1).toBe(1);
  });
});

describe("prospective says what the Arriving lane left out, by reason", () => {
  test("a month, a daily repeat and a day item: one event, counts and ids by reason", () => {
    const store = Store.open({ dir });
    opened.push(store);
    const month = store.put({ type: "memory", kind: "fact", body: "The studio lease is up for renewal this month.", learnedOn: "2026-08-25", eventDate: "2026-09", salience: { relevance: 0.7, emotional: 0.7, predictive: 0.7 } });
    const day = store.put({ type: "memory", kind: "fact", body: "The Portland move lands on the fourth.", learnedOn: "2026-08-25", eventDate: "2026-09-05", salience: { relevance: 0.7, emotional: 0.7, predictive: 0.7 } });
    const p = new Prospective({ store });
    const h = p.horizon({ at: "2026-09-04", day: 5 });
    expect(h.items.map((i) => i.memoryId)).toContain(day);
    const ev = p.events("prospective.horizon.excluded");
    expect(ev).toHaveLength(1);
    expect(ev[0]?.data?.["notDay"]).toBe(1);
    expect(ev[0]?.data?.["notDayIds"]).toBe(month);
    expect(ev[0]?.data?.["daily"]).toBe(0);
    expect(ev[0]?.data?.["told"]).toBe(0);
  });
});
