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
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS, coreDoorMode, coreDoorSupport, promotionEligibility } from "../src/core/physics/index.js";
import { PROMOTION_SHADOW_EVENT, PROMOTION_SHADOW_SLEEP_EVENT, SHADOW_MARK_PREFIX, coreContextFor, coreSupportOf, promotionRecordKey, runCycle } from "../src/core/sleep/index.js";
import type { PromotionRecord } from "../src/core/sleep/index.js";
import type { CoreDoorMode } from "../src/core/physics/index.js";
import { coreRoad } from "../src/adapters/dashboard/web/views/memory.js";
import type { CoreRoad } from "../src/adapters/dashboard/web/views/memory.js";
// @ts-expect-error — a plain browser module, no declarations
import * as cardWordsJs from "../src/adapters/dashboard/web/shared/memory-card-words.js";

const { coreRoadLine } = cardWordsJs as { coreRoadLine: (p: CoreRoad, promoted: boolean) => string };

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;
let doorWas = PHYSICS.CORE_DOOR_SUPPORT;

function setDoor(mode: CoreDoorMode | boolean): void {
  (PHYSICS as { CORE_DOOR_SUPPORT: CoreDoorMode | boolean }).CORE_DOOR_SUPPORT = mode;
}

beforeEach(() => {
  dateN = 0;
  doorWas = PHYSICS.CORE_DOOR_SUPPORT;
  // The support door deciding, explicitly: the default is "shadow" since the E2 addendum.
  setDoor("on");
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
    // One occasion two days after the making: two lived days (the making's and the use's), one filing.
    const sup = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(sup).toMatchObject({ support: 1, days: 2 });
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
    // The harness-tuned line (E2 review): one real use two days or more after the making, felt at the fast
    // lane's bar (0.6), is in; at 0.55 (the most an unweighed word gives) and 0.5 it is not; the day after
    // the making it is one occasion, however felt.
    const one = (feeling: number, day = 3) =>
      coreDoorSupport([{ memoryId: "m", stance: "support", route: "return", day, bornDay: day, session: "s", scope: null, feeling }], { bornDay: 0 }).level;
    expect(one(PHYSICS.CORE_FAST_FEELING)).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(0.55)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(PHYSICS.CORE_FAST_RELATIVE_FLOOR)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(0)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(1, 1)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(one(1, PHYSICS.CORE_SUPPORT_GAP_DAYS)).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
    // Margin on both sides of the line, in the feeling the line stands for (0.575).
    expect(one(0.55)).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE - 0.0005);
    expect(one(0.6)).toBeGreaterThan(PHYSICS.CORE_SUPPORT_LINE + 0.0005);
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
    expect(road(felt)).toBe(`Felt strongly, so one real use ${String(PHYSICS.CORE_SUPPORT_GAP_DAYS)} days of use or more after it was made makes it core.`);
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

  // "off", `false` (a boolean still reads as off) and "shadow" (the lanes decide; the support door only records
  // beside them, in rows of its own): the same lanes' answer, and no support key on anything the lanes write.
  test.each([["off"], [false], ["shadow"]] as const)("%p: the lanes decide — the felt memory cited by a reflection crosses by the fast lane, nothing carries a support key anywhere", async (mode) => {
    setDoor(mode);
    expect(coreDoorMode()).toBe(mode === "shadow" ? "shadow" : "off");
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
    // The shadow's own rows: support would take twice (two real uses on two occasions — what on does, below),
    // and the lanes carried the reflection-only memory in, where support says no.
    const shadowRows = c.store.eventLog({ name: PROMOTION_SHADOW_EVENT }).map((e) => [e.ref, (JSON.parse(e.payload ?? "{}") as { kind: string }).kind]);
    expect(shadowRows).toEqual(mode === "shadow" ? [[twice, "wouldPromote"], [reflected, "wouldHold"]] : []);
    expect(c.store.eventLog({ name: PROMOTION_SHADOW_SLEEP_EVENT }).length > 0).toBe(mode === "shadow");
  });

  test.each([["on"], [true]] as const)("%p, the same world: support decides — two real uses on two occasions are in; the felt use the day after the making and the reflection alone are not", async (mode) => {
    setDoor(mode);
    expect(coreDoorMode()).toBe("on");
    const { c, felt, twice, reflected } = await world();
    const promoted = new Set<string>();
    for (const id of [felt, twice]) if (c.store.physicsOf(id).promotedIdentity) promoted.add(id);
    for (const p of sleepNow(c).promoted) promoted.add(p.id);
    expect([...promoted]).toEqual([twice]);
    // The felt use came the day after the making: one occasion, one lived day (E2 review).
    expect(coreSupportOf(c.store, felt, c.store.livedDay(), true)).toMatchObject({ support: expect.any(Number), days: 1 });
    expect(c.store.physicsOf(felt).promotedIdentity).toBe(false);
    expect(c.store.physicsOf(reflected).promotedIdentity).toBe(false);
    expect(coreSupportOf(c.store, reflected, c.store.livedDay(), true)).toMatchObject({ days: 0, level: 0 });
  });
});

