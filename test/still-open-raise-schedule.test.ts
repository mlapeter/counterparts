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
import { OWNER_RAISED_EVENT, laneHeld, laneState, noteLaneShown, ownerParked, raiseRecord } from "../src/core/owner-waits.js";
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
function curious(c: Counterpart, more: { eventDate?: string } = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body: "Wren had not yet told their dad the booth news. I said I'd like to hear what he says when Wren tells him.",
    title: "Wren to tell their dad the booth news",
    meta: { unresolved: true, settlesWhen: "Wren tells their dad and shares his reaction" },
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    about: "owner" as const,
    salience: { relevance: 0.7, emotional: 0.5, predictive: 0.5 },
    origin: { session: OWN, scope: HERE },
  });
}

function hook(o: { session?: string } = {}): string {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) writeScopes(join(conf, "scopes.json"), setScope(null, HERE, "on", { at: "2026-09-22" }));
  const session = o.session ?? sid((next += 1));
  const env: Record<string, string | undefined> = { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home"), CLAUDE_CODE_ENTRYPOINT: "cli" };
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
