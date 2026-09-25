/**
 * A store waiting for its one-time upgrade (v6, met by this v7 build).
 *
 * The dashboard is an observer and never upgrades anything; a read-only open of
 * a v6 store is `STORE_UNINITIALIZED` with `found: "6"`. The owner is owed a
 * calm page saying what to do, not an error — and once a session has upgraded
 * the store, a reload shows the dashboard. Hermetic: every store here is made
 * in a temp dir and removed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { DashboardSeam, Io } from "../src/adapters/cli/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { run as runTerminalView } from "../src/adapters/dashboard/bin/dashboard.js";
import { UPGRADE_PENDING_SENTENCE, upgradePending } from "../src/adapters/dashboard/upgrade.js";
import { startDashboard } from "../src/adapters/dashboard/web/server.js";
import { Store, isStoreError, paths } from "../src/core/store/index.js";

const V7_DROPPED: readonly [string, string][] = [
  ["memories", "created_at"],
  ["memories", "updated_at"],
  ["memories", "model"],
  ["memories", "event_date"],
  ["versions", "created_at"],
  ["versions", "model"],
  ["versions", "event_date"],
  ["edges", "created_at"],
  ["edges", "updated_at"],
  ["prospective", "created_at"],
  ["prospective", "updated_at"],
];

/** A v6-shaped file, made the way `test/store-v7.test.ts` makes one. */
function makeV6(at: string): void {
  const s = Store.open({ dir: at });
  s.put({ type: "memory", kind: "fact", body: "written by the v6 build", learnedOn: "2026-09-24" });
  s.close();
  const db = new Database(paths.operational(at));
  db.run("DROP INDEX IF EXISTS memories_event_date");
  db.run("DROP TABLE feelings");
  for (const [table, column] of V7_DROPPED) db.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '6')");
  db.close();
}

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-dash-upgrade-"));
  dir = join(root, "store");
  makeV6(dir);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a v6 store, met by the dashboard", () => {
  test("the read-only open is STORE_UNINITIALIZED with found 6, and upgradePending says so", () => {
    let caught: unknown = null;
    try {
      Dashboard.open({ dir }).close();
    } catch (err) {
      caught = err;
    }
    expect(isStoreError(caught, "STORE_UNINITIALIZED")).toBe(true);
    expect(String((caught as { detail: Record<string, unknown> }).detail["found"])).toBe("6");
    expect(upgradePending(caught)).toBe(true);
  });

  test("serve starts anyway: a calm page, a 503 for the api and actions, and a reload after the upgrade works", async () => {
    const running = await startDashboard({ dir, port: 0 });
    try {
      expect(running.upgradePending).toBe(true);
      expect(running.dir).toBe(dir);
      const page = await fetch(`${running.url}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain(UPGRADE_PENDING_SENTENCE);
      expect(html).not.toContain("STORE_UNINITIALIZED");
      const api = await fetch(`${running.url}/api/overview`);
      expect(api.status).toBe(503);
      expect(((await api.json()) as { error: string }).error).toBe("upgrade-pending");
      const act = await fetch(`${running.url}/api/action/note`, { method: "POST" });
      expect(act.status).toBe(503);
      const forged = await fetch(`${running.url}/`, { headers: { host: "evil.example" } });
      expect(forged.status).toBe(403);

      // A session (a writer) opens it and upgrades it; the next request shows the dashboard.
      Store.open({ dir }).close();
      const after = await fetch(`${running.url}/api/meta`);
      expect(after.status).toBe(200);
      expect(((await after.json()) as { observer: boolean }).observer).toBe(true);
    } finally {
      await running.stop();
    }
  });

  test("the terminal views say the same sentence, not 'no store here'", () => {
    const text = runTerminalView(["status", "--dir", dir]);
    expect(text).toContain("This memory needs a one-time upgrade");
    expect(text).not.toContain("counterparts init");
  });

  test("`counterparts dashboard` serves it and says so in the terminal", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) };
    const seam: DashboardSeam = {
      async start(o) {
        const up = await startDashboard({ dir: o.dir, port: 0 });
        return { url: up.url, dir: up.dir, upgradePending: up.upgradePending, stop: () => up.stop() };
      },
      until: async () => {},
    };
    const code = await run(["dashboard", "--dir", dir, "--no-open"], { io, env: {}, home: root, dashboard: seam });
    expect(err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(out.join("\n")).toContain("upgrades it");
  });
});
