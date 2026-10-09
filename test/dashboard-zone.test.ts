/**
 * The dashboard dates in the zone the hooks use (review of #335, 2026-10-09).
 *
 * The hooks and the MCP server read the configuration's `timeZone`; the
 * dashboard read the machine's, and the browser its own. With a configured
 * zone that is not the machine's, one page showed two days for one moment:
 * the "recorded" chip (from the hooks) on one, the card's "Written" day and
 * the Health cycle line (from the browser) on the other.
 *
 * What this file proves, on a store whose configuration names a zone that is
 * NOT this machine's (Kiritimati, UTC+14, or UTC−12 when the machine is
 * Kiritimati — so the moment below is a different date in the two):
 *
 *   1. `Dashboard.open({ dir })` reads the zone beside the store, and every
 *      server view dates in it: the memory card's `writtenOn` and
 *      `writtenClock`, the Health cycle's `on`, an event's `when`, the fired
 *      panel's window.
 *   2. The browser prints the day it is handed: the card's "Written" line and
 *      details row, and the cycle line.
 *   3. `startDashboard({ config })` reads a NAMED configuration's zone, wherever
 *      the file is.
 *
 * Hermetic: every store and configuration is in a fresh temp dir, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zoneBeside, zoneOfConfig } from "../src/adapters/config.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { firedPanel } from "../src/adapters/dashboard/web/fired.js";
import { startDashboard } from "../src/adapters/dashboard/web/server.js";
import { eventDetail } from "../src/adapters/dashboard/web/views/activity.js";
import { healthView } from "../src/adapters/dashboard/web/views/health.js";
import { memoryDetail } from "../src/adapters/dashboard/web/views/memory.js";
import { PHASES } from "../src/core/sleep/types.js";
import { markerKey } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import { localClock, localClockZone, localDate, machineZone } from "../src/core/time.js";
import { seedEmpty } from "../tools/demo/seed.js";

// @ts-expect-error — a plain browser module, no declarations
import { dateWords } from "../src/adapters/dashboard/web/shared/dates.js";
// @ts-expect-error — a plain browser module, no declarations
import { when as cycleWhen } from "../src/adapters/dashboard/web/pages/health/sections/cycle.js";

/** The memory card touches `window` at load (`window.openMemory = …`); give it one. */
(globalThis as { window?: unknown }).window ??= globalThis;
const WEB = join(import.meta.dir, "..", "src", "adapters", "dashboard", "web");

/** A zone that is not this machine's, 20+ hours away from it. */
const CONFIG_ZONE = machineZone() === "Pacific/Kiritimati" ? "Etc/GMT+12" : "Pacific/Kiritimati";
/** 11:00 UTC: 01:00 the next day at UTC+14, 23:00 the day before at UTC−12, morning in Denver. */
const AT = Date.UTC(2026, 8, 28, 11, 0);

