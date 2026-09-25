/**
 * The health tab (2026-09-25 redesign): doctor as a checklist through the
 * actions seam, the last cycle as one line, and where archived memories went
 * as one picture.
 *
 * What this file proves:
 *
 *   1. `doctor` is an action that builds `doctor --dir <store> [--config] --json`
 *      and nothing else; opened on a bare store it arms the explicit-dir guard
 *      for that run, so the console grades the store alone and says so in its
 *      `config` line rather than reading a default configuration.
 *   2. Running it leaves the store byte-identical, and its output is the JSON
 *      the page draws.
 *   3. Every `archived_reason` the core writes has a plain phrase, the archive
 *      counts add up to the archived rows, and a reason nobody mapped still
 *      gets a segment.
 *   4. The cycle line on a store that has never slept says so.
 *
 * Hermetic (CLAUDE.md): every store and configuration lives in a fresh temp
 * dir removed afterwards; `home` is a temp dir too, so the host reading never
 * looks at a real `~/.claude`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Dashboard } from "../src/adapters/dashboard/index.js";
import { buildArgv, runAction } from "../src/adapters/dashboard/web/actions.js";
import { ARCHIVE_PHRASES, healthView } from "../src/adapters/dashboard/web/views/health.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../src/core/schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import { REMOVED_REASON } from "../src/core/store/owner-op-seam.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

let temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
beforeEach(() => {
  temps = [];
});
afterEach(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      const rel = relative(dir, full);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // As in dashboard-actions: box 3 is rewritten on every open, and `-shm`
      // takes read-marks from every WAL reader.
      if (rel.startsWith("cache") || entry.name.endsWith("-shm")) continue;
      if (!entry.isFile()) continue;
      out.set(rel, `${statSync(full).size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
    }
  };
  walk(dir);
  return out;
}

describe("doctor through the actions seam", () => {
  test("builds doctor --json on the dashboard's own store, and nothing from the body", () => {
    expect(buildArgv("doctor", { dir: "/elsewhere", config: "/x.json" }, { dir: "/tmp/s", config: "/tmp/c.json" })).toEqual({
      argv: ["doctor", "--dir", "/tmp/s", "--config", "/tmp/c.json", "--json"],
    });
  });

  test("opened on a bare store, the run arms the explicit-dir guard", () => {
    const built = buildArgv("doctor", {}, { dir: "/tmp/s" });
    expect(built.argv).toEqual(["doctor", "--dir", "/tmp/s", "--json"]);
    expect(built.env).toEqual({ COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });
  });

  test("a doctor run leaves the store byte-identical and answers in JSON", async () => {
    const root = tempDir("counterparts-health-doctor-");
    const dir = join(root, "store");
    await seedDemo({ dir });
    const config = join(root, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }));
    const home = join(root, "home");
    const before = snapshot(dir);
    const r = await runAction("doctor", {}, { dir, config, home, env: { HOME: home } });
    expect(r.status).toBe(200);
    // 0, or doctor's red exit — a red store is a reading, not a refusal.
    expect(typeof r.body.exit).toBe("number");
    const report = JSON.parse((r.body.out ?? []).join("\n")) as {
      findings: { key: string; severity: string; title: string; detail: string }[];
    };
    expect(report.findings.length).toBeGreaterThan(5);
    const store = report.findings.find((f) => f.key === "store");
    expect(store?.severity).toBe("green");
    expect(snapshot(dir)).toEqual(before);
  }, 60_000);

  test("without a configuration, doctor grades the store and names the config as not read", async () => {
    const root = tempDir("counterparts-health-bare-");
    const seeded = seedEmpty({ dir: join(root, "store") });
    const home = join(root, "home");
    const before = snapshot(seeded.dir);
    const r = await runAction("doctor", {}, { dir: seeded.dir, home, env: { HOME: home } });
    expect(r.status).toBe(200);
    const report = JSON.parse((r.body.out ?? []).join("\n")) as {
      findings: { key: string; data: Record<string, unknown> }[];
    };
    const config = report.findings.find((f) => f.key === "config");
    expect(config?.data["reason"]).toBe("not-read");
    expect(report.findings.some((f) => f.key === "store")).toBe(true);
    expect(snapshot(seeded.dir)).toEqual(before);
  }, 60_000);
});

describe("where archived memories went", () => {
  test("every archived_reason the core names has a plain phrase", () => {
    const mapped = new Set(ARCHIVE_PHRASES.map(([reason]) => reason));
    for (const reason of [
      PRUNE_ARCHIVE_REASON,
      MERGE_ARCHIVE_REASON,
      SCHEMA_TUNABLES.FADE_REASON,
      SCHEMA_TUNABLES.REVISED_REASON,
      SCHEMA_TUNABLES.REPLACED_REASON,
      REMOVED_REASON,
      "handoff-cleared",
      "handoff-duplicate",
      "episode-regrown",
      "supersede",
    ]) {
      expect(`${reason}: ${mapped.has(reason)}`).toBe(`${reason}: true`);
    }
    // And every string literal the core hands `store.archive(…, "…")` today.
    const literals = new Set<string>();
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          for (const m of readFileSync(full, "utf8").matchAll(/\.archive\([^,()]+,\s*"([^"]+)"\)/g)) literals.add(m[1] as string);
        }
      }
    };
    walk(join(import.meta.dir, "..", "src", "core"));
    expect(literals.size).toBeGreaterThan(0);
    for (const reason of literals) expect(`${reason}: ${mapped.has(reason)}`).toBe(`${reason}: true`);
  });

  test("the counts add up to the archived rows, and an unknown reason still gets a segment", async () => {
    const dir = join(tempDir("counterparts-health-archive-"), "store");
    await seedDemo({ dir });
    const w = Store.open({ dir });
    let target = "";
    try {
      target = w.list().find((id) => w.row(id)?.archived === 0 && id.startsWith("mem_")) ?? "";
      expect(target).not.toBe("");
      w.archive(target, "a-reason-nobody-mapped");
    } finally {
      w.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const store = dash.source.store;
      const archived = store.list().filter((id) => store.row(id)?.archived === 1).length;
      const h = healthView(dash.source);
      expect(h.archive.total).toBe(archived);
      const unknown = h.archive.reasons.find((r) => r.reason === "a-reason-nobody-mapped");
      expect(unknown?.known).toBe(false);
      expect(unknown?.phrase).toContain("a-reason-nobody-mapped");
      expect(unknown?.items.map((i) => i.id)).toEqual([target]);
      // The three ways out by design are always on the legend, even at zero.
      for (const r of [PRUNE_ARCHIVE_REASON, MERGE_ARCHIVE_REASON, REMOVED_REASON]) {
        expect(h.archive.reasons.some((x) => x.reason === r)).toBe(true);
      }
    } finally {
      dash.close();
    }
  }, 60_000);

  test("a sparse store reads calmly: nothing archived, sleep has not run", () => {
    const seeded = seedEmpty({ dir: join(tempDir("counterparts-health-sparse-"), "store") });
    const dash = Dashboard.open({ dir: seeded.dir });
    try {
      const h = healthView(dash.source);
      expect(h.archive.total).toBe(0);
      expect(h.cycle.day).toBeNull();
      expect(h.cycle.ran).toBe(0);
      expect(h.cycle.phases.every((p) => p.state === "never")).toBe(true);
    } finally {
      dash.close();
    }
  });
});
