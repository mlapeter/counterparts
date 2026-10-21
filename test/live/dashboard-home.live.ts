/**
 * The home tab refreshes live and closes nothing (round 4, 2026-09-28).
 *
 * In a real browser: the headline, the health dot, "Today", the radar and the
 * self map are drawn; then a memory is written while the page is open and the
 * pulse's own poll runs. The headline's count moves by one, the new memory is
 * the first line of "Today", the scroll stays where it was, and nothing on the
 * console complains. Then a click on the brain opens the Health tab's "How the
 * memory works" with that region's mechanism picked, and a cold load of that
 * address does the same.
 *
 * A SCENARIO, not a suite file: `test/dashboard-home-live.test.ts` runs it in a
 * child `bun test`, so the suite's process never loads playwright (see
 * `test/live/harness.ts` for why). Run it alone with
 * `bun test ./test/live/dashboard-home.live.ts`.
 *
 * Hermetic: a fresh temp store seeded through `tools/demo`, the dashboard on a
 * port the OS picks.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../../src/core/counterpart.js";
import { startDashboard } from "../../src/adapters/dashboard/web/server.js";
import type { RunningDashboard } from "../../src/adapters/dashboard/web/server.js";
import { seedDemo } from "../../tools/demo/seed.js";

import { chromium } from "playwright";
import type { Browser } from "playwright";

let browser: Browser | null = null;
let dir: string;
let running: RunningDashboard | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-home-live-"));
  await seedDemo({ dir });
  browser = await chromium.launch();
  running = await startDashboard({ dir, port: 0 });
});

afterAll(async () => {
  if (running !== null) await running.stop();
  if (browser !== null) await browser.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A memory written while the page is open. */
function storeMoves(): void {
  const c = Counterpart.open({ dir });
  try {
    c.store.put({ type: "memory", kind: "fact", body: "A memory written while the home tab was open." });
    c.store.appendEvent({ name: "gate.deposit", day: c.store.livedDay(), payload: { accepted: 1 } });
  } finally {
    c.close();
  }
}

describe("the home tab, live", () => {
  test("a poll after the store moves redraws the headline and Today, and closes nothing; the brain opens Health", async () => {
    const b = browser as Browser;
    const url = (running as RunningDashboard).url;
    const ctx = await b.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const count = (label: string): Promise<string> => page.evaluate((l) => (window as unknown as { homeCount(x: string): string }).homeCount(l), label);
    try {
      await page.goto(`${url}/#home`);
      await page.waitForSelector("#home-brain[data-ready]");
      await page.waitForSelector("#home-today .td-line");
      await page.waitForSelector("#home-feel svg.feel-svg, #home-feel .glance-empty");
      await page.waitForSelector("#home-map svg.sm-svg");

      // The headline: whose memory, how many; no mechanism score, no tiles, no feed, no pills.
      const headline = (await page.textContent("#home-headline")) ?? "";
      expect(headline).toMatch(/^Day \d+ with [A-Z][\w ]+ · \d+ memories( · \d+ new today)?$/);
      const before = Number(await count("memories"));
      expect(before).toBeGreaterThan(100);
      for (const gone of ["#ov-tiles", "#ov-feed", "#mech-strip", "#home-tonight", "#home-wr"]) {
        expect(`${gone}: ${await page.locator("#tab-home " + gone).count()}`).toBe(`${gone}: 0`);
      }
      expect(await page.locator("#home-health").getAttribute("href")).toBe("#health");
      // The header carries no chip (round 4 Memories, M8: looking changes nothing, and says nothing about it).
      expect(await page.locator("header .badge").count()).toBe(0);
      // No point's name shows until it is hovered.
      expect(await page.locator(".brain-pin-name:visible").count()).toBe(0);

      // ── scroll, then the store moves and the pulse polls ──
      await page.evaluate(() => scrollTo(0, 400));
      const y = await page.evaluate(() => scrollY);
      expect(y).toBeGreaterThan(200);
      storeMoves();
      await page.evaluate(async (path) => {
        const m = await import(path);
        await m.poll();
      }, "/shell/pulse.js");
      await page.waitForFunction((n) => (window as unknown as { homeCount(x: string): string }).homeCount("memories") === String(n + 1), before);
      expect(await page.textContent("#home-today-h")).toBe("Today");
      expect(await page.locator("#home-today .td-line").first().textContent()).toContain("A memory written while the home tab was open.");
      expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThanOrEqual(2);

      // A line opens the memory's card, not a record.
      await page.locator("#home-today button.td-link").first().click();
      await page.waitForSelector("#modal .mc-title");
      expect(await page.textContent("#modal .mc-title")).toContain("A memory written while the home tab was open.");
      await page.keyboard.press("Escape");

      // ── the brain: a region opens its mechanism on Health ──
      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('.brain-pin[data-key="hippocampus"]').click({ force: true });
      await page.waitForFunction(() => location.hash === "#health/mechanisms?id=consolidation");
      await page.waitForSelector('#mech-strip .mech-pill[data-id="consolidation"].is-on');
      expect(await page.textContent("#mech-title")).toContain("Consolidation");
      expect(await page.isVisible("#tab-health")).toBe(true);
      expect(errors).toEqual([]);

      // ── and a cold load of that address ──
      const cold = await ctx.newPage();
      await cold.goto(`${url}/#health/mechanisms?id=salience`);
      await cold.waitForSelector('#mech-strip .mech-pill[data-id="salience"].is-on');
      expect(await cold.textContent("#h-mechanisms-h")).toBe("How the memory works");
      await cold.close();
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
