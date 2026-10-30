/**
 * THE WAKE SAYS WHAT IT LEFT OUT (2026-09-29, audit item 5).
 *
 * A lane that loses elements — to its cap, the identity share or the budget
 * trim — gets one short line: how many more, and ids the `recall` tool reads
 * whole. The line is furniture (no count, no element) and lives inside the
 * wake's byte budget. Since 2026-10-12 its room is RESERVED: the lane gives up
 * an item for it rather than lose it, and nothing leaves without a word.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { FRAMING, OPEN_TAIL_WORDS, Self, SELF_TUNABLES, foldedLine, moreLine, readSentinel, render } from "../src/core/self/index.js";
import type { Lanes, Ranked, Resolve } from "../src/core/self/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-wake-more-"));
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

function thread(id: string): Ranked {
  return { id, lane: "threads", kind: "fact", band: "semantic", strength: 0.9, protected: false, bornDay: 0, personScoped: false, lastRendered: -1 };
}

function lanes(threads: number, overflow: number): Lanes {
  const ids = Array.from({ length: threads + overflow }, (_, i) => `mem_t${String(i).padStart(2, "0")}`);
  return {
    identity: [],
    craft: [],
    threads: ids.slice(0, threads).map(thread),
    hints: [],
    horizon: [],
    overflow: { identity: [], craft: [], threads: ids.slice(threads), hints: [], horizon: [] },
  };
}

const resolve: Resolve = (id) => ({ statement: `The open question numbered ${id}.`, learnedOn: "2026-09-01" });

describe("the line", () => {
  test("a lane past its cap says how many more and names their ids — furniture, so counts and the sentinel stay true", () => {
    const out = render(lanes(12, 3), { budgetBytes: 100_000, day: 5 }, resolve, SELF_TUNABLES);
    expect(out.text).toContain(`${FRAMING.threads}\n`);
    expect(out.text).toContain(`(3 more open, ${OPEN_TAIL_WORDS})`);
    expect(out.more).toEqual({ threads: 3 });
    expect(out.counts.threads).toBe(12);
    expect(out.elements).toBe(12);
    expect(readSentinel(out.text).intact).toBe(true);
    expect(out.bytes).toBeLessThanOrEqual(100_000);
  });

  test("the count is whole and names no ids (WK1, 2026-10-30): a lane with a door names it, the rest the count alone", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `mem_h${String(i)}`);
    expect(moreLine("hints", ids)).toBe("(8 more might be relevant)");
    expect(moreLine("horizon", ids)).toBe(`(8 more coming up; recall "still open" lists them)`);
    // "Still open" names no id at all (2026-10-25): the count, calmly.
    const out = render(lanes(12, 8), { budgetBytes: 100_000, day: 5 }, resolve, SELF_TUNABLES);
    expect(out.text).toContain(`(8 more open, ${OPEN_TAIL_WORDS})`);
    expect(out.text).not.toContain("mem_t12");
  });

  test("a lane that lost nothing gets no line", () => {
    const out = render(lanes(4, 0), { budgetBytes: 100_000, day: 5 }, resolve, SELF_TUNABLES);
    expect(out.text).not.toContain(" more open");
    expect(out.more).toEqual({});
  });

  test("INSIDE THE BUDGET, AND RESERVED: with no room for the line the lane gives up an item to say it — never left out without a word (2026-10-12)", () => {
    const without = render(lanes(12, 0), { budgetBytes: 100_000, day: 5 }, resolve, SELF_TUNABLES);
    // Exactly the room the wake needs without the line.
    const tight = render(lanes(12, 3), { budgetBytes: without.bytes, day: 5 }, resolve, SELF_TUNABLES);
    expect(tight.bytes).toBeLessThanOrEqual(without.bytes);
    expect(tight.untold).toEqual({});
    const popped = tight.trimmed.map((t) => t.id);
    expect(popped.length).toBeGreaterThan(0);
    expect(tight.counts.threads).toBe(12 - popped.length);
    // The count names the popped items first, then what the cap left out.
    expect(tight.more).toEqual({ threads: popped.length + 3 });
    expect(tight.text).toContain(`(${String(popped.length + 3)} more open, `);
    // And one line's worth more room is enough for it.
    const line = moreLine("threads", ["mem_t12", "mem_t13", "mem_t14"]);
    const roomy = render(lanes(12, 3), { budgetBytes: without.bytes + Buffer.byteLength(`${line}\n`, "utf8"), day: 5 }, resolve, SELF_TUNABLES);
    expect(roomy.more).toEqual({ threads: 3 });
    expect(roomy.bytes).toBeLessThanOrEqual(without.bytes + Buffer.byteLength(`${line}\n`, "utf8"));
  });

  test("what the BUDGET trimmed is counted too, with what the cap left out", () => {
    // Long statements, so one trimmed element frees more room than the line needs.
    const long: Resolve = (id) => ({ statement: `The open question numbered ${id}. ${"More words about it. ".repeat(8)}`, learnedOn: "2026-09-01" });
    const full = render(lanes(12, 2), { budgetBytes: 100_000, day: 5 }, long, SELF_TUNABLES);
    const out = render(lanes(12, 2), { budgetBytes: full.bytes - 60, day: 5 }, long, SELF_TUNABLES);
    const cut = out.trimmed.filter((t) => t.lane === "threads").map((t) => t.id);
    expect(cut.length).toBeGreaterThan(0);
    const n = cut.length + 2;
    expect(out.more.threads).toBe(n);
    expect(out.text).toContain(`(${String(n)} more open, ${OPEN_TAIL_WORDS})`);
    expect(out.bytes).toBeLessThanOrEqual(full.bytes - 60);
  });
});

describe("beside #284's standing labels", () => {
  test("a lane whose elements carry standing labels and a 'more' line still fits the budget, and the labels are counted", () => {
    const labelled: Resolve = (id) => ({
      statement: `The open question numbered ${id}.`,
      learnedOn: "2026-09-01",
      standing: { prefix: "Unsettled — may be out of date, see [ctr_0001]: ", suffix: " (disagrees with [mem_other])" },
    });
    const roomy = render(lanes(12, 3), { budgetBytes: 100_000, day: 5 }, labelled, SELF_TUNABLES);
    expect(roomy.text).toContain("Unsettled — may be out of date");
    expect(roomy.text).toContain(`(3 more open, ${OPEN_TAIL_WORDS})`);
    // At every budget from roomy down to well under it: never over, sentinel true.
    for (let budget = roomy.bytes; budget >= roomy.bytes - 600; budget -= 37) {
      const out = render(lanes(12, 3), { budgetBytes: budget, day: 5 }, labelled, SELF_TUNABLES);
      expect(out.bytes, String(budget)).toBeLessThanOrEqual(budget);
      expect(readSentinel(out.text).intact, String(budget)).toBe(true);
      // Whatever the trim took is named in the line when the line fits.
      if (out.more.threads !== undefined) expect(out.more.threads).toBe(3 + out.trimmed.filter((t) => t.lane === "threads").length);
    }
  });
});

describe("\"Still open\"'s calm tail says a door that works (2026-10-25)", () => {
  /** Distinct, rare words per thread, so each is a question of its own. */
  const TOPICS = ["greenhouse vents", "tractor clutch", "orchard netting", "cider press", "beehive frames", "fence posts", "seed potatoes", "rainwater barrels", "compost sieve"];

  test("a real store past the threads cap: a facts question about any counted one finds it through the recall tool", async () => {
    const c = Counterpart.open({ dir });
    open.push(c);
    const total = SELF_TUNABLES.THREADS_MAX + 4;
    const all: string[] = [];
    for (let i = 0; i < total; i += 1) {
      all.push(
        c.store.put({
          type: "memory",
          kind: "fact",
          body: `Still unsettled: whether the ${TOPICS[i] ?? "spare"} need replacing before winter.`,
          meta: { unresolved: true },
          salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
        }),
      );
    }
    const out = new Self({ store: c.store }).build({ budgetBytes: 100_000, day: c.store.livedDay() });
    expect(out.more.threads).toBe(4);
    expect(out.text).toContain(`(4 more open, ${OPEN_TAIL_WORDS})`);
    const counted = all.filter((id) => !out.kept.threads.includes(id));
    expect(counted).toHaveLength(4);
    for (const id of counted) expect(out.text).not.toContain(id);

    recordSession(dir, { sessionId: "s-more", scope: "/proj", phase: "start" });
    const server = new McpServer({ counterpart: c, scope: "/proj", registryDir: dir });
    for (const id of counted) {
      const topic = TOPICS[all.indexOf(id)] ?? "";
      const r = await server.call("recall", { session: "s-more", question: `what about the ${topic}?`, mode: "facts" });
      expect(r.isError ?? false, topic).toBe(false);
      expect((r.structuredContent["ids"] as string[])[0], topic).toBe(id);
    }
  });
});

describe("the folded line's door works through the recall tool (2026-10-12; no ids since WK1, 2026-10-30)", () => {
  test("a folded lane is a count and a door, and the door lists what it counted", async () => {
    const c = Counterpart.open({ dir });
    open.push(c);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push(
        c.store.put({
          type: "memory",
          kind: "fact",
          body: `An open question, number ${String(i)}, about the move that is still not settled.`,
          meta: { unresolved: true },
          salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
        }),
      );
    }
    const line = foldedLine({ threads: ids }) ?? "";
    expect(line).toContain('6 still open (recall "still open" lists them)');
    for (const id of ids) expect(line).not.toContain(id);
    recordSession(dir, { sessionId: "s-fold", scope: "/proj", phase: "start" });
    const server = new McpServer({ counterpart: c, scope: "/proj", registryDir: dir });
    const r = await server.call("recall", { handle: "still open" });
    expect(r.isError ?? false).toBe(false);
    expect((r.structuredContent["items"] as { id: string }[]).map((x) => x.id).sort()).toEqual([...ids].sort());
  });
});
