/**
 * "STILL OPEN" FOLLOWS THE RAISE SCHEDULE (2026-11-13, "the putty": a
 * counterpart's own open questions sat in every wake's "Still open", and one
 * subject was raised 11 times in 10 days).
 *
 * An open memory listed as one of Still open's lines is a raise, on the same
 * chain as the turn lane's and the wake's "Waiting on" mention
 * (`owner-waits.ts`): listed the day it is new (every wake that day), then only
 * on its steps (3, 7, 14 lived days, no weekly floor), counted as more open in
 * between, then parked: counted, not listed, still under recall "still open".
 * A dated item keeps its date's rule.
 *
 * The real-path checks run the SessionStart hook as a child process on a store
 * this file builds, over simulated lived days (the store's `livedDay`), on both
 * wake roads: the shaped one and the assembled one. Hermetic (CLAUDE.md): a
 * fresh temp dir per test, removed afterwards; COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1
 * and a temp HOME. Every word is invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { OWNER_RAISED_EVENT, laneHeld, laneState, noteLaneShown, noteRaised, ownerParked, raiseRecord } from "../src/core/owner-waits.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { WAKE_SHAPE_LIMITS } from "../src/core/self/tunables.js";
import { readSentinel } from "../src/core/self/index.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const OWN = "aaaa1111-0000-4000-8000-000000000001";
const sid = (n: number): string => `cccc3333-0000-4000-8000-${String(n).padStart(12, "0")}`;
const START = 20;
/** What both roads print of the item (the assembled road lines it without its id). */
const MARK = "booth news";

let root: string;
let storeDir: string;
let conf: string;
let HERE: string;
const open: { close(): void }[] = [];
let next = 0;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-lane-sched-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  HERE = join(root, "journal");
  for (const d of [HERE, conf]) mkdirSync(d, { recursive: true });
  next = 100;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function brain(shape: "on" | "off"): Counterpart {
  const c = Counterpart.open({ dir: storeDir, now: () => Date.now(), timeZone: "UTC", budgetBytes: BUDGET, identity: { name: "Wren" } });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, shape);
  c.store.setMeta("livedDay", String(START));
  return c;
}

/** An open item in the counterpart's own words: its curiosity, waiting on the person. No `asked` mark. */
function curious(c: Counterpart, more: { eventDate?: string; body?: string } = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body: more.body ?? "Wren had not yet told their dad the booth news. I said I'd like to hear what he says when Wren tells him.",
    title: "Wren to tell their dad the booth news",
    meta: { unresolved: true, settlesWhen: "Wren tells their dad and shares his reaction" },
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    about: "owner" as const,
    salience: { relevance: 0.7, emotional: 0.5, predictive: 0.5 },
    origin: { session: OWN, scope: HERE },
  });
}

function hook(o: { session?: string; entrypoint?: string; budget?: number } = {}): string {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: o.budget ?? BUDGET, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) writeScopes(join(conf, "scopes.json"), setScope(null, HERE, "on", { at: "2026-09-22" }));
  const session = o.session ?? sid((next += 1));
  const env: Record<string, string | undefined> = { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home"), CLAUDE_CODE_ENTRYPOINT: o.entrypoint ?? "cli" };
  delete env["CLAUDE_CODE_SESSION_ATTENDED"];
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: "SessionStart", source: "startup", cwd: HERE }),
    env,
  });
  expect(r.status).toBe(0);
  const model = r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  const at = model.indexOf("<!-- counterparts:wake ");
  const end = model.indexOf("\n", model.indexOf("<!-- counterparts:wake/end"));
  const wake = at < 0 ? model : model.slice(at, end < 0 ? undefined : end);
  if (process.env["LANE_DUMP"] === "1") console.log(`\n===== ${session}\n${wake}`);
  expect(readSentinel(wake).intact).toBe(true);
  return wake;
}

/** The "Still open" block, whatever the road calls its count line. */
function stillOpen(wake: string): string {
  const i = wake.indexOf("Still open");
  if (i < 0) return "";
  const j = wake.indexOf("\n\n", i);
  return wake.slice(i, j < 0 ? undefined : j);
}

