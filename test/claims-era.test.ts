/**
 * THE OLD-CLAIMS ERA (2026-10-10; decided by Mike, 2026-10-10, loosely held):
 * a memory written before the store's `claims.era.cutoff` with an explicit
 * claim is read by the CURVE at the default for what it is about
 * (`physics#defaultClaimFor`) when that is lower — never rewritten. Exempt:
 * the core, about the owner or us, said by the owner, protected, a pending or
 * repeating date. Reversible by deleting the key (`counterparts claims-era
 * --off`).
 *
 * Hermetic: every test makes and removes its own temp data dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claimsEraFindings } from "../src/adapters/claude-code/doctor.js";
import { EXIT, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { CLAIMED_DEFAULT_META_KEY } from "../src/core/mint.js";
import { TUNABLES as PHYSICS, curveSal, sal, stability, strength } from "../src/core/physics/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { CURVE_META_KEY, curveSignature } from "../src/core/sleep/decay.js";
import { SCHEMA_VERSION, Store, paths } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import {
  CLAIMED_DEFAULT_SPELLED,
  CLAIMS_ERA_CUTOFF_KEY,
  CLAIMS_ERA_RECORDED_KEY,
  ERA_WRITTEN_AT_META,
  RECURRING_META,
  eraCarriedFrom,
  eraClaimOf,
  rowToPhysics,
} from "../src/core/store/operational.js";
import { stripV13 } from "./store-fixture.js";

let root: string;
let dir: string;
const open: Store[] = [];

/** The moment every fixture memory is written at; the cutoff goes after it. */
const T = Date.UTC(2026, 9, 1, 12);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-claims-era-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(now: () => number = () => T): Store {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps"), now });
  open.push(s);
  return s;
}

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

const OLD = 0.6;
/** What the seam filled in for a silent writer before 2026-10-10: the flat 0.25, marked a default. */
const OLD_DEFAULT = { salience: { claimed: 0.25 }, meta: { [CLAIMED_DEFAULT_META_KEY]: true } } as const;

/** One memory at the old claim, with the fields a class needs. */
function put(s: Store, extra: Partial<PutInput> = {}): string {
  return s.put({
    type: "memory",
    kind: "fact",
    body: `an old memory ${Math.random().toString(36).slice(2)}`,
    learnedOn: "2026-10-01",
    salience: { claimed: OLD },
    physics: { birthDay: 1, lastUsedDay: 1 },
    ...extra,
  });
}

/** A store on calendar 2026-10-10, with the fixture written BEFORE its cutoff. */
function seeded(): { s: Store; ids: Record<string, string> } {
  const s = store();
  runCycle({ store: s, date: "2026-10-10" });
  const ids: Record<string, string> = {
    // Read at their default.
    workEvent: put(s, { about: "work", status: "done" }),
    work: put(s, { about: "work" }),
    unmarked: put(s),
    world: put(s, { about: "world" }),
    me: put(s, { about: "me" }),
    person: put(s, { kind: "person" }),
    closedDate: put(s, { eventDate: "2026-09-15", learnedOn: "2026-09-01" }),
    work07: put(s, { about: "work", salience: { claimed: 0.7 } }),
    // An old DEFAULT (2026-10-11): today's default for what it is about,
    // either way, exempt or not.
    ownerDefault: put(s, { about: "owner", ...OLD_DEFAULT }),
    usDefault: put(s, { about: "us", ...OLD_DEFAULT }),
    workEventDefault: put(s, { about: "work", status: "done", ...OLD_DEFAULT }),
    protectedWorkEventDefault: put(s, {
      about: "work",
      status: "done",
      ...OLD_DEFAULT,
      physics: { birthDay: 1, lastUsedDay: 1, protected: true },
    }),
    // Kept as claimed.
    core: put(s, { kind: "self", about: "me", physics: { birthDay: 1, lastUsedDay: 1, promotedIdentity: true } }),
    owner: put(s, { about: "owner" }),
    us: put(s, { about: "us" }),
    saidByOwner: put(s, { about: "work", saidBy: "owner" }),
    protected: put(s, { physics: { birthDay: 1, lastUsedDay: 1, protected: true } }),
    pendingDate: put(s, { about: "work", eventDate: "2026-10-20", learnedOn: "2026-10-01" }),
    recurring: put(s, { about: "work", eventDate: "2026-04-15", learnedOn: "2026-03-01", meta: { [RECURRING_META]: "yearly" } }),
    defaulted: put(s, { salience: { claimed: PHYSICS.AUTHORED_DEFAULT_CLAIM }, meta: { [CLAIMED_DEFAULT_META_KEY]: true } }),
    lowWorld: put(s, { about: "world", salience: { claimed: 0.3 } }),
  };
  // Everything above was written at T; the cutoff is after it.
  s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T + 1));
  return { s, ids };
}

