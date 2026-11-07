/**
 * FD1 STEP 3 — INTERFERENCE FOR ROUTINE WORK EVENTS (2026-11-07). A newer
 * routine work event on the same subject fades the older one, as a write's
 * `updates` does: "0.3.50 released" fades "0.3.46 ready to publish" and
 * "0.3.47 after-publish steps" (`src/core/interference.ts`, the night's
 * `interfere` phase). Only unsalient, never-really-used work memories; what
 * the owner said, what was felt, what is about the owner, and open items keep
 * the slow curve. Every fade is counted apart from the prune.
 *
 * The real path: memories written through the MCP `remember` and
 * `session_end` tools, the night run by the boundary (`Counterpart#sessionEnd`,
 * which runs the sleep cycle), and the result read off the store.
 *
 * Hermetic: every store is a temp dir made and removed here; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { INTERFERENCE_REASON, INTERFERENCE_SOURCE, headline, interferenceSweep, sameSubject, subjectKeys } from "../src/core/interference.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { CONTRADICTION_SETTLED_EVENT, undo } from "../src/core/reconsolidation.js";
import { SLEEP_CYCLE_EVENT } from "../src/core/counterpart-events.js";
import { PHASES, TUNABLES as SLEEP } from "../src/core/sleep/index.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ZONE = "UTC";
const BUDGET = 9_000;
const S = "1f0e0000-0000-4000-8000-000000000001";

let root: string;
let HERE: string;
let ELSEWHERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-interference-")));
  HERE = join(root, "shop");
  ELSEWHERE = join(root, "bakery");
  mkdirSync(HERE, { recursive: true });
  mkdirSync(ELSEWHERE, { recursive: true });
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

interface World {
  c: Counterpart;
  now(): number;
  today(): string;
  toDay(n: number): void;
  tools(scope?: string): McpServer;
}

function world(): World {
  let now = Date.parse("2026-11-01T09:00:00Z");
  const c = Counterpart.open({ dir: join(root, "store"), budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  const today = (): string => new Date(now).toISOString().slice(0, 10);
  c.store.advanceClock(today());
  return {
    c,
    now: () => now,
    today,
    toDay(n) {
      while (c.store.livedDay() < n) {
        now += DAY;
        c.store.advanceClock(today());
      }
      expect(c.store.livedDay()).toBe(n);
    },
    tools: (scope = HERE) => new McpServer({ counterpart: c, session: S, scope, now: () => now }),
  };
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const r = await s.call("remember", { about: "work", ...args });
  expect(r.isError ?? false).toBe(false);
  const id = r.structuredContent["id"];
  expect(typeof id).toBe("string");
  return id as string;
}

/** The memory a session_end entry wrote, found by its words. */
function idOf(w: World, words: string): string {
  const id = w.c.store.list({ type: "memory" }).find((x) => w.c.store.readProse(x).body.includes(words));
  if (id === undefined) throw new Error(`no memory says ${words}`);
  return id;
}

const fadeOf = (w: World, id: string): number => w.c.store.row(id)?.fade ?? 1;

/** The interference pairs, older → newer. */
function pairs(w: World): { over: string; holds: string | null; state: string }[] {
  return w.c.store
    .contradictions({ limit: 10_000 })
    .filter((p) => p.source === INTERFERENCE_SOURCE)
    .map((p) => ({ over: p.a, holds: p.holds, state: p.state }));
}

