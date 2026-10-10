/**
 * `mechanism-evidence.ts` — the one "did it fire" judgement the dashboard's
 * lights and `counterparts mechanisms` both call (2026-09-26, an experiment).
 *
 * What it keeps: the two surfaces agree, mechanism by mechanism, on a seeded
 * store; a scheduled phase that ran on time reads as waiting on both, never as
 * quiet; built / partly / not is one table.
 *
 * Hermetic: every store is a temp dir this file creates and removes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { markerKey } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { MEMORY_MECHANISMS, consoleVerdicts, readMechanism } from "../src/adapters/cli/mechanisms.js";
import { firedReport } from "../src/adapters/fired.js";
import { MECHANISM_EVIDENCE, builtCount, firingKey, mechanismEvidence } from "../src/adapters/mechanism-evidence.js";
import { seedDemo } from "../tools/demo/seed.js";

const temps: string[] = [];
const tempDir = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
let richDir: string;

beforeAll(async () => {
  richDir = tempDir("counterparts-evidence-rich-");
  await seedDemo({ dir: richDir });
});

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** The dashboard's status, in the console's three lights. */
const AS_CONSOLE: Record<string, string> = { green: "●", waiting: "◐", amber: "◐", grey: "○" };

/** Both surfaces, one store: id → [dashboard light, console light]. */
function bothLights(dir: string, today: string): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  const dash = Dashboard.open({ dir });
  try {
    for (const m of mechanismsView(dash.source).mechanisms) out.set(m.id, [AS_CONSOLE[m.status] ?? "?", ""]);
  } finally {
    dash.close();
  }
  const s = Store.open({ dir, observer: true });
  try {
    const report = firedReport(s, today);
    const byId = new Map(report.rows.map((r) => [r.id, r]));
    const verdicts = consoleVerdicts(s, today);
    for (const m of MEMORY_MECHANISMS) {
      const pair = out.get(m.id);
      if (pair !== undefined) pair[1] = readMechanism(m, verdicts, (id) => byId.get(id)).light;
    }
  } finally {
    s.close();
  }
  return out;
}

describe("one judgement, two surfaces", () => {
  test("every console line names a mechanism of the shared table, once", () => {
    expect(MEMORY_MECHANISMS.map((m) => m.id).sort()).toEqual(MECHANISM_EVIDENCE.map((m) => m.id).sort());
  });

  test("the dashboard and the console agree on every light, on the demo store", () => {
    // The demo store's calendar ends on its last active date, so the console's
    // calendar week is anchored there; the two windows then cover the same rows.
    const s = Store.open({ dir: richDir, observer: true });
    const today = s.getMeta("lastActiveDate") ?? "";
    s.close();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const lights = bothLights(richDir, today);
    expect(lights.size).toBe(12);
    for (const [id, [dash, cli]] of lights) expect(`${id}: ${cli}`).toBe(`${id}: ${dash}`);
    // And the store has something of each light to agree on.
    const seen = new Set([...lights.values()].map(([d]) => d));
    expect(seen).toEqual(new Set(["●", "◐", "○"]));
  });

  test("consolidation, not due: its phase ran on time, so both say waiting with the next run", () => {
    const dir = tempDir("counterparts-evidence-sched-");
    const TODAY = "2026-01-12";
    const c = Counterpart.open({ dir, owner: true });
    let day = 0;
    try {
      for (let i = 1; i <= 12; i++) c.store.advanceClock(`2026-01-${String(i).padStart(2, "0")}`);
      day = c.store.livedDay();
      // The consolidate phase last completed yesterday; it runs every 3 lived days.
      c.store.setMeta(markerKey("consolidate"), String(day - 1));
    } finally {
      c.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const m = mechanismsView(dash.source).mechanisms.find((x) => x.id === "consolidation")!;
      expect(m.status).toBe("waiting");
      expect(m.nextInDays).toBe(2);
      expect(m.evidence).toContain(`lived day ${day - 1}`);
      expect(m.evidence).toContain("next run in 2 lived days");
    } finally {
      dash.close();
    }
    const s = Store.open({ dir, observer: true });
    try {
      const report = firedReport(s, TODAY);
      const byId = new Map(report.rows.map((r) => [r.id, r]));
      const cons = MEMORY_MECHANISMS.find((m) => m.id === "consolidation")!;
      const line = readMechanism(cons, consoleVerdicts(s, TODAY), (id) => byId.get(id));
      expect(line.light).toBe("◐");
      expect(line.says).toContain("next run in 2 lived days");
    } finally {
      s.close();
    }
  });

  test("a phase far behind its schedule is quiet (amber), not waiting", () => {
    const dir = tempDir("counterparts-evidence-late-");
    const c = Counterpart.open({ dir, owner: true });
    try {
      for (let i = 1; i <= 12; i++) c.store.advanceClock(`2026-01-${String(i).padStart(2, "0")}`);
      c.store.setMeta(markerKey("consolidate"), String(c.store.livedDay() - 6));
    } finally {
      c.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      expect(mechanismsView(dash.source).mechanisms.find((x) => x.id === "consolidation")?.status).toBe("amber");
    } finally {
      dash.close();
    }
  });
});

