/**
 * `coreContextFor` (2026-09-27): the core lanes' context for one memory, built
 * in ONE place — exactly what consolidation hands `promote` — so every reader
 * that asks "could this cross?" (the dashboard's eligibility views) asks it
 * with the same inputs as the night does.
 *
 * What it keeps: with the reflected-feeling door closed and open, the helper's
 * context gives, row by row, the verdict consolidation reaches; the fields are
 * the ones D1 (#256) asks for; and building it writes nothing, from an
 * observer too.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS, promote } from "../src/core/physics/index.js";
import { REFLECTED_FEELING_KEY, coreContextFor, runConsolidate } from "../src/core/sleep/index.js";
import type { ReadsCoreContext } from "../src/core/sleep/index.js";
import type { PutInput, ReadOnlyStore, Store } from "../src/core/store/index.js";
import { rowToPhysics } from "../src/core/store/operational.js";
import { withCoreDoor, withTwoLanes } from "./two-lanes-fixture.js";

let dir: string;
const open: Counterpart[] = [];
const SESSION = "s-core-context";

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-core-context-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" } });
  open.push(c);
  return c;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

let dateN = 0;
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10));
  return c.store.livedDay();
}

/**
 * The D1 scene (#256): a strongly felt memory about us whose only return is a
 * reflection's citation; one about us felt only later, by a reflection; a
 * plain fact; and a felt one the owner sent back out of the core.
 */
function scene(c: Counterpart): { felt: string; later: string; fact: string; demoted: string } {
  nextDay(c);
  const later = mem(c, "Mike lets an AI act for itself.", { kind: "person", about: "us", salience: { relevance: 0.7, emotional: 0, predictive: 0.5 } });
  const felt = mem(c, "The night the store nearly corrupted and we saved it together.", {
    kind: "self",
    about: "us",
    salience: { relevance: 0.7, emotional: 0.9, predictive: 0.5 },
  });
  const fact = mem(c, "The dashboard deploys when main is pushed.");
  const demoted = mem(c, "I was proud of the release we shipped together.", {
    kind: "self",
    about: "me",
    salience: { relevance: 0.7, emotional: 0.9, predictive: 0.5 },
  });
  c.store.appendCoreEvent({ memoryId: demoted, action: "demoted", day: c.store.livedDay(), actor: "owner" });
  nextDay(c);
  nextDay(c);
  const begun = c.reflections.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  const done = c.reflections.finish({
    reflection: begun.bundle.reflection,
    session: SESSION,
    entry: "Looking back over the last few days, a few things stand out.",
    cites: [later, felt, demoted],
    feelings: [{ id: later, core: "happy", emotion: "hopeful", strength: 0.9 }],
  });
  if (!done.ok) throw new Error(`finish refused: ${done.reason}`);
  return { felt, later, fact, demoted };
}

/** What consolidation would promote tonight — its own read-only report. */
function wouldPromote(store: Store, day: number): string[] {
  const out = runConsolidate({ store, day, apply: false, budget: 10_000, step: () => undefined, event: () => undefined });
  return out.promoted.map((p) => p.id);
}

