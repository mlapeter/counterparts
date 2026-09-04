#!/usr/bin/env bun
/**
 * `tools/visual-loop` — look at the dashboard, and fail on anything it says.
 *
 * The loop this exists to close: a dashboard is judged by eye, and a change that
 * silently breaks one panel is invisible to a suite of JSON assertions. So this
 * seeds its OWN stores, starts the real server on a free port, opens every page
 * and every tab in a real browser, screenshots each one, and exits non-zero on a
 * single console error or page error. Zero console errors is the bar; this is
 * what enforces it.
 *
 * **It never touches a real store.** Two temp directories are created and seeded
 * through `tools/demo` — whose own guard refuses `~/.counterparts`, `~/.bansai`
 * and the rest by name — and both are removed at the end unless `--keep`. There
 * is no flag that points this at an existing directory, deliberately: a
 * screenshot tool with a `--dir` is one typo away from publishing the owner's
 * memory.
 *
 * Usage:
 *
 *   ~/.bun/bin/bunx playwright install chromium      # once, per machine
 *   ~/.bun/bin/bun tools/visual-loop/shots.ts --out /tmp/shots
 *   ... --keep            leave the seeded stores in place and print their paths
 *   ... --headed          watch it work
 *
 * Output: one PNG per page per store per viewport in `--out`, plus `log.json`
 * with every console message and request failure the run saw.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import type { Browser, ConsoleMessage, Page } from "playwright";

import { Counterpart } from "../../src/core/counterpart.js";
import { startDashboard } from "../../src/adapters/dashboard/web/server.js";
import { seedDemo, seedEmpty } from "../demo/seed.js";

/** Desktop first — the screenshots in the README are 1440×900. */
const DESKTOP = { width: 1440, height: 900 };
/** The awkward middle. The flow diagram's silent text clipping and its
 *  colliding edge labels showed at this width and nowhere else, so it is now
 *  shot on every run rather than only when somebody thinks to look. */
const LAPTOP = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };

/** Every tab on the app page, plus the poster. */
const TABS = ["overview", "memories", "mind", "flow", "health"] as const;

interface Finding {
  readonly store: "rich" | "empty";
  readonly page: string;
  readonly kind:
    | "console"
    | "pageerror"
    | "requestfailed"
    | "response"
    | "overflow"
    | "contrast"
    | "stale";
  readonly text: string;
}

/** Text that must be readable, measured rather than eyeballed. */
interface Measured {
  readonly store: string;
  readonly page: string;
  readonly viewport: string;
  readonly innerWidth: number;
  readonly scrollWidth: number;
  readonly contrast: { selector: string; colour: string; on: string; ratio: number }[];
}

/** WCAG AA for the sizes this dashboard uses. */
const MIN_RATIO = 4.5;

