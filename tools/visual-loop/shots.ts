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
 *   ~/.bun/bin/bun tools/visual-loop/shots.ts --out /tmp/shots --name fernbrook-demo
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
import { REQUIRE_EXPLICIT_DIR_ENV } from "../../src/core/store/index.js";
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
const TABS = ["home", "memories", "self", "flow", "health"] as const;

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
    | "tap"
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
  readonly taps: { selector: string; height: number }[];
}

/** WCAG AA for the sizes this dashboard uses. */
const MIN_RATIO = 4.5;
/** The minimum height of something a thumb has to hit, in CSS pixels. */
const MIN_TAP = 44;

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
  // emitted by `page.screenshot()` of the home page's brain and by nothing else. Named
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
    ".tile .l", ".tile .s", ".gloss", ".story .said .k", ".fnode .sb", "#modal .sub .path",
    ".mech-pill", ".mech-fam"];
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
  // TAP TARGETS. 44px is the minimum for something a thumb has to hit, and the
  // header's nav measured 29.2px — found by a reviewer with a ruler, which is
  // the wrong way to find it twice.
  const taps = [];
  for (const sel of ["nav a", ".hright a", ".mech-pill"]) {
    let worst = null;
    for (const el of document.querySelectorAll(sel)) {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if (worst === null || box.height < worst) worst = Math.round(box.height * 10) / 10;
    }
    if (worst !== null) taps.push({ selector: sel, height: worst });
  }
  return { innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, contrast, taps };
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
    // The brain lives on the home page now (2026-09-25); `/brain` only
    // redirects there, so there is no separate poster to shoot.
    const pages: string[] = [...TABS];
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    wire(page, store, findings);

    for (const name of pages) {
      await page.goto(`${url}/#${name}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset["loaded"] === "1", null, {
        timeout: 20_000,
      });
      // The hash is applied after boot when the page was opened cold.
      await page.evaluate((tab) => {
        location.hash = `#${tab}`;
        dispatchEvent(new HashChangeEvent("hashchange"));
      }, name);
      await page.waitForTimeout(450);
      if (name === "home") {
        // The brain either draws or says one calm sentence; both set the flag.
        // Then a frame or two of the point cloud, so the shot is not an empty stage.
        await page.waitForFunction(() => document.getElementById("home-brain")?.dataset["ready"] === "1", null, {
          timeout: 20_000,
        });
        await page.waitForTimeout(1600);
      }
      const file = join(out, `${store}-${name}-${label}.png`);
      await page.screenshot({ path: file, fullPage: viewport !== PHONE });
      shots.push({ store, page: name, viewport: label, file });
      process.stdout.write(`  ${store} · ${name} · ${label}\n`);

      // A FOLD SHOT BESIDE THE FULL PAGE, at the size the README publishes.
      // GitHub scales an image by width, so a full-page capture of a 1440 page
      // and a fold shot of the same page render at the same text size — the
      // full page just costs the reader a screen of scrolling through a wall of
      // grey to get past it. The fold is the one that reads as a product.
      if (viewport === DESKTOP) {
        const fold = join(out, `${store}-${name}-${label}-fold.png`);
        await page.screenshot({ path: fold });
        shots.push({ store, page: `${name}-fold`, viewport: label, file: fold });
      }

      // The text probes: every page, every viewport.
      {
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
        // Only on the phone: a mouse does not need 44px, and demanding it of a
        // desktop nav would be cargo cult.
        if (viewport === PHONE) {
          for (const t of probe.taps) {
            if (t.height >= MIN_TAP) continue;
            findings.push({
              store,
              page: `${name} @ ${label}`,
              kind: "tap",
              text: `${t.selector} is ${t.height}px tall on a phone — a thumb needs ${MIN_TAP}px`,
            });
          }
        }
      }

      // The click paths matter as much as the panels: a modal that throws is a
      // console error nobody sees until a stranger clicks. Exercised on the
      // desktop pass, and only where there is something to click.
      if (viewport === DESKTOP && store === "rich") {
        if (name === "home") await modal(page, ".ev", `${store}-event-modal`, out, shots, label);
        if (name === "memories") await modal(page, "#mlist .mrow", `${store}-memory-modal`, out, shots, label);
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
    const stateOf = async (key: string): Promise<string> =>
      (await page.evaluate(`window.flowState ? window.flowState('${key}') : ''`)) as string;
    /** Wait for a comet, and say whether one ever flew. The poll is 4s and a
     *  particle lives about 1.2s, so a fixed sleep photographs an empty diagram
     *  roughly two times in three. */
    const awaitParticle = async (): Promise<boolean> => {
      for (let waited = 0; waited < 12_000; waited += 120) {
        const live = (await page.evaluate("window.particleCount ? window.particleCount() : 0")) as number;
        if (live > 0) return true;
        await page.waitForTimeout(120);
      }
      return false;
    };
    /**
     * THE NODE'S STATE, RE-READ UNTIL IT MOVES — not read once after a sleep.
     *
     * The page polls every 4s and the readbacks below waited a fixed 1200ms, so
     * whether this check passed depended on where the deposit landed inside a
     * poll window: a single fixed sleep grades the sleep, not the page. It held
     * until 2026-09-05, when `gate.deposit` gave the authored door a durable
     * event and both note readbacks started failing. That was the fixture, not
     * the page — bisected by stubbing `recordDeposit` out on the same branch
     * (green again) and by waiting longer (green again, with the numbers moving)
     * — so what changed here is the wait, not the assertion. The exact
     * interleaving of the two poll fetches against the two writes is NOT pinned
     * down; what is measured is that the page does refresh and the old window
     * was too narrow to see it.
     *
     * The regression this check exists for — "a page left open reports the old
     * count forever" — still fails it: twelve seconds is three poll ticks, where
     * 1200ms was less than one.
     */
    const awaitState = async (key: string, was: string): Promise<string> => {
      let now = was;
      for (let waited = 0; waited < 12_000; waited += 250) {
        now = await stateOf(key);
        if (now !== was) return now;
        await page.waitForTimeout(250);
      }
      return now;
    };
    const before = await stateOf("sleep");

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

    const sawParticle = await awaitParticle();
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

    const after = await awaitState("sleep", before);
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

    // ── AND THE SECOND KIND OF DEPOSIT, which is the one that broke ──────────
    //
    // `counterparts note` writes NO durable event. The sequence the page polls
    // never moves, so before this was fixed the open page kept reporting the
    // old count indefinitely while the server already answered the new one —
    // straight after the console's flagship "remember this". These are the
    // console's own two calls, in its own order (`noteCommand`), with no
    // embedder and no interpreter, so it spends nothing.
    const noteBefore = { remember: await stateOf("remember"), store: await stateOf("store") };
    // AND THE PAGE THE DASHBOARD OPENS ON. The flow diagram was made live and
    // the overview was not: its tiles, its band bars and its identity panel
    // were painted once at boot and never again, so `memories held` on the
    // first screen of the product stayed frozen while the flow tab beside it
    // moved. Read off the DOM, not out of a payload — a page that never
    // repaints would still answer the payload correctly.
    const tileOf = async (label: string): Promise<string> =>
      (await page.evaluate(
        `window.tileValue ? window.tileValue(${JSON.stringify(label)}) : ""`,
      )) as string;
    const tileBefore = await tileOf("memories held");
    if (tileBefore === "") {
      findings.push({
        store: "rich",
        page: "home @ note",
        kind: "stale",
        text: "the 'memories held' tile could not be read from the open page — the staleness check would prove nothing",
      });
    }
    const jot = Counterpart.open({ dir, owner: true });
    let minted: string | null = null;
    try {
      const text =
        "A note typed at the console leaves no durable event, and the open page has to notice it anyway.";
      const captured = jot.captureJot({ session: "visual-loop", scope: "visual-loop", text });
      const ownSpanHash = captured.spans[0]?.hash ?? null;
      const deposit = await jot.submitJot(
        { content: text, kind: "fact", title: "the loop's own note" },
        { session: "visual-loop", scope: "visual-loop", ...(ownSpanHash === null ? {} : { ownSpanHash }) },
      );
      minted = deposit.deposited ? (deposit.memoryId ?? "(no id)") : null;
      if (!deposit.deposited) {
        findings.push({
          store: "rich",
          page: "flow @ note",
          kind: "stale",
          text: `the note was refused (${deposit.reason}) — the staleness check proved nothing this run`,
        });
      }
    } finally {
      jot.close();
    }
    if (minted !== null) {
      const noteParticle = await awaitParticle();
      const noteFile = join(out, "rich-flow-note-1440x900.png");
      await page.screenshot({ path: noteFile });
      shots.push({ store: "rich", page: "flow-note", viewport: "1440x900", file: noteFile });
      const noteAfter = {
        remember: await awaitState("remember", noteBefore.remember),
        store: await awaitState("store", noteBefore.store),
      };
      process.stdout.write(`  note ${minted}\n`);
      for (const key of ["remember", "store"] as const) {
        if (noteBefore[key] === noteAfter[key]) {
          findings.push({
            store: "rich",
            page: "flow @ note",
            kind: "stale",
            text: `the ${key} node still reads "${noteAfter[key]}" after a note deposited a memory — the page is reporting a number the server no longer agrees with`,
          });
        } else {
          process.stdout.write(`  ${key} node: "${noteBefore[key]}" → "${noteAfter[key]}"\n`);
        }
      }
      if (!noteParticle) {
        findings.push({
          store: "rich",
          page: "flow @ note",
          kind: "stale",
          text: "a note deposited a memory and no particle ever flew — the diagram showed nothing arriving",
        });
      }
      // The overview repaint is a SECOND request behind `/api/meta`, so give it
      // a few ticks of the 4s poll rather than one fixed sleep.
      let tileAfter = await tileOf("memories held");
      for (let waited = 0; waited < 14_000 && tileAfter === tileBefore; waited += 250) {
        await page.waitForTimeout(250);
        tileAfter = await tileOf("memories held");
      }
      if (tileBefore !== "" && tileAfter === tileBefore) {
        findings.push({
          store: "rich",
          page: "home @ note",
          kind: "stale",
          text: `the home page's 'memories held' tile still reads "${tileAfter}" after a note deposited a memory — the first screen of the product is reporting a number the server no longer agrees with`,
        });
      } else {
        process.stdout.write(`  memories held tile: "${tileBefore}" → "${tileAfter}"\n`);
      }
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
    // The dashboard's own origin only. Nothing else should be asked for at all
    // (three.js is vendored since 2026-09-25); a stray request elsewhere shows
    // up as a request failure rather than as a broken page.
    if (!res.url().includes("127.0.0.1")) return;
    if (res.status() >= 400) {
      findings.push({ store, page: where(), kind: "response", text: `${res.status()} ${res.url()}` });
    }
  });
}

