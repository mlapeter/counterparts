/**
 * THE WORKER AFTER `runner.done` (2026-10-30). Three-quarters of a per-turn
 * worker's wall time came after its last log row. Most of it was the sidebar's
 * status file opening a full memory card 60 times, for five of the card's
 * fields. These hold what the fix must keep: the words it now reads agree with
 * the card's, the worker's `runner.steps` row lands in the real log through the
 * real door, and the boundary's reserve reads the settled pairs once.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { runOnce, stepClock } from "../src/adapters/claude-code/bin/runner.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { memoryDetail, memoryWords } from "../src/adapters/dashboard/web/views.js";
import { logDir, logged } from "../src/adapters/log/index.js";
import { SIDEBAR_FILE_NAME } from "../src/adapters/sidebar-status.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const HOOK = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
/** Every step the run laps, in the order it runs them. */
const STEPS = ["embedder", "open", "lag", "backfill", "terms", "cycle", "held", "wake", "coverage", "retention", "carries", "snapshot", "close", "sidebar", "updates"];

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-worker-after-done-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("memoryWords: the card's words, without the card", () => {
  test("says what memoryDetail says for every row of a seeded store, and for an id that is not there", async () => {
    const dir = join(root, "words");
    await seedDemo({ dir });
    const dash = Dashboard.open({ dir });
    try {
      const store = dash.source.store;
      const ids = [...store.list({}), "mem_notthere"];
      expect(ids.length).toBeGreaterThan(5);
      for (const id of ids) {
        const card = memoryDetail(dash.source, id);
        const words = memoryWords(dash.source, id);
        if (!card.found) {
          expect(words, id).toBeNull();
          continue;
        }
        expect(words, id).toEqual({
          title: card.title,
          text: card.text,
          kind: card.kind,
          learnedOn: card.learnedOn,
          journal: card.journal,
        });
      }
    } finally {
      dash.close();
    }
  });
});

describe("runner.steps: where a worker's time went", () => {
  test("the clock names each lap, its CPU only when the lap was long enough to ask, and the whole", () => {
    const clock = stepClock();
    clock.lap("quick");
    const until = performance.now() + 8;
    while (performance.now() < until) {
      /* a step that takes a while */
    }
    clock.lap("long");
    const row = clock.row();
    expect(row["long"]).toBeGreaterThanOrEqual(5);
    expect(row["cpu.long"]).toBeGreaterThanOrEqual(0);
    expect(row["cpu.quick"]).toBeUndefined();
    expect(row["cpu"]).toBeGreaterThan(0);
    expect(row["rssMb"]).toBeGreaterThan(0);
  });

  test("a run emits one row naming every step; the log admits it", async () => {
    const dir = join(root, "row");
    seedEmpty({ dir });
    const seen: Record<string, unknown>[] = [];
    await runOnce({
      config: { dataDir: dir },
      embedder: null,
      bootMs: 42,
      onEvent: (name, data) => {
        if (name === "runner.steps") seen.push(data);
      },
    });
    expect(seen).toHaveLength(1);
    for (const step of STEPS) expect(typeof seen[0]?.[step], step).toBe("number");
    expect(seen[0]?.["boot"]).toBe(42);
    expect(logged("runner.steps")).toBe(true);
  });

  test("a run that refused before it opened anything writes no row", async () => {
    const seen: string[] = [];
    await runOnce({ config: { dataDir: "" }, embedder: null, onEvent: (name) => seen.push(name) });
    expect(seen).not.toContain("runner.steps");
  });
});

describe("the boundary's reserve", () => {
  test("reads the settled pairs once, however many folders hold experience", () => {
    const dir = join(root, "reserve");
    const cp = Counterpart.open({ dir });
    try {
      const turn = (text: string): { role: "user"; text: string; index: number } => ({ role: "user", text, index: 0 });
      for (const scope of ["/work/one", "/work/two", "/work/three"]) {
        cp.spans.capture({ session: `s-${scope.length}-${scope.slice(-3)}`, scope, turns: [turn(`a turn in ${scope}`)] });
      }
      expect(cp.spans.scopes().length).toBe(3);
      let reads = 0;
      const store = cp.store as unknown as { contradictions: (...a: unknown[]) => unknown };
      const real = store.contradictions.bind(store);
      store.contradictions = (...a: unknown[]): unknown => {
        reads += 1;
        return real(...a);
      };
      (cp as unknown as { workReserveBytes: (n: number) => number }).workReserveBytes(9000);
      expect(reads).toBe(1);
    } finally {
      cp.close();
    }
  });
});

describe("through the door", () => {
  test("a Stop hook spawns the real worker, whose steps land in the real log, and the sidebar's file is written", async () => {
    const base = mkdtempSync(join(root, "door-"));
    const store = join(base, "store");
    seedEmpty({ dir: store });
    const config = join(base, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9000 }));
    // What a plugin loaded from a folder leaves beside the configuration: the sidebar is here.
    writeFileSync(join(base, "sidebar-plugin-here"), JSON.stringify({ writtenAt: Date.now(), pid: process.pid }));
    const session = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
    const transcript = join(base, "t.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: "user", uuid: "u1", sessionId: session, message: { role: "user", content: "a turn" } })}\n`,
    );
    const r = spawnSync(process.execPath, ["run", HOOK, "--config", config], {
      input: JSON.stringify({ hook_event_name: "Stop", session_id: session, cwd: base, transcript_path: transcript, stop_hook_active: false }),
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: base, COUNTERPARTS_UPDATE_CHECK: "off" },
      timeout: 60_000,
    });
    expect(r.status).toBe(0);

    const workerLines = (): Record<string, unknown>[] => {
      const dirLog = logDir(store);
      if (!existsSync(dirLog)) return [];
      return readdirSync(dirLog)
        .flatMap((f) => readFileSync(join(dirLog, f), "utf8").split("\n"))
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((l) => l["proc"] === "worker");
    };
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !workerLines().some((l) => l["name"] === "process.end")) {
      await new Promise((done) => setTimeout(done, 100));
    }
    const lines = workerLines();
    const names = lines.map((l) => l["name"]);
    expect(names).toContain("runner.done");
    expect(names).toContain("process.end");
    const row = lines.find((l) => l["name"] === "runner.steps")?.["data"] as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    for (const step of STEPS) expect(typeof row?.[step], step).toBe("number");
    expect(row?.["boot"]).toBeGreaterThan(0);
    expect(row?.["rssMb"]).toBeGreaterThan(0);
    // The row comes before the end, after the done: the read that wants the gap has both.
    expect(names.indexOf("runner.steps")).toBeGreaterThan(names.indexOf("runner.done"));
    expect(names.indexOf("runner.steps")).toBeLessThan(names.indexOf("process.end"));
    expect(existsSync(join(base, SIDEBAR_FILE_NAME))).toBe(true);
  }, 90_000);
});