interface Shot {
  readonly store: string;
  readonly page: string;
  readonly viewport: string;
  readonly file: string;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * A console message worth failing on. `error` and `warning` both count: a
 * warning in a page this small is a bug that has not bitten yet. Everything the
 * page prints on purpose would be a `log`, and it prints nothing.
 */
function isProblem(msg: ConsoleMessage): boolean {
  if (msg.type() !== "error" && msg.type() !== "warning") return false;
  // ONE named exemption, and it is the harness's, not the page's: taking a
  // screenshot of a live WebGL canvas makes the headless GPU read pixels back
  // mid-frame, and the driver logs a performance note about the stall. It is
  // emitted by `page.screenshot()` on the brain view and by nothing else. Named
  // as a string rather than waved through by type, so a real WebGL error still
  // fails the run.
  return !msg.text().includes("GPU stall due to ReadPixels");
}

/**
 * THE TWO THINGS A SCREENSHOT CANNOT TELL YOU, MEASURED IN THE PAGE.
 *
 *   - **Horizontal overflow.** The page body must never scroll sideways. A
 *     mobile emulator hides this by widening the layout viewport when content
 *     refuses to shrink, so `scrollLeft` stays 0 and the failure is invisible;
 *     `scrollWidth > innerWidth` is the honest test, and `innerWidth` itself is
 *     recorded because a 390 request that reports 448 has already failed.
 *   - **Contrast.** Computed colours against the first non-transparent
 *     background an ancestor actually paints, as a WCAG ratio. The narration
 *     lede and the per-memory metadata row are the text constitution line 16 is
 *     about; they were measured at 3.35:1 and 1.86:1 before this existed.
 */
const PROBE = `(() => {
  const px = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const c = px(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.05) return c;
      node = node.parentElement;
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const SELECTORS = [".lede", "nav a", ".rows .meta", "th", ".legend", ".badge", ".foot",
    ".tile .l", ".tile .s", ".gloss", ".story .said .k", ".fnode .sb", "#modal .sub .path"];
  const contrast = [];
  for (const sel of SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if ((el.textContent || "").trim().length === 0) continue;
      const fg = px(getComputedStyle(el).color);
      if (!fg) continue;
      const bg = bgOf(el);
      contrast.push({ selector: sel, colour: getComputedStyle(el).color, on: "rgb(" + bg.r + "," + bg.g + "," + bg.b + ")", ratio: Math.round(ratio(fg, bg) * 100) / 100 });
      break;
    }
  }
  return { innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, contrast };
})()`;

async function shoot(
  browser: Browser,
  url: string,
  store: "rich" | "empty",
  out: string,
  findings: Finding[],
  shots: Shot[],
  measures: Measured[],
): Promise<void> {
  for (const viewport of [DESKTOP, LAPTOP, PHONE]) {
    const label = `${viewport.width}x${viewport.height}`;
    // The phone pass is a layout check on the app page only; the poster is a
    // desktop artefact and a 390-wide hologram proves nothing.
    const pages: string[] = viewport === PHONE ? [...TABS] : [...TABS, "brain"];
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    wire(page, store, findings);

    for (const name of pages) {
      const target = name === "brain" ? `${url}/brain` : `${url}/#${name}`;
      await page.goto(target, { waitUntil: "domcontentloaded" });
      if (name === "brain") {
        // The poster either renders or says one sentence; both are a valid
        // screenshot, and both set the flag.
        await page.waitForFunction(() => document.documentElement.dataset["loaded"] === "1", null, {
          timeout: 20_000,
        });
        // A frame or two of the point cloud, so the shot is not an empty stage.
        await page.waitForTimeout(1600);
      } else {
        await page.waitForFunction(() => document.documentElement.dataset["loaded"] === "1", null, {
          timeout: 20_000,
        });
        // The hash is applied after boot when the page was opened cold.
        await page.evaluate((tab) => {
          location.hash = `#${tab}`;
          dispatchEvent(new HashChangeEvent("hashchange"));
        }, name);
        await page.waitForTimeout(450);
      }
      const file = join(out, `${store}-${name}-${label}.png`);
      await page.screenshot({ path: file, fullPage: viewport !== PHONE && name !== "brain" });
      shots.push({ store, page: name, viewport: label, file });
      process.stdout.write(`  ${store} · ${name} · ${label}\n`);

      // The brain view is a full-bleed canvas with its own fixed chrome; the
      // text probes below are about the dashboard's reading surfaces.
      if (name !== "brain") {
        const probe = (await page.evaluate(PROBE)) as Omit<Measured, "store" | "page" | "viewport">;
        measures.push({ store, page: name, viewport: label, ...probe });
        if (probe.scrollWidth > probe.innerWidth + 1) {
          findings.push({
            store,
            page: `${name} @ ${label}`,
            kind: "overflow",
            text: `the page scrolls sideways: scrollWidth ${probe.scrollWidth} > innerWidth ${probe.innerWidth}`,
          });
        }
        if (probe.innerWidth > viewport.width + 1) {
          findings.push({
            store,
            page: `${name} @ ${label}`,
            kind: "overflow",
            text: `the layout viewport widened to ${probe.innerWidth} for a ${viewport.width} request — content refused to shrink`,
          });
        }
        for (const c of probe.contrast) {
          if (c.ratio >= MIN_RATIO) continue;
          findings.push({
            store,
            page: `${name} @ ${label}`,
            kind: "contrast",
            text: `${c.selector} measures ${c.ratio}:1 (${c.colour} on ${c.on}) — AA needs ${MIN_RATIO}:1`,
          });
        }
      }

      // The click paths matter as much as the panels: a modal that throws is a
      // console error nobody sees until a stranger clicks. Exercised on the
      // desktop pass, and only where there is something to click.
      if (viewport === DESKTOP && store === "rich") {
        if (name === "overview") await modal(page, ".ev", `${store}-event-modal`, out, shots, label);
        if (name === "memories") await modal(page, "#hubs .r", `${store}-memory-modal`, out, shots, label);
        if (name === "flow") await nodePanel(page, out, shots, label, store);
      }
    }
    await context.close();
  }
}

/** Click the first `selector`, wait for the overlay, shoot it, close it. */
async function modal(
  page: Page,
  selector: string,
  name: string,
  out: string,
  shots: Shot[],
  label: string,
): Promise<void> {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) return;
  await target.click();
  await page.waitForSelector("#overlay.show", { timeout: 8000 });
  await page.waitForTimeout(250);
  const file = join(out, `${name}-${label}.png`);
  await page.screenshot({ path: file });
  shots.push({ store: name.split("-")[0] ?? "", page: name, viewport: label, file });
  process.stdout.write(`  ${name} · ${label}\n`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
}

/** The flow page's node panel — the brain-analogy half of the poster's claim. */
async function nodePanel(
  page: Page,
  out: string,
  shots: Shot[],
  label: string,
  store: string,
): Promise<void> {
  // Click inside the SLEEP box: normalized (0.60,0.10)-(0.76,0.27) of the canvas.
  const box = await page.locator("#flowcv").boundingBox();
  if (!box) return;
  const M = 10;
  await page.mouse.click(
    box.x + M + (0.60 + 0.16 / 2) * (box.width - 2 * M),
    box.y + M + (0.10 + 0.17 / 2) * (box.height - 2 * M),
  );
  await page.waitForTimeout(400);
  const file = join(out, `${store}-flow-node-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push({ store, page: "flow-node", viewport: label, file });
  process.stdout.write(`  ${store} · flow-node · ${label}\n`);
}

/**
 * ONE REAL EVENT, WATCHED FROM AN OPEN PAGE.
 *
 * Two claims this page makes can only be checked by making something happen
 * while somebody is looking:
 *
 *   - **Particles ride only on real events.** A still diagram is supposed to be
 *     a still machine, so the only way to see the animation is to cause one.
 *   - **The counters are live.** They were not: `/api/flow` was fetched once at
 *     boot, so a page left open reported yesterday's numbers beside today's
 *     feed. This asserts the number actually moves.
 *
 * The deposit goes through the real door of the loop's OWN temp store — the
 * same call `tools/demo/seed.ts` uses — with no embedder and no interpreter, so
 * it spends nothing and reaches no network.
 */
async function liveEvent(
  browser: Browser,
  url: string,
  dir: string,
  out: string,
  findings: Finding[],
  shots: Shot[],
): Promise<void> {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await context.newPage();
  wire(page, "rich", findings);
  try {
    await page.goto(`${url}/#flow`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset["loaded"] === "1", null, {
      timeout: 20_000,
    });
    await page.waitForTimeout(600);
    const readSleep = async (): Promise<string> =>
      (await page.evaluate(
        "window.flowState ? window.flowState('sleep') : ''",
      )) as string;
    const before = await readSleep();

