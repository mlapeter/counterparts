/**
 * The sidebar's status file (`src/adapters/sidebar-status.ts`, 2026-10-14):
 * what the Claude Code sidebar reads instead of asking the dashboard over the
 * network. Written beside the configuration (never inside the store, whose
 * every top-level name is classified), whole or not at all, by the worker
 * after a boundary and by the memory server off its tool calls' path.
 *
 * Hermetic: every store here is a fresh temp directory this file makes and
 * removes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { ownedKind, ownedNames } from "../src/adapters/cli/uninstall.js";
import { openServer } from "../src/adapters/mcp/index.js";
import {
  DETAIL_KEYS,
  MEMORY_CAP,
  SIDEBAR_FILE_NAME,
  SIDEBAR_STATUS_VERSION,
  SidebarStatusWriter,
  TEXT_CAP,
  chaseSidebarStatus,
  readSidebarStamp,
  removeSidebarStatus,
  sidebarInstalled,
  sidebarPointerPath,
  sidebarStatusPath,
  writeSidebarStatus,
} from "../src/adapters/sidebar-status.js";
import { storeId } from "../src/adapters/store-id.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

let root: string;
let rich: string;
let config: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "counterparts-sidebar-status-"));
  rich = join(root, "store");
  await seedDemo({ dir: rich });
  config = join(root, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: rich }));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const status = (): Record<string, any> => JSON.parse(readFileSync(sidebarStatusPath(config), "utf8"));

describe("writing it", () => {
  test("beside the configuration, never inside the store; whole, owner-only, no temp file left", () => {
    const before = readdirSync(rich).sort();
    const w = writeSidebarStatus({ configPath: config, dataDir: rich });
    expect(w.written).toBe(true);
    expect(w.reason).toBe("written");
    expect(sidebarStatusPath(config)).toBe(join(root, SIDEBAR_FILE_NAME));
    expect(existsSync(join(rich, SIDEBAR_FILE_NAME))).toBe(false);
    expect(readdirSync(rich).sort()).toEqual(before);
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(statSync(sidebarStatusPath(config)).mode & 0o777).toBe(0o600);
    expect(w.bytes).toBeLessThan(256 * 1024);
  });

  test("what the sidebar showed from the dashboard: which store, the pulse, today's counts, dreams, rows, panels, memories", () => {
    writeSidebarStatus({ configPath: config, dataDir: rich });
    const s = status();
    expect(s["version"]).toBe(SIDEBAR_STATUS_VERSION);
    expect(typeof s["writtenAt"]).toBe("number");
    expect("storeId" in s).toBe(true);
    expect(s["pulse"]["memories"]).toBeGreaterThan(0);
    expect(s["pulse"]["lastSeq"]).toBeGreaterThan(0);
    expect(typeof s["today"]["date"]).toBe("string");
    expect(Object.keys(s["today"]["counts"])).toContain("retrieval");
    expect(s["events"].length).toBeGreaterThan(20);
    // newest first, each seq once
    const seqs = (s["events"] as { seq: number }[]).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(new Set(seqs).size).toBe(seqs.length);
    // only what the sidebar reads of a row
    for (const e of s["events"] as Record<string, unknown>[]) {
      expect(e["tone"]).toBeUndefined();
      for (const d of (e["detail"] ?? []) as { key: string }[]) expect(DETAIL_KEYS.has(d.key)).toBe(true);
    }
    expect(Object.keys(s["panels"]).length).toBeGreaterThan(0);
    const memories = Object.entries(s["memories"] as Record<string, { title: string; text: string } | null>);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories.length).toBeLessThanOrEqual(MEMORY_CAP);
    for (const [id, m] of memories) {
      expect(id).toMatch(/^mem_[A-Za-z0-9]+$/);
      if (m !== null) expect(m.text.length).toBeLessThanOrEqual(TEXT_CAP + 1);
    }
  });

  test("skips a write the file already holds (another session's server wrote this seq a moment ago)", () => {
    const first = writeSidebarStatus({ configPath: config, dataDir: rich });
    const again = writeSidebarStatus({ configPath: config, dataDir: rich, ifMoved: { lastSeq: first.lastSeq ?? 0, maxAgeMs: 60_000 } });
    expect(again.written).toBe(false);
    expect(again.reason).toBe("same");
    const moved = writeSidebarStatus({ configPath: config, dataDir: rich, ifMoved: { lastSeq: (first.lastSeq ?? 0) + 1, maxAgeMs: 60_000 } });
    expect(moved.written).toBe(true);
    expect(readSidebarStamp(sidebarStatusPath(config))?.lastSeq).toBe(first.lastSeq ?? -1);
  });

  test("never throws: a folder that is not there, a store that will not open", () => {
    expect(writeSidebarStatus({ configPath: join(root, "nope", "claude-code.json"), dataDir: rich }).reason).toBe("no-config");
    expect(writeSidebarStatus({ configPath: "", dataDir: rich }).reason).toBe("no-config");
    const other = mkdtempSync(join(tmpdir(), "counterparts-sidebar-bad-"));
    try {
      const notAStore = join(other, "store");
      mkdirSync(notAStore);
      writeFileSync(join(notAStore, "unclassified-thing"), "x");
      const w = writeSidebarStatus({ configPath: join(other, "claude-code.json"), dataDir: notAStore });
      expect(w.written).toBe(false);
      expect(readdirSync(other).filter((f) => f.endsWith(".tmp") || f === SIDEBAR_FILE_NAME)).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("who writes it", () => {
  test("the worker, after a boundary, beside the configuration it read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-worker-"));
    try {
      const store = join(dir, "store");
      seedEmpty({ dir: store });
      const cfg = join(dir, "claude-code.json");
      writeFileSync(cfg, JSON.stringify({ dataDir: store }));
      const report = await runOnce({ config: { dataDir: store, owner: true }, sidebarConfigPath: cfg, embedder: null });
      expect(report.sidebar?.written).toBe(true);
      expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(true);
      // not asked: not written
      rmSync(join(dir, SIDEBAR_FILE_NAME));
      const quiet = await runOnce({ config: { dataDir: store, owner: true }, embedder: null });
      expect(quiet.sidebar).toBeUndefined();
      expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the memory server tells its listener after each tool call, and only schedules; the writer writes once for a burst", async () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-mcp-"));
    try {
      const store = join(dir, "store");
      seedEmpty({ dir: store });
      const cfg = join(dir, "claude-code.json");
      writeFileSync(cfg, JSON.stringify({ dataDir: store }));
      const writes: boolean[] = [];
      let writer: SidebarStatusWriter | null = null;
      const told: string[] = [];
      const s = openServer({
        dir: store,
        session: "sess_sidebar_1",
        scope: "/scope/sidebar",
        owner: true,
        afterCall: (tool) => {
          told.push(tool);
          writer?.schedule(20);
        },
      });
      try {
        writer = new SidebarStatusWriter({
          configPath: cfg,
          dataDir: store,
          newestSeq: () => s.counterpart.store.eventLog({ order: "desc", limit: 1 })[0]?.seq ?? null,
          onWrite: (w) => writes.push(w.written),
        });
        for (let i = 0; i < 3; i++) {
          await s.handle({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name: "status", arguments: {} } } as never);
        }
        expect(told).toEqual(["status", "status", "status"]);
        expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(false); // nothing on the call's path
        await new Promise((r) => setTimeout(r, 300));
        expect(writes).toEqual([true]);
        expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(true);
        writer.stop();
        writer.schedule(0);
        await new Promise((r) => setTimeout(r, 50));
        expect(writes).toEqual([true]); // stopped: nothing more
      } finally {
        writer?.stop();
        s.counterpart.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what else knows it", () => {
  test("a removal chases it: deleted when it names the memory, left when it does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-chase-"));
    try {
      const store = join(dir, "store");
      mkdirSync(store);
      expect(chaseSidebarStatus(store, "mem_gone0001")).toBeNull(); // nothing there
      writeFileSync(join(dir, SIDEBAR_FILE_NAME), JSON.stringify({ memories: { mem_kept0001: { title: "kept" } } }));
      expect(chaseSidebarStatus(store, "mem_gone0001")?.chased).toBe(true);
      expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(true);
      writeFileSync(join(dir, SIDEBAR_FILE_NAME), JSON.stringify({ memories: { mem_gone0001: { title: "gone", text: "its words" } } }));
      expect(chaseSidebarStatus(store, "mem_gone0001")).toEqual({ chased: true, line: "sidebar status file (deleted; written again without it)" });
      expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uninstall counts it, and its temp siblings, as a file this package left", () => {
    const owned = ownedNames("/x/claude-code.json", { dataDir: "/x/store" }, "/x/store");
    expect(ownedKind(SIDEBAR_FILE_NAME, owned)).toBe("sidecar");
    expect(ownedKind(`${SIDEBAR_FILE_NAME}.4242.tmp`, owned)).toBe("sidecar");
    expect(ownedKind("sidebar.json.bak", owned)).toBeNull();
  });
});

describe("the review's cases (2026-10-14)", () => {
  test("a store outside the configuration's folder: the removal finds the file through the store's pointer", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-custom-"));
    try {
      const store = join(dir, "elsewhere", "store");
      seedEmpty({ dir: store });
      const cfgDir = join(dir, "config");
      mkdirSync(cfgDir);
      const cfg = join(cfgDir, "claude-code.json");
      writeFileSync(cfg, JSON.stringify({ dataDir: store }));
      expect(writeSidebarStatus({ configPath: cfg, dataDir: store }).written).toBe(true);
      const file = join(cfgDir, SIDEBAR_FILE_NAME);
      expect(readFileSync(sidebarPointerPath(store), "utf8")).toBe(file);
      writeFileSync(file, readFileSync(file, "utf8").replace('"memories":{', '"memories":{"mem_gone0002":{"title":"gone","text":"its words"},'));
      expect(chaseSidebarStatus(store, "mem_gone0002")?.line).toBe("sidebar status file (deleted; written again without it)");
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two stores sharing a folder never suppress each other; a writer never puts back an older file of its store", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-two-"));
    try {
      const a = join(dir, "a");
      const b = join(dir, "b");
      seedEmpty({ dir: a });
      seedEmpty({ dir: b });
      storeId(a, { mint: true });
      storeId(b, { mint: true });
      const cfg = join(dir, "claude-code.json");
      expect(writeSidebarStatus({ configPath: cfg, dataDir: a }).written).toBe(true);
      // b at a seq no higher than a's: written all the same, the file there is another store's
      const other = writeSidebarStatus({ configPath: cfg, dataDir: b, ifMoved: { lastSeq: 0, maxAgeMs: 60_000 } });
      expect(other.written).toBe(true);
      expect(readSidebarStamp(sidebarStatusPath(cfg))?.storeId).toBe(storeId(b));
      // a newer file of b's own: an older write of b's does not replace it
      const file = sidebarStatusPath(cfg);
      const v = JSON.parse(readFileSync(file, "utf8")) as { pulse: { lastSeq: number } };
      v.pulse.lastSeq = 1_000_000;
      writeFileSync(file, JSON.stringify(v));
      expect(writeSidebarStatus({ configPath: cfg, dataDir: b }).reason).toBe("newer");
      expect(readSidebarStamp(file)?.lastSeq).toBe(1_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("written only where the sidebar is installed: the plugin's own process, or a counterparts plugin Claude Code records and leaves on", () => {
    const home = mkdtempSync(join(tmpdir(), "counterparts-sidebar-home-"));
    try {
      expect(sidebarInstalled({}, home)).toBe(false); // npm only: no file
      expect(sidebarInstalled({ CLAUDE_PLUGIN_ROOT: "/some/plugin" }, home)).toBe(true);
      mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
      writeFileSync(
        join(home, ".claude", "plugins", "installed_plugins.json"),
        JSON.stringify({ version: 2, plugins: { "counterparts@counterparts": [{ scope: "user", installPath: "/x", version: "0.3.23" }] } }),
      );
      expect(sidebarInstalled({}, home)).toBe(true);
      writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "counterparts@counterparts": false } }));
      expect(sidebarInstalled({}, home)).toBe(false); // installed and switched off
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an old file goes where the sidebar is not installed", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-gone-"));
    try {
      const cfg = join(dir, "claude-code.json");
      writeFileSync(join(dir, SIDEBAR_FILE_NAME), "{}");
      expect(removeSidebarStatus(cfg)).toBe(true);
      expect(existsSync(join(dir, SIDEBAR_FILE_NAME))).toBe(false);
      expect(removeSidebarStatus(cfg)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Emotion in the file (2026-10-14)", () => {
  test("a memory saved with a feeling and a turn that brought one to mind count today; their rows say which memories carry a feeling, with the words", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-sidebar-felt-"));
    try {
      const store = join(dir, "store");
      const cfg = join(dir, "claude-code.json");
      writeFileSync(cfg, JSON.stringify({ dataDir: store }));
      const c = Counterpart.open({ dir: store, owner: true });
      let felt = "";
      let plain = "";
      try {
        const s = c.store;
        const day = s.livedDay();
        felt = s.put({ type: "memory", kind: "fact", title: "The rota went up untouched", body: "No hand edits this week.", source: "authored" });
        s.addFeelings(felt, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.8 }]);
        plain = s.put({ type: "memory", kind: "fact", title: "Release notes go out on Fridays", body: "After the review.", source: "authored" });
        s.appendEvent({ name: "gate.deposit", day, payload: { accepted: 1, memoryId: felt } });
        s.appendEvent({ name: "gate.deposit", day, payload: { accepted: 1, memoryId: plain } });
        s.appendEvent({
          name: "recall.decision",
          day,
          ref: "s1",
          payload: { turn: 1, surfacedCount: 2, footnoteCount: 0, moodMatched: 0, surfaced: [{ id: plain }, { id: felt }], footnotes: [] },
        });
      } finally {
        c.close();
      }
      expect(writeSidebarStatus({ configPath: cfg, dataDir: store }).written).toBe(true);
      const s = JSON.parse(readFileSync(sidebarStatusPath(cfg), "utf8")) as Record<string, any>;
      expect(s["today"]["counts"]["emotional"]).toBe(2);
      const feltOf = (r: { detail?: { key: string; value: string }[] }): unknown => JSON.parse(r.detail?.find((d) => d.key === "felt")?.value ?? "null");
      // The Emotion panel: the felt memory only, named, with its words.
      const panel = s["panels"]["emotional"] as { name: string; text: string; detail: { key: string; value: string }[] }[];
      expect(panel.map((r) => r.name).sort()).toEqual(["gate.deposit", "recall.decision"]);
      for (const r of panel) expect(feltOf(r)).toEqual([{ id: felt, words: ["proud"] }]);
      expect(panel.map((r) => r.text).join("\n")).not.toContain("Release notes");
      // The feed's rows carry it too, so a deposit with a feeling lights Emotion there; one without carries none.
      const deposits = (s["events"] as { name: string; detail: { key: string; value: string }[] }[]).filter((r) => r.name === "gate.deposit");
      expect(deposits.map(feltOf)).toEqual([null, [{ id: felt, words: ["proud"] }]]);
      expect(s["memories"][felt]["title"]).toBe("The rota went up untouched");
      expect(DETAIL_KEYS.has("felt")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