// ---------------------------------------------------------------------------
// The E2 review: the states built on purpose, and the calibration's edges
// ---------------------------------------------------------------------------

describe("E2 review — the states built on purpose", () => {
  test("a glimpse loop: shown and rated 1 every lived day for 35 days, in a different session each time, never used — support 0, never crosses", async () => {
    let c = brain();
    nextDay(c);
    const id = await write(c, { text: "I like to finish the small thing before I open the big one.", emotional: 0.9 });
    c = brain();
    for (let d = 0; d < 35; d++) {
      nextDay(c);
      c.resolveUse(`glimpse-${String(d)}`, id, "shown");
      c.resolveUse(`rated-${String(d)}`, id, "ontopic");
      expect(sleepNow(c).promoted).toEqual([]);
    }
    expect(c.store.returnsOf(id).length).toBeGreaterThan(10);
    expect(c.store.returnsOf(id).every((r) => r.source === "shown" || r.source === "ontopic")).toBe(true);
    const sup = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(sup).toMatchObject({ support: 0, days: 0, level: 0, filings: [] });
    expect(verdict(c, id)).toMatchObject({ eligible: false, reason: "no-lane-yet" });
  });

  test("reflection only, strongly felt: weekly citations never carry it; one real use echoes the finds and it crosses", async () => {
    let c = brain();
    nextDay(c);
    const id = await write(c, {
      text: "When the review called my work careful, I felt seen.",
      feelings: [{ whose: "self", core: "happy", emotion: "moved", strength: 0.95 }],
    });
    c = brain();
    for (let week = 0; week < 4; week++) {
      for (let d = 0; d < 7; d++) expect(sleepNow(c).promoted).toEqual([]);
      const begun = c.reflections.begin({ session: `rf${String(week)}` });
      if (!begun.ok) throw new Error(begun.reason);
      const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: `rf${String(week)}`, entry: "On being seen.", cites: [id] });
      if (!done.ok) throw new Error(done.reason);
    }
    for (let d = 0; d < 3; d++) expect(sleepNow(c).promoted).toEqual([]);
    const alone = coreSupportOf(c.store, id, c.store.livedDay(), true);
    expect(alone.filings.length).toBe(4);
    expect(alone).toMatchObject({ days: 0, level: 0 });
    nextDay(c);
    expect(c.resolveUse("s-real", id, "referenced").credited).toBe(true);
    expect(sleepNow(c).promoted.map((p) => p.id)).toEqual([id]);
    expect(record(c, id)?.support?.filings.map((f) => f.route)).toEqual(["found", "found", "found", "found", "return"]);
  });

  test("the first cut's two new admissions are refused: one spaced use felt only by a writer's emotional 0.5, and a strongly felt use the day after the making", async () => {
    let c = brain();
    nextDay(c);
    const claimed = await write(c, { text: "I would rather ask than assume what he meant.", emotional: 0.5 });
    c = brain();
    const claimed6 = await write(c, { text: "I keep my promises about what ships when.", emotional: 0.6 });
    c = brain();
    const felt = await write(c, {
      text: "The first time he thanked me by name, it stayed with me.",
      feelings: [{ whose: "self", core: "happy", emotion: "moved", strength: 0.9 }],
    });
    c = brain();
    const born = c.store.livedDay();
    // The day after the making: the felt one is used — one occasion, one lived day.
    expect(sleepNow(c).promoted).toEqual([]);
    expect(c.resolveUse("s-next", felt, "referenced").credited).toBe(true);
    expect(coreSupportOf(c.store, felt, c.store.livedDay(), true)).toMatchObject({ days: 1 });
    expect(sleepNow(c).promoted).toEqual([]);
    expect(sleepNow(c).promoted).toEqual([]);
    // Three days after the making: each claimed memory is used once.
    expect(c.store.livedDay() - born).toBe(3);
    expect(c.resolveUse("s-later", claimed, "referenced").credited).toBe(true);
    expect(c.resolveUse("s-later", claimed6, "referenced").credited).toBe(true);
    const crossed = sleepNow(c).promoted.map((p) => p.id);
    // 0.5 claimed is not strongly felt: under the line (0.098). 0.6 is the fast lane's bar: in (0.1013).
    expect(crossed).toEqual([claimed6]);
    expect(verdict(c, claimed)).toMatchObject({ eligible: false, reason: "no-lane-yet" });
    expect(verdict(c, claimed).support?.level ?? 1).toBeLessThan(PHYSICS.CORE_SUPPORT_LINE);
    expect(c.store.physicsOf(felt).promotedIdentity).toBe(false);
    // The felt one, back once more on a later day: two occasions over time — in.
    nextDay(c);
    expect(c.resolveUse("s-again", felt, "referenced").credited).toBe(true);
    expect(sleepNow(c).promoted.map((p) => p.id)).toEqual([felt]);
    expect(record(c, felt)?.support?.days).toBe(2);
  });

  test("recognition with the door on: an unmarked memory recognised strongly crosses once its support is met; recognised faintly it is not recognition, and needs a mark", () => {
    const c = brain();
    nextDay(c);
    const day0 = c.store.livedDay();
    const put = (body: string) =>
      c.store.put({ type: "memory", kind: "self", body, salience: { relevance: 0.7, emotional: 0, predictive: 0.6 }, physics: { birthDay: day0, lastUsedDay: day0 } });
    const strong = put("Reading the old notes I saw how I write when I am careful.");
    const faint = put("Reading the log I noticed I hedge before I commit.");
    c.store.addFeelings(strong, [{ whose: "self", core: "curious", emotion: "recognized", strength: 0.8 }]);
    c.store.addFeelings(faint, [{ whose: "self", core: "curious", emotion: "recognized", strength: 0.2 }]);
    for (const n of [2, 4, 7]) {
      while (c.store.livedDay() - day0 < n) nextDay(c);
      c.resolveUse(`u${String(n)}`, strong, "referenced");
      c.resolveUse(`u${String(n)}`, faint, "referenced");
    }
    const ctx = (id: string) => coreContextFor(c.store, c.store.row(id)!, c.store.livedDay());
    expect(ctx(strong)).toMatchObject({ aboutMe: false, selfRelevantFeeling: true });
    // Recognition is read only off a strongly felt self-relevant feeling (`selfRelevantFeeling`), so the door's
    // widening from the fast lane to "support met" never lets a faint one in.
    expect(ctx(faint).selfRelevantFeeling).toBeUndefined();
    expect(verdict(c, strong)).toMatchObject({ eligible: true, lane: "support" });
    // Not a candidate at all: no support is counted for it, and the door's first gate refuses it.
    const v = verdict(c, faint);
    expect(v).toMatchObject({ eligible: false, reason: "not-about-me" });
    expect(coreSupportOf(c.store, faint, c.store.livedDay(), true).level).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
  });

  test("invariants with the door on: a skill used on many days is never core; a self memory born claiming everything is not core at birth", async () => {
    let c = brain();
    nextDay(c);
    const skill = await write(c, { kind: "skill", text: "To bisect a flaky test, pin the seed first.", emotional: 0.9 });
    c = brain();
    const loud = await write(c, { text: "I am the one who keeps the night safe.", relevance: 1, emotional: 1, predictive: 1 });
    c = brain();
    expect(sleepNow(c).promoted).toEqual([]);
    expect(coreSupportOf(c.store, loud, c.store.livedDay(), true).level).toBe(0);
    for (let d = 0; d < 8; d++) {
      nextDay(c);
      c.resolveUse(`k${String(d)}`, skill, "referenced");
      expect(sleepNow(c).promoted.map((p) => p.id)).not.toContain(skill);
    }
    expect(c.store.physicsOf(skill).promotedIdentity).toBe(false);
    expect(verdict(c, skill).blockedBy).toContain("not-about-me");
  });
});

