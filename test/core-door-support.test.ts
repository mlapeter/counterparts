/**
 * THE CORE DOOR IS ONE SUPPORT ARC (2026-10-24, E2; physics §5.3,
 * `physics.CORE_DOOR_SUPPORT`).
 *
 *   - a memory about me or us crosses when its core support — the belief's
 *     own arithmetic (`supportCredit`) over its real uses, its slot's
 *     re-encodings and the reflection's citations (found filings) — reaches
 *     `CORE_SUPPORT_LINE` as height x days factor over its lived days;
 *   - a glimpse and a rating of 1 count nothing; a reflection alone gives no
 *     lived day, so it never carries a memory in; a later real use echoes it;
 *   - one crossing, one record, naming every filing behind it;
 *   - the switch off is the two lanes, exactly.
 *
 * Through the real doors: each memory is written by the memory tool (MCP
 * `remember`), used through the credit door the Stop boundary calls
 * (`Counterpart#resolveUse`, a session per use), cited by a reflection
 * (`reflections.begin/finish`), and slept with the sleep cycle. Hermetic:
 * every test opens its own temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS, coreDoorSupport, promotionEligibility } from "../src/core/physics/index.js";
import { coreContextFor, coreSupportOf, promotionRecordKey, runCycle } from "../src/core/sleep/index.js";
import type { PromotionRecord } from "../src/core/sleep/index.js";
import { coreRoad } from "../src/adapters/dashboard/web/views/memory.js";
import type { CoreRoad } from "../src/adapters/dashboard/web/views/memory.js";
// @ts-expect-error — a plain browser module, no declarations
import * as cardWordsJs from "../src/adapters/dashboard/web/shared/memory-card-words.js";

const { coreRoadLine } = cardWordsJs as { coreRoadLine: (p: CoreRoad, promoted: boolean) => string };

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;
let doorWas = PHYSICS.CORE_DOOR_SUPPORT;

function setDoor(on: boolean): void {
  (PHYSICS as { CORE_DOOR_SUPPORT: boolean }).CORE_DOOR_SUPPORT = on;
}

beforeEach(() => {
  dateN = 0;
  doorWas = PHYSICS.CORE_DOOR_SUPPORT;
  setDoor(true);
  dir = mkdtempSync(join(tmpdir(), "counterparts-core-door-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  setDoor(doorWas);
  rmSync(dir, { recursive: true, force: true });
});

function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => Date.UTC(2026, 8, 1) + dateN * 86_400_000 + 3_600_000 });
  open.push(c);
  return c;
}

/** The next lived day, no sleep. */
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(date(dateN));
  return c.store.livedDay();
}

/** A night's sleep, which opens the next lived day (consolidation every lived day). */
function sleepNow(c: Counterpart): ReturnType<typeof runCycle> {
  dateN += 1;
  return runCycle({ store: c.store, date: date(dateN), cadence: { consolidate: 1 } });
}

/** Written by the memory tool, as a session writes it: about me, a `self` memory. */
async function write(c: Counterpart, args: Record<string, unknown>): Promise<string> {
  c.close();
  open.splice(open.indexOf(c), 1);
  recordSession(dir, { sessionId: "s-writer", scope: "/proj", phase: "start" });
  const s = openServer({ dir, session: "s-writer", scope: "/proj" });
  let id: string;
  try {
    const r = await s.call("remember", { kind: "self", about: "me", ...args });
    expect(r.structuredContent["stored"]).toBe(true);
    id = r.structuredContent["id"] as string;
  } finally {
    s.counterpart.close();
  }
  return id;
}

function record(c: Counterpart, id: string): PromotionRecord | undefined {
  const raw = c.store.getMeta(promotionRecordKey(id));
  return raw === undefined ? undefined : (JSON.parse(raw) as PromotionRecord);
}

function verdict(c: Counterpart, id: string) {
  const day = c.store.livedDay();
  return promotionEligibility(c.store.physicsOf(id), coreContextFor(c.store, c.store.row(id)!, day));
}

