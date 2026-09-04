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

import { startDashboard } from "../../src/adapters/dashboard/web/server.js";
import { seedDemo, seedEmpty } from "../demo/seed.js";

/** Desktop first — the screenshots in the README are 1440×900. */
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Every tab on the app page, plus the poster. */
const TABS = ["overview", "memories", "mind", "flow", "health"] as const;

interface Finding {
  readonly store: "rich" | "empty";
  readonly page: string;
  readonly kind: "console" | "pageerror" | "requestfailed" | "response";
  readonly text: string;
}

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

async function shoot(
  browser: Browser,
  url: string,
  store: "rich" | "empty",
  out: string,
  findings: Finding[],
  shots: Shot[],
): Promise<void> {
  for (const viewport of [DESKTOP, PHONE]) {
    const label = viewport === DESKTOP ? "1440x900" : "390x844";
    // The phone pass is a layout check on the app page only; the poster is a
    // desktop artefact and a 390-wide hologram proves nothing.
    const pages: string[] = viewport === DESKTOP ? [...TABS, "brain"] : [...TABS];
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
      await page.screenshot({ path: file, fullPage: viewport === DESKTOP && name !== "brain" });
      shots.push({ store, page: name, viewport: label, file });
      process.stdout.write(`  ${store} · ${name} · ${label}\n`);
    }
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
  const browser = await chromium.launch({ headless: !flag("headed") });

  try {
    for (const [store, dir] of [
      ["rich", richDir],
      ["empty", emptyDir],
    ] as const) {
      const running = await startDashboard({ dir, port: 0 });
      process.stdout.write(`${store}: ${running.url} → ${running.dir}\n`);
      try {
        await shoot(browser, running.url, store, out, findings, shots);
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
    `${JSON.stringify({ at: new Date().toISOString(), shots, findings }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`\n${shots.length} screenshots in ${out}\n`);
  if (findings.length === 0) {
    process.stdout.write("no console errors, no page errors, no failed requests.\n");
    return 0;
  }
  process.stdout.write(`\n${findings.length} findings:\n`);
  for (const f of findings) process.stdout.write(`  [${f.store}] ${f.kind}: ${f.text}\n    at ${f.page}\n`);
  return 1;
}

process.exit(await main());
