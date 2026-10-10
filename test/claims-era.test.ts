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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claimsEraFindings } from "../src/adapters/claude-code/doctor.js";
import { EXIT, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/index.js";
import { CLAIMED_DEFAULT_META_KEY } from "../src/core/mint.js";
import { TUNABLES as PHYSICS, curveSal, sal, stability, strength } from "../src/core/physics/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { CURVE_META_KEY, curveSignature } from "../src/core/sleep/decay.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import {
  CLAIMED_DEFAULT_SPELLED,
  CLAIMS_ERA_CUTOFF_KEY,
  CLAIMS_ERA_RECORDED_KEY,
  RECURRING_META,
  eraClaimOf,
  rowToPhysics,
} from "../src/core/store/operational.js";

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
    spentDate: put(s, { eventDate: "2026-09-15", learnedOn: "2026-09-01" }),
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
  spentDate: PHYSICS.AUTHORED_DEFAULT_CLAIM,
};
const KEPT = ["core", "owner", "us", "saidByOwner", "protected", "pendingDate", "recurring", "defaulted", "lowWorld"];

describe("the read: old claims at their default, the exempt as claimed", () => {
  test("each class at 0.6 reads its default; each exempt class reads its own claim", () => {
    const { s, ids } = seeded();
    for (const [name, want] of Object.entries(READ_AT)) {
      const p = rowToPhysics(s.row(ids[name] as string)!);
      expect({ name, era: p.eraClaim }).toEqual({ name, era: want });
      expect(curveSal(p)).toBeCloseTo(Math.max(want, sal({ ...p.salience, claimed: null })), 10);
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
    for (let k = 1; k <= 5; k++) runCycle({ store: s, date: `2026-10-1${String(k)}` });
    for (const name of Object.keys(READ_AT)) expect(s.row(ids[name] as string)!.claimed).toBe(OLD);
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
});

describe("what doctor and the CLI say", () => {
  test("doctor: one green line with the count; the CLI reads and switches", async () => {
    const { s } = seeded();
    const era = s.claimsEra();
    expect(era.affected).toBe(Object.keys(READ_AT).length);
    const [f] = claimsEraFindings(s);
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain(`${String(era.affected)} memories`);
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
