/**
 * HD2 (2026-11-10): one dashboard, two hosts. `web/respond.ts` is the half the
 * local server and the hosted server share; this file pins what the split must
 * keep for the LOCAL one (nothing about it changed) and what the shared half
 * does for a host that is not local, without the hosted package (its own
 * tests, `hosted/test/dashboard.test.ts`, go through its real door).
 *
 *   1. The local page is the page it was: absolute links, the host named
 *      "local", the launch's token; and over the real socket a view answers and
 *      an action still runs (a note is written).
 *   2. The hosted page: the same file, its links and font URLs under
 *      `/dashboard/`, the host named "hosted", the brain off.
 *   3. The shared half never reaches `actions.ts`, so a host that imports it
 *      can't act; and it serves only the views its host names.
 *
 * Hermetic: a fresh temp store per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Dashboard } from "../src/adapters/dashboard/index.js";
import {
  HOSTED_HOST,
  HOSTED_VIEWS,
  LOCAL_HOST,
  pageFor,
  rebase,
  staticReply,
  viewReply,
} from "../src/adapters/dashboard/web/respond.js";
import { startDashboard } from "../src/adapters/dashboard/web/server.js";
import { seedEmpty } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const FILES = { text: (f: string) => readFileSync(f, "utf8"), bytes: (f: string) => readFileSync(f) };

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-hosts-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fixture(): { dir: string; config: string } {
  const seeded = seedEmpty({ dir: join(root, "store") });
  const config = join(root, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: seeded.dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }));
  return { dir: seeded.dir, config };
}

describe("the local host: unchanged by the split", () => {
  test("over the real socket: the page (local, absolute, with its token), a view, and an action that writes", async () => {
    const f = fixture();
    const running = await startDashboard({ dir: f.dir, port: 0, config: f.config });
    try {
      const page = await (await fetch(`${running.url}/`)).text();
      expect(page).toContain('<meta name="counterparts-host" content="local">');
      expect(page).toContain(`<meta name="counterparts-action-token" content="${running.token}">`);
      expect(page).toContain('<script type="module" src="/app.js"></script>');
      expect(page).toContain('href="/shared/tokens.css"');
      expect(page).not.toContain("/dashboard/");
      const css = await (await fetch(`${running.url}/shared/tokens.css`)).text();
      expect(css).toContain('url("/shared/fonts/');
      const before = (await (await fetch(`${running.url}/api/meta`)).json()) as { rows: number; dir: string };
      // Locally the store's folder is still said (the health tab and the sidebar read it).
      expect(before.dir).toBe(f.dir);
      // Managing still works locally: a note through the action door.
      const res = await fetch(`${running.url}/api/action/note`, {
        method: "POST",
        headers: { origin: running.url, "content-type": "application/json", "x-counterparts-token": running.token },
        body: JSON.stringify({ text: "The split kept the note door open." }),
      });
      const out = (await res.json()) as { ok: boolean };
      expect(res.status).toBe(200);
      expect(out.ok).toBe(true);
      const after = (await (await fetch(`${running.url}/api/meta`)).json()) as { rows: number };
      expect(after.rows).toBeGreaterThan(before.rows);
      const found = await (await fetch(`${running.url}/api/search?q=split`)).text();
      expect(found).toContain("The split kept the note door open.");
      // Every view the local page has answers (flow, health, … are local's).
      for (const path of ["/api/health", "/api/flow", "/api/mechanisms", "/api/subjects", "/api/whoami", "/api/onboarding"]) {
        expect(`${path} ${(await fetch(`${running.url}${path}`)).status}`).toBe(`${path} 200`);
      }
    } finally {
      await running.stop();
    }
  });
});

describe("the shared half, for a host that is not local", () => {
  test("the hosted page: the same file, rebased under /dashboard/, named hosted, the brain off", () => {
    const raw = readFileSync(join(WEB, "app.html"), "utf8");
    const local = pageFor(raw, LOCAL_HOST, true);
    expect(local).toBe(raw);
    const hosted = pageFor(raw, HOSTED_HOST, true);
    expect(hosted).toContain('<meta name="counterparts-host" content="hosted">');
    expect(hosted).toContain('<meta name="counterparts-brain" content="off">');
    expect(hosted).toContain('<script type="module" src="/dashboard/app.js"></script>');
    expect(hosted).toContain('<link rel="icon" href="/dashboard/favicon.svg"');
    expect(hosted).not.toMatch(/(href|src)="\/(?!dashboard\/)/);
    // Only the base moved: take it out again and the page is the local one, brain and host aside.
    const back = hosted.replaceAll('="/dashboard/', '="/').replace('content="hosted"', 'content="local"').replace('<meta name="counterparts-brain" content="off">', '<meta name="counterparts-brain" content="on">');
    expect(back).toBe(raw);
    expect(rebase('src:url("/shared/fonts/a.woff2") url("//x")', "/dashboard/")).toBe('src:url("/dashboard/shared/fonts/a.woff2") url("//x")');
  });

  test("a hosted static reply: CSS rebased, JS as it is, traversal refused", () => {
    const css = staticReply("/shared/tokens.css", HOSTED_HOST, FILES, true);
    expect(css?.body).toContain('url("/dashboard/shared/fonts/');
    expect(css?.body).not.toContain('url("/shared/');
    const js = staticReply("/shared/api.js", HOSTED_HOST, FILES, true);
    expect(js?.body).toBe(readFileSync(join(WEB, "shared/api.js"), "utf8"));
    expect(staticReply("/shared/../server.ts", HOSTED_HOST, FILES, true)).toBeNull();
    expect(staticReply("/respond.ts", HOSTED_HOST, FILES, true)).toBeNull();
  });

  test("hosted serves only its views, and says no store path; errors say nothing of the server", () => {
    const f = fixture();
    const d = Dashboard.open({ dir: f.dir });
    try {
      const at = (p: string): URL => new URL(p, "http://x.invalid");
      for (const view of HOSTED_VIEWS) {
        const r = viewReply(at(view === "/api/memory" ? `${view}?id=mem_nope` : view), d.source, HOSTED_HOST);
        expect(`${view} ${r?.status}`).toBe(`${view} 200`);
      }
      for (const view of ["/api/health", "/api/flow", "/api/mechanisms", "/api/subjects", "/api/event", "/api/dreams", "/api/pulse", "/api/whoami", "/api/onboarding", "/api/action/note"]) {
        expect(`${view} ${String(viewReply(at(view), d.source, HOSTED_HOST))}`).toBe(`${view} null`);
      }
      const meta = JSON.parse(viewReply(at("/api/meta"), d.source, HOSTED_HOST)!.body) as Record<string, unknown>;
      expect("dir" in meta).toBe(false);
      expect(JSON.stringify(meta)).not.toContain(f.dir);
      expect((JSON.parse(viewReply(at("/api/meta"), d.source, LOCAL_HOST)!.body) as { dir: string }).dir).toBe(f.dir);
    } finally {
      d.close();
    }
  });

  test("the shared half never imports actions.ts, at any depth", () => {
    const seen = new Set<string>();
    const queue = [join(WEB, "respond.ts")];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.[^"]+)";?$/gm)) {
        // `./x.js` is `x.ts` beside it, unless it is a real browser module (views use `shared/dates.js`).
        const asTs = resolve(dirname(file), m[1]!.replace(/\.js$/, ".ts"));
        queue.push(existsSync(asTs) ? asTs : resolve(dirname(file), m[1]!));
      }
    }
    const reached = [...seen].map((f) => f.slice(f.indexOf("/src/") + 1));
    expect(reached).not.toContain("src/adapters/dashboard/web/actions.ts");
    expect(reached).not.toContain("src/adapters/dashboard/web/server.ts");
    expect(reached.some((f) => f.startsWith("src/adapters/cli/"))).toBe(false);
  });
});