const READ_AT: Record<string, number> = {
  workEvent: PHYSICS.DEFAULT_CLAIM_WORK_EVENT,
  work: PHYSICS.AUTHORED_DEFAULT_CLAIM,
  unmarked: PHYSICS.AUTHORED_DEFAULT_CLAIM,
  world: PHYSICS.DEFAULT_CLAIM_WORLD,
  me: PHYSICS.DEFAULT_CLAIM_PERSONAL,
  person: PHYSICS.DEFAULT_CLAIM_PERSONAL,
  closedDate: PHYSICS.AUTHORED_DEFAULT_CLAIM,
  work07: PHYSICS.AUTHORED_DEFAULT_CLAIM,
  ownerDefault: PHYSICS.DEFAULT_CLAIM_PERSONAL,
  usDefault: PHYSICS.DEFAULT_CLAIM_PERSONAL,
  workEventDefault: PHYSICS.DEFAULT_CLAIM_WORK_EVENT,
  protectedWorkEventDefault: PHYSICS.DEFAULT_CLAIM_WORK_EVENT,
};
/** The old defaults below today's: the rest of READ_AT read lower than stored. */
const READ_UP = ["ownerDefault", "usDefault"];
const KEPT = ["core", "owner", "us", "saidByOwner", "protected", "pendingDate", "recurring", "defaulted", "lowWorld"];

describe("the read: old claims at their default, the exempt as claimed", () => {
  test("each class at 0.6 reads its default; each exempt class reads its own claim", () => {
    const { s, ids } = seeded();
    for (const [name, want] of Object.entries(READ_AT)) {
      const p = rowToPhysics(s.row(ids[name] as string)!);
      expect({ name, era: p.eraClaim }).toEqual({ name, era: want });
      // Lowered: the era's value is the whole reading (2026-10-14); raised: the dimensions still count.
      const reads = READ_UP.includes(name) ? Math.max(want, sal({ ...p.salience, claimed: null })) : want;
      expect(curveSal(p)).toBeCloseTo(reads, 10);
    }
    for (const name of KEPT) {
      const p = rowToPhysics(s.row(ids[name] as string)!);
      expect({ name, era: p.eraClaim ?? null }).toEqual({ name, era: null });
      expect(curveSal(p)).toBe(sal(p.salience));
    }
    // The pending date is held now; the repeating one is outside its window and still exempt.
    expect(rowToPhysics(s.row(ids["pendingDate"] as string)!).hold).toEqual({ state: "pending" });
    expect(rowToPhysics(s.row(ids["recurring"] as string)!).hold ?? null).toBeNull();
  });

  test("the stored claim is never rewritten — not by the read, a cycle, or a physics write-back", () => {
    const { s, ids } = seeded();
    const stored = Object.fromEntries(Object.keys(READ_AT).map((name) => [name, s.row(ids[name] as string)!.claimed]));
    for (let k = 1; k <= 5; k++) runCycle({ store: s, date: `2026-10-1${String(k)}` });
    for (const name of Object.keys(READ_AT)) expect({ name, claimed: s.row(ids[name] as string)!.claimed }).toEqual({ name, claimed: stored[name] ?? null });
    expect(stored["ownerDefault"]).toBe(0.25);
    // A spread physics object written back (what a challenge does) carries no era claim into the column.
    const id = ids["work"] as string;
    s.updatePhysics(id, { ...s.physicsOf(id) });
    expect(s.row(id)!.claimed).toBe(OLD);
    expect(s.physicsOf(id).eraClaim).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
  });

  test("the era lowers height and stability; a memory written after the cutoff reads its claim", () => {
    const { s, ids } = seeded();
    const old = s.physicsOf(ids["work"] as string);
    const asStored = { ...old, eraClaim: null };
    expect(stability(old)).toBeLessThan(stability(asStored));
    expect(strength(old, 5)).toBeLessThan(strength(asStored, 5));
    // Written after the cutoff: the claim is the new text's, and it stands.
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T - 1));
    expect(s.physicsOf(ids["work"] as string).eraClaim ?? null).toBeNull();
  });

  test("off restores the old reading exactly; on puts the same cutoff back", async () => {
    const { s, ids } = seeded();
    const id = ids["unmarked"] as string;
    const recorded = s.getMeta(CLAIMS_ERA_RECORDED_KEY);
    const day = s.livedDay() + 3;
    const withEra = strength(s.physicsOf(id), day);
    s.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
    const p = s.physicsOf(id);
    expect(p.eraClaim ?? null).toBeNull();
    const plain = rowToPhysics({ ...s.row(id)!, claims_era_cutoff: null });
    expect(strength(p, day)).toBe(strength(plain, day));
    expect(strength(p, day)).toBeGreaterThan(withEra);
    // The CLI: --on restores the RECORDED cutoff (the open's moment), not the fixture's.
    s.close();
    const c = capture();
    expect(await run(["claims-era", "--on", "--dir", dir], { io: c.io, env: {} })).toBe(EXIT.ok);
    const again = store();
    expect(again.getMeta(CLAIMS_ERA_CUTOFF_KEY)).toBe(recorded);
  });
});