describe("dreaming: core suggestions are said apart from changes (2026-09-27)", () => {
  test("a nomination is not counted among a dream's changes, on either surface", () => {
    const dir = tempDir("counterparts-evidence-dream-");
    const TODAY = "2026-01-12";
    const c = Counterpart.open({ dir, owner: true });
    try {
      for (let i = 1; i <= 12; i++) c.store.advanceClock(`2026-01-${String(i).padStart(2, "0")}`);
      const day = c.store.livedDay();
      const row = (name: string, payload: Record<string, number>): void => {
        c.store.appendEvent({ name, day, ref: null, payload: { date: TODAY, ...payload } });
      };
      // Two dreams: 63 changes applied, 3 of them nominations.
      row("dream.changed", { applied: 40, refused: 1, merge: 8, link: 30, "nominate-core": 2 });
      row("dream.changed", { applied: 23, refused: 0, link: 22, "nominate-core": 1 });
      row("dream.journaled", { chars: 400 });
      row("dream.journaled", { chars: 300 });
    } finally {
      c.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const m = mechanismsView(dash.source).mechanisms.find((x) => x.id === "dreaming")!;
      expect(m.status).toBe("green");
      expect(m.evidence).toContain("2 dreams, 60 changes dreams made, 3 core suggestions");
      expect(m.evidence).not.toContain("63");
    } finally {
      dash.close();
    }
    const s = Store.open({ dir, observer: true });
    try {
      const report = firedReport(s, TODAY);
      const byId = new Map(report.rows.map((r) => [r.id, r]));
      const dreaming = MEMORY_MECHANISMS.find((m) => m.id === "dreaming")!;
      const line = readMechanism(dreaming, consoleVerdicts(s, TODAY), (id) => byId.get(id));
      expect(line.light).toBe("●");
      expect(line.says).toBe("2 dreams this week (60 changes, 3 core suggestions)");
    } finally {
      s.close();
    }
  });

  test("a dream that only suggested reads as suggestions, with no changes", () => {
    const dir = tempDir("counterparts-evidence-dream-only-");
    const TODAY = "2026-01-12";
    const c = Counterpart.open({ dir, owner: true });
    try {
      for (let i = 1; i <= 12; i++) c.store.advanceClock(`2026-01-${String(i).padStart(2, "0")}`);
      const day = c.store.livedDay();
      c.store.appendEvent({ name: "dream.changed", day, ref: null, payload: { date: TODAY, applied: 1, "nominate-core": 1 } });
      c.store.appendEvent({ name: "dream.journaled", day, ref: null, payload: { date: TODAY, chars: 100 } });
    } finally {
      c.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const m = mechanismsView(dash.source).mechanisms.find((x) => x.id === "dreaming")!;
      expect(m.evidence).toContain("1 dream, 1 core suggestion in the last");
      expect(m.evidence).not.toContain("change");
    } finally {
      dash.close();
    }
    const s = Store.open({ dir, observer: true });
    try {
      const report = firedReport(s, TODAY);
      const byId = new Map(report.rows.map((r) => [r.id, r]));
      const dreaming = MEMORY_MECHANISMS.find((m) => m.id === "dreaming")!;
      expect(readMechanism(dreaming, consoleVerdicts(s, TODAY), (id) => byId.get(id)).says).toBe("1 dream this week (1 core suggestion)");
    } finally {
      s.close();
    }
  });
});

