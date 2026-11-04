/**
 * HD1 (2026-11-04) on local: delete one memory from chat, with a 24-hour undo.
 *
 * Through the doors a local install has:
 *   - the memory server as Claude Code launches it — `mcp/bin/serve.ts` as a
 *     CHILD PROCESS over stdio, JSON-RPC lines in and out;
 *   - the hooks' own session start and prompt handlers (`ClaudeCodeAdapter`,
 *     in process, with a stub spawner so no detached worker races the test):
 *     the wake and the footnotes;
 *   - the worker's run (`runner.ts#runOnce`), with its sweep's clock stepped
 *     past the window — the worker is what erases on local;
 *   - the console (`counterparts remove <id> --confirm`), which finishes a held
 *     memory at once.
 *
 * Hermetic: one temp dir per test (store, config, a HOME), removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { REMOVAL_HOLD_MS, Store } from "../src/core/store/index.js";
import { localDate } from "../src/core/time.js";

const SERVE = resolve(import.meta.dir, "../src/adapters/mcp/bin/serve.ts");
const VICTIM = "The spare bike lock code is 4471, written on the back of the garage calendar.";
const OTHER = "The dentist moved the cleaning to the second Tuesday of the month.";

let root: string;
let store: string;
let configPath: string;
let home: string;
const children: Stdio[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-hold-local-")));
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

async function server(): Promise<Stdio> {
  const s = new Stdio();
  await s.init();
  return s;
}

const removeOf = (r: Record<string, unknown>): Record<string, unknown> => r["remove"] as Record<string, unknown>;

/** Read the store as the console does: a second handle, read-only. */
function peek<T>(fn: (s: Store) => T): T {
  const s = Store.open({ dir: store, observer: true });
  try {
    return fn(s);
  } finally {
    s.close();
  }
}

function config(): AdapterConfig {
  return { dataDir: store, injectionBudgetBytes: 9000, snapshots: { daily: false } };
}

/** Every line under spans/ — the raw capture the erase must strike. */
function spansText(): string {
  const at = join(store, "spans");
  if (!existsSync(at)) return "";
  let out = "";
  const walk = (p: string): void => {
    for (const n of readdirSync(p)) {
      const f = join(p, n);
      if (statSync(f).isDirectory()) walk(f);
      else out += readFileSync(f, "utf8");
    }
  };
  walk(at);
  return out;
}