describe("E2 review — switching the door on never touches today's core", () => {
  test("members the lanes promoted stay core, and the next nights' core events for them match a store that kept the door off", async () => {
    setDoor(false);
    let c = brain();
    nextDay(c);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await write(c, { text: `A thing I hold about how we work, number ${String(i)}.`, emotional: 0.8 }));
      c = brain();
    }
    for (let d = 0; d < 3; d++) sleepNow(c);
    for (const id of ids) c.resolveUse("s-old", id, "referenced");
    sleepNow(c);
    const members = ids.filter((id) => c.store.physicsOf(id).promotedIdentity);
    expect(members.length).toBeGreaterThan(0);
    const day = dateN;
    c.close();
    open.splice(open.indexOf(c), 1);
    // Two copies of the same store: one goes on with the door off, the other with it on.
    const twin = mkdtempSync(join(tmpdir(), "counterparts-core-door-twin-"));
    try {
      cpSync(dir, twin, { recursive: true });
      const run = (where: string, on: boolean) => {
        setDoor(on);
        const k = Counterpart.open({ dir: where, identity: { name: "Mike" }, now: () => Date.UTC(2026, 8, 1) + day * 86_400_000 + 3_600_000 });
        try {
          for (let n = 1; n <= 8; n++) runCycle({ store: k.store, date: date(day + n), cadence: { consolidate: 1 } });
          return {
            identity: members.filter((id) => k.store.physicsOf(id).promotedIdentity),
            events: k.store
              .coreEvents({ limit: 500 })
              .filter((e) => members.includes(e.memory_id))
              .map((e) => [e.memory_id, e.action, e.day, e.actor, e.lane]),
          };
        } finally {
          k.close();
        }
      };
      const off = run(dir, false);
      const on = run(twin, true);
      expect(on.identity).toEqual(members);
      expect(off.identity).toEqual(members);
      // Not two empty lists: each member's promotion by its lane is there, on both.
      expect(on.events.filter((e) => e[1] === "promoted").length).toBe(members.length);
      expect(on.events.every((e) => e[4] === "fast" || e[1] !== "promoted")).toBe(true);
      expect(on.events).toEqual(off.events);
      expect(on.events.some((e) => e[1] === "demoted")).toBe(false);
    } finally {
      rmSync(twin, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The shadow (E2 addendum, 2026-10-24 21:00, Mike's yes 20:59): the default.
// The lanes promote exactly as off; the support door runs beside them and only
// records — a row per disagreement, a row per sleep.
// ---------------------------------------------------------------------------

describe("the shadow: the lanes decide, the support door records what it would have done", () => {
  type Role = "felt" | "twice" | "reflected" | "late";
  interface ShadowRow {
    memory: string;
    kind: "wouldPromote" | "wouldHold";
    day: number;
    level: number;
    line: number;
    days: number;
    sum: number;
    filings: { memoryId: string; route: string; day: number; session: string | null; weight: number }[];
    lane?: string;
    reflectionOnly?: boolean;
  }
  interface SleepRow {
    day: number;
    lanes: number;
    support: number;
    overlap: number;
    wouldPromote: number;
    wouldHold: number;
    caughtUp: number;
    considered: number;
    line: number;
  }
  interface Run {
    ids: Record<Role, string>;
    role: (id: string) => string;
    born: number;
    /** Each sleep's promotions, by role. */
    nights: string[][];
    core: Role[];
    /** What the core reads, by role: core events, band.promoted payloads, the promotion records. */
    coreEvents: unknown[];
    bandPromoted: unknown[];
    records: unknown[];
    shadow: (Omit<ShadowRow, "memory" | "filings"> & { memory: string; filings: string[] })[];
    sleeps: SleepRow[];
    marks: Record<string, unknown>;
  }

  /**
   * One script, run from scratch on its own store with the door at `mode`:
   *   - `felt` (feeling 0.8), used once three days after the making: both doors take it — the overlap;
   *   - `twice` (plain), used in two sessions on two later days: support takes it, the lanes do not;
   *   - `reflected` (0.8), cited by a reflection two days after the making and never used: the lanes' fast
   *     lane takes it (a reflection's return after a gap), support never does;
   *   - `late` (0.8), the same as `reflected`, then used for real two days later: the lanes take it with
   *     `reflected`; support takes it the night after the use (the shadow's `caughtUp`).
   */
  async function script(mode: CoreDoorMode, nights = 8): Promise<Run> {
    setDoor(mode);
    dateN = 0;
    dir = mkdtempSync(join(tmpdir(), `counterparts-core-shadow-${mode}-`));
    let c = brain();
    nextDay(c);
    const ids = {} as Record<Role, string>;
    ids.felt = await write(c, { text: "Being trusted with the first night mattered to me more than I said.", emotional: 0.8 });
    c = brain();
    ids.twice = await write(c, { text: "I keep the owner's words when the words matter." });
    c = brain();
    ids.reflected = await write(c, { text: "I notice when a review is about me rather than the code.", emotional: 0.8 });
    c = brain();
    ids.late = await write(c, { text: "I slow down when a change touches what he trusts me with.", emotional: 0.8 });
    c = brain();
    const born = c.store.livedDay();
    const promotedOn: string[][] = [];
    const sleep = () => promotedOn.push(sleepNow(c).promoted.map((p) => p.id));
    // Day +2: twice used; the reflection cites reflected and late.
    sleep();
    sleep();
    expect(c.resolveUse("u1", ids.twice, "referenced").credited).toBe(true);
    const begun = c.reflections.begin({ session: "r1" });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: "r1", entry: "On being read.", cites: [ids.reflected, ids.late] });
    if (!done.ok) throw new Error(done.reason);
    // Day +3: felt and twice used.
    sleep();
    expect(c.resolveUse("u2", ids.felt, "referenced").credited).toBe(true);
    expect(c.resolveUse("u2", ids.twice, "referenced").credited).toBe(true);
    // Day +4: late used for real.
    sleep();
    expect(c.resolveUse("u3", ids.late, "referenced").credited).toBe(true);
    while (promotedOn.length < nights) sleep();
    const byId = new Map(Object.entries(ids).map(([r, id]) => [id, r]));
    const role = (id: string) => byId.get(id) ?? id;
    const swap = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replace(/mem_[0-9a-f]+/g, (m) => role(m)));
    // Rows by role, in a stable order (one night's promotions are written strongest first, then by the random id).
    const sorted = (xs: unknown): unknown[] => (swap(xs) as unknown[]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    const store = c.store;
    const run: Run = {
      ids,
      role,
      born,
      // Within a night the order is strength, then the (random) id: sorted, so runs compare.
      nights: promotedOn.map((n) => n.map(role).sort()),
      core: (Object.keys(ids) as Role[]).filter((r) => store.physicsOf(ids[r]).promotedIdentity).sort(),
      coreEvents: sorted(store.coreEvents({ limit: 500 }).map((e) => [e.memory_id, e.action, e.day, e.lane, e.actor])),
      bandPromoted: sorted(store.eventLog({ name: "band.promoted" }).map((e) => [e.day, e.ref, JSON.parse(e.payload ?? "{}")])),
      records: swap((Object.values(ids) as string[]).map((id) => store.getMeta(promotionRecordKey(id)) ?? null).map((r) => (r === null ? null : JSON.parse(r)))) as unknown[],
      shadow: store.eventLog({ name: PROMOTION_SHADOW_EVENT }).map((e) => {
        const p = JSON.parse(e.payload ?? "{}") as ShadowRow;
        expect(e.ref).toBe(p.memory);
        return { ...p, memory: role(p.memory), filings: p.filings.map((f) => `${f.route}:${role(f.memoryId)}`) };
      }),
      sleeps: store.eventLog({ name: PROMOTION_SHADOW_SLEEP_EVENT }).map((e) => JSON.parse(e.payload ?? "{}") as SleepRow),
      marks: Object.fromEntries((Object.keys(ids) as Role[]).flatMap((r) => {
        const raw = store.getMeta(`${SHADOW_MARK_PREFIX}${ids[r]}`);
        return raw === undefined ? [] : [[r, JSON.parse(raw) as unknown]];
      })),
    };
    for (const k of open.splice(0)) k.close();
    rmSync(dir, { recursive: true, force: true });
    return run;
  }

  test("the default is the shadow", () => {
    setDoor(doorWas);
    expect(PHYSICS.CORE_DOOR_SUPPORT).toBe("shadow");
    expect(coreDoorMode()).toBe("shadow");
  });

  test("shadow leaves the same core as off after eight sleeps, and its rows name what on would have done", async () => {
    const off = await script("off");
    const shadow = await script("shadow");
    const on = await script("on");

    // The lanes, as written: reflected and late the night after the citation, felt the night after its use.
    expect(off.core).toEqual(["felt", "late", "reflected"]);
    expect(off.nights.slice(0, 4)).toEqual([[], [], ["late", "reflected"], ["felt"]]);
    // On: felt and twice the night after their uses; late the night after its real use; reflected never.
    expect(on.core).toEqual(["felt", "late", "twice"]);

    // SHADOW = OFF for everything the core reads: the same promotions each night, the same core, the same
    // core events, the same band.promoted rows and the same promotion records — no support key on any.
    expect(shadow.nights).toEqual(off.nights);
    expect(shadow.core).toEqual(off.core);
    expect(shadow.coreEvents).toEqual(off.coreEvents);
    expect(shadow.bandPromoted).toEqual(off.bandPromoted);
    expect(shadow.records).toEqual(off.records);
    expect(JSON.stringify(shadow.records)).not.toContain('"support"');
    // Off and on write no shadow row and no mark.
    for (const r of [off, on]) {
      expect(r.shadow).toEqual([]);
      expect(r.sleeps).toEqual([]);
      expect(r.marks).toEqual({});
    }

    // THE ROWS NAME WHAT ON WOULD HAVE DONE.
    const wouldPromote = shadow.shadow.filter((r) => r.kind === "wouldPromote").map((r) => r.memory);
    const wouldHold = shadow.shadow.filter((r) => r.kind === "wouldHold").map((r) => r.memory);
    expect(wouldPromote).toEqual(["twice"]);
    expect(wouldHold.sort()).toEqual(["late", "reflected"]);
    // wouldPromote ⊆ on's promotions.
    for (const m of wouldPromote) expect(on.core).toContain(m as Role);
    // wouldHold: lane promotions on did not make — except the one support admitted later (caught up), which on
    // made later, the night after its real use.
    const caughtUp = Object.entries(shadow.marks).filter(([, m]) => (m as { caughtUp?: number }).caughtUp !== undefined).map(([r]) => r);
    expect(caughtUp).toEqual(["late"]);
    expect(wouldHold.filter((m) => !caughtUp.includes(m)).sort()).toEqual(off.core.filter((m) => !on.core.includes(m)).sort());
    expect(on.nights.findIndex((n) => n.includes("late"))).toBe(shadow.sleeps.findIndex((s) => s.caughtUp > 0));

    // Each row: the support level, the line, lived days, the sum and its filings (ids and routes; no text).
    const twiceRow = shadow.shadow.find((r) => r.memory === "twice");
    expect(twiceRow).toMatchObject({ kind: "wouldPromote", line: PHYSICS.CORE_SUPPORT_LINE, days: 3 });
    expect(twiceRow?.level ?? 0).toBeGreaterThanOrEqual(PHYSICS.CORE_SUPPORT_LINE);
    expect(twiceRow?.filings).toEqual(["return:twice", "return:twice"]);
    const reflectedRow = shadow.shadow.find((r) => r.memory === "reflected");
    expect(reflectedRow).toMatchObject({ kind: "wouldHold", lane: "fast", reflectionOnly: true, level: 0, days: 0 });
    expect(reflectedRow?.filings).toEqual(["found:reflected"]);
    // The day the rows name is the night the lanes or support decided.
    expect(twiceRow?.day).toBe(shadow.born + 4);
    expect(reflectedRow?.day).toBe(shadow.born + 3);
    // Nothing but ids and numbers: no memory's words in any row.
    const all = JSON.stringify([shadow.shadow, shadow.sleeps]);
    for (const word of ["trusted", "owner's words", "review", "slow down"]) expect(all).not.toContain(word);
  });

  test("one summary row a sleep, zeros included; N, M and K are right, and summed they are each door's core growth", async () => {
    const off = await script("off");
    const shadow = await script("shadow");
    const on = await script("on");
    expect(shadow.sleeps.length).toBe(8);
    const firstDay = shadow.sleeps[0]?.day ?? 0;
    expect(shadow.sleeps.map((s) => s.day)).toEqual(shadow.sleeps.map((_, i) => firstDay + i));
    // N is the lanes' promotions that night, exactly.
    expect(shadow.sleeps.map((s) => s.lanes)).toEqual(shadow.nights.map((n) => n.length));
    // Night by night: +3 the lanes take reflected and late, support nothing (two holds); +4 the lanes take felt,
    // support felt and twice (overlap 1, one wouldPromote); +5 support takes late (caught up); then nothing.
    const at = (k: number) => shadow.sleeps.find((s) => s.day === shadow.born + k);
    expect(at(3)).toMatchObject({ lanes: 2, support: 0, overlap: 0, wouldPromote: 0, wouldHold: 2, caughtUp: 0 });
    expect(at(4)).toMatchObject({ lanes: 1, support: 2, overlap: 1, wouldPromote: 1, wouldHold: 0, caughtUp: 0 });
    expect(at(5)).toMatchObject({ lanes: 0, support: 1, overlap: 0, wouldPromote: 0, wouldHold: 0, caughtUp: 1 });
    for (const s of shadow.sleeps.filter((s) => s.day > shadow.born + 5)) expect(s).toMatchObject({ lanes: 0, support: 0, overlap: 0 });
    for (const s of shadow.sleeps) {
      expect(s.line).toBe(PHYSICS.CORE_SUPPORT_LINE);
      // The rows written that night are the disagreements the summary counts.
      const rows = shadow.shadow.filter((r) => r.day === s.day);
      expect(rows.filter((r) => r.kind === "wouldPromote").length).toBe(s.wouldPromote);
      expect(rows.filter((r) => r.kind === "wouldHold").length).toBe(s.wouldHold);
      // M = overlap + wouldPromote + caughtUp; N = overlap + wouldHold + the lanes catching up on an admitted one.
      expect(s.support).toBe(s.overlap + s.wouldPromote + s.caughtUp);
      expect(s.lanes).toBeGreaterThanOrEqual(s.overlap + s.wouldHold);
    }
    // Summed: the lanes' column is off's core growth, the support column on's.
    const sum = (k: keyof SleepRow) => shadow.sleeps.reduce((n, s) => n + s[k], 0);
    expect(sum("lanes")).toBe(off.core.length);
    expect(sum("support")).toBe(on.core.length);
    expect(sum("support")).toBe(on.nights.flat().length);
  });
});
