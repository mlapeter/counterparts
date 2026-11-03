/**
 * RECALL'S GATE ROWS HAVE A LIVE SWEEP (2026-11-03).
 *
 * `Store#pruneGateSessions` existed from 2026-09-24 and, from 2026-10-13, had
 * no caller on a live path: every session's `gate_session` rows stayed forever.
 * The sleep cycle's `versions` phase calls it now, beside the version prune and
 * on the same lived-day window. These tests go through the doors that run it:
 * the worker's `runOnce` (Claude Code's and hosted's nightly run alike) and
 * `runCycle` itself.
 *
 * Hermetic (CLAUDE.md): one fresh temp root per test, holding the store and
 * its snapshots, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { DEFAULT_RETENTION_DAYS, Store } from "../src/core/store/index.js";
import { loadGateState, saveGateState } from "../src/core/recall/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-prunegate-"));
  dir = join(root, "store");
  mkdirSync(dir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** `n` consecutive ISO dates from 2026-01-01. */
function dates(n: number): string[] {
  const out: string[] = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** One session's gate state, as a recall turn on lived day `day` saves it. */
function seed(store: Store, sessionId: string, day: number, memoryId: string, credit?: { id: string; day: number }): void {
  const state = loadGateState(store, sessionId).state;
  state.turn = 3;
  state.lastDay = day;
  state.surfaced[memoryId] = { turn: 3, tier: "surfaced", trains: true };
  if (credit !== undefined) state.credited[credit.id] = { turn: 1, tier: "referenced", day: credit.day };
  saveGateState(store, state, 200);
}

describe("the worker's nightly run sweeps gate rows past the window", () => {
  test("old sessions go, recent and live ones stay, and the live one's gate still holds", async () => {
    // Lived days 1..100 on the store's own clock; the run below makes day 101,
    // so the cutoff is 101 - 90 = 11: rows stamped before day 11 go.
    const days = dates(101);
    const cp = Counterpart.open({ dir });
    for (const d of days.slice(0, 100)) cp.store.advanceClock(d);
    expect(cp.store.livedDay()).toBe(100);
    expect(cp.store.retentionDays).toBe(DEFAULT_RETENTION_DAYS);

    seed(cp.store, "old", 5, "mem_aaaaaaaaaaaa");
    seed(cp.store, "recent", 60, "mem_bbbbbbbbbbbb");
    // The live session's last turn was today, and it carries a credit from
    // lived day 2 — the one kind that keeps its own day, so it can go alone.
    seed(cp.store, "live", 100, "mem_cccccccccccc", { id: "mem_dddddddddddd", day: 2 });
    expect(cp.store.gateRecords("old").length).toBeGreaterThan(0);
    cp.close();

    const config: AdapterConfig = { dataDir: dir, snapshots: { dir: join(root, "snapshots") } };
    const report = await runOnce({ config, date: days[100] as string, embedder: null });
    expect(report.ran).toBe(true);

    const after = Store.open({ dir, observer: true });
    try {
      expect(after.livedDay()).toBe(101);
      // Idle past the window: every row gone, and the gate reads a fresh start.
      expect(after.gateRecords("old")).toEqual([]);
      expect(loadGateState(after, "old").status).toBe("absent");
      // Inside the window: untouched.
      const recent = loadGateState(after, "recent");
      expect(recent.status).toBe("loaded");
      expect(Object.keys(recent.state.surfaced)).toEqual(["mem_bbbbbbbbbbbb"]);
      // Live: its no-repeat record and turn count survive; only the stale
      // credit row (inert — a re-credit is refused on the same lived day only) went.
      const live = loadGateState(after, "live");
      expect(live.status).toBe("loaded");
      expect(live.state.turn).toBe(3);
      expect(Object.keys(live.state.surfaced)).toEqual(["mem_cccccccccccc"]);
      expect(live.state.credited).toEqual({});
    } finally {
      after.close();
    }
  });
});

describe("the versions phase calls the gate sweep", () => {
  test("it runs beside the version prune, says so in its own event, and leaves the phase's counts alone", () => {
    const s = Store.open({ dir, retentionDays: 2 });
    try {
      for (const d of dates(4)) s.advanceClock(d);
      seed(s, "old", 1, "mem_aaaaaaaaaaaa");
      seed(s, "today", 4, "mem_bbbbbbbbbbbb");
      const report = runCycle({ store: s, date: "2026-01-05" });
      const versions = report.phases.find((p) => p.phase === "versions");
      expect(versions?.status).toBe("ran-nothing-found");
      const ev = report.events.find((e) => e.name === "sleep.gate.pruned");
      expect(ev?.data).toMatchObject({ cutoffDay: 3, retentionDays: 2 });
      expect(Number(ev?.data?.["count"])).toBeGreaterThan(0);
      expect(s.gateRecords("old")).toEqual([]);
      expect(loadGateState(s, "today").status).toBe("loaded");
    } finally {
      s.close();
    }
  });

  test("an observer's cycle sweeps nothing", () => {
    const w = Store.open({ dir, retentionDays: 0 });
    for (const d of dates(3)) w.advanceClock(d);
    seed(w, "old", 1, "mem_aaaaaaaaaaaa");
    w.close();
    const o = Store.open({ dir, observer: true, retentionDays: 0 });
    try {
      const report = runCycle({ store: o, date: "2026-01-04" });
      expect(report.events.some((e) => e.name === "sleep.gate.pruned")).toBe(false);
      expect(o.gateRecords("old").length).toBeGreaterThan(0);
    } finally {
      o.close();
    }
  });
});