describe("HD1 on local: remember's remove over MCP stdio, the wake and footnotes, the worker's erase", () => {
  test("held: hidden from recall, the wake and footnotes; undo brings it back; held again; the worker erases it after 24 h", async () => {
    // Written in one conversation (a later write shows its neighbours, so the
    // next conversation is where "never shown" is true).
    const writer = await server();
    const victim = String((await writer.call("remember", { text: VICTIM, title: "Bike lock code", about: "owner" }))["id"]);
    await writer.call("remember", { text: OTHER, about: "owner" });
    await writer.close();
    expect(spansText()).toContain("4471");

    // Not shown in this conversation yet: refused, nothing changes.
    const mcp = await server();
    const early = removeOf(await mcp.call("remember", { remove: { id: victim } }));
    expect(early["reason"]).toBe("not-shown");
    expect(peek((s) => s.isHeld(victim))).toBe(false);
    // An unknown id: refused by name.
    expect(removeOf(await mcp.call("remember", { remove: { id: "mem_ffffffffffff" } }))["reason"]).toBe("unknown-id");

    // Shown, then deleted: the answer names it and says what local promises.
    expect(JSON.stringify(await mcp.call("recall", { ids: [victim] }))).toContain("4471");
    const held = removeOf(await mcp.call("remember", { remove: { id: victim } }));
    expect(held["ok"]).toBe(true);
    expect(held["reason"]).toBe("held");
    expect(String(held["note"])).toStartWith('Deleted: "Bike lock code". It\'s hidden now and erased at the first session after 24 hours; say "undo that" before then');
    expect(String(held["note"])).toContain("counterparts delete backups");
    // Idempotent.
    expect(removeOf(await mcp.call("remember", { remove: { id: victim } }))["reason"]).toBe("already-held");

    // Hidden from recall: facts, meaning, and by id.
    // What recall SHOWS, without the line that names the hold on purpose (R5, `heldForRemoval`).
    const shows = (x: Record<string, unknown>): boolean => {
      const said = JSON.stringify({ ...x, heldForRemoval: undefined });
      return said.includes(victim) || said.includes("garage calendar");
    };
    expect(shows(await mcp.call("recall", { question: "what is the bike lock code?", mode: "facts" }))).toBe(false);
    expect(shows(await mcp.call("recall", { question: "the bike lock code", mode: "meaning" }))).toBe(false);
    // By id the asked id is echoed back; its words are not.
    const byId = await mcp.call("recall", { ids: [victim] });
    expect(JSON.stringify(byId)).not.toContain("garage calendar");
    expect(byId["reason"]).toBe("handle-unknown");
    // The deleted handle lists it, by title.
    const listed = await mcp.call("recall", { handle: "deleted" });
    expect(listed["total"]).toBe(1);
    expect((listed["items"] as Record<string, unknown>[])[0]?.["title"]).toBe("Bike lock code");
    await mcp.close();

    // The wake and the footnotes: Claude Code's own session start and prompt handlers.
    const calls: SpawnPlan[] = [];
    const hooks = openAdapter(config(), { embedder: null, spawner: (plan) => (calls.push(plan), { pid: 1 }) });
    try {
      const at = localDate(Date.now(), peek((s) => s.zone()));
      const woke = hooks.sessionStart({ sessionId: "s-wake", scope: root, turns: [], at });
      const wake = woke.injection ?? "";
      expect(wake).not.toContain("garage calendar");
      expect(wake).toContain('1 memory deleted in chat is waiting to be erased: recall "deleted" to see or undo.');
      const prompt = hooks.userPromptSubmit({ sessionId: "s-wake", scope: root, turns: [], at, prompt: "what was the bike lock code on the garage calendar again?" });
      expect(prompt.injection ?? "").not.toContain("garage calendar");
      expect(prompt.injection ?? "").not.toContain(victim);
    } finally {
      hooks.counterpart.close();
    }

    // UNDO from a new conversation: shown by the deleted handle, then back whole.
    const again = await server();
    expect(removeOf(await again.call("remember", { remove: { id: victim, undo: true } }))["reason"]).toBe("not-shown");
    await again.call("recall", { handle: "deleted" });
    const undone = removeOf(await again.call("remember", { remove: { id: victim, undo: true } }));
    expect(undone["reason"]).toBe("released");
    expect(shows(await again.call("recall", { question: "what is the bike lock code?", mode: "facts" }))).toBe(true);
    expect(peek((s) => s.readProse(victim).body)).toBe(VICTIM);
    // NOT VACUOUS: the same prompt's footnotes do carry it once it is back.
    const back = openAdapter(config(), { embedder: null, spawner: () => ({ pid: 1 }) });
    try {
      const at = localDate(Date.now(), peek((s) => s.zone()));
      back.sessionStart({ sessionId: "s-back", scope: root, turns: [], at });
      const prompt = back.userPromptSubmit({ sessionId: "s-back", scope: root, turns: [], at, prompt: "what was the bike lock code on the garage calendar again?" });
      expect(`${prompt.injection ?? ""}`).toContain(victim);
    } finally {
      back.counterpart.close();
    }
    // And deleted again, for the worker.
    await again.call("recall", { ids: [victim] });
    expect(removeOf(await again.call("remember", { remove: { id: victim } }))["reason"]).toBe("held");
    await again.close();

    // THE WORKER, inside the window: nothing erased.
    const heldAt = peek((s) => s.pendingHolds()[0]!.at);
    const inside = await runOnce({ config: config(), embedder: null, build: null, now: () => heldAt + REMOVAL_HOLD_MS - 60_000 });
    expect(inside.ran || inside.reason !== "observer").toBe(true);
    expect(peek((s) => s.isHeld(victim))).toBe(true);
    // ...and after it: the console's removal, run by the worker, as `self`.
    await runOnce({ config: config(), embedder: null, build: null, now: () => heldAt + REMOVAL_HOLD_MS + 60_000 });
    const stages = peek((s) => s.removalRecord(victim).map((x) => `${x.stage}:${x.actor}`));
    expect(stages).toEqual(["held:self", "released:self", "held:self", "erasing:self", "requested:self", "dark:self", "chased:self", "complete:self"]);
    expect(peek((s) => s.row(victim)?.body)).toBe("");
    expect(peek((s) => s.pendingHolds())).toEqual([]);
    // Its own capture under spans/ is struck; the other memory's stays.
    expect(spansText()).not.toContain("4471");
    expect(spansText()).toContain("second Tuesday");
    // Nothing brings it back now.
    const late = await server();
    const after = removeOf(await late.call("remember", { remove: { id: victim, undo: true } }));
    expect(after["ok"]).toBe(false);
    await late.close();
  }, 120_000);

  test("`counterparts remove <id> --confirm` on a held memory says it is held, then finishes it at once", async () => {
    const mcp = await server();
    const id = String((await mcp.call("remember", { text: OTHER, title: "Dentist", about: "owner" }))["id"]);
    await mcp.call("recall", { ids: [id] });
    expect(removeOf(await mcp.call("remember", { remove: { id } }))["reason"]).toBe("held");
    await mcp.close();

    const out: string[] = [];
    const err: string[] = [];
    const dry: Io = { out: (l) => out.push(l), err: (l) => err.push(l) };
    expect(await run(["remove", id], { io: dry, env: { COUNTERPARTS_DATA_DIR: store } })).toBe(0);
    expect(out.join("\n")).toContain("held — deleted in chat and hidden since; it goes at ");
    expect(out.join("\n")).toContain("Dry run. Nothing has changed.");

    const confirmed: string[] = [];
    const io: Io = { out: (l) => confirmed.push(l), err: (l) => confirmed.push(l), prompt: async () => id };
    expect(await run(["remove", id, "--confirm"], { io, env: { COUNTERPARTS_DATA_DIR: store } })).toBe(0);
    const stages = peek((s) => s.removalRecord(id).map((x) => `${x.stage}:${x.actor}`));
    // The console claims the hold first (fix round R1), so no sweep erases it beside it.
    expect(stages).toEqual(["held:self", "erasing:owner", "requested:owner", "dark:owner", "chased:owner", "complete:owner"]);
    expect(peek((s) => s.row(id)?.body)).toBe("");
    expect(peek((s) => s.pendingHolds())).toEqual([]);
  }, 60_000);

  test("the erase of a held memory reads through the hold: its jot is struck BY CONTENT when the mint recorded no span hash", async () => {
    const { Counterpart } = await import("../src/core/counterpart.js");
    const { sweepHeldRemovals } = await import("../src/adapters/cli/removal.js");
    const { holdForRemoval } = await import("../src/core/removal-hold.js");
    const scope = "/Users/test/project-a";
    const body = "ZQHOLD the locker combination is 12-34-56";
    const cp = Counterpart.open({ dir: store });
    try {
      cp.captureJot({ session: "a", scope, text: body });
      cp.captureJot({ session: "a", scope, text: `${body} and the spare is in the drawer` });
      // Authored with a scope and NO span hash: the chase can only match the jot by its words.
      const id = cp.store.put({ type: "memory", kind: "fact", body, source: "authored", origin: { session: "a", scope } });
      expect(holdForRemoval(cp.store, id).ok).toBe(true);
      // Held: the plain read is refused, so a removal that read only that would lose the body.
      expect(() => cp.store.readProse(id)).toThrow();
      expect(spansText().split("ZQHOLD").length - 1).toBe(2);
      const at = cp.store.pendingHolds()[0]!.at;
      expect(sweepHeldRemovals(cp.store, { now: at + REMOVAL_HOLD_MS - 1 }).erased).toEqual([]);
      const swept = sweepHeldRemovals(cp.store, { now: at + REMOVAL_HOLD_MS });
      expect(swept.erased).toEqual([{ id, unchased: 0 }]);
      expect(swept.nextAt).toBeNull();
      // The exact jot is gone; the longer one that merely contains the words stays.
      expect(spansText().split("ZQHOLD").length - 1).toBe(1);
      expect(spansText()).toContain("and the spare is in the drawer");
      expect(cp.store.row(id)?.body).toBe("");
    } finally {
      cp.close();
    }
  });

  test("a night run cannot delete: the night's own server refuses remove", async () => {
    // The refusal is the server's `nightRun()` — the same two marks `remark` reads.
    const { openServer } = await import("../src/adapters/mcp/index.js");
    const night = openServer({ dir: store, session: "night-1", scope: root, env: { COUNTERPARTS_NIGHT_CHILD: "dream" } });
    try {
      const id = night.counterpart.store.put({ type: "memory", kind: "fact", body: OTHER });
      const out = await night.call("remember", { remove: { id } });
      const body = JSON.stringify(out);
      expect(body).toContain("night-run");
      expect(night.counterpart.store.isHeld(id)).toBe(false);
    } finally {
      night.counterpart.close();
    }
  });
});

