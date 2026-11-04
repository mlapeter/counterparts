/**
 * THE ONE REVISION OF AN OLD STARTER SET (v1 → v2, HD1, 2026-11-04;
 * `core/told.ts#reviseTold`), on local.
 *
 * A store planted before HD1 holds #9 saying `counterparts remove` is the way
 * to delete one memory and #1 with no "Delete that" tip. Planted here by the
 * 0.3.46 `told.ts` itself (`fixtures/told-v1.ts`), then opened through the
 * door a local install has: the memory server as Claude Code launches it,
 * `mcp/bin/serve.ts` as a child over stdio. An unchanged starter gets v2's
 * words once; one the person edited or corrected stays theirs; an observer
 * open (`counterparts doctor`'s) writes nothing.
 *
 * Hermetic: one temp dir per test (store, config, a HOME), removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import {
  TOLD_REVISE_REASON,
  TOLD_SET_KEY,
  TOLD_SET_V1,
  TOLD_SET_VERSION,
  TOLD_SOURCE,
  plantTold,
  toldSet,
  toldV1Words,
} from "../src/core/told.js";
import type { ToldSurface } from "../src/core/told.js";
import { plantTold as plantV1, toldSet as toldSetV1 } from "./fixtures/told-v1.js";

const SERVE = resolve(import.meta.dir, "../src/adapters/mcp/bin/serve.ts");
const TIPS = "Told: tips to offer once";
const NINE = "Told: seeing and changing what I keep";

let root: string;
let store: string;
let configPath: string;
let home: string;
const children: Stdio[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-told-revise-")));
  store = join(root, "store");
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
  configPath = join(root, "claude-code.json");
  writeFileSync(configPath, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9000, snapshots: { daily: false } }), "utf8");
});

afterEach(async () => {
  for (const c of children.splice(0)) await c.close();
  rmSync(root, { recursive: true, force: true });
});

/** The memory server as a child over stdio: one JSON-RPC line out, its answer back by id. */
class Stdio {
  private readonly child: ChildProcessWithoutNullStreams;
  private buf = "";
  private next = 1;
  private readonly waiting = new Map<number, (msg: Record<string, unknown>) => void>();
  private readonly exited: Promise<void>;
  stderr = "";

  constructor() {
    this.child = spawn(process.execPath, ["run", SERVE], {
      cwd: root,
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: home,
        COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
        COUNTERPARTS_UPDATE_CHECK: "off",
        COUNTERPARTS_DATA_DIR: store,
        COUNTERPARTS_CONFIG: configPath,
        CLAUDE_PROJECT_DIR: root,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exited = new Promise((r) => this.child.on("exit", () => r()));
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d: string) => (this.stderr += d));
    this.child.stdout.on("data", (d: string) => {
      this.buf += d;
      for (;;) {
        const nl = this.buf.indexOf("\n");
        if (nl < 0) break;
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.trim().length === 0) continue;
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (typeof msg["id"] === "number") this.waiting.get(msg["id"])?.(msg);
      }
    });
    children.push(this);
  }

  rpc(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.next++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`no answer to ${method} (${this.stderr.slice(-400)})`)), 30_000);
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        res(msg);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  }

  async init(): Promise<void> {
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.0.0" } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }

  async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const msg = await this.rpc("tools/call", { name, arguments: args });
    const result = msg["result"] as Record<string, unknown> | undefined;
    if (result === undefined) throw new Error(`${name}: ${JSON.stringify(msg)}`);
    return result["structuredContent"] as Record<string, unknown>;
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    const killer = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
    await this.exited;
    clearTimeout(killer);
  }
}

/** Open the store through the memory server, as a session start does, and close it again. */
async function openThroughMcp(): Promise<Record<string, unknown>> {
  const s = new Stdio();
  await s.init();
  const status = await s.call("status", {});
  await s.close();
  return status;
}

function withStore<T>(fn: (s: Store) => T, observer = false): T {
  const s = Store.open({ dir: store, ...(observer ? { observer: true } : {}) });
  try {
    return fn(s);
  } finally {
    s.close();
  }
}