describe("old defaults read at today's default, either way (Mike, 2026-10-11)", () => {
  test("an old 0.25 owner default reads 0.40 and stands higher; a done work event's reads 0.20; an exempt one too", () => {
    const { s, ids } = seeded();
    const owner = s.physicsOf(ids["ownerDefault"] as string);
    expect(owner.eraClaim).toBe(PHYSICS.DEFAULT_CLAIM_PERSONAL);
    const asStored = { ...owner, eraClaim: null };
    expect(stability(owner)).toBeGreaterThan(stability(asStored));
    expect(strength(owner, 5)).toBeGreaterThan(strength(asStored, 5));
    expect(s.physicsOf(ids["workEventDefault"] as string).eraClaim).toBe(PHYSICS.DEFAULT_CLAIM_WORK_EVENT);
    // The exemptions are for explicit claims: a protected default reads today's too.
    expect(s.physicsOf(ids["protectedWorkEventDefault"] as string).eraClaim).toBe(PHYSICS.DEFAULT_CLAIM_WORK_EVENT);
    // An old default already at today's reads as stored.
    expect(s.physicsOf(ids["defaulted"] as string).eraClaim ?? null).toBeNull();
  });

  test("an explicit claim keeps #377's reading: 0.7 work reads 0.25, 0.3 world reads 0.3, owner and us as claimed", () => {
    const { s, ids } = seeded();
    expect(s.physicsOf(ids["work07"] as string).eraClaim).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    for (const name of ["lowWorld", "owner", "us", "saidByOwner", "protected"]) {
      expect({ name, era: s.physicsOf(ids[name] as string).eraClaim ?? null }).toEqual({ name, era: null });
    }
  });

  test("a default written after the cutoff is untouched; --off reads every old default as stored", () => {
    const { s, ids } = seeded();
    const id = ids["ownerDefault"] as string;
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T - 1));
    expect(s.physicsOf(id).eraClaim ?? null).toBeNull();
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T + 1));
    expect(s.claimsEra()).toMatchObject({ down: Object.keys(READ_AT).length - READ_UP.length, up: READ_UP.length });
    s.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
    for (const name of [...READ_UP, "workEventDefault"]) {
      const p = s.physicsOf(ids[name] as string);
      expect({ name, era: p.eraClaim ?? null }).toEqual({ name, era: null });
      expect(curveSal(p)).toBe(sal(p.salience));
    }
    expect(s.claimsEra()).toMatchObject({ affected: 0, down: 0, up: 0 });
  });

  test("the signature carries the reading's version, so a store signed before it re-curves once", () => {
    expect(JSON.parse(curveSignature("1"))).toMatchObject({ era: "1", eraReads: 3 });
    const { s } = seeded();
    // Signed under the 10-10 reading: the same signature without `eraReads`.
    const { eraReads: _gone, ...before } = JSON.parse(curveSignature(String(T + 1))) as Record<string, unknown>;
    s.setMeta(CURVE_META_KEY, JSON.stringify(before));
    runCycle({ store: s, date: "2026-10-11" });
    expect(s.getMeta(CURVE_META_KEY)).toBe(curveSignature(String(T + 1)));
  });
});