/**
 * THE FIX ROUND (2026-11-04, review of #739 @ 5c4c6dbc): the claim, the
 * mitigations the review asked for, and the edges it ran.
 */
describe("HD1 fix round: one claim per erase, the undo it can't outrun, and the edges", () => {
  const { sweepHeldRemovals } = require("../src/adapters/cli/removal.js") as typeof import("../src/adapters/cli/removal.js");
  const { claimHold, holdForRemoval, releaseHold, CLAIM_LEASE_MS } = require("../src/core/removal-hold.js") as typeof import("../src/core/removal-hold.js");

  /** A writable store with memories, each put on the hold; returns their ids and the earliest hold's moment. */
  function heldStore(bodies: readonly string[]): { s: Store; ids: string[]; at: number } {
    const s = Store.open({ dir: store });
    const ids = bodies.map((body, i) => s.put({ type: "memory", kind: "fact", body, title: `Held ${String(i + 1)}` }));
    for (const id of ids) expect(holdForRemoval(s, id).ok).toBe(true);
    return { s, ids, at: Math.max(...s.pendingHolds().map((h) => h.at)) };
  }
  const stagesOf = (s: Store, id: string): string[] => s.removalRecord(id).map((x) => x.stage);

  test("R1: an undo that lands between the sweep's list and its erase keeps the memory whole — the claim finds it released", () => {
    const { s, ids, at } = heldStore([VICTIM]);
    const other = Store.open({ dir: store }); // the MCP server's process, standing in
    try {
      let undo: ReturnType<typeof releaseHold> | null = null;
      const report = sweepHeldRemovals(s, {
        now: at + REMOVAL_HOLD_MS + 1,
        onEvent: (name) => {
          if (name === "cli.removal.sweep.listed") undo = releaseHold(other, ids[0]!);
        },
      });
      expect(undo!.ok).toBe(true);
      expect(undo!.reason).toBe("released");
      expect(report.due).toBe(1);
      expect(report.erased).toEqual([]);
      expect(report.skipped).toBe(1);
      expect(stagesOf(s, ids[0]!)).toEqual(["held", "released"]);
      expect(s.readProse(ids[0]!).body).toBe(VICTIM);
    } finally {
      other.close();
      s.close();
    }
  });

  test("R1, the review's probe: two due holds, the second undone while the first is being erased — the second survives whole", () => {
    const { s, ids, at } = heldStore([VICTIM, OTHER]);
    const other = Store.open({ dir: store });
    try {
      let undo: ReturnType<typeof releaseHold> | null = null;
      // Whichever the sweep erases first, the OTHER is undone at that one's `dark`.
      let first: string | null = null;
      const report = sweepHeldRemovals(s, {
        now: at + REMOVAL_HOLD_MS + 1,
        onEvent: (name, data) => {
          if (name === "cli.removal.stage" && data["stage"] === "dark" && first === null) {
            first = String(data["target"]);
            undo = releaseHold(other, ids.find((x) => x !== first)!);
          }
        },
      });
      const second = ids.find((x) => x !== first)!;
      expect(undo!.reason).toBe("released");
      expect(report.due).toBe(2);
      expect(report.erased.map((e) => e.id)).toEqual([first!]);
      expect(report.skipped).toBe(1);
      expect(stagesOf(s, second)).toEqual(["held", "released"]);
      expect(s.readProse(second).body).toBe(second === ids[0] ? VICTIM : OTHER);
      expect(stagesOf(s, first!)).toEqual(["held", "erasing", "requested", "dark", "chased", "complete"]);
    } finally {
      other.close();
      s.close();
    }
  });

  test("R1: once claimed, an undo is refused (already-erasing) and the memory stays hidden; a claim whose erase never finished is taken again after its backoff, not before", () => {
    const { s, ids, at } = heldStore([VICTIM]);
    try {
      const now = at + REMOVAL_HOLD_MS + 1;
      expect(claimHold(s, ids[0]!, now)).toBe(true);
      // A second claim on a fresh one: no.
      expect(claimHold(s, ids[0]!, now)).toBe(false);
      const undo = releaseHold(s, ids[0]!);
      expect(undo).toEqual({ ok: false, reason: "already-erasing", id: ids[0]! });
      expect(s.deniedIds()).toContain(ids[0]!);
      expect(() => s.readProse(ids[0]!)).toThrow();
      // A second ask to delete it changes nothing (no new `held` voiding the claim).
      expect(holdForRemoval(s, ids[0]!).reason).toBe("already-held");
      expect(stagesOf(s, ids[0]!)).toEqual(["held", "erasing"]);
      // Not listed as undoable, and not counted on the wake.
      expect(s.pendingHolds()).toEqual([]);
      // The claimer died: inside the lease nothing happens; after it, the next sweep erases.
      const inside = sweepHeldRemovals(s, { now: now + CLAIM_LEASE_MS - 1 });
      expect(inside.due).toBe(0);
      expect(inside.nextAt).toBe(now + CLAIM_LEASE_MS);
      const after = sweepHeldRemovals(s, { now: now + CLAIM_LEASE_MS });
      expect(after.erased.map((e) => e.id)).toEqual([ids[0]!]);
      expect(stagesOf(s, ids[0]!)).toEqual(["held", "erasing", "erasing", "requested", "dark", "chased", "complete"]);
    } finally {
      s.close();
    }
  });

  test("item 3: two erasers — the second sweep runs whole between the first's list and its claim; exactly one erases", () => {
    const { s, ids, at } = heldStore([VICTIM]);
    const second = Store.open({ dir: store });
    try {
      const now = at + REMOVAL_HOLD_MS + 1;
      let inner: ReturnType<typeof sweepHeldRemovals> | null = null;
      const outer = sweepHeldRemovals(s, {
        now,
        onEvent: (name) => {
          if (name === "cli.removal.sweep.listed" && inner === null) inner = sweepHeldRemovals(second, { now });
        },
      });
      expect(inner!.erased.map((e) => e.id)).toEqual([ids[0]!]);
      expect(outer.due).toBe(1);
      expect(outer.erased).toEqual([]);
      expect(outer.failed).toEqual([]);
      expect(outer.skipped).toBe(1);
      // And the other way: a sweep that starts while one is mid-erase finds nothing due.
      const { ids: more } = (() => {
        const id = s.put({ type: "memory", kind: "fact", body: OTHER });
        holdForRemoval(s, id);
        return { ids: [id] };
      })();
      const at2 = s.pendingHolds()[0]!.at;
      let during: ReturnType<typeof sweepHeldRemovals> | null = null;
      sweepHeldRemovals(s, {
        now: at2 + REMOVAL_HOLD_MS + 1,
        onEvent: (name, data) => {
          if (name === "cli.removal.stage" && data["stage"] === "requested" && during === null) during = sweepHeldRemovals(second, { now: at2 + REMOVAL_HOLD_MS + 1 });
        },
      });
      expect(during!.due).toBe(0);
      expect(during!.erased).toEqual([]);
      for (const id of [ids[0]!, more[0]!]) {
        expect(stagesOf(s, id)).toEqual(["held", "erasing", "requested", "dark", "chased", "complete"]);
      }
    } finally {
      second.close();
      s.close();
    }
  });

  test("item 3, racing for real: four processes sweep the same due hold at once — one erases, the rest do nothing", async () => {
    const { s, ids, at } = heldStore([VICTIM]);
    s.close();
    const now = at + REMOVAL_HOLD_MS + 1;
    const storeMod = resolve(import.meta.dir, "../src/core/store/index.ts");
    const removalMod = resolve(import.meta.dir, "../src/adapters/cli/removal.ts");
    const script = `
      const { Store } = await import(${JSON.stringify(storeMod)});
      const { sweepHeldRemovals } = await import(${JSON.stringify(removalMod)});
      const s = Store.open({ dir: ${JSON.stringify(store)} });
      const r = sweepHeldRemovals(s, { now: ${String(now)} });
      s.close();
      console.log(JSON.stringify({ erased: r.erased.length, failed: r.failed.length, skipped: r.skipped }));
    `;
    const runOne = (): Promise<{ erased: number; failed: number; skipped: number }> =>
      new Promise((res, rej) => {
        const child = spawn(process.execPath, ["-e", script], { cwd: root, env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr.on("data", (d: Buffer) => (err += d.toString()));
        child.on("exit", (code) => {
          const line = out.trim().split("\n").at(-1) ?? "";
          if (code !== 0 || !line.startsWith("{")) rej(new Error(`sweeper exited ${String(code)}: ${err.slice(-600)}`));
          else res(JSON.parse(line) as { erased: number; failed: number; skipped: number });
        });
      });
    const results = await Promise.all([runOne(), runOne(), runOne(), runOne()]);
    expect(results.reduce((n, r) => n + r.erased, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
    const stages = peek((x) => stagesOf(x, ids[0]!));
    expect(stages).toEqual(["held", "erasing", "requested", "dark", "chased", "complete"]);
  }, 60_000);

  test("R5: the count line rides a RESUMED session's start too, through the hook", async () => {
    const { s, ids } = heldStore([VICTIM]);
    s.put({ type: "memory", kind: "fact", body: OTHER });
    s.close();
    // A boundary first, so there is a wake to hand out and a session to resume (inside the window: nothing erased).
    await runOnce({ config: config(), embedder: null, build: null });
    expect(peek((x) => x.isHeld(ids[0]!))).toBe(true);
    const hooks = openAdapter(config(), { embedder: null, spawner: () => ({ pid: 1 }) });
    try {
      const at = localDate(Date.now(), hooks.counterpart.store.zone());
      hooks.sessionStart({ sessionId: "s-long", scope: root, turns: [], at });
      const resumed = hooks.sessionStart({ sessionId: "s-long", scope: root, turns: [], at, source: "resume" });
      const text = resumed.injection ?? "";
      expect(text).toContain("this session was resumed");
      expect(text).toContain('1 memory deleted in chat is waiting to be erased: recall "deleted" to see or undo.');
      expect(text).not.toContain(ids[0]!);
      expect(text).not.toContain("garage calendar");
    } finally {
      hooks.counterpart.close();
    }
  });

  test("R5: recall-then-remove is allowed (today's behaviour, a recorded decision) — and the next recall names the hold plainly, once", async () => {
    // WHY THIS IS ALLOWED: a model that recalls a memory and then deletes it
    // passes the shown gate in two calls, whoever asked. ROADMAP 10:33: no
    // refusal and no cap; the mitigation is VISIBILITY — the remove answer
    // names it, the next recall block names it again, the wake counts it
    // (resumed sessions too) — and the 24-hour undo is the backstop.
    const mcp = await server();
    const id = String((await mcp.call("remember", { text: VICTIM, title: "Bike lock code", about: "owner" }))["id"]);
    // The model's own recall is enough to make it "shown".
    const found = await mcp.call("recall", { question: "bike lock code", mode: "facts" });
    expect(JSON.stringify(found)).toContain(id);
    expect(found["heldForRemoval"]).toBeUndefined();
    const held = removeOf(await mcp.call("remember", { remove: { id } }));
    expect(held["reason"]).toBe("held");
    const next = await mcp.call("recall", { question: "what is on the dentist's calendar?", mode: "facts" });
    expect(next["heldForRemoval"]).toEqual([`held for removal: "Bike lock code" · undo within 24h: remember with remove: {id: "${id}", undo: true}`]);
    const after = await mcp.call("recall", { handle: "deleted" });
    expect(after["heldForRemoval"]).toBeUndefined();
    // Undone before the next recall: nothing to say.
    expect(removeOf(await mcp.call("remember", { remove: { id } }))["reason"]).toBe("already-held");
    expect(removeOf(await mcp.call("remember", { remove: { id, undo: true } }))["reason"]).toBe("released");
    await mcp.call("recall", { ids: [id] });
    expect(removeOf(await mcp.call("remember", { remove: { id } }))["reason"]).toBe("held");
    expect(removeOf(await mcp.call("remember", { remove: { id, undo: true } }))["reason"]).toBe("released");
    expect((await mcp.call("recall", { question: "bike lock", mode: "facts" }))["heldForRemoval"]).toBeUndefined();
    await mcp.close();
  }, 60_000);

  test("R7 and R9: remark, core and feelingsNow on a held id say not-shown-or-gone; {remove, updates} without text refuses as it would alone", async () => {
    const mcp = await server();
    const id = String((await mcp.call("remember", { text: VICTIM, title: "Bike lock code", about: "owner" }))["id"]);
    await mcp.call("recall", { ids: [id] });
    expect(removeOf(await mcp.call("remember", { remove: { id } }))["reason"]).toBe("held");
    const remark = await mcp.call("remember", { remark: { id, about: "work", why: "it is about the garage" } });
    expect((remark["remark"] as Record<string, unknown>)["reason"]).toBe("not-shown-or-gone");
    const core = await mcp.call("remember", { core: { id, decision: "keep", why: "it matters" } });
    expect((core["core"] as Record<string, unknown>)["reason"]).toBe("not-shown-or-gone");
    const felt = await mcp.call("remember", { feelingsNow: [{ id, emotion: "relieved", strength: 0.5 }] });
    expect((felt["feelingsNow"] as Record<string, unknown>)["recorded"]).toBe(0);
    for (const out of [remark, core, felt]) {
      expect(JSON.stringify(out)).not.toContain("REMOVED");
      expect(JSON.stringify(out)).not.toContain("threw");
    }
    // R9: `updates` beside `remove` and no text — refused as `updates` alone is, not dropped in silence.
    const other = String((await mcp.call("remember", { text: OTHER, about: "owner" }))["id"]);
    const alone = await mcp.call("remember", { updates: other });
    const beside = await mcp.call("remember", { remove: { id: other }, updates: other });
    expect(beside["reason"]).toBe(alone["reason"]);
    expect(beside["reason"]).not.toBe("remove-only");
    expect(beside["remove"]).toBeDefined();
    await mcp.close();
  }, 60_000);
});