describe("the lane's schedule, as a rule", () => {
  test("listed new and all that day, then on days 3 and 10, waiting between, parked from day 24", () => {
    expect(laneState([], 0)).toBe("list");
    expect(laneState([0], 0)).toBe("list");
    expect(laneState([0], 1)).toBe("waiting");
    expect(laneState([0], 2)).toBe("waiting");
    expect(laneState([0], 3)).toBe("list");
    expect(laneState([0, 3], 3)).toBe("list");
    expect(laneState([0, 3], 9)).toBe("waiting");
    expect(laneState([0, 3], 10)).toBe("list");
    expect(laneState([0, 3, 10], 23)).toBe("waiting");
    expect(laneState([0, 3, 10], 24)).toBe("parked");
  });

  test("a shown line is raised once a day on its own chain; a dated item and a closed one are not raised", () => {
    const c = brain("on");
    const id = curious(c);
    const dated = curious(c, { eventDate: "2026-12-01" });
    const plain = c.store.put({ type: "memory", kind: "fact", body: "Wren likes the booth.", about: "owner", salience: { relevance: 0.5, emotional: 0.2, predictive: 0.2 }, origin: { session: OWN, scope: HERE } });
    expect(noteLaneShown(c.store, [id, dated, plain], { day: START, session: OWN })).toBe(1);
    expect(noteLaneShown(c.store, [id], { day: START, session: sid(1) })).toBe(0);
    expect(raiseRecord(c.store)[id]?.days).toEqual([START]);
    expect(raiseRecord(c.store)[dated]).toBeUndefined();
    const held = (d: number): "waiting" | "parked" | null => laneHeld(c.store, d)(id);
    expect(held(START)).toBeNull();
    expect(held(START + 1)).toBe("waiting");
    expect(held(START + 3)).toBeNull();
    // A revision starts the chain again.
    c.store.revise(id, { body: "Wren told Opal first; their dad has not heard yet." });
    expect(held(START + 1)).toBeNull();
    // A non-`asked` item raised to the end is parked for the handle too.
    noteLaneShown(c.store, [id], { day: START + 1, session: OWN });
    noteLaneShown(c.store, [id], { day: START + 4, session: OWN });
    noteLaneShown(c.store, [id], { day: START + 11, session: OWN });
    expect(ownerParked(c.store, START + 25).has(id)).toBe(true);
  });
});

for (const shape of ["on", "off"] as const) {
  describe(`through the SessionStart wake (wake shape ${shape})`, () => {
    test("new on day 0 (every wake that day), not on days 1-2, again on day 3 and day 10, then parked: counted, not listed", () => {
      const c = brain(shape);
      const id = curious(c);
      // The assembled road builds on a published bundle: one turn-end composes it.
      if (shape === "off") c.rebrief({ budgetBytes: BUDGET, at: "2026-11-13" });
      const on = (d: number): string => {
        c.store.setMeta("livedDay", String(START + d));
        return stillOpen(hook());
      };
      const d0 = on(0);
      expect(d0).toContain(MARK);
      // A second session the same day still lists it.
      expect(on(0)).toContain(MARK);
      expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(1);
      for (const d of [1, 2]) {
        const w = on(d);
        expect(w).not.toContain(MARK);
        // The shaped road counts it behind its door; the assembled one, with nothing listed, says nothing of it.
        if (shape === "on") expect(w).toMatch(/1 more open/);
        else expect(w).toBe("");
      }
      expect(on(3)).toContain(MARK);
      for (const d of [4, 9]) expect(on(d)).not.toContain(MARK);
      expect(on(10)).toContain(MARK);
      for (const d of [11, 23]) expect(on(d)).not.toContain(MARK);
      const d24 = on(24);
      expect(d24).not.toContain(MARK);
      expect(d24).toMatch(/1 parked/);
      expect(raiseRecord(c.store)[id]?.days).toEqual([START, START + 3, START + 10]);
      // Nothing deleted: recall "still open" lists it, marked parked.
      expect(c.stillOpen({ scope: HERE }).items.find((i) => i.id === id)?.parked).toBe(true);
      expect(c.store.row(id)).toBeDefined();
    });
  });
}

describe("through the SessionStart wake (the published bundle, delivered as it was)", () => {
  // Another ceiling at the session start than the bundle was composed under: the bundle goes as it was.
  const deliver = (): string => {
    const w = hook({ budget: BUDGET + 1 });
    expect(w).toContain("composed at the last boundary");
    return stillOpen(w);
  };

  test("a bundle each turn-end composes follows the same days", () => {
    const c = brain("off");
    const id = curious(c);
    const on = (d: number): string => {
      c.store.setMeta("livedDay", String(START + d));
      c.rebrief({ budgetBytes: BUDGET, at: "2026-11-13" });
      return deliver();
    };
    expect(on(0)).toContain(MARK);
    for (const d of [1, 2]) expect(on(d)).not.toContain(MARK);
    expect(on(3)).toContain(MARK);
    expect(on(9)).not.toContain(MARK);
    expect(on(10)).toContain(MARK);
    const d24 = on(24);
    expect(d24).not.toContain(MARK);
    expect(d24).toMatch(/1 parked/);
    expect(raiseRecord(c.store)[id]?.days).toEqual([START, START + 3, START + 10]);
  });

  test("a bundle composed before the step, delivered on a waiting day, lists it but takes no step", () => {
    const c = brain("off");
    const id = curious(c);
    c.rebrief({ budgetBytes: BUDGET, at: "2026-11-13" });
    expect(deliver()).toContain(MARK);
    // Lived day 1 with day 0's bundle: shown again (stale), but no step taken.
    c.store.setMeta("livedDay", String(START + 1));
    expect(deliver()).toContain(MARK);
    expect(raiseRecord(c.store)[id]?.days).toEqual([START]);
  });
});