/** A store as a pre-HD1 install left it: 0.3.46's own plant, its meta saying `v1`. */
function plantedBeforeHd1(surface: ToldSurface): void {
  withStore((s) => {
    expect(plantV1(s, surface)).toHaveLength(11);
    expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_V1);
  });
}

function toldRow(s: Store, title: string): NonNullable<ReturnType<Store["row"]>> {
  const rows = s
    .toldIds()
    .map((id) => s.row(id)!)
    .filter((r) => r.title === title);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

const v2Body = (surface: ToldSurface, title: string): string => toldSet(surface).find((m) => m.title === title)!.body;
const v1Body = (surface: ToldSurface, title: string): string => toldSetV1(surface).find((m) => m.title === title)!.body;

describe("the frozen v1 words are the words 0.3.46 planted", () => {
  test("for both surfaces, #1 and #9 as told.ts compares them match the shipped set byte for byte, and v2 changed exactly those two", () => {
    for (const surface of ["local", "hosted"] as const) {
      const words = toldV1Words(surface);
      expect(words.map((w) => w.title)).toEqual([TIPS, NINE]);
      for (const w of words) expect(w.bodies).toContain(v1Body(surface, w.title));
      // Every other starter is the same in both sets: nothing else needs a revision.
      const v1 = toldSetV1(surface);
      const v2 = toldSet(surface);
      expect(v2.map((m) => m.title)).toEqual(v1.map((m) => m.title));
      const changed = v2.filter((m, i) => m.body !== v1[i]!.body).map((m) => m.title);
      expect(changed).toEqual([TIPS, NINE]);
    }
  });
});

describe("local: an existing store gets the new #1 and #9 once, on its next open, where they are still the words it was given", () => {
  test("unchanged: the memory server's open rewrites both in place (same id, still told, the v1 words kept as a version); the meta says v2; a second open writes nothing", async () => {
    plantedBeforeHd1("local");
    const before = withStore((s) => {
      const nine = toldRow(s, NINE);
      const tips = toldRow(s, TIPS);
      // The stored words, read back, are the frozen ones (storage normalises nothing in them).
      expect(toldV1Words("local")[1]!.bodies).toContain(nine.body);
      expect(toldV1Words("local")[0]!.bodies).toContain(tips.body);
      return { nine: nine.id, tips: tips.id, count: s.toldIds().length };
    });

    await openThroughMcp();

    const after = withStore((s) => {
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_VERSION);
      expect(TOLD_SET_VERSION).toBe("v2");
      expect(s.toldIds()).toHaveLength(before.count);
      const nine = toldRow(s, NINE);
      const tips = toldRow(s, TIPS);
      expect(nine.id).toBe(before.nine);
      expect(tips.id).toBe(before.tips);
      expect(nine.body).toBe(v2Body("local", NINE));
      expect(nine.body).toContain("They can also ask me to delete one, with a day to undo it.");
      expect(tips.body).toBe(v2Body("local", TIPS));
      expect(tips.body).toContain('- "Delete that" removes one memory; "undo that" brings it back within a day.');
      for (const r of [nine, tips]) {
        expect(r.source).toBe(TOLD_SOURCE);
        expect(r.archived).toBe(0);
        expect(r.superseded_by).toBeNull();
        expect(JSON.parse(r.meta ?? "{}")).toMatchObject({ told: "v2" });
      }
      // The old words stay readable, filed under the revision's reason.
      const kept = s.versions(nine.id);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.reason).toBe(TOLD_REVISE_REASON);
      expect(kept[0]!.body).toBe(v1Body("local", NINE));
      // The other nine starters are untouched: still v1's row meta, no versions.
      const others = s
        .toldIds()
        .map((id) => s.row(id)!)
        .filter((r) => r.title !== NINE && r.title !== TIPS);
      expect(others).toHaveLength(9);
      for (const r of others) {
        expect(JSON.parse(r.meta ?? "{}")).toMatchObject({ told: "v1" });
        expect(s.versions(r.id)).toHaveLength(0);
      }
      return { revision: nine.revision };
    });

    // Once: a second open finds v2 and writes nothing.
    await openThroughMcp();
    withStore((s) => {
      const nine = toldRow(s, NINE);
      expect(nine.revision).toBe(after.revision);
      expect(s.versions(nine.id)).toHaveLength(1);
    });
  });

  test("edited: a #9 the person rewrote and a #1 they corrected stay theirs; the meta still moves to v2", async () => {
    plantedBeforeHd1("local");
    const MINE = "Told, not lived: I use `counterparts remove` myself, from the terminal, when something has to go.";
    const ids = withStore((s) => {
      const nine = toldRow(s, NINE);
      s.revise(nine.id, { body: MINE });
      const tips = toldRow(s, TIPS);
      const successor = s.supersede(tips.id, { type: "memory", kind: "fact", title: "Tips I like", body: "Only offer the reminder tip." });
      return { nine: nine.id, tips: tips.id, successor };
    });

    await openThroughMcp();

    withStore((s) => {
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_VERSION);
      const nine = s.row(ids.nine)!;
      expect(nine.body).toBe(MINE);
      expect(s.versions(ids.nine).map((v) => v.reason)).not.toContain(TOLD_REVISE_REASON);
      // The corrected #1: still superseded, still its v1 words, and no v2 copy appeared beside it.
      const tips = s.row(ids.tips)!;
      expect(tips.superseded_by).toBe(ids.successor);
      expect(tips.body).toBe(v1Body("local", TIPS));
      const live = s
        .toldIds()
        .map((id) => s.row(id)!)
        .filter((r) => r.archived === 0 && r.superseded_by === null);
      expect(live.some((r) => r.body.includes('"Delete that"'))).toBe(false);
    });
  });

  test("an observer open (doctor's) writes nothing: the store stays v1 until a writable one", async () => {
    plantedBeforeHd1("local");
    const cp = Counterpart.open({ dir: store, observer: true });
    cp.close();
    withStore((s) => {
      expect(s.getMeta(TOLD_SET_KEY)).toBe(TOLD_SET_V1);
      expect(toldRow(s, NINE).body).toBe(v1Body("local", NINE));
    }, true);
    await openThroughMcp();
    withStore((s) => expect(toldRow(s, NINE).body).toBe(v2Body("local", NINE)));
  });

  test("no set (a store from before S1) gets nothing, not even the meta; a new v2 plant needs no revision", async () => {
    withStore((s) => s.put({ type: "memory", kind: "fact", body: "A memory from before the starter set." }));
    await openThroughMcp();
    withStore((s) => {
      expect(s.getMeta(TOLD_SET_KEY)).toBeUndefined();
      expect(s.toldIds()).toHaveLength(0);
    });

    rmSync(store, { recursive: true, force: true });
    withStore((s) => {
      expect(plantTold(s, "local")).toHaveLength(11);
      expect(s.getMeta(TOLD_SET_KEY)).toBe("v2");
    });
    await openThroughMcp();
    withStore((s) => {
      const nine = toldRow(s, NINE);
      expect(nine.body).toBe(v2Body("local", NINE));
      expect(s.versions(nine.id)).toHaveLength(0);
    });
  });

  test("a v1 set whose meta never landed (a crash between the two writes) is settled by the next plant: v1 words become v2", () => {
    // The crash shape: 0.3.46's rows, no meta at all.
    withStore((s) => {
      plantV1(s, "local");
      s.updateMeta(TOLD_SET_KEY, () => null);
      s.updateMeta("told.surface", () => null);
      expect(s.getMeta(TOLD_SET_KEY)).toBeUndefined();
      expect(plantTold(s, "local")).toEqual([]);
      expect(s.getMeta(TOLD_SET_KEY)).toBe("v2");
      expect(s.toldIds()).toHaveLength(11);
      expect(toldRow(s, NINE).body).toBe(v2Body("local", NINE));
    });
  });
});
