/**
 * A card named in a saved memory's text counts as used (schemas NOTES §15).
 *
 * The title path only credits a card when a memory is TITLED with its name. A
 * person talked about every day in memories titled otherwise would fade once the
 * floors passed; now any saved memory that names a live card, in its title or
 * body, refreshes it, and one naming a faded card brings it back as the title
 * path does. Nothing that never had a card is born, and an ambiguous handle
 * credits no one.
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { Schemas, TUNABLES } from "../src/core/schemas/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import type { FadeFn } from "../src/core/sleep/index.js";
import type { BirthKind } from "../src/core/schemas/index.js";
import type { InterpretFn, SweepChunk } from "../src/core/remember/index.js";
import type { Kind } from "../src/core/types.js";

const BORN_ON = "2026-01-01";
const NOW = Date.parse(`${BORN_ON}T12:00:00Z`);

let dir: string;
let offsetMs = 0;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-entity-named-"));
  offsetMs = 0;
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

function pastAll(kind: Kind): { day: number; date: string } {
  return { day: livedFloor(kind), date: addDays(BORN_ON, calendarFloor(kind)) };
}

/** Long enough that a person nobody names would fade inside it. */
function longRun(): number {
  return Math.max(livedFloor("person"), calendarFloor("person")) + 35;
}

function mention(s: Schemas, name: string, kind: BirthKind, day = 0, aliases?: string[]): string {
  const source = aliases === undefined ? `${name} came up` : `${name} came up, also ${aliases.join(", ")}`;
  const out = s.mention({
    name,
    kind,
    source,
    chunkRef: `c-${name}-${day}`,
    day,
    ...(aliases === undefined ? {} : { aliases }),
  });
  expect(out.ok).toBe(true);
  return out.id as string;
}

/** A card row written directly, the way a second process or an old store could leave one. */
function seedCard(st: Store, name: string, kind: Kind, aliases: string[] = []): string {
  return st.put({
    type: "schema",
    kind,
    title: name,
    body: `# ${name}`,
    meta: { role: "entity", name, aliases },
    physics: { birthDay: 0, lastUsedDay: 0 },
  });
}

function fadeFn(s: Schemas): FadeFn {
  return (f) => s.fadeSweep(f.day, { date: f.date, dryRun: !f.apply, limit: f.budget });
}

function setClock(s: Store, day: number, date: string): void {
  s.setMeta("livedDay", String(day));
  s.setMeta("lastActiveDate", date);
}

// ---------------------------------------------------------------------------

