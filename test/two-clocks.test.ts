/**
 * The two clocks (LAUNCH-STATUS §I7).
 *
 * PHYSICS runs on LIVED DAYS — `livedDay()`, `bornDay`, decay, consolidation.
 * PROVENANCE runs on the WALL CLOCK — `learnedOn`, `happenedOn`, event `at`,
 * version `archived_at`, the removal record's `at`. The two must not be the same
 * clock and must not be read from the same place: the physics clock is advanced
 * by the host (`advanceClock`), the provenance clock is INJECTED by the session
 * (`now`), and neither of them is `Date.now()` read inside the mint path.
 *
 * Hermetic: every store here is a fresh `mkdtemp` removed in afterEach.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store, dateOf, today } from "../src/core/store/index.js";

/** 2025-03-14T09:00:00Z — nowhere near any day this suite could run on. */
const PINNED = Date.UTC(2025, 2, 14, 9, 0, 0);
const PINNED_DATE = "2025-03-14";
const DAY_MS = 86_400_000;

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-two-clocks-"));
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(now?: () => number): Store {
  const s = Store.open({ dir, ...(now === undefined ? {} : { now }) });
  open.push(s);
  return s;
}

describe("the provenance clock is injected, never ambient", () => {
  test("`put` dates a memory by the session's clock, not by the run day", () => {
    const s = store(() => PINNED);
    const id = s.put({ type: "memory", kind: "fact", body: "The pinned clock's memory." });
    expect(s.readProse(id).learnedOn).toBe(PINNED_DATE);
    expect(s.readProse(id).learnedOn).not.toBe(today());
  });

  test("an explicit `learnedOn` still wins over the clock", () => {
    const s = store(() => PINNED);
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "Dated by its caller.",
      learnedOn: "2024-01-02",
    });
    expect(s.readProse(id).learnedOn).toBe("2024-01-02");
  });

  test("`Store.today()` reads the injected clock", () => {
    expect(store(() => PINNED).today()).toBe(PINNED_DATE);
  });

  test("the durable event log's `at` is the injected clock", () => {
    const s = store(() => PINNED);
    s.appendEvent({ name: "test.event", day: 0 });
    const row = s.eventLog({ name: "test.event" })[0];
    expect(row?.at).toBe(PINNED);
  });

  test("a version's `archived_at` is the injected clock", () => {
    const s = store(() => PINNED);
    const id = s.put({ type: "memory", kind: "fact", body: "First state." });
    s.revise(id, { body: "Second state." });
    expect(s.versions(id)[0]?.archived_at).toBe(PINNED);
  });

  test("the removal record's `at` is the injected clock", () => {
    const s = store(() => PINNED);
    const id = s.put({ type: "memory", kind: "fact", body: "To be removed." });
    s.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner" });
    expect(s.removalRecord()[0]?.at).toBe(PINNED);
  });

  test("the in-process event ring's `at` is the injected clock", () => {
    const s = store(() => PINNED);
    s.put({ type: "memory", kind: "fact", body: "Emits store.put." });
    expect(s.events().every((e) => e.at === PINNED)).toBe(true);
  });

  test("with no clock injected, nothing moves: the default is still `Date.now`", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Ambient." });
    expect(s.readProse(id).learnedOn).toBe(today());
  });
});

describe("the physics clock is a different clock", () => {
  test("an injected wall clock does not advance a lived day", () => {
    let at = PINNED;
    const s = store(() => at);
    expect(s.livedDay()).toBe(0);
    at += 40 * DAY_MS;
    // Forty wall-clock days with no session lived: still lived day 0. This is
    // the whole reason for two clocks (`physics/clock.ts`, engram E8).
    expect(s.livedDay()).toBe(0);
    const id = s.put({ type: "memory", kind: "fact", body: "Born on lived day 0." });
    expect(s.physicsOf(id).birthDay).toBe(0);
    expect(s.readProse(id).learnedOn).toBe(dateOf(PINNED + 40 * DAY_MS));
  });

  test("advancing the physics clock does not date a memory", () => {
    const s = store(() => PINNED);
    s.advanceClock("2020-01-01");
    const id = s.put({ type: "memory", kind: "fact", body: "Lived day 1." });
    expect(s.physicsOf(id).birthDay).toBe(1);
    // The lived day moved; the DATE is still the session's wall clock.
    expect(s.readProse(id).learnedOn).toBe(PINNED_DATE);
  });
});

