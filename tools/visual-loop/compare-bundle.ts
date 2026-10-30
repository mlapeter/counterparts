#!/usr/bin/env bun
/**
 * `tools/visual-loop/compare-bundle.ts` — the dashboard of a BUILT plugin bundle,
 * pixel for pixel against the source tree's (or another bundle's).
 *
 * What a bundle's build rewrites exists only in the bundle, and CI tests the
 * source, so a mistake there would show only in a flavor nobody runs daily. So:
 * one seeded store, read by both sides; each side's own console started through
 * its real door (`dashboard --dir --port 0 --no-open`, in a throwaway HOME); every
 * tab at three sizes on the seeded store and the empty one, plus one memory opened
 * in the modal. It fails on any pixel that differs, on any difference in the parsed rules in their cascade order
 * (which reaches what a still picture doesn't: hover, a dialog nobody opened, a
 * width not shot), and on any console error, page error or failed request.
 *
 * A side that carries three.js has the brain turned off in its page, the way the
 * server does where the library is absent (`server.ts#withBrainSwitch`): the
 * directory flavor has no brain picture, and an animated point cloud is not
 * comparable anyway. The brain itself is shot by `shots.ts`.
 *
 * Two comparisons, and they prove different things:
 *
 *   - `--against <a bundle built before the change>`: two bundles of one flavor,
 *     each answering from its own server. Nothing is stood in for, so every pixel
 *     has to match.
 *   - no `--against`, the source tree: the health card's words are rightly each
 *     tree's own (a checkout reports its commit and changes, and the directory
 *     flavor never reads ~/.claude.json), so the bundle's page is given the source
 *     server's `/api/` answers. What is compared is the page: its files and its look.
 *
 *   ~/.bun/bin/bun tools/plugin-bundle/build.ts --flavor directory /tmp/b
 *   ~/.bun/bin/bun tools/visual-loop/compare-bundle.ts --bundle /tmp/b [--against /tmp/a] [--out /tmp/shots]
 *
 * It calls no model, and has no flag that names a store: it only ever opens the
 * two it seeds.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { REQUIRE_EXPLICIT_DIR_ENV } from "../../src/core/store/index.js";
import { seedDemo, seedEmpty } from "../demo/seed.js";

const REPO = resolve(import.meta.dir, "../..");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const TABS = ["home", "memories", "subjects", "self", "flow", "health"];
const BRAIN_ON = `<meta name="counterparts-brain" content="on">`;
const BRAIN_OFF = `<meta name="counterparts-brain" content="off">`;
/** One clock for both sides, so "3 minutes ago" reads the same on each. */
const NOW = new Date();

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Side {
  readonly label: string;
  readonly root: string;
  readonly hasBrain: boolean;
  url: string;
  child: ChildProcess | null;
}

function side(label: string, root: string): Side {
  return { label, root, hasBrain: existsSync(join(root, "src/adapters/dashboard/web/shared/vendor/three.module.min.js")), url: "", child: null };
}

/** The side's own console, as a person would run it: the directory flavor's
 *  entry by its path and shebang, anything else its TypeScript under Bun. */
async function start(s: Side, store: string, home: string): Promise<void> {
  const js = join(s.root, "src/adapters/cli/bin/counterparts.js");
  const args = ["dashboard", "--dir", store, "--port", "0", "--no-open"];
  const [cmd, argv] = existsSync(js) ? [js, args] : [process.execPath, [join(s.root, "src/adapters/cli/bin/counterparts.ts"), ...args]];
  const child = spawn(cmd, argv, {
    cwd: home,
    env: { PATH: `${dirname(process.execPath)}:${process.env["PATH"] ?? ""}`, HOME: home, [REQUIRE_EXPLICIT_DIR_ENV]: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.child = child;
  let said = "";
  s.url = await new Promise<string>((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`${s.label}: no dashboard after 30s: ${said}`)), 30_000);
    const hear = (chunk: Buffer): void => {
      said += chunk.toString();
      const m = /Dashboard: (http\S+)/.exec(said);
      if (m !== null) {
        clearTimeout(timer);
        res(m[1]!);
      }
    };
    child.stdout!.on("data", hear);
    child.stderr!.on("data", hear);
    child.on("exit", (code) => rej(new Error(`${s.label}: the dashboard exited (${String(code)}): ${said}`)));
  });
}