describe("a person named in memory bodies keeps their card", () => {
  test("named in a body most lived days, for longer than any floor: never fades", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const ada = mention(s, "Ada Lovelace", "person", 0, ["Ada"]);
    // The control: born the same day, never named again.
    const quiet = mention(s, "Grace Hopper", "person");
    setClock(st, 0, BORN_ON);

    const days = longRun();
    let quietFadedOn: number | null = null;
    for (let d = 1; d <= days; d++) {
      const cycle = runCycle({ store: st, date: addDays(BORN_ON, d), fade: fadeFn(s) });
      expect(cycle.day).toBe(d);
      if (quietFadedOn === null && cycle.faded.includes(quiet)) quietFadedOn = d;
      expect(cycle.faded).not.toContain(ada);
      // Six days in seven, and never in a title.
      if (d % 7 === 0) continue;
      s.creditNamedIn({ text: `Walked the dog with Ada this morning (day ${d}).`, day: d, ref: `mem-${d}` });
    }

    expect(s.entity(ada)?.archived).toBe(false);
    expect(st.physicsOf(ada).lastUsedDay).toBeGreaterThan(days - 7);
    // The harness does fade: the person nobody named is gone.
    expect(quietFadedOn).not.toBeNull();
    expect(s.entity(quiet)?.archived).toBe(true);
  });

  test("once per card per memory, and physics' once-per-lived-day rule holds", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const ada = mention(s, "Ada Lovelace", "person", 0, ["Ada"]);
    // Counted in OCCASIONS (`reinforcedDays`): since the spacing rule (physics,
    // 2026-09-25) `uses` grows by the tier weight x a spacing factor, not by 1.
    const before = st.physicsOf(ada).reinforcedDays ?? 0;

    // Name and alias both in one text: one credit.
    const first = s.creditNamedIn({ text: "Ada Lovelace called; Ada sounded well.", day: 3, ref: "m1" });
    expect(first.credited).toEqual([ada]);
    expect(st.physicsOf(ada).reinforcedDays).toBe(before + 1);
    expect(st.physicsOf(ada).lastUsedDay).toBe(3);

    // A second memory the same lived day: named, not credited again.
    const again = s.creditNamedIn({ text: "Ada again, later that day.", day: 3, ref: "m2" });
    expect(again.credited).toEqual([]);
    expect(again.refused).toEqual([ada]);
    expect(st.physicsOf(ada).reinforcedDays).toBe(before + 1);

    // The birth day is not a use either.
    const born = mention(s, "Babbage", "person", 5);
    expect(s.creditNamedIn({ text: "Babbage was there too", day: 5, ref: "m3" }).refused).toEqual([born]);
  });

  test("`except` leaves out the card the title path already handled", () => {
    const s = Schemas.open({ store: store() });
    const ada = mention(s, "Ada", "person");
    const out = s.creditNamedIn({ text: "Ada, again", day: 2, ref: "m1", except: [ada] });
    expect(out.credited).toEqual([]);
    expect(out.refused).toEqual([]);
  });
});

describe("what a body mention does not do", () => {
  test("it never births a card", () => {
    const s = Schemas.open({ store: store() });
    mention(s, "Ada", "person");
    s.creditNamedIn({ text: "Ada introduced me to Zelda Fitzgerald.", day: 2, ref: "m1" });
    expect(s.entities().map((e) => e.name)).toEqual(["Ada"]);
    expect(s.events("schema.birth")).toHaveLength(1);
  });

  test("an ambiguous handle credits neither card; an unambiguous name still credits its own", () => {
    const st = store();
    const chen = seedCard(st, "Mac Chen", "person", ["Mac"]);
    const park = seedCard(st, "Mac Park", "person", ["Mac"]);
    const s = Schemas.open({ store: st });
    expect(s.aliasIndex().lookup("Mac")).toEqual([chen, park].sort());

    const out = s.creditNamedIn({ text: "Mac dropped by with coffee.", day: 2, ref: "m1" });
    expect(out.credited).toEqual([]);
    expect(out.ambiguous).toBe(1);
    expect(st.physicsOf(chen).lastUsedDay).toBe(0);
    expect(st.physicsOf(park).lastUsedDay).toBe(0);

    const named = s.creditNamedIn({ text: "Mac Chen dropped by; Mac brought coffee.", day: 3, ref: "m2" });
    expect(named.credited).toEqual([chen]);
    expect(st.physicsOf(park).lastUsedDay).toBe(0);
  });

  test("a substring is not a mention: Mikey is not Mike", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const mike = mention(s, "Mike", "person");
    const out = s.creditNamedIn({ text: "Mikey called about the Mike-shaped hole in the fence.", day: 2, ref: "m1" });
    expect(out.credited).toEqual([]);
    expect(out.refused).toEqual([]);
    expect(st.physicsOf(mike).lastUsedDay).toBe(0);
  });

  test("a pruned card is not brought back", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const id = mention(s, "Ephemeral", "entity");
    st.archive(id, "pruned");

    // Seen by the long-lived index at its first lookup, and by a fresh open.
    for (const reader of [s, Schemas.open({ store: st })]) {
      const out = reader.creditNamedIn({ text: "Ephemeral came up again today.", day: 5, ref: "m1" });
      expect(out.revived).toEqual([]);
      expect(out.credited).toEqual([]);
      expect(reader.entities()).toHaveLength(0);
    }
    expect(s.events("schema.birth")).toHaveLength(1);
  });

  test("a faded card the owner removed is not brought back", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const id = mention(s, "Ephemeral", "entity");
    const at = pastAll("entity");
    expect(s.fadeSweep(at.day, { date: at.date }).faded).toEqual([id]);
    st.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });

    for (const reader of [s, Schemas.open({ store: st })]) {
      const out = reader.creditNamedIn({ text: "Ephemeral came up again today.", day: at.day + 1, ref: "m1" });
      expect(out.revived).toEqual([]);
      expect(reader.entities()).toHaveLength(0);
    }
    expect(s.events("schema.birth")).toHaveLength(1);
  });

  test("the identity core is left alone, as the title path leaves it", () => {
    const st = store();
    const core = seedCard(st, "Counterpart", "self");
    const s = Schemas.open({ store: st });
    const out = s.creditNamedIn({ text: "Counterpart kept its notes tidy today.", day: 2, ref: "m1" });
    expect(out.credited).toEqual([]);
    expect(out.refused).toEqual([]);
    expect(st.physicsOf(core).lastUsedDay).toBe(0);
  });

  test("events carry ids, never names", () => {
    const s = Schemas.open({ store: store() });
    mention(s, "Ada", "person");
    s.creditNamedIn({ text: "Ada said hi", day: 2, ref: "m1" });
    const events = s.events("schema.mention.named");
    expect(events).toHaveLength(1);
    expect(events[0]?.data?.["credited"]).toBe(true);
    expect(JSON.stringify(events)).not.toContain("Ada");
  });
});

