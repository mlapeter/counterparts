/**
 * Entity cards fade GENTLY, and the sleep cycle is what fades them.
 *
 * A card (person, project, place…) nobody mentions for long enough is ARCHIVED —
 * a state, not a deletion. It fades only when physics says its row is prunable
 * AND a calendar floor has passed since it was last used; people get a longer
 * calendar floor and a longer lived dwell. Every threshold here is read from the
 * tunables, never restated, so retuning a default does not break a test.
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that path.
 * The store's provenance clock is pinned, so "today" is a fixed date.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { Schemas, TUNABLES } from "../src/core/schemas/index.js";
import {
  PHASES,
  TUNABLES as SLEEP,
  markerKey,
  phaseReport,
  runCycle,
  runPrune,
} from "../src/core/sleep/index.js";
import type { FadeFn, PhaseCtx } from "../src/core/sleep/index.js";
import type { BirthKind } from "../src/core/schemas/index.js";
import type { Kind } from "../src/core/types.js";

const BORN_ON = "2026-01-01";
const NOW = Date.parse(`${BORN_ON}T12:00:00Z`);

let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-entity-fade-"));
});

afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(opts: { observer?: boolean } = {}): Store {
  const s = Store.open({ dir, now: () => NOW, ...opts });
  opened.push(s);
  return s;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function calendarFloor(kind: Kind): number {
  return TUNABLES.FADE.CALENDAR_FLOOR_DAYS_BY_KIND[kind] ?? TUNABLES.FADE.CALENDAR_FLOOR_DAYS;
}

function livedFloor(kind: Kind): number {
  return Math.ceil(PHYSICS.D_FLOOR_DAYS * (TUNABLES.FADE.LIVED_DWELL_FACTOR_BY_KIND[kind] ?? 1));
}

/** Past every floor this kind has, lived and calendar. */
function pastAll(kind: Kind): { day: number; date: string } {
  return { day: livedFloor(kind), date: addDays(BORN_ON, calendarFloor(kind)) };
}

function mention(s: Schemas, name: string, kind: BirthKind, day = 0): string {
  const out = s.mention({ name, kind, source: `${name} came up`, chunkRef: `c-${name}-${day}`, day });
  expect(out.ok).toBe(true);
  return out.id as string;
}

/** Sleep's fade seam wired to a Schemas, exactly as the composition root wires it. */
function fadeFn(s: Schemas): FadeFn {
  return (f) => s.fadeSweep(f.day, { date: f.date, dryRun: !f.apply, limit: f.budget });
}

/** Puts the lived clock at `day` on `date`, so the next cycle's date advances it by one. */
function setClock(s: Store, day: number, date: string): void {
  s.setMeta("livedDay", String(day));
  s.setMeta("lastActiveDate", date);
}

// ---------------------------------------------------------------------------