function cycleRows(w: World): Record<string, unknown>[] {
  return w.c.store.eventLog({ name: SLEEP_CYCLE_EVENT, order: "asc" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the subject: a version series, or a pull request", () => {
  test("versions are read by series with the highest patch; pull requests by number", () => {
    const k = subjectKeys("0.3.46 ready to publish; 0.3.47 queued after it, PR #744 and pull/772, v1.2.0 for the plugin");
    expect([...k.versions]).toEqual([
      ["0.3", 47],
      ["1.2", 0],
    ]);
    expect([...k.pulls].sort()).toEqual([744, 772]);
  });

  test("dates, addresses, longer dotted runs and one-digit numbers are not subjects", () => {
    const k = subjectKeys("met on 2026-11-07 at 10.0.0.12, version 1.2.3.4, step #3, colour #fff, chapter 4.1");
    expect(k.versions.size).toBe(0);
    expect(k.pulls.size).toBe(0);
  });

  test("the subject is read in the headline: the title, or the first words, never a version named in passing below", () => {
    expect(headline({ title: "Shelf labels: the new font", body: "Long note. Seen first on 0.3.46 ready to publish." })).toBe("Shelf labels: the new font");
    const long = `${"The till drawer sticks when the shop is cold and the spring has to be eased by hand. ".repeat(3)}0.3.50 released.`;
    expect(subjectKeys(headline({ title: null, body: long })).versions.size).toBe(0);
    expect(subjectKeys(headline({ title: "  ", body: "0.3.46 ready to publish: sheet written." })).versions.get("0.3")).toBe(46);
    // A token the cut would straddle is left out whole, never read as a shorter one.
    const pad = "x".repeat(114);
    expect(subjectKeys(headline({ title: null, body: `${pad} 0.3.46 ready and more words after it` })).versions.size).toBe(0);
    expect(subjectKeys(headline({ title: null, body: `${"y".repeat(117)} #741 merged, then more after it` })).pulls.size).toBe(0);
  });

  test("the nearest later state holds: the fewest patches on, then the newest written", () => {
    const old = subjectKeys("0.3.46 ready to publish");
    expect(sameSubject(old, subjectKeys("0.3.47 released"))?.gap).toBe(1);
    expect(sameSubject(old, subjectKeys("0.3.46 released"))?.gap).toBe(0);
    expect(sameSubject(subjectKeys("0.3.46 and 1.2.0 tagged"), subjectKeys("0.3.50 and 1.2.1 released"))).toEqual({ rule: "version", key: "1.2.0→1.2.1", gap: 1 });
  });

  test("a newer version in the same series is the later state; an older one, another series or another PR is not", () => {
    const old = subjectKeys("0.3.46 ready to publish");
    expect(sameSubject(old, subjectKeys("0.3.50 released"))).toEqual({ rule: "version", key: "0.3.46→0.3.50", gap: 4 });
    expect(sameSubject(old, subjectKeys("0.3.46 released"))?.rule).toBe("version");
    expect(sameSubject(old, subjectKeys("0.3.45 hotfix"))).toBeNull();
    expect(sameSubject(old, subjectKeys("0.4.0 released"))).toBeNull();
    expect(sameSubject(subjectKeys("#760 merged"), subjectKeys("#772 merged"))).toBeNull();
    expect(sameSubject(subjectKeys("PR #741 opened for review"), subjectKeys("#741 merged"))).toEqual({ rule: "pull", key: "#741", gap: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the night: a newer routine work event fades the older one", () => {
  test("through remember and session_end, then the night: the routine olders fade with their reason, the protected kinds keep the slow curve", async () => {
    const w = world();
    const s = w.tools();
    w.toDay(1);
    // Routine, never used: these fade.
    const ready = await remember(s, { text: "0.3.46 ready to publish: tarball built and the sheet written.", status: "done" });
    const after = await remember(s, { text: "0.3.47 after-publish steps: tag pushed, release notes deployed to the site." });
    const ended = await s.call("session_end", { session: S, memories: [{ content: "PR #741 opened for review: the shelf labels change.", about: "work", status: "done" }] });
    expect(ended.isError ?? false).toBe(false);
    const pr = idOf(w, "PR #741 opened for review");
    // The protected kinds: each names 0.3.46 too, and each keeps its curve.
    const owner = await remember(s, { text: "0.3.46 cut: the owner said the install on the shop laptop went fine.", saidBy: "owner", status: "done" });
    const felt = await remember(s, {
      text: "0.3.46 released after three tries; relieved it finally landed.",
      status: "done",
      feelings: [{ whose: "self", emotion: "relieved", strength: 0.6 }],
    });
    const aboutOwner = await remember(s, { text: "The owner asked whether 0.3.46 was published yet.", about: "owner" });
    const openItem = await remember(s, { text: "0.3.46 ready: does the owner want it published tonight?", unresolved: true });
    const salient = await remember(s, { text: "0.3.46 merged the new till export, which the accountant depends on.", salience: 0.45 });
    const note = await remember(s, { text: "0.3.46 changed how the shelf count rounds, because half units confused the stocktake." });
    const otherPr = await remember(s, { text: "#760 merged: receipt footer wording." });
    const elsewhere = await remember(w.tools(ELSEWHERE), { text: "0.3.46 of the oven timer tagged and ready to install in the bakery." });
    const used = await remember(s, { text: "0.3.46 install steps verified on the spare till; ready to publish." });
    w.toDay(2);
    // A real use on a later day: one full use is past "never really used".
    w.c.store.reinforce(used, 2, "referenced");
    expect(w.c.store.row(used)?.uses ?? 0).toBeGreaterThanOrEqual(PHYSICS.W_USEFUL);

    w.toDay(3);
    const released = await remember(s, { text: "0.3.50 released to npm; the shop install updated cleanly.", status: "done" });
    const merged = await remember(s, { text: "#741 merged into master after review.", status: "done" });
    const report = await w.c.sessionEnd({ date: w.today(), budgetBytes: BUDGET, session: S });

    // The phase ran, in its place, and counted its fades.
    expect(report.cycle.order).toEqual([...PHASES]);
    const phase = report.cycle.phases.find((p) => p.phase === "interfere");
    expect(phase?.status).toBe("ran");
    expect(phase?.changed).toBe(3);
    expect(report.cycle.interfered.map((f) => f.over).sort()).toEqual([after, pr, ready].sort());

    // The olders: cut once, as an `updates` revision cuts, under the newest one.
    for (const id of [ready, after]) expect(fadeOf(w, id)).toBeCloseTo(PHYSICS.CHANGED_FADE, 9);
    expect(fadeOf(w, pr)).toBeCloseTo(PHYSICS.CHANGED_FADE, 9);
    expect(pairs(w).sort((a, b) => (a.over < b.over ? -1 : 1))).toEqual(
      [
        { over: ready, holds: released, state: "settled" },
        { over: after, holds: released, state: "settled" },
        { over: pr, holds: merged, state: "settled" },
      ].sort((a, b) => (a.over < b.over ? -1 : 1)),
    );
    // Still live and recallable: a fade, not an exit.
    for (const id of [ready, after, pr]) expect(w.c.store.row(id)?.archived).toBe(0);

    // Each fade records its own reason and the newer memory.
    const settled = w.c.store
      .eventLog({ name: CONTRADICTION_SETTLED_EVENT })
      .map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>)
      .filter((p) => p["source"] === INTERFERENCE_SOURCE);
    expect(settled.length).toBe(3);
    for (const p of settled) {
      expect(p["reason"]).toBe(INTERFERENCE_REASON);
      expect(p["how"]).toBe("changed");
      expect(p["faded"]).toBe(true);
    }
    const trail = w.c.store.contradictionSettles({ limit: 1_000 }).filter((t) => t.over === ready && t.action === "settle");
    expect(trail[0]?.why).toBe(`${INTERFERENCE_REASON}: ${released} (0.3.46→0.3.50)`);
    expect(JSON.parse(trail[0]?.detail ?? "{}")["reason"]).toBe(INTERFERENCE_REASON);

    // Counted apart from the prune on the night's durable row.
    const row = cycleRows(w).at(-1) ?? {};
    expect(row["interfered"]).toBe(3);
    expect(row["pruned"]).toBe(0);

    // The protected kinds and the other subjects keep their curve.
    for (const id of [owner, felt, aboutOwner, openItem, salient, note, otherPr, elsewhere, used, released, merged]) {
      expect(fadeOf(w, id)).toBe(1);
    }
    const skipped = phase?.skipped ?? {};
    expect(skipped["owner-said"]).toBe(1);
    expect(skipped["felt"]).toBe(1);
    expect(skipped["open-item"]).toBe(1);
    expect(skipped["salient"]).toBe(1);
    expect(skipped["not-an-event"]).toBe(1);
    expect(skipped["used"]).toBe(1);

    // The next night fades nothing again: one cut per memory.
    w.toDay(4);
    const again = await w.c.sessionEnd({ date: w.today(), budgetBytes: BUDGET, session: S });
    expect(again.cycle.phases.find((p) => p.phase === "interfere")?.changed).toBe(0);
    for (const id of [ready, after, pr]) expect(fadeOf(w, id)).toBeCloseTo(PHYSICS.CHANGED_FADE, 9);
    expect(cycleRows(w).at(-1)?.["interfered"]).toBe(0);
  });

  test("the owner's undo stands: an undone fade is never made again, even by a newer release", async () => {
    const w = world();
    const s = w.tools();
    w.toDay(1);
    const ready = await remember(s, { text: "0.3.46 ready to publish: tarball built and the sheet written.", status: "done" });
    w.toDay(2);
    await remember(s, { text: "0.3.48 released to npm.", status: "done" });
    await w.c.sessionEnd({ date: w.today(), budgetBytes: BUDGET, session: S });
    const pair = w.c.store.contradictions({ limit: 100 }).find((p) => p.source === INTERFERENCE_SOURCE && p.a === ready);
    expect(pair).toBeDefined();
    const u = undo(w.c.store, { pair: pair?.id ?? "", actor: "owner", why: "keep it", day: w.c.store.livedDay() });
    expect(u.ok).toBe(true);
    expect(fadeOf(w, ready)).toBe(1);
    w.toDay(3);
    await remember(s, { text: "0.3.50 released to npm.", status: "done" });
    const night = await w.c.sessionEnd({ date: w.today(), budgetBytes: BUDGET, session: S });
    expect(night.cycle.interfered.map((f) => f.over)).not.toContain(ready);
    expect(fadeOf(w, ready)).toBe(1);
  });

  test("same lived day is not newer; under observer nothing is written; the budget waits, counted", async () => {
    const w = world();
    const s = w.tools();
    w.toDay(1);
    const a = await remember(s, { text: "0.3.46 ready to publish: tarball built and the sheet written.", status: "done" });
    await remember(s, { text: "0.3.47 released to npm the same afternoon, after the label fix.", status: "done" });
    expect(interferenceSweep(w.c.store, { day: 1, apply: true, budget: 10 }).faded).toEqual([]);
    const b = await remember(s, { text: "0.3.47 after-publish steps: release notes pushed." });
    w.toDay(2);
    await remember(s, { text: "0.3.49 released to npm; the shop till updated cleanly.", status: "done" });
    // Under observer: what a night would fade (all three day-1 events), nothing written.
    const dry = interferenceSweep(w.c.store, { day: 2, apply: false, budget: 10 });
    expect(dry.faded.length).toBe(3);
    expect(dry.faded.map((f) => f.over)).toContain(a);
    expect(dry.faded.map((f) => f.over)).toContain(b);
    expect(pairs(w)).toEqual([]);
    expect(fadeOf(w, a)).toBe(1);
    // A budget of one: one fades, the other two wait, counted.
    const one = interferenceSweep(w.c.store, { day: 2, apply: true, budget: 1 });
    expect(one.faded.length).toBe(1);
    expect(one.skippedForLimit).toBe(2);
    const first = one.faded[0]?.over ?? "";
    expect(fadeOf(w, first)).toBeCloseTo(PHYSICS.CHANGED_FADE, 9);
    expect(dry.faded.filter((f) => fadeOf(w, f.over) < 1).length).toBe(1);
    // The next pass takes the rest; the faded one is not cut twice.
    const rest = interferenceSweep(w.c.store, { day: 2, apply: true, budget: 10 });
    expect(rest.faded.length).toBe(2);
    expect(rest.faded.map((f) => f.over)).not.toContain(first);
    for (const f of dry.faded) expect(fadeOf(w, f.over)).toBeCloseTo(PHYSICS.CHANGED_FADE, 9);
    expect(SLEEP.BUDGETS.interfere).toBeGreaterThan(0);
  });
});