describe("a faded card named in a saved memory comes back", () => {
  /** A person born on day 0 and faded by the gentle-fade sweep. */
  function fadedPerson(s: Schemas, name: string, aliases?: string[]): { id: string; day: number } {
    const id = mention(s, name, "person", 0, aliases);
    const at = pastAll("person");
    expect(s.fadeSweep(at.day, { date: at.date }).faded).toEqual([id]);
    return { id, day: at.day + 1 };
  }

  test("named only in a body: one live card, carrying the old name and aliases, surfacing again", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const old = fadedPerson(s, "Ada Lovelace", ["Ada"]);

    const out = s.creditNamedIn({ text: "Ada called about the garden.", day: old.day, ref: "m1" });
    expect(out.revived).toHaveLength(1);
    expect(out.credited).toEqual([]);
    const back = out.revived[0] as string;
    expect(back).not.toBe(old.id);
    expect(s.entities().map((e) => e.id)).toEqual([back]);
    expect(s.entity(back)?.name).toBe("Ada Lovelace");
    expect(s.entity(back)?.aliases).toEqual(["Ada"]);
    expect(s.aliasIndex().lookup("Ada")).toEqual([back]);
    expect(s.slices().map((sl) => sl.name)).toEqual(["Ada Lovelace"]);
    // The same return a title mention gives: a fresh birth, the churn counted.
    expect(s.entity(old.id)?.archived).toBe(true);
    const after = s.events("schema.birth.after-fade");
    expect(after).toHaveLength(1);
    expect(after[0]?.data?.["priorId"]).toBe(old.id);
    expect(s.events("schema.mention.revived")[0]?.data?.["priorId"]).toBe(old.id);
    expect(JSON.stringify([...after, ...s.events("schema.mention.revived")])).not.toContain("Ada");
  });

  test("faded by another process's cycle: the long-lived index brings it back too", () => {
    const st = store();
    const longLived = Schemas.open({ store: st });
    const id = mention(longLived, "Ephemeral", "entity");
    const worker = Schemas.open({ store: st });
    const at = pastAll("entity");
    expect(worker.fadeSweep(at.day, { date: at.date }).faded).toEqual([id]);

    const out = longLived.creditNamedIn({ text: "Ephemeral came up again.", day: at.day + 1, ref: "m1" });
    expect(out.revived).toHaveLength(1);
    expect(out.credited).toEqual([]);
    // The archived row was not credited; the new card is the live one.
    expect(st.physicsOf(id).lastUsedDay).toBe(0);
    expect(longLived.entities().map((e) => e.id)).toEqual(out.revived);
  });

  test("two memories naming it in one lived day: one card, and later bodies credit it", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const old = fadedPerson(s, "Ada Lovelace", ["Ada"]);

    const first = s.creditNamedIn({ text: "Ada Lovelace came by; Ada brought tea.", day: old.day, ref: "m1" });
    expect(first.revived).toHaveLength(1);
    const back = first.revived[0] as string;
    const second = s.creditNamedIn({ text: "Ada again, later that day.", day: old.day, ref: "m2" });
    expect(second.revived).toEqual([]);
    expect(second.refused).toEqual([back]);
    // A fresh open agrees: the old card is the new one's past, not a rival.
    const reopened = Schemas.open({ store: st });
    const third = reopened.creditNamedIn({ text: "Ada, once more.", day: old.day, ref: "m3" });
    expect(third.revived).toEqual([]);
    expect(third.ambiguous).toBe(0);
    expect(reopened.entities().map((e) => e.id)).toEqual([back]);

    const nextDay = s.creditNamedIn({ text: "Ada said hi.", day: old.day + 1, ref: "m4" });
    expect(nextDay.credited).toEqual([back]);
    expect(nextDay.ambiguous).toBe(0);
    expect(s.events("schema.birth")).toHaveLength(2);
  });

  test("faded twice: the next body mention still brings back one card", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const first = fadedPerson(s, "Ada", undefined);
    const back = s.creditNamedIn({ text: "Ada came by.", day: first.day, ref: "m1" }).revived[0] as string;
    const at = pastAll("person");
    const again = { day: first.day + livedFloor("person"), date: addDays(at.date, 1 + calendarFloor("person")) };
    expect(s.fadeSweep(again.day, { date: again.date }).faded).toEqual([back]);

    const out = s.creditNamedIn({ text: "Ada came by again.", day: again.day + 1, ref: "m2" });
    expect(out.revived).toHaveLength(1);
    expect(out.ambiguous).toBe(0);
    expect(s.entities()).toHaveLength(1);
  });

  test("a handle held by a live card and a faded one: neither is credited or brought back", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const park = fadedPerson(s, "Robert Park", ["Bobby"]);
    const chen = mention(s, "Bobby Chen", "person", park.day, ["Bobby"]);
    expect(s.aliasIndex().lookup("Bobby")).toEqual([chen]);

    const out = s.creditNamedIn({ text: "Bobby dropped by with coffee.", day: park.day + 1, ref: "m1" });
    expect(out.ambiguous).toBe(1);
    expect(out.credited).toEqual([]);
    expect(out.revived).toEqual([]);
    expect(s.entities().map((e) => e.id)).toEqual([chen]);

    // By full name, each is unambiguous: Chen is credited, Park comes back.
    const named = s.creditNamedIn({ text: "Bobby Chen and Robert Park both came.", day: park.day + 2, ref: "m2" });
    expect(named.credited).toEqual([chen]);
    expect(named.revived).toHaveLength(1);
    expect(s.entities()).toHaveLength(2);
  });

  test("a return the title path would refuse is refused here too", () => {
    const st = store();
    const s = Schemas.open({ store: st });
    const park = fadedPerson(s, "Mac Park", undefined);
    mention(s, "Mac", "person", park.day);
    // "Mac Park" near-collides with the live "Mac", as a titled memory would.
    const out = s.creditNamedIn({ text: "Mac Park came by.", day: park.day + 1, ref: "m1" });
    expect(out.revived).toEqual([]);
    expect(s.entities()).toHaveLength(1);
    expect(s.events("schema.mention.revived")[0]?.data?.["reason"]).toBe("collision-near");
  });

  test("a name that never had a card is still not born", () => {
    const s = Schemas.open({ store: store() });
    const old = fadedPerson(s, "Ada", undefined);
    const out = s.creditNamedIn({ text: "Zelda Fitzgerald called.", day: old.day, ref: "m1" });
    expect(out.revived).toEqual([]);
    expect(s.entities()).toHaveLength(0);
  });
});