describe("the mint path never reads the ambient clock", () => {
  test("a deposited memory carries the session's date", async () => {
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, now: () => PINNED });
    open.push(c);
    const out = await c.submitJot(
      { content: "The kiln is fired on Tuesdays, never on Mondays.", kind: "fact" },
      { session: "s1", scope: "test" },
    );
    expect(out.deposited).toBe(true);
    const id = out.memoryId ?? "";
    expect(c.store.readProse(id).learnedOn).toBe(PINNED_DATE);
  });

  test("the memory carries the date the author deposited, not the date the row was written", async () => {
    let at = PINNED;
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, now: () => at });
    open.push(c);
    const out = await c.submitJot(
      { content: "A note taken on the day it was taken.", kind: "fact" },
      { session: "s1", scope: "test" },
    );
    const id = out.memoryId ?? "";
    expect(out.proposal).not.toBeNull();
    expect(c.store.readProse(id).learnedOn).toBe(dateOf(out.proposal?.at ?? 0));
    at += DAY_MS;
    const second = await c.submitJot(
      { content: "A second note, taken the day after the first one.", kind: "fact" },
      { session: "s1", scope: "test" },
    );
    expect(c.store.readProse(second.memoryId ?? "").learnedOn).toBe(dateOf(PINNED + DAY_MS));
  });

  /**
   * THE PATH THAT MATTERS MOST. The crash fallback writes rows on a LATER day
   * than the spans it read — a session that died on Tuesday is swept at
   * Wednesday's boundary — so it is the mint path where a wrong clock does the
   * most damage. The proposal it builds carries `nowFn()`, so a swept memory is
   * dated the day it was INTERPRETED. The spans' own instants are the candidate
   * `happenedOn` and are deliberately not derived; see NOTES 2026-09-05.
   */
  test("the crash fallback dates its memories by the session's clock too", async () => {
    let at = PINNED;
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, now: () => at });
    open.push(c);
    c.captureSpans({
      session: "s1",
      scope: "proj",
      turns: [
        {
          role: "user",
          text: "We settled the storage split today: canonical prose on disk, one small operational database, and a cache nobody backs up.",
        },
        {
          role: "assistant",
          text: "Recorded. The cache being rebuildable is what makes the backup set small enough to be honest about.",
        },
        {
          role: "user",
          text: "Right, and the reason it matters is that a backup you cannot verify is a backup you do not have.",
        },
      ],
    });
    c.boundary({ session: "s1", scope: "proj", kind: "pre-compaction" });
    // The session goes quiet, and the boundary that sweeps it happens the NEXT
    // day — the exact straddle a wall clock read at write time would get wrong.
    at += DAY_MS;
    const reports = await c.sweepFallback({
      interpret: async () => ({
        proposals: [
          {
            content:
              "The cache is rebuildable from canonical files, which is why it never enters the backup set.",
            kind: "fact",
          },
        ],
        stopReason: "end_turn",
      }),
    });
    expect(reports.some((r) => r.ran)).toBe(true);
    const minted = c.events("counterpart.sweep.minted");
    expect(minted).toHaveLength(1);
    const id = String(minted[0]?.ref ?? "");
    expect(c.store.readProse(id).learnedOn).toBe(dateOf(PINNED + DAY_MS));
  });

  test("no `Date.now()` survives in the mint path", async () => {
    // The totality half: `mint.ts` and the store's write sites route through the
    // injected clock. Read the sources rather than trusting the tests above.
    const src = await Bun.file(new URL("../src/core/mint.ts", import.meta.url)).text();
    expect(src.includes("Date.now()")).toBe(false);
    const storeSrc = await Bun.file(new URL("../src/core/store/index.ts", import.meta.url)).text();
    // Exactly one CALL of the ambient clock in the whole store, and it is the
    // module-level `today()` the adapters still use. Every write site — `put`,
    // `appendEvent`, `revise`, `supersede`, `appendRemovalRecord`, `emit` —
    // reads `this.nowFn()` instead.
    const calls = [...storeSrc.matchAll(/Date\.now\(\)/g)].length;
    expect(calls).toBe(1);
    expect(storeSrc.includes("return dateOf(Date.now());")).toBe(true);
  });

  test("a schema's `current-state` is dated by the store's clock", () => {
    const c = Counterpart.open({ dir, owner: true, budgetBytes: 20_000, now: () => PINNED });
    open.push(c);
    const born = c.schemas.mention({
      name: "Ondine",
      kind: "person",
      source: "Ondine showed up with the varnish again",
      chunkRef: "c1",
      day: 0,
    });
    const entityId = born.id ?? "";
    const placed = c.schemas.addCurrentState({
      entityId,
      statement: "She is restoring a wooden sailboat.",
      day: 0,
    });
    expect(placed.ok).toBe(true);
    expect(c.store.readProse(placed.id ?? "").happenedOn).toBe(PINNED_DATE);
  });
});