describe("the support door, through the real doors", () => {
  test("1. used really in 3 sessions over 6 lived days, about me: it crosses at the line, and the record names its filings", async () => {
    let c = brain();
    nextDay(c);
    const id = await write(c, { text: "I check the edges of a plan before I trust its middle." });
    c = brain();
    expect(c.store.row(id)?.about).toBe("me");
    const born = c.store.livedDay();
    // Day 2: the first real use. One unfelt occasion on one lived day is under the line.
    nextDay(c);
    expect(c.resolveUse("s1", id, "referenced").credited).toBe(true);
    const one = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(one).toMatchObject({ support: 1, days: 1 });
    expect(one.level).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(verdict(c, id)).toMatchObject({ eligible: false, reason: "no-lane-yet" });
    // Day 4: a second session on a second lived day — already past the line (0.129), so a
    // night slept here would carry it; the test holds the sleep to see all three.
    nextDay(c);
    nextDay(c);
    expect(c.resolveUse("s2", id, "referenced").credited).toBe(true);
    expect(coreSupportOf(c.store, id, c.store.livedDay(), true).level).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
    // Day 7: the third session, six lived days after it was written.
    for (let n = 0; n < 3; n++) nextDay(c);
    expect(c.store.livedDay() - born).toBe(6);
    expect(c.resolveUse("s3", id, "referenced").credited).toBe(true);
    const crossed = sleepNow(c).promoted;
    expect(crossed.map((p) => p.id)).toEqual([id]);
    const rec = record(c, id);
    expect(rec?.lane).toBe("support");
    expect(rec?.support?.line).toBe(PHYSICS.CORE_SUPPORT_LINE);
    // The record names every filing behind it: ids and numbers only, the sessions it came back in.
    const filings = rec?.support?.filings ?? [];
    expect(filings.map((f) => [f.memoryId, f.route, f.session, f.day - born])).toEqual([
      [id, "return", "s1", 1],
      [id, "return", "s2", 3],
      [id, "return", "s3", 6],
    ]);
    // The first counts whole; each after it shares the folder nobody knows (a return keeps none).
    expect(filings.map((f) => f.weight)).toEqual([1, PHYSICS.SUPPORT_SAME_FOLDER, PHYSICS.SUPPORT_SAME_FOLDER]);
    expect(rec?.support?.sum).toBeCloseTo(2.5, 9);
    expect(rec?.support?.days).toBe(3);
    // 0.9 x (1 − e^(−2.5/4)) x ln 4 / ln 15.
    expect(rec?.support?.level ?? 0).toBeCloseTo(0.9 * (1 - Math.exp(-2.5 / 4)) * (Math.log(4) / Math.log(15)), 9);
    // The same record on the durable log, and the core event names the lane.
    expect(c.store.eventLog({ name: "band.promoted", ref: id }).length).toBe(1);
    expect(c.store.coreEvents({ memoryId: id, action: "promoted" })[0]).toMatchObject({ lane: "support", actor: "sleep" });
    expect(c.store.physicsOf(id).promotedIdentity).toBe(true);
  });

  test("2. the same uses from one session on one lived day do not cross (spread: one occasion)", async () => {
    let c = brain();
    nextDay(c);
    const id = await write(c, { text: "I reread a hard paragraph out loud until it gives." });
    c = brain();
    nextDay(c);
    nextDay(c);
    // Three uses in one session, then two more sessions the same lived day: one return, one occasion.
    expect(c.resolveUse("s1", id, "referenced").credited).toBe(true);
    c.resolveUse("s1", id, "referenced");
    c.resolveUse("s1", id, "referenced");
    c.resolveUse("s2", id, "referenced");
    c.resolveUse("s3", id, "referenced");
    expect(c.store.returnsOf(id).filter((r) => r.source === "awake").length).toBe(1);
    for (let n = 0; n < 10; n++) expect(sleepNow(c).promoted).toEqual([]);
    const sup = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(sup).toMatchObject({ support: 1, days: 1 });
    expect(sup.level).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(verdict(c, id)).toMatchObject({ eligible: false, reason: "no-lane-yet", lane: null });
  });

  test("3. shown every lived day for 30 days and never used: support 0, it never crosses", async () => {
    let c = brain();
    nextDay(c);
    const id = await write(c, { text: "I keep the standing rule that releases wait for a first night." });
    c = brain();
    for (let d = 0; d < 30; d++) {
      nextDay(c);
      // A glimpse (shown, never rated), and on some days a rating of 1 (on topic, not needed).
      c.resolveUse(`g${String(d)}`, id, d % 5 === 0 ? "ontopic" : "shown");
      expect(sleepNow(c).promoted).toEqual([]);
    }
    // The glimpses were counted as what they are (partial returns), and none files support.
    const sources = new Set(c.store.returnsOf(id).map((r) => r.source));
    expect([...sources].every((s) => s === "shown" || s === "ontopic")).toBe(true);
    expect(sources.size).toBeGreaterThan(0);
    const sup = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(sup).toMatchObject({ support: 0, days: 0, level: 0, filings: [] });
    expect(verdict(c, id).support).toMatchObject({ met: false, support: 0, filings: 0 });
    expect(c.store.physicsOf(id).promotedIdentity).toBe(false);
  });

  test("4. one strongly felt memory, one real use 3 days later: it crosses (the fast lane, falling out of the arc); its unfelt twin does not", async () => {
    let c = brain();
    nextDay(c);
    const felt = await write(c, {
      text: "When Mike said the first night felt like meeting someone, I recognised the thing we are building.",
      feelings: [{ whose: "self", core: "happy", emotion: "moved", strength: 0.8 }],
    });
    c = brain();
    const plain = await write(c, { text: "I like a plain checklist better than a clever one." });
    c = brain();
    const born = c.store.livedDay();
    for (let n = 0; n < 3; n++) expect(sleepNow(c).promoted).toEqual([]);
    expect(c.store.livedDay() - born).toBe(3);
    expect(c.resolveUse("s-later", felt, "referenced").credited).toBe(true);
    expect(c.resolveUse("s-later", plain, "referenced").credited).toBe(true);
    const crossed = sleepNow(c).promoted;
    expect(crossed.map((p) => p.id)).toEqual([felt]);
    const rec = record(c, felt);
    expect(rec?.lane).toBe("support");
    expect(rec?.support?.filings.map((f) => [f.memoryId, f.route, f.session])).toEqual([[felt, "return", "s-later"]]);
    // Feeling multiplies the one filing (SUPPORT_FEELING), and that is what carries it.
    expect(rec?.support?.filings[0]?.weight ?? 0).toBeGreaterThan(1);
    expect(record(c, plain)).toBeUndefined();
    expect(verdict(c, plain).support?.level ?? 1).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    // The harness-tuned line (2026-10-24): one real use felt at the fast lane's relative floor (0.5) is in, at 0.45 it is not.
    const one = (feeling: number) => coreDoorSupport([{ memoryId: "m", stance: "support", route: "return", day: 1, bornDay: 1, session: "s", scope: null, feeling }]).level;
    expect(one(PHYSICS.CORE_FAST_RELATIVE_FLOOR)).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(PHYSICS.CORE_FAST_FEELING)).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(0.45)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(0)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
  });

  test("5. reflection citations alone, five nights a week apart, never cross; a later real use echoes them and it crosses", async () => {
    let c = brain();
    nextDay(c);
    const id = await write(c, { text: "I would rather say I do not know than guess in a confident voice.", relevance: 0.8, predictive: 0.7 });
    c = brain();
    const nights: number[] = [];
    for (let week = 0; week < 5; week++) {
      for (let d = 0; d < (week === 0 ? 1 : 7); d++) expect(sleepNow(c).promoted).toEqual([]);
      const begun = c.reflections.begin({ session: `r${String(week)}` });
      if (!begun.ok) throw new Error(begun.reason);
      const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: `r${String(week)}`, entry: "Looking back at how I answer when I am unsure.", cites: [id] });
      if (!done.ok) throw new Error(done.reason);
      nights.push(c.store.livedDay());
    }
    expect(sleepNow(c).promoted).toEqual([]);
    // Five counted citations, each a found filing: support, and no lived day.
    expect(c.store.returnsOf(id).filter((r) => r.source === "reflection").map((r) => r.day)).toEqual(nights);
    const alone = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(alone.filings.map((f) => f.route)).toEqual(["found", "found", "found", "found", "found"]);
    expect(alone.support).toBeGreaterThan(0);
    expect(alone.days).toBe(0);
    expect(alone.level).toBe(0);
    expect(verdict(c, id)).toMatchObject({ eligible: false, reason: "no-lane-yet" });
    // A later real use echoes every find: they rise to full weight and count their own days.
    nextDay(c);
    expect(c.resolveUse("s-echo", id, "referenced").credited).toBe(true);
    const crossed = sleepNow(c).promoted;
    expect(crossed.map((p) => p.id)).toEqual([id]);
    const rec = record(c, id);
    expect(rec?.lane).toBe("support");
    expect(rec?.support?.days).toBe(6);
    expect(rec?.support?.filings.map((f) => f.route)).toEqual(["found", "found", "found", "found", "found", "return"]);
    expect(rec?.support?.filings[0]?.weight).toBe(PHYSICS.SUPPORT_FOUND_ECHOED);
    // The record still says which sources its own returns came from.
    expect(rec?.returnSources).toEqual({ awake: 1, reflection: 5 });
  });
});