describe("a lowered claim is the whole reading: the old dimensions no longer floor it (2026-10-14)", () => {
  // Pre-Group-1 memories carry author-scored relevance and predictive written under the
  // old field text; their mean held a quarter of the live store's lowered claims in place.
  const HIGH = { relevance: 0.8, predictive: 0.7 };

  test("pure: below the stored claim the era's value alone; above it, the dimensions still count", () => {
    const salience = { novelty: 0.5, relevance: 0.8, emotional: 0, predictive: 0.7, claimed: 0.6 };
    expect(sal(salience)).toBeCloseTo(2 / 3, 10);
    expect(curveSal({ salience, eraClaim: 0.25 })).toBe(0.25);
    expect(curveSal({ salience: { ...salience, claimed: 0.25 }, eraClaim: 0.4 })).toBeCloseTo(2 / 3, 10);
    expect(curveSal({ salience: { ...salience, relevance: 0, predictive: 0, novelty: null, claimed: 0.25 }, eraClaim: 0.4 })).toBe(0.4);
    expect(curveSal({ salience, eraClaim: null })).toBe(sal(salience));
    expect(curveSal({ salience })).toBe(sal(salience));
  });

  test("an old explicit claim with high old dimensions reads the era's default, and its curve falls", () => {
    const s = store();
    runCycle({ store: s, date: "2026-10-10" });
    const id = put(s, { about: "work", salience: { claimed: OLD, ...HIGH } });
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T + 1));
    const p = s.physicsOf(id);
    expect(p.eraClaim).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    // Before 2026-10-14 the mean (0.75) floored it: max(0.75, 0.25) — no lower than as stored.
    expect(sal({ ...p.salience, claimed: p.eraClaim })).toBeCloseTo(sal(p.salience), 10);
    expect(curveSal(p)).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    const asStored = { ...p, eraClaim: null };
    expect(stability(p)).toBeLessThan(stability(asStored));
    expect(strength(p, 5)).toBeLessThan(strength(asStored, 5));
  });

  test("an old default the era raises reads as before: the dimensions still count", () => {
    const s = store();
    runCycle({ store: s, date: "2026-10-10" });
    const id = put(s, { about: "owner", salience: { claimed: 0.25, ...HIGH }, meta: { [CLAIMED_DEFAULT_META_KEY]: true } });
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T + 1));
    const p = s.physicsOf(id);
    expect(p.eraClaim).toBe(PHYSICS.DEFAULT_CLAIM_PERSONAL);
    expect(curveSal(p)).toBeCloseTo(sal({ ...p.salience, claimed: p.eraClaim }), 10);
    expect(curveSal(p)).toBeCloseTo(0.75, 10);
  });

  test("a DEFAULT on an exempt row the era lowers reads exactly as before: its dimensions still floor it", () => {
    const s = store();
    runCycle({ store: s, date: "2026-10-10" });
    const ids = {
      protectedWork: put(s, {
        about: "work",
        status: "done",
        salience: { claimed: 0.25, ...HIGH },
        meta: { [CLAIMED_DEFAULT_META_KEY]: true },
        physics: { birthDay: 1, lastUsedDay: 1, protected: true },
      }),
      coreWork: put(s, {
        about: "work",
        status: "done",
        salience: { claimed: 0.25, ...HIGH },
        meta: { [CLAIMED_DEFAULT_META_KEY]: true },
        physics: { birthDay: 1, lastUsedDay: 1, promotedIdentity: true },
      }),
      pendingWork: put(s, {
        about: "work",
        eventDate: "2026-10-20",
        salience: { claimed: 0.3, ...HIGH },
        meta: { [CLAIMED_DEFAULT_META_KEY]: true },
      }),
    };
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T + 1));
    for (const [name, id] of Object.entries(ids)) {
      const p = s.physicsOf(id);
      // The era still reads the default at today's (2026-10-11), lower than stored…
      expect({ name, lowered: (p.eraClaim ?? 1) < (p.salience.claimed ?? 0) }).toEqual({ name, lowered: true });
      expect(p.eraExempt).toBe(true);
      // …and the curve reads it as master did: max(the dimensions' mean, the era's value).
      expect(curveSal(p)).toBeCloseTo(sal({ ...p.salience, claimed: p.eraClaim }), 10);
      expect(curveSal(p)).toBeCloseTo(0.75, 10);
    }
    // The same default on a row that is not exempt reads the era's value alone.
    const plain = put(s, { about: "work", status: "done", salience: { claimed: 0.25, ...HIGH }, meta: { [CLAIMED_DEFAULT_META_KEY]: true } });
    const p = s.physicsOf(plain);
    expect(p.eraExempt ?? false).toBe(false);
    expect(curveSal(p)).toBe(PHYSICS.DEFAULT_CLAIM_WORK_EVENT);
  });

  test("the exempt are untouched: about the owner, said by the owner, protected, the core", () => {
    const s = store();
    runCycle({ store: s, date: "2026-10-10" });
    const ids = [
      put(s, { about: "owner", salience: { claimed: OLD, ...HIGH } }),
      put(s, { about: "work", saidBy: "owner", salience: { claimed: OLD, ...HIGH } }),
      put(s, { salience: { claimed: OLD, ...HIGH }, physics: { birthDay: 1, lastUsedDay: 1, protected: true } }),
      put(s, { kind: "self", about: "me", salience: { claimed: OLD, ...HIGH }, physics: { birthDay: 1, lastUsedDay: 1, promotedIdentity: true } }),
    ];
    s.setMeta(CLAIMS_ERA_CUTOFF_KEY, String(T + 1));
    for (const id of ids) {
      const p = s.physicsOf(id);
      expect(p.eraClaim ?? null).toBeNull();
      expect(curveSal(p)).toBe(sal(p.salience));
    }
  });
});