async function main(): Promise<number> {
  // "It never touches a real store", enforced by the store as well as by this
  // file: with the explicit-dir guard armed, any open under here that lost its
  // `dir` is refused rather than pointed at `~/.counterparts/store` (I21).
  process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
  const out = flagValue("out") ?? mkdtempSync(join(tmpdir(), "counterparts-shots-"));
  mkdirSync(out, { recursive: true });

  // THE STORE'S NAME IS IN EVERY SCREENSHOT. The header chip shows the
  // basename, which was the round-2 fix — and a basename of
  // `counterparts-vl-rich-zjReXw` is still a temp path with the directory part
  // filed off. It wraps the chip row on a phone, and it is the first thing a
  // stranger reads in the README's images. So the parent stays a unique temp
  // dir (hermetic, collision-free) and the store itself gets a name a person
  // would give it.
  const parent = mkdtempSync(join(tmpdir(), "counterparts-vl-"));
  const name = flagValue("name") ?? "counterparts-demo";
  const richDir = join(parent, name);
  const emptyDir = join(parent, `${name}-empty`);
  mkdirSync(richDir, { recursive: true });
  mkdirSync(emptyDir, { recursive: true });
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
      rmSync(parent, { recursive: true, force: true });
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
  // The smallest thumb target on a phone, per selector — the same "quote the
  // worst reading" rule the contrast table follows.
  const taps = new Map<string, number>();
  for (const m of measures) {
    if (!m.viewport.startsWith(`${PHONE.width}x`)) continue;
    for (const t of m.taps) {
      const prior = taps.get(t.selector);
      if (prior === undefined || t.height < prior) taps.set(t.selector, t.height);
    }
  }
  if (taps.size > 0) {
    process.stdout.write(`\ntap targets at ${PHONE.width}, smallest per selector (${MIN_TAP}px minimum):\n`);
    for (const [selector, height] of [...taps].sort((a, b) => a[1] - b[1])) {
      process.stdout.write(`  ${String(height).padStart(5)}px  ${selector}\n`);
    }
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