    const c = Counterpart.open({ dir, owner: true });
    try {
      c.store.advanceClock("2026-07-13");
      await c.submitSessionEnd(
        {
          content:
            "The visual loop deposits one memory of its own so the diagram has something true to animate.",
          kind: "fact",
          title: "the loop's own deposit",
          salience: { relevance: 0.7, emotional: 0.4, predictive: 0.6 },
        },
        { session: "visual-loop", scope: "visual-loop" },
      );
      await c.sessionEnd({ date: "2026-07-13", at: "2026-07-13", budgetBytes: 9000 });
    } finally {
      c.close();
    }

    // Shoot WHILE the comet is in flight rather than after a fixed sleep: the
    // poll interval is 4s and a particle lives about 1.2s, so a fixed wait
    // photographs an empty diagram roughly two times in three.
    let sawParticle = false;
    for (let waited = 0; waited < 12_000; waited += 120) {
      const live = (await page.evaluate("window.particleCount ? window.particleCount() : 0")) as number;
      if (live > 0) { sawParticle = true; break; }
      await page.waitForTimeout(120);
    }
    const file = join(out, "rich-flow-live-event-1440x900.png");
    await page.screenshot({ path: file });
    if (!sawParticle) {
      findings.push({
        store: "rich",
        page: "flow @ live event",
        kind: "stale",
        text: "no particle was ever in flight after a real deposit — \"only particles mean activity\" has nothing to show",
      });
    }
    // Let the counters settle before reading them back.
    await page.waitForTimeout(1200);
    shots.push({ store: "rich", page: "flow-live-event", viewport: "1440x900", file });
    process.stdout.write("  rich · flow-live-event · 1440x900\n");

    const after = await readSleep();
    if (before === after) {
      findings.push({
        store: "rich",
        page: "flow @ live event",
        kind: "stale",
        text: `the sleep node still reads "${after}" after a real deposit — the counters are not refreshing`,
      });
    } else {
      process.stdout.write(`  sleep node: "${before}" → "${after}"\n`);
    }
  } finally {
    await context.close();
  }
}