/** The helper's verdict for one row, through the same `promote` consolidation calls. */
function helperPromotes(store: ReadsCoreContext & Pick<Store, "row">, id: string, day: number): boolean {
  const row = store.row(id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return promote(rowToPhysics(row), day, coreContextFor(store, row, day)).promoted;
}

describe("the helper and consolidation agree", () => {
  // The two lanes (physics §5.3 until 2026-10-24): the support door is pinned off here (E2).
  withTwoLanes();
  test("door closed and open: row by row, the helper's context reaches consolidation's verdict", () => {
    const c = brain();
    const m = scene(c);
    const day = c.store.livedDay();
    const ids = [m.felt, m.later, m.fact, m.demoted];

    const verdicts: Record<string, Record<string, boolean>> = {};
    for (const door of ["off", "on"]) {
      c.store.setMeta(REFLECTED_FEELING_KEY, door);
      const night = wouldPromote(c.store, day);
      verdicts[door] = {};
      for (const id of ids) {
        const mine = helperPromotes(c.store, id, day);
        expect(`${door} ${id}: ${String(mine)}`).toBe(`${door} ${id}: ${String(night.includes(id))}`);
        (verdicts[door] as Record<string, boolean>)[id] = mine;
      }
    }
    // The door matters here, so the agreement above is not two empty lists.
    expect(verdicts["off"]?.[m.felt]).toBe(false);
    expect(verdicts["off"]?.[m.later]).toBe(false);
    expect(verdicts["on"]?.[m.felt]).toBe(true);
    expect(verdicts["on"]?.[m.later]).toBe(true);
    // Never a plain fact, never what the owner sent back.
    for (const door of ["off", "on"]) {
      expect(verdicts[door]?.[m.fact]).toBe(false);
      expect(verdicts[door]?.[m.demoted]).toBe(false);
    }

    // Closed, an ORDINARY use after a gap opens the fast lane — on both paths.
    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    const used = nextDay(c);
    expect(c.store.reinforce(m.felt, used, "referenced", { cued: true }).ret?.counted).toBe(true);
    expect(helperPromotes(c.store, m.felt, used)).toBe(true);
    expect(wouldPromote(c.store, used)).toContain(m.felt);
  });

  test("the context's fields: who it is about, the owner's demotion, the door, and the last ordinary use", () => {
    const c = brain();
    const m = scene(c);
    const day = c.store.livedDay();
    const row = (id: string) => c.store.row(id) as NonNullable<ReturnType<Store["row"]>>;

    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    // The recurrence lane's count (2026-10-11) rides along for a candidate.
    const { recurrence, ...closed } = coreContextFor(c.store, row(m.felt), day);
    expect(closed).toEqual({
      aboutMe: true,
      demoted: false,
      acceptsReflectedFeeling: false,
      organicReturnDay: null,
      day,
    });
    expect(recurrence).toMatchObject({ anchored: true, fullDays: 1, sessions: 1 });
    // Not about me: no demotion read, no return read.
    expect(coreContextFor(c.store, row(m.fact), day)).toEqual({ aboutMe: false, demoted: false, acceptsReflectedFeeling: false, day });
    expect(coreContextFor(c.store, row(m.demoted), day).demoted).toBe(true);

    c.store.setMeta(REFLECTED_FEELING_KEY, "on");
    const open_ = coreContextFor(c.store, row(m.felt), day);
    const { recurrence: _r, ...openRest } = open_;
    expect(openRest).toEqual({ aboutMe: true, demoted: false, acceptsReflectedFeeling: true, day });
    expect("organicReturnDay" in open_).toBe(false);
    // The caller may hand in the door it already read (consolidation does, once a night).
    expect(coreContextFor(c.store, row(m.felt), day, { acceptsReflectedFeeling: false }).organicReturnDay).toBeNull();

    const used = nextDay(c);
    c.store.reinforce(m.felt, used, "referenced", { cued: true });
    expect(coreContextFor(c.store, row(m.felt), used, { acceptsReflectedFeeling: false }).organicReturnDay).toBe(used);
  });
});

describe("the helper and consolidation agree with the support door on (E2 review)", () => {
  // The support door deciding: "on" explicitly (the default is "shadow" since the E2 addendum).
  withCoreDoor("on");
  test("door closed and open, before and after real uses: row by row, the helper's context reaches consolidation's verdict", () => {
    expect(PHYSICS.CORE_DOOR_SUPPORT).toBe("on");
    const c = brain();
    const m = scene(c);
    const ids = [m.felt, m.later, m.fact, m.demoted];
    const agree = (day: number): Record<string, Record<string, boolean>> => {
      const out: Record<string, Record<string, boolean>> = {};
      for (const door of ["off", "on"]) {
        c.store.setMeta(REFLECTED_FEELING_KEY, door);
        const night = wouldPromote(c.store, day);
        out[door] = {};
        for (const id of ids) {
          const mine = helperPromotes(c.store, id, day);
          expect(`${door} ${id}: ${String(mine)}`).toBe(`${door} ${id}: ${String(night.includes(id))}`);
          (out[door] as Record<string, boolean>)[id] = mine;
        }
      }
      return out;
    };
    // A reflection's citation alone: no lived day, so nothing crosses on either path.
    const before = agree(c.store.livedDay());
    for (const door of ["off", "on"]) for (const id of ids) expect(before[door]?.[id]).toBe(false);
    // Real uses, spaced from the making: felt (0.9) is in on both paths; never a fact, never the demoted.
    nextDay(c);
    const used = nextDay(c);
    for (const id of [m.felt, m.later, m.fact, m.demoted]) c.store.reinforce(id, used, "referenced", { cued: true });
    const after = agree(used);
    for (const door of ["off", "on"]) {
      expect(after[door]?.[m.felt]).toBe(true);
      expect(after[door]?.[m.fact]).toBe(false);
      expect(after[door]?.[m.demoted]).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// reads only
// ---------------------------------------------------------------------------

function snapshot(at: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (p: string): void => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      // Bar what holds no data: the `-shm`, SQLite's shared index, which the last
      // connection's close rewrites, and an EMPTY `-wal`, which some builds delete
      // at that close and any open makes again (since `Db.close()` really closes,
      // 2026-10-11). A `-wal` with pages is hashed.
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith("-shm") || (entry.name.endsWith("-wal") && statSync(full).size === 0)) continue;
      else if (entry.isFile()) out.set(relative(at, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(at);
  return out;
}

describe("the helper writes nothing", () => {
  test("from an observer — the dashboard's stance — the store is byte-identical, door closed and open", () => {
    let live = brain();
    const m = scene(live);
    const day = live.store.livedDay();
    for (const door of ["off", "on"]) {
      live.store.setMeta(REFLECTED_FEELING_KEY, door);
      live.close();
      open.splice(0);
      const before = snapshot(dir);
      const o = Counterpart.open({ dir, observer: true });
      try {
        // The dashboard's type: a read-only store is enough.
        const ro: ReadOnlyStore = o.store;
        for (const id of [m.felt, m.later, m.fact, m.demoted]) {
          const row = ro.row(id);
          if (row === undefined) throw new Error(`no row ${id}`);
          const ctx = coreContextFor(ro, row, day);
          expect(ctx.acceptsReflectedFeeling).toBe(door === "on");
        }
      } finally {
        o.close();
      }
      expect(snapshot(dir)).toEqual(before);
      live = brain();
    }
  });

  test("from a live store: no row, event or meta changes", () => {
    const c = brain();
    const m = scene(c);
    const day = c.store.livedDay();
    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    const count = () => ({
      rows: c.store.list({}).length,
      events: c.store.eventLog({ limit: 1_000_000 }).length,
      core: c.store.coreEvents({}).length,
      door: c.store.getMeta(REFLECTED_FEELING_KEY),
    });
    const before = count();
    for (const id of [m.felt, m.later, m.fact, m.demoted]) coreContextFor(c.store, c.store.row(id) as NonNullable<ReturnType<Store["row"]>>, day);
    expect(count()).toEqual(before);
  });
});