describe("who uses a showing up", () => {
  test("a headless (agent) session follows the schedule but takes no step; the next attended one does", () => {
    const c = brain("on");
    const id = curious(c);
    expect(stillOpen(hook({ entrypoint: "sdk-cli" }))).toContain(MARK);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(0);
    expect(stillOpen(hook())).toContain(MARK);
    expect(raiseRecord(c.store)[id]?.days).toEqual([START]);
    // Day 1: waiting, for the agent too.
    c.store.setMeta("livedDay", String(START + 1));
    expect(stillOpen(hook({ entrypoint: "sdk-cli" }))).not.toContain(MARK);
  });
});

describe("review of #819", () => {
  test("1. a parked chain survives the record's bound: chains of items no longer open go first", () => {
    const c = brain("on");
    const id = curious(c);
    for (const d of [0, 3, 10]) noteLaneShown(c.store, [id], { day: START + d, session: OWN });
    expect(laneHeld(c.store, START + 24)(id)).toBe("parked");
    // The bound's worth of other chains, for ids that are no open item (closed, gone).
    for (let i = 0; i < WAKE_SHAPE_LIMITS.OWNER_RAISES_KEPT; i++) {
      noteRaised(c.store, { id: `mem_gone${String(i).padStart(6, "0")}`, version: 1, kind: "memory" }, { day: START + 24, session: OWN, via: "lane" });
    }
    expect(raiseRecord(c.store)[id]?.days).toEqual([START, START + 3, START + 10]);
    expect(laneHeld(c.store, START + 24)(id)).toBe("parked");
  });

  test("2. at upgrade, an item with no chain untouched a fortnight is parked, a recent one is new; nothing old is listed for a fortnight", () => {
    const c = brain("on");
    const old: string[] = [];
    for (let i = 0; i < 20; i++) old.push(curious(c, { body: `OLDITEM${String(i)} Wren had not said how the quiz night went. I asked once.` }));
    c.store.setMeta("livedDay", String(START + 20));
    const fresh = [curious(c, { body: "NEWITEM1 Wren is choosing between the two posters." }), curious(c, { body: "NEWITEM2 Wren has not heard back about the booth lights." })];
    const d0 = stillOpen(hook());
    for (const id of fresh) expect(d0).toContain(id);
    for (const id of old) expect(d0).not.toContain(id);
    expect(d0).toContain("20 parked");
    for (let d = 1; d <= 14; d++) {
      c.store.setMeta("livedDay", String(START + 20 + d));
      const w = stillOpen(hook());
      for (const id of old) expect(w).not.toContain(id);
    }
    // Nothing deleted: the handle lists them, parked.
    const listed = c.stillOpen({ scope: HERE }).items.filter((i) => old.includes(i.id));
    expect(listed.length).toBe(20);
    expect(listed.every((i) => i.parked === true)).toBe(true);
  });

  test("5. the assembled road with every item waiting still says how many are open, and where", () => {
    const c = brain("off");
    curious(c);
    c.rebrief({ budgetBytes: BUDGET, at: "2026-11-13" });
    expect(stillOpen(hook())).toContain(MARK);
    c.store.setMeta("livedDay", String(START + 1));
    const w = stillOpen(hook());
    expect(w).not.toContain(MARK);
    expect(w).toContain("1 — none due today");
    expect(w).toContain('recall "still open"');
  });
});

describe("4. the MCP wake tool: an unattended wake follows the schedule but takes no step", () => {
  function mcp(dir: string, host: string | undefined, env: Record<string, string>): McpServer {
    const s = openServer({
      dir,
      ...(host === undefined ? {} : { host }),
      env,
      lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
      manifestVersion: () => null,
    });
    open.push({ close: () => s.counterpart.close() });
    return s;
  }
  // The wake tool is a chat host's (claude.ai, Desktop): a person opens the chat, unless the host says otherwise.
  const cases: [string, Record<string, string>, Record<string, unknown>, number][] = [
    ["the host says nobody is there (a routine)", { CLAUDE_CODE_SESSION_ATTENDED: "0" }, {}, 0],
    ["a night's own wake", {}, { night: true }, 0],
    ["the host says a person is there", { CLAUDE_CODE_SESSION_ATTENDED: "1" }, {}, 1],
    ["a chat with no word either way", {}, {}, 1],
  ];
  for (const [name, env, args, steps] of cases) {
    test(name, async () => {
      const dir = join(root, `mcp-${String(next += 1)}`);
      const s = mcp(dir, CLAUDE_AI_HOST, env);
      const c = s.counterpart;
      c.store.setMeta("livedDay", String(START));
      const id = curious(c);
      c.rebrief({ budgetBytes: BUDGET, at: "2026-11-13" });
      const r = await s.call("wake", args);
      expect(JSON.stringify(r)).toContain(MARK);
      expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(steps);
    });
  }
});