describe("a faded birth is labelled only after a fade", () => {
  test("a name whose earlier card was archived for another reason is not `after-fade`", () => {
    const st = store();
    const s0 = Schemas.open({ store: st });
    const old = mention(s0, "Ephemeral", "entity");
    st.archive(old, "pruned");
    const s = Schemas.open({ store: st });
    const again = s.mention({ name: "Ephemeral", kind: "entity", source: "Ephemeral", chunkRef: "c2", day: 3 });
    expect(again.born).toBe(true);
    expect(s.events("schema.birth.after-fade")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Through the composition root: every door that mints
// ---------------------------------------------------------------------------

const TURNS = [
  { role: "user" as const, text: "Spent the afternoon with Ada planning the community garden layout, bed by bed, with the old plot map spread out on the table." },
  { role: "assistant" as const, text: "Noted. The raised beds go along the south fence where the light is best, and the compost stays by the shed where the hose reaches." },
  { role: "user" as const, text: "Right, and Ada wants the tomatoes kept away from the potatoes this year, because the blight took both of them last summer." },
];

function root(opts: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
  const c = Counterpart.open({ dir, owner: true, now: () => NOW, ...opts });
  opened.push(c);
  return c;
}

/** A person card born on day 0, with the clock moved on so a use can land. */
function withAda(c: Counterpart): string {
  const id = mention(c.schemas, "Ada", "person");
  setClock(c.store, 4, addDays(BORN_ON, 4));
  return id;
}

describe("every door that mints credits the cards it names", () => {
  test("a note (jot) naming a person in its body refreshes the card", async () => {
    const c = root();
    const ada = withAda(c);
    const out = await c.submitJot(
      { content: "Ada lent me her pruning shears; return them before the weekend.", kind: "fact", title: "Shears" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    expect(c.store.physicsOf(ada).lastUsedDay).toBe(4);
    const e = c.events("counterpart.mention.named");
    expect(e).toHaveLength(1);
    expect(e[0]?.ref).toBe(out.memoryId as string);
    expect(e[0]?.data?.["credited"]).toBe(1);
    expect(e[0]?.data?.["door"]).toBe("jot");
  });

  test("a session-end dump titled with the name is credited once, by the title path", async () => {
    const c = root();
    const ada = withAda(c);
    const days = c.store.physicsOf(ada).reinforcedDays ?? 0;
    const out = await c.submitSessionEnd(
      { content: "Ada is running the garden committee this spring.", kind: "person", title: "Ada" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    expect(c.events("counterpart.mention")[0]?.data?.["reason"]).toBe("existing");
    expect(c.events("counterpart.mention.named")).toHaveLength(0);
    expect(c.store.physicsOf(ada).reinforcedDays).toBe(days + 1);
  });

  test("a crash-fallback sweep naming the person refreshes the card", async () => {
    const c = root({ now: () => Date.now() + offsetMs });
    const ada = withAda(c);
    c.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    c.boundary({ session: "s1", scope: "proj", kind: "pre-compaction" });
    offsetMs += 24 * 60 * 60 * 1000;
    const interpret: InterpretFn = async (_chunk: SweepChunk) => ({
      proposals: [{ content: "Ada and I planned the community garden layout along the south fence.", kind: "fact" }],
      stopReason: "end_turn",
    });
    await c.sweepFallback({ interpret });
    expect(c.events("counterpart.sweep.minted")).toHaveLength(1);
    expect(c.events("counterpart.mention.named")[0]?.data?.["door"]).toBe("sweep");
    expect(c.store.physicsOf(ada).lastUsedDay).toBe(4);
  });

  test("an ingested episode naming the person refreshes the card", () => {
    const c = root();
    const ada = withAda(c);
    c.appendEpisode("s1", "Ada and I finally agreed on where the beds go, and it felt settled.");
    const out = c.ingestEpisode({ sessionId: "s1" });
    expect(out.ingested).toBe(true);
    expect(c.events("counterpart.mention.named")[0]?.data?.["door"]).toBe("episode");
    expect(c.store.physicsOf(ada).lastUsedDay).toBe(4);
  });

  test("a note naming a faded person brings them back, and says so", async () => {
    const c = root();
    const ada = mention(c.schemas, "Ada", "person");
    const at = pastAll("person");
    expect(c.schemas.fadeSweep(at.day, { date: at.date }).faded).toEqual([ada]);
    setClock(c.store, at.day + 1, addDays(at.date, 1));
    const out = await c.submitJot(
      { content: "Ada lent me her pruning shears; return them before the weekend.", kind: "fact", title: "Shears" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    const live = c.schemas.entities();
    expect(live).toHaveLength(1);
    expect(live[0]?.id).not.toBe(ada);
    expect(c.events("counterpart.mention.named")[0]?.data?.["revived"]).toBe(1);
  });

  test("an observer mints nothing and credits nothing", async () => {
    const seed = root();
    const ada = withAda(seed);
    seed.close();
    opened.splice(opened.indexOf(seed), 1);

    const probe = root({ observer: true });
    const out = await probe.submitJot(
      { content: "Ada lent me her pruning shears; return them before the weekend.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(false);
    expect(probe.events("counterpart.mention.named")).toHaveLength(0);
    expect(probe.store.physicsOf(ada).lastUsedDay).toBe(0);
    expect(probe.store.physicsOf(ada).uses).toBe(0);
  });

  test("an observer brings nothing back", async () => {
    const seed = root();
    const ada = mention(seed.schemas, "Ada", "person");
    const at = pastAll("person");
    expect(seed.schemas.fadeSweep(at.day, { date: at.date }).faded).toEqual([ada]);
    setClock(seed.store, at.day + 1, addDays(at.date, 1));
    seed.close();
    opened.splice(opened.indexOf(seed), 1);

    const probe = root({ observer: true });
    await probe.submitJot(
      { content: "Ada lent me her pruning shears; return them before the weekend.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(probe.events("counterpart.mention.named")).toHaveLength(0);
    expect(probe.schemas.entities()).toHaveLength(0);
    expect(probe.store.list({ type: "schema" })).toEqual([ada]);
  });

  test("daily notes through the composition root, a full boundary per lived day: the person stays", async () => {
    const c = root();
    const ada = mention(c.schemas, "Ada", "person");
    const quiet = mention(c.schemas, "Grace", "person");
    setClock(c.store, 0, BORN_ON);

    const days = longRun();
    for (let d = 1; d <= days; d++) {
      const report = await c.sessionEnd({ date: addDays(BORN_ON, d) });
      expect(report.cycle.day).toBe(d);
      expect(report.cycle.faded).not.toContain(ada);
      const out = await c.submitJot(
        { content: `Day ${d}: Ada and I weeded bed number ${d} and talked about the harvest.`, kind: "fact" },
        { session: `s${d}`, scope: "proj" },
      );
      expect(out.deposited).toBe(true);
    }
    expect(c.schemas.entity(ada)?.archived).toBe(false);
    expect(c.store.physicsOf(ada).lastUsedDay).toBe(days);
    expect(c.schemas.entity(quiet)?.archived).toBe(true);
  }, 120_000);
});