function wire(page: Page, store: "rich" | "empty", findings: Finding[]): void {
  const where = (): string => page.url();
  page.on("console", (msg) => {
    if (!isProblem(msg)) return;
    findings.push({ store, page: where(), kind: "console", text: `${msg.type()}: ${msg.text()}` });
  });
  page.on("pageerror", (err) => {
    findings.push({ store, page: where(), kind: "pageerror", text: err.message });
  });
  page.on("requestfailed", (req) => {
    findings.push({
      store,
      page: where(),
      kind: "requestfailed",
      text: `${req.url()} — ${req.failure()?.errorText ?? "failed"}`,
    });
  });
  page.on("response", (res) => {
    // The dashboard's own origin only: the brain page's CDN import is allowed
    // to fail (it degrades to a sentence), and that failure is reported as a
    // request failure rather than as a broken page.
    if (!res.url().includes("127.0.0.1")) return;
    if (res.status() >= 400) {
      findings.push({ store, page: where(), kind: "response", text: `${res.status()} ${res.url()}` });
    }
  });
}

async function main(): Promise<number> {
  const out = flagValue("out") ?? mkdtempSync(join(tmpdir(), "counterparts-shots-"));
  mkdirSync(out, { recursive: true });

  const richDir = mkdtempSync(join(tmpdir(), "counterparts-vl-rich-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "counterparts-vl-empty-"));
  process.stdout.write(`seeding two stores of its own (never a real one)\n`);
  await seedDemo({ dir: richDir });
  seedEmpty({ dir: emptyDir });

  const findings: Finding[] = [];
  const shots: Shot[] = [];
  const measures: Measured[] = [];
  const browser = await chromium.launch({ headless: !flag("headed") });

  try {
    for (const [store, dir] of [
      ["rich", richDir],
      ["empty", emptyDir],
    ] as const) {
      const running = await startDashboard({ dir, port: 0 });
      process.stdout.write(`${store}: ${running.url} → ${running.dir}\n`);
      try {
        await shoot(browser, running.url, store, out, findings, shots, measures);
        // Only the rich store: the empty one is the never-lived case, and
        // depositing into it would make it something else.
        if (store === "rich") await liveEvent(browser, running.url, dir, out, findings, shots);
      } finally {
        await running.stop();
      }
    }
  } finally {
    await browser.close();
    if (!flag("keep")) {
      rmSync(richDir, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    } else {
      process.stdout.write(`kept: ${richDir}\nkept: ${emptyDir}\n`);
    }
  }

  writeFileSync(
    join(out, "log.json"),
    `${JSON.stringify({ at: new Date().toISOString(), shots, findings, measures }, null, 2)}\n`,
    "utf8",
  );

  // The worst reading on each selector, across every page and viewport — the
  // number to quote, rather than the best one.
  const worst = new Map<string, { ratio: number; colour: string; on: string }>();
  for (const m of measures) {
    for (const c of m.contrast) {
      const prior = worst.get(c.selector);
      if (prior === undefined || c.ratio < prior.ratio) {
        worst.set(c.selector, { ratio: c.ratio, colour: c.colour, on: c.on });
      }
    }
  }
  process.stdout.write("\ncontrast, worst reading per selector:\n");
  for (const [selector, c] of [...worst].sort((a, b) => a[1].ratio - b[1].ratio)) {
    process.stdout.write(`  ${c.ratio.toFixed(2)}:1  ${selector.padEnd(20)} ${c.colour} on ${c.on}\n`);
  }
  const widest = measures.reduce((a, m) => Math.max(a, m.innerWidth - m.scrollWidth >= 0 ? 0 : 1), 0);
  process.stdout.write(
    `\nlayout viewport at 390: ${[...new Set(measures.filter((m) => m.viewport === "390x844").map((m) => m.innerWidth))].join(", ")} ` +
      `(sideways-scrolling pages: ${widest === 0 ? "none" : widest})\n`,
  );

  process.stdout.write(`\n${shots.length} screenshots in ${out}\n`);
  if (findings.length === 0) {
    process.stdout.write("no console errors, no page errors, no failed requests, no overflow, no AA failures.\n");
    return 0;
  }
  process.stdout.write(`\n${findings.length} findings:\n`);
  for (const f of findings) process.stdout.write(`  [${f.store}] ${f.kind}: ${f.text}\n    at ${f.page}\n`);
  return 1;
}

process.exit(await main());
