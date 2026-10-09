/**
 * The memories tab refreshes live and closes nothing (2026-09-26, an experiment).
 *
 * In a real browser: choose the oldest-first order, the "both" filter and the
 * list's second page, pin a `?`, open a memory card, and scroll; then write a
 * memory into the store and force a refresh through the pulse's own hook
 * (`refreshCounters`). The list is redrawn — its count moves by one — and every
 * choice is still made, the card still open, the scroll where it was. A kind
 * chip chosen afterwards survives a refresh too.
 *
 * A SCENARIO, not a suite file: `test/dashboard-memories-live.test.ts` runs it
 * in a child `bun test`, so the suite's process never loads playwright (see
 * `test/live/harness.ts` for why). Run it alone with
 * `bun test ./test/live/dashboard-memories.live.ts`.
 *
 * Hermetic: a fresh temp store seeded through `tools/demo`, the dashboard on a
 * port the OS picks. Needs playwright's chromium (`bunx playwright install
 * chromium`); the harness skips the suite's test, and says so, on a machine
 * without it.
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
const feltIds: string[] = [];
/** Journal chapters, and each chapter's copy (the memory drawn from it). */
const chapterIds: string[] = [];
const copyOf = new Map<string, string>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-memories-live-"));
  await seedDemo({ dir });
  // Feelings for the radar: two of yours under happy (proud), one of mine under sad.
  const c = Counterpart.open({ dir, owner: true });
  try {
    const people = c.store.list({ type: "memory", kind: "person", archived: false });
    feltIds.push(...people.slice(0, 3));
    c.store.addFeelings(people[0] as string, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.8 }]);
    c.store.addFeelings(people[1] as string, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.6 }]);
    c.store.addFeelings(people[2] as string, [{ whose: "self", core: "sad", emotion: "lonely", strength: 0.4 }]);
    chapterIds.push(...c.store.list({ type: "episode", archived: false }));
    for (const id of c.store.list({ type: "memory", source: "episode", archived: false })) {
      const ref = c.store.row(id)?.origin_ref;
      if (typeof ref === "string") copyOf.set(ref, id);
    }
  } finally {
    c.close();
  }
  browser = await chromium.launch();
  running = await startDashboard({ dir, port: 0 });
});

afterAll(async () => {
  if (running !== null) await running.stop();
  if (browser !== null) await browser.close();
  rmSync(dir, { recursive: true, force: true });
});

function write(body: string, kind: "fact" | "person" = "fact"): void {
  const c = Counterpart.open({ dir, owner: true });
  try {
    c.store.put({ type: "memory", kind, body, source: "authored" });
  } finally {
    c.close();
  }
}