describe("the fade verdict is gentle", () => {
  test("enough lived days but under the calendar floor: not faded, and it says why", () => {
    const s = Schemas.open({ store: store() });
    const id = mention(s, "Ephemeral", "entity");
    const lived = livedFloor("entity");
    // Lived quiet is enough for physics; the calendar has not caught up.
    const v = s.fadeVerdict(id, lived, addDays(BORN_ON, calendarFloor("entity") - 1));
    expect(v.fade).toBe(false);
    expect(v.blockedBy).toEqual(["calendar-floor-not-passed"]);
    expect(v.calendarSource).toBe("birth-date");
    expect(v.calendarDays).toBe(calendarFloor("entity") - 1);
    expect(s.fadeSweep(lived, { date: addDays(BORN_ON, calendarFloor("entity") - 1) }).faded).toEqual([]);
    expect(s.entity(id)?.archived).toBe(false);
  });

  test("past both floors: archived with its reason, not deleted", () => {
    const s = Schemas.open({ store: store() });
    const id = mention(s, "Ephemeral", "entity");
    const at = pastAll("entity");
    const report = s.fadeSweep(at.day, { date: at.date });
    expect(report.faded).toEqual([id]);
    expect(s.entity(id)?.archived).toBe(true);
    expect(s.entity(id)?.archivedReason).toBe(TUNABLES.FADE_REASON);
    expect(s.store.resolve(id)).toBe(id);
    expect(s.entities()).toHaveLength(0);
    expect(s.entities({ includeArchived: true }).map((e) => e.id)).toEqual([id]);
  });

  test("the calendar side never runs ahead of the lived side: lived days are a floor on it", () => {
    const s = Schemas.open({ store: store() });
    const id = mention(s, "Ephemeral", "entity");
    // A date that went BACKWARDS still counts at least the lived gap.
    const v = s.fadeVerdict(id, 10, BORN_ON);
    expect(v.calendarDays).toBe(10);
    expect(v.calendarSource).toBe("lived-days");
  });

  test("a person past the general floors but under the person floors does not fade", () => {
    const s = Schemas.open({ store: store() });
    const person = mention(s, "Ada", "person");
    const thing = mention(s, "Widget", "entity");
    const general = pastAll("entity");

    const vThing = s.fadeVerdict(thing, general.day, general.date);
    expect(vThing.fade).toBe(true);

    const vPerson = s.fadeVerdict(person, general.day, general.date);
    expect(vPerson.fade).toBe(false);
    if (calendarFloor("person") > calendarFloor("entity")) {
      expect(vPerson.blockedBy).toContain("calendar-floor-not-passed");
    }
    if (livedFloor("person") > livedFloor("entity")) {
      expect(vPerson.blockedBy).toContain("kind-dwell-too-short");
    }
    expect(s.fadeSweep(general.day, { date: general.date }).faded).toEqual([thing]);

    // Past the person's own floors, a person fades like anything else.
    const at = pastAll("person");
    expect(s.fadeSweep(at.day, { date: at.date }).faded).toEqual([person]);
  });

  test("a person with the calendar floor passed still needs the longer lived dwell", () => {
    const s = Schemas.open({ store: store() });
    const person = mention(s, "Ada", "person");
    const v = s.fadeVerdict(person, PHYSICS.D_FLOOR_DAYS, addDays(BORN_ON, calendarFloor("person")));
    if (livedFloor("person") > PHYSICS.D_FLOOR_DAYS) {
      expect(v.blockedBy).toEqual(["kind-dwell-too-short"]);
    } else {
      expect(v.fade).toBe(true);
    }
  });

  test("an entity with live beliefs attached does not fade, however long the quiet", () => {
    const s = Schemas.open({ store: store() });
    const id = mention(s, "Ephemeral", "entity");
    s.addBelief({ entityId: id, statement: "it ships on Fridays", day: 0 });
    const at = pastAll("person"); // longer than any floor
    const v = s.fadeVerdict(id, at.day, at.date);
    expect(v.fade).toBe(false);
    expect(v.blockedBy).toContain("has-live-attached-elements");
    expect(s.fadeSweep(at.day, { date: at.date }).faded).toEqual([]);
  });

  test("a card used again after the sweep anchored it: the stale anchor is ignored, the clock restarts", () => {
    const s = Schemas.open({ store: store() });
    const id = mention(s, "Counterparts", "entity");
    // First sweep anchors the card at day 0 on BORN_ON.
    expect(s.fadeSweep(0, { date: BORN_ON }).anchored).toBe(1);
    // Used again on lived day 5 — the anchor is now older than the last use.
    mention(s, "Counterparts", "entity", 5);
    const later = addDays(BORN_ON, calendarFloor("entity") + 30);
    const v = s.fadeVerdict(id, 5 + livedFloor("entity"), later);
    // Only the lived gap can be trusted now, and it is under the calendar floor.
    expect(v.calendarSource).toBe("lived-days");
    expect(v.calendarDays).toBe(livedFloor("entity"));
    // The next sweep re-anchors it.
    expect(s.fadeSweep(6, { date: addDays(BORN_ON, 6) }).anchored).toBe(1);
  });
});

describe("a faded card comes back when it is mentioned again", () => {
  test("re-mention after a fade: it surfaces again, as one live card", () => {
    const s = Schemas.open({ store: store() });
    const id = mention(s, "Ephemeral", "entity");
    const at = pastAll("entity");
    s.fadeSweep(at.day, { date: at.date });

    const again = s.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral is back",
      chunkRef: "c-back",
      day: at.day + 1,
    });
    expect(again.ok).toBe(true);
    expect(again.born).toBe(true);
    const live = s.entities();
    expect(live.map((e) => e.id)).toEqual([again.id as string]);
    expect(s.aliasIndex().lookup("Ephemeral")).toEqual([again.id as string]);
    expect(s.slices().map((sl) => sl.name)).toEqual(["Ephemeral"]);
    // The old card is kept, archived, and the churn is counted.
    expect(s.entity(id)?.archived).toBe(true);
    expect(s.events("schema.birth.after-fade")).toHaveLength(1);
  });

  test("faded by ANOTHER process's cycle: a long-lived index does not reinforce the archived card", () => {
    const st = store();
    const longLived = Schemas.open({ store: st });
    const id = mention(longLived, "Ephemeral", "entity");

    // The detached worker's own Schemas fades the card; the long-lived one
    // (an MCP server, say) never hears about it.
    const worker = Schemas.open({ store: st });
    const at = pastAll("entity");
    expect(worker.fadeSweep(at.day, { date: at.date }).faded).toEqual([id]);

    const again = longLived.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral is back",
      chunkRef: "c-back",
      day: at.day + 1,
    });
    expect(again.reason).toBe("born");
    expect(again.id).not.toBe(id);
    expect(longLived.entities().map((e) => e.id)).toEqual([again.id as string]);
    // The archived row was not credited with the mention.
    expect(st.physicsOf(id).lastUsedDay).toBe(0);
  });
});