describe("the cutoff: recorded once, kept off when turned off", () => {
  test("a writable open records both keys once; a reopen does not move them; an observer writes nothing", () => {
    let now = T;
    const s = store(() => now);
    expect(s.getMeta(CLAIMS_ERA_CUTOFF_KEY)).toBe(String(T));
    expect(s.getMeta(CLAIMS_ERA_RECORDED_KEY)).toBe(String(T));
    s.close();
    now = T + 86_400_000;
    const again = store(() => now);
    expect(again.getMeta(CLAIMS_ERA_CUTOFF_KEY)).toBe(String(T));
    // Off, then reopened: it stays off.
    again.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
    again.close();
    const third = store(() => now);
    expect(third.getMeta(CLAIMS_ERA_CUTOFF_KEY)).toBeUndefined();
    expect(third.getMeta(CLAIMS_ERA_RECORDED_KEY)).toBe(String(T));
    // A store with neither key, opened by an observer, stays without them.
    third.updateMeta(CLAIMS_ERA_RECORDED_KEY, () => null);
    third.close();
    const reader = Store.open({ dir, observer: true });
    open.push(reader);
    expect(reader.getMeta(CLAIMS_ERA_RECORDED_KEY)).toBeUndefined();
  });

  test("a new store's memories are all after its cutoff: nothing is read as old", () => {
    let now = T;
    const s = store(() => now);
    runCycle({ store: s, date: "2026-10-10" });
    now = T + 1000;
    const id = put(s, { about: "work" });
    expect(s.physicsOf(id).eraClaim ?? null).toBeNull();
    expect(s.claimsEra().affected).toBe(0);
  });

  test("a v12 store: the open that migrates it records the cutoff, after every memory it holds; an observer records nothing", () => {
    const s = store(() => T);
    const id = put(s, { about: "work" });
    s.close();
    open.splice(0);
    // Back to a v12 file, as Mike's store is before this build opens it.
    const db = new Database(paths.operational(dir));
    stripV13(db);
    db.run("DELETE FROM meta WHERE key IN (?, ?)", [CLAIMS_ERA_CUTOFF_KEY, CLAIMS_ERA_RECORDED_KEY]);
    db.run("UPDATE meta SET value = '12' WHERE key = 'schemaVersion'");
    db.close();
    const reader = Store.open({ dir, observer: true });
    expect(reader.getMeta("schemaVersion")).toBe("12");
    expect(reader.getMeta(CLAIMS_ERA_RECORDED_KEY)).toBeUndefined();
    reader.close();
    const later = T + 86_400_000;
    const migrated = store(() => later);
    expect(migrated.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(migrated.getMeta(CLAIMS_ERA_CUTOFF_KEY)).toBe(String(later));
    expect(migrated.getMeta(CLAIMS_ERA_RECORDED_KEY)).toBe(String(later));
    expect(migrated.physicsOf(id).eraClaim).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
  });

  test("the bench's stores: what a writer minted with no claim is a default, so the era never reads it (review of #377)", async () => {
    // The LongMemEval harness opens at clock 0, then moves the clock to each
    // session's date and writes through the session-end door with no claim.
    let now = 0;
    const c = Counterpart.open({ dir, timeZone: "UTC", now: () => now });
    now = Date.UTC(2023, 4, 20, 12);
    const plain = await c.submitSessionEnd(
      { content: "The user adopted a rescue greyhound named Biscuit last spring.", kind: "fact" },
      { session: "s1", scope: "longmemeval" },
    );
    const claimed = await c.submitSessionEnd(
      { content: "The user is training for the city marathon in October.", kind: "fact", claimed: 0.8 },
      { session: "s1", scope: "longmemeval" },
    );
    c.close();
    expect(plain.deposited && claimed.deposited).toBe(true);
    // Make every row old: the record forgotten, the next open records "now", years later.
    const reset = store(() => now);
    reset.updateMeta(CLAIMS_ERA_RECORDED_KEY, () => null);
    reset.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
    reset.close();
    open.splice(0);
    const s = store(() => Date.UTC(2026, 9, 10, 12));
    expect(Number(s.getMeta(CLAIMS_ERA_CUTOFF_KEY))).toBeGreaterThan(now);
    const plainRow = s.row(plain.memoryId as string)!;
    expect(JSON.parse(plainRow.meta as string)[CLAIMED_DEFAULT_META_KEY]).toBe(true);
    expect(rowToPhysics(plainRow).eraClaim ?? null).toBeNull();
    // The explicit one is old too, and read at its default: the store really is in the era.
    expect(s.physicsOf(claimed.memoryId as string).eraClaim).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    expect(s.claimsEra().affected).toBe(1);
  });

  test("the spelled meta key matches mint's", () => {
    expect(CLAIMED_DEFAULT_SPELLED).toBe(CLAIMED_DEFAULT_META_KEY);
  });
});

describe("next_change_day: the era is in the curve's signature, and its inputs clear the day", () => {
  test("the signature carries the cutoff; toggling recomputes the affected rows on the next pass", () => {
    expect(curveSignature("1")).not.toBe(curveSignature(null));
    expect(curveSignature("1")).not.toBe(curveSignature("2"));
    const { s, ids } = seeded();
    runCycle({ store: s, date: "2026-10-11" });
    expect(s.getMeta(CURVE_META_KEY)).toBe(curveSignature(String(T + 1)));
    const id = ids["work"] as string;
    const onDay = s.row(id)!.next_change_day;
    expect(onDay).not.toBeNull();
    s.updateMeta(CLAIMS_ERA_CUTOFF_KEY, () => null);
    runCycle({ store: s, date: "2026-10-12" });
    expect(s.getMeta(CURVE_META_KEY)).toBe(curveSignature(null));
    const offDay = s.row(id)!.next_change_day;
    // Read at its 0.6 claim it leaves reach much later than at 0.25.
    expect(offDay as number).toBeGreaterThan(onDay as number);
  });

  test("a write to what it is about clears its next-change day (the era trigger)", () => {
    const { s, ids } = seeded();
    runCycle({ store: s, date: "2026-10-11" });
    const id = ids["work"] as string;
    expect(s.row(id)!.next_change_day).not.toBeNull();
    s.setAbout(id, "owner", { by: "owner" });
    expect(s.row(id)!.next_change_day).toBeNull();
    expect(s.physicsOf(id).eraClaim ?? null).toBeNull();
  });
});

describe("eraClaimOf: pure", () => {
  const base = {
    type: "memory" as const,
    kind: "fact" as const,
    claimed: OLD,
    created_at: 100,
    meta: "{}",
    about: "work",
    status: null,
    said_by: null,
    promoted_identity: 0,
    protected: 0,
    event_date: null,
  };
  test("off, a later memory, no claim, a schema row: null", () => {
    expect(eraClaimOf(base, null, null)).toBeNull();
    expect(eraClaimOf(base, "50", null)).toBeNull();
    expect(eraClaimOf({ ...base, claimed: null }, "200", null)).toBeNull();
    expect(eraClaimOf({ ...base, type: "schema" as never }, "200", null)).toBeNull();
    expect(eraClaimOf(base, "200", null)).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    // Written before v7 (no moment): old.
    expect(eraClaimOf({ ...base, created_at: null }, "200", null)).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
  });

  test("a merged memory is read at its best source's moment, not its own (2026-10-11)", () => {
    const merged = { ...base, created_at: 300, meta: JSON.stringify({ [ERA_WRITTEN_AT_META]: 100 }) };
    expect(eraClaimOf(merged, "200", null)).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    expect(eraClaimOf(merged, null, null)).toBeNull();
    expect(eraClaimOf(merged, "50", null)).toBeNull();
    // A source written before v7 carried no moment: old under any cutoff.
    expect(eraClaimOf({ ...merged, meta: JSON.stringify({ [ERA_WRITTEN_AT_META]: null }) }, "200", null)).toBe(PHYSICS.AUTHORED_DEFAULT_CLAIM);
    // Unreadable meta, or a marker that is not a moment: the row's own.
    expect(eraClaimOf({ ...merged, meta: "{not json" }, "200", null)).toBeNull();
    expect(eraClaimOf({ ...merged, meta: JSON.stringify({ [ERA_WRITTEN_AT_META]: "100" }) }, "200", null)).toBeNull();
  });

  test("eraCarriedFrom: the moment only when the source is old; the default mark whenever it had one", () => {
    const old = { created_at: 100, meta: JSON.stringify({ [CLAIMED_DEFAULT_SPELLED]: true }) };
    expect(eraCarriedFrom(old, "200")).toEqual({ [CLAIMED_DEFAULT_SPELLED]: true, [ERA_WRITTEN_AT_META]: 100 });
    expect(eraCarriedFrom(old, "50")).toEqual({ [CLAIMED_DEFAULT_SPELLED]: true });
    expect(eraCarriedFrom(old, null)).toEqual({ [CLAIMED_DEFAULT_SPELLED]: true });
    expect(eraCarriedFrom({ created_at: null, meta: "{}" }, 200)).toEqual({ [ERA_WRITTEN_AT_META]: null });
    // A merge of a merge: the first source's moment, through.
    expect(eraCarriedFrom({ created_at: 300, meta: JSON.stringify({ [ERA_WRITTEN_AT_META]: 100 }) }, "200")).toEqual({ [ERA_WRITTEN_AT_META]: 100 });
  });
});

describe("what doctor and the CLI say", () => {
  test("doctor: one green line with the count; the CLI reads and switches", async () => {
    const { s } = seeded();
    const era = s.claimsEra();
    expect(era.affected).toBe(Object.keys(READ_AT).length);
    const [f] = claimsEraFindings(s);
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain(`${String(era.affected)} memories`);
    expect(f?.detail).toContain(`(${String(era.down)} lower than stored, ${String(era.up)} higher)`);
    expect(era.up).toBe(READ_UP.length);
    expect(f?.detail).toContain("claims-era --off");
    s.close();
    const read = capture();
    expect(await run(["claims-era", "--dir", dir], { io: read.io, env: {} })).toBe(EXIT.ok);
    expect(read.out.join("\n")).toContain(`${String(era.affected)} memories`);
    const off = capture();
    expect(await run(["claims-era", "--off", "--dir", dir], { io: off.io, env: {} })).toBe(EXIT.ok);
    expect(off.out.join("\n")).toContain("Off");
    const after = store();
    expect(after.claimsEra()).toMatchObject({ cutoff: null, affected: 0 });
    expect(claimsEraFindings(after)[0]?.detail).toContain("off");
    after.close();
    const both = capture();
    expect(await run(["claims-era", "--on", "--off", "--dir", dir], { io: both.io, env: {} })).toBe(EXIT.usage);
  });
});