describe("built / partly / not", () => {
  test("one table; a mechanism not built claims no proof, a built one names some", () => {
    for (const m of MECHANISM_EVIDENCE) {
      expect(["built", "partly", "not"]).toContain(m.build);
      if (m.build === "not") expect(m.proofs.length).toBe(0);
      else expect(m.proofs.length).toBeGreaterThan(0);
    }
    expect(builtCount()).toBe(MECHANISM_EVIDENCE.filter((m) => m.build !== "not").length);
  });

  test("the client modules carry no tag of their own: the pills read `build` from the view", async () => {
    const path = fileURLToPath(new URL("../src/adapters/dashboard/web/mechanisms/index.js", import.meta.url));
    const index = (await import(path)) as { MECHANISMS: Record<string, unknown>[] };
    for (const m of index.MECHANISMS) expect(`${String(m["id"])}: ${"inDev" in m}`).toBe(`${String(m["id"])}: false`);
  });
});

describe("firedToday (2026-10-10, the sidebar's times fired today)", () => {
  test("by default today is the window's lived day; a surface may hand in its own; a dream's rows are one firing", () => {
    const dir = tempDir("counterparts-evidence-today-");
    const c = Counterpart.open({ dir, owner: true });
    try {
      for (let i = 1; i <= 5; i++) c.store.advanceClock(`2026-02-${String(i).padStart(2, "0")}`);
      const day = c.store.livedDay();
      c.store.appendEvent({ name: "band.transition", day: day - 1, payload: { site: "decay", direction: "down" } });
      c.store.appendEvent({ name: "band.transition", day, payload: { site: "decay", direction: "down" } });
      c.store.appendEvent({ name: "band.transition", day, payload: { site: "decay", direction: "up" } });
      c.store.appendEvent({ name: "dream.journaled", day, ref: "drm_a", payload: { chars: 10 } });
      c.store.appendEvent({ name: "dream.changed", day, ref: "drm_a", payload: { applied: 3, "nominate-core": 1 } });
      c.store.appendEvent({ name: "dream.journaled", day, ref: "drm_b", payload: { chars: 10 } });
    } finally {
      c.close();
    }
    const s = Store.open({ dir, observer: true });
    try {
      const day = s.livedDay();
      const by = (w: Parameters<typeof mechanismEvidence>[1]): Record<string, number | null> =>
        Object.fromEntries(mechanismEvidence(s, w).verdicts.map((v) => [v.id, v.firedToday]));
      const lived = by({ sinceDay: day - 6, today: day });
      expect(lived["decay"]).toBe(1); // yesterday's fade, and a crossing up, are not today's fades
      expect(lived["dreaming"]).toBe(2); // two dreams in three rows
      expect(lived["schema"]).toBeNull();
      const none = by({ sinceDay: day - 6, today: day, isToday: () => false });
      expect(none["decay"]).toBe(0);
      expect(none["dreaming"]).toBe(0);
    } finally {
      s.close();
    }
  });

  test("firingKey: a dream's rows share one key; every other row is its own", () => {
    const row = (seq: number, name: string, ref: string | null) => ({ seq, at: 0, day: 1, name, ref, dedup_key: null, payload: null });
    expect(firingKey(row(1, "dream.journaled", "drm_x"))).toBe(firingKey(row(2, "dream.changed", "drm_x")));
    expect(firingKey(row(3, "dream.changed", null))).not.toBe(firingKey(row(4, "dream.changed", null)));
    expect(firingKey(row(5, "contradiction.settled", "ctr_y"))).not.toBe(firingKey(row(6, "contradiction.settled", "ctr_y")));
  });
});