async function stop(s: Side): Promise<void> {
  const child = s.child;
  if (child === null || child.exitCode !== null) return;
  await new Promise<void>((res) => {
    child.removeAllListeners("exit");
    child.on("exit", () => res());
    child.kill("SIGTERM");
  });
}

/** A page on one side, its failures going to `problems`; `answers`, when given,
 *  is the side whose server answers its `/api/` requests. */
async function open(browser: Browser, s: Side, viewport: { width: number; height: number }, problems: string[], answers?: Side): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const where = (): string => `${s.label} ${page.url()}`;
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${where()}: console ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${where()}: page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`${where()}: request failed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${where()}: ${String(r.status())} ${r.url()}`);
  });
  if (s.hasBrain) {
    await page.route(
      (u) => u.pathname === "/",
      async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, body: (await res.text()).replace(BRAIN_ON, BRAIN_OFF) });
      },
    );
  }
  if (answers !== undefined) {
    await page.route(
      (u) => u.pathname.startsWith("/api/"),
      async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        // The health card's doctor is a POST, which wants that server's token and origin.
        const shell = await (await fetch(`${answers.url}/`)).text();
        const token = /counterparts-action-token" content="([^"]*)"/.exec(shell)?.[1] ?? "";
        const res = await fetch(`${answers.url}${u.pathname}${u.search}`, {
          method: req.method(),
          headers: { "content-type": "application/json", origin: answers.url, "x-counterparts-token": token },
          ...(req.method() === "GET" ? {} : { body: req.postData() ?? "" }),
        });
        await route.fulfill({ status: res.status, contentType: res.headers.get("content-type") ?? "application/json", body: await res.text() });
      },
    );
  }
  return page;
}

async function showTab(page: Page, url: string, tab: string): Promise<void> {
  await page.goto(`${url}/#${tab}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset["loaded"] === "1", null, { timeout: 20_000 });
  await page.evaluate((t) => {
    location.hash = `#${t}`;
    dispatchEvent(new HashChangeEvent("hashchange"));
  }, tab);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(600);
}

/** Every parsed rule, in cascade order, and how many stylesheets carried them. */
async function parsedRules(page: Page): Promise<{ sheets: number; rules: string[] }> {
  return page.evaluate(() => ({
    sheets: document.styleSheets.length,
    rules: [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)),
  }));
}