describe("the sleep cycle runs the fade", () => {
  test("the floor prune no longer takes entity cards, and still takes their weak beliefs", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const id = mention(s, "Ada", "person");
    const belief = s.addBelief({ entityId: id, statement: "likes tea", day: 0 }).id as string;
    const ctx: PhaseCtx = {
      store: st,
      day: PHYSICS.D_FLOOR_DAYS + 1,
      apply: true,
      budget: SLEEP.BUDGETS.prune,
      step: () => {},
      event: () => {},
    };
    const r = runPrune(ctx);
    expect(r.pruned.map((p) => p.id)).toEqual([belief]);
    expect(r.skipped["entity-card"]).toBe(1);
    expect(st.row(id)?.archived).toBe(0);
  });

  test("the cycle sweeps at its cadence and reports the count", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const id = mention(s, "Ephemeral", "entity");
    const at = pastAll("entity");
    setClock(st, at.day - 1, addDays(at.date, -1));

    const first = runCycle({ store: st, date: at.date, fade: fadeFn(s) });
    expect(first.day).toBe(at.day);
    const fade = phaseReport(first, "fade");
    expect(fade.status).toBe("ran");
    expect(fade.changed).toBe(1);
    expect(first.faded).toEqual([id]);
    expect(first.census.entity.exited).toBe(1);
    expect(st.row(id)?.archived_reason).toBe(TUNABLES.FADE_REASON);
    expect(first.events.some((e) => e.name === "sleep.fade.sweep")).toBe(true);
    // Ids only in the sleep events — never the name.
    expect(JSON.stringify(first.events)).not.toContain("Ephemeral");

    // The next lived day is inside the cadence (when the cadence is longer than one).
    const next = runCycle({ store: st, date: addDays(at.date, 1), fade: fadeFn(s) });
    const expected = SLEEP.CADENCE.fade > 1 ? "not-due-this-cadence" : "nothing-to-do";
    expect(phaseReport(next, "fade").reason).toBe(expected);

    // …and it is due again once the cadence has passed (one lived day per cycle).
    let due = next;
    for (let k = 2; k <= SLEEP.CADENCE.fade; k++) {
      due = runCycle({ store: st, date: addDays(at.date, k), fade: fadeFn(s) });
    }
    expect(due.day - first.day).toBe(SLEEP.CADENCE.fade);
    expect(phaseReport(due, "fade").status).toBe("ran-nothing-found");
    expect(Number(st.getMeta(markerKey("fade")))).toBe(due.day);
  });

  test("with no fade fn, the phase says so and nothing is archived", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const id = mention(s, "Ephemeral", "entity");
    const at = pastAll("person");
    setClock(st, at.day - 1, addDays(at.date, -1));
    const r = runCycle({ store: st, date: at.date });
    expect(phaseReport(r, "fade").reason).toBe("no-fade-fn");
    expect(st.row(id)?.archived).toBe(0);
  });

  test("an observer's cycle reports what would fade and writes nothing", () => {
    const seed = store();
    const s0 = Schemas.open({ store: seed });
    const id = mention(s0, "Ephemeral", "entity");
    const at = pastAll("entity");
    setClock(seed, at.day, at.date);
    seed.close();
    opened.splice(opened.indexOf(seed), 1);

    const obs = store({ observer: true });
    const s = Schemas.open({ store: obs });
    const r = runCycle({ store: obs, date: at.date, fade: fadeFn(s) });
    const fade = phaseReport(r, "fade");
    expect(fade.status).toBe("did-not-run");
    expect(fade.reason).toBe("observer-report");
    expect(fade.changed).toBe(1);
    expect(r.faded).toEqual([id]);
    expect(obs.events("store.observer.standdown")).toHaveLength(0);
    expect(obs.row(id)?.archived).toBe(0);
    expect(obs.getMeta(`${TUNABLES.FADE_ANCHOR_PREFIX}${id}`)).toBeUndefined();
    expect(obs.getMeta(markerKey("fade"))).toBeUndefined();
  });

  test("the composition root wires it: a boundary fades a card and the durable row counts it", async () => {
    const c = Counterpart.open({ dir, owner: true, now: () => NOW });
    opened.push(c);
    const id = mention(c.schemas, "Ephemeral", "entity");
    const at = pastAll("entity");
    setClock(c.store, at.day - 1, addDays(at.date, -1));

    const report = await c.sessionEnd({ date: at.date });
    expect(report.cycle.order).toEqual([...PHASES]);
    expect(phaseReport(report.cycle, "fade").reason).not.toBe("no-fade-fn");
    expect(report.cycle.faded).toEqual([id]);
    expect(c.schemas.entity(id)?.archived).toBe(true);
    const row = c.store.eventLog({ name: "sleep.cycle", limit: 1 })[0];
    expect(JSON.parse(row?.payload ?? "{}")["faded"]).toBe(1);
  });
});