let temps: string[] = [];
beforeEach(() => {
  temps = [];
});
afterEach(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** `<base>/store`, a memory and a sleep written at `AT`, and the config beside it naming `zone`. */
function storeAt(zone: string | null): { base: string; dir: string; id: string; seq: number } {
  const base = mkdtempSync(join(tmpdir(), "counterparts-dash-zone-"));
  temps.push(base);
  const dir = join(base, "store");
  seedEmpty({ dir });
  if (zone !== null) writeFileSync(join(base, "claude-code.json"), JSON.stringify({ timeZone: zone }));
  // Written as the hooks write: in the configured zone.
  const w = Store.open({ dir, now: () => AT, ...(zone === null ? {} : { timeZone: zone }) });
  let id: string;
  let seq: number;
  try {
    w.advanceClock("2026-09-28");
    const day = w.livedDay();
    for (const phase of PHASES) w.setMeta(markerKey(phase), String(day));
    id = w.put({ type: "memory", kind: "fact", body: "The ward rota is published on Fridays.", source: "authored" });
    w.appendEvent({
      name: "sleep.cycle",
      day,
      payload: { reason: "ran", failed: 0, phases: [{ phase: "clock", status: "ran", reason: "ran" }, { phase: "decay", status: "ran", reason: "ran" }] },
    });
    seq = w.eventLog({ name: "sleep.cycle", order: "desc", limit: 1 })[0]?.seq ?? -1;
  } finally {
    w.close();
  }
  return { base, dir, id, seq };
}

describe("the dashboard dates in the configured zone", () => {
  test("the fixture's moment is a different day in the configured zone than on this machine", () => {
    // Without this the rest proves nothing: both readings would agree anyway.
    expect(localDate(AT, CONFIG_ZONE)).not.toBe(localDate(AT, machineZone()));
  });

  test("Dashboard.open reads the zone beside the store, and every server view dates in it", () => {
    const s = storeAt(CONFIG_ZONE);
    expect(zoneBeside(s.dir)).toBe(CONFIG_ZONE);
    const day = localDate(AT, CONFIG_ZONE);
    const dash = Dashboard.open({ dir: s.dir });
    try {
      expect(dash.store.zone()).toBe(CONFIG_ZONE);
      // The card: its written day and its clock, named.
      const m = memoryDetail(dash.source, s.id);
      expect(m.found).toBe(true);
      expect(m.writtenOn).toBe(day);
      expect(m.writtenClock).toBe(localClockZone(AT, CONFIG_ZONE));
      expect(m.writtenClock).not.toContain("UTC");
      // The hooks' "recorded" day is the same day: one page, one date.
      expect(m.learnedOn).toBe(day);
      // The Health cycle line.
      const h = healthView(dash.source);
      expect(h.cycle.at).toBe(AT);
      expect(h.cycle.on).toBe(day);
      expect(h.cycle.today).toBe(false);
      // An event opened from the activity feed.
      expect(eventDetail(dash.source, s.seq).when).toBe(localClock(AT, CONFIG_ZONE));
      // The fired panel names the calendar it counts by.
      expect(firedPanel(dash.source, dash.store.today()).zone).toBe(CONFIG_ZONE);
    } finally {
      dash.close();
    }
  });

  test("the page prints the day the server dated: the card and the cycle line", async () => {
    const s = storeAt(CONFIG_ZONE);
    const day = localDate(AT, CONFIG_ZONE);
    const dash = Dashboard.open({ dir: s.dir });
    try {
      const { memoryCard } = (await import(join(WEB, "shared/memory-modal.js"))) as { memoryCard(d: unknown): string };
      const html = memoryCard(memoryDetail(dash.source, s.id));
      const words = dateWords(day, { year: true }) as string;
      expect(html).toContain(`Written ${words}`);
      expect(html).toContain(`${words}, ${localClockZone(AT, CONFIG_ZONE)}`);
      // Not the machine's day, anywhere on the card.
      expect(html).not.toContain(`Written ${dateWords(localDate(AT, machineZone()), { year: true }) as string}`);
      const cycle = healthView(dash.source).cycle;
      expect(cycleWhen(cycle)).toBe(`on ${dateWords(day) as string} (lived day ${String(cycle.day)})`);
      expect(cycleWhen({ ...cycle, today: true })).toBe("today");
    } finally {
      dash.close();
    }
  });

  test("with no configuration beside the store, the machine's zone, as before", () => {
    const s = storeAt(null);
    const dash = Dashboard.open({ dir: s.dir });
    try {
      expect(dash.store.zone()).toBe(machineZone());
      expect(memoryDetail(dash.source, s.id).writtenOn).toBe(localDate(AT, machineZone()));
    } finally {
      dash.close();
    }
  });

  test("an explicit timeZone wins over the configuration beside the store", () => {
    const s = storeAt(CONFIG_ZONE);
    const dash = Dashboard.open({ dir: s.dir, timeZone: "UTC" });
    try {
      expect(dash.store.zone()).toBe("UTC");
    } finally {
      dash.close();
    }
  });

  test("startDashboard reads a NAMED configuration's zone, wherever it is", async () => {
    // Nothing beside the store: the zone can only have come from the named file.
    const s = storeAt(null);
    const named = join(s.base, "elsewhere.json");
    writeFileSync(named, JSON.stringify({ dataDir: s.dir, timeZone: CONFIG_ZONE, embedder: { enabled: false } }));
    expect(zoneOfConfig(named)).toBe(CONFIG_ZONE);
    const running = await startDashboard({ dir: s.dir, port: 0, config: named });
    try {
      const res = await fetch(`${running.url}/api/memory?id=${encodeURIComponent(s.id)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { writtenOn: string; writtenClock: string };
      expect(body.writtenOn).toBe(localDate(AT, CONFIG_ZONE));
      expect(body.writtenClock).toBe(localClockZone(AT, CONFIG_ZONE));
      const health = (await (await fetch(`${running.url}/api/health`)).json()) as { cycle: { on: string } };
      expect(health.cycle.on).toBe(localDate(AT, CONFIG_ZONE));
      const fired = (await (await fetch(`${running.url}/api/fired`)).json()) as { zone: string };
      expect(fired.zone).toBe(CONFIG_ZONE);
    } finally {
      await running.stop();
    }
  }, 60_000);

  test("an unreadable or absent configuration names no zone, and never throws", () => {
    const base = mkdtempSync(join(tmpdir(), "counterparts-dash-zone-bad-"));
    temps.push(base);
    expect(zoneOfConfig(join(base, "absent.json"))).toBeUndefined();
    writeFileSync(join(base, "broken.json"), "{ not json");
    expect(zoneOfConfig(join(base, "broken.json"))).toBeUndefined();
    writeFileSync(join(base, "offset.json"), JSON.stringify({ timeZone: "+05:30" }));
    expect(zoneOfConfig(join(base, "offset.json"))).toBeUndefined();
  });
});