describe("the memories tab, live", () => {
  test("a refresh through the pulse redraws the list and closes nothing", async () => {
    const b = browser as Browser;
    const url = (running as RunningDashboard).url;
    const ctx = await b.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    // The list's range is said once, by the pager: "21–40 of 158" (round 4).
    const sub = async (): Promise<string> => (await page.textContent("#mpager")) ?? "";
    const total = async (): Promise<number> => Number(/\d+–\d+ of (\d+)/.exec(await sub())?.[1] ?? "-1");
    const RANGE = (n: number): string => "\\d+–\\d+ of " + n + "(?!\\d)";
    const refresh = (): Promise<void> => page.evaluate(async (path) => {
      const m = await import(path);
      await m.refreshCounters();
    }, "/shell/pulse.js");
    try {
      await page.goto(`${url}/#memories`);
      await page.waitForSelector("#mlist .mrow");
      expect(await page.locator(".q-wrap.open").count()).toBe(0);
      expect(await page.isHidden("#overlay.show")).toBe(true);

      // ── choose, page, pin, open, scroll ──
      await page.click('#msort button[data-sort="oldest"]');
      await page.waitForSelector('#msort button[data-sort="oldest"].on');
      await page.click('#mfilters button[data-f="state"][data-v="all"]');
      await page.waitForSelector('#mfilters button[data-f="state"][data-v="all"].on');
      await page.click('#mpager button[data-off="20"]');
      await page.waitForFunction(() => /page 2 of/.test(document.getElementById("mpager")?.textContent ?? ""));
      const firstOnPage2 = await page.locator("#mlist .mrow").first().getAttribute("data-id");
      await page.click('#hold-q .q-wrap[data-tip="hold"] .q');
      expect(await page.locator('.q-wrap.open[data-tip="hold"]').count()).toBe(1);
      await page.locator("#mlist .mrow").nth(3).click();
      await page.waitForSelector("#overlay.show .mc");
      const cardTitle = await page.textContent("#modal .mc-title");
      await page.waitForTimeout(600); // the pager's smooth scroll settles
      await page.evaluate(() => scrollTo(0, 900));
      const y = await page.evaluate(() => scrollY);
      expect(y).toBeGreaterThan(300);
      const before = await total();
      expect(before).toBeGreaterThan(100);

      // ── the store moves ──
      write("A memory written while the tab was open.");
      await refresh();
      await page.waitForFunction((re) => new RegExp(re).test(document.getElementById("mpager")?.textContent ?? ""), RANGE(before + 1));

      // ...and nothing closed.
      expect(await page.locator('#msort button[data-sort="oldest"].on').count()).toBe(1);
      expect(await page.locator('#mfilters button[data-f="state"][data-v="all"].on').count()).toBe(1);
      expect(await page.textContent("#mpager")).toContain("page 2 of");
      expect(await page.locator("#mlist .mrow").first().getAttribute("data-id")).toBe(firstOnPage2);
      expect(await page.locator('.q-wrap.open[data-tip="hold"]').count()).toBe(1);
      expect(await page.isVisible("#overlay.show .mc")).toBe(true);
      expect(await page.textContent("#modal .mc-title")).toBe(cardTitle);
      expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThanOrEqual(2);

      // A full redraw (the tab's own render) keeps them too.
      await page.evaluate(async (path) => {
        const m = await import(path);
        await m.default.render();
      }, "/pages/memories/index.js");
      expect(await page.textContent("#mpager")).toContain("page 2 of");
      expect(await page.locator('.q-wrap.open[data-tip="hold"]').count()).toBe(1);
      expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThanOrEqual(2);

      // A kind chip chosen now survives the next refresh.
      await page.keyboard.press("Escape");
      await page.click('#mfilters button[data-f="kind"][data-v="person"]');
      await page.waitForSelector('#mfilters button[data-f="kind"][data-v="person"].on');
      const persons = await total();
      write("Someone new, met while the tab was open.", "person");
      await refresh();
      await page.waitForFunction((re) => new RegExp(re).test(document.getElementById("mpager")?.textContent ?? ""), RANGE(persons + 1));
      expect(await page.locator('#mfilters button[data-f="kind"][data-v="person"].on').count()).toBe(1);
      expect(await page.locator('#msort button[data-sort="oldest"].on').count()).toBe(1);

      // A part of "How well I remember", clicked, filters the list — and survives too.
      await page.click('#hold .hkey.firm');
      await page.waitForSelector('#mfilters button[data-f="hold"][data-v="firm"].on');
      write("One more fact, written while the firm filter was on.");
      await refresh();
      expect(await page.locator("#hold .hkey.firm.on").count()).toBe(1);
      expect(await page.locator('#mfilters button[data-f="hold"][data-v="firm"].on').count()).toBe(1);
      expect(await page.locator('#mfilters button[data-f="kind"][data-v="person"].on').count()).toBe(1);
      // The page asked the server for the firm rows, and shows what it answered.
      const shown = await page.evaluate(async () => {
        const r = await fetch("/api/memories/list?state=all&kind=person&hold=firm&sort=oldest");
        return ((await r.json()) as { total: number }).total;
      });
      expect(await total()).toBe(shown);

      // ── the radar filters the list ──
      await page.click('#mfilters button[data-f="clear"]');
      await page.waitForFunction(() => !document.querySelector('#mfilters button[data-f="kind"].on'));
      // A feeling on the chart filters to every memory with a feeling under it,
      // and lights the same feeling's chip (round 4: one filter, two ways in).
      await page.click('#feel g.feel-axis[data-core="happy"] text');
      await page.waitForSelector('#mfilters button[data-f="feelingCore"][data-v="happy"].on');
      await page.waitForFunction(() => /\d+–\d+ of 2(?!\d)/.test(document.getElementById("mpager")?.textContent ?? ""));
      const happyIds = (await page.locator("#mlist .mrow").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id))).sort();
      expect(happyIds).toEqual(feltIds.slice(0, 2).sort());
      expect(await page.locator('#feel g.feel-axis[data-core="happy"].on').count()).toBe(1);
      // No readout of raw feeling words is pinned anywhere.
      expect(await page.locator("#feel-detail").count()).toBe(0);
      // It survives a refresh.
      write("A note written while the feeling filter was on.");
      await refresh();
      expect(await page.locator('#mfilters button[data-f="feelingCore"][data-v="happy"].on').count()).toBe(1);
      expect(await total()).toBe(2);
      // "show all" clears it, and nothing on the chart stays lit.
      await page.click('#mfilters button[data-f="clear"]');
      await page.waitForFunction(() => !document.querySelector('#mfilters button[data-f="feelingCore"].on'));
      expect(await page.locator("#feel g.feel-axis.on").count()).toBe(0);
      expect(await total()).toBeGreaterThan(2);

      // ── "facts" (the switch, 2026-10-09), then Enter, asks; the answers take the list's place.
      // A chapter and the memory drawn from it come back as ONE answer — the
      // chapter (facts mode folds the pair itself) — and a refresh keeps it ──
      expect(await page.getAttribute('#q-mode button[data-mode="word"]', "aria-pressed")).toBe("true");
      await page.click('#q-mode button[data-mode="facts"]');
      expect(await page.getAttribute("#q", "placeholder")).toContain("press Enter");
      await page.fill("#q", "the first day inside Halfmoon, reading the rota solver");
      await page.press("#q", "Enter");
      await page.waitForFunction(
        (ids) => ids.some((id) => document.querySelector(`#mlist .mrow[data-id="${id}"]`) !== null),
        chapterIds,
        { timeout: 30_000 },
      );
      expect(await page.isHidden("#mfilters")).toBe(true);
      const answers = async (): Promise<string[]> =>
        page.locator("#mlist .mrow").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? ""));
      const folded = await answers();
      const chapter = folded.find((id) => chapterIds.includes(id)) as string;
      // The memory drawn from the chapter is not also listed as an answer of its own.
      expect(folded).not.toContain(copyOf.get(chapter));
      expect(new Set(folded).size).toBe(folded.length);
      // Every match counted, ten a page, and a pager that asks for the next.
      const matched = Number(/^(\d+) memor/.exec((await page.textContent("#find-head")) ?? "")?.[1] ?? "-1");
      expect(matched).toBeGreaterThanOrEqual(folded.length);
      if (matched > folded.length) expect(await page.textContent("#mpager")).toContain(`1–${folded.length} of ${matched}`);
      // Facts mode (2026-10-03) answers with no confidence tiers, so no row
      // carries a tier label, and a journal answer is titled by its day.
      expect(await page.locator("#mlist .mtier").count()).toBe(0);
      expect(await page.textContent(`#mlist .mrow[data-id="${chapter}"] .mtitle`)).toContain("Journal · ");
      write("A fact written while the answer was open.");
      await refresh();
      expect(await answers()).toEqual(folded);
      if (matched > folded.length) {
        await page.click('#mpager button[data-ask-page="2"]');
        await page.waitForFunction(() => /page 2 of/.test(document.getElementById("mpager")?.textContent ?? ""), undefined, { timeout: 30_000 });
        expect((await answers()).some((id) => folded.includes(id))).toBe(false);
        await page.click('#mpager button[data-ask-page="1"]');
        await page.waitForFunction(() => /page 1 of/.test(document.getElementById("mpager")?.textContent ?? ""), undefined, { timeout: 30_000 });
        expect(await answers()).toEqual(folded);
      }
      // The chapter's row opens the chapter.
      await page.locator(`#mlist .mrow[data-id="${chapter}"]`).click();
      await page.waitForSelector("#overlay.show .mc");
      expect(await page.textContent("#modal .mc")).toContain("My journal, kept as written");
      await page.keyboard.press("Escape");

      // ── "by meaning" asks in meaning mode: a card's arc, its chapters in time
      // order, each opening its journal; a moment under one opens that memory ──
      await page.click('#q-mode button[data-mode="meaning"]');
      await page.fill("#q", "what has Halfmoon been to me");
      await page.press("#q", "Enter");
      await page.waitForSelector("#mlist .mmoment", { timeout: 30_000 });
      expect(await page.textContent("#find-head")).toMatch(/^Halfmoon · \d+ chapters?/);
      const arc = (await answers()).filter((id) => id.length > 0);
      expect(arc.length).toBeGreaterThan(0);
      for (const id of arc) expect(chapterIds).toContain(id);
      const moment = (await page.locator("#mlist .mmoment").first().getAttribute("data-open")) as string;
      await page.locator("#mlist .mmoment").first().click();
      await page.waitForSelector("#overlay.show .mc");
      const opened = await page.evaluate(async (id) => ((await (await fetch(`/api/memory?id=${id}`)).json()) as { title: string }).title, moment);
      if (opened) expect(await page.textContent("#modal .mc-title")).toContain(opened);
      await page.keyboard.press("Escape");

      // ── no sideways scroll, with the list, the answers and a card open ──
      for (const width of [1440, 1000, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator("#mlist .mrow").first().click();
        await page.waitForSelector("#overlay.show .mc");
        const w = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - innerWidth,
          modal: (document.getElementById("modal")?.scrollWidth ?? 0) - (document.getElementById("modal")?.clientWidth ?? 0),
        }));
        expect(w).toEqual({ page: 0, modal: 0 });
        await page.keyboard.press("Escape");
      }
      // The "×" gives the list back.
      await page.click("#q-x");
      await page.waitForSelector("#mfilters:not([hidden])");
      expect(await total()).toBeGreaterThan(2);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