/** Pixels that differ between two PNGs, counted in the browser (no PNG decoder here). */
async function differingPixels(browser: Browser, a: Buffer, b: Buffer): Promise<number> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([x, y]) => {
        const load = async (src: string): Promise<ImageData> => {
          const img = new Image();
          img.src = `data:image/png;base64,${src}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, c.width, c.height);
        };
        const [p, q] = [await load(x!), await load(y!)];
        if (p!.width !== q!.width || p!.height !== q!.height) return p!.width * p!.height;
        let n = 0;
        for (let i = 0; i < p!.data.length; i += 4) {
          if (p!.data[i] !== q!.data[i] || p!.data[i + 1] !== q!.data[i + 1] || p!.data[i + 2] !== q!.data[i + 2] || p!.data[i + 3] !== q!.data[i + 3]) n += 1;
        }
        return n;
      },
      [a.toString("base64"), b.toString("base64")],
    );
  } finally {
    await page.close();
  }
}

async function main(): Promise<number> {
  const bundle = flagValue("bundle");
  if (bundle === undefined) {
    process.stderr.write("usage: compare-bundle.ts --bundle <built bundle> [--against <another bundle>] [--out <dir>]\n");
    return 2;
  }
  process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
  const against = flagValue("against");
  const a = side(against === undefined ? "source" : "against", against === undefined ? REPO : resolve(against));
  const b = side("bundle", resolve(bundle));
  const out = flagValue("out") ?? mkdtempSync(join(tmpdir(), "counterparts-compare-"));
  mkdirSync(out, { recursive: true });

  const work = mkdtempSync(join(tmpdir(), "counterparts-compare-work-"));
  const problems: string[] = [];
  let pairs = 0;
  let sameBytes = 0;
  let differ = 0;
  const browser = await chromium.launch();
  try {
    for (const store of ["rich", "empty"] as const) {
      const dir = join(work, store, "counterparts-demo");
      const home = join(work, store, "home");
      mkdirSync(dir, { recursive: true });
      mkdirSync(home, { recursive: true });
      if (store === "rich") await seedDemo({ dir });
      else seedEmpty({ dir });
      await start(a, dir, home);
      await start(b, dir, home);
      try {
        for (const viewport of VIEWPORTS) {
          const label = `${String(viewport.width)}x${String(viewport.height)}`;
          const [pa, pb] = [await open(browser, a, viewport, problems), await open(browser, b, viewport, problems, against === undefined ? a : undefined)];
          for (const tab of TABS) {
            await showTab(pa, a.url, tab);
            await showTab(pb, b.url, tab);
            const steps: [string, () => Promise<void>][] = [[tab, async () => {}]];
            if (store === "rich" && tab === "memories" && viewport === VIEWPORTS[0]) {
              steps.push(["memory-modal", async () => {
                for (const p of [pa, pb]) {
                  await p.locator("#mlist .mrow").first().click();
                  await p.waitForSelector("#overlay.show", { timeout: 8000 });
                  await p.waitForTimeout(300);
                }
              }]);
            }
            for (const [name, enter] of steps) {
              await enter();
              let sa: Buffer = Buffer.alloc(0);
              let sb: Buffer = Buffer.alloc(0);
              // A page still settling reads as a difference, and a real one stays one.
              for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt > 0) await pa.waitForTimeout(800);
                sa = await pa.screenshot({ fullPage: true, animations: "disabled" });
                sb = await pb.screenshot({ fullPage: true, animations: "disabled" });
                if (sa.equals(sb)) break;
              }
              pairs += 1;
              const file = `${store}-${name}-${label}`;
              writeFileSync(join(out, `${file}.png`), sb);
              if (sa.equals(sb)) {
                sameBytes += 1;
                continue;
              }
              const n = await differingPixels(browser, sa, sb);
              if (n > 0) {
                differ += 1;
                writeFileSync(join(out, `${file}-${a.label}.png`), sa);
                problems.push(`${file}: ${String(n)} pixels differ`);
              }
            }
            await pa.keyboard.press("Escape");
            await pb.keyboard.press("Escape");
          }
          // The rules are the page's, not a tab's: one reading per size is plenty.
          const [ra, rb] = [await parsedRules(pa), await parsedRules(pb)];
          const firstOff = ra.rules.findIndex((r, i) => r !== rb.rules[i]);
          if (ra.rules.length !== rb.rules.length || firstOff >= 0) {
            problems.push(`${store} ${label}: parsed rules differ: ${String(ra.rules.length)} vs ${String(rb.rules.length)}, first at ${String(firstOff)}: ${ra.rules[firstOff]?.slice(0, 120) ?? ""}`);
          }
          process.stdout.write(`  ${store} ${label}: ${String(ra.sheets)} sheets vs ${String(rb.sheets)}, ${String(ra.rules.length)} vs ${String(rb.rules.length)} parsed rules, ${firstOff < 0 ? "same order" : "DIFFERENT"}\n`);
          await pa.context().close();
          await pb.context().close();
        }
      } finally {
        await stop(a);
        await stop(b);
      }
    }
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
  process.stdout.write(`${a.label} vs bundle: ${String(pairs)} screenshot pairs, ${String(sameBytes)} byte-identical, ${String(differ)} with pixels that differ; shots in ${out}\n`);
  if (problems.length === 0) {
    process.stdout.write("no console errors, no page errors, no failed requests.\n");
    return 0;
  }
  process.stdout.write(`\n${String(problems.length)} findings:\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
  return 1;
}

process.exit(await main());