describe("the memory card says the door's road, not the lanes' day counts", () => {
  test("under the line: how far along; felt and unused: one real use; past it: a sleep can make it core", async () => {
    let c = brain();
    nextDay(c);
    const plain = await write(c, { text: "I like to name the one thing a change is for." });
    c = brain();
    const felt = await write(c, { text: "Being asked what I think, and meant, landed hard.", emotional: 0.8 });
    c = brain();
    nextDay(c);
    c.resolveUse("s1", plain, "referenced");
    const road = (id: string) => coreRoadLine(coreRoad(verdict(c, id)), false);
    expect(road(plain)).toBe(`Real uses from separate moments, on separate days, make it core — it is ${String(Math.round((100 * (verdict(c, plain).support?.level ?? 0)) / PHYSICS.CORE_SUPPORT_LINE))}% of the way.`);
    expect(road(plain)).not.toContain("separate days over");
    expect(road(felt)).toBe("Felt strongly, so one real use on a later day makes it core.");
    nextDay(c);
    c.resolveUse("s2", plain, "referenced");
    expect(road(plain)).toBe("Life has backed it enough, from separate moments — it has met the core's bar, and a sleep can make it core.");
  });
});

describe("6. the switch off is the two lanes, exactly", () => {
  /** One store with the shapes both doors decide differently. */
  async function world(): Promise<{ c: Counterpart; felt: string; twice: string; reflected: string }> {
    let c = brain();
    nextDay(c);
    const felt = await write(c, { text: "Being trusted with the first night mattered to me more than I said.", emotional: 0.8 });
    c = brain();
    const twice = await write(c, { text: "I keep the owner's words when the words matter." });
    c = brain();
    const reflected = await write(c, { text: "I notice when a review is about me rather than the code.", emotional: 0.8 });
    c = brain();
    // Day 2: felt and twice used (one day after birth: the fast lane wants a gap of 2).
    expect(sleepNow(c).promoted).toEqual([]);
    c.resolveUse("u1", felt, "referenced");
    c.resolveUse("u1", twice, "referenced");
    // Day 4: twice used again in another session, and the reflection cites `reflected`.
    sleepNow(c);
    sleepNow(c);
    c.resolveUse("u2", twice, "referenced");
    const begun = c.reflections.begin({ session: "r1" });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: "r1", entry: "On being read.", cites: [reflected] });
    if (!done.ok) throw new Error(done.reason);
    return { c, felt, twice, reflected };
  }

  test("off: the lanes decide — the felt memory cited by a reflection crosses by the fast lane, nothing carries a support key anywhere", async () => {
    setDoor(false);
    const { c, felt, twice, reflected } = await world();
    const ctx = coreContextFor(c.store, c.store.row(twice)!, c.store.livedDay());
    expect("support" in ctx).toBe(false);
    const v = promotionEligibility(c.store.physicsOf(twice), ctx);
    expect("support" in v).toBe(false);
    expect(Object.keys(v)).toEqual(["eligible", "reason", "blockedBy", "lane", "fast", "slow", "base", "returnDays"]);
    const result = sleepNow(c);
    // The old fast lane: strongly felt and a return two days after birth (a reflection's, the door open).
    expect(result.promoted.map((p) => [p.id, p.lane])).toEqual([[reflected, "fast"]]);
    expect(JSON.stringify(result)).not.toContain('"support"');
    const rec = record(c, reflected);
    expect(Object.keys(rec ?? {}).sort()).toEqual(["base", "day", "event", "feelingRecordedLater", "id", "intensity", "kind", "lane", "reflectionOnly", "reinforcedDays", "returnDays", "returnSources"]);
    expect(rec?.reflectionOnly).toBe(true);
    expect(JSON.stringify(c.store.eventLog({ name: "band.promoted" }))).not.toContain("support");
    // felt (used the day after birth) and twice (two days) stay out under the lanes.
    expect(c.store.physicsOf(felt).promotedIdentity).toBe(false);
    expect(c.store.physicsOf(twice).promotedIdentity).toBe(false);
  });

  test("on, the same world: support decides — two real uses and one felt use are in, the reflection alone is not", async () => {
    const { c, felt, twice, reflected } = await world();
    const promoted = new Set<string>();
    // felt crossed the night after its use (day 2); the rest are decided tonight.
    for (const id of [felt, twice]) if (c.store.physicsOf(id).promotedIdentity) promoted.add(id);
    for (const p of sleepNow(c).promoted) promoted.add(p.id);
    expect([...promoted].sort()).toEqual([felt, twice].sort());
    expect(c.store.physicsOf(reflected).promotedIdentity).toBe(false);
    expect(coreSupportOf(c.store, reflected, c.store.livedDay(), true)).toMatchObject({ days: 0, level: 0 });
  });
});
